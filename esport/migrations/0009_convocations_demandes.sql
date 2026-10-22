-- Esport, migration 0009 : convocations explicites et demandes de compte.
--
-- SQL standard (SQLite et Postgres). Le numéro 0010 est pris par la
-- review vidéo : le migrateur accepte les trous et l'ordre de livraison.
--
-- 1. Convocations. Chaque événement porte sa liste de convoqués sous forme de
--    RÈGLE (JSON) : { groupes: ['joueurs'|'staff'|'tous'], membres: [...],
--    exclus: [...], proprietaires: [...] }. Les groupes sont résolus à la
--    lecture (un joueur arrivé plus tard est convoqué aux occurrences qui
--    suivent son arrivée) ; `membres` et `proprietaires` sont des choix
--    nominatifs, `exclus` retire quelqu'un d'un groupe. Les Propriétaires (et
--    le Fondateur) ne sont JAMAIS convoqués par un groupe : seulement cochés.
--    Une occurrence modifiée peut porter sa propre liste (planning_exceptions).
--    Voir esport/noyau/planning/convocations.mjs et docs/esport/planning.md.
ALTER TABLE planning_evenements ADD COLUMN convocation TEXT;
ALTER TABLE planning_exceptions ADD COLUMN convocation TEXT;

-- Événements existants : « toute la team » (concernes = '[]') devient « tous
-- les membres actifs SAUF les Propriétaires » (groupe « tous ») ; une liste
-- nominative est gardée telle quelle (un Propriétaire qui y figurait avait été
-- choisi, il reste convoqué).
UPDATE planning_evenements
   SET convocation = CASE
     WHEN concernes IS NULL OR concernes = '' OR concernes = '[]'
       THEN '{"groupes":["tous"],"membres":[],"exclus":[],"proprietaires":[]}'
     ELSE '{"groupes":[],"membres":' || concernes || ',"exclus":[],"proprietaires":[]}'
   END
 WHERE convocation IS NULL;

-- 2. Demandes de compte. Un membre qui a la permission `members.create` (sans
--    être le Fondateur) ne peut pas créer de compte du hub (il faut les clés
--    du Fondateur) : il dépose une DEMANDE (nom, e-mail, team, rôle ≤ au sien).
--    Le Fondateur la valide (création réelle du compte du hub, pré-
--    enregistrement dans la team, invitation) ou la refuse. L'adresse e-mail
--    n'est gardée que le temps de la décision : effacée à la validation ou au
--    refus (elle passe alors, chiffrée, dans l'Administration du Fondateur).
CREATE TABLE demandes_compte (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  role_id TEXT NOT NULL,
  demandeur_id TEXT NOT NULL,
  pseudo TEXT NOT NULL,
  pseudo_cle TEXT NOT NULL,
  email TEXT,
  poste_jeu TEXT,
  message TEXT NOT NULL DEFAULT '',
  statut TEXT NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente', 'validee', 'refusee', 'annulee')),
  compte_id TEXT,
  motif TEXT NOT NULL DEFAULT '',
  traite_par TEXT,
  traite_le TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL
);
CREATE INDEX demandes_compte_statut ON demandes_compte (statut, cree_le);
CREATE INDEX demandes_compte_demandeur ON demandes_compte (demandeur_id, cree_le);
CREATE INDEX demandes_compte_team ON demandes_compte (team_id, statut);

-- Aucun rôle système ne reçoit `members.create` (le Propriétaire a déjà tout) :
-- le Propriétaire la donne au rôle qu'il veut (Joueur compris) dans
-- Membres et rôles. Elle permet aussi d'ajouter à la team tout compte qui a
-- déjà un profil Esport : ce n'est donc jamais un défaut.
