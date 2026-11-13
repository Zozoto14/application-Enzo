/**
 * Client des strats et du playbook (phase 6), par l'appel générique du
 * client Esport (`client.requete`). Types miroirs de l'API
 * (esport/noyau/strats/).
 */

import { requeteUrl, type ClientEsport } from '../client';
import type { DocumentStrat, Side, TypeStrat } from './document';
import type { ModeleStrat } from './modeles';

export interface LienSigne {
  url: string;
  expire: string;
}
export interface Personne {
  compte: string;
  pseudo: string | null;
}
export interface Strat {
  id: string;
  jeu: string;
  /** Modèle de strat (fixé à la création, d'après le jeu de la team) ; absent : serveur ancien. */
  modele?: ModeleStrat;
  titre: string;
  carte: { cle: string; nom: string };
  side: Side;
  type: TypeStrat;
  tags: string[];
  notes: string;
  visibilite: 'team' | 'privee';
  revision: number;
  versionDocument: number;
  miniature: LienSigne | null;
  origine: string | null;
  creePar: Personne;
  majPar: Personne;
  creeLe: string;
  majLe: string;
  moi: { modifier: boolean; supprimer: boolean; partager: boolean };
  /** Présent dans le détail (pas dans la liste). */
  donnees?: DocumentStrat;
  avertissement?: string;
}
/** Une strat à la corbeille (30 jours) que l'on peut restaurer. */
export interface StratCorbeille {
  id: string;
  titre: string;
  carte: { cle: string; nom: string };
  side: Side;
  type: TypeStrat;
  visibilite: 'team' | 'privee';
  miniature: LienSigne | null;
  supprimeLe: string;
  supprimePar: Personne | null;
  expireLe: string;
}
export interface ResultatSuppressionLot {
  ok: true;
  supprimees: string[];
  echecs: Array<{ id: string; code: string }>;
}
export interface FiltresStrats {
  carte?: string;
  side?: Side;
  type?: TypeStrat;
  tag?: string;
  q?: string;
}
export interface PartageStrat {
  id: string;
  libelle: string;
  creeLe: string;
  expireLe: string | null;
  revoque: boolean;
  dernierAcces: string | null;
  /** Montrés une seule fois, à la création. */
  jeton?: string;
  url?: string;
}
export interface VersionStrat {
  revision: number;
  par: Personne;
  le: string;
}

export type StatutPlaybook = 'brouillon' | 'validee' | 'archivee';
export interface EntreePlaybook {
  id: string;
  jeu: string;
  titre: string;
  carte: { cle: string; nom: string } | null;
  side: Side | null;
  type: TypeStrat;
  tags: string[];
  description: string;
  favori: boolean;
  statut: StatutPlaybook;
  strat: { id: string; titre: string; ouvrable: boolean } | null;
  miniature: LienSigne | null;
  validePar: Personne | null;
  valideLe: string | null;
  creePar: Personne;
  creeLe: string;
  majLe: string;
}
export interface FiltresPlaybook {
  q?: string;
  carte?: string;
  side?: Side;
  type?: TypeStrat;
  statut?: StatutPlaybook | 'tous';
  tag?: string;
  favoris?: boolean;
}
export interface Playbook {
  entrees: EntreePlaybook[];
  cartes: Array<{ cle: string; nom: string }>;
  tags: string[];
  total: number;
  gerer: boolean;
}
export interface SaisieEntree {
  titre?: string;
  stratId?: string | null;
  carte?: { cle: string; nom: string } | null;
  side?: Side | null;
  type?: TypeStrat;
  tags?: string[];
  description?: string;
  favori?: boolean;
  statut?: StatutPlaybook;
}

const t = (id: string) => `/teams/${encodeURIComponent(id)}`;
const s = (teamId: string, id: string) => `${t(teamId)}/strats/${encodeURIComponent(id)}`;

export function apiStrats(client: ClientEsport) {
  return {
    liste: async (teamId: string, f: FiltresStrats = {}) => (await client.requete<{ strats: Strat[] }>(`${t(teamId)}/strats${requeteUrl({ ...f })}`)).strats,
    detail: (teamId: string, id: string) => client.requete<Strat>(s(teamId, id)),
    creer: (teamId: string, corps: { titre: string; type: TypeStrat; carte: { cle: string; nom: string; image: string | null }; side: Side; tags?: string[]; visibilite?: 'team' | 'privee' }) =>
      client.requete<Strat>(`${t(teamId)}/strats`, 'POST', corps),
    /** `auto` : enregistrement automatique de l'atelier (le serveur regroupe ces versions au lieu d'en empiler une par frappe). */
    enregistrer: (teamId: string, id: string, corps: { revision: number; donnees?: DocumentStrat; miniature?: string; titre?: string; type?: TypeStrat; tags?: string[]; notes?: string; auto?: boolean }) =>
      client.requete<Strat>(s(teamId, id), 'PUT', corps),
    modifier: (teamId: string, id: string, corps: { titre?: string; type?: TypeStrat; tags?: string[]; notes?: string; visibilite?: 'team' | 'privee' }) => client.requete<Strat>(s(teamId, id), 'PATCH', corps),
    dupliquer: (teamId: string, id: string, titre?: string) => client.requete<Strat>(`${s(teamId, id)}/dupliquer`, 'POST', titre ? { titre } : {}),
    supprimer: (teamId: string, id: string) => client.requete<{ ok: true }>(s(teamId, id), 'DELETE'),
    supprimerLot: (teamId: string, ids: string[]) => client.requete<ResultatSuppressionLot>(`${t(teamId)}/strats/supprimer`, 'POST', { ids }),
    corbeille: async (teamId: string) => (await client.requete<{ strats: StratCorbeille[] }>(`${t(teamId)}/strats/corbeille`)).strats,
    restaurer: (teamId: string, id: string) => client.requete<Strat>(`${s(teamId, id)}/restaurer`, 'POST', {}),
    versions: async (teamId: string, id: string) => (await client.requete<{ versions: VersionStrat[] }>(`${s(teamId, id)}/versions`)).versions,
    version: (teamId: string, id: string, revision: number) => client.requete<{ revision: number; le: string; donnees: DocumentStrat }>(`${s(teamId, id)}/versions/${revision}`),
    partages: async (teamId: string, id: string) => (await client.requete<{ partages: PartageStrat[] }>(`${s(teamId, id)}/partages`)).partages,
    creerPartage: (teamId: string, id: string, corps: { libelle?: string; jours?: number } = {}) => client.requete<PartageStrat>(`${s(teamId, id)}/partages`, 'POST', corps),
    revoquerPartage: (teamId: string, id: string, partageId: string) => client.requete<{ ok: true }>(`${s(teamId, id)}/partages/${encodeURIComponent(partageId)}`, 'DELETE'),
    playbook: (teamId: string, f: FiltresPlaybook = {}) => client.requete<Playbook>(`${t(teamId)}/playbook${requeteUrl({ ...f })}`),
    creerEntree: (teamId: string, corps: SaisieEntree) => client.requete<EntreePlaybook>(`${t(teamId)}/playbook`, 'POST', corps),
    modifierEntree: (teamId: string, id: string, corps: SaisieEntree) => client.requete<EntreePlaybook>(`${t(teamId)}/playbook/${encodeURIComponent(id)}`, 'PATCH', corps),
    restaurerEntree: (teamId: string, id: string) => client.requete<EntreePlaybook>(`${t(teamId)}/playbook/${encodeURIComponent(id)}/restaurer`, 'POST', {}),
    supprimerEntree: (teamId: string, id: string) => client.requete<{ ok: true }>(`${t(teamId)}/playbook/${encodeURIComponent(id)}`, 'DELETE'),
  };
}
export type ApiStrats = ReturnType<typeof apiStrats>;
