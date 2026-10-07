/**
 * Thèses et actualités d'une valeur.
 *
 * Une thèse, c'est l'avis argumenté de quelqu'un sur une action : pourquoi
 * l'acheter, pourquoi s'en méfier. On en rassemble trois sortes, toujours
 * présentées pour ce qu'elles sont — des opinions, pas des faits :
 *
 * - les **analyses** publiées sur Seeking Alpha par des investisseurs
 *   (valeurs cotées aux États-Unis seulement) ;
 * - les **discussions** de particuliers sur Reddit, en français
 *   (r/vosfinances, r/Bourse) et en anglais (r/stocks, r/investing…) ;
 * - les **articles d'analyse** de la presse (« faut-il acheter… »,
 *   objectifs de cours, recommandations), via Google Actualités.
 *
 * Les adresses sont aussi la liste que le processus principal accepte de
 * télécharger (voir bureau/electron/principal.mjs) : les deux doivent
 * rester d'accord.
 */

import {
  concerne,
  lireFlux,
  lireRechercheActualites,
  motsCles,
  requeteValeur,
  resumeCourt,
  texteBrut,
  urlActualitesValeur,
  type ArticleMedia,
} from '../podcast/medias';

export type GenreThese = 'analyse' | 'discussion' | 'presse';

export interface These extends ArticleMedia {
  genre: GenreThese;
  /** Auteur, quand la source le donne (« @pseudo », « /u/pseudo »). */
  auteur?: string;
  /** Ton estimé d'après les mots du titre et du résumé, sans plus. */
  ton?: 'optimiste' | 'prudent';
  /** Nom de la valeur concernée. */
  valeur: string;
}

export interface ValeurCherchee {
  nom: string;
  /** Symbole Yahoo : « NVDA », « AI.PA ». */
  symbole?: string;
}

export interface SourceThese {
  url: string;
  genre: GenreThese | 'actualite';
  source: string;
  langue: 'fr' | 'en';
}

export interface ResultatTheses {
  theses: These[];
  actualites: ArticleMedia[];
  /** Sources qui n'ont pas répondu. */
  echecs: number;
  sources: number;
}

const REDDIT_FR = 'https://www.reddit.com/r/vosfinances+Bourse/search.rss';
const REDDIT_EN = 'https://www.reddit.com/r/stocks+investing+ValueInvesting/search.rss';
const SEEKING_ALPHA = 'https://seekingalpha.com/api/sa/combined/';
const GOOGLE = 'https://news.google.com/rss/search';

/** Un symbole américain n'a pas de suffixe de place : « NVDA », « BRK-B ». */
export function symboleAmericain(symbole: string | undefined): string | undefined {
  const propre = symbole?.trim().toUpperCase();
  return propre && /^[A-Z]{1,5}(-[A-Z])?$/.test(propre) ? propre : undefined;
}

/** Toutes les adresses à interroger pour une valeur. */
export function sourcesTheses(valeur: ValeurCherchee): SourceThese[] {
  const requete = requeteValeur(valeur.nom);
  if (!requete) {
    return [];
  }
  const americain = symboleAmericain(valeur.symbole);
  // Sur Reddit, le ticker d'une valeur américaine est plus sûr que son nom.
  const termeReddit = americain ? `${requete} OR ${americain}` : requete;
  const reddit = (base: string) =>
    `${base}?q=${encodeURIComponent(termeReddit)}&restrict_sr=on&sort=relevance&t=year`;

  const sources: SourceThese[] = [
    {
      url: `${GOOGLE}?q=${encodeURIComponent(
        `${requete} (analyse OR avis OR "faut-il" OR "objectif de cours" OR recommandation) when:60d`,
      )}&hl=fr&gl=FR&ceid=FR:fr`,
      genre: 'presse',
      source: 'Google Actualités',
      langue: 'fr',
    },
    { url: reddit(REDDIT_FR), genre: 'discussion', source: 'Reddit', langue: 'fr' },
    { url: reddit(REDDIT_EN), genre: 'discussion', source: 'Reddit', langue: 'en' },
  ];
  if (americain) {
    sources.push({ url: `${SEEKING_ALPHA}${americain}.xml`, genre: 'analyse', source: 'Seeking Alpha', langue: 'en' });
  }
  const actualites = urlActualitesValeur(valeur.nom);
  if (actualites) {
    sources.push({ url: actualites, genre: 'actualite', source: 'Google Actualités', langue: 'fr' });
  }
  return sources;
}

const OPTIMISTE =
  /\b(achat|acheter|renforce[rz]?|hausse|rebond|sous[- ]?[ée]valu[ée]e?s?|opportunit[ée]|bull(ish)?|buy|upside|undervalued|strong|beat|growth|monte)\b/gi;
const PRUDENT =
  /\b(vendre|vente|baisse|chute|sur[ée]valu[ée]e?s?|bulle|risques?|m[ée]fiance|prudence|bear(ish)?|sell|downside|overvalued|avoid|short|weak|crash|miss)\b/gi;

/** Ton d'un texte, estimé au nombre de mots positifs et négatifs. */
export function tonDe(texte: string): These['ton'] {
  const plus = (texte.match(OPTIMISTE) ?? []).length;
  const moins = (texte.match(PRUDENT) ?? []).length;
  if (plus === moins) return undefined;
  return plus > moins ? 'optimiste' : 'prudent';
}

/** Discussions Reddit : on retire la signature « submitted by … [link] [comments] ». */
export function lireReddit(xml: string, langue: 'fr' | 'en'): Array<ArticleMedia & { auteur?: string }> {
  const blocs = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  return lireFlux(xml, { nom: 'Reddit', langue }).map((article, rang) => {
    const bloc = blocs[rang] ?? '';
    const auteur = /<author>\s*<name>([^<]+)<\/name>/i.exec(bloc)?.[1]?.trim();
    const sousReddit = /<category[^>]*term="([^"]+)"/i.exec(bloc)?.[1];
    const resume = resumeCourt(
      texteBrut(article.resume).replace(/\s*submitted by\s[\s\S]*$/i, '').trim(),
    );
    return {
      ...article,
      resume,
      source: sousReddit ? `Reddit · r/${sousReddit}` : 'Reddit',
      auteur,
    };
  });
}

/** Seeking Alpha mêle analyses et dépêches : on ne garde que les analyses. */
export function lireSeekingAlpha(xml: string): Array<ArticleMedia & { auteur?: string }> {
  const blocs = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  return lireFlux(xml, { nom: 'Seeking Alpha', langue: 'en' })
    .map((article, rang) => {
      const bloc = blocs[rang] ?? '';
      const auteur =
        /<sa:author_name>([\s\S]*?)<\/sa:author_name>/i.exec(bloc)?.[1] ??
        /<dc:creator>([\s\S]*?)<\/dc:creator>/i.exec(bloc)?.[1];
      return { ...article, auteur: auteur ? texteBrut(auteur) : undefined };
    })
    .filter(article => !article.lien || /\/article\//.test(article.lien));
}

/** La thèse parle-t-elle de la valeur ? Nom ou ticker dans le titre ou le résumé. */
function pertinente(article: ArticleMedia, valeur: ValeurCherchee): boolean {
  if (concerne(article, valeur.nom)) return true;
  const americain = symboleAmericain(valeur.symbole);
  const texte = `${article.titre} ${article.resume}`;
  if (americain && new RegExp(`(^|[^A-Za-z])\\$?${americain}([^A-Za-z]|$)`).test(texte)) return true;
  // Un seul mot distinctif suffit quand le nom n'en a qu'un : « Nvidia ».
  const [premier] = motsCles(valeur.nom);
  return Boolean(premier && premier.length >= 4 && texte.toLowerCase().includes(premier));
}

function cleTitre(titre: string): string {
  return titre.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Charge thèses et actualités d'une valeur. Chaque source qui échoue est
 * comptée et ignorée : les autres suffisent souvent.
 */
export async function chargerTheses(
  valeur: ValeurCherchee,
  flux: (url: string) => Promise<string>,
  limite = 30,
): Promise<ResultatTheses> {
  const sources = sourcesTheses(valeur);
  const resultats = await Promise.allSettled(
    sources.map(async source => {
      const xml = await flux(source.url);
      if (source.genre === 'analyse') return { source, articles: lireSeekingAlpha(xml) };
      if (source.genre === 'discussion') return { source, articles: lireReddit(xml, source.langue) };
      return { source, articles: lireRechercheActualites(xml) };
    }),
  );

  const theses: These[] = [];
  const actualites: ArticleMedia[] = [];
  const vus = new Set<string>();
  let echecs = 0;
  for (const resultat of resultats) {
    if (resultat.status === 'rejected') {
      echecs += 1;
      continue;
    }
    const { source, articles } = resultat.value;
    for (const article of articles) {
      const cle = cleTitre(article.titre);
      if (vus.has(cle)) continue;
      if (source.genre === 'actualite') {
        vus.add(cle);
        actualites.push(article);
        continue;
      }
      // La recherche Google filtre déjà ; Reddit, lui, ratisse large.
      if (source.genre === 'discussion' && !pertinente(article, valeur)) continue;
      vus.add(cle);
      theses.push({
        ...article,
        genre: source.genre,
        ton: tonDe(`${article.titre} ${article.resume}`),
        valeur: valeur.nom,
      });
    }
  }
  const recents = (a: ArticleMedia, b: ArticleMedia) => b.date.localeCompare(a.date);
  return {
    theses: theses.sort(recents).slice(0, limite),
    actualites: actualites.sort(recents).slice(0, limite),
    echecs,
    sources: sources.length,
  };
}

/** Adresse de thèse que le processus principal accepte de télécharger. */
export function adresseThesesAutorisee(adresse: string): boolean {
  try {
    const url = new URL(adresse);
    if (adresse.length >= 500) return false;
    if (url.origin === 'https://seekingalpha.com') {
      return /^\/api\/sa\/combined\/[A-Z]{1,5}(-[A-Z])?\.xml$/.test(url.pathname) && url.search === '';
    }
    if (url.origin === 'https://www.reddit.com') {
      return (
        [new URL(REDDIT_FR).pathname, new URL(REDDIT_EN).pathname].includes(url.pathname) &&
        [...url.searchParams.keys()].every(cle => ['q', 'restrict_sr', 'sort', 't'].includes(cle))
      );
    }
    return false;
  } catch {
    return false;
  }
}
