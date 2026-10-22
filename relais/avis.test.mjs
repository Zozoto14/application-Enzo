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
import { ATTENTE_MAX_S, LIMITE_MINUTE_IP, MAX_PAR_COMPTE, MAX_PAR_COMPTE_IP, avisDe, creerAvis, modeTempsReel } from './avis.mjs';
import { compresser } from './serveur/compression.mjs';
import { creerServeurHttp, ecouter } from '../esport/serveur/commun.mjs';

const JETON = 'jeton-de-test-avis-0123456789abcdef';
const PG = process.env.RELAIS_TEST_PG || '';
let adresse;
let fermer = async () => {};
// Mode « sse » pour éprouver toutes les routes ; le mode par défaut (sondage) a son propre test.
const env = { JETON, BOITE: undefined, COFFRES: undefined, SYNCHRO_TEMPS_REEL: 'sse' };

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

// `ip` : adresse vue par le relais (X-Forwarded-For, comme derrière le frontal d'o2switch).
let ipAuto = 0;
const appel = (chemin, { methode = 'GET', jeton = JETON, corps, signal, entetes = {}, ip = `10.0.${Math.floor(++ipAuto / 250)}.${ipAuto % 250}` } = {}) =>
  fetch(`${adresse}${chemin}`, { method: methode, signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jeton}`, 'X-Forwarded-For': ip, ...entetes }, body: corps === undefined ? undefined : JSON.stringify(corps) });
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

test('limites : 2 connexions tenues par compte et par IP, MAX_PAR_COMPTE par compte ; au-delà, « sondage » tout de suite, sans connexion ouverte', async () => {
  const compte = 'avis00004';
  const { rev } = await ecrire(compte);
  const avis = avisDe(env);
  const ouverts = [];
  const ouvrir = async (ip, route = 'flux') => {
    const c = new AbortController();
    const r = await appel(`/v10/coffre/${compte}/${route}?rev=${rev}&delai=30`, { signal: c.signal, ip });
    return { c, r };
  };
  // Même adresse : 2 connexions tenues (flux + attente), la 3e est refusée aussitôt.
  for (const route of ['flux', 'attendre']) {
    const o = await ouvrir('192.0.2.10', route);
    assert.equal(o.r.status, 200, route);
    ouverts.push(o);
  }
  await new Promise(ok => setTimeout(ok, 30));
  assert.equal(avis.nombreIp(compte, '192.0.2.10'), MAX_PAR_COMPTE_IP);
  for (const route of ['flux', 'attendre']) {
    const debut = performance.now();
    const refus = await appel(`/v10/coffre/${compte}/${route}?rev=${rev}&delai=30`, { ip: '192.0.2.10' });
    const duree = performance.now() - debut;
    assert.equal(refus.status, 429, route);
    assert.equal(refus.headers.get('retry-after'), '15');
    const corps = await refus.json();
    assert.equal(corps.motif, 'trop-de-connexions');
    assert.equal(corps.mode, 'sondage');
    assert.equal(corps.rev, rev, 'la révision courante est donnée : le sondage commence informé');
    assert.ok(duree < 500, `réponse immédiate (${duree.toFixed(0)} ms)`);
  }
  assert.equal(avis.nombre(compte), 2, 'aucune connexion de plus n’est gardée');
  // Autres adresses : jusqu'à MAX_PAR_COMPTE pour le compte.
  for (let i = avis.nombre(compte); i < MAX_PAR_COMPTE; i++) {
    const o = await ouvrir(`192.0.2.${20 + i}`);
    assert.equal(o.r.status, 200);
    ouverts.push(o);
  }
  assert.equal((await appel(`/v10/coffre/${compte}/flux?rev=0`, { ip: '192.0.2.99' })).status, 429, 'plafond du compte');
  assert.equal((await appel(`/v10/coffre/${compte}/attendre?rev=0&delai=1`)).status, 200, 'déjà en retard : réponse immédiate, sans connexion tenue');
  // Un autre compte n'est pas gêné.
  const autre = new AbortController();
  assert.equal((await appel('/v10/coffre/avis00005/flux?rev=0', { signal: autre.signal, ip: '192.0.2.10' })).status, 200);
  autre.abort();
  // Une connexion fermée par l'appareil libère sa place (dès que le serveur voit la fermeture).
  for (const o of ouverts) o.c.abort();
  for (let i = 0; i < 40 && avis.nombre(compte) > 0; i++) await new Promise(ok => setTimeout(ok, 50));
  assert.equal(avis.nombre(compte), 0, 'toutes les places sont rendues');
  assert.equal(avis.total(), 0, 'aucune fuite de connexion');
});

test('attente longue : battement (espaces) puis JSON valide ; jamais retenue pour gzip', async () => {
  const compte = 'avis00007';
  const { rev } = await ecrire(compte);
  const r = await appel(`/v10/coffre/${compte}/attendre?rev=${rev}&delai=1`, { entetes: { 'Accept-Encoding': 'gzip' } });
  assert.equal(r.headers.get('content-encoding'), null);
  assert.equal(r.headers.get('x-accel-buffering'), 'no');
  assert.deepEqual(await r.json(), { rev, attente: 1 });
  // Délai demandé trop long : borné à ATTENTE_MAX_S.
  assert.equal(ATTENTE_MAX_S, 50);
});

test('mode par défaut « sondage » : flux et attente refusés aussitôt (429 mode-sondage), version toujours là', async () => {
  assert.equal(modeTempsReel({}), 'sondage');
  assert.equal(modeTempsReel({ SYNCHRO_TEMPS_REEL: ' Attente ' }), 'attente');
  assert.equal(modeTempsReel({ SYNCHRO_TEMPS_REEL: 'n’importe quoi' }), 'sondage');
  const compte = 'avis00008';
  const { rev } = await ecrire(compte);
  const avant = env.SYNCHRO_TEMPS_REEL;
  delete env.SYNCHRO_TEMPS_REEL;
  try {
    const sante = await (await appel('/sante')).json();
    assert.equal(sante.tempsReel, 'sondage');
    assert.equal(sante.pasSondage, 15);
    for (const route of ['flux', 'attendre']) {
      const debut = performance.now();
      const r = await appel(`/v10/coffre/${compte}/${route}?rev=${rev}`);
      assert.equal(r.status, 429);
      const corps = await r.json();
      assert.equal(corps.motif, 'mode-sondage');
      assert.equal(corps.rev, rev);
      assert.ok(performance.now() - debut < 500);
    }
    assert.equal(avisDe(env).nombre(compte), 0);
    assert.equal((await (await appel(`/v10/coffre/${compte}/version`)).json()).rev, rev);
    // Mode « attente » : l'attente longue oui, le flux non.
    env.SYNCHRO_TEMPS_REEL = 'attente';
    assert.equal((await (await appel('/sante')).json()).tempsReel, 'attente');
    assert.equal((await (await appel(`/v10/coffre/${compte}/flux?rev=0`)).json()).motif, 'mode-attente');
    assert.equal((await appel(`/v10/coffre/${compte}/attendre?rev=${rev}&delai=1`)).status, 200);
  } finally {
    env.SYNCHRO_TEMPS_REEL = avant;
  }
});

test('plafond de requêtes par adresse : au-delà de LIMITE_MINUTE_IP, « sondage espacé » (Retry-After 60)', async () => {
  const compte = 'avis00009';
  await ecrire(compte);
  let statut = 200;
  let n = 0;
  while (statut === 200 && n < LIMITE_MINUTE_IP + 5) {
    statut = (await appel(`/v10/coffre/${compte}/version`, { ip: '198.51.100.7' })).status;
    n++;
  }
  assert.equal(n, LIMITE_MINUTE_IP + 1);
  const r = await appel(`/v10/coffre/${compte}/version`, { ip: '198.51.100.7' });
  assert.equal(r.status, 429);
  assert.equal(r.headers.get('retry-after'), '60');
  assert.equal((await r.json()).motif, 'trop-de-requetes');
  assert.equal((await appel(`/v10/coffre/${compte}/version`, { ip: '198.51.100.8' })).status, 200, 'les autres adresses ne sont pas gênées');
});

test('même appareil : la nouvelle connexion tenue remplace l’ancienne (jamais deux, même si l’ancienne n’a pas été vue fermée)', async () => {
  const compte = 'avis00010';
  const { rev } = await ecrire(compte);
  const avis = avisDe(env);
  const ancienne = appel(`/v10/coffre/${compte}/attendre?rev=${rev}&delai=30&appareil=onglet-abc123`, { ip: '203.0.113.5' }).then(r => r.json());
  await new Promise(ok => setTimeout(ok, 50));
  const c = new AbortController();
  const nouvelle = await appel(`/v10/coffre/${compte}/attendre?rev=${rev}&delai=30&appareil=onglet-abc123`, { ip: '203.0.113.5', signal: c.signal });
  assert.equal(nouvelle.status, 200);
  // L'ancienne a répondu tout de suite (révision courante, attente terminée) : sa place est rendue.
  assert.deepEqual(await ancienne, { rev, attente: 30 });
  assert.equal(avis.nombreIp(compte, '203.0.113.5'), 1);
  // Un autre appareil de la même adresse a sa propre place (2 par compte et par IP).
  const c2 = new AbortController();
  assert.equal((await appel(`/v10/coffre/${compte}/attendre?rev=${rev}&delai=30&appareil=autre-xyz789`, { ip: '203.0.113.5', signal: c2.signal })).status, 200);
  assert.equal(avis.nombreIp(compte, '203.0.113.5'), 2);
  c.abort();
  c2.abort();
  for (let i = 0; i < 40 && avis.nombre(compte) > 0; i++) await new Promise(ok => setTimeout(ok, 50));
  assert.equal(avis.nombre(compte), 0);
});

test('bus : balayage des connexions orphelines, désabonnement idempotent, compteurs justes', () => {
  let t = 0;
  const bus = creerAvis({ maintenant: () => t });
  let fermees = 0;
  const d1 = bus.abonner('c', () => {}, { ip: 'a', fermer: () => fermees++ });
  const d2 = bus.abonner('c', () => {}, { ip: 'a', fermer: () => fermees++ });
  assert.ok(d1 && d2);
  assert.equal(bus.abonner('c', () => {}, { ip: 'a' }), undefined, '2 par compte et par IP');
  d1();
  d1();
  assert.equal(bus.nombreIp('c', 'a'), 1);
  t += 10 * 60_000;
  bus.balayer();
  assert.equal(fermees, 1);
  assert.equal(bus.total(), 0);
  d2();
  assert.equal(bus.total(), 0, 'désabonner après le balayage ne fausse rien');
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
