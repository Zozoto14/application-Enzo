/**
 * Dessin sur la vidéo, version web (site, app PC, iPad dans le navigateur).
 *
 * On ne peut pas dessiner DANS l'iframe YouTube : le dessin vit dans un
 * calque transparent posé PAR-DESSUS le lecteur (même cadre 16:9).
 *  - Affichage : SVG (léger, sans Konva), coordonnées relatives remises à
 *    l'échelle du lecteur (viewBox 640 × 360) ; le calque laisse passer les
 *    clics vers la vidéo.
 *  - Édition : canevas Konva (CalqueDessin.web.tsx), chargé à la demande comme
 *    l'éditeur de strats : Konva n'est téléchargé qu'au premier « Dessiner ».
 */

import React, { Suspense } from 'react';
import { View } from 'react-native';
import { HAUTEUR_REFERENCE, LARGEUR_REFERENCE, elementsSvg, resumeDessin } from '../../review/dessin';
import type { PropsApercuDessin, PropsEditeurDessin } from './typesDessin';

export const dessinDisponible = true;
export const MESSAGE_DESSIN_NATIF = '✏️ Dessin disponible sur le site ou le PC';

const Calque = React.lazy(() => import('./CalqueDessin.web'));

function Svg({ dessin, testID }: { dessin: PropsApercuDessin['dessin']; testID?: string }) {
  const elements = elementsSvg(dessin);
  return (
    <svg
      data-testid={testID}
      role="img"
      aria-label={`Dessin : ${resumeDessin(dessin)}`}
      viewBox={`0 0 ${LARGEUR_REFERENCE} ${HAUTEUR_REFERENCE}`}
      preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
      {elements.map((x, i) => {
        switch (x.el) {
          case 'line':
            return <line key={i} x1={x.x1} y1={x.y1} x2={x.x2} y2={x.y2} stroke={x.couleur} strokeWidth={x.epaisseur} strokeLinecap="round" />;
          case 'polygon':
            return <polygon key={i} points={x.points} fill={x.couleur} />;
          case 'polyline':
            return <polyline key={i} points={x.points} fill="none" stroke={x.couleur} strokeWidth={x.epaisseur} strokeLinecap="round" strokeLinejoin="round" />;
          case 'ellipse':
            return <ellipse key={i} cx={x.cx} cy={x.cy} rx={x.rx} ry={x.ry} fill="none" stroke={x.couleur} strokeWidth={x.epaisseur} />;
          case 'rect':
            return <rect key={i} x={x.x} y={x.y} width={x.l} height={x.h} fill="none" stroke={x.couleur} strokeWidth={x.epaisseur} />;
          case 'text':
            return (
              <text key={i} x={x.x} y={x.y} fill={x.couleur} fontSize={x.taille} fontWeight={700} fontFamily="system-ui, sans-serif" dominantBaseline="hanging" stroke="#000000" strokeWidth={0.6} paintOrder="stroke">
                {x.texte}
              </text>
            );
        }
      })}
    </svg>
  );
}

export function ApercuDessin({ theme, dessin, cadre, testID, style }: PropsApercuDessin) {
  if (!dessin?.objets.length) return null;
  if (cadre === 'calque') return <Svg dessin={dessin} testID={testID} />;
  return (
    <View
      testID={testID}
      accessibilityLabel={`Dessin sur la vidéo : ${resumeDessin(dessin)}`}
      style={[{ width: 112, aspectRatio: 16 / 9, borderRadius: 6, overflow: 'hidden', backgroundColor: '#0b1220', borderWidth: 1, borderColor: theme.ligne }, style]}>
      <Svg dessin={dessin} />
    </View>
  );
}

export function EditeurDessin(props: PropsEditeurDessin) {
  return (
    <Suspense fallback={null}>
      <Calque {...props} />
    </Suspense>
  );
}
