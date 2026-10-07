/**
 * Historique de Claude Office : journal local des requêtes faites à Claude Code.
 *
 * Le hook de Claude Code (`scripts/office-historique-hook.mjs`) appelle
 * `enregistrerEvenement` à chaque demande, outil, début/fin de session : la
 * ligne est écrite DIRECTEMENT dans un fichier JSONL du dossier personnel,
 * sans passer par aucun serveur — Claude Office et AppDashboard peuvent être
 * fermés, rien ne se perd tant que Claude Code tourne.
 *
 *  - un fichier par mois : `<dossier>/AAAA-MM.jsonl`, puis `AAAA-MM.2.jsonl`…
 *    au-delà de `maxFichierMo` (rotation) ; les plus anciens fichiers sont
 *    effacés au-delà de `maxTotalMo` (taille bornée) ;
 *  - chaque ligne part en UN SEUL appel `write` sur un fichier ouvert en ajout
 *    (`O_APPEND`) : deux sessions de Claude Code qui écrivent en même temps ne
 *    s'entremêlent pas ; une ligne coupée par un crash est ignorée à la
 *    lecture, et la suivante est récupérée (chaque entrée commence par
 *    `{"v":1,"id":"`) ;
 *  - dossier en 0700, fichiers en 0600 (sous Windows, le profil utilisateur
 *    est déjà réservé à son titulaire) ;
 *  - secrets masqués avant écriture (clés d'API, jetons, mots de passe repérés
 *    par motifs) ; les sorties d'outils ne sont PAS enregistrées par défaut
 *    (seulement un résumé court : nom de l'outil, fichier, début de commande).
 *
 * Dossier : `OFFICE_HISTORIQUE_DIR` s'il est défini, sinon
 * `~/.agent-office/historique` (aucun chemin en dur ; `homedir()` donne
 * `C:\Users\<nom>` sous Windows). Réglages : `<dossier>/reglages.json`.
 *
 * Aucune dépendance à Electron ni au réseau : utilisé par le hook, par le
 * processus principal (lecture, suppression, import) et par les tests.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import {
  closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync,
  writeFileSync, writeSync, chmodSync,
} from 'node:fs';
import { homedir, hostname } from 'node:os';
import { basename, join } from 'node:path';

export const VERSION_ENTREE = 1;
/** Début fixe de chaque ligne : sert à retrouver une entrée collée derrière une ligne tronquée. */
export const DEBUT_ENTREE = `{"v":${VERSION_ENTREE},"id":"`;

export const REGLAGES_DEFAUT = Object.freeze({
  /** Le hook enregistre-t-il ? (faux : il ne fait rien). */
  actif: true,
  /** Enregistrer le contenu des entrées/sorties d'outils (tronqué) ; faux par défaut : un résumé court seulement. */
  enregistrerSorties: false,
  /** Masquer les secrets repérés avant écriture. */
  masquerSecrets: true,
  /** Taille d'un fichier avant de passer au suivant. */
  maxFichierMo: 10,
  /** Taille totale du journal : au-delà, les plus anciens fichiers sont effacés. */
  maxTotalMo: 200,
});

/** Bornes de chaque champ (caractères). */
export const LIMITES = Object.freeze({ texte: 20_000, resume: 300, contenu: 2_000, entree: 64 * 1024 });

/** Événements enregistrés par le hook d'historique (Claude Code). */
export const EVENEMENTS_HISTORIQUE = ['UserPromptSubmit', 'PostToolUse', 'SessionStart', 'SessionEnd', 'Stop', 'SubagentStop'];

export const TYPES = {
  UserPromptSubmit: 'demande',
  BeforeAgent: 'demande',
  PostToolUse: 'outil',
  AfterTool: 'outil',
  SessionStart: 'debut-session',
  SessionEnd: 'fin-session',
  Stop: 'fin-reponse',
  AfterAgent: 'fin-reponse',
  SubagentStop: 'fin-sous-agent',
};

// ----------------------------------------------------------------- chemins

export function dossierHistorique(env = process.env, maison = homedir()) {
  return env.OFFICE_HISTORIQUE_DIR ? String(env.OFFICE_HISTORIQUE_DIR) : join(maison, '.agent-office', 'historique');
}

/** Un fichier de journal : `AAAA-MM.jsonl` ou `AAAA-MM.<n>.jsonl` (rotation), et rien d'autre. */
export const MOTIF_FICHIER = /^(\d{4})-(\d{2})(?:\.(\d{1,4}))?\.jsonl$/;
/** Un fichier réécrit après une suppression : `AAAA-MM.r<horodatage>.jsonl`. */
export const MOTIF_REECRIT = /^(\d{4})-(\d{2})\.r[0-9a-z-]{1,40}\.jsonl$/;
export const estFichierJournal = nom => MOTIF_FICHIER.test(nom) || MOTIF_REECRIT.test(nom);

const mois = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

function creerDossier(dossier) {
  mkdirSync(dossier, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dossier, 0o700);
  } catch {
    // Système sans droits POSIX (Windows) : le profil utilisateur protège déjà le dossier.
  }
}

// ---------------------------------------------------------------- réglages

const borne = (n, min, max, defaut) => (Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : defaut);

/** Réglages valides, quoi qu'il y ait dans le fichier (valeurs inconnues ignorées). */
export function normaliserReglages(brut) {
  const o = brut && typeof brut === 'object' && !Array.isArray(brut) ? brut : {};
  const d = REGLAGES_DEFAUT;
  const nom = typeof o.appareil === 'string' ? o.appareil.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40) : '';
  return {
    actif: typeof o.actif === 'boolean' ? o.actif : d.actif,
    enregistrerSorties: typeof o.enregistrerSorties === 'boolean' ? o.enregistrerSorties : d.enregistrerSorties,
    masquerSecrets: typeof o.masquerSecrets === 'boolean' ? o.masquerSecrets : d.masquerSecrets,
    maxFichierMo: borne(o.maxFichierMo, 1, 100, d.maxFichierMo),
    maxTotalMo: borne(o.maxTotalMo, 10, 5000, d.maxTotalMo),
    appareil: nom || undefined,
    appareilId: typeof o.appareilId === 'string' && /^[0-9a-f]{12}$/.test(o.appareilId) ? o.appareilId : undefined,
  };
}

/**
 * Réglages du journal, créés au premier passage avec un identifiant d'appareil
 * (création exclusive : le hook et l'application ne s'écrasent pas).
 */
export function lireReglages(dossier) {
  const fichier = join(dossier, 'reglages.json');
  let brut;
  try {
    brut = JSON.parse(readFileSync(fichier, 'utf8'));
  } catch {
    brut = undefined;
  }
  const reglages = normaliserReglages(brut);
  if (!reglages.appareilId) {
    reglages.appareilId = randomBytes(6).toString('hex');
    try {
      creerDossier(dossier);
      writeFileSync(fichier, `${JSON.stringify({ ...(brut ?? {}), appareilId: reglages.appareilId }, null, 2)}\n`, { flag: brut ? 'w' : 'wx', mode: 0o600 });
    } catch {
      // Créé au même moment par un autre processus : on relit le sien.
      try {
        const autre = normaliserReglages(JSON.parse(readFileSync(fichier, 'utf8')));
        if (autre.appareilId) reglages.appareilId = autre.appareilId;
      } catch {
        // Illisible : l'identifiant reste celui tiré ici, pour cette fois.
      }
    }
  }
  return reglages;
}

/** Change des réglages (validés), écriture atomique. Rend les réglages obtenus. */
export function ecrireReglages(dossier, changements) {
  const actuels = lireReglages(dossier);
  const propres = normaliserReglages({ ...actuels, ...changements, appareilId: actuels.appareilId });
  creerDossier(dossier);
  const fichier = join(dossier, 'reglages.json');
  const provisoire = `${fichier}.${process.pid}.nouveau`;
  writeFileSync(provisoire, `${JSON.stringify(propres, null, 2)}\n`, { mode: 0o600 });
  renameSync(provisoire, fichier);
  return propres;
}

export const nomAppareil = reglages => reglages.appareil || hostname() || 'Appareil';

// ---------------------------------------------------------------- secrets

const MASQUE = '[secret masqué]';
const MASQUE_PROVISOIRE = '\u0001M\u0001';

/** Motifs de secrets courants. Un faux positif masque un peu trop, jamais l'inverse. */
export const MOTIFS_SECRETS = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
  /\bsk-ant-[A-Za-z0-9_-]{8,}/g,
  /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{20,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bglpat-[A-Za-z0-9_-]{16,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  // Jeton de profil du relais et code de liaison AppDashboard (ils portent un jeton).
  /\bp1\.[a-z0-9]{6,16}\.[0-9a-f]{64}\b/g,
  /\bAB1\.[A-Za-z0-9_-]{16,}/g,
];

/** `Authorization: Bearer xxx`, `TOKEN=xxx`, `"apiKey": "xxx"`, `--password xxx`, `https://u:mdp@hote`. */
const CLES_SECRETES = String.raw`[A-Za-z0-9_.-]*(?:pass(?:word|wd)?|mot[_-]?de[_-]?passe|mdp|secret|token|jeton|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|auth)[A-Za-z0-9_.-]*`;
const MOTIFS_ASSIGNATION = [
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{12,}/gi, (_m, type) => `${type} ${MASQUE_PROVISOIRE}`],
  [/(:\/\/[^\s:/@]+:)[^\s@/]+@/g, (_m, debut) => `${debut}${MASQUE_PROVISOIRE}@`],
  [new RegExp(String.raw`(["']?${CLES_SECRETES}["']?\s*[=:]\s*)(["']?)([^\s"',;}]{4,})\2`, 'gi'), (_m, debut, g) => `${debut}${g}${MASQUE_PROVISOIRE}${g}`],
  [new RegExp(String.raw`(--${CLES_SECRETES}\s+)(["']?)([^\s"']{4,})\2`, 'gi'), (_m, debut, g) => `${debut}${g}${MASQUE_PROVISOIRE}${g}`],
];

export function masquerSecrets(texte) {
  if (typeof texte !== 'string' || texte === '') return texte;
  let sortie = texte;
  // Repère provisoire sans mot-clé : un masque déjà posé n'est pas repris par les motifs suivants.
  for (const motif of MOTIFS_SECRETS) sortie = sortie.replace(motif, MASQUE_PROVISOIRE);
  for (const [motif, remplacer] of MOTIFS_ASSIGNATION) sortie = sortie.replace(motif, remplacer);
  return sortie.split(MASQUE_PROVISOIRE).join(MASQUE);
}

// ---------------------------------------------------------------- entrées

const enTexte = v => (v === undefined || v === null ? undefined : typeof v === 'string' ? v : JSON.stringify(v));

function couper(texte, n) {
  if (texte === undefined) return undefined;
  return texte.length > n ? `${texte.slice(0, n)}… [+${texte.length - n} caractères]` : texte;
}

const nomFichier = p => basename(String(p ?? '').split('\\').join('/'));

/** Résumé court d'un appel d'outil : jamais la sortie, seulement ce qui a été visé. */
export function resumerOutil(outil, entree) {
  const e = entree && typeof entree === 'object' ? entree : {};
  const t = String(outil ?? '').toLowerCase();
  const fichier = nomFichier(e.file_path ?? e.path ?? e.absolute_path ?? e.notebook_path);
  let resume;
  if (/^(read|read_file|write|write_file|edit|multiedit|replace|notebookedit)$/.test(t)) resume = fichier;
  else if (/^(bash|run_shell_command|powershell)$/.test(t)) resume = e.description ? `${e.description} — ${e.command ?? ''}` : e.command;
  else if (/^(grep|grep_search|search_file_content)$/.test(t)) resume = `« ${e.pattern ?? ''} »${e.path ? ` dans ${nomFichier(e.path)}` : ''}`;
  else if (/^(glob|list_directory)$/.test(t)) resume = e.pattern ?? e.dir_path;
  else if (/^(webfetch|web_fetch)$/.test(t)) resume = e.url;
  else if (/^(websearch|google_web_search)$/.test(t)) resume = e.query;
  else if (t === 'agent' || t === 'task') resume = e.description ?? e.subagent_type;
  else if (t === 'skill') resume = e.skill ? `/${e.skill}` : undefined;
  else if (t === 'todowrite') resume = Array.isArray(e.todos) ? `${e.todos.length} tâche(s)` : undefined;
  return resume === undefined || resume === '' ? undefined : String(resume).replace(/\s+/g, ' ').trim();
}

/**
 * Entrée du journal à partir de la charge d'un hook (JSON reçu sur stdin).
 * Rend `undefined` pour un événement qu'on n'enregistre pas.
 */
export function construireEntree(charge, { reglages, source = 'claude', maintenant = new Date(), id = randomUUID() } = {}) {
  const d = charge && typeof charge === 'object' ? charge : {};
  const r = reglages ?? normaliserReglages({});
  const type = TYPES[d.hook_event_name];
  if (!type) return undefined;
  const propre = texte => (texte === undefined ? undefined : r.masquerSecrets ? masquerSecrets(texte) : texte);
  const entree = {
    v: VERSION_ENTREE,
    id,
    ts: maintenant.toISOString(),
    type,
    source,
    appareil: nomAppareil(r),
    appareilId: r.appareilId,
    session: typeof d.session_id === 'string' ? d.session_id.slice(0, 100) : undefined,
    dossier: typeof d.cwd === 'string' ? d.cwd.slice(0, 500) : undefined,
    projet: typeof d.cwd === 'string' ? nomFichier(d.cwd) || undefined : undefined,
  };
  if (type === 'demande') {
    entree.texte = couper(propre(enTexte(d.prompt)), LIMITES.texte);
  } else if (type === 'outil') {
    entree.outil = String(d.tool_name ?? '').slice(0, 100) || undefined;
    entree.resume = couper(propre(resumerOutil(d.tool_name, d.tool_input)), LIMITES.resume);
    const reponse = d.tool_response;
    if (reponse && typeof reponse === 'object' && (reponse.is_error === true || reponse.success === false || reponse.interrupted === true)) {
      entree.echec = true;
    }
    if (r.enregistrerSorties) {
      entree.entree = couper(propre(enTexte(d.tool_input)), LIMITES.contenu);
      entree.sortie = couper(propre(enTexte(reponse)), LIMITES.contenu);
    }
  } else if (type === 'debut-session' || type === 'fin-session') {
    const raison = d.source ?? d.reason;
    entree.resume = typeof raison === 'string' ? raison.slice(0, 60) : undefined;
  } else {
    // Fin de réponse : le texte de la réponse seulement si on enregistre les sorties.
    const message = d.last_assistant_message ?? d.prompt_response;
    if (r.enregistrerSorties && message !== undefined) entree.sortie = couper(propre(enTexte(message)), LIMITES.contenu);
  }
  for (const cle of Object.keys(entree)) if (entree[cle] === undefined) delete entree[cle];
  return entree;
}

// ---------------------------------------------------------------- écriture

const octetsMo = mo => mo * 1024 * 1024;

function tailleDe(fichier) {
  try {
    return statSync(fichier).size;
  } catch {
    return 0;
  }
}

/** Fichiers du journal (pas les importés), du plus ancien au plus récent. */
export function fichiersJournal(dossier) {
  let noms;
  try {
    noms = readdirSync(dossier);
  } catch {
    return [];
  }
  const cle = nom => {
    const m = MOTIF_FICHIER.exec(nom) ?? MOTIF_REECRIT.exec(nom);
    const partie = MOTIF_FICHIER.exec(nom)?.[3];
    return `${m[1]}-${m[2]}|${MOTIF_REECRIT.test(nom) ? '0' : '1'}|${String(partie ?? 1).padStart(4, '0')}`;
  };
  return noms.filter(estFichierJournal).sort((a, b) => (cle(a) < cle(b) ? -1 : cle(a) > cle(b) ? 1 : 0));
}

/** Fichier où écrire ce mois-ci : le dernier de la série tant qu'il est sous la limite, sinon le suivant. */
export function fichierCourant(dossier, reglages, maintenant = new Date()) {
  const m = mois(maintenant);
  let partie = 1;
  for (const nom of fichiersJournal(dossier)) {
    const t = MOTIF_FICHIER.exec(nom);
    if (t && `${t[1]}-${t[2]}` === m) partie = Math.max(partie, Number(t[3] ?? 1));
  }
  const nom = n => (n === 1 ? `${m}.jsonl` : `${m}.${n}.jsonl`);
  while (tailleDe(join(dossier, nom(partie))) >= octetsMo(reglages.maxFichierMo)) partie++;
  return join(dossier, nom(partie));
}

/** Efface les plus anciens fichiers tant que le journal dépasse `maxTotalMo` (jamais le fichier courant). */
export function borner(dossier, reglages, courant) {
  const noms = fichiersJournal(dossier);
  let total = noms.reduce((s, n) => s + tailleDe(join(dossier, n)), 0);
  const effaces = [];
  for (const nom of noms) {
    if (total <= octetsMo(reglages.maxTotalMo)) break;
    const chemin = join(dossier, nom);
    if (chemin === courant) continue;
    total -= tailleDe(chemin);
    rmSync(chemin, { force: true });
    effaces.push(nom);
  }
  return effaces;
}

/**
 * Ajoute une entrée : une seule écriture, en ajout, droits 0600. Tolère tout :
 * les erreurs remontent à l'appelant (le hook les avale pour ne jamais gêner
 * Claude Code).
 */
export function ajouterEntree(dossier, entree, { reglages = lireReglages(dossier), maintenant = new Date() } = {}) {
  creerDossier(dossier);
  let ligne = JSON.stringify(entree);
  if (ligne.length > LIMITES.entree) {
    // Garde-fou : jamais une ligne démesurée (les champs sont déjà bornés).
    const reduit = { ...entree, texte: couper(entree.texte, 4000), entree: undefined, sortie: undefined, tronque: true };
    ligne = JSON.stringify(reduit);
  }
  const fichier = fichierCourant(dossier, reglages, maintenant);
  const nouveau = !existsSync(fichier);
  const fd = openSync(fichier, 'a', 0o600);
  try {
    writeSync(fd, Buffer.from(`${ligne}\n`, 'utf8'));
  } finally {
    closeSync(fd);
  }
  if (nouveau) {
    try {
      chmodSync(fichier, 0o600);
    } catch {
      // Windows.
    }
    borner(dossier, reglages, fichier);
  }
  return fichier;
}

/** Ce que fait le hook : réglages, entrée, écriture. Rend l'entrée écrite (ou rien). */
export function enregistrerEvenement(charge, { env = process.env, maison = homedir(), source = 'claude', maintenant = new Date() } = {}) {
  const dossier = dossierHistorique(env, maison);
  const reglages = lireReglages(dossier);
  if (!reglages.actif) return undefined;
  const entree = construireEntree(charge, { reglages, source, maintenant });
  if (!entree) return undefined;
  ajouterEntree(dossier, entree, { reglages, maintenant });
  return entree;
}

// ---------------------------------------------------------------- lecture

/** Entrée lue valide ? (forme minimale ; le reste est affiché tel quel, en texte). */
export function entreeValide(e) {
  return (
    e && typeof e === 'object' && !Array.isArray(e) &&
    e.v === VERSION_ENTREE && typeof e.id === 'string' && e.id.length > 0 && e.id.length <= 100 &&
    typeof e.ts === 'string' && !Number.isNaN(Date.parse(e.ts)) && typeof e.type === 'string'
  );
}

/**
 * Lignes d'un morceau de journal. Une ligne illisible (tronquée par un crash,
 * ou collée à la suivante) est ignorée, mais une entrée qui commence au milieu
 * est récupérée. Rend les entrées et le nombre de morceaux ignorés.
 */
export function analyserLignes(texte) {
  const entrees = [];
  let ignorees = 0;
  for (const ligne of texte.split('\n')) {
    if (!ligne.trim()) continue;
    const morceaux = ligne.split(DEBUT_ENTREE);
    if (morceaux[0].trim()) ignorees++;
    for (const reste of morceaux.slice(1)) {
      try {
        const e = JSON.parse(DEBUT_ENTREE + reste);
        if (entreeValide(e)) entrees.push(e);
        else ignorees++;
      } catch {
        ignorees++;
      }
    }
  }
  return { entrees, ignorees };
}

function lireDepuis(chemin, debut) {
  const fd = openSync(chemin, 'r');
  try {
    const taille = fstatSync(fd).size;
    if (taille <= debut) return { texte: '', taille };
    const tampon = Buffer.alloc(taille - debut);
    let lus = 0;
    while (lus < tampon.length) {
      const n = readSync(fd, tampon, lus, tampon.length - lus, debut + lus);
      if (n === 0) break;
      lus += n;
    }
    return { texte: tampon.subarray(0, lus).toString('utf8'), taille: debut + lus };
  } finally {
    closeSync(fd);
  }
}

/**
 * Lecteur incrémental : relit seulement ce qui a été ajouté depuis la lecture
 * précédente (une ligne pas encore finie attend la suivante) ; un fichier qui
 * a rétréci (réécrit après suppression) est relu en entier, un fichier effacé
 * est oublié. Idempotent : relire après une coupure ne crée aucun doublon.
 */
export function creerLecteur(dossier) {
  const caches = new Map();
  return {
    lire() {
      const vus = new Set();
      const sources = [
        ...fichiersJournal(dossier).map(nom => ({ cle: nom, chemin: join(dossier, nom), importe: false })),
        ...fichiersImportes(dossier).map(nom => ({ cle: `importes/${nom}`, chemin: join(dossier, 'importes', nom), importe: true })),
      ];
      let ignorees = 0;
      let octets = 0;
      for (const { cle, chemin, importe } of sources) {
        vus.add(cle);
        let cache = caches.get(cle);
        let taille;
        try {
          taille = statSync(chemin).size;
        } catch {
          continue;
        }
        if (!cache || taille < cache.position) {
          cache = { position: 0, entrees: [], ignorees: 0 };
          caches.set(cle, cache);
        }
        if (taille > cache.position) {
          const { texte } = lireDepuis(chemin, cache.position);
          const fin = texte.lastIndexOf('\n');
          if (fin >= 0) {
            const complet = texte.slice(0, fin + 1);
            const lu = analyserLignes(complet);
            cache.entrees.push(...lu.entrees.map(e => (importe ? { ...e, importe: true } : e)));
            cache.ignorees += lu.ignorees;
            cache.position += Buffer.byteLength(complet, 'utf8');
          }
        }
        ignorees += cache.ignorees;
        octets += taille;
      }
      for (const cle of caches.keys()) if (!vus.has(cle)) caches.delete(cle);
      const parId = new Map();
      for (const cache of caches.values()) for (const e of cache.entrees) if (!parId.has(e.id)) parId.set(e.id, e);
      const entrees = [...parId.values()].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
      return { entrees, ignorees, octets, fichiers: sources.length };
    },
  };
}

/** Tout le journal, d'un coup (déduplication par identifiant). */
export const lireJournal = dossier => creerLecteur(dossier).lire();

// ---------------------------------------------------------------- import

const MOTIF_IMPORTE = /^[a-z0-9][a-z0-9._-]{0,80}\.jsonl$/;
export function fichiersImportes(dossier) {
  try {
    return readdirSync(join(dossier, 'importes')).filter(n => MOTIF_IMPORTE.test(n)).sort();
  } catch {
    return [];
  }
}

/**
 * Importe le journal d'un autre appareil (fichier JSONL copié de là-bas) :
 * seules les entrées valides sont recopiées, réécrites ligne à ligne, dans
 * `<dossier>/importes/`. Le nom de destination est fabriqué ici.
 */
export function importerJournal(dossier, texte, { origine = 'import', maintenant = new Date() } = {}) {
  const { entrees, ignorees } = analyserLignes(String(texte ?? ''));
  if (entrees.length === 0) return { importees: 0, ignorees, fichier: null };
  const cible = join(dossier, 'importes');
  creerDossier(cible);
  const base = String(origine).toLowerCase().replace(/\.jsonl$/, '').replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 40) || 'import';
  const nom = `${base}-${maintenant.toISOString().replace(/[:.]/g, '-').toLowerCase()}.jsonl`;
  const chemin = join(cible, nom);
  const provisoire = `${chemin}.nouveau`;
  writeFileSync(provisoire, entrees.map(e => `${JSON.stringify({ ...e, importe: undefined })}\n`).join(''), { mode: 0o600 });
  renameSync(provisoire, chemin);
  return { importees: entrees.length, ignorees, fichier: nom };
}

// ---------------------------------------------------------------- suppression

/**
 * Critère de suppression, validé : `{ ids: [...] }`, `{ du, au }` (dates ISO,
 * bornes incluses) ou `{ tout: true }`. Rend un prédicat, ou lève.
 */
export function critereSuppression(critere) {
  const c = critere && typeof critere === 'object' ? critere : {};
  if (c.tout === true) return { predicat: () => true, description: 'tout l’historique' };
  if (Array.isArray(c.ids)) {
    const ids = new Set(c.ids.filter(id => typeof id === 'string' && id.length <= 100).slice(0, 10_000));
    if (ids.size === 0) throw new Error('Aucune entrée à supprimer.');
    return { predicat: e => ids.has(e.id), description: `${ids.size} entrée${ids.size > 1 ? 's' : ''}` };
  }
  const du = typeof c.du === 'string' ? Date.parse(c.du) : NaN;
  const au = typeof c.au === 'string' ? Date.parse(c.au) : NaN;
  if (!Number.isNaN(du) && !Number.isNaN(au) && du <= au) {
    return {
      predicat: e => Date.parse(e.ts) >= du && Date.parse(e.ts) <= au,
      description: `les entrées du ${new Date(du).toLocaleString('fr-FR')} au ${new Date(au).toLocaleString('fr-FR')}`,
    };
  }
  throw new Error('Critère de suppression invalide.');
}

/** Combien d'entrées un critère toucherait (pour la confirmation). */
export function compterSuppression(dossier, critere) {
  const { predicat, description } = critereSuppression(critere);
  return { nombre: lireJournal(dossier).entrees.filter(predicat).length, description };
}

/**
 * Supprime pour de bon les entrées visées : chaque fichier concerné est mis de
 * côté par renommage (les écritures suivantes du hook partent dans un fichier
 * neuf), filtré, réécrit sous un nouveau nom, puis l'ancien est effacé.
 * `{ tout: true }` efface aussi les fichiers importés.
 */
export function supprimerEntrees(dossier, critere, { maintenant = new Date() } = {}) {
  const { predicat } = critereSuppression(critere);
  let supprimees = 0;
  const sources = [
    ...fichiersJournal(dossier).map(nom => ({ dossier, nom })),
    ...fichiersImportes(dossier).map(nom => ({ dossier: join(dossier, 'importes'), nom })),
  ];
  const marque = maintenant.toISOString().replace(/[:.]/g, '-').toLowerCase();
  for (const [i, { dossier: ici, nom }] of sources.entries()) {
    const chemin = join(ici, nom);
    let texte;
    try {
      texte = readFileSync(chemin, 'utf8');
    } catch {
      continue;
    }
    const { entrees } = analyserLignes(texte);
    const touchees = entrees.filter(predicat).length;
    if (touchees === 0) continue;
    const decote = `${chemin}.suppression`;
    renameSync(chemin, decote);
    // Relu après le renommage : une ligne ajoutée entre-temps n'est pas perdue.
    const { entrees: toutes } = analyserLignes(readFileSync(decote, 'utf8'));
    const restantes = toutes.filter(e => !predicat(e));
    supprimees += toutes.length - restantes.length;
    if (restantes.length > 0) {
      const m = MOTIF_FICHIER.exec(nom) ?? MOTIF_REECRIT.exec(nom);
      const nouveau = m && ici === dossier ? `${m[1]}-${m[2]}.r${marque}-${i}.jsonl` : nom;
      const provisoire = join(ici, `${nouveau}.nouveau`);
      writeFileSync(provisoire, restantes.map(e => `${JSON.stringify(e)}\n`).join(''), { mode: 0o600 });
      renameSync(provisoire, join(ici, nouveau));
    }
    rmSync(decote, { force: true });
  }
  return { supprimees };
}
