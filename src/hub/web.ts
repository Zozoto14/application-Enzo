/**
 * Petits accès au navigateur pour le hub, sans que le code natif ait à les
 * connaître : `src` ne charge pas les types du DOM, et `document` n'existe pas
 * sur l'appareil.
 */

import { Platform } from 'react-native';

export function surLeWeb(): boolean {
  return Platform.OS === 'web';
}

interface DocumentMinimal {
  addEventListener(type: 'keydown', rappel: (e: ToucheMinimale) => void): void;
  removeEventListener(type: 'keydown', rappel: (e: ToucheMinimale) => void): void;
}
interface ToucheMinimale {
  key: string;
  defaultPrevented: boolean;
  target: unknown;
  preventDefault(): void;
}

function documentCourant(): DocumentMinimal | undefined {
  return (globalThis as { document?: DocumentMinimal }).document;
}

/** Vrai quand la cible est un champ de saisie : Échap y appartient au champ. */
function estChampDeSaisie(cible: unknown): boolean {
  const balise = (cible as { tagName?: string } | null)?.tagName?.toLowerCase();
  return balise === 'input' || balise === 'textarea' || balise === 'select';
}

/**
 * Écoute une touche du clavier (web uniquement). Sans effet ailleurs.
 * Renvoie la fonction qui retire l'écoute.
 */
export function ecouterTouche(touche: string, rappel: () => void, options: { ignorerChamps?: boolean } = {}): () => void {
  const doc = documentCourant();
  if (!doc) {
    return () => undefined;
  }
  const surTouche = (evenement: ToucheMinimale) => {
    if (evenement.key !== touche || evenement.defaultPrevented) {
      return;
    }
    if (options.ignorerChamps && estChampDeSaisie(evenement.target)) {
      return;
    }
    evenement.preventDefault();
    rappel();
  };
  doc.addEventListener('keydown', surTouche);
  return () => doc.removeEventListener('keydown', surTouche);
}

/** Préférence système « réduire les animations ». */
export function mouvementReduit(): boolean {
  const fenetre = globalThis as { matchMedia?: (requete: string) => { matches: boolean } };
  try {
    return Boolean(fenetre.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}
