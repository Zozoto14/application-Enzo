/**
 * Relais version 7 : `POST /jeton/verifier`, appelé par le Worker Esport
 * (liaison de service). Rétrocompatible : les routes existantes ne changent pas.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import relais, { FONCTIONS_RELAIS, VERSION_RELAIS, jetonDeProfil } from './worker.mjs';

const JETON = 'jeton-de-test-verification-0123456789';
let ip = 0;

function kv() {
  const donnees = new Map();
  return { donnees, get: async c => (donnees.has(c) ? donnees.get(c) : null), put: async (c, v) => void donnees.set(c, v), delete: async c => void donnees.delete(c) };
}

async function verifier(env, jeton, { methode = 'POST', adresse } = {}) {
  const headers = { 'CF-Connecting-IP': adresse ?? `198.51.100.${++ip}` };
  if (jeton !== undefined) headers.Authorization = `Bearer ${jeton}`;
  const r = await relais.fetch(new Request('https://relais.test/jeton/verifier', { method: methode, headers, body: methode === 'POST' ? '{}' : undefined }), env);
  return { statut: r.status, corps: await r.json() };
}

test('version 7 annoncée, avec la fonction verification-jeton', async () => {
  assert.ok(VERSION_RELAIS >= 7);
  assert.ok(FONCTIONS_RELAIS.includes('verification-jeton'));
  const r = await relais.fetch(new Request('https://relais.test/sante', { headers: { Authorization: `Bearer ${JETON}` } }), { JETON, BOITE: kv() });
  const corps = await r.json();
  assert.equal(corps.version, VERSION_RELAIS);
});

test('jeton maître : valide, compte « principal », maître', async () => {
  const { statut, corps } = await verifier({ JETON, BOITE: kv() }, JETON);
  assert.equal(statut, 200);
  assert.deepEqual({ valide: corps.valide, revoque: corps.revoque, compte: corps.compte, maitre: corps.maitre }, { valide: true, revoque: false, compte: 'principal', maitre: true });
});

test('jeton de profil : valide, compte de l’ami, pas maître ; révoqué si le Fondateur l’a révoqué', async () => {
  const env = { JETON, BOITE: kv() };
  const lea = await jetonDeProfil(JETON, 'lea12345');
  let r = await verifier(env, lea);
  assert.deepEqual([r.corps.valide, r.corps.revoque, r.corps.compte, r.corps.maitre], [true, false, 'lea12345', false]);
  await env.BOITE.put('revoque:lea12345', '1');
  r = await verifier(env, lea);
  assert.equal(r.statut, 200);
  assert.deepEqual([r.corps.valide, r.corps.revoque, r.corps.compte], [true, true, 'lea12345']);
});

test('jeton faux, forgé ou absent : non valide, sans compte', async () => {
  const env = { JETON, BOITE: kv() };
  const forge = `p1.lea12345.${'0'.repeat(64)}`;
  for (const jeton of [undefined, '', 'nimporte-quoi-0123456789', forge, await jetonDeProfil('autre-jeton-maitre-0123456789', 'lea12345')]) {
    const r = await verifier(env, jeton);
    assert.equal(r.statut, 200);
    assert.equal(r.corps.valide, false);
    assert.equal(r.corps.compte, undefined);
  }
});

test('anti-force brute : trop d’échecs depuis une adresse → 429', async () => {
  const env = { JETON, BOITE: kv() };
  let dernier;
  for (let i = 0; i < 12; i++) dernier = await verifier(env, `faux-jeton-${i}-0123456789abcdef`, { adresse: '203.0.113.250' });
  assert.equal(dernier.statut, 429);
  // Une autre adresse n'est pas touchée.
  assert.equal((await verifier(env, JETON, { adresse: '203.0.113.251' })).corps.valide, true);
});

test('GET refusé (405) ; routes existantes inchangées (401 sans jeton)', async () => {
  const env = { JETON, BOITE: kv() };
  assert.equal((await verifier(env, JETON, { methode: 'GET' })).statut, 405);
  const r = await relais.fetch(new Request('https://relais.test/sante'), env);
  assert.equal(r.status, 401);
});
