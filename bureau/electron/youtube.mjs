/**
 * Lecteur YouTube de la review vidéo (Esport, phase 5) dans l'app PC.
 *
 * Les sous-cadres sont bloqués par défaut (seuls les lecteurs de Tsuzuku
 * déclarés passent). Le lecteur de la review a besoin d'UN sous-cadre précis :
 * `https://www.youtube-nocookie.com/embed/<id>` (ou youtube.com/embed/<id>),
 * créé par l'API IFrame. Rien d'autre de YouTube n'est autorisé en sous-cadre.
 *
 * Depuis une page `file://`, YouTube refuse parfois la lecture intégrée faute
 * de référent (erreur 153) : on pose un référent générique sur ces seules
 * requêtes de sous-cadre. Module sans Electron, testé seul.
 */

const HOTES = new Set(['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'youtube-nocookie.com']);
export const REFERENT_YOUTUBE = 'https://applibourse.invalid/';

export function sousCadreYoutube(adresse) {
  try {
    const u = new URL(String(adresse));
    return u.protocol === 'https:' && !u.username && !u.password && HOTES.has(u.hostname) && /^\/embed\/[A-Za-z0-9_-]{11}\/?$/.test(u.pathname);
  } catch {
    return false;
  }
}

/** En-têtes à envoyer pour une requête de sous-cadre YouTube (les autres requêtes ne changent pas). */
export function entetesYoutube(details) {
  if (details.resourceType !== 'subFrame' || !sousCadreYoutube(details.url)) return details.requestHeaders;
  return { ...details.requestHeaders, Referer: REFERENT_YOUTUBE };
}
