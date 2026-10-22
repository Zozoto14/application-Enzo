/**
 * Relais AppDashboard en serveur Node autonome (Node 22 + PostgreSQL), hors Cloudflare : le MÊME code
 * que le Worker (relais/worker.mjs), avec la boîte KV `BOITE` rangée dans PostgreSQL (table relais_kv,
 * relais/serveur/kv-postgres.mjs). Compatible Passenger (o2switch « Setup Node.js App » : fichier de
 * démarrage `serveur/app.cjs`). Mode d'emploi : docs/o2switch.md.
 *
 * Configuration (variables de « Setup Node.js App » et/ou fichier ~/.appdashboard/relais.env, HORS du
 * dépôt et de public_html ; chemin modifiable par RELAIS_ENV) :
 *   JETON                 jeton maître (le MÊME que sur Cloudflare : les jetons de profil des amis en dérivent)
 *   DATABASE_URL          postgres://… (ou PGHOST, PGUSER, PGPASSWORD, PGDATABASE), même base que l'Esport
 *   DISCORD_WEBHOOK_URL   salon du support (facultatif, docs/support.md) ; DISCORD_BOT_TOKEN : fils dans un salon texte
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM   envoi d'e-mails (facultatif, docs/emails.md)
 *   MAIL_COPIE_ENVOYES, IMAP_HOST, IMAP_PORT, IMAP_DOSSIER   copie dans « Envoyés » (défaut : activée, docs/emails.md)
 *   LIEN_APP              adresse du site dans les e-mails et Discord (défaut : https://appdashboard.fr)
 *   ORIGINES_SITE         origines du site pour /tsuzuku/requete (défaut : https://appdashboard.fr et l'ancien site Pages)
 *   CLE_A2F               facultatif (32 caractères au moins, à ne jamais changer) : chiffre les secrets de
 *                         validation en deux étapes ; sans elle, une clé tirée du JETON
 *   LIMITE_TSUZUKU_MINUTE facultatif ; URL_PUBLIQUE : https://relais.appdashboard.fr
 *   SYNCHRO_TEMPS_REEL    sondage (défaut, le plus sûr sur un mutualisé : aucune connexion tenue),
 *                         attente (attente longue de 50 s) ou sse (flux) : voir docs/o2switch.md
 *   RELAIS_CIBLE, SITE_CIBLE  retour arrière seulement : tout transmettre à un autre relais (et l'annoncer)
 *
 * Les limites de débit gardées en mémoire par le relais valent pour UN processus : une seule instance
 * suffit largement (voir docs/o2switch.md).
 */

import { pathToFileURL } from 'node:url';
import { basePostgres, optionsDepuisEnv } from '../../esport/adaptateurs/postgres.mjs';
import { chargerEnv, creerServeurHttp, ecouter, exigerNode, fichierEnvParDefaut } from '../../esport/serveur/commun.mjs';
import { traiterRequete } from '../worker.mjs';
import { creerAvis, modeTempsReel } from '../avis.mjs';
import { compresser } from './compression.mjs';
import { configSmtp, creerEnvoyeur, manquesSmtp } from '../../esport/serveur/courriel-smtp.mjs';
import { creerTableKv, kvPostgres, purgerKvExpire } from './kv-postgres.mjs';
import { coffresPostgres, creerTablesCoffres } from './coffres-postgres.mjs';

export const ORIGINES_PAR_DEFAUT = 'https://appdashboard.fr,https://www.appdashboard.fr,https://applibourse-ef0ddb.pages.dev';

export function chargerConfigRelais(env = process.env) {
  const fichierEnv = chargerEnv(env.RELAIS_ENV || fichierEnvParDefaut('relais'), env);
  return {
    fichierEnv,
    JETON: env.JETON || '',
    DISCORD_WEBHOOK_URL: env.DISCORD_WEBHOOK_URL || undefined,
    DISCORD_BOT_TOKEN: env.DISCORD_BOT_TOKEN || undefined,
    LIEN_APP: env.LIEN_APP || undefined,
    smtp: configSmtp(env),
    smtpManques: manquesSmtp(env),
    ORIGINES_SITE: env.ORIGINES_SITE || ORIGINES_PAR_DEFAUT,
    LIMITE_TSUZUKU_MINUTE: env.LIMITE_TSUZUKU_MINUTE || undefined,
    // Clé du serveur qui chiffre les secrets de validation en deux étapes (facultative : sinon tirée du JETON).
    CLE_A2F: env.CLE_A2F || undefined,
    // Avis « nouvelle révision » : sondage (défaut), attente ou sse (relais/avis.mjs).
    SYNCHRO_TEMPS_REEL: modeTempsReel(env),
    // Retour arrière (docs/o2switch.md) : ce relais transmet tout à RELAIS_CIBLE et l'annonce aux appareils.
    RELAIS_CIBLE: env.RELAIS_CIBLE || undefined,
    SITE_CIBLE: env.SITE_CIBLE || undefined,
    urlPublique: env.URL_PUBLIQUE || undefined,
    baseConfiguree: Boolean(env.DATABASE_URL || env.PGDATABASE || env.PGHOST),
  };
}

/**
 * Gestionnaire HTTP du relais. `envPour(requete)` (tests) peut fournir un environnement par requête ;
 * sinon celui de la configuration, avec la boîte PostgreSQL.
 */
export async function preparerRelais({ config = chargerConfigRelais(), base, envPour, creerTransport } = {}) {
  if (!envPour && (!config.JETON || config.JETON.length < 16 || !(config.baseConfiguree || base))) {
    console.error('[relais] configuration incomplète : JETON (16 caractères au moins) et DATABASE_URL sont nécessaires.');
    const traiter = async () => new Response(JSON.stringify({ erreur: 'Relais pas encore configuré (voir docs/o2switch.md).' }), { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' } });
    return { traiter, config, fermer: async () => {} };
  }
  const b = base ?? (await basePostgres(optionsDepuisEnv()));
  await creerTableKv(b);
  await purgerKvExpire(b).catch(() => 0);
  // E-mails : transport SMTP seulement si relais.env est complet (sinon l'app garde le mailto).
  const envoyeur = await creerEnvoyeur(config.smtp, { creerTransport });
  if (!envoyeur && config.smtpManques?.length > 0 && config.smtpManques.length < 4) {
    console.error(`[relais] e-mails désactivés : ${config.smtpManques.join(', ')} manquant(s) dans relais.env (docs/emails.md).`);
  }
  // Coffre serveur des comptes (version 9) : tables créées au démarrage, sans migration à lancer.
  await creerTablesCoffres(b);
  const env = {
    JETON: config.JETON,
    BOITE: kvPostgres(b),
    COFFRES: coffresPostgres(b),
    // Avis « nouvelle révision du coffre » (version 10) : en mémoire de CE processus (une instance).
    AVIS: creerAvis(),
    SYNCHRO_TEMPS_REEL: config.SYNCHRO_TEMPS_REEL ?? modeTempsReel({}),
    CLE_A2F: config.CLE_A2F,
    DISCORD_WEBHOOK_URL: config.DISCORD_WEBHOOK_URL,
    DISCORD_BOT_TOKEN: config.DISCORD_BOT_TOKEN,
    LIEN_APP: config.LIEN_APP,
    ...(envoyeur ? { ENVOYER_COURRIEL: envoyeur, MAIL_FROM_AFFICHE: config.smtp.adresseDe } : {}),
    ORIGINES_SITE: config.ORIGINES_SITE,
    LIMITE_TSUZUKU_MINUTE: config.LIMITE_TSUZUKU_MINUTE,
    RELAIS_CIBLE: config.RELAIS_CIBLE,
    SITE_CIBLE: config.SITE_CIBLE,
  };
  // Réponses JSON compressées (gzip) quand l'appareil l'accepte ; jamais les flux (SSE).
  const traiter = async (requete, { attendre } = {}) =>
    compresser(requete, await traiterRequete(requete, envPour ? envPour(requete) : env, { waitUntil: p => (attendre ? attendre(p) : p) }));
  return {
    traiter,
    base: b,
    env,
    config,
    fermer: async () => {
      await envoyeur?.fermer?.();
      if (!base) await b.fermer();
    },
  };
}

export async function demarrer({ port, hote, ...options } = {}) {
  exigerNode(22);
  const r = await preparerRelais(options);
  // Envois chiffrés : jusqu'à 48 Mio (enveloppes et lots du coffre serveur), un peu de marge.
  const serveur = creerServeurHttp(r.traiter, { urlPublique: r.config.urlPublique, tailleMax: 50 * 1024 * 1024, entetes: { 'X-Content-Type-Options': 'nosniff', 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } });
  const url = await ecouter(serveur, { port, hote });
  return {
    url,
    serveur,
    relais: r,
    fermer: async () => {
      await new Promise(ok => serveur.close(() => ok()));
      await r.fermer();
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href || globalThis.__appdashboardDemarrer === 'relais') {
  demarrer()
    .then(s => console.log(`[relais] serveur prêt (${s.url}), temps réel : ${s.relais.env?.SYNCHRO_TEMPS_REEL ?? '—'}${s.relais.config.fichierEnv ? `, configuration : ${s.relais.config.fichierEnv}` : ''}`))
    .catch(e => {
      console.error('[relais] démarrage impossible :', e);
      process.exit(1);
    });
}
