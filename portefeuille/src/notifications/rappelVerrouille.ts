/**
 * Briefing pendant que l'application est verrouillée.
 *
 * Le portefeuille est chiffré : tant qu'on n'a pas déverrouillé, impossible
 * d'en donner la valeur. Mais se taire, c'est laisser croire que le briefing
 * ne marche pas. À l'heure prévue, on prévient donc que le briefing attend,
 * sans aucun chiffre ; le vrai part dès le déverrouillage.
 *
 * Le planning (des heures, rien de sensible) est recopié hors du coffre pour
 * rester lisible verrouillé.
 */

import { briefingsDus, identifiantBriefing, planningDepuisJson } from './planification';

export interface RappelBriefing {
  identifiant: string;
  titre: string;
  corps: string;
}

export function rappelsDus(
  planningJson: string | undefined,
  maintenant: Date,
  dejaEnvoyes: readonly string[],
): RappelBriefing[] {
  if (!planningJson) return [];
  const faits = new Set(dejaEnvoyes.map(identifiant => identifiant.replace(/^rappel-/, '')));
  return briefingsDus(planningDepuisJson(planningJson), maintenant, { dejaEnvoyes: faits }).map(du => ({
    identifiant: `rappel-${identifiantBriefing(maintenant, du.moment)}`,
    titre: du.moment === 'matin' ? '☀️ Votre briefing du matin est prêt' : '🌙 Votre briefing de clôture est prêt',
    corps: '🔒 Déverrouillez AppliBourse pour voir où en est votre portefeuille.',
  }));
}

/** Garde les derniers identifiants : de quoi ne rien répéter sur deux jours. */
export function retenirRappels(deja: readonly string[], nouveaux: readonly string[]): string[] {
  return [...deja, ...nouveaux].slice(-8);
}
