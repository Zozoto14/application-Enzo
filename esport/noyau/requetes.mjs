/**
 * Lectures groupées (performances) : une requête `IN (…)` par paquet au lieu
 * d'une requête par ligne (N+1). Les paquets restent sous la limite de D1
 * (100 paramètres liés par requête) ; SQL standard, compatible Postgres.
 */

/** Taille d'un paquet d'identifiants (D1 : 100 paramètres au plus, on garde de la marge). */
export const TAILLE_PAQUET = 80;

/** Découpe une liste en paquets. */
export function paquets(liste, taille = TAILLE_PAQUET) {
  const sortie = [];
  for (let i = 0; i < liste.length; i += taille) sortie.push(liste.slice(i, i + taille));
  return sortie;
}

/** Identifiants distincts, textes non vides seulement. */
export const distincts = ids => [...new Set((ids ?? []).filter(x => typeof x === 'string' && x))];

/**
 * Lignes dont `colonne` vaut l'un des `ids`, en une requête par paquet.
 * `avant` : début de la requête jusqu'au `IN` exclu (ex. « SELECT * FROM t WHERE team_id = ? AND id ») ;
 * `paramsAvant` : ses paramètres ; `apres` : suite éventuelle (ex. « AND supprime_le IS NULL »).
 */
export async function lignesParIds(base, avant, ids, { paramsAvant = [], apres = '' } = {}) {
  const liste = distincts(ids);
  const sortie = [];
  for (const p of paquets(liste)) {
    sortie.push(...(await base.tous(`${avant} IN (${p.map(() => '?').join(', ')}) ${apres}`.trim(), [...paramsAvant, ...p])));
  }
  return sortie;
}

/** Pseudos des comptes (`{ id: pseudo | null }`), en une requête par paquet. */
export async function pseudosDe(base, ids) {
  const liste = distincts(ids);
  const sortie = Object.fromEntries(liste.map(id => [id, null]));
  for (const l of await lignesParIds(base, 'SELECT id, pseudo FROM comptes WHERE id', liste)) sortie[l.id] = l.pseudo ?? null;
  return sortie;
}
