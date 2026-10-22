/**
 * Coffre serveur de chaque compte (relais version 9) : le serveur est la RÉFÉRENCE des données.
 *
 * Chaque compte (`principal` pour le Fondateur, l'identifiant d'un ami sinon) a sur le relais un
 * ensemble d'enregistrements chiffrés de bout en bout : l'appareil scelle chaque donnée (une valeur,
 * une opération, une page de journal…) avec la clé de synchronisation DU COMPTE, tirée de sa clé
 * maîtresse ; le relais ne voit qu'un identifiant opaque (HMAC de la clé de la donnée), une date,
 * un numéro de révision et du bruit. Il ne peut rien lire.
 *
 *   GET    /v9/coffre/<compte>?depuis=<rev>&limite=<n>  enregistrements modifiés après <rev>, par pages
 *   POST   /v9/coffre/<compte>                          { enregistrements: [{ id, base, date, supprime, valeur }] }
 *   GET    /v9/coffre/<compte>/historique?limite=<n>    corbeille et conflits (toujours chiffrés)
 *   GET    /v9/coffre/<compte>/etat                     révision, nombre d'enregistrements, taille
 *   DELETE /v9/coffre/<compte>                          jeton maître seulement (compte supprimé)
 *
 * Version 10 (mêmes routes sous `/v10/coffre/…`, plus les avis de relais/avis.mjs) :
 *   GET    /v10/coffre/<compte>/version                 révision courante (sondage)
 *   GET    /v10/coffre/<compte>/attendre?rev=<n>        attente longue (25 s au plus)
 *   GET    /v10/coffre/<compte>/flux?rev=<n>            flux SSE des nouvelles révisions
 *   POST   rend aussi `avant` : la révision du coffre juste avant cet envoi (si c'est celle que
 *          l'appareil connaissait, il n'a rien à relire : personne d'autre n'a écrit entre-temps).
 *
 * Règle de conflit, PAR ENREGISTREMENT, sans perte :
 *  - l'appareil envoie la révision qu'il connaissait (`base`) ;
 *  - même révision qu'ici (ou enregistrement nouveau) : accepté ;
 *  - sinon (un autre appareil l'a changé entre-temps) : le plus récent par sa date l'emporte
 *    (« dernier gagnant » horodaté ; à date égale, ce qui existe déjà est gardé) et l'AUTRE version
 *    part dans l'historique (`conflit`) ; l'appareil qui perd reçoit la version gardée (`actuel`).
 *  - une suppression garde l'ancienne valeur dans l'historique (`suppression` : la corbeille).
 * L'historique est gardé `RETENTION_HISTORIQUE_JOURS` jours (au plus `MAX_HISTORIQUE` lignes par compte).
 *
 * Deux magasins : PostgreSQL (relais/serveur/coffres-postgres.mjs, o2switch) et la mémoire (tests,
 * serveur de développement). Sans magasin (`env.COFFRES` absent, ex. Worker Cloudflare qui transmet
 * tout à o2switch), les routes répondent 501 et les appareils restent sur l'ancienne synchronisation.
 */

import { avisDe, routeAttendre, routeFlux, routeVersion } from './avis.mjs';

export const TAILLE_MAX_VALEUR = 8 * 1024 * 1024;
export const MAX_PAR_ENVOI = 1000;
export const TAILLE_MAX_ENVOI = 48 * 1024 * 1024;
export const LIMITE_PAGE_DEFAUT = 500;
export const LIMITE_PAGE_MAX = 2000;
/** Une page ne dépasse pas cette taille (les gros enregistrements sont rendus seuls). */
export const OCTETS_PAGE_MAX = 8 * 1024 * 1024;
export const RETENTION_HISTORIQUE_JOURS = 180;
export const MAX_HISTORIQUE = 5000;

const MOTIF_ID = /^[0-9a-f]{32}$/;
const MOTIF_COMPTE = /^(principal|[a-z0-9]{6,16})$/;

const json = (corps, statut = 200) =>
  new Response(JSON.stringify(corps), {
    status: statut,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
const refus = (erreur, statut, motif) => json({ erreur, ...(motif ? { motif } : {}) }, statut);

/**
 * Décision pour un enregistrement reçu (pure, partagée par les deux magasins).
 * `existant` : { rev, date } ou undefined. Rend 'accepte' (et si l'ancienne version va dans
 * l'historique : `garder` = 'conflit' | 'suppression') ou 'perdu' (l'entrant va dans l'historique).
 */
export function decider(existant, entrant) {
  if (!existant) return { issue: 'accepte' };
  if (existant.rev === entrant.base) {
    return { issue: 'accepte', ...(entrant.supprime && !existant.supprime ? { garder: 'suppression' } : {}) };
  }
  // Conflit : un autre appareil l'a modifié depuis la révision connue de celui-ci.
  if (entrant.date > existant.date) return { issue: 'accepte', garder: entrant.supprime && !existant.supprime ? 'suppression' : 'conflit' };
  return { issue: 'perdu' };
}

/** Valide un envoi ; rend la liste propre ou un message d'erreur. */
export function lireEnvoi(corps) {
  const liste = corps?.enregistrements;
  if (!Array.isArray(liste) || liste.length === 0) return { erreur: 'Aucun enregistrement.' };
  if (liste.length > MAX_PAR_ENVOI) return { erreur: `Au plus ${MAX_PAR_ENVOI} enregistrements par envoi.` };
  const vus = new Set();
  const propres = [];
  for (const e of liste) {
    if (
      !e ||
      typeof e !== 'object' ||
      !MOTIF_ID.test(e.id ?? '') ||
      !Number.isSafeInteger(e.base) ||
      e.base < 0 ||
      typeof e.date !== 'string' ||
      e.date.length < 10 ||
      e.date.length > 40 ||
      typeof e.valeur !== 'string' ||
      e.valeur.length > TAILLE_MAX_VALEUR ||
      (e.supprime !== undefined && typeof e.supprime !== 'boolean')
    ) {
      return { erreur: 'Enregistrement illisible.' };
    }
    if (vus.has(e.id)) return { erreur: 'Enregistrement en double dans l’envoi.' };
    vus.add(e.id);
    propres.push({ id: e.id, base: e.base, date: e.date, supprime: e.supprime === true, valeur: e.valeur });
  }
  return { enregistrements: propres };
}

// ------------------------------------------------------------ Magasin en mémoire

/** Magasin en mémoire : mêmes règles que PostgreSQL (tests, serveur local). */
export function coffresMemoire({ maintenant = () => Date.now() } = {}) {
  const profils = new Map();
  const de = profil => {
    let p = profils.get(profil);
    if (!p) {
      p = { rev: 0, enregistrements: new Map(), historique: [] };
      profils.set(profil, p);
    }
    return p;
  };
  const historiser = (p, rec, raison) => {
    p.historique.push({ ...rec, raison, le: maintenant() });
    const limite = maintenant() - RETENTION_HISTORIQUE_JOURS * 86_400_000;
    p.historique = p.historique.filter(h => h.le >= limite).slice(-MAX_HISTORIQUE);
  };
  return {
    memoire: true,
    async lire(profil, depuis = 0, limite = LIMITE_PAGE_DEFAUT, octetsMax = OCTETS_PAGE_MAX) {
      const p = de(profil);
      const tries = [...p.enregistrements.values()].filter(r => r.rev > depuis).sort((a, b) => a.rev - b.rev);
      const page = [];
      let octets = 0;
      for (const r of tries) {
        if (page.length >= limite || (page.length > 0 && octets + r.valeur.length > octetsMax)) break;
        page.push({ ...r });
        octets += r.valeur.length;
      }
      return { rev: p.rev, enregistrements: page, suite: page.length < tries.length };
    },
    async version(profil) {
      return profils.get(profil)?.rev ?? 0;
    },
    async ecrire(profil, enregistrements) {
      const p = de(profil);
      const avant = p.rev;
      const resultats = [];
      for (const e of enregistrements) {
        const existant = p.enregistrements.get(e.id);
        const d = decider(existant, e);
        if (d.issue === 'perdu') {
          historiser(p, { id: e.id, rev: existant.rev, date: e.date, supprime: e.supprime, valeur: e.valeur }, 'conflit');
          resultats.push({ id: e.id, rev: existant.rev, etat: 'perdu', actuel: { ...existant } });
          continue;
        }
        if (d.garder && existant) historiser(p, { ...existant }, d.garder);
        const rev = ++p.rev;
        p.enregistrements.set(e.id, { id: e.id, rev, date: e.date, supprime: e.supprime, valeur: e.valeur });
        resultats.push({ id: e.id, rev, etat: 'ok' });
      }
      return { rev: p.rev, avant, resultats };
    },
    async historique(profil, limite = 200) {
      return [...de(profil).historique].reverse().slice(0, limite).map(h => ({ ...h }));
    },
    async etat(profil) {
      const p = de(profil);
      let octets = 0;
      for (const r of p.enregistrements.values()) octets += r.valeur.length;
      return { rev: p.rev, enregistrements: p.enregistrements.size, octets, historique: p.historique.length };
    },
    async vider(profil) {
      profils.delete(profil);
    },
  };
}

// ------------------------------------------------------------ Route

/**
 * `/v9/coffre/<compte>[/historique|/etat]`. `portee` : portée du jeton (maître, session du
 * Fondateur, ou profil) ; `delegue(titulaire, id)` : délégation d'un rang supérieur (lecture et écriture).
 */
export async function routeCoffre(requete, env, portee, compte, action, delegue, version = 9) {
  const store = env.COFFRES;
  if (!store) return refus('Coffre serveur indisponible sur ce relais.', 501, 'coffre-indisponible');
  if (!MOTIF_COMPTE.test(compte)) return refus('Compte invalide.', 400);
  // Le Fondateur (jeton maître, ou session ouverte par son mot de passe) atteint tous les coffres, sans
  // pouvoir les lire (chacun est scellé par la clé de son compte) ; un compte n'atteint que le sien.
  let permis = Boolean(portee.maitre) || portee.profil === compte;
  if (!permis && compte !== 'principal' && portee.profil && requete.method !== 'DELETE' && typeof delegue === 'function') {
    permis = await delegue(portee.profil, compte);
  }
  if (!permis) return refus('Ce coffre n’est pas le vôtre.', 403);
  const url = new URL(requete.url);

  if (action === 'historique' && requete.method === 'GET') {
    const limite = Math.max(1, Math.min(1000, Number(url.searchParams.get('limite')) || 200));
    return json({ historique: await store.historique(compte, limite) });
  }
  if (action === 'etat' && requete.method === 'GET') {
    return json(await store.etat(compte));
  }
  if (version >= 10 && requete.method === 'GET' && typeof store.version === 'function') {
    if (action === 'version') return routeVersion(store, compte);
    if (action === 'attendre') return routeAttendre(store, avisDe(env), compte, url);
    if (action === 'flux') return routeFlux(store, avisDe(env), compte, url);
  }
  if (action !== undefined) return refus('Adresse inconnue.', 404);

  if (requete.method === 'GET') {
    const depuis = Math.max(0, Number(url.searchParams.get('depuis')) || 0);
    const limite = Math.max(1, Math.min(LIMITE_PAGE_MAX, Number(url.searchParams.get('limite')) || LIMITE_PAGE_DEFAUT));
    return json(await store.lire(compte, depuis, limite, OCTETS_PAGE_MAX));
  }
  if (requete.method === 'POST') {
    const longueur = Number(requete.headers.get('Content-Length') ?? 0);
    if (longueur > TAILLE_MAX_ENVOI) return refus('Envoi trop volumineux.', 413);
    const texte = await requete.text();
    if (texte.length > TAILLE_MAX_ENVOI) return refus('Envoi trop volumineux.', 413);
    let corps;
    try {
      corps = JSON.parse(texte);
    } catch {
      return refus('Envoi illisible.', 400);
    }
    const lu = lireEnvoi(corps);
    if (lu.erreur) return refus(lu.erreur, 400);
    const ecrit = await store.ecrire(compte, lu.enregistrements);
    // Avis aux autres appareils du compte : « nouvelle révision », sans aucune donnée.
    if (ecrit.resultats.some(r => r.etat === 'ok')) avisDe(env).publier(compte, ecrit.rev);
    return json(ecrit);
  }
  if (requete.method === 'DELETE') {
    if (!portee.maitre || portee.session) return refus('Réservé au jeton de l’administrateur.', 403);
    await store.vider(compte);
    avisDe(env).publier(compte, 0);
    return json({ ok: true });
  }
  return refus('Méthode non autorisée.', 405);
}
