/**
 * Période saisie (« du » … « au », dates AAAA-MM-JJ incluses) lue dans le
 * fuseau de la team : rend des instants UTC (ms), `au` étant le début du
 * jour qui suit. Sert au journal et aux statistiques.
 */

import { echec } from './outils.mjs';
import { ajouterJours, ecartJours, instantMural, lireDate } from './planning/temps.mjs';

/**
 * `{ du, au }` → `{ du, au, debut, fin }` (ms UTC ; textes AAAA-MM-JJ).
 * `ouverte` : une borne peut manquer (elle vaut alors `undefined`).
 */
export function exigerPeriode(filtres, fuseau, { maxJours = 731, ouverte = false } = {}) {
  const d = filtres.du ? lireDate(filtres.du) : undefined;
  const f = filtres.au ? lireDate(filtres.au) : undefined;
  if ((filtres.du && !d) || (filtres.au && !f)) throw echec(400, 'periode', 'Dates : AAAA-MM-JJ.');
  if (!ouverte && (!d || !f)) throw echec(400, 'periode', 'Période : une date de début et une date de fin.');
  if (d && f && (ecartJours(d, f) < 0 || ecartJours(d, f) > maxJours)) throw echec(400, 'periode', `Période de 1 jour à ${maxJours} jours, la fin après le début.`);
  return {
    du: d ? instantMural(fuseau, d, 0) : undefined,
    au: f ? instantMural(fuseau, ajouterJours(f, 1), 0) : undefined,
    debut: filtres.du ?? null,
    fin: filtres.au ?? null,
  };
}
