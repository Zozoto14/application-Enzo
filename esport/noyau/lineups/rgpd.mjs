/**
 * RGPD du module Lineups (migration 0082) : ce que l'export d'un compte contient, et ce que sa suppression efface.
 * Les lineups qu'il a proposés restent pour la team, sans auteur ; ses favoris disparaissent.
 */

import { jsonOu } from '../outils.mjs';

/** Lineups proposés par le compte et ses favoris (pour l'export de ses données). */
export async function exportLineups(base, compte) {
  const nomsTeams = new Map((await base.tous('SELECT id, nom FROM teams', [])).map(t => [t.id, t.nom]));
  const team = id => nomsTeams.get(id) ?? null;
  const q = sql => base.tous(`${sql} LIMIT ?`, [compte, 5000]);
  return {
    lineups: (await q('SELECT team_id, titre, carte_nom, personnage_nom, capacite_nom, side, zone_nom, posture, visee, timing, instructions, difficulte, tags, statut, cree_le FROM lineups WHERE cree_par = ? AND supprime_le IS NULL ORDER BY cree_le')).map(x => ({
      team: team(x.team_id),
      titre: x.titre,
      carte: x.carte_nom,
      personnage: x.personnage_nom || null,
      capacite: x.capacite_nom || null,
      side: x.side || null,
      zone: x.zone_nom || null,
      posture: x.posture,
      visee: x.visee,
      timing: x.timing,
      instructions: x.instructions,
      difficulte: Number(x.difficulte),
      tags: jsonOu(x.tags, []),
      statut: x.statut,
      creeLe: x.cree_le,
    })),
    lineupsFavoris: (await q('SELECT f.team_id, l.titre, f.cree_le FROM lineup_favoris f JOIN lineups l ON l.id = f.lineup_id WHERE f.compte_id = ? ORDER BY f.cree_le')).map(x => ({ team: team(x.team_id), lineup: x.titre, date: x.cree_le })),
  };
}

/** Instructions SQL de la suppression d'un compte : favoris effacés, plus auteur de rien. */
export function effacementLineups(compte) {
  return [
    { sql: 'DELETE FROM lineup_favoris WHERE compte_id = ?', params: [compte] },
    { sql: 'UPDATE lineups SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: 'UPDATE lineups SET maj_par = NULL WHERE maj_par = ?', params: [compte] },
    { sql: 'UPDATE lineups SET valide_par = NULL WHERE valide_par = ?', params: [compte] },
    { sql: 'UPDATE lineups SET supprime_par = NULL WHERE supprime_par = ?', params: [compte] },
    { sql: 'UPDATE lineup_medias SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: 'UPDATE strat_lineups SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: "UPDATE fichiers SET depose_par = '' WHERE depose_par = ? AND entite_type = 'lineup_media'", params: [compte] },
  ];
}
