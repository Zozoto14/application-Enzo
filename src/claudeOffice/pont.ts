/**
 * Ce que l'écran Claude Office peut demander au PC, par le pont de
 * l'application de bureau (`window.applibourse.claudeOffice`, voir
 * `bureau/electron/claudeOfficeIpc.mjs`). Absent sur le site et le téléphone :
 * Claude Office (serveur local + hooks de Claude Code) ne tourne que sur le PC.
 */

import type { EntreeHistorique } from './logiqueHistorique';

export interface EtatServeurOffice {
  joignable: boolean;
  agents?: number;
  clients?: number;
  erreur?: string;
}

export interface EtatClaudeOffice {
  /** Adresse du serveur local (127.0.0.1 ou localhost). */
  url: string;
  /** Dossier de Claude Office trouvé ou choisi sur ce PC ; null s'il est introuvable. */
  dossier: string | null;
  hooks: 'absents' | 'installes' | 'illisibles' | 'inconnus';
  /** Hook d'historique (journal local) dans les réglages de Claude Code. */
  historique?: 'absents' | 'installes' | 'incomplet' | 'illisibles';
  serveur: EtatServeurOffice;
}

/** Réglages du journal d'historique (fichier `reglages.json` du journal, propre au PC). */
export interface ReglagesHistorique {
  actif: boolean;
  enregistrerSorties: boolean;
  masquerSecrets: boolean;
  maxFichierMo: number;
  maxTotalMo: number;
  appareil: string | null;
  appareilId?: string;
}

export interface LectureHistorique {
  ok: boolean;
  erreur?: string;
  dossier?: string;
  entrees?: EntreeHistorique[];
  /** Nombre total d'entrées (la fenêtre n'en reçoit que les plus récentes). */
  total?: number;
  /** Lignes illisibles ignorées (ligne tronquée par un crash…). */
  ignorees?: number;
  octets?: number;
  fichiers?: number;
  reglages?: ReglagesHistorique;
}

export type CritereSuppression = { ids: string[] } | { du: string; au: string } | { tout: true };

/** Activité récente du journal local, pour l'onglet « Bureau » (lecture légère, relue toutes les 2 s). */
export interface LectureActivitePc {
  ok: boolean;
  erreur?: string;
  /** Rien n'a changé depuis la signature `connu` passée : `entrees` est absent. */
  inchange?: boolean;
  /** Signature du journal (taille des fichiers), à repasser à l'appel suivant. */
  signature?: string;
  /** Entrées des dernières heures seulement (les plus récentes). */
  entrees?: EntreeHistorique[];
  appareilId?: string;
  appareil?: string | null;
}

export interface PontHistorique {
  lire(): Promise<LectureHistorique>;
  /** Absent sur un PC dont l'application n'est pas encore à jour : `lire` sert alors. */
  activite?(connu?: string): Promise<LectureActivitePc>;
  reglages(changements: Partial<Pick<ReglagesHistorique, 'actif' | 'enregistrerSorties' | 'masquerSecrets'>> & { appareil?: string }): Promise<{ ok: boolean; erreur?: string; reglages?: ReglagesHistorique }>;
  /** Le processus principal montre une confirmation native avant de supprimer. */
  supprimer(critere: CritereSuppression): Promise<{ ok: boolean; erreur?: string; annule?: boolean; supprimees?: number }>;
  /** Boîte d'ouverture native : journal JSONL d'un autre appareil équipé. */
  importer(): Promise<{ ok: boolean; erreur?: string; annule?: boolean; importees?: number; ignorees?: number }>;
  apercuHooks(desinstaller?: boolean): Promise<ResultatOffice>;
  installerHooks(desinstaller?: boolean): Promise<ResultatOffice>;
}

export interface PlanHooks {
  fichier: string;
  existe: boolean;
  commande: string;
  change: boolean;
  ajouts: string[];
  retraits: string[];
  /** Texte exact montré aussi dans la confirmation native. */
  description: string;
}

export interface ResultatOffice {
  ok: boolean;
  erreur?: string;
  annule?: boolean;
  ecrit?: boolean;
  sauvegarde?: string | null;
  plan?: PlanHooks;
  dossier?: string;
  url?: string;
}

export interface PontClaudeOffice {
  etat(): Promise<EtatClaudeOffice>;
  choisirDossier(): Promise<ResultatOffice>;
  reglerUrl(url: string): Promise<ResultatOffice>;
  apercuHooks(desinstaller?: boolean): Promise<ResultatOffice>;
  /** Le processus principal montre une confirmation native avant d'écrire. */
  installerHooks(desinstaller?: boolean): Promise<ResultatOffice>;
  ouvrir(): Promise<boolean>;
  /** Absent sur un PC dont l'application n'est pas encore à jour. */
  historique?: PontHistorique;
}

export function pontClaudeOffice(): PontClaudeOffice | undefined {
  const pont = (globalThis as { applibourse?: { bureau?: boolean; claudeOffice?: PontClaudeOffice } }).applibourse;
  return pont?.bureau && pont.claudeOffice ? pont.claudeOffice : undefined;
}

/** Commande à lancer sur le PC, depuis le dossier d'AppDashboard. */
export const COMMANDE_HOOKS = 'npm run office:hooks';
export const COMMANDE_APERCU = 'npm run office:hooks -- --a-blanc';
export const COMMANDE_DOSSIER = 'npm run office:hooks -- --dossier "<dossier de Claude Office>"';

/** Résumé de l'état pour la tuile et l'écran. */
export function libelleServeur(serveur: EtatServeurOffice | undefined): string {
  if (!serveur) {
    return 'État inconnu';
  }
  if (!serveur.joignable) {
    return 'Serveur arrêté ou injoignable';
  }
  const agents = serveur.agents ?? 0;
  return `En marche · ${agents} agent${agents > 1 ? 's' : ''} actif${agents > 1 ? 's' : ''}`;
}

export const LIBELLE_HOOKS: Record<EtatClaudeOffice['hooks'], string> = {
  installes: 'Installés dans les réglages de Claude Code',
  absents: 'Pas encore installés',
  illisibles: 'Réglages de Claude Code illisibles (JSON invalide ?)',
  inconnus: 'Inconnu : choisissez d’abord le dossier de Claude Office',
};

export const LIBELLE_HOOK_HISTORIQUE: Record<NonNullable<EtatClaudeOffice['historique']>, string> = {
  installes: 'Installé : chaque requête de Claude Code sur ce PC est enregistrée',
  absents: 'Pas encore installé : rien n’est enregistré',
  incomplet: 'Installé, à mettre à jour : il manque des événements récents (attente, durée des outils, sous-agents, échecs)',
  illisibles: 'Réglages de Claude Code illisibles (JSON invalide ?)',
};
