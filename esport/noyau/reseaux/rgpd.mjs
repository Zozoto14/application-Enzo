/**
 * RGPD de la page « Réseaux » pour un COMPTE de l'app. Les comptes des réseaux sont ceux du club et des teams
 * (pas des personnes) ; un compte de l'app n'y laisse que sa trace d'auteur.
 *
 *  - Export : comptes réseaux qu'il a ajoutés, publications qu'il a ajoutées, nombre de relevés saisis.
 *  - Suppression du compte : ce qu'il a saisi pour le club reste, sans auteur.
 */

export async function exportReseaux(base, compte) {
  const q = (sql, params = [compte]) => base.tous(`${sql} LIMIT 5000`, params);
  const n = async sql => Number((await base.premier(sql, [compte]))?.n ?? 0);
  return {
    reseauxComptesAjoutes: (await q('SELECT reseau, identifiant, cree_le FROM cm_rs_comptes WHERE cree_par = ? ORDER BY cree_le')).map(c => ({ reseau: c.reseau, identifiant: c.identifiant, le: c.cree_le })),
    reseauxPublicationsAjoutees: (await q('SELECT reseau, url, titre, cree_le FROM cm_rs_publications WHERE cree_par = ? AND carte_id IS NULL ORDER BY cree_le')).map(p => ({ reseau: p.reseau, url: p.url, titre: p.titre, le: p.cree_le })),
    reseauxRelevesSaisis: (await n('SELECT COUNT(*) AS n FROM cm_rs_releves_posts WHERE saisi_par = ?')) + (await n('SELECT COUNT(*) AS n FROM cm_rs_releves_comptes WHERE saisi_par = ?')),
  };
}

/** Instructions d'effacement (dans le lot de la suppression du compte). */
export function effacementReseaux(compte) {
  return [
    { sql: 'UPDATE cm_rs_comptes SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: 'UPDATE cm_rs_comptes SET maj_par = NULL WHERE maj_par = ?', params: [compte] },
    { sql: 'UPDATE cm_rs_salons SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: 'UPDATE cm_rs_publications SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: 'UPDATE cm_rs_publications SET maj_par = NULL WHERE maj_par = ?', params: [compte] },
    { sql: 'UPDATE cm_rs_releves_posts SET saisi_par = NULL WHERE saisi_par = ?', params: [compte] },
    { sql: 'UPDATE cm_rs_releves_comptes SET saisi_par = NULL WHERE saisi_par = ?', params: [compte] },
  ];
}
