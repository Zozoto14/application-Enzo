-- Esport, migration 0045 : commentaires non lus des cartes des tableaux CM, et cartes suivies (docs/esport/cm.md,
-- partie « Commentaires non lus »).
--
-- 1. `cm_commentaires_vus` : état « vu » des commentaires, PAR COMPTE (jamais dans le navigateur). `cle` : l'identifiant
--    d'une carte (dernière ouverture de la fiche), `t:<identifiant du tableau>` (« Tout marquer comme lu » sur un
--    tableau) ou « * » (posée à la première lecture des compteurs : rien n'est « non lu » au premier passage).
--    Un commentaire écrit par QUELQU'UN D'AUTRE après la plus récente de ces dates est non lu pour le compte. Pas de
--    clé étrangère : l'import d'un export ne dépend pas de l'ordre des lignes.
-- 2. `cm_carte_suivis` : cartes que le compte suit (bouton « Suivre » de la fiche) : il est prévenu des nouveaux
--    commentaires, comme les membres assignés, l'auteur de la carte et les personnes @mentionnées.
--
-- SQL standard (PostgreSQL et SQLite), mêmes conventions que 0041.

CREATE TABLE cm_commentaires_vus (
  compte_id TEXT NOT NULL,
  cle TEXT NOT NULL,
  vu_le TEXT NOT NULL,
  PRIMARY KEY (compte_id, cle)
);

CREATE TABLE cm_carte_suivis (
  carte_id TEXT NOT NULL REFERENCES cm_cartes (id) ON DELETE CASCADE,
  compte_id TEXT NOT NULL,
  cree_le TEXT NOT NULL,
  PRIMARY KEY (carte_id, compte_id)
);
CREATE INDEX cm_carte_suivis_compte ON cm_carte_suivis (compte_id);
