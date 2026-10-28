/**
 * RGPD de la section CM.
 *
 *  - Export (droit d'accès) : rôles CM, cartes créées, cartes où le compte est assigné, commentaires,
 *    clips proposés, fichiers déposés, modèles de visuels et visuels créés, fichiers du Drive et favoris.
 *  - Suppression du compte : ses affectations et ses assignations disparaissent ; ce qu'il a écrit pour le
 *    club (cartes, commentaires, clips, pièces jointes, modèles et visuels) reste, sans auteur (« Compte
 *    supprimé ») ; il est retiré des membres liés aux posts.
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
    cmModeles: (await q('SELECT nom, type, portee, cree_le FROM cm_modeles WHERE cree_par = ? AND supprime_le IS NULL ORDER BY cree_le')).map(m => ({ nom: m.nom, type: m.type, portee: m.portee === 'club' ? 'club' : (teams.get(m.portee) ?? m.portee), creeLe: m.cree_le })),
    // Drive (migration 0027) : fichiers déposés (ou ajoutés en version) et favoris.
    cmDrive: (await q('SELECT nom, type_mime, taille, portee, version, cree_le FROM cm_drive_fichiers WHERE cree_par = ? AND supprime_le IS NULL ORDER BY cree_le')).map(f => ({ nom: f.nom, type: f.type_mime, taille: Number(f.taille), version: Number(f.version), portee: f.portee === 'club' ? 'club' : (teams.get(f.portee) ?? f.portee), date: f.cree_le })),
    cmDriveFavoris: (await q('SELECT genre, cree_le FROM cm_drive_favoris WHERE compte_id = ? ORDER BY cree_le')).map(f => ({ genre: f.genre, date: f.cree_le })),
    cmVisuels: (await q('SELECT nom, type, format, langue, portee, cree_le FROM cm_visuels WHERE cree_par = ? AND supprime_le IS NULL ORDER BY cree_le')).map(v => ({ nom: v.nom, type: v.type, format: v.format, langue: v.langue, portee: v.portee === 'club' ? 'club' : (teams.get(v.portee) ?? v.portee), creeLe: v.cree_le })),
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
    { sql: 'UPDATE cm_charte SET maj_par = NULL WHERE maj_par = ?', params: [compte] },
    { sql: 'UPDATE cm_modeles SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: 'UPDATE cm_modeles SET maj_par = NULL WHERE maj_par = ?', params: [compte] },
    { sql: 'UPDATE cm_modele_versions SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: 'UPDATE cm_visuels SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: 'UPDATE cm_visuels SET maj_par = NULL WHERE maj_par = ?', params: [compte] },
    { sql: 'UPDATE cm_visuels SET rendu_par = NULL WHERE rendu_par = ?', params: [compte] },
    { sql: 'UPDATE cm_visuel_images SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    // Drive (migration 0027) : ses fichiers restent au club, sans auteur ; ses favoris disparaissent.
    { sql: 'DELETE FROM cm_drive_favoris WHERE compte_id = ?', params: [compte] },
    { sql: 'UPDATE cm_drive_fichiers SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: 'UPDATE cm_drive_fichiers SET maj_par = NULL WHERE maj_par = ?', params: [compte] },
    { sql: 'UPDATE cm_drive_fichiers SET supprime_par = NULL WHERE supprime_par = ?', params: [compte] },
    { sql: 'UPDATE cm_drive_versions SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: 'UPDATE cm_drive_dossiers SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: 'UPDATE cm_drive_dossiers SET maj_par = NULL WHERE maj_par = ?', params: [compte] },
    { sql: 'UPDATE cm_drive_dossiers SET supprime_par = NULL WHERE supprime_par = ?', params: [compte] },
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
  // Visuels d'un membre (recrue, départ, MVP) : la source désignant le compte devient « libre » (le rendu reste).
  for (const v of await base.tous("SELECT id, source FROM cm_visuels WHERE source LIKE ?", [`%"${compte}"%`])) {
    const source = jsonOu(v.source, {});
    if (source.genre !== 'membre' || source.id !== compte) continue;
    lot.push({ sql: 'UPDATE cm_visuels SET source = ? WHERE id = ?', params: [JSON.stringify({ genre: 'libre', teamId: source.teamId ?? null, id: null, date: null }), v.id] });
  }
  return lot;
}
