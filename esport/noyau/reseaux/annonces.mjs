/**
 * Bot d'annonce Discord des posts publiés (page « Réseaux » de l'espace CM ; docs/esport/reseaux-stats.md).
 *
 * Abonné du bus : `cm.post_publie` (première publication) et `cm.post_adresses` (adresses ajoutées ou changées
 * sur un post déjà publié). Il relit la CARTE (jamais la seule charge de l'événement) et, pour chaque réseau dont
 * l'adresse du post est saisie :
 *  - tient à jour la publication suivie pour les statistiques (`cm_rs_publications`) ;
 *  - trouve le compte du post (regles.mjs : identifiant de l'adresse, team de la carte, club) ; si ce compte est
 *    actif et que son annonce est activée, met UNE ligne par salon cible dans `cm_rs_annonces` (unique par post,
 *    réseau et salon : modifier la carte, rejouer l'événement ou republier ne reposte rien ; une adresse changée
 *    repasse la ligne en « editer » : le message déjà posté est réédité, jamais doublé).
 * Aucun appel réseau dans l'abonné : `traiterAnnoncesReseaux` envoie (juste après la requête, et par le cron).
 *
 * Même chaîne que les messages Discord des teams (discord/file.mjs, discord/bilingue.mjs) : modèle à variables
 * nettoyé (aucune mention possible, sauf le rôle choisi), embed, message ANGLAIS d'abord puis fil « 🇫🇷 Version
 * française » (créé par le bot) avec la version française ; étapes reprenables (message, fil, français) enregistrées
 * une à une ; nonce du bot ; 429 respecté ; réessais 1 min, 5 min, 15 min, 1 h, 3 h puis abandon ; fil impossible :
 * l'anglais reste, alerte au Fondateur au plus une fois par salon et par 24 h.
 *
 * Salon cible : celui d'une TEAM (son bot lié, sinon son webhook ; réglages de langue et de fil de la team) ou un
 * salon du CLUB (webhook chiffré propre à la page Réseaux, `cm_rs_salons`). Visuel : l'image de couverture de la
 * carte, sinon sa première image jointe (envoyée en pièce jointe, 8 Mo au plus), sinon un lien d'image https.
 *
 * Ce fichier n'importe pas evenements.mjs (c'est lui qui nous importe).
 */

import { echec, iso, jsonOu, nouvelId } from '../outils.mjs';
import { lireLangue, texte as T } from '../langues.mjs';
import { dechiffrerWebhook } from '../discord/chiffrement.mjs';
import { API_DISCORD, ATTENTES_ECHEC_S, ESSAIS_MAX, appelerDiscord, filFrActif, modulesActifs, serveurBot } from '../discord/file.mjs';
import { LONGUEUR_MAX_MODELE, construireCharge, nettoyerTexteDiscord, nettoyerVariable, rendreModele, variablesDuModele } from '../discord/messages.mjs';
import { bornerEmbed, couleurEntier } from '../discord/embeds.mjs';
import { ARCHIVAGE_FIL_MIN, PERIODE_ALERTE_FIL_MS, alerteFilPermise, avecParams, chargeAlerteFil, discordFondateur, motifRefusFil, nomFil, nomPost, nonceEnvoi, texteMotifFil } from '../discord/bilingue.mjs';
import { RESEAUX_COMPTES, cleUrl, compteDuPost, estVideo, typeContenuDeCarte } from './regles.mjs';

/** Variables d'un modèle d'annonce. */
export const VARIABLES_ANNONCE = Object.freeze(['reseau', 'compte', 'url', 'titre', 'team']);
const VALIDITE_MS = 24 * 3_600_000;
const BAIL_MS = 120_000;
const CONSERVATION_MS = 60 * 86_400_000;
export const TAILLE_MAX_IMAGE = 8 * 1024 * 1024;
const TYPES_IMAGE = Object.freeze({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' });
const https = v => (typeof v === 'string' && /^https:\/\/[^\s"<>]+$/.test(v) && v.length <= 2000 ? v : null);

// ------------------------------------------------------------------ Modèles

/** Modèle par défaut d'une annonce, dans une langue. */
export const modeleDefaut = langue => T(langue, 'reseaux.modele_defaut');

/** Modèle saisi : nettoyé, 500 caractères au plus, variables connues ; vide → null (modèle par défaut). */
export function validerModeleAnnonce(saisie) {
  if (saisie === undefined || saisie === null) return null;
  const brut = String(saisie).normalize('NFC').replace(/\r\n?/g, '\n').trim();
  if (brut === '') return null;
  if (brut.length > LONGUEUR_MAX_MODELE) throw echec(400, 'modele-long', `Modèle trop long (${LONGUEUR_MAX_MODELE} caractères au plus).`);
  const inconnues = variablesDuModele(brut).filter(v => !VARIABLES_ANNONCE.includes(v));
  if (inconnues.length > 0) {
    const e = echec(400, 'variable-inconnue', `Variable inconnue : ${inconnues.map(v => `{${v}}`).join(', ')}. Variables permises : ${VARIABLES_ANNONCE.map(v => `{${v}}`).join(', ')}.`);
    e.details = { inconnues, permises: [...VARIABLES_ANNONCE] };
    throw e;
  }
  return nettoyerTexteDiscord(brut, LONGUEUR_MAX_MODELE);
}

/** Valeurs des variables d'une annonce (le nom de la team, sinon « le club » dans la langue du message). */
export function variablesAnnonce({ reseau, identifiant, url, titre, team }, langue) {
  return {
    reseau: RESEAUX_COMPTES[reseau]?.nom ?? String(reseau ?? ''),
    compte: identifiant ? `@${identifiant}` : '',
    url: url ?? '',
    titre: titre ?? '',
    team: team || T(langue, 'reseaux.club'),
  };
}

/**
 * Charge Discord d'une annonce : embed (réseau, titre lié au post, texte du modèle, compte, team, visuel), bouton
 * « Voir le post ». `image` : `{ url }` (lien https ou image déjà hébergée par Discord) ou `{ piece: nom }` (fichier
 * joint à l'envoi, cité par `attachment://`). `roleId` : seule mention possible (message principal seulement).
 */
export function chargeAnnonce({ reseau, variables, modele, langue = 'en', roleId = null, image = null, urlProfil = null, lienApp = '', maintenant = Date.now(), test = false }) {
  const r = RESEAUX_COMPTES[reseau];
  const contenu = rendreModele(modele || modeleDefaut(langue), variables);
  const lienPost = https(variables.url);
  const valeurCompte = variables.compte ? (https(urlProfil) ? `[${nettoyerVariable(variables.compte)}](${urlProfil})` : nettoyerVariable(variables.compte)) : '';
  const imageUrl = image?.piece ? `attachment://${image.piece}` : https(image?.url);
  const embed = bornerEmbed({
    author: { name: `📣 ${T(langue, test ? 'reseaux.test_titre' : 'reseaux.nouveau_post', { reseau: r?.nom ?? '' })}` },
    title: `${r?.glyphe ?? '📣'} ${nettoyerVariable(variables.titre) || r?.nom || ''}`,
    ...(lienPost ? { url: lienPost } : {}),
    color: couleurEntier(r?.couleur ?? '#5b8cff'),
    ...(contenu ? { description: nettoyerTexteDiscord(contenu, 3000) } : {}),
    fields: [
      ...(valeurCompte ? [{ name: `👤 ${T(langue, 'reseaux.champ_compte')}`, value: valeurCompte, inline: true }] : []),
      { name: `🏷️ ${T(langue, 'reseaux.champ_reseau')}`, value: r?.nom ?? '', inline: true },
      { name: `🛡️ ${T(langue, 'reseaux.champ_team')}`, value: nettoyerVariable(variables.team), inline: true },
    ],
    ...(imageUrl ? { image: { url: imageUrl } } : {}),
    footer: { text: `${nettoyerVariable(variables.team).slice(0, 80)} · Esport` },
    timestamp: new Date(maintenant).toISOString(),
  });
  const boutons = [];
  if (lienPost) boutons.push({ type: 2, style: 5, label: T(langue, 'reseaux.voir_post'), emoji: { name: '🔗' }, url: lienPost });
  if (https(lienApp)) boutons.push({ type: 2, style: 5, label: T(langue, 'bouton.ouvrir_app'), emoji: { name: '📲' }, url: lienApp });
  return construireCharge(contenu, { roleId, nomTeam: variables.team, embed, composants: boutons.length ? [{ type: 1, components: boutons }] : [], maintenant, langue });
}

// ------------------------------------------------------------------ Abonné du bus

/** Réglages de la page (cm_reglages, clé « reseaux ») : rappels J+1 / J+7 par défaut des nouvelles publications. */
export async function lireReglagesReseaux(base) {
  const l = await base.premier("SELECT valeur FROM cm_reglages WHERE cle = 'reseaux'", []);
  const v = jsonOu(l?.valeur, {});
  return { rappels: v.rappels !== false };
}

/** Team d'une carte : la sienne, sinon celle de son tableau, sinon la team liée. */
export async function teamDeCarte(base, carte) {
  if (carte.team_id) return carte.team_id;
  const tb = await base.premier('SELECT team_id FROM cm_tableaux WHERE id = ?', [carte.tableau_id]);
  return tb?.team_id ?? jsonOu(carte.liens, {}).teamId ?? null;
}

/** Adresses publiées d'une carte : `[[reseau, url]]` (adresses non vides seulement). */
const adressesDe = carte => Object.entries(jsonOu(carte.publications, {})).filter(([, url]) => typeof url === 'string' && url);

/** Publications suivies (statistiques) d'une carte publiée : créées, rattachées ou mises à jour. */
export async function synchroniserPublications(base, carte, t) {
  const comptes = await base.tous('SELECT * FROM cm_rs_comptes WHERE supprime_le IS NULL', []);
  const teamId = await teamDeCarte(base, carte);
  const liens = jsonOu(carte.liens, {});
  const reglages = await lireReglagesReseaux(base);
  for (const [reseau, url] of adressesDe(carte)) {
    const compte = compteDuPost({ url, reseau, teamId }, comptes);
    const existante = await base.premier('SELECT * FROM cm_rs_publications WHERE carte_id = ? AND reseau = ?', [carte.id, reseau]);
    if (existante) {
      if (existante.url !== url || existante.supprime_le) {
        await base.executer('UPDATE cm_rs_publications SET url = ?, compte_id = COALESCE(compte_id, ?), supprime_le = NULL, maj_le = ? WHERE id = ?', [url, compte?.id ?? null, iso(t), existante.id]);
      }
      continue;
    }
    // Publication ajoutée à la main (ou importée) AVANT que la carte soit marquée publiée : rattachée à la carte.
    const externes = await base.tous('SELECT id, url FROM cm_rs_publications WHERE carte_id IS NULL AND reseau = ? AND supprime_le IS NULL ORDER BY cree_le DESC LIMIT 500', [reseau]);
    const externe = externes.find(p => cleUrl(p.url) === cleUrl(url));
    if (externe) {
      await base.executer(
        "UPDATE cm_rs_publications SET carte_id = ?, url = ?, titre = CASE WHEN titre = '' THEN ? ELSE titre END, team_id = COALESCE(team_id, ?), compte_id = COALESCE(compte_id, ?), maj_le = ? WHERE id = ?",
        [carte.id, url, carte.titre, teamId, compte?.id ?? null, iso(t), externe.id],
      );
      continue;
    }
    const type = typeContenuDeCarte({ origine: carte.origine, origine_cle: carte.origine_cle, liens });
    await base.executer(
      `INSERT INTO cm_rs_publications (id, carte_id, reseau, compte_id, url, titre, type_contenu, team_id, publie_le, video, rappels, cree_par, cree_le, maj_par, maj_le)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (carte_id, reseau) DO NOTHING`,
      [nouvelId(), carte.id, reseau, compte?.id ?? null, url, carte.titre, type, teamId, carte.publie_le ?? iso(t), estVideo(reseau, { type, url }) ? 1 : 0, reglages.rappels ? 1 : 0, carte.publie_par ?? null, iso(t), carte.publie_par ?? null, iso(t)],
    );
  }
}

/**
 * Annonces d'une carte publiée : une ligne par réseau et par salon cible du compte du post (annonce activée).
 * Idempotent : même adresse → rien ; adresse changée → la ligne déjà postée passe « editer ».
 */
export async function planifierAnnonces(base, carte, creeLe) {
  const t = Date.parse(creeLe) || Date.now();
  const comptes = await base.tous('SELECT * FROM cm_rs_comptes WHERE supprime_le IS NULL', []);
  const teamId = await teamDeCarte(base, carte);
  for (const [reseau, url] of adressesDe(carte)) {
    const compte = compteDuPost({ url, reseau, teamId }, comptes);
    if (!compte || Number(compte.annonce_active) !== 1) continue;
    const cibles = await base.tous('SELECT * FROM cm_rs_cibles WHERE compte_id = ? ORDER BY cle', [compte.id]);
    for (const c of cibles) {
      const ligne = await base.premier('SELECT * FROM cm_rs_annonces WHERE carte_id = ? AND reseau = ? AND cible = ?', [carte.id, reseau, c.cle]);
      if (!ligne) {
        await base.executer(
          `INSERT INTO cm_rs_annonces (id, carte_id, reseau, compte_id, cible, team_id, salon_id, url_post, operation, statut, essais, prochain_essai_le, expire_le, cree_le, maj_le)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'poster', 'attente', 0, ?, ?, ?, ?) ON CONFLICT (carte_id, reseau, cible) DO NOTHING`,
          [nouvelId(), carte.id, reseau, compte.id, c.cle, c.team_id ?? null, c.salon_id ?? null, url, iso(t), iso(t + VALIDITE_MS), iso(t), iso(t)],
        );
        continue;
      }
      if (ligne.url_post === url) continue;
      if (ligne.statut === 'attente') {
        // Envoi en cours : il prendra la nouvelle adresse (ou sera réédité à la fin s'il a déjà posté l'ancienne).
        await base.executer('UPDATE cm_rs_annonces SET url_post = ?, maj_le = ? WHERE id = ?', [url, iso(t), ligne.id]);
        continue;
      }
      await base.executer(
        `UPDATE cm_rs_annonces SET url_post = ?, operation = ?, statut = 'attente', essais = 0, prochain_essai_le = ?, expire_le = ?, derniere_erreur = NULL, verrou_jusqua = NULL, maj_le = ? WHERE id = ?`,
        [url, ligne.message_id ? 'editer' : 'poster', iso(t), iso(t + VALIDITE_MS), iso(t), ligne.id],
      );
    }
  }
}

/** Abonné du bus (evenements.mjs). */
export async function abonneAnnonces(base, ev) {
  if (ev.type === 'team.deleted' && ev.team_id) {
    // Team supprimée : plus aucune annonce vers son salon.
    await base.executer('DELETE FROM cm_rs_cibles WHERE team_id = ?', [ev.team_id]);
    await base.executer("UPDATE cm_rs_annonces SET statut = 'abandonne', derniere_erreur = ?, maj_le = ? WHERE team_id = ? AND statut = 'attente'", ['Team supprimée ou archivée', ev.cree_le, ev.team_id]);
    return;
  }
  if (ev.type !== 'cm.post_publie' && ev.type !== 'cm.post_adresses') return;
  const carte = await base.premier('SELECT * FROM cm_cartes WHERE id = ?', [ev.entite_id]);
  if (!carte || carte.supprime_le || carte.statut !== 'publie' || Number(carte.post) !== 1) return;
  await synchroniserPublications(base, carte, Date.parse(ev.cree_le) || Date.now());
  await planifierAnnonces(base, carte, ev.cree_le);
}

// ------------------------------------------------------------------ Envoi

/** Visuel d'une carte : `{ fichier: { nom, type, octets } }`, `{ url }` ou null. */
export async function visuelDeCarte(base, stockage, carte) {
  const pieces = await base.tous(
    'SELECT p.id, p.genre, p.url, f.type_mime, f.taille, f.cle_stockage, f.supprime_le AS f_supprime FROM cm_pieces p LEFT JOIN cm_fichiers f ON f.id = p.fichier_id WHERE p.carte_id = ? AND p.supprime_le IS NULL ORDER BY p.cree_le, p.id',
    [carte.id],
  );
  const couverture = jsonOu(carte.couverture, null)?.pieceId;
  for (const p of [...pieces.filter(x => x.id === couverture), ...pieces.filter(x => x.id !== couverture)]) {
    const ext = TYPES_IMAGE[p.type_mime];
    if (p.genre === 'fichier' && ext && !p.f_supprime && Number(p.taille) <= TAILLE_MAX_IMAGE && stockage) {
      const f = await stockage.lire(p.cle_stockage).catch(() => null);
      if (f?.octets?.length && f.octets.length <= TAILLE_MAX_IMAGE) return { fichier: { nom: `visuel.${ext}`, type: p.type_mime, octets: f.octets } };
    }
    if (p.genre === 'lien' && typeof p.url === 'string' && p.url.length <= 1000 && /^https:\/\/[^\s"<>]+\.(png|jpe?g|gif|webp)(\?[^\s"<>]*)?$/i.test(p.url)) return { url: p.url };
  }
  return null;
}

/**
 * Salon d'une ligne : team (bot lié, sinon webhook ; langue et fil de la team) ou salon du club (webhook).
 * Rend `{ canal, url?, salonId?, bilingue, langue, nom, suivi: { table, id, ligne }, alerte }` ou `{ abandon }`.
 */
export async function resoudreCible(base, { cible, teamId, salonId }, { cle, jetonBot }) {
  const dechiffrer = async (aad, chiffre) => {
    try {
      return await dechiffrerWebhook(cle, aad, chiffre);
    } catch {
      return undefined;
    }
  };
  if (String(cible).startsWith('team:')) {
    const team = await base.premier('SELECT id, nom, langue_discord FROM teams WHERE id = ? AND supprimee_le IS NULL AND archivee_le IS NULL', [teamId]);
    if (!team) return { abandon: 'Team supprimée ou archivée' };
    if (!(await modulesActifs(base, team.id)).has('discord')) return { abandon: 'Module Discord désactivé' };
    const bilingue = await filFrActif(base, team.id);
    const langue = bilingue ? 'en' : (lireLangue(team.langue_discord) ?? 'fr');
    const serveur = await serveurBot(base, team.id);
    if (serveur) {
      if (!jetonBot) return { abandon: 'Bot Discord non configuré sur le serveur (DISCORD_BOT_TOKEN)' };
      return { canal: 'bot', salonId: serveur.salon_id, bilingue, langue, nom: team.nom, suivi: { table: 'discord_serveurs', id: team.id, ligne: serveur }, alerte: { cle: serveur.salon_id, teamId: team.id } };
    }
    const wh = await base.premier('SELECT * FROM discord_webhooks WHERE team_id = ?', [team.id]);
    if (!wh) return { abandon: 'Team sans salon Discord (ni bot ni webhook)' };
    const url = await dechiffrer(team.id, wh.url_chiffree);
    if (!url) return { abandon: 'Adresse du webhook illisible (clé de chiffrement changée ?) : saisissez-la à nouveau' };
    return { canal: 'webhook', url, bilingue, langue, nom: team.nom, suivi: { table: 'discord_webhooks', id: team.id, ligne: wh }, alerte: { cle: `webhook:${team.id}`, teamId: team.id } };
  }
  const s = await base.premier('SELECT * FROM cm_rs_salons WHERE id = ?', [salonId]);
  if (!s) return { abandon: 'Salon du club supprimé' };
  const url = await dechiffrer(`reseaux:${s.id}`, s.url_chiffree);
  if (!url) return { abandon: 'Adresse du webhook illisible (clé de chiffrement changée ?) : saisissez-la à nouveau' };
  const bilingue = Number(s.fil_fr) === 1;
  return { canal: 'webhook', url, bilingue, langue: bilingue ? 'en' : (lireLangue(s.langue) ?? 'fr'), nom: s.nom, suivi: { table: 'cm_rs_salons', id: s.id, ligne: s }, alerte: { cle: `reseaux:${s.id}`, salon: s } };
}

/**
 * Suivi du salon (succès, échec, limite de débit, webhook perdu) : requêtes FIXES par table (salon d'une team par son
 * bot ou son webhook, salon du club). `?` : (instant | jusqu'à) puis clé.
 */
const SQL_SUIVI = Object.freeze({
  discord_serveurs: {
    succes: 'UPDATE discord_serveurs SET dernier_succes_le = ?, bloque_jusqua = NULL WHERE team_id = ?',
    bloque: 'UPDATE discord_serveurs SET bloque_jusqua = ? WHERE team_id = ?',
    echec: 'UPDATE discord_serveurs SET dernier_echec_le = ?, invalide_le = CASE WHEN ? = 1 THEN ? ELSE invalide_le END WHERE team_id = ?',
  },
  discord_webhooks: {
    succes: 'UPDATE discord_webhooks SET dernier_succes_le = ?, bloque_jusqua = NULL WHERE team_id = ?',
    bloque: 'UPDATE discord_webhooks SET bloque_jusqua = ? WHERE team_id = ?',
    echec: 'UPDATE discord_webhooks SET dernier_echec_le = ?, invalide_le = CASE WHEN ? = 1 THEN ? ELSE invalide_le END WHERE team_id = ?',
  },
  cm_rs_salons: {
    succes: 'UPDATE cm_rs_salons SET dernier_succes_le = ?, bloque_jusqua = NULL WHERE id = ?',
    bloque: 'UPDATE cm_rs_salons SET bloque_jusqua = ? WHERE id = ?',
    echec: 'UPDATE cm_rs_salons SET dernier_echec_le = ?, invalide_le = CASE WHEN ? = 1 THEN ? ELSE invalide_le END WHERE id = ?',
  },
});

/** Journal de la section CM (club) : jamais l'adresse d'un webhook ni la réponse de Discord. */
async function consigner(base, ligne, action, meta, t) {
  await base.executer(
    "INSERT INTO journal (id, team_id, acteur_id, action, entite_type, entite_id, meta, cree_le) VALUES (?, NULL, NULL, ?, 'cm_carte', ?, ?, ?)",
    [nouvelId(), action, ligne.carte_id, JSON.stringify({ reseau: ligne.reseau, ...meta }), iso(t)],
  );
}

/**
 * Envoie les annonces dues. Options : `cle` (secret des webhooks), `fetch`, `maintenant` (ms), `lienApp`,
 * `jetonBot`, `stockage` (visuel joint), `limite`. Rend `{ envoyes, abandonnes, reportes }`.
 */
export async function traiterAnnoncesReseaux(base, { cle, fetch: fetchDiscord = (...a) => globalThis.fetch(...a), maintenant = Date.now(), lienApp = '', jetonBot, stockage, limite = 30 } = {}) {
  const bilan = { envoyes: 0, abandonnes: 0, reportes: 0 };
  const t = maintenant;
  const dues = await base.tous(
    "SELECT * FROM cm_rs_annonces WHERE statut = 'attente' AND prochain_essai_le <= ? AND (verrou_jusqua IS NULL OR verrou_jusqua < ?) ORDER BY cree_le, id LIMIT ?",
    [iso(t), iso(t), limite],
  );
  const bloques = new Set();

  const majLigne = (id, champs) => {
    const cles = Object.keys(champs);
    return base.executer(`UPDATE cm_rs_annonces SET ${cles.map(k => `${k} = ?`).join(', ')}, maj_le = ? WHERE id = ?`, [...cles.map(k => champs[k]), iso(t), id]);
  };
  async function abandonner(ligne, motif, { journal = true } = {}) {
    await majLigne(ligne.id, { statut: 'abandonne', derniere_erreur: motif, verrou_jusqua: null });
    if (journal) await consigner(base, ligne, 'cm.annonce_abandonnee', { motif }, t);
    bilan.abandonnes++;
  }
  /** Fin d'un envoi (le message principal est parti). Adresse changée pendant l'envoi : la ligne repasse « editer ». */
  async function terminer(ligne, { erreur = null, urlAnnoncee } = {}) {
    const annoncee = urlAnnoncee ?? ligne.url_annoncee ?? ligne.url_post;
    const courante = (await base.premier('SELECT url_post FROM cm_rs_annonces WHERE id = ?', [ligne.id]))?.url_post ?? ligne.url_post;
    if (courante !== annoncee) {
      await majLigne(ligne.id, { operation: 'editer', statut: 'attente', essais: 0, prochain_essai_le: iso(t), expire_le: iso(t + VALIDITE_MS), derniere_erreur: erreur, verrou_jusqua: null, url_annoncee: annoncee });
    } else {
      await majLigne(ligne.id, { statut: 'envoye', envoye_le: iso(t), derniere_erreur: erreur, verrou_jusqua: null, url_annoncee: annoncee });
    }
    bilan.envoyes++;
  }
  const suiviOk = c => base.executer(SQL_SUIVI[c.suivi.table].succes, [iso(t), c.suivi.id]);
  /** Échec : 429 (attente de Discord, sans compter d'essai), réessai plus tard, ou abandon (ou fin si l'anglais est parti). */
  async function echouer(ligne, r, c, { apresMax, edition = false } = {}) {
    if (r.statut === 429) {
      const jusqua = iso(t + r.retryApresS * 1000);
      await majLigne(ligne.id, { prochain_essai_le: jusqua, verrou_jusqua: null, derniere_erreur: r.motif });
      await base.executer(SQL_SUIVI[c.suivi.table].bloque, [jusqua, c.suivi.id]);
      bloques.add(`${c.suivi.table}:${c.suivi.id}`);
      bilan.reportes++;
      return;
    }
    const essais = Number(ligne.essais) + 1;
    // Webhook supprimé ou bot refusé (hors édition : un message effacé n'invalide pas le salon).
    const perdu = r.webhookPerdu && !edition ? 1 : 0;
    await base.executer(SQL_SUIVI[c.suivi.table].echec, [iso(t), perdu, iso(t), c.suivi.id]);
    if (r.definitif || essais >= ESSAIS_MAX) {
      await majLigne(ligne.id, { essais });
      if (apresMax) return apresMax();
      await abandonner({ ...ligne, essais }, r.motif);
      return;
    }
    await majLigne(ligne.id, { essais, prochain_essai_le: iso(t + ATTENTES_ECHEC_S[Math.min(essais - 1, ATTENTES_ECHEC_S.length - 1)] * 1000), derniere_erreur: r.motif, verrou_jusqua: null });
    bilan.reportes++;
  }
  /** Fil impossible : l'anglais reste ; alerte au Fondateur au plus une fois par salon et par 24 h. */
  async function filImpossible(ligne, c, { motif, statut, salonId }) {
    const texte = texteMotifFil(motif, statut);
    await consigner(base, ligne, 'cm.annonce_fil_impossible', { motif: texte }, t);
    const permise = c.alerte.salon ? !c.alerte.salon.alerte_fil_le || t - Date.parse(c.alerte.salon.alerte_fil_le) >= PERIODE_ALERTE_FIL_MS : await alerteFilPermise(base, c.alerte.cle, t);
    if (permise) {
      let charge = chargeAlerteFil({ motif, statut, fondateurId: await discordFondateur(base), team: { nom: c.nom }, maintenant: t });
      const parBot = c.canal === 'bot' && jetonBot && salonId;
      if (parBot) {
        const { username: _u, ...reste } = charge;
        charge = reste;
      }
      const r = parBot ? await appelerDiscord(fetchDiscord, `${API_DISCORD}/channels/${salonId}/messages`, charge, { jetonBot }) : c.canal === 'webhook' ? await appelerDiscord(fetchDiscord, c.url, charge) : { ok: false };
      if (r.ok && c.alerte.salon) await base.executer('UPDATE cm_rs_salons SET alerte_fil_le = ? WHERE id = ?', [iso(t), c.alerte.salon.id]);
      else if (r.ok) {
        await base.executer(
          `INSERT INTO discord_alertes_fil (salon_id, team_id, motif, alerte_le) VALUES (?, ?, ?, ?)
           ON CONFLICT (salon_id) DO UPDATE SET team_id = excluded.team_id, motif = excluded.motif, alerte_le = excluded.alerte_le`,
          [c.alerte.cle, c.alerte.teamId, motif, iso(t)],
        );
      }
    }
    await terminer(ligne, { erreur: texte });
  }

  for (const brute of dues) {
    const pris = await base.executer("UPDATE cm_rs_annonces SET verrou_jusqua = ? WHERE id = ? AND statut = 'attente' AND (verrou_jusqua IS NULL OR verrou_jusqua < ?)", [iso(t + BAIL_MS), brute.id, iso(t)]);
    if (pris.changements !== 1) continue;
    const ligne = brute;
    const commence = Boolean(ligne.message_id);
    // Publication commencée (anglais parti, français en cours) : l'envoi se termine sans sa version française. Une
    // édition (ou rien de posté) : abandon — jamais « terminer », qui la remettrait en file indéfiniment.
    const arreter = (motif, o) => (commence && ligne.operation === 'poster' ? terminer(ligne, { erreur: `Version française non publiée : ${motif}` }) : abandonner(ligne, motif, o));
    if (Date.parse(ligne.expire_le) <= t) {
      if (commence && ligne.operation === 'poster') await terminer(ligne, { erreur: 'Version française non publiée : message périmé' });
      else await abandonner(ligne, 'Message périmé (trop ancien pour être utile)', { journal: ligne.operation !== 'editer' });
      continue;
    }
    const carte = await base.premier('SELECT * FROM cm_cartes WHERE id = ?', [ligne.carte_id]);
    if (!carte || carte.supprime_le || carte.statut !== 'publie') {
      await arreter('Post dépublié ou supprimé', { journal: false });
      continue;
    }
    const compte = ligne.compte_id ? await base.premier('SELECT * FROM cm_rs_comptes WHERE id = ?', [ligne.compte_id]) : null;
    if (!compte || compte.supprime_le || Number(compte.actif) !== 1 || Number(compte.annonce_active) !== 1) {
      await arreter('Annonce désactivée pour ce compte', { journal: false });
      continue;
    }
    const c = await resoudreCible(base, { cible: ligne.cible, teamId: ligne.team_id, salonId: ligne.salon_id }, { cle, jetonBot });
    if (c.abandon) {
      await arreter(c.abandon);
      continue;
    }
    if (bloques.has(`${c.suivi.table}:${c.suivi.id}`)) continue;
    if (c.suivi.ligne.bloque_jusqua && Date.parse(c.suivi.ligne.bloque_jusqua) > t) {
      await majLigne(ligne.id, { prochain_essai_le: c.suivi.ligne.bloque_jusqua, verrou_jusqua: null });
      bloques.add(`${c.suivi.table}:${c.suivi.id}`);
      bilan.reportes++;
      continue;
    }
    // Un message déjà posté reste dans son salon et sa langue (le salon de la team a pu changer de canal depuis).
    const canal = ligne.canal ?? c.canal;
    if (commence && canal !== c.canal) {
      await arreter('Salon Discord changé depuis l’annonce : message non modifiable', { journal: false });
      continue;
    }
    const langue = lireLangue(ligne.langue) ?? c.langue;
    const bilingue = ligne.canal ? Number(ligne.fil) === 1 : c.bilingue;
    const teamId = await teamDeCarte(base, carte);
    const team = teamId ? await base.premier('SELECT nom FROM teams WHERE id = ?', [teamId]) : null;
    const urlPost = ligne.url_post;
    const donnees = { reseau: ligne.reseau, identifiant: compte.identifiant, url: urlPost, titre: carte.titre, team: team?.nom ?? '' };
    const charge = (l, { image, mentions }) =>
      chargeAnnonce({
        reseau: ligne.reseau,
        variables: variablesAnnonce(donnees, l),
        modele: (l === 'fr' ? compte.modele_fr : compte.modele_en) || modeleDefaut(l),
        langue: l,
        roleId: mentions ? compte.role_mention : null,
        image,
        urlProfil: compte.url,
        lienApp,
        maintenant: t,
      });
    const sansNom = x => {
      if (canal !== 'bot') return x;
      const { username: _u, ...reste } = x;
      return reste;
    };
    const salonBot = c.salonId;

    // ---- Édition (adresse du post changée) : message principal et version française rééditées, sans mention.
    if (ligne.operation === 'editer' && commence) {
      const image = ligne.image_url ? { url: ligne.image_url } : null;
      const imageLien = image ?? (await visuelDeCarte(base, null, carte));
      const corpsEdition = l => {
        const x = charge(l, { image: imageLien?.url ? { url: imageLien.url } : null, mentions: false });
        return { embeds: x.embeds, components: x.components ?? [], allowed_mentions: { parse: [] } };
      };
      const urlEdition = (messageId, fil) =>
        canal === 'bot' ? `${API_DISCORD}/channels/${fil ?? ligne.message_salon_id ?? salonBot}/messages/${messageId}` : avecParams(`${c.url}/messages/${messageId}`, fil ? { thread_id: fil } : {});
      const r = await appelerDiscord(fetchDiscord, urlEdition(ligne.message_id, Number(ligne.forum) === 1 ? ligne.fil_id : null), corpsEdition(langue), { methode: 'PATCH', jetonBot: canal === 'bot' ? jetonBot : undefined });
      if (!r.ok) {
        if (r.statut === 404) {
          await abandonner(ligne, 'Annonce supprimée dans Discord : rien à modifier', { journal: false });
          continue;
        }
        await echouer(ligne, r, c, { edition: true });
        continue;
      }
      if (ligne.fr_message_id && ligne.fil_id) {
        // Au mieux : un échec de la version française n'annule pas l'édition anglaise.
        await appelerDiscord(fetchDiscord, urlEdition(ligne.fr_message_id, ligne.fil_id), corpsEdition('fr'), { methode: 'PATCH', jetonBot: canal === 'bot' ? jetonBot : undefined });
      }
      await suiviOk(c);
      await terminer(ligne, { urlAnnoncee: urlPost });
      continue;
    }

    // ---- Publication : étape 1, le message principal (mentions, visuel joint).
    let messageId = ligne.message_id ?? null;
    let salonMessage = ligne.message_salon_id ?? null;
    let filId = ligne.fil_id ?? null;
    let imageUrl = ligne.image_url ?? null;
    let urlAnnoncee = ligne.url_annoncee ?? null;
    if (!messageId) {
      const visuel = await visuelDeCarte(base, stockage, carte);
      const image = visuel?.fichier ? { piece: visuel.fichier.nom } : visuel?.url ? { url: visuel.url } : null;
      const principale = sansNom(charge(langue, { image, mentions: true }));
      const options = { lireCorps: true, ...(visuel?.fichier ? { fichiers: [visuel.fichier] } : {}) };
      let r = canal === 'bot'
        ? await appelerDiscord(fetchDiscord, `${API_DISCORD}/channels/${salonBot}/messages`, { ...principale, ...(await nonceEnvoi(`rs:${ligne.id}`, 'en')) }, { ...options, jetonBot })
        : await appelerDiscord(fetchDiscord, avecParams(c.url, { wait: 'true' }), principale, options);
      let forum = false;
      if (canal === 'webhook' && r.statut === 400 && r.code === 220001) {
        // Salon forum : le message ouvre un post (titre de l'embed) ; la version française y répondra.
        r = await appelerDiscord(fetchDiscord, avecParams(c.url, { wait: 'true' }), { ...principale, thread_name: nomPost(principale) }, options);
        forum = r.ok;
      }
      if (!r.ok) {
        await echouer(ligne, r, c);
        continue;
      }
      await suiviOk(c);
      messageId = r.messageId;
      salonMessage = r.salonId ?? (canal === 'bot' ? salonBot : null);
      imageUrl = r.imageUrl ?? (visuel?.url ?? null);
      urlAnnoncee = urlPost;
      if (forum) filId = r.salonId ?? messageId;
      await majLigne(ligne.id, { message_id: messageId, message_salon_id: salonMessage, fil_id: filId, image_url: imageUrl, url_annoncee: urlAnnoncee, canal: c.canal, langue, fil: bilingue ? 1 : 0, forum: forum ? 1 : 0 });
      Object.assign(ligne, { message_id: messageId, canal: c.canal, langue, fil: bilingue ? 1 : 0, url_annoncee: urlAnnoncee });
      if (!messageId) {
        await terminer(ligne, { erreur: bilingue ? 'Version française non publiée : identifiant du message absent' : null, urlAnnoncee });
        continue;
      }
    }
    if (!bilingue) {
      await terminer(ligne, { urlAnnoncee });
      continue;
    }

    // ---- Étape 2 : le fil, créé par le bot sur le message principal.
    const fr = sansNom(charge('fr', { image: imageUrl ? { url: imageUrl } : null, mentions: false }));
    if (!filId) {
      if (!jetonBot || !salonMessage) {
        await filImpossible(ligne, c, { motif: jetonBot ? 'acces' : 'bot_absent', salonId: salonMessage });
        continue;
      }
      const r = await appelerDiscord(fetchDiscord, `${API_DISCORD}/channels/${salonMessage}/messages/${messageId}/threads`, { name: nomFil(fr), auto_archive_duration: ARCHIVAGE_FIL_MIN }, { jetonBot, lireCorps: true });
      if (r.ok || r.code === 160004) {
        filId = (r.ok && r.messageId) || messageId;
        await majLigne(ligne.id, { fil_id: filId });
      } else if (r.definitif) {
        await filImpossible(ligne, c, { motif: motifRefusFil(r, 'creer'), statut: r.statut, salonId: salonMessage });
        continue;
      } else {
        await echouer(ligne, r, c, { apresMax: () => terminer(ligne, { erreur: `Version française non publiée : ${r.motif}`, urlAnnoncee }) });
        continue;
      }
    }

    // ---- Étape 3 : la version française dans le fil (aucune mention).
    const r = canal === 'bot'
      ? await appelerDiscord(fetchDiscord, `${API_DISCORD}/channels/${filId}/messages`, { ...fr, ...(await nonceEnvoi(`rs:${ligne.id}`, 'fr')) }, { jetonBot, lireCorps: true })
      : await appelerDiscord(fetchDiscord, avecParams(c.url, { wait: 'true', thread_id: filId }), fr, { lireCorps: true });
    if (r.ok) {
      await majLigne(ligne.id, { fr_message_id: r.messageId ?? null });
      await terminer(ligne, { urlAnnoncee });
      continue;
    }
    if (r.definitif) {
      await filImpossible(ligne, c, { motif: motifRefusFil(r, 'ecrire'), statut: r.statut, salonId: salonMessage });
      continue;
    }
    await echouer(ligne, r, c, { apresMax: () => terminer(ligne, { erreur: `Version française non publiée : ${r.motif}`, urlAnnoncee }) });
  }

  // Ménage : seulement les annonces abandonnées AVANT d'avoir posté quoi que ce soit (une ligne qui a posté reste :
  // c'est elle qui empêche de reposter le même post).
  await base.executer("DELETE FROM cm_rs_annonces WHERE statut = 'abandonne' AND message_id IS NULL AND maj_le < ?", [iso(t - CONSERVATION_MS)]);
  return bilan;
}

/**
 * Message de TEST d'un compte vers chacun de ses salons (envoi immédiat, sans file, sans mention ni fil) :
 * `[{ cible, ok, motif? }]`. Exemple de post : titre d'exemple, adresse du profil du compte.
 */
export async function envoyerTest(base, compte, cibles, { cle, fetch: fetchDiscord = (...a) => globalThis.fetch(...a), jetonBot, lienApp = '', maintenant = Date.now() }) {
  const sortie = [];
  for (const cb of cibles) {
    const c = await resoudreCible(base, { cible: cb.cle, teamId: cb.team_id, salonId: cb.salon_id }, { cle, jetonBot });
    if (c.abandon) {
      sortie.push({ cible: cb.cle, ok: false, motif: c.abandon });
      continue;
    }
    const langue = c.langue;
    const donnees = { reseau: compte.reseau, identifiant: compte.identifiant, url: compte.url, titre: T(langue, 'reseaux.test_exemple'), team: compte.team_nom ?? '' };
    let charge = chargeAnnonce({ reseau: compte.reseau, variables: variablesAnnonce(donnees, langue), modele: (langue === 'fr' ? compte.modele_fr : compte.modele_en) || modeleDefaut(langue), langue, urlProfil: compte.url, lienApp, maintenant, test: true });
    if (c.canal === 'bot') {
      const { username: _u, ...reste } = charge;
      charge = reste;
    }
    const r = c.canal === 'bot' ? await appelerDiscord(fetchDiscord, `${API_DISCORD}/channels/${c.salonId}/messages`, charge, { jetonBot }) : await appelerDiscord(fetchDiscord, c.url, charge);
    if (c.suivi.table === 'cm_rs_salons') {
      await base.executer(r.ok ? 'UPDATE cm_rs_salons SET dernier_test_le = ?, dernier_succes_le = ? WHERE id = ?' : 'UPDATE cm_rs_salons SET dernier_test_le = ?, dernier_echec_le = ? WHERE id = ?', [iso(maintenant), iso(maintenant), c.suivi.id]);
    }
    sortie.push({ cible: cb.cle, ok: r.ok, ...(r.ok ? {} : { motif: r.motif }) });
  }
  return sortie;
}
