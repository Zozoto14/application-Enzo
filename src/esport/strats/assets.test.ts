/**
 * Assets de l'éditeur : transformation des réponses de valorant-api.com,
 * manifeste local remplaçable, cache local, et REPLI hors ligne (fetch
 * simulé : aucun appel réseau réel).
 */

import {
  CLE_CACHE,
  DUREE_CACHE_MS,
  MENTION_RIOT,
  URL_API_VALORANT,
  assetsRepli,
  chargerAssets,
  cleDe,
  creerCacheImages,
  depuisApi,
  initiales,
  type FetchAssets,
} from './assets';

const CDN = 'https://media.valorant-api.com';
const CARTES = {
  status: 200,
  data: [
    { displayName: 'Ascent', displayIcon: `${CDN}/maps/a/displayicon.png`, listViewIcon: `${CDN}/maps/a/listviewicon.png`, tacticalDescription: 'A/B Sites' },
    { displayName: 'The Range', displayIcon: `${CDN}/maps/r/displayicon.png`, tacticalDescription: null },
    { displayName: 'District', displayIcon: null, tacticalDescription: null },
    { displayName: 'Bind', displayIcon: `${CDN}/maps/b/displayicon.png`, splash: `${CDN}/maps/b/splash.png`, tacticalDescription: 'A/B Sites' },
    { displayName: 'Piège', displayIcon: 'https://ailleurs.example/x.png', tacticalDescription: 'A/B Sites' },
  ],
};
const AGENTS = {
  status: 200,
  data: [
    {
      displayName: 'KAY/O',
      isPlayableCharacter: true,
      displayIcon: `${CDN}/agents/k/displayicon.png`,
      role: { displayName: 'Initiateur' },
      abilities: [
        { slot: 'Ultimate', displayName: 'NULL/cmd', displayIcon: `${CDN}/agents/k/abilities/ultimate/displayicon.png` },
        { slot: 'Grenade', displayName: 'FRAG/ment', displayIcon: `${CDN}/agents/k/abilities/grenade/displayicon.png` },
        { slot: 'Passive', displayName: 'Passif', displayIcon: null },
        { slot: 'Ability1', displayName: 'FLASH/drive', displayIcon: `${CDN}/agents/k/abilities/ability1/displayicon.png` },
        { slot: 'Ability2', displayName: 'ZERO/point', displayIcon: `${CDN}/agents/k/abilities/ability2/displayicon.png` },
      ],
    },
    { displayName: 'Omen', isPlayableCharacter: true, displayIcon: `${CDN}/agents/o/displayicon.png`, role: { displayName: 'Contrôleur' }, abilities: [] },
  ],
};

function reponse(corps: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => corps };
}

function fauxReseau(routes: Record<string, unknown>) {
  const appels: string[] = [];
  const f: FetchAssets = async url => {
    appels.push(url);
    if (url in routes) return reponse(routes[url]);
    return reponse({ erreur: 'introuvable' }, 404);
  };
  return { f, appels };
}

function stockage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { m, lire: (c: string) => m.get(c) ?? null, ecrire: (c: string, v: string) => void m.set(c, v) };
}

const URL_CARTES = `${URL_API_VALORANT}/maps?language=fr-FR`;
const URL_AGENTS = `${URL_API_VALORANT}/agents?isPlayableCharacter=true&language=fr-FR`;

describe('valorant-api.com → assets', () => {
  it('cartes de compétition avec minimap (images du CDN seulement), agents et quatre capacités dans l’ordre C Q E X', () => {
    const a = depuisApi(CARTES, AGENTS, 1);
    expect(a.cartes.map(c => c.cle)).toEqual(['ascent', 'bind']);
    expect(a.cartes[1].vignette).toBe(`${CDN}/maps/b/splash.png`);
    const kayo = a.agents.find(x => x.cle === 'kay-o');
    expect(kayo?.role).toBe('Initiateur');
    expect(kayo?.capacites.map(c => `${c.touche}:${c.nom}`)).toEqual(['C:FRAG/ment', 'Q:FLASH/drive', 'E:ZERO/point', 'X:NULL/cmd']);
    expect(() => depuisApi({ data: [] }, AGENTS)).toThrow();
    expect(() => depuisApi('<html>', AGENTS)).toThrow();
  });

  it('clés et initiales', () => {
    expect(cleDe('KAY/O')).toBe('kay-o');
    expect(cleDe('Écho Été')).toBe('echo-ete');
    expect(initiales('KAY/O')).toBe('KO');
    expect(initiales('Dark Cover')).toBe('DC');
    expect(MENTION_RIOT).toContain('Legal Jibber Jabber');
  });
});

describe('chargerAssets', () => {
  it('réseau disponible : API, puis mise en cache ; ensuite le cache frais suffit (aucun appel)', async () => {
    const { f, appels } = fauxReseau({ [URL_CARTES]: CARTES, [URL_AGENTS]: AGENTS });
    const s = stockage();
    const a = await chargerAssets({ fetch: f, stockage: s, maintenant: 1000 });
    expect(a.source).toBe('api');
    expect(appels).toEqual(['esport-assets/manifeste.json', URL_CARTES, URL_AGENTS]);
    expect(s.m.has(CLE_CACHE)).toBe(true);
    const b = await chargerAssets({ fetch: f, stockage: s, maintenant: 2000, manifeste: null });
    expect(b.source).toBe('cache');
    expect(b.cartes).toEqual(a.cartes);
    expect(appels).toHaveLength(3);
  });

  it('hors ligne (fetch qui échoue) sans cache : repli générique (noms, aucune image)', async () => {
    const hors: FetchAssets = async () => {
      throw new TypeError('Failed to fetch');
    };
    const a = await chargerAssets({ fetch: hors, stockage: stockage(), maintenant: 5 });
    expect(a.source).toBe('repli');
    expect(a.cartes.some(c => c.cle === 'ascent')).toBe(true);
    expect(a.cartes.every(c => c.minimap === null)).toBe(true);
    expect(a.agents.every(x => x.icone === null && x.capacites.length === 4)).toBe(true);
    expect(await chargerAssets({ maintenant: 5 })).toMatchObject({ source: 'repli' });
  });

  it('API en erreur (500) avec un cache périmé : le cache périmé plutôt que le repli', async () => {
    const vieux = { ...depuisApi(CARTES, AGENTS, 0), source: 'api' };
    const s = stockage({ [CLE_CACHE]: JSON.stringify(vieux) });
    const panne: FetchAssets = async () => reponse({}, 500);
    const a = await chargerAssets({ fetch: panne, stockage: s, maintenant: DUREE_CACHE_MS + 10 });
    expect(a.source).toBe('cache-perime');
    expect(a.cartes[0].minimap).toBe(`${CDN}/maps/a/displayicon.png`);
    // Cache illisible : ignoré.
    expect((await chargerAssets({ fetch: panne, stockage: stockage({ [CLE_CACHE]: '{oups' }), maintenant: 1 })).source).toBe('repli');
  });

  it('dossier d’assets remplaçable : le manifeste local passe avant l’API', async () => {
    const manifeste = {
      jeu: 'valorant',
      cartes: [{ nom: 'Ascent', minimap: 'esport-assets/cartes/ascent.png' }, { nom: 'Bind', minimap: '../../etc/passwd' }],
      agents: [{ nom: 'Omen', icone: 'esport-assets/agents/omen.png', capacites: [{ cle: 'Ability2', nom: 'Dark Cover', icone: null }] }],
    };
    const { f, appels } = fauxReseau({ 'esport-assets/manifeste.json': manifeste });
    const a = await chargerAssets({ fetch: f, stockage: stockage(), maintenant: 1 });
    expect(a.source).toBe('local');
    expect(a.cartes[0].minimap).toBe('esport-assets/cartes/ascent.png');
    expect(a.cartes[1].minimap).toBeNull();
    expect(a.agents[0].capacites[0].touche).toBe('E');
    expect(appels).toEqual(['esport-assets/manifeste.json']);
  });

  it('repli : toutes les cartes du jeu et un agent par rôle au moins', () => {
    const r = assetsRepli(0);
    expect(r.cartes.length).toBeGreaterThanOrEqual(10);
    expect(new Set(r.agents.map(a => a.role))).toEqual(new Set(['Contrôleur', 'Initiateur', 'Sentinelle', 'Duelliste']));
  });
});

describe('cache des images', () => {
  const blob = { taille: 3 } as unknown as Blob;
  it('image chargée une seule fois (mémoire), mise en cache, URL locale ; échec réseau → null (repli)', async () => {
    let appels = 0;
    const misEnCache: string[] = [];
    const cache = creerCacheImages({
      fetch: async url => {
        appels++;
        if (url.includes('panne')) throw new TypeError('hors ligne');
        return { ok: true, blob: async () => blob, clone: () => ({ ok: true, blob: async () => blob }) };
      },
      caches: { open: async () => ({ match: async () => undefined, put: async (u: string) => void misEnCache.push(u) }) },
      creerUrl: () => 'blob:local/1',
    });
    expect(await cache.obtenir(`${CDN}/a.png`)).toBe('blob:local/1');
    expect(await cache.obtenir(`${CDN}/a.png`)).toBe('blob:local/1');
    expect(appels).toBe(1);
    expect(misEnCache).toEqual([`${CDN}/a.png`]);
    expect(await cache.obtenir(`${CDN}/panne.png`)).toBeNull();
    expect(await cache.obtenir(null)).toBeNull();
  });

  it('hors ligne mais déjà en cache : servie depuis le Cache Storage, sans réseau', async () => {
    const cache = creerCacheImages({
      fetch: async () => {
        throw new TypeError('hors ligne');
      },
      caches: { open: async () => ({ match: async () => ({ ok: true, blob: async () => blob }), put: async () => undefined }) },
      creerUrl: () => 'blob:depuis-cache',
    });
    expect(await cache.obtenir(`${CDN}/b.png`)).toBe('blob:depuis-cache');
  });
});
