import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SaisieNouveauMotDePasse } from './SaisieMotDePasse';
import type { LangueSaisie } from './textes';

function Essai({ langue = 'fr', profil = 'ami' as const }: { langue?: LangueSaisie; profil?: 'ami' | 'coffre' }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  return (
    <SaisieNouveauMotDePasse
      profil={profil}
      valeur={a}
      onChanger={setA}
      confirmation={b}
      onChangerConfirmation={setB}
      etiquette="Mdp"
      etiquetteConfirmation="Confirmation"
      identifiant="Léa"
      langue={langue}
      testIDs={{ mdp: 'm', confirmation: 'c' }}
      prefixe="t"
    />
  );
}

describe('SaisieNouveauMotDePasse', () => {
  it('montre l’aide, avec l’exemple de phrase et le rappel', async () => {
    await render(<Essai />);
    expect(screen.getByTestId('t-aide')).toBeTruthy();
    expect(screen.getByText(/mon chat mange 3 croquettes/)).toBeTruthy();
    expect(screen.getByText(/gestionnaire de mots de passe/)).toBeTruthy();
    expect(screen.getByLabelText('Afficher le mot de passe')).toBeTruthy();
  });

  it('coche les règles en direct et signale les écarts', async () => {
    await render(<Essai />);
    expect(screen.getByTestId('t-regle-longueur').props.accessibilityLabel).toMatch(/pas encore respectée/);
    await fireEvent.changeText(screen.getByTestId('m'), 'chat mang');
    expect(screen.getByText('Il manque 1 caractère.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('m'), 'chat mange 3 croquettes');
    expect(screen.getByTestId('t-regle-longueur').props.accessibilityLabel).toMatch(/^Règle respectée/);
    expect(screen.getByTestId('t-force-libelle').props.children).toMatch(/^Force :/);
    await fireEvent.changeText(screen.getByTestId('c'), 'autre');
    expect(screen.getByText('Les deux mots de passe ne correspondent pas.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('c'), 'chat mange 3 croquettes');
    expect(screen.queryByText('Les deux mots de passe ne correspondent pas.')).toBeNull();
    expect(screen.getByTestId('t-regle-identiques').props.accessibilityLabel).toMatch(/^Règle respectée/);
  });

  it('s’affiche en anglais', async () => {
    await render(<Essai langue="en" profil="coffre" />);
    expect(screen.getByText('Which password should I choose?')).toBeTruthy();
    expect(screen.getByText('At least 12 characters')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('m'), 'short');
    expect(screen.getByText('7 characters missing.')).toBeTruthy();
    expect(screen.getByLabelText('Show the password')).toBeTruthy();
  });
});
