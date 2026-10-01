/**
 * Avant chaque fichier de test : l'affichage « large » (bureau) est forcé. La fenêtre simulée de
 * React Native (750 × 1334, iOS) passerait sinon tout en mode téléphone (voir src/ui/mobile/detection.ts).
 * Les tests du mode téléphone le demandent explicitement (`forcerModeAffichage('telephone')`).
 */
globalThis.__APPDASHBOARD_MODE_AFFICHAGE__ = 'large';
