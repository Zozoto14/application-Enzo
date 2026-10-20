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
import { traiterFile } from './noyau/discord/file.mjs';
import { debutsDiscord, rappelsDiscord } from './noyau/discord/rappels.mjs';
import { distribuer } from './noyau/evenements.mjs';
import { purgerJournal } from './noyau/journal.mjs';
import { purgerLimites } from './noyau/limites.mjs';
import { rappelsEcheances } from './noyau/objectifs.mjs';
import { rappelsPresence } from './noyau/planning/rappels.mjs';

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
  });
}

export default {
  async fetch(requete, env, ctx) {
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
    if (!env.BASE) return;
    const base = baseD1(env.BASE);
    ctx.waitUntil(
      (async () => {
        await rappelsPresence(base, { maintenant: Date.now() }).catch(e => console.error('[esport] rappels', e));
        await rappelsEcheances(base, { maintenant: Date.now() });
        await rappelsDiscord(base, { maintenant: Date.now() }).catch(e => console.error('[esport] rappels discord', e));
        await debutsDiscord(base, { maintenant: Date.now() }).catch(e => console.error('[esport] débuts discord', e));
        await distribuer(base, { maintenant: Date.now(), limite: 500 });
        await traiterFile(base, { cle: env.CLE_DISCORD || env.CLE_ESPORT, maintenant: Date.now(), lienApp: env.LIEN_APP, jetonBot: env.DISCORD_BOT_TOKEN }).catch(e => console.error('[esport] file discord', e));
        await purgerJournal(base, { maintenant: Date.now() }).catch(e => console.error('[esport] rétention', e));
        await purgerLimites(base, Date.now()).catch(e => console.error('[esport] limites', e));
        await base.executer('DELETE FROM tentatives WHERE maj_le < ?', [new Date(Date.now() - 7 * 86_400_000).toISOString()]);
      })(),
    );
  },
};
