/**
 * Ouvre un lien obtenu de façon asynchrone (lien signé d'un PDF), sur le
 * site et sur PC. Safari (iPhone, iPad) bloque une fenêtre ouverte APRÈS une
 * attente réseau : on ouvre donc l'onglet tout de suite (pendant le geste de
 * l'utilisateur), puis on y charge le lien. Si l'onglet ne s'ouvre pas
 * (application PC : les fenêtres vides sont refusées), on ouvre le lien
 * ensuite, par le système.
 */

import { Linking } from 'react-native';

export async function ouvrirLienDiffere(obtenir: () => Promise<string>): Promise<void> {
  const ouvrir = (globalThis as { open?: (url: string, cible: string) => Window | null }).open;
  let onglet: Window | null = null;
  try {
    onglet = ouvrir ? ouvrir('', '_blank') : null;
  } catch {
    onglet = null;
  }
  if (onglet) {
    try {
      onglet.opener = null;
    } catch {
      // Sans importance : l'onglet reste utilisable.
    }
  }
  let url: string;
  try {
    url = await obtenir();
  } catch (e) {
    onglet?.close();
    throw e;
  }
  if (onglet && !onglet.closed) onglet.location.href = url;
  else await Linking.openURL(url);
}
