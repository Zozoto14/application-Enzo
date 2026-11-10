/**
 * Tableaux CM façon Trello (docs/esport/cm.md, migration 0042) — de l'API à la base, chaque modification d'une
 * carte passant comme l'app l'envoie sur o2switch : POST + `X-Methode: PATCH|PUT|DELETE` (frontal mutualisé).
 *
 *  - chaque type de modification (titre, description, étiquettes, échéance, membres, couverture, archivage,
 *    checklist, élément, commentaire, pièce jointe, déplacement) relu en base ;
 *  - cartes importées de Trello, carte de suggestion automatique, post validé qui repasse « à valider »,
 *    version attendue (409), permissions (cm.voir seul : 403 ; dépôt : son auteur) ;
 *  - un membre assigné qui a perdu l'accès ne bloque plus les autres changements de membres ;
 *  - fond du tableau (teintes, dégradés, image envoyée ; cm.editer ; lien signé) ;
 *  - préférences d'affichage par compte (colonnes réduites, calendriers des teams) ;
 *  - calendriers des teams superposés : planning pour un membre, compétition PUBLIABLE seulement pour le CM du
 *    club (jamais un scrim ni un événement du planning), rien sans cm.voir.
 *
 * Tourne sur SQLite (défaut) et sur PostgreSQL (ESPORT_TEST_PG, esport/test/pg/lancer.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { banc, teamAvecMembres } from './aide.mjs';
import { morceau, sha } from './medias-aide.mjs';

const TRELLO = JSON.parse(readFileSync(new URL('./donnees/trello-exemple.json', import.meta.url), 'utf8'));

async function preparer() {
  const b = await banc();
  const A = await teamAvecMembres(b, { membres: { coach123: { pseudo: 'Zed', role: 'coach' }, lea12345: { pseudo: 'Léa', role: 'joueur' } } });
  const s = { ...A.sessions };
  s.cm123456 = await b.session('cm123456', 'Clara');
  s.red12345 = await b.session('red12345', 'Remi');
  s.vue12345 = await b.session('vue12345', 'Vera');
  const api = (chemin, jeton, o = {}) => b.appel(chemin, { jeton, methode: o.methode, corps: o.corps });
  // Écriture comme l'app derrière le frontal o2switch : PATCH, PUT et DELETE partent en POST + X-Methode.
  const ecrire = (chemin, jeton, methode, corps) =>
    ['PATCH', 'PUT', 'DELETE'].includes(methode) ? b.appel(chemin, { methode: 'POST', jeton, corps, entetes: { 'X-Methode': methode } }) : b.appel(chemin, { methode, jeton, corps });
  const ok = async (chemin, jeton, methode = 'GET', corps) => {
    const r = methode === 'GET' ? await api(chemin, jeton) : await ecrire(chemin, jeton, methode, corps);
    assert.equal(r.statut, 200, `${methode} ${chemin} : ${r.statut} ${JSON.stringify(r.corps)}`);
    return r.corps;
  };
  await ok('/cm/affectations', s.fondateur, 'POST', { compte: 'cm123456', roleId: 'cm-role-responsable', portee: 'club' });
  // Rôle CM « Lecteur » : voir seulement (cm.voir).
  const lecteur = await ok('/cm/roles', s.fondateur, 'POST', { nom: 'Lecteur', couleur: '#123456', permissions: ['cm.voir'] });
  await ok('/cm/affectations', s.fondateur, 'POST', { compte: 'vue12345', roleId: lecteur.id ?? lecteur.role?.id, portee: 'club' });
  const club = (await ok('/cm/tableaux', s.cm123456)).tableaux.find(t => t.portee === 'club');
  const tb = await ok(`/cm/tableaux/${club.id}`, s.cm123456);
  const L = Object.fromEntries(tb.listes.map(l => [l.cle, l.id]));
  return { b, A, s, api, ecrire, ok, club, L };
}

test('chaque modification d’une carte, en POST + X-Methode, est enregistrée en base', async () => {
  const { b, s, ok, club, L } = await preparer();
  const { carte } = await ok(`/cm/tableaux/${club.id}/cartes`, s.cm123456, 'POST', { listeId: L.idees, titre: 'Carte' });
  const id = carte.id;
  const ligne = () => b.base.premier('SELECT * FROM cm_cartes WHERE id = ?', [id]);
  const etiquette = await ok(`/cm/tableaux/${club.id}/etiquettes`, s.cm123456, 'POST', { nom: 'Valorant', couleur: '#4bce97' });
  const patch = corps => ok(`/cm/cartes/${id}`, s.cm123456, 'PATCH', corps);

  assert.equal((await patch({ titre: 'Titre modifié' })).carte.titre, 'Titre modifié');
  assert.equal((await ligne()).titre, 'Titre modifié');
  await patch({ description: 'Une **description**' });
  assert.equal((await ligne()).description, 'Une **description**');
  await patch({ etiquettes: [etiquette.id] });
  assert.deepEqual((await b.base.tous('SELECT etiquette_id FROM cm_carte_etiquettes WHERE carte_id = ?', [id])).map(l => l.etiquette_id), [etiquette.id]);
  await patch({ echeance: '2026-12-01 18:00', echeanceFaite: true });
  assert.deepEqual([(await ligne()).echeance, Number((await ligne()).echeance_faite)], ['2026-12-01T17:00:00.000Z', 1]);
  await patch({ membres: ['cm123456'] });
  assert.deepEqual((await b.base.tous('SELECT compte_id FROM cm_carte_membres WHERE carte_id = ?', [id])).map(l => l.compte_id), ['cm123456']);
  await patch({ couverture: { couleur: '#579dff' } });
  assert.equal((await ligne()).couverture, JSON.stringify({ couleur: '#579dff' }));
  await patch({ archive: true });
  assert.ok((await ligne()).archive_le);
  await patch({ archive: false });
  assert.equal((await ligne()).archive_le, null);

  const k = (await ok(`/cm/cartes/${id}/checklists`, s.cm123456, 'POST', { nom: 'À faire' })).carte.checklists[0];
  await ok(`/cm/checklists/${k.id}`, s.cm123456, 'PATCH', { nom: 'À faire avant jeudi' });
  const el = (await ok(`/cm/checklists/${k.id}/elements`, s.cm123456, 'POST', { texte: 'Monter la vidéo' })).carte.checklists[0].elements[0];
  await ok(`/cm/elements/${el.id}`, s.cm123456, 'PATCH', { fait: true, texte: 'Monter la vidéo (v2)' });
  assert.deepEqual(await b.base.premier('SELECT texte, fait FROM cm_checklist_elements WHERE id = ?', [el.id]), { texte: 'Monter la vidéo (v2)', fait: 1 });
  assert.equal((await b.base.premier('SELECT nom FROM cm_checklists WHERE id = ?', [k.id])).nom, 'À faire avant jeudi');
  const com = (await ok(`/cm/cartes/${id}/commentaires`, s.cm123456, 'POST', { texte: 'Bien vu @Zed' })).carte.commentaires[0];
  await ok(`/cm/commentaires/${com.id}`, s.cm123456, 'PATCH', { texte: 'Bien vu !' });
  assert.equal((await b.base.premier('SELECT texte FROM cm_commentaires WHERE id = ?', [com.id])).texte, 'Bien vu !');
  const piece = (await ok(`/cm/cartes/${id}/pieces`, s.cm123456, 'POST', { genre: 'lien', url: 'https://site-exemple.fr/affiche', nom: 'Affiche' })).carte.pieces[0];
  assert.equal((await b.base.premier('SELECT url FROM cm_pieces WHERE id = ?', [piece.id])).url, 'https://site-exemple.fr/affiche');
  await ok(`/cm/pieces/${piece.id}`, s.cm123456, 'DELETE');
  assert.ok((await b.base.premier('SELECT supprime_le FROM cm_pieces WHERE id = ?', [piece.id])).supprime_le);
  await ok(`/cm/elements/${el.id}`, s.cm123456, 'DELETE');
  await ok(`/cm/checklists/${k.id}`, s.cm123456, 'DELETE');
  assert.equal((await b.base.tous('SELECT id FROM cm_checklists WHERE carte_id = ?', [id])).length, 0);
  await ok(`/cm/commentaires/${com.id}`, s.cm123456, 'DELETE');
  await ok(`/cm/cartes/${id}/deplacer`, s.cm123456, 'POST', { listeId: L.preparation, index: 0 });
  assert.equal((await ligne()).liste_id, L.preparation);
  // Chaque écriture augmente la version de la carte et celle du tableau (les autres écrans se rechargent).
  assert.ok(Number((await ligne()).version) > 10);
  const fiche = await ok(`/cm/cartes/${id}`, s.cm123456);
  assert.deepEqual([fiche.carte.titre, fiche.carte.etiquettes, fiche.carte.membres, fiche.carte.commentaires.length, fiche.carte.pieces.length], ['Titre modifié', [etiquette.id], ['cm123456'], 0, 0]);
});

test('permissions : cm.voir seul ne modifie rien (403, rien en base) ; sans accès : 404', async () => {
  const { b, s, api, ecrire, ok, club, L } = await preparer();
  const { carte } = await ok(`/cm/tableaux/${club.id}/cartes`, s.cm123456, 'POST', { listeId: L.idees, titre: 'Carte' });
  assert.equal((await api(`/cm/cartes/${carte.id}`, s.vue12345)).corps.droits.modifier, false);
  for (const [chemin, methode, corps] of [
    [`/cm/cartes/${carte.id}`, 'PATCH', { titre: 'Piraté' }],
    [`/cm/cartes/${carte.id}`, 'PATCH', { etiquettes: [] }],
    [`/cm/cartes/${carte.id}/checklists`, 'POST', { nom: 'x' }],
    [`/cm/cartes/${carte.id}/deplacer`, 'POST', { listeId: L.valide, index: 0 }],
    [`/cm/cartes/${carte.id}/pieces`, 'POST', { genre: 'lien', url: 'https://site-exemple.fr/x' }],
    [`/cm/tableaux/${club.id}`, 'PATCH', { fond: { genre: 'couleur', cle: 'vert' } }],
  ]) {
    const r = await ecrire(chemin, s.vue12345, methode, corps);
    assert.equal(r.statut, 403, `${methode} ${chemin} : ${JSON.stringify(r.corps)}`);
  }
  assert.equal((await b.base.premier('SELECT titre, liste_id FROM cm_cartes WHERE id = ?', [carte.id])).titre, 'Carte');
  assert.equal((await ecrire(`/cm/cartes/${carte.id}`, s.lea12345, 'PATCH', { titre: 'x' })).statut, 404, 'joueur sans accès au tableau du club');
});

test('cartes importées de Trello : chaque modification passe, même avec un membre qui a perdu l’accès', async () => {
  const { b, s, ok } = await preparer();
  await ok('/cm/affectations', s.fondateur, 'POST', { compte: 'red12345', roleId: 'cm-role-responsable', portee: 'club' });
  const imp = await ok('/cm/import/trello', s.cm123456, 'POST', { trello: TRELLO, correspondances: { [TRELLO.members[0].id]: 'red12345' } });
  const tb = await ok(`/cm/tableaux/${imp.tableauId}`, s.cm123456);
  const annonce = tb.cartes.find(c => c.titre === 'Annonce du tournoi d’automne');
  assert.deepEqual(annonce.membres, ['red12345']);
  // Remi perd son rôle CM : il reste assigné à la carte importée, mais n'a plus accès au tableau.
  const aff = (await ok('/cm/affectations', s.fondateur)).affectations.find(a => a.compte === 'red12345');
  await ok(`/cm/affectations/${aff.id}`, s.fondateur, 'DELETE');
  // Ajouter quelqu'un d'autre ne doit pas échouer à cause de lui ; ajouter un compte sans accès, si.
  const fiche = await ok(`/cm/cartes/${annonce.id}`, s.cm123456, 'PATCH', { membres: ['red12345', 'cm123456'] });
  assert.deepEqual(fiche.carte.membres.sort(), ['cm123456', 'red12345']);
  assert.equal((await b.appel(`/cm/cartes/${annonce.id}`, { methode: 'POST', jeton: s.cm123456, corps: { membres: ['red12345', 'cm123456', 'lea12345'] }, entetes: { 'X-Methode': 'PATCH' } })).corps.code, 'membre');
  for (const c of tb.cartes) {
    const d = (await ok(`/cm/cartes/${c.id}`, s.cm123456)).carte;
    const r = await ok(`/cm/cartes/${c.id}`, s.cm123456, 'PATCH', { titre: `${c.titre} (app)`, description: `${d.description}\n\nRetouché dans l’app`, etiquettes: d.etiquettes.slice(1), echeance: '2026-11-30 12:00' });
    assert.equal(r.carte.titre, `${c.titre} (app)`);
    assert.match((await b.base.premier('SELECT description FROM cm_cartes WHERE id = ?', [c.id])).description, /Retouché dans l’app$/);
    if (d.checklists[0]?.elements[0]) await ok(`/cm/elements/${d.checklists[0].elements[0].id}`, s.cm123456, 'PATCH', { fait: !d.checklists[0].elements[0].fait });
    await ok(`/cm/cartes/${c.id}/commentaires`, s.cm123456, 'POST', { texte: 'Repris' });
  }
});

test('post : version attendue (409), validé puis modifié → « à valider » ; carte de suggestion modifiable (plus suivie)', async () => {
  const { b, s, api, ecrire, ok, club, L } = await preparer();
  const { carte } = await ok(`/cm/tableaux/${club.id}/cartes`, s.cm123456, 'POST', { listeId: L.idees, titre: 'Post', post: true, reseaux: ['x'] });
  let c = (await ok(`/cm/cartes/${carte.id}`, s.cm123456, 'PATCH', { textes: { x: { fr: 'Bonjour', en: 'Hello' } }, versionAttendue: carte.version })).carte;
  const conflit = await ecrire(`/cm/cartes/${carte.id}`, s.cm123456, 'PATCH', { textes: { x: { fr: 'Autre', en: 'Other' } }, versionAttendue: carte.version });
  assert.deepEqual([conflit.statut, conflit.corps.code], [409, 'modifiee-entre-temps']);
  c = (await ok(`/cm/cartes/${carte.id}/soumettre`, s.cm123456, 'POST', {})).carte;
  c = (await ok(`/cm/cartes/${carte.id}/valider`, s.cm123456, 'POST', { versionAttendue: c.version })).carte;
  assert.equal(c.statut, 'valide');
  // Étiquette, checklist : le post reste validé.
  await ok(`/cm/cartes/${carte.id}/checklists`, s.cm123456, 'POST', { nom: 'Relire' });
  assert.equal((await b.base.premier('SELECT statut FROM cm_cartes WHERE id = ?', [carte.id])).statut, 'valide');
  c = (await ok(`/cm/cartes/${carte.id}`, s.cm123456, 'PATCH', { textes: { x: { fr: 'Bonjour à tous', en: 'Hello all' } }, versionAttendue: (await api(`/cm/cartes/${carte.id}`, s.cm123456)).corps.carte.version })).carte;
  assert.deepEqual([c.statut, c.listeId, c.textes.x.fr], ['a_valider', L.a_valider, 'Bonjour à tous']);
  const ligne = await b.base.premier('SELECT statut, empreinte_validee, valide_par FROM cm_cartes WHERE id = ?', [carte.id]);
  assert.deepEqual(ligne, { statut: 'a_valider', empreinte_validee: null, valide_par: null });

  // Carte de suggestion (posée par le bus) : modifiable comme une autre, et n'est plus suivie ensuite (auto = 0).
  const sug = await ok(`/cm/tableaux/${club.id}/cartes`, s.cm123456, 'POST', { listeId: L.idees, titre: 'Annonce : Coupe', post: true });
  await b.base.executer("UPDATE cm_cartes SET origine = 'suggestion', origine_cle = 'tournoi:x', auto = 1 WHERE id = ?", [sug.carte.id]);
  const r = await ok(`/cm/cartes/${sug.carte.id}`, s.cm123456, 'PATCH', { titre: 'Annonce : Coupe d’automne', textes: { x: { fr: 'On y va', en: 'Here we go' } }, versionAttendue: sug.carte.version });
  assert.equal(r.carte.origine, 'suggestion');
  assert.equal(Number((await b.base.premier('SELECT auto FROM cm_cartes WHERE id = ?', [sug.carte.id])).auto), 0);
});

test('fond du tableau : teintes et dégradés (cm.editer), image envoyée (lien signé, jamais de SVG), retour au thème', async () => {
  const { b, s, api, ecrire, ok, club } = await preparer();
  const t1 = await ok(`/cm/tableaux/${club.id}`, s.cm123456, 'PATCH', { fond: { genre: 'degrade', cle: 'ocean' } });
  assert.deepEqual(t1.tableau.fond, { genre: 'degrade', cle: 'ocean' });
  assert.deepEqual((await ok('/cm/tableaux', s.cm123456)).tableaux.find(t => t.id === club.id).fond, { genre: 'degrade', cle: 'ocean' });
  for (const fond of [{ genre: 'couleur', cle: 'fuchsia' }, { genre: 'degrade' }, { genre: 'image' }, 'bleu', [1]]) {
    const r = await ecrire(`/cm/tableaux/${club.id}`, s.cm123456, 'PATCH', { fond });
    assert.equal(r.statut, 400, JSON.stringify(fond));
  }
  // Un rédacteur (cm.editer sans cm.gerer) change le fond, pas le nom.
  const redacteur = await ok('/cm/roles', s.fondateur, 'POST', { nom: 'Rédacteur', couleur: '#654321', permissions: ['cm.voir', 'cm.editer'] });
  await ok('/cm/affectations', s.fondateur, 'POST', { compte: 'red12345', roleId: redacteur.id ?? redacteur.role?.id, portee: 'club' });
  await ok(`/cm/tableaux/${club.id}`, s.red12345, 'PATCH', { fond: { genre: 'couleur', cle: 'vert' } });
  assert.equal((await ecrire(`/cm/tableaux/${club.id}`, s.red12345, 'PATCH', { fond: null, nom: 'Autre' })).statut, 403);

  // Image : envoi par morceaux dans la portée du tableau, puis lien signé dans la réponse du tableau.
  const png = new Uint8Array(200);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const env = await ok('/cm/portees/club/envois', s.cm123456, 'POST', { nom: 'fond.png', taille: png.length });
  await morceau(b, s.cm123456, `/cm/portees/club/envois/${env.id}`, 0, png);
  await ok(`/cm/portees/club/envois/${env.id}/fin`, s.cm123456, 'POST', { sha256: sha(png) });
  const t2 = await ok(`/cm/tableaux/${club.id}`, s.cm123456, 'PATCH', { fond: { genre: 'image', envoi: env.id } });
  assert.equal(t2.tableau.fond.genre, 'image');
  assert.match(t2.tableau.fond.image, /\/cm\/fichiers\/[0-9a-f-]{36}\?/);
  const fichierId = (await b.base.premier('SELECT fond_fichier_id FROM cm_tableaux WHERE id = ?', [club.id])).fond_fichier_id;
  // Le lecteur (cm.voir) lit l'image ; le joueur sans accès n'a pas de lien.
  const vu = (await ok(`/cm/tableaux/${club.id}`, s.vue12345)).tableau.fond.image;
  const lien = await b.brut(vu.startsWith('http') ? vu : `https://esport.test${vu}`);
  assert.equal(lien.status, 200);
  assert.equal((await api(`/cm/tableaux/${club.id}`, s.lea12345)).statut, 404);
  // Texte déguisé en image (SVG, HTML) : refusé.
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  const env2 = await ok('/cm/portees/club/envois', s.cm123456, 'POST', { nom: 'fond.svg', taille: svg.length });
  const m2 = await morceau(b, s.cm123456, `/cm/portees/club/envois/${env2.id}`, 0, svg);
  if (m2.statut === 200 && (await api(`/cm/portees/club/envois/${env2.id}/fin`, s.cm123456, { methode: 'POST', corps: { sha256: sha(svg) } })).statut === 200) {
    assert.equal((await ecrire(`/cm/tableaux/${club.id}`, s.cm123456, 'PATCH', { fond: { genre: 'image', envoi: env2.id } })).statut, 400);
  }
  // Retour au thème : l'image ne sert plus à rien, ses octets partent.
  const t3 = await ok(`/cm/tableaux/${club.id}`, s.cm123456, 'PATCH', { fond: null });
  assert.equal(t3.tableau.fond, null);
  assert.ok((await b.base.premier('SELECT supprime_le FROM cm_fichiers WHERE id = ?', [fichierId])).supprime_le);
});

test('préférences d’affichage : par compte, validées, effacées avec le compte', async () => {
  const { s, api, ecrire, ok, club } = await preparer();
  const cle = `tableau.${club.id}.reduites`;
  await ok(`/cm/preferences/${cle}`, s.cm123456, 'PUT', { valeur: [club.id] });
  await ok('/cm/preferences/calendrier.teams', s.cm123456, 'PUT', { valeur: { [club.id]: false } });
  assert.deepEqual((await ok('/cm/preferences', s.cm123456)).preferences, { [cle]: [club.id], 'calendrier.teams': { [club.id]: false } });
  assert.deepEqual((await ok('/cm/preferences', s.vue12345)).preferences, {}, 'chacun les siennes');
  for (const [k, valeur] of [['autre', 1], [cle, ['pas-un-id']], ['calendrier.teams', { x: true }], ['calendrier.teams', 'oui']]) assert.equal((await ecrire(`/cm/preferences/${k}`, s.cm123456, 'PUT', { valeur })).statut, 400, k);
  assert.equal((await ecrire(`/cm/preferences/${cle}`, s.lea12345, 'PUT', { valeur: [] })).statut, 403, 'sans section CM');
  await ok(`/cm/preferences/${cle}`, s.cm123456, 'PUT', { valeur: null });
  assert.deepEqual(Object.keys((await api('/cm/preferences', s.cm123456)).corps.preferences), ['calendrier.teams']);
});

test('calendriers des teams : planning pour un membre, compétition publiable seulement pour le CM du club, rien sans cm.voir', async () => {
  const { b, A, s, api, ok } = await preparer();
  const B = await teamAvecMembres(b, { nom: 'Team Bravo', membres: { nox12345: { pseudo: 'Nox', role: 'coach' } } });
  // Planning de la team A : un scrim (privé), un entraînement (jamais affiché), un événement.
  const planning = corps => ok(`/teams/${A.teamId}/planning`, s.coach123, 'POST', corps);
  await planning({ type: 'scrim', titre: 'Scrim contre Nova', date: '2026-10-22', heureDebut: '20:00', heureFin: '22:00', lieu: 'Serveur privé', convocation: { groupes: ['joueurs'] } });
  await planning({ type: 'training', titre: 'Entraînement', date: '2026-10-23', heureDebut: '20:00', heureFin: '22:00', convocation: { groupes: ['joueurs'] } });
  await planning({ type: 'other', titre: 'Soirée fans', date: '2026-10-24', heureDebut: '18:00', heureFin: '19:00', convocation: { groupes: ['joueurs'] } });
  // Tournoi publiable avec un match (passé au planning), et un tournoi non publiable.
  const nova = (await ok(`/teams/${A.teamId}/scouting/adversaires`, s.coach123, 'POST', { nom: 'Nova' })).id;
  const tournoi = (await ok(`/teams/${A.teamId}/tournois`, s.coach123, 'POST', { nom: 'Coupe d’automne', debut: '2026-10-25', fin: '2026-10-26', bo: 1 })).tournoi;
  await ok(`/teams/${A.teamId}/tournois/${tournoi.id}`, s.coach123, 'PATCH', { publiable: true });
  const match = (await ok(`/teams/${A.teamId}/tournois/${tournoi.id}/matchs`, s.coach123, 'POST', { tour: 'Quart de finale', date: '2026-10-25', heure: '20:00', adversaires: [{ id: nova }] })).match;
  const secret = (await ok(`/teams/${A.teamId}/tournois`, s.coach123, 'POST', { nom: 'Ligue privée', debut: '2026-10-27' })).tournoi;
  await ok(`/teams/${A.teamId}/tournois/${secret.id}`, s.coach123, 'PATCH', { publiable: false });
  const periode = '/cm/calendrier/teams?du=2026-10-19&au=2026-11-01';

  // Le Fondateur (accès au planning de toutes les teams) : planning de A (sans l'entraînement), B présente.
  const f = await ok(periode, s.fondateur);
  const fa = f.teams.find(t => t.id === A.teamId);
  assert.equal(fa.acces, 'planning');
  assert.ok(f.teams.some(t => t.id === B.teamId));
  const titres = fa.evenements.map(e => e.titre);
  assert.ok(titres.includes('Scrim contre Nova') && titres.includes('Soirée fans'), JSON.stringify(titres));
  assert.ok(!titres.includes('Entraînement'), 'pas les entraînements');
  const deMatch = fa.evenements.find(e => e.matchId === (match?.id ?? e.matchId) && e.matchId);
  assert.ok(deMatch, 'le match du tournoi est relié (créer un post pré-rempli)');
  assert.equal(deMatch.publiable, true);
  assert.notEqual(f.teams[0].couleur, f.teams[1].couleur);

  // Le CM du club (membre d'aucune team) : seulement la compétition publiable de A (module CM activé), pas B.
  await ok(`/teams/${B.teamId}/modules`, s.fondateur, 'PUT', { modules: { cm: false } });
  const c = await ok(periode, s.cm123456);
  // + le planning de le CM du club, dont il est membre (migration 0068).
  assert.deepEqual(c.teams.map(t => [t.id, t.acces]), [['00000000-0000-4000-8000-00000000c0de', 'planning'], [A.teamId, 'competition']]);
  const vus = c.teams.find(t => t.id === A.teamId).evenements;
  assert.deepEqual(vus.map(e => e.genre).sort(), ['match', 'tournoi']);
  const texte = JSON.stringify(vus);
  for (const interdit of ['Scrim', 'Soirée fans', 'Serveur privé', 'Ligue privée', 'Entraînement']) assert.ok(!texte.includes(interdit), interdit);
  assert.ok(texte.includes('Coupe d’automne'));

  // Un joueur (pas de section CM) : 403 ; période invalide : 400.
  assert.equal((await api(periode, s.lea12345)).statut, 403);
  assert.equal((await api('/cm/calendrier/teams?du=2026-01-01&au=2026-12-31', s.cm123456)).statut, 400);
  assert.equal((await api('/cm/calendrier/teams?du=hier', s.cm123456)).statut, 400);
});
