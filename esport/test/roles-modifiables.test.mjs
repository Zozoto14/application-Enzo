/**
 * Rôles modifiables après création (Esport › team › Équipe › Membres et rôles) :
 *  - rôle personnalisé : nom, couleur, permissions ;
 *  - rôle système (Manager, Coach…) : permissions propres à la team, « Rétablir par défaut » ;
 *  - garde-fous serveur : Propriétaire verrouillé, anti-escalade, hiérarchie, au moins un
 *    gestionnaire des rôles, isolation entre teams ; effet immédiat ; journal (ajouts, retraits).
 * Tourne sur SQLite et, avec ESPORT_TEST_PG, sur PostgreSQL.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { ASCENT } from './strats-aide.mjs';

const MEMBRES = {
  max12345: { pseudo: 'Max', role: 'manager' },
  coach123: { pseudo: 'Coach Zed', role: 'coach' },
  lea12345: { pseudo: 'Léa', role: 'joueur' },
};

async function preparer() {
  const b = await banc();
  const A = await teamAvecMembres(b, { membres: MEMBRES });
  const api = (chemin, jeton, options = {}) => b.appel(chemin, { jeton, ...options });
  const roles = async (teamId = A.teamId) => Object.fromEntries((await api(`/teams/${teamId}/roles`, A.sessions.fondateur)).corps.roles.map(r => [r.cle ?? r.nom, r]));
  const patch = (roleId, corps, jeton = A.sessions.fondateur, teamId = A.teamId) => api(`/teams/${teamId}/roles/${roleId}`, jeton, { methode: 'PATCH', corps });
  const retablir = (roleId, jeton = A.sessions.fondateur, teamId = A.teamId) => api(`/teams/${teamId}/roles/${roleId}/retablir`, jeton, { methode: 'POST' });
  return { b, A, api, roles, patch, retablir };
}

test('rôle système : le Fondateur retire « strats.create » au Coach (effet immédiat, 403), puis rétablit les permissions par défaut', async () => {
  const { A, api, roles, patch, retablir } = await preparer();
  const coach = (await roles()).coach;
  assert.equal(coach.modifie, false);
  assert.ok(coach.permissionsParDefaut.includes('strats.create'));
  const creerStrat = () => api(`/teams/${A.teamId}/strats`, A.sessions.coach123, { methode: 'POST', corps: { titre: 'Exec A', type: 'execute', carte: ASCENT, side: 'attaque' } });
  assert.equal((await creerStrat()).statut, 200);

  const r = await patch(coach.id, { permissions: coach.permissions.filter(p => p !== 'strats.create') });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.modifie, true);
  assert.ok(!r.corps.permissions.includes('strats.create'));
  // Même session, requête suivante : la permission a disparu.
  assert.ok(!(await api(`/teams/${A.teamId}`, A.sessions.coach123)).corps.moi.permissions.includes('strats.create'));
  const refus = await creerStrat();
  assert.equal(refus.statut, 403);
  assert.equal(refus.corps.code, 'permission');

  // Journal : qui, quel rôle, ajouts et retraits.
  const journal = (await api(`/teams/${A.teamId}/journal`, A.sessions.fondateur)).corps.entrees;
  const e = journal.find(x => x.action === 'role.updated');
  assert.ok(e, 'entrée de journal');
  assert.equal(e.meta.nom, 'Coach');
  assert.deepEqual(e.meta.retirees, ['strats.create']);
  assert.deepEqual(e.meta.ajoutees, []);

  // Rétablir par défaut.
  const ret = await retablir(coach.id);
  assert.equal(ret.statut, 200, JSON.stringify(ret.corps));
  assert.equal(ret.corps.modifie, false);
  assert.deepEqual(ret.corps.permissions, coach.permissions);
  assert.equal((await creerStrat()).statut, 200);
  const j2 = (await api(`/teams/${A.teamId}/journal`, A.sessions.fondateur)).corps.entrees.filter(x => x.action === 'role.updated');
  assert.ok(j2.some(x => x.meta.retabli === true && x.meta.ajoutees.includes('strats.create')));

  // Nom et couleur d'un rôle système : non ; rétablir un rôle personnalisé : non.
  assert.equal((await patch(coach.id, { nom: 'Entraîneur' })).corps.code, 'role-systeme');
  const perso = await api(`/teams/${A.teamId}/roles`, A.sessions.fondateur, { methode: 'POST', corps: { nom: 'Stratège', couleur: '#123456', permissions: ['strats.view'] } });
  assert.equal((await retablir(perso.corps.id)).statut, 400);
});

test('rôle système : ajout d’une permission hors défaut (Joueur + strats.create), isolé à la team', async () => {
  const { b, A, api, roles, patch } = await preparer();
  const B = await teamAvecMembres(b, { nom: 'Team Bravo', membres: { kai12345: { pseudo: 'Kai', role: 'joueur' } } });
  const joueur = (await roles()).joueur;
  const r = await patch(joueur.id, { permissions: [...joueur.permissions, 'strats.create', 'team.manage'] });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.ok((await api(`/teams/${A.teamId}`, A.sessions.lea12345)).corps.moi.permissions.includes('team.manage'));
  // La Team Bravo garde son Joueur par défaut.
  const joueurB = (await roles(B.teamId)).joueur;
  assert.equal(joueurB.modifie, false);
  assert.ok(!joueurB.permissions.includes('strats.create'));
  assert.ok(!(await api(`/teams/${B.teamId}`, B.sessions.kai12345)).corps.moi.permissions.includes('team.manage'));
  // Un rôle d'une autre team : 404.
  assert.equal((await patch(joueurB.id, { permissions: [] })).statut, 404);
  assert.equal((await api(`/teams/${A.teamId}/roles/${joueurB.id}/retablir`, A.sessions.fondateur, { methode: 'POST' })).statut, 404);
});

test('rôle personnalisé : nom, couleur et permissions modifiables après création', async () => {
  const { A, api, patch } = await preparer();
  const c = await api(`/teams/${A.teamId}/roles`, A.sessions.fondateur, { methode: 'POST', corps: { nom: 'Capitaine', couleur: '#123456', permissions: ['strats.view'] } });
  const r = await patch(c.corps.id, { nom: 'Capitaine IGL', couleur: '#ABCDEF', permissions: ['strats.view', 'strats.create', 'planning.view'] });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.nom, 'Capitaine IGL');
  assert.equal(r.corps.couleur, '#abcdef');
  assert.deepEqual(r.corps.permissions, ['planning.view', 'strats.create', 'strats.view']);
  assert.equal(r.corps.modifie, undefined, 'pas de « par défaut » pour un rôle personnalisé');
  const e = (await api(`/teams/${A.teamId}/journal`, A.sessions.fondateur)).corps.entrees.find(x => x.action === 'role.updated');
  assert.deepEqual(e.meta.ajoutees, ['planning.view', 'strats.create']);
});

test('garde-fous : Propriétaire verrouillé, hiérarchie, anti-escalade, non-gestionnaire', async () => {
  const { A, roles, patch, retablir } = await preparer();
  const rs = await roles();
  const max = A.sessions.max12345;
  // Propriétaire : jamais modifiable, même par le Fondateur.
  let r = await patch(rs.proprietaire.id, { permissions: ['members.view'] });
  assert.equal(r.statut, 403);
  assert.equal(r.corps.code, 'role-verrouille');
  assert.equal((await retablir(rs.proprietaire.id)).corps.code, 'role-verrouille');
  // Manager : ni un rôle supérieur, ni le sien.
  assert.equal((await patch(rs.proprietaire.id, { permissions: [] }, max)).statut, 403);
  r = await patch(rs.manager.id, { permissions: rs.manager.permissions.filter(p => p !== 'planning.view') }, max);
  assert.equal(r.statut, 403);
  assert.equal(r.corps.code, 'role-superieur');
  // Manager : un rôle inférieur, oui, mais sans donner ce qu'il n'a pas (members.create).
  r = await patch(rs.joueur.id, { permissions: [...rs.joueur.permissions, 'members.create'] }, max);
  assert.equal(r.statut, 403);
  assert.equal(r.corps.code, 'escalade');
  r = await patch(rs.joueur.id, { permissions: rs.joueur.permissions.filter(p => p !== 'planning.view') }, max);
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  // Retirer une permission que le Manager n'a pas (le Coach en a) reste possible ; en ajouter une, non.
  const enPlus = rs.coach.permissions.find(p => !rs.manager.permissions.includes(p));
  if (enPlus) {
    assert.equal((await patch(rs.coach.id, { permissions: rs.coach.permissions.filter(p => p !== enPlus) }, max)).statut, 200);
    assert.equal((await patch(rs.coach.id, { permissions: rs.coach.permissions }, max)).corps.code, 'escalade');
  }
  // Un Coach (sans roles.manage) ne modifie rien.
  r = await patch(rs.joueur.id, { permissions: [] }, A.sessions.coach123);
  assert.equal(r.statut, 403);
  assert.equal(r.corps.code, 'permission');
});

test('garde-fou : la team garde toujours quelqu’un capable de gérer les rôles', async () => {
  const { b, roles, patch, api } = await preparer();
  // Team dont le seul Propriétaire est suspendu : le Manager est le dernier gestionnaire des rôles.
  const C = await teamAvecMembres(b, { nom: 'Team Charlie', membres: { neo12345: { pseudo: 'Neo', role: 'proprietaire' }, max12345: { pseudo: 'Max', role: 'manager' } } });
  const rs = await roles(C.teamId);
  // Le Fondateur (super admin) se retire, Neo est suspendu : seul le Manager gère les rôles.
  const moi = (await api(`/teams/${C.teamId}/membres`, C.sessions.fondateur)).corps.membres.find(m => m.moi);
  await b.base.executer('DELETE FROM membres WHERE id = ?', [moi.id]);
  await b.base.executer("UPDATE membres SET statut = 'suspendu' WHERE id = ?", [C.membres.neo12345.id]);
  const r = await patch(rs.manager.id, { permissions: rs.manager.permissions.filter(p => p !== 'roles.manage') }, C.sessions.fondateur, C.teamId);
  assert.equal(r.statut, 409, JSON.stringify(r.corps));
  assert.equal(r.corps.code, 'dernier-gestionnaire');
  // Retirer autre chose reste possible.
  assert.equal((await patch(rs.manager.id, { permissions: rs.manager.permissions.filter(p => p !== 'planning.view') }, C.sessions.fondateur, C.teamId)).statut, 200);
});
