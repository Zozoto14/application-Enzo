/**
 * Modèle de document de l'éditeur de strats (pur, testé) : types, actions,
 * annuler / rétablir, étapes, sérialisation et migration de version, zoom.
 *
 * Miroir de esport/noyau/strats/document.mjs : le serveur revalide tout
 * document reçu (bornes, images autorisées) ; ici on garde le document
 * toujours dans la forme que le serveur accepte. Repère : carré de 1000.
 */

export const FORMAT_STRAT = 'esport-strat';
export const VERSION_DOCUMENT = 2;
export const TAILLE_MAX_DOCUMENT = 256 * 1024;
export const ETAPES_MAX = 20;
export const OBJETS_MAX = 250;
export const LIMITE_HISTORIQUE = 100;
export const COULEURS_JOUEURS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7'];
/** Couleurs libres de la palette (en plus de celles des joueurs). */
export const COULEURS_LIBRES = ['#ffffff', '#f97316', '#06b6d4', '#ec4899', '#111827'];

export type Side = 'attaque' | 'defense';
export type TypeStrat = 'default' | 'execute' | 'eco' | 'pistol' | 'retake' | 'other';
export type Calque = 'fond' | 'utilitaires' | 'dessins' | 'texte';
export const CALQUES: readonly Calque[] = ['fond', 'utilitaires', 'dessins', 'texte'];

export interface Carte {
  cle: string;
  nom: string;
  image: string | null;
}
export interface JoueurStrat {
  nom: string;
  couleur: string;
  agent: string | null;
}
export type Zone =
  | { forme: 'cercle'; rayon: number }
  | { forme: 'mur'; dx: number; dy: number; epaisseur: number }
  | { forme: 'cone'; rayon: number; angle: number; ouverture: number };
export type FormeZone = Zone['forme'];

interface Base {
  id: string;
}
export interface ObjetAgent extends Base {
  type: 'agent';
  x: number;
  y: number;
  agent: string;
  nom: string;
  icone: string | null;
  joueur: number | null;
  couleur: string;
}
export interface ObjetCapacite extends Base {
  type: 'capacite';
  x: number;
  y: number;
  agent: string;
  capacite: string;
  nom: string;
  icone: string | null;
  joueur: number | null;
  couleur: string;
  zone: Zone | null;
}
export interface ObjetTrace extends Base {
  type: 'fleche' | 'ligne';
  points: number[];
  couleur: string;
  epaisseur: number;
  tirets: boolean;
}
export interface ObjetForme extends Base {
  type: 'forme';
  forme: 'rect' | 'ellipse';
  x: number;
  y: number;
  l: number;
  h: number;
  couleur: string;
  remplie: boolean;
}
export interface ObjetTexte extends Base {
  type: 'texte';
  x: number;
  y: number;
  texte: string;
  couleur: string;
  taille: number;
}
export type ObjetStrat = ObjetAgent | ObjetCapacite | ObjetTrace | ObjetForme | ObjetTexte;
/** Champs modifiables d'un objet (sans changer son type ni son identifiant). */
export type ChampsObjet = Partial<Omit<ObjetAgent, 'type' | 'id'>> &
  Partial<Omit<ObjetCapacite, 'type' | 'id'>> &
  Partial<Omit<ObjetTrace, 'type' | 'id'>> &
  Partial<Omit<ObjetForme, 'type' | 'id'>> &
  Partial<Omit<ObjetTexte, 'type' | 'id'>>;

export interface Etape {
  id: string;
  titre: string;
  note: string;
  objets: ObjetStrat[];
}
export interface DocumentStrat {
  format: typeof FORMAT_STRAT;
  version: typeof VERSION_DOCUMENT;
  jeu: 'valorant' | 'autre';
  carte: Carte;
  side: Side;
  joueurs: JoueurStrat[];
  calques: Record<Calque, { visible: boolean; verrou: boolean }>;
  etapes: Etape[];
}

/** Calque d'un objet (déduit de son type). */
export function calqueDe(o: ObjetStrat): Calque {
  if (o.type === 'agent' || o.type === 'capacite') return 'utilitaires';
  if (o.type === 'texte') return 'texte';
  return 'dessins';
}

const calquesParDefaut = (): DocumentStrat['calques'] => ({
  fond: { visible: true, verrou: false },
  utilitaires: { visible: true, verrou: false },
  dessins: { visible: true, verrou: false },
  texte: { visible: true, verrou: false },
});

export function documentVide(carte: Carte, side: Side = 'attaque', jeu: DocumentStrat['jeu'] = 'valorant'): DocumentStrat {
  return {
    format: FORMAT_STRAT,
    version: VERSION_DOCUMENT,
    jeu,
    carte,
    side,
    joueurs: COULEURS_JOUEURS.map((couleur, i) => ({ nom: `Joueur ${i + 1}`, couleur, agent: null })),
    calques: calquesParDefaut(),
    etapes: [{ id: 'e1', titre: 'Étape 1', note: '', objets: [] }],
  };
}

// ------------------------------------------------------------------ Identifiants

let compteur = 0;
/** Identifiant court, unique dans `existants`. */
export function idUnique(existants: Iterable<string>, prefixe = 'o'): string {
  const pris = new Set(existants);
  for (;;) {
    compteur = (compteur + 1) % 1_000_000;
    const id = `${prefixe}${Date.now().toString(36).slice(-4)}${compteur.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`.slice(0, 24);
    if (!pris.has(id)) return id;
  }
}

const idsObjets = (d: DocumentStrat) => d.etapes.flatMap(e => e.objets.map(o => o.id));

// ------------------------------------------------------------------ Actions (réducteur pur)

export type Action =
  | { type: 'ajouter'; etape: number; objet: ObjetStrat }
  | { type: 'modifier'; etape: number; id: string; champs: ChampsObjet }
  | { type: 'deplacer'; etape: number; id: string; dx: number; dy: number }
  | { type: 'supprimer'; etape: number; id: string }
  | { type: 'vider'; etape: number }
  | { type: 'ajouterEtape'; apres: number }
  | { type: 'dupliquerEtape'; etape: number }
  | { type: 'supprimerEtape'; etape: number }
  | { type: 'deplacerEtape'; de: number; vers: number }
  | { type: 'titreEtape'; etape: number; titre: string }
  | { type: 'noteEtape'; etape: number; note: string }
  | { type: 'carte'; carte: Carte }
  | { type: 'side'; side: Side }
  | { type: 'joueur'; index: number; champs: Partial<JoueurStrat> }
  | { type: 'calque'; calque: Calque; champs: Partial<{ visible: boolean; verrou: boolean }> }
  /** Remplace tout le document (restauration d'une ancienne version : annulable). */
  | { type: 'remplacer'; document: DocumentStrat };

const borne = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const arrondi = (n: number) => Math.round(n * 10) / 10;

function majEtape(d: DocumentStrat, i: number, f: (e: Etape) => Etape): DocumentStrat {
  if (!d.etapes[i]) return d;
  const etapes = d.etapes.slice();
  etapes[i] = f(etapes[i]);
  return { ...d, etapes };
}

function deplacerObjet(o: ObjetStrat, dx: number, dy: number): ObjetStrat {
  if ('points' in o) return { ...o, points: o.points.map((p, i) => arrondi(borne(p + (i % 2 === 0 ? dx : dy), -500, 1500))) };
  return { ...o, x: arrondi(borne(o.x + dx, -500, 1500)), y: arrondi(borne(o.y + dy, -500, 1500)) };
}

/**
 * Applique une action. Rend le MÊME document si rien ne change (l'historique
 * ne garde alors aucune entrée vide). Les limites (étapes, objets) sont
 * celles du serveur.
 */
export function appliquer(d: DocumentStrat, a: Action): DocumentStrat {
  switch (a.type) {
    case 'ajouter': {
      const e = d.etapes[a.etape];
      if (!e || e.objets.length >= OBJETS_MAX || idsObjets(d).includes(a.objet.id)) return d;
      if (d.calques[calqueDe(a.objet)].verrou) return d;
      return majEtape(d, a.etape, x => ({ ...x, objets: [...x.objets, a.objet] }));
    }
    case 'modifier':
    case 'deplacer':
    case 'supprimer': {
      const e = d.etapes[a.etape];
      const o = e?.objets.find(x => x.id === a.id);
      if (!e || !o || d.calques[calqueDe(o)].verrou) return d;
      if (a.type === 'supprimer') return majEtape(d, a.etape, x => ({ ...x, objets: x.objets.filter(y => y.id !== a.id) }));
      if (a.type === 'deplacer' && a.dx === 0 && a.dy === 0) return d;
      const nouveau = a.type === 'deplacer' ? deplacerObjet(o, a.dx, a.dy) : ({ ...o, ...a.champs, id: o.id, type: o.type } as ObjetStrat);
      return majEtape(d, a.etape, x => ({ ...x, objets: x.objets.map(y => (y.id === a.id ? nouveau : y)) }));
    }
    case 'vider': {
      const e = d.etapes[a.etape];
      if (!e || e.objets.length === 0) return d;
      return majEtape(d, a.etape, x => ({ ...x, objets: x.objets.filter(o => d.calques[calqueDe(o)].verrou) }));
    }
    case 'ajouterEtape': {
      if (d.etapes.length >= ETAPES_MAX) return d;
      const id = idUnique(d.etapes.map(e => e.id), 'e');
      const etapes = d.etapes.slice();
      etapes.splice(borne(a.apres + 1, 0, etapes.length), 0, { id, titre: `Étape ${d.etapes.length + 1}`, note: '', objets: [] });
      return { ...d, etapes };
    }
    case 'dupliquerEtape': {
      const source = d.etapes[a.etape];
      if (!source || d.etapes.length >= ETAPES_MAX) return d;
      const pris = new Set(idsObjets(d));
      // Les objets copiés gardent leur place mais reçoivent de nouveaux identifiants.
      const objets = source.objets.map(o => {
        const id = idUnique(pris);
        pris.add(id);
        return { ...o, id };
      });
      const etapes = d.etapes.slice();
      etapes.splice(a.etape + 1, 0, { id: idUnique(d.etapes.map(e => e.id), 'e'), titre: `${source.titre} (suite)`.slice(0, 60), note: source.note, objets });
      return { ...d, etapes };
    }
    case 'supprimerEtape': {
      if (d.etapes.length <= 1 || !d.etapes[a.etape]) return d;
      return { ...d, etapes: d.etapes.filter((_, i) => i !== a.etape) };
    }
    case 'deplacerEtape': {
      if (a.de === a.vers || !d.etapes[a.de] || !d.etapes[a.vers]) return d;
      const etapes = d.etapes.slice();
      const [e] = etapes.splice(a.de, 1);
      etapes.splice(a.vers, 0, e);
      return { ...d, etapes };
    }
    case 'titreEtape':
      return d.etapes[a.etape]?.titre === a.titre ? d : majEtape(d, a.etape, e => ({ ...e, titre: a.titre.slice(0, 60) }));
    case 'noteEtape':
      return d.etapes[a.etape]?.note === a.note ? d : majEtape(d, a.etape, e => ({ ...e, note: a.note.slice(0, 2000) }));
    case 'carte':
      return d.carte.cle === a.carte.cle && d.carte.image === a.carte.image ? d : { ...d, carte: a.carte };
    case 'side':
      return d.side === a.side ? d : { ...d, side: a.side };
    case 'joueur': {
      if (!d.joueurs[a.index]) return d;
      const joueurs = d.joueurs.slice();
      joueurs[a.index] = { ...joueurs[a.index], ...a.champs };
      // La couleur d'un joueur suit ses agents et capacités déjà posés.
      const couleur = a.champs.couleur;
      const recolorer = (o: ObjetStrat): ObjetStrat => ((o.type === 'agent' || o.type === 'capacite') && o.joueur === a.index && couleur ? { ...o, couleur } : o);
      return { ...d, joueurs, etapes: couleur ? d.etapes.map(e => ({ ...e, objets: e.objets.map(recolorer) })) : d.etapes };
    }
    case 'remplacer':
      return a.document === d ? d : a.document;
    case 'calque': {
      const avant = d.calques[a.calque];
      const apres = { ...avant, ...a.champs };
      if (avant.visible === apres.visible && avant.verrou === apres.verrou) return d;
      return { ...d, calques: { ...d.calques, [a.calque]: apres } };
    }
  }
}

// ------------------------------------------------------------------ Annuler / rétablir

export interface Historique {
  passe: DocumentStrat[];
  present: DocumentStrat;
  futur: DocumentStrat[];
}

export const historique = (present: DocumentStrat): Historique => ({ passe: [], present, futur: [] });

/** Exécute une action : l'état précédent part dans le passé (100 au plus), le futur est oublié. */
export function executer(h: Historique, a: Action): Historique {
  const present = appliquer(h.present, a);
  if (present === h.present) return h;
  return { passe: [...h.passe, h.present].slice(-LIMITE_HISTORIQUE), present, futur: [] };
}

export function annuler(h: Historique): Historique {
  if (h.passe.length === 0) return h;
  return { passe: h.passe.slice(0, -1), present: h.passe[h.passe.length - 1], futur: [h.present, ...h.futur] };
}

export function retablir(h: Historique): Historique {
  if (h.futur.length === 0) return h;
  return { passe: [...h.passe, h.present], present: h.futur[0], futur: h.futur.slice(1) };
}

// ------------------------------------------------------------------ Sérialisation et migration

export class ErreurDocument extends Error {}

/** Document version 1 (première ébauche : une seule « frame ») → version 2. */
function migrerV1(v: Record<string, unknown>): Record<string, unknown> {
  const carte = typeof v.carte === 'string' ? { cle: v.carte, nom: v.carte, image: null } : v.carte;
  return {
    format: FORMAT_STRAT,
    version: 2,
    jeu: v.jeu ?? 'valorant',
    carte,
    side: v.side,
    joueurs: COULEURS_JOUEURS.map((couleur, i) => ({ nom: `Joueur ${i + 1}`, couleur, agent: null })),
    calques: calquesParDefaut(),
    etapes: [{ id: 'e1', titre: 'Étape 1', note: typeof v.notes === 'string' ? v.notes : '', objets: Array.isArray(v.objets) ? v.objets : [] }],
  };
}

/**
 * Lit un document (texte JSON ou objet), de n'importe quelle version connue,
 * et le rend à la version courante. Lève `ErreurDocument` s'il est illisible
 * ou vient d'une version plus récente de l'app.
 */
export function lireDocument(source: string | unknown): DocumentStrat {
  let v: unknown = source;
  if (typeof source === 'string') {
    try {
      v = JSON.parse(source);
    } catch {
      throw new ErreurDocument('Strat illisible (JSON).');
    }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ErreurDocument('Strat illisible.');
  let d = v as Record<string, unknown>;
  const version = (d.version as number | undefined) ?? 1;
  if (!Number.isInteger(version) || version < 1) throw new ErreurDocument('Version de strat illisible.');
  if (version > VERSION_DOCUMENT) throw new ErreurDocument('Cette strat vient d’une version plus récente de l’app : mettez l’app à jour.');
  if (version === 1) d = migrerV1(d);
  const carte = d.carte as Carte | undefined;
  if (!carte || typeof carte.cle !== 'string') throw new ErreurDocument('Strat sans carte.');
  if (!Array.isArray(d.etapes) || d.etapes.length === 0) throw new ErreurDocument('Strat sans étape.');
  const calques = calquesParDefaut();
  const brut = (d.calques ?? {}) as Partial<DocumentStrat['calques']>;
  for (const c of CALQUES) calques[c] = { visible: brut[c]?.visible !== false, verrou: brut[c]?.verrou === true };
  return {
    format: FORMAT_STRAT,
    version: VERSION_DOCUMENT,
    jeu: d.jeu === 'autre' ? 'autre' : 'valorant',
    carte: { cle: carte.cle, nom: carte.nom ?? carte.cle, image: carte.image ?? null },
    side: d.side === 'defense' ? 'defense' : 'attaque',
    joueurs: Array.isArray(d.joueurs) && d.joueurs.length > 0 ? (d.joueurs as JoueurStrat[]) : documentVide(carte).joueurs,
    calques,
    etapes: d.etapes as Etape[],
  };
}

export const serialiser = (d: DocumentStrat): string => JSON.stringify(d);

/** Taille du document sérialisé (octets UTF-8) : le serveur refuse au-delà de 256 Ko. */
export function tailleDocument(d: DocumentStrat): number {
  return octetsUtf8(serialiser(d));
}

/** Longueur UTF-8 d'un texte (sans TextEncoder, absent de certains moteurs). */
export function octetsUtf8(texte: string): number {
  let n = 0;
  for (const c of texte) {
    const p = c.codePointAt(0) as number;
    n += p < 0x80 ? 1 : p < 0x800 ? 2 : p < 0x10000 ? 3 : 4;
  }
  return n;
}

// ------------------------------------------------------------------ Fabriques d'objets

/** Zone par défaut d'une capacité, selon la forme choisie (null : icône seule). */
export function zoneParDefaut(forme: FormeZone | 'aucune'): Zone | null {
  if (forme === 'cercle') return { forme: 'cercle', rayon: 40 };
  if (forme === 'mur') return { forme: 'mur', dx: 120, dy: 0, epaisseur: 8 };
  if (forme === 'cone') return { forme: 'cone', rayon: 150, angle: -90, ouverture: 60 };
  return null;
}

/** Couleur d'un joueur (repli : blanc). */
export const couleurJoueur = (d: DocumentStrat, joueur: number | null): string => (joueur !== null && d.joueurs[joueur]?.couleur) || '#ffffff';

// ------------------------------------------------------------------ Vue : zoom et déplacement

export interface Vue {
  echelle: number;
  x: number;
  y: number;
}
export const VUE_INITIALE: Vue = { echelle: 1, x: 0, y: 0 };
export const ECHELLE_MIN = 0.5;
export const ECHELLE_MAX = 4;

/**
 * Zoom autour d'un point de l'écran (molette, pincement, boutons) : le point
 * sous le curseur reste sous le curseur.
 */
export function zoomer(vue: Vue, facteur: number, centre: { x: number; y: number }): Vue {
  const echelle = borne(vue.echelle * facteur, ECHELLE_MIN, ECHELLE_MAX);
  const k = echelle / vue.echelle;
  return { echelle, x: centre.x - (centre.x - vue.x) * k, y: centre.y - (centre.y - vue.y) * k };
}
