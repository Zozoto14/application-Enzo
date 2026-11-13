/**
 * Libellés des plans de match (purs, testés) : phrases du journal et des notifications. Aucun contenu tactique n'y
 * figure : le titre du plan, l'adversaire et la date seulement.
 */

import { trPm } from '../i18n/plans';

const texte = (v: unknown) => (typeof v === 'string' && v ? v : '?');

/** Phrase du journal pour une action des plans de match ; undefined si l'action n'est pas la nôtre. */
export function phraseJournalPlans(action: string, qui: string, m: Record<string, unknown>): string | undefined {
  const titre = texte(m.titre);
  switch (action) {
    case 'plan_match.created':
      return trPm(m.modele ? 'jr.created_modele' : 'jr.created', { qui, titre });
    case 'plan_match.updated':
      return trPm('jr.updated', { qui, titre });
    case 'plan_match.ready':
      return trPm('jr.ready', { qui, titre });
    case 'plan_match.played':
      return trPm('jr.played', { qui, titre });
    case 'plan_match.deleted':
      return trPm('jr.deleted', { qui, titre });
    case 'plan_match.restored':
      return trPm('jr.restored', { qui, titre });
    default:
      return undefined;
  }
}

/** Phrase de la notification « plan prêt » (aux membres de la team). */
export function phraseNotificationPlans(type: string, team: string, c: Record<string, unknown>): string | undefined {
  if (type !== 'plan-pret') return undefined;
  const adversaire = typeof c.adversaire === 'string' && c.adversaire ? c.adversaire : null;
  return adversaire ? trPm('nt.pret_contre', { team, adversaire }) : trPm('nt.pret', { team, titre: texte(c.titre) });
}
