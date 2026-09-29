/**
 * Logo d'AppDashboard en SVG (web et bureau) : carré arrondi, grille 2×2 et
 * « + ». Même motif que la maquette (`hub/maquette`, `.brand-mark`) et que la
 * version native de `LogoHub.tsx`.
 */

import React from 'react';
import type { PropsLogoHub } from './logoHubTypes';

export function LogoHub({ taille = 32, fond, trait, rayon, testID }: PropsLogoHub) {
  const r = rayon ?? taille / 4;
  return (
    <svg
      data-testid={testID}
      role="img"
      aria-label="Logo AppDashboard"
      width={taille}
      height={taille}
      viewBox={`0 0 ${taille} ${taille}`}
      style={{ display: 'block', flexShrink: 0 }}
    >
      <rect width={taille} height={taille} rx={r} fill={fond} />
      <svg x={taille * (7 / 32)} y={taille * (7 / 32)} width={taille * (18 / 32)} height={taille * (18 / 32)} viewBox="0 0 24 24">
        <g fill="none" stroke={trait} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="2" />
          <rect x="14" y="3" width="7" height="7" rx="2" />
          <rect x="3" y="14" width="7" height="7" rx="2" />
          <path d="M17.5 14v7M14 17.5h7" />
        </g>
      </svg>
    </svg>
  );
}
