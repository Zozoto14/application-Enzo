-- Esport, migration 0011 : bot Discord (interactions HTTP, slash commands).
--
-- SQL standard (SQLite et Postgres), mêmes conventions que 0001. Les
-- numéros 0009 (convocations) et 0010 (review vidéo) sont pris par d'autres
-- travaux : le migrateur accepte les trous.
--
-- AUCUN secret ici : le jeton du bot (DISCORD_BOT_TOKEN) est un secret du
-- serveur. On ne stocke que des identifiants Discord (publics) et l'EMPREINTE
-- des codes de liaison, jamais le code lui-même.

-- Serveur Discord lié à une team (un serveur peut porter plusieurs teams ;
-- une team n'a qu'un serveur). `salon_id` : salon par défaut des annonces.
-- `bloque_jusqua` : limite de débit (429) du bot pour cette team.
CREATE TABLE discord_serveurs (
  team_id TEXT PRIMARY KEY REFERENCES teams (id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL,
  salon_id TEXT NOT NULL,
  salon_nom TEXT NOT NULL DEFAULT '',
  lie_par_discord TEXT NOT NULL,
  lie_par_compte TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  bloque_jusqua TEXT,
  dernier_succes_le TEXT,
  dernier_echec_le TEXT,
  invalide_le TEXT
);
CREATE INDEX discord_serveurs_guild ON discord_serveurs (guild_id);

-- Compte Esport ↔ compte Discord (en complément du champ texte `comptes.discord`).
-- `super_admin` : drapeau de la session qui a demandé le code (Fondateur).
CREATE TABLE discord_comptes (
  compte_id TEXT PRIMARY KEY,
  discord_user_id TEXT NOT NULL UNIQUE,
  discord_nom TEXT NOT NULL DEFAULT '',
  super_admin INTEGER NOT NULL DEFAULT 0,
  lie_le TEXT NOT NULL
);

-- Codes à usage unique (10 min) : « serveur » (lier un serveur à une team,
-- demandé dans l'app par discord.manage) ou « compte » (lier mon Discord).
CREATE TABLE discord_codes (
  code_hash TEXT PRIMARY KEY,
  genre TEXT NOT NULL CHECK (genre IN ('serveur', 'compte')),
  team_id TEXT REFERENCES teams (id) ON DELETE CASCADE,
  compte_id TEXT NOT NULL,
  super_admin INTEGER NOT NULL DEFAULT 0,
  expire_le TEXT NOT NULL,
  utilise_le TEXT,
  cree_le TEXT NOT NULL
);
CREATE INDEX discord_codes_compte ON discord_codes (compte_id, genre);

-- Ping des convoqués, par team et par type d'événement (ligne absente : activé).
CREATE TABLE discord_bot_pings (
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  type_evenement TEXT NOT NULL,
  ping INTEGER NOT NULL DEFAULT 1,
  maj_le TEXT NOT NULL,
  PRIMARY KEY (team_id, type_evenement)
);

-- Annonce postée par le bot pour une occurrence : son message est ÉDITÉ quand
-- les réponses changent (compteurs à jour), au lieu d'un nouveau message.
CREATE TABLE discord_annonces (
  evenement_id TEXT NOT NULL,
  occurrence TEXT NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  salon_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  -- Type du message posté (event_created, reminder_d1…) : l'édition garde son bandeau.
  cle TEXT NOT NULL DEFAULT 'event_created',
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  PRIMARY KEY (evenement_id, occurrence)
);

-- « C'est maintenant » : publié une fois par occurrence, au début.
CREATE TABLE discord_debuts (
  evenement_id TEXT NOT NULL,
  occurrence TEXT NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  cree_le TEXT NOT NULL,
  PRIMARY KEY (evenement_id, occurrence)
);

-- File d'envoi commune : `canal` = webhook (historique) ou bot ; `operation` =
-- poster ou editer (mise à jour d'une annonce) ; `salon_id` du bot.
ALTER TABLE discord_file ADD COLUMN canal TEXT NOT NULL DEFAULT 'webhook';
ALTER TABLE discord_file ADD COLUMN operation TEXT NOT NULL DEFAULT 'poster';
ALTER TABLE discord_file ADD COLUMN salon_id TEXT;
