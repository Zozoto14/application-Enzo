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
 *   DISCORD_WEBHOOK_URL   salon du support (facultatif)
 *   ORIGINES_SITE         origines du site pour /tsuzuku/requete (défaut : https://appdashboard.fr et l'ancien site Pages)
 *   LIMITE_TSUZUKU_MINUTE facultatif ; URL_PUBLIQUE : https://relais.appdashboard.fr
 *   RELAIS_CIBLE, SITE_CIBLE  retour arrière seulement : tout transmettre à un autre relais (et l'annoncer)
 *
 * Les limites de débit gardées en mémoire par le relais valent pour UN processus : une seule instance
 * suffit largement (voir docs/o2switch.md).
 */

import { pathToFileURL } from 'node:url';
import { basePostgres, optionsDepuisEnv } from '../../esport/adaptateurs/postgres.mjs';
import { chargerEnv, creerServeurHttp, ecouter, exigerNode, fichierEnvParDefaut } from '../../esport/serveur/commun.mjs';
import relais from '../worker.mjs';
import { creerTableKv, kvPostgres, purgerKvExpire } from './kv-postgres.mjs';

export const ORIGINES_PAR_DEFAUT = 'https://appdashboard.fr,https://www.appdashboard.fr,https://applibourse-ef0ddb.pages.dev';

export function chargerConfigRelais(env = process.env) {
  const fichierEnv = chargerEnv(env.RELAIS_ENV || fichierEnvParDefaut('relais'), env);
  return {
    fichierEnv,
    JETON: env.JETON || '',
    DISCORD_WEBHOOK_URL: env.DISCORD_WEBHOOK_URL || undefined,
    ORIGINES_SITE: env.ORIGINES_SITE || ORIGINES_PAR_DEFAUT,
    LIMITE_TSUZUKU_MINUTE: env.LIMITE_TSUZUKU_MINUTE || undefined,
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
export async function preparerRelais({ config = chargerConfigRelais(), base, envPour } = {}) {
  if (!envPour && (!config.JETON || config.JETON.length < 16 || !(config.baseConfiguree || base))) {
    console.error('[relais] configuration incomplète : JETON (16 caractères au moins) et DATABASE_URL sont nécessaires.');
    const traiter = async () => new Response(JSON.stringify({ erreur: 'Relais pas encore configuré (voir docs/o2switch.md).' }), { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' } });
    return { traiter, config, fermer: async () => {} };
  }
  const b = base ?? (await basePostgres(optionsDepuisEnv()));
  await creerTableKv(b);
  await purgerKvExpire(b).catch(() => 0);
  const env = {
    JETON: config.JETON,
    BOITE: kvPostgres(b),
    DISCORD_WEBHOOK_URL: config.DISCORD_WEBHOOK_URL,
    ORIGINES_SITE: config.ORIGINES_SITE,
    LIMITE_TSUZUKU_MINUTE: config.LIMITE_TSUZUKU_MINUTE,
    RELAIS_CIBLE: config.RELAIS_CIBLE,
    SITE_CIBLE: config.SITE_CIBLE,
  };
  const fetchWorker = relais.fetch.bind(relais);
  const traiter = (requete, { attendre } = {}) => fetchWorker(requete, envPour ? envPour(requete) : env, { waitUntil: p => (attendre ? attendre(p) : p) });
  return { traiter, base: b, env, config, fermer: async () => (base ? undefined : b.fermer()) };
}

export async function demarrer({ port, hote, ...options } = {}) {
  exigerNode(22);
  const r = await preparerRelais(options);
  // Enveloppes chiffrées : jusqu'à 20 Mio (même limite que le Worker), un peu de marge.
  const serveur = creerServeurHttp(r.traiter, { urlPublique: r.config.urlPublique, tailleMax: 21 * 1024 * 1024, entetes: { 'X-Content-Type-Options': 'nosniff', 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } });
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
    .then(s => console.log(`[relais] serveur prêt (${s.url})${s.relais.config.fichierEnv ? `, configuration : ${s.relais.config.fichierEnv}` : ''}`))
    .catch(e => {
      console.error('[relais] démarrage impossible :', e);
      process.exit(1);
    });
}
