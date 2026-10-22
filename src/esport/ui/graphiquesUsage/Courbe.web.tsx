/**
 * Courbe quotidienne en SVG (site et app PC) : une ligne de 2 px et une aire pâle de la couleur d'accent,
 * les jours reconstitués depuis le journal en pointillés gris ; un repère vertical et le détail du jour au
 * survol (ou à l'appui, au clavier par les colonnes invisibles). Largeur fluide (viewBox), traits fixes.
 */

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { ESP, attenue } from '../design';
import type { PointCourbe } from './graphiques';

const L = 1000;
const H = 160;
const MARGE = 8;

export function Courbe({ theme, points, testID }: { theme: ThemeHub; points: PointCourbe[]; testID: string }) {
  const [choisi, setChoisi] = useState<number | undefined>();
  const max = Math.max(1, ...points.map(p => p.valeur));
  const n = points.length;
  const x = (i: number) => (n <= 1 ? L / 2 : (i / (n - 1)) * L);
  const y = (v: number) => H - MARGE - (v / max) * (H - 2 * MARGE);
  const segments: Array<{ reconstitue: boolean; pts: Array<[number, number]> }> = [];
  points.forEach((p, i) => {
    const r = Boolean(p.reconstitue);
    const dernier = segments[segments.length - 1];
    const pt: [number, number] = [x(i), y(p.valeur)];
    if (!dernier || dernier.reconstitue !== r) {
      // Le segment suivant repart du dernier point : la ligne reste continue.
      segments.push({ reconstitue: r, pts: dernier ? [dernier.pts[dernier.pts.length - 1], pt] : [pt] });
    } else dernier.pts.push(pt);
  });
  const chemin = (pts: Array<[number, number]>) => pts.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)},${b.toFixed(1)}`).join(' ');
  const mesures = segments.filter(s => !s.reconstitue);
  const largeurColonne = n > 0 ? L / n : L;
  return (
    <View style={{ gap: ESP.xs }} testID={testID}>
      <Text style={attenue(theme, 11)}>{String(max)}</Text>
      <svg viewBox={`0 0 ${L} ${H}`} preserveAspectRatio="none" width="100%" height={H} role="img" aria-label={points.map(p => p.detail).join(' ; ')} style={{ display: 'block', overflow: 'visible' }}>
        <line x1={0} x2={L} y1={H - MARGE} y2={H - MARGE} stroke={theme.ligne} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {mesures.map((s, i) => (
          <path key={`a${i}`} d={`${chemin(s.pts)} L${s.pts[s.pts.length - 1][0].toFixed(1)},${H - MARGE} L${s.pts[0][0].toFixed(1)},${H - MARGE} Z`} fill={teinteTransparente(theme.accent, theme.sombre ? 0.22 : 0.14)} stroke="none" />
        ))}
        {segments.map((s, i) => (
          <path
            key={`l${i}`}
            d={chemin(s.pts)}
            fill="none"
            stroke={s.reconstitue ? theme.attenue : theme.accent}
            strokeWidth={2}
            strokeDasharray={s.reconstitue ? '4 4' : undefined}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {choisi !== undefined && points[choisi] ? (
          <line x1={x(choisi)} x2={x(choisi)} y1={0} y2={H - MARGE} stroke={theme.texte} strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.5} />
        ) : null}
        {points.map((p, i) => (
          <rect
            key={p.jour}
            data-testid={`${testID}-${p.jour}`}
            x={Math.max(0, x(i) - largeurColonne / 2)}
            y={0}
            width={largeurColonne}
            height={H}
            fill="transparent"
            onMouseEnter={() => setChoisi(i)}
            onClick={() => setChoisi(i)}>
            <title>{p.detail}</title>
          </rect>
        ))}
      </svg>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={attenue(theme, 11)}>{points[0]?.jour ?? ''}</Text>
        <Text style={attenue(theme, 11)}>{points[n - 1]?.jour ?? ''}</Text>
      </View>
      <Text style={attenue(theme)} testID={`${testID}-detail`} accessibilityLiveRegion="polite">
        {choisi !== undefined ? points[choisi]?.detail : ''}
      </Text>
    </View>
  );
}
