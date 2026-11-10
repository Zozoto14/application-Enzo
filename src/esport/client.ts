/**
 * Client de l'API Esport (serveur https://esport.appdashboard.fr, voir esport/).
 *
 * Authentification : le jeton du relais déjà gardé par l'app (`relaisActif()` :
 * jeton de profil d'un ami, ou jeton maître du Fondateur) est présenté UNE fois
 * à `POST /session` ; le serveur le fait valider par le relais et rend une
 * session courte (`es1.…`, une heure), seule envoyée ensuite.
 *
 * Adresse du serveur, dans l'ordre :
 *  1. `esport.json` publié avec le site (`{ "esport": "https://…" }`, écrit par
 *     le workflow « Site (o2switch) ») ;
 *  2. déduite de l'adresse du relais : `relais.<domaine>` → `esport.<domaine>`
 *     (serveurs hébergés chez o2switch, docs/o2switch.md).
 * Sans réponse du serveur : « Esport pas encore activé », rien d'autre ne casse.
 */

import catalogueBrut from '../../esport/noyau/catalogue.json';
import { langueCourante, tr, trOu, type Langue } from './i18n';
import { traduireServeur } from './i18n/erreurs';

// ------------------------------------------------------------------ Types (miroir de l'API)

export interface ModuleCatalogue {
  cle: string;
  nom: string;
  phase: number;
  description: string;
}
export interface PermissionCatalogue {
  cle: string;
  action: 'voir' | 'creer' | 'modifier' | 'supprimer' | 'special';
  libelle: string;
}
export interface GroupeCatalogue {
  cle: string;
  nom: string;
  module: string | null;
  permissions: PermissionCatalogue[];
}
export interface Catalogue {
  version: number;
  modules: ModuleCatalogue[];
  groupes: GroupeCatalogue[];
  rolesSysteme: Array<{ cle: string; nom: string; couleur: string; description: string; permissions: string[] | '*' }>;
  presets: Array<{ cle: string; nom: string; description: string; modules: string[] | null }>;
  jeux: Array<{ cle: string; nom: string; postes: string[] }>;
}

export const CATALOGUE = catalogueBrut as unknown as Catalogue;

export interface ProfilEsport {
  pseudo: string;
  riotId: string | null;
  discord: string | null;
}
export interface Moi {
  compte: string;
  /** Langue choisie par l'utilisateur dans son profil (null : jamais choisie ; elle PRIME sur la langue par défaut). */
  langue?: Langue | null;
  /** Langue par défaut du compte, définie par l'administrateur (Fondateur) : sert tant que `langue` est null. */
  langueDefaut?: Langue;
  superAdmin: boolean;
  profil: ProfilEsport | null;
  peutCreerTeam: boolean;
  /** Permission globale « Gérer les profils de jeu » (Fondateur, ou délégué par lui). */
  peutGererJeux?: boolean;
  /** Permissions du club (rôles du club, migration 0033 ; vide pour le Fondateur, qui a tout). */
  permissionsGlobales?: string[];
  /** Page Membres › Rôles et permissions (Fondateur, ou permission du club roles.gerer). */
  peutGererRoles?: boolean;
  /** Page Statistiques (Fondateur, ou permission du club statistiques.voir). */
  peutVoirStatistiques?: boolean;
  /** Devblog : rédiger, publier, annoncer sur Discord (Fondateur, ou permission du club devblog.gerer). */
  peutGererDevblog?: boolean;
  /** Salons vocaux temporaires d'Esport HQ (vocaux.configurer) : Administration › Bot Esport HQ › Fonctionnalités. */
  peutConfigurerVocaux?: boolean;
  /** Événements organisés par le club (evenements.gerer) : Administration › Événements. */
  peutGererEvenements?: boolean;
}
export interface Team {
  id: string;
  nom: string;
  slug: string;
  /** Clé du profil de jeu de la team (src/esport/jeux) ; « communication » pour la Team CM. */
  jeu: string;
  /** « jeu » (team de jeu) ou « cm » : la Team CM (migration 0068), équipe de l'espace CM du club. */
  genre?: 'jeu' | 'cm';
  /** Nom et couleur du profil de jeu (serveurs avec profils de jeu). */
  jeuNom?: string;
  jeuCouleur?: string | null;
  description: string;
  logoUrl: string | null;
  fuseau: string;
  creeLe: string;
  archivee: boolean;
}
export interface TeamListee extends Team {
  membres: number;
  modules: string[];
  role: { nom: string; couleur: string } | null;
  suspendu: boolean;
}
export interface DetailTeam {
  team: Team;
  modules: Array<{ cle: string; active: boolean }>;
  membres: number;
  moi: {
    membreId: string | null;
    role: { id: string; nom: string; couleur: string; cle: string | null } | null;
    permissions: string[];
    superAdmin: boolean;
  };
}
export interface Role {
  id: string;
  nom: string;
  couleur: string;
  systeme: boolean;
  cle: string | null;
  position: number;
  permissions: string[];
  membres: number;
  /** Rôle système (hors Propriétaire) : ses permissions par défaut, et s'il a été modifié dans cette team. */
  permissionsParDefaut?: string[];
  modifie?: boolean;
  /** Propriétaire : verrouillé (toujours toutes les permissions). */
  verrouille?: boolean;
  /** Team CM : rôle lié à un rôle CM (nom, couleur, création et suppression dans Rôles et permissions). */
  cmRoleId?: string;
}
export interface Membre {
  id: string;
  compte: string;
  pseudo: string;
  riotId: string | null;
  discord: string | null;
  posteJeu: string | null;
  statut: 'actif' | 'suspendu';
  /** Compte créé depuis l'Esport, pas encore connecté. */
  invite?: boolean;
  rejointLe: string;
  role: { id: string; nom: string; couleur: string; cle: string | null };
  moi: boolean;
}

// ------------------------------------------------------------------ Premier niveau : Membres et Dashboard

export interface AppartenanceCompte {
  teamId: string;
  membreId: string;
  role: { id: string; nom: string; couleur: string; cle: string | null };
  posteJeu: string | null;
  statut: 'actif' | 'suspendu';
  rejointLe: string;
  /** Rôle sous celui de l'acteur (anti-escalade) : il peut agir sur ce membre. */
  gerable: boolean;
}
export interface CompteEsport {
  compte: string;
  pseudo: string;
  riotId: string | null;
  discord: string | null;
  /** Discord ID (17 à 20 chiffres) saisi par le Fondateur ; `null` : « Discord ID manquant ». */
  discordId?: string | null;
  /** Compte Discord lié par /lier (vérifié) : il prime pour les pings du bot. */
  discordLie?: boolean;
  /** Langue par défaut du compte (interface, e-mails, bot) : visible du Fondateur seul. */
  langueDefaut?: Langue;
  /** Langue choisie par l'utilisateur lui-même (prime sur la langue par défaut) : visible du Fondateur seul. */
  langueChoisie?: Langue | null;
  /** « invite » : créé depuis l'Esport, jamais connecté. */
  statut: 'invite' | 'actif';
  inviteLe: string | null;
  activeLe: string | null;
  moi: boolean;
  appartenances: AppartenanceCompte[];
  /**
   * Côté app seulement : compte du hub avec accès à l'Esport, sans fiche
   * Esport (jamais ouvert, aucune team). Lu dans l'Administration, sur
   * l'appareil du Fondateur (`comptesHubSansEsport`).
   */
  horsEsport?: boolean;
}
export interface RoleAnnuaire {
  id: string;
  nom: string;
  couleur: string;
  cle: string | null;
  position: number;
  systeme: boolean;
  /** L'acteur peut attribuer ce rôle (anti-escalade). */
  attribuable: boolean;
}
export interface TeamAnnuaire {
  id: string;
  nom: string;
  slug: string;
  jeu: string;
  /** « cm » : la Team CM (rôles : Responsable CM, Correspondant CM, rôles CM créés). */
  genre?: 'jeu' | 'cm';
  archivee: boolean;
  /** `demander` : permission « Créer des membres » (demande de compte au Fondateur, ajout d'un compte Esport existant). */
  droits: { ajouter: boolean; demander?: boolean; roles: boolean; retirer: boolean };
  roles: RoleAnnuaire[];
}
export interface Annuaire {
  superAdmin: boolean;
  peutCreerCompte: boolean;
  /** Seul le Fondateur modifie un Discord ID (contrôle serveur, 403 sinon). */
  peutModifierDiscordId?: boolean;
  /** Voir toutes les demandes de compte et les refuser (Fondateur, ou comptes.demandes.gerer). */
  peutGererDemandes?: boolean;
  /** Seul le Fondateur règle la langue par défaut d'un compte (contrôle serveur, 403 sinon). */
  peutModifierLangue?: boolean;
  teams: TeamAnnuaire[];
  comptes: CompteEsport[];
  /** Demandes de compte en attente (Fondateur : toutes ; sinon les siennes). */
  demandesEnAttente?: number;
}

/** Demande de compte (permission `members.create`), validée ou refusée par le Fondateur. */
export interface DemandeCompte {
  id: string;
  teamId: string;
  team: string | null;
  teamSlug: string | null;
  role: { id: string; nom: string; couleur: string; cle: string | null };
  demandeur: string;
  demandeurPseudo: string | null;
  pseudo: string;
  /** Adresse proposée : visible du Fondateur et du demandeur tant que la demande attend. */
  email: string | null;
  posteJeu: string | null;
  /** Discord ID proposé par le demandeur (facultatif). */
  discordId?: string | null;
  message: string;
  statut: 'en_attente' | 'validee' | 'refusee' | 'annulee';
  compte: string | null;
  motif: string;
  creeLe: string;
  traiteLe: string | null;
}
export interface ListeDemandes {
  demandes: DemandeCompte[];
  enAttente: number;
  fondateur: boolean;
}
/** Récapitulatif e-mail : adresse MASQUÉE seulement (chiffrée sur le serveur). */
export interface RecapCourriel {
  actif: boolean;
  frequence: 'quotidien' | 'hebdomadaire';
  adresse: string | null;
  dernierEnvoi: string | null;
  dernierStatut?: string | null;
}
export interface Affectation {
  teamId: string;
  roleId: string;
  posteJeu?: string;
}
export interface OccurrenceTableau {
  teamId: string;
  teamNom?: string;
  evenementId: string;
  cle: string;
  type: string;
  titre: string;
  debut: string;
  fin: string;
  lieu: string;
}
export interface CarteTeam {
  team: Team;
  role: { nom: string; couleur: string; cle: string | null } | null;
  effectif: { actifs: number; invites: number; suspendus: number };
  /** `null` : module désactivé ou pas la permission de le voir. */
  prochains: OccurrenceTableau[] | null;
  presence: { jours: number; marques: number; presents: number; taux: number | null } | null;
  resumes: { aResumer: number; enCours: number; plusAncien: string | null; redacteur: boolean } | null;
  taches: { enRetard: number } | null;
  /** Tournois et résultats (migration 0022) : `null` sans module ni permission ; chaque liste aussi. */
  competition?: {
    prochains: Array<{ id: string; tournoi: { id: string; nom: string }; tour: string; debut: string; adversaires: string[] }> | null;
    tournois: Array<{ id: string; nom: string; debut: string | null; fin: string | null; statut: string }> | null;
    derniers: Array<{ id: string; genre: string; date: string; systeme: string; issue: 'victoire' | 'defaite' | 'nul' | null; place: number | null; score: string; adversaires: string[] }> | null;
  } | null;
  /** Date de la dernière activité ; le détail seulement avec le Journal. */
  derniereActivite: { date: string; action?: string; acteur?: string | null; pseudo?: string | null; meta?: Record<string, unknown> } | null;
}
export interface AlerteTableau {
  genre: 'taches' | 'resumes' | 'presence' | 'invites';
  teamId: string;
  teamNom: string;
  nombre: number;
  texte: string;
}
export interface Tableau {
  genereLe: string;
  teams: CarteTeam[];
  global: { resumesARediger: number; evenementsSemaine: OccurrenceTableau[]; alertes: AlerteTableau[] };
}
export interface EntreeJournal {
  id: string;
  action: string;
  /** Module de l'action (« coeur » : team, membres, rôles, invitations). */
  module?: string;
  acteur: string | null;
  entiteType: string | null;
  entiteId: string | null;
  meta: Record<string, unknown>;
  date: string;
}
export interface PageJournal {
  entrees: EntreeJournal[];
  noms: Record<string, string | null>;
  /** Curseur de la page suivante (opaque), ou null. */
  suite: string | null;
  /** Membres de la team (filtre « membre »). */
  membres?: Array<{ compte: string; pseudo: string | null }>;
  /** Durée de conservation du journal (jours ; 0 = illimitée). */
  retentionJours?: number;
}
export interface FiltresJournal {
  avant?: string;
  action?: string;
  module?: string;
  acteur?: string;
  /** Période (AAAA-MM-JJ, incluses, fuseau de la team). */
  du?: string;
  au?: string;
  limite?: number;
}
export interface ReglagesJournal {
  retentionJours: number;
  choix: number[];
  modifiable: boolean;
}
/** Fichier rendu par le serveur pour que l'app l'enregistre (CSV…). */
export interface FichierServeur {
  nom: string;
  type: string;
  contenu: string;
}
/** Statistiques d'une team sur une période (blocs `null` : module désactivé ou droit absent). */
export interface StatsTeam {
  periode: { du: string; au: string; fuseau: string };
  membres: { actifs: number; suspendus: number };
  presence: {
    seances: number;
    taux: number | null;
    reel: Record<'present' | 'retard' | 'absent' | 'excuse' | 'inconnu', number>;
    rsvp: Record<'oui' | 'non' | 'peut_etre' | 'sans_reponse', number>;
    joueurs: Array<{ compte: string; pseudo: string | null; marques: number; taux: number | null }>;
  } | null;
  taches: { creees: number; terminees: number; ouvertes: number; enRetard: number; aFaire: number; enCours: number; objectifs: Record<'actif' | 'atteint' | 'abandonne', number> } | null;
  resumes: { deposes: number; termines: number; enAttente: number } | null;
  activite: { actions: number; membresActifs: number; parModule: Record<string, number>; parJour: Array<{ jour: string; n: number }> } | null;
}
export interface Notification {
  id: string;
  type: string;
  team: { id: string; nom: string | null } | null;
  charge: Record<string, unknown>;
  lue: boolean;
  date: string;
}
export interface Notifications {
  nonLues: number;
  noms: Record<string, string | null>;
  liste: Notification[];
}

// ------------------------------------------------------------------ Phase 3 : résumés de réunions

export type StatutDepot = 'a_resumer' | 'en_cours' | 'termine';
export interface TypeReunion {
  id: string;
  nom: string;
  couleur: string;
  visibilite: 'team' | 'staff';
  global: boolean;
  position: number;
}
export interface Personne {
  compte: string;
  pseudo: string | null;
}
export interface Depot {
  id: string;
  team: { id: string; nom: string | null };
  titre: string;
  lien: string;
  type: TypeReunion | null;
  dateReunion: string;
  note: string;
  statut: StatutDepot;
  deposePar: Personne;
  creeLe: string;
  majLe: string;
  resume: { fichierId: string; le: string | null; par: Personne | null } | null;
  nouveau: boolean;
  vu: { le: string; par: string } | null;
  moi: { deposant: boolean; redacteur: boolean };
  /** Enregistrement déposé (vidéo ou audio), ou null (lien externe seulement). */
  enregistrement?: FichierMedia | null;
  /** Transcription automatique (distincte du résumé rédigé). */
  transcription?: { statut: StatutTranscription; pdf: boolean; peutTranscrire: boolean; externe?: boolean; serveur?: boolean; qualites?: QualiteProposee[]; meilleureQualite?: QualiteTranscription | null; travail?: TravailServeur | null };
}

/**
 * aucune · a_faire (enregistrement déposé) · en_cours (partielle, navigateur) · externe (API serveur) ·
 * serveur (file de transcription du serveur) · prete · echec.
 */
export type StatutTranscription = 'aucune' | 'a_faire' | 'en_cours' | 'externe' | 'serveur' | 'prete' | 'echec';

/** Où se fait la transcription : sur le serveur (automatique), dans ce navigateur, ou par l'API externe. */
export type ModeTranscription = 'serveur' | 'navigateur' | 'externe';

/** Qualité de la transcription sur le serveur (whisper.cpp : modèle et décodage). */
export type QualiteTranscription = 'rapide' | 'equilibree' | 'maximale';

/** Qualité proposée : disponible ou non sur ce serveur, et facteur de durée (secondes de calcul par seconde d'audio). */
export interface QualiteProposee {
  cle: QualiteTranscription;
  disponible: boolean;
  moteur: 'whispercpp' | 'onnx' | null;
  modele: string | null;
  facteur: number | null;
  mesuree: boolean;
}

/** Travail de la file de transcription du serveur (migration 0016). */
export interface TravailServeur {
  statut: 'attente' | 'en_cours' | 'termine' | 'echec' | 'annule';
  modele: string;
  /** Qualité demandée (migration 0035) : rapide, equilibree, maximale. */
  qualite?: QualiteTranscription | null;
  /** « transcription », puis « correction » (relecture par l'IA locale). */
  etape?: 'transcription' | 'correction';
  /** Segments déjà relus par l'IA locale (étape « correction »). */
  correctionFaite?: number;
  langue: string;
  progression: number;
  duree: number | null;
  pourcentage: number;
  /** Temps restant estimé (secondes), quand on le connaît. */
  restantS: number | null;
  /** Réunions avant celle-ci dans la file. */
  rang: number;
  essais: number;
  /** Essais permis (TRANSCRIPTION_ESSAIS) et ceux qui restent. */
  essaisMax?: number;
  essaisRestants?: number;
  /** Nouvel essai prévu (après un échec), à cette heure. */
  prochainEssai: string | null;
  /** En attente depuis plus de 15 min sans essai prévu, ou en cours sans signe de vie : « Relancer maintenant ». */
  bloque?: boolean;
  attenteDepuis?: string | null;
  erreur: string | null;
  debutLe: string | null;
  finLe: string | null;
  majLe: string;
}

/** Analyse d'un média déposé (octets magiques, atomes MP4) : format, codecs, durée. */
export interface InfosMedia {
  format: string;
  nomFormat: string;
  genre: 'video' | 'audio' | 'document' | 'image' | 'archive';
  mime: string;
  codecVideo: string | null;
  codecAudio: string | null;
  duree: number | null;
  peuCompatibleIphone: boolean;
}

/** Fichier stocké sur le serveur (vidéo, enregistrement, PDF). */
export interface FichierMedia {
  id: string;
  nom: string;
  taille: number;
  type: string;
  creeLe: string;
  supprime: boolean;
  media?: InfosMedia | null;
}
export interface FichierDepot {
  id: string;
  nom: string;
  taille: number;
  type: string;
  deposePar: Personne;
  le: string;
  actuel: boolean;
  remplaceLe: string | null;
}
export interface DetailDepot extends Depot {
  fichiers: FichierDepot[];
}
export interface FiltresBoite {
  statut?: StatutDepot;
  team?: string;
  type?: string;
  du?: string;
  au?: string;
  deposePar?: string;
  nouveaux?: boolean;
  tri?: 'recent' | 'ancien' | 'date' | 'statut';
}
export interface Boite {
  depots: Depot[];
  teams: Array<{ id: string; nom: string; redacteur: boolean }>;
  types: TypeReunion[];
  deposants: Personne[];
  attente: number;
  nouveaux: number;
  total: number;
}

// ------------------------------------------------------------------ Phase 3 : objectifs et tâches

export type StatutTache = 'a_faire' | 'en_cours' | 'fait';
export type Priorite = 'basse' | 'normale' | 'haute' | 'urgente';
export interface Objectif {
  id: string;
  titre: string;
  description: string;
  proprietaire: Personne | null;
  dateCible: string | null;
  statut: 'actif' | 'atteint' | 'abandonne';
  progression: { total: number; faites: number; pourcentage: number };
  creePar: Personne | null;
  creeLe: string;
}
export interface Tache {
  id: string;
  titre: string;
  description: string;
  objectif: { id: string; titre: string | null } | null;
  assigne: Personne | null;
  echeance: string | null;
  priorite: Priorite;
  statut: StatutTache;
  enRetard: boolean;
  creePar: Personne | null;
  creeLe: string;
  majLe: string;
  termineLe: string | null;
}
export interface FiltresTaches {
  filtre?: 'miennes' | 'retard';
  statut?: StatutTache;
  objectif?: string;
  assigne?: string;
  priorite?: Priorite;
}

// ------------------------------------------------------------------ Statistiques d'usage (Fondateur)

export type AppareilUsage = 'pc' | 'tablette' | 'telephone' | 'app_pc' | 'discord';
export interface FiltresStatistiques {
  du?: string;
  au?: string;
  team?: string;
  role?: string;
  appareil?: AppareilUsage;
  absents?: number;
}
export interface BlocApercu {
  actifs: number;
  sessions: number;
  vues: number;
  dureeMs: number;
  dureeMoyenneMs: number;
  actions: number;
  inscriptions: number;
  invitationsAcceptees: number;
}
export interface UtilisateurUsage {
  compte: string;
  pseudo: string;
  teams: Array<{ id: string; nom: string | null; role: string; cle: string | null; statut: string }>;
  statut: 'invite' | 'actif';
  inscritLe: string;
  derniereActivite: string | null;
  source: 'mesure' | 'journal' | null;
  jamaisConnecte: boolean;
  inactif: boolean;
  inactifJours: number | null;
  sessions: number;
  dureeMs: number;
  vues: number;
  actions: number;
  appareil: AppareilUsage | null;
  pagesPreferees: Array<{ page: string; vues: number }>;
}
export interface PageUsage {
  page: string;
  module: string | null;
  vues: number;
  visiteurs: number;
  dureeMs: number;
  dureeMoyenneMs: number;
}
export interface StatistiquesUsage {
  genereLe: string;
  fuseau: string;
  periode: { du: string; au: string; jours: number; precedente: { du: string; au: string } };
  filtres: { team: string | null; role: string | null; appareil: AppareilUsage | null; absents: number };
  collecte: { actif: boolean; debut: string | null; agregeJusqua: string | null };
  historique: { reconstitue: boolean; du?: string; au?: string; tronque?: boolean };
  choix: { teams: Array<{ id: string; nom: string; slug: string }>; roles: string[]; appareils: AppareilUsage[]; pages: string[] };
  apercu: { actifsJour: number; actifsSemaine: number; actifsMois: number; periode: BlocApercu; precedente: BlocApercu };
  utilisateurs: UtilisateurUsage[];
  pages: { classement: PageUsage[]; jamais: string[]; nonUtilises: Array<{ team: { id: string; nom: string; slug: string }; modules: string[] }> };
  activite: {
    chaleur: number[][];
    quotidien: Array<{ jour: string; actifs: number; vues: number; sessions: number; actions: number; reconstitue: boolean }>;
    appareils: Array<{ appareil: AppareilUsage; visiteurs: number; sessions: number; vues: number; dureeMs: number }>;
    langues: Array<{ langue: string; visiteurs: number; sessions: number }>;
  };
  teams: Array<{ id: string; nom: string; slug: string; membres: number; visiteurs: number; adoption: number; vues: number; dureeMs: number; actions: number; actionsReconstituees: number }>;
  fonctions: Array<{ fonction: string; n: number; reconstitue: number; utilisateurs: number; actions: Record<string, number> }>;
  erreurs: Array<{ empreinte: string; message: string; page: string | null; n: number; utilisateurs: number; appareils: string[]; derniere: string }>;
}
export interface FicheUsage {
  compte: string;
  pseudo: string | null;
  inscritLe: string | null;
  premiereConnexion: string | null;
  statut: 'invite' | 'actif';
  teams: Array<{ id: string; nom: string; role: string; statut: string }>;
  periode: { du: string; au: string };
  totaux: { sessions: number; vues: number; dureeMs: number; actions: number };
  appareils: string[];
  parJour: Array<{ jour: string; sessions: number; vues: number; dureeMs: number; actions: number }>;
  pages: Array<{ page: string; vues: number; dureeMs: number }>;
  chronologie: Array<{ date: string; source: 'mesure' | 'journal'; genre: 'page' | 'action' | 'erreur'; page: string | null; team: string | null; action: string | null; dureeMs: number; appareil: string | null; erreur: string | null }>;
}
export interface ReglagesUsage {
  collecte: boolean;
  debut: string | null;
  agregeJusqua: string | null;
}

// ------------------------------------------------------------------ Erreurs

export class ErreurEsport extends Error {
  constructor(
    message: string,
    readonly statut: number,
    readonly code: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Le serveur ne répond pas (pas en ligne, pas encore relié) : l'app affiche « Esport pas encore activé ». */
export const CODES_INACTIF = ['injoignable', 'non-configure', 'relais-ancien', 'relais-absent', 'relais-injoignable'];

export const estInactif = (e: unknown): boolean => e instanceof ErreurEsport && CODES_INACTIF.includes(e.code);

/** Documentation d'activation (pour le Fondateur). */
export const DOC_ACTIVATION = 'https://github.com/Zozoto14/application-Enzo/blob/main/docs/esport/deploiement.md';

/** Mention affichée dans l'app (données en clair côté serveur). */
export const mentionDonnees = (): string => tr('client.mention_donnees');

// ------------------------------------------------------------------ Adresse du serveur

type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string | ArrayBuffer | Uint8Array; signal?: unknown; keepalive?: boolean }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/** Adresse acceptée : https, ou http sur la machine locale (développement). */
export function adresseValide(adresse: unknown): adresse is string {
  return typeof adresse === 'string' && (/^https:\/\/[a-z0-9.-]+(:\d+)?(\/[^\s]*)?$/i.test(adresse) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(adresse));
}

/** `https://relais.appdashboard.fr` → `https://esport.appdashboard.fr` (même domaine, hébergement o2switch). */
export function adresseDepuisRelais(relais: string | undefined): string | undefined {
  const propre = relais?.trim() ?? '';
  const domaine = /^https:\/\/relais\.((?:[a-z0-9-]+\.)+[a-z]{2,})\/?$/i.exec(propre);
  return domaine ? `https://esport.${domaine[1].toLowerCase()}` : undefined;
}

/** Adresse publiée avec le site (`esport.json`), si elle existe et est valide. */
export async function adressePubliee(requete: Fetch | undefined): Promise<string | undefined> {
  const est = (globalThis as { location?: { protocol?: string } }).location?.protocol;
  if (!requete || (est !== 'http:' && est !== 'https:')) return undefined;
  try {
    const r = await auPlus(requete('esport.json', { headers: { Accept: 'application/json' } }), 4000);
    if (!r.ok) return undefined;
    const lu = (await r.json()) as { esport?: unknown };
    const adresse = typeof lu?.esport === 'string' ? lu.esport.trim().replace(/\/+$/, '') : undefined;
    return adresseValide(adresse) ? adresse : undefined;
  } catch {
    return undefined;
  }
}

function auPlus<T>(promesse: Promise<T>, ms: number): Promise<T> {
  return new Promise((ok, ko) => {
    const minuterie = setTimeout(() => ko(new ErreurEsport(tr('client.le_serveur_esport_ne'), 0, 'injoignable')), ms);
    promesse.then(
      v => {
        clearTimeout(minuterie);
        ok(v);
      },
      e => {
        clearTimeout(minuterie);
        ko(e);
      },
    );
  });
}

// ------------------------------------------------------------------ Client

export interface ConfigEsport {
  adresse: string;
  /** Jeton du relais (jeton de profil, ou jeton maître du Fondateur). */
  jetonRelais: string;
}

/**
 * Sessions déjà obtenues, par adresse et jeton du relais (rien n'est écrit sur le disque).
 * `surcharge` : le serveur annonce « surcharge-methode » (réponse de /session).
 */
const sessions = new Map<string, { session: string; expire: number; surcharge: boolean; fonctions?: string[] }>();
/** Ouvertures de session en cours, par adresse et jeton du relais (une seule à la fois). */
const ouvertures = new Map<string, Promise<string>>();

/**
 * « Le premier qui enregistre a la main » (docs/esport/temps-reel.md) : version d'un objet lue par un écran
 * d'édition ouvert (`useVerrouOptimiste`), par adresse du serveur et route de l'objet. Tant qu'elle est notée,
 * chaque PATCH, PUT ou DELETE de CETTE route part avec `X-Version-Lue` ; le serveur refuse (409
 * `conflit-version`) si quelqu'un a enregistré entre-temps. La réponse donne la nouvelle version
 * (`X-Version-Objet`), notée aussitôt : ses propres enregistrements successifs ne font jamais de conflit.
 */
const versionsLues = new Map<string, number>();
const suiveursVersions = new Set<(cle: string, version: number) => void>();
const cleVersion = (adresse: string, chemin: string) => `${adresse}${chemin.split('?')[0]}`;
export function noterVersionLue(adresse: string, chemin: string, version: number | undefined): void {
  const cle = cleVersion(adresse, chemin);
  if (version === undefined) versionsLues.delete(cle);
  else versionsLues.set(cle, version);
}
export function versionLue(adresse: string, chemin: string): number | undefined {
  return versionsLues.get(cleVersion(adresse, chemin));
}
/** Nouvelle version d'un objet après SON propre enregistrement (`X-Version-Objet`). */
export function suivreVersions(f: (cle: string, version: number) => void): () => void {
  suiveursVersions.add(f);
  return () => {
    suiveursVersions.delete(f);
  };
}
/** Fonction « temps réel » annoncée par le serveur (réponse de /session). */
export const FONCTION_TEMPS_REEL = 'temps-reel';

/**
 * Surcharge de méthode : le frontal mutualisé d'o2switch (LiteSpeed / ModSecurity) bloque ou perd
 * des PATCH, PUT et DELETE (ou leur préliminaire CORS), ce que le navigateur rapporte comme une
 * erreur réseau (« injoignable »), pas comme un code HTTP. Dès que le serveur annonce la fonction
 * « surcharge-methode » (à l'ouverture de session, sans requête de plus), ces méthodes partent
 * TOUJOURS en POST + `X-Methode` ; le serveur les traite exactement comme l'original
 * (esport/noyau/entetes.mjs). Un serveur ancien (sans l'annonce) reçoit la méthode d'origine.
 */
export const METHODES_SURCHARGEES = ['PATCH', 'PUT', 'DELETE'];
export const FONCTION_SURCHARGE = 'surcharge-methode';

/** Réponse non JSON d'un intermédiaire qui refuse la requête (pare-feu applicatif, méthode interdite). */
const STATUTS_FRONTAL = [403, 405, 406, 411, 501];

export function oublierSessions(): void {
  sessions.clear();
  ouvertures.clear();
}

/** Écouteurs des appels d'écriture réussis (statistiques d'usage : actions clés), voir src/esport/usage. */
const ecouteursAppels = new Set<(methode: string, chemin: string) => void>();
export function ecouterAppels(f: (methode: string, chemin: string) => void): () => void {
  ecouteursAppels.add(f);
  return () => {
    ecouteursAppels.delete(f);
  };
}
const signalerAppel = (methode: string, chemin: string): void => {
  if (methode === 'GET') return;
  for (const f of [...ecouteursAppels]) {
    try {
      f(methode, chemin);
    } catch {
      // un écouteur ne casse jamais un appel
    }
  }
};

export interface ClientEsport {
  config: ConfigEsport;
  sante(): Promise<{ ok: boolean; version: number }>;
  ouvrir(): Promise<Moi>;
  moi(): Promise<Moi>;
  majProfil(p: { pseudo: string; riotId?: string; discord?: string }): Promise<Moi>;
  /** Langue du profil (français / anglais), enregistrée sur le compte : le bot et les exports la connaissent. */
  majLangue(langue: Langue): Promise<Moi>;
  /** Efface le choix de l'utilisateur : la langue définie par l'administrateur s'applique de nouveau. */
  reinitialiserLangue(): Promise<Moi>;
  exporterMesDonnees(): Promise<unknown>;
  supprimerMesDonnees(): Promise<void>;
  teams(): Promise<TeamListee[]>;
  creerTeam(t: { nom: string; jeu: string; description?: string; preset: string; modules?: string[] }): Promise<DetailTeam>;
  team(id: string): Promise<DetailTeam>;
  modifierTeam(id: string, champs: Partial<{ nom: string; description: string; jeu: string; archivee: boolean }>): Promise<DetailTeam>;
  supprimerTeam(id: string): Promise<void>;
  changerModules(id: string, modules: Record<string, boolean>): Promise<DetailTeam>;
  roles(id: string): Promise<Role[]>;
  creerRole(id: string, r: { nom: string; couleur: string; permissions: string[] }): Promise<Role>;
  modifierRole(id: string, roleId: string, r: Partial<{ nom: string; couleur: string; permissions: string[] }>): Promise<Role>;
  supprimerRole(id: string, roleId: string): Promise<void>;
  /** Rétablit les permissions par défaut d'un rôle système, pour cette team. */
  retablirRole(id: string, roleId: string): Promise<Role>;
  membres(id: string): Promise<Membre[]>;
  modifierMembre(id: string, membreId: string, m: Partial<{ roleId: string; posteJeu: string | null; statut: 'actif' | 'suspendu' }>): Promise<Membre>;
  retirerMembre(id: string, membreId: string): Promise<void>;
  journal(id: string, filtres?: FiltresJournal): Promise<PageJournal>;
  exporterJournal(id: string, filtres?: Omit<FiltresJournal, 'avant' | 'limite'>): Promise<FichierServeur>;
  reglagesJournal(id: string): Promise<ReglagesJournal>;
  changerRetentionJournal(id: string, retentionJours: number): Promise<ReglagesJournal>;
  stats(id: string, periode?: { du?: string; au?: string }): Promise<StatsTeam>;
  /** Fondateur : données Esport d'un membre (RGPD). */
  exporterCompte(compte: string): Promise<unknown>;
  /** Fondateur : suppression (anonymisation) du compte Esport d'un membre. */
  supprimerCompte(compte: string): Promise<void>;
  /** Ajoute un compte existant à une team, avec un rôle : par son identifiant (déjà visible), ou son pseudo exact (« Créer des membres »). */
  ajouterMembre(id: string, m: { compte?: string; pseudo?: string; roleId: string; posteJeu?: string }): Promise<CompteEsport | null>;
  /** Demandes de compte : les siennes (Fondateur : toutes celles en attente). */
  demandes(): Promise<ListeDemandes>;
  /** Dépose une demande de compte (permission « Créer des membres »). */
  demanderCompte(d: { teamId: string; roleId: string; pseudo: string; email: string; discordId?: string; posteJeu?: string; message?: string }): Promise<DemandeCompte>;
  /** Fondateur : refuse une demande. */
  refuserDemande(id: string, motif?: string): Promise<DemandeCompte>;
  /** Le demandeur annule sa demande en attente. */
  annulerDemande(id: string): Promise<void>;
  // Premier niveau (toutes teams)
  /** Page Membres : comptes de toutes les teams où l'on voit les membres. */
  annuaire(): Promise<Annuaire>;
  /** Dashboard : résumé de toutes ses teams (une seule requête). */
  tableau(): Promise<Tableau>;
  /** Fondateur : contrôle une invitation directe AVANT de créer le compte du hub (rien n'est écrit). */
  verifierPreinscription(c: { pseudo: string; discordId: string; affectations: Affectation[]; demandeId?: string }): Promise<void>;
  /**
   * Ajoute un compte à une ou plusieurs teams d'un coup (un rôle par team) : compte connu (invité, actif, avec
   * ou sans team) ; compte du hub jamais connecté (Fondateur : `pseudo` requis). Tout ou rien.
   */
  ajouterATeams(compte: string, c: { affectations: Affectation[]; pseudo?: string; discordId?: string; langue?: Langue }): Promise<CompteEsport | null>;
  /** Fondateur : pré-enregistre le compte du hub tout juste créé, avec ses teams. */
  preinscrire(c: { compte: string; pseudo: string; discordId: string; affectations: Affectation[]; demandeId?: string; langue?: Langue }): Promise<CompteEsport | null>;
  /** Fondateur SEUL : langue par défaut d'un compte (interface tant que l'utilisateur n'a pas choisi, e-mails, bot) ; 403 pour tout autre rôle. */
  majLangueDefaut(compte: string, langue: Langue): Promise<CompteEsport | null>;
  /** Fondateur SEUL : pose, corrige ou retire (`null`) le Discord ID d'un membre (403 pour tout autre rôle). */
  majDiscordId(compte: string, discordId: string | null): Promise<CompteEsport | null>;
  /** Récapitulatif e-mail des notifications importantes (désactivé par défaut). */
  recapCourriel(): Promise<RecapCourriel>;
  reglerRecapCourriel(r: { actif: boolean; adresse?: string; frequence?: 'quotidien' | 'hebdomadaire' }): Promise<RecapCourriel>;
  /** Fondateur : compte supprimé dans l'Administration → retiré de l'Esport. */
  retirerCompte(compte: string): Promise<{ ok: boolean; retire: boolean; teams: number }>;
  notifications(): Promise<Notifications>;
  marquerLues(tout: boolean, ids?: string[]): Promise<Notifications>;
  // Résumés de réunions (phase 3)
  typesReunion(id: string): Promise<TypeReunion[]>;
  creerTypeReunion(id: string, t: { nom: string; couleur?: string; visibilite: 'team' | 'staff'; global?: boolean }): Promise<TypeReunion>;
  modifierTypeReunion(id: string, typeId: string, t: Partial<{ nom: string; couleur: string; visibilite: 'team' | 'staff' }>): Promise<TypeReunion>;
  supprimerTypeReunion(id: string, typeId: string): Promise<void>;
  /** Dépôt d'une réunion : lien externe, ou enregistrement déposé (`envoi` terminé), ou les deux. */
  deposerReunion(id: string, d: { lien?: string; envoi?: string; typeId: string; dateReunion: string; titre: string; note?: string; transcription?: ModeTranscription; langue?: string; qualite?: QualiteTranscription }): Promise<Depot>;
  mesDepots(id: string): Promise<Depot[]>;
  resumesTeam(id: string, limite?: number): Promise<Depot[]>;
  depot(id: string, depotId: string): Promise<DetailDepot>;
  supprimerDepot(id: string, depotId: string): Promise<void>;
  boiteResumes(filtres?: FiltresBoite): Promise<Boite>;
  marquerVu(id: string, depotId: string): Promise<DetailDepot>;
  changerStatutDepot(id: string, depotId: string, statut: StatutDepot): Promise<DetailDepot>;
  envoyerPdf(id: string, depotId: string, octets: ArrayBuffer | Uint8Array, nom: string): Promise<DetailDepot>;
  lienPdf(id: string, depotId: string, options?: { fichierId?: string; telecharger?: boolean }): Promise<{ url: string; expire: string }>;
  // Objectifs et tâches (phase 3)
  objectifs(id: string): Promise<Objectif[]>;
  creerObjectif(id: string, o: { titre: string; description?: string; proprietaire?: string | null; dateCible?: string | null }): Promise<Objectif>;
  modifierObjectif(id: string, objectifId: string, o: Partial<{ titre: string; description: string; proprietaire: string | null; dateCible: string | null; statut: Objectif['statut'] }>): Promise<Objectif>;
  supprimerObjectif(id: string, objectifId: string): Promise<void>;
  taches(id: string, filtres?: FiltresTaches): Promise<{ jour: string; taches: Tache[] }>;
  creerTache(id: string, t: { titre: string; description?: string; assigne?: string | null; echeance?: string | null; priorite?: Priorite; statut?: StatutTache; objectifId?: string | null }): Promise<Tache>;
  modifierTache(id: string, tacheId: string, t: Partial<{ titre: string; description: string; assigne: string | null; echeance: string | null; priorite: Priorite; statut: StatutTache; objectifId: string | null }>): Promise<Tache>;
  supprimerTache(id: string, tacheId: string): Promise<void>;
  exporterTaches(id: string, filtres?: FiltresTaches): Promise<FichierServeur>;
  exporterObjectifs(id: string): Promise<FichierServeur>;
  /** Statistiques d'usage : envoie un lot (`keepalive` : départ de la page, sans attendre la réponse). */
  envoyerUsage?(lot: unknown, keepalive?: boolean): Promise<{ actif?: boolean } | undefined>;
  /** Appel générique avec la session (modules : planning, etc. ; voir src/esport/planning/api.ts). */
  requete<T>(chemin: string, methode?: string, corps?: unknown): Promise<T>;
  /** Temps réel (src/esport/tempsReel) : session courante (`forcer` : une nouvelle, après un 401). */
  jetonSession?(forcer?: boolean): Promise<string>;
  /** Temps réel : le serveur l'annonce-t-il (fonction « temps-reel » de /session) ? */
  tempsReelDisponible?(): Promise<boolean>;
  /** Temps réel : le `fetch` de CE client (le canal n'en prend jamais un autre : faux réseau en test). */
  fetchTempsReel?: Fetch;
  /** Envoi binaire avec la session (morceau d'une vidéo) : réponse JSON. */
  binaire<T>(chemin: string, methode: string, octets: Uint8Array, entetes?: Record<string, string>, options?: { delai?: number; signal?: unknown }): Promise<T>;
}

/** Paramètres d'URL (valeurs vides ignorées). */
export function requeteUrl(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v === true ? '1' : String(v))}`)
    .join('&');
  return p ? `?${p}` : '';
}

export function clientEsport(config: ConfigEsport, requete: Fetch = globalThis.fetch as unknown as Fetch, maintenant: () => number = Date.now): ClientEsport {
  const cle = `${config.adresse}|${config.jetonRelais}`;

  /** Le serveur répond-il (GET /sante) ? Sert à distinguer une panne d'un refus du frontal. */
  async function serveurRepond(): Promise<boolean> {
    try {
      return (await auPlus(requete(`${config.adresse}/sante`, { headers: { Accept: 'application/json' } }), 5000)).ok;
    } catch {
      return false;
    }
  }

  async function brut<T>(
    chemin: string,
    methode = 'GET',
    corps?: unknown,
    jeton?: string,
    binaire?: { octets: ArrayBuffer | Uint8Array; type: string; entetes: Record<string, string>; delai?: number; signal?: unknown },
    surcharger = false,
  ): Promise<T> {
    let r: Awaited<ReturnType<Fetch>>;
    const surcharge = surcharger && METHODES_SURCHARGEES.includes(methode);
    const cleObjet = METHODES_SURCHARGEES.includes(methode) ? cleVersion(config.adresse, chemin) : undefined;
    const lue = cleObjet === undefined ? undefined : versionsLues.get(cleObjet);
    try {
      r = await auPlus(
        requete(`${config.adresse}${chemin}`, {
          method: surcharge ? 'POST' : methode,
          headers: {
            'Content-Type': binaire ? binaire.type : 'application/json',
            'Accept-Language': langueCourante(),
            ...(binaire?.entetes ?? {}),
            ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}),
            ...(surcharge ? { 'X-Methode': methode } : {}),
            ...(lue !== undefined ? { 'X-Version-Lue': String(lue) } : {}),
          },
          body: binaire ? binaire.octets : corps === undefined ? undefined : JSON.stringify(corps),
          ...(binaire?.signal ? { signal: binaire.signal } : {}),
        }),
        binaire?.delai ?? (binaire ? 120_000 : 15_000),
      );
    } catch (e) {
      if (e instanceof ErreurEsport) throw e;
      if ((e as { name?: string })?.name === 'AbortError') throw new ErreurEsport(tr('client.envoi_annule'), 0, 'annule');
      // Écriture coupée en route alors que le serveur répond : refus du frontal, pas une panne.
      if (methode !== 'GET' && chemin !== '/sante' && (await serveurRepond())) throw new ErreurEsport(tr('client.requete_refusee_frontal'), 0, 'refuse-frontal');
      throw new ErreurEsport(tr('client.le_serveur_esport_est'), 0, 'injoignable');
    }
    let lu: unknown;
    try {
      lu = await r.json();
    } catch {
      lu = undefined;
    }
    if (!r.ok) {
      const o = (lu ?? {}) as { erreur?: string; code?: string; details?: Record<string, unknown> };
      // Pas de JSON de l'API (page d'erreur de l'hébergeur, serveur absent) : pas encore activé.
      if (!o.code) {
        // Page d'erreur d'un intermédiaire sur une écriture (pare-feu, méthode interdite) alors que le serveur répond.
        if (methode !== 'GET' && STATUTS_FRONTAL.includes(r.status) && (await serveurRepond())) throw new ErreurEsport(tr('client.requete_refusee_frontal'), r.status, 'refuse-frontal');
        throw new ErreurEsport(tr('client.le_serveur_esport_ne_2'), r.status, 'injoignable');
      }
      throw new ErreurEsport(o.erreur ? traduireServeur(o.erreur) : tr('client.erreur', { status: r.status }), r.status, o.code, o.details);
    }
    if (cleObjet !== undefined && versionsLues.has(cleObjet)) {
      const v = Number((r as { headers?: { get?(n: string): string | null } }).headers?.get?.('X-Version-Objet') ?? NaN);
      if (Number.isSafeInteger(v) && v > 0) {
        versionsLues.set(cleObjet, v);
        for (const f of [...suiveursVersions]) f(cleObjet, v);
      }
    }
    return lu as T;
  }

  async function session(forcer = false, perimee?: string): Promise<string> {
    const connue = sessions.get(cle);
    if (!forcer && connue && connue.expire - 60_000 > maintenant()) return connue.session;
    // Une session neuve vient d'arriver pendant qu'une requête échouait avec l'ancienne : on la reprend.
    if (forcer && perimee !== undefined && connue && connue.session !== perimee && connue.expire > maintenant()) return connue.session;
    // Une seule ouverture à la fois : les requêtes lancées ensemble (chargement d'une page, session expirée)
    // attendent la même réponse au lieu d'ouvrir chacune une session (rafale de POST /session : limite de
    // débit atteinte pour tout le réseau du club, « Trop de demandes » au hasard).
    const enVol = ouvertures.get(cle);
    if (enVol) return enVol;
    const ouverture = (async () => {
      const r = await brut<Moi & { session: string; expire: string; fonctions?: unknown }>('/session', 'POST', {}, config.jetonRelais);
      const fonctions = Array.isArray(r.fonctions) ? r.fonctions.filter((f): f is string => typeof f === 'string') : [];
      // Échéance relative : une horloge d'appareil décalée ne fait ni garder une session expirée, ni en rouvrir sans cesse.
      const restant = Date.parse(r.expire) - (typeof (r as { heure?: unknown }).heure === 'number' ? ((r as { heure?: number }).heure as number) : Date.parse(r.expire) - 3_600_000);
      const expire = maintenant() + Math.max(60_000, Math.min(Number.isFinite(restant) ? restant : 3_600_000, 3_600_000));
      sessions.set(cle, { session: r.session, expire, surcharge: fonctions.includes(FONCTION_SURCHARGE), fonctions });
      return r.session;
    })();
    ouvertures.set(cle, ouverture);
    try {
      return await ouverture;
    } finally {
      if (ouvertures.get(cle) === ouverture) ouvertures.delete(cle);
    }
  }

  async function appel<T>(chemin: string, methode = 'GET', corps?: unknown, binaire?: Parameters<typeof brut>[4]): Promise<T> {
    let r: T;
    let jetonUtilise: string | undefined;
    const surcharge = () => sessions.get(cle)?.surcharge ?? false;
    try {
      jetonUtilise = await session();
      r = await brut<T>(chemin, methode, corps, jetonUtilise, binaire, surcharge());
    } catch (e) {
      // Session expirée (ou serveur redémarré avec une nouvelle clé) : une nouvelle, une fois (partagée par les requêtes en cours).
      if (e instanceof ErreurEsport && e.code === 'session') {
        const jeton = await session(true, jetonUtilise);
        r = await brut<T>(chemin, methode, corps, jeton, binaire, surcharge());
      } else throw e;
    }
    signalerAppel(methode, chemin);
    return r;
  }

  const t = (id: string) => `/teams/${encodeURIComponent(id)}`;
  return {
    config,
    jetonSession: forcer => session(forcer),
    fetchTempsReel: requete,
    tempsReelDisponible: async () => {
      await session();
      return sessions.get(cle)?.fonctions?.includes(FONCTION_TEMPS_REEL) ?? false;
    },
    sante: () => brut('/sante'),
    ouvrir: async () => {
      await session();
      return appel<Moi>('/moi');
    },
    moi: () => appel('/moi'),
    majProfil: p => appel('/moi', 'PUT', p),
    majLangue: langue => appel('/moi/langue', 'PUT', { langue }),
    reinitialiserLangue: () => appel('/moi/langue', 'PUT', { langue: null }),
    exporterMesDonnees: () => appel('/moi/export'),
    supprimerMesDonnees: async () => {
      await appel('/moi', 'DELETE');
    },
    teams: async () => (await appel<{ teams: TeamListee[] }>('/teams')).teams,
    creerTeam: corps => appel('/teams', 'POST', corps),
    team: id => appel(t(id)),
    modifierTeam: (id, champs) => appel(t(id), 'PATCH', champs),
    supprimerTeam: async id => {
      await appel(t(id), 'DELETE');
    },
    changerModules: (id, modules) => appel(`${t(id)}/modules`, 'PUT', { modules }),
    roles: async id => (await appel<{ roles: Role[] }>(`${t(id)}/roles`)).roles,
    creerRole: (id, r) => appel(`${t(id)}/roles`, 'POST', r),
    modifierRole: (id, roleId, r) => appel(`${t(id)}/roles/${encodeURIComponent(roleId)}`, 'PATCH', r),
    retablirRole: (id, roleId) => appel(`${t(id)}/roles/${encodeURIComponent(roleId)}/retablir`, 'POST'),
    supprimerRole: async (id, roleId) => {
      await appel(`${t(id)}/roles/${encodeURIComponent(roleId)}`, 'DELETE');
    },
    membres: async id => (await appel<{ membres: Membre[] }>(`${t(id)}/membres`)).membres,
    modifierMembre: (id, membreId, m) => appel(`${t(id)}/membres/${encodeURIComponent(membreId)}`, 'PATCH', m),
    retirerMembre: async (id, membreId) => {
      await appel(`${t(id)}/membres/${encodeURIComponent(membreId)}`, 'DELETE');
    },
    ajouterMembre: (id, m) => appel(`${t(id)}/membres`, 'POST', m),
    demandes: () => appel('/comptes/demandes'),
    demanderCompte: d => appel('/comptes/demandes', 'POST', d),
    refuserDemande: (id, motif) => appel(`/comptes/demandes/${encodeURIComponent(id)}/refuser`, 'POST', motif ? { motif } : {}),
    annulerDemande: async id => {
      await appel(`/comptes/demandes/${encodeURIComponent(id)}`, 'DELETE');
    },
    annuaire: () => appel('/membres'),
    tableau: () => appel('/dashboard'),
    verifierPreinscription: async c => {
      await appel('/comptes', 'POST', { ...c, verifier: true });
    },
    journal: (id, f = {}) => appel(`${t(id)}/journal${requeteUrl({ ...f })}`),
    exporterJournal: (id, f = {}) => appel(`${t(id)}/journal/export.csv${requeteUrl({ ...f, format: 'json' })}`),
    reglagesJournal: id => appel(`${t(id)}/journal/reglages`),
    changerRetentionJournal: (id, retentionJours) => appel(`${t(id)}/journal/reglages`, 'PUT', { retentionJours }),
    stats: (id, p = {}) => appel(`${t(id)}/stats${requeteUrl({ ...p })}`),
    exporterCompte: compte => appel(`/admin/comptes/${encodeURIComponent(compte)}/export`),
    supprimerCompte: async compte => {
      await appel(`/admin/comptes/${encodeURIComponent(compte)}`, 'DELETE');
    },
    preinscrire: c => appel('/comptes', 'POST', c),
    majDiscordId: (compte, discordId) => appel(`/comptes/${encodeURIComponent(compte)}/discord-id`, 'PUT', { discordId }),
    majLangueDefaut: (compte, langue) => appel(`/comptes/${encodeURIComponent(compte)}/langue-defaut`, 'PUT', { langue }),
    recapCourriel: () => appel('/moi/recap-courriel'),
    reglerRecapCourriel: r => appel('/moi/recap-courriel', 'PUT', r),
    ajouterATeams: (compte, c) => appel(`/comptes/${encodeURIComponent(compte)}/teams`, 'POST', c),
    retirerCompte: compte => appel(`/admin/comptes/${encodeURIComponent(compte)}/hub`, 'DELETE'),
    notifications: () => appel('/notifications'),
    marquerLues: (tout, ids) => appel('/notifications/lues', 'POST', tout ? { tout: true } : { ids: ids ?? [] }),
    // ---- Résumés de réunions
    typesReunion: async id => (await appel<{ types: TypeReunion[] }>(`${t(id)}/resumes/types`)).types,
    creerTypeReunion: (id, ty) => appel(`${t(id)}/resumes/types`, 'POST', ty),
    modifierTypeReunion: (id, typeId, ty) => appel(`${t(id)}/resumes/types/${encodeURIComponent(typeId)}`, 'PATCH', ty),
    supprimerTypeReunion: async (id, typeId) => {
      await appel(`${t(id)}/resumes/types/${encodeURIComponent(typeId)}`, 'DELETE');
    },
    deposerReunion: (id, d) => appel(`${t(id)}/resumes`, 'POST', d),
    mesDepots: async id => (await appel<{ depots: Depot[] }>(`${t(id)}/resumes/miens`)).depots,
    resumesTeam: async (id, limite) => (await appel<{ resumes: Depot[] }>(`${t(id)}/resumes${requeteUrl({ limite })}`)).resumes,
    depot: (id, depotId) => appel(`${t(id)}/resumes/${encodeURIComponent(depotId)}`),
    supprimerDepot: async (id, depotId) => {
      await appel(`${t(id)}/resumes/${encodeURIComponent(depotId)}`, 'DELETE');
    },
    boiteResumes: (f = {}) => appel(`/resumes/boite${requeteUrl({ ...f })}`),
    marquerVu: (id, depotId) => appel(`${t(id)}/resumes/${encodeURIComponent(depotId)}/vu`, 'POST', {}),
    changerStatutDepot: (id, depotId, statut) => appel(`${t(id)}/resumes/${encodeURIComponent(depotId)}`, 'PATCH', { statut }),
    envoyerPdf: (id, depotId, octets, nom) =>
      appel(`${t(id)}/resumes/${encodeURIComponent(depotId)}/pdf`, 'PUT', undefined, { octets, type: 'application/pdf', entetes: { 'X-Nom-Fichier': encodeURIComponent(nom) } }),
    lienPdf: (id, depotId, options = {}) => appel(`${t(id)}/resumes/${encodeURIComponent(depotId)}/lien`, 'POST', options),
    // ---- Objectifs et tâches
    objectifs: async id => (await appel<{ objectifs: Objectif[] }>(`${t(id)}/objectifs`)).objectifs,
    creerObjectif: (id, o) => appel(`${t(id)}/objectifs`, 'POST', o),
    modifierObjectif: (id, objectifId, o) => appel(`${t(id)}/objectifs/${encodeURIComponent(objectifId)}`, 'PATCH', o),
    supprimerObjectif: async (id, objectifId) => {
      await appel(`${t(id)}/objectifs/${encodeURIComponent(objectifId)}`, 'DELETE');
    },
    taches: (id, f = {}) => appel(`${t(id)}/taches${requeteUrl({ ...f })}`),
    creerTache: (id, ta) => appel(`${t(id)}/taches`, 'POST', ta),
    modifierTache: (id, tacheId, ta) => appel(`${t(id)}/taches/${encodeURIComponent(tacheId)}`, 'PATCH', ta),
    supprimerTache: async (id, tacheId) => {
      await appel(`${t(id)}/taches/${encodeURIComponent(tacheId)}`, 'DELETE');
    },
    exporterTaches: (id, f = {}) => appel(`${t(id)}/taches/export.csv${requeteUrl({ ...f, format: 'json' })}`),
    exporterObjectifs: id => appel(`${t(id)}/objectifs/export.csv?format=json`),
    envoyerUsage: async (lot, keepalive = false) => {
      if (!keepalive) return appel<{ actif?: boolean }>('/usage', 'POST', lot);
      // Départ de la page : `keepalive` (la requête survit à la fermeture), session déjà connue seulement.
      const connue = sessions.get(cle);
      if (!connue || connue.expire <= maintenant()) return undefined;
      void Promise.resolve()
        .then(() => requete(`${config.adresse}/usage`, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${connue.session}` }, body: JSON.stringify(lot) }))
        .catch(() => undefined);
      return undefined;
    },
    requete: (chemin, methode, corps) => appel(chemin, methode, corps),
    binaire: (chemin, methode, octets, entetes = {}, options = {}) =>
      appel(chemin, methode, undefined, { octets, type: 'application/octet-stream', entetes, delai: options.delai ?? 180_000, signal: options.signal }),
  };
}

/**
 * Configuration de l'Esport sur cet appareil : relais relié (jeton) et
 * adresse du serveur. `undefined` + raison si l'Esport ne peut pas s'ouvrir.
 */
export async function trouverConfig(
  relais: { relais: string; jeton: string } | undefined,
  requete: Fetch | undefined = globalThis.fetch as unknown as Fetch,
): Promise<{ config?: ConfigEsport; raison?: 'sans-relais' | 'sans-adresse' }> {
  if (!relais?.jeton) return { raison: 'sans-relais' };
  const adresse = (await adressePubliee(requete)) ?? adresseDepuisRelais(relais.relais);
  if (!adresse) return { raison: 'sans-adresse' };
  return { config: { adresse, jetonRelais: relais.jeton } };
}

// ------------------------------------------------------------------ Aides pures

const ACTIONS_COLONNES: ReadonlyArray<PermissionCatalogue['action']> = ['voir', 'creer', 'modifier', 'supprimer', 'special'];
export const LIBELLES_COLONNES: Record<PermissionCatalogue['action'], string> = { get voir() {
      return tr('pageTeam.voir');
    }, get creer() {
      return tr('client.creer');
    }, get modifier() {
      return tr('membresRoles.modifier');
    }, get supprimer() {
      return tr('discord.supprimer');
    }, get special() {
      return tr('client.special');
    } };

/** Lignes de la matrice des permissions (seulement les groupes du cœur et des modules activés). */
export function lignesMatrice(modulesActifs: readonly string[]): Array<GroupeCatalogue & { colonnes: Record<PermissionCatalogue['action'], PermissionCatalogue[]> }> {
  return CATALOGUE.groupes
    .filter(g => g.module === null || modulesActifs.includes(g.module))
    .map(g => ({
      ...g,
      nom: nomGroupe(g),
      colonnes: Object.fromEntries(ACTIONS_COLONNES.map(a => [a, g.permissions.filter(p => p.action === a).map(p => ({ ...p, libelle: libellePermission(p) }))])) as Record<
        PermissionCatalogue['action'],
        PermissionCatalogue[]
      >,
    }));
}

// Noms du catalogue (catalogue.json, en français) traduits : clés `cat.*` des dictionnaires.
const slugPoste = (p: string): string =>
  p
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
export const nomModule = (cle: string): string => trOu(`cat.module.${cle}.nom`, CATALOGUE.modules.find(m => m.cle === cle)?.nom ?? cle);
export const descriptionModule = (cle: string): string => trOu(`cat.module.${cle}.description`, CATALOGUE.modules.find(m => m.cle === cle)?.description ?? '');
export const nomGroupe = (g: GroupeCatalogue): string => trOu(`cat.groupe.${g.cle}`, g.nom);
export const libellePermission = (p: PermissionCatalogue): string => trOu(`cat.perm.${p.cle}`, p.libelle);
/** « Strats : Créer » pour une clé `strats.create` (la clé telle quelle si inconnue). */
export function nomPermission(cle: string): string {
  for (const g of CATALOGUE.groupes) {
    const p = g.permissions.find(x => x.cle === cle);
    if (p) return `${nomGroupe(g)} : ${libellePermission(p)}`;
  }
  return cle;
}
/** Nom d'un rôle : les six rôles système (reconnus à leur nom français) sont traduits, pas les rôles créés par la team. */
export const nomRole = (nom: string): string => {
  const systeme = CATALOGUE.rolesSysteme.find(r => r.nom === nom);
  return systeme ? trOu(`cat.role.${systeme.cle}.nom`, nom) : nom;
};
/** Type de réunion : les cinq types système (reconnus à leur nom français) sont traduits, pas ceux créés par la team. */
const TYPES_REUNION_SYSTEME: Record<string, string> = { Hebdo: 'weekly', Mensuel: 'monthly', 'Débrief de match': 'debrief', Staff: 'staff', Autre: 'autre' };
export const nomTypeReunion = (nom: string): string => (TYPES_REUNION_SYSTEME[nom] ? trOu(`cat.typereunion.${TYPES_REUNION_SYSTEME[nom]}`, nom) : nom);
export const descriptionRole = (r: { cle: string; description: string }): string => trOu(`cat.role.${r.cle}.description`, r.description);
export const nomPreset = (p: { cle: string; nom: string }): string => trOu(`cat.preset.${p.cle}.nom`, p.nom);
export const descriptionPreset = (p: { cle: string; description: string }): string => trOu(`cat.preset.${p.cle}.description`, p.description);
/** Nom d'un jeu : traduit pour les jeux du catalogue (Valorant, Autre jeu), sinon le nom de son profil. */
/** Identifiant fixe du CM du club (la team de l'espace CM, migration 0068). */
export const TEAM_CM_ID = '00000000-0000-4000-8000-00000000c0de';

export const nomJeu = (cle: string, nom?: string | null): string => trOu(`cat.jeu.${cle}`, nom ?? CATALOGUE.jeux.find(j => j.cle === cle)?.nom ?? cle);
/** Poste d'un jeu (« Duelliste » / « Duelist »). */
export const nomPoste = (poste: string): string => trOu(`cat.poste.${slugPoste(poste)}`, poste);
