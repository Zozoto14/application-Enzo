/**
 * Client du devblog (notes de mise à jour, migration 0036), par l'appel générique du client Esport.
 * Types miroirs de l'API (esport/noyau/devblog/). Voir docs/esport/devblog.md.
 */

import type { ClientEsport } from '../client';
import type { Langue } from '../i18n';

export interface PuceDevblog {
  nom: string;
  description: string;
}
export interface SectionDevblog {
  emoji: string;
  titre: string;
  puces: PuceDevblog[];
}
export interface ContenuDevblog {
  titre: string;
  intro: string;
  sections: SectionDevblog[];
  conclusion: string;
}
export interface EntreeDevblog {
  id: string;
  statut: 'brouillon' | 'publie';
  /** Date affichée (AAAA-MM-JJ). */
  date: string;
  version: string | null;
  fr: ContenuDevblog;
  en: ContenuDevblog;
  publieLe: string | null;
  creeLe?: string;
  majLe?: string;
}
export interface SalonDevblog {
  cle: string;
  genre: 'club' | 'team';
  nom: string;
  detail: string;
  invalide: boolean;
}
export interface Salons {
  salons: SalonDevblog[];
  defaut: string[];
  salonBot: { id: string; nom: string } | null;
}
export interface PublicationDiscord {
  cible: string;
  nom: string | null;
  statut: 'attente' | 'envoye' | 'abandonne';
  operation: 'poster' | 'editer';
  messages: number;
  filFrancais: boolean;
  aJour: boolean;
  erreur: string | null;
  envoyeLe: string | null;
}
export interface EtatDiscord {
  apercu: { en: string[]; fr: string[] };
  pretAPublier: boolean;
  publications: PublicationDiscord[];
  resultats?: Array<{ cible: string; etat: 'publication' | 'correction' | 'deja_publie' | 'en_cours' }>;
}
export interface SaisieDevblog {
  date?: string;
  version?: string;
  fr?: ContenuDevblog;
  en?: ContenuDevblog;
  statut?: 'brouillon' | 'publie';
}

export const contenuVide = (): ContenuDevblog => ({ titre: '', intro: '', sections: [], conclusion: '' });

/** Contenu d'une entrée dans une langue (l'anglais incomplet retombe sur le français). */
export function contenuDans(e: Pick<EntreeDevblog, 'fr' | 'en'>, langue: Langue): ContenuDevblog {
  if (langue === 'en' && e.en?.titre && e.en.sections?.length) return e.en;
  return e.fr;
}

export function apiDevblog(client: ClientEsport) {
  // Appel paresseux : un faux client de test sans `requete` ne casse qu'à l'appel (rattrapé par l'appelant).
  const r = <T,>(chemin: string, methode?: string, corps?: unknown) => client.requete<T>(chemin, methode, corps);
  const id = (x: string) => `/devblog/${encodeURIComponent(x)}`;
  return {
    liste: () => r<{ entrees: EntreeDevblog[]; gestion: boolean }>('/devblog'),
    detail: (x: string) => r<{ entree: EntreeDevblog; gestion: boolean }>(id(x)),
    creer: (s: SaisieDevblog) => r<{ entree: EntreeDevblog }>('/devblog', 'POST', s),
    modifier: (x: string, s: SaisieDevblog) => r<{ entree: EntreeDevblog }>(id(x), 'PATCH', s),
    supprimer: (x: string) => r<{ ok: boolean }>(id(x), 'DELETE'),
    nouveautes: () => r<{ entree: EntreeDevblog | null }>('/devblog/nouveautes'),
    vu: (x: string) => r<{ ok: boolean }>(`${id(x)}/vu`, 'POST', {}),
    traduire: (fr: ContenuDevblog) => r<{ en: ContenuDevblog; moteur: string | null }>('/devblog/ia/traduire', 'POST', { fr }),
    salons: () => r<Salons>('/devblog/salons'),
    reglerSalons: (corps: { defaut?: string[]; salonBot?: { id: string; nom: string } | null; webhook?: { nom: string; url: string } }) => r<Salons>('/devblog/salons', 'PUT', corps),
    etatDiscord: (x: string, here = true) => r<EtatDiscord>(`${id(x)}/discord?here=${here ? 1 : 0}`),
    publierDiscord: (x: string, cibles: string[], mentionHere: boolean) => r<EtatDiscord>(`${id(x)}/discord`, 'POST', { cibles, mentionHere }),
  };
}
export type ApiDevblog = ReturnType<typeof apiDevblog>;
