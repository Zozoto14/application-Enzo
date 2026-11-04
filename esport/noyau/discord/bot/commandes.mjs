/**
 * Slash commands du bot Esport : définitions envoyées à Discord par
 * esport/outils/discord-commandes.mjs (PUT /applications/{id}/commands), et
 * lues par interactions.mjs. Feuille pure.
 *
 * Toutes les commandes vivent dans un serveur (contexte 0), sauf /lier,
 * /delier et /aide, aussi permises en message privé avec le bot.
 */

const T = { SOUS_COMMANDE: 1, CHAINE: 3, ENTIER: 4, UTILISATEUR: 6, SALON: 7 };
const SERVEUR = [0];
const PARTOUT = [0, 1];

/**
 * Les noms des commandes et des options restent les mêmes (français) ; leurs descriptions et les
 * noms des choix sont en ANGLAIS par défaut (langue par défaut du bot) avec une traduction française
 * (`*_localizations`, locale Discord `fr`) : Discord affiche la bonne selon la langue de chaque
 * utilisateur. Après un changement : relancer esport/outils/discord-commandes.mjs.
 */
export const LOCALES_FRANCAIS = ['fr'];
const loc = fr => Object.fromEntries(LOCALES_FRANCAIS.map(l => [l, fr]));
/** Description en anglais (par défaut) et en français. */
const desc = (fr, en) => ({ description: en, description_localizations: loc(fr) });
/** Choix de liste : nom anglais (par défaut) et nom français. */
const choix = (fr, en, value) => ({ name: en, name_localizations: loc(fr), value });

const optionTeam = { type: T.CHAINE, name: 'team', ...desc('La team (si ce serveur en a plusieurs)', 'The team (if this server has several)'), required: false, autocomplete: true };

export const TYPES_CHOIX = [
  choix('Scrim', 'Scrim', 'scrim'),
  choix('Match', 'Match', 'match'),
  choix('Tournoi', 'Tournament', 'tournament'),
  choix('Entraînement', 'Practice', 'training'),
  choix('Réunion', 'Meeting', 'meeting'),
  choix('Autre', 'Other', 'other'),
];

export const COMMANDES = [
  { name: 'aide', ...desc('Ce que sait faire le bot Esport', 'What the Esport bot can do'), contexts: PARTOUT },
  {
    name: 'lier',
    ...desc('Lier ton compte Discord à ton compte Esport (code affiché dans l’app)', 'Link your Discord account to your Esport account (code shown in the app)'),
    contexts: PARTOUT,
    options: [{ type: T.CHAINE, name: 'code', ...desc('Le code de l’app (Mon profil › Lier mon Discord)', 'The code from the app (My profile › Link my Discord)'), required: true, min_length: 8, max_length: 12 }],
  },
  { name: 'delier', ...desc('Délier ton compte Discord de l’Esport', 'Unlink your Discord account from Esport'), contexts: PARTOUT },
  { name: 'prochain', ...desc('Tes prochains événements (où tu es convoqué)', 'Your upcoming events (where you are called up)'), contexts: SERVEUR },
  {
    name: 'planning',
    ...desc('Les événements de la team', 'The team’s events'),
    contexts: SERVEUR,
    options: [{ type: T.ENTIER, name: 'jours', ...desc('Combien de jours (7 par défaut, 30 au plus)', 'How many days (7 by default, 30 at most)'), required: false, min_value: 1, max_value: 30 }, optionTeam],
  },
  { name: 'rsvp', ...desc('Répondre à un événement : Oui, Peut-être ou Non', 'Respond to an event: Yes, Maybe or No'), contexts: SERVEUR },
  { name: 'dispo', ...desc('Tes disponibilités de la semaine', 'Your availability for the week'), contexts: SERVEUR },
  { name: 'taches', ...desc('Tes tâches ouvertes et en retard', 'Your open and overdue tasks'), contexts: SERVEUR },
  {
    name: 'strat',
    ...desc('Strats validées du playbook pour une map', 'Validated playbook strats for a map'),
    contexts: SERVEUR,
    options: [{ type: T.CHAINE, name: 'map', ...desc('La map (Ascent, Bind…)', 'The map (Ascent, Bind…)'), required: true, autocomplete: true }, optionTeam],
  },
  {
    name: 'resume',
    ...desc('Déposer le lien d’une réunion à résumer', 'Submit the link of a meeting to be summarized'),
    contexts: SERVEUR,
    options: [
      { type: T.CHAINE, name: 'titre', ...desc('Titre de la réunion', 'Meeting title'), required: true, min_length: 2, max_length: 120 },
      { type: T.CHAINE, name: 'lien', ...desc('Lien de l’enregistrement (https://…)', 'Recording link (https://…)'), required: true, max_length: 500 },
      { type: T.CHAINE, name: 'type', ...desc('Type de réunion', 'Meeting type'), required: true, autocomplete: true },
      optionTeam,
    ],
  },
  {
    name: 'evenement-creer',
    ...desc('Staff : créer un événement au planning', 'Staff: create an event on the schedule'),
    contexts: SERVEUR,
    options: [
      { type: T.CHAINE, name: 'type', ...desc('Scrim, match, tournoi…', 'Scrim, match, tournament…'), required: true, choices: TYPES_CHOIX },
      { type: T.CHAINE, name: 'titre', ...desc('Titre', 'Title'), required: true, min_length: 2, max_length: 80 },
      { type: T.CHAINE, name: 'date', ...desc('Date : 2026-10-24, 24/10, aujourd’hui ou demain', 'Date: 2026-10-24, 24/10, today or tomorrow'), required: true, max_length: 20 },
      { type: T.CHAINE, name: 'heure', ...desc('Heure de début : 20:30 ou 20h30', 'Start time: 20:30 or 20h30'), required: true, max_length: 8 },
      {
        type: T.CHAINE,
        name: 'convoques',
        ...desc('Qui convoquer (joueurs par défaut)', 'Who to call up (players by default)'),
        required: false,
        choices: [choix('Joueurs', 'Players', 'joueurs'), choix('Staff', 'Staff', 'staff'), choix('Tous', 'Everyone', 'tous')],
      },
      { type: T.ENTIER, name: 'duree', ...desc('Durée en minutes (120 par défaut)', 'Duration in minutes (120 by default)'), required: false, min_value: 15, max_value: 1440 },
      optionTeam,
    ],
  },
  {
    name: 'relancer',
    ...desc('Staff : relancer les convoqués qui n’ont pas répondu', 'Staff: nudge the called-up players who haven’t responded'),
    contexts: SERVEUR,
    options: [{ type: T.CHAINE, name: 'evenement', ...desc('L’événement', 'The event'), required: true, autocomplete: true }],
  },
  {
    name: 'esport-lier-serveur',
    ...desc('Admin du serveur : lier ce serveur à une team Esport (code de l’app)', 'Server admin: link this server to an Esport team (code from the app)'),
    contexts: SERVEUR,
    // Gérer le serveur (0x20) : seuls les admins voient la commande ; le serveur Esport revérifie.
    default_member_permissions: '32',
    options: [
      { type: T.CHAINE, name: 'code', ...desc('Le code de l’app (Discord › Lier un serveur Discord)', 'The code from the app (Discord › Link a Discord server)'), required: true, min_length: 8, max_length: 12 },
      { type: T.SALON, name: 'salon', ...desc('Salon des annonces (celui-ci par défaut)', 'Announcements channel (this one by default)'), required: false, channel_types: [0, 5] },
    ],
  },
];

/**
 * Tickets (docs/esport/tickets.md) : /ticket <sous-commande>. Ouvertes à tout membre du serveur du club ; chaque
 * sous-commande peut être coupée ou réservée à des rôles dans l'app (Tickets › Configuration › Commandes), et les
 * actions du staff sont revérifiées par le serveur (rôles de la catégorie, compte lié). Après un changement : relancer
 * esport/outils/discord-commandes.mjs.
 */
const optionCategorie = { type: T.CHAINE, name: 'categorie', ...desc('La catégorie du ticket', 'The ticket category'), autocomplete: true };
const optionMembre = { type: T.UTILISATEUR, name: 'membre', ...desc('Le membre du serveur', 'The server member'), required: true };
export const NIVEAUX_PRIORITE = [choix('Faible', 'Low', 'faible'), choix('Moyenne', 'Medium', 'moyen'), choix('Urgente', 'Urgent', 'urgent'), choix('Critique', 'Critical', 'critique')];
export const SOUS_COMMANDES_TICKET = [
  { type: T.SOUS_COMMANDE, name: 'ouvrir', ...desc('Ouvrir un ticket (salon privé avec le staff)', 'Open a ticket (private channel with the staff)'), options: [{ ...optionCategorie, required: false }] },
  { type: T.SOUS_COMMANDE, name: 'fermer', ...desc('Fermer ce ticket', 'Close this ticket'), options: [{ type: T.CHAINE, name: 'raison', ...desc('Raison (facultative)', 'Reason (optional)'), required: false, max_length: 300 }] },
  { type: T.SOUS_COMMANDE, name: 'prendre', ...desc('Staff : prendre ce ticket en charge', 'Staff: claim this ticket') },
  { type: T.SOUS_COMMANDE, name: 'liberer', ...desc('Staff : ne plus prendre ce ticket en charge', 'Staff: release this ticket') },
  { type: T.SOUS_COMMANDE, name: 'ajouter', ...desc('Staff : ajouter un membre à ce ticket', 'Staff: add a member to this ticket'), options: [optionMembre] },
  { type: T.SOUS_COMMANDE, name: 'retirer', ...desc('Staff : retirer un membre de ce ticket', 'Staff: remove a member from this ticket'), options: [optionMembre] },
  { type: T.SOUS_COMMANDE, name: 'renommer', ...desc('Staff : renommer le salon du ticket', 'Staff: rename the ticket channel'), options: [{ type: T.CHAINE, name: 'nom', ...desc('Nouveau nom du salon', 'New channel name'), required: true, min_length: 2, max_length: 90 }] },
  { type: T.SOUS_COMMANDE, name: 'priorite', ...desc('Staff : changer la priorité', 'Staff: change the priority'), options: [{ type: T.CHAINE, name: 'niveau', ...desc('Niveau d’urgence', 'Urgency level'), required: true, choices: NIVEAUX_PRIORITE }] },
  { type: T.SOUS_COMMANDE, name: 'transferer', ...desc('Staff : changer la catégorie du ticket', 'Staff: move the ticket to another category'), options: [{ ...optionCategorie, required: true }] },
  { type: T.SOUS_COMMANDE, name: 'rouvrir', ...desc('Staff : rouvrir ce ticket fermé', 'Staff: reopen this closed ticket') },
  { type: T.SOUS_COMMANDE, name: 'transcript', ...desc('Staff : recevoir le transcript en message privé', 'Staff: get the transcript by direct message') },
  { type: T.SOUS_COMMANDE, name: 'note', ...desc('Staff : note interne (jamais visible de l’auteur)', 'Staff: internal note (never shown to the author)'), options: [{ type: T.CHAINE, name: 'texte', ...desc('Texte de la note', 'Note text'), required: true, max_length: 1500 }] },
  { type: T.SOUS_COMMANDE, name: 'attente', ...desc('Staff : en attente de la réponse de l’auteur', 'Staff: waiting for the author’s reply') },
  { type: T.SOUS_COMMANDE, name: 'stats', ...desc('Staff : statistiques des tickets (30 jours)', 'Staff: ticket statistics (30 days)') },
  { type: T.SOUS_COMMANDE, name: 'panneau', ...desc('Admin : republier un panneau des tickets', 'Admin: republish a ticket panel'), options: [{ type: T.CHAINE, name: 'panneau', ...desc('Le panneau', 'The panel'), required: false, autocomplete: true }] },
];
COMMANDES.push(
  { name: 'ticket', ...desc('Tickets du support', 'Support tickets'), contexts: SERVEUR, options: SOUS_COMMANDES_TICKET },
  {
    name: 'tickets',
    ...desc('Tes tickets ouverts (ou la file du staff)', 'Your open tickets (or the staff queue)'),
    contexts: SERVEUR,
    options: [{ type: T.CHAINE, name: 'liste', ...desc('Quelle liste', 'Which list'), required: false, choices: [choix('Mes tickets', 'My tickets', 'mes'), choix('File du staff (non pris en charge)', 'Staff queue (unclaimed)', 'file')] }],
  },
);

/** Définitions telles que Discord les attend (commandes de type 1, « chat input »). */
export function definitionsCommandes() {
  return COMMANDES.map(c => ({ type: 1, integration_types: [0], ...c }));
}
