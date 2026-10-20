/**
 * Suite de tests Esport ENTIÈRE contre un vrai PostgreSQL (npm run esport:tester:pg).
 *
 *   ESPORT_TEST_PG=postgres://utilisateur:motdepasse@127.0.0.1:5432/esport_test npm run esport:tester:pg
 *
 * La base indiquée doit exister et l'utilisateur pouvoir y créer des schémas. Chaque base de test vit
 * dans son propre schéma `t_…` ; ils sont tous supprimés à la fin. Les dépendances du serveur
 * (paquet `pg`) : `npm ci --prefix esport`.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basePostgres } from '../../adaptateurs/postgres.mjs';

const url = process.env.ESPORT_TEST_PG;
if (!url) {
  console.error('Variable ESPORT_TEST_PG absente : adresse postgres://… d’une base de test (voir l’en-tête de esport/test/pg/lancer.mjs).');
  process.exit(2);
}
const dossier = fileURLToPath(new URL('..', import.meta.url));
const fichiers = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(dossier).filter(f => f.endsWith('.test.mjs')).sort().map(f => `${dossier}${f}`);

async function nettoyer() {
  const admin = await basePostgres({ connexion: url, max: 1 });
  try {
    const schemas = await admin.tous("SELECT nspname FROM pg_namespace WHERE nspname LIKE 't\\_%' AND nspname ~ '^t_[0-9a-f]{16}$'", []);
    for (const { nspname } of schemas) await admin.script(`DROP SCHEMA ${nspname} CASCADE`);
    return schemas.length;
  } finally {
    await admin.fermer();
  }
}

await nettoyer();
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=4', ...fichiers], { stdio: 'inherit', env: { ...process.env, ESPORT_TEST_PG: url } });
const n = await nettoyer();
console.log(`PostgreSQL : ${n} schémas de test supprimés.`);
process.exit(r.status ?? 1);
