/**
 * Client des modules « Tournois » et « Résultats » (migration 0022), par l'appel générique du client
 * Esport (`client.requete`). Types miroirs de l'API (esport/noyau/competition/).
 */

import { requeteUrl, type ClientEsport } from '../client';

export type StatutTournoi = 'a_venir' | 'inscrit' | 'en_cours' | 'termine' | 'annule';
export type TypePhase = 'poules' | 'simple' | 'double' | 'suisse' | 'championnat' | 'libre';
export type StatutMatch = 'a_jouer' | 'joue' | 'annule';
export type Issue = 'victoire' | 'defaite' | 'nul';
export type IssueRapide = Issue | 'forfait_pour' | 'forfait_contre';
export type GenreResultat = 'tournoi' | 'officiel' | 'scrim';
export type Systeme = 'serie' | 'classement';
export type TypeScore = 'rounds' | 'points' | 'placement' | 'manches';

export const STATUTS_TOURNOI: readonly StatutTournoi[] = ['a_venir', 'inscrit', 'en_cours', 'termine', 'annule'];
export const TYPES_PHASE: readonly TypePhase[] = ['poules', 'simple', 'double', 'suisse', 'championnat', 'libre'];
export const GENRES_RESULTAT: readonly GenreResultat[] = ['tournoi', 'officiel', 'scrim'];

export interface Adversaire {
  id: string | null;
  nom: string;
  logoUrl?: string | null;
  place?: number | null;
  points?: number | null;
}
export interface FormatTournoi {
  cle: string;
  nom: string;
  libelle: string;
  equipes: number;
  joueursParEquipe: number;
  bo: number[];
}
export interface MembreRoster {
  compte: string;
  pseudo: string | null;
  role: 'titulaire' | 'remplacant';
}
export interface Phase {
  cle: string;
  type: TypePhase;
  nom: string;
}
export interface MatchTournoi {
  id: string;
  phase: string | null;
  tour: string;
  ordre: number;
  debut: string | null;
  fin: string | null;
  bo: number | null;
  adversaires: Adversaire[];
  statut: StatutMatch;
  issue: Issue | null;
  issueRapide: IssueRapide | null;
  scoreTexte: string;
  place: number | null;
  resultatId: string | null;
  aResultat: boolean;
  evenementId: string | null;
  notes: string;
}
export interface BilanTournoi {
  joues: number;
  victoires: number;
  defaites: number;
  nuls: number;
}
export interface Tournoi {
  id: string;
  nom: string;
  organisateur: string;
  lien: string | null;
  jeu: string;
  format: FormatTournoi | null;
  formatCle: string | null;
  bo: number | null;
  debut: string | null;
  fin: string | null;
  enLigne: boolean;
  lieu: string;
  phases: Phase[];
  fraisCentimes: number | null;
  cashprizeCentimes: number | null;
  devise: string;
  cashprizeDetails: string;
  statut: StatutTournoi;
  inscription: { limite: string | null; inscritLe: string | null };
  checkin: { ouverture: string | null; limite: string | null; faitLe: string | null };
  classementFinal: number | null;
  participants: number | null;
  gainsCentimes: number | null;
  gainsNotes: string;
  notes: string;
  publiable: boolean;
  roster: MembreRoster[];
  creeLe: string;
  majLe: string;
}
export interface TournoiListe extends Tournoi {
  matchs: number;
  bilan: BilanTournoi;
  prochainMatch: MatchTournoi | null;
}
export interface DroitsTournois {
  gerer: boolean;
  planning: boolean;
  planifier: boolean;
  resultats: boolean;
  saisirResultats: boolean;
  scouting: boolean;
}
export interface JeuTournois {
  cle: string;
  nom: string;
  couleur: string;
  formats: FormatTournoi[];
  score: { type: TypeScore } | null;
  roster: TailleRoster;
  membres: Array<{ compte: string; pseudo: string }>;
}
export interface TailleRoster {
  titulairesMin: number;
  titulairesMax: number;
  remplacantsMax: number;
}
export interface ListeTournois {
  tournois: TournoiListe[];
  droits: DroitsTournois;
  jeu: JeuTournois;
}
export interface DetailTournoi {
  tournoi: Tournoi;
  matchs: MatchTournoi[];
  bilan: BilanTournoi;
  rosterTaille: TailleRoster;
  droits: DroitsTournois;
  jeu: JeuTournois;
  modules: { planning: boolean; resultats: boolean };
  avertissements?: string[];
  match?: string;
  planning?: { evenementId: string | null; raison?: 'module' | 'permission' };
}
export interface SaisieTournoi {
  nom?: string;
  organisateur?: string;
  lien?: string | null;
  formatCle?: string | null;
  bo?: number | null;
  debut?: string | null;
  fin?: string | null;
  enLigne?: boolean;
  lieu?: string;
  phases?: Array<{ cle?: string; type: TypePhase; nom: string }>;
  frais?: string | number | null;
  cashprize?: string | number | null;
  devise?: string;
  cashprizeDetails?: string;
  statut?: StatutTournoi;
  inscriptionLimite?: string | null;
  checkinOuverture?: string | null;
  checkinLimite?: string | null;
  classementFinal?: number | null;
  participants?: number | null;
  gains?: string | number | null;
  gainsNotes?: string;
  notes?: string;
  publiable?: boolean;
}
export interface SaisieMatch {
  phase?: string | null;
  tour?: string;
  ordre?: number;
  date?: string | null;
  heure?: string;
  dureeMin?: number;
  bo?: number | null;
  adversaires?: Array<{ id?: string; nom?: string }>;
  statut?: StatutMatch;
  issue?: IssueRapide | null;
  scoreTexte?: string;
  place?: number | null;
  notes?: string;
}

// ------------------------------------------------------------------ Résultats

export interface MancheResultat {
  numero: number;
  carte: { cle: string | null; nom: string } | null;
  mode: { cle: string | null; nom: string } | null;
  issue: Issue | null;
  nous: number | null;
  eux: number | null;
  place: number | null;
  points: number | null;
  miTemps: Array<[number, number]> | null;
  prolongations: [number, number] | null;
  enProlongations: boolean;
  classement: Array<{ id: string | null; nom: string; place: number; points: number | null }>;
}
export interface JoueurResultat {
  compte: string | null;
  pseudo: string | null;
  personnages: Array<{ cle: string | null; nom: string }>;
  stats: Record<string, number | string>;
  mvp: boolean;
}
export interface Resultat {
  id: string;
  genre: GenreResultat;
  tournoi: { id: string; nom: string } | null;
  tournoiMatchId: string | null;
  tour: string | null;
  evenementId: string | null;
  occurrence: string | null;
  date: string;
  jeu: { cle: string; nom: string; couleur: string };
  format: { cle: string; nom: string; libelle: string } | null;
  systeme: Systeme;
  bo: number | null;
  adversaires: Adversaire[];
  manches: MancheResultat[];
  issue: Issue | null;
  forfait: 'pour' | 'contre' | null;
  manchesNous: number | null;
  manchesEux: number | null;
  place: number | null;
  points: number | null;
  participants: number | null;
  score: string;
  joueurs: JoueurResultat[];
  mvp: { compte: string; pseudo: string | null } | null;
  reviewId: string | null;
  visibilite: 'team' | 'staff';
  publiable: boolean;
  notes: string;
  saisiPar: string | null;
  creeLe: string;
  majLe: string;
}
export interface Compteur {
  joues: number;
  victoires: number;
  defaites: number;
  nuls: number;
  taux: number | null;
}
export interface Bilan {
  series: Compteur;
  classements: { joues: number; placeMoyenne: number | null; top1: number; top3: number };
  parCarte: Array<Compteur & { cle: string | null; nom: string; classements: { joues: number; placeMoyenne: number | null } }>;
  parAdversaire: Array<Compteur & { id: string | null; nom: string }>;
  forme: Array<'V' | 'D' | 'N'>;
  enCours: { issue: Issue; n: number } | null;
  recordVictoires: number;
  recordDefaites: number;
  rounds: { pour: number; contre: number };
}
export interface DroitsResultats {
  saisir: boolean;
  tournois: boolean;
  planning: boolean;
  scouting: boolean;
  review: boolean;
  adversaireRapide: boolean;
}
export interface FiltresResultats {
  jeu?: string;
  tournoi?: string;
  adversaire?: string;
  du?: string;
  au?: string;
  carte?: string;
  genre?: GenreResultat;
  issue?: Issue;
}
export interface ListeResultats {
  resultats: Resultat[];
  total: number;
  bilan: Bilan;
  filtres: {
    adversaires: Array<{ id: string; nom: string; fiche: boolean }>;
    cartes: Array<{ cle: string; nom: string }>;
    tournois: Array<{ id: string; nom: string }>;
    jeux: Array<{ cle: string; nom: string; couleur: string }>;
  };
  droits: DroitsResultats;
}
export interface ScoreProfil {
  type: TypeScore;
  roundsGagnants?: number;
  roundsParMiTemps?: number;
  prolongations?: { active: boolean; regle: string; ecart?: number };
  pointsCible?: number;
  bareme?: Array<{ place: number; points: number }>;
  manchesGagnantes?: number;
  notes?: string;
}
export interface FormulaireResultat {
  jeu: {
    cle: string;
    nom: string;
    couleur: string;
    formats: FormatTournoi[];
    score: ScoreProfil | null;
    systeme: Systeme;
    cartes: Array<{ cle: string; nom: string; actif: boolean; modes: string[] }>;
    modes: Array<{ cle: string; nom: string; formats: string[]; actif: boolean }>;
    personnages: Array<{ cle: string; nom: string; actif: boolean }>;
    roster: { titulaires: number; remplacants: number } | null;
    libelles: { personnages?: string; classes?: string; cartes?: string };
  };
  membres: Array<{ compte: string; pseudo: string }>;
  matchsTournoi: Array<{ id: string; tournoi: { id: string; nom: string }; tour: string; debut: string | null; bo: number | null; formatCle: string | null; adversaires: Adversaire[] }>;
  evenements: Array<{ id: string; titre: string; type: string; debut: string; adversaireId: string | null }>;
  reviews: Array<{ id: string; titre: string }>;
  adversaires: Array<{ id: string; nom: string; logoUrl: string | null }>;
  droits: DroitsResultats;
}
export interface SaisieManche {
  carteCle?: string | null;
  carteNom?: string;
  modeCle?: string | null;
  nous?: number | string | null;
  eux?: number | string | null;
  miTemps?: Array<[number, number]>;
  prolongations?: [number, number];
  issue?: Issue;
  place?: number | string | null;
  points?: number | string | null;
  classement?: Array<{ id?: string | null; nom: string; place: number; points?: number | null }>;
}
export interface SaisieResultat {
  genre?: GenreResultat;
  tournoiMatchId?: string | null;
  tournoiId?: string | null;
  evenementId?: string | null;
  date?: string;
  formatCle?: string | null;
  systeme?: Systeme;
  bo?: number | null;
  adversaires?: Array<{ id?: string; nom?: string }>;
  manches?: SaisieManche[];
  forfait?: 'pour' | 'contre' | null;
  placeFinale?: number | null;
  participants?: number | null;
  joueurs?: Array<{ compte: string; personnages?: string[]; stats?: Record<string, number | string> }>;
  mvp?: string | null;
  reviewId?: string | null;
  visibilite?: 'team' | 'staff';
  publiable?: boolean;
  notes?: string;
}
export interface VueAdversaire {
  adversaire: { id: string; nom: string; logoUrl: string | null; supprime: boolean };
  bilan: Bilan;
  resultats: Resultat[];
  prochains: Array<{ genre: 'tournoi' | 'planning'; id: string; debut: string; tournoi?: { id: string; nom: string }; tour?: string; titre?: string; type?: string }>;
  scouting: { id: string } | null;
  droits: DroitsResultats;
}
export interface AccueilCompetition {
  prochains: Array<{ id: string; tournoi: { id: string; nom: string }; tour: string; debut: string; adversaires: Adversaire[] }> | null;
  tournois: Array<{ id: string; nom: string; debut: string | null; fin: string | null; statut: StatutTournoi; inscriptionLimite: string | null; checkinLimite: string | null }> | null;
  derniers: Array<{ id: string; genre: GenreResultat; date: string; tournoi: { id: string; nom: string } | null; adversaires: Adversaire[]; systeme: Systeme; issue: Issue | null; place: number | null; score: string }> | null;
  forme: Array<'V' | 'D' | 'N'> | null;
  droits: { tournois: boolean; resultats: boolean; gerer: boolean; saisir: boolean };
}

const t = (teamId: string) => `/teams/${encodeURIComponent(teamId)}`;
const tn = (teamId: string, id: string) => `${t(teamId)}/tournois/${encodeURIComponent(id)}`;
const rs = (teamId: string, id: string) => `${t(teamId)}/resultats/${encodeURIComponent(id)}`;

export function apiCompetition(client: ClientEsport) {
  return {
    tournois: (teamId: string, statut?: StatutTournoi) => client.requete<ListeTournois>(`${t(teamId)}/tournois${requeteUrl({ statut })}`),
    tournoi: (teamId: string, id: string) => client.requete<DetailTournoi>(tn(teamId, id)),
    creerTournoi: (teamId: string, corps: SaisieTournoi) => client.requete<DetailTournoi>(`${t(teamId)}/tournois`, 'POST', corps),
    modifierTournoi: (teamId: string, id: string, corps: SaisieTournoi) => client.requete<DetailTournoi>(tn(teamId, id), 'PATCH', corps),
    supprimerTournoi: (teamId: string, id: string) => client.requete<{ ok: true }>(tn(teamId, id), 'DELETE'),
    roster: (teamId: string, id: string, titulaires: string[], remplacants: string[]) => client.requete<DetailTournoi>(`${tn(teamId, id)}/roster`, 'PUT', { titulaires, remplacants }),
    inscrire: (teamId: string, id: string, annuler = false) => client.requete<DetailTournoi>(`${tn(teamId, id)}/inscription`, 'POST', annuler ? { annuler: true } : {}),
    checkin: (teamId: string, id: string) => client.requete<DetailTournoi>(`${tn(teamId, id)}/checkin`, 'POST', {}),
    ajouterMatch: (teamId: string, id: string, corps: SaisieMatch) => client.requete<DetailTournoi>(`${tn(teamId, id)}/matchs`, 'POST', corps),
    modifierMatch: (teamId: string, id: string, matchId: string, corps: SaisieMatch) => client.requete<DetailTournoi>(`${tn(teamId, id)}/matchs/${encodeURIComponent(matchId)}`, 'PATCH', corps),
    supprimerMatch: (teamId: string, id: string, matchId: string) => client.requete<DetailTournoi>(`${tn(teamId, id)}/matchs/${encodeURIComponent(matchId)}`, 'DELETE'),
    resultats: (teamId: string, f: FiltresResultats = {}) => client.requete<ListeResultats>(`${t(teamId)}/resultats${requeteUrl({ ...f })}`),
    resultat: (teamId: string, id: string) => client.requete<{ resultat: Resultat; droits: DroitsResultats }>(rs(teamId, id)),
    formulaire: (teamId: string) => client.requete<FormulaireResultat>(`${t(teamId)}/resultats/formulaire`),
    creerResultat: (teamId: string, corps: SaisieResultat) => client.requete<{ resultat: Resultat; droits: DroitsResultats }>(`${t(teamId)}/resultats`, 'POST', corps),
    modifierResultat: (teamId: string, id: string, corps: SaisieResultat) => client.requete<{ resultat: Resultat; droits: DroitsResultats }>(rs(teamId, id), 'PATCH', corps),
    supprimerResultat: (teamId: string, id: string) => client.requete<{ ok: true }>(rs(teamId, id), 'DELETE'),
    vueAdversaire: (teamId: string, id: string) => client.requete<VueAdversaire>(`${t(teamId)}/resultats/adversaires/${encodeURIComponent(id)}`),
    adversaires: (teamId: string) => client.requete<{ adversaires: Array<{ id: string; nom: string; logoUrl: string | null }>; droits: { creer: boolean; scouting: boolean } }>(`${t(teamId)}/competition/adversaires`),
    creerAdversaire: (teamId: string, nom: string) => client.requete<{ adversaire: { id: string; nom: string; logoUrl: string | null }; existait: boolean }>(`${t(teamId)}/competition/adversaires`, 'POST', { nom }),
    accueil: (teamId: string) => client.requete<AccueilCompetition>(`${t(teamId)}/competition/accueil`),
  };
}
export type ApiCompetition = ReturnType<typeof apiCompetition>;
