/** Ouvre une adresse dans le navigateur du système (PC : via le processus principal ; sinon Linking). */

import { Linking } from 'react-native';
import { urlHttpSure } from '../moteur/garde';

export async function ouvrirExterne(url: string): Promise<boolean> {
  // Toujours http(s) : jamais file:, javascript:, etc., même si une source les renvoyait.
  const sure = urlHttpSure(url);
  if (!sure) {
    return false;
  }
  const pont = (globalThis as { applibourse?: { systeme?: { ouvrir?(u: string): Promise<unknown> } } }).applibourse?.systeme;
  try {
    if (pont?.ouvrir) {
      await pont.ouvrir(sure);
    } else {
      await Linking.openURL(sure);
    }
    return true;
  } catch {
    return false;
  }
}
