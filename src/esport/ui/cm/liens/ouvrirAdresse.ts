/**
 * Ouvre une adresse https dans un NOUVEL onglet, sans lien avec la page d'origine (`noopener,noreferrer`) ; sur
 * téléphone, dans le navigateur du système. Seule une adresse https est ouverte (défense en profondeur : le serveur
 * n'en enregistre pas d'autre).
 */

import { Linking } from 'react-native';

export function ouvrirAdresse(url: string): void {
  if (!/^https:\/\//i.test(url)) return;
  const ouvrir = (globalThis as { open?: (u: string, cible: string, options?: string) => unknown }).open;
  if (ouvrir) ouvrir(url, '_blank', 'noopener,noreferrer');
  else void Linking.openURL(url);
}
