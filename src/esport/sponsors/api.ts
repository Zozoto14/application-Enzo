/**
 * Client de la rubrique Sponsors & partenaires (migration 0024), par l'appel générique du client Esport.
 * Types miroirs de l'API (esport/noyau/sponsors/). Voir docs/esport/sponsors.md.
 */

import { requeteUrl, type ClientEsport } from '../client';

export type IssueEtape = 'ouverte' | 'gagnee' | 'perdue';
export type Taille = '' | 'independant' | 'tpe' | 'pme' | 'eti' | 'grande';
export type Priorite = 'basse' | 'normale' | 'haute';
export type Niveau = 'principal' | 'officiel' | 'partenaire' | 'fournisseur' | 'media';
export type GenreEchange = 'appel' | 'email' | 'reunion' | 'note';
export type GenreObligation = 'posts' | 'affiche' | 'stream' | 'maillot' | 'evenement' | 'autre';
export type Comptage = 'manuel' | 'cartes';
export type Frequence = 'unique' | 'hebdomadaire' | 'mensuelle' | 'trimestrielle' | 'annuelle';
export type CategoriePiece = 'deck' | 'proposition' | 'contrat' | 'logo' | 'facture' | 'autre';
export type Renouvellement = 'manuel' | 'tacite' | 'aucun';
export type StatutContrat = 'brouillon' | 'actif' | 'termine' | 'resilie';
export type EtatPeriode = 'fait' | 'a_faire' | 'en_retard';

export const TAILLES: readonly Taille[] = ['', 'independant', 'tpe', 'pme', 'eti', 'grande'];
export const PRIORITES: readonly Priorite[] = ['basse', 'normale', 'haute'];
export const NIVEAUX: readonly Niveau[] = ['principal', 'officiel', 'partenaire', 'fournisseur', 'media'];
export const GENRES_ECHANGE: readonly GenreEchange[] = ['appel', 'email', 'reunion', 'note'];
export const GENRES_OBLIGATION: readonly GenreObligation[] = ['posts', 'affiche', 'stream', 'maillot', 'evenement', 'autre'];
export const FREQUENCES: readonly Frequence[] = ['unique', 'hebdomadaire', 'mensuelle', 'trimestrielle', 'annuelle'];
export const CATEGORIES_PIECE: readonly CategoriePiece[] = ['deck', 'proposition', 'contrat', 'logo', 'facture', 'autre'];
export const RENOUVELLEMENTS: readonly Renouvellement[] = ['manuel', 'tacite', 'aucun'];
export const STATUTS_CONTRAT: readonly StatutContrat[] = ['brouillon', 'actif', 'termine', 'resilie'];
/** Portée des envois de fichiers de la rubrique (`/cm/portees/sponsors/envois`). */
export const PORTEE_SPONSORS = 'sponsors';

export interface Etape {
  id: string;
  cle: string | null;
  nom: string | null;
  issue: IssueEtape;
  couleur: string;
  position: number;
  archive: boolean;
}
export interface ResumeProspect {
  id: string;
  nom: string;
  secteur: string;
  taille: Taille;
  source: string;
  interet: number;
  priorite: Priorite;
  valeurEstimee: number;
  etapeId: string;
  issue: IssueEtape;
  position: number;
  responsable: string | null;
  teams: string[];
  prochaineAction: string;
  prochaineActionLe: string | null;
  actionEnRetard: boolean;
  contact: { nom: string; role: string } | null;
  partenaireId: string | null;
  raisonPerte: string | null;
  version: number;
  majLe: string;
}
export interface Pipeline {
  etapes: Etape[];
  prospects: ResumeProspect[];
  noms: Record<string, string | null>;
  teams: Record<string, string>;
  gerer: boolean;
}
export interface Contact {
  id: string;
  nom: string;
  role: string;
  email: string;
  telephone: string;
  reseaux: string[];
  principal: boolean;
  notes: string;
  prospectId: string | null;
  partenaireId: string | null;
}
export interface Echange {
  id: string;
  genre: GenreEchange;
  date: string;
  resume: string;
  contactId: string | null;
  auteur: string | null;
  prospectId: string | null;
  partenaireId: string | null;
}
export interface Piece {
  id: string;
  genre: 'fichier' | 'lien';
  categorie: CategoriePiece;
  nom: string;
  url: string | null;
  contratId: string | null;
  fichier: { id: string; type: string; taille: number } | null;
  creeLe: string;
}
export interface FicheProspect {
  prospect: ResumeProspect & { site: string; notes: string; perduLe: string | null; signeLe: string | null; creePar: string | null; creeLe: string };
  etapes: Etape[];
  contacts: Contact[];
  echanges: Echange[];
  pieces: Piece[];
  noms: Record<string, string | null>;
  teams: Record<string, string>;
  gerer: boolean;
}
export interface Contrat {
  id: string;
  partenaireId: string;
  intitule: string;
  debut: string;
  fin: string;
  montant: number;
  dotation: string;
  valeurDotation: number;
  renouvellement: Renouvellement;
  preavisJours: number;
  statut: StatutContrat;
  notes: string;
  joursRestants: number;
  enCours: boolean;
}
export interface Periode {
  cle: string;
  debut: string;
  fin: string;
  manuel: number;
  cartes: Array<{ id: string; titre: string; tableauId: string; jour: string }>;
  fait: number;
  quantite: number;
  note: string;
  etat: EtatPeriode;
}
export interface Obligation {
  id: string;
  partenaireId: string;
  contratId: string | null;
  intitule: string;
  genre: GenreObligation;
  comptage: Comptage;
  frequence: Frequence;
  quantite: number;
  debut: string;
  fin: string | null;
  rappelJours: number;
  responsable: string | null;
  notes: string;
  archive: boolean;
  periodes: Periode[];
  courante: Periode | null;
  enRetard: number;
}
export interface ResumePartenaire {
  id: string;
  nom: string;
  niveau: Niveau;
  statut: 'actif' | 'termine';
  secteur: string;
  teams: string[];
  logoPieceId: string | null;
  contrat: Contrat | null;
  obligations: number;
  obligationsEnRetard: number;
  responsable: string | null;
}
export interface FichePartenaire {
  partenaire: { id: string; nom: string; site: string; secteur: string; niveau: Niveau; statut: 'actif' | 'termine'; teams: string[]; logoPieceId: string | null; notes: string; responsable: string | null; prospectId: string | null; version: number; creeLe: string };
  contrats: Contrat[];
  obligations: Obligation[];
  contacts: Contact[];
  echanges: Echange[];
  pieces: Piece[];
  noms: Record<string, string | null>;
  teams: Record<string, string>;
  gerer: boolean;
}
export interface TableauDeBord {
  aujourdhui: string;
  pipeline: { etapes: Array<Etape & { n: number; valeur: number }>; ouverts: number; valeurOuverte: number };
  conversion: { signes: number; perdus: number; taux: number | null; depuis: string };
  revenus: { annee: number; mois: Array<{ mois: string; numeraire: number; nature: number }>; numeraire: number; nature: number };
  partenairesActifs: number;
  obligationsEnRetard: Array<{ obligationId: string; partenaire: { id: string; nom: string }; intitule: string; periode: string; fin: string; fait: number; quantite: number }>;
  obligationsAFaire: Array<{ obligationId: string; partenaire: { id: string; nom: string }; intitule: string; periode: string; fin: string; fait: number; quantite: number; joursRestants: number }>;
  contratsExpirant: Array<{ contratId: string; partenaire: { id: string; nom: string }; intitule: string; fin: string; joursRestants: number; renouvellement: Renouvellement }>;
  actions: Array<{ prospectId: string; nom: string; prochaineAction: string; prochaineActionLe: string; enRetard: boolean; responsable: string | null }>;
  noms: Record<string, string | null>;
}
export type ChampImport =
  | 'nom'
  | 'site'
  | 'secteur'
  | 'taille'
  | 'source'
  | 'interet'
  | 'priorite'
  | 'valeur'
  | 'etape'
  | 'notes'
  | 'prochaine_action'
  | 'contact_nom'
  | 'contact_role'
  | 'contact_email'
  | 'contact_telephone'
  | 'contact_reseaux';
export interface ApercuImport {
  separateur: string;
  entetes: string[];
  exemples: string[][];
  lignes: number;
  correspondance: Record<string, ChampImport>;
  champs: ChampImport[];
}
export interface BilanImport {
  crees: number;
  doublons: Array<{ ligne: number; nom: string }>;
  invalides: Array<{ ligne: number; code: string }>;
  nDoublons: number;
  nInvalides: number;
}
export interface SaisieProspect {
  nom?: string;
  site?: string;
  secteur?: string;
  taille?: Taille;
  source?: string;
  interet?: number;
  priorite?: Priorite;
  valeurEstimee?: string | number;
  notes?: string;
  teams?: string[];
  responsable?: string | null;
  prochaineAction?: string;
  prochaineActionLe?: string | null;
  etapeId?: string;
  raisonPerte?: string;
  versionAttendue?: number;
  contact?: Partial<SaisieContact>;
}
export interface SaisieContact {
  nom: string;
  role: string;
  email: string;
  telephone: string;
  reseaux: string[];
  principal: boolean;
  notes: string;
}
export interface SaisieContrat {
  intitule?: string;
  debut?: string;
  fin?: string;
  montant?: string | number;
  dotation?: string;
  valeurDotation?: string | number;
  renouvellement?: Renouvellement;
  preavisJours?: number;
  statut?: StatutContrat;
  notes?: string;
}
export interface SaisieObligation {
  intitule?: string;
  genre?: GenreObligation;
  comptage?: Comptage;
  frequence?: Frequence;
  quantite?: number;
  debut?: string;
  fin?: string | null;
  contratId?: string | null;
  rappelJours?: number;
  responsable?: string | null;
  notes?: string;
  archive?: boolean;
}
export interface EntreeJournalSponsors {
  id: string;
  acteur: string | null;
  action: string;
  entite: string | null;
  entiteId: string | null;
  meta: Record<string, unknown>;
  date: string;
}
export type Cible = { prospectId: string } | { partenaireId: string };

const e = encodeURIComponent;

export function apiSponsors(client: ClientEsport) {
  const r = <T>(chemin: string, methode = 'GET', corps?: unknown) => client.requete<T>(chemin, methode, corps);
  return {
    /** Client Esport (envoi de fichiers par morceaux). */
    client,
    moi: () => r<{ voir: boolean; gerer: boolean }>('/sponsors/moi'),
    comptes: () => r<{ comptes: Array<{ compte: string; pseudo: string | null }> }>('/sponsors/comptes'),
    mentionnables: () => r<{ partenaires: Array<{ id: string; nom: string; niveau: Niveau }> }>('/sponsors/mentionnables'),
    etapes: () => r<{ etapes: Etape[]; gerer: boolean }>('/sponsors/etapes'),
    creerEtape: (nom: string, couleur?: string) => r<{ etapes: Etape[] }>('/sponsors/etapes', 'POST', { nom, couleur }),
    modifierEtape: (id: string, m: { nom?: string | null; couleur?: string; archive?: boolean; index?: number }) => r<{ etapes: Etape[] }>(`/sponsors/etapes/${e(id)}`, 'PATCH', m),
    pipeline: (f: { q?: string; responsable?: string; priorite?: Priorite; team?: string } = {}) => r<Pipeline>(`/sponsors/pipeline${requeteUrl({ ...f })}`),
    creerProspect: (p: SaisieProspect) => r<FicheProspect>('/sponsors/prospects', 'POST', p),
    prospect: (id: string) => r<FicheProspect>(`/sponsors/prospects/${e(id)}`),
    modifierProspect: (id: string, p: SaisieProspect) => r<FicheProspect>(`/sponsors/prospects/${e(id)}`, 'PATCH', p),
    supprimerProspect: (id: string) => r<{ ok: true }>(`/sponsors/prospects/${e(id)}`, 'DELETE'),
    deplacerProspect: (id: string, d: { etapeId: string; index?: number; raisonPerte?: string }) => r<{ ok: true; etapeId: string; issue: IssueEtape; convertible: boolean }>(`/sponsors/prospects/${e(id)}/deplacer`, 'POST', d),
    convertir: (id: string, niveau?: Niveau) => r<{ partenaireId: string }>(`/sponsors/prospects/${e(id)}/convertir`, 'POST', niveau ? { niveau } : {}),
    ajouterContact: (cible: Cible, c: Partial<SaisieContact>) => r<{ contact: Contact }>('/sponsors/contacts', 'POST', { ...cible, ...c }),
    modifierContact: (id: string, c: Partial<SaisieContact>) => r<{ contact: Contact }>(`/sponsors/contacts/${e(id)}`, 'PATCH', c),
    supprimerContact: (id: string) => r<{ ok: true }>(`/sponsors/contacts/${e(id)}`, 'DELETE'),
    ajouterEchange: (cible: Cible, x: { genre: GenreEchange; resume: string; date?: string; contactId?: string; prochaineAction?: string; prochaineActionLe?: string | null }) => r<{ echange: Echange }>('/sponsors/echanges', 'POST', { ...cible, ...x }),
    supprimerEchange: (id: string) => r<{ ok: true }>(`/sponsors/echanges/${e(id)}`, 'DELETE'),
    ajouterLien: (cible: Cible | { contratId: string }, url: string, nom: string, categorie: CategoriePiece) => r<{ pieces: Piece[] }>('/sponsors/pieces', 'POST', { ...cible, genre: 'lien', url, nom, categorie }),
    ajouterFichier: (cible: Cible | { contratId: string }, envoi: string, categorie: CategoriePiece) => r<{ pieces: Piece[] }>('/sponsors/pieces', 'POST', { ...cible, genre: 'fichier', envoi, categorie }),
    supprimerPiece: (id: string) => r<{ ok: true }>(`/sponsors/pieces/${e(id)}`, 'DELETE'),
    lienPiece: (id: string, telecharger = false) => r<{ url: string; expire: string }>(`/sponsors/pieces/${e(id)}/lien`, 'POST', { telecharger }),
    partenaires: (statut?: 'actif' | 'termine') => r<{ partenaires: ResumePartenaire[]; teams: Record<string, string>; noms: Record<string, string | null>; gerer: boolean }>(`/sponsors/partenaires${requeteUrl({ statut })}`),
    creerPartenaire: (p: { nom: string; niveau?: Niveau; secteur?: string; site?: string }) => r<FichePartenaire>('/sponsors/partenaires', 'POST', p),
    partenaire: (id: string) => r<FichePartenaire>(`/sponsors/partenaires/${e(id)}`),
    modifierPartenaire: (id: string, p: Partial<{ nom: string; site: string; secteur: string; niveau: Niveau; statut: 'actif' | 'termine'; teams: string[]; notes: string; responsable: string | null; logoPieceId: string | null; versionAttendue: number }>) =>
      r<FichePartenaire>(`/sponsors/partenaires/${e(id)}`, 'PATCH', p),
    supprimerPartenaire: (id: string) => r<{ ok: true }>(`/sponsors/partenaires/${e(id)}`, 'DELETE'),
    creerContrat: (partenaireId: string, c: SaisieContrat) => r<FichePartenaire>(`/sponsors/partenaires/${e(partenaireId)}/contrats`, 'POST', c),
    modifierContrat: (id: string, c: SaisieContrat) => r<FichePartenaire>(`/sponsors/contrats/${e(id)}`, 'PATCH', c),
    supprimerContrat: (id: string) => r<FichePartenaire>(`/sponsors/contrats/${e(id)}`, 'DELETE'),
    creerObligation: (partenaireId: string, o: SaisieObligation) => r<FichePartenaire>(`/sponsors/partenaires/${e(partenaireId)}/obligations`, 'POST', o),
    modifierObligation: (id: string, o: SaisieObligation) => r<FichePartenaire>(`/sponsors/obligations/${e(id)}`, 'PATCH', o),
    supprimerObligation: (id: string) => r<FichePartenaire>(`/sponsors/obligations/${e(id)}`, 'DELETE'),
    suivre: (id: string, periode: string, fait: number, note?: string) => r<FichePartenaire>(`/sponsors/obligations/${e(id)}/suivi`, 'PUT', { periode, fait, note }),
    tableauDeBord: (annee?: number) => r<TableauDeBord>(`/sponsors/tableau-de-bord${requeteUrl({ annee })}`),
    apercuImport: (contenu: string) => r<ApercuImport>('/sponsors/import/apercu', 'POST', { contenu }),
    importer: (contenu: string, correspondance: Record<string, ChampImport | null>, etapeId?: string) => r<BilanImport>('/sponsors/import', 'POST', { contenu, correspondance, etapeId }),
    exporter: (genre: 'prospects' | 'partenaires') => r<{ nom: string; type: string; contenu: string }>(`/sponsors/export/${genre}.csv?format=json`),
    rgpdExport: (email: string) => r<{ exporteLe: string; contacts: unknown[] }>('/sponsors/rgpd/export', 'POST', { email }),
    rgpdEffacer: (email: string) => r<{ effaces: number }>('/sponsors/rgpd/effacer', 'POST', { email }),
    journal: (avant?: string) => r<{ entrees: EntreeJournalSponsors[]; noms: Record<string, string | null> }>(`/sponsors/journal${requeteUrl({ avant })}`),
  };
}

export type ApiSponsors = ReturnType<typeof apiSponsors>;
