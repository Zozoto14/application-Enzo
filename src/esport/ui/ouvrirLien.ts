/**
 * Ouvre un lien obtenu de façon asynchrone (lien signé d'un PDF) dans le
 * lecteur du système. Version web (site, PC) : `ouvrirLien.web.ts`.
 */

import { Linking } from 'react-native';

export async function ouvrirLienDiffere(obtenir: () => Promise<string>): Promise<void> {
  await Linking.openURL(await obtenir());
}
