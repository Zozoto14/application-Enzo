/**
 * Veille des avis du serveur (version 10) : flux SSE, repli sur l'attente longue (flux retenu par un
 * mandataire, pas de lecture en continu), puis sur le sondage (429, serveur sans avis).
 */
import { Veilleur, oublierFluxRetenus, type ModeVeille } from './veille';

const RELAIS = 'https://relais.test';
const liaison = { relais: RELAIS, jeton: 's1.' + 'a'.repeat(64) };
const pause = (ms: number) => new Promise<void>(ok => setTimeout(ok, ms));
const encodeur = new (globalThis as unknown as { TextEncoder: new () => { encode(t: string): Uint8Array } }).TextEncoder();

/** Corps lisible piloté par le test (comme `response.body` d'un navigateur). */
function fluxPilote() {
  const morceaux: Uint8Array[] = [];
  let attente: ((v: { done: boolean; value?: Uint8Array }) => void) | undefined;
  let ferme = false;
  const corps = {
    getReader: () => ({
      read: () =>
        new Promise<{ done: boolean; value?: Uint8Array }>(ok => {
          if (morceaux.length > 0) ok({ done: false, value: morceaux.shift() });
          else if (ferme) ok({ done: true });
          else attente = ok;
        }),
      cancel: async () => {
        ferme = true;
        attente?.({ done: true });
      },
    }),
  };
  return {
    corps,
    pousser(texte: string) {
      const v = encodeur.encode(texte);
      if (attente) {
        const a = attente;
        attente = undefined;
        a({ done: false, value: v });
      } else morceaux.push(v);
    },
    fermer() {
      ferme = true;
      attente?.({ done: true });
    },
  };
}

const reponse = (statut: number, corps: unknown, type = 'application/json') =>
  ({
    ok: statut >= 200 && statut < 300,
    status: statut,
    headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? type : null) },
    body: corps && typeof corps === 'object' && 'getReader' in (corps as object) ? corps : null,
    json: async () => corps,
  }) as unknown as Response;

describe('Veilleur (avis du serveur)', () => {
  let rev: number;
  let recues: number[];
  let modes: ModeVeille[];
  let appels: string[];
  let v: Veilleur | undefined;
  beforeEach(() => {
    rev = 3;
    recues = [];
    modes = [];
    appels = [];
    oublierFluxRetenus();
  });
  afterEach(() => v?.arreter());
  const creer = (requete: (url: string, init?: RequestInit) => Promise<Response>, o: Partial<ConstructorParameters<typeof Veilleur>[0]> = {}) => {
    v = new Veilleur({
      liaison,
      compte: 'principal',
      revConnue: () => rev,
      surVersion: r => recues.push(r),
      surMode: m => modes.push(m),
      requete: (async (url: string, init?: RequestInit) => {
        appels.push(String(url).replace(RELAIS, ''));
        return requete(String(url), init);
      }) as typeof fetch,
      delaiPremierAvisMs: 60,
      pasSondageMs: 25,
      attenteS: 1,
      ...o,
    });
    v.demarrer();
    return v;
  };

  it('flux SSE : jeton dans l’en-tête, révision courante, puis chaque nouvelle révision (rien pour une ancienne)', async () => {
    const f = fluxPilote();
    let entetes: Record<string, string> = {};
    creer(async (_url, init) => {
      entetes = init?.headers as Record<string, string>;
      return reponse(200, f.corps, 'text/event-stream; charset=utf-8');
    });
    await pause(5);
    expect(appels[0]).toBe('/v10/coffre/principal/flux?rev=3');
    expect(entetes.Authorization).toBe(`Bearer ${liaison.jeton}`);
    f.pousser(`:${' '.repeat(50)}\nretry: 3000\n\nevent: version\nid: 3\ndata: {"rev":3}\n\n`);
    await pause(5);
    expect(recues).toEqual([]);
    f.pousser('event: version\ndata: {"rev":4}\n\n: coeur\n\nevent: ver');
    f.pousser('sion\ndata: {"rev":5}\n\n');
    await pause(5);
    expect(recues).toEqual([4, 5]);
    // Après le délai de garde, le flux qui a parlé reste ouvert.
    await pause(100);
    expect(v!.mode).toBe('flux');
    expect(appels).toHaveLength(1);
  });

  it('flux retenu par un mandataire (aucun avis à temps) → attente longue, et le relais est retenu pour la suite', async () => {
    const f = fluxPilote();
    creer(async (url, init) => {
      if (url.includes('/flux')) {
        init?.signal?.addEventListener('abort', () => f.fermer());
        return reponse(200, f.corps, 'text/event-stream');
      }
      await pause(10);
      return reponse(200, { rev: 7 });
    });
    await pause(120);
    expect(modes).toEqual(['flux', 'attente']);
    expect(appels.some(a => a.startsWith('/v10/coffre/principal/attendre?rev=3&delai=1'))).toBe(true);
    expect(recues[0]).toBe(7);
    v!.arreter();
    // Une nouvelle veille sur ce relais commence directement par l'attente longue.
    modes = [];
    creer(async () => reponse(200, { rev: 3 }));
    expect(modes[0]).toBe('attente');
  });

  it('pas de lecture en continu (app iPhone) → attente longue tout de suite', async () => {
    creer(async url => (url.includes('/flux') ? reponse(200, { pas: 'de flux' }, 'text/event-stream') : reponse(200, { rev: 3, attente: 1 })));
    await pause(20);
    expect(modes).toEqual(['flux', 'attente']);
    expect(recues).toEqual([]);
  });

  it('attente longue : chaque réponse plus récente est annoncée, et l’attente reprend aussitôt', async () => {
    let n = 0;
    creer(
      async () => {
        n++;
        await pause(15);
        return reponse(200, { rev: 3 + n });
      },
      { modeInitial: 'attente' },
    );
    await pause(80);
    expect(recues.slice(0, 3)).toEqual([4, 5, 6]);
  });

  it('trop de connexions (429) → sondage ; serveur sans avis (404) → sondage', async () => {
    let version = 3;
    creer(async url => (url.includes('/flux') ? reponse(429, { motif: 'trop-de-connexions' }) : reponse(200, { rev: version })));
    await pause(10);
    expect(v!.mode).toBe('sondage');
    version = 9;
    await pause(60);
    expect(recues).toContain(9);
    expect(appels.filter(a => a.endsWith('/version')).length).toBeGreaterThanOrEqual(2);
    v!.arreter();
    creer(async url => (url.includes('/attendre') ? reponse(404, {}) : reponse(200, { rev: 3 })), { modeInitial: 'attente' });
    await pause(10);
    expect(v!.mode).toBe('sondage');
  });

  it('réseau coupé : réessais espacés, puis repli ; arrêté, plus aucun appel', async () => {
    creer(async () => {
      throw new TypeError('Failed to fetch');
    }, { modeInitial: 'sondage' });
    await pause(30);
    const n = appels.length;
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(2); // première pause : 1 s
    v!.arreter();
    await pause(1100);
    expect(appels.length).toBe(n);
  });
});
