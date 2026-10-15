/**
 * Entrée du Journal automatique dans le registre du hub (`src/hub/registre.tsx`).
 *
 * Identifiant `journal` : ne pas le changer (il est enregistré dans les
 * autorisations des profils). Page « Applications » : l'Administration l'ouvre
 * ou la ferme à un profil comme les autres apps ; chaque profil n'y lit que SON
 * journal (sa base chiffrée), jamais celui d'un autre rang.
 */

import type { AppHub, ContexteHub, InfoLive } from '../hub/types';
import { accesJournal } from './acces';
import { ID_JOURNAL } from './constantes';
import { jourDe } from './dates';
import { libelleProchaine } from './echeance';
import { joursEcrits } from './moteur';
import { lirePage, lireResume, lireReglages } from './modele';
import { AppJournal } from './AppJournal';

export { ID_JOURNAL };

/** Information en direct de la tuile : page du jour, prochaine échéance, pages et jours épinglés. */
export function infoJournal(contexte: ContexteHub): InfoLive | undefined {
  const base = contexte.baseProfil;
  if (!base) return undefined;
  try {
    const maintenant = contexte.maintenant ?? Date.now();
    const reglages = lireReglages(base);
    const aujourdhui = jourDe(maintenant);
    const resume = lireResume(base);
    const duJour = lirePage(base, aujourdhui);
    const sousTitre = !reglages
      ? 'Une page chaque soir, écrite pour vous.'
      : duJour && duJour.auto.moteur !== 'vide'
        ? 'La page d’aujourd’hui est écrite.'
        : libelleProchaine(maintenant, reglages, joursEcrits(base, aujourdhui, aujourdhui));
    return {
      sousTitre,
      indicateurs: [
        { libelle: 'Pages', valeur: String(resume.pages) },
        { libelle: 'Épinglées', valeur: String(resume.epinglees) },
      ],
    };
  } catch {
    return undefined;
  }
}

export const APP_JOURNAL: AppHub = {
  id: ID_JOURNAL,
  nom: 'Journal',
  categorie: 'Organisation',
  page: 'publique',
  description: 'Chaque soir, une page de journal écrite pour vous à partir de vos apps : tâches, Claude, épisodes, bourse, abonnements.',
  icone: '✎︎',
  teinte: 'quatre',
  disponible: accesJournal,
  info: infoJournal,
  Racine: AppJournal,
};
