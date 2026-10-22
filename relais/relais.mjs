/**
 * Relais d'AppDashboard (cœur HTTP, Request → Response), servi par le serveur Node
 * relais/serveur/app.mjs (o2switch, https://relais.appdashboard.fr ; docs/o2switch.md).
 *
 * Deux services :
 *
 *  - une **boîte aux lettres** où chaque appareil dépose son état, chiffré
 *    sur l'appareil avant l'envoi. Le relais ne voit que du bruit : ni
 *    montant, ni valeur, ni nom. Il ne connaît pas le mot de passe de
 *    synchronisation et ne peut rien déchiffrer ;
 *  - une **passerelle** vers Yahoo Finance et les médias, pour le site web :
 *    un navigateur n'a pas le droit de les appeler lui-même. Même liste fermée
 *    d'adresses que l'application de bureau (reseau.mjs).
 *
 * La boîte (`env.BOITE`) est un magasin clé/valeur : get, put (métadonnées, expiration),
 * delete, list ; en production, la table relais_kv de PostgreSQL (relais/serveur/kv-postgres.mjs),
 * en mémoire dans les tests.
 *
 * Tout appel exige un jeton (`Authorization: Bearer …`) : le jeton maître,
 * tiré au hasard à l'installation (administrateur), ou un jeton de PROFIL qui
 * n'ouvre que l'espace de son compte (`/p/<id>/…`, voir « Portées » plus bas
 * et docs/synchro-relais.md). Sans jeton valable, personne ne peut remplir la
 * boîte ni se servir du relais comme d'un proxy.
 *
 * Une route `POST /tsuzuku/requete` lit les pages des sources de Tsuzuku pour
 * le site web, avec le jeton MAÎTRE seulement (voir tsuzuku.mjs et
 * src/tsuzuku/README.md) ; son CORS est restreint aux origines du site.
 *
 * Version 7 : `POST /jeton/verifier` dit au serveur Esport (esport/serveur/app.mjs)
 * si le jeton présenté est valable, révoqué, et de quel compte il est (voir
 * « Vérification de jeton » plus bas). Rien d'autre.
 *
 * Version 8 : `GET /admin/boite` (jeton maître) rend toute la boîte, page par page : export
 * générique, repris par relais/serveur/importer.mjs pour copier la boîte d'un relais vers une autre base.
 *
 * Support (`/support…`, relais/support.mjs, docs/support.md) : demandes rangées sur
 * le relais et annoncées sur un salon Discord. L'adresse du webhook est un SECRET
 * (`DISCORD_WEBHOOK_URL`) : ni dans le code, ni dans l'application, ni dans les
 * données synchronisées. E-mails (`/courriel/…`, relais/courriel.mjs, docs/emails.md) :
 * transport SMTP fourni par le serveur Node.
 *
 * Version 9 (le serveur devient la référence, docs/synchro-relais.md) : coffre serveur chiffré de
 * chaque compte (`/v9/coffre/<compte>`, relais/coffres.mjs), connexion du Fondateur par identifiant
 * et mot de passe (`/acces/<h>` accepte `principal` ; une preuve juste rend un jeton de SESSION,
 * relais/sessions.mjs), réponses neutres pour un identifiant inconnu, style public
 * (`/v9/theme/<h>`), accès de secours par code de récupération (`POST /acces/<h>/secours`).
 *
 * Version 10 (synchro quasi immédiate) : `/v10/coffre/<compte>…` (mêmes routes que v9, plus les avis
 * de nouvelle révision — flux SSE, attente longue, sondage : relais/avis.mjs), et validation en deux
 * étapes vérifiée par le serveur (`/v10/a2f/<compte>`, code exigé par `/acces/<h>/ouvrir` : relais/a2f.mjs).
 *
 * Adresse IP du client : en-tête `X-Adresse-Client`, posé par le pont HTTP du serveur Node
 * (esport/serveur/commun.mjs) d'après la connexion et le proxy de l'hébergeur ; jamais celui du client.
 */

import {
  fluxMedia,
  pageArticle,
  yahooJson,
  yahooScreener,
} from '../bureau/electron/reseau.mjs';
import { CHEMIN_TSUZUKU, routeTsuzuku } from './tsuzuku.mjs';
import { envoyerCourriel, routeCourriel } from './courriel.mjs';
import { routeSupport } from './support.mjs';
import { routeCoffre } from './coffres.mjs';
import { PAS_SONDAGE_S, modeTempsReel } from './avis.mjs';
import { lireA2f, routeA2f, verifierCodeConnexion } from './a2f.mjs';
import { creerSession, estJetonSession, porteeSession, routeSessions, routeTheme, selLeurre } from './sessions.mjs';

export const VERSION_RELAIS = 10;
/** Fonctions annoncées par `/sante` (le site adapte ses écrans à un relais pas encore redéployé). */
export const FONCTIONS_RELAIS = ['espaces', 'rangs', 'tsuzuku', 'tsuzuku-cache', 'invitations', 'acces', 'revocations', 'verification-jeton', 'export-boite', 'support-v2', 'courriel', 'coffre-serveur', 'sessions', 'theme', 'acces-fondateur', 'secours', 'coffre-v10', 'avis', 'a2f', 'methode-post'];
/** Fonctions qui n'existent qu'avec un magasin de coffres (serveur Node + PostgreSQL). */
const FONCTIONS_COFFRE = ['coffre-serveur', 'coffre-v10', 'avis'];
/** Une enveloppe chiffrée (fichier d'un compte) : taille maximale (PostgreSQL). */
const TAILLE_MAX_ENVELOPPE = 48 * 1024 * 1024;
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
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Methode',
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

/**
 * Portée du jeton présenté : `{ maitre: true }`, `{ profil: id }`, `{ maitre: true, session }` (session
 * du Fondateur ouverte par son mot de passe, version 9 : `boite` requise), ou rien (refusé).
 */
export async function porteeDuJeton(recu, jetonMaitre, boite) {
  if (typeof jetonMaitre !== 'string' || jetonMaitre.length < 16 || typeof recu !== 'string') {
    return undefined;
  }
  if (jetonValide(recu, jetonMaitre)) {
    return { maitre: true };
  }
  if (estJetonSession(recu)) {
    return porteeSession(boite, recu);
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
// toutes les 5 minutes au plus.

const REPARE = '~repare';
const DELAI_REPARATION_BOITE_MS = 5 * 60_000;
const DELAI_REPARATION_ESPACE_MS = 5 * 60_000;
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
      trouves[nom] =
        meta && typeof meta.date === 'string'
          ? { date: meta.date, taille: Number(meta.taille) || 0, ...(AUTEURS.includes(meta.auteur) ? { auteur: meta.auteur } : {}) }
          : undefined;
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
  return { texte, enveloppe, meta: { date: enveloppe.date, taille: texte.length } };
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
 * Espace d'un compte : `/p/<id>/boite[/<nom>]`. Lecture réservée au titulaire
 * (son jeton de profil) et à l'administrateur (jeton maître). Tout autre jeton
 * reçoit 403, que l'objet existe ou non : la réponse ne dit rien de l'espace
 * d'un autre.
 *
 * Écriture et suppression (voir « Qui peut écrire quoi » dans
 * docs/synchro-relais.md) : le jeton maître écrit tout ; le jeton de profil
 * n'écrit dans SON espace que ses données propres (`OBJETS_DU_COMPTE`) ; tout
 * le reste (projection d'annuaire, abonnement, sources partagées, et tout nom
 * inconnu) est en lecture seule pour lui (403). Chaque dépôt est estampillé
 * par le relais (`auteur` : `maitre`, `compte` ou `delegue`, jamais celui que
 * l'appareil prétend) : un appareil vérifie ainsi l'origine de ce qu'il lit.
 */
async function espace(requete, env, portee, id, nom) {
  if (!IDENTIFIANT_PROFIL.test(id)) {
    return erreur('Espace invalide.', 400);
  }
  if (!portee.maitre && portee.profil !== id) {
    // Délégation d'un titulaire (Administrateur, Fondateur) sur un compte de rang inférieur :
    // la liste de ses fichiers, et son coffre et son portefeuille seulement.
    const permis =
      id !== 'principal' &&
      (nom === undefined ? requete.method === 'GET' : OBJETS_DELEGUES.includes(nom) && (requete.method === 'GET' || requete.method === 'PUT')) &&
      (await delegue(env, portee.profil, id));
    if (!permis) {
      return erreur('Cet espace n’est pas le vôtre.', 403);
    }
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
  // Un jeton de profil n'écrit (ni n'efface) que les données propres du compte : le reste est publié par
  // l'administrateur seul (annuaire, abonnement, sources partagées…), en lecture seule pour le compte.
  if (!portee.maitre && requete.method !== 'GET' && !OBJETS_DU_COMPTE.includes(nom)) {
    return erreur('Objet en lecture seule pour ce compte.', 403);
  }
  if (requete.method === 'GET') {
    const enveloppe = await env.BOITE.get(cle);
    return enveloppe === null ? erreur('Aucun dépôt.', 404) : reponse(enveloppe);
  }
  if (requete.method === 'PUT') {
    const { refus, enveloppe } = await lireEnveloppe(requete, nom);
    if (refus) return refus;
    // Estampille posée ICI (celle que l'appareil aurait mise est remplacée).
    const auteur = portee.maitre ? 'maitre' : portee.profil === id ? 'compte' : 'delegue';
    const texte = JSON.stringify({ ...enveloppe, auteur });
    const meta = { date: enveloppe.date, taille: texte.length, auteur };
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

// ------------------------------------------------------------ Délégations (rangs)
//
// Un Administrateur (ou un Fondateur autre que le compte historique) administre
// aussi depuis le site : pour ouvrir le compte d'un rang inférieur (séquestre),
// il lui faut le coffre et le portefeuille de ce compte. Le compte historique
// (jeton maître) publie la liste de ces délégations (`PUT /rangs`) ; le relais
// la relit à chaque accès croisé. Jamais `principal`, jamais l'annuaire ni le
// retour d'un autre compte : seulement `coffre` et `portefeuille`, déjà scellés
// par la clé de leur compte (que le titulaire n'ouvre qu'avec son code d'accès).

const CLE_RANGS = 'rangs';
const OBJETS_DELEGUES = ['coffre', 'portefeuille'];
/**
 * Objets qu'un jeton de profil peut écrire ou effacer dans SON espace : ses données propres
 * (coffre, portefeuille, retour `compte`, clé publique de réception Tsuzuku). Tout autre nom
 * (`annuaire`, `abonnement`, `tsuzuku-sources`, noms futurs…) n'est écrit que par le jeton maître.
 */
export const OBJETS_DU_COMPTE = ['coffre', 'portefeuille', 'compte', 'tsuzuku-cle'];
/** Estampilles possibles d'un dépôt dans un espace. */
const AUTEURS = ['maitre', 'compte', 'delegue'];
const MOTIF_COMPTE = /^[a-z0-9]{6,16}$/;

function lireDelegations(brut) {
  const propres = {};
  const source = brut && typeof brut === 'object' && brut.delegations && typeof brut.delegations === 'object' ? brut.delegations : {};
  for (const [titulaire, ids] of Object.entries(source).slice(0, 64)) {
    if (!MOTIF_COMPTE.test(titulaire) || titulaire === 'principal' || !Array.isArray(ids)) continue;
    const liste = [...new Set(ids.filter(id => typeof id === 'string' && MOTIF_COMPTE.test(id) && id !== titulaire && id !== 'principal'))].slice(0, 500);
    if (liste.length > 0) propres[titulaire] = liste;
  }
  return propres;
}

async function delegue(env, titulaire, id) {
  let lu;
  try {
    lu = JSON.parse((await env.BOITE.get(CLE_RANGS)) ?? '{}');
  } catch {
    lu = {};
  }
  return Array.isArray(lu.delegations?.[titulaire]) && lu.delegations[titulaire].includes(id);
}

async function rangs(requete, env) {
  if (requete.method === 'GET') {
    let lu;
    try {
      lu = JSON.parse((await env.BOITE.get(CLE_RANGS)) ?? '{}');
    } catch {
      lu = {};
    }
    return reponse({ delegations: lireDelegations(lu) });
  }
  if (requete.method === 'PUT') {
    const corps = await corpsJson(requete);
    if (!corps || typeof corps !== 'object') {
      return erreur('Requête illisible.', 400);
    }
    await env.BOITE.put(CLE_RANGS, JSON.stringify({ delegations: lireDelegations(corps) }));
    return reponse({ ok: true });
  }
  return erreur('Méthode non autorisée.', 405);
}


// ------------------------------------------------------------ Support et e-mails
//
// `/support…` : demandes d'assistance rangées sur le relais et annoncées sur Discord (relais/support.mjs,
// docs/support.md). `/courriel/…` : e-mails envoyés par le serveur, Fondateur seulement
// (relais/courriel.mjs, docs/emails.md). Aucune réponse ne révèle le webhook ni la configuration SMTP.

export { nettoyerTexteDiscord, validerTicket } from './support.mjs';

// ------------------------------------------------------------ Invitations et connexion des amis (version 6)
//
// Voir docs/connexion-amis.md. Le relais ne voit jamais ni mot de passe, ni
// clé, ni jeton d'ami en clair : il garde des charges SCELLÉES par des clés
// qu'il ne connaît pas, et l'EMPREINTE d'une preuve (SHA-256) qu'il compare.
//
//  - `PUT /invitations/<id>` (jeton maître) : dépose une invitation (charge
//    scellée, empreinte de la preuve, expiration, compte). Une seule invitation
//    active par compte : la précédente est révoquée (« Renvoyer »).
//    `DELETE` (jeton maître) la révoque.
//  - `GET /invitations/<id>` (SANS jeton : l'ami n'en a pas encore) : la
//    charge, tant que l'invitation n'est ni utilisée, ni expirée, ni révoquée
//    (410 et le motif sinon ; 404 si elle n'existe pas).
//  - `POST /invitations/<id>/utiliser` (sans jeton, avec la preuve) : marque
//    l'invitation utilisée et efface sa charge (usage unique).
//  - `PUT /acces/<h>` (jeton du compte, ou maître) : l'« accès » d'un
//    identifiant (empreinte `h`) pour se connecter depuis un appareil neuf.
//    Le compte n'écrit que l'identifiant que le Fondateur lui a attribué
//    (`acces-proprio:<h>`, posé avec l'invitation) : pas d'usurpation.
//  - `GET /acces/<h>` (sans jeton) : sel et paramètres de dérivation ;
//    `POST /acces/<h>/ouvrir` (sans jeton, avec la preuve tirée du mot de
//    passe) : la charge scellée, ou 403. Délai progressif PAR IDENTIFIANT
//    (boîte) et PAR ADRESSE IP (mémoire du serveur) : anti-force brute.
//  - `PUT`/`DELETE /revocations/<id>` (jeton maître) : le jeton de profil de
//    ce compte est refusé partout (403, motif `revoque`) tant que la
//    révocation n'est pas levée.

const MOTIF_ID_INVITATION = /^[0-9a-f]{32}$/;
const MOTIF_EMPREINTE = /^[0-9a-f]{64}$/;
const TAILLE_MAX_CHARGE = 16 * 1024;
const DUREE_MAX_INVITATION_MS = 90 * 86_400_000;
/** Une invitation utilisée, expirée ou révoquée est gardée (sans charge) 30 jours pour dire pourquoi elle ne marche plus. */
const GARDE_TOMBE_S = 30 * 86_400;
const ESSAIS_LIBRES_IDENTIFIANT = 5;
const ATTENTE_MAX_IDENTIFIANT_S = 3600;
const ESSAIS_LIBRES_IP = 10;
const ATTENTE_MAX_IP_S = 900;
const limitesIp = new Map();

/** Adresse IP du client, posée par le pont HTTP du serveur Node (esport/serveur/commun.mjs). */
export const ENTETE_ADRESSE_CLIENT = 'X-Adresse-Client';

export function adresseIp(requete) {
  return requete.headers.get(ENTETE_ADRESSE_CLIENT) ?? ((requete.headers.get('X-Forwarded-For') ?? '').split(',')[0].trim() || 'inconnue');
}

/** Délai à attendre (secondes) après `echecs` échecs, au-delà de `libres` essais. */
export function attenteApres(echecs, libres, max, base = 30) {
  if (echecs < libres) return 0;
  return Math.min(max, base * 2 ** (echecs - libres));
}

function attenteIp(ip, maintenant) {
  const l = limitesIp.get(ip);
  return l && l.jusqua > maintenant ? Math.ceil((l.jusqua - maintenant) / 1000) : 0;
}

function echecIp(ip, maintenant) {
  if (limitesIp.size > 5000) limitesIp.clear();
  const l = limitesIp.get(ip) ?? { echecs: 0, jusqua: 0 };
  // Un quart d'heure sans échec : on repart de zéro.
  if (l.dernier && maintenant - l.dernier > 900_000) l.echecs = 0;
  l.echecs++;
  l.dernier = maintenant;
  const attente = attenteApres(l.echecs, ESSAIS_LIBRES_IP, ATTENTE_MAX_IP_S, 5);
  l.jusqua = attente > 0 ? maintenant + attente * 1000 : 0;
  limitesIp.set(ip, l);
}

function tropDeTentatives(attenteS) {
  const r = reponse({ erreur: 'Trop de tentatives : réessayez plus tard.', motif: 'trop-de-tentatives', attente: attenteS }, 429);
  r.headers.set('Retry-After', String(attenteS));
  return r;
}

const egal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && jetonValideLong(a, b);
function jetonValideLong(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function empreinteHex(texte) {
  return hexa(await crypto.subtle.digest('SHA-256', encodeur.encode(texte)));
}

async function lireJsonKv(env, cle) {
  try {
    const brut = await env.BOITE.get(cle);
    return brut ? JSON.parse(brut) : undefined;
  } catch {
    return undefined;
  }
}

function etatInvitation(inv, maintenant) {
  if (inv.etat === 'revoquee') return 'revoquee';
  if (inv.etat === 'utilisee') return 'utilisee';
  if (maintenant >= inv.expire) return 'expiree';
  return 'active';
}

const MOTIFS_INVITATION = {
  revoquee: 'Invitation annulée ou remplacée par une plus récente.',
  utilisee: 'Invitation déjà utilisée.',
  expiree: 'Invitation expirée.',
};

async function ecrireInvitation(env, id, inv, maintenant) {
  const ttl = Math.max(120, Math.ceil((inv.expire - maintenant) / 1000) + GARDE_TOMBE_S);
  await env.BOITE.put(`inv:${id}`, JSON.stringify(inv), { expirationTtl: ttl });
}

async function revoquerInvitation(env, id, maintenant) {
  const inv = await lireJsonKv(env, `inv:${id}`);
  if (!inv || inv.alias) return;
  if (inv.etat === 'active') {
    const tombe = { ...inv, etat: 'revoquee', revoqueeLe: maintenant };
    delete tombe.charge;
    await ecrireInvitation(env, id, tombe, maintenant);
  }
  if (inv.court) await env.BOITE.delete(`inv:${inv.court}`);
}

async function invitations(requete, env, portee, id, action) {
  const maintenant = Date.now();
  if (!MOTIF_ID_INVITATION.test(id)) {
    return erreur('Invitation invalide.', 400);
  }
  if (action === undefined && (requete.method === 'PUT' || requete.method === 'DELETE')) {
    if (!portee?.maitre) return erreur('Réservé au jeton de l’administrateur.', portee ? 403 : 401);
    if (requete.method === 'DELETE') {
      await revoquerInvitation(env, id, maintenant);
      return reponse({ ok: true });
    }
    const corps = await corpsJson(requete);
    const expire = Date.parse(corps?.expire);
    const court = corps?.court;
    if (
      !corps ||
      !MOTIF_COMPTE.test(corps.profil ?? '') ||
      corps.profil === 'principal' ||
      typeof corps.charge !== 'string' ||
      corps.charge.length > TAILLE_MAX_CHARGE ||
      !MOTIF_EMPREINTE.test(corps.verif ?? '') ||
      !Number.isFinite(expire) ||
      expire <= maintenant ||
      expire > maintenant + DUREE_MAX_INVITATION_MS ||
      (corps.acces !== undefined && !MOTIF_EMPREINTE.test(corps.acces)) ||
      (court !== undefined &&
        (!court || !MOTIF_ID_INVITATION.test(court.id ?? '') || court.id === id || typeof court.charge !== 'string' || court.charge.length > TAILLE_MAX_CHARGE || !MOTIF_EMPREINTE.test(court.verif ?? '')))
    ) {
      return erreur('Invitation illisible.', 400);
    }
    // Une seule invitation active par compte : la précédente cesse aussitôt de marcher.
    const precedente = await env.BOITE.get(`inv-profil:${corps.profil}`);
    if (precedente && precedente !== id) await revoquerInvitation(env, precedente, maintenant);
    const inv = { v: 1, profil: corps.profil, expire, charge: corps.charge, verif: corps.verif, etat: 'active', cree: maintenant, ...(court ? { court: court.id } : {}) };
    await ecrireInvitation(env, id, inv, maintenant);
    if (court) await ecrireInvitation(env, court.id, { v: 1, alias: id, profil: corps.profil, expire, charge: court.charge, verif: court.verif, etat: 'active', cree: maintenant }, maintenant);
    await env.BOITE.put(`inv-profil:${corps.profil}`, id);
    if (corps.acces) await env.BOITE.put(`acces-proprio:${corps.acces}`, corps.profil);
    return reponse({ ok: true, expire: new Date(expire).toISOString() });
  }

  // Routes publiques : l'ami n'a pas encore de jeton.
  const ip = adresseIp(requete);
  const attente = attenteIp(ip, maintenant);
  if (attente > 0) return tropDeTentatives(attente);
  const lue = await lireJsonKv(env, `inv:${id}`);
  if (!lue) {
    echecIp(ip, maintenant);
    return reponse({ erreur: 'Invitation introuvable.', motif: 'inconnue' }, 404);
  }
  const principale = lue.alias ? await lireJsonKv(env, `inv:${lue.alias}`) : lue;
  const etat = principale ? etatInvitation(principale, maintenant) : 'revoquee';
  if (etat !== 'active') {
    return reponse({ erreur: MOTIFS_INVITATION[etat], motif: etat }, 410);
  }
  if (action === undefined && requete.method === 'GET') {
    return reponse({ charge: lue.charge, expire: new Date(principale.expire).toISOString(), heure: maintenant });
  }
  if (action === 'utiliser' && requete.method === 'POST') {
    const corps = await corpsJson(requete);
    const preuve = typeof corps?.preuve === 'string' ? corps.preuve : '';
    if (!/^[0-9a-f]{64}$/.test(preuve) || !egal(await empreinteHex(preuve), lue.verif)) {
      echecIp(ip, maintenant);
      return reponse({ erreur: 'Preuve refusée.', motif: 'preuve' }, 403);
    }
    const idPrincipal = lue.alias ?? id;
    const tombe = { ...principale, etat: 'utilisee', utiliseeLe: maintenant };
    delete tombe.charge;
    await ecrireInvitation(env, idPrincipal, tombe, maintenant);
    if (principale.court) await env.BOITE.delete(`inv:${principale.court}`);
    return reponse({ ok: true });
  }
  return erreur('Méthode non autorisée.', 405);
}

const KDF_DEFAUT_ACCES = { algorithme: 'argon2id', passes: 2, memoireKio: 19456, fils: 1, longueurCle: 32 };
const MAX_SECOURS = 16;

function lireKdfAcces(kdf) {
  const entier = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
  if (!kdf || kdf.algorithme !== 'argon2id' || !entier(kdf.passes, 1, 10) || !entier(kdf.memoireKio, 8, 262144) || !entier(kdf.fils, 1, 4) || kdf.longueurCle !== 32) {
    return undefined;
  }
  return { algorithme: 'argon2id', passes: kdf.passes, memoireKio: kdf.memoireKio, fils: kdf.fils, longueurCle: 32 };
}

/**
 * Dépôt d'accès par identifiant. Version 9 : le compte `principal` (Fondateur) est accepté, et un
 * accès de SECOURS facultatif (`secours` : un sel commun, et pour chaque code de récupération
 * l'empreinte de sa preuve et la charge scellée par une clé tirée du code).
 */
function lireDepotAcces(corps) {
  return verifierDepotAcces(corps).depot;
}

/**
 * Même lecture, avec la RAISON d'un refus (champ fautif, sans aucune valeur) : renvoyée à l'appareil
 * (`motif: 'acces-illisible'`, `champ`) et notée dans le journal du serveur, pour qu'un échec se
 * diagnostique sans deviner.
 */
export function verifierDepotAcces(corps) {
  if (!corps || typeof corps !== 'object') return { raison: 'corps' };
  if (!MOTIF_COMPTE_OU_PRINCIPAL.test(corps.compte ?? '')) return { raison: 'compte' };
  if (!/^[0-9a-f]{32}$/.test(corps.sel ?? '')) return { raison: 'sel' };
  if (!MOTIF_EMPREINTE.test(corps.verif ?? '')) return { raison: 'verif' };
  if (typeof corps.charge !== 'string' || !/^[0-9a-f]+$/.test(corps.charge)) return { raison: 'charge' };
  if (corps.charge.length > TAILLE_MAX_CHARGE) return { raison: 'charge-taille' };
  const kdf = lireKdfAcces(corps.kdf);
  if (!kdf) return { raison: 'kdf' };
  let secours;
  if (corps.secours !== undefined && corps.secours !== null) {
    const s = corps.secours;
    const kdfSecours = lireKdfAcces(s?.kdf);
    if (!s || typeof s !== 'object') return { raison: 'secours' };
    if (!/^[0-9a-f]{32}$/.test(s.sel ?? '')) return { raison: 'secours-sel' };
    if (!kdfSecours) return { raison: 'secours-kdf' };
    if (!Array.isArray(s.entrees) || s.entrees.length > MAX_SECOURS) return { raison: 'secours-entrees' };
    if (!s.entrees.every(e => e && MOTIF_EMPREINTE.test(e.verif ?? '') && typeof e.charge === 'string' && /^[0-9a-f]+$/.test(e.charge) && e.charge.length <= TAILLE_MAX_CHARGE)) {
      return { raison: 'secours-entree' };
    }
    secours = { sel: s.sel, kdf: kdfSecours, entrees: s.entrees.map(e => ({ verif: e.verif, charge: e.charge })) };
  }
  return { depot: { compte: corps.compte, sel: corps.sel, kdf, verif: corps.verif, charge: corps.charge, ...(secours ? { secours } : {}) } };
}

const MOTIF_COMPTE_OU_PRINCIPAL = /^(principal|[a-z0-9]{6,16})$/;

/** Échec de preuve (mot de passe faux OU identifiant inconnu : même réponse, mêmes délais). */
async function echecPreuve(env, h, ip, maintenant, limite) {
  echecIp(ip, maintenant);
  const echecs = limite.echecs + 1;
  const attenteS = attenteApres(echecs, ESSAIS_LIBRES_IDENTIFIANT, ATTENTE_MAX_IDENTIFIANT_S);
  await env.BOITE.put(`limite:acces:${h}`, JSON.stringify({ echecs, jusqua: attenteS > 0 ? maintenant + attenteS * 1000 : 0 }), { expirationTtl: 86_400 });
  return reponse({ erreur: 'Identifiant ou mot de passe incorrect.', motif: 'mot-de-passe', ...(attenteS > 0 ? { attente: attenteS } : { restants: ESSAIS_LIBRES_IDENTIFIANT - echecs }) }, 403);
}

async function acces(requete, env, portee, h, action) {
  const maintenant = Date.now();
  if (!MOTIF_EMPREINTE.test(h)) {
    return erreur('Identifiant invalide.', 400);
  }
  if (action === undefined && (requete.method === 'PUT' || requete.method === 'DELETE')) {
    if (!portee) return erreur('Jeton du relais manquant ou incorrect.', 401);
    const proprio = await env.BOITE.get(`acces-proprio:${h}`);
    const existant = await lireJsonKv(env, `acces:${h}`);
    if (requete.method === 'DELETE') {
      if (!portee.maitre && (!proprio || portee.profil !== proprio)) return erreur('Cet identifiant n’est pas le vôtre.', 403);
      await env.BOITE.delete(`acces:${h}`);
      await env.BOITE.delete(`limite:acces:${h}`);
      await env.BOITE.delete(`theme:${h}`);
      return reponse({ ok: true });
    }
    const texte = await requete.text().catch(() => '');
    let corpsDepot;
    try {
      corpsDepot = JSON.parse(texte);
    } catch {
      corpsDepot = undefined;
    }
    const lu = verifierDepotAcces(corpsDepot);
    if (!lu.depot) {
      const raison = corpsDepot === undefined ? (texte ? 'json' : 'corps-vide') : lu.raison;
      console.warn(`[relais] dépôt d'accès refusé : ${raison} (${texte.length} octets reçus, ${requete.headers.get('Content-Type') ?? 'sans type'})`);
      return reponse({ erreur: `Accès illisible (${raison}).`, motif: 'acces-illisible', champ: raison, recu: texte.length }, 400);
    }
    const depot = lu.depot;
    if (depot.compte === 'principal') {
      // L'accès du Fondateur : posé par lui seul (jeton maître, ou sa session).
      if (!portee.maitre) return erreur('Cet identifiant n’est pas le vôtre.', 403);
    } else if (!portee.maitre && (portee.profil !== depot.compte || proprio !== depot.compte)) {
      // Le compte n'écrit que l'identifiant que le Fondateur lui a attribué (posé avec l'invitation).
      return erreur('Cet identifiant n’est pas le vôtre.', 403);
    }
    // Un identifiant déjà pris par un autre compte n'est jamais réattribué en silence.
    if ((existant && existant.compte !== depot.compte) || (proprio && proprio !== depot.compte)) {
      return reponse({ erreur: 'Cet identifiant est déjà pris par un autre compte.', motif: 'identifiant-pris' }, 409);
    }
    await env.BOITE.put(`acces:${h}`, JSON.stringify(depot));
    await env.BOITE.delete(`limite:acces:${h}`);
    return reponse({ ok: true });
  }

  const ip = adresseIp(requete);
  const attente = attenteIp(ip, maintenant);
  if (attente > 0) return tropDeTentatives(attente);
  const depot = await lireJsonKv(env, `acces:${h}`);
  if (action === undefined && requete.method === 'GET') {
    // Identifiant inconnu : sels stables tirés du jeton maître, même forme de réponse (pas d'énumération).
    if (!depot) {
      return reponse({ sel: await selLeurre(env.JETON, h), kdf: KDF_DEFAUT_ACCES, secours: { sel: await selLeurre(env.JETON, h, 'secours'), kdf: KDF_DEFAUT_ACCES } });
    }
    const secours = depot.secours ? { sel: depot.secours.sel, kdf: depot.secours.kdf } : { sel: await selLeurre(env.JETON, h, 'secours'), kdf: KDF_DEFAUT_ACCES };
    return reponse({ sel: depot.sel, kdf: depot.kdf, secours });
  }
  if ((action === 'ouvrir' || action === 'secours') && requete.method === 'POST') {
    const limite = (await lireJsonKv(env, `limite:acces:${h}`)) ?? { echecs: 0, jusqua: 0 };
    if (limite.jusqua > maintenant) {
      return tropDeTentatives(Math.ceil((limite.jusqua - maintenant) / 1000));
    }
    const corps = await corpsJson(requete);
    const preuve = typeof corps?.preuve === 'string' ? corps.preuve : '';
    if (!depot || !/^[0-9a-f]{64}$/.test(preuve)) return echecPreuve(env, h, ip, maintenant, limite);
    const empreinte = await empreinteHex(preuve);
    let charge;
    let indexSecours;
    if (action === 'ouvrir') {
      if (egal(empreinte, depot.verif)) charge = depot.charge;
    } else {
      indexSecours = (depot.secours?.entrees ?? []).findIndex(e => egal(empreinte, e.verif));
      if (indexSecours >= 0) charge = depot.secours.entrees[indexSecours].charge;
    }
    if (!charge) return echecPreuve(env, h, ip, maintenant, limite);
    // Compte révoqué : annoncé seulement après une preuve juste.
    if (depot.compte !== 'principal' && (await env.BOITE.get(`revoque:${depot.compte}`))) {
      return reponse({ erreur: 'Accès révoqué.', motif: 'revoque' }, 403);
    }
    // Validation en deux étapes (version 10, relais/a2f.mjs) : le code est vérifié ICI, avant de rendre
    // la charge ou une session. Les codes de récupération (`secours`) restent une autre porte.
    if (action === 'ouvrir') {
      const a2f = await lireA2f(env, depot.compte);
      if (a2f) {
        const v = await verifierCodeConnexion(env, depot.compte, a2f, typeof corps?.code === 'string' ? corps.code : '', maintenant);
        if (!v.ok) {
          if (v.corps.motif === 'a2f-code') echecIp(ip, maintenant);
          const r = reponse(v.corps, v.statut);
          if (v.attente) r.headers.set('Retry-After', String(v.attente));
          return r;
        }
      }
    }
    if (limite.echecs > 0) await env.BOITE.delete(`limite:acces:${h}`);
    // Le Fondateur reçoit un jeton de SESSION (le jeton maître ne quitte jamais le serveur).
    const jeton = depot.compte === 'principal' ? await creerSession(env.BOITE, 'principal', maintenant) : undefined;
    return reponse({ compte: depot.compte, charge, ...(jeton ? { jeton } : {}), ...(indexSecours !== undefined ? { secours: indexSecours } : {}) });
  }
  return erreur('Méthode non autorisée.', 405);
}

async function revocations(requete, env, portee, id) {
  if (!portee.maitre) return erreur('Réservé au jeton de l’administrateur.', 403);
  if (!MOTIF_COMPTE.test(id) || id === 'principal') return erreur('Compte invalide.', 400);
  if (requete.method === 'PUT') {
    await env.BOITE.put(`revoque:${id}`, String(Date.now()));
    // Plus d'invitation ni d'accès par identifiant pour ce compte.
    const inv = await env.BOITE.get(`inv-profil:${id}`);
    if (inv) await revoquerInvitation(env, inv, Date.now());
    return reponse({ ok: true });
  }
  if (requete.method === 'DELETE') {
    await env.BOITE.delete(`revoque:${id}`);
    return reponse({ ok: true });
  }
  if (requete.method === 'GET') {
    return reponse({ revoque: Boolean(await env.BOITE.get(`revoque:${id}`)) });
  }
  return erreur('Méthode non autorisée.', 405);
}

// ------------------------------------------------------------ Vérification de jeton (version 7)
//
// `POST /jeton/verifier`, jeton à vérifier dans `Authorization: Bearer …` :
// réponse 200 `{ valide, revoque, compte, maitre }` (`compte` : « principal »
// pour le jeton maître, l'identifiant du compte pour un jeton de profil).
// Appelée par le serveur Esport (en HTTPS), qui n'a donc jamais
// besoin du jeton maître. La réponse ne parle que du jeton présenté : elle
// n'apprend rien de plus que `/sante` à qui le détient déjà. Les échecs
// comptent dans l'anti-force brute par adresse IP.

export const CHEMIN_VERIFICATION = '/jeton/verifier';

async function verifierJeton(requete, env, portee) {
  if (requete.method !== 'POST') {
    return erreur('Méthode non autorisée.', 405);
  }
  const maintenant = Date.now();
  // L'adresse vue est celle du serveur Esport : celui-ci transmet celle du navigateur dans
  // X-Forwarded-For, prise ici en premier (sinon tous les comptes partageraient un compteur).
  const ip = (requete.headers.get('X-Forwarded-For') ?? '').split(',')[0].trim() || adresseIp(requete);
  const attente = attenteIp(ip, maintenant);
  if (attente > 0) return tropDeTentatives(attente);
  if (!portee) {
    echecIp(ip, maintenant);
    return reponse({ valide: false, revoque: false, version: VERSION_RELAIS });
  }
  if (portee.maitre) {
    return reponse({ valide: true, revoque: false, compte: 'principal', maitre: true, version: VERSION_RELAIS });
  }
  const revoque = Boolean(env.BOITE && (await env.BOITE.get(`revoque:${portee.profil}`)));
  return reponse({ valide: true, revoque, compte: portee.profil, maitre: false, version: VERSION_RELAIS });
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

// ------------------------------------------------- Export de la boîte (version 8)

/** Toute la boîte, par pages (jeton maître) : clé, valeur, métadonnées, expiration (secondes Unix). */
async function exporterBoite(requete, env) {
  if (requete.method !== 'GET') return erreur('Méthode non permise.', 405);
  if (typeof env.BOITE.list !== 'function') return erreur('Cette boîte ne sait pas se lister.', 501);
  const curseur = new URL(requete.url).searchParams.get('curseur') || undefined;
  // 100 clés par page : des réponses de taille raisonnable.
  const page = await env.BOITE.list({ cursor: curseur, limit: 100 });
  const cles = [];
  for (const cle of page.keys ?? []) {
    const valeur = await env.BOITE.get(cle.name);
    if (valeur === null) continue;
    cles.push({ nom: cle.name, valeur, ...(cle.metadata ? { metadata: cle.metadata } : {}), ...(cle.expiration ? { expiration: cle.expiration } : {}) });
  }
  return reponse({ cles, suite: page.list_complete === false ? page.cursor : null });
}

/**
 * Traite une requête du relais. `env` : JETON, BOITE, COFFRES, AVIS… (relais/serveur/app.mjs) ;
 * `ctx.waitUntil(promesse)` (facultatif) : travail fini après la réponse (mise en cache de Tsuzuku).
 */
export async function traiterRequete(requete, env, ctx) {
  // Lecture des sources de Tsuzuku (site web) : CORS, jeton et règles à part, préliminaire compris.
  // `ctx.waitUntil` : la mise en cache d'une page lue finit après la réponse.
  if (new URL(requete.url).pathname === CHEMIN_TSUZUKU) {
    const deps = typeof ctx?.waitUntil === 'function' ? { waitUntil: p => ctx.waitUntil(p) } : {};
    return routeTsuzuku(requete, env, () => porteeDuJeton((requete.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, ''), env.JETON, env.BOITE), deps);
  }
  if (requete.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: ENTETES_CORS });
  }
  // Version 10 : un PUT ou un DELETE peut arriver en POST avec `X-Methode` (certains intermédiaires
  // d'hébergement mutualisé refusent les PUT ou en perdent le corps). Traité exactement comme l'original.
  const surcharge = requete.method === 'POST' ? (requete.headers.get('X-Methode') ?? '').trim().toUpperCase() : '';
  if (surcharge === 'PUT' || surcharge === 'DELETE') {
    requete = new Request(requete, { method: surcharge });
  }
  const autorisation = requete.headers.get('Authorization') ?? '';
  const portee = await porteeDuJeton(autorisation.replace(/^Bearer\s+/i, ''), env.JETON, env.BOITE);
  const { pathname } = new URL(requete.url);

  // Version 9 : style public d'un identifiant (sans jeton pour la lecture).
  const routeTheme9 = /^\/v9\/theme\/([^/]+)\/?$/.exec(pathname);
  if (routeTheme9) {
    if (!env.BOITE) return erreur('Boîte non configurée sur le relais.', 500);
    return routeTheme(requete, env, portee, routeTheme9[1], adresseIp(requete));
  }

  // Invitations et accès par identifiant : certaines routes se passent de jeton (voir plus haut).
  const routeInvitation = /^\/invitations\/([^/]+)(?:\/(utiliser))?\/?$/.exec(pathname);
  const routeAcces = /^\/acces\/([^/]+)(?:\/(ouvrir|secours))?\/?$/.exec(pathname);
  if (routeInvitation || routeAcces) {
    if (!env.BOITE) {
      return erreur('Boîte non configurée sur le relais.', 500);
    }
    if (portee?.profil && (await env.BOITE.get(`revoque:${portee.profil}`))) {
      return reponse({ erreur: 'Accès révoqué par l’administrateur.', motif: 'revoque' }, 403);
    }
    return routeInvitation
      ? invitations(requete, env, portee, routeInvitation[1], routeInvitation[2])
      : acces(requete, env, portee, routeAcces[1], routeAcces[2]);
  }

  // Vérification de jeton (version 7) : répond aussi pour un jeton refusé ou révoqué.
  if (pathname === CHEMIN_VERIFICATION) {
    return verifierJeton(requete, env, portee);
  }

  if (!portee) {
    return erreur('Jeton du relais manquant ou incorrect.', 401);
  }
  // Compte révoqué par l'administrateur : son jeton ne vaut plus rien.
  if (portee.profil && env.BOITE && (await env.BOITE.get(`revoque:${portee.profil}`))) {
    return reponse({ erreur: 'Accès révoqué par l’administrateur.', motif: 'revoque' }, 403);
  }

  if (pathname === '/sante') {
    // `tempsReel` : comment les appareils apprennent les écritures des autres (SYNCHRO_TEMPS_REEL,
    // « sondage » par défaut : aucune connexion tenue ouverte ; relais/avis.mjs).
    // Sans magasin de coffres (`env.COFFRES`), le coffre serveur n'est pas annoncé : les appareils gardent l'ancienne synchronisation.
    return reponse({ ok: true, version: VERSION_RELAIS, fonctions: env.COFFRES ? FONCTIONS_RELAIS : FONCTIONS_RELAIS.filter(f => !FONCTIONS_COFFRE.includes(f)), portee: portee.maitre ? 'maitre' : 'profil', ...(portee.profil ? { profil: portee.profil } : {}), ...(env.COFFRES ? { tempsReel: modeTempsReel(env), pasSondage: PAS_SONDAGE_S } : {}), heure: Date.now() });
  }
  if (pathname === '/heure') {
    // Ultra léger : l'appareil compare son horloge (codes TOTP) à celle du relais.
    return reponse({ heure: Date.now() });
  }
  if (pathname === '/support' || pathname.startsWith('/support/')) {
    return routeSupport(requete, env, portee, pathname, { reponse, erreur, envoyerCourriel });
  }
  if (pathname.startsWith('/courriel/')) {
    return routeCourriel(requete, env, portee, pathname, { reponse, erreur });
  }
  const routeRevocation = /^\/revocations\/([^/]+)\/?$/.exec(pathname);
  if (routeRevocation) {
    if (!env.BOITE) {
      return erreur('Boîte non configurée sur le relais.', 500);
    }
    return revocations(requete, env, portee, routeRevocation[1]);
  }
  if (pathname === '/admin/boite') {
    if (!env.BOITE) {
      return erreur('Boîte non configurée sur le relais.', 500);
    }
    return portee.maitre && !portee.session ? exporterBoite(requete, env) : erreur('Réservé au jeton de l’administrateur.', 403);
  }
  // Version 9 : coffre serveur de chaque compte, et sessions du Fondateur.
  // Version 10 : mêmes routes, plus les avis de nouvelle version (relais/avis.mjs).
  const routeCoffre9 = /^\/v(9|10)\/coffre\/([^/]+)(?:\/(historique|etat|version|attendre|flux))?\/?$/.exec(pathname);
  if (routeCoffre9) {
    return routeCoffre(requete, env, portee, decodeURIComponent(routeCoffre9[2]), routeCoffre9[3], env.BOITE ? (titulaire, id) => delegue(env, titulaire, id) : undefined, Number(routeCoffre9[1]));
  }
  const routeA2f10 = /^\/v10\/a2f\/([^/]+)\/?$/.exec(pathname);
  if (routeA2f10) {
    if (!env.BOITE) return erreur('Boîte non configurée sur le relais.', 500);
    return routeA2f(requete, env, portee, decodeURIComponent(routeA2f10[1]), { reponse, erreur });
  }
  const routeSessions9 = /^\/v9\/sessions(?:\/(courante))?\/?$/.exec(pathname);
  if (routeSessions9) {
    if (!env.BOITE) return erreur('Boîte non configurée sur le relais.', 500);
    return routeSessions(requete, env, portee, routeSessions9[1]);
  }
  if (pathname === '/rangs') {
    if (!env.BOITE) {
      return erreur('Boîte non configurée sur le relais.', 500);
    }
    return portee.maitre ? rangs(requete, env) : erreur('Réservé au jeton de l’administrateur.', 403);
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
}

/**
 * Le relais vu des tests : `relais.traiter(requete, env, ctx)`. La suite PostgreSQL
 * (relais/test-pg/preparer.mjs) remplace `traiter` pour faire passer chaque appel par le vrai
 * serveur Node ; celui-ci appelle toujours `traiterRequete` directement.
 */
export const relais = { traiter: (requete, env, ctx) => traiterRequete(requete, env, ctx) };
