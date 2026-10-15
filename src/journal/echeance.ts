/**
 * Échéance du soir et rattrapage.
 *
 * La page d'un jour est « due » à partir de l'heure réglée (21 h par défaut)
 * de CE jour. Si l'app était fermée à ce moment-là, elle l'est toujours à la
 * première ouverture : `joursDus` rend alors tous les jours échus qui n'ont pas
 * encore de page, du premier jour couvert (`depuis`) jusqu'à aujourd'hui, dans
 * la limite des `MAX_RATTRAPAGE` derniers jours. Pur : l'horloge est passée en
 * paramètre.
 */

import { ajouterJours, instantDu, jourDe, joursEntre } from './dates';
import { bornerHeure, type ReglagesJournal } from './modele';

/** Au plus ce nombre de jours écrits d'un coup à l'ouverture (une longue absence ne fabrique pas un mois de pages). */
export const MAX_RATTRAPAGE = 14;

/** Instant à partir duquel la page de `jour` est due. */
export const echeanceDu = (jour: string, heure: number): number => instantDu(jour, bornerHeure(heure));

/**
 * Jours à écrire maintenant, du plus ancien au plus récent.
 * @param existants jours qui ont déjà une page rédigée (pas une page créée par une simple note)
 */
export function joursDus(maintenant: number, reglages: Pick<ReglagesJournal, 'actif' | 'heure' | 'depuis'>, existants: ReadonlySet<string>, max = MAX_RATTRAPAGE): string[] {
  if (!reglages.actif) return [];
  const aujourdhui = jourDe(maintenant);
  // Seuls les `max` derniers jours sont éligibles ; un jour futur dans `depuis` (horloge reculée) ne produit rien.
  const debut = ajouterJours(aujourdhui, -(max - 1));
  const jours = joursEntre(reglages.depuis > debut ? reglages.depuis : debut, aujourdhui).filter(j => echeanceDu(j, reglages.heure) <= maintenant && !existants.has(j));
  return jours.slice(-max);
}

/** Prochain instant où une page sera écrite automatiquement (aujourd'hui s'il n'est pas passé, sinon demain). */
export function prochaineEcheance(maintenant: number, reglages: Pick<ReglagesJournal, 'heure'>, existants: ReadonlySet<string>): { jour: string; instant: number } {
  const aujourdhui = jourDe(maintenant);
  const jour = echeanceDu(aujourdhui, reglages.heure) > maintenant || !existants.has(aujourdhui) ? aujourdhui : ajouterJours(aujourdhui, 1);
  const instant = echeanceDu(jour, reglages.heure);
  return { jour, instant };
}

/** Phrase pour l'écran : « Prochaine page ce soir à 21 h » / « demain à 21 h » / « à l'instant à rattraper ». */
export function libelleProchaine(maintenant: number, reglages: Pick<ReglagesJournal, 'actif' | 'heure' | 'depuis'>, existants: ReadonlySet<string>): string {
  if (!reglages.actif) return 'Écriture automatique désactivée.';
  if (joursDus(maintenant, reglages, existants).length > 0) return 'Une page est prête à être écrite.';
  const p = prochaineEcheance(maintenant, reglages, existants);
  const h = `${bornerHeure(reglages.heure)} h`;
  return p.jour === jourDe(maintenant) ? `Prochaine page ce soir à ${h}.` : `Prochaine page demain à ${h}.`;
}
