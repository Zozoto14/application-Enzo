-- Esport, migration 0020 : messages Discord bilingues (anglais d'abord, fil français).
--
-- SQL standard (SQLite et Postgres), mêmes conventions que 0001.
--
-- Chaque message Discord automatique part en ANGLAIS dans le salon, puis un fil
-- (thread) est ouvert sur ce message avec la version FRANÇAISE (docs/esport/discord.md).
--
-- `discord_bilingue` : réglage par team (ligne absente : fil français ACTIVÉ) et
-- dernier état observé (fil créé, ou fil impossible et pourquoi), affiché dans
-- Réglages › Discord.
CREATE TABLE discord_bilingue (
  team_id TEXT PRIMARY KEY REFERENCES teams (id) ON DELETE CASCADE,
  fil_fr INTEGER NOT NULL DEFAULT 1,
  dernier_fil_le TEXT,
  dernier_echec_fil_le TEXT,
  dernier_echec_fil_motif TEXT,
  maj_le TEXT NOT NULL
);

-- Alerte « le bot ne peut pas créer le fil français » : au plus une par salon
-- et par 24 h (anti-spam), le Fondateur y est mentionné.
CREATE TABLE discord_alertes_fil (
  salon_id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  motif TEXT NOT NULL,
  alerte_le TEXT NOT NULL
);

-- Progression d'un envoi bilingue (une seule tâche idempotente) : message
-- anglais posté (`message_id`, dans `message_salon_id`), fil créé (`fil_id`).
-- Un réessai reprend à l'étape suivante, sans jamais reposter l'anglais.
ALTER TABLE discord_file ADD COLUMN message_id TEXT;
ALTER TABLE discord_file ADD COLUMN message_salon_id TEXT;
ALTER TABLE discord_file ADD COLUMN fil_id TEXT;

-- Annonce d'une occurrence : message français du fil, réédité avec l'anglais
-- quand les réponses changent ; langue du message principal.
ALTER TABLE discord_annonces ADD COLUMN fr_salon_id TEXT;
ALTER TABLE discord_annonces ADD COLUMN fr_message_id TEXT;
ALTER TABLE discord_annonces ADD COLUMN langue TEXT;
