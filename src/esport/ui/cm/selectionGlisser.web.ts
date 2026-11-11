/**
 * Glisser-déposer des tableaux CM sur le web : pendant un geste (carte, colonne), aucune sélection de texte.
 *
 * Les poignées et les en-têtes sont gérés par PanResponder (pas par le glisser-déposer HTML5) : sans précaution, le
 * navigateur traite le mouvement de la souris comme une sélection et surligne en bleu les titres de cartes, les puces,
 * les en-têtes de colonnes, « + Ajouter une carte »… `bloquerSelection` pose un attribut sur <html> (une feuille de
 * style le traduit en `user-select: none` sur toute la page), vide la sélection existante et refuse les `selectstart` ;
 * `libererSelection` (fin du geste, ou relâchement du pointeur, ou perte du focus) remet tout en place. Les champs de
 * saisie et les éditeurs (fiche de carte, formulaires) restent sélectionnables, même pendant un geste.
 * Version web ; selectionGlisser.ts (sans effet) sert iOS / Android.
 */

const ATTRIBUT = 'data-cm-glisse';
const ID_STYLE = 'cm-glisser-style';
const CHAMPS = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]';

const CSS = `
html[${ATTRIBUT}], html[${ATTRIBUT}] body, html[${ATTRIBUT}] body * { -webkit-user-select: none !important; user-select: none !important; -webkit-touch-callout: none !important; }
html[${ATTRIBUT}] input, html[${ATTRIBUT}] textarea, html[${ATTRIBUT}] select, html[${ATTRIBUT}] [contenteditable] { -webkit-user-select: text !important; user-select: text !important; }
`;

let actif = false;

const refuserSelection = (e: Event) => {
  const cible = e.target as Element | null;
  if (cible?.closest?.(CHAMPS)) return;
  e.preventDefault();
};
const relacher = () => libererSelection();

const dom = (): Document | null => (typeof document !== 'undefined' ? document : null);

/** Début d'un geste : plus de sélection de texte, celle qui existe est effacée. */
export function bloquerSelection(): void {
  const d = dom();
  if (!d) return;
  try {
    if (!d.getElementById(ID_STYLE)) {
      const s = d.createElement('style');
      s.id = ID_STYLE;
      s.textContent = CSS;
      d.head.appendChild(s);
    }
    d.documentElement.setAttribute(ATTRIBUT, '');
    d.getSelection?.()?.removeAllRanges();
    if (!actif) {
      actif = true;
      d.addEventListener('selectstart', refuserSelection, true);
      // Filet de sécurité : le relâchement du pointeur ou la perte du focus rendent toujours la sélection.
      window.addEventListener('pointerup', relacher, true);
      window.addEventListener('pointercancel', relacher, true);
      window.addEventListener('mouseup', relacher, true);
      window.addEventListener('touchend', relacher, true);
      window.addEventListener('blur', relacher);
    }
  } catch {
    // Pas de DOM utilisable : rien à bloquer.
  }
}

/** Fin du geste : la sélection de texte est de nouveau permise. */
export function libererSelection(): void {
  const d = dom();
  if (!d || !actif) return;
  try {
    actif = false;
    d.documentElement.removeAttribute(ATTRIBUT);
    d.removeEventListener('selectstart', refuserSelection, true);
    window.removeEventListener('pointerup', relacher, true);
    window.removeEventListener('pointercancel', relacher, true);
    window.removeEventListener('mouseup', relacher, true);
    window.removeEventListener('touchend', relacher, true);
    window.removeEventListener('blur', relacher);
    d.getSelection?.()?.removeAllRanges();
  } catch {
    // Rien à remettre.
  }
}

/** Style web des zones qui se saisissent : pas de sélection, pas de menu de maintien (iPad / iPhone), pas de surbrillance au toucher. */
export const STYLE_SAISISSABLE: Record<string, string> = { userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none', WebkitTapHighlightColor: 'transparent' };
