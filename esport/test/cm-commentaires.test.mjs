/**
 * Commentaires non lus des cartes CM (migration 0045, docs/esport/cm.md) : compteur PAR COMPTE (ses propres
 * commentaires exclus, premier passage à zéro), état « vu » à l'ouverture de la fiche (GET ?vu=1) et « Tout marquer
 * comme lu », remontées par carte, tableau, liste des tableaux et état global, permissions, notifications aux seules
 * personnes concernées (assignées, auteur de la carte, suiveurs, @mentionnées), temps réel, export et RGPD.
 *
 * Tourne sur SQLite (défaut) et sur PostgreSQL (ESPORT_TEST_PG, esport/test/pg/lancer.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { TABLES } from '../noyau/transfert.mjs';

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
  const commenter = async (jeton, id, texte) => {
    tic();
    return ok(`/cm/cartes/${id}/commentaires`, jeton, { methode: 'POST', corps: { texte } });
  };
  const non = async jeton => (await ok('/cm/etat', jeton)).nonLus;
  const plateau = async jeton => ok(`/cm/tableaux/${club.id}`, jeton);
  const notifs = async jeton => (await ok('/notifications', jeton)).liste;
  // Premier passage de chacun : rien n'est « non lu » (ce qui existait avant n'encombre pas les pastilles).
  tic();
  for (const j of [s.cm123456, s.red12345, s.vue12345, s.aut12345]) assert.equal((await non(j)).total, 0);
  tic();
  return { b, A, s, api, ok, tic, club, L, carte, commenter, non, plateau, notifs };
}

test('compteur par compte : ses propres commentaires exclus, par carte, par tableau, dans la liste et l’état', async () => {
  const { s, ok, club, L, carte, commenter, non, plateau } = await preparer();
  const a = await carte('Carte A');
  const c = await carte('Carte B', L.preparation);
  await commenter(s.cm123456, a.id, 'Un');
  await commenter(s.cm123456, a.id, 'Deux');
  await commenter(s.cm123456, c.id, 'Trois');
  // Clara a écrit : rien de non lu pour elle.
  assert.equal((await non(s.cm123456)).total, 0);
  assert.equal((await plateau(s.cm123456)).nonLus, 0);
  // Remi : 2 + 1 ; chaque carte porte son nombre (la colonne les additionne côté app).
  let t = await plateau(s.red12345);
  assert.deepEqual([t.nonLus, t.cartes.find(x => x.id === a.id).nonLus, t.cartes.find(x => x.id === c.id).nonLus], [3, 2, 1]);
  assert.equal(t.cartes.find(x => x.id === c.id).listeId, L.preparation);
  assert.deepEqual(await non(s.red12345), { total: 3, tableaux: { [club.id]: 3 } });
  assert.equal((await ok('/cm/tableaux', s.red12345)).tableaux.find(x => x.id === club.id).nonLus, 3);
  assert.equal((await ok('/cm/tableaux', s.red12345)).nonLus, 3);
  // Remi commente à son tour : Clara a 1 non lu, Remi toujours 3 (le sien ne compte pas).
  await commenter(s.red12345, a.id, 'Réponse de Remi');
  assert.equal((await non(s.cm123456)).total, 1);
  assert.equal((await non(s.red12345)).total, 3);
  // Compte lecteur (cm.voir seul) : mêmes compteurs ; compte sans accès au CM : aucun.
  assert.equal((await non(s.vue12345)).total, 4);
  assert.deepEqual(await non(s.lea12345), { total: 0, tableaux: {} });
  // Un commentaire supprimé ne compte plus ; une carte archivée non plus.
  const dernier = (await ok(`/cm/cartes/${a.id}`, s.cm123456)).carte.commentaires.find(x => x.texte === 'Réponse de Remi');
  await ok(`/cm/commentaires/${dernier.id}`, s.red12345, { methode: 'DELETE' });
  assert.equal((await non(s.cm123456)).total, 0);
  await ok(`/cm/cartes/${c.id}`, s.cm123456, { methode: 'PATCH', corps: { archive: true } });
  assert.equal((await non(s.red12345)).total, 2);
  t = await plateau(s.red12345);
  assert.equal(t.nonLus, 2);
});

test('ouvrir la fiche (GET ?vu=1) marque la carte lue pour ce compte seulement ; « Nouveaux » mis en évidence', async () => {
  const { s, ok, carte, commenter, non, plateau, tic } = await preparer();
  const a = await carte('Carte A');
  await commenter(s.cm123456, a.id, 'Avant lecture 1');
  await commenter(s.cm123456, a.id, 'Avant lecture 2');
  // Lire sans `vu` ne marque rien (l'app relit aussi après ses propres modifications).
  let d = await ok(`/cm/cartes/${a.id}`, s.red12345);
  assert.deepEqual([d.carte.nonLus, d.carte.commentaires.map(x => x.nouveau)], [2, [true, true]]);
  assert.equal((await non(s.red12345)).total, 2);
  // Ouverture : la réponse dit encore ce qui était nouveau, puis la carte est lue.
  tic();
  d = await ok(`/cm/cartes/${a.id}?vu=1`, s.red12345);
  assert.deepEqual([d.carte.nonLus, d.carte.commentaires.map(x => x.nouveau)], [2, [true, true]]);
  assert.ok(d.carte.vuAvant);
  assert.equal((await non(s.red12345)).total, 0);
  assert.equal((await plateau(s.red12345)).cartes[0].nonLus, 0);
  // Les autres comptes ne sont pas touchés.
  assert.equal((await non(s.vue12345)).total, 2);
  // Un nouveau commentaire : « Nouveaux » ne montre que lui (séparateur) ; la mise en évidence est relative à la dernière ouverture.
  await commenter(s.cm123456, a.id, 'Après lecture');
  d = await ok(`/cm/cartes/${a.id}`, s.red12345);
  assert.deepEqual(d.carte.commentaires.map(x => x.nouveau), [false, false, true]);
  assert.equal((await non(s.red12345)).total, 1);
  tic();
  await ok(`/cm/cartes/${a.id}?vu=1`, s.red12345);
  assert.equal((await non(s.red12345)).total, 0);
  // Ses propres commentaires ne sont jamais « nouveaux » pour l'auteur.
  d = await ok(`/cm/cartes/${a.id}?vu=1`, s.cm123456);
  assert.equal(d.carte.nonLus, 0);
  assert.equal(d.carte.commentaires.some(x => x.nouveau), false);
});

test('« Tout marquer comme lu » sur un tableau ; permissions (404 sans accès au tableau, jamais pour un autre compte)', async () => {
  const { s, api, ok, club, carte, commenter, non, tic } = await preparer();
  const a = await carte('Carte A');
  const c = await carte('Carte B');
  await commenter(s.cm123456, a.id, 'x');
  await commenter(s.cm123456, c.id, 'y');
  tic();
  assert.equal((await non(s.vue12345)).total, 2);
  assert.equal((await api(`/cm/tableaux/${club.id}/tout-vu`, s.lea12345, { methode: 'POST', corps: {} })).statut, 404, 'sans accès au CM : le tableau n’existe pas');
  assert.equal((await non(s.vue12345)).total, 2);
  await ok(`/cm/tableaux/${club.id}/tout-vu`, s.vue12345, { methode: 'POST', corps: {} });
  assert.equal((await non(s.vue12345)).total, 0);
  assert.equal((await non(s.red12345)).total, 2, 'l’état est par compte');
  tic();
  await commenter(s.cm123456, a.id, 'z');
  assert.equal((await non(s.vue12345)).total, 1);
  // Lecteur : peut marquer lu et suivre, mais pas commenter.
  assert.equal((await api(`/cm/cartes/${a.id}/commentaires`, s.vue12345, { methode: 'POST', corps: { texte: 'non' } })).statut, 403);
  assert.equal((await api(`/cm/cartes/${a.id}/suivre`, s.lea12345, { methode: 'POST', corps: { suivre: true } })).statut, 404);
  assert.equal((await api(`/cm/cartes/${a.id}`, s.lea12345)).statut, 404);
});

test('notification de commentaire : assignés, auteur de la carte, suiveurs et @mentionnés seulement, une par carte tant qu’elle n’est pas lue', async () => {
  const { b, s, api, ok, carte, commenter, notifs, tic } = await preparer();
  const a = await carte('Carte suivie');
  await ok(`/cm/cartes/${a.id}`, s.cm123456, { methode: 'PATCH', corps: { membres: ['red12345'] } });
  assert.equal((await ok(`/cm/cartes/${a.id}/suivre`, s.vue12345, { methode: 'POST', corps: { suivre: true } })).suivie, true);
  assert.equal((await ok(`/cm/cartes/${a.id}`, s.vue12345)).carte.suivie, true);
  assert.equal((await ok(`/cm/cartes/${a.id}`, s.aut12345)).carte.suivie, false);
  const genre = async (jeton, type) => (await notifs(jeton)).filter(n => n.type === type);
  tic();
  await commenter(s.cm123456, a.id, 'Premier commentaire');
  // Assigné et suiveur : prévenus ; l'auteur du commentaire (aussi auteur de la carte) et Aude (aucun lien) : non.
  assert.equal((await genre(s.red12345, 'cm-commentaire')).length, 1);
  assert.equal((await genre(s.vue12345, 'cm-commentaire')).length, 1);
  assert.equal((await genre(s.cm123456, 'cm-commentaire')).length, 0);
  assert.equal((await genre(s.aut12345, 'cm-commentaire')).length, 0);
  assert.equal((await notifs(s.aut12345)).some(n => /commentaire/.test(n.type)), false, 'rien dans le fil des autres');
  // Pas de rafale : une seconde notification non lue pour la même carte n'est pas créée.
  await commenter(s.cm123456, a.id, 'Deuxième commentaire');
  assert.equal((await genre(s.red12345, 'cm-commentaire')).length, 1);
  // L'assigné répond : l'auteur de la carte est prévenu (le suiveur aussi), l'assigné lui-même non.
  await commenter(s.red12345, a.id, 'Je m’en occupe');
  assert.equal((await genre(s.cm123456, 'cm-commentaire')).length, 1);
  assert.equal((await genre(s.red12345, 'cm-commentaire')).length, 1);
  // Mention : une seule notification (cm-mention), pas de doublon pour un suiveur mentionné ; Aude mentionnée l'a aussi.
  await commenter(s.cm123456, a.id, 'Tu as vu @Vera et @Aude ?');
  assert.equal((await genre(s.vue12345, 'cm-mention')).length, 1);
  assert.equal((await genre(s.aut12345, 'cm-mention')).length, 1);
  assert.equal((await genre(s.aut12345, 'cm-commentaire')).length, 0);
  // Ne plus suivre : plus de notification de commentaire.
  await ok(`/cm/cartes/${a.id}/suivre`, s.vue12345, { methode: 'POST', corps: { suivre: false } });
  const avant = (await genre(s.vue12345, 'cm-commentaire')).length;
  await b.base.executer("UPDATE notifications SET lue_le = ? WHERE type = 'cm-commentaire'", ['2026-10-20T10:00:00.000Z']);
  await commenter(s.cm123456, a.id, 'Encore');
  assert.equal((await genre(s.vue12345, 'cm-commentaire')).length, avant);
  assert.equal((await genre(s.red12345, 'cm-commentaire')).length, 2, 'lue : une nouvelle notification est possible');
  void api;
});

test('temps réel : un commentaire est diffusé (sujet cm), l’état « lu » et « suivre » ne le sont jamais', async () => {
  const { b, s, ok, club, carte, commenter, tic } = await preparer();
  const a = await carte('Carte A');
  const flux = async () => (await b.base.tous('SELECT sujet, acteur FROM temps_reel_flux ORDER BY id', []));
  const avant = (await flux()).length;
  await commenter(s.cm123456, a.id, 'Salut');
  const apres = await flux();
  assert.ok(apres.length > avant);
  assert.ok(apres.slice(avant).some(m => m.sujet === 'cm' && m.acteur === 'cm123456'));
  tic();
  const n = apres.length;
  await ok(`/cm/tableaux/${club.id}/tout-vu`, s.red12345, { methode: 'POST', corps: {} });
  await ok(`/cm/cartes/${a.id}/suivre`, s.red12345, { methode: 'POST', corps: { suivre: true } });
  await ok(`/cm/cartes/${a.id}?vu=1`, s.red12345);
  assert.equal((await flux()).length, n);
});

test('commentaires non lus : export de la base, RGPD (export, effacement)', async () => {
  const { b, s, ok, club, carte, commenter, tic } = await preparer();
  const a = await carte('Carte A');
  await commenter(s.cm123456, a.id, 'x');
  tic();
  await ok(`/cm/tableaux/${club.id}/tout-vu`, s.red12345, { methode: 'POST', corps: {} });
  tic();
  await ok(`/cm/cartes/${a.id}?vu=1`, s.red12345);
  await ok(`/cm/cartes/${a.id}/suivre`, s.red12345, { methode: 'POST', corps: { suivre: true } });
  assert.ok(TABLES.some(([t]) => t === 'cm_commentaires_vus'));
  assert.ok(TABLES.some(([t]) => t === 'cm_carte_suivis'));
  const { exportCm, effacementCm } = await import('../noyau/cm/rgpd.mjs');
  const e = await exportCm(b.base, 'red12345');
  assert.ok(e.cmCommentairesVus.some(v => v.cible === 'carte : Carte A'));
  assert.ok(e.cmCommentairesVus.some(v => v.cible === 'premier passage'));
  assert.ok(e.cmCommentairesVus.some(v => v.cible === 'tableau : Contenus' || v.cible.startsWith('tableau : ')));
  assert.deepEqual(e.cmCartesSuivies.map(c => c.titre), ['Carte A']);
  await b.base.lot(await effacementCm(b.base, 'red12345'));
  assert.equal((await b.base.tous("SELECT * FROM cm_commentaires_vus WHERE compte_id = 'red12345'", [])).length, 0);
  assert.equal((await b.base.tous("SELECT * FROM cm_carte_suivis WHERE compte_id = 'red12345'", [])).length, 0);
  assert.equal((await b.base.tous("SELECT * FROM cm_commentaires_vus WHERE compte_id = 'vue12345'", [])).length, 1, 'les autres comptes gardent leur état');
});
