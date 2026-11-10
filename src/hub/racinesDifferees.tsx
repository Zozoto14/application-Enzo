/**
 * Écrans racines des apps du hub, pour le registre (`registre.tsx` et les `registre.ts` de chaque app).
 *
 * Ici (iPhone, iPad, Android, tests) : import direct, tout est déjà dans le paquet de l'app. Sur le site et l'app
 * PC, `racinesDifferees.web.tsx` charge chaque app dans un fichier séparé, la première fois qu'on l'ouvre : le
 * fichier principal ne porte plus que le hub (docs/performance.md).
 */

export { Tsuzuku } from '../tsuzuku/app/Racine';
export { Taches } from '../taches/ui/RacineTaches';
export { AppJournal } from '../journal/AppJournal';
export { AppAbonnements } from './abonnements/AppAbonnements';
export { Prospects } from '../prospects/RacineProspects';
export { ClaudeOffice } from '../claudeOffice/Racine';
export { Administration } from './Administration';
