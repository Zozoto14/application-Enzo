/**
 * Profils de jeu (esport/noyau/jeux/, migration 0021) : types et appels de l'API.
 *
 * Un profil décrit un jeu AVANT la création d'une team : formats de match, système de score, modes,
 * maps, personnages, roster, rôles, champs libres. Géré par le Fondateur (permission globale
 * `jeux.gerer`), avec un assistant IA facultatif (brouillon relu, différences proposées à valider).
 */

import { requeteUrl, type ClientEsport } from '../client';

export type TypeScore = 'rounds' | 'points' | 'placement' | 'manches';
export type TypeChamp = 'texte' | 'nombre' | 'booleen' | 'liste';
export type Confiance = 'basse' | 'moyenne' | 'haute';

export interface FormatJeu {
  cle: string;
  nom: string;
  /** Équipes en même temps (3v3v3v3 = 4). */
  equipes: number;
  joueursParEquipe: number;
  bo: number[];
  notes: string;
}
export interface ScoreJeu {
  type: TypeScore;
  roundsGagnants?: number;
  roundsParMiTemps?: number;
  prolongations?: { active: boolean; regle: string };
  pointsCible?: number;
  bareme?: Array<{ place: number; points: number }>;
  manchesGagnantes?: number;
  notes: string;
}
export interface ModeJeu {
  cle: string;
  nom: string;
  description: string;
  formats: string[];
  actif: boolean;
}
export interface CarteJeu {
  cle: string;
  nom: string;
  image: string | null;
  /** Dans le pool compétitif. */
  actif: boolean;
  modes: string[];
}
export interface ClasseJeu {
  cle: string;
  nom: string;
}
export interface PersonnageJeu {
  cle: string;
  nom: string;
  classe: string | null;
  image: string | null;
  actif: boolean;
}
export interface RoleJoueurJeu {
  cle: string;
  nom: string;
}
export interface ChampLibre {
  cle: string;
  nom: string;
  type: TypeChamp;
  valeur: string | number | boolean | string[];
}
export interface SourceJeu {
  url: string;
  titre: string;
}
export interface DonneesJeu {
  formats: FormatJeu[];
  score: ScoreJeu | null;
  modes: ModeJeu[];
  cartes: CarteJeu[];
  classes: ClasseJeu[];
  personnages: PersonnageJeu[];
  roster: { titulaires: number; remplacants: number } | null;
  rolesJoueurs: RoleJoueurJeu[];
  champs: ChampLibre[];
  libelles: { personnages?: string; classes?: string; cartes?: string };
  sources: SourceJeu[];
}
export type SectionListe = 'formats' | 'modes' | 'cartes' | 'classes' | 'personnages' | 'rolesJoueurs' | 'champs';
export type SectionObjet = 'score' | 'roster';
export const SECTIONS_LISTES: readonly SectionListe[] = ['formats', 'modes', 'cartes', 'classes', 'personnages', 'rolesJoueurs', 'champs'];

export interface EnteteJeu {
  cle: string;
  nom: string;
  couleur: string;
  icone: string | null;
  /** « valorant » : fonctions propres à Valorant (assets Riot). */
  base: string | null;
  statut: 'actif' | 'archive';
  version: number;
}
export interface ProfilJeu extends EnteteJeu {
  donnees: DonneesJeu;
  gerer?: boolean;
  teams?: number;
  propositions?: number;
  majAuto?: boolean;
  frequenceJours?: number;
  derniereVerif?: string | null;
  majLe?: string;
}
export interface JeuListe extends EnteteJeu {
  resume: {
    formats: Array<{ nom: string; libelle: string; bo: number[] }>;
    score: TypeScore | null;
    roster: { titulaires: number; remplacants: number } | null;
    cartes: number;
    cartesActives: number;
    personnages: number;
    modes: number;
  };
  teams?: number;
  propositions?: number;
  majAuto?: boolean;
  frequenceJours?: number;
  derniereVerif?: string | null;
}
export interface ListeJeux {
  gerer: boolean;
  jeux: JeuListe[];
  ia?: { disponible: boolean; raison: string | null };
}
export interface VersionJeu {
  version: number;
  nom: string;
  motif: 'creation' | 'modification' | 'restauration' | 'ia-brouillon' | 'ia-maj' | 'preconfiguration' | string;
  resume: Record<string, true | { ajouts: string[]; modifications: string[]; retraits: string[] }>;
  auteur: { compte: string; pseudo: string | null } | null;
  le: string;
}
export interface Incertitude {
  chemin: string;
  confiance: Confiance;
  note: string;
}
export interface Avertissement {
  chemin: string;
  raison: string;
}
export interface TravailIa {
  id: string;
  genre: 'brouillon' | 'verification';
  jeu: string | null;
  demande: { nom?: string; urls?: string[]; consignes?: string };
  statut: 'attente' | 'en_cours' | 'pret' | 'echec' | 'valide' | 'abandonne' | 'termine';
  declenchement: 'manuel' | 'auto';
  resultat: null | {
    cle?: string;
    nom?: string;
    couleur?: string;
    donnees?: DonneesJeu;
    version?: number | null;
    pagesLues?: SourceJeu[];
    pagesEchecs?: Array<{ url: string; raison: string }>;
    propositions?: number;
  };
  sources: SourceJeu[];
  incertitudes: Incertitude[];
  avertissements: Avertissement[];
  erreur: { code: string; message: string } | null;
  demandePar: { compte: string; pseudo: string | null } | null;
  creeLe: string;
  majLe: string;
  finiLe: string | null;
}
export interface PropositionJeu {
  id: string;
  jeu: string;
  jeuNom: string;
  section: SectionListe | SectionObjet;
  operation: 'ajout' | 'modification' | 'retrait';
  cle: string | null;
  avant: Record<string, unknown> | null;
  apres: Record<string, unknown> | null;
  justification: string;
  sources: SourceJeu[];
  confiance: Confiance;
  versionBase: number;
  statut: 'en_attente' | 'acceptee' | 'refusee' | 'obsolete';
  creeLe: string;
}
export interface EtatIa {
  configure: boolean;
  raison: string | null;
  fournisseur: string | null;
  modele: string | null;
  hote: string | null;
  format: string;
  recherche: 'serveur' | 'modele' | 'aucune';
  /** Jamais la valeur de la clé : présente ou absente. */
  cle: 'presente' | 'absente';
  disponible: boolean;
  lectureWeb: boolean;
  fondateur: boolean;
  reglages: { quotaAppels: number; quotaVerifications: number; autoActif: boolean };
  usage: { mois: string; appels: number; verifications: number; plafondAppels: number; plafondVerifications: number };
  dernierAppel: { le: string; genre: string; statut: string; modele: string | null; dureeMs: number | null; erreur: string | null; jeu: string | null } | null;
  verifications: Array<{ id: string; jeu: string; statut: string; declenchement: string; erreur: { code: string; message: string } | null; le: string; finiLe: string | null }>;
}
export interface Gestionnaire {
  compte: string;
  pseudo: string | null;
  depuis: string;
}

/** Corps d'un profil à enregistrer (création, modification, validation d'un brouillon). */
export interface SaisieJeu {
  cle?: string;
  nom: string;
  couleur: string;
  icone: string | null;
  donnees: DonneesJeu;
  version?: number;
}

export function apiJeux(client: ClientEsport) {
  const j = (cle: string) => `/jeux/${encodeURIComponent(cle)}`;
  return {
    liste: (tous = false) => client.requete<ListeJeux>(`/jeux${tous ? '?tous=1' : ''}`),
    detail: (cle: string) => client.requete<ProfilJeu>(j(cle)),
    pourTeam: (teamId: string) => client.requete<ProfilJeu>(`/teams/${encodeURIComponent(teamId)}/jeu`),
    creer: (s: SaisieJeu) => client.requete<ProfilJeu>('/jeux', 'POST', s),
    modifier: (cle: string, s: Partial<SaisieJeu> & { version: number }) => client.requete<ProfilJeu>(j(cle), 'PATCH', s),
    archiver: (cle: string, archive: boolean) => client.requete<ProfilJeu>(`${j(cle)}/archiver`, 'POST', { archive }),
    supprimer: (cle: string) => client.requete<{ ok: boolean }>(j(cle), 'DELETE'),
    versions: async (cle: string) => (await client.requete<{ versions: VersionJeu[] }>(`${j(cle)}/versions`)).versions,
    version: (cle: string, n: number) => client.requete<{ version: number; nom: string; couleur: string; icone: string | null; donnees: DonneesJeu }>(`${j(cle)}/versions/${n}`),
    restaurer: (cle: string, n: number, version: number) => client.requete<ProfilJeu>(`${j(cle)}/versions/${n}/restaurer`, 'POST', { version }),
    reglerMaj: (cle: string, r: { majAuto?: boolean; frequenceJours?: number }) => client.requete<ProfilJeu>(`${j(cle)}/maj`, 'PUT', r),
    verifier: (cle: string) => client.requete<TravailIa>(`${j(cle)}/verifier`, 'POST', {}),
    propositions: async (f: { jeu?: string; statut?: string } = {}) => (await client.requete<{ propositions: PropositionJeu[] }>(`/jeux/propositions${requeteUrl(f)}`)).propositions,
    decider: (cle: string, d: { acceptees: string[]; refusees: string[]; corrections?: Record<string, unknown> }) =>
      client.requete<{ acceptees: number; refusees: number; obsoletes: number; jeu: ProfilJeu }>(`${j(cle)}/propositions/decider`, 'POST', d),
    etatIa: () => client.requete<EtatIa>('/jeux/ia'),
    reglerIa: (r: Partial<EtatIa['reglages']>) => client.requete<EtatIa>('/jeux/ia/reglages', 'PUT', r),
    testerIa: () => client.requete<{ ok: boolean; reponse?: boolean; dureeMs?: number | null; erreur?: { code: string; message: string }; etat: EtatIa }>('/jeux/ia/test', 'POST', {}),
    gestionnaires: async () => (await client.requete<{ gestionnaires: Gestionnaire[] }>('/jeux/ia/gestionnaires')).gestionnaires,
    reglerGestionnaires: async (d: { ajouter?: string[]; retirer?: string[] }) => (await client.requete<{ gestionnaires: Gestionnaire[] }>('/jeux/ia/gestionnaires', 'PUT', d)).gestionnaires,
    lancerBrouillon: (d: { nom: string; urls?: string[]; consignes?: string; jeu?: string }) => client.requete<TravailIa>('/jeux/ia/brouillons', 'POST', d),
    travaux: async (f: { genre?: string; jeu?: string } = {}) => (await client.requete<{ travaux: TravailIa[] }>(`/jeux/ia/travaux${requeteUrl(f)}`)).travaux,
    travail: (id: string) => client.requete<TravailIa>(`/jeux/ia/travaux/${encodeURIComponent(id)}`),
    validerBrouillon: (id: string, s: SaisieJeu) => client.requete<ProfilJeu>(`/jeux/ia/travaux/${encodeURIComponent(id)}/valider`, 'POST', s),
    abandonner: (id: string) => client.requete<{ ok: boolean }>(`/jeux/ia/travaux/${encodeURIComponent(id)}`, 'DELETE'),
  };
}
export type ApiJeux = ReturnType<typeof apiJeux>;
