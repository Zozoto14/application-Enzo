/**
 * Point d'entrée du hub (alias `@hub`).
 *
 * Le hub ne dépend d'aucune app : il définit ses contrats (`types.ts`) et
 * l'application hôte lui fournit ses apps, ses profils et son stockage.
 * Voir `hub/README.md`.
 *
 * Les modules en données pures sont aussi importables un par un
 * (`@hub/personnalisation`, `@hub/permissions`...) sans charger React Native.
 */

export * from './types';
export * from './themes';
export * from './personnalisation';
export * from './permissions';
export * from './infos';
export * from './identifiants';
export * from './registre';
export * from './web';
export { Hub, BoutonHub, RetourHub, type HubProps } from './Hub';
export { Administration, type PropsAdministration } from './Administration';
