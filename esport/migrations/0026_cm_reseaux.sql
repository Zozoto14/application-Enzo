-- Migration 0026 : page « Réseaux » de l'espace CM (docs/esport/reseaux-stats.md).
--
--  1. comptes du club et des teams sur les réseaux (X, Instagram, TikTok, YouTube, Twitch…) ;
--  2. bot d'annonce Discord : quand un post CM est publié (adresse du post saisie), un message part dans les
--     salons choisis pour le compte (salon Discord d'une team, ou salon du club : webhook chiffré) — anglais
--     d'abord, version française dans un fil, comme les autres messages Discord ; une ligne par post, réseau et
--     salon (idempotent : modifier la carte ne reposte rien ; une adresse changée réédite le message) ;
--  3. statistiques saisies à la main (V1) : relevés datés par publication et par compte.
--
-- SQL standard (PostgreSQL et SQLite). Aucune donnée existante n'est modifiée.

-- 1. Salons Discord du club : webhook propre, CHIFFRÉ comme celui des teams (AES-GCM 256, donnée associée
--    « reseaux:<id> ») ; seuls ses 4 derniers caractères sont gardés en clair (`fin`).
CREATE TABLE cm_rs_salons (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  url_chiffree TEXT NOT NULL,
  fin TEXT NOT NULL,
  fil_fr INTEGER NOT NULL DEFAULT 1,
  langue TEXT NOT NULL DEFAULT 'fr' CHECK (langue IN ('fr', 'en')),
  bloque_jusqua TEXT,
  dernier_succes_le TEXT,
  dernier_echec_le TEXT,
  invalide_le TEXT,
  dernier_test_le TEXT,
  -- Dernière alerte « fil français impossible » postée dans ce salon (au plus une par 24 h).
  alerte_fil_le TEXT,
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL
);

-- 2. Comptes sur les réseaux : du club (`team_id` NULL) ou d'une team ; annonce Discord réglable par compte
--    (modèles anglais / français avec variables, rôle à mentionner, salons cibles en 3.).
CREATE TABLE cm_rs_comptes (
  id TEXT PRIMARY KEY,
  reseau TEXT NOT NULL,
  identifiant TEXT NOT NULL,
  url TEXT NOT NULL,
  nom TEXT NOT NULL DEFAULT '',
  team_id TEXT REFERENCES teams (id) ON DELETE CASCADE,
  actif INTEGER NOT NULL DEFAULT 1,
  annonce_active INTEGER NOT NULL DEFAULT 0,
  modele_en TEXT,
  modele_fr TEXT,
  role_mention TEXT,
  position REAL NOT NULL DEFAULT 0,
  dernier_test_le TEXT,
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  maj_par TEXT,
  maj_le TEXT NOT NULL,
  supprime_le TEXT
);
CREATE INDEX cm_rs_comptes_reseau ON cm_rs_comptes (reseau, supprime_le);
CREATE INDEX cm_rs_comptes_team ON cm_rs_comptes (team_id);

-- 3. Salons cibles de l'annonce d'un compte : le salon Discord d'une team (bot lié, sinon son webhook) ou un
--    salon du club (1.). `cle` : « team:<id> » ou « salon:<id> ».
CREATE TABLE cm_rs_cibles (
  compte_id TEXT NOT NULL REFERENCES cm_rs_comptes (id) ON DELETE CASCADE,
  cle TEXT NOT NULL,
  genre TEXT NOT NULL CHECK (genre IN ('team', 'salon')),
  team_id TEXT REFERENCES teams (id) ON DELETE CASCADE,
  salon_id TEXT REFERENCES cm_rs_salons (id) ON DELETE CASCADE,
  PRIMARY KEY (compte_id, cle)
);
CREATE INDEX cm_rs_cibles_team ON cm_rs_cibles (team_id);
CREATE INDEX cm_rs_cibles_salon ON cm_rs_cibles (salon_id);

-- 4. Publications suivies (statistiques) : une par post CM publié et par réseau (créée à la publication), ou
--    ajoutée à la main / par import CSV (vidéo YouTube, post hors CM…). Rappels J+1 / J+7 au CM.
CREATE TABLE cm_rs_publications (
  id TEXT PRIMARY KEY,
  carte_id TEXT REFERENCES cm_cartes (id) ON DELETE SET NULL,
  reseau TEXT NOT NULL,
  compte_id TEXT REFERENCES cm_rs_comptes (id) ON DELETE SET NULL,
  url TEXT NOT NULL,
  titre TEXT NOT NULL DEFAULT '',
  type_contenu TEXT NOT NULL DEFAULT 'autre',
  team_id TEXT REFERENCES teams (id) ON DELETE SET NULL,
  publie_le TEXT NOT NULL,
  video INTEGER NOT NULL DEFAULT 0,
  rappels INTEGER NOT NULL DEFAULT 1,
  rappel_j1_le TEXT,
  rappel_j7_le TEXT,
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  maj_par TEXT,
  maj_le TEXT NOT NULL,
  supprime_le TEXT,
  UNIQUE (carte_id, reseau)
);
CREATE INDEX cm_rs_publications_date ON cm_rs_publications (publie_le, supprime_le);
CREATE INDEX cm_rs_publications_url ON cm_rs_publications (url);
CREATE INDEX cm_rs_publications_compte ON cm_rs_publications (compte_id);

-- 5. Relevés datés d'une publication (un par jour : une nouvelle saisie du même jour remplace l'ancienne).
--    Valeurs facultatives (NULL : non relevé). `duree_moyenne` en secondes, `taux_completion` en %.
CREATE TABLE cm_rs_releves_posts (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES cm_rs_publications (id) ON DELETE CASCADE,
  jour TEXT NOT NULL,
  vues INTEGER,
  likes INTEGER,
  commentaires INTEGER,
  partages INTEGER,
  enregistrements INTEGER,
  impressions INTEGER,
  portee INTEGER,
  clics INTEGER,
  duree_moyenne REAL,
  taux_completion REAL,
  source TEXT NOT NULL DEFAULT 'manuel',
  saisi_par TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  UNIQUE (publication_id, jour)
);

-- 6. Relevés datés d'un compte (abonnés, publications, vues et impressions de la période).
CREATE TABLE cm_rs_releves_comptes (
  id TEXT PRIMARY KEY,
  compte_id TEXT NOT NULL REFERENCES cm_rs_comptes (id) ON DELETE CASCADE,
  jour TEXT NOT NULL,
  abonnes INTEGER,
  publications INTEGER,
  vues INTEGER,
  impressions INTEGER,
  source TEXT NOT NULL DEFAULT 'manuel',
  saisi_par TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  UNIQUE (compte_id, jour)
);

-- 7. Annonces Discord des posts publiés : file d'envoi ET mémoire (une ligne par post, réseau et salon).
--    Étapes reprenables comme la file Discord des teams : message principal (`message_id`), fil (`fil_id`),
--    version française (`fr_message_id`). `url_annoncee` : adresse montrée par le message posté (une adresse
--    changée repasse la ligne en « editer »).
CREATE TABLE cm_rs_annonces (
  id TEXT PRIMARY KEY,
  carte_id TEXT NOT NULL REFERENCES cm_cartes (id) ON DELETE CASCADE,
  reseau TEXT NOT NULL,
  compte_id TEXT,
  cible TEXT NOT NULL,
  team_id TEXT,
  salon_id TEXT,
  url_post TEXT NOT NULL,
  url_annoncee TEXT,
  operation TEXT NOT NULL DEFAULT 'poster' CHECK (operation IN ('poster', 'editer')),
  statut TEXT NOT NULL DEFAULT 'attente' CHECK (statut IN ('attente', 'envoye', 'abandonne')),
  essais INTEGER NOT NULL DEFAULT 0,
  prochain_essai_le TEXT NOT NULL,
  verrou_jusqua TEXT,
  derniere_erreur TEXT,
  expire_le TEXT NOT NULL,
  canal TEXT,
  langue TEXT,
  fil INTEGER NOT NULL DEFAULT 0,
  forum INTEGER NOT NULL DEFAULT 0,
  message_id TEXT,
  message_salon_id TEXT,
  fil_id TEXT,
  fr_message_id TEXT,
  image_url TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  envoye_le TEXT,
  UNIQUE (carte_id, reseau, cible)
);
CREATE INDEX cm_rs_annonces_attente ON cm_rs_annonces (statut, prochain_essai_le);
