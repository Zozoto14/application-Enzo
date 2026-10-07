/**
 * Branchement du portefeuille sur le hub (`hub/src`, alias `@hub`).
 *
 * Le hub ne connaît pas le portefeuille : c'est ici que le portefeuille
 * enregistre son app dans le registre, publie le résumé affiché sur sa tuile
 * et prête à l'Administration ce qu'elle demande (le QR code).
 *
 * **Ajouter une app au hub = ajouter sa définition à `REGISTRE`.**
 */

import { appAdministration, creerRegistre, type AppHub, type ContexteHub, type InfoLive, type Tendance } from '@hub';
import { QrCode } from '../ui/ecrans/CarteSynchro';

/** Identifiant enregistré dans les autorisations : ne pas le changer (ancien : « portfolio »). */
export const ID_PORTEFEUILLE = 'portefeuille';

/** Portefeuille déchiffré, résumé pour la tuile du hub. */
export interface ResumePortefeuille {
  /** Valeur totale, déjà mise en forme (et masquée en mode discret). */
  valeur: string;
  /** Variation de la dernière séance, si l'historique la permet. */
  variation?: { pourcentage: string; montant: string; tendance: Tendance; date: string };
  sansCompte: boolean;
}

export function infoPortefeuille(resume: ResumePortefeuille | undefined): InfoLive | undefined {
  if (!resume) {
    return undefined;
  }
  if (resume.sansCompte) {
    return { sousTitre: 'Créez votre premier compte titre pour commencer.', indicateurs: [] };
  }
  return {
    sousTitre: resume.variation ? `Dernière séance : ${resume.variation.date}` : undefined,
    indicateurs: [
      { libelle: 'Valeur', valeur: resume.valeur },
      resume.variation
        ? { libelle: 'Aujourd’hui', valeur: resume.variation.pourcentage, tendance: resume.variation.tendance }
        : { libelle: 'Aujourd’hui', valeur: '—' },
    ],
  };
}

/** Résumé publié par le portefeuille dans le contexte du hub. */
export function resumeDuContexte(contexte: ContexteHub): ResumePortefeuille | undefined {
  return contexte.donnees?.[ID_PORTEFEUILLE] as ResumePortefeuille | undefined;
}

export const APP_PORTEFEUILLE: AppHub = {
  id: ID_PORTEFEUILLE,
  nom: 'Portefeuille',
  categorie: 'Finance',
  description: 'Positions, performance, alertes et podcast du jour.',
  icone: '↗',
  teinte: 'portefeuille',
  info: contexte => infoPortefeuille(resumeDuContexte(contexte)),
  // Pas de Racine : l'arbre du portefeuille est celui d'App, déjà monté.
};

export const REGISTRE: readonly AppHub[] = creerRegistre([APP_PORTEFEUILLE, appAdministration({ QrCode })]);
