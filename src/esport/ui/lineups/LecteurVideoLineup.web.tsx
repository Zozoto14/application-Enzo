/**
 * Vidéo courte d'un lineup (site et app PC) : balise <video> du navigateur, lecture par plages sur le lien signé
 * (le serveur répond 206), commandes natives, lecture en ligne sur iPhone et iPad (`playsInline`), en boucle : un
 * lineup se regarde plusieurs fois.
 */

import React from 'react';
import type { ThemeHub } from '../../../hub/themes';

export function LecteurVideoLineup({ url, titre, testID = 'esport-lineup-video' }: { theme: ThemeHub; url: string; titre: string; testID?: string }) {
  return (
    <video
      data-testid={testID}
      src={url}
      controls
      loop
      playsInline
      preload="metadata"
      aria-label={titre}
      style={{ width: '100%', aspectRatio: '16 / 9', backgroundColor: '#05080C', borderRadius: 12, display: 'block' }}
    />
  );
}
