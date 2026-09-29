import { d } from '../../core/money/decimal';
import { achat, versement } from '../../core/testing/fixtures';
import { fluxInvestis, simulerToutSurIndice } from './siIndice';

const serie = [
  { date: '2026-01-02', cloture: d('100') },
  { date: '2026-03-02', cloture: d('110') },
  { date: '2026-06-01', cloture: d('125') },
];

describe('et si tout était sur le MSCI World', () => {
  it('rejoue chaque versement au cours du jour', () => {
    const resultat = simulerToutSurIndice({
      transactions: [
        versement('2026-01-02', 1000),
        versement('2026-03-02', 1100),
      ],
      serie,
      valeurReelle: 2300,
    })!;
    // 10 parts puis 10 parts, valorisées à 125.
    expect(resultat.valeurIndice).toBeCloseTo(2500);
    expect(resultat.investi).toBe(2100);
    expect(resultat.ecart).toBeCloseTo(-200);
    expect(resultat.performanceIndice).toBeCloseTo(19.05, 1);
    expect(resultat.courbe.map(point => Math.round(point.valeur))).toEqual([1000, 2200, 2500]);
    expect(resultat.approximatif).toBe(false);
  });

  it('prend les achats pour mise quand il n’y a aucun versement', () => {
    const flux = fluxInvestis([achat('2026-01-02', 2, 50, 1)]);
    expect(flux).toEqual([{ date: '2026-01-02', montant: 101 }]);
  });

  it('signale une date antérieure à l’historique de l’indice', () => {
    const resultat = simulerToutSurIndice({
      transactions: [versement('2025-06-01', 1000)],
      serie,
      valeurReelle: 1000,
    })!;
    expect(resultat.approximatif).toBe(true);
  });

  it('ne dit rien sans flux ni historique', () => {
    expect(simulerToutSurIndice({ transactions: [], serie, valeurReelle: 0 })).toBeUndefined();
    expect(
      simulerToutSurIndice({ transactions: [versement('2026-01-02', 1)], serie: [], valeurReelle: 1 }),
    ).toBeUndefined();
  });
});
