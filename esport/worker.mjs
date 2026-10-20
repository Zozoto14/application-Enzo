/**
 * Worker Cloudflare « applibourse-esport » : le serveur de l'Esport.
 *
 * Séparé du relais (relais/worker.mjs, boîte KV chiffrée de bout en bout) :
 * ici les données des teams sont en clair côté serveur (chiffrées au repos
 * par Cloudflare), dans une base D1 (SQL), avec un bucket R2 privé pour les
 * fichiers des phases suivantes et un cron (bus d'événements, et Discord en
 * phase 4).
 *
 * Ce fichier ne fait que brancher le runtime Cloudflare sur le cœur portable
 * (esport/noyau/) : D1 → adaptateurs/d1.mjs, R2 → adaptateurs/stockage.mjs,
 * relais → liaison de service `RELAIS` (ou `RELAIS_URL`). Sur un vrai serveur,
 * on remplace ces trois branchements (docs/esport/migration-serveur.md).
 *
 * Liaisons (esport/wrangler.toml) : BASE (D1), FICHIERS (R2), RELAIS (service).
 * Secret : CLE_ESPORT (`wrangler secret put CLE_ESPORT`), jamais dans le dépôt.
 * Facultatifs : CLE_DISCORD (secret séparé pour chiffrer les webhooks Discord ; sinon dérivé de
 * CLE_ESPORT) et LIEN_APP (adresse de l'app, variable {lien} des messages Discord).
 * Bot Discord (facultatif, docs/esport/bot-discord.md) : DISCORD_APPLICATION_ID et
 * DISCORD_PUBLIC_KEY (variables publiques), DISCORD_BOT_TOKEN (secret) ; Discord
 * appelle POST /discord/interactions.
 */

import { baseD1 } from './adaptateurs/d1.mjs';
import { stockageR2 } from './adaptateurs/stockage.mjs';
import { creerApi, reponseJson } from './noyau/api.mjs';
import { verificateurRelais } from './noyau/authentification.mjs';
import { tachesPlanifiees } from './noyau/cron.mjs';

function api(env) {
  return creerApi({
    base: baseD1(env.BASE),
    stockage: env.FICHIERS ? stockageR2(env.FICHIERS) : undefined,
    cleSession: env.CLE_ESPORT,
    verifierJeton: verificateurRelais({ liaison: env.RELAIS, adresse: env.RELAIS_URL }),
    creationTeams: env.CREATION_TEAMS === 'tous' ? 'tous' : 'fondateur',
    cleDiscord: env.CLE_DISCORD,
    lienApp: env.LIEN_APP,
    discordBot: { applicationId: env.DISCORD_APPLICATION_ID, publicKey: env.DISCORD_PUBLIC_KEY, jetonBot: env.DISCORD_BOT_TOKEN },
    // Fenêtre de déménagement seulement (LECTURE_SEULE) : l'importeur o2switch reprend les clés (docs/o2switch.md).
    secretsExportables: env.LECTURE_SEULE === '1',
  });
}

/**
 * Déménagement vers un serveur Node (docs/o2switch.md) :
 *  - `LECTURE_SEULE = "1"` : le temps de l'export final, toute écriture est refusée (503), sauf l'ouverture
 *    de session ; le cron ne tourne plus ;
 *  - `ESPORT_CIBLE = "https://esport.appdashboard.fr"` : après la bascule, le Worker transmet chaque requête
 *    au nouveau serveur (les apps qui ont encore l'ancienne adresse continuent de marcher) ; le cron ne
 *    tourne plus (le nouveau serveur a le sien). Sans ces variables : comportement habituel.
 */
export async function proxifier(requete, cible) {
  const source = new URL(requete.url);
  const destination = new URL(`${source.pathname}${source.search}`, `${String(cible).replace(/\/+$/, '')}/`);
  const entetes = new Headers(requete.headers);
  entetes.delete('host');
  const corps = ['GET', 'HEAD'].includes(requete.method) ? undefined : await requete.arrayBuffer();
  const r = await fetch(destination, { method: requete.method, headers: entetes, body: corps, redirect: 'manual' });
  const sortie = new Headers(r.headers);
  sortie.set('X-Esport-Deplace', destination.origin);
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: sortie });
}

const cibleValide = c => typeof c === 'string' && /^https:\/\/[a-z0-9.-]+(:\d+)?\/?$/i.test(c.trim());
const ECRITURES_PERMISES = new Set(['/session', '/api/esport/session']);

export default {
  async fetch(requete, env, ctx) {
    if (cibleValide(env.ESPORT_CIBLE)) return proxifier(requete, env.ESPORT_CIBLE.trim());
    if (env.LECTURE_SEULE === '1' && !['GET', 'HEAD', 'OPTIONS'].includes(requete.method) && !ECRITURES_PERMISES.has(new URL(requete.url).pathname.replace(/\/+$/, ''))) {
      return reponseJson({ erreur: 'Serveur Esport en cours de déménagement : lecture seule pendant quelques minutes.', code: 'lecture-seule' }, 503, { 'Retry-After': '300' });
    }
    if (!env.BASE) {
      return reponseJson({ erreur: 'Base D1 non reliée au Worker Esport (liaison BASE).', code: 'non-configure' }, 503);
    }
    return api(env)(requete, { attendre: p => ctx.waitUntil(p) });
  },

  /**
   * Cron : rappels de présence, d'échéance des tâches et J-1/H-1 Discord, événements en attente (nouvel essai),
   * file d'envoi Discord (réessais), purge de rétention (journal selon la durée de chaque team, événements traités),
   * ménage des tentatives et des compteurs de débit anciens.
   */
  async scheduled(_evenement, env, ctx) {
    if (!env.BASE || cibleValide(env.ESPORT_CIBLE) || env.LECTURE_SEULE === '1') return;
    const base = baseD1(env.BASE);
    ctx.waitUntil(tachesPlanifiees(base, { cle: env.CLE_DISCORD || env.CLE_ESPORT, lienApp: env.LIEN_APP, jetonBot: env.DISCORD_BOT_TOKEN }));
  },
};
