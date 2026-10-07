import type { PiloteSqlite } from './pilote';
import { ouvrirBaseNode } from './pilotes/node';
import { MIGRATIONS, VERSION_SCHEMA, migrer } from './schema';

describe('migrer', () => {
  let pilote: PiloteSqlite;

  beforeEach(() => {
    pilote = ouvrirBaseNode();
  });

  afterEach(() => {
    pilote.fermer();
  });

  it('amène une base vierge à la version courante', () => {
    const resultat = migrer(pilote);

    expect(resultat.de).toBe(0);
    expect(resultat.vers).toBe(VERSION_SCHEMA);
  });

  it('ne rejoue pas une migration déjà appliquée', () => {
    migrer(pilote);
    const second = migrer(pilote);

    // Une migration rejouée échouerait sur un CREATE TABLE déjà existant.
    expect(second.de).toBe(VERSION_SCHEMA);
    expect(second.vers).toBe(VERSION_SCHEMA);
  });

  it('crée les tables attendues', () => {
    migrer(pilote);
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

  it('numérote les migrations sans trou ni doublon', () => {
    const versions = MIGRATIONS.map(migration => migration.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(new Set(versions).size).toBe(versions.length);
    expect(versions[0]).toBe(1);
  });

  it('applique une migration ajoutee apres coup sur une base deja creee', () => {
    // Scenario reel d'une mise a jour de l'application : la base existe deja
    // en version 1, et seule la migration manquante doit s'appliquer.
    pilote.executer('PRAGMA foreign_keys = ON');
    for (const instruction of MIGRATIONS[0].instructions) {
      pilote.executer(instruction);
    }
    pilote.executer('PRAGMA user_version = 1');

    const resultat = migrer(pilote);

    expect(resultat.de).toBe(1);
    expect(resultat.vers).toBe(VERSION_SCHEMA);
    expect(() =>
      pilote.executer("INSERT INTO parametres VALUES ('x', 'y')"),
    ).not.toThrow();
  });
});

describe('migration 4 : lien vers une fiche externe', () => {
  let base: PiloteSqlite;

  beforeEach(() => {
    base = ouvrirBaseNode();
    migrer(base);
  });

  afterEach(() => {
    base.fermer();
  });

  it('ajoute la colonne aux titres', () => {
    const colonnes = base
      .lire<{ name: string }>('PRAGMA table_info(titres)')
      .map(ligne => ligne.name);

    expect(colonnes).toContain('lien_externe');
  });

  it('laisse la colonne vide sur les valeurs existantes', () => {
    // Une base d'avant la migration ne perd rien : le lien est simplement
    // absent tant qu'on ne l'a pas colle.
    base.executer(
      `INSERT INTO titres (id, isin, nom, ticker, devise_cotation, eligible_pea)
       VALUES ('t', 'FR0000120073', 'Air Liquide', 'AI.PA', 'EUR', 1)`,
    );

    const [ligne] = base.lire<{ lien_externe: string | null }>(
      'SELECT lien_externe FROM titres',
    );
    expect(ligne.lien_externe).toBeNull();
  });
});

describe('contraintes du schéma', () => {
  let pilote: PiloteSqlite;

  beforeEach(() => {
    pilote = ouvrirBaseNode();
    migrer(pilote);
    pilote.executer(
      `INSERT INTO comptes VALUES ('pea', 'PEA', 'PEA', '2019-03-15', 'EUR')`,
    );
    pilote.executer(
      // Colonnes nommees : un INSERT positionnel casse des qu'une migration
      // ajoute une colonne, ce qui est arrive a la version 4.
      `INSERT INTO titres
         (id, isin, nom, ticker, devise_cotation, secteur, zone_geographique, eligible_pea)
       VALUES ('al', 'FR0000120073', 'Air Liquide', 'AI', 'EUR', 'Materiaux', 'Europe', 1)`,
    );
  });

  afterEach(() => {
    pilote.fermer();
  });

  const inserer = (colonnes: string, valeurs: string): void =>
    pilote.executer(`INSERT INTO transactions (${colonnes}) VALUES (${valeurs})`);

  it('refuse un achat sans quantité', () => {
    expect(() =>
      inserer(
        'id, compte_id, titre_id, type, date, devise, prix_unitaire, frais',
        `'t1', 'pea', 'al', 'ACHAT', '2024-01-10', 'EUR', '100', '5'`,
      ),
    ).toThrow();
  });

  it('refuse un achat sans titre', () => {
    expect(() =>
      inserer(
        'id, compte_id, type, date, devise, quantite, prix_unitaire, frais',
        `'t2', 'pea', 'ACHAT', '2024-01-10', 'EUR', '10', '100', '5'`,
      ),
    ).toThrow();
  });

  it('refuse un versement sans montant', () => {
    expect(() =>
      inserer(
        'id, compte_id, type, date, devise',
        `'t3', 'pea', 'VERSEMENT', '2024-01-05', 'EUR'`,
      ),
    ).toThrow();
  });

  it('refuse un type de transaction inconnu', () => {
    expect(() =>
      inserer(
        'id, compte_id, type, date, devise, montant',
        `'t4', 'pea', 'CADEAU', '2024-01-05', 'EUR', '100'`,
      ),
    ).toThrow();
  });

  it('refuse un type de compte inconnu', () => {
    expect(() =>
      pilote.executer(
        `INSERT INTO comptes VALUES ('x', 'Livret A', 'LIVRET', '2020-01-01', 'EUR')`,
      ),
    ).toThrow();
  });

  it('refuse une transaction rattachée à un compte inexistant', () => {
    expect(() =>
      inserer(
        'id, compte_id, type, date, devise, montant',
        `'t5', 'fantome', 'VERSEMENT', '2024-01-05', 'EUR', '100'`,
      ),
    ).toThrow();
  });

  it('refuse deux titres partageant le même ISIN', () => {
    expect(() =>
      pilote.executer(
        `INSERT INTO titres
           (id, isin, nom, ticker, devise_cotation, secteur, zone_geographique, eligible_pea)
         VALUES ('al2', 'FR0000120073', 'Doublon', 'AI2', 'EUR', NULL, NULL, 1)`,
      ),
    ).toThrow();
  });

  it('empêche de supprimer un titre encore mouvementé', () => {
    inserer(
      'id, compte_id, titre_id, type, date, devise, quantite, prix_unitaire, frais',
      `'t6', 'pea', 'al', 'ACHAT', '2024-01-10', 'EUR', '10', '100', '5'`,
    );

    expect(() => pilote.executer(`DELETE FROM titres WHERE id = 'al'`)).toThrow();
  });

  it('supprime les transactions avec le compte auquel elles appartiennent', () => {
    inserer(
      'id, compte_id, type, date, devise, montant',
      `'t7', 'pea', 'VERSEMENT', '2024-01-05', 'EUR', '1000'`,
    );
    pilote.executer(`DELETE FROM comptes WHERE id = 'pea'`);

    expect(pilote.lire('SELECT * FROM transactions')).toEqual([]);
  });

  it('accepte une opération de caisse sans titre', () => {
    expect(() =>
      inserer(
        'id, compte_id, type, date, devise, montant',
        `'t8', 'pea', 'VERSEMENT', '2024-01-05', 'EUR', '1000'`,
      ),
    ).not.toThrow();
  });
});
