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
 *
 * Gestes (src/esport/strats/pose.ts) : poser une capacité, un cône de vision
 * ou un pion en CLIQUANT-GLISSANT (appui = origine, glisser = direction et
 * longueur, bornée à la longueur réelle de la capacité ; un mur courbable suit
 * le chemin parcouru) ; la sélection montre de GRANDES poignées (26 px à
 * l'écran quel que soit le zoom, zone de prise de 48 px) : extrémités d'un mur,
 * milieu d'un mur courbable, points d'un mur tracé, direction et portée d'un
 * cône, regard d'un pion. Maj aimante l'angle à 15°. Souris, doigt et stylet.
 * Pions : portrait de l'agent (rond, anneau à la couleur du joueur, nom du
 * joueur dessous) : image importée, sinon CDN officiel, sinon initiales ; fantôme du portrait sous le pointeur
 * pendant la pose ; capacités : icône de la capacité au point de pose.
 */

import Konva from 'konva';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Arrow, Circle, Ellipse, Group, Image as KImage, Layer, Line, Rect, RegularPolygon, Stage, Text as KText, Wedge } from 'react-konva';
import { initiales, sourcesIcone, type AgentAsset, type CacheImages, type CapaciteAsset, type CarteAsset } from '../../strats/assets';
import { useImageJeu as useImage } from './imagesCanevas.web';
import { calqueDe, couleurJoueur, idUnique, zoneParDefaut, zoomer, type Action, type ChampsObjet, type DocumentStrat, type FormeZone, type ObjetStrat, type Vue, type Zone } from '../../strats/document';
import { aimanter, cadreImage, centre, dansPolygone, decalerTrace, etatLecture, longueurMax, primitiveZone, tracePartiel, zoneDepuisCapacite, type EtatLecture, type Primitive } from '../../strats/geometrie';
import { avecChamps, debuterVisee, estGlisse, poigneesObjet, poseCapacite, posePion, poseVision, suivreVisee, tirerPoigneeDe, type PoigneeObjet, type Visee } from '../../strats/pose';
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
  /** Agents du jeu (portraits et icônes à jour, caractéristiques des capacités posées). */
  agents?: AgentAsset[];
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

/**
 * Jeton rond : portrait (ou icône) DÉCOUPÉ en cercle sur un fond sombre, anneau à la couleur du joueur ;
 * initiales sur la couleur du joueur tant que l'image n'est pas chargée (repli). `icone` : sources essayées dans
 * l'ordre (image importée, puis CDN officiel). L'image porte le nom `image-jeu` (export PNG : masquée si elle
 * empêchait l'export, les initiales restent).
 */
function Jeton({ rayon, couleur, nom, icone, images, surbrillance, anneau = 3 }: { rayon: number; couleur: string; nom: string; icone: string | ReadonlyArray<string> | null; images: CacheImages; surbrillance: boolean; anneau?: number }) {
  const img = useImage(icone, images);
  return (
    <>
      {surbrillance ? <Circle radius={rayon + anneau + 6} stroke="#fde047" strokeWidth={3} dash={[6, 4]} listening={false} /> : null}
      <Circle radius={rayon + anneau} fill={couleur} stroke={surbrillance ? '#ffffff' : '#0b0f17'} strokeWidth={surbrillance ? 2.5 : 1.5} shadowColor="#000000" shadowBlur={surbrillance ? 14 : 5} shadowOpacity={0.6} />
      <KText text={initiales(nom)} fontSize={rayon * 0.9} fontStyle="bold" fill="#ffffff" width={rayon * 2} x={-rayon} y={-rayon * 0.45} align="center" listening={false} />
      {img ? (
        <Group name="image-jeu" clipFunc={ctx => ctx.arc(0, 0, rayon, 0, Math.PI * 2, false)} listening={false}>
          <Circle radius={rayon} fill="#111827" />
          <KImage image={img} x={-rayon} y={-rayon} width={rayon * 2} height={rayon * 2} />
        </Group>
      ) : null}
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
      if (p.double !== undefined) {
        const gap = p.double;
        const pts = p.points.map((n, i) => n - (i % 2 === 0 ? ox : oy));
        const ligne = (q: number[]) => <Line points={q} stroke={couleur} strokeWidth={p.epaisseur} lineCap="round" lineJoin="round" tension={p.courbe ? 0.5 : 0} opacity={0.9} hitStrokeWidth={Math.max(20, gap)} />;
        return (
          <>
            <Line points={pts} stroke={couleur} strokeWidth={gap} opacity={0.12} lineCap="round" tension={p.courbe ? 0.5 : 0} />
            {ligne(decalerTrace(pts, gap / 2))}
            {ligne(decalerTrace(pts, -gap / 2))}
          </>
        );
      }
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
  /** Sources de l'icône (portrait importé, puis CDN du profil, puis celle du document). */
  icone?: ReadonlyArray<string>;
  /** Nom court du joueur, sous son pion. */
  etiquette?: string;
  onFin(o: ObjetStrat, node: Konva.Node): void;
}

function Objet({ o, images, surbrillance, deplacable, echelle, rotation, estompe, lecture, position, icone, etiquette, onFin }: PropsObjet) {
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
          {typeof o.angle === 'number' ? <Wedge radius={44} angle={46} rotation={o.angle - 23} fill={o.couleur} opacity={0.5} listening={false} /> : null}
          <Group rotation={-rotation}>
            <Jeton rayon={20} couleur={o.couleur} nom={o.nom} icone={icone ?? sourcesIcone(o)} images={images} surbrillance={surbrillance} />
            {etiquette ? <Etiquette x={0} y={34} texte={etiquette} taille={12} largeur={110} /> : null}
            {niveau ? <Etiquette x={20} y={-20} texte={niveau} taille={14} /> : null}
          </Group>
        </Group>
      );
    }
    case 'capacite': {
      const z = o.zone;
      return (
        <Group {...commun} x={o.x} y={o.y}>
          {z ? <FormeZone p={primitiveZone(o.x, o.y, z, echelle)} couleur={o.couleur} ox={o.x} oy={o.y} /> : null}
          <Group rotation={-rotation}>
            <Jeton rayon={12} anneau={2.5} couleur={o.couleur} nom={o.nom} icone={icone ?? sourcesIcone(o)} images={images} surbrillance={surbrillance} />
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

/** Cote lisible d'une zone (mètres, degrés) : « r 4.1 m », « 18 m · 30° »… */
export function cote(z: Zone): string {
  const a = (n: number) => `${Math.round(((n % 360) + 360) % 360)}°`;
  switch (z.forme) {
    case 'cercle':
      return `r ${z.rayon} m`;
    case 'cone':
      return `${z.portee} m · ${z.ouverture}° · ${a(z.angle)}`;
    case 'mur':
      return `${z.longueur} m · ${a(z.angle)}${z.courbure ? ` · ${Math.round(z.courbure * 100)} %` : ''}`;
    case 'ligne':
    case 'rect':
      return `${z.longueur} m · ${a(z.angle)}`;
    case 'trajet':
      return z.rayon ? `r ${z.rayon} m` : '';
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

/** Taille des poignées À L'ÉCRAN (px) : rayon dessiné, et demi-largeur de la zone de prise (doigt, stylet). */
export const RAYON_POIGNEE_PX = 13;
export const PRISE_POIGNEE_PX = 24;
/** En deçà (px à l'écran), un appui n'est pas un glisser : pose simple. */
const SEUIL_GLISSER_PX = 8;
/** Outils de pose : un appui sur un objet existant le SÉLECTIONNE (et le déplace) au lieu de poser. */
const OUTILS_POSE: ReadonlyArray<Outil> = ['agent', 'capacite', 'marqueur', 'vision', 'texte'];

export default function CanevasStrat(p: PropsCanevas) {
  const { doc, etape, taille, outil, vue, onVue, onAction, images, carte } = p;
  const rotation = p.rotation ?? 0;
  const scene = useRef<Konva.Stage>(null);
  const repere = useRef<Konva.Group>(null);
  const [brouillon, setBrouillon] = useState<Brouillon | undefined>();
  const [fantome, setFantome] = useState<{ x: number; y: number } | undefined>();
  const [apercu, setApercu] = useState<{ id: string; champs: ChampsObjet } | undefined>();
  const [visee, setVisee] = useState<Visee | undefined>();
  const [maj, setMaj] = useState(false);
  const pincement = useRef<{ distance: number; centre: { x: number; y: number } } | undefined>(undefined);
  const fondImg = useImage(carte?.minimap ?? p.fond, images);
  const e = doc.etapes[etape];
  const base = taille / 1000;
  const echelle = carte?.echelle ?? doc.carte.echelle;
  const lecture = useMemo(() => (p.temps !== undefined && e ? etatLecture(e, p.temps) : undefined), [p.temps, e]);
  const cadre = cadreImage(fondImg && carte?.largeurImage ? carte.largeurImage : fondImg?.naturalWidth, fondImg && carte?.hauteurImage ? carte.hauteurImage : fondImg?.naturalHeight);
  const editable = p.temps === undefined;
  /** Unités du document par pixel d'écran (poignées et seuils de taille constante quel que soit le zoom). */
  const parPixel = 1 / Math.max(0.01, base * vue.echelle);
  const agentDe = (cle: string) => p.agents?.find(a => a.cle === cle) ?? (p.agent?.cle === cle ? p.agent : undefined);
  const capaciteDe = (agent: string, cle: string) => agentDe(agent)?.capacites.find(c => c.cle === cle);
  /** Icône d'un document : seule une adresse du CDN Riot y est acceptée (un lien signé expire). */
  const iconeDocument = (url: string | null | undefined) => (url && /^https:\/\/media\.valorant-api\.com\//.test(url) ? url : null);
  const iconeDoc = (a: { icone: string | null; iconeDoc?: string | null } | undefined) => iconeDocument(a?.iconeDoc) ?? iconeDocument(a?.icone);

  // Export : la vue est remise à plat (1000 × 1000) le temps du rendu, puis rétablie.
  const exporter = useCallback((options: { pixelRatio: number; mimeType?: string; quality?: number }) => {
    const st = scene.current;
    if (!st) throw new Error(tr('strats.canevasStrat.canevas_pas_pret'));
    const avant = { echelle: st.scaleX(), x: st.x(), y: st.y() };
    st.scale({ x: 1, y: 1 });
    st.position({ x: 0, y: 0 });
    try {
      try {
        return st.toDataURL({ x: 0, y: 0, width: 1000, height: 1000, ...options });
      } catch (e) {
        // Image d'une autre origine qui « contamine » le canevas : export avec les initiales à sa place, jamais d'échec.
        const masquees = st.find('.image-jeu').filter(n => n.visible());
        if (!masquees.length) throw e;
        masquees.forEach(n => n.visible(false));
        try {
          return st.toDataURL({ x: 0, y: 0, width: 1000, height: 1000, ...options });
        } finally {
          masquees.forEach(n => n.visible(true));
        }
      }
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

  /** Zone d'une capacité posée en `pt` : à sa taille réelle, orientée depuis le pion du joueur (un trajet part du pion). */
  function zoneDeBase(): Zone | null {
    return p.formeZone === 'auto' ? zoneDepuisCapacite(p.capacite?.donnees) : zoneParDefaut(p.formeZone);
  }
  function zonePourPose(pt: { x: number; y: number }): Zone | null {
    let zone = zoneDeBase();
    const pion = pionJoueur(p.joueur);
    if (zone && pion && Math.hypot(pt.x - pion.x, pt.y - pion.y) > 4) {
      const angle = Math.round(((Math.atan2(pt.y - pion.y, pt.x - pion.x) * 180) / Math.PI) * 10) / 10;
      if (zone.forme === 'trajet') zone = { ...zone, dx: Math.round((pion.x - pt.x) * 10) / 10, dy: Math.round((pion.y - pt.y) * 10) / 10 };
      else if (zone.forme === 'cone' || zone.forme === 'ligne' || zone.forme === 'rect') zone = { ...zone, angle };
      else if (zone.forme === 'mur') zone = { ...zone, angle: angle + 90 };
    }
    // Bornée à la longueur réelle de la capacité.
    const max = longueurMax(p.capacite?.donnees);
    if (zone && max !== undefined) {
      if (zone.forme === 'cone' && zone.portee > max) zone = { ...zone, portee: max };
      if ((zone.forme === 'mur' || zone.forme === 'ligne' || zone.forme === 'rect') && zone.longueur > max) zone = { ...zone, longueur: max };
    }
    return zone;
  }

  function auPointeurBas(ev: Konva.KonvaEventObject<PointerEvent>) {
    if (!editable || pincement.current || (ev.evt && ev.evt.isPrimary === false)) return;
    if (ev.target.hasName('poignee')) return;
    const pt = position();
    if (!pt || !e) return;
    const touche = objetSous(ev.target);
    setMaj(Boolean(ev.evt?.shiftKey));
    // Outil de pose sur un objet existant : on le sélectionne (ses poignées apparaissent, on peut le déplacer).
    if (touche && OUTILS_POSE.includes(outil)) {
      p.onSelection(touche);
      return;
    }
    const ajouter = (objet: ObjetStrat) => onAction({ type: 'ajouter', etape, objet: avecNiveau(objet) });
    const ids = () => doc.etapes.flatMap(x => x.objets.map(o => o.id));
    switch (outil) {
      case 'selection':
        p.onSelection(touche);
        return;
      case 'gomme':
        if (touche) onAction({ type: 'supprimer', etape, id: touche });
        return;
      case 'agent':
      case 'capacite':
      case 'vision':
        // Cliquer-glisser : l'appui fixe l'origine, le relâché la direction (voir auPointeurHaut).
        if (outil === 'capacite' && (!p.agent || !p.capacite)) return;
        if (outil === 'agent' && !p.agent) return;
        setVisee(debuterVisee(pt));
        setFantome(undefined);
        return;
      case 'marqueur':
        if (p.marqueur) ajouter({ id: idUnique(ids()), type: 'marqueur', x: pt.x, y: pt.y, genre: p.marqueur.genre, etiquette: p.marqueur.etiquette.trim().slice(0, 40), couleur: p.couleur, equipe: p.marqueur.equipe });
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

  /** Fin d'un cliquer-glisser de pose (ou simple appui : pose orientée depuis le pion du joueur, comme avant). */
  function finVisee(v: Visee, aimant: boolean) {
    setVisee(undefined);
    if (!e) return;
    const ids = doc.etapes.flatMap(x => x.objets.map(o => o.id));
    const couleur = p.joueur !== null ? couleurJoueur(doc, p.joueur) : p.couleur;
    const glisse = estGlisse(v, SEUIL_GLISSER_PX * parPixel);
    const id = idUnique(ids);
    if (outil === 'agent' && p.agent) {
      const pose = glisse ? posePion(v, aimant) : { x: v.origine.x, y: v.origine.y };
      onAction({ type: 'ajouter', etape, objet: avecNiveau({ id, type: 'agent', ...pose, agent: p.agent.cle, nom: p.agent.nom, icone: iconeDoc(p.agent), joueur: p.joueur, couleur }) });
      p.onSelection(id);
    } else if (outil === 'capacite' && p.agent && p.capacite) {
      const pose = glisse ? poseCapacite(v, zoneDeBase(), echelle, p.capacite.donnees, aimant) : { x: v.origine.x, y: v.origine.y, zone: zonePourPose(v.origine) };
      onAction({ type: 'ajouter', etape, objet: avecNiveau({ id, type: 'capacite', x: pose.x, y: pose.y, agent: p.agent.cle, capacite: p.capacite.cle, nom: p.capacite.nom, icone: iconeDoc(p.capacite), joueur: p.joueur, couleur, zone: pose.zone, ordre: p.ordreSuivant ?? null }) });
      p.onSelection(id);
    } else if (outil === 'vision') {
      const pion = pionJoueur(p.joueur);
      const pose = glisse
        ? poseVision(v, echelle, aimant)
        : { x: v.origine.x, y: v.origine.y, angle: pion ? Math.round((Math.atan2(v.origine.y - pion.y, v.origine.x - pion.x) * 180) / Math.PI) : -90, portee: p.vision?.portee ?? 30 };
      onAction({ type: 'ajouter', etape, objet: avecNiveau({ id, type: 'vision', ...pose, ouverture: p.vision?.ouverture ?? 90, joueur: p.joueur, couleur }) });
      p.onSelection(id);
    }
  }

  const calloutSous = useRef<string | undefined>(undefined);
  function auPointeurBouge(ev?: Konva.KonvaEventObject<PointerEvent>) {
    if (visee && !pincement.current) {
      const pt = position();
      if (pt) setVisee(suivreVisee(visee, pt, 4 * parPixel));
      if (ev?.evt) setMaj(Boolean(ev.evt.shiftKey));
      return;
    }
    // Aperçu sous le pointeur avant la pose : capacité à sa taille réelle, portrait de l'agent armé.
    if (((outil === 'capacite' && p.capacite) || (outil === 'agent' && p.agent)) && editable && !pincement.current) {
      const pt = position();
      if (pt) setFantome(pt);
    }
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

  function auPointeurHaut(ev?: Konva.KonvaEventObject<PointerEvent>) {
    if (visee) {
      const pt = pincement.current ? undefined : position();
      finVisee(pt ? suivreVisee(visee, pt, 4 * parPixel) : visee, ev?.evt ? Boolean(ev.evt.shiftKey) : maj);
      return;
    }
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
  //
  // Visibles avec TOUT outil d'édition (pas seulement la sélection) : on pose un mur avec l'outil Capacité, on
  // l'oriente aussitôt. Taille constante à l'écran (RAYON_POIGNEE_PX), zone de prise large (PRISE_POIGNEE_PX) ;
  // calque au-dessus de tout, seul à écouter le pointeur sur la poignée.

  const choisiBrut = editable && outil !== 'main' ? e?.objets.find(o => o.id === p.selection) : undefined;
  const choisi = choisiBrut && apercu?.id === choisiBrut.id ? avecChamps(choisiBrut, apercu.champs) : choisiBrut;
  const donneesDe = (o: ObjetStrat | undefined) => (o?.type === 'capacite' ? capaciteDe(o.agent, o.capacite)?.donnees : undefined);
  const mesPoignees: PoigneeObjet[] = choisi && !verrou(choisi) ? poigneesObjet(choisi, echelle) : [];
  const maxChoisi = longueurMax(donneesDe(choisiBrut));

  function poigneeBouge(cle: PoigneeObjet['cle'], ev: Konva.KonvaEventObject<DragEvent>) {
    if (!choisiBrut) return;
    const node = ev.target;
    const aimant = Boolean((ev.evt as MouseEvent | undefined)?.shiftKey);
    const champs = tirerPoigneeDe(choisiBrut, cle, { x: node.x(), y: node.y() }, echelle, donneesDe(choisiBrut), aimant);
    if (!champs) return;
    setApercu({ id: choisiBrut.id, champs });
    // La poignée colle à la forme réelle (longueur bornée, angle aimanté) : on la replace sous le doigt.
    const h = poigneesObjet(avecChamps(choisiBrut, champs), echelle).find(x => x.cle === cle);
    if (h) node.position({ x: h.x, y: h.y });
  }
  function poigneeFin(cle: PoigneeObjet['cle'], ev: Konva.KonvaEventObject<DragEvent>) {
    ev.cancelBubble = true;
    if (!choisiBrut) return;
    const champs = apercu?.id === choisiBrut.id ? apercu.champs : tirerPoigneeDe(choisiBrut, cle, { x: ev.target.x(), y: ev.target.y() }, echelle, donneesDe(choisiBrut));
    setApercu(undefined);
    if (champs) onAction({ type: 'modifier', etape, id: choisiBrut.id, champs });
  }

  // ---------------------------------------------------------------- Rendu

  const visible = doc.calques;
  const objetsDe = (c: 'utilitaires' | 'vision' | 'marqueurs' | 'dessins' | 'texte') => (e?.objets ?? []).filter(o => calqueDe(o) === c && (!lecture || lecture.visibles.has(o.id)));
  const deplacable = (o: ObjetStrat) => editable && (outil === 'selection' || OUTILS_POSE.includes(outil)) && !verrou(o);
  const estompe = (o: ObjetStrat) => niveau !== null && typeof o.niveau === 'number' && o.niveau !== niveau;
  // Pendant la lecture, le premier pion de chaque joueur suit son trajet.
  const pionsSuivis = new Map<string, { x: number; y: number }>();
  if (lecture) {
    for (const [j, pos] of lecture.positions) {
      const pion = e?.objets.find(o => o.type === 'agent' && o.joueur === j);
      if (pion) pionsSuivis.set(pion.id, pos);
    }
  }
  const nomJoueur = (j: number | null | undefined) => (typeof j === 'number' && doc.joueurs[j] ? doc.joueurs[j].nom.slice(0, 14) : undefined);
  const iconeAJour = (o: ObjetStrat) => (o.type === 'agent' ? sourcesIcone(agentDe(o.agent), o.icone) : o.type === 'capacite' ? sourcesIcone(capaciteDe(o.agent, o.capacite), o.icone) : undefined);
  const rendreObjet = (brut: ObjetStrat) => {
    const o = apercu?.id === brut.id ? avecChamps(brut, apercu.champs) : brut;
    return (
    <Objet
      key={o.id}
      o={o}
      icone={iconeAJour(o)}
      etiquette={o.type === 'agent' ? nomJoueur(o.joueur) : undefined}
      images={images}
      surbrillance={p.selection === o.id}
      deplacable={deplacable(o)}
      echelle={echelle}
      rotation={rotation}
      estompe={estompe(o)}
      lecture={lecture}
      position={pionsSuivis.get(o.id)}
      onFin={finDeplacement}
    />
    );
  };

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
        onPointerLeave={() => {
          setFantome(undefined);
          auPointeurHaut();
        }}
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
                {r.type === 'callout' ? (
                  <>
                    <Circle radius={3} fill="#e5e7eb" opacity={0.8} />
                    <Etiquette x={0} y={-12} texte={r.nom} taille={13} couleur="#e5e7eb" rotation={-rotation} />
                  </>
                ) : (
                  <>
                    <Rect x={-10} y={-10} width={20} height={20} rotation={45} fill={r.type === 'site' || r.type === 'plant' ? '#f59e0b' : r.type === 'cashout' || r.type === 'coffre' ? '#22c55e' : '#94a3b8'} stroke="#0b0f17" strokeWidth={2} />
                    <Etiquette x={0} y={26} texte={r.nom} taille={16} rotation={-rotation} />
                  </>
                )}
              </Group>
            ))}
          </Tourne>
        </Layer>
        {(['vision', 'utilitaires', 'marqueurs', 'dessins', 'texte'] as const).map(c => (
          <Layer key={c} visible={visible[c].visible} listening={!visible[c].verrou && editable}>
            <Tourne rotation={rotation}>
              {objetsDe(c).map(rendreObjet)}
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
        {(fantome && ((outil === 'capacite' && p.capacite) || (outil === 'agent' && p.agent))) || visee ? (
          <Layer listening={false}>
            <Tourne rotation={rotation}>
              {(() => {
                const c = p.joueur !== null ? couleurJoueur(doc, p.joueur) : p.couleur;
                if (visee) {
                  const glisse = estGlisse(visee, SEUIL_GLISSER_PX * parPixel);
                  const o = visee.origine;
                  const tige = glisse ? <Arrow points={[o.x, o.y, visee.pointeur.x, visee.pointeur.y]} stroke="#ffffff" fill="#ffffff" strokeWidth={2 * parPixel} dash={[8 * parPixel, 6 * parPixel]} pointerLength={10 * parPixel} pointerWidth={10 * parPixel} opacity={0.8} /> : null;
                  if (outil === 'capacite' && p.capacite) {
                    const pose = glisse ? poseCapacite(visee, zoneDeBase(), echelle, p.capacite.donnees, maj) : { x: o.x, y: o.y, zone: zonePourPose(o) };
                    return (
                      <Group opacity={0.7}>
                        {pose.zone ? <FormeZone p={primitiveZone(pose.x, pose.y, pose.zone, echelle)} couleur={c} ox={0} oy={0} /> : null}
                        {tige}
                        <Circle x={pose.x} y={pose.y} radius={6 * parPixel} fill={c} stroke="#ffffff" strokeWidth={1.5 * parPixel} />
                        {pose.zone ? <Etiquette x={visee.pointeur.x} y={visee.pointeur.y - 26 * parPixel} texte={cote(pose.zone)} taille={15 * parPixel} couleur="#fde68a" rotation={-rotation} /> : null}
                      </Group>
                    );
                  }
                  if (outil === 'vision' && glisse) {
                    const v = poseVision(visee, echelle, maj);
                    return (
                      <Group opacity={0.7}>
                        <Wedge x={v.x} y={v.y} radius={v.portee * echelleEffective(echelle)} angle={p.vision?.ouverture ?? 90} rotation={v.angle - (p.vision?.ouverture ?? 90) / 2} fill={c} opacity={0.25} stroke={c} strokeWidth={2} dash={[8, 6]} />
                        <Etiquette x={visee.pointeur.x} y={visee.pointeur.y - 26 * parPixel} texte={`${v.portee} m · ${Math.round(((v.angle % 360) + 360) % 360)}°`} taille={15 * parPixel} couleur="#fde68a" rotation={-rotation} />
                      </Group>
                    );
                  }
                  return (
                    <Group opacity={0.8}>
                      {tige}
                      {outil === 'agent' && p.agent ? (
                        <Group x={o.x} y={o.y} rotation={-rotation}>
                          <Jeton rayon={20} couleur={c} nom={p.agent.nom} icone={sourcesIcone(p.agent)} images={images} surbrillance={false} />
                        </Group>
                      ) : (
                        <Circle x={o.x} y={o.y} radius={20} fill={c} opacity={0.5} stroke="#ffffff" strokeWidth={1.5} />
                      )}
                    </Group>
                  );
                }
                if (!fantome) return null;
                // Fantôme du pion : portrait de l'agent armé sous le pointeur (même image que le pion posé).
                if (outil === 'agent' && p.agent)
                  return (
                    <Group x={fantome.x} y={fantome.y} rotation={-rotation} opacity={0.6} name="fantome-agent">
                      <Jeton rayon={20} couleur={c} nom={p.agent.nom} icone={sourcesIcone(p.agent)} images={images} surbrillance={false} />
                    </Group>
                  );
                const z = zonePourPose(fantome);
                return (
                  <Group opacity={0.55}>
                    {z ? <FormeZone p={primitiveZone(fantome.x, fantome.y, z, echelle)} couleur={c} ox={0} oy={0} /> : null}
                    <Circle x={fantome.x} y={fantome.y} radius={5} fill={c} stroke="#ffffff" strokeWidth={1.5} />
                    {z ? <Etiquette x={fantome.x} y={fantome.y - 30} texte={cote(z)} taille={16} rotation={-rotation} /> : null}
                  </Group>
                );
              })()}
            </Tourne>
          </Layer>
        ) : null}
        {choisi?.type === 'capacite' && choisi.zone ? (
          <Layer listening={false}>
            <Tourne rotation={rotation}>
              <Etiquette
                x={(mesPoignees.find(h => h.cle === 'fin') ?? mesPoignees[mesPoignees.length - 1] ?? choisi).x}
                y={(mesPoignees.find(h => h.cle === 'fin') ?? mesPoignees[mesPoignees.length - 1] ?? choisi).y + 30 * parPixel} texte={`${cote(choisi.zone)}${maxChoisi !== undefined ? ` (max ${maxChoisi} m)` : ''}`} taille={15 * parPixel} couleur="#fde68a" rotation={-rotation} largeur={320 * parPixel} />
            </Tourne>
          </Layer>
        ) : null}
        {choisi && mesPoignees.length ? (
          <Layer testID="esport-canevas-poignees">
            <Tourne rotation={rotation}>
              {(() => {
                // Repères du geste : tige de l'origine à la poignée de direction, cercle de la longueur réelle.
                const fin = mesPoignees.find(h => h.cle === 'fin' || h.cle === 'regard');
                const origine = 'x' in choisi ? { x: choisi.x, y: choisi.y } : { x: 0, y: 0 };
                const k = echelleEffective(echelle);
                const anneauMax = fin && maxChoisi !== undefined && choisi.type === 'capacite' && choisi.zone && choisi.zone.forme !== 'trajet' && choisi.zone.forme !== 'cercle';
                return (
                  <>
                    {anneauMax ? <Circle x={origine.x} y={origine.y} radius={(maxChoisi as number) * k} stroke="#fde68a" strokeWidth={1.5 * parPixel} dash={[6 * parPixel, 6 * parPixel]} opacity={0.6} listening={false} /> : null}
                    {fin ? <Line points={[origine.x, origine.y, fin.x, fin.y]} stroke="#ffffff" strokeWidth={2.5 * parPixel} dash={[7 * parPixel, 5 * parPixel]} opacity={0.9} listening={false} /> : null}
                  </>
                );
              })()}
              {mesPoignees.map(h => (
                <Group key={h.cle}>
                  <Circle
                    name="poignee"
                    testID={`poignee-${h.cle}`}
                    x={h.x}
                    y={h.y}
                    radius={RAYON_POIGNEE_PX * parPixel}
                    fill={h.cle === 'courbe' ? '#f59e0b' : h.cle === 'debut' ? '#38bdf8' : h.cle.startsWith('p') ? '#86efac' : '#ffffff'}
                    stroke="#0b0f17"
                    strokeWidth={2.5 * parPixel}
                    hitStrokeWidth={2 * (PRISE_POIGNEE_PX - RAYON_POIGNEE_PX) * parPixel}
                    shadowColor="#000000"
                    shadowBlur={6 * parPixel}
                    shadowOpacity={0.5}
                    draggable
                    onMouseEnter={() => {
                      const c = scene.current?.container();
                      if (c) c.style.cursor = 'grab';
                    }}
                    onMouseLeave={() => {
                      const c = scene.current?.container();
                      if (c) c.style.cursor = '';
                    }}
                    onDragStart={ev => {
                      ev.cancelBubble = true;
                    }}
                    onDragMove={ev => poigneeBouge(h.cle, ev)}
                    onDragEnd={ev => poigneeFin(h.cle, ev)}
                  />
                </Group>
              ))}
            </Tourne>
          </Layer>
        ) : null}
      </Stage>
    </div>
  );
}
