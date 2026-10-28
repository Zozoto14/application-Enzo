/**
 * Gestionnaire du serveur d'inférence local (llama-server de llama.cpp), À LA DEMANDE :
 *
 *  - démarré quand une tâche IA arrive, écoute SEULEMENT sur 127.0.0.1, sur un port libre tiré à chaque
 *    démarrage, avec une clé d'accès aléatoire (fichier 0600, jamais sur la ligne de commande) : sur un
 *    serveur mutualisé, l'adresse 127.0.0.1 est partagée avec les autres comptes ; sans la clé, rien ;
 *  - arrêté après `inactiviteMs` sans requête (5 minutes par défaut), ou tout de suite par `arreter()` ;
 *  - UN SEUL serveur pour tout le compte (verrou etat/serveur.json créé en exclusif, avec le pid du
 *    processus Node propriétaire, le pid du serveur et un battement toutes les 30 s) : un autre processus
 *    (app Passenger, travailleur lancé par le cron) attend son tour ou renonce (« IA locale occupée ») ;
 *  - processus ORPHELIN (propriétaire disparu : redémarrage Passenger, processus tué) : arrêté au prochain
 *    usage, au démarrage de l'app et à chaque passage du cron (`nettoyerOrphelinIaLocale`) ; seul un
 *    processus dont la ligne de commande porte NOTRE fichier de clé est arrêté (jamais un autre) ;
 *  - FILE D'ATTENTE : une requête à la fois (le modèle occupe déjà tous ses fils de calcul), `fileMax`
 *    requêtes en attente au plus (au-delà : 503 « IA locale occupée ») ;
 *  - priorité basse (`nice`), fils de calcul et contexte bornés, environnement VIDÉ (les secrets de
 *    esport.env ne passent pas au moteur ; aucune variable LLAMA_ARG_* ne peut changer ses options), interface
 *    web, outils et points de supervision du moteur coupés, cache mémoire des requêtes coupé.
 *
 * Tout est injectable pour les tests (faux binaire, `spawn`, `fetch`, horloge) : aucun modèle réel.
 */

import { spawn as spawnNode } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname } from 'node:path';
import { echec } from '../../noyau/outils.mjs';
import { cheminsIaLocale, journalIaLocaleParDefaut, lireJson } from './installation.mjs';

export const BATTEMENT_MS = 30_000;
/** Relevé de la mémoire du moteur (diagnostic d'un arrêt par la limite mémoire du compte). */
export const RELEVE_MEMOIRE_MS = 5000;
export const VERROU_PERIME_MS = 3 * 60_000;
const TAILLE_MAX_JOURNAL = 5 * 1024 * 1024;

const attendre = ms => new Promise(ok => setTimeout(ok, ms));

/** Le processus existe-t-il ? (EPERM : il existe mais appartient à un autre compte.) */
export function processusVivant(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === 'EPERM';
  }
}

/** Ligne de commande d'un processus (Linux, /proc), ou [] si illisible. */
export function ligneDeCommande(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'latin1').split('\0').filter(Boolean);
  } catch {
    return [];
  }
}

/** Mémoire d'un processus (Linux, /proc) en Mo : { rssMo, picMo }, ou null si illisible. */
export function memoireProcessus(pid) {
  try {
    const t = readFileSync(`/proc/${pid}/status`, 'utf8');
    const ko = nom => Number(new RegExp(`^${nom}:\\s+(\\d+)\\s+kB`, 'm').exec(t)?.[1]);
    const rss = ko('VmRSS');
    const pic = ko('VmHWM');
    if (!Number.isFinite(rss)) return null;
    return { rssMo: Math.round(rss / 1024), picMo: Number.isFinite(pic) ? Math.round(pic / 1024) : null };
  } catch {
    return null;
  }
}

const enGo = mo => `${(mo / 1024).toFixed(1).replace('.', ',')} Go`;

/** Est-ce NOTRE serveur d'inférence (lancé avec notre fichier de clé) ? Jamais un autre processus. */
export function estNotreServeur(pid, fichierCle, lire = ligneDeCommande) {
  const args = lire(pid);
  const i = args.indexOf('--api-key-file');
  return i >= 0 && args[i + 1] === fichierCle;
}

function ecrireAtomique(chemin, contenu, mode = 0o600) {
  const tmp = `${chemin}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, contenu, { mode });
  renameSync(tmp, chemin);
}

/**
 * Ligne de diagnostic dans ~/logs/esport-ia-locale.log (même fichier que les sorties du moteur) : qui
 * (pid, rôle) a fait quoi et pourquoi. Jamais de clé ni de port. Sans `journal` : rien (tests).
 */
export function noterIaLocale(journal, texte, role = null) {
  if (!journal) return;
  try {
    mkdirSync(dirname(journal), { recursive: true });
    appendFileSync(journal, `${new Date().toISOString()} [esport] IA locale${role ? ` (${role}, pid ${process.pid})` : ` (pid ${process.pid})`} : ${texte}\n`);
  } catch {
    // Journal indisponible : sans conséquence.
  }
}

/** Arrête un processus orphelin (SIGKILL), s'il est bien à nous. */
function tuerSiNotre(pid, fichierCle, lire) {
  if (!Number.isInteger(pid) || pid <= 1 || !processusVivant(pid) || !estNotreServeur(pid, fichierCle, lire)) return false;
  try {
    process.kill(pid, 'SIGKILL');
    return true;
  } catch {
    return false;
  }
}

/** Verrou lu, ou null. */
const lireVerrou = chemin => {
  const v = lireJson(chemin);
  return v && typeof v === 'object' ? v : null;
};

/** Le propriétaire du verrou est-il encore là (processus vivant, battement récent) ? */
export function verrouActif(v, maintenant = Date.now()) {
  if (!v) return false;
  const maj = Date.parse(v.majLe ?? '');
  return processusVivant(v.proprietaire) && Number.isFinite(maj) && maintenant - maj < VERROU_PERIME_MS;
}

/**
 * Nettoyage d'un serveur orphelin (propriétaire disparu) : arrête le processus s'il est à nous, retire le
 * verrou et la clé. Appelé au démarrage de l'app, par le cron et avant chaque démarrage. Rend
 * `{ nettoye, pid?, raison }`.
 */
export function nettoyerOrphelinIaLocale({ dossier, maintenant = Date.now(), lire = ligneDeCommande, journal = null, role = null } = {}) {
  const c = cheminsIaLocale(dossier);
  if (!existsSync(c.verrouServeur)) return { nettoye: false, raison: 'aucun' };
  const v = lireVerrou(c.verrouServeur);
  if (!v) {
    // Verrou illisible (écriture interrompue) : retiré s'il a plus d'une minute.
    try {
      if (maintenant - statSync(c.verrouServeur).mtimeMs < 60_000) return { nettoye: false, raison: 'recent' };
    } catch {
      return { nettoye: false, raison: 'aucun' };
    }
    rmSync(c.verrouServeur, { force: true });
    noterIaLocale(journal, 'verrou du moteur illisible retiré.', role);
    return { nettoye: true, raison: 'illisible' };
  }
  if (verrouActif(v, maintenant)) return { nettoye: false, raison: 'en-service' };
  // Toujours le MÊME verrou (un autre processus a pu le remplacer entre-temps par le sien) ?
  const toujours = () => lireVerrou(c.verrouServeur)?.jeton === v.jeton;
  if (!toujours()) return { nettoye: false, raison: 'remplace' };
  const age = Math.round((maintenant - Date.parse(v.majLe ?? '')) / 1000);
  const tue = tuerSiNotre(v.pid, c.cle, lire);
  // La clé AVANT le verrou, et seulement si l'ancien verrou est toujours là : tant qu'il existe, personne
  // n'a pu prendre le moteur ni écrire une nouvelle clé.
  if (!toujours()) return { nettoye: tue, raison: 'remplace', ...(tue ? { pid: v.pid } : {}) };
  rmSync(c.cle, { force: true });
  if (toujours()) rmSync(c.verrouServeur, { force: true });
  noterIaLocale(
    journal,
    `moteur orphelin nettoyé (propriétaire pid ${v.proprietaire} ${processusVivant(v.proprietaire) ? 'vivant' : 'disparu'}, dernier battement il y a ${Number.isFinite(age) ? `${age} s` : '?'}${tue ? `, moteur pid ${v.pid} arrêté` : ''}).`,
    role,
  );
  return { nettoye: true, raison: 'orphelin', ...(tue ? { pid: v.pid } : {}) };
}

/** Un port TCP libre sur 127.0.0.1 (le système le choisit). */
export function portLibre() {
  return new Promise((ok, ko) => {
    const s = net.createServer();
    s.unref();
    s.on('error', ko);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

function trouverNice() {
  for (const c of ['/usr/bin/nice', '/bin/nice']) if (existsSync(c)) return c;
  return null;
}

/** Options de llama-server (b11351) : écoute locale seulement, une requête à la fois, rien d'inutile. */
export function argumentsServeur({ fichierModele, port, fichierCle, threads, contexte, delaiS }) {
  return [
    '-m', fichierModele,
    '--host', '127.0.0.1',
    '--port', String(port),
    '--api-key-file', fichierCle,
    '-t', String(threads),
    '-tb', String(threads),
    '-c', String(contexte),
    '-np', '1',
    // Pas d'attente active des fils de calcul (serveur partagé), pas de cache mémoire des requêtes (jusqu'à 8 Go sinon).
    '--poll', '0',
    '--cache-ram', '0',
    '--no-webui',
    '--no-slots',
    '--timeout', String(delaiS),
  ];
}

/** Environnement minimal du moteur : aucun secret de esport.env, aucune variable LLAMA_ARG_*. */
export function environnementMoteur(binaire, env = process.env) {
  return {
    PATH: '/usr/local/bin:/usr/bin:/bin',
    HOME: env.HOME ?? '/tmp',
    LANG: 'C.UTF-8',
    // Archive officielle : ses bibliothèques sont à côté du binaire (RUNPATH $ORIGIN, ceinture et bretelles).
    LD_LIBRARY_PATH: dirname(binaire),
  };
}

// Arrêt des serveurs encore en marche quand le processus Node se termine normalement (les autres cas :
// nettoyage des orphelins).
const enMarche = new Set();
let sortieInstallee = false;
function surveillerSortie() {
  if (sortieInstallee) return;
  sortieInstallee = true;
  process.once('exit', () => {
    for (const g of enMarche) g.arretImmediat();
  });
}

/**
 * Crée le gestionnaire. Options :
 *  `dossier` (IA_LOCALE_DOSSIER), `binaire`, `fichierModele`, `threads`, `contexte`, `inactiviteMs`,
 *  `demarrageMs` (chargement du modèle), `delaiMs` (une requête), `fileMax`, `attenteVerrouMs` (attente
 *  d'un serveur tenu par un autre processus), `nice` (0-19), `journal` (fichier des sorties du moteur) ;
 *  injectables : `spawn`, `fetch`, `trouverPort`, `maintenant`, `lire` (ligne de commande), `log`.
 */
export function creerGestionnaireIaLocale({
  dossier,
  binaire,
  fichierModele,
  threads = 8,
  contexte = 8192,
  inactiviteMs = 5 * 60_000,
  demarrageMs = 300_000,
  delaiMs = 20 * 60_000,
  fileMax = 4,
  attenteVerrouMs = 10_000,
  nice = 19,
  journal = journalIaLocaleParDefaut(),
  spawn = spawnNode,
  fetch: fetchSante = (...a) => globalThis.fetch(...a),
  trouverPort = portLibre,
  maintenant = () => Date.now(),
  lire = ligneDeCommande,
  log = console,
  role = null,
  lireMemoire = memoireProcessus,
  pauseApresArretMs = 5000,
} = {}) {
  const c = cheminsIaLocale(dossier);
  const jeton = randomBytes(8).toString('hex');
  const file = [];
  let actif = false;
  let serveur = null; // { enfant, pid, port, cle, depuis, pret }
  let demarrage = null; // promesse du démarrage en cours
  let minuteurRepos = null;
  let battement = null;
  let dernierUsage = null;
  let dernierDemarrageMs = null;
  let derniereErreur = null;
  // Dernière sortie du moteur (pid, code, signal, imprévue ou non) et attentes de `attendreSortie`.
  let derniereSortie = null;
  const attentesSortie = new Set();
  let memoire = null; // dernier relevé { rssMo, picMo }
  let releveMemoire = null;

  const iso = t => new Date(t).toISOString();
  const noter = texte => noterIaLocale(journal, texte, role);

  /** Erreur notée ici ET partagée entre processus (etat/incident.json) : l'Administration IA la montre. */
  function noterErreur(code, texte) {
    derniereErreur = { code, le: iso(maintenant()) };
    if (texte) noter(texte);
    try {
      preparerDossier();
      ecrireAtomique(c.incident, JSON.stringify({ ...derniereErreur, role }));
    } catch {
      // Sans gravité.
    }
  }

  function preparerDossier() {
    mkdirSync(c.etat, { recursive: true, mode: 0o700 });
    try {
      chmodSync(c.etat, 0o700);
    } catch {
      // Dossier d'un autre propriétaire : l'ouverture du verrou échouera clairement.
    }
  }

  /** Prend le verrou du compte (exclusif). Rend true, ou false s'il est tenu par un processus vivant. */
  function prendreVerrou() {
    preparerDossier();
    for (let essai = 0; essai < 2; essai++) {
      try {
        const fd = openSync(c.verrouServeur, 'wx', 0o600);
        writeFileSync(fd, JSON.stringify({ proprietaire: process.pid, jeton, pid: null, port: null, demarreLe: iso(maintenant()), majLe: iso(maintenant()) }));
        closeSync(fd);
        return true;
      } catch (e) {
        if (e?.code !== 'EEXIST') throw e;
      }
      const v = lireVerrou(c.verrouServeur);
      if (v?.jeton === jeton) return true;
      if (verrouActif(v, maintenant())) return false;
      const n = nettoyerOrphelinIaLocale({ dossier: c.dossier, maintenant: maintenant(), lire, journal, role });
      if (n.nettoye) log.warn?.(`[esport] IA locale : serveur orphelin nettoyé${n.pid ? ` (pid ${n.pid})` : ''}.`);
      else if (n.raison !== 'aucun') return false;
    }
    return false;
  }

  function majVerrou(patch) {
    const v = lireVerrou(c.verrouServeur);
    if (!v || v.jeton !== jeton) return;
    ecrireAtomique(c.verrouServeur, JSON.stringify({ ...v, ...patch, majLe: iso(maintenant()) }));
  }

  /** Retire NOTRE verrou et la clé (jamais ceux d'un autre processus : son moteur en dépend). */
  function libererVerrou() {
    const v = lireVerrou(c.verrouServeur);
    if (v?.jeton !== jeton) return;
    rmSync(c.cle, { force: true });
    rmSync(c.verrouServeur, { force: true });
  }

  function ouvrirJournal() {
    try {
      mkdirSync(dirname(journal), { recursive: true });
      if (existsSync(journal) && statSync(journal).size > TAILLE_MAX_JOURNAL) truncateSync(journal, 0);
      return openSync(journal, 'a');
    } catch {
      return 'ignore';
    }
  }

  async function sante(port) {
    try {
      const r = await fetchSante(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000), redirect: 'error' });
      await r.text().catch(() => '');
      return r.status === 200;
    } catch {
      return false;
    }
  }

  function arretImmediat() {
    const s = serveur;
    serveur = null;
    if (s?.pid) {
      try {
        process.kill(s.pid, 'SIGKILL');
      } catch {
        // Déjà parti.
      }
    }
    try {
      libererVerrou();
    } catch {
      // Sortie du processus : au mieux.
    }
  }
  const moi = { arretImmediat };

  async function attendreVerrou(limite) {
    for (;;) {
      if (prendreVerrou()) return;
      if (maintenant() >= limite) throw echec(503, 'ia-locale-occupee', 'L’IA locale est occupée par une autre tâche : réessayez dans quelques minutes.');
      await attendre(1000);
    }
  }

  async function demarrer(limite) {
    if (!binaire || !fichierModele) throw echec(503, 'ia-locale-absente', 'IA locale non installée (lancer esport/serveur/installer-ia-locale.sh).');
    const debut = maintenant();
    await attendreVerrou(Math.min(limite, debut + attenteVerrouMs));
    let enfant = null;
    let fd = 'ignore';
    try {
      const cle = randomBytes(24).toString('hex');
      ecrireAtomique(c.cle, `${cle}\n`);
      const port = await trouverPort();
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('port');
      const args = argumentsServeur({ fichierModele, port, fichierCle: c.cle, threads, contexte, delaiS: Math.ceil(delaiMs / 1000) });
      const niceBin = nice > 0 ? trouverNice() : null;
      fd = ouvrirJournal();
      enfant = spawn(niceBin ?? binaire, niceBin ? ['-n', String(Math.min(19, Math.max(1, nice))), binaire, ...args] : args, {
        stdio: ['ignore', fd, fd],
        env: environnementMoteur(binaire),
        cwd: c.etat,
        detached: false,
      });
      const fini = { code: null, termine: false };
      enfant.on('exit', (code, signal) => {
        fini.termine = true;
        fini.code = code ?? signal;
        fini.signal = signal ?? null;
        const imprevue = serveur?.enfant === enfant;
        const mem = memoire;
        derniereSortie = { pid: enfant.pid, code: code ?? null, signal: signal ?? null, imprevue, le: maintenant() };
        clearInterval(releveMemoire);
        if (imprevue) {
          serveur = null;
          enMarche.delete(moi);
          clearInterval(battement);
          clearTimeout(minuteurRepos);
          libererVerrou();
          // Arrêt imprévu (plantage, mémoire, processus tué par un tiers) : noté, avec le signal reçu et la dernière
          // mémoire relevée. (Nos propres arrêts — inactivité, échec de démarrage, sortie — retirent `serveur` avant
          // de tuer : pas ici.)
          if (!(code === 0 && !signal)) {
            const quoi = signal ? `signal ${signal}${signal === 'SIGKILL' ? ' : tué par le système, souvent la limite mémoire du compte (LVE)' : ''}` : `code ${code}`;
            const memTexte = mem ? ` ; mémoire relevée juste avant : ${enGo(mem.rssMo)}${mem.picMo ? ` (pic ${enGo(mem.picMo)})` : ''}` : '';
            noterErreur('ia-locale-arret', `moteur pid ${enfant.pid} arrêté de façon imprévue (${quoi})${actif ? ' PENDANT une requête' : ''}${memTexte}.`);
          }
        }
        for (const a of attentesSortie) if (a.pid === enfant.pid) a.ok(derniereSortie);
      });
      enfant.on('error', () => {
        fini.termine = true;
      });
      if (!enfant.pid) throw new Error('lancement');
      majVerrou({ pid: enfant.pid, port, demarreLe: iso(debut) });
      // Battement dès le lancement : un chargement long (jusqu'à demarrageMs) ne doit pas passer pour un orphelin.
      clearInterval(battement);
      battement = setInterval(() => {
        try {
          majVerrou({});
        } catch {
          // Disque plein… le prochain battement réessaiera.
        }
      }, BATTEMENT_MS);
      battement.unref?.();
      memoire = null;
      clearInterval(releveMemoire);
      const pidMoteur = enfant.pid;
      releveMemoire = setInterval(() => {
        const m = lireMemoire(pidMoteur);
        if (m) memoire = m;
      }, RELEVE_MEMOIRE_MS);
      releveMemoire.unref?.();
      const limiteSante = Math.min(limite, maintenant() + demarrageMs);
      for (;;) {
        if (fini.termine) throw Object.assign(new Error(`le moteur s’est arrêté pendant le chargement (${fini.signal ? `signal ${fini.signal}` : `code ${fini.code}`})`), { pendantChargement: true, signal: fini.signal });
        if (await sante(port)) break;
        if (maintenant() >= limiteSante) throw new Error('modèle trop long à charger');
        await attendre(250);
      }
      serveur = { enfant, pid: enfant.pid, port, cle, depuis: maintenant() };
      enMarche.add(moi);
      surveillerSortie();
      dernierDemarrageMs = maintenant() - debut;
      effacerErreur();
      log.log?.(`[esport] IA locale démarrée en ${Math.round(dernierDemarrageMs / 1000)} s (127.0.0.1, ${threads} fils).`);
      const m = lireMemoire(enfant.pid);
      if (m) memoire = m;
      noter(`moteur pid ${enfant.pid} prêt en ${Math.round(dernierDemarrageMs / 1000)} s (${threads} fils, contexte ${contexte} jetons${m ? `, mémoire ${enGo(m.rssMo)}` : ''}).`);
    } catch (e) {
      clearInterval(battement);
      clearInterval(releveMemoire);
      if (enfant?.pid) {
        try {
          process.kill(enfant.pid, 'SIGKILL');
        } catch {
          // Déjà parti.
        }
      }
      serveur = null;
      libererVerrou();
      if (e?.code) {
        derniereErreur = { code: e.code, le: iso(maintenant()) };
        if (e.code !== 'ia-locale-occupee') noter(`démarrage refusé : ${e.code}.`);
        throw e;
      }
      log.error?.(`[esport] IA locale : démarrage impossible (${e?.message ?? e}).`);
      if (e?.pendantChargement && e.signal === 'SIGKILL') {
        noterErreur('ia-locale-demarrage-memoire', `démarrage impossible : ${e.message} : tué par le système, souvent la limite mémoire du compte (LVE).`);
        throw Object.assign(echec(503, 'ia-locale-demarrage-memoire', 'L’IA locale n’a pas pu démarrer : le système a arrêté son moteur pendant le chargement (mémoire du compte probablement insuffisante ; voir ~/logs/esport-ia-locale.log).'), { reprise: true });
      }
      noterErreur('ia-locale-demarrage', `démarrage impossible : ${e?.message ?? e}.`);
      throw Object.assign(echec(503, 'ia-locale-demarrage', 'L’IA locale n’a pas pu démarrer (voir ~/logs/esport-ia-locale.log).'), { reprise: Boolean(e?.pendantChargement) });
    } finally {
      if (typeof fd === 'number') closeSync(fd);
    }
  }

  function effacerErreur() {
    derniereErreur = null;
    try {
      rmSync(c.incident, { force: true });
    } catch {
      // Sans gravité.
    }
  }

  /** Dernière erreur, de ce processus ou d'un autre (processus de fond) : la plus récente des deux. */
  function erreurRecente() {
    const partagee = lireJson(c.incident);
    const ok = partagee && typeof partagee.code === 'string' && Number.isFinite(Date.parse(partagee.le ?? ''));
    if (!ok) return derniereErreur;
    if (!derniereErreur || Date.parse(partagee.le) > Date.parse(derniereErreur.le)) return { code: partagee.code, le: partagee.le };
    return derniereErreur;
  }

  async function arreter() {
    clearTimeout(minuteurRepos);
    minuteurRepos = null;
    const s = serveur;
    if (!s) return false;
    serveur = null;
    enMarche.delete(moi);
    clearInterval(battement);
    clearInterval(releveMemoire);
    const parti = new Promise(ok => {
      if (s.enfant.exitCode !== null || s.enfant.signalCode !== null) ok();
      else s.enfant.once('exit', ok);
    });
    try {
      s.enfant.kill('SIGTERM');
    } catch {
      // Déjà parti.
    }
    const dur = setTimeout(() => {
      try {
        s.enfant.kill('SIGKILL');
      } catch {
        // Déjà parti.
      }
    }, 5000);
    await parti;
    clearTimeout(dur);
    libererVerrou();
    log.log?.('[esport] IA locale arrêtée.');
    return true;
  }

  function armerRepos() {
    clearTimeout(minuteurRepos);
    minuteurRepos = null;
    if (!serveur) return;
    if (inactiviteMs <= 0) {
      void arreter();
      return;
    }
    minuteurRepos = setTimeout(() => void arreter(), inactiviteMs);
    minuteurRepos.unref?.();
  }

  async function pomper() {
    if (actif) return;
    const t = file.shift();
    if (!t) {
      armerRepos();
      return;
    }
    actif = true;
    clearTimeout(minuteurRepos);
    try {
      if (maintenant() >= t.limite) throw echec(504, 'ia-delai', 'Le service d’IA met trop de temps à répondre.');
      // Moteur mort mais sa sortie pas encore traitée : on ne l'utilise plus.
      if (serveur && (serveur.enfant.exitCode !== null || serveur.enfant.signalCode !== null)) await attendreSortieDe(serveur.pid, 1000);
      if (!serveur) {
        // Juste après un arrêt imprévu (mémoire, plantage), une courte pause avant de relancer le moteur.
        const depuisArret = derniereSortie?.imprevue ? maintenant() - derniereSortie.le : Infinity;
        if (depuisArret < pauseApresArretMs) await attendre(pauseApresArretMs - depuisArret);
        const lancer = () => {
          demarrage ??= demarrer(t.limite).finally(() => {
            demarrage = null;
          });
          return demarrage;
        };
        try {
          await lancer();
        } catch (e) {
          // Moteur mort pendant le chargement : un second essai, après une pause.
          if (!e?.reprise || maintenant() + pauseApresArretMs >= t.limite) throw e;
          noter(`nouvel essai de démarrage dans ${Math.round(pauseApresArretMs / 1000)} s.`);
          await attendre(pauseApresArretMs);
          await lancer();
        }
      }
      dernierUsage = maintenant();
      majVerrou({});
      t.ok(await t.fn({ port: serveur.port, cle: serveur.cle, limite: t.limite, pid: serveur.pid }));
    } catch (e) {
      t.ko(e);
    } finally {
      dernierUsage = maintenant();
      actif = false;
      void pomper();
    }
  }

  /** Sortie du moteur `pid` (attendue au plus `ms`) : { pid, code, signal, imprevue }, ou null s'il vit encore. */
  function attendreSortieDe(pid, ms) {
    if (!Number.isInteger(pid)) return Promise.resolve(null);
    if (derniereSortie?.pid === pid) return Promise.resolve(derniereSortie);
    return new Promise(ok => {
      const a = {
        pid,
        ok: v => {
          clearTimeout(a.minuteur);
          attentesSortie.delete(a);
          ok(v);
        },
      };
      a.minuteur = setTimeout(() => a.ok(null), ms);
      a.minuteur.unref?.();
      attentesSortie.add(a);
    });
  }

  return {
    dossier: c.dossier,
    /**
     * Exécute `fn({ port, cle, limite, pid })` quand le serveur est prêt (démarré au besoin), une tâche à la
     * fois. `delai` : temps total accordé (attente comprise).
     */
    executer(fn, { delai = delaiMs } = {}) {
      if (file.length >= fileMax) return Promise.reject(echec(503, 'ia-locale-occupee', 'L’IA locale est occupée par une autre tâche : réessayez dans quelques minutes.'));
      return new Promise((ok, ko) => {
        file.push({ fn, ok, ko, limite: maintenant() + delai });
        void pomper();
      });
    },
    arreter,
    /** État pour l'Administration IA (rien de secret : ni port, ni clé). */
    etat() {
      const v = lireVerrou(c.verrouServeur);
      const ailleurs = !serveur && v && v.jeton !== jeton && verrouActif(v, maintenant()) && processusVivant(v.pid);
      return {
        enMarche: Boolean(serveur) || Boolean(ailleurs),
        ailleurs: Boolean(ailleurs),
        demarrage: Boolean(demarrage),
        depuis: serveur ? iso(serveur.depuis) : ailleurs ? v.demarreLe ?? null : null,
        file: file.length + (actif ? 1 : 0),
        dernierUsage: dernierUsage ? iso(dernierUsage) : null,
        dernierDemarrageMs,
        derniereErreur: erreurRecente(),
        mesure: lireJson(c.mesures),
      };
    },
    attendreSortie: attendreSortieDe,
    /** Ligne de diagnostic dans le journal (sans changer la « dernière erreur »). */
    noter,
    /** Dernière vitesse mesurée (jetons générés par seconde), partagée entre processus (etat/mesures.json). */
    noterMesure({ jetonsParSeconde, dureeMs }) {
      if (!Number.isFinite(jetonsParSeconde) && !Number.isFinite(dureeMs)) return;
      // Une requête vient de réussir : l'erreur notée avant n'a plus cours.
      effacerErreur();
      try {
        preparerDossier();
        ecrireAtomique(c.mesures, JSON.stringify({ jetonsParSeconde: Number.isFinite(jetonsParSeconde) ? Math.round(jetonsParSeconde * 10) / 10 : null, dureeMs: Number.isFinite(dureeMs) ? dureeMs : null, le: iso(maintenant()) }));
      } catch {
        // Mesure perdue : sans gravité.
      }
    },
    nettoyerOrphelin: () => nettoyerOrphelinIaLocale({ dossier: c.dossier, maintenant: maintenant(), lire, journal, role }),
    /** Diagnostic d'une requête échouée (cause réelle), avec l'état du moteur à cet instant. */
    noterIncident(texte, code = null) {
      const moteur = serveur ? `moteur pid ${serveur.pid} ${processusVivant(serveur.pid) ? 'toujours en marche' : 'disparu'}` : 'moteur arrêté';
      if (code) noterErreur(code, `${texte} ; ${moteur}.`);
      else noter(`${texte} ; ${moteur}.`);
    },
  };
}
