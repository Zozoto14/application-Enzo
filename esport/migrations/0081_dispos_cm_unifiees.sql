-- Esport, migration 0081 : une seule source de disponibilités pour l'équipe CM (docs/esport/cm-reunions.md,
-- « Disponibilités », et docs/esport/planning.md).
--
-- Demande du Fondateur : « Deux Disponibilités — synchronise-les au même endroit dans Équipe CM. » L'espace CM avait
-- les disponibilités de la team « CM du club » (module Disponibilités : semaine type `dispo_regles`, semaines
-- personnalisées `dispo_semaines`, exceptions datées `dispo_exceptions`) ET celles des Réunions (`cm_dispo_regles`,
-- `cm_dispo_exceptions`, migration 0039). Le modèle des teams devient la SEULE source : les Réunions (grille de
-- l'équipe, « Trouver un créneau », statut automatique « absent ») lisent et écrivent les tables `dispo_*` de la team
-- CM du club (identifiant fixe 00000000-0000-4000-8000-00000000c0de), semaines personnalisées comprises.
--
-- Reprise, sans perte :
--  1. `dispo_exceptions.motif` : NULL, « absence » ou « conge » (une absence ou un congé des Réunions devient une
--     exception « indisponible » avec ce motif ; « disponible en plus » reste « disponible »).
--  2. Semaine type : un compte qui n'en avait qu'une (Réunions OU team) la garde. S'il avait les deux, la plus
--     récemment enregistrée devient la semaine type ; l'autre est gardée dans `dispo_regles_reprises` (origine
--     « reunions_cm » ou « planning », date de reprise), exportée (RGPD, export de la base) et effacée avec le compte.
--  3. Exceptions des Réunions → `dispo_exceptions` de la team CM du club (mêmes identifiants, mêmes instants).
--  4. Les tables `cm_dispo_regles` et `cm_dispo_exceptions` disparaissent.
-- L'import d'un export antérieur fait la même reprise (esport/noyau/transfert.mjs, `reprendreDisposCm`).
-- SQL standard (PostgreSQL et SQLite).

ALTER TABLE dispo_exceptions ADD COLUMN motif TEXT CHECK (motif IS NULL OR motif IN ('absence', 'conge'));

CREATE TABLE dispo_regles_reprises (
  id TEXT PRIMARY KEY,
  compte_id TEXT NOT NULL,
  jour INTEGER NOT NULL,
  debut TEXT NOT NULL,
  fin TEXT NOT NULL,
  type TEXT NOT NULL,
  fuseau TEXT NOT NULL,
  cree_le TEXT NOT NULL,
  origine TEXT NOT NULL CHECK (origine IN ('reunions_cm', 'planning')),
  repris_le TEXT NOT NULL
);
CREATE INDEX dispo_regles_reprises_compte ON dispo_regles_reprises (compte_id);

-- 2a. Semaine type de la team plus ancienne que celle des Réunions : gardée à part, puis retirée.
INSERT INTO dispo_regles_reprises (id, compte_id, jour, debut, fin, type, fuseau, cree_le, origine, repris_le)
  SELECT d.id, d.compte_id, d.jour, d.debut, d.fin, d.type, d.fuseau, d.cree_le, 'planning', '2026-11-12T00:00:00.000Z'
    FROM dispo_regles d
   WHERE d.team_id = '00000000-0000-4000-8000-00000000c0de'
     AND (SELECT MAX(c.cree_le) FROM cm_dispo_regles c WHERE c.compte_id = d.compte_id)
       > (SELECT MAX(d2.cree_le) FROM dispo_regles d2 WHERE d2.team_id = '00000000-0000-4000-8000-00000000c0de' AND d2.compte_id = d.compte_id);
DELETE FROM dispo_regles
 WHERE team_id = '00000000-0000-4000-8000-00000000c0de'
   AND id IN (SELECT id FROM dispo_regles_reprises WHERE origine = 'planning');

-- 2b. Semaine type des Réunions d'un compte qui garde celle de la team (plus récente) : gardée à part.
INSERT INTO dispo_regles_reprises (id, compte_id, jour, debut, fin, type, fuseau, cree_le, origine, repris_le)
  SELECT c.id, c.compte_id, c.jour, c.debut, c.fin, c.type, c.fuseau, c.cree_le, 'reunions_cm', '2026-11-12T00:00:00.000Z'
    FROM cm_dispo_regles c
   WHERE EXISTS (SELECT 1 FROM dispo_regles d WHERE d.team_id = '00000000-0000-4000-8000-00000000c0de' AND d.compte_id = c.compte_id)
      OR NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = '00000000-0000-4000-8000-00000000c0de')
      OR EXISTS (SELECT 1 FROM dispo_regles d3 WHERE d3.id = c.id);

-- 2c. Les autres deviennent la semaine type de la team CM du club.
INSERT INTO dispo_regles (id, team_id, compte_id, jour, debut, fin, type, fuseau, cree_le)
  SELECT c.id, t.id, c.compte_id, c.jour, c.debut, c.fin, c.type, c.fuseau, c.cree_le
    FROM cm_dispo_regles c JOIN teams t ON t.id = '00000000-0000-4000-8000-00000000c0de'
   WHERE NOT EXISTS (SELECT 1 FROM dispo_regles_reprises r WHERE r.id = c.id);

-- 3. Absences, congés, « disponible en plus ».
INSERT INTO dispo_exceptions (id, team_id, compte_id, debut, fin, type, note, cree_le, motif)
  SELECT x.id, t.id, x.compte_id, x.debut, x.fin,
         CASE WHEN x.type = 'disponible' THEN 'disponible' ELSE 'indisponible' END,
         x.note, x.cree_le,
         CASE WHEN x.type IN ('absence', 'conge') THEN x.type ELSE NULL END
    FROM cm_dispo_exceptions x JOIN teams t ON t.id = '00000000-0000-4000-8000-00000000c0de'
   WHERE NOT EXISTS (SELECT 1 FROM dispo_exceptions d WHERE d.id = x.id);

-- 4. Plus de doublon.
DROP TABLE cm_dispo_regles;
DROP TABLE cm_dispo_exceptions;
