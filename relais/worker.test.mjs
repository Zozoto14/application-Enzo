import { test } from 'node:test';
import assert from 'node:assert/strict';
import relais, { jetonDeProfil, jetonValide, porteeDuJeton } from './worker.mjs';

const JETON = 'jeton-de-test-0123456789abcdef';

function kvMemoire({ sansListe = false } = {}) {
  const donnees = new Map();
  const metas = new Map();
  const kv = {
    donnees,
    get: async cle => (donnees.has(cle) ? donnees.get(cle) : null),
    put: async (cle, valeur, options) => {
      donnees.set(cle, valeur);
      if (options?.metadata) metas.set(cle, options.metadata);
      else metas.delete(cle);
    },
    delete: async cle => {
      donnees.delete(cle);
      metas.delete(cle);
    },
  };
  if (!sansListe) {
    // Pages de deux clés : la pagination (curseur) est exercée.
    kv.list = async ({ prefix = '', cursor } = {}) => {
      const toutes = [...donnees.keys()].filter(c => c.startsWith(prefix)).sort();
      const debut = cursor ? Number(cursor) : 0;
      const page = toutes.slice(debut, debut + 2);
      const fin = debut + 2 >= toutes.length;
      return { keys: page.map(name => ({ name, metadata: metas.get(name) })), list_complete: fin, cursor: fin ? undefined : String(debut + 2) };
    };
  }
  return kv;
}

const appeler = (env, chemin, options = {}) =>
  relais.fetch(
    new Request(`https://relais.test${chemin}`, {
      ...options,
      headers: { Authorization: `Bearer ${JETON}`, ...(options.headers ?? {}) },
    }),
    env,
  );

const enveloppe = (appareil, date = '2026-09-26T10:00:00Z') =>
  JSON.stringify({ format: 'applibourse-relais', version: 1, appareil, date, charge: 'abcd' });

test('refuse sans le bon jeton', async () => {
  const env = { JETON, BOITE: kvMemoire() };
  const sans = await relais.fetch(new Request('https://relais.test/sante'), env);
  assert.equal(sans.status, 401);
  const faux = await appeler(env, '/sante', { headers: { Authorization: 'Bearer autre-jeton-0123456789ab' } });
  assert.equal(faux.status, 401);
  assert.equal((await appeler(env, '/sante')).status, 200);
});

test('un jeton trop court ne vaut rien, même identique', () => {
  assert.equal(jetonValide('court', 'court'), false);
  assert.equal(jetonValide(JETON, JETON), true);
  assert.equal(jetonValide(JETON.slice(0, -1), JETON), false);
});

test('répond au prévol CORS sans jeton', async () => {
  const r = await relais.fetch(new Request('https://relais.test/boite', { method: 'OPTIONS' }), { JETON });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), '*');
});

test('dépose, liste, relit et oublie un appareil', async () => {
  const env = { JETON, BOITE: kvMemoire() };
  assert.equal((await appeler(env, '/boite/pc123456', { method: 'PUT', body: enveloppe('pc123456') })).status, 200);
  assert.equal((await appeler(env, '/boite/ip987654', { method: 'PUT', body: enveloppe('ip987654', '2026-09-27T08:00:00Z') })).status, 200);

  const index = await (await appeler(env, '/boite')).json();
  assert.deepEqual(Object.keys(index.appareils).sort(), ['ip987654', 'pc123456']);
  assert.equal(index.appareils.ip987654.date, '2026-09-27T08:00:00Z');

  const relu = await (await appeler(env, '/boite/pc123456')).json();
  assert.equal(relu.appareil, 'pc123456');

  assert.equal((await appeler(env, '/boite/pc123456', { method: 'DELETE' })).status, 200);
  assert.equal((await appeler(env, '/boite/pc123456')).status, 404);
  assert.deepEqual(Object.keys((await (await appeler(env, '/boite')).json()).appareils), ['ip987654']);
});

test('refuse ce qui n’est pas une enveloppe, ou une enveloppe au mauvais nom', async () => {
  const env = { JETON, BOITE: kvMemoire() };
  assert.equal((await appeler(env, '/boite/pc123456', { method: 'PUT', body: '{"a":1}' })).status, 400);
  assert.equal((await appeler(env, '/boite/pc123456', { method: 'PUT', body: enveloppe('autre123') })).status, 400);
  assert.equal((await appeler(env, '/boite/..%2Fx', { method: 'PUT', body: enveloppe('..%2Fx') })).status, 400);
  assert.equal(env.BOITE.donnees.size, 0);
});

test('la passerelle refuse les adresses hors liste', async () => {
  const env = { JETON, BOITE: kvMemoire() };
  const yahoo = await appeler(env, '/yahoo/json', { method: 'POST', body: JSON.stringify({ url: 'https://evil.example/v8/finance/chart/X' }) });
  assert.equal(yahoo.status, 403);
  const flux = await appeler(env, '/medias/flux', { method: 'POST', body: JSON.stringify({ url: 'https://evil.example/rss' }) });
  assert.equal(flux.status, 403);
  const page = await appeler(env, '/medias/page', { method: 'POST', body: JSON.stringify({ url: 'http://lemonde.fr/x' }) });
  assert.equal(page.status, 403);
});

// ------------------------------------------------------------------ Portées

const avec = (env, jeton, chemin, options = {}) =>
  relais.fetch(new Request(`https://relais.test${chemin}`, { ...options, headers: { Authorization: `Bearer ${jeton}` } }), env);

test('jeton de profil : dérivé du jeton maître, propre au compte, jamais pour principal', async () => {
  const a = await jetonDeProfil(JETON, 'ami001');
  assert.match(a, /^p1\.ami001\.[0-9a-f]{64}$/);
  assert.notEqual(a, await jetonDeProfil(JETON, 'ami002'));
  assert.notEqual(a, await jetonDeProfil('autre-jeton-maitre-0123456789', 'ami001'));
  assert.deepEqual(await porteeDuJeton(a, JETON), { profil: 'ami001' });
  assert.deepEqual(await porteeDuJeton(JETON, JETON), { maitre: true });
  // Signature d'un autre compte recollée sous un autre identifiant : refusée.
  assert.equal(await porteeDuJeton(a.replace('ami001', 'ami002'), JETON), undefined);
  const principal = await jetonDeProfil(JETON, 'principal');
  assert.equal(await porteeDuJeton(principal, JETON), undefined);
  assert.equal(await porteeDuJeton(a, undefined), undefined);
});

test('un jeton de profil lit et écrit SON espace, et rien d’autre', async () => {
  const env = { JETON, BOITE: kvMemoire() };
  const ami = await jetonDeProfil(JETON, 'ami001');
  const autre = await jetonDeProfil(JETON, 'ami002');
  const sante = await (await avec(env, ami, '/sante')).json();
  assert.equal(sante.portee, 'profil');
  assert.equal(sante.profil, 'ami001');

  assert.equal((await avec(env, ami, '/p/ami001/boite/coffre', { method: 'PUT', body: enveloppe('coffre') })).status, 200);
  assert.equal((await avec(env, ami, '/p/ami001/boite/coffre')).status, 200);
  const liste = await (await avec(env, ami, '/p/ami001/boite')).json();
  assert.deepEqual(Object.keys(liste.objets), ['coffre']);
  assert.equal(liste.objets.coffre.date, '2026-09-26T10:00:00Z');

  // Refus croisés : l'autre ami ne lit, n'écrit ni ne supprime rien ici (403, existant ou non).
  assert.equal((await avec(env, autre, '/p/ami001/boite/coffre')).status, 403);
  assert.equal((await avec(env, autre, '/p/ami001/boite/absent')).status, 403);
  assert.equal((await avec(env, autre, '/p/ami001/boite')).status, 403);
  assert.equal((await avec(env, autre, '/p/ami001/boite/coffre', { method: 'PUT', body: enveloppe('coffre') })).status, 403);
  assert.equal((await avec(env, autre, '/p/ami001/boite/coffre', { method: 'DELETE' })).status, 403);
  assert.ok(env.BOITE.donnees.has('p:ami001:coffre'));

  // Ni l'espace de l'administrateur (annuaire), ni les routes historiques.
  assert.equal((await avec(env, JETON, '/p/principal/boite/annuaire', { method: 'PUT', body: enveloppe('annuaire') })).status, 200);
  assert.equal((await avec(env, ami, '/p/principal/boite/annuaire')).status, 403);
  assert.equal((await avec(env, ami, '/p/principal/boite')).status, 403);
  assert.equal((await avec(env, ami, '/boite')).status, 403);
  assert.equal((await avec(env, ami, '/boite/coffre')).status, 403);
  assert.equal((await avec(env, ami, '/boite/pc123456', { method: 'PUT', body: enveloppe('pc123456') })).status, 403);
});

test('le jeton maître a tous les droits sur tous les espaces', async () => {
  const env = { JETON, BOITE: kvMemoire() };
  const ami = await jetonDeProfil(JETON, 'ami001');
  await avec(env, ami, '/p/ami001/boite/portefeuille', { method: 'PUT', body: enveloppe('portefeuille') });
  assert.equal((await avec(env, JETON, '/p/ami001/boite/portefeuille')).status, 200);
  assert.equal((await avec(env, JETON, '/p/ami001/boite/coffre', { method: 'PUT', body: enveloppe('coffre') })).status, 200);
  assert.equal((await avec(env, JETON, '/p/ami001/boite/portefeuille', { method: 'DELETE' })).status, 200);
  assert.equal((await avec(env, ami, '/p/ami001/boite/portefeuille')).status, 404);
  assert.deepEqual(Object.keys((await (await avec(env, JETON, '/p/ami001/boite')).json()).objets), ['coffre']);
});

test('espaces : noms et identifiants validés, enveloppe au bon nom', async () => {
  const env = { JETON, BOITE: kvMemoire() };
  assert.equal((await avec(env, JETON, '/p/AMI/boite/coffre')).status, 400);
  assert.equal((await avec(env, JETON, '/p/ami001/boite/..%2Fx')).status, 400);
  assert.equal((await avec(env, JETON, '/p/ami001/boite/coffre', { method: 'PUT', body: enveloppe('autre') })).status, 400);
  assert.equal(env.BOITE.donnees.size, 0);
});

test('course sur l’index : réparé depuis la liste de la boîte, au plus une fois par heure', async () => {
  const kv = kvMemoire();
  let listes = 0;
  const lister = kv.list;
  kv.list = async o => {
    listes++;
    return lister(o);
  };
  const env = { JETON, BOITE: kv };
  const noms = ['pc000001', 'ip000002', 'si000003', 'ta000004', 'mc000005'];
  // Dépôts simultanés : les lectures-modifications-écritures de l'index s'écrasent.
  await Promise.all(noms.map(n => appeler(env, `/boite/${n}`, { method: 'PUT', body: enveloppe(n) })));
  const perdus = noms.filter(n => !(n in JSON.parse(kv.donnees.get('index'))));
  assert.ok(perdus.length > 0, 'la course se produit bien dans ce test');
  const index = (await (await appeler(env, '/boite')).json()).appareils;
  assert.deepEqual(Object.keys(index).sort(), [...noms].sort());
  assert.equal(index.pc000001.date, '2026-09-26T10:00:00Z');
  assert.equal('~repare' in index, false);
  assert.equal(listes, 3, 'une réparation (5 clés, pages de 2)');
  await appeler(env, '/boite');
  await appeler(env, '/boite');
  assert.equal(listes, 3, 'pas de nouvelle liste dans l’heure');
});

test('compatibilité : les dépôts d’avant (ancien index, sans métadonnées) restent listés', async () => {
  const kv = kvMemoire();
  await kv.put('appareil:ancien01', enveloppe('ancien01', '2026-01-01T00:00:00Z'));
  await kv.put('index', JSON.stringify({ ancien01: { date: '2026-01-01T00:00:00Z', taille: 10 }, parti001: { date: '2026-01-01T00:00:00Z', taille: 1 } }));
  const env = { JETON, BOITE: kv };
  await appeler(env, '/boite/nouveau1', { method: 'PUT', body: enveloppe('nouveau1') });
  const index = (await (await appeler(env, '/boite')).json()).appareils;
  assert.deepEqual(Object.keys(index).sort(), ['ancien01', 'nouveau1']);
  assert.equal(index.ancien01.date, '2026-01-01T00:00:00Z');
  await appeler(env, '/boite/ancien01', { method: 'DELETE' });
  assert.deepEqual(Object.keys((await (await appeler(env, '/boite')).json()).appareils), ['nouveau1']);
  // Boîte sans liste : l'index tenu à chaque dépôt suffit.
  const vieil = { JETON, BOITE: kvMemoire({ sansListe: true }) };
  await appeler(vieil, '/boite/pc123456', { method: 'PUT', body: enveloppe('pc123456') });
  assert.deepEqual(Object.keys((await (await appeler(vieil, '/boite')).json()).appareils), ['pc123456']);
});

test('la passerelle reste ouverte aux jetons de profil (site d’un ami)', async () => {
  const env = { JETON, BOITE: kvMemoire() };
  const ami = await jetonDeProfil(JETON, 'ami001');
  const r = await avec(env, ami, '/yahoo/json', { method: 'POST', body: JSON.stringify({ url: 'https://evil.example/x' }) });
  assert.equal(r.status, 403);
  const faux = `p1.ami001.${'0'.repeat(64)}`;
  assert.equal((await avec(env, faux, '/sante')).status, 401);
});

test('rangs : un titulaire délégué n’atteint que le coffre et le portefeuille des comptes inférieurs publiés', async () => {
  const env = { JETON, BOITE: kvMemoire() };
  const admin = await jetonDeProfil(JETON, 'adm001');
  const ami = await jetonDeProfil(JETON, 'ami001');
  for (const nom of ['coffre', 'portefeuille', 'annuaire', 'compte']) {
    await avec(env, JETON, `/p/ami001/boite/${nom}`, { method: 'PUT', body: enveloppe(nom) });
    await avec(env, JETON, `/p/fon001/boite/${nom}`, { method: 'PUT', body: enveloppe(nom) });
  }
  // Sans délégation : 403 partout.
  assert.equal((await avec(env, admin, '/p/ami001/boite/coffre')).status, 403);
  // Seul le jeton maître publie (ou lit) les délégations.
  assert.equal((await avec(env, admin, '/rangs', { method: 'PUT', body: JSON.stringify({ delegations: { adm001: ['ami001', 'fon001'] } }) })).status, 403);
  assert.equal((await avec(env, ami, '/rangs')).status, 403);
  assert.equal((await avec(env, JETON, '/rangs', { method: 'PUT', body: JSON.stringify({ delegations: { adm001: ['ami001', 'principal', 'adm001', 'A!'] } }) })).status, 200);
  assert.deepEqual((await (await avec(env, JETON, '/rangs')).json()).delegations, { adm001: ['ami001'] });

  assert.equal((await avec(env, admin, '/p/ami001/boite')).status, 200);
  assert.equal((await avec(env, admin, '/p/ami001/boite/coffre')).status, 200);
  assert.equal((await avec(env, admin, '/p/ami001/boite/portefeuille', { method: 'PUT', body: enveloppe('portefeuille') })).status, 200);
  // Ni l'annuaire ni le retour de l'ami, ni suppression.
  assert.equal((await avec(env, admin, '/p/ami001/boite/annuaire')).status, 403);
  assert.equal((await avec(env, admin, '/p/ami001/boite/compte')).status, 403);
  assert.equal((await avec(env, admin, '/p/ami001/boite/coffre', { method: 'DELETE' })).status, 403);
  // Rien d'un compte non délégué (un Fondateur), ni de l'espace du compte historique.
  assert.equal((await avec(env, admin, '/p/fon001/boite/coffre')).status, 403);
  assert.equal((await avec(env, admin, '/p/fon001/boite')).status, 403);
  assert.equal((await avec(env, admin, '/p/principal/boite/annuaire')).status, 403);
  // L'ami ne gagne rien en sens inverse.
  assert.equal((await avec(env, ami, '/p/adm001/boite')).status, 403);

  // Rétrogradation : la délégation retirée, l'accès cesse aussitôt.
  assert.equal((await avec(env, JETON, '/rangs', { method: 'PUT', body: JSON.stringify({ delegations: {} }) })).status, 200);
  assert.equal((await avec(env, admin, '/p/ami001/boite/coffre')).status, 403);
});

test('Tsuzuku : les sources partagées sont en lecture seule pour le compte, sa clé de réception lui appartient', async () => {
  const env = { JETON, BOITE: kvMemoire() };
  const ami = await jetonDeProfil(JETON, 'amitsu01');
  const autre = await jetonDeProfil(JETON, 'amitsu02');
  const avec = (jeton, chemin, options = {}) => appeler(env, chemin, { ...options, headers: { Authorization: `Bearer ${jeton}` } });
  const corps = nom => enveloppe(nom);
  // L'administrateur (jeton maître) dépose les sources partagées de l'ami.
  assert.equal((await appeler(env, '/p/amitsu01/boite/tsuzuku-sources', { method: 'PUT', body: corps('tsuzuku-sources') })).status, 200);
  // L'ami les lit, mais ne peut ni les écrire ni les effacer.
  assert.equal((await avec(ami, '/p/amitsu01/boite/tsuzuku-sources')).status, 200);
  assert.equal((await avec(ami, '/p/amitsu01/boite/tsuzuku-sources', { method: 'PUT', body: corps('tsuzuku-sources') })).status, 403);
  assert.equal((await avec(ami, '/p/amitsu01/boite/tsuzuku-sources', { method: 'DELETE' })).status, 403);
  // Sa clé de réception : il la dépose lui-même.
  assert.equal((await avec(ami, '/p/amitsu01/boite/tsuzuku-cle', { method: 'PUT', body: corps('tsuzuku-cle') })).status, 200);
  // Un autre compte ne lit ni les sources ni la clé de l'ami.
  assert.equal((await avec(autre, '/p/amitsu01/boite/tsuzuku-sources')).status, 403);
  assert.equal((await avec(autre, '/p/amitsu01/boite/tsuzuku-cle')).status, 403);
  // L'administrateur efface (retrait complet).
  assert.equal((await appeler(env, '/p/amitsu01/boite/tsuzuku-sources', { method: 'DELETE' })).status, 200);
});
