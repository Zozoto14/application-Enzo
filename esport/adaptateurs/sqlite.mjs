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
  const preparer = sql => db.prepare(sql);
  const base = {
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
      db.exec('BEGIN');
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
