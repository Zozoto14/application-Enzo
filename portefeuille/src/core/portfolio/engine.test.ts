import { d } from '../money/decimal';
import { ErreurTransaction, plusValuesParAnnee, rejouer } from './engine';
import {
  achat,
  compte,
  dividende,
  frais,
  retrait,
  versement,
  vente,
} from '../testing/fixtures';

const pea = compte();

describe('rejouer', () => {
  describe('constitution du prix de revient', () => {
    it('calcule le PRU en moyenne pondérée sur plusieurs achats', () => {
      const etat = rejouer(
        [pea],
        [achat('2024-01-10', 10, 100, 5), achat('2024-02-10', 10, 120, 5)],
      );

      const [position] = etat.positions;
      expect(position.quantite.toString()).toBe('20');
      // (10 x 100 + 5) + (10 x 120 + 5) = 2210
      expect(position.coutTotal.toString()).toBe('2210');
      expect(position.pru.toString()).toBe('110.5');
    });

    it('intègre les frais d’acquisition au prix de revient', () => {
      const sansFrais = rejouer([pea], [achat('2024-01-10', 10, 100, 0)]);
      const avecFrais = rejouer([pea], [achat('2024-01-10', 10, 100, 20)]);

      expect(sansFrais.positions[0].pru.toString()).toBe('100');
      expect(avecFrais.positions[0].pru.toString()).toBe('102');
    });

    it('laisse le PRU inchangé après une vente partielle', () => {
      const etat = rejouer(
        [pea],
        [
          achat('2024-01-10', 10, 100, 5),
          achat('2024-02-10', 10, 120, 5),
          vente('2024-06-10', 5, 130, 5),
        ],
      );

      const [position] = etat.positions;
      expect(position.quantite.toString()).toBe('15');
      expect(position.pru.toString()).toBe('110.5');
      // 2210 - (110.5 x 5) = 1657.5
      expect(position.coutTotal.toString()).toBe('1657.5');
    });

    it('rejoue les transactions dans l’ordre chronologique, pas dans l’ordre de saisie', () => {
      const desordre = rejouer(
        [pea],
        [achat('2024-02-10', 10, 120, 5), achat('2024-01-10', 10, 100, 5)],
      );
      expect(desordre.positions[0].pru.toString()).toBe('110.5');
    });
  });

  describe('plus-values réalisées', () => {
    it('calcule la plus-value nette de frais à l’achat comme à la vente', () => {
      const etat = rejouer(
        [pea],
        [
          achat('2024-01-10', 10, 100, 5),
          achat('2024-02-10', 10, 120, 5),
          vente('2024-06-10', 5, 130, 5),
        ],
      );

      expect(etat.cessions).toHaveLength(1);
      const [cession] = etat.cessions;
      expect(cession.produitNet.toString()).toBe('645'); // 5 x 130 - 5
      expect(cession.prixRevient.toString()).toBe('552.5'); // 110.5 x 5
      expect(cession.plusValue.toString()).toBe('92.5');
      expect(cession.annee).toBe(2024);
    });

    it('produit une moins-value quand le cours a baissé', () => {
      const etat = rejouer(
        [pea],
        [achat('2024-01-10', 10, 100, 5), vente('2024-06-10', 10, 80, 5)],
      );

      // 795 encaissés contre 1005 investis
      expect(etat.cessions[0].plusValue.toString()).toBe('-210');
    });

    it('solde la position quand tout est vendu', () => {
      const etat = rejouer(
        [pea],
        [achat('2024-01-10', 10, 100, 5), vente('2024-06-10', 10, 130, 5)],
      );

      expect(etat.positions).toHaveLength(0);
      expect(etat.positionsSoldees).toHaveLength(1);
      expect(etat.positionsSoldees[0].quantite.estZero()).toBe(true);
      expect(etat.positionsSoldees[0].coutTotal.estZero()).toBe(true);
    });

    it('agrège les plus-values par année civile', () => {
      const etat = rejouer(
        [pea],
        [
          achat('2023-01-10', 20, 100, 0),
          vente('2023-06-10', 5, 120, 0), // +100
          vente('2024-06-10', 5, 90, 0), // -50
          vente('2024-09-10', 5, 130, 0), // +150
        ],
      );

      const parAnnee = plusValuesParAnnee(etat.cessions);
      expect(parAnnee.get(2023)!.toString()).toBe('100');
      expect(parAnnee.get(2024)!.toString()).toBe('100');
    });
  });

  describe('suivi du cash', () => {
    it('reflète versements, achats, ventes, dividendes, frais et retraits', () => {
      const etat = rejouer(
        [pea],
        [
          versement('2024-01-05', 10000),
          achat('2024-01-10', 10, 100, 5), // -1005
          achat('2024-02-10', 10, 120, 5), // -1205
          vente('2024-06-10', 5, 130, 5), // +645
          dividende('2024-07-01', 30), // +30
          frais('2024-08-01', 12), // -12
          retrait('2024-09-01', 500), // -500
        ],
      );

      const solde = etat.comptes.get('pea')!;
      expect(solde.cash.toString()).toBe('7953');
      expect(solde.versementsCumules.toString()).toBe('10000');
      expect(solde.retraitsCumules.toString()).toBe('500');
      expect(solde.dividendesPercus.toString()).toBe('30');
      expect(solde.fraisCumules.toString()).toBe('27'); // 5 + 5 + 5 + 12
    });

    it('sépare les comptes', () => {
      const cto = compte({ id: 'cto', type: 'CTO', nom: 'CTO' });
      const etat = rejouer(
        [pea, cto],
        [
          versement('2024-01-05', 1000),
          versement('2024-01-05', 3000, { compteId: 'cto' }),
        ],
      );

      expect(etat.comptes.get('pea')!.cash.toString()).toBe('1000');
      expect(etat.comptes.get('cto')!.cash.toString()).toBe('3000');
    });
  });

  describe('devises étrangères', () => {
    const cto = compte({ id: 'cto', type: 'CTO', nom: 'CTO', devise: 'EUR' });

    it('convertit au taux figé sur la transaction', () => {
      const etat = rejouer(
        [cto],
        [
          achat('2024-01-10', 10, 200, 2, {
            compteId: 'cto',
            titreId: 'apple',
            devise: 'USD',
            tauxChange: '0.9',
          }),
        ],
      );

      // (10 x 200 + 2) x 0,9 = 1801,80
      expect(etat.positions[0].coutTotal.toString()).toBe('1801.8');
      expect(etat.positions[0].pru.toString()).toBe('180.18');
      expect(etat.comptes.get('cto')!.cash.toString()).toBe('-1801.8');
    });

    it('refuse une devise étrangère sans taux de change', () => {
      expect(() =>
        rejouer(
          [cto],
          [achat('2024-01-10', 10, 200, 2, { compteId: 'cto', devise: 'USD' })],
        ),
      ).toThrow(/taux de change manquant/);
    });
  });

  describe('garde-fous de saisie', () => {
    it('refuse de vendre plus que la quantité détenue', () => {
      expect(() =>
        rejouer([pea], [achat('2024-01-10', 5, 100, 0), vente('2024-06-10', 10, 130, 0)]),
      ).toThrow(ErreurTransaction);
    });

    it('refuse de vendre un titre jamais acheté', () => {
      expect(() => rejouer([pea], [vente('2024-06-10', 1, 130, 0)])).toThrow(
        /0 sont détenus/,
      );
    });

    it('refuse une quantité nulle ou négative', () => {
      expect(() => rejouer([pea], [achat('2024-01-10', 0, 100, 0)])).toThrow(
        /quantité achetée/,
      );
    });

    it('refuse une transaction sur un compte inconnu', () => {
      expect(() =>
        rejouer([pea], [versement('2024-01-05', 100, { compteId: 'fantome' })]),
      ).toThrow(/compte inconnu/);
    });

    it('accepte un solde de cash négatif sans le masquer', () => {
      // Un import CSV incomplet peut produire ce cas : mieux vaut un solde
      // négatif visible qu’un blocage de la saisie.
      const etat = rejouer([pea], [achat('2024-01-10', 10, 100, 0)]);
      expect(etat.comptes.get('pea')!.cash.toString()).toBe('-1000');
    });
  });

  it('ne produit aucun état pour un journal vide', () => {
    const etat = rejouer([pea], []);
    expect(etat.positions).toHaveLength(0);
    expect(etat.cessions).toHaveLength(0);
    expect(etat.comptes.get('pea')!.cash.eq(d('0'))).toBe(true);
  });
});
