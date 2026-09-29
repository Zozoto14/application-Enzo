import { Decimal, d } from '../money/decimal';
import type { CoursDate } from './serie';
import {
  OBSERVATIONS_MINIMUM_CORRELATION,
  alignerSeries,
  concentration,
  contributionsAuRisque,
  correlation,
  correlationEntreTitres,
  poidsDepuisMontants,
  rendementsDeSerie,
} from './risque';

/** Série de cours à dates quotidiennes, à partir d'un tableau de valeurs. */
function serie(valeurs: readonly number[], depart = 1): CoursDate[] {
  return valeurs.map((valeur, index) => ({
    date: `2026-01-${String(depart + index).padStart(2, '0')}`,
    cloture: d(valeur),
  }));
}

describe('rendementsDeSerie', () => {
  it('calcule les variations successives', () => {
    const rendements = rendementsDeSerie(serie([100, 110, 99]));

    expect(rendements).toHaveLength(2);
    expect(rendements[0]).toBeCloseTo(0.1);
    expect(rendements[1]).toBeCloseTo(-0.1);
  });

  it('ignore une division par zéro plutôt que de rendre l’infini', () => {
    expect(rendementsDeSerie(serie([0, 100]))).toEqual([]);
  });

  it('ne rend rien pour un seul point', () => {
    expect(rendementsDeSerie(serie([100]))).toEqual([]);
  });
});

describe('alignerSeries', () => {
  it('ne garde que les dates communes', () => {
    const a: CoursDate[] = [
      { date: '2026-01-01', cloture: d(10) },
      { date: '2026-01-02', cloture: d(11) },
      { date: '2026-01-03', cloture: d(12) },
    ];
    const b: CoursDate[] = [
      { date: '2026-01-02', cloture: d(20) },
      { date: '2026-01-03', cloture: d(21) },
      { date: '2026-01-04', cloture: d(22) },
    ];

    const alignees = alignerSeries(a, b);

    expect(alignees.dates).toEqual(['2026-01-02', '2026-01-03']);
    expect(alignees.a.map(v => v.toNumber())).toEqual([11, 12]);
    expect(alignees.b.map(v => v.toNumber())).toEqual([20, 21]);
  });

  it('rend des séries vides sans date commune', () => {
    const alignees = alignerSeries(serie([10, 11], 1), serie([20, 21], 10));

    expect(alignees.dates).toEqual([]);
  });
});

describe('correlation', () => {
  /** Deux séries de rendements de n points, parfaitement liées. */
  const identiques = Array.from({ length: 40 }, (_, index) =>
    Math.sin(index) / 100,
  );

  it('rend 1 pour deux séries identiques', () => {
    expect(correlation(identiques, identiques).valeur).toBeCloseTo(1);
  });

  it('rend -1 pour deux séries opposées', () => {
    const opposees = identiques.map(valeur => -valeur);

    expect(correlation(identiques, opposees).valeur).toBeCloseTo(-1);
  });

  it('rend une valeur intermédiaire pour deux séries partiellement liées', () => {
    const melangees = identiques.map((valeur, index) => valeur + Math.cos(index) / 100);
    const mesure = correlation(identiques, melangees);

    expect(mesure.valeur).not.toBeNull();
    expect(Math.abs(mesure.valeur!)).toBeLessThan(1);
  });

  it('refuse de mesurer sur trop peu d’observations', () => {
    // Deux series quelconques donnent facilement 0,9 sur cinq points.
    const mesure = correlation([0.1, -0.2, 0.3, 0.1, 0], [0.2, -0.1, 0.2, 0.2, 0.1]);

    expect(mesure.valeur).toBeNull();
    expect(mesure.motif).toMatch(/5 observation\(s\) communes, 30 nécessaires/);
  });

  it('refuse de mesurer contre une série plate', () => {
    const plate = new Array(40).fill(0);

    const mesure = correlation(identiques, plate);

    expect(mesure.valeur).toBeNull();
    expect(mesure.motif).toMatch(/ne bouge pas/);
  });

  it('exige trente observations par défaut', () => {
    expect(OBSERVATIONS_MINIMUM_CORRELATION).toBe(30);
  });

  it('accepte un seuil personnalisé, pour les tests et les réglages', () => {
    const mesure = correlation([0.1, -0.2, 0.3], [0.1, -0.2, 0.3], 3);

    expect(mesure.valeur).toBeCloseTo(1);
  });
});

describe('correlationEntreTitres', () => {
  it('aligne puis mesure', () => {
    // Deux titres qui montent ensemble, jour apres jour.
    const a = serie([100, 101, 103, 102, 105]);
    const b = serie([50, 50.5, 51.5, 51, 52.5]);

    expect(correlationEntreTitres(a, b, 3).valeur).toBeCloseTo(1);
  });

  it('compte les observations après alignement, pas avant', () => {
    // Cinquante points chacun, mais deux dates communes : deux rendements,
    // en realite un seul. On refuse.
    const a = serie(new Array(28).fill(100).map((_, i) => 100 + i), 1);
    const b = serie(new Array(28).fill(100).map((_, i) => 100 + i), 27);

    const mesure = correlationEntreTitres(a, b);

    expect(mesure.valeur).toBeNull();
    expect(mesure.motif).toMatch(/nécessaires/);
  });
});

describe('concentration', () => {
  it('donne autant de lignes équivalentes que de lignes égales', () => {
    const mesure = concentration([
      { cle: 'a', poids: 0.25 },
      { cle: 'b', poids: 0.25 },
      { cle: 'c', poids: 0.25 },
      { cle: 'd', poids: 0.25 },
    ])!;

    expect(mesure.lignesEquivalentes).toBeCloseTo(4);
    expect(mesure.herfindahl).toBeCloseTo(0.25);
    expect(mesure.nombreLignes).toBe(4);
  });

  it('démasque une diversification de façade', () => {
    // Dix lignes, mais une pese 80 % : le portefeuille en « vaut » 1,5.
    const poids = [
      { cle: 'grosse', poids: 0.8 },
      ...Array.from({ length: 9 }, (_, index) => ({
        cle: `petite-${index}`,
        poids: 0.2 / 9,
      })),
    ];

    const mesure = concentration(poids)!;

    expect(mesure.nombreLignes).toBe(10);
    expect(mesure.lignesEquivalentes).toBeLessThan(2);
    expect(mesure.premierePart).toBeCloseTo(0.8);
    expect(mesure.lignesPourMoitie).toBe(1);
  });

  it('compte les lignes nécessaires pour atteindre la moitié', () => {
    const mesure = concentration([
      { cle: 'a', poids: 0.3 },
      { cle: 'b', poids: 0.25 },
      { cle: 'c', poids: 0.25 },
      { cle: 'd', poids: 0.2 },
    ])!;

    expect(mesure.lignesPourMoitie).toBe(2);
  });

  it('normalise des poids qui ne somment pas à un', () => {
    const mesure = concentration([
      { cle: 'a', poids: 50 },
      { cle: 'b', poids: 50 },
    ])!;

    expect(mesure.lignesEquivalentes).toBeCloseTo(2);
  });

  it('rend null plutôt que de diviser par zéro', () => {
    expect(concentration([])).toBeNull();
    expect(concentration([{ cle: 'a', poids: 0 }])).toBeNull();
  });

  it('gère une ligne unique', () => {
    const mesure = concentration([{ cle: 'a', poids: 1 }])!;

    expect(mesure.lignesEquivalentes).toBeCloseTo(1);
    expect(mesure.premierePart).toBeCloseTo(1);
  });
});

describe('poidsDepuisMontants', () => {
  it('convertit des montants en parts', () => {
    const poids = poidsDepuisMontants([
      { cle: 'a', montant: d(750) },
      { cle: 'b', montant: d(250) },
    ]);

    expect(poids[0].poids).toBeCloseTo(0.75);
    expect(poids[1].poids).toBeCloseTo(0.25);
  });

  it('rend une liste vide sur un total nul', () => {
    expect(poidsDepuisMontants([{ cle: 'a', montant: Decimal.ZERO }])).toEqual([]);
  });
});

describe('contributionsAuRisque', () => {
  it('répartit le risque au prorata de poids × volatilité', () => {
    const contributions = contributionsAuRisque([
      { cle: 'calme', poids: 0.9, volatilite: 10 },
      { cle: 'agitée', poids: 0.1, volatilite: 90 },
    ]);

    // 0,9 × 10 = 9 contre 0,1 × 90 = 9 : a parts egales.
    expect(contributions[0].part).toBeCloseTo(0.5);
    expect(contributions[1].part).toBeCloseTo(0.5);
  });

  it('classe la plus contributrice en tête', () => {
    const contributions = contributionsAuRisque([
      { cle: 'petite', poids: 0.2, volatilite: 10 },
      { cle: 'grosse', poids: 0.8, volatilite: 30 },
    ]);

    expect(contributions[0].cle).toBe('grosse');
  });

  it('montre qu’une petite ligne agitée pèse plus que son poids', () => {
    const contributions = contributionsAuRisque([
      { cle: 'fonds', poids: 0.8, volatilite: 8 },
      { cle: 'spéculative', poids: 0.2, volatilite: 60 },
    ]);
    const speculative = contributions.find(c => c.cle === 'spéculative')!;

    expect(speculative.poids).toBeCloseTo(0.2);
    expect(speculative.part).toBeGreaterThan(0.6);
  });

  it('ne divise pas par zéro quand rien ne bouge', () => {
    const contributions = contributionsAuRisque([
      { cle: 'a', poids: 0.5, volatilite: 0 },
      { cle: 'b', poids: 0.5, volatilite: 0 },
    ]);

    expect(contributions.every(c => c.part === 0)).toBe(true);
  });
});
