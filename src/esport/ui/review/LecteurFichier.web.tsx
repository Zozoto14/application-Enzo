/**
 * Lecteur MAISON de la review (site, app PC) pour une vidéo DÉPOSÉE sur le site : balise <video> HTML5,
 * lecture en streaming par lien signé (le navigateur demande des plages, le serveur répond 206). Même
 * contrat que le lecteur YouTube (`CommandeLecteur`) : même timeline, mêmes repères, réactions,
 * commentaires et dessin (calque posé par-dessus, même cadre 16:9).
 *
 * En plus : image par image (boutons, touches « , » et « . »), barre de progression, plein écran (le
 * calque de dessin reste par-dessus). Le lien signé dure 2 h : s'il expire pendant la lecture, un
 * nouveau est demandé et la lecture reprend au même instant.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub } from '../../../hub/admin/ui/commun';
import { police } from '../../../hub/themes';
import { formatTemps } from '../../review/libelles';
import { FPS_DEFAUT, dureeSure, estimerFps, pasImage } from '../../review/lecture';
import type { CommandeLecteur, PropsLecteurFichier } from './typesLecteur';
import { tr } from '../../i18n';

export { VITESSES } from './typesLecteur';

type VideoAvecImages = HTMLVideoElement & { requestVideoFrameCallback?(f: (t: number, m: { mediaTime: number }) => void): number; cancelVideoFrameCallback?(id: number): void };

export function LecteurFichier({ theme, obtenirUrl, depart = 0, onPret, onEtat, calque, video: infos, raccourcis = true }: PropsLecteurFichier) {
  const cadre = useRef<HTMLDivElement>(null);
  const video = useRef<VideoAvecImages>(null);
  const [erreur, setErreur] = useState<string | undefined>();
  const [temps, setTemps] = useState(0);
  const [duree, setDuree] = useState(0);
  const [lecture, setLecture] = useState(false);
  const [pleinEcran, setPleinEcran] = useState(false);
  const fps = useRef(FPS_DEFAUT);
  const retours = useRef({ onPret, onEtat, obtenirUrl });
  retours.current = { onPret, onEtat, obtenirUrl };
  const relances = useRef(0);

  const charger = useCallback(async (reprendreA?: number, relancer = false) => {
    const v = video.current;
    if (!v) return;
    try {
      const url = await retours.current.obtenirUrl();
      if (reprendreA !== undefined) {
        const surPret = () => {
          v.currentTime = reprendreA;
          if (relancer) void v.play().catch(() => undefined);
        };
        v.addEventListener('loadedmetadata', surPret, { once: true });
      }
      v.src = url;
      v.load();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : tr('review.lecteur.lecteur_indisponible'));
      retours.current.onEtat?.('erreur');
    }
  }, []);

  useEffect(() => {
    const v = video.current;
    if (!v) return undefined;
    let vivant = true;
    const signaler = (e: Parameters<NonNullable<PropsLecteurFichier['onEtat']>>[0]) => retours.current.onEtat?.(e);
    signaler('chargement');
    const commande: CommandeLecteur = {
      temps: () => v.currentTime || 0,
      duree: () => dureeSure(v.duration),
      aller: s => {
        v.currentTime = Math.max(0, s);
        void v.play().catch(() => undefined);
      },
      vitesse: r => {
        v.playbackRate = r;
      },
      lire: () => void v.play().catch(() => undefined),
      pause: () => v.pause(),
    };
    let pret = false;
    const surMeta = () => {
      setDuree(dureeSure(v.duration));
      if (!pret) {
        pret = true;
        if (depart > 0) v.currentTime = depart;
        retours.current.onPret(commande);
        signaler('pret');
      }
    };
    const surTemps = () => setTemps(v.currentTime || 0);
    const surDuree = () => setDuree(dureeSure(v.duration));
    const surLecture = () => {
      setLecture(true);
      signaler('lecture');
    };
    const surPause = () => {
      setLecture(false);
      signaler('pause');
    };
    const surFin = () => {
      setLecture(false);
      signaler('fin');
    };
    const surErreur = () => {
      // Lien expiré (2 h) ou coupure APRÈS un premier chargement : un nouveau lien, puis on reprend au même instant.
      if (pret && relances.current < 3) {
        relances.current++;
        void charger(v.currentTime, !v.paused);
        return;
      }
      setErreur(infos?.media?.peuCompatibleIphone || v.error?.code === 4 ? tr('medias.lecteur.format_illisible') : tr('review.lecteur.la_video_n_a'));
      signaler('erreur');
    };
    v.addEventListener('loadedmetadata', surMeta);
    v.addEventListener('timeupdate', surTemps);
    v.addEventListener('durationchange', surDuree);
    v.addEventListener('play', surLecture);
    v.addEventListener('pause', surPause);
    v.addEventListener('ended', surFin);
    v.addEventListener('error', surErreur);
    // Cadence d'images mesurée pendant la lecture (pour le pas image par image).
    const ecarts: number[] = [];
    let precedent: number | undefined;
    let rappel: number | undefined;
    const mesurer = (_t: number, m: { mediaTime: number }) => {
      if (!vivant) return;
      if (precedent !== undefined && m.mediaTime > precedent) ecarts.push(m.mediaTime - precedent);
      precedent = m.mediaTime;
      if (ecarts.length > 40) ecarts.shift();
      fps.current = estimerFps(ecarts);
      rappel = v.requestVideoFrameCallback?.(mesurer);
    };
    rappel = v.requestVideoFrameCallback?.(mesurer);
    void charger();
    return () => {
      vivant = false;
      if (rappel !== undefined) v.cancelVideoFrameCallback?.(rappel);
      v.removeEventListener('loadedmetadata', surMeta);
      v.removeEventListener('timeupdate', surTemps);
      v.removeEventListener('durationchange', surDuree);
      v.removeEventListener('play', surLecture);
      v.removeEventListener('pause', surPause);
      v.removeEventListener('ended', surFin);
      v.removeEventListener('error', surErreur);
      v.pause();
      v.removeAttribute('src');
      v.load();
      retours.current.onPret(undefined);
    };
  }, [charger, depart, infos?.media?.peuCompatibleIphone]);

  const image = useCallback((sens: 1 | -1) => {
    const v = video.current;
    if (!v) return;
    v.pause();
    v.currentTime = pasImage(v.currentTime, sens, fps.current, dureeSure(v.duration));
  }, []);

  // Touches « , » (image précédente) et « . » (image suivante), hors saisie.
  useEffect(() => {
    const doc = (globalThis as { document?: Document }).document;
    if (!raccourcis || !doc) return undefined;
    const sur = (e: KeyboardEvent) => {
      if (e.key !== ',' && e.key !== '.') return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const cible = e.target as HTMLElement | null;
      const balise = cible?.tagName?.toLowerCase();
      if (balise === 'input' || balise === 'textarea' || balise === 'select' || cible?.isContentEditable) return;
      e.preventDefault();
      image(e.key === '.' ? 1 : -1);
    };
    doc.addEventListener('keydown', sur);
    return () => doc.removeEventListener('keydown', sur);
  }, [raccourcis, image]);

  useEffect(() => {
    const doc = (globalThis as { document?: Document }).document;
    if (!doc) return undefined;
    const sur = () => setPleinEcran(Boolean(doc.fullscreenElement && doc.fullscreenElement === cadre.current));
    doc.addEventListener('fullscreenchange', sur);
    return () => doc.removeEventListener('fullscreenchange', sur);
  }, []);

  const basculerPleinEcran = () => {
    const doc = (globalThis as { document?: Document }).document;
    const c = cadre.current as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null;
    if (!doc || !c) return;
    if (doc.fullscreenElement) void doc.exitFullscreen?.().catch(() => undefined);
    else if (c.requestFullscreen) void c.requestFullscreen().catch(() => undefined);
    else c.webkitRequestFullscreen?.();
  };

  const attenue = { color: pleinEcran ? '#cbd5e1' : theme.attenue, fontSize: 13, ...police(theme.policeChiffres) };
  return (
    <View testID="esport-lecteur" style={{ gap: 8 }}>
      <div
        ref={cadre}
        data-testid="esport-lecteur-cadre"
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, background: pleinEcran ? '#000' : 'transparent', width: '100%', height: pleinEcran ? '100%' : undefined }}>
        <div
          data-testid="esport-lecteur-zone"
          style={{
            position: 'relative',
            width: pleinEcran ? 'min(100vw, calc((100vh - 64px) * 16 / 9))' : '100%',
            aspectRatio: '16 / 9',
            background: '#000',
            borderRadius: pleinEcran ? 0 : Math.min(theme.rayonMoyen, 10),
            overflow: 'hidden',
          }}>
          <video
            ref={video}
            data-testid="esport-video"
            playsInline
            preload="metadata"
            controlsList="nodownload nofullscreen"
            onClick={() => {
              const v = video.current;
              if (v) void (v.paused ? v.play().catch(() => undefined) : v.pause());
            }}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
          />
          {/* Calque du dessin, par-dessus la vidéo : transparent aux clics, sauf l'éditeur. */}
          <div data-testid="esport-lecteur-calque" style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }}>
            {calque}
          </div>
        </div>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', width: '100%', paddingHorizontal: pleinEcran ? 16 : 0 }} testID="esport-lecteur-commandes">
          <BoutonHub
            theme={theme}
            titre={lecture ? '❚❚' : '▶'}
            libelle={lecture ? tr('medias.lecteur.pause') : tr('medias.lecteur.lire')}
            onPress={() => {
              const v = video.current;
              if (v) void (v.paused ? v.play().catch(() => undefined) : v.pause());
            }}
            testID="esport-lecteur-lecture"
          />
          <BoutonHub theme={theme} titre="⏮︎" libelle={tr('medias.lecteur.image_precedente')} onPress={() => image(-1)} testID="esport-lecteur-image-precedente" />
          <BoutonHub theme={theme} titre="⏭︎" libelle={tr('medias.lecteur.image_suivante')} onPress={() => image(1)} testID="esport-lecteur-image-suivante" />
          <input
            type="range"
            aria-label={tr('medias.lecteur.position')}
            data-testid="esport-lecteur-position"
            min={0}
            max={duree > 0 ? duree : 1}
            step={0.1}
            value={Math.min(temps, duree > 0 ? duree : 1)}
            onChange={e => {
              const v = video.current;
              if (v) v.currentTime = Number(e.target.value);
            }}
            style={{ flex: 1, minWidth: 120, accentColor: theme.accent }}
          />
          <Text style={attenue} testID="esport-lecteur-temps">
            {formatTemps(temps)} / {duree > 0 ? formatTemps(duree) : '--:--'}
          </Text>
          <BoutonHub theme={theme} titre="⛶" libelle={pleinEcran ? tr('medias.lecteur.quitter_plein_ecran') : tr('medias.lecteur.plein_ecran')} onPress={basculerPleinEcran} testID="esport-lecteur-plein-ecran" />
        </View>
      </div>
      {infos?.media?.peuCompatibleIphone ? (
        <Text testID="esport-lecteur-avertissement" style={{ color: theme.alerte, fontSize: 12, ...police(theme.policeTexte) }}>
          {tr('medias.peu_compatible_iphone')}
        </Text>
      ) : null}
      <Text style={{ color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) }}>{tr('medias.lecteur.aide_touches')}</Text>
      {erreur ? (
        <Text testID="esport-lecteur-erreur" style={{ color: theme.critique, ...police(theme.policeTexte) }}>
          {erreur}
        </Text>
      ) : null}
    </View>
  );
}
