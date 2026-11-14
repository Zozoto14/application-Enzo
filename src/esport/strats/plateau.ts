/**
 * Langage visuel du plateau de strats (pur, testé) : jetons de design (esport/noyau/strats/plateau.json, les
 * MÊMES que la page de partage du serveur), couleurs (mélange, transparence, contraste), genre graphique d'une
 * capacité (fumée, zone de dégâts, mur, flash, recon, fil…) déduit de sa forme et de ses caractéristiques,
 * usage d'un tracé (déplacement, rotation, regard), tailles à l'écran bornées quel que soit le zoom.
 *
 * Utilisé par le canevas de l'éditeur (Konva), l'export PNG / PDF, les miniatures et la carte thémée
 * (src/esport/cartes). Rien ici ne dessine : ce module décide, les rendus appliquent.
 */

import jetons from '../../../esport/noyau/strats/plateau.json';
import type { CapaciteJeu } from '../jeux/api';
import type { ModeCouleurs, ObjetStrat, ObjetTrace, UsageTrace, Zone } from './document';

export const PLATEAU = jetons;

// ------------------------------------------------------------------ Thèmes de la map

export type IdThemeCarte = 'tactique' | 'clair' | 'contraste' | 'origine';
export const THEMES_CARTE: readonly IdThemeCarte[] = ['tactique', 'clair', 'contraste', 'origine'];
export interface ThemeCarte {
  /** Fond du plateau, autour de la map. */
  fond: string;
  /** Sol de la map (silhouette de la minimap), bas et haut du dégradé. */
  sol: string;
  solHaut: string;
  /** Liseré de la silhouette. */
  contour: string;
  /** Ombre intérieure et portée. */
  ombre: string;
  /** Force du vignettage (0 : aucun). */
  vignette: number;
  /** Part de l'image d'origine gardée sur le sol (reliefs, marches) ; 1 : image d'origine telle quelle. */
  detail: number;
  /** Couleur des étiquettes de callouts. */
  etiquette: string;
  /** Opacité du remplissage des zones nommées. */
  zone: number;
  grille: string;
}
export const themeCarte = (id: string | null | undefined): ThemeCarte => (PLATEAU.themes as Record<string, ThemeCarte>)[id ?? ''] ?? PLATEAU.themes.tactique;
export const idThemeCarte = (id: unknown): IdThemeCarte => ((THEMES_CARTE as readonly unknown[]).includes(id) ? (id as IdThemeCarte) : 'tactique');

/**
 * Réglages de map effectifs : Valorant affiche TOUJOURS l'image d'origine de la minimap (les thèmes et
 * l'atténuation masquaient les zones et les boîtes de sites) ; les réglages enregistrés sont alors ignorés.
 */
export const reglagesCarte = (modele: string | null | undefined, theme: IdThemeCarte, attenuation: Attenuation): { themeCarte: IdThemeCarte; attenuation: Attenuation } =>
  modele === 'valorant' ? { themeCarte: 'origine', attenuation: 0 } : { themeCarte: theme, attenuation };

/** « Atténuer la map" (images de type photo) : 0 non, 1 assombrie et désaturée, 2 en plus légèrement floutée. */
export type Attenuation = 0 | 1 | 2;

// ------------------------------------------------------------------ Couleurs

const HEX = /^#[0-9a-f]{6}$/i;
/** Composantes d'un « #rrggbb » (repli : blanc). */
export function rvb(hexa: string): [number, number, number] {
  if (!HEX.test(hexa)) return [255, 255, 255];
  const n = Number.parseInt(hexa.slice(1), 16);
  return [Math.floor(n / 65536) % 256, Math.floor(n / 256) % 256, n % 256];
}
const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
/** Couleur avec transparence (« rgba(…) »). */
export function alpha(hexa: string, a: number): string {
  const [r, g, b] = rvb(hexa);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, Math.round(a * 1000) / 1000))})`;
}
/** Mélange de deux couleurs (`f` : part de la seconde, 0 à 1). */
export function melanger(a: string, b: string, f: number): string {
  const [r1, g1, b1] = rvb(a);
  const [r2, g2, b2] = rvb(b);
  const k = Math.max(0, Math.min(1, f));
  return `#${hex2(r1 + (r2 - r1) * k)}${hex2(g1 + (g2 - g1) * k)}${hex2(b1 + (b2 - b1) * k)}`;
}
export const eclaircir = (c: string, f: number): string => melanger(c, '#ffffff', f);
export const assombrir = (c: string, f: number): string => melanger(c, '#000000', f);

/** Luminance relative (WCAG) d'une couleur. */
export function luminance(hexa: string): number {
  const [r, g, b] = rvb(hexa).map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Rapport de contraste (WCAG, 1 à 21) entre deux couleurs. */
export function contraste(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/**
 * Couleur d'une capacité ou d'un pion selon le réglage de la strat : celle du joueur (défaut), ou l'accent de
 * l'agent / de la capacité (profil de jeu) quand il est connu.
 */
export function couleurAffichee(couleur: string, mode: ModeCouleurs | undefined, accent: string | null | undefined): string {
  return mode === 'agent' && accent && HEX.test(accent) ? accent.toLowerCase() : couleur;
}

// ------------------------------------------------------------------ Genre graphique d'une capacité

/**
 * Genre graphique : `fumee` (disque « sphère », bord doux), `zone` (dégâts au sol, dégradé chaud, bord net),
 * `aire` (grande zone d'effet, disque léger cerclé), `piege` (mine, capteur : cœur plein et rayon de
 * déclenchement en pointillés), `blob` (goo : tache irrégulière), `mur` (bande), `eclair` (cône de flash qui
 * s'estompe), `cone` (détection : tourelle, caméra), `recon` (trajet et anneau de révélation), `fil` (ligne à
 * embouts et zone de détection), `bande` (rectangle orienté), `icone` (sans zone).
 */
export type GenreCapacite = 'fumee' | 'zone' | 'aire' | 'piege' | 'blob' | 'mur' | 'eclair' | 'cone' | 'recon' | 'fil' | 'bande' | 'icone';
export interface StyleCapacite {
  genre: GenreCapacite;
  /** Ultime : contour plus fort, pastille « X ». */
  ultime: boolean;
  /** Teinte chaude (feu, acide) mêlée à la couleur. */
  chaud: boolean;
}

// Mots qui donnent le genre d'après le nom : dans les jetons partagés (la page de partage du serveur lit les mêmes).
const motif = (cle: 'fumees' | 'feux' | 'pieges' | 'blobs' | 'flashs') => new RegExp(PLATEAU.motifs[cle], 'i');
const FUMEES = motif('fumees');
const FEUX = motif('feux');
const PIEGES = motif('pieges');
const BLOBS = motif('blobs');
const FLASHS = motif('flashs');

/** Genre graphique d'une zone posée, d'après sa forme, le nom et les caractéristiques de la capacité (profil de jeu). */
export function styleCapacite(zone: Zone | null | undefined, donnees?: CapaciteJeu, nom?: string): StyleCapacite {
  const ultime = donnees?.categorie === 'ultime' || donnees?.touche?.toUpperCase() === 'X';
  const noms = `${donnees?.nom ?? ''} ${nom ?? ''}`;
  if (!zone) return { genre: 'icone', ultime, chaud: false };
  switch (zone.forme) {
    case 'cercle': {
      if (BLOBS.test(noms)) return { genre: 'blob', ultime, chaud: false };
      if (PIEGES.test(noms)) return { genre: 'piege', ultime, chaud: false };
      if (FUMEES.test(noms)) return { genre: 'fumee', ultime, chaud: false };
      if (FEUX.test(noms)) return { genre: 'zone', ultime, chaud: true };
      if (zone.rayon >= 12) return { genre: 'aire', ultime, chaud: false };
      if ((donnees?.duree ?? 0) >= 10) return { genre: 'fumee', ultime, chaud: false };
      return { genre: 'zone', ultime, chaud: false };
    }
    case 'mur':
      return { genre: 'mur', ultime, chaud: FEUX.test(noms) || /blaze|brasier/i.test(noms) };
    case 'cone':
      return { genre: FLASHS.test(noms) || ((donnees?.duree ?? 99) <= 4 && zone.ouverture >= 100) ? 'eclair' : 'cone', ultime, chaud: false };
    case 'trajet':
      return { genre: 'recon', ultime, chaud: false };
    case 'ligne':
      return { genre: 'fil', ultime, chaud: false };
    case 'rect':
      return { genre: 'bande', ultime, chaud: FEUX.test(noms) };
  }
}

/** Segments d'un mur « en blocs » (Barrier Orb : 4), d'après les caractéristiques ; 1 : d'un seul tenant. */
export const segmentsMur = (donnees?: CapaciteJeu): number => Math.max(1, Math.min(12, Math.round((donnees as { segments?: number } | undefined)?.segments ?? 1)));

// ------------------------------------------------------------------ Tracés

/** Usage d'un tracé : celui qu'il porte, sinon déduit (tirets = rotation, le reste = déplacement). */
export const usageTrace = (o: Pick<ObjetTrace, 'usage' | 'tirets'>): UsageTrace => o.usage ?? (o.tirets ? 'rotation' : 'deplacement');

/** Tirets du trait selon l'usage (unités du repère) ; undefined : plein. */
export function tiretsUsage(usage: UsageTrace, epaisseur: number): number[] | undefined {
  if (usage === 'rotation') return [epaisseur * 2.8, epaisseur * 2];
  if (usage === 'regard') return [epaisseur * 0.4, epaisseur * 1.9];
  return undefined;
}

// ------------------------------------------------------------------ Tailles à l'écran

/**
 * Facteur d'échelle d'un jeton (pion, puce de capacité) de `rayon` unités pour que son rayon À L'ÉCRAN reste
 * entre `minPx` et `maxPx`, quel que soit le zoom (`pxParUnite` : pixels d'écran par unité du repère).
 */
export function facteurEcran(rayon: number, pxParUnite: number, minPx: number, maxPx: number): number {
  const ecran = rayon * Math.max(1e-6, pxParUnite);
  if (ecran < minPx) return minPx / ecran;
  if (ecran > maxPx) return maxPx / ecran;
  return 1;
}

/** Zoom quantifié (pas de 8 %) : les objets ne se redessinent pas à chaque image d'un pincement. */
export const zoomQuantifie = (pxParUnite: number): number => Math.round(Math.log(Math.max(1e-4, pxParUnite)) / Math.log(1.08));
export const zoomDepuisQuantifie = (q: number): number => 1.08 ** q;

/** Les étiquettes des callouts ne s'affichent qu'au-dessus d'un zoom (elles encombreraient une petite map). */
export const etiquettesVisibles = (pxParUnite: number): boolean => pxParUnite >= PLATEAU.etiquette.seuilZoomPx;

/** Opacité d'une étiquette de callout : atténuée quand un objet (pion, capacité, marqueur) est posé dessus. */
export function opaciteEtiquette(x: number, y: number, objets: readonly ObjetStrat[], rayon = 34): number {
  for (const o of objets) {
    if ('points' in o || o.type === 'forme' || o.type === 'texte' || o.type === 'vision') continue;
    if (Math.abs(o.x - x) < rayon * 1.6 && Math.abs(o.y - y) < rayon) return PLATEAU.etiquette.opaciteSousObjet;
  }
  return 1;
}

/** Tache irrégulière (goo) : points d'un contour fermé autour de (0, 0), stable pour une même graine. */
export function contourBlob(rayon: number, graine: string, n = 12): number[] {
  let h = 7;
  for (let i = 0; i < graine.length; i++) h = (h * 31 + graine.charCodeAt(i)) % 1000003;
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    h = (h * 48271 + 12345) % 2147483647;
    const r = rayon * (0.82 + ((h % 1000) / 1000) * 0.3);
    const a = (i / n) * Math.PI * 2;
    pts.push(Math.round(r * Math.cos(a) * 10) / 10, Math.round(r * Math.sin(a) * 10) / 10);
  }
  return pts;
}
