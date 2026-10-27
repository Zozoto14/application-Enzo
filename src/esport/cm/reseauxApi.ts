/**
 * Client de la page « Réseaux » de l'espace CM (migration 0026) : comptes, bot d'annonce Discord des posts
 * publiés, statistiques. Types miroirs de l'API (esport/noyau/reseaux/). Voir docs/esport/reseaux-stats.md.
 */

import { requeteUrl, type ClientEsport } from '../client';

export type ReseauCompte = 'x' | 'instagram' | 'tiktok' | 'youtube' | 'twitch';
export type TypeContenu = 'annonce' | 'match' | 'resultat' | 'clip' | 'sponsor' | 'coulisses' | 'recrutement' | 'autre';
export type EtatDiscordTeam = 'bot' | 'webhook' | 'sans' | 'module';
export type GenreImport = 'posts' | 'comptes';
export type MetriquePost = 'vues' | 'likes' | 'commentaires' | 'partages' | 'enregistrements' | 'impressions' | 'portee' | 'clics' | 'dureeMoyenne' | 'tauxCompletion';
export type MetriqueCompte = 'abonnes' | 'publications' | 'vues' | 'impressions';

export const METRIQUES_POST: readonly MetriquePost[] = ['vues', 'likes', 'commentaires', 'partages', 'enregistrements', 'impressions', 'portee', 'clics', 'dureeMoyenne', 'tauxCompletion'];
export const METRIQUES_COMPTE: readonly MetriqueCompte[] = ['abonnes', 'publications', 'vues', 'impressions'];
export const TYPES_CONTENU: readonly TypeContenu[] = ['annonce', 'match', 'resultat', 'clip', 'sponsor', 'coulisses', 'recrutement', 'autre'];

export interface InfoReseau {
  cle: ReseauCompte;
  nom: string;
  couleur: string;
  glyphe: string;
  /** Réseau des posts de la section CM (X, Instagram, TikTok). */
  posts: boolean;
}
export interface Cible {
  cle: string;
  genre: 'team' | 'salon';
  teamId: string | null;
  salonId: string | null;
}
export interface CompteReseau {
  id: string;
  reseau: ReseauCompte;
  identifiant: string;
  url: string;
  nom: string;
  teamId: string | null;
  actif: boolean;
  dernierReleve: { jour: string; abonnes: number | null } | null;
  /** Réglage de l'annonce Discord (cm.gerer seulement). */
  annonce?: { active: boolean; modeleEn: string | null; modeleFr: string | null; roleMention: string | null; cibles: Cible[]; dernierTest: string | null };
}
export interface SalonClub {
  id: string;
  nom: string;
  masque: string;
  filFr: boolean;
  langue: 'fr' | 'en';
  dernierSucces: string | null;
  dernierEchec: string | null;
  invalide: boolean;
  dernierTest: string | null;
}
export interface EtatReseaux {
  droits: { voir: boolean; editer: boolean; gerer: boolean; club: boolean };
  reseaux: InfoReseau[];
  typesContenu: TypeContenu[];
  variables: string[];
  modelesDefaut: { en: string; fr: string };
  comptes: CompteReseau[];
  teams: Array<{ id: string; nom: string; discord?: EtatDiscordTeam }>;
  salons?: SalonClub[];
  reglages?: { rappels: boolean };
  bot?: boolean;
}
export type Releve = { id: string; jour: string; source: string; engagement: number | null; interactions: number | null } & Record<MetriquePost, number | null>;
export type ReleveCompte = { id: string; jour: string; source: string } & Record<MetriqueCompte, number | null>;
export interface Publication {
  id: string;
  carteId: string | null;
  reseau: ReseauCompte;
  url: string;
  titre: string;
  type: TypeContenu;
  teamId: string | null;
  team: string | null;
  compte: { id: string; identifiant: string } | null;
  publieLe: string;
  video: boolean;
  rappels: boolean;
  releves: number;
  dernier: Releve | null;
}
export interface EtapeEvolution {
  jour: string;
  jPlus: number | null;
  engagement: number | null;
  interactions: number | null;
  ecartVues: number | null;
  ecartInteractions: number | null;
}
export interface DetailPublication {
  publication: Publication;
  releves: Releve[];
  evolution: EtapeEvolution[];
  editer: boolean;
}
export interface EvolutionAbonnes {
  serie: Array<{ jour: string; abonnes: number }>;
  debut: number | null;
  fin: number | null;
  variation: number | null;
  variationPct: number | null;
}
export interface DetailCompte {
  compte: { id: string; reseau: ReseauCompte; identifiant: string; teamId: string | null };
  releves: ReleveCompte[];
  evolution: EvolutionAbonnes;
  editer: boolean;
}
export interface LignePalmares {
  id: string;
  titre: string;
  reseau: ReseauCompte;
  url: string;
  type: TypeContenu;
  team: string | null;
  compte: string | null;
  publieLe: string;
  vues: number | null;
  interactions: number | null;
  engagement: number | null;
  jour: string | null;
}
export interface Groupe {
  cle: string;
  nom?: string | null;
  publications: number;
  relevees: number;
  vues: number;
  interactions: number;
  engagement: number | null;
}
export interface TableauDeBordReseaux {
  periode: { du: string; au: string };
  totaux: { publications: number; relevees: number; vues: number; interactions: number; engagement: number | null; abonnes: number | null; variationAbonnes: number | null };
  comptes: Array<EvolutionAbonnes & { id: string; reseau: ReseauCompte; identifiant: string; teamId: string | null; team: string | null; vues: number | null; impressions: number | null; publications: number | null }>;
  topVues: LignePalmares[];
  topEngagement: LignePalmares[];
  parReseau: Groupe[];
  parType: Groupe[];
  parTeam: Groupe[];
}
export interface Annonce {
  id: string;
  carteId: string;
  titre: string;
  reseau: string;
  cible: { genre: 'team' | 'salon'; nom: string };
  statut: 'attente' | 'envoye' | 'abandonne';
  operation: 'poster' | 'editer';
  essais: number;
  erreur: string | null;
  url: string;
  envoyeLe: string | null;
  majLe: string;
}
export interface ApercuMessage {
  texte: string;
  embed: { title?: string; description?: string; fields?: Array<{ name: string; value: string }>; author?: { name: string } };
  mention: string | null;
}
export interface ApercuImportReseaux {
  genre: GenreImport;
  separateur: string;
  entetes: string[];
  exemples: string[][];
  lignes: number;
  correspondance: Record<string, string>;
  champs: string[];
}
export interface BilanImportReseaux {
  releves: number;
  crees: number;
  invalides: Array<{ ligne: number; code: string }>;
  nInvalides: number;
}
export interface FiltresReseaux {
  du?: string;
  au?: string;
  reseau?: ReseauCompte;
  team?: string;
  type?: TypeContenu;
  compte?: string;
  q?: string;
}
export interface SaisieCompte {
  reseau?: ReseauCompte;
  url?: string;
  identifiant?: string;
  nom?: string;
  teamId?: string | null;
  actif?: boolean;
}
export interface SaisieAnnonce {
  active?: boolean;
  modeleEn?: string | null;
  modeleFr?: string | null;
  roleMention?: string | null;
  cibles?: Array<{ genre: 'team' | 'salon'; id: string }>;
}

const e = encodeURIComponent;

export function apiReseaux(client: ClientEsport) {
  const r = <T>(chemin: string, methode = 'GET', corps?: unknown) => client.requete<T>(chemin, methode, corps);
  return {
    etat: () => r<EtatReseaux>('/cm/reseaux'),
    creerCompte: (c: SaisieCompte) => r<{ compte: CompteReseau }>('/cm/reseaux/comptes', 'POST', c),
    modifierCompte: (id: string, c: SaisieCompte) => r<{ compte: CompteReseau }>(`/cm/reseaux/comptes/${e(id)}`, 'PATCH', c),
    supprimerCompte: (id: string) => r<{ ok: true }>(`/cm/reseaux/comptes/${e(id)}`, 'DELETE'),
    reglerAnnonce: (id: string, a: SaisieAnnonce) => r<{ compte: CompteReseau }>(`/cm/reseaux/comptes/${e(id)}/annonce`, 'PUT', a),
    apercu: (a: { reseau: ReseauCompte; identifiant?: string; url?: string; teamId?: string | null; modeleEn?: string; modeleFr?: string; roleMention?: string }) => r<{ en: ApercuMessage; fr: ApercuMessage }>('/cm/reseaux/apercu', 'POST', a),
    tester: (id: string) => r<{ resultats: Array<{ cible: string; ok: boolean; motif?: string }> }>(`/cm/reseaux/comptes/${e(id)}/test`, 'POST', {}),
    ajouterSalon: (s: { nom: string; url: string; filFr?: boolean; langue?: 'fr' | 'en' }) => r<{ salon: SalonClub }>('/cm/reseaux/salons', 'POST', s),
    modifierSalon: (id: string, s: { nom?: string; url?: string; filFr?: boolean; langue?: 'fr' | 'en' }) => r<{ salon: SalonClub }>(`/cm/reseaux/salons/${e(id)}`, 'PATCH', s),
    supprimerSalon: (id: string) => r<{ ok: true }>(`/cm/reseaux/salons/${e(id)}`, 'DELETE'),
    testerSalon: (id: string) => r<{ ok: boolean; motif?: string }>(`/cm/reseaux/salons/${e(id)}/test`, 'POST', {}),
    annonces: () => r<{ annonces: Annonce[] }>('/cm/reseaux/annonces'),
    publications: (f: FiltresReseaux = {}) => r<{ publications: Publication[]; editer: boolean }>(`/cm/reseaux/publications${requeteUrl({ ...f })}`),
    publication: (id: string) => r<DetailPublication>(`/cm/reseaux/publications/${e(id)}`),
    creerPublication: (p: { url: string; reseau?: ReseauCompte; titre?: string; type?: TypeContenu; teamId?: string | null; publieLe?: string; video?: boolean }) => r<DetailPublication>('/cm/reseaux/publications', 'POST', p),
    modifierPublication: (id: string, p: { titre?: string; type?: TypeContenu; video?: boolean; rappels?: boolean; url?: string; publieLe?: string }) => r<DetailPublication>(`/cm/reseaux/publications/${e(id)}`, 'PATCH', p),
    supprimerPublication: (id: string) => r<{ ok: true }>(`/cm/reseaux/publications/${e(id)}`, 'DELETE'),
    releverPost: (id: string, v: Partial<Record<MetriquePost, string | number>> & { jour?: string }) => r<DetailPublication>(`/cm/reseaux/publications/${e(id)}/releves`, 'POST', v),
    supprimerRelevePost: (id: string) => r<DetailPublication>(`/cm/reseaux/releves-posts/${e(id)}`, 'DELETE'),
    relevesCompte: (id: string) => r<DetailCompte>(`/cm/reseaux/comptes/${e(id)}/releves`),
    releverCompte: (id: string, v: Partial<Record<MetriqueCompte, string | number>> & { jour?: string }) => r<DetailCompte>(`/cm/reseaux/comptes/${e(id)}/releves`, 'POST', v),
    supprimerReleveCompte: (id: string) => r<DetailCompte>(`/cm/reseaux/releves-comptes/${e(id)}`, 'DELETE'),
    tableauDeBord: (f: FiltresReseaux = {}) => r<TableauDeBordReseaux>(`/cm/reseaux/tableau-de-bord${requeteUrl({ ...f })}`),
    apercuImport: (genre: GenreImport, contenu: string) => r<ApercuImportReseaux>('/cm/reseaux/import/apercu', 'POST', { genre, contenu }),
    importer: (genre: GenreImport, contenu: string, correspondance: Record<string, string | null>, creer = false) => r<BilanImportReseaux>('/cm/reseaux/import', 'POST', { genre, contenu, correspondance, creer }),
    exporter: (genre: GenreImport) => r<{ nom: string; type: string; contenu: string }>(`/cm/reseaux/export/${genre}.csv?format=json`),
    changerReglages: (reglages: { rappels: boolean }) => r<{ rappels: boolean }>('/cm/reseaux/reglages', 'PUT', reglages),
  };
}

export type ApiReseaux = ReturnType<typeof apiReseaux>;

// ------------------------------------------------------------------ Règles d'affichage (pures)

/** Nombre compact : 950, 12,5 k, 1,2 M (locale de l'app). */
export function nombreCompact(n: number | null | undefined, locale: string): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat(locale, { notation: n >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n);
}

/** Pourcentage avec une ou deux décimales (« 6,67 % »). */
export function pourcentage(n: number | null | undefined, locale: string): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n)} %`;
}

/** Variation signée (« +250 », « −12 »). */
export function variationSignee(n: number | null | undefined, locale: string): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const t = new Intl.NumberFormat(locale).format(Math.abs(n));
  return n > 0 ? `+${t}` : n < 0 ? `−${t}` : '0';
}

/** Durée en secondes → « 0:45 », « 2:05 ». */
export function duree(secondes: number | null | undefined): string {
  if (secondes === null || secondes === undefined || !Number.isFinite(secondes)) return '—';
  const s = Math.round(secondes);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Valeur d'une variable d'aperçu (identique au serveur) : rend un modèle avec ses variables {nom}. */
export function rendreModeleLocal(modele: string, valeurs: Record<string, string>): string {
  return modele.replace(/\{([a-z]+)\}/g, (m, nom: string) => (nom in valeurs ? valeurs[nom] : m));
}

/** Variables inconnues d'un modèle (contrôle en direct ; le serveur reste seul juge). */
export function variablesInconnues(modele: string, permises: readonly string[]): string[] {
  return [...new Set([...modele.matchAll(/\{([a-z]+)\}/g)].map(m => m[1]))].filter(v => !permises.includes(v));
}
