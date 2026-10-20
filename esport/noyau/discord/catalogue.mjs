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

const TYPE_EVENEMENT = { scrim: 'Scrim', match: 'Match', training: 'Entraînement', meeting: 'Réunion', tournament: 'Tournoi', other: 'Événement' };
export const libelleTypeEvenement = type => TYPE_EVENEMENT[type] ?? 'Événement';

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
    description: 'Un rappel environ 24 h avant le début.',
    types: ['event.reminder_d1'],
    modules: ['planning'],
    defaut: true,
    modele: '**Rappel** : {titre} ({type}) commence {delai}, le {date} à {heure}.',
    variables: variables({ titre: 'Titre de l’événement', type: 'Type (Scrim, Match…)', date: 'Date (jour et mois)', heure: 'Heure (fuseau de la team)', delai: 'Délai (« dans 23 h »)' }),
  },
  {
    cle: 'reminder_h1',
    libelle: 'Rappel avant l’événement (H-1)',
    description: 'Un rappel environ 1 h avant le début.',
    types: ['event.reminder_h1'],
    modules: ['planning'],
    defaut: true,
    modele: '**C’est bientôt** : {titre} ({type}) commence {delai}, à {heure}.',
    variables: variables({ titre: 'Titre de l’événement', type: 'Type (Scrim, Match…)', date: 'Date (jour et mois)', heure: 'Heure (fuseau de la team)', delai: 'Délai (« dans 45 min »)' }),
  },
  {
    cle: 'rsvp_missing',
    libelle: 'RSVP manquant',
    description: 'Un joueur n’a pas répondu à un événement qui approche (un message par joueur).',
    types: ['attendance.reminder'],
    modules: ['planning', 'attendance'],
    defaut: false,
    modele: '{membre} n’a pas encore répondu pour {titre} ({date} à {heure}).',
    variables: variables({ membre: 'Pseudo du joueur', titre: 'Titre de l’événement', type: 'Type (Scrim, Match…)', date: 'Date (jour et mois)', heure: 'Heure (fuseau de la team)' }),
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
    cle: 'playbook_validated',
    libelle: 'Entrée du playbook validée',
    description: 'Une entrée du playbook passe au statut « validée » (module Playbook, phase 6).',
    types: ['playbook.validated'],
    modules: ['playbook'],
    defaut: false,
    modele: '**Playbook** : {titre} est validée{surCarte}, par {acteur}.',
    variables: variables({ titre: 'Titre de l’entrée', surCarte: 'Carte (« sur Ascent », vide sans carte)', acteur: 'Qui l’a validée' }),
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
  'discord.delivery_failed',
  'discord.delivery_abandoned',
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
  lien: 'https://app.exemple',
};
