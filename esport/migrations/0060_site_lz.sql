-- Esport, migration 0060 : liaison avec le site LigneZero (lz.appdashboard.fr) — Tickets › Configuration › Site LZ.
--
-- Demande du Fondateur : « relier l'AppDashboard aux équipes créées sur le site » : rôle et salons Discord créés
-- automatiquement pour chaque équipe, équipes visibles et modifiables dans l'app, inscription depuis Discord.
--
-- Réglages : `tickets_reglages`, clés 'site_lz' (activations, catégories de tickets liées à un tournoi du site) et
-- 'site_lz_etat' (dernière synchronisation).
-- `lz_discord` : rôles et salons créés par Esport HQ (pour les renommer, ajuster les membres, les supprimer).
-- `lz_inscriptions` : inscriptions reçues par ticket, en attente de validation par le staff.
--
-- SQL standard (PostgreSQL et SQLite).

CREATE TABLE lz_discord (
  cle TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  nom TEXT NOT NULL DEFAULT '',
  role_id TEXT,
  texte_id TEXT,
  vocal_id TEXT,
  categorie_id TEXT,
  membres TEXT NOT NULL DEFAULT '[]',
  maj_le TEXT NOT NULL
);

CREATE TABLE lz_inscriptions (
  id TEXT PRIMARY KEY,
  ticket_id TEXT,
  categorie_id TEXT,
  tournoi_id TEXT NOT NULL,
  donnees TEXT NOT NULL DEFAULT '{}',
  statut TEXT NOT NULL DEFAULT 'attente',
  equipe_id TEXT,
  cree_le TEXT NOT NULL,
  traite_le TEXT,
  traite_par TEXT
);
CREATE INDEX lz_inscriptions_statut ON lz_inscriptions (statut, cree_le);
