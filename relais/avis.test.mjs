/**
 * Relais version 10 : avis de nouvelle révision (flux SSE, attente longue, sondage), limites de
 * connexions, `avant` dans la réponse d'un envoi, compression gzip, latence d'un aller-retour.
 *
 * Passe par un VRAI serveur HTTP (pont node:http d'esport/serveur/commun.mjs, celui du relais sous
 * Passenger) : c'est lui qui doit laisser partir un événement SSE sans le retenir. Avec
 * RELAIS_TEST_PG (`npm run relais:tester:pg`), le serveur est relais/serveur/app.mjs avec PostgreSQL.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { jetonDeProfil, traiterRequete } from './worker.mjs';
import { coffresMemoire } from './coffres.mjs';
import { MAX_PAR_COMPTE } from './avis.mjs';
import { compresser } from './serveur/compression.mjs';
import { creerServeurHttp, ecouter } from '../esport/serveur/commun.mjs';

const JETON = 'jeton-de-test-avis-0123456789abcdef';
const PG = process.env.RELAIS_TEST_PG || '';
let adresse;
let fermer = async () => {};
const env = { JETON, BOITE: undefined, COFFRES: undefined };

function kv() {
  const donnees = new Map();
  return { get: async c => (donnees.has(c) ? donnees.get(c) : null), put: async (c, v) => void donnees.set(c, v), delete: async c => void donnees.delete(c) };
}

before(async () => {
  if (PG) {
    const { basePostgres } = await import('../esport/adaptateurs/postgres.mjs');
    const { demarrer } = await import('./serveur/app.mjs');
    const { coffresPostgres, creerTablesCoffres } = await import('./serveur/coffres-postgres.mjs');
    const { creerTableKv, kvPostgres } = await import('./serveur/kv-postgres.mjs');
    // Schéma « t_<16 hexa> » : effacé par relais/test-pg/lancer.mjs à la fin.
    const schema = `t_${randomBytes(8).toString('hex')}`;
    const admin = await basePostgres({ connexion: PG, max: 1 });
    await admin.script(`CREATE SCHEMA ${schema}`);
    await admin.fermer();
    const base = await basePostgres({ connexion: PG, schema, max: 6 });
    await creerTableKv(base);
    await creerTablesCoffres(base);
    env.BOITE = kvPostgres(base);
    env.COFFRES = coffresPostgres(base);
    const s = await demarrer({ port: 0, hote: '127.0.0.1', base, envPour: () => env });
    adresse = s.url;
    fermer = async () => {
      s.serveur.closeAllConnections();
      await s.fermer();
      await base.fermer();
    };
  } else {
    env.BOITE = kv();
    env.COFFRES = coffresMemoire();
    const serveur = creerServeurHttp(async (requete, { attendre } = {}) => compresser(requete, await traiterRequete(requete, env, { waitUntil: p => attendre?.(p) })), { journal: { error: () => {} } });
    adresse = await ecouter(serveur, { port: 0, hote: '127.0.0.1' });
    fermer = () =>
      new Promise(ok => {
        serveur.closeAllConnections();
        serveur.close(() => ok());
      });
  }
});
after(() => fermer());

const appel = (chemin, { methode = 'GET', jeton = JETON, corps, signal, entetes = {} } = {}) =>
  fetch(`${adresse}${chemin}`, { method: methode, signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jeton}`, ...entetes }, body: corps === undefined ? undefined : JSON.stringify(corps) });
let n = 0;
const enr = (o = {}) => ({ id: (++n).toString(16).padStart(32, '0'), base: 0, date: new Date().toISOString(), valeur: `chiffre-${n}`, ...o });
const ecrire = (compte, nombre = 1) => appel(`/v10/coffre/${compte}`, { methode: 'POST', corps: { enregistrements: Array.from({ length: nombre }, () => enr()) } }).then(r => r.json());

/** Lit un flux SSE : rend les événements `version` au fil de l'eau. */
function lireFlux(reponse) {
  const lecteur = reponse.body.getReader();
  const decodeur = new TextDecoder();
  let tampon = '';
  const attente = [];
  const recus = [];
  (async () => {
    try {
      for (;;) {
        const { done, value } = await lecteur.read();
        if (done) break;
        tampon += decodeur.decode(value, { stream: true });
        let i;
        while ((i = tampon.indexOf('\n\n')) >= 0) {
          const bloc = tampon.slice(0, i);
          tampon = tampon.slice(i + 2);
          const donnee = /^data: (.*)$/m.exec(bloc);
          if (/^event: version$/m.test(bloc) && donnee) {
            const ev = { rev: JSON.parse(donnee[1]).rev, le: performance.now() };
            const qui = attente.shift();
            if (qui) qui(ev);
            else recus.push(ev);
          }
        }
      }
    } catch {
      // Fermé par le test.
    }
  })();
  return {
    suivant: (delai = 3000) =>
      recus.length > 0
        ? Promise.resolve(recus.shift())
        : new Promise((ok, ko) => {
            const t = setTimeout(() => ko(new Error('aucun événement')), delai);
            attente.push(ev => {
              clearTimeout(t);
              ok(ev);
            });
          }),
    fermer: () => lecteur.cancel().catch(() => undefined),
  };
}

test('/v10 : POST rend `avant` (révision juste avant l’envoi) ; version ; v9 inchangé', async () => {
  const compte = 'avis00001';
  const a = await ecrire(compte, 2);
  assert.equal(a.avant, 0);
  assert.equal(a.rev, 2);
  const b = await ecrire(compte);
  assert.equal(b.avant, 2);
  assert.equal((await (await appel(`/v10/coffre/${compte}/version`)).json()).rev, 3);
  // Les routes v9 restent (anciens appareils), sans les avis.
  assert.equal((await (await appel(`/v9/coffre/${compte}?depuis=0`)).json()).enregistrements.length, 3);
  assert.equal((await appel(`/v9/coffre/${compte}/flux`)).status, 404);
});

test('flux SSE : la révision courante tout de suite, puis chaque écriture en quelques ms, sans tampon ni gzip', async () => {
  const compte = 'avis00002';
  await ecrire(compte);
  const controle = new AbortController();
  const reponse = await appel(`/v10/coffre/${compte}/flux?rev=0`, { signal: controle.signal, entetes: { 'Accept-Encoding': 'gzip' } });
  assert.equal(reponse.status, 200);
  assert.match(reponse.headers.get('content-type'), /^text\/event-stream/);
  assert.equal(reponse.headers.get('x-accel-buffering'), 'no');
  assert.equal(reponse.headers.get('content-encoding'), null, 'un flux n’est jamais compressé');
  const flux = lireFlux(reponse);
  assert.equal((await flux.suivant()).rev, 1, 'révision courante dès l’ouverture');
  const delais = [];
  for (let i = 0; i < 5; i++) {
    const debut = performance.now();
    const ecrit = await ecrire(compte);
    const ev = await flux.suivant();
    assert.equal(ev.rev, ecrit.rev);
    delais.push(ev.le - debut);
  }
  console.log(`  avis SSE : écriture → événement reçu en ${delais.map(d => d.toFixed(1)).join(', ')} ms`);
  assert.ok(Math.max(...delais) < 500, 'moins de 500 ms en local');
  // Un autre compte ne reçoit rien de ce compte, et ne peut pas l'écouter.
  const lea = await jetonDeProfil(JETON, 'lea12345');
  assert.equal((await appel(`/v10/coffre/${compte}/flux?rev=0`, { jeton: lea })).status, 403);
  await flux.fermer();
  controle.abort();
});

test('attente longue : répond dès la nouvelle révision, ou à la fin du délai', async () => {
  const compte = 'avis00003';
  const { rev } = await ecrire(compte);
  const debut = performance.now();
  const attente = appel(`/v10/coffre/${compte}/attendre?rev=${rev}&delai=20`).then(r => r.json());
  await new Promise(ok => setTimeout(ok, 150));
  await ecrire(compte);
  const lu = await attente;
  const duree = performance.now() - debut - 150;
  assert.equal(lu.rev, rev + 1);
  console.log(`  attente longue : réveillée ${duree.toFixed(1)} ms après l’écriture (aller-retour compris)`);
  assert.ok(duree < 500);
  // Déjà en retard : réponse immédiate.
  assert.equal((await (await appel(`/v10/coffre/${compte}/attendre?rev=0`)).json()).rev, rev + 1);
  // Rien de neuf : fin du délai (1 s ici).
  const vide = await (await appel(`/v10/coffre/${compte}/attendre?rev=${rev + 1}&delai=1`)).json();
  assert.deepEqual(vide, { rev: rev + 1, attente: 1 });
});

test('limites : au plus MAX_PAR_COMPTE connexions tenues par compte, ensuite 429 (sondage)', async () => {
  const compte = 'avis00004';
  await ecrire(compte);
  const ouverts = [];
  for (let i = 0; i < MAX_PAR_COMPTE; i++) {
    const c = new AbortController();
    const r = await appel(`/v10/coffre/${compte}/flux?rev=0`, { signal: c.signal });
    assert.equal(r.status, 200);
    ouverts.push({ c, f: lireFlux(r) });
  }
  const refus = await appel(`/v10/coffre/${compte}/flux?rev=0`);
  assert.equal(refus.status, 429);
  assert.equal((await refus.json()).motif, 'trop-de-connexions');
  assert.equal((await appel(`/v10/coffre/${compte}/attendre?rev=0&delai=1`)).status, 200, 'déjà en retard : réponse immédiate, sans connexion tenue');
  // Un autre compte n'est pas gêné.
  const autre = new AbortController();
  assert.equal((await appel('/v10/coffre/avis00005/flux?rev=0', { signal: autre.signal })).status, 200);
  autre.abort();
  for (const o of ouverts) {
    await o.f.fermer();
    o.c.abort();
  }
  // Une connexion fermée par l'appareil libère sa place (dès que le serveur voit la fermeture).
  let statut = 0;
  for (let i = 0; i < 40 && statut !== 200; i++) {
    await new Promise(ok => setTimeout(ok, 50));
    const c = new AbortController();
    const r = await appel(`/v10/coffre/${compte}/flux?rev=0`, { signal: c.signal });
    statut = r.status;
    if (statut === 200) await r.body.cancel().catch(() => undefined);
    c.abort();
  }
  assert.equal(statut, 200);
});

test('gzip : grosses réponses JSON compressées si l’appareil l’accepte ; latence d’un aller-retour', async () => {
  const compte = 'avis00006';
  await appel(`/v10/coffre/${compte}`, { methode: 'POST', corps: { enregistrements: Array.from({ length: 40 }, () => enr({ valeur: randomBytes(3000).toString('base64') })) } });
  const r = await appel(`/v10/coffre/${compte}?depuis=0`, { entetes: { 'Accept-Encoding': 'gzip' } });
  assert.equal(r.headers.get('content-encoding'), 'gzip');
  assert.equal((await r.json()).enregistrements.length, 40, 'fetch décompresse seul');
  const brut = await appel(`/v10/coffre/${compte}?depuis=0`, { entetes: { 'Accept-Encoding': 'identity' } });
  assert.equal(brut.headers.get('content-encoding'), null);
  // Aller-retour : un envoi d'un enregistrement, puis la relecture des différences.
  const mesures = [];
  for (let i = 0; i < 20; i++) {
    const debut = performance.now();
    const { rev } = await ecrire(compte);
    await (await appel(`/v10/coffre/${compte}?depuis=${rev - 1}`)).json();
    mesures.push(performance.now() - debut);
  }
  mesures.sort((a, b) => a - b);
  console.log(`  aller-retour envoi + relecture : médiane ${mesures[10].toFixed(1)} ms, max ${mesures[19].toFixed(1)} ms (${PG ? 'PostgreSQL' : 'mémoire'})`);
  assert.ok(mesures[10] < 200);
});
