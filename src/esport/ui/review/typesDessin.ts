/**
 * Contrat du dessin sur la vidéo, commun à la version web (site, app PC :
 * calque Konva par-dessus le lecteur et rendu SVG, `dessinVideo.web.tsx`) et
 * à la version native (iOS sans WebView : pas de dessin, `dessinVideo.tsx`).
 */

import type { StyleProp, ViewStyle } from 'react-native';
import type { ThemeHub } from '../../../hub/themes';
import type { Dessin, FormeDessin, OutilDessin } from '../../review/dessin';

export interface PropsApercuDessin {
  theme: ThemeHub;
  dessin: Dessin | null | undefined;
  /** `calque` : par-dessus le lecteur (taille du lecteur) ; `miniature` : vignette de la liste des repères. */
  cadre: 'calque' | 'miniature';
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export interface PropsEditeurDessin {
  objets: readonly FormeDessin[];
  outil: OutilDessin;
  couleur: string;
  epaisseur: number;
  /** Texte posé par l'outil « Texte ». */
  texte: string;
  onAjouter(forme: FormeDessin): void;
  onGommer(index: number): void;
}
