/**
 * Salons de match Discord d'un événement du club lié à un tournoi du site LigneZero (docs/esport/evenements.md,
 * « Salons de match ») — migration 0073.
 *
 * Réglages par événement (`club_evenements.salons_match`, fiche › « Salons de match ») : activé, catégorie Discord
 * « Matchs », modèle du nom (`{round}-{equipes}`, nettoyé), délai de suppression après la fin (30 min par défaut,
 * 5 à 1440), rappel (10 min avant), langue (celle du bot par défaut), création anticipée (0 : dès que les
 * équipes du match sont connues), rétention des historiques (0 : jusqu'à la suppression de l'événement).
 *
 * Synchronisation (`synchroniser(evenementId)`) : le cron (toutes les 5 min) et le processus meneur de la Gateway
 * (toutes les 60 s tant que l'événement est en cours, `tacheRapide`) lisent les matchs (1v1) et lobbies (N équipes) du
 * tournoi lié par le pont signé (lecture seule), puis :
 *  - nouveau match (au moins deux équipes, pas terminé) → salon texte PRIVÉ dans la catégorie : @everyone sans accès ;
 *    rôle Discord de chaque équipe du match (voir, écrire, historique, fichiers) ; rôle staff de l'événement et rôles
 *    staff supplémentaires (en plus : gérer les messages) ; le bot. Message d'accueil (embed : match, phase, horaire
 *    `<t:…:F>` et relatif, équipes avec TAG, joueurs mentionnés, capitaines) et mention des rôles et capitaines ;
 *  - horaire ou équipes changés sur le site → embed modifié, accès mis à jour, court message « Mise à jour » ;
 *  - rappel 10 minutes avant (une seule fois ; colonne rappel30_le de la migration 0073 inutilisée) ;
 *  - résultat saisi (match terminé) → résultat posté, suppression programmée après le délai ;
 *  - match supprimé du site → avis posté, suppression programmée après le délai ;
 *  - équipe du match sans rôle Discord (pas reliée à une équipe de l'événement) → signalée dans l'embed, staff averti ;
 *  - staff assigné au match sur le site (avec Discord lié) → accès par membre (comme le staff), mentionné dans l'embed
 *    (« Staff assigné ») ; absent du serveur ou sans Discord : signalé au staff ; assignation changée → accès et embed ;
 *  - « Placer sous le salon » (réglage facultatif) → salons créés dans la catégorie du salon repère et rangés juste sous
 *    lui par horaire (un PATCH des positions) ; repère supprimé : catégorie choisie, staff averti une fois ;
 *  - suppression due → historique enregistré dans l'app (messages, auteurs, pièces jointes en liens), salon supprimé.
 * Idempotent : une ligne par match (clé unique), un bail par événement (un seul processus à la fois), un salon créé mais
 * pas encore noté (processus arrêté net) est retrouvé par son sujet (`esport-hq:match:<clé>`) au lieu d'être recréé.
 * Borné : 5 créations et 40 actions Discord par passage, arrêt au premier refus pour limite de débit (429).
 */

import { echec, iso, jsonOu, nouvelId } from '../outils.mjs';
import { lireGeneral, instructionReglage } from '../tickets/reglages.mjs';
import { DROITS_BOT, rest } from '../tickets/discord.mjs';
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
export const LIMITES_SALONS = Object.freeze({ delaiMin: 5, delaiMax: 1440, modele: 80, avanceMax: 168, retentionMax: 3650, creationsParPassage: 5, actionsParPassage: 40, salonsParCategorie: 50, pagesHistorique: 20 });
export const LANGUES_SALONS = Object.freeze(['bot', 'fr', 'en', 'fr_en', 'en_fr']);
const ID = /^\d{5,25}$/;
const MINUTE = 60_000;
const BAIL_MS = 120_000;
const MARQUEUR = 'esport-hq:match:';

const VOIR = 1n << 10n;
const ENVOYER = 1n << 11n;
const GERER_MESSAGES = 1n << 13n;
const JOINDRE = 1n << 15n;
const HISTORIQUE = 1n << 16n;
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

/**
 * Lit les matchs et lobbies du tournoi lié (pont signé, lecture seule). Rend `{ matchs, equipes }` : `matchs` =
 * [{ cle, genre, siteId, round, position, groupe, bracket, label, phase, equipes: [teamId], statut, prevu, stream,
 * staff: [{ nom, discordId }], resultat }], `equipes` = Map(teamId → { id, nom, tag, joueurs }). Lève si le site ne répond pas (rien n'est alors
 * considéré comme supprimé).
 */
export async function lireMatchsSite(site, tournoiId) {
  const parT = [{ col: 'tournament_id', op: 'eq', val: tournoiId }];
  const ordre = [{ col: 'round', asc: true }, { col: 'position', asc: true }];
  const [m1, lobbies, equipesS, phases, staffS] = await Promise.all([
    site.lister('tournament_matches', parT, ordre),
    site.lister('tournament_lobbies', parT, ordre),
    site.lister('tournament_teams', parT),
    site.lister('tournament_stages', parT).catch(() => []),
    // Staff assigné (site à jour, migration 0008) : nom affiché et Discord ID ; ancien site : aucun.
    site.lister('tournament_match_staff_discord', parT).catch(() => []),
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
    const fini = m.status === 'finished';
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
      statut: ['pending', 'live', 'finished'].includes(m.status) ? m.status : 'pending',
      prevu: m.scheduled_at ? new Date(m.scheduled_at).toISOString() : null,
      stream: typeof m.stream_url === 'string' && /^https:\/\//.test(m.stream_url) ? m.stream_url : null,
      staff: staffDe('match_id', m.id),
      resultat: fini ? { scores: [{ equipe: m.team_a_id, score: m.score_a ?? null }, { equipe: m.team_b_id, score: m.score_b ?? null }].filter(x => x.equipe), vainqueur: m.winner_id ?? null } : null,
    });
  }
  for (const l of lobbies) {
    const es = entrees.filter(e => e.lobby_id === l.id).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const fini = l.status === 'finished';
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
      statut: ['pending', 'live', 'finished'].includes(l.status) ? l.status : 'pending',
      prevu: l.scheduled_at ? new Date(l.scheduled_at).toISOString() : null,
      stream: typeof l.stream_url === 'string' && /^https:\/\//.test(l.stream_url) ? l.stream_url : null,
      staff: staffDe('lobby_id', l.id),
      resultat: fini ? { classement: es.map(e => ({ equipe: e.team_id, placement: e.placement ?? null, points: Number(e.points ?? 0), dnf: Boolean(e.dnf) })) } : null,
    });
  }
  return { matchs, equipes };
}

/** Staff assigné dans l'empreinte (ajouté seulement s'il y en a : les empreintes d'avant restent valables). */
const cleStaff = m => (m.staff ?? []).map(x => x.discordId ?? `nom:${x.nom}`).sort();
const empreinteMatch = m => JSON.stringify([m.prevu, [...m.equipes].sort(), m.round, m.position, m.groupe, m.bracket, m.label, ...(cleStaff(m).length ? [cleStaff(m)] : [])]);
const empreinteResultat = m => (m.resultat ? JSON.stringify(m.resultat) : null);

// ------------------------------------------------------------------ Service

export function creerSalonsMatch({ base, site, fetch: fetchDiscord, jetonBot, botId = null, maintenant = () => Date.now(), journal = console }) {
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

  const pings = equipes => {
    const roles = [...new Set(equipes.map(e => e.roleId).filter(Boolean))];
    const users = [...new Set(equipes.flatMap(e => e.joueurs.filter(j => j.capitaine && j.discordId && !j.absent).map(j => j.discordId)))];
    return { texte: [...roles.map(r => `<@&${r}>`), ...users.map(u => `<@${u}>`)].join(' '), allowed: { parse: [], roles: roles.slice(0, 100), users: users.slice(0, 100) } };
  };

  function surcharges(evt, equipes, guildId, idBot, { gestion = true, assignes = [] } = {}) {
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
    if (idBot) o.push({ id: String(idBot), type: 1, allow: DROITS_BOT, deny: '0' });
    return o;
  }

  async function idDuBot() {
    if (botId) return botId;
    const r = await rest(fetchDiscord, jetonBot, 'GET', '/users/@me');
    botId = r.ok ? (r.corps?.id ?? null) : null;
    return botId;
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

  /** Enregistre l'historique puis supprime le salon. Rend 'fait', 'limite' ou 'refus'. */
  async function fermerSalon(ligne, raison = 'Esport HQ : match terminé') {
    if (!ligne.salon_id) {
      await maj(ligne.id, { statut: 'supprime', supprime_le: iso(t0()), suppression_le: null });
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
    return 'fait';
  }

  async function poster(ligne, corps, compteur) {
    compteur.n++;
    const r = await rest(fetchDiscord, jetonBot, 'POST', `/channels/${ligne.salon_id}/messages`, corps);
    if (r.statut === 429) compteur.limite = true;
    if (r.statut === 404 || r.code === 10003) {
      // Salon supprimé à la main : la ligne est fermée (rien n'est recréé pour ce match).
      await maj(ligne.id, { statut: 'supprime', supprime_le: iso(t0()), suppression_le: null, erreur: 'salon-disparu' });
      ligne.statut = 'supprime';
    }
    return r;
  }

  async function lireEtat(id) {
    return jsonOu((await base.premier('SELECT valeur FROM tickets_reglages WHERE cle = ?', [`salons_match:${id}`]))?.valeur, null);
  }
  async function ecrireEtat(id, etat) {
    const i = instructionReglage(`salons_match:${id}`, etat, null, t0());
    await base.executer(i.sql, i.params);
  }

  /**
   * Crée le salon d'un match (ligne réservée par la clé unique). `force` : création manuelle (sans attendre la création
   * anticipée, même avec une seule équipe connue).
   */
  async function creerSalon({ evt, reglages, ligne, m, equipes, d, mode, compteur, salonsServeur, parentId = reglages.categorieId }) {
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
    // Salon déjà créé par un passage interrompu (processus arrêté avant de noter l'identifiant) : retrouvé par son sujet.
    let salon = (salonsServeur ?? []).find(s => Number(s.type) === 0 && String(s.topic ?? '').includes(`${MARQUEUR}${m.cle}`) && String(s.topic ?? '').includes(evt.id.slice(0, 8)));
    if (!salon) {
      const corps = { name: nom, type: 0, ...(parentId ? { parent_id: parentId } : {}), topic: `${titre} · ${MARQUEUR}${m.cle} · ${evt.id.slice(0, 8)}`.slice(0, 1024), permission_overwrites: surcharges(evt, equipes, d.guildId, idBot, { assignes: m.staff }) };
      compteur.n++;
      let r = await rest(fetchDiscord, jetonBot, 'POST', `/guilds/${d.guildId}/channels`, corps, { raison: 'Esport HQ : salon de match' });
      // Le bot ne peut accorder que ce qu'il a : sans « Gérer les messages », le staff écrit sans pouvoir modérer.
      if (!r.ok && (r.code === 50013 || r.statut === 403)) {
        compteur.n++;
        r = await rest(fetchDiscord, jetonBot, 'POST', `/guilds/${d.guildId}/channels`, { ...corps, permission_overwrites: surcharges(evt, equipes, d.guildId, idBot, { gestion: false, assignes: m.staff }) }, { raison: 'Esport HQ : salon de match' });
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
    const p = pings(equipes);
    await maj(ligne.id, { salon_id: String(salon.id), statut: 'ouvert', titre, infos: JSON.stringify({ equipes: equipes.map(e => ({ nom: e.nom, tag: e.tag, role: Boolean(e.roleId) })), staff: (m.staff ?? []).map(x => ({ nom: x.nom, present: Boolean(x.discordId && !x.absent) })) }), erreur: null });
    ligne.salon_id = String(salon.id);
    ligne.statut = 'ouvert';
    const msg = await poster(ligne, { content: `${p.texte}\n${tx(mode, 'pret')}`.trim().slice(0, 2000), embeds: [embedMatch(evt, m, equipes, mode)], allowed_mentions: p.allowed }, compteur);
    // Rappel déjà dépassé (salon créé à moins de 10 minutes du match) : jamais envoyé en retard.
    const avant = m.prevu ? Date.parse(m.prevu) - t0() : Infinity;
    await maj(ligne.id, {
      message_id: msg.ok ? String(msg.corps?.id ?? '') || null : null,
      empreinte: empreinteMatch(m),
      prevu_le: m.prevu,
      rappel10_le: avant <= 10 * MINUTE ? iso(t0()) : null,
    });
    await avertirSansRole(evt, ligne, equipes, mode, compteur, m);
    return true;
  }

  /** Équipes sans rôle Discord : signalées une fois (par ensemble d'équipes) au staff de l'événement. */
  async function avertirSansRole(evt, ligne, equipes, mode, compteur, m = null) {
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
    if (textes.length) await poster(ligne, { content: `${roles.map(r => `<@&${r}>`).join(' ')} ${textes.join('\n')}`.trim().slice(0, 2000), allowed_mentions: { parse: [], roles } }, compteur);
    await maj(ligne.id, { avertis: cle });
    ligne.avertis = cle;
  }

  const delaiDe = reglages => reglages.delaiSuppressionMin * MINUTE;
  const quand = ms => `<t:${Math.floor(ms / 1000)}:R>`;

  /** Suit un match dont le salon existe : changements, rappels, résultat. */
  async function suivre({ evt, reglages, ligne, m, equipes, d, mode, compteur }) {
    const fini = Boolean(m.resultat);
    const p = pings(equipes);
    if (ligne.empreinte !== empreinteMatch(m)) {
      const avant = jsonOu(ligne.empreinte, []);
      const quoi = [];
      if (avant[0] !== m.prevu) quoi.push('maj_horaire');
      if (JSON.stringify(avant[1] ?? []) !== JSON.stringify([...m.equipes].sort())) quoi.push('maj_equipes');
      if (JSON.stringify(avant[7] ?? []) !== JSON.stringify(cleStaff(m))) quoi.push('maj_staff');
      if (!quoi.length) quoi.push('maj_titre');
      if (ligne.message_id) {
        compteur.n++;
        const r = await rest(fetchDiscord, jetonBot, 'PATCH', `/channels/${ligne.salon_id}/messages/${ligne.message_id}`, { embeds: [embedMatch(evt, m, equipes, mode)], allowed_mentions: { parse: [] } });
        if (r.statut === 429) {
          compteur.limite = true;
          return;
        }
      }
      if (quoi.includes('maj_equipes') || quoi.includes('maj_staff')) {
        // Accès : rôles des équipes du match et staff assigné (ajoutés, retirés), staff de l'événement et bot inchangés.
        compteur.n++;
        const r = await rest(fetchDiscord, jetonBot, 'PATCH', `/channels/${ligne.salon_id}`, { permission_overwrites: surcharges(evt, equipes, d.guildId, await idDuBot(), { assignes: m.staff }) }, { raison: 'Esport HQ : équipes du match modifiées' });
        if (!r.ok && (r.code === 50013 || r.statut === 403)) await rest(fetchDiscord, jetonBot, 'PATCH', `/channels/${ligne.salon_id}`, { permission_overwrites: surcharges(evt, equipes, d.guildId, await idDuBot(), { gestion: false, assignes: m.staff }) }, { raison: 'Esport HQ : équipes du match modifiées' });
      }
      const texte = tx(mode, 'maj', { quoi: quoi.map(q => lib(mode, q)).join(', ') });
      // Seul le staff assigné a changé : mention du staff assigné présent, pas des équipes.
      const staffPresent = (m.staff ?? []).filter(x => x.discordId && !x.absent).map(x => x.discordId);
      const ping = quoi.length === 1 && quoi[0] === 'maj_staff' ? { texte: staffPresent.map(u => `<@${u}>`).join(' '), allowed: { parse: [], users: staffPresent } } : p;
      await poster(ligne, { content: `${ping.texte} ${texte}`.trim().slice(0, 2000), allowed_mentions: ping.allowed }, compteur);
      if (ligne.statut === 'supprime') return;
      const horaire = avant[0] !== m.prevu;
      const reste = m.prevu ? Date.parse(m.prevu) - t0() : Infinity;
      await maj(ligne.id, {
        empreinte: empreinteMatch(m),
        prevu_le: m.prevu,
        titre: titreDe(m, langues(mode)[0]),
        infos: JSON.stringify({ equipes: equipes.map(e => ({ nom: e.nom, tag: e.tag, role: Boolean(e.roleId) })), staff: (m.staff ?? []).map(x => ({ nom: x.nom, present: Boolean(x.discordId && !x.absent) })) }),
        // Nouvel horaire : rappel réarmé (sauf s'il est déjà dépassé).
        ...(horaire ? { rappel10_le: reste <= 10 * MINUTE ? iso(t0()) : null } : {}),
      });
      if (horaire) {
        ligne.rappel10_le = reste <= 10 * MINUTE ? iso(t0()) : null;
      }
      await avertirSansRole(evt, ligne, equipes, mode, compteur, m);
    }
    if (compteur.limite || ligne.statut === 'supprime') return;
    // Rappel 10 minutes avant (une seule fois).
    if (reglages.rappels && m.prevu && !fini && m.statut === 'pending') {
      const reste = Date.parse(m.prevu) - t0();
      if (!ligne.rappel10_le && reste <= 10 * MINUTE && reste > -5 * MINUTE) {
        const r = await poster(ligne, { content: `${p.texte} ${tx(mode, 'rappel', { quand: quand(Date.parse(m.prevu)) })}`.trim().slice(0, 2000), allowed_mentions: p.allowed }, compteur);
        if (r.ok) await maj(ligne.id, { rappel10_le: iso(t0()) });
      }
    }
    if (compteur.limite || ligne.statut === 'supprime') return;
    // Résultat.
    const fr = empreinteResultat(m);
    if (fini && fr !== ligne.resultat_empreinte) {
      const corrige = Boolean(ligne.resultat_empreinte);
      const suppression = corrige && ligne.suppression_le ? Date.parse(ligne.suppression_le) : t0() + delaiDe(reglages);
      const r = await poster(ligne, { content: `${tx(mode, corrige ? 'resultat_corrige' : 'resultat')}\n${tx(mode, 'suppression', { quand: quand(suppression) })}`.slice(0, 2000), embeds: [embedResultat(m, equipes, mode)], allowed_mentions: { parse: [] } }, compteur);
      if (r.ok) await maj(ligne.id, { resultat_empreinte: fr, resultat_le: iso(t0()), statut: 'termine', suppression_le: iso(suppression) });
    } else if (!fini && ligne.statut === 'termine') {
      // Résultat retiré sur le site (erreur de saisie) : le salon reste ouvert.
      const r = await poster(ligne, { content: tx(mode, 'resultat_retire'), allowed_mentions: { parse: [] } }, compteur);
      if (r.ok) await maj(ligne.id, { resultat_empreinte: null, resultat_le: null, statut: 'ouvert', suppression_le: null });
    }
  }

  /** Salons dont la suppression est due : historique enregistré, salon supprimé. */
  async function suppressionsDues(id, compteur) {
    const dues = (await base.tous("SELECT * FROM club_salons_match WHERE evenement_id = ? AND statut IN ('termine', 'annule') AND suppression_le IS NOT NULL AND suppression_le <= ?", [id, iso(t0())])).slice(0, 10);
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
  async function signalerAncre(evt, reglages, absente, mode, compteur) {
    const cle = `salons_match_ancre:${evt.id}`;
    const deja = jsonOu((await base.premier('SELECT valeur FROM tickets_reglages WHERE cle = ?', [cle]))?.valeur, null);
    if (!absente) {
      if (deja) await base.executer('DELETE FROM tickets_reglages WHERE cle = ?', [cle]);
      return;
    }
    // Alerte (notification) dès que le repère manque, avec ou sans salon ouvert où l'écrire ; au plus une par 6 h.
    await alerter(evt, 'ancre-supprimee', { parMatch: false });
    if (deja?.ancreId === reglages.ancreId || compteur.limite) return;
    const ligne = await base.premier("SELECT * FROM club_salons_match WHERE evenement_id = ? AND statut = 'ouvert' AND salon_id IS NOT NULL ORDER BY cree_le DESC", [evt.id]);
    if (!ligne) return; // aucun salon où l'écrire : au prochain passage
    const roles = [evt.staff_role_id, ...(evt.roles_supprimes_le ? [] : idsSup(evt.staff_roles_sup))].filter(x => x && ID.test(String(x))).map(String);
    const r = await poster(ligne, { content: `${roles.map(x => `<@&${x}>`).join(' ')} ${tx(mode, 'ancre_absente')}`.trim().slice(0, 2000), allowed_mentions: { parse: [], roles } }, compteur);
    if (r.ok) {
      const i = instructionReglage(cle, { ancreId: reglages.ancreId, le: iso(t0()) }, null, t0());
      await base.executer(i.sql, i.params);
    }
  }

  /** Une synchronisation (sous bail). Rend le bilan. */
  async function synchroniserSousBail(evenementId, { forcer = null } = {}) {
    const evt = await base.premier('SELECT * FROM club_evenements WHERE id = ?', [evenementId]);
    if (!evt) return null;
    const reglages = lireReglages(evt.salons_match);
    const bilan = { le: iso(t0()), crees: 0, majs: 0, resultats: 0, annules: 0, supprimes: 0, attente: 0, limite: false, erreur: null };
    const compteur = { n: 0, limite: false };
    const d = await ctxDiscord();
    if (d.erreur) {
      bilan.erreur = d.erreur;
      return bilan;
    }
    const mode = modeLangue(reglages, d.general);
    // Suppressions dues d'abord (même si les salons de match ont été désactivés depuis).
    bilan.supprimes += await suppressionsDues(evenementId, compteur);
    if ((!reglages.actif && !forcer) || !evt.site_tournoi_id || ['termine', 'annule'].includes(evt.statut)) {
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
    // Staff assigné : présent sur le serveur ? (une lecture par personne et par passage)
    const membres = new Map();
    const enrichirStaff = async m => {
      for (const x of m.staff ?? []) {
        if (!x.discordId) continue;
        if (!membres.has(x.discordId)) {
          compteur.n++;
          const r = await rest(fetchDiscord, jetonBot, 'GET', `/guilds/${d.guildId}/members/${x.discordId}`);
          if (r.statut === 429) compteur.limite = true;
          membres.set(x.discordId, r.ok ? true : r.code === 10007 || (r.statut === 404 && r.code !== 10004) ? false : null);
        }
        x.absent = membres.get(x.discordId) === false;
      }
    };
    let creations = 0;
    // Les plus proches d'abord (horaire, puis round et position).
    const tries = [...lu.matchs].sort((a, b) => (a.prevu ? Date.parse(a.prevu) : Infinity) - (b.prevu ? Date.parse(b.prevu) : Infinity) || a.round - b.round || a.position - b.position);
    for (const m of tries) {
      vus.add(m.cle);
      if (compteur.limite || compteur.n >= LIMITES_SALONS.actionsParPassage) {
        bilan.attente++;
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
        await suivre({ evt, reglages, ligne, m, equipes, d, mode, compteur });
        if (avant !== empreinteMatch(m)) bilan.majs++;
        if (m.resultat && avantR !== empreinteResultat(m)) bilan.resultats++;
        continue;
      }
      if (ligne && ligne.statut !== 'creation') continue; // supprimé, annulé : jamais recréé automatiquement
      const manuel = forcer === m.cle;
      const avance = reglages.avanceH > 0 && m.prevu && m.statut !== 'live' ? Date.parse(m.prevu) - t0() <= reglages.avanceH * 3_600_000 : true;
      if (!manuel && (m.resultat || m.equipes.length < 2 || !avance)) continue;
      if (manuel && !m.equipes.length) continue;
      if (creations >= LIMITES_SALONS.creationsParPassage) {
        bilan.attente++;
        continue;
      }
      const salons = await lireSalons();
      if (parentId && salons.filter(s => String(s.parent_id ?? '') === parentId).length >= LIMITES_SALONS.salonsParCategorie && !salons.some(s => String(s.topic ?? '').includes(`${MARQUEUR}${m.cle}`))) {
        bilan.erreur = 'categorie-pleine';
        await alerter(evt, 'categorie-pleine', { match: m.cle, parMatch: false });
        bilan.attente++;
        continue;
      }
      if (!ligne) {
        // Réservation : la clé unique (événement, match) empêche deux salons pour un même match.
        await base.executer("INSERT INTO club_salons_match (id, evenement_id, site_match_id, genre, titre, statut, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, 'creation', ?, ?) ON CONFLICT (evenement_id, site_match_id) DO NOTHING", [nouvelId(), evenementId, m.cle, m.genre, titreDe(m, langues(mode)[0]), iso(t0()), iso(t0())]);
        ligne = await base.premier('SELECT * FROM club_salons_match WHERE evenement_id = ? AND site_match_id = ?', [evenementId, m.cle]);
        if (!ligne || ligne.statut !== 'creation' || ligne.salon_id) continue;
      }
      creations++;
      if (await creerSalon({ evt, reglages, ligne, m, equipes, d, mode, compteur, salonsServeur: salons, parentId })) bilan.crees++;
    }
    if (ancre && !compteur.limite) bilan.places = await placerSousAncre(evenementId, ancre, salonsServeur ?? [], d, compteur);
    if (reglages.ancreId) await signalerAncre(evt, reglages, !ancre, mode, compteur);
    // Matchs disparus du site : avis, suppression programmée.
    for (const l of lignes.values()) {
      if (vus.has(l.site_match_id)) continue;
      if (compteur.limite || compteur.n >= LIMITES_SALONS.actionsParPassage) break;
      if (l.statut === 'creation' && !l.salon_id) {
        await base.executer('DELETE FROM club_salons_match WHERE id = ?', [l.id]);
        continue;
      }
      if (l.statut !== 'ouvert' && l.statut !== 'termine') continue;
      if (l.statut === 'termine' && l.suppression_le) continue; // déjà terminé : la suppression est programmée
      const suppression = t0() + delaiDe(reglages);
      const r = await poster(l, { content: `${tx(mode, 'annule')}\n${tx(mode, 'suppression', { quand: quand(suppression) })}`.slice(0, 2000), allowed_mentions: { parse: [] } }, compteur);
      if (l.statut === 'supprime') continue;
      if (!r.ok && compteur.limite) break;
      await maj(l.id, { statut: 'annule', suppression_le: iso(suppression) });
      bilan.annules++;
    }
    bilan.limite = compteur.limite;
    return bilan;
  }

  // Une synchronisation à la fois par événement dans ce processus, et un bail en base entre processus.
  const enCours = new Map();
  function synchroniser(evenementId, options = {}) {
    if (enCours.has(evenementId)) return enCours.get(evenementId);
    const p = (async () => {
      if (!(await prendreBail(evenementId))) return { occupe: true };
      try {
        const bilan = await synchroniserSousBail(evenementId, options);
        if (bilan) await ecrireEtat(evenementId, bilan);
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

  /** Cron (5 min) : événements actifs liés, suppressions dues, fin d'événement, rétention des historiques. */
  async function tacheCron({ rapide = false } = {}) {
    if (!jetonBot) return { evenements: 0 };
    const t = t0();
    const liste = await base.tous("SELECT id, statut, debut, fin, suppression_h, salons_match, site_tournoi_id FROM club_evenements WHERE salons_match IS NOT NULL OR id IN (SELECT DISTINCT evenement_id FROM club_salons_match WHERE statut <> 'supprime')", []);
    let n = 0;
    for (const e of liste) {
      const r = lireReglages(e.salons_match);
      const ouverts = await base.premier("SELECT COUNT(*) AS n FROM club_salons_match WHERE evenement_id = ? AND statut <> 'supprime' AND salon_id IS NOT NULL", [e.id]);
      if (finiEvt(e, t)) {
        if (Number(ouverts?.n ?? 0) > 0) await fermerEvenement(e.id);
        continue;
      }
      const dues = await base.premier("SELECT COUNT(*) AS n FROM club_salons_match WHERE evenement_id = ? AND statut IN ('termine', 'annule') AND suppression_le IS NOT NULL AND suppression_le <= ?", [e.id, iso(t)]);
      const actif = r.actif && e.site_tournoi_id;
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
    }
    return { evenements: n };
  }

  // Passage rapide (meneur de la Gateway) : au plus une fois par minute.
  let dernierRapide = 0;
  async function tacheRapide() {
    const t = t0();
    if (t - dernierRapide < 60_000) return null;
    dernierRapide = t;
    return tacheCron({ rapide: true });
  }

  // ---------------------------------------------------------------- Routes (droits : ceux de l'événement)

  const publique = (l, guildId) => ({
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
      salons: lignes.map(l => publique(l, d.guildId)),
      matchs,
      etat: await lireEtat(id),
    };
  }

  async function enregistrer(ev, acteur, id, corps) {
    await ev.exiger(acteur);
    const evt = await evenementOu404(id);
    const r = validerReglages(corps, lireReglages(evt.salons_match));
    await base.executer('UPDATE club_evenements SET salons_match = ?, maj_le = ? WHERE id = ?', [JSON.stringify(r), iso(t0()), id]);
    if (r.actif && evt.site_tournoi_id) await synchroniser(id).catch(e => journal.error?.('[esport] salons de match', e?.message ?? e));
    return vue(ev, acteur, id);
  }

  async function synchroniserMaintenant(ev, acteur, id) {
    await ev.exiger(acteur);
    const evt = await evenementOu404(id);
    if (!evt.site_tournoi_id) throw echec(400, 'site-non-lie', 'Choisissez d’abord le tournoi du site.');
    const b = await synchroniser(id);
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
    const b = await synchroniser(id, { forcer: cle });
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

  return { synchroniser, fermerEvenement, tacheCron, tacheRapide, vue, enregistrer, synchroniserMaintenant, creerMaintenant, supprimerMaintenant, historique };
}

/**
 * Routes (dans routesEvenements) :
 *   GET|PUT   /evenements/:id/salons-match                       vue ; réglages
 *   POST      /evenements/:id/salons-match/synchro               synchroniser maintenant
 *   POST      /evenements/:id/salons-match/creer                 { cle } créer maintenant
 *   POST      /evenements/:id/salons-match/:s/supprimer          supprimer maintenant (historique gardé)
 *   GET       /evenements/:id/salons-match/:s/historique         historique (staff de l'événement, evenements.gerer)
 */
export async function routesSalonsMatch({ sm, ev, acteur, id, p, m, lireCorps, limite }) {
  const [, , x, y] = p;
  if (p.length === 2 && m === 'GET') return sm.vue(ev, acteur, id);
  if (p.length === 2 && m === 'PUT') return sm.enregistrer(ev, acteur, id, await lireCorps());
  if (p.length === 3 && x === 'synchro' && m === 'POST') {
    await limite('tickets_discord', acteur.compte);
    return sm.synchroniserMaintenant(ev, acteur, id);
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
