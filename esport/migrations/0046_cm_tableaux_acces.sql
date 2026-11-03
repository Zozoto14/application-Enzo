-- Esport, migration 0046 : accès restreint aux tableaux CM (docs/esport/cm.md, « Accès au tableau »).
--
--  - `cm_tableaux.acces` : 'tous' (tous ceux qui ont accès au CM de la portée : le comportement d'avant, valeur de
--    TOUS les tableaux existants, tableaux par défaut compris) ou 'restreint' ;
--  - `cm_tableau_acces` : qui voit un tableau restreint. `genre` : 'compte' (une personne), 'role_cm' (rôle CM,
--    `cm_roles`), 'role_club' (rôle du club, `roles_globaux`) ou 'role_team' (rôle d'une team, `roles`) ;
--    `niveau` : 'voir' (lecture seule) ou 'modifier' (les permissions CM habituelles du compte). Le Fondateur voit
--    toujours tout ; l'accès au tableau ne donne jamais plus que les permissions CM de la portée ;
--  - `notifications.cm_carte_id` : carte d'une notification personnelle de la section CM (assignée, mention, à
--    valider…), pour la masquer dès que son destinataire ne voit plus le tableau de la carte (relu à chaque lecture,
--    la carte peut changer de tableau). Rempli pour les notifications existantes depuis leur événement d'origine.
--
-- SQL standard (SQLite et PostgreSQL), mêmes conventions que 0001.
ALTER TABLE cm_tableaux ADD COLUMN acces TEXT NOT NULL DEFAULT 'tous';

CREATE TABLE cm_tableau_acces (
  tableau_id TEXT NOT NULL,
  genre TEXT NOT NULL,
  cible TEXT NOT NULL,
  niveau TEXT NOT NULL DEFAULT 'voir',
  ajoute_par TEXT,
  ajoute_le TEXT NOT NULL,
  PRIMARY KEY (tableau_id, genre, cible)
);
CREATE INDEX cm_tableau_acces_cible ON cm_tableau_acces (genre, cible);

ALTER TABLE notifications ADD COLUMN cm_carte_id TEXT;
UPDATE notifications SET cm_carte_id = (
  SELECT e.entite_id FROM evenements e
   WHERE e.id = substr(notifications.id, 1, length(notifications.id) - length(notifications.compte_id) - 1) AND e.entite_type = 'cm_carte'
) WHERE type LIKE 'cm-%';
UPDATE notifications SET cm_carte_id = (
  SELECT c.entite_id FROM notifs_centre c
   WHERE c.id = substr(notifications.id, 1, length(notifications.id) - length(notifications.compte_id) - 1) AND c.entite_type = 'cm_carte'
) WHERE cm_carte_id IS NULL AND type LIKE 'cm-%';
CREATE INDEX notifications_cm_carte ON notifications (cm_carte_id);
