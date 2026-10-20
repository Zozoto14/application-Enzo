/**
 * Adaptateur Cloudflare D1 : même interface que adaptateurs/sqlite.mjs.
 * `lot` utilise `batch()`, atomique sur D1 (une transaction implicite).
 */

const normaliser = valeur => (valeur === undefined ? null : typeof valeur === 'boolean' ? (valeur ? 1 : 0) : valeur);

export function baseD1(d1) {
  const preparer = (sql, params = []) => d1.prepare(sql).bind(...params.map(normaliser));
  return {
    async tous(sql, params) {
      const r = await preparer(sql, params).all();
      return r.results ?? [];
    },
    async premier(sql, params) {
      return (await preparer(sql, params).first()) ?? null;
    },
    async executer(sql, params) {
      const r = await preparer(sql, params).run();
      return { changements: Number(r.meta?.changes ?? 0) };
    },
    async lot(liste) {
      if (liste.length === 0) return [];
      const resultats = await d1.batch(liste.map(({ sql, params }) => preparer(sql, params)));
      return resultats.map(r => ({ changements: Number(r.meta?.changes ?? 0) }));
    },
    async script(sql) {
      await d1.exec(sql);
    },
  };
}
