/**
 * Client de la section CM (migration 0023), par l'appel générique du client Esport (`client.requete`).
 * Types miroirs de l'API (esport/noyau/cm/). Voir docs/esport/cm.md.
 */

import { requeteUrl, type ClientEsport } from '../client';

export type PermissionCm = 'cm.voir' | 'cm.deposer' | 'cm.editer' | 'cm.valider' | 'cm.gerer' | 'cm.clips.proposer';
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
  club: PermissionCm[];
  teams: Array<TeamCm & { permissions: PermissionCm[] }>;
  gerer: boolean;
}
export interface DroitsTableau {
  voir: boolean;
  deposer: boolean;
  editer: boolean;
  valider: boolean;
  gerer: boolean;
  commenter: boolean;
}
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
  majLe: string;
  cartes?: number;
  aValider?: number;
  droits?: DroitsTableau;
}
export interface ListeTableaux {
  tableaux: TableauListe[];
  portees: Array<{ portee: string; team: TeamCm | null; permissions: PermissionCm[] }>;
}
export interface ListeCm {
  id: string;
  nom: string | null;
  cle: CleListe | null;
  position: number;
  archive: boolean;
}
export interface Etiquette {
  id: string;
  nom: string;
  couleur: string;
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
  commentaires: number;
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
}
export interface Piece {
  id: string;
  genre: 'fichier' | 'lien';
  nom: string;
  url: string | null;
  trello: boolean;
  fichier: { id: string; type: string; taille: number } | null;
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
  pieces: Piece[];
  activite: Activite[];
  clips: Array<{ id: string; titre: string; statut: StatutClip; genre: 'fichier' | 'lien' }>;
  resumes: { resultat?: ResumeLie; match?: ResumeLie; tournoi?: ResumeLie };
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
}
export interface PageTeamCm {
  team: TeamCm & { fuseau: string };
  permissions: PermissionCm[];
  tableaux: Array<{ id: string; nom: string | null; cleDefaut: string | null; couleur: string; version: number }>;
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
  piecesIgnorees: number;
  avertissements: string[];
  membresTrello: Array<{ id: string; nom: string; identifiant: string }>;
  correspondances: Record<string, string | null>;
  personnes: Personne[];
  dejaImporte: { id: string; nom: string | null; portee: string } | null;
  listes: Array<{ nom: string; archivee: boolean; cartes: number }>;
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
    modifierTableau: (id: string, t: { nom?: string | null; couleur?: string; description?: string; archive?: boolean }) => r<DetailTableau>(`/cm/tableaux/${e(id)}`, 'PATCH', t),
    supprimerTableau: (id: string) => r<{ ok: true }>(`/cm/tableaux/${e(id)}`, 'DELETE'),
    creerListe: (tableauId: string, nom: string) => r<{ id: string }>(`/cm/tableaux/${e(tableauId)}/listes`, 'POST', { nom }),
    modifierListe: (id: string, l: { nom?: string | null; archive?: boolean }) => r<{ ok: true }>(`/cm/listes/${e(id)}`, 'PATCH', l),
    deplacerListe: (id: string, index: number) => r<{ ok: true }>(`/cm/listes/${e(id)}/deplacer`, 'POST', { index }),
    creerEtiquette: (tableauId: string, et: { nom: string; couleur: string }) => r<{ id: string }>(`/cm/tableaux/${e(tableauId)}/etiquettes`, 'POST', et),
    modifierEtiquette: (id: string, et: { nom?: string; couleur?: string }) => r<{ ok: true }>(`/cm/etiquettes/${e(id)}`, 'PATCH', et),
    supprimerEtiquette: (id: string) => r<{ ok: true }>(`/cm/etiquettes/${e(id)}`, 'DELETE'),
    creerCarte: (tableauId: string, c: SaisieCarte & { listeId: string; titre: string; enHaut?: boolean }) => r<ReponseCarte>(`/cm/tableaux/${e(tableauId)}/cartes`, 'POST', c),
    carte: (id: string) => r<ReponseCarte>(`/cm/cartes/${e(id)}`),
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
    supprimerPiece: (id: string) => r<ReponseCarte>(`/cm/pieces/${e(id)}`, 'DELETE'),
    lienPiece: (id: string, telecharger = false) => r<{ url: string; expire: string }>(`/cm/pieces/${e(id)}/lien`, 'POST', { telecharger }),
    aValider: () => r<{ cartes: CarteTransverse[]; noms: Record<string, string | null> }>('/cm/a-valider'),
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
    importerTrello: (trello: unknown, portee: string, avecArchivees: boolean, correspondances: Record<string, string | null>) =>
      r<ResultatImport>('/cm/import/trello', 'POST', { trello, portee, avecArchivees, correspondances }),
  };
}

export type ApiCm = ReturnType<typeof apiCm>;
