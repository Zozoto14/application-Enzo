-- Esport, migration 0057 : libellé propre d'un bouton de panneau de tickets (docs/esport/tickets.md, « Panneaux par
-- défaut »).
--
-- Demande du Fondateur : « fais un panneau pour les tickets », puis un panneau d'inscription à un tournoi dont le
-- bouton dit « S'inscrire · Register » plutôt que le nom de la catégorie.
--
-- `tickets_panneaux.libelles` : JSON { "<id de catégorie>": { "fr": "…", "en": "…" } } ; un bouton (panneau à
--   boutons) prend ce libellé à la place du nom de sa catégorie (80 caractères au plus, bilingue comme les autres
--   libellés). Vide ou absent : nom de la catégorie, comme avant. Le menu déroulant garde les noms des catégories.
--
-- SQL standard (PostgreSQL et SQLite).

ALTER TABLE tickets_panneaux ADD COLUMN libelles TEXT NOT NULL DEFAULT '{}';
