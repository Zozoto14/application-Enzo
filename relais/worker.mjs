/**
 * Relais Cloudflare d'AppDashboard.
 *
 * Deux services, sur un compte Cloudflare gratuit :
 *
 *  - une **boîte aux lettres** où chaque appareil dépose son état, chiffré
 *    sur l'appareil avant l'envoi. Le relais ne voit que du bruit : ni
 *    montant, ni valeur, ni nom. Il ne connaît pas le mot de passe de
 *    synchronisation et ne peut rien déchiffrer ;
 *  - une **passerelle** vers Yahoo Finance et les médias, pour le site de
 *    secours : un navigateur n'a pas le droit de les appeler lui-même. Même
 *    liste fermée d'adresses que l'application de bureau (reseau.mjs).
 *
 * Tout appel exige un jeton (`Authorization: Bearer …`) : le jeton maître,
 * tiré au hasard au déploiement (administrateur), ou un jeton de PROFIL qui
 * n'ouvre que l'espace de son compte (`/p/<id>/…`, voir « Portées » plus bas
 * et docs/synchro-relais.md). Sans jeton valable, personne ne peut remplir la
 * boîte ni se servir du relais comme d'un proxy.
 */

import {
  fluxMedia,
  pageArticle,
  yahooJson,
  yahooScreener,
} from '../bureau/electron/reseau.mjs';

export const VERSION_RELAIS = 2;
/** Une enveloppe chiffrée : quelques centaines de Kio en pratique. */
const TAILLE_MAX_ENVELOPPE = 20 * 1024 * 1024;
const IDENTIFIANT_APPAREIL = /^[a-z0-9]{4,32}$/;
/** Compte d'ami (même motif que l'annuaire) ; `principal` est l'espace de l'administrateur. */
const IDENTIFIANT_PROFIL = /^(principal|[a-z0-9]{6,16})$/;
/** Nom d'un objet dans un espace : annuaire, coffre, portefeuille, compte… */
const NOM_OBJET = /^[a-z0-9][a-z0-9-]{1,39}$/;
const CLE_INDEX = 'index';
const PREFIXE_JETON_PROFIL = 'p1.';

const ENTETES_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

function reponse(corps, statut = 200, type = 'application/json; charset=utf-8') {
  return new Response(typeof corps === 'string' ? corps : JSON.stringify(corps), {
    status: statut,
    headers: { ...ENTETES_CORS, 'Content-Type': type, 'Cache-Control': 'no-store' },
  });
}

const erreur = (motif, statut) => reponse({ erreur: motif }, statut);

/** Comparaison en temps constant : la durée ne trahit pas le jeton. */
export function jetonValide(recu, attendu) {
  if (typeof recu !== 'string' || typeof attendu !== 'string' || attendu.length < 16) {
    return false;
  }
  let difference = recu.length ^ attendu.length;
  for (let i = 0; i < attendu.length; i++) {
    difference |= (recu.charCodeAt(i) || 0) ^ attendu.charCodeAt(i);
  }
  return difference === 0;
}

// ------------------------------------------------------------ Portées
//
// Deux sortes de jetons :
//  - le jeton MAÎTRE (`env.JETON`, celui de l'administrateur) : tous les droits,
//    routes historiques comprises ;
//  - un jeton de PROFIL `p1.<id>.<hmac>`, avec hmac = HMAC-SHA256(JETON,
//    « applibourse-profil-v1|<id> ») : il n'ouvre que l'espace `p/<id>/` (et la
//    passerelle Yahoo/médias). Le relais le recalcule à chaque appel : rien à
//    stocker, et l'administrateur le fabrique hors ligne (même calcul).
// Aucun jeton de profil n'existe pour `principal` : l'espace de l'administrateur
// (annuaire, données d'administration) n'est lisible qu'avec le jeton maître.

const encodeur = new TextEncoder();

function hexa(octets) {
  return [...new Uint8Array(octets)].map(o => o.toString(16).padStart(2, '0')).join('');
}

/** Jeton de profil attendu pour `id` (même calcul que src/sync/relais/portees.ts). */
export async function jetonDeProfil(jetonMaitre, id) {
  const cle = await crypto.subtle.importKey('raw', encodeur.encode(jetonMaitre), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', cle, encodeur.encode(`applibourse-profil-v1|${id}`));
  return `${PREFIXE_JETON_PROFIL}${id}.${hexa(signature)}`;
}

/** Portée du jeton présenté : `{ maitre: true }`, `{ profil: id }`, ou rien (refusé). */
export async function porteeDuJeton(recu, jetonMaitre) {
  if (typeof jetonMaitre !== 'string' || jetonMaitre.length < 16 || typeof recu !== 'string') {
    return undefined;
  }
  if (jetonValide(recu, jetonMaitre)) {
    return { maitre: true };
  }
  const morceaux = /^p1\.([a-z0-9]{6,16})\.[0-9a-f]{64}$/.exec(recu);
  if (!morceaux || morceaux[1] === 'principal') {
    return undefined;
  }
  return jetonValide(recu, await jetonDeProfil(jetonMaitre, morceaux[1])) ? { profil: morceaux[1] } : undefined;
}

// ------------------------------------------------------------- Index
//
// Chaque liste (l'historique `index` des appareils, et `p:<id>:~index` pour un
// espace) est une clé tenue à jour à chaque dépôt : une seule lecture par tour
// de synchronisation. Deux dépôts simultanés peuvent encore s'y écraser
// (lecture-modification-écriture) ; mais chaque valeur porte ses métadonnées
// ({ date, taille }), et l'index est RÉPARÉ à partir de la liste de la boîte
// (`KV.list`) au plus une fois par heure (six pour un espace) : les listes
// sont comptées à part sur l'offre gratuite (1 000 par jour), on ne peut pas
// en faire une à chaque tour.

const REPARE = '~repare';
const DELAI_REPARATION_BOITE_MS = 3_600_000;
const DELAI_REPARATION_ESPACE_MS = 6 * 3_600_000;
const DATE_INCONNUE = '1970-01-01T00:00:00.000Z';

async function lireIndexCle(env, cle) {
  const brut = await env.BOITE.get(cle);
  let lu = {};
  try {
    lu = brut ? JSON.parse(brut) : {};
  } catch {
    lu = {};
  }
  if (!lu || typeof lu !== 'object' || Array.isArray(lu)) lu = {};
  const entrees = {};
  for (const [nom, meta] of Object.entries(lu)) {
    if (!nom.startsWith('~') && meta && typeof meta === 'object') entrees[nom] = meta;
  }
  return { entrees, repare: typeof lu[REPARE] === 'string' ? lu[REPARE] : undefined };
}

async function ecrireIndexCle(env, cle, entrees, repare) {
  await env.BOITE.put(cle, JSON.stringify(repare ? { ...entrees, [REPARE]: repare } : entrees));
}

/** Lecture-modification-écriture d'une entrée (dépôt ou suppression). */
async function majIndex(env, cle, nom, meta) {
  const { entrees, repare } = await lireIndexCle(env, cle);
  if (meta) entrees[nom] = meta;
  else if (nom in entrees) delete entrees[nom];
  else return;
  await ecrireIndexCle(env, cle, entrees, repare);
}

/** Liste des clés d'un préfixe (avec pagination), et leurs métadonnées. */
async function lister(env, prefixe) {
  const trouves = {};
  let curseur;
  do {
    const page = await env.BOITE.list({ prefix: prefixe, cursor: curseur });
    for (const cle of page.keys ?? []) {
      const nom = cle.name.slice(prefixe.length);
      const meta = cle.metadata && typeof cle.metadata === 'object' ? cle.metadata : undefined;
      trouves[nom] = meta && typeof meta.date === 'string' ? { date: meta.date, taille: Number(meta.taille) || 0 } : undefined;
    }
    curseur = page.list_complete === false ? page.cursor : undefined;
  } while (curseur);
  return trouves;
}

/** L'index, réparé depuis la liste de la boîte s'il ne l'a pas été depuis `delai`. */
async function lireIndex(env, cle, prefixeValeurs, delai) {
  const { entrees, repare } = await lireIndexCle(env, cle);
  const maintenant = Date.now();
  if (typeof env.BOITE.list !== 'function' || (repare && maintenant - Date.parse(repare) < delai)) {
    return entrees;
  }
  const repares = {};
  for (const [nom, meta] of Object.entries(await lister(env, prefixeValeurs))) {
    if (nom.startsWith('~')) continue;
    repares[nom] = meta ?? entrees[nom] ?? { date: DATE_INCONNUE, taille: 0 };
  }
  await ecrireIndexCle(env, cle, repares, new Date(maintenant).toISOString());
  return repares;
}

async function corpsJson(requete) {
  try {
    return await requete.json();
  } catch {
    return undefined;
  }
}

/** Lit et valide une enveloppe déposée (même format partout). */
async function lireEnveloppe(requete, nom) {
  const texte = await requete.text();
  if (texte.length > TAILLE_MAX_ENVELOPPE) {
    return { refus: erreur('Enveloppe trop volumineuse.', 413) };
  }
  let enveloppe;
  try {
    enveloppe = JSON.parse(texte);
  } catch {
    return { refus: erreur('Enveloppe illisible.', 400) };
  }
  if (
    enveloppe?.format !== 'applibourse-relais' ||
    enveloppe.appareil !== nom ||
    typeof enveloppe.date !== 'string' ||
    enveloppe.date.length > 40 ||
    typeof enveloppe.charge !== 'string'
  ) {
    return { refus: erreur('Ce n’est pas une enveloppe AppDashboard.', 400) };
  }
  return { texte, meta: { date: enveloppe.date, taille: texte.length } };
}

/** Routes historiques (`/boite`) : jeton maître seulement, comme avant. */
async function boite(requete, env, identifiant) {
  if (identifiant === undefined) {
    if (requete.method !== 'GET') {
      return erreur('Méthode non autorisée.', 405);
    }
    const index = await lireIndex(env, CLE_INDEX, 'appareil:', DELAI_REPARATION_BOITE_MS);
    return reponse({ appareils: index });
  }
  if (!IDENTIFIANT_APPAREIL.test(identifiant)) {
    return erreur('Identifiant d’appareil invalide.', 400);
  }
  const cle = `appareil:${identifiant}`;

  if (requete.method === 'GET') {
    const enveloppe = await env.BOITE.get(cle);
    return enveloppe === null ? erreur('Aucun dépôt pour cet appareil.', 404) : reponse(enveloppe);
  }

  if (requete.method === 'PUT') {
    const { refus, texte, meta } = await lireEnveloppe(requete, identifiant);
    if (refus) return refus;
    await env.BOITE.put(cle, texte, { metadata: meta });
    await majIndex(env, CLE_INDEX, identifiant, meta);
    return reponse({ ok: true });
  }

  if (requete.method === 'DELETE') {
    await env.BOITE.delete(cle);
    await majIndex(env, CLE_INDEX, identifiant, undefined);
    return reponse({ ok: true });
  }

  return erreur('Méthode non autorisée.', 405);
}

/**
 * Espace d'un compte : `/p/<id>/boite[/<nom>]`. Lecture, écriture et
 * suppression réservées au titulaire (son jeton de profil) et à
 * l'administrateur (jeton maître). Tout autre jeton reçoit 403, que l'objet
 * existe ou non : la réponse ne dit rien de l'espace d'un autre.
 */
async function espace(requete, env, portee, id, nom) {
  if (!IDENTIFIANT_PROFIL.test(id)) {
    return erreur('Espace invalide.', 400);
  }
  if (!portee.maitre && portee.profil !== id) {
    return erreur('Cet espace n’est pas le vôtre.', 403);
  }
  const prefixe = `p:${id}:`;
  if (nom === undefined) {
    if (requete.method !== 'GET') {
      return erreur('Méthode non autorisée.', 405);
    }
    return reponse({ objets: await lireIndex(env, `${prefixe}~index`, prefixe, DELAI_REPARATION_ESPACE_MS) });
  }
  if (!NOM_OBJET.test(nom)) {
    return erreur('Nom d’objet invalide.', 400);
  }
  const cle = prefixe + nom;
  if (requete.method === 'GET') {
    const enveloppe = await env.BOITE.get(cle);
    return enveloppe === null ? erreur('Aucun dépôt.', 404) : reponse(enveloppe);
  }
  if (requete.method === 'PUT') {
    const { refus, texte, meta } = await lireEnveloppe(requete, nom);
    if (refus) return refus;
    await env.BOITE.put(cle, texte, { metadata: meta });
    await majIndex(env, `${prefixe}~index`, nom, meta);
    return reponse({ ok: true });
  }
  if (requete.method === 'DELETE') {
    await env.BOITE.delete(cle);
    await majIndex(env, `${prefixe}~index`, nom, undefined);
    return reponse({ ok: true });
  }
  return erreur('Méthode non autorisée.', 405);
}

async function passerelle(requete, chemin) {
  if (requete.method !== 'POST') {
    return erreur('Méthode non autorisée.', 405);
  }
  const corps = await corpsJson(requete);
  if (!corps || typeof corps !== 'object') {
    return erreur('Requête illisible.', 400);
  }
  try {
    switch (chemin) {
      case '/yahoo/json':
        return reponse(await yahooJson(String(corps.url)));
      case '/yahoo/screener':
        return reponse(await yahooScreener(corps.corps));
      case '/medias/flux':
        return reponse(await fluxMedia(String(corps.url)), 200, 'text/plain; charset=utf-8');
      case '/medias/page':
        return reponse(await pageArticle(String(corps.url)), 200, 'text/plain; charset=utf-8');
      default:
        return erreur('Adresse inconnue.', 404);
    }
  } catch (e) {
    const motif = e instanceof Error ? e.message : String(e);
    return erreur(motif, /non autoris/i.test(motif) ? 403 : 502);
  }
}

export default {
  async fetch(requete, env) {
    if (requete.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: ENTETES_CORS });
    }
    const autorisation = requete.headers.get('Authorization') ?? '';
    const portee = await porteeDuJeton(autorisation.replace(/^Bearer\s+/i, ''), env.JETON);
    if (!portee) {
      return erreur('Jeton du relais manquant ou incorrect.', 401);
    }

    const { pathname } = new URL(requete.url);
    if (pathname === '/sante') {
      return reponse({ ok: true, version: VERSION_RELAIS, portee: portee.maitre ? 'maitre' : 'profil', ...(portee.profil ? { profil: portee.profil } : {}) });
    }
    const dansEspace = /^\/p\/([^/]+)\/boite(?:\/([^/]*))?\/?$/.exec(pathname);
    if (dansEspace || pathname === '/boite' || pathname.startsWith('/boite/')) {
      if (!env.BOITE) {
        return erreur('Boîte non configurée sur le relais.', 500);
      }
      if (dansEspace) {
        const nom = dansEspace[2] ? decodeURIComponent(dansEspace[2]) : undefined;
        return espace(requete, env, portee, decodeURIComponent(dansEspace[1]), nom);
      }
      if (!portee.maitre) {
        return erreur('Réservé au jeton de l’administrateur.', 403);
      }
      return pathname === '/boite' || pathname === '/boite/'
        ? boite(requete, env, undefined)
        : boite(requete, env, decodeURIComponent(pathname.slice('/boite/'.length)));
    }
    return passerelle(requete, pathname);
  },
};
