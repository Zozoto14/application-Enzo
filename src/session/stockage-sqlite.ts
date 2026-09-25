/**
 * Stockage du coffre de clés dans une base SQLite **non chiffrée**.
 *
 * Le coffre doit être lu avant tout déverrouillage : il ne peut donc pas
 * vivre dans la base chiffrée, dont l'ouverture suppose justement la clé qu'il
 * contient. Il n'est pas secret pour autant — ses enveloppes sont
 * inexploitables sans mot de passe ni code de récupération.
 *
 * Pourquoi SQLite plutôt qu'un fichier : op-sqlite est déjà embarqué, là où
 * lire un fichier demanderait un module natif de plus. Une table d'une seule
 * ligne suffit, et l'écriture reste atomique.
 */

import type { PiloteSqlite } from '../db/pilote';
import type { Coffre } from '../securite/coffre';
import type { StockageCoffre } from './stockage-coffre';

/** Contrainte d'unicité : le coffre est unique par installation. */
const SCHEMA = `CREATE TABLE IF NOT EXISTS coffre (
  id      INTEGER PRIMARY KEY CHECK (id = 1),
  contenu TEXT NOT NULL
)`;

export function stockageSqlite(pilote: PiloteSqlite): StockageCoffre {
  pilote.executer(SCHEMA);

  return {
    lire(): Coffre | undefined {
      const [ligne] = pilote.lire<{ contenu: string }>(
        'SELECT contenu FROM coffre WHERE id = 1',
      );
      if (!ligne) {
        return undefined;
      }
      try {
        return JSON.parse(ligne.contenu) as Coffre;
      } catch {
        // Un coffre illisible ne doit surtout pas passer pour une absence de
        // coffre : l'application proposerait d'en créer un, écrasant le seul
        // moyen de déchiffrer les données.
        throw new Error(
          'Coffre de clés illisible. Restaurez une sauvegarde plutôt que de réinitialiser.',
        );
      }
    },

    ecrire(coffre: Coffre): void {
      pilote.executer(
        `INSERT INTO coffre (id, contenu) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET contenu = excluded.contenu`,
        [JSON.stringify(coffre)],
      );
    },

    effacer(): void {
      pilote.executer('DELETE FROM coffre WHERE id = 1');
    },
  };
}
