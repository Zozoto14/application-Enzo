/**
 * Passage d'un écran à l'onglet Lineups : le lineup à ouvrir est noté ici avant de changer d'onglet (bloc « Lineups
 * liés » d'une strat, lineup clé d'un plan de match), et pris par l'écran Lineups à son ouverture.
 */

let demande: string | undefined;

export function demanderLineup(id: string): void {
  demande = id;
}

export function prendreLineupDemande(): string | undefined {
  const id = demande;
  demande = undefined;
  return id;
}
