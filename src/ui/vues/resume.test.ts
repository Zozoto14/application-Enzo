import { Decimal } from '../../core/money/decimal';
import { rejouer } from '../../core/portfolio/engine';
import { serieValorisation } from '../../core/performance/serie';
import { achat, compte, titre, versement } from '../../core/testing/fixtures';
import { construireResume, courbePerformance } from './resume';

const FINE = '\u202f';
const INSEC = '\u00a0';

function scenario() {
  const comptes = [compte()];
  const titres = [
    titre({ id: 'cw8', nom: 'Amundi MSCI World', ticker: 'CW8.PA' }),
    titre({ id: 'stla', nom: 'Stellantis', ticker: 'STLAP.PA' }),
  ];
  const transactions = [
    versement('2026-01-02', 1200),
    achat('2026-01-02', 1, 1000, 0, { titreId: 'cw8' }),
    achat('2026-01-02', 20, 10, 0, { titreId: 'stla' }),
  ];
  const historique = new Map([
    [
      'cw8',
      [
        { date: '2026-01-02', cloture: Decimal.de('1000') },
        { date: '2026-06-30', cloture: Decimal.de('1100') },
      ],
    ],
    [
      'stla',
      [
        { date: '2026-01-02', cloture: Decimal.de('10') },
        { date: '2026-06-30', cloture: Decimal.de('8') },
      ],
    ],
  ]);
  const etat = rejouer(comptes, transactions);
  return {
    etat,
    comptes,
    titres,
    transactions,
    cours: new Map([
      ['cw8', Decimal.de('1100')],
      ['stla', Decimal.de('8')],
    ]),
    points: serieValorisation({ comptes, transactions, cours: historique }),
    aujourdhui: '2026-06-30',
  };
}

describe('construireResume', () => {
  it('rapporte la valeur à ce qui a été versé', () => {
    const vue = construireResume(scenario());
    // 1 100 + 160 = 1 260 € pour 1 200 € versés.
    expect(vue.valeurTotale).toBe(`1${FINE}260,00${INSEC}€`);
    expect(vue.investi).toBe(`1${FINE}200,00${INSEC}€`);
    expect(vue.totalReturn).toEqual({ texte: `+60,00${INSEC}€`, tendance: 'hausse' });
    expect(vue.totalReturnPct.texte).toBe(`+5,00${INSEC}%`);
  });

  it('range les lignes gagnantes et perdantes séparément', () => {
    const vue = construireResume(scenario());
    expect(vue.top.map(ligne => ligne.nom)).toEqual(['Amundi MSCI World']);
    expect(vue.flop.map(ligne => ligne.nom)).toEqual(['Stellantis']);
    expect(vue.flop[0].variationPct.texte).toBe(`-20,00${INSEC}%`);
    expect(vue.top[0].symbole).toBe('CW8.PA');
  });

  it('fait une carte par compte', () => {
    const vue = construireResume(scenario());
    expect(vue.comptes).toHaveLength(1);
    expect(vue.comptes[0].type).toBe('PEA');
    expect(vue.comptes[0].depuis).toBe('15/03/2019');
    expect(vue.comptes[0].valeurTotale).toBe(`1${FINE}260,00${INSEC}€`);
    expect(vue.repartitionComptes).toEqual([
      { libelle: 'PEA Boursobank', valeur: 1260, texte: `1${FINE}260,00${INSEC}€` },
    ]);
  });

  it('trace la performance face à la référence sur la période choisie', () => {
    const vue = construireResume({
      ...scenario(),
      reference: {
        nom: 'S&P 500',
        serie: [
          { date: '2025-12-31', cloture: Decimal.de('100') },
          { date: '2026-06-30', cloture: Decimal.de('103') },
        ],
      },
    });
    const courbe = courbePerformance(vue, 'MAX', '2026-06-30');
    expect(courbe.portefeuille[courbe.portefeuille.length - 1].valeur).toBeCloseTo(5);
    expect(courbe.performance?.texte).toBe(`+5,00${INSEC}%`);
    // La référence part du même jour que le portefeuille.
    expect(courbe.reference[0]).toEqual({ date: '2026-01-02', valeur: 0 });
    expect(courbe.performanceReference?.texte).toBe(`+3,00${INSEC}%`);
  });

  it('annonce l’absence d’historique plutôt qu’une courbe à un point', () => {
    const base = scenario();
    const vue = construireResume({ ...base, points: base.points.slice(0, 1) });
    expect(vue.sansHistorique).toBe(true);
  });
});
