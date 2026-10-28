-- Esport, migration 0029 : étiquettes des tableaux CM modifiables et supprimables (docs/esport/cm.md).
--
-- Renommer, recolorer, fusionner ou supprimer une étiquette, y compris une étiquette importée de Trello.
-- Relancer l'import Trello ne doit pas défaire ces choix :
--  - `modifie_le` : posé quand l'étiquette est renommée ou recolorée dans l'app ; l'import ne touche plus à son
--    nom ni à sa couleur ;
--  - `cm_etiquettes_retirees` : étiquettes Trello supprimées (ou fusionnées dans une autre) dans l'app ; l'import
--    ne les recrée pas.
--
-- SQL standard (SQLite et PostgreSQL), mêmes conventions que 0001.
ALTER TABLE cm_etiquettes ADD COLUMN modifie_le TEXT;

CREATE TABLE cm_etiquettes_retirees (
  tableau_id TEXT NOT NULL REFERENCES cm_tableaux (id) ON DELETE CASCADE,
  trello_id TEXT NOT NULL,
  PRIMARY KEY (tableau_id, trello_id)
);
