/**
 * Export du journal : Markdown, document imprimable (PDF par impression),
 * mode valeurs masquées.
 */

import { agreger } from './agregation';
import { documentImprimable, exporterMarkdown, imprimerDocument, nomFichierExport, pageEnMarkdown, recapEnMarkdown } from './export';
import type { PageJournal } from './modele';
import { composerRecap } from './recap';
import { rediger } from './redaction';
import { journeeRemplie } from './__fixtures__/outils';
import { masquerMontants, definirDiscretion } from '../ui/discretion';

const page = (jour: string, extra: Partial<PageJournal> = {}): PageJournal => {
  const r = agreger(jour, journeeRemplie(jour));
  return { v: 1, jour, auto: rediger(r), compteurs: r.compteurs, nbEvenements: r.evenements.length, ecritLe: `${jour}T21:00:00.000Z`, ...extra };
};

describe('export Markdown', () => {
  const p = page('2026-10-13', { note: 'Une très bonne journée.', humeur: 5, epingle: true });

  it('met en forme la page : titre, humeur, sections, chiffres, note', () => {
    const md = pageEnMarkdown(p);
    expect(md.startsWith('# Mardi 13 octobre 2026')).toBe(true);
    expect(md).toContain('Humeur : Excellente');
    expect(md).toContain('Journée épinglée');
    expect(md).toContain('## Les tâches');
    expect(md).toContain('## Chiffres clés');
    expect(md).toContain('- Tâches terminées : 3');
    expect(md).toContain('## Ma note\n\nUne très bonne journée.');
    expect(md).toContain('> **Fait marquant**');
  });

  it('plusieurs pages, dans l’ordre, séparées ; le récapitulatif en tête', () => {
    const pages = [page('2026-10-14'), page('2026-10-13')];
    const recap = composerRecap('semaine', '2026-10-13', pages, '2026-10-18');
    const md = exporterMarkdown(pages, recap);
    expect(md.indexOf('# Récap de la semaine')).toBe(0);
    expect(md.indexOf('# Mardi 13 octobre')).toBeLessThan(md.indexOf('# Mercredi 14 octobre'));
    expect(md.split('\n---\n').length).toBe(3);
    expect(recapEnMarkdown(recap)).toContain('## Chiffres clés');
  });

  it('mode valeurs masquées : aucun montant en euros ne sort, les pourcentages restent', () => {
    definirDiscretion(true);
    try {
      const md = exporterMarkdown([p], undefined, { masquer: masquerMontants });
      expect(md).not.toMatch(/1 234,50|310,20|45 €/);
      expect(md).toContain('••••');
      expect(md).toContain('+1,25 %');
    } finally {
      definirDiscretion(false);
    }
    expect(exporterMarkdown([p])).toContain('1 234,50');
  });

  it('nom de fichier', () => {
    expect(nomFichierExport('2026-10-13', '2026-10-13')).toBe('journal-2026-10-13.md');
    expect(nomFichierExport('2026-10-01', '2026-10-31')).toBe('journal-2026-10-01_2026-10-31.md');
    expect(nomFichierExport('2026-10-13', '2026-10-13', 'html')).toBe('journal-2026-10-13.html');
  });
});

describe('document imprimable (PDF)', () => {
  it('produit un document HTML complet, échappé, avec un saut de page par journée', () => {
    const p = page('2026-10-13', { note: '<script>alert(1)</script> & "guillemets"' });
    const html = documentImprimable('Mon journal', [p, page('2026-10-14')]);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>Mon journal</title>');
    expect(html).toContain('page-break-after');
    expect(html.match(/<section class="page">/g)).toHaveLength(2);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;guillemets&quot;');
  });

  it('applique le masquage aussi à l’impression', () => {
    const html = documentImprimable('x', [page('2026-10-13')], undefined, { masquer: t => t.replace(/\d[\d\s  ,]*\s?€/g, '••••') });
    expect(html).not.toContain('1 234,50');
    expect(html).toContain('••••');
  });

  it('imprimerDocument ouvre une iframe cachée et lance l’impression ; renvoie faux sans DOM', () => {
    const g = globalThis as { document?: unknown };
    const avant = g.document;
    try {
      g.document = undefined;
      expect(imprimerDocument('<p>x</p>')).toBe(false);
      const ajoutes: unknown[] = [];
      const print = jest.fn();
      const cadre: { srcdoc?: string; onload?: () => void; style: { cssText: string }; setAttribute: jest.Mock; remove: jest.Mock; contentWindow: { focus: jest.Mock; print: jest.Mock } } = {
        style: { cssText: '' },
        setAttribute: jest.fn(),
        remove: jest.fn(),
        contentWindow: { focus: jest.fn(), print },
      };
      g.document = { body: { appendChild: (c: unknown) => ajoutes.push(c) }, createElement: () => cadre };
      jest.useFakeTimers();
      expect(imprimerDocument('<p>x</p>')).toBe(true);
      expect(ajoutes).toHaveLength(1);
      expect(cadre.srcdoc).toBe('<p>x</p>');
      cadre.onload?.();
      expect(print).toHaveBeenCalledTimes(1);
      jest.runOnlyPendingTimers();
      expect(cadre.remove).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
      g.document = avant;
    }
  });
});
