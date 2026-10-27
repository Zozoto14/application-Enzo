/**
 * Charte graphique du club : thème cyberpunk par défaut (miroir de CHARTE_DEFAUT du serveur) et
 * résolution des jetons « charte:primaire » / « charte:titre » d'un document. Changer la charte change donc
 * tous les modèles qui l'utilisent, sans toucher aux modèles.
 */

import { CLES_COULEURS, POLICES, ROLES_POLICES, type Charte, type CleCouleur, type Couleur, type Police, type RefPolice, type RolePolice } from './types';

export const CHARTE_DEFAUT: Charte = {
  nom: 'Cyberpunk',
  club: '',
  couleurs: { fond: '#07060f', fond2: '#1b0b33', primaire: '#00f0ff', secondaire: '#ff2bd6', accent: '#f5ff3b', texte: '#f2f4ff', attenue: '#9a9cc4', victoire: '#3dff8b', defaite: '#ff3b5c' },
  polices: { titre: 'Orbitron', sousTitre: 'Chakra Petch', texte: 'Manrope', chiffres: 'Orbitron' },
  effets: { neon: 0.8, glitch: true, scanlines: 0.35, grain: 0.25 },
  logos: { club: null, teams: {} },
};

const HEX = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

/** Charte reçue (serveur) complétée par les valeurs par défaut ; tolérante (valeur illisible → défaut). */
export function lireCharte(v: unknown): Charte {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Charte>;
  const couleurs = { ...CHARTE_DEFAUT.couleurs };
  for (const k of CLES_COULEURS) {
    const c = o.couleurs?.[k];
    if (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)) couleurs[k] = c.toLowerCase();
  }
  const polices = { ...CHARTE_DEFAUT.polices };
  for (const r of ROLES_POLICES) {
    const p = o.polices?.[r];
    if (POLICES.includes(p as Police)) polices[r] = p as Police;
  }
  const e = o.effets ?? CHARTE_DEFAUT.effets;
  const borne = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : d);
  return {
    nom: typeof o.nom === 'string' && o.nom ? o.nom : CHARTE_DEFAUT.nom,
    club: typeof o.club === 'string' ? o.club : '',
    couleurs,
    polices,
    effets: { neon: borne(e.neon, CHARTE_DEFAUT.effets.neon), glitch: typeof e.glitch === 'boolean' ? e.glitch : true, scanlines: borne(e.scanlines, CHARTE_DEFAUT.effets.scanlines), grain: borne(e.grain, CHARTE_DEFAUT.effets.grain) },
    logos: { club: typeof o.logos?.club === 'string' ? o.logos.club : null, teams: { ...(o.logos?.teams ?? {}) } },
  };
}

/** Couleur effective (« #rrggbb[aa] ») d'une couleur de document. */
export function couleurDe(c: Couleur | null | undefined, charte: Charte, repli = '#ffffff'): string {
  if (!c) return repli;
  if (c.startsWith('charte:')) return charte.couleurs[c.slice(7) as CleCouleur] ?? repli;
  return HEX.test(c) ? c : repli;
}

/** Police effective d'une police de document. */
export function policeDe(p: RefPolice | null | undefined, charte: Charte): Police {
  if (!p) return charte.polices.texte;
  if (p.startsWith('charte:')) return charte.polices[p.slice(7) as RolePolice] ?? charte.polices.texte;
  return POLICES.includes(p as Police) ? (p as Police) : charte.polices.texte;
}

/** « #rrggbb » + opacité (0 à 1) → « rgba(…) » (canevas). « #rrggbbaa » garde son alpha, multiplié. */
export function rgba(hex: string, opacite = 1): string {
  const h = HEX.test(hex) ? hex : '#ffffff';
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  const a = h.length === 9 ? parseInt(h.slice(7, 9), 16) / 255 : 1;
  return `rgba(${r}, ${g}, ${b}, ${Math.round(a * opacite * 1000) / 1000})`;
}

/** Initiales d'un nom (monogramme d'un logo absent). */
export function initialesDe(nom: string): string {
  const mots = nom.replace(/[^\p{L}\p{N} ]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!mots.length) return '?';
  if (mots.length === 1) return mots[0].slice(0, 2).toUpperCase();
  return (mots[0][0] + mots[1][0]).toUpperCase();
}
