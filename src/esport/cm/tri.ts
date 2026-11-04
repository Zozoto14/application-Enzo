/**
 * Tri des cartes d'une colonne CM (migration 0052, docs/esport/cm.md, « Tri des cartes »). Pur, testé (CmTri.test.tsx).
 * Ordre automatique : cartes ouvertes d'abord ; urgence décroissante (Critique, Urgent, Moyen, Faible, sans drapeau) ;
 * à urgence égale, échéance la plus proche en premier (les échéances dépassées avant les autres ; les cartes sans
 * échéance, ou dont l'échéance est cochée « faite », après celles qui en ont) ; à égalité, l'ordre manuel (position).
 * Les cartes terminées viennent en dernier, dans leur ordre manuel. L'instant d'échéance est absolu : le fuseau du club
 * (Europe/Paris) n'intervient que dans l'affichage.
 */

import type { CarteResume, ListeCm } from './api';
import { rangUrgence } from './urgence';

type CarteTriable = Pick<CarteResume, 'position'> & Partial<Pick<CarteResume, 'urgence' | 'echeance' | 'echeanceFaite' | 'terminee'>>;

/** La colonne est-elle en tri automatique ? (serveur ancien, sans le champ : ordre manuel). */
export const triAutomatique = (l: Pick<ListeCm, 'tri'> | undefined): boolean => l?.tri === 'auto';

/** Instant de l'échéance qui compte pour le tri ; +∞ sans échéance, échéance illisible ou déjà faite. */
function instantEcheance(c: CarteTriable): number {
  if (!c.echeance || c.echeanceFaite) return Number.POSITIVE_INFINITY;
  const t = Date.parse(c.echeance);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/** Comparateur du tri automatique. */
export function comparerCartes(a: CarteTriable, b: CarteTriable): number {
  const ta = a.terminee === true;
  const tb = b.terminee === true;
  if (ta !== tb) return ta ? 1 : -1;
  if (!ta) {
    const u = rangUrgence(b.urgence) - rangUrgence(a.urgence);
    if (u) return u;
    const ea = instantEcheance(a);
    const eb = instantEcheance(b);
    if (ea !== eb) return ea < eb ? -1 : 1;
  }
  return a.position - b.position;
}

/** Copie triée (la liste d'origine n'est pas modifiée). */
export const trierCartes = <T extends CarteTriable>(cartes: T[]): T[] => [...cartes].sort(comparerCartes);
