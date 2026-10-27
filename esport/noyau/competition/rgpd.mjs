/**
 * RGPD des modules « Tournois » et « Résultats » : ce que la suppression d'un compte efface. Le compte
 * quitte les rosters ; ses lignes de résultat (alignement, personnages, statistiques) restent pour
 * l'historique de la team, mais anonymes ; il n'est plus MVP ; il n'est plus l'auteur de rien.
 */
export function effacementCompetition(compte) {
  return [
    { sql: 'DELETE FROM tournoi_roster WHERE compte_id = ?', params: [compte] },
    { sql: 'UPDATE resultat_joueurs SET compte_id = NULL, stats = ? WHERE compte_id = ?', params: ['{}', compte] },
    { sql: 'UPDATE resultats SET mvp_id = NULL WHERE mvp_id = ?', params: [compte] },
    { sql: 'UPDATE resultats SET saisi_par = NULL WHERE saisi_par = ?', params: [compte] },
    { sql: 'UPDATE tournois SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: 'UPDATE tournois SET inscrit_par = NULL WHERE inscrit_par = ?', params: [compte] },
    { sql: 'UPDATE tournois SET checkin_par = NULL WHERE checkin_par = ?', params: [compte] },
    { sql: 'UPDATE tournoi_matchs SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
  ];
}
