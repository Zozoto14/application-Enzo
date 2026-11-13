/**
 * Atelier de strats, côté serveur : champs du document ajoutés pour l'atelier (verrou d'objet, fumée creuse,
 * usage d'un tracé, couleurs par agent) gardés par la validation et rien d'autre ; versions de l'enregistrement
 * AUTOMATIQUE regroupées (une version par personne et par tranche de 5 minutes), un « Enregistrer » explicite
 * garde toujours la sienne ; le verrou optimiste vaut aussi pour l'automatique.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { ASCENT, docExemple } from './strats-aide.mjs';
import { validerDocument } from '../noyau/strats/document.mjs';
import { REGROUPEMENT_AUTO_MS } from '../noyau/strats/service.mjs';

const MEMBRES = {
  coach123: { pseudo: 'Coach Zed', role: 'coach' },
  ana12345: { pseudo: 'Ana', role: 'analyste' },
  lea12345: { pseudo: 'Léa', role: 'joueur' },
};

async function preparer() {
  const b = await banc();
  const team = await teamAvecMembres(b, { membres: MEMBRES });
  const url = `/teams/${team.teamId}/strats`;
  const id = (await b.appel(url, { methode: 'POST', jeton: team.sessions.coach123, corps: { titre: 'Exec A', type: 'execute', carte: ASCENT, side: 'attaque' } })).corps.id;
  const enregistrer = (jeton, revision, donnees, plus = {}) => b.appel(`${url}/${id}`, { methode: 'PUT', jeton, corps: { revision, donnees, ...plus } });
  const versions = async () => (await b.appel(`${url}/${id}/versions`, { jeton: team.sessions.lea12345 })).corps.versions.map(v => v.revision);
  return { b, ...team, url, id, enregistrer, versions };
}

/** Document d'exemple dont le premier pion est décalé de `n` (un changement par enregistrement). */
function docDecale(n) {
  const d = docExemple();
  d.etapes[0].objets[0].x = 400 + n;
  return d;
}

test('document : verrou d’objet, fumée creuse, usage d’un tracé, couleurs par agent — gardés, valeurs inconnues écartées', () => {
  const d = docExemple();
  d.couleurs = 'agent';
  d.etapes[0].objets[0].verrou = true;
  d.etapes[0].objets[1].creux = true;
  d.etapes[0].objets[1].verrou = 'oui';
  d.etapes[0].objets[2].usage = 'regard';
  d.etapes[0].objets[3].usage = 'regard';
  d.etapes[0].objets[3].creux = true;
  const v = validerDocument(d);
  assert.equal(v.couleurs, 'agent');
  const [pion, fumee, fleche, texte] = v.etapes[0].objets;
  assert.equal(pion.verrou, true);
  assert.equal(fumee.creux, true);
  assert.equal(fumee.verrou, undefined, 'seul `true` verrouille');
  assert.equal(fleche.usage, 'regard');
  assert.equal(texte.usage, undefined, 'un texte n’a pas d’usage');
  assert.equal(texte.creux, undefined, 'seule une capacité peut être creuse');
  // Forme canonique : valider deux fois ne change rien.
  assert.deepEqual(validerDocument(JSON.parse(JSON.stringify(v))), v);
  // Valeurs par défaut non écrites ; valeurs inconnues écartées.
  const d2 = docExemple();
  d2.couleurs = 'arc-en-ciel';
  d2.etapes[0].objets[2].usage = 'sprint';
  d2.etapes[0].objets[0].verrou = false;
  const v2 = validerDocument(d2);
  assert.equal('couleurs' in v2, false);
  assert.equal('usage' in v2.etapes[0].objets[2], false);
  assert.equal('verrou' in v2.etapes[0].objets[0], false);
  assert.equal('couleurs' in validerDocument({ ...docExemple(), couleurs: 'joueur' }), false, '« joueur » est le défaut');
});

test('enregistrement automatique : les versions d’une même personne se regroupent (une par tranche de 5 minutes)', async () => {
  const { b, sessions, enregistrer, versions } = await preparer();
  assert.deepEqual(await versions(), [1]);
  // Trois enregistrements automatiques rapprochés : la révision monte, UNE seule version dans l'historique.
  let r = await enregistrer(sessions.coach123, 1, docDecale(1), { auto: true });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.revision, 2);
  b.horloge.t += 20_000;
  r = await enregistrer(sessions.coach123, 2, docDecale(2), { auto: true });
  assert.equal(r.corps.revision, 3);
  b.horloge.t += 20_000;
  r = await enregistrer(sessions.coach123, 3, docDecale(3), { auto: true });
  assert.equal(r.corps.revision, 4);
  assert.equal(r.corps.donnees.etapes[0].objets[0].x, 403);
  assert.deepEqual(await versions(), [4, 1], 'la version automatique a avancé au lieu de s’empiler');
});

test('enregistrement automatique : contenu de la version regroupée, délai dépassé, autre personne, « Enregistrer » explicite', async () => {
  const { b, sessions, url, id, enregistrer, versions } = await preparer();
  await enregistrer(sessions.coach123, 1, docDecale(1), { auto: true });
  await enregistrer(sessions.coach123, 2, docDecale(2), { auto: true });
  assert.deepEqual(await versions(), [3, 1]);
  const v3 = await b.appel(`${url}/${id}/versions/3`, { jeton: sessions.lea12345 });
  assert.equal(v3.statut, 200);
  assert.equal(v3.corps.donnees.etapes[0].objets[0].x, 402);
  assert.equal((await b.appel(`${url}/${id}/versions/2`, { jeton: sessions.lea12345 })).statut, 404, 'révision intermédiaire fondue dans la suivante');
  // Plus de 5 minutes après la PREMIÈRE écriture du groupe : une nouvelle version automatique.
  b.horloge.t += REGROUPEMENT_AUTO_MS + 1000;
  await enregistrer(sessions.coach123, 3, docDecale(3), { auto: true });
  assert.deepEqual(await versions(), [4, 3, 1]);
  // Une autre personne : sa propre version, jamais celle d'un autre.
  let r = await enregistrer(sessions.ana12345, 4, docDecale(4), { auto: true });
  assert.equal(r.corps.majPar.pseudo, 'Ana');
  assert.deepEqual(await versions(), [5, 4, 3, 1]);
  // « Enregistrer » explicite : toujours une version de plus, et la suivante automatique ne l'écrase pas.
  r = await enregistrer(sessions.ana12345, 5, docDecale(5));
  assert.equal(r.corps.revision, 6);
  assert.deepEqual(await versions(), [6, 5, 4, 3, 1]);
  r = await enregistrer(sessions.ana12345, 6, docDecale(6), { auto: true });
  assert.deepEqual(await versions(), [7, 6, 5, 4, 3, 1]);
  const v6 = await b.appel(`${url}/${id}/versions/6`, { jeton: sessions.lea12345 });
  assert.equal(v6.corps.donnees.etapes[0].objets[0].x, 405, 'la version explicite garde son document');
  // `auto` doit être le booléen true : toute autre valeur vaut un enregistrement normal.
  r = await enregistrer(sessions.ana12345, 7, docDecale(7), { auto: 'oui' });
  assert.equal(r.statut, 200);
  assert.deepEqual((await versions()).slice(0, 3), [8, 7, 6]);
});

test('enregistrement automatique : verrou optimiste (409), droits et validation inchangés', async () => {
  const { sessions, enregistrer, versions } = await preparer();
  await enregistrer(sessions.coach123, 1, docDecale(1), { auto: true });
  // Révision dépassée : refusée, avec la révision courante ; rien n'est écrit.
  let r = await enregistrer(sessions.ana12345, 1, docDecale(9), { auto: true });
  assert.equal(r.statut, 409);
  assert.equal(r.corps.code, 'conflit');
  assert.equal(r.corps.details.revision, 2);
  assert.deepEqual(await versions(), [2, 1]);
  // Le Joueur lit mais n'écrit pas, automatique ou non.
  assert.equal((await enregistrer(sessions.lea12345, 2, docDecale(3), { auto: true })).statut, 403);
  // Document invalide : refusé.
  r = await enregistrer(sessions.coach123, 2, { ...docDecale(3), side: 'milieu' }, { auto: true });
  assert.equal(r.statut, 400);
  assert.equal(r.corps.code, 'strat-invalide');
  assert.deepEqual(await versions(), [2, 1]);
});
