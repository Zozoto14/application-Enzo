/**
 * Relais AppDashboard en serveur Node autonome (Node 22 + PostgreSQL) : le cœur HTTP du relais
 * (relais/relais.mjs), avec la boîte clé/valeur `BOITE` rangée dans PostgreSQL (table relais_kv,
 * relais/serveur/kv-postgres.mjs). Compatible Passenger (o2switch « Setup Node.js App » : fichier de
 * démarrage `serveur/app.cjs`). Mode d'emploi : docs/o2switch.md.
 *
 * Configuration (variables de « Setup Node.js App » et/ou fichier ~/.appdashboard/relais.env, HORS du
 * dépôt et de public_html ; chemin modifiable par RELAIS_ENV) :
 *   JETON                 jeton maître (ne jamais le changer : les jetons de profil des amis en dérivent)
 *   DATABASE_URL          postgres://… (ou PGHOST, PGUSER, PGPASSWORD, PGDATABASE), même base que l'Esport
 *   DISCORD_WEBHOOK_URL   salon du support (facultatif, docs/support.md) ; DISCORD_BOT_TOKEN : fils dans un salon texte
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM   envoi d'e-mails (facultatif, docs/emails.md)
 *   MAIL_COPIE_ENVOYES, IMAP_HOST, IMAP_PORT, IMAP_DOSSIER   copie dans « Envoyés » (défaut : activée, docs/emails.md)
 *   LIEN_APP              adresse du site dans les e-mails et Discord (défaut : https://appdashboard.fr)
 *   ORIGINES_SITE         origines du site pour /tsuzuku/requete (défaut : https://appdashboard.fr et www)
 *   CLE_A2F               facultatif (32 caractères au moins, à ne jamais changer) : chiffre les secrets de
 *                         validation en deux étapes ; sans elle, une clé tirée du JETON
 *   LIMITE_TSUZUKU_MINUTE facultatif ; URL_PUBLIQUE : https://relais.appdashboard.fr
 *   SYNCHRO_TEMPS_REEL    sondage (défaut, le plus sûr sur un mutualisé : aucune connexion tenue),
 *                         attente (attente longue de 50 s) ou sse (flux) : voir docs/o2switch.md
 *
 *   JOURNAL_FICHIER, JOURNAL_DESACTIVE   journal du serveur (défaut : ~/logs/relais.log, esport/serveur/journal-fichier.mjs)
 *
 * Les limites de débit gardées en mémoire par le relais valent pour UN processus : une seule instance
 * suffit largement (voir docs/o2switch.md).
 */

import { pathToFileURL } from 'node:url';
import { basePostgres, optionsDepuisEnv } from '../../esport/adaptateurs/postgres.mjs';
import { chargerEnv, creerServeurHttp, ecouter, exigerNode, fichierEnvParDefaut, lireCleAdresse } from '../../esport/serveur/commun.mjs';
import { traiterRequete } from '../relais.mjs';
import { creerAvis, modeTempsReel } from '../avis.mjs';
import { compresser } from './compression.mjs';
import { configSmtp, creerEnvoyeur, manquesSmtp, resumeSmtp, suivreVerificationSmtp } from '../../esport/serveur/courriel-smtp.mjs';
import { installerJournal } from '../../esport/serveur/journal-fichier.mjs';
import { etatVersion, infosDemarrage } from '../../esport/serveur/version-serveur.mjs';
import { creerTableKv, kvPostgres, purgerKvExpire } from './kv-postgres.mjs';
import { coffresPostgres, creerTablesCoffres } from './coffres-postgres.mjs';

export const ORIGINES_PAR_DEFAUT = 'https://appdashboard.fr,https://www.appdashboard.fr';

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
    urlPublique: env.URL_PUBLIQUE || undefined,
    baseConfiguree: Boolean(env.DATABASE_URL || env.PGDATABASE || env.PGHOST),
  };
}

/**
 * Gestionnaire HTTP du relais. `envPour(requete)` (tests) peut fournir un environnement par requête ;
 * sinon celui de la configuration, avec la boîte PostgreSQL.
 */
export async function preparerRelais({ config = chargerConfigRelais(), base, envPour, creerTransport, infos = infosDemarrage({ app: 'relais' }), etatDir } = {}) {
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
  if (!envoyeur && config.smtpManques?.length > 0) {
    console.error(`[relais] e-mails désactivés : ${config.smtpManques.join(', ')} manquant(s) dans relais.env (docs/emails.md).`);
  } else if (!envoyeur) {
    console.error('[relais] e-mails désactivés : MAIL_FROM n’est pas une adresse valide (ex. AppDashboard <noreply@appdashboard.fr>), docs/emails.md.');
  }
  // Vérification SMTP (connexion + identifiants) : lancée après le démarrage, sans le retarder (`verificationSmtp.lancer()`).
  const verificationSmtp = suivreVerificationSmtp(envoyeur, { app: 'relais' });
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
    // Preuve de l'adresse du navigateur transmise par le serveur Esport (clé créée ici une fois, fichier 600).
    CLE_ADRESSE: config.CLE_ADRESSE ?? lireCleAdresse({ creer: true }),
    DISCORD_WEBHOOK_URL: config.DISCORD_WEBHOOK_URL,
    DISCORD_BOT_TOKEN: config.DISCORD_BOT_TOKEN,
    LIEN_APP: config.LIEN_APP,
    ...(envoyeur ? { ENVOYER_COURRIEL: envoyeur, MAIL_FROM_AFFICHE: config.smtp.adresseDe } : {}),
    ORIGINES_SITE: config.ORIGINES_SITE,
    LIMITE_TSUZUKU_MINUTE: config.LIMITE_TSUZUKU_MINUTE,
    // Diagnostic des e-mails (« Tester l'envoi ») : NOMS des variables manquantes, vérification SMTP.
    COURRIEL_DIAGNOSTIC: { manques: config.smtpManques ?? [], verifier: envoyeur?.verifier, verification: verificationSmtp.etat },
    // Version en service (GET /serveur/version, Fondateur).
    VERSION_SERVEUR: () => etatVersion(infos, etatDir ? { etatDir } : {}),
  };
  // Réponses JSON compressées (gzip) quand l'appareil l'accepte ; jamais les flux (SSE).
  const traiter = async (requete, { attendre } = {}) =>
    compresser(requete, await traiterRequete(requete, envPour ? envPour(requete) : env, { waitUntil: p => (attendre ? attendre(p) : p) }));
  return {
    traiter,
    base: b,
    env,
    config,
    verificationSmtp,
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

/** Ligne de démarrage du journal : version, Node, pid, configuration lue, état des e-mails (aucun secret). */
export function ligneDemarrage({ infos, config, journal }) {
  const smtp = config.smtp ? `SMTP configuré (${resumeSmtp(config.smtp)})` : `SMTP NON configuré${config.smtpManques?.length ? ` (manquant : ${config.smtpManques.join(', ')})` : ' (MAIL_FROM invalide)'}`;
  return `[relais] démarrage : version ${infos.commit ? infos.commit.slice(0, 7) : 'inconnue'}, Node ${infos.node}, pid ${infos.pid}, configuration ${config.fichierEnv ?? 'aucun fichier (variables de Setup Node.js App seulement)'}, journal ${journal?.fichier ?? 'désactivé'} ; e-mails : ${smtp}`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href || globalThis.__appdashboardDemarrer === 'relais') {
  // Journal ~/logs/relais.log d'abord (après relais.env : réglages et valeurs à masquer), pour tout voir, même un échec.
  const config = chargerConfigRelais();
  const journal = installerJournal({ app: 'relais' });
  const infos = infosDemarrage({ app: 'relais' });
  console.log(ligneDemarrage({ infos, config, journal }));
  demarrer({ config, infos })
    .then(s => {
      console.log(`[relais] serveur prêt (${s.url}), temps réel : ${s.relais.env?.SYNCHRO_TEMPS_REEL ?? '—'}`);
      void s.relais.verificationSmtp?.lancer();
    })
    .catch(e => {
      console.error('[relais] démarrage impossible :', e);
      process.exit(1);
    });
}
