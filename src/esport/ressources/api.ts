/**
 * Client du module « Ressources » (canal de ressources de la team), par l'appel générique du client
 * Esport (`client.requete`). Types miroirs de l'API (esport/noyau/ressources/).
 */

import { requeteUrl, type ClientEsport, type FichierMedia } from '../client';

export type GenreRessource = 'lien' | 'youtube' | 'fichier' | 'note';
export type NiveauRessource = 'debutant' | 'intermediaire' | 'avance';
export type VisibiliteRessource = 'team' | 'staff';
export type StatutRessource = 'publiee' | 'proposee' | 'refusee';

export const GENRES_RESSOURCE: readonly GenreRessource[] = ['lien', 'youtube', 'fichier', 'note'];
export const NIVEAUX_RESSOURCE: readonly NiveauRessource[] = ['debutant', 'intermediaire', 'avance'];
/** Clés des catégories créées par défaut (leur nom est traduit tant qu'elles ne sont pas renommées). */
export const CATEGORIES_DEFAUT = ['guides', 'videos_pros', 'lineups', 'aim', 'outils', 'mental', 'divers'] as const;

export interface Personne {
  compte: string;
  pseudo: string | null;
}
export interface CategorieRessource {
  id: string;
  nom: string;
  cleDefaut: string | null;
  position: number;
  /** Nombre de ressources publiées (dans la liste du canal). */
  n?: number;
}
export interface ApercuLien {
  titre: string | null;
  description: string | null;
  image: string | null;
  site: string | null;
}
export interface Reaction {
  emoji: string;
  n: number;
  moi: boolean;
}
export interface Ressource {
  id: string;
  genre: GenreRessource;
  titre: string;
  description: string;
  url: string | null;
  videoId: string | null;
  fichier: (FichierMedia & { media?: { genre?: string } | null }) | null;
  apercu: ApercuLien | null;
  tags: string[];
  carte: { cle: string; nom: string } | null;
  agent: { cle: string; nom: string } | null;
  niveau: NiveauRessource | null;
  visibilite: VisibiliteRessource;
  statut: StatutRessource;
  motifRefus: string | null;
  epingle: boolean;
  favori: boolean;
  categorie: CategorieRessource | null;
  auteur: Personne | null;
  validePar: Personne | null;
  multiTeams: boolean;
  reviewId: string | null;
  reactions: Reaction[];
  commentaires: number;
  nouveau: boolean;
  creeLe: string;
  majLe: string;
  publieLe: string | null;
  moi: { modifier: boolean; supprimer: boolean; epingler: boolean; valider: boolean };
}
export interface CommentaireRessource {
  id: string;
  texte: string;
  auteur: Personne | null;
  creeLe: string;
  supprimable: boolean;
}
export interface DetailRessource extends Ressource {
  listeCommentaires: CommentaireRessource[];
}
export interface DroitsRessources {
  poster: boolean;
  gerer: boolean;
  staff: boolean;
  proposer: boolean;
  discord: boolean;
  propositionsOuvertes: boolean;
}
export interface CanalRessources {
  ressources: Ressource[];
  categories: CategorieRessource[];
  sansCategorie: number;
  tags: string[];
  cartes: Array<{ cle: string; nom: string }>;
  agents: Array<{ cle: string; nom: string }>;
  auteurs: Personne[];
  total: number;
  nouveaux: number;
  derniereVisite: string | null;
  file: number;
  mesPropositions: number;
  emojis: string[];
  moi: DroitsRessources;
}
export interface FiltresRessources {
  categorie?: string;
  tag?: string;
  carte?: string;
  agent?: string;
  genre?: GenreRessource;
  auteur?: string;
  niveau?: NiveauRessource;
  favoris?: boolean;
  q?: string;
  file?: boolean;
  miennes?: boolean;
}
export interface SaisieRessource {
  genre?: GenreRessource;
  titre?: string;
  description?: string;
  url?: string;
  envoi?: string;
  categorieId?: string | null;
  tags?: string[];
  carte?: { cle: string; nom: string } | null;
  agent?: { cle: string; nom: string } | null;
  niveau?: NiveauRessource | null;
  visibilite?: VisibiliteRessource;
  epingle?: boolean;
}
export interface ReglagesRessources {
  propositions: boolean;
  discord: { salonId: string | null; webhook: { configure: boolean; masque?: string } } | null;
}
export interface TeamPublication {
  id: string;
  nom: string;
  slug: string;
  categories: CategorieRessource[];
}

const t = (id: string) => `/teams/${encodeURIComponent(id)}/ressources`;
const r = (teamId: string, id: string) => `${t(teamId)}/${encodeURIComponent(id)}`;

export function apiRessources(client: ClientEsport) {
  return {
    canal: (teamId: string, f: FiltresRessources = {}) => client.requete<CanalRessources>(`${t(teamId)}${requeteUrl({ ...f })}`),
    vu: (teamId: string) => client.requete<{ vuLe: string }>(`${t(teamId)}/vu`, 'POST', {}),
    detail: (teamId: string, id: string) => client.requete<DetailRessource>(r(teamId, id)),
    apercu: (teamId: string, url: string) => client.requete<ApercuLien & { url: string; youtube?: string }>(`${t(teamId)}/apercu`, 'POST', { url }),
    creer: (teamId: string, corps: SaisieRessource) => client.requete<DetailRessource>(t(teamId), 'POST', corps),
    modifier: (teamId: string, id: string, corps: SaisieRessource) => client.requete<DetailRessource>(r(teamId, id), 'PATCH', corps),
    supprimer: (teamId: string, id: string) => client.requete<{ ok: true }>(r(teamId, id), 'DELETE'),
    valider: (teamId: string, id: string, categorieId?: string) => client.requete<DetailRessource>(`${r(teamId, id)}/valider`, 'POST', categorieId ? { categorieId } : {}),
    refuser: (teamId: string, id: string, motif: string) => client.requete<DetailRessource>(`${r(teamId, id)}/refuser`, 'POST', { motif }),
    favori: (teamId: string, id: string, actif: boolean) => client.requete<{ favori: boolean }>(`${r(teamId, id)}/favori`, actif ? 'PUT' : 'DELETE'),
    reagir: (teamId: string, id: string, emoji: string, actif: boolean) => client.requete<{ reactions: Reaction[] }>(`${r(teamId, id)}/reactions`, 'PUT', { emoji, actif }),
    commenter: (teamId: string, id: string, texte: string) => client.requete<DetailRessource>(`${r(teamId, id)}/commentaires`, 'POST', { texte }),
    supprimerCommentaire: (teamId: string, id: string, cid: string) => client.requete<DetailRessource>(`${r(teamId, id)}/commentaires/${encodeURIComponent(cid)}`, 'DELETE'),
    lienFichier: (teamId: string, id: string, telecharger = false) => client.requete<{ url: string; expire: string }>(`${r(teamId, id)}/fichier/lien`, 'POST', { telecharger }),
    ouvrirEnReview: (teamId: string, id: string) => client.requete<{ reviewId: string; cree: boolean }>(`${r(teamId, id)}/review`, 'POST', {}),
    creerCategorie: (teamId: string, nom: string) => client.requete<CategorieRessource>(`${t(teamId)}/categories`, 'POST', { nom }),
    renommerCategorie: (teamId: string, id: string, nom: string) => client.requete<CategorieRessource>(`${t(teamId)}/categories/${encodeURIComponent(id)}`, 'PATCH', { nom }),
    supprimerCategorie: (teamId: string, id: string) => client.requete<{ ok: true; categories: CategorieRessource[] }>(`${t(teamId)}/categories/${encodeURIComponent(id)}`, 'DELETE'),
    ordonnerCategories: (teamId: string, ids: string[]) => client.requete<{ categories: CategorieRessource[] }>(`${t(teamId)}/categories/ordre`, 'PUT', { ids }),
    reglages: (teamId: string) => client.requete<ReglagesRessources>(`${t(teamId)}/reglages`),
    changerReglages: (teamId: string, corps: { propositions?: boolean; discord?: { salonId?: string | null; webhook?: string | null } }) => client.requete<ReglagesRessources>(`${t(teamId)}/reglages`, 'PATCH', corps),
    teamsPublication: async () => (await client.requete<{ teams: TeamPublication[] }>('/ressources/teams')).teams,
    publierMulti: (corps: SaisieRessource & { teams: string[]; categorie?: { cleDefaut?: string; nom?: string } }) =>
      client.requete<{ groupe: string; ressources: Array<{ teamId: string; team: string; id: string }> }>('/ressources/multi', 'POST', corps),
  };
}
export type ApiRessources = ReturnType<typeof apiRessources>;
