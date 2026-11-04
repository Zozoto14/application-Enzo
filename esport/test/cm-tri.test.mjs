/**
 * Tri des cartes par colonne CM (migration 0052, docs/esport/cm.md, « Tri des cartes ») : tri automatique par défaut,
 * choix « automatique / manuel » enregistré par colonne côté serveur et visible de tous, permission cm.editer, valeur
 * illisible refusée, colonne créée par import Trello, export / import de la base, migration des anciennes préférences
 * personnelles « Critiques en haut ».
 *
 * Tourne sur SQLite (défaut) et sur PostgreSQL (ESPORT_TEST_PG, esport/test/pg/lancer.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { baseMigree, baseVierge, lireMigrations } from './base.mjs';
import { appliquerMigrations } from '../noyau/migrations.mjs';
import { exporterBase, importerBase } from '../noyau/transfert.mjs';

async function preparer() {
  const b = await banc();
  const A = await teamAvecMembres(b, { membres: {} });
  const s = { ...A.sessions };
  s.cm123456 = await b.session('cm123456', 'Clara');
  s.vue12345 = await b.session('vue12345', 'Vera');
  const api = (chemin, jeton, o = {}) => b.appel(chemin, { jeton, methode: o.methode, corps: o.corps });
  const ok = async (chemin, jeton, o = {}) => {
    const r = await api(chemin, jeton, o);
    assert.equal(r.statut, 200, `${o.methode ?? 'GET'} ${chemin} : ${r.statut} ${JSON.stringify(r.corps)}`);
    return r.corps;
  };
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'cm123456', roleId: 'cm-role-responsable', portee: 'club' } });
  const lecteur = await ok('/cm/roles', s.fondateur, { methode: 'POST', corps: { nom: 'Lecteur', couleur: '#123456', permissions: ['cm.voir'] } });
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'vue12345', roleId: lecteur.id ?? lecteur.role?.id, portee: 'club' } });
  const club = (await ok('/cm/tableaux', s.cm123456)).tableaux.find(t => t.portee === 'club');
  const plateau = jeton => ok(`/cm/tableaux/${club.id}`, jeton);
  return { b, s, api, ok, club, plateau };
}

test('colonnes : tri automatique par défaut (colonnes par défaut et créées), visible de tous', async () => {
  const { s, ok, club, plateau } = await preparer();
  await ok(`/cm/tableaux/${club.id}/listes`, s.cm123456, { methode: 'POST', corps: { nom: 'À relire' } });
  for (const jeton of [s.cm123456, s.vue12345]) {
    const d = await plateau(jeton);
    assert.ok(d.listes.length > 1);
    assert.ok(d.listes.every(l => l.tri === 'auto'), JSON.stringify(d.listes.map(l => l.tri)));
  }
});

test('PATCH tri : choix par colonne, relu par les autres, autres colonnes inchangées ; retour possible au tri automatique', async () => {
  const { s, ok, club, plateau } = await preparer();
  const [a, b] = (await plateau(s.cm123456)).listes;
  await ok(`/cm/listes/${a.id}`, s.cm123456, { methode: 'PATCH', corps: { tri: 'manuel' } });
  let d = await plateau(s.vue12345);
  assert.equal(d.listes.find(l => l.id === a.id).tri, 'manuel');
  assert.equal(d.listes.find(l => l.id === b.id).tri, 'auto');
  assert.ok(d.tableau.version > 0);
  await ok(`/cm/listes/${a.id}`, s.cm123456, { methode: 'PATCH', corps: { tri: 'auto' } });
  d = await plateau(s.vue12345);
  assert.equal(d.listes.find(l => l.id === a.id).tri, 'auto');
  assert.ok(club.id);
});

test('PATCH tri : valeur illisible refusée (400), permission cm.editer exigée (403), ne touche pas aux autres champs', async () => {
  const { s, ok, api, plateau } = await preparer();
  const [a] = (await plateau(s.cm123456)).listes;
  for (const tri of ['aleatoire', true, 1, null, '']) assert.equal((await api(`/cm/listes/${a.id}`, s.cm123456, { methode: 'PATCH', corps: { tri } })).statut, 400, String(tri));
  assert.equal((await api(`/cm/listes/${a.id}`, s.vue12345, { methode: 'PATCH', corps: { tri: 'manuel' } })).statut, 403);
  assert.equal((await plateau(s.cm123456)).listes.find(l => l.id === a.id).tri, 'auto');
  await ok(`/cm/listes/${a.id}`, s.cm123456, { methode: 'PATCH', corps: { tri: 'manuel', fin: true } });
  const l = (await plateau(s.cm123456)).listes.find(x => x.id === a.id);
  assert.deepEqual([l.tri, l.fin], ['manuel', true]);
});

test('le tri n’altère pas l’ordre manuel stocké : les positions des cartes restent celles du glisser-déposer', async () => {
  const { s, ok, club, plateau } = await preparer();
  const [a] = (await plateau(s.cm123456)).listes;
  const c1 = (await ok(`/cm/tableaux/${club.id}/cartes`, s.cm123456, { methode: 'POST', corps: { listeId: a.id, titre: 'Une' } })).carte;
  const c2 = (await ok(`/cm/tableaux/${club.id}/cartes`, s.cm123456, { methode: 'POST', corps: { listeId: a.id, titre: 'Deux' } })).carte;
  await ok(`/cm/cartes/${c2.id}`, s.cm123456, { methode: 'PATCH', corps: { urgence: 'critique' } });
  const avant = (await plateau(s.cm123456)).cartes.map(c => [c.titre, c.position]);
  await ok(`/cm/listes/${a.id}`, s.cm123456, { methode: 'PATCH', corps: { tri: 'manuel' } });
  await ok(`/cm/listes/${a.id}`, s.cm123456, { methode: 'PATCH', corps: { tri: 'auto' } });
  assert.deepEqual((await plateau(s.cm123456)).cartes.map(c => [c.titre, c.position]), avant);
  assert.ok(c1.id);
});

test('export / import de la base : le tri de chaque colonne est conservé ; ancien export (sans colonne) : tri automatique', async () => {
  const { b, s, ok, plateau } = await preparer();
  const [a, c] = (await plateau(s.cm123456)).listes;
  await ok(`/cm/listes/${a.id}`, s.cm123456, { methode: 'PATCH', corps: { tri: 'manuel' } });
  const exp = (await b.appel('/admin/export', { jeton: s.fondateur })).corps;
  assert.equal(exp.tables.cm_listes.find(l => l.id === a.id).tri, 'manuel');
  assert.equal(exp.tables.cm_listes.find(l => l.id === c.id).tri, 'auto');
  const neuve = await baseMigree();
  await importerBase(neuve, exp);
  assert.deepEqual(await exporterBase(neuve, Date.parse(exp.exporteLe)), exp);
  assert.equal((await neuve.premier('SELECT tri FROM cm_listes WHERE id = ?', [a.id])).tri, 'manuel');
  // Export d'avant la migration : pas de colonne `tri`, la valeur par défaut s'applique.
  const ancien = structuredClone(exp);
  for (const l of ancien.tables.cm_listes) delete l.tri;
  const base2 = await baseMigree();
  await importerBase(base2, ancien);
  assert.equal((await base2.premier('SELECT tri FROM cm_listes WHERE id = ?', [a.id])).tri, 'auto');
});

test('migration 0052 : colonne `tri` (défaut auto) sur les colonnes existantes ; anciennes préférences « tri_urgence » supprimées, les autres gardées', async () => {
  const base = await baseVierge();
  const toutes = lireMigrations();
  await appliquerMigrations(base, toutes.filter(m => m.nom < '0052'));
  const t = new Date().toISOString();
  await base.executer("INSERT INTO cm_tableaux (id, portee, nom, position, version, cree_le, maj_le) VALUES ('t1', 'club', 'T', 1, 1, ?, ?)", [t, t]);
  await base.executer("INSERT INTO cm_listes (id, tableau_id, nom, position, cree_le, maj_le) VALUES ('l1', 't1', 'Idées', 1024, ?, ?)", [t, t]);
  for (const [cle, valeur] of [['tableau.t1.tri_urgence', '["l1"]'], ['tableau.t1.reduites', '["l1"]'], ['calendrier.teams', '[]']]) {
    await base.executer('INSERT INTO cm_preferences (compte_id, cle, valeur, maj_le) VALUES (?, ?, ?, ?)', ['cm123456', cle, valeur, t]);
  }
  const faites = await appliquerMigrations(base, toutes.filter(m => m.nom < '0053'));
  assert.deepEqual(faites, ['0052_cm_liste_tri.sql']);
  assert.equal((await base.premier("SELECT tri FROM cm_listes WHERE id = 'l1'")).tri, 'auto');
  const restantes = (await base.tous('SELECT cle FROM cm_preferences ORDER BY cle', [])).map(p => p.cle);
  assert.deepEqual(restantes, ['calendrier.teams', 'tableau.t1.reduites']);
});
