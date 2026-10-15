/**
 * Export du journal : Markdown (fichier) et document imprimable (PDF par la
 * fenêtre d'impression du système). `masquer` est appliqué à chaque texte :
 * en mode valeurs masquées, les montants ne sortent pas du journal.
 */

import { jourLongMaj } from './dates';
import { emojiHumeur, libelleHumeur, type PageJournal } from './modele';
import type { Recap } from './recap';

export type Masqueur = (texte: string) => string;
const identite: Masqueur = t => t;

export interface OptionsExport {
  masquer?: Masqueur;
}

export function pageEnMarkdown(p: PageJournal, o: OptionsExport = {}): string {
  const m = o.masquer ?? identite;
  const l: string[] = [`# ${jourLongMaj(p.jour)}`];
  const meta = [p.auto.accroche, p.humeur ? `Humeur : ${emojiHumeur(p.humeur)} ${libelleHumeur(p.humeur)}` : '', p.epingle ? 'Journée épinglée' : ''].filter(Boolean);
  if (meta.length) l.push('', `*${meta.join(' · ')}*`);
  if (p.auto.intro) l.push('', m(p.auto.intro));
  if (p.auto.marquant) l.push('', `> **Fait marquant** : ${m(p.auto.marquant.texte)}`);
  for (const s of p.auto.sections) {
    l.push('', `## ${s.titre}`);
    for (const para of s.paragraphes) l.push('', m(para));
  }
  if (p.auto.chiffres.length) {
    l.push('', '## Chiffres clés', '');
    for (const c of p.auto.chiffres) l.push(`- ${c.libelle} : ${m(c.valeur)}`);
  }
  if (p.note) l.push('', '## Ma note', '', m(p.note));
  if (p.auto.cloture) l.push('', `*${m(p.auto.cloture)}*`);
  return l.join('\n');
}

export function recapEnMarkdown(r: Recap, o: OptionsExport = {}): string {
  const m = o.masquer ?? identite;
  const l: string[] = [`# ${r.titre.charAt(0).toUpperCase()}${r.titre.slice(1)}`, '', m(r.intro)];
  for (const s of r.sections) {
    l.push('', `## ${s.titre}`);
    for (const p of s.paragraphes) l.push('', m(p));
  }
  if (r.chiffres.length) {
    l.push('', '## Chiffres clés', '');
    for (const c of r.chiffres) l.push(`- ${c.libelle} : ${m(c.valeur)}`);
  }
  if (r.marquants.length) {
    l.push('', '## Faits marquants', '');
    for (const f of r.marquants) l.push(`- ${jourLongMaj(f.jour, false)} : ${m(f.texte)}`);
  }
  return l.join('\n');
}

/** Plusieurs pages (et un récapitulatif facultatif) dans un seul fichier. */
export function exporterMarkdown(pages: readonly PageJournal[], recap?: Recap, o: OptionsExport = {}): string {
  const parties = [...(recap ? [recapEnMarkdown(recap, o)] : []), ...[...pages].sort((a, b) => (a.jour < b.jour ? -1 : 1)).map(p => pageEnMarkdown(p, o))];
  return `${parties.join('\n\n---\n\n')}\n`;
}

export function nomFichierExport(du: string, au: string, extension: 'md' | 'html' = 'md'): string {
  return du === au ? `journal-${du}.${extension}` : `journal-${du}_${au}.${extension}`;
}

const echapper = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const paragraphes = (t: string) => `<p>${echapper(t).replace(/\n/g, '<br>')}</p>`;

const STYLE_IMPRESSION = `
body{font:12pt/1.55 Georgia,"Times New Roman",serif;color:#111;max-width:42em;margin:2em auto;padding:0 1em}
h1{font-size:20pt;margin:0 0 .2em}h2{font-size:13pt;margin:1.2em 0 .3em;border-bottom:1px solid #bbb}
.meta{color:#555;font-style:italic;margin:0 0 1em}.marquant{border-left:4px solid #888;padding:.2em 1em;background:#f4f4f4}
.note{background:#fbf7e6;padding:.4em 1em;border:1px solid #e3d9a8}ul{padding-left:1.2em}
section.page{page-break-after:always}section.page:last-child{page-break-after:auto}
@page{margin:18mm}`;

function pageEnHtml(p: PageJournal, m: Masqueur): string {
  const meta = [p.auto.accroche, p.humeur ? `Humeur : ${emojiHumeur(p.humeur)} ${libelleHumeur(p.humeur)}` : '', p.epingle ? 'Journée épinglée' : ''].filter(Boolean);
  return [
    '<section class="page">',
    `<h1>${echapper(jourLongMaj(p.jour))}</h1>`,
    meta.length ? `<p class="meta">${echapper(meta.join(' · '))}</p>` : '',
    p.auto.intro ? paragraphes(m(p.auto.intro)) : '',
    p.auto.marquant ? `<p class="marquant"><strong>Fait marquant</strong> : ${echapper(m(p.auto.marquant.texte))}</p>` : '',
    ...p.auto.sections.map(s => `<h2>${echapper(s.titre)}</h2>${s.paragraphes.map(x => paragraphes(m(x))).join('')}`),
    p.auto.chiffres.length ? `<h2>Chiffres clés</h2><ul>${p.auto.chiffres.map(c => `<li>${echapper(c.libelle)} : ${echapper(m(c.valeur))}</li>`).join('')}</ul>` : '',
    p.note ? `<h2>Ma note</h2><div class="note">${paragraphes(m(p.note))}</div>` : '',
    p.auto.cloture ? `<p class="meta">${echapper(m(p.auto.cloture))}</p>` : '',
    '</section>',
  ].join('');
}

function recapEnHtml(r: Recap, m: Masqueur): string {
  return [
    '<section class="page">',
    `<h1>${echapper(r.titre.charAt(0).toUpperCase() + r.titre.slice(1))}</h1>`,
    paragraphes(m(r.intro)),
    ...r.sections.map(s => `<h2>${echapper(s.titre)}</h2>${s.paragraphes.map(x => paragraphes(m(x))).join('')}`),
    r.chiffres.length ? `<h2>Chiffres clés</h2><ul>${r.chiffres.map(c => `<li>${echapper(c.libelle)} : ${echapper(m(c.valeur))}</li>`).join('')}</ul>` : '',
    r.marquants.length ? `<h2>Faits marquants</h2><ul>${r.marquants.map(f => `<li>${echapper(jourLongMaj(f.jour, false))} : ${echapper(m(f.texte))}</li>`).join('')}</ul>` : '',
    '</section>',
  ].join('');
}

/** Document HTML complet, prêt pour la fenêtre d'impression (« Enregistrer en PDF »). */
export function documentImprimable(titre: string, pages: readonly PageJournal[], recap?: Recap, o: OptionsExport = {}): string {
  const m = o.masquer ?? identite;
  const corps = [...(recap ? [recapEnHtml(recap, m)] : []), ...[...pages].sort((a, b) => (a.jour < b.jour ? -1 : 1)).map(p => pageEnHtml(p, m))].join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${echapper(titre)}</title><style>${STYLE_IMPRESSION}</style></head><body>${corps}</body></html>`;
}

/** Ce qu'on utilise du DOM (le projet n'embarque pas les types du navigateur). */
interface CadreMinimal {
  setAttribute(nom: string, valeur: string): void;
  style: { cssText: string };
  srcdoc: string;
  onload: (() => void) | null;
  contentWindow?: { focus(): void; print(): void } | null;
  remove(): void;
}
interface DocumentMinimal {
  body?: { appendChild(c: unknown): unknown } | null;
  createElement(balise: string): CadreMinimal;
}

/**
 * Ouvre la fenêtre d'impression du système sur ce document, dans une iframe
 * cachée (web et PC). `false` : impossible ici (téléphone natif, pas de DOM).
 */
export function imprimerDocument(html: string): boolean {
  const doc = (globalThis as { document?: DocumentMinimal }).document;
  if (!doc?.body || typeof doc.createElement !== 'function') return false;
  try {
    const cadre = doc.createElement('iframe');
    cadre.setAttribute('data-testid', 'journal-cadre-impression');
    cadre.setAttribute('aria-hidden', 'true');
    cadre.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    cadre.srcdoc = html;
    cadre.onload = () => {
      try {
        cadre.contentWindow?.focus();
        cadre.contentWindow?.print();
      } finally {
        setTimeout(() => cadre.remove(), 60_000);
      }
    };
    doc.body.appendChild(cadre);
    return true;
  } catch {
    return false;
  }
}
