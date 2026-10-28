/**
 * Processus du compte, vus depuis l'IA locale : identité fiable d'un processus, signaux JOURNALISÉS, mémoire.
 *
 * Pourquoi : sur o2switch (CloudLinux + CageFS), l'app (Passenger), le cron, le processus de fond et une session
 * SSH (installateur) ne se voient pas forcément entre eux : `kill(pid, 0)` peut répondre « n'existe pas » (ESRCH)
 * pour un processus bien vivant d'un autre « espace » de pid, et /proc ne montre pas ses informations. Un
 * propriétaire vivant pouvait donc passer pour mort. Ici :
 *
 *  - un processus est décrit par son espace de pid (/proc/<pid>/ns/pid), son heure de démarrage (/proc/<pid>/stat,
 *    champ 22 : distingue un pid réutilisé) et l'identifiant de démarrage de la machine ;
 *  - un processus n'est déclaré MORT que si c'est certain : même machine, même espace de pid que nous, et il a
 *    disparu (ou son pid a été réutilisé) ; sinon on ne sait pas — et on se fie au BAIL (battement horodaté) ;
 *  - TOUT signal envoyé par notre code passe par `envoyerSignal` : une ligne « signal … envoyé à pid … par … : … »
 *    dans ~/logs/esport-ia-locale.log, AVANT l'envoi. Un moteur tué sans une telle ligne l'a été par un autre
 *    programme (ou par l'hébergeur), jamais par nous.
 */

import { appendFileSync, mkdirSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import http from 'node:http';
import { dirname } from 'node:path';

const attendre = ms => new Promise(ok => setTimeout(ok, ms));

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

/** Le pid répond-il à `kill(pid, 0)` ? (EPERM : il existe mais appartient à un autre compte.) */
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

/** Champs de /proc/<pid>/stat après le nom (qui peut contenir des espaces et des parenthèses). */
function champsStat(pid) {
  try {
    const t = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return t.slice(t.lastIndexOf(')') + 2).split(' ');
  } catch {
    return null;
  }
}

/** Temps processeur consommé (tics d'horloge, utime + stime), ou null. */
export function ticsProcesseur(pid) {
  const f = champsStat(pid);
  if (!f) return null;
  const n = Number(f[11]) + Number(f[12]);
  return Number.isFinite(n) ? n : null;
}

let bootId;
/** Identifiant du démarrage de la machine (change à chaque redémarrage), ou null. */
export function identifiantDemarrage() {
  if (bootId === undefined) {
    try {
      bootId = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() || null;
    } catch {
      bootId = null;
    }
  }
  return bootId;
}

/** Espace de pid d'un processus (ex. « pid:[4026531836] »), ou null s'il est invisible d'ici. */
export function espacePid(pid = 'self') {
  try {
    return readlinkSync(`/proc/${pid}/ns/pid`);
  } catch {
    return null;
  }
}

/**
 * Identité d'un processus VISIBLE d'ici : { pid, ns, debut } (debut = heure de démarrage en tics depuis le
 * démarrage de la machine), ou null s'il est invisible (disparu, ou dans un autre espace de pid).
 */
export function identiteProcessus(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return null;
  const f = champsStat(pid);
  if (!f) return null;
  return { pid, ns: espacePid(pid), debut: f[19] ?? null };
}

/** Description du processus courant, à inscrire dans un verrou : { ns, boot, debut }. */
export function descriptionProcessus(pid = process.pid) {
  const id = identiteProcessus(pid);
  return { ns: espacePid('self'), boot: identifiantDemarrage(), debut: id?.debut ?? null };
}

/**
 * Le processus `pid` (décrit par `desc` = { ns, boot, debut } au moment où il a été inscrit) est-il mort de
 * façon CERTAINE ? Vrai seulement si la machine a redémarré, ou si nous sommes dans le même espace de pid que lui
 * (on le verrait donc s'il vivait) et qu'il a disparu ou que son pid sert à un autre processus. Sans description
 * (ancien verrou) ou depuis un autre espace : faux (on ne sait pas).
 */
export function mortCertaine(pid, desc, { ns = espacePid('self'), boot = identifiantDemarrage(), identite = identiteProcessus, vivant = processusVivant } = {}) {
  if (!Number.isInteger(pid) || pid <= 1) return true;
  if (!desc || typeof desc !== 'object') return false;
  if (desc.boot && boot && desc.boot !== boot) return true;
  if (!desc.ns || !ns || desc.ns !== ns) return false;
  const id = identite(pid);
  if (!id) return !vivant(pid);
  return Boolean(desc.debut && id.debut && id.debut !== desc.debut);
}

/**
 * Envoie `signal` à `pid` en le NOTANT d'abord dans le journal : qui (rôle, pid), quoi (cible), pourquoi.
 * Rend true si le signal est parti.
 */
export function envoyerSignal(pid, signal, { cible = 'processus', raison = '', journal = null, role = null, tuer = (p, s) => process.kill(p, s) } = {}) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  noterIaLocale(journal, `signal ${signal} envoyé à pid ${pid} (${cible})${raison ? ` : ${raison}` : ''}.`, role);
  try {
    tuer(pid, signal);
    return true;
  } catch (e) {
    noterIaLocale(journal, `signal ${signal} à pid ${pid} non délivré (${e?.code ?? 'erreur'}).`, role);
    return false;
  }
}

/**
 * Arrêt propre d'un processus identifié : SIGTERM, attente (`graceMs`), puis SIGKILL seulement si `toujours()`
 * (même identité) est encore vrai. Chaque signal est journalisé. Rend { parti, force }.
 */
export async function arreterProcessus(pid, { toujours, graceMs = 10_000, cible, raison, journal, role, tuer } = {}) {
  const encore = toujours ?? (() => processusVivant(pid));
  if (!encore()) return { parti: true, force: false };
  envoyerSignal(pid, 'SIGTERM', { cible, raison, journal, role, tuer });
  const limite = Date.now() + graceMs;
  while (Date.now() < limite) {
    await attendre(200);
    if (!encore()) return { parti: true, force: false };
  }
  envoyerSignal(pid, 'SIGKILL', { cible, raison: `${raison ? `${raison} ; ` : ''}toujours là ${Math.round(graceMs / 1000)} s après SIGTERM`, journal, role, tuer });
  for (let i = 0; i < 10; i++) {
    await attendre(200);
    if (!encore()) return { parti: true, force: true };
  }
  return { parti: false, force: true };
}

/** Uid réel d'un processus (/proc/<pid>/status), ou null. */
function uidDe(pid) {
  try {
    return Number(/^Uid:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1]);
  } catch {
    return null;
  }
}

/**
 * Processus VISIBLES d'ici appartenant au compte : [{ pid, rssMo, commande }]. (Ceux d'un autre espace de pid
 * n'y sont pas : la liste est un minimum.)
 */
export function processusDuCompte({ uid = process.getuid?.() ?? null, racineProc = '/proc' } = {}) {
  let noms = [];
  try {
    noms = readdirSync(racineProc).filter(n => /^\d+$/.test(n));
  } catch {
    return [];
  }
  const liste = [];
  for (const n of noms) {
    const pid = Number(n);
    if (uid !== null && uidDe(pid) !== uid) continue;
    const args = ligneDeCommande(pid);
    if (!args.length) continue;
    liste.push({ pid, rssMo: memoireProcessus(pid)?.rssMo ?? 0, args });
  }
  return liste;
}

/** Moteurs d'IA locale VISIBLES lancés avec NOTRE fichier de clé : [{ pid, rssMo, args }]. */
export function moteursVisibles(fichierCle, processus = processusDuCompte()) {
  return processus.filter(p => {
    const i = p.args.indexOf('--api-key-file');
    return i >= 0 && p.args[i + 1] === fichierCle;
  });
}

/** Commande courte et sans donnée sensible (chemins réduits au nom du programme) pour un affichage. */
export function commandeCourte(args) {
  const nom = a => String(a).split('/').pop();
  const prog = nom(args[0] ?? '?');
  if (prog === 'nice' && args.length > 2) return commandeCourte(args.slice(args[1] === '-n' ? 3 : 1));
  if (/^node/.test(prog)) {
    const script = args.slice(1).find(a => /\.m?js$/.test(a));
    return script ? `node ${nom(script)}` : 'node';
  }
  return prog;
}

/**
 * Limites mémoire lisibles d'ici (cgroup v1/v2, ulimit) : { cgroup: [...], limiteOctets, espaceAdresse, processusMax }.
 * Sur CloudLinux, la limite LVE n'est en général PAS lisible depuis le compte : cPanel › Resource Usage la montre.
 */
export function limitesMemoire() {
  const lire = f => {
    try {
      return readFileSync(f, 'utf8').trim();
    } catch {
      return null;
    }
  };
  const cgroup = (lire('/proc/self/cgroup') ?? '').split('\n').filter(Boolean);
  let limiteOctets = null;
  for (const f of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) {
    const v = lire(f);
    if (v && /^\d+$/.test(v) && Number(v) < 2 ** 60) {
      limiteOctets = Number(v);
      break;
    }
  }
  const limites = lire('/proc/self/limits') ?? '';
  const ligne = nom => /^\S.*?\s{2,}(\S+)\s+(\S+)/.exec(limites.split('\n').find(l => l.startsWith(nom)) ?? '')?.[1] ?? null;
  return { cgroup, limiteOctets, espaceAdresse: ligne('Max address space'), processusMax: ligne('Max processes') };
}

/**
 * Le moteur qui écoutait sur 127.0.0.1:`port` répond-il encore, et est-ce le NÔTRE ? (Par le réseau local :
 * marche même s'il est dans un autre espace de pid.) Rend 'absent' (connexion refusée), 'notre' (notre clé est
 * acceptée, ou il charge encore), 'etranger' (il refuse notre clé : un autre programme a repris le port) ou
 * 'inconnu' (sans clé, ou réponse illisible : prudence).
 */
export function sonderMoteur(port, cle, { delaiMs = 2000 } = {}) {
  const demander = (chemin, methode, corps, entetes = {}) =>
    new Promise(ok => {
      const req = http.request({ host: '127.0.0.1', port, path: chemin, method: methode, agent: false, headers: { ...entetes, ...(corps ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corps) } : {}) }, timeout: delaiMs }, res => {
        res.resume();
        ok({ statut: res.statusCode ?? 0 });
      });
      req.on('timeout', () => req.destroy(Object.assign(new Error('délai'), { code: 'DELAI' })));
      req.on('error', e => ok({ erreur: e?.code ?? 'erreur' }));
      req.end(corps ?? undefined);
    });
  return (async () => {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return 'absent';
    const s = await demander('/health', 'GET');
    if (s.erreur === 'ECONNREFUSED') return 'absent';
    if (s.erreur) return 'inconnu';
    if (!cle) return 'inconnu';
    const t = await demander('/tokenize', 'POST', '{"content":"a"}', { Authorization: `Bearer ${cle}` });
    if (t.statut === 401 || t.statut === 403) return 'etranger';
    if (t.erreur === 'ECONNREFUSED') return 'absent';
    return 'notre';
  })();
}

/** Fin du journal (au plus `octets`), découpée en lignes ; [] s'il est illisible. */
export function finDuJournal(journal, octets = 256 * 1024) {
  try {
    const t = readFileSync(journal);
    return t.subarray(Math.max(0, t.length - octets)).toString('utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Lignes « signal … envoyé à pid <pid> » du journal (par n'importe lequel de nos programmes), écrites depuis
 * `depuis` (ISO) : la preuve qu'un de NOS programmes a visé ce processus. Vide : ce n'est pas nous.
 */
export function signauxEnvoyesA(journal, pid, depuis = null) {
  const motif = new RegExp(`signal SIG[A-Z0-9]+ envoyé à pid ${pid} `);
  return finDuJournal(journal, 4 * 1024 * 1024).filter(l => motif.test(l) && (!depuis || l.slice(0, 24) >= depuis));
}

/** Dernières lignes écrites par les moteurs dans le journal (celles qui ne sont pas de nos programmes). */
export function dernieresLignesMoteur(journal, n = 12) {
  return finDuJournal(journal)
    .filter(l => !/^\d{4}-\d\d-\d\dT[\d:.]+Z \[esport\] /.test(l))
    .slice(-n);
}
