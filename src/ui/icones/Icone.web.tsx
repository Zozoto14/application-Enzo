/**
 * Icône monochrome du site et de l'application du PC : SVG en ligne, sans bibliothèque.
 *
 * Le trait prend `currentColor` : posée dans un texte, l'icône a la couleur de ce texte (thème clair ou sombre,
 * bouton plein, lien atténué…). Même contrat que `Icone.tsx` (téléphone et tests).
 */

import React from 'react';
import { TRACES } from './traces';
import type { ProprietesIcone } from './types';

export function Icone({ nom, taille, couleur, libelle, testID }: ProprietesIcone) {
  const cote = taille ?? '1.15em';
  return (
    <svg
      width={cote}
      height={cote}
      viewBox="0 0 24 24"
      fill="none"
      stroke={couleur ?? 'currentColor'}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={libelle ? 'img' : undefined}
      aria-label={libelle}
      aria-hidden={libelle ? undefined : true}
      focusable="false"
      data-testid={testID}
      data-icone={nom}
      style={{ display: 'inline-block', flexShrink: 0, verticalAlign: taille === undefined ? '-0.2em' : 'middle', color: couleur }}>
      {libelle ? <title>{libelle}</title> : null}
      {TRACES[nom].map(([balise, attributs], i) => React.createElement(balise, { key: i, ...attributs }))}
    </svg>
  );
}
