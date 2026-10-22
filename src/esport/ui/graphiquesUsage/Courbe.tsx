/** Courbe quotidienne : colonnes en vues natives (iPhone, iPad, tests) ; SVG sur le site (Courbe.web.tsx). */

import React from 'react';
import type { ThemeHub } from '../../../hub/themes';
import { ColonnesJour, type PointCourbe } from './graphiques';

export function Courbe({ theme, points, testID }: { theme: ThemeHub; points: PointCourbe[]; testID: string }) {
  return <ColonnesJour theme={theme} points={points} testID={testID} />;
}
