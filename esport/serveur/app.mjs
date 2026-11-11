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
import { creerServeurHttp, ecouter, exigerNode, lireCleAdresse } from './commun.mjs';

/** Clé de preuve d'adresse partagée avec le relais : relue tant qu'elle manque (le relais la crée à son démarrage). */
function cleAdresseRelais() {
  let cle = '';
  return () => (cle ||= lireCleAdresse());
}
import { compresser } from '../../relais/serveur/compression.mjs';
import { nettoyerOrphelinIaLocale } from './ia-locale/gestionnaire.mjs';
import { creerIaLocale } from './ia-locale/service.mjs';
import { etatAdministration } from './transcription/moteur.mjs';
import { journalIaLocaleParDefaut } from './ia-locale/installation.mjs';
import { sourceGitDepot } from './devblog-source.mjs';
import { creerServiceDeploiement } from './deploiement.mjs';
import { creerSuperviseurTickets } from '../noyau/tickets/superviseur.mjs';
import { creerFetchDiscordNode } from '../adaptateurs/fetchDiscordNode.mjs';
import { configSmtp, creerEnvoyeur, manquesSmtp, resumeSmtp, suivreVerificationSmtp } from './courriel-smtp.mjs';
import { installerJournal } from './journal-fichier.mjs';
import { infosDemarrage } from './version-serveur.mjs';

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
    verifierJeton: verifierJeton ?? verificateurRelais({ adresse: config.relais, cleAdresse: cleAdresseRelais() }),
    creationTeams: config.creationTeams,
    cleDiscord: config.cleDiscord,
    lienApp: config.lienApp,
    discordBot: config.discordBot,
    ticketsServeur: { gateway: config.ticketsGateway !== false, reveil: Boolean(config.urlPublique) },
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
  // Rien n'est ouvert tant que les tickets ne sont pas activés dans l'app (Tickets › Configuration). Le meneur garde
  // l'app éveillée (Passenger arrête un processus sans requête) : URL_PUBLIQUE/sante toutes les 4 minutes (pas en
  // test : un fetch Discord simulé est alors fourni, aucun réseau réel).
  const reveil = config.urlPublique && !fetchDiscord ? `${String(config.urlPublique).replace(/\/+$/, '')}/sante` : null;
  // Salons vocaux : appels REST du moteur (création du salon, déplacement du membre) sur une connexion persistante
  // vers discord.com (keep-alive) ; DISCORD_CONNEXION_PERSISTANTE=non revient au fetch global de Node.
  const avecTickets = demarrerTickets && config.ticketsGateway !== false && config.discordBot?.jetonBot;
  const fetchRest = avecTickets && !fetchDiscord && !/^(0|non|no|false|off)$/i.test(String(process.env.DISCORD_CONNEXION_PERSISTANTE ?? '').trim()) ? creerFetchDiscordNode() : null;
  const superviseur = avecTickets
    ? creerSuperviseurTickets({ base: b, jetonBot: config.discordBot.jetonBot, botId: config.discordBot.applicationId || null, stockage: st, reveil, ...(fetchDiscord ? { fetch: fetchDiscord } : {}), ...(fetchRest ? { fetchRest } : {}), ...api.ticketsGateway })
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
      fetchRest?.fermer();
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
  // Réponses JSON compressées (gzip, comme le relais) quand l'appareil l'accepte : listes du planning, de la CM, des
  // tickets plusieurs fois plus légères en 4G. Jamais les flux (SSE, attente longue : X-Accel-Buffering), ni les fichiers.
  const traiterCompresse = async (requete, options) => compresser(requete, await esport.traiter(requete, options));
  const serveur = creerServeurHttp(traiterCompresse, { urlPublique: esport.config.urlPublique, tailleMax });
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

/** Ligne de démarrage du journal (~/logs/esport.log) : version, Node, pid, configuration, e-mails ; aucun secret. */
export function ligneDemarrage({ infos, config, journal, env = process.env }) {
  const smtp = configSmtp(env);
  const manques = manquesSmtp(env);
  const courriel = smtp ? `SMTP configuré (${resumeSmtp(smtp)})` : manques.length === 4 ? 'SMTP non configuré (facultatif : récapitulatif par e-mail)' : `SMTP incomplet (manquant : ${manques.join(', ') || 'MAIL_FROM valide'})`;
  return `[esport] démarrage : version ${infos.commit ? infos.commit.slice(0, 7) : 'inconnue'}, Node ${infos.node}, pid ${infos.pid}, configuration ${config.fichierEnv ?? 'aucun fichier (variables de Setup Node.js App seulement)'}, journal ${journal?.fichier ?? 'désactivé'} ; e-mails : ${courriel}`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href || globalThis.__appdashboardDemarrer === 'esport') {
  // Journal ~/logs/esport.log d'abord (après esport.env : réglages et valeurs à masquer), pour tout voir, même un échec.
  const config = chargerConfigEsport();
  const journal = installerJournal({ app: 'esport' });
  console.log(ligneDemarrage({ infos: infosDemarrage({ app: 'esport' }), config, journal }));
  demarrer({ config })
    .then(async s => {
      console.log(`[esport] serveur prêt (${s.url})`);
      // Vérification SMTP du récapitulatif (connexion + identifiants), sans rien envoyer ni retarder le démarrage.
      const smtp = configSmtp(process.env);
      if (smtp) {
        const envoyeur = await creerEnvoyeur({ ...smtp, copieEnvoyes: false }).catch(() => undefined);
        await suivreVerificationSmtp(envoyeur, { app: 'esport' }).lancer();
        await envoyeur?.fermer?.().catch(() => undefined);
      }
    })
    .catch(e => {
      console.error('[esport] démarrage impossible :', e);
      process.exit(1);
    });
}
