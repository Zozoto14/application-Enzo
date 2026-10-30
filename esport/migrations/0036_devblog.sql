-- Esport, migration 0036 : devblog (notes de mise à jour) ; docs/esport/devblog.md.
--
-- `devblog_entrees` : une mise à jour (titre, date affichée, version facultative ; contenu FR et EN en JSON :
-- { titre, intro, sections: [{ emoji, titre, puces: [{ nom, description }] }], conclusion }) ; statut
-- « brouillon » (visible des seuls gestionnaires) ou « publie » (visible de tous les membres).
-- `devblog_vus` : le compte a vu (fermé par « J'ai compris ») la fenêtre « Nouveautés » de cette entrée ; une
-- marque par compte et par entrée, effacée avec le compte (RGPD) ou avec l'entrée.
-- `devblog_discord` : publication d'une entrée dans UN salon Discord (file d'envoi ET mémoire : une ligne par
-- entrée et par salon, jamais deux). Message principal en anglais (découpé en plusieurs messages au-delà de
-- 2000 caractères : `message_ids`), puis fil « 🇫🇷 Version française » (`fil_id`, `fr_message_ids`). Une
-- correction réédite les messages déjà postés (`operation` = 'editer'). `empreinte` : contenu publié.
-- `devblog_reglages` : réglages (salons cochés par défaut, salon du bot pour les annonces du club).
--
-- Permission du club `devblog.gerer` (catalogue.json) : le Fondateur l'a d'office ; il peut la confier par un rôle
-- du club (page Rôles et permissions) ; désactivée par défaut (même pour le Second CEO).
--
-- SQL standard (PostgreSQL et SQLite), mêmes conventions que 0001.

CREATE TABLE devblog_entrees (
  id TEXT PRIMARY KEY,
  statut TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'publie')),
  date_maj TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '',
  contenu_fr TEXT NOT NULL,
  contenu_en TEXT NOT NULL,
  publie_le TEXT,
  publie_par TEXT,
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  maj_par TEXT,
  maj_le TEXT NOT NULL
);
CREATE INDEX devblog_entrees_publie ON devblog_entrees (statut, publie_le);

CREATE TABLE devblog_vus (
  compte_id TEXT NOT NULL,
  entree_id TEXT NOT NULL REFERENCES devblog_entrees (id) ON DELETE CASCADE,
  vu_le TEXT NOT NULL,
  PRIMARY KEY (compte_id, entree_id)
);
CREATE INDEX devblog_vus_entree ON devblog_vus (entree_id);

CREATE TABLE devblog_discord (
  id TEXT PRIMARY KEY,
  entree_id TEXT NOT NULL REFERENCES devblog_entrees (id) ON DELETE CASCADE,
  cible TEXT NOT NULL,
  team_id TEXT,
  salon_id TEXT,
  operation TEXT NOT NULL DEFAULT 'poster' CHECK (operation IN ('poster', 'editer')),
  statut TEXT NOT NULL DEFAULT 'attente' CHECK (statut IN ('attente', 'envoye', 'abandonne')),
  mention_here INTEGER NOT NULL DEFAULT 1,
  essais INTEGER NOT NULL DEFAULT 0,
  prochain_essai_le TEXT NOT NULL,
  verrou_jusqua TEXT,
  derniere_erreur TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  canal TEXT,
  forum INTEGER NOT NULL DEFAULT 0,
  message_ids TEXT NOT NULL DEFAULT '[]',
  message_salon_id TEXT,
  fil_id TEXT,
  fr_message_ids TEXT NOT NULL DEFAULT '[]',
  empreinte TEXT,
  demande_par TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  envoye_le TEXT,
  UNIQUE (entree_id, cible)
);
CREATE INDEX devblog_discord_attente ON devblog_discord (statut, prochain_essai_le);

CREATE TABLE devblog_reglages (
  cle TEXT PRIMARY KEY,
  valeur TEXT NOT NULL,
  maj_par TEXT,
  maj_le TEXT NOT NULL
);
