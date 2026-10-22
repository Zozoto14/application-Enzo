-- Esport, migration 0016 : transcription automatique SUR LE SERVEUR (file de travaux).
--
-- SQL standard, compatible SQLite ET PostgreSQL (mêmes conventions que 0001 et 0014).
--
-- Un dépôt de réunion avec enregistrement, en mode « serveur », crée une ligne « attente ». Un
-- processus de fond (lancé par le cron, un seul à la fois) la prend (« en_cours ») avec un BAIL
-- (`verrou_jusqua`, renouvelé à chaque morceau de 30 s) : si le processus meurt (limite de
-- l'hébergeur, redémarrage), le bail expire et le travail est repris au dernier morceau enregistré
-- (`progression_s`, segments dans `transcriptions`). Réessais espacés (`essais`, `prochain_essai_le`),
-- échec définitif au-delà (`erreur` : message simple, jamais de chemin ni de secret).
--
-- `secondes_calcul` / `audio_calcule_s` : temps de calcul et durée d'audio traitée, pour estimer le
-- temps restant. `progression_prise_s` : progression au moment de la prise (un processus mort sans
-- avoir avancé compte un essai ; mort après avoir avancé : simple reprise).
--
-- Une ligne par réunion (`reunion_id` unique) : retranscrire remplace la ligne.
-- `reunions.transcription_statut` reçoit une nouvelle valeur : « serveur » (en file ou en cours).
-- Le mode par défaut de chaque team est dans `team_modules.config` du module meeting_summaries
-- (clé `transcriptionMode`) : aucune colonne à ajouter.
CREATE TABLE travaux_transcription (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  reunion_id TEXT NOT NULL UNIQUE REFERENCES reunions (id) ON DELETE CASCADE,
  statut TEXT NOT NULL DEFAULT 'attente' CHECK (statut IN ('attente', 'en_cours', 'termine', 'echec', 'annule')),
  langue TEXT NOT NULL DEFAULT 'fr',
  modele TEXT NOT NULL DEFAULT '',
  demande_par TEXT,
  essais INTEGER NOT NULL DEFAULT 0,
  prochain_essai_le TEXT,
  verrou_jusqua TEXT,
  progression_s REAL NOT NULL DEFAULT 0,
  progression_prise_s REAL NOT NULL DEFAULT 0,
  duree_s REAL,
  secondes_calcul REAL NOT NULL DEFAULT 0,
  audio_calcule_s REAL NOT NULL DEFAULT 0,
  erreur TEXT NOT NULL DEFAULT '',
  debut_le TEXT,
  fin_le TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL
);
CREATE INDEX travaux_transcription_file ON travaux_transcription (statut, prochain_essai_le, cree_le);
CREATE INDEX travaux_transcription_team ON travaux_transcription (team_id);
