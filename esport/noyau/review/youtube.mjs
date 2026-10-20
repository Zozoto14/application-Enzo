/**
 * Adresses YouTube : extraction et validation de l'identifiant de vidéo.
 * Fonctions PURES (aucun réseau). Formats acceptés : watch?v=, youtu.be/,
 * /shorts/, /embed/, /live/ (et /v/), sur youtube.com, www., m., music. et
 * youtube-nocookie.com. Tout autre hôte (dont `youtube.com.exemple.fr`) est refusé.
 *
 * Miroir côté app : src/esport/review/youtube.ts (mêmes règles, mêmes tests).
 */

const MOTIF_ID = /^[A-Za-z0-9_-]{11}$/;
const HOTES = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
const CHEMINS = new Set(['shorts', 'embed', 'live', 'v']);

export const idYoutubeValide = id => typeof id === 'string' && MOTIF_ID.test(id);

/** « 1h2m3s », « 90s » ou « 90 » → secondes (ou undefined). */
export function secondesDe(texte) {
  const t = String(texte ?? '').trim().toLowerCase();
  if (/^\d{1,6}$/.test(t)) return Number(t);
  const m = /^(?:(\d{1,3})h)?(?:(\d{1,4})m)?(?:(\d{1,6})s)?$/.exec(t);
  if (!m || !t) return undefined;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/**
 * Extrait l'identifiant d'une adresse YouTube. Rend `{ id, debut }` (`debut` :
 * position de départ en secondes, si l'adresse en porte une) ou `null`.
 */
export function extraireYoutube(adresse) {
  const brut = String(adresse ?? '').trim();
  if (!brut || brut.length > 2048) return null;
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(brut) ? brut : `https://${brut}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  const hote = url.hostname.toLowerCase();
  const morceaux = url.pathname.split('/').filter(Boolean);
  let id;
  if (hote === 'youtu.be') {
    id = morceaux[0];
  } else if (HOTES.has(hote)) {
    if (morceaux[0] === 'watch') id = url.searchParams.get('v');
    else if (CHEMINS.has(morceaux[0])) id = morceaux[1];
  }
  if (!idYoutubeValide(id)) return null;
  const debut = secondesDe(url.searchParams.get('t') ?? url.searchParams.get('start') ?? '');
  return { id, debut };
}

/** Adresse canonique stockée. */
export const adresseYoutube = id => `https://www.youtube.com/watch?v=${id}`;

/** Lien vers la vidéo à un instant donné (iOS natif : ouverture dans YouTube). */
export const lienYoutubeA = (id, secondes) => `https://www.youtube.com/watch?v=${id}&t=${Math.max(0, Math.floor(secondes))}s`;
