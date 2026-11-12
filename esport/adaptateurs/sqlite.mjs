/**
 * Adaptateur SQLite pour Node (module intégré `node:sqlite`, Node 22.13+) :
 * tests, serveur de développement local, et première étape d'un vrai
 * serveur (un fichier .db). Même interface que l'adaptateur PostgreSQL.
 *
 * Interface `base` (commune à tous les adaptateurs) :
 *   tous(sql, params)     → lignes (objets)
 *   premier(sql, params)  → première ligne ou null
 *   executer(sql, params) → { changements }
 *   lot([{ sql, params }]) → [{ changements }], atomique (tout ou rien)
 *   script(sql)           → plusieurs instructions (migrations seulement)
 *   scriptReconstruction(sql) → migration qui reconstruit une table (clés étrangères coupées, une transaction,
 *                           PRAGMA foreign_key_check ; voir noyau/migrations.mjs)
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appliquerMigrations, MOTIF_MIGRATION } from '../noyau/migrations.mjs';

const DOSSIER_MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url));

const normaliser = valeur => (valeur === undefined ? null : typeof valeur === 'boolean' ? (valeur ? 1 : 0) : valeur);
const ligne = l => (l ? { ...l } : null);

/** Migrations du dépôt, lues sur le disque. */
export function lireMigrations(dossier = DOSSIER_MIGRATIONS) {
  return readdirSync(dossier)
    .filter(f => MOTIF_MIGRATION.test(f))
    .sort()
    .map(nom => ({ nom, sql: readFileSync(join(dossier, nom), 'utf8') }));
}

export async function baseSqlite(chemin = ':memory:') {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(chemin);
  db.exec('PRAGMA foreign_keys = ON');
  // Plusieurs processus (serveur, cron, bot) sur le même fichier : sans délai d'attente, une écriture
  // pendant celle d'un autre échoue AUSSITÔT (« database is locked », SQLITE_BUSY), d'où des erreurs au
  // hasard (connexion comprise : la limite de débit écrit à chaque ouverture de session). On attend
  // jusqu'à 5 s, et le journal WAL laisse lire pendant qu'un autre écrit.
  db.exec('PRAGMA busy_timeout = 5000');
  if (chemin !== ':memory:' && !String(chemin).startsWith('file::memory:')) {
    try {
      db.exec('PRAGMA journal_mode = WAL');
    } catch {
      // Système de fichiers sans mémoire partagée (rare) : journal par défaut, le délai d'attente suffit.
    }
  }
  const preparer = sql => db.prepare(sql);
  const base = {
    dialecte: 'sqlite',
    async tous(sql, params = []) {
      return preparer(sql).all(...params.map(normaliser)).map(ligne);
    },
    async premier(sql, params = []) {
      return ligne(preparer(sql).get(...params.map(normaliser)));
    },
    async executer(sql, params = []) {
      return { changements: Number(preparer(sql).run(...params.map(normaliser)).changes) };
    },
    async lot(liste) {
      const resultats = [];
      // IMMEDIATE : le verrou d'écriture est pris d'emblée (en attendant busy_timeout), jamais en cours de lot.
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const { sql, params = [] } of liste) resultats.push({ changements: Number(preparer(sql).run(...params.map(normaliser)).changes) });
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      return resultats;
    },
    async script(sql) {
      db.exec(sql);
    },
    /**
     * Reconstruction d'une table (procédure officielle en 12 étapes de SQLite) : `PRAGMA foreign_keys = OFF` posé
     * AVANT la transaction (il est sans effet dans une transaction), pour qu'aucun ON DELETE CASCADE ne joue au
     * DROP TABLE de l'ancienne table ; tout dans UNE transaction ; `PRAGMA foreign_key_check` avant de valider
     * (une ligne fille orpheline annule tout) ; les clés étrangères sont remises comme avant, même en cas d'erreur.
     */
    async scriptReconstruction(sql) {
      const avant = Number(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys ?? 0) === 1;
      db.exec('PRAGMA foreign_keys = OFF');
      try {
        db.exec('BEGIN IMMEDIATE');
        try {
          db.exec(sql);
          const fautes = db.prepare('PRAGMA foreign_key_check').all();
          if (fautes.length) throw new Error(`Reconstruction annulée : ${fautes.length} ligne(s) violent une clé étrangère (${[...new Set(fautes.map(f => f.table))].join(', ')}).`);
          db.exec('COMMIT');
        } catch (e) {
          if (db.isTransaction) db.exec('ROLLBACK');
          throw e;
        }
      } finally {
        db.exec(`PRAGMA foreign_keys = ${avant ? 'ON' : 'OFF'}`);
      }
    },
    fermer() {
      db.close();
    },
  };
  return base;
}

/** Base SQLite prête : ouverte et migrée. */
export async function baseSqliteMigree(chemin = ':memory:') {
  const base = await baseSqlite(chemin);
  await appliquerMigrations(base, lireMigrations());
  return base;
}
