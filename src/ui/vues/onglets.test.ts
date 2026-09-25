import { d } from '../../core/money/decimal';
import { rejouer } from '../../core/portfolio/engine';
import { serieValorisation } from '../../core/performance/serie';
import { achat, compte, retrait, versement, vente } from '../../core/testing/fixtures';
import { construireFlux, construireImpots, construirePerformance } from './onglets';

const INSEC = ' ';
const FINE = ' ';
const pea = compte({ dateOuverture: '2019-03-15' });
const cto = compte({ id: 'cto', type: 'CTO', nom: 'Compte-titres' });

const cours = (points: Array<[string, string]>) =>
  new Map([
    ['air-liquide', points.map(([date, cloture]) => ({ date, cloture: d(cloture) }))],
  ]);

describe('construirePerformance', () => {
  describe('historique insuffisant', () => {
    it('explique qu’aucune valorisation n’est connue', () => {
      const vue = construirePerformance({ points: [], transactions: [] });

      expect(vue.nombrePoints).toBe(0);
      expect(vue.messageHistorique).toMatch(/Rafraîchissez les cours/);
      expect(vue.twr.valeur).toBeNull();
    });

    it('explique qu’un seul relevé ne suffit pas', () => {
      // Cas du portefeuille qui vient d'être importé.
      const transactions = [versement('2026-09-22', 1000), achat('2026-09-22', 5, 100, 0)];
      const points = serieValorisation({
        comptes: [pea],
        transactions,
        cours: cours([['2026-09-22', '100']]),
      });

      const vue = construirePerformance({ points, transactions });
      expect(vue.nombrePoints).toBe(1);
      expect(vue.messageHistorique).toMatch(/entre deux relevés/);
      expect(vue.tri.motif).toBeDefined();
    });
  });

  describe('historique exploitable', () => {
    const transactions = [versement('2026-01-05', 1000), achat('2026-01-10', 10, 100, 0)];
    const points = serieValorisation({
      comptes: [pea],
      transactions,
      cours: cours([
        ['2026-01-10', '100'],
        ['2026-03-10', '110'],
      ]),
    });

    it('calcule le TWR', () => {
      const vue = construirePerformance({ points, transactions });
      expect(vue.twr.valeur).toBe(`+10,00${INSEC}%`);
    });

    it('refuse d’annualiser une période trop courte, avec le motif', () => {
      // Janvier à mars : moins de trois mois.
      const vue = construirePerformance({ points, transactions });

      expect(vue.rendementAnnualise.valeur).toBeNull();
      expect(vue.rendementAnnualise.motif).toMatch(/trop courte/);
    });

    it('prépare les points du graphique', () => {
      const vue = construirePerformance({ points, transactions });

      expect(vue.points).toHaveLength(points.length);
      expect(vue.points[0].date).toBe('05/01/2026');
      // Le plus bas vaut 0, le plus haut vaut 1.
      const fractions = vue.points.map(p => p.fraction);
      expect(Math.min(...fractions)).toBe(0);
      expect(Math.max(...fractions)).toBe(1);
    });

    it('mesure le drawdown', () => {
      const baissier = serieValorisation({
        comptes: [pea],
        transactions,
        cours: cours([
          ['2026-01-10', '100'],
          ['2026-02-10', '60'],
          ['2026-03-10', '90'],
        ]),
      });
      const vue = construirePerformance({ points: baissier, transactions });

      expect(vue.perteMaximale.valeur).toBeDefined();
      expect(vue.dateCreux).toBe('10/02/2026');
    });
  });

  it('ne divise pas par zéro sur une valorisation plate', () => {
    const transactions = [versement('2026-01-05', 1000)];
    const points = serieValorisation({
      comptes: [pea],
      transactions: [...transactions, versement('2026-02-05', 0.0001)],
      cours: new Map(),
    });
    const vue = construirePerformance({ points, transactions });

    expect(vue.points.every(point => Number.isFinite(point.fraction))).toBe(true);
  });
});

describe('construireFlux', () => {
  const transactions = [
    versement('2026-01-05', 10000),
    versement('2026-02-05', 500),
    retrait('2026-03-05', 200),
    achat('2026-01-10', 5, 100, 0),
  ];

  it('totalise versements, retraits et flux net', () => {
    const vue = construireFlux(transactions, [pea]);

    expect(vue.versementsTotal).toBe(`10${FINE}500,00${INSEC}€`);
    expect(vue.retraitsTotal).toBe(`200,00${INSEC}€`);
    expect(vue.fluxNet).toBe(`+10${FINE}300,00${INSEC}€`);
    expect(vue.tendanceNet).toBe('hausse');
  });

  it('ignore les achats, qui ne font pas entrer d’argent', () => {
    // Un achat déplace de l'argent à l'intérieur du portefeuille.
    const vue = construireFlux(transactions, [pea]);
    expect(vue.mouvements).toHaveLength(3);
  });

  it('liste les mouvements du plus récent au plus ancien', () => {
    const vue = construireFlux(transactions, [pea]);

    expect(vue.mouvements.map(m => m.date)).toEqual([
      '05/03/2026',
      '05/02/2026',
      '05/01/2026',
    ]);
    expect(vue.mouvements[0].type).toBe('Retrait');
    expect(vue.mouvements[0].montant).toBe(`-200,00${INSEC}€`);
    expect(vue.mouvements[0].tendance).toBe('baisse');
  });

  it('nomme le compte de chaque mouvement', () => {
    const vue = construireFlux(transactions, [pea]);
    expect(vue.mouvements[0].compte).toBe('PEA Boursobank');
  });

  it('regroupe par année', () => {
    const surDeuxAns = [...transactions, versement('2025-06-05', 3000)];
    const vue = construireFlux(surDeuxAns, [pea]);

    expect(vue.parAnnee.map(ligne => ligne.periode)).toEqual(['2026', '2025']);
    expect(vue.parAnnee[1].versements).toBe(`3${FINE}000,00${INSEC}€`);
    expect(vue.parAnnee[0].fraction).toBe(1);
  });

  it('calcule la moyenne mensuelle sur la période réellement couverte', () => {
    // 10 500 versés sur trois mois font 3 500 par mois, pas 875 : diviser par
    // douze donnerait un versement quatre fois trop faible.
    const vue = construireFlux(transactions, [pea]);
    expect(vue.moyenneMensuelle).toBe(`3${FINE}500,00${INSEC}€`);
  });

  it('signale l’absence de mouvement', () => {
    const vue = construireFlux([], [pea]);
    expect(vue.aucunMouvement).toBe(true);
    expect(vue.moyenneMensuelle).toBe(`0,00${INSEC}€`);
  });
});

describe('construireImpots', () => {
  const base = {
    comptes: [pea],
    aujourdhui: '2026-06-15',
  };

  it('suit le plafond de versement du PEA', () => {
    const transactions = [versement('2026-01-05', 30000)];
    const etat = rejouer([pea], transactions);
    const vue = construireImpots({ ...base, etat, cessions: etat.cessions });

    const plafond = vue.comptes[0].plafond!;
    expect(plafond.verse).toBe(`30${FINE}000,00${INSEC}€`);
    expect(plafond.restant).toBe(`120${FINE}000,00${INSEC}€`);
    expect(plafond.fraction).toBeCloseTo(0.2);
  });

  it('signale un dépassement de plafond', () => {
    const transactions = [versement('2026-01-05', 160000)];
    const etat = rejouer([pea], transactions);
    const vue = construireImpots({ ...base, etat, cessions: etat.cessions });

    expect(vue.comptes[0].plafond!.depassement).toBe(`10${FINE}000,00${INSEC}€`);
  });

  it('dit qu’un PEA de plus de cinq ans est exonéré d’impôt sur le revenu', () => {
    const etat = rejouer([pea], []);
    const vue = construireImpots({ ...base, etat, cessions: [] });

    expect(vue.comptes[0].anciennete).toBe('7 ans');
    expect(vue.comptes[0].situationFiscale).toMatch(/échappent à l/);
    // Le piège à ne pas taire.
    expect(vue.comptes[0].situationFiscale).toMatch(/17,2/);
    expect(vue.comptes[0].venteImposable).toBe(false);
  });

  it('avertit qu’un PEA jeune serait taxé et fermé', () => {
    const jeune = compte({ dateOuverture: '2024-01-01' });
    const etat = rejouer([jeune], []);
    const vue = construireImpots({
      etat,
      comptes: [jeune],
      cessions: [],
      aujourdhui: '2026-06-15',
    });

    expect(vue.comptes[0].situationFiscale).toMatch(/30 % et fermerait le plan/);
  });

  it('dit qu’un compte-titres est imposable à chaque vente', () => {
    const etat = rejouer([cto], []);
    const vue = construireImpots({
      etat,
      comptes: [cto],
      cessions: [],
      aujourdhui: '2026-06-15',
    });

    expect(vue.comptes[0].plafond).toBeUndefined();
    expect(vue.comptes[0].venteImposable).toBe(true);
    expect(vue.comptes[0].situationFiscale).toMatch(/30 %/);
  });

  describe('plus-values réalisées', () => {
    it('n’estime aucun impôt sur les cessions d’un PEA', () => {
      // Une vente dans un PEA ne déclenche rien : afficher un impôt serait faux.
      const transactions = [achat('2026-01-10', 10, 100, 0), vente('2026-06-10', 10, 130, 0)];
      const etat = rejouer([pea], transactions);
      const vue = construireImpots({ ...base, etat, cessions: etat.cessions });

      expect(vue.annees[0].plusValue).toBe(`+300,00${INSEC}€`);
      expect(vue.annees[0].impotEstime).toBeUndefined();
    });

    it('estime l’impôt sur les cessions d’un compte-titres', () => {
      const transactions = [
        achat('2026-01-10', 10, 100, 0, { compteId: 'cto' }),
        vente('2026-06-10', 10, 130, 0, { compteId: 'cto' }),
      ];
      const etat = rejouer([cto], transactions);
      const vue = construireImpots({
        etat,
        comptes: [cto],
        cessions: etat.cessions,
        aujourdhui: '2026-06-15',
      });

      // 300 de gain x 30 %
      expect(vue.annees[0].impotEstime).toBe(`90,00${INSEC}€`);
    });

    it('n’estime pas d’impôt sur une moins-value', () => {
      const transactions = [
        achat('2026-01-10', 10, 100, 0, { compteId: 'cto' }),
        vente('2026-06-10', 10, 80, 0, { compteId: 'cto' }),
      ];
      const etat = rejouer([cto], transactions);
      const vue = construireImpots({
        etat,
        comptes: [cto],
        cessions: etat.cessions,
        aujourdhui: '2026-06-15',
      });

      expect(vue.annees[0].tendance).toBe('baisse');
      expect(vue.annees[0].impotEstime).toBeUndefined();
    });

    it('signale l’absence de cession', () => {
      const etat = rejouer([pea], []);
      expect(construireImpots({ ...base, etat, cessions: [] }).aucuneCession).toBe(true);
    });
  });

  describe('rappel de fin d’année', () => {
    const transactions = [
      achat('2026-01-10', 10, 100, 0, { compteId: 'cto' }),
      vente('2026-06-10', 10, 130, 0, { compteId: 'cto' }),
    ];

    it('apparaît en novembre sur un gain réalisé', () => {
      const etat = rejouer([cto], transactions);
      const vue = construireImpots({
        etat,
        comptes: [cto],
        cessions: etat.cessions,
        aujourdhui: '2026-11-20',
      });

      expect(vue.rappelFinAnnee).toMatch(/31 décembre/);
    });

    it('reste muet en juin', () => {
      const etat = rejouer([cto], transactions);
      const vue = construireImpots({
        etat,
        comptes: [cto],
        cessions: etat.cessions,
        aujourdhui: '2026-06-15',
      });

      expect(vue.rappelFinAnnee).toBeUndefined();
    });
  });
});
