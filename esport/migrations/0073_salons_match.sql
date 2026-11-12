-- Esport, migration 0073 : salons de match Discord des événements liés à un tournoi du site LigneZero
-- — docs/esport/evenements.md, « Salons de match ».
--
-- Demande du Fondateur : « quand un match est créé sur le site, créer un salon Discord avec toutes les équipes
-- concernées et le staff ; le bot y poste les infos importantes ; le match terminé, le salon est supprimé après un
-- délai, mais l'historique reste dans l'app ».
--
-- `club_evenements.salons_match` : réglages (JSON) : activé, catégorie Discord, modèle du nom, délai de suppression
--   (minutes), rappels, langue, création anticipée, rétention des historiques.
-- `club_salons_match` : un salon par match (ou lobby) du site, clé (evenement_id, site_match_id) unique : jamais deux
--   salons pour un même match, même avec plusieurs processus ou après un redémarrage. `transcript` : historique du
--   salon (messages, auteurs, pièces jointes en liens) enregistré avant sa suppression ; contenu de l'événement (pas un
--   ticket confidentiel), jamais envoyé à une IA, effacé avec l'événement (ou après la rétention choisie).
--
-- SQL standard (PostgreSQL et SQLite).

ALTER TABLE club_evenements ADD COLUMN salons_match TEXT;

CREATE TABLE club_salons_match (
  id TEXT PRIMARY KEY,
  evenement_id TEXT NOT NULL,
  site_match_id TEXT NOT NULL,
  genre TEXT NOT NULL,
  titre TEXT NOT NULL DEFAULT '',
  infos TEXT,
  empreinte TEXT,
  resultat_empreinte TEXT,
  avertis TEXT,
  salon_id TEXT,
  message_id TEXT,
  statut TEXT NOT NULL,
  prevu_le TEXT,
  rappel30_le TEXT,
  rappel10_le TEXT,
  resultat_le TEXT,
  suppression_le TEXT,
  supprime_le TEXT,
  transcript TEXT,
  nb_messages INTEGER NOT NULL DEFAULT 0,
  erreur TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  UNIQUE (evenement_id, site_match_id)
);
CREATE INDEX club_salons_match_evt ON club_salons_match (evenement_id, statut);
