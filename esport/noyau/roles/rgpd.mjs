/**
 * Rôles du club (migration 0033) et RGPD : export des rôles d'un compte ; effacement (ses rôles disparaissent, ce
 * qu'il a attribué reste, sans auteur ; le modèle des teams qu'il a réglé reste, sans auteur).
 */

export async function exportRoles(base, compte) {
  const lignes = await base.tous(
    'SELECT r.nom, a.attribue_le FROM roles_globaux_affectations a JOIN roles_globaux r ON r.id = a.role_id WHERE a.compte_id = ? ORDER BY a.attribue_le',
    [compte],
  );
  return { rolesClub: lignes.map(l => ({ role: l.nom, depuis: l.attribue_le })) };
}

export function effacementRoles(compte) {
  return [
    { sql: 'DELETE FROM roles_globaux_affectations WHERE compte_id = ?', params: [compte] },
    { sql: 'UPDATE roles_globaux_affectations SET attribue_par = NULL WHERE attribue_par = ?', params: [compte] },
    { sql: 'UPDATE roles_modele SET maj_par = NULL WHERE maj_par = ?', params: [compte] },
  ];
}
