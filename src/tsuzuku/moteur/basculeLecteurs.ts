/**
 * Bascule automatique entre les lecteurs d'un épisode : logique PURE (pas de
 * React, pas de réseau), partagée par le web, le PC (Electron) et le mobile.
 *
 * - Ordre : les lecteurs qui ont le mieux marché sur cette SOURCE passent en
 *   premier (fiabilité gardée par hôte vidéo) ; à égalité, l'ordre du site.
 * - Contrôleur : un lecteur qui échoue (erreur, silence trop long, adresse
 *   invalide, page d'erreur) laisse la place au suivant NON ENCORE essayé ;
 *   quand tous ont échoué, on le dit (bouton « Réessayer »). Un choix manuel
 *   repart de ce lecteur et la bascule continue avec les autres.
 * - Surveillance : minuteur « sans signe de vie » d'un lecteur affiché.
 */

import type { Lecteur } from './resolution';

/** Délai sans signe de vie avant d'abandonner : iframe (page de l'hôte), vidéo directe (métadonnées). */
export const DELAI_IFRAME_MS = 9000;
export const DELAI_VIDEO_MS = 12000;

/** Résultats mémorisés d'un lecteur : réussites et échecs, et dernière date (ms). */
export interface FiabiliteLecteur {
  ok: number;
  ko: number;
  a: number;
}
/** Par source, puis par clé de lecteur (voir `cleLecteur`). */
export type FiabiliteSources = Record<string, Record<string, FiabiliteLecteur>>;

/** Lecteurs mémorisés au plus par source ; sources mémorisées au plus. */
export const LECTEURS_PAR_SOURCE_MAX = 20;
export const SOURCES_MAX = 40;
/** Au-delà de ce cumul, les compteurs sont divisés par deux (un hôte qui s'est dégradé reprend vite sa place). */
const PLAFOND = 12;

const hoteDe = (url: string): string | undefined => {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i.exec(url.trim());
  return m ? m[1].toLowerCase() : undefined;
};

/** Identité d'un lecteur pour la mémoire : l'hôte vidéo (stable), sinon son nom. */
export function cleLecteur(l: Pick<Lecteur, 'label' | 'url'>): string {
  return hoteDe(l.url) ?? (l.label.trim().toLowerCase() || l.url);
}

/** Nom affiché d'un lecteur. */
export const nomLecteur = (l: Pick<Lecteur, 'label'> | undefined, i: number): string => (l?.label?.trim() ? l.label.trim() : `Lecteur ${i + 1}`);

/** Vrai si l'adresse peut se charger : http(s) avec un hôte. */
export function urlLecteurValide(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  const u = url.trim();
  if (!/^https?:\/\/[^\s/?#]+/i.test(u) || /\s/.test(u)) return false;
  try {
    const p = new URL(u);
    return Boolean(p.hostname) && (p.protocol === 'http:' || p.protocol === 'https:');
  } catch {
    return false;
  }
}

/** Texte d'une page d'erreur d'hôte (404, vidéo supprimée, refus d'intégration…). */
const PAGE_ERREUR = /\b(404|403|410|500|502|503)\b.{0,40}(not found|forbidden|gone|error|unavailable)|not found|video (is )?(unavailable|removed|deleted|not found)|has been (removed|deleted)|file (was )?(deleted|removed|not found)|refused to connect|ce contenu n.?est (plus )?disponible|vid[ée]o (introuvable|supprim[ée]e|indisponible)|page introuvable|erreur de chargement/i;

/** Vrai si le TEXTE d'un document d'iframe lisible ressemble à une page d'erreur (ou est vide). */
export function pageErreurDetectee(texte: string | null | undefined, avecMedia = false): boolean {
  const t = (texte ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return !avecMedia;
  return t.length < 400 && PAGE_ERREUR.test(t);
}

/** Score d'un lecteur : part de réussites, lissée (un lecteur inconnu vaut 0,5). */
export function scoreFiabilite(f: Pick<FiabiliteLecteur, 'ok' | 'ko'> | undefined): number {
  return ((f?.ok ?? 0) + 1) / ((f?.ok ?? 0) + (f?.ko ?? 0) + 2);
}

/** Les lecteurs rangés du plus fiable au moins fiable pour cette source ; l'ordre du site départage. */
export function ordonnerParFiabilite<T extends Pick<Lecteur, 'label' | 'url'>>(lecteurs: readonly T[], fiab: Record<string, FiabiliteLecteur> | undefined): T[] {
  if (!fiab) return [...lecteurs];
  return lecteurs
    .map((l, i) => ({ l, i, s: scoreFiabilite(fiab[cleLecteur(l)]) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map(x => x.l);
}

/** Note un résultat pour un lecteur d'une source (copie ; bornée, les plus anciens partent d'abord). */
export function noterResultat(tout: FiabiliteSources, source: string, lecteur: Pick<Lecteur, 'label' | 'url'>, reussi: boolean, maintenant = Date.now()): FiabiliteSources {
  const suite: FiabiliteSources = { ...tout };
  const pour = { ...(suite[source] ?? {}) };
  const cle = cleLecteur(lecteur);
  const avant = pour[cle] ?? { ok: 0, ko: 0, a: 0 };
  let ok = avant.ok + (reussi ? 1 : 0);
  let ko = avant.ko + (reussi ? 0 : 1);
  if (ok + ko > PLAFOND) {
    ok = Math.round(ok / 2);
    ko = Math.round(ko / 2);
  }
  delete pour[cle];
  pour[cle] = { ok, ko, a: maintenant };
  const cles = Object.keys(pour);
  for (const k of cles.slice(0, Math.max(0, cles.length - LECTEURS_PAR_SOURCE_MAX))) delete pour[k];
  delete suite[source];
  suite[source] = pour;
  const sources = Object.keys(suite);
  for (const k of sources.slice(0, Math.max(0, sources.length - SOURCES_MAX))) delete suite[k];
  return suite;
}

/** Lecture défensive de ce qui a été gardé (jamais d'exception, formes inattendues ignorées). */
export function fiabiliteValide(brut: unknown): FiabiliteSources {
  const sortie: FiabiliteSources = {};
  if (!brut || typeof brut !== 'object') return sortie;
  for (const [source, lecteurs] of Object.entries(brut as Record<string, unknown>)) {
    if (!lecteurs || typeof lecteurs !== 'object') continue;
    const pour: Record<string, FiabiliteLecteur> = {};
    for (const [cle, v] of Object.entries(lecteurs as Record<string, unknown>)) {
      const f = v as Partial<FiabiliteLecteur> | null;
      if (f && Number.isFinite(f.ok) && Number.isFinite(f.ko) && (f.ok as number) >= 0 && (f.ko as number) >= 0) pour[cle] = { ok: f.ok as number, ko: f.ko as number, a: Number.isFinite(f.a) ? (f.a as number) : 0 };
    }
    if (Object.keys(pour).length) sortie[source] = pour;
  }
  return sortie;
}

/** Ce que le contrôleur décide après un échec. */
export type Decision = { type: 'suivant'; de: number; vers: number } | { type: 'tous' } | { type: 'ignore' };

export interface Controleur {
  /** Lecteur affiché (indice dans la liste). */
  courant(): number;
  /** Le lecteur affiché a échoué. Un échec d'un lecteur qui n'est plus affiché est ignoré. */
  echec(indice: number): Decision;
  /** Choix de l'utilisateur : ce lecteur, puis la bascule reprend avec les non essayés. */
  choisir(indice: number): void;
  /** Tous les lecteurs ont échoué (en attente d'un « Réessayer »). */
  tousEchoues(): boolean;
  /** Repart du premier lecteur. */
  reessayer(): void;
}

/** Contrôleur de bascule pour `n` lecteurs, qui démarre sur `depart`. */
export function creerControleur(n: number, depart = 0): Controleur {
  let courant = Math.min(Math.max(0, depart), Math.max(0, n - 1));
  let essayes = new Set<number>([courant]);
  let tous = false;
  return {
    courant: () => courant,
    tousEchoues: () => tous,
    choisir(i) {
      if (i < 0 || i >= n) return;
      courant = i;
      essayes = new Set([i]);
      tous = false;
    },
    reessayer() {
      courant = 0;
      essayes = new Set([0]);
      tous = false;
    },
    echec(i) {
      if (tous || i !== courant || n === 0) return { type: 'ignore' };
      // Prochain non essayé : d'abord après le courant, puis depuis le début.
      for (let k = 1; k <= n; k++) {
        const j = (i + k) % n;
        if (!essayes.has(j)) {
          essayes.add(j);
          courant = j;
          return { type: 'suivant', de: i, vers: j };
        }
      }
      tous = true;
      return { type: 'tous' };
    },
  };
}

/** Message discret affiché lors d'une bascule. */
export const messageBascule = (de: string, vers: string) => `${de} indisponible, passage à ${vers}`;
export const MESSAGE_TOUS_ECHOUES = 'Aucun lecteur ne répond pour cet épisode.';

export interface Surveillance {
  /** Signe de vie reçu (chargement, lecture) : arrête le minuteur. */
  vivant(): void;
  /** Échec constaté (erreur, page d'erreur…). Un seul échec est signalé. */
  echec(raison: string): void;
  /** Arrête tout (démontage). */
  arreter(): void;
}

/**
 * Surveille un lecteur affiché : sans signe de vie avant `delaiMs`, c'est un
 * échec. `onEchec` n'est appelé qu'une fois, et jamais après `vivant` ou `arreter`.
 */
export function surveiller(delaiMs: number, onEchec: (raison: string) => void): Surveillance {
  let fini = false;
  let minuteur: ReturnType<typeof setTimeout> | undefined;
  const arreter = () => {
    fini = true;
    if (minuteur) clearTimeout(minuteur);
  };
  const fin = (raison: string) => {
    if (fini) return;
    arreter();
    onEchec(raison);
  };
  minuteur = setTimeout(() => fin('délai dépassé'), delaiMs);
  return { vivant: arreter, echec: fin, arreter };
}

/** Ce que `sonderHote` utilise de `fetch` (injectable pour les tests). */
export type FetchSonde = (url: string, init: { method: string; mode: 'no-cors'; cache: 'no-store'; credentials: 'omit'; referrerPolicy: 'no-referrer'; signal?: unknown }) => Promise<unknown>;

/**
 * L'hôte du lecteur répond-il ? Une requête HEAD « no-cors » (sans cookie ni
 * référent) ne peut pas lire la réponse, mais ÉCHOUE quand l'hôte est injoignable
 * (DNS, connexion refusée, TLS) : le cadre affiche alors une page d'erreur du
 * navigateur, illisible depuis l'app et qui compte comme « chargée ». Vrai quand
 * le navigateur ne sait pas sonder (pas de `fetch`) : on ne conclut jamais à tort.
 */
export async function sonderHote(url: string, o: { fetch?: FetchSonde; delaiMs?: number } = {}): Promise<boolean> {
  const f = o.fetch ?? (typeof fetch === 'function' ? (fetch as unknown as FetchSonde) : undefined);
  if (!f || !urlLecteurValide(url)) return true;
  const Controleur = typeof AbortController === 'function' ? AbortController : undefined;
  const arret = Controleur ? new Controleur() : undefined;
  const minuteur = arret ? setTimeout(() => arret.abort(), o.delaiMs ?? DELAI_IFRAME_MS) : undefined;
  try {
    await f(url, { method: 'HEAD', mode: 'no-cors', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: arret?.signal });
    return true;
  } catch (erreur) {
    // Sonde interrompue par NOTRE délai : lenteur, pas panne (le minuteur du lecteur tranchera).
    return Boolean(arret?.signal.aborted) && (erreur as { name?: string } | undefined)?.name === 'AbortError';
  } finally {
    if (minuteur) clearTimeout(minuteur);
  }
}
