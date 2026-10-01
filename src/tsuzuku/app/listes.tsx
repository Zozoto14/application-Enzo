/**
 * Rangées, grilles et tuiles « Reprendre » : l'affichage de bureau (`ui.tsx`) ou celui du téléphone
 * (`mobile/ElementsMobile.tsx`), choisi d'après le mode d'affichage. Aiguilles seulement : aucune
 * logique ici, les écrans importent ces trois noms et ne se soucient pas du mode.
 */

import React from 'react';
import type { Entree } from '../moteur/bibliotheque';
import { useTsuzuku } from './contexte';
import { GrilleMobile, RangeeMobile, RangeeReprendreMobile } from './mobile/ElementsMobile';
import { Grille as GrilleBureau, Rangee as RangeeBureau, RangeeReprendre as RangeeReprendreBureau, type ElementCarte } from './ui';

export function Rangee(props: { titre: string; elements: ElementCarte[]; testID?: string }) {
  const { mobile } = useTsuzuku();
  return mobile ? <RangeeMobile {...props} /> : <RangeeBureau {...props} />;
}

export function Grille(props: { elements: ElementCarte[]; testID?: string }) {
  const { mobile } = useTsuzuku();
  return mobile ? <GrilleMobile {...props} /> : <GrilleBureau {...props} />;
}

export function RangeeReprendre(props: { titre: string; entrees: Entree[]; onLire(e: Entree): void; testID?: string }) {
  const { mobile } = useTsuzuku();
  return mobile ? <RangeeReprendreMobile {...props} /> : <RangeeReprendreBureau {...props} />;
}
