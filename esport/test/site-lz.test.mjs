/**
 * Site LigneZero (Tickets › Configuration › Site LZ) : lecture de la clé du site sur l'hébergement, rôles et salons
 * Discord des équipes (création, membres, renommage, nettoyage), inscriptions par ticket validées vers le site.
 * Faux site et faux Discord : jamais de réseau réel.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseMigree } from './base.mjs';
import { cibleDiscord, configSite, lireLignesJoueurs, noterInscription, servicesSiteLz, synchroniserDiscord } from '../noyau/tickets/siteLz.mjs';
import { instructionReglage } from '../noyau/tickets/reglages.mjs';
import { TABLES } from '../noyau/transfert.mjs';

const GUILD = '700000000000000001';
const BOT = '424242424242424242';
const T1 = '11111111-1111-4111-8111-111111111111';
const CAT = '22222222-2222-4222-8222-222222222222';

function fauxSite() {
  const tables = {
    tournaments: [{ id: T1, slug: 'nuke', name: 'The Nuke End', status: 'registration', created_at: '2026-11-01' }],
    tournament_teams: [{ id: 'e1', tournament_id: T1, name: 'Alpha', tag: 'ALP', color: '#ff0000', status: 'registered', disqualified: false, seed: 1 }],
    tournament_players: [
      { id: 'p1', team_id: 'e1', pseudo: 'Un', discord_id: '810000000000000001', sort_order: 0 },
      { id: 'p2', team_id: 'e1', pseudo: 'Deux', discord_id: '810000000000000099', sort_order: 1 },
    ],
    players: [{ id: 'r1', game_id: 'the-finals', pseudo: 'Star', discord_id: '810000000000000005', sort_order: 0 }],
    games: [{ id: 'the-finals', name: 'The Finals', sort_order: 0 }],
  };
  let n = 0;
  return {
    tables,
    lister: async t => structuredClone(tables[t]),
    inserer: async (t, rows) => rows.map(r => (tables[t].push({ id: `n${++n}`, ...r }), tables[t].at(-1))),
    modifier: async (t, id, v) => Object.assign(tables[t].find(x => x.id === id), Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined))),
    supprimer: async (t, id) => (tables[t] = tables[t].filter(x => x.id !== id)),
  };
}

function fauxDiscord() {
  const appels = [];
  let n = 0;
  const fetch = async (url, init = {}) => {
    const chemin = new URL(url).pathname.replace(/^\/api\/v10/, '');
    const m = init.method ?? 'GET';
    appels.push({ m, chemin, corps: init.body ? JSON.parse(init.body) : null });
    const rep = (c, s = 200) => new Response(c === undefined ? null : JSON.stringify(c), { status: s, headers: { 'Content-Type': 'application/json' } });
    if (chemin === '/users/@me') return rep({ id: BOT });
    if (m === 'POST') return rep({ id: `9${String(++n).padStart(17, '0')}` }, 201);
    if (m === 'PUT' && chemin.includes('810000000000000099')) return rep({ code: 10007 }, 404); // pas sur le serveur
    return rep(undefined, 204);
  };
  return { fetch, appels };
}

async function preparer() {
  const b = await baseMigree();
  for (const [cle, v] of [['general', { guildId: GUILD }], ['site_lz', { discordActif: true, rosterActif: true, inscriptions: [{ categorieId: CAT, tournoiId: T1 }] }]]) {
    const i = instructionReglage(cle, v, null, Date.now());
    await b.executer(i.sql, i.params);
  }
  return b;
}

test('clé du site lue dans ~/.lignezero/api.env (même hébergement), variables prioritaires', () => {
  const lire = () => 'URL_SITE=https://lz.example\nCLE_SERVICE="cle-secrete"\n';
  assert.deepEqual(configSite({}, lire), { url: 'https://lz.example/api', cle: 'cle-secrete' });
  assert.deepEqual(configSite({ LZ_CLE: 'x', LZ_API_URL: 'https://autre/api/' }, lire), { url: 'https://autre/api', cle: 'x' });
  assert.equal(configSite({}, () => { throw new Error('absent'); }).cle, '');
});

test('lignes des joueurs du formulaire : Discord ID — Embark ID', () => {
  assert.deepEqual(lireLignesJoueurs('810000000000000001 — Nova#1234\n<@810000000000000002> - Kai#0001\nSolo#4321'), [
    { pseudo: 'Nova', discordId: '810000000000000001', embarkId: 'Nova#1234' },
    { pseudo: 'Kai', discordId: '810000000000000002', embarkId: 'Kai#0001' },
    { pseudo: 'Solo', discordId: null, embarkId: 'Solo#4321' },
  ]);
});

test('Discord : rôle + salons par équipe et pour le roster, membres, renommage puis nettoyage', async () => {
  const base = await preparer();
  const site = fauxSite();
  const d = fauxDiscord();
  const bilan = await synchroniserDiscord({ base, site, fetch: d.fetch, jetonBot: 'faux', journal: { error() {} } });
  assert.equal(bilan.membres, 2, 'joueur présent + joueur du roster');
  assert.equal(bilan.absents, 1, 'joueur pas encore sur le serveur');
  const roles = d.appels.filter(a => a.m === 'POST' && a.chemin === `/guilds/${GUILD}/roles`).map(a => a.corps.name);
  assert.deepEqual(roles, ['ALP · Alpha', 'LZ · The Finals']);
  const salons = d.appels.filter(a => a.m === 'POST' && a.chemin === `/guilds/${GUILD}/channels`);
  assert.deepEqual(salons.map(a => [a.corps.type, a.corps.name]), [[4, '🏆 The Nuke End'], [4, '🎮 Roster LZ'], [0, 'alp'], [2, 'ALP · Alpha'], [0, 'lz-the-finals'], [2, 'LZ · The Finals']]);
  // Salons privés : @everyone ne voit pas, le rôle de l'équipe et le bot oui.
  const texte = salons[2].corps.permission_overwrites;
  assert.equal(texte[0].id, GUILD);
  assert.ok(texte.some(o => o.type === 1 && o.id === BOT));
  // Deuxième passage : rien de nouveau ; l'absent est réessayé.
  d.appels.length = 0;
  await synchroniserDiscord({ base, site, fetch: d.fetch, jetonBot: 'faux', journal: { error() {} } });
  assert.ok(!d.appels.some(a => a.m === 'POST'), 'aucune création en double');
  assert.equal(d.appels.filter(a => a.m === 'PUT').length, 1);
  // Équipe renommée, joueur retiré : renommage et rôle retiré.
  site.tables.tournament_teams[0].name = 'Alpha Squad';
  site.tables.tournament_players = site.tables.tournament_players.filter(p => p.id !== 'p1');
  d.appels.length = 0;
  await synchroniserDiscord({ base, site, fetch: d.fetch, jetonBot: 'faux', journal: { error() {} } });
  assert.ok(d.appels.some(a => a.m === 'PATCH' && a.corps?.name === 'ALP · Alpha Squad'));
  assert.ok(d.appels.some(a => a.m === 'DELETE' && a.chemin.endsWith('/members/810000000000000001/roles/900000000000000003')));
  // Tournoi terminé : tout ce qui le concerne est supprimé ; le roster reste.
  site.tables.tournaments[0].status = 'finished';
  d.appels.length = 0;
  const fin = await synchroniserDiscord({ base, site, fetch: d.fetch, jetonBot: 'faux', journal: { error() {} } });
  assert.equal(fin.supprimes, 2);
  assert.equal(d.appels.filter(a => a.m === 'DELETE' && a.chemin.startsWith('/channels/')).length, 3, 'texte, vocal, catégorie');
  assert.deepEqual((await base.tous('SELECT cle FROM lz_discord ORDER BY cle', [])).map(l => l.cle), ['roster', 'roster:the-finals']);
  // Désactivé : rien n'est fait.
  const i = instructionReglage('site_lz', { discordActif: false }, null, Date.now());
  await base.executer(i.sql, i.params);
  assert.equal((await synchroniserDiscord({ base, site, fetch: d.fetch, jetonBot: 'faux' })).motif, 'inactif');
});

test('inscription par ticket : notée en attente, validée → équipe et joueurs créés sur le site, message dans le ticket', async () => {
  const base = await preparer();
  const site = fauxSite();
  const ticket = { id: 'tk1', numero: 7, categorie_id: CAT, auteur_discord_id: '810000000000000001', auteur_nom: 'Nova' };
  const reponses = [
    { id: 'equipe', valeur: 'Les Bombes' },
    { id: 'tag', valeur: 'BMB' },
    { id: 'joueurs', valeur: '810000000000000001 — Nova#1234\n810000000000000002 — Kai#0001\n810000000000000003 — Zed#0002' },
    { id: 'coach', valeur: '' },
    { id: 'remplacants', valeur: '810000000000000004 — Sub#0003' },
  ];
  const id = await noterInscription(base, ticket, reponses);
  assert.ok(id);
  assert.equal(await noterInscription(base, { ...ticket, categorie_id: '33333333-3333-4333-8333-333333333333' }, reponses), null, 'catégorie non liée');
  const messages = [];
  const s = servicesSiteLz({ base, site, contexteTickets: async () => ({}), envoyerDansTicket: async (t, x) => messages.push([t, x]) });
  const v = await s.vue({ compte: 'c1' });
  assert.equal(v.inscriptions.length, 1);
  assert.equal(v.inscriptions[0].donnees.joueurs.length, 3);
  await s.traiterInscription({ compte: 'c1' }, id, 'valider');
  const equipe = site.tables.tournament_teams.find(e => e.name === 'Les Bombes');
  assert.equal(equipe.tournament_id, T1);
  assert.equal(equipe.tag, 'BMB');
  const joueurs = site.tables.tournament_players.filter(p => p.team_id === equipe.id);
  assert.deepEqual(joueurs.map(j => [j.pseudo, j.discord_id, j.role, j.is_captain]), [
    ['Nova', '810000000000000001', null, true],
    ['Kai', '810000000000000002', null, false],
    ['Zed', '810000000000000003', null, false],
    ['Sub', '810000000000000004', 'Remplaçant', false],
  ]);
  assert.equal(messages[0][0], 'tk1');
  await assert.rejects(() => s.traiterInscription({ compte: 'c1' }, id, 'valider'), /déjà traitée/);
  // Modification depuis l'app : Discord ID vérifié.
  await assert.rejects(() => s.modifier({}, { type: 'joueur', id: joueurs[1].id, discordId: 'abc' }), /Discord ID/);
  await s.modifier({}, { type: 'joueur', id: joueurs[1].id, discordId: '<@810000000000000042>' });
  assert.equal(site.tables.tournament_players.find(p => p.id === joueurs[1].id).discord_id, '810000000000000042');
  assert.ok(TABLES.some(([t]) => t === 'lz_inscriptions') && TABLES.some(([t]) => t === 'lz_discord'));
});

test('cible Discord : équipes disqualifiées et tournois fermés ignorés', () => {
  const c = cibleDiscord({ tournois: [{ id: 't', nom: 'X', ouvert: true, equipes: [{ id: 'a', nom: 'A', joueurs: [], disqualifiee: true }] }, { id: 'u', nom: 'Y', ouvert: false, equipes: [{ id: 'b', nom: 'B', joueurs: [] }] }], roster: [] }, { rosterActif: false });
  assert.deepEqual(c.groupes, []);
  assert.equal(c.categories.length, 1);
});
