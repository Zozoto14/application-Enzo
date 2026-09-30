/**
 * Données propres à l'Administration, rangées dans la base chiffrée de
 * l'administrateur (clé `admin.donnees`) : réglages, notes privées, journal
 * d'audit, dernier état connu des connexions et état de sécurité.
 *
 * Aucun nouveau fichier : la base chiffrée du profil suffit (la liste fermée
 * de `bureau/electron/principal.mjs` reste inchangée).
 *
 * Format versionné. Version 0 : rien d'enregistré (Administration d'avant) —
 * on part des défauts. Toute valeur illisible retombe sur son défaut, champ
 * par champ : une donnée corrompue ne bloque jamais l'Administration.
 */

import { lireJournal, borner, journaliser, TAILLE_MAX_JOURNAL, type EvenementAudit } from './journal';
import type { StockagePrefs } from '../personnalisation';
import { abonnementsVides, lireAbonnements, type DonneesAbo } from '../abonnements/abonnements';

export const VERSION_DONNEES = 1;
export const CLE_DONNEES = 'admin.donnees';

export interface ReglagesAdmin {
  /** Jours de conservation du journal. */
  retentionJours: number;
  /** Nombre maximal d'entrées du journal. */
  tailleJournal: number;
  /** Minutes sans activité avant le verrouillage du panneau (0 : jamais). */
  verrouMinutes: number;
  /** Jours sans connexion au-delà desquels un compte est signalé inactif. */
  inactifJours: number;
  /** Durée de validité proposée pour une invitation, en jours. */
  invitationJours: number;
  /** Minutes pendant lesquelles une vérification d'identité reste valable pour les actions sensibles. */
  confianceMinutes: number;
}

export const REGLAGES_DEFAUT: ReglagesAdmin = {
  retentionJours: 180,
  tailleJournal: 1000,
  verrouMinutes: 5,
  inactifJours: 30,
  invitationJours: 7,
  confianceMinutes: 5,
};

/** Bornes de chaque réglage : en dehors, on retombe sur la borne. */
export const BORNES_REGLAGES: Record<keyof ReglagesAdmin, { min: number; max: number }> = {
  retentionJours: { min: 7, max: 3650 },
  tailleJournal: { min: 100, max: TAILLE_MAX_JOURNAL },
  verrouMinutes: { min: 0, max: 120 },
  inactifJours: { min: 1, max: 365 },
  invitationJours: { min: 1, max: 90 },
  confianceMinutes: { min: 1, max: 60 },
};

export type Robustesse = 'faible' | 'moyenne' | 'forte';

export interface DonneesAdmin {
  version: number;
  reglages: ReglagesAdmin;
  /** Notes privées de l'administrateur, par identifiant de profil. */
  notes: Record<string, string>;
  journal: EvenementAudit[];
  /** Connexions déjà reportées au journal, par profil (compteur). */
  connexionsVues: Record<string, number>;
  /** Suivi manuel des abonnements (voir `abonnements/abonnements.ts`). */
  abonnements: DonneesAbo;
  /**
   * Robustesse du mot de passe administrateur, évaluée lors de la dernière
   * vérification d'identité (le mot de passe lui-même n'est jamais gardé).
   */
  robustesse?: { niveau: Robustesse; le: string };
}

export const LONGUEUR_MAX_NOTE = 1000;
const MOTIF_ID = /^[a-z0-9]{2,16}$/;

export function donneesVides(): DonneesAdmin {
  return { version: VERSION_DONNEES, reglages: { ...REGLAGES_DEFAUT }, notes: {}, journal: [], connexionsVues: {}, abonnements: abonnementsVides() };
}

export function bornerReglage(cle: keyof ReglagesAdmin, valeur: unknown): number {
  const { min, max } = BORNES_REGLAGES[cle];
  if (typeof valeur !== 'number' || !Number.isFinite(valeur)) {
    return REGLAGES_DEFAUT[cle];
  }
  return Math.min(max, Math.max(min, Math.round(valeur)));
}

export function lireReglages(brut: unknown): ReglagesAdmin {
  const source = brut && typeof brut === 'object' && !Array.isArray(brut) ? (brut as Record<string, unknown>) : {};
  const reglages = { ...REGLAGES_DEFAUT };
  for (const cle of Object.keys(REGLAGES_DEFAUT) as Array<keyof ReglagesAdmin>) {
    if (cle in source) {
      reglages[cle] = bornerReglage(cle, source[cle]);
    }
  }
  return reglages;
}

function lireNotes(brut: unknown): Record<string, string> {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) {
    return {};
  }
  const notes: Record<string, string> = {};
  for (const [id, note] of Object.entries(brut as Record<string, unknown>)) {
    if (MOTIF_ID.test(id) && typeof note === 'string' && note.trim()) {
      notes[id] = note.slice(0, LONGUEUR_MAX_NOTE);
    }
  }
  return notes;
}

function lireCompteurs(brut: unknown): Record<string, number> {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) {
    return {};
  }
  const compteurs: Record<string, number> = {};
  for (const [id, n] of Object.entries(brut as Record<string, unknown>)) {
    if (MOTIF_ID.test(id) && typeof n === 'number' && Number.isFinite(n) && n >= 0) {
      compteurs[id] = Math.floor(n);
    }
  }
  return compteurs;
}

/**
 * Relit les données, quelle que soit la version qui les a écrites.
 * Une version plus récente que celle-ci est lue au mieux (champs connus).
 */
export function lireDonnees(brut: string | undefined | null): DonneesAdmin {
  if (!brut) {
    return donneesVides();
  }
  let lu: unknown;
  try {
    lu = JSON.parse(brut);
  } catch {
    return donneesVides();
  }
  if (!lu || typeof lu !== 'object' || Array.isArray(lu)) {
    return donneesVides();
  }
  const o = lu as Record<string, unknown>;
  const reglages = lireReglages(o.reglages);
  const donnees: DonneesAdmin = {
    version: VERSION_DONNEES,
    reglages,
    notes: lireNotes(o.notes),
    journal: lireJournal(o.journal).slice(-reglages.tailleJournal),
    connexionsVues: lireCompteurs(o.connexionsVues),
    abonnements: lireAbonnements(o.abonnements),
  };
  const r = o.robustesse as { niveau?: unknown; le?: unknown } | undefined;
  if (r && (r.niveau === 'faible' || r.niveau === 'moyenne' || r.niveau === 'forte') && typeof r.le === 'string') {
    donnees.robustesse = { niveau: r.niveau, le: r.le };
  }
  return donnees;
}

export function ecrireDonnees(donnees: DonneesAdmin): string {
  return JSON.stringify({ ...donnees, version: VERSION_DONNEES });
}

export function chargerDonnees(stockage: StockagePrefs): DonneesAdmin {
  try {
    return lireDonnees(stockage.lire(CLE_DONNEES));
  } catch {
    return donneesVides();
  }
}

export function enregistrerDonnees(stockage: StockagePrefs, donnees: DonneesAdmin): boolean {
  try {
    stockage.ecrire(CLE_DONNEES, ecrireDonnees(donnees));
    return true;
  } catch {
    return false;
  }
}

/** Ajoute un événement au journal, selon les réglages de rétention. */
export function avecEvenement(donnees: DonneesAdmin, evenement: Parameters<typeof journaliser>[1], maintenant: number): DonneesAdmin {
  return {
    ...donnees,
    journal: journaliser(donnees.journal, evenement, maintenant, donnees.reglages.retentionJours, donnees.reglages.tailleJournal),
  };
}

/** Applique de nouveaux réglages (bornés) et rebornes le journal en conséquence. */
export function avecReglages(donnees: DonneesAdmin, changement: Partial<ReglagesAdmin>, maintenant: number): DonneesAdmin {
  const reglages = lireReglages({ ...donnees.reglages, ...changement });
  return { ...donnees, reglages, journal: borner(donnees.journal, maintenant, reglages.retentionJours, reglages.tailleJournal) };
}

export function avecNote(donnees: DonneesAdmin, id: string, note: string): DonneesAdmin {
  const notes = { ...donnees.notes };
  const propre = note.slice(0, LONGUEUR_MAX_NOTE);
  if (propre.trim()) {
    notes[id] = propre;
  } else {
    delete notes[id];
  }
  return { ...donnees, notes };
}

/**
 * Évalue un mot de passe sans le garder : longueur et variété des classes
 * de caractères. Sert au tableau de sécurité.
 */
export function evaluerRobustesse(motDePasse: string): Robustesse {
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(m => m.test(motDePasse)).length;
  if (motDePasse.length >= 16 && classes >= 3) {
    return 'forte';
  }
  if (motDePasse.length >= 12 && classes >= 2) {
    return 'moyenne';
  }
  return 'faible';
}
