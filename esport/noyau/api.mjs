/**
 * API HTTP de l'Esport : routeur et middleware, en Request/Response standard
 * (Workers, Node 22, Deno, Bun…). Aucune dépendance au runtime Cloudflare :
 * le Worker (esport/worker.mjs) et le serveur local (esport/outils/
 * serveur-local.mjs) ne font que fournir la base, le stockage, la clé de
 * session et le vérificateur de jeton.
 *
 * Middleware commun, dans cet ordre : authentification (session courte
 * `es1.…`) → appartenance à la team → module activé → permission (les trois
 * derniers dans service.mjs). Routes acceptées avec ou sans le préfixe
 * `/api/esport`.
 */

import { servicesDiscord, routerDiscord } from './discord/routes.mjs';
import { traiterFile } from './discord/file.mjs';
import { distribuer } from './evenements.mjs';
import { routePublique, routesPlanning } from './planning/routes.mjs';
import { servicesPlanning } from './planning/service.mjs';
import { catalogue } from './permissions.mjs';
import { servicesEsport } from './service.mjs';
import { creerSession, lireSession } from './session.mjs';
import { ErreurEsport, echec } from './outils.mjs';
import { exporterBase, importerBase } from './transfert.mjs';
import { routeFichierSigne, routerPhase3, servicesPhase3 } from './routes-phase3.mjs';

export const VERSION_ESPORT = 3;
const TAILLE_MAX_CORPS = 64 * 1024;
const TAILLE_MAX_IMPORT = 20 * 1024 * 1024;

const ENTETES = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Nom-Fichier',
  'Access-Control-Max-Age': '86400',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
};

export function reponseJson(corps, statut = 200, entetes = {}) {
  return new Response(JSON.stringify(corps), { status: statut, headers: { ...ENTETES, 'Content-Type': 'application/json; charset=utf-8', ...entetes } });
}

function reponseErreur(e) {
  if (e instanceof ErreurEsport) {
    const corps = { erreur: e.message, code: e.code, ...(e.details ? { details: e.details } : {}), ...(e.attente ? { attente: e.attente } : {}) };
    return reponseJson(corps, e.statut, e.attente ? { 'Retry-After': String(e.attente) } : {});
  }
  console.error('[esport] erreur interne', e);
  return reponseJson({ erreur: 'Erreur interne du serveur Esport.', code: 'interne' }, 500);
}

export function adresseIp(requete) {
  return requete.headers.get('CF-Connecting-IP') ?? ((requete.headers.get('X-Forwarded-For') ?? '').split(',')[0].trim() || null);
}

async function lireCorps(requete, max = TAILLE_MAX_CORPS) {
  const longueur = Number(requete.headers.get('Content-Length') ?? 0);
  if (longueur > max) throw echec(413, 'trop-gros', 'Requête trop volumineuse.');
  const texte = await requete.text();
  if (texte.length > max) throw echec(413, 'trop-gros', 'Requête trop volumineuse.');
  if (!texte) return {};
  try {
    const corps = JSON.parse(texte);
    if (!corps || typeof corps !== 'object' || Array.isArray(corps)) throw new Error();
    return corps;
  } catch {
    throw echec(400, 'json', 'Requête illisible (JSON attendu).');
  }
}

const jetonPorteur = requete => (requete.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();

/**
 * Fabrique le gestionnaire HTTP.
 *  - `base` : interface de base (adaptateurs/) ; `stockage` : fichiers (facultatif en phase 1) ;
 *  - `cleSession` : secret CLE_ESPORT ; `verifierJeton(jeton, ip)` : voir authentification.mjs ;
 *  - `creationTeams` : « fondateur » ou « tous » ; `maintenant` : horloge (tests).
 */
export function creerApi({ base, stockage, cleSession, verifierJeton, creationTeams = 'fondateur', maintenant = () => Date.now(), cleDiscord, fetchDiscord, lienApp = '' }) {
  const s = servicesEsport({ base, maintenant, creationTeams });
  const s3 = servicesPhase3({ base, stockage, cleSession, maintenant, socle: s });
  const p = servicesPlanning({ base, maintenant, noyau: s });
  // Discord : secret de chiffrement des webhooks (CLE_DISCORD, sinon dérivé de CLE_ESPORT) ; `fetchDiscord` : réseau simulé en test.
  const secretDiscord = cleDiscord || cleSession;
  const envoiDiscord = fetchDiscord ?? ((...a) => globalThis.fetch(...a));
  const d = servicesDiscord({ base, maintenant, noyau: s, cle: secretDiscord, fetch: envoiDiscord });

  async function acteurDeSession(requete) {
    if (!cleSession) throw echec(503, 'non-configure', 'Le serveur Esport n’a pas de clé de session (CLE_ESPORT).');
    const session = await lireSession(cleSession, jetonPorteur(requete), maintenant());
    if (!session) throw echec(401, 'session', 'Session Esport absente ou expirée.');
    return { compte: session.compte, superAdmin: session.superAdmin };
  }

  async function router(requete) {
    const url = new URL(requete.url);
    const chemin = url.pathname.replace(/^\/api\/esport(?=\/|$)/, '').replace(/\/+$/, '') || '/';
    const m = requete.method;
    const ip = adresseIp(requete);

    if (chemin === '/sante' && m === 'GET') {
      return { ok: true, service: 'esport', version: VERSION_ESPORT, stockage: Boolean(stockage), session: Boolean(cleSession), heure: maintenant() };
    }
    if (chemin === '/catalogue' && m === 'GET') return catalogue;
    if (chemin.startsWith('/fichiers/') && m === 'GET') return routeFichierSigne(s3.resumes, url);
    const publique = await routePublique({ p, chemin, methode: m, url });
    if (publique !== undefined) return publique;
    if (chemin === '/session' && m === 'POST') {
      if (!cleSession) throw echec(503, 'non-configure', 'Le serveur Esport n’a pas de clé de session (CLE_ESPORT).');
      const qui = await verifierJeton(jetonPorteur(requete), ip);
      const { jeton, expire } = await creerSession(cleSession, qui, maintenant());
      return { session: jeton, expire: new Date(expire).toISOString(), ...(await s.moi(qui)) };
    }

    // ---- Tout le reste : session Esport obligatoire.
    const acteur = await acteurDeSession(requete);

    if (chemin === '/moi') {
      if (m === 'GET') return s.moi(acteur);
      if (m === 'PUT') return s.majProfil(acteur, await lireCorps(requete));
      if (m === 'DELETE') return s.supprimerMesDonnees(acteur);
    }
    if (chemin === '/moi/export' && m === 'GET') return s.exporterMesDonnees(acteur);
    if (chemin === '/notifications' && m === 'GET') return s.notifications(acteur);
    if (chemin === '/notifications/lues' && m === 'POST') return s.marquerLues(acteur, await lireCorps(requete));
    if (chemin === '/invitations/accepter' && m === 'POST') return s.accepterInvitation(acteur, await lireCorps(requete), ip);

    if (chemin === '/admin/export' || chemin === '/admin/import') {
      if (!acteur.superAdmin) throw echec(403, 'super-admin', 'Réservé au Fondateur.');
      if (chemin === '/admin/export' && m === 'GET') return exporterBase(base, maintenant());
      if (chemin === '/admin/import' && m === 'POST') return { ok: true, lignes: await importerBase(base, await lireCorps(requete, TAILLE_MAX_IMPORT)) };
    }

    if (chemin === '/teams') {
      if (m === 'GET') return { teams: await s.listeTeams(acteur) };
      if (m === 'POST') return s.creerTeam(acteur, await lireCorps(requete));
    }
    const planning = await routesPlanning({ p, acteur, chemin, methode: m, url, lireCorps: () => lireCorps(requete) });
    if (planning !== undefined) return planning;
    const discord = await routerDiscord(d, { methode: m, chemin, acteur, lireCorps: () => lireCorps(requete) });
    if (discord !== undefined) return discord;
    const t = /^\/teams\/([^/]+)(?:\/([a-z]+)(?:\/([^/]+))?(?:\/.*)?)?$/.exec(chemin);
    if (t) {
      const [, teamId, section, sousId] = t;
      if (!section) {
        if (m === 'GET') return s.detailTeam(acteur, teamId);
        if (m === 'PATCH') return s.modifierTeam(acteur, teamId, await lireCorps(requete));
        if (m === 'DELETE') return s.supprimerTeam(acteur, teamId);
      }
      if (section === 'modules' && !sousId && m === 'PUT') return s.changerModules(acteur, teamId, await lireCorps(requete));
      if (section === 'roles') {
        if (!sousId && m === 'GET') return { roles: await s.listeRoles(acteur, teamId) };
        if (!sousId && m === 'POST') return s.creerRole(acteur, teamId, await lireCorps(requete));
        if (sousId && m === 'PATCH') return s.modifierRole(acteur, teamId, sousId, await lireCorps(requete));
        if (sousId && m === 'DELETE') return s.supprimerRole(acteur, teamId, sousId);
      }
      if (section === 'membres') {
        if (!sousId && m === 'GET') return { membres: await s.listeMembres(acteur, teamId) };
        if (sousId && m === 'PATCH') return s.modifierMembre(acteur, teamId, sousId, await lireCorps(requete));
        if (sousId && m === 'DELETE') return s.retirerMembre(acteur, teamId, sousId);
      }
      if (section === 'invitations') {
        if (!sousId && m === 'GET') return { invitations: await s.listeInvitations(acteur, teamId) };
        if (!sousId && m === 'POST') return s.creerInvitation(acteur, teamId, await lireCorps(requete));
        if (sousId && m === 'DELETE') return s.revoquerInvitation(acteur, teamId, sousId);
      }
      if (section === 'journal' && !sousId && m === 'GET') {
        const p = url.searchParams;
        return s.journal(acteur, teamId, { avant: p.get('avant'), limite: p.get('limite'), action: p.get('action'), acteur: p.get('acteur') });
      }
      if (section === 'm' && sousId) return s.moduleFutur(acteur, teamId, sousId);
    }
    const phase3 = await routerPhase3(s3, { requete, url, chemin, acteur, lireCorps });
    if (phase3 !== undefined) return phase3;
    throw echec(404, 'route', 'Adresse inconnue.');
  }

  /**
   * Traite une requête. `attendre(promesse)` (Worker : `ctx.waitUntil`) laisse
   * la distribution des événements finir après la réponse ; sans lui, elle
   * est attendue avant de répondre (tests, serveur local).
   */
  return async function traiter(requete, { attendre } = {}) {
    if (requete.method === 'OPTIONS') return new Response(null, { status: 204, headers: ENTETES });
    let reponse;
    try {
      const resultat = await router(requete);
      // Fichiers (iCal, CSV) : réponse déjà faite par la route.
      reponse = resultat instanceof Response ? resultat : reponseJson(resultat);
    } catch (e) {
      reponse = reponseErreur(e);
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(requete.method)) {
      // Distribution du bus, puis envoi immédiat des messages Discord mis en file (le cron reprend les réessais).
      const travail = distribuer(base, { maintenant: maintenant() })
        .then(() => traiterFile(base, { cle: secretDiscord, fetch: envoiDiscord, maintenant: maintenant(), lienApp }))
        .catch(e => console.error('[esport] distribution', e));
      if (attendre) attendre(travail);
      else await travail;
    }
    return reponse;
  };
}
