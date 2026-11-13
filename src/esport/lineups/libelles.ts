/**
 * Libellés des lineups (purs, testés) : phrases du journal et des notifications.
 */

import { trLu } from '../i18n/lineups';

const texte = (v: unknown) => (typeof v === 'string' ? v : '?');

/** Phrase du journal pour une action des lineups ; undefined si l'action n'est pas la nôtre. */
export function phraseJournalLineups(action: string, qui: string, m: Record<string, unknown>): string | undefined {
  const titre = texte(m.titre);
  switch (action) {
    case 'lineup.created':
      return trLu(m.statut === 'propose' ? 'jr.proposed' : 'jr.created', { qui, titre, carte: typeof m.carte === 'string' ? ` (${m.carte})` : '' });
    case 'lineup.updated':
      return trLu('jr.updated', { qui, titre });
    case 'lineup.validated':
      return trLu('jr.validated', { qui, titre });
    case 'lineup.deleted':
      return trLu('jr.deleted', { qui, titre });
    case 'lineup.restored':
      return trLu('jr.restored', { qui, titre });
    case 'lineup.linked':
      return trLu('jr.linked', { qui, titre, strat: texte(m.stratTitre) });
    case 'lineup.unlinked':
      return trLu('jr.unlinked', { qui, titre, strat: texte(m.stratTitre) });
    default:
      return undefined;
  }
}

/** Phrase d'une notification personnelle des lineups (proposé : au staff ; validé : à l'auteur). */
export function phraseNotificationLineups(type: string, team: string, c: Record<string, unknown>, nom: (id: unknown) => string): string | undefined {
  const carte = typeof c.carte === 'string' ? ` (${c.carte})` : '';
  if (type === 'lineup-propose') return trLu('nt.propose', { membre: c.membre ? nom(c.membre) : trLu('nt.un_membre'), team, titre: texte(c.titre), carte });
  if (type === 'lineup-valide') return trLu('nt.valide', { team, titre: texte(c.titre) });
  return undefined;
}
