/**
 * Base des tests : SQLite en mémoire (node:sqlite) par défaut, ou PostgreSQL
 * quand ESPORT_TEST_PG est posé (adresse postgres://… d'une base de test ; voir
 * esport/test/pg/lancer.mjs et `npm run esport:tester:pg`). Chaque base de test
 * PostgreSQL a son propre schéma, neuf : les tests restent indépendants.
 *
 * Les tests écrivent du SQL du dialecte commun ; pour le catalogue du schéma
 * (tables, index), qui diffère entre SQLite et Postgres, utiliser `nomsTables`
 * et `nomsIndex`.
 */

import { randomBytes } from 'node:crypto';
import { baseSqlite, baseSqliteMigree, lireMigrations } from '../adaptateurs/sqlite.mjs';
import { appliquerMigrations } from '../noyau/migrations.mjs';

export { lireMigrations };

export const URL_PG = process.env.ESPORT_TEST_PG || '';
export const SUR_POSTGRES = Boolean(URL_PG);

let admin;
async function schemaNeuf() {
  const { basePostgres } = await import('../adaptateurs/postgres.mjs');
  admin ??= await basePostgres({ connexion: URL_PG, max: 2 });
  const schema = `t_${randomBytes(8).toString('hex')}`;
  await admin.script(`CREATE SCHEMA ${schema}`);
  return basePostgres({ connexion: URL_PG, schema, max: 3, idleTimeoutMillis: 500 });
}

/** Base vide (aucune migration). */
export async function baseVierge() {
  return SUR_POSTGRES ? schemaNeuf() : baseSqlite();
}

/** Base vide, toutes les migrations appliquées. */
export async function baseMigree() {
  if (!SUR_POSTGRES) return baseSqliteMigree();
  const base = await schemaNeuf();
  await appliquerMigrations(base, lireMigrations());
  return base;
}

/** Noms des tables du schéma courant. */
export async function nomsTables(base) {
  if (base.dialecte === 'postgres') return (await base.tous('SELECT tablename AS name FROM pg_tables WHERE schemaname = current_schema() ORDER BY tablename', [])).map(l => l.name);
  return (await base.tous("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name", [])).map(l => l.name);
}

/** Noms des index du schéma courant. */
export async function nomsIndex(base) {
  if (base.dialecte === 'postgres') return (await base.tous('SELECT indexname AS name FROM pg_indexes WHERE schemaname = current_schema()', [])).map(l => l.name);
  return (await base.tous("SELECT name FROM sqlite_master WHERE type = 'index'", [])).map(l => l.name);
}

/**
 * Tests qui trient « dans l'ordre d'insertion » (`ORDER BY rowid`, colonne implicite de SQLite) : sur
 * Postgres, qui n'a pas d'ordre d'insertion, on ajoute aux tables une colonne `rowid` numérotée.
 * Réservé aux tests : le cœur ne trie jamais par rowid.
 */
export async function ordreInsertion(base, tables) {
  if (base.dialecte !== 'postgres') return;
  for (const t of tables) await base.script(`ALTER TABLE ${t} ADD COLUMN rowid BIGSERIAL`);
}
