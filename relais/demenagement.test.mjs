/**
 * Relais version 8 : déménagement vers o2switch (docs/o2switch.md). Export de la boîte page par page
 * (jeton maître seulement) ; mode transmission RELAIS_CIBLE (tout part vers le nouveau relais).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import relais, { jetonDeProfil } from './worker.mjs';

const JETON = 'jeton-de-test-demenagement-0123456789';

function kvListable() {
  const donnees = new Map();
  const metas = new Map();
  return {
    donnees,
    metas,
    get: async c => (donnees.has(c) ? donnees.get(c) : null),
    put: async (c, v, o) => {
      donnees.set(c, v);
      if (o?.metadata) metas.set(c, o.metadata);
    },
    delete: async c => void donnees.delete(c),
    list: async ({ cursor, limit = 1000 } = {}) => {
      const toutes = [...donnees.keys()].sort();
      const debut = cursor ? Number(cursor) : 0;
      const n = Math.min(limit, 3);
      const page = toutes.slice(debut, debut + n);
      const fin = debut + n >= toutes.length;
      return { keys: page.map(name => ({ name, ...(metas.has(name) ? { metadata: metas.get(name) } : {}), ...(name.startsWith('inv:') ? { expiration: 1_900_000_000 } : {}) })), list_complete: fin, cursor: fin ? undefined : String(debut + n) };
    },
  };
}

const appel = (env, chemin, { jeton = JETON, methode = 'GET', corps } = {}) =>
  relais.fetch(new Request(`https://relais.test${chemin}`, { method: methode, headers: jeton ? { Authorization: `Bearer ${jeton}` } : {}, body: corps }), env);

test('export de la boîte : toutes les clés, valeurs, métadonnées et expirations, page par page ; jeton maître seulement', async () => {
  const env = { JETON, BOITE: kvListable() };
  for (let i = 0; i < 7; i++) await env.BOITE.put(`appareil:pc00000${i}`, `enveloppe-${i}`, { metadata: { date: 'd', taille: i } });
  await env.BOITE.put('inv:abc', '{"x":1}');
  const cles = [];
  let suite = null;
  let pages = 0;
  do {
    const r = await appel(env, `/admin/boite${suite ? `?curseur=${suite}` : ''}`);
    assert.equal(r.status, 200);
    const corps = await r.json();
    cles.push(...corps.cles);
    suite = corps.suite;
    pages++;
  } while (suite);
  // Sous `npm run relais:tester:pg`, la boîte est PostgreSQL (pages de 100, sans expiration pour ces clés posées à la main).
  const SOUS_PG = Boolean(process.env.RELAIS_TEST_PG);
  if (!SOUS_PG) assert.equal(pages, 3);
  assert.equal(cles.length, 8);
  assert.deepEqual(cles.find(c => c.nom === 'appareil:pc000003'), { nom: 'appareil:pc000003', valeur: 'enveloppe-3', metadata: { date: 'd', taille: 3 } });
  assert.deepEqual(cles.find(c => c.nom === 'inv:abc'), { nom: 'inv:abc', valeur: '{"x":1}', ...(SOUS_PG ? {} : { expiration: 1_900_000_000 }) });
  assert.equal((await appel(env, '/admin/boite', { jeton: await jetonDeProfil(JETON, 'lea12345') })).status, 403);
  assert.equal((await appel(env, '/admin/boite', { jeton: null })).status, 401);
  assert.equal((await appel(env, '/admin/boite', { methode: 'POST' })).status, 405);
});

test('mode transmission : chaque requête (avec ou sans jeton, préliminaire compris) part vers RELAIS_CIBLE, adresse annoncée', async () => {
  const recues = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    recues.push({ url: String(url), methode: init.method, auth: new Headers(init.headers).get('Authorization'), xff: new Headers(init.headers).get('X-Forwarded-For'), corps: init.body ? new TextDecoder().decode(init.body) : undefined });
    return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  };
  try {
    const env = { JETON, BOITE: kvListable(), RELAIS_CIBLE: 'https://relais.appdashboard.fr/', SITE_CIBLE: 'https://appdashboard.fr' };
    const r = await relais.fetch(new Request('https://relais.test/boite/pc000001?v=2', { method: 'PUT', headers: { Authorization: `Bearer ${JETON}`, 'X-Forwarded-For': '203.0.113.9' }, body: 'enveloppe' }), env);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('X-Relais-Deplace'), 'https://relais.appdashboard.fr');
    assert.equal(r.headers.get('X-Site-Deplace'), 'https://appdashboard.fr');
    assert.match(r.headers.get('Access-Control-Expose-Headers'), /X-Relais-Deplace, X-Site-Deplace/);
    await relais.fetch(new Request('https://relais.test/tsuzuku/requete', { method: 'OPTIONS', headers: { Origin: 'https://appdashboard.fr' } }), env);
    await relais.fetch(new Request('https://relais.test/jeton/verifier', { method: 'POST', body: '{}' }), env);
    assert.deepEqual(recues.map(x => [x.url, x.methode]), [
      ['https://relais.appdashboard.fr/boite/pc000001?v=2', 'PUT'],
      ['https://relais.appdashboard.fr/tsuzuku/requete', 'OPTIONS'],
      ['https://relais.appdashboard.fr/jeton/verifier', 'POST'],
    ]);
    assert.equal(recues[0].auth, `Bearer ${JETON}`);
    assert.equal(recues[0].xff, '203.0.113.9');
    assert.equal(recues[0].corps, 'enveloppe');
    assert.equal(env.BOITE.donnees.size, 0, 'rien n’est écrit sur Cloudflare');
    // Cible invalide : relais normal.
    const normal = await appel({ JETON, BOITE: kvListable(), RELAIS_CIBLE: 'http://pirate.exemple' }, '/sante');
    assert.equal((await normal.json()).version, 9);
  } finally {
    globalThis.fetch = original;
  }
});
