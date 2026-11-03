-- Esport, migration 0047 : drapeau d'urgence des cartes des tableaux CM (docs/esport/cm.md, partie « Urgences »).
--
-- `cm_cartes.urgence` : NULL (aucun drapeau, défaut) ou l'un des quatre niveaux 'faible', 'moyen', 'urgent', 'critique'.
-- Le niveau se règle avec la permission cm.editer, comme les autres champs de carte. Passer à « urgent » ou « critique »
-- (montée seulement) notifie les membres assignés et les suiveurs (et les responsables CM pour « critique »).
--
-- SQL standard (PostgreSQL et SQLite).

ALTER TABLE cm_cartes ADD COLUMN urgence TEXT CHECK (urgence IS NULL OR urgence IN ('faible', 'moyen', 'urgent', 'critique'));
CREATE INDEX cm_cartes_urgence ON cm_cartes (tableau_id, urgence);
