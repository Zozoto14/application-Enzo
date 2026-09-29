import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Diagnostic } from './Diagnostic';
import { testsDuBureau } from '../../diagnostic/testsBureau';

describe('écran Diagnostic', () => {
  it('lance les tests et affiche un rapport à copier', async () => {
    await render(
      <Diagnostic
        maintenant={() => '26/09/2026 14:00'}
        tests={[
          { cle: 'cours', libelle: 'Cours', executer: async () => 'Air Liquide à 177 €' },
          { cle: 'voix', libelle: 'Voix', executer: async () => { throw new Error('connexion refusée'); } },
        ]}
      />,
    );
    await fireEvent.press(screen.getByTestId('lancer-diagnostic'));
    expect(await screen.findByText('1 problème')).toBeTruthy();
    expect(screen.getByText('connexion refusée')).toBeTruthy();
    expect(screen.getByTestId('rapport-diagnostic').props.value).toContain('✅ Cours : Air Liquide à 177 €');
  });

  it('hors du bureau, chaque service se dit indisponible', () => {
    const tests = testsDuBureau(undefined);
    expect(tests.length).toBeGreaterThanOrEqual(8);
    expect(tests.every(test => !test.executer && test.motifAbsence)).toBe(true);
  });
});
