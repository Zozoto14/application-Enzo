/**
 * RGPD de la rubrique Sponsors, pour un COMPTE de l'app (les contacts des entreprises, eux, s'exportent et
 * s'effacent par adresse e-mail : service.mjs, `rgpdExport` / `rgpdEffacer`).
 *
 *  - Export : fiches dont le compte est responsable, échanges qu'il a notés.
 *  - Suppression du compte : il n'est plus responsable de rien ; ce qu'il a écrit pour le club (fiches,
 *    échanges, pièces) reste, sans auteur.
 */

export async function exportSponsors(base, compte) {
  const q = (sql, params = [compte]) => base.tous(`${sql} LIMIT 5000`, params);
  return {
    sponsorsProspectsSuivis: (await q('SELECT nom, cree_le FROM sp_prospects WHERE responsable_id = ? AND supprime_le IS NULL ORDER BY nom')).map(p => ({ nom: p.nom, depuis: p.cree_le })),
    sponsorsPartenairesSuivis: (await q('SELECT nom, cree_le FROM sp_partenaires WHERE responsable_id = ? AND supprime_le IS NULL ORDER BY nom')).map(p => ({ nom: p.nom, depuis: p.cree_le })),
    sponsorsEchanges: (await q('SELECT genre, date, resume FROM sp_echanges WHERE auteur_id = ? AND supprime_le IS NULL ORDER BY date')).map(e => ({ genre: e.genre, date: e.date, resume: e.resume })),
  };
}

/** Instructions d'effacement (à mettre dans le lot de la suppression du compte). */
export function effacementSponsors(compte) {
  return [
    { sql: 'UPDATE sp_prospects SET responsable_id = NULL WHERE responsable_id = ?', params: [compte] },
    { sql: 'UPDATE sp_prospects SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: 'UPDATE sp_prospects SET maj_par = NULL WHERE maj_par = ?', params: [compte] },
    { sql: 'UPDATE sp_partenaires SET responsable_id = NULL WHERE responsable_id = ?', params: [compte] },
    { sql: 'UPDATE sp_partenaires SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: 'UPDATE sp_partenaires SET maj_par = NULL WHERE maj_par = ?', params: [compte] },
    { sql: 'UPDATE sp_contrats SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: 'UPDATE sp_obligations SET responsable_id = NULL WHERE responsable_id = ?', params: [compte] },
    { sql: 'UPDATE sp_obligations SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: 'UPDATE sp_suivi SET maj_par = NULL WHERE maj_par = ?', params: [compte] },
    { sql: 'UPDATE sp_echanges SET auteur_id = NULL WHERE auteur_id = ?', params: [compte] },
    { sql: 'UPDATE sp_pieces SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
  ];
}
