/**
 * Lecture d'un lecteur sur le site et sur PC (Electron) :
 *  - iframe CLOISONNÉ (`sandbox` sans navigation du parent ni fenêtres) ; sur PC, le
 *    processus principal ne le laisse charger que si le site a été déclaré ;
 *  - vidéo directe (mp4, webm) : `<video>` ;
 *  - flux HLS (m3u8) : hls.js (chargé à la demande), ou HLS natif de Safari.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import type { Lecteur } from '../moteur/resolution';
import { useTsuzuku } from './contexte';
import { ouvrirExterne } from './externe';
import type { PropsMedia } from './typesMedia';
import { Avis, Bouton } from './ui';

const SANDBOX = 'allow-scripts allow-same-origin allow-presentation allow-forms';

function VideoWeb({ lecteur, titre, onFin, debut, onPosition }: { lecteur: Lecteur; titre: string; onFin?(): void; debut?: number; onPosition?(s: number): void }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [erreur, setErreur] = useState<string | undefined>();
  useEffect(() => {
    const video = ref.current;
    if (!video) return undefined;
    setErreur(undefined);
    if (lecteur.kind !== 'hls' || video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = lecteur.url;
      return undefined;
    }
    let detruit = false;
    let hls: { destroy(): void } | undefined;
    void import('hls.js')
      .then(({ default: Hls }) => {
        if (detruit) return;
        if (!Hls.isSupported()) {
          setErreur('Ce navigateur ne sait pas lire les flux HLS.');
          return;
        }
        const h = new Hls();
        hls = h;
        h.on(Hls.Events.ERROR, (_e: unknown, d: { fatal?: boolean; details?: string }) => {
          if (d.fatal) setErreur(`Lecture impossible (${d.details ?? 'erreur réseau'}) : le site du flux refuse peut-être l’accès depuis l’application.`);
        });
        h.loadSource(lecteur.url);
        h.attachMedia(video);
      })
      .catch(() => setErreur('Le lecteur HLS n’a pas pu être chargé.'));
    return () => {
      detruit = true;
      hls?.destroy();
    };
  }, [lecteur.url, lecteur.kind]);
  return (
    <View style={{ gap: 8 }}>
      {React.createElement('video', {
        ref,
        controls: true,
        autoPlay: true,
        playsInline: true,
        preload: 'metadata',
        title: titre,
        'aria-label': `Lecteur vidéo : ${titre}`,
        'data-testid': 'lecteur-video',
        onEnded: onFin,
        // Changement de langue : reprise à la même position (si la vidéo le permet).
        onLoadedMetadata: (e: { currentTarget: HTMLVideoElement }) => {
          if (debut && debut > 0 && Number.isFinite(e.currentTarget.duration) && debut < e.currentTarget.duration) e.currentTarget.currentTime = debut;
        },
        onTimeUpdate: (e: { currentTarget: HTMLVideoElement }) => onPosition?.(e.currentTarget.currentTime),
        onError: () => setErreur('La vidéo ne peut pas être lue depuis cette adresse.'),
        style: { width: '100%', aspectRatio: '16 / 9', background: '#000', borderRadius: 4 },
      })}
      {erreur ? <Avis genre="alerte" texte={erreur} testID="lecteur-erreur" /> : null}
    </View>
  );
}

export function LecteurMedia({ lecteur, titre, onFin, debut, onPosition }: PropsMedia) {
  const { s } = useTsuzuku();
  const [pret, setPret] = useState(lecteur.kind !== 'iframe');
  useEffect(() => {
    let vivant = true;
    if (lecteur.kind === 'iframe') {
      setPret(false);
      // Sur PC, le processus principal n'autorise le sous-cadre qu'après cette déclaration.
      void s.declarerLecteur(lecteur.url).then(() => vivant && setPret(true));
    } else {
      setPret(true);
    }
    return () => {
      vivant = false;
    };
  }, [s, lecteur.url, lecteur.kind]);
  if (!pret) {
    return <Text accessibilityLiveRegion="polite">Préparation du lecteur…</Text>;
  }
  if (lecteur.kind === 'iframe') {
    return (
      <View style={{ gap: 8 }}>
        {React.createElement('iframe', {
          src: lecteur.url,
          title: `Lecteur : ${titre}`,
          sandbox: SANDBOX,
          allow: 'fullscreen; autoplay; picture-in-picture',
          allowFullScreen: true,
          referrerPolicy: 'no-referrer',
          'data-testid': 'lecteur-iframe',
          style: { width: '100%', aspectRatio: '16 / 9', border: 0, background: '#000', borderRadius: 4 },
        })}
        <Bouton titre="Ouvrir dans le navigateur ↗" libelle="Ouvrir ce lecteur dans le navigateur" onPress={() => void ouvrirExterne(lecteur.url)} testID="lecteur-ouvrir-externe" style={{ alignSelf: 'flex-start' }} />
      </View>
    );
  }
  return <VideoWeb lecteur={lecteur} titre={titre} onFin={onFin} debut={debut} onPosition={onPosition} />;
}
