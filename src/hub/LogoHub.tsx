/**
 * Logo d'AppDashboard : un carré arrondi qui contient une grille 2×2 dont la
 * quatrième case est un « + » (« ajouter une app »).
 *
 * Version native : dessinée avec des vues (pas de bibliothèque SVG dans
 * l'app iPhone). Sur le web, `LogoHub.web.tsx` dessine le même motif en SVG.
 */

import React from 'react';
import { View } from 'react-native';
import type { PropsLogoHub } from './logoHubTypes';

/** Repères du motif, dans un repère de 24 : identiques à ceux du SVG. */
export const MOTIF_LOGO_HUB = {
  cotes: 24,
  epaisseur: 2.2,
  cases: [
    { x: 3, y: 3 },
    { x: 14, y: 3 },
    { x: 3, y: 14 },
  ],
  tailleCase: 7,
  rayonCase: 2,
  plus: { centre: 17.5, debut: 14, fin: 21 },
} as const;

export function LogoHub({ taille = 32, fond, trait, rayon, testID }: PropsLogoHub) {
  // Le motif occupe 18/32 du carré, comme dans la maquette.
  const u = (taille * 18) / 32 / MOTIF_LOGO_HUB.cotes;
  const decalage = (taille - MOTIF_LOGO_HUB.cotes * u) / 2;
  const e = MOTIF_LOGO_HUB.epaisseur * u;
  const { tailleCase, rayonCase, plus } = MOTIF_LOGO_HUB;
  const pos = (v: number) => decalage + v * u;
  return (
    <View
      testID={testID}
      accessibilityRole="image"
      accessibilityLabel="Logo AppDashboard"
      style={{ width: taille, height: taille, borderRadius: rayon ?? taille / 4, backgroundColor: fond }}
    >
      {MOTIF_LOGO_HUB.cases.map(c => (
        <View
          key={`${c.x}-${c.y}`}
          style={{
            position: 'absolute',
            left: pos(c.x) - e / 2,
            top: pos(c.y) - e / 2,
            width: tailleCase * u + e,
            height: tailleCase * u + e,
            borderRadius: rayonCase * u + e / 2,
            borderWidth: e,
            borderColor: trait,
          }}
        />
      ))}
      <View
        style={{
          position: 'absolute',
          left: pos(plus.centre) - e / 2,
          top: pos(plus.debut) - e / 2,
          width: e,
          height: (plus.fin - plus.debut) * u + e,
          borderRadius: e / 2,
          backgroundColor: trait,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: pos(plus.debut) - e / 2,
          top: pos(plus.centre) - e / 2,
          width: (plus.fin - plus.debut) * u + e,
          height: e,
          borderRadius: e / 2,
          backgroundColor: trait,
        }}
      />
    </View>
  );
}
