/**
 * Lien GitHub d'une tâche (V3) — FACULTATIF, désactivé par défaut.
 *
 * Une tâche peut pointer vers un dépôt, une branche ou une pull request
 * (`tache.github`). Le Fondateur saisit un jeton personnel en LECTURE seule
 * (jeton « fine-grained » : Contents, Pull requests, Checks en lecture),
 * rangé dans la base chiffrée de son appareil (`taches.secrets`) : jamais
 * dans le dépôt, jamais synchronisé, jamais envoyé à un membre.
 *
 * L'état (PR ouverte, fusionnée, fermée ; CI réussie, en échec, en cours)
 * est lu par l'API REST de GitHub — par l'application du PC (processus
 * principal), ou directement par le navigateur sur le site (l'API GitHub
 * accepte ces appels : CORS). Il est gardé sur l'appareil (`taches.github`) :
 * le lire n'écrit rien sur le relais. Option « marquer Faite quand la PR est
 * fusionnée » : la tâche passe au statut terminé (une écriture, une fois).
 */

import { terminerTache } from './recurrence';
import { ErreurTaches, estTerminee, lireLienGithub, tachesVivantes, type Contexte, type DonneesTaches, type LienGithub } from './modele';

export interface EtatGithub {
  /** « depot » : lien vers un dépôt ou une branche sans PR trouvée. */
  etat: 'ouverte' | 'brouillon' | 'fusionnee' | 'fermee' | 'depot' | 'introuvable';
  titre?: string;
  numero?: number;
  url: string;
  ci?: 'succes' | 'echec' | 'en-cours' | 'aucune';
  lu: string;
}

export const LIBELLES_ETAT_GITHUB: Record<EtatGithub['etat'], string> = {
  ouverte: 'PR ouverte',
  brouillon: 'PR en brouillon',
  fusionnee: 'PR fusionnée',
  fermee: 'PR fermée',
  depot: 'Dépôt',
  introuvable: 'Introuvable',
};
export const LIBELLES_CI: Record<NonNullable<EtatGithub['ci']>, string> = { succes: 'CI réussie', echec: 'CI en échec', 'en-cours': 'CI en cours', aucune: 'Pas de CI' };

/**
 * Lit un lien saisi : « proprio/depot », « proprio/depot#12 »,
 * « proprio/depot@branche », ou une adresse github.com (dépôt, PR, branche).
 */
export function lireLienSaisi(texte: string): LienGithub | undefined {
  const t = texte.trim().replace(/\/+$/, '');
  let m = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+)(?:\/pull\/(\d+)|\/tree\/([^\s?#]+))?/i.exec(t);
  if (m) return lireLienGithub({ depot: `${m[1]}/${m[2].replace(/\.git$/, '')}`, ...(m[3] ? { pr: Number(m[3]) } : {}), ...(m[4] ? { branche: decodeURIComponent(m[4]) } : {}) });
  m = /^([A-Za-z0-9-]+\/[A-Za-z0-9._-]+)(?:#(\d+)|@(\S+))?$/.exec(t);
  if (m) return lireLienGithub({ depot: m[1], ...(m[2] ? { pr: Number(m[2]) } : {}), ...(m[3] ? { branche: m[3] } : {}) });
  return undefined;
}

export const texteLien = (l: LienGithub): string => `${l.depot}${l.pr ? `#${l.pr}` : l.branche ? `@${l.branche}` : ''}`;
export const urlLien = (l: LienGithub): string => `https://github.com/${l.depot}${l.pr ? `/pull/${l.pr}` : l.branche ? `/tree/${encodeURIComponent(l.branche)}` : ''}`;

/** Accès en lecture à l'API GitHub (chemin commençant par « /repos/ »). */
export interface ClientGithub {
  lire(chemin: string, jeton: string): Promise<{ statut: number; json: unknown }>;
}

/** Chemins permis (lecture d'un dépôt, de ses PR, des vérifications d'un commit). */
export const CHEMIN_PERMIS = /^\/repos\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+(?:\/pulls(?:\/\d+)?|\/commits\/[0-9a-f]{7,40}\/check-runs)?(?:\?[A-Za-z0-9=&:%._/-]*)?$/;

const dict = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

async function etatCi(client: ClientGithub, depot: string, sha: string, jeton: string): Promise<EtatGithub['ci']> {
  if (!/^[0-9a-f]{7,40}$/.test(sha)) return undefined;
  const r = await client.lire(`/repos/${depot}/commits/${sha}/check-runs?per_page=50`, jeton);
  if (r.statut !== 200) return undefined;
  const runs = (Array.isArray(dict(r.json).check_runs) ? (dict(r.json).check_runs as unknown[]) : []).map(dict);
  if (!runs.length) return 'aucune';
  if (runs.some(x => x.status !== 'completed')) return 'en-cours';
  if (runs.some(x => ['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure'].includes(String(x.conclusion)))) return 'echec';
  return 'succes';
}

function depuisPR(pr: Record<string, unknown>, lu: string): EtatGithub {
  const etat: EtatGithub['etat'] = pr.merged === true || typeof pr.merged_at === 'string' ? 'fusionnee' : pr.state === 'closed' ? 'fermee' : pr.draft === true ? 'brouillon' : 'ouverte';
  return { etat, ...(typeof pr.title === 'string' ? { titre: pr.title.slice(0, 200) } : {}), ...(Number.isInteger(pr.number) ? { numero: pr.number as number } : {}), url: typeof pr.html_url === 'string' && pr.html_url.startsWith('https://github.com/') ? pr.html_url : '', lu };
}

/** État d'un lien : la PR (numéro, ou la plus récente de la branche), puis sa CI. */
export async function lireEtat(client: ClientGithub, lien: LienGithub, jeton: string, maintenant: number): Promise<EtatGithub> {
  const lu = new Date(maintenant).toISOString();
  const [proprio] = lien.depot.split('/');
  let pr: Record<string, unknown> | undefined;
  if (lien.pr) {
    const r = await client.lire(`/repos/${lien.depot}/pulls/${lien.pr}`, jeton);
    if (r.statut === 404) return { etat: 'introuvable', url: urlLien(lien), lu };
    if (r.statut === 401 || r.statut === 403) throw new ErreurTaches('GitHub refuse le jeton (droits de lecture manquants, ou jeton expiré).');
    if (r.statut !== 200) throw new ErreurTaches(`GitHub a répondu ${r.statut}.`);
    pr = dict(r.json);
  } else if (lien.branche) {
    const r = await client.lire(`/repos/${lien.depot}/pulls?state=all&per_page=1&head=${encodeURIComponent(`${proprio}:${lien.branche}`)}`, jeton);
    if (r.statut === 401 || r.statut === 403) throw new ErreurTaches('GitHub refuse le jeton (droits de lecture manquants, ou jeton expiré).');
    if (r.statut === 200 && Array.isArray(r.json) && r.json.length) pr = dict(r.json[0]);
  }
  if (!pr) {
    const r = await client.lire(`/repos/${lien.depot}`, jeton);
    if (r.statut === 401 || r.statut === 403) throw new ErreurTaches('GitHub refuse le jeton (droits de lecture manquants, ou jeton expiré).');
    return { etat: r.statut === 200 ? 'depot' : 'introuvable', url: urlLien(lien), lu };
  }
  const e = depuisPR(pr, lu);
  const sha = String(dict(pr.head).sha ?? '');
  const ci = e.etat === 'fermee' ? undefined : await etatCi(client, lien.depot, sha, jeton).catch(() => undefined);
  return { ...e, url: e.url || urlLien(lien), ...(ci ? { ci } : {}) };
}

export type CacheGithub = Record<string, EtatGithub>;
export function lireCache(brut: string | null | undefined): CacheGithub {
  try {
    const o = brut ? (JSON.parse(brut) as CacheGithub) : {};
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

/** Une passe : l'état de chaque tâche liée ouverte (et des fermées récemment liées), au plus toutes les 5 min. */
export async function rafraichir(d: DonneesTaches, cache: CacheGithub, client: ClientGithub, jeton: string, maintenant: number, delaiMs = 5 * 60_000): Promise<{ cache: CacheGithub; erreurs: string[]; lus: number }> {
  const r: CacheGithub = {};
  const erreurs: string[] = [];
  let lus = 0;
  for (const t of tachesVivantes(d)) {
    if (!t.github) continue;
    const avant = cache[t.id];
    const memeLien = avant && avant.url === urlLien(t.github) ? avant : avant && avant.numero === t.github.pr ? avant : undefined;
    if (memeLien && maintenant - Date.parse(memeLien.lu) < delaiMs) {
      r[t.id] = memeLien;
      continue;
    }
    if (estTerminee(d, t) && memeLien) {
      r[t.id] = memeLien;
      continue;
    }
    try {
      r[t.id] = await lireEtat(client, t.github, jeton, maintenant);
      lus++;
    } catch (e) {
      erreurs.push(e instanceof Error ? e.message : String(e));
      if (avant) r[t.id] = avant;
      if (erreurs.length >= 3) break;
    }
  }
  return { cache: r, erreurs: [...new Set(erreurs)], lus };
}

/** « Faite quand la PR est fusionnée » : termine les tâches concernées (une fois). */
export function appliquerFusions(d: DonneesTaches, cache: CacheGithub, ctx: Contexte, aujourdhui: string): { donnees: DonneesTaches; terminees: string[] } {
  let x = d;
  const terminees: string[] = [];
  for (const t of tachesVivantes(d)) {
    if (!t.github?.faiteSiFusion || estTerminee(x, t) || cache[t.id]?.etat !== 'fusionnee') continue;
    x = terminerTache(x, t.id, ctx, aujourdhui).donnees;
    terminees.push(t.id);
  }
  return { donnees: x, terminees };
}

// ------------------------------------------------------------------ Clients

interface PontGithub {
  github?(requete: { chemin: string; jeton: string }): Promise<{ statut: number; json?: unknown; erreur?: string }>;
}
const pont = (): PontGithub | undefined => (globalThis as { applibourse?: { taches?: PontGithub } }).applibourse?.taches;

/** Client réel : l'application du PC (processus principal), sinon le navigateur (l'API GitHub accepte les appels du site). */
export const clientGithub: ClientGithub = {
  async lire(chemin, jeton) {
    if (!CHEMIN_PERMIS.test(chemin)) throw new ErreurTaches('Adresse GitHub refusée.');
    const p = pont();
    if (p?.github) {
      const r = await p.github({ chemin, jeton });
      if (r.erreur) throw new ErreurTaches(r.erreur);
      return { statut: r.statut, json: r.json };
    }
    const f = (globalThis as { fetch?: typeof fetch }).fetch;
    if (!f) throw new ErreurTaches('Pas d’accès au réseau ici.');
    const rep = await f(`https://api.github.com${chemin}`, { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${jeton}`, 'X-GitHub-Api-Version': '2022-11-28' }, credentials: 'omit' });
    return { statut: rep.status, json: rep.status === 204 ? undefined : await rep.json().catch(() => undefined) };
  },
};

/** Client d'essai : une PR fusionnée si le numéro est pair, ouverte avec une CI en cours sinon (rien n'est envoyé). */
export const clientGithubSimule: ClientGithub = {
  async lire(chemin) {
    const pr = /\/pulls\/(\d+)$/.exec(chemin);
    if (pr) {
      const n = Number(pr[1]);
      return { statut: 200, json: { number: n, title: `PR simulée n° ${n}`, state: n % 2 ? 'open' : 'closed', merged: n % 2 === 0, draft: false, html_url: `https://github.com${chemin.replace('/repos', '').replace('/pulls/', '/pull/')}`, head: { sha: 'abcdef1234567' } } };
    }
    if (/check-runs/.test(chemin)) return { statut: 200, json: { check_runs: [{ status: 'in_progress' }] } };
    if (/\/pulls\?/.test(chemin)) return { statut: 200, json: [] };
    return { statut: 200, json: { full_name: chemin.slice(7) } };
  },
};
