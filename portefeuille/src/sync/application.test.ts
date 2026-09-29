import { d } from '../core/money/decimal';
import type { Transaction } from '../core/domain/types';
import { rejouer } from '../core/portfolio/engine';
import { achat, compte, titre, versement } from '../core/testing/fixtures';
import type { ContenuArchive } from '../sauvegarde/archive';
import {
  DepotComptes,
  DepotParametres,
  DepotTitres,
  DepotTransactions,
  chargerEtat,
} from '../db/depots';
import type { PiloteSqlite } from '../db/pilote';
import { ouvrirBaseNode } from '../db/pilotes/node';
import { migrer } from '../db/schema';
import { ErreurFusion, fusionnerDansBase, instantaneDeLaBase } from './application';

let pilote: PiloteSqlite;

const pea = compte();
const cto = compte({ id: 'cto', nom: 'CTO', type: 'CTO' });
const airLiquide = titre();
const monde = titre({ id: 'cw8', isin: 'LU1681043599', nom: 'MSCI World', ticker: 'CW8' });

function avecId(transaction: Transaction, id: string): Transaction {
  return { ...transaction, id };
}

beforeEach(() => {
  pilote = ouvrirBaseNode();
  migrer(pilote);
  new DepotComptes(pilote).enregistrer(pea);
  new DepotTitres(pilote).enregistrer(airLiquide);
  new DepotTransactions(pilote).enregistrer(
    avecId(versement('2026-01-05', 1000), 'op-a1b2c3d4-a-0'),
  );
});

afterEach(() => {
  pilote.fermer();
});

function archive(partiel: Partial<ContenuArchive> = {}): ContenuArchive {
  return {
    version: 1,
    date: '2026-09-24',
    comptes: [pea],
    titres: [airLiquide],
    transactions: [],
    cours: [],
    parametres: [],
    ...partiel,
  };
}

describe('instantaneDeLaBase', () => {
  it('rend ce qui se partage entre appareils', () => {
    const instantane = instantaneDeLaBase(pilote);

    expect(instantane.comptes).toHaveLength(1);
    expect(instantane.titres).toHaveLength(1);
    expect(instantane.transactions).toHaveLength(1);
  });
});

describe('fusionnerDansBase', () => {
  it('reprend les opérations de l’autre appareil', () => {
    const fusion = fusionnerDansBase(
      pilote,
      archive({
        transactions: [avecId(versement('2026-02-05', 500), 'op-e5f6a7b8-a-0')],
      }),
    );

    expect(fusion.transactionsAjoutees).toBe(1);
    expect(new DepotTransactions(pilote).toutes()).toHaveLength(2);
  });

  it('ne détruit rien : les données locales restent', () => {
    // C'est toute la difference avec la restauration, qui remplace.
    fusionnerDansBase(pilote, archive({ comptes: [cto], titres: [], transactions: [] }));

    expect(new DepotComptes(pilote).parId('pea')).toBeDefined();
    expect(new DepotTransactions(pilote).toutes()).toHaveLength(1);
  });

  it('reprend un compte et une valeur créés ailleurs', () => {
    const fusion = fusionnerDansBase(
      pilote,
      archive({ comptes: [pea, cto], titres: [airLiquide, monde] }),
    );

    expect(fusion.comptesAjoutes).toBe(1);
    expect(fusion.titresAjoutes).toBe(1);
    expect(new DepotComptes(pilote).tous()).toHaveLength(2);
    expect(new DepotTitres(pilote).tous()).toHaveLength(2);
  });

  it('n’écrase pas la version locale d’un compte divergent', () => {
    // `enregistrer` ferait un ON CONFLICT DO UPDATE : ecraser ici annulerait
    // precisement la version qu'on a choisi de garder.
    const fusion = fusionnerDansBase(
      pilote,
      archive({ comptes: [compte({ nom: 'PEA renommé ailleurs' })] }),
    );

    expect(new DepotComptes(pilote).parId('pea')!.nom).toBe('PEA Boursobank');
    expect(fusion.conflits).toHaveLength(1);
    expect(fusion.conflits[0].champs).toEqual(['nom']);
  });

  it('est idempotente : refusionner ne duplique rien', () => {
    const contenu = archive({
      transactions: [avecId(versement('2026-02-05', 500), 'op-e5f6a7b8-a-0')],
    });

    fusionnerDansBase(pilote, contenu);
    const seconde = fusionnerDansBase(pilote, contenu);

    expect(seconde.transactionsAjoutees).toBe(0);
    expect(new DepotTransactions(pilote).toutes()).toHaveLength(2);
  });

  it('laisse un état rejouable et juste', () => {
    fusionnerDansBase(
      pilote,
      archive({
        titres: [airLiquide, monde],
        transactions: [
          avecId(versement('2026-02-05', 500), 'op-e5f6a7b8-a-0'),
          avecId(achat('2026-02-10', 10, 100, 0), 'op-e5f6a7b8-b-0'),
        ],
      }),
    );

    const contenu = chargerEtat(pilote);
    const etat = rejouer(contenu.comptes, contenu.transactions);

    // 1 000 + 500 verses, 1 000 depenses en titres.
    expect(etat.comptes.get('pea')!.cash.toNumber()).toBe(500);
    expect(etat.positions).toHaveLength(1);
    expect(etat.positions[0].pru.eq(d(100))).toBe(true);
  });

  describe('ce qui ne se synchronise pas', () => {
    it('ne reprend pas les réglages de l’autre appareil', () => {
      const parametres = new DepotParametres(pilote);
      parametres.ecrire('cours.cle_api', 'la-mienne');

      fusionnerDansBase(
        pilote,
        archive({ parametres: [{ cle: 'cours.cle_api', valeur: 'celle-de-l-ipad' }] }),
      );

      expect(parametres.lire('cours.cle_api')).toBe('la-mienne');
    });

    it('ne reprend pas l’historique des cours', () => {
      // Il se reconstruit seul au premier rafraichissement.
      fusionnerDansBase(
        pilote,
        archive({ cours: [{ titreId: 'air-liquide', date: '2026-09-01', cloture: '180' }] }),
      );

      expect(chargerEtat(pilote).transactions).toHaveLength(1);
      const lignes = pilote.lire<{ n: number }>('SELECT COUNT(*) AS n FROM cours');
      expect(lignes[0].n).toBe(0);
    });
  });

  describe('archive incomplète', () => {
    it('refuse avant d’écrire quoi que ce soit', () => {
      const incomplete = archive({
        transactions: [avecId(achat('2026-02-10', 10, 100, 0, { titreId: 'absent' }), 'op-x-0')],
      });

      expect(() => fusionnerDansBase(pilote, incomplete)).toThrow(ErreurFusion);
      // Rien n'a ete ecrit : l'etat local est intact.
      expect(new DepotTransactions(pilote).toutes()).toHaveLength(1);
    });

    it('dit ce qui manque plutôt qu’une erreur de contrainte', () => {
      // Le compte local reste apres fusion : il faut viser un compte qui
      // n'existe nulle part pour rendre l'operation reellement orpheline.
      const incomplete = archive({
        transactions: [
          avecId(versement('2026-02-05', 500, { compteId: 'jamais-vu' }), 'op-y-0'),
        ],
      });

      expect(() => fusionnerDansBase(pilote, incomplete)).toThrow(
        /renvoient à un compte ou une valeur absents/,
      );
    });
  });
});
