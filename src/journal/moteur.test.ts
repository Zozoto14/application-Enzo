/**
 * Moteur : lecture des sources (échec, lenteur), écriture de la page, rattrapage
 * du soir, conservation de la note, zéro appel hors de la base locale.
 */

import type { EvenementJournal, SourceJournal } from '../hub/journal/contrat';
import type { ContexteHub } from '../hub/types';
import { ecrireJournee, executerEcheances, joursEcrits, lireSources, reglagesOuCreer } from './moteur';
import { CLES_JOURNAL, ecrirePage, lirePage, lireReglages, modifierPage } from './modele';
import { JOUR, baseMemoire, journeeRemplie } from './__fixtures__/outils';

const ctx: ContexteHub = {};
const T = (jour: string, h = 21, m = 5) => new Date(`${jour}T00:00:00`).getTime() + (h * 60 + m) * 60_000;
const source = (id: string, famille: SourceJournal['famille'], lire: SourceJournal['lire']): SourceJournal => ({ id, nom: id, famille, lire });
const tous = (_jour?: string): SourceJournal[] => [
  source('taches', 'taches', j => journeeRemplie(j).filter(e => e.famille === 'taches')),
  source('office', 'office', async j => journeeRemplie(j).filter(e => e.famille === 'office')),
  source('autres', 'autre', j => journeeRemplie(j).filter(e => !['taches', 'office'].includes(e.famille))),
];

describe('lecture des sources', () => {
  it('rassemble les événements, rattache chacun à sa source et à la famille de celle-ci', async () => {
    const l = await lireSources(JOUR, tous(JOUR), ctx);
    expect(l.enEchec).toEqual([]);
    expect(l.evenements).toHaveLength(14);
    expect(l.evenements.find(e => e.id === 't1')).toMatchObject({ source: 'taches', famille: 'taches' });
    // Une source « autre » garde la famille de ses événements ; une source d’app ne peut pas en changer.
    expect(l.evenements.find(e => e.id === 'o1')?.famille).toBe('portefeuille');
    const intrus = await lireSources(JOUR, [source('taches', 'taches', () => [{ id: 'z', source: 'x', famille: 'prospects', genre: 'tache-terminee', jour: JOUR, titre: 'Z' }])], ctx);
    expect(intrus.evenements[0]).toMatchObject({ famille: 'taches', source: 'taches' });
  });

  it('une source qui lève, ou qui dépasse le délai, est notée sans bloquer les autres', async () => {
    const sources = [
      source('bon', 'taches', () => [{ id: '1', source: 'bon', famille: 'taches', genre: 'tache-terminee', jour: JOUR, titre: 'Ok' }]),
      source('casse', 'office', () => {
        throw new Error('boum');
      }),
      source('lente', 'tsuzuku', () => new Promise<EvenementJournal[]>(() => undefined)),
    ];
    const l = await lireSources(JOUR, sources, ctx, 30);
    expect(l.evenements.map(e => e.id)).toEqual(['1']);
    expect(l.enEchec).toEqual(['casse', 'lente']);
  });

  it('ignore les événements invalides ou d’un autre jour', async () => {
    const l = await lireSources(JOUR, [source('s', 'taches', () => [{ id: '', titre: '' } as unknown as EvenementJournal, { id: 'h', source: 's', famille: 'taches', genre: 'tache-creee', jour: '2026-10-12', titre: 'Hier' }])], ctx);
    expect(l.evenements).toEqual([]);
    expect(l.enEchec).toEqual([]);
  });
});

describe('écriture d’une journée', () => {
  it('écrit la page : texte, compteurs, nombre d’événements', async () => {
    const b = baseMemoire();
    const page = await ecrireJournee(JOUR, { base: b, sources: tous(JOUR), contexte: ctx, maintenant: T(JOUR) });
    expect(page.nbEvenements).toBe(14);
    expect(page.compteurs).toMatchObject({ taches_terminees: 3, episodes: 3, operations: 1 });
    expect(page.auto.sections.length).toBeGreaterThanOrEqual(5);
    expect(lirePage(b, JOUR)).toEqual(page);
    expect(page.sourcesEnEchec).toBeUndefined();
  });

  it('écrit quand même la page si une source manque, et le note dans la page', async () => {
    const b = baseMemoire();
    const sources = [...tous(JOUR), source('relais', 'office', () => Promise.reject(new Error('hors ligne')))];
    const page = await ecrireJournee(JOUR, { base: b, sources, contexte: ctx, maintenant: T(JOUR) });
    expect(page.sourcesEnEchec).toEqual(['relais']);
    expect(page.nbEvenements).toBe(14);
  });

  it('réécrire une page garde la note, l’humeur et l’épingle', async () => {
    const b = baseMemoire();
    await ecrireJournee(JOUR, { base: b, sources: tous(JOUR), contexte: ctx, maintenant: T(JOUR) });
    modifierPage(b, JOUR, { note: 'À garder', humeur: 5, epingle: true }, T(JOUR, 22));
    const p = await ecrireJournee(JOUR, { base: b, sources: tous(JOUR).slice(0, 1), contexte: ctx, maintenant: T(JOUR, 23) });
    expect(p).toMatchObject({ note: 'À garder', humeur: 5, epingle: true, nbEvenements: 4 });
  });

  it('une journée sans aucun événement donne une page « calme », pas une erreur', async () => {
    const p = await ecrireJournee(JOUR, { base: baseMemoire(), sources: [], contexte: ctx, maintenant: T(JOUR) });
    expect(p.nbEvenements).toBe(0);
    expect(p.auto.sections).toEqual([]);
  });

  it('IA désactivée par défaut : le rédacteur externe n’est jamais appelé', async () => {
    const rediger = jest.fn(async () => ({ intro: 'IA', sections: [] }));
    const redacteur = { id: 'x', nom: 'x', rediger };
    const b = baseMemoire();
    const p = await ecrireJournee(JOUR, { base: b, sources: tous(JOUR), contexte: ctx, maintenant: T(JOUR), redacteur });
    expect(rediger).not.toHaveBeenCalled();
    expect(p.auto.moteur).toBe('modeles');
    const q = await ecrireJournee(JOUR, { base: b, sources: tous(JOUR), contexte: ctx, maintenant: T(JOUR), redacteur, reglages: { v: 1, actif: true, heure: 21, depuis: JOUR, ia: true } });
    expect(rediger).toHaveBeenCalledTimes(1);
    expect(q.auto.moteur).toBe('ia');
  });
});

describe('échéance du soir et rattrapage', () => {
  const lancer = (b: ReturnType<typeof baseMemoire>, maintenant: number) => executerEcheances({ base: b, sources: tous(JOUR), contexte: ctx, maintenant });

  it('première utilisation : crée les réglages (actif, 21 h, à partir d’aujourd’hui) sans écrire de page avant l’heure', async () => {
    const b = baseMemoire();
    expect(await lancer(b, T('2026-10-13', 15, 0))).toEqual([]);
    expect(lireReglages(b)).toEqual({ v: 1, actif: true, heure: 21, depuis: '2026-10-13', ia: false });
    expect(joursEcrits(b).size).toBe(0);
  });

  it('à 21 h, écrit la page du jour — et une seule fois', async () => {
    const b = baseMemoire();
    await lancer(b, T('2026-10-13', 15, 0));
    expect(await lancer(b, T('2026-10-13', 21, 0))).toEqual(['2026-10-13']);
    const ecritures = b.ecritures.length;
    expect(await lancer(b, T('2026-10-13', 21, 1))).toEqual([]);
    expect(await lancer(b, T('2026-10-13', 23, 50))).toEqual([]);
    expect(b.ecritures.length).toBe(ecritures);
  });

  it('app fermée au soir : la page d’hier s’écrit à la première ouverture du lendemain (et celle d’aujourd’hui attend 21 h)', async () => {
    const b = baseMemoire();
    await lancer(b, T('2026-10-13', 15, 0));
    expect(await lancer(b, T('2026-10-14', 8, 30))).toEqual(['2026-10-13']);
    expect(await lancer(b, T('2026-10-14', 21, 2))).toEqual(['2026-10-14']);
  });

  it('plusieurs soirs manqués : rattrapés du plus ancien au plus récent', async () => {
    const b = baseMemoire();
    await lancer(b, T('2026-10-10', 15, 0));
    expect(await lancer(b, T('2026-10-14', 9, 0))).toEqual(['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13']);
    expect(lirePage(b, '2026-10-12')?.auto.intro).toContain('Lundi 12 octobre 2026');
  });

  it('désactivé : aucune page ; une note en avance ne bloque pas la page du soir', async () => {
    const b = baseMemoire();
    await lancer(b, T('2026-10-13', 15, 0));
    b.m.set(CLES_JOURNAL.reglages, JSON.stringify({ ...lireReglages(b)!, actif: false }));
    expect(await lancer(b, T('2026-10-13', 22, 0))).toEqual([]);
    b.m.set(CLES_JOURNAL.reglages, JSON.stringify({ ...lireReglages(b)!, actif: true }));
    modifierPage(b, '2026-10-13', { note: 'Note du matin', humeur: 4 }, T('2026-10-13', 8, 0));
    expect(await lancer(b, T('2026-10-13', 22, 0))).toEqual(['2026-10-13']);
    expect(lirePage(b, '2026-10-13')).toMatchObject({ note: 'Note du matin', humeur: 4 });
    expect(lirePage(b, '2026-10-13')?.auto.moteur).toBe('modeles');
  });

  it('heure réglée à 18 h : la page est due dès 18 h', async () => {
    const b = baseMemoire();
    reglagesOuCreer(b, T('2026-10-13', 9, 0));
    b.m.set(CLES_JOURNAL.reglages, JSON.stringify({ ...lireReglages(b)!, heure: 18 }));
    expect(await lancer(b, T('2026-10-13', 17, 59))).toEqual([]);
    expect(await lancer(b, T('2026-10-13', 18, 0))).toEqual(['2026-10-13']);
  });

  it('ne réécrit jamais une page déjà rédigée (ni sa note)', async () => {
    const b = baseMemoire();
    await lancer(b, T('2026-10-13', 15, 0));
    await lancer(b, T('2026-10-13', 21, 0));
    ecrirePage(b, { ...lirePage(b, '2026-10-13')!, note: 'Ma note' });
    await lancer(b, T('2026-10-14', 8, 0));
    expect(lirePage(b, '2026-10-13')?.note).toBe('Ma note');
  });
});
