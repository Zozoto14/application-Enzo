/**
 * IA locale : qui tue le moteur ? Reproduit les journaux du serveur (deux moteurs, SIGKILL, « fetch failed ») avec
 * de faux moteurs et une VISIBILITÉ DE PID SIMULÉE (CageFS : l'app, le cron et SSH ne se voient pas forcément), et
 * vérifie : bail plutôt que kill(pid, 0), aucun signal sans identité certaine, SIGTERM avant SIGKILL, chaque signal
 * journalisé, un seul moteur par compte, et le mode --diagnostic (« tué par nous » / « tué par l'extérieur »).
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { conclusion, diagnostic, essaiVariante, etatCompte, verdictVariante } from '../serveur/ia-locale/diagnostic.mjs';
import { creerGestionnaireIaLocale, nettoyerOrphelinIaLocale, verrouActif } from '../serveur/ia-locale/gestionnaire.mjs';
import { cheminsIaLocale } from '../serveur/ia-locale/installation.mjs';
import { causeReelle } from '../serveur/ia-locale/installer.mjs';
import { lancerTravailleurIaLocale, travailleurActif } from '../serveur/ia-locale/lanceur.mjs';
import { envoyerSignal, espacePid, identifiantDemarrage, identiteProcessus, mortCertaine, processusVivant, signauxEnvoyesA, sonderMoteur } from '../serveur/ia-locale/processus.mjs';
import { creerConnecteurLocal } from '../noyau/ia/connecteur.mjs';
import { fetchLocal } from '../serveur/ia-locale/transport.mjs';

const attendre = ms => new Promise(ok => setTimeout(ok, ms));
const silencieux = { log: () => undefined, warn: () => undefined, error: () => undefined };
const PID_ABSENT = 2 ** 22 + 4321;
const AUTRE_ESPACE = 'pid:[4026500001]';

/**
 * Faux llama-server : --host 127.0.0.1 ou socket Unix (« ….sock »), clé exigée (sauf /health), /tokenize,
 * /completion et /v1/chat/completions en flux. Modèles : « tue-calcul.gguf » se tue (SIGKILL) au premier calcul ;
 * « tetu.gguf » ignore SIGTERM.
 */
const SCRIPT = `
import http from 'node:http';
import { readFileSync } from 'node:fs';
const a = process.argv.slice(2);
const opt = n => a[a.indexOf(n) + 1];
const modele = opt('-m');
const cle = readFileSync(opt('--api-key-file'), 'utf8').trim();
const s = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200); res.end('{"status":"ok"}'); return; }
  if (req.headers.authorization !== 'Bearer ' + cle) { res.writeHead(401); res.end('{}'); return; }
  let corps = '';
  req.on('data', d => (corps += d));
  req.on('end', () => {
    if (req.url === '/tokenize') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"tokens":[1]}'); return; }
    if (modele.endsWith('tue-calcul.gguf')) { console.error('calcul : début'); process.kill(process.pid, 'SIGKILL'); }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    let i = 0;
    const t = setInterval(() => {
      res.write('data: {"content":"mot ' + i++ + '"}\\n\\n');
      if (i >= 20) { clearInterval(t); res.end('data: [DONE]\\n\\n'); }
    }, 20);
    res.on('close', () => clearInterval(t));
  });
});
const hote = opt('--host');
if (hote.endsWith('.sock')) s.listen(hote); else s.listen(Number(opt('--port')), hote);
console.error('serveur prêt');
process.on('SIGTERM', () => { if (!modele.endsWith('tetu.gguf')) process.exit(0); });
`;

function installation() {
  const racine = mkdtempSync(join(tmpdir(), 'ia-sig-'));
  const c = cheminsIaLocale(join(racine, 'ia'));
  for (const d of [c.moteur, c.modeles, c.etat]) mkdirSync(d, { recursive: true });
  const script = join(racine, 'faux.mjs');
  writeFileSync(script, SCRIPT);
  const binaire = join(c.moteur, 'llama-server');
  writeFileSync(binaire, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
  chmodSync(binaire, 0o755);
  const modele = nom => {
    const f = join(c.modeles, nom);
    writeFileSync(f, 'GGUF');
    return f;
  };
  return { racine, c, binaire, fichierModele: modele('faux.gguf'), modele, journal: join(racine, 'ia.log'), nettoyer: () => rmSync(racine, { recursive: true, force: true }) };
}

const gestionnaire = (inst, o = {}) =>
  creerGestionnaireIaLocale({ dossier: inst.c.dossier, binaire: inst.binaire, fichierModele: inst.fichierModele, threads: 2, contexte: 4096, inactiviteMs: 60_000, demarrageMs: 15_000, attenteVerrouMs: 300, journal: inst.journal, log: silencieux, pauseApresArretMs: 50, nice: 0, graceMs: 500, ...o });

const lireVerrou = inst => JSON.parse(readFileSync(inst.c.verrouServeur, 'utf8'));
const journal = inst => (existsSync(inst.journal) ? readFileSync(inst.journal, 'utf8') : '');

// ------------------------------------------------------------------ Mort certaine (visibilité des processus)

test('mort certaine : seulement dans le même espace de pid (ou machine redémarrée) ; sinon « on ne sait pas »', () => {
  const ici = { ns: 'pid:[1]', boot: 'b1' };
  const invisible = { identite: () => null, vivant: () => false, ...ici };
  // L'ancien critère (kill(pid, 0) → ESRCH) : un propriétaire d'un AUTRE espace paraît mort alors qu'il vit.
  assert.equal(processusVivant(PID_ABSENT), false);
  assert.equal(mortCertaine(1234, { ns: 'pid:[2]', boot: 'b1', debut: '10' }, invisible), false, 'autre espace : jamais déclaré mort');
  assert.equal(mortCertaine(1234, null, invisible), false, 'ancien verrou sans description : on ne sait pas');
  assert.equal(mortCertaine(1234, { ns: 'pid:[1]', boot: 'b1', debut: '10' }, invisible), true, 'même espace et disparu : mort');
  assert.equal(mortCertaine(1234, { ns: 'pid:[1]', boot: 'b1', debut: '10' }, { ...ici, identite: () => ({ debut: '99' }) }), true, 'pid réutilisé');
  assert.equal(mortCertaine(1234, { ns: 'pid:[1]', boot: 'b1', debut: '10' }, { ...ici, identite: () => ({ debut: '10' }) }), false, 'vivant');
  assert.equal(mortCertaine(1234, { ns: 'pid:[2]', boot: 'b0' }, invisible), true, 'machine redémarrée');
  // Bail : un verrou récent d'un propriétaire invisible reste actif ; un verrou sans battement depuis 3 min ne l'est plus.
  const v = { proprietaire: PID_ABSENT, ns: AUTRE_ESPACE, majLe: new Date().toISOString() };
  assert.equal(verrouActif(v), true);
  assert.equal(verrouActif({ ...v, majLe: new Date(Date.now() - 4 * 60_000).toISOString() }), false);
  assert.equal(verrouActif({ ...v, ns: espacePid() }), false, 'même espace que nous et disparu : mort certaine');
  assert.equal(identiteProcessus(process.pid).ns, espacePid());
  assert.ok(identifiantDemarrage() === null || typeof identifiantDemarrage() === 'string');
});

// ------------------------------------------------------------------ Le scénario des journaux du serveur

test('scénario du serveur : moteur de l’app, propriétaire INVISIBLE pour le travailleur (CageFS) → ni signal, ni second moteur', async () => {
  const inst = installation();
  try {
    const app = gestionnaire(inst, { role: 'app' });
    await app.executer(async () => true);
    const pidMoteur = lireVerrou(inst).pid;
    // Ce que voit le travailleur lancé par le cron : le propriétaire (l'app) est dans un autre espace de pid ;
    // kill(pid, 0) → ESRCH. L'ancien code concluait « orphelin », retirait verrou et clé et lançait un SECOND moteur.
    writeFileSync(inst.c.verrouServeur, JSON.stringify({ ...lireVerrou(inst), proprietaire: PID_ABSENT, ns: AUTRE_ESPACE }));
    assert.equal(processusVivant(PID_ABSENT), false);
    const travailleur = gestionnaire(inst, { role: 'travailleur' });
    await assert.rejects(travailleur.executer(async () => 'second moteur !'), e => e.code === 'ia-locale-occupee' && e.occupant?.role === 'app');
    assert.equal((await nettoyerOrphelinIaLocale({ dossier: inst.c.dossier, journal: inst.journal, role: 'cron' })).raison, 'en-service');
    assert.equal(processusVivant(pidMoteur), true, 'moteur de l’app intact');
    assert.equal(existsSync(inst.c.cle), true, 'clé intacte');
    assert.doesNotMatch(journal(inst), /signal SIG|orphelin/);
    await app.arreter();
  } finally {
    inst.nettoyer();
  }
});

test('bail expiré mais moteur HORS DE PORTÉE (invisible d’ici) qui répond encore → aucun signal, verrou gardé, aucun second moteur', async () => {
  const inst = installation();
  try {
    const app = gestionnaire(inst, { role: 'app' });
    await app.executer(async () => true);
    const pidMoteur = lireVerrou(inst).pid;
    writeFileSync(inst.c.verrouServeur, JSON.stringify({ ...lireVerrou(inst), proprietaire: PID_ABSENT, ns: AUTRE_ESPACE, majLe: new Date(Date.now() - 10 * 60_000).toISOString() }));
    const invisible = { identite: () => null };
    assert.equal(await sonderMoteur(lireVerrou(inst).port, readFileSync(inst.c.cle, 'utf8').trim()), 'notre');
    const n = await nettoyerOrphelinIaLocale({ dossier: inst.c.dossier, journal: inst.journal, role: 'cron', systeme: invisible });
    assert.equal(n.raison, 'hors-de-portee');
    assert.equal(existsSync(inst.c.verrouServeur), true);
    const autre = gestionnaire(inst, { role: 'installateur', systeme: invisible });
    await assert.rejects(autre.executer(async () => true), e => e.code === 'ia-locale-occupee');
    assert.equal(processusVivant(pidMoteur), true);
    assert.doesNotMatch(journal(inst), /signal SIG/);
    assert.match(journal(inst), /ENCORE EN MARCHE et hors de portée d'ici/);
    // Le moteur s'arrête enfin (ici : son vrai propriétaire) : le port ne répond plus → verrou repris normalement.
    await app.arreter();
    writeFileSync(inst.c.verrouServeur, JSON.stringify({ proprietaire: PID_ABSENT, ns: AUTRE_ESPACE, jeton: 'vieux', pid: pidMoteur, port: n.port ?? 1, majLe: new Date(Date.now() - 10 * 60_000).toISOString() }));
    assert.equal(await autre.executer(async () => 'à mon tour'), 'à mon tour');
    await autre.arreter();
  } finally {
    inst.nettoyer();
  }
});

test('bail expiré mais propriétaire VISIBLE et vivant (suspendu) → son moteur n’est pas touché', async () => {
  const inst = installation();
  try {
    const g = gestionnaire(inst, { role: 'installateur' });
    await g.executer(async () => true);
    const pidMoteur = lireVerrou(inst).pid;
    writeFileSync(inst.c.verrouServeur, JSON.stringify({ ...lireVerrou(inst), majLe: new Date(Date.now() - 10 * 60_000).toISOString() }));
    assert.equal((await nettoyerOrphelinIaLocale({ dossier: inst.c.dossier, journal: inst.journal, role: 'cron' })).raison, 'proprietaire-vivant');
    assert.equal(processusVivant(pidMoteur), true);
    assert.doesNotMatch(journal(inst), /signal SIG/);
    await g.arreter();
  } finally {
    inst.nettoyer();
  }
});

test('moteur visible lancé avec notre clé mais inscrit à AUCUN verrou → arrêté (SIGTERM journalisé) avant d’en lancer un : jamais deux moteurs', async () => {
  const inst = installation();
  const enfants = [];
  try {
    writeFileSync(inst.c.cle, 'ancienne\n');
    const reste = spawn(inst.binaire, ['-m', inst.fichierModele, '--host', '127.0.0.1', '--port', '0', '--api-key-file', inst.c.cle], { stdio: 'ignore' });
    enfants.push(reste);
    await attendre(300);
    const parti = new Promise(ok => reste.once('exit', (code, signal) => ok({ code, signal })));
    const g = gestionnaire(inst, { role: 'app' });
    await g.executer(async () => true);
    assert.deepEqual(await parti, { code: 0, signal: null }, 'SIGTERM, sortie propre');
    assert.match(journal(inst), new RegExp(`\\(app, pid ${process.pid}\\) : signal SIGTERM envoyé à pid ${reste.pid} \\(moteur sans propriétaire\\)`));
    await g.arreter();
  } finally {
    for (const e of enfants) e.kill('SIGKILL');
    inst.nettoyer();
  }
});

// ------------------------------------------------------------------ Nos signaux, journalisés ; ceux des autres, reconnus

test('nos arrêts : SIGTERM journalisé (qui, pourquoi, pid), SIGKILL seulement si le moteur résiste ; sortie notée « à notre demande »', async () => {
  const inst = installation();
  try {
    const g = gestionnaire(inst, { role: 'travailleur', inactiviteMs: 200 });
    await g.executer(async () => true);
    const pid = lireVerrou(inst).pid;
    await attendre(900);
    const t = journal(inst);
    assert.match(t, new RegExp(`\\(travailleur, pid ${process.pid}\\) : signal SIGTERM envoyé à pid ${pid} \\(moteur\\) : inactivité \\(0 s sans requête\\)`));
    assert.match(t, new RegExp(`moteur pid ${pid} arrêté à notre demande \\(code 0\\)`));
    assert.doesNotMatch(t, /SIGKILL/);
    // Moteur qui ignore SIGTERM : SIGKILL après le délai de grâce, journalisé lui aussi.
    const g2 = gestionnaire(inst, { role: 'installateur', fichierModele: inst.modele('tetu.gguf') });
    await g2.executer(async () => true);
    const pid2 = lireVerrou(inst).pid;
    await g2.arreter('fin du banc d’essai');
    const t2 = journal(inst);
    assert.match(t2, new RegExp(`signal SIGTERM envoyé à pid ${pid2} \\(moteur\\) : fin du banc d’essai`));
    assert.match(t2, new RegExp(`signal SIGKILL envoyé à pid ${pid2} \\(moteur\\) : fin du banc d’essai ; toujours là 1 s après SIGTERM`));
    assert.match(t2, new RegExp(`moteur pid ${pid2} arrêté à notre demande \\(signal SIGKILL\\)`));
    assert.equal(signauxEnvoyesA(inst.journal, pid2).length, 2);
  } finally {
    inst.nettoyer();
  }
});

test('« fetch failed » sans mort journalisée (course avec l’arrêt) : un SIGKILL venu d’ailleurs est reconnu même pendant notre arrêt', async () => {
  const inst = installation();
  try {
    const g = gestionnaire(inst, { role: 'installateur' });
    await g.executer(async () => true);
    const pid = lireVerrou(inst).pid;
    // L'hébergeur tue le moteur ; la requête échoue et l'installateur arrête le moteur AVANT d'avoir vu sa sortie.
    process.kill(pid, 'SIGKILL');
    await g.arreter('fin du banc d’essai');
    assert.match(journal(inst), new RegExp(`moteur pid ${pid} arrêté de façon imprévue pendant son arrêt \\(signal SIGKILL : arrêté de force par un autre processus ou par l’hébergeur ; nous lui avions envoyé seulement SIGTERM\\)`));
  } finally {
    inst.nettoyer();
  }
});

test('installateur : cause réelle d’un échec (signal, aucun signal de notre part, dernières lignes du moteur) au lieu de « fetch failed »', async () => {
  const inst = installation();
  try {
    const g = gestionnaire(inst, { role: 'installateur', fichierModele: inst.modele('tue-calcul.gguf') });
    const debut = new Date().toISOString();
    let pid;
    const e = await g
      .executer(async p => {
        pid = p.pid;
        return fetchLocal(`http://127.0.0.1:${p.port}/v1/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${p.cle}` }, body: '{}' });
      })
      .then(
        () => null,
        x => x,
      );
    assert.equal(e?.message, 'fetch failed');
    const lignes = (await causeReelle(e, { g, pid, journal: inst.journal, depuis: debut })).join('\n');
    assert.match(lignes, new RegExp(`moteur pid ${pid} arrêté : signal SIGKILL — arrêté de force par un autre processus ou par l’hébergeur`));
    assert.match(lignes, /signaux envoyés à ce moteur par nos programmes : aucun/);
    assert.match(lignes, /\| calcul : début/);
    await g.arreter();
  } finally {
    inst.nettoyer();
  }
});

test('connecteur : moteur tué de l’extérieur pendant le calcul → ia-locale-tuee (message neutre, sans « mémoire »)', async () => {
  const inst = installation();
  try {
    const g = gestionnaire(inst, { role: 'travailleur', fichierModele: inst.modele('tue-calcul.gguf') });
    await assert.rejects(creerConnecteurLocal(g, { fetch: fetchLocal }).discuter([{ role: 'user', content: 'x' }]), e => e.code === 'ia-locale-tuee' && !/mémoire/.test(e.message));
    await g.arreter();
  } finally {
    inst.nettoyer();
  }
});

// ------------------------------------------------------------------ Processus de fond

test('processus de fond INVISIBLE (autre espace de pid) mais battement récent → pas de second processus de fond, aucun signal', () => {
  const inst = installation();
  try {
    const lances = [];
    const spawnFaux = (cmd, args, o) => {
      lances.push({ cmd, args, o });
      return { pid: 4242, unref: () => undefined, on: () => undefined };
    };
    const reglages = { dossier: inst.c.dossier, installation: { installe: true } };
    writeFileSync(inst.c.verrouTravailleur, JSON.stringify({ pid: PID_ABSENT, ns: AUTRE_ESPACE }));
    // Ancien critère (processusVivant) : mort → un second processus de fond, un second moteur.
    assert.equal(travailleurActif(inst.c.verrouTravailleur), PID_ABSENT);
    assert.deepEqual(lancerTravailleurIaLocale({ reglages, spawn: spawnFaux, fichierJournal: inst.journal }), { lance: false, raison: 'déjà en cours', pid: PID_ABSENT });
    // Même espace que nous et disparu : mort certaine → relancé.
    writeFileSync(inst.c.verrouTravailleur, JSON.stringify({ pid: PID_ABSENT, ns: espacePid() }));
    assert.equal(lancerTravailleurIaLocale({ reglages, spawn: spawnFaux, fichierJournal: inst.journal }).lance, true);
    // Sans battement depuis 10 min, invisible : verrou retiré, AUCUN signal (pas identifié).
    writeFileSync(inst.c.verrouTravailleur, JSON.stringify({ pid: PID_ABSENT, ns: AUTRE_ESPACE }));
    const vieux = new Date(Date.now() - 11 * 60_000);
    utimesSync(inst.c.verrouTravailleur, vieux, vieux);
    assert.equal(lancerTravailleurIaLocale({ reglages, spawn: spawnFaux, fichierJournal: inst.journal }).lance, true);
    assert.equal(lances.length, 2);
    assert.doesNotMatch(journal(inst), /signal SIG/);
  } finally {
    inst.nettoyer();
  }
});

// ------------------------------------------------------------------ --diagnostic

const diag = (inst, o = {}) => ({ dossier: inst.c.dossier, binaire: inst.binaire, fichierModele: inst.fichierModele, modele: 'qwen3-4b', threads: 2, dureeS: 1, nice: 0, journal: inst.journal, ecrire: () => undefined, lister: () => [], reposMs: 150, pauseMs: 10, ...o });

test('diagnostic : moteur seul qui tient (http, socket Unix sans port, un fil) ; cli absent signalé ; verrous rendus', async () => {
  const inst = installation();
  try {
    const sortie = [];
    const r = await diagnostic(diag(inst, { ecrire: l => sortie.push(l) }));
    assert.equal(r.verdict, 'LE MOTEUR TIENT');
    assert.deepEqual(r.resultats.map(x => [x.nom, x.verdict]), [['http', 'tenu'], ['socket', 'tenu'], ['un-fil', 'tenu'], ['cli', 'indisponible']]);
    assert.ok(r.resultats.filter(x => x.tenu).every(x => x.jetons > 0), `du calcul a eu lieu ${JSON.stringify(r.resultats.map(x => [x.nom, x.jetons, x.lignes]))}`);
    assert.equal(r.resultats.find(x => x.nom === 'un-fil').fils, 1);
    assert.equal(r.support, null);
    assert.equal(existsSync(inst.c.verrouServeur), false);
    assert.equal(existsSync(inst.c.verrouTravailleur), false);
    assert.equal(existsSync(inst.c.cle), false);
    assert.match(sortie.join('\n'), /aucun autre de nos processus d’IA actif/);
    // Nos propres SIGTERM de fin de variante sont journalisés.
    assert.equal((journal(inst).match(/signal SIGTERM envoyé à pid \d+ \(moteur du diagnostic\) : fin de la variante/g) ?? []).length, 3);
  } finally {
    inst.nettoyer();
  }
});

test('diagnostic : SIGKILL sans aucun signal de nos programmes → « TUÉ PAR L’EXTÉRIEUR » + message pour le support (sans secret)', async () => {
  const inst = installation();
  try {
    const r = await diagnostic(diag(inst, { fichierModele: inst.modele('tue-calcul.gguf'), variantes: ['http', 'socket'] }));
    assert.equal(r.verdict, 'TUÉ PAR L’EXTÉRIEUR');
    assert.ok(r.resultats.every(x => x.verdict === 'exterieur' && x.mort.phase === 'calcul'));
    assert.ok(r.lignes.some(l => /ce n’est PAS le port en écoute/.test(l)));
    assert.match(r.support, /SIGKILL/);
    assert.match(r.support, /variante « socket »/);
    assert.doesNotMatch(r.support, /127\.0\.0\.1:\d|Bearer|\/home\//);
    assert.match(journal(inst), /diagnostic : fin — TUÉ PAR L’EXTÉRIEUR/);
  } finally {
    inst.nettoyer();
  }
});

test('diagnostic : un de NOS programmes envoie le signal → « TUÉ PAR NOUS » (ligne du journal à l’appui)', async () => {
  const inst = installation();
  try {
    const c = inst.c;
    // Un « autre de nos programmes » (ici simulé) vise le moteur dès son lancement, en journalisant comme notre code.
    const spawnEspion = (cmd, args, o) => {
      const e = spawn(cmd, args, o);
      setTimeout(() => envoyerSignal(e.pid, 'SIGKILL', { cible: 'moteur orphelin', raison: 'test', journal: inst.journal, role: 'cron' }), 400);
      return e;
    };
    const r = await essaiVariante({ nom: 'http', c, binaire: inst.binaire, fichierModele: inst.fichierModele, threads: 2, dureeS: 3, nice: 0, journal: inst.journal, spawn: spawnEspion, ecrire: () => undefined, reposMs: 3000 });
    assert.equal(verdictVariante(r), 'nous');
    assert.equal(r.mort.signal, 'SIGKILL');
    assert.match(r.signaux[0], /\(cron, pid \d+\) : signal SIGKILL envoyé à pid \d+ \(moteur orphelin\)/);
    assert.equal(conclusion([r], { modele: 'm', threads: 2, dureeS: 3 }).verdict, 'TUÉ PAR NOUS');
  } finally {
    inst.nettoyer();
  }
});

test('diagnostic : refusé tant qu’un autre de nos processus d’IA est actif (moteur tenu, processus de fond, moteur visible)', async () => {
  const inst = installation();
  try {
    writeFileSync(inst.c.verrouServeur, JSON.stringify({ proprietaire: PID_ABSENT, ns: AUTRE_ESPACE, role: 'app', jeton: 'j', pid: 77, majLe: new Date().toISOString() }));
    writeFileSync(inst.c.verrouTravailleur, JSON.stringify({ pid: PID_ABSENT, ns: AUTRE_ESPACE }));
    const visibles = () => [{ pid: 99, rssMo: 5000, args: ['/x/llama-server', '--api-key-file', inst.c.cle] }];
    const e = await etatCompte({ c: inst.c, journal: inst.journal, lister: visibles });
    assert.equal(e.obstacles.length, 3);
    const r = await diagnostic(diag(inst, { lister: visibles }));
    assert.equal(r.refuse, true);
    assert.equal(lireVerrou(inst).jeton, 'j', 'verrou de l’autre intact');
  } finally {
    inst.nettoyer();
  }
});
