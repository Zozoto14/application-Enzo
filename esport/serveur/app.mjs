/**
 * Serveur Esport autonome (Node 22 + PostgreSQL) : l'API du cœur portable
 * (esport/noyau/api.mjs), fichiers sur le disque (adaptateurs/stockage.mjs), jetons validés par le
 * relais en HTTPS (RELAIS_URL, POST /jeton/verifier). Compatible Passenger (o2switch « Setup Node.js
 * App » : fichier de démarrage `serveur/app.cjs`, qui charge celui-ci) ; PORT fourni par l'hébergeur.
 *
 * Les tâches planifiées NE tournent PAS ici (Passenger peut endormir l'app) : esport/serveur/cron.mjs,
 * lancé par une tâche cron cPanel toutes les 5 minutes. Mode d'emploi : docs/o2switch.md.
 */

import { pathToFileURL } from 'node:url';
import { basePostgres, optionsDepuisEnv } from '../adaptateurs/postgres.mjs';
import { stockageDisque } from '../adaptateurs/stockage.mjs';
import { resoudreNode, telechargeurNode } from '../adaptateurs/apercuNode.mjs';
import { fetchIaDepuisEnv } from '../adaptateurs/fetchIaNode.mjs';
import { creerApi, reponseJson } from '../noyau/api.mjs';
import { verificateurRelais } from '../noyau/authentification.mjs';
import { chargerConfigEsport, problemesConfig } from './config.mjs';
import { creerServeurHttp, ecouter, exigerNode } from './commun.mjs';
import { nettoyerOrphelinIaLocale } from './ia-locale/gestionnaire.mjs';
import { creerIaLocale } from './ia-locale/service.mjs';
import { etatAdministration } from './transcription/moteur.mjs';
import { journalIaLocaleParDefaut } from './ia-locale/installation.mjs';
import { sourceGitDepot } from './devblog-source.mjs';
import { creerServiceDeploiement } from './deploiement.mjs';
import { creerSuperviseurTickets } from '../noyau/tickets/superviseur.mjs';

/**
 * Prépare le gestionnaire HTTP. `base` et `stockage` peuvent être fournis (tests) ; sinon Postgres
 * (environnement) et le dossier FICHIERS_DIR. Rend `{ traiter, base, stockage, config, fermer }`.
 */
export async function preparerEsport({ config = chargerConfigEsport(), base, stockage, fetchDiscord, verifierJeton, secretsExportables = false, fetchIa, travauxIa, iaLocale, devblogSource, deploiement, demarrerTickets = true } = {}) {
  const problemes = problemesConfig({ ...config, baseConfiguree: config.baseConfiguree || Boolean(base) });
  if (problemes.length) {
    console.error(`[esport] configuration incomplète :\n - ${problemes.join('\n - ')}`);
    const traiter = async () => reponseJson({ erreur: 'Serveur Esport pas encore configuré (voir docs/o2switch.md).', code: 'non-configure', problemes }, 503);
    return { traiter, config, problemes, fermer: async () => {} };
  }
  const b = base ?? (await basePostgres(optionsDepuisEnv()));
  // IA locale : moteur resté orphelin après un redémarrage de l'app (Passenger) arrêté tout de suite.
  if (config.iaLocale?.installation?.installe) {
    try {
      const n = await nettoyerOrphelinIaLocale({ dossier: config.iaLocale.dossier, journal: journalIaLocaleParDefaut(), role: 'app' });
      if (n.nettoye) console.warn(`[esport] IA locale : moteur orphelin arrêté${n.pid ? ` (pid ${n.pid})` : ''}.`);
    } catch (e) {
      console.error('[esport] IA locale : nettoyage impossible', e?.message ?? e);
    }
  }
  const local = iaLocale ?? creerIaLocale(config.iaLocale, { role: 'app' });
  const st = stockage ?? (await stockageDisque(config.dossierFichiers));
  const api = creerApi({
    base: b,
    stockage: st,
    cleSession: config.cleSession,
    verifierJeton: verifierJeton ?? verificateurRelais({ adresse: config.relais }),
    creationTeams: config.creationTeams,
    cleDiscord: config.cleDiscord,
    lienApp: config.lienApp,
    discordBot: config.discordBot,
    fetchDiscord,
    secretsExportables,
    medias: config.medias,
    ...(config.drive ? { drive: config.drive } : {}),
    transcriptionExterne: config.transcriptionExterne,
    transcriptionServeur: config.transcriptionServeur,
    // Aperçus des liens (Ressources) : chaque adresse IP est vérifiée au moment de la connexion (anti-SSRF).
    apercuLiens: { telecharger: telechargeurNode() },
    // Assistant IA des profils de jeu (IA_API_URL, IA_API_CLE, IA_MODELE) : pages web lues avec la même protection.
    // IA locale (llama.cpp, 127.0.0.1 seulement) : à la place ou en secours de la clé d'API (Administration IA).
    // Transport des API d'IA : node:https avec étapes mesurées (DNS, connexion, TLS, premier octet), IA_IPV4=oui possible.
    ia: { config: config.ia, telecharger: telechargeurNode(), resoudre: resoudreNode, fetch: fetchIa ?? fetchIaDepuisEnv(), ...(local ? { local } : {}), transcription: () => etatAdministration(config.transcriptionServeur) },
    ...(travauxIa ? { travauxIa } : {}),
    // Devblog automatique : historique git du dépôt déployé (chemins fixes, git sans shell).
    devblogSource: devblogSource ?? sourceGitDepot(),
    // Suivi des mises à jour (Fondateur) : versions, journal de deployer.sh, état GitHub (docs/mises-a-jour.md).
    deploiement: deploiement ?? creerServiceDeploiement(),
    // Temps réel (docs/esport/temps-reel.md) : TEMPS_REEL=sse|attente|sondage.
    ...(config.tempsReel ? { tempsReel: config.tempsReel } : {}),
  });
  if (config.tempsReel) console.log(`[esport] temps réel : mode ${api.tempsReel.mode}`);
  // Tickets Discord : connexion Gateway tenue par UN seul processus du compte (bail en base), relecture REST sinon.
  // Rien n'est ouvert tant que les tickets ne sont pas activés dans l'app (Tickets › Configuration).
  const superviseur =
    demarrerTickets && config.ticketsGateway !== false && config.discordBot?.jetonBot
      ? creerSuperviseurTickets({ base: b, jetonBot: config.discordBot.jetonBot, botId: config.discordBot.applicationId || null, stockage: st, ...(fetchDiscord ? { fetch: fetchDiscord } : {}), ...api.ticketsGateway })
      : null;
  superviseur?.demarrer();
  return {
    traiter: api,
    base: b,
    stockage: st,
    config,
    problemes,
    superviseurTickets: superviseur,
    fermer: async () => {
      await superviseur?.arreter();
      await api.tempsReel?.fermer();
      if (!base) await b.fermer();
    },
  };
}

/** Démarre le serveur HTTP. Rend `{ url, serveur, esport, fermer }`. */
export async function demarrer({ port, hote, ...options } = {}) {
  exigerNode(22);
  const esport = await preparerEsport(options);
  // Corps de requête borné : un morceau de vidéo (ESPORT_TAILLE_MORCEAU) passe, avec de la marge ; au moins 25 Mo (import, PDF).
  const tailleMax = Math.max(25 * 1024 * 1024, (esport.config.medias?.tailleMorceau ?? 0) + 1024 * 1024);
  const serveur = creerServeurHttp(esport.traiter, { urlPublique: esport.config.urlPublique, tailleMax });
  const url = await ecouter(serveur, { port, hote });
  return {
    url,
    serveur,
    esport,
    fermer: async () => {
      await new Promise(ok => serveur.close(() => ok()));
      await esport.fermer();
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href || globalThis.__appdashboardDemarrer === 'esport') {
  demarrer()
    .then(s => console.log(`[esport] serveur prêt (${s.url})${s.esport.config.fichierEnv ? `, configuration : ${s.esport.config.fichierEnv}` : ''}`))
    .catch(e => {
      console.error('[esport] démarrage impossible :', e);
      process.exit(1);
    });
}
