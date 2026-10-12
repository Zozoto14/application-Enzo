/** Choix du `Reseau` selon la plateforme : PC (Electron), site (navigateur) ou téléphone (React Native). */

import { Platform } from 'react-native';
import type { Reseau } from '../moteur/reseau';
import { pontElectron, reseauElectron, type PontTsuzuku } from './reseauElectron';
import { reseauNatif } from './reseauNatif';
import { reseauSite, transportRelais } from './reseauRelais';

export type Plateforme = 'pc' | 'site' | 'mobile';

export interface ChoixReseau {
  plateforme: Plateforme;
  reseau: Reseau;
  /**
   * Faux sur le site, sauf s'il est relié au relais avec le jeton du compte
   * Fondateur (la route `/tsuzuku/requete` lit alors les pages). Lu à chaque
   * fois : la liaison peut arriver après l'ouverture de l'app.
   */
  lectureSources: boolean;
  /** Site : les pages des sources passent par le relais. */
  viaRelais?: boolean;
  pont?: PontTsuzuku;
}

export function choisirReseau(source: unknown = globalThis, os: string = Platform.OS): ChoixReseau {
  const pont = pontElectron(source);
  if (pont) {
    return { plateforme: 'pc', reseau: reseauElectron(pont), lectureSources: true, pont };
  }
  if (os === 'web') {
    const transport = transportRelais(source);
    const relie = () => Boolean(transport?.disponible());
    return {
      plateforme: 'site',
      reseau: reseauSite(transport),
      get lectureSources() {
        return relie();
      },
      get viaRelais() {
        return relie();
      },
    };
  }
  return { plateforme: 'mobile', reseau: reseauNatif(), lectureSources: true };
}
