/**
 * Suite ENTIÈRE du relais (relais/*.test.mjs) à travers le serveur Node et la boîte PostgreSQL.
 *
 *   RELAIS_TEST_PG=postgres://utilisateur:motdepasse@127.0.0.1:5432/base_de_test npm run relais:tester:pg
 *
 * (ESPORT_TEST_PG est accepté aussi.) Chaque fichier de test a son schéma `t_…`, supprimé à la fin.
 * Dépendance : `npm ci --prefix esport` (paquet pg).
 */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basePostgres } from '../../esport/adaptateurs/postgres.mjs';

const url = process.env.RELAIS_TEST_PG || process.env.ESPORT_TEST_PG;
if (!url) {
  console.error('Variable RELAIS_TEST_PG absente : adresse postgres://… d’une base de test (voir l’en-tête de relais/test-pg/lancer.mjs).');
  process.exit(2);
}
const dossier = fileURLToPath(new URL('..', import.meta.url));
const fichiers = [...readdirSync(dossier).filter(f => f.endsWith('.test.mjs')).sort().map(f => `${dossier}${f}`), fileURLToPath(new URL('./kv-postgres.test.mjs', import.meta.url))];
const preparer = fileURLToPath(new URL('./preparer.mjs', import.meta.url));

async function nettoyer() {
  const admin = await basePostgres({ connexion: url, max: 1 });
  try {
    const schemas = await admin.tous("SELECT nspname FROM pg_namespace WHERE nspname ~ '^t_[0-9a-f]{16}$'", []);
    for (const { nspname } of schemas) await admin.script(`DROP SCHEMA ${nspname} CASCADE`);
    return schemas.length;
  } finally {
    await admin.fermer();
  }
}

const r = spawnSync(process.execPath, ['--import', preparer, '--test', ...fichiers], { stdio: 'inherit', env: { ...process.env, RELAIS_TEST_PG: url } });
const n = await nettoyer();
console.log(`PostgreSQL : ${n} schémas de test supprimés.`);
process.exit(r.status ?? 1);
