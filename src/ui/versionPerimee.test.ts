import {
  CLE_GARDE,
  FENETRE_MS,
  abonnerVersion,
  estErreurChunk,
  etatVersion,
  installerEcouteursChunks,
  reinitialiserVersion,
  sansRechargement,
  traiterErreurChunk,
  type EnvRechargement,
} from './versionPerimee';

function env(over: Partial<EnvRechargement> = {}) {
  const magasin = new Map<string, string>();
  const e = {
    stockage: { getItem: (k: string) => magasin.get(k) ?? null, setItem: (k: string, v: string) => void magasin.set(k, v) },
    maintenant: jest.fn(() => 1_000_000),
    recharger: jest.fn(),
    ...over,
  };
  return { e, magasin };
}

beforeEach(() => reinitialiserVersion());

describe('estErreurChunk', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://appdashboard.fr/assets/Discord-DrUzaNFZ.js',
    'Importing a module script failed.',
    'error loading dynamically imported module: https://x/y.js',
  ])('reconnaît « %s »', message => {
    expect(estErreurChunk(new TypeError(message))).toBe(true);
    expect(estErreurChunk(message)).toBe(true);
  });
  it('ignore les autres erreurs', () => {
    expect(estErreurChunk(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(estErreurChunk(undefined)).toBe(false);
  });
});

describe('traiterErreurChunk', () => {
  const chunk = new TypeError('Failed to fetch dynamically imported module: /assets/a.js');

  it('recharge une seule fois, même si plusieurs erreurs arrivent ensemble', () => {
    const { e, magasin } = env();
    expect(traiterErreurChunk(chunk, e)).toBe('rechargement');
    traiterErreurChunk(chunk, e);
    expect(e.recharger).toHaveBeenCalledTimes(1);
    expect(magasin.get(CLE_GARDE)).toBe('1000000');
  });

  it('ne recharge pas une seconde fois si l\'erreur revient juste après : « nouvelle version »', () => {
    const { e, magasin } = env();
    magasin.set(CLE_GARDE, String(1_000_000 - 5_000)); // la page vient d'être rechargée
    const rappel = jest.fn();
    const stop = abonnerVersion(rappel);
    expect(traiterErreurChunk(chunk, e)).toBe('nouvelle-version');
    expect(e.recharger).not.toHaveBeenCalled();
    expect(etatVersion()).toBe('nouvelle-version');
    expect(rappel).toHaveBeenCalled();
    stop();
  });

  it('autorise un nouveau rechargement bien plus tard dans la session', () => {
    const { e, magasin } = env();
    magasin.set(CLE_GARDE, String(1_000_000 - FENETRE_MS - 1));
    expect(traiterErreurChunk(chunk, e)).toBe('rechargement');
    expect(e.recharger).toHaveBeenCalledTimes(1);
  });

  it('sans sessionStorage : aucun rechargement automatique (pas de boucle possible)', () => {
    const { e } = env({ stockage: undefined });
    expect(traiterErreurChunk(chunk, e)).toBe('nouvelle-version');
    expect(e.recharger).not.toHaveBeenCalled();
  });

  it('sessionStorage qui jette : « nouvelle version »', () => {
    const { e } = env({ stockage: { getItem: () => { throw new Error('bloqué'); }, setItem: () => undefined } });
    expect(traiterErreurChunk(chunk, e)).toBe('nouvelle-version');
    expect(e.recharger).not.toHaveBeenCalled();
  });

  it('ignore les erreurs ordinaires', () => {
    const { e } = env();
    expect(traiterErreurChunk(new Error('autre'), e)).toBeUndefined();
    expect(e.recharger).not.toHaveBeenCalled();
  });
});

describe('installerEcouteursChunks', () => {
  it('écoute vite:preloadError, unhandledrejection et error', () => {
    const { e } = env();
    const rappels = new Map<string, (ev: unknown) => void>();
    installerEcouteursChunks({ addEventListener: (t, r) => void rappels.set(t, r) }, e);
    expect([...rappels.keys()].sort()).toEqual(['error', 'unhandledrejection', 'vite:preloadError']);
    rappels.get('vite:preloadError')!({ payload: new Error('Importing a module script failed.') });
    expect(e.recharger).toHaveBeenCalledTimes(1);
    rappels.get('unhandledrejection')!({ reason: new TypeError('Failed to fetch dynamically imported module: x') });
    rappels.get('error')!({ error: new Error('error loading dynamically imported module: y') });
    expect(e.recharger).toHaveBeenCalledTimes(1);
  });

  it('un préchargement en arrière-plan qui échoue ne recharge jamais la page (hors ligne, morceau absent)', async () => {
    const { e } = env();
    const rappels = new Map<string, (ev: unknown) => void>();
    installerEcouteursChunks({ addEventListener: (t, r) => void rappels.set(t, r) }, e);
    await expect(
      sansRechargement(async () => {
        rappels.get('vite:preloadError')!({ payload: new TypeError('Failed to fetch dynamically imported module: x') });
        throw new TypeError('Failed to fetch dynamically imported module: x');
      }),
    ).rejects.toThrow();
    expect(e.recharger).not.toHaveBeenCalled();
    expect(etatVersion()).toBe('ok');
    // Hors préchargement : le mécanisme habituel reprend (rechargement unique).
    rappels.get('vite:preloadError')!({ payload: new TypeError('Failed to fetch dynamically imported module: x') });
    expect(e.recharger).toHaveBeenCalledTimes(1);
  });
});
