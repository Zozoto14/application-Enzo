import { Decimal } from '../money/decimal';
import {
  alignerReference,
  debutPeriode,
  facteursCours,
  facteursTwr,
  rebaser,
} from './cumul';

const point = (date: string, valeur: string, flux = '0') => ({
  date,
  valeurTotale: Decimal.de(valeur),
  fluxExterne: Decimal.de(flux),
});

describe('facteursTwr', () => {
  it('neutralise les versements, comme le TWR', () => {
    const facteurs = facteursTwr([
      point('2026-01-01', '1000', '1000'),
      point('2026-02-01', '1100'),
      // Versement de 1 000 : la valeur double sans aucune performance.
      point('2026-03-01', '2100', '1000'),
    ]);
    expect(facteurs.map(f => f.facteur)).toEqual([1, 1.1, 1.1]);
  });

  it('commence au premier point où le portefeuille vaut quelque chose', () => {
    const facteurs = facteursTwr([
      point('2025-12-01', '0'),
      point('2026-01-01', '500', '500'),
      point('2026-02-01', '550'),
    ]);
    expect(facteurs[0]).toEqual({ date: '2026-01-01', facteur: 1 });
    expect(facteurs[1].facteur).toBeCloseTo(1.1);
  });

  it('ne produit pas de rendement infini après un portefeuille vidé', () => {
    const facteurs = facteursTwr([
      point('2026-01-01', '100', '100'),
      point('2026-02-01', '0', '-100'),
      point('2026-03-01', '200', '200'),
    ]);
    for (const f of facteurs) {
      expect(Number.isFinite(f.facteur)).toBe(true);
    }
  });
});

describe('fenêtres', () => {
  const serie = [
    { date: '2024-01-02', facteur: 1 },
    { date: '2025-06-30', facteur: 1.2 },
    { date: '2025-12-31', facteur: 1.5 },
    { date: '2026-09-25', facteur: 1.65 },
  ];

  it('calcule le début des périodes', () => {
    expect(debutPeriode('YTD', '2026-09-25')).toBe('2025-12-31');
    expect(debutPeriode('1A', '2026-09-25')).toBe('2025-09-25');
    expect(debutPeriode('MAX', '2026-09-25')).toBeUndefined();
  });

  it('rebase depuis le début de l’année', () => {
    const points = rebaser(serie, '2025-12-31');
    expect(points[0]).toEqual({ date: '2025-12-31', valeur: 0 });
    expect(points[1].valeur).toBeCloseTo(10);
  });

  it('part du dernier point connu quand la fenêtre s’ouvre entre deux relevés', () => {
    const points = rebaser(serie, '2025-09-25');
    expect(points[0]).toEqual({ date: '2025-09-25', valeur: 0 });
    expect(points[points.length - 1].valeur).toBeCloseTo(37.5);
  });

  it('aligne la référence sur la période du portefeuille', () => {
    const reference = facteursCours([
      { date: '2025-01-01', cloture: Decimal.de('100') },
      { date: '2025-12-31', cloture: Decimal.de('110') },
      { date: '2026-09-25', cloture: Decimal.de('121') },
      { date: '2026-09-26', cloture: Decimal.de('999') },
    ]);
    const alignee = alignerReference(reference, rebaser(serie, '2025-12-31'));
    expect(alignee[0]).toEqual({ date: '2025-12-31', valeur: 0 });
    expect(alignee[alignee.length - 1].valeur).toBeCloseTo(10);
    expect(alignee.find(p => p.date === '2026-09-26')).toBeUndefined();
  });
});
