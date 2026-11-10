/**
 * Liens colles a la main par l'utilisateur, memorises dans SA bibliotheque :
 *
 * - animes : un motif d'adresse `{n}` (« .../x-episode-{n} »), ou la page
 *   d'une serie dont on extrait les liens d'episodes, avec des corrections
 *   episode par episode ;
 * - films : une adresse unique.
 *
 * Fonctions pures : elles renvoient un nouvel etat. Le mapping par titre
 * (`associerParTitre`) rattache les episodes d'une page de serie a ceux du
 * catalogue quand leur numerotation differe.
 */

import { echec } from './erreurs';
import { analyserUrlHttp, classerMedia, type TypeMedia } from './garde';
import { adresseEnTexte } from './adresse';
import { instantDe, normaliserTexte, type Horloge, horlogeSysteme, estObjet } from './outils';

export const MARQUEUR = '{n}';
export const EPISODES_MAX = 5000;
const MOT_CLE_AVANT = /(?:^|[^a-z])(?:episode|episodes|épisode|ep|eps|e)[-_/ .=]*$/i;

export interface MotifEpisodes {
  pattern: string;
  padding: number;
  offset: number;
  detectedNumber: number;
  keyword: boolean;
}

const urlPropre = (brut: unknown): string => adresseEnTexte(analyserUrlHttp(brut));

/**
 * Deduit un motif depuis l'adresse d'un episode :
 * « .../one-piece-episode-5/ » -> « .../one-piece-episode-{n}/ ».
 * `episode` est le numero regarde : on prefere le nombre egal, puis celui
 * precede de « episode », puis le dernier du chemin. L'ecart eventuel
 * (numerotation decalee) est conserve dans `offset`.
 */
export function deduireMotif(adresse: string, episode: number | null = null): MotifEpisodes | null {
  const a = analyserUrlHttp(adresse);
  const queue = `${a.chemin}${a.requete}`;
  const suites: { texte: string; valeur: number; index: number; motCle: boolean }[] = [];
  const re = /\d{1,4}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(queue))) {
    // Un nombre colle a d'autres chiffres (x264) n'est pas un numero d'episode.
    const avant = queue[m.index - 1] || '/';
    const apres = queue[m.index + m[0].length] || '/';
    if (/[0-9]/.test(avant) || /[0-9]/.test(apres)) {
      continue;
    }
    suites.push({
      texte: m[0],
      valeur: Number(m[0]),
      index: m.index,
      motCle: MOT_CLE_AVANT.test(queue.slice(Math.max(0, m.index - 12), m.index)),
    });
  }
  if (!suites.length) {
    return null;
  }
  const voulu = Number.isInteger(Number(episode)) && Number(episode) > 0 ? Number(episode) : null;
  const preferer = (l: typeof suites) => l.find(r => r.motCle) || l[l.length - 1];
  let choisi: (typeof suites)[number] | null = null;
  if (voulu != null) {
    const egaux = suites.filter(r => r.valeur === voulu);
    if (egaux.length) {
      choisi = preferer(egaux);
    }
  }
  if (!choisi) {
    const debutDernier = a.chemin.replace(/\/+$/, '').lastIndexOf('/');
    const dansLeDernier = suites.filter(r => r.index > debutDernier);
    choisi = preferer(dansLeDernier.length ? dansLeDernier : suites);
  }
  const padding = choisi.texte.length > 1 && choisi.texte.startsWith('0') ? choisi.texte.length : 0;
  const origine = `${a.schema}://${a.hote}${a.port ? `:${a.port}` : ''}`;
  return {
    pattern: `${origine}${queue.slice(0, choisi.index)}${MARQUEUR}${queue.slice(choisi.index + choisi.texte.length)}`,
    padding,
    offset: voulu != null ? choisi.valeur - voulu : 0,
    detectedNumber: choisi.valeur,
    keyword: choisi.motCle,
  };
}

/** Adresse d'un episode depuis un motif `{n}`. */
export function remplirMotif(motif: string, n: number, o: { padding?: number; offset?: number } = {}): string | null {
  const numero = Number(n) + Number(o.offset || 0);
  if (!Number.isInteger(numero) || numero < 0) {
    return null;
  }
  const texte = o.padding ? String(numero).padStart(o.padding, '0') : String(numero);
  return String(motif).split(MARQUEUR).join(texte);
}

export interface LienEpisode {
  number: number;
  url: string;
}

export interface AssociationMotif {
  type: 'pattern';
  pattern: string;
  padding: number;
  offset: number;
  overrides: Record<string, string>;
  label: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssociationSerie {
  type: 'series';
  seriesUrl: string;
  episodes: LienEpisode[];
  overrides: Record<string, string>;
  label: string | null;
  createdAt: string;
  updatedAt: string;
}

export type Association = AssociationMotif | AssociationSerie;

export interface LienFilm {
  url: string;
  kind: TypeMedia;
  label: string | null;
  savedAt: string;
}

export interface LiensManuels {
  anime: Record<string, Association>;
  movies: Record<string, LienFilm>;
}

export const liensVides = (): LiensManuels => ({ anime: {}, movies: {} });

/** Adresse d'un episode selon une association (correction, motif ou liste). */
export function adresseEpisode(assoc: Association | null | undefined, n: number): string | null {
  if (!assoc) {
    return null;
  }
  const fixe = assoc.overrides?.[String(n)];
  if (fixe) {
    return fixe;
  }
  if (assoc.type === 'pattern') {
    return remplirMotif(assoc.pattern, n, assoc);
  }
  if (assoc.type === 'series') {
    return assoc.episodes?.find(e => e.number === Number(n))?.url || null;
  }
  return null;
}

/** Apercu : adresses des episodes `depuis`, `depuis+1`, ... */
export function apercuEpisodes(assoc: Association, depuis = 1, nombre = 3): { number: number; url: string | null }[] {
  const sortie: { number: number; url: string | null }[] = [];
  for (let n = Math.max(1, Number(depuis) || 1); sortie.length < nombre; n += 1) {
    sortie.push({ number: n, url: adresseEpisode(assoc, n) });
    if (n > EPISODES_MAX) {
      break;
    }
  }
  return sortie;
}

export const EPISODE_TEXTE = /(?:episode|épisode|ep\.?|eps)\s*#?\s*(\d{1,4})/i;
export const EPISODE_HREF = /(?:^|[^a-z])(?:episode|episodes|ep|e)[-_/]?(\d{1,4})(?:[^0-9]|$)/i;

// Extraction des liens d'une page de série : liensEpisodesPage.ts (analyseur HTML, inutile à la synchro).

/** Adresse d'episode ou de serie ? Pre-selectionne le mode dans l'interface. */
export function deviner(adresse: string, episode: number | null = null): 'episode' | 'series' {
  const a = analyserUrlHttp(adresse);
  if (classerMedia(adresse) !== 'iframe') {
    return 'episode';
  }
  const slug = `${a.chemin}${a.requete}`.toLowerCase();
  if (/(episode|épisode|[-_/]ep[-_]?\d)/.test(slug)) {
    return 'episode';
  }
  if (episode != null && new RegExp(`(^|[^0-9])0*${Number(episode)}([^0-9]|$)`).test(slug)) {
    return 'episode';
  }
  return 'series';
}

export interface EntreeAssociation {
  type?: unknown;
  label?: unknown;
  overrides?: unknown;
  pattern?: unknown;
  padding?: unknown;
  offset?: unknown;
  seriesUrl?: unknown;
  episodes?: unknown;
}

/** Valide et normalise une association saisie ou importee. */
export function normaliserAssociation(entree: EntreeAssociation, existante: Association | null = null, horloge: Horloge = horlogeSysteme): Association {
  const maintenant = instantDe(horloge);
  const base = {
    label: entree?.label ? String(entree.label).trim().slice(0, 120) : existante?.label || null,
    overrides: {} as Record<string, string>,
    createdAt: existante?.createdAt || maintenant,
    updatedAt: maintenant,
  };
  const corrections = (entree?.overrides ?? existante?.overrides ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(estObjet(corrections) ? corrections : {})) {
    const n = Number(k);
    if (!Number.isInteger(n) || n < 0 || n > EPISODES_MAX || !v) {
      continue;
    }
    base.overrides[String(n)] = urlPropre(v);
  }

  if (entree?.type === 'pattern') {
    const motif = String(entree.pattern || '').trim();
    if (motif.split(MARQUEUR).length !== 2) {
      throw echec('Le motif doit contenir {n} exactement une fois');
    }
    const padding = Math.min(6, Math.max(0, Number(entree.padding) || 0));
    const offset = Math.max(-5000, Math.min(5000, Number(entree.offset) || 0));
    // Le motif rempli doit donner une adresse http(s) valide, sur le meme hote :
    // pas de {n} glisse dans le nom de domaine.
    const e1 = analyserUrlHttp(remplirMotif(motif, 1, { padding, offset: Math.abs(offset) }));
    const e2 = analyserUrlHttp(remplirMotif(motif, 2, { padding, offset: Math.abs(offset) }));
    if (e1.hote !== e2.hote || e1.port !== e2.port) {
      throw echec('Le numero ne peut pas se trouver dans le nom de domaine');
    }
    return { ...base, type: 'pattern', pattern: motif, padding, offset };
  }

  if (entree?.type === 'series') {
    const seriesUrl = urlPropre(entree.seriesUrl);
    const episodes = (Array.isArray(entree.episodes) ? entree.episodes : [])
      .map((e: { number?: unknown; url?: unknown }) => ({ number: Number(e?.number), url: e?.url }))
      .filter(e => Number.isInteger(e.number) && e.number >= 0 && e.number <= EPISODES_MAX && e.url)
      .slice(0, EPISODES_MAX)
      .map(e => ({ number: e.number, url: urlPropre(e.url) }));
    return { ...base, type: 'series', seriesUrl, episodes };
  }
  throw echec('Type d association inconnu (pattern ou series)');
}

/** Complete l'etat lu (ancien fichier ou saisie invalide) en un etat sain. */
export function assurerLiens(brut: unknown): LiensManuels {
  const src = estObjet(brut) ? brut : {};
  return {
    anime: estObjet(src.anime) ? (src.anime as Record<string, Association>) : {},
    movies: estObjet(src.movies) ? (src.movies as Record<string, LienFilm>) : {},
  };
}

export const lireAssociation = (liens: LiensManuels, idAnime: string | number): Association | null =>
  liens.anime[String(idAnime)] ?? null;

export function definirAssociation(liens: LiensManuels, idAnime: string | number, entree: EntreeAssociation, horloge?: Horloge) {
  const association = normaliserAssociation(entree, lireAssociation(liens, idAnime), horloge);
  return { liens: { ...liens, anime: { ...liens.anime, [String(idAnime)]: association } }, association };
}

/** Corrige (ou efface, url = null) l'adresse d'un seul episode. */
export function corrigerEpisode(liens: LiensManuels, idAnime: string | number, n: number, url: string | null, horloge: Horloge = horlogeSysteme) {
  const existante = lireAssociation(liens, idAnime);
  if (!existante) {
    throw echec('Aucune association pour cet anime');
  }
  const numero = Number(n);
  if (!Number.isInteger(numero) || numero < 0) {
    throw echec("Numero d'episode invalide");
  }
  const overrides = { ...existante.overrides };
  if (url) {
    overrides[String(numero)] = urlPropre(url);
  } else {
    delete overrides[String(numero)];
  }
  const association: Association = { ...existante, overrides, updatedAt: instantDe(horloge) };
  return { liens: { ...liens, anime: { ...liens.anime, [String(idAnime)]: association } }, association };
}

export function retirerAssociation(liens: LiensManuels, idAnime: string | number): LiensManuels {
  const anime = { ...liens.anime };
  delete anime[String(idAnime)];
  return { ...liens, anime };
}

export function definirLienFilm(liens: LiensManuels, idFilm: string, o: { url: string; label?: string | null }, horloge: Horloge = horlogeSysteme) {
  const url = urlPropre(o.url);
  const lien: LienFilm = { url, kind: classerMedia(url), label: o.label ? String(o.label).trim().slice(0, 120) : null, savedAt: instantDe(horloge) };
  return { liens: { ...liens, movies: { ...liens.movies, [String(idFilm)]: lien } }, lien };
}

export const lireLienFilm = (liens: LiensManuels, idFilm: string): LienFilm | null => liens.movies[String(idFilm)] ?? null;

export function retirerLienFilm(liens: LiensManuels, idFilm: string): LiensManuels {
  const movies = { ...liens.movies };
  delete movies[String(idFilm)];
  return { ...liens, movies };
}

// ---------------------------------------------------------------------------
// Mapping par titre
// ---------------------------------------------------------------------------

export interface EpisodeCatalogueMin {
  number: number;
  title?: string | null;
}

export interface Rattachement {
  /** Numero du catalogue -> adresse. */
  liens: LienEpisode[];
  /** Numeros du catalogue sans correspondance. */
  manquants: number[];
}

/**
 * Rattache les episodes d'une page de serie aux episodes du catalogue.
 * Un titre identique (apres normalisation, hors « episode N ») l'emporte ;
 * sinon on retombe sur le meme numero.
 */
export function associerParTitre(
  catalogue: readonly EpisodeCatalogueMin[],
  page: readonly { number: number; title?: string | null; url: string }[],
): Rattachement {
  const clef = (t: unknown) => normaliserTexte(String(t ?? '').replace(EPISODE_TEXTE, ' ')).trim();
  const parTitre = new Map<string, string>();
  const doublons = new Set<string>();
  for (const p of page) {
    const c = clef(p.title);
    if (c.length < 3) {
      continue;
    }
    if (parTitre.has(c)) {
      doublons.add(c);
    }
    parTitre.set(c, p.url);
  }
  const parNumero = new Map(page.map(p => [p.number, p.url]));
  const liens: LienEpisode[] = [];
  const manquants: number[] = [];
  for (const ep of catalogue) {
    const c = clef(ep.title);
    const url = (c.length >= 3 && !doublons.has(c) ? parTitre.get(c) : undefined) ?? parNumero.get(ep.number);
    if (url) {
      liens.push({ number: ep.number, url });
    } else {
      manquants.push(ep.number);
    }
  }
  return { liens, manquants };
}
