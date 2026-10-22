/**
 * En-têtes HTTP de sécurité, communs à toutes les réponses du serveur Esport
 * (JSON de l'API, fichiers CSV / iCal / Markdown, PDF par lien signé, page
 * publique de partage d'une strat).
 *
 * L'API n'utilise AUCUN cookie : l'authentification passe par l'en-tête
 * `Authorization: Bearer <session>`, qu'un site tiers ne peut pas poser à la
 * place du navigateur (pas de CSRF possible par formulaire ou image). CORS
 * reste donc ouvert (`*`) pour l'app (site, PC, iPhone, origines diverses),
 * sans `Access-Control-Allow-Credentials`.
 */

export const ENTETES_SECURITE = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Robots-Tag': 'noindex, nofollow',
};

export const ENTETES_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept-Language, X-Nom-Fichier, X-Sha256, Range, X-Methode, X-HTTP-Method-Override',
  'Access-Control-Max-Age': '86400',
};

/**
 * Surcharge de méthode : le frontal mutualisé (LiteSpeed / ModSecurity d'o2switch) bloque ou perd
 * certains PATCH, PUT et DELETE (ou leur préliminaire CORS). L'app les envoie alors en POST avec
 * `X-Methode` (ou `X-HTTP-Method-Override`) : la requête est traitée EXACTEMENT comme l'originale
 * (mêmes contrôles : session → appartenance → module → permission, Content-Type JSON).
 * Seules PATCH, PUT et DELETE sont acceptées, et seulement sur un POST.
 */
export const METHODES_SURCHARGEABLES = ['PATCH', 'PUT', 'DELETE'];
export const ENTETES_SURCHARGE = ['X-Methode', 'X-HTTP-Method-Override'];

/**
 * Méthode à appliquer : `undefined` sans surcharge (requête inchangée), la méthode surchargée,
 * ou `null` si la surcharge est refusée (valeur inconnue, deux en-têtes contradictoires).
 * Hors POST, les en-têtes sont ignorés (jamais de GET transformé en écriture).
 */
export function methodeSurchargee(requete) {
  if (requete.method !== 'POST') return undefined;
  const valeurs = ENTETES_SURCHARGE.map(n => requete.headers.get(n)).filter(v => v !== null).map(v => v.trim().toUpperCase());
  if (!valeurs.length) return undefined;
  if (valeurs.some(v => v !== valeurs[0]) || !METHODES_SURCHARGEABLES.includes(valeurs[0])) return null;
  return valeurs[0];
}

/** En-têtes d'un fichier téléchargé (CSV, iCal, Markdown) : jamais interprété comme une page. */
export const ENTETES_FICHIER = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
  ...ENTETES_SECURITE,
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; sandbox",
};

/** `Content-Disposition` sûr : nom ASCII sans guillemets + nom UTF-8 encodé. */
export function disposition(nom, enLigne = false) {
  const ascii = String(nom).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  return `${enLigne ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nom)}`;
}

/** Fichier : brut (téléchargement), ou, avec `?format=json`, enveloppe `{ nom, type, contenu }` (l'app l'enregistre elle-même). */
export function reponseFichier(f, url, { enLigne = false } = {}) {
  if (url.searchParams.get('format') === 'json') return { nom: f.nom, type: f.type, contenu: f.contenu };
  return new Response(f.contenu, { status: 200, headers: { ...ENTETES_FICHIER, 'Content-Type': f.type, 'Content-Disposition': disposition(f.nom, enLigne) } });
}
