-- Esport, migration 0075 : modèle de strat choisi par le profil de jeu, et images des maps des profils.
--
-- SQL standard (SQLite et PostgreSQL), mêmes conventions que 0001. Voir docs/esport/strats.md et
-- docs/esport/profils-jeu.md.
--
-- 1. `jeux.modele_strat` : modèle de l'éditeur de strats des teams de ce jeu (« valorant » : 5v5 attaque /
--    défense, agents et capacités à l'échelle ; « thefinals » : 3v3v3v3, cashout et coffres, classes et
--    gadgets, destruction, étages ; « generique » : tout autre jeu). Les profils existants sont rattachés :
--    Valorant (clé ou base), The Finals (clé ou nom), le reste en générique.
ALTER TABLE jeux ADD COLUMN modele_strat TEXT NOT NULL DEFAULT 'generique';
UPDATE jeux SET modele_strat = 'valorant' WHERE cle = 'valorant' OR base = 'valorant';
UPDATE jeux SET modele_strat = 'thefinals' WHERE modele_strat = 'generique' AND (cle IN ('the-finals', 'thefinals', 'the-final', 'finals') OR LOWER(nom) LIKE '%the final%');

-- 2. `strats.modele` : modèle de chaque strat (fixé à sa création, d'après le jeu de la team). Les strats
--    existantes : Valorant pour les strats Valorant, The Finals pour celles d'une team d'un jeu The Finals,
--    générique sinon. Leur document (version 2) passe en version 3 à la lecture (document.mjs).
ALTER TABLE strats ADD COLUMN modele TEXT NOT NULL DEFAULT 'generique';
UPDATE strats SET modele = 'valorant' WHERE jeu = 'valorant';
UPDATE strats SET modele = 'thefinals' WHERE team_id IN (SELECT t.id FROM teams t JOIN jeux j ON j.cle = t.jeu WHERE j.modele_strat = 'thefinals');
UPDATE strats SET jeu = (SELECT t.jeu FROM teams t WHERE t.id = strats.team_id) WHERE jeu = 'autre' AND EXISTS (SELECT 1 FROM teams t WHERE t.id = strats.team_id);

-- 3. Images des profils de jeu (maps : fond de l'éditeur de strats), DÉPOSÉES par le Fondateur (aucune image
--    officielle n'est livrée avec l'app). Octets dans le stockage du serveur (comme les fichiers du Drive),
--    lus par un lien signé ; `largeur` et `hauteur` en pixels (l'éditeur cadre l'image dans son repère carré).
--    `supprime_le` : image remplacée ou retirée (les octets sont effacés, la ligne reste pour l'historique).
CREATE TABLE jeu_images (
  id TEXT PRIMARY KEY,
  jeu_cle TEXT NOT NULL REFERENCES jeux (cle) ON DELETE CASCADE,
  cle_stockage TEXT NOT NULL UNIQUE,
  type_mime TEXT NOT NULL,
  taille INTEGER NOT NULL,
  largeur INTEGER NOT NULL,
  hauteur INTEGER NOT NULL,
  nom_original TEXT NOT NULL,
  empreinte TEXT NOT NULL,
  depose_par TEXT NOT NULL,
  cree_le TEXT NOT NULL,
  supprime_le TEXT
);
CREATE INDEX jeu_images_jeu ON jeu_images (jeu_cle, supprime_le);
