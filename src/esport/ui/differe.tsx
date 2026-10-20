/**
 * Chargement différé des écrans lourds des modules (taille du bundle).
 *
 * Ici (iPhone, iPad, Android, tests) : import direct, tout est déjà dans le
 * paquet de l'app. Sur le site et l'app PC, `differe.web.tsx` charge chaque
 * écran dans un fichier séparé, seulement quand on l'ouvre.
 */

export { Discord, Disponibilites, Planning, Playbook, Presence, Review, Scouting, Strats } from './ecransModules';
