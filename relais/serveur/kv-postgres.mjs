/**
 * Boîte clé/valeur du relais (équivalent de Cloudflare KV `BOITE`) dans PostgreSQL, table `relais_kv`
 * de la même base que l'Esport. Même interface que KV pour ce qu'utilise relais/worker.mjs :
 *
 *   get(cle[, 'json' | { type }])                 → valeur (texte) ou null
 *   getWithMetadata(cle)                          → { value, metadata }
 *   put(cle, valeur, { expirationTtl, expiration, metadata })
 *   delete(cle)
 *   list({ prefix, cursor, limit })               → { keys: [{ name, metadata, expiration }], list_complete, cursor }
 *
 * Expiration : `expirationTtl` (secondes) ou `expiration` (instant Unix, secondes), comme KV. Une clé
 * expirée n'est plus jamais rendue ; la purge (esport/serveur/cron.mjs) l'efface ensuite.
 * Les valeurs restent ce que le relais y met : des enveloppes déjà chiffrées sur les appareils.
 *
 * `base` : une base de l'adaptateur esport/adaptateurs/postgres.mjs (tous, premier, executer, script).
 */

export const TABLE_KV = 'relais_kv';

export async function creerTableKv(base) {
  await base.script(`CREATE TABLE IF NOT EXISTS ${TABLE_KV} (
  cle TEXT PRIMARY KEY,
  valeur TEXT NOT NULL,
  meta TEXT,
  expire_le BIGINT,
  maj_le BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS relais_kv_expire ON ${TABLE_KV} (expire_le);`);
}

export async function purgerKvExpire(base, maintenant = Date.now()) {
  const existe = await base.premier("SELECT to_regclass('relais_kv') IS NOT NULL AS ok", []);
  if (!existe?.ok) return 0;
  return (await base.executer(`DELETE FROM ${TABLE_KV} WHERE expire_le IS NOT NULL AND expire_le <= ?`, [maintenant])).changements;
}

const texteDe = valeur => {
  if (typeof valeur === 'string') return valeur;
  if (valeur instanceof ArrayBuffer) return new TextDecoder().decode(valeur);
  if (ArrayBuffer.isView(valeur)) return new TextDecoder().decode(valeur);
  return String(valeur);
};

/** Boîte KV sur `base`. `maintenant` : horloge (tests). */
export function kvPostgres(base, { maintenant = () => Date.now() } = {}) {
  const lire = async cle => base.premier(`SELECT valeur, meta FROM ${TABLE_KV} WHERE cle = ? AND (expire_le IS NULL OR expire_le > ?)`, [String(cle), maintenant()]);
  const convertir = (valeur, type) => {
    const t = typeof type === 'string' ? type : type?.type;
    if (valeur === null || valeur === undefined) return null;
    if (t === 'json') return JSON.parse(valeur);
    if (t === 'arrayBuffer') return new TextEncoder().encode(valeur).buffer;
    return valeur;
  };
  return {
    async get(cle, type) {
      return convertir((await lire(cle))?.valeur ?? null, type);
    },
    async getWithMetadata(cle, type) {
      const l = await lire(cle);
      return { value: convertir(l?.valeur ?? null, type), metadata: l?.meta ? JSON.parse(l.meta) : null };
    },
    async put(cle, valeur, options = {}) {
      const t = maintenant();
      let expire = null;
      if (Number(options.expirationTtl) > 0) expire = t + Number(options.expirationTtl) * 1000;
      else if (Number(options.expiration) > 0) expire = Number(options.expiration) * 1000;
      const meta = options.metadata === undefined || options.metadata === null ? null : JSON.stringify(options.metadata);
      await base.executer(
        `INSERT INTO ${TABLE_KV} (cle, valeur, meta, expire_le, maj_le) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur, meta = excluded.meta, expire_le = excluded.expire_le, maj_le = excluded.maj_le`,
        [String(cle), texteDe(valeur), meta, expire, t],
      );
    },
    async delete(cle) {
      await base.executer(`DELETE FROM ${TABLE_KV} WHERE cle = ?`, [String(cle)]);
    },
    async list({ prefix = '', cursor, limit = 1000 } = {}) {
      const n = Math.max(1, Math.min(1000, Number(limit) || 1000));
      const apres = cursor ? Buffer.from(String(cursor), 'base64url').toString('utf8') : '';
      // Préfixe par comparaison exacte (pas de LIKE : sensible à la casse et sans caractères spéciaux).
      const lignes = await base.tous(
        `SELECT cle, meta, expire_le FROM ${TABLE_KV}
          WHERE substr(cle, 1, ?) = ? AND cle > ? AND (expire_le IS NULL OR expire_le > ?)
          ORDER BY cle LIMIT ?`,
        [prefix.length, prefix, apres, maintenant(), n + 1],
      );
      const page = lignes.slice(0, n);
      const fin = lignes.length <= n;
      return {
        keys: page.map(l => ({ name: l.cle, ...(l.meta ? { metadata: JSON.parse(l.meta) } : {}), ...(l.expire_le ? { expiration: Math.floor(Number(l.expire_le) / 1000) } : {}) })),
        list_complete: fin,
        ...(fin ? {} : { cursor: Buffer.from(page[page.length - 1].cle, 'utf8').toString('base64url') }),
      };
    },
  };
}
