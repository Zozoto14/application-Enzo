-- Esport, migration 0084 : annonces du map ban dans le salon de match Discord (docs/esport/evenements.md, « Map ban »).
--
-- `club_salons_match.mapban_annonce` : identifiant du map ban du site dont le lancement a déjà été annoncé dans le salon
--   (« le map ban a été envoyé au capitaine », lien de suivi, équipe qui commence) : un même map ban n'est jamais annoncé
--   deux fois, un nouveau map ban du même match (relancé par le staff) l'est.
-- `club_salons_match.mapban_fin` : identifiant du map ban dont la fin a déjà été annoncée (la ou les maps jouées).
--
-- SQL standard (PostgreSQL et SQLite).

ALTER TABLE club_salons_match ADD COLUMN mapban_annonce TEXT;
ALTER TABLE club_salons_match ADD COLUMN mapban_fin TEXT;
