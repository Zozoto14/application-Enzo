/**
 * Tickets › Configuration : parcours « Général » de bout en bout et diagnostic de la connexion (signalement du
 * Fondateur : serveur choisi, mais « Choisissez d'abord le serveur. » et la connexion restait « Hors ligne »).
 *  - choisir un serveur lit TOUT DE SUITE ses catégories et salons (`?serveur=`), avant tout enregistrement ;
 *  - serveur + catégories + activation enregistrés en une fois ; activer sans catégorie : refus clair (400) ;
 *  - erreur de Discord (403 / 50001 Missing Access, bot absent du serveur) rendue lisible à l'app ;
 *  - le superviseur démarre dès que les tickets sont activés (inactif → secours → en direct) ;
 *  - diagnostic : jeton, serveur, catégorie, activation, processus de l'app, Gateway et sa dernière erreur, cron ;
 *  - maintien en éveil (URL_PUBLIQUE/sante) par le meneur.
 * Faux Discord REST et faux serveur Gateway (aucun réseau réel). SQLite, et PostgreSQL avec ESPORT_TEST_PG.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc } from './aide.mjs';
import { attendre, bancTickets, fauxDiscordRest, fauxGateway } from './tickets-aide.mjs';
import { creerSuperviseurTickets, diagnosticTickets } from '../noyau/tickets/superviseur.mjs';
import { tachesTickets } from '../noyau/tickets/cron.mjs';
import { lireGeneral } from '../noyau/tickets/reglages.mjs';

const CAT_OUVERTS = '710000000000000010';
const CAT_ARCHIVES = '710000000000000011';
const JOURNAUX = '710000000000000012';
const JETON = 'jeton-bot-de-test-jamais-reel';
const RAPIDE = { attenteMin: 20, attenteMax: 200, hasard: () => 0.5 };
const SILENCE = { error() {}, warn() {} };

test('Général : choisir un serveur montre ses catégories AVANT d’enregistrer ; rien n’est enregistré par la lecture', async () => {
  const k = await bancTickets({ banc });
  // Rien d'enregistré : la liste des serveurs seulement.
  const avant = (await k.api('/tickets/config/discord')).corps;
  assert.deepEqual(avant.serveurs, [{ id: k.GUILD, nom: 'Club' }]);
  assert.equal(avant.salons, undefined);
  // Serveur choisi dans l'app (pas encore enregistré) : catégories et salons lus tout de suite.
  const d = (await k.api(`/tickets/config/discord?serveur=${k.GUILD}`)).corps;
  assert.equal(d.erreur, null);
  assert.deepEqual(d.serveur, { id: k.GUILD, nom: 'Club', enregistre: false });
  assert.deepEqual(d.salons.filter(s => s.type === 'categorie').map(s => s.id), [CAT_OUVERTS, CAT_ARCHIVES]);
  assert.ok(d.salons.some(s => s.id === JOURNAUX && s.type === 'texte'));
  assert.deepEqual(d.permissions.serveur, []);
  assert.equal(d.permissions.ouverts, null, 'rien à vérifier tant que rien n’est enregistré');
  assert.equal((await lireGeneral(k.b.base)).guildId, null, 'la lecture n’enregistre rien');
  // Identifiant illisible : refusé ; serveur où le bot n'est pas : dit clairement.
  assert.equal((await k.api('/tickets/config/discord?serveur=abc')).statut, 400);
  const absent = (await k.api('/tickets/config/discord?serveur=700000000000000099')).corps;
  assert.equal(absent.erreur, 'bot-absent');
  assert.equal(absent.salons, undefined);
});

test('Général : serveur + catégories + activation enregistrés en une fois ; activer sans catégorie : refus clair', async () => {
  const k = await bancTickets({ banc });
  // Le cas signalé : « Tickets activés » + serveur, sans catégorie → refus explicite (rien d'enregistré).
  const r0 = await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { actif: true, guildId: k.GUILD, guildNom: 'Ligne Zero | 線ゼロ' } });
  assert.equal(r0.statut, 400);
  assert.equal(r0.corps.code, 'incomplet');
  assert.match(r0.corps.erreur, /catégorie Discord des tickets ouverts/);
  // Tout en une fois (ce que fait l'écran après la lecture du serveur choisi).
  const r = await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { actif: true, guildId: k.GUILD, guildNom: 'Ligne Zero | 線ゼロ', categorieOuverts: CAT_OUVERTS, categorieArchives: CAT_ARCHIVES, salonJournaux: JOURNAUX } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.deepEqual([r.corps.general.actif, r.corps.general.guildId, r.corps.general.guildNom, r.corps.general.categorieOuverts], [true, k.GUILD, 'Ligne Zero | 線ゼロ', CAT_OUVERTS]);
  // Relu : serveur enregistré, permissions vérifiées dans les salons choisis.
  const d = (await k.api('/tickets/config/discord')).corps;
  assert.equal(d.serveur.enregistre, true);
  assert.deepEqual(d.permissions.ouverts, { id: CAT_OUVERTS, nom: 'Tickets', manquantes: [] });
  assert.equal(d.permissions.journaux.id, JOURNAUX);
  const diag = (await k.api('/tickets/etat')).corps.diagnostic;
  assert.deepEqual([diag.bot, diag.serveur?.id, diag.categorie, diag.actif], [true, k.GUILD, true, true]);
  // Un compte qui voit les tickets sans les configurer : état de la connexion, sans le diagnostic détaillé.
  const voir = await k.compteAvec('voir1234', 'Voir', ['tickets.voir']);
  const e = (await k.api('/tickets/etat', voir.jeton)).corps;
  assert.equal(e.connexion.mode, 'hors_ligne');
  assert.equal(e.diagnostic, undefined);
});

test('erreur de Discord lisible : 403 / 50001 (Missing Access) sur les salons ; Discord injoignable', async () => {
  const k = await bancTickets({ banc });
  k.discord.programme.push({ si: (m, c) => c === `/guilds/${k.GUILD}/channels`, statut: 403, corps: { code: 50001, message: 'Missing Access' } });
  const d = (await k.api(`/tickets/config/discord?serveur=${k.GUILD}`)).corps;
  assert.equal(d.erreur, 'discord-403');
  assert.deepEqual(d.erreurDetail, { etape: 'salons', statut: 403, code: 50001 });
  assert.deepEqual(d.serveurs, [{ id: k.GUILD, nom: 'Club' }], 'la liste des serveurs reste affichée');
  assert.equal(d.salons, undefined);
  // Liste des serveurs elle-même refusée (jeton refusé).
  k.discord.programme.push({ si: (m, c) => c === '/users/@me/guilds', statut: 401, corps: { code: 0, message: '401: Unauthorized' } });
  const e = (await k.api('/tickets/config/discord')).corps;
  assert.equal(e.erreur, 'discord-401');
  assert.equal(e.erreurDetail.etape, 'serveurs');
  // Réseau coupé : statut 0.
  k.discord.programme.push(new Error('ECONNRESET'));
  assert.equal((await k.api('/tickets/config/discord')).corps.erreur, 'discord-0');
});

test('superviseur : démarre dès l’activation ; état inactif → secours → en direct ; diagnostic à chaque étape', async () => {
  const k = await bancTickets({ banc });
  const gw = await fauxGateway({ intervalle: 200 });
  const rest = fauxDiscordRest({ gateway: gw });
  const sup = creerSuperviseurTickets({ base: k.b.base, jetonBot: JETON, fetch: rest.fetch, maintenant: () => k.b.horloge.t, identifiant: 'proc-1', intervalle: 1_000_000, gateway: RAPIDE, journal: SILENCE });
  try {
    // Tickets pas configurés : rien n'est ouvert ; le diagnostic dit pourquoi, et que l'app tourne.
    assert.equal((await sup.passage()).mode, 'inactif');
    assert.equal(gw.connexions.length, 0);
    let etat = (await k.api('/tickets/etat')).corps;
    assert.equal(etat.connexion.mode, 'hors_ligne');
    assert.deepEqual([etat.diagnostic.serveur, etat.diagnostic.categorie, etat.diagnostic.actif], [null, false, false]);
    assert.deepEqual([etat.diagnostic.processus.role, etat.diagnostic.processus.raison, etat.diagnostic.processus.frais], ['inactif', 'sans-serveur', true]);
    assert.equal(etat.diagnostic.cron, null, 'cron jamais vu');
    // Le Fondateur enregistre tout d'un coup.
    const r = await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { actif: true, guildId: k.GUILD, categorieOuverts: CAT_OUVERTS } });
    assert.equal(r.statut, 200);
    // Passage suivant : meneur, Gateway lancée ; tant qu'elle n'est pas prête : « secours » (relecture REST).
    const p1 = await sup.passage();
    assert.equal(p1.meneur, true);
    assert.equal(p1.mode, 'secours');
    etat = (await k.api('/tickets/etat')).corps;
    assert.equal(etat.connexion.mode, 'secours');
    assert.equal(etat.diagnostic.meneur, true);
    assert.ok(etat.diagnostic.connexion.dernierEssai, 'dernier essai de connexion daté');
    await attendre(() => sup.etat().gateway?.etat === 'pret', { message: 'Gateway prête' });
    await sup.passage();
    etat = (await k.api('/tickets/etat')).corps;
    assert.equal(etat.connexion.mode, 'direct');
    assert.equal(etat.diagnostic.processus.role, 'meneur');
    // Plus aucune nouvelle pendant plus de 3 minutes (processus arrêté par l'hébergeur) : hors ligne.
    k.b.horloge.t += 4 * 60_000;
    etat = (await k.api('/tickets/etat')).corps;
    assert.equal(etat.connexion.mode, 'hors_ligne');
    assert.equal(etat.diagnostic.processus.frais, false);
  } finally {
    await sup.arreter();
    await gw.arreter();
  }
});

test('Gateway : la dernière erreur (GET /gateway/bot refusé) et l’absence de client WebSocket sont notées', async () => {
  const k = await bancTickets({ banc });
  await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { actif: true, guildId: k.GUILD, categorieOuverts: CAT_OUVERTS } });
  const rest = fauxDiscordRest();
  rest.programme.push({ si: (m, c) => c === '/gateway/bot', statut: 500, corps: { message: 'oups' } });
  const sup = creerSuperviseurTickets({ base: k.b.base, jetonBot: JETON, fetch: rest.fetch, maintenant: () => k.b.horloge.t, identifiant: 'proc-e', intervalle: 1_000_000, gateway: { attenteMin: 60_000, attenteMax: 60_000, hasard: () => 0.5 }, journal: SILENCE });
  try {
    await sup.passage();
    await attendre(() => sup.etat().gateway?.etat === 'attente');
    await sup.passage();
    const c = (await k.api('/tickets/etat')).corps.diagnostic.connexion;
    assert.equal(c.mode, 'secours');
    assert.match(c.derniereErreur.motif, /gateway\/bot : HTTP 500/);
  } finally {
    await sup.arreter();
  }
  // Node sans WebSocket (version trop ancienne) : fatal, code « sans-websocket ».
  const sup2 = creerSuperviseurTickets({ base: k.b.base, jetonBot: JETON, fetch: rest.fetch, maintenant: () => k.b.horloge.t + 120_000, identifiant: 'proc-e', intervalle: 1_000_000, gateway: { WebSocket: null }, journal: SILENCE });
  try {
    await sup2.passage();
    await sup2.passage();
    const c = (await k.api('/tickets/etat')).corps.diagnostic.connexion;
    assert.equal(c.sansWebSocket, true);
    assert.match(c.derniereErreur.motif, /WebSocket/);
  } finally {
    await sup2.arreter();
  }
});

test('cron : passage noté même tickets désactivés ; vieux de plus de 10 min : signalé', async () => {
  const k = await bancTickets({ banc });
  const t = k.b.horloge.t;
  assert.deepEqual(await tachesTickets(k.b.base, { jetonBot: JETON, fetch: k.discord.fetch, maintenant: () => t }), { actif: false });
  let d = await diagnosticTickets(k.b.base, t + 60_000, { jetonBot: JETON, general: await lireGeneral(k.b.base) });
  assert.equal(d.cron.frais, true);
  d = await diagnosticTickets(k.b.base, t + 12 * 60_000, { jetonBot: JETON, general: await lireGeneral(k.b.base) });
  assert.equal(d.cron.frais, false);
  assert.equal(d.cron.le, new Date(t).toISOString());
  // Sans jeton du bot : dit tel quel.
  d = await diagnosticTickets(k.b.base, t, { jetonBot: undefined, general: await lireGeneral(k.b.base) });
  assert.equal(d.bot, false);
  assert.equal(d.reveilConfigure, null, 'inconnu hors du serveur Node');
  assert.equal(d.gatewayActivee, true);
});

test('maintien en éveil : le meneur appelle URL_PUBLIQUE/sante toutes les 4 min ; un échec est affiché', async () => {
  const k = await bancTickets({ banc });
  await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { actif: true, guildId: k.GUILD, categorieOuverts: CAT_OUVERTS } });
  const reveils = [];
  let repondre = () => new Response('{"ok":true}', { status: 200 });
  const fetchReveil = async url => {
    reveils.push(String(url));
    return repondre();
  };
  const rest = fauxDiscordRest();
  // Gateway jamais connectée (pas de WebSocket) : seul le réveil compte ici.
  const sup = creerSuperviseurTickets({ base: k.b.base, jetonBot: JETON, fetch: rest.fetch, gateway: { WebSocket: null }, maintenant: () => k.b.horloge.t, identifiant: 'proc-r', intervalle: 1_000_000, reveil: 'https://esport.exemple/sante', fetchReveil, journal: SILENCE });
  try {
    await sup.passage();
    await attendre(() => reveils.length === 1);
    assert.equal(reveils[0], 'https://esport.exemple/sante');
    k.b.horloge.t += 60_000;
    await sup.passage();
    assert.equal(reveils.length, 1, 'pas avant 4 minutes');
    repondre = () => {
      throw new Error('ENOTFOUND esport.exemple');
    };
    k.b.horloge.t += 4 * 60_000;
    await sup.passage();
    await attendre(() => reveils.length === 2);
    await new Promise(ok => setTimeout(ok, 10));
    await sup.passage();
    const c = (await k.api('/tickets/etat')).corps.diagnostic.connexion;
    assert.equal(c.reveil.ok, false);
    assert.match(c.reveil.erreur, /ENOTFOUND/);
  } finally {
    await sup.arreter();
  }
});
