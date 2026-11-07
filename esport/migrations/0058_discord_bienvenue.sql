-- Esport, migration 0058 : message de bienvenue quand un membre du serveur Discord reçoit un rôle choisi
-- (docs/esport/tickets.md, « Bienvenue par rôle »).
--
-- Demande du Fondateur : « quand ils rejoignent le serveur avec le rôle The Nuke End, ça les ping dans un salon
-- Discord qu'on peut configurer », avec le bot Esport HQ.
--
-- Réglages : `tickets_reglages`, clé 'bienvenue' (rôle, salon, message, activé) — aucune colonne nouvelle.
-- `discord_bienvenues` : une ligne par personne déjà accueillie pour un rôle, pour ne JAMAIS la mentionner deux fois
--   (Discord renvoie le membre à chaque changement : pseudo, autre rôle…). Les titulaires du rôle au moment de
--   l'activation y sont notés d'office (pas de vague de mentions à l'activation).
--
-- SQL standard (PostgreSQL et SQLite).

CREATE TABLE discord_bienvenues (
  guild_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  -- 'message' : bienvenue publiée ; 'existant' : avait déjà le rôle à l'activation ; 'echec' : message refusé par Discord.
  issue TEXT NOT NULL DEFAULT 'message',
  accueilli_le TEXT NOT NULL,
  PRIMARY KEY (guild_id, discord_user_id, role_id)
);
