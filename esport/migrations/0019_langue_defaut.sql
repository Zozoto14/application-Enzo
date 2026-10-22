-- Esport, migration 0019 : langue par défaut d'un compte, réglée par le Fondateur.
--
-- SQL standard (SQLite et Postgres), mêmes conventions que 0001.
--
-- `comptes.langue_defaut` : langue définie par l'administrateur (Fondateur) à la création du compte
-- ou depuis Esport › Membres / Administration. Elle sert à l'interface Esport tant que
-- l'utilisateur n'a pas choisi la sienne (`comptes.langue`, migration 0012, qui PRIME), aux e-mails
-- (invitation, renvoi, réponse au support, récapitulatif) et aux réponses du bot Discord.
-- Langue effective = COALESCE(langue, langue_defaut).
ALTER TABLE comptes ADD COLUMN langue_defaut TEXT NOT NULL DEFAULT 'fr' CHECK (langue_defaut IN ('fr', 'en'));

-- Comptes existants : français, sauf pour ceux qui ont déjà choisi English dans leur profil Esport.
UPDATE comptes SET langue_defaut = 'en' WHERE langue = 'en';

-- Langue par défaut réglée AVANT que le compte ait une fiche Esport (compte créé dans l'Administration, jamais
-- connecté à l'Esport) : gardée ici, appliquée à la création de sa fiche (`comptes.langue_defaut`) puis effacée.
CREATE TABLE langues_attente (
  compte_id TEXT PRIMARY KEY,
  langue TEXT NOT NULL CHECK (langue IN ('fr', 'en')),
  cree_le TEXT NOT NULL
);
