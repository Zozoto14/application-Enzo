/**
 * API HTTP de l'Esport : routeur et middleware, en Request/Response standard
 * (Node 22, Deno, Bun…). Aucune dépendance au runtime : le serveur Node
 * (esport/serveur/app.mjs) et le serveur local (esport/outils/
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
import { creerBot } from './discord/bot/interactions.mjs';
import { routesLiaisons, servicesLiaisons } from './discord/bot/liaisons.mjs';
import { distribuer } from './evenements.mjs';
import { routePublique, routesPlanning } from './planning/routes.mjs';
import { servicesPlanning } from './planning/service.mjs';
import { catalogue } from './permissions.mjs';
import { servicesComptes } from './comptes.mjs';
import { servicesDemandes } from './demandes.mjs';
import { servicesRecap } from './recap.mjs';
import { servicesEsport } from './service.mjs';
import { servicesTableau } from './tableau.mjs';
import { creerSession, lireSession } from './session.mjs';
import { ErreurEsport, echec } from './outils.mjs';
import { exporterBase, importerBase } from './transfert.mjs';
import { ENTETES_CORS, ENTETES_SECURITE, methodeSurchargee, reponseFichier } from './entetes.mjs';
import { servicesJournal } from './journal.mjs';
import { LANGUE_DEFAUT, langueDepuisEntete } from './langues.mjs';
import { limiter } from './limites.mjs';
import { servicesStats } from './stats.mjs';
import { routeFichierSigne, routerPhase3, servicesPhase3 } from './routes-phase3.mjs';
import { routesReview } from './review/routes.mjs';
import { servicesReview } from './review/service.mjs';
import { servicesScouting } from './scouting/service.mjs';
import { servicesPlaybook } from './strats/playbook.mjs';
import { routePubliqueStrats, routesStrats } from './strats/routes.mjs';
import { servicesStrats } from './strats/service.mjs';
import { routesSuivi, servicesSuivi } from './suivi/service.mjs';
import { configMedias, servicesMedias } from './medias/service.mjs';
import { routesRessources } from './ressources/routes.mjs';
import { servicesRessources } from './ressources/service.mjs';
import { servicesTournois } from './competition/tournois.mjs';
import { servicesResultats } from './competition/resultats.mjs';
import { routesCompetition } from './competition/routes.mjs';
import { exportUsage, servicesCollecte } from './usage/collecte.mjs';
import { exigerLecteur, servicesStatistiques } from './usage/statistiques.mjs';
import { servicesJeux } from './jeux/service.mjs';
import { routesJeux } from './jeux/routes.mjs';
import { servicesCm } from './cm/service.mjs';
import { routeFichierCm, routesCm } from './cm/routes.mjs';
import { routePubliqueReunions } from './cm/reunions/routes.mjs';
import { routeDriveSignee } from './cm/drive/routes.mjs';
import { configDrive } from './cm/drive/regles.mjs';
import { servicesSponsors } from './sponsors/service.mjs';
import { routesSponsors } from './sponsors/routes.mjs';
import { servicesReseaux } from './reseaux/service.mjs';
import { routesReseaux } from './reseaux/routes.mjs';
import { traiterAnnoncesReseaux } from './reseaux/annonces.mjs';
import { servicesTrombi } from './trombi/service.mjs';
import { routesTrombi } from './trombi/routes.mjs';
import { routesRoles, servicesRoles } from './roles/service.mjs';
import { servicesDevblog } from './devblog/service.mjs';
import { routesDevblog } from './devblog/routes.mjs';
import { traiterDevblogDiscord } from './devblog/discord.mjs';
import { routesDeploiement } from './deploiement.mjs';
import { servicesCentre } from './notifications/centre.mjs';
import { routesNotifications } from './notifications/routes.mjs';

export const VERSION_ESPORT = 4;
/** Fonctions annoncées par /sante et /session (l'app n'utilise la surcharge de méthode que si elle est là). */
export const FONCTIONS = ['surcharge-methode', 'profils-jeu', 'cm', 'sponsors', 'reseaux', 'drive', 'trombi', 'roles-permissions', 'devblog', 'deploiement', 'centre-notifications'];
const TAILLE_MAX_CORPS = 64 * 1024;
const TAILLE_MAX_IMPORT = 20 * 1024 * 1024;

const ENTETES = {
  ...ENTETES_CORS,
  ...ENTETES_SECURITE,
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; sandbox",
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
  return requete.headers.get('X-Adresse-Client') ?? ((requete.headers.get('X-Forwarded-For') ?? '').split(',')[0].trim() || null);
}

/** Type de contenu annoncé, sans paramètres (« application/json; charset=utf-8 » → « application/json »). */
export const typeContenu = requete => (requete.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();

/**
 * Corps JSON borné. Un corps non vide DOIT être annoncé `application/json` :
 * un formulaire HTML ou un `fetch` « simple » d'un site tiers (text/plain,
 * x-www-form-urlencoded, multipart) est refusé (415) avant toute lecture.
 */
async function lireCorps(requete, max = TAILLE_MAX_CORPS) {
  const longueur = Number(requete.headers.get('Content-Length') ?? 0);
  if (longueur > max) throw echec(413, 'trop-gros', 'Requête trop volumineuse.');
  const texte = await requete.text();
  if (texte.length > max) throw echec(413, 'trop-gros', 'Requête trop volumineuse.');
  if (!texte) return {};
  if (typeContenu(requete) !== 'application/json') throw echec(415, 'type-contenu', 'Corps JSON attendu (Content-Type: application/json).');
  try {
    const corps = JSON.parse(texte);
    if (!corps || typeof corps !== 'object' || Array.isArray(corps)) throw new Error();
    return corps;
  } catch {
    throw echec(400, 'json', 'Requête illisible (JSON attendu).');
  }
}

const prefixeApi = url => (url.pathname.startsWith('/api/esport') ? '/api/esport' : '');

const jetonPorteur = requete => (requete.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();

/**
 * Fabrique le gestionnaire HTTP.
 *  - `base` : interface de base (adaptateurs/) ; `stockage` : fichiers (facultatif en phase 1) ;
 *  - `cleSession` : secret CLE_ESPORT ; `verifierJeton(jeton, ip)` : voir authentification.mjs ;
 *  - `creationTeams` : « fondateur » ou « tous » ; `maintenant` : horloge (tests) ;
 *  - `ia` : assistant des profils de jeu { config (ia/connecteur.mjs : configIa), fetch (réseau simulé en
 *    test), telecharger (lecture des pages web, anti-SSRF), resoudre } ; `travauxIa` : « fond » (défaut :
 *    après la réponse) ou « synchrone » (tests).
 */
export function creerApi({
  base,
  stockage,
  cleSession,
  verifierJeton,
  creationTeams = 'fondateur',
  maintenant = () => Date.now(),
  cleDiscord,
  fetchDiscord,
  lienApp = '',
  discordBot = {},
  attenteDiffere,
  secretsExportables = false,
  medias: configDesMedias = configMedias(),
  drive: configDuDrive = configDrive(),
  transcriptionExterne = { actif: false },
  fetchTranscription,
  transcriptionServeur,
  apercuLiens = {},
  ia = {},
  travauxIa = 'fond',
  devblogSource = null,
  // Suivi des mises à jour (serveur Node seulement : esport/serveur/deploiement.mjs) ; absent : 404.
  deploiement,
}) {
  const s = servicesEsport({ base, maintenant, creationTeams });
  // Vidéos et enregistrements (envoi par morceaux, lecture par plages, espace utilisé).
  const md = servicesMedias({ base, stockage, cleSession, maintenant, socle: s, config: configDesMedias });
  const s3 = servicesPhase3({ base, stockage, cleSession, maintenant, socle: s, medias: md, transcriptionExterne, fetchTranscription, transcriptionServeur });
  const p = servicesPlanning({ base, maintenant, noyau: s });
  // Discord : secret de chiffrement des webhooks (CLE_DISCORD, sinon dérivé de CLE_ESPORT) ; `fetchDiscord` : réseau simulé en test.
  const secretDiscord = cleDiscord || cleSession;
  const envoiDiscord = fetchDiscord ?? ((...a) => globalThis.fetch(...a));
  // Jeton du bot (DISCORD_BOT_TOKEN, secret) : le fil français des messages et du message de test.
  const d = servicesDiscord({ base, maintenant, noyau: s, cle: secretDiscord, fetch: envoiDiscord, jetonBot: discordBot.jetonBot || undefined, lienApp });
  const rv = servicesReview({ base, maintenant, socle: s, medias: md });
  const sc = servicesScouting({ base, maintenant, socle: s, review: rv });
  const st = servicesStrats({ base, stockage, cleSession, maintenant, socle: s });
  const pb = servicesPlaybook({ base, maintenant, socle: s, strats: st });
  const jr = servicesJournal({ base, maintenant, socle: s });
  const stt = servicesStats({ base, maintenant, socle: s });
  // Suivi des joueurs (notes du staff) : le résumé de la fiche reprend la présence du planning.
  const sj = servicesSuivi({ base, maintenant, socle: s, planning: p });
  // Ressources : aperçu des liens récupéré par le serveur (`apercuLiens` : { telecharger, resoudre }, anti-SSRF).
  const rs = servicesRessources({ base, maintenant, socle: s, medias: md, review: rv, cleDiscord: secretDiscord, apercu: apercuLiens });
  // Tournois et Résultats (migration 0022) : les matchs de tournoi passent au planning (convocation = roster).
  const tn = servicesTournois({ base, maintenant, socle: s, planning: p });
  const rsl = servicesResultats({ base, maintenant, socle: s });
  const limite = (genre, qui) => limiter(base, genre, qui, maintenant());
  // Premier niveau (toutes teams) : invitation directe, annuaire des membres, dashboard.
  const dm = servicesDemandes({ base, maintenant, noyau: s });
  const cp = servicesComptes({ base, maintenant, noyau: s, demandes: dm });
  const rc = servicesRecap({ base, cle: secretDiscord, maintenant });
  const tb = servicesTableau({ base, maintenant, noyau: s });
  // Statistiques d'usage internes (migration 0018) : collecte par lots, page réservée au Fondateur.
  const us = servicesCollecte({ base, maintenant });
  const sts = servicesStatistiques({ base, maintenant });
  // Profils de jeu (migration 0021) et assistant IA (clé d'API dans esport.env, jamais renvoyée).
  const jx = servicesJeux({ base, maintenant, socle: s, ia, travauxIa });
  // Section CM (migration 0023) : espace du club et partie CM des teams ; fichiers par envoi par morceaux (usage « cm »).
  // Drive de la section (migration 0027) : quota, plafond d'un fichier, ZIP (ESPORT_DRIVE_*).
  const cm = servicesCm({ base, maintenant, medias: md, cleSession, stockage, drive: configDuDrive });
  // Sponsors & partenaires (migration 0024) : rubrique de l'espace CM, permissions du club sponsors.voir / sponsors.gerer.
  const sp = servicesSponsors({ base, maintenant, medias: md, cleSession, stockage, drive: cm.drive });
  // Page « Réseaux » de l'espace CM (migration 0026) : comptes, bot d'annonce Discord des posts publiés, statistiques.
  const rsx = servicesReseaux({ base, maintenant, cle: secretDiscord, fetch: envoiDiscord, jetonBot: discordBot.jetonBot || undefined, lienApp });
  // Trombinoscope (migration 0030) : page Membres › Trombinoscope (membres.trombi.voir / membres.trombi.editer).
  const trb = servicesTrombi({ base, maintenant });
  // Page « Rôles et permissions » (migration 0033) : rôles du club (Second CEO…), modèle des teams, journal.
  const rl = servicesRoles({ base, maintenant, noyau: s });
  // Devblog (migration 0036) : notes de mise à jour FR/EN, fenêtre « Nouveautés », publication Discord ; la version
  // anglaise peut être préparée par l'IA (tâche légère « traduction », texte du devblog seulement).
  // Publication automatique : `devblogSource` = historique git du dépôt déployé (serveur/devblog-source.mjs ; simulé en
  // test), rédaction par l'IA (tâche « devblog », non confidentielle : messages de commit nettoyés seulement).
  // Centre de notifications (migration 0038) : fil filtré par les droits du moment, préférences par compte.
  const nc = servicesCentre({ base, maintenant });
  const dv = servicesDevblog({ base, maintenant, discuterPour: jx.discuterPour, cle: secretDiscord, source: devblogSource });
  // Bot Discord (interactions HTTP) : DISCORD_APPLICATION_ID et DISCORD_PUBLIC_KEY (variables), DISCORD_BOT_TOKEN (secret).
  const configBot = { applicationId: discordBot.applicationId || '', publicKey: discordBot.publicKey || '' };
  const jetonBot = discordBot.jetonBot || undefined;
  const lb = servicesLiaisons({ base, maintenant, noyau: s, config: configBot });
  const bot = creerBot({
    base,
    maintenant,
    services: { noyau: s, planning: p, resumes: s3.resumes, objectifs: s3.objectifs, playbook: pb, liaisons: lb },
    config: configBot,
    fetch: envoiDiscord,
    lienApp,
    limite,
    attenteDiffere,
  });

  async function acteurDeSession(requete) {
    if (!cleSession) throw echec(503, 'non-configure', 'Le serveur Esport n’a pas de clé de session (CLE_ESPORT).');
    const session = await lireSession(cleSession, jetonPorteur(requete), maintenant());
    if (!session) throw echec(401, 'session', 'Session Esport absente ou expirée.');
    // Langue des textes produits par le serveur (exports CSV, libellés Discord) : celle de l'app (Accept-Language), français par défaut.
    return { compte: session.compte, superAdmin: session.superAdmin, langue: langueDepuisEntete(requete.headers.get('Accept-Language')) ?? LANGUE_DEFAUT };
  }

  async function router(requete) {
    const url = new URL(requete.url);
    const chemin = url.pathname.replace(/^\/api\/esport(?=\/|$)/, '').replace(/\/+$/, '') || '/';
    const m = requete.method;
    const ip = adresseIp(requete);

    if (chemin === '/sante' && m === 'GET') {
      return {
        ok: true,
        service: 'esport',
        version: VERSION_ESPORT,
        // Fonctions annoncées : « surcharge-methode » = POST + X-Methode accepté (voir entetes.mjs).
        fonctions: FONCTIONS,
        stockage: Boolean(stockage),
        session: Boolean(cleSession),
        bot: Boolean(configBot.applicationId && configBot.publicKey && jetonBot),
        medias: {
          plafond: configDesMedias.plafond,
          tailleMorceau: configDesMedias.tailleMorceau,
          transcriptionExterne: Boolean(transcriptionExterne?.actif),
          transcriptionServeur: Boolean(transcriptionServeur?.disponible),
        },
        heure: maintenant(),
      };
    }
    if (chemin === '/catalogue' && m === 'GET') return catalogue;
    if (chemin.startsWith('/fichiers/') && (m === 'GET' || m === 'HEAD')) return routeFichierSigne(md, url, requete);
    if (chemin.startsWith('/cm/fichiers/') && (m === 'GET' || m === 'HEAD')) return routeFichierCm(cm, url, requete);
    if ((chemin.startsWith('/cm/drive/contenu/') || chemin.startsWith('/cm/drive/zip/')) && (m === 'GET' || m === 'HEAD')) return routeDriveSignee(cm.drive, url, requete);
    // Abonnement iCal aux réunions de l'équipe CM (migration 0039) : jeton révocable, sans session.
    const icalReunions = await routePubliqueReunions(cm.reunions, { chemin, methode: m, url });
    if (icalReunions !== undefined) return icalReunions;
    const publique = await routePublique({ p, chemin, methode: m, url });
    if (publique !== undefined) return publique;
    const partage = await routePubliqueStrats({ strats: st, chemin, methode: m, url });
    if (partage !== undefined) return partage;
    if (chemin === '/session' && m === 'POST') {
      if (!cleSession) throw echec(503, 'non-configure', 'Le serveur Esport n’a pas de clé de session (CLE_ESPORT).');
      await limite('session', ip);
      const qui = await verifierJeton(jetonPorteur(requete), ip);
      // Compte pré-enregistré par le Fondateur : sa première session (jeton validé par le relais) l'active.
      await cp.activer(qui.compte);
      const { jeton, expire } = await creerSession(cleSession, qui, maintenant());
      return { session: jeton, expire: new Date(expire).toISOString(), fonctions: FONCTIONS, ...(await s.moi(qui)) };
    }

    // ---- Tout le reste : session Esport obligatoire.
    const acteur = await acteurDeSession(requete);

    if (chemin === '/moi') {
      if (m === 'GET') return s.moi(acteur);
      if (m === 'PUT') {
        // Création ou changement du profil (« création de compte » Esport) : bornée par compte et par IP.
        const corps = await lireCorps(requete);
        await limite('profil', acteur.compte);
        await limite('profil_ip', ip);
        return s.majProfil(acteur, corps);
      }
      if (m === 'DELETE') return s.supprimerMesDonnees(acteur);
    }
    if (chemin === '/moi/langue' && m === 'PUT') {
      await limite('profil', acteur.compte);
      return s.majLangue(acteur, await lireCorps(requete));
    }
    // Récapitulatif e-mail des notifications importantes (migration 0015) : réglé par l'utilisateur lui-même.
    if (chemin === '/moi/recap-courriel') {
      if (m === 'GET') return rc.lire(acteur);
      if (m === 'PUT') {
        await limite('profil', acteur.compte);
        return rc.regler(acteur, await lireCorps(requete));
      }
    }
    const liaisonsDiscord = await routesLiaisons(lb, { methode: m, chemin, acteur, lireCorps: () => lireCorps(requete), limite });
    if (liaisonsDiscord !== undefined) return liaisonsDiscord;
    if (chemin === '/moi/export' && m === 'GET') {
      await limite('export', acteur.compte);
      // Vidéos, enregistrements et transcriptions : liste et liens signés (72 h).
      return { ...(await s.exporterMesDonnees(acteur)), ...(await md.exportRgpd(acteur.compte, `${url.origin}${prefixeApi(url)}`)), usage: await exportUsage(base, acteur.compte) };
    }
    if (chemin === '/notifications' && m === 'GET') return s.notifications(acteur);
    if (chemin === '/notifications/lues' && m === 'POST') return s.marquerLues(acteur, await lireCorps(requete));
    const centre = await routesNotifications({ nc, acteur, chemin, methode: m, url, lireCorps: () => lireCorps(requete), limite });
    if (centre !== undefined) return centre;
    // Ancienne route des codes esp_ (retirés) : 410, sans rien écrire.
    if (chemin === '/invitations/accepter' && m === 'POST') {
      await limite('acceptation_ip', ip);
      return s.accepterInvitation(acteur, await lireCorps(requete), ip);
    }
    // Statistiques d'usage : lots de l'app (bornés par compte), sans rien d'autre que des métadonnées.
    if (chemin === '/usage' && m === 'POST') {
      const corps = await lireCorps(requete);
      await limite('usage', acteur.compte);
      return us.ingerer(acteur, corps);
    }
    // Page « Statistiques » : le Fondateur (et un rôle du club qui a statistiques.voir) ; tout autre compte reçoit 404.
    // Changer les réglages de la collecte reste au Fondateur (statistiques.mjs).
    if (chemin === '/statistiques' || chemin.startsWith('/statistiques/')) {
      await exigerLecteur(base, acteur);
      const q = url.searchParams;
      const periode = { du: q.get('du') || undefined, au: q.get('au') || undefined };
      if (chemin === '/statistiques' && m === 'GET') return sts.tableau(acteur, { ...periode, team: q.get('team') || undefined, role: q.get('role') || undefined, appareil: q.get('appareil') || undefined, absents: q.get('absents') || undefined });
      if (chemin === '/statistiques/reglages' && m === 'GET') return sts.reglages(acteur);
      if (chemin === '/statistiques/reglages' && m === 'PUT') return sts.changerReglages(acteur, await lireCorps(requete));
      const fiche = /^\/statistiques\/membres\/([^/]+)$/.exec(chemin);
      if (fiche && m === 'GET') return sts.ficheMembre(acteur, decodeURIComponent(fiche[1]), periode);
      throw echec(404, 'route', 'Adresse inconnue.');
    }
    // Mises à jour du dashboard (docs/mises-a-jour.md) : Fondateur, ou permission du club deploiement.voir ; sinon 404.
    const suiviDeploiement = await routesDeploiement({ deploiement, base, acteur, chemin, methode: m, limite });
    if (suiviDeploiement !== undefined) return suiviDeploiement;
    // Premier niveau : dashboard agrégé, annuaire des membres, invitation directe (Fondateur).
    if (chemin === '/dashboard' && m === 'GET') return tb.tableau(acteur);
    if (chemin === '/membres' && m === 'GET') return cp.annuaire(acteur);
    if (chemin === '/comptes' && m === 'POST') {
      const corps = await lireCorps(requete);
      if (corps.verifier !== true) await limite('invitation', acteur.compte);
      return cp.preinscrire(acteur, corps);
    }
    // Ajouter un compte à une ou plusieurs teams d'un coup (un rôle par team).
    const ajoutTeams = /^\/comptes\/([^/]+)\/teams$/.exec(chemin);
    if (ajoutTeams && m === 'POST') return cp.ajouterATeams(acteur, decodeURIComponent(ajoutTeams[1]), await lireCorps(requete));
    // Discord ID d'un membre (migration 0015) : le Fondateur SEUL (403 pour tout autre rôle, Propriétaire compris).
    const discordId = /^\/comptes\/([^/]+)\/discord-id$/.exec(chemin);
    if (discordId && m === 'PUT') return cp.majDiscordId(acteur, decodeURIComponent(discordId[1]), await lireCorps(requete));
    // Langue par défaut d'un compte (migration 0019) : le Fondateur SEUL (403 pour tout autre rôle).
    const langueDefaut = /^\/comptes\/([^/]+)\/langue-defaut$/.exec(chemin);
    if (langueDefaut && m === 'PUT') return cp.majLangueDefaut(acteur, decodeURIComponent(langueDefaut[1]), await lireCorps(requete));
    // Demandes de compte (members.create) : dépôt (borné), suivi, refus (Fondateur), annulation (demandeur).
    if (chemin === '/comptes/demandes') {
      if (m === 'GET') return dm.liste(acteur);
      if (m === 'POST') {
        const corps = await lireCorps(requete);
        await limite('demande_compte', acteur.compte);
        return dm.creer(acteur, corps);
      }
    }
    const demande = /^\/comptes\/demandes\/([^/]+)(\/refuser)?$/.exec(chemin);
    if (demande && demande[2] && m === 'POST') return dm.refuser(acteur, decodeURIComponent(demande[1]), await lireCorps(requete));
    if (demande && !demande[2] && m === 'DELETE') return dm.annuler(acteur, decodeURIComponent(demande[1]));
    // Compte supprimé dans l'Administration (source de vérité) : retiré de l'Esport.
    const retrait = /^\/admin\/comptes\/([^/]+)\/hub$/.exec(chemin);
    if (retrait && m === 'DELETE') return cp.retirerCompte(acteur, decodeURIComponent(retrait[1]));

    // RGPD, pour le Fondateur : données d'un membre (export) et suppression de son compte Esport.
    const rgpd = /^\/admin\/comptes\/([^/]+)(\/export)?$/.exec(chemin);
    if (rgpd) {
      if (!acteur.superAdmin) throw echec(403, 'super-admin', 'Réservé au Fondateur.');
      const compte = decodeURIComponent(rgpd[1]);
      if (rgpd[2] && m === 'GET') {
        await limite('export', acteur.compte);
        return { ...(await s.exporterCompte(acteur, compte)), ...(await md.exportRgpd(compte, `${url.origin}${prefixeApi(url)}`)), usage: await exportUsage(base, compte) };
      }
      if (!rgpd[2] && m === 'DELETE') return s.supprimerCompteMembre(acteur, compte);
    }

    // Migration vers un autre serveur (esport/serveur/importer.mjs) : les clés du serveur (session, Discord), pour
    // que les liens de partage de strats et les webhooks Discord chiffrés restent valables sur le nouveau serveur.
    // Seulement pour le Fondateur ET si le serveur l'autorise (option `secretsExportables`, désactivée par défaut).
    if (chemin === '/admin/secrets' && m === 'GET') {
      if (!acteur.superAdmin) throw echec(403, 'super-admin', 'Réservé au Fondateur.');
      if (!secretsExportables) throw echec(404, 'route', 'Adresse inconnue.');
      return { cleEsport: cleSession, ...(cleDiscord ? { cleDiscord } : {}) };
    }
    // Migration (esport/serveur/importer.mjs) : un fichier privé (PDF, miniature) par sa clé, Fondateur seulement.
    if (chemin === '/admin/fichier' && m === 'GET') {
      if (!acteur.superAdmin) throw echec(403, 'super-admin', 'Réservé au Fondateur.');
      if (!stockage) throw echec(503, 'stockage', 'Le stockage des fichiers n’est pas branché.');
      let objet;
      try {
        objet = await stockage.lire(url.searchParams.get('cle') ?? '');
      } catch {
        throw echec(400, 'cle', 'Clé de fichier invalide.');
      }
      if (!objet) throw echec(404, 'fichier', 'Fichier introuvable.');
      return new Response(objet.octets, { status: 200, headers: { ...ENTETES, 'Content-Type': 'application/octet-stream', 'X-Type-Fichier': objet.type } });
    }
    if (chemin === '/admin/export' || chemin === '/admin/import') {
      if (!acteur.superAdmin) throw echec(403, 'super-admin', 'Réservé au Fondateur.');
      if (chemin === '/admin/export' && m === 'GET') return exporterBase(base, maintenant());
      if (chemin === '/admin/import' && m === 'POST') return { ok: true, lignes: await importerBase(base, await lireCorps(requete, TAILLE_MAX_IMPORT)) };
    }

    if (chemin === '/teams') {
      if (m === 'GET') return { teams: await s.listeTeams(acteur) };
      if (m === 'POST') {
        const corps = await lireCorps(requete);
        await limite('team', acteur.compte);
        return s.creerTeam(acteur, corps);
      }
    }
    const rolesPermissions = await routesRoles({ rl, acteur, chemin, methode: m, url, lireCorps: () => lireCorps(requete), limite });
    if (rolesPermissions !== undefined) return rolesPermissions;
    const devblog = await routesDevblog({ dv, acteur, chemin, methode: m, url, lireCorps: max => lireCorps(requete, max), limite });
    if (devblog !== undefined) return devblog;
    const trombi = await routesTrombi({ tb: trb, acteur, chemin, methode: m, lireCorps: max => lireCorps(requete, max), limite });
    if (trombi !== undefined) return trombi;
    const sponsors = await routesSponsors({ sp, acteur, chemin, methode: m, url, lireCorps: max => lireCorps(requete, max), limite });
    if (sponsors !== undefined) return sponsors;
    const reseaux = await routesReseaux({ rs: rsx, acteur, chemin, methode: m, url, lireCorps: max => lireCorps(requete, max), limite });
    if (reseaux !== undefined) return reseaux;
    const sectionCm = await routesCm({ cm, medias: md, acteur, chemin, methode: m, url, requete, lireCorps: max => lireCorps(requete, max), limite });
    if (sectionCm !== undefined) return sectionCm;
    const profilsJeu = await routesJeux({ jeux: jx, acteur, chemin, methode: m, url, lireCorps: max => lireCorps(requete, max), limite });
    if (profilsJeu !== undefined) return profilsJeu;
    const planning = await routesPlanning({ p, acteur, chemin, methode: m, url, lireCorps: () => lireCorps(requete) });
    if (planning !== undefined) return planning;
    const discord = await routerDiscord(d, { methode: m, chemin, acteur, lireCorps: () => lireCorps(requete) });
    if (discord !== undefined) return discord;
    const reviewScouting = await routesReview({ review: rv, scouting: sc, medias: md, acteur, chemin, methode: m, url, requete, lireCorps: () => lireCorps(requete) });
    if (reviewScouting !== undefined) return reviewScouting;
    const suiviJoueurs = await routesSuivi({ suivi: sj, acteur, chemin, methode: m, url, lireCorps: () => lireCorps(requete) });
    if (suiviJoueurs !== undefined) return suiviJoueurs;
    const canalRessources = await routesRessources({ ressources: rs, medias: md, acteur, chemin, methode: m, url, requete, lireCorps: () => lireCorps(requete), limite });
    if (canalRessources !== undefined) return canalRessources;
    const competition = await routesCompetition({ tournois: tn, resultats: rsl, socle: s, base, acteur, chemin, methode: m, url, lireCorps: () => lireCorps(requete) });
    if (competition !== undefined) return competition;
    const stratsPlaybook = await routesStrats({ strats: st, playbook: pb, acteur, chemin, methode: m, url, lireCorps: max => lireCorps(requete, max) });
    if (stratsPlaybook !== undefined) return stratsPlaybook;
    const t = /^\/teams\/([^/]+)(?:\/([a-z]+)(?:\/([^/]+)(?:\/([a-z]+))?)?(?:\/.*)?)?$/.exec(chemin);
    if (t) {
      const [, teamId, section, sousId, action] = t;
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
        if (sousId && m === 'POST' && action === 'retablir') return s.retablirRole(acteur, teamId, sousId);
        if (sousId && m === 'DELETE') return s.supprimerRole(acteur, teamId, sousId);
      }
      if (section === 'membres') {
        if (!sousId && m === 'GET') return { membres: await s.listeMembres(acteur, teamId) };
        if (!sousId && m === 'POST') {
          const corps = await lireCorps(requete);
          await limite('invitation', acteur.compte);
          return cp.ajouterMembre(acteur, teamId, corps);
        }
        if (sousId && m === 'PATCH') return s.modifierMembre(acteur, teamId, sousId, await lireCorps(requete));
        if (sousId && m === 'DELETE') return s.retirerMembre(acteur, teamId, sousId);
      }
      if (section === 'invitations') {
        if (!sousId && m === 'GET') return { invitations: await s.listeInvitations(acteur, teamId) };
        if (!sousId && m === 'POST') {
          const corps = await lireCorps(requete);
          await limite('invitation', acteur.compte);
          return s.creerInvitation(acteur, teamId, corps);
        }
        if (sousId && m === 'DELETE') return s.revoquerInvitation(acteur, teamId, sousId);
      }
      if (section === 'journal') {
        const q = url.searchParams;
        const filtres = { action: q.get('action') || undefined, module: q.get('module') || undefined, acteur: q.get('acteur') || undefined, du: q.get('du') || undefined, au: q.get('au') || undefined };
        if (!sousId && m === 'GET') return jr.liste(acteur, teamId, { ...filtres, avant: q.get('avant') || undefined, limite: q.get('limite') || undefined });
        if (sousId === 'export.csv' && m === 'GET') {
          await limite('export', acteur.compte);
          return reponseFichier(await jr.exporter(acteur, teamId, filtres), url);
        }
        if (sousId === 'reglages' && m === 'GET') return jr.lireReglages(acteur, teamId);
        if (sousId === 'reglages' && m === 'PUT') return jr.changerReglages(acteur, teamId, await lireCorps(requete));
      }
      if (section === 'stats' && !sousId && m === 'GET') {
        const q = url.searchParams;
        return stt.stats(acteur, teamId, { du: q.get('du') || undefined, au: q.get('au') || undefined });
      }
      if (section === 'm' && sousId) return s.moduleFutur(acteur, teamId, sousId);
      // Espace utilisé (Paramètres) : vidéos, enregistrements et PDF de la team ; suppression selon le module.
      if (section === 'espace') {
        if (!sousId && m === 'GET') return md.espace(acteur, teamId);
        if (sousId && m === 'DELETE') return md.supprimerFichierEspace(acteur, teamId, sousId);
      }
    }
    const phase3 = await routerPhase3(s3, { requete, url, chemin, acteur, lireCorps, medias: md });
    if (phase3 !== undefined) return phase3;
    throw echec(404, 'route', 'Adresse inconnue.');
  }

  /**
   * Traite une requête. `attendre(promesse)` (pont HTTP du serveur Node) laisse
   * la distribution des événements finir après la réponse ; sans lui, elle
   * est attendue avant de répondre (tests, serveur local).
   */
  return async function traiter(requete, { attendre } = {}) {
    if (requete.method === 'OPTIONS') return new Response(null, { status: 204, headers: ENTETES });
    // POST + `X-Methode: PATCH|PUT|DELETE` (frontal mutualisé qui bloque ces méthodes) : la requête
    // devient l'originale, puis suit exactement le même chemin (routeur, contrôles, bus d'événements).
    const surcharge = methodeSurchargee(requete);
    if (surcharge === null) return reponseErreur(echec(400, 'methode', 'Surcharge de méthode refusée (X-Methode : PATCH, PUT ou DELETE).'));
    if (surcharge) requete = new Request(requete, { method: surcharge });
    let reponse;
    let chemin = '';
    try {
      chemin = new URL(requete.url).pathname.replace(/^\/api\/esport(?=\/|$)/, '').replace(/\/+$/, '');
      // Discord appelle cette adresse (signature Ed25519, pas de session) : le bot répond lui-même.
      const resultat = chemin === '/discord/interactions' && requete.method === 'POST' ? await bot.traiter(requete, { attendre }) : await router(requete);
      // Fichiers (iCal, CSV) : réponse déjà faite par la route.
      reponse = resultat instanceof Response ? resultat : reponseJson(resultat);
    } catch (e) {
      reponse = reponseErreur(e);
    }
    // Lots de statistiques d'usage : rien à distribuer (pas d'événement du bus), aucune requête de plus (hébergement mutualisé).
    if (!['GET', 'HEAD', 'OPTIONS'].includes(requete.method) && chemin !== '/usage') {
      // Distribution du bus, puis envoi immédiat des messages Discord mis en file (le cron reprend les réessais).
      const travail = distribuer(base, { maintenant: maintenant() })
        .then(() => traiterFile(base, { cle: secretDiscord, fetch: envoiDiscord, maintenant: maintenant(), lienApp, jetonBot }))
        // Annonces Discord des posts publiés (page Réseaux) : même principe, leur propre file.
        .then(() => traiterAnnoncesReseaux(base, { cle: secretDiscord, fetch: envoiDiscord, maintenant: maintenant(), lienApp, jetonBot, stockage }))
        // Devblogs publiés sur Discord (anglais + fil français) : leur propre file.
        .then(() => traiterDevblogDiscord(base, { cle: secretDiscord, fetch: envoiDiscord, maintenant: maintenant(), jetonBot }))
        .catch(e => console.error('[esport] distribution', e));
      if (attendre) attendre(travail);
      else await travail;
    }
    return reponse;
  };
}
