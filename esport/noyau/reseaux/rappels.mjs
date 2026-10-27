/**
 * Rappels « relevez les statistiques » (tâche cron) : pour une publication suivie dont les rappels sont activés,
 * à J+1 puis à J+7 (jours civils, heure de Paris) s'il n'y a pas encore de relevé à cette date ou après. Chaque
 * rappel est posé UNE fois (marque réclamée par un UPDATE conditionnel), puis devient l'événement
 * `cm.reseau_rappel_releve` que bus.mjs transforme en notification (et en ligne du récapitulatif e-mail).
 * Une publication de plus de 6 jours (J+1) ou 13 jours (J+7) n'a plus de rappel (pas d'avalanche après coup).
 */

import { evenement } from '../evenements.mjs';
import { iso } from '../outils.mjs';
import { ajouterJours, jourDans } from './regles.mjs';

const CHOIX = `SELECT p.id, p.titre, p.reseau, p.publie_le, p.team_id, c.publie_par FROM cm_rs_publications p LEFT JOIN cm_cartes c ON c.id = p.carte_id
  WHERE p.supprime_le IS NULL AND p.rappels = 1 AND p.publie_le <= ? AND p.publie_le >= ?`;
const RAPPELS = [
  { j: 1, fenetre: 6, choisir: `${CHOIX} AND p.rappel_j1_le IS NULL ORDER BY p.publie_le LIMIT ?`, marquer: 'UPDATE cm_rs_publications SET rappel_j1_le = ? WHERE id = ? AND rappel_j1_le IS NULL' },
  { j: 7, fenetre: 13, choisir: `${CHOIX} AND p.rappel_j7_le IS NULL ORDER BY p.publie_le LIMIT ?`, marquer: 'UPDATE cm_rs_publications SET rappel_j7_le = ? WHERE id = ? AND rappel_j7_le IS NULL' },
];

export async function rappelsReseaux(base, { maintenant = Date.now(), limite = 200 } = {}) {
  const aujourd = jourDans(maintenant);
  const lot = [];
  for (const { j, fenetre, choisir, marquer } of RAPPELS) {
    // Filtre large en SQL (instants UTC), précis ensuite (jours civils de Paris).
    const lignes = await base.tous(choisir, [iso(maintenant - (j - 1) * 86_400_000), iso(maintenant - (fenetre + 1) * 86_400_000), limite]);
    for (const p of lignes) {
      const jourCible = ajouterJours(jourDans(Date.parse(p.publie_le)), j);
      if (jourCible > aujourd || ajouterJours(jourCible, fenetre - j) < aujourd) continue;
      const deja = await base.premier('SELECT id FROM cm_rs_releves_posts WHERE publication_id = ? AND jour >= ?', [p.id, jourCible]);
      const r = await base.executer(marquer, [iso(maintenant), p.id]);
      if (r.changements !== 1 || deja) continue;
      lot.push(evenement('cm.reseau_rappel_releve', { teamId: null, acteur: null, entiteType: 'cm_rs_publication', entiteId: p.id, charge: { titre: p.titre, reseau: p.reseau, j, pour: p.publie_par ?? null, team: p.team_id ?? null }, maintenant }));
    }
  }
  if (lot.length) await base.lot(lot);
  return { poses: lot.length };
}
