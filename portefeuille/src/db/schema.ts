/**
 * Schéma de la base et migrations.
 *
 * Choix structurant : **les montants sont stockés en TEXT**, pas en REAL ni en
 * INTEGER. REAL serait un flottant, et réintroduirait dans la base l'erreur que
 * `Decimal` élimine dans le code. INTEGER en centimes conviendrait aux montants
 * mais pas aux quantités fractionnaires ni aux cours à plusieurs décimales.
 * Une chaîne décimale relue par `Decimal` est exacte, lisible dans un dump, et
 * insensible à la plateforme.
 *
 * Les dates sont des chaînes ISO (AAAA-MM-JJ) : elles se trient
 * lexicographiquement, ce qui suffit au rejeu chronologique.
 *
 * Les migrations sont appliquées dans l'ordre et repérées par `user_version`,
 * le compteur que SQLite maintient lui-même dans l'en-tête du fichier.
 */

import type { PiloteSqlite } from './pilote';

export interface Migration {
  version: number;
  libelle: string;
  instructions: string[];
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    libelle: 'Comptes, titres, transactions et cours',
    instructions: [
      `CREATE TABLE comptes (
        id             TEXT PRIMARY KEY,
        nom            TEXT NOT NULL,
        type           TEXT NOT NULL CHECK (type IN ('PEA', 'PEA_PME', 'CTO')),
        date_ouverture TEXT NOT NULL,
        devise         TEXT NOT NULL
      )`,

      `CREATE TABLE titres (
        id                TEXT PRIMARY KEY,
        isin              TEXT NOT NULL UNIQUE,
        nom               TEXT NOT NULL,
        ticker            TEXT NOT NULL,
        devise_cotation   TEXT NOT NULL,
        secteur           TEXT,
        zone_geographique TEXT,
        eligible_pea      INTEGER NOT NULL CHECK (eligible_pea IN (0, 1))
      )`,

      // Une seule table pour les six types de mouvement : le journal doit se
      // relire dans l'ordre chronologique sans jointure ni union.
      `CREATE TABLE transactions (
        id            TEXT PRIMARY KEY,
        compte_id     TEXT NOT NULL REFERENCES comptes(id) ON DELETE CASCADE,
        titre_id      TEXT REFERENCES titres(id) ON DELETE RESTRICT,
        type          TEXT NOT NULL CHECK (type IN
                        ('ACHAT', 'VENTE', 'DIVIDENDE', 'VERSEMENT', 'RETRAIT', 'FRAIS')),
        date          TEXT NOT NULL,
        devise        TEXT NOT NULL,
        taux_change   TEXT,
        note          TEXT,
        quantite      TEXT,
        prix_unitaire TEXT,
        frais         TEXT,
        montant       TEXT,
        montant_brut  TEXT,

        -- Un achat ou une vente sans titre, sans quantité ou sans prix serait
        -- irrejouable : la base refuse de l'enregistrer plutôt que de laisser
        -- le moteur échouer plus tard sur une donnée incomplète.
        CHECK (
          type NOT IN ('ACHAT', 'VENTE')
          OR (titre_id IS NOT NULL AND quantite IS NOT NULL
              AND prix_unitaire IS NOT NULL AND frais IS NOT NULL)
        ),
        CHECK (type <> 'DIVIDENDE' OR (titre_id IS NOT NULL AND montant IS NOT NULL)),
        CHECK (type NOT IN ('VERSEMENT', 'RETRAIT', 'FRAIS') OR montant IS NOT NULL)
      )`,

      `CREATE INDEX idx_transactions_compte_date ON transactions(compte_id, date)`,
      `CREATE INDEX idx_transactions_titre ON transactions(titre_id)`,

      `CREATE TABLE cours (
        titre_id TEXT NOT NULL REFERENCES titres(id) ON DELETE CASCADE,
        date     TEXT NOT NULL,
        cloture  TEXT NOT NULL,
        PRIMARY KEY (titre_id, date)
      )`,
    ],
  },
  {
    version: 2,
    libelle: 'Parametres de l’application',
    instructions: [
      // Table cle-valeur, dans la base chiffree : c'est la que vit la cle
      // d'API du fournisseur de cours. Elle n'est donc lisible qu'apres
      // deverrouillage, et jamais ecrite en clair sur le disque.
      `CREATE TABLE parametres (
        cle    TEXT PRIMARY KEY,
        valeur TEXT NOT NULL
      )`,
    ],
  },
  {
    version: 3,
    libelle: 'Liste de surveillance',
    instructions: [
      // Les valeurs suivies sans etre detenues. Le cours du jour de l'ajout
      // est fige ici plutot que relu dans l'historique : ce dernier peut ne
      // rien contenir a cette date, et un point de comparaison approximatif
      // vaut moins que pas de point de comparaison du tout.
      `CREATE TABLE watchlist (
        titre_id    TEXT PRIMARY KEY REFERENCES titres(id) ON DELETE CASCADE,
        ajoute_le   TEXT NOT NULL,
        cours_ajout TEXT,
        note        TEXT
      )`,
    ],
  },
  {
    version: 4,
    libelle: 'Lien vers une fiche externe',
    instructions: [
      // L'adresse d'une fiche ne se devine pas : chez Baggr une valeur est
      // designee par un identifiant opaque. On la garde telle qu'elle a ete
      // collee, plutot que de fabriquer un lien approximatif.
      `ALTER TABLE titres ADD COLUMN lien_externe TEXT`,
    ],
  },
];

/** Version de schéma attendue par cette version du code. */
export const VERSION_SCHEMA = MIGRATIONS[MIGRATIONS.length - 1].version;

function versionActuelle(pilote: PiloteSqlite): number {
  const [ligne] = pilote.lire<{ user_version: number }>('PRAGMA user_version');
  return ligne?.user_version ?? 0;
}

/**
 * Prépare la base : contraintes actives, puis migrations manquantes.
 *
 * `foreign_keys` doit être réactivé à chaque ouverture de connexion, SQLite ne
 * le mémorise pas dans le fichier.
 */
export function migrer(pilote: PiloteSqlite): { de: number; vers: number } {
  pilote.executer('PRAGMA foreign_keys = ON');

  const depart = versionActuelle(pilote);

  for (const migration of MIGRATIONS) {
    if (migration.version <= depart) {
      continue;
    }
    pilote.transaction(() => {
      for (const instruction of migration.instructions) {
        pilote.executer(instruction);
      }
      // PRAGMA n'accepte pas de paramètre lié ; la valeur vient d'une
      // constante du code, jamais d'une entrée utilisateur.
      pilote.executer(`PRAGMA user_version = ${Number(migration.version)}`);
    });
  }

  return { de: depart, vers: versionActuelle(pilote) };
}
