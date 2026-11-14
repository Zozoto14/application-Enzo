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

test('page de partage : même langage visuel que l’atelier (plateau, genres des utilitaires, pions au-dessus)', async () => {
  const { genreCapacite, svgEtape, CSP_PAGE_STRAT } = await import('../noyau/strats/svg.mjs');
  const { default: T } = await import('../noyau/strats/plateau.json', { with: { type: 'json' } });
  const cap = (nom, zone, plus = {}) => ({ type: 'capacite', nom, zone, capacite: 'Ability2', ...plus });
  assert.equal(genreCapacite(cap('Dark Cover', { forme: 'cercle', rayon: 4.1 })).genre, 'fumee');
  assert.deepEqual(genreCapacite(cap('Incendiary', { forme: 'cercle', rayon: 4.5 })), { genre: 'zone', ultime: false, chaud: true });
  assert.equal(genreCapacite(cap('Alarmbot', { forme: 'cercle', rayon: 5 })).genre, 'piege');
  assert.equal(genreCapacite(cap('Goo Grenade', { forme: 'cercle', rayon: 3 })).genre, 'blob');
  assert.equal(genreCapacite(cap('Flashpoint', { forme: 'cone', angle: 0, ouverture: 110, portee: 18 })).genre, 'eclair');
  assert.equal(genreCapacite(cap('Recon Bolt', { forme: 'trajet', dx: 1, dy: 1, rayon: 10 })).genre, 'recon');
  assert.equal(genreCapacite(cap('Trapwire', { forme: 'ligne', angle: 0, longueur: 10 })).genre, 'fil');
  assert.equal(genreCapacite(cap('Orbital Strike', { forme: 'cercle', rayon: 9 }, { capacite: 'Ultimate' })).ultime, true);
  assert.equal(genreCapacite(cap('Dark Cover', null)).genre, 'icone');

  const d = docExemple();
  d.etapes[0].objets[1].creux = true;
  d.etapes[0].objets[1].ordre = 2;
  d.etapes[0].objets[2].usage = 'regard';
  d.etapes[0].objets.push({ id: 'x1', type: 'agent', x: 700, y: 300, agent: 'inconnu', nom: '?', icone: null, joueur: null, couleur: '#ef4444' });
  const svg = svgEtape(validerDocument(d), 0);
  // Map en plateau (hors Valorant) : filtre sur l'alpha de la minimap, couleurs du thème « Tactique sombre » des jetons.
  const plateau = svgEtape({ ...validerDocument(d), modele: 'thefinals' }, 0);
  assert.match(plateau, /<filter id="plateau"/);
  assert.match(plateau, /<image href="https:\/\/media\.valorant-api\.com\/maps\/7eaecc1b\/displayicon\.png"[^>]*filter="url\(#plateau\)"/);
  assert.ok(plateau.includes(`fill="${T.themes.tactique.fond}"`) && plateau.includes(`flood-color="${T.themes.tactique.sol}"`) && plateau.includes(`flood-color="${T.themes.tactique.contour}"`));
  // Valorant : image d'origine de la map, sans filtre.
  assert.ok(!svg.includes('url(#plateau)'));
  // Portrait découpé en rond par-dessus les initiales ; nom du joueur sous son pion ; ennemi inconnu : « ? ».
  assert.match(svg, /<clipPath id="rond-a1">.*<image href="https:\/\/media\.valorant-api\.com\/agents\/8e253930\/displayicon\.png"[^>]*clip-path="url\(#rond-a1\)"/);
  assert.ok(svg.includes('>Joueur 2</text>'));
  assert.ok(svg.includes('>?</text>'));
  // Fumée creuse (sans dégradé plein), numéro d'ordre, tracé « regard » en pointillés.
  assert.ok(!svg.includes('id="g-c1"'));
  assert.match(svg, />2<\/text>/);
  assert.match(svg, /<polyline[^>]*stroke-dasharray="2\.0 9\.5"/);
  // Les pions sont dessinés après les zones et les tracés.
  assert.ok(svg.indexOf('rond-a1') > svg.indexOf('<polyline'));
  // Rien d'externe en dehors des images du CDN officiel : la CSP de la page ne change pas.
  assert.ok(!/<script|javascript:|url\(https?:/i.test(svg));
  assert.match(CSP_PAGE_STRAT, /img-src https:\/\/media\.valorant-api\.com data:/);
});

test('profil de jeu : accent d’un personnage et d’une capacité gardés (#rrggbb seulement) ; page de partage en « Couleur : agent »', async () => {
  const { validerDonnees } = await import('../noyau/jeux/schema.mjs');
  const { completerIcones } = await import('../noyau/strats/svg.mjs');
  const { donnees } = validerDonnees({
    personnages: [
      { cle: 'omen', nom: 'Omen', classe: null, image: null, actif: true, couleur: '#6D5BD0', capacites: [{ cle: 'cover', nom: 'Dark Cover', touche: 'E', categorie: 'basique', forme: 'cercle', rayon: 4.1, couleur: '#112233', aVerifier: true }, { cle: 'step', nom: 'Shrouded Step', touche: 'C', categorie: 'basique', forme: 'point', couleur: 'violet', aVerifier: true }] },
      { cle: 'sova', nom: 'Sova', classe: null, image: null, actif: true, couleur: 'bleu' },
    ],
  });
  const [omen, sova] = donnees.personnages;
  assert.equal(omen.couleur, '#6d5bd0');
  assert.equal(omen.capacites[0].couleur, '#112233');
  assert.equal('couleur' in omen.capacites[1], false);
  assert.equal('couleur' in sova, false);
  // Page publique : seulement quand la strat le demande ; la capacité E prend son accent propre.
  const d = validerDocument(docExemple());
  assert.equal(completerIcones(d, donnees).etapes[0].objets[1].couleur, '#3b82f6');
  const parAgent = completerIcones({ ...d, couleurs: 'agent' }, donnees);
  assert.equal(parAgent.etapes[0].objets[1].couleur, '#112233');
  assert.equal(parAgent.etapes[0].objets[0].couleur, '#3b82f6', 'le pion garde la couleur du joueur');
});
