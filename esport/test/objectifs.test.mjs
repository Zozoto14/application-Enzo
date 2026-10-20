/**
 * Objectifs et tâches (phase 3) : droits, progression calculée, filtres
 * « mes tâches » / « en retard », notifications d'assignation et rappels
 * d'échéance (cron), isolation entre teams.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { dateDuJour, progression, rappelsEcheances } from '../noyau/objectifs.mjs';
import { distribuer } from '../noyau/evenements.mjs';

const MEMBRES = {
  coach123: { pseudo: 'Coach Zed', role: 'coach' },
  lea12345: { pseudo: 'Léa', role: 'joueur' },
  kai12345: { pseudo: 'Kai', role: 'joueur' },
};

test('progression : faites / total, arrondie ; 0 % sans tâche', () => {
  assert.deepEqual(progression([]), { total: 0, faites: 0, pourcentage: 0 });
  assert.deepEqual(progression([{ statut: 'fait' }, { statut: 'a_faire' }, { statut: 'en_cours' }]), { total: 3, faites: 1, pourcentage: 33 });
  assert.equal(dateDuJour(Date.parse('2026-10-20T23:30:00Z'), 'Europe/Paris'), '2026-10-21', 'jour dans le fuseau de la team');
  assert.equal(dateDuJour(Date.parse('2026-10-20T23:30:00Z'), 'Fuseau/Inconnu'), '2026-10-20');
});

test('objectifs : progression calculée à partir des tâches, objectif de joueur, suppression qui garde les tâches', async () => {
  const b = await banc();
  const { teamId, sessions } = await teamAvecMembres(b, { membres: MEMBRES });
  const c = sessions.coach123;
  let r = await b.appel(`/teams/${teamId}/objectifs`, { methode: 'POST', jeton: c, corps: { titre: 'Monter Immortel', dateCible: '2026-12-31' } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  const equipe = r.corps.id;
  assert.equal(r.corps.proprietaire, null, 'objectif d’équipe');
  r = await b.appel(`/teams/${teamId}/objectifs`, { methode: 'POST', jeton: c, corps: { titre: 'Aim 30 min / jour', proprietaire: 'lea12345' } });
  assert.equal(r.corps.proprietaire.pseudo, 'Léa');
  assert.equal((await b.appel(`/teams/${teamId}/objectifs`, { methode: 'POST', jeton: c, corps: { titre: 'X', proprietaire: 'inconnu12' } })).statut, 400);
  const ids = [];
  for (const titre of ['Retakes B', 'Executes A', 'Anti-eco', 'Default']) {
    ids.push((await b.appel(`/teams/${teamId}/taches`, { methode: 'POST', jeton: c, corps: { titre, objectifId: equipe } })).corps.id);
  }
  await b.appel(`/teams/${teamId}/taches/${ids[0]}`, { methode: 'PATCH', jeton: c, corps: { statut: 'fait' } });
  let objectifs = (await b.appel(`/teams/${teamId}/objectifs`, { jeton: sessions.lea12345 })).corps.objectifs;
  assert.deepEqual(objectifs.find(o => o.id === equipe).progression, { total: 4, faites: 1, pourcentage: 25 });
  await b.appel(`/teams/${teamId}/taches/${ids[1]}`, { methode: 'PATCH', jeton: c, corps: { statut: 'fait' } });
  await b.appel(`/teams/${teamId}/taches/${ids[3]}`, { methode: 'DELETE', jeton: c });
  objectifs = (await b.appel(`/teams/${teamId}/objectifs`, { jeton: c })).corps.objectifs;
  assert.deepEqual(objectifs.find(o => o.id === equipe).progression, { total: 3, faites: 2, pourcentage: 67 }, 'une tâche supprimée ne compte plus');
  r = await b.appel(`/teams/${teamId}/objectifs/${equipe}`, { methode: 'PATCH', jeton: c, corps: { statut: 'atteint' } });
  assert.equal(r.corps.statut, 'atteint');
  assert.equal((await b.appel(`/teams/${teamId}/objectifs/${equipe}`, { methode: 'DELETE', jeton: c })).statut, 200);
  const taches = (await b.appel(`/teams/${teamId}/taches`, { jeton: c })).corps.taches;
  assert.equal(taches.length, 3, 'les tâches restent');
  assert.ok(taches.every(t => t.objectif === null));
});

test('droits : le Joueur lit et fait avancer SA tâche, mais ne crée, n’assigne ni ne modifie le reste', async () => {
  const b = await banc();
  const { teamId, sessions } = await teamAvecMembres(b, { membres: MEMBRES });
  const c = sessions.coach123;
  const l = sessions.lea12345;
  const sienne = (await b.appel(`/teams/${teamId}/taches`, { methode: 'POST', jeton: c, corps: { titre: 'Revoir la VOD', assigne: 'lea12345', priorite: 'haute' } })).corps;
  assert.equal(sienne.assigne.pseudo, 'Léa');
  const autre = (await b.appel(`/teams/${teamId}/taches`, { methode: 'POST', jeton: c, corps: { titre: 'Lineups', assigne: 'kai12345' } })).corps;
  assert.equal((await b.appel(`/teams/${teamId}/taches`, { methode: 'POST', jeton: l, corps: { titre: 'Moi' } })).statut, 403);
  assert.equal((await b.appel(`/teams/${teamId}/taches/${sienne.id}`, { methode: 'PATCH', jeton: l, corps: { statut: 'en_cours' } })).corps.statut, 'en_cours');
  assert.equal((await b.appel(`/teams/${teamId}/taches/${sienne.id}`, { methode: 'PATCH', jeton: l, corps: { titre: 'Autre titre' } })).statut, 403);
  assert.equal((await b.appel(`/teams/${teamId}/taches/${sienne.id}`, { methode: 'PATCH', jeton: l, corps: { assigne: 'kai12345' } })).statut, 403);
  assert.equal((await b.appel(`/teams/${teamId}/taches/${autre.id}`, { methode: 'PATCH', jeton: l, corps: { statut: 'fait' } })).statut, 403);
  assert.equal((await b.appel(`/teams/${teamId}/taches/${autre.id}`, { methode: 'DELETE', jeton: l })).statut, 403);
  assert.equal((await b.appel(`/teams/${teamId}/objectifs`, { methode: 'POST', jeton: l, corps: { titre: 'Moi' } })).statut, 403);
  // Valeurs refusées.
  assert.equal((await b.appel(`/teams/${teamId}/taches`, { methode: 'POST', jeton: c, corps: { titre: 'X1', priorite: 'extreme' } })).statut, 400);
  assert.equal((await b.appel(`/teams/${teamId}/taches`, { methode: 'POST', jeton: c, corps: { titre: 'X2', echeance: '2026-13-01' } })).statut, 400);
  assert.equal((await b.appel(`/teams/${teamId}/taches`, { methode: 'POST', jeton: c, corps: { titre: 'X3', assigne: 'etranger1' } })).statut, 400);
  // Module désactivé : 404.
  await b.appel(`/teams/${teamId}/modules`, { methode: 'PUT', jeton: sessions.fondateur, corps: { modules: { goals_tasks: false } } });
  const r = await b.appel(`/teams/${teamId}/taches`, { jeton: c });
  assert.equal(r.statut, 404);
  assert.equal(r.corps.code, 'module-desactive');
});

test('filtres : « mes tâches », « en retard » (fuseau de la team), statut ; tri par échéance puis priorité', async () => {
  const b = await banc();
  const { teamId, sessions } = await teamAvecMembres(b, { membres: MEMBRES });
  const c = sessions.coach123;
  const creer = corps => b.appel(`/teams/${teamId}/taches`, { methode: 'POST', jeton: c, corps });
  await creer({ titre: 'Sans échéance', assigne: 'lea12345' });
  await creer({ titre: 'Hier', assigne: 'lea12345', echeance: '2026-10-19' });
  await creer({ titre: 'Hier, faite', assigne: 'kai12345', echeance: '2026-10-19', statut: 'fait' });
  await creer({ titre: 'Demain urgente', assigne: 'kai12345', echeance: '2026-10-21', priorite: 'urgente' });
  await creer({ titre: 'Demain basse', echeance: '2026-10-21', priorite: 'basse' });
  const titres = async q => (await b.appel(`/teams/${teamId}/taches${q}`, { jeton: sessions.lea12345 })).corps.taches.map(t => t.titre);
  assert.deepEqual(await titres(''), ['Hier', 'Hier, faite', 'Demain urgente', 'Demain basse', 'Sans échéance']);
  assert.deepEqual(await titres('?filtre=miennes'), ['Hier', 'Sans échéance']);
  assert.deepEqual(await titres('?filtre=retard'), ['Hier']);
  assert.deepEqual(await titres('?statut=fait'), ['Hier, faite']);
  const liste = (await b.appel(`/teams/${teamId}/taches`, { jeton: c })).corps;
  assert.equal(liste.jour, '2026-10-20');
  assert.equal(liste.taches.find(t => t.titre === 'Hier').enRetard, true);
  assert.equal(liste.taches.find(t => t.titre === 'Hier, faite').enRetard, false);
  assert.equal((await b.appel(`/teams/${teamId}/taches?filtre=tout`, { jeton: c })).statut, 400);
});

test('notifications : à l’assignation (pas à soi-même), puis rappel d’échéance par le cron, une seule fois', async () => {
  const b = await banc();
  const { teamId, sessions } = await teamAvecMembres(b, { membres: MEMBRES });
  const c = sessions.coach123;
  const t1 = (await b.appel(`/teams/${teamId}/taches`, { methode: 'POST', jeton: c, corps: { titre: 'Préparer le scrim', assigne: 'lea12345', echeance: '2026-10-21' } })).corps;
  await b.appel(`/teams/${teamId}/taches`, { methode: 'POST', jeton: c, corps: { titre: 'Pour moi', assigne: 'coach123', echeance: '2026-10-21' } });
  await b.appel(`/teams/${teamId}/taches`, { methode: 'POST', jeton: c, corps: { titre: 'Plus tard', assigne: 'kai12345', echeance: '2026-11-30' } });
  const notifs = async jeton => (await b.appel('/notifications', { jeton })).corps.liste;
  const assignee = (await notifs(sessions.lea12345)).find(n => n.type === 'tache-assignee');
  assert.equal(assignee.charge.titre, 'Préparer le scrim');
  assert.ok(!(await notifs(c)).some(n => n.type === 'tache-assignee'), 'pas de notification pour une tâche que l’on s’assigne');
  // Réassignation : le nouvel assigné est prévenu.
  await b.appel(`/teams/${teamId}/taches/${t1.id}`, { methode: 'PATCH', jeton: c, corps: { assigne: 'kai12345' } });
  assert.ok((await notifs(sessions.kai12345)).some(n => n.type === 'tache-assignee' && n.charge.titre === 'Préparer le scrim'));
  // Cron : échéance demain → un rappel (Kai, coach) ; « plus tard » : rien.
  assert.equal(await rappelsEcheances(b.base, { maintenant: b.horloge.t }), 2);
  await distribuer(b.base, { maintenant: b.horloge.t });
  assert.equal(await rappelsEcheances(b.base, { maintenant: b.horloge.t }), 0, 'une seule fois par échéance');
  const kai = (await notifs(sessions.kai12345)).filter(n => n.type === 'tache-echeance');
  assert.deepEqual(kai.map(n => [n.charge.titre, n.charge.retard]), [['Préparer le scrim', false]]);
  // Nouvelle échéance : le rappel repart ; tâche faite : plus de rappel.
  await b.appel(`/teams/${teamId}/taches/${t1.id}`, { methode: 'PATCH', jeton: c, corps: { echeance: '2026-10-18' } });
  assert.equal(await rappelsEcheances(b.base, { maintenant: b.horloge.t }), 1);
  await distribuer(b.base, { maintenant: b.horloge.t });
  assert.ok((await notifs(sessions.kai12345)).some(n => n.type === 'tache-echeance' && n.charge.retard === true));
  const journal = (await b.appel(`/teams/${teamId}/journal`, { jeton: sessions.fondateur })).corps.entrees.map(e => e.action);
  for (const a of ['task.created', 'task.assigned', 'task.updated', 'task.due_soon']) assert.ok(journal.includes(a), a);
});

test('isolation : tâches et objectifs de la team B introuvables depuis la team A', async () => {
  const b = await banc();
  const A = await teamAvecMembres(b, { nom: 'Team A', membres: { coach123: MEMBRES.coach123 } });
  const B = await teamAvecMembres(b, { nom: 'Team B', membres: { kai12345: MEMBRES.kai12345 } });
  const tB = (await b.appel(`/teams/${B.teamId}/taches`, { methode: 'POST', jeton: B.sessions.fondateur, corps: { titre: 'Secret' } })).corps.id;
  const oB = (await b.appel(`/teams/${B.teamId}/objectifs`, { methode: 'POST', jeton: B.sessions.fondateur, corps: { titre: 'Secret' } })).corps.id;
  const c = A.sessions.coach123;
  assert.equal((await b.appel(`/teams/${B.teamId}/taches`, { jeton: c })).statut, 404);
  assert.equal((await b.appel(`/teams/${A.teamId}/taches/${tB}`, { methode: 'PATCH', jeton: c, corps: { statut: 'fait' } })).statut, 404);
  assert.equal((await b.appel(`/teams/${A.teamId}/taches/${tB}`, { methode: 'DELETE', jeton: c })).statut, 404);
  assert.equal((await b.appel(`/teams/${A.teamId}/objectifs/${oB}`, { methode: 'PATCH', jeton: c, corps: { titre: 'Pris' } })).statut, 404);
  assert.equal((await b.appel(`/teams/${A.teamId}/taches`, { methode: 'POST', jeton: c, corps: { titre: 'Lien', objectifId: oB } })).statut, 400);
  // Assigner à un membre de B depuis A : refusé.
  assert.equal((await b.appel(`/teams/${A.teamId}/taches`, { methode: 'POST', jeton: c, corps: { titre: 'Kai', assigne: 'kai12345' } })).statut, 400);
});
