/**
 * Client de la section CM (migration 0023), par l'appel générique du client Esport (`client.requete`).
 * Types miroirs de l'API (esport/noyau/cm/). Voir docs/esport/cm.md.
 */

import { requeteUrl, type ClientEsport } from '../client';

/** Permissions d'un rôle CM : celles de la section, et celles de la rubrique Sponsors (migration 0024, niveau club). */
export type PermissionCm =
  | 'cm.voir'
  | 'cm.deposer'
  | 'cm.editer'
  | 'cm.valider'
  | 'cm.gerer'
  | 'cm.clips.proposer'
  | 'sponsors.voir'
  | 'sponsors.gerer'
  // Drive de la section (migration 0027).
  | 'cm.drive.voir'
  | 'cm.drive.envoyer'
  | 'cm.drive.gerer'
  // Trombinoscope de la page Membres (migration 0030).
  | 'membres.trombi.voir'
  | 'membres.trombi.editer'
  // Badges du trombinoscope (migration 0032).
  | 'membres.badges.gerer'
  // Réunions de l'équipe CM (migration 0039).
  | 'cm.reunions.voir'
  | 'cm.reunions.gerer';
/** Le compte a-t-il un droit sur le Drive (dans une liste de permissions CM) ? */
export const voitDrive = (p: readonly string[]): boolean => p.some(x => x === 'cm.drive.voir' || x === 'cm.drive.envoyer' || x === 'cm.drive.gerer');
export type Reseau = 'x' | 'instagram' | 'tiktok';
export type StatutPost = 'brouillon' | 'a_valider' | 'valide' | 'refuse' | 'publie';
export type CleListe = 'idees' | 'preparation' | 'a_valider' | 'valide' | 'publie';
export type StatutClip = 'propose' | 'retenu' | 'refuse' | 'utilise';
export type GenreDepot = 'info' | 'photo' | 'actu' | 'recrue' | 'resultat' | 'evenement' | 'autre';
export type TextesPost = Partial<Record<Reseau, { fr: string; en: string }>>;
export interface LiensCarte {
  resultatId?: string;
  tournoiId?: string;
  matchId?: string;
  teamId?: string;
  clips?: string[];
  membres?: string[];
  /** Partenaires mentionnés (« mention sponsor ») : un post publié compte pour leurs contreparties. */
  sponsors?: string[];
}

export const PORTEE_CLUB = 'club';
export const GENRES_DEPOT: readonly GenreDepot[] = ['info', 'photo', 'actu', 'recrue', 'resultat', 'evenement', 'autre'];
export const STATUTS_CLIP: readonly StatutClip[] = ['propose', 'retenu', 'refuse', 'utilise'];

export interface TeamCm {
  id: string;
  nom: string | null;
  slug?: string | null;
  logoUrl?: string | null;
}
export interface MoiCm {
  espace: boolean;
  /** Permissions de la rubrique Sponsors (affectation « club ») : sponsors.voir, sponsors.gerer. */
  sponsors?: string[];
  club: PermissionCm[];
  teams: Array<TeamCm & { permissions: PermissionCm[] }>;
  gerer: boolean;
  /** Réunions de l'équipe CM (migration 0039) : l'équipe CM voit l'agenda ; un membre du club invité voit ses réunions. */
  reunions?: { voir: boolean; gerer: boolean; invite: boolean };
  /**
   * DATA › Ressources : l'équipe CM, ou un compte hors équipe CM avec qui une ressource est partagée (il n'y voit que
   * celles-là). L'espace du club est réservé à l'équipe CM : un rôle de team (Manager) n'ouvre que l'onglet CM de sa team.
   */
  ressources?: boolean;
}
export interface DroitsTableau {
  voir: boolean;
  deposer: boolean;
  editer: boolean;
  valider: boolean;
  gerer: boolean;
  commenter: boolean;
  /** Régler l'accès au tableau (migration 0046) : cm.gerer ou créateur, au niveau « peut modifier ». */
  acces?: boolean;
}
/** Accès d'un tableau (migration 0046) : tous ceux qui ont accès au CM, ou restreint aux personnes et rôles choisis. */
export type AccesTableau = 'tous' | 'restreint';
export type GenreAcces = 'compte' | 'role_cm' | 'role_club' | 'role_team';
export type NiveauAcces = 'voir' | 'modifier';
export interface RegleAcces {
  genre: GenreAcces;
  cible: string;
  niveau: NiveauAcces;
  nom?: string | null;
}
export interface RoleProposeAcces {
  id: string;
  nom: string;
  couleur: string;
  team?: { id: string; nom: string | null };
}
export interface ReglageAcces {
  tableau: { id: string; nom: string | null; cleDefaut: string | null; portee: string; creePar: string | null };
  acces: AccesTableau;
  regles: RegleAcces[];
  /** Qui voit le tableau aujourd'hui (restreint) ; null s'il est ouvert. */
  effectifs: Array<{ compte: string; pseudo: string; niveau: NiveauAcces }> | null;
  options: { personnes: Array<{ compte: string; pseudo: string }>; rolesCm: RoleProposeAcces[]; rolesClub: RoleProposeAcces[]; rolesTeam: RoleProposeAcces[] };
  moi: string;
}
/** Fond d'un tableau (migration 0042) : teinte ou dégradé prédéfini (src/esport/cm/fonds.ts), ou image (lien signé). */
export type FondTableau = { genre: 'couleur' | 'degrade'; cle: string } | { genre: 'image'; image?: string };
/** Fond saisi : prédéfini, image du Drive (`drive` : élément du Drive) ou envoyée (`envoi`), ou null (thème). */
export type SaisieFond = { genre: 'couleur' | 'degrade'; cle: string } | { genre: 'image'; drive: string } | { genre: 'image'; envoi: string } | null;
/** Événement d'un calendrier de team superposé au calendrier éditorial (lecture seule). */
export interface EvenementTeam {
  id: string;
  /** planning : vu par un membre ; match / tournoi : compétition publiable (CM du club). */
  genre: 'planning' | 'match' | 'tournoi';
  type: string;
  titre: string;
  debut: string;
  fin: string | null;
  jour?: boolean;
  lieu: string;
  description: string;
  matchId: string | null;
  tournoiId: string | null;
  publiable: boolean;
}
export interface CalendrierTeam {
  id: string;
  nom: string;
  couleur: string;
  acces: 'planning' | 'competition';
  evenements: EvenementTeam[];
}
/** Drapeau d'urgence d'une carte (migration 0046) ; null : aucun. */
export type Urgence = 'faible' | 'moyen' | 'urgent' | 'critique';
export interface TableauListe {
  id: string;
  nom: string | null;
  cleDefaut: string | null;
  portee: string;
  team: TeamCm | null;
  couleur: string;
  description: string;
  version: number;
  archive: boolean;
  trello: boolean;
  /** Accès (migration 0046) : « restreint » affiche un cadenas. */
  acces?: AccesTableau;
  majLe: string;
  cartes?: number;
  aValider?: number;
  /** Commentaires non lus du compte sur ce tableau (migration 0045). */
  nonLus?: number;
  /** Cartes (non archivées) en urgence critique / urgente (migration 0046). */
  urgences?: { critique: number; urgent: number };
  droits?: DroitsTableau;
  /** Fond (migration 0042) ; null : fond du thème. */
  fond?: FondTableau | null;
}
export interface ListeTableaux {
  tableaux: TableauListe[];
  /** Commentaires non lus sur tous les tableaux visibles (serveur récent). */
  nonLus?: number;
  portees: Array<{ portee: string; team: TeamCm | null; permissions: PermissionCm[] }>;
}
export interface ListeCm {
  id: string;
  nom: string | null;
  cle: CleListe | null;
  position: number;
  archive: boolean;
  /** Colonne de fin (migration 0050) : les cartes déposées ici sont terminées ; absent d'un serveur ancien. */
  fin?: boolean;
  /** La proposition « marquer comme colonne de fin » a été refusée pour cette colonne. */
  finIgnoree?: boolean;
  /** Tri des cartes de la colonne (migration 0052) : automatique (urgence puis échéance) ou ordre manuel ; absent d'un serveur ancien (manuel). */
  tri?: 'auto' | 'manuel';
}
export interface Etiquette {
  id: string;
  nom: string;
  couleur: string;
  /** Cartes (archivées comprises) qui la portent ; absent à la création. */
  cartes?: number;
}
export interface CarteResume {
  id: string;
  listeId: string;
  teamId: string | null;
  titre: string;
  description: boolean;
  position: number;
  couverture: { couleur?: string; image?: string } | null;
  echeance: string | null;
  echeanceFaite: boolean;
  datePublication: string | null;
  post: boolean;
  statut: StatutPost | null;
  reseaux: Reseau[];
  origine: string;
  depotGenre: GenreDepot | null;
  etiquettes: string[];
  membres: string[];
  /** Drapeau d'urgence (migration 0046) ; absent d'un serveur ancien. */
  urgence?: Urgence | null;
  /** Carte terminée : déposée dans une colonne de fin (migration 0050). */
  terminee?: boolean;
  termineeLe?: string | null;
  commentaires: number;
  /** Commentaires de la carte écrits par d'autres depuis la dernière ouverture (migration 0045). */
  nonLus?: number;
  checklist: { total: number; faits: number };
  pieces: number;
  archive: boolean;
  version: number;
  modifiable: boolean;
}
export interface Personne {
  compte: string;
  pseudo: string;
}
export interface DetailTableau {
  tableau: TableauListe;
  droits: DroitsTableau;
  moi: string;
  listes: ListeCm[];
  etiquettes: Etiquette[];
  cartes: CarteResume[];
  noms: Record<string, string | null>;
  personnes: Personne[];
  /** Total des commentaires non lus du tableau. */
  nonLus?: number;
}
export interface Piece {
  id: string;
  genre: 'fichier' | 'lien';
  nom: string;
  url: string | null;
  trello: boolean;
  fichier: { id: string; type: string; taille: number } | null;
  /** Fichier d'un autre Drive que celui du tableau ou du club : la pièce suit sa source (migration 0049). */
  driveCroise?: boolean;
  /** Fichier d'un Drive que l'acteur ne voit pas : ni nom ni lien. */
  driveInaccessible?: boolean;
  creeLe: string;
}
export interface Commentaire {
  id: string;
  auteur: string | null;
  auteurNom: string | null;
  texte: string;
  creeLe: string;
  majLe: string;
  trello: boolean;
  moi: boolean;
  /** Écrit par quelqu'un d'autre depuis la dernière ouverture de la carte par le compte. */
  nouveau?: boolean;
}
export interface Activite {
  id: string;
  acteur: string | null;
  action: string;
  meta: Record<string, unknown>;
  date: string;
}
export interface CarteDetail {
  id: string;
  tableauId: string;
  listeId: string;
  teamId: string | null;
  titre: string;
  description: string;
  position: number;
  couverture: { couleur?: string; pieceId?: string } | null;
  echeance: string | null;
  echeanceFaite: boolean;
  datePublication: string | null;
  urgence?: Urgence | null;
  /** Terminée le … par … (migration 0050) ; null : carte ouverte. */
  termineeLe?: string | null;
  termineePar?: string | null;
  post: boolean;
  statut: StatutPost | null;
  reseaux: Reseau[];
  textes: TextesPost;
  liens: LiensCarte;
  publications: Partial<Record<Reseau, string>>;
  soumisPar: string | null;
  soumisLe: string | null;
  validePar: string | null;
  valideLe: string | null;
  refusMotif: string | null;
  refusePar: string | null;
  publiePar: string | null;
  publieLe: string | null;
  origine: string;
  depotGenre: GenreDepot | null;
  trello: boolean;
  archive: boolean;
  creePar: string | null;
  creeLe: string;
  majLe: string;
  version: number;
  etiquettes: string[];
  membres: string[];
  checklists: Array<{ id: string; nom: string; elements: Array<{ id: string; texte: string; fait: boolean }> }>;
  commentaires: Commentaire[];
  /** Dernière ouverture de la carte par le compte avant cette lecture (séparateur « Nouveaux »). */
  vuAvant?: string | null;
  nonLus?: number;
  /** Le compte suit la carte (notifié de ses commentaires). */
  suivie?: boolean;
  pieces: Piece[];
  activite: Activite[];
  clips: Array<{ id: string; titre: string; statut: StatutClip; genre: 'fichier' | 'lien' }>;
  resumes: { resultat?: ResumeLie; match?: ResumeLie; tournoi?: ResumeLie };
  /** Partenaires mentionnés, nom seulement (serveur récent). */
  sponsors?: Array<{ id: string; nom: string }>;
}
export type ResumeLie = { titre: string; phrase: string } | { masque: true };
export interface ProblemePost {
  reseau: Reseau | null;
  langue: 'fr' | 'en' | null;
  code: 'aucun-reseau' | 'texte-manquant' | 'trop-long' | 'trop-de-hashtags';
}
export interface ReponseCarte {
  carte: CarteDetail;
  droits: DroitsTableau & { modifier: boolean };
  noms: Record<string, string | null>;
  problemes: ProblemePost[];
}
export interface CarteTransverse {
  id: string;
  titre: string;
  tableauId: string;
  tableau: { id: string; nom: string | null; cleDefaut: string | null; portee: string; team: TeamCm | null } | null;
  listeId: string;
  teamId: string | null;
  team: TeamCm | null;
  statut: StatutPost | null;
  post: boolean;
  reseaux: Reseau[];
  datePublication: string | null;
  urgence?: Urgence | null;
  soumisPar: string | null;
  soumisLe: string | null;
  origine: string;
  version: number;
  archive?: boolean;
  textes?: TextesPost;
  droits: { valider: boolean; editer: boolean };
}
export interface EtatCm {
  versions: Record<string, number>;
  aValider: number;
  /** Cartes critiques ou urgentes des tableaux visibles (migration 0046). */
  urgences?: number;
  /** Commentaires non lus : total et par tableau (migration 0045). */
  nonLus?: { total: number; tableaux: Record<string, number> };
  /** Ressources de DATA › Ressources partagées avec le compte, pas encore ouvertes (migration 0048). */
  ressources?: number;
}
export interface PageTeamCm {
  team: TeamCm & { fuseau: string };
  permissions: PermissionCm[];
  tableaux: Array<{ id: string; nom: string | null; cleDefaut: string | null; couleur: string; version: number; acces?: AccesTableau }>;
  depots: Array<{ id: string; titre: string; genre: GenreDepot; auteur: string | null; creeLe: string; statut: StatutPost | null; liste: { nom: string | null; cle: CleListe | null }; tableauId: string }>;
  noms: Record<string, string | null>;
  genres: GenreDepot[];
}
export interface MatchsTeam {
  resultats: Array<{ id: string; titre: string; phrase: string; date: string }>;
  matchs: Array<{ id: string; titre: string; adversaires: string[]; debut: string | null; tournoiId: string }>;
  tournois: Array<{ id: string; nom: string; debut: string | null; statut: string }>;
}
export interface Prerempli {
  titre: string;
  textes: TextesPost;
  liens: LiensCarte;
}
export interface Clip {
  id: string;
  team: TeamCm;
  proposePar: string | null;
  genre: 'fichier' | 'lien';
  url: string | null;
  youtube: string | null;
  fichier: { id: string; type: string; taille: number; nom: string } | null;
  resultat: { id: string; date: string; adversaires: string[] } | null;
  match: { id: string; tournoi: string; tour: string | null; debut: string | null; adversaires: string[] } | null;
  instant: number | null;
  titre: string;
  description: string;
  statut: StatutClip;
  decidePar: string | null;
  decideLe: string | null;
  motif: string | null;
  carteId: string | null;
  creeLe: string;
  moi: boolean;
  droits: { trier: boolean; supprimer: boolean };
}
export interface ListeClips {
  clips: Clip[];
  noms: Record<string, string | null>;
  tous?: boolean;
}
export interface RoleCm {
  id: string;
  nom: string;
  couleur: string;
  systeme: boolean;
  cle: string | null;
  permissions: PermissionCm[];
  affectations: number;
  permissionsParDefaut?: PermissionCm[];
  modifie?: boolean;
}
export interface Affectation {
  id: string;
  compte: string;
  pseudo: string | null;
  role: { id: string; nom: string; couleur: string; cle: string | null };
  portee: string;
  team: TeamCm | null;
  creeLe: string;
}
export interface ReglagesCm {
  suggestions: { actif: boolean; types: Record<'tournoi' | 'j1' | 'jourj' | 'resultat' | 'final', boolean>; reseaux: Reseau[]; hashtags: string };
}
export interface ApercuTrello {
  tableau: { nom: string; trelloId: string };
  bilan: { listes: number; cartes: number; etiquettes: number; checklists: number; elements: number; commentaires: number; pieces: number; piecesDeposees: number; echeances: number; couvertures: number };
  archivees: { listes: number; cartes: number };
  /** Étiquettes nommées Critique / Urgent / Moyen / Faible (ou Critical / Medium / Low), convertibles en drapeau. */
  urgences?: Array<{ nom: string; niveau: Urgence; cartes: number }>;
  piecesIgnorees: number;
  avertissements: string[];
  membresTrello: Array<{ id: string; nom: string; identifiant: string }>;
  correspondances: Record<string, string | null>;
  personnes: Personne[];
  dejaImporte: { id: string; nom: string | null; portee: string } | null;
  listes: Array<{ trelloId?: string; nom: string; archivee: boolean; cartes: number; /** Archivée ou nommée Fini / Terminé / Done… : proposée comme colonne de fin. */ proposeFin?: boolean }>;
}
export interface ResultatImport {
  tableauId: string;
  nouveau: boolean;
  porteeConservee: boolean;
  bilan: ApercuTrello['bilan'] & { listesCreees: number; cartesCreees: number; cartesMisesAJour: number; cartesPostsInchangees: number; membresAssocies: number; piecesIgnorees: number; couverturesImages: number };
}
export interface EntreeJournalCm {
  id: string;
  acteur: string | null;
  action: string;
  entite: string | null;
  entiteId: string | null;
  meta: Record<string, unknown>;
  team: TeamCm | null;
  date: string;
}
export interface SaisieCarte {
  titre?: string;
  description?: string;
  echeance?: string | null;
  echeanceFaite?: boolean;
  datePublication?: string | null;
  couverture?: { couleur: string } | { pieceId: string } | null;
  teamId?: string | null;
  etiquettes?: string[];
  membres?: string[];
  archive?: boolean;
  /** Drapeau d'urgence ; null : aucun. */
  urgence?: Urgence | null;
  post?: boolean;
  reseaux?: Reseau[];
  textes?: TextesPost;
  liens?: LiensCarte;
  versionAttendue?: number;
}

const e = encodeURIComponent;

export function apiCm(client: ClientEsport) {
  const r = <T>(chemin: string, methode = 'GET', corps?: unknown) => client.requete<T>(chemin, methode, corps);
  return {
    /** Client Esport (envoi de fichiers par morceaux). */
    client,
    moi: () => r<MoiCm>('/cm/moi'),
    etat: () => r<EtatCm>('/cm/etat'),
    tableaux: (archives = false) => r<ListeTableaux>(`/cm/tableaux${requeteUrl({ archives: archives ? 1 : undefined })}`),
    creerTableau: (t: { nom: string; portee: string; couleur?: string; description?: string; modele?: 'vide' | 'contenus' }) => r<DetailTableau>('/cm/tableaux', 'POST', t),
    tableau: (id: string, archives = false) => r<DetailTableau>(`/cm/tableaux/${e(id)}${requeteUrl({ archives: archives ? 1 : undefined })}`),
    /** Accès au tableau (migration 0046). */
    accesTableau: (id: string) => r<ReglageAcces>(`/cm/tableaux/${e(id)}/acces`),
    changerAccesTableau: (id: string, acces: AccesTableau, regles: RegleAcces[]) => r<ReglageAcces>(`/cm/tableaux/${e(id)}/acces`, 'PUT', { acces, regles: regles.map(x => ({ genre: x.genre, cible: x.cible, niveau: x.niveau })) }),
    modifierTableau: (id: string, t: { nom?: string | null; couleur?: string; description?: string; archive?: boolean; fond?: SaisieFond }) => r<DetailTableau>(`/cm/tableaux/${e(id)}`, 'PATCH', t),
    /** Choix d'affichage du compte (colonnes réduites `tableau.<id>.reduites`, calendriers `calendrier.teams`). */
    preferences: () => r<{ preferences: Record<string, unknown> }>('/cm/preferences'),
    changerPreference: (cle: string, valeur: unknown) => r<{ ok: true }>(`/cm/preferences/${e(cle)}`, 'PUT', { valeur }),
    /** Calendriers des teams (planning ou compétition publiable, selon les droits du compte). */
    calendrierTeams: (du: string, au: string) => r<{ du: string; au: string; teams: CalendrierTeam[] }>(`/cm/calendrier/teams${requeteUrl({ du, au })}`),
    supprimerTableau: (id: string) => r<{ ok: true }>(`/cm/tableaux/${e(id)}`, 'DELETE'),
    creerListe: (tableauId: string, nom: string, fin = false) => r<{ id: string }>(`/cm/tableaux/${e(tableauId)}/listes`, 'POST', fin ? { nom, fin } : { nom }),
    modifierListe: (id: string, l: { nom?: string | null; archive?: boolean; fin?: boolean; finIgnoree?: boolean; tri?: 'auto' | 'manuel' }) => r<{ ok: true }>(`/cm/listes/${e(id)}`, 'PATCH', l),
    deplacerListe: (id: string, index: number) => r<{ ok: true }>(`/cm/listes/${e(id)}/deplacer`, 'POST', { index }),
    creerEtiquette: (tableauId: string, et: { nom: string; couleur: string }) => r<{ id: string }>(`/cm/tableaux/${e(tableauId)}/etiquettes`, 'POST', et),
    modifierEtiquette: (id: string, et: { nom?: string; couleur?: string }) => r<{ ok: true }>(`/cm/etiquettes/${e(id)}`, 'PATCH', et),
    supprimerEtiquette: (id: string) => r<{ ok: true; cartes: number }>(`/cm/etiquettes/${e(id)}`, 'DELETE'),
    ordonnerEtiquettes: (tableauId: string, ids: string[]) => r<{ ok: true }>(`/cm/tableaux/${e(tableauId)}/etiquettes/ordre`, 'PUT', { ids }),
    fusionnerEtiquettes: (id: string, vers: string) => r<{ ok: true; cartes: number }>(`/cm/etiquettes/${e(id)}/fusionner`, 'POST', { vers }),
    creerCarte: (tableauId: string, c: SaisieCarte & { listeId: string; titre: string; enHaut?: boolean }) => r<ReponseCarte>(`/cm/tableaux/${e(tableauId)}/cartes`, 'POST', c),
    /** `vu` : la fiche est ouverte, ses commentaires sont marqués lus pour le compte (la réponse dit encore ce qui était nouveau). */
    carte: (id: string, vu = false) => r<ReponseCarte>(`/cm/cartes/${e(id)}${vu ? '?vu=1' : ''}`),
    /** « Tout marquer comme lu » sur un tableau. */
    toutVu: (tableauId: string) => r<{ ok: true }>(`/cm/tableaux/${e(tableauId)}/tout-vu`, 'POST', {}),
    /** Suivre (ou ne plus suivre) une carte : notifié de ses nouveaux commentaires. */
    suivre: (id: string, suivre: boolean) => r<{ ok: true; suivie: boolean }>(`/cm/cartes/${e(id)}/suivre`, 'POST', { suivre }),
    modifierCarte: (id: string, c: SaisieCarte) => r<ReponseCarte>(`/cm/cartes/${e(id)}`, 'PATCH', c),
    supprimerCarte: (id: string) => r<{ ok: true }>(`/cm/cartes/${e(id)}`, 'DELETE'),
    deplacerCarte: (id: string, d: { listeId: string; index: number; tableauId?: string }) => r<{ ok: true }>(`/cm/cartes/${e(id)}/deplacer`, 'POST', d),
    soumettre: (id: string) => r<ReponseCarte>(`/cm/cartes/${e(id)}/soumettre`, 'POST', {}),
    valider: (id: string, v: { versionAttendue?: number; commentaire?: string }) => r<ReponseCarte>(`/cm/cartes/${e(id)}/valider`, 'POST', v),
    refuser: (id: string, motif: string) => r<ReponseCarte>(`/cm/cartes/${e(id)}/refuser`, 'POST', { motif }),
    publier: (id: string, publications: Partial<Record<Reseau, string>>) => r<ReponseCarte>(`/cm/cartes/${e(id)}/publier`, 'POST', { publications }),
    depublier: (id: string) => r<ReponseCarte>(`/cm/cartes/${e(id)}/depublier`, 'POST', {}),
    creerChecklist: (carteId: string, nom: string) => r<ReponseCarte>(`/cm/cartes/${e(carteId)}/checklists`, 'POST', { nom }),
    modifierChecklist: (id: string, nom: string) => r<ReponseCarte>(`/cm/checklists/${e(id)}`, 'PATCH', { nom }),
    supprimerChecklist: (id: string) => r<ReponseCarte>(`/cm/checklists/${e(id)}`, 'DELETE'),
    ajouterElement: (checklistId: string, texte: string) => r<ReponseCarte>(`/cm/checklists/${e(checklistId)}/elements`, 'POST', { texte }),
    modifierElement: (id: string, el: { texte?: string; fait?: boolean }) => r<ReponseCarte>(`/cm/elements/${e(id)}`, 'PATCH', el),
    supprimerElement: (id: string) => r<ReponseCarte>(`/cm/elements/${e(id)}`, 'DELETE'),
    commenter: (carteId: string, texte: string) => r<ReponseCarte>(`/cm/cartes/${e(carteId)}/commentaires`, 'POST', { texte }),
    modifierCommentaire: (id: string, texte: string) => r<ReponseCarte>(`/cm/commentaires/${e(id)}`, 'PATCH', { texte }),
    supprimerCommentaire: (id: string) => r<ReponseCarte>(`/cm/commentaires/${e(id)}`, 'DELETE'),
    ajouterLien: (carteId: string, url: string, nom: string) => r<ReponseCarte>(`/cm/cartes/${e(carteId)}/pieces`, 'POST', { genre: 'lien', url, nom }),
    ajouterFichier: (carteId: string, envoi: string) => r<ReponseCarte>(`/cm/cartes/${e(carteId)}/pieces`, 'POST', { genre: 'fichier', envoi }),
    /** Pièce jointe prise dans le Drive (même portée que le tableau, ou Drive du club) : aucun octet copié. */
    ajouterDepuisDrive: (carteId: string, fichierId: string) => r<ReponseCarte>(`/cm/cartes/${e(carteId)}/pieces`, 'POST', { genre: 'drive', fichierId }),
    supprimerPiece: (id: string) => r<ReponseCarte>(`/cm/pieces/${e(id)}`, 'DELETE'),
    lienPiece: (id: string, telecharger = false) => r<{ url: string; expire: string }>(`/cm/pieces/${e(id)}/lien`, 'POST', { telecharger }),
    aValider: () => r<{ cartes: CarteTransverse[]; noms: Record<string, string | null> }>('/cm/a-valider'),
    /** Cartes critiques et urgentes des tableaux visibles (critiques d'abord). */
    urgences: () => r<{ cartes: CarteTransverse[] }>('/cm/urgences'),
    /** Cartes terminées par semaine (lundi à dimanche) sur les tableaux visibles, la semaine en cours en dernier. */
    terminees: (semaines = 8) => r<{ semaines: Array<{ debut: string; n: number }>; total: number }>(`/cm/terminees?semaines=${semaines}`),
    calendrier: (du: string, au: string, reseau?: Reseau) => r<{ cartes: CarteTransverse[] }>(`/cm/calendrier${requeteUrl({ du, au, reseau })}`),
    recherche: (q: string) => r<{ cartes: CarteTransverse[] }>(`/cm/recherche${requeteUrl({ q })}`),
    team: (teamId: string) => r<PageTeamCm>(`/cm/teams/${e(teamId)}`),
    deposer: (teamId: string, d: { genre: GenreDepot; titre: string; description: string; liens: string[]; envois: string[] }) => r<{ id: string; tableauId: string }>(`/cm/teams/${e(teamId)}/depots`, 'POST', d),
    matchs: (teamId: string) => r<MatchsTeam>(`/cm/teams/${e(teamId)}/matchs`),
    prerempli: (teamId: string, genre: 'resultat' | 'annonce' | 'tournoi', id: string, prefixe?: 'j1' | 'jourj') => r<Prerempli>(`/cm/teams/${e(teamId)}/resume${requeteUrl({ genre, id, prefixe })}`),
    membresTeam: (teamId: string) => r<{ membres: Personne[] }>(`/cm/teams/${e(teamId)}/membres`),
    clipsTeam: (teamId: string, statut?: StatutClip) => r<ListeClips>(`/cm/teams/${e(teamId)}/clips${requeteUrl({ statut })}`),
    proposerClip: (teamId: string, c: { genre: 'lien' | 'fichier'; url?: string; envoi?: string; resultatId?: string; matchId?: string; instant?: string; titre: string; description: string }) =>
      r<ListeClips>(`/cm/teams/${e(teamId)}/clips`, 'POST', c),
    clips: (f: { statut?: StatutClip; team?: string } = {}) => r<ListeClips>(`/cm/clips${requeteUrl({ ...f })}`),
    deciderClip: (id: string, statut: StatutClip, motif?: string) => r<{ ok: true }>(`/cm/clips/${e(id)}`, 'PATCH', { statut, motif }),
    supprimerClip: (id: string) => r<{ ok: true }>(`/cm/clips/${e(id)}`, 'DELETE'),
    clipVersCarte: (id: string, carteId?: string) => r<{ carteId: string; tableauId: string }>(`/cm/clips/${e(id)}/carte`, 'POST', carteId ? { carteId } : {}),
    lienClip: (id: string, telecharger = false) => r<{ url: string; expire: string }>(`/cm/clips/${e(id)}/lien`, 'POST', { telecharger }),
    roles: () => r<{ roles: RoleCm[]; permissions: PermissionCm[] }>('/cm/roles'),
    creerRole: (ro: { nom: string; couleur: string; permissions: PermissionCm[] }) => r<RoleCm>('/cm/roles', 'POST', ro),
    modifierRole: (id: string, ro: { nom?: string; couleur?: string; permissions?: PermissionCm[] }) => r<RoleCm>(`/cm/roles/${e(id)}`, 'PATCH', ro),
    retablirRole: (id: string) => r<RoleCm>(`/cm/roles/${e(id)}/retablir`, 'POST', {}),
    supprimerRole: (id: string) => r<{ ok: true }>(`/cm/roles/${e(id)}`, 'DELETE'),
    affectations: () => r<{ affectations: Affectation[] }>('/cm/affectations'),
    affecter: (a: { compte: string; roleId: string; portee: string }) => r<{ affectations: Affectation[] }>('/cm/affectations', 'POST', a),
    retirerAffectation: (id: string) => r<{ affectations: Affectation[] }>(`/cm/affectations/${e(id)}`, 'DELETE'),
    comptes: () => r<{ comptes: Array<{ compte: string; pseudo: string; teams: TeamCm[] }> }>('/cm/comptes'),
    reglages: () => r<ReglagesCm>('/cm/reglages'),
    changerReglages: (s: { suggestions: Partial<ReglagesCm['suggestions']> }) => r<ReglagesCm>('/cm/reglages', 'PUT', s),
    journal: (avant?: string) => r<{ entrees: EntreeJournalCm[]; noms: Record<string, string | null> }>(`/cm/journal${requeteUrl({ avant })}`),
    porteesImport: () => r<{ portees: Array<{ portee: string; team: TeamCm | null }> }>('/cm/import/portees'),
    apercuTrello: (trello: unknown, portee: string, avecArchivees: boolean) => r<ApercuTrello>('/cm/import/trello/apercu', 'POST', { trello, portee, avecArchivees }),
    importerTrello: (trello: unknown, portee: string, avecArchivees: boolean, correspondances: Record<string, string | null>, convertirUrgences = false, listesFin: string[] = []) =>
      r<ResultatImport>('/cm/import/trello', 'POST', { trello, portee, avecArchivees, correspondances, convertirUrgences, ...(listesFin.length ? { listesFin } : {}) }),
  };
}

export type ApiCm = ReturnType<typeof apiCm>;
