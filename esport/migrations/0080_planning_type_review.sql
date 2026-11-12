-- @reconstruction
-- Esport, migration 0080 : type d'événement « Review » au planning de toutes les teams (docs/esport/planning.md).
--
-- Demande du Fondateur : « Tu n'as pas ajouté le type Review dans les teams compétitives. » La valeur 'review' rejoint
-- la contrainte CHECK de `planning_evenements.type` (scrim, match, training, meeting, tournament, other).
--
-- Une contrainte CHECK ne se modifie pas de la même façon dans les deux moteurs (sections `-- @dialecte`,
-- esport/noyau/migrations.mjs) :
--  - PostgreSQL : la contrainte de la colonne (nommée par PostgreSQL, en principe `planning_evenements_type_check` :
--    on la retrouve dans pg_constraint plutôt que de supposer son nom) est retirée puis remise avec 'review',
--    `NOT VALID` puis `VALIDATE CONSTRAINT` (lignes existantes vérifiées sans réécrire la table). Toute la migration
--    passe dans une seule transaction (DDL transactionnel) ; aucune ligne n'est touchée.
--  - SQLite : la table est RECONSTRUITE (procédure officielle en 12 étapes). Le marqueur `@reconstruction` fait
--    exécuter ce fichier clés étrangères COUPÉES (réglage posé hors transaction), dans une transaction, puis
--    vérifie les clés étrangères avant de valider (adaptateurs/sqlite.mjs, `scriptReconstruction`) : le DROP TABLE de
--    l'ancienne table ne fait donc jouer AUCUN `ON DELETE CASCADE` (présences, exceptions des séries). Toutes les
--    colonnes (convocation de la migration 0009 comprise) et toutes les lignes sont copiées, les index recréés ; la
--    table n'a ni déclencheur ni vue qui la lise. Les tables filles (`presences`, `planning_exceptions`) gardent leur
--    clé étrangère vers `planning_evenements` (même nom, mêmes identifiants).
-- Rejouable : la migration est inscrite dans `migrations_esport` une fois passée.

-- @dialecte postgres
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'planning_evenements'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%type%' AND pg_get_constraintdef(oid) LIKE '%tournament%'
  LOOP
    EXECUTE format('ALTER TABLE planning_evenements DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE planning_evenements ADD CONSTRAINT planning_evenements_type_check
  CHECK (type IN ('scrim', 'match', 'training', 'meeting', 'tournament', 'review', 'other')) NOT VALID;
ALTER TABLE planning_evenements VALIDATE CONSTRAINT planning_evenements_type_check;

-- @dialecte sqlite
CREATE TABLE planning_evenements_v79 (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('scrim', 'match', 'training', 'meeting', 'tournament', 'review', 'other')),
  titre TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  debut TEXT NOT NULL,
  fin TEXT NOT NULL,
  fuseau TEXT NOT NULL,
  lieu TEXT NOT NULL DEFAULT '',
  adversaire_id TEXT,
  review_id TEXT,
  recurrence TEXT,
  fin_serie TEXT,
  concernes TEXT NOT NULL DEFAULT '[]',
  cree_par TEXT NOT NULL,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  supprime_le TEXT,
  convocation TEXT
);
INSERT INTO planning_evenements_v79 (id, team_id, type, titre, description, debut, fin, fuseau, lieu, adversaire_id, review_id, recurrence, fin_serie, concernes, cree_par, cree_le, maj_le, supprime_le, convocation)
  SELECT id, team_id, type, titre, description, debut, fin, fuseau, lieu, adversaire_id, review_id, recurrence, fin_serie, concernes, cree_par, cree_le, maj_le, supprime_le, convocation FROM planning_evenements;
DROP TABLE planning_evenements;
ALTER TABLE planning_evenements_v79 RENAME TO planning_evenements;
CREATE INDEX planning_evenements_team ON planning_evenements (team_id, debut);
CREATE INDEX planning_evenements_adversaire ON planning_evenements (team_id, adversaire_id);
