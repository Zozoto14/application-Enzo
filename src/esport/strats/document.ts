/**
 * Modèle de document de l'éditeur de strats (pur, testé) : types, actions,
 * annuler / rétablir, étapes, sérialisation et migration de version, zoom.
 *
 * Miroir de esport/noyau/strats/document.mjs : le serveur revalide tout
 * document reçu (bornes, images autorisées) ; ici on garde le document
 * toujours dans la forme que le serveur accepte. Repère : carré de 1000.
 *
 * Version 3 : modèle de strat du jeu (valorant, thefinals, generique), zones
 * des capacités EN MÈTRES (dessinées avec l'échelle de la map), phases et
 * durées des étapes, économie du round, ordre et minutage des utilitaires,
 * trajets minutés des joueurs, cônes de vision, marqueurs, étages.
 */

import { tr } from '../i18n';
import { ECHELLE_DEFAUT, MODELES, modeleDuJeu, type Economie, type GenreMarqueur, type ModeleStrat } from './modeles';

export const FORMAT_STRAT = 'esport-strat';
export const VERSION_DOCUMENT = 3;
export const TAILLE_MAX_DOCUMENT = 384 * 1024;
export const ETAPES_MAX = 30;
export const OBJETS_MAX = 250;
export const LIMITE_HISTORIQUE = 100;
export const DUREE_ETAPE_DEFAUT = 5;
export const COULEURS_JOUEURS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316', '#06b6d4', '#ec4899', '#84cc16', '#f43f5e'];
/** Couleurs libres de la palette (en plus de celles des joueurs). */
export const COULEURS_LIBRES = ['#ffffff', '#f97316', '#06b6d4', '#ec4899', '#111827'];

export type Side = 'attaque' | 'defense';
export type TypeStrat = 'default' | 'execute' | 'eco' | 'pistol' | 'retake' | 'other';
export type Calque = 'fond' | 'callouts' | 'utilitaires' | 'vision' | 'marqueurs' | 'dessins' | 'texte';
export const CALQUES: readonly Calque[] = ['fond', 'callouts', 'utilitaires', 'vision', 'marqueurs', 'dessins', 'texte'];

export interface Carte {
  cle: string;
  nom: string;
  image: string | null;
  /** Instantané de l'échelle de la map (unités par mètre) au dernier enregistrement (page de partage). */
  echelle?: number | null;
}
export interface JoueurStrat {
  nom: string;
  couleur: string;
  agent: string | null;
  role?: string | null;
  compte?: string | null;
}
/** Zone d'une capacité : dimensions en MÈTRES ; `trajet` : origine du lancer (unités du repère, relative). */
export type Zone =
  | { forme: 'cercle'; rayon: number }
  | { forme: 'mur'; angle: number; longueur: number; largeur: number; courbure: number }
  | { forme: 'cone'; angle: number; ouverture: number; portee: number }
  | { forme: 'trajet'; dx: number; dy: number; rayon: number }
  | { forme: 'ligne'; angle: number; longueur: number }
  | { forme: 'rect'; angle: number; longueur: number; largeur: number };
export type FormeZone = Zone['forme'];
export const FORMES_ZONE: readonly FormeZone[] = ['cercle', 'mur', 'cone', 'trajet', 'ligne', 'rect'];

interface Base {
  id: string;
  /** Étage (The Finals, maps à niveaux). */
  niveau?: number | null;
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
  /** Regard (degrés), facultatif. */
  angle?: number | null;
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
  /** Ordre des utilitaires (1, 2, 3…). */
  ordre?: number | null;
  /** Moment du lancer dans l'étape (secondes). */
  t?: number | null;
}
export interface ObjetTrace extends Base {
  type: 'fleche' | 'ligne';
  points: number[];
  couleur: string;
  epaisseur: number;
  tirets: boolean;
  /** Trajet d'un joueur (lecture animée), avec son minutage dans l'étape. */
  joueur?: number | null;
  t0?: number | null;
  t1?: number | null;
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
export interface ObjetMarqueur extends Base {
  type: 'marqueur';
  x: number;
  y: number;
  genre: GenreMarqueur;
  etiquette: string;
  couleur: string;
  /** Équipe adverse (The Finals : 1 à 3). */
  equipe?: number | null;
}
export interface ObjetVision extends Base {
  type: 'vision';
  x: number;
  y: number;
  angle: number;
  ouverture: number;
  /** Portée en mètres. */
  portee: number;
  joueur: number | null;
  couleur: string;
}
export type ObjetStrat = ObjetAgent | ObjetCapacite | ObjetTrace | ObjetForme | ObjetTexte | ObjetMarqueur | ObjetVision;
/** Champs modifiables d'un objet (sans changer son type ni son identifiant). */
export type ChampsObjet = Partial<Omit<ObjetAgent, 'type' | 'id'>> &
  Partial<Omit<ObjetCapacite, 'type' | 'id'>> &
  Partial<Omit<ObjetTrace, 'type' | 'id'>> &
  Partial<Omit<ObjetForme, 'type' | 'id'>> &
  Partial<Omit<ObjetTexte, 'type' | 'id'>> &
  Partial<Omit<ObjetMarqueur, 'type' | 'id'>> &
  Partial<Omit<ObjetVision, 'type' | 'id'>>;

export interface Etape {
  id: string;
  titre: string;
  note: string;
  /** Phase du modèle (Valorant : setup, execute, post-plant, retake…), facultative. */
  phase?: string | null;
  /** Durée en secondes (lecture animée). */
  duree?: number;
  objets: ObjetStrat[];
}
export interface DocumentStrat {
  format: typeof FORMAT_STRAT;
  version: typeof VERSION_DOCUMENT;
  /** Clé du jeu de la team (profil de jeu). */
  jeu: string;
  modele: ModeleStrat;
  carte: Carte;
  side: Side;
  economie?: Economie | null;
  joueurs: JoueurStrat[];
  calques: Record<Calque, { visible: boolean; verrou: boolean }>;
  etapes: Etape[];
}

/** Calque d'un objet (déduit de son type). */
export function calqueDe(o: ObjetStrat): Calque {
  if (o.type === 'agent' || o.type === 'capacite') return 'utilitaires';
  if (o.type === 'texte') return 'texte';
  if (o.type === 'vision') return 'vision';
  if (o.type === 'marqueur') return 'marqueurs';
  return 'dessins';
}

const calquesParDefaut = (): DocumentStrat['calques'] => Object.fromEntries(CALQUES.map(c => [c, { visible: true, verrou: false }])) as DocumentStrat['calques'];

export function documentVide(carte: Carte, side: Side = 'attaque', jeu = 'valorant', modele?: ModeleStrat, joueurs?: number): DocumentStrat {
  const m = modele ?? modeleDuJeu(null, jeu);
  const n = Math.max(1, Math.min(MODELES[m].joueursMax, joueurs ?? MODELES[m].joueurs));
  return {
    format: FORMAT_STRAT,
    version: VERSION_DOCUMENT,
    jeu,
    modele: m,
    carte,
    side,
    economie: null,
    joueurs: COULEURS_JOUEURS.slice(0, n).map((couleur, i) => ({ nom: tr('strats.document.joueur', { v: i + 1 }), couleur, agent: null })),
    calques: calquesParDefaut(),
    etapes: [{ id: 'e1', titre: tr('strats.document.etape_1'), note: '', phase: null, duree: DUREE_ETAPE_DEFAUT, objets: [] }],
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
  /** Coller plusieurs objets (nouveaux identifiants attribués ici). */
  | { type: 'coller'; etape: number; objets: ObjetStrat[]; decalage?: number }
  | { type: 'modifier'; etape: number; id: string; champs: ChampsObjet }
  | { type: 'deplacer'; etape: number; id: string; dx: number; dy: number }
  | { type: 'supprimer'; etape: number; id: string }
  | { type: 'vider'; etape: number }
  | { type: 'ajouterEtape'; apres: number; phase?: string | null }
  | { type: 'dupliquerEtape'; etape: number }
  | { type: 'supprimerEtape'; etape: number }
  | { type: 'deplacerEtape'; de: number; vers: number }
  | { type: 'titreEtape'; etape: number; titre: string }
  | { type: 'noteEtape'; etape: number; note: string }
  | { type: 'phaseEtape'; etape: number; phase: string | null }
  | { type: 'dureeEtape'; etape: number; duree: number }
  | { type: 'carte'; carte: Carte }
  | { type: 'side'; side: Side }
  | { type: 'economie'; economie: Economie | null }
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
    case 'coller': {
      const e = d.etapes[a.etape];
      if (!e || a.objets.length === 0) return d;
      const pris = new Set(idsObjets(d));
      const place = OBJETS_MAX - e.objets.length;
      const nouveaux = a.objets
        .filter(o => !d.calques[calqueDe(o)].verrou)
        .slice(0, Math.max(0, place))
        .map(o => {
          const id = idUnique(pris);
          pris.add(id);
          return deplacerObjet({ ...o, id }, a.decalage ?? 0, a.decalage ?? 0);
        });
      if (nouveaux.length === 0) return d;
      return majEtape(d, a.etape, x => ({ ...x, objets: [...x.objets, ...nouveaux] }));
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
      if (a.type === 'modifier' && JSON.stringify(nouveau) === JSON.stringify(o)) return d;
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
      const phase = a.phase !== undefined ? a.phase : (d.etapes[a.apres]?.phase ?? null);
      etapes.splice(borne(a.apres + 1, 0, etapes.length), 0, { id, titre: tr('strats.document.etape', { v: d.etapes.length + 1 }), note: '', phase, duree: DUREE_ETAPE_DEFAUT, objets: [] });
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
      etapes.splice(a.etape + 1, 0, {
        id: idUnique(d.etapes.map(e => e.id), 'e'),
        titre: tr('strats.document.suite', { titre: source.titre }).slice(0, 60),
        note: source.note,
        phase: source.phase ?? null,
        duree: source.duree ?? DUREE_ETAPE_DEFAUT,
        objets,
      });
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
    case 'phaseEtape': {
      const e = d.etapes[a.etape];
      if (!e || (e.phase ?? null) === a.phase) return d;
      if (a.phase !== null && !MODELES[d.modele].phases.includes(a.phase)) return d;
      return majEtape(d, a.etape, x => ({ ...x, phase: a.phase }));
    }
    case 'dureeEtape': {
      const duree = arrondi(borne(a.duree, 1, 120));
      return !d.etapes[a.etape] || d.etapes[a.etape].duree === duree ? d : majEtape(d, a.etape, e => ({ ...e, duree }));
    }
    case 'carte':
      return d.carte.cle === a.carte.cle && d.carte.image === a.carte.image && (d.carte.echelle ?? null) === (a.carte.echelle ?? null) ? d : { ...d, carte: a.carte };
    case 'side':
      return d.side === a.side ? d : { ...d, side: a.side };
    case 'economie':
      if ((d.economie ?? null) === a.economie) return d;
      if (a.economie !== null && !MODELES[d.modele].economie.includes(a.economie)) return d;
      return { ...d, economie: a.economie };
    case 'joueur': {
      if (!d.joueurs[a.index]) return d;
      const joueurs = d.joueurs.slice();
      joueurs[a.index] = { ...joueurs[a.index], ...a.champs };
      // La couleur d'un joueur suit ses agents, capacités, trajets et cônes de vision déjà posés.
      const couleur = a.champs.couleur;
      const recolorer = (o: ObjetStrat): ObjetStrat =>
        couleur && (o.type === 'agent' || o.type === 'capacite' || o.type === 'vision' || o.type === 'fleche' || o.type === 'ligne') && o.joueur === a.index ? { ...o, couleur } : o;
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

type Brut = Record<string, unknown>;
const estObjet = (v: unknown): v is Brut => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** Document version 1 (première ébauche : une seule « frame ») → version 2. */
function migrerV1(v: Brut): Brut {
  const carte = typeof v.carte === 'string' ? { cle: v.carte, nom: v.carte, image: null } : v.carte;
  return {
    format: FORMAT_STRAT,
    version: 2,
    jeu: v.jeu ?? 'valorant',
    carte,
    side: v.side,
    joueurs: COULEURS_JOUEURS.slice(0, 5).map((couleur, i) => ({ nom: tr('strats.document.joueur', { v: i + 1 }), couleur, agent: null })),
    calques: calquesParDefaut(),
    etapes: [{ id: 'e1', titre: tr('strats.document.etape_1'), note: typeof v.notes === 'string' ? v.notes : '', objets: Array.isArray(v.objets) ? v.objets : [] }],
  };
}

const enMetres = (n: number) => Math.round((n / ECHELLE_DEFAUT) * 10) / 10;

/** Zone v2 (unités du repère) → zone v3 (mètres à l'échelle par défaut : le dessin ne bouge pas sans calibrage). */
export function zoneDepuisV2(z: unknown): Zone | null {
  if (!estObjet(z)) return null;
  if (z.forme === 'cercle') return { forme: 'cercle', rayon: Math.max(0.2, enMetres(Number(z.rayon) || 0)) };
  if (z.forme === 'mur') {
    const dx = Number(z.dx) || 0;
    const dy = Number(z.dy) || 0;
    return {
      forme: 'mur',
      angle: Math.round(((Math.atan2(dy, dx) * 180) / Math.PI) * 10) / 10,
      longueur: Math.min(200, Math.max(0.5, enMetres(Math.hypot(dx, dy)))),
      largeur: Math.max(0.1, enMetres(Number(z.epaisseur) || 8)),
      courbure: 0,
    };
  }
  if (z.forme === 'cone') return { forme: 'cone', angle: Number(z.angle) || 0, ouverture: Number(z.ouverture) || 60, portee: Math.max(0.5, enMetres(Number(z.rayon) || 0)) };
  return z as unknown as Zone;
}

/** Version 2 → 3 (voir le serveur, document.mjs). */
function migrerV2(v: Brut, modele?: ModeleStrat): Brut {
  const m = modele ?? modeleDuJeu(null, typeof v.jeu === 'string' ? v.jeu : null);
  const joueurs = Array.isArray(v.joueurs) ? v.joueurs.slice(0, MODELES[m].joueursMax) : undefined;
  const nb = joueurs?.length ?? 0;
  return {
    ...v,
    version: 3,
    modele: m,
    economie: null,
    joueurs,
    etapes: Array.isArray(v.etapes)
      ? v.etapes.map(e =>
          estObjet(e)
            ? {
                ...e,
                phase: null,
                duree: DUREE_ETAPE_DEFAUT,
                objets: Array.isArray(e.objets)
                  ? e.objets.map(o => {
                      if (!estObjet(o)) return o;
                      const sortie: Brut = { ...o };
                      if (Number.isInteger(o.joueur) && (o.joueur as number) >= nb) sortie.joueur = null;
                      if (o.type === 'capacite') sortie.zone = zoneDepuisV2(o.zone);
                      return sortie;
                    })
                  : e.objets,
              }
            : e,
        )
      : v.etapes,
  };
}

/**
 * Lit un document (texte JSON ou objet), de n'importe quelle version connue,
 * et le rend à la version courante. Lève `ErreurDocument` s'il est illisible
 * ou vient d'une version plus récente de l'app. `modele` : celui de la strat
 * (migration d'une ancienne version).
 */
export function lireDocument(source: string | unknown, modele?: ModeleStrat): DocumentStrat {
  let v: unknown = source;
  if (typeof source === 'string') {
    try {
      v = JSON.parse(source);
    } catch {
      throw new ErreurDocument(tr('strats.document.strat_illisible_json'));
    }
  }
  if (!estObjet(v)) throw new ErreurDocument(tr('strats.document.strat_illisible'));
  let d = v;
  const version = (d.version as number | undefined) ?? 1;
  if (!Number.isInteger(version) || version < 1) throw new ErreurDocument(tr('strats.document.version_de_strat_illisible'));
  if (version > VERSION_DOCUMENT) throw new ErreurDocument(tr('strats.document.cette_strat_vient_d'));
  if (version === 1) d = migrerV1(d);
  if (((d.version as number | undefined) ?? 1) <= 2) d = migrerV2(d, modele);
  const carte = d.carte as Carte | undefined;
  if (!carte || typeof carte.cle !== 'string') throw new ErreurDocument(tr('strats.document.strat_sans_carte'));
  if (!Array.isArray(d.etapes) || d.etapes.length === 0) throw new ErreurDocument(tr('strats.document.strat_sans_etape'));
  const calques = calquesParDefaut();
  const brut = (d.calques ?? {}) as Partial<DocumentStrat['calques']>;
  for (const c of CALQUES) calques[c] = { visible: brut[c]?.visible !== false, verrou: brut[c]?.verrou === true };
  const m = modeleDuJeu(typeof d.modele === 'string' ? d.modele : null, typeof d.jeu === 'string' ? d.jeu : null);
  const jeu = typeof d.jeu === 'string' && d.jeu ? d.jeu : 'autre';
  return {
    format: FORMAT_STRAT,
    version: VERSION_DOCUMENT,
    jeu,
    modele: m,
    carte: { cle: carte.cle, nom: carte.nom ?? carte.cle, image: carte.image ?? null, echelle: carte.echelle ?? null },
    side: d.side === 'defense' ? 'defense' : 'attaque',
    economie: (d.economie as Economie | null | undefined) ?? null,
    joueurs: Array.isArray(d.joueurs) && d.joueurs.length > 0 ? (d.joueurs as JoueurStrat[]) : documentVide(carte, 'attaque', jeu, m).joueurs,
    calques,
    etapes: (d.etapes as Etape[]).map(e => ({ ...e, phase: e.phase ?? null, duree: e.duree ?? DUREE_ETAPE_DEFAUT })),
  };
}

export const serialiser = (d: DocumentStrat): string => JSON.stringify(d);

/** Taille du document sérialisé (octets UTF-8) : le serveur refuse au-delà de 384 Ko. */
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

/** Zone par défaut d'une capacité, selon la forme choisie (null : icône seule). Dimensions en mètres. */
export function zoneParDefaut(forme: FormeZone | 'aucune' | 'point'): Zone | null {
  switch (forme) {
    case 'cercle':
      return { forme: 'cercle', rayon: 4 };
    case 'mur':
      return { forme: 'mur', angle: 0, longueur: 15, largeur: 1, courbure: 0 };
    case 'cone':
      return { forme: 'cone', angle: -90, ouverture: 60, portee: 15 };
    case 'trajet':
      return { forme: 'trajet', dx: -120, dy: 120, rayon: 30 };
    case 'ligne':
      return { forme: 'ligne', angle: 0, longueur: 8 };
    case 'rect':
      return { forme: 'rect', angle: 0, longueur: 10, largeur: 4 };
    default:
      return null;
  }
}

/** Couleur d'un joueur (repli : blanc). */
export const couleurJoueur = (d: DocumentStrat, joueur: number | null): string => (joueur !== null && d.joueurs[joueur]?.couleur) || '#ffffff';

/** Utilitaires d'une étape dans l'ordre de lancer (ordre, puis minutage, puis pose). */
export function ordreUtilitaires(e: Etape): ObjetCapacite[] {
  const caps = e.objets.filter((o): o is ObjetCapacite => o.type === 'capacite');
  return caps
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c.ordre ?? 1000) - (b.c.ordre ?? 1000) || (a.c.t ?? 1000) - (b.c.t ?? 1000) || a.i - b.i)
    .map(x => x.c);
}

/** Prochain numéro d'ordre libre d'une étape. */
export const prochainOrdre = (e: Etape | undefined): number => Math.min(99, 1 + Math.max(0, ...(e?.objets ?? []).map(o => (o.type === 'capacite' ? (o.ordre ?? 0) : 0))));

// ------------------------------------------------------------------ Vue : zoom et déplacement

export interface Vue {
  echelle: number;
  x: number;
  y: number;
}
export const VUE_INITIALE: Vue = { echelle: 1, x: 0, y: 0 };
export const ECHELLE_MIN = 0.5;
export const ECHELLE_MAX = 6;

/**
 * Zoom autour d'un point de l'écran (molette, pincement, boutons) : le point
 * sous le curseur reste sous le curseur.
 */
export function zoomer(vue: Vue, facteur: number, centre: { x: number; y: number }): Vue {
  const echelle = borne(vue.echelle * facteur, ECHELLE_MIN, ECHELLE_MAX);
  const k = echelle / vue.echelle;
  return { echelle, x: centre.x - (centre.x - vue.x) * k, y: centre.y - (centre.y - vue.y) * k };
}
