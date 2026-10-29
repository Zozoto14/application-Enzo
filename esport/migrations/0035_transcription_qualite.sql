-- Esport, migration 0035 : qualité de la transcription sur le serveur (docs/esport/transcription.md).
--
-- SQL standard, compatible SQLite ET PostgreSQL (mêmes conventions que 0014 et 0016).
--
-- 1. File de travaux : `qualite` demandée (rapide, equilibree, maximale : modèle et réglages de whisper.cpp),
--    `etape` en cours (« transcription » puis « correction » par l'IA locale) et `correction_faite` (nombre de
--    segments déjà corrigés : une interruption reprend la correction là où elle en était).
ALTER TABLE travaux_transcription ADD COLUMN qualite TEXT NOT NULL DEFAULT 'equilibree';
ALTER TABLE travaux_transcription ADD COLUMN etape TEXT NOT NULL DEFAULT 'transcription';
ALTER TABLE travaux_transcription ADD COLUMN correction_faite INTEGER NOT NULL DEFAULT 0;

-- 2. Transcriptions : `segments_bruts` (texte tel que sorti de Whisper, JSON comme `segments`) quand la
--    version affichée a été corrigée par l'IA locale (NULL sinon) ; `correction` : comment elle l'a été
--    (« IA locale (…) », « indisponible »…, vide si aucune) ; `qualite` : qualité de la transcription
--    (vide pour le navigateur, l'API externe et les transcriptions d'avant).
ALTER TABLE transcriptions ADD COLUMN segments_bruts TEXT;
ALTER TABLE transcriptions ADD COLUMN correction TEXT NOT NULL DEFAULT '';
ALTER TABLE transcriptions ADD COLUMN qualite TEXT NOT NULL DEFAULT '';
