/**
 * Catalogue : fiches d'animes (Jikan puis AniList en repli) et de films
 * (TMDB si une cle est fournie, sinon Jikan).
 *
 * Tout passe par le client reseau injecte (donc par la garde). Les
 * conversions de reponses sont des fonctions pures, testees sur des
 * reponses figees. Les identifiants d'animes sont ceux de MyAnimeList (AniList
 * expose `idMal`), ceux des films sont prefixes : `tmdb-603`, `mal-199`.
 */

import { echec, ErreurMoteur, messageDe } from './erreurs';
import type { ClientSur } from './reseau';
import { attendreVraiment, horlogeSysteme, jourDe, journalMuet, type Attente, type Horloge, type Journal } from './outils';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Brut = any;

export interface LienStreaming {
  site: string;
  url: string;
  language: string | null;
}

export interface FicheAnime {
  id: number | null;
  title: string;
  titleOriginal: string | null;
  titleJapanese: string | null;
  /** Autres titres connus du catalogue (français d'abord, puis synonymes, anglais…) : servent à chercher sur les sources. */
  titresAlternatifs?: string[];
  synopsis: string | null;
  image: string | null;
  banner?: string | null;
  trailer: string | null;
  totalEpisodes: number | null;
  airingStatus: string | null;
  score: number | null;
  members: number | null;
  rank: number | null;
  year: number | null;
  season: string | null;
  type: string | null;
  duration: string | null;
  ageRating: string | null;
  studios: string[];
  genres: string[];
  themes: string[];
  /** Plateformes LEGALES annoncees par le catalogue (liens, pas d'integration). */
  streamingLinks: LienStreaming[];
}

export interface FicheFilm {
  id: string;
  kind: 'movie';
  source: 'tmdb' | 'jikan';
  animeId?: number;
  title: string;
  originalTitle: string | null;
  synopsis: string | null;
  image: string | null;
  banner: string | null;
  year: number | null;
  releaseDate: string | null;
  score: number | null;
  genres: string[];
  runtime: number | null;
  type: string;
  tagline?: string | null;
  trailer?: string | null;
  streamingLinks?: LienStreaming[];
  homepage?: string | null;
}

export interface EpisodeCatalogue {
  number: number;
  title: string | null;
  aired: string | null;
  filler: boolean;
  url: string | null;
  watchUrl?: string | null;
  watchSite?: string | null;
}

export interface Rangee<T> {
  key: string;
  title: string;
  items: T[];
}

export interface InfosPage {
  page: number;
  hasNextPage: boolean;
  total: number | null;
}

// ---------------------------------------------------------------------------
// Conversions (pures)
// ---------------------------------------------------------------------------

/** Titres distincts (casse et accents ignorés), au plus 12. */
function sansDoublon(liste: readonly unknown[]): string[] {
  const vus = new Set<string>();
  const sortie: string[] = [];
  for (const brut of liste) {
    const t = typeof brut === 'string' ? brut.trim() : '';
    const cle = t.toLowerCase();
    if (t && t.length <= 200 && !vus.has(cle)) {
      vus.add(cle);
      sortie.push(t);
    }
  }
  return sortie.slice(0, 12);
}

/** Titres Jikan (`titles`, `title_synonyms`) : le français d'abord, puis synonymes et autres langues. */
function titresJikan(a: Brut): string[] {
  const titres: Array<{ type?: string; title?: string }> = Array.isArray(a.titles) ? a.titles : [];
  const rang = (type = '') => (/french/i.test(type) ? 0 : /synonym/i.test(type) ? 1 : /english/i.test(type) ? 2 : /default/i.test(type) ? 3 : 4);
  const tries = [...titres].sort((x, y) => rang(x.type) - rang(y.type)).map(t => t.title);
  return sansDoublon([...tries, ...(Array.isArray(a.title_synonyms) ? a.title_synonyms : []), a.title_english, a.title]);
}

export function mapperAnimeJikan(a: Brut): FicheAnime | null {
  if (!a) {
    return null;
  }
  return {
    id: a.mal_id ?? null,
    title: a.title_english || a.title,
    titleOriginal: a.title ?? null,
    titleJapanese: a.title_japanese || null,
    titresAlternatifs: titresJikan(a),
    synopsis: a.synopsis || null,
    image: a.images?.jpg?.large_image_url || a.images?.jpg?.image_url || null,
    trailer: a.trailer?.embed_url || null,
    totalEpisodes: a.episodes ?? null,
    airingStatus: a.status || null,
    score: a.score ?? null,
    members: a.members ?? null,
    rank: a.rank ?? null,
    year: a.year ?? a.aired?.prop?.from?.year ?? null,
    season: a.season || null,
    type: a.type || null,
    duration: a.duration || null,
    ageRating: a.rating || null,
    studios: (a.studios || []).map((s: Brut) => s.name),
    genres: (a.genres || []).map((g: Brut) => g.name),
    themes: (a.themes || []).map((g: Brut) => g.name),
    streamingLinks: (a.streaming || []).filter((s: Brut) => s.url).map((s: Brut) => ({ site: s.name, url: s.url, language: null })),
  };
}

const LIBELLES_STATUT: Record<string, string> = {
  FINISHED: 'Finished Airing',
  RELEASING: 'Currently Airing',
  NOT_YET_RELEASED: 'Not yet aired',
  CANCELLED: 'Cancelled',
  HIATUS: 'On hiatus',
};

export function retirerHtml(texte: unknown): string | null {
  if (!texte) {
    return null;
  }
  return String(texte)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Ramene une fiche AniList au format Jikan, en gardant l'identifiant MyAnimeList. */
export function mapperMediaAnilist(m: Brut): FicheAnime | null {
  if (!m) {
    return null;
  }
  const parPlateforme = new Map<string, LienStreaming>();
  for (const l of m.externalLinks || []) {
    if (l.type === 'STREAMING' && l.url && l.site && !parPlateforme.has(l.site)) {
      parPlateforme.set(l.site, { site: l.site, url: l.url, language: l.language || null });
    }
  }
  return {
    id: m.idMal ?? null,
    title: m.title?.english || m.title?.romaji || 'Sans titre',
    titleOriginal: m.title?.romaji || m.title?.english || null,
    titleJapanese: m.title?.native || null,
    titresAlternatifs: sansDoublon([m.title?.english, m.title?.romaji, ...(Array.isArray(m.synonyms) ? m.synonyms : [])]),
    synopsis: retirerHtml(m.description),
    image: m.coverImage?.extraLarge || m.coverImage?.large || null,
    banner: m.bannerImage || null,
    trailer: null,
    totalEpisodes: m.episodes ?? null,
    airingStatus: LIBELLES_STATUT[m.status] || m.status || null,
    // AniList note sur 100, Jikan sur 10.
    score: typeof m.averageScore === 'number' ? m.averageScore / 10 : null,
    members: m.popularity ?? null,
    rank: null,
    year: m.seasonYear ?? null,
    season: m.season ? String(m.season).toLowerCase() : null,
    type: m.format || null,
    duration: m.duration ? `${m.duration} min` : null,
    ageRating: null,
    studios: (m.studios?.nodes || []).map((s: Brut) => s.name),
    genres: m.genres || [],
    themes: [],
    streamingLinks: [...parPlateforme.values()],
  };
}

/** « 1 hr 55 min » -> 115 ; « 45 min per ep » -> 45. */
export function dureeEnMinutes(texte: unknown): number | null {
  if (!texte) {
    return null;
  }
  const h = /(\d+)\s*h/i.exec(String(texte));
  const m = /(\d+)\s*min/i.exec(String(texte));
  return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0) || null;
}

const annee = (date: unknown): number | null => (date && /^\d{4}/.test(String(date)) ? Number(String(date).slice(0, 4)) : null);

const IMG = 'https://image.tmdb.org/t/p';

export function choisirBandeAnnonce(videos: Brut): string | null {
  const liste = (videos?.results || []).filter((v: Brut) => v.site === 'YouTube' && v.key);
  const meilleure =
    liste.find((v: Brut) => v.type === 'Trailer' && v.iso_639_1 === 'fr') ||
    liste.find((v: Brut) => v.type === 'Trailer') ||
    liste.find((v: Brut) => v.type === 'Teaser') ||
    null;
  return meilleure ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(meilleure.key)}` : null;
}

/** Plateformes legales (France) d'apres TMDB / JustWatch. */
export function mapperPlateformesTmdb(bloc: Brut): LienStreaming[] {
  const fr = bloc?.results?.FR;
  if (!fr?.link) {
    return [];
  }
  const sortie: LienStreaming[] = [];
  const vus = new Set<string>();
  const ajouter = (liste: Brut[] | undefined, suffixe: string) => {
    for (const p of liste || []) {
      const site = `${p.provider_name}${suffixe}`;
      if (!p.provider_name || vus.has(site)) {
        continue;
      }
      vus.add(site);
      sortie.push({ site, url: fr.link, language: null });
    }
  };
  ajouter(fr.flatrate, '');
  ajouter(fr.free, ' (gratuit)');
  ajouter(fr.rent, ' (location)');
  ajouter(fr.buy, ' (achat)');
  return sortie;
}

export function mapperFilmTmdb(m: Brut, nomsGenres: Map<number, string> = new Map()): FicheFilm | null {
  if (!m) {
    return null;
  }
  return {
    id: `tmdb-${m.id}`,
    kind: 'movie',
    source: 'tmdb',
    title: m.title || m.original_title || 'Sans titre',
    originalTitle: m.original_title || null,
    synopsis: m.overview || null,
    image: m.poster_path ? `${IMG}/w500${m.poster_path}` : null,
    banner: m.backdrop_path ? `${IMG}/w1280${m.backdrop_path}` : null,
    year: annee(m.release_date),
    releaseDate: m.release_date || null,
    score: typeof m.vote_average === 'number' && m.vote_count ? Math.round(m.vote_average * 10) / 10 : null,
    genres: Array.isArray(m.genres)
      ? m.genres.map((g: Brut) => g.name)
      : (m.genre_ids || []).map((id: number) => nomsGenres.get(id)).filter(Boolean),
    runtime: m.runtime ?? null,
    type: 'Film',
  };
}

export function mapperDetailsTmdb(m: Brut): FicheFilm | null {
  const base = mapperFilmTmdb(m);
  if (!base) {
    return null;
  }
  return {
    ...base,
    tagline: m.tagline || null,
    trailer: choisirBandeAnnonce(m.videos),
    streamingLinks: mapperPlateformesTmdb(m['watch/providers']),
    homepage: m.homepage || null,
  };
}

export function mapperFilmJikan(a: Brut): FicheFilm | null {
  if (!a) {
    return null;
  }
  const trailer =
    a.trailer?.embed_url ||
    (a.trailer?.youtube_id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(a.trailer.youtube_id)}` : null);
  return {
    id: `mal-${a.mal_id}`,
    kind: 'movie',
    source: 'jikan',
    animeId: a.mal_id,
    title: a.title_english || a.title || 'Sans titre',
    originalTitle: a.title || null,
    synopsis: a.synopsis || null,
    image: a.images?.jpg?.large_image_url || a.images?.jpg?.image_url || null,
    banner: null,
    year: a.year ?? a.aired?.prop?.from?.year ?? null,
    releaseDate: a.aired?.from ? String(a.aired.from).slice(0, 10) : null,
    score: a.score ?? null,
    genres: (a.genres || []).map((g: Brut) => g.name),
    runtime: dureeEnMinutes(a.duration),
    type: "Film d'animation",
    trailer,
    streamingLinks: (a.streaming || []).filter((s: Brut) => s.url).map((s: Brut) => ({ site: s.name, url: s.url, language: null })),
  };
}

export const RE_ID_FILM = /^(tmdb|mal)-(\d{1,10})$/;

// ---------------------------------------------------------------------------
// Client de catalogue
// ---------------------------------------------------------------------------

export interface OptionsCatalogue {
  client: ClientSur;
  /** Cle TMDB (v3 ou jeton « Bearer ») ; absente : les films passent par Jikan. */
  cleTmdb?: () => string | null | undefined | Promise<string | null | undefined>;
  horloge?: Horloge;
  attendre?: Attente;
  journal?: Journal;
  baseJikan?: string;
  baseTmdb?: string;
  urlAnilist?: string;
  /** Duree de vie du cache (ms). */
  cacheMs?: number;
  /** Duree pendant laquelle Jikan est evite apres une panne (ms). */
  disjoncteurMs?: number;
}

export type FournisseurAnime = 'jikan' | 'anilist';

const CHAMPS_MEDIA = `
  id idMal
  title { romaji english native }
  synonyms
  description(asHtml: false)
  episodes duration status format season seasonYear
  averageScore popularity genres
  coverImage { extraLarge large }
  bannerImage
  studios(isMain: true) { nodes { name } }
  externalLinks { url site type language }
`;

const TRIS_TMDB: Record<string, Record<string, string | number>> = {
  populaire: { sort_by: 'popularity.desc' },
  note: { sort_by: 'vote_average.desc', 'vote_count.gte': 300 },
  recent: { sort_by: 'primary_release_date.desc', 'vote_count.gte': 20 },
  titre: { sort_by: 'title.asc', 'vote_count.gte': 50 },
};

const TRIS_JIKAN: Record<string, string> = {
  populaire: 'order_by=members&sort=desc',
  note: 'order_by=score&sort=desc',
  recent: 'order_by=start_date&sort=desc',
  titre: 'order_by=title&sort=asc',
};

const estJeton = (cle: string) => /^eyJ/.test(cle) && cle.length > 60;
const q = (v: unknown) => encodeURIComponent(String(v));
const pageEntier = (p: unknown) => Math.max(1, Math.min(500, Math.floor(Number(p)) || 1));
const limiteEntier = (l: unknown, defaut = 24) => Math.max(1, Math.min(50, Math.floor(Number(l)) || defaut));

export function creerCatalogue(options: OptionsCatalogue) {
  const { client } = options;
  const horloge = options.horloge ?? horlogeSysteme;
  const attendre = options.attendre ?? attendreVraiment;
  const journal = options.journal ?? journalMuet;
  const baseJikan = (options.baseJikan ?? 'https://api.jikan.moe/v4').replace(/\/+$/, '');
  const baseTmdb = (options.baseTmdb ?? 'https://api.themoviedb.org/3').replace(/\/+$/, '');
  const urlAnilist = options.urlAnilist ?? 'https://graphql.anilist.co';
  const dureeCache = options.cacheMs ?? 5 * 60 * 1000;
  const dureeDisjoncteur = options.disjoncteurMs ?? 60 * 1000;
  const INTERVALLE_JIKAN = 400;

  const cache = new Map<string, { a: number; donnees: unknown }>();
  async function enCache<T>(cle: string, fn: () => Promise<T>): Promise<T> {
    const t = cache.get(cle);
    if (t && horloge.maintenant() - t.a < dureeCache) {
      return t.donnees as T;
    }
    const donnees = await fn();
    cache.set(cle, { a: horloge.maintenant(), donnees });
    return donnees;
  }

  // Jikan tolere ~3 requetes/s : file serialisee.
  let chaine: Promise<unknown> = Promise.resolve();
  let dernierAppel = -Infinity;
  function file<T>(fn: () => Promise<T>): Promise<T> {
    const tache = chaine.then(async () => {
      const reste = INTERVALLE_JIKAN - (horloge.maintenant() - dernierAppel);
      if (reste > 0) {
        await attendre(reste);
      }
      dernierAppel = horloge.maintenant();
      return fn();
    });
    chaine = tache.then(
      () => undefined,
      () => undefined,
    );
    return tache;
  }

  async function jikan(chemin: string): Promise<Brut> {
    return enCache(`jikan:${chemin}`, () =>
      file(async () => {
        for (let essai = 0; essai < 2; essai += 1) {
          let rep;
          try {
            rep = await client.obtenir(`${baseJikan}${chemin}`, { entetes: { accept: 'application/json' } });
          } catch (err) {
            if (err instanceof ErreurMoteur && err.code === 'garde') {
              throw err;
            }
            throw echec(`Jikan indisponible : ${messageDe(err)}`, 'service', 502);
          }
          if (rep.statut === 429 && essai === 0) {
            await attendre(1200);
            continue;
          }
          if (rep.statut === 404) {
            throw echec('Introuvable sur Jikan', 'introuvable', 404);
          }
          if (rep.statut === 429) {
            throw echec('Jikan : trop de requetes, reessaie dans un instant', 'service', 429);
          }
          if (rep.statut >= 400) {
            throw echec(`Jikan indisponible : ${rep.statut}`, 'service', 502);
          }
          try {
            return JSON.parse(rep.corps);
          } catch {
            throw echec('Jikan : reponse illisible', 'service', 502);
          }
        }
        throw echec('Jikan : trop de requetes, reessaie dans un instant', 'service', 429);
      }),
    );
  }

  async function graphql(requete: string, variables: Record<string, unknown> = {}): Promise<Brut> {
    return enCache(`anilist:${JSON.stringify([requete, variables])}`, async () => {
      let res;
      try {
        res = await client.envoyerJson<Brut>(urlAnilist, { query: requete, variables });
      } catch (err) {
        if (err instanceof ErreurMoteur && err.code === 'garde') {
          throw err;
        }
        throw echec(`AniList indisponible : ${messageDe(err)}`, 'service', 502);
      }
      if (res.donnees?.errors?.length) {
        throw echec(`AniList : ${res.donnees.errors[0].message}`, 'service', 502);
      }
      if (res.statut >= 400 || !res.donnees?.data) {
        throw echec(`AniList indisponible : ${res.statut}`, 'service', 502);
      }
      return res.donnees.data;
    });
  }

  // -- Animes : Jikan prioritaire, AniList en repli ---------------------------

  let jikanHorsServiceJusqua = 0;
  const jikanUtilisable = () => horloge.maintenant() >= jikanHorsServiceJusqua;
  const noterPanne = (err: unknown) => {
    jikanHorsServiceJusqua = horloge.maintenant() + dureeDisjoncteur;
    journal(`[catalogue] Jikan indisponible, bascule sur AniList (${messageDe(err)})`);
  };

  async function avecRepli<T>(viaJikan: () => Promise<T>, viaAnilist: () => Promise<T>): Promise<{ source: FournisseurAnime; data: T }> {
    if (jikanUtilisable()) {
      try {
        return { source: 'jikan', data: await viaJikan() };
      } catch (err) {
        if (err instanceof ErreurMoteur && (err.statut === 404 || err.code === 'garde')) {
          throw err;
        }
        noterPanne(err);
      }
    }
    return { source: 'anilist', data: await viaAnilist() };
  }

  const nonVide = (liste: FicheAnime[]) => {
    if (!liste.length) {
      throw echec('Jikan : reponse vide', 'service', 502);
    }
    return liste;
  };
  const listeJikan = (d: Brut) => ((d?.data || []) as Brut[]).map(mapperAnimeJikan).filter(Boolean) as FicheAnime[];
  // Les entrees sans identifiant MyAnimeList sont ecartees (la bibliotheque s'appuie dessus).
  const avecIdMal = (liste: Brut[]) => liste.map(mapperMediaAnilist).filter((a): a is FicheAnime => Boolean(a && a.id != null));

  async function pageAnilist(args: string, limite: number): Promise<FicheAnime[]> {
    const d = await graphql(
      `query($n: Int) { Page(page: 1, perPage: $n) { media(type: ANIME, isAdult: false, ${args}) { ${CHAMPS_MEDIA} } } }`,
      { n: limite },
    );
    return avecIdMal(d.Page.media || []);
  }

  const mapperEpisodesJikan = (liste: Brut[] | undefined): EpisodeCatalogue[] =>
    (liste || []).map(ep => ({
      number: ep.mal_id,
      title: ep.title || ep.title_romanji || null,
      aired: ep.aired || null,
      filler: Boolean(ep.filler),
      url: null,
    }));

  async function episodesAnilist(idMal: number | string): Promise<EpisodeCatalogue[]> {
    const d = await graphql(
      `query($idMal: Int) { Media(idMal: $idMal, type: ANIME) { episodes nextAiringEpisode { episode } streamingEpisodes { title url site } } }`,
      { idMal: Number(idMal) },
    );
    const media = d.Media;
    if (!media) {
      return [];
    }
    // streamingEpisodes ne couvre souvent qu'une fenetre partielle : utile
    // pour les titres, jamais pour deduire la numerotation.
    const connus = new Map<number, { title: string | null; watchUrl: string | null; watchSite: string | null }>();
    ((media.streamingEpisodes || []) as Brut[]).forEach((ep, i) => {
      const m = /^Episode\s+(\d+)\s*(?:[-–—]\s*(.*))?$/i.exec(ep.title || '');
      const numero = m ? Number(m[1]) : i + 1;
      connus.set(numero, { title: (m ? m[2] : ep.title)?.trim() || null, watchUrl: ep.url || null, watchSite: ep.site || null });
    });
    const plusHaut = connus.size ? Math.max(...connus.keys()) : 0;
    const diffuses = media.nextAiringEpisode?.episode ? media.nextAiringEpisode.episode - 1 : 0;
    const total = Math.max(media.episodes || 0, diffuses, plusHaut);
    return Array.from({ length: total }, (_, i) => {
      const numero = i + 1;
      const extra = connus.get(numero);
      return {
        number: numero,
        title: extra?.title || null,
        aired: null,
        filler: false,
        url: null,
        watchUrl: extra?.watchUrl || null,
        watchSite: extra?.watchSite || null,
      };
    });
  }

  const PAGES_JIKAN_MAX = 3;

  const animes = {
    fournisseur: (): FournisseurAnime => (jikanUtilisable() ? 'jikan' : 'anilist'),

    rechercher(requete: string, limite = 24) {
      const n = limiteEntier(limite);
      return avecRepli(
        async () => nonVide(listeJikan(await jikan(`/anime?q=${q(requete)}&limit=${n}&sfw=true&order_by=members&sort=desc`))),
        async () => {
          const d = await graphql(
            `query($s: String, $n: Int) { Page(page: 1, perPage: $n) { media(type: ANIME, search: $s, isAdult: false, sort: SEARCH_MATCH) { ${CHAMPS_MEDIA} } } }`,
            { s: requete, n },
          );
          return avecIdMal(d.Page.media || []);
        },
      );
    },

    populaires(limite = 24) {
      const n = limiteEntier(limite);
      return avecRepli(
        async () => nonVide(listeJikan(await jikan(`/top/anime?limit=${n}&filter=bypopularity&sfw=true`))),
        () => pageAnilist('sort: POPULARITY_DESC', n),
      );
    },

    saison(limite = 24) {
      const n = limiteEntier(limite);
      return avecRepli(
        async () => nonVide(listeJikan(await jikan(`/seasons/now?limit=${n}&sfw=true`))),
        () => pageAnilist('status: RELEASING, sort: POPULARITY_DESC', n),
      );
    },

    parId(idMal: number | string) {
      const id = Math.floor(Number(idMal));
      if (!Number.isFinite(id) || id <= 0) {
        throw echec("Identifiant d'anime invalide");
      }
      return avecRepli(
        async () => {
          const f = mapperAnimeJikan((await jikan(`/anime/${id}/full`)).data);
          if (!f) {
            throw echec('Reponse Jikan vide', 'service', 502);
          }
          return f;
        },
        async () => {
          const d = await graphql(`query($idMal: Int) { Media(idMal: $idMal, type: ANIME) { ${CHAMPS_MEDIA} } }`, { idMal: id });
          const f = mapperMediaAnilist(d.Media);
          if (!f) {
            throw echec('Anime introuvable sur AniList', 'introuvable', 404);
          }
          return f;
        },
      );
    },

    /** Episodes : Jikan (dates, fillers) ; AniList si la serie est longue ou Jikan en panne. */
    async episodes(idMal: number | string): Promise<{ source: FournisseurAnime; data: EpisodeCatalogue[] }> {
      const id = Math.floor(Number(idMal));
      if (!Number.isFinite(id) || id <= 0) {
        throw echec("Identifiant d'anime invalide");
      }
      if (jikanUtilisable()) {
        try {
          const premiere = await jikan(`/anime/${id}/episodes?page=1`);
          const pages = premiere.pagination?.last_visible_page || 1;
          // Serie trop longue pour Jikan : AniList, sans ouvrir le disjoncteur.
          if (pages > PAGES_JIKAN_MAX) {
            return { source: 'anilist', data: await episodesAnilist(id) };
          }
          const sortie = mapperEpisodesJikan(premiere.data);
          for (let p = 2; p <= pages; p += 1) {
            sortie.push(...mapperEpisodesJikan((await jikan(`/anime/${id}/episodes?page=${p}`)).data));
          }
          if (sortie.length) {
            return { source: 'jikan', data: sortie };
          }
        } catch (err) {
          if (err instanceof ErreurMoteur && (err.statut === 404 || err.code === 'garde')) {
            throw err;
          }
          noterPanne(err);
        }
      }
      return { source: 'anilist', data: await episodesAnilist(id) };
    },

    /** Rangees de la page Decouvrir, en une seule requete AniList. */
    async decouvrir(): Promise<Rangee<FicheAnime>[]> {
      const rangee = (alias: string, args: string) =>
        `${alias}: Page(page: 1, perPage: 20) { media(type: ANIME, isAdult: false, ${args}) { ${CHAMPS_MEDIA} } }`;
      const d = await graphql(`query {
        ${rangee('trending', 'sort: TRENDING_DESC')}
        ${rangee('popular', 'sort: POPULARITY_DESC')}
        ${rangee('airing', 'status: RELEASING, sort: POPULARITY_DESC')}
        ${rangee('topRated', 'sort: SCORE_DESC')}
        ${rangee('movies', 'format: MOVIE, sort: POPULARITY_DESC')}
      }`);
      return [
        { key: 'trending', title: 'Tendances du moment', items: avecIdMal(d.trending.media) },
        { key: 'airing', title: 'En cours de diffusion', items: avecIdMal(d.airing.media) },
        { key: 'popular', title: 'Les plus populaires', items: avecIdMal(d.popular.media) },
        { key: 'topRated', title: 'Les mieux notes', items: avecIdMal(d.topRated.media) },
        { key: 'movies', title: 'Films', items: avecIdMal(d.movies.media) },
      ].filter(r => r.items.length);
    },

    /** Genres AniList, sans celui reserve aux contenus adultes (jamais servis). */
    async genres(): Promise<string[]> {
      const d = await graphql('query { GenreCollection }');
      return ((d.GenreCollection || []) as string[]).filter(g => g !== 'Hentai');
    },

    /** Parcours filtre ; les criteres non renseignes sont OMIS (null = « champ vide » chez AniList). */
    async parcourir(f: { genre?: string | null; pays?: string | null; format?: string | null; annee?: number | null; tri?: string; page?: number; parPage?: number } = {}) {
      const variables: Record<string, unknown> = { page: pageEntier(f.page), perPage: limiteEntier(f.parPage, 30), sort: [f.tri || 'POPULARITY_DESC'] };
      if (f.genre) variables.genre = f.genre;
      if (f.pays) variables.country = f.pays;
      if (f.format) variables.format = f.format;
      if (f.annee) variables.year = f.annee;
      const d = await graphql(
        `query($page: Int, $perPage: Int, $genre: String, $country: CountryCode, $format: MediaFormat, $year: Int, $sort: [MediaSort]) {
          Page(page: $page, perPage: $perPage) {
            pageInfo { total currentPage lastPage hasNextPage perPage }
            media(type: ANIME, isAdult: false, genre: $genre, countryOfOrigin: $country, format: $format, seasonYear: $year, sort: $sort) { ${CHAMPS_MEDIA} }
          }
        }`,
        variables,
      );
      return { items: avecIdMal(d.Page.media || []), pageInfo: d.Page.pageInfo };
    },
  };

  // -- Films : TMDB si cle, sinon Jikan ---------------------------------------

  async function cleActive(): Promise<string | null> {
    const c = options.cleTmdb ? await options.cleTmdb() : null;
    return c ? String(c).trim() || null : null;
  }

  async function tmdb(chemin: string, params: Record<string, string | number | boolean> = {}): Promise<Brut> {
    const cle = await cleActive();
    if (!cle) {
      throw echec('Aucune cle TMDB configuree', 'configuration', 503);
    }
    const jeton = estJeton(cle);
    const requete: Record<string, string | number | boolean> = { language: 'fr-FR', ...params };
    const suite = Object.entries(requete)
      .map(([k, v]) => `${q(k)}=${q(v)}`)
      .join('&');
    // La cle n'entre jamais dans la cle de cache ni dans un message d'erreur.
    return enCache(`tmdb:${chemin}?${suite}`, async () => {
      const url = `${baseTmdb}${chemin}?${suite}${jeton ? '' : `&api_key=${q(cle)}`}`;
      let rep;
      try {
        rep = await client.obtenir(url, { entetes: { accept: 'application/json', ...(jeton ? { authorization: `Bearer ${cle}` } : {}) } });
      } catch (err) {
        if (err instanceof ErreurMoteur && err.code === 'garde') {
          throw err;
        }
        throw echec('TMDB indisponible', 'service', 502);
      }
      if (rep.statut === 401) {
        throw echec('Cle TMDB refusee : verifie-la dans les reglages', 'configuration', 502);
      }
      if (rep.statut === 404) {
        throw echec('Film introuvable sur TMDB', 'introuvable', 404);
      }
      if (rep.statut >= 400) {
        throw echec(`TMDB indisponible (${rep.statut})`, 'service', 502);
      }
      try {
        return JSON.parse(rep.corps);
      } catch {
        throw echec('TMDB : reponse illisible', 'service', 502);
      }
    });
  }

  async function genresTmdb() {
    const d = await tmdb('/genre/movie/list');
    return ((d.genres || []) as Brut[]).map(g => ({ id: String(g.id), name: g.name as string }));
  }

  async function listeTmdb(chemin: string, params: Record<string, string | number | boolean> = {}) {
    const [d, genres] = await Promise.all([tmdb(chemin, params), genresTmdb().catch(() => [])]);
    const noms = new Map(genres.map(g => [Number(g.id), g.name]));
    const pageCourante = d.page || 1;
    return {
      items: ((d.results || []) as Brut[]).map(m => mapperFilmTmdb(m, noms)).filter((f): f is FicheFilm => Boolean(f)),
      pageInfo: { page: pageCourante, hasNextPage: pageCourante < Math.min(d.total_pages || 1, 500), total: d.total_results ?? null } as InfosPage,
    };
  }

  async function listeJikanFilms(chemin: string) {
    const d = await jikan(chemin);
    const p = d.pagination || {};
    return {
      items: ((d.data || []) as Brut[]).map(mapperFilmJikan).filter((f): f is FicheFilm => Boolean(f)),
      pageInfo: { page: p.current_page || 1, hasNextPage: Boolean(p.has_next_page), total: p.items?.total ?? null } as InfosPage,
    };
  }

  async function repliFilms<T extends object>(viaTmdb: () => Promise<T>, viaJikan: () => Promise<T>): Promise<T & { source: 'tmdb' | 'jikan' }> {
    if (await cleActive()) {
      try {
        return { source: 'tmdb', ...(await viaTmdb()) };
      } catch (err) {
        if (err instanceof ErreurMoteur && (err.statut === 404 || err.code === 'garde')) {
          throw err;
        }
        journal(`[films] TMDB en echec, repli sur Jikan (${messageDe(err)})`);
      }
    }
    return { source: 'jikan', ...(await viaJikan()) };
  }

  const films = {
    async fournisseur(): Promise<'tmdb' | 'jikan'> {
      return (await cleActive()) ? 'tmdb' : 'jikan';
    },

    decouvrir() {
      return repliFilms(
        async () => ({
          rows: await Promise.all([
            listeTmdb('/trending/movie/week').then(r => ({ key: 'tendances', title: 'Tendances de la semaine', items: r.items })),
            listeTmdb('/movie/now_playing', { region: 'FR' }).then(r => ({ key: 'salles', title: 'Au cinema', items: r.items })),
            listeTmdb('/movie/popular', { region: 'FR' }).then(r => ({ key: 'populaires', title: 'Populaires', items: r.items })),
            listeTmdb('/movie/top_rated').then(r => ({ key: 'notes', title: 'Les mieux notes', items: r.items })),
            listeTmdb('/discover/movie', { with_genres: '16', sort_by: 'popularity.desc' }).then(r => ({ key: 'animation', title: "Films d'animation", items: r.items })),
          ]),
        }),
        async () => {
          const rows: Rangee<FicheFilm>[] = [];
          const specs: [string, string, string][] = [
            ['populaires', "Films d'animation populaires", '/top/anime?type=movie&filter=bypopularity&sfw=true&limit=24'],
            ['notes', 'Les mieux notes', '/top/anime?type=movie&sfw=true&limit=24'],
            ['recents', 'Sortis recemment', '/anime?type=movie&order_by=start_date&sort=desc&status=complete&sfw=true&limit=24'],
          ];
          for (const [key, title, chemin] of specs) {
            try {
              rows.push({ key, title, items: (await listeJikanFilms(chemin)).items });
            } catch (err) {
              journal(`[films] rangee « ${title} » indisponible : ${messageDe(err)}`);
            }
          }
          if (!rows.length) {
            throw echec('Catalogue de films indisponible', 'service', 502);
          }
          return { rows };
        },
      );
    },

    rechercher(requete: string, page = 1) {
      const p = pageEntier(page);
      return repliFilms(
        () => listeTmdb('/search/movie', { query: requete, page: p, include_adult: false }),
        () => listeJikanFilms(`/anime?type=movie&q=${q(requete)}&sfw=true&order_by=members&sort=desc&limit=24&page=${p}`),
      );
    },

    genres() {
      return repliFilms(
        async () => ({ genres: await genresTmdb() }),
        async () => ({ genres: (((await jikan('/genres/anime?filter=genres')).data || []) as Brut[]).map(g => ({ id: String(g.mal_id), name: g.name as string })) }),
      );
    },

    parcourir(f: { genre?: string | null; annee?: number | null; tri?: string; page?: number } = {}) {
      const tri = f.tri && TRIS_TMDB[f.tri] ? f.tri : 'populaire';
      const p = pageEntier(f.page);
      return repliFilms(
        () =>
          listeTmdb('/discover/movie', {
            ...TRIS_TMDB[tri],
            page: p,
            include_adult: false,
            ...(f.genre ? { with_genres: f.genre } : {}),
            ...(f.annee ? { primary_release_year: f.annee } : {}),
            ...(tri === 'recent' ? { 'primary_release_date.lte': jourDe(horloge) } : {}),
          }),
        () => {
          const parts = ['type=movie', 'sfw=true', 'limit=24', `page=${p}`, TRIS_JIKAN[tri]];
          if (f.genre && /^\d+$/.test(String(f.genre))) parts.push(`genres=${f.genre}`);
          if (f.annee) parts.push(`start_date=${f.annee}-01-01`, `end_date=${f.annee}-12-31`);
          return listeJikanFilms(`/anime?${parts.join('&')}`);
        },
      );
    },

    async parId(id: string): Promise<{ source: 'tmdb' | 'jikan'; film: FicheFilm }> {
      const m = RE_ID_FILM.exec(String(id));
      if (!m) {
        throw echec('Identifiant de film invalide');
      }
      if (m[1] === 'tmdb') {
        const d = await tmdb(`/movie/${m[2]}`, { append_to_response: 'videos,watch/providers', include_video_language: 'fr,en,null' });
        const film = mapperDetailsTmdb(d);
        if (!film) {
          throw echec('Film introuvable sur TMDB', 'introuvable', 404);
        }
        return { source: 'tmdb', film };
      }
      const film = mapperFilmJikan((await jikan(`/anime/${m[2]}/full`)).data);
      if (!film) {
        throw echec('Film introuvable', 'introuvable', 404);
      }
      return { source: 'jikan', film };
    },
  };

  return { animes, films, viderCache: () => cache.clear() };
}

export type Catalogue = ReturnType<typeof creerCatalogue>;
