/**
 * Langue des sélecteurs de dates : français par défaut ; l'Esport (seule app bilingue) la règle
 * à chaque changement de langue (src/esport/i18n/index.ts). Un champ peut aussi la forcer (`langue`).
 */

import { useSyncExternalStore } from 'react';
import type { LangueDates } from './logique';

let courante: LangueDates = 'fr';
const abonnes = new Set<() => void>();

export const langueDates = (): LangueDates => courante;

export function definirLangueDates(l: LangueDates): void {
  if (l === courante) return;
  courante = l;
  for (const f of [...abonnes]) f();
}

const abonner = (f: () => void) => {
  abonnes.add(f);
  return () => {
    abonnes.delete(f);
  };
};

export function useLangueDates(forcee?: LangueDates): LangueDates {
  const l = useSyncExternalStore(abonner, langueDates, langueDates);
  return forcee ?? l;
}
