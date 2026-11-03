-- Esport, migration 0043 : rangement des modèles de visuels PAR DÉFAUT dans les dossiers (docs/esport/visuels.md,
-- partie « Dossiers »).
--
-- Les 11 modèles par défaut sont dans le code de l'app : ils ne sont pas des lignes de `cm_modeles` et ne changent
-- jamais. Leur RANGEMENT est un choix d'organisation du club : `cm_visuels_defauts` retient, par portée (club ou
-- team) et par type de modèle (`annonce`, `resultat`…), le dossier où le club l'a rangé. Pas de ligne : le modèle
-- est à sa place d'origine (racine, en tête de l'onglet Modèles). « Réinitialiser le rangement » supprime les
-- lignes de la portée. Pas de clé étrangère sur le dossier (comme 0041) : un dossier disparu vaut la racine.
--
-- SQL standard (PostgreSQL et SQLite), mêmes conventions que 0041.

CREATE TABLE cm_visuels_defauts (
  portee TEXT NOT NULL,
  type TEXT NOT NULL,
  team_id TEXT REFERENCES teams (id) ON DELETE CASCADE,
  dossier_id TEXT NOT NULL,
  maj_par TEXT,
  maj_le TEXT NOT NULL,
  PRIMARY KEY (portee, type)
);
CREATE INDEX cm_visuels_defauts_dossier ON cm_visuels_defauts (dossier_id);
