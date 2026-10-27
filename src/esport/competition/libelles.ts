/**
 * Libellés des modules « Tournois » et « Résultats » utilisés HORS de leurs écrans (accueil de la team,
 * Dashboard, journal, notifications) : dictionnaires principaux (fr.ts, en.ts). Les écrans des deux modules
 * ont leurs textes à part (i18n/competition.ts, chargés avec eux).
 */

import { langueCourante, tr } from '../i18n';
import type { Issue, StatutTournoi } from './api';

/** Rang : « 1er », « 2e » (« 1re » au féminin) ; « 1st », « 2nd », « 3rd », « 11th ». */
export function ordinal(n: number | null | undefined, feminin = false): string {
  if (typeof n !== 'number' || !Number.isInteger(n)) return '';
  if (langueCourante() === 'en') {
    const d = n % 10;
    const c = n % 100;
    return `${n}${c >= 11 && c <= 13 ? 'th' : d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th'}`;
  }
  return n === 1 ? (feminin ? '1re' : '1er') : `${n}e`;
}

export const nomIssue = (i: Issue): string => tr(`competition.issue.${i}` as 'competition.issue.victoire');
export const lettreForme = (l: 'V' | 'D' | 'N'): string => tr(`competition.lettre.${l}` as 'competition.lettre.V');
export const nomStatutTournoi = (s: StatutTournoi): string => tr(`competition.statut.${s}` as 'competition.statut.a_venir');
export const tonIssue = (i: Issue | null | undefined): 'ok' | 'critique' | 'neutre' => (i === 'victoire' ? 'ok' : i === 'defaite' ? 'critique' : 'neutre');

const texte = (v: unknown): string => (typeof v === 'string' ? v : '?');

/** Phrase du journal pour un événement des deux modules (ou undefined : pas le nôtre). */
export function phraseJournalCompetition(action: string, qui: string, m: Record<string, unknown>): string | undefined {
  const nom = texte(m.nom);
  const tour = typeof m.tour === 'string' && m.tour ? tr('competition.jr.tour', { tour: m.tour }) : '';
  const detail = typeof m.score === 'string' && m.score ? tr(typeof m.adversaire === 'string' && m.adversaire ? 'competition.jr.detail' : 'competition.jr.detail_seul', { score: m.score, adversaire: texte(m.adversaire) }) : '';
  switch (action) {
    case 'tournoi.cree':
      return tr('competition.jr.tournoi_cree', { qui, nom });
    case 'tournoi.modifie':
      return tr('competition.jr.tournoi_modifie', { qui, nom });
    case 'tournoi.roster_change':
      return tr('competition.jr.roster', { qui, nom });
    case 'tournoi.inscrit':
      return tr('competition.jr.inscrit', { qui, nom });
    case 'tournoi.checkin':
      return tr('competition.jr.checkin', { qui, nom });
    case 'tournoi.statut_change':
      return tr('competition.jr.statut', { qui, nom });
    case 'tournoi.termine':
      return tr('competition.jr.termine', { qui, nom });
    case 'tournoi.annule':
      return tr('competition.jr.annule', { qui, nom });
    case 'tournoi.supprime':
      return tr('competition.jr.supprime', { qui, nom });
    case 'tournoi.match_ajoute':
      return tr('competition.jr.match_ajoute', { qui, nom, tour });
    case 'tournoi.match_planifie':
      return tr('competition.jr.match_planifie', { qui, nom, tour });
    case 'tournoi.match_modifie':
      return tr('competition.jr.match_modifie', { qui, nom, tour });
    case 'tournoi.match_supprime':
      return tr('competition.jr.match_supprime', { qui, nom, tour });
    case 'match.resultat_saisi':
      return tr('competition.jr.resultat_saisi', { qui, detail });
    case 'match.resultat_modifie':
      return tr('competition.jr.resultat_modifie', { qui, detail });
    case 'match.resultat_supprime':
      return tr('competition.jr.resultat_supprime', { qui, detail });
    default:
      return undefined;
  }
}

/** Phrase d'une notification des deux modules (ou undefined). */
export function phraseNotificationCompetition(type: string, team: string, c: Record<string, unknown>): string | undefined {
  switch (type) {
    case 'tournoi-inscrit':
      return tr('competition.nt.inscrit', { team, nom: texte(c.nom) });
    case 'tournoi-termine':
      return tr('competition.nt.termine', { team, nom: texte(c.nom), place: typeof c.place === 'number' ? tr('competition.nt.place', { place: ordinal(c.place) }) : '' });
    case 'resultat-saisi': {
      const issue = c.issue === 'victoire' || c.issue === 'defaite' || c.issue === 'nul' ? nomIssue(c.issue) : typeof c.place === 'number' ? ordinal(c.place) : '?';
      return tr('competition.nt.resultat', {
        team,
        issue,
        score: typeof c.score === 'string' && c.score && c.issue ? ` ${c.score}` : '',
        adversaire: typeof c.adversaire === 'string' && c.adversaire ? tr('competition.contre', { adversaire: c.adversaire }) : '',
      });
    }
    default:
      return undefined;
  }
}
