-- Esport, migration 0010 : review vidéo v2 (réactions et dessins).
--
-- SQL standard (SQLite et Postgres). Le numéro 0009 est pris par le
-- planning (convocations) : le migrateur accepte les trous, chaque migration
-- n'est appliquée qu'une fois (par nom).
--
-- 1. Réactions 👍 / 👎 sur un repère ou sur un commentaire de repère : UNE
--    réaction par membre et par cible (contrainte d'unicité), qu'il change
--    (valeur 1 ↔ -1) ou retire (ligne supprimée). Le compte est gardé par
--    identifiant sans clé étrangère, comme les repères ; ses réactions sont
--    effacées avec son compte (RGPD).
-- 2. Dessin posé sur la vidéo (`review_reperes.dessin`) : JSON validé par le
--    serveur (coordonnées relatives 0 à 1, taille bornée), NULL sans dessin.
-- 3. Permission `video_review.react`, donnée aux rôles système qui voient la
--    review dans les teams déjà créées (idempotent ; rôles personnalisés
--    inchangés).

CREATE TABLE review_reactions (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  review_id TEXT NOT NULL REFERENCES reviews (id) ON DELETE CASCADE,
  repere_id TEXT NOT NULL REFERENCES review_reperes (id) ON DELETE CASCADE,
  cible_type TEXT NOT NULL CHECK (cible_type IN ('repere', 'commentaire')),
  cible_id TEXT NOT NULL,
  compte_id TEXT NOT NULL,
  valeur INTEGER NOT NULL CHECK (valeur IN (1, -1)),
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  UNIQUE (cible_type, cible_id, compte_id)
);
CREATE INDEX review_reactions_review ON review_reactions (review_id, team_id);
CREATE INDEX review_reactions_compte ON review_reactions (compte_id);

ALTER TABLE review_reperes ADD COLUMN dessin TEXT;

INSERT INTO role_permissions (role_id, permission)
  SELECT id, 'video_review.react' FROM roles WHERE systeme = 1 AND cle_systeme IN ('manager', 'coach', 'analyste', 'joueur')
  ON CONFLICT (role_id, permission) DO NOTHING;
