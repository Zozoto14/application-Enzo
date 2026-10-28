/**
 * `installer-ia-locale.sh --diagnostic` : le moteur lancé EN DIRECT, au premier plan, sans gestionnaire, sans
 * app, sans processus de fond, sur une petite génération (une minute par défaut), pour trancher : quand le
 * moteur meurt, est-ce NOUS (un de nos programmes lui envoie un signal) ou L'EXTÉRIEUR (l'hébergeur) ?
 *
 *  1. Vérifie et AFFICHE qu'aucun autre de nos processus d'IA n'est actif : verrou du moteur libre, pas de
 *     processus de fond, aucun moteur visible ; liste les processus visibles du compte et leur mémoire.
 *  2. Prend le verrou du moteur ET celui du processus de fond (l'app et le cron n'en lancent pas pendant ce temps).
 *  3. Variantes (--variante, toutes par défaut) :
 *       http    : llama-server sur 127.0.0.1 (comme l'app), avec les fils réglés ;
 *       socket  : llama-server sur un socket Unix (AUCUN port TCP ouvert) : « port en écoute » ou « calcul » ?
 *       un-fil  : llama-server sur 127.0.0.1, 1 seul fil de calcul : « calcul lourd » ou non ?
 *       cli     : llama-completion / llama-cli (sans serveur du tout), s'il est installé à côté du moteur.
 *     Chacune : chargement, 10 s au repos (serveur), puis calcul continu jusqu'à --duree secondes ; relevé
 *     chaque seconde (vivant ?, mémoire, processeur). Si le moteur meurt : signal, code, phase, durée, dernières
 *     lignes du moteur, et les lignes « signal … envoyé à pid … » du journal (tout signal de nos programmes y est
 *     noté AVANT l'envoi) : aucune ligne + SIGKILL = tué par l'extérieur.
 *  4. Verdict « tué par nous » / « tué par l'extérieur » / « le moteur tient », quoi faire, et un texte prêt à
 *     envoyer au support de l'hébergeur (aucune donnée secrète : ni clé, ni port, ni nom de domaine).
 *
 * Seul signal envoyé ici : SIGTERM à la fin d'une variante (puis SIGKILL s'il résiste), journalisé comme les autres.
 */

import { spawn as spawnNode } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, openSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { argumentsServeur, environnementMoteur, nettoyerOrphelinIaLocale, portLibre, verrouActif } from './gestionnaire.mjs';
import { cheminsIaLocale, journalIaLocaleParDefaut, lireJson } from './installation.mjs';
import { travailleurActif } from './lanceur.mjs';
import { commandeCourte, descriptionProcessus, envoyerSignal, identifiantDemarrage, limitesMemoire, memoireProcessus, moteursVisibles, noterIaLocale, processusDuCompte, signauxEnvoyesA, ticsProcesseur } from './processus.mjs';
import { prendreVerrouTravailleur } from './travailleur.mjs';

export const VARIANTES = ['http', 'socket', 'un-fil', 'cli'];
const TICS_PAR_SECONDE = 100;
const REPOS_MS = 10_000;
const attendre = ms => new Promise(ok => setTimeout(ok, ms));
const go = mo => `${(mo / 1024).toFixed(1).replace('.', ',')} Go`;
const PROMPT = 'Écris un long récit détaillé, chapitre après chapitre, sur une équipe d’e-sport qui prépare un tournoi international.';

/** Requête HTTP au moteur (port TCP ou socket Unix), corps lu au fil de l'eau. Rend { statut } ou { erreur }. */
function requete({ port, socketPath, chemin, methode = 'GET', corps = null, cle = null, surDonnees = () => undefined, delaiMs = 0 }) {
  return new Promise(ok => {
    const entetes = { ...(cle ? { Authorization: `Bearer ${cle}` } : {}), ...(corps ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corps) } : {}) };
    const req = http.request({ ...(socketPath ? { socketPath } : { host: '127.0.0.1', port }), path: chemin, method: methode, headers: entetes, agent: false }, res => {
      res.on('data', surDonnees);
      res.on('end', () => ok({ statut: res.statusCode }));
      res.on('error', e => ok({ statut: res.statusCode, erreur: e?.code ?? 'coupure' }));
    });
    if (delaiMs > 0) req.setTimeout(delaiMs, () => req.destroy(Object.assign(new Error('délai'), { code: 'DELAI' })));
    req.on('error', e => ok({ erreur: e?.code ?? 'erreur' }));
    req.end(corps ?? undefined);
  });
}

/** Binaire « sans serveur » installé à côté de llama-server (llama-completion, sinon llama-cli), ou null. */
export function binaireSansServeur(binaire) {
  for (const nom of ['llama-completion', 'llama-cli']) {
    const b = join(dirname(binaire), nom);
    if (existsSync(b)) return { binaire: b, nom };
  }
  return null;
}

/**
 * État du compte avant le diagnostic : { processus, totalMo, obstacles: [texte] }. Un obstacle = un autre de nos
 * processus d'IA actif (verrou du moteur tenu, processus de fond, moteur visible).
 */
export async function etatCompte({ c, journal, maintenant = Date.now(), lister = processusDuCompte, systeme = {} }) {
  const processus = lister().filter(p => p.pid !== process.pid);
  const totalMo = processus.reduce((t, p) => t + (p.rssMo || 0), 0);
  const obstacles = [];
  let v = lireJson(c.verrouServeur);
  if (v && !verrouActif(v, maintenant, systeme)) {
    const n = await nettoyerOrphelinIaLocale({ dossier: c.dossier, journal, role: 'diagnostic', systeme });
    if (!n.nettoye && n.raison !== 'aucun' && n.raison !== 'remplace') obstacles.push(`verrou du moteur : moteur sans propriétaire encore en marche (${n.raison}${n.pid ? `, pid ${n.pid}` : ''})`);
    v = lireJson(c.verrouServeur);
  }
  if (v && verrouActif(v, maintenant, systeme)) obstacles.push(`le moteur est tenu par un autre de nos processus (${v.role ?? 'rôle inconnu'}, pid ${v.proprietaire}${v.pid ? `, moteur pid ${v.pid}` : ''}, depuis ${v.demarreLe ?? '?'})`);
  const fond = travailleurActif(c.verrouTravailleur, maintenant, systeme);
  if (fond) obstacles.push(`un processus de fond de l’IA locale travaille (pid ${fond})`);
  for (const m of moteursVisibles(c.cle, processus)) obstacles.push(`un moteur d’IA locale tourne (pid ${m.pid}, ${go(m.rssMo)})`);
  for (const p of processus) if (/^llama-/.test(commandeCourte(p.args)) && !moteursVisibles(c.cle, [p]).length) obstacles.push(`un autre programme ${commandeCourte(p.args)} tourne (pid ${p.pid}, ${go(p.rssMo)})`);
  return { processus, totalMo, obstacles };
}

/** Verrous du moteur et du processus de fond pris pour la durée du diagnostic (battement 30 s). Rend { rendre } ou null. */
function prendreVerrous(c) {
  const jeton = randomBytes(8).toString('hex');
  const ici = descriptionProcessus();
  const contenu = () => JSON.stringify({ proprietaire: process.pid, role: 'diagnostic', ns: ici.ns, boot: ici.boot ?? identifiantDemarrage(), debutProprietaire: ici.debut, jeton, pid: null, port: null, demarreLe: debutIso, majLe: new Date().toISOString() });
  const debutIso = new Date().toISOString();
  try {
    const fd = openSync(c.verrouServeur, 'wx', 0o600);
    writeFileSync(fd, contenu());
    closeSync(fd);
  } catch {
    return null;
  }
  if (!prendreVerrouTravailleur(c.verrouTravailleur)) {
    rmSync(c.verrouServeur, { force: true });
    return null;
  }
  const battement = setInterval(() => {
    try {
      if (lireJson(c.verrouServeur)?.jeton === jeton) writeFileSync(c.verrouServeur, contenu(), { mode: 0o600 });
      const t = new Date();
      utimesSync(c.verrouTravailleur, t, t);
    } catch {
      // Battement suivant.
    }
  }, 30_000);
  battement.unref?.();
  return {
    rendre() {
      clearInterval(battement);
      if (lireJson(c.verrouServeur)?.jeton === jeton) {
        rmSync(c.cle, { force: true });
        rmSync(c.verrouServeur, { force: true });
      }
      rmSync(c.verrouTravailleur, { force: true });
    },
  };
}

/**
 * Une variante : lance le moteur, l'observe jusqu'à `dureeS` de calcul (ou sa mort), l'arrête. Rend
 * { nom, tenu, mort?, phases, jetons, rssMaxMo, cpuMoyen, lignes, signaux, indisponible? }.
 */
export async function essaiVariante({ nom, c, binaire, fichierModele, threads, contexte = 4096, dureeS = 60, nice = 19, journal = journalIaLocaleParDefaut(), spawn = spawnNode, ecrire = console.log, reposMs = REPOS_MS }) {
  const mode = nom === 'socket' ? 'socket' : nom === 'cli' ? 'cli' : 'http';
  const fils = nom === 'un-fil' ? 1 : threads;
  const cli = mode === 'cli' ? binaireSansServeur(binaire) : null;
  if (mode === 'cli' && !cli) return { nom, indisponible: 'llama-completion / llama-cli absent à côté du moteur (le moteur compilé ne contient que llama-server) ; la variante « socket » couvre le cas « aucun port TCP ouvert »' };
  const cle = randomBytes(24).toString('hex');
  writeFileSync(c.cle, `${cle}\n`, { mode: 0o600 });
  const socketPath = mode === 'socket' ? join(c.etat, `diagnostic-${process.pid}.sock`) : null;
  if (socketPath) rmSync(socketPath, { force: true });
  const port = mode === 'http' ? await portLibre() : 8080;
  const args =
    mode === 'cli'
      ? ['-m', fichierModele, '-p', PROMPT, '-n', '100000', '-t', String(fils), '-c', String(contexte), ...(cli.nom === 'llama-cli' ? ['-no-cnv'] : [])]
      : argumentsServeur({ fichierModele, port, fichierCle: c.cle, threads: fils, contexte, delaiS: 600, ...(socketPath ? { hote: socketPath } : {}) });
  const prog = mode === 'cli' ? cli.binaire : binaire;
  const niceBin = nice > 0 ? ['/usr/bin/nice', '/bin/nice'].find(x => existsSync(x)) : null;
  const debut = Date.now();
  const debutIso = new Date(debut).toISOString();
  const lignes = [];
  const garder = morceau => {
    for (const l of String(morceau).split('\n')) {
      const t = l.trimEnd();
      if (!t) continue;
      lignes.push(t.slice(0, 300));
      if (lignes.length > 40) lignes.shift();
    }
  };
  const enfant = spawn(niceBin ?? prog, niceBin ? ['-n', String(nice), prog, ...args] : args, { stdio: ['ignore', 'pipe', 'pipe'], env: environnementMoteur(binaire), cwd: c.etat, detached: true });
  let jetons = 0;
  if (mode === 'cli') enfant.stdout?.on('data', d => (jetons += Math.max(1, Math.round(String(d).length / 4))));
  else enfant.stdout?.on('data', garder);
  enfant.stderr?.on('data', garder);
  const pid = enfant.pid;
  noterIaLocale(journal, `diagnostic « ${nom} » : moteur pid ${pid} lancé en direct (${fils} fil${fils > 1 ? 's' : ''}, ${mode === 'socket' ? 'socket Unix, aucun port TCP' : mode === 'cli' ? `${cli.nom}, sans serveur` : '127.0.0.1'}).`, 'diagnostic');
  ecrire(`    moteur pid ${pid} lancé (${fils} fil${fils > 1 ? 's' : ''}${mode === 'socket' ? ', socket Unix : aucun port TCP' : mode === 'cli' ? `, ${cli.nom} : aucun serveur` : ', 127.0.0.1'})`);
  let phase = mode === 'cli' ? 'chargement et calcul' : 'chargement';
  const phases = { chargementS: null, calculDebut: null };
  let mort = null;
  const sortie = new Promise(ok =>
    enfant.on('exit', (code, signal) => {
      mort = { code, signal, phase, apresS: (Date.now() - debut) / 1000, calculS: phases.calculDebut ? (Date.now() - phases.calculDebut) / 1000 : null, le: new Date().toISOString() };
      ok();
    }),
  );
  enfant.on('error', e => {
    mort = { code: null, signal: null, erreur: e?.code ?? 'lancement', phase, apresS: 0, calculS: null, le: new Date().toISOString() };
  });
  // Relevés chaque seconde.
  let rssMaxMo = 0;
  const cpu = [];
  let tics = ticsProcesseur(pid);
  let t0 = Date.now();
  const releve = setInterval(() => {
    const m = memoireProcessus(pid);
    if (m) rssMaxMo = Math.max(rssMaxMo, m.rssMo);
    const t = ticsProcesseur(pid);
    const maintenant = Date.now();
    if (t !== null && tics !== null && maintenant > t0) cpu.push(((t - tics) / TICS_PAR_SECONDE / ((maintenant - t0) / 1000)) * 100);
    tics = t;
    t0 = maintenant;
  }, 1000);
  const vivant = () => !mort;
  const finCalcul = () => Date.now() >= (phases.calculDebut ?? Infinity) + dureeS * 1000;
  try {
    if (mode !== 'cli') {
      const cible = socketPath ? { socketPath } : { port };
      const limite = Date.now() + 10 * 60_000;
      while (vivant() && Date.now() < limite) {
        const r = await requete({ ...cible, chemin: '/health', delaiMs: 2000 });
        if (r.statut === 200) break;
        await attendre(250);
      }
      if (vivant()) {
        phases.chargementS = (Date.now() - debut) / 1000;
        ecrire(`    modèle chargé en ${phases.chargementS.toFixed(1)} s ; ${Math.round(reposMs / 1000)} s au repos (port ou socket ouvert, aucun calcul)…`);
        phase = 'repos';
        const finRepos = Date.now() + reposMs;
        while (vivant() && Date.now() < finRepos) await attendre(200);
      }
      if (vivant()) {
        phase = 'calcul';
        phases.calculDebut = Date.now();
        ecrire(`    calcul pendant ${dureeS} s…`);
        while (vivant() && !finCalcul()) {
          const corps = JSON.stringify({ prompt: PROMPT, n_predict: 512, stream: true, cache_prompt: false, temperature: 0.8 });
          const reste = phases.calculDebut + dureeS * 1000 - Date.now();
          const r = await requete({ ...cible, chemin: '/completion', methode: 'POST', corps, cle, delaiMs: Math.max(1000, reste), surDonnees: d => (jetons += (String(d).match(/^data: /gm) ?? []).length) });
          if (r.erreur && vivant() && !finCalcul()) await attendre(200);
        }
      }
    } else {
      phases.calculDebut = Date.now();
      phase = 'chargement et calcul';
      while (vivant() && !finCalcul()) await attendre(200);
    }
  } finally {
    clearInterval(releve);
  }
  const tenu = vivant();
  if (tenu) {
    // Fin normale de la variante : SIGTERM journalisé (puis SIGKILL s'il résiste).
    envoyerSignal(pid, 'SIGTERM', { cible: 'moteur du diagnostic', raison: `fin de la variante « ${nom} »`, journal, role: 'diagnostic' });
    const dur = setTimeout(() => envoyerSignal(pid, 'SIGKILL', { cible: 'moteur du diagnostic', raison: 'toujours là 10 s après SIGTERM', journal, role: 'diagnostic' }), 10_000);
    await sortie;
    clearTimeout(dur);
  }
  if (socketPath) rmSync(socketPath, { force: true });
  rmSync(c.cle, { force: true });
  const signaux = signauxEnvoyesA(journal, pid, debutIso).filter(l => !tenu || !/\(moteur du diagnostic\) : (fin de la variante|toujours là 10 s après SIGTERM)/.test(l));
  const cpuMoyen = cpu.length ? Math.round(cpu.reduce((a, b) => a + b, 0) / cpu.length) : null;
  if (!tenu) noterIaLocale(journal, `diagnostic « ${nom} » : moteur pid ${pid} MORT (${mort.signal ? `signal ${mort.signal}` : `code ${mort.code}`}) en phase « ${mort.phase} », ${mort.apresS.toFixed(1)} s après son lancement ; signaux de nos programmes vers lui : ${signaux.length || 'aucun'}.`, 'diagnostic');
  return { nom, pid, tenu, mort: tenu ? null : mort, chargementS: phases.chargementS, jetons, rssMaxMo, cpuMoyen, lignes: lignes.slice(-12), signaux, fils, mode };
}

/** Verdict d'une variante : 'nous' | 'exterieur' | 'plantage' | 'tenu' | 'indisponible'. */
export function verdictVariante(r) {
  if (r.indisponible) return 'indisponible';
  if (r.tenu) return 'tenu';
  if (r.signaux.length) return 'nous';
  if (r.mort?.signal === 'SIGKILL') return 'exterieur';
  return 'plantage';
}

/** Texte de conclusion (et message pour le support) à partir des résultats. */
export function conclusion(resultats, { modele, threads, dureeS }) {
  const v = resultats.map(r => ({ ...r, verdict: verdictVariante(r) }));
  const ext = v.filter(r => r.verdict === 'exterieur');
  const nous = v.filter(r => r.verdict === 'nous');
  const plant = v.filter(r => r.verdict === 'plantage');
  const lignes = [];
  let verdict;
  if (nous.length) {
    verdict = 'TUÉ PAR NOUS';
    lignes.push(`Un de NOS programmes a envoyé un signal au moteur (lignes du journal ci-dessus) : c'est un défaut de notre code, à corriger — ce n'est pas l'hébergeur.`);
  } else if (ext.length) {
    verdict = 'TUÉ PAR L’EXTÉRIEUR';
    lignes.push('Le moteur, lancé SEUL (sans app, sans processus de fond, aucun autre de nos moteurs), a reçu SIGKILL sans qu’aucun de nos programmes ne lui envoie de signal (aucune ligne « signal … envoyé » dans le journal) : il est arrêté par l’hébergeur (surveillance des processus).');
    const par = nom => v.find(r => r.nom === nom);
    if (par('socket')?.verdict === 'exterieur') lignes.push('Variante « socket » (aucun port TCP) tuée aussi : ce n’est PAS le port en écoute qui déclenche l’arrêt.');
    if (par('socket')?.verdict === 'tenu' && par('http')?.verdict === 'exterieur') lignes.push('Variante « socket » épargnée mais « http » tuée : le port en écoute semble en cause.');
    if (par('un-fil')?.verdict === 'exterieur') lignes.push('Variante « un-fil » (1 seul fil de calcul) tuée aussi : ce n’est PAS (seulement) la charge processeur.');
    if (par('un-fil')?.verdict === 'tenu' && ext.some(r => r.nom !== 'un-fil')) lignes.push('Variante « un-fil » épargnée : la charge processeur (plusieurs fils) semble en cause ; IA_LOCALE_THREADS plus bas peut suffire.');
    if (ext.some(r => r.mort?.phase === 'repos')) lignes.push('Mort AU REPOS (aucun calcul) : le simple fait que le processus existe (nom, emplacement ou mémoire) semble en cause.');
    else if (ext.every(r => /calcul|chargement/.test(r.mort?.phase ?? ''))) lignes.push(`Morts pendant ${[...new Set(ext.map(r => r.mort.phase))].join(' / ')} : c’est le calcul lourd (ou la lecture du modèle) qui déclenche l’arrêt.`);
    lignes.push('À faire : envoyer le message ci-dessous au support o2switch ; en attendant, mode « Clé API » dans Esport › Jeux › Administration IA.');
  } else if (plant.length) {
    verdict = 'PLANTAGE DU MOTEUR';
    lignes.push('Le moteur s’est arrêté de lui-même (code d’erreur ou signal autre que SIGKILL) : voir ses dernières lignes ci-dessus (modèle abîmé : --forcer ; mémoire : --petit).');
  } else {
    verdict = 'LE MOTEUR TIENT';
    lignes.push(`Le moteur seul a calculé ${dureeS} s sans être arrêté. Si l'app voit encore des morts : relancez avec --duree 600 (dix minutes, comme un brouillon), et comparez avec les lignes « signal … envoyé » du journal aux heures des morts.`);
  }
  const morts = ext.map(r => `- ${r.mort.le} (UTC) : variante « ${r.nom} » (${r.fils} fil${r.fils > 1 ? 's' : ''}${r.mode === 'socket' ? ', aucun port TCP' : r.mode === 'cli' ? ', sans serveur' : ', écoute sur 127.0.0.1'}), SIGKILL en phase « ${r.mort.phase} », ${r.mort.apresS.toFixed(0)} s après le lancement${r.rssMaxMo ? `, mémoire ${go(r.rssMaxMo)}` : ''}${r.cpuMoyen !== null ? `, processeur ≈ ${r.cpuMoyen} %` : ''}`);
  const support = ext.length
    ? `Bonjour,

Sur mon hébergement, un programme de calcul que je lance moi-même est arrêté de force (signal SIGKILL), sans que mes propres programmes ne lui envoient de signal (je journalise chacun de mes envois : aucun pour ces processus). La page Resource Usage de cPanel n'indique aucun dépassement (mémoire, CPU, processus) à ces heures.

Le programme : llama-server (llama.cpp, inférence d'un modèle d'IA ${modele} sur le processeur), lancé depuis mon dossier personnel (~/.appdashboard/ia-locale/moteur/), en priorité basse (nice 19), ${threads} fils de calcul, quelques Go de mémoire, pour quelques minutes par jour. Les arrêts observés pendant un test où il tournait SEUL :
${morts.join('\n')}

Pouvez-vous me dire si une surveillance de vos serveurs arrête ce type de processus (par exemple les processus longs ou très consommateurs de processeur, ou un binaire inconnu lancé depuis le dossier personnel), et selon quelles règles ? Est-il possible de l'autoriser, ou quelles limites dois-je respecter (durée, nombre de fils, priorité) pour qu'il ne soit plus arrêté ?

Merci d'avance.`
    : null;
  return { verdict, lignes, support, resultats: v };
}

/**
 * Le diagnostic complet. `ecrire` (affichage), `spawn`, `lister` (processus visibles), `systeme` injectables (tests).
 * Rend { refuse?, obstacles?, verdict, lignes, support, resultats }.
 */
export async function diagnostic({ dossier, binaire, fichierModele, modele, threads, contexte = 4096, variantes = VARIANTES, dureeS = 60, nice = 19, journal = journalIaLocaleParDefaut(), ecrire = console.log, spawn = spawnNode, lister = processusDuCompte, systeme = {}, reposMs = REPOS_MS, pauseMs = 3000 }) {
  const c = cheminsIaLocale(dossier);
  const ici = descriptionProcessus();
  const lim = limitesMemoire();
  ecrire(`  ce processus : pid ${process.pid}, espace de processus ${ici.ns ?? 'inconnu'}`);
  ecrire(`  limite mémoire lisible d'ici : ${lim.limiteOctets ? go(lim.limiteOctets / 1024 / 1024) : 'aucune (CloudLinux : voir cPanel › Resource Usage › mémoire physique)'} ; espace d'adresses ${lim.espaceAdresse ?? '?'} ; processus max ${lim.processusMax ?? '?'}`);
  const etat = await etatCompte({ c, journal, lister, systeme });
  ecrire(`  processus visibles du compte : ${etat.processus.length}, ${go(etat.totalMo)} en tout`);
  for (const p of etat.processus.slice(0, 25)) ecrire(`    pid ${p.pid} ${commandeCourte(p.args)} — ${p.rssMo} Mo`);
  if (etat.obstacles.length) {
    for (const o of etat.obstacles) ecrire(`  ✖ ${o}`);
    ecrire('  Diagnostic refusé : il doit tourner SEUL. Attendez la fin du calcul en cours (le moteur de l’app s’arrête après 1 min sans requête, celui du processus de fond après 5 min), puis relancez.');
    return { refuse: true, obstacles: etat.obstacles };
  }
  const verrous = prendreVerrous(c);
  if (!verrous) {
    ecrire('  ✖ Verrou du moteur ou du processus de fond pris entre-temps par un autre de nos processus : relancez dans quelques minutes.');
    return { refuse: true, obstacles: ['verrou pris entre-temps'] };
  }
  ecrire('  ✔ aucun autre de nos processus d’IA actif (verrou du moteur libre, pas de processus de fond, aucun moteur visible) ; verrous pris pour la durée du diagnostic');
  noterIaLocale(journal, `diagnostic : début (variantes ${variantes.join(', ')}, ${dureeS} s de calcul chacune ; aucun autre de nos moteurs actif).`, 'diagnostic');
  const arret = () => {
    verrous.rendre();
    process.exit(130);
  };
  for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(s, arret);
  const resultats = [];
  try {
    for (const [i, nom] of variantes.entries()) {
      if (i > 0) await attendre(pauseMs);
      ecrire(`\n  ▷ variante « ${nom} »`);
      const r = await essaiVariante({ nom, c, binaire, fichierModele, threads, contexte, dureeS, nice, journal, spawn, ecrire, reposMs });
      resultats.push(r);
      const v = verdictVariante(r);
      if (v === 'indisponible') ecrire(`    — ${r.indisponible}`);
      else if (v === 'tenu') ecrire(`    ✔ a tenu ${dureeS} s de calcul (${r.jetons} jetons${r.rssMaxMo ? `, mémoire ${go(r.rssMaxMo)}` : ''}${r.cpuMoyen !== null ? `, processeur ≈ ${r.cpuMoyen} %` : ''})`);
      else {
        ecrire(`    ✖ MORT : ${r.mort.signal ? `signal ${r.mort.signal}` : `code ${r.mort.code}`} en phase « ${r.mort.phase} », ${r.mort.apresS.toFixed(1)} s après le lancement${r.mort.calculS !== null ? ` (${r.mort.calculS.toFixed(1)} s de calcul)` : ''}${r.rssMaxMo ? ` ; mémoire ${go(r.rssMaxMo)}` : ''}${r.cpuMoyen !== null ? ` ; processeur ≈ ${r.cpuMoyen} %` : ''}`);
        ecrire(`    signaux envoyés par nos programmes à ce moteur : ${r.signaux.length ? '' : 'AUCUN'}`);
        for (const l of r.signaux) ecrire(`      ${l}`);
        ecrire(`    → ${v === 'nous' ? 'TUÉ PAR NOUS' : v === 'exterieur' ? 'TUÉ PAR L’EXTÉRIEUR' : 'PLANTAGE'}`);
        if (r.lignes.length) {
          ecrire('    dernières lignes du moteur :');
          for (const l of r.lignes) ecrire(`      | ${l}`);
        }
      }
    }
  } finally {
    for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.removeListener(s, arret);
    verrous.rendre();
  }
  const fin = conclusion(resultats, { modele, threads, dureeS });
  noterIaLocale(journal, `diagnostic : fin — ${fin.verdict} (${fin.resultats.map(r => `${r.nom} : ${r.verdict}`).join(', ')}).`, 'diagnostic');
  return fin;
}
