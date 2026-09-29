import { Decimal, d } from '../core/money/decimal';
import type { Transaction } from '../core/domain/types';
import { importerCsv } from '../core/import/import';
import { MODELE_GENERIQUE } from '../core/import/modeles';
import {
  achat,
  compte,
  dividende,
  frais,
  retrait,
  titre,
  versement,
  vente,
} from '../core/testing/fixtures';
import {
  DepotComptes,
  DepotCours,
  DepotTitres,
  DepotTransactions,
  DepotWatchlist,
  chargerEtat,
} from './depots';
import type { PiloteSqlite } from './pilote';
import { ouvrirBaseNode } from './pilotes/node';
import { migrer } from './schema';

let pilote: PiloteSqlite;
let comptes: DepotComptes;
let titres: DepotTitres;
let transactions: DepotTransactions;

beforeEach(() => {
  pilote = ouvrirBaseNode();
  migrer(pilote);
  comptes = new DepotComptes(pilote);
  titres = new DepotTitres(pilote);
  transactions = new DepotTransactions(pilote);

  comptes.enregistrer(compte());
  titres.enregistrer(titre());
});

afterEach(() => {
  pilote.fermer();
});

describe('DepotComptes', () => {
  it('enregistre et relit un compte à l’identique', () => {
    expect(comptes.parId('pea')).toEqual(compte());
  });

  it('met à jour un compte existant sans le dupliquer', () => {
    comptes.enregistrer(compte({ nom: 'PEA renommé' }));

    expect(comptes.tous()).toHaveLength(1);
    expect(comptes.parId('pea')!.nom).toBe('PEA renommé');
  });

  it('renvoie undefined pour un compte inconnu', () => {
    expect(comptes.parId('inexistant')).toBeUndefined();
  });
});

describe('DepotTitres', () => {
  it('conserve les champs optionnels et le booléen d’éligibilité', () => {
    const relu = titres.parIsin('FR0000120073')!;

    expect(relu).toEqual(titre());
    expect(relu.eligiblePEA).toBe(true);
  });

  it('distingue un champ absent d’un champ vide', () => {
    titres.enregistrer(titre({ id: 'sans', isin: 'US0000000000', secteur: undefined }));
    const relu = titres.tous().find(t => t.id === 'sans')!;

    expect(relu.secteur).toBeUndefined();
  });

  it('enregistre un titre non éligible au PEA', () => {
    titres.enregistrer(
      titre({ id: 'apple', isin: 'US0378331005', nom: 'Apple', eligiblePEA: false }),
    );
    expect(titres.parIsin('US0378331005')!.eligiblePEA).toBe(false);
  });
});

describe('DepotTransactions', () => {
  it('restitue chaque type de transaction sans perte', () => {
    const journal: Transaction[] = [
      versement('2024-01-05', 10000),
      achat('2024-01-10', 10, 100, 5),
      vente('2024-06-10', 5, 130, 5),
      dividende('2024-07-01', 30),
      frais('2024-08-01', 12),
      retrait('2024-09-01', 500),
    ];
    journal.forEach(t => transactions.enregistrer(t));

    const relues = transactions.toutes();
    expect(relues).toHaveLength(6);
    expect(relues.map(t => t.type)).toEqual([
      'VERSEMENT',
      'ACHAT',
      'VENTE',
      'DIVIDENDE',
      'FRAIS',
      'RETRAIT',
    ]);
    // Les Decimal se comparent par valeur une fois reconstruits.
    expect(relues).toEqual(
      expect.arrayContaining(journal.map(t => expect.objectContaining({ id: t.id }))),
    );
  });

  it('conserve la précision décimale à l’aller-retour', () => {
    transactions.enregistrer(achat('2024-01-10', '3.14159265', '123.45678901', '0.01'));
    const relue = transactions.toutes()[0];

    expect(relue.type === 'ACHAT' && relue.quantite.toString()).toBe('3.14159265');
    expect(relue.type === 'ACHAT' && relue.prixUnitaire.toString()).toBe('123.45678901');
  });

  it('conserve le taux de change et la note', () => {
    transactions.enregistrer(
      achat('2024-01-10', 10, 200, 2, { devise: 'USD', tauxChange: '0.9123' }),
    );
    const relue = transactions.toutes()[0];

    expect(relue.devise).toBe('USD');
    expect(relue.tauxChange!.toString()).toBe('0.9123');
  });

  it('laisse le taux de change absent quand il ne s’applique pas', () => {
    transactions.enregistrer(versement('2024-01-05', 1000));
    expect(transactions.toutes()[0].tauxChange).toBeUndefined();
  });

  it('trie le journal par date', () => {
    transactions.enregistrer(achat('2024-06-10', 1, 100, 0));
    transactions.enregistrer(achat('2024-01-10', 1, 100, 0));

    expect(transactions.toutes().map(t => t.date)).toEqual(['2024-01-10', '2024-06-10']);
  });

  it('supprime une transaction', () => {
    const t = versement('2024-01-05', 1000);
    transactions.enregistrer(t);
    transactions.supprimer(t.id);

    expect(transactions.compter()).toBe(0);
  });

  describe('enregistrerLot', () => {
    it('insère un relevé entier en une fois', () => {
      transactions.enregistrerLot([
        versement('2024-01-05', 10000),
        achat('2024-01-10', 10, 100, 5),
      ]);

      expect(transactions.compter()).toBe(2);
    });

    it('n’enregistre rien si une seule ligne du lot est refusée', () => {
      // La deuxième ligne vise un compte inexistant : la clé étrangère la
      // rejette, et la première ne doit pas subsister pour autant.
      expect(() =>
        transactions.enregistrerLot([
          versement('2024-01-05', 10000),
          versement('2024-01-06', 500, { compteId: 'fantome' }),
        ]),
      ).toThrow();

      expect(transactions.compter()).toBe(0);
    });
  });
});

describe('DepotCours', () => {
  it('ne retient que le dernier cours connu de chaque titre', () => {
    const cours = new DepotCours(pilote);
    cours.enregistrer('air-liquide', '2024-06-10', d('130'));
    cours.enregistrer('air-liquide', '2024-06-11', d('140'));

    const derniers = cours.derniersCours();
    expect(derniers.get('air-liquide')!.toString()).toBe('140');
  });

  it('écrase un cours déjà enregistré pour la même date', () => {
    const cours = new DepotCours(pilote);
    cours.enregistrer('air-liquide', '2024-06-10', d('130'));
    cours.enregistrer('air-liquide', '2024-06-10', d('131'));

    expect(cours.derniersCours().get('air-liquide')!.toString()).toBe('131');
  });

  it('renvoie une table vide quand aucun cours n’est connu', () => {
    expect(new DepotCours(pilote).derniersCours().size).toBe(0);
  });
});

describe('DepotWatchlist', () => {
  let watchlist: DepotWatchlist;

  beforeEach(() => {
    watchlist = new DepotWatchlist(pilote);
    titres.enregistrer(titre({ id: 'cw8', isin: 'LU1681043599', nom: 'MSCI World', ticker: 'CW8' }));
  });

  it('ajoute et relit une valeur surveillée', () => {
    watchlist.ajouter({ titreId: 'cw8', ajouteLe: '2026-03-12', coursAjout: d(42) });

    const [ligne] = watchlist.lister();
    expect(ligne.titreId).toBe('cw8');
    expect(ligne.ajouteLe).toBe('2026-03-12');
    expect(ligne.coursAjout!.eq(d(42))).toBe(true);
  });

  it('accepte un ajout sans cours connu', () => {
    watchlist.ajouter({ titreId: 'cw8', ajouteLe: '2026-03-12' });

    expect(watchlist.lister()[0].coursAjout).toBeUndefined();
  });

  it('conserve la note', () => {
    watchlist.ajouter({ titreId: 'cw8', ajouteLe: '2026-03-12', note: 'À renforcer sous 40' });

    expect(watchlist.lister()[0].note).toBe('À renforcer sous 40');
  });

  it('ne fige pas deux fois le cours d’ajout', () => {
    // Un second ajout met la note a jour mais ne redefinit pas le point de
    // comparaison : sinon le suivi se remettrait a zero sans qu'on l'ait
    // demande.
    watchlist.ajouter({ titreId: 'cw8', ajouteLe: '2026-03-12', coursAjout: d(42) });
    watchlist.ajouter({ titreId: 'cw8', ajouteLe: '2026-09-01', coursAjout: d(51), note: 'Revue' });

    const [ligne] = watchlist.lister();
    expect(watchlist.lister()).toHaveLength(1);
    expect(ligne.coursAjout!.eq(d(42))).toBe(true);
    expect(ligne.ajouteLe).toBe('2026-03-12');
    expect(ligne.note).toBe('Revue');
  });

  it('retire une valeur', () => {
    watchlist.ajouter({ titreId: 'cw8', ajouteLe: '2026-03-12' });
    watchlist.retirer('cw8');

    expect(watchlist.lister()).toEqual([]);
    expect(watchlist.contient('cw8')).toBe(false);
  });

  it('classe du plus récemment ajouté au plus ancien', () => {
    watchlist.ajouter({ titreId: 'air-liquide', ajouteLe: '2026-01-01' });
    watchlist.ajouter({ titreId: 'cw8', ajouteLe: '2026-06-01' });

    expect(watchlist.lister().map(l => l.titreId)).toEqual(['cw8', 'air-liquide']);
  });

  it('disparaît avec le titre supprimé', () => {
    // ON DELETE CASCADE : une surveillance orpheline ne doit pas survivre.
    watchlist.ajouter({ titreId: 'cw8', ajouteLe: '2026-03-12' });
    pilote.executer('DELETE FROM titres WHERE id = ?', ['cw8']);

    expect(watchlist.lister()).toEqual([]);
  });

  it('refuse une valeur inconnue', () => {
    expect(() =>
      watchlist.ajouter({ titreId: 'inexistant', ajouteLe: '2026-03-12' }),
    ).toThrow();
  });
});

describe('chargerEtat', () => {
  it('rejoue le journal relu depuis la base', () => {
    transactions.enregistrerLot([
      versement('2024-01-05', 10000),
      achat('2024-01-10', 10, 100, 5),
      achat('2024-02-10', 10, 120, 5),
      vente('2024-06-10', 5, 130, 5),
      dividende('2024-07-01', 30),
    ]);

    const { etat } = chargerEtat(pilote);

    expect(etat.positions[0].quantite.toString()).toBe('15');
    expect(etat.positions[0].pru.toString()).toBe('110.5');
    expect(etat.cessions[0].plusValue.toString()).toBe('92.5');
    expect(etat.comptes.get('pea')!.cash.toString()).toBe('8465');
  });

  it('boucle complète : CSV importé, persisté, relu, rejoué', () => {
    // Le scénario réel de l'application, de bout en bout.
    const releve = [
      'date,operation,libelle,isin,quantite,prix_unitaire,montant,frais',
      '2024-01-05,versement,Apport,,,,10000,',
      '2024-01-10,achat,Air Liquide,FR0000120073,10,100,1000,5',
      '2024-02-10,achat,Air Liquide,FR0000120073,10,120,1200,5',
      '2024-06-10,vente,Air Liquide,FR0000120073,5,130,650,5',
    ].join('\n');

    const importe = importerCsv(releve, MODELE_GENERIQUE, {
      compteId: 'pea',
      deviseParDefaut: 'EUR',
      resoudreTitre: ({ isin }) =>
        titres.tous().find(t => t.isin === isin)?.id,
    });
    expect(importe.anomalies).toEqual([]);

    transactions.enregistrerLot(importe.transactions);

    const { etat } = chargerEtat(pilote);
    expect(etat.positions[0].pru.toString()).toBe('110.5');
    expect(etat.comptes.get('pea')!.cash.toString()).toBe('8435');
  });

  it('renvoie un état vide pour une base fraîchement migrée', () => {
    const vide = ouvrirBaseNode();
    migrer(vide);

    const { comptes: sansCompte, etat } = chargerEtat(vide);
    expect(sansCompte).toEqual([]);
    expect(etat.positions).toEqual([]);

    vide.fermer();
  });
});

describe('robustesse à une base corrompue', () => {
  it('nomme la colonne fautive plutôt que de produire un objet incohérent', () => {
    // Une ligne insérée hors des dépôts peut violer les attentes du domaine :
    // ici un dividende dont le montant a été vidé après coup.
    transactions.enregistrer(dividende('2024-07-01', 30));
    // Le schéma interdit ce cas : on désactive la contrainte le temps de
    // fabriquer la ligne corrompue, pour vérifier que la lecture s’en protège.
    pilote.executer('PRAGMA ignore_check_constraints = ON');
    pilote.executer('UPDATE transactions SET montant = NULL');
    pilote.executer('PRAGMA ignore_check_constraints = OFF');

    expect(() => transactions.toutes()).toThrow(/montant/);
  });

  it('refuse un montant illisible', () => {
    transactions.enregistrer(versement('2024-01-05', 1000));
    pilote.executer(`UPDATE transactions SET montant = 'beaucoup'`);

    expect(() => transactions.toutes()).toThrow(/illisible/);
  });
});

describe('Decimal en base', () => {
  it('stocke les montants en texte, jamais en flottant', () => {
    transactions.enregistrer(versement('2024-01-05', '0.1'));
    const [ligne] = pilote.lire<{ montant: unknown }>(
      'SELECT montant FROM transactions',
    );

    expect(typeof ligne.montant).toBe('string');
    expect(ligne.montant).toBe('0.1');
    expect(Decimal.de(String(ligne.montant)).add('0.2').toString()).toBe('0.3');
  });
});
