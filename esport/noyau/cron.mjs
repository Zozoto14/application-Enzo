/**
 * Tâches planifiées de l'Esport (toutes les 15 minutes sur Cloudflare, toutes les 5 minutes par une
 * tâche cron sur un serveur Node) : rappels de présence, d'échéance des tâches et J-1/H-1 Discord,
 * débuts d'événements, événements en attente (nouvel essai), file d'envoi Discord (réessais), purge de
 * rétention (journal selon la durée de chaque team, événements traités), ménage des compteurs de débit
 * et des tentatives anciennes. Partagé par esport/worker.mjs et esport/serveur/cron.mjs.
 *
 * Chaque étape est isolée : une erreur est consignée (rapport) sans empêcher les suivantes.
 */

import { traiterFile } from './discord/file.mjs';
import { debutsDiscord, rappelsDiscord } from './discord/rappels.mjs';
import { distribuer } from './evenements.mjs';
import { purgerJournal } from './journal.mjs';
import { purgerLimites } from './limites.mjs';
import { rappelsEcheances } from './objectifs.mjs';
import { rappelsPresence } from './planning/rappels.mjs';

/** Rend `[{ tache, ok, erreur? }]`. Options : `cle` (CLE_DISCORD sinon CLE_ESPORT), `lienApp`, `jetonBot`, `fetch`, `maintenant`. */
export async function tachesPlanifiees(base, { cle, lienApp, jetonBot, fetch, maintenant = () => Date.now(), journal = console } = {}) {
  const etapes = [
    ['rappels de présence', () => rappelsPresence(base, { maintenant: maintenant() })],
    ['rappels d’échéance', () => rappelsEcheances(base, { maintenant: maintenant() })],
    ['rappels Discord', () => rappelsDiscord(base, { maintenant: maintenant() })],
    ['débuts Discord', () => debutsDiscord(base, { maintenant: maintenant() })],
    ['événements en attente', () => distribuer(base, { maintenant: maintenant(), limite: 500 })],
    ['file Discord', () => traiterFile(base, { cle, maintenant: maintenant(), lienApp, jetonBot, ...(fetch ? { fetch } : {}) })],
    ['rétention du journal', () => purgerJournal(base, { maintenant: maintenant() })],
    ['limites de débit', () => purgerLimites(base, maintenant())],
    ['tentatives anciennes', () => base.executer('DELETE FROM tentatives WHERE maj_le < ?', [new Date(maintenant() - 7 * 86_400_000).toISOString()])],
  ];
  const rapport = [];
  for (const [tache, faire] of etapes) {
    try {
      await faire();
      rapport.push({ tache, ok: true });
    } catch (e) {
      journal.error(`[esport] cron : ${tache}`, e);
      rapport.push({ tache, ok: false, erreur: String(e?.message ?? e) });
    }
  }
  return rapport;
}
