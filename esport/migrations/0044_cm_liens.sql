-- Esport, migration 0044 : liens utiles de l'équipe CM (onglet DATA › Ressources de l'espace CM, docs/esport/cm.md).
--
-- Une ligne = un lien web (https) rangé par le CM du club : titre, adresse validée côté serveur, domaine d'aperçu
-- (`hote`, sans « www. » ; aucune image externe n'est jamais chargée), description, étiquette libre (`categorie`),
-- épinglage et ordre manuel (`position`). Portée : le club ; `team_id` rattache facultativement le lien à une team
-- (la team disparue le détache : il redevient un lien du club). Suppression définitive (journal : cm.lien_supprime).
-- `cm_lien_liaisons` : liaisons plusieurs-à-plusieurs d'un lien avec des cartes des tableaux CM (`genre` = 'carte') et des
-- dossiers du Drive CM (`genre` = 'dossier'). Pas de clé étrangère sur la cible (carte ou dossier, de plusieurs tables) :
-- les lectures ignorent une cible supprimée ou à la corbeille, et la suppression d'une carte, la purge d'un dossier du
-- Drive ou la suppression du lien effacent les lignes. Un lien vers un dossier restreint n'est visible que de qui voit le dossier.
-- Droits (aucune nouvelle permission) : cm.voir lire, cm.editer ajouter / modifier / épingler / ordonner, cm.gerer supprimer.
--
-- SQL standard (SQLite et PostgreSQL), mêmes conventions que 0023 : booléens 0/1, positions en REAL.

CREATE TABLE cm_liens (
  id TEXT PRIMARY KEY,
  team_id TEXT REFERENCES teams (id) ON DELETE SET NULL,
  titre TEXT NOT NULL,
  url TEXT NOT NULL,
  hote TEXT NOT NULL,
  description TEXT,
  categorie TEXT,
  epingle INTEGER NOT NULL DEFAULT 0,
  position REAL NOT NULL DEFAULT 0,
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  maj_par TEXT,
  maj_le TEXT NOT NULL
);
CREATE INDEX cm_liens_ordre ON cm_liens (epingle, position);
CREATE INDEX cm_liens_team ON cm_liens (team_id);

CREATE TABLE cm_lien_liaisons (
  lien_id TEXT NOT NULL REFERENCES cm_liens (id) ON DELETE CASCADE,
  genre TEXT NOT NULL,
  cible_id TEXT NOT NULL,
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  PRIMARY KEY (lien_id, genre, cible_id)
);
CREATE INDEX cm_lien_liaisons_cible ON cm_lien_liaisons (genre, cible_id);
