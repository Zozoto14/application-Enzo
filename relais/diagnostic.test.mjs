/**
 * Connexions des membres « au hasard » refusées avec le bon mot de passe (docs/diagnostic-comptes.md) :
 * limites par adresse IP partagées entre processus et seuil adapté aux adresses partagées (Wi-Fi du
 * club, 4G CGNAT), adresse interne jamais limitée, compteur d'identifiant oublié après une heure,
 * journal des tentatives sans secret, diagnostic et « Débloquer » du Fondateur.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { relais, jetonDeProfil } from './relais.mjs';
import { adresseInterne, masquerIp, ESSAIS_LIBRES_IP } from './connexions.mjs';
import { diagnostiquer } from './serveur/diagnostic-connexions.mjs';
import { baseSqlite } from '../esport/adaptateurs/sqlite.mjs';

const JETON = 'jeton-de-test-diagnostic-0123456789';
const sha = t => createHash('sha256').update(t).digest('hex');
const hex = (n, c = 'a') => c.repeat(n);
const PREUVE = hex(64, '1');
const FAUSSE = hex(64, '2');

function kv() {
  const donnees = new Map();
  return {
    donnees,
    get: async c => (donnees.has(c) ? donnees.get(c) : null),
    put: async (c, v) => void donnees.set(c, v),
    delete: async c => void donnees.delete(c),
  };
}

function appel(env, chemin, { methode = 'GET', jeton, corps, ip = '198.51.100.7' } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Adresse-Client': ip };
  if (jeton) headers.Authorization = `Bearer ${jeton}`;
  return relais.traiter(new Request(`https://relais.test${chemin}`, { method: methode, headers, body: corps === undefined ? undefined : JSON.stringify(corps) }), env);
}

/** Un membre `compte` dont l'identifiant a l'empreinte `h` et le mot de passe la preuve PREUVE. */
async function membre(env, compte, h) {
  const jeton = await jetonDeProfil(JETON, compte);
  const id = sha(`inv-${compte}`).slice(0, 32);
  await appel(env, `/invitations/${id}`, { methode: 'PUT', jeton: JETON, corps: { profil: compte, expire: new Date(Date.now() + 7 * 86_400_000).toISOString(), charge: 'c', verif: sha(PREUVE), acces: h } });
  const r = await appel(env, `/acces/${h}`, { methode: 'PUT', jeton, corps: { compte, sel: hex(32, 'f'), kdf: { algorithme: 'argon2id', passes: 2, memoireKio: 19456, fils: 1, longueurCle: 32 }, verif: sha(PREUVE), charge: 'abcdef' } });
  assert.equal(r.status, 200);
}
const ouvrir = (env, h, preuve, ip) => appel(env, `/acces/${h}/ouvrir`, { methode: 'POST', corps: { preuve }, ip });

test('adresses : internes reconnues, masquage sans dernier octet', () => {
  for (const ip of ['', 'inconnue', '127.0.0.1', '::1', '10.2.3.4', '192.168.1.20', '172.20.0.5', '::ffff:127.0.0.1', 'fd12:3456::1']) assert.equal(adresseInterne(ip), true, ip);
  for (const ip of ['203.0.113.9', '2001:db8::1', '172.32.0.1']) assert.equal(adresseInterne(ip), false, ip);
  assert.equal(masquerIp('203.0.113.42'), '203.0.113.x');
  assert.equal(masquerIp('2001:db8:85a3::8a2e:370:7334'), '2001:db8:85a3:…');
});

test('Wi-Fi du club : les fautes de frappe des autres membres ne bloquent pas un membre qui a le bon mot de passe', async () => {
  const env = { JETON, BOITE: kv() };
  const club = '203.0.113.50';
  await membre(env, 'lea12345', hex(64, 'c'));
  // 20 membres qui se trompent chacun une fois, depuis la même adresse (avant : bloqués à partir du 10e échec).
  for (let i = 0; i < 20; i++) assert.equal((await ouvrir(env, sha(`autre-${i}`), FAUSSE, club)).status, 403);
  const r = await ouvrir(env, hex(64, 'c'), PREUVE, club);
  assert.equal(r.status, 200, 'le bon mot de passe passe');
  // Au-delà du seuil (vraie rafale), l'adresse attend.
  for (let i = 0; i < ESSAIS_LIBRES_IP; i++) await ouvrir(env, sha(`rafale-${i}`), FAUSSE, club);
  assert.equal((await ouvrir(env, hex(64, 'c'), PREUVE, club)).status, 429);
});

test('proxy sans X-Forwarded-For (adresse interne) : jamais un compteur commun à tous les comptes', async () => {
  const env = { JETON, BOITE: kv() };
  await membre(env, 'lea12345', hex(64, 'c'));
  for (let i = 0; i < 80; i++) await ouvrir(env, sha(`x-${i}`), FAUSSE, '127.0.0.1');
  assert.equal((await ouvrir(env, hex(64, 'c'), PREUVE, '127.0.0.1')).status, 200);
});

test('plusieurs processus Passenger : la limite d’une adresse vaut pour tous (boîte partagée), « Débloquer » aussi', async () => {
  const boite = kv();
  const processus1 = { JETON, BOITE: boite };
  const processus2 = { JETON, BOITE: boite };
  const ip = '203.0.113.77';
  await membre(processus1, 'lea12345', hex(64, 'c'));
  for (let i = 0; i < ESSAIS_LIBRES_IP + 1; i++) await ouvrir(i % 2 ? processus1 : processus2, sha(`p-${i}`), FAUSSE, ip);
  // Les deux processus voient la même chose (avant : chacun son compteur en mémoire, réponse au hasard).
  assert.equal((await ouvrir(processus1, hex(64, 'c'), PREUVE, ip)).status, 429);
  assert.equal((await ouvrir(processus2, hex(64, 'c'), PREUVE, ip)).status, 429);
  const diag = await (await appel(processus2, `/v10/diagnostic/connexions/lea12345?h=${hex(64, 'c')}`, { jeton: JETON })).json();
  assert.equal(diag.adresses.length, 1);
  assert.equal(diag.adresses[0].ip, '203.0.113.x');
  assert.ok(diag.adresses[0].jusqua > Date.now());
  assert.equal(diag.tentatives[0].issue, 'adresse-limitee');
  const deblocage = await appel(processus1, `/v10/diagnostic/connexions/lea12345?h=${hex(64, 'c')}`, { methode: 'DELETE', jeton: JETON });
  assert.equal(deblocage.status, 200);
  assert.ok((await deblocage.json()).leve >= 1);
  assert.equal((await ouvrir(processus2, hex(64, 'c'), PREUVE, ip)).status, 200, 'débloqué pour tous les processus');
});

test('identifiant : une faute de frappe par jour ne s’accumule plus (compteur oublié après une heure sans échec)', async () => {
  const env = { JETON, BOITE: kv() };
  const h = hex(64, 'c');
  await membre(env, 'lea12345', h);
  for (let i = 0; i < 4; i++) await ouvrir(env, h, FAUSSE, `203.0.113.${100 + i}`);
  // Deux heures plus tard (on vieillit le compteur), une nouvelle faute ne verrouille pas.
  const limite = JSON.parse(env.BOITE.donnees.get(`limite:acces:${h}`));
  env.BOITE.donnees.set(`limite:acces:${h}`, JSON.stringify({ ...limite, dernier: Date.now() - 2 * 3600_000 }));
  const r = await ouvrir(env, h, FAUSSE, '203.0.113.120');
  assert.equal(r.status, 403);
  assert.equal((await r.json()).restants, 4, 'compteur reparti de zéro');
  assert.equal((await ouvrir(env, h, PREUVE, '203.0.113.121')).status, 200);
});

test('journal des tentatives : codes précis, jamais de mot de passe, de preuve ni d’adresse complète ; Fondateur seulement', async () => {
  const env = { JETON, BOITE: kv() };
  const h = hex(64, 'c');
  await membre(env, 'lea12345', h);
  await ouvrir(env, h, FAUSSE, '203.0.113.9');
  await ouvrir(env, h, PREUVE, '203.0.113.9');
  await ouvrir(env, hex(64, 'd'), PREUVE, '203.0.113.9'); // identifiant inconnu (faute de frappe sur le prénom)
  await env.BOITE.put('revoque:lea12345', '1');
  await ouvrir(env, h, PREUVE, '203.0.113.9');
  const lea = await jetonDeProfil(JETON, 'lea12345');
  assert.equal((await appel(env, `/v10/diagnostic/connexions/lea12345?h=${h}`, { jeton: lea })).status, 403, 'pas pour le compte lui-même');
  const diag = await (await appel(env, `/v10/diagnostic/connexions/lea12345?h=${h}`, { jeton: JETON })).json();
  assert.deepEqual(diag.tentatives.map(t => t.issue), ['revoque', 'succes', 'mauvais-mot-de-passe']);
  assert.equal(diag.revoque, true);
  assert.equal(diag.inconnus.length, 1);
  const brut = [...env.BOITE.donnees.entries()].filter(([k]) => k.startsWith('journal-connexion:')).map(([, v]) => v).join('\n');
  assert.ok(!brut.includes(PREUVE) && !brut.includes(FAUSSE) && !brut.includes('203.0.113.9'), 'ni preuve ni adresse complète');
});

test('invitation expirée : notée au compte (le Fondateur voit pourquoi le lien « ne marche pas »)', async () => {
  const env = { JETON, BOITE: kv() };
  const id = hex(32, 'e');
  await appel(env, `/invitations/${id}`, { methode: 'PUT', jeton: JETON, corps: { profil: 'hugo123456', expire: new Date(Date.now() + 60_000).toISOString(), charge: 'c', verif: sha(PREUVE) } });
  const inv = JSON.parse(env.BOITE.donnees.get(`inv:${id}`));
  env.BOITE.donnees.set(`inv:${id}`, JSON.stringify({ ...inv, expire: Date.now() - 1 }));
  assert.equal((await appel(env, `/invitations/${id}`, { ip: '203.0.113.5' })).status, 410);
  const diag = await (await appel(env, '/v10/diagnostic/connexions/hugo123456', { jeton: JETON })).json();
  assert.equal(diag.tentatives[0].issue, 'invitation-expiree');
});

test('panne de la base pendant une connexion : « erreur-serveur » (503 explicite), pas « mot de passe incorrect »', { skip: process.env.RELAIS_TEST_PG || process.env.ESPORT_TEST_PG ? 'boîte remplacée par PostgreSQL' : false }, async () => {
  const boite = kv();
  const env = { JETON, BOITE: boite };
  const h = hex(64, 'c');
  await membre(env, 'lea12345', h);
  const enPanne = { ...boite, get: async c => (c.startsWith('acces:') ? Promise.reject(new Error('délai PostgreSQL dépassé')) : boite.get(c)) };
  const r = await ouvrir({ JETON, BOITE: enPanne }, h, PREUVE, '203.0.113.30');
  assert.equal(r.status, 503);
  assert.equal((await r.json()).motif, 'erreur-serveur');
});

test('Esport : jeton de profil refusé noté au compte qu’il annonce', async () => {
  const env = { JETON, BOITE: kv() };
  const forge = `p1.lea12345.${'0'.repeat(64)}`;
  await relais.traiter(new Request('https://relais.test/jeton/verifier', { method: 'POST', headers: { Authorization: `Bearer ${forge}`, 'X-Adresse-Client': '203.0.113.60' }, body: '{}' }), env);
  const diag = await (await appel(env, '/v10/diagnostic/connexions/lea12345', { jeton: JETON })).json();
  assert.equal(diag.tentatives[0].issue, 'jeton-refuse');
});

test('terminal cPanel : diagnostic-connexions.mjs résume verrous et tentatives sans secret, et sait tout débloquer', async () => {
  const env = { JETON, BOITE: kv() };
  const h = hex(64, 'c');
  await membre(env, 'lea12345', h);
  for (let i = 0; i < 6; i++) await ouvrir(env, h, FAUSSE, '203.0.113.88');
  const base = await baseSqlite(':memory:');
  await base.script('CREATE TABLE relais_kv (cle TEXT PRIMARY KEY, valeur TEXT NOT NULL, meta TEXT, expire_le BIGINT, maj_le BIGINT NOT NULL)');
  for (const [cle, valeur] of env.BOITE.donnees) await base.executer('INSERT INTO relais_kv (cle, valeur, expire_le, maj_le) VALUES (?, ?, NULL, 0)', [cle, valeur]);
  const lignes = [];
  const bilan = await diagnostiquer(base, { compte: 'lea12345', ecrire: l => lignes.push(l) });
  assert.equal(bilan.bloques, 1);
  assert.equal(bilan.parCause['mauvais-mot-de-passe'], 5);
  assert.equal(bilan.parCause.verrouille, 1);
  const texte = lignes.join('\n');
  assert.ok(!texte.includes('203.0.113.88') && texte.includes('203.0.113.x'));
  assert.ok(!texte.includes(PREUVE) && !texte.includes(JETON));
  await diagnostiquer(base, { toutDebloquer: true, ecrire: () => undefined });
  assert.equal((await base.tous("SELECT cle FROM relais_kv WHERE cle LIKE 'limite:%'", [])).length, 0);
});
