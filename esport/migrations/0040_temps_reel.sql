-- Esport, migration 0040 : synchronisation en temps réel et « le premier qui enregistre a la main »
-- (docs/esport/temps-reel.md).
--
-- 1. `temps_reel_flux` : journal court des changements diffusés (« l'objet T id I version V a changé »), SANS
--    aucune donnée métier : un sujet (`team:<id>:<module>`, `cm`, `cm:drive`, `sponsors`, `trombi`, `compte:<id>`…),
--    la clé de l'objet et la route GET qui sert de contrôle d'accès (`sonde`), l'auteur. L'identifiant croissant
--    sert de curseur (`dernierId`) ; il est attribué par le serveur (plus grand + 1, sans trou
--    possible entre deux écritures validées) : un navigateur revenu après une coupure rejoue ce qu'il a manqué. Purgé au bout
--    de deux heures (au-delà, l'app recharge tout). Entre processus Node (pool Passenger) : PostgreSQL
--    LISTEN/NOTIFY ; ce tableau est la mémoire commune.
-- 2. `temps_reel_versions` : version de chaque objet modifiable (verrou optimiste généralisé). Toute modification
--    (PATCH, PUT, DELETE) de l'objet l'augmente ; une modification qui annonce la version lue (`X-Version-Lue`)
--    est refusée (409 `conflit-version`) si quelqu'un a enregistré entre-temps.
-- 3. `temps_reel_presences` : « X est en train de modifier » (pastille), expire seule (battement de l'app).
--
-- SQL standard (PostgreSQL et SQLite), mêmes conventions que 0001.

CREATE TABLE temps_reel_flux (
  id INTEGER PRIMARY KEY,
  sujet TEXT NOT NULL,
  cle TEXT,
  sonde TEXT,
  objet_public INTEGER NOT NULL DEFAULT 0,
  version INTEGER,
  action TEXT,
  acteur TEXT,
  pseudo TEXT,
  invalider INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL
);
CREATE INDEX temps_reel_flux_cree ON temps_reel_flux (cree_le);
CREATE INDEX temps_reel_flux_sujet ON temps_reel_flux (sujet, cree_le);

CREATE TABLE temps_reel_versions (
  cle TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  maj_par TEXT,
  maj_le TEXT NOT NULL
);

CREATE TABLE temps_reel_presences (
  cle TEXT NOT NULL,
  compte_id TEXT NOT NULL,
  pseudo TEXT,
  jusqua TEXT NOT NULL,
  PRIMARY KEY (cle, compte_id)
);
CREATE INDEX temps_reel_presences_jusqua ON temps_reel_presences (jusqua);
