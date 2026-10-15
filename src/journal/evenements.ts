/** Petit relais : l'écran du journal, s'il est ouvert, est prévenu quand des pages viennent d'être écrites. */

type Ecouteur = (jours: string[]) => void;
const ecouteurs = new Set<Ecouteur>();

export function ecouterEcritures(ecouteur: Ecouteur): () => void {
  ecouteurs.add(ecouteur);
  return () => {
    ecouteurs.delete(ecouteur);
  };
}

export const annoncerEcritures = (jours: string[]): void => ecouteurs.forEach(e => e(jours));
