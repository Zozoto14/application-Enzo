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
import { creerApi, reponseJson } from '../noyau/api.mjs';
import { verificateurRelais } from '../noyau/authentification.mjs';
import { chargerConfigEsport, problemesConfig } from './config.mjs';
import { creerServeurHttp, ecouter, exigerNode } from './commun.mjs';

/**
 * Prépare le gestionnaire HTTP. `base` et `stockage` peuvent être fournis (tests) ; sinon Postgres
 * (environnement) et le dossier FICHIERS_DIR. Rend `{ traiter, base, stockage, config, fermer }`.
 */
export async function preparerEsport({ config = chargerConfigEsport(), base, stockage, fetchDiscord, verifierJeton, secretsExportables = false, fetchIa, travauxIa } = {}) {
  const problemes = problemesConfig({ ...config, baseConfiguree: config.baseConfiguree || Boolean(base) });
  if (problemes.length) {
    console.error(`[esport] configuration incomplète :\n - ${problemes.join('\n - ')}`);
    const traiter = async () => reponseJson({ erreur: 'Serveur Esport pas encore configuré (voir docs/o2switch.md).', code: 'non-configure', problemes }, 503);
    return { traiter, config, problemes, fermer: async () => {} };
  }
  const b = base ?? (await basePostgres(optionsDepuisEnv()));
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
    transcriptionExterne: config.transcriptionExterne,
    transcriptionServeur: config.transcriptionServeur,
    // Aperçus des liens (Ressources) : chaque adresse IP est vérifiée au moment de la connexion (anti-SSRF).
    apercuLiens: { telecharger: telechargeurNode() },
    // Assistant IA des profils de jeu (IA_API_URL, IA_API_CLE, IA_MODELE) : pages web lues avec la même protection.
    ia: { config: config.ia, telecharger: telechargeurNode(), resoudre: resoudreNode, ...(fetchIa ? { fetch: fetchIa } : {}) },
    ...(travauxIa ? { travauxIa } : {}),
  });
  return { traiter: api, base: b, stockage: st, config, problemes, fermer: async () => (base ? undefined : b.fermer()) };
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
