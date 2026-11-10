-- Esport, migration 0068 : la Team CM devient une vraie team (docs/esport/cm.md, « La Team CM »).
--
-- `teams.genre` : « jeu » (défaut, toutes les teams existantes) ou « cm » (la Team CM : une seule, identifiant fixe
-- 00000000-0000-4000-8000-00000000c0de, profil « communication », pas de profil de jeu). Elle apparaît dans la page
-- Teams, le Dashboard, Membres, le Trombinoscope, le planning, Discord… comme les autres. Modules activés : journal,
-- planning, disponibilités, présence, réunions (résumés), objectifs, Discord, ressources ; coupés : review, scouting,
-- strats, playbook, suivi, tournois, résultats et l'onglet CM d'une team (la Team CM ouvre l'espace « CM du club »).
--
-- `roles.cm_role_id` : un rôle de la Team CM est lié à un rôle CM (`cm_roles`) : Responsable CM, Correspondant CM et
-- ceux que le Fondateur a créés. Ses permissions CM (cm.*, Drive, réunions, sponsors, trombinoscope) restent celles du
-- rôle CM (page Rôles et permissions) ; ses permissions de TEAM (planning, dispos, membres…) sont celles du rôle de team.
--
-- SOURCE UNIQUE : l'appartenance CM du club EST l'appartenance (active) à la Team CM. Les affectations « club »
-- existantes deviennent des membres de la Team CM (même identifiant, même date, rôle lié au rôle CM). Un compte qui
-- avait PLUSIEURS rôles CM du club garde le premier (Responsable, puis Correspondant, puis les autres) comme rôle de
-- team ; les autres restent des « rôles CM supplémentaires » (aucune permission perdue). La table devient
-- `cm_affectations_directes` (correspondants d'une team, rôles supplémentaires) et `cm_affectations` une VUE qui
-- ajoute les membres actifs de la Team CM (portée « club ») : tous les contrôles existants (espace CM du club,
-- tableaux restreints 0046, ressources 0048, réunions, tickets, badges) lisent la même chose qu'avant.
-- Le Drive CM du club (portée « club ») est le Drive de la Team CM : aucun fichier ne bouge.
--
-- Rejouable sans effet (INSERT … WHERE NOT EXISTS, ON CONFLICT DO NOTHING) ; les mêmes instructions de reprise sont
-- dans esport/noyau/cm/teamCm.mjs (import d'un export antérieur). SQL standard (PostgreSQL et SQLite).

ALTER TABLE teams ADD COLUMN genre TEXT NOT NULL DEFAULT 'jeu';
ALTER TABLE roles ADD COLUMN cm_role_id TEXT;
CREATE INDEX roles_cm_role ON roles (cm_role_id);

DROP VIEW permissions_club;
ALTER TABLE cm_affectations RENAME TO cm_affectations_directes;

-- Reprise (debut)
INSERT INTO teams (id, nom, slug, jeu, description, fuseau, cree_par, cree_le, maj_le, genre)
  SELECT '00000000-0000-4000-8000-00000000c0de', 'Team CM', CASE WHEN EXISTS (SELECT 1 FROM teams WHERE slug = 'team-cm') THEN 'team-cm-club' ELSE 'team-cm' END, 'communication', 'Community management du club : contenus, réseaux, Drive, réunions.', 'Europe/Paris', 'principal', '2026-11-10T00:00:00.000Z', '2026-11-10T00:00:00.000Z', 'cm'
   WHERE NOT EXISTS (SELECT 1 FROM teams WHERE id = '00000000-0000-4000-8000-00000000c0de');
INSERT INTO team_modules (team_id, module, active, config, maj_le)
  SELECT t.id, m.module, m.active, '{}', t.cree_le FROM teams t, (SELECT 'activity_log' AS module, 1 AS active UNION ALL SELECT 'planning', 1 UNION ALL SELECT 'availability', 1 UNION ALL SELECT 'attendance', 1 UNION ALL SELECT 'meeting_summaries', 1 UNION ALL SELECT 'goals_tasks', 1 UNION ALL SELECT 'discord', 1 UNION ALL SELECT 'resources', 1 UNION ALL SELECT 'video_review', 0 UNION ALL SELECT 'scouting', 0 UNION ALL SELECT 'strat_editor', 0 UNION ALL SELECT 'playbook', 0 UNION ALL SELECT 'player_notes', 0 UNION ALL SELECT 'tournois', 0 UNION ALL SELECT 'resultats', 0 UNION ALL SELECT 'cm', 0) m
   WHERE t.id = '00000000-0000-4000-8000-00000000c0de' ON CONFLICT DO NOTHING;
INSERT INTO roles (id, team_id, cle_systeme, nom, couleur, systeme, position, cree_le, maj_le, cm_role_id)
  SELECT CASE c.cle_systeme WHEN 'responsable' THEN '00000000-0000-4000-8000-00000000c001' WHEN 'correspondant' THEN '00000000-0000-4000-8000-00000000c002' ELSE c.id END, '00000000-0000-4000-8000-00000000c0de', NULL, c.nom, c.couleur, 0, c.position, c.cree_le, c.maj_le, c.id
    FROM cm_roles c WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.cm_role_id = c.id) ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission)
  SELECT r.id, p.permission FROM roles r JOIN cm_roles c ON c.id = r.cm_role_id JOIN (SELECT 'members.view' AS permission, 0 AS gestion UNION ALL SELECT 'members.invite', 1 UNION ALL SELECT 'members.assign_role', 1 UNION ALL SELECT 'members.remove', 1 UNION ALL SELECT 'planning.view', 0 UNION ALL SELECT 'planning.create', 1 UNION ALL SELECT 'planning.update', 1 UNION ALL SELECT 'planning.delete', 1 UNION ALL SELECT 'availability.view_all', 0 UNION ALL SELECT 'availability.edit_own', 0 UNION ALL SELECT 'attendance.view_all', 1 UNION ALL SELECT 'attendance.mark', 1 UNION ALL SELECT 'attendance.rsvp_own', 0 UNION ALL SELECT 'meeting_summaries.view_all', 1 UNION ALL SELECT 'meeting_summaries.submit', 0 UNION ALL SELECT 'meeting_summaries.write_summary', 1 UNION ALL SELECT 'meeting_summaries.view_summary', 0 UNION ALL SELECT 'goals_tasks.view', 0 UNION ALL SELECT 'goals_tasks.create', 1 UNION ALL SELECT 'goals_tasks.update', 1 UNION ALL SELECT 'goals_tasks.assign', 1 UNION ALL SELECT 'discord.manage', 1 UNION ALL SELECT 'resources.view', 0 UNION ALL SELECT 'resources.post', 0 UNION ALL SELECT 'resources.manage', 1 UNION ALL SELECT 'activity_log.view', 1) p ON (p.gestion = 0 OR c.cle_systeme = 'responsable')
   WHERE r.team_id = '00000000-0000-4000-8000-00000000c0de' AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = r.id) ON CONFLICT DO NOTHING;
INSERT INTO membres (id, team_id, compte_id, role_id, poste_jeu, statut, rejoint_le, maj_le)
  SELECT a.id, '00000000-0000-4000-8000-00000000c0de', a.compte_id, r.id, NULL, 'actif', a.cree_le, a.cree_le
    FROM cm_affectations_directes a JOIN roles r ON r.cm_role_id = a.role_id AND r.team_id = '00000000-0000-4000-8000-00000000c0de'
   WHERE a.portee = 'club'
     AND EXISTS (SELECT 1 FROM comptes c WHERE c.id = a.compte_id)
     AND NOT EXISTS (SELECT 1 FROM membres m WHERE m.team_id = '00000000-0000-4000-8000-00000000c0de' AND m.compte_id = a.compte_id)
     AND NOT EXISTS (SELECT 1 FROM membres m2 WHERE m2.id = a.id)
     AND a.id = (SELECT a2.id FROM cm_affectations_directes a2 JOIN cm_roles c2 ON c2.id = a2.role_id WHERE a2.compte_id = a.compte_id AND a2.portee = 'club' ORDER BY c2.systeme DESC, c2.position, a2.cree_le, a2.id LIMIT 1)
  ON CONFLICT DO NOTHING;
DELETE FROM cm_affectations_directes
 WHERE portee = 'club'
   AND EXISTS (SELECT 1 FROM membres m JOIN roles r ON r.id = m.role_id WHERE m.team_id = '00000000-0000-4000-8000-00000000c0de' AND m.compte_id = cm_affectations_directes.compte_id AND r.cm_role_id = cm_affectations_directes.role_id);
-- Reprise (fin)

CREATE VIEW cm_affectations AS
  SELECT id, compte_id, role_id, portee, team_id, cree_par, cree_le FROM cm_affectations_directes
  UNION ALL
  SELECT m.id AS id, m.compte_id AS compte_id, r.cm_role_id AS role_id, 'club' AS portee, NULL AS team_id, NULL AS cree_par, m.rejoint_le AS cree_le
    FROM membres m JOIN teams t ON t.id = m.team_id AND t.genre = 'cm' AND t.supprimee_le IS NULL JOIN roles r ON r.id = m.role_id
   WHERE m.statut = 'actif' AND r.cm_role_id IS NOT NULL;

CREATE VIEW permissions_club AS
  SELECT a.compte_id AS compte_id, rp.permission AS permission
    FROM cm_affectations a JOIN cm_role_permissions rp ON rp.role_id = a.role_id WHERE a.portee = 'club'
  UNION
  SELECT g.compte_id AS compte_id, gp.permission AS permission
    FROM roles_globaux_affectations g JOIN roles_globaux_permissions gp ON gp.role_id = g.role_id
  UNION
  SELECT compte_id, permission FROM permissions_globales;
