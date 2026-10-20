-- Esport, migration 0013 : refonte de la présence et suivi des joueurs (notes du staff).
--
-- SQL standard, compatible SQLite / D1 ET PostgreSQL : insertions idempotentes
-- par ON CONFLICT DO NOTHING, clés textes, booléens en entiers 0/1,
-- dates ISO 8601 en texte, aucune fonction propre à SQLite.
--
-- 1. Présence. Une ligne de `presences` porte désormais :
--    - ce que le JOUEUR annonce à l'avance avec sa réponse : `retard_prevu`
--      (minutes, « je serai en retard de X min », NULL sinon) et `motif_prevu`
--      (« absent : motif ») ;
--    - ce que le STAFF constate : `retard_minutes` (minutes de retard réelles,
--      facultatives, avec « En retard ») et `motif` (motif d'une absence ou d'une
--      excuse, facultatif) ;
--    - `hors_convocation` = 1 : un membre NON convoqué venu quand même (un
--      remplaçant…), ajouté par le staff. Il apparaît dans la feuille d'appel et
--      l'export CSV, mais n'entre JAMAIS dans les taux (seuls les convoqués
--      comptent) ; les statistiques le montrent à part (« venues en plus »).
--    Les anciennes lignes gardent leurs valeurs (colonnes vides, 0).
ALTER TABLE presences ADD COLUMN retard_prevu INTEGER;
ALTER TABLE presences ADD COLUMN motif_prevu TEXT NOT NULL DEFAULT '';
ALTER TABLE presences ADD COLUMN retard_minutes INTEGER;
ALTER TABLE presences ADD COLUMN motif TEXT NOT NULL DEFAULT '';
ALTER TABLE presences ADD COLUMN hors_convocation INTEGER NOT NULL DEFAULT 0;

-- 2. Suivi des joueurs (module `player_notes`, activable par team, section
--    Équipe) : notes du staff sur un joueur. Une note est une DONNÉE PERSONNELLE
--    du joueur concerné (voir docs/esport/suivi-joueurs.md, règle RGPD).
--    - `contenu` : texte riche (Markdown limité de ChampNote) ;
--    - `categorie`, `ton`, `tags` (JSON, liste de textes courts) ;
--    - lien facultatif : un événement du planning (et son occurrence), une
--      review vidéo ou un repère de review, de la même team ;
--    - `epinglee` (0/1) : en tête de la fiche ;
--    - `partagee` (0/1, 0 par défaut) : le joueur voit CETTE note, en lecture,
--      dans son profil ; `auteur_masque` (0/1) : sans le nom de l'auteur ;
--    - `auteur_id` NULL : auteur dont le compte a été supprimé (anonymisation).
--    Le joueur concerné ne voit JAMAIS une note non partagée, même s'il a les
--    permissions du module. Suppression : définitive (pas de corbeille).
CREATE TABLE notes_joueurs (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  joueur_id TEXT NOT NULL,
  auteur_id TEXT,
  categorie TEXT NOT NULL CHECK (categorie IN ('performance', 'mental', 'communication', 'comportement', 'objectif', 'autre')),
  ton TEXT NOT NULL DEFAULT 'neutre' CHECK (ton IN ('positif', 'a_travailler', 'neutre')),
  contenu TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  lien_type TEXT CHECK (lien_type IS NULL OR lien_type IN ('evenement', 'review', 'repere')),
  lien_id TEXT,
  lien_occurrence TEXT,
  date_note TEXT NOT NULL,
  epinglee INTEGER NOT NULL DEFAULT 0 CHECK (epinglee IN (0, 1)),
  partagee INTEGER NOT NULL DEFAULT 0 CHECK (partagee IN (0, 1)),
  auteur_masque INTEGER NOT NULL DEFAULT 0 CHECK (auteur_masque IN (0, 1)),
  partagee_le TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL
);
CREATE INDEX notes_joueurs_fiche ON notes_joueurs (team_id, joueur_id, date_note);
CREATE INDEX notes_joueurs_joueur ON notes_joueurs (joueur_id);
CREATE INDEX notes_joueurs_auteur ON notes_joueurs (auteur_id);

-- 3. Permissions du module, données aux rôles système du staff des teams déjà
--    créées (idempotent ; rôles personnalisés inchangés ; le Propriétaire a
--    tout) : voir et écrire pour Coach, Analyste et Manager ; supprimer pour
--    Coach et Manager. Jamais aux rôles Joueur et Remplaçant.
INSERT INTO role_permissions (role_id, permission)
  SELECT id, 'player_notes.view' FROM roles WHERE systeme = 1 AND cle_systeme IN ('manager', 'coach', 'analyste')
  ON CONFLICT (role_id, permission) DO NOTHING;
INSERT INTO role_permissions (role_id, permission)
  SELECT id, 'player_notes.write' FROM roles WHERE systeme = 1 AND cle_systeme IN ('manager', 'coach', 'analyste')
  ON CONFLICT (role_id, permission) DO NOTHING;
INSERT INTO role_permissions (role_id, permission)
  SELECT id, 'player_notes.delete' FROM roles WHERE systeme = 1 AND cle_systeme IN ('manager', 'coach')
  ON CONFLICT (role_id, permission) DO NOTHING;
