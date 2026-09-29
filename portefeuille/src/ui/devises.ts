/**
 * Montants en devise étrangère affichés en euros : l'équivalent au taux du
 * jour en principal, la devise d'origine à côté. Respecte le mode discret.
 */

import type { Convertisseur } from '../cours/change';
import { normaliserDevise } from '../cours/change';
import { discretionActive } from './discretion';

const MASQUE = '•••';

const format = (valeur: number, decimales = 2) =>
  valeur.toLocaleString('fr-FR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });

/**
 * « 200,35 € » et « 865,00 PLN » : le montant principal en euros quand on
 * sait le convertir, la devise d'origine à part.
 */
export function libellesEnEuros(
  montant: number | null | undefined,
  devise: string | undefined,
  enEuros: Convertisseur['enEuros'],
  decimales = 2,
): { principal: string; origine?: string } {
  if (montant === null || montant === undefined) return { principal: '—' };
  if (discretionActive()) return { principal: `${MASQUE} €` };
  if (!devise || normaliserDevise(devise).devise === 'EUR') return { principal: `${format(montant, decimales)} €` };
  const euros = enEuros(montant, devise);
  const origine = `${format(montant, decimales)} ${devise}`;
  return euros === undefined ? { principal: origine } : { principal: `${format(euros, decimales)} €`, origine };
}
