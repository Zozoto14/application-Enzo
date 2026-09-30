/** Choix du `Reseau` selon la plateforme : PC (Electron), site (navigateur) ou téléphone (React Native). */

import { Platform } from 'react-native';
import type { Reseau } from '../moteur/reseau';
import { pontElectron, reseauElectron, type PontTsuzuku } from './reseauElectron';
import { reseauNatif } from './reseauNatif';
import { reseauWeb } from './reseauWeb';

export type Plateforme = 'pc' | 'site' | 'mobile';

export interface ChoixReseau {
  plateforme: Plateforme;
  reseau: Reseau;
  /** Faux sur le site : les pages de sources ne peuvent pas y être lues. */
  lectureSources: boolean;
  pont?: PontTsuzuku;
}

export function choisirReseau(source: unknown = globalThis, os: string = Platform.OS): ChoixReseau {
  const pont = pontElectron(source);
  if (pont) {
    return { plateforme: 'pc', reseau: reseauElectron(pont), lectureSources: true, pont };
  }
  if (os === 'web') {
    return { plateforme: 'site', reseau: reseauWeb(), lectureSources: false };
  }
  return { plateforme: 'mobile', reseau: reseauNatif(), lectureSources: true };
}
