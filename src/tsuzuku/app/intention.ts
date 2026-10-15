/** Poignées d'« intention » d'un élément pressable (sans dépendance : utilisées par `ui.tsx`). */

/** Survol (souris) avant de précharger : passer sur une carte ne déclenche rien. */
export const SURVOL_MS = 250;

/**
 * Poignées pour un élément pressable : `onPressIn` tout de suite, survol
 * prolongé (`SURVOL_MS`) à la souris. Pures (testables sans écran).
 */
export function poigneesIntention(action: () => void, survolMs = SURVOL_MS) {
  let minuteur: ReturnType<typeof setTimeout> | undefined;
  const annuler = () => {
    if (minuteur) clearTimeout(minuteur);
    minuteur = undefined;
  };
  return {
    onPressIn: () => {
      annuler();
      action();
    },
    onHoverIn: () => {
      annuler();
      minuteur = setTimeout(() => {
        minuteur = undefined;
        action();
      }, survolMs);
    },
    onHoverOut: annuler,
  };
}
