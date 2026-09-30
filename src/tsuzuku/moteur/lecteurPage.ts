/**
 * Lecture d'une page HTML par selecteurs CSS, en JavaScript pur.
 *
 * htmlparser2 (analyse tolerante, comme celle de cheerio) + css-select
 * (selecteurs CSS 3 et la plupart de CSS 4) : aucune dependance a Node ni au
 * DOM, compatibles Metro, Vite et Jest.
 */

import { selectAll, selectOne } from 'css-select';
import type { AnyNode, Document, Element } from 'domhandler';
import { getAttributeValue, textContent } from 'domutils';
import { parseDocument } from 'htmlparser2';
import { echec } from './erreurs';

export type Noeud = Element;

export interface Page {
  readonly racine: Document;
  /** Tous les elements de la page correspondant au selecteur. */
  tous(selecteur: string): Noeud[];
  /** Descendants de `element` correspondant au selecteur. */
  dans(element: Noeud, selecteur: string): Noeud[];
  /** Premier descendant (ou « & » : l'element lui-meme). */
  premier(element: Noeud, selecteur: string): Noeud | null;
  texte(element: AnyNode | AnyNode[]): string;
  attr(element: Noeud, nom: string): string | null;
}

function selectionner(selecteur: string, contexte: AnyNode | AnyNode[]): Element[] {
  try {
    return selectAll(selecteur, contexte);
  } catch {
    throw echec(`Selecteur CSS invalide : « ${selecteur} »`, 'selecteur');
  }
}

export function lirePage(html: string): Page {
  const racine = parseDocument(String(html ?? ''), { decodeEntities: true });
  return {
    racine,
    tous: s => selectionner(s, racine),
    dans: (el, s) => selectionner(s, el),
    premier: (el, s) => {
      if (s === '&') {
        return el;
      }
      try {
        return selectOne(s, el);
      } catch {
        throw echec(`Selecteur CSS invalide : « ${s} »`, 'selecteur');
      }
    },
    texte: el => textContent(el),
    attr: (el, nom) => getAttributeValue(el, nom) ?? null,
  };
}

/**
 * Valeur d'un sous-element : son texte (sans `attr`) ou son attribut.
 * `selecteur` vide : null ; « & » : l'element lui-meme.
 */
export function choisir(page: Page, element: Noeud, selecteur: string | undefined, attr?: string): string | null {
  if (!selecteur) {
    return null;
  }
  const cible = page.premier(element, selecteur);
  if (!cible) {
    return null;
  }
  if (attr) {
    return page.attr(cible, attr) || null;
  }
  return page.texte(cible).trim() || null;
}

/** Texte d'un element, espaces compactes. */
export function texteCompact(page: Page, element: AnyNode): string {
  return page.texte(element).replace(/\s+/g, ' ').trim();
}

/**
 * Selecteurs plausibles quand celui configure ne trouve rien : les classes
 * qui se repetent designent naturellement « un resultat » ou « un episode ».
 */
export function suggererSelecteurs(page: Page): string[] {
  const compte = new Map<string, number>();
  for (const el of page.tous('[class]')) {
    const balise = el.name.toLowerCase();
    if (['html', 'body', 'script', 'style'].includes(balise)) {
      continue;
    }
    for (const cls of (page.attr(el, 'class') || '').split(/\s+/).filter(Boolean)) {
      if (cls.length > 40) {
        continue;
      }
      const cle = `${balise}.${cls}`;
      compte.set(cle, (compte.get(cle) || 0) + 1);
    }
  }
  return [...compte.entries()]
    .filter(([, n]) => n >= 3 && n <= 300)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([s, n]) => `${s} (${n}x)`);
}

/** Corps quasi vide mais beaucoup de scripts : contenu construit en JavaScript. */
export function sembleRenduEnJs(page: Page): boolean {
  const corps = page.tous('body');
  const texte = corps.length ? texteCompact(page, corps[0]) : '';
  return texte.length < 800 && page.tous('script').length > 3;
}
