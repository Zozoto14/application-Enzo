/**
 * Impression PDF des notes de review (pure, testée) : l'export Markdown du
 * serveur devient un document HTML dont chaque texte est ÉCHAPPÉ (aucune
 * balise de l'utilisateur ne survit). L'écran web l'imprime (Ctrl+P, « Enregistrer
 * au format PDF ») ; voir ui/review/impression.web.ts.
 */

import { echapperHtml, versHtml } from './markdown';

export const STYLE_IMPRESSION = `
#impression-esport { font: 12pt/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #111; background: #fff; padding: 0; }
#impression-esport h1 { font-size: 20pt; margin: 0 0 8pt; }
#impression-esport h2 { font-size: 15pt; margin: 14pt 0 4pt; }
#impression-esport h3 { font-size: 12.5pt; margin: 14pt 0 3pt; border-bottom: 1px solid #bbb; padding-bottom: 2pt; break-after: avoid; }
#impression-esport p, #impression-esport li { margin: 2pt 0; }
#impression-esport ul, #impression-esport ol { margin: 2pt 0 6pt; padding-left: 18pt; }
#impression-esport a { color: #1a4fc4; word-break: break-all; }
#impression-esport code { font-family: ui-monospace, Menlo, Consolas, monospace; background: #f1f1f1; padding: 0 2pt; }
#impression-esport h3, #impression-esport p, #impression-esport li { break-inside: avoid; }
@media screen { #impression-esport { display: none; } }
@media print {
  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
  body > *:not(#impression-esport):not(style) { display: none !important; }
  #impression-esport { display: block; }
  @page { margin: 16mm; }
}`;

/** HTML (fragment) du document imprimé. */
export function documentImpression(titre: string, markdown: string): string {
  return `<article aria-label="${echapperHtml(titre)}">${versHtml(markdown)}</article>`;
}
