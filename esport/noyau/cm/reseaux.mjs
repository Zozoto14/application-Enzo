/**
 * Réseaux sociaux de la section CM et règles des textes (PUR : aucune base, aucun réseau). La même logique
 * est reprise côté app (src/esport/cm/reseaux.ts) pour le compteur de caractères en direct ; le serveur
 * reste seul juge (soumission refusée si un texte dépasse la limite du réseau).
 *
 * Pas d'API des réseaux : les textes sont préparés ici, puis copiés à la main dans l'application du réseau.
 * Ajouter un réseau = ajouter une entrée à RESEAUX (et ses libellés dans l'app) ; rien d'autre à changer.
 *
 *  - X : 280 caractères « pondérés » (règle de X : une adresse compte 23 caractères ; emoji, idéogrammes et
 *    caractères hors latin étendu comptent 2) ;
 *  - Instagram : 2 200 caractères, 30 hashtags au plus ;
 *  - TikTok : 4 000 caractères (légende).
 */

export const RESEAUX = Object.freeze({
  x: { cle: 'x', nom: 'X', limite: 280, pondere: true, hashtagsMax: null, hotes: ['x.com', 'twitter.com', 'mobile.twitter.com'] },
  instagram: { cle: 'instagram', nom: 'Instagram', limite: 2200, pondere: false, hashtagsMax: 30, hotes: ['instagram.com', 'www.instagram.com'] },
  tiktok: { cle: 'tiktok', nom: 'TikTok', limite: 4000, pondere: false, hashtagsMax: null, hotes: ['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com'] },
});
export const CLES_RESEAUX = Object.freeze(Object.keys(RESEAUX));
export const LANGUES_POST = Object.freeze(['fr', 'en']);
/** Longueur maximale stockée d'un texte (brouillon) ; la limite du réseau ne s'impose qu'à la soumission. */
export const TEXTE_POST_MAX = 5000;

const MOTIF_URL = /https?:\/\/[^\s<>"']+/giu;
const MOTIF_HASHTAG = /(^|[^\p{L}\p{N}_&/])#([\p{L}\p{N}_]{1,100})/gu;
const MOTIF_MENTION = /(^|[^\p{L}\p{N}_.@/])@([A-Za-z0-9_.]{1,40})/gu;

/** Poids d'un caractère pour X : 1 pour le latin courant, 2 pour le reste (emoji, CJK…). */
function poidsX(point) {
  if (point <= 0x10ff) return 1;
  if (point >= 0x2000 && point <= 0x200d) return 1;
  if (point >= 0x2010 && point <= 0x201f) return 1;
  if (point >= 0x2032 && point <= 0x2037) return 1;
  return 2;
}

/** Nombre de caractères d'un texte pour un réseau (X : pondéré, adresses à 23). */
export function compterCaracteres(texte, reseau) {
  const t = String(texte ?? '').normalize('NFC');
  const r = RESEAUX[reseau];
  if (!r?.pondere) return [...t].length;
  let total = 0;
  let reste = t;
  for (const url of t.match(MOTIF_URL) ?? []) {
    total += 23;
    reste = reste.replace(url, '');
  }
  // Une séquence emoji (avec ZWJ et sélecteurs de variante) compte 2 en tout, pas par point de code.
  const sansJointures = reste.replace(/‍[\p{Extended_Pictographic}]/gu, '').replace(/[︎️]/g, '').replace(/[\u{1f3fb}-\u{1f3ff}]/gu, '');
  for (const c of sansJointures) total += poidsX(c.codePointAt(0));
  return total;
}

/** Hashtags (sans le #, dans l'ordre, sans doublon insensible à la casse) d'un texte. */
export function hashtags(texte) {
  const vus = new Set();
  const sortie = [];
  for (const m of String(texte ?? '').matchAll(MOTIF_HASHTAG)) {
    const k = m[2].toLowerCase();
    if (/^\d+$/.test(m[2]) || vus.has(k)) continue;
    vus.add(k);
    sortie.push(m[2]);
  }
  return sortie;
}

/** Mentions (@compte) d'un texte, sans le @. */
export function mentions(texte) {
  const vus = new Set();
  const sortie = [];
  for (const m of String(texte ?? '').matchAll(MOTIF_MENTION)) {
    const k = m[2].replace(/\.+$/, '').toLowerCase();
    if (!k || vus.has(k)) continue;
    vus.add(k);
    sortie.push(m[2].replace(/\.+$/, ''));
  }
  return sortie;
}

/** Analyse d'un texte pour un réseau : longueur, limite, hashtags, mentions, problèmes. */
export function analyserTexte(texte, reseau) {
  const r = RESEAUX[reseau];
  const longueur = compterCaracteres(texte, reseau);
  const tags = hashtags(texte);
  const problemes = [];
  if (r && longueur > r.limite) problemes.push('trop-long');
  if (r?.hashtagsMax && tags.length > r.hashtagsMax) problemes.push('trop-de-hashtags');
  return { longueur, limite: r?.limite ?? null, hashtags: tags, mentions: mentions(texte), problemes };
}

/** Adresse d'un post publié : https, sur un domaine du réseau. */
export function urlPostValide(url, reseau) {
  const r = RESEAUX[reseau];
  if (!r || typeof url !== 'string' || url.length > 500 || !/^https:\/\/[^\s<>"'`\\]+$/i.test(url)) return false;
  try {
    const hote = new URL(url).hostname.toLowerCase();
    return r.hotes.some(h => hote === h || hote.endsWith(`.${h}`));
  } catch {
    return false;
  }
}
