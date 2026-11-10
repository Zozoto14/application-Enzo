/**
 * Rôles temporaires : textes du bot (français et anglais). Réponses éphémères : la langue de la personne ; message
 * privé et journaux publiés dans un salon : les deux langues selon le réglage « Langue des messages » des tickets
 * (tickets/textes.mjs, `bilingue`). Aucun emoji : le bot reste sobre. Les noms de rôles viennent de Discord et sont
 * affichés tels quels (Unicode fantaisie compris).
 */

import { bilingue, remplir } from '../tickets/textes.mjs';

const T = {
  fr: {
    donne_ok: 'Le rôle **{role}** est donné à {membre} pour {team}, jusqu’au {fin} ({relatif}).',
    prolonge_ok: '{membre} a déjà le rôle **{role}** ({team}) : il est conservé jusqu’au {fin} ({relatif}).',
    retire_ok: 'Le rôle **{role}** est retiré à {membre} ({team}).',
    retire_deja: 'Le rôle **{role}** n’était plus sur {membre} ({team}) : l’octroi est clos.',
    liste_titre: '**{team}** : rôle **{role}**, {n} actif(s) sur {max}.',
    liste_ligne: '{membre} : fin {relatif}{raison}',
    liste_vide: 'Aucun rôle temporaire actif pour {team}.',
    lier: 'Lie d’abord ton compte Esport à Discord avec /lier (code dans l’app : Mon profil › Lier mon Discord).',
    pas_autorise: 'Tu n’as pas le droit de donner un rôle temporaire : il faut être Coach, Manager ou Propriétaire d’une team (ou un rôle autorisé dans les réglages de la team).',
    non_configure: 'Les rôles temporaires ne sont pas activés pour ta team : choisis le rôle Discord dans les réglages Discord de la team (ou Administration › Bot Esport HQ).',
    equipe_ambigue: 'Tu fais partie de plusieurs teams : précise l’option « equipe » ({liste}).',
    equipe_inconnue: 'Cette team n’existe pas parmi les tiennes pour cette commande ({liste}).',
    autre_serveur: 'Cette commande ne fonctionne que sur le serveur Discord de la team.',
    commande_desactivee: 'Cette commande est désactivée.',
    commande_interdite: 'Cette commande est réservée à certains rôles.',
    pas_bot: 'Choisis une personne, pas un bot.',
    duree_invalide: 'Durée invalide : indique par exemple 24h, 90m, 2j (de {min} à {max}).',
    duree_hors_limites: 'Durée hors limites : de {min} à {max}.',
    max_atteint: 'Limite atteinte : {max} personne(s) en même temps avec ce rôle pour {team}. Retire-en une (/role-temp retirer) ou attends une échéance.',
    aucun_octroi: '{membre} n’a pas de rôle temporaire actif dans tes teams.',
    membre_absent: '{membre} n’est pas (ou plus) sur le serveur Discord.',
    role_introuvable: 'Le rôle réglé pour la team n’existe plus sur Discord : choisis-en un autre dans les réglages de la team.',
    role_gere: 'Le rôle réglé est géré par une intégration (bot, abonnement) : Discord ne permet pas de le donner. Choisis un autre rôle.',
    gerer_roles_manquant: 'Le bot n’a pas la permission « Gérer les rôles » sur le serveur : ajoute-la au rôle du bot Esport HQ.',
    hierarchie: 'Le rôle du bot (**{bot}**) est au même niveau ou sous le rôle **{role}** : dans Paramètres du serveur › Rôles, glisse « {bot} » au-dessus de « {role} », puis réessaie.',
    limite: 'Discord limite les requêtes : réessaie dans {secondes} s.',
    discord_injoignable: 'Discord est injoignable pour le moment, réessaie dans un instant.',
    discord_refus: 'Discord a refusé l’action (code {statut}) : vérifie les permissions du bot et la position de son rôle.',
    sans_bot: 'Le bot n’est pas configuré sur le serveur de l’app.',
    erreur: 'Une erreur est survenue, réessaie.',
    // Message privé à la personne
    mp_donne: 'Tu as reçu le rôle **{role}** sur le serveur **{serveur}** ({team}), jusqu’au {fin} ({relatif}). Il sera retiré automatiquement.',
    // Journaux (salon)
    j_donne: '{par} a donné le rôle **{role}** à {membre} ({team}) jusqu’au {fin}.{raison}',
    j_prolonge: '{par} a prolongé le rôle **{role}** de {membre} ({team}) jusqu’au {fin}.{raison}',
    j_retire: '{par} a retiré le rôle **{role}** de {membre} ({team}).',
    j_expire: 'Le rôle **{role}** de {membre} ({team}) est arrivé à échéance et a été retiré.',
    j_echec: 'Impossible de retirer le rôle **{role}** de {membre} ({team}) : {motif}. Nouvel essai automatique.',
    j_abandon: 'Abandon : le rôle **{role}** de {membre} ({team}) n’a pas pu être retiré après plusieurs essais ({motif}). Retire-le à la main sur Discord.',
    raison_prefixe: ' Raison : {raison}',
  },
  en: {
    donne_ok: 'Role **{role}** given to {membre} for {team}, until {fin} ({relatif}).',
    prolonge_ok: '{membre} already has the role **{role}** ({team}): it is kept until {fin} ({relatif}).',
    retire_ok: 'Role **{role}** removed from {membre} ({team}).',
    retire_deja: 'Role **{role}** was no longer on {membre} ({team}): the grant is closed.',
    liste_titre: '**{team}**: role **{role}**, {n} active out of {max}.',
    liste_ligne: '{membre}: ends {relatif}{raison}',
    liste_vide: 'No active temporary role for {team}.',
    lier: 'First link your Esport account to Discord with /lier (code in the app: My profile › Link my Discord).',
    pas_autorise: 'You are not allowed to give a temporary role: you must be a Coach, Manager or Owner of a team (or a role allowed in the team settings).',
    non_configure: 'Temporary roles are not enabled for your team: choose the Discord role in the team’s Discord settings (or Administration › Esport HQ Bot).',
    equipe_ambigue: 'You belong to several teams: set the “equipe” option ({liste}).',
    equipe_inconnue: 'That team is not among yours for this command ({liste}).',
    autre_serveur: 'This command only works on the team’s Discord server.',
    commande_desactivee: 'This command is disabled.',
    commande_interdite: 'This command is restricted to some roles.',
    pas_bot: 'Choose a person, not a bot.',
    duree_invalide: 'Invalid duration: enter for example 24h, 90m, 2d (from {min} to {max}).',
    duree_hors_limites: 'Duration out of limits: from {min} to {max}.',
    max_atteint: 'Limit reached: {max} people at the same time with this role for {team}. Remove one (/role-temp retirer) or wait for an expiry.',
    aucun_octroi: '{membre} has no active temporary role in your teams.',
    membre_absent: '{membre} is not (or no longer) on the Discord server.',
    role_introuvable: 'The role set for the team no longer exists on Discord: choose another one in the team settings.',
    role_gere: 'The role set is managed by an integration (bot, subscription): Discord does not allow giving it. Choose another role.',
    gerer_roles_manquant: 'The bot lacks the “Manage Roles” permission on the server: add it to the Esport HQ bot role.',
    hierarchie: 'The bot role (**{bot}**) is level with or below the role **{role}**: in Server Settings › Roles, drag “{bot}” above “{role}”, then try again.',
    limite: 'Discord is rate limiting: try again in {secondes} s.',
    discord_injoignable: 'Discord is unreachable right now, try again in a moment.',
    discord_refus: 'Discord refused the action (code {statut}): check the bot’s permissions and the position of its role.',
    sans_bot: 'The bot is not configured on the app server.',
    erreur: 'Something went wrong, try again.',
    mp_donne: 'You received the role **{role}** on the server **{serveur}** ({team}), until {fin} ({relatif}). It will be removed automatically.',
    j_donne: '{par} gave the role **{role}** to {membre} ({team}) until {fin}.{raison}',
    j_prolonge: '{par} extended the role **{role}** of {membre} ({team}) until {fin}.{raison}',
    j_retire: '{par} removed the role **{role}** from {membre} ({team}).',
    j_expire: 'The role **{role}** of {membre} ({team}) expired and was removed.',
    j_echec: 'Could not remove the role **{role}** from {membre} ({team}): {motif}. Automatic retry.',
    j_abandon: 'Giving up: the role **{role}** of {membre} ({team}) could not be removed after several tries ({motif}). Remove it by hand on Discord.',
    raison_prefixe: ' Reason: {raison}',
  },
};

export const CLES_ROLES_TEMP = Object.freeze(Object.keys(T.fr));

/** Texte fixe dans une langue (anglais pour toute autre langue que le français). */
export function tr(langue, cle, vars) {
  const l = langue === 'fr' ? 'fr' : 'en';
  return remplir(T[l][cle] ?? T.fr[cle] ?? cle, vars);
}

/** Texte publié (journal, message privé) : les deux langues selon le réglage (`mode`), `langue` d'abord en mode « auteur ». */
export const tr2 = (cle, vars, opts) => bilingue(l => tr(l, cle, vars), opts);

/** Date Discord (s'affiche dans le fuseau et la langue de chaque lecteur) : complète, ou relative. */
export const horodatage = (ms, style = 'f') => `<t:${Math.floor(ms / 1000)}:${style}>`;

/** Durée lisible (h, ou j au-delà de 48 h et multiple de 24). */
export function dureeTexte(langue, heures) {
  const h = Math.max(1, Math.round(Number(heures) || 0));
  if (h >= 48 && h % 24 === 0) return langue === 'fr' ? `${h / 24} j` : `${h / 24} d`;
  return `${h} h`;
}
