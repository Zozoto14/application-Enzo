/**
 * Veille des avis du serveur (version 10) : le serveur fixe le plafond (sondage par défaut) ; flux SSE,
 * repli sur l'attente longue (flux retenu par un mandataire, pas de lecture en continu), puis sur le
 * sondage (429 « utilise le sondage », serveur sans avis) ; backoff exponentiel avec jitter, plafond
 * de requêtes par minute.
 */
import { Veilleur, oublierFluxRetenus, plafondDe, type ModeVeille } from './veille';
import { LimiteurRequetes, attenteExponentielle } from './sobriete';

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
      plafond: 'flux',
      alea: () => 0,
      dureeMinFluxMs: 0,
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

  it('« utilise le sondage » (429) → sondage, révision du refus annoncée ; serveur sans avis (404) → sondage', async () => {
    let version = 3;
    creer(async url => (url.includes('/flux') ? reponse(429, { motif: 'trop-de-connexions', mode: 'sondage', rev: 4 }) : reponse(200, { rev: version })));
    await pause(10);
    expect(v!.mode).toBe('sondage');
    expect(recues).toEqual([4]);
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
    expect(n).toBeLessThanOrEqual(2); // première pause : 1 à 2 s (exponentiel avec jitter)
    v!.arreter();
    await pause(2100);
    expect(appels.length).toBe(n);
  });
  it('attente : l’identifiant d’appareil part avec la requête (le serveur remplace une ancienne connexion du même appareil)', async () => {
    creer(async () => reponse(200, { rev: 3, attente: 1 }), { plafond: 'attente', appareil: '0a1b2c3d' });
    await pause(5);
    expect(appels[0]).toBe('/v10/coffre/principal/attendre?rev=3&delai=1&appareil=0a1b2c3d');
  });

  it('le serveur fixe le plafond : « sondage » par défaut, jamais de flux ni d’attente au-dessus', async () => {
    expect([plafondDe(undefined), plafondDe('sondage'), plafondDe('attente'), plafondDe('sse')]).toEqual(['sondage', 'sondage', 'attente', 'flux']);
    creer(async () => reponse(200, { rev: 3 }), { plafond: undefined });
    await pause(80);
    expect(v!.mode).toBe('sondage');
    expect(appels.every(a => a.endsWith('/version'))).toBe(true);
    v!.arreter();
    appels = [];
    creer(async () => reponse(200, { rev: 3, attente: 1 }), { plafond: 'attente', modeInitial: 'flux' });
    await pause(10);
    expect(appels.some(a => a.includes('/flux'))).toBe(false);
  });

  it('attente coupée trop tôt par un mandataire : pause croissante puis sondage, jamais de boucle rapide', async () => {
    creer(async () => reponse(200, { rev: 3 }), { plafond: 'attente', alea: () => 0 });
    await pause(300);
    // 1re réponse vide et rapide : pause d'au moins 1 s (2 s × jitter ≥ 1/2) avant la suivante.
    expect(appels).toHaveLength(1);
    expect(v!.mode).toBe('attente');
  });

  it('flux qui parle puis se coupe aussitôt : pas de reconnexion à 250 ms, pause exponentielle', async () => {
    let n = 0;
    creer(
      async () => {
        n++;
        const f = fluxPilote();
        f.pousser('event: version\ndata: {"rev":3}\n\n');
        f.fermer();
        return reponse(200, f.corps, 'text/event-stream');
      },
      { dureeMinFluxMs: 30_000 },
    );
    await pause(400);
    expect(n).toBe(1);
  });

  it('503 ou réseau : backoff exponentiel avec jitter, plafonné à 5 min, jamais sous la moitié du palier', () => {
    const bas = [0, 1, 2, 3, 4, 5, 6, 7, 8, 20].map(e => attenteExponentielle(e, { alea: () => 0 }));
    const haut = [0, 1, 2, 3, 4, 5, 6, 7, 8, 20].map(e => attenteExponentielle(e, { alea: () => 1 }));
    expect(haut).toEqual([2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 128_000, 256_000, 300_000, 300_000]);
    expect(bas).toEqual(haut.map(x => x / 2));
    for (let e = 0; e < 12; e++) {
      const x = attenteExponentielle(e);
      expect(x).toBeGreaterThanOrEqual(1_000);
      expect(x).toBeLessThanOrEqual(300_000);
    }
  });

  it('sondage en 503 avec Retry-After : on attend au moins ce que le serveur demande', async () => {
    let n = 0;
    creer(
      async () => {
        n++;
        return { ok: false, status: 503, headers: { get: (h: string) => (h === 'Retry-After' ? '1' : null) }, json: async () => ({}) } as unknown as Response;
      },
      { plafond: 'sondage' },
    );
    await pause(600);
    expect(n).toBe(1);
  });

  it('plafond de requêtes par minute : le veilleur attend son tour au lieu d’insister', async () => {
    let t = 0;
    const limiteur = new LimiteurRequetes(30, 60_000, () => t);
    for (let i = 0; i < 30; i++) expect(limiteur.prendre()).toBe(true);
    expect(limiteur.prendre()).toBe(false);
    expect(limiteur.attente()).toBe(60_000);
    t = 59_999;
    expect(limiteur.prendre()).toBe(false);
    t = 60_000;
    expect(limiteur.prendre()).toBe(true);
    expect(limiteur.dansLaFenetre).toBe(1);
    // Veilleur en sondage très rapide (pas 25 ms) : au plus 3 requêtes passent avec un plafond de 3.
    const etroit = new LimiteurRequetes(3, 60_000);
    creer(async () => reponse(200, { rev: 3 }), { plafond: 'sondage', limiteur: etroit });
    await pause(250);
    expect(appels).toHaveLength(3);
  });
});
