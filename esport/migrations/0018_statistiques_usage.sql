-- Esport, migration 0018 : statistiques d'usage internes (page « Statistiques », réservée au Fondateur).
--
-- SQL standard, compatible SQLite / D1 ET PostgreSQL (mêmes conventions que 0001 : UUID et dates ISO 8601
-- en TEXT, booléens 0/1, JSON en TEXT, aucune fonction propre à un moteur). Voir docs/esport/statistiques.md.
--
-- Confidentialité : uniquement des MÉTADONNÉES d'usage (page ouverte, durée, action clé, type d'appareil,
-- langue, message d'erreur JS tronqué). Jamais de contenu saisi, jamais d'adresse IP, aucun traceur tiers.
-- Exportées avec les données du membre (RGPD) et effacées avec son compte.

-- 1. Détail brut, envoyé par l'app par lots (POST /usage) : gardé 90 jours, puis purgé par le cron
--    (après agrégation). `genre` : page (ouverture + durée), action (action clé), erreur (exception JS).
--    `page` : identifiant de route stable (« team.agenda.planning ») ; `session_id` : identifiant tiré au
--    hasard par l'app à chaque ouverture (aucun lien avec la session de connexion).
CREATE TABLE usage_evenements (
  id TEXT PRIMARY KEY,
  compte_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  genre TEXT NOT NULL CHECK (genre IN ('page', 'action', 'erreur')),
  page TEXT,
  team_id TEXT,
  action TEXT,
  duree_ms INTEGER NOT NULL DEFAULT 0,
  appareil TEXT NOT NULL CHECK (appareil IN ('pc', 'tablette', 'telephone', 'app_pc', 'discord')),
  langue TEXT NOT NULL DEFAULT 'fr',
  message TEXT,
  cree_le TEXT NOT NULL
);
CREATE INDEX usage_evenements_date ON usage_evenements (cree_le);
CREATE INDEX usage_evenements_compte ON usage_evenements (compte_id, cree_le);

-- 2. Agrégats journaliers (jour civil de Paris, AAAA-MM-JJ), calculés une fois par jour par le cron,
--    conservés sans limite de durée. Une ligne par combinaison : les filtres team / rôle / appareil et les
--    visiteurs uniques restent exacts sur n'importe quelle période. `team_id` vaut '' hors d'une team.
--    Par page (et par membre, par team, par appareil) :
CREATE TABLE usage_jour_pages (
  jour TEXT NOT NULL,
  compte_id TEXT NOT NULL,
  team_id TEXT NOT NULL DEFAULT '',
  page TEXT NOT NULL,
  appareil TEXT NOT NULL,
  vues INTEGER NOT NULL DEFAULT 0,
  duree_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (jour, compte_id, team_id, page, appareil)
);
CREATE INDEX usage_jour_pages_compte ON usage_jour_pages (compte_id, jour);

--    Par membre et par appareil : sessions, temps, actions, erreurs, première et dernière activité du jour.
CREATE TABLE usage_jour_membres (
  jour TEXT NOT NULL,
  compte_id TEXT NOT NULL,
  appareil TEXT NOT NULL,
  langue TEXT NOT NULL DEFAULT 'fr',
  sessions INTEGER NOT NULL DEFAULT 0,
  vues INTEGER NOT NULL DEFAULT 0,
  duree_ms INTEGER NOT NULL DEFAULT 0,
  actions INTEGER NOT NULL DEFAULT 0,
  erreurs INTEGER NOT NULL DEFAULT 0,
  premiere TEXT NOT NULL,
  derniere TEXT NOT NULL,
  PRIMARY KEY (jour, compte_id, appareil)
);
CREATE INDEX usage_jour_membres_compte ON usage_jour_membres (compte_id, jour);

--    Actions clés (par membre, par team, par appareil).
CREATE TABLE usage_jour_actions (
  jour TEXT NOT NULL,
  compte_id TEXT NOT NULL,
  team_id TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  appareil TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (jour, compte_id, team_id, action, appareil)
);
CREATE INDEX usage_jour_actions_compte ON usage_jour_actions (compte_id, jour);

--    Heures (carte de chaleur heure × jour de la semaine, heure de Paris).
CREATE TABLE usage_jour_heures (
  jour TEXT NOT NULL,
  heure INTEGER NOT NULL,
  compte_id TEXT NOT NULL,
  team_id TEXT NOT NULL DEFAULT '',
  appareil TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (jour, heure, compte_id, team_id, appareil)
);
CREATE INDEX usage_jour_heures_compte ON usage_jour_heures (compte_id, jour);

--    Erreurs JS (qualité) : empreinte du message normalisé, page, membre touché.
CREATE TABLE usage_jour_erreurs (
  jour TEXT NOT NULL,
  empreinte TEXT NOT NULL,
  page TEXT NOT NULL DEFAULT '',
  compte_id TEXT NOT NULL,
  appareil TEXT NOT NULL,
  message TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (jour, empreinte, page, compte_id, appareil)
);
CREATE INDEX usage_jour_erreurs_compte ON usage_jour_erreurs (compte_id, jour);

-- 3. Réglages et état : `collecte` ('1' / '0', le Fondateur peut la couper), `debut_collecte` (premier jour
--    mesuré : avant, l'écran reconstitue une partie de l'historique depuis le journal), `agrege_jusqua`
--    (jours strictement antérieurs déjà agrégés).
CREATE TABLE usage_reglages (
  cle TEXT PRIMARY KEY,
  valeur TEXT NOT NULL,
  maj_le TEXT NOT NULL
);
