-- Esport, migration 0004 : notifications Discord (phase 4).
--
-- SQL standard (SQLite et Postgres), mêmes conventions que 0001 :
-- UUID et dates ISO 8601 en TEXT, booléens 0/1, aucune fonction propre à SQLite.
-- Indépendante de 0002, 0003 et 0005 : chaque migration n'est appliquée qu'une
-- fois (par nom), les numéros peuvent arriver dans n'importe quel ordre.

-- Un webhook par team. L'adresse n'est JAMAIS stockée en clair : `url_chiffree`
-- (AES-GCM, clé dérivée d'un secret du serveur, liée à la team). `fin` : les 4
-- derniers caractères du jeton, pour l'affichage masqué « …/abcd ».
CREATE TABLE discord_webhooks (
  team_id TEXT PRIMARY KEY REFERENCES teams (id) ON DELETE CASCADE,
  url_chiffree TEXT NOT NULL,
  fin TEXT NOT NULL,
  cree_par TEXT NOT NULL,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  -- Limite de débit de Discord (429) : plus rien n'est envoyé avant cette date.
  bloque_jusqua TEXT,
  dernier_succes_le TEXT,
  dernier_echec_le TEXT,
  -- Discord a répondu « webhook inconnu » (supprimé côté Discord) : à ressaisir.
  invalide_le TEXT,
  dernier_test_le TEXT
);

-- Réglage par type d'événement ; une ligne n'existe que si la team a changé
-- quelque chose (sinon : valeurs par défaut du catalogue, noyau/discord/catalogue.mjs).
-- `modele` NULL : modèle par défaut. `role_mention` : identifiant numérique d'un
-- rôle Discord (jamais @everyone ni @here).
CREATE TABLE discord_notification_settings (
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  cle TEXT NOT NULL,
  actif INTEGER NOT NULL DEFAULT 1,
  modele TEXT,
  role_mention TEXT,
  maj_le TEXT NOT NULL,
  PRIMARY KEY (team_id, cle)
);

-- File d'envoi (outbox Discord) : une ligne par (événement du bus, type de
-- message). Le message est rendu au moment de l'envoi à partir de `modele` et
-- `variables` (instantané pris à la mise en file). `verrou_jusqua` : bail de
-- traitement (deux traitements simultanés n'envoient jamais deux fois).
CREATE TABLE discord_file (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  evenement_id TEXT,
  cle TEXT NOT NULL,
  modele TEXT NOT NULL,
  variables TEXT NOT NULL DEFAULT '{}',
  role_mention TEXT,
  statut TEXT NOT NULL DEFAULT 'attente' CHECK (statut IN ('attente', 'envoye', 'abandonne')),
  essais INTEGER NOT NULL DEFAULT 0,
  prochain_essai_le TEXT NOT NULL,
  verrou_jusqua TEXT,
  derniere_erreur TEXT,
  expire_le TEXT NOT NULL,
  cree_le TEXT NOT NULL,
  envoye_le TEXT,
  maj_le TEXT NOT NULL
);
CREATE INDEX discord_file_attente ON discord_file (statut, prochain_essai_le);
CREATE INDEX discord_file_team ON discord_file (team_id, cree_le);

-- Rappels J-1 / H-1 déjà publiés (une fois par occurrence et par rappel).
CREATE TABLE discord_rappels (
  evenement_id TEXT NOT NULL,
  occurrence TEXT NOT NULL,
  genre TEXT NOT NULL CHECK (genre IN ('d1', 'h1')),
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  cree_le TEXT NOT NULL,
  PRIMARY KEY (evenement_id, occurrence, genre)
);
