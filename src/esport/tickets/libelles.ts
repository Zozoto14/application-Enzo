/**
 * Phrases des notifications personnelles des tickets (`tk-*`, dictionnaire principal : elles s'affichent dans le
 * centre de notifications et la carte des notifications). Pur, testé.
 */

import { tr } from '../i18n';

const numero = (v: unknown): string => (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v)) ? String(v) : '?');
const texte = (v: unknown): string => (typeof v === 'string' && v ? v : '?');

/** Phrase d'une notification des tickets (ou undefined si ce n'en est pas une). */
export function phraseNotificationTickets(type: string, c: Record<string, unknown>): string | undefined {
  switch (type) {
    case 'tk-nouveau':
      return tr('tk.nt.nouveau', { numero: numero(c.numero), categorie: texte(c.nom) });
    case 'tk-assigne':
      return tr('tk.nt.assigne', { numero: numero(c.numero) });
    case 'tk-message':
      return tr('tk.nt.message', { numero: numero(c.numero) });
    case 'tk-note':
      return tr('tk.nt.note', { numero: numero(c.numero), note: numero(c.note) });
    case 'tk-ferme':
      return tr('tk.nt.ferme', { numero: numero(c.numero) });
    default:
      return undefined;
  }
}
