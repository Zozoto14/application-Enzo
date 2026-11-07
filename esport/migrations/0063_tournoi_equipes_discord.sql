-- Esport, migration 0063 : équipes participantes d'un tournoi et leurs rôles Discord (docs/esport/vocaux.md,
-- « Tournois : rôles des équipes »).
--
-- Demande du Fondateur : pour un tournoi (ex. The Nuke End), noter les équipes inscrites (importées des tickets
-- d'inscription), créer en une action un rôle Discord par équipe (« {TAG} {Nom} ») donné à ses membres, et le supprimer
-- à la fin du tournoi ; un hub vocal du tournoi crée le salon de l'équipe, verrouillé sur son rôle.
--
-- `tournoi_discord` : réglages Discord d'un tournoi (modèle du nom des rôles, couleur, suppression automatique N heures
--   après la date de fin, catégorie de tickets des inscriptions) et dates de création / suppression des rôles.
-- `tournoi_equipes` : une équipe (nom, TAG, rôle Discord créé, ticket d'inscription d'origine).
-- `tournoi_equipe_membres` : ses membres (poste joueur / coach / remplaçant, Discord ID, nom, Embark ID) et l'état de
--   l'attribution du rôle ('attribue', 'absent' : pas sur le serveur, 'refus' : refusé par Discord).
-- Données personnelles (Discord ID, Embark ID) : export de la base, RGPD (effacement par Discord ID).
--
-- SQL standard (PostgreSQL et SQLite).

CREATE TABLE tournoi_discord (
  tournoi_id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  modele_role TEXT NOT NULL DEFAULT '{tag} {nom}',
  couleur TEXT,
  suppression_h INTEGER NOT NULL DEFAULT 24,
  categorie_ticket_id TEXT,
  roles_crees_le TEXT,
  roles_supprimes_le TEXT,
  maj_le TEXT NOT NULL
);

CREATE TABLE tournoi_equipes (
  id TEXT PRIMARY KEY,
  tournoi_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  nom TEXT NOT NULL,
  tag TEXT NOT NULL,
  role_id TEXT,
  ticket_id TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL
);

CREATE INDEX tournoi_equipes_tournoi ON tournoi_equipes (tournoi_id);

CREATE TABLE tournoi_equipe_membres (
  id TEXT PRIMARY KEY,
  equipe_id TEXT NOT NULL,
  poste TEXT NOT NULL DEFAULT 'joueur',
  discord_id TEXT,
  nom TEXT NOT NULL DEFAULT '',
  embark_id TEXT NOT NULL DEFAULT '',
  role_statut TEXT,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX tournoi_equipe_membres_equipe ON tournoi_equipe_membres (equipe_id);
CREATE INDEX tournoi_equipe_membres_discord ON tournoi_equipe_membres (discord_id);
