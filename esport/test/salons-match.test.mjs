/**
 * Salons de match Discord des événements liés à un tournoi du site LigneZero (evenements-club/salons-match.mjs,
 * migration 0073) : réglages, création (salon privé, accès des rôles des équipes — lobby à 3 équipes —, du staff et du
 * bot), embed et mentions, équipe sans rôle signalée au staff, mise à jour (embed modifié + « Mise à jour »), rappels
 * une seule fois, résultat puis suppression après le délai avec historique enregistré, match supprimé du site, aucun
 * doublon (passages simultanés, redémarrage, salon déjà créé retrouvé), suppression manuelle, historique réservé,
 * fin et suppression de l'événement, cron et passage rapide, export et effacement RGPD. Faux site et faux Discord : jamais de réseau réel.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc } from './aide.mjs';
import { bancTickets, fauxDiscordRest, fauxGateway } from './tickets-aide.mjs';
import { baseMigree } from './base.mjs';
import { creerSuperviseurTickets } from '../noyau/tickets/superviseur.mjs';
import { tachesPlanifiees } from '../noyau/cron.mjs';
import { DROITS_EQUIPE, DROITS_STAFF, creerSalonsMatch, lireReglages, nomSalon, validerReglages } from '../noyau/evenements-club/salons-match.mjs';
import { oublierLimites } from '../noyau/tickets/discord.mjs';
import { TABLES } from '../noyau/transfert.mjs';
import { effacementParDiscord } from '../noyau/tickets/rgpd.mjs';

const T1 = '11111111-1111-4111-8111-111111111111';
const EA = '22222222-2222-4222-8222-00000000000a';
const EB = '22222222-2222-4222-8222-00000000000b';
const EC = '22222222-2222-4222-8222-00000000000c';
const ED = '22222222-2222-4222-8222-00000000000d';
const M1 = '44444444-4444-4444-8444-000000000001';
const L1 = '55555555-5555-4555-8555-000000000001';
const CAT = '710000000000000099';
const CAP_A = '810000000000000201';
const J_A = '810000000000000202';
const CAP_B = '810000000000000203';
const CAP_C = '810000000000000204';
const STAFF = '810000000000000299';
const SILENCE = { error() {}, warn() {}, log() {} };

function fauxSite() {
  const tables = {
    tournaments: [{ id: T1, name: 'The Nuke End', status: 'running', created_at: '2026-11-02' }],
    tournament_teams: [
      { id: EA, tournament_id: T1, name: 'Alpha', tag: 'ALP' },
      { id: EB, tournament_id: T1, name: 'Bravo', tag: 'BRV' },
      { id: EC, tournament_id: T1, name: 'Charlie', tag: 'CHA' },
    ],
    tournament_players: [
      { id: 'p1', team_id: EA, pseudo: 'CapA', role: null, is_captain: true, discord_id: CAP_A, embark_id: null, sort_order: 0 },
      { id: 'p2', team_id: EA, pseudo: 'Joueur', role: null, is_captain: false, discord_id: J_A, embark_id: null, sort_order: 1 },
      { id: 'p3', team_id: EB, pseudo: 'CapB', role: null, is_captain: true, discord_id: CAP_B, embark_id: null, sort_order: 0 },
      { id: 'p4', team_id: EC, pseudo: 'CapC', role: null, is_captain: true, discord_id: CAP_C, embark_id: null, sort_order: 0 },
    ],
    tournament_stages: [],
    tournament_matches: [{ id: M1, tournament_id: T1, stage_id: null, bracket: 'winner', round: 1, position: 1, group_label: null, team_a_id: EA, team_b_id: EB, score_a: null, score_b: null, winner_id: null, status: 'pending', scheduled_at: '2026-10-20T12:00:00.000Z', stream_url: null }],
    tournament_lobbies: [{ id: L1, tournament_id: T1, round: 1, position: 1, label: null, status: 'pending', scheduled_at: '2026-10-20T14:00:00.000Z', stream_url: null }],
    tournament_lobby_entries: [
      { id: 'e1', lobby_id: L1, team_id: EA, placement: null, points: 0, dnf: false, sort_order: 0 },
      { id: 'e2', lobby_id: L1, team_id: EB, placement: null, points: 0, dnf: false, sort_order: 1 },
      { id: 'e3', lobby_id: L1, team_id: EC, placement: null, points: 0, dnf: false, sort_order: 2 },
    ],
  };
  let n = 0;
  const filtre = filters => r => filters.every(f => (f.op === 'in' ? f.val.includes(r[f.col]) : r[f.col] === f.val));
  return {
    tables,
    configure: true,
    lectures: [],
    async lister(t, filters = []) {
      this.lectures.push(t);
      return structuredClone((tables[t] ?? []).filter(filtre(filters)));
    },
    inserer: async (t, rows) => rows.map(r => (tables[t].push({ id: `33333333-3333-4333-8333-${String(++n).padStart(12, '0')}`, ...r }), structuredClone(tables[t].at(-1)))),
    modifier: async (t, id, v) => [Object.assign(tables[t].find(x => x.id === id), v)],
    supprimer: async (t, id) => {
      tables[t] = tables[t].filter(x => x.id !== id);
    },
    supprimerOu: async (t, col, val) => {
      tables[t] = tables[t].filter(x => x[col] !== val);
    },
  };
}

async function monter() {
  oublierLimites();
  const site = fauxSite();
  const k = await bancTickets({ banc, siteLz: site });
  k.discord.etat.salons.set(CAT, { id: CAT, type: 4, name: 'Matchs', guild_id: k.GUILD, permission_overwrites: [], position: 5 });
  await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { guildId: k.GUILD, guildNom: 'Club', langue: 'fr' } });
  const e = await k.api('/evenements', undefined, { methode: 'POST', corps: { nom: 'The Nuke End', debut: '2026-10-20', fin: '2026-10-21' } });
  assert.equal(e.statut, 200, JSON.stringify(e.corps));
  const id = e.corps.evenement.id;
  const chemin = `/evenements/${id}`;
  // Lien au tournoi : les équipes du site sont reprises dans l'événement (rôles Discord créés automatiquement).
  const lie = await k.api(`${chemin}/site`, undefined, { methode: 'PUT', corps: { tournoiId: T1 } });
  assert.equal(lie.statut, 200, JSON.stringify(lie.corps));
  const st = await k.api(`${chemin}/staff`, undefined, { methode: 'POST', corps: { discordId: STAFF, nom: 'Arbitre' } });
  assert.equal(st.statut, 200, JSON.stringify(st.corps));
  const fiche = (await k.api(chemin)).corps;
  const roles = Object.fromEntries(fiche.equipes.map(x => [x.tag, x.roleId]));
  assert.ok(roles.ALP && roles.BRV && roles.CHA, JSON.stringify(roles));
  const r = { ...k, site, id, chemin, sm: `${chemin}/salons-match`, roles, staffRole: fiche.evenement.discord.staffRoleId, jeton: k.fondateur };
  // Session du Fondateur rouverte après un saut d'horloge (les sessions expirent).
  r.api = async (c, jeton, options = {}) => {
    if (!jeton) r.jeton = await k.b.session('principal');
    return k.b.appel(c, { jeton: jeton ?? r.jeton, ...options });
  };
  return r;
}

const salonsCrees = k => k.discord.appels.filter(a => a.methode === 'POST' && a.chemin === `/guilds/${k.GUILD}/channels`);
const messagesDe = (k, salonId) => k.discord.etat.messages.get(salonId) ?? [];
const lignes = async k => k.b.base.tous('SELECT * FROM club_salons_match WHERE evenement_id = ? ORDER BY cree_le, site_match_id', [k.id]);
const synchro = async k => {
  const r = await k.api(`${k.sm}/synchro`, undefined, { methode: 'POST', corps: {} });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  return r.corps;
};
const activer = async (k, extra = {}) => {
  const r = await k.api(k.sm, undefined, { methode: 'PUT', corps: { actif: true, categorieId: CAT, ...extra } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  return r.corps;
};

test('réglages : défauts, bornes, nom de salon nettoyé', () => {
  assert.deepEqual(lireReglages(null).delaiSuppressionMin, 30);
  assert.equal(lireReglages('{"delaiSuppressionMin":99999}').delaiSuppressionMin, 1440);
  assert.throws(() => validerReglages({ delaiSuppressionMin: 4 }), e => e.code === 'salons-match-delai');
  assert.throws(() => validerReglages({ delaiSuppressionMin: 1441 }), e => e.code === 'salons-match-delai');
  assert.throws(() => validerReglages({ actif: true }), e => e.code === 'salons-match-categorie');
  assert.throws(() => validerReglages({ langue: 'de' }), e => e.code === 'salons-match-langue');
  assert.equal(validerReglages({ actif: true, categorieId: CAT, delaiSuppressionMin: 5 }).delaiSuppressionMin, 5);
  assert.equal(nomSalon('{round}-{equipes}', { round: 'r1', equipes: 'ALP-vs-BRV' }), 'r1-alp-vs-brv');
  assert.equal(nomSalon('{phase} {match} : Été !!', { phase: 'Poule A', match: 'm2' }), 'poule-a-m2-ete');
  assert.equal(nomSalon('@everyone', {}), 'everyone');
  assert.equal(nomSalon('???', {}), 'match');
  assert.ok(nomSalon('x'.repeat(300), {}).length <= 100);
});

test('création : salon privé par match (lobby à 3 équipes compris), accès, embed, mentions ; aucun doublon', async () => {
  const k = await monter();
  const v = await activer(k);
  assert.ok(v.categories.some(c => c.id === CAT && c.nom === 'Matchs'));
  assert.equal(salonsCrees(k).length, 2, 'un salon pour le match, un pour le lobby');
  const [lm, ll] = [...(await lignes(k))].sort((a, b) => a.site_match_id.localeCompare(b.site_match_id)).reverse();
  assert.equal(lm.site_match_id, `m:${M1}`);
  assert.equal(ll.site_match_id, `l:${L1}`);
  assert.equal(lm.statut, 'ouvert');
  const salonM = k.discord.etat.salons.get(lm.salon_id);
  const salonL = k.discord.etat.salons.get(ll.salon_id);
  assert.equal(salonM.type, 0);
  assert.equal(salonM.parent_id, CAT);
  assert.equal(salonM.name, 'r1-alp-vs-brv');
  assert.equal(salonL.name, 'r1-alp-brv-cha');
  // Accès : @everyone refusé, chaque rôle d'équipe du match, rôle staff (gérer les messages en plus), bot.
  const o = id => salonL.permission_overwrites.find(x => x.id === id);
  assert.equal(o(k.GUILD).deny, String(1n << 10n));
  for (const tag of ['ALP', 'BRV', 'CHA']) assert.equal(o(k.roles[tag]).allow, DROITS_EQUIPE, tag);
  assert.equal(o(k.staffRole).allow, DROITS_STAFF);
  assert.equal(o(k.APP).type, 1);
  assert.equal(salonM.permission_overwrites.find(x => x.id === k.roles.CHA), undefined, 'Charlie ne joue pas le match 1v1');
  // Message : mentions des rôles et des capitaines, embed avec horaire Discord (absolu et relatif), joueurs mentionnés.
  const [accueil] = messagesDe(k, lm.salon_id);
  assert.match(accueil.content, new RegExp(`<@&${k.roles.ALP}>`));
  assert.match(accueil.content, new RegExp(`<@${CAP_A}>`));
  assert.deepEqual(accueil.allowed_mentions.users.sort(), [CAP_A, CAP_B].sort());
  const ts = Date.parse('2026-10-20T12:00:00.000Z') / 1000;
  assert.match(accueil.embeds[0].description, new RegExp(`<t:${ts}:F> \\(<t:${ts}:R>\\)`));
  assert.ok(accueil.embeds[0].fields.some(f => f.name === '[ALP] Alpha' && f.value.includes(`<@${J_A}>`) && f.value.includes('(capitaine)')));
  assert.equal(lm.message_id, accueil.id);
  // Nouveaux passages : rien de plus.
  await synchro(k);
  await synchro(k);
  assert.equal(salonsCrees(k).length, 2);
  // Deux processus en même temps (deux services sur la même base) : toujours un seul salon par match.
  k.site.tables.tournament_matches.push({ ...k.site.tables.tournament_matches[0], id: '44444444-4444-4444-8444-000000000002', position: 2, scheduled_at: null });
  const deux = [1, 2].map(() => creerSalonsMatch({ base: k.b.base, site: k.site, fetch: k.discord.fetch, jetonBot: 'jeton-bot-de-test-jamais-reel', botId: k.APP, maintenant: () => k.b.horloge.t, journal: SILENCE }));
  await Promise.all([deux[0].synchroniser(k.id), deux[1].synchroniser(k.id)]);
  await deux[1].synchroniser(k.id);
  assert.equal(salonsCrees(k).length, 3);
  assert.equal((await lignes(k)).length, 3);
  // Liste dans l'app.
  const vue = (await k.api(k.sm)).corps;
  assert.equal(vue.salons.length, 3);
  assert.ok(vue.salons.every(s => s.lien?.startsWith(`https://discord.com/channels/${k.GUILD}/`)));
  assert.equal(vue.matchs.length, 0);
});

test('salon déjà créé par un passage interrompu : retrouvé par son sujet, pas recréé', async () => {
  const k = await monter();
  await k.api(k.sm, undefined, { methode: 'PUT', corps: { actif: false, categorieId: CAT } });
  // Processus arrêté net : la ligne est réservée, le salon existe sur Discord, l'identifiant n'a pas été noté.
  await k.b.base.executer("INSERT INTO club_salons_match (id, evenement_id, site_match_id, genre, titre, statut, cree_le, maj_le) VALUES ('orphelin-1', ?, ?, 'match', '', 'creation', '2026-10-20T10:00:00.000Z', '2026-10-20T10:00:00.000Z')", [k.id, `m:${M1}`]);
  k.discord.etat.salons.set('730000000000000001', { id: '730000000000000001', type: 0, name: 'r1-alp-vs-brv', parent_id: CAT, topic: `Round 1 · esport-hq:match:m:${M1} · ${k.id.slice(0, 8)}`, permission_overwrites: [] });
  await activer(k);
  const l = (await lignes(k)).find(x => x.site_match_id === `m:${M1}`);
  assert.equal(l.salon_id, '730000000000000001');
  assert.equal(salonsCrees(k).length, 1, 'seul le lobby est créé');
});

test('équipe sans rôle Discord : signalée dans l’embed, staff averti une fois', async () => {
  const k = await monter();
  await k.api(k.sm, undefined, { methode: 'PUT', corps: { actif: false, categorieId: CAT } });
  // Équipe ajoutée sur le site après le lien (pas encore dans l'événement) : aucun rôle.
  k.site.tables.tournament_teams.push({ id: ED, tournament_id: T1, name: 'Delta', tag: 'DLT' });
  k.site.tables.tournament_lobby_entries.push({ id: 'e4', lobby_id: L1, team_id: ED, placement: null, points: 0, dnf: false, sort_order: 3 });
  await activer(k);
  const ll = (await lignes(k)).find(x => x.site_match_id === `l:${L1}`);
  const msgs = messagesDe(k, ll.salon_id);
  assert.ok(msgs[0].embeds[0].fields.some(f => f.name === '[DLT] Delta' && /pas de rôle Discord/.test(f.value)));
  const alerte = msgs.find(m => /Attention staff/.test(m.content ?? ''));
  assert.ok(alerte, 'staff averti');
  assert.match(alerte.content, new RegExp(`<@&${k.staffRole}>`));
  assert.match(alerte.content, /\[DLT\] Delta/);
  await synchro(k);
  assert.equal(messagesDe(k, ll.salon_id).filter(m => /Attention staff/.test(m.content ?? '')).length, 1);
  // Les équipes reliées ont accès, Delta non (pas de rôle).
  assert.equal(k.discord.etat.salons.get(ll.salon_id).permission_overwrites.filter(o => o.allow === DROITS_EQUIPE).length, 3);
});

test('mise à jour : horaire et équipes changés → embed modifié, accès suivis, « Mise à jour » ; rappels une seule fois', async () => {
  const k = await monter();
  await activer(k);
  const lm = (await lignes(k)).find(x => x.site_match_id === `m:${M1}`);
  const avant = messagesDe(k, lm.salon_id).length;
  // Horaire avancé à 12h30, et Charlie remplace Bravo.
  Object.assign(k.site.tables.tournament_matches[0], { scheduled_at: '2026-10-20T12:30:00.000Z', team_b_id: EC });
  await synchro(k);
  const patch = k.discord.appels.filter(a => a.methode === 'PATCH' && a.chemin === `/channels/${lm.salon_id}/messages/${lm.message_id}`);
  assert.equal(patch.length, 1);
  assert.match(patch[0].corps.embeds[0].description, new RegExp(`<t:${Date.parse('2026-10-20T12:30:00.000Z') / 1000}:F>`));
  const msgs = messagesDe(k, lm.salon_id);
  assert.equal(msgs.length, avant + 1);
  assert.match(msgs.at(-1).content, /Mise à jour du match : horaire, équipes/);
  assert.match(msgs.at(-1).content, new RegExp(`<@${CAP_C}>`));
  const s = k.discord.etat.salons.get(lm.salon_id);
  assert.ok(s.permission_overwrites.some(o => o.id === k.roles.CHA));
  assert.ok(!s.permission_overwrites.some(o => o.id === k.roles.BRV), 'Bravo n’a plus accès');
  await synchro(k);
  assert.equal(messagesDe(k, lm.salon_id).length, avant + 1, 'rien de nouveau');

  // Rappels : 30 minutes avant (une fois), puis 10 minutes avant (une fois).
  const rappels = () => messagesDe(k, lm.salon_id).filter(m => /Rappel/.test(m.content ?? '')).length;
  k.b.horloge.t = Date.parse('2026-10-20T12:03:00.000Z');
  await synchro(k);
  assert.equal(rappels(), 1);
  await synchro(k);
  assert.equal(rappels(), 1);
  k.b.horloge.t = Date.parse('2026-10-20T12:21:00.000Z');
  await synchro(k);
  assert.equal(rappels(), 2);
  await synchro(k);
  k.b.horloge.t = Date.parse('2026-10-20T12:25:00.000Z');
  await synchro(k);
  assert.equal(rappels(), 2);
  assert.match(messagesDe(k, lm.salon_id).filter(m => /Rappel/.test(m.content)).at(-1).content, /<t:\d+:R>/);
});

test('résultat → posté, suppression après le délai avec historique ; match supprimé du site → avis puis suppression', async () => {
  const k = await monter();
  await activer(k, { delaiSuppressionMin: 30 });
  const lig = async cle => (await lignes(k)).find(x => x.site_match_id === cle);
  const m = await lig(`m:${M1}`);
  // Un joueur écrit avec une pièce jointe, le staff complète.
  k.discord.posterUtilisateur(m.salon_id, CAP_A, 'Prêts !', { attachments: [{ id: '1', filename: 'lineup.png', size: 2048, url: 'https://cdn.discordapp.com/attachments/1/2/lineup.png' }] });
  k.discord.posterUtilisateur(m.salon_id, STAFF, 'Lobby code : 1234');
  Object.assign(k.site.tables.tournament_matches[0], { status: 'finished', score_a: 2, score_b: 1, winner_id: EA });
  await synchro(k);
  let l = await lig(`m:${M1}`);
  assert.equal(l.statut, 'termine');
  assert.equal(l.suppression_le, new Date(k.b.horloge.t + 30 * 60_000).toISOString());
  const res = messagesDe(k, m.salon_id).at(-1);
  assert.match(res.content, /Résultat enregistré/);
  assert.match(res.content, /sera supprimé <t:\d+:R>/);
  assert.match(res.embeds[0].description, /\[ALP\] Alpha \*\*2\*\*/);
  assert.match(res.embeds[0].description, /Vainqueur : \[ALP\] Alpha/);
  await synchro(k);
  assert.equal(messagesDe(k, m.salon_id).filter(x => /Résultat/.test(x.content ?? '')).length, 1, 'posté une fois');
  // Avant le délai : rien ; après : historique enregistré, salon supprimé.
  k.b.horloge.t += 29 * 60_000;
  await synchro(k);
  assert.ok(k.discord.etat.salons.has(m.salon_id));
  k.b.horloge.t += 2 * 60_000;
  await synchro(k);
  assert.ok(!k.discord.etat.salons.has(m.salon_id), 'salon supprimé');
  l = await lig(`m:${M1}`);
  assert.equal(l.statut, 'supprime');
  const h = await k.api(`${k.sm}/${l.id}/historique`);
  assert.equal(h.statut, 200, JSON.stringify(h.corps));
  const contenus = h.corps.messages.map(x => x.contenu);
  assert.ok(contenus.includes('Prêts !') && contenus.includes('Lobby code : 1234'));
  const piece = h.corps.messages.find(x => x.contenu === 'Prêts !').pieces[0];
  assert.deepEqual(piece, { nom: 'lineup.png', url: 'https://cdn.discordapp.com/attachments/1/2/lineup.png', taille: 2048 });
  assert.ok(h.corps.messages.some(x => x.bot && x.embeds.length), 'messages du bot (embeds en texte)');
  assert.equal(h.corps.salon.nbMessages, h.corps.messages.length);
  // Jamais recréé automatiquement.
  await synchro(k);
  assert.equal(salonsCrees(k).length, 2);
  // Historique : réservé (ni evenements.gerer, ni staff de l'événement).
  const autre = await k.compteAvec('voir1234', 'Voir', ['tickets.voir']);
  assert.equal((await k.api(`${k.sm}/${l.id}/historique`, autre.jeton)).statut, 403);
  assert.equal((await k.api(k.sm, autre.jeton)).statut, 403);

  // Lobby supprimé du site (« Supprimer le déroulé ») : avis, suppression programmée, puis faite.
  const lo = await lig(`l:${L1}`);
  k.site.tables.tournament_lobbies = [];
  k.site.tables.tournament_lobby_entries = [];
  await synchro(k);
  const annule = await lig(`l:${L1}`);
  assert.equal(annule.statut, 'annule');
  assert.match(messagesDe(k, lo.salon_id).at(-1).content, /supprimé ou annulé sur le site/);
  k.b.horloge.t += 31 * 60_000;
  await synchro(k);
  assert.ok(!k.discord.etat.salons.has(lo.salon_id));
  assert.equal((await lig(`l:${L1}`)).statut, 'supprime');
});

test('site injoignable : rien n’est considéré comme supprimé', async () => {
  const k = await monter();
  await activer(k);
  const lister = k.site.lister;
  k.site.lister = async () => {
    throw new Error('Le site LigneZero ne répond pas.');
  };
  const v = await synchro(k);
  assert.match(v.etat.erreur, /site/);
  assert.ok((await lignes(k)).every(l => l.statut === 'ouvert'));
  k.site.lister = lister;
});

test('manuel : créer maintenant, supprimer maintenant (historique gardé), recréer ; fin et suppression de l’événement', async () => {
  const k = await monter();
  // Désactivé : rien n'est créé tout seul, la liste propose les matchs du site.
  const v = (await k.api(k.sm, undefined, { methode: 'PUT', corps: { actif: false, categorieId: CAT } })).corps;
  assert.equal(salonsCrees(k).length, 0);
  assert.deepEqual(v.matchs.map(x => x.cle).sort(), [`l:${L1}`, `m:${M1}`]);
  assert.equal(v.matchs.find(x => x.genre === 'lobby').equipes.length, 3);
  const c = await k.api(`${k.sm}/creer`, undefined, { methode: 'POST', corps: { cle: `m:${M1}` } });
  assert.equal(c.statut, 200, JSON.stringify(c.corps));
  assert.equal(salonsCrees(k).length, 1);
  assert.equal(c.corps.salons[0].statut, 'ouvert');
  assert.equal((await k.api(`${k.sm}/creer`, undefined, { methode: 'POST', corps: { cle: `m:${M1}` } })).statut, 409);
  assert.equal((await k.api(`${k.sm}/creer`, undefined, { methode: 'POST', corps: { cle: 'x' } })).statut, 400);
  const id = c.corps.salons[0].id;
  const salon = c.corps.salons[0].salonId;
  k.discord.posterUtilisateur(salon, CAP_B, 'gg');
  const s = await k.api(`${k.sm}/${id}/supprimer`, undefined, { methode: 'POST', corps: {} });
  assert.equal(s.statut, 200, JSON.stringify(s.corps));
  assert.ok(!k.discord.etat.salons.has(salon));
  assert.equal(s.corps.salons[0].statut, 'supprime');
  assert.equal(s.corps.salons[0].historique, true);
  // Recréer : nouvelle ligne, l'ancien historique reste consultable.
  const r = await k.api(`${k.sm}/creer`, undefined, { methode: 'POST', corps: { cle: `m:${M1}` } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.salons.length, 2);
  assert.ok((await k.api(`${k.sm}/${id}/historique`)).corps.messages.some(x => x.contenu === 'gg'));

  // Fin de l'événement : salons restants fermés (historique enregistré) par le nettoyage.
  const ouvert = r.corps.salons.find(x => x.statut === 'ouvert');
  await k.api(k.chemin, undefined, { methode: 'PATCH', corps: { statut: 'termine' } });
  await tachesPlanifiees(k.b.base, { jetonBot: 'jeton-bot-de-test-jamais-reel', fetch: k.discord.fetch, maintenant: () => k.b.horloge.t, siteLz: k.site, journal: SILENCE });
  assert.ok(!k.discord.etat.salons.has(ouvert.salonId));
  assert.equal((await lignes(k)).find(x => x.id === ouvert.id).statut, 'supprime');
  // Suppression de l'événement : lignes et historiques effacés avec lui.
  const del = await k.api(k.chemin, undefined, { methode: 'DELETE' });
  assert.equal(del.statut, 200, JSON.stringify(del.corps));
  assert.equal((await lignes(k)).length, 0);
});

test('suppression de l’événement : salons encore ouverts fermés avec historique avant l’effacement', async () => {
  const k = await monter();
  await activer(k);
  const salons = (await lignes(k)).map(l => l.salon_id);
  assert.equal(salons.length, 2);
  const del = await k.api(k.chemin, undefined, { methode: 'DELETE' });
  assert.equal(del.statut, 200, JSON.stringify(del.corps));
  assert.equal(del.corps.nettoyage.salonsMatch, 2);
  for (const s of salons) assert.ok(!k.discord.etat.salons.has(s));
});

test('cron et passage rapide du meneur (une fois par minute, événement en cours)', async () => {
  const k = await monter();
  await k.api(k.sm, undefined, { methode: 'PUT', corps: { actif: false, categorieId: CAT } });
  await k.b.base.executer('UPDATE club_evenements SET salons_match = ? WHERE id = ?', [JSON.stringify({ ...lireReglages(null), actif: true, categorieId: CAT }), k.id]);
  const rapport = await tachesPlanifiees(k.b.base, { jetonBot: 'jeton-bot-de-test-jamais-reel', fetch: k.discord.fetch, maintenant: () => k.b.horloge.t, siteLz: k.site, journal: SILENCE });
  assert.ok(rapport.find(x => x.tache === 'salons de match').ok);
  assert.equal(salonsCrees(k).length, 2);
  // Passage rapide : seulement les événements en cours (dates du jour), au plus une fois par minute.
  const sm = k.b.traiter.salonsMatch;
  k.site.lectures.length = 0;
  assert.deepEqual(await sm.tacheRapide(), { evenements: 1 });
  assert.equal(await sm.tacheRapide(), null);
  assert.ok(k.site.lectures.includes('tournament_matches'));
  k.b.horloge.t += 61_000;
  await k.b.base.executer("UPDATE club_evenements SET debut = '2026-12-01', fin = '2026-12-02' WHERE id = ?", [k.id]);
  assert.deepEqual(await sm.tacheRapide(), { evenements: 0 });
});

test('données : table exportée ; effacement RGPD d’une personne : historiques où elle a écrit effacés', async () => {
  assert.ok(TABLES.some(([n]) => n === 'club_salons_match'));
  const k = await monter();
  await activer(k);
  const [a, b] = await lignes(k);
  k.discord.posterUtilisateur(a.salon_id, CAP_A, 'message de CapA');
  k.discord.posterUtilisateur(b.salon_id, CAP_B, 'message de CapB');
  for (const l of [a, b]) assert.equal((await k.api(`${k.sm}/${l.id}/supprimer`, undefined, { methode: 'POST', corps: {} })).statut, 200);
  await k.b.base.lot(effacementParDiscord([CAP_A]));
  const apres = await lignes(k);
  assert.equal(apres.find(x => x.id === a.id).transcript, null);
  assert.match(apres.find(x => x.id === b.id).transcript, /message de CapB/);
});

test('meneur de la Gateway : passage rapide lancé sans attendre (le bail passe d’abord), un seul à la fois, attendu à l’arrêt', async () => {
  const base = await baseMigree();
  await base.executer('INSERT INTO tickets_reglages (cle, valeur, maj_le) VALUES (?, ?, ?)', ['general', JSON.stringify({ actif: true, guildId: '700000000000000001', categorieOuverts: '710000000000000010' }), new Date().toISOString()]);
  const gw = await fauxGateway({ intervalle: 1000 });
  const rest = fauxDiscordRest({ gateway: gw });
  let appels = 0;
  let liberer;
  const tachesMeneur = () => {
    appels++;
    return new Promise(ok => {
      liberer = ok;
    });
  };
  const sup = creerSuperviseurTickets({ base, jetonBot: 'jeton-bot-de-test-jamais-reel', fetch: rest.fetch, identifiant: 'p', intervalle: 1_000_000, gateway: { attenteMin: 20, attenteMax: 200, hasard: () => 0.5 }, tachesMeneur, journal: SILENCE });
  try {
    const r = await sup.passage();
    assert.equal(r.meneur, true, 'le passage n’attend pas le passage rapide');
    await sup.passage();
    assert.equal(appels, 1, 'un seul à la fois');
    liberer();
    await new Promise(ok => setTimeout(ok, 10));
    await sup.passage();
    assert.equal(appels, 2);
    liberer();
  } finally {
    await sup.arreter();
    await gw.arreter();
  }
});
