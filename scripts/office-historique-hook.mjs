#!/usr/bin/env node
/**
 * Hook d'historique de Claude Office (sur CE PC) : appelé par Claude Code à
 * chaque demande, outil, début et fin de session, avec la charge du hook sur
 * l'entrée standard. Écrit une ligne dans le journal local
 * (`~/.agent-office/historique/AAAA-MM.jsonl`, voir
 * bureau/electron/officeHistorique.mjs), sans serveur : AppDashboard et
 * Claude Office peuvent être fermés.
 *
 * Ne gêne jamais Claude Code : rien sur la sortie standard (pour une demande,
 * Claude Code l'ajouterait au contexte), toujours le code de sortie 0.
 * Installé par `npm run office:hooks` (aperçu, confirmation, sauvegarde).
 */

import { readFileSync } from 'node:fs';
import { enregistrerEvenement } from '../bureau/electron/officeHistorique.mjs';

try {
  const charge = JSON.parse(readFileSync(0, 'utf8') || '{}');
  enregistrerEvenement(charge, { source: process.argv[2] === 'gemini' ? 'gemini' : 'claude' });
} catch {
  // Jamais d'erreur visible : l'historique ne doit pas bloquer Claude Code.
}
process.exit(0);
