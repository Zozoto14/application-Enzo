/**
 * Le CM du club, une team (migrations 0068 et 0069, docs/esport/cm.md, « La Team CM ») : une vraie team nommée « CM du club » (`teams.genre` = « cm »), dont
 * l'appartenance active EST l'appartenance CM du club. Ses rôles sont liés aux rôles CM (`roles.cm_role_id`) : les
 * permissions CM viennent du rôle CM (vue `cm_affectations`, portée « club »), les permissions de team (planning,
 * dispos, membres…) du rôle de team. Rôles CM créés, renommés, supprimés (page Rôles et permissions) : le rôle de la
 * Team CM suit (cm/droits.mjs).
 */

/** Identifiant fixe de la Team CM (une seule par club). */
export const TEAM_CM_ID = '00000000-0000-4000-8000-00000000c0de';
export const GENRE_CM = 'cm';
/** Nom de la team (migration 0069) : l'espace « CM du club » EST la team. */
export const NOM_TEAM_CM = 'CM du club';
export const SLUG_TEAM_CM = 'cm-du-club';
/** Rôles de la Team CM liés aux deux rôles CM système. */
export const ROLES_TEAM_CM_SYSTEME = Object.freeze({ responsable: '00000000-0000-4000-8000-00000000c001', correspondant: '00000000-0000-4000-8000-00000000c002' });

/** Modules de la Team CM à sa création (les modules de jeu sont coupés ; `cm` reste coupé : la team ouvre l'espace du club). */
export const MODULES_TEAM_CM = Object.freeze(['activity_log', 'planning', 'availability', 'attendance', 'meeting_summaries', 'goals_tasks', 'discord', 'resources']);
/** Modules qui ne s'activent jamais sur la Team CM (onglet CM d'une team : la Team CM a l'espace « CM du club »). */
export const MODULES_INTERDITS_TEAM_CM = Object.freeze(['cm']);

/** Permissions de TEAM d'un rôle lié à un rôle CM : Correspondant CM et rôles créés. */
export const PERMISSIONS_TEAM_CM_BASE = Object.freeze([
  'members.view', 'planning.view', 'availability.view_all', 'availability.edit_own', 'attendance.rsvp_own',
  'meeting_summaries.submit', 'meeting_summaries.view_summary', 'goals_tasks.view', 'resources.view', 'resources.post',
]);
/** … et du Responsable CM (gestion de la team). */
export const PERMISSIONS_TEAM_CM_RESPONSABLE = Object.freeze([
  ...PERMISSIONS_TEAM_CM_BASE,
  'members.invite', 'members.assign_role', 'members.remove', 'planning.create', 'planning.update', 'planning.delete',
  'attendance.view_all', 'attendance.mark', 'meeting_summaries.view_all', 'meeting_summaries.write_summary',
  'goals_tasks.create', 'goals_tasks.update', 'goals_tasks.assign', 'discord.manage', 'resources.manage', 'activity_log.view',
]);

export const estTeamCm = team => Boolean(team) && (team.genre === GENRE_CM || team.id === TEAM_CM_ID);

/**
 * Instructions de reprise, rejouables sans effet : MÊMES instructions que les migrations 0068 puis 0069 (entre
 * « Reprise (debut) » et « Reprise (fin) », vérifié par esport/test/team-cm.test.mjs). Team CM, modules, rôles liés aux rôles CM et leurs
 * permissions de team, affectations « club » restantes changées en membres de la Team CM.
 */
export const SQL_REPRISE_TEAM_CM = Object.freeze([
  `INSERT INTO teams (id, nom, slug, jeu, description, fuseau, cree_par, cree_le, maj_le, genre)
  SELECT '00000000-0000-4000-8000-00000000c0de', 'Team CM', CASE WHEN EXISTS (SELECT 1 FROM teams WHERE slug = 'team-cm') THEN 'team-cm-club' ELSE 'team-cm' END, 'communication', 'Community management du club : contenus, réseaux, Drive, réunions.', 'Europe/Paris', 'principal', '2026-11-10T00:00:00.000Z', '2026-11-10T00:00:00.000Z', 'cm'
   WHERE NOT EXISTS (SELECT 1 FROM teams WHERE id = '00000000-0000-4000-8000-00000000c0de')`,
  `INSERT INTO team_modules (team_id, module, active, config, maj_le)
  SELECT t.id, m.module, m.active, '{}', t.cree_le FROM teams t, (SELECT 'activity_log' AS module, 1 AS active UNION ALL SELECT 'planning', 1 UNION ALL SELECT 'availability', 1 UNION ALL SELECT 'attendance', 1 UNION ALL SELECT 'meeting_summaries', 1 UNION ALL SELECT 'goals_tasks', 1 UNION ALL SELECT 'discord', 1 UNION ALL SELECT 'resources', 1 UNION ALL SELECT 'video_review', 0 UNION ALL SELECT 'scouting', 0 UNION ALL SELECT 'strat_editor', 0 UNION ALL SELECT 'playbook', 0 UNION ALL SELECT 'player_notes', 0 UNION ALL SELECT 'tournois', 0 UNION ALL SELECT 'resultats', 0 UNION ALL SELECT 'cm', 0) m
   WHERE t.id = '00000000-0000-4000-8000-00000000c0de' ON CONFLICT DO NOTHING`,
  `INSERT INTO roles (id, team_id, cle_systeme, nom, couleur, systeme, position, cree_le, maj_le, cm_role_id)
  SELECT CASE c.cle_systeme WHEN 'responsable' THEN '00000000-0000-4000-8000-00000000c001' WHEN 'correspondant' THEN '00000000-0000-4000-8000-00000000c002' ELSE c.id END, '00000000-0000-4000-8000-00000000c0de', NULL, c.nom, c.couleur, 0, c.position, c.cree_le, c.maj_le, c.id
    FROM cm_roles c WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.cm_role_id = c.id) ON CONFLICT DO NOTHING`,
  `INSERT INTO role_permissions (role_id, permission)
  SELECT r.id, p.permission FROM roles r JOIN cm_roles c ON c.id = r.cm_role_id JOIN (SELECT 'members.view' AS permission, 0 AS gestion UNION ALL SELECT 'members.invite', 1 UNION ALL SELECT 'members.assign_role', 1 UNION ALL SELECT 'members.remove', 1 UNION ALL SELECT 'planning.view', 0 UNION ALL SELECT 'planning.create', 1 UNION ALL SELECT 'planning.update', 1 UNION ALL SELECT 'planning.delete', 1 UNION ALL SELECT 'availability.view_all', 0 UNION ALL SELECT 'availability.edit_own', 0 UNION ALL SELECT 'attendance.view_all', 1 UNION ALL SELECT 'attendance.mark', 1 UNION ALL SELECT 'attendance.rsvp_own', 0 UNION ALL SELECT 'meeting_summaries.view_all', 1 UNION ALL SELECT 'meeting_summaries.submit', 0 UNION ALL SELECT 'meeting_summaries.write_summary', 1 UNION ALL SELECT 'meeting_summaries.view_summary', 0 UNION ALL SELECT 'goals_tasks.view', 0 UNION ALL SELECT 'goals_tasks.create', 1 UNION ALL SELECT 'goals_tasks.update', 1 UNION ALL SELECT 'goals_tasks.assign', 1 UNION ALL SELECT 'discord.manage', 1 UNION ALL SELECT 'resources.view', 0 UNION ALL SELECT 'resources.post', 0 UNION ALL SELECT 'resources.manage', 1 UNION ALL SELECT 'activity_log.view', 1) p ON (p.gestion = 0 OR c.cle_systeme = 'responsable')
   WHERE r.team_id = '00000000-0000-4000-8000-00000000c0de' AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = r.id) ON CONFLICT DO NOTHING`,
  `INSERT INTO membres (id, team_id, compte_id, role_id, poste_jeu, statut, rejoint_le, maj_le)
  SELECT a.id, '00000000-0000-4000-8000-00000000c0de', a.compte_id, r.id, NULL, 'actif', a.cree_le, a.cree_le
    FROM cm_affectations_directes a JOIN roles r ON r.cm_role_id = a.role_id AND r.team_id = '00000000-0000-4000-8000-00000000c0de'
   WHERE a.portee = 'club'
     AND EXISTS (SELECT 1 FROM comptes c WHERE c.id = a.compte_id)
     AND NOT EXISTS (SELECT 1 FROM membres m WHERE m.team_id = '00000000-0000-4000-8000-00000000c0de' AND m.compte_id = a.compte_id)
     AND NOT EXISTS (SELECT 1 FROM membres m2 WHERE m2.id = a.id)
     AND a.id = (SELECT a2.id FROM cm_affectations_directes a2 JOIN cm_roles c2 ON c2.id = a2.role_id WHERE a2.compte_id = a.compte_id AND a2.portee = 'club' ORDER BY c2.systeme DESC, c2.position, a2.cree_le, a2.id LIMIT 1)
  ON CONFLICT DO NOTHING`,
  `DELETE FROM cm_affectations_directes
 WHERE portee = 'club'
   AND EXISTS (SELECT 1 FROM membres m JOIN roles r ON r.id = m.role_id WHERE m.team_id = '00000000-0000-4000-8000-00000000c0de' AND m.compte_id = cm_affectations_directes.compte_id AND r.cm_role_id = cm_affectations_directes.role_id)`,
  `UPDATE teams SET nom = 'CM du club', slug = CASE WHEN EXISTS (SELECT 1 FROM teams x WHERE x.slug = 'cm-du-club' AND x.id <> '00000000-0000-4000-8000-00000000c0de') THEN slug ELSE 'cm-du-club' END WHERE id = '00000000-0000-4000-8000-00000000c0de' AND nom = 'Team CM'`
]);

/** Rejoue la reprise (import d'un export antérieur à la migration 0068, réparation). */
export async function reprendreTeamCm(base) {
  for (const sql of SQL_REPRISE_TEAM_CM) await base.executer(sql, []);
}

/** Rôle de la Team CM lié à un rôle CM (null s'il n'existe pas). */
export async function roleTeamCm(base, cmRoleId) {
  return base.premier('SELECT * FROM roles WHERE team_id = ? AND cm_role_id = ?', [TEAM_CM_ID, cmRoleId]);
}

/** Appartenance d'un compte à la Team CM (null sinon). */
export async function membreTeamCm(base, compte) {
  return base.premier('SELECT m.*, r.cm_role_id FROM membres m JOIN roles r ON r.id = m.role_id WHERE m.team_id = ? AND m.compte_id = ?', [TEAM_CM_ID, compte]);
}
