/**
 * Applique les migrations de l'Esport (esport/migrations/*.sql) à la base PostgreSQL, et crée la table
 * clé/valeur du relais (relais_kv). Idempotent : une migration déjà passée n'est jamais rejouée (table
 * migrations_esport ; les numéros peuvent avoir des trous). Lancé par deployer.sh à chaque mise à jour.
 *
 *   node esport/serveur/migrer.mjs
 */

import { pathToFileURL } from 'node:url';
import { basePostgres } from '../adaptateurs/postgres.mjs';
import { lireMigrations } from '../adaptateurs/sqlite.mjs';
import { appliquerMigrations } from '../noyau/migrations.mjs';
import { creerTableKv } from '../../relais/serveur/kv-postgres.mjs';
import { chargerConfigEsport } from './config.mjs';

export async function migrer(base) {
  const appliquees = await appliquerMigrations(base, lireMigrations());
  await creerTableKv(base);
  return appliquees;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  chargerConfigEsport();
  const base = await basePostgres({ max: 1 });
  try {
    const appliquees = await migrer(base);
    console.log(appliquees.length ? `Migrations appliquées : ${appliquees.join(', ')}` : 'Base à jour : aucune migration à appliquer.');
  } catch (e) {
    console.error(`Erreur de migration : ${e.message}`);
    process.exitCode = 1;
  } finally {
    await base.fermer();
  }
}
