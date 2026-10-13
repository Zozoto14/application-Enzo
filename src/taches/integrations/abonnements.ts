/**
 * Lien Tâches ↔ Abonnements (Fondateur seul) : chaque échéance proche ou en
 * retard d'un abonnement devient une tâche du projet « Abonnements » ; une
 * fois le paiement noté dans Abonnements (l'échéance avance), la tâche se
 * termine toute seule. Rien n'est noté dans Abonnements depuis Tâches (un
 * paiement demande un montant et un moyen) : la tâche y renvoie.
 */

import { dateFr, formaterMontant, lignesAbo, type DonneesAbo } from '../../hub/abonnements/abonnements';
import type { Voulue } from './commun';

export function abonnementsVoulus(abo: DonneesAbo, profils: readonly { id: string; nom: string }[], aujourdhui: string): Voulue[] {
  return lignesAbo(profils, abo, aujourdhui)
    .filter(l => (l.statut === 'en-retard' || l.statut === 'echeance-proche') && l.echeance)
    .map(l => {
      const retard = l.statut === 'en-retard';
      const montant = l.compte.montant ? formaterMontant(l.compte.montant, abo.reglages.devise) : '';
      return {
        cle: `${l.id}|${l.echeance}`,
        titre: retard ? `Abonnement de ${l.nom} en retard` : `Abonnement de ${l.nom} : échéance le ${dateFr(l.echeance!)}`,
        description: [montant ? `Montant : ${montant}.` : '', `Échéance : ${dateFr(l.echeance!)}.`, 'Notez le paiement dans Abonnements : la tâche se terminera toute seule.'].filter(Boolean).join('\n'),
        echeance: { jour: l.echeance! },
        priorite: retard ? 'haute' : 'normale',
        etiquettes: ['abonnements'],
      } satisfies Voulue;
    });
}
