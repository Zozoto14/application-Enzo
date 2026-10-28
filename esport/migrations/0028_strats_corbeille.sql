-- Esport, migration 0028 : corbeille des strats (30 jours).
--
-- La suppression d'une strat ou d'une entrée du playbook était déjà « douce » (`supprime_le`) ; on garde en
-- plus QUI l'a supprimée, pour la corbeille et le journal. Les strats et entrées déjà supprimées avant cette
-- migration gardent `supprime_par` vide (corbeille : « compte supprimé »). Le cron efface définitivement
-- ce qui est à la corbeille depuis plus de 30 jours.
--
-- SQL standard (SQLite et PostgreSQL), mêmes conventions que 0001.
ALTER TABLE strats ADD COLUMN supprime_par TEXT;
ALTER TABLE playbook_entrees ADD COLUMN supprime_par TEXT;
CREATE INDEX strats_corbeille ON strats (team_id, supprime_le);
