/**
 * Visuels CM : PLAN DE RENDU d'un document — ce qu'il faut dessiner, dans l'ordre, avec les jetons de la
 * charte résolus (couleurs, polices, intensité du néon et du glitch), les champs dynamiques remplis dans la
 * langue du visuel, les conditions appliquées et les lignes des listes calculées. Pur (testé par Jest) :
 * le canevas (rendu.web.ts, Konva) ne fait que dessiner ce plan, à l'identique pour l'aperçu de l'éditeur
 * et pour le PNG / JPEG exporté.
 */

import { couleurDe, initialesDe, policeDe } from './charte';
import { calquesVisibles, lignesListe, texteFinal } from './champs';
import { FORMATS, type Calque, type Charte, type DocumentVisuel, type DonneesVisuel, type Forme, type Langue, type Police, type Remplissage, type SourceImage } from './types';

export type RemplissageResolu = { type: 'uni'; couleur: string } | { type: 'degrade'; couleurs: string[]; angle: number; radial: boolean };
export interface OmbreResolue {
  couleur: string;
  flou: number;
  dx: number;
  dy: number;
  opacite: number;
}
export interface Commun {
  id: string;
  x: number;
  y: number;
  l: number;
  h: number;
  rotation: number;
  opacite: number;
  verrouille: boolean;
  ombre: OmbreResolue | null;
  contour: { couleur: string; epaisseur: number } | null;
  /** Lueur néon (flou déjà multiplié par l'intensité de la charte) ; null si nulle. */
  lueur: { couleur: string; flou: number } | null;
}
export type ElementPlan =
  | (Commun & {
      type: 'texte';
      texte: string;
      police: Police;
      taille: number;
      graisse: number;
      italique: boolean;
      remplissage: RemplissageResolu;
      align: 'left' | 'center' | 'right';
      valign: 'top' | 'middle' | 'bottom';
      interligne: number;
      espacement: number;
      ajuster: boolean;
      glitch: { couleurs: [string, string]; decalage: number } | null;
    })
  | (Commun & { type: 'image'; source: SourceImage | null; ajustement: 'couvrir' | 'contenir'; rayon: number; filtre: 'normal' | 'gris' | 'duotone'; teinte: string })
  | (Commun & { type: 'forme'; forme: Forme; remplissage: RemplissageResolu | null; rayon: number; coupe: number })
  | (Commun & { type: 'logo'; source: SourceImage | null; monogramme: string; couleur: string; police: Police })
  | (Commun & {
      type: 'liste';
      lignes: Array<{ texte: string; enAvant: boolean }>;
      police: Police;
      taille: number;
      graisse: number;
      remplissage: RemplissageResolu;
      align: 'left' | 'center' | 'right';
      pas: number;
      surligne: string | null;
      espacement: number;
    });

export interface PlanRendu {
  largeur: number;
  hauteur: number;
  fond: RemplissageResolu;
  elements: ElementPlan[];
  effets: { scanlines: number; grain: number; vignette: number };
}

const ALIGN = { gauche: 'left', centre: 'center', droite: 'right' } as const;
const VALIGN = { haut: 'top', milieu: 'middle', bas: 'bottom' } as const;

export function remplissageResolu(r: Remplissage, charte: Charte): RemplissageResolu {
  if (r.type === 'uni') return { type: 'uni', couleur: couleurDe(r.couleur, charte) };
  return { type: 'degrade', couleurs: r.couleurs.map(c => couleurDe(c, charte)), angle: r.angle, radial: r.radial };
}

/** Source effective d'une image : un champ est remplacé par l'image des données (ou rien). */
export function sourceEffective(s: SourceImage, d: DonneesVisuel): SourceImage | null {
  if ('champ' in s) {
    const x = d.images[s.champ];
    return x && !('champ' in x) ? x : null;
  }
  return s;
}

/** Nom affiché par le monogramme d'un logo absent. */
function nomLogo(cible: 'club' | 'team' | 'adversaire', champs: Record<string, string>): string {
  if (cible === 'club') return champs.club || champs.team || '';
  if (cible === 'team') return champs.team || champs.club || '';
  return (champs.adversaire || '').split(',')[0] ?? '';
}

function commun(c: Calque, charte: Charte): Commun {
  const neon = charte.effets.neon / 0.8;
  return {
    id: c.id,
    x: c.x,
    y: c.y,
    l: c.l,
    h: c.h,
    rotation: c.rotation,
    opacite: c.opacite,
    verrouille: c.verrouille,
    ombre: c.ombre ? { couleur: couleurDe(c.ombre.couleur, charte, '#000000'), flou: c.ombre.flou, dx: c.ombre.dx, dy: c.ombre.dy, opacite: c.ombre.opacite } : null,
    contour: c.contour && c.contour.epaisseur > 0 ? { couleur: couleurDe(c.contour.couleur, charte), epaisseur: c.contour.epaisseur } : null,
    lueur: c.lueur && c.lueur.force * neon > 0.5 ? { couleur: couleurDe(c.lueur.couleur, charte), flou: Math.round(c.lueur.force * neon * 10) / 10 } : null,
  };
}

/** Plan de rendu d'un document, pour une charte, des données et une langue. */
export function planifier(doc: DocumentVisuel, charte: Charte, donnees: DonneesVisuel, langue: Langue): PlanRendu {
  const { largeur, hauteur } = FORMATS[doc.format];
  const d = donnees[langue];
  const elements: ElementPlan[] = [];
  for (const c of calquesVisibles(doc.calques, donnees, langue)) {
    const base = commun(c, charte);
    switch (c.type) {
      case 'texte': {
        const texte = texteFinal(c.texte, d, langue, c.majuscules);
        if (!texte.trim()) break;
        elements.push({
          ...base,
          type: 'texte',
          texte,
          police: policeDe(c.police, charte),
          taille: c.taille,
          graisse: c.graisse,
          italique: c.italique,
          remplissage: remplissageResolu(c.couleur, charte),
          align: ALIGN[c.align],
          valign: VALIGN[c.valign],
          interligne: c.interligne,
          espacement: c.espacement,
          ajuster: c.ajuster,
          glitch: c.glitch && charte.effets.glitch ? { couleurs: [charte.couleurs.primaire, charte.couleurs.secondaire], decalage: Math.max(2, Math.round(c.taille * 0.035)) } : null,
        });
        break;
      }
      case 'image':
        elements.push({ ...base, type: 'image', source: sourceEffective(c.source, donnees), ajustement: c.ajustement, rayon: c.rayon, filtre: c.filtre, teinte: charte.couleurs.secondaire });
        break;
      case 'forme':
        elements.push({ ...base, type: 'forme', forme: c.forme, remplissage: c.remplissage ? remplissageResolu(c.remplissage, charte) : null, rayon: c.rayon, coupe: c.coupe });
        break;
      case 'logo': {
        const champ = c.cible === 'club' ? 'logo_club' : c.cible === 'team' ? 'logo_team' : 'logo_adversaire';
        const source = donnees.images[champ] ?? null;
        elements.push({ ...base, type: 'logo', source: source && !('champ' in source) ? source : null, monogramme: initialesDe(nomLogo(c.cible, d.champs)), couleur: c.cible === 'adversaire' ? charte.couleurs.secondaire : charte.couleurs.primaire, police: charte.polices.titre });
        break;
      }
      case 'liste': {
        const lignes = lignesListe(c, d, langue);
        if (!lignes.length) break;
        elements.push({ ...base, type: 'liste', lignes, police: policeDe(c.police, charte), taille: c.taille, graisse: c.graisse, remplissage: remplissageResolu(c.couleur, charte), align: ALIGN[c.align], pas: c.pas, surligne: c.surligne ? couleurDe(c.surligne, charte) : null, espacement: 1 });
        break;
      }
      default:
        break;
    }
  }
  const e = doc.effets ?? { scanlines: charte.effets.scanlines, grain: charte.effets.grain, vignette: 0.35 };
  return { largeur, hauteur, fond: doc.fond ? remplissageResolu(doc.fond, charte) : { type: 'uni', couleur: charte.couleurs.fond }, elements, effets: e };
}

/** Points d'un polygone de forme (losange, hexagone, coins coupés) dans une boîte l × h. */
export function pointsForme(forme: Forme, l: number, h: number, coupe = 0): number[] {
  switch (forme) {
    case 'losange':
      return [l / 2, 0, l, h / 2, l / 2, h, 0, h / 2];
    case 'hexagone': {
      const d = Math.min(l / 4, h / 2);
      return [d, 0, l - d, 0, l, h / 2, l - d, h, d, h, 0, h / 2];
    }
    case 'chanfrein': {
      const c = Math.max(0, Math.min(coupe, l / 2, h / 2));
      return [c, 0, l, 0, l, h - c, l - c, h, 0, h, 0, c];
    }
    default:
      return [0, 0, l, 0, l, h, 0, h];
  }
}

/** Points de début et de fin d'un dégradé linéaire d'angle `angle` (degrés) dans une boîte l × h. */
export function extremitesDegrade(angle: number, l: number, h: number): { debut: { x: number; y: number }; fin: { x: number; y: number } } {
  const r = (angle * Math.PI) / 180;
  const dx = Math.cos(r);
  const dy = Math.sin(r);
  const demi = (Math.abs(l * dx) + Math.abs(h * dy)) / 2;
  return { debut: { x: l / 2 - dx * demi, y: h / 2 - dy * demi }, fin: { x: l / 2 + dx * demi, y: h / 2 + dy * demi } };
}

/** Générateur pseudo-aléatoire déterministe (grain identique à chaque rendu). */
export function aleatoireDeterministe(graine: number): () => number {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Polices utilisées par un plan (à charger avant de dessiner) : « 700 96px "Orbitron" ». */
export function policesDuPlan(p: PlanRendu): string[] {
  const s = new Set<string>();
  for (const e of p.elements) {
    if (e.type === 'texte' || e.type === 'liste') s.add(`${e.type === 'texte' && e.italique ? 'italic ' : ''}${e.graisse} 48px "${e.police}"`);
    if (e.type === 'logo' && !e.source) s.add(`900 48px "${e.police}"`);
  }
  return [...s];
}
