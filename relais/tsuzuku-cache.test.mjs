/**
 * Cache du relais pour Tsuzuku (`/tsuzuku/requete` avec `cache: { nature }`) :
 * HIT / MISS, durée, clé, ce qui n'est jamais gardé, droits et garde anti-SSRF
 * inchangés, cache partagé facultatif (`deps.cache`) simulé.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHEMIN_TSUZUKU,
  DUREES_CACHE_S,
  cacheMemoireDuRelais,
  cleDeCache,
  creerCacheMemoire,
  gardable,
  routeTsuzuku,
  validerDemande,
} from './tsuzuku.mjs';
import { porteeDuJeton, jetonDeProfil } from './relais.mjs';

const JETON = 'jeton-de-test-tsuzuku-cache-0123456789';
const SITE = 'https://site-exemple.fr';
const env = { JETON, ORIGINES_SITE: SITE, LIMITE_TSUZUKU_MINUTE: '1000' };
const T0 = 1_800_000_000_000;

function fauxFetch(reponse = () => new Response('<ul><li><a href="/serie/a">A</a></li></ul>', { headers: { 'content-type': 'text/html; charset=utf-8' } })) {
  const appels = [];
  const fn = async (url, init) => {
    appels.push({ url, init });
    return reponse(url, init);
  };
  fn.appels = appels;
  return fn;
}

/** Faux cache partagé (interface Cache : match/put) : une Map. */
function fauxCacheCf() {
  const m = new Map();
  return {
    m,
    async match(adresse) {
      const e = m.get(adresse);
      return e ? new Response(e.corps, { headers: e.entetes }) : undefined;
    },
    async put(adresse, rep) {
      m.set(adresse, { corps: await rep.text(), entetes: [...rep.headers] });
    },
  };
}

async function appeler(corps, { jeton = JETON, maintenant = T0, fetch, cache = null, resoudre, waitUntil } = {}) {
  const requete = new Request(`https://relais.test${CHEMIN_TSUZUKU}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jeton}`, Origin: SITE, 'Content-Type': 'application/json' },
    body: JSON.stringify(corps),
  });
  const dns = [];
  const rep = await routeTsuzuku(requete, env, () => porteeDuJeton(jeton, JETON), {
    fetch,
    cache,
    waitUntil,
    maintenant: () => maintenant,
    journal: () => undefined,
    resoudre: async h => {
      dns.push(h);
      return resoudre ? resoudre(h) : ['93.184.215.14'];
    },
  });
  return { rep, json: await rep.json().catch(() => null), dns };
}

const RECHERCHE = { url: 'https://source-exemple.fr/recherche?q=voyage', method: 'GET', cache: { nature: 'recherche' } };

beforeEach(() => cacheMemoireDuRelais.vider());

test('MISS puis HIT : la seconde lecture ne repart pas vers le site (ni DNS), âge et en-tête indiqués', async () => {
  const f = fauxFetch();
  const a = await appeler(RECHERCHE, { fetch: f });
  assert.equal(a.rep.status, 200);
  assert.equal(a.json.cache, 'MISS');
  assert.equal(a.rep.headers.get('x-tsuzuku-cache'), 'MISS');
  const b = await appeler(RECHERCHE, { fetch: f, maintenant: T0 + 60_000 });
  assert.equal(b.json.cache, 'HIT');
  assert.equal(b.rep.headers.get('x-tsuzuku-cache'), 'HIT');
  assert.equal(b.json.ageS, 60);
  assert.equal(b.json.texte, a.json.texte);
  assert.equal(b.json.status, 200);
  assert.equal(b.rep.headers.get('Access-Control-Allow-Origin'), SITE);
  assert.equal(b.rep.headers.get('Cache-Control'), 'no-store', 'le navigateur ne garde rien : seul le relais garde');
  assert.equal(f.appels.length, 1);
  assert.deepEqual(b.dns, [], 'aucune résolution DNS pour une page servie par le cache');
});

test('durée : 15 min pour une recherche, 30 min pour une page ; au-delà, relue', async () => {
  assert.deepEqual(DUREES_CACHE_S, { recherche: 900, page: 1800 });
  const f = fauxFetch();
  await appeler(RECHERCHE, { fetch: f });
  assert.equal((await appeler(RECHERCHE, { fetch: f, maintenant: T0 + 899_000 })).json.cache, 'HIT');
  assert.equal((await appeler(RECHERCHE, { fetch: f, maintenant: T0 + 900_000 })).json.cache, 'MISS');
  const page = { url: 'https://source-exemple.fr/serie/a/', method: 'GET', cache: { nature: 'page' } };
  await appeler(page, { fetch: f });
  assert.equal((await appeler(page, { fetch: f, maintenant: T0 + 1_799_000 })).json.cache, 'HIT');
  assert.equal((await appeler(page, { fetch: f, maintenant: T0 + 1_800_000 })).json.cache, 'MISS');
  assert.equal(f.appels.length, 4);
});

test('sans demande du site (ancien site), en POST ou nature inconnue : rien n’est gardé', async () => {
  const f = fauxFetch();
  for (const corps of [
    { url: RECHERCHE.url, method: 'GET' },
    { url: RECHERCHE.url, method: 'POST', body: 'q=voyage', cache: { nature: 'recherche' } },
    { url: RECHERCHE.url, method: 'GET', cache: { nature: 'tout' } },
    { url: RECHERCHE.url, method: 'GET', cache: 'recherche' },
  ]) {
    const a = await appeler(corps, { fetch: f });
    const b = await appeler(corps, { fetch: f });
    assert.equal(a.json.cache, undefined);
    assert.equal(b.json.cache, undefined);
    assert.equal(b.rep.headers.get('x-tsuzuku-cache'), null);
  }
  assert.equal(f.appels.length, 8);
  assert.equal(cacheMemoireDuRelais.taille(), 0);
  assert.equal(validerDemande({ url: RECHERCHE.url, method: 'POST', cache: { nature: 'recherche' } }).cache, undefined);
});

test('jamais gardé : erreur, redirection, réponse tronquée, page anti-robot, binaire', async () => {
  const cas = [
    () => new Response('introuvable', { status: 404, headers: { 'content-type': 'text/plain' } }),
    () => new Response(null, { status: 302, headers: { location: 'https://source-exemple.fr/ailleurs' } }),
    () => new Response('<title>Just a moment...</title>', { headers: { 'content-type': 'text/html' } }),
    () => new Response('<p>ok</p>', { headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' } }),
    () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }),
  ];
  for (const reponse of cas) {
    cacheMemoireDuRelais.vider();
    const f = fauxFetch(reponse);
    await appeler(RECHERCHE, { fetch: f });
    const b = await appeler(RECHERCHE, { fetch: f });
    assert.equal(b.json.cache, 'MISS');
    assert.equal(f.appels.length, 2);
  }
  assert.equal(gardable({ status: 200, tronque: true, texte: 'x', headers: {} }), false);
  assert.equal(gardable({ status: 200, tronque: false, texte: 'x'.repeat(1024 * 1024 + 1), headers: {} }), false);
  assert.equal(gardable({ status: 200, tronque: false, texte: '<p>Liste</p>', headers: {} }), true);
});

test('« frais » (Réessayer) : lit le site même si la page est gardée, et remet le cache à jour', async () => {
  let n = 0;
  const f = fauxFetch(() => new Response(`<p>version ${++n}</p>`, { headers: { 'content-type': 'text/html' } }));
  await appeler(RECHERCHE, { fetch: f });
  const frais = await appeler({ ...RECHERCHE, cache: { nature: 'recherche', frais: true } }, { fetch: f, maintenant: T0 + 1000 });
  assert.equal(frais.json.cache, 'MISS');
  assert.equal(frais.json.texte, '<p>version 2</p>');
  const ensuite = await appeler(RECHERCHE, { fetch: f, maintenant: T0 + 2000 });
  assert.equal(ensuite.json.cache, 'HIT');
  assert.equal(ensuite.json.texte, '<p>version 2</p>');
  assert.equal(f.appels.length, 2);
});

test('clé : adresse normalisée et en-têtes envoyés ; jamais le jeton ; fragment ignoré', async () => {
  const base = validerDemande({ url: 'https://Source-Exemple.FR:443/recherche?q=voyage#haut', method: 'GET', headers: { 'accept-language': 'fr', 'user-agent': 'UA' } });
  const meme = validerDemande({ url: 'https://source-exemple.fr/recherche?q=voyage', method: 'GET', headers: { 'user-agent': 'UA', 'accept-language': 'fr' } });
  const autreLangue = validerDemande({ url: 'https://source-exemple.fr/recherche?q=voyage', method: 'GET', headers: { 'user-agent': 'UA', 'accept-language': 'en' } });
  const autreRequete = validerDemande({ url: 'https://source-exemple.fr/recherche?q=voyages', method: 'GET', headers: { 'user-agent': 'UA', 'accept-language': 'fr' } });
  const cle = await cleDeCache(base);
  assert.match(cle, /^[0-9a-f]{64}$/);
  assert.equal(await cleDeCache(meme), cle);
  assert.notEqual(await cleDeCache(autreLangue), cle);
  assert.notEqual(await cleDeCache(autreRequete), cle);
  // Un en-tête interdit (cookie, authorization) n'est jamais transmis, donc jamais dans la clé.
  const avecCookie = validerDemande({ url: 'https://source-exemple.fr/recherche?q=voyage', method: 'GET', headers: { 'user-agent': 'UA', 'accept-language': 'fr', cookie: 'session=1', authorization: 'Bearer x' } });
  assert.equal(await cleDeCache(avecCookie), cle);
});

test('droits et garde inchangés : jeton de profil 403, adresse privée 400, même si la page est gardée', async () => {
  const f = fauxFetch();
  await appeler(RECHERCHE, { fetch: f });
  const profil = await appeler(RECHERCHE, { fetch: f, jeton: await jetonDeProfil(JETON, 'amilea0001') });
  assert.equal(profil.rep.status, 403);
  for (const url of ['http://127.0.0.1/recherche', 'http://192.168.1.1/', 'http://localhost/x', 'http://[::1]/']) {
    const r = await appeler({ url, method: 'GET', cache: { nature: 'recherche' } }, { fetch: f });
    assert.equal(r.rep.status, 400, url);
  }
  // Un nom qui résout vers une adresse privée : refusé (la vérification DNS précède toute lecture).
  const prive = await appeler({ url: 'https://rebond-exemple.fr/x', method: 'GET', cache: { nature: 'page' } }, { fetch: f, resoudre: async () => ['10.0.0.1'] });
  assert.equal(prive.rep.status, 400);
  assert.equal(f.appels.length, 1);
});

test('cache partagé : écrite avec sa durée, relue quand la mémoire de l’instance est vide', async () => {
  const cf = fauxCacheCf();
  const f = fauxFetch();
  const attentes = [];
  await appeler(RECHERCHE, { fetch: f, cache: cf, waitUntil: p => attentes.push(p) });
  assert.equal(attentes.length, 1, 'écriture confiée à waitUntil');
  await Promise.all(attentes);
  assert.equal(cf.m.size, 1);
  const [adresse, entree] = [...cf.m.entries()][0];
  assert.match(adresse, /^https:\/\/relais\.test\/__tsuzuku-cache\/v1\/[0-9a-f]{64}$/);
  assert.equal(new Headers(entree.entetes).get('cache-control'), 'public, max-age=900');
  cacheMemoireDuRelais.vider(); // Autre processus, même cache partagé.
  const b = await appeler(RECHERCHE, { fetch: f, cache: cf, maintenant: T0 + 5000 });
  assert.equal(b.json.cache, 'HIT');
  assert.equal(b.json.ageS, 5);
  cacheMemoireDuRelais.vider();
  const expire = await appeler(RECHERCHE, { fetch: f, cache: cf, maintenant: T0 + 900_000 });
  assert.equal(expire.json.cache, 'MISS');
  assert.equal(f.appels.length, 2);
});

test('cache mémoire borné : entrées et caractères, les plus anciennes partent d’abord', () => {
  const c = creerCacheMemoire({ entrees: 3, caracteres: 100 });
  for (const k of ['a', 'b', 'c', 'd']) c.ecrire(k, 'x'.repeat(10), 0, 10_000);
  assert.equal(c.taille(), 3);
  assert.equal(c.lire('a', 1), undefined);
  assert.ok(c.lire('d', 1));
  c.ecrire('gros', 'y'.repeat(95), 0, 10_000);
  assert.equal(c.lire('b', 1), undefined);
  assert.ok(c.lire('gros', 1));
  c.ecrire('trop', 'z'.repeat(101), 0, 10_000);
  assert.equal(c.lire('trop', 1), undefined);
  assert.equal(c.lire('gros', 10_000), undefined, 'expirée');
});
