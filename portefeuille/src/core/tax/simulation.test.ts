import { d } from '../money/decimal';
import type { Position } from '../domain/types';
import { compte } from '../testing/fixtures';
import { ErreurSimulation, simulerVente } from './simulation';

const position: Position = {
  compteId: 'pea',
  titreId: 'air-liquide',
  quantite: d('10'),
  coutTotal: d('1000'),
  pru: d('100'),
};

const parametres = {
  quantite: d('5'),
  prixUnitaire: d('150'),
  frais: d('3'),
  date: '2024-06-01',
};

describe('simulerVente', () => {
  describe('sur un compte-titres ordinaire', () => {
    const cto = compte({ id: 'cto', type: 'CTO' });

    it('chiffre le net réellement encaissé après impôt', () => {
      const resultat = simulerVente(cto, position, parametres);

      expect(resultat.produitBrut.toString()).toBe('750');
      expect(resultat.produitNet.toString()).toBe('747');
      expect(resultat.prixRevient.toString()).toBe('500');
      expect(resultat.plusValue.toString()).toBe('247');
      expect(resultat.plusValuePct!.toFixed(2)).toBe('49.40');
      expect(resultat.impot.total.toString()).toBe('74.1'); // 247 x 30 %
      expect(resultat.netApresImpot.toString()).toBe('672.9');
      expect(resultat.impositionDifferee).toBe(false);
    });

    it('ne déclenche aucun impôt sur une vente en moins-value', () => {
      const resultat = simulerVente(cto, position, { ...parametres, prixUnitaire: d('80') });

      expect(resultat.plusValue.toString()).toBe('-103'); // 397 - 500
      expect(resultat.impot.total.estZero()).toBe(true);
      expect(resultat.netApresImpot.toString()).toBe('397');
    });

    it('tient compte de l’option pour le barème', () => {
      const resultat = simulerVente(cto, position, parametres, {
        option: 'BAREME',
        tauxMarginal: d('0.30'),
      });

      // 247 x 30 % + 247 x 17,2 %
      expect(resultat.impot.total.toString()).toBe('116.584');
    });
  });

  describe('sur un PEA', () => {
    const pea = compte();

    it('n’impose pas la vente : l’impôt est différé au retrait', () => {
      const resultat = simulerVente(pea, position, parametres);

      expect(resultat.plusValue.toString()).toBe('247');
      expect(resultat.impot.total.estZero()).toBe(true);
      expect(resultat.netApresImpot.toString()).toBe('747');
      expect(resultat.impositionDifferee).toBe(true);
      expect(resultat.impot.explication).toMatch(/aucune imposition immédiate/);
    });

    it('reste non imposée même sur un plan de moins de 5 ans', () => {
      const jeunePea = compte({ dateOuverture: '2023-01-01' });
      const resultat = simulerVente(jeunePea, position, parametres);

      expect(resultat.impot.total.estZero()).toBe(true);
    });
  });

  describe('garde-fous', () => {
    it('refuse de vendre plus que la quantité détenue', () => {
      expect(() =>
        simulerVente(compte(), position, { ...parametres, quantite: d('11') }),
      ).toThrow(ErreurSimulation);
    });

    it('refuse une quantité nulle', () => {
      expect(() =>
        simulerVente(compte(), position, { ...parametres, quantite: d('0') }),
      ).toThrow(/positive/);
    });

    it('accepte une vente totale', () => {
      const resultat = simulerVente(compte(), position, {
        ...parametres,
        quantite: d('10'),
      });

      expect(resultat.prixRevient.toString()).toBe('1000');
    });
  });
});
