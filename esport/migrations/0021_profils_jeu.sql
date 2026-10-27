-- Esport, migration 0021 : profils de jeu, assistant IA et mises à jour proposées.
--
-- SQL standard (SQLite et Postgres), mêmes conventions que 0001 (UUID et dates ISO en TEXT, booléens 0/1,
-- JSON en TEXT). Voir docs/esport/profils-jeu.md.
--
-- `jeux` : un profil par jeu (Valorant, The Finals…), géré par le Fondateur (permission globale
-- `jeux.gerer`) : en-tête (nom, couleur, icône) + données JSON validées par schéma
-- (esport/noyau/jeux/schema.mjs : formats, score, modes, maps, personnages, roster, rôles, champs libres).
-- `base` = 'valorant' : fonctions propres à Valorant (assets Riot de l'éditeur de strats).
-- `version` : numéro de la version courante ; chaque modification ajoute une ligne à `jeu_versions`.
-- `teams.jeu` (migration 0001) contient la clé du profil de la team.
CREATE TABLE jeux (
  cle TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  couleur TEXT NOT NULL DEFAULT '#8b8b9a',
  icone TEXT,
  base TEXT,
  statut TEXT NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'archive')),
  donnees TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  maj_auto INTEGER NOT NULL DEFAULT 1,
  frequence_jours INTEGER NOT NULL DEFAULT 7,
  derniere_verif_le TEXT,
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  maj_par TEXT,
  maj_le TEXT NOT NULL
);

-- Historique : chaque version d'un profil (données complètes), qui l'a faite, pourquoi, et un résumé
-- des différences avec la précédente (ajouts, modifications, retraits par section).
CREATE TABLE jeu_versions (
  id TEXT PRIMARY KEY,
  jeu_cle TEXT NOT NULL REFERENCES jeux (cle) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  nom TEXT NOT NULL,
  couleur TEXT NOT NULL,
  icone TEXT,
  donnees TEXT NOT NULL,
  motif TEXT NOT NULL,
  resume TEXT NOT NULL DEFAULT '{}',
  auteur_id TEXT,
  cree_le TEXT NOT NULL,
  UNIQUE (jeu_cle, version)
);

-- Travaux de l'assistant IA : brouillon d'un profil (« Préparer avec l'IA ») ou vérification d'un profil
-- existant (mise à jour limitée). Le résultat est une DONNÉE NON FIABLE, validée par schéma, relue par le
-- Fondateur : rien n'est enregistré dans `jeux` sans sa validation explicite.
CREATE TABLE ia_travaux (
  id TEXT PRIMARY KEY,
  genre TEXT NOT NULL CHECK (genre IN ('brouillon', 'verification')),
  jeu_cle TEXT,
  demande TEXT NOT NULL DEFAULT '{}',
  statut TEXT NOT NULL CHECK (statut IN ('attente', 'en_cours', 'pret', 'echec', 'valide', 'abandonne', 'termine')),
  declenchement TEXT NOT NULL DEFAULT 'manuel' CHECK (declenchement IN ('manuel', 'auto')),
  resultat TEXT,
  sources TEXT NOT NULL DEFAULT '[]',
  incertitudes TEXT NOT NULL DEFAULT '[]',
  avertissements TEXT NOT NULL DEFAULT '[]',
  erreur TEXT,
  demande_par TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  fini_le TEXT
);
CREATE INDEX ia_travaux_statut ON ia_travaux (statut, cree_le);
CREATE INDEX ia_travaux_jeu ON ia_travaux (jeu_cle, genre, cree_le);

-- Différences proposées par une vérification (ajout, modification, retrait d'un élément), avec sources et
-- confiance. Acceptées ou refusées une par une par le Fondateur ; jamais appliquées automatiquement.
CREATE TABLE ia_propositions (
  id TEXT PRIMARY KEY,
  jeu_cle TEXT NOT NULL REFERENCES jeux (cle) ON DELETE CASCADE,
  travail_id TEXT REFERENCES ia_travaux (id) ON DELETE SET NULL,
  section TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('ajout', 'modification', 'retrait')),
  cle_element TEXT,
  avant TEXT,
  apres TEXT,
  justification TEXT NOT NULL DEFAULT '',
  sources TEXT NOT NULL DEFAULT '[]',
  confiance TEXT NOT NULL DEFAULT 'moyenne' CHECK (confiance IN ('basse', 'moyenne', 'haute')),
  version_base INTEGER NOT NULL,
  statut TEXT NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente', 'acceptee', 'refusee', 'obsolete')),
  motif TEXT,
  decide_par TEXT,
  decide_le TEXT,
  cree_le TEXT NOT NULL
);
CREATE INDEX ia_propositions_jeu ON ia_propositions (jeu_cle, statut, cree_le);

-- Appels au fournisseur d'IA (compteur d'usage et plafond mensuel) : jamais la clé ni le contenu.
CREATE TABLE ia_appels (
  id TEXT PRIMARY KEY,
  genre TEXT NOT NULL,
  jeu_cle TEXT,
  statut TEXT NOT NULL,
  fournisseur TEXT,
  modele TEXT,
  duree_ms INTEGER,
  jetons_entree INTEGER,
  jetons_sortie INTEGER,
  erreur TEXT,
  cree_le TEXT NOT NULL
);
CREATE INDEX ia_appels_date ON ia_appels (cree_le);

-- Réglages de l'assistant IA (plafonds mensuels, vérification automatique) : Administration › IA.
CREATE TABLE ia_reglages (
  cle TEXT PRIMARY KEY,
  valeur TEXT NOT NULL,
  maj_le TEXT NOT NULL
);

-- Permissions GLOBALES (hors team) accordées par le Fondateur à un compte : `jeux.gerer` (gérer les
-- profils de jeu). Le Fondateur les a toutes.
CREATE TABLE permissions_globales (
  compte_id TEXT NOT NULL,
  permission TEXT NOT NULL,
  accorde_par TEXT,
  cree_le TEXT NOT NULL,
  PRIMARY KEY (compte_id, permission)
);

-- Profils préconfigurés (esport/noyau/jeux/valorant.mjs) : Valorant, et « Autre jeu » (générique).
INSERT INTO jeux (cle, nom, couleur, icone, base, statut, donnees, version, maj_auto, frequence_jours, cree_par, cree_le, maj_par, maj_le)
VALUES ('valorant', 'Valorant', '#ff4655', NULL, 'valorant', 'actif', '{"formats":[{"cle":"5v5","nom":"5v5","equipes":2,"joueursParEquipe":5,"bo":[1,3,5],"notes":""}],"modes":[{"cle":"competition","nom":"Compétition","description":"5v5, 13 rounds gagnants, changement de côté après 12 rounds.","formats":["5v5"],"actif":true}],"cartes":[{"cle":"abyss","nom":"Abyss","image":"https://media.valorant-api.com/maps/224b0a95-48b9-f703-1bd8-67aca101a61f/listviewicon.png","actif":true,"modes":["competition"]},{"cle":"ascent","nom":"Ascent","image":"https://media.valorant-api.com/maps/7eaecc1b-4337-bbf6-6ab9-04b8f06b3319/listviewicon.png","actif":true,"modes":["competition"]},{"cle":"bind","nom":"Bind","image":"https://media.valorant-api.com/maps/2c9d57ec-4431-9c5e-2939-8f9ef6dd5cba/listviewicon.png","actif":true,"modes":["competition"]},{"cle":"breeze","nom":"Breeze","image":"https://media.valorant-api.com/maps/2fb9a4fd-47b8-4e7d-a969-74b4046ebd53/listviewicon.png","actif":true,"modes":["competition"]},{"cle":"corrode","nom":"Corrode","image":null,"actif":true,"modes":["competition"]},{"cle":"fracture","nom":"Fracture","image":"https://media.valorant-api.com/maps/b529448b-4d60-346e-e89e-00a4c527a405/listviewicon.png","actif":true,"modes":["competition"]},{"cle":"haven","nom":"Haven","image":"https://media.valorant-api.com/maps/2bee0dc9-4ffe-519b-1cbd-7fbe763a6047/listviewicon.png","actif":true,"modes":["competition"]},{"cle":"icebox","nom":"Icebox","image":"https://media.valorant-api.com/maps/e2ad5c54-4114-a870-9641-8ea21279579a/listviewicon.png","actif":true,"modes":["competition"]},{"cle":"lotus","nom":"Lotus","image":"https://media.valorant-api.com/maps/2fe4ed3a-450a-948b-6d6b-e89a78e680a9/listviewicon.png","actif":true,"modes":["competition"]},{"cle":"pearl","nom":"Pearl","image":"https://media.valorant-api.com/maps/fd267378-4d1d-484f-ff52-77821ed10dc2/listviewicon.png","actif":true,"modes":["competition"]},{"cle":"split","nom":"Split","image":"https://media.valorant-api.com/maps/d960549e-485c-e861-8d71-aa9d1aed12a2/listviewicon.png","actif":true,"modes":["competition"]},{"cle":"sunset","nom":"Sunset","image":"https://media.valorant-api.com/maps/92584fbe-486a-b1b2-9faa-39b0f486b498/listviewicon.png","actif":true,"modes":["competition"]}],"classes":[{"cle":"duelliste","nom":"Duelliste"},{"cle":"initiateur","nom":"Initiateur"},{"cle":"controleur","nom":"Contrôleur"},{"cle":"sentinelle","nom":"Sentinelle"}],"personnages":[{"cle":"astra","nom":"Astra","classe":"controleur","image":null,"actif":true},{"cle":"breach","nom":"Breach","classe":"initiateur","image":null,"actif":true},{"cle":"brimstone","nom":"Brimstone","classe":"controleur","image":null,"actif":true},{"cle":"chamber","nom":"Chamber","classe":"sentinelle","image":null,"actif":true},{"cle":"clove","nom":"Clove","classe":"controleur","image":null,"actif":true},{"cle":"cypher","nom":"Cypher","classe":"sentinelle","image":null,"actif":true},{"cle":"deadlock","nom":"Deadlock","classe":"sentinelle","image":null,"actif":true},{"cle":"fade","nom":"Fade","classe":"initiateur","image":null,"actif":true},{"cle":"gekko","nom":"Gekko","classe":"initiateur","image":null,"actif":true},{"cle":"harbor","nom":"Harbor","classe":"controleur","image":null,"actif":true},{"cle":"iso","nom":"Iso","classe":"duelliste","image":null,"actif":true},{"cle":"jett","nom":"Jett","classe":"duelliste","image":null,"actif":true},{"cle":"kay-o","nom":"KAY/O","classe":"initiateur","image":null,"actif":true},{"cle":"killjoy","nom":"Killjoy","classe":"sentinelle","image":null,"actif":true},{"cle":"neon","nom":"Neon","classe":"duelliste","image":null,"actif":true},{"cle":"omen","nom":"Omen","classe":"controleur","image":null,"actif":true},{"cle":"phoenix","nom":"Phoenix","classe":"duelliste","image":null,"actif":true},{"cle":"raze","nom":"Raze","classe":"duelliste","image":null,"actif":true},{"cle":"reyna","nom":"Reyna","classe":"duelliste","image":null,"actif":true},{"cle":"sage","nom":"Sage","classe":"sentinelle","image":null,"actif":true},{"cle":"skye","nom":"Skye","classe":"initiateur","image":null,"actif":true},{"cle":"sova","nom":"Sova","classe":"initiateur","image":null,"actif":true},{"cle":"tejo","nom":"Tejo","classe":"initiateur","image":null,"actif":true},{"cle":"viper","nom":"Viper","classe":"controleur","image":null,"actif":true},{"cle":"vyse","nom":"Vyse","classe":"sentinelle","image":null,"actif":true},{"cle":"waylay","nom":"Waylay","classe":"duelliste","image":null,"actif":true},{"cle":"yoru","nom":"Yoru","classe":"duelliste","image":null,"actif":true}],"rolesJoueurs":[{"cle":"duelliste","nom":"Duelliste"},{"cle":"controleur","nom":"Contrôleur"},{"cle":"initiateur","nom":"Initiateur"},{"cle":"sentinelle","nom":"Sentinelle"},{"cle":"flex","nom":"Flex"},{"cle":"igl","nom":"IGL"}],"champs":[],"score":{"type":"rounds","roundsGagnants":13,"roundsParMiTemps":12,"prolongations":{"active":true,"regle":"À 12-12 : prolongations, victoire avec deux rounds d’écart."},"notes":""},"roster":{"titulaires":5,"remplacants":2},"libelles":{"personnages":"Agents","classes":"Rôles","cartes":"Maps"},"sources":[{"url":"https://playvalorant.com/fr-fr/","titre":"Site officiel"},{"url":"https://liquipedia.net/valorant/Main_Page","titre":"Liquipedia"}]}', 1, 1, 7, NULL, '2026-10-27T00:00:00.000Z', NULL, '2026-10-27T00:00:00.000Z');
INSERT INTO jeu_versions (id, jeu_cle, version, nom, couleur, icone, donnees, motif, resume, auteur_id, cree_le)
VALUES ('preconfiguration-valorant', 'valorant', 1, 'Valorant', '#ff4655', NULL, '{"formats":[{"cle":"5v5","nom":"5v5","equipes":2,"joueursParEquipe":5,"bo":[1,3,5],"notes":""}],"modes":[{"cle":"competition","nom":"Compétition","description":"5v5, 13 rounds gagnants, changement de côté après 12 rounds.","formats":["5v5"],"actif":true}],"cartes":[{"cle":"abyss","nom":"Abyss","image":"https://media.valorant-api.com/maps/224b0a95-48b9-f703-1bd8-67aca101a61f/listviewicon.png","actif":true,"modes":["competition"]},{"cle":"ascent","nom":"Ascent","image":"https://media.valorant-api.com/maps/7eaecc1b-4337-bbf6-6ab9-04b8f06b3319/listviewicon.png","actif":true,"modes":["competition"]},{"cle":"bind","nom":"Bind","image":"https://media.valorant-api.com/maps/2c9d57ec-4431-9c5e-2939-8f9ef6dd5cba/listviewicon.png","actif":true,"modes":["competition"]},{"cle":"breeze","nom":"Breeze","image":"https://media.valorant-api.com/maps/2fb9a4fd-47b8-4e7d-a969-74b4046ebd53/listviewicon.png","actif":true,"modes":["competition"]},{"cle":"corrode","nom":"Corrode","image":null,"actif":true,"modes":["competition"]},{"cle":"fracture","nom":"Fracture","image":"https://media.valorant-api.com/maps/b529448b-4d60-346e-e89e-00a4c527a405/listviewicon.png","actif":true,"modes":["competition"]},{"cle":"haven","nom":"Haven","image":"https://media.valorant-api.com/maps/2bee0dc9-4ffe-519b-1cbd-7fbe763a6047/listviewicon.png","actif":true,"modes":["competition"]},{"cle":"icebox","nom":"Icebox","image":"https://media.valorant-api.com/maps/e2ad5c54-4114-a870-9641-8ea21279579a/listviewicon.png","actif":true,"modes":["competition"]},{"cle":"lotus","nom":"Lotus","image":"https://media.valorant-api.com/maps/2fe4ed3a-450a-948b-6d6b-e89a78e680a9/listviewicon.png","actif":true,"modes":["competition"]},{"cle":"pearl","nom":"Pearl","image":"https://media.valorant-api.com/maps/fd267378-4d1d-484f-ff52-77821ed10dc2/listviewicon.png","actif":true,"modes":["competition"]},{"cle":"split","nom":"Split","image":"https://media.valorant-api.com/maps/d960549e-485c-e861-8d71-aa9d1aed12a2/listviewicon.png","actif":true,"modes":["competition"]},{"cle":"sunset","nom":"Sunset","image":"https://media.valorant-api.com/maps/92584fbe-486a-b1b2-9faa-39b0f486b498/listviewicon.png","actif":true,"modes":["competition"]}],"classes":[{"cle":"duelliste","nom":"Duelliste"},{"cle":"initiateur","nom":"Initiateur"},{"cle":"controleur","nom":"Contrôleur"},{"cle":"sentinelle","nom":"Sentinelle"}],"personnages":[{"cle":"astra","nom":"Astra","classe":"controleur","image":null,"actif":true},{"cle":"breach","nom":"Breach","classe":"initiateur","image":null,"actif":true},{"cle":"brimstone","nom":"Brimstone","classe":"controleur","image":null,"actif":true},{"cle":"chamber","nom":"Chamber","classe":"sentinelle","image":null,"actif":true},{"cle":"clove","nom":"Clove","classe":"controleur","image":null,"actif":true},{"cle":"cypher","nom":"Cypher","classe":"sentinelle","image":null,"actif":true},{"cle":"deadlock","nom":"Deadlock","classe":"sentinelle","image":null,"actif":true},{"cle":"fade","nom":"Fade","classe":"initiateur","image":null,"actif":true},{"cle":"gekko","nom":"Gekko","classe":"initiateur","image":null,"actif":true},{"cle":"harbor","nom":"Harbor","classe":"controleur","image":null,"actif":true},{"cle":"iso","nom":"Iso","classe":"duelliste","image":null,"actif":true},{"cle":"jett","nom":"Jett","classe":"duelliste","image":null,"actif":true},{"cle":"kay-o","nom":"KAY/O","classe":"initiateur","image":null,"actif":true},{"cle":"killjoy","nom":"Killjoy","classe":"sentinelle","image":null,"actif":true},{"cle":"neon","nom":"Neon","classe":"duelliste","image":null,"actif":true},{"cle":"omen","nom":"Omen","classe":"controleur","image":null,"actif":true},{"cle":"phoenix","nom":"Phoenix","classe":"duelliste","image":null,"actif":true},{"cle":"raze","nom":"Raze","classe":"duelliste","image":null,"actif":true},{"cle":"reyna","nom":"Reyna","classe":"duelliste","image":null,"actif":true},{"cle":"sage","nom":"Sage","classe":"sentinelle","image":null,"actif":true},{"cle":"skye","nom":"Skye","classe":"initiateur","image":null,"actif":true},{"cle":"sova","nom":"Sova","classe":"initiateur","image":null,"actif":true},{"cle":"tejo","nom":"Tejo","classe":"initiateur","image":null,"actif":true},{"cle":"viper","nom":"Viper","classe":"controleur","image":null,"actif":true},{"cle":"vyse","nom":"Vyse","classe":"sentinelle","image":null,"actif":true},{"cle":"waylay","nom":"Waylay","classe":"duelliste","image":null,"actif":true},{"cle":"yoru","nom":"Yoru","classe":"duelliste","image":null,"actif":true}],"rolesJoueurs":[{"cle":"duelliste","nom":"Duelliste"},{"cle":"controleur","nom":"Contrôleur"},{"cle":"initiateur","nom":"Initiateur"},{"cle":"sentinelle","nom":"Sentinelle"},{"cle":"flex","nom":"Flex"},{"cle":"igl","nom":"IGL"}],"champs":[],"score":{"type":"rounds","roundsGagnants":13,"roundsParMiTemps":12,"prolongations":{"active":true,"regle":"À 12-12 : prolongations, victoire avec deux rounds d’écart."},"notes":""},"roster":{"titulaires":5,"remplacants":2},"libelles":{"personnages":"Agents","classes":"Rôles","cartes":"Maps"},"sources":[{"url":"https://playvalorant.com/fr-fr/","titre":"Site officiel"},{"url":"https://liquipedia.net/valorant/Main_Page","titre":"Liquipedia"}]}', 'preconfiguration', '{}', NULL, '2026-10-27T00:00:00.000Z');

INSERT INTO jeux (cle, nom, couleur, icone, base, statut, donnees, version, maj_auto, frequence_jours, cree_par, cree_le, maj_par, maj_le)
VALUES ('autre', 'Autre jeu', '#8b8b9a', NULL, NULL, 'actif', '{"formats":[],"modes":[],"cartes":[],"classes":[],"personnages":[],"rolesJoueurs":[],"champs":[],"score":null,"roster":null,"libelles":{},"sources":[]}', 1, 0, 7, NULL, '2026-10-27T00:00:00.000Z', NULL, '2026-10-27T00:00:00.000Z');
INSERT INTO jeu_versions (id, jeu_cle, version, nom, couleur, icone, donnees, motif, resume, auteur_id, cree_le)
VALUES ('preconfiguration-autre', 'autre', 1, 'Autre jeu', '#8b8b9a', NULL, '{"formats":[],"modes":[],"cartes":[],"classes":[],"personnages":[],"rolesJoueurs":[],"champs":[],"score":null,"roster":null,"libelles":{},"sources":[]}', 'preconfiguration', '{}', NULL, '2026-10-27T00:00:00.000Z');

-- Teams existantes : rattachées à leur profil ; toute valeur inconnue (ou vide) devient Valorant.
UPDATE teams SET jeu = 'valorant' WHERE jeu IS NULL OR jeu NOT IN ('valorant', 'autre');
