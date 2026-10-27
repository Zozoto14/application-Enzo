/**
 * Phrases des notifications (`sp-*`, dictionnaire principal : elles s'affichent partout) et du journal de la
 * rubrique Sponsors (actions `sponsors.*`, textes de la rubrique). Pur, testé.
 */

import { tr } from '../i18n';
import { trSp, type CleSp } from '../i18n/sponsors';

const texte = (v: unknown, secours = '?'): string => (typeof v === 'string' && v ? v : secours);
const jour = (v: unknown): string => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '?');

/** Phrase d'une notification de la rubrique Sponsors (ou undefined). `nom(id)` : pseudo d'un compte. */
export function phraseNotificationSponsors(type: string, c: Record<string, unknown>, nom: (id: unknown) => string): string | undefined {
  const titre = texte(c.titre);
  switch (type) {
    case 'sp-action':
      return tr('sp.nt.action', { titre, action: texte(c.action, '…') });
    case 'sp-obligation':
      return tr('sp.nt.obligation', { titre, intitule: texte(c.intitule), fait: typeof c.fait === 'number' ? c.fait : 0, quantite: typeof c.quantite === 'number' ? c.quantite : 1, fin: jour(c.fin) });
    case 'sp-contrat':
      return tr('sp.nt.contrat', { titre, fin: jour(c.fin) });
    case 'sp-responsable':
      return tr('sp.nt.responsable', { membre: nom(c.membre), titre });
    default:
      return undefined;
  }
}

const ACTIONS: Record<string, CleSp> = {
  'sponsors.etapes_modifiees': 'jr.etapes',
  'sponsors.prospect_cree': 'jr.prospect_cree',
  'sponsors.prospect_modifie': 'jr.prospect_modifie',
  'sponsors.prospect_deplace': 'jr.prospect_deplace',
  'sponsors.prospect_supprime': 'jr.prospect_supprime',
  'sponsors.prospect_converti': 'jr.prospect_converti',
  'sponsors.partenaire_cree': 'jr.partenaire_cree',
  'sponsors.partenaire_modifie': 'jr.partenaire_modifie',
  'sponsors.partenaire_supprime': 'jr.partenaire_supprime',
  'sponsors.contrat_enregistre': 'jr.contrat',
  'sponsors.contrat_supprime': 'jr.contrat_supprime',
  'sponsors.obligation_enregistree': 'jr.obligation',
  'sponsors.obligation_suivie': 'jr.obligation_suivie',
  'sponsors.obligation_supprimee': 'jr.obligation_supprimee',
  'sponsors.responsable': 'jr.responsable',
  'sponsors.import': 'jr.import',
  'sponsors.export': 'jr.export',
  'sponsors.rgpd_contact': 'jr.rgpd',
  'sponsors.rappel_action': 'jr.rappel_action',
  'sponsors.rappel_obligation': 'jr.rappel_obligation',
  'sponsors.rappel_contrat': 'jr.rappel_contrat',
};

/** Phrase d'une entrée du journal de la rubrique (ou undefined si l'action n'est pas de la rubrique). */
export function phraseJournalSponsors(action: string, qui: string, m: Record<string, unknown>): string | undefined {
  const cle = ACTIONS[action];
  if (!cle) return undefined;
  return trSp(cle, {
    qui,
    titre: texte(m.titre),
    intitule: texte(m.intitule, ''),
    crees: typeof m.crees === 'number' ? m.crees : 0,
    n: typeof m.n === 'number' ? m.n : 0,
  });
}
