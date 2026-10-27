/**
 * Page « Réseaux » de l'espace CM : règles PURES (ni base, ni réseau, ni horloge implicite).
 *
 *  - réseaux des COMPTES (X, Instagram, TikTok, YouTube, Twitch ; ajouter un réseau = une entrée de
 *    RESEAUX_COMPTES) : adresse du profil (https, domaine attendu), identifiant @ tiré de l'adresse ;
 *  - compte d'un post publié (identifiant lu dans l'adresse du post, sinon team de la carte, sinon le club) ;
 *  - type de contenu d'une carte (annonce, match, résultat, clip, sponsor, autre) ;
 *  - métriques : lecture tolérante (« 12,5 k », « 1 234 », « 0:45 », « 62 % »), taux d'engagement, évolutions ;
 *  - correspondance des colonnes d'un import CSV de relevés ; jours (AAAA-MM-JJ ou JJ/MM/AAAA).
 *
 * Les posts du CM restent sur X, Instagram et TikTok (cm/reseaux.mjs) ; un compte YouTube ou Twitch sert aux
 * statistiques (publications ajoutées à la main ou par import).
 */

import { RESEAUX } from '../cm/reseaux.mjs';

const ID_X = /^[A-Za-z0-9_]{1,15}$/;
const ID_INSTAGRAM = /^[A-Za-z0-9._]{1,30}$/;
const ID_TIKTOK = /^[A-Za-z0-9._]{2,24}$/;
const ID_YOUTUBE = /^[A-Za-z0-9._-]{3,30}$/;
const ID_TWITCH = /^[A-Za-z0-9_]{3,25}$/;

/** Segments du chemin d'une adresse (sans vides). */
const segments = u => u.pathname.split('/').filter(Boolean).map(s => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
});

/**
 * Réseaux des comptes. `hotes` : domaines acceptés (sous-domaines compris) ; `profil(u)` : identifiant lu dans
 * l'adresse d'un PROFIL (null si l'adresse n'est pas un profil) ; `dansPost(u)` : identifiant lu dans l'adresse
 * d'un POST (null si absent, ex. Instagram /p/…) ; `couleur`, `glyphe` : embed Discord et app.
 */
export const RESEAUX_COMPTES = Object.freeze({
  x: {
    cle: 'x',
    nom: 'X',
    couleur: '#0f1419',
    glyphe: '𝕏',
    hotes: ['x.com', 'twitter.com'],
    motif: ID_X,
    profil: u => {
      const s = segments(u);
      return s.length === 1 && ID_X.test(s[0]) && !['home', 'explore', 'i', 'search', 'settings'].includes(s[0].toLowerCase()) ? s[0] : null;
    },
    dansPost: u => {
      const s = segments(u);
      return s.length >= 3 && s[1] === 'status' && ID_X.test(s[0]) && s[0].toLowerCase() !== 'i' ? s[0] : null;
    },
    postProfil: id => `https://x.com/${id}`,
  },
  instagram: {
    cle: 'instagram',
    nom: 'Instagram',
    couleur: '#d62976',
    glyphe: '◎',
    hotes: ['instagram.com'],
    motif: ID_INSTAGRAM,
    profil: u => {
      const s = segments(u);
      return s.length === 1 && ID_INSTAGRAM.test(s[0]) && !['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts'].includes(s[0].toLowerCase()) ? s[0] : null;
    },
    dansPost: u => {
      const s = segments(u);
      if (s[0] === 'stories' && s[1] && ID_INSTAGRAM.test(s[1])) return s[1];
      if (s.length >= 3 && ['p', 'reel', 'tv'].includes(s[1]) && ID_INSTAGRAM.test(s[0])) return s[0];
      return null;
    },
    postProfil: id => `https://www.instagram.com/${id}/`,
  },
  tiktok: {
    cle: 'tiktok',
    nom: 'TikTok',
    couleur: '#25f4ee',
    glyphe: '♪',
    hotes: ['tiktok.com'],
    motif: ID_TIKTOK,
    profil: u => {
      const s = segments(u);
      return s.length === 1 && s[0].startsWith('@') && ID_TIKTOK.test(s[0].slice(1)) ? s[0].slice(1) : null;
    },
    dansPost: u => {
      const s = segments(u);
      return s.length >= 2 && s[0].startsWith('@') && ID_TIKTOK.test(s[0].slice(1)) ? s[0].slice(1) : null;
    },
    postProfil: id => `https://www.tiktok.com/@${id}`,
  },
  youtube: {
    cle: 'youtube',
    nom: 'YouTube',
    couleur: '#ff0000',
    glyphe: '▶',
    hotes: ['youtube.com', 'youtu.be'],
    motif: ID_YOUTUBE,
    profil: u => {
      const s = segments(u);
      if (s.length >= 1 && s[0].startsWith('@') && ID_YOUTUBE.test(s[0].slice(1)) && (s.length === 1 || ['videos', 'shorts', 'streams', 'featured'].includes(s[1]))) return s[0].slice(1);
      if (s.length === 2 && (s[0] === 'c' || s[0] === 'user') && ID_YOUTUBE.test(s[1])) return s[1];
      if (s.length === 2 && s[0] === 'channel' && /^UC[A-Za-z0-9_-]{10,40}$/.test(s[1])) return s[1];
      return null;
    },
    dansPost: u => {
      const s = segments(u);
      return s.length >= 2 && s[0].startsWith('@') && ID_YOUTUBE.test(s[0].slice(1)) ? s[0].slice(1) : null;
    },
    postProfil: id => `https://www.youtube.com/@${id}`,
  },
  twitch: {
    cle: 'twitch',
    nom: 'Twitch',
    couleur: '#9146ff',
    glyphe: '◆',
    hotes: ['twitch.tv'],
    motif: ID_TWITCH,
    profil: u => {
      const s = segments(u);
      return s.length === 1 && ID_TWITCH.test(s[0]) && !['directory', 'videos', 'settings', 'search'].includes(s[0].toLowerCase()) ? s[0] : null;
    },
    dansPost: u => {
      const s = segments(u);
      return s.length >= 2 && ID_TWITCH.test(s[0]) && ['clip', 'videos', 'video'].includes(s[1]) ? s[0] : null;
    },
    postProfil: id => `https://www.twitch.tv/${id}`,
  },
});
export const CLES_RESEAUX_COMPTES = Object.freeze(Object.keys(RESEAUX_COMPTES));

/** Types de contenu (tableaux de bord « par type ») ; « autre » par défaut. */
export const TYPES_CONTENU = Object.freeze(['annonce', 'match', 'resultat', 'clip', 'sponsor', 'coulisses', 'recrutement', 'autre']);

/** Métriques d'un relevé de publication (entiers, sauf `duree_moyenne` en secondes et `taux_completion` en %). */
export const METRIQUES_POST = Object.freeze(['vues', 'likes', 'commentaires', 'partages', 'enregistrements', 'impressions', 'portee', 'clics', 'duree_moyenne', 'taux_completion']);
/** Métriques d'un relevé de compte. */
export const METRIQUES_COMPTE = Object.freeze(['abonnes', 'publications', 'vues', 'impressions']);
/** Métriques décimales (les autres sont des nombres entiers). */
export const METRIQUES_DECIMALES = Object.freeze(['duree_moyenne', 'taux_completion']);
/** Noms JSON (camelCase) des métriques côté API. */
export const NOMS_API = Object.freeze({ duree_moyenne: 'dureeMoyenne', taux_completion: 'tauxCompletion' });
export const nomApi = m => NOMS_API[m] ?? m;

const MAX_ENTIER = 100_000_000_000;

/** Nom d'hôte d'une adresse, sans « www. » ni « m. » ; null si illisible. */
function hoteDe(u) {
  return u.hostname.toLowerCase().replace(/^(www|m|mobile|vm)\./, '');
}

/** Adresse https propre (sans identifiants ni port), bornée ; null sinon. */
export function adresseHttps(texte, max = 300) {
  if (typeof texte !== 'string') return null;
  const t = texte.trim();
  if (!t || t.length > max || !/^https:\/\/[^\s<>"'`\\]+$/i.test(t)) return null;
  try {
    const u = new URL(t);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
    return u;
  } catch {
    return null;
  }
}

/** L'adresse est-elle sur un domaine du réseau (sous-domaines compris) ? */
export function surDomaine(u, reseau) {
  const r = RESEAUX_COMPTES[reseau];
  if (!r || !u) return false;
  const h = hoteDe(u);
  return r.hotes.some(x => h === x || h.endsWith(`.${x}`));
}

/** Réseau d'une adresse (post ou profil) d'après son domaine ; null si inconnu. */
export function reseauDeUrl(texte) {
  const u = adresseHttps(texte, 500);
  if (!u) return null;
  return CLES_RESEAUX_COMPTES.find(r => surDomaine(u, r)) ?? null;
}

/** Identifiant saisi : « @Club_GG », « club_gg » → « Club_GG » (sans @) ; null si invalide pour le réseau. */
export function lireIdentifiant(texte, reseau) {
  const r = RESEAUX_COMPTES[reseau];
  if (!r || typeof texte !== 'string') return null;
  const t = texte.trim().replace(/^@/, '');
  return r.motif.test(t) ? t : null;
}

export const memeIdentifiant = (a, b) => typeof a === 'string' && typeof b === 'string' && a.replace(/^@/, '').toLowerCase() === b.replace(/^@/, '').toLowerCase();

/**
 * Adresse d'un profil validée : `{ url, identifiant }` (identifiant lu dans l'adresse ; YouTube /channel/UC… :
 * l'identifiant de la chaîne), ou `{ erreur: 'url' }` (pas https, mauvais domaine, pas une adresse de profil).
 */
export function validerUrlProfil(texte, reseau) {
  const r = RESEAUX_COMPTES[reseau];
  const u = adresseHttps(texte);
  if (!r || !u || !surDomaine(u, reseau)) return { erreur: 'url' };
  const id = r.profil(u);
  if (id === null) return { erreur: 'url' };
  return { url: u.toString(), identifiant: id };
}

/** Adresse d'une publication (post, vidéo) validée pour un réseau : texte propre, ou null. */
export function validerUrlPublication(texte, reseau) {
  const u = adresseHttps(texte, 500);
  if (!u || !surDomaine(u, reseau)) return null;
  if (segments(u).length === 0) return null;
  return u.toString();
}

/** Adresse normalisée pour comparer deux adresses de post (sans paramètres, ancre ni « / » final, hôte simplifié). */
export function cleUrl(texte) {
  const u = adresseHttps(String(texte ?? ''), 500);
  if (!u) return String(texte ?? '').trim().toLowerCase();
  return `${hoteDe(u).replace(/^twitter\.com$/, 'x.com')}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();
}

/** Identifiant de compte lu dans l'adresse d'un post (X, TikTok, YouTube, Twitch ; Instagram : rarement). */
export function identifiantDansUrlPost(texte, reseau) {
  const r = RESEAUX_COMPTES[reseau];
  const u = adresseHttps(String(texte ?? ''), 500);
  if (!r || !u || !surDomaine(u, reseau)) return null;
  return r.dansPost(u);
}

/**
 * Compte d'un post publié parmi les comptes ACTIFS (non supprimés) : `{ id, reseau, identifiant, team_id, position }`.
 *  1. l'identifiant lu dans l'adresse du post (X : x.com/<compte>/status/…, TikTok : /@<compte>/…) — s'il est lu
 *     mais ne correspond à aucun compte configuré, le post n'est rattaché à AUCUN compte (pas d'annonce au nom
 *     d'un autre compte) ;
 *  2. sinon le compte de la team de la carte sur ce réseau ;
 *  3. sinon le compte du club sur ce réseau ; enfin le seul compte du réseau s'il n'y en a qu'un.
 */
export function compteDuPost({ url, reseau, teamId = null }, comptes) {
  const candidats = comptes.filter(c => c.reseau === reseau && Number(c.actif ?? 1) === 1 && !c.supprime_le).sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0) || String(a.cree_le ?? '').localeCompare(String(b.cree_le ?? '')));
  const id = identifiantDansUrlPost(url, reseau);
  if (id) return candidats.find(c => memeIdentifiant(c.identifiant, id)) ?? null;
  if (teamId) {
    const team = candidats.find(c => c.team_id === teamId);
    if (team) return team;
  }
  const club = candidats.find(c => !c.team_id);
  if (club) return club;
  return candidats.length === 1 ? candidats[0] : null;
}

/**
 * Type de contenu d'une carte CM : suggestion automatique (tournoi → annonce, J-1 / Jour J → match, résultat et
 * classement final → résultat), clip joint → clip, partenaire mentionné → sponsor, liens vers un résultat ou un
 * match ; sinon « autre ».
 */
export function typeContenuDeCarte({ origine, origine_cle: cle, liens = {} } = {}) {
  const prefixe = typeof cle === 'string' ? cle.split(':')[0] : '';
  if (prefixe === 'tournoi') return 'annonce';
  if (prefixe === 'j1' || prefixe === 'jourj') return 'match';
  if (prefixe === 'resultat' || prefixe === 'final') return 'resultat';
  if (origine === 'clip' || liens.clips?.length) return 'clip';
  if (liens.sponsors?.length) return 'sponsor';
  if (liens.resultatId) return 'resultat';
  if (liens.matchId) return 'match';
  if (liens.tournoiId) return 'annonce';
  return 'autre';
}

/** Une publication de ce réseau est-elle a priori une vidéo ? (TikTok, YouTube, Twitch ; clip ; Reel Instagram). */
export function estVideo(reseau, { type, url } = {}) {
  if (['tiktok', 'youtube', 'twitch'].includes(reseau)) return true;
  if (type === 'clip') return true;
  return reseau === 'instagram' && /\/(reel|reels|tv)\//.test(String(url ?? ''));
}

// ------------------------------------------------------------------ Nombres et jours

/**
 * Nombre ENTIER saisi (≥ 0) : 1234, « 1 234 », « 1,234 », « 1.234 » (séparateurs de milliers), « 12,5 k »,
 * « 1.2M », « 3 Md ». Vide : null. `undefined` si illisible.
 */
export function lireEntier(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 && v <= MAX_ENTIER ? Math.round(v) : undefined;
  if (typeof v !== 'string') return undefined;
  let t = v.replace(/[\s  ]/g, '').toLowerCase();
  if (!t) return null;
  let facteur = 1;
  const suffixe = /(k|m|md|mds|b|bn)$/.exec(t);
  if (suffixe) {
    facteur = { k: 1e3, m: 1e6, md: 1e9, mds: 1e9, b: 1e9, bn: 1e9 }[suffixe[1]];
    t = t.slice(0, -suffixe[1].length);
    if (!/^\d+([.,]\d{1,3})?$/.test(t)) return undefined;
    const n = Number(t.replace(',', '.')) * facteur;
    return n <= MAX_ENTIER ? Math.round(n) : undefined;
  }
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) t = t.replace(/[.,]/g, '');
  if (!/^\d+$/.test(t)) return undefined;
  const n = Number(t);
  return n <= MAX_ENTIER ? n : undefined;
}

/** Nombre DÉCIMAL (≥ 0) : « 12,5 », « 12.5 », « 62 % », « 0:45 » / « 1:02:03 » (durée → secondes). Vide : null. */
export function lireDecimal(v, { max = 1e9 } = {}) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v * 100) / 100 : undefined;
  if (typeof v !== 'string') return undefined;
  const t = v.replace(/[\s  ]/g, '').replace(/%$/, '').replace(/s$/i, '');
  if (!t) return null;
  if (/^\d{1,3}(:\d{2}){1,2}$/.test(t)) {
    const n = t.split(':').reduce((s, x) => s * 60 + Number(x), 0);
    return n <= max ? n : undefined;
  }
  if (!/^\d+([.,]\d+)?$/.test(t)) return undefined;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) && n <= max ? Math.round(n * 100) / 100 : undefined;
}

export const MOTIF_JOUR = /^\d{4}-\d{2}-\d{2}$/;

/** Jour civil valide (2000-2100) ; accepte aussi JJ/MM/AAAA. Rend « AAAA-MM-JJ » ou null. */
export function lireJour(v) {
  if (typeof v !== 'string') return null;
  let t = v.trim();
  const fr = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (fr) t = `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}`;
  t = t.slice(0, 10);
  if (!MOTIF_JOUR.test(t)) return null;
  const ms = Date.parse(`${t}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== t || t < '2000-01-01' || t > '2100-12-31') return null;
  return t;
}

const JOUR_MS = 86_400_000;
export const ajouterJours = (j, n) => new Date(Date.parse(`${j}T00:00:00Z`) + n * JOUR_MS).toISOString().slice(0, 10);
export const ecartJours = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / JOUR_MS);

/** Jour civil (AAAA-MM-JJ) d'un instant dans un fuseau (heure de Paris pour le club). */
export function jourDans(ms, fuseau = 'Europe/Paris') {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/**
 * Métriques saisies → `{ champ: valeur | null }` pour les champs donnés (noms base ou API) ; `{ erreur: champ }`
 * à la première valeur illisible. Le taux de complétion est borné à 100 %.
 */
export function normaliserMetriques(saisie, champs) {
  const sortie = {};
  for (const m of champs) {
    const brut = saisie?.[m] !== undefined ? saisie[m] : saisie?.[nomApi(m)];
    const v = METRIQUES_DECIMALES.includes(m) ? lireDecimal(brut, { max: m === 'taux_completion' ? 100 : 86_400 }) : lireEntier(brut);
    if (v === undefined) return { erreur: m };
    sortie[m] = v;
  }
  return sortie;
}

// ------------------------------------------------------------------ Calculs

const nombre = v => (v === null || v === undefined || v === '' ? null : Number(v));

/** Interactions d'un relevé : likes + commentaires + partages + enregistrements (valeurs absentes : 0). */
export function interactions(r) {
  const vals = ['likes', 'commentaires', 'partages', 'enregistrements'].map(k => nombre(r?.[k]));
  if (vals.every(v => v === null)) return null;
  return vals.reduce((s, v) => s + (v ?? 0), 0);
}

/** Base du taux d'engagement : impressions, sinon portée, sinon vues (null si aucune ou 0). */
export function baseEngagement(r) {
  for (const k of ['impressions', 'portee', 'vues']) {
    const v = nombre(r?.[k]);
    if (v !== null && v > 0) return v;
  }
  return null;
}

/** Taux d'engagement en % (2 décimales) : interactions / base ; null si non calculable. */
export function tauxEngagement(r) {
  const i = interactions(r);
  const b = baseEngagement(r);
  if (i === null || b === null) return null;
  return Math.round((i / b) * 10_000) / 100;
}

/** Taux d'engagement global d'un ensemble de relevés (somme des interactions / somme des bases). */
export function tauxEngagementGlobal(releves) {
  let i = 0;
  let b = 0;
  for (const r of releves) {
    const x = interactions(r);
    const y = baseEngagement(r);
    if (x === null || y === null) continue;
    i += x;
    b += y;
  }
  return b > 0 ? Math.round((i / b) * 10_000) / 100 : null;
}

/** Variation en % de `avant` à `apres` (1 décimale) ; null si non calculable. */
export function variationPct(avant, apres) {
  const a = nombre(avant);
  const b = nombre(apres);
  if (a === null || b === null || a <= 0) return null;
  return Math.round(((b - a) / a) * 1000) / 10;
}

/**
 * Évolution des relevés d'une publication (triés par jour) : pour chacun, J+n depuis la publication et l'écart
 * avec le relevé précédent (vues, interactions), plus le taux d'engagement.
 */
export function evolutionPost(releves, publieLeJour) {
  const tries = [...releves].sort((a, b) => String(a.jour).localeCompare(String(b.jour)));
  let prec = null;
  return tries.map(r => {
    const i = interactions(r);
    const e = {
      jour: r.jour,
      jPlus: publieLeJour ? ecartJours(publieLeJour, r.jour) : null,
      engagement: tauxEngagement(r),
      interactions: i,
      ecartVues: prec && nombre(prec.vues) !== null && nombre(r.vues) !== null ? Number(r.vues) - Number(prec.vues) : null,
      ecartInteractions: prec && interactions(prec) !== null && i !== null ? i - interactions(prec) : null,
    };
    prec = r;
    return e;
  });
}

/**
 * Évolution des abonnés d'un compte sur une période [du, au] : série (relevés de la période, précédée du dernier
 * relevé d'avant la période comme point de départ), variation absolue et en %.
 */
export function evolutionAbonnes(releves, du, au) {
  const tries = [...releves].filter(r => nombre(r.abonnes) !== null).sort((a, b) => String(a.jour).localeCompare(String(b.jour)));
  const avant = tries.filter(r => r.jour < du).at(-1) ?? null;
  const dans = tries.filter(r => r.jour >= du && r.jour <= au);
  const serie = [...(avant ? [avant] : []), ...dans].map(r => ({ jour: r.jour, abonnes: Number(r.abonnes) }));
  const debut = serie[0]?.abonnes ?? null;
  const fin = serie.at(-1)?.abonnes ?? null;
  return { serie, debut, fin, variation: debut !== null && fin !== null && serie.length > 1 ? fin - debut : null, variationPct: serie.length > 1 ? variationPct(debut, fin) : null };
}

/** Dernier relevé (jour le plus récent) d'une liste ; null si vide. */
export const dernierReleve = releves => [...releves].sort((a, b) => String(b.jour).localeCompare(String(a.jour)))[0] ?? null;

// ------------------------------------------------------------------ Import CSV

/** Champs d'un import de relevés de PUBLICATIONS. */
export const CHAMPS_IMPORT_POSTS = Object.freeze(['url', 'reseau', 'jour', 'publie_le', 'titre', 'type', ...METRIQUES_POST]);
/** Champs d'un import de relevés de COMPTES. */
export const CHAMPS_IMPORT_COMPTES = Object.freeze(['compte', 'reseau', 'jour', ...METRIQUES_COMPTE]);

const sansAccents = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();

const ALIAS = {
  url: ['url', 'lien', 'link', 'adresse', 'post', 'post url', 'permalink', 'lien du post', 'video link', 'lien de la video'],
  reseau: ['reseau', 'network', 'platform', 'plateforme', 'social network'],
  jour: ['jour', 'date', 'date du releve', 'releve', 'day', 'as of', 'snapshot date'],
  publie_le: ['publie le', 'date de publication', 'published', 'publish time', 'post time', 'published at', 'date publication'],
  titre: ['titre', 'title', 'description', 'caption', 'legende'],
  type: ['type', 'type de contenu', 'content type', 'categorie', 'category'],
  vues: ['vues', 'views', 'video views', 'lectures', 'plays'],
  likes: ['likes', 'j aime', 'mentions j aime', 'reactions', 'hearts'],
  commentaires: ['commentaires', 'comments', 'replies', 'reponses'],
  partages: ['partages', 'shares', 'reposts', 'retweets'],
  enregistrements: ['enregistrements', 'saves', 'saved', 'bookmarks', 'favoris'],
  impressions: ['impressions'],
  portee: ['portee', 'reach', 'accounts reached', 'comptes touches'],
  clics: ['clics', 'clicks', 'link clicks', 'clics sur le lien'],
  duree_moyenne: ['duree moyenne', 'duree de visionnage moyenne', 'average watch time', 'avg watch time', 'average view duration'],
  taux_completion: ['taux de completion', 'completion rate', 'watched full video', 'full video watched', 'completion'],
  compte: ['compte', 'account', 'identifiant', 'handle', 'username', 'profil', 'profile'],
  abonnes: ['abonnes', 'followers', 'subscribers', 'abonnements'],
  publications: ['publications', 'posts', 'nombre de posts', 'videos'],
};

/** Correspondance proposée `{ indexColonne: champ }` à partir des en-têtes (un champ au plus une fois). */
export function correspondanceProposee(entetes, champs) {
  const sortie = {};
  const pris = new Set();
  entetes.forEach((e, i) => {
    const t = sansAccents(e);
    for (const champ of champs) {
      if (pris.has(champ)) continue;
      if (t === sansAccents(champ) || (ALIAS[champ] ?? []).some(a => sansAccents(a) === t)) {
        sortie[i] = champ;
        pris.add(champ);
        return;
      }
    }
  });
  return sortie;
}

/** Type de contenu saisi (français, anglais) → clé de TYPES_CONTENU ; `undefined` si inconnu, « autre » si vide. */
export function lireTypeContenu(v) {
  if (v === undefined || v === null || v === '') return 'autre';
  const t = sansAccents(v);
  const alias = { annonce: 'annonce', announcement: 'annonce', match: 'match', resultat: 'resultat', result: 'resultat', results: 'resultat', clip: 'clip', highlight: 'clip', sponsor: 'sponsor', partenaire: 'sponsor', coulisses: 'coulisses', 'behind the scenes': 'coulisses', bts: 'coulisses', recrutement: 'recrutement', recruitment: 'recrutement', autre: 'autre', other: 'autre' };
  return alias[t];
}

/** Réseau saisi (nom ou clé) → clé de RESEAUX_COMPTES ; undefined si inconnu. */
export function lireReseau(v) {
  const t = sansAccents(v).replace(/\s+/g, '');
  if (!t) return undefined;
  if (t === 'twitter') return 'x';
  return CLES_RESEAUX_COMPTES.find(r => r === t || sansAccents(RESEAUX_COMPTES[r].nom).replace(/\s+/g, '') === t);
}

/** Les réseaux de post du CM sont-ils tous connus des comptes ? (garde-fou : X, Instagram, TikTok.) */
export const RESEAUX_POSTS_COUVERTS = Object.keys(RESEAUX).every(r => r in RESEAUX_COMPTES);
