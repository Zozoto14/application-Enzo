-- Esport, migration 0037 : devblog publié automatiquement (docs/esport/devblog.md, partie « Publication automatique »).
--
-- 1. `devblog_entrees` :
--    - `origine` : « manuel » (éditeur) ou « auto » (rédigé par l'IA à partir des mises à jour déployées) ;
--    - publication PROGRAMMÉE d'un brouillon prêt : `programme_le` (instant UTC), `programme_cibles` (salons Discord,
--      JSON `["salon:…", "team:…"]`, vide = l'app seulement), `programme_here` (mention @here), `programme_par` ;
--      le cron publie à l'heure (jamais avant), puis efface la programmation ;
--    - `auto_commit` : dernière mise à jour (commit déployé) couverte par un devblog rédigé automatiquement.
-- 2. `devblog_auto` : journal du mode automatique (une ligne par passage qui a fait quelque chose, ou par
--    « Générer maintenant »). `jour` (AAAA-MM-JJ, fuseau du club) n'est rempli que pour les passages du cron :
--    UNIQUE, il garantit AU PLUS UN devblog automatique par jour, même si deux cron se chevauchent.
--    Réglages et état (dernier commit couvert) : lignes `auto` et `auto_etat` de `devblog_reglages`.
--
-- SQL standard (PostgreSQL et SQLite), mêmes conventions que 0001.

ALTER TABLE devblog_entrees ADD COLUMN origine TEXT NOT NULL DEFAULT 'manuel';
ALTER TABLE devblog_entrees ADD COLUMN programme_le TEXT;
ALTER TABLE devblog_entrees ADD COLUMN programme_cibles TEXT;
ALTER TABLE devblog_entrees ADD COLUMN programme_here INTEGER NOT NULL DEFAULT 1;
ALTER TABLE devblog_entrees ADD COLUMN programme_par TEXT;
ALTER TABLE devblog_entrees ADD COLUMN auto_commit TEXT;
CREATE INDEX devblog_entrees_programme ON devblog_entrees (programme_le);

CREATE TABLE devblog_auto (
  id TEXT PRIMARY KEY,
  jour TEXT UNIQUE,
  declencheur TEXT NOT NULL CHECK (declencheur IN ('auto', 'manuel')),
  statut TEXT NOT NULL CHECK (statut IN ('en_cours', 'rien', 'brouillon', 'publie', 'echec')),
  entree_id TEXT REFERENCES devblog_entrees (id) ON DELETE SET NULL,
  commits_lus INTEGER NOT NULL DEFAULT 0,
  commits_retenus INTEGER NOT NULL DEFAULT 0,
  moteur TEXT,
  message TEXT,
  demande_par TEXT,
  cree_le TEXT NOT NULL,
  fini_le TEXT
);
CREATE INDEX devblog_auto_cree ON devblog_auto (cree_le);
