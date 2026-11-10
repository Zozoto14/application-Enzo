/**
 * Liens d'épisodes trouvés sur la page d'une série (LienAnime). À part de liensManuels.ts : l'analyseur HTML n'est
 * chargé qu'à l'ouverture de Tsuzuku, pas au démarrage du hub par la synchro (docs/performance.md).
 */

import { analyserAdresse, adresseEnTexte } from './adresse';
import { analyserUrlHttp } from './garde';
import { lirePage } from './lecteurPage';
import { EPISODE_HREF, EPISODE_TEXTE, EPISODES_MAX, type LienEpisode } from './liensManuels';

/**
 * Heuristique pour la page d'une serie d'un site sans selecteurs : on garde
 * les liens du meme site dont le texte ou l'adresse designe un episode.
 */
export function extraireLiensEpisodes(html: string, adressePage: string): LienEpisode[] {
  const page = lirePage(html);
  const base = analyserUrlHttp(adressePage);
  const hote = base.hote.replace(/^www\./, '');
  const courante = adresseEnTexte({ ...base, fragment: '' }).replace(/\/+$/, '');
  const parNumero = new Map<number, LienEpisode>();
  for (const el of page.tous('a[href]')) {
    const cible = analyserAdresse(page.attr(el, 'href'), adressePage);
    if (!cible || (cible.schema !== 'http' && cible.schema !== 'https') || cible.hote.replace(/^www\./, '') !== hote) {
      continue;
    }
    const sansAncre = adresseEnTexte({ ...cible, fragment: '' });
    if (sansAncre.replace(/\/+$/, '') === courante) {
      continue;
    }
    const texte = `${page.texte(el)} ${page.attr(el, 'title') || ''}`.replace(/\s+/g, ' ');
    const slug = cible.chemin.replace(/\/+$/, '').split('/').pop() || '';
    const trouve = EPISODE_TEXTE.exec(texte) || EPISODE_HREF.exec(slug) || EPISODE_HREF.exec(cible.requete);
    const numero = Number((trouve || [])[1]);
    if (!Number.isInteger(numero) || numero < 0 || numero > EPISODES_MAX) {
      continue;
    }
    if (!parNumero.has(numero)) {
      parNumero.set(numero, { number: numero, url: sansAncre });
    }
  }
  return [...parNumero.values()].sort((a, b) => a.number - b.number);
}
