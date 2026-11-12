/**
 * Canevas 2D de l'éditeur de strats (Konva, via react-konva). Chargé à la
 * demande (import dynamique depuis Editeur.web.tsx) : Konva n'entre dans le
 * paquet du site qu'à l'ouverture de l'éditeur.
 *
 * Repère du document : carré de 1000 ; la scène applique l'échelle
 * (taille affichée / 1000 × zoom) et le déplacement de la vue. Calques Konva
 * = calques de la strat : fond (image de la map, cadrée sans déformation),
 * callouts (zones nommées et repères du profil de jeu), vision, utilitaires
 * (agents, capacités À L'ÉCHELLE de la map calibrée), marqueurs, dessins,
 * texte, puis les poignées de la sélection. Un calque masqué n'est pas
 * dessiné ; un calque verrouillé n'écoute plus le pointeur.
 *
 * « Retourner la map » (180°) tourne tout le contenu autour du centre ; les
 * pions et les textes restent à l'endroit. Lecture animée (`temps`) : les
 * utilitaires apparaissent à leur minutage, les trajets des joueurs
 * s'allongent et les pions les suivent.
 *
 * Tactile (iPad dans le navigateur) : un doigt dessine ou déplace, deux
 * doigts zooment et déplacent la vue (pincement) ; `touch-action: none`
 * empêche le navigateur de faire défiler la page sous le canevas.
 */

import Konva from 'konva';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Arrow, Circle, Ellipse, Group, Image as KImage, Layer, Line, Rect, RegularPolygon, Stage, Text as KText, Wedge } from 'react-konva';
import { initiales, type AgentAsset, type CacheImages, type CapaciteAsset, type CarteAsset } from '../../strats/assets';
import { calqueDe, couleurJoueur, idUnique, zoneParDefaut, zoomer, type Action, type DocumentStrat, type FormeZone, type ObjetStrat, type Vue, type Zone } from '../../strats/document';
import { aimanter, cadreImage, centre, dansPolygone, dimensionFixe, etatLecture, poignees, primitiveZone, tirerPoignee, tracePartiel, zoneDepuisCapacite, type EtatLecture, type Primitive } from '../../strats/geometrie';
import { COULEURS_EQUIPES, echelleEffective, type GenreMarqueur } from '../../strats/modeles';
import { tr } from '../../i18n';

export type Outil = 'selection' | 'main' | 'agent' | 'capacite' | 'fleche' | 'ligne' | 'forme' | 'texte' | 'marqueur' | 'vision' | 'gomme';

export interface ExportCanevas {
  /** PNG de l'étape affichée (1000 × 1000 × `ratio`), en data URL. */
  png(ratio?: number): string;
  /** Miniature JPEG (320 px) pour la grille. */
  miniature(): string;
}

export interface PropsCanevas {
  doc: DocumentStrat;
  /** Map du profil (image déposée ou minimap, échelle, callouts, repères). */
  carte?: CarteAsset;
  /** Image de fond (repli : celle du document). */
  fond: string | null;
  etape: number;
  taille: number;
  outil: Outil;
  couleur: string;
  joueur: number | null;
  agent?: AgentAsset;
  capacite?: CapaciteAsset;
  /** Forme de la zone posée : « auto » = celle des caractéristiques de la capacité. */
  formeZone: FormeZone | 'aucune' | 'auto';
  formeDessin: 'rect' | 'ellipse';
  texte: string;
  tirets: boolean;
  epaisseur: number;
  /** Flèche = trajet du joueur courant (minuté sur la durée de l'étape). */
  trajetJoueur?: boolean;
  marqueur?: { genre: GenreMarqueur; equipe: number | null; etiquette: string };
  vision?: { ouverture: number; portee: number };
  /** Étage courant (The Finals) : les objets posés le reçoivent, ceux des autres étages sont estompés. */
  niveau?: number | null;
  /** Aimantation sur une grille (unités ; 0 : aucune). */
  aimant?: number;
  rotation?: 0 | 180;
  /** Lecture animée : temps (s) dans l'étape ; absent : édition. */
  temps?: number;
  /** Prochain numéro d'ordre des utilitaires. */
  ordreSuivant?: number;
  selection?: string;
  onSelection(id: string | undefined): void;
  /** Callout (zone nommée du profil) sous le pointeur. */
  onCallout?(nom: string | undefined): void;
  vue: Vue;
  onVue(v: Vue): void;
  onAction(a: Action): void;
  images: CacheImages;
  onPret?(e: ExportCanevas): void;
  testID?: string;
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

/** Texte centré qui reste à l'endroit quand la map est retournée. */
function Etiquette({ x, y, texte, taille, couleur = '#ffffff', rotation = 0, largeur = 220 }: { x: number; y: number; texte: string; taille: number; couleur?: string; rotation?: number; largeur?: number }) {
  return (
    <KText
      x={x}
      y={y}
      text={texte}
      fontSize={taille}
      fontStyle="bold"
      fill={couleur}
      stroke="#000000"
      strokeWidth={Math.max(0.6, taille / 30)}
      fillAfterStrokeEnabled
      width={largeur}
      offsetX={largeur / 2}
      offsetY={taille / 2}
      align="center"
      rotation={rotation}
      listening={false}
    />
  );
}

/** Dessin d'une zone de capacité (primitive à l'échelle), relative au point de pose. */
function FormeZone({ p, couleur, ox, oy }: { p: Primitive; couleur: string; ox: number; oy: number }) {
  switch (p.type) {
    case 'cercle':
      return <Circle x={p.x - ox} y={p.y - oy} radius={p.r} fill={couleur} opacity={0.35} stroke={couleur} strokeWidth={2} />;
    case 'secteur':
      return p.ouverture >= 359 ? (
        <Circle x={p.x - ox} y={p.y - oy} radius={p.r} fill={couleur} opacity={0.25} stroke={couleur} strokeWidth={2} />
      ) : (
        <Wedge x={p.x - ox} y={p.y - oy} radius={p.r} angle={p.ouverture} rotation={p.angle - p.ouverture / 2} fill={couleur} opacity={0.3} stroke={couleur} strokeWidth={2} />
      );
    case 'trait':
      return (
        <Line
          points={p.points.map((n, i) => n - (i % 2 === 0 ? ox : oy))}
          stroke={couleur}
          strokeWidth={p.epaisseur}
          lineCap="round"
          tension={p.courbe ? 0.5 : 0}
          dash={p.tirets ? [10, 7] : undefined}
          opacity={0.85}
          hitStrokeWidth={Math.max(20, p.epaisseur)}
        />
      );
    case 'rect':
      return <Rect x={p.x - ox} y={p.y - oy} width={p.longueur} height={p.largeur} offsetY={p.largeur / 2} rotation={p.angle} fill={couleur} opacity={0.3} stroke={couleur} strokeWidth={2} />;
    case 'trajet':
      return (
        <>
          <Arrow points={p.points.map((n, i) => n - (i % 2 === 0 ? ox : oy))} stroke={couleur} fill={couleur} strokeWidth={3} dash={[10, 7]} pointerLength={12} pointerWidth={12} opacity={0.9} />
          {p.r > 0 ? <Circle x={p.points[2] - ox} y={p.points[3] - oy} radius={p.r} fill={couleur} opacity={0.12} stroke={couleur} strokeWidth={2} dash={[6, 6]} /> : null}
        </>
      );
  }
}

/** Forme d'un marqueur selon son genre (losange, croix, triangle, carré…), couleur de l'équipe adverse le cas échéant. */
function Marqueur({ genre, couleur }: { genre: GenreMarqueur; couleur: string }) {
  const contour = { stroke: '#0b0f17', strokeWidth: 2.5 };
  switch (genre) {
    case 'ennemi':
      return (
        <>
          <Circle radius={15} fill={couleur} {...contour} />
          <Line points={[-7, -7, 7, 7]} stroke="#ffffff" strokeWidth={3} />
          <Line points={[7, -7, -7, 7]} stroke="#ffffff" strokeWidth={3} />
        </>
      );
    case 'danger':
    case 'tiers':
      return <RegularPolygon sides={3} radius={17} fill={couleur} {...contour} />;
    case 'destruction-mur':
    case 'destruction-sol':
      return (
        <>
          <Rect x={-14} y={-14} width={28} height={28} fill="#111827" stroke={couleur} strokeWidth={3} dash={genre === 'destruction-sol' ? [5, 4] : undefined} />
          <Line points={[-9, -9, 9, 9]} stroke={couleur} strokeWidth={4} />
          <Line points={[9, -9, -9, 9]} stroke={couleur} strokeWidth={4} />
        </>
      );
    case 'cashout':
    case 'coffre':
    case 'objectif':
    case 'plant':
      return <Rect x={-14} y={-14} width={28} height={28} rotation={45} fill={couleur} {...contour} />;
    case 'spawn':
      return <RegularPolygon sides={6} radius={16} fill={couleur} {...contour} />;
    default:
      return <Circle radius={12} fill={couleur} {...contour} />;
  }
}

interface PropsObjet {
  o: ObjetStrat;
  images: CacheImages;
  surbrillance: boolean;
  deplacable: boolean;
  echelle: number | null | undefined;
  rotation: number;
  estompe: boolean;
  lecture?: EtatLecture;
  /** Position imposée (pion qui suit son trajet pendant la lecture). */
  position?: { x: number; y: number };
  zoneApercu?: Zone;
  onFin(o: ObjetStrat, node: Konva.Node): void;
}

function Objet({ o, images, surbrillance, deplacable, echelle, rotation, estompe, lecture, position, zoneApercu, onFin }: PropsObjet) {
  const commun = {
    id: o.id,
    name: 'objet',
    draggable: deplacable,
    opacity: estompe ? 0.3 : 1,
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
      e.cancelBubble = true;
      onFin(o, e.target);
    },
  };
  const ombre = surbrillance ? { shadowColor: '#ffffff', shadowBlur: 12, shadowOpacity: 0.9 } : {};
  const niveau = typeof o.niveau === 'number' ? `${o.niveau}` : '';
  switch (o.type) {
    case 'agent': {
      const p = position ?? { x: o.x, y: o.y };
      return (
        <Group {...commun} x={p.x} y={p.y}>
          {typeof o.angle === 'number' ? <Wedge radius={34} angle={40} rotation={o.angle - 20} fill={o.couleur} opacity={0.55} listening={false} /> : null}
          <Group rotation={-rotation}>
            <Jeton rayon={22} couleur={o.couleur} nom={o.nom} icone={o.icone} images={images} surbrillance={surbrillance} />
            {niveau ? <Etiquette x={20} y={-20} texte={niveau} taille={14} /> : null}
          </Group>
        </Group>
      );
    }
    case 'capacite': {
      const z = zoneApercu ?? o.zone;
      return (
        <Group {...commun} x={o.x} y={o.y}>
          {z ? <FormeZone p={primitiveZone(o.x, o.y, z, echelle)} couleur={o.couleur} ox={o.x} oy={o.y} /> : null}
          <Group rotation={-rotation}>
            <Jeton rayon={14} couleur={o.couleur} nom={o.nom} icone={o.icone} images={images} surbrillance={surbrillance} />
            {typeof o.ordre === 'number' ? (
              <>
                <Circle x={14} y={-14} radius={9} fill="#0b0f17" stroke="#ffffff" strokeWidth={1.5} listening={false} />
                <KText x={5} y={-20} width={18} text={String(o.ordre)} fontSize={12} fontStyle="bold" fill="#ffffff" align="center" listening={false} />
              </>
            ) : null}
            {niveau ? <Etiquette x={-16} y={-18} texte={niveau} taille={12} /> : null}
          </Group>
        </Group>
      );
    }
    case 'vision':
      return (
        <Group {...commun} x={o.x} y={o.y}>
          <Wedge
            radius={o.portee * echelleEffective(echelle)}
            angle={o.ouverture}
            rotation={o.angle - o.ouverture / 2}
            fill={o.couleur}
            opacity={0.16}
            stroke={o.couleur}
            strokeWidth={surbrillance ? 3 : 1.5}
            dash={[8, 6]}
          />
          <Circle radius={5} fill={o.couleur} />
        </Group>
      );
    case 'marqueur': {
      const couleur = o.genre === 'ennemi' && typeof o.equipe === 'number' && o.equipe > 0 ? COULEURS_EQUIPES[(o.equipe - 1) % COULEURS_EQUIPES.length] : o.couleur;
      return (
        <Group {...commun} {...ombre} x={o.x} y={o.y}>
          <Group rotation={-rotation}>
            <Marqueur genre={o.genre} couleur={couleur} />
            {o.genre === 'ennemi' && o.equipe ? <KText x={-6} y={-30} text={`E${o.equipe}`} fontSize={12} fontStyle="bold" fill="#ffffff" listening={false} /> : null}
            {o.etiquette ? <Etiquette x={0} y={30} texte={o.etiquette} taille={16} /> : null}
            {niveau ? <Etiquette x={18} y={-18} texte={niveau} taille={12} /> : null}
          </Group>
        </Group>
      );
    }
    case 'fleche':
    case 'ligne': {
      const f = lecture?.progression.get(o.id);
      const pts = f === undefined ? o.points : tracePartiel(o.points, f);
      const props = { ...commun, ...ombre, x: 0, y: 0, points: pts, stroke: o.couleur, strokeWidth: o.epaisseur, lineCap: 'round' as const, lineJoin: 'round' as const, tension: pts.length > 4 ? 0.35 : 0, dash: o.tirets ? [14, 10] : undefined, hitStrokeWidth: 24 };
      return o.type === 'fleche' ? <Arrow {...props} fill={o.couleur} pointerLength={16} pointerWidth={16} /> : <Line {...props} />;
    }
    case 'forme':
      return o.forme === 'rect' ? (
        <Rect {...commun} {...ombre} x={o.x} y={o.y} width={o.l} height={o.h} stroke={o.couleur} strokeWidth={3} fill={o.remplie ? o.couleur : undefined} opacity={(o.remplie ? 0.45 : 1) * (estompe ? 0.3 : 1)} />
      ) : (
        <Ellipse {...commun} {...ombre} x={o.x + o.l / 2} y={o.y + o.h / 2} radiusX={o.l / 2} radiusY={o.h / 2} stroke={o.couleur} strokeWidth={3} fill={o.remplie ? o.couleur : undefined} opacity={(o.remplie ? 0.45 : 1) * (estompe ? 0.3 : 1)} />
      );
    case 'texte':
      return <KText {...commun} {...ombre} x={o.x} y={o.y} text={o.texte} fontSize={o.taille} fontStyle="bold" fill={o.couleur} stroke="#000000" strokeWidth={0.8} fillAfterStrokeEnabled rotation={-rotation} />;
  }
}

/** Contenu tourné autour du centre du repère (map retournée). Composant stable : les nœuds ne sont pas recréés. */
const Tourne = React.forwardRef<Konva.Group, { rotation: number; children: React.ReactNode }>(function Tourne({ rotation, children }, ref) {
  return (
    <Group ref={ref} x={500} y={500} offsetX={500} offsetY={500} rotation={rotation}>
      {children}
    </Group>
  );
});

type Brouillon = { type: 'trace'; points: number[] } | { type: 'forme'; x: number; y: number; l: number; h: number };
type Poignee = { cle: 'fin' | 'courbe' | 'bord'; x: number; y: number };

export default function CanevasStrat(p: PropsCanevas) {
  const { doc, etape, taille, outil, vue, onVue, onAction, images, carte } = p;
  const rotation = p.rotation ?? 0;
  const scene = useRef<Konva.Stage>(null);
  const repere = useRef<Konva.Group>(null);
  const [brouillon, setBrouillon] = useState<Brouillon | undefined>();
  const [apercu, setApercu] = useState<{ id: string; zone?: Zone; vision?: { angle: number; portee: number } } | undefined>();
  const pincement = useRef<{ distance: number; centre: { x: number; y: number } } | undefined>(undefined);
  const fondImg = useImage(carte?.minimap ?? p.fond, images);
  const e = doc.etapes[etape];
  const base = taille / 1000;
  const echelle = carte?.echelle ?? doc.carte.echelle;
  const lecture = useMemo(() => (p.temps !== undefined && e ? etatLecture(e, p.temps) : undefined), [p.temps, e]);
  const cadre = cadreImage(fondImg && carte?.largeurImage ? carte.largeurImage : fondImg?.naturalWidth, fondImg && carte?.hauteurImage ? carte.hauteurImage : fondImg?.naturalHeight);
  const editable = p.temps === undefined;

  // Export : la vue est remise à plat (1000 × 1000) le temps du rendu, puis rétablie.
  const exporter = useCallback((options: { pixelRatio: number; mimeType?: string; quality?: number }) => {
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
  }, []);
  const { onPret } = p;
  useEffect(() => {
    onPret?.({ png: (ratio = 1) => exporter({ pixelRatio: ratio }), miniature: () => exporter({ pixelRatio: 0.32, mimeType: 'image/jpeg', quality: 0.75 }) });
  }, [onPret, exporter]);

  /** Point du pointeur dans le repère du document (map retournée comprise), aimanté au besoin. */
  const position = (aimante = true) => {
    const pt = repere.current?.getRelativePointerPosition();
    if (!pt) return undefined;
    const a = aimante ? (p.aimant ?? 0) : 0;
    return { x: Math.round(aimanter(pt.x, a) * 10) / 10, y: Math.round(aimanter(pt.y, a) * 10) / 10 };
  };
  const objetSous = (cible: Konva.Node): string | undefined => {
    const groupe = cible.hasName('objet') ? cible : cible.findAncestor('.objet', true);
    return groupe?.id() || undefined;
  };
  const verrou = (o: ObjetStrat) => doc.calques[calqueDe(o)].verrou;
  const niveau = p.niveau ?? null;
  const avecNiveau = <T extends ObjetStrat>(o: T): T => (niveau !== null ? { ...o, niveau } : o);
  /** Pion du joueur courant dans l'étape (origine d'un lancer, direction d'un cône). */
  const pionJoueur = (j: number | null) => (j === null ? undefined : e?.objets.find(o => o.type === 'agent' && o.joueur === j) as { x: number; y: number } | undefined);

  function auPointeurBas(ev: Konva.KonvaEventObject<PointerEvent>) {
    if (!editable || pincement.current || (ev.evt && ev.evt.isPrimary === false)) return;
    if (ev.target.hasName('poignee')) return;
    const pt = position();
    if (!pt || !e) return;
    const touche = objetSous(ev.target);
    const ajouter = (objet: ObjetStrat) => onAction({ type: 'ajouter', etape, objet: avecNiveau(objet) });
    const ids = () => doc.etapes.flatMap(x => x.objets.map(o => o.id));
    const couleur = p.joueur !== null ? couleurJoueur(doc, p.joueur) : p.couleur;
    switch (outil) {
      case 'selection':
        p.onSelection(touche);
        return;
      case 'gomme':
        if (touche) onAction({ type: 'supprimer', etape, id: touche });
        return;
      case 'agent':
        if (p.agent) ajouter({ id: idUnique(ids()), type: 'agent', x: pt.x, y: pt.y, agent: p.agent.cle, nom: p.agent.nom, icone: p.agent.icone, joueur: p.joueur, couleur });
        return;
      case 'capacite': {
        if (!p.agent || !p.capacite) return;
        let zone = p.formeZone === 'auto' ? zoneDepuisCapacite(p.capacite.donnees) : zoneParDefaut(p.formeZone);
        // Orientée depuis le pion du joueur (mur, cône, ligne) ; un trajet part du pion.
        const pion = pionJoueur(p.joueur);
        if (zone && pion && Math.hypot(pt.x - pion.x, pt.y - pion.y) > 4) {
          const angle = Math.round(((Math.atan2(pt.y - pion.y, pt.x - pion.x) * 180) / Math.PI) * 10) / 10;
          if (zone.forme === 'trajet') zone = { ...zone, dx: Math.round((pion.x - pt.x) * 10) / 10, dy: Math.round((pion.y - pt.y) * 10) / 10 };
          else if (zone.forme === 'cone' || zone.forme === 'ligne' || zone.forme === 'rect') zone = { ...zone, angle };
          else if (zone.forme === 'mur') zone = { ...zone, angle: angle + 90 };
        }
        const id = idUnique(ids());
        ajouter({ id, type: 'capacite', x: pt.x, y: pt.y, agent: p.agent.cle, capacite: p.capacite.cle, nom: p.capacite.nom, icone: p.capacite.icone, joueur: p.joueur, couleur, zone, ordre: p.ordreSuivant ?? null });
        p.onSelection(id);
        return;
      }
      case 'marqueur':
        if (p.marqueur) ajouter({ id: idUnique(ids()), type: 'marqueur', x: pt.x, y: pt.y, genre: p.marqueur.genre, etiquette: p.marqueur.etiquette.trim().slice(0, 40), couleur: p.couleur, equipe: p.marqueur.equipe });
        return;
      case 'vision': {
        const pion = pionJoueur(p.joueur);
        const id = idUnique(ids());
        ajouter({ id, type: 'vision', x: pt.x, y: pt.y, angle: pion ? Math.round((Math.atan2(pt.y - pion.y, pt.x - pion.x) * 180) / Math.PI) : -90, ouverture: p.vision?.ouverture ?? 90, portee: p.vision?.portee ?? 30, joueur: p.joueur, couleur });
        p.onSelection(id);
        return;
      }
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

  const calloutSous = useRef<string | undefined>(undefined);
  function auPointeurBouge() {
    if (p.onCallout && carte?.zones?.length) {
      const pt = position(false);
      const z = pt ? carte.zones.find(x => dansPolygone(pt.x, pt.y, x.points)) : undefined;
      if (z?.nom !== calloutSous.current) {
        calloutSous.current = z?.nom;
        p.onCallout(z?.nom);
      }
    }
    if (!brouillon || pincement.current) return;
    const pt = position(brouillon.type === 'forme');
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
      onAction({ type: 'ajouter', etape, objet: avecNiveau({ id: idUnique(ids), type: 'forme', forme: p.formeDessin, x, y, l, h, couleur: p.couleur, remplie: false }) });
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
    const trajet = outil === 'fleche' && p.trajetJoueur && p.joueur !== null;
    onAction({
      type: 'ajouter',
      etape,
      objet: avecNiveau({
        id: idUnique(ids),
        type: outil === 'ligne' ? 'ligne' : 'fleche',
        points: propres,
        couleur: trajet ? couleurJoueur(doc, p.joueur) : p.couleur,
        epaisseur: p.epaisseur,
        tirets: p.tirets,
        ...(trajet ? { joueur: p.joueur, t0: 0, t1: e?.duree ?? 5 } : {}),
      }),
    });
  }

  function finDeplacement(o: ObjetStrat, node: Konva.Node) {
    const origine = 'points' in o ? { x: 0, y: 0 } : o.type === 'forme' && o.forme === 'ellipse' ? { x: o.x + o.l / 2, y: o.y + o.h / 2 } : { x: o.x, y: o.y };
    const a = p.aimant ?? 0;
    const dx = 'points' in o ? node.x() : aimanter(node.x(), a) - origine.x;
    const dy = 'points' in o ? node.y() : aimanter(node.y(), a) - origine.y;
    // Le nœud revient à sa place : c'est le document (et donc l'historique) qui le déplace.
    node.position(origine);
    onAction({ type: 'deplacer', etape, id: o.id, dx: Math.round(dx * 10) / 10, dy: Math.round(dy * 10) / 10 });
  }

  function molette(ev: Konva.KonvaEventObject<WheelEvent>) {
    ev.evt.preventDefault();
    const pt = scene.current?.getPointerPosition();
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
    const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    const avant = pincement.current;
    pincement.current = { distance, centre: c };
    setBrouillon(undefined);
    if (!avant || avant.distance === 0) return;
    const v = zoomer(vue, distance / avant.distance, c);
    onVue({ ...v, x: v.x + c.x - avant.centre.x, y: v.y + c.y - avant.centre.y });
  }

  // ---------------------------------------------------------------- Poignées de la sélection

  const choisi = editable && outil === 'selection' ? e?.objets.find(o => o.id === p.selection) : undefined;
  const capaciteChoisie = choisi?.type === 'capacite' ? choisi : undefined;
  const donneesChoisie = capaciteChoisie ? p.agent?.capacites.find(c => c.cle === capaciteChoisie.capacite)?.donnees : undefined;
  let mesPoignees: Poignee[] = [];
  if (choisi && !verrou(choisi)) {
    if (choisi.type === 'capacite' && choisi.zone) mesPoignees = poignees(choisi.x, choisi.y, apercu?.id === choisi.id && apercu.zone ? apercu.zone : choisi.zone, echelle);
    if (choisi.type === 'vision') {
      const v = apercu?.id === choisi.id && apercu.vision ? apercu.vision : choisi;
      const r = v.portee * echelleEffective(echelle);
      mesPoignees = [{ cle: 'fin', x: choisi.x + r * Math.cos((v.angle * Math.PI) / 180), y: choisi.y + r * Math.sin((v.angle * Math.PI) / 180) }];
    }
    if (choisi.type === 'agent') {
      const a = choisi.angle ?? -90;
      mesPoignees = [{ cle: 'fin', x: choisi.x + 45 * Math.cos((a * Math.PI) / 180), y: choisi.y + 45 * Math.sin((a * Math.PI) / 180) }];
    }
  }
  const zoneTiree = (poignee: Poignee['cle'], node: Konva.Node): Zone | undefined => {
    if (!capaciteChoisie?.zone) return undefined;
    return tirerPoignee(capaciteChoisie.x, capaciteChoisie.y, capaciteChoisie.zone, poignee, node.x(), node.y(), echelle, { fixe: dimensionFixe(donneesChoisie) && poignee !== 'bord', courbable: Boolean(donneesChoisie?.courbable) || !donneesChoisie });
  };
  function poigneeBouge(poignee: Poignee['cle'], node: Konva.Node) {
    if (!choisi) return;
    if (choisi.type === 'capacite') setApercu({ id: choisi.id, zone: zoneTiree(poignee, node) });
    if (choisi.type === 'vision') {
      const k = echelleEffective(echelle);
      setApercu({ id: choisi.id, vision: { angle: Math.round((Math.atan2(node.y() - choisi.y, node.x() - choisi.x) * 180) / Math.PI), portee: Math.max(1, Math.min(200, Math.round((Math.hypot(node.x() - choisi.x, node.y() - choisi.y) / k) * 10) / 10)) } });
    }
  }
  function poigneeFin(poignee: Poignee['cle'], node: Konva.Node) {
    if (!choisi) return;
    if (choisi.type === 'capacite') {
      const zone = zoneTiree(poignee, node);
      if (zone) onAction({ type: 'modifier', etape, id: choisi.id, champs: { zone } });
    } else if (choisi.type === 'vision' && apercu?.vision) onAction({ type: 'modifier', etape, id: choisi.id, champs: apercu.vision });
    else if (choisi.type === 'agent') onAction({ type: 'modifier', etape, id: choisi.id, champs: { angle: Math.round((Math.atan2(node.y() - choisi.y, node.x() - choisi.x) * 180) / Math.PI) } });
    setApercu(undefined);
  }

  // ---------------------------------------------------------------- Rendu

  const visible = doc.calques;
  const objetsDe = (c: 'utilitaires' | 'vision' | 'marqueurs' | 'dessins' | 'texte') => (e?.objets ?? []).filter(o => calqueDe(o) === c && (!lecture || lecture.visibles.has(o.id)));
  const deplacable = (o: ObjetStrat) => editable && outil === 'selection' && !verrou(o);
  const estompe = (o: ObjetStrat) => niveau !== null && typeof o.niveau === 'number' && o.niveau !== niveau;
  // Pendant la lecture, le premier pion de chaque joueur suit son trajet.
  const pionsSuivis = new Map<string, { x: number; y: number }>();
  if (lecture) {
    for (const [j, pos] of lecture.positions) {
      const pion = e?.objets.find(o => o.type === 'agent' && o.joueur === j);
      if (pion) pionsSuivis.set(pion.id, pos);
    }
  }
  const rendreObjet = (o: ObjetStrat) => (
    <Objet
      key={o.id}
      o={o}
      images={images}
      surbrillance={p.selection === o.id}
      deplacable={deplacable(o)}
      echelle={echelle}
      rotation={rotation}
      estompe={estompe(o)}
      lecture={lecture}
      position={pionsSuivis.get(o.id)}
      zoneApercu={apercu?.id === o.id ? apercu.zone : undefined}
      onFin={finDeplacement}
    />
  );
  const visionApercu = (o: ObjetStrat) => (apercu?.id === o.id && apercu.vision && o.type === 'vision' ? { ...o, ...apercu.vision } : o);

  return (
    <div
      style={{ touchAction: 'none', width: taille, height: taille, borderRadius: 10, overflow: 'hidden', cursor: outil === 'main' ? 'grab' : outil === 'selection' ? 'default' : 'crosshair' }}
      data-testid={p.testID ?? 'esport-canevas'}>
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
          <Tourne ref={repere} rotation={rotation}>
            {!fondImg ? <KText text={doc.carte.nom} fontSize={72} fill="#374151" width={1000} y={460} align="center" /> : null}
            {fondImg ? <KImage image={fondImg} x={cadre.x} y={cadre.y} width={cadre.l} height={cadre.h} /> : null}
            {p.aimant && editable ? (
              <Group opacity={0.12}>
                {Array.from({ length: Math.floor(1000 / Math.max(10, p.aimant * 5)) }, (_, i) => (i + 1) * Math.max(10, p.aimant ?? 10) * 5).map(v => (
                  <React.Fragment key={v}>
                    <Line points={[v, 0, v, 1000]} stroke="#ffffff" strokeWidth={1} />
                    <Line points={[0, v, 1000, v]} stroke="#ffffff" strokeWidth={1} />
                  </React.Fragment>
                ))}
              </Group>
            ) : null}
          </Tourne>
        </Layer>
        <Layer listening={false} visible={visible.callouts.visible}>
          <Tourne rotation={rotation}>
            {(carte?.zones ?? []).map(z => {
              const c = centre(z.points);
              return (
                <Group key={z.cle}>
                  <Line points={z.points} closed fill={z.couleur ?? '#ffffff'} opacity={0.08} stroke={z.couleur ?? '#ffffff'} strokeWidth={1.5} />
                  <Etiquette x={c.x} y={c.y} texte={z.nom} taille={18} couleur={z.couleur ?? '#e5e7eb'} rotation={-rotation} />
                </Group>
              );
            })}
            {(carte?.reperes ?? []).map(r => (
              <Group key={r.cle} x={r.x} y={r.y} opacity={niveau !== null && typeof r.niveau === 'number' && r.niveau !== niveau ? 0.35 : 1}>
                <Rect x={-10} y={-10} width={20} height={20} rotation={45} fill={r.type === 'site' || r.type === 'plant' ? '#f59e0b' : r.type === 'cashout' || r.type === 'coffre' ? '#22c55e' : '#94a3b8'} stroke="#0b0f17" strokeWidth={2} />
                <Etiquette x={0} y={26} texte={r.nom} taille={16} rotation={-rotation} />
              </Group>
            ))}
          </Tourne>
        </Layer>
        {(['vision', 'utilitaires', 'marqueurs', 'dessins', 'texte'] as const).map(c => (
          <Layer key={c} visible={visible[c].visible} listening={!visible[c].verrou && editable}>
            <Tourne rotation={rotation}>
              {objetsDe(c).map(o => rendreObjet(c === 'vision' ? visionApercu(o) : o))}
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
            </Tourne>
          </Layer>
        ))}
        {mesPoignees.length ? (
          <Layer>
            <Tourne rotation={rotation}>
              {mesPoignees.map(h => (
                <Circle
                  key={h.cle}
                  name="poignee"
                  x={h.x}
                  y={h.y}
                  radius={10}
                  fill={h.cle === 'courbe' ? '#f59e0b' : '#ffffff'}
                  stroke="#0b0f17"
                  strokeWidth={2.5}
                  draggable
                  onDragMove={ev => poigneeBouge(h.cle, ev.target)}
                  onDragEnd={ev => {
                    ev.cancelBubble = true;
                    poigneeFin(h.cle, ev.target);
                  }}
                />
              ))}
            </Tourne>
          </Layer>
        ) : null}
      </Stage>
    </div>
  );
}
