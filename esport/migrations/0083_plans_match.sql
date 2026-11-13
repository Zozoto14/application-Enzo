-- Plans de match (module `plans_match`, section Jeu d'une team) : la préparation d'un match pour toute la team.
-- Contenu TACTIQUE : jamais envoyé à une IA externe (ia/confidentialite.mjs), jamais publié sur Discord (l'annonce
-- facultative « plan prêt » ne porte que l'adversaire, la date et un lien).
--
-- 1. `plans_match` : un plan appartient à une team. Liens facultatifs : événement du planning (`evenement_id` et
--    `occurrence`, clé de l'occurrence d'une série), fiche de scouting (`adversaire_id` ; `adversaire_nom` : nom
--    recopié ou libre), match de tournoi, résultat, événement « Review » du debrief. `date_match` : jour du match
--    (AAAA-MM-JJ, fuseau de la team) ; `debut_match` : début de l'événement lié (instant ISO). `statut` : brouillon
--    (staff seulement), prêt (toute la team, notifiée), joué. `est_modele` : modèle réutilisable (staff seulement).
--    `contenu` : JSON validé par le serveur (veto, maps : composition, strats, lineups clés, conditions, tendances,
--    calls, notes ; checklist ; notes générales). `coches` : JSON, cases cochées de la checklist.
CREATE TABLE plans_match (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  jeu TEXT NOT NULL,
  modele TEXT NOT NULL DEFAULT 'generique',
  titre TEXT NOT NULL,
  statut TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'pret', 'joue')),
  est_modele INTEGER NOT NULL DEFAULT 0,
  date_match TEXT,
  debut_match TEXT,
  evenement_id TEXT,
  occurrence TEXT,
  adversaire_id TEXT,
  adversaire_nom TEXT NOT NULL DEFAULT '',
  tournoi_match_id TEXT,
  resultat_id TEXT,
  debrief_evenement_id TEXT,
  format TEXT NOT NULL DEFAULT '' CHECK (format IN ('', 'bo1', 'bo3', 'bo5')),
  contenu TEXT NOT NULL DEFAULT '{}',
  coches TEXT NOT NULL DEFAULT '[]',
  pret_le TEXT,
  pret_par TEXT,
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  maj_par TEXT,
  maj_le TEXT NOT NULL,
  supprime_le TEXT,
  supprime_par TEXT
);
CREATE INDEX plans_match_team ON plans_match (team_id, date_match);
CREATE INDEX plans_match_evenement ON plans_match (evenement_id, occurrence);

-- 2. Module activé d'office dans les teams qui préparent déjà leurs strats ou leur planning.
INSERT INTO team_modules (team_id, module, active, config, maj_le)
  SELECT team_id, 'plans_match', 1, '{}', MAX(maj_le) FROM team_modules WHERE module IN ('strat_editor', 'planning') AND active = 1 GROUP BY team_id
  ON CONFLICT (team_id, module) DO NOTHING;

-- 3. Rôles système des teams déjà créées : toute la team lit les plans prêts ; le Manager et le Coach les préparent
--    (le Propriétaire a tout).
INSERT INTO role_permissions (role_id, permission)
  SELECT id, 'plans.voir' FROM roles WHERE systeme = 1 AND cle_systeme IN ('manager', 'coach', 'analyste', 'joueur', 'remplacant')
  ON CONFLICT (role_id, permission) DO NOTHING;
INSERT INTO role_permissions (role_id, permission)
  SELECT id, 'plans.editer' FROM roles WHERE systeme = 1 AND cle_systeme IN ('manager', 'coach')
  ON CONFLICT (role_id, permission) DO NOTHING;
