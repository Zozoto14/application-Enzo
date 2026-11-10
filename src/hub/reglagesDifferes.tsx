/**
 * Cartes des Paramètres du hub propres à une app (Tâches, Tsuzuku), Devblog et page Support, pour App.tsx. Ici (iPhone, tests) :
 * import direct. Sur le web, `reglagesDifferes.web.tsx` les charge à la première ouverture (docs/performance.md).
 */

export { ReglagesTachesFondateur, ReglagesTachesPerso } from '../taches/ui/ParametresTaches';
export { ReglageLectureTsuzuku } from '../tsuzuku/app/ParametresTsuzuku';
export { ReglageAvancesTsuzuku, ReglageSourcesPartagees, ReglageSourcesTsuzuku } from '../tsuzuku/app/AdminTsuzuku';
export { Devblog } from './devblog/Devblog';
export { PageSupport } from './PageSupport';
