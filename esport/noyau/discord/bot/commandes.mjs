/**
 * Slash commands du bot Esport : définitions envoyées à Discord par
 * esport/outils/discord-commandes.mjs (PUT /applications/{id}/commands), et
 * lues par interactions.mjs. Feuille pure.
 *
 * Toutes les commandes vivent dans un serveur (contexte 0), sauf /lier,
 * /delier et /aide, aussi permises en message privé avec le bot.
 */

const T = { CHAINE: 3, ENTIER: 4, SALON: 7 };
const SERVEUR = [0];
const PARTOUT = [0, 1];

const optionTeam = { type: T.CHAINE, name: 'team', description: 'La team (si ce serveur en a plusieurs)', required: false, autocomplete: true };

export const TYPES_CHOIX = [
  { name: 'Scrim', value: 'scrim' },
  { name: 'Match', value: 'match' },
  { name: 'Tournoi', value: 'tournament' },
  { name: 'Entraînement', value: 'training' },
  { name: 'Réunion', value: 'meeting' },
  { name: 'Autre', value: 'other' },
];

export const COMMANDES = [
  { name: 'aide', description: 'Ce que sait faire le bot Esport', contexts: PARTOUT },
  {
    name: 'lier',
    description: 'Lier ton compte Discord à ton compte Esport (code affiché dans l’app)',
    contexts: PARTOUT,
    options: [{ type: T.CHAINE, name: 'code', description: 'Le code de l’app (Mon profil › Lier mon Discord)', required: true, min_length: 8, max_length: 12 }],
  },
  { name: 'delier', description: 'Délier ton compte Discord de l’Esport', contexts: PARTOUT },
  { name: 'prochain', description: 'Tes prochains événements (où tu es convoqué)', contexts: SERVEUR },
  {
    name: 'planning',
    description: 'Les événements de la team',
    contexts: SERVEUR,
    options: [{ type: T.ENTIER, name: 'jours', description: 'Combien de jours (7 par défaut, 30 au plus)', required: false, min_value: 1, max_value: 30 }, optionTeam],
  },
  { name: 'rsvp', description: 'Répondre à un événement : Oui, Peut-être ou Non', contexts: SERVEUR },
  { name: 'dispo', description: 'Tes disponibilités de la semaine', contexts: SERVEUR },
  { name: 'taches', description: 'Tes tâches ouvertes et en retard', contexts: SERVEUR },
  {
    name: 'strat',
    description: 'Strats validées du playbook pour une map',
    contexts: SERVEUR,
    options: [{ type: T.CHAINE, name: 'map', description: 'La map (Ascent, Bind…)', required: true, autocomplete: true }, optionTeam],
  },
  {
    name: 'resume',
    description: 'Déposer le lien d’une réunion à résumer',
    contexts: SERVEUR,
    options: [
      { type: T.CHAINE, name: 'titre', description: 'Titre de la réunion', required: true, min_length: 2, max_length: 120 },
      { type: T.CHAINE, name: 'lien', description: 'Lien de l’enregistrement (https://…)', required: true, max_length: 500 },
      { type: T.CHAINE, name: 'type', description: 'Type de réunion', required: true, autocomplete: true },
      optionTeam,
    ],
  },
  {
    name: 'evenement-creer',
    description: 'Staff : créer un événement au planning',
    contexts: SERVEUR,
    options: [
      { type: T.CHAINE, name: 'type', description: 'Scrim, match, tournoi…', required: true, choices: TYPES_CHOIX },
      { type: T.CHAINE, name: 'titre', description: 'Titre', required: true, min_length: 2, max_length: 80 },
      { type: T.CHAINE, name: 'date', description: 'Date : 2026-10-24, 24/10, aujourd’hui ou demain', required: true, max_length: 20 },
      { type: T.CHAINE, name: 'heure', description: 'Heure de début : 20:30 ou 20h30', required: true, max_length: 8 },
      {
        type: T.CHAINE,
        name: 'convoques',
        description: 'Qui convoquer (joueurs par défaut)',
        required: false,
        choices: [
          { name: 'Joueurs', value: 'joueurs' },
          { name: 'Staff', value: 'staff' },
          { name: 'Tous', value: 'tous' },
        ],
      },
      { type: T.ENTIER, name: 'duree', description: 'Durée en minutes (120 par défaut)', required: false, min_value: 15, max_value: 1440 },
      optionTeam,
    ],
  },
  {
    name: 'relancer',
    description: 'Staff : relancer les convoqués qui n’ont pas répondu',
    contexts: SERVEUR,
    options: [{ type: T.CHAINE, name: 'evenement', description: 'L’événement', required: true, autocomplete: true }],
  },
  {
    name: 'esport-lier-serveur',
    description: 'Admin du serveur : lier ce serveur à une team Esport (code de l’app)',
    contexts: SERVEUR,
    // Gérer le serveur (0x20) : seuls les admins voient la commande ; le serveur Esport revérifie.
    default_member_permissions: '32',
    options: [
      { type: T.CHAINE, name: 'code', description: 'Le code de l’app (Discord › Lier un serveur Discord)', required: true, min_length: 8, max_length: 12 },
      { type: T.SALON, name: 'salon', description: 'Salon des annonces (celui-ci par défaut)', required: false, channel_types: [0, 5] },
    ],
  },
];

/** Définitions telles que Discord les attend (commandes de type 1, « chat input »). */
export function definitionsCommandes() {
  return COMMANDES.map(c => ({ type: 1, integration_types: [0], ...c }));
}
