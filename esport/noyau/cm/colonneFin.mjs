/**
 * Colonnes de fin des tableaux CM (migration 0050) : une carte déposée dans une colonne de fin est TERMINÉE.
 * Importé par les tableaux, l'import Trello et les tests ; aucune dépendance.
 */

const SANS_ACCENT = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** Noms qui évoquent une colonne de fin (sans accents ni casse) : Fini, Terminé, Fait, Done, Publié… */
const MOTIF_FIN = /^(?:fini|finie|finis|finies|termine|terminee|termines|terminees|fait|faite|faits|faites|done|finished|complete|completed|publie|publiee|publies|publiees|published|livre|livree|archive)\b/;

/** Le nom d'une colonne ressemble-t-il à une colonne de fin ? (« Fini », « Terminé ✔ », « Done », « Publié »…) */
export const nomColonneDeFin = nom => MOTIF_FIN.test(SANS_ACCENT(nom));

/** Début (lundi 00:00 UTC) de la semaine d'une date ISO, en `YYYY-MM-DD`. */
export function debutSemaine(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const jour = (d.getUTCDay() + 6) % 7;
  const lundi = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - jour));
  return lundi.toISOString().slice(0, 10);
}
