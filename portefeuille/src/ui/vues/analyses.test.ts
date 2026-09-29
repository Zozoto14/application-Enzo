import { Decimal } from '../../core/money/decimal';
import { rejouer } from '../../core/portfolio/engine';
import { serieValorisation } from '../../core/performance/serie';
import { achat, compte, dividende, retrait, titre, versement } from '../../core/testing/fixtures';
import {
  construireFluxAvance,
  construirePerformancesAvance,
  construirePositions,
  construireRisqueAvance,
  courbeAction,
  type EntreesAnalyse,
  histogrammeRendements,
} from './analyses';

const INSEC = ' ';

function jours(depart: string, nombre: number, cours: (index: number) => number) {
  const debut = Date.parse(`${depart}T00:00:00Z`);
  return Array.from({ length: nombre }, (_, index) => ({
    date: new Date(debut + index * 86_400_000).toISOString().slice(0, 10),
    cloture: Decimal.de(cours(index).toFixed(4)),
  }));
}

function entrees(): EntreesAnalyse {
  const comptes = [compte()];
  const titres = [
    titre({ id: 'cw8', nom: 'Amundi MSCI World', ticker: 'CW8.PA' }),
    titre({ id: 'stla', nom: 'Stellantis', ticker: 'STLAP.PA', secteur: 'Automobile' }),
  ];
  const transactions = [
    versement('2025-01-01', 2000),
    achat('2025-01-01', 1, 1000, 0, { titreId: 'cw8' }),
    achat('2025-01-01', 50, 20, 0, { titreId: 'stla' }),
    dividende('2025-05-15', 30, { titreId: 'stla' }),
    versement('2025-06-01', 500),
    retrait('2025-08-01', 100),
  ];
  const historique = new Map([
    ['cw8', jours('2025-01-01', 300, i => 1000 * (1 + i / 1000 + Math.sin(i / 9) * 0.02))],
    ['stla', jours('2025-01-01', 300, i => 20 * (1 - i / 1500 + Math.cos(i / 5) * 0.05))],
  ]);
  const derniers = new Map([
    ['cw8', historique.get('cw8')![299].cloture],
    ['stla', historique.get('stla')![299].cloture],
  ]);
  return {
    etat: rejouer(comptes, transactions),
    comptes,
    titres,
    transactions,
    cours: derniers,
    historique,
    points: serieValorisation({ comptes, transactions, cours: historique }),
    indice: { nom: 'S&P 500', serie: jours('2024-12-01', 330, i => 100 * (1 + i / 800)) },
    aujourdhui: '2025-10-27',
  };
}

describe('positions', () => {
  it('liste les lignes, la plus lourde d’abord, avec leur poids', () => {
    const vue = construirePositions(entrees());
    expect(vue.nombreLignes).toBe('2 ligne(s)');
    expect(vue.lignes[0].nom).toBe('Amundi MSCI World');
    const poids = vue.lignes.map(ligne => ligne.brut.poids);
    expect(poids[0] + poids[1]).toBeCloseTo(100);
    expect(vue.lignes[1].variationJour).not.toBeNull();
    expect(vue.repartition.secteurs.map(part => part.libelle)).toContain('Automobile');
  });

  it('suit le poids de chaque ligne dans le temps', () => {
    const vue = construirePositions(entrees());
    const noms = vue.poidsDansLeTemps.map(serie => serie.nom);
    expect(noms).toContain('Stellantis');
    for (const serie of vue.poidsDansLeTemps) {
      for (const point of serie.points) {
        expect(point.valeur).toBeGreaterThanOrEqual(0);
        expect(point.valeur).toBeLessThanOrEqual(100.0001);
      }
    }
  });
});

describe('risque avancé', () => {
  it('produit métriques, drawdown et matrice de corrélation', () => {
    const vue = construireRisqueAvance(entrees());
    expect(vue.metriques.map(m => m.libelle)).toContain('Ratio de Sortino');
    expect(vue.drawdown.length).toBeGreaterThan(100);
    expect(vue.matrice.noms).toEqual(['CW8', 'STLAP']);
    expect(vue.matrice.valeurs[0][0]).toBe(1);
    expect(vue.matrice.valeurs[0][1]).not.toBeNull();
    expect(vue.frontiere?.actifs).toHaveLength(2);
  });
});

describe('performances avancées', () => {
  it('rebase la période et range les rendements par mois', () => {
    const vue = construirePerformancesAvance(entrees(), 'MAX');
    expect(vue.twr[0].valeur).toBe(0);
    expect(vue.twrReference[0].valeur).toBe(0);
    expect(vue.mensuels[0].annee).toBe('2025');
    expect(vue.mensuels[0].mois[0]).not.toBeNull();
    expect(vue.mensuels[0].mois[11]).toBeNull();
    expect(vue.metriques.find(m => m.libelle === 'Dépôts nets sur la période')?.valeur).toBe(
      `400,00${INSEC}€`,
    );
    expect(vue.titresVsReference.mieux.length + vue.titresVsReference.moins.length).toBe(2);
  });

  it('marque les achats sur la courbe d’une ligne', () => {
    const courbe = courbeAction(entrees(), 'stla', 'MAX');
    expect(courbe.marqueurs).toEqual([{ date: '2025-01-01', valeur: 0, type: 'achat' }]);
    expect(courbe.reference[0].valeur).toBe(0);
  });
});

describe('flux avancés', () => {
  it('répartit versements et retraits par mois et par année', () => {
    const { transactions, comptes } = entrees();
    const vue = construireFluxAvance(transactions, comptes, undefined, '2025-10-27');
    expect(vue.annees).toEqual(['2025']);
    expect(vue.parMois[0].valeur).toBe(2000);
    expect(vue.parMois[7].negatif).toBe(100);
    // 2 500 € versés sur dix mois écoulés.
    expect(vue.moyenneMensuelle?.valeur).toBe(250);
    expect(vue.cumul[vue.cumul.length - 1]).toEqual({ date: '2025-10-27', valeur: 2400 });
    expect(vue.fluxNet).toBe(`+2${' '}400,00${INSEC}€`);
  });
});

describe('histogrammeRendements', () => {
  it('range chaque mois dans sa tranche de deux points', () => {
    expect(histogrammeRendements([-2.5, -0.9, 0.9, 1.2, 5.4])).toEqual([
      { libelle: '-4 à -2 %', debut: -4, nombre: 1 },
      { libelle: '-2 à 0 %', debut: -2, nombre: 1 },
      { libelle: '0 à +2 %', debut: 0, nombre: 2 },
      { libelle: '+2 à +4 %', debut: 2, nombre: 0 },
      { libelle: '+4 à +6 %', debut: 4, nombre: 1 },
    ]);
    expect(histogrammeRendements([])).toEqual([]);
  });
});
