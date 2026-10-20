/**
 * Dessin sur la vidéo d'une review : format, normalisation, historique
 * (annuler / rétablir), choix des dessins à afficher pendant la lecture et
 * géométrie de rendu (SVG). Fonctions PURES, testées.
 *
 * Coordonnées RELATIVES (0 à 1) : le dessin suit la taille du lecteur. Le
 * serveur valide la même forme (esport/noyau/review/dessin.mjs) : 100 formes,
 * 200 points par trait, 120 caractères par texte, 32 Ko au plus.
 */

export type TypeForme = 'fleche' | 'cercle' | 'rect' | 'trait' | 'texte';

export interface FormeDessin {
  t: TypeForme;
  /** Couleur `#rrggbb`. */
  c: string;
  /** Épaisseur (taille du texte), en pixels pour un lecteur de 640 px de large. */
  e: number;
  /** Points relatifs [x1, y1, x2, y2, …]. */
  p: number[];
  /** Texte (forme « texte » seulement). */
  x?: string;
}

export interface Dessin {
  v: 1;
  objets: FormeDessin[];
}

export type OutilDessin = TypeForme | 'gomme';

export const OUTILS_DESSIN: ReadonlyArray<{ cle: OutilDessin; nom: string; glyphe: string }> = [
  { cle: 'fleche', nom: 'Flèche', glyphe: '➜' },
  { cle: 'cercle', nom: 'Cercle', glyphe: '◯' },
  { cle: 'rect', nom: 'Rectangle', glyphe: '▭' },
  { cle: 'trait', nom: 'Trait libre', glyphe: '✎' },
  { cle: 'texte', nom: 'Texte', glyphe: 'T' },
  { cle: 'gomme', nom: 'Gomme', glyphe: '⌫' },
];

export const COULEURS_DESSIN: ReadonlyArray<{ cle: string; nom: string }> = [
  { cle: '#e5484d', nom: 'Rouge' },
  { cle: '#f5a524', nom: 'Ambre' },
  { cle: '#30a46c', nom: 'Vert' },
  { cle: '#3e63dd', nom: 'Bleu' },
  { cle: '#ffffff', nom: 'Blanc' },
  { cle: '#111111', nom: 'Noir' },
];

export const EPAISSEURS_DESSIN: ReadonlyArray<{ cle: number; nom: string }> = [
  { cle: 2, nom: 'Fin' },
  { cle: 4, nom: 'Moyen' },
  { cle: 8, nom: 'Épais' },
];

export const OBJETS_DESSIN_MAX = 100;
export const POINTS_TRAIT_MAX = 200;
export const TEXTE_DESSIN_MAX = 120;
/** Durée d'affichage d'un dessin pendant la lecture, quand le repère n'a pas de durée. */
export const DUREE_DESSIN_DEFAUT = 3;
/** Repère de rendu : un lecteur de 640 × 360 (16:9). */
export const LARGEUR_REFERENCE = 640;
export const HAUTEUR_REFERENCE = 360;

const borne = (v: number) => Math.round(Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)) * 10000) / 10000;

/** Forme propre : coordonnées bornées et arrondies, trait réduit à 200 points, texte borné. */
export function normaliserForme(f: FormeDessin): FormeDessin {
  let p = f.p.map(borne);
  if (f.t === 'trait' && p.length > POINTS_TRAIT_MAX * 2) {
    // Un point sur deux (ou plus) jusqu'à tenir dans la limite ; le dernier point est gardé.
    const pas = Math.ceil(p.length / 2 / POINTS_TRAIT_MAX);
    const reduit: number[] = [];
    for (let i = 0; i < p.length / 2; i += pas) reduit.push(p[2 * i], p[2 * i + 1]);
    reduit.splice(-2, 2, p[p.length - 2], p[p.length - 1]);
    p = reduit.slice(0, POINTS_TRAIT_MAX * 2);
  }
  const propre: FormeDessin = { t: f.t, c: f.c.toLowerCase(), e: Math.max(1, Math.min(20, Math.round(f.e))), p };
  if (f.t === 'texte') propre.x = (f.x ?? '').replace(/[<>\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, TEXTE_DESSIN_MAX);
  return propre;
}

/** Dessin à envoyer au serveur (`null` : aucune forme, le dessin est retiré). */
export function dessinDe(objets: readonly FormeDessin[]): Dessin | null {
  const propres = objets.map(normaliserForme).filter(o => (o.t === 'texte' ? Boolean(o.x) && o.p.length === 2 : o.p.length >= 4));
  return propres.length ? { v: 1, objets: propres.slice(0, OBJETS_DESSIN_MAX) } : null;
}

// ------------------------------------------------------------------ Historique

export interface HistoriqueDessin {
  passe: FormeDessin[][];
  present: FormeDessin[];
  futur: FormeDessin[][];
}

export const historiqueDessin = (objets: readonly FormeDessin[] = []): HistoriqueDessin => ({ passe: [], present: [...objets], futur: [] });

/** Nouvel état (ajout ou gomme) : l'ancien passe dans « annuler », « rétablir » est vidé. */
export function changerDessin(h: HistoriqueDessin, objets: FormeDessin[]): HistoriqueDessin {
  return { passe: [...h.passe, h.present].slice(-100), present: objets.slice(0, OBJETS_DESSIN_MAX), futur: [] };
}

export function ajouterForme(h: HistoriqueDessin, forme: FormeDessin): HistoriqueDessin {
  if (h.present.length >= OBJETS_DESSIN_MAX) return h;
  return changerDessin(h, [...h.present, normaliserForme(forme)]);
}

export function gommerForme(h: HistoriqueDessin, index: number): HistoriqueDessin {
  if (index < 0 || index >= h.present.length) return h;
  return changerDessin(h, h.present.filter((_, i) => i !== index));
}

export function annulerDessin(h: HistoriqueDessin): HistoriqueDessin {
  if (!h.passe.length) return h;
  return { passe: h.passe.slice(0, -1), present: h.passe[h.passe.length - 1], futur: [h.present, ...h.futur] };
}

export function retablirDessin(h: HistoriqueDessin): HistoriqueDessin {
  if (!h.futur.length) return h;
  return { passe: [...h.passe, h.present], present: h.futur[0], futur: h.futur.slice(1) };
}

// ------------------------------------------------------------------ Lecture

interface RepereAvecDessin {
  id: string;
  debut: number;
  fin: number | null;
  dessin?: Dessin | null;
}

/** Fin d'affichage du dessin d'un repère : sa fin, sinon 3 s après son début. */
export const finDessin = (r: { debut: number; fin: number | null }, defaut = DUREE_DESSIN_DEFAUT): number => (r.fin != null && r.fin > r.debut ? r.fin : r.debut + defaut);

/**
 * Repères dont le dessin s'affiche à l'instant `t` : pendant la durée du repère
 * (ou 3 s), et en continu tant que la vidéo est en pause sur ce repère (un peu
 * de marge avant le début : un saut YouTube tombe parfois juste avant).
 */
export function dessinsAAfficher<T extends RepereAvecDessin>(reperes: readonly T[], t: number, enPause: boolean, defaut = DUREE_DESSIN_DEFAUT): T[] {
  const avance = enPause ? 0.5 : 0.1;
  return reperes.filter(r => Boolean(r.dessin?.objets.length) && t >= r.debut - avance && t <= finDessin(r, defaut));
}

/**
 * Repère auquel rattacher un dessin fait à l'instant `t` : un repère qui
 * commence à cet instant (à une demi-seconde près) et que l'on peut modifier ;
 * sinon `undefined` (un repère sera créé).
 */
export function repereDuDessin<T extends { debut: number; peutModifier: boolean }>(reperes: readonly T[], t: number): T | undefined {
  let meilleur: T | undefined;
  for (const r of reperes) {
    if (!r.peutModifier || Math.abs(r.debut - t) > 0.5) continue;
    if (!meilleur || Math.abs(r.debut - t) < Math.abs(meilleur.debut - t)) meilleur = r;
  }
  return meilleur;
}

// ------------------------------------------------------------------ Rendu (SVG)

export type ElementSvg =
  | { el: 'line'; x1: number; y1: number; x2: number; y2: number; couleur: string; epaisseur: number }
  | { el: 'polygon'; points: string; couleur: string }
  | { el: 'polyline'; points: string; couleur: string; epaisseur: number }
  | { el: 'ellipse'; cx: number; cy: number; rx: number; ry: number; couleur: string; epaisseur: number }
  | { el: 'rect'; x: number; y: number; l: number; h: number; couleur: string; epaisseur: number }
  | { el: 'text'; x: number; y: number; texte: string; couleur: string; taille: number };

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Taille du texte d'une forme « texte », dans le repère 640 × 360. */
export const tailleTexte = (e: number): number => 12 + e * 2.5;

/** Pointe d'une flèche (triangle) au bout du segment (x1, y1) → (x2, y2). */
export function pointeFleche(x1: number, y1: number, x2: number, y2: number, e: number): Array<[number, number]> {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const longueur = 8 + e * 2.2;
  const ouverture = Math.PI / 7;
  return [
    [x2, y2],
    [x2 - longueur * Math.cos(angle - ouverture), y2 - longueur * Math.sin(angle - ouverture)],
    [x2 - longueur * Math.cos(angle + ouverture), y2 - longueur * Math.sin(angle + ouverture)],
  ];
}

/** Éléments SVG d'un dessin dans un repère `largeur` × `hauteur` (640 × 360 par défaut). */
export function elementsSvg(d: Dessin | null | undefined, largeur = LARGEUR_REFERENCE, hauteur = HAUTEUR_REFERENCE): ElementSvg[] {
  const sortie: ElementSvg[] = [];
  const k = largeur / LARGEUR_REFERENCE;
  for (const o of d?.objets ?? []) {
    const X = (i: number) => r1(o.p[i] * largeur);
    const Y = (i: number) => r1(o.p[i] * hauteur);
    const e = r1(o.e * k);
    switch (o.t) {
      case 'fleche': {
        const [x1, y1, x2, y2] = [X(0), Y(1), X(2), Y(3)];
        sortie.push({ el: 'line', x1, y1, x2, y2, couleur: o.c, epaisseur: e });
        sortie.push({ el: 'polygon', points: pointeFleche(x1, y1, x2, y2, e).map(([x, y]) => `${r1(x)},${r1(y)}`).join(' '), couleur: o.c });
        break;
      }
      case 'cercle':
        sortie.push({ el: 'ellipse', cx: r1((X(0) + X(2)) / 2), cy: r1((Y(1) + Y(3)) / 2), rx: r1(Math.abs(X(2) - X(0)) / 2), ry: r1(Math.abs(Y(3) - Y(1)) / 2), couleur: o.c, epaisseur: e });
        break;
      case 'rect':
        sortie.push({ el: 'rect', x: Math.min(X(0), X(2)), y: Math.min(Y(1), Y(3)), l: r1(Math.abs(X(2) - X(0))), h: r1(Math.abs(Y(3) - Y(1))), couleur: o.c, epaisseur: e });
        break;
      case 'trait': {
        const pts: string[] = [];
        for (let i = 0; i + 1 < o.p.length; i += 2) pts.push(`${X(i)},${Y(i + 1)}`);
        sortie.push({ el: 'polyline', points: pts.join(' '), couleur: o.c, epaisseur: e });
        break;
      }
      case 'texte':
        sortie.push({ el: 'text', x: X(0), y: Y(1), texte: o.x ?? '', couleur: o.c, taille: r1(tailleTexte(o.e) * k) });
        break;
    }
  }
  return sortie;
}

/** Libellé accessible d'un dessin : « Dessin : 2 formes (flèche, cercle) ». */
export function resumeDessin(d: Dessin | null | undefined): string {
  if (!d?.objets.length) return '';
  const noms: Record<TypeForme, string> = { fleche: 'flèche', cercle: 'cercle', rect: 'rectangle', trait: 'trait', texte: 'texte' };
  const types = [...new Set(d.objets.map(o => noms[o.t] ?? o.t))];
  return `${d.objets.length} forme${d.objets.length > 1 ? 's' : ''} (${types.join(', ')})`;
}
