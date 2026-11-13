/**
 * Images du jeu dans l'éditeur de strats (portraits des agents, icônes des capacités, fond de la map) : une LISTE
 * de sources essayées dans l'ordre (`sourcesIcone` / `sourcesImage`, src/esport/strats/assets.ts : image importée
 * dans le stockage du serveur, puis CDN officiel), la suivante quand l'une ne charge pas, rien à la fin (le
 * composant affiche alors les initiales). Sans dépendance au canevas : utilisé par le canevas Konva (web) et par
 * les barres React Native (le hook du canevas est dans imagesCanevas.web.ts).
 */

import { useState } from 'react';

export type SourcesImage = string | ReadonlyArray<string> | null | undefined;
export const listeSources = (s: SourcesImage): string[] => (typeof s === 'string' ? (s ? [s] : []) : [...(s ?? [])]);

/**
 * Source courante d'une image React Native (`<Image source={{ uri }}>`) : `suivante()` à l'erreur de chargement ;
 * `epuisee` quand toutes ont échoué (et qu'il y en avait au moins une).
 */
export function useSourceImage(sources: SourcesImage): { url: string | null; suivante(): void; epuisee: boolean } {
  const toutes = listeSources(sources);
  const cle = toutes.join('\n');
  const [etat, setEtat] = useState({ cle, i: 0 });
  const i = etat.cle === cle ? etat.i : 0;
  return {
    url: toutes[i] ?? null,
    suivante: () => setEtat({ cle, i: i + 1 }),
    epuisee: toutes.length > 0 && i >= toutes.length,
  };
}
