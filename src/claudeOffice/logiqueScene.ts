/**
 * Claude Office, onglet « Bureau » : logique pure de la scène « open space »
 * (sans React ni DOM, testée dans scene.test.tsx).
 *
 * - Plan de l'open space (repère au sol : x vers la droite-bas, y vers la
 *   gauche-bas, en dalles) : trois îlots de quatre postes, couloirs, porte.
 * - Affectation des postes : déterministe par identifiant (hachage, puis poste
 *   libre suivant), stable tant que l'agent est là.
 * - Trajets porte ↔ poste sur des voies séparées (arrivées / départs) et
 *   planification sans collision : un trajet ne part que lorsqu'il ne croise
 *   aucun autre marcheur à moins de `SEUIL_COLLISION` (sinon il attend :
 *   à l'entrée pour une arrivée, assis à son poste pour un départ).
 * - Phases d'un personnage (arrive, assis, fête, repart, parti) selon l'état
 *   déduit des événements (logiqueBureau.ts).
 * - Apparence dérivée de l'identifiant de session (peau, coiffure, accessoire)
 *   et du projet (couleur du haut).
 * - Mode « démo » : sessions fictives scénarisées, rien de réel.
 */

import { couleurAgent, type Agent, type EtatAgent } from './logiqueBureau';
import type { EntreeHistorique } from './logiqueHistorique';

export interface Point {
  x: number;
  y: number;
}

// ------------------------------------------------------------------ plan

/** Dimensions de la pièce (dalles). */
export const LARGEUR_PIECE = 20;
export const PROFONDEUR_PIECE = 14;
export const HAUTEUR_MURS = 3;

/** Voies des couloirs : arrivées et départs séparés de 0,6 dalle. */
export const VOIES = {
  /** Axe porte ↔ couloirs (x). */
  axeArrivee: 14.1,
  axeDepart: 14.7,
  /** Couloir du fond, devant les rangées du fond (y). */
  fondArrivee: 5.0,
  fondDepart: 5.5,
  /** Couloir de devant (y). */
  devantArrivee: 10.3,
  devantDepart: 10.8,
  /** Seuil de la porte, hors de la pièce (y). */
  dehors: -0.6,
} as const;

export const PORTE = { x0: 13.65, x1: 15.15 } as const;

export interface Poste {
  index: number;
  ilot: number;
  /** 0 : rangée du fond (on voit le visage), 1 : rangée de devant (on voit l'écran). */
  rangee: 0 | 1;
  colonne: 0 | 1;
  /** Où s'assoit le personnage. */
  siege: Point;
  /** Plateau du bureau (x, y, largeur, profondeur). */
  bureau: { x: number; y: number; w: number; d: number };
}

/** Origine x des trois îlots (chacun : 4 dalles de large, 2 bureaux par rangée). */
export const ILOTS_X = [4.6, 9.6, 15.2] as const;
const Y_SIEGE_FOND = 6.15;
const Y_SIEGE_DEVANT = 9.35;
const Y_BUREAU_FOND = 6.75;

export const POSTES: readonly Poste[] = ILOTS_X.flatMap((x0, ilot) =>
  ([0, 1] as const).flatMap(rangee =>
    ([0, 1] as const).map(colonne => ({
      index: ilot * 4 + rangee * 2 + colonne,
      ilot,
      rangee,
      colonne,
      siege: { x: x0 + 1 + 2 * colonne, y: rangee === 0 ? Y_SIEGE_FOND : Y_SIEGE_DEVANT },
      bureau: { x: x0 + 2 * colonne, y: Y_BUREAU_FOND + rangee, w: 2, d: 1 },
    })),
  ),
);

export const NB_POSTES = POSTES.length;

// ------------------------------------------------------------------ hachage et apparence

/** Hachage FNV-1a 32 bits (stable, sans dépendance). */
export function hacher(texte: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export const PEAUX = ['#F6D3B8', '#EBB894', '#D39A6E', '#A9714B', '#7A4B31'] as const;
export const CHEVEUX = ['#2B1E16', '#5A3825', '#9A5B2E', '#D8A54A', '#C9CBD3', '#8E3B2E', '#34436F'] as const;
export const PANTALONS = ['#2F3A52', '#4A4F5C', '#5B4636', '#33504A'] as const;
export const COUPES = ['courte', 'chignon', 'longue', 'boucles', 'meche'] as const;
export const ACCESSOIRES = ['aucun', 'lunettes', 'casque', 'bonnet', 'noeud', 'echarpe'] as const;

export interface Apparence {
  peau: string;
  cheveux: string;
  coupe: (typeof COUPES)[number];
  accessoire: (typeof ACCESSOIRES)[number];
  /** Couleur du haut : celle du projet (comme la pastille de la liste). */
  haut: string;
  pantalon: string;
  /** Couleur de l'accessoire. */
  touche: string;
}

const TOUCHES = ['#F2C14E', '#E76F51', '#4CC9F0', '#9B5DE5', '#2EC4B6', '#F15BB5'] as const;

/** Apparence stable d'un agent : visage et accessoire selon la session, haut selon le projet. */
export function apparence(a: Pick<Agent, 'cle' | 'session' | 'projet'>): Apparence {
  const h = hacher(a.session || a.cle);
  const g = hacher(`${a.cle}#`);
  return {
    peau: PEAUX[h % PEAUX.length],
    cheveux: CHEVEUX[(h >>> 4) % CHEVEUX.length],
    coupe: COUPES[(h >>> 8) % COUPES.length],
    accessoire: ACCESSOIRES[(h >>> 12) % ACCESSOIRES.length],
    haut: couleurAgent(a.projet ?? a.cle),
    pantalon: PANTALONS[(g >>> 3) % PANTALONS.length],
    touche: TOUCHES[(g >>> 7) % TOUCHES.length],
  };
}

// ------------------------------------------------------------------ activité visible

export type Activite = 'code' | 'terminal' | 'recherche' | 'lecture' | 'web' | 'agent' | 'outil' | 'pense' | 'pause' | 'fini';

export const LIBELLES_ACTIVITE: Record<Activite, string> = {
  code: 'Écrit du code',
  terminal: 'Terminal',
  recherche: 'Recherche dans le code',
  lecture: 'Lit un fichier',
  web: 'Consulte le web',
  agent: 'Lance un sous-agent',
  outil: 'Utilise un outil',
  pense: 'Réfléchit',
  pause: 'Pause café',
  fini: 'Terminé',
};

/** Couleurs de l'activité (anneau des badges, lumière des écrans). */
export const TEINTES_ACTIVITE: Record<Activite, string> = {
  code: '#7C6CF2', terminal: '#2FBF71', recherche: '#E8A23A', lecture: '#3BA3D9', web: '#2E8FE0', agent: '#C05BD8', outil: '#E07A3A', pense: '#8F96A8', pause: '#B98552', fini: '#2FA36B',
};

export const ICONES_ACTIVITE: Record<Activite, string> = {
  code: '</>', terminal: '>_', recherche: '⌕', lecture: '¶', web: '◍', agent: '✦', outil: '⚙', pense: '…', pause: '☕', fini: '✓',
};

/** Le gadget montré à l'écran selon l'outil (le hook ne note que les fins d'outil). */
export function genreOutil(nom: string | undefined): Activite {
  const n = (nom ?? '').trim();
  if (!n) return 'outil';
  if (/^(write|write_file|edit|multiedit|replace|notebookedit|str_replace_editor|apply_patch)$/i.test(n)) return 'code';
  if (/web|fetch|browser|navigate|http|url/i.test(n)) return 'web';
  if (/^(task|agent)$/i.test(n)) return 'agent';
  if (/bash|shell|powershell|terminal|command|exec/i.test(n)) return 'terminal';
  if (/grep|glob|search|find|^ls$|list/i.test(n)) return 'recherche';
  if (/read|view|cat|open/i.test(n)) return 'lecture';
  return 'outil';
}

export function activiteAgent(a: Pick<Agent, 'etat' | 'outil'>): Activite {
  switch (a.etat) {
    case 'ecrit':
      return 'code';
    case 'outil': {
      const g = genreOutil(a.outil);
      return g === 'code' ? 'outil' : g;
    }
    case 'reflechit':
      return 'pense';
    case 'inactif':
      return 'pause';
    default:
      return 'fini';
  }
}

// ------------------------------------------------------------------ affectation des postes

/**
 * Poste d'un nouvel agent : celui que désigne son identifiant, sinon le
 * suivant libre. Rien si tout est pris.
 */
export function choisirPoste(cle: string, occupes: ReadonlySet<number>, nb = NB_POSTES): number | undefined {
  if (occupes.size >= nb) return undefined;
  const depart = hacher(cle) % nb;
  for (let i = 0; i < nb; i++) {
    const p = (depart + i) % nb;
    if (!occupes.has(p)) return p;
  }
  return undefined;
}

/** Affecte des postes à une liste d'agents (dans l'ordre des clés : résultat déterministe). */
export function attribuerPostes(cles: readonly string[], deja: ReadonlyMap<string, number> = new Map(), nb = NB_POSTES): Map<string, number> {
  const res = new Map(deja);
  const occupes = new Set(res.values());
  for (const cle of [...cles].sort()) {
    if (res.has(cle)) continue;
    const p = choisirPoste(cle, occupes, nb);
    if (p === undefined) continue;
    res.set(cle, p);
    occupes.add(p);
  }
  return res;
}

// ------------------------------------------------------------------ trajets

export function cheminArrivee(p: Poste): Point[] {
  const yVoie = p.rangee === 0 ? VOIES.fondArrivee : VOIES.devantArrivee;
  return [
    { x: VOIES.axeArrivee, y: VOIES.dehors },
    { x: VOIES.axeArrivee, y: yVoie },
    { x: p.siege.x, y: yVoie },
    { ...p.siege },
  ];
}

export function cheminDepart(p: Poste): Point[] {
  const yVoie = p.rangee === 0 ? VOIES.fondDepart : VOIES.devantDepart;
  return [
    { ...p.siege },
    { x: p.siege.x, y: yVoie },
    { x: VOIES.axeDepart, y: yVoie },
    { x: VOIES.axeDepart, y: VOIES.dehors },
  ];
}

export function longueur(points: readonly Point[]): number {
  let l = 0;
  for (let i = 1; i < points.length; i++) l += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return l;
}

/** Point situé à `d` dalles du début du chemin, et direction du segment. */
export function pointSur(points: readonly Point[], d: number): { p: Point; dir: Point } {
  let reste = Math.max(0, d);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    const dir = l ? { x: (b.x - a.x) / l, y: (b.y - a.y) / l } : { x: 0, y: 1 };
    if (reste <= l || i === points.length - 1) {
      const k = l ? Math.min(1, reste / l) : 1;
      return { p: { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }, dir };
    }
    reste -= l;
  }
  return { p: { ...points[0] }, dir: { x: 0, y: 1 } };
}

/** Vitesse de marche (dalles par seconde). */
export const VITESSE = 2.2;
/** Distance minimale entre deux marcheurs visibles (dalles). */
export const SEUIL_COLLISION = 0.55;
/** Attente au plus avant de partir quand même (s). */
export const ATTENTE_MAX = 90;

export interface Trajet {
  id: string;
  points: Point[];
  /** Départ (secondes de l'horloge de la scène). */
  debut: number;
  duree: number;
}

/** Position sur un trajet à l'instant `t` (avant le départ : au début ; après : à la fin). */
export function positionTrajet(tr: Trajet, t: number): { p: Point; dir: Point } {
  return pointSur(tr.points, Math.min(tr.duree, Math.max(0, t - tr.debut)) * VITESSE);
}

/** Un marcheur est visible une fois la porte franchie. */
export const estDansLaPiece = (p: Point): boolean => p.y > -0.15;

function conflit(existants: readonly Trajet[], candidat: Trajet, seuil: number): boolean {
  for (const e of existants) {
    const de = Math.max(candidat.debut, e.debut);
    const a = Math.min(candidat.debut + candidat.duree, e.debut + e.duree);
    if (a < de) continue;
    for (let t = de; t <= a + 1e-9; t += 0.05) {
      const p = positionTrajet(candidat, t).p;
      const q = positionTrajet(e, t).p;
      if (!estDansLaPiece(p) && !estDansLaPiece(q)) continue;
      if (Math.hypot(p.x - q.x, p.y - q.y) < seuil) return true;
    }
  }
  return false;
}

/**
 * Planifie un trajet à partir de `demande` : le premier départ (par pas de
 * 0,25 s) qui ne croise aucun trajet existant à moins du seuil.
 */
export function planifier(existants: readonly Trajet[], id: string, points: Point[], demande: number, seuil = SEUIL_COLLISION): Trajet {
  const duree = longueur(points) / VITESSE;
  for (let k = 0; k <= ATTENTE_MAX / 0.25; k++) {
    const candidat = { id, points, debut: demande + k * 0.25, duree };
    if (!conflit(existants, candidat, seuil)) return candidat;
  }
  return { id, points, debut: demande + ATTENTE_MAX, duree };
}

// ------------------------------------------------------------------ simulation

export type Phase = 'attente' | 'arrivee' | 'assis' | 'fete' | 'depart' | 'parti';

/** Durée de la petite fête de fin de session, avant de ranger et repartir (s). */
export const DUREE_FETE = 2.6;

export interface Occupant {
  cle: string;
  poste: number;
  phase: Phase;
  trajet?: Trajet;
  /** Début de la phase (s). */
  depuis: number;
  /** L'agent a quitté la liste : il disparaît (poste libéré) une fois sorti. */
  sortie: boolean;
  /** Session terminée : fête puis repart en arrivant au poste. */
  fini: boolean;
}

export interface EtatScene {
  occupants: Map<string, Occupant>;
  trajets: Trajet[];
  /** Première réconciliation faite (ceux déjà là sont assis d'emblée). */
  pret: boolean;
}

export const creerScene = (): EtatScene => ({ occupants: new Map(), trajets: [], pret: false });

function lancerDepart(s: EtatScene, o: Occupant, t: number): void {
  const tr = planifier(s.trajets, `${o.cle}>`, cheminDepart(POSTES[o.poste]), t);
  s.trajets.push(tr);
  o.trajet = tr;
  o.phase = 'depart';
  o.depuis = t;
}

/** Fait avancer les phases jusqu'à l'instant `t` ; vrai si quelque chose a changé. */
export function avancer(s: EtatScene, t: number): boolean {
  let change = false;
  for (const o of [...s.occupants.values()]) {
    if (o.phase === 'attente' && o.trajet && t >= o.trajet.debut) {
      o.phase = 'arrivee';
      change = true;
    }
    if (o.phase === 'arrivee' && o.trajet && t >= o.trajet.debut + o.trajet.duree) {
      const fin = o.trajet.debut + o.trajet.duree;
      o.trajet = undefined;
      o.depuis = fin;
      if (o.sortie) lancerDepart(s, o, fin);
      else o.phase = o.fini ? 'fete' : 'assis';
      change = true;
    }
    if (o.phase === 'fete' && t >= o.depuis + DUREE_FETE) {
      lancerDepart(s, o, o.depuis + DUREE_FETE);
      change = true;
    }
    if (o.phase === 'depart' && o.trajet && t >= o.trajet.debut + o.trajet.duree) {
      if (o.sortie) s.occupants.delete(o.cle);
      else {
        o.phase = 'parti';
        o.depuis = o.trajet.debut + o.trajet.duree;
        o.trajet = undefined;
      }
      change = true;
    }
  }
  const avant = s.trajets.length;
  s.trajets = s.trajets.filter(tr => tr.debut + tr.duree > t - 1);
  return change || avant !== s.trajets.length;
}

/**
 * Met la scène en accord avec la liste des agents à l'instant `t` (secondes).
 * Sans animation (`anime` faux) : tout le monde est d'emblée à sa place.
 */
export function reconcilier(
  s: EtatScene,
  agents: ReadonlyArray<Pick<Agent, 'cle' | 'etat'>>,
  t: number,
  o: { anime: boolean },
): void {
  const presents = new Map(agents.map(a => [a.cle, a.etat] as const));
  const direct = !o.anime || !s.pret;
  if (!o.anime) {
    // Sans animation : personne ne marche.
    for (const occ of [...s.occupants.values()]) {
      if (occ.phase === 'attente' || occ.phase === 'arrivee') occ.phase = 'assis';
      if (occ.phase === 'fete' || occ.phase === 'depart') {
        if (occ.sortie) s.occupants.delete(occ.cle);
        else occ.phase = 'parti';
      }
      occ.trajet = undefined;
    }
    s.trajets = [];
  } else avancer(s, t);

  // Partis de la liste.
  for (const occ of [...s.occupants.values()]) {
    if (presents.has(occ.cle)) continue;
    if (direct || occ.phase === 'parti' || occ.phase === 'attente') {
      s.occupants.delete(occ.cle);
      s.trajets = s.trajets.filter(tr => !tr.id.startsWith(`${occ.cle}<`));
    } else if (occ.phase === 'assis') {
      occ.sortie = true;
      lancerDepart(s, occ, t);
    } else occ.sortie = true; // arrive, fête ou repart déjà : disparaîtra en sortant
  }

  // Changements d'état des présents.
  for (const [cle, etat] of presents) {
    const occ = s.occupants.get(cle);
    if (!occ) continue;
    occ.sortie = false;
    occ.fini = etat === 'termine';
    if (occ.fini) {
      if (occ.phase === 'assis') {
        occ.phase = direct ? 'parti' : 'fete';
        occ.depuis = t;
      }
    } else if (occ.phase === 'parti') {
      // Session reprise : retour au poste.
      if (direct) occ.phase = 'assis';
      else {
        const tr = planifier(s.trajets, `${cle}<`, cheminArrivee(POSTES[occ.poste]), t);
        s.trajets.push(tr);
        Object.assign(occ, { phase: t >= tr.debut ? 'arrivee' : 'attente', trajet: tr, depuis: t });
      }
    }
  }

  // Nouveaux venus (ordre des clés : placement déterministe).
  const occupes = new Set([...s.occupants.values()].map(x => x.poste));
  for (const cle of [...presents.keys()].sort()) {
    if (s.occupants.has(cle)) continue;
    const poste = choisirPoste(cle, occupes);
    if (poste === undefined) continue;
    occupes.add(poste);
    const termine = presents.get(cle) === 'termine';
    if (direct || termine) {
      s.occupants.set(cle, { cle, poste, phase: termine ? 'parti' : 'assis', depuis: t, sortie: false, fini: termine });
      continue;
    }
    const tr = planifier(s.trajets, `${cle}<`, cheminArrivee(POSTES[poste]), t);
    s.trajets.push(tr);
    s.occupants.set(cle, { cle, poste, phase: t >= tr.debut ? 'arrivee' : 'attente', trajet: tr, depuis: t, sortie: false, fini: false });
  }
  s.pret = true;
}

export type ModePose = 'assis' | 'marche' | 'range' | 'fete';

export interface Pose {
  cle: string;
  poste: number;
  mode: ModePose;
  x: number;
  y: number;
  /** « face » : on voit le visage ; « dos » : on voit le dos. */
  vue: 'face' | 'dos';
  /** Retourné horizontalement (le dessin de base regarde vers la droite). */
  miroir: boolean;
  opacite: number;
}

/** Vue selon la direction de marche au sol. */
export function vueDepuis(dir: Point): { vue: 'face' | 'dos'; miroir: boolean } {
  if (Math.abs(dir.x) >= Math.abs(dir.y)) return dir.x >= 0 ? { vue: 'face', miroir: false } : { vue: 'dos', miroir: true };
  return dir.y >= 0 ? { vue: 'face', miroir: true } : { vue: 'dos', miroir: false };
}

/** Vue d'un agent assis : rangée du fond face à nous, rangée de devant de dos (on voit son écran). */
export const vueAssis = (p: Poste): { vue: 'face' | 'dos'; miroir: boolean } => (p.rangee === 0 ? { vue: 'face', miroir: true } : { vue: 'dos', miroir: false });

/** Personnages à dessiner à l'instant `t` (ceux qui attendent dehors ou sont partis n'en font pas partie). */
export function poses(s: EtatScene, t: number): Pose[] {
  const res: Pose[] = [];
  for (const o of s.occupants.values()) {
    const poste = POSTES[o.poste];
    if (o.phase === 'attente' || o.phase === 'parti') continue;
    const marche = (o.phase === 'arrivee' || o.phase === 'depart') && o.trajet && t >= o.trajet.debut;
    if (marche && o.trajet) {
      const { p, dir } = positionTrajet(o.trajet, t);
      if (!estDansLaPiece(p)) continue;
      res.push({ cle: o.cle, poste: o.poste, mode: 'marche', x: p.x, y: p.y, ...vueDepuis(dir), opacite: Math.min(1, (p.y + 0.15) / 0.8) });
      continue;
    }
    res.push({
      cle: o.cle,
      poste: o.poste,
      mode: o.phase === 'fete' ? 'fete' : o.phase === 'depart' ? 'range' : 'assis',
      x: poste.siege.x,
      y: poste.siege.y,
      ...vueAssis(poste),
      opacite: 1,
    });
  }
  return res;
}

/** Nombre d'arrivées qui patientent à l'entrée. */
export const enAttente = (s: EtatScene): number => [...s.occupants.values()].filter(o => o.phase === 'attente').length;

/** Plus petite distance entre deux marcheurs visibles, échantillonnée (tests, diagnostic). */
export function distanceMinimale(trajets: readonly Trajet[], pas = 0.02): number {
  let min = Infinity;
  for (let i = 0; i < trajets.length; i++) {
    for (let j = i + 1; j < trajets.length; j++) {
      const a = trajets[i];
      const b = trajets[j];
      const de = Math.max(a.debut, b.debut);
      const fin = Math.min(a.debut + a.duree, b.debut + b.duree);
      for (let t = de; t <= fin; t += pas) {
        const p = positionTrajet(a, t).p;
        const q = positionTrajet(b, t).p;
        if (!estDansLaPiece(p) && !estDansLaPiece(q)) continue;
        min = Math.min(min, Math.hypot(p.x - q.x, p.y - q.y));
      }
    }
  }
  return min;
}

// ------------------------------------------------------------------ projection isométrique

/** Demi-largeur et demi-hauteur d'une dalle, hauteur d'une unité verticale (px logiques). */
export const ISO = { dx: 32, dy: 16, dz: 32, ox: 14 * 32 + 40, oy: 128 } as const;
export const LARGEUR_SCENE = (LARGEUR_PIECE + PROFONDEUR_PIECE) * ISO.dx + 80;
export const HAUTEUR_SCENE = (LARGEUR_PIECE + PROFONDEUR_PIECE) * ISO.dy + ISO.oy + 46;

/** Point du monde (x, y au sol, z en hauteur) → point de l'écran. */
export function iso(x: number, y: number, z = 0): Point {
  return { x: (x - y) * ISO.dx + ISO.ox, y: (x + y) * ISO.dy - z * ISO.dz + ISO.oy };
}

/** Profondeur pour l'ordre de dessin (plus grand = plus devant). */
export const profondeur = (x: number, y: number): number => x + y;

// ------------------------------------------------------------------ démo

const DEMANDES_DEMO = [
  'Ajoute un export CSV des dépenses du mois',
  'Pourquoi ce test échoue-t-il seulement le lundi ?',
  'Rends le formulaire d’inscription accessible au clavier',
  'Cherche où sont lus les réglages de la météo',
  'Écris la documentation du nouveau module',
  'Optimise le chargement des images de la galerie',
  'Corrige l’arrondi des totaux dans le panier',
  'Ajoute un mode sombre à la page d’accueil',
  'Explique-moi ce que fait ce script de migration',
  'Prépare une version mobile du tableau de bord',
] as const;
const PROJETS_DEMO = ['boutique', 'api-meteo', 'carnet', 'jardin', 'atelier'] as const;
const VISITEURS_DEMO = ['site-vitrine', 'quiz', 'agenda'] as const;
/** Script d'une session « résidente » : [seconde du cycle, type, outil]. */
const SCRIPT_DEMO: ReadonlyArray<readonly [number, string, string?, string?]> = [
  [0, 'demande'],
  [4, 'outil', 'Read', 'src/index.ts'],
  [9, 'outil', 'Grep', 'réglages'],
  [14, 'outil', 'Edit', 'src/module.ts'],
  [20, 'outil', 'Write', 'src/nouveau.ts'],
  [26, 'outil', 'Bash', 'npm test'],
  [33, 'outil', 'WebFetch', 'documentation'],
  [39, 'outil', 'Edit', 'src/module.ts'],
  [45, 'outil', 'Task', 'vérification'],
  [51, 'fin-reponse'],
];
export const CYCLE_DEMO = 74;
const PERIODE_VISITEUR = 38;

/**
 * Entrées fictives du mode « démo » à l'instant `maintenant` (ms), la démo
 * ayant commencé à `debut` (ms). Cinq sessions résidentes arrivent l'une
 * après l'autre puis enchaînent demandes, outils et pauses ; des visiteurs
 * passent, travaillent, terminent (fête, rangement) et repartent.
 */
export function entreesDemo(debut: number, maintenant: number): EntreeHistorique[] {
  const res: EntreeHistorique[] = [];
  const ecoule = (maintenant - debut) / 1000;
  const ev = (session: string, projet: string, s: number, type: string, extra: Partial<EntreeHistorique> = {}) => {
    if (s > ecoule) return;
    res.push({
      v: 1, id: `demo-${session}-${s.toFixed(2)}-${type}`, ts: new Date(debut + s * 1000).toISOString(), type,
      appareil: 'PC de démo', appareilId: 'demo00000000', session, projet, dossier: `/demo/${projet}`, ...extra,
    });
  };
  PROJETS_DEMO.forEach((projet, r) => {
    const session = `demo-${projet}`;
    const arrivee = 1 + r * 2.2;
    ev(session, projet, arrivee, 'debut-session');
    const decalage = arrivee + 1 + r * 9;
    const cycleCourant = Math.max(0, Math.floor((ecoule - decalage) / CYCLE_DEMO));
    for (let c = Math.max(0, cycleCourant - 1); c <= cycleCourant; c++) {
      for (const [s, type, outil, resume] of SCRIPT_DEMO) {
        const quand = decalage + c * CYCLE_DEMO + s;
        ev(session, projet, quand, type, type === 'demande'
          ? { texte: DEMANDES_DEMO[(r * 3 + c) % DEMANDES_DEMO.length] }
          : outil ? { outil, resume } : {});
      }
    }
  });
  // Visiteurs : arrivent, travaillent 24 s, terminent, puis quittent la liste.
  const dernier = Math.floor((ecoule - 14) / PERIODE_VISITEUR);
  for (let k = Math.max(0, dernier - 1); k <= dernier; k++) {
    const a = 14 + k * PERIODE_VISITEUR;
    if (ecoule > a + 24 + 16) continue;
    const projet = VISITEURS_DEMO[k % VISITEURS_DEMO.length];
    const session = `demo-visiteur-${k}`;
    ev(session, projet, a, 'debut-session');
    ev(session, projet, a + 1, 'demande', { texte: DEMANDES_DEMO[(k * 7 + 5) % DEMANDES_DEMO.length] });
    ev(session, projet, a + 5, 'outil', { outil: 'Glob', resume: '**/*.css' });
    ev(session, projet, a + 10, 'outil', { outil: 'Edit', resume: 'styles.css' });
    ev(session, projet, a + 16, 'outil', { outil: 'Bash', resume: 'npm run build' });
    ev(session, projet, a + 24, 'fin-session');
  }
  return res;
}

/** Les agents de la liste, réduits à ce que la scène doit savoir (pour comparer deux rendus). */
export const signatureAgents = (agents: ReadonlyArray<Pick<Agent, 'cle' | 'etat'>>): string => agents.map(a => `${a.cle}:${a.etat}`).join('|');

export type { EtatAgent };
