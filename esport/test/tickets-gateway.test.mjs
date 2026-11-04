/**
 * Tickets, étape 1 : connexion Gateway Discord SIMULÉE (faux serveur WebSocket local, client WebSocket natif de
 * Node 22) : HELLO, IDENTIFY (intents minimaux), battements et ACK, READY, RESUME après coupure, connexion zombie,
 * INVALID_SESSION, fermeture fatale (intent MESSAGE_CONTENT refusé : 4014) ; bail du meneur entre deux processus
 * simulés (un seul tient la Gateway, l'autre reprend la session s'il meurt) ; relecture REST de secours ; état
 * affiché dans l'app. Tourne sur SQLite et, avec ESPORT_TEST_PG, sur PostgreSQL.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTENTS_TICKETS, adresseSure, creerGateway } from '../noyau/tickets/gateway.mjs';
import { bailActif, creerSuperviseurTickets, diagnosticConnexion, prendreBail, rendreBail } from '../noyau/tickets/superviseur.mjs';
import { tachesTickets } from '../noyau/tickets/cron.mjs';
import { baseMigree } from './base.mjs';
import { attendre, fauxDiscordRest, fauxGateway } from './tickets-aide.mjs';

const JETON = 'jeton-bot-de-test-jamais-reel';
const RAPIDE = { attenteMin: 20, attenteMax: 200, hasard: () => 0.5 };

test('intents minimaux : GUILDS, GUILD_MESSAGES, MESSAGE_CONTENT (33281) ; adresses acceptées', () => {
  assert.equal(INTENTS_TICKETS, 1 + 512 + 32768);
  assert.equal(adresseSure('wss://gateway.discord.gg'), 'wss://gateway.discord.gg');
  assert.equal(adresseSure('ws://gateway.discord.gg'), null, 'jamais de connexion en clair vers l’extérieur');
  assert.equal(adresseSure('ws://127.0.0.1:1234'), 'ws://127.0.0.1:1234');
  assert.equal(adresseSure('https://exemple.fr'), null);
});

test('HELLO → IDENTIFY, battements et ACK, READY, événements transmis ; coupure → RESUME avec la session', async () => {
  const gw = await fauxGateway({ intervalle: 40 });
  const rest = fauxDiscordRest({ gateway: gw });
  const evenements = [];
  const etats = [];
  const sessions = [];
  const client = creerGateway({ jetonBot: JETON, fetch: rest.fetch, surEvenement: (t, d) => evenements.push([t, d]), surEtat: e => etats.push(e.etat), surSession: s => sessions.push(s), ...RAPIDE });
  try {
    client.demarrer();
    const identify = await attendre(() => gw.recus.find(m => m.op === 2));
    assert.equal(identify.d.token, JETON);
    assert.equal(identify.d.intents, INTENTS_TICKETS);
    await attendre(() => client.etat().etat === 'pret');
    assert.equal(client.utilisateur, '424242424242424242');
    // Battements réguliers, chacun acquitté.
    await attendre(() => gw.recus.filter(m => m.op === 1).length >= 3, { message: 'battements' });
    assert.ok(client.etat().dernierAck);
    const premiere = gw.connexions[0];
    premiere.dispatch('MESSAGE_CREATE', { id: '1', channel_id: '2', content: 'bonjour' });
    await attendre(() => evenements.some(([t]) => t === 'MESSAGE_CREATE'));
    // Coupure côté Discord (code 4000) : reconnexion à l'adresse de reprise, RESUME avec la session et le numéro.
    gw.fermer(premiere, 4000);
    const reprise = await attendre(() => gw.recus.find(m => m.op === 6), { message: 'RESUME attendu' });
    assert.equal(reprise.d.session_id, 'session-test-1');
    assert.equal(reprise.d.seq, 2);
    assert.equal(reprise.d.token, JETON);
    await attendre(() => client.etat().etat === 'pret');
    assert.equal(gw.recus.filter(m => m.op === 2).length, 1, 'pas de second IDENTIFY');
    assert.equal(gw.ouvertes().length, 1, 'une seule connexion ouverte');
    assert.ok(sessions.some(s => s?.id === 'session-test-1'), 'session mémorisée (un autre processus peut la reprendre)');
  } finally {
    await client.arreter();
    await gw.arreter();
  }
});

test('connexion zombie (aucun ACK) : fermée puis reprise ; INVALID_SESSION (false) : nouvel IDENTIFY', async () => {
  const gw = await fauxGateway({ intervalle: 30 });
  const rest = fauxDiscordRest({ gateway: gw });
  const client = creerGateway({ jetonBot: JETON, fetch: rest.fetch, ...RAPIDE });
  try {
    client.demarrer();
    await attendre(() => client.etat().etat === 'pret');
    gw.connexions[0].sansAck = true;
    // Le client ferme lui-même la connexion muette puis reprend la session.
    await attendre(() => gw.connexions.length >= 2 && gw.recus.some(m => m.op === 6), { message: 'reprise après zombie' });
    assert.ok(gw.connexions[0].ferme);
    await attendre(() => client.etat().etat === 'pret');
    // Discord refuse la reprise suivante : session oubliée, nouvel IDENTIFY après 1 à 5 s (borné ici par attenteMax).
    gw.connexions.at(-1).envoyer({ op: 9, d: false });
    await attendre(() => gw.recus.filter(m => m.op === 2).length >= 2, { delai: 4000, message: 'nouvel IDENTIFY' });
  } finally {
    await client.arreter();
    await gw.arreter();
  }
});

test('fermeture 4014 (intent MESSAGE_CONTENT non activé) : plus aucune tentative, état fatal', async () => {
  const gw = await fauxGateway({ intervalle: 1000 });
  const rest = fauxDiscordRest({ gateway: gw });
  const client = creerGateway({ jetonBot: JETON, fetch: rest.fetch, ...RAPIDE });
  try {
    client.demarrer();
    await attendre(() => gw.connexions.length === 1 && gw.recus.some(m => m.op === 2));
    gw.fermer(gw.connexions[0], 4014);
    await attendre(() => client.etat().etat === 'fatal');
    assert.equal(client.etat().code, 4014);
    await new Promise(ok => setTimeout(ok, 300));
    assert.equal(gw.connexions.length, 1, 'aucune reconnexion');
  } finally {
    await client.arreter();
    await gw.arreter();
  }
});

test('budget de sessions presque épuisé : pas d’IDENTIFY (état « limite »)', async () => {
  const gw = await fauxGateway();
  const rest = fauxDiscordRest({ gateway: gw });
  rest.programme.push({ si: (m, c) => c === '/gateway/bot', corps: { url: gw.url, session_start_limit: { total: 1000, remaining: 2, reset_after: 3_600_000 } } });
  const client = creerGateway({ jetonBot: JETON, fetch: rest.fetch, ...RAPIDE });
  try {
    client.demarrer();
    await attendre(() => client.etat().etat === 'limite');
    assert.equal(gw.connexions.length, 0);
  } finally {
    await client.arreter();
    await gw.arreter();
  }
});

async function activer(base, t = Date.now()) {
  await base.executer('INSERT INTO tickets_reglages (cle, valeur, maj_le) VALUES (?, ?, ?)', ['general', JSON.stringify({ actif: true, guildId: '700000000000000001', categorieOuverts: '710000000000000010' }), new Date(t).toISOString()]);
}

async function ticketDeTest(base, { salon = '710000000000009001', auteur = '800000000000000001' } = {}) {
  const t = new Date().toISOString();
  await base.executer("INSERT INTO tickets_categories (id, nom_fr, nom_en, cree_le, maj_le) VALUES ('cat-test', 'Aide', 'Help', ?, ?)", [t, t]);
  await base.executer("INSERT INTO tickets (id, numero, categorie_id, auteur_discord_id, auteur_nom, salon_id, ouvert_le, maj_le, derniere_activite_le) VALUES ('tk-test', 1, 'cat-test', ?, 'Léa', ?, ?, ?, ?)", [auteur, salon, t, t, t]);
  return { salon, auteur };
}

test('bail : un seul meneur ; renouvelé par le titulaire ; repris après expiration ; rendu à l’arrêt', async () => {
  const base = await baseMigree();
  const t = Date.parse('2026-11-04T10:00:00.000Z');
  assert.equal(await prendreBail(base, 'A', t), true);
  assert.equal(await prendreBail(base, 'B', t + 1000), false);
  assert.equal(await prendreBail(base, 'A', t + 30_000), true, 'renouvelé');
  assert.equal(await prendreBail(base, 'B', t + 80_000), false, 'encore valable (renouvelé à +30 s)');
  assert.equal(await prendreBail(base, 'B', t + 91_000), true, 'expiré : repris par B');
  assert.equal(await prendreBail(base, 'A', t + 92_000), false);
  await rendreBail(base, 'B', t + 93_000);
  assert.equal(await bailActif(base, t + 93_000), null);
  assert.equal(await prendreBail(base, 'A', t + 94_000), true);
});

test('deux processus simulés : un seul tient la Gateway ; le meneur meurt → l’autre reprend la SESSION (RESUME)', async () => {
  const base = await baseMigree();
  await activer(base);
  const gw = await fauxGateway({ intervalle: 200 });
  const rest = fauxDiscordRest({ gateway: gw });
  const horloge = { t: Date.now() };
  const options = { base, jetonBot: JETON, fetch: rest.fetch, maintenant: () => horloge.t, intervalle: 1_000_000, dureeBail: 60_000, gateway: RAPIDE, journal: { error() {}, warn() {} } };
  const p1 = creerSuperviseurTickets({ ...options, identifiant: 'processus-1' });
  const p2 = creerSuperviseurTickets({ ...options, identifiant: 'processus-2' });
  try {
    const r1 = await p1.passage();
    const r2 = await p2.passage();
    assert.equal(r1.meneur, true);
    assert.equal(r2.meneur, false);
    await attendre(() => p1.etat().gateway?.etat === 'pret');
    await p1.passage();
    assert.equal(gw.ouvertes().length, 1, 'une seule connexion pour tout le compte');
    assert.equal((await diagnosticConnexion(base, horloge.t)).mode, 'direct');
    // La session est mémorisée en base (un autre processus pourra la reprendre).
    await attendre(async () => (await base.premier("SELECT valeur FROM tickets_etat WHERE cle = 'session'", []))?.valeur?.includes('session-test-1'));
    // Le processus 1 « meurt » (plus de passage, bail non rendu, connexion coupée).
    await p1.figer();
    horloge.t += 61_000;
    const r3 = await p2.passage();
    assert.equal(r3.meneur, true, 'bail expiré : le processus 2 devient meneur');
    const reprise = await attendre(() => gw.recus.find(m => m.op === 6), { message: 'le processus 2 reprend la session' });
    assert.equal(reprise.d.session_id, 'session-test-1');
    await attendre(() => p2.etat().gateway?.etat === 'pret');
    assert.equal(gw.recus.filter(m => m.op === 2).length, 1, 'aucun IDENTIFY de plus');
    // Un processus 1 « figé » qui reviendrait : il n'est plus meneur et n'ouvre rien.
    const p3 = creerSuperviseurTickets({ ...options, identifiant: 'processus-1' });
    const r4 = await p3.passage();
    assert.equal(r4.meneur, false);
    assert.equal(gw.ouvertes().length, 1);
    await p3.arreter();
  } finally {
    await p1.arreter();
    await p2.arreter();
    await gw.arreter();
  }
});

test('repli : Gateway refusée (4014) → relecture REST des tickets ouverts ; messages enregistrés sans doublon', async () => {
  const base = await baseMigree();
  await activer(base);
  const { salon, auteur } = await ticketDeTest(base);
  const gw = await fauxGateway({ intervalle: 1000 });
  const rest = fauxDiscordRest({ gateway: gw });
  const sup = creerSuperviseurTickets({ base, jetonBot: JETON, fetch: rest.fetch, identifiant: 'p', intervalle: 1_000_000, intervalleSecours: 0, gateway: RAPIDE, journal: { error() {}, warn() {} } });
  try {
    await sup.passage();
    await attendre(() => gw.connexions.length === 1 && gw.recus.some(m => m.op === 2));
    gw.fermer(gw.connexions[0], 4014);
    await attendre(() => sup.etat().gateway?.etat === 'fatal');
    rest.posterUtilisateur(salon, auteur, 'Bonjour, j’ai un souci');
    rest.posterUtilisateur(salon, '800000000000000077', 'Le staff regarde.', { member: undefined });
    const r = await sup.passage();
    assert.equal(r.mode, 'secours');
    assert.equal(r.releve.messages, 2);
    const msgs = await base.tous("SELECT contenu, staff FROM tickets_messages WHERE ticket_id = 'tk-test' ORDER BY cree_le, contenu", []);
    assert.deepEqual(msgs.map(m => [m.contenu, Number(m.staff)]), [['Bonjour, j’ai un souci', 0], ['Le staff regarde.', 1]]);
    // Passage suivant : rien de nouveau (curseur `after`), rien en double.
    const r2 = await sup.passage();
    assert.equal(r2.releve.messages, 0);
    assert.ok(rest.appels.some(a => a.methode === 'GET' && a.url.includes('after=')), 'relecture depuis le dernier message connu');
    const d = await diagnosticConnexion(base, Date.now());
    assert.equal(d.mode, 'secours');
    assert.equal(d.intentRefuse, true, 'l’app explique : activer l’intent MESSAGE_CONTENT');
    // Limite de débit : le passage s'arrête au premier 429 (aucune rafale).
    rest.programme.push({ si: (m, c) => c.includes('/messages'), statut: 429, corps: { retry_after: 30 } });
    const r3 = await sup.passage();
    assert.equal(r3.releve.limite, true);
  } finally {
    await sup.arreter();
    await gw.arreter();
  }
});

test('MESSAGE_CREATE reçu en direct : enregistré une seule fois (Gateway puis relecture) ; messages du bot ignorés', async () => {
  const base = await baseMigree();
  await activer(base);
  const { salon, auteur } = await ticketDeTest(base);
  const gw = await fauxGateway({ intervalle: 50 });
  const rest = fauxDiscordRest({ gateway: gw });
  const sup = creerSuperviseurTickets({ base, jetonBot: JETON, fetch: rest.fetch, identifiant: 'p', intervalle: 1_000_000, gateway: RAPIDE, journal: { error() {}, warn() {} } });
  try {
    await sup.passage();
    await attendre(() => sup.etat().gateway?.etat === 'pret');
    const m = rest.posterUtilisateur(salon, auteur, 'En direct', { member: { roles: [] } });
    gw.connexions[0].dispatch('MESSAGE_CREATE', m);
    gw.connexions[0].dispatch('MESSAGE_CREATE', { ...m, id: '999', author: { id: '424242424242424242', bot: true }, content: 'du bot' });
    await attendre(async () => (await base.tous("SELECT id FROM tickets_messages WHERE ticket_id = 'tk-test'", [])).length === 1);
    // Rattrapage après READY (nouvelle session) puis relecture : toujours un seul message.
    await sup.passage();
    await new Promise(ok => setTimeout(ok, 50));
    assert.equal((await base.tous("SELECT id FROM tickets_messages WHERE ticket_id = 'tk-test'", [])).length, 1);
    // Modification et suppression suivies.
    gw.connexions[0].dispatch('MESSAGE_UPDATE', { id: m.id, channel_id: salon, content: 'En direct (modifié)' });
    gw.connexions[0].dispatch('MESSAGE_DELETE', { id: m.id, channel_id: salon });
    await attendre(async () => (await base.premier("SELECT supprime_le FROM tickets_messages WHERE ticket_id = 'tk-test'", []))?.supprime_le);
    assert.equal((await base.premier("SELECT contenu FROM tickets_messages WHERE ticket_id = 'tk-test'", [])).contenu, 'En direct (modifié)');
  } finally {
    await sup.arreter();
    await gw.arreter();
  }
});

test('tickets désactivés : aucun bail pris, aucune connexion ; cron : relecture seulement sans meneur', async () => {
  const base = await baseMigree();
  const rest = fauxDiscordRest();
  const sup = creerSuperviseurTickets({ base, jetonBot: JETON, fetch: rest.fetch, identifiant: 'p', intervalle: 1_000_000 });
  assert.equal((await sup.passage()).mode, 'inactif');
  assert.equal(rest.appels.length, 0);
  assert.deepEqual(await tachesTickets(base, { jetonBot: JETON, fetch: rest.fetch }), { actif: false });
  await activer(base);
  await ticketDeTest(base);
  const r = await tachesTickets(base, { jetonBot: JETON, fetch: rest.fetch });
  assert.equal(r.meneur, false);
  assert.equal(r.releve.salons, 1, 'aucun meneur : le cron relit les tickets');
  assert.equal((await diagnosticConnexion(base, Date.now())).mode, 'secours');
  await prendreBail(base, 'quelqu-un', Date.now());
  const r2 = await tachesTickets(base, { jetonBot: JETON, fetch: rest.fetch });
  assert.equal(r2.meneur, true);
  assert.equal(r2.releve, null, 'un meneur tient la Gateway : le cron ne relit pas');
  assert.equal((await diagnosticConnexion(base, Date.now() + 20 * 60_000)).mode, 'hors_ligne');
  await sup.arreter();
});
