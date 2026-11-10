/**
 * Site et app PC : dictionnaire anglais et table des erreurs du serveur téléchargés à la demande (fichiers séparés),
 * seulement quand la langue est l'anglais. Tant qu'ils ne sont pas là, `tr` répond en français ; le démarrage du site
 * les attend avant le premier affichage si l'appareil est en anglais (bureau/index.tsx). Version directe : anglais.ts.
 */

import { importerAvecReessai } from '../../ui/differe';
import type { Cle } from './fr';

export interface TableErreurs {
  messages: Record<string, string>;
  motifs: Array<[string, string]>;
}

/** Imports à la demande (remplaçables dans les tests : Jest n'exécute pas un import() sans option spéciale). */
export const chargeurs = {
  dictionnaire: (): Promise<{ en: Record<Cle, string> }> => import('./en'),
  table: (): Promise<unknown> => import('../../../esport/noyau/erreurs.json'),
};

let dictionnaire: Record<Cle, string> | undefined;
let table: TableErreurs | undefined;
let enCours: Promise<void> | undefined;

export const dictionnaireAnglais = (): Record<Cle, string> | undefined => dictionnaire;
export const tableErreursAnglais = (): TableErreurs | undefined => table;

export function chargerAnglais(): Promise<void> {
  if (dictionnaire && table) return Promise.resolve();
  if (!enCours) {
    enCours = Promise.all([
      importerAvecReessai(chargeurs.dictionnaire),
      importerAvecReessai(chargeurs.table),
    ]).then(
      ([d, t]) => {
        dictionnaire = d.en;
        table = ((t as unknown as { default?: TableErreurs }).default ?? t) as unknown as TableErreurs;
      },
      erreur => {
        enCours = undefined;
        throw erreur;
      },
    );
  }
  return enCours;
}
