import { Decimal, d } from '../money/decimal';
import {
  ECART_SCENARIOS,
  HORIZON_MAXIMUM,
  INFLATION_DEFAUT,
  TAUX_RETRAIT_DEFAUT,
  anneesDeDepensesCouvertes,
  independance,
  projeter,
  scenarios,
  type HypothesesProjection,
} from './projection';

function hypotheses(partiel: Partial<HypothesesProjection> = {}): HypothesesProjection {
  return {
    capital: d(10000),
    versementMensuel: d(500),
    rendementAnnuel: 7,
    annees: 20,
    ...partiel,
  };
}

describe('projeter', () => {
  it('capitalise le capital de départ seul', () => {
    // 10 000 a 7 % pendant 10 ans : 19 671,51 €.
    const projection = projeter(
      hypotheses({ versementMensuel: Decimal.ZERO, annees: 10, inflation: 0 }),
    );

    expect(projection.final.nominal.toNumber()).toBeCloseTo(19671.51, 0);
  });

  it('ajoute les versements mensuels', () => {
    const projection = projeter(hypotheses({ capital: Decimal.ZERO, annees: 10 }));

    // 500 par mois pendant 10 ans : 60 000 verses, et bien plus a l'arrivee.
    expect(projection.final.verse.toNumber()).toBeCloseTo(60000, 0);
    expect(projection.final.nominal.toNumber()).toBeGreaterThan(80000);
  });

  it('part de l’année zéro, au capital initial', () => {
    const projection = projeter(hypotheses());

    expect(projection.points[0].annee).toBe(0);
    expect(projection.points[0].nominal.eq(d(10000))).toBe(true);
    expect(projection.points[0].interets.estZero()).toBe(true);
  });

  it('rend un point par année', () => {
    expect(projeter(hypotheses({ annees: 15 })).points).toHaveLength(16);
  });

  describe('inflation', () => {
    it('rend toujours le nominal et le réel', () => {
      // Sur vingt ans, 2 % par an divisent le pouvoir d'achat par 1,5 : une
      // projection nominale n'est pas une projection en euros d'aujourd'hui.
      const projection = projeter(hypotheses());

      expect(projection.final.reel.lt(projection.final.nominal)).toBe(true);
    });

    it('n’écarte rien quand l’inflation est nulle', () => {
      const projection = projeter(hypotheses({ inflation: 0 }));

      expect(projection.final.reel.eq(projection.final.nominal)).toBe(true);
    });

    it('retient 2 % par défaut, la cible de la BCE', () => {
      expect(INFLATION_DEFAUT).toBe(2);
    });
  });

  describe('frais', () => {
    it('les retranche du rendement', () => {
      const sans = projeter(hypotheses({ fraisAnnuels: 0 }));
      const avec = projeter(hypotheses({ fraisAnnuels: 0.5 }));

      expect(avec.rendementNet).toBeCloseTo(6.5);
      expect(avec.final.nominal.lt(sans.final.nominal)).toBe(true);
    });

    it('montre qu’ils composent, et lourdement', () => {
      // 0,5 % de frais sur trente ans coutent une part notable du capital.
      const sans = projeter(hypotheses({ annees: 30, fraisAnnuels: 0 }));
      const avec = projeter(hypotheses({ annees: 30, fraisAnnuels: 0.5 }));
      const perte =
        1 - avec.final.nominal.div(sans.final.nominal).toNumber();

      expect(perte).toBeGreaterThan(0.08);
    });
  });

  describe('bascule', () => {
    it('trouve l’année où les intérêts dépassent les versements', () => {
      const projection = projeter(hypotheses({ annees: 40 }));

      expect(projection.anneeBascule).toBeGreaterThan(0);
      const bascule = projection.points[projection.anneeBascule!];
      expect(bascule.interets.gt(bascule.verse)).toBe(true);
    });

    it('n’en invente pas quand elle n’arrive pas', () => {
      const projection = projeter(hypotheses({ annees: 5, rendementAnnuel: 1 }));

      expect(projection.anneeBascule).toBeUndefined();
    });
  });

  describe('indexation du versement', () => {
    it('fait progresser l’effort d’épargne', () => {
      const fixe = projeter(hypotheses({ indexationVersement: 0 }));
      const indexe = projeter(hypotheses({ indexationVersement: 2 }));

      expect(indexe.final.verse.gt(fixe.final.verse)).toBe(true);
      expect(indexe.final.nominal.gt(fixe.final.nominal)).toBe(true);
    });
  });

  describe('bornes', () => {
    it('rend le capital tel quel sur zéro année', () => {
      const projection = projeter(hypotheses({ annees: 0 }));

      expect(projection.points).toHaveLength(1);
      expect(projection.final.nominal.eq(d(10000))).toBe(true);
    });

    it('refuse un horizon absurde plutôt que de le simuler', () => {
      // Au-dela, le chiffre n'informe plus : il impressionne.
      const projection = projeter(hypotheses({ annees: 200 }));

      expect(projection.points).toHaveLength(HORIZON_MAXIMUM + 1);
    });

    it('supporte un rendement négatif', () => {
      const projection = projeter(
        hypotheses({ rendementAnnuel: -3, versementMensuel: Decimal.ZERO, annees: 10 }),
      );

      expect(projection.final.nominal.lt(d(10000))).toBe(true);
      expect(projection.final.interets.estNegatif()).toBe(true);
    });
  });
});

describe('scenarios', () => {
  it('encadre le scénario central', () => {
    const trois = scenarios(hypotheses());

    expect(trois.prudent.final.reel.lt(trois.central.final.reel)).toBe(true);
    expect(trois.central.final.reel.lt(trois.favorable.final.reel)).toBe(true);
  });

  it('mesure la dispersion, qui est l’information principale', () => {
    // Un simulateur qui ne rend qu'un chiffre cache a quel point il depend
    // d'une hypothese qu'on ne maitrise pas.
    const trois = scenarios(hypotheses());

    expect(trois.dispersion.estPositif()).toBe(true);
    expect(trois.dispersion.gt(trois.central.final.reel.div(2))).toBe(true);
  });

  it('écarte de trois points par défaut', () => {
    expect(ECART_SCENARIOS).toBe(3);
    expect(scenarios(hypotheses()).prudent.rendementNet).toBeCloseTo(4);
  });

  it('accepte un écart personnalisé', () => {
    expect(scenarios(hypotheses(), 1).prudent.rendementNet).toBeCloseTo(6);
  });
});

describe('independance', () => {
  it('calcule le capital nécessaire au taux retenu', () => {
    // 24 000 € par an a 4 % : 600 000 €.
    const resultat = independance(projeter(hypotheses()), {
      depensesAnnuelles: d(24000),
    });

    expect(resultat.capitalNecessaire.toNumber()).toBeCloseTo(600000);
  });

  it('retient 4 % par défaut', () => {
    expect(TAUX_RETRAIT_DEFAUT).toBe(4);
  });

  it('accepte un taux plus prudent', () => {
    const resultat = independance(projeter(hypotheses()), {
      depensesAnnuelles: d(24000),
      tauxRetrait: 3,
    });

    expect(resultat.capitalNecessaire.toNumber()).toBeCloseTo(800000);
  });

  it('compare au capital réel, pas au nominal', () => {
    // Un objectif en euros d'aujourd'hui doit se mesurer en euros
    // d'aujourd'hui : sinon l'inflation offre une independance fictive.
    const projection = projeter(hypotheses({ annees: 30 }));
    const avecInflation = independance(projection, { depensesAnnuelles: d(8000) });
    const sansInflation = independance(
      projeter(hypotheses({ annees: 30, inflation: 0 })),
      { depensesAnnuelles: d(8000) },
    );

    expect(avecInflation.annees!).toBeGreaterThan(sansInflation.annees!);
  });

  it('dit l’année où l’objectif est atteint', () => {
    const resultat = independance(projeter(hypotheses({ annees: 40 })), {
      depensesAnnuelles: d(12000),
    });

    expect(resultat.annees).not.toBeNull();
    expect(resultat.progression).toBe(1);
  });

  it('explique au lieu de promettre quand l’horizon ne suffit pas', () => {
    const resultat = independance(projeter(hypotheses({ annees: 10 })), {
      depensesAnnuelles: d(100000),
    });

    expect(resultat.annees).toBeNull();
    expect(resultat.motif).toMatch(/n’est pas atteint dans les 10 année\(s\)/);
    expect(resultat.progression).toBeLessThan(1);
  });

  it('refuse un taux de retrait nul plutôt que de diviser par zéro', () => {
    const resultat = independance(projeter(hypotheses()), {
      depensesAnnuelles: d(24000),
      tauxRetrait: 0,
    });

    expect(resultat.annees).toBeNull();
    expect(resultat.motif).toMatch(/ne définit aucun capital cible/);
  });
});

describe('anneesDeDepensesCouvertes', () => {
  it('dit combien de temps le capital tiendrait', () => {
    expect(anneesDeDepensesCouvertes(d(100000), d(25000))).toBeCloseTo(4);
  });

  it('ne divise pas par zéro', () => {
    expect(anneesDeDepensesCouvertes(d(100000), Decimal.ZERO)).toBeNull();
  });
});
