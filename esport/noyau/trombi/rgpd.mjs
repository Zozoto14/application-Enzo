/**
 * RGPD du trombinoscope (migration 0030).
 *
 *  - Export (droit d'accès) : la fiche du compte (nom réel, présentation, elo, palmarès, anciennes structures,
 *    réseaux, postes, visibilité) et sa photo (image et miniature, en adresse « data: »).
 *  - Suppression du compte : sa fiche et sa PHOTO sont effacées ; il n'est plus l'auteur d'aucune modification
 *    des fiches des autres.
 *  - Badges (migration 0032) : export des badges attribués au compte (nom, team, date) ; à la suppression, ses
 *    attributions sont effacées et il n'est plus l'auteur d'aucune attribution ni d'aucun badge du catalogue.
 */

import { jsonOu } from '../outils.mjs';
import { adresseImage } from './regles.mjs';

export async function exportTrombi(base, compte) {
  const f = await base.premier('SELECT * FROM trombi_fiches WHERE compte_id = ?', [compte]);
  const p = await base.premier('SELECT type, cote, taille, donnees, miniature, maj_le FROM trombi_photos WHERE compte_id = ?', [compte]);
  return {
    trombinoscope: f
      ? {
          nomReel: f.nom_reel,
          presentation: f.presentation,
          elos: jsonOu(f.elos, []),
          palmares: jsonOu(f.palmares, []),
          anciennesStructures: jsonOu(f.structures, []),
          reseaux: jsonOu(f.reseaux, []),
          postes: jsonOu(f.postes, {}),
          visibilite: jsonOu(f.visibilite, {}),
          modifieeLe: f.maj_le,
        }
      : null,
    trombinoscopeBadges: (
      await base.tous(
        'SELECT b.nom, bm.portee, t.nom AS team_nom, bm.attribue_le FROM trombi_badges_membres bm JOIN trombi_badges b ON b.id = bm.badge_id LEFT JOIN teams t ON t.id = bm.portee WHERE bm.compte_id = ? ORDER BY b.position, b.nom',
        [compte],
      )
    ).map(l => ({ badge: l.nom, team: l.portee === 'club' ? null : (l.team_nom ?? null), attribueLe: l.attribue_le })),
    trombinoscopePhoto: p ? { type: p.type, cote: Number(p.cote), taille: Number(p.taille), image: adresseImage(p.type, p.donnees), miniature: adresseImage(p.type, p.miniature), modifieeLe: p.maj_le } : null,
  };
}

/** Instructions d'effacement (dans le lot de la suppression du compte). */
export function effacementTrombi(compte) {
  return [
    { sql: 'DELETE FROM trombi_photos WHERE compte_id = ?', params: [compte] },
    { sql: 'DELETE FROM trombi_fiches WHERE compte_id = ?', params: [compte] },
    { sql: 'UPDATE trombi_fiches SET maj_par = NULL WHERE maj_par = ?', params: [compte] },
    { sql: 'UPDATE trombi_photos SET maj_par = NULL WHERE maj_par = ?', params: [compte] },
    { sql: 'DELETE FROM trombi_badges_membres WHERE compte_id = ?', params: [compte] },
    { sql: 'UPDATE trombi_badges_membres SET attribue_par = NULL WHERE attribue_par = ?', params: [compte] },
    { sql: 'UPDATE trombi_badges SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
  ];
}
