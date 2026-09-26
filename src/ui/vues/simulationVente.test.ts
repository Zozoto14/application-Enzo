import { simulerVente } from './simulationVente';

describe('simulateur de vente', () => {
  it('compte-titres : 30 % sur la plus-value', () => {
    const resultat = simulerVente({
      enveloppe: 'CTO', dateOuverture: '2020-01-01', aujourdhui: '2026-09-26',
      quantite: 10, prixVente: 150, pru: 100, frais: 2,
    });
    expect(resultat.produit).toBe(1498);
    expect(resultat.plusValue).toBe(498);
    expect(resultat.impotVente).toBeCloseTo(149.4);
    expect(resultat.netVente).toBeCloseTo(1348.6);
  });

  it('compte-titres : une moins-value ne coûte rien', () => {
    const resultat = simulerVente({ enveloppe: 'CTO', dateOuverture: '2020-01-01', aujourdhui: '2026-09-26', quantite: 10, prixVente: 80, pru: 100 });
    expect(resultat.impotVente).toBe(0);
    expect(resultat.explication).toMatch(/moins-value ne coûte rien/);
  });

  it('PEA de moins de cinq ans : vente gratuite, retrait imposé à 30 % et clôture', () => {
    const resultat = simulerVente({
      enveloppe: 'PEA', dateOuverture: '2023-03-15', aujourdhui: '2026-09-26',
      quantite: 10, prixVente: 150, pru: 100, valeurPlan: 20000, versementsPlan: 16000,
    });
    expect(resultat.impotVente).toBe(0);
    expect(resultat.cinqAns).toEqual({ date: '2028-03-15', joursRestants: 536, atteint: false });
    // 1 500 € retirés d'un plan en gain de 20 % : 300 € de gain, 90 € d'impôt.
    expect(resultat.retrait).toEqual({ impot: 90, partGain: 300, taux: 0.3, clotureLePlan: true, net: 1410 });
  });

  it('PEA de plus de cinq ans : seulement 17,2 % sur la part de gain retirée', () => {
    const resultat = simulerVente({
      enveloppe: 'PEA', dateOuverture: '2019-01-10', aujourdhui: '2026-09-26',
      quantite: 10, prixVente: 150, pru: 100, valeurPlan: 20000, versementsPlan: 16000,
    });
    expect(resultat.cinqAns?.atteint).toBe(true);
    expect(resultat.retrait?.impot).toBeCloseTo(51.6);
    expect(resultat.retrait?.clotureLePlan).toBe(false);
  });
});
