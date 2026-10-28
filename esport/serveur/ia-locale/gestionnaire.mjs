/**
 * Gestionnaire du serveur d'inférence local (llama-server de llama.cpp), À LA DEMANDE :
 *
 *  - démarré quand une tâche IA arrive, écoute SEULEMENT sur 127.0.0.1, sur un port libre tiré à chaque
 *    démarrage, avec une clé d'accès aléatoire (fichier 0600, jamais sur la ligne de commande) : sur un
 *    serveur mutualisé, l'adresse 127.0.0.1 est partagée avec les autres comptes ; sans la clé, rien ;
 *  - arrêté après `inactiviteMs` sans requête (5 minutes par défaut), ou tout de suite par `arreter()` ;
 *  - UN SEUL serveur pour tout le compte (verrou etat/serveur.json créé en exclusif = BAIL : pid, espace de
 *    pid et heure de démarrage du propriétaire, pid du moteur, battement toutes les 30 s) : un autre processus
 *    (app Passenger, travailleur, installateur) attend son tour ou renonce (« IA locale occupée »). Le
 *    propriétaire est tenu pour vivant tant que son battement est récent, MÊME si `kill(pid, 0)` ne le voit
 *    pas (CageFS : l'app, le cron et SSH ne se voient pas forcément) ; il n'est déclaré mort plus tôt que si
 *    c'est certain (voir processus.mjs) ;
 *  - moteur ORPHELIN (bail expiré : redémarrage Passenger, processus tué) : arrêté au prochain usage, au
 *    démarrage de l'app et à chaque passage du cron (`nettoyerOrphelinIaLocale`), seulement s'il est
 *    IDENTIFIÉ (visible d'ici, notre fichier de clé sur sa ligne de commande, même heure de démarrage) :
 *    SIGTERM, puis SIGKILL s'il résiste. Moteur encore vivant mais hors de portée : rien n'est touché, et
 *    AUCUN second moteur n'est lancé ;
 *  - chaque signal envoyé par notre code est journalisé (qui, pourquoi, pid) : un moteur tué sans ligne
 *    « signal … envoyé » l'a été par un autre programme ou par l'hébergeur ;
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
import { chmodSync, closeSync, readFileSync, existsSync, mkdirSync, openSync, renameSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname } from 'node:path';
import { echec } from '../../noyau/outils.mjs';
import { cheminsIaLocale, journalIaLocaleParDefaut, lireJson } from './installation.mjs';
import { arreterProcessus, descriptionProcessus, envoyerSignal, espacePid, identiteProcessus, ligneDeCommande, memoireProcessus, moteursVisibles, mortCertaine, noterIaLocale, processusDuCompte, processusVivant, sonderMoteur } from './processus.mjs';

export { ligneDeCommande, memoireProcessus, noterIaLocale, processusVivant };

export const BATTEMENT_MS = 30_000;
/** Relevé de la mémoire du moteur (noté à sa mort, pour le diagnostic). */
export const RELEVE_MEMOIRE_MS = 5000;
/** Bail du verrou : sans battement depuis ce délai, le propriétaire est tenu pour parti. */
export const VERROU_PERIME_MS = 3 * 60_000;
/** Arrêt d'un moteur : SIGTERM, puis SIGKILL s'il est encore là après ce délai. */
export const GRACE_ARRET_MS = 10_000;
const TAILLE_MAX_JOURNAL = 5 * 1024 * 1024;

const attendre = ms => new Promise(ok => setTimeout(ok, ms));

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

/** Verrou lu, ou null. */
const lireVerrou = chemin => {
  const v = lireJson(chemin);
  return v && typeof v === 'object' ? v : null;
};

/** Description du propriétaire inscrite dans le verrou (espace de pid, démarrage machine, heure de démarrage). */
const descProprietaire = v => (v?.ns || v?.boot ? { ns: v.ns ?? null, boot: v.boot ?? null, debut: v.debutProprietaire ?? null } : null);

/**
 * Le propriétaire du verrou est-il encore là ? Oui tant que son BAIL est valide (battement de moins de
 * VERROU_PERIME_MS), sauf mort CERTAINE (même espace de pid que nous et disparu, pid réutilisé, machine
 * redémarrée). `kill(pid, 0)` seul ne suffit JAMAIS à le déclarer mort : sous CageFS, l'app, le cron et une
 * session SSH ne se voient pas forcément. `systeme` (tests) : { ns, boot, identite, vivant }.
 */
export function verrouActif(v, maintenant = Date.now(), systeme = {}) {
  if (!v) return false;
  const maj = Date.parse(v.majLe ?? '');
  if (!Number.isFinite(maj) || maintenant - maj >= VERROU_PERIME_MS) return false;
  return !mortCertaine(v.proprietaire, descProprietaire(v), systeme);
}

/**
 * Le moteur inscrit au verrou est-il visible d'ici ET identifié comme le nôtre (même heure de démarrage que
 * celle inscrite, notre fichier de clé sur sa ligne de commande) ? Seul un moteur identifié peut recevoir un signal.
 */
function moteurIdentifie(v, fichierCle, lire, systeme = {}) {
  if (!Number.isInteger(v?.pid) || v.pid <= 1) return false;
  const id = (systeme.identite ?? identiteProcessus)(v.pid);
  if (!id) return false;
  if (v.debutMoteur && id.debut !== v.debutMoteur) return false;
  return estNotreServeur(v.pid, fichierCle, lire);
}

const lireCle = chemin => {
  try {
    return readFileSync(chemin, 'utf8').trim() || null;
  } catch {
    return null;
  }
};

// Un même moteur hors de portée n'est noté qu'une fois par processus (le nettoyage est retenté chaque seconde).
const horsDePorteeNotes = new Set();

/**
 * Nettoyage d'un moteur orphelin (bail expiré ou propriétaire mort de façon certaine). Appelé au démarrage
 * de l'app, par le cron, par le processus de fond et avant chaque démarrage. Rend `{ nettoye, pid?, raison }` :
 *  - moteur identifié (visible d'ici, notre clé, même heure de démarrage) : SIGTERM, puis SIGKILL s'il résiste
 *    (chaque signal journalisé), puis verrou et clé retirés ;
 *  - moteur non identifiable (autre espace de pid) mais qui RÉPOND encore sur son port avec notre clé : rien
 *    n'est touché ('hors-de-portee') — le verrou reste, donc aucun second moteur n'est lancé ;
 *  - moteur absent : verrou et clé retirés.
 */
export async function nettoyerOrphelinIaLocale({ dossier, maintenant = Date.now(), lire = ligneDeCommande, journal = null, role = null, systeme = {}, sonder = sonderMoteur, graceMs = GRACE_ARRET_MS } = {}) {
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
  if (verrouActif(v, maintenant, systeme)) return { nettoye: false, raison: 'en-service' };
  // Toujours le MÊME verrou (un autre processus a pu le remplacer entre-temps par le sien) ?
  const toujours = () => lireVerrou(c.verrouServeur)?.jeton === v.jeton;
  if (!toujours()) return { nettoye: false, raison: 'remplace' };
  const age = Math.round((maintenant - Date.parse(v.majLe ?? '')) / 1000);
  const certaine = mortCertaine(v.proprietaire, descProprietaire(v), systeme);
  const proprio = `propriétaire pid ${v.proprietaire}${v.role ? ` (${v.role})` : ''} ${certaine ? 'disparu' : `sans battement depuis ${Number.isFinite(age) ? `${age} s` : '?'}`}`;
  // Propriétaire VISIBLE et bien vivant (même espace de pid, même heure de démarrage) mais sans battement : suspendu
  // (Ctrl-Z) ou bloqué ; il n'est pas mort, son moteur n'est pas touché.
  const desc = descProprietaire(v);
  const idProprio = !certaine && desc?.ns && desc.ns === (systeme.ns ?? espacePid('self')) ? (systeme.identite ?? identiteProcessus)(v.proprietaire) : null;
  if (idProprio && desc.debut && idProprio.debut === desc.debut) {
    if (!horsDePorteeNotes.has(`vivant:${v.jeton}`)) {
      horsDePorteeNotes.add(`vivant:${v.jeton}`);
      noterIaLocale(journal, `verrou du moteur sans battement depuis ${Number.isFinite(age) ? `${age} s` : '?'} mais propriétaire pid ${v.proprietaire} toujours vivant (suspendu ?) : rien n'est touché.`, role);
    }
    return { nettoye: false, raison: 'proprietaire-vivant' };
  }
  let arrete = false;
  if (Number.isInteger(v.pid) && v.pid > 1) {
    if (moteurIdentifie(v, c.cle, lire, systeme)) {
      const r = await arreterProcessus(v.pid, { toujours: () => moteurIdentifie(v, c.cle, lire, systeme), graceMs, cible: 'moteur orphelin', raison: proprio, journal, role });
      if (!r.parti) {
        noterIaLocale(journal, `moteur orphelin pid ${v.pid} toujours là après SIGKILL : verrou gardé.`, role);
        return { nettoye: false, raison: 'resiste', pid: v.pid };
      }
      arrete = true;
    } else if (v.port && toujours()) {
      const etat = await sonder(v.port, lireCle(c.cle));
      if (etat === 'notre' || etat === 'inconnu') {
        if (!horsDePorteeNotes.has(v.jeton)) {
          horsDePorteeNotes.add(v.jeton);
          noterIaLocale(journal, `moteur pid ${v.pid} sans propriétaire (${proprio}) mais ENCORE EN MARCHE et hors de portée d'ici (autre espace de processus) : aucun signal envoyé, verrou gardé, aucun second moteur tant qu'il répond.`, role);
        }
        return { nettoye: false, raison: 'hors-de-portee', pid: v.pid };
      }
    }
  }
  // La clé AVANT le verrou, et seulement si l'ancien verrou est toujours là : tant qu'il existe, personne
  // n'a pu prendre le moteur ni écrire une nouvelle clé.
  if (!toujours()) return { nettoye: arrete, raison: 'remplace', ...(arrete ? { pid: v.pid } : {}) };
  rmSync(c.cle, { force: true });
  if (toujours()) rmSync(c.verrouServeur, { force: true });
  noterIaLocale(journal, `moteur orphelin nettoyé (${proprio}${arrete ? `, moteur pid ${v.pid} arrêté` : v.pid ? `, moteur pid ${v.pid} déjà arrêté` : ''}).`, role);
  return { nettoye: true, raison: 'orphelin', ...(arrete ? { pid: v.pid } : {}) };
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
export function argumentsServeur({ fichierModele, port, fichierCle, threads, contexte, delaiS, hote = '127.0.0.1' }) {
  return [
    '-m', fichierModele,
    // `hote` : 127.0.0.1, ou un chemin « ….sock » (socket Unix, aucun port TCP : --diagnostic seulement).
    '--host', hote,
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
    // Fils du serveur HTTP : par défaut un par cœur VISIBLE (64 sur o2switch) ; une requête à la fois suffit.
    '--threads-http', '4',
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

// Moteurs encore en marche quand le processus Node se termine normalement : SIGTERM (journalisé). Les autres cas
// (processus tué) : le bail expire, puis le nettoyage des orphelins s'en charge.
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
 *  injectables : `spawn`, `fetch`, `trouverPort`, `maintenant`, `lire` (ligne de commande), `log`,
 *  `systeme` (visibilité des processus : { ns, boot, identite, vivant }), `sonder` (moteur sur son port),
 *  `listerProcessus` (processus visibles du compte), `graceMs` (SIGTERM → SIGKILL).
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
  systeme = {},
  sonder = sonderMoteur,
  listerProcessus = processusDuCompte,
  graceMs = GRACE_ARRET_MS,
} = {}) {
  const c = cheminsIaLocale(dossier);
  const jeton = randomBytes(8).toString('hex');
  const file = [];
  let actif = false;
  let serveur = null; // { enfant, suivi, pid, port, cle, depuis }
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
  const ici = descriptionProcessus();

  /**
   * Signal à NOTRE moteur (enfant de ce processus : identité certaine), journalisé. `suivi.signaux` garde la
   * trace de ce que nous avons envoyé : à sa sortie, un signal reçu qui n'en fait pas partie vient d'ailleurs.
   */
  function signaler(enfant, suivi, signal, raison) {
    if (enfant.exitCode !== null || enfant.signalCode !== null) return false;
    suivi.signaux.push(signal);
    return envoyerSignal(enfant.pid, signal, { cible: 'moteur', raison, journal, role });
  }

  /** SIGTERM, puis SIGKILL après `graceMs` s'il n'est pas sorti (minuteur rendu). */
  function arreterEnfant(enfant, suivi, raison) {
    suivi.arretDemande ??= raison;
    signaler(enfant, suivi, 'SIGTERM', raison);
    const dur = setTimeout(() => signaler(enfant, suivi, 'SIGKILL', `${raison} ; toujours là ${Math.round(graceMs / 1000)} s après SIGTERM`), graceMs);
    dur.unref?.();
    enfant.once('exit', () => clearTimeout(dur));
    return dur;
  }

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

  /**
   * Prend le verrou du compte (exclusif). Rend true, ou false s'il est tenu (bail valide), ou si un moteur
   * sans propriétaire répond encore sans pouvoir être arrêté d'ici. Le verrou décrit le propriétaire (espace
   * de pid, démarrage machine, heure de démarrage) : les autres processus peuvent savoir s'il est mort À COUP SÛR.
   */
  async function prendreVerrou() {
    preparerDossier();
    for (let essai = 0; essai < 2; essai++) {
      try {
        const fd = openSync(c.verrouServeur, 'wx', 0o600);
        writeFileSync(fd, JSON.stringify({ proprietaire: process.pid, role, ns: ici.ns, boot: ici.boot, debutProprietaire: ici.debut, jeton, pid: null, port: null, demarreLe: iso(maintenant()), majLe: iso(maintenant()) }));
        closeSync(fd);
        return true;
      } catch (e) {
        if (e?.code !== 'EEXIST') throw e;
      }
      const v = lireVerrou(c.verrouServeur);
      if (v?.jeton === jeton) return true;
      if (verrouActif(v, maintenant(), systeme)) return false;
      const n = await nettoyerOrphelinIaLocale({ dossier: c.dossier, maintenant: maintenant(), lire, journal, role, systeme, sonder, graceMs });
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

  /** Fin du processus Node : SIGTERM au moteur (journalisé), verrou rendu. */
  function arretImmediat() {
    const s = serveur;
    serveur = null;
    if (s) {
      s.suivi.arretDemande ??= 'fin du processus propriétaire';
      signaler(s.enfant, s.suivi, 'SIGTERM', 'fin du processus propriétaire');
    }
    try {
      libererVerrou();
    } catch {
      // Sortie du processus : au mieux.
    }
  }
  const moi = { arretImmediat };

  /** Qui tient le moteur (pour un message) : { role, pid, depuis } ou null. */
  function occupant() {
    const v = lireVerrou(c.verrouServeur);
    if (!v || v.jeton === jeton) return null;
    return { role: v.role ?? null, pid: v.proprietaire ?? null, moteur: v.pid ?? null, depuis: v.demarreLe ?? null, actif: verrouActif(v, maintenant(), systeme) };
  }

  async function attendreVerrou(limite) {
    for (;;) {
      if (await prendreVerrou()) return;
      if (maintenant() >= limite) throw Object.assign(echec(503, 'ia-locale-occupee', 'L’IA locale est occupée par une autre tâche : réessayez dans quelques minutes.'), { occupant: occupant() });
      await attendre(1000);
    }
  }

  /**
   * Moteurs VISIBLES lancés avec notre fichier de clé alors que NOUS tenons le verrou du compte : personne ne
   * les possède (restes d'un ancien nettoyage, propriétaire tué) ; arrêtés (SIGTERM puis SIGKILL, journalisés)
   * avant d'en lancer un autre : jamais deux moteurs à la fois.
   */
  async function arreterMoteursSansProprietaire() {
    let liste = [];
    try {
      liste = moteursVisibles(c.cle, listerProcessus());
    } catch {
      return;
    }
    const identite = systeme.identite ?? identiteProcessus;
    for (const m of liste) {
      if (m.pid === process.pid) continue;
      const id = identite(m.pid);
      if (!id) continue;
      const toujours = () => {
        const x = identite(m.pid);
        return Boolean(x && x.debut === id.debut && estNotreServeur(m.pid, c.cle, lire));
      };
      await arreterProcessus(m.pid, { toujours, graceMs, cible: 'moteur sans propriétaire', raison: 'lancé avec notre clé mais inscrit à aucun verrou (ce processus tient le verrou du compte)', journal, role });
    }
  }

  /** Mémoire visible du compte (somme des processus visibles d'ici), en Mo, ou null. */
  function memoireCompte() {
    try {
      const l = listerProcessus();
      return l.length ? { mo: l.reduce((t, p) => t + (p.rssMo || 0), 0), n: l.length } : null;
    } catch {
      return null;
    }
  }

  async function demarrer(limite) {
    if (!binaire || !fichierModele) throw echec(503, 'ia-locale-absente', 'IA locale non installée (lancer esport/serveur/installer-ia-locale.sh).');
    const debut = maintenant();
    await attendreVerrou(Math.min(limite, debut + attenteVerrouMs));
    let enfant = null;
    let suivi = null;
    let fd = 'ignore';
    try {
      await arreterMoteursSansProprietaire();
      const cle = randomBytes(24).toString('hex');
      ecrireAtomique(c.cle, `${cle}\n`);
      const port = await trouverPort();
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('port');
      const args = argumentsServeur({ fichierModele, port, fichierCle: c.cle, threads, contexte, delaiS: Math.ceil(delaiMs / 1000) });
      const niceBin = nice > 0 ? trouverNice() : null;
      fd = ouvrirJournal();
      // DÉTACHÉ (groupe de processus à lui) : un signal adressé au groupe du processus parent (fin d'une session,
      // arrêt de l'app) ne l'atteint pas ; nous l'arrêtons nous-mêmes, par SIGTERM journalisé.
      enfant = spawn(niceBin ?? binaire, niceBin ? ['-n', String(Math.min(19, Math.max(1, nice))), binaire, ...args] : args, {
        stdio: ['ignore', fd, fd],
        env: environnementMoteur(binaire),
        cwd: c.etat,
        detached: true,
      });
      const s0 = { signaux: [], arretDemande: null, pret: false };
      suivi = s0;
      const fini = { code: null, termine: false };
      const lui = enfant;
      enfant.on('exit', (code, signal) => {
        fini.termine = true;
        fini.code = code ?? signal;
        fini.signal = signal ?? null;
        const etaitServeur = serveur?.enfant === lui;
        // Imprévue : un signal que NOUS n'avons pas envoyé, ou une sortie sans qu'on l'ait demandée.
        const imprevue = signal ? !s0.signaux.includes(signal) : !s0.arretDemande;
        const mem = memoire;
        derniereSortie = { pid: lui.pid, code: code ?? null, signal: signal ?? null, imprevue, le: maintenant(), signauxEnvoyes: [...s0.signaux] };
        clearInterval(releveMemoire);
        const phase = !s0.pret ? 'pendant le chargement' : s0.arretDemande ? 'pendant son arrêt' : actif ? 'PENDANT une requête' : 'au repos';
        if (etaitServeur) {
          serveur = null;
          enMarche.delete(moi);
          clearInterval(battement);
          clearTimeout(minuteurRepos);
          libererVerrou();
        }
        if (imprevue) {
          const nos = s0.signaux.length ? `nous lui avions envoyé seulement ${[...new Set(s0.signaux)].join(', ')}` : 'ce processus ne lui a envoyé aucun signal';
          const quoi = signal ? `signal ${signal}${signal === 'SIGKILL' ? ' : arrêté de force par un autre processus ou par l’hébergeur' : ''} ; ${nos}` : `code ${code}`;
          const memTexte = mem ? ` ; mémoire relevée juste avant : ${enGo(mem.rssMo)}${mem.picMo ? ` (pic ${enGo(mem.picMo)})` : ''}` : '';
          const texte = `moteur pid ${lui.pid} arrêté de façon imprévue ${phase} (${quoi})${memTexte}.`;
          // Au chargement, l'échec du démarrage est noté plus bas (code d'erreur du démarrage).
          if (s0.pret && !(code === 0 && !signal)) noterErreur('ia-locale-arret', texte);
          else noter(texte);
        } else {
          noter(`moteur pid ${lui.pid} arrêté à notre demande (${signal ? `signal ${signal}` : `code ${code}`}) : ${s0.arretDemande ?? 'arrêt'}.`);
        }
        for (const a of attentesSortie) if (a.pid === lui.pid) a.ok(derniereSortie);
      });
      enfant.on('error', () => {
        fini.termine = true;
      });
      if (!enfant.pid) throw new Error('lancement');
      majVerrou({ pid: enfant.pid, port, debutMoteur: (systeme.identite ?? identiteProcessus)(enfant.pid)?.debut ?? null, demarreLe: iso(debut) });
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
      s0.pret = true;
      serveur = { enfant, suivi: s0, pid: enfant.pid, port, cle, depuis: maintenant() };
      enMarche.add(moi);
      surveillerSortie();
      dernierDemarrageMs = maintenant() - debut;
      effacerErreur();
      log.log?.(`[esport] IA locale démarrée en ${Math.round(dernierDemarrageMs / 1000)} s (127.0.0.1, ${threads} fils).`);
      const m = lireMemoire(enfant.pid);
      if (m) memoire = m;
      const compte = memoireCompte();
      noter(`moteur pid ${enfant.pid} prêt en ${Math.round(dernierDemarrageMs / 1000)} s (${threads} fils, contexte ${contexte} jetons${m ? `, mémoire ${enGo(m.rssMo)}` : ''}${compte ? ` ; processus visibles du compte : ${compte.n}, ${enGo(compte.mo)} en tout` : ''}).`);
    } catch (e) {
      clearInterval(battement);
      clearInterval(releveMemoire);
      if (enfant?.pid && suivi) arreterEnfant(enfant, suivi, `échec du démarrage (${e?.code ?? e?.message ?? e})`);
      serveur = null;
      libererVerrou();
      if (e?.code) {
        derniereErreur = { code: e.code, le: iso(maintenant()) };
        if (e.code !== 'ia-locale-occupee') noter(`démarrage refusé : ${e.code}.`);
        throw e;
      }
      log.error?.(`[esport] IA locale : démarrage impossible (${e?.message ?? e}).`);
      if (e?.pendantChargement && e.signal === 'SIGKILL') {
        noterErreur('ia-locale-demarrage-tue', `démarrage impossible : ${e.message} : arrêté de force par un autre processus ou par l’hébergeur (aucun signal envoyé par ce processus).`);
        throw Object.assign(echec(503, 'ia-locale-demarrage-tue', 'L’IA locale n’a pas pu démarrer : son moteur a été arrêté de force (SIGKILL) pendant le chargement, par un autre processus ou par l’hébergeur (voir ~/logs/esport-ia-locale.log).'), { reprise: true });
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

  async function arreter(raison = 'arrêt demandé') {
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
    arreterEnfant(s.enfant, s.suivi, raison);
    await parti;
    libererVerrou();
    log.log?.('[esport] IA locale arrêtée.');
    return true;
  }

  function armerRepos() {
    clearTimeout(minuteurRepos);
    minuteurRepos = null;
    if (!serveur) return;
    if (inactiviteMs <= 0) {
      void arreter('inactivité');
      return;
    }
    minuteurRepos = setTimeout(() => void arreter(`inactivité (${Math.round(inactiviteMs / 1000)} s sans requête)`), inactiviteMs);
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
      const ailleurs = !serveur && v && v.jeton !== jeton && verrouActif(v, maintenant(), systeme);
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
    nettoyerOrphelin: () => nettoyerOrphelinIaLocale({ dossier: c.dossier, maintenant: maintenant(), lire, journal, role, systeme, sonder, graceMs }),
    /** Qui tient le moteur, s'il est tenu par un autre processus : { role, pid, moteur, depuis, actif } ou null. */
    occupant,
    /** Diagnostic d'une requête échouée (cause réelle), avec l'état du moteur à cet instant. */
    noterIncident(texte, code = null) {
      const moteur = serveur ? `moteur pid ${serveur.pid} ${processusVivant(serveur.pid) ? 'toujours en marche' : 'disparu'}` : 'moteur arrêté';
      if (code) noterErreur(code, `${texte} ; ${moteur}.`);
      else noter(`${texte} ; ${moteur}.`);
    },
  };
}
