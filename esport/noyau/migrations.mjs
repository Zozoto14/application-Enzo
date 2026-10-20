/**
 * Migrations versionnées (esport/migrations/NNNN_nom.sql), pour les bases
 * qui ne passent pas par `wrangler d1 migrations apply` : SQLite local
 * (tests, serveur de dev) et Postgres plus tard. La table de suivi
 * `migrations_esport` est propre à ce migrateur ; sur D1, wrangler tient la
 * sienne (`d1_migrations`). Les fichiers SQL sont les mêmes.
 */

export const MOTIF_MIGRATION = /^(\d{4})_[a-z0-9_]+\.sql$/;

/**
 * Applique, dans l'ordre, les migrations pas encore passées.
 * `base.script(sql)` exécute plusieurs instructions ; `migrations` : `[{ nom, sql }]`.
 * Rend la liste des migrations appliquées.
 */
export async function appliquerMigrations(base, migrations, maintenant = Date.now()) {
  await base.script('CREATE TABLE IF NOT EXISTS migrations_esport (nom TEXT PRIMARY KEY, appliquee_le TEXT NOT NULL)');
  const faites = new Set((await base.tous('SELECT nom FROM migrations_esport', [])).map(l => l.nom));
  const appliquees = [];
  for (const { nom, sql } of [...migrations].sort((a, b) => a.nom.localeCompare(b.nom))) {
    if (!MOTIF_MIGRATION.test(nom)) throw new Error(`Nom de migration invalide : ${nom}`);
    if (faites.has(nom)) continue;
    await base.script(sql);
    await base.executer('INSERT INTO migrations_esport (nom, appliquee_le) VALUES (?, ?)', [nom, new Date(maintenant).toISOString()]);
    appliquees.push(nom);
  }
  return appliquees;
}
