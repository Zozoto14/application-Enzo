/**
 * Actions du suivi des abonnements, chacune précédée de la vérification du
 * rang de l'appelant (`admin/roles.ts`) : seul un Fondateur agit, et
 * seulement sur un compte de rang strictement inférieur. Un Administrateur,
 * un Gestionnaire et un Ami sont refusés ICI (pas seulement par des boutons
 * cachés). Aucune de ces fonctions ne touche au réseau ni au stockage.
 */

import type { Profil } from '../../profils/profils';
import { suspendrePar } from '../admin/actions';
import type { DonneesAdmin } from '../admin/donnees';
import { avecEvenement } from '../admin/donnees';
import type { EvenementAudit } from '../admin/journal';
import { ErreurPermission, autorise, exiger } from '../admin/roles';
import {
  ErreurAbonnement,
  compteVide,
  exporterPaiementsCsv,
  lireReglagesAbo,
  type CompteAbo,
  type ReglagesAbo,
} from './abonnements';

type Acteur = Pick<Profil, 'id' | 'admin' | 'role'>;

/** Comptes sur lesquels `acteur` peut agir (rang strictement inférieur), hors lui-même. */
export function comptesSuivis(acteur: Acteur | undefined, profils: readonly Profil[]): Profil[] {
  return profils.filter(p => autorise(acteur, 'abonnements-gerer', p).ok);
}

export function peutVoirAbonnements(acteur: Acteur | undefined): boolean {
  return autorise(acteur, 'abonnements-voir').ok;
}

/**
 * Applique `changer` au compte d'abonnement de `id`, puis journalise. Le
 * compte visé doit être dans `profils` et de rang inférieur.
 */
export function modifierCompteAboPar(
  acteur: Acteur | undefined,
  donnees: DonneesAdmin,
  profils: readonly Profil[],
  id: string,
  changer: (compte: CompteAbo, reglages: ReglagesAbo) => CompteAbo,
  evenement: string,
  maintenant: number,
): DonneesAdmin {
  const cible = profils.find(p => p.id === id);
  exiger(acteur, 'abonnements-gerer', cible);
  const { reglages } = donnees.abonnements;
  const avant = donnees.abonnements.comptes[id] ?? compteVide(reglages, new Date(maintenant).toISOString());
  const apres = changer(avant, reglages);
  const suivantes: DonneesAdmin = { ...donnees, abonnements: { ...donnees.abonnements, comptes: { ...donnees.abonnements.comptes, [id]: apres } } };
  const entree: Omit<EvenementAudit, 'date'> = { type: 'abonnement', cible: id, nomCible: cible?.nom, action: evenement };
  return avecEvenement(suivantes, entree, maintenant);
}

export function modifierReglagesAboPar(acteur: Acteur | undefined, donnees: DonneesAdmin, changement: Partial<ReglagesAbo>, maintenant: number): DonneesAdmin {
  exiger(acteur, 'abonnements-reglages');
  const reglages = lireReglagesAbo({ ...donnees.abonnements.reglages, ...changement });
  return avecEvenement({ ...donnees, abonnements: { ...donnees.abonnements, reglages } }, { type: 'abonnement', action: 'Réglages des abonnements modifiés' }, maintenant);
}

/** CSV de l'historique, limité aux comptes que l'acteur peut suivre. */
export function exporterPaiementsPar(acteur: Acteur | undefined, donnees: DonneesAdmin, profils: readonly Profil[]): string {
  exiger(acteur, 'abonnements-voir');
  return exporterPaiementsCsv(comptesSuivis(acteur, profils), donnees.abonnements);
}

/**
 * « Suspendre pour impayé » : uniquement si la règle est « restreindre
 * l'accès », jamais automatique, et avec la suspension de compte existante
 * (date de fin obligatoire : rien ne reste coupé par oubli).
 */
export function suspendrePourImpayePar(
  acteur: Acteur | undefined,
  donnees: DonneesAdmin,
  profils: readonly Profil[],
  id: string,
  jours: number,
  maintenant: number,
): Profil[] {
  exiger(acteur, 'abonnements-gerer', profils.find(p => p.id === id));
  if (donnees.abonnements.reglages.actionRetard !== 'restreindre') {
    throw new ErreurPermission('La règle en cas de retard est « rappel seulement » : activez « restreindre l’accès » dans les Paramètres pour suspendre un compte.');
  }
  if (!Number.isInteger(jours) || jours < 1 || jours > 365) {
    throw new ErreurAbonnement('Durée de suspension : de 1 à 365 jours.');
  }
  return suspendrePar(acteur, profils, id, new Date(maintenant + jours * 86_400_000).toISOString(), maintenant);
}

/** Identifiant de l'app Abonnements dans le registre du hub (sans dépendance d'interface). */
export const ID_ABONNEMENTS = 'abonnements';
