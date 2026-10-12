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
import { choisir, lirePage, sembleRenduEnJs, suggererSelecteurs, texteCompact, texteVisible, type Noeud, type Page } from './lecteurPage';
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
import { analyserAdresse } from './adresse';

export interface Lecteur {
  label: string;
  url: string;
  kind: TypeMedia;
}

export interface EpisodeSource {
  number: number;
  title: string | null;
  url: string;
}

export interface ContexteResolution {
  client: ClientSur;
  journal?: Journal;
}

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
    const rep = await client.texte(cible, { delaiMs: src?.timeout, agentUtilisateur: src?.userAgent, referer: refererDe(src) });
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
    const appel = { delaiMs: src.timeout, agentUtilisateur: src.userAgent, referer: refererDe(src), entetes: sel.type === 'json' ? { accept: 'application/json, text/javascript, */*;q=0.1' } : undefined };
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

function numeroEpisode(page: Page, el: Noeud, src: DefinitionSource, href: string | null): number | null {
  const brut = choisir(page, el, src.episodes.number);
  const depuisSelecteur = brut ? Number.parseInt(brut.replace(/\D+/g, ''), 10) : NaN;
  if (Number.isFinite(depuisSelecteur)) {
    return depuisSelecteur;
  }
  const texte = texteCompact(page, el);
  const depuisTexte = /(?:episode|episodes|épisode|ep\.?|chapitre)\s*#?\s*(\d{1,4})/i.exec(texte);
  if (depuisTexte) {
    return Number(depuisTexte[1]);
  }
  const generique = numeroEtSaison(texte, href ?? '');
  return generique ? generique.number : numeroDepuisAdresse(href);
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
}

type Collecte = { number: number | null; title: string | null; url: string; saison: number | null };

/** Épisodes d'UNE page : JSON (chemins), sélecteurs CSS, puis repérage générique. */
function episodesDePage(src: DefinitionSource, lue: PageLue, urlSerie: string): { collectes: Collecte[]; extraction: DetailEpisodes['extraction']; blocs: number } {
  const ep = src.episodes;
  const json = estReponseJson(lue.rep.typeContenu, lue.html) ? analyserJson(lue.html) : undefined;
  if (json !== undefined) {
    const liste = valeurJson(json, ep.type === 'json' ? ep.item : '') ;
    const objets = (Array.isArray(liste) ? liste : listeAutoJson(json) ?? []).filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object');
    const collectes = objets
      .map(o => {
        const url = lienJson(o, ep.link, ep.linkFormat, lue.url);
        const brut = texteJson(valeurJson(o, ep.number || 'number')) ?? texteJson(o.episode) ?? texteJson(o.ep);
        const n = brut ? Number.parseInt(brut.replace(/\D+/g, ''), 10) : NaN;
        const c: Collecte | null = url ? { number: Number.isFinite(n) ? n : numeroDepuisAdresse(url), title: texteJson(valeurJson(o, ep.title || 'title')), url, saison: null } : null;
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
    const saison = numeroEtSaison(texteCompact(page, el), abs)?.saison ?? null;
    collectes.push({ number: numeroEpisode(page, el, src, abs), title: choisir(page, el, ep.title), url: abs, saison });
  }
  if (collectes.length) {
    return { collectes, extraction: 'selecteurs', blocs: blocs.length };
  }
  const generiques = episodesGeneriques(page, base, src.baseUrl, urlSerie).filter(e => !estLienDeNavigation(e.url, src.baseUrl, urlSerie));
  return { collectes: generiques, extraction: generiques.length ? 'generique' : 'aucune', blocs: blocs.length };
}

/**
 * Lit la liste d'episodes d'une page de serie, triee par numero : sélecteurs
 * configurés, API JSON, sinon repérage générique (« Épisode N », « EP N »,
 * « E01 », « S2E03 », « 第N話 », numéro en fin d'adresse). Suit la pagination
 * (rel=next, « Suivant », `episodes.next`) et garde la saison voulue quand la
 * page en mêle plusieurs.
 */
export async function lireEpisodesDetail(
  ctx: ContexteResolution,
  src: DefinitionSource,
  urlSerie: string,
  o: { saison?: number | null } = {},
): Promise<{ episodes: EpisodeSource[]; detail: DetailEpisodes }> {
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
    const r = episodesDePage(src, lue, urlSerie);
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
  const saisons = filtrerSaison(toutes, o.saison ?? null);
  if (saisons.length !== toutes.length) {
    detail.saison = saisons[0]?.saison ?? null;
  }
  // Dernier recours : aucun numero lisible -> numerotation inverse (liste du plus recent au plus ancien).
  const numerotes: EpisodeSource[] = saisons.every(e => e.number == null)
    ? saisons.map((e, i) => ({ number: saisons.length - i, title: e.title, url: e.url }))
    : saisons.filter(e => e.number != null).map(e => ({ number: e.number as number, title: e.title, url: e.url }));
  // Un même numéro deux fois (VF et VOSTFR, doublon de liste) : le premier est gardé.
  const vus = new Set<number>();
  const episodes = numerotes.sort((x, y) => x.number - y.number).filter(e => !vus.has(e.number) && Boolean(vus.add(e.number)));
  return { episodes, detail };
}

/** Lit la liste d'episodes d'une page de serie, triee par numero. */
export async function lireEpisodes(ctx: ContexteResolution, src: DefinitionSource, urlSerie: string, o: { saison?: number | null } = {}): Promise<EpisodeSource[]> {
  return (await lireEpisodesDetail(ctx, src, urlSerie, o)).episodes;
}

export interface OptionsEpisodes {
  titres: readonly string[];
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
export type StatutSource = 'ok' | 'erreur' | 'bloquee' | 'titre-introuvable' | 'aucun-resultat' | 'aucun-episode' | 'non-configuree';

/** Un candidat comparé au titre (diagnostic : les meilleurs). */
export interface CandidatCompare {
  title: string;
  url: string;
  score: number;
}

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
}

export interface ResultatEpisodes {
  episodes: EpisodeSource[];
  source: DefinitionSource | null;
  serie: ResultatClasse | null;
  /** Meilleur candidat ecarte faute de score : explique pourquoi rien n'est lu. */
  refuse: ResultatClasse | null;
  /** Une entrée par source essayée, dans l'ordre. */
  diagnostics: DiagnosticSource[];
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
}

const resume = (r: ResultatClasse | null) => (r ? { title: r.title, url: r.url, score: r.baseScore } : null);

/** Erreurs identiques pour toutes les variantes du titre : inutile d'insister. */
const ERREURS_DEFINITIVES = new Set(['anti-robot', 'cookies', 'garde', 'configuration']);
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
  /** Une requête ; vrai s'il faut s'arrêter (correspondance sûre, ou erreur valable pour toutes). */
  const essayer = async (requete: string, slug?: string): Promise<boolean> => {
    const { resultats, detail } = await chercherSurDetail(ctx, src, requete, { langue: preference, slug, cibles: voulus });
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
  let fini = false;
  for (const requete of variantesDeRecherche(voulus)) {
    for (const slug of parSlug ? variantesDeSlug(requete, preference) : [undefined]) {
      fini = await essayer(requete, slug);
      if (fini) {
        break;
      }
    }
    if (fini) {
      break;
    }
  }
  const { classes, choisi } = meilleurDe();
  const serie = choisi && choisi.baseScore >= SCORE_MINIMAL ? choisi : null;
  const toutesEnErreur = requetes.length > 0 && requetes.every(r => r.erreur);
  return {
    serie,
    refuse: serie ? null : classes[0] ?? null,
    requetes,
    erreur: toutesEnErreur || (code && ERREURS_DEFINITIVES.has(code) && !vus.size) ? erreur : undefined,
    code: toutesEnErreur || (code && ERREURS_DEFINITIVES.has(code) && !vus.size) ? code : undefined,
    meilleurs: classes.slice(0, 3).map(c => ({ title: c.title, url: c.url, score: c.baseScore })),
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
  if (!pageUrl) {
    const r = await chercherOeuvre(ctx, src, o);
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
    const { episodes, detail } = await lireEpisodesDetail(ctx, src, pageUrl, { saison: voulue });
    diag.episodes = episodes.length;
    diag.lectureEpisodes = detail;
    diag.statut = episodes.length ? 'ok' : 'aucun-episode';
    if (!episodes.length) {
      diag.raison = detail.renduJs
        ? 'La page de la série est construite en JavaScript : la liste des épisodes n’est pas dans le HTML (API JSON à configurer dans episodes.type).'
        : `Aucun épisode lu sur ${pageUrl} (${detail.blocs} bloc(s) pour « ${src.episodes.item || '(aucun sélecteur)'} », repérage automatique sans résultat).`;
    }
    return { episodes, source: src, serie, refuse: null, diagnostics: [diag] };
  } catch (err) {
    diag.statut = err instanceof ErreurMoteur && (err.code === 'anti-robot' || err.code === 'cookies') ? 'bloquee' : 'erreur';
    diag.erreur = `Page de la série illisible (${pageUrl}) : ${messageDe(err)}`;
    journalDe(ctx)(`[source:${src.name}] ${diag.erreur}`);
    return { episodes: [], source: src, serie, refuse: null, diagnostics: [diag] };
  }
}

/** Parcourt les sources activees jusqu'a ce que l'une donne des episodes ; garde le diagnostic de chacune. */
export async function trouverEpisodes(
  ctx: ContexteResolution,
  sources: readonly DefinitionSource[],
  o: OptionsEpisodes,
): Promise<ResultatEpisodes> {
  let refuse: ResultatClasse | null = null;
  let partiel: ResultatEpisodes | null = null;
  const diagnostics: DiagnosticSource[] = [];
  for (const src of sourcesActives(sources)) {
    try {
      const r = await episodesSur(ctx, src, o);
      diagnostics.push(...r.diagnostics);
      if (r.episodes.length) {
        return { ...r, diagnostics };
      }
      refuse = refuse ?? r.refuse;
      partiel = partiel ?? (r.serie ? r : null);
    } catch (err) {
      journalDe(ctx)(`[source:${src.name}] ${messageDe(err)}`);
      diagnostics.push({ source: src.name, sourceId: src.id, statut: 'erreur', requetes: [], serie: null, refuse: null, episodes: 0, erreur: messageDe(err) });
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

/** Cherche le film chez chaque source ayant une section films. */
export async function trouverFilm(
  ctx: ContexteResolution,
  sources: readonly DefinitionSource[],
  o: { titres: readonly string[]; annee?: number | string | null },
): Promise<ResultatFilm> {
  let refuse: ResultatClasse | null = null;
  const diagnostics: DiagnosticSource[] = [];
  for (const brute of sourcesActives(sources)) {
    if (!supporteFilms(brute)) {
      continue;
    }
    try {
      // Les films se cherchent sans preference de doublage (comme avant).
      const r = await filmSur(ctx, brute, { ...o, langue: 'indifferent' });
      diagnostics.push(...r.diagnostics);
      if (r.sources.length) {
        return { ...r, diagnostics };
      }
      refuse = refuse ?? r.refuse;
    } catch (err) {
      journalDe(ctx)(`[source:${brute.name}] ${messageDe(err)}`);
      diagnostics.push({ source: brute.name, sourceId: brute.id, statut: 'erreur', requetes: [], serie: null, refuse: null, episodes: 0, erreur: messageDe(err) });
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
