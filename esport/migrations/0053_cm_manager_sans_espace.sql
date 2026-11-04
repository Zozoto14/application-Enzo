-- Esport, migration 0053 : le Manager d'une team n'entre plus dans l'espace « CM du club » (docs/esport/cm.md,
-- « Qui entre dans l'espace CM du club »).
--
-- L'espace CM du club (tableaux, ressources, Drive, réunions, équipe CM, sponsors…) est réservé à l'équipe CM ; une
-- permission CM d'un rôle de TEAM n'ouvre plus que l'onglet CM de cette team (contrôle côté serveur, cm/commun.mjs).
-- Nouveau défaut du rôle système « Manager » (catalogue.json) : `cm.deposer` et `cm.clips.proposer` (alimenter le CM :
-- déposer une info, proposer un clip, suivre ses dépôts), sans `cm.voir` (le tableau CM de la team).
--
-- Rôles « Manager » des teams existantes : `cm.voir` est retiré SEULEMENT s'ils ont encore les trois permissions CM par
-- défaut (cm.voir, cm.deposer, cm.clips.proposer) ; un rôle dont la partie CM a été personnalisée (une de ces
-- permissions retirée) ne change pas. Un rôle à qui on a rajouté cm.voir à la main n'est pas distinguable du défaut :
-- il se rajoute dans Paramètres › Rôles de la team (il n'ouvre de toute façon que le tableau de la team).
-- Modèle des nouvelles teams (`roles_modele`, page Rôles et permissions) : une ligne « manager » est un choix du
-- Fondateur, gardée telle quelle ; sans ligne, le nouveau défaut du catalogue s'applique.
--
-- SQL standard (PostgreSQL et SQLite).

DELETE FROM role_permissions
 WHERE permission = 'cm.voir'
   AND role_id IN (
     SELECT r.id FROM roles r
      WHERE r.systeme = 1 AND r.cle_systeme = 'manager'
        AND EXISTS (SELECT 1 FROM role_permissions a WHERE a.role_id = r.id AND a.permission = 'cm.deposer')
        AND EXISTS (SELECT 1 FROM role_permissions b WHERE b.role_id = r.id AND b.permission = 'cm.clips.proposer')
   );
