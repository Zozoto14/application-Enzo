/**
 * Cibles des notifications (migration 0076, docs/esport/notifications.md « Liens directs ») : l'endroit EXACT où mène
 * une notification (le ticket et son message, la carte CM et son commentaire, le fichier du Drive, l'événement du
 * planning à sa date…), dans un format STABLE et VERSIONNÉ : `{ v: 1, g: <genre>, ...identifiants }`, jamais une
 * adresse. L'app le traduit en écran (src/esport/notifications/cibles.ts) ; une notification sans cible (ancienne,
 * ou dont la section est déjà le bon endroit) garde son lien de section (`lien`, regles.mjs).
 *
 * Trois usages :
 *  - à la création : `cibleEvenement(ev)` (fil du centre) et `ciblePersonnelle(type, charge, teamId, ev)` (notification
 *    personnelle), enregistrées avec la notification (colonne `cible`) ;
 *  - au clic : `verifierCible(base, acteur, cible)` relit l'élément (existe-t-il encore ? le lecteur y a-t-il encore
 *    accès ?) et rend `{ etat: 'ok' | 'supprime' | 'interdit', cible }`, la cible complétée de ce qu'il faut pour
 *    l'ouvrir (tableau d'une carte, dossier d'un fichier, team et date d'un événement…) ;
 *  - dans les messages Discord : `lienProfond(lienApp, cible)` donne l'adresse partageable de l'app
 *    (`<site>#/app/esport/c/<genre>?id=…`), la même que celle de l'app.
 *
 * AJOUTER UN TYPE (événement du bus ou notification personnelle) : le ranger dans `CIBLES_EVENEMENTS` ou
 * `CIBLES_PERSONNELLES` sous son genre (ou `section` : sa section est déjà le bon endroit ; `aucune` : jamais
 * affiché). Le test esport/test/notifications-cibles.test.mjs échoue tant qu'un type n'est pas rangé.
 */

import { droitsLecteur, voit } from './droits.mjs';
import { regleDe, sousDossierRestreint } from './regles.mjs';
import { jsonOu } from '../outils.mjs';
import { droitsTickets, gereAvis, voitCategorie } from '../tickets/acces.mjs';
import { ZONES_ALERTE } from './alertes.mjs';

export const VERSION_CIBLE = 1;

/** Genres de cibles (version 1). L'app a la même liste (src/esport/notifications/cibles.ts : GENRES_CIBLES). */
export const GENRES_CIBLES = Object.freeze([
  'ticket',
  'carte_cm',
  'clip_cm',
  'lien_cm',
  'drive',
  'reunion_cm',
  'evenement',
  'tache',
  'objectif',
  'reunion',
  'strat',
  'playbook',
  'lineup',
  'review',
  'ressource',
  'adversaire',
  'tournoi',
  'resultat',
  'membre',
  'demande_compte',
  'sponsor',
  'jeu',
  'devblog',
  'avis_ticket',
  'salon_match',
  'alerte_discord',
]);

/** Identifiants permis par genre (les autres clés sont ignorées : rien d'autre ne voyage dans une cible). */
export const CHAMPS_CIBLES = Object.freeze({
  ticket: ['ticket', 'message'],
  carte_cm: ['carte', 'commentaire', 'tableau'],
  clip_cm: ['clip'],
  lien_cm: ['lien'],
  drive: ['fichier', 'dossier', 'portee'],
  reunion_cm: ['reunion', 'debut'],
  evenement: ['evenement', 'occurrence', 'team'],
  tache: ['tache', 'team'],
  objectif: ['objectif', 'team'],
  reunion: ['reunion', 'team'],
  strat: ['strat', 'team'],
  playbook: ['entree', 'team'],
  lineup: ['lineup', 'team'],
  review: ['review', 'repere', 'team'],
  ressource: ['ressource', 'team'],
  adversaire: ['adversaire', 'team'],
  tournoi: ['tournoi', 'team'],
  resultat: ['resultat', 'team'],
  membre: ['compte', 'team'],
  demande_compte: ['demande'],
  sponsor: ['prospect', 'partenaire'],
  jeu: ['jeu'],
  devblog: ['entree', 'brouillon'],
  avis_ticket: ['ticket'],
  salon_match: ['evenement', 'match'],
  alerte_discord: ['zone', 'evenement', 'team'],
});

/** Champ OBLIGATOIRE de chaque genre (sans lui, pas de cible : le lien de section reste). */
const PRINCIPAL = Object.freeze({
  ticket: 'ticket',
  carte_cm: 'carte',
  clip_cm: 'clip',
  lien_cm: 'lien',
  drive: null,
  reunion_cm: 'reunion',
  evenement: 'evenement',
  tache: 'tache',
  objectif: 'objectif',
  reunion: 'reunion',
  strat: 'strat',
  playbook: 'entree',
  lineup: 'lineup',
  review: 'review',
  ressource: 'ressource',
  adversaire: 'adversaire',
  tournoi: 'tournoi',
  resultat: 'resultat',
  membre: 'compte',
  demande_compte: 'demande',
  sponsor: null,
  jeu: 'jeu',
  devblog: null,
  avis_ticket: 'ticket',
  salon_match: 'evenement',
  alerte_discord: 'zone',
});

const MOTIF_ID = /^[A-Za-z0-9:._@-]{1,200}$/;

/** Cible propre (genre connu, identifiants courts et lisibles, champ principal présent), sinon `null`. */
export function normaliserCible(brute) {
  const c = typeof brute === 'string' ? jsonOu(brute, null) : brute;
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
  if (Number(c.v) !== VERSION_CIBLE || !GENRES_CIBLES.includes(c.g)) return null;
  const sortie = { v: VERSION_CIBLE, g: c.g };
  for (const k of CHAMPS_CIBLES[c.g]) {
    const v = c[k];
    if (typeof v === 'number' && Number.isFinite(v)) sortie[k] = String(v);
    else if (typeof v === 'string' && MOTIF_ID.test(v)) sortie[k] = v;
  }
  const principal = PRINCIPAL[c.g];
  if (principal && !sortie[principal]) return null;
  if (c.g === 'drive' && !sortie.fichier && !sortie.dossier) return null;
  if (c.g === 'sponsor' && !sortie.prospect && !sortie.partenaire) return null;
  if (c.g === 'alerte_discord') {
    // Zone connue ; l'événement (rôles d'un événement) et la team (rôles temporaires) sont obligatoires pour leur zone.
    if (!ZONES_ALERTE.includes(sortie.zone)) return null;
    if (sortie.zone === 'evenement' && !sortie.evenement) return null;
    if (sortie.zone === 'role_temp' && !sortie.team) return null;
  }
  return sortie;
}

const cible = (g, ids) => normaliserCible({ v: VERSION_CIBLE, g, ...ids });

// ------------------------------------------------------------------ Événements du bus (fil du centre)

/** Identifiant de l'entité si elle est de l'un des types donnés. */
const ent = (ev, ...types) => (ev.entiteId && types.includes(ev.entiteType) ? ev.entiteId : undefined);

/** Construction de la cible d'un événement, par genre. `ev` : { type, team, entiteType, entiteId, charge }. */
const DEPUIS_EVENEMENT = {
  ticket: ev => ({ ticket: ent(ev, 'ticket') ?? ev.charge.ticket }),
  carte_cm: ev => ({ carte: ent(ev, 'cm_carte') ?? ev.charge.carte, commentaire: ev.charge.commentaireId, tableau: ev.charge.tableau }),
  clip_cm: ev => ({ clip: ent(ev, 'cm_clip') ?? ev.charge.clip }),
  lien_cm: ev => ({ lien: ent(ev, 'cm_lien') ?? ev.charge.lien }),
  drive: ev => {
    const fichier = ent(ev, 'cm_drive');
    const dossier = ent(ev, 'cm_drive_dossier') ?? (fichier ? undefined : ev.charge.dossierId);
    return { fichier, dossier, portee: ev.charge.portee };
  },
  reunion_cm: ev => ({ reunion: ent(ev, 'cm_reunion') ?? ev.charge.reunion, debut: ev.charge.occurrence ?? ev.charge.debut }),
  evenement: ev => ({ evenement: ent(ev, 'evenement') ?? ev.charge.evenementId ?? ev.charge.evenement, occurrence: ev.charge.occurrence, team: ev.team }),
  tache: ev => ({ tache: ent(ev, 'tache'), team: ev.team }),
  objectif: ev => ({ objectif: ent(ev, 'objectif'), team: ev.team }),
  reunion: ev => ({ reunion: ent(ev, 'reunion') ?? ev.charge.reunion, team: ev.team }),
  strat: ev => ({ strat: ent(ev, 'strat'), team: ev.team }),
  playbook: ev => ({ entree: ent(ev, 'playbook'), team: ev.team }),
  lineup: ev => ({ lineup: ent(ev, 'lineup'), team: ev.team }),
  review: ev => ({ review: ent(ev, 'review') ?? ev.charge.reviewId, repere: ent(ev, 'repere') ?? ev.charge.repereId, team: ev.team }),
  ressource: ev => ({ ressource: ent(ev, 'ressource') ?? ev.charge.ressource, team: ev.team }),
  adversaire: ev => ({ adversaire: ent(ev, 'adversaire'), team: ev.team }),
  tournoi: ev => ({ tournoi: ent(ev, 'tournoi') ?? ev.charge.tournoiId ?? ev.charge.tournoi, team: ev.team }),
  resultat: ev => ({ resultat: ent(ev, 'resultat'), team: ev.team }),
  membre: ev => ({ compte: ev.charge.compte ?? (ev.type === 'member.joined' ? ev.acteur : undefined), team: ev.team }),
  demande_compte: ev => ({ demande: ent(ev, 'demande') }),
  sponsor: ev => {
    const genre = ev.charge.genre;
    const prospect = ent(ev, 'sp_prospect', 'prospect') ?? (genre === 'prospect' ? ev.entiteId : undefined);
    const partenaire = ent(ev, 'sp_partenaire', 'partenaire') ?? (genre === 'partenaire' ? ev.entiteId : undefined) ?? ev.charge.partenaire;
    return prospect ? { prospect } : { partenaire };
  },
  jeu: ev => ({ jeu: ent(ev, 'jeu') }),
  devblog: ev => ({ entree: ent(ev, 'devblog') }),
};

/**
 * Chaque type d'événement du bus, rangé sous son genre de cible. `section` : la section (lien de la règle) est déjà
 * le bon endroit (réglages, élément supprimé…) ; `aucune` : jamais affiché (règle « aucun »).
 */
export const CIBLES_EVENEMENTS = Object.freeze({
  evenement: ['event.created', 'event.updated', 'event.occurrence_updated', 'event.occurrence_cancelled', 'event.reminder_d1', 'event.reminder_h1', 'event.starting', 'attendance.rsvp', 'attendance.marked', 'attendance.reminder', 'attendance.relance'],
  tache: ['task.created', 'task.updated', 'task.assigned', 'task.due_soon'],
  objectif: ['goal.created', 'goal.updated'],
  reunion: ['meeting.submitted', 'meeting.status_changed', 'meeting.summary_published', 'meeting.transcription_ready', 'meeting.transcription_updated', 'meeting.transcription_failed'],
  membre: ['member.joined', 'member.added', 'member.role_changed', 'member.status_changed', 'trombi.fiche_modifiee', 'trombi.photo_modifiee', 'trombi.photo_supprimee'],
  demande_compte: ['member.account_requested', 'member.account_request_validated', 'member.account_request_refused'],
  review: ['review.created', 'review.updated', 'review.marker_added', 'review.comment_added'],
  adversaire: ['opponent.created', 'opponent.updated', 'opponent.detail_changed'],
  strat: ['strat.created', 'strat.updated', 'strat.duplicated', 'strat.restored', 'strat.share_created', 'strat.share_revoked'],
  playbook: ['playbook.created', 'playbook.updated', 'playbook.validated', 'playbook.archived', 'playbook.restored'],
  lineup: ['lineup.created', 'lineup.updated', 'lineup.validated', 'lineup.restored', 'lineup.linked', 'lineup.unlinked'],
  ressource: ['resource.created', 'resource.proposed', 'resource.validated', 'resource.refused', 'resource.updated', 'resource.pinned', 'resource.commented'],
  tournoi: ['tournoi.cree', 'tournoi.modifie', 'tournoi.roster_change', 'tournoi.inscrit', 'tournoi.checkin', 'tournoi.statut_change', 'tournoi.termine', 'tournoi.annule', 'tournoi.match_ajoute', 'tournoi.match_planifie', 'tournoi.match_modifie', 'tournoi.match_supprime'],
  resultat: ['match.resultat_saisi', 'match.resultat_modifie'],
  carte_cm: ['cm.carte_creee', 'cm.carte_assignee', 'cm.carte_urgence', 'cm.carte_terminee', 'cm.carte_rouverte', 'cm.commentaire_ajoute', 'cm.depot', 'cm.post_soumis', 'cm.post_valide', 'cm.post_refuse', 'cm.post_invalide', 'cm.post_publie', 'cm.post_adresses'],
  clip_cm: ['cm.clip_propose', 'cm.clip_decide'],
  lien_cm: ['cm.lien_cree', 'cm.lien_modifie', 'cm.lien_lie', 'cm.lien_delie', 'cm.lien_acces', 'cm.lien_partage', 'cm.lien_version'],
  drive: ['cm.drive_fichier_ajoute', 'cm.drive_fichier_modifie', 'cm.drive_version_ajoutee', 'cm.drive_dossier_cree', 'cm.drive_dossier_modifie', 'cm.drive_restaure', 'drive.ajout'],
  reunion_cm: ['cm.reunion_creee', 'cm.reunion_modifiee', 'cm.reunion_annulee', 'cm.reunion_reponse', 'cm.reunion_rappel'],
  sponsor: ['sponsors.prospect_cree', 'sponsors.prospect_modifie', 'sponsors.prospect_deplace', 'sponsors.prospect_converti', 'sponsors.partenaire_cree', 'sponsors.partenaire_modifie', 'sponsors.contrat_enregistre', 'sponsors.obligation_enregistree', 'sponsors.obligation_suivie', 'sponsors.responsable', 'sponsors.rappel_action', 'sponsors.rappel_obligation', 'sponsors.rappel_contrat'],
  ticket: ['ticket.ouvert', 'ticket.pris', 'ticket.libere', 'ticket.assigne', 'ticket.priorite', 'ticket.categorie', 'ticket.statut', 'ticket.membre', 'ticket.renomme', 'ticket.ferme', 'ticket.rouvert', 'ticket.note', 'ticket.liaison', 'ticket.permanent', 'ticket.restaure', 'ticket.mention'],
  jeu: ['game.created', 'game.updated', 'game.updates_proposed'],
  devblog: ['devblog.publie'],
  section: [
    'team.created', 'team.updated', 'team.deleted', 'modules.changed', 'role.created', 'role.updated', 'role.deleted',
    'member.removed', 'member.left', 'invitation.created', 'invitation.revoked', 'invitation.refused',
    'meeting.deleted', 'meeting_type.created', 'meeting_type.updated', 'meeting_type.deleted',
    'goal.deleted', 'task.deleted', 'event.deleted', 'availability.settings_changed',
    'discord.webhook_set', 'discord.webhook_removed', 'discord.settings_changed', 'discord.test_sent', 'discord.delivery_failed', 'discord.delivery_abandoned', 'discord.server_linked', 'discord.server_unlinked', 'discord.pings_changed',
    'review.deleted', 'opponent.deleted', 'strat.deleted', 'playbook.deleted', 'lineup.deleted',
    'player_note.created', 'player_note.updated', 'player_note.shared', 'player_note.deleted',
    'resource.deleted', 'resource_category.created', 'resource_category.updated', 'resource_category.deleted', 'resource_category.reordered', 'resources.settings_changed',
    'tournoi.supprime', 'match.resultat_supprime',
    'cm.tableau_cree', 'cm.tableau_modifie', 'cm.tableau_supprime', 'cm.tableau_acces', 'cm.etiquette_modifiee', 'cm.etiquette_supprimee', 'cm.etiquette_fusionnee', 'cm.carte_supprimee',
    'cm.import_trello', 'cm.role_cree', 'cm.role_modifie', 'cm.role_supprime', 'cm.affectation_ajoutee', 'cm.affectation_retiree', 'cm.reglages_modifies',
    'cm.charte_modifiee', 'cm.modele_cree', 'cm.modele_modifie', 'cm.modele_supprime', 'cm.visuel_genere',
    'cm.drive_corbeille', 'cm.drive_supprime', 'cm.drive_corbeille_videe', 'cm.drive_quota', 'cm.drive_tag_renomme', 'cm.drive_tag_supprime',
    'cm.lien_supprime',
    'sponsors.etapes_modifiees', 'sponsors.prospect_supprime', 'sponsors.partenaire_supprime', 'sponsors.contrat_supprime', 'sponsors.obligation_supprimee', 'sponsors.import', 'sponsors.export', 'sponsors.rgpd_contact',
    'cm.reseau_compte_cree', 'cm.reseau_compte_modifie', 'cm.reseau_compte_supprime', 'cm.reseau_annonce_modifiee', 'cm.reseau_salon_ajoute', 'cm.reseau_salon_modifie', 'cm.reseau_salon_supprime',
    'cm.reseau_publication_ajoutee', 'cm.reseau_publication_modifiee', 'cm.reseau_publication_supprimee', 'cm.reseau_releve', 'cm.reseau_import', 'cm.reseau_export', 'cm.reseau_reglages', 'cm.reseau_rappel_releve',
    'trombi.badge_cree', 'trombi.badge_modifie', 'trombi.badge_supprime', 'trombi.badge_attribue', 'trombi.badge_retire',
    'game.archived', 'game.deleted', 'game.draft_ready', 'ia.confidentialite_changed',
    'roles.global_cree', 'roles.global_modifie', 'roles.global_supprime', 'roles.global_attribue', 'roles.global_retire', 'roles.modele_modifie',
    'tickets.config_modifiee', 'tickets.categorie_creee', 'tickets.categorie_modifiee', 'tickets.categorie_supprimee', 'tickets.panneau_publie', 'tickets.liste_noire', 'tickets.rgpd',
    'ticket.supprime', 'ticket.corbeille', 'ticket.purge',
  ],
  aucune: [
    'account.exported', 'account.deleted', 'media.deleted', 'availability.updated', 'ical.token_created', 'ical.token_revoked',
    'discord.test_mp', 'discord.account_linked', 'discord.account_unlinked', 'discord.command_used', 'discord.role_temp_given', 'discord.role_temp_removed',
    'review.marker_updated', 'review.marker_deleted', 'review.comment_deleted', 'review.reaction_changed',
    'resource.comment_deleted', 'resource.reaction_changed',
    'cm.liste_fin', 'cm.rdv_reserve',
    'alerte.salon_match', 'alerte.vocal', 'alerte.role_evenement', 'alerte.role_temp',
  ],
});

/** Genre de cible d'un type d'événement, `section`, `aucune`, ou `undefined` (type pas encore rangé). */
const GENRE_EVENEMENT = new Map(Object.entries(CIBLES_EVENEMENTS).flatMap(([g, types]) => types.map(t => [t, g])));
export const genreEvenement = type => GENRE_EVENEMENT.get(type);

/** Cible d'un événement du bus (ligne `evenements`), ou `null` (section, jamais affiché, type inconnu). */
export function cibleEvenement(ev) {
  const g = GENRE_EVENEMENT.get(ev?.type);
  if (!g || !DEPUIS_EVENEMENT[g]) return null;
  const charge = jsonOu(ev.charge, {}) ?? {};
  return cible(g, DEPUIS_EVENEMENT[g]({ type: ev.type, team: ev.team_id ?? undefined, acteur: ev.acteur_id ?? undefined, entiteType: ev.entite_type ?? null, entiteId: ev.entite_id ?? null, charge: typeof charge === 'object' ? charge : {} }));
}

// ------------------------------------------------------------------ Notifications personnelles

/** Construction de la cible d'une notification personnelle, par genre : `(charge, ligne)`. */
const DEPUIS_PERSONNELLE = {
  ticket: (c, l) => ({ ticket: c.ticket, message: c.message ?? (l.type === 'tk-message' ? messageDeTicket(l.id) : undefined) }),
  carte_cm: c => ({ carte: c.carte, commentaire: c.commentaireId, tableau: c.tableau }),
  clip_cm: c => ({ clip: c.clip }),
  lien_cm: c => ({ lien: c.lien }),
  reunion_cm: c => ({ reunion: c.reunion, debut: c.debut }),
  evenement: (c, l) => ({ evenement: c.evenementId, occurrence: c.occurrence, team: l.team_id ?? undefined }),
  tache: (c, l) => ({ tache: c.tache, team: l.team_id ?? undefined }),
  reunion: (c, l) => ({ reunion: c.reunion, team: l.team_id ?? undefined }),
  playbook: (c, l) => ({ entree: c.entree, team: l.team_id ?? undefined }),
  lineup: (c, l) => ({ lineup: c.lineup, team: l.team_id ?? undefined }),
  review: (c, l) => ({ review: c.reviewId, team: l.team_id ?? undefined }),
  ressource: (c, l) => ({ ressource: c.ressource, team: l.team_id ?? undefined }),
  tournoi: (c, l) => ({ tournoi: c.tournoi, team: l.team_id ?? undefined }),
  resultat: (c, l) => ({ resultat: c.resultat, team: l.team_id ?? undefined }),
  // Nouveau membre : sa fiche ; fiche modifiée par un autre : la sienne (le destinataire).
  membre: (c, l) => ({ compte: l.type === 'trombi-modifiee' ? l.compte_id : c.membre, team: l.team_id ?? undefined }),
  demande_compte: c => ({ demande: c.demande }),
  sponsor: c => (c.prospect ? { prospect: c.prospect } : c.genre === 'prospect' ? { prospect: c.id } : { partenaire: c.partenaire ?? (c.genre === 'partenaire' ? c.id : undefined) }),
  jeu: c => ({ jeu: c.jeu }),
  devblog: c => (c.etat === 'publie' ? { entree: c.entree } : { brouillon: c.entree ?? 'oui' }),
  avis_ticket: c => ({ ticket: c.ticket }),
  salon_match: c => ({ evenement: c.evenement, match: c.match }),
  alerte_discord: (c, l) => ({ zone: c.zone, evenement: c.evenement, team: l.team_id ?? c.team }),
};

/** Message d'un `tk-message` : son identifiant de notification est `<message>:<compte>` (cycle.mjs). */
function messageDeTicket(id) {
  const i = typeof id === 'string' ? id.lastIndexOf(':') : -1;
  return i > 0 ? id.slice(0, i) : undefined;
}

/** Chaque type de notification personnelle, rangé sous son genre de cible (voir `CIBLES_EVENEMENTS`). */
export const CIBLES_PERSONNELLES = Object.freeze({
  ticket: ['tk-nouveau', 'tk-assigne', 'tk-message', 'tk-note', 'tk-ferme'],
  carte_cm: ['cm-assigne', 'cm-urgence', 'cm-carte-terminee', 'cm-mention', 'cm-commentaire', 'cm-a-valider', 'cm-valide', 'cm-refuse', 'cm-depot'],
  clip_cm: ['cm-clip-propose', 'cm-clip-decide'],
  lien_cm: ['cm-lien-partage'],
  reunion_cm: ['cm-reunion-invite', 'cm-reunion-modifiee', 'cm-reunion-annulee', 'cm-reunion-reponse', 'cm-reunion-rappel'],
  evenement: ['evenement-nouveau', 'evenement-modifie', 'rappel-rsvp'],
  tache: ['tache-assignee', 'tache-echeance'],
  reunion: ['resume-depose', 'resume-publie', 'transcription-prete', 'transcription-echec'],
  playbook: ['playbook-valide'],
  lineup: ['lineup-propose', 'lineup-valide'],
  review: ['review-nouvelle', 'review-commentaire'],
  ressource: ['ressource-proposee', 'ressource-validee', 'ressource-refusee', 'ressource-commentaire'],
  tournoi: ['tournoi-inscrit', 'tournoi-termine'],
  resultat: ['resultat-saisi'],
  membre: ['membre-arrive', 'trombi-modifiee'],
  demande_compte: ['demande-compte', 'demande-compte-validee', 'demande-compte-refusee'],
  sponsor: ['sp-action', 'sp-obligation', 'sp-contrat', 'sp-responsable'],
  jeu: ['jeu-maj-proposee'],
  devblog: ['devblog-auto'],
  avis_ticket: ['tk-avis'],
  salon_match: ['salon-match-alerte'],
  alerte_discord: ['vocal-alerte', 'role-evenement-alerte', 'role-temp-alerte'],
  section: ['bienvenue', 'role-change', 'retire', 'modules', 'note-partagee', 'jeu-brouillon-pret', 'evenement-annule', 'cm-affecte', 'cm-rdv-reserve', 'cm-drive-quota', 'cm-releve'],
});

const GENRE_PERSONNELLE = new Map(Object.entries(CIBLES_PERSONNELLES).flatMap(([g, types]) => types.map(t => [t, g])));
export const genrePersonnelle = type => GENRE_PERSONNELLE.get(type);
/** Tous les types de notifications personnelles connus. */
export const TYPES_PERSONNELS = Object.freeze([...GENRE_PERSONNELLE.keys()]);

/**
 * Cible d'une notification personnelle : `{ id, compte, type, charge, team_id }` (ligne `notifications`) et l'événement
 * d'origine s'il est connu (ligne du fil : sa cible sert de repli quand la charge ne nomme pas l'élément).
 */
export function ciblePersonnelle(ligne, ev = null) {
  const g = GENRE_PERSONNELLE.get(ligne?.type);
  if (!g || !DEPUIS_PERSONNELLE[g]) return null;
  const charge = jsonOu(ligne.charge, {}) ?? {};
  const propre = cible(g, DEPUIS_PERSONNELLE[g](typeof charge === 'object' ? charge : {}, ligne));
  if (propre) return propre;
  const repli = ev?.cible ? normaliserCible(ev.cible) : null;
  return repli && repli.g === g ? repli : null;
}

// ------------------------------------------------------------------ Vérification au clic

const ok = c => ({ etat: 'ok', cible: c });
const SUPPRIME = { etat: 'supprime' };
const INTERDIT = { etat: 'interdit' };
const DRIVE = 'cm:cm.drive.voir|cm.drive.envoyer|cm.drive.gerer';

/** Éléments d'une team : requête (fixe), permission de lecture (clé d'accès de la règle de son événement). */
const ELEMENTS_TEAM = {
  tache: { sql: 'SELECT team_id, supprime_le FROM taches WHERE id = ?', champ: 'tache', acces: () => regleDe('task.created').acces },
  objectif: { sql: 'SELECT team_id, supprime_le FROM objectifs WHERE id = ?', champ: 'objectif', acces: () => regleDe('goal.created').acces },
  reunion: { sql: 'SELECT team_id, supprime_le FROM reunions WHERE id = ?', champ: 'reunion', acces: () => 'team:meeting_summaries.view_all|meeting_summaries.write_summary|meeting_summaries.view_summary|meeting_summaries.submit' },
  strat: { sql: 'SELECT team_id, supprime_le, visibilite FROM strats WHERE id = ?', champ: 'strat', acces: l => (l.visibilite === 'team' ? 'team:strats.view' : 'team:strats.delete') },
  playbook: { sql: 'SELECT team_id, supprime_le FROM playbook_entrees WHERE id = ?', champ: 'entree', acces: () => regleDe('playbook.created').acces },
  lineup: { sql: 'SELECT team_id, supprime_le FROM lineups WHERE id = ?', champ: 'lineup', acces: () => regleDe('lineup.created').acces },
  review: { sql: 'SELECT team_id, supprime_le FROM reviews WHERE id = ?', champ: 'review', acces: () => regleDe('review.created').acces },
  ressource: { sql: 'SELECT team_id, supprime_le, visibilite, statut FROM ressources WHERE id = ?', champ: 'ressource', acces: l => (l.statut === 'publiee' && l.visibilite === 'team' ? 'team:resources.view' : 'team:resources.post|resources.manage') },
  adversaire: { sql: 'SELECT team_id, supprime_le FROM adversaires WHERE id = ?', champ: 'adversaire', acces: () => regleDe('opponent.created').acces },
  tournoi: { sql: 'SELECT team_id, supprime_le FROM tournois WHERE id = ?', champ: 'tournoi', acces: () => regleDe('tournoi.cree').acces },
  resultat: { sql: 'SELECT team_id, supprime_le, visibilite FROM resultats WHERE id = ?', champ: 'resultat', acces: l => (l.visibilite === 'team' ? 'team:resultats.voir' : 'team:resultats.saisir') },
};

/**
 * L'élément de la cible existe-t-il encore, et le lecteur y a-t-il accès (rôles du moment) ? Rend
 * `{ etat: 'ok', cible }` (complétée : tableau, dossier, portée, team, date…), `{ etat: 'supprime' }` ou
 * `{ etat: 'interdit' }`. Cible illisible : `{ etat: 'invalide' }`.
 */
export async function verifierCible(base, acteur, brute) {
  const c = normaliserCible(brute);
  if (!c) return { etat: 'invalide' };
  const droits = await droitsLecteur(base, acteur);
  const team = (acces, teamId) => voit(droits, acces, teamId);

  if (ELEMENTS_TEAM[c.g]) {
    const e = ELEMENTS_TEAM[c.g];
    const l = await base.premier(e.sql, [c[e.champ]]);
    if (!l || l.supprime_le) return SUPPRIME;
    if (!team(e.acces(l), l.team_id)) return INTERDIT;
    return ok({ ...c, team: l.team_id });
  }

  switch (c.g) {
    case 'ticket': {
      const l = await base.premier('SELECT categorie_id, supprime_le, purge_le FROM tickets WHERE id = ?', [c.ticket]);
      if (!l || l.supprime_le || l.purge_le) return SUPPRIME;
      if (!droits.tout && !(droits.tickets === null || droits.tickets?.includes(l.categorie_id))) return INTERDIT;
      if (c.message) {
        const m = await base.premier('SELECT supprime_le FROM tickets_messages WHERE id = ? AND ticket_id = ?', [c.message, c.ticket]);
        if (!m || m.supprime_le) delete c.message;
      }
      return ok(c);
    }
    case 'carte_cm': {
      const l = await base.premier('SELECT k.tableau_id, k.supprime_le, k.archive_le, t.team_id, t.supprime_le AS tableau_supprime FROM cm_cartes k JOIN cm_tableaux t ON t.id = k.tableau_id WHERE k.id = ?', [c.carte]);
      if (!l || l.supprime_le || l.tableau_supprime) return SUPPRIME;
      if (!team('cm:cm.voir', l.team_id ?? null) || droits.tableauxInterdits?.includes(l.tableau_id)) return INTERDIT;
      if (c.commentaire) {
        const m = await base.premier('SELECT supprime_le FROM cm_commentaires WHERE id = ? AND carte_id = ?', [c.commentaire, c.carte]);
        if (!m || m.supprime_le) delete c.commentaire;
      }
      return ok({ ...c, tableau: l.tableau_id, ...(l.team_id ? { team: l.team_id } : {}) });
    }
    case 'clip_cm': {
      const l = await base.premier('SELECT team_id, supprime_le FROM cm_clips WHERE id = ?', [c.clip]);
      if (!l || l.supprime_le) return SUPPRIME;
      if (!team('cm:cm.voir|cm.clips.proposer', l.team_id ?? null)) return INTERDIT;
      return ok(c);
    }
    case 'lien_cm': {
      const l = await base.premier('SELECT id FROM cm_liens WHERE id = ?', [c.lien]);
      if (!l) return SUPPRIME;
      if (droits.liensInterdits?.includes(c.lien)) return INTERDIT;
      return ok(c);
    }
    case 'drive': {
      const l = c.fichier
        ? await base.premier('SELECT portee, team_id, dossier_id, supprime_le, corbeille FROM cm_drive_fichiers WHERE id = ?', [c.fichier])
        : await base.premier('SELECT portee, team_id, parent_id AS dossier_id, supprime_le, corbeille FROM cm_drive_dossiers WHERE id = ?', [c.dossier]);
      if (!l || l.supprime_le || Number(l.corbeille) === 1) return SUPPRIME;
      const restreint = await sousDossierRestreint(base, c.fichier ? 'cm_drive' : 'cm_drive_dossier', c.fichier ?? c.dossier);
      if (!team(restreint ? 'cm:cm.drive.gerer' : DRIVE, l.team_id ?? null)) return INTERDIT;
      return ok({ ...c, portee: l.portee, ...(c.fichier ? { dossier: l.dossier_id ?? undefined } : {}) });
    }
    case 'reunion_cm': {
      const l = await base.premier('SELECT organisateur_id, statut, debut FROM cm_reunions WHERE id = ?', [c.reunion]);
      if (!l) return SUPPRIME;
      const invite = droits.tout || l.organisateur_id === acteur.compte || Boolean(await base.premier('SELECT reunion_id FROM cm_reunion_participants WHERE reunion_id = ? AND compte_id = ?', [c.reunion, acteur.compte]));
      if (!invite && !voit(droits, 'club:cm.reunions.voir|cm.reunions.gerer', null) && !droits.cmEspace) return INTERDIT;
      return ok({ ...c, debut: c.debut ?? l.debut });
    }
    case 'evenement': {
      const l = await base.premier('SELECT team_id, debut, supprime_le FROM planning_evenements WHERE id = ?', [c.evenement]);
      if (!l || l.supprime_le) return SUPPRIME;
      if (!team('team:planning.view', l.team_id)) return INTERDIT;
      return ok({ ...c, team: l.team_id, ...(c.occurrence ? {} : { occurrence: l.debut }) });
    }
    case 'membre': {
      const l = await base.premier('SELECT id FROM comptes WHERE id = ?', [c.compte]);
      return l ? ok(c) : SUPPRIME;
    }
    case 'demande_compte': {
      const l = await base.premier('SELECT demandeur_id FROM demandes_compte WHERE id = ?', [c.demande]);
      if (!l) return SUPPRIME;
      if (!droits.tout && l.demandeur_id !== acteur.compte && !voit(droits, 'club:comptes.demandes.gerer', null)) return INTERDIT;
      return ok(c);
    }
    case 'sponsor': {
      const l = c.prospect ? await base.premier('SELECT supprime_le FROM sp_prospects WHERE id = ?', [c.prospect]) : await base.premier('SELECT supprime_le FROM sp_partenaires WHERE id = ?', [c.partenaire]);
      if (!l || l.supprime_le) return SUPPRIME;
      if (!voit(droits, 'club:sponsors.voir', null)) return INTERDIT;
      return ok(c);
    }
    case 'jeu': {
      const l = await base.premier('SELECT statut FROM jeux WHERE cle = ?', [c.jeu]);
      if (!l) return SUPPRIME;
      if (!voit(droits, 'club:jeux.gerer', null)) return INTERDIT;
      return ok(c);
    }
    case 'devblog': {
      if (c.entree) {
        const l = await base.premier('SELECT statut FROM devblog_entrees WHERE id = ?', [c.entree]);
        if (!l) return SUPPRIME;
      }
      if (c.brouillon && !voit(droits, 'club:devblog.gerer', null)) return INTERDIT;
      return ok(c);
    }
    case 'avis_ticket': {
      const l = await base.premier('SELECT categorie_id, supprime_le, purge_le FROM tickets WHERE id = ?', [c.ticket]);
      if (!l || l.supprime_le || l.purge_le) return SUPPRIME;
      const d = await droitsTickets(base, acteur);
      // Avis : tickets.gerer, ou tickets.configurer pour les catégories de ses rôles. Sinon, qui traite la catégorie voit
      // le ticket (et sa note) : le lien mène au ticket.
      if (gereAvis(d, l.categorie_id)) return ok(c);
      if (voitCategorie(d, l.categorie_id)) return ok({ v: VERSION_CIBLE, g: 'ticket', ticket: c.ticket });
      return INTERDIT;
    }
    case 'salon_match': {
      const e = await base.premier('SELECT id FROM club_evenements WHERE id = ?', [c.evenement]);
      if (!e) return SUPPRIME;
      if (!voit(droits, 'club:evenements.gerer', null)) return INTERDIT;
      if (c.match) {
        const m = await base.premier("SELECT statut FROM club_salons_match WHERE evenement_id = ? AND site_match_id = ? AND statut <> 'supprime'", [c.evenement, c.match]);
        if (!m) delete c.match;
      }
      return ok(c);
    }
    case 'alerte_discord': {
      if (c.zone === 'vocaux') return voit(droits, 'club:vocaux.configurer', null) ? ok(c) : INTERDIT;
      if (c.zone === 'evenement') {
        const e = await base.premier('SELECT id FROM club_evenements WHERE id = ?', [c.evenement]);
        if (!e) return SUPPRIME;
        return voit(droits, 'club:evenements.gerer', null) ? ok(c) : INTERDIT;
      }
      const t = await base.premier('SELECT id FROM teams WHERE id = ? AND supprimee_le IS NULL', [c.team]);
      if (!t) return SUPPRIME;
      return voit(droits, 'team:discord.manage', c.team) ? ok(c) : INTERDIT;
    }
    default:
      return { etat: 'invalide' };
  }
}

// ------------------------------------------------------------------ Adresse partageable

/** Fragment de l'app pour une cible : `#/app/esport/c/<genre>?<champ>=<valeur>&…` (même format que l'app). */
export function fragmentCible(brute) {
  const c = normaliserCible(brute);
  if (!c) return '#/app/esport';
  const params = CHAMPS_CIBLES[c.g].filter(k => c[k]).map(k => `${k}=${encodeURIComponent(c[k])}`);
  return `#/app/esport/c/${c.g}${params.length ? `?${params.join('&')}` : ''}`;
}

/** Adresse partageable (site de l'app + fragment), ou '' sans adresse https de l'app. */
export function lienProfond(lienApp, brute) {
  if (typeof lienApp !== 'string' || !/^https:\/\//.test(lienApp)) return '';
  return `${lienApp.split('#')[0]}${fragmentCible(brute)}`;
}
