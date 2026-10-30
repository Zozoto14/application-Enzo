/**
 * État des mises à jour (« déploiement ») vu depuis le serveur Esport o2switch, pour la pastille
 * « Mise à jour en cours… » du hub et la page Paramètres › Administration › Mises à jour (Fondateur).
 * Mode d'emploi : docs/mises-a-jour.md.
 *
 * Le serveur ne fait que LIRE (aucune commande lancée, jamais) :
 *  - sa propre version : le commit du dépôt cloné au démarrage de l'app (Passenger la redémarre à chaque
 *    déploiement du code) ;
 *  - la version du site : public_html/version.json (écrit par le build, servi sans cache) ;
 *  - l'état tenu par esport/serveur/deployer.sh dans ~/.appdashboard (code-deploye, site-deploye,
 *    derniere-verification, deployer-demande) et les 10 dernières lignes utiles de son journal
 *    (~/logs/esport-deploy.log), filtrées : lignes datées seulement, rien qui ressemble à un secret ;
 *  - GitHub, par l'API publique SANS jeton (dépôt public) : dernier commit de main et dernière exécution du
 *    workflow « Site (o2switch) ». Cache de 2 minutes, délai court (4 s), requêtes conditionnelles (ETag :
 *    un 304 ne compte pas dans la limite de 60 requêtes/heure), et, si la limite est atteinte, on garde la
 *    dernière réponse connue jusqu'à l'heure de remise à zéro annoncée par GitHub.
 *
 * « Vérifier maintenant » ne lance RIEN : il dépose le fichier-drapeau ~/.appdashboard/deployer-demande, que
 * deployer.sh (cron) consomme à son prochain passage (moins d'une minute en général, voir son mode « guet »).
 */

import { existsSync, readFileSync, statSync, writeFileSync, openSync, readSync, closeSync, fstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEPOT_GITHUB = 'Zozoto14/application-Enzo';
export const WORKFLOW_SITE = 'site-o2switch.yml';
export const CACHE_GITHUB_MS = 2 * 60_000;
export const DELAI_GITHUB_MS = 4000;
/** Durée habituelle du workflow « Site (o2switch) » (tests, build, push) : sert à l'estimation « ≈ X min ». */
export const DUREE_WORKFLOW_MIN = 6;
/** Au-delà, un build réussi toujours pas publié signale un déploiement bloqué (cron arrêté, échec de deployer.sh). */
export const BLOQUE_APRES_MIN = 30;
export const LIGNES_JOURNAL = 10;
const FIN_JOURNAL_OCTETS = 64 * 1024;

const RACINE_DEPOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));

// ---------------------------------------------------------------- Lectures de fichiers (tolérantes)

const lire = chemin => {
  try {
    return readFileSync(chemin, 'utf8');
  } catch {
    return undefined;
  }
};
const mtime = chemin => {
  try {
    return statSync(chemin).mtimeMs;
  } catch {
    return undefined;
  }
};
const iso = ms => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const SHA = /^[0-9a-f]{7,40}$/;

/** Commit courant d'un dépôt git, lu dans .git (HEAD, refs, packed-refs) sans lancer git. */
export function lireCommitGit(dossier) {
  const tete = lire(join(dossier, '.git', 'HEAD'))?.trim();
  if (!tete) return null;
  if (SHA.test(tete)) return tete;
  const ref = /^ref: (refs\/\S+)$/.exec(tete)?.[1];
  if (!ref) return null;
  const direct = lire(join(dossier, '.git', ref))?.trim();
  if (direct && SHA.test(direct)) return direct;
  for (const ligne of (lire(join(dossier, '.git', 'packed-refs')) ?? '').split('\n')) {
    const [sha, nom] = ligne.trim().split(' ');
    if (nom === ref && SHA.test(sha ?? '')) return sha;
  }
  return null;
}

/** version.json du site : { id, commit, date } (les builds d'avant n'ont que `id` = « <commit court>-<date base 36> »). */
export function lireVersionSite(texte) {
  try {
    const v = JSON.parse(texte);
    if (!v || typeof v.id !== 'string') return null;
    const [court, base36] = v.id.split('-');
    const commit = typeof v.commit === 'string' && SHA.test(v.commit) ? v.commit : SHA.test(court ?? '') ? court : null;
    const dateId = base36 ? parseInt(base36, 36) : NaN;
    const date = typeof v.date === 'string' && Number.isFinite(Date.parse(v.date)) ? v.date : Number.isFinite(dateId) && dateId > 1e12 ? new Date(dateId).toISOString() : null;
    return { id: v.id, commit, date };
  } catch {
    return null;
  }
}

/** Deux commits identiques (l'un peut être abrégé). */
export function memeCommit(a, b) {
  if (!a || !b || a.length < 7 || b.length < 7) return false;
  return a.startsWith(b) || b.startsWith(a);
}

// ---------------------------------------------------------------- Journal de déploiement

const MOTIFS_SECRETS = [
  [/(https?:\/\/)[^\s/@]+@/gi, '$1***@'],
  [/\b(postgres(?:ql)?|mysql|redis):\/\/\S+/gi, '$1://***'],
  [/\bx-access-token:\S+/gi, 'x-access-token:***'],
  [/\b(gh[pousr]_|github_pat_)[A-Za-z0-9_]{10,}/g, '$1***'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ***'],
  [/\b([A-Z0-9_]*(?:CLE|KEY|TOKEN|SECRET|PASS|PASSWORD|DATABASE_URL|JETON)[A-Z0-9_]*)\s*[=:]\s*\S+/g, '$1=***'],
  [/\b(mot de passe|password|passwd|token|jeton|secret|cl[ée])\s*[=:]\s*\S+/gi, '$1=***'],
  // Longues suites aléatoires (clés en base 64 ou hexadécimales qui ne sont pas des commits de 40 caractères).
  [/\b(?![0-9a-f]{40}\b)[A-Za-z0-9+/_-]{48,}={0,2}/g, '***'],
];

/** Masque ce qui ressemble à un secret dans une ligne du journal. */
export function masquerSecrets(ligne) {
  let l = String(ligne);
  for (const [motif, remplacement] of MOTIFS_SECRETS) l = l.replace(motif, remplacement);
  return l;
}

const LIGNE_DATEE = /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) (.+)$/;
const LIGNE_DEPLOIEMENT = /site : public_html à jour|serveurs Esport et relais redémarrés/;

/**
 * Lignes utiles du journal : seulement celles écrites par deployer.sh (datées), jamais la sortie brute de npm ou
 * des migrations ; secrets masqués, longueur bornée. Rend { lignes (n dernières), derniere, dernierDeploiement }.
 */
export function filtrerJournal(texte, n = LIGNES_JOURNAL) {
  const datees = [];
  for (const brute of String(texte ?? '').split(/\r?\n/)) {
    const m = LIGNE_DATEE.exec(brute.trimEnd());
    if (m) datees.push({ date: m[1], texte: masquerSecrets(m[2]).slice(0, 240) });
  }
  const deploiements = datees.filter(l => LIGNE_DEPLOIEMENT.test(l.texte));
  return {
    lignes: datees.slice(-n),
    derniere: datees.at(-1) ?? null,
    dernierDeploiement: deploiements.at(-1)?.date ?? null,
    echec: datees.at(-1)?.texte.startsWith('ÉCHEC') ? datees.at(-1) : null,
  };
}

/** Fin du fichier (64 Kio) : le journal grossit sans fin, on n'en lit que la queue. */
function lireFin(chemin, octets = FIN_JOURNAL_OCTETS) {
  let fd;
  try {
    fd = openSync(chemin, 'r');
    const taille = fstatSync(fd).size;
    const debut = Math.max(0, taille - octets);
    const tampon = Buffer.alloc(taille - debut);
    readSync(fd, tampon, 0, tampon.length, debut);
    const texte = tampon.toString('utf8');
    return debut > 0 ? texte.slice(texte.indexOf('\n') + 1) : texte;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// ---------------------------------------------------------------- GitHub (API publique, sans jeton)

/** Exécution de workflow GitHub → résumé. `statut` : en-cours | reussi | echec | annule. */
export function resumerExecution(run) {
  if (!run || typeof run !== 'object') return null;
  const statut =
    run.status !== 'completed' ? 'en-cours' : run.conclusion === 'success' ? 'reussi' : run.conclusion === 'cancelled' || run.conclusion === 'skipped' ? 'annule' : 'echec';
  return {
    statut,
    sha: typeof run.head_sha === 'string' ? run.head_sha : null,
    message: typeof run.head_commit?.message === 'string' ? run.head_commit.message.split('\n')[0].slice(0, 120) : null,
    debut: run.run_started_at ?? run.created_at ?? null,
    fin: run.status === 'completed' ? (run.updated_at ?? null) : null,
    numero: Number.isFinite(run.run_number) ? run.run_number : null,
    url: typeof run.html_url === 'string' && run.html_url.startsWith('https://github.com/') ? run.html_url : null,
  };
}

/** La plus récente exécution qui compte (une exécution annulée par une plus récente ne compte pas). */
export function executionPertinente(runs) {
  const liste = Array.isArray(runs) ? runs.map(resumerExecution).filter(Boolean) : [];
  return liste.find(r => r.statut !== 'annule') ?? liste[0] ?? null;
}

/**
 * Client GitHub en cache. `fetch` injectable (tests) ; jamais de jeton. Ne lève jamais : en cas d'erreur, la
 * dernière réponse connue est rendue avec `erreur` (« limite » : quota de l'API publique atteint ; « injoignable » ;
 * « reponse » : réponse inattendue).
 */
export function creerSuiviGithub({ depot = DEPOT_GITHUB, workflow = WORKFLOW_SITE, fetch = globalThis.fetch, maintenant = Date.now, cacheMs = CACHE_GITHUB_MS, delaiMs = DELAI_GITHUB_MS } = {}) {
  const base = `https://api.github.com/repos/${depot}`;
  const etags = new Map();
  const corps = new Map();
  let donnees = { main: null, workflow: null, majLe: null, erreur: null };
  let expire = 0;
  let bloqueJusqua = 0;
  let enCours;

  async function obtenir(chemin) {
    const entetes = { Accept: 'application/vnd.github+json', 'User-Agent': 'appdashboard-esport', 'X-GitHub-Api-Version': '2022-11-28' };
    if (etags.has(chemin)) entetes['If-None-Match'] = etags.get(chemin);
    let r;
    try {
      r = await fetch(`${base}${chemin}`, { headers: entetes, signal: AbortSignal.timeout(delaiMs) });
    } catch {
      throw Object.assign(new Error('injoignable'), { code: 'injoignable' });
    }
    if (r.status === 304 && corps.has(chemin)) return corps.get(chemin);
    if ((r.status === 403 || r.status === 429) && (r.headers.get('x-ratelimit-remaining') === '0' || r.status === 429 || r.headers.get('retry-after'))) {
      const reset = Number(r.headers.get('x-ratelimit-reset')) * 1000;
      const apres = Number(r.headers.get('retry-after')) * 1000;
      bloqueJusqua = Number.isFinite(reset) && reset > maintenant() ? reset : maintenant() + (Number.isFinite(apres) && apres > 0 ? apres : 15 * 60_000);
      throw Object.assign(new Error('limite'), { code: 'limite' });
    }
    if (!r.ok) throw Object.assign(new Error('reponse'), { code: 'reponse' });
    let json;
    try {
      json = await r.json();
    } catch {
      throw Object.assign(new Error('reponse'), { code: 'reponse' });
    }
    const etag = r.headers.get('etag');
    if (etag) etags.set(chemin, etag);
    corps.set(chemin, json);
    return json;
  }

  async function rafraichir() {
    try {
      const [commit, runs] = await Promise.all([obtenir('/commits/main'), obtenir(`/actions/workflows/${workflow}/runs?branch=main&per_page=5`)]);
      donnees = {
        main:
          commit && typeof commit.sha === 'string'
            ? { sha: commit.sha, message: String(commit.commit?.message ?? '').split('\n')[0].slice(0, 120), date: commit.commit?.committer?.date ?? commit.commit?.author?.date ?? null }
            : null,
        workflow: executionPertinente(runs?.workflow_runs),
        majLe: iso(maintenant()),
        erreur: null,
      };
    } catch (e) {
      donnees = { ...donnees, erreur: e?.code ?? 'injoignable' };
    }
    expire = maintenant() + cacheMs;
  }

  return {
    /** État GitHub (au plus une interrogation par période de cache ; rien pendant une limite de l'API). */
    async etat() {
      const t = maintenant();
      if (t < bloqueJusqua) return { ...donnees, erreur: 'limite', reessaiLe: iso(bloqueJusqua) };
      if (t >= expire) {
        enCours ??= rafraichir().finally(() => (enCours = undefined));
        await enCours;
      }
      return maintenant() < bloqueJusqua ? { ...donnees, erreur: 'limite', reessaiLe: iso(bloqueJusqua) } : { ...donnees };
    },
  };
}

// ---------------------------------------------------------------- Synthèse

/**
 * État global, pour la pastille :
 *  - « a-jour »   : le site publié vient du dernier build réussi ;
 *  - « en-cours » : build en cours sur GitHub, ou build réussi pas encore copié dans public_html (≈ X min) ;
 *  - « echec »    : le dernier build a échoué (tests en échec, etc.) : la mise à jour n'a pas pu être publiée ;
 *  - « bloque »   : build réussi depuis plus de 30 min mais site toujours ancien (cron arrêté, deployer.sh en échec) ;
 *  - « inconnu »  : GitHub injoignable et aucune réponse connue.
 */
export function syntheseEtat({ site, workflow, maintenant, derniereVerification, echecDeploiement }) {
  if (!workflow) return { etat: 'inconnu', estimationMin: null };
  const t = maintenant;
  const ecoule = d => (d ? (t - Date.parse(d)) / 60_000 : 0);
  if (workflow.statut === 'en-cours') {
    return { etat: 'en-cours', phase: 'build', estimationMin: Math.max(1, Math.ceil(DUREE_WORKFLOW_MIN - ecoule(workflow.debut))) + 1 };
  }
  if (workflow.statut === 'echec') return { etat: 'echec', estimationMin: null };
  if (workflow.statut === 'annule') return { etat: 'inconnu', estimationMin: null };
  if (memeCommit(site?.commit, workflow.sha)) return { etat: 'a-jour', estimationMin: null };
  if (ecoule(workflow.fin) > BLOQUE_APRES_MIN || echecDeploiement) return { etat: 'bloque', estimationMin: null };
  // Build prêt : deployer.sh le copie à sa prochaine vérification (≈ 1 min en mode guet, 5 min sinon).
  const guetActif = derniereVerification && t - derniereVerification < 3 * 60_000;
  return { etat: 'en-cours', phase: 'publication', estimationMin: guetActif ? 1 : 5 };
}

/**
 * Service branché sur l'API (`deploiement` de creerApi). Chemins par défaut : ceux de deployer.sh chez o2switch.
 * Rend { etat(), demanderVerification() }.
 */
export function creerServiceDeploiement({
  home = homedir(),
  etatDir = process.env.DEPLOIEMENT_ETAT || join(home, '.appdashboard'),
  journal = process.env.DEPLOIEMENT_JOURNAL || join(home, 'logs', 'esport-deploy.log'),
  site = process.env.DEPLOIEMENT_SITE || join(home, 'public_html'),
  depot = process.env.DEPLOIEMENT_DEPOT || RACINE_DEPOT,
  github,
  maintenant = Date.now,
} = {}) {
  const suivi = github ?? creerSuiviGithub({ depot: process.env.GITHUB_DEPOT || DEPOT_GITHUB, maintenant });
  // Version du serveur : celle du code chargé au démarrage (Passenger redémarre l'app à chaque déploiement).
  const serveur = { commit: lireCommitGit(depot), demarreLe: iso(maintenant()) };
  const drapeau = join(etatDir, 'deployer-demande');

  return {
    async etat() {
      const versionSite = lireVersionSite(lire(join(site, 'version.json')) ?? '');
      const codeDeploye = lire(join(etatDir, 'code-deploye'))?.trim() || null;
      const verif = Number(lire(join(etatDir, 'derniere-verification'))?.trim()) * 1000;
      const derniereVerification = Number.isFinite(verif) && verif > 0 ? verif : null;
      const j = filtrerJournal(lireFin(journal) ?? '');
      const gh = await suivi.etat();
      const t = maintenant();
      const synthese = syntheseEtat({ site: versionSite, workflow: gh.workflow, maintenant: t, derniereVerification, echecDeploiement: Boolean(j.echec) });
      const demande = existsSync(drapeau);
      return {
        ...synthese,
        site: versionSite,
        serveur: { ...serveur, redemarrageEnAttente: Boolean(codeDeploye && serveur.commit && !memeCommit(codeDeploye, serveur.commit)) },
        relais: { commit: codeDeploye, redemarreLe: iso(mtime(join(depot, 'relais', 'tmp', 'restart.txt'))) },
        deploiement: {
          codeDeploye,
          dernierDeploiement: j.dernierDeploiement,
          derniereVerification: iso(derniereVerification),
          derniereLigne: j.derniere,
          echec: j.echec,
          journal: j.lignes,
          demandeEnAttente: demande,
          demandeLe: demande ? iso(mtime(drapeau)) : null,
        },
        github: gh,
        heure: iso(t),
      };
    },

    /** Dépose le drapeau lu par deployer.sh (aucune commande n'est lancée d'ici). */
    async demanderVerification() {
      try {
        writeFileSync(drapeau, `${iso(maintenant())}\n`, { mode: 0o600 });
      } catch {
        return { demande: false };
      }
      return { demande: true, demandeLe: iso(maintenant()) };
    },
  };
}
