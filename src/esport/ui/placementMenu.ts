/**
 * Placement du menu « ⋯ » (MenuActions) : pur et testable. Le menu reste toujours entièrement visible :
 * sous le bouton s'il y a la place, sinon au-dessus (ancré sur le haut du bouton), sinon du côté le plus
 * spacieux avec une hauteur maximale = l'espace disponible (le contenu défile). Sur petite largeur, feuille
 * d'actions en bas d'écran, pleine largeur.
 */

export type Ancre = { x: number; y: number; l: number; h: number };
export type Fenetre = { largeur: number; hauteur: number };

export const MARGE_MENU = 12;
export const ECART_MENU = 6;
export const LARGEUR_MENU = 260;
export const HAUTEUR_ACTION = 44;
/** En dessous de cette largeur de fenêtre, le menu devient une feuille du bas. */
export const LARGEUR_FEUILLE = 600;

export type PlacementMenu =
  | { mode: 'feuille'; maxHeight: number }
  | { mode: 'popover'; cote: 'bas' | 'haut'; left: number; width: number; maxHeight: number; top?: number; bottom?: number };

export function placerMenu(ancre: Ancre, fenetre: Fenetre, nbActions: number): PlacementMenu {
  if (fenetre.largeur < LARGEUR_FEUILLE) return { mode: 'feuille', maxHeight: Math.max(HAUTEUR_ACTION * 2, Math.floor(fenetre.hauteur * 0.8)) };
  const contenu = nbActions * HAUTEUR_ACTION + 8;
  const width = Math.min(LARGEUR_MENU, fenetre.largeur - 2 * MARGE_MENU);
  const left = Math.max(MARGE_MENU, Math.min(ancre.x + ancre.l - width, fenetre.largeur - width - MARGE_MENU));
  const dessous = fenetre.hauteur - (ancre.y + ancre.h) - ECART_MENU - MARGE_MENU;
  const dessus = ancre.y - ECART_MENU - MARGE_MENU;
  const bas = dessous >= contenu || dessous >= dessus;
  if (bas) return { mode: 'popover', cote: 'bas', left, width, top: ancre.y + ancre.h + ECART_MENU, maxHeight: Math.max(HAUTEUR_ACTION * 2, Math.floor(dessous)) };
  return { mode: 'popover', cote: 'haut', left, width, bottom: fenetre.hauteur - ancre.y + ECART_MENU, maxHeight: Math.max(HAUTEUR_ACTION * 2, Math.floor(dessus)) };
}
