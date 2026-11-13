/**
 * RGPD du module Plan de match (migration 0083) : ce que l'export d'un compte contient, et ce que sa suppression
 * efface. Les plans restent à la team ; le compte n'en est plus l'auteur et sort des compositions (son pseudo y reste
 * comme simple texte).
 */

import { jsonOu } from '../outils.mjs';

/** Plans créés par le compte, et lignes de composition qui le désignent. */
export async function exportPlans(base, compte) {
  const nomsTeams = new Map((await base.tous('SELECT id, nom FROM teams', [])).map(t => [t.id, t.nom]));
  const crees = await base.tous('SELECT team_id, titre, statut, date_match, adversaire_nom, cree_le FROM plans_match WHERE cree_par = ? AND supprime_le IS NULL ORDER BY cree_le LIMIT 5000', [compte]);
  const avecLui = await base.tous('SELECT team_id, titre, contenu FROM plans_match WHERE supprime_le IS NULL AND contenu LIKE ? LIMIT 5000', [`%"membre":"${compte}"%`]);
  return {
    plansMatch: crees.map(p => ({ team: nomsTeams.get(p.team_id) ?? null, titre: p.titre, statut: p.statut, date: p.date_match ?? null, adversaire: p.adversaire_nom || null, creeLe: p.cree_le })),
    plansMatchRoles: avecLui.flatMap(p =>
      (jsonOu(p.contenu, {})?.cartes ?? []).flatMap(k =>
        (k.compo ?? []).filter(l => l.membre === compte).map(l => ({ team: nomsTeams.get(p.team_id) ?? null, plan: p.titre, carte: k.carte?.nom ?? null, personnage: l.personnage?.nom ?? null, role: l.role || null })),
      ),
    ),
  };
}

/** Instructions SQL de la suppression d'un compte (à exécuter dans le lot de l'effacement). */
export async function effacementPlans(base, compte, pseudo = '') {
  const lot = [
    { sql: 'UPDATE plans_match SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: 'UPDATE plans_match SET maj_par = NULL WHERE maj_par = ?', params: [compte] },
    { sql: 'UPDATE plans_match SET pret_par = NULL WHERE pret_par = ?', params: [compte] },
    { sql: 'UPDATE plans_match SET supprime_par = NULL WHERE supprime_par = ?', params: [compte] },
  ];
  const avecLui = await base.tous('SELECT id, contenu FROM plans_match WHERE contenu LIKE ? LIMIT 5000', [`%"membre":"${compte}"%`]);
  for (const p of avecLui) {
    const c = jsonOu(p.contenu, null);
    if (!c || !Array.isArray(c.cartes)) continue;
    for (const k of c.cartes) for (const l of k.compo ?? []) if (l.membre === compte) Object.assign(l, { membre: null, nom: l.nom || pseudo || '' });
    lot.push({ sql: 'UPDATE plans_match SET contenu = ? WHERE id = ?', params: [JSON.stringify(c), p.id] });
  }
  return lot;
}
