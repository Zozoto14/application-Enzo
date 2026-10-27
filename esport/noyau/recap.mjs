/**
 * Récapitulatif e-mail des notifications Esport importantes (migration 0015).
 *
 * DÉSACTIVÉ par défaut. L'utilisateur l'active lui-même (Esport › Profil) en donnant SON adresse,
 * pour ce seul usage : elle est chiffrée au repos (AES-GCM 256, clé dérivée par HKDF de CLE_DISCORD
 * ou CLE_ESPORT, contexte propre, identifiant du compte en donnée associée) et effacée dès qu'il
 * désactive le récapitulatif ou supprime ses données. Elle n'est jamais rendue en clair par l'API
 * (seulement masquée), jamais écrite dans un journal.
 *
 * L'envoi est fait par la tâche cron du serveur Node (esport/serveur/cron.mjs), avec le SMTP de
 * esport.env : quotidien (au plus une fois toutes les 20 h) ou hebdomadaire. Seules les
 * notifications NON LUES et importantes (planning, rappels de réponse, demandes de compte) entrent
 * dans le récapitulatif ; rien à dire : rien n'est envoyé.
 */

import { rendreCourriel, adresseValide, masquerAdresse } from '../../relais/courriel-modeles.mjs';
import { base64url, depuisBase64url, echec, iso } from './outils.mjs';

const encodeur = new TextEncoder();
const decodeur = new TextDecoder();
const INFO = 'applibourse-esport/courriel-recap/aes-gcm/v1';
const FREQUENCES = { quotidien: 20 * 3_600_000, hebdomadaire: 6.5 * 86_400_000 };
/** Types de notifications in-app jugés importants pour le récapitulatif. */
export const TYPES_IMPORTANTS = ['evenement-nouveau', 'evenement-modifie', 'evenement-annule', 'rappel-rsvp', 'demande-compte', 'demande-compte-validee', 'demande-compte-refusee', 'tache-assignee', 'objectif-assigne', 'jeu-maj-proposee', 'sp-action', 'sp-obligation', 'sp-contrat', 'sp-responsable'];

const LIBELLES = {
  fr: { 'evenement-nouveau': 'Nouvel événement', 'evenement-modifie': 'Événement modifié', 'evenement-annule': 'Événement annulé', 'rappel-rsvp': 'Réponse attendue', 'demande-compte': 'Demande de compte', 'demande-compte-validee': 'Demande validée', 'demande-compte-refusee': 'Demande refusée', 'tache-assignee': 'Tâche assignée', 'objectif-assigne': 'Objectif assigné', 'jeu-maj-proposee': 'Mise à jour de profil de jeu à valider', 'sp-action': 'Sponsors : action prévue', 'sp-obligation': 'Sponsors : contrepartie à faire', 'sp-contrat': 'Sponsors : contrat bientôt terminé', 'sp-responsable': 'Sponsors : fiche confiée' },
  en: { 'evenement-nouveau': 'New event', 'evenement-modifie': 'Event updated', 'evenement-annule': 'Event cancelled', 'rappel-rsvp': 'Reply expected', 'demande-compte': 'Account request', 'demande-compte-validee': 'Request approved', 'demande-compte-refusee': 'Request refused', 'tache-assignee': 'Task assigned', 'objectif-assigne': 'Goal assigned', 'jeu-maj-proposee': 'Game profile update to review', 'sp-action': 'Sponsors: planned action', 'sp-obligation': 'Sponsors: deliverable due', 'sp-contrat': 'Sponsors: contract ending soon', 'sp-responsable': 'Sponsors: record assigned to you' },
};

async function cleAes(secret, usage) {
  if (typeof secret !== 'string' || secret.length < 32) throw echec(503, 'non-configure', 'Le serveur Esport n’a pas de clé pour chiffrer l’adresse (CLE_ESPORT ou CLE_DISCORD).');
  const graine = await crypto.subtle.importKey('raw', encodeur.encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encodeur.encode('applibourse-esport'), info: encodeur.encode(INFO) }, graine, { name: 'AES-GCM', length: 256 }, false, usage);
}

export async function chiffrerAdresse(secret, compte, adresse) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const chiffre = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encodeur.encode(`recap:${compte}`) }, await cleAes(secret, ['encrypt']), encodeur.encode(adresse));
  return `cr1.${base64url(iv)}.${base64url(chiffre)}`;
}

export async function dechiffrerAdresse(secret, compte, stocke) {
  const [v, iv, chiffre, reste] = String(stocke ?? '').split('.');
  if (v !== 'cr1' || !iv || !chiffre || reste !== undefined) return undefined;
  try {
    const clair = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: depuisBase64url(iv), additionalData: encodeur.encode(`recap:${compte}`) }, await cleAes(secret, ['decrypt']), depuisBase64url(chiffre));
    return decodeur.decode(clair);
  } catch {
    return undefined;
  }
}

export function servicesRecap({ base, cle, maintenant = () => Date.now() }) {
  /** `GET /moi/recap-courriel` : réglage, adresse MASQUÉE seulement. */
  async function lire(acteur) {
    const l = await base.premier('SELECT * FROM courriel_recap WHERE compte_id = ?', [acteur.compte]);
    if (!l) return { actif: false, frequence: 'quotidien', adresse: null, dernierEnvoi: null };
    const adresse = cle ? await dechiffrerAdresse(cle, acteur.compte, l.adresse_chiffree) : undefined;
    return { actif: true, frequence: l.frequence, adresse: adresse ? masquerAdresse(adresse) : null, dernierEnvoi: l.dernier_envoi_le ?? null, dernierStatut: l.dernier_statut ?? null };
  }

  /** `PUT /moi/recap-courriel` `{ actif, adresse?, frequence? }` : activer (adresse requise la 1re fois), changer, désactiver (adresse effacée). */
  async function regler(acteur, corps) {
    if (corps?.actif !== true) {
      await base.executer('DELETE FROM courriel_recap WHERE compte_id = ?', [acteur.compte]);
      return lire(acteur);
    }
    const frequence = Object.hasOwn(FREQUENCES, corps?.frequence ?? '') ? corps.frequence : 'quotidien';
    const existant = await base.premier('SELECT compte_id FROM courriel_recap WHERE compte_id = ?', [acteur.compte]);
    const date = iso(maintenant());
    if (typeof corps?.adresse === 'string' && corps.adresse.trim()) {
      if (!adresseValide(corps.adresse)) throw echec(400, 'email', 'Adresse e-mail invalide.');
      const chiffree = await chiffrerAdresse(cle, acteur.compte, corps.adresse.trim());
      await base.executer(
        `INSERT INTO courriel_recap (compte_id, adresse_chiffree, frequence, cree_le, maj_le) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (compte_id) DO UPDATE SET adresse_chiffree = excluded.adresse_chiffree, frequence = excluded.frequence, maj_le = excluded.maj_le`,
        [acteur.compte, chiffree, frequence, date, date],
      );
    } else if (existant) {
      await base.executer('UPDATE courriel_recap SET frequence = ?, maj_le = ? WHERE compte_id = ?', [frequence, date, acteur.compte]);
    } else {
      throw echec(400, 'email', 'Adresse e-mail invalide.');
    }
    return lire(acteur);
  }

  return { lire, regler };
}

function ligneNotification(n, langue) {
  let charge = {};
  try {
    charge = JSON.parse(n.charge ?? '{}');
  } catch {
    charge = {};
  }
  const libelle = LIBELLES[langue][n.type] ?? n.type;
  const titre = [libelle, typeof charge.titre === 'string' ? charge.titre : typeof charge.pseudo === 'string' ? charge.pseudo : typeof charge.nom === 'string' ? charge.nom : ''].filter(Boolean).join(' · ');
  const quand = typeof charge.debut === 'string' ? charge.debut.replace('T', ' ').slice(0, 16) : '';
  return { titre: `${n.team ? `[${n.team}] ` : ''}${titre}`, texte: quand, date: String(n.cree_le).slice(0, 10) };
}

/**
 * Tâche du cron (serveur Node) : envoie les récapitulatifs dus. `envoyer({ a, objet, texte, html })`
 * vient de esport/serveur/courriel-smtp.mjs. Rend `{ envoyes, echecs, rien }`.
 */
export async function tacheRecap(base, { cle, envoyer, maintenant = Date.now(), lienApp }) {
  const bilan = { envoyes: 0, echecs: 0, rien: 0 };
  if (!envoyer || !cle) return bilan;
  const lignes = await base.tous('SELECT r.*, COALESCE(c.langue, c.langue_defaut) AS langue, c.pseudo FROM courriel_recap r JOIN comptes c ON c.id = r.compte_id', []);
  for (const r of lignes) {
    const depuis = r.dernier_envoi_le ?? r.cree_le;
    if (r.dernier_envoi_le && maintenant - Date.parse(r.dernier_envoi_le) < FREQUENCES[r.frequence]) continue;
    const types = TYPES_IMPORTANTS;
    const notifs = await base.tous(
      `SELECT n.type, n.charge, n.cree_le, t.nom AS team FROM notifications n LEFT JOIN teams t ON t.id = n.team_id
        WHERE n.compte_id = ? AND n.lue_le IS NULL AND n.cree_le >= ? AND n.type IN (${types.map(() => '?').join(', ')})
        ORDER BY n.cree_le DESC LIMIT 50`,
      [r.compte_id, depuis, ...types],
    );
    const date = iso(maintenant);
    if (notifs.length === 0) {
      bilan.rien++;
      continue;
    }
    const adresse = await dechiffrerAdresse(cle, r.compte_id, r.adresse_chiffree);
    const langue = r.langue === 'en' ? 'en' : 'fr';
    let statut = 'envoye';
    if (!adresse) statut = 'adresse-illisible';
    else {
      const m = rendreCourriel({ modele: 'recap', langue, site: lienApp || 'https://appdashboard.fr', variables: { prenom: r.pseudo, elements: notifs.map(n => ligneNotification(n, langue)) } });
      try {
        await envoyer({ a: adresse, nom: r.pseudo, objet: m.objet, texte: m.texte, html: m.html, langue });
      } catch {
        statut = 'echec';
      }
    }
    if (statut === 'envoye') bilan.envoyes++;
    else bilan.echecs++;
    await base.executer('UPDATE courriel_recap SET dernier_envoi_le = ?, dernier_statut = ? WHERE compte_id = ?', [statut === 'envoye' ? date : (r.dernier_envoi_le ?? null), statut, r.compte_id]);
  }
  return bilan;
}
