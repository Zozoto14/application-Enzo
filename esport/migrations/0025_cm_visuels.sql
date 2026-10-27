-- Esport, migration 0025 : visuels de la section CM (charte graphique, modèles, visuels générés).
-- Voir docs/esport/visuels.md.
--
-- SQL standard, compatible SQLite ET PostgreSQL (mêmes conventions que 0001 et 0023 : UUID et dates ISO 8601
-- en TEXT, booléens 0/1, JSON en TEXT, aucune fonction propre à un moteur).
--
-- Les modèles PAR DÉFAUT (annonce de match, résultat, lineup…) sont dans le code de l'app : ils ne sont pas en
-- base et suivent toujours la charte. On n'enregistre que la charte du club, les modèles personnalisés (copie
-- d'un modèle par défaut retouchée dans l'éditeur), leurs versions et les visuels générés.

-- 1. Charte graphique du club (une seule ligne, `id` = « club ») : palette, polices, effets, logos (fichiers
--    CM déposés : `cm_fichiers`), en JSON validé par le serveur. `version` : augmente à chaque changement (un
--    visuel généré avec une version plus ancienne est signalé « charte modifiée depuis »).
CREATE TABLE cm_charte (
  id TEXT PRIMARY KEY,
  valeur TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  maj_par TEXT,
  maj_le TEXT NOT NULL
);

-- 2. Modèles personnalisés : un document par format (JSON { carre, portrait, story, paysage }), du club ou
--    d'une team (`portee`). `type` : genre de visuel (annonce, resultat, lineup…) ; `base` : modèle par défaut
--    d'origine (duplication). `version` : augmente à chaque enregistrement (les anciennes dans
--    cm_modele_versions, 30 au plus par modèle).
CREATE TABLE cm_modeles (
  id TEXT PRIMARY KEY,
  portee TEXT NOT NULL,
  team_id TEXT REFERENCES teams (id) ON DELETE CASCADE,
  nom TEXT NOT NULL,
  type TEXT NOT NULL,
  base TEXT,
  documents TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  maj_par TEXT,
  maj_le TEXT NOT NULL,
  supprime_le TEXT
);
CREATE INDEX cm_modeles_portee ON cm_modeles (portee, supprime_le);

CREATE TABLE cm_modele_versions (
  id TEXT PRIMARY KEY,
  modele_id TEXT NOT NULL REFERENCES cm_modeles (id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  nom TEXT NOT NULL,
  documents TEXT NOT NULL DEFAULT '{}',
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  UNIQUE (modele_id, version)
);

-- 3. Visuels générés. `modele` : « defaut:<type> » (modèle par défaut) ou l'identifiant d'un modèle
--    personnalisé. `source` (JSON { genre, teamId, id, date }) : d'où viennent les données (résultat, match,
--    tournoi, membre, semaine…). `document` : NULL tant que le visuel n'a pas été retouché (il suit le modèle
--    et la charte) ; sinon la copie retouchée (`retouche` = 1). `donnees_empreinte`, `charte_version`,
--    `modele_version` : état au dernier rendu (l'app propose de régénérer quand ça a changé).
--    `carte_id` / `piece_id` : carte post CM et pièce jointe du dernier rendu ; `fichier_id` : PNG / JPEG rendu.
CREATE TABLE cm_visuels (
  id TEXT PRIMARY KEY,
  portee TEXT NOT NULL,
  team_id TEXT REFERENCES teams (id) ON DELETE CASCADE,
  carte_id TEXT REFERENCES cm_cartes (id) ON DELETE SET NULL,
  piece_id TEXT,
  fichier_id TEXT,
  nom TEXT NOT NULL DEFAULT '',
  modele TEXT NOT NULL,
  type TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('carre', 'portrait', 'story', 'paysage')),
  langue TEXT NOT NULL CHECK (langue IN ('fr', 'en')),
  source TEXT NOT NULL DEFAULT '{}',
  document TEXT,
  retouche INTEGER NOT NULL DEFAULT 0,
  donnees_empreinte TEXT,
  charte_version INTEGER,
  modele_version INTEGER,
  rendu_le TEXT,
  rendu_par TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  maj_par TEXT,
  maj_le TEXT NOT NULL,
  supprime_le TEXT
);
CREATE INDEX cm_visuels_portee ON cm_visuels (portee, supprime_le, maj_le);
CREATE INDEX cm_visuels_carte ON cm_visuels (carte_id);
CREATE INDEX cm_visuels_fichier ON cm_visuels (fichier_id);

-- 4. Images importées dans l'éditeur (fond, photo, logo) : fichiers CM de la portée, utilisables dans les
--    modèles et visuels de cette portée (et du club pour toutes les teams).
CREATE TABLE cm_visuel_images (
  fichier_id TEXT PRIMARY KEY,
  portee TEXT NOT NULL,
  team_id TEXT REFERENCES teams (id) ON DELETE CASCADE,
  nom TEXT NOT NULL DEFAULT '',
  largeur INTEGER,
  hauteur INTEGER,
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  supprime_le TEXT
);
CREATE INDEX cm_visuel_images_portee ON cm_visuel_images (portee, supprime_le);
