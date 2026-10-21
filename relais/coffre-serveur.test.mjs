/**
 * Relais version 9 : coffre serveur des comptes, connexion du Fondateur par identifiant et mot de
 * passe (session), réponses neutres, style public, accès de secours.
 * Passe aussi par PostgreSQL (`npm run relais:tester:pg` : le magasin mémoire est remplacé).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import relais, { jetonDeProfil } from './worker.mjs';
import { coffresMemoire, decider } from './coffres.mjs';

const JETON = 'jeton-de-test-coffre-0123456789abcd';
const sha = t => createHash('sha256').update(t).digest('hex');
const hex = (n, c = 'a') => c.repeat(n);
let ipCompteur = 0;
const nouvelleIp = () => `192.0.2.${++ipCompteur % 250}`;

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

function appel(env, chemin, { methode = 'GET', jeton, corps, ip } = {}) {
  const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip ?? nouvelleIp() };
  if (jeton) headers.Authorization = `Bearer ${jeton}`;
  return relais.fetch(new Request(`https://relais.test${chemin}`, { method: methode, headers, body: corps === undefined ? undefined : JSON.stringify(corps) }), env);
}
const id = n => n.toString(16).padStart(32, '0');
const enr = (n, o = {}) => ({ id: id(n), base: 0, date: `2026-10-0${(n % 9) + 1}T10:00:00.000Z`, valeur: `chiffre-${n}`, ...o });

test('/sante annonce la version 9 et le coffre serveur', async () => {
  const corps = await (await appel(env0(), '/sante', { jeton: JETON })).json();
  assert.equal(corps.version, 9);
  for (const f of ['coffre-serveur', 'sessions', 'theme', 'acces-fondateur', 'secours']) assert.ok(corps.fonctions.includes(f), f);
});

test('coffre : écrire, relire par pages depuis une révision, rien en clair d’autre que ce qui est envoyé', async () => {
  const env = env0();
  const r = await appel(env, '/v9/coffre/principal', { methode: 'POST', jeton: JETON, corps: { enregistrements: [1, 2, 3, 4, 5].map(n => enr(n)) } });
  assert.equal(r.status, 200);
  const ecrit = await r.json();
  assert.equal(ecrit.rev, 5);
  assert.deepEqual(ecrit.resultats.map(x => x.etat), ['ok', 'ok', 'ok', 'ok', 'ok']);
  const p1 = await (await appel(env, '/v9/coffre/principal?depuis=0&limite=2', { jeton: JETON })).json();
  assert.equal(p1.enregistrements.length, 2);
  assert.equal(p1.suite, true);
  const p2 = await (await appel(env, `/v9/coffre/principal?depuis=${p1.enregistrements[1].rev}&limite=10`, { jeton: JETON })).json();
  assert.deepEqual(p2.enregistrements.map(e => e.valeur), ['chiffre-3', 'chiffre-4', 'chiffre-5']);
  assert.equal(p2.suite, false);
  const etat = await (await appel(env, '/v9/coffre/principal/etat', { jeton: JETON })).json();
  assert.equal(etat.enregistrements, 5);
});

test('coffre : conflit par enregistrement, le plus récent gagne, l’autre version va à l’historique (sans perte)', async () => {
  const env = env0();
  await appel(env, '/v9/coffre/principal', { methode: 'POST', jeton: JETON, corps: { enregistrements: [enr(1, { date: '2026-10-01T10:00:00.000Z', valeur: 'A0' })] } });
  // Appareil A modifie (base 1) ; appareil B, qui connaissait aussi la révision 1, modifie après coup avec une date PLUS ANCIENNE.
  const a = await (await appel(env, '/v9/coffre/principal', { methode: 'POST', jeton: JETON, corps: { enregistrements: [enr(1, { base: 1, date: '2026-10-02T10:00:00.000Z', valeur: 'A1' })] } })).json();
  assert.equal(a.resultats[0].etat, 'ok');
  const b = await (await appel(env, '/v9/coffre/principal', { methode: 'POST', jeton: JETON, corps: { enregistrements: [enr(1, { base: 1, date: '2026-10-01T12:00:00.000Z', valeur: 'B1' })] } })).json();
  assert.equal(b.resultats[0].etat, 'perdu');
  assert.equal(b.resultats[0].actuel.valeur, 'A1', 'B reçoit la version gardée');
  // B plus récent cette fois : il gagne, A1 part à l'historique.
  const b2 = await (await appel(env, '/v9/coffre/principal', { methode: 'POST', jeton: JETON, corps: { enregistrements: [enr(1, { base: 1, date: '2026-10-03T10:00:00.000Z', valeur: 'B2' })] } })).json();
  assert.equal(b2.resultats[0].etat, 'ok');
  // Suppression : l'ancienne valeur va dans la corbeille.
  await appel(env, '/v9/coffre/principal', { methode: 'POST', jeton: JETON, corps: { enregistrements: [enr(1, { base: b2.resultats[0].rev, date: '2026-10-04T10:00:00.000Z', supprime: true, valeur: 'pierre' })] } });
  const h = (await (await appel(env, '/v9/coffre/principal/historique', { jeton: JETON })).json()).historique;
  assert.deepEqual(h.map(x => [x.valeur, x.raison]), [
    ['B2', 'suppression'],
    ['A1', 'conflit'],
    ['B1', 'conflit'],
  ]);
  const tout = await (await appel(env, '/v9/coffre/principal', { jeton: JETON })).json();
  assert.equal(tout.enregistrements[0].supprime, true);
  assert.equal(decider({ rev: 3, date: 'b' }, { base: 1, date: 'b' }).issue, 'perdu', 'à date égale, ce qui existe est gardé');
});

test('coffre : portées (compte, autre compte, Fondateur, délégation, sans magasin)', async () => {
  const env = env0();
  const lea = await jetonDeProfil(JETON, 'lea12345');
  const hugo = await jetonDeProfil(JETON, 'hugo123456');
  assert.equal((await appel(env, '/v9/coffre/lea12345', { methode: 'POST', jeton: lea, corps: { enregistrements: [enr(1)] } })).status, 200);
  assert.equal((await appel(env, '/v9/coffre/lea12345', { jeton: hugo })).status, 403);
  assert.equal((await appel(env, '/v9/coffre/principal', { jeton: lea })).status, 403);
  assert.equal((await appel(env, '/v9/coffre/lea12345', { jeton: JETON })).status, 200);
  assert.equal((await appel(env, '/v9/coffre/lea12345')).status, 401);
  assert.equal((await appel(env, '/v9/coffre/lea12345', { methode: 'DELETE', jeton: lea })).status, 403);
  // Délégation d'un titulaire (rangs) : lecture et écriture, jamais suppression.
  await appel(env, '/rangs', { methode: 'PUT', jeton: JETON, corps: { delegations: { hugo123456: ['lea12345'] } } });
  assert.equal((await appel(env, '/v9/coffre/lea12345', { jeton: hugo })).status, 200);
  assert.equal((await appel(env, '/v9/coffre/lea12345', { methode: 'DELETE', jeton: hugo })).status, 403);
  assert.equal((await appel(env, '/v9/coffre/lea12345', { methode: 'DELETE', jeton: JETON })).status, 200);
  assert.equal((await (await appel(env, '/v9/coffre/lea12345', { jeton: JETON })).json()).enregistrements.length, 0);
  // Envoi illisible, trop d'enregistrements.
  assert.equal((await appel(env, '/v9/coffre/lea12345', { methode: 'POST', jeton: lea, corps: { enregistrements: [{ id: 'x' }] } })).status, 400);
  // Relais sans magasin (Worker Cloudflare) : 501, les appareils gardent l'ancienne synchronisation.
  const sans = { JETON, BOITE: kv() };
  const r = await appel(sans, '/v9/coffre/principal', { jeton: JETON });
  assert.equal(r.status, 501);
  assert.equal((await r.json()).motif, 'coffre-indisponible');
});

const depotAcces = (compte, o = {}) => ({
  compte,
  sel: hex(32, '5'),
  kdf: { algorithme: 'argon2id', passes: 2, memoireKio: 19456, fils: 1, longueurCle: 32 },
  verif: sha(hex(64, '1')),
  charge: 'abcdef0123',
  ...o,
});

test('Fondateur : accès par identifiant posé par lui seul ; la bonne preuve rend une SESSION (jamais le jeton maître)', async () => {
  const env = env0();
  const H = hex(64, 'e');
  const lea = await jetonDeProfil(JETON, 'lea12345');
  assert.equal((await appel(env, `/acces/${H}`, { methode: 'PUT', jeton: lea, corps: depotAcces('principal') })).status, 403);
  assert.equal((await appel(env, `/acces/${H}`, { methode: 'PUT', jeton: JETON, corps: depotAcces('principal') })).status, 200);
  const r = await appel(env, `/acces/${H}/ouvrir`, { methode: 'POST', corps: { preuve: hex(64, '1') } });
  assert.equal(r.status, 200);
  const corps = await r.json();
  assert.equal(corps.compte, 'principal');
  assert.match(corps.jeton, /^s1\.[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(corps).includes(JETON));
  assert.ok(![...env.BOITE.donnees.keys()].some(c => c.includes(corps.jeton)), 'le relais ne garde que l’empreinte');
  // La session ouvre le compte du Fondateur (et l'Esport la reconnaît comme compte principal).
  const sante = await (await appel(env, '/sante', { jeton: corps.jeton })).json();
  assert.equal(sante.portee, 'maitre');
  assert.equal((await appel(env, '/v9/coffre/principal', { jeton: corps.jeton })).status, 200);
  assert.equal((await appel(env, '/boite', { jeton: corps.jeton })).status, 200);
  const verif = await (await appel(env, '/jeton/verifier', { methode: 'POST', jeton: corps.jeton })).json();
  assert.deepEqual([verif.valide, verif.compte, verif.maitre], [true, 'principal', true]);
  // Mais pas l'export complet de la boîte.
  assert.equal((await appel(env, '/admin/boite', { jeton: corps.jeton })).status, 403);
  // Déconnexion : la session ne vaut plus rien.
  assert.equal((await appel(env, '/v9/sessions/courante', { methode: 'DELETE', jeton: corps.jeton })).status, 200);
  assert.equal((await appel(env, '/sante', { jeton: corps.jeton })).status, 401);
  // Toutes les sessions d'un coup (jeton maître).
  const s2 = (await (await appel(env, `/acces/${H}/ouvrir`, { methode: 'POST', corps: { preuve: hex(64, '1') } })).json()).jeton;
  assert.equal((await appel(env, '/sante', { jeton: s2 })).status, 200);
  assert.equal((await (await appel(env, '/v9/sessions', { methode: 'DELETE', jeton: JETON })).json()).fermees, 1);
  assert.equal((await appel(env, '/sante', { jeton: s2 })).status, 401);
  // Un ami ne reçoit pas de session (son jeton de profil est dans sa charge scellée).
});

test('identifiant déjà pris par un autre compte : 409, jamais réattribué en silence', async () => {
  const env = env0();
  const H = hex(64, 'f');
  await appel(env, '/invitations/' + hex(32, 'b'), {
    methode: 'PUT',
    jeton: JETON,
    corps: { profil: 'lea12345', expire: new Date(Date.now() + 86_400_000).toISOString(), charge: 'c', verif: sha('x'), acces: H },
  });
  const r = await appel(env, `/acces/${H}`, { methode: 'PUT', jeton: JETON, corps: depotAcces('principal') });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).motif, 'identifiant-pris');
});

test('accès de secours (code de récupération) : une preuve parmi les codes ouvre, les autres non', async () => {
  const env = env0();
  const H = hex(64, '9');
  const secours = { sel: hex(32, '7'), kdf: depotAcces('principal').kdf, entrees: [{ verif: sha(hex(64, '3')), charge: 'aa01' }, { verif: sha(hex(64, '4')), charge: 'aa02' }] };
  await appel(env, `/acces/${H}`, { methode: 'PUT', jeton: JETON, corps: depotAcces('principal', { secours }) });
  const lu = await (await appel(env, `/acces/${H}`)).json();
  assert.equal(lu.secours.sel, hex(32, '7'));
  const ok = await (await appel(env, `/acces/${H}/secours`, { methode: 'POST', corps: { preuve: hex(64, '4') } })).json();
  assert.deepEqual([ok.charge, ok.secours], ['aa02', 1]);
  assert.match(ok.jeton, /^s1\./);
  const faux = await appel(env, `/acces/${H}/secours`, { methode: 'POST', corps: { preuve: hex(64, '1') } });
  assert.equal(faux.status, 403, 'la preuve du mot de passe n’ouvre pas le secours');
});

test('style public : le nom du thème seulement ; identifiant inconnu = compte sans thème ; écrit par le compte seul', async () => {
  const env = env0();
  const H = hex(64, '8');
  const lea = await jetonDeProfil(JETON, 'lea12345');
  const hugo = await jetonDeProfil(JETON, 'hugo123456');
  await appel(env, '/invitations/' + hex(32, 'c'), {
    methode: 'PUT',
    jeton: JETON,
    corps: { profil: 'lea12345', expire: new Date(Date.now() + 86_400_000).toISOString(), charge: 'c', verif: sha('x'), acces: H },
  });
  await appel(env, `/acces/${H}`, { methode: 'PUT', jeton: lea, corps: depotAcces('lea12345') });
  const vide = await (await appel(env, `/v9/theme/${H}`)).json();
  const inconnu = await (await appel(env, `/v9/theme/${hex(64, '2')}`)).json();
  assert.deepEqual(vide, { theme: null });
  assert.deepEqual(inconnu, vide, 'même réponse neutre');
  assert.equal((await appel(env, `/v9/theme/${H}`, { methode: 'PUT', jeton: hugo, corps: { theme: 'sauge' } })).status, 403);
  assert.equal((await appel(env, `/v9/theme/${H}`, { methode: 'PUT', corps: { theme: 'sauge' } })).status, 401);
  assert.equal((await appel(env, `/v9/theme/${H}`, { methode: 'PUT', jeton: lea, corps: { theme: '<script>' } })).status, 400);
  assert.equal((await appel(env, `/v9/theme/${H}`, { methode: 'PUT', jeton: lea, corps: { theme: 'sauge' } })).status, 200);
  assert.deepEqual(await (await appel(env, `/v9/theme/${H}`)).json(), { theme: 'sauge' });
  // Débit borné par adresse.
  let dernier;
  for (let i = 0; i < 245; i++) dernier = await appel(env, `/v9/theme/${H}`, { ip: '198.51.100.250' });
  assert.equal(dernier.status, 429);
  // Accès retiré : le thème part avec.
  await appel(env, `/acces/${H}`, { methode: 'DELETE', jeton: JETON });
  assert.deepEqual(await (await appel(env, `/v9/theme/${H}`)).json(), { theme: null });
});
