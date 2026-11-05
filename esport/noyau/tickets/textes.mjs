/**
 * Tickets : textes du bot (français et anglais) et composition des messages BILINGUES.
 *
 * Messages du salon d'un ticket, MP et panneaux : les deux langues dans le même message, réglage « Langue des
 * messages » (Tickets › Configuration › Général) :
 *  - `auteur` (défaut) : la langue de la personne d'abord (locale de son client Discord, ou la langue de son compte
 *    Esport lié), l'autre langue dessous, en citation (plus discrète) ;
 *  - `en_fr` / `fr_en` : toujours cet ordre ; `fr` / `en` : une seule langue.
 * Réponses éphémères (vues par une seule personne) : sa langue seulement.
 *
 * Chaque message personnalisable a un texte par défaut ici ; un texte vide dans la configuration reprend le défaut.
 * Variables : {utilisateur} {pseudo} {numero} {categorie} {staff} {raison} {delai} {serveur} {horaires}
 * {ouverture} {fermeture} {note}. Tout ce qui vient d'un utilisateur est neutralisé (aucune mention possible).
 */

import { nettoyerTexteDiscord, nettoyerVariable } from '../discord/messages.mjs';

export const MODES_LANGUE = Object.freeze(['auteur', 'en_fr', 'fr_en', 'fr', 'en']);

/** Messages personnalisables (Configuration › Messages) et leurs défauts. */
export const MESSAGES_DEFAUT = Object.freeze({
  accueil: {
    fr: 'Bonjour {utilisateur}, merci d’avoir ouvert le ticket n° {numero} ({categorie}). Un membre du staff va vous répondre ici : décrivez votre demande en détail, vous pouvez joindre des fichiers.',
    en: 'Hi {utilisateur}, thanks for opening ticket #{numero} ({categorie}). A staff member will answer you here: describe your request in detail, you can attach files.',
  },
  prise_en_charge: { fr: '{staff} prend en charge votre ticket.', en: '{staff} is now handling your ticket.' },
  liberation: { fr: 'Le ticket n’est plus pris en charge : un autre membre du staff va reprendre.', en: 'The ticket is no longer claimed: another staff member will take over.' },
  attente: { fr: 'Le staff attend votre réponse pour continuer.', en: 'The staff is waiting for your reply to continue.' },
  fermeture: { fr: 'Ticket fermé par {staff}. Raison : {raison}', en: 'Ticket closed by {staff}. Reason: {raison}' },
  reouverture: { fr: 'Ticket rouvert par {staff}.', en: 'Ticket reopened by {staff}.' },
  avertissement: {
    fr: 'Sans nouveau message, ce ticket sera fermé automatiquement dans {delai}.',
    en: 'Without a new message, this ticket will be closed automatically in {delai}.',
  },
  demande_note: { fr: 'Comment s’est passé votre ticket n° {numero} ? Donnez une note de 1 à 5.', en: 'How did ticket #{numero} go? Rate it from 1 to 5.' },
  merci_note: { fr: 'Merci pour votre note ({note}/5) !', en: 'Thank you for your rating ({note}/5)!' },
  mp_recap: {
    fr: 'Votre ticket n° {numero} ({categorie}) sur {serveur} est fermé.\nRaison : {raison}\nOuvert le {ouverture}, fermé le {fermeture}.',
    en: 'Your ticket #{numero} ({categorie}) on {serveur} is closed.\nReason: {raison}\nOpened {ouverture}, closed {fermeture}.',
  },
  hors_horaires: {
    fr: 'Le support est fermé pour le moment ({horaires}). Nous vous répondrons dès la réouverture.',
    en: 'Support is closed right now ({horaires}). We will answer you as soon as we are back.',
  },
});
export const CLES_MESSAGES = Object.freeze(Object.keys(MESSAGES_DEFAUT));

/** Textes fixes du bot (boutons, réponses éphémères, embeds). */
const T = {
  fr: {
    ticket: 'Ticket n° {numero}',
    categorie: 'Catégorie',
    priorite: 'Priorité',
    statut: 'Statut',
    auteur: 'Auteur',
    responsable: 'Pris en charge par',
    personne: 'Personne',
    reponses: 'Réponses',
    b_prendre: 'Prendre en charge',
    b_ajouter: 'Ajouter quelqu’un',
    b_priorite: 'Priorité',
    b_fermer: 'Fermer',
    b_confirmer: 'Confirmer la fermeture',
    b_raison: 'Fermer avec une raison',
    b_annuler: 'Annuler',
    b_rouvrir: 'Rouvrir',
    p_faible: 'Faible',
    p_moyen: 'Moyenne',
    p_urgent: 'Urgente',
    p_critique: 'Critique',
    s_ouvert: 'Ouvert',
    s_pris_en_charge: 'Pris en charge',
    s_en_attente: 'En attente de réponse',
    s_resolu: 'Résolu',
    s_ferme: 'Fermé',
    choisir_categorie: 'Choisissez une catégorie',
    choisir_priorite: 'Choisissez la priorité',
    choisir_membre: 'Qui ajouter au ticket ?',
    raison: 'Raison',
    raison_placeholder: 'Pourquoi fermer ce ticket ? (facultatif)',
    raison_defaut: 'Aucune raison donnée',
    raison_inactivite: 'Fermeture automatique : inactivité',
    commentaire: 'Commentaire (facultatif)',
    commentaire_placeholder: 'Ce qui vous a plu, ce qui pourrait être mieux…',
    note_titre: 'Votre avis',
    confirmer_fermeture: 'Fermer le ticket n° {numero} ? Le salon sera archivé et un transcript enregistré.',
    cree: 'Ticket créé : {salon}',
    deja_cree: 'Votre ticket est déjà ouvert : {salon}',
    non_configure: 'Les tickets ne sont pas encore configurés sur ce serveur.',
    autre_serveur: 'Les tickets ne fonctionnent que sur le serveur du club.',
    categorie_inactive: 'Cette catégorie n’accepte plus de tickets.',
    liste_noire: 'Vous ne pouvez pas ouvrir de ticket.',
    max_ouverts: 'Vous avez déjà {n} ticket(s) ouvert(s) dans cette catégorie : {salons}',
    creation_impossible: 'Le ticket n’a pas pu être créé (permissions du bot ?). Le staff est prévenu.',
    pas_staff: 'Seul le staff de cette catégorie peut faire cela.',
    pas_ticket: 'Cette commande se tape dans le salon d’un ticket.',
    deja_ferme: 'Ce ticket est déjà fermé.',
    pas_ferme: 'Ce ticket n’est pas fermé.',
    pris: '{staff} prend en charge ce ticket.',
    deja_pris: 'Ce ticket est déjà pris en charge par {staff}.',
    libere: 'Ticket libéré.',
    priorite_changee: 'Priorité : {priorite}.',
    ajoute: '{membre} a été ajouté au ticket.',
    retire: '{membre} a été retiré du ticket.',
    renomme: 'Salon renommé : {nom}.',
    transfere: 'Ticket transféré dans la catégorie {categorie}.',
    attente_ok: 'Ticket mis en attente de réponse.',
    note_interne_ok: 'Note interne enregistrée (jamais visible de l’auteur).',
    permanent_actif: 'Ticket permanent : il ne sera jamais fermé automatiquement (aucun avertissement d’inactivité).',
    permanent_inactif: 'Ce ticket n’est plus permanent : il peut de nouveau être fermé automatiquement après une période sans message.',
    fermeture_staff: 'Seul le staff peut fermer les tickets de cette catégorie.',
    ferme_ok: 'Ticket fermé.',
    rouvert_ok: 'Ticket rouvert : {salon}',
    transcript_ok: 'Transcript du ticket n° {numero} :',
    transcript_mp: 'Transcript envoyé en message privé.',
    transcript_mp_impossible: 'Message privé impossible : ouvrez vos MP pour ce serveur, puis réessayez.',
    panneau_droits: 'Seul un administrateur du serveur (ou un compte qui configure les tickets) peut republier un panneau.',
    stats_ligne: '{categorie} : {ouverts} ouvert(s), {crees} créé(s), {fermes} fermé(s)',
    commande_desactivee: 'Cette commande est désactivée.',
    commande_interdite: 'Vous n’avez pas le rôle nécessaire pour cette commande.',
    mes_tickets: 'Vos tickets ouverts',
    aucun_ticket: 'Aucun ticket ouvert.',
    file: 'Tickets non pris en charge',
    file_vide: 'Tous les tickets sont pris en charge.',
    stats: 'Statistiques des tickets (30 jours)',
    stats_ouverts: 'Ouverts',
    stats_crees: 'Créés',
    stats_fermes: 'Fermés',
    stats_reponse: 'Délai de 1re réponse (médian)',
    stats_resolution: 'Délai de résolution (médian)',
    stats_note: 'Satisfaction moyenne',
    panneau_publie: 'Panneau publié.',
    panneau_introuvable: 'Panneau introuvable.',
    nom_invalide: 'Nom de salon invalide.',
    note_merci: 'Merci !',
    deja_note: 'Vous avez déjà noté ce ticket.',
    erreur: 'Impossible pour le moment. Réessayez dans un instant.',
    lien_app: 'Ouvrir dans l’app',
    staff_prefixe: 'Staff · {pseudo}',
    piece_jointe: 'Pièce jointe',
    journal_ouvert: 'Ticket n° {numero} ouvert par {auteur} ({categorie})',
    journal_ferme: 'Ticket n° {numero} fermé par {staff} : {raison}',
    journal_note: 'Ticket n° {numero} noté {note}/5',
    duree_h: '{n} h',
    duree_j: '{n} j',
    mp_nouveau: 'Nouveau ticket n° {numero} ({categorie}) : {salon}',
    mp_message: 'Nouveau message de {auteur} dans le ticket n° {numero} : {salon}',
  },
  en: {
    ticket: 'Ticket #{numero}',
    categorie: 'Category',
    priorite: 'Priority',
    statut: 'Status',
    auteur: 'Author',
    responsable: 'Handled by',
    personne: 'Nobody',
    reponses: 'Answers',
    b_prendre: 'Claim',
    b_ajouter: 'Add someone',
    b_priorite: 'Priority',
    b_fermer: 'Close',
    b_confirmer: 'Confirm closing',
    b_raison: 'Close with a reason',
    b_annuler: 'Cancel',
    b_rouvrir: 'Reopen',
    p_faible: 'Low',
    p_moyen: 'Medium',
    p_urgent: 'Urgent',
    p_critique: 'Critical',
    s_ouvert: 'Open',
    s_pris_en_charge: 'Claimed',
    s_en_attente: 'Waiting for reply',
    s_resolu: 'Resolved',
    s_ferme: 'Closed',
    choisir_categorie: 'Pick a category',
    choisir_priorite: 'Pick the priority',
    choisir_membre: 'Who should be added to the ticket?',
    raison: 'Reason',
    raison_placeholder: 'Why close this ticket? (optional)',
    raison_defaut: 'No reason given',
    raison_inactivite: 'Closed automatically: inactivity',
    commentaire: 'Comment (optional)',
    commentaire_placeholder: 'What you liked, what could be better…',
    note_titre: 'Your feedback',
    confirmer_fermeture: 'Close ticket #{numero}? The channel will be archived and a transcript saved.',
    cree: 'Ticket created: {salon}',
    deja_cree: 'Your ticket is already open: {salon}',
    non_configure: 'Tickets are not configured on this server yet.',
    autre_serveur: 'Tickets only work on the club’s server.',
    categorie_inactive: 'This category no longer accepts tickets.',
    liste_noire: 'You cannot open a ticket.',
    max_ouverts: 'You already have {n} open ticket(s) in this category: {salons}',
    creation_impossible: 'The ticket could not be created (bot permissions?). The staff has been told.',
    pas_staff: 'Only this category’s staff can do that.',
    pas_ticket: 'Use this command in a ticket channel.',
    deja_ferme: 'This ticket is already closed.',
    pas_ferme: 'This ticket is not closed.',
    pris: '{staff} is handling this ticket.',
    deja_pris: 'This ticket is already handled by {staff}.',
    libere: 'Ticket released.',
    priorite_changee: 'Priority: {priorite}.',
    ajoute: '{membre} was added to the ticket.',
    retire: '{membre} was removed from the ticket.',
    renomme: 'Channel renamed: {nom}.',
    transfere: 'Ticket moved to the {categorie} category.',
    attente_ok: 'Ticket set to waiting for reply.',
    note_interne_ok: 'Internal note saved (never shown to the author).',
    permanent_actif: 'Permanent ticket: it will never be closed automatically (no inactivity warning).',
    permanent_inactif: 'This ticket is no longer permanent: it can be closed automatically again after a period without messages.',
    fermeture_staff: 'Only the staff can close tickets in this category.',
    ferme_ok: 'Ticket closed.',
    rouvert_ok: 'Ticket reopened: {salon}',
    transcript_ok: 'Transcript of ticket #{numero}:',
    transcript_mp: 'Transcript sent by direct message.',
    transcript_mp_impossible: 'Direct message impossible: open your DMs for this server, then try again.',
    panneau_droits: 'Only a server administrator (or an account that configures tickets) can republish a panel.',
    stats_ligne: '{categorie}: {ouverts} open, {crees} created, {fermes} closed',
    commande_desactivee: 'This command is disabled.',
    commande_interdite: 'You don’t have the role needed for this command.',
    mes_tickets: 'Your open tickets',
    aucun_ticket: 'No open ticket.',
    file: 'Unclaimed tickets',
    file_vide: 'Every ticket is claimed.',
    stats: 'Ticket statistics (30 days)',
    stats_ouverts: 'Open',
    stats_crees: 'Created',
    stats_fermes: 'Closed',
    stats_reponse: 'Time to first reply (median)',
    stats_resolution: 'Time to resolution (median)',
    stats_note: 'Average satisfaction',
    panneau_publie: 'Panel published.',
    panneau_introuvable: 'Panel not found.',
    nom_invalide: 'Invalid channel name.',
    note_merci: 'Thank you!',
    deja_note: 'You already rated this ticket.',
    erreur: 'Not possible right now. Try again in a moment.',
    lien_app: 'Open in the app',
    staff_prefixe: 'Staff · {pseudo}',
    piece_jointe: 'Attachment',
    journal_ouvert: 'Ticket #{numero} opened by {auteur} ({categorie})',
    journal_ferme: 'Ticket #{numero} closed by {staff}: {raison}',
    journal_note: 'Ticket #{numero} rated {note}/5',
    duree_h: '{n} h',
    duree_j: '{n} d',
    mp_nouveau: 'New ticket #{numero} ({categorie}): {salon}',
    mp_message: 'New message from {auteur} in ticket #{numero}: {salon}',
  },
};

export const langueDe = l => (l === 'fr' ? 'fr' : 'en');

/** Remplace les {variables} (valeurs déjà sûres : mentions construites par le bot, textes neutralisés). */
export function remplir(modele, vars = {}) {
  return String(modele ?? '').replace(/\{([a-z_]+)\}/g, (tout, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : tout));
}

/** Texte fixe du bot dans une langue. */
export function t(langue, cle, vars) {
  return remplir(T[langueDe(langue)][cle] ?? T.fr[cle] ?? cle, vars);
}

/** Ordre des langues d'un message bilingue. */
export function ordreLangues(mode, langue) {
  if (mode === 'fr') return ['fr'];
  if (mode === 'en') return ['en'];
  if (mode === 'fr_en') return ['fr', 'en'];
  if (mode === 'en_fr') return ['en', 'fr'];
  return langueDe(langue) === 'fr' ? ['fr', 'en'] : ['en', 'fr'];
}

/**
 * Compose un texte bilingue : `textes` = { fr, en } (ou une fonction langue → texte). La seconde langue est mise en
 * citation sous la première (lisible, et distincte d'un coup d'œil). Borné à `max` caractères.
 */
export function bilingue(textes, { mode = 'auteur', langue = 'en', max = 4000 } = {}) {
  const lire = l => (typeof textes === 'function' ? textes(l) : textes?.[l]) ?? '';
  const [a, b] = ordreLangues(mode, langue).map(l => String(lire(l)).trim());
  const premier = a || b;
  if (!b || !a || a === b) return premier.slice(0, max);
  const cite = b.split('\n').map(ligne => `> ${ligne}`).join('\n');
  const tout = `${a}\n\n${cite}`;
  return tout.length <= max ? tout : a.slice(0, max);
}

/** Texte fixe dans les deux langues (bilingue). */
export const tt = (cle, vars, opts) => bilingue(l => t(l, cle, vars), opts);

/** Libellé court bilingue (boutons, options de menu : « Fermer · Close »), borné. */
export function libelle2(cle, { mode = 'auteur', langue = 'en', max = 80 } = {}) {
  const ordre = ordreLangues(mode, langue);
  const textes = [...new Set(ordre.map(l => t(l, cle)))];
  return textes.join(' · ').slice(0, max);
}

/** Même chose pour un couple de textes { fr, en } fournis (noms de catégories). */
export function nom2({ fr, en }, { mode = 'auteur', langue = 'en', max = 80 } = {}) {
  const ordre = ordreLangues(mode, langue);
  const textes = [...new Set(ordre.map(l => String((l === 'fr' ? fr : en) || fr || en || '').trim()).filter(Boolean))];
  return textes.join(' · ').slice(0, max);
}

/** Message personnalisable : texte réglé (s'il n'est pas vide), sinon le défaut, pour une langue. */
export function messageRegle(messages, cle, langue) {
  const l = langueDe(langue);
  const regle = messages?.[cle]?.[l];
  return typeof regle === 'string' && regle.trim() ? regle : MESSAGES_DEFAUT[cle]?.[l] ?? '';
}

/** Message personnalisable composé dans les deux langues, variables remplies. */
export function messageBilingue(messages, cle, vars, opts) {
  return bilingue(l => remplir(messageRegle(messages, cle, l), typeof vars === 'function' ? vars(l) : vars), opts);
}

/** Texte venu d'un utilisateur, rendu inoffensif (mentions, liens masqués) et borné. */
export const sur = (v, max = 200) => nettoyerVariable(String(v ?? '')).slice(0, max);
/** Texte long (plusieurs lignes) venu d'un utilisateur : mentions neutralisées, borné. */
export const surLong = (v, max = 2000) => nettoyerTexteDiscord(String(v ?? ''), max);

/** Durée lisible (heures, ou jours au-delà de 48 h). */
export function duree(langue, heures) {
  const h = Math.max(1, Math.round(Number(heures) || 0));
  return h >= 48 && h % 24 === 0 ? t(langue, 'duree_j', { n: h / 24 }) : t(langue, 'duree_h', { n: h });
}
