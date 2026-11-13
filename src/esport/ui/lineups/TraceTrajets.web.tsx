/**
 * Trajectoires d'une carte tactique (site et app PC) : un calque SVG par-dessus la minimap. Vignette (bords
 * assombris), arc en tirets du départ à l'arrivée, départ (anneau clair), arrivée (anneau à la couleur du personnage
 * et son halo). Les épaisseurs sont en pixels quel que soit le zoom (`vector-effect`).
 */

import React from 'react';
import type { PointCarte } from '../../lineups/api';
import { REPERE, cheminArc } from '../../lineups/logique';

export interface TrajetCarte {
  id: string;
  depart: PointCarte | null;
  arrivee: PointCarte | null;
  couleur: string;
}

export function TraceTrajets({ trajets, largeur, compacte, testID }: { trajets: readonly TrajetCarte[]; largeur: number; compacte?: boolean; testID: string }) {
  // Unités du repère par pixel d'écran (la carte est carrée).
  const u = largeur > 0 ? REPERE / largeur : 2;
  const k = compacte ? 0.75 : 1;
  const idVignette = `${testID}-vignette`;
  return (
    <svg viewBox={`0 0 ${REPERE} ${REPERE}`} preserveAspectRatio="none" aria-hidden="true" focusable="false" style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
      <defs>
        <radialGradient id={idVignette} cx="50%" cy="50%" r="72%">
          <stop offset="55%" stopColor="#000000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.55" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width={REPERE} height={REPERE} fill={`url(#${idVignette})`} />
      {trajets.map(t => (
        <g key={t.id}>
          {t.depart && t.arrivee ? (
            <>
              <path d={cheminArc(t.depart, t.arrivee)} fill="none" stroke="#05080C" strokeOpacity="0.85" strokeWidth={5 * k} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              <path data-testid={`${testID}-arc-${t.id}`} d={cheminArc(t.depart, t.arrivee)} fill="none" stroke={t.couleur} strokeWidth={2.5 * k} strokeLinecap="round" strokeDasharray={`${7 * k} ${6 * k}`} vectorEffect="non-scaling-stroke" />
            </>
          ) : null}
          {t.depart ? (
            <g data-testid={`${testID}-depart-${t.id}`}>
              <circle cx={t.depart.x} cy={t.depart.y} r={8 * k * u} fill="rgba(8, 12, 17, 0.92)" stroke="#FFFFFF" strokeWidth={2} vectorEffect="non-scaling-stroke" />
              <circle cx={t.depart.x} cy={t.depart.y} r={2.6 * k * u} fill="#FFFFFF" />
            </g>
          ) : null}
          {t.arrivee ? (
            <g data-testid={`${testID}-arrivee-${t.id}`}>
              <circle cx={t.arrivee.x} cy={t.arrivee.y} r={15 * k * u} fill={t.couleur} fillOpacity="0.16" />
              <circle cx={t.arrivee.x} cy={t.arrivee.y} r={11 * k * u} fill="none" stroke="#05080C" strokeOpacity="0.85" strokeWidth={5} vectorEffect="non-scaling-stroke" />
              <circle cx={t.arrivee.x} cy={t.arrivee.y} r={11 * k * u} fill="none" stroke={t.couleur} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
              <circle cx={t.arrivee.x} cy={t.arrivee.y} r={3.5 * k * u} fill={t.couleur} />
            </g>
          ) : null}
        </g>
      ))}
    </svg>
  );
}
