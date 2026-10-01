/**
 * Lecture d'un lecteur sur le site et sur PC (Electron) :
 *  - iframe CLOISONNÉ (`sandbox` sans navigation du parent ni fenêtres) ; sur PC, le
 *    processus principal ne le laisse charger que si le site a été déclaré ;
 *  - vidéo directe (mp4, webm) : `<video>` ;
 *  - flux HLS (m3u8) : hls.js (chargé à la demande), ou HLS natif de Safari.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { police } from '../../hub/themes';
import type { Lecteur } from '../moteur/resolution';
import { useTsuzuku } from './contexte';
import { ouvrirExterne } from './externe';
import type { PropsMedia } from './typesMedia';
import { Avis, Bouton } from './ui';

/** Plein écran : l'API du navigateur (Android, PC), sinon le plein écran natif de la vidéo (iPhone). Paysage si possible. */
async function pleinEcran(conteneur: HTMLElement | null): Promise<void> {
  try {
    const c = conteneur as (HTMLElement & { webkitRequestFullscreen?: () => void }) | null;
    if (c?.requestFullscreen) {
      await c.requestFullscreen();
      try {
        await (screen.orientation as unknown as { lock?: (o: string) => Promise<void> } | undefined)?.lock?.('landscape');
      } catch {
        // Le verrouillage de l'orientation n'est pas permis partout : le plein écran reste utile.
      }
      return;
    }
    const video = conteneur?.querySelector('video') as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (video?.webkitEnterFullscreen) {
      video.webkitEnterFullscreen();
    } else {
      c?.webkitRequestFullscreen?.();
    }
  } catch {
    // Refusé par le navigateur : le lecteur reste utilisable en place.
  }
}

/** Cadre du téléphone : le média pleine largeur, noir derrière, et « Plein écran » sous la vidéo. */
function CadreMobile({ children }: { children: React.ReactNode }) {
  const { theme } = useTsuzuku();
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <View>
      {React.createElement('div', { ref, 'data-testid': 'lecteur-cadre', style: { width: '100%', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' } }, children)}
      <Pressable
        testID="lecteur-plein-ecran"
        accessibilityRole="button"
        accessibilityLabel="Lecteur en plein écran, en mode paysage"
        onPress={() => void pleinEcran(ref.current)}
        style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: theme.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.ligne }}>
        <Text style={{ color: theme.accent, fontSize: 17, fontWeight: '700', ...police(theme.policeTexte) }}>⛶ Plein écran</Text>
      </Pressable>
    </View>
  );
}

const SANDBOX = 'allow-scripts allow-same-origin allow-presentation allow-forms';

function VideoWeb({ lecteur, titre, onFin, mobile, poster }: { lecteur: Lecteur; titre: string; onFin?(): void; mobile?: boolean; poster?: string | null }) {
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
  if (mobile) {
    // iPhone : `playsInline` (la vidéo ne part pas en plein écran toute seule), jamais de lecture automatique
    // (Safari la refuse sans geste : l'écran resterait figé), commandes natives larges.
    return (
      <View>
        <CadreMobile>
          {React.createElement('video', {
            ref,
            controls: true,
            playsInline: true,
            'webkit-playsinline': 'true',
            preload: 'metadata',
            poster: poster ?? undefined,
            title: titre,
            'aria-label': `Lecteur vidéo : ${titre}`,
            'data-testid': 'lecteur-video',
            onEnded: onFin,
            onError: () => setErreur('La vidéo ne peut pas être lue depuis cette adresse.'),
            style: { width: '100%', aspectRatio: '16 / 9', maxHeight: '100vh', background: '#000' },
          })}
        </CadreMobile>
        {erreur ? <Avis genre="alerte" texte={erreur} testID="lecteur-erreur" /> : null}
      </View>
    );
  }
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
        onError: () => setErreur('La vidéo ne peut pas être lue depuis cette adresse.'),
        style: { width: '100%', aspectRatio: '16 / 9', background: '#000', borderRadius: 4 },
      })}
      {erreur ? <Avis genre="alerte" texte={erreur} testID="lecteur-erreur" /> : null}
    </View>
  );
}

export function LecteurMedia({ lecteur, titre, onFin, poster }: PropsMedia) {
  const { s, mobile } = useTsuzuku();
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
    return <Text accessibilityLiveRegion="polite" style={mobile ? { color: '#FFFFFF', fontSize: 16, padding: 16 } : undefined}>Préparation du lecteur…</Text>;
  }
  if (lecteur.kind === 'iframe' && mobile) {
    return (
      <CadreMobile>
        {React.createElement('iframe', {
          src: lecteur.url,
          title: `Lecteur : ${titre}`,
          sandbox: SANDBOX,
          allow: 'fullscreen; autoplay; picture-in-picture',
          allowFullScreen: true,
          referrerPolicy: 'no-referrer',
          'data-testid': 'lecteur-iframe',
          style: { width: '100%', aspectRatio: '16 / 9', maxHeight: '100vh', border: 0, background: '#000' },
        })}
      </CadreMobile>
    );
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
  return <VideoWeb lecteur={lecteur} titre={titre} onFin={onFin} mobile={mobile} poster={poster} />;
}
