/**
 * Lecteur vocal du téléphone et des tests : aucun. La synthèse vocale vit
 * dans `lecteur.web.ts`, pour le bureau ; ici, l'écran affiche le texte.
 */

import type { Lecteur } from './lecteurTypes';

export type * from './lecteurTypes';

export function creerLecteur(): Lecteur {
  return {
    disponible: false,
    voix: () => [],
    surChangementVoix: () => () => undefined,
    lire: (_file, _depuis, _options, rappels) => rappels.surFin(),
    pause: () => undefined,
    reprendre: () => undefined,
    arreter: () => undefined,
  };
}
