import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Screener } from './Screener';
import type { ActionScreener } from '../../fondamentaux/screener';

const action = (symbole: string, nom: string, partiel: Partial<ActionScreener> = {}): ActionScreener => ({
  symbole,
  nom,
  place: 'NasdaqGS',
  devise: 'USD',
  cours: 100,
  variation: 1.2,
  capitalisation: 2e12,
  per: 20,
  prixSurActif: 3,
  rendement: 1.5,
  pays: 'US',
  ...partiel,
});

describe('screener', () => {
  it('charge la catégorie choisie, pagine et ajoute à la watchlist', async () => {
    const charger = jest.fn(async (_categorie: string, _region: string, page: number) => ({
      actions: page === 0 ? [action('NVDA', 'NVIDIA Corporation'), action('AAPL', 'Apple Inc.')] : [action('MSFT', 'Microsoft')],
      total: 3,
    }));
    const surveiller = jest.fn();
    await render(
      <Screener chargerScreener={charger} surveilles={new Set(['AAPL'])} onSurveiller={surveiller} onOuvrirFiche={() => {}} />,
    );

    expect(await screen.findByText('NVIDIA Corporation')).toBeTruthy();
    expect(charger).toHaveBeenLastCalledWith('tout', 'monde', 0, 'capitalisation');
    expect(screen.getByLabelText('Apple Inc. est dans la watchlist')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('screener-suivre-NVDA'));
    expect(surveiller).toHaveBeenCalledWith(expect.objectContaining({ symbole: 'NVDA' }));

    await fireEvent.press(screen.getByText('Voir 1 de plus'));
    expect(await screen.findByText('Microsoft')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('categorie-value'));
    expect(charger).toHaveBeenLastCalledWith('value', 'monde', 0, 'capitalisation');
    await fireEvent.press(screen.getByTestId('categorie-france'));
    expect(screen.getByText(/France — imposé par la catégorie/)).toBeTruthy();
  });

  it('dit quand le screener ne répond pas', async () => {
    await render(
      <Screener
        chargerScreener={async () => {
          throw new Error('Yahoo a répondu 429.');
        }}
        surveilles={new Set()}
        onSurveiller={() => {}}
        onOuvrirFiche={() => {}}
      />,
    );
    expect(await screen.findByText(/Le screener n’a pas répondu : Yahoo a répondu 429/)).toBeTruthy();
  });
});
