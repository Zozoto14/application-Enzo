/**
 * Catalogue des notifications Discord : pour chaque type de message, le
 * module dont il dépend, l'événement de domaine qui le déclenche, les
 * variables permises dans le modèle, le modèle par défaut et son activation
 * par défaut. Feuille pure (aucune importation) : l'abonné du bus, le service
 * et les tests s'appuient sur le même tableau.
 *
 * Les événements de domaine viennent des phases 1 à 3 (event.created,
 * attendance.reminder, meeting.*, task.*, member.*), du cron de rappels
 * (`event.reminder_d1`, `event.reminder_h1`, voir rappels.mjs) et de la phase 5
 * (`review.created`, absente tant que le module Review vidéo n'est pas activé).
 */

/** Variables disponibles dans tous les modèles. */
const COMMUNES = {
  team: 'Nom de la team',
  lien: 'Adresse de l’app (si le serveur la connaît)',
};

const variables = extra => ({ ...extra, ...COMMUNES });

import { texte as texteLangue } from '../langues.mjs';

const TYPES = ['scrim', 'match', 'training', 'meeting', 'tournament', 'review', 'other'];
/** Nom d'un type d'événement dans une langue (variable {type} des modèles). */
export const libelleTypeEvenement = (type, langue = 'fr') => texteLangue(langue, `type.${TYPES.includes(type) ? type : 'other'}`);

/** Types de messages Discord, dans l'ordre d'affichage. `module` : module requis (null : cœur). */
export const EVENEMENTS_DISCORD = [
  {
    cle: 'event_created',
    libelle: 'Nouvel événement au planning',
    description: 'Un scrim, un match, un entraînement… est ajouté au planning.',
    types: ['event.created'],
    modules: ['planning'],
    defaut: true,
    modele: '**Nouvel événement** : {titre} ({type}), le {date} à {heure}.',
    variables: variables({ titre: 'Titre de l’événement', type: 'Type (Scrim, Match…)', date: 'Date (jour et mois)', heure: 'Heure (fuseau de la team)', acteur: 'Qui l’a créé' }),
  },
  {
    cle: 'reminder_d1',
    libelle: 'Rappel avant l’événement (J-1)',
    description: 'Un rappel environ 24 h avant le début, pour les convoqués.',
    types: ['event.reminder_d1'],
    modules: ['planning'],
    defaut: true,
    modele: '**Rappel** : {titre} ({type}) commence {delai}, le {date} à {heure}. Convoqués : {convoques}.',
    variables: variables({ titre: 'Titre de l’événement', type: 'Type (Scrim, Match…)', date: 'Date (jour et mois)', heure: 'Heure (fuseau de la team)', delai: 'Délai (« dans 23 h »)', convoques: 'Pseudos des convoqués' }),
  },
  {
    cle: 'reminder_h1',
    libelle: 'Rappel avant l’événement (H-1)',
    description: 'Un rappel environ 1 h avant le début, pour les convoqués.',
    types: ['event.reminder_h1'],
    modules: ['planning'],
    defaut: true,
    modele: '**C’est bientôt** : {titre} ({type}) commence {delai}, à {heure}. Convoqués : {convoques}.',
    variables: variables({ titre: 'Titre de l’événement', type: 'Type (Scrim, Match…)', date: 'Date (jour et mois)', heure: 'Heure (fuseau de la team)', delai: 'Délai (« dans 45 min »)', convoques: 'Pseudos des convoqués' }),
  },
  {
    cle: 'event_now',
    libelle: 'C’est maintenant',
    description: 'Au début de l’événement (bot : les convoqués liés pas encore mentionnés pour cet événement le sont).',
    types: ['event.starting'],
    modules: ['planning'],
    defaut: true,
    modele: '**C’est parti** : {titre} ({type}) commence maintenant.',
    variables: variables({ titre: 'Titre de l’événement', type: 'Type (Scrim, Match…)', date: 'Date (jour et mois)', heure: 'Heure (fuseau de la team)', convoques: 'Pseudos des convoqués' }),
  },
  {
    cle: 'rsvp_relance',
    libelle: 'Relance des convoqués (/relancer)',
    description: 'Un membre du staff relance, depuis Discord, les convoqués qui n’ont pas répondu (bot : un message privé à chacun ; sinon un seul message, groupé).',
    types: ['attendance.relance'],
    modules: ['planning', 'attendance'],
    defaut: true,
    modele: 'Pensez à répondre pour {titre} ({date} à {heure}) : {membre}.',
    variables: variables({ membre: 'Pseudos des convoqués sans réponse', titre: 'Titre de l’événement', type: 'Type (Scrim, Match…)', date: 'Date (jour et mois)', heure: 'Heure (fuseau de la team)' }),
  },
  {
    cle: 'rsvp_missing',
    libelle: 'RSVP manquant',
    description: 'Des convoqués n’ont pas répondu à un événement qui approche (bot : un message privé à chacun ; sinon un seul message, groupé).',
    types: ['attendance.reminder'],
    modules: ['planning', 'attendance'],
    defaut: false,
    modele: '{membre} : pas encore de réponse pour {titre} ({date} à {heure}).',
    variables: variables({ membre: 'Pseudos des convoqués sans réponse', titre: 'Titre de l’événement', type: 'Type (Scrim, Match…)', date: 'Date (jour et mois)', heure: 'Heure (fuseau de la team)' }),
  },
  {
    cle: 'summary_published',
    libelle: 'Résumé publié',
    description: 'Le PDF du résumé d’une réunion est publié. Rien n’est envoyé pour les réunions de type « staff ».',
    types: ['meeting.summary_published'],
    modules: ['meeting_summaries'],
    defaut: true,
    modele: '**Résumé publié** : {titre}, par {acteur}.',
    variables: variables({ titre: 'Titre de la réunion', acteur: 'Qui a publié le résumé', membre: 'Qui a déposé la réunion' }),
  },
  {
    cle: 'summary_submitted',
    libelle: 'Nouveau dépôt de réunion (staff)',
    description: 'Un joueur dépose une réunion à résumer. À réserver à un salon du staff : le message cite le titre.',
    types: ['meeting.submitted'],
    modules: ['meeting_summaries'],
    defaut: false,
    modele: '**Réunion à résumer** : {titre} ({type}, {date}), déposée par {membre}.',
    variables: variables({ titre: 'Titre de la réunion', type: 'Type de réunion', date: 'Date de la réunion', membre: 'Qui l’a déposée' }),
  },
  {
    cle: 'task_assigned',
    libelle: 'Tâche assignée',
    description: 'Une tâche est assignée à un membre.',
    types: ['task.assigned'],
    modules: ['goals_tasks'],
    defaut: true,
    modele: '**Nouvelle tâche** pour {assigne} : {titre}{echeance}.',
    variables: variables({ titre: 'Titre de la tâche', assigne: 'Pseudo de l’assigné', echeance: 'Échéance (« , pour le 2026-10-25 », vide sans échéance)', acteur: 'Qui l’a assignée' }),
  },
  {
    cle: 'task_due',
    libelle: 'Échéance de tâche',
    description: 'Une tâche arrive à échéance (ou est en retard).',
    types: ['task.due_soon'],
    modules: ['goals_tasks'],
    defaut: false,
    modele: '**Échéance** : {titre} ({assigne}) — {etat}.',
    variables: variables({ titre: 'Titre de la tâche', assigne: 'Pseudo de l’assigné', echeance: 'Date d’échéance', etat: '« échéance proche » ou « en retard »' }),
  },
  {
    cle: 'member_joined',
    libelle: 'Membre rejoint',
    description: 'Quelqu’un rejoint la team avec une invitation.',
    types: ['member.joined'],
    modules: [],
    defaut: false,
    modele: '**{membre}** a rejoint {team} ({role}).',
    variables: variables({ membre: 'Pseudo du nouveau membre', role: 'Son rôle' }),
  },
  {
    cle: 'account_requested',
    libelle: 'Demande de compte',
    description: 'Un membre propose un nouveau compte (permission « Créer des membres ») : le Fondateur doit la valider.',
    types: ['member.account_requested'],
    modules: [],
    defaut: true,
    modele: '**Demande de compte** : {acteur} propose {membre} ({role}). Le Fondateur la valide dans Esport › Membres.',
    variables: variables({ membre: 'Pseudo proposé', role: 'Rôle proposé', acteur: 'Qui a fait la demande' }),
  },
  {
    cle: 'role_changed',
    libelle: 'Changement de rôle',
    description: 'Le rôle d’un membre change.',
    types: ['member.role_changed'],
    modules: [],
    defaut: false,
    modele: '**{membre}** passe de {de} à {vers} (par {acteur}).',
    variables: variables({ membre: 'Pseudo du membre', de: 'Ancien rôle', vers: 'Nouveau rôle', acteur: 'Qui a changé le rôle' }),
  },
  {
    cle: 'review_created',
    libelle: 'Review créée',
    description: 'Une review vidéo est créée (module Review vidéo, phase 5).',
    types: ['review.created'],
    modules: ['video_review'],
    defaut: false,
    modele: '**Nouvelle review** : {titre}, par {acteur}.',
    variables: variables({ titre: 'Titre de la review', acteur: 'Qui l’a créée' }),
  },
  {
    cle: 'strat_created',
    libelle: 'Strat créée',
    description: 'Une strat est créée dans l’éditeur (module Strats, phase 6).',
    types: ['strat.created'],
    modules: ['strat_editor'],
    defaut: false,
    modele: '**Nouvelle strat** : {titre} ({carte}, {side}), par {acteur}.',
    variables: variables({ titre: 'Titre de la strat', carte: 'Carte', side: 'Attaque ou Défense', acteur: 'Qui l’a créée' }),
  },
  {
    // Contenu tactique : l'annonce ne porte QUE l'adversaire et la date (jamais le titre, les maps, les strats ni les notes).
    cle: 'plan_match_ready',
    libelle: 'Plan de match prêt',
    description: 'Un plan de match passe au statut « prêt » (module Plan de match). Le message ne contient aucun contenu du plan : seulement l’adversaire, la date et un lien vers l’app.',
    types: ['plan_match.ready'],
    modules: ['plans_match'],
    defaut: false,
    modele: 'Le plan de match{contre} est prêt{pourLe}. À lire dans l’app.',
    variables: variables({ contre: 'Adversaire (« contre Karmine », vide sans adversaire)', pourLe: 'Date du match (« , pour le 14 novembre », vide sans date)' }),
  },
  {
    cle: 'playbook_validated',
    libelle: 'Entrée du playbook validée',
    description: 'Une entrée du playbook passe au statut « validée » (module Playbook, phase 6).',
    types: ['playbook.validated'],
    modules: ['playbook'],
    defaut: false,
    modele: '**Playbook** : {titre} est validée{surCarte}, par {acteur}.',
    variables: variables({ titre: 'Titre de l’entrée', surCarte: 'Carte (« sur Ascent », vide sans carte)', acteur: 'Qui l’a validée' }),
  },
  {
    cle: 'resource_created',
    libelle: 'Nouvelle ressource',
    description: 'Une ressource est publiée dans le canal (module Ressources), ou une proposition est validée. Jamais pour une ressource réservée au staff. Salon dédié possible (Ressources › Réglages).',
    types: ['resource.created', 'resource.validated'],
    modules: ['resources'],
    defaut: false,
    modele: '**Nouvelle ressource** : {titre} ({categorie}), par {acteur}.',
    variables: variables({ titre: 'Titre de la ressource', categorie: 'Catégorie', genre: 'Type (lien, vidéo, fichier, note)', acteur: 'Qui l’a publiée' }),
  },
  // Modules Tournois et Résultats (migration 0022) : embeds tirés du résumé publiable (competition/resume.mjs).
  {
    cle: 'tournament_registered',
    libelle: 'Inscription à un tournoi',
    description: 'La team est inscrite à un tournoi (module Tournois). Rien ne part pour un tournoi marqué « non publiable ».',
    types: ['tournoi.inscrit'],
    modules: ['tournois'],
    defaut: true,
    modele: '**Inscription** : {tournoi}{dates}.',
    variables: variables({ tournoi: 'Nom du tournoi', dates: 'Dates (« , le 2026-11-08 », vide sans date)', acteur: 'Qui a inscrit la team' }),
  },
  {
    cle: 'match_announced',
    libelle: 'Annonce d’un match de tournoi',
    description: 'Un match de tournoi reçoit sa date (module Tournois) : adversaire, format, roster. Remplace l’annonce « Nouvel événement » de son événement au planning (les rappels restent).',
    types: ['tournoi.match_planifie'],
    modules: ['tournois'],
    defaut: true,
    modele: '**Match à venir** : {titre} contre {adversaire}, le {date} à {heure}.',
    variables: variables({ titre: 'Tournoi et tour', tournoi: 'Nom du tournoi', tour: 'Tour (« Quart de finale »)', adversaire: 'Adversaire(s)', date: 'Date (jour et mois)', heure: 'Heure (fuseau de la team)' }),
  },
  {
    cle: 'match_result',
    libelle: 'Résultat d’un match',
    description: 'Un résultat est saisi (module Résultats), s’il est publiable : jamais un résultat réservé au staff ; un scrim seulement si on l’a coché « publiable ».',
    types: ['match.resultat_saisi'],
    modules: ['resultats'],
    defaut: true,
    modele: '**Résultat** : {resultat} ({titre}).',
    variables: variables({ resultat: 'Phrase du résultat (« Victoire 2-1 contre Nova », « 3e place »)', issue: 'Victoire, défaite ou match nul', score: 'Score (« 2-1 », « 13-11 »)', adversaire: 'Adversaire(s)', place: 'Place (classement)', titre: 'Tournoi et tour, ou type de match', tournoi: 'Nom du tournoi', acteur: 'Qui a saisi le résultat' }),
  },
  {
    cle: 'tournament_final',
    libelle: 'Classement final d’un tournoi',
    description: 'Un tournoi passe à « terminé » (module Tournois) : classement final, parcours, gains.',
    types: ['tournoi.termine'],
    modules: ['tournois'],
    defaut: true,
    modele: '**Classement final** : {resultat}.',
    variables: variables({ resultat: 'Phrase (« Coupe d’automne : 3e sur 16 »)', tournoi: 'Nom du tournoi', classement: 'Classement (« 3e sur 16 »)', gains: 'Gains', acteur: 'Qui a clos le tournoi' }),
  },
];

export const CLES_EVENEMENTS_DISCORD = EVENEMENTS_DISCORD.map(e => e.cle);
export const evenementDiscord = cle => EVENEMENTS_DISCORD.find(e => e.cle === cle);

/** Types d'événements de domaine ajoutés par la phase 4 (bus : journal d'activité). */
export const TYPES_DISCORD = [
  'event.reminder_d1',
  'event.reminder_h1',
  'discord.webhook_set',
  'discord.webhook_removed',
  'discord.settings_changed',
  'discord.test_sent',
  // Test des MP du bot (Réglages › Discord › Tester les MP) : un événement par membre testé, aussi compteur anti-abus.
  'discord.test_mp',
  'discord.delivery_failed',
  'discord.delivery_abandoned',
  // Bot Discord (migration 0011) : liaisons, commandes, début d'événement, relance.
  'event.starting',
  'attendance.relance',
  'discord.server_linked',
  'discord.server_unlinked',
  'discord.account_linked',
  'discord.account_unlinked',
  'discord.pings_changed',
  'discord.command_used',
  // Rôles Discord temporaires des teams (migration 0066) : donné / prolongé, retiré (à la main ou à l'échéance).
  'discord.role_temp_given',
  'discord.role_temp_removed',
];

/** Événement de domaine → types de messages Discord qu'il peut déclencher. */
export function clesPourType(type) {
  return EVENEMENTS_DISCORD.filter(e => e.types.includes(type)).map(e => e.cle);
}

/** Exemple de valeurs (aperçu d'un modèle dans l'écran Discord). */
export const EXEMPLES = {
  titre: 'Scrim contre les Faucons',
  type: 'Scrim',
  date: 'mardi 21 octobre',
  heure: '20:30',
  delai: 'dans 23 h',
  acteur: 'Léa',
  membre: 'Max',
  assigne: 'Max',
  echeance: ', pour le 2026-10-25',
  etat: 'échéance proche',
  role: 'Joueur',
  de: 'Joueur',
  vers: 'Coach',
  team: 'Team Alpha',
  carte: 'Ascent',
  side: 'Attaque',
  surCarte: ' sur Ascent',
  categorie: 'Lineups',
  genre: 'Vidéo YouTube',
  lien: 'https://app.exemple',
  tournoi: 'Coupe d’automne',
  tour: 'Quart de finale',
  dates: ', le 2026-11-08',
  adversaire: 'Nova',
  score: '2-1',
  issue: 'Victoire',
  resultat: 'Victoire 2-1 contre Nova',
  place: '3e',
  classement: '3e sur 16',
  gains: '150,00 €',
};

/** Messages qui montrent une occurrence du planning (embed riche, boutons RSVP et mentions avec le bot). */
export const CLES_OCCURRENCE = ['event_created', 'reminder_d1', 'reminder_h1', 'event_now', 'rsvp_missing', 'rsvp_relance'];

/** Messages des modules Tournois et Résultats : embed reconstruit à l'envoi depuis le résumé publiable. */
export const CLES_COMPETITION = ['tournament_registered', 'match_announced', 'match_result', 'tournament_final'];

// ------------------------------------------------------------------ Textes anglais

const COMMUNES_EN = { team: 'Team name', lien: 'App address (if the server knows it)' };

/** Version anglaise de chaque type de message : libellé, description, modèle par défaut, variables propres. */
const TEXTES_EN = {
  event_created: {
    libelle: 'New event on the schedule',
    description: 'A scrim, a match, a practice… is added to the schedule.',
    modele: '**New event**: {titre} ({type}), on {date} at {heure}.',
    variables: { titre: 'Event title', type: 'Type (Scrim, Match…)', date: 'Date (day and month)', heure: 'Time (team time zone)', acteur: 'Who created it' },
  },
  reminder_d1: {
    libelle: 'Reminder before the event (D-1)',
    description: 'A reminder about 24 h before the start, for the called-up players.',
    modele: '**Reminder**: {titre} ({type}) starts {delai}, on {date} at {heure}. Called up: {convoques}.',
    variables: { titre: 'Event title', type: 'Type (Scrim, Match…)', date: 'Date (day and month)', heure: 'Time (team time zone)', delai: 'Delay (“in 23 h”)', convoques: 'Nicknames of the called-up players' },
  },
  reminder_h1: {
    libelle: 'Reminder before the event (H-1)',
    description: 'A reminder about 1 h before the start, for the called-up players.',
    modele: '**Heads up**: {titre} ({type}) starts {delai}, at {heure}. Called up: {convoques}.',
    variables: { titre: 'Event title', type: 'Type (Scrim, Match…)', date: 'Date (day and month)', heure: 'Time (team time zone)', delai: 'Delay (“in 45 min”)', convoques: 'Nicknames of the called-up players' },
  },
  event_now: {
    libelle: 'It’s happening now',
    description: 'When the event starts (bot: linked called-up players not yet mentioned for this event are mentioned).',
    modele: '**Let’s go**: {titre} ({type}) is starting now.',
    variables: { titre: 'Event title', type: 'Type (Scrim, Match…)', date: 'Date (day and month)', heure: 'Time (team time zone)', convoques: 'Nicknames of the called-up players' },
  },
  rsvp_relance: {
    libelle: 'Nudge for called-up players (/relancer)',
    description: 'A staff member nudges, from Discord, the called-up players who haven’t responded (bot: a direct message to each one; otherwise one single grouped message).',
    modele: 'Please respond for {titre} ({date} at {heure}): {membre}.',
    variables: { membre: 'Nicknames of the players without a response', titre: 'Event title', type: 'Type (Scrim, Match…)', date: 'Date (day and month)', heure: 'Time (team time zone)' },
  },
  rsvp_missing: {
    libelle: 'Missing RSVP',
    description: 'Called-up players haven’t responded to an upcoming event (bot: a direct message to each one; otherwise one single grouped message).',
    modele: '{membre}: no response yet for {titre} ({date} at {heure}).',
    variables: { membre: 'Nicknames of the players without a response', titre: 'Event title', type: 'Type (Scrim, Match…)', date: 'Date (day and month)', heure: 'Time (team time zone)' },
  },
  summary_published: {
    libelle: 'Summary published',
    description: 'The PDF summary of a meeting is published. Nothing is sent for “staff” meetings.',
    modele: '**Summary published**: {titre}, by {acteur}.',
    variables: { titre: 'Meeting title', acteur: 'Who published the summary', membre: 'Who submitted the meeting' },
  },
  summary_submitted: {
    libelle: 'New meeting submission (staff)',
    description: 'A player submits a meeting to be summarized. Keep it for a staff channel: the message quotes the title.',
    modele: '**Meeting to summarize**: {titre} ({type}, {date}), submitted by {membre}.',
    variables: { titre: 'Meeting title', type: 'Meeting type', date: 'Meeting date', membre: 'Who submitted it' },
  },
  task_assigned: {
    libelle: 'Task assigned',
    description: 'A task is assigned to a member.',
    modele: '**New task** for {assigne}: {titre}{echeance}.',
    variables: { titre: 'Task title', assigne: 'Assignee’s nickname', echeance: 'Due date (“, due 2026-10-25”, empty without a due date)', acteur: 'Who assigned it' },
  },
  task_due: {
    libelle: 'Task due date',
    description: 'A task is about to be due (or is overdue).',
    modele: '**Due**: {titre} ({assigne}) — {etat}.',
    variables: { titre: 'Task title', assigne: 'Assignee’s nickname', echeance: 'Due date', etat: '“due soon” or “overdue”' },
  },
  member_joined: {
    libelle: 'Member joined',
    description: 'Someone joins the team with an invitation.',
    modele: '**{membre}** joined {team} ({role}).',
    variables: { membre: 'New member’s nickname', role: 'Their role' },
  },
  account_requested: {
    libelle: 'Account request',
    description: 'A member proposes a new account (“Create members” permission): the Founder has to approve it.',
    modele: '**Account request**: {acteur} proposes {membre} ({role}). The Founder approves it in Esport › Members.',
    variables: { membre: 'Proposed nickname', role: 'Proposed role', acteur: 'Who made the request' },
  },
  role_changed: {
    libelle: 'Role change',
    description: 'A member’s role changes.',
    modele: '**{membre}** goes from {de} to {vers} (by {acteur}).',
    variables: { membre: 'Member’s nickname', de: 'Previous role', vers: 'New role', acteur: 'Who changed the role' },
  },
  review_created: {
    libelle: 'Review created',
    description: 'A video review is created (Video review module).',
    modele: '**New review**: {titre}, by {acteur}.',
    variables: { titre: 'Review title', acteur: 'Who created it' },
  },
  strat_created: {
    libelle: 'Strat created',
    description: 'A strat is created in the editor (Strats module).',
    modele: '**New strat**: {titre} ({carte}, {side}), by {acteur}.',
    variables: { titre: 'Strat title', carte: 'Map', side: 'Attack or Defense', acteur: 'Who created it' },
  },
  plan_match_ready: {
    libelle: 'Match plan ready',
    description: 'A match plan moves to the “ready” status (Match plan module). The message holds none of the plan’s content: only the opponent, the date and a link to the app.',
    modele: 'The match plan{contre} is ready{pourLe}. Read it in the app.',
    variables: { contre: 'Opponent (“ against Karmine”, empty without an opponent)', pourLe: 'Match date (“, for 14 November”, empty without a date)' },
  },
  playbook_validated: {
    libelle: 'Playbook entry validated',
    description: 'A playbook entry moves to the “validated” status (Playbook module).',
    modele: '**Playbook**: {titre} is validated{surCarte}, by {acteur}.',
    variables: { titre: 'Entry title', surCarte: 'Map (“ on Ascent”, empty without a map)', acteur: 'Who validated it' },
  },
  resource_created: {
    libelle: 'New resource',
    description: 'A resource is posted in the channel (Resources module), or a proposal is approved. Never for a staff-only resource. A dedicated channel is possible (Resources › Settings).',
    modele: '**New resource**: {titre} ({categorie}), by {acteur}.',
    variables: { titre: 'Resource title', categorie: 'Category', genre: 'Type (link, video, file, note)', acteur: 'Who posted it' },
  },
  tournament_registered: {
    libelle: 'Tournament registration',
    description: 'The team is registered for a tournament (Tournaments module). Nothing is sent for a tournament marked “not publishable”.',
    modele: '**Registered**: {tournoi}{dates}.',
    variables: { tournoi: 'Tournament name', dates: 'Dates (“, on 2026-11-08”, empty without a date)', acteur: 'Who registered the team' },
  },
  match_announced: {
    libelle: 'Tournament match announcement',
    description: 'A tournament match gets its date (Tournaments module): opponent, format, roster. Replaces the “New event” announcement of its schedule event (reminders stay).',
    modele: '**Upcoming match**: {titre} vs {adversaire}, on {date} at {heure}.',
    variables: { titre: 'Tournament and round', tournoi: 'Tournament name', tour: 'Round (“Quarter-final”)', adversaire: 'Opponent(s)', date: 'Date (day and month)', heure: 'Time (team time zone)' },
  },
  match_result: {
    libelle: 'Match result',
    description: 'A result is entered (Results module), if it is publishable: never a staff-only result; a scrim only if it was ticked “publishable”.',
    modele: '**Result**: {resultat} ({titre}).',
    variables: { resultat: 'Result sentence (“Victory 2-1 vs Nova”, “3rd place”)', issue: 'Victory, defeat or draw', score: 'Score (“2-1”, “13-11”)', adversaire: 'Opponent(s)', place: 'Placement (standings)', titre: 'Tournament and round, or match type', tournoi: 'Tournament name', acteur: 'Who entered the result' },
  },
  tournament_final: {
    libelle: 'Tournament final standings',
    description: 'A tournament moves to “finished” (Tournaments module): final placement, run, winnings.',
    modele: '**Final standings**: {resultat}.',
    variables: { resultat: 'Sentence (“Autumn Cup: 3rd of 16”)', tournoi: 'Tournament name', classement: 'Placement (“3rd of 16”)', gains: 'Winnings', acteur: 'Who closed the tournament' },
  },
};

/** Libellé, description, modèle par défaut et variables d'un type de message dans une langue. */
export function textesEvenement(def, langue = 'fr') {
  const en = langue === 'en' ? TEXTES_EN[def.cle] : null;
  if (!en) return { libelle: def.libelle, description: def.description, modele: def.modele, variables: def.variables };
  return { libelle: en.libelle, description: en.description, modele: en.modele, variables: { ...en.variables, ...COMMUNES_EN } };
}

export const CLES_TEXTES_EN = Object.keys(TEXTES_EN);

/** Exemple de valeurs (aperçu d'un modèle) dans une langue. */
export function exemples(langue = 'fr') {
  if (langue !== 'en') return EXEMPLES;
  return {
    titre: 'Scrim vs the Falcons',
    type: 'Scrim',
    date: 'Tuesday 21 October',
    heure: '20:30',
    delai: 'in 23 h',
    acteur: 'Léa',
    membre: 'Max',
    assigne: 'Max',
    echeance: ', due 2026-10-25',
    etat: 'due soon',
    role: 'Player',
    de: 'Player',
    vers: 'Coach',
    team: 'Team Alpha',
    carte: 'Ascent',
    side: 'Attack',
    surCarte: ' on Ascent',
    categorie: 'Lineups',
    genre: 'YouTube video',
    lien: 'https://app.exemple',
    tournoi: 'Autumn Cup',
    tour: 'Quarter-final',
    dates: ', on 2026-11-08',
    adversaire: 'Nova',
    score: '2-1',
    issue: 'Victory',
    resultat: 'Victory 2-1 vs Nova',
    place: '3rd',
    classement: '3rd of 16',
    gains: '€150.00',
  };
}
