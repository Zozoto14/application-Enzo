/**
 * Pilote SQLite pour le bureau, adossé à sql.js.
 *
 * ## Pourquoi WebAssembly plutôt qu'un module natif
 *
 * Un binding natif — `better-sqlite3`, même adossé à SQLCipher — doit être
 * recompilé contre l'ABI d'Electron, puis reconstruit à chaque montée de
 * version. C'est exactement la classe de problème qui rend le côté iOS
 * risqué : un module qui manque à l'exécution, et plus rien ne s'ouvre.
 *
 * sql.js est du WebAssembly. Il ne se compile pas, ne dépend d'aucune ABI, et
 * se comporte identiquement dans un navigateur et dans Electron.
 *
 * ## Où est le chiffrement
 *
 * Nulle part ici, et c'est délibéré. sql.js ne sait pas chiffrer : la base
 * vit en clair **en mémoire**, et c'est le fichier posé sur le disque qui est
 * scellé, par l'enveloppe Argon2id + XChaCha20-Poly1305 déjà écrite pour les
 * sauvegardes. Le contrat de `PiloteSqlite` ne mentionne pas le chiffrement,
 * précisément pour que ce choix reste local à chaque plateforme.
 *
 * ## Ce qu'il faut accepter
 *
 * La base entière tient en mémoire et se réécrit en entier à chaque
 * enregistrement. Sur un portefeuille personnel — quelques centaines
 * d'opérations, des dizaines de kilo-octets — c'est sans conséquence. Sur un
 * million de lignes, ce serait le mauvais choix.
 */

import type { PiloteSqlite, ValeurSql } from '../pilote';

/** Levee quand le contenu descelle n'est pas une base SQLite exploitable. */
export class ErreurBaseIllisible extends Error {
  constructor(detail: string) {
    super(
      `Le fichier de portefeuille est illisible (${detail}). Restaurez une sauvegarde plutot que de continuer sur une base tronquee.`,
    );
    this.name = 'ErreurBaseIllisible';
  }
}

/** Sous-ensemble de sql.js réellement utilisé, pour ne pas dépendre de ses types. */
interface BaseSqlJs {
  run(sql: string, parametres?: readonly ValeurSql[]): void;
  prepare(sql: string): DeclarationSqlJs;
  export(): Uint8Array;
  close(): void;
}

interface DeclarationSqlJs {
  bind(parametres: readonly ValeurSql[]): boolean;
  step(): boolean;
  getAsObject(): Record<string, ValeurSql>;
  free(): void;
}

export interface FabriqueSqlJs {
  Database: new (octets?: Uint8Array) => BaseSqlJs;
}

export interface PiloteMemoire extends PiloteSqlite {
  /** Contenu binaire de la base, à sceller puis écrire sur le disque. */
  exporter(): Uint8Array;
  /** Vrai si des écritures ont eu lieu depuis le dernier `exporter`. */
  modifiee(): boolean;
}

/**
 * Ouvre une base sql.js, vierge ou reprise d'un contenu binaire.
 *
 * `octets` vient du fichier descellé. Un contenu illisible fait lever sql.js,
 * ce qui est le bon comportement : mieux vaut refuser d'ouvrir que travailler
 * sur une base tronquée.
 */
export function ouvrirBaseSqlJs(
  fabrique: FabriqueSqlJs,
  octets?: Uint8Array,
): PiloteMemoire {
  const base = new fabrique.Database(octets);

  // sql.js accepte n'importe quel contenu sans broncher et n'echoue qu'a la
  // premiere requete — donc loin d'ici, dans un depot, sur un message
  // incomprehensible. Une lecture triviale force l'erreur maintenant.
  if (octets) {
    try {
      // `prepare` seul ne touche pas encore au fichier : il faut executer.
      const sonde = base.prepare('PRAGMA schema_version');
      try {
        sonde.step();
      } finally {
        sonde.free();
      }
    } catch (erreur) {
      base.close();
      throw new ErreurBaseIllisible(
        erreur instanceof Error ? erreur.message : String(erreur),
      );
    }
  }

  let sale = false;
  // Profondeur de transaction : SQLite ne gere pas les BEGIN imbriques, et
  // l'import CSV appelle des depots qui ouvrent eux-memes des transactions.
  let profondeur = 0;

  return {
    executer(sql: string, parametres: readonly ValeurSql[] = []): void {
      base.run(sql, parametres);
      sale = true;
    },

    lire<T = Record<string, ValeurSql>>(
      sql: string,
      parametres: readonly ValeurSql[] = [],
    ): T[] {
      const declaration = base.prepare(sql);
      try {
        if (parametres.length > 0) {
          declaration.bind(parametres);
        }
        const lignes: T[] = [];
        while (declaration.step()) {
          lignes.push(declaration.getAsObject() as T);
        }
        return lignes;
      } finally {
        declaration.free();
      }
    },

    transaction<T>(action: () => T): T {
      if (profondeur > 0) {
        // Deja dans une transaction : on se contente de participer a celle
        // qui court, sinon SQLite refuserait le BEGIN imbrique.
        profondeur++;
        try {
          return action();
        } finally {
          profondeur--;
        }
      }

      base.run('BEGIN');
      profondeur = 1;
      try {
        const resultat = action();
        base.run('COMMIT');
        sale = true;
        return resultat;
      } catch (erreur) {
        base.run('ROLLBACK');
        throw erreur;
      } finally {
        profondeur = 0;
      }
    },

    exporter(): Uint8Array {
      const octetsCourants = base.export();
      sale = false;
      return octetsCourants;
    },

    modifiee(): boolean {
      return sale;
    },

    fermer(): void {
      base.close();
    },
  };
}
