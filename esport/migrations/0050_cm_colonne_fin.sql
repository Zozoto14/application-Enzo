-- Esport, migration 0050 : colonnes de fin des tableaux CM et cartes terminées (docs/esport/cm.md, « Colonnes de fin »).
--
-- `cm_listes.fin` = 1 : colonne « de fin » (Fini, Terminé, Publié…) : les cartes qui y sont déposées sont TERMINÉES.
-- Plusieurs colonnes de fin par tableau sont possibles. Rien n'est coché automatiquement (défaut 0) : l'app propose de
-- marquer les colonnes dont le nom ressemble à « Fini / Terminé / Fait / Done / Publié » (bannière réservée à cm.gerer).
-- `cm_listes.fin_ignoree` = 1 : la proposition a été refusée pour cette colonne (la bannière ne revient pas).
--
-- `cm_cartes.terminee_le` / `terminee_par` : NULL = carte ouverte ; sinon date et auteur du dépôt dans une colonne de fin.
-- Invariant tenu par le serveur : une carte est terminée si et seulement si sa colonne est une colonne de fin. La sortir
-- d'une colonne de fin la rouvre (les deux champs repassent à NULL). Les cartes terminées sont exclues des compteurs et
-- alertes d'urgence, des échéances en retard et de l'Accueil CM.
--
-- SQL standard (PostgreSQL et SQLite).

ALTER TABLE cm_listes ADD COLUMN fin INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cm_listes ADD COLUMN fin_ignoree INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cm_cartes ADD COLUMN terminee_le TEXT;
ALTER TABLE cm_cartes ADD COLUMN terminee_par TEXT;
CREATE INDEX cm_cartes_terminee ON cm_cartes (tableau_id, terminee_le);
