-- Esport, migration 0067 : rôles staff supplémentaires d'un événement du club (docs/esport/evenements.md, « Rôle staff
-- de l'événement »).
--
-- Demande du Fondateur : en plus du rôle staff créé par le bot, des rôles Discord EXISTANTS peuvent être déclarés
-- « staff » de l'événement (mêmes droits : hub de l'événement et salon du staff, salons vocaux des équipes, rôles qui
-- traitent les tickets des catégories de l'événement, hub caché). Le bot ne les crée ni ne les supprime.
--
-- `staff_roles_sup` : JSON des identifiants de ces rôles.
-- `staff_sup_ajouts` : JSON { roleId: [catégories de tickets] } des catégories où l'ÉVÉNEMENT a ajouté le rôle aux
--   rôles qui traitent les tickets : seuls ces ajouts sont retirés (rôle retiré de la liste, catégorie retirée de
--   l'événement, fin ou suppression de l'événement) ; un rôle qui traitait déjà une catégorie n'y est pas touché.
--
-- SQL standard (PostgreSQL et SQLite).

ALTER TABLE club_evenements ADD COLUMN staff_roles_sup TEXT NOT NULL DEFAULT '[]';
ALTER TABLE club_evenements ADD COLUMN staff_sup_ajouts TEXT NOT NULL DEFAULT '{}';
