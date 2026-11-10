/**
 * Site et app PC : chaque app du hub est chargée à la demande, dans un fichier séparé du bundle principal (Vite
 * découpe chaque `import()`). Le hub s'affiche sans attendre leur code ; une app déjà ouverte reste en mémoire.
 * Version directe (iPhone, tests) : racinesDifferees.tsx.
 */

import { differe } from '../ui/differe';
import type { PropsRacineApp } from './types';

export const Tsuzuku = differe<PropsRacineApp>(async () => (await import('../tsuzuku/app/Racine')).Tsuzuku);
export const Taches = differe<PropsRacineApp>(async () => (await import('../taches/ui/RacineTaches')).Taches);
export const AppJournal = differe<PropsRacineApp>(async () => (await import('../journal/AppJournal')).AppJournal);
export const AppAbonnements = differe<PropsRacineApp>(async () => (await import('./abonnements/AppAbonnements')).AppAbonnements);
export const Prospects = differe<PropsRacineApp>(async () => (await import('../prospects/RacineProspects')).Prospects);
export const ClaudeOffice = differe<PropsRacineApp>(async () => (await import('../claudeOffice/Racine')).ClaudeOffice);
export const Administration = differe<PropsRacineApp>(async () => (await import('./Administration')).Administration);
