/**
 * Visuels CM : dessin d'un PLAN DE RENDU (plan.ts) avec Konva, dans le navigateur. Même code pour
 * l'aperçu de l'éditeur et pour l'export PNG / JPEG à la taille EXACTE du format (pixelRatio 1) : le
 * fichier exporté est ce que l'éditeur montre.
 *
 * Chargé à la demande (import dynamique) : Konva et les polices n'arrivent qu'à l'ouverture de l'éditeur
 * ou à la génération d'un visuel.
 *
 * Polices : embarquées (paquets @fontsource, licence SIL OFL), servies par l'app elle-même — jamais un
 * service de polices externe au rendu. Images : uniquement des fichiers CM (lien signé du serveur
 * Esport), des assets du jeu (origines Riot autorisées ou dossier local) ; toujours lues par `fetch` puis
 * données au canevas en URL `blob:` locale : le canevas n'est jamais « contaminé » (export possible) et
 * aucune adresse arbitraire n'est chargée.
 */

import Konva from 'konva';
import '@fontsource/orbitron/400.css';
import '@fontsource/orbitron/500.css';
import '@fontsource/orbitron/700.css';
import '@fontsource/orbitron/800.css';
import '@fontsource/orbitron/900.css';
import '@fontsource/chakra-petch/400.css';
import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700.css';
import '@fontsource/share-tech-mono/400.css';
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/manrope/800.css';
import { ORIGINES_ASSETS, type Assets } from '../../strats/assets';
import { rgba } from './charte';
import { aleatoireDeterministe, extremitesDegrade, pointsForme, policesDuPlan, type ElementPlan, type PlanRendu, type RemplissageResolu } from './plan';
import type { SourceImage } from './types';

export const TAILLE_MAX_IMAGE = 15 * 1024 * 1024;
export const COTE_MAX_IMAGE = 8192;

// ------------------------------------------------------------------ Polices

const REPLI = ', "Manrope", system-ui, sans-serif';
export const famille = (p: string): string => `"${p}"${REPLI}`;

/** Attend que les polices du plan soient prêtes (sinon le canevas dessinerait avec une police de repli). */
export async function chargerPolices(plan: PlanRendu): Promise<void> {
  const fonts = (globalThis as { document?: { fonts?: { load(f: string): Promise<unknown>; ready?: Promise<unknown> } } }).document?.fonts;
  if (!fonts) return;
  await Promise.all(policesDuPlan(plan).map(f => fonts.load(f).catch(() => undefined)));
  await fonts.ready?.catch(() => undefined);
}

// ------------------------------------------------------------------ Images

export type ImagesChargees = Map<string, HTMLImageElement | null>;
export const cleSource = (s: SourceImage): string => JSON.stringify(s);

export interface OptionsChargeur {
  /** Lien signé (serveur Esport) d'un fichier CM. */
  lienFichier(id: string): Promise<string>;
  /** Assets du jeu (cartes, agents) : ceux de Valorant, chargés une fois par session. */
  assets?(): Promise<Assets | undefined>;
  fetch?: (url: string, init?: { mode?: string }) => Promise<{ ok: boolean; blob(): Promise<Blob> }>;
}

/** Adresse d'asset acceptée : origine Riot autorisée, ou fichier local de l'app (chemin relatif). */
export function adresseAssetPermise(url: string): boolean {
  if (/^https:\/\//i.test(url)) return ORIGINES_ASSETS.some(o => url === o || url.startsWith(`${o}/`));
  return /^[a-z0-9][\w./-]*$/i.test(url) && !url.includes('..');
}

export function creerChargeurImages(o: OptionsChargeur) {
  const memoire = new Map<string, Promise<HTMLImageElement | null>>();
  const fetchI = o.fetch ?? ((url: string, init?: { mode?: string }) => fetch(url, init as RequestInit));

  async function depuisAdresse(url: string): Promise<HTMLImageElement | null> {
    const r = await fetchI(url, { mode: 'cors' });
    if (!r.ok) return null;
    const blob = await r.blob();
    if (!blob.type.startsWith('image/') || blob.type === 'image/svg+xml' || blob.size > TAILLE_MAX_IMAGE) return null;
    const img = new window.Image();
    img.src = URL.createObjectURL(blob);
    await img.decode();
    if (img.naturalWidth > COTE_MAX_IMAGE || img.naturalHeight > COTE_MAX_IMAGE) return null;
    return img;
  }

  async function adresseDe(s: SourceImage): Promise<string | null> {
    if ('fichier' in s) return o.lienFichier(s.fichier);
    if ('asset' in s) {
      const [genre, cle] = s.asset.split(':');
      const a = await o.assets?.();
      const url = genre === 'map' ? (a?.cartes.find(c => c.cle === cle)?.vignette ?? null) : (a?.agents.find(x => x.cle === cle)?.icone ?? null);
      return url && adresseAssetPermise(url) ? url : null;
    }
    return null;
  }

  return {
    charger(s: SourceImage): Promise<HTMLImageElement | null> {
      const cle = cleSource(s);
      let p = memoire.get(cle);
      if (!p) {
        p = adresseDe(s)
          .then(url => (url ? depuisAdresse(url) : null))
          .catch(() => null);
        memoire.set(cle, p);
      }
      return p;
    },
  };
}
export type ChargeurImages = ReturnType<typeof creerChargeurImages>;

/** Charge les images d'un plan (absentes ou refusées : null, le calque est alors laissé vide ou en monogramme). */
export async function chargerImages(plan: PlanRendu, chargeur: ChargeurImages, deja: ImagesChargees = new Map()): Promise<ImagesChargees> {
  const sources = plan.elements.flatMap(e => ((e.type === 'image' || e.type === 'logo') && e.source ? [e.source] : []));
  await Promise.all(
    sources.map(async s => {
      const cle = cleSource(s);
      if (!deja.has(cle)) deja.set(cle, await chargeur.charger(s));
    }),
  );
  return deja;
}

// ------------------------------------------------------------------ Dessin

type Attrs = Record<string, unknown>;

/** Attributs Konva de remplissage (uni ou dégradé) dans une boîte l × h. */
function attrsRemplissage(r: RemplissageResolu, l: number, h: number): Attrs {
  if (r.type === 'uni') return { fill: r.couleur };
  const n = r.couleurs.length;
  const arrets = r.couleurs.flatMap((c, i) => [n === 1 ? 0 : i / (n - 1), c]);
  if (r.radial) return { fillPriority: 'radial-gradient', fillRadialGradientStartPoint: { x: l / 2, y: h / 2 }, fillRadialGradientEndPoint: { x: l / 2, y: h / 2 }, fillRadialGradientStartRadius: 0, fillRadialGradientEndRadius: Math.hypot(l, h) / 2, fillRadialGradientColorStops: arrets };
  const { debut, fin } = extremitesDegrade(r.angle, l, h);
  return { fillPriority: 'linear-gradient', fillLinearGradientStartPoint: debut, fillLinearGradientEndPoint: fin, fillLinearGradientColorStops: arrets };
}

const attrsOmbre = (e: ElementPlan): Attrs => (e.ombre ? { shadowColor: e.ombre.couleur, shadowBlur: e.ombre.flou, shadowOffset: { x: e.ombre.dx, y: e.ombre.dy }, shadowOpacity: e.ombre.opacite, shadowEnabled: true } : {});
const attrsContour = (e: ElementPlan): Attrs => (e.contour ? { stroke: e.contour.couleur, strokeWidth: e.contour.epaisseur } : {});

/** Taille de police réduite jusqu'à ce que le texte tienne dans sa boîte (mots entiers, hauteur). */
function ajusterTexte(t: Konva.Text, l: number, h: number, taille: number, espacement: number): void {
  const mots = t.text().split(/\s+/).filter(Boolean);
  let s = taille;
  for (let i = 0; i < 40 && s > 8; i++) {
    t.fontSize(s);
    t.height(undefined as unknown as number);
    const large = mots.some(m => t.measureSize(m).width + espacement * m.length > l);
    if (!large && t.height() <= h) break;
    s = Math.max(8, Math.floor(s * 0.93));
  }
  t.height(h);
}

function texteBase(e: Extract<ElementPlan, { type: 'texte' }>, taille: number): Attrs {
  return {
    text: e.texte,
    width: e.l,
    fontFamily: famille(e.police),
    fontSize: taille,
    fontStyle: `${e.italique ? 'italic ' : ''}${e.graisse}`,
    align: e.align,
    verticalAlign: e.valign,
    lineHeight: e.interligne,
    letterSpacing: e.espacement,
    wrap: 'word',
    listening: false,
  };
}

function dessinerTexte(g: Konva.Group, e: Extract<ElementPlan, { type: 'texte' }>): void {
  const principal = new Konva.Text({ ...texteBase(e, e.taille), ...attrsRemplissage(e.remplissage, e.l, e.h), ...attrsContour(e), fillAfterStrokeEnabled: true, ...attrsOmbre(e) });
  if (e.ajuster) ajusterTexte(principal, e.l, e.h, e.taille, e.espacement);
  else principal.height(e.h);
  const taille = principal.fontSize();
  // Lueur néon : copies floues derrière le texte (deux passes : halo serré puis large).
  if (e.lueur) {
    for (const [flou, op] of [
      [e.lueur.flou, 1],
      [e.lueur.flou * 2.2, 0.55],
    ] as const) {
      g.add(new Konva.Text({ ...texteBase(e, taille), height: e.h, fill: e.lueur.couleur, opacity: op, shadowColor: e.lueur.couleur, shadowBlur: flou, shadowOpacity: 1, shadowEnabled: true }));
    }
  }
  // Glitch : aberration chromatique (cyan à gauche, magenta à droite).
  if (e.glitch) {
    const [c1, c2] = e.glitch.couleurs;
    g.add(new Konva.Text({ ...texteBase(e, taille), height: e.h, x: -e.glitch.decalage, y: -Math.round(e.glitch.decalage / 3), fill: c1, opacity: 0.75, globalCompositeOperation: 'screen' }));
    g.add(new Konva.Text({ ...texteBase(e, taille), height: e.h, x: e.glitch.decalage, y: Math.round(e.glitch.decalage / 3), fill: c2, opacity: 0.75, globalCompositeOperation: 'screen' }));
  }
  g.add(principal);
}

function dessinerForme(g: Konva.Group, e: Extract<ElementPlan, { type: 'forme' }>): void {
  const remplir = e.remplissage ? attrsRemplissage(e.remplissage, e.l, e.h) : {};
  const lueur = e.lueur ? { shadowColor: e.lueur.couleur, shadowBlur: e.lueur.flou, shadowOpacity: 1, shadowEnabled: true, shadowForStrokeEnabled: true } : attrsOmbre(e);
  const commun = { ...remplir, ...attrsContour(e), ...lueur, listening: false };
  if (e.forme === 'rect') g.add(new Konva.Rect({ width: e.l, height: e.h, cornerRadius: Math.min(e.rayon, e.l / 2, e.h / 2), ...commun }));
  else if (e.forme === 'ellipse') g.add(new Konva.Ellipse({ x: e.l / 2, y: e.h / 2, radiusX: e.l / 2, radiusY: e.h / 2, ...commun }));
  else if (e.forme === 'ligne') {
    const couleur = e.remplissage?.type === 'uni' ? e.remplissage.couleur : (e.contour?.couleur ?? '#ffffff');
    g.add(new Konva.Line({ points: [0, e.h / 2, e.l, e.h / 2], stroke: couleur, strokeWidth: Math.max(1, e.contour?.epaisseur ?? e.h), lineCap: 'round', ...lueur, listening: false }));
  } else g.add(new Konva.Line({ points: pointsForme(e.forme, e.l, e.h, e.coupe), closed: true, ...commun }));
}

/** Image dans sa boîte : couvrir (recadrée au centre) ou contenir (entière, centrée). */
function imageDansBoite(img: HTMLImageElement, l: number, h: number, mode: 'couvrir' | 'contenir'): Attrs {
  const ri = img.naturalWidth / Math.max(1, img.naturalHeight);
  const rb = l / h;
  if (mode === 'couvrir') {
    const crop = ri > rb ? { x: (img.naturalWidth - img.naturalHeight * rb) / 2, y: 0, width: img.naturalHeight * rb, height: img.naturalHeight } : { x: 0, y: (img.naturalHeight - img.naturalWidth / rb) / 2, width: img.naturalWidth, height: img.naturalWidth / rb };
    return { image: img, width: l, height: h, crop };
  }
  const largeur = ri > rb ? l : h * ri;
  const hauteur = ri > rb ? l / ri : h;
  return { image: img, x: (l - largeur) / 2, y: (h - hauteur) / 2, width: largeur, height: hauteur };
}

function dessinerImage(g: Konva.Group, e: Extract<ElementPlan, { type: 'image' }>, images: ImagesChargees, edition: boolean): void {
  const img = e.source ? images.get(cleSource(e.source)) : null;
  if (!img) {
    // Image absente (donnée manquante, asset indisponible) : rien au rendu ; un cadre pointillé dans l'éditeur.
    if (edition) g.add(new Konva.Rect({ width: e.l, height: e.h, stroke: '#9a9cc4', strokeWidth: 2, dash: [12, 8], opacity: 0.6, listening: false }));
    return;
  }
  if (e.rayon > 0) {
    const r = Math.min(e.rayon, e.l / 2, e.h / 2);
    g.clipFunc(ctx => {
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.arcTo(e.l, 0, e.l, e.h, r);
      ctx.arcTo(e.l, e.h, 0, e.h, r);
      ctx.arcTo(0, e.h, 0, 0, r);
      ctx.arcTo(0, 0, e.l, 0, r);
      ctx.closePath();
    });
  }
  const noeud = new Konva.Image({ ...imageDansBoite(img, e.l, e.h, e.ajustement), ...attrsOmbre(e), listening: false } as Konva.ImageConfig);
  g.add(noeud);
  if (e.filtre !== 'normal') {
    noeud.cache();
    noeud.filters([Konva.Filters.Grayscale]);
    if (e.filtre === 'duotone') g.add(new Konva.Rect({ width: e.l, height: e.h, fill: e.teinte, opacity: 0.85, globalCompositeOperation: 'color', listening: false }));
  }
}

function dessinerLogo(g: Konva.Group, e: Extract<ElementPlan, { type: 'logo' }>, images: ImagesChargees): void {
  const img = e.source ? images.get(cleSource(e.source)) : null;
  if (img) {
    g.add(new Konva.Image({ ...imageDansBoite(img, e.l, e.h, 'contenir'), ...attrsOmbre(e), listening: false } as Konva.ImageConfig));
    return;
  }
  // Monogramme néon : hexagone et initiales.
  const ep = Math.max(3, Math.round(e.l * 0.025));
  g.add(new Konva.Line({ points: pointsForme('hexagone', e.l, e.h), closed: true, stroke: e.couleur, strokeWidth: ep, fill: rgba(e.couleur, 0.1), shadowColor: e.couleur, shadowBlur: e.lueur?.flou ?? 18, shadowOpacity: 0.9, shadowForStrokeEnabled: true, listening: false }));
  g.add(new Konva.Text({ text: e.monogramme, width: e.l, height: e.h, align: 'center', verticalAlign: 'middle', fontFamily: famille(e.police), fontStyle: '900', fontSize: Math.round(Math.min(e.l, e.h) * 0.34), fill: e.couleur, shadowColor: e.couleur, shadowBlur: 12, shadowOpacity: 0.8, listening: false }));
}

function dessinerListe(g: Konva.Group, e: Extract<ElementPlan, { type: 'liste' }>): void {
  e.lignes.forEach((ligne, i) => {
    const y = i * e.pas;
    if (ligne.enAvant && e.surligne) {
      g.add(new Konva.Rect({ y: y + e.pas * 0.1, width: e.l, height: e.pas * 0.8, fill: rgba(e.surligne, 0.16), listening: false }));
      g.add(new Konva.Rect({ y: y + e.pas * 0.1, width: 6, height: e.pas * 0.8, fill: e.surligne, shadowColor: e.surligne, shadowBlur: 12, shadowOpacity: 1, listening: false }));
    }
    const t = new Konva.Text({ text: ligne.texte, x: 18, y, width: e.l - 36, height: e.pas, fontFamily: famille(e.police), fontStyle: String(e.graisse), fontSize: e.taille, align: e.align, verticalAlign: 'middle', wrap: 'none', ellipsis: true, letterSpacing: e.espacement, ...attrsRemplissage(e.remplissage, e.l, e.pas), ...attrsOmbre(e), listening: false });
    // Une ligne trop longue est réduite (jusqu'à 60 % de la taille), puis tronquée.
    let s = e.taille;
    while (s > e.taille * 0.6 && t.measureSize(ligne.texte).width > e.l - 36) {
      s = Math.floor(s * 0.94);
      t.fontSize(s);
    }
    g.add(t);
  });
}

let grainCache: HTMLCanvasElement | null = null;
/** Motif de grain (256 × 256, graine fixe : identique à chaque rendu). */
function motifGrain(): HTMLCanvasElement {
  if (grainCache) return grainCache;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  if (ctx) {
    const data = ctx.createImageData(256, 256);
    const alea = aleatoireDeterministe(1337);
    for (let i = 0; i < data.data.length; i += 4) {
      const v = Math.floor(alea() * 255);
      data.data[i] = v;
      data.data[i + 1] = v;
      data.data[i + 2] = v;
      data.data[i + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
  }
  grainCache = c;
  return c;
}

function dessinerEffets(parent: Konva.Container, plan: PlanRendu): void {
  const { largeur: W, hauteur: H, effets } = plan;
  const g = new Konva.Group({ listening: false, name: 'effets' });
  if (effets.vignette > 0) {
    g.add(new Konva.Rect({ width: W, height: H, fillPriority: 'radial-gradient', fillRadialGradientStartPoint: { x: W / 2, y: H / 2 }, fillRadialGradientEndPoint: { x: W / 2, y: H / 2 }, fillRadialGradientStartRadius: 0, fillRadialGradientEndRadius: Math.hypot(W, H) / 2, fillRadialGradientColorStops: [0, 'rgba(0,0,0,0)', 0.55, 'rgba(0,0,0,0)', 1, `rgba(0,0,0,${0.85 * effets.vignette})`] }));
  }
  if (effets.scanlines > 0) {
    g.add(
      new Konva.Shape({
        opacity: Math.min(1, effets.scanlines * 0.55),
        sceneFunc: ctx => {
          const c = (ctx as unknown as { _context: CanvasRenderingContext2D })._context;
          c.fillStyle = '#000000';
          for (let y = 0; y < H; y += 4) c.fillRect(0, y, W, 2);
        },
      }),
    );
  }
  if (effets.grain > 0) g.add(new Konva.Rect({ width: W, height: H, fillPatternImage: motifGrain() as unknown as HTMLImageElement, fillPatternRepeat: 'repeat', opacity: Math.min(1, effets.grain * 0.3), globalCompositeOperation: 'overlay' }));
  parent.add(g);
}

/**
 * Dessine le plan dans `parent` : fond, un groupe par calque (identifiant = celui du calque, position,
 * rotation, opacité), effets par-dessus. `edition` : chaque groupe reçoit une zone de clic (sélection,
 * glisser) et les images absentes un cadre pointillé. Rend les groupes par identifiant.
 */
export function dessiner(parent: Konva.Container, plan: PlanRendu, images: ImagesChargees, { edition = false }: { edition?: boolean } = {}): Map<string, Konva.Group> {
  const groupes = new Map<string, Konva.Group>();
  parent.add(new Konva.Rect({ width: plan.largeur, height: plan.hauteur, ...attrsRemplissage(plan.fond, plan.largeur, plan.hauteur), listening: false, name: 'fond' }));
  for (const e of plan.elements) {
    const g = new Konva.Group({ id: e.id, name: 'calque', x: e.x, y: e.y, rotation: e.rotation, opacity: e.opacite, listening: edition });
    if (edition) g.add(new Konva.Rect({ width: e.l, height: e.h, fill: 'rgba(0,0,0,0)', name: 'zone' }));
    switch (e.type) {
      case 'texte':
        dessinerTexte(g, e);
        break;
      case 'forme':
        dessinerForme(g, e);
        break;
      case 'image':
        dessinerImage(g, e, images, edition);
        break;
      case 'logo':
        dessinerLogo(g, e, images);
        break;
      case 'liste':
        dessinerListe(g, e);
        break;
      default:
        break;
    }
    parent.add(g);
    groupes.set(e.id, g);
  }
  dessinerEffets(parent, plan);
  return groupes;
}

/** Rendu du plan en PNG ou JPEG, à la taille exacte du format (pixelRatio 1). */
export async function rendreBlob(plan: PlanRendu, images: ImagesChargees, type: 'png' | 'jpeg' = 'png', qualite = 0.92): Promise<Blob> {
  await chargerPolices(plan);
  const conteneur = document.createElement('div');
  const stage = new Konva.Stage({ container: conteneur, width: plan.largeur, height: plan.hauteur });
  try {
    const calque = new Konva.Layer({ listening: false });
    stage.add(calque);
    dessiner(calque, plan, images);
    calque.draw();
    return await new Promise<Blob>((ok, ko) => {
      stage.toBlob({ mimeType: `image/${type}`, quality: qualite, pixelRatio: 1, callback: b => (b ? ok(b as Blob) : ko(new Error('rendu'))) });
    });
  } finally {
    stage.destroy();
  }
}

/** Miniature (data URL JPEG) d'un plan, `largeur` px de large : galerie des modèles, aperçu de la charte. */
export async function rendreMiniature(plan: PlanRendu, images: ImagesChargees, largeur = 320): Promise<string> {
  await chargerPolices(plan);
  const conteneur = document.createElement('div');
  const stage = new Konva.Stage({ container: conteneur, width: plan.largeur, height: plan.hauteur });
  try {
    const calque = new Konva.Layer({ listening: false });
    stage.add(calque);
    dessiner(calque, plan, images);
    return stage.toDataURL({ mimeType: 'image/jpeg', quality: 0.85, pixelRatio: largeur / plan.largeur });
  } finally {
    stage.destroy();
  }
}
