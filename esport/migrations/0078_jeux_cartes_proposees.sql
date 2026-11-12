-- Esport, migration 0078 : maps proposées (Administration › Jeux › « Maps proposées »).
--
-- SQL standard (SQLite et PostgreSQL). Voir docs/esport/profils-jeu.md.
--
-- Le serveur prépare, à la demande du gestionnaire, une proposition par map (The Finals : wiki communautaire ;
-- Valorant : valorant-api.com) : image déjà rangée dans le stockage (`jeu_images`), échelle, source et licence,
-- suggestion de pool compétitif, repères. Rien n'est appliqué au profil avant validation.
--  - `statut` : 'a-valider', 'validee' (appliquée au profil), 'rejetee' ;
--  - `donnees` : la proposition (JSON) ; `empreinte` : empreinte SHA-256 de l'image de la source (une nouvelle
--    préparation ne remet « à valider » une map validée ou rejetée que si l'image de la source a changé) ;
--  - `fichier` : image proposée (`jeu_images.id`), remplaçable par le gestionnaire avant validation.
CREATE TABLE jeu_cartes_proposees (
  jeu_cle TEXT NOT NULL REFERENCES jeux (cle) ON DELETE CASCADE,
  carte_cle TEXT NOT NULL,
  fournisseur TEXT NOT NULL,
  statut TEXT NOT NULL DEFAULT 'a-valider',
  donnees TEXT NOT NULL,
  empreinte TEXT,
  fichier TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  decide_par TEXT,
  decide_le TEXT,
  PRIMARY KEY (jeu_cle, carte_cle)
);
CREATE INDEX jeu_cartes_proposees_statut ON jeu_cartes_proposees (jeu_cle, statut);
