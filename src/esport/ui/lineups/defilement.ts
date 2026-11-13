/**
 * Défilement de la page autour des lineups (site et app PC ; sans effet sur iPhone et Android, où la page ne se
 * pilote pas ainsi) : ouvrir une fiche ou le formulaire ramène en haut, revenir à la liste retrouve l'endroit quitté,
 * et un pin touché sur un petit écran amène la carte en haut pour que la fiche apparaisse dessous.
 */

import { useEffect, useLayoutEffect, useRef } from 'react';
import { Platform } from 'react-native';

interface Noeud {
  parentElement: Noeud | null;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  addEventListener(type: 'scroll', f: () => void, options?: { passive?: boolean }): void;
  removeEventListener(type: 'scroll', f: () => void): void;
  scrollIntoView?(options?: { block?: 'start' | 'center' | 'nearest'; behavior?: 'auto' | 'smooth' }): void;
}
type Fenetre = { document?: { querySelector?(selecteur: string): Noeud | null }; getComputedStyle?(n: Noeud): { overflowY?: string } };

const fenetre = (): Fenetre | undefined => (Platform.OS === 'web' ? (globalThis as unknown as Fenetre) : undefined);
const element = (testID: string): Noeud | null => fenetre()?.document?.querySelector?.(`[data-testid="${testID}"]`) ?? null;

/** Conteneur qui défile autour de l'élément marqué `testID` (web) ; rien ailleurs. */
export function conteneurDefilant(testID: string): Noeud | null {
  const f = fenetre();
  let n = element(testID)?.parentElement ?? null;
  while (n) {
    const debordement = f?.getComputedStyle?.(n)?.overflowY ?? '';
    if ((debordement === 'auto' || debordement === 'scroll') && n.scrollHeight > n.clientHeight) return n;
    n = n.parentElement;
  }
  return null;
}

/** Amène le haut de l'élément marqué en haut de la page (web). */
export function amenerEnHaut(testID: string, doux = false): void {
  try {
    element(testID)?.scrollIntoView?.({ block: 'start', behavior: doux ? 'smooth' : 'auto' });
  } catch {
    // Navigateur ancien : la page reste où elle est.
  }
}

/**
 * Suit le changement d'écran d'un module (`ecran` : « liste », « fiche:<id> », « formulaire »…) : l'endroit de la
 * liste est retenu tant qu'elle est affichée, un autre écran s'ouvre en haut, le retour à la liste reprend sa place.
 */
export function useDefilementEcran(testID: string, ecran: string, liste = 'liste'): void {
  const position = useRef(0);
  const precedent = useRef(ecran);
  // Effet de mise en page : l'écoute est retirée avant que le navigateur ne signale le défilement du nouvel écran.
  useLayoutEffect(() => {
    if (ecran !== liste) return undefined;
    const conteneur = conteneurDefilant(testID);
    if (!conteneur) return undefined;
    const suivre = () => {
      position.current = conteneur.scrollTop;
    };
    conteneur.addEventListener('scroll', suivre, { passive: true });
    return () => conteneur.removeEventListener('scroll', suivre);
  }, [testID, ecran, liste]);
  useEffect(() => {
    if (precedent.current === ecran) return;
    precedent.current = ecran;
    if (ecran !== liste) return amenerEnHaut(testID);
    const conteneur = conteneurDefilant(testID);
    if (conteneur) conteneur.scrollTop = position.current;
  }, [testID, ecran, liste]);
}
