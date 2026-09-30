/**
 * Definitions de sources de lecture, pilotees par selecteurs CSS.
 *
 * REGLE : le moteur ne fournit AUCUNE source. La liste par defaut est vide ;
 * c'est l'utilisateur qui branche les sites qu'il a le droit d'utiliser
 * (sa mediatheque, un service dont il detient les droits, un site de
 * diffusion libre...). Les plateformes legales restent proposees par les
 * fiches du catalogue (champ streamingLinks), sans integration.
 *
 * Le format est celui de l'ancien fichier backend/config/sources.json :
 * une source exportee de Tsuzuku se recharge telle quelle.
 */

import { adresseEnTexte, analyserAdresse, hoteDeSite, resoudreAdresse } from './adresse';
import { echec } from './erreurs';
import { verifierUrlPubliqueSync, type OptionsGarde } from './garde';
import { genererIdentifiant, horlogeSysteme, instantDe, type Horloge } from './outils';

export type Langue = 'vf' | 'vostfr' | 'indifferent';
export const LANGUES: readonly Langue[] = ['vf', 'vostfr', 'indifferent'];

export interface SectionRecherche {
  /** Chemin de recherche ; `{query}` est remplace par le titre (encode). */
  path: string;
  /** Chemin distinct pour la VF, si le site separe ses recherches. */
  pathVf: string;
  /** Chemin distinct pour la VOSTFR. */
  pathVostfr: string;
  /** Selecteur d'UN resultat. */
  item: string;
  /** Titre, relatif a `item` (« & » ou vide : le texte de `item`). */
  title: string;
  /** Lien, relatif a `item`. */
  link: string;
  image: string;
  imageAttr: string;
  /** Annee (films), relatif a `item`. */
  year: string;
}

export interface SectionEpisodes {
  item: string;
  number: string;
  title: string;
  link: string;
}

export interface SectionLecteur {
  /** Selecteur des iframes du lecteur. */
  iframe: string;
  attr: string;
  label: string;
  /** Lecteurs proposes dans un menu (<option value="...">). */
  options: string;
  optionAttr: string;
  optionLabel: string;
}

export interface DefinitionSource {
  id: string;
  name: string;
  enabled: boolean;
  baseUrl: string;
  /** Preference de doublage : departage « Titre » et « Titre (VF) ». */
  language: Langue;
  timeout: number;
  userAgent?: string;
  search: SectionRecherche;
  episodes: SectionEpisodes;
  player: SectionLecteur;
  /** Section films : recherche -> page du film -> lecteur. Vide = pas de films. */
  movies: { search: SectionRecherche; player: SectionLecteur };
  createdAt: string;
}

/** Aucune source preconfiguree. */
export const SOURCES_PAR_DEFAUT: readonly DefinitionSource[] = Object.freeze([]);

type Brut = Record<string, unknown> | undefined | null;

const champ = (entree: Brut, existant: Brut, cle: string, defaut = ''): string => {
  const v = entree?.[cle] ?? existant?.[cle] ?? defaut;
  return String(v ?? defaut).trim();
};
const sous = (o: unknown, cle: string): Brut => {
  const v = (o as Record<string, unknown> | null | undefined)?.[cle];
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
};

function recherche(e: Brut, x: Brut): SectionRecherche {
  return {
    path: champ(e, x, 'path'),
    pathVf: champ(e, x, 'pathVf'),
    pathVostfr: champ(e, x, 'pathVostfr'),
    item: champ(e, x, 'item'),
    title: champ(e, x, 'title'),
    link: champ(e, x, 'link', 'a'),
    image: champ(e, x, 'image'),
    imageAttr: champ(e, x, 'imageAttr', 'src'),
    year: champ(e, x, 'year'),
  };
}

function lecteur(e: Brut, x: Brut): SectionLecteur {
  return {
    iframe: champ(e, x, 'iframe'),
    attr: champ(e, x, 'attr', 'src'),
    label: champ(e, x, 'label', 'Lecteur'),
    options: champ(e, x, 'options'),
    optionAttr: champ(e, x, 'optionAttr', 'value'),
    optionLabel: champ(e, x, 'optionLabel'),
  };
}

export interface OptionsNormalisation extends OptionsGarde {
  horloge?: Horloge;
  genererId?: () => string;
}

/**
 * Nettoie une definition (saisie ou importee) en completant par `existante`.
 * L'adresse du site doit etre publique (verification sans DNS).
 */
export function normaliserSource(
  entree: unknown,
  existante: DefinitionSource | null = null,
  options: OptionsNormalisation = {},
): DefinitionSource {
  const e = (entree && typeof entree === 'object' ? entree : {}) as Record<string, unknown>;
  const x = existante as unknown as Record<string, unknown> | null;
  const langue = LANGUES.includes(e.language as Langue) ? (e.language as Langue) : existante?.language ?? 'indifferent';
  const delai = Number(e.timeout ?? existante?.timeout ?? 15000);
  const source: DefinitionSource = {
    id: existante?.id || (typeof e.id === 'string' && e.id.trim() ? e.id.trim().slice(0, 100) : (options.genererId ?? genererIdentifiant)()),
    name: champ(e, x, 'name').slice(0, 120) || 'Sans nom',
    enabled: e.enabled === undefined ? Boolean(existante?.enabled) : Boolean(e.enabled),
    baseUrl: champ(e, x, 'baseUrl'),
    language: langue,
    timeout: Number.isFinite(delai) ? Math.min(60000, Math.max(1000, delai)) : 15000,
    userAgent: champ(e, x, 'userAgent') || undefined,
    search: recherche(sous(e, 'search'), sous(x, 'search')),
    episodes: {
      item: champ(sous(e, 'episodes'), sous(x, 'episodes'), 'item'),
      number: champ(sous(e, 'episodes'), sous(x, 'episodes'), 'number'),
      title: champ(sous(e, 'episodes'), sous(x, 'episodes'), 'title'),
      link: champ(sous(e, 'episodes'), sous(x, 'episodes'), 'link', 'a'),
    },
    player: lecteur(sous(e, 'player'), sous(x, 'player')),
    movies: {
      search: recherche(sous(sous(e, 'movies'), 'search'), sous(sous(x, 'movies'), 'search')),
      player: lecteur(sous(sous(e, 'movies'), 'player'), sous(sous(x, 'movies'), 'player')),
    },
    createdAt: existante?.createdAt || (typeof e.createdAt === 'string' ? e.createdAt : instantDe(options.horloge ?? horlogeSysteme)),
  };
  if (!source.baseUrl) {
    throw echec("L'adresse du site (baseUrl) est requise");
  }
  source.baseUrl = verifierUrlPubliqueSync(source.baseUrl, options);
  return source;
}

/** Une source ne sert aux films que si sa section films est renseignee. */
export function supporteFilms(src: DefinitionSource | null | undefined): boolean {
  return Boolean(src?.movies?.search?.path && src?.movies?.search?.item);
}

/** Une source ne sert aux animes que si sa recherche est renseignee. */
export function supporteAnimes(src: DefinitionSource | null | undefined): boolean {
  return Boolean(src?.search?.path && src?.search?.item);
}

/** Vue « film » : les selecteurs films a la place des animes, sans episodes. */
export function vueFilm(src: DefinitionSource): DefinitionSource {
  return {
    ...src,
    search: src.movies.search,
    player: src.movies.player,
    episodes: { item: '', number: '', title: '', link: 'a' },
  };
}

export function sourcesActives(liste: readonly DefinitionSource[]): DefinitionSource[] {
  return liste.filter(s => s.enabled && s.baseUrl);
}

/** Remplit un gabarit `{cle}` en encodant les valeurs. */
export function remplirGabarit(gabarit: string, variables: Record<string, string | number>): string {
  return String(gabarit || '').replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(String(variables[k] ?? '')));
}

/** Adresse de recherche pour une requete et une langue. */
export function adresseDeRecherche(src: DefinitionSource, requete: string, langue: Langue | null = null): string | null {
  const s = src.search;
  const chemin = langue === 'vf' && s.pathVf ? s.pathVf : langue === 'vostfr' && s.pathVostfr ? s.pathVostfr : s.path;
  return resoudreAdresse(remplirGabarit(chemin, { query: requete }), src.baseUrl);
}

/** Source activee dont le domaine correspond a l'adresse. */
export function sourcePourUrl(liste: readonly DefinitionSource[], url: string): DefinitionSource | null {
  const cible = analyserAdresse(url);
  if (!cible || !cible.hote) {
    return null;
  }
  const hote = hoteDeSite(cible);
  for (const src of sourcesActives(liste)) {
    const base = analyserAdresse(src.baseUrl);
    if (base && hoteDeSite(base) === hote) {
      return src;
    }
  }
  return null;
}

// Gestion de la liste (fonctions pures : renvoient une nouvelle liste).

export function ajouterSource(liste: readonly DefinitionSource[], entree: unknown, options?: OptionsNormalisation) {
  const source = normaliserSource(entree, null, options);
  if (liste.some(s => s.id === source.id)) {
    throw echec('Une source porte deja cet identifiant');
  }
  return { liste: [...liste, source], source };
}

export function modifierSource(liste: readonly DefinitionSource[], id: string, entree: unknown, options?: OptionsNormalisation) {
  const existante = liste.find(s => s.id === id);
  if (!existante) {
    throw echec('Source introuvable', 'introuvable', 404);
  }
  const source = normaliserSource(entree, existante, options);
  return { liste: liste.map(s => (s.id === id ? source : s)), source };
}

export function supprimerSource(liste: readonly DefinitionSource[], id: string): DefinitionSource[] {
  return liste.filter(s => s.id !== id);
}

/** Import d'un ancien sources.json ({ sources: [...] }) : entrees invalides ecartees. */
export function importerSources(brut: unknown, options?: OptionsNormalisation): { sources: DefinitionSource[]; ecartees: number } {
  const liste = Array.isArray((brut as { sources?: unknown })?.sources)
    ? ((brut as { sources: unknown[] }).sources)
    : Array.isArray(brut)
      ? brut
      : [];
  const sources: DefinitionSource[] = [];
  let ecartees = 0;
  for (const e of liste.slice(0, 200)) {
    try {
      const s = normaliserSource(e, null, options);
      if (sources.some(x => x.id === s.id)) {
        ecartees += 1;
      } else {
        sources.push(s);
      }
    } catch {
      ecartees += 1;
    }
  }
  return { sources, ecartees };
}

/** Normalise une adresse relative a la source (null si invalide ou non http). */
export function absolue(href: string | null | undefined, base: string): string | null {
  if (!href) {
    return null;
  }
  const a = analyserAdresse(href, base);
  if (!a || (a.schema !== 'http' && a.schema !== 'https')) {
    return null;
  }
  return adresseEnTexte(a);
}
