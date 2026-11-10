-- Esport, migration 0064 : événements organisés par le club (Administration › Événements, docs/esport/evenements.md).
--
-- Demande du Fondateur : un tournoi organisé PAR le club (ex. The Nuke End) se gère au niveau du club, pas dans une
-- team (le module Tournois d'une team sert aux tournois extérieurs). Chaque événement : nom, jeu, dates, statut,
-- catégorie de tickets des inscriptions, réglages Discord (rôles automatiques, modèle du nom, couleur, position :
-- juste en dessous d'un rôle choisi, suppression N heures après la fin) et équipes participantes. Ajouter une équipe
-- crée aussitôt son rôle Discord et le donne à ses membres présents sur le serveur.
--
-- `club_evenements` : l'événement et ses réglages Discord (`role_ancre_id` : les rôles créés sont placés juste en
--   dessous de ce rôle ; NULL : tout en bas). `roles_crees_le` / `roles_supprimes_le` : nettoyage de fin.
-- `club_evenement_equipes` : une équipe (nom, TAG, rôle Discord créé et son nom, ticket d'inscription d'origine).
-- `club_evenement_membres` : ses membres (poste, Discord ID, nom, Embark ID, état de l'attribution du rôle).
-- `club_evenement_staff` : le staff de l'événement, qui reçoit le « rôle staff de l'événement » (accès aux catégories de
--   tickets de l'événement et aux salons vocaux des équipes).
-- Données personnelles (Discord ID, Embark ID) : export de la base, RGPD (effacement par Discord ID).
--
-- Reprise de la migration 0063 : les équipes notées sur un tournoi d'une team (tournoi_discord, tournoi_equipes,
-- tournoi_equipe_membres) deviennent un événement du club qui GARDE l'identifiant du tournoi (les hubs vocaux liés et
-- les salons d'équipe ouverts continuent de fonctionner), avec ses équipes, rôles et membres ; puis ces tables sont
-- supprimées (plus aucun code ne les lit).
--
-- Permission du club `evenements.gerer` (catalogue.json) : le Fondateur l'a d'office ; le Second CEO et un rôle du
-- club nommé « CEO » la reçoivent.
--
-- SQL standard (PostgreSQL et SQLite).

CREATE TABLE club_evenements (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  jeu TEXT,
  debut TEXT,
  fin TEXT,
  statut TEXT NOT NULL DEFAULT 'a_venir' CHECK (statut IN ('a_venir', 'en_cours', 'termine', 'annule')),
  description TEXT NOT NULL DEFAULT '',
  categorie_ticket_id TEXT,
  roles_auto INTEGER NOT NULL DEFAULT 1,
  modele_role TEXT NOT NULL DEFAULT '{tag} {nom}',
  couleur TEXT,
  role_ancre_id TEXT,
  suppression_h INTEGER NOT NULL DEFAULT 24,
  roles_crees_le TEXT,
  roles_supprimes_le TEXT,
  -- Rôle staff de l'événement : modèle du nom ({evenement}), rôle créé et son nom ; catégories de tickets de
  -- l'événement (JSON [id]) où il est ajouté aux rôles qui traitent les tickets.
  staff_modele TEXT NOT NULL DEFAULT 'Staff {evenement}',
  staff_role_id TEXT,
  staff_role_nom TEXT,
  categories_tickets TEXT NOT NULL DEFAULT '[]',
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL
);

CREATE TABLE club_evenement_equipes (
  id TEXT PRIMARY KEY,
  evenement_id TEXT NOT NULL,
  nom TEXT NOT NULL,
  tag TEXT NOT NULL,
  role_id TEXT,
  role_nom TEXT,
  ticket_id TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL
);

CREATE INDEX club_evenement_equipes_evenement ON club_evenement_equipes (evenement_id);

CREATE TABLE club_evenement_membres (
  id TEXT PRIMARY KEY,
  equipe_id TEXT NOT NULL,
  poste TEXT NOT NULL DEFAULT 'joueur',
  discord_id TEXT,
  nom TEXT NOT NULL DEFAULT '',
  embark_id TEXT NOT NULL DEFAULT '',
  role_statut TEXT,
  position INTEGER NOT NULL DEFAULT 0
);

-- Staff de l'événement : membres (Discord ID ; compte de l'app s'il est lié) qui reçoivent le rôle staff.
CREATE TABLE club_evenement_staff (
  id TEXT PRIMARY KEY,
  evenement_id TEXT NOT NULL,
  discord_id TEXT NOT NULL,
  nom TEXT NOT NULL DEFAULT '',
  compte_id TEXT,
  role_statut TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL
);

CREATE INDEX club_evenement_staff_evenement ON club_evenement_staff (evenement_id);
CREATE INDEX club_evenement_staff_discord ON club_evenement_staff (discord_id);

CREATE INDEX club_evenement_membres_equipe ON club_evenement_membres (equipe_id);
CREATE INDEX club_evenement_membres_discord ON club_evenement_membres (discord_id);

-- Reprise : un événement par tournoi qui avait des équipes ou des réglages Discord (même identifiant).
INSERT INTO club_evenements (id, nom, jeu, debut, fin, statut, categorie_ticket_id, roles_auto, modele_role, couleur, suppression_h, roles_crees_le, roles_supprimes_le, cree_le, maj_le)
SELECT t.id, t.nom, t.jeu, t.debut, t.fin,
       CASE WHEN t.statut IN ('en_cours', 'termine', 'annule') THEN t.statut ELSE 'a_venir' END,
       d.categorie_ticket_id, 1, COALESCE(d.modele_role, '{tag} {nom}'), d.couleur, COALESCE(d.suppression_h, 24), d.roles_crees_le, d.roles_supprimes_le,
       t.cree_le, COALESCE(d.maj_le, t.maj_le)
  FROM tournois t
  LEFT JOIN tournoi_discord d ON d.tournoi_id = t.id
 WHERE t.id IN (SELECT tournoi_id FROM tournoi_equipes UNION SELECT tournoi_id FROM tournoi_discord);

INSERT INTO club_evenement_equipes (id, evenement_id, nom, tag, role_id, role_nom, ticket_id, position, cree_le, maj_le)
SELECT e.id, e.tournoi_id, e.nom, e.tag, e.role_id, NULL, e.ticket_id, e.position, e.cree_le, e.maj_le
  FROM tournoi_equipes e
 WHERE e.tournoi_id IN (SELECT id FROM club_evenements);

INSERT INTO club_evenement_membres (id, equipe_id, poste, discord_id, nom, embark_id, role_statut, position)
SELECT m.id, m.equipe_id, m.poste, m.discord_id, m.nom, m.embark_id, m.role_statut, m.position
  FROM tournoi_equipe_membres m
 WHERE m.equipe_id IN (SELECT id FROM club_evenement_equipes);

DROP TABLE tournoi_equipe_membres;
DROP TABLE tournoi_equipes;
DROP TABLE tournoi_discord;

-- Second CEO, et un rôle du club nommé « CEO » : gérer les événements (le Fondateur peut la leur retirer).
INSERT INTO roles_globaux_permissions (role_id, permission) SELECT id, 'evenements.gerer' FROM roles_globaux WHERE id = 'role-global-second-ceo' OR LOWER(nom) = 'ceo';
