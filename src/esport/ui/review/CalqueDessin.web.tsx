/**
 * Calque d'édition du dessin sur la vidéo (Konva, via react-konva), posé
 * par-dessus le lecteur YouTube. Chargé à la demande (import dynamique depuis
 * dessinVideo.web.tsx).
 *
 * Repère interne : 640 × 360 (16:9) ; la scène applique l'échelle (largeur
 * affichée / 640). Les formes sont rendues en coordonnées RELATIVES (0 à 1).
 * Outils : flèche, cercle, rectangle, trait libre, texte, gomme (toucher une
 * forme l'efface). Tactile (iPad dans le navigateur) : un doigt dessine ;
 * `touch-action: none` empêche la page de défiler sous le calque.
 */

import Konva from 'konva';
import React, { useLayoutEffect, useRef, useState } from 'react';
import { Arrow, Ellipse, Layer, Line, Rect, Stage, Text as KText } from 'react-konva';
import { HAUTEUR_REFERENCE as H, LARGEUR_REFERENCE as L, POINTS_TRAIT_MAX, tailleTexte, type FormeDessin } from '../../review/dessin';
import type { PropsEditeurDessin } from './typesDessin';
import { tr } from '../../i18n';

Konva.hitOnDragEnabled = true;

type Brouillon = { t: 'fleche' | 'cercle' | 'rect' | 'trait'; p: number[] };

function Forme({ f, index }: { f: Pick<FormeDessin, 't' | 'c' | 'e' | 'p' | 'x'>; index?: number }) {
  const pts = f.p.map((v, i) => (i % 2 === 0 ? v * L : v * H));
  const commun = { id: index === undefined ? undefined : `forme-${index}`, name: index === undefined ? undefined : 'forme', listening: index !== undefined, hitStrokeWidth: 18 };
  switch (f.t) {
    case 'fleche':
      return <Arrow {...commun} points={pts.slice(0, 4)} stroke={f.c} fill={f.c} strokeWidth={f.e} pointerLength={8 + f.e * 2.2} pointerWidth={8 + f.e * 2.2} lineCap="round" />;
    case 'cercle':
      return <Ellipse {...commun} x={(pts[0] + pts[2]) / 2} y={(pts[1] + pts[3]) / 2} radiusX={Math.abs(pts[2] - pts[0]) / 2} radiusY={Math.abs(pts[3] - pts[1]) / 2} stroke={f.c} strokeWidth={f.e} />;
    case 'rect':
      return <Rect {...commun} x={Math.min(pts[0], pts[2])} y={Math.min(pts[1], pts[3])} width={Math.abs(pts[2] - pts[0])} height={Math.abs(pts[3] - pts[1])} stroke={f.c} strokeWidth={f.e} />;
    case 'trait':
      return <Line {...commun} points={pts} stroke={f.c} strokeWidth={f.e} lineCap="round" lineJoin="round" tension={0.3} />;
    case 'texte':
      return <KText {...commun} x={pts[0]} y={pts[1]} text={f.x ?? ''} fill={f.c} fontSize={tailleTexte(f.e)} fontStyle="bold" fontFamily="system-ui, sans-serif" stroke="#000000" strokeWidth={0.6} fillAfterStrokeEnabled />;
  }
}

export default function CalqueDessin({ objets, outil, couleur, epaisseur, texte, onAjouter, onGommer }: PropsEditeurDessin) {
  const boite = useRef<HTMLDivElement>(null);
  const scene = useRef<Konva.Stage>(null);
  const [taille, setTaille] = useState({ l: 0, h: 0 });
  const [brouillon, setBrouillon] = useState<Brouillon | undefined>();

  useLayoutEffect(() => {
    const el = boite.current;
    if (!el) return undefined;
    const mesurer = () => setTaille({ l: el.clientWidth, h: el.clientHeight });
    mesurer();
    const RO = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (!RO) return undefined;
    const o = new RO(mesurer);
    o.observe(el);
    return () => o.disconnect();
  }, []);

  const position = () => {
    const pt = scene.current?.getRelativePointerPosition();
    return pt ? { x: Math.max(0, Math.min(L, pt.x)), y: Math.max(0, Math.min(H, pt.y)) } : undefined;
  };
  const relatif = (pts: number[]) => pts.map((v, i) => (i % 2 === 0 ? v / L : v / H));

  function bas(ev: Konva.KonvaEventObject<PointerEvent>) {
    if (ev.evt && ev.evt.isPrimary === false) return;
    const pt = position();
    if (!pt) return;
    if (outil === 'gomme') {
      const cible = ev.target.hasName('forme') ? ev.target : ev.target.findAncestor('.forme', true);
      const id = cible?.id();
      if (id) onGommer(Number(id.replace('forme-', '')));
      return;
    }
    if (outil === 'texte') {
      if (texte.trim()) onAjouter({ t: 'texte', c: couleur, e: epaisseur, p: relatif([pt.x, pt.y]), x: texte.trim() });
      return;
    }
    setBrouillon({ t: outil, p: [pt.x, pt.y, pt.x, pt.y] });
  }

  function bouge() {
    if (!brouillon) return;
    const pt = position();
    if (!pt) return;
    const p = brouillon.p;
    const n = p.length;
    if (brouillon.t === 'trait') {
      // Main levée : un point de plus tous les 4 px (200 points au plus), sinon le dernier suit le pointeur.
      if (Math.hypot(pt.x - p[n - 4], pt.y - p[n - 3]) > 4 && n < POINTS_TRAIT_MAX * 2) setBrouillon({ ...brouillon, p: [...p.slice(0, n - 2), pt.x, pt.y, pt.x, pt.y] });
      else setBrouillon({ ...brouillon, p: [...p.slice(0, n - 2), pt.x, pt.y] });
      return;
    }
    setBrouillon({ ...brouillon, p: [p[0], p[1], pt.x, pt.y] });
  }

  function haut() {
    const b = brouillon;
    if (!b) return;
    setBrouillon(undefined);
    const p = b.p;
    if (b.t === 'trait') {
      // Points en double retirés ; un tracé trop court est ignoré.
      const propres: number[] = [];
      for (let i = 0; i < p.length; i += 2) {
        const k = propres.length;
        if (k >= 2 && Math.hypot(p[i] - propres[k - 2], p[i + 1] - propres[k - 1]) < 1) continue;
        propres.push(p[i], p[i + 1]);
      }
      if (propres.length < 4) return;
      onAjouter({ t: 'trait', c: couleur, e: epaisseur, p: relatif(propres) });
      return;
    }
    const [x1, y1, x2, y2] = p;
    if (b.t === 'fleche' ? Math.hypot(x2 - x1, y2 - y1) < 6 : Math.abs(x2 - x1) < 4 || Math.abs(y2 - y1) < 4) return;
    onAjouter({ t: b.t, c: couleur, e: epaisseur, p: relatif([x1, y1, x2, y2]) });
  }

  const k = taille.l > 0 ? taille.l / L : 1;
  return (
    <div
      ref={boite}
      data-testid="esport-dessin-calque"
      aria-label={tr('review.calqueDessin.calque_de_dessin_sur')}
      style={{ position: 'absolute', inset: 0, touchAction: 'none', pointerEvents: 'auto', cursor: outil === 'gomme' ? 'not-allowed' : outil === 'texte' ? 'text' : 'crosshair', outline: '2px dashed rgba(255,255,255,0.55)', outlineOffset: -2 }}>
      {taille.l > 0 ? (
        <Stage ref={scene} width={taille.l} height={taille.h} scaleX={k} scaleY={taille.h > 0 ? taille.h / H : k} onPointerDown={bas} onPointerMove={bouge} onPointerUp={haut} onPointerLeave={haut}>
          <Layer>
            {/* Fond transparent mais « touchable » : le pointeur est capté partout. */}
            <Rect x={0} y={0} width={L} height={H} fill="rgba(0,0,0,0.001)" />
            {objets.map((f, i) => (
              <Forme key={i} f={f} index={i} />
            ))}
            {brouillon ? <Forme f={{ t: brouillon.t, c: couleur, e: epaisseur, p: relatif(brouillon.p) }} /> : null}
          </Layer>
        </Stage>
      ) : null}
    </div>
  );
}
