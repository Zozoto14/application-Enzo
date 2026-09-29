/**
 * Version de l'app affichée dans les Paramètres du hub.
 *
 * Le build de bureau (Vite) grave `__VERSION_APP__` : version du paquet et
 * commit du code compilé. Ailleurs (Metro, Jest), l'identifiant n'existe pas :
 * on le teste avec `typeof`, qui ne lève pas.
 */

declare const __VERSION_APP__: string | undefined;

export function versionApp(): string {
  try {
    return typeof __VERSION_APP__ === 'string' && __VERSION_APP__ ? __VERSION_APP__ : 'version de développement';
  } catch {
    return 'version inconnue';
  }
}
