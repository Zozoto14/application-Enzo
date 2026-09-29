/**
 * Le pilote du bureau doit être interchangeable avec celui de l'appareil.
 *
 * Ces tests ne vérifient donc pas sql.js : ils rejouent le schéma, les dépôts
 * et un portefeuille complet à travers lui, exactement comme les tests de
 * `node:sqlite` le font. C'est la seule preuve qui compte — le SQL vérifié ici
 * est celui qui tournera sur Windows.
 */

import { d } from '../../core/money/decimal';
import { rejouer } from '../../core/portfolio/engine';
import { achat, compte, dividende, titre, versement } from '../../core/testing/fixtures';
import {
  DepotComptes,
  DepotCours,
  DepotParametres,
  DepotTitres,
  DepotTransactions,
  DepotWatchlist,
  chargerEtat,
} from '../depots';
import { VERSION_SCHEMA, migrer } from '../schema';
import {
  ErreurBaseIllisible,
  ouvrirBaseSqlJs,
  type FabriqueSqlJs,
  type PiloteMemoire,
} from './sqljs';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const initSqlJs = require('sql.js');

let fabrique: FabriqueSqlJs;
let pilote: PiloteMemoire;

beforeAll(async () => {
  fabrique = await initSqlJs();
}, 30000);

beforeEach(() => {
  pilote = ouvrirBaseSqlJs(fabrique);
  migrer(pilote);
});

afterEach(() => {
  pilote.fermer();
});

describe('migrations', () => {
  it('amène une base vierge à la version courante', () => {
    const [ligne] = pilote.lire<{ user_version: number }>('PRAGMA user_version');

    expect(ligne.user_version).toBe(VERSION_SCHEMA);
  });

  it('crée les mêmes tables que sur l’appareil', () => {
    const tables = pilote
      .lire<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .map(ligne => ligne.name)
      .filter(nom => !nom.startsWith('sqlite_'));

    expect(tables).toEqual([
      'comptes',
      'cours',
      'parametres',
      'titres',
      'transactions',
      'watchlist',
    ]);
  });

  it('ne rejoue pas une migration déjà appliquée', () => {
    expect(() => migrer(pilote)).not.toThrow();
  });
});

describe('dépôts', () => {
  beforeEach(() => {
    new DepotComptes(pilote).enregistrer(compte());
    new DepotTitres(pilote).enregistrer(titre());
  });

  it('relit un compte à l’identique', () => {
    expect(new DepotComptes(pilote).parId('pea')).toEqual(compte());
  });

  it('conserve les montants au centime près', () => {
    // Le stockage en TEXT tient sa promesse ici comme ailleurs : un flottant
    // aurait perdu la derniere decimale.
    const transactions = new DepotTransactions(pilote);
    transactions.enregistrer(achat('2026-01-10', 17, 703.8912, 2.5));

    const [relue] = transactions.toutes();
    expect('prixUnitaire' in relue && relue.prixUnitaire.toString()).toBe('703.8912');
  });

  it('applique les contraintes du schéma', () => {
    // Une vente sans titre viole un CHECK : le pilote doit lever, pas ignorer.
    expect(() =>
      pilote.executer(
        `INSERT INTO transactions (id, compte_id, type, date, devise)
         VALUES ('x', 'pea', 'ACHAT', '2026-01-10', 'EUR')`,
      ),
    ).toThrow();
  });

  it('applique les clés étrangères', () => {
    expect(() =>
      pilote.executer(
        `INSERT INTO transactions (id, compte_id, type, date, devise, montant)
         VALUES ('y', 'compte-inexistant', 'VERSEMENT', '2026-01-10', 'EUR', '100')`,
      ),
    ).toThrow();
  });

  it('gère les cours et la watchlist', () => {
    new DepotCours(pilote).enregistrer('air-liquide', '2026-09-24', d('177.5'));
    new DepotWatchlist(pilote).ajouter({ titreId: 'air-liquide', ajouteLe: '2026-09-24' });

    expect(new DepotCours(pilote).derniersCours().get('air-liquide')!.eq(d('177.5'))).toBe(
      true,
    );
    expect(new DepotWatchlist(pilote).contient('air-liquide')).toBe(true);
  });

  it('gère les paramètres', () => {
    const parametres = new DepotParametres(pilote);
    parametres.ecrire('cours.fournisseur', 'yahoo');

    expect(parametres.lire('cours.fournisseur')).toBe('yahoo');
  });
});

describe('transactions SQL', () => {
  it('annule tout quand l’action lève', () => {
    new DepotComptes(pilote).enregistrer(compte());

    expect(() =>
      pilote.transaction(() => {
        new DepotTitres(pilote).enregistrer(titre());
        throw new Error('échec au milieu');
      }),
    ).toThrow('échec au milieu');

    expect(new DepotTitres(pilote).tous()).toEqual([]);
  });

  it('supporte une transaction imbriquée', () => {
    // L'import appelle des depots qui ouvrent eux-memes des transactions :
    // sans cette tolerance, SQLite refuserait le BEGIN imbrique.
    new DepotComptes(pilote).enregistrer(compte());

    pilote.transaction(() => {
      pilote.transaction(() => {
        new DepotTitres(pilote).enregistrer(titre());
      });
    });

    expect(new DepotTitres(pilote).tous()).toHaveLength(1);
  });
});

describe('persistance binaire', () => {
  it('se relit à l’identique après un aller-retour par les octets', () => {
    new DepotComptes(pilote).enregistrer(compte());
    new DepotTitres(pilote).enregistrer(titre());
    new DepotTransactions(pilote).enregistrer(versement('2026-01-05', 1000));

    const octets = pilote.exporter();
    const rouvert = ouvrirBaseSqlJs(fabrique, octets);

    try {
      expect(new DepotComptes(rouvert).parId('pea')).toEqual(compte());
      expect(new DepotTransactions(rouvert).toutes()).toHaveLength(1);
      // La version de schema survit : c'est elle qui evite de rejouer les
      // migrations sur une base deja a jour.
      expect(rouvert.lire<{ user_version: number }>('PRAGMA user_version')[0].user_version)
        .toBe(VERSION_SCHEMA);
    } finally {
      rouvert.fermer();
    }
  });

  it('signale qu’elle a été modifiée, puis ne le signale plus', () => {
    // C'est ce drapeau qui evite de resceller et reecrire le fichier a chaque
    // rendu, alors que rien n'a change.
    expect(pilote.modifiee()).toBe(true);
    pilote.exporter();
    expect(pilote.modifiee()).toBe(false);

    new DepotComptes(pilote).enregistrer(compte());
    expect(pilote.modifiee()).toBe(true);
  });

  it('refuse un contenu binaire illisible, des l’ouverture', () => {
    // sql.js accepte n'importe quoi et n'echoue qu'a la premiere requete,
    // donc loin d'ici, sur un message incomprehensible. On force l'erreur
    // maintenant, avec une phrase qui dit quoi faire.
    expect(() => ouvrirBaseSqlJs(fabrique, new Uint8Array([1, 2, 3, 4]))).toThrow(
      ErreurBaseIllisible,
    );
    expect(() => ouvrirBaseSqlJs(fabrique, new Uint8Array([1, 2, 3, 4]))).toThrow(
      /Restaurez une sauvegarde/,
    );
  });
});

describe('un portefeuille complet, de bout en bout', () => {
  it('se rejoue et se valorise comme sur l’appareil', () => {
    new DepotComptes(pilote).enregistrer(compte());
    new DepotTitres(pilote).enregistrer(titre());

    const transactions = new DepotTransactions(pilote);
    for (const operation of [
      versement('2026-01-05', 10000),
      achat('2026-01-10', 42, 157.1, 5),
      dividende('2026-05-15', 198.4),
    ]) {
      transactions.enregistrer(operation);
    }
    new DepotCours(pilote).enregistrer('air-liquide', '2026-09-24', d('177'));

    const contenu = chargerEtat(pilote);
    const etat = rejouer(contenu.comptes, contenu.transactions);

    // 10 000 - (42 x 157,10 + 5) + 198,40 = 3 595,20.
    expect(etat.comptes.get('pea')!.cash.toString()).toBe('3595.2');
    expect(etat.positions).toHaveLength(1);
    expect(etat.positions[0].pru.toString()).toBe('157.21904762');
  });
});
