/**
 * Raccourci clavier « M » du site et de l'app PC : ajoute un repère au temps
 * courant. Ignoré pendant la saisie (champ de texte, liste, éditeur) et avec
 * Ctrl, Alt ou Cmd.
 */

import { useEffect, useRef } from 'react';

export const TOUCHE_RACCOURCI = 'M';

export function useRaccourciRepere(actif: boolean, declencher: () => void): void {
  const dernier = useRef(declencher);
  dernier.current = declencher;
  useEffect(() => {
    const doc = (globalThis as { document?: Document }).document;
    if (!actif || !doc) return undefined;
    const sur = (e: KeyboardEvent) => {
      if (e.key !== 'm' && e.key !== 'M') return;
      if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
      const cible = e.target as HTMLElement | null;
      const balise = cible?.tagName?.toLowerCase();
      if (balise === 'input' || balise === 'textarea' || balise === 'select' || cible?.isContentEditable) return;
      e.preventDefault();
      dernier.current();
    };
    doc.addEventListener('keydown', sur);
    return () => doc.removeEventListener('keydown', sur);
  }, [actif]);
}
