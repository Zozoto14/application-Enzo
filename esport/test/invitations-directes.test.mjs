/**
 * Invitation directe et vues de premier niveau (Dashboard, Membres) :
 *  - pré-enregistrement par le Fondateur (POST /comptes), première session → actif, teams visibles sans code ;
 *  - isolation : un invité ne voit que ses teams ;
 *  - routes agrégées (/dashboard, /membres) : rien d'une team non autorisée ;
 *  - anti-escalade dans l'annuaire des membres (ajout, rôle, retrait) ;
 *  - compte supprimé dans l'Administration → retiré de l'Esport.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { banc, teamAvecMembres } from './aide.mjs';

const JOUR = '2026-10-20';

async function preparer() {
  const b = await banc();
  const A = await teamAvecMembres(b, { nom: 'Team Alpha', membres: { max12345: { pseudo: 'Max', role: 'manager' }, coa12345: { pseudo: 'Coach', role: 'coach' }, lea12345: { pseudo: 'Léa', role: 'joueur' } } });
  const B = await teamAvecMembres(b, { nom: 'Team Bravo', membres: { tom12345: { pseudo: 'Tom', role: 'joueur' }, bob12345: { pseudo: 'Bob', role: 'coach' } } });
  const f = A.sessions.fondateur;
  const api = (chemin, jeton, options = {}) => b.appel(chemin, { jeton, ...options });
  return { b, A, B, f, api };
}

const preinscription = (A, B, extra = {}) => ({
  compte: 'zoe12345',
  pseudo: 'Zoé',
  discordId: '412345678901234567',
  affectations: [
    { teamId: A.teamId, roleId: A.roles.joueur.id, posteJeu: 'Duelliste' },
    { teamId: B.teamId, roleId: B.roles.remplacant.id },
  ],
  ...extra,
});

test('invitation directe : vérification, pré-enregistrement « invité », première session → actif et teams visibles sans code', async () => {
  const { b, A, B, f, api } = await preparer();
  // Contrôle seul (avant de créer le compte du hub) : rien n'est écrit.
  let r = await api('/comptes', f, { methode: 'POST', corps: { ...preinscription(A, B), compte: undefined, verifier: true } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.verifie, true);
  assert.equal(await b.base.premier("SELECT id FROM comptes WHERE pseudo = 'Zoé'", []), null);

  r = await api('/comptes', f, { methode: 'POST', corps: preinscription(A, B) });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.statut, 'invite');
  assert.equal(r.corps.pseudo, 'Zoé');
  assert.deepEqual(r.corps.appartenances.map(a => [a.teamId, a.role.nom, a.posteJeu]).sort(), [[A.teamId, 'Joueur', 'Duelliste'], [B.teamId, 'Remplaçant / Invité', null]].sort());
  // Dans la liste de la team : « invité » tant qu'il ne s'est pas connecté.
  const membres = (await api(`/teams/${A.teamId}/membres`, f)).corps.membres;
  assert.equal(membres.find(m => m.compte === 'zoe12345').invite, true);
  assert.equal(membres.find(m => m.compte === 'lea12345').invite, false);
  // Journal : ajout par le Fondateur, pas encore d'arrivée.
  let actions = (await api(`/teams/${A.teamId}/journal`, f)).corps.entrees.filter(e => e.meta.compte === 'zoe12345' || e.acteur === 'zoe12345').map(e => e.action);
  assert.deepEqual(actions, ['member.added']);

  // Première session de Zoé (jeton de SON compte, validé par le relais) : pseudo déjà là, teams déjà là.
  const zoe = await b.session('zoe12345');
  const moi = (await api('/moi', zoe)).corps;
  assert.equal(moi.profil.pseudo, 'Zoé');
  assert.deepEqual((await api('/teams', zoe)).corps.teams.map(t => t.nom), ['Team Alpha', 'Team Bravo']);
  assert.equal((await api(`/teams/${A.teamId}`, zoe)).corps.moi.role.nom, 'Joueur');
  const fiche = (await api('/membres', f)).corps.comptes.find(c => c.compte === 'zoe12345');
  assert.equal(fiche.statut, 'actif');
  assert.ok(fiche.activeLe);
  actions = (await api(`/teams/${A.teamId}/journal`, f)).corps.entrees.filter(e => e.acteur === 'zoe12345').map(e => e.action);
  assert.deepEqual(actions, ['member.joined']);
  // Bienvenue pour elle, annonce au staff.
  assert.ok((await api('/notifications', zoe)).corps.liste.some(n => n.type === 'bienvenue'));
  assert.ok((await api('/notifications', A.sessions.max12345)).corps.liste.some(n => n.type === 'membre-arrive' && n.charge.membre === 'zoe12345'));
  // Une seconde session ne réannonce rien.
  await b.session('zoe12345');
  assert.equal((await api(`/teams/${A.teamId}/journal`, f)).corps.entrees.filter(e => e.acteur === 'zoe12345' && e.action === 'member.joined').length, 1);
});

test('invitation directe : réservée au Fondateur ; pseudo pris, compte existant, team ou rôle invalides refusés', async () => {
  const { A, B, f, api } = await preparer();
  // Manager : pas de création de compte (il n'a pas les clés du Fondateur).
  let r = await api('/comptes', A.sessions.max12345, { methode: 'POST', corps: { ...preinscription(A, B), affectations: [{ teamId: A.teamId, roleId: A.roles.joueur.id }] } });
  assert.equal(r.statut, 403);
  assert.equal(r.corps.code, 'super-admin');
  r = await api('/comptes', f, { methode: 'POST', corps: { ...preinscription(A, B), pseudo: 'léa' } });
  assert.equal(r.corps.code, 'pseudo-pris');
  r = await api('/comptes', f, { methode: 'POST', corps: { ...preinscription(A, B), compte: 'lea12345', pseudo: 'Autre' } });
  assert.equal(r.corps.code, 'compte-existe');
  r = await api('/comptes', f, { methode: 'POST', corps: { ...preinscription(A, B), compte: 'principal' } });
  assert.equal(r.statut, 400);
  r = await api('/comptes', f, { methode: 'POST', corps: { ...preinscription(A, B), affectations: [{ teamId: A.teamId, roleId: B.roles.joueur.id }] } });
  assert.equal(r.statut, 404, 'rôle d’une autre team');
  r = await api('/comptes', f, { methode: 'POST', corps: { ...preinscription(A, B), affectations: [{ teamId: A.teamId, roleId: A.roles.joueur.id }, { teamId: A.teamId, roleId: A.roles.coach.id }] } });
  assert.equal(r.statut, 400);
  r = await api('/comptes', f, { methode: 'POST', corps: { ...preinscription(A, B), affectations: [] } });
  assert.equal(r.statut, 400);
  r = await api('/comptes', f, { methode: 'POST', corps: { ...preinscription(A, B), pseudo: '<script>' } });
  assert.equal(r.corps.code, 'pseudo');
});

test('isolation : un invité ne voit que ses teams (liste, détail, dashboard, membres)', async () => {
  const { b, A, B, f, api } = await preparer();
  await api('/comptes', f, { methode: 'POST', corps: { compte: 'ian12345', pseudo: 'Ian', discordId: '412345678901234568', affectations: [{ teamId: A.teamId, roleId: A.roles.joueur.id }] } });
  const ian = await b.session('ian12345');
  assert.deepEqual((await api('/teams', ian)).corps.teams.map(t => t.nom), ['Team Alpha']);
  assert.equal((await api(`/teams/${B.teamId}`, ian)).statut, 404);
  assert.equal((await api(`/teams/${B.teamId}/membres`, ian)).statut, 404);
  const dash = (await api('/dashboard', ian)).corps;
  assert.deepEqual(dash.teams.map(t => t.team.nom), ['Team Alpha']);
  assert.ok(!JSON.stringify(dash).includes(B.teamId));
  const annuaire = (await api('/membres', ian)).corps;
  assert.deepEqual(annuaire.teams.map(t => t.nom), ['Team Alpha']);
  assert.ok(!annuaire.comptes.some(c => ['tom12345', 'bob12345'].includes(c.compte)), 'les comptes de la Team Bravo restent invisibles');
  assert.equal(annuaire.peutCreerCompte, false);
});

test('dashboard agrégé : une requête, toutes les teams autorisées, blocs selon les permissions, rien des autres teams', async () => {
  const { b, A, B, f, api } = await preparer();
  b.horloge.t = Date.parse(`${JOUR}T10:00:00.000Z`);
  const coachA = await b.session('coa12345');
  const bob = await b.session('bob12345');
  // Team A : un entraînement jeudi (tout le monde, et le Fondateur coché), une tâche en retard, un résumé à rédiger.
  const convocation = { groupes: ['tous'], proprietaires: ['principal'] };
  assert.equal((await api(`/teams/${A.teamId}/planning`, coachA, { methode: 'POST', corps: { type: 'training', titre: 'Entraînement Alpha', date: '2026-10-22', heureDebut: '20:00', heureFin: '22:00', convocation } })).statut, 200);
  // Une réunion des joueurs (défaut) : le Fondateur, Propriétaire non coché, ne l'a pas dans « ses » événements.
  assert.equal((await api(`/teams/${A.teamId}/planning`, coachA, { methode: 'POST', corps: { type: 'meeting', titre: 'Réunion joueurs', date: '2026-10-23', heureDebut: '18:00', heureFin: '19:00' } })).statut, 200);
  assert.equal((await api(`/teams/${A.teamId}/taches`, coachA, { methode: 'POST', corps: { titre: 'Tâche Alpha', echeance: '2026-10-18' } })).statut, 200);
  // Team B : de quoi fuir si le filtre manquait.
  assert.equal((await api(`/teams/${B.teamId}/planning`, bob, { methode: 'POST', corps: { type: 'scrim', titre: 'Scrim secret Bravo', date: '2026-10-21', heureDebut: '20:00', heureFin: '22:00' } })).statut, 200);
  assert.equal((await api(`/teams/${B.teamId}/taches`, bob, { methode: 'POST', corps: { titre: 'Tâche secrète Bravo', echeance: '2026-10-10' } })).statut, 200);

  // Fondateur : les deux teams, et le bloc global.
  const tout = (await api('/dashboard', await b.session('principal'))).corps;
  assert.deepEqual(tout.teams.map(t => t.team.nom), ['Team Alpha', 'Team Bravo', 'Team CM']);
  const alpha = tout.teams.find(t => t.team.id === A.teamId);
  assert.equal(alpha.prochains[0].titre, 'Entraînement Alpha');
  assert.equal(alpha.taches.enRetard, 1);
  assert.equal(alpha.effectif.actifs, 4);
  assert.ok(alpha.derniereActivite.action, 'Journal visible du Fondateur : détail de la dernière activité');
  // Le scrim Bravo (joueurs) et la réunion des joueurs ne convoquent pas le Fondateur : ni attendu, ni compté.
  assert.deepEqual(tout.global.evenementsSemaine.map(e => e.titre), ['Entraînement Alpha']);
  assert.deepEqual(alpha.prochains.map(e => e.titre), ['Entraînement Alpha']);
  assert.ok(tout.global.alertes.some(a => a.genre === 'taches' && a.teamId === B.teamId));

  // Coach de la Team A : seulement elle, et rien de Bravo nulle part dans la réponse.
  const coach = (await api('/dashboard', coachA)).corps;
  assert.deepEqual(coach.teams.map(t => t.team.nom), ['Team Alpha']);
  const texte = JSON.stringify(coach);
  for (const secret of ['Bravo', B.teamId, 'Scrim secret', 'Tâche secrète']) assert.ok(!texte.includes(secret), secret);
  assert.deepEqual(coach.global.evenementsSemaine.map(e => e.titre), ['Entraînement Alpha']);
  // Un joueur : les deux (il est convoqué à la réunion des joueurs).
  assert.deepEqual((await api('/dashboard', A.sessions.lea12345)).corps.global.evenementsSemaine.map(e => e.titre), ['Entraînement Alpha', 'Réunion joueurs']);

  // Joueur : pas de Journal → date de la dernière activité seulement.
  const lea = (await api('/dashboard', A.sessions.lea12345)).corps.teams[0];
  assert.ok(lea.derniereActivite.date);
  assert.equal(lea.derniereActivite.action, undefined);
  // Une team où l'on est suspendu n'apparaît plus.
  await api(`/teams/${A.teamId}/membres/${A.membres.lea12345.id}`, f, { methode: 'PATCH', corps: { statut: 'suspendu' } });
  assert.deepEqual((await api('/dashboard', A.sessions.lea12345)).corps.teams, []);
  // Sans session : 401.
  assert.equal((await api('/dashboard')).statut, 401);
});

test('page Membres : annuaire limité aux teams où l’on voit les membres ; anti-escalade sur l’ajout, le rôle, le retrait', async () => {
  const { b, A, B, f, api } = await preparer();
  // Une Team Charlie où Max est aussi Manager.
  const C = await teamAvecMembres(b, { nom: 'Team Charlie', membres: { max12345: { pseudo: 'Max', role: 'manager' } } });
  const max = (await b.session('max12345'));
  const annuaire = (await api('/membres', max)).corps;
  assert.deepEqual(annuaire.teams.map(t => t.nom), ['Team Alpha', 'Team Charlie']);
  assert.ok(!annuaire.comptes.some(c => c.compte === 'tom12345'));
  const alpha = annuaire.teams.find(t => t.id === A.teamId);
  assert.deepEqual(alpha.droits, { ajouter: true, demander: false, roles: true, retirer: true });
  // Rôles attribuables : jamais Propriétaire ni Manager pour un Manager.
  assert.equal(alpha.roles.find(r => r.cle === 'proprietaire').attribuable, false);
  assert.equal(alpha.roles.find(r => r.cle === 'joueur').attribuable, true);
  // Le Propriétaire (Fondateur) n'est pas gérable par Max.
  const fondateur = annuaire.comptes.find(c => c.compte === 'principal');
  assert.equal(fondateur.appartenances.find(a => a.teamId === A.teamId).gerable, false);
  assert.equal(annuaire.comptes.find(c => c.compte === 'lea12345').appartenances[0].gerable, true);

  // Ajouter Léa (visible : membre de la Team Alpha) à la Team Charlie : oui, en Joueur ; pas en Propriétaire.
  let r = await api(`/teams/${C.teamId}/membres`, max, { methode: 'POST', corps: { compte: 'lea12345', roleId: C.roles.proprietaire.id } });
  assert.equal(r.statut, 403);
  assert.equal(r.corps.code, 'escalade');
  r = await api(`/teams/${C.teamId}/membres`, max, { methode: 'POST', corps: { compte: 'lea12345', roleId: C.roles.joueur.id, posteJeu: 'Sentinelle' } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.ok(r.corps.appartenances.some(a => a.teamId === C.teamId && a.role.nom === 'Joueur' && a.posteJeu === 'Sentinelle'));
  // Léa, déjà active, voit tout de suite la Team Charlie.
  assert.ok((await api('/teams', await b.session('lea12345'))).corps.teams.some(t => t.id === C.teamId));
  // Tom (Team Bravo, invisible pour Max) : refusé comme inconnu.
  r = await api(`/teams/${C.teamId}/membres`, max, { methode: 'POST', corps: { compte: 'tom12345', roleId: C.roles.joueur.id } });
  assert.equal(r.statut, 404);
  // Un Joueur n'ajoute personne.
  r = await api(`/teams/${A.teamId}/membres`, A.sessions.lea12345, { methode: 'POST', corps: { compte: 'coa12345', roleId: A.roles.joueur.id } });
  assert.equal(r.statut, 403);
  // Rôle et retrait : pas au-dessus de soi, pas sur le Propriétaire.
  const membreFondateur = fondateur.appartenances.find(a => a.teamId === A.teamId).membreId;
  assert.equal((await api(`/teams/${A.teamId}/membres/${membreFondateur}`, max, { methode: 'PATCH', corps: { roleId: A.roles.joueur.id } })).statut, 403);
  assert.equal((await api(`/teams/${A.teamId}/membres/${membreFondateur}`, max, { methode: 'DELETE' })).statut, 403);
  assert.equal((await api(`/teams/${A.teamId}/membres/${A.membres.lea12345.id}`, max, { methode: 'PATCH', corps: { roleId: A.roles.manager.id } })).statut, 200, 'Manager → Manager : permissions identiques, permis');
  assert.equal((await api(`/teams/${A.teamId}/membres/${A.membres.lea12345.id}`, max, { methode: 'PATCH', corps: { roleId: A.roles.proprietaire.id } })).statut, 403);
  // Le Fondateur voit tout, dont les comptes sans team.
  await api(`/teams/${B.teamId}/membres/${B.membres.tom12345.id}`, f, { methode: 'DELETE' });
  const complet = (await api('/membres', f)).corps;
  assert.equal(complet.peutCreerCompte, true);
  assert.deepEqual(complet.comptes.find(c => c.compte === 'tom12345').appartenances, []);
});

test('compte supprimé dans l’Administration : retiré de toutes ses teams ; réservé au Fondateur ; idempotent', async () => {
  const { b, A, B, f, api } = await preparer();
  await api('/comptes', f, { methode: 'POST', corps: preinscription(A, B) });
  // Un Manager ne peut pas.
  assert.equal((await api('/admin/comptes/zoe12345/hub', A.sessions.max12345, { methode: 'DELETE' })).statut, 403);
  const r = await api('/admin/comptes/zoe12345/hub', f, { methode: 'DELETE' });
  assert.equal(r.statut, 200);
  assert.deepEqual(r.corps, { ok: true, retire: true, teams: 2 });
  assert.equal(Number((await b.base.premier("SELECT COUNT(*) AS n FROM membres WHERE compte_id = 'zoe12345'", [])).n), 0);
  assert.equal(await b.base.premier("SELECT id FROM comptes WHERE id = 'zoe12345'", []), null);
  assert.ok(!(await api('/membres', f)).corps.comptes.some(c => c.compte === 'zoe12345'));
  const journal = (await api(`/teams/${A.teamId}/journal`, f)).corps.entrees;
  assert.ok(journal.some(e => e.action === 'member.removed' && e.meta.compte === 'zoe12345' && e.meta.suppression === 'administration'));
  // Une seconde fois : rien à faire.
  assert.deepEqual((await api('/admin/comptes/zoe12345/hub', f, { methode: 'DELETE' })).corps, { ok: true, retire: false, teams: 0 });
  // Un compte actif aussi (Léa) ; identifiant invalide : 400.
  assert.equal((await api('/admin/comptes/lea12345/hub', f, { methode: 'DELETE' })).corps.teams, 1);
  assert.equal((await api('/admin/comptes/..%2Fx/hub', f, { methode: 'DELETE' })).statut, 400);
});

test('ajout multi-teams : compte pré-enregistré, actif et jamais vu, en une fois, un rôle par team ; doublon refusé proprement', async () => {
  const { b, A, B, f, api } = await preparer();
  const C = await teamAvecMembres(b, { nom: 'Team Charlie' });
  const D = await teamAvecMembres(b, { nom: 'Team Delta' });
  const affectations = (...liste) => liste.map(([T, role, posteJeu]) => ({ teamId: T.teamId, roleId: T.roles[role].id, ...(posteJeu ? { posteJeu } : {}) }));

  // Jamais vu (compte du hub sans fiche Esport) : pré-enregistré dans deux teams d'un coup, pseudo du hub.
  let r = await api('/comptes/luca12345/teams', f, { methode: 'POST', corps: { pseudo: 'LUCA', discordId: '412345678901234569', affectations: affectations([A, 'joueur'], [B, 'coach']) } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.statut, 'invite');
  assert.deepEqual(r.corps.appartenances.map(a => [a.teamId, a.role.nom]).sort(), [[A.teamId, 'Joueur'], [B.teamId, 'Coach']].sort());
  // Le pseudo est exigé seulement pour un compte jamais vu.
  r = await api('/comptes/zoe12345/teams', f, { methode: 'POST', corps: { affectations: affectations([A, 'joueur']) } });
  assert.equal(r.statut, 400);
  assert.equal(r.corps.code, 'pseudo');

  // Pré-enregistré (invité, jamais connecté) : deux teams de plus, sans pseudo ; les autres teams ne bougent pas.
  r = await api('/comptes/luca12345/teams', f, { methode: 'POST', corps: { affectations: affectations([C, 'joueur', 'Sentinelle'], [D, 'remplacant']) } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.statut, 'invite');
  assert.equal(r.corps.pseudo, 'LUCA');
  assert.equal(r.corps.appartenances.length, 4);
  assert.equal(r.corps.appartenances.find(a => a.teamId === C.teamId).posteJeu, 'Sentinelle');
  // Il se connecte : il voit ses quatre teams.
  const luca = await b.session('luca12345');
  assert.equal((await api('/teams', luca)).corps.teams.length, 4);

  // Actif (déjà connecté, sans team) : ajout en une fois ; « bienvenue » immédiate (member.joined).
  const lea = await b.session('ana12345', 'Ana');
  r = await api('/comptes/ana12345/teams', f, { methode: 'POST', corps: { affectations: affectations([A, 'joueur'], [B, 'joueur']) } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.statut, 'actif');
  assert.deepEqual((await api('/teams', lea)).corps.teams.map(t => t.nom).sort(), ['Team Alpha', 'Team Bravo']);
  assert.equal((await api(`/teams/${A.teamId}/journal`, f)).corps.entrees.filter(e => e.acteur === 'ana12345' && e.action === 'member.joined').length, 1);
  // Encore une team plus tard : les deux premières restent telles quelles.
  r = await api('/comptes/ana12345/teams', f, { methode: 'POST', corps: { affectations: affectations([C, 'coach']) } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.appartenances.length, 3);

  // Doublon dans la même team : refus net (409), rien n'est écrit (tout ou rien), message avec le nom de la team.
  r = await api('/comptes/ana12345/teams', f, { methode: 'POST', corps: { affectations: affectations([D, 'joueur'], [A, 'coach']) } });
  assert.equal(r.statut, 409);
  assert.equal(r.corps.code, 'deja-membre');
  assert.match(r.corps.erreur, /Team Alpha/);
  assert.equal((await api('/membres', f)).corps.comptes.find(c => c.compte === 'ana12345').appartenances.length, 3, 'Team Delta non ajoutée');
  r = await api('/comptes/ana12345/teams', f, { methode: 'POST', corps: { affectations: affectations([D, 'joueur'], [D, 'coach']) } });
  assert.equal(r.statut, 400, 'même team deux fois');
  // POST /comptes pour un compte déjà connu : message exact (et non « pseudo pris »).
  r = await api('/comptes', f, { methode: 'POST', corps: { compte: 'luca12345', pseudo: 'LUCA', discordId: '412345678901234570', affectations: affectations([D, 'joueur']) } });
  assert.equal(r.corps.code, 'compte-existe');

  // Retirer d'une team sans toucher aux autres.
  const fiche = (await api('/membres', f)).corps.comptes.find(c => c.compte === 'luca12345');
  const enA = fiche.appartenances.find(a => a.teamId === A.teamId);
  assert.equal((await api(`/teams/${A.teamId}/membres/${enA.membreId}`, f, { methode: 'DELETE' })).statut, 200);
  const apres = (await api('/membres', f)).corps.comptes.find(c => c.compte === 'luca12345');
  assert.deepEqual(apres.appartenances.map(a => a.teamId).sort(), [B.teamId, C.teamId, D.teamId].sort());
});

test('ajout multi-teams : anti-escalade (Manager), compte invisible, Joueur refusé', async () => {
  const { b, A, B, f, api } = await preparer();
  const C = await teamAvecMembres(b, { nom: 'Team Charlie', membres: { max12345: { pseudo: 'Max', role: 'manager' } } });
  const max = await b.session('max12345');
  const D = await teamAvecMembres(b, { nom: 'Team Delta', membres: { max12345: { pseudo: 'Max', role: 'manager' } } });
  const af = (T, role) => ({ teamId: T.teamId, roleId: T.roles[role].id });
  // Léa (Team Alpha, que Max gère aussi) : visible pour Max. Plusieurs teams, rôles attribuables : accepté.
  let r = await api('/comptes/lea12345/teams', max, { methode: 'POST', corps: { affectations: [af(C, 'joueur'), af(D, 'coach')] } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  // Anti-escalade : un seul rôle trop haut fait tout refuser, rien n'est écrit.
  r = await api('/comptes/coa12345/teams', max, { methode: 'POST', corps: { affectations: [af(C, 'joueur'), af(D, 'proprietaire')] } });
  assert.equal(r.statut, 403);
  assert.equal(r.corps.code, 'escalade');
  assert.ok(!(await api('/membres', f)).corps.comptes.find(c => c.compte === 'coa12345').appartenances.some(a => a.teamId === C.teamId));
  // Compte d'une team invisible pour Max : introuvable ; compte jamais vu : le Fondateur seul le crée.
  r = await api('/comptes/tom12345/teams', max, { methode: 'POST', corps: { affectations: [af(C, 'joueur')] } });
  assert.equal(r.statut, 404);
  r = await api('/comptes/neuf12345/teams', max, { methode: 'POST', corps: { pseudo: 'Neuf', discordId: '412345678901234571', affectations: [af(C, 'joueur')] } });
  assert.equal(r.statut, 404);
  // Un Joueur n'ajoute personne.
  r = await api('/comptes/coa12345/teams', A.sessions.lea12345, { methode: 'POST', corps: { affectations: [af(A, 'joueur')] } });
  assert.equal(r.statut, 403);
});
