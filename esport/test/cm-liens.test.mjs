/**
 * Liens utiles de DATA › Ressources (migration 0044, docs/esport/cm.md) : validation d'adresse (https, hôte public),
 * CRUD, épinglage et ordre, rattachement à une team, permissions (cm.voir lire, cm.editer écrire, cm.gerer supprimer),
 * liaisons avec des cartes et des dossiers du Drive (visibilité, dossier restreint, suppression en cascade), bus,
 * RGPD, export / import.
 *
 * Tourne sur SQLite (défaut) et sur PostgreSQL (ESPORT_TEST_PG, esport/test/pg/lancer.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { TABLES } from '../noyau/transfert.mjs';
import { validerLien } from '../noyau/cm/liens.mjs';

async function preparer() {
  const b = await banc();
  const A = await teamAvecMembres(b, { membres: { kai12345: { pseudo: 'Kai', role: 'joueur' }, lea12345: { pseudo: 'Léa', role: 'joueur' } } });
  const s = { ...A.sessions };
  s.cm123456 = await b.session('cm123456', 'Clara');
  s.red12345 = await b.session('red12345', 'Rémi');
  s.seul1234 = await b.session('seul1234', 'Seul');
  const api = (chemin, jeton, o = {}) => b.appel(chemin, { jeton, methode: o.methode, corps: o.corps });
  const ok = async (chemin, jeton, o = {}) => {
    const r = await api(chemin, jeton, o);
    assert.equal(r.statut, 200, `${o.methode ?? 'GET'} ${chemin} : ${r.statut} ${JSON.stringify(r.corps)}`);
    return r.corps;
  };
  await ok(`/teams/${A.teamId}/modules`, s.fondateur, { methode: 'PUT', corps: { modules: { cm: true } } });
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'cm123456', roleId: 'cm-role-responsable', portee: 'club' } });
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'kai12345', roleId: 'cm-role-correspondant', portee: A.teamId } });
  const role = await ok('/cm/roles', s.fondateur, { methode: 'POST', corps: { nom: 'Rédacteur', permissions: ['cm.voir', 'cm.editer'] } });
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'red12345', roleId: role.id, portee: 'club' } });
  return { b, A, s, api, ok };
}

test('validerLien : https seulement, hôte public, sans identifiants, adresse normalisée', () => {
  assert.deepEqual(validerLien(' https://www.Exemple.fr/page?q=1 '), { url: 'https://www.exemple.fr/page?q=1', hote: 'exemple.fr' });
  for (const mauvais of ['http://exemple.fr', 'javascript:alert(1)', 'ftp://exemple.fr', 'https://localhost/', 'https://127.0.0.1/', 'https://intranet/', 'https://user:mdp@exemple.fr/', 'exemple.fr', '', null, `https://exemple.fr/${'a'.repeat(2100)}`]) {
    assert.throws(() => validerLien(mauvais), e => e.statut === 400 && e.code === 'url', String(mauvais));
  }
});

test('liens : CRUD, épinglage, ordre, rattachement à une team et permissions', async () => {
  const { A, s, api, ok } = await preparer();
  // Lecture : cm.voir (club ou team) ; sans droit CM, 403.
  assert.deepEqual((await ok('/cm/liens', s.cm123456)).liens, []);
  assert.equal((await api('/cm/liens', s.seul1234)).statut, 403);
  assert.equal((await api('/cm/liens', s.lea12345)).statut, 403);
  // Validation côté serveur.
  const mauvais = await api('/cm/liens', s.cm123456, { methode: 'POST', corps: { titre: 'X', url: 'http://exemple.fr' } });
  assert.equal(mauvais.statut, 400);
  assert.equal(mauvais.corps.code, 'url');
  assert.equal((await api('/cm/liens', s.cm123456, { methode: 'POST', corps: { titre: '  ', url: 'https://exemple.fr' } })).corps.code, 'titre');
  assert.equal((await api('/cm/liens', s.cm123456, { methode: 'POST', corps: { titre: 'X', url: 'https://exemple.fr', teamId: '00000000-0000-4000-8000-000000000000' } })).statut, 404);
  // Création : domaine d'aperçu, étiquette, description.
  const a = (await ok('/cm/liens', s.cm123456, { methode: 'POST', corps: { titre: 'Charte graphique', url: 'https://www.canva.com/charte', description: 'La charte du club', categorie: 'Design' } })).lien;
  assert.equal(a.hote, 'canva.com');
  assert.equal(a.categorie, 'Design');
  const b2 = (await ok('/cm/liens', s.red12345, { methode: 'POST', corps: { titre: 'Banque d’images', url: 'https://unsplash.com/', teamId: A.teamId } })).lien;
  assert.equal(b2.team.id, A.teamId);
  const c = (await ok('/cm/liens', s.cm123456, { methode: 'POST', corps: { titre: 'Analytics', url: 'https://analytics.example.org/x', epingle: true } })).lien;
  let liste = await ok('/cm/liens', s.cm123456);
  assert.deepEqual(liste.liens.map(l => l.titre), ['Analytics', 'Charte graphique', 'Banque d’images']);
  assert.deepEqual(liste.categories, ['Design']);
  assert.deepEqual(liste.droits, { editer: true, gerer: true });
  // Modifier, épingler / désépingler.
  await ok(`/cm/liens/${a.id}`, s.red12345, { methode: 'PATCH', corps: { titre: 'Charte 2026', epingle: true, url: 'https://canva.com/charte2' } });
  await ok(`/cm/liens/${c.id}`, s.cm123456, { methode: 'PATCH', corps: { epingle: false, categorie: null } });
  assert.equal((await api(`/cm/liens/${a.id}`, s.cm123456, { methode: 'PATCH', corps: { url: 'http://non-https.fr' } })).statut, 400);
  liste = await ok('/cm/liens', s.cm123456);
  assert.deepEqual(liste.liens.map(l => l.titre), ['Charte 2026', 'Banque d’images', 'Analytics']);
  // Ordre manuel (parmi les non épinglés).
  await ok('/cm/liens/ordre', s.cm123456, { methode: 'PUT', corps: { ids: [c.id, a.id, b2.id] } });
  assert.deepEqual((await ok('/cm/liens', s.cm123456)).liens.map(l => l.titre), ['Charte 2026', 'Analytics', 'Banque d’images']);
  assert.equal((await api('/cm/liens/ordre', s.cm123456, { methode: 'PUT', corps: { ids: [a.id, a.id] } })).statut, 400);
  // Permissions : le correspondant de la team lit sans écrire ; le rédacteur n'efface pas ; le responsable efface.
  assert.equal((await ok('/cm/liens', s.kai12345)).liens.length, 3);
  assert.deepEqual((await ok('/cm/liens', s.kai12345)).droits, { editer: false, gerer: false });
  assert.equal((await api('/cm/liens', s.kai12345, { methode: 'POST', corps: { titre: 'X', url: 'https://exemple.fr' } })).statut, 403);
  assert.equal((await api(`/cm/liens/${a.id}`, s.kai12345, { methode: 'PATCH', corps: { titre: 'Y' } })).statut, 403);
  assert.equal((await api(`/cm/liens/${a.id}`, s.red12345, { methode: 'DELETE' })).statut, 403);
  assert.equal((await api(`/cm/liens/${a.id}`, s.kai12345, { methode: 'DELETE' })).statut, 403);
  await ok(`/cm/liens/${c.id}`, s.cm123456, { methode: 'DELETE' });
  assert.equal((await api(`/cm/liens/${c.id}`, s.cm123456, { methode: 'DELETE' })).statut, 404);
  assert.equal((await ok('/cm/liens', s.cm123456)).liens.length, 2);
  // Journal de la section : création, modification, suppression.
  const actions = (await ok('/cm/journal', s.cm123456)).entrees.map(e => e.action);
  for (const x of ['cm.lien_cree', 'cm.lien_modifie', 'cm.lien_supprime']) assert.ok(actions.includes(x), x);
});

test('liens : liaisons avec des cartes et des dossiers du Drive, visibilité, cascade', async () => {
  const { b, A, s, api, ok } = await preparer();
  const lien = (await ok('/cm/liens', s.cm123456, { methode: 'POST', corps: { titre: 'Brief', url: 'https://exemple.fr/brief' } })).lien;
  const autre = (await ok('/cm/liens', s.cm123456, { methode: 'POST', corps: { titre: 'Autre', url: 'https://exemple.fr/autre' } })).lien;
  const club = (await ok('/cm/tableaux', s.cm123456)).tableaux.find(t => t.cleDefaut === 'contenus');
  const t = await ok(`/cm/tableaux/${club.id}`, s.cm123456);
  const carte = (await ok(`/cm/tableaux/${club.id}/cartes`, s.cm123456, { methode: 'POST', corps: { listeId: t.listes[0].id, titre: 'Annonce' } })).carte;
  const carte2 = (await ok(`/cm/tableaux/${club.id}/cartes`, s.cm123456, { methode: 'POST', corps: { listeId: t.listes[0].id, titre: 'Autre carte' } })).carte;
  const dossier = (await ok('/cm/drive/dossiers', s.cm123456, { methode: 'POST', corps: { portee: 'club', nom: 'Contrats', restreint: true } })).id;
  const dossierTeam = (await ok('/cm/drive/dossiers', s.cm123456, { methode: 'POST', corps: { portee: A.teamId, nom: 'Interne', restreint: true } })).id;
  const dossierLibre = (await ok('/cm/drive/dossiers', s.cm123456, { methode: 'POST', corps: { portee: A.teamId, nom: 'Partagé' } })).id;

  // Lier (plusieurs-à-plusieurs) : deux cartes, deux dossiers pour un lien ; un lien pour plusieurs cibles.
  const lier = (jeton, id, genre, cibleId) => api(`/cm/liens/${id}/liaisons`, jeton, { methode: 'POST', corps: { genre, cibleId } });
  for (const [genre, id] of [['carte', carte.id], ['carte', carte2.id], ['dossier', dossier], ['dossier', dossierTeam], ['dossier', dossierLibre]]) assert.equal((await lier(s.cm123456, lien.id, genre, id)).statut, 200);
  assert.equal((await lier(s.cm123456, lien.id, 'carte', carte.id)).statut, 200, 'idempotent');
  assert.equal((await lier(s.cm123456, autre.id, 'carte', carte.id)).statut, 200);
  assert.equal((await lier(s.cm123456, lien.id, 'tableau', carte.id)).statut, 400);
  assert.equal((await lier(s.cm123456, lien.id, 'carte', '00000000-0000-4000-8000-000000000000')).statut, 404);
  const ou = await ok(`/cm/liens/${lien.id}/liaisons`, s.cm123456);
  assert.equal(ou.cartes.length, 2);
  assert.equal(ou.dossiers.length, 3);
  assert.equal(ou.cartes.find(x => x.id === carte.id).tableauId, club.id);
  assert.deepEqual(ou.dossiers.find(x => x.id === dossierTeam).chemin, ['Interne']);
  assert.equal((await ok('/cm/liens', s.cm123456)).liens.find(l => l.id === lien.id).liaisons, 5);
  // Depuis une cible : les liens liés.
  assert.deepEqual((await ok(`/cm/liens/cible/carte/${carte.id}`, s.cm123456)).liens.map(l => l.titre).sort(), ['Autre', 'Brief']);
  assert.equal((await ok(`/cm/liens/cible/dossier/${dossier}`, s.cm123456)).droits.lier, true);

  // Visibilité : le rédacteur (cm.voir + cm.editer du club, sans Drive) voit les cartes, jamais les dossiers.
  const rouge = await ok(`/cm/liens/${lien.id}/liaisons`, s.red12345);
  assert.equal(rouge.cartes.length, 2);
  assert.equal(rouge.dossiers.length, 0);
  assert.equal((await ok('/cm/liens', s.red12345)).liens.find(l => l.id === lien.id).liaisons, 2);
  assert.equal((await api(`/cm/liens/cible/dossier/${dossier}`, s.red12345)).statut, 404);
  assert.equal((await lier(s.red12345, lien.id, 'dossier', dossierLibre)).statut, 404);
  // Le correspondant de la team : le dossier de sa team non restreint seulement ; aucune carte du club ; il ne lie ni ne délie.
  const kai = await ok(`/cm/liens/${lien.id}/liaisons`, s.kai12345);
  assert.deepEqual(kai.dossiers.map(d => d.id), [dossierLibre]);
  assert.equal(kai.cartes.length, 0);
  assert.equal((await api(`/cm/liens/cible/dossier/${dossierTeam}`, s.kai12345)).statut, 404);
  assert.equal((await ok(`/cm/liens/cible/dossier/${dossierLibre}`, s.kai12345)).droits.lier, false);
  assert.equal((await lier(s.kai12345, lien.id, 'dossier', dossierLibre)).statut, 403);
  assert.equal((await api(`/cm/liens/${lien.id}/liaisons/dossier/${dossierLibre}`, s.kai12345, { methode: 'DELETE' })).statut, 403);
  assert.equal((await lier(s.seul1234, lien.id, 'carte', carte.id)).statut, 403);

  // Délier.
  const apres = await ok(`/cm/liens/${lien.id}/liaisons/carte/${carte2.id}`, s.red12345, { methode: 'DELETE' });
  assert.equal(apres.cartes.length, 1);
  // Supprimer une carte retire ses liaisons ; une carte à la corbeille ou un dossier à la corbeille disparaît des lectures.
  await ok(`/cm/cartes/${carte.id}`, s.cm123456, { methode: 'DELETE' });
  assert.equal((await b.base.tous('SELECT * FROM cm_lien_liaisons WHERE cible_id = ?', [carte.id])).length, 0);
  await ok(`/cm/drive/dossiers/${dossier}`, s.cm123456, { methode: 'DELETE' });
  assert.equal((await ok(`/cm/liens/${lien.id}/liaisons`, s.cm123456)).dossiers.length, 2);
  await ok(`/cm/drive/corbeille/${dossier}`, s.cm123456, { methode: 'DELETE' });
  assert.equal((await b.base.tous('SELECT * FROM cm_lien_liaisons WHERE cible_id = ?', [dossier])).length, 0);
  // Supprimer le lien le délie partout (cm.gerer).
  await ok(`/cm/liens/${lien.id}`, s.cm123456, { methode: 'DELETE' });
  assert.equal((await b.base.tous('SELECT * FROM cm_lien_liaisons WHERE lien_id = ?', [lien.id])).length, 0);
  assert.equal((await b.base.tous('SELECT * FROM cm_lien_liaisons', [])).length, 0, 'la carte supprimée a aussi emporté la liaison de l’autre lien');
  assert.equal((await ok(`/cm/liens/${autre.id}/liaisons`, s.cm123456)).cartes.length, 0);
  // Un tableau supprimé emporte les liaisons de ses cartes.
  const t2 = (await ok('/cm/tableaux', s.cm123456, { methode: 'POST', corps: { nom: 'Temp', modele: 'contenus' } }));
  const c3 = (await ok(`/cm/tableaux/${t2.tableau.id}/cartes`, s.cm123456, { methode: 'POST', corps: { listeId: t2.listes[0].id, titre: 'Temp' } })).carte;
  await lier(s.cm123456, autre.id, 'carte', c3.id);
  await ok(`/cm/tableaux/${t2.tableau.id}`, s.cm123456, { methode: 'DELETE' });
  assert.equal((await b.base.tous('SELECT * FROM cm_lien_liaisons WHERE cible_id = ?', [c3.id])).length, 0);
});

test('liens : RGPD (export, suppression sans auteur) et export / import de la base', async () => {
  const { b, s, ok } = await preparer();
  const lien = (await ok('/cm/liens', s.cm123456, { methode: 'POST', corps: { titre: 'Mon lien', url: 'https://exemple.fr/m', categorie: 'Outils' } })).lien;
  const club = (await ok('/cm/tableaux', s.cm123456)).tableaux.find(t => t.cleDefaut === 'contenus');
  const t = await ok(`/cm/tableaux/${club.id}`, s.cm123456);
  const carte = (await ok(`/cm/tableaux/${club.id}/cartes`, s.cm123456, { methode: 'POST', corps: { listeId: t.listes[0].id, titre: 'C' } })).carte;
  await ok(`/cm/liens/${lien.id}/liaisons`, s.cm123456, { methode: 'POST', corps: { genre: 'carte', cibleId: carte.id } });
  for (const n of ['cm_liens', 'cm_lien_liaisons']) assert.ok(TABLES.some(([x]) => x === n), `export : ${n}`);
  const exp = await ok('/moi/export', s.cm123456);
  assert.deepEqual(exp.cmLiens.map(l => [l.titre, l.categorie]), [['Mon lien', 'Outils']]);
  const { exporterBase, importerBase } = await import('../noyau/transfert.mjs');
  const sauvegarde = await exporterBase(b.base);
  const { baseMigree } = await import('./base.mjs');
  const neuve = await baseMigree();
  const bilan = await importerBase(neuve, JSON.parse(JSON.stringify(sauvegarde)));
  assert.equal(bilan.cm_liens, 1);
  assert.equal(bilan.cm_lien_liaisons, 1);
  await ok('/moi', s.cm123456, { methode: 'DELETE' });
  assert.equal((await b.base.premier('SELECT cree_par FROM cm_liens WHERE id = ?', [lien.id])).cree_par, null);
  assert.equal((await b.base.premier('SELECT cree_par FROM cm_lien_liaisons WHERE lien_id = ?', [lien.id])).cree_par, null);
});
