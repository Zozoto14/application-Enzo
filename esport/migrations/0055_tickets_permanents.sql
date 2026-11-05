-- Esport, migration 0055 : tickets paramétrables, fermeture automatique et fermeture par le staff seul
-- (docs/esport/tickets.md, « Tickets qui ne se ferment jamais »).
--
-- Demande du Fondateur : « paramétrer un ticket, par exemple un ticket de sponsor qui ne se ferme jamais ».
--
-- `tickets_categories.fermeture_auto_h` (migration 0054) garde son sens : NULL = délai général, 0 = jamais, N = N
--   heures sans message (l'app le règle en jours : « Délai général », « Délai propre », « Jamais »).
-- `tickets_categories.fermeture_staff_seul` : 1 = seul le staff ferme les tickets de cette catégorie (l'auteur ne peut
--   plus les fermer : bouton, /ticket fermer).
-- `tickets.permanent` : 1 = ce ticket ne se ferme JAMAIS automatiquement (ni avertissement d'inactivité), quel que soit
--   le réglage de sa catégorie ; réglé par le staff (app : tickets.gerer ; Discord : /ticket permanent). Un
--   avertissement en attente est annulé. `permanent_par` (nom de qui l'a réglé) et `permanent_le` : pour l'app.
-- Ordre de priorité de la fermeture automatique : ticket permanent > réglage de la catégorie > réglage général.
--
-- SQL standard (PostgreSQL et SQLite).

ALTER TABLE tickets_categories ADD COLUMN fermeture_staff_seul INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tickets ADD COLUMN permanent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tickets ADD COLUMN permanent_par TEXT;
ALTER TABLE tickets ADD COLUMN permanent_le TEXT;
