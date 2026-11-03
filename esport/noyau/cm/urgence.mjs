/**
 * Drapeau d'urgence des cartes CM (migration 0047) : aucun (null) < faible < moyen < urgent < critique.
 * Importé par les tableaux, l'import Trello et les tests ; aucune dépendance.
 */

export const NIVEAUX_URGENCE = Object.freeze(['faible', 'moyen', 'urgent', 'critique']);

/** Rang d'un niveau (0 : aucun). */
export const rangUrgence = n => NIVEAUX_URGENCE.indexOf(n) + 1;

/** Niveau saisi : null / '' / 'aucune' → null ; sinon un des quatre niveaux, ou `undefined` si illisible. */
export function lireUrgence(v) {
  if (v === null || v === '' || v === 'aucune' || v === 'aucun') return null;
  return NIVEAUX_URGENCE.includes(v) ? v : undefined;
}

/** Niveaux qui alertent (notification) quand la carte y monte. */
export const NIVEAUX_ALERTE = Object.freeze(['urgent', 'critique']);

const SANS_ACCENT = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const NOMS = new Map([
  ['critique', 'critique'], ['critical', 'critique'],
  ['urgent', 'urgent'], ['urgente', 'urgent'],
  ['moyen', 'moyen'], ['moyenne', 'moyen'], ['medium', 'moyen'],
  ['faible', 'faible'], ['low', 'faible'],
]);

/** Niveau d'urgence que désigne le nom d'une étiquette Trello (« Critique », « Medium »…), sinon null. */
export const urgenceDepuisNom = nom => NOMS.get(SANS_ACCENT(nom)) ?? null;
