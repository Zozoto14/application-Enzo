/** Mémoire des lecteurs qui marchent le mieux, par source, dans le cache chiffré du profil. Fixtures *-exemple.fr. */
import { stockageMemoire } from '../moteur/bibliotheque';
import type { Lecteur } from '../moteur/resolution';
import { creerCache } from './cache';
import { CLE_CACHE_ANCIENNE, lecteursParFiabilite, noterLecteur } from './fiabiliteLecteurs';
import { CLES } from '../plateforme/stockage';
import { enregistrerPosition, lirePositions, positionReprise } from './positions';

const L = (label: string, hote: string): Lecteur => ({ label, url: `https://${hote}/embed/2`, kind: 'iframe' });
const A = L('LECTEUR A', 'a-exemple.fr');
const B = L('LECTEUR B', 'b-exemple.fr');
const C = L('LECTEUR C', 'c-exemple.fr');

describe('fiabilité des lecteurs par source', () => {
  it('sans mémoire : l’ordre du site', async () => {
    const cache = creerCache(stockageMemoire({}), { delaiEcritureMs: 0 });
    expect(await lecteursParFiabilite({ cache }, 'src', [A, B, C])).toEqual([A, B, C]);
  });
  it('un lecteur qui échoue passe après ; celui qui réussit passe avant — par source', async () => {
    const cache = creerCache(stockageMemoire({}), { delaiEcritureMs: 0 });
    await noterLecteur({ cache }, 'src', A, false);
    await noterLecteur({ cache }, 'src', C, true);
    expect((await lecteursParFiabilite({ cache }, 'src', [A, B, C])).map(l => l.label)).toEqual(['LECTEUR C', 'LECTEUR B', 'LECTEUR A']);
    expect(await lecteursParFiabilite({ cache }, 'autre', [A, B, C])).toEqual([A, B, C]);
  });
  it('gardée sur l’appareil : retrouvée avec un nouveau cache sur le même stockage', async () => {
    const stockage = stockageMemoire({});
    const cache = creerCache(stockage, { delaiEcritureMs: 0 });
    await noterLecteur({ cache }, 'src', B, true);
    await cache.ecrireMaintenant();
    const rouvert = creerCache(stockage, { delaiEcritureMs: 0 });
    expect((await lecteursParFiabilite({ cache: rouvert }, 'src', [A, B]))[0]).toBe(B);
  });
  it('sans identifiant de source ou avec un seul lecteur : rien à faire, jamais d’erreur', async () => {
    const cache = creerCache(stockageMemoire({}), { delaiEcritureMs: 0 });
    await noterLecteur({ cache }, undefined, A, true);
    expect(await lecteursParFiabilite({ cache }, undefined, [A, B])).toEqual([A, B]);
    expect(await lecteursParFiabilite({ cache }, 'src', [A])).toEqual([A]);
  });
  it('dans la base du profil (synchronisée) : reprise une fois de l’ancien cache de l’appareil, puis tenue à jour', async () => {
    const stockage = stockageMemoire({});
    const cache = creerCache(stockage, { delaiEcritureMs: 0 });
    cache.ecrire(CLE_CACHE_ANCIENNE, { src: { 'b-exemple.fr': { ok: 4, ko: 0, a: 1 } } });
    expect((await lecteursParFiabilite({ cache, stockage }, 'src', [A, B]))[0]).toBe(B);
    expect(JSON.parse((await stockage.lire(CLES.fiabiliteLecteurs))!).src['b-exemple.fr'].ok).toBe(4);
    await noterLecteur({ cache, stockage }, 'src', A, true);
    expect(JSON.parse((await stockage.lire(CLES.fiabiliteLecteurs))!).src['a-exemple.fr'].ok).toBe(1);
    // Une valeur arrivée d'un autre appareil (synchro) est relue aussitôt.
    await stockage.ecrire(CLES.fiabiliteLecteurs, JSON.stringify({ src: { 'c-exemple.fr': { ok: 9, ko: 0, a: 5 } } }));
    expect((await lecteursParFiabilite({ cache, stockage }, 'src', [A, B, C]))[0]).toBe(C);
  });
});

describe('position de lecture dans l’épisode', () => {
  it('retenue, reprise au même épisode seulement, effacée à la fin', async () => {
    const stockage = stockageMemoire({});
    const s = { stockage };
    await enregistrerPosition(s, 'anime:1', 3, 600, 1400, 10);
    expect(await positionReprise(s, 'anime:1', 3)).toBe(600);
    expect(await positionReprise(s, 'anime:1', 4)).toBeUndefined();
    await enregistrerPosition(s, 'anime:1', 3, 1390, 1400, 20);
    expect(lirePositions(await stockage.lire(CLES.positions))['anime:1']).toBeUndefined();
  });
});
