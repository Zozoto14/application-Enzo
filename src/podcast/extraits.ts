/**
 * L'essentiel d'un article, tiré de sa page.
 *
 * Beaucoup de sources ne donnent qu'un titre. Pour raconter l'information
 * — pas seulement l'annoncer — on lit la page de l'article chez les médias
 * connus : le chapeau que l'éditeur fournit lui-même (balises de partage),
 * complété au besoin par le premier paragraphe.
 *
 * La liste des sites est aussi celle que le processus principal accepte
 * (voir bureau/electron/principal.mjs) : les deux doivent rester d'accord.
 */

import { resumeCourt, texteBrut } from './medias';

export const SITES_ARTICLES = [
  'lesechos.fr', 'lemonde.fr', 'lefigaro.fr', 'bfmtv.com', 'francetvinfo.fr', 'boursorama.com',
  'zonebourse.com', 'capital.fr', 'latribune.fr', 'challenges.fr', 'lexpress.fr', 'lepoint.fr',
  'leparisien.fr', 'ouest-france.fr', 'abcbourse.com', 'boursier.com', 'cnbc.com', 'marketwatch.com',
  'reuters.com', 'finance.yahoo.com', 'fool.com', 'investing.com', 'morningstar.fr', 'morningstar.com',
] as const;

/** Page d'article qu'on peut lire : https, sur un site de la liste. */
export function pageAutorisee(adresse: string | undefined): boolean {
  if (!adresse) return false;
  try {
    const url = new URL(adresse);
    return (
      url.protocol === 'https:' &&
      adresse.length < 600 &&
      SITES_ARTICLES.some(site => url.hostname === site || url.hostname.endsWith(`.${site}`))
    );
  } catch {
    return false;
  }
}

function meta(html: string, nom: string): string | undefined {
  const motif = new RegExp(
    `<meta[^>]+(?:property|name)=["']${nom}["'][^>]*content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${nom}["']`,
    'i',
  );
  const trouve = motif.exec(html);
  const valeur = trouve?.[1] ?? trouve?.[2];
  return valeur ? texteBrut(valeur) : undefined;
}

const PARASITES = /cookie|abonn|newsletter|javascript|publicit|inscri|connectez|subscribe|sign up|advertis/i;

/** Chapeau de l'article, complété du premier vrai paragraphe s'il est court. */
export function extraireResume(html: string, limite = 420): string {
  const chapeau =
    meta(html, 'og:description') ?? meta(html, 'twitter:description') ?? meta(html, 'description') ?? '';
  let texte = chapeau;
  if (texte.length < 140) {
    const corps = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ');
    const paragraphes = [...corps.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .map(trouve => texteBrut(trouve[1]))
      .filter(paragraphe => paragraphe.length >= 80 && !PARASITES.test(paragraphe) && !texte.includes(paragraphe.slice(0, 40)));
    if (paragraphes[0]) texte = `${texte} ${paragraphes[0]}`.trim();
  }
  return texte ? resumeCourt(texte, limite) : '';
}
