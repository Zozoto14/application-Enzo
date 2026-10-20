/** Mémoire des lecteurs qui marchent le mieux, par source, dans le cache chiffré du profil. Fixtures *-exemple.fr. */
import { stockageMemoire } from '../moteur/bibliotheque';
import type { Lecteur } from '../moteur/resolution';
import { creerCache } from './cache';
import { lecteursParFiabilite, noterLecteur } from './fiabiliteLecteurs';

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
});
