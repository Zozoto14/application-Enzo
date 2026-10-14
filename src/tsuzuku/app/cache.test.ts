import { stockageMemoire } from '../moteur/bibliotheque';
import { CLES } from '../plateforme/stockage';
import { creerCache, empreinteTexte } from './cache';

const attendre = (ms: number) => new Promise<void>(ok => setTimeout(ok, ms));

describe('cache de Tsuzuku (mémoire + base du profil)', () => {
  it('rend une entrée avec son âge et son origine (cette séance)', async () => {
    let t = 1000;
    const c = creerCache(stockageMemoire(), { maintenant: () => t, delaiEcritureMs: 0 });
    c.ecrire('a', { x: 1 });
    t = 4000;
    expect(await c.lire('a')).toEqual({ valeur: { x: 1 }, a: 1000, origine: 'memoire' });
    expect(await c.lire('absente')).toBeUndefined();
  });

  it('est gardé dans la base du profil (écriture groupée) et relu par un nouveau cache : origine « appareil »', async () => {
    const stockage = stockageMemoire();
    const ecrire = jest.spyOn(stockage, 'ecrire');
    const c = creerCache(stockage, { delaiEcritureMs: 20 });
    c.ecrire('a', 1);
    c.ecrire('b', 2);
    c.ecrire('c', 3);
    await attendre(60);
    await c.ecrireMaintenant();
    // Trois mises en cache, une seule écriture de la base.
    expect(ecrire.mock.calls.filter(([cle]) => cle === CLES.cache)).toHaveLength(1);
    const relu = creerCache(stockage);
    expect(await relu.lire('b')).toMatchObject({ valeur: 2, origine: 'appareil' });
  });

  it('borné en nombre d’entrées : la moins récemment utilisée part d’abord', async () => {
    const c = creerCache(stockageMemoire(), { entreesMax: 3, delaiEcritureMs: 0 });
    c.ecrire('a', 1);
    c.ecrire('b', 2);
    c.ecrire('c', 3);
    await c.lire('a');
    c.ecrire('d', 4);
    expect(await c.lire('b')).toBeUndefined();
    expect((await c.lire('a'))?.valeur).toBe(1);
    expect(c.taille()).toBe(3);
  });

  it('borné en octets dans la base : les plus récentes sont gardées, une entrée trop grosse reste en mémoire', async () => {
    const stockage = stockageMemoire();
    let t = 0;
    const c = creerCache(stockage, { octetsMax: 400, delaiEcritureMs: 0, maintenant: () => ++t });
    c.ecrire('vieille', 'x'.repeat(150));
    c.ecrire('recente', 'y'.repeat(150));
    c.ecrire('enorme', 'z'.repeat(1000));
    await c.ecrireMaintenant();
    await attendre(5);
    await c.ecrireMaintenant();
    const brut = (await stockage.lire(CLES.cache)) ?? '';
    expect(brut.length).toBeLessThanOrEqual(400);
    const relu = creerCache(stockage);
    expect(await relu.lire('recente')).toBeDefined();
    expect(await relu.lire('enorme')).toBeUndefined();
    expect((await c.lire('enorme'))?.valeur).toHaveLength(1000);
  });

  it('`persister: false` : en mémoire seulement', async () => {
    const stockage = stockageMemoire();
    const c = creerCache(stockage, { delaiEcritureMs: 0 });
    c.ecrire('memoire', 1, { persister: false });
    c.ecrire('base', 2);
    await attendre(5);
    await c.ecrireMaintenant();
    const relu = creerCache(stockage);
    expect(await relu.lire('memoire')).toBeUndefined();
    expect(await relu.lire('base')).toBeDefined();
  });

  it('invalidation : supprimer, supprimer par préfixe, vider (base comprise)', async () => {
    const stockage = stockageMemoire();
    const c = creerCache(stockage, { delaiEcritureMs: 0 });
    c.ecrire('ep|1', 1);
    c.ecrire('ep|2', 2);
    c.ecrire('lec|1', 3);
    c.supprimerPrefixe('ep|');
    expect(await c.lire('ep|1')).toBeUndefined();
    expect(await c.lire('lec|1')).toBeDefined();
    await c.vider();
    expect(await creerCache(stockage).lire('lec|1')).toBeUndefined();
  });

  it('une base illisible ou d’un autre format ne casse rien', async () => {
    const stockage = stockageMemoire();
    await stockage.ecrire(CLES.cache, '{pas du json');
    const c = creerCache(stockage);
    expect(await c.lire('x')).toBeUndefined();
    await stockage.ecrire(CLES.cache, JSON.stringify({ v: 99, e: { x: { v: 1, a: 1 } } }));
    expect(await creerCache(stockage).lire('x')).toBeUndefined();
  });

  it('une écriture faite pendant le chargement n’est pas écrasée par l’ancienne valeur de la base', async () => {
    const stockage = stockageMemoire();
    await stockage.ecrire(CLES.cache, JSON.stringify({ v: 1, e: { a: { v: 'ancienne', a: 1 } } }));
    const c = creerCache(stockage);
    c.ecrire('a', 'neuve');
    expect((await c.lire('a'))?.valeur).toBe('neuve');
  });

  it('empreinte stable et courte', () => {
    expect(empreinteTexte('abc')).toBe(empreinteTexte('abc'));
    expect(empreinteTexte('abc')).not.toBe(empreinteTexte('abd'));
    expect(empreinteTexte('x'.repeat(5000)).length).toBeLessThan(24);
  });
});
