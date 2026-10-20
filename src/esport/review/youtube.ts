/**
 * Adresses YouTube côté app : extraction de l'identifiant, adresse de la
 * miniature et lien à un instant donné. Mêmes règles que le serveur
 * (esport/noyau/review/youtube.mjs), mêmes tests ; le serveur reste l'autorité.
 */

const MOTIF_ID = /^[A-Za-z0-9_-]{11}$/;
const HOTES = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
const CHEMINS = new Set(['shorts', 'embed', 'live', 'v']);

export const idYoutubeValide = (id: unknown): id is string => typeof id === 'string' && MOTIF_ID.test(id);

/** « 1h2m3s », « 90s » ou « 90 » → secondes. */
export function secondesDe(texte: string | null | undefined): number | undefined {
  const t = String(texte ?? '').trim().toLowerCase();
  if (/^\d{1,6}$/.test(t)) return Number(t);
  const m = /^(?:(\d{1,3})h)?(?:(\d{1,4})m)?(?:(\d{1,6})s)?$/.exec(t);
  if (!m || !t) return undefined;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/** Identifiant (et position de départ éventuelle) d'une adresse YouTube : watch, youtu.be, shorts, embed, live. */
export function extraireYoutube(adresse: unknown): { id: string; debut?: number } | null {
  const brut = String(adresse ?? '').trim();
  if (!brut || brut.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(brut) ? brut : `https://${brut}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  const hote = url.hostname.toLowerCase();
  const morceaux = url.pathname.split('/').filter(Boolean);
  let id: string | null | undefined;
  if (hote === 'youtu.be') id = morceaux[0];
  else if (HOTES.has(hote)) {
    if (morceaux[0] === 'watch') id = url.searchParams.get('v');
    else if (CHEMINS.has(morceaux[0])) id = morceaux[1];
  }
  if (!idYoutubeValide(id)) return null;
  const debut = secondesDe(url.searchParams.get('t') ?? url.searchParams.get('start'));
  return debut === undefined ? { id } : { id, debut };
}

export const adresseYoutube = (id: string): string => `https://www.youtube.com/watch?v=${id}`;

/** Lien vers la vidéo à un instant (iOS natif : ouverture dans YouTube au bon timestamp). */
export const lienYoutubeA = (id: string, secondes: number): string => `https://www.youtube.com/watch?v=${id}&t=${Math.max(0, Math.floor(secondes))}s`;

/** Miniature (domaine ytimg, à autoriser dans les CSP : voir docs/esport/review-video.md). */
export const miniatureYoutube = (id: string): string => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
