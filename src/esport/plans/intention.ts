/**
 * Passage d'un écran à l'onglet Plan de match : le plan à ouvrir (ou l'événement du planning dont on veut le plan)
 * est noté ici avant de changer d'onglet, et pris par l'écran des plans à son ouverture.
 */

export type DemandePlan = { id: string } | { evenement: string; occurrence: string };

let demande: DemandePlan | undefined;

export function demanderPlan(d: DemandePlan): void {
  demande = d;
}

export function prendrePlanDemande(): DemandePlan | undefined {
  const d = demande;
  demande = undefined;
  return d;
}
