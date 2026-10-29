-- Esport, migration 0034 : plusieurs moteurs d'IA (docs/esport/ia-api.md).
--
-- `ia_appels.moteur` : moteur qui a servi l'appel — « api » (moteur d'API principal, IA_API_*), « api2 » (moteur
-- d'API secondaire, IA_API2_*) ou « local » (IA locale). Les plafonds mensuels de l'Administration IA se comptent
-- par moteur. Les lignes d'avant restent NULL : `fournisseur = 'local'` pour l'IA locale, l'API principale sinon.
-- Les ordres de repli par tâche et le plafond du moteur secondaire sont des lignes de `ia_reglages`
-- (`ordre_profils`, `ordre_leger`, `quota_appels_api2`) : rien à créer.
--
-- SQL standard (PostgreSQL et SQLite), mêmes conventions que 0001.

ALTER TABLE ia_appels ADD COLUMN moteur TEXT;
