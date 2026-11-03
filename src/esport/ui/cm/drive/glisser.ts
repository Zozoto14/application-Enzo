/**
 * Glisser-déposer du Drive hors du web (app iPhone / Android) : pas de glisser ; on déplace par le menu
 * « Déplacer vers… » (un appui long sélectionne). Le site et l'app PC utilisent glisser.web.ts.
 */

import type { Glisser, OptionsGlisser } from './typesGlisser';

export type { Glisser, OptionsGlisser, SurvolGlisser } from './typesGlisser';

const AUCUN = Object.freeze({ ajout: false, plage: false });

export function useGlisser(_o: OptionsGlisser): Glisser {
  return { ref: () => undefined, marque: () => ({}), survol: null, glisses: [], modificateurs: () => AUCUN, vientDeGlisser: () => false, disponible: false };
}
