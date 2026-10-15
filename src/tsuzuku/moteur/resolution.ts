/**
 * Resolution : d'un titre (episode ou film) jusqu'a un lecteur affichable,
 * soit une page a integrer en iframe, soit un fichier direct (mp4, m3u8,
 * webm). Enchaine recherche, classement, liste d'episodes puis lecteurs,
 * pour chaque source ACTIVEE que l'utilisateur a branchee (aucune par
 * defaut). Portage de l'ancien scrapers/provider.js, sur le client reseau
 * injecte et le lecteur de page JavaScript pur.
 */

import {
  classerResultats,
  cleSerie,
  estTitreDEpisode,
  numeroDepuisAdresse,
  saisonDe,
  SCORE_MINIMAL,
  SCORE_SUR,
  scoreTitre,
  titreDeBase,
  variantesDeRecherche,
  type PreferenceLangue,
  type ResultatBrut,
  type ResultatClasse,
} from './appariement';
import { echec, ErreurMoteur, messageDe, type CodeErreur } from './erreurs';
import { classerMedia, type TypeMedia, urlPubliqueSure } from './garde';
import { choisir, lirePage, sembleRenduEnJs, suggererSelecteurs, texteCompact, texteSepare, texteVisible, type Noeud, type Page } from './lecteurPage';
import { detecterBlocage, messageBlocage, type ClientSur, type ReponseTexte } from './reseau';
import {
  analyserJson,
  baseDePage,
  candidatsGeneriques,
  episodesGeneriques,
  estReponseJson,
  filtrerSaison,
  fragmentHtmlJson,
  lienJson,
  lienSuivant,
  listeAutoJson,
  MAX_CANDIDATS,
  numeroEtSaison,
  redirectionMeta,
  resultatsJson,
  texteJson,
  titresDePage,
  valeurJson,
} from './extraction';
import {
  absolue,
  adresseDeRecherche,
  cheminDeRecherche,
  cheminParSlug,
  corpsDeRecherche,
  slugDe,
  type SectionRecherche,
  sourcePourUrl,
  sourcesActives,
  supporteAnimes,
  supporteFilms,
  vueFilm,
  type DefinitionSource,
  type Langue,
} from './sources';
import { journalMuet, type Journal } from './outils';
import { clientAnnulable, courseAvecPriorite, courseOrdonnee, type SignalAnnulation } from './parallele';
import { analyserAdresse } from './adresse';
import {
  autreLangue,
  LANGUES_VERSION,
  LIBELLE_LANGUE_VERSION,
  langueDeCandidat,
  langueDEpisode,
  langueDObjetJson,
  type LangueLue,
  type LangueVersion,
} from './langues';

export interface Lecteur {
  label: string;
  url: string;
  kind: TypeMedia;
}

export interface EpisodeSource {
  number: number;
  title: string | null;
  url: string;
  /** Langue de l'épisode quand la page la distingue (VF / VOSTFR). */
  langue?: LangueVersion | null;
}

export interface ContexteResolution {
  client: ClientSur;
  journal?: Journal;
  /** Annulation (une autre source ou variante a suffi) : plus aucune requête ne part. */
  signal?: SignalAnnulation;
  /** Parallélisme (défauts : `PARALLELE`) ; `{ variantes: 1, sources: 1 }` = l'ancien parcours séquentiel. */
  parallele?: Partial<ParametresParallele>;
  /**
   * Vrai si le site de cette adresse est CONNU pour être lent (temps mesurés sur
   * l'appareil) : ses variantes de titre partent ensemble, et, s'il est la source
   * prioritaire, les autres sources partent sans l'attendre (la priorité, le délai
   * de grâce et le résultat retenu ne changent pas).
   */
  estLente?: (url: string) => boolean;
}

/** Réglages du parallélisme du moteur. */
export interface ParametresParallele {
  /** Requêtes de recherche en vol au plus, par source (variantes du titre, slugs). */
  variantes: number;
  /** La première variante part seule pendant ce délai (ms) : un site rapide ne reçoit rien d'inutile. */
  relaisMs: number;
  /** Sources cherchées en même temps. */
  sources: number;
  /** La source prioritaire part seule pendant ce délai (ms) : si elle trouve vite, les autres ne sont pas interrogées. */
  relaisSourcesMs: number;
  /**
   * Une source moins prioritaire qui a trouvé attend au plus ce délai (ms) une
   * source plus prioritaire encore en cours, puis l'emporte.
   */
  graceMs: number;
}

export const PARALLELE: ParametresParallele = { variantes: 3, relaisMs: 600, sources: 3, relaisSourcesMs: 1000, graceMs: 1200 };

const parametresParallele = (ctx: ContexteResolution): ParametresParallele => ({ ...PARALLELE, ...ctx.parallele });

/** Source connue pour être lente (voir `ContexteResolution.estLente`). */
const sourceLente = (ctx: ContexteResolution, src?: Pick<DefinitionSource, 'baseUrl'>) => {
  try {
    return Boolean(src?.baseUrl && ctx.estLente?.(src.baseUrl));
  } catch {
    return false;
  }
};

/** Contexte d'une tâche annulable : même client, mais plus rien ne part après l'annulation. */
const sousContexte = (ctx: ContexteResolution, signal: SignalAnnulation): ContexteResolution => ({ ...ctx, client: clientAnnulable(ctx.client, signal), signal });

const journalDe = (c: ContexteResolution) => c.journal ?? journalMuet;

/** Referer d'une source : sa page d'accueil (certains sites refusent une requête sans). */
const refererDe = (src?: Pick<DefinitionSource, 'baseUrl'>) => (src?.baseUrl ? `${src.baseUrl.replace(/\/+$/, '')}/` : undefined);

/** Page lue : arbre, HTML, adresse finale (redirections et `<meta refresh>` suivis), base des liens relatifs. */
interface PageLue {
  page: Page;
  html: string;
  url: string;
  base: string;
  rep: ReponseTexte;
}

async function chargerPage(client: ClientSur, url: string, src?: Pick<DefinitionSource, 'timeout' | 'userAgent' | 'baseUrl'>): Promise<PageLue> {
  let cible = url;
  for (let saut = 0; ; saut += 1) {
    const rep = await client.texte(cible, { delaiMs: src?.timeout, agentUtilisateur: src?.userAgent, referer: refererDe(src), cache: 'page' });
    const page = lirePage(rep.corps);
    const final = rep.url || cible;
    // Miroir ou « le site a déménagé » annoncé par <meta http-equiv="refresh"> (page courte) : suivi deux fois au plus.
    const meta = saut < 2 && texteVisible(page.racine).length < 1500 ? redirectionMeta(page, final) : null;
    if (meta && meta !== final) {
      cible = meta;
      continue;
    }
    return { page, html: rep.corps, url: final, base: baseDePage(page, final), rep };
  }
}

/** Ce qu'une recherche a vu (diagnostic détaillé, exportable). */
export interface DetailRequete {
  /** Adresse demandée (secrets masqués à l'export). */
  url: string | null;
  methode: 'GET' | 'POST';
  /** Adresse finale après redirections (miroir). */
  urlFinale?: string;
  statut?: number;
  typeContenu?: string | null;
  octets?: number;
  ms?: number;
  /** Réponse JSON (API) reconnue. */
  json?: boolean;
  /** Page construite en JavaScript (SPA) : le HTML brut n'a pas de résultats. */
  renduJs?: boolean;
  /** Protection anti-robot reconnue. */
  blocage?: string;
  /** Comment les résultats ont été lus. */
  extraction?: 'selecteurs' | 'json' | 'json-html' | 'generique' | 'page' | 'aucune';
  /** Éléments trouvés par le sélecteur `item` configuré. */
  blocs?: number;
  /** Candidats extraits (titre + lien). */
  candidats: number;
  erreur?: string;
  code?: string;
}

/** Une ligne de recherche (une requête sur une source). */
function ligneDepuis(page: Page, el: Noeud, sel: SectionRecherche, base: string): ResultatBrut | null {
  const titreSel = choisir(page, el, sel.title || '&');
  const lienEl = sel.link && sel.link !== '&' ? page.premier(el, sel.link) : el.name === 'a' ? el : page.premier(el, 'a[href]');
  // Titre absent : attribut title, alt de l'image, data-title (cartes réduites à une image).
  const titre =
    titreSel ||
    (lienEl && (page.attr(lienEl, 'title') || page.attr(lienEl, 'data-title'))) ||
    page.attr(el, 'title') ||
    page.attr(el, 'data-title') ||
    (page.dans(el, 'img[alt]')[0] ? page.attr(page.dans(el, 'img[alt]')[0], 'alt') : null);
  const lien = lienEl ? page.attr(lienEl, 'href') || page.attr(lienEl, 'data-href') || page.attr(lienEl, 'data-url') : page.attr(el, 'data-href') || page.attr(el, 'data-url');
  const adresse = absolue(sel.linkFormat && lien ? sel.linkFormat.replace(/\{value\}/g, lien) : lien, base);
  if (!titre || !adresse) {
    return null;
  }
  const image = absolue(choisir(page, el, sel.image, sel.imageAttr || 'src'), base);
  return { title: titre.replace(/\s+/g, ' ').trim(), url: adresse, image, year: choisir(page, el, sel.year) };
}

/** Lignes de résultats lues par les sélecteurs CSS de la source. */
function lignesCss(page: Page, sel: SectionRecherche, base: string): { resultats: ResultatBrut[]; blocs: number } {
  if (!sel.item) {
    return { resultats: [], blocs: 0 };
  }
  const blocs = page.tous(sel.item);
  return { resultats: blocs.map(el => ligneDepuis(page, el, sel, base)).filter((r): r is ResultatBrut => r !== null), blocs: blocs.length };
}

export interface OptionsRecherche {
  langue?: Langue | null;
  /** Slug imposé (variantes `{slug}`). */
  slug?: string;
  /** Titres voulus : choisissent le meilleur titre d'une page atteinte par `{slug}`. */
  cibles?: readonly string[];
}

/**
 * Une recherche sur une source, avec tout ce qu'elle a vu : statut HTTP, type
 * de contenu, taille, SPA, anti-robot, JSON, nombre de candidats. Ne lève pas :
 * une erreur est rendue dans `detail.erreur` (`code` : anti-robot, garde…).
 *
 * Lecture : sélecteurs CSS configurés ; API JSON (`type: json`, chemins) ;
 * JSON reçu à la place d'une page (repérage automatique, fragment HTML) ; puis,
 * si rien n'est lisible, extraction GÉNÉRIQUE (JSON-LD, cartes, liens titrés).
 * `{slug}` : l'adresse est la page de l'oeuvre elle-même (404 = pas de résultat).
 */
export async function chercherSurDetail(
  ctx: ContexteResolution,
  src: DefinitionSource,
  requete: string,
  o: OptionsRecherche = {},
): Promise<{ resultats: ResultatBrut[]; detail: DetailRequete }> {
  const sel = src.search;
  const methode = sel.method === 'POST' ? 'POST' : 'GET';
  const url = sel.path ? adresseDeRecherche(src, requete, o.langue ?? null, o.slug) : null;
  const detail: DetailRequete = { url, methode, candidats: 0 };
  if (!url) {
    return { resultats: [], detail: { ...detail, erreur: 'Chemin de recherche (search.path) vide ou invalide.', code: 'configuration' } };
  }
  const parSlug = cheminParSlug(cheminDeRecherche(src, o.langue ?? null));
  let rep: ReponseTexte;
  try {
    const appel = { delaiMs: src.timeout, agentUtilisateur: src.userAgent, referer: refererDe(src), entetes: sel.type === 'json' ? { accept: 'application/json, text/javascript, */*;q=0.1' } : undefined, cache: 'recherche' as const };
    rep = methode === 'POST' ? await ctx.client.envoyerFormulaire(url, corpsDeRecherche(src, requete, o.slug), appel) : await ctx.client.obtenir(url, appel);
  } catch (err) {
    return { resultats: [], detail: { ...detail, erreur: messageDe(err), code: err instanceof ErreurMoteur ? err.code : 'reseau' } };
  }
  Object.assign(detail, { urlFinale: rep.url !== url ? rep.url : undefined, statut: rep.statut, typeContenu: rep.typeContenu, octets: rep.octets, ms: rep.ms });
  const blocage = detecterBlocage(rep);
  if (blocage) {
    return { resultats: [], detail: { ...detail, blocage: blocage.indice, erreur: messageBlocage(blocage), code: 'anti-robot' } };
  }
  if (rep.statut === 404 || rep.statut === 410) {
    // Page de l'oeuvre absente (slug) ou recherche sans résultat qui répond 404 : pas une panne.
    return { resultats: [], detail: { ...detail, extraction: 'aucune' } };
  }
  if (rep.statut >= 400) {
    return { resultats: [], detail: { ...detail, erreur: `Le site a répondu ${rep.statut}${rep.statut === 405 ? ' (méthode refusée : GET ou POST ?)' : ''}`, code: 'service' } };
  }
  const base0 = rep.url || url;
  const json = estReponseJson(rep.typeContenu, rep.corps) ? analyserJson(rep.corps) : undefined;
  detail.json = json !== undefined;
  let resultats: ResultatBrut[] = [];
  if (json !== undefined) {
    const fragment = sel.htmlPath ? valeurJson(json, sel.htmlPath) : sel.type === 'json' ? undefined : fragmentHtmlJson(json);
    if (typeof fragment === 'string' && fragment.trim()) {
      const page = lirePage(fragment);
      const css = lignesCss(page, sel, base0);
      detail.blocs = css.blocs;
      resultats = css.resultats;
      if (!resultats.length) {
        resultats = candidatsGeneriques(page, base0, src.baseUrl);
      }
      detail.extraction = 'json-html';
    } else {
      resultats = resultatsJson(json, sel.type === 'json' ? sel : { ...sel, item: '', title: '', link: '', image: '', year: '' }, src.baseUrl);
      detail.extraction = 'json';
    }
  } else {
    const page = lirePage(rep.corps);
    const base = baseDePage(page, base0);
    detail.renduJs = sembleRenduEnJs(page);
    if (parSlug) {
      // La page EST l'oeuvre : son titre (og:title, h1, <title>) est le candidat.
      const titres = titresDePage(page);
      const meilleur = o.cibles?.length ? [...titres].sort((a, b) => scoreTitre(b, o.cibles!) - scoreTitre(a, o.cibles!))[0] : titres[0];
      resultats = meilleur ? [{ title: meilleur, url: base0 }] : [];
      detail.extraction = 'page';
    } else {
      const css = lignesCss(page, sel, base);
      detail.blocs = css.blocs;
      resultats = css.resultats;
      detail.extraction = 'selecteurs';
      if (!resultats.length) {
        resultats = candidatsGeneriques(page, base, src.baseUrl);
        detail.extraction = resultats.length ? 'generique' : 'aucune';
      }
    }
  }
  const vus = new Set<string>();
  resultats = resultats.filter(r => !vus.has(r.url) && Boolean(vus.add(r.url))).slice(0, MAX_CANDIDATS);
  detail.candidats = resultats.length;
  return { resultats, detail };
}

/** Resultats d'une recherche sur une source (titre + lien, adresses absolues). Lève en cas d'erreur. */
export async function chercherSur(
  ctx: ContexteResolution,
  src: DefinitionSource,
  requete: string,
  langue: Langue | null = null,
): Promise<ResultatBrut[]> {
  if (!src.search.path || !supporteAnimes(src)) {
    return [];
  }
  const { resultats, detail } = await chercherSurDetail(ctx, src, requete, { langue });
  if (detail.erreur) {
    throw echec(detail.erreur, (detail.code as CodeErreur) || 'service', detail.code === 'anti-robot' ? 403 : 502);
  }
  return resultats;
}

// ---------------------------------------------------------------------------
// Episodes
// ---------------------------------------------------------------------------

/** Au-delà, un « numéro » est un nombre mal lu (dates ou chiffres collés), pas un épisode. */
const NUMERO_MAX = 5000;
const plausible = (n: number | null | undefined): number | null => (n != null && Number.isFinite(n) && n >= 0 && n <= NUMERO_MAX ? n : null);

/**
 * Numéro d'un bloc d'épisode : sélecteur `number` (le numéro DANS son texte :
 * « Épisode 03 », « S1 E2 », « 03 » — jamais tous les chiffres collés, qui
 * faisaient de « Saison 1 - Épisode 1 » l'épisode 11), sinon texte du bloc,
 * attribut title, puis adresse.
 */
function numeroEpisode(page: Page, el: Noeud, src: DefinitionSource, href: string | null, titres: readonly string[], lien: Noeud | null): number | null {
  const cibleNumero = src.episodes.number ? page.premier(el, src.episodes.number) : null;
  const brut = cibleNumero ? texteSepare(cibleNumero) : null;
  if (brut) {
    const lu = plausible(numeroEtSaison(brut, '', { libre: true, titres })?.number);
    if (lu != null) {
      return lu;
    }
  }
  const texteLien = lien && lien !== el ? texteSepare(lien) : '';
  const texte = texteSepare(el);
  const titre = (lien && page.attr(lien, 'title')) || '';
  // Le texte du LIEN d'abord (« Épisode 1 ») : le bloc porte aussi dates et mentions.
  const generique =
    (texteLien ? numeroEtSaison(texteLien, href ?? '') : null) ??
    numeroEtSaison(texte, href ?? '') ??
    (titre ? numeroEtSaison(titre, '') : null) ??
    numeroEtSaison(texteLien || texte, '', { libre: true, titres });
  return plausible(generique?.number) ?? plausible(numeroDepuisAdresse(href));
}

/** Les menus de navigation sont souvent des <li> : l'accueil ne doit pas devenir « l'episode 1 ». */
function estLienDeNavigation(url: string | null, base: string, serie: string | null): boolean {
  if (!url) {
    return true;
  }
  const cible = analyserAdresse(url);
  const racine = analyserAdresse(base);
  if (!cible || !racine) {
    return true;
  }
  if (`${cible.schema}://${cible.hote}:${cible.port}` !== `${racine.schema}://${racine.hote}:${racine.port}`) {
    return false;
  }
  const chemin = cible.chemin.replace(/\/+$/, '');
  if (!chemin || chemin === '/') {
    return true;
  }
  if (serie) {
    const s = analyserAdresse(serie);
    if (s && s.hote === cible.hote && s.chemin.replace(/\/+$/, '') === chemin && s.requete === cible.requete) {
      return true;
    }
  }
  return false;
}

/** Pages d'une liste d'épisodes paginée lues au plus. */
export const PAGES_EPISODES_MAX = 6;

/** Ce que la lecture des épisodes a vu (diagnostic). */
export interface DetailEpisodes {
  pages: number;
  extraction: 'selecteurs' | 'json' | 'generique' | 'aucune';
  /** Éléments trouvés par `episodes.item` sur la première page. */
  blocs: number;
  renduJs?: boolean;
  /** Saison gardée quand la page en mêle plusieurs. */
  saison?: number | null;
  /** Numéros finalement retenus, triés (« épisodes trouvés : 1–3 »). */
  numeros?: number[];
  /**
   * Comment les numéros ont été obtenus : lus dans le texte/l'adresse, déduits
   * de l'ordre de la liste (aucun lisible), ou les deux (trous comblés).
   */
  numerotation?: 'lue' | 'ordre' | 'mixte';
  /** Blocs lus (20 au plus) : numéro lu, langue lue, texte et adresse d'origine, pour voir un écart. */
  lus?: Array<{ numero: number | null; texte: string; url: string; langue?: LangueVersion | null }>;
  /**
   * Langues lues sur la page : nombre de blocs marqués VF, VOSTFR, sans
   * marqueur ; `separees` : la page propose les deux (listes séparées) ;
   * `presumee` : langue déduite des blocs SANS marqueur (à côté de blocs
   * marqués de l'autre langue) ; `page` : la page entière est dans une langue.
   */
  langues?: { vf: number; vostfr: number; inconnue: number; separees: boolean; presumee?: LangueVersion; page?: LangueLue | null };
}

type Collecte = { number: number | null; title: string | null; url: string; saison: number | null; texte?: string; langue: LangueVersion | null; indiceLangue?: string };

/** Blocs gardés dans le diagnostic. */
const LUS_MAX = 20;

/** Épisodes d'UNE page : JSON (chemins), sélecteurs CSS, puis repérage générique. */
function episodesDePage(src: DefinitionSource, lue: PageLue, urlSerie: string, titres: readonly string[]): { collectes: Collecte[]; extraction: DetailEpisodes['extraction']; blocs: number } {
  const ep = src.episodes;
  const json = estReponseJson(lue.rep.typeContenu, lue.html) ? analyserJson(lue.html) : undefined;
  if (json !== undefined) {
    const liste = valeurJson(json, ep.type === 'json' ? ep.item : '') ;
    const objets = (Array.isArray(liste) ? liste : listeAutoJson(json) ?? []).filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object');
    const collectes = objets
      .map(o => {
        const url = lienJson(o, ep.link, ep.linkFormat, lue.url);
        const brut = texteJson(valeurJson(o, ep.number || 'number')) ?? texteJson(o.episode) ?? texteJson(o.ep);
        const n = brut ? plausible(numeroEtSaison(brut, '', { libre: true })?.number) : null;
        const titre = texteJson(valeurJson(o, ep.title || 'title'));
        const l = langueDObjetJson(o, url);
        const c: Collecte | null = url ? { number: n ?? plausible(numeroDepuisAdresse(url)), title: titre, url, saison: null, texte: brut ?? titre ?? '', langue: l?.langue ?? null, indiceLangue: l?.indice } : null;
        return c;
      })
      .filter((x): x is Collecte => x !== null);
    return { collectes, extraction: 'json', blocs: objets.length };
  }
  const { page, base } = lue;
  const blocs = ep.item ? page.tous(ep.item) : [];
  const collectes: Collecte[] = [];
  for (const el of blocs) {
    const lien = ep.link && ep.link !== '&' ? page.premier(el, ep.link) : el.name === 'a' ? el : page.premier(el, 'a[href]') ?? el;
    const href = lien ? page.attr(lien, 'href') || page.attr(lien, 'data-href') || page.attr(lien, 'data-url') || (lien.name === 'option' ? page.attr(lien, 'value') : null) : null;
    const abs = absolue(href && ep.linkFormat ? ep.linkFormat.replace(/\{value\}/g, href) : href, base);
    if (!abs || estLienDeNavigation(abs, src.baseUrl, urlSerie)) {
      continue;
    }
    const texte = texteSepare(el);
    const saison = numeroEtSaison(texte, abs)?.saison ?? null;
    const l = langueDEpisode(texte, abs, page, el);
    collectes.push({ number: numeroEpisode(page, el, src, abs, titres, lien), title: choisir(page, el, ep.title), url: abs, saison, texte, langue: l?.langue ?? null, indiceLangue: l?.indice });
  }
  if (collectes.length) {
    return { collectes, extraction: 'selecteurs', blocs: blocs.length };
  }
  const generiques = episodesGeneriques(page, base, src.baseUrl, urlSerie).filter(e => !estLienDeNavigation(e.url, src.baseUrl, urlSerie));
  return { collectes: generiques.map(g => ({ ...g, texte: g.title ?? '', langue: g.langue ?? null })), extraction: generiques.length ? 'generique' : 'aucune', blocs: blocs.length };
}

/**
 * Lit la liste d'episodes d'une page de serie, triee par numero : sélecteurs
 * configurés, API JSON, sinon repérage générique (« Épisode N », « EP N »,
 * « E01 », « S2E03 », « 第N話 », numéro en fin d'adresse). Suit la pagination
 * (rel=next, « Suivant », `episodes.next`) et garde la saison voulue quand la
 * page en mêle plusieurs.
 */
export interface LectureEpisodes {
  episodes: EpisodeSource[];
  detail: DetailEpisodes;
  /** La page propose les deux langues : les épisodes de chacune (numérotés séparément). */
  parLangue?: Partial<Record<LangueVersion, EpisodeSource[]>>;
  /** Langue des épisodes rendus (`episodes`) quand la page la dit ; null sinon. */
  langue: LangueLue | null;
}

/** Une liste (une langue) : saison gardée, numéros complétés par l'ordre, doublons de numéro retirés. */
function numeroterListe(liste: Collecte[], saison: number | null | undefined) {
  const saisons = filtrerSaison(liste, saison ?? null);
  const { numeros, numerotation } = numeroterParOrdre(saisons.map(e => e.number));
  const numerotes: EpisodeSource[] = [];
  saisons.forEach((e, i) => {
    const n = numeros[i];
    if (n != null) numerotes.push({ number: n, title: e.title, url: e.url, langue: e.langue });
  });
  // Un même numéro deux fois (doublon de liste) : le premier est gardé.
  const vus = new Set<number>();
  const episodes = numerotes.sort((x, y) => x.number - y.number).filter(e => !vus.has(e.number) && Boolean(vus.add(e.number)));
  return {
    episodes,
    saisonGardee: saisons.length !== liste.length ? saisons[0]?.saison ?? null : undefined,
    numerotation: saisons.length ? numerotation : undefined,
    lus: saisons.length ? saisons.slice(0, LUS_MAX).map(e => ({ numero: e.number, texte: (e.texte || e.title || '').slice(0, 80), url: e.url, ...(e.langue ? { langue: e.langue } : {}) })) : undefined,
  };
}

/**
 * Langues des blocs d'une page : deux listes quand la page propose VF ET
 * VOSTFR (onglets, sections, marqueurs) ; des blocs sans marqueur à côté de
 * blocs marqués d'UNE langue, aux mêmes numéros, sont présumés de l'autre
 * (« Épisode 1 », « Épisode 1 VF ») ; sinon une seule liste.
 */
function grouperParLangue(toutes: Collecte[]): { groupes: Partial<Record<LangueVersion, Collecte[]>> | null; presumee?: LangueVersion; comptes: { vf: number; vostfr: number; inconnue: number } } {
  const comptes = { vf: 0, vostfr: 0, inconnue: 0 };
  for (const c of toutes) comptes[c.langue ?? 'inconnue'] += 1;
  if (comptes.vf && comptes.vostfr) {
    return { groupes: { vf: toutes.filter(c => c.langue === 'vf'), vostfr: toutes.filter(c => c.langue === 'vostfr') }, comptes };
  }
  const marquee: LangueVersion | null = comptes.vf ? 'vf' : comptes.vostfr ? 'vostfr' : null;
  if (marquee && comptes.inconnue) {
    const m = toutes.filter(c => c.langue === marquee);
    const i = toutes.filter(c => !c.langue);
    const nums = new Set(i.map(c => c.number).filter(n => n != null));
    if (m.some(c => c.number != null && nums.has(c.number))) {
      const presumee = autreLangue(marquee);
      const indice = `présumée : bloc sans marqueur, à côté de blocs « ${LIBELLE_LANGUE_VERSION[marquee]} » aux mêmes numéros`;
      return { groupes: { [marquee]: m, [presumee]: i.map(c => ({ ...c, langue: presumee, indiceLangue: indice })) }, presumee, comptes };
    }
  }
  return { groupes: null, comptes };
}

/**
 * Lit la liste d'episodes d'une page de serie, triee par numero : sélecteurs
 * configurés, API JSON, sinon repérage générique (« Épisode N », « EP N »,
 * « E01 », « S2E03 », « 第N話 », numéro en fin d'adresse). Suit la pagination
 * (rel=next, « Suivant », `episodes.next`) et garde la saison voulue quand la
 * page en mêle plusieurs. Une page qui propose VF ET VOSTFR rend les deux
 * listes (`parLangue`) ; `episodes` est celle de la langue voulue.
 */
export async function lireEpisodesDetail(
  ctx: ContexteResolution,
  src: DefinitionSource,
  urlSerie: string,
  o: { saison?: number | null; titres?: readonly string[]; langue?: PreferenceLangue | null } = {},
): Promise<LectureEpisodes> {
  const detail: DetailEpisodes = { pages: 0, extraction: 'aucune', blocs: 0 };
  const toutes: Collecte[] = [];
  const pagesVues = new Set<string>();
  let adresse: string | null = urlSerie;
  while (adresse && detail.pages < PAGES_EPISODES_MAX && !pagesVues.has(adresse)) {
    pagesVues.add(adresse);
    let lue: PageLue;
    try {
      lue = await chargerPage(ctx.client, adresse, src);
    } catch (err) {
      if (detail.pages === 0) {
        throw err;
      }
      break;
    }
    detail.pages += 1;
    const r = episodesDePage(src, lue, urlSerie, o.titres ?? []);
    if (detail.pages === 1) {
      detail.extraction = r.extraction;
      detail.blocs = r.blocs;
      detail.renduJs = sembleRenduEnJs(lue.page);
    }
    const nouveaux = r.collectes.filter(c => !toutes.some(t => t.url === c.url));
    if (detail.pages > 1 && !nouveaux.length) {
      break;
    }
    toutes.push(...nouveaux);
    adresse = r.extraction === 'json' ? null : lienSuivant(lue.page, lue.base, src.episodes.next || undefined);
  }
  const { groupes, presumee, comptes } = grouperParLangue(toutes);
  const appliquer = (n: ReturnType<typeof numeroterListe>) => {
    if (n.saisonGardee !== undefined) detail.saison = n.saisonGardee;
    if (n.numerotation) detail.numerotation = n.numerotation;
    if (n.lus) detail.lus = n.lus;
    detail.numeros = n.episodes.map(e => e.number);
  };
  if (groupes) {
    const parLangue: Partial<Record<LangueVersion, EpisodeSource[]>> = {};
    const lectures: Partial<Record<LangueVersion, ReturnType<typeof numeroterListe>>> = {};
    for (const l of LANGUES_VERSION) {
      if (groupes[l]?.length) {
        lectures[l] = numeroterListe(groupes[l]!, o.saison);
        parLangue[l] = lectures[l]!.episodes;
      }
    }
    // Langue rendue : celle voulue, sinon celle du premier bloc de la page.
    const premiere = toutes.find(c => c.langue)?.langue ?? 'vostfr';
    const voulue: LangueVersion = o.langue === 'vf' || o.langue === 'vostfr' ? o.langue : premiere;
    const courante: LangueVersion = parLangue[voulue]?.length ? voulue : autreLangue(voulue);
    appliquer(lectures[courante]!);
    const indice = groupes[courante]?.find(c => c.indiceLangue)?.indiceLangue ?? 'blocs de la page';
    detail.langues = { ...comptes, separees: true, presumee, page: null };
    return { episodes: parLangue[courante] ?? [], detail, parLangue, langue: { langue: courante, indice } };
  }
  const n = numeroterListe(toutes, o.saison);
  appliquer(n);
  // Une seule langue marquée, et au moins autant de blocs marqués que de blocs muets : la page est dans cette langue.
  const marquee: LangueVersion | null = comptes.vf ? 'vf' : comptes.vostfr ? 'vostfr' : null;
  const page: LangueLue | null =
    marquee && comptes[marquee] >= comptes.inconnue ? { langue: marquee, indice: `épisodes marqués « ${LIBELLE_LANGUE_VERSION[marquee]} » (${toutes.find(c => c.langue)?.indiceLangue ?? 'page'})` } : null;
  if (comptes.vf || comptes.vostfr) {
    detail.langues = { ...comptes, separees: false, page };
  }
  return { episodes: page ? n.episodes.map(e => ({ ...e, langue: page.langue })) : n.episodes, detail, langue: page };
}

/**
 * Numéros manquants déduits de l'ORDRE de la liste. Aucun numéro lisible : la
 * liste est supposée aller du plus récent au plus ancien (cas le plus courant),
 * donc numérotée N…1. Quelques trous : sens de la liste (croissant ou
 * décroissant) lu sur les numéros connus, puis chaque trou reçoit le numéro de
 * son plus proche voisin connu, décalé de la distance (s'il est libre et > 0).
 */
export function numeroterParOrdre(lus: ReadonlyArray<number | null>): { numeros: Array<number | null>; numerotation: 'lue' | 'ordre' | 'mixte' } {
  const connus = lus.map((n, i) => [n, i] as const).filter((x): x is readonly [number, number] => x[0] != null);
  if (!connus.length) {
    return { numeros: lus.map((_, i) => lus.length - i), numerotation: 'ordre' };
  }
  if (connus.length === lus.length) {
    return { numeros: [...lus], numerotation: 'lue' };
  }
  let montees = 0;
  let descentes = 0;
  for (let k = 1; k < connus.length; k += 1) {
    if (connus[k][0] > connus[k - 1][0]) montees += 1;
    else if (connus[k][0] < connus[k - 1][0]) descentes += 1;
  }
  const sens = descentes > montees ? -1 : 1;
  const pris = new Set(connus.map(x => x[0]));
  const numeros = [...lus];
  numeros.forEach((n, i) => {
    if (n != null) return;
    const voisin = [...connus].sort((a, b) => Math.abs(a[1] - i) - Math.abs(b[1] - i))[0];
    const deduit = voisin[0] + (i - voisin[1]) * sens;
    if (deduit > 0 && !pris.has(deduit)) {
      numeros[i] = deduit;
      pris.add(deduit);
    }
  });
  return { numeros, numerotation: 'mixte' };
}

/** Lit la liste d'episodes d'une page de serie, triee par numero. */
export async function lireEpisodes(ctx: ContexteResolution, src: DefinitionSource, urlSerie: string, o: { saison?: number | null; titres?: readonly string[] } = {}): Promise<EpisodeSource[]> {
  return (await lireEpisodesDetail(ctx, src, urlSerie, o)).episodes;
}

export interface OptionsEpisodes {
  titres: readonly string[];
  /**
   * Une source moins prioritaire a trouvé pendant que les plus prioritaires
   * cherchent encore : son résultat, PROVISOIRE (affichage progressif).
   */
  surProvisoire?: (r: ResultatEpisodes) => void;
  /** Adresse de serie deja connue : saute la recherche. */
  url?: string | null;
  langue?: PreferenceLangue | null;
}

/** Une recherche lancée sur une source, pour le diagnostic affiché. */
export interface RequeteDiagnostic extends Partial<Omit<DetailRequete, 'url' | 'candidats' | 'erreur'>> {
  requete: string;
  url: string | null;
  resultats: number;
  erreur?: string;
}

/** Pourquoi une source donne (ou ne donne pas) le titre. */
export type StatutSource = 'ok' | 'erreur' | 'bloquee' | 'titre-introuvable' | 'aucun-resultat' | 'aucun-episode' | 'non-configuree' | 'interrompue';

/** Un candidat comparé au titre (diagnostic : les meilleurs). */
export interface CandidatCompare {
  title: string;
  url: string;
  score: number;
  /** Langue lue sur le candidat (titre ou adresse), null : non marquée. */
  langue?: LangueVersion | null;
}

/** Une version (langue) d'une série sur une source. */
export interface VarianteLangue {
  langue: LangueVersion;
  /** Page de la série dans cette langue (vide tant que `aChercher`). */
  url: string;
  title: string;
  /** Pourquoi cette langue : « « (VF) » dans le titre », « onglet « VF » »… */
  indice: string;
  /** Langue déduite (fiche sans marqueur à côté d'une fiche marquée), pas lue. */
  presumee?: boolean;
  /** Épisodes déjà lus ; absent : la page se lit à la demande. */
  episodes?: EpisodeSource[];
  detail?: DetailEpisodes;
  /** La source a une recherche dédiée à cette langue (search.pathVf / pathVostfr) : à lancer à la demande. */
  aChercher?: boolean;
  /** Lecture à la demande déjà tentée sans succès : pourquoi. */
  echec?: string;
}

/** Langues d'une série sur une source : celle des épisodes rendus, les autres, et pourquoi une manque. */
export interface LanguesSerie {
  /** Langue des épisodes rendus ; null : la source ne la distingue pas. */
  courante: LangueVersion | null;
  variantes: Partial<Record<LangueVersion, VarianteLangue>>;
  /** Pourquoi une langue est indisponible, en clair. */
  absentes: Partial<Record<LangueVersion, string>>;
}

/** Résumé sérialisable (diagnostic) : sans les listes d'épisodes. */
export interface LanguesDiagnostic {
  courante: LangueVersion | null;
  variantes: Array<{ langue: LangueVersion; title: string; url: string; indice: string; presumee?: boolean; episodes?: number; aChercher?: boolean; echec?: string }>;
  absentes: Partial<Record<LangueVersion, string>>;
}

export const resumerLangues = (l: LanguesSerie): LanguesDiagnostic => ({
  courante: l.courante,
  variantes: LANGUES_VERSION.filter(x => l.variantes[x]).map(x => {
    const v = l.variantes[x]!;
    return { langue: x, title: v.title, url: v.url, indice: v.indice, ...(v.presumee ? { presumee: true } : {}), ...(v.episodes ? { episodes: v.episodes.length } : {}), ...(v.aChercher ? { aChercher: true } : {}), ...(v.echec ? { echec: v.echec } : {}) };
  }),
  absentes: { ...l.absentes },
});

export interface DiagnosticSource {
  source: string;
  sourceId: string;
  statut: StatutSource;
  requetes: RequeteDiagnostic[];
  /** Résultat retenu (titre, adresse, score). */
  serie: { title: string; url: string; score: number } | null;
  /** Meilleur résultat écarté faute de ressemblance. */
  refuse: { title: string; url: string; score: number } | null;
  episodes: number;
  erreur?: string;
  /** Les meilleurs candidats, avec leur score de ressemblance (3 au plus). */
  meilleurs?: CandidatCompare[];
  /** Pourquoi rien n'est retenu, en clair. */
  raison?: string;
  /** Lecture de la page de la série. */
  lectureEpisodes?: DetailEpisodes;
  /** Langues trouvées (VF / VOSTFR) et pourquoi une manque. */
  langues?: LanguesDiagnostic;
  /** Durées (ms) : recherche sur la source, lecture de la page des épisodes. */
  ms?: { recherche?: number; episodes?: number };
}

export interface ResultatEpisodes {
  episodes: EpisodeSource[];
  source: DefinitionSource | null;
  serie: ResultatClasse | null;
  /** Meilleur candidat ecarte faute de score : explique pourquoi rien n'est lu. */
  refuse: ResultatClasse | null;
  /** Une entrée par source essayée, dans l'ordre. */
  diagnostics: DiagnosticSource[];
  /** Langues de la série sur la source retenue (VF / VOSTFR), variantes à lire à la demande. */
  langues?: LanguesSerie;
}

export interface RechercheSerie {
  serie: ResultatClasse | null;
  refuse: ResultatClasse | null;
  requetes: RequeteDiagnostic[];
  /** Toutes les recherches ont échoué (réseau, garde, sélecteur) : la dernière erreur. */
  erreur?: string;
  /** Code de cette erreur (anti-robot, cookies, garde, délai…). */
  code?: string;
  meilleurs: CandidatCompare[];
  /** Fiches de la MÊME série par langue (« Titre » et « Titre (VF) »). */
  langues: VariantesRecherche;
}

/** Candidats d'une même série, un par langue. */
export interface VariantesRecherche {
  variantes: Partial<Record<LangueVersion, VarianteLangue>>;
}

/**
 * Regroupe les candidats de la MÊME série (même titre hors marqueur de langue
 * et d'épisode, ressemblance suffisante) et garde le meilleur par langue.
 * Une fiche SANS marqueur à côté d'une fiche marquée d'une seule langue est
 * présumée de l'autre (« Titre » + « Titre (VF) » : « Titre » = VOSTFR), et
 * dite présumée. Aucun marqueur : la langue déclarée par la source, sinon rien.
 */
export function variantesDeLangue(classes: readonly ResultatClasse[], serie: ResultatClasse | null, langueSource?: Langue | null): VariantesRecherche {
  const variantes: Partial<Record<LangueVersion, VarianteLangue>> = {};
  if (!serie) {
    return { variantes };
  }
  const cle = cleSerie(serie.title);
  const groupe = [serie, ...classes.filter(c => c.url !== serie.url && c.baseScore >= SCORE_MINIMAL && !estTitreDEpisode(c.title) && cleSerie(c.title) === cle)];
  const muets: ResultatClasse[] = [];
  for (const c of groupe) {
    const l = langueDeCandidat(c);
    if (!l) {
      muets.push(c);
    } else if (!variantes[l.langue]) {
      variantes[l.langue] = { langue: l.langue, url: c.url, title: c.title, indice: l.indice };
    }
  }
  const marquees = LANGUES_VERSION.filter(l => variantes[l]);
  if (marquees.length === 1 && muets.length) {
    const autre = autreLangue(marquees[0]);
    variantes[autre] = { langue: autre, url: muets[0].url, title: muets[0].title, indice: `présumée : fiche sans marqueur, à côté de « ${variantes[marquees[0]]!.title} »`, presumee: true };
  } else if (!marquees.length && (langueSource === 'vf' || langueSource === 'vostfr')) {
    variantes[langueSource] = { langue: langueSource, url: serie.url, title: serie.title, indice: `langue déclarée par la source (${LIBELLE_LANGUE_VERSION[langueSource]})` };
  }
  return { variantes };
}

const resume = (r: ResultatClasse | null) => (r ? { title: r.title, url: r.url, score: r.baseScore } : null);

/** Erreurs identiques pour toutes les variantes du titre : inutile d'insister. */
const ERREURS_DEFINITIVES = new Set(['anti-robot', 'cookies', 'garde', 'configuration', 'annule']);
/** Pages `{slug}` essayées au plus par titre. */
const SLUGS_MAX = 6;

/** Slugs à essayer pour un titre : simple, puis saison et langue (« titre-2 », « titre-saison-2 », « titre-vostfr »). */
export function variantesDeSlug(titre: string, langue: PreferenceLangue | null | undefined): string[] {
  const complet = slugDe(titre);
  const saison = saisonDe(titre);
  const base = slugDe(titreDeBase(titre));
  const liste = [complet];
  if (saison && saison > 1 && base) {
    liste.push(`${base}-${saison}`, `${base}-saison-${saison}`, `${base}-season-${saison}`);
  }
  const suffixes = langue === 'vf' ? ['vf'] : langue === 'vostfr' ? ['vostfr'] : ['vostfr', 'vf'];
  for (const sfx of suffixes) {
    liste.push(`${complet}-${sfx}`);
  }
  return [...new Set(liste.filter(Boolean))].slice(0, SLUGS_MAX);
}

/**
 * Cherche une oeuvre sur UNE source, exactement comme la fiche et le test de
 * l'assistant : variantes du titre (complet, réduit, autres titres du
 * catalogue), résultats cumulés, meilleur par ressemblance (jamais « le
 * premier »), seuil `SCORE_MINIMAL`. S'arrête dès une correspondance sûre, ou
 * dès une erreur qui vaudrait pour toutes les variantes (anti-robot, garde).
 * `choisir` départage les candidats acceptables (année d'un film).
 */
export async function chercherOeuvre(
  ctx: ContexteResolution,
  src: DefinitionSource,
  o: { titres: readonly string[]; langue?: PreferenceLangue | null; choisir?: (classes: ResultatClasse[]) => ResultatClasse | undefined },
): Promise<RechercheSerie> {
  const voulus = [...o.titres].filter(Boolean);
  const preference = (o.langue || src.language || 'indifferent') as PreferenceLangue;
  const vus = new Map<string, ResultatBrut>();
  const requetes: RequeteDiagnostic[] = [];
  const meilleurDe = () => {
    const classes = classerResultats([...vus.values()], voulus, preference);
    return { classes, choisi: (o.choisir?.(classes) ?? classes[0]) || null };
  };
  const parSlug = cheminParSlug(cheminDeRecherche(src, preference));
  let erreur: string | undefined;
  let code: string | undefined;
  /** Le résultat d'une requête, dans l'ordre ; vrai s'il faut s'arrêter (correspondance sûre, ou erreur valable pour toutes). */
  const valider = (requete: string, slug: string | undefined, { resultats, detail }: { resultats: ResultatBrut[]; detail: DetailRequete }): boolean => {
    const { url, erreur: e, ...reste } = detail;
    delete (reste as Partial<DetailRequete>).candidats;
    requetes.push({ requete: slug ? `${requete} → ${slug}` : requete, url, resultats: resultats.length, ...reste, ...(e ? { erreur: e } : {}) });
    if (e) {
      erreur = e;
      code = detail.code;
      journalDe(ctx)(`[source:${src.name}] recherche « ${requete} » : ${e}`);
      return Boolean(code && ERREURS_DEFINITIVES.has(code));
    }
    for (const r of resultats) {
      if (!vus.has(r.url)) {
        vus.set(r.url, r);
      }
    }
    const { choisi } = meilleurDe();
    return Boolean(choisi && choisi.baseScore >= SCORE_SUR);
  };
  // Toutes les requêtes à essayer, dans l'ordre ; elles partent par paquets (la première seule
  // un instant), mais sont VALIDÉES dans cet ordre : le choix est celui d'une boucle séquentielle.
  const essais: Array<{ requete: string; slug?: string }> = [];
  for (const requete of variantesDeRecherche(voulus)) {
    for (const slug of parSlug ? variantesDeSlug(requete, preference) : [undefined]) essais.push({ requete, slug });
  }
  const p = parametresParallele(ctx);
  await courseOrdonnee(
    essais.map(e => (signal: SignalAnnulation) => chercherSurDetail(sousContexte(ctx, signal), src, e.requete, { langue: preference, slug: e.slug, cibles: voulus })),
    (r, i) => valider(essais[i].requete, essais[i].slug, r),
    { simultanees: p.variantes, relaisMs: sourceLente(ctx, src) ? 0 : p.relaisMs, signal: ctx.signal },
  );
  const { classes, choisi } = meilleurDe();
  const serie = choisi && choisi.baseScore >= SCORE_MINIMAL ? choisi : null;
  // Une recherche dédiée à une langue (search.pathVf) donne des fiches de cette langue, même sans marqueur.
  const dediee = (preference === 'vf' && src.search.pathVf) || (preference === 'vostfr' && src.search.pathVostfr) ? (preference as LangueVersion) : null;
  const toutesEnErreur = requetes.length > 0 && requetes.every(r => r.erreur);
  return {
    serie,
    refuse: serie ? null : classes[0] ?? null,
    requetes,
    erreur: toutesEnErreur || (code && ERREURS_DEFINITIVES.has(code) && !vus.size) ? erreur : undefined,
    code: toutesEnErreur || (code && ERREURS_DEFINITIVES.has(code) && !vus.size) ? code : undefined,
    meilleurs: classes.slice(0, 3).map(c => ({ title: c.title, url: c.url, score: c.baseScore, langue: langueDeCandidat(c)?.langue ?? null })),
    langues: variantesDeLangue(classes, serie, dediee ?? src.language),
  };
}

/** Explication d'une recherche sans résultat retenu, d'après ce que les requêtes ont vu. */
export function raisonRecherche(r: Pick<RechercheSerie, 'requetes' | 'refuse' | 'erreur' | 'code'>): string {
  const q = r.requetes;
  if (r.code === 'anti-robot') {
    return r.erreur ?? 'Le site bloque les requêtes automatiques.';
  }
  if (r.erreur) {
    return r.erreur;
  }
  if (r.refuse) {
    return `Le meilleur résultat, « ${r.refuse.title} » (ressemblance ${r.refuse.baseScore}), est sous le minimum (${SCORE_MINIMAL}) : ce n’est probablement pas la même oeuvre (autre saison, autre titre, film/OAV).`;
  }
  if (q.length && q.every(x => x.statut === 404 || x.statut === 410)) {
    return 'La page de recherche répond 404 (introuvable) : chemin de recherche (search.path) à vérifier, ou, avec {slug}, adresse de l’oeuvre différente sur le site.';
  }
  if (q.some(x => x.renduJs)) {
    return 'La page de résultats est construite en JavaScript (SPA/AJAX) : le HTML reçu ne contient aucun résultat. Configurez l’API JSON du site (search.type « json ») — voir « Comment bien configurer une source ».';
  }
  if (q.some(x => x.json)) {
    return 'Le site a répondu en JSON, mais aucune liste de résultats (titre + lien) n’y a été trouvée : renseignez search.item (chemin de la liste), search.title et search.link (chemins relatifs).';
  }
  if (q.some(x => (x.blocs ?? 0) > 0)) {
    return 'Le sélecteur de résultat trouve des blocs, mais aucun ne fournit un titre ET un lien : revoyez search.title et search.link.';
  }
  return 'Aucun résultat sur la page de recherche (ni par les sélecteurs, ni par le repérage automatique) : le site ne connaît peut-être pas ce titre, ou la page de recherche n’est pas la bonne.';
}

const L = (l: LangueVersion) => LIBELLE_LANGUE_VERSION[l];

/**
 * Langues d'une série sur une source, d'après la page lue et les fiches de la
 * recherche : la page mêle les deux (listes séparées), ou elle est d'UNE
 * langue (marqueurs des épisodes, fiche retenue, langue déclarée) et l'autre
 * est une autre fiche (lue à la demande), une recherche dédiée, ou absente.
 */
export function composerLangues(
  src: DefinitionSource,
  pageUrl: string,
  serie: ResultatClasse | null,
  trouvees: VariantesRecherche,
  lecture: LectureEpisodes,
): LanguesSerie {
  const variantes: Partial<Record<LangueVersion, VarianteLangue>> = {};
  const titre = serie?.title ?? '';
  let courante: LangueVersion | null = null;
  if (lecture.parLangue) {
    courante = lecture.langue?.langue ?? null;
    const presumee = lecture.detail.langues?.presumee;
    for (const l of LANGUES_VERSION) {
      const eps = lecture.parLangue[l];
      if (eps?.length) {
        variantes[l] = {
          langue: l,
          url: pageUrl,
          title: titre,
          indice: presumee === l ? `même page : épisodes sans marqueur, à côté des épisodes « ${L(autreLangue(l))} » (présumés ${L(l)})` : 'même page : épisodes VF et VOSTFR séparés',
          presumee: presumee === l || undefined,
          episodes: eps,
          detail: l === courante ? lecture.detail : undefined,
        };
      }
    }
  } else {
    const fiche = LANGUES_VERSION.map(l => trouvees.variantes[l]).find(v => v && v.url === pageUrl);
    const declaree = src.language === 'vf' || src.language === 'vostfr' ? src.language : null;
    // La page et la fiche s'accordent : l'indice de la fiche (« (VF) » dans le titre) est le plus parlant.
    const lue: LangueLue | null = (fiche && lecture.langue?.langue === fiche.langue && !fiche.presumee ? { langue: fiche.langue, indice: fiche.indice } : null) ?? lecture.langue ?? (fiche ? { langue: fiche.langue, indice: fiche.indice } : declaree ? { langue: declaree, indice: `langue déclarée par la source (${L(declaree)})` } : null);
    if (lue) {
      courante = lue.langue;
      variantes[lue.langue] = { langue: lue.langue, url: pageUrl, title: titre, indice: lue.indice, presumee: (!lecture.langue && fiche?.presumee) || undefined, episodes: lecture.episodes, detail: lecture.detail };
      const autre = autreLangue(lue.langue);
      const ailleurs = trouvees.variantes[autre];
      if (ailleurs && ailleurs.url !== pageUrl) {
        variantes[autre] = { ...ailleurs };
      } else if ((autre === 'vf' && src.search.pathVf) || (autre === 'vostfr' && src.search.pathVostfr)) {
        variantes[autre] = { langue: autre, url: '', title: '', indice: `recherche dédiée de la source (search.${autre === 'vf' ? 'pathVf' : 'pathVostfr'}), lancée à la demande`, aChercher: true };
      }
    }
  }
  const absentes: Partial<Record<LangueVersion, string>> = {};
  for (const l of LANGUES_VERSION) {
    if (variantes[l]) continue;
    if (!courante) {
      absentes[l] = `la source « ${src.name} » ne distingue pas la langue : ni le titre de la fiche, ni son adresse, ni les blocs de la page n’indiquent VF ou VOSTFR`;
    } else if ((src.language === 'vf' || src.language === 'vostfr') && src.language !== l) {
      absentes[l] = `la source « ${src.name} » est réglée sur ${L(src.language)} seulement, et aucune fiche « ${L(l)} » n’a été trouvée`;
    } else {
      absentes[l] = `aucune fiche « ${L(l)} » de ce titre parmi les résultats de « ${src.name} », et la page de la série ne propose que la ${L(courante)}`;
    }
  }
  return { courante, variantes, absentes };
}

/**
 * Épisodes d'une série dans une langue, sur la source qui l'a trouvée. Ce qui
 * est déjà lu sert tel quel ; sinon UNE page de série de plus (ou la
 * recherche dédiée à cette langue puis sa page) ; le résultat est gardé dans
 * `langues` (pas de seconde requête). Jamais d'exception : `raison` sinon.
 */
export async function episodesEnLangue(
  ctx: ContexteResolution,
  src: DefinitionSource,
  langues: LanguesSerie,
  langue: LangueVersion,
  o: { titres: readonly string[]; saison?: number | null },
): Promise<{ episodes: EpisodeSource[]; variante?: VarianteLangue; raison?: string }> {
  const v = langues.variantes[langue];
  if (!v) {
    return { episodes: [], raison: langues.absentes[langue] ?? `${L(langue)} non trouvée sur « ${src.name} »` };
  }
  if (v.episodes) {
    return v.episodes.length ? { episodes: v.episodes, variante: v } : { episodes: [], variante: v, raison: v.echec ?? `aucun épisode ${L(langue)} lu sur « ${src.name} »` };
  }
  try {
    if (v.aChercher) {
      const r = await chercherOeuvre(ctx, src, { titres: o.titres, langue });
      const trouvee = r.langues.variantes[langue] ?? (r.serie && !langueDeCandidat(r.serie) ? { langue, url: r.serie.url, title: r.serie.title, indice: v.indice } : null);
      if (!trouvee) {
        v.episodes = [];
        v.echec = `la recherche ${L(langue)} de « ${src.name} » ne trouve pas ce titre${r.erreur ? ` (${r.erreur})` : ''}`;
        return { episodes: [], variante: v, raison: v.echec };
      }
      Object.assign(v, { url: trouvee.url, title: trouvee.title, aChercher: false });
    }
    const lecture = await lireEpisodesDetail(ctx, src, v.url, { saison: o.saison ?? saisonDe(o.titres[0] ?? '') ?? saisonDe(v.title), titres: [...o.titres, v.title], langue });
    const contraire = !lecture.parLangue && lecture.langue && lecture.langue.langue !== langue;
    v.episodes = lecture.parLangue ? lecture.parLangue[langue] ?? [] : contraire ? [] : lecture.episodes.map(e => ({ ...e, langue }));
    v.detail = lecture.detail;
    if (!v.episodes.length) {
      v.echec = contraire ? `la page « ${v.title} » s’annonce ${L(lecture.langue!.langue)} (${lecture.langue!.indice})` : `aucun épisode lu sur la page ${L(langue)} « ${v.title} »`;
      return { episodes: [], variante: v, raison: v.echec };
    }
    return { episodes: v.episodes, variante: v };
  } catch (err) {
    journalDe(ctx)(`[source:${src.name}] ${L(langue)} : ${messageDe(err)}`);
    // Erreur passagère (réseau) : rien n'est retenu, une nouvelle demande relira la page.
    return { episodes: [], variante: v, raison: `page ${L(langue)} illisible : ${messageDe(err)}` };
  }
}

/** Cherche la serie sur UNE source puis lit ses episodes. */
export async function episodesSur(ctx: ContexteResolution, src: DefinitionSource, o: OptionsEpisodes): Promise<ResultatEpisodes> {
  const diag: DiagnosticSource = { source: src.name, sourceId: src.id, statut: 'ok', requetes: [], serie: null, refuse: null, episodes: 0 };
  if (!o.url && !supporteAnimes(src)) {
    return {
      episodes: [],
      source: src,
      serie: null,
      refuse: null,
      diagnostics: [{ ...diag, statut: 'non-configuree', raison: supporteFilms(src) ? 'Source configurée pour les films seulement (section « search » des animés vide).' : 'Recherche des animés non configurée (search.path / search.item).' }],
    };
  }
  let serie: ResultatClasse | null = null;
  let pageUrl = o.url ?? null;
  let trouvees: VariantesRecherche = { variantes: {} };
  const debut = Date.now();
  if (!pageUrl) {
    const r = await chercherOeuvre(ctx, src, o);
    diag.ms = { recherche: Date.now() - debut };
    trouvees = r.langues;
    diag.requetes = r.requetes;
    diag.refuse = resume(r.refuse);
    diag.meilleurs = r.meilleurs;
    if (!r.serie) {
      diag.statut = r.code === 'anti-robot' || r.code === 'cookies' ? 'bloquee' : r.erreur ? 'erreur' : r.refuse ? 'titre-introuvable' : 'aucun-resultat';
      diag.erreur = r.erreur;
      diag.raison = raisonRecherche(r) || undefined;
      return { episodes: [], source: src, serie: null, refuse: r.refuse, diagnostics: [diag] };
    }
    serie = r.serie;
    diag.serie = resume(serie);
    pageUrl = serie.url;
  }
  try {
    const voulue = saisonDe(o.titres[0] ?? '') ?? saisonDe(serie?.title ?? '');
    const titresSerie = [...o.titres, ...(serie?.title ? [serie.title] : [])];
    const debutEpisodes = Date.now();
    const lecture = await lireEpisodesDetail(ctx, src, pageUrl, { saison: voulue, titres: titresSerie, langue: o.langue ?? src.language });
    diag.ms = { ...diag.ms, episodes: Date.now() - debutEpisodes };
    const { episodes, detail } = lecture;
    const langues = composerLangues(src, pageUrl, serie, trouvees, lecture);
    diag.episodes = episodes.length;
    diag.lectureEpisodes = detail;
    diag.langues = resumerLangues(langues);
    diag.statut = episodes.length ? 'ok' : 'aucun-episode';
    if (!episodes.length) {
      diag.raison = detail.renduJs
        ? 'La page de la série est construite en JavaScript : la liste des épisodes n’est pas dans le HTML (API JSON à configurer dans episodes.type).'
        : `Aucun épisode lu sur ${pageUrl} (${detail.blocs} bloc(s) pour « ${src.episodes.item || '(aucun sélecteur)'} », repérage automatique sans résultat).`;
    }
    return { episodes, source: src, serie, refuse: null, diagnostics: [diag], langues };
  } catch (err) {
    diag.statut = err instanceof ErreurMoteur && (err.code === 'anti-robot' || err.code === 'cookies') ? 'bloquee' : 'erreur';
    diag.erreur = `Page de la série illisible (${pageUrl}) : ${messageDe(err)}`;
    journalDe(ctx)(`[source:${src.name}] ${diag.erreur}`);
    return { episodes: [], source: src, serie, refuse: null, diagnostics: [diag] };
  }
}

/** Diagnostic d'une source abandonnée : une source moins prioritaire a trouvé, et elle tardait. */
const interrompue = (src: DefinitionSource, gagnante: DefinitionSource, graceMs: number): DiagnosticSource => ({
  source: src.name,
  sourceId: src.id,
  statut: 'interrompue',
  requetes: [],
  serie: null,
  refuse: null,
  episodes: 0,
  raison: `recherche interrompue : « ${gagnante.name} » a trouvé, et cette source, plus prioritaire, n’avait pas répondu ${String(graceMs / 1000).replace('.', ',')} s plus tard`,
});

/**
 * Cherche sur les sources activées EN PARALLÈLE (3 au plus), dans leur ordre
 * de priorité : la première qui donne des épisodes l'emporte (une moins
 * prioritaire n'attend une plus prioritaire encore en cours que
 * `graceMs`) ; les autres sont annulées. Garde le diagnostic de chacune
 * (jusqu'à la gagnante), dans l'ordre.
 */
export async function trouverEpisodes(
  ctx: ContexteResolution,
  sources: readonly DefinitionSource[],
  o: OptionsEpisodes,
): Promise<ResultatEpisodes> {
  const actives = sourcesActives(sources);
  const p = parametresParallele(ctx);
  const { issues, gagnante } = await courseAvecPriorite(
    actives.map(src => (signal: SignalAnnulation) => episodesSur(sousContexte(ctx, signal), src, o)),
    r => r.episodes.length > 0,
    { simultanees: p.sources, graceMs: p.graceMs, relaisMs: sourceLente(ctx, actives[0]) ? 0 : p.relaisSourcesMs, signal: ctx.signal, surProvisoire: o.surProvisoire ? r => o.surProvisoire!(r) : undefined },
  );
  let refuse: ResultatClasse | null = null;
  let partiel: ResultatEpisodes | null = null;
  const diagnostics: DiagnosticSource[] = [];
  for (const issue of issues) {
    const src = actives[issue.i];
    if (gagnante != null && issue.i > gagnante) break;
    if (issue.interrompue) {
      diagnostics.push(interrompue(src, actives[gagnante ?? 0], p.graceMs));
    } else if (issue.erreur !== undefined) {
      journalDe(ctx)(`[source:${src.name}] ${messageDe(issue.erreur)}`);
      diagnostics.push({ source: src.name, sourceId: src.id, statut: 'erreur', requetes: [], serie: null, refuse: null, episodes: 0, erreur: messageDe(issue.erreur) });
    } else if (issue.resultat) {
      const r = issue.resultat;
      diagnostics.push(...r.diagnostics);
      if (issue.i === gagnante) {
        return { ...r, diagnostics };
      }
      refuse = refuse ?? r.refuse;
      partiel = partiel ?? (r.serie ? r : null);
    }
  }
  return { episodes: [], source: partiel?.source ?? null, serie: partiel?.serie ?? null, refuse, diagnostics };
}

// ---------------------------------------------------------------------------
// Lecteurs
// ---------------------------------------------------------------------------

/** Lecteurs d'une page d'episode ou de film, selon les selecteurs de la source. */
export async function lecteursSur(ctx: ContexteResolution, src: DefinitionSource, urlPage: string): Promise<Lecteur[]> {
  if (!urlPage) {
    return [];
  }
  const { page, url: lue } = await chargerPage(ctx.client, urlPage, src);
  const sortie: Lecteur[] = [];
  const vus = new Set<string>();
  const ajouter = (brut: string | null, nom: string) => {
    const url = urlPubliqueSure(absolue(brut, lue || urlPage));
    if (!url || vus.has(url)) {
      return;
    }
    vus.add(url);
    sortie.push({ label: `${src.name} - ${nom}`.trim(), url, kind: classerMedia(url) });
  };
  // Menu deroulant de lecteurs : l'iframe visible n'en montre qu'un.
  if (src.player.options) {
    page.tous(src.player.options).forEach((el, i) => {
      const nom = (src.player.optionLabel ? choisir(page, el, src.player.optionLabel) : texteCompact(page, el)) || `Lecteur ${i + 1}`;
      ajouter(page.attr(el, src.player.optionAttr || 'value'), nom);
    });
  }
  if (src.player.iframe) {
    page.tous(src.player.iframe).forEach((el, i) => {
      ajouter(page.attr(el, src.player.attr || 'src'), `${src.player.label || 'Lecteur'} ${i + 1}`);
    });
  }
  return sortie;
}

export async function trouverLecteurs(ctx: ContexteResolution, sources: readonly DefinitionSource[], urlEpisode: string): Promise<Lecteur[]> {
  const cible = sourcePourUrl(sources, urlEpisode);
  const ordre = cible ? [cible, ...sourcesActives(sources).filter(s => s !== cible)] : sourcesActives(sources);
  for (const src of ordre) {
    try {
      const l = await lecteursSur(ctx, src, urlEpisode);
      if (l.length) {
        return l;
      }
    } catch (err) {
      journalDe(ctx)(`[source:${src.name}] ${messageDe(err)}`);
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Films
// ---------------------------------------------------------------------------

export interface ResultatFilm {
  sources: Lecteur[];
  choisi: ResultatClasse | null;
  refuse: ResultatClasse | null;
  source: DefinitionSource | null;
  diagnostics: DiagnosticSource[];
}

/** L'annee, quand elle figure dans le titre ou dans son bloc, departage un remake. */
export const parAnnee = (annee: number | string | null | undefined) => (classes: ResultatClasse[]) =>
  annee ? classes.find(r => r.baseScore >= SCORE_MINIMAL && `${r.title} ${r.year ?? ''}`.includes(String(annee))) ?? classes[0] : classes[0];

/** Cherche le film sur UNE source (vue films), comme la lecture et le test de l'assistant. */
export async function filmSur(
  ctx: ContexteResolution,
  brute: DefinitionSource,
  o: { titres: readonly string[]; annee?: number | string | null; langue?: PreferenceLangue | null },
): Promise<ResultatFilm> {
  const diag: DiagnosticSource = { source: brute.name, sourceId: brute.id, statut: 'ok', requetes: [], serie: null, refuse: null, episodes: 0 };
  if (!supporteFilms(brute)) {
    return { sources: [], choisi: null, refuse: null, source: null, diagnostics: [{ ...diag, statut: 'non-configuree' }] };
  }
  const src = vueFilm(brute);
  const r = await chercherOeuvre(ctx, src, { titres: o.titres, langue: o.langue ?? 'indifferent', choisir: parAnnee(o.annee) });
  diag.requetes = r.requetes;
  diag.refuse = resume(r.refuse);
  if (!r.serie) {
    diag.statut = r.erreur ? 'erreur' : r.refuse ? 'titre-introuvable' : 'aucun-resultat';
    diag.erreur = r.erreur;
    return { sources: [], choisi: null, refuse: r.refuse, source: null, diagnostics: [diag] };
  }
  diag.serie = resume(r.serie);
  try {
    const lecteurs = await lecteursSur(ctx, src, r.serie.url);
    diag.episodes = lecteurs.length ? 1 : 0;
    diag.statut = lecteurs.length ? 'ok' : 'aucun-episode';
    return { sources: lecteurs, choisi: r.serie, refuse: null, source: lecteurs.length ? brute : null, diagnostics: [diag] };
  } catch (err) {
    diag.statut = 'erreur';
    diag.erreur = `Page du film illisible (${r.serie.url}) : ${messageDe(err)}`;
    journalDe(ctx)(`[source:${src.name}] ${diag.erreur}`);
    return { sources: [], choisi: r.serie, refuse: null, source: null, diagnostics: [diag] };
  }
}

/** Cherche le film chez chaque source ayant une section films (en parallèle, dans l'ordre de priorité). */
export async function trouverFilm(
  ctx: ContexteResolution,
  sources: readonly DefinitionSource[],
  o: { titres: readonly string[]; annee?: number | string | null },
): Promise<ResultatFilm> {
  const actives = sourcesActives(sources).filter(supporteFilms);
  const p = parametresParallele(ctx);
  // Les films se cherchent sans preference de doublage (comme avant).
  const { issues, gagnante } = await courseAvecPriorite(
    actives.map(brute => (signal: SignalAnnulation) => filmSur(sousContexte(ctx, signal), brute, { ...o, langue: 'indifferent' })),
    r => r.sources.length > 0,
    { simultanees: p.sources, graceMs: p.graceMs, relaisMs: sourceLente(ctx, actives[0]) ? 0 : p.relaisSourcesMs, signal: ctx.signal },
  );
  let refuse: ResultatClasse | null = null;
  const diagnostics: DiagnosticSource[] = [];
  for (const issue of issues) {
    const brute = actives[issue.i];
    if (gagnante != null && issue.i > gagnante) break;
    if (issue.interrompue) {
      diagnostics.push(interrompue(brute, actives[gagnante ?? 0], p.graceMs));
    } else if (issue.erreur !== undefined) {
      journalDe(ctx)(`[source:${brute.name}] ${messageDe(issue.erreur)}`);
      diagnostics.push({ source: brute.name, sourceId: brute.id, statut: 'erreur', requetes: [], serie: null, refuse: null, episodes: 0, erreur: messageDe(issue.erreur) });
    } else if (issue.resultat) {
      const r = issue.resultat;
      diagnostics.push(...r.diagnostics);
      if (issue.i === gagnante) {
        return { ...r, diagnostics };
      }
      refuse = refuse ?? r.refuse;
    }
  }
  return { sources: [], choisi: null, refuse, source: null, diagnostics };
}

// ---------------------------------------------------------------------------
// Page quelconque (lien colle a la main)
// ---------------------------------------------------------------------------

/**
 * Repere les lecteurs d'une page sans selecteurs : iframes, balises
 * video/source et attributs data-* pointant vers une adresse.
 */
export function lecteursDansHtml(html: string, urlPage: string, label = 'Lien manuel'): Lecteur[] {
  const page = lirePage(html);
  const sortie: Lecteur[] = [];
  const vus = new Set<string>();
  const pousser = (brut: string | null, nom: string) => {
    // Un lecteur qui viserait le reseau local est ecarte (iframe = requete de l'appareil).
    const url = urlPubliqueSure(absolue(brut, urlPage));
    if (!url || vus.has(url)) {
      return;
    }
    vus.add(url);
    sortie.push({ label: `${label} - ${nom} ${sortie.length + 1}`, url, kind: classerMedia(url) });
  };
  for (const el of page.tous('iframe')) {
    pousser(page.attr(el, 'src') || page.attr(el, 'data-src') || page.attr(el, 'data-lazy-src'), 'Lecteur');
  }
  for (const el of page.tous('video, video source')) {
    pousser(page.attr(el, 'src'), 'Video');
  }
  for (const el of page.tous('[data-embed], [data-video], [data-player]')) {
    pousser(page.attr(el, 'data-embed') || page.attr(el, 'data-video') || page.attr(el, 'data-player'), 'Lecteur');
  }
  return sortie;
}

export type MethodeResolution = 'direct' | 'source' | 'heuristique' | 'page';

export interface ResolutionPage {
  sources: Lecteur[];
  method: MethodeResolution;
  sourceName?: string;
  warning?: string;
}

/**
 * Resout une page collee par l'utilisateur. Ordre : fichier direct, source
 * du meme domaine (selecteurs), heuristique, puis la page elle-meme en
 * iframe (le site peut refuser l'integration).
 */
export async function lecteursPourPage(
  ctx: ContexteResolution,
  sources: readonly DefinitionSource[],
  urlPage: string,
  o: { label?: string; kind?: 'anime' | 'movie' } = {},
): Promise<ResolutionPage> {
  const label = o.label ?? 'Lien manuel';
  const direct = classerMedia(urlPage);
  if (direct !== 'iframe') {
    return { sources: [{ label: `${label} - fichier video`, url: urlPage, kind: direct }], method: 'direct' };
  }
  const src = sourcePourUrl(sources, urlPage);
  if (src) {
    try {
      const vue = o.kind === 'movie' && supporteFilms(src) ? vueFilm(src) : src;
      const trouves = await lecteursSur(ctx, vue, urlPage);
      if (trouves.length) {
        return { sources: trouves, method: 'source', sourceName: src.name };
      }
    } catch (err) {
      journalDe(ctx)(`[lien manuel] ${messageDe(err)}`);
    }
  }
  try {
    const { html, url } = await chargerPage(ctx.client, urlPage, src ?? undefined);
    const trouves = lecteursDansHtml(html, url || urlPage, label);
    if (trouves.length) {
      return { sources: trouves, method: 'heuristique' };
    }
  } catch (err) {
    return {
      sources: [{ label: `${label} - page integree`, url: urlPage, kind: 'iframe' }],
      method: 'page',
      warning: `La page n'a pas pu etre analysee (${messageDe(err)}) : elle est affichee telle quelle.`,
    };
  }
  return {
    sources: [{ label: `${label} - page integree`, url: urlPage, kind: 'iframe' }],
    method: 'page',
    warning: "Aucun lecteur detecte dans la page : elle est affichee telle quelle (le site peut refuser l'integration).",
  };
}

// ---------------------------------------------------------------------------
// Diagnostic (aide a configurer les selecteurs)
// ---------------------------------------------------------------------------

export interface DiagnosticEtape {
  nom: string;
  ok: boolean;
  detail: string;
  pistes: string[];
}

/** Teste la recherche d'une source : nombre de blocs, resultats lisibles, pistes (SPA, anti-robot, JSON). */
export async function diagnostiquerRecherche(ctx: ContexteResolution, src: DefinitionSource, titre: string): Promise<DiagnosticEtape> {
  const url = adresseDeRecherche(src, titre);
  if (!src.search.path || !supporteAnimes(src) || !url) {
    return { nom: 'recherche', ok: false, detail: 'Chemin de recherche ou selecteur de resultat non renseigne.', pistes: [] };
  }
  const { resultats, detail } = await chercherSurDetail(ctx, src, titre);
  if (detail.erreur) {
    return { nom: 'recherche', ok: false, detail: detail.erreur, pistes: [] };
  }
  const auto = detail.extraction === 'generique' ? ` (repérage automatique : ${resultats.length} résultat(s) lisible(s) malgré tout)` : '';
  if (resultats.length && detail.extraction !== 'generique') {
    return { nom: 'recherche', ok: true, detail: `${resultats.length} resultat(s)${detail.blocs !== undefined ? ` sur ${detail.blocs} bloc(s)` : ''}.`, pistes: [] };
  }
  let pistes: string[] = [];
  if (!detail.json) {
    try {
      const { page } = await chargerPage(ctx.client, url, src);
      pistes = [...(sembleRenduEnJs(page) ? ['La page semble construite en JavaScript : utilisez l’API JSON du site (search.type « json »).'] : []), ...suggererSelecteurs(page)];
    } catch {
      // Déjà lue une fois : une seconde erreur n'apporte rien.
    }
  }
  return {
    nom: 'recherche',
    ok: false,
    detail: detail.blocs
      ? `${detail.blocs} bloc(s) trouve(s), mais aucun ne fournit un titre et un lien.${auto}`
      : detail.json
        ? 'Réponse JSON sans liste de résultats lisible (search.item = chemin de la liste, search.title / search.link = chemins relatifs).'
        : `Le selecteur « ${src.search.item} » ne correspond a aucun element.${auto}`,
    pistes,
  };
}
