/**
 * Claude Office (v4) : le plateau de la scène, version native (hors web) : la
 * scène simplifiée, sans caméra ni survol. La version web
 * (`PlateauScene.web.tsx`) ajoute zoom, panoramique, plein écran, cartes de
 * survol, suivi, mini-carte et relecture.
 */

import React from 'react';
import { SceneOpenSpace } from './SceneOpenSpace';
import type { PropsPlateau } from './plateauTypes';

export function PlateauScene({ agents, theme, reduit, demo, charge, maintenant, estompes, choisi, onDetail, largeur, horloge, cleScene }: PropsPlateau) {
  return (
    <SceneOpenSpace
      key={cleScene}
      agents={agents}
      theme={theme}
      reduit={reduit}
      largeur={largeur}
      choisi={choisi}
      onChoisir={onDetail}
      demo={demo}
      charge={charge}
      maintenant={maintenant}
      estompes={estompes}
      horloge={horloge}
    />
  );
}
