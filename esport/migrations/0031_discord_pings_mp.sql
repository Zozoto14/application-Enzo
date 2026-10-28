-- Esport, migration 0031 : un ping Discord une seule fois par événement, relances par message privé (MP).
--
-- SQL standard (SQLite et PostgreSQL), mêmes conventions que 0001. Règles : docs/esport/discord.md,
-- section « Pings une seule fois, relances par MP ».
--
-- `discord_mp_reglages` : option « Relances par MP » de la team (ligne absente : ACTIVÉE).
CREATE TABLE discord_mp_reglages (
  team_id TEXT PRIMARY KEY REFERENCES teams (id) ON DELETE CASCADE,
  relances_mp INTEGER NOT NULL DEFAULT 1,
  maj_le TEXT NOT NULL
);

-- Registre des mentions faites dans le salon : un joueur (ou le rôle configuré, `role:<id>`) n'est
-- mentionné qu'UNE fois par sujet (`occ:<événement>:<occurrence>` pour le planning). Les messages
-- suivants du même événement (rappels, « c'est maintenant », relances, repli après un MP impossible)
-- ne le mentionnent plus.
CREATE TABLE discord_mentions (
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  sujet TEXT NOT NULL,
  cible TEXT NOT NULL,
  ligne_id TEXT,
  cree_le TEXT NOT NULL,
  PRIMARY KEY (team_id, sujet, cible)
);

-- MP envoyés par le bot pour une tâche de la file : un réessai de la tâche ne renvoie jamais un MP
-- déjà parti (en plus du nonce de Discord).
CREATE TABLE discord_mp_envois (
  ligne_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  compte_id TEXT,
  message_id TEXT,
  envoye_le TEXT NOT NULL,
  PRIMARY KEY (ligne_id, discord_user_id)
);
CREATE INDEX discord_mp_envois_date ON discord_mp_envois (envoye_le);

-- Joueurs que le bot n'a pas pu joindre en MP (MP fermés : erreur 50007, utilisateur introuvable…),
-- montrés dans Réglages › Discord avec l'action à faire ; effacé au premier MP réussi.
CREATE TABLE discord_injoignables (
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  compte_id TEXT NOT NULL,
  discord_user_id TEXT,
  motif TEXT NOT NULL,
  depuis_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  PRIMARY KEY (team_id, compte_id)
);

-- Bilan des MP d'une tâche (JSON `{ "echecs": [comptes] }`) : NULL tant que les MP ne sont pas tous
-- tentés ; ensuite, seuls les comptes en échec sont cités (et mentionnés au plus une fois) dans le salon.
ALTER TABLE discord_file ADD COLUMN mp_bilan TEXT;
