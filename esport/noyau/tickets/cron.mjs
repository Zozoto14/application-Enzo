/**
 * Tickets : tâches du cron (toutes les 5 minutes, esport/serveur/cron.mjs) :
 *  - passage noté (`tickets_etat`, clé `cron_vu`) : l'app sait si la tâche cron tourne ;
 *  - relecture REST de secours des tickets ouverts quand AUCUN processus de l'app ne tient la Gateway (app endormie
 *    par Passenger, redémarrage…) ; le cron serveur réveille ensuite l'app (GET /sante) pour qu'un meneur reprenne ;
 *  - puis le cycle de vie (cycle.mjs, `tachesCycle`) : avertissements et fermetures automatiques, salons archivés à
 *    supprimer, rétention.
 * Rend `{ meneur, releve?, cycle? }`.
 */

import { iso } from '../outils.mjs';
import { telechargeurCdn } from './conversation.mjs';
import { lireGeneral } from './reglages.mjs';
import { bailActif, ecrireEtat, releverTickets } from './superviseur.mjs';

export async function tachesTickets(base, { jetonBot, fetch: fetchDiscord = (...a) => globalThis.fetch(...a), maintenant = () => Date.now(), stockage, cycle } = {}) {
  const reglages = await lireGeneral(base);
  const t = maintenant();
  // Passage du cron noté à chaque fois (diagnostic de l'app : « la tâche cron tourne-t-elle ? »).
  await ecrireEtat(base, 'cron_vu', { actif: Boolean(reglages.actif), bot: Boolean(jetonBot) }, t);
  if (!jetonBot || !reglages.actif || !reglages.guildId) return { actif: false };
  const meneur = await bailActif(base, t);
  let releve = null;
  if (!meneur) {
    releve = await releverTickets({ base, stockage, reglages, telecharger: telechargeurCdn(fetchDiscord), botId: cycle?.botId ?? null, maintenant, fetch: fetchDiscord, jetonBot, ...(cycle?.contexteIngestion ?? {}) });
    await ecrireEtat(base, 'cron', { releve: { ...releve, le: iso(t) } }, t);
  }
  const suite = cycle ? await cycle.tachesCycle() : null;
  return { actif: true, meneur: Boolean(meneur), releve, cycle: suite };
}
