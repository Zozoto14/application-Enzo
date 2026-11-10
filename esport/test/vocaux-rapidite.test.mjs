/**
 * Salons vocaux : rapidité (docs/esport/vocaux.md, « Rapidité »). Chemin critique = POST du salon puis PATCH du
 * membre, rien avant ni entre ; panneau, journal, état après ; deux membres servis en parallèle ; le même membre
 * deux fois = un seul salon ; aucun GET quand le cache de la Gateway connaît le hub ; mesures notées pour l'app ;
 * connexion persistante (keep-alive) et gardée chaude ; limites de débit annoncées respectées. Faux Discord.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fauxDiscordRest } from './tickets-aide.mjs';
import { baseMigree } from './base.mjs';
import { creerMoteurVocaux, lireEtatVocaux } from '../noyau/vocaux/moteur.mjs';
import { lireSalon, PV } from '../noyau/vocaux/salons.mjs';
import { cleRoute, oublierLimites, rest } from '../noyau/tickets/discord.mjs';
import { agentDiscord, creerFetchDiscordNode } from '../adaptateurs/fetchDiscordNode.mjs';

const JETON = 'jeton-bot-de-test-jamais-reel';
const GUILD = '700000000000000001';
const BOT = '424242424242424242';
const CAT = '710000000000000050';
const HUB = '710000000000000051';
const JOURNAUX = '710000000000000013';
const U1 = '810000000000000001';
const U2 = '810000000000000002';
const silencieux = { error() {}, warn() {}, info() {} };
const pause = ms => new Promise(ok => setTimeout(ok, ms));

async function monter({ retard = () => 0, ...options } = {}) {
  const base = await baseMigree();
  const t = new Date().toISOString();
  await base.executer('INSERT INTO tickets_reglages (cle, valeur, maj_le) VALUES (?, ?, ?)', ['general', JSON.stringify({ actif: false, guildId: GUILD, langue: 'fr' }), t]);
  await base.executer('INSERT INTO tickets_reglages (cle, valeur, maj_le) VALUES (?, ?, ?)', ['vocaux', JSON.stringify({ actif: true, hubs: [{ id: HUB, modeleNom: 'Salon de {pseudo}' }], delaiSuppressionS: 5, maxParMembre: 1, salonJournaux: JOURNAUX }), t]);
  const faux = fauxDiscordRest();
  faux.etat.salons.set(CAT, { id: CAT, type: 4, name: 'Vocaux', guild_id: GUILD, position: 2, permission_overwrites: [] });
  faux.etat.salons.set(HUB, { id: HUB, type: 2, name: 'Créer', guild_id: GUILD, parent_id: CAT, position: 3, permission_overwrites: [{ id: '720000000000000077', type: 0, allow: String(PV.VOIR), deny: '0' }] });
  // Journal des appels avec début et fin (ordre ET recouvrement) ; `retard(methode, chemin, corps)` en ms.
  const journal = [];
  const fetch = async (url, init = {}) => {
    const chemin = new URL(String(url)).pathname.replace(/^\/api\/v10/, '');
    const corps = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    const e = { methode: init.method ?? 'GET', chemin, corps, debut: performance.now(), fin: null };
    journal.push(e);
    const ms = retard(e.methode, chemin, corps);
    if (ms) await pause(ms);
    const r = await faux.fetch(url, init);
    e.fin = performance.now();
    return r;
  };
  const moteur = creerMoteurVocaux({ base, fetch, jetonBot: JETON, botId: () => BOT, delaiMs: 60_000, journal: silencieux, ...options });
  await moteur.evenement('GUILD_CREATE', { id: GUILD, channels: [...faux.etat.salons.values()], voice_states: [], members: [] });
  journal.length = 0;
  return { base, faux, moteur, journal };
}

const vs = (userId, channelId, nom) => ({ guild_id: GUILD, user_id: userId, channel_id: channelId, member: { user: { id: userId, username: nom }, nick: nom, roles: [] } });
const estCreation = a => a.methode === 'POST' && a.chemin === `/guilds/${GUILD}/channels`;
const estDeplacement = (a, u) => a.methode === 'PATCH' && a.chemin === `/guilds/${GUILD}/members/${u}`;

test('chemin critique : POST du salon en 1er, déplacement en 2e ; panneau, journal et état après ; aucun GET (cache)', async () => {
  const k = await monter();
  await k.moteur.evenement('VOICE_STATE_UPDATE', vs(U1, HUB, 'Lea'));
  const j = k.journal;
  assert.ok(estCreation(j[0]), `1er appel : création (${j[0]?.methode} ${j[0]?.chemin})`);
  assert.ok(estDeplacement(j[1], U1), `2e appel : déplacement (${j[1]?.methode} ${j[1]?.chemin})`);
  assert.ok(!j.some(a => a.methode === 'GET'), 'hub et catégorie lus dans le cache de la Gateway');
  const salonId = j[1].corps.channel_id;
  const panneau = j.findIndex(a => a.chemin === `/channels/${salonId}/messages`);
  const journaux = j.findIndex(a => a.chemin === `/channels/${JOURNAUX}/messages`);
  assert.ok(panneau > 1 && journaux > 1, 'panneau et journal après le déplacement');
  assert.ok(j[panneau].debut >= j[1].fin && j[journaux].debut >= j[1].fin);
  const ligne = await lireSalon(k.base, salonId);
  assert.equal(ligne.proprietaireId, U1);
  assert.ok(ligne.panneauId, 'panneau noté (écriture ciblée)');
  const etat = await lireEtatVocaux(k.base);
  for (const c of ['totalMs', 'creationMs', 'deplacementMs', 'attenteMs', 'preparationMs']) assert.equal(typeof etat.derniereCreation[c], 'number', c);
  assert.equal(etat.derniereCreation.deplace, true);
  // L'arrivée du membre dans son salon : notée présente (la ligne écrite pendant le déplacement est attendue).
  await k.moteur.evenement('VOICE_STATE_UPDATE', vs(U1, salonId, 'Lea'));
  assert.deepEqual((await lireSalon(k.base, salonId)).occupants.map(o => o.id), [U1]);
  k.moteur.arreter();
});

test('panneau lent : le déplacement n’attend pas, et l’événement suivant (autre membre) non plus', async () => {
  const k = await monter({ retard: (m, c) => (m === 'POST' && /\/channels\/\d+\/messages$/.test(c) ? 300 : 0) });
  const p1 = k.moteur.evenement('VOICE_STATE_UPDATE', vs(U1, HUB, 'Lea'));
  await pause(120);
  assert.ok(k.journal.some(a => estDeplacement(a, U1) && a.fin), 'déplacé avant la fin du panneau');
  const p2 = k.moteur.evenement('VOICE_STATE_UPDATE', vs(U2, HUB, 'Max'));
  await pause(120);
  assert.ok(k.journal.some(a => estDeplacement(a, U2) && a.fin), 'le 2e membre est servi pendant le panneau du 1er');
  await Promise.all([p1, p2]);
  k.moteur.arreter();
});

test('deux membres en même temps : servis en parallèle (une création lente ne retarde pas l’autre)', async () => {
  const k = await monter({ retard: (m, c, corps) => (m === 'POST' && c === `/guilds/${GUILD}/channels` && corps?.name === 'Salon de Lea' ? 400 : 0) });
  const p1 = k.moteur.evenement('VOICE_STATE_UPDATE', vs(U1, HUB, 'Lea'));
  const p2 = k.moteur.evenement('VOICE_STATE_UPDATE', vs(U2, HUB, 'Max'));
  await Promise.all([p1, p2]);
  const creaLea = k.journal.find(a => estCreation(a) && a.corps.name === 'Salon de Lea');
  const depMax = k.journal.find(a => estDeplacement(a, U2));
  assert.ok(depMax.fin < creaLea.fin, 'Max est déplacé pendant que le salon de Lea se crée');
  assert.equal(k.journal.filter(estCreation).length, 2);
  k.moteur.arreter();
});

test('le même membre deux fois (événement rejoué) : un seul salon', async () => {
  const k = await monter({ retard: (m, c) => (m === 'POST' && c === `/guilds/${GUILD}/channels` ? 100 : 0) });
  await Promise.all([k.moteur.evenement('VOICE_STATE_UPDATE', vs(U1, HUB, 'Lea')), k.moteur.evenement('VOICE_STATE_UPDATE', vs(U1, HUB, 'Lea'))]);
  assert.equal(k.journal.filter(estCreation).length, 1);
  assert.equal((await k.base.tous('SELECT * FROM vocaux_salons', [])).length, 1);
  k.moteur.arreter();
});

test('membre reparti du hub avant d’être servi : rien n’est créé', async () => {
  const k = await monter();
  await Promise.all([k.moteur.evenement('VOICE_STATE_UPDATE', vs(U1, HUB, 'Lea')), k.moteur.evenement('VOICE_STATE_UPDATE', vs(U1, null, 'Lea'))]);
  // Le premier est servi tout de suite (avant le départ) ou pas du tout : jamais deux salons, jamais d'erreur.
  assert.ok(k.journal.filter(estCreation).length <= 1);
  k.moteur.arreter();
});

test('hub absent du cache : un seul GET de repli, puis plus jamais', async () => {
  const k = await monter();
  k.moteur.cache.salons.delete(HUB);
  await k.moteur.evenement('VOICE_STATE_UPDATE', vs(U1, HUB, 'Lea'));
  assert.equal(k.journal.filter(a => a.methode === 'GET' && a.chemin === `/channels/${HUB}`).length, 1);
  await k.moteur.evenement('VOICE_STATE_UPDATE', vs(U2, HUB, 'Max'));
  assert.equal(k.journal.filter(a => a.methode === 'GET').length, 1);
  k.moteur.arreter();
});

test('connexion gardée chaude : appel léger à la connexion de la Gateway puis à intervalle ; arrêté au reset', async () => {
  const k = await monter({ garderChaud: true, intervalleChaudMs: 40 });
  await k.moteur.evenement('GUILD_CREATE', { id: GUILD, channels: [...k.faux.etat.salons.values()], voice_states: [], members: [] });
  await pause(150);
  const n = k.journal.filter(a => a.chemin === '/users/@me').length;
  assert.ok(n >= 3, `appels légers : ${n}`);
  assert.equal(k.moteur.etat().chaud, true);
  k.moteur.reinitialiser();
  assert.equal(k.moteur.etat().chaud, false);
  k.moteur.arreter();
});

test('transport persistant : agent keep-alive ; connexion réutilisée ; reprise sur connexion refermée (pas pour POST)', async () => {
  const a = agentDiscord();
  assert.equal(a.keepAlive, true);
  assert.ok(a.options.timeout >= 50_000);
  a.destroy();
  let n = 0;
  const serveur = http.createServer((req, res) => {
    n++;
    let corps = '';
    req.on('data', c => (corps += c));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ methode: req.method, corps, type: req.headers['content-type'] ?? null }));
    });
  });
  serveur.keepAliveTimeout = 60_000;
  await new Promise(ok => serveur.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${serveur.address().port}/api/v10/users/@me`;
  const f = creerFetchDiscordNode({ module: http, agent: new http.Agent({ keepAlive: true }) });
  try {
    const a1 = await f(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}' });
    assert.equal(a1.headers.get('x-esport-connexion'), 'neuve');
    assert.deepEqual(await a1.json(), { methode: 'POST', corps: '{"a":1}', type: 'application/json' });
    const a2 = await f(url, { method: 'GET' });
    assert.equal(a2.headers.get('x-esport-connexion'), 'reutilisee', 'même connexion pour l’appel suivant');
    const fd = new FormData();
    fd.append('payload_json', '{}');
    const a3 = await (await f(url, { method: 'POST', body: fd })).json();
    assert.match(a3.type, /^multipart\/form-data; boundary=/);
    // Abandon (délai) respecté.
    const lent = http.createServer(() => {});
    await new Promise(ok => lent.listen(0, '127.0.0.1', ok));
    await assert.rejects(f(`http://127.0.0.1:${lent.address().port}/`, { signal: AbortSignal.timeout(50) }), e => e.name === 'TimeoutError');
    lent.close();
    // Connexion gardée refermée par le serveur : GET refait sur une connexion neuve.
    for (const s of Object.values(f.agent.freeSockets).flat()) s.destroy();
    const avant = n;
    const a4 = await f(url, { method: 'GET' });
    assert.equal(a4.status, 200);
    assert.ok(n > avant);
  } finally {
    f.fermer();
    serveur.close();
  }
});

test('limites de débit annoncées : route épuisée attendue (pas de 429), attente longue = échec propre', async () => {
  oublierLimites();
  // L'attente de rest() ne retient pas le processus (unref) : une minuterie le garde ouvert pendant le test.
  const vivant = setInterval(() => {}, 1000);
  assert.equal(cleRoute('PATCH', `/guilds/${GUILD}/members/${U1}`), `PATCH /guilds/${GUILD}/members/:id`);
  assert.equal(cleRoute('POST', `/channels/${HUB}/messages`), `POST /channels/${HUB}/messages`);
  const appels = [];
  let reset = 0.15;
  const fetch = async () => {
    appels.push(performance.now());
    return new Response('{}', { status: 200, headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset-After': String(reset) } });
  };
  await rest(fetch, JETON, 'PATCH', `/guilds/${GUILD}/members/${U1}`, {});
  await rest(fetch, JETON, 'PATCH', `/guilds/${GUILD}/members/${U2}`, {});
  assert.ok(appels[1] - appels[0] >= 120, 'attente de la remise à zéro annoncée');
  reset = 30;
  await rest(fetch, JETON, 'PATCH', `/guilds/${GUILD}/members/${U1}`, {});
  const r = await rest(fetch, JETON, 'PATCH', `/guilds/${GUILD}/members/${U1}`, {});
  assert.deepEqual([r.ok, r.statut, r.motif], [false, 429, 'limite']);
  assert.equal(appels.length, 3, 'aucun appel envoyé pour une route épuisée longtemps');
  // Une autre route n'est pas touchée.
  assert.equal((await rest(fetch, JETON, 'GET', '/users/@me')).ok, true);
  oublierLimites();
  clearInterval(vivant);
});
