/**
 * Dictionnaire anglais de l'Esport et table de traduction des erreurs du serveur. Ici (iPhone, iPad, Android,
 * tests) : chargés d'office, disponibles tout de suite. Sur le site et l'app PC, `anglais.web.ts` ne les télécharge
 * que pour un utilisateur en anglais (près de 260 Ko de textes en moins dans le fichier principal).
 */

import table from '../../../esport/noyau/erreurs.json';
import { en } from './en';
import type { Cle } from './fr';

export interface TableErreurs {
  messages: Record<string, string>;
  motifs: Array<[string, string]>;
}

export const dictionnaireAnglais = (): Record<Cle, string> | undefined => en;
export const tableErreursAnglais = (): TableErreurs | undefined => table as unknown as TableErreurs;
export const chargerAnglais = (): Promise<void> => Promise.resolve();
