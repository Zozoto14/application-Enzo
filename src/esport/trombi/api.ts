/**
 * Client du trombinoscope (page Membres › Trombinoscope, migration 0030), par l'appel générique du client Esport.
 * Types miroirs de l'API (esport/noyau/trombi/). Voir docs/esport/trombinoscope.md.
 */

import type { ClientEsport } from '../client';

export type ReseauTrombi = 'x' | 'instagram' | 'tiktok' | 'twitch' | 'youtube' | 'autre';
export type NiveauVisibilite = 'membres' | 'staff' | 'prive';
export type ChampVisibilite = 'photo' | 'nomReel' | 'presentation' | 'elos' | 'palmares' | 'structures' | 'reseaux';
export type NiveauLecteur = 'moi' | 'editeur' | 'staff' | 'membre';

export const RESEAUX_TROMBI: readonly ReseauTrombi[] = ['x', 'instagram', 'tiktok', 'twitch', 'youtube', 'autre'];
export const NIVEAUX_VISIBILITE: readonly NiveauVisibilite[] = ['membres', 'staff', 'prive'];
export const CHAMPS_VISIBILITE: readonly ChampVisibilite[] = ['photo', 'nomReel', 'presentation', 'elos', 'palmares', 'structures', 'reseaux'];

export interface ElementCle {
  cle: string;
  nom: string;
}
export interface TeamFiche {
  id: string;
  nom: string;
  slug: string;
  logoUrl: string | null;
  jeu: string;
  jeuNom: string;
  role: { nom: string; couleur: string; cle: string | null };
  postes: ElementCle[];
  personnages: ElementCle[];
  posteLibre: string | null;
  rejointLe: string;
}
export interface Elo {
  jeu: string;
  jeuNom?: string;
  valeur: string;
  rang: string;
  pic: string;
  majLe: string;
}
export interface EntreePalmares {
  id: string;
  competition: string;
  structure: string;
  date: string;
  placement: number | null;
  placementTexte: string;
  participants: number | null;
  jeu: string;
  jeuNom?: string;
  details: string;
  preuve: string;
}
export interface TournoiCalcule {
  id: string;
  nom: string;
  teamId: string;
  teamNom: string | null;
  jeu: string;
  jeuNom: string;
  debut: string | null;
  fin: string | null;
  statut: string;
  placement: number | null;
  participants: number | null;
  role: string | null;
  matchs: number;
  victoires: number;
  defaites: number;
  mvp: number;
  calcule: true;
}
export interface PalmaresCalcule {
  tournois: TournoiCalcule[];
  hors: { matchs: number; victoires: number; mvp: number };
}
export interface AncienneStructure {
  id: string;
  structure: string;
  jeu: string;
  jeuNom?: string;
  debut: string;
  fin: string;
  role: string;
}
export interface ReseauFiche {
  reseau: ReseauTrombi;
  url: string;
  identifiant?: string;
  libelle: string;
}
export interface CarteTrombi {
  compte: string;
  pseudo: string;
  photo: string | null;
  teams: TeamFiche[];
  elo: Elo | null;
  reseaux: ReseauFiche[];
  palmares: number;
  peutEditer: boolean;
  moi: boolean;
}
export interface JeuTrombi {
  cle: string;
  nom: string;
  rolesJoueurs: ElementCle[];
}
export interface Trombinoscope {
  droits: { voir: 'club' | 'teams' | 'equipe'; editer: boolean };
  teams: Array<{ id: string; nom: string; slug: string; jeu: string; jeuNom: string; logoUrl: string | null }>;
  jeux: JeuTrombi[];
  fiches: CarteTrombi[];
}
export interface FicheTrombi {
  compte: string;
  pseudo: string;
  niveau: NiveauLecteur;
  peutEditer: boolean;
  peutRegler: boolean;
  version: number;
  majLe: string | null;
  teams: TeamFiche[];
  photo: { url: string; type: string; cote: number; majLe: string } | null;
  champs: Record<ChampVisibilite, boolean>;
  nomReel: string | null;
  presentation: string | null;
  elos: Elo[] | null;
  palmares: EntreePalmares[] | null;
  calcule: PalmaresCalcule | null;
  structures: AncienneStructure[] | null;
  reseaux: ReseauFiche[] | null;
  visibilite?: Record<ChampVisibilite, NiveauVisibilite>;
  saisie?: { jeux: ElementCle[]; profils: Array<{ teamId: string; jeu: string; rolesJoueurs: ElementCle[]; personnages: ElementCle[] }> };
}
export interface SaisieFiche {
  versionAttendue?: number;
  nomReel?: string;
  presentation?: string;
  elos?: Array<Partial<Elo>>;
  palmares?: Array<Partial<EntreePalmares>>;
  structures?: Array<Partial<AncienneStructure>>;
  reseaux?: Array<{ reseau: ReseauTrombi; url: string; libelle?: string }>;
  postes?: Record<string, { postes: string[]; personnages: string[] } | null>;
  visibilite?: Partial<Record<ChampVisibilite, NiveauVisibilite>>;
}
export interface PhotoEnvoyee {
  type: 'image/jpeg' | 'image/png' | 'image/webp';
  donnees: string;
  miniature: string;
}

const e = encodeURIComponent;

export function apiTrombi(client: ClientEsport) {
  const r = <T>(chemin: string, methode = 'GET', corps?: unknown) => client.requete<T>(chemin, methode, corps);
  return {
    // Réponse inattendue (serveur d'une autre version) : liste vide plutôt qu'un écran cassé.
    liste: async (): Promise<Trombinoscope> => {
      const x = await r<Partial<Trombinoscope> | undefined>('/trombi');
      return { droits: x?.droits ?? { voir: 'equipe', editer: false }, teams: Array.isArray(x?.teams) ? x.teams : [], jeux: Array.isArray(x?.jeux) ? x.jeux : [], fiches: Array.isArray(x?.fiches) ? x.fiches : [] };
    },
    fiche: (compte: string) => r<FicheTrombi>(`/trombi/fiches/${e(compte)}`),
    modifier: (compte: string, s: SaisieFiche) => r<FicheTrombi>(`/trombi/fiches/${e(compte)}`, 'PATCH', s),
    photo: (compte: string, p: PhotoEnvoyee) => r<FicheTrombi>(`/trombi/fiches/${e(compte)}/photo`, 'PUT', p),
    supprimerPhoto: (compte: string) => r<FicheTrombi>(`/trombi/fiches/${e(compte)}/photo`, 'DELETE'),
    texte: (compte: string) => r<{ fr: string; en: string }>(`/trombi/fiches/${e(compte)}/texte`),
  };
}
export type ApiTrombi = ReturnType<typeof apiTrombi>;

// ------------------------------------------------------------------ Règles d'affichage (pures, testées)

export interface FiltresTrombi {
  recherche: string;
  team: string;
  jeu: string;
  poste: string;
}

/** Filtres du trombinoscope : recherche (pseudo, team, poste, elo), team, jeu pratiqué, poste du profil. */
export function filtrerCartes(cartes: readonly CarteTrombi[], f: FiltresTrombi): CarteTrombi[] {
  const q = f.recherche.trim().toLocaleLowerCase('fr');
  return cartes.filter(c => {
    const teams = c.teams.filter(t => (f.team === 'toutes' || t.id === f.team) && (f.jeu === 'tous' || t.jeu === f.jeu));
    if ((f.team !== 'toutes' || f.jeu !== 'tous') && teams.length === 0) return false;
    if (f.poste !== 'tous' && !teams.some(t => t.postes.some(p => p.cle === f.poste))) return false;
    if (!q) return true;
    const texte = [c.pseudo, ...c.teams.flatMap(t => [t.nom, t.jeuNom, t.posteLibre ?? '', ...t.postes.map(p => p.nom), ...t.personnages.map(p => p.nom)]), c.elo?.valeur ?? '', c.elo?.rang ?? ''].join(' ');
    return texte.toLocaleLowerCase('fr').includes(q);
  });
}

/** Postes affichés d'une team : ceux du profil de jeu, sinon le poste libre saisi à l'arrivée. */
export const postesAffiches = (t: TeamFiche): string[] => (t.postes.length ? t.postes.map(p => p.nom) : t.posteLibre ? [t.posteLibre] : []);

/** Contrôle côté app d'une adresse de profil (le serveur revérifie) : https, domaine du réseau. */
const DOMAINES: Record<Exclude<ReseauTrombi, 'autre'>, readonly string[]> = {
  x: ['x.com', 'twitter.com'],
  instagram: ['instagram.com'],
  tiktok: ['tiktok.com'],
  twitch: ['twitch.tv'],
  youtube: ['youtube.com', 'youtu.be'],
};
export function urlPlausible(reseau: ReseauTrombi, url: string): boolean {
  const t = url.trim();
  if (!/^https:\/\/[^\s<>"'`\\]+$/i.test(t)) return false;
  let hote = '';
  try {
    hote = new URL(t).hostname.toLowerCase().replace(/^(www|m|mobile|vm)\./, '');
  } catch {
    return false;
  }
  if (reseau === 'autre') return hote.includes('.') && !/^\d+(\.\d+){3}$/.test(hote) && !Object.values(DOMAINES).some(d => d.some(x => hote === x || hote.endsWith(`.${x}`)));
  return DOMAINES[reseau].some(x => hote === x || hote.endsWith(`.${x}`));
}

/** Réseau deviné d'après l'adresse collée (« autre » si inconnu). */
export function reseauDeviner(url: string): ReseauTrombi {
  return (Object.keys(DOMAINES) as Array<Exclude<ReseauTrombi, 'autre'>>).find(r => urlPlausible(r, url)) ?? 'autre';
}
