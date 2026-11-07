-- Esport, migration 0062 : disponibilités semaine par semaine (docs/esport/planning.md, « Semaine par semaine »).
--
-- Demande du Fondateur : « une option pour qu'un membre puisse faire semaine par semaine son planning car il a un
-- planning différent entre chaque semaine ».
--
-- Les créneaux récurrents (`dispo_regles`) restent le MODÈLE. Une ligne ici PERSONNALISE une semaine (du lundi au
-- dimanche) d'un membre : ses `regles` (JSON, même forme que `dispo_regles` : jour ISO, début, fin, type, heures
-- murales dans `fuseau`) remplacent le modèle pour ces sept jours. Une liste vide = indisponible toute la semaine.
-- Sans ligne, la semaine suit le modèle.
--
-- `semaine` : lundi « AAAA-MM-JJ » (date murale dans `fuseau`) ; `version` : verrou optimiste (409 si une autre
-- écriture est passée entre-temps). Le cron efface les semaines finies depuis plus de 8 semaines.
--
-- SQL standard (PostgreSQL et SQLite).

CREATE TABLE dispo_semaines (
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  compte_id TEXT NOT NULL,
  semaine TEXT NOT NULL,
  regles TEXT NOT NULL DEFAULT '[]',
  fuseau TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  maj_le TEXT NOT NULL,
  maj_par TEXT,
  PRIMARY KEY (team_id, compte_id, semaine)
);
CREATE INDEX dispo_semaines_semaine ON dispo_semaines (semaine);
