/**
 * Relais version 8 : export de la boîte page par page (jeton maître seulement), repris par
 * relais/serveur/importer.mjs pour copier un relais vers une autre base.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relais, jetonDeProfil } from './relais.mjs';

const JETON = 'jeton-de-test-export-boite-0123456789';

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
  relais.traiter(new Request(`https://relais.test${chemin}`, { method: methode, headers: jeton ? { Authorization: `Bearer ${jeton}` } : {}, body: corps }), env);

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
