/**
 * Dessins du plateau de strats (Konva, via react-konva) : le langage visuel décidé par
 * src/esport/strats/plateau.ts (jetons partagés avec la page de partage du serveur).
 *
 *  - pions : PORTRAIT de l'agent dans un anneau à la couleur du joueur, ombre portée, secteur de regard, nom
 *    en pastille ; sélection = anneau clair autour (jamais un changement de couleur) ; ennemi = anneau rouge ;
 *  - capacités : une forme par genre (fumée en « sphère », zone de dégâts hachurée, mur en bande à dégradé,
 *    flash en secteur qui s'estompe, recon en trajet jalonné et anneau de révélation, fil à embouts…), puce
 *    sombre de l'icône au point de pose avec le numéro d'ordre, ultime cerclé et marqué « X » ;
 *  - tracés : déplacement effilé, rotation en tirets, regard en pointillé fin, pointe lisible ;
 *  - lecture : déploiement, anneau de durée qui se vide, fondu de fin, projectile le long d'un trajet.
 *
 * Tailles À L'ÉCRAN bornées : les groupes nommés `jeton-pion`, `jeton-puce` et `jeton-texte` reçoivent leur
 * échelle du canevas (impérativement, sans re-rendu) ; l'export PNG les remet à l'échelle 1.
 * Performance : `Objet` est mémoïsé, aucune ombre floue (ombres peintes), `perfectDrawEnabled` coupé.
 */

import type Konva from 'konva';
import React from 'react';
import { Arc, Circle, Ellipse, Group, Image as KImage, Label, Line, Rect, RegularPolygon, Star, Tag, Text as KText, Wedge } from 'react-konva';
import { initiales, sourcesIcone, type CacheImages } from '../../../strats/assets';
import { useImageJeu } from '../imagesCanevas.web';
import type { SourcesImage } from '../imagesJeu';
import type { ObjetStrat, ObjetTrace, Zone } from '../../../strats/document';
import { decalerTrace, jalons, lisserTrace, primitiveZone, rubanEffile, sensFinal, tracePartiel, type VieCapacite } from '../../../strats/geometrie';
import { COULEURS_EQUIPES, echelleEffective, type GenreMarqueur } from '../../../strats/modeles';
import { PLATEAU, alpha, assombrir, contourBlob, eclaircir, melanger, tiretsUsage, usageTrace, type GenreCapacite } from '../../../strats/plateau';

const T = PLATEAU;
const SANS_BUFFER = { perfectDrawEnabled: false, shadowForStrokeEnabled: false } as const;
const rad = (a: number) => (a * Math.PI) / 180;
const adouci = (f: number) => (f <= 0 ? 0 : f >= 1 ? 1 : f * f * (3 - 2 * f));

/**
 * Image du jeu (portrait, icône, fond de map) : première source qui charge parmi celles données dans l'ordre
 * (image importée, puis CDN officiel : `sourcesIcone`, imagesCanevas.web.ts) ; undefined tant que rien n'a chargé.
 */
export const useImage = useImageJeu;

// ------------------------------------------------------------------ Texte

/** Texte à halo sombre (lisible sur toute map et à tout zoom), centré sur (x, y) par défaut. */
export function Halo({
  x = 0,
  y = 0,
  texte,
  taille = T.typo.s,
  couleur = T.encre,
  rotation = 0,
  largeur = 240,
  capitales = false,
  opacite = 1,
  gauche = false,
}: {
  x?: number;
  y?: number;
  texte: string;
  taille?: number;
  couleur?: string;
  rotation?: number;
  largeur?: number;
  capitales?: boolean;
  opacite?: number;
  /** Ancré à gauche (x = bord gauche) au lieu de centré. */
  gauche?: boolean;
}) {
  return (
    <KText
      x={x}
      y={y}
      text={capitales ? texte.toUpperCase() : texte}
      fontFamily={T.police}
      fontSize={taille}
      fontStyle="bold"
      letterSpacing={capitales ? T.etiquette.espacement : 0}
      fill={couleur}
      stroke={T.halo}
      strokeWidth={Math.max(2.2, taille / 4.2)}
      lineJoin="round"
      fillAfterStrokeEnabled
      width={gauche ? undefined : largeur}
      offsetX={gauche ? 0 : largeur / 2}
      offsetY={taille / 2}
      align={gauche ? 'left' : 'center'}
      rotation={rotation}
      opacity={opacite}
      listening={false}
      perfectDrawEnabled={false}
    />
  );
}

/** Pastille de texte (nom d'un joueur sous son pion) : fond sombre arrondi, centrée sous (0, y). */
export function Pastille({ y, texte, taille = T.typo.xs, couleur = T.encre }: { y: number; texte: string; taille?: number; couleur?: string }) {
  return (
    <Label x={0} y={y} listening={false}>
      <Tag fill={alpha(T.puce, 0.86)} stroke={alpha('#ffffff', 0.14)} strokeWidth={1} cornerRadius={taille * 0.55} pointerDirection="up" pointerWidth={0} pointerHeight={0} {...SANS_BUFFER} />
      <KText text={texte} fontFamily={T.police} fontSize={taille} fontStyle="bold" fill={couleur} padding={taille * 0.32} perfectDrawEnabled={false} />
    </Label>
  );
}

// ------------------------------------------------------------------ Jetons (pions, puces)

/**
 * Portrait (ou icône) découpé en rond. `icone` : sources essayées dans l'ordre (image importée, puis CDN officiel) ;
 * les initiales restent dessous (visibles tant que rien n'a chargé, ou si l'image doit être masquée à l'export :
 * le groupe de l'image porte le nom `image-jeu`).
 */
function Portrait({ rayon, nom, icone, images, fond = '#111827' }: { rayon: number; nom: string; icone: SourcesImage; images: CacheImages; fond?: string }) {
  const img = useImage(icone, images);
  return (
    <>
      <Circle radius={rayon} fill={fond} listening={false} />
      <KText text={initiales(nom)} fontFamily={T.police} fontSize={rayon * 0.86} fontStyle="bold" fill="#ffffff" width={rayon * 2} x={-rayon} y={-rayon * 0.43} align="center" listening={false} perfectDrawEnabled={false} />
      {img ? (
        <Group name="image-jeu" clipFunc={ctx => ctx.arc(0, 0, rayon, 0, Math.PI * 2, false)} listening={false}>
          <Circle radius={rayon} fill={fond} />
          <KImage image={img} x={-rayon} y={-rayon} width={rayon * 2} height={rayon * 2} />
        </Group>
      ) : null}
    </>
  );
}

/** Petit cadenas (objet verrouillé). */
function Cadenas({ x, y }: { x: number; y: number }) {
  return (
    <Group x={x} y={y} listening={false}>
      <Circle radius={7.5} fill={T.puce} stroke="#ffffff" strokeWidth={1} {...SANS_BUFFER} />
      <Arc innerRadius={2.1} outerRadius={3.3} angle={180} rotation={180} y={-0.8} fill="#ffffff" />
      <Rect x={-3.6} y={-0.9} width={7.2} height={5.2} cornerRadius={1.2} fill="#ffffff" />
    </Group>
  );
}

function Pion({ o, couleur, icone, images, etiquette, selectionne, rotation, inconnu }: { o: Extract<ObjetStrat, { type: 'agent' }>; couleur: string; icone: SourcesImage; images: CacheImages; etiquette?: string; selectionne: boolean; rotation: number; inconnu: boolean }) {
  const r = T.pion.rayon;
  const a = T.pion.anneau;
  return (
    <Group name="jeton-pion">
      {typeof o.angle === 'number' ? (
        <Wedge
          radius={T.pion.regard}
          angle={T.pion.ouvertureRegard}
          rotation={o.angle - T.pion.ouvertureRegard / 2}
          fillRadialGradientStartRadius={r}
          fillRadialGradientEndRadius={T.pion.regard}
          fillRadialGradientColorStops={[0, alpha(couleur, 0.85), 1, alpha(couleur, 0)]}
          listening={false}
          perfectDrawEnabled={false}
        />
      ) : null}
      <Group rotation={-rotation}>
        <Circle name="selection" visible={selectionne} radius={r + a + 5.5} stroke={T.selection} strokeWidth={2.5} listening={false} perfectDrawEnabled={false} />
        {/* Ombre portée peinte (une ombre floue coûterait cher à chaque image d'un glisser). */}
        <Circle y={3} radius={r + a + 1} fill="#000000" opacity={0.38} listening={false} />
        <Circle radius={r + a} fill={couleur} stroke={T.halo} strokeWidth={1.5} {...SANS_BUFFER} />
        <Circle radius={r + 0.6} fill={T.halo} listening={false} />
        {inconnu ? (
          <>
            <Circle radius={r} fill="#1f2937" listening={false} />
            <KText text="?" fontFamily={T.police} fontSize={r * 1.25} fontStyle="bold" fill="#ffffff" width={r * 2} x={-r} y={-r * 0.62} align="center" listening={false} perfectDrawEnabled={false} />
          </>
        ) : (
          <Portrait rayon={r} nom={o.nom} icone={icone} images={images} />
        )}
        {etiquette ? <Pastille y={r + a + 4} texte={etiquette} /> : null}
        {typeof o.niveau === 'number' ? <Halo x={r + 4} y={-r - 2} texte={`${o.niveau}`} taille={T.typo.s} couleur={T.cote} largeur={40} /> : null}
        {o.verrou ? <Cadenas x={-r - 2} y={-r - 2} /> : null}
      </Group>
    </Group>
  );
}

// ------------------------------------------------------------------ Zones des capacités

interface PropsForme {
  id: string;
  zone: Zone;
  x: number;
  y: number;
  genre: GenreCapacite;
  couleur: string;
  ultime: boolean;
  chaud: boolean;
  creux: boolean;
  segments: number;
  echelle: number | null | undefined;
  /** Déploiement (0 à 1) : la zone grandit, le cône s'ouvre, le mur s'allonge. */
  d: number;
  /** Temps de lecture (s) : scintillement, pulsation ; undefined : édition (immobile). */
  temps?: number;
}

const hachures = (r: number, pas: number, decalage: number): number[][] => {
  const lignes: number[][] = [];
  for (let v = -2 * r + (decalage % pas); v <= 2 * r; v += pas) lignes.push([v - r, r, v + r, -r]);
  return lignes;
};

/** Forme d'une zone de capacité, relative au point de pose (0, 0). */
export function FormeCapacite({ id, zone, x, y, genre, couleur: c, ultime, chaud, creux, segments, echelle, d, temps }: PropsForme) {
  const p = primitiveZone(0, 0, zone, echelle);
  const bord = ultime ? T.capacite.ultimeBord : T.trait.normal - 0.5;
  const g = adouci(d);
  switch (p.type) {
    case 'cercle': {
      const r = p.r * (0.25 + 0.75 * g);
      if (genre === 'blob') return <Line points={contourBlob(p.r, id).map(v => v * (0.25 + 0.75 * g))} closed tension={0.5} fill={alpha(c, 0.5)} stroke={alpha(eclaircir(c, 0.25), 0.95)} strokeWidth={bord} {...SANS_BUFFER} />;
      if (genre === 'piege') {
        const coeur = Math.min(p.r, Math.max(5, p.r * 0.18));
        return (
          <>
            <Circle radius={r} fill={alpha(c, 0.08)} stroke={alpha(c, 0.85)} strokeWidth={bord} dash={[7, 5]} {...SANS_BUFFER} />
            <Circle radius={coeur} fill={alpha(c, 0.55)} stroke={alpha(eclaircir(c, 0.3), 0.95)} strokeWidth={1.5} listening={false} {...SANS_BUFFER} />
          </>
        );
      }
      if (genre === 'aire') {
        return (
          <>
            <Circle radius={r} fillRadialGradientStartRadius={0} fillRadialGradientEndRadius={r} fillRadialGradientColorStops={[0, alpha(c, 0.04), 0.75, alpha(c, 0.1), 1, alpha(c, 0.24)]} stroke={alpha(c, 0.9)} strokeWidth={bord} {...SANS_BUFFER} />
            <Circle radius={Math.max(1, r - 5)} stroke={alpha(c, 0.35)} strokeWidth={1} dash={[3, 5]} listening={false} perfectDrawEnabled={false} />
          </>
        );
      }
      if (genre === 'zone') {
        const cc = chaud ? melanger(c, '#ff8a2a', 0.55) : eclaircir(c, 0.15);
        const pas = Math.max(6, Math.min(11, p.r / 3.2));
        return (
          <>
            <Circle radius={r} fillRadialGradientStartRadius={0} fillRadialGradientEndRadius={r} fillRadialGradientColorStops={[0, alpha(cc, 0.62), 0.6, alpha(melanger(cc, c, 0.5), 0.4), 1, alpha(c, 0.3)]} stroke={alpha(eclaircir(c, 0.2), 0.98)} strokeWidth={bord + 0.3} {...SANS_BUFFER} />
            <Group clipFunc={ctx => ctx.arc(0, 0, Math.max(0.5, r - 1), 0, Math.PI * 2, false)} listening={false} opacity={0.5}>
              {hachures(p.r, pas, temps !== undefined ? temps * 9 : 0).map((pts, i) => (
                <Line key={i} points={pts} stroke={eclaircir(cc, 0.35)} strokeWidth={1.2} perfectDrawEnabled={false} />
              ))}
            </Group>
          </>
        );
      }
      // Fumée : disque « sphère » (reflet décentré, cœur un peu plus sombre, bord doux).
      if (creux) {
        return (
          <>
            <Circle radius={r} fillRadialGradientStartRadius={r * 0.55} fillRadialGradientEndRadius={r} fillRadialGradientColorStops={[0, alpha(c, 0), 0.7, alpha(c, 0.2), 1, alpha(c, 0.55)]} stroke={alpha(eclaircir(c, 0.25), 0.95)} strokeWidth={bord} dash={[9, 6]} {...SANS_BUFFER} />
            <Circle radius={r * 0.55} stroke={alpha(c, 0.5)} strokeWidth={1} dash={[3, 4]} listening={false} perfectDrawEnabled={false} />
          </>
        );
      }
      return (
        <>
          <Circle
            radius={r}
            fillRadialGradientStartPoint={{ x: -r * 0.28, y: -r * 0.32 }}
            fillRadialGradientEndPoint={{ x: 0, y: 0 }}
            fillRadialGradientStartRadius={r * 0.05}
            fillRadialGradientEndRadius={r}
            fillRadialGradientColorStops={[0, alpha(eclaircir(c, 0.45), 0.7), 0.45, alpha(c, 0.56), 0.82, alpha(assombrir(c, 0.3), 0.6), 1, alpha(c, 0.22)]}
            {...SANS_BUFFER}
          />
          <Circle radius={Math.max(0.5, r - 1)} stroke={alpha(eclaircir(c, 0.3), 0.75)} strokeWidth={ultime ? 3 : 1.5} listening={false} perfectDrawEnabled={false} />
        </>
      );
    }
    case 'secteur': {
      const ouverture = Math.max(4, p.ouverture * (genre === 'eclair' ? 0.3 + 0.7 * g : 1));
      const r = p.r * (genre === 'eclair' ? 1 : 0.3 + 0.7 * g);
      if (p.ouverture >= 359) return <Circle radius={r} fill={alpha(c, 0.16)} stroke={alpha(c, 0.85)} strokeWidth={bord} dash={[7, 5]} {...SANS_BUFFER} />;
      if (genre === 'eclair') {
        return (
          <>
            <Wedge radius={r} angle={ouverture} rotation={p.angle - ouverture / 2} fillRadialGradientStartRadius={0} fillRadialGradientEndRadius={r} fillRadialGradientColorStops={[0, alpha(eclaircir(c, 0.6), 0.85), 0.35, alpha(eclaircir(c, 0.2), 0.5), 1, alpha(c, 0.03)]} stroke={alpha(c, 0.55)} strokeWidth={ultime ? 2.5 : 1} {...SANS_BUFFER} />
            <Star numPoints={8} innerRadius={8} outerRadius={21} rotation={p.angle} fill={alpha('#ffffff', 0.9)} stroke={alpha(c, 0.9)} strokeWidth={1.2} listening={false} {...SANS_BUFFER} />
          </>
        );
      }
      return <Wedge radius={r} angle={ouverture} rotation={p.angle - ouverture / 2} fillRadialGradientStartRadius={0} fillRadialGradientEndRadius={r} fillRadialGradientColorStops={[0, alpha(c, 0.3), 1, alpha(c, 0.08)]} stroke={alpha(c, 0.85)} strokeWidth={bord} dash={[8, 6]} {...SANS_BUFFER} />;
    }
    case 'trait': {
      const pts = g >= 1 ? p.points : tracePartiel(p.points, Math.max(0.02, g));
      const n = pts.length;
      const tension = p.courbe ? 0.5 : 0;
      if (genre === 'fil') {
        // Fil (trip) : trait fin, embouts, zone de détection autour.
        const a = Math.atan2(pts[n - 1] - pts[1], pts[n - 2] - pts[0]);
        const embout = (ex: number, ey: number, k: string) => <Line key={k} points={[ex - Math.sin(a) * 7, ey + Math.cos(a) * 7, ex + Math.sin(a) * 7, ey - Math.cos(a) * 7]} stroke={eclaircir(c, 0.3)} strokeWidth={3.5} lineCap="round" listening={false} />;
        return (
          <>
            <Line points={pts} stroke={c} strokeWidth={13} opacity={0.16} lineCap="round" hitStrokeWidth={22} />
            <Line points={pts} stroke={c} strokeWidth={2.5} dash={[2, 5]} lineCap="round" listening={false} />
            {embout(pts[0], pts[1], 'a')}
            {embout(pts[n - 2], pts[n - 1], 'b')}
          </>
        );
      }
      const ep = Math.max(4.5, p.epaisseur);
      const cc = chaud ? melanger(c, '#ff8a2a', 0.45) : c;
      const degrade = { strokeLinearGradientStartPoint: { x: pts[0], y: pts[1] }, strokeLinearGradientEndPoint: { x: pts[n - 2], y: pts[n - 1] }, strokeLinearGradientColorStops: [0, eclaircir(cc, 0.38), 0.5, cc, 1, eclaircir(cc, 0.22)] };
      const bande = (q: number[], largeur: number, k: string) => (
        <React.Fragment key={k}>
          {/* Lueur peinte : un trait large et pâle sous la bande. */}
          <Line points={q} stroke={cc} strokeWidth={largeur * 2.7 + 5} opacity={0.15} lineCap="round" lineJoin="round" tension={tension} listening={false} />
          <Line points={q} stroke={T.halo} strokeWidth={largeur + (ultime ? 3 : 2)} opacity={0.55} lineCap={segments > 1 ? 'butt' : 'round'} lineJoin="round" tension={tension} listening={false} />
          <Line
            points={q}
            {...degrade}
            strokeWidth={largeur}
            opacity={T.capacite.bord}
            lineCap={segments > 1 ? 'butt' : 'round'}
            lineJoin="round"
            tension={tension}
            dash={segments > 1 ? segmentsEnTirets(q, segments) : undefined}
            hitStrokeWidth={Math.max(22, largeur)}
          />
        </React.Fragment>
      );
      if (p.double !== undefined) {
        const ecart = p.double;
        return (
          <>
            <Line points={pts} stroke={cc} strokeWidth={ecart} opacity={0.12} lineCap="butt" tension={tension} hitStrokeWidth={Math.max(22, ecart)} />
            {bande(decalerTrace(pts, ecart / 2), Math.max(3, p.epaisseur), 'g')}
            {bande(decalerTrace(pts, -ecart / 2), Math.max(3, p.epaisseur), 'd')}
          </>
        );
      }
      return bande(pts, ep, 'u');
    }
    case 'rect': {
      const l = p.longueur * (0.15 + 0.85 * g);
      const cc = chaud ? melanger(c, '#ff8a2a', 0.45) : c;
      return (
        <Rect
          width={l}
          height={p.largeur}
          offsetY={p.largeur / 2}
          rotation={p.angle}
          fillLinearGradientStartPoint={{ x: 0, y: 0 }}
          fillLinearGradientEndPoint={{ x: l, y: 0 }}
          fillLinearGradientColorStops={[0, alpha(eclaircir(cc, 0.25), 0.5), 1, alpha(cc, 0.14)]}
          stroke={alpha(eclaircir(c, 0.15), 0.92)}
          strokeWidth={bord}
          cornerRadius={Math.min(6, p.largeur / 4)}
          {...SANS_BUFFER}
        />
      );
    }
    case 'trajet': {
      // Trajet (recon, drone, dard) : du lancer (points 0, 1) au point de pose ; jalons de sens ; anneau de révélation.
      const pts = p.points;
      const sens = jalons(pts, 46, 18);
      const pulse = temps !== undefined ? (temps % T.animation.pulsation) / T.animation.pulsation : undefined;
      const fx = pts[0] + (pts[2] - pts[0]) * g;
      const fy = pts[1] + (pts[3] - pts[1]) * g;
      return (
        <>
          <Line points={pts} stroke={T.halo} strokeWidth={5} opacity={0.4} lineCap="round" listening={false} />
          <Line points={pts} stroke={c} strokeWidth={2.6} dash={[10, 7]} lineCap="round" opacity={0.95} hitStrokeWidth={22} />
          {sens.map((j, i) => (
            <Line key={i} x={j.x} y={j.y} rotation={j.angle} points={[-5, -5, 2, 0, -5, 5]} stroke={eclaircir(c, 0.3)} strokeWidth={2.4} lineCap="round" lineJoin="round" listening={false} />
          ))}
          <Circle x={pts[0]} y={pts[1]} radius={4} fill={c} stroke={T.halo} strokeWidth={1.2} listening={false} {...SANS_BUFFER} />
          {p.r > 0 && g >= 1 ? (
            <>
              <Circle x={pts[2]} y={pts[3]} radius={p.r} fill={alpha(c, 0.1)} stroke={alpha(c, 0.9)} strokeWidth={bord} dash={[6, 6]} {...SANS_BUFFER} />
              {pulse !== undefined ? <Circle x={pts[2]} y={pts[3]} radius={Math.max(1, p.r * pulse)} stroke={alpha(eclaircir(c, 0.3), 0.9 * (1 - pulse))} strokeWidth={2} listening={false} perfectDrawEnabled={false} /> : null}
            </>
          ) : null}
          {g < 1 ? <Circle x={fx} y={fy} radius={5} fill="#ffffff" stroke={c} strokeWidth={2} listening={false} {...SANS_BUFFER} /> : null}
        </>
      );
    }
  }
}

/** Tirets d'un mur « en blocs » : `n` segments égaux séparés d'un petit joint. */
function segmentsEnTirets(points: number[], n: number): number[] {
  let l = 0;
  for (let i = 2; i + 1 < points.length; i += 2) l += Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]);
  const joint = Math.min(3, l / n / 6);
  return [l / n - joint, joint];
}

/** Puce de la capacité au point de pose : icône sur fond sombre, anneau de la couleur, ordre, « X » d'un ultime, durée restante. */
function Puce({ o, couleur, icone, images, selectionne, rotation, ultime, vie }: { o: Extract<ObjetStrat, { type: 'capacite' }>; couleur: string; icone: SourcesImage; images: CacheImages; selectionne: boolean; rotation: number; ultime: boolean; vie?: VieCapacite }) {
  const r = T.capacite.puceRayon;
  return (
    <Group name="jeton-puce" rotation={-rotation}>
      <Circle name="selection" visible={selectionne} radius={r + 6.5} stroke={T.selection} strokeWidth={2.2} listening={false} perfectDrawEnabled={false} />
      <Circle y={2} radius={r + 2.5} fill="#000000" opacity={0.35} listening={false} />
      <Circle radius={r + 2} fill={T.puce} stroke={couleur} strokeWidth={ultime ? 3 : 2.2} {...SANS_BUFFER} />
      <Portrait rayon={r - 1.5} nom={o.nom} icone={icone} images={images} fond={T.puce} />
      {vie && vie.reste !== null ? <Arc innerRadius={r + 4.5} outerRadius={r + 7.5} angle={Math.max(0.5, 360 * vie.reste)} rotation={-90} fill="#ffffff" opacity={0.92} listening={false} /> : null}
      {typeof o.ordre === 'number' ? (
        <>
          <Circle x={r + 1} y={-r - 1} radius={7.5} fill={couleur} stroke={T.halo} strokeWidth={1.5} listening={false} {...SANS_BUFFER} />
          <KText x={r - 9} y={-r - 6.5} width={20} text={String(o.ordre)} fontFamily={T.police} fontSize={11} fontStyle="bold" fill={T.halo} align="center" listening={false} perfectDrawEnabled={false} />
        </>
      ) : null}
      {ultime ? (
        <>
          <Circle x={r + 1} y={r + 1} radius={6.5} fill={T.halo} stroke={couleur} strokeWidth={1.4} listening={false} {...SANS_BUFFER} />
          <KText x={r - 9} y={r - 3.8} width={20} text="X" fontFamily={T.police} fontSize={9.5} fontStyle="bold" fill="#ffffff" align="center" listening={false} perfectDrawEnabled={false} />
        </>
      ) : null}
      {typeof o.niveau === 'number' ? <Halo x={-r - 4} y={-r - 2} texte={`${o.niveau}`} taille={T.typo.xs} couleur={T.cote} largeur={40} /> : null}
      {o.verrou ? <Cadenas x={-r - 2} y={r + 2} /> : null}
    </Group>
  );
}

// ------------------------------------------------------------------ Marqueurs

const LETTRES: Partial<Record<GenreMarqueur, string>> = T.lettresMarqueur;

/** Glyphe d'un marqueur selon son genre, avec sa lettre ; mur ou sol à casser : carré fissuré. */
function Marqueur({ genre, couleur }: { genre: GenreMarqueur; couleur: string }) {
  const contour = { stroke: T.halo, strokeWidth: 2.2, ...SANS_BUFFER };
  const r = T.marqueur.rayon;
  const lettre = LETTRES[genre];
  const texte = lettre ? <KText text={lettre} fontFamily={T.police} fontSize={r * 1.05} fontStyle="bold" fill="#ffffff" stroke={T.halo} strokeWidth={2.2} fillAfterStrokeEnabled width={r * 2} x={-r} y={-r * 0.52} align="center" listening={false} perfectDrawEnabled={false} /> : null;
  switch (genre) {
    case 'ennemi':
      return (
        <>
          <Circle radius={r} fill={couleur} {...contour} />
          <Line points={[-6, -6, 6, 6]} stroke="#ffffff" strokeWidth={3} lineCap="round" listening={false} />
          <Line points={[6, -6, -6, 6]} stroke="#ffffff" strokeWidth={3} lineCap="round" listening={false} />
        </>
      );
    case 'danger':
    case 'tiers':
      return (
        <>
          <RegularPolygon sides={3} radius={r + 3} y={2} fill={couleur} lineJoin="round" {...contour} />
          <Group y={2}>{texte}</Group>
        </>
      );
    case 'destruction-mur':
    case 'destruction-sol':
      return (
        <>
          <Rect x={-r} y={-r} width={r * 2} height={r * 2} cornerRadius={3} fill={T.puce} stroke={couleur} strokeWidth={2.6} dash={genre === 'destruction-sol' ? [5, 4] : undefined} {...SANS_BUFFER} />
          {/* Fissure : un éclair et ses branches. */}
          <Line points={[-9, -10, -2, -3, -6, 1, 3, 4, -1, 10]} stroke={couleur} strokeWidth={2.4} lineCap="round" lineJoin="round" listening={false} />
          <Line points={[-2, -3, 7, -8]} stroke={couleur} strokeWidth={2} lineCap="round" listening={false} />
          <Line points={[3, 4, 10, 6]} stroke={couleur} strokeWidth={2} lineCap="round" listening={false} />
        </>
      );
    case 'cashout':
    case 'coffre':
      return (
        <>
          <Rect x={-r} y={-r} width={r * 2} height={r * 2} cornerRadius={6} fill={couleur} {...contour} />
          {texte}
        </>
      );
    case 'objectif':
      return <Star numPoints={5} innerRadius={r * 0.5} outerRadius={r + 2} fill={couleur} lineJoin="round" {...contour} />;
    case 'plant':
    case 'defuse':
      return (
        <>
          <Rect width={r * 1.6} height={r * 1.6} offsetX={r * 0.8} offsetY={r * 0.8} rotation={45} cornerRadius={3} fill={couleur} {...contour} />
          {texte}
        </>
      );
    case 'spawn':
      return (
        <>
          <RegularPolygon sides={6} radius={r + 1} fill={couleur} lineJoin="round" {...contour} />
          {texte}
        </>
      );
    default:
      return (
        <>
          <Circle radius={r - 1} fill={couleur} {...contour} />
          {texte}
        </>
      );
  }
}

// ------------------------------------------------------------------ Tracés (flèches, lignes)

function Trace({ o, couleur, selectionne, progression, duree, rotation }: { o: ObjetTrace; couleur: string; selectionne: boolean; progression?: number; duree: number; rotation: number }) {
  const usage = usageTrace(o);
  const bruts = progression === undefined ? o.points : tracePartiel(o.points, progression);
  const pts = bruts.length > 4 ? lisserTrace(bruts, 2) : bruts;
  const n = pts.length;
  const ep = o.epaisseur;
  const fleche = o.type === 'fleche';
  const sens = sensFinal(pts);
  // Pointe lisible même sur un trait fin ; le corps s'arrête à sa base.
  const tete = Math.max(13, ep * 3.1) * (usage === 'regard' ? 0.8 : 1);
  const corps = fleche && n >= 4 ? raccourcir(pts, tete * 0.7) : pts;
  const tirets = tiretsUsage(usage, ep);
  const epaisseur = usage === 'regard' ? Math.max(2, ep * 0.6) : ep;
  const milieu = pts.length >= 4 ? { x: pts[Math.floor(n / 4) * 2], y: pts[Math.floor(n / 4) * 2 + 1] } : { x: 0, y: 0 };
  const minute = typeof o.joueur === 'number' && typeof o.t0 === 'number' && typeof o.t1 === 'number' && (o.t0 > 0 || o.t1 < duree);
  return (
    <>
      {selectionne ? <Line name="selection" points={pts} stroke={T.selection} strokeWidth={epaisseur + 7} opacity={0.5} lineCap="round" lineJoin="round" listening={false} /> : null}
      {usage === 'deplacement' && !o.tirets ? (
        <>
          <Line points={rubanEffile(corps, epaisseur * 0.45 + 2.4, epaisseur + 2.4)} closed fill={T.halo} opacity={0.5} listening={false} />
          <Line points={rubanEffile(corps, epaisseur * 0.45, epaisseur)} closed fill={couleur} listening={false} />
        </>
      ) : (
        <>
          <Line points={corps} stroke={T.halo} strokeWidth={epaisseur + 2.4} opacity={0.5} lineCap="round" lineJoin="round" dash={tirets ?? (o.tirets ? [14, 10] : undefined)} listening={false} />
          <Line points={corps} stroke={couleur} strokeWidth={epaisseur} lineCap="round" lineJoin="round" dash={tirets ?? (o.tirets ? [14, 10] : undefined)} listening={false} />
        </>
      )}
      {fleche && n >= 4 ? (
        usage === 'regard' ? (
          <Line x={pts[n - 2]} y={pts[n - 1]} rotation={sens} points={[-tete, -tete * 0.55, 0, 0, -tete, tete * 0.55]} stroke={couleur} strokeWidth={epaisseur + 0.6} lineCap="round" lineJoin="round" listening={false} />
        ) : (
          <Line x={pts[n - 2]} y={pts[n - 1]} rotation={sens} points={[0, 0, -tete, -tete * 0.52, -tete * 0.78, 0, -tete, tete * 0.52]} closed fill={couleur} stroke={T.halo} strokeWidth={1.2} lineJoin="round" listening={false} {...SANS_BUFFER} />
        )
      ) : null}
      {/* Zone de prise : large et invisible, le long du tracé. */}
      <Line points={pts} stroke="#000000" strokeWidth={1} opacity={0} hitStrokeWidth={24} lineCap="round" />
      {minute ? <Halo x={milieu.x} y={milieu.y - 14} texte={`${o.t0}–${o.t1} s`} taille={T.typo.xs} couleur={T.cote} rotation={-rotation} largeur={120} /> : null}
      {o.verrou ? <Cadenas x={pts[0]} y={pts[1] - 12} /> : null}
    </>
  );
}

/** Tracé raccourci de `d` unités à son extrémité (le corps d'une flèche s'arrête à la base de sa pointe). */
function raccourcir(points: number[], d: number): number[] {
  let total = 0;
  for (let i = 2; i + 1 < points.length; i += 2) total += Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]);
  if (total <= d * 1.5) return points;
  return tracePartiel(points, (total - d) / total);
}

// ------------------------------------------------------------------ Objet (mémoïsé)

export interface PropsObjet {
  o: ObjetStrat;
  images: CacheImages;
  /** Couleur affichée (joueur, ou accent de l'agent selon le réglage de la strat). */
  couleur: string;
  /** Icône à jour (portrait importé, icône de la capacité) ; repli : celle du document. */
  icone?: ReadonlyArray<string>;
  /** Nom court du joueur, sous son pion. */
  etiquette?: string;
  selectionne: boolean;
  deplacable: boolean;
  echelle: number | null | undefined;
  rotation: number;
  /** Opacité d'ensemble (autre étage, autre joueur que celui mis en avant, fantôme de l'étape précédente). */
  opacite: number;
  genre: GenreCapacite;
  ultime: boolean;
  chaud: boolean;
  segments: number;
  duree: number;
  /** Lecture animée. */
  progression?: number;
  position?: { x: number; y: number };
  vie?: VieCapacite;
  temps?: number;
  /** Fantôme (étape précédente) : ni identifiant ni écoute. */
  fantome?: boolean;
  onDebut?(o: ObjetStrat, ev: Konva.KonvaEventObject<DragEvent>): void;
  onBouge?(o: ObjetStrat, ev: Konva.KonvaEventObject<DragEvent>): void;
  onFin?(o: ObjetStrat, ev: Konva.KonvaEventObject<DragEvent>): void;
  onSurvol?(id: string | undefined): void;
}

function ObjetBrut({ o, images, couleur, icone, etiquette, selectionne, deplacable, echelle, rotation, opacite, genre, ultime, chaud, segments, duree, progression, position, vie, temps, fantome, onDebut, onBouge, onFin, onSurvol }: PropsObjet) {
  const commun = fantome
    ? { listening: false, opacity: opacite }
    : {
        id: o.id,
        name: 'objet',
        draggable: deplacable,
        opacity: opacite * (vie?.opacite ?? 1),
        onDragStart: (e: Konva.KonvaEventObject<DragEvent>) => {
          e.cancelBubble = true;
          onDebut?.(o, e);
        },
        onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => onBouge?.(o, e),
        onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
          e.cancelBubble = true;
          onFin?.(o, e);
        },
        onMouseEnter: () => onSurvol?.(o.id),
        onMouseLeave: () => onSurvol?.(undefined),
      };
  switch (o.type) {
    case 'agent': {
      const p = position ?? { x: o.x, y: o.y };
      return (
        <Group {...commun} x={p.x} y={p.y}>
          <Pion o={o} couleur={couleur} icone={icone ?? sourcesIcone(o)} images={images} etiquette={etiquette} selectionne={selectionne} rotation={rotation} inconnu={o.agent === 'inconnu'} />
        </Group>
      );
    }
    case 'capacite':
      return (
        <Group {...commun} x={o.x} y={o.y}>
          {o.zone ? <FormeCapacite id={o.id} zone={o.zone} x={o.x} y={o.y} genre={genre} couleur={couleur} ultime={ultime} chaud={chaud} creux={Boolean(o.creux)} segments={segments} echelle={echelle} d={vie?.deploiement ?? 1} temps={temps} /> : null}
          <Puce o={o} couleur={couleur} icone={icone ?? sourcesIcone(o)} images={images} selectionne={selectionne} rotation={rotation} ultime={ultime} vie={vie} />
        </Group>
      );
    case 'vision': {
      const r = o.portee * echelleEffective(echelle);
      return (
        <Group {...commun} x={o.x} y={o.y}>
          <Wedge radius={r} angle={o.ouverture} rotation={o.angle - o.ouverture / 2} fillRadialGradientStartRadius={0} fillRadialGradientEndRadius={r} fillRadialGradientColorStops={[0, alpha(couleur, 0.34), 1, alpha(couleur, 0.05)]} stroke={alpha(couleur, 0.9)} strokeWidth={selectionne ? 2.6 : 1.4} dash={[8, 6]} {...SANS_BUFFER} />
          <Circle radius={5} fill={couleur} stroke={T.halo} strokeWidth={1.2} {...SANS_BUFFER} />
          {o.verrou ? <Cadenas x={-12} y={-12} /> : null}
        </Group>
      );
    }
    case 'marqueur': {
      const c = o.genre === 'ennemi' && typeof o.equipe === 'number' && o.equipe > 0 ? COULEURS_EQUIPES[(o.equipe - 1) % COULEURS_EQUIPES.length] : o.couleur;
      return (
        <Group {...commun} x={o.x} y={o.y}>
          <Group name="jeton-puce" rotation={-rotation}>
            <Circle name="selection" visible={selectionne} radius={T.marqueur.rayon + 8} stroke={T.selection} strokeWidth={2.2} listening={false} perfectDrawEnabled={false} />
            <Circle y={2.5} radius={T.marqueur.rayon + 1} fill="#000000" opacity={0.3} listening={false} />
            <Marqueur genre={o.genre} couleur={c} />
            {o.genre === 'ennemi' && o.equipe ? <Halo y={-T.marqueur.rayon - 9} texte={`E${o.equipe}`} taille={T.typo.xs} largeur={60} /> : null}
            {o.etiquette ? <Halo y={T.marqueur.rayon + 13} texte={o.etiquette} taille={T.typo.s} /> : null}
            {typeof o.niveau === 'number' ? <Halo x={T.marqueur.rayon + 5} y={-T.marqueur.rayon} texte={`${o.niveau}`} taille={T.typo.xs} couleur={T.cote} largeur={40} /> : null}
            {o.verrou ? <Cadenas x={-T.marqueur.rayon - 2} y={-T.marqueur.rayon - 2} /> : null}
          </Group>
        </Group>
      );
    }
    case 'fleche':
    case 'ligne':
      return (
        <Group {...commun} x={0} y={0}>
          <Trace o={o} couleur={couleur} selectionne={selectionne} progression={progression} duree={duree} rotation={rotation} />
        </Group>
      );
    case 'forme': {
      const style = { stroke: o.couleur, strokeWidth: 3, fill: o.remplie ? alpha(o.couleur, 0.4) : undefined, shadowForStrokeEnabled: false, perfectDrawEnabled: false, hitStrokeWidth: 18 };
      const contour = selectionne ? { stroke: T.selection, strokeWidth: 7, opacity: 0.45, listening: false } : undefined;
      return o.forme === 'rect' ? (
        <Group {...commun} x={o.x} y={o.y}>
          {contour ? <Rect name="selection" width={o.l} height={o.h} cornerRadius={3} {...contour} /> : null}
          <Rect width={o.l} height={o.h} cornerRadius={3} {...style} />
          {o.verrou ? <Cadenas x={0} y={0} /> : null}
        </Group>
      ) : (
        <Group {...commun} x={o.x + o.l / 2} y={o.y + o.h / 2}>
          {contour ? <Ellipse name="selection" radiusX={o.l / 2} radiusY={o.h / 2} {...contour} /> : null}
          <Ellipse radiusX={o.l / 2} radiusY={o.h / 2} {...style} />
          {o.verrou ? <Cadenas x={0} y={-o.h / 2} /> : null}
        </Group>
      );
    }
    case 'texte':
      return (
        <Group {...commun} x={o.x} y={o.y}>
          <KText
            text={o.texte}
            fontFamily={T.police}
            fontSize={o.taille}
            fontStyle="bold"
            fill={o.couleur}
            stroke={T.halo}
            strokeWidth={Math.max(2.4, o.taille / 5)}
            lineJoin="round"
            fillAfterStrokeEnabled
            rotation={-rotation}
            perfectDrawEnabled={false}
            textDecoration={selectionne ? 'underline' : undefined}
          />
          {o.verrou ? <Cadenas x={-10} y={-4} /> : null}
        </Group>
      );
  }
}

export const Objet = React.memo(ObjetBrut);

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

/** Taille réelle d'une zone, en clair (étiquette de survol) : « ⌀ 8.2 m », « 60 m », « 15 m · 120° ». */
export function tailleReelle(z: Zone): string {
  switch (z.forme) {
    case 'cercle':
      return `⌀ ${Math.round(z.rayon * 20) / 10} m`;
    case 'cone':
      return `${z.portee} m · ${z.ouverture}°`;
    case 'mur':
    case 'ligne':
      return `${z.longueur} m`;
    case 'rect':
      return `${z.longueur} × ${z.largeur} m`;
    case 'trajet':
      return z.rayon ? `⌀ ${Math.round(z.rayon * 20) / 10} m` : '';
  }
}

export { rad };
