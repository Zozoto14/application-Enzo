/**
 * Section de l'Administration demandée depuis l'extérieur du panneau (par
 * exemple le bandeau d'abonnements du hub). L'écran d'Administration la lit
 * une fois à son ouverture puis l'oublie. Aucun stockage.
 */

import type { IdSection } from './ui/commun';

let demandee: IdSection | undefined;

export function demanderSectionAdmin(section: IdSection): void {
  demandee = section;
}

export function consommerSectionAdmin(): IdSection | undefined {
  const section = demandee;
  demandee = undefined;
  return section;
}
