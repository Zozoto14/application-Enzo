-- Esport, migration 0015 : Discord ID des membres et récapitulatif par e-mail.
--
-- SQL standard (SQLite et Postgres), mêmes conventions que 0001. Le numéro
-- 0014 est pris par d'autres travaux (vidéos) : le migrateur accepte les trous.
--
-- 1. `comptes.discord_id` : identifiant numérique Discord du membre (17 à 20
--    chiffres, validé par le serveur). Obligatoire à la création d'un compte
--    Esport (« Créer un compte », « Ajouter à une team », validation d'une
--    demande) ; modifiable dans Esport › Membres par le Fondateur SEULEMENT
--    (403 pour tout autre rôle, Propriétaire compris). Le bot s'en sert pour
--    pinger les convoqués ; une liaison /lier vérifiée (discord_comptes) prime.
--    Unique : deux comptes ne portent pas le même Discord ID (plusieurs NULL
--    possibles, en SQLite comme en Postgres). Donnée personnelle : exportée
--    (RGPD) et effacée avec le compte.
ALTER TABLE comptes ADD COLUMN discord_id TEXT;
CREATE UNIQUE INDEX comptes_discord_id ON comptes (discord_id);

-- Le demandeur d'un compte (members.create) peut proposer le Discord ID ; le
-- Fondateur le vérifie (ou le saisit) à la validation.
ALTER TABLE demandes_compte ADD COLUMN discord_id TEXT;

-- 2. Récapitulatif e-mail des notifications Esport importantes (désactivé par
--    défaut, réglé par l'utilisateur lui-même : Esport › Profil). L'adresse est
--    donnée par l'utilisateur pour ce seul usage, CHIFFRÉE au repos (AES-GCM,
--    clé dérivée de CLE_DISCORD ou CLE_ESPORT), effacée quand il désactive le
--    récapitulatif ou supprime ses données. Envoi par la tâche cron du serveur
--    Node (SMTP de esport.env) ; jamais d'adresse dans les journaux.
CREATE TABLE courriel_recap (
  compte_id TEXT PRIMARY KEY,
  adresse_chiffree TEXT NOT NULL,
  frequence TEXT NOT NULL DEFAULT 'quotidien' CHECK (frequence IN ('quotidien', 'hebdomadaire')),
  dernier_envoi_le TEXT,
  dernier_statut TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL
);
