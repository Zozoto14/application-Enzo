-- Esport, migration 0056 : avis de satisfaction des tickets et suppression d'un ticket fermé
-- (docs/esport/tickets.md, « Avis » et « Supprimer un ticket fermé »).
--
-- Demande du Fondateur : « voir les avis, et quand on ferme un ticket pouvoir le supprimer après ».
--
-- Les avis (note de 1 à 5 et commentaire facultatif laissés par l'auteur dans le MP de fermeture) restent dans
-- `tickets` (note, note_commentaire, note_le : migration 0054). Tickets › Avis les lit, avec les droits du moment
-- (tickets.gerer, ou tickets.configurer pour les catégories dont il porte un des rôles de l'app).
--
-- `tickets_avis_anonymes` : avis d'un ticket SUPPRIMÉ que le staff a choisi de garder pour les statistiques. Rien ne
--   le relie plus au ticket ni à son auteur (ni numéro, ni Discord ID, ni nom) : la catégorie (droits d'accès, filtres),
--   la note, le commentaire, sa date, et qui avait pris le ticket en charge (filtre « Responsable »). Le commentaire
--   suit la rétention réglée (effacé avec les conversations des tickets fermés depuis plus de N jours).
--
-- `tickets_reglages` (migration 0054) garde aussi `dernier_numero` : plus grand numéro d'un ticket supprimé, pour qu'un
-- numéro ne serve jamais deux fois (une ligne de plus, exportée avec les réglages : aucune colonne).
--
-- SQL standard (PostgreSQL et SQLite).

CREATE TABLE tickets_avis_anonymes (
  id TEXT PRIMARY KEY,
  categorie_id TEXT NOT NULL,
  note INTEGER NOT NULL CHECK (note >= 1 AND note <= 5),
  commentaire TEXT,
  note_le TEXT NOT NULL,
  responsable_compte_id TEXT,
  responsable_discord_id TEXT,
  responsable_nom TEXT,
  cree_le TEXT NOT NULL
);
CREATE INDEX tickets_avis_anonymes_note_le ON tickets_avis_anonymes (note_le);
CREATE INDEX tickets_avis_note_le ON tickets (note_le);
