import { d } from '../money/decimal';
import { achat, compte, retrait, versement, vente } from '../testing/fixtures';
import { twr } from './rendements';
import {
  coursALaDate,
  datesDeValorisation,
  fluxPourTri,
  serieValorisation,
  type HistoriqueCours,
} from './serie';

const pea = compte();

const cours = (points: Array<[string, string]>): HistoriqueCours =>
  new Map([['air-liquide', points.map(([date, cloture]) => ({ date, cloture: d(cloture) }))]]);

describe('coursALaDate', () => {
  const historique = [
    { date: '2026-01-10', cloture: d('100') },
    { date: '2026-02-10', cloture: d('120') },
  ];

  it('retient le dernier cours connu', () => {
    expect(coursALaDate(historique, '2026-01-15')!.toString()).toBe('100');
    expect(coursALaDate(historique, '2026-02-10')!.toString()).toBe('120');
    expect(coursALaDate(historique, '2026-06-01')!.toString()).toBe('120');
  });

  it('ne regarde jamais vers l’avenir', () => {
    // Utiliser un cours postérieur ferait apparaître une performance que
    // l'on ne pouvait pas connaître à cette date.
    expect(coursALaDate(historique, '2026-01-09')).toBeUndefined();
  });

  it('rend undefined sur un historique vide', () => {
    expect(coursALaDate([], '2026-01-10')).toBeUndefined();
  });
});

describe('datesDeValorisation', () => {
  it('réunit dates de transaction et dates de cours, triées', () => {
    const dates = datesDeValorisation({
      comptes: [pea],
      transactions: [versement('2026-01-05', 1000), achat('2026-01-10', 5, 100, 0)],
      cours: cours([
        ['2026-02-10', '110'],
        ['2026-01-10', '100'],
      ]),
    });

    expect(dates).toEqual(['2026-01-05', '2026-01-10', '2026-02-10']);
  });

  it('ne duplique pas une date partagée', () => {
    const dates = datesDeValorisation({
      comptes: [pea],
      transactions: [achat('2026-01-10', 5, 100, 0)],
      cours: cours([['2026-01-10', '100']]),
    });
    expect(dates).toEqual(['2026-01-10']);
  });
});

describe('serieValorisation', () => {
  it('valorise titres et liquidités à chaque date', () => {
    const points = serieValorisation({
      comptes: [pea],
      transactions: [versement('2026-01-05', 1000), achat('2026-01-10', 5, 100, 0)],
      cours: cours([
        ['2026-01-10', '100'],
        ['2026-02-10', '120'],
      ]),
    });

    expect(points.map(p => p.date)).toEqual(['2026-01-05', '2026-01-10', '2026-02-10']);
    // 1 000 de liquidités, aucun titre.
    expect(points[0].valeurTotale.toString()).toBe('1000');
    // 5 titres à 100 + 500 de liquidités restantes.
    expect(points[1].valeurTotale.toString()).toBe('1000');
    // Les titres montent à 120 : 600 + 500.
    expect(points[2].valeurTotale.toString()).toBe('1100');
  });

  it('isole les flux externes de chaque date', () => {
    const points = serieValorisation({
      comptes: [pea],
      transactions: [
        versement('2026-01-05', 1000),
        achat('2026-01-10', 5, 100, 0),
        versement('2026-02-10', 500),
      ],
      cours: cours([
        ['2026-01-10', '100'],
        ['2026-02-10', '100'],
      ]),
    });

    expect(points[0].fluxExterne.toString()).toBe('1000');
    // Un achat déplace de l'argent sans en faire entrer : flux externe nul.
    expect(points[1].fluxExterne.toString()).toBe('0');
    expect(points[2].fluxExterne.toString()).toBe('500');
  });

  it('compte un retrait en flux négatif', () => {
    const points = serieValorisation({
      comptes: [pea],
      transactions: [versement('2026-01-05', 1000), retrait('2026-02-05', 200)],
      cours: new Map(),
    });

    expect(points[1].fluxExterne.toString()).toBe('-200');
  });

  it('écarte une date où un titre détenu n’a pas de cours', () => {
    // Le valoriser à zéro creuserait un faux trou dans le graphique.
    const points = serieValorisation({
      comptes: [pea],
      transactions: [achat('2026-01-10', 5, 100, 0)],
      cours: cours([['2026-02-10', '120']]),
    });

    expect(points.map(p => p.date)).toEqual(['2026-02-10']);
  });

  it('valorise un portefeuille entièrement vendu sans exiger de cours', () => {
    const points = serieValorisation({
      comptes: [pea],
      transactions: [
        versement('2026-01-05', 1000),
        achat('2026-01-10', 5, 100, 0),
        vente('2026-03-10', 5, 120, 0),
      ],
      cours: cours([['2026-01-10', '100']]),
    });

    const dernier = points[points.length - 1];
    expect(dernier.date).toBe('2026-03-10');
    // 1 000 - 500 + 600 de liquidités, plus aucun titre.
    expect(dernier.valeurTotale.toString()).toBe('1100');
  });

  it('alimente directement le calcul du TWR', () => {
    const points = serieValorisation({
      comptes: [pea],
      transactions: [versement('2026-01-05', 1000), achat('2026-01-10', 10, 100, 0)],
      cours: cours([
        ['2026-01-10', '100'],
        ['2026-02-10', '110'],
      ]),
    });

    // 1 000 -> 1 100 sans flux : +10 %.
    expect(twr(points).valeur).toBeCloseTo(10);
  });

  it('rend une série vide sans donnée', () => {
    expect(
      serieValorisation({ comptes: [pea], transactions: [], cours: new Map() }),
    ).toEqual([]);
  });
});

describe('fluxPourTri', () => {
  it('inverse le signe des versements, selon la convention du TRI', () => {
    // Un versement sort de votre poche : il est négatif.
    const flux = fluxPourTri(
      [versement('2026-01-05', 1000), retrait('2026-06-05', 200)],
      d('900'),
      '2026-12-31',
    );

    expect(flux[0].montant.toString()).toBe('-1000');
    expect(flux[1].montant.toString()).toBe('200');
    expect(flux[2].montant.toString()).toBe('900');
  });

  it('ajoute la valeur finale comme rentrée fictive', () => {
    const flux = fluxPourTri([versement('2026-01-05', 1000)], d('1100'), '2026-12-31');

    expect(flux).toHaveLength(2);
    expect(flux[1]).toEqual({ date: '2026-12-31', montant: d('1100') });
  });

  it('omet une valeur finale nulle', () => {
    const flux = fluxPourTri([versement('2026-01-05', 1000)], d('0'), '2026-12-31');
    expect(flux).toHaveLength(1);
  });

  it('ignore achats, ventes et dividendes', () => {
    // Ils déplacent l'argent à l'intérieur du portefeuille sans le faire
    // entrer ni sortir : le TRI ne les compte pas.
    const flux = fluxPourTri(
      [versement('2026-01-05', 1000), achat('2026-01-10', 5, 100, 0)],
      d('600'),
      '2026-12-31',
    );

    expect(flux).toHaveLength(2);
  });

  it('trie par date', () => {
    const flux = fluxPourTri(
      [versement('2026-06-05', 500), versement('2026-01-05', 1000)],
      d('1600'),
      '2026-12-31',
    );

    expect(flux.map(f => f.date)).toEqual(['2026-01-05', '2026-06-05', '2026-12-31']);
  });
});
