/**
 * Devblog (migration 0036) et RGPD : export des devblogs vus par le compte ; à la suppression du compte, ses
 * marques « vu » sont effacées ; les devblogs qu'il a écrits ou publiés restent (textes du club), sans auteur.
 */

export async function exportDevblog(base, compte) {
  const vus = await base.tous('SELECT v.entree_id, v.vu_le, e.date_maj FROM devblog_vus v LEFT JOIN devblog_entrees e ON e.id = v.entree_id WHERE v.compte_id = ? ORDER BY v.vu_le', [compte]);
  return { devblogVus: vus.map(v => ({ devblog: v.entree_id, date: v.date_maj ?? null, vuLe: v.vu_le })) };
}

export function effacementDevblog(compte) {
  return [
    { sql: 'DELETE FROM devblog_vus WHERE compte_id = ?', params: [compte] },
    { sql: 'UPDATE devblog_entrees SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: 'UPDATE devblog_entrees SET maj_par = NULL WHERE maj_par = ?', params: [compte] },
    { sql: 'UPDATE devblog_entrees SET publie_par = NULL WHERE publie_par = ?', params: [compte] },
    { sql: 'UPDATE devblog_discord SET demande_par = NULL WHERE demande_par = ?', params: [compte] },
    { sql: 'UPDATE devblog_reglages SET maj_par = NULL WHERE maj_par = ?', params: [compte] },
    { sql: 'UPDATE devblog_entrees SET programme_par = NULL WHERE programme_par = ?', params: [compte] },
    { sql: 'UPDATE devblog_auto SET demande_par = NULL WHERE demande_par = ?', params: [compte] },
  ];
}
