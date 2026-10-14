/**
 * Raccourcis clavier des onglets d'apps (pur, testé) :
 *
 *  - Ctrl+Tab / Ctrl+Maj+Tab : onglet suivant / précédent ;
 *  - Ctrl+W : fermer l'onglet affiché ;
 *  - Ctrl+1…8 : l'onglet de ce rang, Ctrl+9 : le dernier.
 *
 * Jamais pendant la saisie (champ, zone de texte, contenu modifiable). Sur un
 * Mac, ⌘ remplace Ctrl. Dans un navigateur ordinaire, certaines de ces
 * combinaisons sont gardées par le navigateur lui-même (ses propres onglets) :
 * l'app de bureau, elle, les reçoit toutes.
 */

export type ActionOnglet = { genre: 'voisin'; sens: 1 | -1 } | { genre: 'fermer' } | { genre: 'rang'; rang: number };

export interface ToucheOnglet {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  target?: unknown;
}

/** Vrai quand la cible du clavier est un champ de saisie. */
export function enSaisie(cible: unknown): boolean {
  const element = cible as { tagName?: string; isContentEditable?: boolean; getAttribute?(n: string): string | null } | null | undefined;
  if (!element) return false;
  const balise = element.tagName?.toLowerCase();
  if (balise === 'input' || balise === 'textarea' || balise === 'select') return true;
  if (element.isContentEditable) return true;
  return element.getAttribute?.('role') === 'textbox';
}

export function actionOnglet(e: ToucheOnglet): ActionOnglet | undefined {
  const commande = Boolean(e.ctrlKey || e.metaKey);
  if (!commande || e.altKey || enSaisie(e.target)) {
    return undefined;
  }
  if (e.key === 'Tab') {
    return { genre: 'voisin', sens: e.shiftKey ? -1 : 1 };
  }
  if (e.shiftKey) {
    return undefined;
  }
  if (e.key === 'w' || e.key === 'W') {
    return { genre: 'fermer' };
  }
  // Le chiffre de la rangée du haut ou du pavé numérique (`code` : indépendant de la disposition du clavier).
  const chiffre = /^(?:Digit|Numpad)([1-9])$/.exec(e.code ?? '')?.[1] ?? (/^[1-9]$/.test(e.key) ? e.key : undefined);
  if (chiffre) {
    return { genre: 'rang', rang: Number(chiffre) };
  }
  return undefined;
}
