import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { OngletImpots } from './Impots';

const vue = { comptes: [], annees: [], aucuneCession: true };

describe('simulateur de vente', () => {
  it('montre qu’une vente dans un PEA ne coûte rien, et ce que coûterait le retrait', async () => {
    await render(
      <OngletImpots
        vue={vue}
        aujourdhui="2026-09-26"
        ventes={[
          {
            cle: 'pea|ai',
            libelle: 'Air Liquide · PEA',
            enveloppe: 'PEA',
            dateOuverture: '2023-03-15',
            quantite: 10,
            pru: 100,
            cours: 150,
            valeurPlan: 20000,
            versementsPlan: 16000,
          },
          { cle: 'cto|nvda', libelle: 'NVIDIA · CTO', enveloppe: 'CTO', dateOuverture: '2024-01-01', quantite: 4, pru: 100, cours: 200 },
        ]}
      />,
    );
    expect(screen.getByText(/PEA : vendre ne coûte rien/)).toBeTruthy();
    expect(screen.getByTestId('retrait-pea').props.children.join('')).toMatch(/PEA serait clôturé/);
    expect(screen.getByTestId('cinq-ans-pea').props.children).toMatch(/15\/03\/2028, dans 536 jours/);

    await fireEvent.changeText(screen.getByTestId('champ-quantite-vente'), '20');
    expect(screen.getByText(/au plus celle détenue/)).toBeTruthy();
  });
});
