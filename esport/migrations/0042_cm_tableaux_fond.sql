-- Esport, migration 0042 : tableaux CM façon Trello (docs/esport/cm.md).
--
--  - `cm_tableaux.fond` : fond du tableau, JSON `{ "genre": "couleur" | "degrade", "cle": "…" }` (teintes prédéfinies)
--    ou `{ "genre": "image" }` avec `fond_fichier_id` (image importée ou prise dans le Drive, `cm_fichiers`) ;
--    NULL : fond par défaut du thème ;
--  - `cm_preferences` : choix d'affichage mémorisés par compte (colonnes réduites d'un tableau, calendriers des
--    teams affichés dans le calendrier éditorial). Rien de partagé : chaque compte ne lit que les siens.
--
-- SQL standard (SQLite et PostgreSQL), mêmes conventions que 0001.
ALTER TABLE cm_tableaux ADD COLUMN fond TEXT;
ALTER TABLE cm_tableaux ADD COLUMN fond_fichier_id TEXT;

CREATE TABLE cm_preferences (
  compte_id TEXT NOT NULL,
  cle TEXT NOT NULL,
  valeur TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  PRIMARY KEY (compte_id, cle)
);
