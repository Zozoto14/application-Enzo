/**
 * Récapitulatifs hebdomadaire et mensuel, générés à partir des pages.
 */

import { COMPTEURS, agreger } from './agregation';
import type { PageJournal } from './modele';
import { bornesRecap, composerRecap } from './recap';
import { rediger } from './redaction';
import { journeeRemplie } from './__fixtures__/outils';

const page = (jour: string, extra: Partial<PageJournal> = {}, evenements = journeeRemplie(jour)): PageJournal => {
  const r = agreger(jour, evenements);
  return { v: 1, jour, auto: rediger(r), compteurs: r.compteurs, nbEvenements: r.evenements.length, ecritLe: `${jour}T21:00:00.000Z`, ...extra };
};

describe('récapitulatif de la semaine', () => {
  const pages = [page('2026-10-12', { humeur: 4 }), page('2026-10-13', { humeur: 2, epingle: true }, journeeRemplie('2026-10-13').slice(0, 5)), page('2026-10-14'), page('2026-10-19')];

  it('couvre du lundi au dimanche', () => {
    expect(bornesRecap('semaine', '2026-10-15')).toEqual({ du: '2026-10-12', au: '2026-10-18' });
    expect(bornesRecap('mois', '2026-10-15')).toEqual({ du: '2026-10-01', au: '2026-10-31' });
  });

  it('additionne les compteurs des seules pages de la semaine', () => {
    const r = composerRecap('semaine', '2026-10-15', pages, '2026-10-18');
    expect(r.pages).toBe(3);
    expect(r.jours).toBe(7);
    expect(r.totaux[COMPTEURS.tachesTerminees]).toBe(9);
    expect(r.totaux[COMPTEURS.episodes]).toBe(6);
    expect(r.totaux[COMPTEURS.sessions]).toBe(3);
  });

  it('écrit un texte avec titre, intro, sections et chiffres clés', () => {
    const r = composerRecap('semaine', '2026-10-15', pages, '2026-10-18');
    expect(r.titre).toBe('Récap de la semaine du 12 au 18 octobre 2026');
    expect(r.intro).toMatch(/3 pages/);
    expect(r.sections.map(s => s.id)).toEqual(expect.arrayContaining(['taches', 'office', 'tsuzuku', 'portefeuille', 'affaires', 'humeur', 'epingles']));
    const c = Object.fromEntries(r.chiffres.map(x => [x.id, x.valeur]));
    expect(c.pages).toBe('3/7');
    expect(c['taches-finies']).toBe('9');
  });

  it('humeur moyenne, jour le plus chargé, journées épinglées, faits marquants', () => {
    const r = composerRecap('semaine', '2026-10-15', pages, '2026-10-18');
    expect(r.humeur).toMatchObject({ moyenne: 3, arrondie: 3, pages: 2 });
    expect(r.jourFort).toEqual({ jour: '2026-10-12', evenements: 14 });
    expect(r.marquants.length).toBeGreaterThanOrEqual(1);
    expect(r.marquants.every(m => m.jour >= '2026-10-12' && m.jour <= '2026-10-18')).toBe(true);
    expect(r.sections.find(s => s.id === 'epingles')?.paragraphes.join(' ')).toContain('13 oct.');
  });

  it('compose la variation du portefeuille séance après séance', () => {
    const r = composerRecap('semaine', '2026-10-15', [page('2026-10-12'), page('2026-10-13')], '2026-10-18');
    // 1,25 % puis 1,25 % : (1,0125)² − 1 ≈ 2,52 %.
    expect(r.totaux[COMPTEURS.variation]).toBeCloseTo(2.52, 2);
  });

  it('une semaine sans page : texte honnête, pas de chiffre inventé', () => {
    const r = composerRecap('semaine', '2026-10-29', pages, '2026-10-30');
    expect(r.pages).toBe(0);
    expect(r.intro).toMatch(/Aucune page|Rien/);
    expect(r.sections).toEqual([]);
  });

  it('une page vide (simple note) ne compte pas', () => {
    const vide = page('2026-10-14');
    vide.auto = { ...vide.auto, moteur: 'vide' };
    expect(composerRecap('semaine', '2026-10-15', [vide], '2026-10-18').pages).toBe(0);
  });
});

describe('récapitulatif du mois', () => {
  it('couvre le mois entier et compte les jours écoulés', () => {
    const pages = ['2026-10-01', '2026-10-02', '2026-10-20'].map(j => page(j));
    const r = composerRecap('mois', '2026-10-20', pages, '2026-10-20');
    expect(r.titre).toBe('Récap de octobre 2026');
    expect(r.jours).toBe(20);
    expect(r.pages).toBe(3);
    expect(r.intro).toContain('ce mois-ci');
    expect(r.marquants.length).toBeLessThanOrEqual(5);
    expect(r.totaux[COMPTEURS.operations]).toBe(3);
  });

  it('cite des montants avec la même mise en forme que les pages', () => {
    const r = composerRecap('mois', '2026-10-20', [page('2026-10-01'), page('2026-10-02')], '2026-10-20');
    expect(r.sections.find(s => s.id === 'affaires')?.paragraphes.join(' ')).toContain('90 €');
  });
});
