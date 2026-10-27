/**
 * Visuels CM : lecture tolérante d'un document (reçu du serveur, dupliqué, restauré), opérations de
 * l'éditeur (ajout, modification, ordre, duplication, alignement, magnétisme), historique annuler /
 * rétablir et zones sûres par réseau. Fonctions PURES (testées par Jest), indépendantes du canevas.
 *
 * Le serveur valide strictement chaque enregistrement (esport/noyau/cm/visuels/document.mjs) ; ici, une
 * valeur illisible est remplacée par sa valeur par défaut et un calque inconnu est ignoré : l'éditeur
 * s'ouvre toujours.
 */

import {
  CHAMPS_IMAGE,
  CLES_FORMATS,
  FORMATS,
  FORMES,
  GRAISSES,
  POLICES,
  ROLES_POLICES,
  SOURCES_LISTE,
  type Bilingue,
  type Calque,
  type ChampImage,
  type CalqueTexte,
  type CleFormat,
  type Couleur,
  type DocumentVisuel,
  type Effets,
  type Graisse,
  type Lueur,
  type Ombre,
  type Contour,
  type RefPolice,
  type Remplissage,
  type SourceImage,
  type TypeCalque,
  CLES_COULEURS,
} from './types';

export const MAX_CALQUES = 120;
export const TEXTE_MAX = 600;
export const HISTORIQUE_MAX = 100;

const estObjet = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const HEX = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
const MOTIF_ID = /^[A-Za-z0-9_-]{1,40}$/;
const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MOTIF_ASSET = /^(map|agent):[a-z0-9][a-z0-9-]{0,39}$/;
const MOTIF_SI = /^!?(serie|classement|champ:[a-z0-9_]{1,30})$/;

function nombre(v: unknown, min: number, max: number, defaut: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v * 100) / 100)) : defaut;
}
const booleen = (v: unknown): boolean => v === true;
function parmi<T extends string | number>(v: unknown, liste: readonly T[], defaut: T): T {
  return liste.includes(v as T) ? (v as T) : defaut;
}

export function couleurLue(v: unknown, defaut: Couleur): Couleur {
  if (typeof v === 'string' && HEX.test(v)) return v.toLowerCase();
  if (typeof v === 'string' && v.startsWith('charte:') && (CLES_COULEURS as readonly string[]).includes(v.slice(7))) return v;
  return defaut;
}

function policeLue(v: unknown): RefPolice {
  if (typeof v === 'string' && v.startsWith('charte:') && (ROLES_POLICES as readonly string[]).includes(v.slice(7))) return v as RefPolice;
  return POLICES.includes(v as never) ? (v as RefPolice) : 'charte:texte';
}

/** Nettoie un texte saisi : caractères de contrôle retirés (sauf retours à la ligne), longueur bornée. */
export function texteSur(v: unknown, max = TEXTE_MAX): string {
  return String(v ?? '')
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f‪-‮⁦-⁩]/g, '')
    .replace(/\r\n?/g, '\n')
    .slice(0, max);
}

function bilingue(v: unknown): Bilingue {
  if (typeof v === 'string') return { fr: texteSur(v), en: texteSur(v) };
  if (!estObjet(v)) return { fr: '', en: '' };
  return { fr: texteSur(v.fr), en: texteSur(v.en) };
}

export function remplissageLu(v: unknown, defaut: Remplissage | null): Remplissage | null {
  if (!estObjet(v)) return defaut;
  if (v.type === 'uni') return { type: 'uni', couleur: couleurLue(v.couleur, '#ffffff') };
  if (v.type === 'degrade' && Array.isArray(v.couleurs) && v.couleurs.length >= 2) {
    return { type: 'degrade', couleurs: v.couleurs.slice(0, 4).map(c => couleurLue(c, '#ffffff')), angle: nombre(v.angle, -360, 360, 90), radial: booleen(v.radial) };
  }
  return defaut;
}

function ombreLue(v: unknown): Ombre | null {
  if (!estObjet(v)) return null;
  return { couleur: couleurLue(v.couleur, '#000000'), flou: nombre(v.flou, 0, 200, 20), dx: nombre(v.dx, -500, 500, 0), dy: nombre(v.dy, -500, 500, 8), opacite: nombre(v.opacite, 0, 1, 0.6) };
}
function contourLu(v: unknown): Contour | null {
  if (!estObjet(v)) return null;
  return { couleur: couleurLue(v.couleur, 'charte:primaire'), epaisseur: nombre(v.epaisseur, 0, 50, 2) };
}
function lueurLue(v: unknown): Lueur | null {
  if (!estObjet(v)) return null;
  return { couleur: couleurLue(v.couleur, 'charte:primaire'), force: nombre(v.force, 0, 100, 30) };
}

/** Source d'une image : jamais une adresse (http, data:…) — un fichier CM, un champ, un asset du jeu. */
export function sourceLue(v: unknown): SourceImage | null {
  if (!estObjet(v) || Object.keys(v).length !== 1) return null;
  if (typeof v.fichier === 'string' && MOTIF_UUID.test(v.fichier)) return { fichier: v.fichier };
  if (typeof v.champ === 'string' && (CHAMPS_IMAGE as readonly string[]).includes(v.champ)) return { champ: v.champ as ChampImage };
  if (typeof v.asset === 'string' && MOTIF_ASSET.test(v.asset)) return { asset: v.asset };
  return null;
}

function calqueLu(v: unknown, ids: Set<string>): Calque | null {
  if (!estObjet(v)) return null;
  const type = v.type as TypeCalque;
  if (!['texte', 'image', 'forme', 'logo', 'liste'].includes(type)) return null;
  let id = typeof v.id === 'string' && MOTIF_ID.test(v.id) ? v.id : nouvelIdCalque();
  while (ids.has(id)) id = nouvelIdCalque();
  ids.add(id);
  const commun = {
    id,
    nom: texteSur(v.nom, 60).replace(/\n/g, ' '),
    x: nombre(v.x, -10000, 10000, 0),
    y: nombre(v.y, -10000, 10000, 0),
    l: nombre(v.l, 1, 10000, 100),
    h: nombre(v.h, 1, 10000, 100),
    rotation: nombre(v.rotation, -360, 360, 0),
    opacite: nombre(v.opacite, 0, 1, 1),
    verrouille: booleen(v.verrouille),
    masque: booleen(v.masque),
    si: typeof v.si === 'string' && MOTIF_SI.test(v.si) ? v.si : null,
    ombre: ombreLue(v.ombre),
    contour: contourLu(v.contour),
    lueur: lueurLue(v.lueur),
  };
  const couleurTexte: Remplissage = { type: 'uni', couleur: 'charte:texte' };
  switch (type) {
    case 'texte':
      return {
        ...commun,
        type,
        texte: bilingue(v.texte),
        police: policeLue(v.police),
        taille: nombre(v.taille, 4, 800, 48),
        graisse: parmi<Graisse>(v.graisse, GRAISSES, 400),
        italique: booleen(v.italique),
        couleur: remplissageLu(v.couleur, couleurTexte) ?? couleurTexte,
        align: parmi(v.align, ['gauche', 'centre', 'droite'] as const, 'gauche'),
        valign: parmi(v.valign, ['haut', 'milieu', 'bas'] as const, 'haut'),
        interligne: nombre(v.interligne, 0.5, 3, 1.1),
        espacement: nombre(v.espacement, -20, 100, 0),
        majuscules: booleen(v.majuscules),
        ajuster: booleen(v.ajuster),
        glitch: booleen(v.glitch),
      };
    case 'image': {
      const source = sourceLue(v.source);
      if (!source) return null;
      return { ...commun, type, source, ajustement: parmi(v.ajustement, ['couvrir', 'contenir'] as const, 'couvrir'), rayon: nombre(v.rayon, 0, 5000, 0), filtre: parmi(v.filtre, ['normal', 'gris', 'duotone'] as const, 'normal') };
    }
    case 'forme':
      return { ...commun, type, forme: parmi(v.forme, FORMES, 'rect'), remplissage: remplissageLu(v.remplissage, null), rayon: nombre(v.rayon, 0, 5000, 0), coupe: nombre(v.coupe, 0, 2000, 0) };
    case 'logo':
      return { ...commun, type, cible: parmi(v.cible, ['club', 'team', 'adversaire'] as const, 'team') };
    case 'liste':
      return {
        ...commun,
        type,
        source: parmi(v.source, SOURCES_LISTE, 'manches'),
        ligne: bilingue(v.ligne),
        police: policeLue(v.police),
        taille: nombre(v.taille, 4, 400, 36),
        graisse: parmi<Graisse>(v.graisse, GRAISSES, 600),
        couleur: remplissageLu(v.couleur, couleurTexte) ?? couleurTexte,
        align: parmi(v.align, ['gauche', 'centre', 'droite'] as const, 'gauche'),
        pas: nombre(v.pas, 4, 1000, 60),
        max: nombre(v.max, 1, 30, 8),
        majuscules: booleen(v.majuscules),
        surligne: v.surligne === undefined || v.surligne === null ? null : couleurLue(v.surligne, 'charte:primaire'),
      };
    default:
      return null;
  }
}

function effetsLus(v: unknown): Effets | null {
  if (!estObjet(v)) return null;
  return { scanlines: nombre(v.scanlines, 0, 1, 0), grain: nombre(v.grain, 0, 1, 0), vignette: nombre(v.vignette, 0, 1, 0) };
}

/** Lecture tolérante d'un document (JSON reçu). `format` : celui attendu si le document n'en a pas de valide. */
export function lireDocument(v: unknown, format: CleFormat = 'carre'): DocumentVisuel {
  const o = estObjet(v) ? v : {};
  const ids = new Set<string>();
  const calques = (Array.isArray(o.calques) ? o.calques : []).slice(0, MAX_CALQUES).map(c => calqueLu(c, ids)).filter((c): c is Calque => c !== null);
  return { v: 1, format: parmi(o.format, CLES_FORMATS, format), fond: remplissageLu(o.fond, null), effets: effetsLus(o.effets), calques };
}

/** Sérialisation (JSON stable : ce qu'on envoie au serveur et ce qu'on relit). */
export const ecrireDocument = (d: DocumentVisuel): string => JSON.stringify(d);

let compteur = 0;
/** Identifiant de calque court et unique dans la session. */
export function nouvelIdCalque(prefixe = 'c'): string {
  compteur = (compteur + 1) % 1_000_000;
  return `${prefixe}${Date.now().toString(36).slice(-5)}${compteur.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`.slice(0, 40);
}

// ------------------------------------------------------------------ Opérations

export type Action =
  | { type: 'ajouter'; calque: Calque; index?: number }
  | { type: 'modifier'; id: string; valeurs: Partial<Calque> }
  | { type: 'modifierPlusieurs'; changements: Array<{ id: string; valeurs: Partial<Calque> }> }
  | { type: 'supprimer'; id: string }
  | { type: 'dupliquer'; id: string; nouvelId?: string }
  | { type: 'ordre'; id: string; sens: 'monter' | 'descendre' | 'premier' | 'dernier' }
  | { type: 'deplacerA'; id: string; index: number }
  | { type: 'fond'; fond: Remplissage | null }
  | { type: 'effets'; effets: Effets | null }
  | { type: 'remplacer'; document: DocumentVisuel };

export function executer(doc: DocumentVisuel, a: Action): DocumentVisuel {
  const calques = doc.calques;
  const index = (id: string) => calques.findIndex(c => c.id === id);
  switch (a.type) {
    case 'ajouter': {
      if (calques.length >= MAX_CALQUES) return doc;
      const ids = new Set(calques.map(c => c.id));
      const c = ids.has(a.calque.id) ? { ...a.calque, id: nouvelIdCalque() } : a.calque;
      const i = a.index === undefined ? calques.length : Math.max(0, Math.min(calques.length, a.index));
      return { ...doc, calques: [...calques.slice(0, i), c, ...calques.slice(i)] };
    }
    case 'modifier': {
      const i = index(a.id);
      if (i < 0) return doc;
      const suivant = { ...calques[i], ...a.valeurs, id: calques[i].id, type: calques[i].type } as Calque;
      return { ...doc, calques: calques.map((c, j) => (j === i ? suivant : c)) };
    }
    case 'modifierPlusieurs':
      return a.changements.reduce((d, ch) => executer(d, { type: 'modifier', id: ch.id, valeurs: ch.valeurs }), doc);
    case 'supprimer':
      return { ...doc, calques: calques.filter(c => c.id !== a.id) };
    case 'dupliquer': {
      const i = index(a.id);
      if (i < 0 || calques.length >= MAX_CALQUES) return doc;
      const copie = { ...JSON.parse(JSON.stringify(calques[i])), id: a.nouvelId ?? nouvelIdCalque(), x: calques[i].x + 24, y: calques[i].y + 24, verrouille: false } as Calque;
      return { ...doc, calques: [...calques.slice(0, i + 1), copie, ...calques.slice(i + 1)] };
    }
    case 'ordre': {
      const i = index(a.id);
      if (i < 0) return doc;
      const cible = a.sens === 'monter' ? i + 1 : a.sens === 'descendre' ? i - 1 : a.sens === 'premier' ? calques.length - 1 : 0;
      return executer(doc, { type: 'deplacerA', id: a.id, index: cible });
    }
    case 'deplacerA': {
      const i = index(a.id);
      const j = Math.max(0, Math.min(calques.length - 1, a.index));
      if (i < 0 || i === j) return doc;
      const reste = calques.filter(c => c.id !== a.id);
      return { ...doc, calques: [...reste.slice(0, j), calques[i], ...reste.slice(j)] };
    }
    case 'fond':
      return { ...doc, fond: a.fond };
    case 'effets':
      return { ...doc, effets: a.effets };
    case 'remplacer':
      return a.document;
    default:
      return doc;
  }
}

// ------------------------------------------------------------------ Historique (annuler / rétablir)

export interface Historique {
  passe: DocumentVisuel[];
  present: DocumentVisuel;
  futur: DocumentVisuel[];
}
export const historique = (d: DocumentVisuel): Historique => ({ passe: [], present: d, futur: [] });

/** Applique une action ; `fusion` : regroupe avec la précédente (frappe au clavier, glisser continu). */
export function appliquer(h: Historique, a: Action, { fusion = false }: { fusion?: boolean } = {}): Historique {
  const suivant = executer(h.present, a);
  if (suivant === h.present) return h;
  if (fusion && h.passe.length) return { passe: h.passe, present: suivant, futur: [] };
  return { passe: [...h.passe, h.present].slice(-HISTORIQUE_MAX), present: suivant, futur: [] };
}
export const annuler = (h: Historique): Historique => (h.passe.length ? { passe: h.passe.slice(0, -1), present: h.passe[h.passe.length - 1], futur: [h.present, ...h.futur] } : h);
export const retablir = (h: Historique): Historique => (h.futur.length ? { passe: [...h.passe, h.present], present: h.futur[0], futur: h.futur.slice(1) } : h);

// ------------------------------------------------------------------ Alignement et magnétisme

export type Boite = { x: number; y: number; l: number; h: number };
export type SensAlignement = 'gauche' | 'centreH' | 'droite' | 'haut' | 'centreV' | 'bas';

/** Position d'une boîte alignée sur le canevas (W × H). */
export function aligner(b: Boite, sens: SensAlignement, W: number, H: number): { x: number; y: number } {
  switch (sens) {
    case 'gauche':
      return { x: 0, y: b.y };
    case 'centreH':
      return { x: Math.round((W - b.l) / 2), y: b.y };
    case 'droite':
      return { x: W - b.l, y: b.y };
    case 'haut':
      return { x: b.x, y: 0 };
    case 'centreV':
      return { x: b.x, y: Math.round((H - b.h) / 2) };
    case 'bas':
      return { x: b.x, y: H - b.h };
    default:
      return { x: b.x, y: b.y };
  }
}

export interface Guide {
  sens: 'v' | 'h';
  position: number;
}

/**
 * Magnétisme : rapproche la boîte déplacée des bords et du centre du canevas, et des bords / centres des
 * autres calques, à moins de `seuil` (unités du document). Rend la position corrigée et les guides à
 * afficher.
 */
export function aimanter(b: Boite, autres: Boite[], W: number, H: number, seuil = 8): { x: number; y: number; guides: Guide[] } {
  const ciblesV = [0, W / 2, W, ...autres.flatMap(o => [o.x, o.x + o.l / 2, o.x + o.l])];
  const ciblesH = [0, H / 2, H, ...autres.flatMap(o => [o.y, o.y + o.h / 2, o.y + o.h])];
  const meilleur = (points: number[], cibles: number[]) => {
    let r: { ecart: number; cible: number; decalage: number } | null = null;
    for (const p of points) {
      for (const c of cibles) {
        const e = Math.abs(p - c);
        if (e <= seuil && (!r || e < r.ecart)) r = { ecart: e, cible: c, decalage: c - p };
      }
    }
    return r;
  };
  const mv = meilleur([b.x, b.x + b.l / 2, b.x + b.l], ciblesV);
  const mh = meilleur([b.y, b.y + b.h / 2, b.y + b.h], ciblesH);
  const guides: Guide[] = [];
  if (mv) guides.push({ sens: 'v', position: mv.cible });
  if (mh) guides.push({ sens: 'h', position: mh.cible });
  return { x: Math.round((b.x + (mv?.decalage ?? 0)) * 100) / 100, y: Math.round((b.y + (mh?.decalage ?? 0)) * 100) / 100, guides };
}

// ------------------------------------------------------------------ Zones sûres

export type ReseauZone = 'instagram' | 'tiktok' | 'x';
export interface ZoneSure {
  reseau: ReseauZone;
  haut: number;
  bas: number;
  gauche: number;
  droite: number;
}

/**
 * Marges à garder libres (px du format) pour que rien d'important ne soit caché par l'interface du réseau
 * (pseudo, légende, boutons) ou coupé dans la grille du profil.
 */
export const ZONES_SURES: Readonly<Record<CleFormat, readonly ZoneSure[]>> = {
  carre: [
    { reseau: 'instagram', haut: 54, bas: 54, gauche: 54, droite: 54 },
    { reseau: 'x', haut: 135, bas: 135, gauche: 54, droite: 54 },
  ],
  portrait: [
    { reseau: 'instagram', haut: 68, bas: 68, gauche: 68, droite: 68 },
    { reseau: 'x', haut: 200, bas: 200, gauche: 54, droite: 54 },
  ],
  story: [
    { reseau: 'instagram', haut: 250, bas: 340, gauche: 64, droite: 64 },
    { reseau: 'tiktok', haut: 160, bas: 440, gauche: 64, droite: 140 },
  ],
  paysage: [
    { reseau: 'x', haut: 54, bas: 54, gauche: 96, droite: 96 },
    { reseau: 'instagram', haut: 54, bas: 54, gauche: 420, droite: 420 },
  ],
};

/** Calques dont la boîte déborde de la zone sûre (à signaler dans l'éditeur). */
export function horsZone(doc: DocumentVisuel, z: ZoneSure): string[] {
  const { largeur: W, hauteur: H } = FORMATS[doc.format];
  return doc.calques.filter(c => !c.masque && c.type === 'texte' && (c.x < z.gauche || c.y < z.haut || c.x + c.l > W - z.droite || c.y + c.h > H - z.bas)).map(c => c.id);
}

/** Calque texte par défaut (ajouté par l'éditeur). */
export function calqueTexteDefaut(W: number, H: number, texte: Bilingue): CalqueTexte {
  return {
    id: nouvelIdCalque('t'),
    type: 'texte',
    nom: '',
    x: Math.round(W * 0.1),
    y: Math.round(H * 0.4),
    l: Math.round(W * 0.8),
    h: 140,
    rotation: 0,
    opacite: 1,
    verrouille: false,
    masque: false,
    si: null,
    ombre: null,
    contour: null,
    lueur: null,
    texte,
    police: 'charte:titre',
    taille: 72,
    graisse: 700,
    italique: false,
    couleur: { type: 'uni', couleur: 'charte:texte' },
    align: 'centre',
    valign: 'milieu',
    interligne: 1.1,
    espacement: 0,
    majuscules: false,
    ajuster: true,
    glitch: false,
  };
}
