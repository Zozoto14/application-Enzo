/**
 * Lecture d'un lecteur sur le site et sur PC (Electron) :
 *  - iframe CLOISONNÉ (`sandbox` sans navigation du parent ni fenêtres) ; sur PC, le
 *    processus principal ne le laisse charger que si le site a été déclaré ;
 *  - vidéo directe (mp4, webm) : `<video>` ;
 *  - flux HLS (m3u8) : hls.js (chargé à la demande), ou HLS natif de Safari.
 *
 * L'iframe est TOUJOURS l'adresse d'embed d'un hôte vidéo (extraite de la page
 * de l'épisode, voir `moteur/lecteursEpisode.ts`), jamais la page du site :
 * plein cadre 16:9, plein écran permis. Onglet de l'app masqué (multi-apps) :
 * la vidéo est mise en pause et l'iframe retiré (un iframe masqué continuerait
 * de jouer le son).
 */

import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import type { Lecteur } from '../moteur/resolution';
import { DELAI_IFRAME_MS, DELAI_VIDEO_MS, pageErreurDetectee, sonderHote, surveiller, urlLecteurValide, type Surveillance } from '../moteur/basculeLecteurs';
import { useInfoOnglet } from '../../hub/multi/contexte';
import { useTsuzuku } from './contexte';
import type { PropsMedia } from './typesMedia';
import { Avis } from './ui';

/** Cloisonnement de l'iframe d'hôte : ses scripts et son origine (le lecteur en a besoin), le plein écran ; ni navigation du parent, ni fenêtres. */
export const SANDBOX_LECTEUR = 'allow-scripts allow-same-origin allow-presentation';
/** Permissions de l'iframe d'hôte. */
export const ALLOW_LECTEUR = 'autoplay; fullscreen; encrypted-media; picture-in-picture';
/** Les hôtes vidéo refusent souvent une intégration sans origine : on envoie l'origine seule (jamais le chemin). */
export const REFERRER_LECTEUR = 'origin';
const CADRE = { width: '100%', aspectRatio: '16 / 9', border: 0, background: '#000', borderRadius: 4, display: 'block' } as const;

/**
 * Surveille un lecteur affiché (`actif`) : adresse invalide = échec tout de suite ;
 * sinon échec si aucun signe de vie avant `delaiMs`. Rend la surveillance en cours
 * (`vivant()` / `echec()` à appeler depuis les événements du lecteur).
 */
function useSurveillance(actif: boolean, delaiMs: number, url: string, onEchec?: (raison: string) => void, onVivant?: () => void) {
  const ref = useRef<Surveillance | null>(null);
  const rappels = useRef({ onEchec, onVivant });
  rappels.current = { onEchec, onVivant };
  useEffect(() => {
    ref.current = null;
    if (!actif) return undefined;
    if (!urlLecteurValide(url)) {
      const t = setTimeout(() => rappels.current.onEchec?.('adresse invalide'), 0);
      return () => clearTimeout(t);
    }
    const v = surveiller(delaiMs, raison => rappels.current.onEchec?.(raison));
    ref.current = v;
    return () => {
      v.arreter();
      if (ref.current === v) ref.current = null;
    };
  }, [actif, delaiMs, url]);
  return {
    vivant: () => {
      if (!ref.current) return;
      ref.current.vivant();
      ref.current = null;
      rappels.current.onVivant?.();
    },
    echec: (raison: string) => ref.current?.echec(raison),
  };
}

/** Document d'un iframe quand il est lisible (même origine) ; null sinon (hôte d'un autre site : on ne peut rien voir). */
function documentLisible(cadre: HTMLIFrameElement): Document | null {
  try {
    return cadre.contentDocument;
  } catch {
    return null;
  }
}

function VideoWeb({ lecteur, titre, onFin, debut, onPosition, onVivant, onEchec }: { lecteur: Lecteur; titre: string; onFin?(): void; debut?: number; onPosition?(s: number, duree?: number): void; onVivant?(): void; onEchec?(raison: string): void }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [erreur, setErreur] = useState<string | undefined>();
  const { affiche } = useInfoOnglet();
  const veille = useSurveillance(affiche, DELAI_VIDEO_MS, lecteur.url, onEchec, onVivant);
  const veilleRef = useRef(veille);
  veilleRef.current = veille;
  // Onglet masqué (ou effets suspendus) : pause.
  useEffect(() => {
    const video = ref.current;
    if (!affiche) video?.pause();
    return () => video?.pause();
  }, [affiche]);
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
          veilleRef.current.echec('HLS non pris en charge');
          return;
        }
        const h = new Hls();
        hls = h;
        h.on(Hls.Events.ERROR, (_e: unknown, d: { fatal?: boolean; details?: string }) => {
          if (d.fatal) {
            setErreur(`Lecture impossible (${d.details ?? 'erreur réseau'}) : le site du flux refuse peut-être l’accès depuis l’application.`);
            veilleRef.current.echec(d.details ?? 'erreur réseau');
          }
        });
        h.loadSource(lecteur.url);
        h.attachMedia(video);
      })
      .catch(() => {
        setErreur('Le lecteur HLS n’a pas pu être chargé.');
        veilleRef.current.echec('lecteur HLS indisponible');
      });
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
          veille.vivant();
          if (debut && debut > 0 && Number.isFinite(e.currentTarget.duration) && debut < e.currentTarget.duration) e.currentTarget.currentTime = debut;
        },
        onTimeUpdate: (e: { currentTarget: HTMLVideoElement }) => onPosition?.(e.currentTarget.currentTime, Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : undefined),
        onError: () => {
          setErreur('La vidéo ne peut pas être lue depuis cette adresse.');
          veille.echec('erreur de lecture');
        },
        style: CADRE,
      })}
      {erreur ? <Avis genre="alerte" texte={erreur} testID="lecteur-erreur" /> : null}
    </View>
  );
}

export function LecteurMedia({ lecteur, titre, onFin, debut, onPosition, onVivant, onEchec }: PropsMedia) {
  const { s, theme } = useTsuzuku();
  const { affiche } = useInfoOnglet();
  const [pret, setPret] = useState(lecteur.kind !== 'iframe');
  // Iframe : surveillé une fois prêt (déclaré) et affiché ; la vidéo se surveille elle-même (`VideoWeb`).
  const veille = useSurveillance(lecteur.kind === 'iframe' && pret && affiche, DELAI_IFRAME_MS, lecteur.url, onEchec, onVivant);
  const rappels = useRef({ onEchec });
  rappels.current = { onEchec };
  // Hôte injoignable (le navigateur affiche alors sa propre page d'erreur, illisible d'ici) : sondé en parallèle du cadre.
  const sondable = lecteur.kind === 'iframe' && pret && affiche;
  // Le résultat de la sonde passe avant le « chargé » du cadre : la page d'erreur du navigateur déclenche aussi `onLoad`.
  const sonde = useRef<Promise<boolean>>(Promise.resolve(true));
  useEffect(() => {
    sonde.current = Promise.resolve(true);
    if (!sondable) return undefined;
    let vivant = true;
    const p = sonderHote(lecteur.url);
    sonde.current = p;
    void p.then(ok => vivant && !ok && veille.echec('hôte injoignable'));
    return () => {
      vivant = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sondable, lecteur.url]);
  useEffect(() => {
    let vivant = true;
    if (lecteur.kind === 'iframe') {
      setPret(false);
      // Sur PC, le processus principal n'autorise le sous-cadre qu'après cette déclaration.
      // Adresse refusée par la garde du PC (invalide, réseau privé…) : échec tout de suite, sans afficher de cadre.
      void s.declarerLecteur(lecteur.url).then(ok => {
        if (!vivant) return;
        if (ok === false) rappels.current.onEchec?.('adresse refusée');
        else setPret(true);
      });
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
    // « Ouvrir dans le navigateur » : sous le lecteur, dans l'écran (`Lecteur.tsx`).
    return (
      <View style={{ gap: 8 }}>
        <View testID="lecteur-zone" style={{ width: '100%' }}>
          {affiche ? (
            React.createElement('iframe', {
              src: lecteur.url,
              title: `Lecteur : ${titre}`,
              sandbox: SANDBOX_LECTEUR,
              allow: ALLOW_LECTEUR,
              allowFullScreen: true,
              referrerPolicy: REFERRER_LECTEUR,
              'data-testid': 'lecteur-iframe',
              // Chargé : signe de vie, sauf page d'erreur lisible (même origine) ou vide ; les hôtes d'un autre site ne sont pas lisibles.
              onLoad: (e: { currentTarget: HTMLIFrameElement }) => {
                const doc = documentLisible(e.currentTarget);
                if (doc && doc.URL !== 'about:blank' && pageErreurDetectee(doc.body?.innerText ?? doc.body?.textContent, Boolean(doc.querySelector('video,iframe,canvas,embed,object')))) veille.echec('page d’erreur');
                else if (!doc || doc.URL !== 'about:blank') void sonde.current.then(ok => (ok ? veille.vivant() : veille.echec('hôte injoignable')));
              },
              onError: () => veille.echec('erreur de chargement'),
              style: CADRE,
            })
          ) : (
            <View style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', borderRadius: 4, alignItems: 'center', justifyContent: 'center' }} testID="lecteur-en-pause">
              <Text style={{ color: theme.attenue }}>Lecture en pause (onglet masqué).</Text>
            </View>
          )}
        </View>
      </View>
    );
  }
  return (
    <View testID="lecteur-zone">
      <VideoWeb lecteur={lecteur} titre={titre} onFin={onFin} debut={debut} onPosition={onPosition} onVivant={onVivant} onEchec={onEchec} />
    </View>
  );
}
