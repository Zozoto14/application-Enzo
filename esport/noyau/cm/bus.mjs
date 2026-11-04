/**
 * Événements de domaine de la section CM et leur abonné « notifications in-app ». Le journal reçoit déjà
 * tout événement (abonneJournal : actions `cm.*`, module « CM » des filtres du journal de la team pour une
 * portée de team ; journal de la section pour le club). `cm.post_publie` et `cm.post_adresses` sont consommés
 * par la page Réseaux (reseaux/annonces.mjs : annonce Discord, publications suivies pour les statistiques).
 *
 * Notifications : membres assignés à une carte, personnes @mentionnées dans un commentaire, personnes concernées par un
 * passage d'une carte en urgent / critique (assignées, suiveurs, responsables CM : `cm-urgence`, migration 0047), créateur et suiveurs d'une carte
 * terminée (déposée dans une colonne de fin : `cm-carte-terminee`, migration 0050), personnes concernées par un
 * nouveau commentaire (assignées, auteur de la carte, suiveurs : `cm-commentaire`, migration 0045), valideurs
 * (post soumis, ou repassé « à valider » après une modification), auteur du post (validé, refusé), CM
 * (dépôt d'une team, clip proposé), proposeur d'un clip (décision), compte affecté à un rôle CM, gestionnaires
 * du Drive (espace utilisé à 80 %), personnes avec qui une ressource de DATA › Ressources est partagée (`cm-lien-partage`,
 * migration 0048). Réunions de l'équipe CM : invités (créée, modifiée, annulée), organisateur
 * (réponse, rendez-vous réservé), participants (rappel) ; rappel et annulation partent aussi en MP Discord du bot
 * (file `cm_reunion_mp`, reunions/rappels.mjs). Le centre de notifications consomme ces événements tels quels.
 *
 * Ce fichier n'importe pas evenements.mjs (c'est lui qui nous importe).
 */

import { comptesClubAvec, comptesTeamAvec } from './commun.mjs';
import { estRestreint, niveauxTableau } from './acces.mjs';
import { niveauLien } from './liensAcces.mjs';
import { mettreMpEnFile } from './reunions/mp.mjs';

export const TYPES_CM = [
  'cm.tableau_cree',
  'cm.tableau_modifie',
  'cm.tableau_supprime',
  // Accès au tableau changé (migration 0046) : « tous » ou « restreint » (jamais la liste des personnes dans la charge).
  'cm.tableau_acces',
  'cm.etiquette_modifiee',
  'cm.etiquette_supprimee',
  'cm.etiquette_fusionnee',
  'cm.carte_creee',
  'cm.carte_assignee',
  // Carte passée en « urgent » ou « critique » (migration 0047) : charge { titre, tableau, niveau, concernes }.
  'cm.carte_urgence',
  // Carte déposée dans une colonne de fin / sortie d'une colonne de fin (migration 0050) : charge { titre, tableau, liste, cle, concernes }
  // (concernes : créateur et suiveurs, seulement pour « terminée »). `cm.liste_fin` : une colonne devient (ou cesse d'être) colonne de fin.
  'cm.carte_terminee',
  'cm.carte_rouverte',
  'cm.liste_fin',
  'cm.carte_supprimee',
  'cm.commentaire_ajoute',
  'cm.depot',
  'cm.post_soumis',
  'cm.post_valide',
  'cm.post_refuse',
  'cm.post_invalide',
  'cm.post_publie',
  // Adresse ajoutée ou changée sur un post déjà publié (migration 0026 : l'annonce Discord est rééditée).
  'cm.post_adresses',
  'cm.clip_propose',
  'cm.clip_decide',
  'cm.import_trello',
  'cm.role_cree',
  'cm.role_modifie',
  'cm.role_supprime',
  'cm.affectation_ajoutee',
  'cm.affectation_retiree',
  'cm.reglages_modifies',
  'cm.charte_modifiee',
  'cm.modele_cree',
  'cm.modele_modifie',
  'cm.modele_supprime',
  'cm.visuel_genere',
  // Drive (migration 0027).
  'cm.drive_fichier_ajoute',
  'cm.drive_fichier_modifie',
  'cm.drive_version_ajoutee',
  'cm.drive_dossier_cree',
  'cm.drive_dossier_modifie',
  'cm.drive_corbeille',
  'cm.drive_restaure',
  'cm.drive_supprime',
  'cm.drive_corbeille_videe',
  'cm.drive_quota',
  // Étiquettes (tags) des fichiers du Drive : renommées ou supprimées d'un coup pour toute la portée.
  'cm.drive_tag_renomme',
  'cm.drive_tag_supprime',
  // Réunions de l'équipe CM (migration 0039, docs/esport/cm-reunions.md) : SANS team, JAMAIS de notes dans la charge.
  'cm.reunion_creee',
  'cm.reunion_modifiee',
  'cm.reunion_annulee',
  'cm.reunion_reponse',
  'cm.reunion_rappel',
  'cm.rdv_reserve',
  // Liens utiles de DATA › Ressources (migration 0045) : charge { titre, hote, portee } (+ { genre } d'une liaison, { epingle }).
  'cm.lien_cree',
  'cm.lien_modifie',
  'cm.lien_supprime',
  'cm.lien_lie',
  'cm.lien_delie',
  // Qui voit la ressource (migration 0048) : réglage changé (charge { acces, regles: nombre }, jamais les personnes) ;
  // « Partager avec… » ou personnes nommées : charge { titre, hote, comptes } → notification `cm-lien-partage`.
  'cm.lien_acces',
  'cm.lien_partage',
  // Fichier d'une ressource remplacé (migration 0051) : charge { titre, hote: '', portee, genre: 'fichier', version }.
  'cm.lien_version',
  // Ajout dans le Drive (migration 0041), pour le centre de notifications : un fichier ou un dossier ajouté, une
  // nouvelle version. Charge : { portee, dossierId, element: 'fichier' | 'dossier', type: 'fichier' | 'dossier' |
  // 'version', genre: 'ajout' | 'copie' | 'version' | 'rangement', nom, version, auteur }. Le destinataire doit VOIR l'élément : drive.destinatairesAjout(ev)
  // (service du Drive) donne les comptes concernés, l'auteur exclu. Hors du journal (cm.drive_* y est déjà).
  'drive.ajout',
];

/** Événements du bus qui ne vont pas au journal d'activité (signaux pour d'autres abonnés, déjà journalisés). */
export const TYPES_HORS_JOURNAL = ['drive.ajout'];

async function notifier(base, ev, compte, type, charge) {
  // Carte concernée (migration 0046) : la notification se masque dès que le destinataire ne voit plus son tableau.
  const carte = ev.entite_type === 'cm_carte' ? (ev.entite_id ?? null) : null;
  // Ressource concernée (migration 0048) : idem, dès qu'il ne voit plus la ressource restreinte.
  const lien = ev.entite_type === 'cm_lien' ? (ev.entite_id ?? null) : null;
  await base.executer(
    'INSERT INTO notifications (id, compte_id, team_id, type, charge, cree_le, cm_carte_id, cm_lien_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
    [`${ev.id}:${compte}`, compte, ev.team_id, type, JSON.stringify(charge), ev.cree_le, carte, lien],
  );
}

/**
 * Tableau RESTREINT d'une carte (migration 0046) : seuls ceux qui le voient sont prévenus (le Fondateur toujours).
 * Rend un filtre de comptes (l'identité si la carte est dans un tableau ouvert, ou introuvable : rien à masquer).
 */
async function filtreTableau(base, ev) {
  if (ev.entite_type !== 'cm_carte' || !ev.entite_id) return () => true;
  const tb = await base.premier('SELECT t.id, t.portee, t.team_id, t.acces FROM cm_cartes c JOIN cm_tableaux t ON t.id = c.tableau_id WHERE c.id = ?', [ev.entite_id]);
  if (!estRestreint(tb)) return () => true;
  const niveaux = await niveauxTableau(base, tb);
  return compte => compte === 'principal' || niveaux.has(compte);
}

/** Valideurs d'un tableau : niveau club, ou club + affectations de la team pour un tableau de team. */
const valideurs = (base, ev, charge) => (charge.portee && charge.portee !== 'club' ? comptesTeamAvec(base, charge.portee, 'cm.valider') : comptesClubAvec(base, 'cm.valider'));

export async function abonneCm(base, ev) {
  if (!TYPES_CM.includes(ev.type)) return;
  let charge = {};
  try {
    charge = JSON.parse(ev.charge ?? '{}');
  } catch {
    charge = {};
  }
  const carte = ev.entite_id;
  const voitTableau = await filtreTableau(base, ev);
  const envoyer = async (comptes, type, donnees) => {
    for (const compte of new Set(comptes)) if (compte && compte !== ev.acteur_id && voitTableau(compte)) await notifier(base, ev, compte, type, donnees);
  };
  switch (ev.type) {
    case 'cm.carte_assignee':
      return envoyer(charge.comptes ?? [], 'cm-assigne', { titre: charge.titre ?? null, carte, tableau: charge.tableau ?? null, membre: ev.acteur_id });
    case 'cm.carte_urgence':
      // `concernes` : déjà filtrés par le service (assignés, suiveurs, responsables CM pour « critique »; accès au tableau).
      return envoyer(charge.concernes ?? [], 'cm-urgence', { titre: charge.titre ?? null, carte, tableau: charge.tableau ?? null, niveau: charge.niveau ?? null, membre: ev.acteur_id });
    case 'cm.carte_terminee': {
      // Créateur et suiveurs (déjà filtrés par le service : accès au tableau, auteur du dépôt exclu). Une seule notification
      // non lue par carte et par personne : déplacer une carte d'avant en arrière ne spamme pas. Rien pour « rouverte ».
      for (const compte of new Set(charge.concernes ?? [])) {
        if (!compte || compte === ev.acteur_id || !voitTableau(compte)) continue;
        const deja = (await base.tous("SELECT charge FROM notifications WHERE compte_id = ? AND type = 'cm-carte-terminee' AND lue_le IS NULL", [compte])).some(l => {
          try {
            return JSON.parse(l.charge).carte === carte;
          } catch {
            return false;
          }
        });
        if (!deja) await notifier(base, ev, compte, 'cm-carte-terminee', { titre: charge.titre ?? null, carte, tableau: charge.tableau ?? null, liste: charge.liste ?? null, cle: charge.cle ?? null, membre: ev.acteur_id });
      }
      return;
    }
    case 'cm.commentaire_ajoute': {
      const donnees = { titre: charge.titre ?? null, carte, tableau: charge.tableau ?? null, membre: ev.acteur_id };
      await envoyer(charge.mentions ?? [], 'cm-mention', donnees);
      // Personnes concernées (assignées, auteur de la carte, suiveurs ; migration 0045) : une seule notification non lue
      // par carte et par personne (pas de rafale quand la conversation s'anime).
      for (const compte of new Set(charge.concernes ?? [])) {
        // Tableau restreint (migration 0046) : un suiveur ou un assigné qui ne le voit plus n'est pas prévenu.
        if (!compte || compte === ev.acteur_id || (charge.mentions ?? []).includes(compte) || !voitTableau(compte)) continue;
        const deja = (await base.tous("SELECT charge FROM notifications WHERE compte_id = ? AND type = 'cm-commentaire' AND lue_le IS NULL", [compte])).some(l => {
          try {
            return JSON.parse(l.charge).carte === carte;
          } catch {
            return false;
          }
        });
        if (!deja) await notifier(base, ev, compte, 'cm-commentaire', donnees);
      }
      return;
    }
    case 'cm.post_soumis':
    case 'cm.post_invalide':
      return envoyer([...(await valideurs(base, ev, charge))], 'cm-a-valider', { titre: charge.titre ?? null, carte, tableau: charge.tableau ?? null, invalide: ev.type === 'cm.post_invalide', membre: ev.acteur_id });
    case 'cm.post_valide':
    case 'cm.post_refuse': {
      const membres = (await base.tous('SELECT compte_id FROM cm_carte_membres WHERE carte_id = ?', [carte])).map(l => l.compte_id);
      return envoyer([charge.soumisPar, ...membres], ev.type === 'cm.post_valide' ? 'cm-valide' : 'cm-refuse', { titre: charge.titre ?? null, carte, tableau: charge.tableau ?? null, motif: charge.motif ?? null, membre: ev.acteur_id });
    }
    case 'cm.depot':
      return envoyer([...(await comptesClubAvec(base, 'cm.editer'))], 'cm-depot', { titre: charge.titre ?? null, genre: charge.genre ?? null, carte, tableau: charge.tableau ?? null, membre: ev.acteur_id });
    case 'cm.clip_propose':
      if (!ev.team_id) return;
      return envoyer([...(await comptesTeamAvec(base, ev.team_id, 'cm.editer'))], 'cm-clip-propose', { titre: charge.titre ?? null, clip: ev.entite_id, membre: ev.acteur_id });
    case 'cm.clip_decide':
      return envoyer([charge.proposePar], 'cm-clip-decide', { titre: charge.titre ?? null, statut: charge.statut ?? null, motif: charge.motif ?? null, clip: ev.entite_id });
    case 'cm.affectation_ajoutee':
      return envoyer([charge.compte], 'cm-affecte', { role: charge.role ?? null, portee: charge.portee ?? null });
    case 'cm.reunion_creee':
      return envoyer(charge.participants ?? [], 'cm-reunion-invite', { titre: charge.titre ?? null, reunion: ev.entite_id, debut: charge.debut ?? null, fuseau: charge.fuseau ?? null, membre: ev.acteur_id, genre: charge.genre ?? 'reunion' });
    case 'cm.reunion_modifiee':
      return envoyer(charge.participants ?? [], 'cm-reunion-modifiee', { titre: charge.titre ?? null, reunion: ev.entite_id, debut: charge.debut ?? null, fuseau: charge.fuseau ?? null, membre: ev.acteur_id, changements: charge.changements ?? [] });
    case 'cm.reunion_annulee': {
      const donnees = { titre: charge.titre ?? null, reunion: ev.entite_id, debut: charge.occurrence ?? charge.debut ?? null, fuseau: charge.fuseau ?? null, membre: ev.acteur_id, motif: charge.motif ?? null, serie: charge.serie !== false };
      await envoyer(charge.participants ?? [], 'cm-reunion-annulee', donnees);
      return mettreMpEnFile(base, ev, (charge.participants ?? []).filter(c => c && c !== ev.acteur_id), 'annulee', charge.occurrence ?? null);
    }
    case 'cm.reunion_reponse':
      return envoyer([charge.organisateur], 'cm-reunion-reponse', { titre: charge.titre ?? null, reunion: ev.entite_id, reponse: charge.reponse ?? null, membre: ev.acteur_id, proposition: charge.proposition ?? null });
    case 'cm.rdv_reserve':
      return envoyer([charge.proprietaire], 'cm-rdv-reserve', { titre: charge.titre ?? null, debut: charge.debut ?? null, fuseau: charge.fuseau ?? null, membre: ev.acteur_id });
    case 'cm.reunion_rappel': {
      if (!charge.compte) return;
      await notifier(base, ev, charge.compte, 'cm-reunion-rappel', { titre: charge.titre ?? null, reunion: ev.entite_id, debut: charge.debut ?? null, fuseau: charge.fuseau ?? null, minutes: charge.minutes ?? null });
      return mettreMpEnFile(base, ev, [charge.compte], 'rappel', charge.occurrence ?? null);
    }
    case 'cm.lien_partage': {
      // Seulement à qui voit (encore) la ressource : relue ici, l'accès a pu être retiré entre-temps.
      const l = ev.entite_id ? await base.premier('SELECT id, team_id, acces, cree_par, titre FROM cm_liens WHERE id = ?', [ev.entite_id]) : null;
      if (!l) return;
      for (const compte of new Set(charge.comptes ?? [])) {
        if (!compte || compte === ev.acteur_id) continue;
        if (await niveauLien(base, { compte, superAdmin: compte === 'principal' }, l)) await notifier(base, ev, compte, 'cm-lien-partage', { titre: l.titre, lien: l.id, membre: ev.acteur_id });
      }
      return;
    }
    case 'cm.drive_quota':
      // Drive plein à 80 % (au plus une fois par semaine) : ceux qui gèrent le Drive du club.
      return envoyer([...(await comptesClubAvec(base, 'cm.drive.gerer'))], 'cm-drive-quota', { pourcent: charge.pourcent ?? null, utilise: charge.utilise ?? null, limite: charge.limite ?? null });
    default:
      return;
  }
}
