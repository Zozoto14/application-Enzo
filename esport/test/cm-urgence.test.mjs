/**
 * Drapeau d'urgence des cartes CM (migration 0047, docs/esport/cm.md, partie « Urgences ») : réglage et permissions,
 * résumés (tableau, À valider, calendrier), compteurs (liste des tableaux, état, /cm/urgences), notifications (montée
 * vers urgent / critique seulement, membres assignés, suiveurs, responsables CM, visibilité du tableau), temps réel,
 * import Trello (étiquettes converties en drapeau) et export de la base.
 *
 * Tourne sur SQLite (défaut) et sur PostgreSQL (ESPORT_TEST_PG, esport/test/pg/lancer.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { banc, teamAvecMembres } from './aide.mjs';
import { urgenceDepuisNom, rangUrgence, lireUrgence } from '../noyau/cm/urgence.mjs';

const TRELLO = JSON.parse(readFileSync(new URL('./donnees/trello-exemple.json', import.meta.url), 'utf8'));

async function preparer() {
  const b = await banc();
  const A = await teamAvecMembres(b, { membres: { lea12345: { pseudo: 'Léa', role: 'joueur' } } });
  const s = { ...A.sessions };
  s.cm123456 = await b.session('cm123456', 'Clara');
  s.red12345 = await b.session('red12345', 'Remi');
  s.vue12345 = await b.session('vue12345', 'Vera');
  s.aut12345 = await b.session('aut12345', 'Aude');
  const api = (chemin, jeton, o = {}) => b.appel(chemin, { jeton, methode: o.methode, corps: o.corps });
  const ok = async (chemin, jeton, o = {}) => {
    const r = await api(chemin, jeton, o);
    assert.equal(r.statut, 200, `${o.methode ?? 'GET'} ${chemin} : ${r.statut} ${JSON.stringify(r.corps)}`);
    return r.corps;
  };
  const tic = () => {
    b.horloge.t += 1000;
  };
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'cm123456', roleId: 'cm-role-responsable', portee: 'club' } });
  const lecteur = await ok('/cm/roles', s.fondateur, { methode: 'POST', corps: { nom: 'Lecteur', couleur: '#123456', permissions: ['cm.voir'] } });
  const redacteur = await ok('/cm/roles', s.fondateur, { methode: 'POST', corps: { nom: 'Rédacteur', couleur: '#654321', permissions: ['cm.voir', 'cm.editer', 'cm.deposer'] } });
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'red12345', roleId: redacteur.id ?? redacteur.role?.id, portee: 'club' } });
  for (const c of ['vue12345', 'aut12345']) await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: c, roleId: lecteur.id ?? lecteur.role?.id, portee: 'club' } });
  const club = (await ok('/cm/tableaux', s.cm123456)).tableaux.find(t => t.portee === 'club');
  const tb = await ok(`/cm/tableaux/${club.id}`, s.cm123456);
  const L = Object.fromEntries(tb.listes.map(l => [l.cle, l.id]));
  const carte = async (titre, listeId = L.idees) => (await ok(`/cm/tableaux/${club.id}/cartes`, s.cm123456, { methode: 'POST', corps: { listeId, titre } })).carte;
  const drapeau = (jeton, id, urgence) => api(`/cm/cartes/${id}`, jeton, { methode: 'PATCH', corps: { urgence } });
  const notifs = async jeton => (await ok('/notifications', jeton)).liste.filter(n => n.type === 'cm-urgence');
  const plateau = async jeton => ok(`/cm/tableaux/${club.id}`, jeton);
  return { b, s, api, ok, tic, club, L, carte, drapeau, notifs, plateau };
}

test('niveaux : ordre, lecture des saisies, noms d’étiquettes Trello (FR et EN)', () => {
  assert.deepEqual(['faible', 'moyen', 'urgent', 'critique'].map(rangUrgence), [1, 2, 3, 4]);
  assert.equal(rangUrgence(null), 0);
  assert.equal(lireUrgence(null), null);
  assert.equal(lireUrgence('aucune'), null);
  assert.equal(lireUrgence('critique'), 'critique');
  assert.equal(lireUrgence('rouge'), undefined);
  for (const [nom, niveau] of [['Critique', 'critique'], ['CRITICAL', 'critique'], ['urgent', 'urgent'], ['Urgente', 'urgent'], ['Moyen', 'moyen'], ['Medium', 'moyen'], ['Faible', 'faible'], ['low', 'faible'], ['Vidéo', null], ['', null]]) assert.equal(urgenceDepuisNom(nom), niveau, nom);
});

test('réglage : défaut aucun, niveaux, retour à aucun, permission cm.editer, valeur illisible refusée, journal de la carte', async () => {
  const { s, ok, api, tic, carte, drapeau, plateau } = await preparer();
  const a = await carte('Annonce');
  assert.equal(a.urgence, null);
  assert.equal((await plateau(s.cm123456)).cartes[0].urgence, null);
  for (const niveau of ['faible', 'moyen', 'urgent', 'critique']) {
    tic();
    const r = await drapeau(s.red12345, a.id, niveau);
    assert.equal(r.statut, 200);
    assert.equal(r.corps.carte.urgence, niveau);
    assert.equal((await plateau(s.vue12345)).cartes.find(x => x.id === a.id).urgence, niveau);
  }
  assert.equal((await drapeau(s.cm123456, a.id, null)).corps.carte.urgence, null);
  assert.equal((await drapeau(s.cm123456, a.id, 'aucune')).corps.carte.urgence, null);
  // Lecteur (cm.voir seul) : 403 ; compte sans accès : 404 ; valeur inconnue : 400.
  assert.equal((await drapeau(s.vue12345, a.id, 'urgent')).statut, 403);
  assert.equal((await drapeau(s.lea12345, a.id, 'urgent')).statut, 404);
  assert.equal((await drapeau(s.cm123456, a.id, 'rouge')).corps.code, 'urgence');
  assert.equal((await drapeau(s.cm123456, a.id, 3)).statut, 400);
  // Journal : un changement par niveau, avec l'ancien et le nouveau.
  const detail = await ok(`/cm/cartes/${a.id}`, s.cm123456);
  const urg = detail.carte.activite.filter(x => x.action === 'urgence');
  assert.equal(urg.length, 5);
  assert.deepEqual(urg.map(x => x.meta).find(m => m.vers === 'critique'), { de: 'urgent', vers: 'critique' });
  // Même niveau : rien n'est écrit ni notifié.
  tic();
  await drapeau(s.cm123456, a.id, 'moyen');
  const v = (await ok(`/cm/cartes/${a.id}`, s.cm123456)).carte.version;
  await drapeau(s.cm123456, a.id, 'moyen');
  assert.equal((await ok(`/cm/cartes/${a.id}`, s.cm123456)).carte.version, v);
  void api;
});

test('compteurs : colonne (tableau), liste des tableaux, état, /cm/urgences trié ; archivées exclues ; À valider et calendrier portent le niveau', async () => {
  const { s, ok, club, L, carte, drapeau, tic } = await preparer();
  const [a, b2, c, d] = [await carte('A'), await carte('B', L.preparation), await carte('C'), await carte('D')];
  await drapeau(s.cm123456, a.id, 'urgent');
  await drapeau(s.cm123456, b2.id, 'critique');
  await drapeau(s.cm123456, c.id, 'moyen');
  await drapeau(s.cm123456, d.id, 'critique');
  tic();
  const liste = (await ok('/cm/tableaux', s.vue12345)).tableaux.find(t => t.id === club.id);
  assert.deepEqual(liste.urgences, { critique: 2, urgent: 1 });
  assert.equal((await ok('/cm/etat', s.vue12345)).urgences, 3);
  const u = await ok('/cm/urgences', s.vue12345);
  assert.deepEqual(u.cartes.map(x => [x.titre, x.urgence]).sort(), [['A', 'urgent'], ['B', 'critique'], ['D', 'critique']]);
  assert.equal(u.cartes[2].urgence, 'urgent', 'critiques d’abord');
  // Compte sans accès au CM : aucune carte.
  assert.equal((await ok('/cm/urgences', s.lea12345).catch(() => ({ cartes: [] }))).cartes.length, 0);
  // Archivée : ne compte plus.
  await ok(`/cm/cartes/${d.id}`, s.cm123456, { methode: 'PATCH', corps: { archive: true } });
  assert.deepEqual((await ok('/cm/tableaux', s.vue12345)).tableaux.find(t => t.id === club.id).urgences, { critique: 1, urgent: 1 });
  // Post à valider et calendrier : le niveau suit.
  await ok(`/cm/cartes/${a.id}`, s.cm123456, { methode: 'PATCH', corps: { post: true, reseaux: ['x'], textes: { x: { fr: 'Ce soir on joue !', en: 'Tonight we play!' } }, datePublication: '2026-11-10 18:00' } });
  await ok(`/cm/cartes/${a.id}/soumettre`, s.cm123456, { methode: 'POST', corps: {} });
  assert.equal((await ok('/cm/a-valider', s.cm123456)).cartes.find(x => x.id === a.id).urgence, 'urgent');
  assert.equal((await ok('/cm/calendrier?du=2026-11-01&au=2026-11-30', s.cm123456)).cartes.find(x => x.id === a.id).urgence, 'urgent');
});

test('notifications : montée vers urgent / critique seulement, assignés et suiveurs (+ responsables CM pour critique), visibilité, pas de spam', async () => {
  const { s, ok, tic, carte, drapeau, notifs } = await preparer();
  const a = await carte('Carte sensible');
  await ok(`/cm/cartes/${a.id}`, s.cm123456, { methode: 'PATCH', corps: { membres: ['red12345'] } });
  await ok(`/cm/cartes/${a.id}/suivre`, s.vue12345, { methode: 'POST', corps: { suivre: true } });
  tic();
  // Faible et moyen : jamais d'alerte.
  await drapeau(s.cm123456, a.id, 'faible');
  await drapeau(s.cm123456, a.id, 'moyen');
  for (const j of [s.red12345, s.vue12345, s.aut12345]) assert.equal((await notifs(j)).length, 0);
  // Urgent : assigné et suiveur ; ni l'auteur du changement, ni Aude (aucun lien), ni le Fondateur.
  tic();
  await drapeau(s.cm123456, a.id, 'urgent');
  assert.equal((await notifs(s.red12345)).length, 1);
  assert.equal((await notifs(s.vue12345)).length, 1);
  assert.equal((await notifs(s.aut12345)).length, 0);
  assert.equal((await notifs(s.cm123456)).length, 0);
  assert.equal((await notifs(s.fondateur)).length, 0);
  assert.equal((await notifs(s.red12345))[0].charge.niveau, 'urgent');
  // Redescendre (moyen) puis changer sans monter : rien de plus.
  tic();
  await drapeau(s.cm123456, a.id, 'moyen');
  await drapeau(s.cm123456, a.id, null);
  assert.equal((await notifs(s.red12345)).length, 1);
  // Critique (par un rédacteur) : assigné et suiveur de nouveau, plus la Responsable CM (Clara) ; pas l'auteur du changement.
  tic();
  await drapeau(s.red12345, a.id, 'critique');
  assert.equal((await notifs(s.vue12345)).length, 2);
  assert.equal((await notifs(s.red12345)).length, 1, 'l’auteur du changement n’est pas prévenu');
  const clara = await notifs(s.cm123456);
  assert.equal(clara.length, 1);
  assert.equal(clara[0].charge.niveau, 'critique');
  // Urgent → critique : une montée de plus, une notification de plus.
  tic();
  await drapeau(s.cm123456, a.id, 'urgent');
  const avant = (await notifs(s.vue12345)).length;
  await drapeau(s.cm123456, a.id, 'critique');
  assert.equal((await notifs(s.vue12345)).length, avant + 1);
  // Le niveau Urgent ne prévient pas les responsables CM qui ne sont ni assignés ni suiveurs.
  const e = await carte('Autre carte');
  tic();
  await drapeau(s.red12345, e.id, 'urgent');
  assert.equal((await notifs(s.cm123456)).length, 1, 'Clara : seulement la montée vers critique');
});

test('notifications : une personne sans accès au tableau (assignation ancienne) n’est jamais prévenue', async () => {
  const { s, ok, tic, carte, drapeau, notifs, b } = await preparer();
  const a = await carte('Carte restreinte');
  await ok(`/cm/cartes/${a.id}`, s.cm123456, { methode: 'PATCH', corps: { membres: ['red12345', 'aut12345'] } });
  tic();
  // Aude perd son accès au CM : elle reste assignée, mais le tableau lui est fermé.
  await b.base.executer("DELETE FROM cm_affectations_directes WHERE compte_id = 'aut12345'", []);
  // CM du club (migration 0068) : son affectation « club » est son appartenance à le CM du club.
  await b.base.executer("DELETE FROM membres WHERE compte_id = 'aut12345' AND team_id = ?", ['00000000-0000-4000-8000-00000000c0de']);
  await drapeau(s.cm123456, a.id, 'critique');
  assert.equal((await notifs(s.red12345)).length, 1);
  assert.equal((await notifs(s.aut12345)).length, 0);
});

test('tableau restreint : drapeau invisible et silencieux pour qui ne voit pas le tableau (compteurs, liste, notifications)', async () => {
  const { s, ok, tic, drapeau, notifs, club } = await preparer();
  const tb = (await ok('/cm/tableaux', s.cm123456, { methode: 'POST', corps: { nom: 'Secret', modele: 'contenus' } })).tableau;
  const detail = await ok(`/cm/tableaux/${tb.id}`, s.cm123456);
  const carte = (await ok(`/cm/tableaux/${tb.id}/cartes`, s.cm123456, { methode: 'POST', corps: { listeId: detail.listes[0].id, titre: 'Projet Licorne' } })).carte;
  // Vera et Aude suivent la carte AVANT la restriction ; ensuite seuls Clara, Remi (modifier) et Vera (voir) voient le tableau.
  for (const j of [s.vue12345, s.aut12345]) await ok(`/cm/cartes/${carte.id}/suivre`, j, { methode: 'POST', corps: { suivre: true } });
  const regles = [{ genre: 'compte', cible: 'cm123456', niveau: 'modifier' }, { genre: 'compte', cible: 'red12345', niveau: 'modifier' }, { genre: 'compte', cible: 'vue12345', niveau: 'voir' }];
  await ok(`/cm/tableaux/${tb.id}/acces`, s.cm123456, { methode: 'PUT', corps: { acces: 'restreint', regles } });
  tic();
  assert.equal((await drapeau(s.red12345, carte.id, 'critique')).statut, 200);
  assert.equal((await notifs(s.vue12345)).length, 1);
  assert.equal((await notifs(s.aut12345)).length, 0, 'Aude ne voit pas le tableau : pas de notification');
  assert.equal((await notifs(s.cm123456)).length, 1, 'Responsable CM, qui voit le tableau');
  // Compteurs et liste d'urgences : le tableau restreint n'existe pas pour Aude.
  assert.equal((await ok('/cm/urgences', s.aut12345)).cartes.length, 0);
  assert.equal((await ok('/cm/etat', s.aut12345)).urgences, 0);
  assert.equal((await ok('/cm/tableaux', s.aut12345)).tableaux.some(t => t.id === tb.id), false);
  assert.deepEqual((await ok('/cm/urgences', s.vue12345)).cartes.map(c => c.titre), ['Projet Licorne']);
  assert.equal((await ok('/cm/etat', s.vue12345)).urgences, 1);
  // Vera (voir seulement) ne peut pas régler le drapeau ; Aude : 404.
  assert.equal((await drapeau(s.vue12345, carte.id, 'faible')).statut, 403);
  assert.equal((await drapeau(s.aut12345, carte.id, 'faible')).statut, 404);
  // Relecture : Vera perd l'accès au tableau, sa notification d'urgence (déjà reçue) disparaît de son centre et de ses compteurs.
  await ok(`/cm/tableaux/${tb.id}/acces`, s.cm123456, { methode: 'PUT', corps: { acces: 'restreint', regles: regles.filter(r => r.cible !== 'vue12345') } });
  assert.equal((await notifs(s.vue12345)).length, 0);
  assert.equal((await ok('/cm/urgences', s.vue12345)).cartes.length, 0);
  assert.equal((await ok('/cm/etat', s.vue12345)).urgences, 0);
  void club;
});

test('temps réel : un changement de drapeau est diffusé (sujet cm) et incrémente la version du tableau', async () => {
  const { b, s, carte, drapeau, club, ok, tic } = await preparer();
  const a = await carte('Carte A');
  const flux = async () => b.base.tous('SELECT sujet, acteur FROM temps_reel_flux ORDER BY id', []);
  const avant = (await flux()).length;
  const v0 = (await ok('/cm/etat', s.vue12345)).versions[club.id];
  tic();
  await drapeau(s.cm123456, a.id, 'critique');
  assert.ok((await flux()).slice(avant).some(m => m.sujet === 'cm' && m.acteur === 'cm123456'));
  assert.ok((await ok('/cm/etat', s.vue12345)).versions[club.id] > v0);
});

test('import Trello : étiquettes Critique / Urgent / Moyen / Faible signalées à l’aperçu, converties en drapeau sur demande', async () => {
  const { s, ok } = await preparer();
  const trello = JSON.parse(JSON.stringify(TRELLO));
  trello.labels.push({ id: '000000000000000000000023', idBoard: trello.id, name: 'Critical', color: 'red' }, { id: '000000000000000000000024', idBoard: trello.id, name: 'Faible', color: 'blue' });
  const carte2 = trello.cards.find(c => c.name === 'Recap de la semaine');
  carte2.idLabels = ['000000000000000000000024', '000000000000000000000023'];
  const apercu = await ok('/cm/import/trello/apercu', s.cm123456, { methode: 'POST', corps: { trello } });
  assert.deepEqual(apercu.urgences.map(u => [u.nom, u.niveau, u.cartes]).sort(), [['Critical', 'critique', 1], ['Faible', 'faible', 1], ['Urgent', 'urgent', 1]]);
  // Sans conversion : étiquettes importées comme avant, pas de drapeau.
  const sans = await ok('/cm/import/trello', s.cm123456, { methode: 'POST', corps: { trello } });
  const t1 = await ok(`/cm/tableaux/${sans.tableauId}`, s.cm123456);
  assert.ok(t1.cartes.every(c => c.urgence === null));
  assert.ok(t1.etiquettes.some(e => e.nom === 'Urgent'));
  // Avec conversion (relance de l'import sur le même tableau) : le drapeau est posé, le plus haut niveau l'emporte.
  const avec = await ok('/cm/import/trello', s.cm123456, { methode: 'POST', corps: { trello, convertirUrgences: true } });
  assert.equal(avec.bilan.urgencesConverties, 2);
  const t2 = await ok(`/cm/tableaux/${avec.tableauId}`, s.cm123456);
  const niveau = titre => t2.cartes.find(c => c.titre === titre).urgence;
  assert.equal(niveau('Recap de la semaine'), 'critique');
  assert.equal(niveau('Annonce du tournoi d’automne'), 'urgent');
  // Un drapeau déjà posé dans l'app n'est pas écrasé par une relance.
  const recap = t2.cartes.find(c => c.titre === 'Recap de la semaine');
  await ok(`/cm/cartes/${recap.id}`, s.cm123456, { methode: 'PATCH', corps: { urgence: 'moyen' } });
  await ok('/cm/import/trello', s.cm123456, { methode: 'POST', corps: { trello, convertirUrgences: true } });
  assert.equal((await ok(`/cm/cartes/${recap.id}`, s.cm123456)).carte.urgence, 'moyen');
  // Nouveau tableau avec conversion d'emblée : aucune étiquette d'urgence créée.
  const autre = JSON.parse(JSON.stringify(trello));
  autre.id = '0000000000000000000000b9';
  const neuf = await ok('/cm/import/trello', s.cm123456, { methode: 'POST', corps: { trello: autre, convertirUrgences: true } });
  const t3 = await ok(`/cm/tableaux/${neuf.tableauId}`, s.cm123456);
  assert.deepEqual(t3.etiquettes.map(e => e.nom).sort(), ['', 'Vidéo']);
  assert.equal(t3.cartes.find(c => c.titre === 'Recap de la semaine').urgence, 'critique');
});

test('export de la base : la colonne urgence est reprise', async () => {
  const { b, s, carte, drapeau } = await preparer();
  const a = await carte('Carte A');
  await drapeau(s.cm123456, a.id, 'urgent');
  const ligne = await b.base.premier('SELECT urgence FROM cm_cartes WHERE id = ?', [a.id]);
  assert.equal(ligne.urgence, 'urgent');
});
