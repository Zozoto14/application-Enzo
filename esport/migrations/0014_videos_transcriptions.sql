-- Esport, migration 0014 : vidéos déposées sur le site (review vidéo), enregistrements des réunions
-- et transcription automatique en PDF.
--
-- SQL standard, compatible SQLite / D1 ET PostgreSQL : clés textes, entiers (BIGINT sur Postgres : une
-- taille de 10 Go dépasse 32 bits), dates ISO 8601 en texte, JSON en texte, aucune fonction propre à
-- SQLite, aucune clé auto-incrémentée.
--
-- 1. Envois par morceaux (`envois`) : un fichier arrive en morceaux de quelques Mo, DANS L'ORDRE, chacun
--    vérifié (taille, SHA-256). `empreinte_etat` garde le calcul SHA-256 du fichier entier entre deux
--    morceaux (comparé à celui de l'app à la fin) ; `empreintes` : SHA-256 de chaque morceau (renvoi
--    d'un morceau déjà reçu après une coupure). Un envoi « termine » est ensuite rattaché à une review
--    ou à une réunion (`fichier_id`). Le cron efface les envois inachevés ou jamais rattachés après 24 h.
CREATE TABLE envois (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  compte_id TEXT NOT NULL,
  usage TEXT NOT NULL CHECK (usage IN ('review', 'reunion')),
  nom_original TEXT NOT NULL,
  type_annonce TEXT NOT NULL DEFAULT '',
  taille INTEGER NOT NULL,
  taille_morceau INTEGER NOT NULL,
  morceaux INTEGER NOT NULL,
  recus INTEGER NOT NULL DEFAULT 0,
  empreinte_etat TEXT NOT NULL,
  empreintes TEXT NOT NULL DEFAULT '[]',
  etiquettes TEXT NOT NULL DEFAULT '[]',
  jeton_stockage TEXT NOT NULL DEFAULT '',
  cle_stockage TEXT NOT NULL UNIQUE,
  meta_media TEXT,
  empreinte TEXT,
  statut TEXT NOT NULL DEFAULT 'en_cours' CHECK (statut IN ('en_cours', 'termine')),
  fichier_id TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL
);
CREATE INDEX envois_team ON envois (team_id, statut);
CREATE INDEX envois_menage ON envois (statut, maj_le);
CREATE INDEX envois_compte ON envois (compte_id);

-- 2. Fichiers : métadonnées (format, codecs, durée, en JSON) et suppression (les octets sont effacés,
--    la ligne reste pour l'historique). Nouveaux `entite_type` : « review_video », « reunion_enregistrement »,
--    « reunion_transcription » (le PDF de transcription, distinct du résumé « reunion »).
ALTER TABLE fichiers ADD COLUMN meta TEXT;
ALTER TABLE fichiers ADD COLUMN supprime_le TEXT;
CREATE INDEX fichiers_team_nature ON fichiers (team_id, entite_type, supprime_le);

-- 3. Review : une source, YouTube (inchangé) OU un fichier déposé (`fichier_id`). Pour un fichier,
--    `url` et `video_id` restent vides.
ALTER TABLE reviews ADD COLUMN source TEXT NOT NULL DEFAULT 'youtube';
ALTER TABLE reviews ADD COLUMN fichier_id TEXT;

-- 4. Réunions : enregistrement déposé (le lien externe devient facultatif, `lien` vide), et état de la
--    transcription : aucune, a_faire, en_cours (navigateur, partielle), externe (API serveur demandée),
--    prete, echec.
ALTER TABLE reunions ADD COLUMN enregistrement_id TEXT;
ALTER TABLE reunions ADD COLUMN transcription_statut TEXT NOT NULL DEFAULT 'aucune';
ALTER TABLE reunions ADD COLUMN transcription_pdf_id TEXT;

-- 5. Transcriptions (une par réunion) : segments horodatés `[[début, fin, texte], …]` (secondes),
--    modifiables par le déposant et les rédacteurs ; `progression` : secondes déjà transcrites (reprise
--    après une coupure) ; `pre_resume` : pré-résumé automatique très simple (phrases clés, sans IA externe).
--    `auteur_id` / `modifie_par` : NULL quand le compte est supprimé (anonymisation).
CREATE TABLE transcriptions (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  reunion_id TEXT NOT NULL UNIQUE REFERENCES reunions (id) ON DELETE CASCADE,
  langue TEXT NOT NULL DEFAULT 'fr',
  moteur TEXT NOT NULL DEFAULT '',
  segments TEXT NOT NULL DEFAULT '[]',
  duree_s REAL,
  progression_s REAL NOT NULL DEFAULT 0,
  partielle INTEGER NOT NULL DEFAULT 1 CHECK (partielle IN (0, 1)),
  pre_resume TEXT NOT NULL DEFAULT '',
  erreur TEXT NOT NULL DEFAULT '',
  auteur_id TEXT,
  modifie_par TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL
);
CREATE INDEX transcriptions_team ON transcriptions (team_id);
