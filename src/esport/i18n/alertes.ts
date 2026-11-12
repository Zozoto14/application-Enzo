/**
 * Textes des avis de tickets et des alertes techniques du centre de notifications (migration 0077,
 * docs/esport/notifications.md « Alertes et avis »), en français et en anglais : phrases, types listés dans les
 * préférences. À part des dictionnaires principaux ; TypeScript refuse une clé anglaise manquante.
 */

import { interpoler, langueCourante, type Variables } from './index';

const fr = {
  // Préférences : un interrupteur par type
  titre: 'Avis et alertes',
  aide: 'Coupez un type précis : il disparaît de la liste et de la pastille. Seuls les types que votre rôle permet de recevoir sont proposés.',
  'type.tk-avis': 'Avis sur un ticket',
  'type_aide.tk-avis': 'Un auteur a noté un ticket fermé (1 à 5).',
  'type.salon-match-alerte': 'Salons de match : alertes',
  'type_aide.salon-match-alerte': 'Équipe sans rôle Discord, staff introuvable, repère supprimé, création refusée, catégorie pleine.',
  'type.vocal-alerte': 'Salons vocaux : erreurs',
  'type_aide.vocal-alerte': 'Création ou suppression refusée, accès passe-partout, hiérarchie des rôles.',
  'type.role-evenement-alerte': 'Rôles d’événement : erreurs',
  'type_aide.role-evenement-alerte': 'Création, attribution, suppression ou placement d’un rôle Discord d’équipe refusé.',
  'type.role-temp-alerte': 'Rôles temporaires : erreurs',
  'type_aide.role-temp-alerte': 'Retrait à l’échéance impossible, hiérarchie des rôles (/role-temp).',
  'recevoir': 'Recevoir : {type}',
  // Phrases
  avis: 'Ticket n° {numero} noté {note}/5 par son auteur{categorie}',
  'sujet.salon-match-alerte': 'Salon de match',
  'sujet.vocal-alerte': 'Salons vocaux',
  'sujet.role-evenement-alerte': 'Rôles de l’événement',
  'sujet.role-temp-alerte': 'Rôles temporaires',
  alerte: '{sujet} : {cause}{compteur}',
  alerte_quoi: '{sujet} ({quoi}) : {cause}{compteur}',
  compteur: ' (×{n})',
  'quoi.creation': 'création',
  'quoi.suppression': 'suppression',
  'quoi.position': 'placement',
  'quoi.placement': 'placement',
  'quoi.attribution': 'attribution',
  'quoi.renommage': 'renommage',
  'quoi.hub-introuvable': 'hub',
  'quoi.passe-partout': 'accès passe-partout',
  'quoi.expiration': 'retrait à l’échéance',
  'quoi.octroi': 'attribution du rôle',
  'quoi.retrait': 'retrait du rôle',
  'cause.hierarchie': 'Discord refuse (permissions du bot ou position de son rôle)',
  'cause.injoignable': 'Discord injoignable',
  'cause.discord_injoignable': 'Discord injoignable',
  'cause.categorie-pleine': 'catégorie pleine (50 salons)',
  'cause.equipe-sans-role': 'équipe sans rôle Discord ({nom})',
  'cause.staff-introuvable': 'staff introuvable sur le serveur ({nom})',
  'cause.ancre-supprimee': 'salon repère supprimé sur Discord',
  'cause.gerer_roles_manquant': 'le bot n’a pas la permission « Gérer les rôles »',
  'cause.role_gere': 'rôle géré par une intégration',
  'cause.role_introuvable': 'rôle introuvable sur le serveur',
  'cause.discord_refus': 'Discord a refusé',
  'cause.autre': 'erreur Discord (HTTP {statut})',
  creation_refusee: 'création refusée : {cause}',
};

const en: Record<keyof typeof fr, string> = {
  titre: 'Reviews and alerts',
  aide: 'Turn off a specific type: it disappears from the list and the badge. Only the types your role lets you receive are shown.',
  'type.tk-avis': 'Ticket reviews',
  'type_aide.tk-avis': 'An author rated a closed ticket (1 to 5).',
  'type.salon-match-alerte': 'Match channels: alerts',
  'type_aide.salon-match-alerte': 'Team without a Discord role, staff not found, anchor channel deleted, creation refused, category full.',
  'type.vocal-alerte': 'Voice channels: errors',
  'type_aide.vocal-alerte': 'Creation or deletion refused, pass-through access, role hierarchy.',
  'type.role-evenement-alerte': 'Event roles: errors',
  'type_aide.role-evenement-alerte': 'Creating, giving, deleting or placing a team Discord role was refused.',
  'type.role-temp-alerte': 'Temporary roles: errors',
  'type_aide.role-temp-alerte': 'Removal at expiry impossible, role hierarchy (/role-temp).',
  recevoir: 'Receive: {type}',
  avis: 'Ticket #{numero} rated {note}/5 by its author{categorie}',
  'sujet.salon-match-alerte': 'Match channel',
  'sujet.vocal-alerte': 'Voice channels',
  'sujet.role-evenement-alerte': 'Event roles',
  'sujet.role-temp-alerte': 'Temporary roles',
  alerte: '{sujet}: {cause}{compteur}',
  alerte_quoi: '{sujet} ({quoi}): {cause}{compteur}',
  compteur: ' (×{n})',
  'quoi.creation': 'creation',
  'quoi.suppression': 'deletion',
  'quoi.position': 'placement',
  'quoi.placement': 'placement',
  'quoi.attribution': 'assignment',
  'quoi.renommage': 'renaming',
  'quoi.hub-introuvable': 'hub',
  'quoi.passe-partout': 'pass-through access',
  'quoi.expiration': 'removal at expiry',
  'quoi.octroi': 'giving the role',
  'quoi.retrait': 'removing the role',
  'cause.hierarchie': 'Discord refuses (bot permissions or the position of its role)',
  'cause.injoignable': 'Discord unreachable',
  'cause.discord_injoignable': 'Discord unreachable',
  'cause.categorie-pleine': 'category full (50 channels)',
  'cause.equipe-sans-role': 'team without a Discord role ({nom})',
  'cause.staff-introuvable': 'staff not found on the server ({nom})',
  'cause.ancre-supprimee': 'anchor channel deleted on Discord',
  'cause.gerer_roles_manquant': 'the bot lacks the “Manage Roles” permission',
  'cause.role_gere': 'role managed by an integration',
  'cause.role_introuvable': 'role not found on the server',
  'cause.discord_refus': 'Discord refused',
  'cause.autre': 'Discord error (HTTP {statut})',
  creation_refusee: 'creation refused: {cause}',
};

export type CleAl = keyof typeof fr;
const DICTIONNAIRES = { fr, en } as const;

/** Traduit une clé des alertes (clé inconnue : rendue telle quelle). */
export function trAl(cle: CleAl, vars?: Variables): string {
  return interpoler((DICTIONNAIRES[langueCourante()] as Record<string, string>)[cle] ?? (fr as Record<string, string>)[cle] ?? cle, vars);
}

/** La clé existe-t-elle (pour tomber sur une phrase générale quand un code est nouveau) ? */
export const aCleAl = (cle: string): cle is CleAl => Object.prototype.hasOwnProperty.call(fr, cle);
