/**
 * Salons de match Discord d'un événement du club lié à un tournoi du site LigneZero (docs/esport/evenements.md,
 * « Salons de match ») — migrations 0073 et 0079.
 *
 * Réglages par événement (`club_evenements.salons_match`, fiche › « Salons de match ») : activé, catégorie Discord
 * « Matchs », modèle du nom (`{round}-{equipes}`, nettoyé), délai de suppression après la fin (30 min par défaut,
 * 5 à 1440), rappel (10 min avant), langue (celle du bot par défaut), création anticipée (0 : dès que les
 * équipes du match sont connues), rétention des historiques (0 : jusqu'à la suppression de l'événement).
 *
 * Synchronisation (`synchroniser(evenementId)`) — quasi temps réel :
 *  - POUSSÉE : le site prévient l'AppDashboard à chaque modification d'un match, lobby, phase, résultat, horaire ou
 *    staff assigné (POST /site-lz/evenement signé, site-lz/poussee.mjs) ; les matchs changés sont traités en premier,
 *    2,5 s après le dernier avis (anti-rebond, 6 s au plus) ;
 *  - RELECTURE : toutes les 60 s tant que l'événement est en cours (boucle du processus meneur, boucle-salons.mjs,
 *    tenue même sans tickets, bienvenue ni salons vocaux ; 15 s s'il reste du travail), toutes les 5 min par le cron
 *    sinon. Le pont signé (lecture seule) rend les matchs (1v1) et lobbies (N équipes) du tournoi lié, puis :
 *  - nouveau match (au moins deux équipes, pas terminé : statut « finished » ET un résultat saisi) → salon texte PRIVÉ dans la catégorie : @everyone sans accès ;
 *    rôle Discord de chaque équipe du match (voir, écrire, historique, fichiers) ; rôle staff de l'événement et rôles
 *    staff supplémentaires (en plus : gérer les messages) ; le bot (voir, écrire, intégrer des liens, fichiers,
 *    historique, gérer les messages et le salon, mentionner tout le monde s'il en a le droit). Message d'accueil (embed :
 *    match, phase, horaire `<t:…:F>` et relatif, équipes avec TAG, joueurs mentionnés, capitaines) et mention des rôles
 *    et capitaines ; rôles des équipes non mentionnables (cas des rôles créés par l'app) et bot sans « Mentionner
 *    @everyone » : les joueurs de l'équipe sont mentionnés un par un (sinon personne n'était notifié) ;
 *  - horaire, équipes (composition d'un lobby comprise), phase ou titre, lien du stream, statut (en cours) ou staff changés
 *    sur le site → embed modifié tout de suite, accès mis à jour, court message « Mise à jour » qui regroupe les
 *    changements des 30 secondes suivantes ;
 *  - rappel 10 minutes avant (une seule fois ; colonne rappel30_le de la migration 0073 inutilisée) ;
 *  - résultat saisi (match terminé) → résultat posté, suppression programmée après le délai (correction, retrait) ;
 *  - match supprimé du site → avis posté, suppression programmée après le délai ;
 *  - équipe du match sans rôle Discord (pas reliée à une équipe de l'événement) → signalée dans l'embed, staff averti ;
 *  - staff assigné au match sur le site (avec Discord lié) → accès par membre (comme le staff), mentionné dans l'embed
 *    (« Staff assigné ») ; absent du serveur ou sans Discord : signalé au staff ; assignation changée → accès et embed ;
 *  - « Placer sous le salon » (réglage facultatif) → salons créés dans la catégorie du salon repère et rangés juste sous
 *    lui par horaire (un PATCH des positions) ; repère supprimé : catégorie choisie, staff averti une fois ;
 *  - suppression due (messages en attente envoyés d'abord) → historique enregistré dans l'app, salon supprimé.
 *
 * ENVOI FIABLE (migration 0079) : aucun message n'est plus posté « au passage ». Chaque message à poster ou à modifier
 * entre dans une file persistante (`club_salons_match_envois`) avec une clé stable (salon, genre, version), DANS LA MÊME
 * transaction que l'état qui l'a décidé (un passage interrompu ne perd ni ne double rien). La file est vidée dans
 * l'ordre par salon : limite de débit (429), Discord en panne (5xx) ou réseau → réessai avec attente croissante (12
 * essais) ; un nonce Discord (`enforce_nonce`) empêche tout doublon si une réponse se perd ; plafond d'actions atteint →
 * la suite part au passage suivant (15 s). Refus (403, 50013, 50001) → surcharge du bot réparée et un nouvel essai, puis
 * raison précise notée et alerte `salon-match-alerte`. Message d'accueil supprimé à la main → reposté. Le statut des
 * envois (envoyés, en attente, en échec avec la raison) est affiché par salon ; « Renvoyer les messages en échec ».
 * Contrôle des accès à chaque passage (au plus une fois par minute) : surcharges du bot, des équipes et du staff
 * complétées si elles manquent ; « Intégrer des liens » absent au niveau du serveur → alerte (les embeds seraient vides).
 *
 * Bilan de chaque passage (« Dernier passage » dans l'app) : origine (poussée par le site, relecture, manuel), matchs et
 * lobbies lus, salons suivis, matchs sans salon par raison avec le détail (20 au plus), envois, ou la raison d'un arrêt.
 * Idempotent : une ligne par match (clé unique), un bail par événement (un seul processus à la fois), un salon créé mais
 * pas encore noté (processus arrêté net) est retrouvé par son sujet (`esport-hq:match:<clé>`) au lieu d'être recréé.
 * Borné : 5 créations et 40 actions Discord par passage, arrêt au premier refus pour limite de débit (429).
 */

import { createHash } from 'node:crypto';
import { echec, iso, jsonOu, nouvelId } from '../outils.mjs';
import { lireGeneral, instructionReglage } from '../tickets/reglages.mjs';
import { DROITS_BOT, permissionsMembre, rest } from '../tickets/discord.mjs';
import { bilingue } from '../tickets/textes.mjs';
import { idsSup } from './staff-sup.mjs';
import { codeRefusDiscord, signalerAlerte } from '../notifications/signaler.mjs';
import { ECRITS, positionsSousHub } from '../vocaux/hubs.mjs';

export const REGLAGES_DEFAUT = Object.freeze({
  actif: false,
  categorieId: null,
  modeleNom: '{round}-{equipes}',
  delaiSuppressionMin: 30,
  rappels: true,
  langue: 'bot',
  avanceH: 0,
  retentionJours: 0,
  ancreId: null,
});
export const LIMITES_SALONS = Object.freeze({ delaiMin: 5, delaiMax: 1440, modele: 80, avanceMax: 168, retentionMax: 3650, creationsParPassage: 5, actionsParPassage: 40, salonsParCategorie: 50, pagesHistorique: 20, essaisEnvoi: 12 });
/** Fenêtre de regroupement des « Mise à jour » ; anti-rebond des avis du site (attente, attente maximale). */
export const FENETRE_MAJ_MS = 30_000;
export const ANTI_REBOND_MS = 2_500;
export const ANTI_REBOND_MAX_MS = 6_000;
/** Relecture rapide (événement en cours) : toutes les 60 s, 15 s quand le passage précédent n'a pas tout fait. */
export const RELECTURE_MS = 60_000;
export const RELANCE_MS = 15_000;
/** Contrôle des accès des salons (surcharges) : au plus une fois par minute et par événement. */
const CONTROLE_ACCES_MS = 55_000;
/** Droits du bot sur le serveur (rôles mentionnables compris) : relus toutes les 10 minutes. */
const DROITS_SERVEUR_MS = 10 * 60_000;
export const LANGUES_SALONS = Object.freeze(['bot', 'fr', 'en', 'fr_en', 'en_fr']);
const ID = /^\d{5,25}$/;
const MINUTE = 60_000;
const BAIL_MS = 120_000;
const MARQUEUR = 'esport-hq:match:';

const GERER_SALONS = 1n << 4n;
const VOIR = 1n << 10n;
const ENVOYER = 1n << 11n;
const GERER_MESSAGES = 1n << 13n;
const INTEGRER = 1n << 14n;
const JOINDRE = 1n << 15n;
const HISTORIQUE = 1n << 16n;
const MENTIONNER_TOUS = 1n << 17n;
/**
 * Droits voulus pour le bot dans chaque salon de match (sa propre surcharge) : voir, écrire, intégrer des liens (sans
 * lui, Discord masque les embeds), fichiers, historique, gérer les messages et le salon ; « mentionner @everyone et tous
 * les rôles » en plus s'il l'a sur le serveur. Discord refuse qu'un bot s'accorde un droit qu'il n'a pas : on garde
 * l'intersection avec ses droits sur le serveur (droits inconnus : l'ancienne surcharge, DROITS_BOT).
 */
export const DROITS_BOT_VOULUS = VOIR | ENVOYER | INTEGRER | JOINDRE | HISTORIQUE | GERER_MESSAGES | GERER_SALONS;
export function droitsBotSalon(permsServeur) {
  if (permsServeur === null || permsServeur === undefined) return DROITS_BOT;
  const p = BigInt(permsServeur);
  return ((DROITS_BOT_VOULUS | MENTIONNER_TOUS) & p).toString();
}
export const DROITS_EQUIPE = (VOIR | ENVOYER | HISTORIQUE | JOINDRE).toString();
export const DROITS_STAFF = (VOIR | ENVOYER | HISTORIQUE | JOINDRE | GERER_MESSAGES).toString();
const DROITS_STAFF_SANS_GESTION = DROITS_EQUIPE;

// ------------------------------------------------------------------ Textes du bot (aucun emoji : le bot reste sobre)

const T = {
  fr: {
    pret: 'Votre salon de match est prêt : toutes les infos sont ci-dessous. Le staff complétera ici si besoin.',
    maj: 'Mise à jour du match : {quoi}.',
    maj_horaire: 'horaire',
    maj_equipes: 'équipes',
    maj_titre: 'phase',
    maj_stream: 'lien du stream',
    maj_statut: 'statut',
    rappel: 'Rappel : le match commence {quand}.',
    resultat: 'Résultat enregistré sur le site.',
    resultat_corrige: 'Résultat corrigé sur le site.',
    resultat_retire: 'Le résultat a été retiré sur le site : le salon reste ouvert.',
    suppression: 'Ce salon sera supprimé {quand} (l’historique reste dans l’app).',
    annule: 'Ce match a été supprimé ou annulé sur le site.',
    sans_role: 'Attention staff : équipe(s) sans rôle Discord, elles ne voient pas ce salon : {liste}. Reliez-les à une équipe de l’événement (Administration › Événements).',
    staff_introuvable: 'Attention staff : staff assigné sur le site introuvable sur le serveur Discord (pas d’accès au salon) : {liste}.',
    staff_assigne: 'Staff assigné',
    staff_absent: 'absent du serveur',
    staff_sans_discord: 'pas de Discord lié',
    maj_staff: 'staff assigné',
    mapban: 'Le map ban a été envoyé au capitaine de chaque équipe (message privé Discord). Suivez le map ban du match ici : {lien}',
    mapban_premier: '{nom} commence le map ban (tirage au sort).',
    mapban_fin_1: 'Map ban terminé. Map jouée : {liste}.',
    mapban_fin_n: 'Map ban terminé. Maps jouées, dans l’ordre : {liste}.',
    ancre_absente: 'Attention staff : le salon repère « Placer sous le salon » a été supprimé sur Discord ; les salons de match sont créés dans la catégorie choisie. Choisissez un autre salon dans l’app (Administration › Événements).',
    heure: 'Horaire',
    a_definir: 'à définir',
    statut: 'Statut',
    'statut.pending': 'à venir',
    'statut.live': 'en cours',
    'statut.finished': 'terminé',
    equipes: 'Équipes',
    capitaine: 'capitaine',
    sans_role_court: 'pas de rôle Discord : n’a pas accès au salon',
    aucun_joueur: 'aucun joueur',
    stream: 'Stream',
    vainqueur: 'Vainqueur : {nom}',
    points: '{n} pts',
    abandon: 'abandon',
    match: 'Match {n}',
    round: 'Round {n}',
    lobby: 'Lobby {n}',
    poule: 'Poule {g}',
    upper: 'Upper bracket',
    lower: 'Lower bracket',
    finale: 'Grande finale',
  },
  en: {
    pret: 'Your match channel is ready: all the details are below. The staff will add more here if needed.',
    maj: 'Match update: {quoi}.',
    maj_horaire: 'time',
    maj_equipes: 'teams',
    maj_titre: 'stage',
    maj_stream: 'stream link',
    maj_statut: 'status',
    rappel: 'Reminder: the match starts {quand}.',
    resultat: 'Result saved on the website.',
    resultat_corrige: 'Result corrected on the website.',
    resultat_retire: 'The result was removed on the website: the channel stays open.',
    suppression: 'This channel will be deleted {quand} (the history stays in the app).',
    annule: 'This match was deleted or cancelled on the website.',
    sans_role: 'Staff, heads up: team(s) without a Discord role cannot see this channel: {liste}. Link them to an event team (Administration › Events).',
    staff_introuvable: 'Staff, heads up: staff assigned on the website not found on the Discord server (no access to the channel): {liste}.',
    staff_assigne: 'Assigned staff',
    staff_absent: 'not on the server',
    staff_sans_discord: 'no linked Discord',
    maj_staff: 'assigned staff',
    mapban: 'The map ban was sent to each team captain (Discord direct message). Follow the match map ban here: {lien}',
    mapban_premier: '{nom} starts the map ban (coin toss).',
    mapban_fin_1: 'Map ban complete. Map to play: {liste}.',
    mapban_fin_n: 'Map ban complete. Maps to play, in order: {liste}.',
    ancre_absente: 'Staff, heads up: the “Place below channel” anchor was deleted on Discord; match channels are created in the chosen category. Pick another channel in the app (Administration › Events).',
    heure: 'Time',
    a_definir: 'to be decided',
    statut: 'Status',
    'statut.pending': 'upcoming',
    'statut.live': 'live',
    'statut.finished': 'finished',
    equipes: 'Teams',
    capitaine: 'captain',
    sans_role_court: 'no Discord role: no access to the channel',
    aucun_joueur: 'no player',
    stream: 'Stream',
    vainqueur: 'Winner: {nom}',
    points: '{n} pts',
    abandon: 'DNF',
    match: 'Match {n}',
    round: 'Round {n}',
    lobby: 'Lobby {n}',
    poule: 'Group {g}',
    upper: 'Upper bracket',
    lower: 'Lower bracket',
    finale: 'Grand final',
  },
};
const remplir = (s, vars = {}) => String(s).replace(/\{([a-z_]+)\}/g, (t, k) => (vars[k] ?? t));
const tl = (l, cle, vars) => remplir(T[l === 'en' ? 'en' : 'fr'][cle] ?? T.fr[cle] ?? cle, vars);

/** Mode de langue effectif : celui de l'événement, sinon celui du bot (Tickets › Général ; « auteur » : anglais puis français). */
export function modeLangue(reglages, general) {
  const m = reglages?.langue && reglages.langue !== 'bot' ? reglages.langue : general?.langue;
  return ['fr', 'en', 'fr_en', 'en_fr'].includes(m) ? m : 'en_fr';
}
const langues = mode => (mode === 'fr' ? ['fr'] : mode === 'en' ? ['en'] : mode === 'fr_en' ? ['fr', 'en'] : ['en', 'fr']);
const tx = (mode, cle, vars, max = 1900) => bilingue(l => tl(l, cle, vars), { mode, max });
/** Libellé court : « Horaire / Time » (une seule langue en mode fr / en). */
const lib = (mode, cle, vars) => [...new Set(langues(mode).map(l => tl(l, cle, vars)))].join(' / ');

// ------------------------------------------------------------------ Réglages

export function lireReglages(v) {
  const x = jsonOu(v, {}) ?? {};
  const r = { ...REGLAGES_DEFAUT };
  if (typeof x.actif === 'boolean') r.actif = x.actif;
  if (typeof x.categorieId === 'string' && ID.test(x.categorieId)) r.categorieId = x.categorieId;
  if (typeof x.modeleNom === 'string' && x.modeleNom.trim()) r.modeleNom = x.modeleNom.trim().slice(0, LIMITES_SALONS.modele);
  if (Number.isInteger(x.delaiSuppressionMin)) r.delaiSuppressionMin = Math.min(LIMITES_SALONS.delaiMax, Math.max(LIMITES_SALONS.delaiMin, x.delaiSuppressionMin));
  if (typeof x.rappels === 'boolean') r.rappels = x.rappels;
  if (LANGUES_SALONS.includes(x.langue)) r.langue = x.langue;
  if (Number.isInteger(x.avanceH)) r.avanceH = Math.min(LIMITES_SALONS.avanceMax, Math.max(0, x.avanceH));
  if (Number.isInteger(x.retentionJours)) r.retentionJours = Math.min(LIMITES_SALONS.retentionMax, Math.max(0, x.retentionJours));
  if (typeof x.ancreId === 'string' && ID.test(x.ancreId)) r.ancreId = x.ancreId;
  return r;
}

/** Valide une saisie (seuls les champs fournis changent). */
export function validerReglages(c, actuel = REGLAGES_DEFAUT) {
  if (!c || typeof c !== 'object') throw echec(400, 'salons-match', 'Réglages illisibles.');
  const r = { ...actuel };
  if (c.actif !== undefined) {
    if (typeof c.actif !== 'boolean') throw echec(400, 'salons-match-actif', 'Activé : oui ou non.');
    r.actif = c.actif;
  }
  if (c.categorieId !== undefined) {
    if (c.categorieId !== null && (typeof c.categorieId !== 'string' || !ID.test(c.categorieId))) throw echec(400, 'salons-match-categorie', 'Catégorie Discord invalide.');
    r.categorieId = c.categorieId;
  }
  if (c.modeleNom !== undefined) {
    if (typeof c.modeleNom !== 'string' || !c.modeleNom.trim() || c.modeleNom.length > LIMITES_SALONS.modele) throw echec(400, 'salons-match-modele', `Modèle du nom : 1 à ${LIMITES_SALONS.modele} caractères.`);
    r.modeleNom = c.modeleNom.trim();
  }
  const entier = (v, min, max, code, msg) => {
    if (!Number.isInteger(v) || v < min || v > max) throw echec(400, code, msg);
    return v;
  };
  if (c.delaiSuppressionMin !== undefined) r.delaiSuppressionMin = entier(c.delaiSuppressionMin, LIMITES_SALONS.delaiMin, LIMITES_SALONS.delaiMax, 'salons-match-delai', `Délai de suppression : ${LIMITES_SALONS.delaiMin} à ${LIMITES_SALONS.delaiMax} minutes.`);
  if (c.rappels !== undefined) {
    if (typeof c.rappels !== 'boolean') throw echec(400, 'salons-match-rappels', 'Rappels : oui ou non.');
    r.rappels = c.rappels;
  }
  if (c.langue !== undefined) {
    if (!LANGUES_SALONS.includes(c.langue)) throw echec(400, 'salons-match-langue', 'Langue inconnue.');
    r.langue = c.langue;
  }
  if (c.avanceH !== undefined) r.avanceH = entier(c.avanceH, 0, LIMITES_SALONS.avanceMax, 'salons-match-avance', `Création anticipée : 0 à ${LIMITES_SALONS.avanceMax} heures.`);
  if (c.retentionJours !== undefined) r.retentionJours = entier(c.retentionJours, 0, LIMITES_SALONS.retentionMax, 'salons-match-retention', `Rétention : 0 à ${LIMITES_SALONS.retentionMax} jours.`);
  if (c.ancreId !== undefined) {
    if (c.ancreId !== null && (typeof c.ancreId !== 'string' || !ID.test(c.ancreId))) throw echec(400, 'salons-match-ancre', 'Salon repère invalide.');
    r.ancreId = c.ancreId;
  }
  if (r.actif && !r.categorieId && !r.ancreId) throw echec(400, 'salons-match-categorie', 'Choisissez la catégorie Discord des salons de match.');
  return r;
}

// ------------------------------------------------------------------ Matchs du site (forme commune 1v1 / lobby)

const minuscule = s =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Nom de salon Discord : minuscules, chiffres et tirets, 100 caractères au plus. */
export function nomSalon(modele, vars) {
  const brut = remplir(modele || REGLAGES_DEFAUT.modeleNom, vars);
  const s = minuscule(brut)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100)
    .replace(/-$/, '');
  return s || 'match';
}

/** Titre lisible d'un match (dans la langue `l`). */
function titreDe(m, l) {
  if (m.genre === 'lobby') return [m.label || tl(l, 'lobby', { n: m.position }), tl(l, 'round', { n: m.round })].join(' · ');
  const phase = m.groupe ? tl(l, 'poule', { g: m.groupe }) : m.bracket === 'loser' ? tl(l, 'lower') : m.bracket === 'final' ? tl(l, 'finale') : m.bracket === 'winner' ? tl(l, 'upper') : m.phase || '';
  return [phase, tl(l, 'round', { n: m.round }), tl(l, 'match', { n: m.position })].filter(Boolean).join(' · ');
}

const URL_SITE = 'https://lz.appdashboard.fr';
const json = v => {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};

/**
 * Map ban d'un match ou lobby, tel que l'annonce du salon en a besoin : `{ mapban: { id, lien, premierId, termine,
 * maps } }` (ou rien). `lien` : page PUBLIQUE de suivi du site, sans jeton (les liens des capitaines, qui permettent de
 * jouer leur tour, ne quittent jamais leurs messages privés ; la vue du site ne les expose pas non plus). `maps` : les
 * maps à jouer une fois le map ban terminé, dans l'ordre (picks, puis map restante).
 */
export function mapbanDe(lignes, col, id, urlSite = URL_SITE) {
  const l = (lignes ?? []).find(x => x[col] === id && /^[A-Za-z0-9_-]{6,40}$/.test(String(x.mapban_id ?? '')));
  if (!l) return {};
  const pool = Array.isArray(json(l.pool)) ? json(l.pool) : [];
  const actions = Array.isArray(json(l.actions)) ? json(l.actions) : [];
  const termine = Boolean(l.termine_le);
  const nom = mid => String(pool.find(p => p.id === mid)?.nom ?? '').slice(0, 60);
  const restantes = pool.filter(p => !actions.some(a => a.map === p.id));
  const maps = termine ? [...actions.filter(a => a.type === 'pick').map(a => nom(a.map)), ...(restantes.length === 1 ? [nom(restantes[0].id)] : [])].filter(Boolean) : [];
  const base = /^https?:\/\//.test(String(urlSite)) ? String(urlSite).replace(/\/$/, '') : URL_SITE;
  return { mapban: { id: String(l.mapban_id), lien: `${base}/mapban/${l.mapban_id}`, premierId: l.premier_team_id ?? null, termine, maps } };
}

/**
 * Lit les matchs et lobbies du tournoi lié (pont signé, lecture seule). Rend `{ matchs, equipes }` : `matchs` =
 * [{ cle, genre, siteId, round, position, groupe, bracket, label, phase, equipes: [teamId], statut, prevu, stream,
 * staff: [{ nom, discordId }], resultat }], `equipes` = Map(teamId → { id, nom, tag, joueurs }). Lève si le site ne répond pas (rien n'est alors
 * considéré comme supprimé).
 */
export async function lireMatchsSite(site, tournoiId) {
  const parT = [{ col: 'tournament_id', op: 'eq', val: tournoiId }];
  const ordre = [{ col: 'round', asc: true }, { col: 'position', asc: true }];
  const [m1, lobbies, equipesS, phases, staffS, mapbans] = await Promise.all([
    site.lister('tournament_matches', parT, ordre),
    site.lister('tournament_lobbies', parT, ordre),
    site.lister('tournament_teams', parT),
    site.lister('tournament_stages', parT).catch(() => []),
    // Staff assigné (site à jour, migration 0008) : nom affiché et Discord ID ; ancien site : aucun.
    site.lister('tournament_match_staff_discord', parT).catch(() => []),
    // Map ban lancé (site à jour, migration 0010) : identifiant, équipe qui commence, maps ; ancien site : aucun.
    site.lister('tournament_match_mapban', parT).catch(() => []),
  ]);
  const staffDe = (col, id) =>
    staffS
      .filter(x => x[col] === id)
      .map(x => ({ nom: String(x.display_name ?? '').slice(0, 100), discordId: ID.test(String(x.discord_id ?? '')) ? String(x.discord_id) : null }))
      .sort((a, b) => String(a.discordId ?? a.nom).localeCompare(String(b.discordId ?? b.nom)))
      .slice(0, 20);
  const entrees = lobbies.length ? await site.lister('tournament_lobby_entries', [{ col: 'lobby_id', op: 'in', val: lobbies.map(l => l.id) }], [{ col: 'sort_order', asc: true }]) : [];
  const joueurs = equipesS.length ? await site.lister('tournament_players', [{ col: 'team_id', op: 'in', val: equipesS.map(e => e.id) }], [{ col: 'sort_order', asc: true }]) : [];
  const equipes = new Map(
    equipesS.map(e => [
      e.id,
      {
        id: e.id,
        nom: String(e.name ?? ''),
        tag: String(e.tag ?? ''),
        joueurs: joueurs
          .filter(j => j.team_id === e.id)
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .map(j => ({ nom: String(j.pseudo ?? ''), discordId: ID.test(String(j.discord_id ?? '')) ? String(j.discord_id) : null, capitaine: Boolean(j.is_captain) })),
      },
    ]),
  );
  const nomsPhases = new Map(phases.map(p => [p.id, String(p.name ?? '')]));
  const matchs = [];
  for (const m of m1) {
    const ids = [m.team_a_id, m.team_b_id].filter(Boolean);
    // Terminé = statut « finished » ET un résultat (vainqueur ou score) : un statut sans résultat n'est pas un match joué.
    const fini = m.status === 'finished' && Boolean(m.winner_id || m.score_a != null || m.score_b != null);
    matchs.push({
      cle: `m:${m.id}`,
      genre: 'match',
      siteId: m.id,
      round: Number(m.round ?? 1),
      position: Number(m.position ?? 1),
      groupe: m.group_label ?? null,
      bracket: m.bracket ?? null,
      phase: m.stage_id ? (nomsPhases.get(m.stage_id) ?? '') : '',
      label: null,
      equipes: ids,
      statut: fini ? 'finished' : ['pending', 'live'].includes(m.status) ? m.status : 'pending',
      prevu: m.scheduled_at ? new Date(m.scheduled_at).toISOString() : null,
      stream: typeof m.stream_url === 'string' && /^https:\/\//.test(m.stream_url) ? m.stream_url : null,
      staff: staffDe('match_id', m.id),
      ...mapbanDe(mapbans, 'match_id', m.id, site.urlSite),
      resultat: fini ? { scores: [{ equipe: m.team_a_id, score: m.score_a ?? null }, { equipe: m.team_b_id, score: m.score_b ?? null }].filter(x => x.equipe), vainqueur: m.winner_id ?? null } : null,
    });
  }
  for (const l of lobbies) {
    const es = entrees.filter(e => e.lobby_id === l.id).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    // Terminé = statut « finished » ET au moins un placement ou un abandon saisi : « Enregistrer » sur le site sans
    // aucun résultat marquait le lobby terminé (corrigé côté site le 12/11/2026) ; un tel lobby n'a pas été joué.
    const fini = l.status === 'finished' && es.some(e => e.placement != null || e.dnf);
    matchs.push({
      cle: `l:${l.id}`,
      genre: 'lobby',
      siteId: l.id,
      round: Number(l.round ?? 1),
      position: Number(l.position ?? 1),
      groupe: null,
      bracket: null,
      phase: '',
      label: l.label ?? null,
      equipes: es.map(e => e.team_id),
      statut: fini ? 'finished' : ['pending', 'live'].includes(l.status) ? l.status : 'pending',
      prevu: l.scheduled_at ? new Date(l.scheduled_at).toISOString() : null,
      stream: typeof l.stream_url === 'string' && /^https:\/\//.test(l.stream_url) ? l.stream_url : null,
      staff: staffDe('lobby_id', l.id),
      ...mapbanDe(mapbans, 'lobby_id', l.id, site.urlSite),
      resultat: fini ? { classement: es.map(e => ({ equipe: e.team_id, placement: e.placement ?? null, points: Number(e.points ?? 0), dnf: Boolean(e.dnf) })) } : null,
    });
  }
  return { matchs, equipes };
}

/** Staff assigné dans l'empreinte. */
const cleStaff = m => (m.staff ?? []).map(x => x.discordId ?? `nom:${x.nom}`).sort();
/**
 * Empreinte de ce que montre l'embed (version 2, migration 0079) : horaire, équipes (composition d'un lobby), titre
 * (phase, round, position, poule, tableau, nom du lobby), staff assigné, lien du stream, statut.
 */
export const empreinteMatch = m => JSON.stringify({ v: 2, prevu: m.prevu ?? null, equipes: [...m.equipes].sort(), titre: [m.round, m.position, m.groupe ?? null, m.bracket ?? null, m.label ?? null, m.phase ?? ''], staff: cleStaff(m), stream: m.stream ?? null, statut: m.statut });
const empreinteResultat = m => (m.resultat ? JSON.stringify(m.resultat) : null);

/**
 * Changements entre l'empreinte enregistrée et le match lu : `quoi` (clés des textes, annoncés dans « Mise à jour »),
 * `embed` (l'embed doit être modifié), `horaire`. Empreinte d'avant la migration 0079 (tableau) : seuls ses champs
 * comptent (pas d'annonce en rafale au déploiement), puis elle est réécrite au nouveau format. Statut devenu ou quitté
 * « terminé » : annoncé par le résultat (ou son retrait), pas par « Mise à jour ».
 */
export function changementsMatch(avantTexte, m) {
  const a = jsonOu(avantTexte, null);
  const n = JSON.parse(empreinteMatch(m));
  const quoi = [];
  const diff = (x, y) => JSON.stringify(x) !== JSON.stringify(y);
  if (Array.isArray(a)) {
    if ((a[0] ?? null) !== n.prevu) quoi.push('maj_horaire');
    if (diff(a[1] ?? [], n.equipes)) quoi.push('maj_equipes');
    if (diff(a.slice(2, 7), [m.round, m.position, m.groupe ?? null, m.bracket ?? null, m.label ?? null])) quoi.push('maj_titre');
    if (diff(a[7] ?? [], n.staff)) quoi.push('maj_staff');
    return { quoi, embed: quoi.length > 0, horaire: quoi.includes('maj_horaire') };
  }
  if (!a || typeof a !== 'object') return { quoi, embed: false, horaire: false };
  if ((a.prevu ?? null) !== n.prevu) quoi.push('maj_horaire');
  if (diff(a.equipes ?? [], n.equipes)) quoi.push('maj_equipes');
  if (diff(a.titre ?? [], n.titre)) quoi.push('maj_titre');
  if (diff(a.staff ?? [], n.staff)) quoi.push('maj_staff');
  if ((a.stream ?? null) !== n.stream) quoi.push('maj_stream');
  const statutChange = (a.statut ?? null) !== n.statut;
  if (statutChange && n.statut !== 'finished' && a.statut !== 'finished') quoi.push('maj_statut');
  return { quoi, embed: quoi.length > 0 || statutChange, horaire: quoi.includes('maj_horaire') };
}

/** Nonce Discord d'un envoi (25 caractères au plus) : un réessai après une réponse perdue ne double jamais le message. */
export const nonceEnvoi = cle => createHash('sha256').update(String(cle)).digest('base64url').slice(0, 25);
/** Attente avant le réessai n° `essais` (1, 2…) : 5 s, 10 s, 20 s… jusqu'à 10 minutes. */
export const attenteReessai = essais => Math.min(10 * MINUTE, 5_000 * 2 ** Math.max(0, essais - 1));

/**
 * Classe une réponse de Discord à un envoi : `envoye`, `limite` (429), `reessai` (réseau, 5xx), `disparu` (salon
 * supprimé), `refus` (permission : 403, 50013, 50001) ou `echec` (requête refusée, sans réessai), avec la raison.
 */
export function classerEnvoi(r) {
  if (r.ok) return { etat: 'envoye' };
  if (r.statut === 429) return { etat: 'limite', raison: 'limite-debit' };
  if (!r.statut) return { etat: 'reessai', raison: 'discord-injoignable' };
  if (r.statut >= 500) return { etat: 'reessai', raison: `discord-${r.statut}` };
  if (r.code === 10003) return { etat: 'disparu', raison: 'salon-disparu' };
  if (r.code === 50001) return { etat: 'refus', raison: 'acces-50001' };
  if (r.code === 50013 || r.statut === 403) return { etat: 'refus', raison: `permission-${r.code ?? 403}` };
  if (r.statut === 404 && !r.code) return { etat: 'disparu', raison: 'salon-disparu' };
  return { etat: 'echec', raison: `discord-${r.statut}${r.code ? `-${r.code}` : ''}` };
}

// ------------------------------------------------------------------ Service

export function creerSalonsMatch({ base, site, fetch: fetchDiscord, jetonBot, botId = null, maintenant = () => Date.now(), journal = console, antiRebondMs = ANTI_REBOND_MS, antiRebondMaxMs = ANTI_REBOND_MAX_MS }) {
  const t0 = () => maintenant();

  /**
   * Alerte pour le staff de l'événement (notification `salon-match-alerte` : evenements.gerer et Fondateur, au plus une par
   * 6 h avec compteur, docs/esport/notifications.md « Alertes et avis »). `match` : le match concerné (la ligne est mise en
   * avant dans la fiche de l'événement), pris dans la clé quand le code vise un match.
   */
  const alerter = (evt, code, { match = null, parMatch = true, nom = null, statut = null } = {}) =>
    signalerAlerte(base, 'salon_match', {
      cle: `salon-match:${evt.id}:${parMatch && match ? match : '*'}:${code}`,
      charge: { code, evenement: evt.id, ...(match ? { match } : {}), ...(nom ? { nom } : {}), ...(statut !== null ? { statut } : {}) },
      maintenant: t0(),
    });

  async function ctxDiscord() {
    if (!jetonBot) return { erreur: 'bot-absent' };
    const general = await lireGeneral(base);
    if (!general.guildId) return { erreur: 'sans-serveur' };
    return { erreur: null, general, guildId: general.guildId };
  }

  // Bail par événement (table tickets_bail, id « salons-match:<id> ») : un seul processus à la fois.
  const titulaire = `sm:${process.pid}:${Math.random().toString(36).slice(2, 8)}`;
  async function prendreBail(id) {
    const t = t0();
    const cle = `salons-match:${id}`;
    await base.executer("INSERT INTO tickets_bail (id, titulaire, expire_le, maj_le) VALUES (?, NULL, '1970-01-01T00:00:00.000Z', ?) ON CONFLICT (id) DO NOTHING", [cle, iso(t)]);
    const r = await base.executer('UPDATE tickets_bail SET titulaire = ?, expire_le = ?, maj_le = ? WHERE id = ? AND (titulaire = ? OR titulaire IS NULL OR expire_le < ?)', [titulaire, iso(t + BAIL_MS), iso(t), cle, titulaire, iso(t)]);
    return Number(r.changements) === 1;
  }
  const rendreBail = id => base.executer('UPDATE tickets_bail SET expire_le = ?, maj_le = ? WHERE id = ? AND titulaire = ?', [iso(t0() - 1), iso(t0()), `salons-match:${id}`, titulaire]);

  async function lignesDe(id) {
    return base.tous('SELECT * FROM club_salons_match WHERE evenement_id = ? ORDER BY cree_le', [id]);
  }
  const maj = (id, champs) => {
    const cles = Object.keys(champs);
    return base.executer(`UPDATE club_salons_match SET ${cles.map(c => `${c} = ?`).join(', ')}, maj_le = ? WHERE id = ?`, [...cles.map(c => champs[c]), iso(t0()), id]);
  };

  /** Équipes de l'événement reliées aux équipes du site (rôle Discord, membres). Map(siteTeamId → équipe). */
  async function equipesApp(evenementId) {
    const equipes = await base.tous('SELECT id, nom, tag, role_id, site_equipe_id FROM club_evenement_equipes WHERE evenement_id = ? AND site_equipe_id IS NOT NULL', [evenementId]);
    const membres = equipes.length ? await base.tous(`SELECT equipe_id, discord_id, nom, capitaine, role_statut, position FROM club_evenement_membres WHERE equipe_id IN (${equipes.map(() => '?').join(', ')}) ORDER BY position`, equipes.map(e => e.id)) : [];
    return new Map(
      equipes.map(e => [
        String(e.site_equipe_id),
        {
          nom: e.nom,
          tag: e.tag,
          roleId: e.role_id ? String(e.role_id) : null,
          joueurs: membres.filter(m => m.equipe_id === e.id).map(m => ({ nom: m.nom || '', discordId: m.discord_id ?? null, capitaine: Number(m.capitaine ?? 0) === 1, absent: m.role_statut === 'absent' })),
        },
      ]),
    );
  }

  /** Équipes d'un match, prêtes à afficher : nom, TAG, rôle, joueurs (Discord ID, capitaine). */
  function equipesDuMatch(m, siteEquipes, app) {
    return m.equipes.map(id => {
      const s = siteEquipes.get(id);
      const a = app.get(id);
      const joueurs = a?.joueurs?.length ? a.joueurs : (s?.joueurs ?? []);
      // Capitaine coché, sinon le premier joueur (même règle que le site).
      const cap = joueurs.findIndex(j => j.capitaine);
      return { id, nom: a?.nom ?? s?.nom ?? '?', tag: a?.tag ?? s?.tag ?? '', roleId: a?.roleId ?? null, joueurs: joueurs.map((j, i) => ({ ...j, capitaine: cap >= 0 ? i === cap : i === 0 })) };
    });
  }

  function embedMatch(evt, m, equipes, mode) {
    const titre = langues(mode).map(l => titreDe(m, l)).filter((x, i, a) => a.indexOf(x) === i).join(' / ');
    const ts = m.prevu ? Math.floor(Date.parse(m.prevu) / 1000) : null;
    const lignes = [
      `**${lib(mode, 'heure')}** : ${ts ? `<t:${ts}:F> (<t:${ts}:R>)` : lib(mode, 'a_definir')}`,
      `**${lib(mode, 'statut')}** : ${lib(mode, `statut.${m.statut}`)}`,
      ...(m.stream ? [`**${lib(mode, 'stream')}** : ${m.stream}`] : []),
    ];
    const fields = equipes.slice(0, 20).map(e => {
      const joueurs = e.joueurs
        .slice(0, 10)
        .map(j => `${j.discordId && !j.absent ? `<@${j.discordId}>` : ''} ${j.nom}${j.capitaine ? ` (${lib(mode, 'capitaine')})` : ''}`.trim())
        .join('\n');
      const role = e.roleId ? `<@&${e.roleId}>` : `*${lib(mode, 'sans_role_court')}*`;
      return { name: `${e.tag ? `[${e.tag}] ` : ''}${e.nom}`.slice(0, 256), value: `${role}\n${joueurs || lib(mode, 'aucun_joueur')}`.slice(0, 1024), inline: equipes.length <= 4 };
    });
    if (m.staff?.length) {
      const liste = m.staff.map(x => (x.discordId && !x.absent ? `<@${x.discordId}>` : `${x.nom || '?'} (${lib(mode, x.discordId ? 'staff_absent' : 'staff_sans_discord')})`)).join(', ');
      fields.push({ name: lib(mode, 'staff_assigne'), value: liste.slice(0, 1024), inline: false });
    }
    return { title: titre.slice(0, 256), description: lignes.join('\n').slice(0, 4000), color: 0x5865f2, fields, footer: { text: `Esport HQ · ${String(evt.nom ?? '').slice(0, 100)}` } };
  }

  function embedResultat(m, equipes, mode) {
    const nom = id => {
      const e = equipes.find(x => x.id === id);
      return e ? `${e.tag ? `[${e.tag}] ` : ''}${e.nom}` : '?';
    };
    let lignes = [];
    if (m.resultat?.scores) {
      lignes = [m.resultat.scores.map(s => `${nom(s.equipe)} **${s.score ?? '-'}**`).join('  -  ')];
      if (m.resultat.vainqueur) lignes.push(lib(mode, 'vainqueur', { nom: nom(m.resultat.vainqueur) }));
    } else if (m.resultat?.classement) {
      lignes = [...m.resultat.classement]
        .sort((a, b) => (a.placement ?? 99) - (b.placement ?? 99))
        .map(c => `${c.placement ?? '-'}. ${nom(c.equipe)} : ${lib(mode, 'points', { n: c.points })}${c.dnf ? ` (${lib(mode, 'abandon')})` : ''}`);
    }
    return { title: titreDe(m, langues(mode)[0]).slice(0, 256), description: lignes.join('\n').slice(0, 4000), color: 0x22a879 };
  }

  // ---------------------------------------------------------------- Droits du bot sur le serveur (10 min)

  /** `{ perms (BigInt ou null), toutes (mentionner @everyone et tous les rôles), mentionnables: Set, roles }`. */
  const droitsCache = new Map();
  async function droitsServeur(d, compteur) {
    const c = droitsCache.get(d.guildId);
    if (c && t0() - c.le < DROITS_SERVEUR_MS) return c;
    const idBot = await idDuBot();
    compteur.n += 2;
    const [roles, membre] = await Promise.all([rest(fetchDiscord, jetonBot, 'GET', `/guilds/${d.guildId}/roles`), idBot ? rest(fetchDiscord, jetonBot, 'GET', `/guilds/${d.guildId}/members/${idBot}`) : Promise.resolve({ ok: false })]);
    if (roles.statut === 429 || membre.statut === 429) compteur.limite = true;
    let r = { le: t0(), perms: null, toutes: false, mentionnables: new Set() };
    if (roles.ok && Array.isArray(roles.corps)) {
      const perms = membre.ok ? permissionsMembre({ guildId: d.guildId, roles: roles.corps, membreRoles: membre.corps?.roles ?? [], salon: null, membreId: idBot }) : null;
      r = { le: t0(), perms, toutes: perms !== null && (perms & MENTIONNER_TOUS) === MENTIONNER_TOUS, mentionnables: new Set(roles.corps.filter(x => x.mentionable === true).map(x => String(x.id))) };
    } else if (c) r = { ...c, le: t0() - DROITS_SERVEUR_MS + 60_000 }; // illisible : l'ancien est gardé, nouvel essai dans 1 min
    droitsCache.set(d.guildId, r);
    return r;
  }

  /**
   * Mentions d'un message aux équipes : rôles des équipes et capitaines. Rôle non mentionnable (les rôles créés par
   * l'app le sont tous) et bot sans « Mentionner @everyone et tous les rôles » : Discord poste le message mais ne
   * notifie personne ; les joueurs présents de l'équipe sont alors mentionnés un par un. `allowed_mentions` liste
   * explicitement rôles et membres (jamais @everyone).
   */
  const pings = (equipes, droits = null) => {
    const roles = [...new Set(equipes.map(e => e.roleId).filter(Boolean))];
    const muet = r => !droits?.toutes && !droits?.mentionnables?.has(r);
    const capitaines = equipes.flatMap(e => e.joueurs.filter(j => j.capitaine && j.discordId && !j.absent).map(j => j.discordId));
    const joueurs = equipes.filter(e => e.roleId && muet(e.roleId)).flatMap(e => e.joueurs.filter(j => j.discordId && !j.absent).map(j => j.discordId));
    const users = [...new Set([...capitaines, ...joueurs])].slice(0, 100);
    return { texte: [...roles.map(r => `<@&${r}>`), ...users.map(u => `<@${u}>`)].join(' '), allowed: { parse: [], roles: roles.slice(0, 100), users }, roles, users };
  };
  const mentions = (roles = [], users = []) => ({ texte: [...roles.map(r => `<@&${r}>`), ...users.map(u => `<@${u}>`)].join(' '), allowed: { parse: [], roles: roles.slice(0, 100), users: users.slice(0, 100) } });

  function surcharges(evt, equipes, guildId, idBot, { gestion = true, assignes = [], droitsBot = DROITS_BOT } = {}) {
    const o = [{ id: guildId, type: 0, allow: '0', deny: VOIR.toString() }];
    const vus = new Set([guildId]);
    for (const e of equipes) {
      if (!e.roleId || vus.has(e.roleId)) continue;
      vus.add(e.roleId);
      o.push({ id: e.roleId, type: 0, allow: DROITS_EQUIPE, deny: '0' });
    }
    const staff = [evt.staff_role_id, ...(evt.roles_supprimes_le ? [] : idsSup(evt.staff_roles_sup))].filter(x => x && ID.test(String(x)));
    for (const r of staff) {
      if (vus.has(String(r))) continue;
      vus.add(String(r));
      o.push({ id: String(r), type: 0, allow: gestion ? DROITS_STAFF : DROITS_STAFF_SANS_GESTION, deny: '0' });
    }
    // Staff assigné au match sur le site (présent sur le serveur) : accès par membre, mêmes droits que le staff.
    for (const x of assignes) {
      if (!x.discordId || x.absent || vus.has(x.discordId) || String(x.discordId) === String(idBot)) continue;
      vus.add(x.discordId);
      o.push({ id: x.discordId, type: 1, allow: gestion ? DROITS_STAFF : DROITS_STAFF_SANS_GESTION, deny: '0' });
    }
    if (idBot) o.push({ id: String(idBot), type: 1, allow: droitsBot, deny: '0' });
    return o;
  }

  async function idDuBot() {
    if (botId) return botId;
    const r = await rest(fetchDiscord, jetonBot, 'GET', '/users/@me');
    botId = r.ok ? (r.corps?.id ?? null) : null;
    return botId;
  }

  /** Surcharge du bot remise à ses droits voulus (PUT, une requête). */
  async function reparerBot(salonId, droits, compteur) {
    const idBot = await idDuBot();
    if (!idBot) return { ok: false };
    compteur.n++;
    return rest(fetchDiscord, jetonBot, 'PUT', `/channels/${salonId}/permissions/${idBot}`, { type: 1, allow: droitsBotSalon(droits?.perms), deny: '0' }, { raison: 'Esport HQ : droits du bot dans le salon de match' });
  }

  /**
   * Contrôle des accès d'un salon (liste des salons lue au début du passage) : chaque surcharge voulue (bot, équipes,
   * staff, staff assigné, @everyone sans accès) doit porter au moins ses droits ; il manque quelque chose → complété en
   * un PATCH (les surcharges ajoutées à la main restent). Rend le nombre de surcharges réparées.
   */
  async function verifierAcces(evt, ligne, salon, m, equipes, d, droits, compteur) {
    const idBot = await idDuBot();
    const gestion = droits?.perms !== null && droits?.perms !== undefined && (droits.perms & GERER_MESSAGES) === GERER_MESSAGES;
    const voulues = surcharges(evt, equipes, d.guildId, idBot, { gestion, assignes: m.staff, droitsBot: droitsBotSalon(droits?.perms) });
    const actuelles = (salon.permission_overwrites ?? []).map(o => ({ id: String(o.id), type: Number(o.type), allow: String(o.allow ?? '0'), deny: String(o.deny ?? '0') }));
    let reparees = 0;
    for (const v of voulues) {
      const a = actuelles.find(o => o.id === v.id);
      const allow = BigInt(v.allow);
      const deny = BigInt(v.deny);
      if (!a) {
        actuelles.push({ ...v });
        reparees++;
        continue;
      }
      const aAllow = BigInt(a.allow);
      const aDeny = BigInt(a.deny);
      if ((aAllow & allow) !== allow || (aDeny & deny) !== deny || (aDeny & allow) !== 0n) {
        a.allow = ((aAllow | allow) & ~deny).toString();
        a.deny = ((aDeny | deny) & ~allow).toString();
        reparees++;
      }
    }
    if (!reparees) return 0;
    compteur.n++;
    const r = await rest(fetchDiscord, jetonBot, 'PATCH', `/channels/${ligne.salon_id}`, { permission_overwrites: actuelles }, { raison: 'Esport HQ : accès du salon de match réparés' });
    if (r.statut === 429) compteur.limite = true;
    if (!r.ok) {
      await maj(ligne.id, { erreur: `acces-${r.statut}${r.code ? `-${r.code}` : ''}` });
      if (r.code === 50013 || r.statut === 403) await alerter(evt, 'acces-hierarchie', { match: ligne.site_match_id, statut: r.statut ?? 0 });
      return 0;
    }
    salon.permission_overwrites = actuelles;
    return reparees;
  }

  /** Historique d'un salon (du plus ancien au plus récent) ; null si Discord limite le débit (réessai plus tard). */
  async function capturer(salonId) {
    const messages = [];
    let apres = '0';
    for (let page = 0; page < LIMITES_SALONS.pagesHistorique; page++) {
      const r = await rest(fetchDiscord, jetonBot, 'GET', `/channels/${salonId}/messages?limit=100&after=${apres}`);
      if (r.statut === 429) return null;
      if (!r.ok || !Array.isArray(r.corps)) return { messages, disparu: r.statut === 404 || r.code === 10003 };
      const lot = [...r.corps].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
      for (const x of lot) {
        messages.push({
          id: String(x.id),
          auteur: String(x.member?.nick || x.author?.global_name || x.author?.username || '?').slice(0, 100),
          auteurId: x.author?.id ? String(x.author.id) : null,
          bot: Boolean(x.author?.bot),
          contenu: String(x.content ?? '').slice(0, 4000),
          le: x.timestamp ?? null,
          pieces: (x.attachments ?? []).slice(0, 10).map(a => ({ nom: String(a.filename ?? 'fichier').slice(0, 200), url: String(a.url ?? '').slice(0, 1000), taille: Number(a.size ?? 0) })),
          embeds: (x.embeds ?? [])
            .slice(0, 3)
            .map(e => [e.title, e.description, ...(e.fields ?? []).map(f => `${f.name} : ${f.value}`)].filter(Boolean).join('\n').slice(0, 4000))
            .filter(Boolean),
        });
      }
      if (!lot.length || lot.length < 100) break;
      apres = String(lot[lot.length - 1].id);
    }
    return { messages, disparu: false };
  }

  /** Envois encore en attente d'un salon fermé : abandonnés (le salon n'existe plus). */
  const abandonner = (ligneId, raison) => base.executer("UPDATE club_salons_match_envois SET statut = 'abandon', erreur = ?, maj_le = ? WHERE salon_match_id = ? AND statut = 'attente'", [raison, iso(t0()), ligneId]);

  /** Enregistre l'historique puis supprime le salon. Rend 'fait', 'limite' ou 'refus'. */
  async function fermerSalon(ligne, raison = 'Esport HQ : match terminé') {
    if (!ligne.salon_id) {
      await maj(ligne.id, { statut: 'supprime', supprime_le: iso(t0()), suppression_le: null });
      await abandonner(ligne.id, 'salon-supprime');
      return 'fait';
    }
    const h = await capturer(ligne.salon_id);
    if (!h) return 'limite';
    if (!h.disparu) {
      const r = await rest(fetchDiscord, jetonBot, 'DELETE', `/channels/${ligne.salon_id}`, undefined, { raison });
      if (r.statut === 429) return 'limite';
      if (!r.ok && r.statut !== 404) {
        await maj(ligne.id, { erreur: `suppression-${r.statut}` });
        return 'refus';
      }
    }
    // Un historique déjà enregistré (salon recréé à la main) n'est pas écrasé par un historique vide.
    const garder = !h.messages.length && ligne.transcript;
    await maj(ligne.id, { statut: 'supprime', supprime_le: iso(t0()), suppression_le: null, erreur: null, ...(garder ? {} : { transcript: JSON.stringify(h.messages), nb_messages: h.messages.length }) });
    await abandonner(ligne.id, 'salon-supprime');
    return 'fait';
  }

  // ---------------------------------------------------------------- File d'envoi (migration 0079)

  /**
   * Enfile des messages pour un salon ET écrit l'état qui les a décidés (`champs` de la ligne) dans UNE transaction :
   * un passage interrompu après coup ne perd rien, un passage rejoué retrouve la même clé (salon, genre, version) et
   * n'enfile rien de plus. `ops` : `{ genre, corps, methode: 'post'|'edit', delaiMs, meta, composer }`.
   *  - `embed` (modification du message d'accueil) : la plus récente remplace celles encore en attente ; accueil pas
   *    encore parti → son embed est remplacé (une seule requête) ;
   *  - `maj` (« Mise à jour ») : part 30 s après le premier changement ; une « Mise à jour » encore en attente reçoit les
   *    changements suivants (un seul message) ;
   *  - tout autre message fait partir tout de suite une « Mise à jour » en attente (l'ordre reste lisible).
   */
  async function appliquer(ligne, ops = [], champs = {}) {
    const t = t0();
    const instr = [];
    let seq = Number(ligne.envois_seq ?? 0);
    for (const op of ops) {
      const corpsDe = meta => JSON.stringify(op.composer ? op.composer(meta) : op.corps);
      if (op.genre === 'embed') {
        const acc = await base.premier("SELECT id, corps FROM club_salons_match_envois WHERE salon_match_id = ? AND genre = 'accueil' AND statut = 'attente'", [ligne.id]);
        if (acc) {
          instr.push({ sql: 'UPDATE club_salons_match_envois SET corps = ?, maj_le = ? WHERE id = ?', params: [JSON.stringify({ ...jsonOu(acc.corps, {}), embeds: op.corps.embeds }), iso(t), acc.id] });
          continue;
        }
        instr.push({ sql: "UPDATE club_salons_match_envois SET statut = 'remplace', maj_le = ? WHERE salon_match_id = ? AND genre = 'embed' AND statut = 'attente'", params: [iso(t), ligne.id] });
      } else if (op.genre === 'maj') {
        const att = await base.premier("SELECT id, meta FROM club_salons_match_envois WHERE salon_match_id = ? AND genre = 'maj' AND statut = 'attente' AND essais = 0 ORDER BY ordre DESC", [ligne.id]);
        if (att) {
          const a = jsonOu(att.meta, {}) ?? {};
          const meta = { ...op.meta, quoi: [...new Set([...(a.quoi ?? []), ...(op.meta.quoi ?? [])])], roles: [...new Set([...(a.roles ?? []), ...(op.meta.roles ?? [])])], users: [...new Set([...(a.users ?? []), ...(op.meta.users ?? [])])] };
          instr.push({ sql: 'UPDATE club_salons_match_envois SET corps = ?, meta = ?, maj_le = ? WHERE id = ?', params: [corpsDe(meta), JSON.stringify(meta), iso(t), att.id] });
          continue;
        }
      } else {
        instr.push({ sql: "UPDATE club_salons_match_envois SET prochain_le = ?, maj_le = ? WHERE salon_match_id = ? AND genre = 'maj' AND statut = 'attente' AND prochain_le > ?", params: [iso(t), iso(t), ligne.id, iso(t)] });
      }
      seq++;
      instr.push({
        sql: "INSERT INTO club_salons_match_envois (id, cle, evenement_id, salon_match_id, genre, methode, corps, meta, ordre, statut, essais, prochain_le, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'attente', 0, ?, ?, ?) ON CONFLICT (cle) DO NOTHING",
        params: [nouvelId(), `${ligne.id}:${op.genre}:${seq}`, ligne.evenement_id, ligne.id, op.genre, op.methode ?? 'post', corpsDe(op.meta), op.meta ? JSON.stringify(op.meta) : null, seq, iso(t + (op.delaiMs ?? 0)), iso(t), iso(t)],
      });
    }
    const cles = Object.keys(champs);
    if (!instr.length && !cles.length) return;
    instr.push({ sql: `UPDATE club_salons_match SET envois_seq = ?${cles.map(c => `, ${c} = ?`).join('')}, maj_le = ? WHERE id = ?`, params: [seq, ...cles.map(c => champs[c]), iso(t), ligne.id] });
    await base.lot(instr);
    Object.assign(ligne, champs, { envois_seq: seq });
  }

  /** Texte d'une « Mise à jour » (changements regroupés, mentions réunies). */
  const composerMaj = meta => {
    const mode = meta.mode;
    const quoi = (meta.quoi ?? []).map(q => (q === 'maj_statut' && meta.statut ? `${lib(mode, q)} (${lib(mode, `statut.${meta.statut}`)})` : lib(mode, q))).join(', ');
    const p = mentions(meta.roles, meta.users);
    return { content: `${p.texte} ${tx(mode, 'maj', { quoi })}`.trim().slice(0, 2000), allowed_mentions: p.allowed };
  };

  /**
   * Vide la file d'un événement : dans l'ordre par salon, borné par le plafond d'actions du passage. Un envoi pas encore
   * dû (réessai, fenêtre de 30 s) bloque la suite de SON salon (l'ordre est gardé), pas celle des autres. Rend
   * `{ envoyes, attente, echecs }`.
   */
  async function vider(evt, d, compteur, droits = null) {
    const t = t0();
    const lignesF = await base.tous("SELECT e.*, s.salon_id AS s_salon, s.message_id AS s_message, s.statut AS s_statut, s.site_match_id AS s_match FROM club_salons_match_envois e JOIN club_salons_match s ON s.id = e.salon_match_id WHERE e.evenement_id = ? AND e.statut = 'attente' ORDER BY e.salon_match_id, e.ordre", [evt.id]);
    const res = { envoyes: 0, attente: 0, echecs: 0 };
    if (!lignesF.length) return res;
    const bloques = new Set();
    const accueils = new Map();
    const repares = new Set();
    const noter = (e, champs) => {
      const cles = Object.keys(champs);
      return base.executer(`UPDATE club_salons_match_envois SET ${cles.map(c => `${c} = ?`).join(', ')}, maj_le = ? WHERE id = ?`, [...cles.map(c => champs[c]), iso(t0()), e.id]);
    };
    for (const e of lignesF) {
      if (bloques.has(e.salon_match_id) || compteur.limite || compteur.n >= LIMITES_SALONS.actionsParPassage) {
        res.attente++;
        continue;
      }
      if (e.s_statut === 'supprime') {
        await noter(e, { statut: 'abandon', erreur: 'salon-supprime' });
        continue;
      }
      if (!e.s_salon || e.prochain_le > iso(t)) {
        // « Mise à jour » dans sa fenêtre de 30 s : ne retient pas la suite (modification de l'embed) ; un message posté
        // ensuite la fait partir d'abord (appliquer). Un réessai pas encore dû retient la suite du salon (ordre gardé).
        if (!(e.s_salon && e.genre === 'maj' && Number(e.essais) === 0)) bloques.add(e.salon_match_id);
        res.attente++;
        continue;
      }
      const corps = jsonOu(e.corps, {}) ?? {};
      const envoyer = async () => {
        compteur.n++;
        if (e.methode !== 'edit') return { r: await rest(fetchDiscord, jetonBot, 'POST', `/channels/${e.s_salon}/messages`, { ...corps, nonce: nonceEnvoi(e.cle), enforce_nonce: true }) };
        const mid = accueils.get(e.salon_match_id) ?? e.s_message;
        if (!mid) return { r: { ok: false, statut: 404, code: 10008 } };
        const r = await rest(fetchDiscord, jetonBot, 'PATCH', `/channels/${e.s_salon}/messages/${mid}`, corps);
        if (r.statut === 404 && r.code === 10008) {
          // Message d'accueil supprimé à la main : l'embed est reposté et devient le nouvel accueil.
          compteur.n++;
          const p = await rest(fetchDiscord, jetonBot, 'POST', `/channels/${e.s_salon}/messages`, { embeds: corps.embeds ?? [], allowed_mentions: { parse: [] }, nonce: nonceEnvoi(`${e.cle}:repost`), enforce_nonce: true });
          return { r: p, nouvelAccueil: p.ok };
        }
        return { r };
      };
      let { r, nouvelAccueil } = await envoyer();
      let c = classerEnvoi(r);
      // Refus de permission : la surcharge du bot est réparée (une fois par salon et par passage), puis un nouvel essai.
      if (c.etat === 'refus' && !repares.has(e.s_salon) && compteur.n < LIMITES_SALONS.actionsParPassage) {
        repares.add(e.s_salon);
        const p = await reparerBot(e.s_salon, droits, compteur);
        if (p.ok) ({ r, nouvelAccueil } = await envoyer());
        c = classerEnvoi(r);
      }
      if (c.etat === 'envoye') {
        const mid = r.corps?.id ? String(r.corps.id) : null;
        await noter(e, { statut: 'envoye', message_id: mid, envoye_le: iso(t0()), erreur: null, essais: Number(e.essais) + 1 });
        if ((e.genre === 'accueil' || nouvelAccueil) && mid) {
          accueils.set(e.salon_match_id, mid);
          await maj(e.salon_match_id, { message_id: mid });
        }
        res.envoyes++;
        continue;
      }
      if (c.etat === 'limite') {
        compteur.limite = true;
        await noter(e, { prochain_le: iso(t0() + Math.max(1, Number(r.retryApresS ?? 5)) * 1000), erreur: c.raison });
        res.attente++;
        continue;
      }
      if (c.etat === 'disparu') {
        // Salon supprimé à la main : la ligne est fermée (rien n'est recréé pour ce match), sa file abandonnée.
        await maj(e.salon_match_id, { statut: 'supprime', supprime_le: iso(t0()), suppression_le: null, erreur: 'salon-disparu' });
        await abandonner(e.salon_match_id, 'salon-disparu');
        bloques.add(e.salon_match_id);
        continue;
      }
      const essais = Number(e.essais) + 1;
      if (c.etat === 'reessai' && essais < LIMITES_SALONS.essaisEnvoi) {
        await noter(e, { essais, prochain_le: iso(t0() + attenteReessai(essais)), erreur: c.raison });
        bloques.add(e.salon_match_id);
        res.attente++;
        continue;
      }
      // Échec définitif (refus, requête invalide, trop d'essais) : raison précise, staff prévenu ; la suite du salon part.
      await noter(e, { statut: 'echec', essais, erreur: c.etat === 'reessai' ? `${c.raison}-abandon` : c.raison });
      res.echecs++;
      if (c.etat === 'refus') await alerter(evt, c.raison.startsWith('acces') ? 'envoi-acces' : 'envoi-permission', { match: e.s_match, statut: r.statut ?? 0 });
      else await alerter(evt, 'envoi-echec', { match: e.s_match, statut: r.statut ?? 0 });
    }
    return res;
  }

  async function lireEtat(id) {
    return jsonOu((await base.premier('SELECT valeur FROM tickets_reglages WHERE cle = ?', [`salons_match:${id}`]))?.valeur, null);
  }
  async function ecrireEtat(id, etat) {
    const i = instructionReglage(`salons_match:${id}`, etat, null, t0());
    await base.executer(i.sql, i.params);
  }

  const infosDe = (m, equipes) => JSON.stringify({ equipes: equipes.map(e => ({ nom: e.nom, tag: e.tag, role: Boolean(e.roleId) })), staff: (m.staff ?? []).map(x => ({ nom: x.nom, present: Boolean(x.discordId && !x.absent) })) });

  /**
   * Crée le salon d'un match (ligne réservée par la clé unique). `force` : création manuelle (sans attendre la création
   * anticipée, même avec une seule équipe connue).
   */
  async function creerSalon({ evt, reglages, ligne, m, equipes, d, mode, compteur, salonsServeur, parentId = reglages.categorieId, droits = null }) {
    const idBot = await idDuBot();
    const vars = {
      round: `r${m.round}`,
      match: m.genre === 'lobby' ? `l${m.position}` : `m${m.position}`,
      equipes: equipes.map(e => e.tag || e.nom).join(m.genre === 'lobby' ? '-' : '-vs-'),
      phase: m.groupe ? `poule-${m.groupe}` : m.bracket || m.phase || (m.genre === 'lobby' ? 'lobby' : ''),
      evenement: evt.nom ?? '',
    };
    const nom = nomSalon(reglages.modeleNom, vars);
    const titre = titreDe(m, langues(mode)[0]);
    const droitsBot = droitsBotSalon(droits?.perms);
    // Salon déjà créé par un passage interrompu (processus arrêté avant de noter l'identifiant) : retrouvé par son sujet.
    let salon = (salonsServeur ?? []).find(s => Number(s.type) === 0 && String(s.topic ?? '').includes(`${MARQUEUR}${m.cle}`) && String(s.topic ?? '').includes(evt.id.slice(0, 8)));
    if (!salon) {
      const corps = { name: nom, type: 0, ...(parentId ? { parent_id: parentId } : {}), topic: `${titre} · ${MARQUEUR}${m.cle} · ${evt.id.slice(0, 8)}`.slice(0, 1024), permission_overwrites: surcharges(evt, equipes, d.guildId, idBot, { assignes: m.staff, droitsBot }) };
      compteur.n++;
      let r = await rest(fetchDiscord, jetonBot, 'POST', `/guilds/${d.guildId}/channels`, corps, { raison: 'Esport HQ : salon de match' });
      // Le bot ne peut accorder que ce qu'il a : sans « Gérer les messages », le staff écrit sans pouvoir modérer.
      if (!r.ok && (r.code === 50013 || r.statut === 403)) {
        compteur.n++;
        r = await rest(fetchDiscord, jetonBot, 'POST', `/guilds/${d.guildId}/channels`, { ...corps, permission_overwrites: surcharges(evt, equipes, d.guildId, idBot, { gestion: false, assignes: m.staff, droitsBot }) }, { raison: 'Esport HQ : salon de match' });
      }
      if (r.statut === 429) {
        compteur.limite = true;
        return false;
      }
      if (!r.ok || !r.corps?.id) {
        await maj(ligne.id, { erreur: `creation-${r.statut}${r.code ? `-${r.code}` : ''}` });
        // Création refusée par Discord (permission, hiérarchie, catégorie pleine côté Discord…) : le staff est prévenu.
        await alerter(evt, `creation-${codeRefusDiscord(r)}`, { match: ligne.site_match_id, statut: r.statut ?? 0 });
        return false;
      }
      salon = r.corps;
      // Placement sous le salon repère (fin du passage) : le nouveau salon entre dans la liste lue au début.
      if (Array.isArray(salonsServeur)) salonsServeur.push(salon);
    }
    // Surcharge du bot vérifiée dès la création (embeds jamais masqués) ; réparée si Discord ne l'a pas gardée.
    const voulu = BigInt(droitsBot);
    const duBot = (salon.permission_overwrites ?? []).find(o => String(o.id) === String(idBot));
    if (idBot && Array.isArray(salon.permission_overwrites) && (!duBot || (BigInt(duBot.allow ?? '0') & voulu) !== voulu)) await reparerBot(String(salon.id), droits, compteur);
    await maj(ligne.id, { salon_id: String(salon.id), statut: 'ouvert', titre, infos: infosDe(m, equipes), erreur: null });
    ligne.salon_id = String(salon.id);
    ligne.statut = 'ouvert';
    const p = pings(equipes, droits);
    // Rappel déjà dépassé (salon créé à moins de 10 minutes du match) : jamais envoyé en retard.
    const avant = m.prevu ? Date.parse(m.prevu) - t0() : Infinity;
    await appliquer(ligne, [{ genre: 'accueil', corps: { content: `${p.texte}\n${tx(mode, 'pret')}`.trim().slice(0, 2000), embeds: [embedMatch(evt, m, equipes, mode)], allowed_mentions: p.allowed } }], {
      message_id: null,
      empreinte: empreinteMatch(m),
      prevu_le: m.prevu,
      rappel10_le: avant <= 10 * MINUTE ? iso(t0()) : null,
    });
    await avertirSansRole(evt, ligne, equipes, mode, m);
    return true;
  }

  /** Équipes sans rôle Discord : signalées une fois (par ensemble d'équipes) au staff de l'événement. */
  async function avertirSansRole(evt, ligne, equipes, mode, m = null) {
    const sans = equipes.filter(e => !e.roleId).map(e => `${e.tag ? `[${e.tag}] ` : ''}${e.nom}`).sort();
    const introuvables = (m?.staff ?? []).filter(x => !x.discordId || x.absent).map(x => x.nom || x.discordId || '?').sort();
    // Clé : ancien format (liste des équipes) tant qu'aucun staff n'est introuvable.
    const cle = introuvables.length ? JSON.stringify({ equipes: sans, staff: introuvables }) : JSON.stringify(sans);
    if ((!sans.length && !introuvables.length) || ligne.avertis === cle) return;
    const avant = jsonOu(ligne.avertis, null);
    const dejaEquipes = Array.isArray(avant) ? avant : (avant?.equipes ?? []);
    const dejaStaff = Array.isArray(avant) ? [] : (avant?.staff ?? []);
    const roles = [evt.staff_role_id, ...(evt.roles_supprimes_le ? [] : idsSup(evt.staff_roles_sup))].filter(x => x && ID.test(String(x))).map(String);
    const textes = [];
    if (sans.length && JSON.stringify(sans) !== JSON.stringify(dejaEquipes)) {
      textes.push(tx(mode, 'sans_role', { liste: sans.join(', ') }, 900));
      await alerter(evt, 'equipe-sans-role', { match: ligne.site_match_id, nom: sans.join(', ') });
    }
    if (introuvables.length && JSON.stringify(introuvables) !== JSON.stringify(dejaStaff)) {
      textes.push(tx(mode, 'staff_introuvable', { liste: introuvables.join(', ') }, 900));
      await alerter(evt, 'staff-introuvable', { match: ligne.site_match_id, nom: introuvables.join(', ') });
    }
    const ops = textes.length ? [{ genre: 'alerte', corps: { content: `${roles.map(r => `<@&${r}>`).join(' ')} ${textes.join('\n')}`.trim().slice(0, 2000), allowed_mentions: { parse: [], roles } } }] : [];
    await appliquer(ligne, ops, { avertis: cle });
  }

  const delaiDe = reglages => reglages.delaiSuppressionMin * MINUTE;
  const quand = ms => `<t:${Math.floor(ms / 1000)}:R>`;

  /** Suit un match dont le salon existe : changements, rappels, résultat (tout passe par la file d'envoi). */
  async function suivre({ evt, reglages, ligne, m, equipes, d, mode, compteur, droits = null }) {
    const fini = Boolean(m.resultat);
    const p = pings(equipes, droits);
    const ch = changementsMatch(ligne.empreinte, m);
    let accesModifie = false;
    if (ligne.empreinte !== empreinteMatch(m)) {
      const t = t0();
      const reste = m.prevu ? Date.parse(m.prevu) - t : Infinity;
      const ops = [];
      if (ch.embed) ops.push({ genre: 'embed', methode: 'edit', corps: { embeds: [embedMatch(evt, m, equipes, mode)], allowed_mentions: { parse: [] } } });
      if (ch.quoi.includes('maj_equipes') || ch.quoi.includes('maj_staff')) {
        // Accès : rôles des équipes du match et staff assigné (ajoutés, retirés), staff de l'événement et bot inchangés.
        const droitsBot = droitsBotSalon(droits?.perms);
        compteur.n++;
        let r = await rest(fetchDiscord, jetonBot, 'PATCH', `/channels/${ligne.salon_id}`, { permission_overwrites: surcharges(evt, equipes, d.guildId, await idDuBot(), { assignes: m.staff, droitsBot }) }, { raison: 'Esport HQ : équipes du match modifiées' });
        if (!r.ok && (r.code === 50013 || r.statut === 403)) {
          compteur.n++;
          r = await rest(fetchDiscord, jetonBot, 'PATCH', `/channels/${ligne.salon_id}`, { permission_overwrites: surcharges(evt, equipes, d.guildId, await idDuBot(), { gestion: false, assignes: m.staff, droitsBot }) }, { raison: 'Esport HQ : équipes du match modifiées' });
        }
        if (r.statut === 429) compteur.limite = true;
        accesModifie = true;
        // Refus : le contrôle des accès du passage suivant complète ce qui manque.
        if (!r.ok) await maj(ligne.id, { erreur: `acces-${r.statut}${r.code ? `-${r.code}` : ''}` });
      }
      if (ch.quoi.length) {
        // Seul le staff assigné a changé : mention du staff assigné présent, pas des équipes.
        const staffSeul = ch.quoi.length === 1 && ch.quoi[0] === 'maj_staff';
        const staffPresent = (m.staff ?? []).filter(x => x.discordId && !x.absent).map(x => x.discordId);
        ops.push({ genre: 'maj', delaiMs: FENETRE_MAJ_MS, meta: { quoi: ch.quoi, mode, statut: m.statut, roles: staffSeul ? [] : p.roles, users: staffSeul ? staffPresent : p.users }, composer: composerMaj });
      }
      await appliquer(ligne, ops, {
        empreinte: empreinteMatch(m),
        prevu_le: m.prevu,
        titre: titreDe(m, langues(mode)[0]),
        infos: infosDe(m, equipes),
        // Nouvel horaire : rappel réarmé (sauf s'il est déjà dépassé).
        ...(ch.horaire ? { rappel10_le: reste <= 10 * MINUTE ? iso(t) : null } : {}),
      });
      await avertirSansRole(evt, ligne, equipes, mode, m);
    }
    // Map ban : lancement (lien de suivi, équipe qui commence) puis fin (maps jouées), un message chacun, une seule fois.
    if (m.mapban && !fini) {
      const ops = [];
      const champs = {};
      const k = m.mapban;
      const premier = equipes.find(e => e.id === k.premierId)?.nom;
      // Map ban déjà terminé à la première lecture : seul le message de fin part (pas deux messages d'affilée).
      if (ligne.mapban_annonce !== k.id) {
        champs.mapban_annonce = k.id;
        if (!k.termine) ops.push({ genre: 'mapban', corps: { content: bilingue(l => [tl(l, 'mapban', { lien: `<${k.lien}>` }), ...(premier ? [tl(l, 'mapban_premier', { nom: premier })] : [])].join('\n'), { mode, max: 1900 }), allowed_mentions: { parse: [] } } });
      }
      if (k.termine && ligne.mapban_fin !== k.id && k.maps.length) {
        champs.mapban_fin = k.id;
        ops.push({ genre: 'mapban_fin', corps: { content: tx(mode, k.maps.length > 1 ? 'mapban_fin_n' : 'mapban_fin_1', { liste: k.maps.length > 1 ? k.maps.map((x, i) => `${i + 1}. ${x}`).join(', ') : k.maps[0] }).slice(0, 2000), allowed_mentions: { parse: [] } } });
      }
      if (ops.length || Object.keys(champs).length) await appliquer(ligne, ops, champs);
    }
    // Rappel 10 minutes avant (une seule fois).
    if (reglages.rappels && m.prevu && !fini && m.statut === 'pending') {
      const reste = Date.parse(m.prevu) - t0();
      if (!ligne.rappel10_le && reste <= 10 * MINUTE && reste > -5 * MINUTE) {
        await appliquer(ligne, [{ genre: 'rappel', corps: { content: `${p.texte} ${tx(mode, 'rappel', { quand: quand(Date.parse(m.prevu)) })}`.trim().slice(0, 2000), allowed_mentions: p.allowed } }], { rappel10_le: iso(t0()) });
      }
    }
    // Résultat.
    const fr = empreinteResultat(m);
    if (fini && fr !== ligne.resultat_empreinte) {
      const corrige = Boolean(ligne.resultat_empreinte);
      const suppression = corrige && ligne.suppression_le ? Date.parse(ligne.suppression_le) : t0() + delaiDe(reglages);
      await appliquer(ligne, [{ genre: 'resultat', corps: { content: `${tx(mode, corrige ? 'resultat_corrige' : 'resultat')}\n${tx(mode, 'suppression', { quand: quand(suppression) })}`.slice(0, 2000), embeds: [embedResultat(m, equipes, mode)], allowed_mentions: { parse: [] } } }], { resultat_empreinte: fr, resultat_le: iso(t0()), statut: 'termine', suppression_le: iso(suppression) });
    } else if (!fini && ligne.statut === 'termine') {
      // Résultat retiré sur le site (erreur de saisie) : le salon reste ouvert.
      await appliquer(ligne, [{ genre: 'retire', corps: { content: tx(mode, 'resultat_retire'), allowed_mentions: { parse: [] } } }], { resultat_empreinte: null, resultat_le: null, statut: 'ouvert', suppression_le: null });
    }
    return { accesModifie };
  }

  /**
   * Salons dont la suppression est due : historique enregistré, salon supprimé. Des messages encore en attente (résultat,
   * avis) partent d'abord ; au plus une heure de retard, puis la suppression se fait quand même.
   */
  async function suppressionsDues(id, compteur) {
    const t = t0();
    const dues = (
      await base.tous(
        "SELECT * FROM club_salons_match WHERE evenement_id = ? AND statut IN ('termine', 'annule') AND suppression_le IS NOT NULL AND suppression_le <= ? AND (suppression_le <= ? OR NOT EXISTS (SELECT 1 FROM club_salons_match_envois e WHERE e.salon_match_id = club_salons_match.id AND e.statut = 'attente'))",
        [id, iso(t), iso(t - 60 * MINUTE)],
      )
    ).slice(0, 10);
    let n = 0;
    for (const l of dues) {
      if (compteur.limite || compteur.n >= LIMITES_SALONS.actionsParPassage) break;
      compteur.n += 2;
      const r = await fermerSalon(l);
      if (r === 'limite') compteur.limite = true;
      if (r === 'fait') n++;
    }
    return n;
  }

  /**
   * Salons de match rangés juste sous le salon repère, par horaire (le plus tôt d'abord, sans horaire à la fin), sans
   * toucher aux salons au-dessus du repère (même calcul que les hubs vocaux, vocaux/hubs.mjs). Un seul PATCH des
   * positions qui changent ; refus pour limite de débit : au passage suivant. Rend le nombre de salons déplacés.
   */
  async function placerSousAncre(evenementId, ancre, salons, d, compteur) {
    const lignes = await base.tous("SELECT salon_id, prevu_le, cree_le FROM club_salons_match WHERE evenement_id = ? AND statut IN ('ouvert', 'termine', 'annule') AND salon_id IS NOT NULL", [evenementId]);
    const groupe = lignes
      .sort((a, b) => (a.prevu_le ? Date.parse(a.prevu_le) : Infinity) - (b.prevu_le ? Date.parse(b.prevu_le) : Infinity) || String(a.cree_le).localeCompare(String(b.cree_le)))
      .map(l => String(l.salon_id));
    const positions = positionsSousHub(salons, ancre, groupe, ECRITS);
    if (!positions.length) return 0;
    compteur.n++;
    const r = await rest(fetchDiscord, jetonBot, 'PATCH', `/guilds/${d.guildId}/channels`, positions, { raison: 'Esport HQ : salons de match sous le salon choisi' });
    if (r.statut === 429) compteur.limite = true;
    return r.ok ? positions.length : 0;
  }

  /** Repère supprimé sur Discord : le staff est averti une fois (dans un salon de match ouvert) ; réarmé s'il revient. */
  async function signalerAncre(evt, reglages, absente, mode) {
    const cle = `salons_match_ancre:${evt.id}`;
    const deja = jsonOu((await base.premier('SELECT valeur FROM tickets_reglages WHERE cle = ?', [cle]))?.valeur, null);
    if (!absente) {
      if (deja) await base.executer('DELETE FROM tickets_reglages WHERE cle = ?', [cle]);
      return;
    }
    // Alerte (notification) dès que le repère manque, avec ou sans salon ouvert où l'écrire ; au plus une par 6 h.
    await alerter(evt, 'ancre-supprimee', { parMatch: false });
    if (deja?.ancreId === reglages.ancreId) return;
    const ligne = await base.premier("SELECT * FROM club_salons_match WHERE evenement_id = ? AND statut = 'ouvert' AND salon_id IS NOT NULL ORDER BY cree_le DESC", [evt.id]);
    if (!ligne) return; // aucun salon où l'écrire : au prochain passage
    const roles = [evt.staff_role_id, ...(evt.roles_supprimes_le ? [] : idsSup(evt.staff_roles_sup))].filter(x => x && ID.test(String(x))).map(String);
    await appliquer(ligne, [{ genre: 'ancre', corps: { content: `${roles.map(x => `<@&${x}>`).join(' ')} ${tx(mode, 'ancre_absente')}`.trim().slice(0, 2000), allowed_mentions: { parse: [], roles } } }]);
    const i = instructionReglage(cle, { ancreId: reglages.ancreId, le: iso(t0()) }, null, t0());
    await base.executer(i.sql, i.params);
  }

  /** Comptes de la file d'un événement : envoyés, en attente, en échec (par salon et au total). */
  async function statsEnvois(evenementId) {
    const lignes = await base.tous("SELECT salon_match_id, statut, COUNT(*) AS n FROM club_salons_match_envois WHERE evenement_id = ? AND statut IN ('attente', 'envoye', 'echec') GROUP BY salon_match_id, statut", [evenementId]);
    const raisons = await base.tous("SELECT salon_match_id, genre, erreur FROM club_salons_match_envois WHERE evenement_id = ? AND (statut = 'echec' OR (statut = 'attente' AND erreur IS NOT NULL)) ORDER BY ordre", [evenementId]);
    const par = new Map();
    const total = { envoyes: 0, attente: 0, echecs: 0 };
    const cle = { envoye: 'envoyes', attente: 'attente', echec: 'echecs' };
    for (const l of lignes) {
      const s = par.get(l.salon_match_id) ?? { envoyes: 0, attente: 0, echecs: 0, raisons: [] };
      s[cle[l.statut]] += Number(l.n);
      total[cle[l.statut]] += Number(l.n);
      par.set(l.salon_match_id, s);
    }
    for (const r of raisons) {
      const s = par.get(r.salon_match_id);
      if (s && s.raisons.length < 5) s.raisons.push({ genre: r.genre, raison: r.erreur });
    }
    return { par, total };
  }

  // Dernier contrôle des accès par événement (mémoire du processus : au plus une fois par minute).
  const controles = new Map();

  /** Une synchronisation (sous bail). Rend le bilan. */
  async function synchroniserSousBail(evenementId, { forcer = null, prioritaires = null, origine = 'relecture', fileSeule = false } = {}) {
    const evt = await base.premier('SELECT * FROM club_evenements WHERE id = ?', [evenementId]);
    if (!evt) return null;
    const reglages = lireReglages(evt.salons_match);
    // Diagnostic (affiché sous « Dernier passage ») : ce qui a été lu sur le site, ce qui a été ignoré et pourquoi.
    const bilan = { le: iso(t0()), origine, crees: 0, majs: 0, resultats: 0, annules: 0, supprimes: 0, attente: 0, limite: false, erreur: null, arret: null, lus: null, suivis: 0, ignores: { termine: 0, equipes: 0, delai: 0, ferme: 0 }, echecs: 0, details: [], envois: { envoyes: 0, attente: 0, echecs: 0 }, avertissements: [], acces: 0 };
    const compteur = { n: 0, limite: false };
    const d = await ctxDiscord();
    if (d.erreur) {
      bilan.erreur = d.erreur;
      return bilan;
    }
    const mode = modeLangue(reglages, d.general);
    const viderEtNoter = async droits => {
      const r = await vider(evt, d, compteur, droits);
      for (const k of ['envoyes', 'echecs']) bilan.envois[k] += r[k];
      bilan.envois.attente = r.attente;
    };
    // Messages restés en file (passage précédent interrompu, réessais dus) : avant tout le reste.
    const droitsConnus = droitsCache.get(d.guildId) ?? null;
    await viderEtNoter(droitsConnus);
    if (fileSeule) {
      bilan.limite = compteur.limite;
      return bilan;
    }
    // Suppressions dues ensuite (même si les salons de match ont été désactivés depuis).
    bilan.supprimes += await suppressionsDues(evenementId, compteur);
    if ((!reglages.actif && !forcer) || !evt.site_tournoi_id || ['termine', 'annule'].includes(evt.statut)) {
      bilan.arret = !evt.site_tournoi_id ? 'non-lie' : ['termine', 'annule'].includes(evt.statut) ? 'evenement-termine' : 'inactif';
      bilan.limite = compteur.limite;
      return bilan;
    }
    if (!reglages.categorieId && !reglages.ancreId) {
      bilan.erreur = 'categorie';
      return bilan;
    }
    let lu;
    try {
      lu = await lireMatchsSite(site, evt.site_tournoi_id);
    } catch (e) {
      bilan.erreur = `site : ${String(e?.message ?? e).slice(0, 200)}`;
      return bilan;
    }
    bilan.lus = { matchs: lu.matchs.filter(m => m.genre === 'match').length, lobbies: lu.matchs.filter(m => m.genre === 'lobby').length };
    const noter = (m, raison, extra = {}) => {
      if (bilan.details.length < 20) bilan.details.push({ cle: m.cle, titre: titreDe(m, langues(mode)[0]), raison, ...extra });
    };
    // Droits du bot sur le serveur : surcharge voulue, rôles mentionnables ; « Intégrer des liens » manquant signalé.
    const droits = await droitsServeur(d, compteur);
    if (droits.perms !== null && (droits.perms & INTEGRER) !== INTEGRER) {
      bilan.avertissements.push('embed-manquant');
      await alerter(evt, 'embed-manquant', { parMatch: false });
    }
    if (droits.perms !== null && !droits.toutes) bilan.avertissements.push('mentions-joueurs');
    const app = await equipesApp(evenementId);
    const lignes = new Map((await lignesDe(evenementId)).map(l => [l.site_match_id, l]));
    const vus = new Set();
    let salonsServeur = null;
    let salonsLus = false;
    const lireSalons = async () => {
      if (salonsServeur) return salonsServeur;
      compteur.n++;
      const r = await rest(fetchDiscord, jetonBot, 'GET', `/guilds/${d.guildId}/channels`);
      if (r.statut === 429) compteur.limite = true;
      salonsLus = r.ok && Array.isArray(r.corps);
      salonsServeur = salonsLus ? r.corps : [];
      return salonsServeur;
    };
    // « Placer sous le salon » : les salons naissent dans la catégorie du salon repère et sont rangés juste sous lui.
    let ancre = null;
    let parentId = reglages.categorieId;
    if (reglages.ancreId) {
      const salons = await lireSalons();
      ancre = salons.find(x => String(x.id) === reglages.ancreId) ?? null;
      if (ancre) parentId = ancre.parent_id ? String(ancre.parent_id) : null;
      else if (salonsLus) {
        // Repère supprimé sur Discord : catégorie choisie (à défaut, aucune création), staff averti une fois.
        bilan.erreur = 'ancre-introuvable';
        if (!reglages.categorieId) {
          bilan.limite = compteur.limite;
          return bilan;
        }
      } else {
        bilan.limite = compteur.limite;
        return bilan; // liste des salons illisible (limite de débit…) : au passage suivant
      }
    }
    // Contrôle des accès des salons suivis : au plus une fois par minute par événement.
    const controler = t0() - (controles.get(evenementId) ?? 0) >= CONTROLE_ACCES_MS && [...lignes.values()].some(l => ['ouvert', 'termine'].includes(l.statut) && l.salon_id);
    if (controler) {
      await lireSalons();
      if (salonsLus) controles.set(evenementId, t0());
    }
    // Staff assigné : présent sur le serveur ? (gardé 10 minutes : le plafond d'actions reste aux messages)
    const enrichirStaff = async m => {
      for (const x of m.staff ?? []) {
        if (!x.discordId) continue;
        const c = membresCache.get(`${d.guildId}:${x.discordId}`);
        if (!c || t0() - c.le >= DROITS_SERVEUR_MS) {
          compteur.n++;
          const r = await rest(fetchDiscord, jetonBot, 'GET', `/guilds/${d.guildId}/members/${x.discordId}`);
          if (r.statut === 429) compteur.limite = true;
          const present = r.ok ? true : r.code === 10007 || (r.statut === 404 && r.code !== 10004) ? false : null;
          if (present !== null) membresCache.set(`${d.guildId}:${x.discordId}`, { present, le: t0() });
          x.absent = present === false;
          continue;
        }
        x.absent = c.present === false;
      }
    };
    let creations = 0;
    // Les matchs annoncés par le site d'abord (poussée), puis les plus proches (horaire, puis round et position).
    const prio = new Set(prioritaires ?? []);
    const tries = [...lu.matchs].sort((a, b) => Number(prio.has(b.cle)) - Number(prio.has(a.cle)) || (a.prevu ? Date.parse(a.prevu) : Infinity) - (b.prevu ? Date.parse(b.prevu) : Infinity) || a.round - b.round || a.position - b.position);
    for (const m of tries) {
      vus.add(m.cle);
      if (compteur.limite || compteur.n >= LIMITES_SALONS.actionsParPassage) {
        bilan.attente++;
        noter(m, 'attente');
        continue;
      }
      if (forcer && forcer !== m.cle) {
        // Création manuelle d'un seul match : les autres suivent au passage suivant.
        const l = lignes.get(m.cle);
        if (!l || l.statut !== 'ouvert') continue;
      }
      const equipes = equipesDuMatch(m, lu.equipes, app);
      let ligne = lignes.get(m.cle);
      if (m.staff?.length && (!ligne || ['ouvert', 'termine', 'creation'].includes(ligne.statut))) await enrichirStaff(m);
      if (ligne && ['ouvert', 'termine'].includes(ligne.statut) && ligne.salon_id) {
        const avant = ligne.empreinte;
        const avantR = ligne.resultat_empreinte;
        bilan.suivis++;
        const suivi = await suivre({ evt, reglages, ligne, m, equipes, d, mode, compteur, droits });
        if (avant !== empreinteMatch(m) && changementsMatch(avant, m).embed) bilan.majs++;
        if (m.resultat && avantR !== empreinteResultat(m)) bilan.resultats++;
        // Accès remplacés à l'instant (équipes ou staff changés) : la liste lue au début du passage n'est plus à jour.
        if (controler && salonsLus && !compteur.limite && ligne.statut !== 'supprime' && !suivi.accesModifie) {
          const salon = salonsServeur.find(s => String(s.id) === String(ligne.salon_id));
          if (salon) bilan.acces += await verifierAcces(evt, ligne, salon, m, equipes, d, droits, compteur);
        }
        continue;
      }
      if (ligne && ligne.statut !== 'creation') {
        // Supprimé, annulé : jamais recréé automatiquement (« Créer maintenant » le permet).
        if (m.resultat) bilan.ignores.termine++;
        else {
          bilan.ignores.ferme++;
          noter(m, 'ferme', { statut: ligne.statut });
        }
        continue;
      }
      const manuel = forcer === m.cle;
      const avance = reglages.avanceH > 0 && m.prevu && m.statut !== 'live' ? Date.parse(m.prevu) - t0() <= reglages.avanceH * 3_600_000 : true;
      if (!manuel) {
        if (m.resultat) {
          // Terminé sur le site (résultat saisi) avant d'avoir eu un salon.
          bilan.ignores.termine++;
          if (!ligne) noter(m, 'termine');
          continue;
        }
        if (m.equipes.length < 2) {
          bilan.ignores.equipes++;
          noter(m, 'equipes', { n: m.equipes.length });
          continue;
        }
        if (!avance) {
          bilan.ignores.delai++;
          noter(m, 'delai', { prevu: m.prevu });
          continue;
        }
      }
      if (manuel && !m.equipes.length) continue;
      if (creations >= LIMITES_SALONS.creationsParPassage) {
        bilan.attente++;
        noter(m, 'attente');
        continue;
      }
      const salons = await lireSalons();
      if (parentId && salons.filter(s => String(s.parent_id ?? '') === parentId).length >= LIMITES_SALONS.salonsParCategorie && !salons.some(s => String(s.topic ?? '').includes(`${MARQUEUR}${m.cle}`))) {
        bilan.erreur = 'categorie-pleine';
        await alerter(evt, 'categorie-pleine', { match: m.cle, parMatch: false });
        bilan.attente++;
        noter(m, 'categorie');
        continue;
      }
      if (!ligne) {
        // Réservation : la clé unique (événement, match) empêche deux salons pour un même match.
        await base.executer("INSERT INTO club_salons_match (id, evenement_id, site_match_id, genre, titre, statut, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, 'creation', ?, ?) ON CONFLICT (evenement_id, site_match_id) DO NOTHING", [nouvelId(), evenementId, m.cle, m.genre, titreDe(m, langues(mode)[0]), iso(t0()), iso(t0())]);
        ligne = await base.premier('SELECT * FROM club_salons_match WHERE evenement_id = ? AND site_match_id = ?', [evenementId, m.cle]);
        if (!ligne || ligne.statut !== 'creation' || ligne.salon_id) continue;
      }
      creations++;
      if (await creerSalon({ evt, reglages, ligne, m, equipes, d, mode, compteur, salonsServeur: salons, parentId, droits })) bilan.crees++;
      else if (compteur.limite) {
        bilan.attente++;
        noter(m, 'attente');
      } else {
        // Création refusée par Discord : code gardé sur la ligne (permission, hiérarchie…).
        bilan.echecs++;
        const apres = await base.premier('SELECT erreur FROM club_salons_match WHERE id = ?', [ligne.id]);
        noter(m, 'echec', { code: apres?.erreur ?? null });
      }
    }
    if (ancre && !compteur.limite) bilan.places = await placerSousAncre(evenementId, ancre, salonsServeur ?? [], d, compteur);
    if (reglages.ancreId) await signalerAncre(evt, reglages, !ancre, mode);
    // Matchs disparus du site : avis, suppression programmée (l'avis part par la file, jamais perdu).
    for (const l of lignes.values()) {
      if (vus.has(l.site_match_id)) continue;
      if (l.statut === 'creation' && !l.salon_id) {
        await base.executer('DELETE FROM club_salons_match WHERE id = ?', [l.id]);
        continue;
      }
      if (l.statut !== 'ouvert' && l.statut !== 'termine') continue;
      if (l.statut === 'termine' && l.suppression_le) continue; // déjà terminé : la suppression est programmée
      const suppression = t0() + delaiDe(reglages);
      await appliquer(l, [{ genre: 'annule', corps: { content: `${tx(mode, 'annule')}\n${tx(mode, 'suppression', { quand: quand(suppression) })}`.slice(0, 2000), allowed_mentions: { parse: [] } } }], { statut: 'annule', suppression_le: iso(suppression) });
      bilan.annules++;
    }
    // Messages décidés par ce passage : envoyés maintenant (ce qui dépasse le plafond part au passage suivant).
    await viderEtNoter(droits);
    bilan.limite = compteur.limite;
    return bilan;
  }

  const membresCache = new Map();
  // Événements dont le dernier passage n'a pas tout fait (plafond, limite de débit, file en attente) : relancés en 15 s.
  const aRelancer = new Set();

  // Une synchronisation à la fois par événement dans ce processus, et un bail en base entre processus.
  const enCours = new Map();
  function synchroniser(evenementId, options = {}) {
    if (enCours.has(evenementId)) return enCours.get(evenementId);
    const p = (async () => {
      if (!(await prendreBail(evenementId))) return { occupe: true };
      try {
        const bilan = await synchroniserSousBail(evenementId, options);
        if (bilan && !options.fileSeule) await ecrireEtat(evenementId, bilan);
        if (bilan && !options.fileSeule && (bilan.attente > 0 || bilan.limite)) aRelancer.add(evenementId);
        else if (bilan && !options.fileSeule) aRelancer.delete(evenementId);
        return bilan;
      } finally {
        await rendreBail(evenementId).catch(() => undefined);
      }
    })().finally(() => enCours.delete(evenementId));
    enCours.set(evenementId, p);
    return p;
  }

  /**
   * Fin ou suppression de l'événement : historique de chaque salon encore ouvert enregistré, salons supprimés (sans
   * attendre le délai). Rend `{ salons, echecs }`.
   */
  async function fermerEvenement(evenementId) {
    const b = { salons: 0, echecs: [] };
    if (!jetonBot) return b;
    for (const l of await base.tous("SELECT * FROM club_salons_match WHERE evenement_id = ? AND statut <> 'supprime' AND salon_id IS NOT NULL", [evenementId])) {
      const r = await fermerSalon(l, 'Esport HQ : fin de l’événement');
      if (r === 'fait') b.salons++;
      else {
        b.echecs.push({ quoi: 'salon-match', id: l.salon_id, statut: r === 'limite' ? 429 : 0, code: null });
        if (r === 'limite') break;
      }
    }
    await base.executer("DELETE FROM club_salons_match WHERE evenement_id = ? AND statut = 'creation' AND salon_id IS NULL", [evenementId]);
    return b;
  }

  const enCoursEvt = (e, t) => {
    if (e.statut === 'en_cours') return true;
    if (e.statut !== 'a_venir') return false;
    const jour = iso(t).slice(0, 10);
    return Boolean(e.debut && e.debut <= jour && (!e.fin || e.fin >= jour));
  };
  const finiEvt = (e, t) => {
    if (['termine', 'annule'].includes(e.statut)) return true;
    const h = Number(e.suppression_h);
    return h > 0 && /^\d{4}-\d{2}-\d{2}$/.test(e.fin ?? '') && t >= Date.parse(`${e.fin}T23:59:59.999Z`) + h * 3_600_000;
  };

  /**
   * Cron (5 min) : événements actifs liés, suppressions dues, fin d'événement, rétention des historiques et de la file.
   * Rend `{ evenements, enCours }` (`enCours` : événements en cours avec salons de match, pour réveiller l'app et sa
   * boucle rapide).
   */
  async function tacheCron({ rapide = false } = {}) {
    if (!jetonBot) return { evenements: 0, enCours: 0 };
    const t = t0();
    const liste = await base.tous("SELECT id, statut, debut, fin, suppression_h, salons_match, site_tournoi_id FROM club_evenements WHERE salons_match IS NOT NULL OR id IN (SELECT DISTINCT evenement_id FROM club_salons_match WHERE statut <> 'supprime')", []);
    let n = 0;
    let actifsEnCours = 0;
    for (const e of liste) {
      const r = lireReglages(e.salons_match);
      const ouverts = await base.premier("SELECT COUNT(*) AS n FROM club_salons_match WHERE evenement_id = ? AND statut <> 'supprime' AND salon_id IS NOT NULL", [e.id]);
      if (finiEvt(e, t)) {
        if (Number(ouverts?.n ?? 0) > 0) await fermerEvenement(e.id);
        continue;
      }
      const dues = await base.premier("SELECT COUNT(*) AS n FROM club_salons_match WHERE evenement_id = ? AND statut IN ('termine', 'annule') AND suppression_le IS NOT NULL AND suppression_le <= ?", [e.id, iso(t)]);
      const actif = r.actif && e.site_tournoi_id;
      if (actif && enCoursEvt(e, t)) actifsEnCours++;
      if (rapide ? (actif && enCoursEvt(e, t)) || Number(dues?.n ?? 0) > 0 : actif || Number(dues?.n ?? 0) > 0) {
        await synchroniser(e.id);
        n++;
      }
    }
    if (!rapide) {
      // Rétention des historiques (réglage par événement ; 0 : gardés jusqu'à la suppression de l'événement).
      for (const e of liste) {
        const r = lireReglages(e.salons_match);
        if (r.retentionJours > 0) await base.executer("UPDATE club_salons_match SET transcript = NULL, nb_messages = 0 WHERE evenement_id = ? AND statut = 'supprime' AND transcript IS NOT NULL AND supprime_le < ?", [e.id, iso(t - r.retentionJours * 86_400_000)]);
      }
      // File d'envoi : messages partis, remplacés ou abandonnés depuis plus de 7 jours effacés ; avis du site traités depuis un jour.
      await base.executer("DELETE FROM club_salons_match_envois WHERE statut IN ('envoye', 'remplace', 'abandon') AND maj_le < ?", [iso(t - 7 * 86_400_000)]);
      await base.executer('DELETE FROM site_lz_pousses WHERE traite_le IS NOT NULL AND traite_le < ?', [iso(t - 86_400_000)]);
      await base.executer('DELETE FROM site_lz_nonces WHERE expire_le < ?', [iso(t)]);
    }
    return { evenements: n, enCours: actifsEnCours };
  }

  // Passage rapide (boucle du meneur) : au plus une fois par minute, 15 s quand il reste du travail.
  let dernierRapide = 0;
  async function tacheRapide() {
    const t = t0();
    if (t - dernierRapide < (aRelancer.size ? RELANCE_MS : RELECTURE_MS)) return null;
    dernierRapide = t;
    return tacheCron({ rapide: true });
  }

  /** Envois dus de tous les événements (réessais, fenêtre des « Mise à jour ») : la file seule, sans relire le site. */
  async function viderEnvoisDus() {
    const ids = await base.tous("SELECT DISTINCT evenement_id FROM club_salons_match_envois WHERE statut = 'attente' AND prochain_le <= ?", [iso(t0())]);
    let n = 0;
    for (const { evenement_id: id } of ids) {
      if (enCours.has(id)) continue;
      const b = await synchroniser(id, { fileSeule: true });
      if (b && !b.occupe) n += b.envois?.envoyes ?? 0;
    }
    return n;
  }

  // ---------------------------------------------------------------- Avis du site (poussée, site-lz/poussee.mjs)

  const minuteries = new Map();
  const travaux = new Set();

  /**
   * Avis du site : `tournoi` et identifiants des matchs et lobbies changés (`tout` : phase, équipe… tout le tournoi).
   * Noté en base (un autre processus, ou la boucle après un redémarrage, le reprend), puis traité dans ce processus après
   * l'anti-rebond. Tournoi inconnu ou sans salons de match activés : ignoré. Rend `{ evenements }`.
   */
  async function recevoirPoussee({ tournoi, matchs = [], lobbies = [], tout = false }) {
    const evts = await base.tous('SELECT id, statut, salons_match FROM club_evenements WHERE site_tournoi_id = ?', [tournoi]);
    const cles = tout ? null : [...matchs.map(x => `m:${x}`), ...lobbies.map(x => `l:${x}`)];
    let n = 0;
    for (const e of evts) {
      if (!lireReglages(e.salons_match).actif || ['termine', 'annule'].includes(e.statut)) continue;
      await base.executer('INSERT INTO site_lz_pousses (id, evenement_id, cles, recu_le) VALUES (?, ?, ?, ?)', [nouvelId(), e.id, cles ? JSON.stringify(cles) : null, iso(t0())]);
      planifier(e.id);
      n++;
    }
    return { evenements: n };
  }

  /** Anti-rebond par événement : 2,5 s après le dernier avis, 6 s au plus après le premier. */
  function planifier(id, delai = antiRebondMs) {
    const t = Date.now();
    const x = minuteries.get(id);
    const premier = x?.premier ?? t;
    if (x) clearTimeout(x.minuterie);
    const attente = Math.max(0, Math.min(delai, premier + antiRebondMaxMs - t));
    const minuterie = setTimeout(() => {
      minuteries.delete(id);
      const travail = traiterPoussees(id)
        .catch(e => journal.error?.('[esport] salons de match : avis du site', e?.message ?? e))
        .finally(() => travaux.delete(travail));
      travaux.add(travail);
    }, attente);
    minuterie.unref?.();
    minuteries.set(id, { minuterie, premier });
  }

  /** Traite les avis en attente d'un événement : synchronisation, matchs annoncés d'abord. */
  async function traiterPoussees(id, essai = 0) {
    const avis = await base.tous('SELECT id, cles FROM site_lz_pousses WHERE evenement_id = ? AND traite_le IS NULL', [id]);
    if (!avis.length) return null;
    const listes = avis.map(a => jsonOu(a.cles, null));
    const prioritaires = listes.some(l => !Array.isArray(l)) ? null : [...new Set(listes.flat())];
    const b = await synchroniser(id, { prioritaires, origine: 'poussee' });
    if (b?.occupe) {
      // Autre processus en plein passage : nouvel essai dans 3 s (la boucle du meneur reprend sinon les avis).
      if (essai < 10) {
        const m = setTimeout(() => {
          const travail = traiterPoussees(id, essai + 1)
            .catch(() => undefined)
            .finally(() => travaux.delete(travail));
          travaux.add(travail);
        }, 3000);
        m.unref?.();
      }
      return b;
    }
    await base.executer(`UPDATE site_lz_pousses SET traite_le = ? WHERE id IN (${avis.map(() => '?').join(', ')})`, [iso(t0()), ...avis.map(a => a.id)]);
    return b;
  }

  /** Tests et arrêt propre : attend les avis planifiés (minuteries déclenchées tout de suite) et leurs traitements. */
  async function attendrePoussees() {
    for (const [id, x] of minuteries) {
      clearTimeout(x.minuterie);
      minuteries.delete(id);
      const travail = traiterPoussees(id).finally(() => travaux.delete(travail));
      travaux.add(travail);
    }
    while (travaux.size) await Promise.allSettled([...travaux]);
  }

  /**
   * Boucle du processus meneur (boucle-salons.mjs, toutes les 15 s) : avis du site non traités (processus redémarré),
   * relecture rapide des événements en cours (60 s, ou 15 s s'il reste du travail), envois dus de la file.
   */
  async function tacheBoucle() {
    const avis = await base.tous('SELECT DISTINCT evenement_id FROM site_lz_pousses WHERE traite_le IS NULL', []);
    let poussees = 0;
    for (const { evenement_id: id } of avis) {
      if (minuteries.has(id) || enCours.has(id)) continue;
      await traiterPoussees(id);
      poussees++;
    }
    const rapide = await tacheRapide();
    const envoyes = await viderEnvoisDus();
    const enCoursN = rapide?.enCours ?? (await compterEnCours());
    return { poussees, relecture: rapide, envoyes, enCours: enCoursN };
  }

  async function compterEnCours() {
    const liste = await base.tous('SELECT id, statut, debut, fin, salons_match, site_tournoi_id FROM club_evenements WHERE salons_match IS NOT NULL', []);
    const t = t0();
    return liste.filter(e => lireReglages(e.salons_match).actif && e.site_tournoi_id && enCoursEvt(e, t)).length;
  }

  // ---------------------------------------------------------------- Routes (droits : ceux de l'événement)

  const VIDE_ENVOIS = Object.freeze({ envoyes: 0, attente: 0, echecs: 0, raisons: [] });
  const publique = (l, guildId, envois = null) => ({
    id: l.id,
    cle: l.site_match_id,
    genre: l.genre,
    titre: l.titre,
    equipes: (jsonOu(l.infos, {})?.equipes ?? []).map(e => ({ nom: e.nom, tag: e.tag, role: Boolean(e.role) })),
    staff: (jsonOu(l.infos, {})?.staff ?? []).map(x => ({ nom: x.nom, present: Boolean(x.present) })),
    salonId: l.salon_id ?? null,
    lien: l.salon_id && guildId && l.statut !== 'supprime' ? `https://discord.com/channels/${guildId}/${l.salon_id}` : null,
    statut: l.statut,
    prevuLe: l.prevu_le ?? null,
    resultatLe: l.resultat_le ?? null,
    suppressionLe: l.suppression_le ?? null,
    supprimeLe: l.supprime_le ?? null,
    historique: l.transcript !== null && l.transcript !== undefined,
    nbMessages: Number(l.nb_messages ?? 0),
    erreur: l.erreur ?? null,
    // Messages du bot pour ce salon (file d'envoi) : envoyés, en attente, en échec avec la raison.
    envois: envois?.get(l.id) ?? VIDE_ENVOIS,
  });

  async function evenementOu404(id) {
    const evt = typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id) ? await base.premier('SELECT * FROM club_evenements WHERE id = ?', [id]) : null;
    if (!evt) throw echec(404, 'evenement-introuvable', 'Événement introuvable.');
    return evt;
  }

  async function vue(ev, acteur, id) {
    await ev.exiger(acteur);
    const evt = await evenementOu404(id);
    const reglages = lireReglages(evt.salons_match);
    const d = await ctxDiscord();
    let categories = [];
    let salonsTexte = [];
    let erreurDiscord = d.erreur;
    if (!d.erreur) {
      const r = await rest(fetchDiscord, jetonBot, 'GET', `/guilds/${d.guildId}/channels`);
      if (r.ok && Array.isArray(r.corps)) {
        categories = r.corps.filter(s => Number(s.type) === 4).sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0)).map(s => ({ id: String(s.id), nom: String(s.name ?? '') }));
        // « Placer sous le salon » : salons écrits (et catégories, pour les regrouper), dans l'ordre de Discord.
        salonsTexte = r.corps
          .filter(s => Number(s.type) === 4 || ECRITS.has(Number(s.type)))
          .map(s => ({ id: String(s.id), nom: String(s.name ?? ''), type: Number(s.type) === 4 ? 'categorie' : 'texte', parent: s.parent_id ? String(s.parent_id) : null, position: Number(s.position ?? 0) }))
          .sort((a, b) => a.position - b.position);
      }
      else erreurDiscord = `discord-${r.statut}`;
    }
    const lignes = await lignesDe(id);
    const stats = await statsEnvois(id);
    // Matchs du site sans salon : « Créer maintenant ».
    let matchs = [];
    let erreurSite = null;
    if (evt.site_tournoi_id) {
      try {
        const lu = await lireMatchsSite(site, evt.site_tournoi_id);
        const app = await equipesApp(id);
        const actives = new Set(lignes.filter(l => l.statut !== 'supprime').map(l => l.site_match_id));
        matchs = lu.matchs
          .filter(m => !actives.has(m.cle) && !m.resultat)
          .slice(0, 200)
          .map(m => ({ cle: m.cle, genre: m.genre, titre: titreDe(m, 'fr'), statut: m.statut, prevuLe: m.prevu, equipes: equipesDuMatch(m, lu.equipes, app).map(e => ({ nom: e.nom, tag: e.tag, role: Boolean(e.roleId) })), staff: (m.staff ?? []).map(x => ({ nom: x.nom, present: Boolean(x.discordId) })) }));
      } catch (e) {
        erreurSite = String(e?.message ?? e).slice(0, 200);
      }
    }
    return {
      reglages,
      choix: { limites: LIMITES_SALONS, langues: LANGUES_SALONS, defaut: REGLAGES_DEFAUT },
      lie: Boolean(evt.site_tournoi_id),
      bot: Boolean(jetonBot),
      erreurDiscord,
      erreurSite,
      categories,
      salonsTexte,
      salons: lignes.map(l => publique(l, d.guildId, stats.par)),
      matchs,
      etat: await lireEtat(id),
      envois: stats.total,
    };
  }

  /**
   * État léger (relu toutes les 20 s par la fiche) : dernier passage (son origine et son heure : « Dernière synchro :
   * il y a 4 s, poussée par le site »), envois par salon. Ni Discord ni le site ne sont appelés.
   */
  async function etatLeger(ev, acteur, id) {
    await ev.exiger(acteur);
    await evenementOu404(id);
    const stats = await statsEnvois(id);
    const lignes = await base.tous('SELECT id, statut, erreur FROM club_salons_match WHERE evenement_id = ?', [id]);
    return { etat: await lireEtat(id), envois: stats.total, salons: lignes.map(l => ({ id: l.id, statut: l.statut, erreur: l.erreur ?? null, envois: stats.par.get(l.id) ?? VIDE_ENVOIS })), heure: t0() };
  }

  /** « Renvoyer les messages en échec » : remis en file (essais à zéro), puis envoyés tout de suite. */
  async function renvoyerEchecs(ev, acteur, id) {
    await ev.exiger(acteur);
    await evenementOu404(id);
    if (!jetonBot) throw echec(503, 'bot-absent', 'Bot Discord non configuré (DISCORD_BOT_TOKEN).');
    const r = await base.executer("UPDATE club_salons_match_envois SET statut = 'attente', essais = 0, erreur = NULL, prochain_le = ?, maj_le = ? WHERE evenement_id = ? AND statut = 'echec' AND salon_match_id IN (SELECT id FROM club_salons_match WHERE evenement_id = ? AND statut <> 'supprime')", [iso(t0()), iso(t0()), id, id]);
    const b = await synchroniser(id, { fileSeule: true });
    if (b?.occupe) throw echec(409, 'salons-match-occupe', 'Une synchronisation est en cours, réessayez dans un instant.');
    return { ...(await vue(ev, acteur, id)), renvoyes: Number(r.changements ?? 0) };
  }

  async function enregistrer(ev, acteur, id, corps) {
    await ev.exiger(acteur);
    const evt = await evenementOu404(id);
    const r = validerReglages(corps, lireReglages(evt.salons_match));
    await base.executer('UPDATE club_evenements SET salons_match = ?, maj_le = ? WHERE id = ?', [JSON.stringify(r), iso(t0()), id]);
    if (r.actif && evt.site_tournoi_id) await synchroniser(id, { origine: 'manuel' }).catch(e => journal.error?.('[esport] salons de match', e?.message ?? e));
    return vue(ev, acteur, id);
  }

  async function synchroniserMaintenant(ev, acteur, id) {
    await ev.exiger(acteur);
    const evt = await evenementOu404(id);
    if (!evt.site_tournoi_id) throw echec(400, 'site-non-lie', 'Choisissez d’abord le tournoi du site.');
    const b = await synchroniser(id, { origine: 'manuel' });
    if (b?.occupe) throw echec(409, 'salons-match-occupe', 'Une synchronisation est déjà en cours, réessayez dans un instant.');
    return vue(ev, acteur, id);
  }

  async function creerMaintenant(ev, acteur, id, corps) {
    await ev.exiger(acteur);
    const evt = await evenementOu404(id);
    const cle = corps?.cle;
    if (typeof cle !== 'string' || !/^[ml]:[0-9a-f-]{36}$/i.test(cle)) throw echec(400, 'salons-match-cle', 'Match invalide.');
    if (!evt.site_tournoi_id) throw echec(400, 'site-non-lie', 'Choisissez d’abord le tournoi du site.');
    const reglages = lireReglages(evt.salons_match);
    if (!reglages.categorieId && !reglages.ancreId) throw echec(400, 'salons-match-categorie', 'Choisissez la catégorie Discord des salons de match.');
    const d = await ctxDiscord();
    if (d.erreur === 'bot-absent') throw echec(503, 'bot-absent', 'Bot Discord non configuré (DISCORD_BOT_TOKEN).');
    if (d.erreur) throw echec(400, 'vocaux-serveur', 'Choisissez d’abord le serveur Discord (Tickets › Configuration › Général).');
    const l = await base.premier('SELECT * FROM club_salons_match WHERE evenement_id = ? AND site_match_id = ?', [id, cle]);
    if (l && l.statut !== 'supprime' && l.statut !== 'creation') throw echec(409, 'salons-match-existe', 'Ce match a déjà son salon.');
    // Salon supprimé auparavant : sa ligne (et son historique) est gardée sous une autre clé, une nouvelle est créée.
    if (l?.statut === 'supprime') await base.executer('UPDATE club_salons_match SET site_match_id = ? WHERE id = ?', [`${cle}#${l.id.slice(0, 8)}`, l.id]);
    const b = await synchroniser(id, { forcer: cle, origine: 'manuel' });
    if (b?.occupe) throw echec(409, 'salons-match-occupe', 'Une synchronisation est déjà en cours, réessayez dans un instant.');
    const apres = await base.premier('SELECT statut, erreur FROM club_salons_match WHERE evenement_id = ? AND site_match_id = ?', [id, cle]);
    if (!apres || apres.statut !== 'ouvert') throw echec(502, 'salons-match-creation', `Salon non créé${apres?.erreur ? ` (${apres.erreur})` : b?.erreur ? ` (${b.erreur})` : ''}.`);
    return vue(ev, acteur, id);
  }

  async function supprimerMaintenant(ev, acteur, id, salonMatchId) {
    await ev.exiger(acteur);
    await evenementOu404(id);
    const l = await base.premier('SELECT * FROM club_salons_match WHERE id = ? AND evenement_id = ?', [salonMatchId, id]);
    if (!l) throw echec(404, 'salons-match-introuvable', 'Salon de match introuvable.');
    if (l.statut === 'supprime') return vue(ev, acteur, id);
    if (!jetonBot) throw echec(503, 'bot-absent', 'Bot Discord non configuré (DISCORD_BOT_TOKEN).');
    if (!(await prendreBail(id))) throw echec(409, 'salons-match-occupe', 'Une synchronisation est en cours, réessayez dans un instant.');
    try {
      const r = await fermerSalon(l, 'Esport HQ : salon de match supprimé depuis l’app');
      if (r === 'limite') throw echec(429, 'discord-limite', 'Discord limite les requêtes : réessayez dans une minute.');
      if (r === 'refus') throw echec(502, 'discord-refus', 'Discord a refusé la suppression du salon (permission « Gérer les salons »).');
    } finally {
      await rendreBail(id).catch(() => undefined);
    }
    return vue(ev, acteur, id);
  }

  /** Historique d'un salon : staff de l'événement (compte de l'app lié) ou permission evenements.gerer. Jamais d'IA. */
  async function historique(ev, acteur, id, salonMatchId) {
    const evt = await evenementOu404(id);
    let ok = false;
    try {
      await ev.exiger(acteur);
      ok = true;
    } catch {
      ok = Boolean(acteur?.compte && (await base.premier('SELECT 1 AS x FROM club_evenement_staff WHERE evenement_id = ? AND compte_id = ?', [evt.id, acteur.compte])));
    }
    if (!ok) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const l = await base.premier('SELECT * FROM club_salons_match WHERE id = ? AND evenement_id = ?', [salonMatchId, id]);
    if (!l) throw echec(404, 'salons-match-introuvable', 'Salon de match introuvable.');
    return { salon: publique(l, null), messages: jsonOu(l.transcript, []) ?? [] };
  }

  return { synchroniser, fermerEvenement, tacheCron, tacheRapide, tacheBoucle, viderEnvoisDus, recevoirPoussee, traiterPoussees, attendrePoussees, vue, etatLeger, enregistrer, synchroniserMaintenant, creerMaintenant, supprimerMaintenant, renvoyerEchecs, historique };
}

/**
 * Routes (dans routesEvenements) :
 *   GET|PUT   /evenements/:id/salons-match                       vue ; réglages
 *   POST      /evenements/:id/salons-match/synchro               synchroniser maintenant
 *   POST      /evenements/:id/salons-match/creer                 { cle } créer maintenant
 *   POST      /evenements/:id/salons-match/:s/supprimer          supprimer maintenant (historique gardé)
 *   GET       /evenements/:id/salons-match/:s/historique         historique (staff de l'événement, evenements.gerer)
 *   GET       /evenements/:id/salons-match/etat                  état léger (dernière synchro, envois par salon)
 *   POST      /evenements/:id/salons-match/renvoyer              renvoyer les messages en échec
 */
export async function routesSalonsMatch({ sm, ev, acteur, id, p, m, lireCorps, limite }) {
  const [, , x, y] = p;
  if (p.length === 2 && m === 'GET') return sm.vue(ev, acteur, id);
  if (p.length === 2 && m === 'PUT') return sm.enregistrer(ev, acteur, id, await lireCorps());
  if (p.length === 3 && x === 'synchro' && m === 'POST') {
    await limite('tickets_discord', acteur.compte);
    return sm.synchroniserMaintenant(ev, acteur, id);
  }
  if (p.length === 3 && x === 'etat' && m === 'GET') return sm.etatLeger(ev, acteur, id);
  if (p.length === 3 && x === 'renvoyer' && m === 'POST') {
    await limite('tickets_discord', acteur.compte);
    return sm.renvoyerEchecs(ev, acteur, id);
  }
  if (p.length === 3 && x === 'creer' && m === 'POST') {
    await limite('tickets_discord', acteur.compte);
    return sm.creerMaintenant(ev, acteur, id, await lireCorps());
  }
  if (p.length === 4 && y === 'supprimer' && m === 'POST') {
    await limite('tickets_discord', acteur.compte);
    return sm.supprimerMaintenant(ev, acteur, id, x);
  }
  if (p.length === 4 && y === 'historique' && m === 'GET') return sm.historique(ev, acteur, id, x);
  return undefined;
}

/** Fin ou suppression d'un événement (evenements-club/discord.mjs, nettoyerEvenement) : salons de match fermés. */
export function fermerSalonsEvenement(ctx, evenementId) {
  return creerSalonsMatch({ base: ctx.base, site: null, fetch: ctx.fetch, jetonBot: ctx.jetonBot, botId: ctx.botId ?? null, maintenant: ctx.maintenant, journal: ctx.journal ?? console }).fermerEvenement(evenementId);
}
