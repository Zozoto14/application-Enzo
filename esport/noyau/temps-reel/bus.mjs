/**
 * Temps réel, côté bus d'événements (evenements.mjs, abonné placé EN DERNIER) : les écritures faites hors HTTP
 * (bot Discord, cron) et les notifications in-app créées pour un compte sont diffusées elles aussi
 * (docs/esport/temps-reel.md). Aucune dépendance aux modules métier (pas de cycle d'imports).
 */

import { iso } from '../outils.mjs';
import { publierEnBase } from './diffusion.mjs';
import { sujetsEvenement } from './regles.mjs';

/**
 * Abonné du bus d'événements (evenements.mjs) : écritures faites hors HTTP (bot Discord, cron) et
 * notifications créées pour un compte. Une écriture HTTP déjà diffusée (même sujet, même auteur, il y a
 * moins de 5 s) n'est pas diffusée deux fois.
 */
export async function abonneTempsReel(base, ev) {
  const t = Date.parse(ev.cree_le) || Date.now();
  for (const s of sujetsEvenement(ev)) {
    const recent = await base.premier('SELECT id FROM temps_reel_flux WHERE sujet = ? AND cree_le >= ? AND COALESCE(acteur, ?) = ? LIMIT 1', [s.sujet, iso(t - 5_000), '', ev.acteur_id ?? '']);
    if (recent && !s.invalider) continue;
    await publierEnBase(base, { sujet: s.sujet, acteur: ev.acteur_id ?? undefined, invalider: s.invalider, action: 'modifie' }, t);
  }
  // Notifications de cet événement (identifiants `<événement>:<compte>`) : le compteur de chacun se met à jour.
  const notifies = await base.tous('SELECT DISTINCT compte_id FROM notifications WHERE id >= ? AND id < ?', [`${ev.id}:`, `${ev.id};`]);
  for (const { compte_id: compte } of notifies) await publierEnBase(base, { sujet: `compte:${compte}`, action: 'cree' }, t);
}
