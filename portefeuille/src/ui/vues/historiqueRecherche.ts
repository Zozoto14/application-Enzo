/**
 * Historique des recherches : les termes tapés et les valeurs consultées,
 * du plus récent au plus ancien, sans doublon.
 */

export interface EntreeHistorique {
  /** Terme tapé, ou nom de la valeur consultée. */
  texte: string;
  /** Présent pour une valeur consultée. */
  symbole?: string;
  nom?: string;
  /** Date ISO de la recherche. */
  quand: string;
}

export const TAILLE_HISTORIQUE = 12;

function cle(entree: Pick<EntreeHistorique, 'texte' | 'symbole'>): string {
  return entree.symbole ? `s:${entree.symbole.toUpperCase()}` : `t:${entree.texte.trim().toLowerCase()}`;
}

/** Ajoute en tête ; une entrée déjà présente remonte au lieu de se répéter. */
export function ajouterHistorique(
  liste: readonly EntreeHistorique[],
  entree: EntreeHistorique,
  taille = TAILLE_HISTORIQUE,
): EntreeHistorique[] {
  if (!entree.texte.trim()) return [...liste];
  const propre = { ...entree, texte: entree.texte.trim() };
  return [propre, ...liste.filter(autre => cle(autre) !== cle(propre))].slice(0, taille);
}

/** Relit l'historique enregistré ; un contenu illisible donne une liste vide. */
export function historiqueDepuisJson(brut: string | undefined): EntreeHistorique[] {
  if (!brut) return [];
  try {
    const valeur: unknown = JSON.parse(brut);
    if (!Array.isArray(valeur)) return [];
    return valeur
      .filter(
        (entree): entree is EntreeHistorique =>
          Boolean(entree) && typeof entree.texte === 'string' && typeof entree.quand === 'string',
      )
      .slice(0, TAILLE_HISTORIQUE);
  } catch {
    return [];
  }
}
