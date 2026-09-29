/**
 * Mode discret : les montants en euros sont masqués, les pourcentages
 * restent. Pratique quand quelqu'un regarde l'écran par-dessus l'épaule.
 *
 * Un simple drapeau de module : les vues sont recalculées à chaque rendu,
 * et `formaterMontant` le consulte. Les graphiques passent leurs textes par
 * `masquerMontants`.
 */

let actif = false;

export const MONTANT_MASQUE = '••••';

export function definirDiscretion(valeur: boolean): void {
  actif = valeur;
}

export function discretionActive(): boolean {
  return actif;
}

/** Montant en euros d'un texte libre : « 1 234,56 € », « -3,1 k€ », « 12 € ». */
const MONTANT = /[-+−]?\d[\d\s  .,]*\s?(?:k|M|Md)?\s?€/g;

export function masquerMontants(texte: string): string {
  return actif ? texte.replace(MONTANT, `${MONTANT_MASQUE} €`) : texte;
}

/** Enrobe une fonction de mise en forme d'axe ou d'infobulle. */
export function formateurDiscret<T>(formater: (valeur: T) => string): (valeur: T) => string {
  return valeur => masquerMontants(formater(valeur));
}
