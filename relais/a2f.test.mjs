/**
 * Validation en deux étapes vérifiée par le serveur (relais version 10, relais/a2f.mjs) : code exigé
 * après une preuve juste, fenêtre ±1, anti-rejeu, limite d'essais, secret chiffré, codes de récupération
 * gardés comme autre porte. Passe aussi par PostgreSQL (`npm run relais:tester:pg`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { relais, jetonDeProfil } from './relais.mjs';
import { coffresMemoire } from './coffres.mjs';
import { depuisBase32, pasValide } from './a2f.mjs';

const JETON = 'jeton-de-test-a2f-0123456789abcdef';
const sha = t => createHash('sha256').update(t).digest('hex');
const hex = (n, c = 'a') => c.repeat(n);
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
let ip = 0;

function kv() {
  const donnees = new Map();
  return {
    donnees,
    get: async c => (donnees.has(c) ? donnees.get(c) : null),
    put: async (c, v) => void donnees.set(c, v),
    delete: async c => void donnees.delete(c),
    list: async ({ prefix = '' } = {}) => ({ keys: [...donnees.keys()].filter(c => c.startsWith(prefix)).sort().map(name => ({ name })), list_complete: true }),
  };
}
const env0 = () => ({ JETON, BOITE: kv(), COFFRES: coffresMemoire() });
function appel(env, chemin, { methode = 'GET', jeton, corps } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Adresse-Client': `198.51.100.${++ip % 250}` };
  if (jeton) headers.Authorization = `Bearer ${jeton}`;
  return relais.traiter(new Request(`https://relais.test${chemin}`, { method: methode, headers, body: corps === undefined ? undefined : JSON.stringify(corps) }), env);
}
function totp(secret, decalage = 0, instant = Date.now()) {
  const t = Buffer.alloc(8);
  t.writeBigUInt64BE(BigInt(Math.floor(instant / 30_000) + decalage));
  const h = createHmac('sha1', Buffer.from(depuisBase32(secret))).update(t).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
const depotAcces = compte => ({ compte, sel: hex(32, '5'), kdf: { algorithme: 'argon2id', passes: 2, memoireKio: 19456, fils: 1, longueurCle: 32 }, verif: sha(hex(64, '1')), charge: 'abcdef0123' });
const H = hex(64, 'e');
const ouvrir = (env, code) => appel(env, `/acces/${H}/ouvrir`, { methode: 'POST', corps: { preuve: hex(64, '1'), ...(code === undefined ? {} : { code }) } });

/** Pas de 30 s sans risque de basculer pendant le test (sinon on attend le suivant). */
async function debutDePas() {
  const reste = 30_000 - (Date.now() % 30_000);
  if (reste < 4_000) await new Promise(ok => setTimeout(ok, reste + 50));
}

test('A2F : vecteur RFC 6238 (SHA-1) et fenêtre ±1 pas', async () => {
  // RFC 6238, annexe B : secret ASCII « 12345678901234567890 », T = 59 s → 94287082 (8 chiffres) → 287082.
  const secret = new TextEncoder().encode('12345678901234567890');
  assert.equal(await pasValide(secret, '287082', 59_000), 1);
  assert.equal(await pasValide(secret, '287082', 59_000 + 30_000), 1, 'pas précédent accepté');
  assert.equal(await pasValide(secret, '287082', 59_000 + 60_000), -1, 'deux pas plus tard : refusé');
  assert.equal(await pasValide(secret, '287082', 59_000, 1), -1, 'pas déjà servi : refusé');
  assert.equal(await pasValide(secret, '12a456', 59_000), -1);
});

test('A2F : activation (code exigé), secret chiffré côté serveur, état', async () => {
  const env = env0();
  assert.equal((await (await appel(env, '/v10/a2f/principal', { jeton: JETON })).json()).active, false);
  const faux = await appel(env, '/v10/a2f/principal', { methode: 'PUT', jeton: JETON, corps: { secret: SECRET, code: '000000' } });
  assert.equal(faux.status, 403, 'un code faux n’active rien');
  await debutDePas();
  const ok = await appel(env, '/v10/a2f/principal', { methode: 'PUT', jeton: JETON, corps: { secret: SECRET, code: totp(SECRET) } });
  assert.equal(ok.status, 200);
  assert.equal((await (await appel(env, '/v10/a2f/principal', { jeton: JETON })).json()).active, true);
  const brut = env.BOITE.donnees.get('a2f:principal');
  assert.ok(brut && !brut.includes(SECRET) && !brut.includes(Buffer.from(depuisBase32(SECRET)).toString('hex')), 'le secret n’est jamais rangé en clair');
  // Un ami ne touche pas à l'A2F du Fondateur ; il gère la sienne.
  const lea = await jetonDeProfil(JETON, 'lea12345');
  assert.equal((await appel(env, '/v10/a2f/principal', { jeton: lea })).status, 403);
  assert.equal((await appel(env, '/v10/a2f/lea12345', { jeton: lea })).status, 200);
});

test('A2F : connexion par identifiant — code demandé, code faux refusé, bon code accepté, code rejoué refusé', async () => {
  const env = env0();
  await appel(env, `/acces/${H}`, { methode: 'PUT', jeton: JETON, corps: depotAcces('principal') });
  await debutDePas();
  await appel(env, '/v10/a2f/principal', { methode: 'PUT', jeton: JETON, corps: { secret: SECRET, code: totp(SECRET, -1) } });
  // Bonne preuve, pas de code : ni charge, ni session.
  const sans = await ouvrir(env);
  assert.equal(sans.status, 403);
  const corpsSans = await sans.json();
  assert.equal(corpsSans.motif, 'a2f-requis');
  assert.equal(corpsSans.charge, undefined);
  assert.equal(corpsSans.jeton, undefined);
  // Mauvaise preuve : le code n'est même pas regardé (même réponse qu'avant).
  const mauvaise = await appel(env, `/acces/${H}/ouvrir`, { methode: 'POST', corps: { preuve: hex(64, '2'), code: totp(SECRET) } });
  assert.equal((await mauvaise.json()).motif, 'mot-de-passe');
  const faux = await ouvrir(env, totp(SECRET) === '123456' ? '654321' : '123456');
  assert.equal(faux.status, 403);
  assert.equal((await faux.json()).motif, 'a2f-code');
  const code = totp(SECRET);
  const bon = await ouvrir(env, code);
  assert.equal(bon.status, 200);
  const corps = await bon.json();
  assert.match(corps.jeton, /^s1\./);
  assert.equal(corps.charge, 'abcdef0123');
  const rejoue = await ouvrir(env, code);
  assert.equal(rejoue.status, 403, 'un code ne sert qu’une fois');
  assert.equal((await rejoue.json()).motif, 'a2f-code');
  // Le pas précédent (déjà dépassé) ne sert plus non plus.
  assert.equal((await (await ouvrir(env, totp(SECRET, -1))).json()).motif, 'a2f-code');
});

test('A2F : limite d’essais (5 libres, puis attente) ; codes de récupération sans code à six chiffres', async () => {
  const env = env0();
  const secours = { sel: hex(32, '7'), kdf: depotAcces('principal').kdf, entrees: [{ verif: sha(hex(64, '4')), charge: 'aa02' }] };
  await appel(env, `/acces/${H}`, { methode: 'PUT', jeton: JETON, corps: { ...depotAcces('principal'), secours } });
  await debutDePas();
  await appel(env, '/v10/a2f/principal', { methode: 'PUT', jeton: JETON, corps: { secret: SECRET, code: totp(SECRET) } });
  const juste = totp(SECRET, 1);
  const mauvais = ['000000', '111111', '222222', '333333', '444444', '555555'].filter(c => c !== juste && c !== totp(SECRET) && c !== totp(SECRET, -1));
  const statuts = [];
  for (const c of mauvais.slice(0, 5)) statuts.push((await ouvrir(env, c)).status);
  assert.deepEqual(statuts, [403, 403, 403, 403, 403]);
  const bloque = await ouvrir(env, juste);
  assert.equal(bloque.status, 429, 'même le bon code attend la fin du délai');
  assert.ok(Number(bloque.headers.get('Retry-After')) > 0);
  // Mot de passe oublié : un code de récupération ouvre sans code à six chiffres.
  const parSecours = await appel(env, `/acces/${H}/secours`, { methode: 'POST', corps: { preuve: hex(64, '4') } });
  assert.equal(parSecours.status, 200);
});

test('A2F : désactivation (code exigé du compte ; le Fondateur peut la retirer à un ami)', async () => {
  const env = env0();
  const lea = await jetonDeProfil(JETON, 'lea12345');
  await debutDePas();
  await appel(env, '/v10/a2f/lea12345', { methode: 'PUT', jeton: lea, corps: { secret: SECRET, code: totp(SECRET, -1) } });
  assert.equal((await appel(env, '/v10/a2f/lea12345', { methode: 'DELETE', jeton: lea, corps: { code: '000000' } })).status, 403);
  assert.equal((await appel(env, '/v10/a2f/lea12345', { methode: 'DELETE', jeton: lea, corps: { code: totp(SECRET) } })).status, 200);
  assert.equal((await (await appel(env, '/v10/a2f/lea12345', { jeton: lea })).json()).active, false);
  await appel(env, '/v10/a2f/lea12345', { methode: 'PUT', jeton: lea, corps: { secret: SECRET, code: totp(SECRET, 1) } });
  assert.equal((await appel(env, '/v10/a2f/lea12345', { methode: 'DELETE', jeton: JETON })).status, 200, 'téléphone perdu : le Fondateur la retire');
});
