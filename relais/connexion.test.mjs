/**
 * Relais version 6 : invitations, accès par identifiant, révocations.
 * Matrice de sécurité : invitation volée réutilisée, force brute (identifiant
 * et adresse IP), jeton d'un ami sur un autre profil, usurpation d'identifiant,
 * compte révoqué.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import relais, { attenteApres, jetonDeProfil } from './worker.mjs';

const JETON = 'jeton-de-test-connexion-0123456789';
const sha = t => createHash('sha256').update(t).digest('hex');
const hex = (n, c = 'a') => c.repeat(n);
let ipCompteur = 0;
const nouvelleIp = () => `203.0.113.${++ipCompteur}`;

function kv() {
  const donnees = new Map();
  return {
    donnees,
    get: async c => (donnees.has(c) ? donnees.get(c) : null),
    put: async (c, v) => void donnees.set(c, v),
    delete: async c => void donnees.delete(c),
  };
}

function appel(env, chemin, { methode = 'GET', jeton, corps, ip } = {}) {
  const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip ?? '198.51.100.7' };
  if (jeton) headers.Authorization = `Bearer ${jeton}`;
  return relais.fetch(new Request(`https://relais.test${chemin}`, { method: methode, headers, body: corps === undefined ? undefined : JSON.stringify(corps) }), env);
}

const PREUVE = hex(64, '1');
const ID = hex(32, 'b');
const H = hex(64, 'c');
const invitation = (o = {}) => ({ profil: 'lea12345', expire: new Date(Date.now() + 7 * 86_400_000).toISOString(), charge: 'charge-scellee', verif: sha(PREUVE), acces: H, ...o });

test('/sante annonce la version 6 (ou plus) et ses fonctions', async () => {
  const env = { JETON, BOITE: kv() };
  const corps = await (await appel(env, '/sante', { jeton: JETON })).json();
  assert.ok(corps.version >= 6);
  assert.ok(corps.fonctions.includes('invitations') && corps.fonctions.includes('acces'));
});

test('invitation : seul le jeton maître la dépose ; l’ami la lit sans jeton, une seule fois', async () => {
  const env = { JETON, BOITE: kv() };
  const lea = await jetonDeProfil(JETON, 'lea12345');
  assert.equal((await appel(env, `/invitations/${ID}`, { methode: 'PUT', corps: invitation() })).status, 401);
  assert.equal((await appel(env, `/invitations/${ID}`, { methode: 'PUT', jeton: lea, corps: invitation() })).status, 403);
  assert.equal((await appel(env, `/invitations/${ID}`, { methode: 'PUT', jeton: JETON, corps: invitation() })).status, 200);
  // Rien en clair : le relais garde la charge scellée et l'empreinte de la preuve.
  assert.ok(![...env.BOITE.donnees.values()].some(v => String(v).includes(PREUVE)));
  const lue = await appel(env, `/invitations/${ID}`, { ip: nouvelleIp() });
  assert.equal(lue.status, 200);
  assert.equal((await lue.json()).charge, 'charge-scellee');
  // Mauvaise preuve : refusée, l'invitation reste valable.
  assert.equal((await appel(env, `/invitations/${ID}/utiliser`, { methode: 'POST', corps: { preuve: hex(64, '2') }, ip: nouvelleIp() })).status, 403);
  assert.equal((await appel(env, `/invitations/${ID}/utiliser`, { methode: 'POST', corps: { preuve: PREUVE }, ip: nouvelleIp() })).status, 200);
  // Invitation volée, rejouée après usage : 410 « utilisee », la charge a disparu.
  const rejouee = await appel(env, `/invitations/${ID}`, { ip: nouvelleIp() });
  assert.equal(rejouee.status, 410);
  assert.equal((await rejouee.json()).motif, 'utilisee');
  assert.ok(!String(env.BOITE.donnees.get(`inv:${ID}`)).includes('charge-scellee'));
  assert.equal((await appel(env, `/invitations/${ID}/utiliser`, { methode: 'POST', corps: { preuve: PREUVE }, ip: nouvelleIp() })).status, 410);
});

test('invitation : expirée, révoquée, remplacée par une nouvelle, inconnue', async () => {
  const env = { JETON, BOITE: kv() };
  const idA = hex(32, '3');
  const idB = hex(32, '4');
  await appel(env, `/invitations/${idA}`, { methode: 'PUT', jeton: JETON, corps: invitation() });
  // Renvoyer : la nouvelle invitation révoque l'ancienne.
  await appel(env, `/invitations/${idB}`, { methode: 'PUT', jeton: JETON, corps: invitation() });
  const ancienne = await appel(env, `/invitations/${idA}`, { ip: nouvelleIp() });
  assert.equal(ancienne.status, 410);
  assert.equal((await ancienne.json()).motif, 'revoquee');
  assert.equal((await appel(env, `/invitations/${idB}`, { ip: nouvelleIp() })).status, 200);
  await appel(env, `/invitations/${idB}`, { methode: 'DELETE', jeton: JETON });
  assert.equal((await (await appel(env, `/invitations/${idB}`, { ip: nouvelleIp() })).json()).motif, 'revoquee');
  // Expirée (date passée écrite directement dans la boîte).
  const idC = hex(32, '5');
  await appel(env, `/invitations/${idC}`, { methode: 'PUT', jeton: JETON, corps: invitation({ profil: 'hugo123456' }) });
  const brut = JSON.parse(env.BOITE.donnees.get(`inv:${idC}`));
  env.BOITE.donnees.set(`inv:${idC}`, JSON.stringify({ ...brut, expire: Date.now() - 1000 }));
  const expiree = await appel(env, `/invitations/${idC}`, { ip: nouvelleIp() });
  assert.equal(expiree.status, 410);
  assert.equal((await expiree.json()).motif, 'expiree');
  // Inconnue.
  const inconnue = await appel(env, `/invitations/${hex(32, '6')}`, { ip: nouvelleIp() });
  assert.equal(inconnue.status, 404);
  assert.equal((await inconnue.json()).motif, 'inconnue');
  // Dépôts refusés : expiration passée ou trop lointaine, compte invalide.
  for (const mauvais of [invitation({ expire: new Date(Date.now() - 1).toISOString() }), invitation({ expire: new Date(Date.now() + 200 * 86_400_000).toISOString() }), invitation({ profil: 'principal' }), invitation({ verif: 'x' })]) {
    assert.equal((await appel(env, `/invitations/${hex(32, '7')}`, { methode: 'PUT', jeton: JETON, corps: mauvais })).status, 400);
  }
});

test('code court : alias de l’invitation, consommé avec elle', async () => {
  const env = { JETON, BOITE: kv() };
  const court = hex(32, 'd');
  const preuveCourt = hex(64, '9');
  await appel(env, `/invitations/${ID}`, { methode: 'PUT', jeton: JETON, corps: invitation({ court: { id: court, charge: 'charge-courte', verif: sha(preuveCourt) } }) });
  assert.equal((await (await appel(env, `/invitations/${court}`, { ip: nouvelleIp() })).json()).charge, 'charge-courte');
  assert.equal((await appel(env, `/invitations/${court}/utiliser`, { methode: 'POST', corps: { preuve: preuveCourt }, ip: nouvelleIp() })).status, 200);
  assert.equal((await appel(env, `/invitations/${ID}`, { ip: nouvelleIp() })).status, 410);
  assert.equal((await appel(env, `/invitations/${court}`, { ip: nouvelleIp() })).status, 404);
});

test('force brute sur les invitations : délai progressif par adresse IP', async () => {
  const env = { JETON, BOITE: kv() };
  const ip = nouvelleIp();
  let statut = 0;
  for (let i = 0; i < 12; i++) statut = (await appel(env, `/invitations/${hex(31, 'e')}${i.toString(16)}`, { ip })).status;
  assert.equal(statut, 429);
  const r = await appel(env, `/invitations/${ID}`, { ip });
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers.get('Retry-After')) > 0);
  // Une autre adresse n'est pas bloquée.
  assert.equal((await appel(env, `/invitations/${hex(32, '0')}`, { ip: nouvelleIp() })).status, 404);
});

const depotAcces = (o = {}) => ({ compte: 'lea12345', sel: hex(32, 'f'), kdf: { algorithme: 'argon2id', passes: 2, memoireKio: 19456, fils: 1, longueurCle: 32 }, verif: sha(PREUVE), charge: 'abcdef0123', ...o });

test('accès par identifiant : déposé par SON compte seulement (identifiant attribué par le Fondateur)', async () => {
  const env = { JETON, BOITE: kv() };
  const lea = await jetonDeProfil(JETON, 'lea12345');
  const hugo = await jetonDeProfil(JETON, 'hugo123456');
  // Avant l'invitation : aucun identifiant attribué → refusé.
  assert.equal((await appel(env, `/acces/${H}`, { methode: 'PUT', jeton: lea, corps: depotAcces() })).status, 403);
  await appel(env, `/invitations/${ID}`, { methode: 'PUT', jeton: JETON, corps: invitation() });
  // Jeton d'un ami sur le profil d'un autre : refusé (compte ≠ jeton, identifiant d'un autre).
  assert.equal((await appel(env, `/acces/${H}`, { methode: 'PUT', jeton: hugo, corps: depotAcces() })).status, 403);
  assert.equal((await appel(env, `/acces/${H}`, { methode: 'PUT', jeton: hugo, corps: depotAcces({ compte: 'hugo123456' }) })).status, 403);
  assert.equal((await appel(env, `/acces/${H}`, { methode: 'PUT', jeton: lea, corps: depotAcces() })).status, 200);
  assert.equal((await appel(env, `/acces/${H}`, { methode: 'DELETE', jeton: hugo })).status, 403);
  // Lecture sans jeton : le sel et les paramètres seulement.
  const sel = await (await appel(env, `/acces/${H}`, { ip: nouvelleIp() })).json();
  assert.deepEqual(Object.keys(sel).sort(), ['kdf', 'secours', 'sel']);
  // Bonne preuve : la charge (scellée) ; mauvaise : 403.
  const ok = await appel(env, `/acces/${H}/ouvrir`, { methode: 'POST', corps: { preuve: PREUVE }, ip: nouvelleIp() });
  assert.deepEqual(await ok.json(), { compte: 'lea12345', charge: 'abcdef0123' });
  const faux = await appel(env, `/acces/${H}/ouvrir`, { methode: 'POST', corps: { preuve: hex(64, '2') }, ip: nouvelleIp() });
  assert.equal(faux.status, 403);
  assert.equal((await faux.json()).motif, 'mot-de-passe');
  // Identifiant inconnu (version 9) : réponse de même forme, sel stable, rien ne dit qu'il n'existe pas.
  const inconnu = await appel(env, `/acces/${hex(64, 'd')}`, { ip: nouvelleIp() });
  assert.equal(inconnu.status, 200);
  const leurre = await inconnu.json();
  assert.deepEqual(Object.keys(leurre).sort(), ['kdf', 'secours', 'sel']);
  assert.deepEqual(leurre, await (await appel(env, `/acces/${hex(64, 'd')}`, { ip: nouvelleIp() })).json(), 'sel stable');
  const ouvrirInconnu = await appel(env, `/acces/${hex(64, 'd')}/ouvrir`, { methode: 'POST', corps: { preuve: PREUVE }, ip: nouvelleIp() });
  assert.equal(ouvrirInconnu.status, 403);
  assert.equal((await ouvrirInconnu.json()).motif, 'mot-de-passe', 'même réponse qu’un mot de passe faux');
});

test('force brute sur un identifiant : délai progressif même en changeant d’adresse IP, levé par le bon mot de passe', async () => {
  const env = { JETON, BOITE: kv() };
  const lea = await jetonDeProfil(JETON, 'lea12345');
  await appel(env, `/invitations/${ID}`, { methode: 'PUT', jeton: JETON, corps: invitation() });
  await appel(env, `/acces/${H}`, { methode: 'PUT', jeton: lea, corps: depotAcces() });
  const statuts = [];
  for (let i = 0; i < 6; i++) statuts.push((await appel(env, `/acces/${H}/ouvrir`, { methode: 'POST', corps: { preuve: hex(64, '2') }, ip: nouvelleIp() })).status);
  assert.deepEqual(statuts, [403, 403, 403, 403, 403, 429]);
  // Même la bonne preuve attend la fin du délai (pas d'essai gratuit pendant le blocage).
  const bloque = await appel(env, `/acces/${H}/ouvrir`, { methode: 'POST', corps: { preuve: PREUVE }, ip: nouvelleIp() });
  assert.equal(bloque.status, 429);
  assert.ok(Number(bloque.headers.get('Retry-After')) >= 30);
  // Délai écoulé : la bonne preuve passe et remet le compteur à zéro.
  const limite = JSON.parse(env.BOITE.donnees.get(`limite:acces:${H}`));
  env.BOITE.donnees.set(`limite:acces:${H}`, JSON.stringify({ ...limite, jusqua: Date.now() - 1 }));
  assert.equal((await appel(env, `/acces/${H}/ouvrir`, { methode: 'POST', corps: { preuve: PREUVE }, ip: nouvelleIp() })).status, 200);
  assert.equal(env.BOITE.donnees.has(`limite:acces:${H}`), false);
  assert.equal(attenteApres(4, 5, 3600), 0);
  assert.equal(attenteApres(5, 5, 3600), 30);
  assert.equal(attenteApres(7, 5, 3600), 120);
  assert.equal(attenteApres(40, 5, 3600), 3600);
});

test('révocation : le jeton du compte ne vaut plus rien, ni son accès par identifiant ; levée, il revient', async () => {
  const env = { JETON, BOITE: kv() };
  const lea = await jetonDeProfil(JETON, 'lea12345');
  await appel(env, `/invitations/${ID}`, { methode: 'PUT', jeton: JETON, corps: invitation() });
  await appel(env, `/acces/${H}`, { methode: 'PUT', jeton: lea, corps: depotAcces() });
  assert.equal((await appel(env, '/revocations/lea12345', { methode: 'PUT', jeton: lea })).status, 403);
  assert.equal((await appel(env, '/revocations/lea12345', { methode: 'PUT', jeton: JETON })).status, 200);
  const r = await appel(env, '/p/lea12345/boite', { jeton: lea });
  assert.equal(r.status, 403);
  assert.equal((await r.json()).motif, 'revoque');
  // Version 9 : le sel reste neutre ; la révocation n'est dite qu'après une preuve juste.
  assert.equal((await appel(env, `/acces/${H}`, { ip: nouvelleIp() })).status, 200);
  const revoque = await appel(env, `/acces/${H}/ouvrir`, { methode: 'POST', corps: { preuve: PREUVE }, ip: nouvelleIp() });
  assert.equal(revoque.status, 403);
  assert.equal((await revoque.json()).motif, 'revoque');
  assert.equal((await appel(env, `/invitations/${ID}`, { ip: nouvelleIp() })).status, 410);
  // Les autres comptes et le jeton maître ne sont pas touchés.
  assert.equal((await appel(env, '/p/lea12345/boite', { jeton: JETON })).status, 200);
  assert.equal((await appel(env, '/p/hugo123456/boite', { jeton: await jetonDeProfil(JETON, 'hugo123456') })).status, 200);
  await appel(env, '/revocations/lea12345', { methode: 'DELETE', jeton: JETON });
  assert.equal((await appel(env, '/p/lea12345/boite', { jeton: lea })).status, 200);
});

test('compatibilité : les routes d’avant ne changent pas (jeton exigé, mêmes réponses)', async () => {
  const env = { JETON, BOITE: kv() };
  assert.equal((await appel(env, '/sante')).status, 401);
  assert.equal((await appel(env, '/p/lea12345/boite')).status, 401);
  assert.equal((await appel(env, '/boite', { jeton: await jetonDeProfil(JETON, 'lea12345') })).status, 403);
  assert.equal((await appel(env, '/boite', { jeton: JETON })).status, 200);
});
