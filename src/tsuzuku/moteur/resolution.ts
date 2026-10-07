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
  SCORE_MINIMAL,
  SCORE_SUR,
  variantesDeRecherche,
  type PreferenceLangue,
  type ResultatBrut,
  type ResultatClasse,
} from './appariement';
import { ErreurMoteur, messageDe } from './erreurs';
import { classerMedia, type TypeMedia, urlPubliqueSure } from './garde';
import { choisir, lirePage, sembleRenduEnJs, suggererSelecteurs, texteCompact, type Noeud, type Page } from './lecteurPage';
import type { ClientSur } from './reseau';
import {
  absolue,
  adresseDeRecherche,
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

async function chargerPage(client: ClientSur, url: string, src?: Pick<DefinitionSource, 'timeout' | 'userAgent'>) {
  const rep = await client.texte(url, { delaiMs: src?.timeout, agentUtilisateur: src?.userAgent });
  return { page: lirePage(rep.corps), html: rep.corps, url: rep.url };
}

/** Resultats d'une recherche sur une source (titre + lien, adresses absolues). */
export async function chercherSur(
  ctx: ContexteResolution,
  src: DefinitionSource,
  requete: string,
  langue: Langue | null = null,
): Promise<ResultatBrut[]> {
  if (!src.search.path || !src.search.item) {
    return [];
  }
  const url = adresseDeRecherche(src, requete, langue);
  if (!url) {
    return [];
  }
  const { page, url: lue } = await chargerPage(ctx.client, url, src);
  // Un lien relatif se lit par rapport à la page de résultats, comme dans un navigateur.
  const base = lue || url;
  const sortie: ResultatBrut[] = [];
  for (const el of page.tous(src.search.item)) {
    const titre = choisir(page, el, src.search.title || '&');
    const lien = choisir(page, el, src.search.link || 'a', 'href');
    if (!titre || !lien) {
      continue;
    }
    const adresse = absolue(lien, base);
    if (!adresse) {
      continue;
    }
    const image = absolue(choisir(page, el, src.search.image, src.search.imageAttr || 'src'), base);
    const annee = choisir(page, el, src.search.year);
    sortie.push({ title: titre, url: adresse, image, year: annee });
  }
  return sortie;
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
  const depuisTexte = /(?:episode|episodes|ep\.?|chapitre)\s*#?\s*(\d{1,4})/i.exec(texteCompact(page, el));
  if (depuisTexte) {
    return Number(depuisTexte[1]);
  }
  return numeroDepuisAdresse(href);
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

/** Lit la liste d'episodes d'une page de serie, triee par numero. */
export async function lireEpisodes(ctx: ContexteResolution, src: DefinitionSource, urlSerie: string): Promise<EpisodeSource[]> {
  if (!src.episodes.item) {
    return [];
  }
  const { page, url: lue } = await chargerPage(ctx.client, urlSerie, src);
  const collectes: { number: number | null; title: string | null; url: string }[] = [];
  for (const el of page.tous(src.episodes.item)) {
    const href = choisir(page, el, src.episodes.link || 'a', 'href');
    if (!href) {
      continue;
    }
    const abs = absolue(href, lue || urlSerie);
    if (!abs || estLienDeNavigation(abs, src.baseUrl, urlSerie)) {
      continue;
    }
    collectes.push({ number: numeroEpisode(page, el, src, abs), title: choisir(page, el, src.episodes.title), url: abs });
  }
  // Dernier recours : aucun numero lisible -> numerotation inverse (liste du plus recent au plus ancien).
  const sortie: EpisodeSource[] = collectes.every(e => e.number == null)
    ? collectes.map((e, i) => ({ ...e, number: collectes.length - i }))
    : (collectes.filter(e => e.number != null) as EpisodeSource[]);
  return sortie.sort((a, b) => a.number - b.number);
}

export interface OptionsEpisodes {
  titres: readonly string[];
  /** Adresse de serie deja connue : saute la recherche. */
  url?: string | null;
  langue?: PreferenceLangue | null;
}

/** Une recherche lancée sur une source, pour le diagnostic affiché. */
export interface RequeteDiagnostic {
  requete: string;
  url: string | null;
  resultats: number;
  erreur?: string;
}

/** Pourquoi une source donne (ou ne donne pas) le titre. */
export type StatutSource = 'ok' | 'erreur' | 'titre-introuvable' | 'aucun-resultat' | 'aucun-episode' | 'non-configuree';

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
}

const resume = (r: ResultatClasse | null) => (r ? { title: r.title, url: r.url, score: r.baseScore } : null);

/**
 * Cherche une oeuvre sur UNE source, exactement comme la fiche et le test de
 * l'assistant : variantes du titre (complet, réduit, autres titres du
 * catalogue), résultats cumulés, meilleur par ressemblance (jamais « le
 * premier »), seuil `SCORE_MINIMAL`. S'arrête dès une correspondance sûre.
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
  let erreur: string | undefined;
  for (const requete of variantesDeRecherche(voulus)) {
    const url = adresseDeRecherche(src, requete, preference);
    try {
      const trouves = await chercherSur(ctx, src, requete, preference);
      requetes.push({ requete, url, resultats: trouves.length });
      for (const r of trouves) {
        if (!vus.has(r.url)) {
          vus.set(r.url, r);
        }
      }
    } catch (err) {
      erreur = messageDe(err);
      requetes.push({ requete, url, resultats: 0, erreur });
      journalDe(ctx)(`[source:${src.name}] recherche « ${requete} » : ${erreur}`);
      continue;
    }
    const { choisi } = meilleurDe();
    if (choisi && choisi.baseScore >= SCORE_SUR) {
      break;
    }
  }
  const { classes, choisi } = meilleurDe();
  const serie = choisi && choisi.baseScore >= SCORE_MINIMAL ? choisi : null;
  return {
    serie,
    refuse: serie ? null : classes[0] ?? null,
    requetes,
    erreur: requetes.length && requetes.every(r => r.erreur) ? erreur : undefined,
  };
}

/** Cherche la serie sur UNE source puis lit ses episodes. */
export async function episodesSur(ctx: ContexteResolution, src: DefinitionSource, o: OptionsEpisodes): Promise<ResultatEpisodes> {
  const diag: DiagnosticSource = { source: src.name, sourceId: src.id, statut: 'ok', requetes: [], serie: null, refuse: null, episodes: 0 };
  if (!o.url && !supporteAnimes(src)) {
    return { episodes: [], source: src, serie: null, refuse: null, diagnostics: [{ ...diag, statut: 'non-configuree' }] };
  }
  let serie: ResultatClasse | null = null;
  let pageUrl = o.url ?? null;
  if (!pageUrl) {
    const r = await chercherOeuvre(ctx, src, o);
    diag.requetes = r.requetes;
    diag.refuse = resume(r.refuse);
    if (!r.serie) {
      diag.statut = r.erreur ? 'erreur' : r.refuse ? 'titre-introuvable' : 'aucun-resultat';
      diag.erreur = r.erreur;
      return { episodes: [], source: src, serie: null, refuse: r.refuse, diagnostics: [diag] };
    }
    serie = r.serie;
    diag.serie = resume(serie);
    pageUrl = serie.url;
  }
  try {
    const episodes = await lireEpisodes(ctx, src, pageUrl);
    diag.episodes = episodes.length;
    diag.statut = episodes.length ? 'ok' : 'aucun-episode';
    return { episodes, source: src, serie, refuse: null, diagnostics: [diag] };
  } catch (err) {
    diag.statut = 'erreur';
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

/** Teste la recherche d'une source : nombre de blocs, resultats lisibles, pistes. */
export async function diagnostiquerRecherche(ctx: ContexteResolution, src: DefinitionSource, titre: string): Promise<DiagnosticEtape> {
  const url = adresseDeRecherche(src, titre);
  if (!src.search.path || !src.search.item || !url) {
    return { nom: 'recherche', ok: false, detail: 'Chemin de recherche ou selecteur de resultat non renseigne.', pistes: [] };
  }
  try {
    const { page } = await chargerPage(ctx.client, url, src);
    const blocs = page.tous(src.search.item).length;
    const lisibles = (await chercherSur(ctx, src, titre)).length;
    if (lisibles) {
      return { nom: 'recherche', ok: true, detail: `${lisibles} resultat(s) sur ${blocs} bloc(s).`, pistes: [] };
    }
    return {
      nom: 'recherche',
      ok: false,
      detail: blocs ? `${blocs} bloc(s) trouve(s), mais aucun ne fournit un titre et un lien.` : `Le selecteur « ${src.search.item} » ne correspond a aucun element.`,
      pistes: [...(sembleRenduEnJs(page) ? ['La page semble construite en JavaScript.'] : []), ...suggererSelecteurs(page)],
    };
  } catch (err) {
    return { nom: 'recherche', ok: false, detail: err instanceof ErreurMoteur ? err.message : messageDe(err), pistes: [] };
  }
}
