/**
 * Champ de date du Portefeuille (écrans de src/ui/ecrans) : mêmes calendrier et saisie que le reste
 * de l'AppDashboard, aux couleurs de la palette du Portefeuille. Valeur « JJ/MM/AAAA », comme avant.
 */

import React from 'react';
import { usePalette } from '../composants';
import type { Palette } from '../theme';
import { ChampDate, ChampHeure, type PaletteDates } from './Champs';

export const paletteDates = (p: Palette): PaletteDates => ({
  sombre: !!p.sombre,
  fond: p.surface,
  surface: p.surface,
  texte: p.texte,
  attenue: p.texteSecondaire,
  ligne: p.bordure,
  accent: p.accentPlein,
  surAccent: p.surAccent,
  critique: p.danger,
  rayonMoyen: 10,
  policeTexte: p.policeTexte,
});

export function ChampDatePortefeuille({
  etiquette,
  value,
  onChangeText,
  indication,
  testID,
  min,
  max,
}: {
  etiquette: string;
  value: string;
  onChangeText(v: string): void;
  indication?: string;
  testID?: string;
  min?: string;
  max?: string;
}) {
  const palette = usePalette();
  return <ChampDate theme={paletteDates(palette)} format="fr" libelle={etiquette} valeur={value} onChanger={onChangeText} aide={indication} testID={testID} min={min} max={max} style={{ marginBottom: 12 }} />;
}

export function ChampHeurePortefeuille({ etiquette, value, onChangeText, testID, pas = 15 }: { etiquette: string; value: string; onChangeText(v: string): void; testID?: string; pas?: number }) {
  const palette = usePalette();
  return <ChampHeure theme={paletteDates(palette)} libelle={etiquette} valeur={value} onChanger={onChangeText} testID={testID} pas={pas} raccourcis={['07:00', '07:30', '08:00', '09:00', '12:00', '18:00']} style={{ marginBottom: 12 }} />;
}
