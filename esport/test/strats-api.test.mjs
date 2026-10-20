/**
 * Strats (phase 6), par l'API : droits par rôle, module désactivé, isolation
 * entre teams, enregistrement versionné (verrou optimiste, historique),
 * miniature stockée et lien signé, duplication, visibilité privée, lien de
 * lecture seule (page publique, révocation, expiration), journal et bus.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { ASCENT, docExemple, jpegDataUrl } from './strats-aide.mjs';

const MEMBRES = {
  coach123: { pseudo: 'Coach Zed', role: 'coach' },
  ana12345: { pseudo: 'Ana', role: 'analyste' },
  lea12345: { pseudo: 'Léa', role: 'joueur' },
  tom12345: { pseudo: 'Tom', role: 'remplacant' },
};

async function preparer(options = {}) {
  const b = await banc(options);
  const team = await teamAvecMembres(b, { membres: MEMBRES });
  const url = `/teams/${team.teamId}/strats`;
  const creer = (jeton, corps = {}) => b.appel(url, { methode: 'POST', jeton, corps: { titre: 'Exec A', type: 'execute', carte: ASCENT, side: 'attaque', ...corps } });
  return { b, ...team, url, creer };
}

test('création, lecture et droits : Coach et Analyste créent, Joueur lit, Remplaçant ne voit rien', async () => {
  const { b, sessions, url, creer } = await preparer();
  const r = await creer(sessions.coach123, { tags: ['A', 'rapide', 'a'] });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.revision, 1);
  assert.equal(r.corps.donnees.version, 2);
  assert.equal(r.corps.donnees.carte.cle, 'ascent');
  assert.deepEqual(r.corps.tags, ['A', 'rapide'], 'tags sans doublon (casse ignorée)');
  assert.equal(r.corps.creePar.pseudo, 'Coach Zed');
  assert.equal((await creer(sessions.ana12345, { titre: 'Retake B', carte: { cle: 'bind', nom: 'Bind' }, side: 'defense', type: 'retake' })).statut, 200);
  assert.equal((await creer(sessions.lea12345)).statut, 403, 'le Joueur ne crée pas');
  const liste = await b.appel(url, { jeton: sessions.lea12345 });
  assert.equal(liste.statut, 200);
  assert.equal(liste.corps.strats.length, 2);
  assert.equal(liste.corps.strats[0].donnees, undefined, 'la liste ne renvoie pas les documents');
  assert.equal((await b.appel(`${url}/${r.corps.id}`, { jeton: sessions.lea12345 })).corps.donnees.etapes.length, 1);
  assert.equal((await b.appel(`${url}/${r.corps.id}`, { methode: 'PUT', jeton: sessions.lea12345, corps: { revision: 1, donnees: docExemple() } })).statut, 403);
  assert.equal((await b.appel(url, { jeton: sessions.tom12345 })).statut, 403, 'Remplaçant : pas strats.view');
  // Filtres de la liste.
  const titres = async q => (await b.appel(`${url}${q}`, { jeton: sessions.lea12345 })).corps.strats.map(s => s.titre);
  assert.deepEqual(await titres('?carte=bind'), ['Retake B']);
  assert.deepEqual(await titres('?side=attaque&type=execute'), ['Exec A']);
  assert.deepEqual(await titres('?tag=RAPIDE'), ['Exec A']);
  assert.deepEqual(await titres('?q=retake'), ['Retake B']);
  // Valeurs refusées.
  assert.equal((await creer(sessions.coach123, { type: 'rush' })).statut, 400);
  assert.equal((await creer(sessions.coach123, { side: 'centre' })).statut, 400);
  assert.equal((await creer(sessions.coach123, { titre: 'x' })).statut, 400);
  assert.equal((await creer(sessions.coach123, { carte: { cle: '../x', nom: 'X' } })).statut, 400);
});

test('enregistrement versionné : révisions, conflit (409), historique, document validé, taille max', async () => {
  const { b, sessions, url, creer } = await preparer();
  const id = (await creer(sessions.coach123)).corps.id;
  const doc = docExemple();
  let r = await b.appel(`${url}/${id}`, { methode: 'PUT', jeton: sessions.ana12345, corps: { revision: 1, donnees: doc, notes: 'Smoke A main' } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.revision, 2);
  assert.equal(r.corps.notes, 'Smoke A main');
  assert.equal(r.corps.donnees.etapes[0].objets.length, 4);
  assert.equal(r.corps.majPar.pseudo, 'Ana');
  // Enregistrement fondé sur une révision dépassée : refusé, avec la révision courante.
  r = await b.appel(`${url}/${id}`, { methode: 'PUT', jeton: sessions.coach123, corps: { revision: 1, donnees: doc } });
  assert.equal(r.statut, 409);
  assert.equal(r.corps.code, 'conflit');
  assert.equal(r.corps.details.revision, 2);
  assert.equal((await b.appel(`${url}/${id}`, { methode: 'PUT', jeton: sessions.coach123, corps: { donnees: doc } })).statut, 400, 'révision obligatoire');
  // Document invalide ou trop gros.
  r = await b.appel(`${url}/${id}`, { methode: 'PUT', jeton: sessions.coach123, corps: { revision: 2, donnees: { ...doc, side: 'milieu' } } });
  assert.equal(r.statut, 400);
  assert.equal(r.corps.code, 'strat-invalide');
  const gros = docExemple();
  gros.etapes[0].note = 'x'.repeat(300 * 1024);
  r = await b.appel(`${url}/${id}`, { methode: 'PUT', jeton: sessions.coach123, corps: { revision: 2, donnees: gros } });
  assert.equal(r.statut, 413);
  // Historique et lecture d'une version.
  const doc3 = docExemple();
  doc3.etapes.push({ id: 'e2', titre: 'Plant', note: '', objets: [] });
  doc3.side = 'defense';
  assert.equal((await b.appel(`${url}/${id}`, { methode: 'PUT', jeton: sessions.coach123, corps: { revision: 2, donnees: doc3 } })).corps.side, 'defense', 'side recopié du document');
  const versions = (await b.appel(`${url}/${id}/versions`, { jeton: sessions.lea12345 })).corps.versions;
  assert.deepEqual(versions.map(v => v.revision), [3, 2, 1]);
  const v2 = await b.appel(`${url}/${id}/versions/2`, { jeton: sessions.lea12345 });
  assert.equal(v2.corps.donnees.etapes.length, 1);
  assert.equal((await b.appel(`${url}/${id}/versions/9`, { jeton: sessions.lea12345 })).statut, 404);
  // Métadonnées seules (PATCH) : nouvelle révision, document inchangé.
  r = await b.appel(`${url}/${id}`, { methode: 'PATCH', jeton: sessions.coach123, corps: { titre: 'Exec A (v2)', tags: ['A'] } });
  assert.equal(r.corps.titre, 'Exec A (v2)');
  assert.equal(r.corps.donnees.etapes.length, 2);
  const journal = (await b.appel(`/teams/${(await b.appel('/teams', { jeton: sessions.fondateur })).corps.teams[0].id}/journal`, { jeton: sessions.fondateur })).corps.entrees.map(e => e.action);
  assert.ok(journal.includes('strat.created') && journal.includes('strat.updated'));
});

test('miniature : stockée (R2 via l’interface), lien signé lisible, remplacée, refusée si ce n’est pas une image', async () => {
  const { b, sessions, url, creer } = await preparer();
  const id = (await creer(sessions.coach123)).corps.id;
  let r = await b.appel(`${url}/${id}`, { methode: 'PUT', jeton: sessions.coach123, corps: { revision: 1, donnees: docExemple(), miniature: jpegDataUrl() } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.ok(r.corps.miniature.url.startsWith('https://esport.test/fichiers/'));
  assert.equal(b.stockage.taille(), 1);
  const image = await b.brut(r.corps.miniature.url);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('Content-Type'), 'image/jpeg');
  // Remplacement : l'ancienne image est effacée du stockage.
  r = await b.appel(`${url}/${id}`, { methode: 'PUT', jeton: sessions.coach123, corps: { revision: 2, miniature: jpegDataUrl(80) } });
  assert.equal(r.statut, 200);
  assert.equal(b.stockage.taille(), 1);
  // Pas une image, ou trop grosse.
  r = await b.appel(`${url}/${id}`, { methode: 'PUT', jeton: sessions.coach123, corps: { revision: 3, miniature: `data:image/jpeg;base64,${Buffer.from('%PDF-1.4 faux').toString('base64')}` } });
  assert.equal(r.statut, 415);
  r = await b.appel(`${url}/${id}`, { methode: 'PUT', jeton: sessions.coach123, corps: { revision: 3, miniature: 'https://exemple.com/x.png' } });
  assert.equal(r.statut, 400);
  r = await b.appel(`${url}/${id}`, { methode: 'PUT', jeton: sessions.coach123, corps: { revision: 3, miniature: jpegDataUrl(300 * 1024) } });
  assert.equal(r.statut, 413);
});

test('sans stockage branché : la strat s’enregistre, sans miniature (avertissement)', async () => {
  const { b, sessions, url, creer } = await preparer({ sansStockage: true });
  const id = (await creer(sessions.coach123)).corps.id;
  const r = await b.appel(`${url}/${id}`, { methode: 'PUT', jeton: sessions.coach123, corps: { revision: 1, donnees: docExemple(), miniature: jpegDataUrl() } });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.miniature, null);
  assert.equal(r.corps.avertissement, 'miniature-non-stockee');
});

test('duplication, suppression (auteur ou staff), strat privée invisible du reste de la team', async () => {
  const { b, sessions, url, creer } = await preparer();
  const id = (await creer(sessions.ana12345)).corps.id;
  await b.appel(`${url}/${id}`, { methode: 'PUT', jeton: sessions.ana12345, corps: { revision: 1, donnees: docExemple(), miniature: jpegDataUrl() } });
  const copie = await b.appel(`${url}/${id}/dupliquer`, { methode: 'POST', jeton: sessions.coach123, corps: {} });
  assert.equal(copie.statut, 200);
  assert.equal(copie.corps.titre, 'Exec A (copie)');
  assert.equal(copie.corps.origine, id);
  assert.equal(copie.corps.revision, 1);
  assert.equal(copie.corps.donnees.etapes[0].objets.length, 4);
  assert.ok(copie.corps.miniature, 'miniature recopiée');
  assert.equal((await b.appel(`${url}/${id}/dupliquer`, { methode: 'POST', jeton: sessions.lea12345, corps: {} })).statut, 403);
  // Suppression : l'Analyste (sans strats.delete) supprime la sienne, pas celle du Coach.
  assert.equal((await b.appel(`${url}/${copie.corps.id}`, { methode: 'DELETE', jeton: sessions.ana12345 })).statut, 403);
  assert.equal((await b.appel(`${url}/${id}`, { methode: 'DELETE', jeton: sessions.ana12345 })).statut, 200);
  assert.equal((await b.appel(`${url}/${id}`, { jeton: sessions.coach123 })).statut, 404);
  // Privée : visible de l'auteur et du staff (strats.delete), pas du Joueur.
  const privee = (await creer(sessions.ana12345, { titre: 'Brouillon perso', visibilite: 'privee' })).corps;
  assert.equal(privee.visibilite, 'privee');
  assert.equal((await b.appel(`${url}/${privee.id}`, { jeton: sessions.lea12345 })).statut, 404);
  assert.ok(!(await b.appel(url, { jeton: sessions.lea12345 })).corps.strats.some(s => s.id === privee.id));
  assert.equal((await b.appel(`${url}/${privee.id}`, { jeton: sessions.coach123 })).statut, 200);
  // Partage interne : l'auteur la rend visible à la team.
  assert.equal((await b.appel(`${url}/${privee.id}`, { methode: 'PATCH', jeton: sessions.ana12345, corps: { visibilite: 'team' } })).corps.visibilite, 'team');
  assert.equal((await b.appel(`${url}/${privee.id}`, { jeton: sessions.lea12345 })).statut, 200);
});

test('lien de lecture seule : page publique sans session, CSP stricte, puis révoqué → 404', async () => {
  const { b, sessions, url, creer } = await preparer();
  const id = (await creer(sessions.coach123)).corps.id;
  await b.appel(`${url}/${id}`, { methode: 'PUT', jeton: sessions.coach123, corps: { revision: 1, donnees: docExemple() } });
  assert.equal((await b.appel(`${url}/${id}/partages`, { methode: 'POST', jeton: sessions.lea12345, corps: {} })).statut, 403, 'le Joueur ne partage pas');
  const lien = await b.appel(`${url}/${id}/partages`, { methode: 'POST', jeton: sessions.coach123, corps: { libelle: 'Pour le sub' } });
  assert.equal(lien.statut, 200, JSON.stringify(lien.corps));
  assert.match(lien.corps.jeton, /^sp1\.[0-9a-f]{32}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(lien.corps.url, `https://esport.test/partage/strats/${lien.corps.jeton}`);
  let page = await b.brut(lien.corps.url);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('Content-Type'), /text\/html/);
  assert.match(page.headers.get('Content-Security-Policy'), /default-src 'none'; img-src https:\/\/media\.valorant-api\.com/);
  const html = await page.text();
  assert.ok(html.includes('Exec A') && html.includes('<svg') && html.includes('Legal Jibber Jabber'));
  const json = await b.appel(`/partage/strats/${lien.corps.jeton}?format=json`);
  assert.equal(json.corps.lectureSeule, true);
  assert.equal(json.corps.donnees.etapes[0].objets.length, 4);
  // Jeton falsifié (signature) : 404.
  const faux = lien.corps.jeton.slice(0, -2) + (lien.corps.jeton.endsWith('AA') ? 'BB' : 'AA');
  assert.equal((await b.brut(`https://esport.test/partage/strats/${faux}`)).status, 404);
  // Liste des liens, puis révocation.
  const liste = (await b.appel(`${url}/${id}/partages`, { jeton: sessions.ana12345 })).corps.partages;
  assert.equal(liste.length, 1);
  assert.equal(liste[0].jeton, undefined, 'le jeton n’est montré qu’une fois');
  assert.ok(liste[0].dernierAcces);
  assert.equal((await b.appel(`${url}/${id}/partages/${liste[0].id}`, { methode: 'DELETE', jeton: sessions.ana12345 })).statut, 200);
  page = await b.brut(lien.corps.url);
  assert.equal(page.status, 404, 'lien révoqué');
  assert.equal((await b.appel(`${url}/${id}/partages`, { jeton: sessions.coach123 })).corps.partages[0].revoque, true);
  // Expiration, et suppression de la strat (révoque tout).
  const court = (await b.appel(`${url}/${id}/partages`, { methode: 'POST', jeton: sessions.coach123, corps: { jours: 1 } })).corps;
  assert.ok(court.url, JSON.stringify(court));
  assert.equal((await b.brut(court.url)).status, 200);
  b.horloge.t += 2 * 86_400_000;
  assert.equal((await b.brut(court.url)).status, 404, 'lien expiré');
  const coach = await b.session('coach123'); // la session d'une heure a expiré
  const autre = (await b.appel(`${url}/${id}/partages`, { methode: 'POST', jeton: coach, corps: {} })).corps;
  await b.appel(`${url}/${id}`, { methode: 'DELETE', jeton: coach });
  assert.equal((await b.brut(autre.url)).status, 404, 'strat supprimée');
  const fondateur = await b.session('principal');
  const journal = (await b.appel(`/teams/${(await b.appel('/teams', { jeton: fondateur })).corps.teams[0].id}/journal?action=strat`, { jeton: fondateur })).corps.entrees.map(e => e.action);
  assert.ok(journal.includes('strat.share_created') && journal.includes('strat.share_revoked'));
});

test('module désactivé : 404 partout, y compris le lien public ; isolation entre teams', async () => {
  const { b, sessions, url, creer, teamId } = await preparer();
  const id = (await creer(sessions.coach123)).corps.id;
  const lien = (await b.appel(`${url}/${id}/partages`, { methode: 'POST', jeton: sessions.coach123, corps: {} })).corps;
  await b.appel(`/teams/${teamId}/modules`, { methode: 'PUT', jeton: sessions.fondateur, corps: { modules: { strat_editor: false } } });
  const r = await b.appel(url, { jeton: sessions.coach123 });
  assert.equal(r.statut, 404);
  assert.equal(r.corps.code, 'module-desactive');
  assert.equal((await b.brut(lien.url)).status, 404);
  await b.appel(`/teams/${teamId}/modules`, { methode: 'PUT', jeton: sessions.fondateur, corps: { modules: { strat_editor: true } } });
  assert.equal((await b.brut(lien.url)).status, 200, 'réactivé : le lien remarche');

  // Team B : rien n'est lisible ni modifiable depuis A.
  const B = await teamAvecMembres(b, { nom: 'Team B', membres: { kai12345: { pseudo: 'Kai', role: 'coach' } } });
  const idB = (await b.appel(`/teams/${B.teamId}/strats`, { methode: 'POST', jeton: B.sessions.kai12345, corps: { titre: 'Secret B', carte: ASCENT, side: 'attaque' } })).corps.id;
  const c = sessions.coach123;
  assert.equal((await b.appel(`/teams/${B.teamId}/strats`, { jeton: c })).statut, 404);
  assert.equal((await b.appel(`${url}/${idB}`, { jeton: c })).statut, 404);
  assert.equal((await b.appel(`${url}/${idB}`, { methode: 'PUT', jeton: c, corps: { revision: 1, donnees: docExemple() } })).statut, 404);
  assert.equal((await b.appel(`${url}/${idB}/dupliquer`, { methode: 'POST', jeton: c, corps: {} })).statut, 404);
  assert.equal((await b.appel(`${url}/${idB}/partages`, { methode: 'POST', jeton: c, corps: {} })).statut, 404);
  assert.equal((await b.appel(`${url}/${idB}`, { methode: 'DELETE', jeton: c })).statut, 404);
  assert.equal((await b.appel(`/teams/${teamId}/playbook`, { methode: 'POST', jeton: c, corps: { titre: 'Vol', stratId: idB } })).statut, 400);
  assert.equal((await b.appel(`/teams/${B.teamId}/strats/${idB}`, { jeton: B.sessions.kai12345 })).corps.titre, 'Secret B');
});
