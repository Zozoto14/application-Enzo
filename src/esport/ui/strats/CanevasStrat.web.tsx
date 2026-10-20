/**
 * Canevas 2D de l'éditeur de strats (Konva, via react-konva). Chargé à la
 * demande (import dynamique depuis Editeur.web.tsx) : Konva n'entre dans le
 * paquet du site qu'à l'ouverture de l'éditeur.
 *
 * Repère du document : carré de 1000 ; la scène applique l'échelle
 * (taille affichée / 1000 × zoom) et le déplacement de la vue. Calques Konva
 * = calques de la strat : fond (minimap), utilitaires (agents, capacités et
 * leurs zones), dessins (flèches, lignes, formes), texte. Un calque masqué
 * n'est pas dessiné ; un calque verrouillé n'écoute plus le pointeur.
 *
 * Tactile (iPad dans le navigateur) : un doigt dessine ou déplace, deux
 * doigts zooment et déplacent la vue (pincement) ; `touch-action: none`
 * empêche le navigateur de faire défiler la page sous le canevas.
 */

import Konva from 'konva';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Arrow, Circle, Ellipse, Group, Image as KImage, Layer, Line, Rect, Stage, Text as KText, Wedge } from 'react-konva';
import { initiales, type AgentAsset, type CacheImages, type CapaciteAsset } from '../../strats/assets';
import { calqueDe, couleurJoueur, idUnique, zoneParDefaut, zoomer, type Action, type DocumentStrat, type FormeZone, type ObjetStrat, type Vue } from '../../strats/document';
import { tr } from '../../i18n';

export type Outil = 'selection' | 'main' | 'agent' | 'capacite' | 'fleche' | 'ligne' | 'forme' | 'texte' | 'gomme';

export interface ExportCanevas {
  /** PNG de l'étape affichée (1000 × 1000 × `ratio`), en data URL. */
  png(ratio?: number): string;
  /** Miniature JPEG (320 px) pour la grille. */
  miniature(): string;
}

export interface PropsCanevas {
  doc: DocumentStrat;
  /** Image de fond (minimap) : celle du document, sinon celle des assets. */
  fond: string | null;
  etape: number;
  taille: number;
  outil: Outil;
  couleur: string;
  joueur: number | null;
  agent?: AgentAsset;
  capacite?: CapaciteAsset;
  formeZone: FormeZone | 'aucune';
  formeDessin: 'rect' | 'ellipse';
  texte: string;
  tirets: boolean;
  epaisseur: number;
  selection?: string;
  onSelection(id: string | undefined): void;
  vue: Vue;
  onVue(v: Vue): void;
  onAction(a: Action): void;
  images: CacheImages;
  onPret(e: ExportCanevas): void;
}

Konva.hitOnDragEnabled = true;

/** Image d'un asset (blob local) ; undefined tant qu'elle n'est pas chargée, ou si elle ne charge pas (repli). */
function useImage(url: string | null | undefined, images: CacheImages): HTMLImageElement | undefined {
  const [img, setImg] = useState<HTMLImageElement | undefined>();
  useEffect(() => {
    let vivant = true;
    setImg(undefined);
    void images.obtenir(url ?? null).then(src => {
      if (!src || !vivant) return;
      const i = new window.Image();
      i.onload = () => vivant && setImg(i);
      i.src = src;
    });
    return () => {
      vivant = false;
    };
  }, [url, images]);
  return img;
}

/** Jeton rond : couleur du joueur, initiales (repli), icône par-dessus si elle est chargée. */
function Jeton({ rayon, couleur, nom, icone, images, surbrillance }: { rayon: number; couleur: string; nom: string; icone: string | null; images: CacheImages; surbrillance: boolean }) {
  const img = useImage(icone, images);
  return (
    <>
      <Circle radius={rayon} fill={couleur} stroke={surbrillance ? '#ffffff' : '#0b0f17'} strokeWidth={surbrillance ? 4 : 2} shadowColor="#000000" shadowBlur={surbrillance ? 14 : 4} shadowOpacity={0.6} />
      {img ? (
        <KImage image={img} x={-rayon * 0.82} y={-rayon * 0.82} width={rayon * 1.64} height={rayon * 1.64} listening={false} />
      ) : (
        <KText text={initiales(nom)} fontSize={rayon * 0.9} fontStyle="bold" fill="#ffffff" width={rayon * 2} x={-rayon} y={-rayon * 0.45} align="center" listening={false} />
      )}
    </>
  );
}

function Objet({ o, images, surbrillance, deplacable, onFin }: { o: ObjetStrat; images: CacheImages; surbrillance: boolean; deplacable: boolean; onFin(o: ObjetStrat, node: Konva.Node): void }) {
  const commun = {
    id: o.id,
    name: 'objet',
    draggable: deplacable,
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
      e.cancelBubble = true;
      onFin(o, e.target);
    },
  };
  const ombre = surbrillance ? { shadowColor: '#ffffff', shadowBlur: 12, shadowOpacity: 0.9 } : {};
  switch (o.type) {
    case 'agent':
      return (
        <Group {...commun} x={o.x} y={o.y}>
          <Jeton rayon={22} couleur={o.couleur} nom={o.nom} icone={o.icone} images={images} surbrillance={surbrillance} />
        </Group>
      );
    case 'capacite': {
      const z = o.zone;
      return (
        <Group {...commun} x={o.x} y={o.y}>
          {z?.forme === 'cercle' ? <Circle radius={z.rayon} fill={o.couleur} opacity={0.35} stroke={o.couleur} strokeWidth={2} /> : null}
          {z?.forme === 'mur' ? <Line points={[0, 0, z.dx, z.dy]} stroke={o.couleur} strokeWidth={z.epaisseur} lineCap="round" opacity={0.8} hitStrokeWidth={20} /> : null}
          {z?.forme === 'cone' ? <Wedge radius={z.rayon} angle={z.ouverture} rotation={z.angle - z.ouverture / 2} fill={o.couleur} opacity={0.3} stroke={o.couleur} strokeWidth={2} /> : null}
          <Jeton rayon={14} couleur={o.couleur} nom={o.nom} icone={o.icone} images={images} surbrillance={surbrillance} />
        </Group>
      );
    }
    case 'fleche':
    case 'ligne': {
      const props = { ...commun, ...ombre, x: 0, y: 0, points: o.points, stroke: o.couleur, strokeWidth: o.epaisseur, lineCap: 'round' as const, lineJoin: 'round' as const, tension: o.points.length > 4 ? 0.35 : 0, dash: o.tirets ? [14, 10] : undefined, hitStrokeWidth: 24 };
      return o.type === 'fleche' ? <Arrow {...props} fill={o.couleur} pointerLength={16} pointerWidth={16} /> : <Line {...props} />;
    }
    case 'forme':
      return o.forme === 'rect' ? (
        <Rect {...commun} {...ombre} x={o.x} y={o.y} width={o.l} height={o.h} stroke={o.couleur} strokeWidth={3} fill={o.remplie ? o.couleur : undefined} opacity={o.remplie ? 0.45 : 1} />
      ) : (
        <Ellipse {...commun} {...ombre} x={o.x + o.l / 2} y={o.y + o.h / 2} radiusX={o.l / 2} radiusY={o.h / 2} stroke={o.couleur} strokeWidth={3} fill={o.remplie ? o.couleur : undefined} opacity={o.remplie ? 0.45 : 1} />
      );
    case 'texte':
      return <KText {...commun} {...ombre} x={o.x} y={o.y} text={o.texte} fontSize={o.taille} fontStyle="bold" fill={o.couleur} stroke="#000000" strokeWidth={0.8} fillAfterStrokeEnabled />;
  }
}

type Brouillon = { type: 'trace'; points: number[] } | { type: 'forme'; x: number; y: number; l: number; h: number };

export default function CanevasStrat(p: PropsCanevas) {
  const { doc, etape, taille, outil, vue, onVue, onAction, images } = p;
  const scene = useRef<Konva.Stage>(null);
  const [brouillon, setBrouillon] = useState<Brouillon | undefined>();
  const pincement = useRef<{ distance: number; centre: { x: number; y: number } } | undefined>(undefined);
  const fondImg = useImage(p.fond, images);
  const e = doc.etapes[etape];
  const base = taille / 1000;

  // Export : la vue est remise à plat (1000 × 1000) le temps du rendu, puis rétablie.
  const exporter = useCallback(
    (options: { pixelRatio: number; mimeType?: string; quality?: number }) => {
      const st = scene.current;
      if (!st) throw new Error(tr('strats.canevasStrat.canevas_pas_pret'));
      const avant = { echelle: st.scaleX(), x: st.x(), y: st.y() };
      st.scale({ x: 1, y: 1 });
      st.position({ x: 0, y: 0 });
      try {
        return st.toDataURL({ x: 0, y: 0, width: 1000, height: 1000, ...options });
      } finally {
        st.scale({ x: avant.echelle, y: avant.echelle });
        st.position({ x: avant.x, y: avant.y });
        st.batchDraw();
      }
    },
    [],
  );
  const { onPret } = p;
  useEffect(() => {
    onPret({ png: (ratio = 1) => exporter({ pixelRatio: ratio }), miniature: () => exporter({ pixelRatio: 0.32, mimeType: 'image/jpeg', quality: 0.75 }) });
  }, [onPret, exporter]);

  const position = () => {
    const pt = scene.current?.getRelativePointerPosition();
    return pt ? { x: Math.round(pt.x * 10) / 10, y: Math.round(pt.y * 10) / 10 } : undefined;
  };
  const objetSous = (cible: Konva.Node): string | undefined => {
    const groupe = cible.hasName('objet') ? cible : cible.findAncestor('.objet', true);
    return groupe?.id() || undefined;
  };
  const verrou = (o: ObjetStrat) => doc.calques[calqueDe(o)].verrou;

  function auPointeurBas(ev: Konva.KonvaEventObject<PointerEvent>) {
    if (pincement.current || (ev.evt && ev.evt.isPrimary === false)) return;
    const pt = position();
    if (!pt || !e) return;
    const touche = objetSous(ev.target);
    const ajouter = (objet: ObjetStrat) => onAction({ type: 'ajouter', etape, objet });
    const ids = () => doc.etapes.flatMap(x => x.objets.map(o => o.id));
    switch (outil) {
      case 'selection':
        p.onSelection(touche);
        return;
      case 'gomme':
        if (touche) onAction({ type: 'supprimer', etape, id: touche });
        return;
      case 'agent':
        if (p.agent) ajouter({ id: idUnique(ids()), type: 'agent', x: pt.x, y: pt.y, agent: p.agent.cle, nom: p.agent.nom, icone: p.agent.icone, joueur: p.joueur, couleur: p.joueur !== null ? couleurJoueur(doc, p.joueur) : p.couleur });
        return;
      case 'capacite':
        if (p.agent && p.capacite) {
          ajouter({
            id: idUnique(ids()),
            type: 'capacite',
            x: pt.x,
            y: pt.y,
            agent: p.agent.cle,
            capacite: p.capacite.cle,
            nom: p.capacite.nom,
            icone: p.capacite.icone,
            joueur: p.joueur,
            couleur: p.joueur !== null ? couleurJoueur(doc, p.joueur) : p.couleur,
            zone: zoneParDefaut(p.formeZone),
          });
        }
        return;
      case 'texte':
        if (p.texte.trim()) ajouter({ id: idUnique(ids()), type: 'texte', x: pt.x, y: pt.y, texte: p.texte.trim().slice(0, 200), couleur: p.couleur, taille: 26 });
        return;
      case 'fleche':
      case 'ligne':
        setBrouillon({ type: 'trace', points: [pt.x, pt.y, pt.x, pt.y] });
        return;
      case 'forme':
        setBrouillon({ type: 'forme', x: pt.x, y: pt.y, l: 0, h: 0 });
        return;
      default:
        return;
    }
  }

  function auPointeurBouge() {
    if (!brouillon || pincement.current) return;
    const pt = position();
    if (!pt) return;
    if (brouillon.type === 'forme') {
      setBrouillon({ ...brouillon, l: pt.x - brouillon.x, h: pt.y - brouillon.y });
      return;
    }
    const pts = brouillon.points;
    const n = pts.length;
    const [px, py] = [pts[n - 4], pts[n - 3]];
    // Tracé à main levée : un point de plus tous les 18 (32 points au plus), sinon le dernier suit le pointeur.
    if (Math.hypot(pt.x - px, pt.y - py) > 18 && n < 64) setBrouillon({ type: 'trace', points: [...pts.slice(0, n - 2), pt.x, pt.y, pt.x, pt.y] });
    else setBrouillon({ type: 'trace', points: [...pts.slice(0, n - 2), pt.x, pt.y] });
  }

  function auPointeurHaut() {
    if (!brouillon) return;
    setBrouillon(undefined);
    const ids = doc.etapes.flatMap(x => x.objets.map(o => o.id));
    if (brouillon.type === 'forme') {
      const x = Math.min(brouillon.x, brouillon.x + brouillon.l);
      const y = Math.min(brouillon.y, brouillon.y + brouillon.h);
      const l = Math.abs(brouillon.l);
      const h = Math.abs(brouillon.h);
      if (l < 6 || h < 6) return;
      onAction({ type: 'ajouter', etape, objet: { id: idUnique(ids), type: 'forme', forme: p.formeDessin, x, y, l, h, couleur: p.couleur, remplie: false } });
      return;
    }
    // Points en double (dernier point fixe) retirés ; un tracé trop court est ignoré.
    const pts = brouillon.points;
    const propres: number[] = [];
    for (let i = 0; i < pts.length; i += 2) {
      const n = propres.length;
      if (n >= 2 && Math.hypot(pts[i] - propres[n - 2], pts[i + 1] - propres[n - 1]) < 2) continue;
      propres.push(pts[i], pts[i + 1]);
    }
    if (propres.length < 4 || Math.hypot(propres[propres.length - 2] - propres[0], propres[propres.length - 1] - propres[1]) < 8) return;
    onAction({ type: 'ajouter', etape, objet: { id: idUnique(ids), type: outil === 'ligne' ? 'ligne' : 'fleche', points: propres, couleur: p.couleur, epaisseur: p.epaisseur, tirets: p.tirets } });
  }

  function finDeplacement(o: ObjetStrat, node: Konva.Node) {
    const origine = 'points' in o ? { x: 0, y: 0 } : o.type === 'forme' && o.forme === 'ellipse' ? { x: o.x + o.l / 2, y: o.y + o.h / 2 } : { x: o.x, y: o.y };
    const dx = node.x() - origine.x;
    const dy = node.y() - origine.y;
    // Le nœud revient à sa place : c'est le document (et donc l'historique) qui le déplace.
    node.position(origine);
    onAction({ type: 'deplacer', etape, id: o.id, dx: Math.round(dx * 10) / 10, dy: Math.round(dy * 10) / 10 });
  }

  function molette(ev: Konva.KonvaEventObject<WheelEvent>) {
    ev.evt.preventDefault();
    const st = scene.current;
    const pt = st?.getPointerPosition();
    if (!pt) return;
    onVue(zoomer(vue, ev.evt.deltaY < 0 ? 1.12 : 1 / 1.12, pt));
  }

  function toucheBouge(ev: Konva.KonvaEventObject<TouchEvent>) {
    const t = ev.evt.touches;
    if (t.length !== 2) return;
    ev.evt.preventDefault();
    const rect = scene.current?.container().getBoundingClientRect();
    if (!rect) return;
    const a = { x: t[0].clientX - rect.left, y: t[0].clientY - rect.top };
    const b = { x: t[1].clientX - rect.left, y: t[1].clientY - rect.top };
    const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    const avant = pincement.current;
    pincement.current = { distance, centre };
    setBrouillon(undefined);
    if (!avant || avant.distance === 0) return;
    const v = zoomer(vue, distance / avant.distance, centre);
    onVue({ ...v, x: v.x + centre.x - avant.centre.x, y: v.y + centre.y - avant.centre.y });
  }

  const visible = useMemo(() => doc.calques, [doc.calques]);
  const parCalque = (c: 'utilitaires' | 'dessins' | 'texte') => (e?.objets ?? []).filter(o => calqueDe(o) === c);
  const deplacable = (o: ObjetStrat) => outil === 'selection' && !verrou(o);

  return (
    <div style={{ touchAction: 'none', width: taille, height: taille, borderRadius: 10, overflow: 'hidden', cursor: outil === 'main' ? 'grab' : outil === 'selection' ? 'default' : 'crosshair' }} data-testid="esport-canevas">
      <Stage
        ref={scene}
        width={taille}
        height={taille}
        scaleX={base * vue.echelle}
        scaleY={base * vue.echelle}
        x={vue.x}
        y={vue.y}
        draggable={outil === 'main'}
        onDragEnd={ev => {
          if (ev.target === scene.current) onVue({ ...vue, x: ev.target.x(), y: ev.target.y() });
        }}
        onPointerDown={auPointeurBas}
        onPointerMove={auPointeurBouge}
        onPointerUp={auPointeurHaut}
        onPointerLeave={auPointeurHaut}
        onWheel={molette}
        onTouchMove={toucheBouge}
        onTouchEnd={() => {
          pincement.current = undefined;
        }}>
        <Layer listening={false} visible={visible.fond.visible}>
          <Rect width={1000} height={1000} fill="#1f2937" />
          <KText text={doc.carte.nom} fontSize={72} fill="#374151" width={1000} y={460} align="center" />
          {fondImg ? <KImage image={fondImg} width={1000} height={1000} /> : null}
        </Layer>
        {(['utilitaires', 'dessins', 'texte'] as const).map(c => (
          <Layer key={c} visible={visible[c].visible} listening={!visible[c].verrou}>
            {parCalque(c).map(o => (
              <Objet key={o.id} o={o} images={images} surbrillance={p.selection === o.id} deplacable={deplacable(o)} onFin={finDeplacement} />
            ))}
            {c === 'dessins' && brouillon?.type === 'trace' ? (
              outil === 'fleche' ? (
                <Arrow points={brouillon.points} stroke={p.couleur} fill={p.couleur} strokeWidth={p.epaisseur} tension={0.35} pointerLength={16} pointerWidth={16} dash={p.tirets ? [14, 10] : undefined} listening={false} />
              ) : (
                <Line points={brouillon.points} stroke={p.couleur} strokeWidth={p.epaisseur} tension={0.35} dash={p.tirets ? [14, 10] : undefined} listening={false} />
              )
            ) : null}
            {c === 'dessins' && brouillon?.type === 'forme' ? (
              p.formeDessin === 'rect' ? (
                <Rect x={brouillon.x} y={brouillon.y} width={brouillon.l} height={brouillon.h} stroke={p.couleur} strokeWidth={3} dash={[8, 6]} listening={false} />
              ) : (
                <Ellipse x={brouillon.x + brouillon.l / 2} y={brouillon.y + brouillon.h / 2} radiusX={Math.abs(brouillon.l / 2)} radiusY={Math.abs(brouillon.h / 2)} stroke={p.couleur} strokeWidth={3} dash={[8, 6]} listening={false} />
              )
            ) : null}
          </Layer>
        ))}
      </Stage>
    </div>
  );
}
