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
  variantesDeRecherche,
  type PreferenceLangue,
  type ResultatBrut,
  type ResultatClasse,
} from './appariement';
import { ErreurMoteur, messageDe } from './erreurs';
import { classerMedia, type TypeMedia, urlHttpSure } from './garde';
import { choisir, lirePage, sembleRenduEnJs, suggererSelecteurs, texteCompact, type Noeud, type Page } from './lecteurPage';
import type { ClientSur } from './reseau';
import {
  absolue,
  adresseDeRecherche,
  sourcePourUrl,
  sourcesActives,
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
  const { page } = await chargerPage(ctx.client, url, src);
  const sortie: ResultatBrut[] = [];
  for (const el of page.tous(src.search.item)) {
    const titre = choisir(page, el, src.search.title || '&');
    const lien = choisir(page, el, src.search.link || 'a', 'href');
    if (!titre || !lien) {
      continue;
    }
    const adresse = absolue(lien, src.baseUrl);
    if (!adresse) {
      continue;
    }
    const image = absolue(choisir(page, el, src.search.image, src.search.imageAttr || 'src'), src.baseUrl);
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
  const { page } = await chargerPage(ctx.client, urlSerie, src);
  const collectes: { number: number | null; title: string | null; url: string }[] = [];
  for (const el of page.tous(src.episodes.item)) {
    const href = choisir(page, el, src.episodes.link || 'a', 'href');
    if (!href) {
      continue;
    }
    const abs = absolue(href, src.baseUrl);
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

export interface ResultatEpisodes {
  episodes: EpisodeSource[];
  source: DefinitionSource | null;
  serie: ResultatClasse | null;
  /** Meilleur candidat ecarte faute de score : explique pourquoi rien n'est lu. */
  refuse: ResultatClasse | null;
}

/** Cherche la serie sur UNE source puis lit ses episodes. */
export async function episodesSur(ctx: ContexteResolution, src: DefinitionSource, o: OptionsEpisodes): Promise<ResultatEpisodes> {
  const voulus = [...o.titres].filter(Boolean);
  const preference = (o.langue || src.language || 'indifferent') as PreferenceLangue;
  let serie: ResultatClasse | null = null;
  let pageUrl = o.url ?? null;
  let refuse: ResultatClasse | null = null;

  if (!pageUrl) {
    const vus = new Map<string, ResultatBrut>();
    for (const requete of variantesDeRecherche(voulus)) {
      try {
        for (const r of await chercherSur(ctx, src, requete, preference)) {
          if (!vus.has(r.url)) {
            vus.set(r.url, r);
          }
        }
      } catch (err) {
        journalDe(ctx)(`[source:${src.name}] recherche « ${requete} » : ${messageDe(err)}`);
        continue;
      }
      const meilleur = classerResultats([...vus.values()], voulus, preference)[0];
      if (meilleur && meilleur.baseScore >= SCORE_MINIMAL) {
        serie = meilleur;
        break;
      }
    }
    if (!serie) {
      refuse = classerResultats([...vus.values()], voulus, preference)[0] ?? null;
      return { episodes: [], source: src, serie: null, refuse };
    }
    pageUrl = serie.url;
  }
  return { episodes: await lireEpisodes(ctx, src, pageUrl), source: src, serie, refuse };
}

/** Parcourt les sources activees jusqu'a ce que l'une donne des episodes. */
export async function trouverEpisodes(
  ctx: ContexteResolution,
  sources: readonly DefinitionSource[],
  o: OptionsEpisodes,
): Promise<ResultatEpisodes> {
  let refuse: ResultatClasse | null = null;
  for (const src of sourcesActives(sources)) {
    try {
      const r = await episodesSur(ctx, src, o);
      if (r.episodes.length) {
        return r;
      }
      refuse = refuse ?? r.refuse;
    } catch (err) {
      journalDe(ctx)(`[source:${src.name}] ${messageDe(err)}`);
    }
  }
  return { episodes: [], source: null, serie: null, refuse };
}

// ---------------------------------------------------------------------------
// Lecteurs
// ---------------------------------------------------------------------------

/** Lecteurs d'une page d'episode ou de film, selon les selecteurs de la source. */
export async function lecteursSur(ctx: ContexteResolution, src: DefinitionSource, urlPage: string): Promise<Lecteur[]> {
  if (!urlPage) {
    return [];
  }
  const { page } = await chargerPage(ctx.client, urlPage, src);
  const sortie: Lecteur[] = [];
  const vus = new Set<string>();
  const ajouter = (brut: string | null, nom: string) => {
    const url = absolue(brut, src.baseUrl);
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
}

/** Cherche le film chez chaque source ayant une section films. */
export async function trouverFilm(
  ctx: ContexteResolution,
  sources: readonly DefinitionSource[],
  o: { titres: readonly string[]; annee?: number | string | null },
): Promise<ResultatFilm> {
  const voulus = [...o.titres].filter(Boolean);
  let refuse: ResultatClasse | null = null;
  for (const brute of sourcesActives(sources)) {
    if (!supporteFilms(brute)) {
      continue;
    }
    const src = vueFilm(brute);
    const vus = new Map<string, ResultatBrut>();
    let choisi: ResultatClasse | null = null;
    for (const requete of variantesDeRecherche(voulus)) {
      try {
        for (const r of await chercherSur(ctx, src, requete)) {
          if (!vus.has(r.url)) {
            vus.set(r.url, r);
          }
        }
      } catch (err) {
        journalDe(ctx)(`[source:${src.name}] film « ${requete} » : ${messageDe(err)}`);
        continue;
      }
      const classes = classerResultats([...vus.values()], voulus);
      // L'annee, quand elle figure dans le titre ou dans son bloc, departage un remake.
      const meilleur = o.annee
        ? classes.find(r => r.baseScore >= SCORE_MINIMAL && `${r.title} ${r.year ?? ''}`.includes(String(o.annee))) ?? classes[0]
        : classes[0];
      if (meilleur && meilleur.baseScore >= SCORE_MINIMAL) {
        choisi = meilleur;
        break;
      }
    }
    if (!choisi) {
      refuse = refuse ?? classerResultats([...vus.values()], voulus)[0] ?? null;
      continue;
    }
    try {
      const lecteurs = await lecteursSur(ctx, src, choisi.url);
      if (lecteurs.length) {
        return { sources: lecteurs, choisi, refuse: null, source: brute };
      }
    } catch (err) {
      journalDe(ctx)(`[source:${src.name}] ${messageDe(err)}`);
    }
  }
  return { sources: [], choisi: null, refuse, source: null };
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
    const url = urlHttpSure(absolue(brut, urlPage));
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
