import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { ComparateurFinancier } from './ComparateurFinancier';

const base = {
  suggestions: [],
  onAjouter: () => {},
  onRetirer: () => {},
  onRechercher: async () => [],
  onRetour: () => {},
  comparaisonCours: null,
};

describe('comparateur financier', () => {
  it('explique qu’un ETF n’a pas de comptes à comparer', async () => {
    await render(
      <ComparateurFinancier
        {...base}
        societes={[{ symbole: 'CW8.PA', nom: 'Amundi Index Solutions - Amundi MSCI World UCITS ETF EUR Acc', comptes: {} }]}
      />,
    );
    expect(screen.getByText(/est un fonds \(ETF\) : il n’a pas de comptes de société/)).toBeTruthy();
  });

  it('dit quand Yahoo n’a rien renvoyé pour une entreprise', async () => {
    await render(<ComparateurFinancier {...base} societes={[{ symbole: 'STLAP.PA', nom: 'Stellantis N.V.', comptes: {} }]} />);
    expect(screen.getByText(/n’a pas renvoyé les comptes de Stellantis N.V./)).toBeTruthy();
  });
});
