import { Decimal, d } from '../money/decimal';
import type { PointValorisation } from './rendements';
import type { CoursDate } from './serie';
import {
  POINTS_MINIMUM_COMPARAISON,
  calculerBeta,
  comparerAReference,
} from './reference';

function jour(index: number): string {
  const date = new Date(2026, 0, 1 + index);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

/** Valorisations quotidiennes, sans flux externe sauf indication. */
function points(
  valeurs: readonly number[],
  flux: readonly number[] = [],
): PointValorisation[] {
  return valeurs.map((valeur, index) => ({
    date: jour(index),
    valeurTotale: d(valeur),
    fluxExterne: d(flux[index] ?? 0),
  }));
}

function cours(valeurs: readonly number[], decalage = 0): CoursDate[] {
  return valeurs.map((valeur, index) => ({
    date: jour(index + decalage),
    cloture: d(valeur.toFixed(6)),
  }));
}

describe('comparerAReference', () => {
  it('mesure la performance de chacun sur la période commune', () => {
    // Portefeuille +20 %, reference +10 % sur les memes dates.
    const comparaison = comparerAReference(points([100, 120]), cours([50, 55]), 1);

    expect(comparaison.portefeuille.valeur).toBeCloseTo(20);
    expect(comparaison.reference.valeur).toBeCloseTo(10);
    expect(comparaison.ecart.valeur).toBeCloseTo(10);
  });

  it('borne la comparaison à l’intersection des deux historiques', () => {
    // La reference ne commence qu'au troisieme jour : les deux premiers points
    // du portefeuille ne se comparent a rien.
    const comparaison = comparerAReference(
      points([100, 110, 120, 132]),
      cours([50, 55], 2),
      1,
    );

    expect(comparaison.debut).toBe(jour(2));
    expect(comparaison.fin).toBe(jour(3));
    expect(comparaison.portefeuille.valeur).toBeCloseTo(10);
  });

  it('neutralise les versements, qui ne sont pas une performance', () => {
    // 100 -> 210 dont 100 verses : la vraie performance est +10 %, pas +110 %.
    const comparaison = comparerAReference(
      points([100, 210], [0, 100]),
      cours([50, 50]),
      1,
    );

    expect(comparaison.portefeuille.valeur).toBeCloseTo(10);
    expect(comparaison.ecart.valeur).toBeCloseTo(10);
  });

  it('annualise les deux performances sur la même durée', () => {
    const valeurs = Array.from({ length: 200 }, (_, index) => 100 * (1 + index * 0.001));
    const comparaison = comparerAReference(
      points(valeurs),
      cours(valeurs.map(v => v / 2)),
      30,
    );

    expect(comparaison.portefeuilleAnnualise.valeur).not.toBeNull();
    expect(comparaison.referenceAnnualisee.valeur).not.toBeNull();
    expect(comparaison.jours).toBe(199);
  });

  describe('refus', () => {
    it('refuse sans deux valorisations', () => {
      const comparaison = comparerAReference(points([100]), cours([50, 55]));

      expect(comparaison.portefeuille.valeur).toBeNull();
      expect(comparaison.portefeuille.motif).toMatch(/au moins deux valorisations/);
    });

    it('refuse sans cours de référence', () => {
      const comparaison = comparerAReference(points([100, 120]), []);

      expect(comparaison.reference.motif).toMatch(/pas assez de cours/);
    });

    it('refuse quand les deux historiques ne se croisent pas', () => {
      // La reference court sur les jours 20 a 21, le portefeuille sur 0 a 1.
      const comparaison = comparerAReference(points([100, 120]), cours([50, 55], 20));

      expect(comparaison.ecart.valeur).toBeNull();
      expect(comparaison.ecart.motif).toMatch(/Aucune période commune/);
    });

    it('exige deux points, pas un', () => {
      expect(POINTS_MINIMUM_COMPARAISON).toBe(2);
    });
  });

  describe('bêta et alpha', () => {
    /** Portefeuille qui amplifie exactement deux fois la référence. */
    const reference = Array.from({ length: 60 }, (_, index) =>
      100 * (1 + Math.sin(index) / 50),
    );

    it('mesure un bêta de 1 pour un portefeuille qui suit la référence', () => {
      const comparaison = comparerAReference(
        points(reference),
        cours(reference),
        30,
      );

      expect(comparaison.beta.valeur).toBeCloseTo(1, 1);
      expect(comparaison.correlation.valeur).toBeCloseTo(1, 1);
    });

    it('refuse un bêta sur trop peu de périodes communes', () => {
      // Un beta sur trois points n'est qu'un accident de mesure.
      const comparaison = comparerAReference(points([100, 110, 120]), cours([50, 54, 58]));

      expect(comparaison.beta.valeur).toBeNull();
      expect(comparaison.beta.motif).toMatch(/nécessaires/);
    });

    it('refuse l’alpha quand le bêta manque', () => {
      const comparaison = comparerAReference(points([100, 110, 120]), cours([50, 54, 58]));

      expect(comparaison.alpha.valeur).toBeNull();
    });

    it('rend un alpha positif quand le portefeuille dépasse ce que le bêta explique', () => {
      // Meme forme que la reference, mais 0,05 % de mieux chaque jour.
      const portefeuille = reference.map((valeur, index) => valeur * (1 + index * 0.0005));
      const comparaison = comparerAReference(
        points(portefeuille),
        cours(reference),
        30,
      );

      expect(comparaison.alpha.valeur).not.toBeNull();
      expect(comparaison.alpha.valeur!).toBeGreaterThan(0);
    });
  });

  it('ne regarde jamais un cours postérieur à la date comparée', () => {
    // La reference n'a de cours qu'aux jours 0 et 3 : au jour 1, c'est celui
    // du jour 0 qui vaut, pas celui du jour 3.
    const serie: CoursDate[] = [
      { date: jour(0), cloture: d(100) },
      { date: jour(3), cloture: d(200) },
    ];
    const comparaison = comparerAReference(points([100, 110]), serie, 1);

    // Du jour 0 au jour 1, la reference n'a pas bouge.
    expect(comparaison.reference.valeur).toBeCloseTo(0);
  });
});

describe('calculerBeta', () => {
  const reference = Array.from({ length: 40 }, (_, index) => Math.sin(index) / 100);

  it('rend 1 pour deux séries identiques', () => {
    expect(calculerBeta(reference, reference).valeur).toBeCloseTo(1);
  });

  it('rend 2 pour un portefeuille qui amplifie deux fois', () => {
    const amplifie = reference.map(valeur => valeur * 2);

    expect(calculerBeta(amplifie, reference).valeur).toBeCloseTo(2);
  });

  it('rend 0,5 pour un portefeuille qui amortit', () => {
    const amorti = reference.map(valeur => valeur / 2);

    expect(calculerBeta(amorti, reference).valeur).toBeCloseTo(0.5);
  });

  it('refuse quand la référence n’a pas bougé', () => {
    const plate = new Array(40).fill(0);

    const mesure = calculerBeta(reference, plate);

    expect(mesure.valeur).toBeNull();
    expect(mesure.motif).toMatch(/n’a pas bougé/);
  });

  it('refuse sous le nombre d’observations exigé', () => {
    const mesure = calculerBeta([0.1, 0.2], [0.1, 0.2]);

    expect(mesure.valeur).toBeNull();
    expect(mesure.motif).toMatch(/2 période\(s\) communes, 30 nécessaires/);
  });
});

describe('frontière entre montants et taux', () => {
  it('accepte des cours décimaux sans perdre la précision du montant', () => {
    const serie: CoursDate[] = [
      { date: jour(0), cloture: Decimal.de('123.45') },
      { date: jour(1), cloture: Decimal.de('135.795') },
    ];
    const comparaison = comparerAReference(points([100, 110]), serie, 1);

    // +10 % exactement.
    expect(comparaison.reference.valeur).toBeCloseTo(10);
    expect(comparaison.ecart.valeur).toBeCloseTo(0);
  });
});
