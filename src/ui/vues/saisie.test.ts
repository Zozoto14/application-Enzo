import { d } from '../../core/money/decimal';
import type { Position } from '../../core/domain/types';
import { rejouer } from '../../core/portfolio/engine';
import { achat, compte, titre } from '../../core/testing/fixtures';
import {
  FORMULAIRE_VIDE,
  champsVisibles,
  resumeOperation,
  validerOperation,
  type ContexteSaisie,
  type FormulaireOperation,
} from './saisie';

const pea = compte();
const cto = compte({ id: 'cto', type: 'CTO', nom: 'Compte-titres' });
const airLiquide = titre();
const apple = titre({
  id: 'apple',
  isin: 'US0378331005',
  nom: 'Apple',
  ticker: 'AAPL',
  eligiblePEA: false,
});

function contexte(positions: Position[] = []): ContexteSaisie {
  return {
    comptes: [pea, cto],
    titres: [airLiquide, apple],
    positions,
    genererId: () => 'op-1',
  };
}

const formulaire = (partiel: Partial<FormulaireOperation>): FormulaireOperation => ({
  ...FORMULAIRE_VIDE,
  compteId: 'pea',
  date: '03/08/2026',
  ...partiel,
});

describe('champsVisibles', () => {
  it('n’affiche que ce qui a un sens pour le type choisi', () => {
    expect(champsVisibles('ACHAT')).toEqual([
      'titreId',
      'quantite',
      'prixUnitaire',
      'frais',
    ]);
    expect(champsVisibles('VERSEMENT')).toEqual(['montant']);
    expect(champsVisibles('DIVIDENDE')).toEqual(['titreId', 'montant']);
  });
});

describe('validerOperation', () => {
  describe('achat', () => {
    const achatValide = formulaire({
      type: 'ACHAT',
      titreId: 'air-liquide',
      quantite: '20',
      prixUnitaire: '5,094',
      frais: '0,51',
    });

    it('construit la transaction attendue', () => {
      const { transaction, erreurs } = validerOperation(achatValide, contexte());

      expect(erreurs).toEqual({});
      expect(transaction).toBeDefined();
      expect(transaction!.type).toBe('ACHAT');
      expect(transaction!.date).toBe('2026-08-03');
      expect(
        transaction!.type === 'ACHAT' && transaction!.prixUnitaire.toString(),
      ).toBe('5.094');
      expect(transaction!.type === 'ACHAT' && transaction!.frais.toString()).toBe('0.51');
    });

    it('produit un prix de revient conforme au relevé une fois rejouée', () => {
      // Les mêmes chiffres que l'avis d'opéré réel : 102,39 EUR débités.
      const { transaction } = validerOperation(achatValide, contexte());
      const etat = rejouer([pea], [transaction!]);

      expect(etat.positions[0].coutTotal.toString()).toBe('102.39');
      expect(etat.positions[0].pru.toString()).toBe('5.1195');
    });

    it('accepte des frais vides', () => {
      const { transaction, erreurs } = validerOperation(
        { ...achatValide, frais: '' },
        contexte(),
      );
      expect(erreurs).toEqual({});
      expect(transaction!.type === 'ACHAT' && transaction!.frais.estZero()).toBe(true);
    });
  });

  describe('erreurs par champ', () => {
    it('signale chaque champ fautif séparément', () => {
      // Une erreur globale obligerait à relire les sept champs.
      const { erreurs, transaction } = validerOperation(
        formulaire({
          type: 'ACHAT',
          compteId: '',
          date: '32/13/2026',
          titreId: '',
          quantite: 'beaucoup',
          prixUnitaire: '-5',
        }),
        contexte(),
      );

      expect(transaction).toBeUndefined();
      expect(erreurs.compteId).toBe('Choisissez un compte');
      expect(erreurs.date).toMatch(/JJ\/MM\/AAAA/);
      expect(erreurs.titreId).toBe('Choisissez une valeur');
      expect(erreurs.quantite).toBe('Nombre illisible');
      expect(erreurs.prixUnitaire).toMatch(/négative/);
    });

    it('refuse une quantité nulle', () => {
      const { erreurs } = validerOperation(
        formulaire({ type: 'ACHAT', titreId: 'air-liquide', quantite: '0', prixUnitaire: '5' }),
        contexte(),
      );
      expect(erreurs.quantite).toMatch(/supérieure à zéro/);
    });

    it('accepte la virgule décimale française', () => {
      const { erreurs } = validerOperation(
        formulaire({
          type: 'ACHAT',
          titreId: 'air-liquide',
          quantite: '1,5',
          prixUnitaire: '703,89',
        }),
        contexte(),
      );
      expect(erreurs).toEqual({});
    });
  });

  describe('éligibilité PEA', () => {
    it('refuse un titre non éligible sur un PEA', () => {
      // Une saisie corrigée coûte moins cher que la clôture du plan.
      const { erreurs } = validerOperation(
        formulaire({
          type: 'ACHAT',
          compteId: 'pea',
          titreId: 'apple',
          quantite: '10',
          prixUnitaire: '200',
        }),
        contexte(),
      );
      expect(erreurs.titreId).toMatch(/pas éligible au PEA/);
    });

    it('accepte le même titre sur un compte-titres', () => {
      const { erreurs } = validerOperation(
        formulaire({
          type: 'ACHAT',
          compteId: 'cto',
          titreId: 'apple',
          quantite: '10',
          prixUnitaire: '200',
        }),
        contexte(),
      );
      expect(erreurs).toEqual({});
    });
  });

  describe('vente', () => {
    const positions = rejouer([pea], [achat('2026-01-10', 20, 5, 0)]).positions;

    it('accepte une vente dans la limite détenue', () => {
      const { erreurs } = validerOperation(
        formulaire({
          type: 'VENTE',
          titreId: 'air-liquide',
          quantite: '20',
          prixUnitaire: '6',
        }),
        contexte(positions),
      );
      expect(erreurs).toEqual({});
    });

    it('refuse une vente à découvert en disant combien est détenu', () => {
      const { erreurs } = validerOperation(
        formulaire({
          type: 'VENTE',
          titreId: 'air-liquide',
          quantite: '25',
          prixUnitaire: '6',
        }),
        contexte(positions),
      );
      expect(erreurs.quantite).toBe('Vous détenez 20 titre(s) sur ce compte');
    });

    it('refuse une vente sur un titre non détenu', () => {
      const { erreurs } = validerOperation(
        formulaire({
          type: 'VENTE',
          titreId: 'air-liquide',
          quantite: '1',
          prixUnitaire: '6',
        }),
        contexte([]),
      );
      expect(erreurs.quantite).toMatch(/0 titre/);
    });
  });

  describe('opérations de caisse', () => {
    it('construit un versement', () => {
      const { transaction, erreurs } = validerOperation(
        formulaire({ type: 'VERSEMENT', montant: '1 000,00' }),
        contexte(),
      );
      expect(erreurs).toEqual({});
      expect(transaction!.type === 'VERSEMENT' && transaction!.montant.toString()).toBe(
        '1000',
      );
    });

    it('construit un dividende rattaché à une valeur', () => {
      const { transaction, erreurs } = validerOperation(
        formulaire({ type: 'DIVIDENDE', titreId: 'air-liquide', montant: '30,50' }),
        contexte(),
      );
      expect(erreurs).toEqual({});
      expect(
        transaction!.type === 'DIVIDENDE' && transaction!.montantNet.toString(),
      ).toBe('30.5');
    });

    it('reprend la devise du compte', () => {
      const { transaction } = validerOperation(
        formulaire({ type: 'VERSEMENT', montant: '100' }),
        contexte(),
      );
      expect(transaction!.devise).toBe('EUR');
    });

    it('conserve la note', () => {
      const { transaction } = validerOperation(
        formulaire({ type: 'VERSEMENT', montant: '100', note: '  Apport initial  ' }),
        contexte(),
      );
      expect(transaction!.note).toBe('Apport initial');
    });
  });
});

describe('resumeOperation', () => {
  it('annonce le montant débité pour un achat', () => {
    const resume = resumeOperation(
      formulaire({
        type: 'ACHAT',
        quantite: '20',
        prixUnitaire: '5,094',
        frais: '0,51',
      }),
    );
    expect(resume!.libelle).toBe('Montant débité');
    expect(resume!.total.toString()).toBe('102.39');
  });

  it('retranche les frais du montant crédité par une vente', () => {
    const resume = resumeOperation(
      formulaire({ type: 'VENTE', quantite: '20', prixUnitaire: '6', frais: '0,51' }),
    );
    expect(resume!.libelle).toBe('Montant crédité');
    expect(resume!.total.toString()).toBe('119.49');
  });

  it('ne dit rien tant que la saisie est incomplète', () => {
    expect(resumeOperation(formulaire({ type: 'ACHAT', quantite: '20' }))).toBeUndefined();
    expect(resumeOperation(formulaire({ type: 'VERSEMENT', montant: '100' }))).toBeUndefined();
  });

  it('ne plante pas sur une saisie illisible', () => {
    expect(
      resumeOperation(formulaire({ type: 'ACHAT', quantite: 'abc', prixUnitaire: 'x' })),
    ).toBeUndefined();
  });
});

describe('Decimal', () => {
  it('sert de référence aux montants saisis', () => {
    expect(d('5.094').mul('20').add('0.51').toString()).toBe('102.39');
  });
});
