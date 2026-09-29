import { Decimal, d } from '../money/decimal';
import type { Position, Titre } from '../domain/types';
import { repartition, totaux, valoriser, valoriserPositions } from './valorisation';
import { titre } from '../testing/fixtures';

const position = (partiel: Partial<Position> = {}): Position => ({
  compteId: 'pea',
  titreId: 'air-liquide',
  quantite: d('15'),
  coutTotal: d('1657.5'),
  pru: d('110.5'),
  ...partiel,
});

describe('valoriser', () => {
  it('calcule la valeur de marché et la plus-value latente', () => {
    const valorisee = valoriser(position(), d('140'));

    expect(valorisee.valeurMarche.toString()).toBe('2100');
    expect(valorisee.plusValueLatente.toString()).toBe('442.5');
    expect(valorisee.plusValueLatentePct!.toFixed(2)).toBe('26.70');
  });

  it('produit une moins-value latente quand le cours est sous le PRU', () => {
    const valorisee = valoriser(position(), d('100'));

    expect(valorisee.plusValueLatente.toString()).toBe('-157.5');
    expect(valorisee.plusValueLatentePct!.estNegatif()).toBe(true);
  });

  it('renvoie un pourcentage nul plutôt que de diviser par zéro', () => {
    const valorisee = valoriser(position({ coutTotal: Decimal.ZERO }), d('140'));
    expect(valorisee.plusValueLatentePct).toBeNull();
  });
});

describe('valoriserPositions', () => {
  it('isole les positions dont le cours est inconnu au lieu de les valoriser à zéro', () => {
    const cours = new Map([['air-liquide', d('140')]]);
    const { valorisees, sansCours } = valoriserPositions(
      [position(), position({ titreId: 'inconnu' })],
      cours,
    );

    expect(valorisees).toHaveLength(1);
    expect(sansCours).toHaveLength(1);
    expect(sansCours[0].titreId).toBe('inconnu');
  });
});

describe('totaux', () => {
  it('additionne titres et liquidités', () => {
    const cours = new Map([
      ['air-liquide', d('140')],
      ['lvmh', d('90')],
    ]);
    const { valorisees } = valoriserPositions(
      [
        position(),
        position({
          titreId: 'lvmh',
          quantite: d('10'),
          coutTotal: d('1000'),
          pru: d('100'),
        }),
      ],
      cours,
    );

    const resultat = totaux(valorisees, [
      {
        compteId: 'pea',
        cash: d('500'),
        versementsCumules: d('5000'),
        retraitsCumules: Decimal.ZERO,
        dividendesPercus: Decimal.ZERO,
        fraisCumules: Decimal.ZERO,
      },
    ]);

    expect(resultat.valeurTitres.toString()).toBe('3000'); // 2100 + 900
    expect(resultat.cash.toString()).toBe('500');
    expect(resultat.valeurTotale.toString()).toBe('3500');
    expect(resultat.prixRevientTotal.toString()).toBe('2657.5');
    expect(resultat.plusValueLatente.toString()).toBe('342.5');
  });
});

describe('repartition', () => {
  const titres = new Map<string, Titre>([
    ['air-liquide', titre()],
    ['lvmh', titre({ id: 'lvmh', nom: 'LVMH', secteur: 'Luxe' })],
  ]);
  const cours = new Map([
    ['air-liquide', d('140')],
    ['lvmh', d('90')],
  ]);
  const { valorisees } = valoriserPositions(
    [
      position(),
      position({
        titreId: 'lvmh',
        quantite: d('10'),
        coutTotal: d('1000'),
        pru: d('100'),
      }),
    ],
    cours,
  );

  it('répartit par secteur, du plus lourd au plus léger', () => {
    const lignes = repartition(valorisees, titres, 'secteur');

    expect(lignes.map(l => l.cle)).toEqual(['Matériaux', 'Luxe']);
    expect(lignes[0].pourcentage.toFixed(2)).toBe('70.00');
    expect(lignes[1].pourcentage.toFixed(2)).toBe('30.00');
  });

  it('regroupe les titres sans secteur renseigné', () => {
    const sansSecteur = new Map<string, Titre>([
      ['air-liquide', titre({ secteur: undefined })],
      ['lvmh', titre({ id: 'lvmh', secteur: undefined })],
    ]);
    const lignes = repartition(valorisees, sansSecteur, 'secteur');

    expect(lignes).toHaveLength(1);
    expect(lignes[0].cle).toBe('Non renseigné');
    expect(lignes[0].pourcentage.toFixed(2)).toBe('100.00');
  });

  it('renvoie une répartition vide pour un portefeuille sans valeur', () => {
    expect(repartition([], titres, 'secteur')).toEqual([]);
  });
});
