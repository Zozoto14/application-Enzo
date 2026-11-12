/**
 * Plan d'une map dans Administration › Jeux (site et app PC, Konva chargé à la demande) : image déposée
 * cadrée dans le repère carré de 1000 (celui des strats), callouts, repères, calibrage, et le tracé en
 * cours. Chaque toucher sur le plan est rapporté (`onPoint`) en coordonnées du repère.
 */

import Konva from 'konva';
import React, { useEffect, useRef, useState } from 'react';
import { Circle, Group, Image as KImage, Layer, Line, Rect, Stage, Text as KText } from 'react-konva';
import type { CarteJeu } from '../../jeux/api';
import { cadreImage, centre } from '../../strats/geometrie';

export interface PropsPlanCarte {
  carte: CarteJeu;
  url: string | null;
  largeur?: number;
  hauteur?: number;
  taille: number;
  /** Points du tracé en cours (callout, ou les deux points du calibrage). */
  points: number[];
  fermer: boolean;
  onPoint(x: number, y: number): void;
}

export const planDisponible = true;

export default function PlanCarte({ carte, url, largeur, hauteur, taille, points, fermer, onPoint }: PropsPlanCarte) {
  const [img, setImg] = useState<HTMLImageElement | undefined>();
  const groupe = useRef<Konva.Group>(null);
  useEffect(() => {
    setImg(undefined);
    if (!url) return undefined;
    let vivant = true;
    const i = new window.Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => vivant && setImg(i);
    i.src = url;
    return () => {
      vivant = false;
    };
  }, [url]);
  const cadre = cadreImage(largeur ?? img?.naturalWidth, hauteur ?? img?.naturalHeight);
  const k = taille / 1000;
  return (
    <div style={{ touchAction: 'none', width: taille, height: taille, borderRadius: 10, overflow: 'hidden', cursor: 'crosshair' }} data-testid="esport-jeu-plan">
      <Stage
        width={taille}
        height={taille}
        scaleX={k}
        scaleY={k}
        onPointerDown={() => {
          const p = groupe.current?.getRelativePointerPosition();
          if (p) onPoint(Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10);
        }}>
        <Layer>
          <Group ref={groupe}>
            <Rect width={1000} height={1000} fill="#1f2937" />
            {img ? <KImage image={img} x={cadre.x} y={cadre.y} width={cadre.l} height={cadre.h} /> : <KText text={carte.nom} fontSize={64} fill="#374151" width={1000} y={460} align="center" />}
            {(carte.zones ?? []).map(z => {
              const c = centre(z.points);
              return (
                <Group key={z.cle} listening={false}>
                  <Line points={z.points} closed fill={z.couleur ?? '#ffffff'} opacity={0.15} stroke={z.couleur ?? '#ffffff'} strokeWidth={2} />
                  <KText x={c.x - 110} y={c.y - 10} width={220} align="center" text={z.nom} fontSize={20} fontStyle="bold" fill="#ffffff" stroke="#000000" strokeWidth={0.8} fillAfterStrokeEnabled />
                </Group>
              );
            })}
            {(carte.reperes ?? []).map(r => (
              <Group key={r.cle} x={r.x} y={r.y} listening={false}>
                <Rect x={-10} y={-10} width={20} height={20} rotation={45} fill="#f59e0b" stroke="#0b0f17" strokeWidth={2} />
                <KText x={-110} y={16} width={220} align="center" text={r.nom} fontSize={18} fontStyle="bold" fill="#ffffff" stroke="#000000" strokeWidth={0.8} fillAfterStrokeEnabled />
              </Group>
            ))}
            {carte.echelle ? <Line points={carte.echelle.points} stroke="#22c55e" strokeWidth={3} dash={[10, 6]} listening={false} /> : null}
            {points.length >= 4 ? <Line points={points} closed={fermer} stroke="#38bdf8" strokeWidth={3} dash={[8, 6]} listening={false} /> : null}
            {Array.from({ length: points.length / 2 }, (_, i) => (
              <Circle key={i} x={points[i * 2]} y={points[i * 2 + 1]} radius={7} fill="#38bdf8" stroke="#0b0f17" strokeWidth={2} listening={false} />
            ))}
          </Group>
        </Layer>
      </Stage>
    </div>
  );
}
