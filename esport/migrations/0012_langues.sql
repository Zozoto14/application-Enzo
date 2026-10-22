-- Esport, migration 0012 : langues (français / anglais).
--
-- SQL standard (SQLite et Postgres), mêmes conventions que 0001.
--
-- `comptes.langue` : langue choisie par l'utilisateur dans son profil Esport
-- ('fr' ou 'en'). NULL tant qu'il n'a rien choisi (l'app prend alors la langue de
-- l'appareil). Le bot Discord l'utilise pour ses réponses privées, avant la
-- langue de l'interaction Discord.
ALTER TABLE comptes ADD COLUMN langue TEXT CHECK (langue IS NULL OR langue IN ('fr', 'en'));

-- `teams.langue_discord` : langue des messages Discord de la team (annonces,
-- rappels, relances du bot, webhook) : français par défaut. Réglage dans
-- Réglages › Discord (permission discord.manage).
ALTER TABLE teams ADD COLUMN langue_discord TEXT NOT NULL DEFAULT 'fr' CHECK (langue_discord IN ('fr', 'en'));
