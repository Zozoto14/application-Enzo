import { Decimal } from '../money/decimal';
import {
  calmar,
  correlationMoyennePonderee,
  frontiereEfficiente,
  recuperationLaPlusLongue,
  rendementsMensuels,
  serieDrawdown,
  sortino,
  statistiquesMensuelles,
  volatiliteBaisse,
} from './analyse';

const f = (date: string, facteur: number) => ({ date, facteur });

describe('drawdown dans le temps', () => {
  const facteurs = [
    f('2026-01-01', 1),
    f('2026-01-10', 1.2),
    f('2026-01-20', 0.9),
    f('2026-02-15', 1.25),
    f('2026-03-01', 1.0),
  ];

  it('mesure la baisse depuis le plus haut précédent', () => {
    const serie = serieDrawdown(facteurs);
    expect(serie[0].valeur).toBe(0);
    expect(serie[2].valeur).toBeCloseTo(-25);
    expect(serie[3].valeur).toBe(0);
    expect(serie[4].valeur).toBeCloseTo(-20);
  });

  it('compte la plus longue période sous un sommet, y compris en cours', () => {
    // Du 10 janvier au 15 février : 36 jours.
    expect(recuperationLaPlusLongue(facteurs)).toBe(36);
    expect(recuperationLaPlusLongue([f('2026-01-01', 1), f('2026-01-02', 1.1)])).toBe(0);
  });
});

describe('rendements mensuels', () => {
  it('chaîne les fins de mois et agrège l’année', () => {
    const rendements = rendementsMensuels([
      f('2025-11-20', 1),
      f('2025-11-30', 1.1),
      f('2025-12-31', 1.21),
      f('2026-01-31', 1.089),
    ]);
    expect(rendements.parMois.get(2025)?.get(11)).toBeCloseTo(10);
    expect(rendements.parMois.get(2025)?.get(12)).toBeCloseTo(10);
    expect(rendements.parMois.get(2026)?.get(1)).toBeCloseTo(-10);
    expect(rendements.parAnnee.get(2025)).toBeCloseTo(21);
    expect(rendements.parAnnee.get(2026)).toBeCloseTo(-10);

    const stats = statistiquesMensuelles(rendements);
    expect(stats.meilleur?.valeur).toBeCloseTo(10);
    expect(stats.pire?.cle).toBe('2026-01');
    expect(stats.moisPositifs).toBeCloseTo(66.67, 1);
  });
});

describe('ratios', () => {
  it('refuse Sortino et Calmar quand ils ne sont pas définis', () => {
    expect(sortino(10, { valeur: null, motif: 'x' }).valeur).toBeNull();
    expect(calmar(10, 0).valeur).toBeNull();
    expect(calmar(10, -20).valeur).toBeCloseTo(0.5);
  });

  it('ne retient que les baisses dans la volatilité à la baisse', () => {
    const hausses = Array.from({ length: 30 }, () => 0.01);
    expect(volatiliteBaisse(hausses).valeur).toBe(0);
    const mixte = Array.from({ length: 30 }, (_, i) => (i % 2 ? 0.01 : -0.01));
    expect(volatiliteBaisse(mixte).valeur).toBeGreaterThan(0);
  });
});

describe('frontière efficiente', () => {
  function serie(tendance: number, bruit: number, graine: number) {
    let x = graine;
    let cours = 100;
    return Array.from({ length: 200 }, (_, i) => {
      x = (x * 9301 + 49297) % 233280;
      cours *= 1 + tendance + (x / 233280 - 0.5) * bruit;
      const date = new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);
      return { date, cloture: Decimal.de(cours.toFixed(4)) };
    });
  }

  it('place le portefeuille de tangence sur l’enveloppe, entre les actifs', () => {
    const resultat = frontiereEfficiente([
      { id: 'calme', serie: serie(0.0004, 0.01, 7), poids: 0.5 },
      { id: 'agite', serie: serie(0.0008, 0.04, 11), poids: 0.5 },
    ], { tirages: 500 });
    if ('motif' in resultat) {
      throw new Error(resultat.motif);
    }
    expect(resultat.actifs).toHaveLength(2);
    expect(resultat.courbe.length).toBeGreaterThan(2);
    // La courbe monte : plus de risque, plus de rendement.
    for (let i = 1; i < resultat.courbe.length; i++) {
      expect(resultat.courbe[i].rendement).toBeGreaterThanOrEqual(resultat.courbe[i - 1].rendement);
    }
    const somme = Object.values(resultat.tangence.poids).reduce((a, b) => a + b, 0);
    expect(somme).toBeCloseTo(1);
  });

  it('refuse avec trop peu de séances communes', () => {
    const court = serie(0, 0.01, 3).slice(0, 10);
    const resultat = frontiereEfficiente([
      { id: 'a', serie: court, poids: 1 },
      { id: 'b', serie: court, poids: 1 },
    ]);
    expect('motif' in resultat).toBe(true);
  });
});

it('pondère la corrélation moyenne par les poids', () => {
  expect(
    correlationMoyennePonderee([
      { poidsA: 0.5, poidsB: 0.5, correlation: 1 },
      { poidsA: 0.1, poidsB: 0.1, correlation: 0 },
      { poidsA: 0.2, poidsB: 0.2, correlation: null },
    ]),
  ).toBeCloseTo(0.25 / 0.26);
});
