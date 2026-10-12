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

/**
 * Texte d'un élément où chaque balise sépare les mots : sur une page minifiée,
 * « <a>Épisode 1</a><span>12/03/2025</span> » donne « Épisode 1 12/03/2025 »
 * et non « Épisode 112/03/2025 » (qui se lisait épisode 112). Sert à lire des
 * numéros ; espaces compactés.
 */
export function texteSepare(element: AnyNode): string {
  const morceaux: string[] = [];
  const parcourir = (n: AnyNode) => {
    if (n.type === 'text') {
      morceaux.push((n as unknown as { data: string }).data);
    } else if ('children' in n && Array.isArray((n as { children?: AnyNode[] }).children) && n.type !== 'script' && n.type !== 'style') {
      morceaux.push(' ');
      for (const c of (n as { children: AnyNode[] }).children) {
        parcourir(c);
      }
      morceaux.push(' ');
    }
  };
  parcourir(element);
  return morceaux.join('').replace(/\s+/g, ' ').trim();
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

/** Points de montage d'application (SPA) : vides dans le HTML brut, remplis par JavaScript. */
const MONTAGES = '#app, #root, #__next, #__nuxt, #svelte, [data-reactroot], [ng-app], app-root, [data-server-rendered]';

/**
 * Contenu construit en JavaScript (application à page unique, résultats
 * chargés en AJAX) : corps quasi vide avec des scripts, ou point de montage
 * d'application vide. Le HTML brut ne contient alors aucun résultat.
 */
export function sembleRenduEnJs(page: Page): boolean {
  const corps = page.tous('body')[0] ?? page.racine;
  const texte = texteVisible(corps);
  const scripts = page.tous('script').length;
  if (texte.length < 800 && scripts > 3) {
    return true;
  }
  const montage = page.tous(MONTAGES)[0];
  if (montage && scripts >= 1 && texteVisible(montage).length < 200 && page.dans(montage, 'a[href]').length < 3) {
    return true;
  }
  // « Activez JavaScript » sans autre contenu lisible.
  const bruit = page.tous('noscript').map(n => texteCompact(page, n)).join(' ');
  return scripts >= 1 && /javascript/i.test(bruit) && texte.length < 300 && page.dans(corps as Noeud, 'a[href]').length < 5;
}

/** Texte lisible d'un élément, sans scripts, styles, modèles ni <noscript>. */
export function texteVisible(el: AnyNode): string {
  const morceaux: string[] = [];
  const parcourir = (n: AnyNode) => {
    if (n.type === 'text') {
      morceaux.push((n as unknown as { data: string }).data);
      return;
    }
    const nom = ((n as Element).name || '').toLowerCase();
    if (['script', 'style', 'template', 'noscript'].includes(nom)) {
      return;
    }
    for (const c of ((n as Element).children ?? []) as AnyNode[]) {
      parcourir(c);
    }
  };
  parcourir(el);
  return morceaux.join(' ').replace(/\s+/g, ' ').trim();
}
