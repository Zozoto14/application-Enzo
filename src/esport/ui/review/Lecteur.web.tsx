/**
 * Lecteur de la review sur le site et l'app PC : API YouTube IFrame
 * (https://developers.google.com/youtube/iframe_api_reference). Le script
 * `https://www.youtube.com/iframe_api` n'est chargé qu'à l'ouverture d'une
 * review, une seule fois ; la vidéo est servie par youtube-nocookie.com.
 *
 * Commandes exposées : temps courant (`getCurrentTime`), `seekTo`, vitesse de
 * lecture (`setPlaybackRate`), lecture et pause. Si la vidéo interdit la lecture
 * intégrée (codes 101 et 150), un lien ouvre YouTube au bon instant.
 *
 * CSP à autoriser (site, app PC, _headers Cloudflare Pages) : voir
 * docs/esport/review-video.md.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { police } from '../../../hub/themes';
import { lienYoutubeA } from '../../review/youtube';
import type { CommandeLecteur, EtatLecteur, PropsLecteur } from './typesLecteur';

export { VITESSES } from './typesLecteur';
export const lecteurIntegre = true;

interface JoueurYT {
  getCurrentTime(): number;
  getDuration(): number;
  seekTo(s: number, avance: boolean): void;
  setPlaybackRate(v: number): void;
  playVideo(): void;
  pauseVideo(): void;
  destroy(): void;
}
interface ApiYT {
  Player: new (cible: HTMLElement, options: Record<string, unknown>) => JoueurYT;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number; CUED: number };
}
type GlobalYT = { YT?: ApiYT; onYouTubeIframeAPIReady?: () => void; document?: Document; location?: Location };

const SCRIPT = 'https://www.youtube.com/iframe_api';
let chargement: Promise<ApiYT> | undefined;

/** Charge l'API IFrame une seule fois (le script appelle `onYouTubeIframeAPIReady`). */
export function chargerApiYoutube(): Promise<ApiYT> {
  const g = globalThis as GlobalYT;
  if (g.YT?.Player) return Promise.resolve(g.YT);
  chargement ??= new Promise<ApiYT>((ok, ko) => {
    const precedent = g.onYouTubeIframeAPIReady;
    g.onYouTubeIframeAPIReady = () => {
      precedent?.();
      if (g.YT?.Player) ok(g.YT);
      else ko(new Error('API YouTube indisponible'));
    };
    const script = g.document!.createElement('script');
    script.src = SCRIPT;
    script.async = true;
    script.onerror = () => {
      chargement = undefined;
      ko(new Error('Le lecteur YouTube n’a pas pu être chargé.'));
    };
    g.document!.head.appendChild(script);
  });
  return chargement;
}

export function Lecteur({ theme, videoId, depart = 0, onPret, onEtat }: PropsLecteur) {
  const zone = useRef<HTMLDivElement>(null);
  const [erreur, setErreur] = useState<string | undefined>();
  const retours = useRef({ onPret, onEtat });
  retours.current = { onPret, onEtat };

  useEffect(() => {
    let vivant = true;
    let joueur: JoueurYT | undefined;
    const racine = zone.current;
    const signaler = (e: EtatLecteur) => retours.current.onEtat?.(e);
    signaler('chargement');
    chargerApiYoutube().then(
      YT => {
        if (!vivant || !racine) return;
        const g = globalThis as GlobalYT;
        // Le lecteur remplace ce <div> par son <iframe> : on lui en donne un neuf.
        const cible = g.document!.createElement('div');
        racine.appendChild(cible);
        const origine = g.location?.protocol === 'http:' || g.location?.protocol === 'https:' ? g.location.origin : undefined;
        joueur = new YT.Player(cible, {
          videoId,
          host: 'https://www.youtube-nocookie.com',
          width: '100%',
          height: '100%',
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1, enablejsapi: 1, start: Math.floor(depart), ...(origine ? { origin: origine } : {}) },
          events: {
            onReady: () => {
              if (!vivant || !joueur) return;
              const j = joueur;
              const commande: CommandeLecteur = {
                temps: () => Number(j.getCurrentTime?.() ?? 0) || 0,
                duree: () => Number(j.getDuration?.() ?? 0) || 0,
                aller: s => {
                  j.seekTo(Math.max(0, s), true);
                  j.playVideo();
                },
                vitesse: v => j.setPlaybackRate(v),
                lire: () => j.playVideo(),
                pause: () => j.pauseVideo(),
              };
              retours.current.onPret(commande);
              signaler('pret');
            },
            onStateChange: (e: { data: number }) => {
              if (e.data === YT.PlayerState.PLAYING) signaler('lecture');
              else if (e.data === YT.PlayerState.PAUSED) signaler('pause');
              else if (e.data === YT.PlayerState.ENDED) signaler('fin');
            },
            onError: (e: { data: number }) => {
              setErreur(e.data === 101 || e.data === 150 ? 'Le propriétaire de la vidéo interdit la lecture intégrée.' : 'La vidéo n’a pas pu être lue (privée, supprimée ou indisponible).');
              signaler('erreur');
            },
          },
        });
      },
      e => {
        if (vivant) setErreur(e instanceof Error ? e.message : 'Lecteur indisponible.');
        signaler('erreur');
      },
    );
    return () => {
      vivant = false;
      retours.current.onPret(undefined);
      try {
        joueur?.destroy();
      } catch {
        // Déjà détruit.
      }
      racine?.replaceChildren();
    };
  }, [videoId, depart]);

  return (
    <View testID="esport-lecteur" style={{ gap: 8 }}>
      <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', background: '#000', borderRadius: Math.min(theme.rayonMoyen, 10), overflow: 'hidden' }}>
        <div ref={zone} data-testid="esport-lecteur-zone" style={{ position: 'absolute', inset: 0 }} />
      </div>
      {erreur ? (
        <View testID="esport-lecteur-erreur" style={{ gap: 4 }}>
          <Text style={{ color: theme.critique, ...police(theme.policeTexte) }}>{erreur}</Text>
          <a href={lienYoutubeA(videoId, depart)} target="_blank" rel="noopener noreferrer" style={{ color: theme.accent }}>
            Ouvrir dans YouTube
          </a>
        </View>
      ) : null}
    </View>
  );
}
