/**
 * Trajectoires d'une carte tactique (app iPhone et tests) : sans SVG, l'arc est une suite de points, le départ un
 * anneau clair et l'arrivée un double anneau à la couleur du personnage. Version web (SVG, vrais tirets, vignette) :
 * `TraceTrajets.web.tsx`.
 */

import React from 'react';
import { View } from 'react-native';
import type { PointCarte } from '../../lineups/api';
import { REPERE, pointsArc } from '../../lineups/logique';

export interface TrajetCarte {
  id: string;
  /** Où l'on se place. */
  depart: PointCarte | null;
  /** Où ça tombe. */
  arrivee: PointCarte | null;
  couleur: string;
}

const pourcent = (n: number) => `${(n / REPERE) * 100}%` as const;

export function TraceTrajets({ trajets, compacte, testID }: { trajets: readonly TrajetCarte[]; largeur: number; compacte?: boolean; testID: string }) {
  const k = compacte ? 0.7 : 1;
  return (
    <>
      {trajets.map(t => (
        <React.Fragment key={t.id}>
          {t.depart && t.arrivee
            ? pointsArc(t.depart, t.arrivee).map((p, i) => (
                <View key={i} testID={i === 0 ? `${testID}-arc-${t.id}` : undefined} pointerEvents="none" style={{ position: 'absolute', left: pourcent(p.x), top: pourcent(p.y), width: 4 * k, height: 4 * k, marginLeft: -2 * k, marginTop: -2 * k, borderRadius: 2, backgroundColor: t.couleur }} />
              ))
            : null}
          {t.depart ? (
            <View testID={`${testID}-depart-${t.id}`} pointerEvents="none" style={{ position: 'absolute', left: pourcent(t.depart.x), top: pourcent(t.depart.y), width: 16 * k, height: 16 * k, marginLeft: -8 * k, marginTop: -8 * k, borderRadius: 8, borderWidth: 2, borderColor: '#FFFFFF', backgroundColor: 'rgba(8, 12, 17, 0.9)', alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: 5 * k, height: 5 * k, borderRadius: 3, backgroundColor: '#FFFFFF' }} />
            </View>
          ) : null}
          {t.arrivee ? (
            <View testID={`${testID}-arrivee-${t.id}`} pointerEvents="none" style={{ position: 'absolute', left: pourcent(t.arrivee.x), top: pourcent(t.arrivee.y), width: 24 * k, height: 24 * k, marginLeft: -12 * k, marginTop: -12 * k, borderRadius: 12, borderWidth: 2, borderColor: t.couleur, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: 8 * k, height: 8 * k, borderRadius: 4, backgroundColor: t.couleur }} />
            </View>
          ) : null}
        </React.Fragment>
      ))}
    </>
  );
}
