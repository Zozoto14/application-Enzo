/** Tailles lisibles des réglages (variables d'environnement). Module pur, sans dépendance. */

/** « 10G », « 500M », « 8m », « 1048576 » → octets ; `defaut` sinon. */
export function lireTaille(texte, defaut) {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*([kmgt]?)(?:i?o|i?b)?\s*$/i.exec(String(texte ?? ''));
  if (!m) return defaut;
  const n = Number(m[1].replace(',', '.')) * 1024 ** ' kmgt'.indexOf((m[2] || ' ').toLowerCase());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : defaut;
}
