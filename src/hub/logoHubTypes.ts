/** Propriétés communes aux deux versions du logo (native et web). */
export interface PropsLogoHub {
  /** Côté du carré, en px (32 par défaut). */
  taille?: number;
  /** Fond du carré. */
  fond: string;
  /** Couleur de la grille et du « + ». */
  trait: string;
  /** Rayon des coins du carré (le quart du côté par défaut). */
  rayon?: number;
  testID?: string;
}
