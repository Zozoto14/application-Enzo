/**
 * Boîte du relais dans PostgreSQL (relais/serveur/kv-postgres.mjs) : interface KV, expiration,
 * métadonnées, liste paginée par préfixe, et réparation de l'index du Worker par cette liste.
 * Lancé par `npm run relais:tester:pg` (sauté sans PostgreSQL).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { basePostgres } from '../../esport/adaptateurs/postgres.mjs';
import { creerTableKv, kvPostgres, purgerKvExpire } from '../serveur/kv-postgres.mjs';
import { importerBoite } from '../serveur/importer.mjs';

const URL_PG = process.env.RELAIS_TEST_PG || process.env.ESPORT_TEST_PG;
const options = { skip: URL_PG ? false : 'PostgreSQL absent (RELAIS_TEST_PG)' };

async function nouvelleBase() {
  const schema = `t_${randomBytes(8).toString('hex')}`;
  const admin = await basePostgres({ connexion: URL_PG, max: 1 });
  await admin.script(`CREATE SCHEMA ${schema}`);
  await admin.fermer();
  const base = await basePostgres({ connexion: URL_PG, schema, max: 3 });
  await creerTableKv(base);
  return base;
}

test('KV PostgreSQL : get, put (remplace), delete, métadonnées, json', options, async () => {
  const base = await nouvelleBase();
  const kv = kvPostgres(base);
  assert.equal(await kv.get('absente'), null);
  await kv.put('a', 'un', { metadata: { date: 'd', taille: 3 } });
  await kv.put('a', 'deux', { metadata: { date: 'e', taille: 4 } });
  assert.equal(await kv.get('a'), 'deux');
  assert.deepEqual(await kv.getWithMetadata('a'), { value: 'deux', metadata: { date: 'e', taille: 4 } });
  await kv.put('j', JSON.stringify({ x: 1 }));
  assert.deepEqual(await kv.get('j', 'json'), { x: 1 });
  assert.deepEqual(await kv.get('j', { type: 'json' }), { x: 1 });
  await kv.delete('a');
  assert.equal(await kv.get('a'), null);
  await base.fermer();
});

test('KV PostgreSQL : expiration (expirationTtl, expiration) puis purge', options, async () => {
  const base = await nouvelleBase();
  const horloge = { t: 1_800_000_000_000 };
  const kv = kvPostgres(base, { maintenant: () => horloge.t });
  await kv.put('ttl', 'v', { expirationTtl: 60 });
  await kv.put('abs', 'v', { expiration: horloge.t / 1000 + 120 });
  await kv.put('toujours', 'v');
  assert.equal(await kv.get('ttl'), 'v');
  horloge.t += 61_000;
  assert.equal(await kv.get('ttl'), null, 'expirée : plus jamais rendue');
  assert.equal(await kv.get('abs'), 'v');
  assert.deepEqual((await kv.list()).keys.map(k => k.name), ['abs', 'toujours']);
  assert.equal(typeof (await kv.list()).keys[0].expiration, 'number');
  horloge.t += 60_000;
  assert.equal(await purgerKvExpire(base, horloge.t), 2);
  assert.equal(await kv.get('toujours'), 'v');
  await base.fermer();
});

test('KV PostgreSQL : liste par préfixe exact (sensible à la casse, % et _ sans effet), pagination par curseur', options, async () => {
  const base = await nouvelleBase();
  const kv = kvPostgres(base);
  for (const c of ['appareil:b', 'appareil:a', 'appareil:c', 'Appareil:x', 'appareilXd', 'p:1:boite:z', 'appareil%']) await kv.put(c, c, { metadata: { date: c } });
  const p1 = await kv.list({ prefix: 'appareil:', limit: 2 });
  assert.deepEqual(p1.keys.map(k => k.name), ['appareil:a', 'appareil:b']);
  assert.equal(p1.list_complete, false);
  assert.deepEqual(p1.keys[0].metadata, { date: 'appareil:a' });
  const p2 = await kv.list({ prefix: 'appareil:', limit: 2, cursor: p1.cursor });
  assert.deepEqual(p2.keys.map(k => k.name), ['appareil:c']);
  assert.equal(p2.list_complete, true);
  assert.equal(p2.cursor, undefined);
  assert.deepEqual((await kv.list({ prefix: 'appareil%' })).keys.map(k => k.name), ['appareil%']);
  assert.equal((await kv.list()).keys.length, 7);
  await base.fermer();
});

test('Worker sur la boîte PostgreSQL : dépôts simultanés, index réparé depuis la liste', options, async () => {
  const { default: relais } = await import('../worker.mjs');
  const base = await nouvelleBase();
  const env = { JETON: 'jeton-de-test-0123456789abcdef', BOITE: kvPostgres(base) };
  const appeler = (chemin, init = {}) => relais.fetch(new Request(`https://relais.test${chemin}`, { ...init, headers: { Authorization: `Bearer ${env.JETON}` } }), env);
  const noms = ['pc000001', 'ip000002', 'si000003', 'ta000004', 'mc000005'];
  const enveloppe = n => JSON.stringify({ format: 'applibourse-relais', version: 1, appareil: n, date: '2026-09-26T10:00:00Z', charge: 'abcd' });
  await Promise.all(noms.map(n => appeler(`/boite/${n}`, { method: 'PUT', body: enveloppe(n) })));
  // Même si des écritures de l'index se sont croisées, la liste de la boîte le répare.
  await base.executer("UPDATE relais_kv SET valeur = '{}' WHERE cle = 'index'", []);
  const index = (await (await appeler('/boite')).json()).appareils;
  assert.deepEqual(Object.keys(index).sort(), [...noms].sort());
  assert.equal(index.pc000001.date, '2026-09-26T10:00:00Z');
  await base.fermer();
});

test('import de la boîte : clés, métadonnées et expirations ; clés déjà expirées ignorées ; rejouable', options, async () => {
  const base = await nouvelleBase();
  const t = Date.now();
  const cles = [
    { nom: 'appareil:pc000001', valeur: 'chiffre', metadata: { date: 'd', taille: 7 } },
    { nom: 'inv:abc', valeur: '{}', expiration: Math.floor(t / 1000) + 3600 },
    { nom: 'limite:vieille', valeur: '{}', expiration: Math.floor(t / 1000) - 10 },
  ];
  const bilan = await importerBoite(base, cles, { maintenant: t });
  assert.deepEqual(bilan, { ecrites: 2, expirees: 1, manquantes: [] });
  assert.deepEqual(await importerBoite(base, cles, { maintenant: t }), bilan, 'rejouable');
  const kv = kvPostgres(base);
  assert.deepEqual(await kv.getWithMetadata('appareil:pc000001'), { value: 'chiffre', metadata: { date: 'd', taille: 7 } });
  assert.equal((await kv.list({ prefix: 'inv:' })).keys[0].expiration, Math.floor(t / 1000) + 3600);
  await base.fermer();
});

test('coffre serveur PostgreSQL : révisions, pages bornées, conflits, corbeille, écritures concurrentes sérialisées', options, async () => {
  const { coffresPostgres, creerTablesCoffres, purgerHistoriqueCoffres } = await import('../serveur/coffres-postgres.mjs');
  const base = await nouvelleBase();
  await creerTablesCoffres(base);
  await creerTablesCoffres(base);
  const store = coffresPostgres(base);
  const id = n => n.toString(16).padStart(32, '0');
  const r1 = await store.ecrire('principal', [1, 2, 3].map(n => ({ id: id(n), base: 0, date: `2026-10-0${n}`, supprime: false, valeur: 'x'.repeat(10) })));
  assert.equal(r1.rev, 3);
  const page = await store.lire('principal', 0, 10, 15);
  assert.equal(page.enregistrements.length, 1, 'bornée en octets');
  assert.equal(page.suite, true);
  // Deux appareils écrivent en même temps sur des enregistrements différents : aucune révision en double.
  await Promise.all([4, 5, 6, 7, 8].map(n => store.ecrire('principal', [{ id: id(n), base: 0, date: '2026-10-09', supprime: false, valeur: 'v' }])));
  const tous = await store.lire('principal', 0, 100);
  assert.deepEqual(tous.enregistrements.map(e => e.rev), [1, 2, 3, 4, 5, 6, 7, 8]);
  // Conflit et suppression : rien n'est perdu.
  const perdu = await store.ecrire('principal', [{ id: id(1), base: 0, date: '2026-01-01', supprime: false, valeur: 'vieux' }]);
  assert.equal(perdu.resultats[0].etat, 'perdu');
  await store.ecrire('principal', [{ id: id(2), base: 2, date: '2026-10-10', supprime: true, valeur: 'tombe' }]);
  assert.deepEqual((await store.historique('principal')).map(h => h.raison), ['suppression', 'conflit']);
  // Une valeur de plusieurs Mio passe (TEXT).
  const gros = 'g'.repeat(3 * 1024 * 1024);
  await store.ecrire('lea12345', [{ id: id(9), base: 0, date: 'd', supprime: false, valeur: gros }]);
  assert.equal((await store.lire('lea12345')).enregistrements[0].valeur.length, gros.length);
  assert.deepEqual(await store.etat('lea12345'), { rev: 1, enregistrements: 1, octets: gros.length, historique: 0 });
  assert.equal(await purgerHistoriqueCoffres(base, Date.now() + 400 * 86_400_000), 2);
  await store.vider('lea12345');
  assert.equal((await store.lire('lea12345')).enregistrements.length, 0);
  await base.fermer();
});
