/**
 * Champ de date du téléphone : sur le web, le sélecteur de date NATIF du navigateur (roue de dates de
 * l'iPhone, calendrier d'Android) ; au natif, le champ numérique habituel. La valeur reste au format
 * de l'application, « JJ/MM/AAAA » : seule la saisie change.
 */

import React from 'react';
import { Platform } from 'react-native';
import { police } from '../../hub/themes';
import { ChampMobile, type ChampMobileProps } from './ChampMobile';
import { CONTROLE, ESPACE, TEXTE, rayonControle, themeActif } from './jetons';

/** « 05/03/2024 » → « 2024-03-05 » (valeur d'un `<input type="date">`) ; vide si la date n'est pas complète. */
export function versDateNative(texte: string): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texte.trim());
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}

/** « 2024-03-05 » → « 05/03/2024 ». */
export function depuisDateNative(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

export function ChampDate({ etiquette, indication, erreur, value, onChangeText, testID, theme: themeDonne }: ChampMobileProps) {
  const theme = themeActif(themeDonne);
  if (Platform.OS !== 'web') {
    return <ChampMobile etiquette={etiquette} indication={indication} erreur={erreur} value={value} onChangeText={onChangeText} placeholder="JJ/MM/AAAA" keyboardType="numbers-and-punctuation" nature="nombre" testID={testID} />;
  }
  const rayon = rayonControle(theme) === 999 ? 24 : rayonControle(theme);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ESPACE.xxs + 2 }}>
      <label htmlFor={testID} style={{ color: theme.texte, fontSize: TEXTE.legende, fontWeight: 600, ...(police(theme.policeTexte) as object) }}>
        {etiquette}
      </label>
      <input
        id={testID}
        data-testid={testID}
        type="date"
        aria-label={etiquette}
        aria-invalid={erreur ? true : undefined}
        autoComplete="off"
        enterKeyHint="next"
        value={versDateNative(value ?? '')}
        onChange={evenement => onChangeText?.(depuisDateNative((evenement.target as unknown as { value: string }).value))}
        style={{
          minHeight: CONTROLE.hauteur,
          boxSizing: 'border-box',
          width: '100%',
          fontSize: TEXTE.champ,
          padding: `0 ${ESPACE.s + 2}px`,
          color: theme.texte,
          background: theme.surface,
          border: `1px solid ${erreur ? theme.critique : theme.ligne}`,
          borderRadius: rayon,
          colorScheme: theme.sombre ? 'dark' : 'light',
          ...(police(theme.policeTexte) as object),
        }}
      />
      {erreur ? (
        <span role="alert" style={{ color: theme.critique, fontSize: TEXTE.legende, lineHeight: '21px' }}>
          {erreur}
        </span>
      ) : indication ? (
        <span style={{ color: theme.attenue, fontSize: TEXTE.legende, lineHeight: '21px' }}>{indication}</span>
      ) : null}
    </div>
  );
}
