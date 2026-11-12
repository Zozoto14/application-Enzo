-- Esport, migration 0079 : salons de match fiables et synchronisés en quasi temps réel — docs/esport/evenements.md,
-- « Salons de match », « Envoi fiable » et « Synchronisation poussée par le site ».
--
-- Demande du Fondateur : « ça n'envoie pas tous les messages dans le chat de match, et ce n'est pas assez synchro ».
--
-- `club_salons_match_envois` : file d'envoi PERSISTANTE des messages du bot dans les salons de match (accueil, mises à
--   jour, rappel, résultat, avis…). Une ligne par message à poster ou à modifier, clé stable unique
--   « <salon>:<genre>:<version> » (un passage interrompu ou rejoué ne double jamais un message), envoyée dans l'ordre
--   par salon, réessayée avec attente croissante (limite de débit, Discord ou réseau en panne), jamais perdue quand un
--   passage atteint son plafond d'actions. `statut` : attente, envoye, echec (raison précise dans `erreur`), remplace
--   (modification de l'embed dépassée par une plus récente), abandon (salon supprimé). `meta` : changements regroupés
--   d'une « Mise à jour » (fenêtre de 30 s).
-- `club_salons_match.envois_seq` : dernière version enfilée pour ce salon (clé des envois).
-- `site_lz_pousses` : avis reçus du site LigneZero (« tel tournoi, tels matchs ont changé »), traités en quelques
--   secondes ; aucune donnée du site n'y est copiée, seulement des identifiants.
-- `site_lz_nonces` : nonces des avis signés déjà reçus (rejeu refusé), effacés après la fenêtre de 5 minutes.
--
-- SQL standard (PostgreSQL et SQLite).

ALTER TABLE club_salons_match ADD COLUMN envois_seq INTEGER NOT NULL DEFAULT 0;

CREATE TABLE club_salons_match_envois (
  id TEXT PRIMARY KEY,
  cle TEXT NOT NULL UNIQUE,
  evenement_id TEXT NOT NULL,
  salon_match_id TEXT NOT NULL,
  genre TEXT NOT NULL,
  methode TEXT NOT NULL,
  corps TEXT NOT NULL,
  meta TEXT,
  ordre INTEGER NOT NULL,
  statut TEXT NOT NULL,
  essais INTEGER NOT NULL DEFAULT 0,
  prochain_le TEXT NOT NULL,
  erreur TEXT,
  message_id TEXT,
  envoye_le TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL
);
CREATE INDEX club_salons_match_envois_file ON club_salons_match_envois (evenement_id, statut, prochain_le);
CREATE INDEX club_salons_match_envois_salon ON club_salons_match_envois (salon_match_id, ordre);

CREATE TABLE site_lz_pousses (
  id TEXT PRIMARY KEY,
  evenement_id TEXT NOT NULL,
  cles TEXT,
  recu_le TEXT NOT NULL,
  traite_le TEXT
);
CREATE INDEX site_lz_pousses_evt ON site_lz_pousses (evenement_id, traite_le);

CREATE TABLE site_lz_nonces (
  nonce TEXT PRIMARY KEY,
  expire_le TEXT NOT NULL
);
