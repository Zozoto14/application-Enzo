/**
 * Ce que l'écran Claude Office peut demander au PC, par le pont de
 * l'application de bureau (`window.applibourse.claudeOffice`, voir
 * `bureau/electron/claudeOfficeIpc.mjs`). Absent sur le site et le téléphone :
 * Claude Office (serveur local + hooks de Claude Code) ne tourne que sur le PC.
 */

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
  serveur: EtatServeurOffice;
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
