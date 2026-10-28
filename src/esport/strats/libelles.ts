/**
 * Libellés des strats et du playbook (purs, testés) : types, sides, statuts,
 * phrases du journal et des notifications.
 */

import type { StatutPlaybook } from './api';
import type { Side, TypeStrat } from './document';
import { tr } from '../i18n';
import { trSs } from '../i18n/stratsSuppr';

export const LIBELLES_SIDE: Record<Side, string> = { get attaque() {
      return tr('strats.editeur.attaque');
    }, get defense() {
      return tr('strats.editeur.defense');
    } };
export const LIBELLES_TYPE_STRAT: Record<TypeStrat, string> = { get default() {
      return tr('strats.libelles.default');
    }, get execute() {
      return tr('strats.libelles.execution');
    }, get eco() {
      return tr('strats.libelles.eco');
    }, get pistol() {
      return tr('strats.libelles.pistol');
    }, get retake() {
      return tr('strats.libelles.retake');
    }, get other() {
      return tr('planning.libelles.autre');
    } };
export const TYPES_STRAT = Object.keys(LIBELLES_TYPE_STRAT) as TypeStrat[];
export const LIBELLES_STATUT_PLAYBOOK: Record<StatutPlaybook, string> = { get brouillon() {
      return tr('strats.libelles.brouillon');
    }, get validee() {
      return tr('strats.libelles.validee');
    }, get archivee() {
      return tr('pageTeam.archivee');
    } };

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
      return tr('strats.libelles.a_cree_la_strat', { qui, titre: texte(m.titre), carte: typeof m.carte === 'string' ? ` (${m.carte})` : '' });
    case 'strat.updated':
      return tr('strats.libelles.a_enregistre_la_strat', { qui, titre: texte(m.titre), version: typeof m.revision === 'number' ? tr('strats.libelles.version_entre_parentheses', { n: m.revision }) : '' });
    case 'strat.duplicated':
      return tr('strats.libelles.a_duplique_en', { qui, v: texte(m.sourceTitre), v2: texte(m.titre) });
    case 'strat.deleted':
      return tr('strats.libelles.a_supprime_la_strat', { qui, v: texte(m.titre) });
    case 'strat.restored':
      return trSs('jr.strat_restauree', { qui, v: texte(m.titre) });
    case 'strat.share_created':
      return tr('strats.libelles.a_cree_un_lien', { qui, v: texte(m.titre) });
    case 'strat.share_revoked':
      return tr('strats.libelles.a_revoque_un_lien', { qui, v: texte(m.titre) });
    case 'playbook.created':
      return tr('strats.libelles.a_ajoute_au_playbook', { qui, v: texte(m.titre) });
    case 'playbook.updated':
      return tr('strats.libelles.a_modifie_dans_le', { qui, v: texte(m.titre) });
    case 'playbook.validated':
      return tr('strats.libelles.a_valide_dans_le', { qui, v: texte(m.titre) });
    case 'playbook.archived':
      return tr('strats.libelles.a_archive_dans_le', { qui, v: texte(m.titre) });
    case 'playbook.deleted':
      return tr('strats.libelles.a_retire_du_playbook', { qui, v: texte(m.titre) });
    case 'playbook.restored':
      return trSs('jr.entree_restauree', { qui, v: texte(m.titre) });
    default:
      return undefined;
  }
}

export function phraseNotificationStrats(type: string, team: string, c: Record<string, unknown>): string | undefined {
  if (type === 'playbook-valide') return tr('strats.libelles.playbook_valide', { team, titre: texte(c.titre), carte: typeof c.carte === 'string' ? ` (${c.carte})` : '' });
  return undefined;
}
