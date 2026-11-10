/**
 * CM du club (migrations 0068 et 0069, docs/esport/cm.md, « Le CM du club ») : le CM du club est une vraie team dont l'appartenance
 * EST l'appartenance CM du club.
 *
 *  - migration depuis une base de production réaliste (fixture : Valorant LZ0, The Final LZ0, Lina Responsable CM,
 *    un correspondant, un rôle CM créé, un compte à deux rôles CM, un correspondant de team, tableau restreint,
 *    Drive du club) : membres, rôles, permissions, accès CM (Manager d'une autre team toujours refusé), tableaux
 *    et Drive intacts ; reprise rejouable sans effet ;
 *  - membre créé dans le CM du club : Dashboard, Membres, Trombinoscope, espace CM ; rôles CM ↔ rôles de la team ;
 *  - export / import (nouveau format et export antérieur à 0068).
 *
 * Tourne sur SQLite (défaut) et sur PostgreSQL (ESPORT_TEST_PG, esport/test/pg/lancer.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { banc, teamAvecMembres } from './aide.mjs';
import { baseMigree, baseVierge, lireMigrations } from './base.mjs';
import { appliquerMigrations } from '../noyau/migrations.mjs';
import { PERMISSIONS_TEAM_CM_BASE, PERMISSIONS_TEAM_CM_RESPONSABLE, ROLES_TEAM_CM_SYSTEME, SQL_REPRISE_TEAM_CM, TEAM_CM_ID, reprendreTeamCm } from '../noyau/cm/teamCm.mjs';
import { exporterBase, importerBase } from '../noyau/transfert.mjs';

const D = '2026-09-01T10:00:00.000Z';
const VAL = '11111111-1111-4111-8111-111111111111';
const TF = '22222222-2222-4222-8222-222222222222';
const GRAPHISTE = '33333333-3333-4333-8333-333333333333';
const TABLEAU = '44444444-4444-4444-8444-444444444444';
const COMPTES = { lina0001: 'Lynaoxie', cor00001: 'Corentin', dou00001: 'Double', gra00001: 'Graph', val00001: 'Valmanager', kai00001: 'Kai', tfj00001: 'Tifa' };

/** Base « de production » arrêtée à la migration 0067, avec ses données CM. */
async function fixture() {
  const base = await baseVierge();
  const toutes = lireMigrations();
  await appliquerMigrations(base, toutes.filter(m => m.nom < '0068'));
  const x = (sql, p = []) => base.executer(sql, p);
  for (const [id, pseudo] of Object.entries(COMPTES)) await x('INSERT INTO comptes (id, pseudo, pseudo_cle, cree_le, maj_le, active_le) VALUES (?, ?, ?, ?, ?, ?)', [id, pseudo, pseudo.toLowerCase(), D, D, D]);
  await x('INSERT INTO comptes (id, pseudo, pseudo_cle, cree_le, maj_le) VALUES (?, ?, ?, ?, ?)', ['principal', 'Fondateur', 'fondateur', D, D]);
  for (const [id, nom, slug] of [[VAL, 'Valorant LZ0', 'valorant-lz0'], [TF, 'The Final LZ0', 'the-final-lz0']]) {
    await x('INSERT INTO teams (id, nom, slug, jeu, cree_par, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, nom, slug, 'valorant', 'principal', D, D]);
    for (const m of ['planning', 'availability', 'cm', 'tournois', 'strat_editor']) await x("INSERT INTO team_modules (team_id, module, active, config, maj_le) VALUES (?, ?, 1, '{}', ?)", [id, m, D]);
  }
  const role = async (id, team, cle, nom, perms) => {
    await x('INSERT INTO roles (id, team_id, cle_systeme, nom, couleur, systeme, position, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)', [id, team, cle, nom, '#7c3aed', D, D]);
    for (const p of perms) await x('INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)', [id, p]);
  };
  await role('aaaaaaaa-0000-4000-8000-000000000001', VAL, 'manager', 'Manager', ['members.view', 'members.invite', 'planning.view', 'cm.deposer', 'cm.clips.proposer']);
  await role('aaaaaaaa-0000-4000-8000-000000000002', VAL, 'joueur', 'Joueur', ['members.view', 'planning.view']);
  await role('aaaaaaaa-0000-4000-8000-000000000003', TF, 'joueur', 'Joueur', ['members.view', 'planning.view']);
  const membre = (id, team, compte, roleId) => x("INSERT INTO membres (id, team_id, compte_id, role_id, statut, rejoint_le, maj_le) VALUES (?, ?, ?, ?, 'actif', ?, ?)", [id, team, compte, roleId, D, D]);
  await membre('bbbbbbbb-0000-4000-8000-000000000001', VAL, 'val00001', 'aaaaaaaa-0000-4000-8000-000000000001');
  await membre('bbbbbbbb-0000-4000-8000-000000000002', VAL, 'kai00001', 'aaaaaaaa-0000-4000-8000-000000000002');
  await membre('bbbbbbbb-0000-4000-8000-000000000003', TF, 'tfj00001', 'aaaaaaaa-0000-4000-8000-000000000003');
  // Rôle CM créé par le Fondateur.
  await x("INSERT INTO cm_roles (id, cle_systeme, nom, couleur, systeme, position, cree_le, maj_le) VALUES (?, NULL, 'Graphiste', '#22aa88', 0, 2, ?, ?)", [GRAPHISTE, D, D]);
  for (const p of ['cm.voir', 'cm.deposer', 'cm.drive.voir', 'cm.drive.envoyer']) await x('INSERT INTO cm_role_permissions (role_id, permission) VALUES (?, ?)', [GRAPHISTE, p]);
  const aff = (id, compte, roleId, portee, date = D) => x('INSERT INTO cm_affectations (id, compte_id, role_id, portee, team_id, cree_par, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, compte, roleId, portee, portee === 'club' ? null : portee, 'principal', date]);
  await aff('cccccccc-0000-4000-8000-000000000001', 'lina0001', 'cm-role-responsable', 'club');
  await aff('cccccccc-0000-4000-8000-000000000002', 'cor00001', 'cm-role-correspondant', 'club');
  await aff('cccccccc-0000-4000-8000-000000000003', 'dou00001', GRAPHISTE, 'club', '2026-08-01T10:00:00.000Z');
  await aff('cccccccc-0000-4000-8000-000000000004', 'dou00001', 'cm-role-responsable', 'club');
  await aff('cccccccc-0000-4000-8000-000000000005', 'gra00001', GRAPHISTE, 'club');
  await aff('cccccccc-0000-4000-8000-000000000006', 'kai00001', 'cm-role-correspondant', VAL);
  // Compte d'un ancien membre sans fiche Esport : son affectation reste (pas de membre possible).
  await aff('cccccccc-0000-4000-8000-000000000007', 'fan00001', 'cm-role-correspondant', 'club');
  // Tableau du club RESTREINT (0046) : Lina (modifier) et le rôle Correspondant CM (voir).
  await x("INSERT INTO cm_tableaux (id, portee, nom, couleur, position, version, cree_par, cree_le, maj_le, acces) VALUES (?, 'club', 'Stratégie réseaux', '#5b8cff', 1, 1, 'lina0001', ?, ?, 'restreint')", [TABLEAU, D, D]);
  await x("INSERT INTO cm_tableau_acces (tableau_id, genre, cible, niveau, ajoute_par, ajoute_le) VALUES (?, 'compte', 'lina0001', 'modifier', 'principal', ?)", [TABLEAU, D]);
  await x("INSERT INTO cm_tableau_acces (tableau_id, genre, cible, niveau, ajoute_par, ajoute_le) VALUES (?, 'role_cm', 'cm-role-correspondant', 'voir', 'principal', ?)", [TABLEAU, D]);
  // Drive du club (0027) : un dossier et un fichier.
  await x("INSERT INTO cm_drive_dossiers (id, portee, nom, cree_par, cree_le, maj_le) VALUES ('dddddddd-0000-4000-8000-000000000001', 'club', 'Logos 2026', 'lina0001', ?, ?)", [D, D]);
  await x("INSERT INTO cm_drive_fichiers (id, portee, dossier_id, nom, nom_cle, fichier_id, type_mime, genre, taille, cree_par, cree_le, maj_le) VALUES ('dddddddd-0000-4000-8000-000000000002', 'club', 'dddddddd-0000-4000-8000-000000000001', 'logo.png', 'logo.png', 'eeeeeeee-0000-4000-8000-000000000001', 'image/png', 'image', 1234, 'lina0001', ?, ?)", [D, D]);
  return base;
}

const permissionsClubDe = async (base, compte) => (await base.tous('SELECT DISTINCT permission FROM permissions_club WHERE compte_id = ? ORDER BY permission', [compte])).map(l => l.permission);
const affectationsVues = async base => (await base.tous('SELECT compte_id, role_id, portee FROM cm_affectations', [])).map(a => `${a.compte_id}|${a.role_id}|${a.portee}`).sort();
const compter = async (base, table) => Number((await base.premier(`SELECT COUNT(*) AS n FROM ${table}`, [])).n);

test('migration 0068 depuis une base réaliste : membres du CM du club, rôles liés, permissions et accès CM inchangés, reprise sans effet', async () => {
  const base = await fixture();
  const comptes = [...Object.keys(COMPTES), 'fan00001'];
  const avant = Object.fromEntries(await Promise.all(comptes.map(async c => [c, await permissionsClubDe(base, c)])));
  const affAvant = await affectationsVues(base);
  const accesAvant = await base.tous('SELECT tableau_id, genre, cible, niveau FROM cm_tableau_acces ORDER BY genre, cible', []);
  const driveAvant = await base.tous('SELECT id, portee, dossier_id, nom FROM cm_drive_fichiers ORDER BY id', []);

  await appliquerMigrations(base, lireMigrations());

  // Le CM du club : une vraie team, sans profil de jeu, modules de jeu coupés.
  const team = await base.premier('SELECT * FROM teams WHERE id = ?', [TEAM_CM_ID]);
  assert.deepEqual([team.nom, team.slug, team.genre, team.jeu], ['CM du club', 'cm-du-club', 'cm', 'communication']);
  const modules = Object.fromEntries((await base.tous('SELECT module, active FROM team_modules WHERE team_id = ?', [TEAM_CM_ID])).map(m => [m.module, Number(m.active)]));
  for (const m of ['planning', 'availability', 'meeting_summaries', 'discord', 'resources']) assert.equal(modules[m], 1, m);
  for (const m of ['strat_editor', 'tournois', 'resultats', 'scouting', 'playbook', 'cm']) assert.equal(modules[m], 0, m);
  // Rôles liés aux rôles CM (le rôle créé compris), permissions de team par défaut.
  const roles = await base.tous('SELECT id, nom, cm_role_id FROM roles WHERE team_id = ? ORDER BY position, nom', [TEAM_CM_ID]);
  assert.deepEqual(roles.map(r => [r.nom, r.cm_role_id]), [['Responsable CM', 'cm-role-responsable'], ['Correspondant CM', 'cm-role-correspondant'], ['Graphiste', GRAPHISTE]]);
  const permsRole = async id => (await base.tous('SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission', [id])).map(l => l.permission);
  assert.deepEqual(await permsRole(ROLES_TEAM_CM_SYSTEME.responsable), [...PERMISSIONS_TEAM_CM_RESPONSABLE].sort());
  assert.deepEqual(await permsRole(ROLES_TEAM_CM_SYSTEME.correspondant), [...PERMISSIONS_TEAM_CM_BASE].sort());
  assert.deepEqual(await permsRole(GRAPHISTE), [...PERMISSIONS_TEAM_CM_BASE].sort());
  // Membres : un par compte (le premier rôle : Responsable avant le rôle créé), même identifiant et même date.
  const membres = await base.tous('SELECT m.id, m.compte_id, r.nom, m.rejoint_le FROM membres m JOIN roles r ON r.id = m.role_id WHERE m.team_id = ? ORDER BY m.compte_id', [TEAM_CM_ID]);
  assert.deepEqual(membres.map(m => [m.compte_id, m.nom]), [['cor00001', 'Correspondant CM'], ['dou00001', 'Responsable CM'], ['gra00001', 'Graphiste'], ['lina0001', 'Responsable CM']]);
  assert.equal(membres.find(m => m.compte_id === 'lina0001').id, 'cccccccc-0000-4000-8000-000000000001');
  // Restent directes : le rôle supplémentaire, le correspondant de team, le compte sans fiche.
  assert.deepEqual((await base.tous('SELECT id FROM cm_affectations_directes ORDER BY id', [])).map(l => l.id), ['cccccccc-0000-4000-8000-000000000003', 'cccccccc-0000-4000-8000-000000000006', 'cccccccc-0000-4000-8000-000000000007']);
  // Rien de perdu : mêmes affectations vues, mêmes permissions du club pour chacun.
  assert.deepEqual(await affectationsVues(base), affAvant);
  for (const c of comptes) assert.deepEqual(await permissionsClubDe(base, c), avant[c], c);
  // Tableaux restreints et Drive intacts.
  assert.deepEqual(await base.tous('SELECT tableau_id, genre, cible, niveau FROM cm_tableau_acces ORDER BY genre, cible', []), accesAvant);
  assert.deepEqual(await base.tous('SELECT id, portee, dossier_id, nom FROM cm_drive_fichiers ORDER BY id', []), driveAvant);

  // La reprise est la même que celle de la migration, et rejouable sans effet.
  const bloc = nom => readFileSync(new URL(`../migrations/${nom}`, import.meta.url), 'utf8').split('-- Reprise (debut)\n')[1].split('-- Reprise (fin)')[0];
  const instructions = [bloc('0068_team_cm.sql'), bloc('0069_cm_du_club.sql')].flatMap(b => b.split(';\n').map(x => x.trim().replace(/;$/, '')).filter(Boolean));
  assert.deepEqual(instructions, [...SQL_REPRISE_TEAM_CM]);
  const tables = ['teams', 'team_modules', 'roles', 'role_permissions', 'membres', 'cm_affectations_directes'];
  const n = Object.fromEntries(await Promise.all(tables.map(async t => [t, await compter(base, t)])));
  await reprendreTeamCm(base);
  await reprendreTeamCm(base);
  for (const t of tables) assert.equal(await compter(base, t), n[t], t);
  assert.deepEqual(await affectationsVues(base), affAvant);
});

test('après la migration : espace CM par le CM du club (Manager d’une autre team refusé), tableau restreint et Drive, CM du club partout', async () => {
  const base = await fixture();
  await appliquerMigrations(base, lireMigrations());
  const b = await banc({ base });
  const s = {};
  for (const c of [...Object.keys(COMPTES), 'principal']) s[c] = await b.session(c);
  const api = (chemin, jeton, o = {}) => b.appel(chemin, { jeton, methode: o.methode, corps: o.corps });
  const ok = async (chemin, jeton, o = {}) => {
    const r = await api(chemin, jeton, o);
    assert.equal(r.statut, 200, `${o.methode ?? 'GET'} ${chemin} : ${r.statut} ${JSON.stringify(r.corps)}`);
    return r.corps;
  };
  // Espace CM : l'équipe CM y entre ; le Manager de Valorant LZ0 (cm.deposer de team) et un joueur, jamais.
  for (const c of ['lina0001', 'cor00001', 'dou00001', 'gra00001']) assert.equal((await ok('/cm/moi', s[c])).espace, true, c);
  for (const c of ['val00001', 'tfj00001']) {
    assert.equal((await ok('/cm/moi', s[c])).espace, false, c);
    assert.ok([403, 404].includes((await api('/cm/tableaux', s[c])).statut), c);
    assert.ok([403, 404].includes((await api('/cm/drive?portee=club', s[c])).statut), c);
    assert.equal((await api(`/teams/${TEAM_CM_ID}`, s[c])).statut, 404, `${c} : le CM du club n’existe pas pour lui`);
  }
  assert.equal((await ok('/cm/moi', s.lina0001)).gerer, true);
  // Kai, correspondant de Valorant LZ0 : l'onglet CM de sa team, pas le CM du club.
  assert.equal((await ok(`/cm/teams/${VAL}`, s.kai00001)).team.id, VAL);
  // Tableau restreint : Lina et le rôle Correspondant CM (Corentin) ; pas le Graphiste.
  assert.equal((await api(`/cm/tableaux/${TABLEAU}`, s.lina0001)).statut, 200);
  assert.equal((await api(`/cm/tableaux/${TABLEAU}`, s.cor00001)).statut, 200);
  assert.ok([403, 404].includes((await api(`/cm/tableaux/${TABLEAU}`, s.gra00001)).statut));
  // Drive du club = Drive du CM du club : le dossier est là.
  const drive = await ok('/cm/drive?portee=club', s.lina0001);
  assert.ok(drive.dossiers.some(d => d.nom === 'Logos 2026'));
  // Teams, Dashboard : le CM du club avec son rôle ; Membres et Trombinoscope : ses membres.
  const teams = (await ok('/teams', s.lina0001)).teams;
  const tcm = teams.find(t => t.id === TEAM_CM_ID);
  assert.deepEqual([tcm.genre, tcm.role.nom, tcm.membres, tcm.jeuNom], ['cm', 'Responsable CM', 4, 'Communication']);
  assert.ok(!tcm.modules.includes('strat_editor') && tcm.modules.includes('planning'));
  assert.ok((await ok('/dashboard', s.lina0001)).teams.some(t => t.team.id === TEAM_CM_ID));
  const annuaire = await ok('/membres', s.principal);
  const ta = annuaire.teams.find(t => t.id === TEAM_CM_ID);
  assert.equal(ta.genre, 'cm');
  assert.deepEqual(ta.roles.map(r => r.nom), ['Responsable CM', 'Correspondant CM', 'Graphiste']);
  const trombi = await ok('/trombi', s.principal);
  const carte = trombi.fiches.find(f => f.compte === 'lina0001');
  assert.deepEqual([carte.staff, carte.teams[0].genre, carte.teams[0].role.nom], [true, 'cm', 'Responsable CM']);
  assert.equal(trombi.fiches.find(f => f.compte === 'kai00001').staff, false);
  assert.ok(trombi.teams.some(t => t.id === TEAM_CM_ID && t.genre === 'cm'));
  // Équipe CM (affectations) : les membres du CM du club en portée « club », le rôle supplémentaire, le correspondant.
  const affs = (await ok('/cm/affectations', s.lina0001)).affectations;
  assert.ok(affs.some(a => a.compte === 'dou00001' && a.role.nom === 'Graphiste' && a.portee === 'club'));
  assert.ok(affs.some(a => a.compte === 'dou00001' && a.role.nom === 'Responsable CM' && a.portee === 'club'));
  assert.ok(affs.some(a => a.compte === 'kai00001' && a.portee === VAL));
});

test('membre créé dans le CM du club : Dashboard, Membres, Trombinoscope, espace CM ; anti-escalade ; plusieurs teams', async () => {
  const b = await banc();
  const A = await teamAvecMembres(b, { nom: 'Valorant LZ0', membres: { man12345: { pseudo: 'Max', role: 'manager' }, lea12345: { pseudo: 'Léa', role: 'joueur' } } });
  const s = { ...A.sessions, lina0001: await b.session('lina0001', 'Lynaoxie'), nou12345: await b.session('nou12345', 'Nouvelle') };
  const api = (chemin, jeton, o = {}) => b.appel(chemin, { jeton, methode: o.methode, corps: o.corps });
  const ok = async (chemin, jeton, o = {}) => {
    const r = await api(chemin, jeton, o);
    assert.equal(r.statut, 200, `${o.methode ?? 'GET'} ${chemin} : ${r.statut} ${JSON.stringify(r.corps)}`);
    return r.corps;
  };
  // Le sélecteur de teams (Membres › créer / ajouter) propose le CM du club avec ses rôles.
  const annuaire = await ok('/membres', s.fondateur);
  const tcm = annuaire.teams.find(t => t.id === TEAM_CM_ID);
  assert.deepEqual(tcm.roles.map(r => [r.nom, r.attribuable]), [['Responsable CM', true], ['Correspondant CM', true]]);
  // Le Fondateur ajoute Lina (Responsable CM) et Léa, joueuse de Valorant, aussi Correspondante CM.
  await ok(`/teams/${TEAM_CM_ID}/membres`, s.fondateur, { methode: 'POST', corps: { compte: 'lina0001', roleId: ROLES_TEAM_CM_SYSTEME.responsable } });
  await ok(`/teams/${TEAM_CM_ID}/membres`, s.fondateur, { methode: 'POST', corps: { compte: 'lea12345', roleId: ROLES_TEAM_CM_SYSTEME.correspondant } });
  assert.deepEqual((await ok('/teams', s.lea12345)).teams.map(t => t.nom).sort(), ['CM du club', 'Valorant LZ0']);
  // Dashboard : le CM du club et ses membres ; Membres : ses membres ; Trombinoscope : une carte (rôle CM).
  const dash = await ok('/dashboard', s.lina0001);
  assert.equal(dash.teams.find(t => t.team.id === TEAM_CM_ID).effectif.actifs, 2);
  const comptes = (await ok('/membres', s.fondateur)).comptes;
  assert.deepEqual(comptes.find(c => c.compte === 'lina0001').appartenances.map(a => [a.teamId, a.role.nom]), [[TEAM_CM_ID, 'Responsable CM']]);
  assert.equal(comptes.find(c => c.compte === 'lea12345').appartenances.length, 2, 'Léa : Valorant LZ0 et CM du club');
  const trombi = await ok('/trombi', s.lina0001);
  assert.deepEqual(trombi.fiches.find(f => f.compte === 'lina0001').teams.map(t => [t.nom, t.role.nom]), [['CM du club', 'Responsable CM']]);
  assert.ok(trombi.fiches.some(f => f.compte === 'lea12345'), 'le CM voit les fiches du club');
  // Espace CM : ouvert par le CM du club ; Équipe CM : Lina en portée « club ».
  assert.equal((await ok('/cm/moi', s.lina0001)).gerer, true);
  assert.equal((await ok('/cm/moi', s.lea12345)).espace, true);
  assert.equal((await ok('/cm/moi', s.man12345)).espace, false, 'Manager d’une autre team : jamais');
  const lina = (await ok('/cm/affectations', s.lina0001)).affectations.find(a => a.compte === 'lina0001');
  assert.deepEqual([lina.portee, lina.role.cle], ['club', 'responsable']);
  // Anti-escalade : un Correspondant CM n'attribue pas Responsable CM ; la Responsable, oui (permissions CM qu'elle a).
  const nou = await api(`/teams/${TEAM_CM_ID}/membres`, s.lea12345, { methode: 'POST', corps: { compte: 'nou12345', roleId: ROLES_TEAM_CM_SYSTEME.responsable } });
  assert.ok([403, 404].includes(nou.statut));
  await ok(`/teams/${TEAM_CM_ID}/membres`, s.fondateur, { methode: 'POST', corps: { compte: 'nou12345', roleId: ROLES_TEAM_CM_SYSTEME.correspondant } });
  assert.equal((await ok('/cm/moi', s.nou12345)).espace, true);
  assert.equal((await ok('/cm/moi', s.nou12345)).gerer, false);
  const m = (await ok(`/teams/${TEAM_CM_ID}/membres`, s.fondateur)).membres.find(x => x.compte === 'nou12345');
  // La Responsable CM la nomme Responsable (rôle de team ET permissions CM : elle les a).
  await ok(`/teams/${TEAM_CM_ID}/membres/${m.id}`, s.lina0001, { methode: 'PATCH', corps: { roleId: ROLES_TEAM_CM_SYSTEME.responsable } });
  assert.equal((await ok('/cm/moi', s.nou12345)).gerer, true);
  // Suspendue dans le CM du club : plus d'espace CM.
  await ok(`/teams/${TEAM_CM_ID}/membres/${m.id}`, s.fondateur, { methode: 'PATCH', corps: { statut: 'suspendu' } });
  assert.equal((await ok('/cm/moi', s.nou12345)).espace, false);
  // Retirer l'affectation « club » (Équipe CM) retire du CM du club.
  await ok(`/cm/affectations/${lina.id}`, s.fondateur, { methode: 'DELETE' });
  assert.ok(!(await ok('/teams', s.lina0001)).teams.some(t => t.id === TEAM_CM_ID));
  assert.equal((await ok('/cm/moi', s.lina0001)).espace, false);
});

test('rôles CM ↔ rôles du CM du club ; affectation « club » = appartenance ; rôle supplémentaire ; garde-fous du CM du club', async () => {
  const b = await banc();
  const f = await b.session('principal', 'Fondateur');
  const s = { lina0001: await b.session('lina0001', 'Lynaoxie') };
  const api = (chemin, o = {}) => b.appel(chemin, { jeton: o.jeton ?? f, methode: o.methode, corps: o.corps });
  const ok = async (chemin, o = {}) => {
    const r = await api(chemin, o);
    assert.equal(r.statut, 200, `${o.methode ?? 'GET'} ${chemin} : ${r.statut} ${JSON.stringify(r.corps)}`);
    return r.corps;
  };
  // Créer un rôle CM crée son rôle dans le CM du club ; le renommer le renomme.
  const graphiste = await ok('/cm/roles', { methode: 'POST', corps: { nom: 'Graphiste', couleur: '#22aa88', permissions: ['cm.voir', 'cm.drive.voir'] } });
  let roles = (await ok(`/teams/${TEAM_CM_ID}/roles`)).roles;
  assert.deepEqual(roles.find(r => r.cmRoleId === graphiste.id)?.nom, 'Graphiste');
  await ok(`/cm/roles/${graphiste.id}`, { methode: 'PATCH', corps: { nom: 'Graphiste vidéo' } });
  roles = (await ok(`/teams/${TEAM_CM_ID}/roles`)).roles;
  const lie = roles.find(r => r.cmRoleId === graphiste.id);
  assert.equal(lie.nom, 'Graphiste vidéo');
  // Ses permissions de TEAM se règlent dans la team ; nom, création et suppression : dans les rôles CM.
  await ok(`/teams/${TEAM_CM_ID}/roles/${lie.id}`, { methode: 'PATCH', corps: { permissions: ['members.view', 'planning.view', 'planning.create'] } });
  assert.equal((await api(`/teams/${TEAM_CM_ID}/roles/${lie.id}`, { methode: 'PATCH', corps: { nom: 'Autre' } })).statut, 409);
  assert.equal((await api(`/teams/${TEAM_CM_ID}/roles`, { methode: 'POST', corps: { nom: 'Libre', permissions: [] } })).statut, 409);
  assert.equal((await api(`/teams/${TEAM_CM_ID}/roles/${lie.id}`, { methode: 'DELETE' })).statut, 409);
  // Garde-fous de la team : ni suppression, ni profil de jeu, ni onglet CM de team.
  assert.equal((await api(`/teams/${TEAM_CM_ID}`, { methode: 'DELETE' })).statut, 409);
  assert.equal((await api(`/teams/${TEAM_CM_ID}`, { methode: 'PATCH', corps: { jeu: 'valorant' } })).statut, 409);
  assert.equal((await api(`/teams/${TEAM_CM_ID}/modules`, { methode: 'PUT', corps: { modules: { cm: true } } })).statut, 409);
  await ok(`/teams/${TEAM_CM_ID}`, { methode: 'PATCH', corps: { description: 'Communication du club' } });

  // Affecter (Équipe CM, portée « club ») ajoute au CM du club ; un 2e rôle reste un rôle supplémentaire.
  await ok('/cm/affectations', { methode: 'POST', corps: { compte: 'lina0001', roleId: 'cm-role-correspondant', portee: 'club' } });
  await ok('/cm/affectations', { methode: 'POST', corps: { compte: 'lina0001', roleId: graphiste.id, portee: 'club' } });
  const membre = (await ok(`/teams/${TEAM_CM_ID}/membres`)).membres.find(m => m.compte === 'lina0001');
  assert.equal(membre.role.nom, 'Correspondant CM');
  let affs = (await ok('/cm/affectations')).affectations.filter(a => a.compte === 'lina0001');
  assert.deepEqual(affs.map(a => a.role.nom).sort(), ['Correspondant CM', 'Graphiste vidéo']);
  assert.ok((await ok('/cm/moi', { jeton: s.lina0001 })).club.includes('cm.drive.voir'), 'permissions des deux rôles');
  // Retirer l'appartenance : le rôle supplémentaire devient l'appartenance (le CM du club reste la source).
  await ok(`/cm/affectations/${affs.find(a => a.role.nom === 'Correspondant CM').id}`, { methode: 'DELETE' });
  const apres = (await ok(`/teams/${TEAM_CM_ID}/membres`)).membres.find(m => m.compte === 'lina0001');
  assert.equal(apres.role.nom, 'Graphiste vidéo');
  assert.ok(!(await b.base.premier('SELECT id FROM cm_affectations_directes WHERE compte_id = ?', ['lina0001'])));
  // Supprimer le rôle CM : ses membres quittent le CM du club, son rôle de team disparaît.
  await ok(`/cm/roles/${graphiste.id}`, { methode: 'DELETE' });
  assert.ok(!(await ok(`/teams/${TEAM_CM_ID}/membres`)).membres.some(m => m.compte === 'lina0001'));
  assert.ok(!(await ok(`/teams/${TEAM_CM_ID}/roles`)).roles.some(r => r.cmRoleId === graphiste.id));
  affs = (await ok('/cm/affectations')).affectations.filter(a => a.compte === 'lina0001');
  assert.deepEqual(affs, []);
});

test('export / import : le CM du club suit (nouveau format) ; un export antérieur à 0068 est repris (affectations « club » → membres)', async () => {
  const b = await banc();
  const f = await b.session('principal', 'Fondateur');
  await b.session('lina0001', 'Lynaoxie');
  await b.session('cor00001', 'Corentin');
  const ok = async (chemin, o = {}) => {
    const r = await b.appel(chemin, { jeton: f, methode: o.methode, corps: o.corps });
    assert.equal(r.statut, 200, `${chemin} : ${r.statut} ${JSON.stringify(r.corps)}`);
    return r.corps;
  };
  const graphiste = await ok('/cm/roles', { methode: 'POST', corps: { nom: 'Graphiste', couleur: '#22aa88', permissions: ['cm.voir'] } });
  await ok('/cm/affectations', { methode: 'POST', corps: { compte: 'lina0001', roleId: 'cm-role-responsable', portee: 'club' } });
  await ok('/cm/affectations', { methode: 'POST', corps: { compte: 'cor00001', roleId: graphiste.id, portee: 'club' } });
  const exp = await exporterBase(b.base);
  const membresCm = rows => rows.filter(m => m.team_id === TEAM_CM_ID).map(m => m.compte_id).sort();
  assert.deepEqual(membresCm(exp.tables.membres), ['cor00001', 'lina0001']);

  // Nouveau format : identique après import.
  const neuve = await baseMigree();
  await importerBase(neuve, exp);
  assert.deepEqual(await exporterBase(neuve, Date.parse(exp.exporteLe)), exp);

  // Export « ancien » : pas de CM du club, table cm_affectations avec les affectations « club ».
  const ancien = structuredClone(exp);
  const t = ancien.tables;
  const idsRoles = new Set(t.roles.filter(r => r.team_id === TEAM_CM_ID).map(r => r.id));
  t.cm_affectations = [
    ...t.cm_affectations_directes,
    ...t.membres.filter(m => m.team_id === TEAM_CM_ID).map(m => ({ id: m.id, compte_id: m.compte_id, role_id: t.roles.find(r => r.id === m.role_id).cm_role_id, portee: 'club', team_id: null, cree_par: 'principal', cree_le: m.rejoint_le })),
  ];
  delete t.cm_affectations_directes;
  t.teams = t.teams.filter(x => x.id !== TEAM_CM_ID).map(({ genre: _g, ...x }) => x);
  t.team_modules = t.team_modules.filter(x => x.team_id !== TEAM_CM_ID);
  t.role_permissions = t.role_permissions.filter(x => !idsRoles.has(x.role_id));
  t.roles = t.roles.filter(x => x.team_id !== TEAM_CM_ID).map(({ cm_role_id: _c, ...x }) => x);
  t.membres = t.membres.filter(x => x.team_id !== TEAM_CM_ID);
  const reprise = await baseMigree();
  await importerBase(reprise, ancien);
  const m = await reprise.tous('SELECT m.compte_id, r.nom FROM membres m JOIN roles r ON r.id = m.role_id WHERE m.team_id = ? ORDER BY m.compte_id', [TEAM_CM_ID]);
  assert.deepEqual(m.map(x => [x.compte_id, x.nom]), [['cor00001', 'Graphiste'], ['lina0001', 'Responsable CM']]);
  assert.deepEqual(await permissionsClubDe(reprise, 'cor00001'), ['cm.voir']);
  assert.equal(await compter(reprise, 'cm_affectations_directes'), 0);
});

test('migration 0069 : « Team CM » devient « CM du club » (nom et adresse), rien d’autre ne bouge ; un nom choisi depuis est gardé', async () => {
  const base = await fixture();
  const toutes = lireMigrations();
  await appliquerMigrations(base, toutes.filter(m => m.nom < '0069'));
  const avant = await base.premier('SELECT nom, slug FROM teams WHERE id = ?', [TEAM_CM_ID]);
  assert.deepEqual([avant.nom, avant.slug], ['Team CM', 'team-cm']);
  const membres = await base.tous('SELECT id, compte_id, role_id FROM membres WHERE team_id = ? ORDER BY id', [TEAM_CM_ID]);
  await appliquerMigrations(base, toutes);
  const apres = await base.premier('SELECT nom, slug FROM teams WHERE id = ?', [TEAM_CM_ID]);
  assert.deepEqual([apres.nom, apres.slug], ['CM du club', 'cm-du-club']);
  assert.deepEqual(await base.tous('SELECT id, compte_id, role_id FROM membres WHERE team_id = ? ORDER BY id', [TEAM_CM_ID]), membres);
  assert.equal(await compter(base, 'cm_drive_fichiers'), 1);
  // Rejouée : sans effet ; un nom choisi par le Fondateur n'est pas écrasé.
  await base.executer("UPDATE teams SET nom = 'Communication LZ0' WHERE id = ?", [TEAM_CM_ID]);
  await reprendreTeamCm(base);
  assert.equal((await base.premier('SELECT nom FROM teams WHERE id = ?', [TEAM_CM_ID])).nom, 'Communication LZ0');
});
