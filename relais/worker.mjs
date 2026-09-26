/**
 * Relais Cloudflare d'AppliBourse.
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
 * Tout appel exige le jeton du relais (`Authorization: Bearer …`), tiré au
 * hasard au déploiement : sans lui, personne ne peut remplir la boîte ni se
 * servir du relais comme d'un proxy.
 */

import {
  fluxMedia,
  pageArticle,
  yahooJson,
  yahooScreener,
} from '../bureau/electron/reseau.mjs';

export const VERSION_RELAIS = 1;
/** Une enveloppe chiffrée : quelques centaines de Kio en pratique. */
const TAILLE_MAX_ENVELOPPE = 20 * 1024 * 1024;
const IDENTIFIANT_APPAREIL = /^[a-z0-9]{4,32}$/;
const CLE_INDEX = 'index';

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

async function lireIndex(env) {
  const brut = await env.BOITE.get(CLE_INDEX);
  try {
    const index = brut ? JSON.parse(brut) : {};
    return index && typeof index === 'object' && !Array.isArray(index) ? index : {};
  } catch {
    return {};
  }
}

async function corpsJson(requete) {
  try {
    return await requete.json();
  } catch {
    return undefined;
  }
}

async function boite(requete, env, identifiant) {
  if (!env.BOITE) {
    return erreur('Boîte non configurée sur le relais.', 500);
  }
  if (identifiant === undefined) {
    if (requete.method !== 'GET') {
      return erreur('Méthode non autorisée.', 405);
    }
    return reponse({ appareils: await lireIndex(env) });
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
    const texte = await requete.text();
    if (texte.length > TAILLE_MAX_ENVELOPPE) {
      return erreur('Enveloppe trop volumineuse.', 413);
    }
    let enveloppe;
    try {
      enveloppe = JSON.parse(texte);
    } catch {
      return erreur('Enveloppe illisible.', 400);
    }
    if (
      enveloppe?.format !== 'applibourse-relais' ||
      enveloppe.appareil !== identifiant ||
      typeof enveloppe.date !== 'string' ||
      typeof enveloppe.charge !== 'string'
    ) {
      return erreur('Ce n’est pas une enveloppe AppliBourse.', 400);
    }
    await env.BOITE.put(cle, texte);
    const index = await lireIndex(env);
    index[identifiant] = { date: enveloppe.date, taille: texte.length };
    await env.BOITE.put(CLE_INDEX, JSON.stringify(index));
    return reponse({ ok: true });
  }

  if (requete.method === 'DELETE') {
    await env.BOITE.delete(cle);
    const index = await lireIndex(env);
    delete index[identifiant];
    await env.BOITE.put(CLE_INDEX, JSON.stringify(index));
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
    if (!jetonValide(autorisation.replace(/^Bearer\s+/i, ''), env.JETON)) {
      return erreur('Jeton du relais manquant ou incorrect.', 401);
    }

    const { pathname } = new URL(requete.url);
    if (pathname === '/sante') {
      return reponse({ ok: true, version: VERSION_RELAIS });
    }
    if (pathname === '/boite' || pathname === '/boite/') {
      return boite(requete, env, undefined);
    }
    if (pathname.startsWith('/boite/')) {
      return boite(requete, env, decodeURIComponent(pathname.slice('/boite/'.length)));
    }
    return passerelle(requete, pathname);
  },
};
