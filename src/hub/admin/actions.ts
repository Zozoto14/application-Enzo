/**
 * Actions de l'Administration, chacune précédée de la vérification du rôle
 * de l'appelant (`roles.ts`). L'interface et l'hôte passent par ces
 * fonctions : c'est ici, dans la logique, que « un gestionnaire ne peut pas… »
 * est appliqué — pas seulement en cachant des boutons.
 *
 * Les fonctions de `comptes.ts` restent pures et sans notion de rôle : ne les
 * appelez pas directement depuis une action de l'utilisateur.
 */

import { ajouterProfil, renommerProfil, supprimerProfil, type OptionsNouveauProfil, type Profil } from '../../profils/profils';
import type { AppHub } from '../types';
import {
  annulerInvitation,
  appliquerGroupe,
  changerPolitique,
  definirExpiration,
  definirNiveaux,
  desactiver,
  prolongerInvitation,
  reactiver,
  suspendre,
  type ActionGroupee,
} from './comptes';
import { avecNote, avecReglages, type DonneesAdmin, type ReglagesAdmin } from './donnees';
import { exporterCsv, exporterJson, type EvenementAudit } from './journal';
import type { Niveaux } from './niveaux';
import type { PolitiqueHub } from './politique';
import { definirRang, exiger, exigerRang, type ActionAdmin, type Rang } from './roles';

type Acteur = Pick<Profil, 'id' | 'admin' | 'role'>;

function cibleDe(profils: readonly Profil[], id: string): Profil | undefined {
  return profils.find(p => p.id === id);
}

/** Vérifie l'action sur un compte de la liste, puis rend la liste inchangée. */
export function verifierSur(acteur: Acteur | undefined, action: ActionAdmin, profils: readonly Profil[], id: string): void {
  exiger(acteur, action, cibleDe(profils, id));
}

export function definirNiveauxPar(acteur: Acteur | undefined, profils: readonly Profil[], id: string, apps: readonly AppHub[], niveaux: Niveaux): Profil[] {
  verifierSur(acteur, 'permissions-ami', profils, id);
  return definirNiveaux(profils, id, apps, niveaux);
}

export function suspendrePar(acteur: Acteur | undefined, profils: readonly Profil[], id: string, jusquau: string, maintenant: number): Profil[] {
  verifierSur(acteur, 'etat-ami', profils, id);
  return suspendre(profils, id, jusquau, maintenant);
}

export function desactiverPar(acteur: Acteur | undefined, profils: readonly Profil[], id: string): Profil[] {
  verifierSur(acteur, 'etat-ami', profils, id);
  return desactiver(profils, id);
}

export function reactiverPar(acteur: Acteur | undefined, profils: readonly Profil[], id: string): Profil[] {
  verifierSur(acteur, 'etat-ami', profils, id);
  return reactiver(profils, id);
}

export function definirExpirationPar(acteur: Acteur | undefined, profils: readonly Profil[], id: string, expireLe: string | undefined): Profil[] {
  verifierSur(acteur, 'etat-ami', profils, id);
  return definirExpiration(profils, id, expireLe);
}

export function prolongerInvitationPar(acteur: Acteur | undefined, profils: readonly Profil[], id: string, jours: number, maintenant: number): Profil[] {
  verifierSur(acteur, 'invitation-ami', profils, id);
  return prolongerInvitation(profils, id, jours, maintenant);
}

export function annulerInvitationPar(acteur: Acteur | undefined, profils: readonly Profil[], id: string, maintenant: number): Profil[] {
  verifierSur(acteur, 'invitation-ami', profils, id);
  return annulerInvitation(profils, id, maintenant);
}

const ACTION_DU_GROUPE: Record<ActionGroupee['genre'], ActionAdmin> = {
  desactiver: 'etat-ami',
  reactiver: 'etat-ami',
  niveaux: 'permissions-ami',
  prolonger: 'invitation-ami',
};

/**
 * Action groupée : tout ou rien. Si UN seul compte visé est interdit à
 * l'acteur, rien n'est modifié et l'action est refusée (pas de succès partiel silencieux).
 */
export function appliquerGroupePar(
  acteur: Acteur | undefined,
  profils: readonly Profil[],
  ids: readonly string[],
  action: ActionGroupee,
  apps: readonly AppHub[],
  maintenant: number,
): { profils: Profil[]; modifies: string[] } {
  for (const id of ids) {
    verifierSur(acteur, ACTION_DU_GROUPE[action.genre], profils, id);
  }
  return appliquerGroupe(profils, ids, action, apps, maintenant);
}

export function ajouterProfilPar(
  acteur: Acteur | undefined,
  profils: readonly Profil[],
  nom: string,
  id: string,
  maintenant: string,
  apps?: readonly string[],
  options?: OptionsNouveauProfil,
): Profil[] {
  exiger(acteur, 'creer-ami');
  return ajouterProfil(profils, nom, id, maintenant, apps, options);
}

export function renommerProfilPar(acteur: Acteur | undefined, profils: readonly Profil[], id: string, nom: string): Profil[] {
  verifierSur(acteur, 'renommer-ami', profils, id);
  return renommerProfil(profils, id, nom);
}

export function supprimerProfilPar(acteur: Acteur | undefined, profils: readonly Profil[], id: string): Profil[] {
  verifierSur(acteur, 'supprimer-ami', profils, id);
  return supprimerProfil(profils, id);
}

/**
 * Changer le rang d'un compte : l'appelant doit être strictement au-dessus de
 * la cible ET du rang donné (seul un Fondateur nomme un Administrateur ou un
 * Fondateur). La partie cryptographique (paire de séquestre, re-scellement,
 * retrait des dépôts) est faite par l'hôte (`src/profils/rangs.ts`).
 */
export function definirRangPar(acteur: Acteur | undefined, profils: readonly Profil[], id: string, rang: Rang): Profil[] {
  exigerRang(acteur, cibleDe(profils, id), rang);
  return definirRang(profils, id, rang);
}

/** Ancien nom : Gestionnaire ou Ami. */
export function definirRolePar(acteur: Acteur | undefined, profils: readonly Profil[], id: string, role: 'ami' | 'gestionnaire'): Profil[] {
  return definirRangPar(acteur, profils, id, role);
}

/** Politique globale des apps (activation, maintenance, accès par défaut) : administrateur seulement. */
export function changerPolitiquePar(acteur: Acteur | undefined, profils: readonly Profil[], politique: PolitiqueHub): Profil[] {
  exiger(acteur, 'politique-apps');
  return changerPolitique(profils, politique);
}

export function avecReglagesPar(acteur: Acteur | undefined, donnees: DonneesAdmin, changement: Partial<ReglagesAdmin>, maintenant: number): DonneesAdmin {
  exiger(acteur, 'reglages-admin');
  return avecReglages(donnees, changement, maintenant);
}

export function avecNotePar(acteur: Acteur | undefined, donnees: DonneesAdmin, profils: readonly Profil[], id: string, note: string): DonneesAdmin {
  verifierSur(acteur, 'notes', profils, id);
  return avecNote(donnees, id, note);
}

export function exporterJournalPar(acteur: Acteur | undefined, format: 'json' | 'csv', journal: readonly EvenementAudit[]): string {
  exiger(acteur, 'exporter-journal');
  return format === 'json' ? exporterJson(journal) : exporterCsv(journal);
}

/**
 * Liste modifiée par l'Administration (accès, suspensions, invitations,
 * politique…) : tout compte qui change doit être de rang STRICTEMENT
 * inférieur à l'acteur ; le compte historique ne change que par sa politique
 * des apps (Fondateurs). Lève `ErreurPermission` sinon, sans rien modifier.
 */
export function verifierModifications(acteur: Acteur | undefined, avant: readonly Profil[], apres: readonly Profil[]): void {
  for (const p of apres) {
    const a = avant.find(x => x.id === p.id);
    if (!a || JSON.stringify(a) === JSON.stringify(p)) continue;
    if (p.admin) {
      const sansPolitique = (x: Profil) => JSON.stringify({ ...x, politique: undefined });
      if (sansPolitique(a) !== sansPolitique(p)) exiger(acteur, 'modifier-admin');
      exiger(acteur, 'politique-apps');
      continue;
    }
    exiger(acteur, 'permissions-ami', a);
  }
}
