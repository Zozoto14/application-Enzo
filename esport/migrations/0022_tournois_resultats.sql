-- Esport, migration 0022 : modules « Tournois » (clé `tournois`) et « Résultats » (clé `resultats`).
--
-- SQL standard, compatible SQLite ET PostgreSQL (mêmes conventions que 0001 : UUID et dates ISO 8601 en
-- TEXT, booléens 0/1, JSON en TEXT, aucune fonction propre à un moteur). Voir docs/esport/tournois-resultats.md.
--
-- Tout s'appuie sur le PROFIL DE JEU de la team (migration 0021) : format choisi (taille et nombre
-- d'équipes, BO), système de score (rounds avec mi-temps et prolongations, points, manches, classement),
-- maps, modes et personnages. Les adversaires sont ceux du scouting (table `adversaires`) ; un nom saisi
-- est gardé avec chaque résultat (l'historique reste lisible si la fiche est supprimée).
--
-- Les comptes (créateur, joueurs alignés, MVP) sont gardés par identifiant, sans clé étrangère : la
-- suppression d'un compte (RGPD) efface sa place dans les rosters et anonymise ses lignes de résultat
-- (le résultat de la team reste).

-- 1. Tournois. `debut` / `fin` : dates (AAAA-MM-JJ) ; `inscription_limite`, `checkin_ouverture`,
--    `checkin_limite` : instants ISO (UTC). `phases` : JSON [{ cle, type, nom }] (type : poules, simple,
--    double, suisse, championnat, libre). Montants en centimes (`*_centimes`) avec leur devise (ISO 4217).
--    `jeu` : clé du profil de jeu au moment de la création (la team peut changer de jeu ensuite).
--    `publiable` : annonces Discord et future section CM (résumé publiable).
CREATE TABLE tournois (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  nom TEXT NOT NULL,
  organisateur TEXT NOT NULL DEFAULT '',
  lien TEXT,
  jeu TEXT NOT NULL,
  format_cle TEXT,
  bo INTEGER,
  debut TEXT,
  fin TEXT,
  en_ligne INTEGER NOT NULL DEFAULT 1,
  lieu TEXT NOT NULL DEFAULT '',
  phases TEXT NOT NULL DEFAULT '[]',
  frais_centimes INTEGER,
  cashprize_centimes INTEGER,
  devise TEXT NOT NULL DEFAULT 'EUR',
  cashprize_details TEXT NOT NULL DEFAULT '',
  statut TEXT NOT NULL DEFAULT 'a_venir' CHECK (statut IN ('a_venir', 'inscrit', 'en_cours', 'termine', 'annule')),
  inscription_limite TEXT,
  checkin_ouverture TEXT,
  checkin_limite TEXT,
  inscrit_le TEXT,
  inscrit_par TEXT,
  checkin_le TEXT,
  checkin_par TEXT,
  classement_final INTEGER,
  participants INTEGER,
  gains_centimes INTEGER,
  gains_notes TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  publiable INTEGER NOT NULL DEFAULT 1,
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  supprime_le TEXT
);
CREATE INDEX tournois_team ON tournois (team_id, statut, debut);

-- 2. Roster inscrit : membres de la team, titulaires ou remplaçants (taille bornée par le profil du jeu).
CREATE TABLE tournoi_roster (
  tournoi_id TEXT NOT NULL REFERENCES tournois (id) ON DELETE CASCADE,
  compte_id TEXT NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'titulaire' CHECK (role IN ('titulaire', 'remplacant')),
  position INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL,
  PRIMARY KEY (tournoi_id, compte_id)
);
CREATE INDEX tournoi_roster_compte ON tournoi_roster (compte_id);

-- 3. Parcours (bracket simple saisi à la main) : un match par ligne, rangé par phase et par tour.
--    `adversaires` : JSON [{ id, nom }] (un pour un 1 contre 1, plusieurs pour une manche à plusieurs
--    équipes). `evenement_id` : événement du planning créé et tenu à jour automatiquement (convocation =
--    roster du tournoi). `resultat_id` : résultat détaillé (module Résultats) ; sans lui, résultat
--    rapide (`issue`, `score_texte`, `place`).
CREATE TABLE tournoi_matchs (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  tournoi_id TEXT NOT NULL REFERENCES tournois (id) ON DELETE CASCADE,
  phase TEXT,
  tour TEXT NOT NULL DEFAULT '',
  ordre INTEGER NOT NULL DEFAULT 0,
  debut TEXT,
  fin TEXT,
  bo INTEGER,
  adversaires TEXT NOT NULL DEFAULT '[]',
  evenement_id TEXT,
  resultat_id TEXT,
  statut TEXT NOT NULL DEFAULT 'a_jouer' CHECK (statut IN ('a_jouer', 'joue', 'annule')),
  issue TEXT CHECK (issue IS NULL OR issue IN ('victoire', 'defaite', 'nul', 'forfait_pour', 'forfait_contre')),
  score_texte TEXT NOT NULL DEFAULT '',
  place INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  supprime_le TEXT
);
CREATE INDEX tournoi_matchs_tournoi ON tournoi_matchs (tournoi_id, ordre);
CREATE INDEX tournoi_matchs_team ON tournoi_matchs (team_id, debut);
CREATE INDEX tournoi_matchs_evenement ON tournoi_matchs (evenement_id);

-- 4. Résultats. `genre` : match de tournoi, match officiel ou scrim. `systeme` : série (BO, une ou
--    plusieurs maps / manches) ou classement (plusieurs équipes, place et points). `score` : JSON du
--    détail validé (manches, mi-temps, prolongations, classements des manches). Colonnes calculées par
--    le serveur : `issue` (série), `place` et `points` (classement), `manches_nous` / `manches_eux`.
--    `adversaire_id` : adversaire principal (filtres) ; `adversaires` : JSON [{ id, nom, place, points }].
--    `visibilite` : toute la team (`resultats.voir`) ou staff seulement (`resultats.saisir`).
CREATE TABLE resultats (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  genre TEXT NOT NULL CHECK (genre IN ('tournoi', 'officiel', 'scrim')),
  tournoi_id TEXT,
  tournoi_match_id TEXT,
  evenement_id TEXT,
  occurrence TEXT,
  jeu TEXT NOT NULL,
  format_cle TEXT,
  systeme TEXT NOT NULL CHECK (systeme IN ('serie', 'classement')),
  bo INTEGER,
  date_match TEXT NOT NULL,
  adversaire_id TEXT,
  adversaires TEXT NOT NULL DEFAULT '[]',
  score TEXT NOT NULL DEFAULT '{}',
  issue TEXT CHECK (issue IS NULL OR issue IN ('victoire', 'defaite', 'nul')),
  forfait TEXT CHECK (forfait IS NULL OR forfait IN ('pour', 'contre')),
  manches_nous INTEGER,
  manches_eux INTEGER,
  place INTEGER,
  points INTEGER,
  participants INTEGER,
  mvp_id TEXT,
  review_id TEXT,
  visibilite TEXT NOT NULL DEFAULT 'team' CHECK (visibilite IN ('team', 'staff')),
  publiable INTEGER NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT '',
  saisi_par TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  supprime_le TEXT
);
CREATE INDEX resultats_team ON resultats (team_id, date_match);
CREATE INDEX resultats_tournoi ON resultats (tournoi_id);
CREATE INDEX resultats_adversaire ON resultats (team_id, adversaire_id);
CREATE INDEX resultats_evenement ON resultats (evenement_id);

-- 5. Manches (maps, games) d'un résultat : une ligne par manche, pour les filtres et bilans par map.
CREATE TABLE resultat_manches (
  id TEXT PRIMARY KEY,
  resultat_id TEXT NOT NULL REFERENCES resultats (id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  numero INTEGER NOT NULL,
  carte_cle TEXT,
  carte_nom TEXT NOT NULL DEFAULT '',
  mode_cle TEXT,
  mode_nom TEXT NOT NULL DEFAULT '',
  issue TEXT CHECK (issue IS NULL OR issue IN ('victoire', 'defaite', 'nul')),
  score_nous INTEGER,
  score_eux INTEGER,
  place INTEGER,
  points INTEGER,
  UNIQUE (resultat_id, numero)
);
CREATE INDEX resultat_manches_carte ON resultat_manches (team_id, carte_cle);

-- 6. Joueurs alignés : personnages joués (clés du profil), statistiques libres (JSON), MVP. `compte_id`
--    passe à NULL quand le compte est supprimé (la ligne reste, anonyme).
CREATE TABLE resultat_joueurs (
  id TEXT PRIMARY KEY,
  resultat_id TEXT NOT NULL REFERENCES resultats (id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  compte_id TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  personnages TEXT NOT NULL DEFAULT '[]',
  stats TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX resultat_joueurs_resultat ON resultat_joueurs (resultat_id);
CREATE INDEX resultat_joueurs_compte ON resultat_joueurs (compte_id);

-- 7. Rôles système des teams déjà créées : tout le monde voit tournois et résultats ; le Manager et le
--    Coach gèrent les tournois ; le staff (Manager, Coach, Analyste) saisit les résultats. Le
--    Propriétaire a tout. Les modules ne sont PAS activés d'office : Paramètres de la team › Modules.
INSERT INTO role_permissions (role_id, permission)
  SELECT id, 'tournois.voir' FROM roles WHERE systeme = 1 AND cle_systeme IN ('manager', 'coach', 'analyste', 'joueur', 'remplacant')
  ON CONFLICT (role_id, permission) DO NOTHING;
INSERT INTO role_permissions (role_id, permission)
  SELECT id, 'tournois.gerer' FROM roles WHERE systeme = 1 AND cle_systeme IN ('manager', 'coach')
  ON CONFLICT (role_id, permission) DO NOTHING;
INSERT INTO role_permissions (role_id, permission)
  SELECT id, 'resultats.voir' FROM roles WHERE systeme = 1 AND cle_systeme IN ('manager', 'coach', 'analyste', 'joueur', 'remplacant')
  ON CONFLICT (role_id, permission) DO NOTHING;
INSERT INTO role_permissions (role_id, permission)
  SELECT id, 'resultats.saisir' FROM roles WHERE systeme = 1 AND cle_systeme IN ('manager', 'coach', 'analyste')
  ON CONFLICT (role_id, permission) DO NOTHING;

