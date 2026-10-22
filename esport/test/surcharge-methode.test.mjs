/**
 * Surcharge de méthode (frontal mutualisé o2switch qui bloque ou perd PATCH, PUT, DELETE) :
 * un POST + `X-Methode` (ou `X-HTTP-Method-Override`) est traité EXACTEMENT comme l'original ;
 * seules PATCH, PUT et DELETE sont acceptées ; aucun contrôle n'est contourné.
 * Tourne sur SQLite et, avec ESPORT_TEST_PG, sur PostgreSQL.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JETON_MAITRE, banc, teamAvecMembres } from './aide.mjs';

const MEMBRES = { lea12345: { pseudo: 'Léa', role: 'joueur' } };

async function preparer() {
  const b = await banc();
  const A = await teamAvecMembres(b, { membres: MEMBRES });
  const roles = async () => Object.fromEntries((await b.appel(`/teams/${A.teamId}/roles`, { jeton: A.sessions.fondateur })).corps.roles.map(r => [r.cle ?? r.nom, r]));
  const surcharge = (chemin, methode, corps, { jeton = A.sessions.fondateur, entete = 'X-Methode', type } = {}) =>
    b.appel(chemin, { methode: 'POST', jeton, corps, entetes: { [entete]: methode }, ...(type ? { type } : {}) });
  return { b, A, roles, surcharge };
}

test('POST + X-Methode: PATCH modifie bien les permissions d’un rôle (comme un PATCH)', async () => {
  const { A, roles, surcharge } = await preparer();
  const coach = (await roles()).coach;
  const voulues = coach.permissions.filter(p => p !== 'strats.create');
  const r = await surcharge(`/teams/${A.teamId}/roles/${coach.id}`, 'PATCH', { permissions: voulues });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.modifie, true);
  assert.deepEqual((await roles()).coach.permissions.sort(), [...voulues].sort());
  // Variante standard, en minuscules : même effet.
  const r2 = await surcharge(`/teams/${A.teamId}/roles/${coach.id}`, 'patch', { permissions: coach.permissions }, { entete: 'X-HTTP-Method-Override' });
  assert.equal(r2.statut, 200, JSON.stringify(r2.corps));
  assert.ok((await roles()).coach.permissions.includes('strats.create'));
});

test('POST + X-Methode: DELETE supprime un rôle personnalisé ; PUT passe aussi', async () => {
  const { b, A, roles, surcharge } = await preparer();
  const perso = await b.appel(`/teams/${A.teamId}/roles`, { methode: 'POST', jeton: A.sessions.fondateur, corps: { nom: 'Stratège', couleur: '#123456', permissions: ['strats.view'] } });
  assert.equal(perso.statut, 200, JSON.stringify(perso.corps));
  const r = await surcharge(`/teams/${A.teamId}/roles/${perso.corps.id}`, 'DELETE');
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal((await roles()).Stratège, undefined);
  const p = await surcharge('/moi/langue', 'PUT', { langue: 'en' });
  assert.equal(p.statut, 200, JSON.stringify(p.corps));
});

test('méthode non autorisée dans X-Methode : refusée (400), rien n’est modifié', async () => {
  const { b, A, roles, surcharge } = await preparer();
  const coach = (await roles()).coach;
  const chemin = `/teams/${A.teamId}/roles/${coach.id}`;
  for (const m of ['GET', 'POST', 'OPTIONS', 'HEAD', 'TRACE', 'CONNECT', 'PATCH, DELETE', '']) {
    const r = await surcharge(chemin, m, { permissions: [] });
    assert.equal(r.statut, 400, `${m} : ${JSON.stringify(r.corps)}`);
    assert.equal(r.corps.code, 'methode');
  }
  // Deux en-têtes contradictoires : refus.
  const contradictoire = await b.appel(chemin, { methode: 'POST', jeton: A.sessions.fondateur, corps: { permissions: [] }, entetes: { 'X-Methode': 'PATCH', 'X-HTTP-Method-Override': 'DELETE' } });
  assert.equal(contradictoire.statut, 400);
  assert.equal(contradictoire.corps.code, 'methode');
  assert.deepEqual((await roles()).coach.permissions, coach.permissions);
});

test('aucun contournement : session, appartenance, permission et Content-Type JSON contrôlés comme l’original', async () => {
  const { b, A, roles, surcharge } = await preparer();
  const coach = (await roles()).coach;
  const chemin = `/teams/${A.teamId}/roles/${coach.id}`;
  // Sans session.
  const sans = await surcharge(chemin, 'PATCH', { permissions: [] }, { jeton: null });
  assert.equal(sans.statut, 401);
  // Joueur sans « roles.manage » : 403, comme un vrai PATCH.
  const joueur = await surcharge(chemin, 'PATCH', { permissions: [] }, { jeton: A.sessions.lea12345 });
  const vrai = await b.appel(chemin, { methode: 'PATCH', jeton: A.sessions.lea12345, corps: { permissions: [] } });
  assert.equal(joueur.statut, 403);
  assert.equal(joueur.statut, vrai.statut);
  assert.equal(joueur.corps.code, vrai.corps.code);
  // Hors team : refusé.
  const B = await teamAvecMembres(b, { nom: 'Team Bravo', membres: { kai12345: { pseudo: 'Kai', role: 'manager' } } });
  const autre = await surcharge(chemin, 'PATCH', { permissions: [] }, { jeton: B.sessions.kai12345 });
  assert.ok([403, 404].includes(autre.statut), JSON.stringify(autre.corps));
  // Anti-CSRF : corps non JSON refusé (415).
  const texte = await surcharge(chemin, 'PATCH', { permissions: [] }, { type: 'text/plain' });
  assert.equal(texte.statut, 415);
  // Les permissions du Coach n'ont pas bougé.
  assert.deepEqual((await roles()).coach.permissions, coach.permissions);
  // Hors POST, l'en-tête est ignoré : un GET reste un GET (aucune écriture).
  const g = await b.appel(chemin.replace(/\/roles\/.*/, '/roles'), { jeton: A.sessions.fondateur, entetes: { 'X-Methode': 'DELETE' } });
  assert.equal(g.statut, 200);
  assert.ok((await roles()).coach);
});

test('CORS et annonce : X-Methode autorisé au préliminaire, « surcharge-methode » dans /sante et /session', async () => {
  const b = await banc();
  const o = await b.traiter(new Request('https://esport.test/teams/x/roles/y', { method: 'OPTIONS' }));
  assert.match(o.headers.get('Access-Control-Allow-Headers'), /X-Methode/);
  assert.match(o.headers.get('Access-Control-Allow-Headers'), /X-HTTP-Method-Override/);
  assert.ok((await b.appel('/sante')).corps.fonctions.includes('surcharge-methode'));
  const s = await b.appel('/session', { methode: 'POST', jeton: JETON_MAITRE });
  assert.ok(s.corps.fonctions.includes('surcharge-methode'));
});
