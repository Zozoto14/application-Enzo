/**
 * RGPD de la section CM.
 *
 *  - Export (droit d'accès) : rôles CM, cartes créées, cartes où le compte est assigné, commentaires,
 *    clips proposés, fichiers déposés.
 *  - Suppression du compte : ses affectations et ses assignations disparaissent ; ce qu'il a écrit pour le
 *    club (cartes, commentaires, clips, pièces jointes) reste, sans auteur (« Compte supprimé ») ; il est
 *    retiré des membres liés aux posts.
 */

import { jsonOu } from '../outils.mjs';

export async function exportCm(base, compte) {
  const q = (sql, params = [compte]) => base.tous(`${sql} LIMIT 5000`, params);
  const tableaux = new Map((await base.tous('SELECT id, nom, cle_defaut FROM cm_tableaux', [])).map(t => [t.id, t.nom ?? t.cle_defaut ?? null]));
  const teams = new Map((await base.tous('SELECT id, nom FROM teams', [])).map(t => [t.id, t.nom]));
  return {
    cmRoles: (await q('SELECT a.portee, a.cree_le, r.nom FROM cm_affectations a JOIN cm_roles r ON r.id = a.role_id WHERE a.compte_id = ? ORDER BY a.cree_le')).map(a => ({ role: a.nom, portee: a.portee === 'club' ? 'club' : (teams.get(a.portee) ?? a.portee), depuis: a.cree_le })),
    cmCartesCreees: (await q('SELECT tableau_id, titre, statut, origine, cree_le FROM cm_cartes WHERE cree_par = ? AND supprime_le IS NULL ORDER BY cree_le')).map(c => ({ tableau: tableaux.get(c.tableau_id) ?? null, titre: c.titre, statut: c.statut ?? null, origine: c.origine, creeLe: c.cree_le })),
    cmCartesAssignees: (await q('SELECT c.tableau_id, c.titre FROM cm_carte_membres m JOIN cm_cartes c ON c.id = m.carte_id WHERE m.compte_id = ? AND c.supprime_le IS NULL')).map(c => ({ tableau: tableaux.get(c.tableau_id) ?? null, titre: c.titre })),
    cmCommentaires: (await q('SELECT c.titre, x.texte, x.cree_le FROM cm_commentaires x JOIN cm_cartes c ON c.id = x.carte_id WHERE x.auteur_id = ? AND x.supprime_le IS NULL ORDER BY x.cree_le')).map(x => ({ carte: x.titre, texte: x.texte, date: x.cree_le })),
    cmClips: (await q('SELECT team_id, genre, url, titre, description, instant, statut, motif, cree_le FROM cm_clips WHERE propose_par = ? AND supprime_le IS NULL ORDER BY cree_le')).map(x => ({ team: teams.get(x.team_id) ?? null, genre: x.genre, url: x.url ?? null, titre: x.titre, description: x.description, instant: x.instant === null ? null : Number(x.instant), statut: x.statut, motif: x.motif ?? null, date: x.cree_le })),
    cmFichiers: (await q("SELECT nom_original, taille, type_mime, cree_le FROM cm_fichiers WHERE depose_par = ? AND supprime_le IS NULL ORDER BY cree_le")).map(f => ({ nom: f.nom_original, taille: Number(f.taille), type: f.type_mime, date: f.cree_le })),
  };
}

/** Instructions d'effacement (à mettre dans le lot de la suppression du compte). */
export async function effacementCm(base, compte) {
  const lot = [
    { sql: 'DELETE FROM cm_affectations WHERE compte_id = ?', params: [compte] },
    { sql: 'DELETE FROM cm_carte_membres WHERE compte_id = ?', params: [compte] },
    { sql: 'UPDATE cm_commentaires SET auteur_id = NULL WHERE auteur_id = ?', params: [compte] },
    { sql: 'UPDATE cm_activite SET acteur_id = NULL WHERE acteur_id = ?', params: [compte] },
    { sql: 'UPDATE cm_clips SET propose_par = NULL WHERE propose_par = ?', params: [compte] },
    { sql: 'UPDATE cm_clips SET decide_par = NULL WHERE decide_par = ?', params: [compte] },
    { sql: 'UPDATE cm_pieces SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: "UPDATE cm_fichiers SET depose_par = '' WHERE depose_par = ?", params: [compte] },
    { sql: 'UPDATE cm_tableaux SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: 'UPDATE cm_imports SET importe_par = NULL WHERE importe_par = ?', params: [compte] },
    { sql: 'UPDATE cm_reglages SET maj_par = NULL WHERE maj_par = ?', params: [compte] },
    { sql: 'UPDATE cm_affectations SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
  ];
  lot.push(
    { sql: 'UPDATE cm_cartes SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: 'UPDATE cm_cartes SET maj_par = NULL WHERE maj_par = ?', params: [compte] },
    { sql: 'UPDATE cm_cartes SET soumis_par = NULL WHERE soumis_par = ?', params: [compte] },
    { sql: 'UPDATE cm_cartes SET valide_par = NULL WHERE valide_par = ?', params: [compte] },
    { sql: 'UPDATE cm_cartes SET refuse_par = NULL WHERE refuse_par = ?', params: [compte] },
    { sql: 'UPDATE cm_cartes SET publie_par = NULL WHERE publie_par = ?', params: [compte] },
  );
  // Membres liés aux posts (liens.membres, JSON) : le compte en est retiré.
  for (const c of await base.tous('SELECT id, liens FROM cm_cartes WHERE liens LIKE ?', [`%"${compte}"%`])) {
    const liens = jsonOu(c.liens, {});
    if (!Array.isArray(liens.membres) || !liens.membres.includes(compte)) continue;
    liens.membres = liens.membres.filter(m => m !== compte);
    if (!liens.membres.length) delete liens.membres;
    lot.push({ sql: 'UPDATE cm_cartes SET liens = ? WHERE id = ?', params: [JSON.stringify(liens), c.id] });
  }
  return lot;
}
