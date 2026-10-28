/**
 * IA LOCALE (llama.cpp sur le serveur) : gestionnaire du serveur d'inférence avec un FAUX binaire (aucun
 * modèle, aucun téléchargement) — démarrage à la demande sur 127.0.0.1, clé d'accès, arrêt après
 * inactivité, verrou du compte, nettoyage des orphelins, échec de démarrage, file d'attente, environnement
 * vidé — ; connecteur local ; choix IA locale / clé d'API / locale d'abord ; plafonds (API seulement) ;
 * travaux confiés au processus de fond ; garde SSRF inchangée ; installateur (fonctions pures,
 * téléchargement vérifié avec reprise, sur un faux serveur).
 *
 * Tourne sur SQLite (défaut) et sur PostgreSQL (ESPORT_TEST_PG).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { banc } from './aide.mjs';
import { baseMigree } from './base.mjs';
import { ADAPTATEURS, causeEchec, configIa, configIaLocale, creerConnecteurLocal } from '../noyau/ia/connecteur.mjs';
import { recupererPage, verifierAdresseHttps } from '../noyau/ia/recherche.mjs';
import { lireAdresses } from '../noyau/ia/assistant.mjs';
import { servicesJeux } from '../noyau/jeux/service.mjs';
import { argumentsServeur, creerGestionnaireIaLocale, environnementMoteur, estNotreServeur, nettoyerOrphelinIaLocale, processusVivant } from '../serveur/ia-locale/gestionnaire.mjs';
import { cheminsIaLocale, dossierRefuse, etatInstallationIaLocale } from '../serveur/ia-locale/installation.mjs';
import { creerIaLocale } from '../serveur/ia-locale/service.mjs';
import { lancerTravailleurIaLocale } from '../serveur/ia-locale/lanceur.mjs';
import { executerTravailleur, prendreVerrouTravailleur } from '../serveur/ia-locale/travailleur.mjs';
import { creerFetchLocal, fetchLocal } from '../serveur/ia-locale/transport.mjs';
import { lireOptions, lirePaquetsOutils, recommandation, telechargerVerifie } from '../serveur/ia-locale/installer.mjs';

const attendre = ms => new Promise(ok => setTimeout(ok, ms));
const silencieux = { log: () => undefined, warn: () => undefined, error: () => undefined };

/**
 * Faux llama-server (Node) : options lues comme le vrai, écoute sur --host/--port, exige la clé du fichier
 * --api-key-file, /health, /v1/chat/completions (réponse JSON + timings), /env (noms des variables reçues).
 * `FAUX_MODE` dans le nom du binaire : « ok », « plante » (sort tout de suite en erreur).
 */
const SCRIPT_FAUX = `
import http from 'node:http';
import { readFileSync, appendFileSync } from 'node:fs';
const a = process.argv.slice(2);
const opt = n => a[a.indexOf(n) + 1];
if (a.includes('--version')) { console.log('version: 0.5.0-dev (build 1, commit 631109b)'); process.exit(0); }
if (a.some(x => x.endsWith('plante.gguf'))) { console.error('erreur de chargement'); process.exit(3); }
const cle = readFileSync(opt('--api-key-file'), 'utf8').trim();
const journal = opt('-m') + '.requetes';
const s = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200); res.end('{"status":"ok"}'); return; }
  if (req.headers.authorization !== 'Bearer ' + cle) { res.writeHead(401); res.end('{}'); return; }
  if (req.url === '/env') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(Object.keys(process.env))); return; }
  let corps = '';
  req.on('data', d => (corps += d));
  req.on('end', () => {
    appendFileSync(journal, corps + '\\n');
    // « LENT:<ms> » dans un message : génération longue (aucun en-tête avant la fin, comme llama-server).
    const lent = /LENT:(\\d+)/.exec(corps);
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '{"ok": true}' } }], usage: { prompt_tokens: 12, completion_tokens: 5 }, timings: { predicted_per_second: 7.5, prompt_per_second: 60 } }));
    }, lent ? Number(lent[1]) : 30);
  });
});
s.listen(Number(opt('--port')), opt('--host'));
process.on('SIGTERM', () => process.exit(0));
`;

/** Dossier d'IA locale de test avec le faux binaire (sh → node) et un faux modèle. */
function installationFactice() {
  const racine = mkdtempSync(join(tmpdir(), 'esport-ia-locale-'));
  const c = cheminsIaLocale(join(racine, 'ia-locale'));
  for (const d of [c.moteur, c.modeles, c.etat]) mkdirSync(d, { recursive: true });
  const script = join(racine, 'faux-llama.mjs');
  writeFileSync(script, SCRIPT_FAUX);
  const binaire = join(c.moteur, 'llama-server');
  writeFileSync(binaire, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
  chmodSync(binaire, 0o755);
  const fichierModele = join(c.modeles, 'faux.gguf');
  writeFileSync(fichierModele, 'GGUF-factice');
  return { racine, c, binaire, fichierModele, nettoyer: () => rmSync(racine, { recursive: true, force: true }) };
}

function gestionnaire(inst, options = {}) {
  return creerGestionnaireIaLocale({ dossier: inst.c.dossier, binaire: inst.binaire, fichierModele: inst.fichierModele, threads: 2, contexte: 4096, inactiviteMs: 300, demarrageMs: 15_000, attenteVerrouMs: 300, journal: join(inst.racine, 'moteur.log'), log: silencieux, ...options });
}

/** Requête au faux serveur, comme le connecteur (clé dans l'en-tête). */
async function demander({ port, cle }, chemin = '/v1/chat/completions') {
  const r = await fetch(`http://127.0.0.1:${port}${chemin}`, { method: chemin === '/env' ? 'GET' : 'POST', headers: { Authorization: `Bearer ${cle}` }, ...(chemin === '/env' ? {} : { body: '{"messages":[]}' }) });
  return { statut: r.status, corps: await r.json() };
}

// ------------------------------------------------------------------ Gestionnaire (faux binaire)

test('gestionnaire : démarrage à la demande sur 127.0.0.1 (clé exigée, environnement vidé), arrêt après inactivité', async () => {
  const inst = installationFactice();
  const ancien = process.env.IA_API_CLE;
  process.env.IA_API_CLE = 'cle-factice-ne-doit-pas-passer';
  try {
    const g = gestionnaire(inst);
    assert.equal(g.etat().enMarche, false);
    let vu;
    const r = await g.executer(async ({ port, cle }) => {
      vu = { port, cle };
      const v = JSON.parse(readFileSync(inst.c.verrouServeur, 'utf8'));
      assert.equal(v.proprietaire, process.pid);
      assert.ok(estNotreServeur(v.pid, inst.c.cle), 'ligne de commande : notre fichier de clé');
      // Sans la clé : refusé (127.0.0.1 est partagé avec les autres comptes du serveur).
      assert.equal((await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: 'POST', body: '{}' })).status, 401);
      const env = (await demander({ port, cle }, '/env')).corps;
      assert.ok(!env.includes('IA_API_CLE') && !env.some(k => k.startsWith('LLAMA_ARG')), 'aucun secret ni LLAMA_ARG_* transmis au moteur');
      return (await demander({ port, cle })).corps;
    });
    assert.equal(r.choices[0].message.content, '{"ok": true}');
    assert.equal(g.etat().enMarche, true);
    assert.ok(!JSON.stringify(g.etat()).includes(vu.cle), 'ni clé ni port dans l’état');
    // Inactivité (300 ms ici) : arrêt, verrou et clé retirés.
    const pid = JSON.parse(readFileSync(inst.c.verrouServeur, 'utf8')).pid;
    await attendre(1200);
    assert.equal(g.etat().enMarche, false);
    assert.equal(processusVivant(pid), false);
    assert.equal(existsSync(inst.c.verrouServeur), false);
    assert.equal(existsSync(inst.c.cle), false);
    // Nouvelle tâche : redémarre (nouveau port, nouvelle clé).
    const port2 = await g.executer(async ({ port, cle }) => {
      assert.notEqual(cle, vu.cle);
      return port;
    });
    assert.ok(Number.isInteger(port2));
    assert.equal(await g.arreter(), true);
    assert.equal(existsSync(inst.c.verrouServeur), false);
  } finally {
    if (ancien === undefined) delete process.env.IA_API_CLE;
    else process.env.IA_API_CLE = ancien;
    inst.nettoyer();
  }
});

test('gestionnaire : options du moteur (écoute locale seulement, pas d’interface web) ; environnement minimal', () => {
  const a = argumentsServeur({ fichierModele: '/m.gguf', port: 40123, fichierCle: '/cle', threads: 8, contexte: 16384, delaiS: 1200 });
  assert.equal(a[a.indexOf('--host') + 1], '127.0.0.1');
  assert.equal(a[a.indexOf('--api-key-file') + 1], '/cle');
  assert.ok(a.includes('--no-webui') && a.includes('--no-slots'));
  assert.equal(a[a.indexOf('-t') + 1], '8');
  assert.ok(!a.some(x => /0\.0\.0\.0|::/.test(x)));
  const env = environnementMoteur('/x/moteur/llama-server', { HOME: '/home/u', IA_API_CLE: 'secret', DATABASE_URL: 'postgres://x', LLAMA_ARG_HOST: '0.0.0.0' });
  assert.deepEqual(Object.keys(env).sort(), ['HOME', 'LANG', 'LD_LIBRARY_PATH', 'PATH']);
});

test('gestionnaire : un seul moteur par compte (verrou) ; file d’attente d’une requête à la fois, bornée', async () => {
  const inst = installationFactice();
  try {
    const g1 = gestionnaire(inst, { inactiviteMs: 5000, fileMax: 1 });
    const g2 = gestionnaire(inst, { attenteVerrouMs: 300 });
    let enCours = 0;
    let max = 0;
    const tache = () =>
      g1.executer(async p => {
        enCours++;
        max = Math.max(max, enCours);
        await demander(p);
        await attendre(50);
        enCours--;
        return true;
      });
    const lot = [tache(), tache()];
    // Troisième requête alors qu'une tourne et qu'une attend (fileMax 1) : refusée tout de suite.
    await assert.rejects(tache(), e => e.code === 'ia-locale-occupee' && e.statut === 503);
    assert.deepEqual(await Promise.all(lot), [true, true]);
    assert.equal(max, 1, 'une requête à la fois');
    // Autre processus (autre gestionnaire) : le moteur est tenu → « occupée » après l'attente.
    await assert.rejects(g2.executer(async () => true), e => e.code === 'ia-locale-occupee');
    assert.equal(g2.etat().enMarche, true);
    assert.equal(g2.etat().ailleurs, true);
    await g1.arreter();
    assert.equal(await g2.executer(async () => 'à mon tour'), 'à mon tour');
    await g2.arreter();
  } finally {
    inst.nettoyer();
  }
});

test('gestionnaire : moteur ORPHELIN (propriétaire disparu) arrêté ; jamais un processus qui n’est pas le nôtre', async () => {
  const inst = installationFactice();
  const enfants = [];
  try {
    // Un « vieux » moteur lancé par un processus disparu (pid propriétaire inexistant).
    writeFileSync(inst.c.cle, 'ancienne-cle\n');
    const orphelin = spawn(inst.binaire, ['-m', inst.fichierModele, '--host', '127.0.0.1', '--port', '0', '--api-key-file', inst.c.cle], { stdio: 'ignore' });
    enfants.push(orphelin);
    await attendre(300);
    const mort = 2 ** 22 + 12345;
    writeFileSync(inst.c.verrouServeur, JSON.stringify({ proprietaire: mort, jeton: 'x', pid: orphelin.pid, port: 1, majLe: new Date().toISOString() }));
    const parti = new Promise(ok => orphelin.once('exit', ok));
    const n = nettoyerOrphelinIaLocale({ dossier: inst.c.dossier });
    assert.equal(n.nettoye, true);
    assert.equal(n.pid, orphelin.pid);
    await parti;
    assert.equal(existsSync(inst.c.verrouServeur), false);
    assert.equal(existsSync(inst.c.cle), false);
    // Verrou d'orphelin désignant un processus étranger (pas notre fichier de clé) : PAS tué, verrou retiré.
    const etranger = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
    enfants.push(etranger);
    writeFileSync(inst.c.verrouServeur, JSON.stringify({ proprietaire: mort, jeton: 'y', pid: etranger.pid, majLe: new Date().toISOString() }));
    const n2 = nettoyerOrphelinIaLocale({ dossier: inst.c.dossier });
    assert.equal(n2.nettoye, true);
    assert.equal(n2.pid, undefined);
    assert.equal(processusVivant(etranger.pid), true);
    // Propriétaire vivant et battement récent : rien n'est touché.
    writeFileSync(inst.c.verrouServeur, JSON.stringify({ proprietaire: process.pid, jeton: 'z', pid: etranger.pid, majLe: new Date().toISOString() }));
    assert.equal(nettoyerOrphelinIaLocale({ dossier: inst.c.dossier }).raison, 'en-service');
    // Le gestionnaire nettoie lui-même un orphelin avant de démarrer (redémarrage de Passenger).
    writeFileSync(inst.c.verrouServeur, JSON.stringify({ proprietaire: mort, jeton: 'w', pid: null, majLe: new Date(Date.now() - 3_600_000).toISOString() }));
    const g = gestionnaire(inst);
    assert.equal(await g.executer(async () => 'repris'), 'repris');
    await g.arreter();
  } finally {
    for (const e of enfants) e.kill('SIGKILL');
    inst.nettoyer();
  }
});

test('gestionnaire : échec de démarrage (moteur qui plante, non installé) → erreur claire, verrou libéré', async () => {
  const inst = installationFactice();
  try {
    const plante = join(inst.c.modeles, 'plante.gguf');
    writeFileSync(plante, 'x');
    const g = gestionnaire(inst, { fichierModele: plante });
    await assert.rejects(g.executer(async () => true), e => e.code === 'ia-locale-demarrage' && e.statut === 503);
    assert.equal(existsSync(inst.c.verrouServeur), false);
    assert.equal(existsSync(inst.c.cle), false);
    assert.equal(g.etat().derniereErreur.code, 'ia-locale-demarrage');
    assert.match(readFileSync(join(inst.racine, 'moteur.log'), 'utf8'), /erreur de chargement/);
    const absent = creerGestionnaireIaLocale({ dossier: inst.c.dossier, binaire: null, fichierModele: null, log: silencieux });
    await assert.rejects(absent.executer(async () => true), e => e.code === 'ia-locale-absente');
    // Délai total dépassé avant le tour : 504.
    const g2 = gestionnaire(inst);
    await assert.rejects(g2.executer(async () => true, { delai: -1 }), e => e.code === 'ia-delai');
  } finally {
    inst.nettoyer();
  }
});

// ------------------------------------------------------------------ Connecteur local

test('connecteur local : adresse 127.0.0.1 construite ici seulement, clé du moteur, sortie JSON contrainte par schéma, vitesse notée', async () => {
  const appels = [];
  const mesures = [];
  const faux = { executer: async (fn, o) => fn({ port: 41234, cle: 'cle-moteur', limite: Date.now() + o.delai }), noterMesure: m => mesures.push(m) };
  const fetch = async (url, init) => {
    appels.push({ url, init, corps: JSON.parse(init.body) });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 3, completion_tokens: 2 }, timings: { predicted_per_second: 6.2 } }), { status: 200 });
  };
  const c = creerConnecteurLocal(faux, { modele: 'qwen2.5-7b', jetonsMax: 1000, fetch });
  const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };
  const r = await c.discuter([{ role: 'user', content: 'x' }], { maxJetons: 5000, schema });
  assert.equal(r.texte, '{"ok":true}');
  assert.equal(r.vitesse, 6.2);
  assert.equal(appels[0].url, 'http://127.0.0.1:41234/v1/chat/completions');
  assert.equal(appels[0].init.headers.Authorization, 'Bearer cle-moteur');
  assert.equal(appels[0].init.redirect, 'error');
  assert.equal(appels[0].corps.max_tokens, 1000, 'jetons bornés par IA_LOCALE_JETONS_MAX');
  assert.deepEqual(appels[0].corps.response_format, { type: 'json_schema', json_schema: { name: 'reponse', schema, strict: true } });
  assert.equal(mesures[0].jetonsParSeconde, 6.2);
  // Port invalide fourni par le gestionnaire : refusé (jamais une autre adresse).
  const mauvais = creerConnecteurLocal({ executer: async fn => fn({ port: 80, cle: 'k', limite: Date.now() + 1000 }) }, { fetch });
  await assert.rejects(mauvais.discuter([]), e => e.code === 'ia-injoignable');
  // Les fournisseurs d'API gardent le simple « json_object » (pas de schéma envoyé à l'extérieur).
  const req = ADAPTATEURS['openai-chat'].requete({ fournisseur: 'openai', modele: 'm', url: 'https://x', lireCle: () => 'k' }, [], { schema });
  assert.deepEqual(JSON.parse(req.init.body).response_format, { type: 'json_object' });
  // Réglages : bornes et valeurs par défaut.
  const conf = configIaLocale({ IA_LOCALE_THREADS: '500', IA_LOCALE_INACTIVITE_MIN: '2', IA_LOCALE_MODELE: '../x' });
  assert.equal(conf.threads, 32);
  assert.equal(conf.inactiviteMs, 120_000);
  assert.equal(conf.modele, 'qwen2.5-7b');
  assert.equal(configIaLocale({}).threads, 8);
  assert.equal(configIa({ IA_FOURNISSEUR: 'local' }).modeDefaut, 'local');
});

// ------------------------------------------------------------------ Transport local (délais d'undici)

/** Faux moteur HTTP minimal : répond après `retard.ms` (aucun en-tête avant), ou coupe la connexion. */
async function moteurHttp(retard) {
  const s = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (retard.couper) {
        req.socket.destroy();
        return;
      }
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], timings: { predicted_per_second: 6.4 } }));
      }, retard.ms);
    });
  });
  await new Promise(ok => s.listen(0, '127.0.0.1', ok));
  return { port: s.address().port, fermer: () => new Promise(ok => s.close(ok)) };
}

function gestionnaireFactice(port, incidents) {
  return { executer: async (fn, o) => fn({ port, cle: 'cle-moteur', limite: Date.now() + o.delai }), noterMesure: () => undefined, noterIncident: (texte, code) => incidents.push({ texte, code }) };
}

test('transport local : génération plus longue que le délai d’en-têtes d’undici → réussit (node:http) ; le fetch global échouait (cause journalisée)', async () => {
  const retard = { ms: 600 };
  const m = await moteurHttp(retard);
  try {
    const incidents = [];
    const g = gestionnaireFactice(m.port, incidents);
    const messages = [{ role: 'user', content: 'x' }];
    // Reproduction : un client qui abandonne après 200 ms sans en-têtes (undici : 300 s) → la VRAIE cause est rendue et journalisée.
    const commeUndici = creerConnecteurLocal(g, { fetch: creerFetchLocal({ delaiEntetesMs: 200 }) });
    await assert.rejects(commeUndici.discuter(messages), e => e.code === 'ia-delai-connexion' && e.statut === 504 && e.cause === 'UND_ERR_HEADERS_TIMEOUT');
    assert.match(incidents[0].texte, /UND_ERR_HEADERS_TIMEOUT/);
    assert.equal(incidents[0].code, 'ia-delai-connexion');
    // Même chose avec le vrai undici (headersTimeout réglé à 200 ms), s'il est présent dans node_modules.
    let undici = null;
    try {
      undici = await import('undici');
    } catch {
      undici = null;
    }
    if (undici?.Agent && undici?.fetch) {
      // (minuteries d'undici à la seconde près : réponse à 2,5 s pour un délai d'en-têtes de 200 ms)
      retard.ms = 2500;
      const agent = new undici.Agent({ headersTimeout: 200 });
      const vraiUndici = creerConnecteurLocal(g, { fetch: (url, init) => undici.fetch(url, { ...init, dispatcher: agent }) });
      await assert.rejects(vraiUndici.discuter(messages), e => e.code === 'ia-delai-connexion' && e.cause === 'UND_ERR_HEADERS_TIMEOUT');
      await agent.close();
      retard.ms = 600;
    }
    // Le transport du moteur local (défaut de creerIaLocale) : aucun délai d'en-têtes → la réponse arrive.
    const r = await creerConnecteurLocal(g, { fetch: fetchLocal }).discuter(messages);
    assert.equal(r.texte, '{"ok":true}');
    assert.equal(r.vitesse, 6.4);
    // Le délai GLOBAL (IA_LOCALE_DELAI_MIN) reste appliqué par l'AbortSignal.
    retard.ms = 1800;
    await assert.rejects(creerConnecteurLocal(g, { fetch: fetchLocal, delai: 10 }).discuter(messages), e => e.code === 'ia-delai');
    // Moteur qui coupe la connexion pendant le calcul : code précis.
    retard.couper = true;
    await assert.rejects(creerConnecteurLocal(g, { fetch: fetchLocal }).discuter(messages), e => e.code === 'ia-locale-coupee' && e.cause === 'ECONNRESET');
  } finally {
    await m.fermer();
  }
  // Moteur arrêté (plus rien n'écoute) : « ia-locale-arretee », pas un vague « injoignable ».
  const incidents = [];
  await assert.rejects(creerConnecteurLocal(gestionnaireFactice(m.port, incidents), { fetch: fetchLocal }).discuter([]), e => e.code === 'ia-locale-arretee');
  assert.match(incidents[0].texte, /ECONNREFUSED/);
  // Transport réservé au moteur local.
  await assert.rejects(fetchLocal('http://example.com/v1/chat/completions', { method: 'POST' }), e => e.cause?.code === 'ADRESSE_REFUSEE');
  await assert.rejects(fetchLocal('https://127.0.0.1:1234/', {}), e => e.cause?.code === 'ADRESSE_REFUSEE');
  assert.equal(causeEchec(new TypeError('fetch failed', { cause: { code: 'UND_ERR_HEADERS_TIMEOUT' } })), 'UND_ERR_HEADERS_TIMEOUT');
  assert.equal(causeEchec(new TypeError('fetch failed', { cause: { code: 'cle secrète' } })), 'inconnue');
});

test('concurrence : requête longue du processus de fond → ni arrêt pour inactivité, ni nettoyage par l’app ou le cron, ni second moteur', async () => {
  const inst = installationFactice();
  const journal = join(inst.racine, 'moteur.log');
  try {
    const fond = gestionnaire(inst, { inactiviteMs: 100, role: 'travailleur' });
    const connecteur = creerConnecteurLocal(fond, { fetch: fetchLocal });
    const requete = connecteur.discuter([{ role: 'user', content: 'LENT:1500' }]);
    while (!fond.etat().enMarche) await attendre(20);
    const pid = JSON.parse(readFileSync(inst.c.verrouServeur, 'utf8')).pid;
    await attendre(300);
    // Le cron et l'app (démarrage, test de connexion) pendant le calcul : le moteur légitime n'est pas touché.
    assert.equal(nettoyerOrphelinIaLocale({ dossier: inst.c.dossier, journal, role: 'cron' }).raison, 'en-service');
    const app = gestionnaire(inst, { attenteVerrouMs: 200, role: 'app' });
    await assert.rejects(app.executer(async () => true), e => e.code === 'ia-locale-occupee');
    assert.equal(app.etat().ailleurs, true);
    assert.equal(processusVivant(pid), true, 'inactivité (100 ms) dépassée mais requête en cours : moteur gardé');
    assert.equal((await requete).texte, '{"ok": true}');
    assert.equal(existsSync(inst.c.cle), true, 'clé intacte');
    // Après la requête : arrêt pour inactivité.
    await attendre(800);
    assert.equal(processusVivant(pid), false);
    assert.doesNotMatch(readFileSync(journal, 'utf8'), /orphelin/);
  } finally {
    inst.nettoyer();
  }
});

test('concurrence : moteur tué PENDANT une requête → code précis, signal journalisé, erreur visible de l’app ; jamais le verrou ni la clé d’un autre', async () => {
  const inst = installationFactice();
  const journal = join(inst.racine, 'moteur.log');
  const enfants = [];
  try {
    const fond = gestionnaire(inst, { inactiviteMs: 5000, role: 'travailleur' });
    const app = gestionnaire(inst, { role: 'app' });
    const requete = creerConnecteurLocal(fond, { fetch: fetchLocal }).discuter([{ role: 'user', content: 'LENT:5000' }]);
    while (!fond.etat().enMarche) await attendre(20);
    await attendre(200);
    process.kill(JSON.parse(readFileSync(inst.c.verrouServeur, 'utf8')).pid, 'SIGKILL');
    await assert.rejects(requete, e => ['ia-locale-coupee', 'ia-locale-arretee'].includes(e.code));
    await attendre(100);
    const texte = readFileSync(journal, 'utf8');
    assert.match(texte, /requête échouée après \d+ s : ia-locale-(coupee|arretee) \(cause [A-Z]+\)/);
    assert.match(texte, /arrêté de façon imprévue \(signal SIGKILL\)/);
    assert.ok(['ia-locale-coupee', 'ia-locale-arretee', 'ia-locale-arret'].includes(app.etat().derniereErreur?.code), 'erreur du processus de fond visible dans l’Administration IA');
    assert.equal(existsSync(inst.c.verrouServeur), false);
    // Redémarrage réussi : l'erreur est effacée partout.
    assert.equal((await creerConnecteurLocal(fond, { fetch: fetchLocal }).discuter([])).texte, '{"ok": true}');
    assert.equal(app.etat().derniereErreur, null);
    // Un autre processus a pris le moteur entre-temps (verrou et clé à lui) : la sortie de NOTRE moteur n'y touche pas.
    const pid = JSON.parse(readFileSync(inst.c.verrouServeur, 'utf8')).pid;
    const autre = JSON.stringify({ proprietaire: process.pid, jeton: 'autre', pid: null, majLe: new Date().toISOString() });
    writeFileSync(inst.c.verrouServeur, autre);
    writeFileSync(inst.c.cle, 'cle-de-l-autre\n');
    process.kill(pid, 'SIGKILL');
    await attendre(300);
    assert.equal(readFileSync(inst.c.verrouServeur, 'utf8'), autre);
    assert.equal(readFileSync(inst.c.cle, 'utf8'), 'cle-de-l-autre\n');
    // Nettoyage pendant qu'un autre processus remplace le verrou orphelin par le sien : le nouveau verrou et la nouvelle clé restent.
    const vieux = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
    enfants.push(vieux);
    writeFileSync(inst.c.verrouServeur, JSON.stringify({ proprietaire: 2 ** 22 + 12345, jeton: 'vieux', pid: vieux.pid, majLe: new Date(Date.now() - 3_600_000).toISOString() }));
    const nouveau = JSON.stringify({ proprietaire: process.pid, jeton: 'nouveau', pid: null, majLe: new Date().toISOString() });
    const n = nettoyerOrphelinIaLocale({
      dossier: inst.c.dossier,
      lire: () => {
        rmSync(inst.c.verrouServeur);
        writeFileSync(inst.c.verrouServeur, nouveau);
        writeFileSync(inst.c.cle, 'nouvelle-cle\n');
        return [];
      },
    });
    assert.equal(n.raison, 'remplace');
    assert.equal(readFileSync(inst.c.verrouServeur, 'utf8'), nouveau);
    assert.equal(readFileSync(inst.c.cle, 'utf8'), 'nouvelle-cle\n');
  } finally {
    for (const e of enfants) e.kill('SIGKILL');
    inst.nettoyer();
  }
});

test('processus de fond : verrou créé d’un coup avec son pid (jamais vide) ; un second processus renonce', () => {
  const inst = installationFactice();
  try {
    const ch = inst.c.verrouTravailleur;
    assert.equal(prendreVerrouTravailleur(ch, process.pid), true);
    assert.equal(readFileSync(ch, 'utf8'), String(process.pid));
    assert.equal(prendreVerrouTravailleur(ch, 999_999), false);
    assert.equal(readFileSync(ch, 'utf8'), String(process.pid));
    assert.deepEqual(readdirSync(inst.c.etat).filter(f => f.endsWith('.tmp')), []);
  } finally {
    inst.nettoyer();
  }
});

// ------------------------------------------------------------------ Choix du moteur dans le service

/** IA locale factice pour le service : connecteur local sur un faux moteur (réponses programmables). */
function fauxLocal(repondre = () => ({ ok: true })) {
  const appels = [];
  const lancements = [];
  const g = { executer: async (fn, o) => fn({ port: 41235, cle: 'k', limite: Date.now() + o.delai }), noterMesure: () => undefined };
  const fetch = async (url, init) => {
    const corps = JSON.parse(init.body);
    appels.push({ url, corps });
    const r = await repondre(corps);
    if (r && r.statut) return new Response('{}', { status: r.statut });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(r) } }], timings: { predicted_per_second: 5 } }), { status: 200 });
  };
  return {
    appels,
    lancements,
    local: {
      connecteur: creerConnecteurLocal(g, { modele: 'qwen2.5-7b', fetch }),
      disponible: () => true,
      raison: null,
      info: { modele: 'qwen2.5-7b', nomModele: 'Qwen2.5-7B-Instruct (Q4_K_M)', threads: 8, contexte: 16384, delaiMs: 60_000, benchmark: { jetonsParSeconde: 4.2, le: '2026-10-27T00:00:00.000Z' } },
      etat: () => ({ enMarche: false, file: 0 }),
      lancerTravailleur: () => {
        lancements.push(1);
        return { lance: true };
      },
    },
  };
}

function fauxApi(repondre = () => ({ ok: true })) {
  const appels = [];
  const fetch = async (url, init) => {
    appels.push({ url, corps: JSON.parse(init.body) });
    const r = await repondre();
    if (r && r.statut) return new Response('{}', { status: r.statut });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(r) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
  };
  return { appels, fetch };
}

const ENV_API = { IA_API_URL: 'https://ia-exemple.fr/v1', IA_API_CLE: 'cle-factice-de-test-0123456789', IA_MODELE: 'modele-exemple' };

test('choix du moteur : IA locale, clé d’API, locale d’abord (API en secours) ; plafond mensuel pour l’API seulement', async () => {
  let localEnPanne = false;
  const loc = fauxLocal(() => (localEnPanne ? { statut: 503 } : { ok: true }));
  const api = fauxApi();
  const b = await banc({ ia: { config: configIa(ENV_API), fetch: api.fetch, telecharger: async () => ({ statut: 404, corps: '' }), local: loc.local } });
  const f = await b.session('principal', 'Fondateur');
  let etat = (await b.appel('/jeux/ia', { jeton: f })).corps;
  assert.equal(etat.mode, 'api', 'une clé d’API existe : mode « api » par défaut');
  assert.deepEqual(etat.modesPossibles, ['local', 'api', 'local-api']);
  assert.equal(etat.local.installe, true);
  assert.equal(etat.local.nomModele, 'Qwen2.5-7B-Instruct (Q4_K_M)');
  assert.equal(etat.local.derniereVitesse.jetonsParSeconde, 4.2);
  assert.equal((await b.appel('/jeux/ia/reglages', { methode: 'PUT', jeton: f, corps: { mode: 'gpu' } })).corps.code, 'mode-ia');
  // Mode IA locale : l'appel va au moteur local (127.0.0.1), pas à l'API ; non compté dans le plafond.
  etat = (await b.appel('/jeux/ia/reglages', { methode: 'PUT', jeton: f, corps: { mode: 'local', quotaAppels: 1 } })).corps;
  assert.equal(etat.mode, 'local');
  for (let i = 0; i < 3; i++) assert.equal((await b.appel('/jeux/ia/test', { methode: 'POST', jeton: f })).corps.ok, true);
  assert.equal(loc.appels.length, 3);
  assert.equal(api.appels.length, 0);
  assert.equal(loc.appels[0].url, 'http://127.0.0.1:41235/v1/chat/completions');
  assert.equal(loc.appels[0].corps.response_format.type, 'json_schema');
  etat = (await b.appel('/jeux/ia', { jeton: f })).corps;
  assert.equal(etat.usage.appels, 0);
  assert.equal(etat.usage.appelsLocaux, 3);
  assert.equal(etat.dernierAppel.fournisseur, 'local');
  assert.equal(typeof etat.local.dernierTempsReponseMs, 'number');
  // Moteur local en panne, mode « local » : échec, pas de secours.
  localEnPanne = true;
  const t = (await b.appel('/jeux/ia/test', { methode: 'POST', jeton: f })).corps;
  assert.equal(t.ok, false);
  assert.equal(api.appels.length, 0);
  // Mode « locale d'abord » : l'API prend le relais (compté dans le plafond).
  await b.appel('/jeux/ia/reglages', { methode: 'PUT', jeton: f, corps: { mode: 'local-api' } });
  assert.equal((await b.appel('/jeux/ia/test', { methode: 'POST', jeton: f })).corps.ok, true);
  assert.equal(api.appels.length, 1);
  // Plafond d'API (1) atteint : l'API refuse ; le test ciblé « local » reste possible quand il remarche.
  localEnPanne = false;
  assert.equal((await b.appel('/jeux/ia/test', { methode: 'POST', jeton: f, corps: { cible: 'api' } })).corps.code, 'quota-ia');
  const tl = (await b.appel('/jeux/ia/test', { methode: 'POST', jeton: f, corps: { cible: 'local' } })).corps;
  assert.equal(tl.ok, true);
  assert.equal(tl.cible, 'local');
  // Mode « api » : le moteur local n'est plus appelé.
  await b.appel('/jeux/ia/reglages', { methode: 'PUT', jeton: f, corps: { mode: 'api', quotaAppels: 30 } });
  const avant = loc.appels.length;
  assert.equal((await b.appel('/jeux/ia/test', { methode: 'POST', jeton: f })).corps.ok, true);
  assert.equal(loc.appels.length, avant);
});

test('sans clé d’API : l’IA locale installée suffit (mode « local » par défaut) ; sans les deux, assistant coupé', async () => {
  const loc = fauxLocal();
  const b = await banc({ ia: { config: configIa({}), local: loc.local } });
  const f = await b.session('principal', 'Fondateur');
  const etat = (await b.appel('/jeux/ia', { jeton: f })).corps;
  assert.equal(etat.mode, 'local');
  assert.equal(etat.disponible, true);
  assert.deepEqual(etat.modesPossibles, ['local']);
  assert.equal((await b.appel('/jeux?tous=1', { jeton: f })).corps.ia.disponible, true);
  assert.equal((await b.appel('/jeux/ia/test', { methode: 'POST', jeton: f, corps: { cible: 'api' } })).corps.code, 'ia-non-configuree');
  // IA_FOURNISSEUR=local sans IA locale installée : coupé, raison « IA locale absente ».
  const absente = { ...loc.local, disponible: () => false, connecteur: null, raison: 'modele-absent' };
  const b2 = await banc({ ia: { config: configIa({ IA_FOURNISSEUR: 'local' }), local: absente } });
  const f2 = await b2.session('principal', 'Fondateur');
  const e2 = (await b2.appel('/jeux/ia', { jeton: f2 })).corps;
  assert.equal(e2.disponible, false);
  assert.equal(e2.mode, 'local');
  assert.equal(e2.local.installe, false);
  assert.equal((await b2.appel('/jeux/ia/brouillons', { methode: 'POST', jeton: f2, corps: { nom: 'Exemple' } })).corps.code, 'ia-locale-absente');
});

test('IA locale : brouillon avec consignes compactes et schéma ; adresses locales proposées par le modèle JAMAIS lues (SSRF inchangée)', async () => {
  const demandees = [];
  const loc = fauxLocal(corps => {
    const sys = corps.messages[0].content;
    if (/at most 3 https URLs/.test(sys)) return { urls: ['http://127.0.0.1:8080/v1/models', 'https://127.0.0.1/x', 'https://localhost/y', 'https://wiki-exemple.fr/jeu'] };
    return { nom: 'Exemple Arena', couleur: '#3366cc', profil: { formats: [{ cle: '5v5', nom: '5v5', equipes: 2, joueursParEquipe: 5, bo: [1] }], score: { type: 'rounds', roundsGagnants: 13 }, modes: [], cartes: [], classes: [], personnages: [], roster: { titulaires: 5, remplacants: 1 }, rolesJoueurs: [] }, sources: [], incertitudes: [] };
  });
  const telecharger = async url => {
    demandees.push(url);
    return { statut: 200, type: 'text/html', location: null, corps: '<title>Wiki</title><p>Exemple Arena : 5v5.</p>' };
  };
  const b = await banc({ ia: { config: configIa({ IA_FOURNISSEUR: 'local' }), telecharger, local: loc.local } });
  const f = await b.session('principal', 'Fondateur');
  const r = (await b.appel('/jeux/ia/brouillons', { methode: 'POST', jeton: f, corps: { nom: 'Exemple Arena' } })).corps;
  assert.equal(r.statut, 'pret', JSON.stringify(r.erreur));
  assert.deepEqual(demandees, ['https://wiki-exemple.fr/jeu'], 'seule l’adresse https publique est lue');
  assert.match(loc.appels[1].corps.messages[0].content, /FAKE game/);
  assert.equal(loc.appels[1].corps.response_format.json_schema.schema.required.includes('profil'), true);
  // La garde SSRF n'a pas d'exception pour 127.0.0.1 (réservée au moteur géré, hors de recherche.mjs).
  assert.throws(() => verifierAdresseHttps('http://127.0.0.1:41235/v1/chat/completions'));
  assert.throws(() => verifierAdresseHttps('https://127.0.0.1:41235/v1/chat/completions'));
  await assert.rejects(recupererPage('https://127.0.0.1/', { telecharger }));
  assert.deepEqual(lireAdresses('{"urls": ["http://127.0.0.1:8080/", "https://[::1]/", "https://wiki-exemple.fr/a"]}'), ['https://wiki-exemple.fr/a']);
});

test('IA locale : travaux confiés au PROCESSUS DE FOND (pas à l’app Passenger) ; le cron le relance ; exécution par le processus', async () => {
  const base = await baseMigree();
  const horloge = { t: Date.parse('2026-10-20T10:00:00.000Z') };
  const loc = fauxLocal(corps => (/at most 3/.test(corps.messages[0].content) ? { urls: [] } : { nom: 'Exemple Arena', couleur: '#3366cc', profil: { formats: [{ cle: '5v5', nom: '5v5', equipes: 2, joueursParEquipe: 5, bo: [1] }], score: { type: 'rounds' }, modes: [], cartes: [], classes: [], personnages: [], roster: { titulaires: 5, remplacants: 1 }, rolesJoueurs: [] }, sources: [], incertitudes: [] }));
  const ia = { config: configIa({ IA_FOURNISSEUR: 'local' }), telecharger: async () => ({ statut: 404, corps: '' }), local: loc.local };
  const fondateur = { compte: 'principal', superAdmin: true };
  const app = servicesJeux({ base, maintenant: () => horloge.t, socle: {}, ia, travauxIa: 'fond', journal: silencieux });
  const w = await app.lancerBrouillon(fondateur, { nom: 'Exemple Arena' });
  assert.equal(w.statut, 'attente');
  assert.equal(loc.lancements.length, 1, 'processus de fond lancé');
  assert.equal(loc.appels.length, 0, 'rien n’est calculé dans l’app');
  // Le cron ne calcule pas : il dit qu'il y a du travail (et lancera le processus de fond).
  const cron = await servicesJeux({ base, maintenant: () => horloge.t, socle: {}, ia, travauxIa: 'synchrone', journal: silencieux }).tacheCron();
  assert.deepEqual(cron, { n: 0, raison: 'ia-locale', aFaire: 1 });
  // Le processus de fond exécute le travail tout de suite.
  const fond = servicesJeux({ base, maintenant: () => horloge.t, socle: {}, ia, travauxIa: 'synchrone', journal: silencieux });
  const r = await fond.tacheCron({ executionLocale: true, limite: 0 });
  assert.equal(r.n, 1);
  assert.equal((await app.travail(fondateur, w.id)).statut, 'pret');
  // Mode API : le processus de fond n'a rien à faire.
  await app.reglerIa(fondateur, { mode: 'api' });
  assert.equal((await fond.tacheCron({ executionLocale: true })).n, 0);
  await base.fermer?.();
});

test('processus de fond : travaille tant qu’il y a du travail, attend puis s’arrête après inactivité (moteur arrêté) ; durée bornée', async () => {
  const t = { v: 0 };
  const sequence = [{ n: 1 }, { n: 2 }, { n: 0 }, { n: 0 }, { n: 1 }, { n: 0 }, { n: 0 }, { n: 0 }];
  const limites = [];
  const jeux = { tacheCron: async o => (limites.push(o.limite), { ...(sequence.shift() ?? { n: 0 }) }) };
  let arrete = 0;
  const r = await executerTravailleur({ jeux, local: { arreter: async () => arrete++ }, inactiviteMs: 40_000, horloge: () => t.v, dormir: async ms => (t.v += ms), journal: silencieux });
  assert.equal(r.travaux, 4);
  assert.equal(r.raison, 'inactivite');
  assert.equal(arrete, 1, 'moteur arrêté à la fin');
  assert.equal(limites[0], 1, 'au plus une vérification automatique, au premier passage');
  assert.ok(limites.slice(1).every(l => l === 0));
  // Durée de vie bornée.
  const t2 = { v: 0 };
  const r2 = await executerTravailleur({ jeux: { tacheCron: async () => (t2.v += 60_000, { n: 1 }) }, local: { arreter: async () => undefined }, dureeMaxMs: 300_000, horloge: () => t2.v, dormir: async () => undefined });
  assert.equal(r2.raison, 'duree');
  // Erreur : moteur arrêté quand même.
  let a3 = 0;
  const r3 = await executerTravailleur({ jeux: { tacheCron: async () => { throw new Error('base'); } }, local: { arreter: async () => a3++ }, journal: silencieux });
  assert.equal(r3.raison, 'erreur');
  assert.equal(a3, 1);
});

test('lanceur du processus de fond : détaché, nice, arguments fixes ; pas de doublon ; rien si non installée', () => {
  const inst = installationFactice();
  try {
    const lances = [];
    const spawnFaux = (cmd, args, o) => {
      lances.push({ cmd, args, o });
      return { pid: 4242, unref: () => undefined, on: () => undefined };
    };
    const reglages = { dossier: inst.c.dossier, installation: { installe: true } };
    assert.equal(lancerTravailleurIaLocale({ reglages: { dossier: inst.c.dossier, installation: { installe: false } }, spawn: spawnFaux }).lance, false);
    const r = lancerTravailleurIaLocale({ reglages, spawn: spawnFaux, fichierJournal: join(inst.racine, 'fond.log') });
    assert.equal(r.lance, true);
    assert.equal(lances[0].o.detached, true);
    assert.equal(lances[0].o.shell, undefined);
    assert.ok(lances[0].args.some(a => a.endsWith('travailleur.mjs')));
    // Verrou tenu par un processus vivant (ici : ce processus de test) : pas de second processus.
    writeFileSync(inst.c.verrouTravailleur, String(process.pid));
    assert.deepEqual(lancerTravailleurIaLocale({ reglages, spawn: spawnFaux, fichierJournal: join(inst.racine, 'fond.log') }), { lance: false, raison: 'déjà en cours', pid: process.pid });
    assert.equal(lances.length, 1);
  } finally {
    inst.nettoyer();
  }
});

// ------------------------------------------------------------------ Installation (sans téléchargement réel)

test('installation : état lu de pret.json (binaire dans moteur/, tailles), dossier refusé dans public_html ou le dépôt', () => {
  const inst = installationFactice();
  try {
    assert.equal(etatInstallationIaLocale({ dossier: inst.c.dossier }).raison, 'non-installee');
    const pret = { version: 1, moteur: { binaire: inst.binaire, version: 'b11351', route: 'compilation' }, modeles: { 'qwen2.5-7b': { fichiers: [{ nom: 'faux.gguf', taille: 12 }] } }, benchmark: { 'qwen2.5-7b': { jetonsParSeconde: 5.1 } } };
    writeFileSync(inst.c.pret, JSON.stringify(pret));
    const e = etatInstallationIaLocale({ dossier: inst.c.dossier });
    assert.equal(e.installe, true);
    assert.equal(e.fichierModele, inst.fichierModele);
    assert.equal(e.benchmark.jetonsParSeconde, 5.1);
    assert.equal(etatInstallationIaLocale({ dossier: inst.c.dossier, modele: 'qwen3-4b' }).raison, 'modele-absent');
    writeFileSync(inst.c.pret, JSON.stringify({ ...pret, moteur: { binaire: '/bin/sh' } }));
    assert.equal(etatInstallationIaLocale({ dossier: inst.c.dossier }).raison, 'moteur-absent', 'binaire hors du dossier moteur refusé');
    writeFileSync(inst.c.pret, JSON.stringify({ ...pret, modeles: { 'qwen2.5-7b': { fichiers: [{ nom: '../faux.gguf', taille: 12 }] } } }));
    assert.equal(etatInstallationIaLocale({ dossier: inst.c.dossier }).raison, 'modele-absent');
    assert.match(dossierRefuse('/home/u/public_html/ia', null), /public_html/);
    assert.match(dossierRefuse('/home/u/application-enzo/x', '/home/u/application-enzo'), /dépôt/);
    assert.match(dossierRefuse('relatif', null), /absolu/);
    assert.equal(dossierRefuse('/home/u/.appdashboard/ia-locale', '/home/u/application-enzo'), null);
    // Service : objet « local » prêt (connecteur), ou indisponible avec la raison.
    writeFileSync(inst.c.pret, JSON.stringify(pret));
    const l = creerIaLocale({ ...configIaLocale({}), dossier: inst.c.dossier, installation: etatInstallationIaLocale({ dossier: inst.c.dossier }) }, { role: 'app', journal: silencieux });
    assert.equal(l.disponible(), true);
    assert.equal(l.info.benchmark.jetonsParSeconde, 5.1);
    const n = creerIaLocale({ ...configIaLocale({}), dossier: inst.c.dossier, installation: { installe: false, raison: 'non-installee' } });
    assert.equal(n.disponible(), false);
    assert.equal(n.connecteur, null);
  } finally {
    inst.nettoyer();
  }
});

test('installateur : options, liste figée des paquets (SHA-256), recommandation, téléchargement avec reprise et vérification', async () => {
  assert.equal(lireOptions(['--petit', '--test']).modele, 'qwen3-4b');
  assert.throws(() => lireOptions(['--threads', '0']));
  assert.throws(() => lireOptions(['--modele', 'llama-70b']));
  assert.throws(() => lireOptions(['--revision', 'main; rm -rf ~']));
  assert.throws(() => lireOptions(['--inconnue']));
  const paquets = lirePaquetsOutils();
  assert.ok(paquets.length >= 30);
  assert.ok(paquets.every(p => /^[0-9a-f]{64}$/.test(p.sha256) && p.url.startsWith('https://conda.anaconda.org/conda-forge/')));
  assert.throws(() => lirePaquetsOutils('https://exemple.fr/x.conda#abc'));
  assert.equal(recommandation({ jetonsParSeconde: 10, lectureParSeconde: 80, modele: 'qwen2.5-7b' }).niveau, 'bon');
  assert.match(recommandation({ jetonsParSeconde: 4, lectureParSeconde: 40, modele: 'qwen2.5-7b' }).texte, /--petit/);
  assert.equal(recommandation({ jetonsParSeconde: 1, lectureParSeconde: 10, modele: 'qwen3-4b' }).niveau, 'lent');
  // Faux serveur de fichiers : coupure au milieu, reprise par Range, SHA-256 vérifié.
  const racine = mkdtempSync(join(tmpdir(), 'esport-ia-dl-'));
  try {
    const contenu = Buffer.from('0123456789'.repeat(1000));
    const sha256 = createHash('sha256').update(contenu).digest('hex');
    const requetes = [];
    let couper = true;
    const fetch = async (url, init) => {
      const range = init.headers?.Range;
      requetes.push(range ?? null);
      const debut = range ? Number(/bytes=(\d+)-/.exec(range)[1]) : 0;
      const morceau = contenu.subarray(debut);
      if (couper) {
        couper = false;
        // Envoie la moitié puis coupe la connexion.
        const flux = new ReadableStream({ start(c) { c.enqueue(morceau.subarray(0, 4000)); setTimeout(() => c.error(new Error('connexion coupée')), 50); } });
        return new Response(flux, { status: 200, headers: { 'content-length': String(morceau.length) } });
      }
      return new Response(morceau, { status: range ? 206 : 200 });
    };
    const dest = join(racine, 'modele.gguf');
    const r = await telechargerVerifie('https://exemple.fr/modele.gguf', dest, { sha256, taille: contenu.length, fetch, journal: () => undefined });
    assert.equal(r.deja, false);
    assert.deepEqual(requetes, [null, 'bytes=4000-']);
    assert.ok(readFileSync(dest).equals(contenu));
    assert.equal((await telechargerVerifie('https://exemple.fr/modele.gguf', dest, { sha256, taille: contenu.length, fetch, journal: () => undefined })).deja, true);
    // Empreinte fausse : refus, fichier partiel effacé.
    const autre = join(racine, 'autre.gguf');
    await assert.rejects(telechargerVerifie('https://exemple.fr/a', autre, { sha256: 'f'.repeat(64), taille: contenu.length, fetch, journal: () => undefined }), /SHA-256/);
    assert.equal(existsSync(autre) || existsSync(`${autre}.partiel`), false);
    await assert.rejects(telechargerVerifie('https://exemple.fr/a', autre, { sha256: undefined, fetch }), /SHA-256/);
  } finally {
    rmSync(racine, { recursive: true, force: true });
  }
});
