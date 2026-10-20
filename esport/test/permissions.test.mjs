/**
 * Permissions pures : catalogue, matrice rôle × action des rôles système,
 * anti-escalade, presets de modules.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GROUPES,
  MODULES,
  PRESETS,
  ROLES_SYSTEME,
  TOUTES_PERMISSIONS,
  autorise,
  matrice,
  moduleDePermission,
  modulesDuPreset,
  peutAccorder,
  permissionsEffectives,
  permissionsManquantes,
  permissionsRoleSysteme,
  validerPermissions,
} from '../noyau/permissions.mjs';

test('catalogue : permissions uniques, de la forme module.action, modules connus', () => {
  assert.equal(new Set(TOUTES_PERMISSIONS).size, TOUTES_PERMISSIONS.length);
  for (const p of TOUTES_PERMISSIONS) assert.match(p, /^[a-z_]+\.[a-z_]+$/);
  for (const g of GROUPES) if (g.module) assert.ok(MODULES.includes(g.module), g.module);
  // Les clés citées par le plan existent.
  for (const p of ['team.manage', 'team.delete', 'modules.manage', 'members.invite', 'roles.manage', 'meeting_summaries.write_summary', 'activity_log.view', 'strats.view']) {
    assert.ok(TOUTES_PERMISSIONS.includes(p), p);
  }
  for (const r of ROLES_SYSTEME) for (const p of permissionsRoleSysteme(r.cle)) assert.ok(TOUTES_PERMISSIONS.includes(p), `${r.cle} : ${p}`);
});

// Matrice rôle × action, telle que décrite dans le plan (4.1) : pour chaque rôle système, les actions
// PERMISES parmi `ACTIONS` ; toutes les autres doivent être refusées.
const ACTIONS = [
  'team.manage', 'team.delete', 'modules.manage',
  'members.view', 'members.invite', 'members.assign_role', 'members.remove', 'roles.manage',
  'planning.view', 'planning.create', 'planning.delete',
  'availability.edit_own', 'attendance.mark', 'attendance.rsvp_own',
  'meeting_summaries.submit', 'meeting_summaries.view_all', 'meeting_summaries.write_summary',
  'video_review.view', 'video_review.create', 'video_review.annotate',
  'strats.create', 'playbook.view', 'playbook.manage', 'scouting.view', 'scouting.manage',
  'goals_tasks.assign', 'discord.manage', 'activity_log.view',
];
const PERMISES = {
  proprietaire: ACTIONS,
  manager: [
    'team.manage', 'members.view', 'members.invite', 'members.assign_role', 'members.remove', 'roles.manage',
    'planning.view', 'planning.create', 'planning.delete', 'availability.edit_own', 'attendance.mark', 'attendance.rsvp_own',
    'meeting_summaries.submit', 'meeting_summaries.view_all', 'video_review.view', 'playbook.view', 'scouting.view',
    'discord.manage', 'activity_log.view',
  ],
  coach: [
    'members.view', 'planning.view', 'planning.create', 'planning.delete', 'availability.edit_own', 'attendance.mark', 'attendance.rsvp_own',
    'meeting_summaries.submit', 'video_review.view', 'video_review.create', 'video_review.annotate', 'strats.create',
    'playbook.view', 'playbook.manage', 'scouting.view', 'scouting.manage', 'goals_tasks.assign',
  ],
  analyste: [
    'members.view', 'planning.view', 'availability.edit_own', 'attendance.rsvp_own', 'meeting_summaries.submit',
    'video_review.view', 'video_review.create', 'video_review.annotate', 'strats.create', 'playbook.view', 'playbook.manage',
    'scouting.view', 'scouting.manage',
  ],
  joueur: ['members.view', 'planning.view', 'availability.edit_own', 'attendance.rsvp_own', 'meeting_summaries.submit', 'video_review.view', 'video_review.annotate', 'playbook.view'],
  remplacant: ['members.view', 'planning.view', 'attendance.rsvp_own', 'playbook.view'],
};

test('matrice rôle × action des rôles système', () => {
  const tousModules = new Set(MODULES);
  assert.deepEqual(Object.keys(PERMISES).sort(), ROLES_SYSTEME.map(r => r.cle).sort());
  for (const [cle, permises] of Object.entries(PERMISES)) {
    const perms = permissionsEffectives({ membre: { statut: 'actif' }, role: { cle_systeme: cle }, permissionsRole: permissionsRoleSysteme(cle) });
    for (const action of ACTIONS) assert.equal(autorise(perms, tousModules, action), permises.includes(action), `${cle} × ${action}`);
  }
  // Résumés : seuls les rôles qui ont write_summary (par défaut le Propriétaire) les rédigent.
  assert.deepEqual(ROLES_SYSTEME.filter(r => permissionsRoleSysteme(r.cle).includes('meeting_summaries.write_summary')).map(r => r.cle), ['proprietaire']);
});

test('Propriétaire et super admin : toutes les permissions ; suspendu ou absent : aucune', () => {
  const proprio = permissionsEffectives({ membre: { statut: 'actif' }, role: { cle_systeme: 'proprietaire' }, permissionsRole: [] });
  assert.equal(proprio.size, TOUTES_PERMISSIONS.length);
  assert.equal(permissionsEffectives({ superAdmin: true }).size, TOUTES_PERMISSIONS.length);
  assert.equal(permissionsEffectives({ membre: { statut: 'suspendu' }, role: { cle_systeme: 'proprietaire' } }).size, 0);
  assert.equal(permissionsEffectives({}).size, 0);
});

test('module désactivé : ses permissions ne valent plus ; le cœur (team, membres) toujours', () => {
  const perms = new Set(['planning.view', 'members.view', 'activity_log.view']);
  const actifs = new Set(['activity_log']);
  assert.equal(moduleDePermission('planning.view'), 'planning');
  assert.equal(moduleDePermission('members.view'), null);
  assert.equal(autorise(perms, actifs, 'planning.view'), false);
  assert.equal(autorise(perms, actifs, 'members.view'), true);
  assert.equal(autorise(perms, actifs, 'activity_log.view'), true);
});

test('anti-escalade : on n’accorde que ce que l’on a', () => {
  const manager = new Set(permissionsRoleSysteme('manager'));
  assert.equal(peutAccorder(manager, ['planning.view', 'members.invite']), true);
  assert.equal(peutAccorder(manager, ['planning.view', 'team.delete']), false);
  assert.deepEqual(permissionsManquantes(manager, ['team.delete', 'modules.manage', 'planning.view']), ['team.delete', 'modules.manage']);
  // Le rôle Propriétaire entier ne peut pas être accordé par un Manager.
  assert.equal(peutAccorder(manager, permissionsRoleSysteme('proprietaire')), false);
});

test('validation des permissions : inconnues refusées, doublons retirés', () => {
  assert.deepEqual(validerPermissions(['planning.view', 'planning.view', 'members.view']), ['members.view', 'planning.view']);
  assert.throws(() => validerPermissions(['planning.view', 'finances.voir']));
  assert.throws(() => validerPermissions('planning.view'));
});

test('presets : Team Valorant complète, Minimal, Personnalisé', () => {
  assert.deepEqual(PRESETS.map(p => p.nom), ['Team Valorant complète', 'Minimal', 'Personnalisé']);
  assert.deepEqual(new Set(modulesDuPreset('valorant_complet')), new Set(MODULES));
  assert.deepEqual(modulesDuPreset('minimal'), ['activity_log', 'planning', 'availability']);
  assert.deepEqual(modulesDuPreset('personnalise', ['scouting', 'inconnu', 'scouting']), ['scouting']);
  assert.equal(modulesDuPreset('nimporte'), undefined);
});

test('matrice d’affichage : lignes par groupe, cases cochées', () => {
  const m = matrice(['planning.view', 'members.view']);
  const planning = m.find(l => l.groupe === 'planning');
  assert.equal(planning.cases.find(c => c.cle === 'planning.view').coche, true);
  assert.equal(planning.cases.find(c => c.cle === 'planning.create').coche, false);
  assert.equal(m.length, GROUPES.length);
});
