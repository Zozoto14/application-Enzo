import type { Transaction } from '../core/domain/types';
import { rejouer } from '../core/portfolio/engine';
import { achat, compte, titre, versement } from '../core/testing/fixtures';
import {
  fusionner,
  resumerFusion,
  transactionsOrphelines,
  type Instantane,
} from './fusion';

const pea = compte();
const airLiquide = titre();
const monde = titre({ id: 'cw8', isin: 'LU1681043599', nom: 'MSCI World', ticker: 'CW8' });

/** Transaction avec un identifiant imposé, pour maîtriser la fusion. */
function avecId(transaction: Transaction, id: string): Transaction {
  return { ...transaction, id };
}

function instantane(partiel: Partial<Instantane> = {}): Instantane {
  return { comptes: [pea], titres: [airLiquide], transactions: [], ...partiel };
}

describe('fusionner', () => {
  describe('transactions', () => {
    it('réunit les opérations des deux appareils', () => {
      const local = instantane({
        transactions: [avecId(versement('2026-01-05', 1000), 'op-a1b2c3d4-x-0')],
      });
      const distant = instantane({
        transactions: [avecId(versement('2026-02-05', 500), 'op-e5f6a7b8-y-0')],
      });

      const fusion = fusionner(local, distant);

      expect(fusion.resultat.transactions).toHaveLength(2);
      expect(fusion.transactionsAjoutees).toBe(1);
    });

    it('ne compte pas deux fois une opération déjà connue', () => {
      const partagee = avecId(versement('2026-01-05', 1000), 'op-a1b2c3d4-x-0');
      const fusion = fusionner(
        instantane({ transactions: [partagee] }),
        instantane({ transactions: [partagee] }),
      );

      expect(fusion.resultat.transactions).toHaveLength(1);
      expect(fusion.transactionsAjoutees).toBe(0);
    });

    it('n’arbitre pas entre deux versions d’une même opération', () => {
      // Une operation ne se modifie pas, elle s'annule par une autre. Un
      // meme identifiant designe donc la meme operation : la locale reste.
      const local = instantane({
        transactions: [avecId(versement('2026-01-05', 1000), 'op-a1b2c3d4-x-0')],
      });
      const distant = instantane({
        transactions: [avecId(versement('2026-01-05', 9999), 'op-a1b2c3d4-x-0')],
      });

      const fusion = fusionner(local, distant);
      const [seule] = fusion.resultat.transactions;

      expect(fusion.resultat.transactions).toHaveLength(1);
      expect('montant' in seule && seule.montant.toNumber()).toBe(1000);
    });

    it('rend un journal trié, rejouable tel quel', () => {
      const local = instantane({
        transactions: [
          avecId(versement('2026-03-01', 500), 'op-a1b2c3d4-b-0'),
          avecId(versement('2026-01-05', 1000), 'op-a1b2c3d4-a-0'),
        ],
      });
      const distant = instantane({
        transactions: [avecId(versement('2026-02-05', 300), 'op-e5f6a7b8-a-0')],
      });

      const fusion = fusionner(local, distant);

      expect(fusion.resultat.transactions.map(t => t.date)).toEqual([
        '2026-01-05',
        '2026-02-05',
        '2026-03-01',
      ]);
      // Le vrai test : l'etat se recalcule sans exception.
      const etat = rejouer([pea], fusion.resultat.transactions);
      expect(etat.comptes.get('pea')!.cash.toNumber()).toBe(1800);
    });

    it('ordonne de façon stable à date égale', () => {
      // Deux appareils doivent rejouer le meme journal dans le meme ordre,
      // sinon deux achats du meme jour donneraient deux PRU differents.
      const a = avecId(achat('2026-01-05', 10, 100, 0), 'op-a1b2c3d4-a-0');
      const b = avecId(achat('2026-01-05', 10, 200, 0), 'op-e5f6a7b8-a-0');

      const surIphone = fusionner(
        instantane({ transactions: [a] }),
        instantane({ transactions: [b] }),
      );
      const surIpad = fusionner(
        instantane({ transactions: [b] }),
        instantane({ transactions: [a] }),
      );

      expect(surIphone.resultat.transactions.map(t => t.id)).toEqual(
        surIpad.resultat.transactions.map(t => t.id),
      );
    });
  });

  describe('comptes et titres', () => {
    it('reprend une valeur créée sur l’autre appareil', () => {
      const fusion = fusionner(instantane(), instantane({ titres: [airLiquide, monde] }));

      expect(fusion.titresAjoutes).toBe(1);
      expect(fusion.resultat.titres.map(t => t.id).sort()).toEqual(['air-liquide', 'cw8']);
    });

    it('reprend un compte créé sur l’autre appareil', () => {
      const cto = compte({ id: 'cto', nom: 'CTO', type: 'CTO' });
      const fusion = fusionner(instantane(), instantane({ comptes: [pea, cto] }));

      expect(fusion.comptesAjoutes).toBe(1);
      expect(fusion.resultat.comptes).toHaveLength(2);
    });

    it('garde la version locale et signale la divergence', () => {
      // Choisir en silence ferait decouvrir la perte six mois plus tard, sur
      // un chiffre faux.
      const renomme = compte({ nom: 'PEA Bourso' });
      const fusion = fusionner(instantane(), instantane({ comptes: [renomme] }));

      expect(fusion.resultat.comptes[0].nom).toBe('PEA Boursobank');
      expect(fusion.conflits).toHaveLength(1);
      expect(fusion.conflits[0]).toMatchObject({
        nature: 'compte',
        id: 'pea',
        nom: 'PEA Boursobank',
        champs: ['nom'],
      });
    });

    it('nomme tous les champs qui divergent', () => {
      const modifie = titre({ nom: 'Air Liquide SA', secteur: 'Chimie' });
      const fusion = fusionner(instantane(), instantane({ titres: [modifie] }));

      expect(fusion.conflits[0].champs.sort()).toEqual(['nom', 'secteur']);
    });

    it('ne signale rien quand les deux versions sont identiques', () => {
      expect(fusionner(instantane(), instantane()).conflits).toEqual([]);
    });

    it('remonte les conflits de comptes et de titres ensemble', () => {
      const fusion = fusionner(
        instantane(),
        instantane({
          comptes: [compte({ nom: 'Autre' })],
          titres: [titre({ ticker: 'AIR' })],
        }),
      );

      expect(fusion.conflits.map(c => c.nature)).toEqual(['compte', 'titre']);
    });
  });

  it('n’est pas symétrique : le local l’emporte', () => {
    const renomme = compte({ nom: 'Autre nom' });

    expect(fusionner(instantane(), instantane({ comptes: [renomme] })).resultat.comptes[0].nom)
      .toBe('PEA Boursobank');
    expect(fusionner(instantane({ comptes: [renomme] }), instantane()).resultat.comptes[0].nom)
      .toBe('Autre nom');
  });
});

describe('transactionsOrphelines', () => {
  it('ne rend rien sur un instantané complet', () => {
    const complet = instantane({
      transactions: [versement('2026-01-05', 1000), achat('2026-01-10', 10, 100, 0)],
    });

    expect(transactionsOrphelines(complet)).toEqual([]);
  });

  it('repère une opération dont le compte manque', () => {
    const orphelin = instantane({
      comptes: [],
      transactions: [versement('2026-01-05', 1000)],
    });

    expect(transactionsOrphelines(orphelin)).toHaveLength(1);
  });

  it('repère une opération dont la valeur manque', () => {
    const orphelin = instantane({
      titres: [],
      transactions: [achat('2026-01-10', 10, 100, 0)],
    });

    expect(transactionsOrphelines(orphelin)).toHaveLength(1);
  });

  it('laisse passer une opération sans valeur', () => {
    const sansTitre = instantane({ titres: [], transactions: [versement('2026-01-05', 1000)] });

    expect(transactionsOrphelines(sansTitre)).toEqual([]);
  });
});

describe('resumerFusion', () => {
  it('énumère ce qui a été repris', () => {
    const fusion = fusionner(
      instantane(),
      instantane({
        titres: [airLiquide, monde],
        transactions: [avecId(versement('2026-01-05', 1000), 'op-e5f6a7b8-a-0')],
      }),
    );

    const resume = resumerFusion(fusion);
    expect(resume.texte).toBe('Repris de l’autre appareil : 1 opération(s), 1 valeur(s).');
    expect(resume.sansEffet).toBe(false);
  });

  it('le dit franchement quand il n’y avait rien à reprendre', () => {
    const resume = resumerFusion(fusionner(instantane(), instantane()));

    expect(resume.sansEffet).toBe(true);
    expect(resume.texte).toMatch(/déjà au même point/);
  });

  it('signale les divergences même sans rien à reprendre', () => {
    const fusion = fusionner(instantane(), instantane({ comptes: [compte({ nom: 'Autre' })] }));

    expect(resumerFusion(fusion).texte).toMatch(/divergences ont été relevées/);
  });
});
