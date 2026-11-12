/**
 * Migration 0074 (docs/esport/cm.md, « To do », « Favoris », « Cartes au calendrier ») : type de réunion Review des teams,
 * cartes favorites (par compte), To do du Dashboard (réglage par compte, tableaux restreints, colonnes de fin, tri,
 * « Terminer »), cartes datées au calendrier du CM (réglage du tableau, création datée, déplacement dans les deux sens,
 * durée), temps réel.
 *
 * Tourne sur SQLite (défaut) et sur PostgreSQL (ESPORT_TEST_PG, esport/test/pg/lancer.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { publicationsDe } from '../noyau/temps-reel/regles.mjs';
import { lireDuree, lireReglageTodo } from '../noyau/cm/tableaux.mjs';

const REVIEW = '00000000-0000-4000-8000-000000000006';

async function preparer() {
  const b = await banc();
  const A = await teamAvecMembres(b, { membres: { lea12345: { pseudo: 'Léa', role: 'joueur' }, max12345: { pseudo: 'Max', role: 'manager' } } });
  const s = { ...A.sessions };
  s.cm123456 = await b.session('cm123456', 'Clara');
  s.red12345 = await b.session('red12345', 'Remi');
  s.vue12345 = await b.session('vue12345', 'Vera');
  const api = (chemin, jeton, o = {}) => b.appel(chemin, { jeton, methode: o.methode, corps: o.corps });
  const ok = async (chemin, jeton, o = {}) => {
    const r = await api(chemin, jeton, o);
    assert.equal(r.statut, 200, `${o.methode ?? 'GET'} ${chemin} : ${r.statut} ${JSON.stringify(r.corps)}`);
    return r.corps;
  };
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'cm123456', roleId: 'cm-role-responsable', portee: 'club' } });
  const lecteur = await ok('/cm/roles', s.fondateur, { methode: 'POST', corps: { nom: 'Lecteur', couleur: '#123456', permissions: ['cm.voir'] } });
  const redacteur = await ok('/cm/roles', s.fondateur, { methode: 'POST', corps: { nom: 'Rédacteur', couleur: '#654321', permissions: ['cm.voir', 'cm.editer', 'cm.deposer'] } });
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'red12345', roleId: redacteur.id ?? redacteur.role?.id, portee: 'club' } });
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'vue12345', roleId: lecteur.id ?? lecteur.role?.id, portee: 'club' } });
  const club = (await ok('/cm/tableaux', s.cm123456)).tableaux.find(t => t.portee === 'club');
  const tb = await ok(`/cm/tableaux/${club.id}`, s.cm123456);
  const L = Object.fromEntries(tb.listes.map(l => [l.cle, l.id]));
  const carte = async (titre, corps = {}, jeton = s.cm123456, id = club.id) => (await ok(`/cm/tableaux/${id}/cartes`, jeton, { methode: 'POST', corps: { listeId: corps.listeId ?? L.idees, titre, ...corps } })).carte;
  const modifier = (id, corps, jeton = s.cm123456) => ok(`/cm/cartes/${id}`, jeton, { methode: 'PATCH', corps });
  const todo = jeton => ok('/cm/todo', jeton);
  const calendrier = (jeton, du = '2026-10-19', au = '2026-11-15') => ok(`/cm/calendrier?du=${du}&au=${au}`, jeton);
  return { b, A, s, api, ok, club, L, carte, modifier, todo, calendrier };
}

test('type de réunion « Review » : global, proposé à toutes les teams avant « Autre », utilisable pour un dépôt et en filtre', async () => {
  const b = await banc();
  const { teamId, sessions } = await teamAvecMembres(b, { membres: { max12345: { pseudo: 'Max', role: 'manager' }, lea12345: { pseudo: 'Léa', role: 'joueur' } } });
  const types = (await b.appel(`/teams/${teamId}/resumes/types`, { jeton: sessions.lea12345 })).corps;
  const liste = Array.isArray(types) ? types : (types.types ?? []);
  const noms = liste.map(t => t.nom);
  assert.ok(noms.includes('Review'), JSON.stringify(noms));
  assert.ok(noms.indexOf('Review') < noms.indexOf('Autre'), 'rangé avant « Autre »');
  const review = liste.find(t => t.nom === 'Review');
  assert.equal(review.id, REVIEW);
  assert.equal(review.visibilite, 'team');
  const depot = await b.appel(`/teams/${teamId}/resumes`, { methode: 'POST', jeton: sessions.lea12345, corps: { lien: 'https://youtu.be/abc123', typeId: REVIEW, dateReunion: '2026-10-19', titre: 'Review VOD', note: '' } });
  assert.equal(depot.statut, 200, JSON.stringify(depot.corps));
  assert.equal(depot.corps.type.nom, 'Review');
  const boite = (await b.appel(`/resumes/boite?type=${REVIEW}`, { jeton: sessions.max12345 })).corps;
  assert.deepEqual(boite.depots.map(d => d.titre), ['Review VOD']);
  assert.ok(boite.types.some(t => t.id === REVIEW));
  // Une seule ligne « Review » globale (la migration ne double pas un type déjà créé).
  const n = await b.base.premier("SELECT COUNT(*) AS n FROM types_reunion WHERE team_id IS NULL AND nom = 'Review'", []);
  assert.equal(Number(n.n), 1);
});

test('outils purs : durée d’échéance et réglage du To do', () => {
  assert.equal(lireDuree(null), null);
  assert.equal(lireDuree(''), null);
  assert.equal(lireDuree(90), 90);
  for (const v of [3, 1441, 1.5, '30', -10]) assert.throws(() => lireDuree(v), e => e.statut === 400 && e.code === 'echeance-duree');
  assert.deepEqual(lireReglageTodo(null), { tableaux: [], assignees: true, favoris: true });
  assert.deepEqual(lireReglageTodo({ tableaux: ['x', '11111111-1111-4111-8111-111111111111'], assignees: false }), { tableaux: ['11111111-1111-4111-8111-111111111111'], assignees: false, favoris: true });
});

test('favoris : étoile par compte (tableau et fiche), retrait, valeur illisible, carte invisible : 404', async () => {
  const { s, api, ok, club, carte } = await preparer();
  const c = await carte('Brief');
  assert.deepEqual(await ok(`/cm/cartes/${c.id}/favori`, s.vue12345, { methode: 'POST', corps: { favori: true } }), { ok: true, favori: true });
  // Idempotent.
  await ok(`/cm/cartes/${c.id}/favori`, s.vue12345, { methode: 'POST', corps: { favori: true } });
  assert.equal((await ok(`/cm/tableaux/${club.id}`, s.vue12345)).cartes.find(x => x.id === c.id).favori, true);
  assert.equal((await ok(`/cm/tableaux/${club.id}`, s.cm123456)).cartes.find(x => x.id === c.id).favori, false, 'les favoris sont personnels');
  assert.equal((await ok(`/cm/cartes/${c.id}`, s.vue12345)).carte.favori, true);
  assert.equal((await ok(`/cm/cartes/${c.id}`, s.red12345)).carte.favori, false);
  assert.equal((await api(`/cm/cartes/${c.id}/favori`, s.vue12345, { methode: 'POST', corps: { favori: 'oui' } })).statut, 400);
  assert.equal((await api(`/cm/cartes/${c.id}/favori`, s.lea12345, { methode: 'POST', corps: { favori: true } })).statut, 404, 'hors CM : carte introuvable');
  await ok(`/cm/cartes/${c.id}/favori`, s.vue12345, { methode: 'POST', corps: { favori: false } });
  assert.equal((await ok(`/cm/cartes/${c.id}`, s.vue12345)).carte.favori, false);
});

test('To do : favorites et cartes assignées, colonnes de fin exclues, tri urgence puis échéance, tableaux restreints', async () => {
  const { s, api, ok, club, L, carte, modifier, todo } = await preparer();
  const fin = (await ok(`/cm/tableaux/${club.id}/listes`, s.cm123456, { methode: 'POST', corps: { nom: 'Fini', fin: true } })).id;
  const tard = await carte('Tard', { echeance: '2026-11-05 18:00' });
  const tot = await carte('Tôt', { echeance: '2026-10-25 09:00' });
  const sans = await carte('Sans date');
  const crit = await carte('Critique', { echeance: '2026-11-10 10:00' });
  const finie = await carte('Finie', { listeId: fin });
  const autre = await carte('Pas à moi');
  for (const c of [tard, tot, sans, crit, finie]) await modifier(c.id, { membres: ['red12345'] });
  await modifier(crit.id, { urgence: 'critique' });
  let t = await todo(s.red12345);
  assert.deepEqual(t.cartes.map(c => c.titre), ['Critique', 'Tôt', 'Tard', 'Sans date'], 'urgence, puis échéance, sans échéance en dernier ; terminée exclue');
  assert.deepEqual(t.favoris, []);
  assert.deepEqual(t.reglage, { tableaux: [], assignees: true, favoris: true });
  const c0 = t.cartes[0];
  assert.equal(c0.liste.cle, 'idees');
  assert.equal(c0.urgence, 'critique');
  assert.equal(c0.assignee, true);
  assert.equal(c0.terminable, true, 'cm.editer et une colonne de fin');
  assert.ok(t.tableaux.some(x => x.id === club.id && x.colonneFin === true && x.editer === true));
  // Favori : en tête, retiré des cartes ordinaires ; celui d'une carte non assignée apparaît aussi.
  await ok(`/cm/cartes/${tot.id}/favori`, s.red12345, { methode: 'POST', corps: { favori: true } });
  await ok(`/cm/cartes/${autre.id}/favori`, s.red12345, { methode: 'POST', corps: { favori: true } });
  t = await todo(s.red12345);
  assert.deepEqual(t.favoris.map(c => c.titre), ['Tôt', 'Pas à moi']);
  assert.deepEqual(t.cartes.map(c => c.titre), ['Critique', 'Tard', 'Sans date']);
  // « Terminer » : rangée dans la colonne de fin, elle quitte le To do.
  assert.equal((await api(`/cm/cartes/${tard.id}/terminer`, s.vue12345, { methode: 'POST', corps: {} })).statut, 403, 'lecture seule');
  assert.deepEqual(await ok(`/cm/cartes/${tard.id}/terminer`, s.red12345, { methode: 'POST', corps: {} }), { ok: true, listeId: fin });
  assert.ok((await ok(`/cm/cartes/${tard.id}`, s.red12345)).carte.termineeLe);
  assert.ok(!(await todo(s.red12345)).cartes.some(c => c.id === tard.id));
  // Lecteur (cm.voir seul) : rien d'assignable chez lui, mais ses favoris ; pas de « Terminer ».
  await ok(`/cm/cartes/${sans.id}/favori`, s.vue12345, { methode: 'POST', corps: { favori: true } });
  const v = await todo(s.vue12345);
  assert.deepEqual(v.favoris.map(c => [c.titre, c.terminable]), [['Sans date', false]]);
  // Tableau restreint dont Remi n'est pas : ses cartes et favoris disparaissent, le tableau n'est plus proposé.
  const prive = (await ok('/cm/tableaux', s.cm123456, { methode: 'POST', corps: { nom: 'Privé', portee: 'club', modele: 'contenus' } })).tableau;
  const listePrivee = (await ok(`/cm/tableaux/${prive.id}`, s.cm123456)).listes[0].id;
  const secret = await carte('Secret', { listeId: listePrivee }, s.cm123456, prive.id);
  await modifier(secret.id, { membres: ['red12345'] });
  await ok(`/cm/cartes/${secret.id}/favori`, s.red12345, { methode: 'POST', corps: { favori: true } });
  assert.ok((await todo(s.red12345)).favoris.some(c => c.id === secret.id));
  await ok(`/cm/tableaux/${prive.id}/acces`, s.cm123456, { methode: 'PUT', corps: { acces: 'restreint', regles: [{ genre: 'compte', cible: 'cm123456', niveau: 'modifier' }] } });
  t = await todo(s.red12345);
  assert.ok(!t.favoris.some(c => c.id === secret.id) && !t.cartes.some(c => c.id === secret.id), 'tableau restreint : rien');
  assert.ok(!t.tableaux.some(x => x.id === prive.id));
  assert.equal((await api(`/cm/cartes/${secret.id}/favori`, s.red12345, { methode: 'POST', corps: { favori: false } })).statut, 404);
  // Hors section CM : 403.
  assert.equal((await api('/cm/todo', s.lea12345)).statut, 403);
  void L;
});

test('To do : réglage par compte (tableaux choisis, assignées / favorites), validé et mémorisé côté serveur ; « Terminer » sans colonne de fin : 409', async () => {
  const { s, api, ok, club, carte, modifier, todo } = await preparer();
  const autre = (await ok('/cm/tableaux', s.cm123456, { methode: 'POST', corps: { nom: 'Autre', portee: 'club', modele: 'contenus' } })).tableau;
  const listeAutre = (await ok(`/cm/tableaux/${autre.id}`, s.cm123456)).listes[0].id;
  const a = await carte('Club');
  const bcarte = await carte('Ailleurs', { listeId: listeAutre }, s.cm123456, autre.id);
  const fav = await carte('Étoile', { listeId: listeAutre }, s.cm123456, autre.id);
  for (const c of [a, bcarte]) await modifier(c.id, { membres: ['red12345'] });
  await ok(`/cm/cartes/${fav.id}/favori`, s.red12345, { methode: 'POST', corps: { favori: true } });
  assert.deepEqual((await todo(s.red12345)).cartes.map(c => c.titre).sort(), ['Ailleurs', 'Club']);
  await ok('/cm/preferences/todo.dashboard', s.red12345, { methode: 'PUT', corps: { valeur: { tableaux: [club.id], assignees: true, favoris: true } } });
  let t = await todo(s.red12345);
  assert.deepEqual(t.reglage.tableaux, [club.id]);
  assert.deepEqual(t.cartes.map(c => c.titre), ['Club'], 'seulement les tableaux choisis');
  assert.deepEqual(t.favoris.map(c => c.titre), ['Étoile'], 'les favorites restent, quel que soit le tableau');
  await ok('/cm/preferences/todo.dashboard', s.red12345, { methode: 'PUT', corps: { valeur: { tableaux: [club.id], assignees: false, favoris: true } } });
  t = await todo(s.red12345);
  assert.deepEqual([t.cartes.length, t.favoris.length], [0, 1]);
  assert.equal((await todo(s.cm123456)).reglage.assignees, true, 'réglage personnel');
  for (const valeur of [{ tableaux: ['pas-un-uuid'] }, { assignees: 'oui' }, { inconnu: 1 }, ['x']]) {
    assert.equal((await api('/cm/preferences/todo.dashboard', s.red12345, { methode: 'PUT', corps: { valeur } })).statut, 400, JSON.stringify(valeur));
  }
  assert.equal((await api(`/cm/cartes/${a.id}/terminer`, s.red12345, { methode: 'POST', corps: {} })).statut, 409);
});

test('calendrier : cartes datées liées à la carte (création datée, déplacement dans les deux sens, durée), réglage du tableau, accès', async () => {
  const { s, api, ok, club, L, carte, modifier, calendrier } = await preparer();
  const datee = await carte('Shooting', { echeance: '2026-10-28 15:30', echeanceDuree: 90 });
  assert.equal(datee.echeance, '2026-10-28T14:30:00.000Z', 'heure de Paris, enregistrée en UTC');
  assert.equal(datee.echeanceDuree, 90);
  await carte('Sans date');
  let cal = await calendrier(s.vue12345);
  assert.deepEqual(cal.echeances.map(c => c.titre), ['Shooting'], 'une carte sans date n’est pas au calendrier');
  const e = cal.echeances[0];
  assert.equal(e.id, datee.id);
  assert.equal(e.tableauId, club.id);
  assert.equal(e.echeanceDuree, 90);
  assert.equal(e.liste.cle, 'idees');
  assert.equal(e.droits.editer, false, 'lecteur : pas de déplacement');
  // Déplacée depuis le calendrier (PATCH de l'échéance) : la carte change, et inversement.
  await modifier(datee.id, { echeance: '2026-11-02T09:00:00.000Z' }, s.red12345);
  cal = await calendrier(s.vue12345);
  assert.equal(cal.echeances[0].echeance, '2026-11-02T09:00:00.000Z');
  assert.equal((await ok(`/cm/cartes/${datee.id}`, s.vue12345)).carte.echeance, '2026-11-02T09:00:00.000Z');
  assert.equal((await api(`/cm/cartes/${datee.id}`, s.vue12345, { methode: 'PATCH', corps: { echeance: '2026-11-03 10:00' } })).statut, 403);
  assert.equal((await api(`/cm/cartes/${datee.id}`, s.red12345, { methode: 'PATCH', corps: { echeanceDuree: 2 } })).statut, 400);
  // Hors période : absente ; échéance retirée : plus au calendrier, durée effacée.
  assert.deepEqual((await calendrier(s.vue12345, '2026-12-01', '2026-12-31')).echeances, []);
  const sansDate = await modifier(datee.id, { echeance: null });
  assert.equal(sansDate.carte.echeanceDuree, null);
  assert.deepEqual((await calendrier(s.vue12345)).echeances, []);
  await modifier(datee.id, { echeance: '2026-10-30 08:00' });
  // Réglage du tableau « Afficher les cartes dans le calendrier » (cm.gerer) : coupé, plus rien.
  assert.equal((await ok(`/cm/tableaux/${club.id}`, s.vue12345)).tableau.calendrier, true, 'oui par défaut');
  assert.equal((await api(`/cm/tableaux/${club.id}`, s.red12345, { methode: 'PATCH', corps: { calendrier: false } })).statut, 403);
  assert.equal((await api(`/cm/tableaux/${club.id}`, s.cm123456, { methode: 'PATCH', corps: { calendrier: 'non' } })).statut, 400);
  await ok(`/cm/tableaux/${club.id}`, s.cm123456, { methode: 'PATCH', corps: { calendrier: false } });
  assert.deepEqual((await calendrier(s.vue12345)).echeances, []);
  await ok(`/cm/tableaux/${club.id}`, s.cm123456, { methode: 'PATCH', corps: { calendrier: true } });
  assert.equal((await calendrier(s.vue12345)).echeances.length, 1);
  // Filtre par réseau : seulement les posts.
  assert.deepEqual((await ok('/cm/calendrier?du=2026-10-19&au=2026-11-15&reseau=x', s.vue12345)).echeances, []);
  // Tableau restreint : ses cartes datées ne sont visibles que de ceux qui le voient.
  const prive = (await ok('/cm/tableaux', s.cm123456, { methode: 'POST', corps: { nom: 'Privé', portee: 'club', modele: 'contenus' } })).tableau;
  const listePrivee = (await ok(`/cm/tableaux/${prive.id}`, s.cm123456)).listes[0].id;
  await carte('Secret daté', { listeId: listePrivee, echeance: '2026-10-29 12:00' }, s.cm123456, prive.id);
  await ok(`/cm/tableaux/${prive.id}/acces`, s.cm123456, { methode: 'PUT', corps: { acces: 'restreint', regles: [{ genre: 'compte', cible: 'cm123456', niveau: 'modifier' }] } });
  assert.ok((await calendrier(s.cm123456)).echeances.some(c => c.titre === 'Secret daté'));
  assert.ok(!(await calendrier(s.vue12345)).echeances.some(c => c.titre === 'Secret daté'));
  assert.ok(!(await calendrier(s.fondateur)).echeances.every(c => c.titre !== 'Secret daté'), 'le Fondateur voit tout');
  void L;
});

test('temps réel : l’étoile ne prévient que les autres appareils du compte ; « Terminer » est une écriture de carte', () => {
  assert.deepEqual(publicationsDe('POST', '/cm/cartes/11111111-1111-4111-8111-111111111111/favori', { compte: 'red12345' }), [{ sujet: 'compte:red12345' }]);
  const p = publicationsDe('POST', '/cm/cartes/11111111-1111-4111-8111-111111111111/terminer', { compte: 'red12345' });
  assert.equal(p[0].sujet, 'cm');
  assert.equal(p[0].cle, 'cm-carte:11111111-1111-4111-8111-111111111111');
});
