/**
 * Libellés des strats et du playbook (purs, testés) : types, sides, statuts,
 * phrases du journal et des notifications.
 */

import type { StatutPlaybook } from './api';
import type { Side, TypeStrat } from './document';

export const LIBELLES_SIDE: Record<Side, string> = { attaque: 'Attaque', defense: 'Défense' };
export const LIBELLES_TYPE_STRAT: Record<TypeStrat, string> = { default: 'Default', execute: 'Exécution', eco: 'Éco', pistol: 'Pistol', retake: 'Retake', other: 'Autre' };
export const TYPES_STRAT = Object.keys(LIBELLES_TYPE_STRAT) as TypeStrat[];
export const LIBELLES_STATUT_PLAYBOOK: Record<StatutPlaybook, string> = { brouillon: 'Brouillon', validee: 'Validée', archivee: 'Archivée' };

/** Tags saisis « A, exec, rapide » → liste propre (sans doublon, 12 au plus). */
export function lireTags(texte: string): string[] {
  const vus = new Set<string>();
  const sortie: string[] = [];
  for (const brut of texte.split(',')) {
    const t = brut.trim().replace(/\s+/g, ' ').slice(0, 24);
    if (!t || vus.has(t.toLocaleLowerCase('fr'))) continue;
    vus.add(t.toLocaleLowerCase('fr'));
    sortie.push(t);
  }
  return sortie.slice(0, 12);
}

const texte = (v: unknown) => (typeof v === 'string' ? v : '?');

/** Phrase du journal pour une action des strats ou du playbook ; undefined si l'action n'est pas la nôtre. */
export function phraseJournalStrats(action: string, qui: string, m: Record<string, unknown>): string | undefined {
  switch (action) {
    case 'strat.created':
      return `${qui} a créé la strat « ${texte(m.titre)} »${typeof m.carte === 'string' ? ` (${m.carte})` : ''}`;
    case 'strat.updated':
      return `${qui} a enregistré la strat « ${texte(m.titre)} »${typeof m.revision === 'number' ? ` (version ${m.revision})` : ''}`;
    case 'strat.duplicated':
      return `${qui} a dupliqué « ${texte(m.sourceTitre)} » en « ${texte(m.titre)} »`;
    case 'strat.deleted':
      return `${qui} a supprimé la strat « ${texte(m.titre)} »`;
    case 'strat.share_created':
      return `${qui} a créé un lien de lecture seule pour « ${texte(m.titre)} »`;
    case 'strat.share_revoked':
      return `${qui} a révoqué un lien de lecture seule de « ${texte(m.titre)} »`;
    case 'playbook.created':
      return `${qui} a ajouté « ${texte(m.titre)} » au playbook`;
    case 'playbook.updated':
      return `${qui} a modifié « ${texte(m.titre)} » dans le playbook`;
    case 'playbook.validated':
      return `${qui} a validé « ${texte(m.titre)} » dans le playbook`;
    case 'playbook.archived':
      return `${qui} a archivé « ${texte(m.titre)} » dans le playbook`;
    case 'playbook.deleted':
      return `${qui} a retiré « ${texte(m.titre)} » du playbook`;
    default:
      return undefined;
  }
}

export function phraseNotificationStrats(type: string, team: string, c: Record<string, unknown>): string | undefined {
  if (type === 'playbook-valide') return `Nouvelle entrée validée au playbook de ${team} : « ${texte(c.titre)} »${typeof c.carte === 'string' ? ` (${c.carte})` : ''}`;
  return undefined;
}
