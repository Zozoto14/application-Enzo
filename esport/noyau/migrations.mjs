/**
 * Migrations versionnées (esport/migrations/NNNN_nom.sql) : PostgreSQL
 * (serveur o2switch, esport/serveur/migrer.mjs) et SQLite local (tests,
 * serveur de dev). La table de suivi `migrations_esport` dit ce qui est
 * déjà passé. Les fichiers SQL sont les mêmes pour les deux.
 *
 * Sections propres à un moteur (rare : changer une contrainte CHECK, qui ne se modifie pas en SQLite) : une ligne
 * `-- @dialecte sqlite`, `-- @dialecte postgres` ou `-- @dialecte commun` ouvre une section qui court jusqu'au
 * marqueur suivant ; seules les sections du moteur courant (et les communes) sont exécutées. Sans marqueur, tout le
 * fichier est commun.
 *
 * `-- @reconstruction` (en tête de fichier) : la migration RECONSTRUIT une table en SQLite (procédure officielle en
 * 12 étapes, https://www.sqlite.org/lang_altertable.html#otheralter). L'adaptateur SQLite l'exécute alors avec
 * `PRAGMA foreign_keys = OFF` (posé HORS transaction : sans effet dans une transaction), dans UNE transaction, puis
 * vérifie `PRAGMA foreign_key_check` avant de valider (tout est annulé sinon) et remet les clés étrangères comme
 * avant. Sans cela, le `DROP TABLE` de l'ancienne table ferait jouer les `ON DELETE CASCADE` de ses tables filles
 * (présences, exceptions…) et les viderait. En PostgreSQL, une migration (plusieurs instructions, protocole simple)
 * s'exécute déjà dans une seule transaction implicite.
 */

export const MOTIF_MIGRATION = /^(\d{4})_[a-z0-9_]+\.sql$/;

const MOTIF_SECTION = /^--\s*@dialecte\s+(sqlite|postgres|commun)\s*$/;
const MOTIF_RECONSTRUCTION = /^--\s*@reconstruction\b/m;

/** Texte d'une migration pour un moteur (`sqlite` ou `postgres`) : sections communes et sections de ce moteur. */
export function sqlDuDialecte(sql, dialecte) {
  if (!/^--\s*@dialecte\b/m.test(sql)) return sql;
  const garder = [];
  let moteur = 'commun';
  for (const ligne of sql.split('\n')) {
    const m = MOTIF_SECTION.exec(ligne.trim());
    if (m) {
      moteur = m[1];
      continue;
    }
    if (/^--\s*@dialecte\b/.test(ligne.trim())) throw new Error(`Section de migration inconnue : ${ligne.trim()}`);
    if (moteur === 'commun' || moteur === dialecte) garder.push(ligne);
  }
  return garder.join('\n');
}

/** La migration reconstruit-elle une table (SQLite : clés étrangères coupées, transaction, vérification) ? */
export const estReconstruction = sql => MOTIF_RECONSTRUCTION.test(sql);

/**
 * Applique, dans l'ordre, les migrations pas encore passées.
 * `base.script(sql)` exécute plusieurs instructions ; `migrations` : `[{ nom, sql }]`.
 * Rend la liste des migrations appliquées.
 */
export async function appliquerMigrations(base, migrations, maintenant = Date.now()) {
  await base.script('CREATE TABLE IF NOT EXISTS migrations_esport (nom TEXT PRIMARY KEY, appliquee_le TEXT NOT NULL)');
  const faites = new Set((await base.tous('SELECT nom FROM migrations_esport', [])).map(l => l.nom));
  const dialecte = base.dialecte === 'postgres' ? 'postgres' : 'sqlite';
  const appliquees = [];
  for (const { nom, sql } of [...migrations].sort((a, b) => a.nom.localeCompare(b.nom))) {
    if (!MOTIF_MIGRATION.test(nom)) throw new Error(`Nom de migration invalide : ${nom}`);
    if (faites.has(nom)) continue;
    const texte = sqlDuDialecte(sql, dialecte);
    if (estReconstruction(sql) && dialecte === 'sqlite') {
      // Jamais de reconstruction sans clés étrangères coupées : les ON DELETE CASCADE videraient les tables filles.
      if (typeof base.scriptReconstruction !== 'function') throw new Error(`Migration ${nom} : reconstruction de table impossible sur cette base.`);
      await base.scriptReconstruction(texte);
    } else await base.script(texte);
    await base.executer('INSERT INTO migrations_esport (nom, appliquee_le) VALUES (?, ?)', [nom, new Date(maintenant).toISOString()]);
    appliquees.push(nom);
  }
  return appliquees;
}
