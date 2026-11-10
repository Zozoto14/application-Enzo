-- Esport, migration 0066 : rôles Discord temporaires des teams (docs/esport/bot-discord.md, « Rôles temporaires »).
--
-- Demande du Fondateur : le coach donne, par une commande du bot, un rôle Discord à durée limitée à des personnes
-- (ex. un try-out : « Intervenant TF » pendant 24 h). Le rôle est celui de la team du coach ; il est retiré
-- automatiquement à l'échéance (cron toutes les 5 minutes, et le processus qui tient la connexion en direct).
--
-- `roles_temp_reglages` : réglages d'une team (rôle Discord à donner, durée par défaut, nombre de personnes en même
--   temps, rôles de la team autorisés à donner le rôle — JSON de rôles de la team, vide : Coach, Manager et
--   Propriétaire —, salon des journaux, message privé à la personne).
-- `roles_temp_octrois` : un rôle donné à une personne (team, rôle, personne, qui l'a donné, raison, échéance). Un seul
--   octroi ACTIF par team et par personne (redonner prolonge). `statut` : 'actif', 'expire' (retiré à l'échéance),
--   'retire' (retiré à la main), 'echec' (Discord refuse le retrait après plusieurs essais). `prochain_essai_le` /
--   `essais` : nouvel essai du retrait (limite de débit, hiérarchie des rôles, Discord injoignable).
-- Données personnelles (Discord ID, nom affiché, raison) : export de la base, RGPD (effacement par Discord ID).
--
-- SQL standard (PostgreSQL et SQLite). Aucune permission nouvelle : réglages = `discord.manage`, usage = rôles de la
-- team autorisés dans les réglages (et le Fondateur) ; commandes réglées dans `tickets_reglages` (clé 'roles_temp_commandes').

CREATE TABLE roles_temp_reglages (
  team_id TEXT PRIMARY KEY,
  actif INTEGER NOT NULL DEFAULT 0,
  role_id TEXT,
  role_nom TEXT NOT NULL DEFAULT '',
  duree_defaut_h INTEGER NOT NULL DEFAULT 24,
  max_simultanes INTEGER NOT NULL DEFAULT 10,
  roles_autorises TEXT NOT NULL DEFAULT '[]',
  salon_journal_id TEXT,
  mp INTEGER NOT NULL DEFAULT 1,
  maj_par TEXT,
  maj_le TEXT NOT NULL
);

CREATE TABLE roles_temp_octrois (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  role_nom TEXT NOT NULL DEFAULT '',
  membre_discord_id TEXT NOT NULL,
  membre_nom TEXT NOT NULL DEFAULT '',
  accorde_par TEXT,
  accorde_par_discord_id TEXT,
  accorde_par_nom TEXT NOT NULL DEFAULT '',
  raison TEXT NOT NULL DEFAULT '',
  statut TEXT NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'expire', 'retire', 'echec')),
  accorde_le TEXT NOT NULL,
  expire_le TEXT NOT NULL,
  retire_le TEXT,
  retire_par TEXT,
  essais INTEGER NOT NULL DEFAULT 0,
  prochain_essai_le TEXT,
  erreur TEXT,
  maj_le TEXT NOT NULL
);

CREATE INDEX roles_temp_octrois_team ON roles_temp_octrois (team_id, statut);
CREATE INDEX roles_temp_octrois_echeance ON roles_temp_octrois (statut, expire_le);
CREATE UNIQUE INDEX roles_temp_octrois_actif ON roles_temp_octrois (team_id, membre_discord_id) WHERE statut = 'actif';
