/**
 * Appariement de titres : retrouver, parmi les resultats d'un site, la
 * serie ou le film que le catalogue designe. Logique pure, portee de
 * l'ancien scrapers/provider.js.
 */

import { langueDAdresse, langueDeTexte } from './langues';
import { normaliserTexte } from './outils';

/** Marqueurs de langue, ecartes de la comparaison (traites par la preference VF/VOSTFR). */
const BRUIT = new Set(['vf', 'vff', 'vfq', 'vostfr', 'vost', 'vostf', 'vo', 'vosta', 'fr', 'dub', 'dubbed', 'subbed']);

const MARQUEURS_SAISON = /\b(?:saison|season|cour|partie|part)\s*\d+\b|\b\d+(?:st|nd|rd|th|e|eme|ème)\s+(?:season|saison)\b|\bs\d{1,2}\b(?!\s*e\d)/gi;

/**
 * Séparateur de sous-titre : « : » SUIVI d'une espace, « - » / « – » entourés
 * d'espaces (« Re:Zero » ou « Shangri-La » ne sont pas coupés).
 */
const SEPARATEUR_SOUS_TITRE = /\s*:\s+|\s+[-–—]+\s*|\s*[–—]+\s+/;
const avantSousTitre = (t: string) => t.split(SEPARATEUR_SOUS_TITRE)[0];

/**
 * Marqueurs d'ÉPISODE dans un titre de résultat (« Titre Épisode 12 VOSTFR »,
 * « Titre - EP 03 », « Titre E05 », « Titre 第3話 ») : beaucoup de sites listent
 * des épisodes dans leur recherche. Ils sont retirés AVANT la comparaison.
 */
const MARQUEURS_EPISODE = /(?:\b(?:episode|épisode|ep|eps|episodio)\.?\s*#?\s*\d{1,4}(?:\s*(?:-|à|a|to)\s*\d{1,4})?\b|\bs\d{1,2}\s*e\d{1,4}\b|\be\d{2,4}\b|第\s*\d{1,4}\s*[話话集])/gi;

/** Titre sans marqueur d'épisode (garde la saison). */
export function sansEpisode(titre: unknown): string {
  let t = String(titre ?? '');
  try {
    // « Épisode » : \b ne voit pas le « É » ; les accents sont retirés (la comparaison les ignore de toute façon).
    t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch {
    // Pas de normalize : « episode » sans accent reste reconnu.
  }
  return t
    .replace(/\bs(\d{1,2})\s*e\d{1,4}\b/gi, ' saison $1 ')
    .replace(MARQUEURS_EPISODE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Mots de FORMAT : un film / OAV n'est pas la série, mais un site les omet souvent. */
const FORMATS = new Set(['film', 'movie', 'films', 'movies', 'oav', 'ova', 'ona', 'special', 'specials', 'gekijouban', 'gekijoban']);

/** En dessous, le titre trouve n'est ni identique ni un prefixe : correspondance non fiable. */
export const SCORE_MINIMAL = 600;

export type LangueDetectee = 'vf' | 'vostfr' | null;
export type PreferenceLangue = 'vf' | 'vostfr' | 'indifferent';

/** Langue d'un texte (titre, adresse) : voir `langues.ts` (« (VF) », « VOSTFR », « Dub », « Sub »…). */
export function detecterLangue(texte: unknown): LangueDetectee {
  return langueDeTexte(texte)?.langue ?? null;
}

/** Mots sans valeur pour reconnaître une oeuvre (format, genre de fiche). */
const NEUTRES = new Set(['tv', 'anime', 'serie', 'series']);
/** Années (« Titre (2023) ») : ni un mot en trop, ni un mot manquant. */
const ANNEE = /^(19[5-9]\d|20[0-4]\d)$/;

/** Article en tête (« La Rivière » = « Rivière »), comme le font souvent les sites. */
const ARTICLES = new Set(['le', 'la', 'les', 'l', 'the']);

/** « Journey's » = « Journeys » (l'apostrophe disparaît souvent sur les sites) ; « L'Attaque » garde son article. */
const sansApostrophe = (valeur: unknown) => String(valeur ?? '').replace(/([A-Za-z0-9])['’`´](?=[A-Za-z]{1,2}\b)/g, '$1');

/** Mots comparés : sans langue, sans format (film/OAV), sans année ni article en tête. */
const motsEtFormat = (valeur: unknown): { mots: string[]; format: boolean } => {
  let format = false;
  const tous = normaliserTexte(sansApostrophe(valeur)).split(' ');
  // « The Movie » : un seul marqueur de format.
  const liste = tous.filter((t, i) => {
    if (FORMATS.has(t) || (t === 'the' && FORMATS.has(tous[i + 1] ?? ''))) {
      format = true;
      return false;
    }
    return t && !BRUIT.has(t) && !NEUTRES.has(t) && !ANNEE.test(t);
  });
  return { mots: liste.length > 1 && ARTICLES.has(liste[0]) ? liste.slice(1) : liste, format };
};
const mots = (valeur: unknown): string[] => motsEtFormat(valeur).mots;

/**
 * Clé d'une SÉRIE, sans marqueur de langue ni d'épisode : « Titre » et
 * « Titre (VF) » ont la même ; « Titre Saison 2 » non (autre saison).
 */
export function cleSerie(titre: unknown): string {
  const nu = sansEpisode(titre);
  const { mots: m, format } = motsEtFormat(nu);
  return `${m.join(' ')}${format ? ' #format' : ''}`;
}

/** Le titre désigne un ÉPISODE (« Titre Épisode 12 VOSTFR »), pas la page de la série. */
export const estTitreDEpisode = (titre: unknown): boolean => normaliserTexte(sansEpisode(titre)) !== normaliserTexte(titre);

/**
 * Pénalité de format : le résultat est un film/OAV et l'oeuvre cherchée non
 * (autre oeuvre : forte), ou l'inverse (le site a omis « film » : faible).
 */
function penaliteFormat(candidat: unknown, cible: unknown): number {
  const c = motsEtFormat(candidat).format;
  const t = motsEtFormat(cible).format;
  return c === t ? 0 : c ? 450 : 100;
}

/** Score « texte contre texte » (titres complets ou titres de base). */
function scorePaire(candidat: unknown, cible: unknown): number {
  const tc = mots(candidat);
  const tt = mots(cible);
  const nc = tc.join(' ');
  const nt = tt.join(' ');
  if (!nc || !nt) {
    return -Infinity;
  }
  let score: number;
  if (nc === nt) {
    score = 1000;
  } else if (nc.startsWith(nt) || nt.startsWith(nc)) {
    score = 700 - Math.abs(tc.length - tt.length) * 30;
  } else {
    const communs = tc.filter(t => tt.includes(t)).length;
    if (!communs) {
      return -Infinity;
    }
    score = 300 * (communs / tt.length);
  }
  return score - tc.filter(t => !tt.includes(t)).length * 150 - penaliteFormat(candidat, cible);
}

const ROMAINS: Record<string, number> = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6 };

/**
 * Saison désignée par un titre : « Saison 2 », « Season 2 », « 2nd Season »,
 * « Part 2 », « Titre II », « Titre 2 ». `null` : aucune (saison 1 implicite).
 */
export function saisonDe(titre: unknown): number | null {
  const t = String(titre ?? '');
  const explicite = /\b(?:saison|season|cour|partie|part)\s*(\d{1,2})\b/i.exec(t) ?? /\b(\d{1,2})(?:st|nd|rd|th|e|eme|ème)\s+(?:season|saison)\b/i.exec(t);
  if (explicite) {
    return Number(explicite[1]);
  }
  const court = /\bs(\d{1,2})\b(?!\s*e\d)/i.exec(t) ?? /\bs(\d{1,2})\s*e\d{1,4}\b/i.exec(t);
  if (court) {
    return Number(court[1]);
  }
  const tete = avantSousTitre(t).replace(/\(\s*(?:19|20)\d\d\s*\)/g, ' ').replace(/\b(?:vf|vostfr|vosta)\b/gi, ' ').trim();
  const romain = /\s(ii|iii|iv|v|vi)\s*$/i.exec(tete);
  if (romain) {
    return ROMAINS[romain[1].toLowerCase()];
  }
  const nombre = /\s(\d{1,2})\s*$/.exec(tete);
  return nombre ? Number(nombre[1]) : null;
}

/** Titre sans marqueur de saison ni année, sous-titre GARDÉ (« Naruto: Shippuden » reste lui-même). */
const LANGUES_TITRE = /[([]?\b(?:vf|vostfr|vosta)\b[)\]]?/gi;

function sansSaison(titre: unknown): string {
  let t = String(titre ?? '').replace(LANGUES_TITRE, ' ').replace(MARQUEURS_SAISON, ' ');
  t = t.replace(/\(\s*(?:19|20)\d\d\s*\)/g, ' ');
  t = t.replace(/\s+\b(?:i{1,3}|iv|v|vi)\b\s*$/i, ' ');
  t = t.replace(/\s+\d+\s*$/, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * Score des titres réduits, corrigé par la saison : « Frieren » trouvé sur le
 * site pour « Frieren: Beyond Journey's End » est la bonne oeuvre (le site a
 * raccourci le titre) ; « Frieren Saison 2 » ne l'est pas pour la saison 1. Le
 * sous-titre n'est retiré que du titre CHERCHÉ : un résultat avec un
 * sous-titre en plus (« Naruto: Shippuden ») reste une autre oeuvre.
 */
function scoreBase(candidat: string, cible: string): number {
  const bc = mots(sansSaison(candidat)).join(' ');
  if (!bc) {
    return -Infinity;
  }
  const egal = [titreDeBase(cible), sansSaison(cible)].some(b => mots(b).join(' ') === bc);
  if (!egal) {
    return -Infinity;
  }
  const sc = saisonDe(candidat);
  const st = saisonDe(cible);
  const format = penaliteFormat(candidat, cible);
  if (sc === st) {
    return 950 - format;
  }
  if ((sc ?? 1) === (st ?? 1)) {
    return 920 - format;
  }
  // La page du site regroupe peut-être toutes les saisons : acceptable, mais derrière une saison exacte.
  if (sc === null) {
    return 620 - format;
  }
  return 400;
}

/**
 * Compare un titre candidat aux titres connus. Un mot EN TROP dans le titre
 * trouve designe presque toujours une autre oeuvre (« One Piece Heroines ») :
 * penalite forte. Un mot MANQUANT reste acceptable (abreviation). Les titres
 * sont aussi compares sans sous-titre ni marqueur de saison (`scoreBase`).
 */
export function scoreTitre(candidat: string, cibles: readonly string[]): number {
  let meilleur = -Infinity;
  // Un résultat « Titre Épisode 12 » désigne la série « Titre » (page d'épisode qui liste les autres).
  const nu = sansEpisode(candidat) || candidat;
  // À ressemblance égale, la page de la série passe devant celle d'un de ses épisodes.
  const episode = normaliserTexte(nu) !== normaliserTexte(candidat) ? 10 : 0;
  for (const cible of cibles) {
    if (!cible) {
      continue;
    }
    meilleur = Math.max(meilleur, scorePaire(nu, cible), scoreBase(nu, cible));
  }
  return meilleur - episode;
}

/** « Mushoku Tensei: Jobless Reincarnation Season 2 Part 2 » -> « Mushoku Tensei ». */
export function titreDeBase(titre: unknown): string {
  let t = String(titre ?? '').replace(LANGUES_TITRE, ' ').replace(MARQUEURS_SAISON, ' ');
  t = avantSousTitre(t);
  t = t.replace(/\(\s*(?:19|20)\d\d\s*\)/g, ' ');
  t = t.replace(/\s+\b(?:i{1,3}|iv|v|vi)\b\s*$/i, ' ');
  t = t.replace(/\s+\d+\s*$/, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/** Nombre maximal de recherches lancées sur une source pour un titre. */
export const MAX_VARIANTES = 8;

/**
 * Titres a essayer dans la recherche d'un site : complets puis reduits, sans
 * doublon. Un titre sans lettre latine (japonais) n'est pas cherche : il ne
 * se compare a rien (8 max).
 */
export function variantesDeRecherche(titres: string | readonly (string | null | undefined)[]): string[] {
  const liste = (Array.isArray(titres) ? titres : [titres]) as (string | null | undefined)[];
  const complets: string[] = [];
  const reduits: string[] = [];
  for (const t of liste) {
    if (!t) {
      continue;
    }
    complets.push(t.trim());
    const base = titreDeBase(t);
    if (base && base.length >= 3) {
      reduits.push(base);
    }
  }
  // Le titre principal et sa forme réduite d'abord, puis les autres titres, puis leurs formes réduites.
  const candidats = [complets[0], reduits[0], ...complets.slice(1), ...reduits.slice(1)].filter(Boolean) as string[];
  const vus = new Set<string>();
  return candidats
    .filter(t => {
      const cle = normaliserTexte(t);
      if (!cle || vus.has(cle)) {
        return false;
      }
      vus.add(cle);
      return true;
    })
    .slice(0, MAX_VARIANTES);
}

/** Au-dessus, la correspondance est sûre : inutile de lancer d'autres recherches. */
export const SCORE_SUR = 900;

export interface ResultatBrut {
  title: string;
  url: string;
  image?: string | null;
  year?: string | null;
}

export interface ResultatClasse extends ResultatBrut {
  language: LangueDetectee;
  /** Score de titre seul (compare au seuil). */
  baseScore: number;
  /** Score avec preference de langue (sert au tri). */
  score: number;
}

export function classerResultats<T extends ResultatBrut>(
  resultats: readonly T[],
  titres: string | readonly (string | null | undefined)[],
  preference: PreferenceLangue = 'indifferent',
): (T & ResultatClasse)[] {
  const cibles = ((Array.isArray(titres) ? titres : [titres]) as (string | null | undefined)[]).filter(Boolean) as string[];
  return resultats
    .map(r => {
      const language = (langueDeTexte(r.title) ?? langueDAdresse(r.url))?.langue ?? null;
      const baseScore = scoreTitre(r.title, cibles);
      let score = baseScore;
      // La preference ne sert qu'a departager deux titres equivalents : elle
      // reste hors du score de reference (seul compare au seuil).
      if (preference === 'vf') {
        score += language === 'vf' ? 60 : -60;
      } else if (preference === 'vostfr') {
        score += language === 'vf' ? -60 : 60;
      }
      return { ...r, language, baseScore: Math.round(baseScore), score: Math.round(score) };
    })
    .sort((a, b) => b.score - a.score);
}

/** Dernier nombre du dernier segment : « shangri-la-frontier-2-25-vf » -> 25. */
export function numeroDepuisAdresse(href: string | null | undefined): number | null {
  if (!href) {
    return null;
  }
  const chemin = String(href).replace(/[?#].*$/, '').replace(/\/+$/, '');
  const slug = chemin.split('/').pop() || '';
  const nombres = slug.match(/\d{1,4}/g);
  return nombres?.length ? Number(nombres[nombres.length - 1]) : null;
}
