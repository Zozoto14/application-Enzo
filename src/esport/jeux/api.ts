/**
 * Profils de jeu (esport/noyau/jeux/, migration 0021) : types et appels de l'API.
 *
 * Un profil décrit un jeu AVANT la création d'une team : formats de match, système de score, modes,
 * maps, personnages, roster, rôles, champs libres. Géré par le Fondateur (permission globale
 * `jeux.gerer`), avec un assistant IA facultatif (brouillon relu, différences proposées à valider).
 */

import { requeteUrl, type ClientEsport } from '../client';
import { trJeux } from '../i18n/jeux';
import type { ModeleStrat } from '../strats/modeles';

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
  /** `ecart` : rounds d'écart qui terminent les prolongations (absent : 2). */
  prolongations?: { active: boolean; regle: string; ecart?: number };
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
export type TypeRepere = 'site' | 'spawn-attaque' | 'spawn-defense' | 'cashout' | 'coffre' | 'spawn' | 'plant' | 'callout' | 'autre';
export const TYPES_REPERES: readonly TypeRepere[] = ['site', 'spawn-attaque', 'spawn-defense', 'cashout', 'coffre', 'spawn', 'plant', 'callout', 'autre'];
/** Calibrage d'une map : deux points du repère carré (1000) et la distance réelle qui les sépare. */
export interface EchelleCarte {
  pxParMetre: number;
  points: number[];
  distance: number;
  /** Absent : calibrée à la main ; `import` : calculée depuis les données du jeu ; `approx` : approximative, à vérifier. */
  methode?: 'import' | 'approx';
}
/** Callout : zone nommée (polygone) sur la map. */
export interface ZoneCarte {
  cle: string;
  nom: string;
  points: number[];
  couleur?: string;
}
/** Repère : site, spawn, cashout, coffre… */
export interface RepereCarte {
  cle: string;
  nom: string;
  type: TypeRepere;
  x: number;
  y: number;
  niveau?: number;
  /** Repère importé (remplacé au prochain import). */
  importe?: boolean;
}
export interface NiveauCarte {
  cle: string;
  nom: string;
}
export interface CarteJeu {
  cle: string;
  nom: string;
  image: string | null;
  /** Dans le pool compétitif. */
  actif: boolean;
  modes: string[];
  /** Image déposée par le Fondateur (lien signé dans `ProfilJeu.images`). */
  fichier?: string;
  echelle?: EchelleCarte;
  zones?: ZoneCarte[];
  reperes?: RepereCarte[];
  niveaux?: NiveauCarte[];
  source?: SourceCarte;
}
export type FormeCapacite = 'cercle' | 'mur' | 'cone' | 'trajet' | 'ligne' | 'rect' | 'point';
export const FORMES_CAPACITE: readonly FormeCapacite[] = ['cercle', 'mur', 'cone', 'trajet', 'ligne', 'rect', 'point'];
export type CategorieCapacite = 'basique' | 'signature' | 'ultime' | 'passif' | 'specialisation' | 'gadget' | 'arme';
export const CATEGORIES_CAPACITE: readonly CategorieCapacite[] = ['basique', 'signature', 'ultime', 'passif', 'specialisation', 'gadget', 'arme'];
/** Capacité d'un personnage (agent, classe) : dimensions en mètres, durée en secondes. */
export interface CapaciteJeu {
  cle: string;
  nom: string;
  touche: string;
  categorie: CategorieCapacite;
  forme: FormeCapacite;
  rayon?: number;
  longueur?: number;
  largeur?: number;
  ouverture?: number;
  portee?: number;
  duree?: number;
  charges?: number;
  cout?: number;
  courbable?: boolean;
  /** Mur double : deux lignes parallèles écartées de la largeur (Fast Lane de Neon). */
  double?: boolean;
  notes?: string;
  /** Accent propre à la capacité (#rrggbb), quand il diffère de celui du personnage. */
  couleur?: string;
  /** Données pré-remplies, à vérifier par le Fondateur. */
  aVerifier: boolean;
}
export interface ClasseJeu {
  cle: string;
  nom: string;
  /** Icône du rôle importée (lien signé dans `ProfilJeu.images`). */
  fichier?: string;
}
/** Capacité OFFICIELLE d'un personnage (import valorant-api.com) : nom, description, icône importée. */
export interface CapaciteOfficielle {
  touche: string;
  slot?: string;
  nom: string;
  description?: string;
  /** Icône importée (lien signé dans `ProfilJeu.images`). */
  fichier?: string;
  /** Adresse d'origine de l'icône (CDN Riot : seule acceptée dans le document d'une strat). */
  url?: string;
}
export interface PersonnageJeu {
  cle: string;
  nom: string;
  classe: string | null;
  image: string | null;
  actif: boolean;
  /** Accent du personnage (#rrggbb) : couleur de ses capacités dans une strat réglée sur « Couleur : agent ». */
  couleur?: string;
  capacites?: CapaciteJeu[];
  /** Portrait importé (lien signé dans `ProfilJeu.images`) et son origine. */
  fichier?: string;
  source?: SourceCarte;
  officielles?: CapaciteOfficielle[];
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
  /** Modèle de l'éditeur de strats des teams de ce jeu (absent : serveur ancien). */
  modeleStrat?: ModeleStrat;
  statut: 'actif' | 'archive';
  version: number;
}
/** Compte rendu de l'import d'une map. */
export interface LigneImport {
  carte: string;
  image: 'importee' | 'inchangee' | 'gardee' | 'sans-adresse';
  echelle: 'importee' | 'approximative' | 'gardee';
  reperes: number;
  erreur?: string;
}
/** Compte rendu de l'import des agents, par agent. */
export interface LigneImportAgent {
  agent: string;
  portrait: 'importee' | 'inchangee' | 'gardee' | 'absente';
  /** Icônes de capacités nouvellement importées. */
  capacites: number;
  ajoute?: boolean;
  erreur?: string;
}
/** Source d'une image importée. */
export interface SourceCarte {
  fournisseur: string;
  url: string;
  le?: string;
  empreinte?: string;
  aVerifier: boolean;
  /** Page d'origine (wiki), licence et attribution (maps proposées). */
  page?: string;
  licence?: string;
  licenceUrl?: string;
  attribution?: string;
}

export type StatutCarteProposee = 'a-valider' | 'validee' | 'rejetee';
/** Ce que la validation changerait dans le profil. */
export interface ChangementsCarte {
  nouvelle: boolean;
  image: 'ajout' | 'remplacement' | 'identique' | 'aucune';
  echelle: 'ajout' | 'remplacement' | 'identique' | 'gardee' | 'aucune';
  reperes: number;
}
/** Map proposée par le serveur (wiki The Finals, valorant-api.com), à valider. */
export interface CarteProposee {
  cle: string;
  nom: string;
  statut: StatutCarteProposee;
  fournisseur: string;
  fichier: string | null;
  vueDessus: boolean;
  imageManuelle: boolean;
  imageUrl: string | null;
  page: string | null;
  licence: { texte: string; url: string | null } | null;
  attribution: string | null;
  echelle: EchelleCarte | null;
  echelleManuelle: boolean;
  competitive: boolean | null;
  horsCompetition: boolean;
  variantes: string[];
  modes: string[];
  reperes: number;
  erreur: string | null;
  dansProfil: boolean;
  changements: ChangementsCarte;
  majLe: string;
  decideLe: string | null;
}
export interface ListeCartesProposees {
  cleJeu: string;
  version: number;
  modele: ModeleStrat;
  cartes: CarteProposee[];
  images: Record<string, ImageJeu>;
}
export interface LignePreparation {
  carte: string;
  statut: 'nouvelle' | 'rafraichie' | 'mise-a-jour' | 'deja-validee' | 'deja-rejetee';
  erreur?: string;
}

/** Lien signé (6 h) d'une image déposée, et ses dimensions en pixels. */
export interface ImageJeu {
  url: string | null;
  expire: string | null;
  largeur: number;
  hauteur: number;
}
export interface ProfilJeu extends EnteteJeu {
  donnees: DonneesJeu;
  /** Images déposées citées par les maps : `{ [fichier]: lien signé }`. */
  images?: Record<string, ImageJeu>;
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
    /** Absents : serveur ancien. */
    cartesImages?: number;
    cartesCalibrees?: number;
    capacites?: number;
    capacitesAVerifier?: number;
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
  /** Pendant le calcul : étape n/total, lecture des pages (jetons), jetons écrits, début du calcul. */
  progression?: { etape: number; etapes: number; cle?: string | null; libelle: string; lecture?: { total: number; cache: number; traites: number }; ecrits?: number; depuis?: string; le: string } | null;
  /** Place dans la file d'attente (travail en attente seulement). */
  placeFile?: number;
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
export type ModeIa = 'local' | 'api' | 'local-api';
/** Moteurs de l'IA : API principale, API secondaire, Claude (API Anthropic), IA locale (docs/esport/ia-api.md). */
export type MoteurIa = 'api' | 'api2' | 'claude' | 'local';
/** Tâches qui ont chacune leur ordre de repli : profils de jeu, tâches légères (traductions, posts CM). */
export type TacheIa = 'profils' | 'leger';
export type OrdresIa = Record<TacheIa, MoteurIa[]>;
/** Un moteur dans l'Administration IA : jamais la valeur de la clé, seulement présente ou absente. */
export interface EtatMoteurIa {
  id: MoteurIa;
  configure: boolean;
  raison: string | null;
  pret: boolean;
  fournisseur: string | null;
  modele: string | null;
  hote: string | null;
  cle: 'presente' | 'absente' | null;
  externe: boolean;
  raisonnement: boolean;
  effort: string | null;
  images: boolean;
  appelsMois: number;
  erreursMois: number;
  plafond: number | null;
  latenceMoyenneMs: number | null;
  dernierAppel: { le: string; genre: string; statut: string; dureeMs: number | null; erreur: string | null } | null;
  /** Claude : modèle et effort des tâches légères, dernière erreur et dernière latence (jamais la clé). */
  modeleLeger?: string | null;
  effortLeger?: string | null;
  derniereErreur?: { code: string; le: string } | null;
  derniereLatenceMs?: number | null;
}
/** IA locale (llama.cpp sur le serveur) : installation, moteur en marche ou non, mesures. */
export interface EtatIaLocale {
  installe: boolean;
  raison: string | null;
  modele?: string | null;
  nomModele?: string | null;
  moteur?: { version: string | null; route: string | null } | null;
  threads?: number | null;
  contexte?: number | null;
  enMarche?: boolean;
  ailleurs?: boolean;
  demarrage?: boolean;
  depuis?: string | null;
  file?: number;
  derniereErreur?: string | null;
  derniereVitesse?: { jetonsParSeconde: number; le: string | null; source: 'requete' | 'test' } | null;
  benchmark?: { jetonsParSeconde: number; le: string | null } | null;
  dernierTempsReponseMs?: number | null;
  dernierAppelLe?: string | null;
  /** Arrêts de force par l'hébergeur (SIGKILL) : au-delà de `max`, IA locale indisponible et sautée dans les ordres. */
  hebergement?: { indisponible: boolean; tues: number; max: number; depuis: string | null } | null;
}
/** Transcription sur le serveur (Administration IA) : moteur, modèles, état de la file et du processus de fond. */
export interface EtatTranscriptionAdmin {
  disponible: boolean;
  raison: string | null;
  moteur: string;
  qualites: Record<string, { disponible: boolean; moteur: string | null; modele: string | null }>;
  whispercpp: { installe: boolean; desactive: { le: string | null; raison: string } | null };
  dernierPassage: string | null;
  lanceur: { le: string; raison: string; n?: number } | null;
  file: Record<string, number>;
  bloques: number;
}
/** Tâche confidentielle (réunions, suivi, strats) : IA locale seulement, sauf levée par le Fondateur. */
export type TacheConfidentielle = 'transcription' | 'correction' | 'resumes' | 'suivi' | 'strats';
export interface ConfidentialiteIa {
  locales: Array<{ cle: TacheConfidentielle; libelle: string; externeAutorise: boolean; le: string | null }>;
  externes: Array<{ cle: string; libelle: string }>;
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
  /** Moteur utilisé : IA locale (serveur), clé d'API, ou locale d'abord avec l'API en secours. */
  mode?: ModeIa;
  /** Modes utilisables avec ce qui est installé / configuré. */
  modesPossibles?: ModeIa[];
  local?: EtatIaLocale;
  transcription?: EtatTranscriptionAdmin | null;
  /** Les moteurs (API principale, secondaire, Claude, IA locale) et leurs statistiques du mois. */
  moteurs?: EtatMoteurIa[];
  /** Ordre de repli de chaque tâche (réglé ici, sinon IA_ORDRE / IA_ORDRE_LEGER). */
  ordres?: OrdresIa;
  ordresDefaut?: OrdresIa;
  /** Tâches qui restent sur le serveur (IA locale seulement) et celles qui peuvent partir chez le fournisseur. */
  confidentialite?: ConfidentialiteIa;
  reglages: { quotaAppels: number; quotaAppelsApi2?: number; quotaAppelsClaude?: number; quotaVerifications: number; autoActif: boolean; mode?: ModeIa; ordres?: OrdresIa };
  usage: { mois: string; appels: number; appelsApi2?: number; appelsClaude?: number; appelsLocaux?: number; verifications: number; plafondAppels: number; plafondAppelsApi2?: number; plafondAppelsClaude?: number; plafondVerifications: number };
  dernierAppel: { le: string; genre: string; statut: string; fournisseur?: string | null; modele: string | null; dureeMs: number | null; erreur: string | null; jeu: string | null } | null;
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
  modeleStrat?: ModeleStrat;
  donnees: DonneesJeu;
  version?: number;
}

/** Résultat d'un test de moteur (`enCours` : test encore en tâche de fond, interrogé ensuite par son `test.id`). */
export interface ResultatTestIa {
  ok: boolean | null;
  enCours?: boolean;
  test?: { id: string; debutLe?: string | null; plafondMs?: number | null };
  reponse?: boolean;
  dureeMs?: number | null;
  cible?: MoteurIa;
  moteur?: MoteurIa;
  erreur?: { code: string; message: string };
  etat: EtatIa;
}

export function apiJeux(client: ClientEsport) {
  const j = (cle: string) => `/jeux/${encodeURIComponent(cle)}`;
  return {
    liste: (tous = false) => client.requete<ListeJeux>(`/jeux${tous ? '?tous=1' : ''}`),
    detail: (cle: string) => client.requete<ProfilJeu>(j(cle)),
    pourTeam: (teamId: string) => client.requete<ProfilJeu>(`/teams/${encodeURIComponent(teamId)}/jeu`),
    creer: (s: SaisieJeu) => client.requete<ProfilJeu>('/jeux', 'POST', s),
    modifier: (cle: string, s: Partial<SaisieJeu> & { version: number }) => client.requete<ProfilJeu>(j(cle), 'PATCH', s),
    /** Dépôt d'une image (fond d'une map) : base64 (sans en-tête « data: »). */
    deposerImage: (cle: string, corps: { type: string; donnees: string; nom?: string }) =>
      client.requete<{ id: string; url: string | null; expire: string | null; largeur: number; hauteur: number; type: string; taille: number; nom: string }>(`${j(cle)}/images`, 'POST', corps),
    /** Import serveur des images de maps et de l'échelle (Valorant : valorant-api.com ; The Finals : `urls`). */
    importer: (cle: string, corps: { version?: number; urls?: Record<string, string>; remplacer?: boolean }) =>
      client.requete<{ rapport: LigneImport[]; inchange: boolean; jeu: ProfilJeu }>(`${j(cle)}/importer`, 'POST', corps),
    importerAgents: (cle: string, corps: { version?: number; remplacer?: boolean }) =>
      client.requete<{ rapport: LigneImportAgent[]; inchange: boolean; jeu: ProfilJeu }>(`${j(cle)}/importer-agents`, 'POST', corps),
    cartesProposees: (cle: string) => client.requete<ListeCartesProposees>(`${j(cle)}/cartes-proposees`),
    preparerCartes: (cle: string) => client.requete<ListeCartesProposees & { rapport: LignePreparation[] }>(`${j(cle)}/cartes-proposees/preparer`, 'POST', {}),
    validerCartes: (cle: string, corps: { cartes?: string[]; toutes?: boolean }) =>
      client.requete<ListeCartesProposees & { validees: string[]; jeu: ProfilJeu }>(`${j(cle)}/cartes-proposees/valider`, 'POST', corps),
    rejeterCartes: (cle: string, cartes: string[]) => client.requete<ListeCartesProposees>(`${j(cle)}/cartes-proposees/rejeter`, 'POST', { cartes }),
    remplacerImageProposee: (cle: string, carte: string, corps: { url: string } | { type: string; donnees: string; nom?: string }) =>
      client.requete<ListeCartesProposees>(`${j(cle)}/cartes-proposees/${encodeURIComponent(carte)}/image`, 'POST', corps),
    calibrerProposee: (cle: string, carte: string, corps: { points: number[]; distance: number }) =>
      client.requete<ListeCartesProposees>(`${j(cle)}/cartes-proposees/${encodeURIComponent(carte)}/echelle`, 'PUT', corps),
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
    reglerIa: (r: Partial<Omit<EtatIa['reglages'], 'ordres'>> & { ordres?: Partial<Record<TacheIa, MoteurIa[] | null>>; externes?: Partial<Record<TacheConfidentielle, boolean>> }) => client.requete<EtatIa>('/jeux/ia/reglages', 'PUT', r),
    /**
     * Test d'un moteur. Le serveur répond au plus après 10 s ; un test plus long (modèle à raisonnement, IA locale qui
     * charge son modèle) continue en tâche de fond et son résultat est demandé toutes les 3 s (6 min au plus).
     */
    testerIa: async (cible?: MoteurIa, { pauseMs = 3000, maxMs = 6 * 60_000 }: { pauseMs?: number; maxMs?: number } = {}): Promise<ResultatTestIa> => {
      let r = await client.requete<ResultatTestIa>('/jeux/ia/test', 'POST', cible ? { cible } : {});
      const debut = Date.now();
      while (r.enCours && r.test?.id && Date.now() - debut < maxMs) {
        await new Promise<void>(ok => setTimeout(() => ok(), pauseMs));
        const suite = await client.requete<ResultatTestIa>(`/jeux/ia/test/${encodeURIComponent(r.test.id)}`);
        r = { ...suite, etat: suite.etat ?? r.etat };
      }
      if (r.enCours) return { ...r, ok: false, enCours: false, erreur: { code: 'ia-delai', message: trJeux('jeux.test_trop_long') } };
      return r;
    },
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
