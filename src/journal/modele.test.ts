/**
 * Stockage du journal : une clé par mois, revalidation à la lecture, note,
 * humeur, épingle, résumé, aucune écriture hors des clés `journal.*`.
 */

import { CLES_JOURNAL, ecrirePage, ecrireReglages, lireIndex, lireMois, lirePage, lireReglages, lireResume, modifierPage, pageVide, pagesEntre, reglagesParDefaut, toutesLesPages, type PageJournal } from './modele';
import { agreger } from './agregation';
import { rediger } from './redaction';
import { JOUR, baseMemoire, journeeRemplie } from './__fixtures__/outils';

const page = (jour: string, extra: Partial<PageJournal> = {}): PageJournal => ({
  v: 1,
  jour,
  auto: rediger(agreger(jour, journeeRemplie(jour))),
  compteurs: { taches_terminees: 3 },
  nbEvenements: 13,
  ecritLe: '2026-10-13T19:00:00.000Z',
  ...extra,
});

describe('stockage du journal', () => {
  it('range les pages d’un mois dans UNE clé et tient l’index des mois', () => {
    const b = baseMemoire();
    ecrirePage(b, page('2026-10-12'));
    ecrirePage(b, page('2026-10-13'));
    ecrirePage(b, page('2026-11-02'));
    expect([...b.m.keys()].filter(k => k.startsWith('journal.mois.')).sort()).toEqual(['journal.mois.2026-10', 'journal.mois.2026-11']);
    expect(lireIndex(b)).toEqual(['2026-10', '2026-11']);
    expect(Object.keys(lireMois(b, '2026-10'))).toEqual(['2026-10-12', '2026-10-13']);
    expect(toutesLesPages(b).map(p => p.jour)).toEqual(['2026-10-12', '2026-10-13', '2026-11-02']);
    expect(pagesEntre(b, '2026-10-13', '2026-11-01').map(p => p.jour)).toEqual(['2026-10-13']);
  });

  it('n’écrit que dans des clés « journal.* » (rien qui parte sur le relais ni dans une autre app)', () => {
    const b = baseMemoire();
    ecrirePage(b, page(JOUR));
    ecrireReglages(b, reglagesParDefaut(JOUR));
    modifierPage(b, JOUR, { note: 'Belle journée', humeur: 4, epingle: true }, Date.parse('2026-10-13T20:00:00Z'));
    expect(b.ecritures.every(c => c.startsWith('journal.'))).toBe(true);
  });

  it('une page écrite = au plus 3 écritures locales (mois, index la première fois, résumé) : jamais une par événement', () => {
    const b = baseMemoire();
    ecrirePage(b, page(JOUR));
    expect(b.ecritures).toHaveLength(3);
    ecrirePage(b, page('2026-10-14'));
    expect(b.ecritures).toHaveLength(5);
  });

  it('note, humeur, épingle : enregistrées, retirables, horodatées', () => {
    const b = baseMemoire();
    ecrirePage(b, page(JOUR));
    const t = Date.parse('2026-10-13T21:30:00Z');
    expect(modifierPage(b, JOUR, { note: 'Une note', humeur: 5, epingle: true }, t)).toMatchObject({ note: 'Une note', humeur: 5, epingle: true, modifieLe: '2026-10-13T21:30:00.000Z' });
    expect(lirePage(b, JOUR)).toMatchObject({ note: 'Une note', humeur: 5, epingle: true });
    modifierPage(b, JOUR, { note: '   ', humeur: null, epingle: false }, t);
    const p = lirePage(b, JOUR)!;
    expect(p.note).toBeUndefined();
    expect(p.humeur).toBeUndefined();
    expect(p.epingle).toBeUndefined();
  });

  it('une note ajoutée avant l’écriture automatique crée une page vide, qui ne compte pas comme page écrite', () => {
    const b = baseMemoire();
    modifierPage(b, JOUR, { note: 'Écrit à la main', humeur: 3 }, 0);
    const p = lirePage(b, JOUR)!;
    expect(p.auto.moteur).toBe('vide');
    expect(p).toMatchObject({ note: 'Écrit à la main', humeur: 3 });
    expect(lireResume(b)).toEqual({ pages: 0, epinglees: 0 });
    expect(pageVide(JOUR, 0).auto.sections).toEqual([]);
  });

  it('résumé : pages et journées épinglées, tenu à jour', () => {
    const b = baseMemoire();
    ecrirePage(b, page('2026-10-12'));
    ecrirePage(b, page('2026-10-13', { epingle: true }));
    expect(lireResume(b)).toEqual({ pages: 2, epinglees: 1 });
    modifierPage(b, '2026-10-12', { epingle: true }, 0);
    modifierPage(b, '2026-10-13', { epingle: false }, 0);
    expect(lireResume(b)).toEqual({ pages: 2, epinglees: 1 });
    // Résumé absent : recalculé à partir des mois.
    b.m.delete(CLES_JOURNAL.resume);
    expect(lireResume(b)).toEqual({ pages: 2, epinglees: 1 });
  });

  it('revalide tout à la lecture : JSON cassé, jour invalide, page d’un autre mois, valeurs hors bornes', () => {
    const b = baseMemoire({
      'journal.mois.2026-10': JSON.stringify({
        v: 1,
        pages: {
          '2026-10-12': page('2026-10-12'),
          '2026-10-13': { ...page('2026-10-14') },
          'pas-un-jour': page('2026-10-13'),
          '2026-10-15': { jour: '2026-10-15', auto: 'nimporte quoi' },
          '2026-10-16': { ...page('2026-10-16'), humeur: 9, note: 'x'.repeat(20_000), auto: { ...page('2026-10-16').auto, moteur: 'inconnu' } },
        },
      }),
      'journal.mois.2026-11': '{pas du json',
      [CLES_JOURNAL.index]: JSON.stringify(['2026-10', '2026-11', 'bidon', 5]),
    });
    expect(Object.keys(lireMois(b, '2026-10'))).toEqual(['2026-10-12', '2026-10-16']);
    const p16 = lirePage(b, '2026-10-16')!;
    expect(p16.humeur).toBeUndefined();
    expect(p16.note).toHaveLength(8000);
    expect(p16.auto.moteur).toBe('modeles');
    expect(lireMois(b, '2026-11')).toEqual({});
    expect(lireIndex(b)).toEqual(['2026-10', '2026-11']);
    expect(lireMois(b, 'n’importe quoi')).toEqual({});
  });

  it('réglages : lus avec bornes, absents si jamais activés', () => {
    const b = baseMemoire();
    expect(lireReglages(b)).toBeUndefined();
    ecrireReglages(b, { ...reglagesParDefaut('2026-10-13'), heure: 3 });
    expect(lireReglages(b)).toEqual({ v: 1, actif: true, heure: 12, depuis: '2026-10-13', ia: false });
    b.m.set(CLES_JOURNAL.reglages, '{"depuis":"2026-10-13","heure":22,"actif":false,"ia":true}');
    expect(lireReglages(b)).toEqual({ v: 1, actif: false, heure: 22, depuis: '2026-10-13', ia: true });
    b.m.set(CLES_JOURNAL.reglages, '{"depuis":"nimporte"}');
    expect(lireReglages(b)).toBeUndefined();
    expect(reglagesParDefaut('2026-10-13')).toEqual({ v: 1, actif: true, heure: 21, depuis: '2026-10-13', ia: false });
  });
});
