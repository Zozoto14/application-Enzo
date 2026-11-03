/**
 * Rappels des réunions de l'équipe CM (cron, toutes les 5 minutes) : pour chaque occurrence d'une réunion active qui
 * commence dans ses `rappel_minutes`, chaque participant qui ne l'a pas refusée reçoit UN rappel (marque
 * `cm_reunion_rappels`, réclamée par un INSERT … ON CONFLICT DO NOTHING : deux cron simultanés n'envoient rien en
 * double). Le rappel devient l'événement `cm.reunion_rappel` : notification in-app (cm/bus.mjs) et MP Discord du bot
 * (file `cm_reunion_mp`, envoyée par `traiterMpReunions`, mp.mjs).
 */

import { evenement } from '../../evenements.mjs';
import { iso } from '../../outils.mjs';
import { servicesReunionsCm } from './service.mjs';

const MINUTE = 60_000;
const RAPPEL_MAX_MIN = 1440;

/** Rend le nombre de rappels posés. */
export async function rappelsReunions(base, { maintenant = Date.now(), limite = 500 } = {}) {
  const s = servicesReunionsCm({ base, maintenant: () => maintenant });
  const lignes = (await s.candidates(maintenant, maintenant + (RAPPEL_MAX_MIN + 5) * MINUTE)).filter(r => r.rappel_minutes !== null && r.rappel_minutes !== undefined);
  if (!lignes.length) return 0;
  const parts = await s.participantsDe(lignes.map(r => r.id));
  let poses = 0;
  for (const { r, o } of await s.occurrencesDe(lignes, maintenant, maintenant + (RAPPEL_MAX_MIN + 5) * MINUTE)) {
    const avance = Number(r.rappel_minutes) * MINUTE;
    if (o.debut <= maintenant || o.debut - avance > maintenant) continue;
    for (const p of parts.get(r.id) ?? []) {
      if (p.reponse === 'refuse') continue;
      const t = iso(maintenant);
      const marque = await base.executer('INSERT INTO cm_reunion_rappels (reunion_id, occurrence, compte_id, envoye_le) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', [r.id, o.cle, p.compte_id, t]);
      if (marque.changements !== 1) continue;
      await base.lot([
        evenement('cm.reunion_rappel', {
          acteur: null,
          entiteType: 'cm_reunion',
          entiteId: r.id,
          charge: { compte: p.compte_id, titre: r.titre, debut: iso(o.debut), occurrence: iso(o.debut), fuseau: r.fuseau, minutes: Number(r.rappel_minutes) },
          maintenant,
        }),
      ]);
      poses++;
      if (poses >= limite) return poses;
    }
  }
  return poses;
}
