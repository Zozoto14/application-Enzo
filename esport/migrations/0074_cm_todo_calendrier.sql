-- Esport, migration 0074 : « To do » du Dashboard, cartes favorites, cartes au calendrier CM, type de réunion Review
-- (docs/esport/cm.md, parties « To do », « Favoris » et « Cartes au calendrier »).
--
-- 1. Type de réunion « Review » (réunions des teams, `types_reunion`) : type GLOBAL (team_id NULL) proposé à toutes les
--    teams, comme Hebdo, Mensuel, Débrief de match, Staff et Autre ; rangé avant « Autre ». Pas ajouté si un type global
--    « Review » existe déjà (créé à la main par le Fondateur).
-- 2. `cm_carte_favoris` : cartes mises en favori (étoile) PAR COMPTE ; le To do du Dashboard les montre en tête. Une
--    carte d'un tableau que le compte ne voit plus (restreint) n'est jamais rendue. Pas de clé étrangère vers `comptes`
--    (effacement RGPD par le serveur, comme le reste du CM).
-- 3. `cm_tableaux.calendrier` : 1 (défaut, tous les tableaux existants) = les cartes datées du tableau (échéance) sont
--    au calendrier du CM ; 0 = jamais. Réglage partagé du tableau (cm.gerer).
-- 4. `cm_cartes.echeance_duree` : durée facultative (minutes) de l'échéance, pour le calendrier ; NULL = ponctuelle.
--    Le réglage du To do (tableaux choisis, cartes assignées / favorites) est une préférence du compte
--    (`cm_preferences`, clé `todo.dashboard`).
--
-- SQL standard (PostgreSQL et SQLite).

INSERT INTO types_reunion (id, team_id, nom, couleur, visibilite, position, cree_le, maj_le)
  SELECT '00000000-0000-4000-8000-000000000006', NULL, 'Review', '#0d9488', 'team', 5, '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z'
   WHERE NOT EXISTS (SELECT 1 FROM types_reunion WHERE team_id IS NULL AND nom = 'Review' AND supprime_le IS NULL);
UPDATE types_reunion SET position = 6 WHERE id = '00000000-0000-4000-8000-000000000005' AND position = 5;

CREATE TABLE cm_carte_favoris (
  carte_id TEXT NOT NULL REFERENCES cm_cartes (id) ON DELETE CASCADE,
  compte_id TEXT NOT NULL,
  cree_le TEXT NOT NULL,
  PRIMARY KEY (carte_id, compte_id)
);
CREATE INDEX cm_carte_favoris_compte ON cm_carte_favoris (compte_id);

ALTER TABLE cm_tableaux ADD COLUMN calendrier INTEGER NOT NULL DEFAULT 1;
ALTER TABLE cm_cartes ADD COLUMN echeance_duree INTEGER;
CREATE INDEX cm_cartes_echeance ON cm_cartes (tableau_id, echeance);
