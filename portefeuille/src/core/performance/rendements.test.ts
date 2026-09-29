import { d } from '../money/decimal';
import {
  JOURS_MINIMUM_ANNUALISATION,
  annualiser,
  drawdown,
  joursEntre,
  rendementsPeriodiques,
  sharpe,
  tri,
  twr,
  volatilite,
  type PointValorisation,
} from './rendements';

const point = (
  date: string,
  valeurTotale: number | string,
  fluxExterne: number | string = 0,
): PointValorisation => ({
  date,
  valeurTotale: d(valeurTotale),
  fluxExterne: d(fluxExterne),
});

describe('joursEntre', () => {
  it('compte les jours calendaires', () => {
    expect(joursEntre('2026-01-01', '2026-01-31')).toBe(30);
    expect(joursEntre('2026-01-01', '2027-01-01')).toBe(365);
  });

  it('signale une date invalide', () => {
    expect(Number.isNaN(joursEntre('hier', '2026-01-01'))).toBe(true);
  });
});

describe('twr', () => {
  it('rend le rendement simple sans flux', () => {
    // 100 -> 110 : +10 %.
    expect(twr([point('2026-01-01', 100), point('2026-02-01', 110)]).valeur).toBeCloseTo(
      10,
    );
  });

  it('neutralise un versement', () => {
    // 100 -> 210 dont 100 de versement : la performance est de +10 %, pas
    // de +110 %. C'est toute la raison d'être du TWR.
    const mesure = twr([point('2026-01-01', 100), point('2026-02-01', 210, 100)]);
    expect(mesure.valeur).toBeCloseTo(10);
  });

  it('neutralise un retrait', () => {
    const mesure = twr([point('2026-01-01', 100), point('2026-02-01', 60, -50)]);
    expect(mesure.valeur).toBeCloseTo(10);
  });

  it('chaîne les sous-périodes', () => {
    // +10 % puis +10 % donne +21 %, pas +20 %.
    const mesure = twr([
      point('2026-01-01', 100),
      point('2026-02-01', 110),
      point('2026-03-01', 121),
    ]);
    expect(mesure.valeur).toBeCloseTo(21);
  });

  it('gère une performance négative', () => {
    expect(twr([point('2026-01-01', 100), point('2026-02-01', 80)]).valeur).toBeCloseTo(
      -20,
    );
  });

  describe('refus', () => {
    it('exige deux valorisations', () => {
      expect(twr([point('2026-01-01', 100)]).valeur).toBeNull();
      expect(twr([]).motif).toMatch(/deux valorisations/);
    });

    it('refuse de diviser par une valorisation nulle', () => {
      // Le cas qui produit les « +2 439 % » vus ailleurs : une période qui
      // démarre à une valorisation quasi nulle.
      const mesure = twr([point('2026-08-03', 0), point('2026-09-22', 12047)]);
      expect(mesure.valeur).toBeNull();
      expect(mesure.motif).toMatch(/nulle ou négative/);
    });

    it('refuse une valorisation de départ négative', () => {
      const mesure = twr([point('2026-08-03', '-3.59'), point('2026-09-22', 12047)]);
      expect(mesure.valeur).toBeNull();
    });
  });
});

describe('annualiser', () => {
  it('annualise une période longue', () => {
    // +21 % sur deux ans font environ +10 % par an.
    expect(annualiser(21, 730).valeur).toBeCloseTo(10, 1);
  });

  it('laisse un an inchangé', () => {
    expect(annualiser(10, 365).valeur).toBeCloseTo(10);
  });

  describe('refus', () => {
    it('refuse d’annualiser une période trop courte', () => {
      // Sept semaines de hausse annualisées donnent les milliards de pour cent
      // affichés par certains outils.
      const mesure = annualiser(2439, 50);
      expect(mesure.valeur).toBeNull();
      expect(mesure.motif).toMatch(/trop courte/);
    });

    it('accepte à partir du seuil', () => {
      expect(annualiser(10, JOURS_MINIMUM_ANNUALISATION).valeur).not.toBeNull();
    });

    it('refuse une perte totale', () => {
      expect(annualiser(-100, 365).motif).toMatch(/Perte totale/);
    });
  });
});

describe('tri', () => {
  it('retrouve un taux connu', () => {
    // 1 000 investis, 1 100 récupérés un an plus tard : 10 %.
    const mesure = tri([
      { date: '2025-01-01', montant: d('-1000') },
      { date: '2026-01-01', montant: d('1100') },
    ]);
    expect(mesure.valeur).toBeCloseTo(10, 1);
  });

  it('tient compte du moment des versements', () => {
    // Deux versements, dont un tardif : le TRI diffère du rendement simple.
    const mesure = tri([
      { date: '2025-01-01', montant: d('-1000') },
      { date: '2025-07-01', montant: d('-1000') },
      { date: '2026-01-01', montant: d('2200') },
    ]);
    expect(mesure.valeur).toBeGreaterThan(10);
  });

  it('rend un taux négatif sur une perte', () => {
    const mesure = tri([
      { date: '2025-01-01', montant: d('-1000') },
      { date: '2026-01-01', montant: d('900') },
    ]);
    expect(mesure.valeur).toBeCloseTo(-10, 1);
  });

  describe('refus', () => {
    it('exige une entrée et une sortie', () => {
      const mesure = tri([
        { date: '2025-01-01', montant: d('-1000') },
        { date: '2026-01-01', montant: d('-500') },
      ]);
      expect(mesure.motif).toMatch(/entrée et une sortie/);
    });

    it('refuse un historique trop court', () => {
      // Le TRI est annualisé par construction : sur sept semaines, il donne
      // les -77 % affichés par certains outils sur un portefeuille récent.
      const mesure = tri([
        { date: '2026-08-03', montant: d('-12308.80') },
        { date: '2026-09-22', montant: d('12288.15') },
      ]);
      expect(mesure.valeur).toBeNull();
      expect(mesure.motif).toMatch(/trop court/);
    });

    it('exige au moins deux mouvements', () => {
      expect(tri([{ date: '2026-01-01', montant: d('100') }]).valeur).toBeNull();
    });
  });
});

describe('drawdown', () => {
  it('mesure la plus forte baisse depuis un sommet', () => {
    const resultat = drawdown([
      point('2026-01-01', 100),
      point('2026-02-01', 120),
      point('2026-03-01', 90),
      point('2026-04-01', 110),
    ])!;

    // Sommet à 120, creux à 90 : -25 %.
    expect(resultat.perteMaximale).toBeCloseTo(-25);
    expect(resultat.dateCreux).toBe('2026-03-01');
    expect(resultat.dateSommet).toBe('2026-02-01');
  });

  it('distingue la baisse en cours de la pire baisse', () => {
    const resultat = drawdown([
      point('2026-01-01', 100),
      point('2026-02-01', 50),
      point('2026-03-01', 90),
    ])!;

    expect(resultat.perteMaximale).toBeCloseTo(-50);
    expect(resultat.baisseEnCours).toBeCloseTo(-10);
  });

  it('rend zéro sur une série qui ne baisse jamais', () => {
    const resultat = drawdown([point('2026-01-01', 100), point('2026-02-01', 120)])!;
    expect(resultat.perteMaximale).toBe(0);
    expect(resultat.baisseEnCours).toBe(0);
  });

  it('renvoie null sur une série trop courte', () => {
    expect(drawdown([point('2026-01-01', 100)])).toBeNull();
  });
});

describe('rendementsPeriodiques', () => {
  it('rend un rendement par sous-période', () => {
    const rendements = rendementsPeriodiques([
      point('2026-01-01', 100),
      point('2026-02-01', 110),
      point('2026-03-01', 99),
    ]);

    expect(rendements).toHaveLength(2);
    expect(rendements[0]).toBeCloseTo(10);
    expect(rendements[1]).toBeCloseTo(-10);
  });

  it('écarte les périodes partant d’une valorisation nulle', () => {
    expect(
      rendementsPeriodiques([point('2026-01-01', 0), point('2026-02-01', 100)]),
    ).toEqual([]);
  });
});

describe('volatilite', () => {
  it('rend zéro sur des rendements constants', () => {
    expect(volatilite([5, 5, 5, 5]).valeur).toBeCloseTo(0);
  });

  it('croît avec la dispersion', () => {
    const calme = volatilite([1, -1, 1, -1], 12).valeur!;
    const agitee = volatilite([10, -10, 10, -10], 12).valeur!;
    expect(agitee).toBeGreaterThan(calme);
  });

  it('annualise selon la fréquence', () => {
    const mensuelle = volatilite([1, -1, 1, -1], 12).valeur!;
    const quotidienne = volatilite([1, -1, 1, -1], 252).valeur!;
    expect(quotidienne).toBeGreaterThan(mensuelle);
  });

  it('refuse une série trop courte', () => {
    expect(volatilite([5]).valeur).toBeNull();
  });
});

describe('sharpe', () => {
  it('rapporte le rendement excédentaire au risque', () => {
    expect(sharpe(10, 20).valeur).toBeCloseTo(0.5);
    expect(sharpe(10, 20, 2).valeur).toBeCloseTo(0.4);
  });

  it('refuse une volatilité nulle', () => {
    // Diviser par zéro donnerait un ratio infini, affiché comme un exploit.
    expect(sharpe(10, 0).valeur).toBeNull();
    expect(sharpe(10, 0).motif).toMatch(/pas défini/);
  });
});

describe('scénario du portefeuille réel', () => {
  it('refuse toutes les mesures annualisées sur sept semaines', () => {
    // Les chiffres exacts du portefeuille : 12 308,80 investis le 03/08,
    // 12 288,15 au 22/09. Sept semaines.
    const flux = [
      { date: '2026-08-03', montant: d('-12308.80') },
      { date: '2026-09-22', montant: d('12288.15') },
    ];
    const points = [point('2026-08-03', '12308.80'), point('2026-09-22', '12288.15')];

    // Le TWR reste calculable : il n'est pas annualisé.
    const rendement = twr(points);
    expect(rendement.valeur).toBeCloseTo(-0.17, 1);

    // Mais toute annualisation est refusée, avec un motif lisible.
    expect(tri(flux).valeur).toBeNull();
    expect(annualiser(rendement.valeur!, joursEntre('2026-08-03', '2026-09-22')).valeur)
      .toBeNull();
  });
});
