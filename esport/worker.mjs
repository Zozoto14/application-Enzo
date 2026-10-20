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
 */

import { baseD1 } from './adaptateurs/d1.mjs';
import { stockageR2 } from './adaptateurs/stockage.mjs';
import { creerApi, reponseJson } from './noyau/api.mjs';
import { verificateurRelais } from './noyau/authentification.mjs';
import { distribuer } from './noyau/evenements.mjs';

function api(env) {
  return creerApi({
    base: baseD1(env.BASE),
    stockage: env.FICHIERS ? stockageR2(env.FICHIERS) : undefined,
    cleSession: env.CLE_ESPORT,
    verifierJeton: verificateurRelais({ liaison: env.RELAIS, adresse: env.RELAIS_URL }),
    creationTeams: env.CREATION_TEAMS === 'tous' ? 'tous' : 'fondateur',
  });
}

export default {
  async fetch(requete, env, ctx) {
    if (!env.BASE) {
      return reponseJson({ erreur: 'Base D1 non reliée au Worker Esport (liaison BASE).', code: 'non-configure' }, 503);
    }
    return api(env)(requete, { attendre: p => ctx.waitUntil(p) });
  },

  /** Cron : événements en attente (nouvel essai), ménage des tentatives anciennes. */
  async scheduled(_evenement, env, ctx) {
    if (!env.BASE) return;
    const base = baseD1(env.BASE);
    ctx.waitUntil(
      (async () => {
        await distribuer(base, { maintenant: Date.now(), limite: 500 });
        await base.executer('DELETE FROM tentatives WHERE maj_le < ?', [new Date(Date.now() - 7 * 86_400_000).toISOString()]);
      })(),
    );
  },
};
