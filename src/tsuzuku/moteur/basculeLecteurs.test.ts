/** Bascule automatique des lecteurs : ordre par fiabilité, contrôleur, surveillance. Fixtures neutres (*-exemple.fr). */
import {
  cleLecteur,
  creerControleur,
  fiabiliteValide,
  LECTEURS_PAR_SOURCE_MAX,
  messageBascule,
  nomLecteur,
  noterResultat,
  ordonnerParFiabilite,
  pageErreurDetectee,
  scoreFiabilite,
  SOURCES_MAX,
  sonderHote,
  surveiller,
  urlLecteurValide,
} from './basculeLecteurs';
import type { Lecteur } from './resolution';

const L = (label: string, hote: string): Lecteur => ({ label, url: `https://${hote}/embed/2`, kind: 'iframe' });
const A = L('LECTEUR A', 'a-exemple.fr');
const B = L('LECTEUR B', 'b-exemple.fr');
const C = L('LECTEUR C', 'c-exemple.fr');

describe('adresses et pages d’erreur', () => {
  it('reconnaît une adresse de lecteur utilisable', () => {
    expect(urlLecteurValide('https://a-exemple.fr/embed/1')).toBe(true);
    expect(urlLecteurValide('http://a-exemple.fr')).toBe(true);
    for (const mauvaise of ['', '   ', 'javascript:alert(1)', 'ftp://a-exemple.fr/x', '/embed/1', 'https://', 'https://a exemple.fr', null, undefined]) {
      expect(urlLecteurValide(mauvaise as string)).toBe(false);
    }
  });
  it('détecte une page d’erreur lisible, pas une vraie page', () => {
    expect(pageErreurDetectee('404 Not Found')).toBe(true);
    expect(pageErreurDetectee('Video not found')).toBe(true);
    expect(pageErreurDetectee('Cette vidéo a été supprimée : vidéo supprimée')).toBe(true);
    expect(pageErreurDetectee('')).toBe(true);
    expect(pageErreurDetectee('', true)).toBe(false);
    expect(pageErreurDetectee('Lecture de l’épisode 2 — Le Long Voyage')).toBe(false);
    expect(pageErreurDetectee(`not found ${'x '.repeat(400)}`)).toBe(false);
  });
  it('nomme un lecteur', () => {
    expect(nomLecteur(A, 0)).toBe('LECTEUR A');
    expect(nomLecteur({ label: ' ' }, 2)).toBe('Lecteur 3');
    expect(messageBascule('LECTEUR A', 'LECTEUR B')).toBe('LECTEUR A indisponible, passage à LECTEUR B');
  });
  it('identifie un lecteur par son hôte', () => {
    expect(cleLecteur(A)).toBe('a-exemple.fr');
    expect(cleLecteur({ label: 'Mon Lecteur', url: 'pas une adresse' })).toBe('mon lecteur');
  });
});

describe('mémoire des lecteurs qui marchent le mieux, par source', () => {
  it('score lissé : inconnu 0,5, succès au-dessus, échecs en dessous', () => {
    expect(scoreFiabilite(undefined)).toBe(0.5);
    expect(scoreFiabilite({ ok: 3, ko: 0 })).toBeGreaterThan(0.5);
    expect(scoreFiabilite({ ok: 0, ko: 2 })).toBeLessThan(0.5);
  });
  it('ordre inchangé sans mémoire ; le plus fiable d’abord sinon, ex æquo dans l’ordre du site', () => {
    expect(ordonnerParFiabilite([A, B, C], undefined)).toEqual([A, B, C]);
    expect(ordonnerParFiabilite([A, B, C], {})).toEqual([A, B, C]);
    let m = noterResultat({}, 'src', C, true);
    m = noterResultat(m, 'src', C, true);
    m = noterResultat(m, 'src', A, false);
    expect(ordonnerParFiabilite([A, B, C], m.src).map(l => l.label)).toEqual(['LECTEUR C', 'LECTEUR B', 'LECTEUR A']);
  });
  it('par source : une autre source n’est pas touchée', () => {
    const m = noterResultat({}, 'src1', B, true);
    expect(m.src2).toBeUndefined();
    expect(ordonnerParFiabilite([A, B], m.src2)).toEqual([A, B]);
    expect(ordonnerParFiabilite([A, B], m.src1)[0]).toBe(B);
  });
  it('un hôte qui se dégrade reprend vite sa place (compteurs plafonnés)', () => {
    let m = {};
    for (let i = 0; i < 40; i++) m = noterResultat(m, 'src', A, true);
    const f = (m as Record<string, Record<string, { ok: number; ko: number }>>).src['a-exemple.fr'];
    expect(f.ok + f.ko).toBeLessThanOrEqual(12);
    for (let i = 0; i < 10; i++) m = noterResultat(m, 'src', A, false);
    expect(ordonnerParFiabilite([A, B], (m as Record<string, Record<string, { ok: number; ko: number; a: number }>>).src)[0]).toBe(B);
  });
  it('bornée : lecteurs par source et nombre de sources', () => {
    let m = {};
    for (let i = 0; i < LECTEURS_PAR_SOURCE_MAX + 5; i++) m = noterResultat(m, 'src', L('x', `h${i}-exemple.fr`), true);
    expect(Object.keys((m as Record<string, object>).src)).toHaveLength(LECTEURS_PAR_SOURCE_MAX);
    m = {};
    for (let i = 0; i < SOURCES_MAX + 5; i++) m = noterResultat(m, `s${i}`, A, true);
    expect(Object.keys(m)).toHaveLength(SOURCES_MAX);
  });
  it('relecture défensive de ce qui a été gardé', () => {
    expect(fiabiliteValide(null)).toEqual({});
    expect(fiabiliteValide('x')).toEqual({});
    expect(fiabiliteValide({ s: 3, t: { h: { ok: 'x', ko: 1 }, i: { ok: 2, ko: 1, a: 5 }, j: { ok: -1, ko: 0 } } })).toEqual({ t: { i: { ok: 2, ko: 1, a: 5 } } });
  });
});

describe('contrôleur de bascule', () => {
  it('passe au suivant, dans l’ordre, puis dit que tous ont échoué', () => {
    const c = creerControleur(3);
    expect(c.courant()).toBe(0);
    expect(c.echec(0)).toEqual({ type: 'suivant', de: 0, vers: 1 });
    expect(c.echec(1)).toEqual({ type: 'suivant', de: 1, vers: 2 });
    expect(c.echec(2)).toEqual({ type: 'tous' });
    expect(c.tousEchoues()).toBe(true);
    expect(c.echec(2)).toEqual({ type: 'ignore' });
  });
  it('un seul lecteur : son échec est « tous »', () => {
    expect(creerControleur(1).echec(0)).toEqual({ type: 'tous' });
  });
  it('aucun lecteur : rien à faire', () => {
    expect(creerControleur(0).echec(0)).toEqual({ type: 'ignore' });
  });
  it('un échec d’un lecteur qui n’est plus affiché est ignoré (jamais deux bascules)', () => {
    const c = creerControleur(3);
    c.echec(0);
    expect(c.echec(0)).toEqual({ type: 'ignore' });
    expect(c.courant()).toBe(1);
  });
  it('choix manuel : repart de ce lecteur, la bascule continue avec les non essayés', () => {
    const c = creerControleur(3);
    c.echec(0);
    c.choisir(2);
    expect(c.courant()).toBe(2);
    expect(c.echec(2)).toEqual({ type: 'suivant', de: 2, vers: 0 });
    expect(c.echec(0)).toEqual({ type: 'suivant', de: 0, vers: 1 });
    expect(c.echec(1)).toEqual({ type: 'tous' });
    c.choisir(1);
    expect(c.tousEchoues()).toBe(false);
  });
  it('réessayer : repart du premier lecteur', () => {
    const c = creerControleur(2);
    c.echec(0);
    c.echec(1);
    c.reessayer();
    expect(c.tousEchoues()).toBe(false);
    expect(c.courant()).toBe(0);
    expect(c.echec(0)).toEqual({ type: 'suivant', de: 0, vers: 1 });
  });
  it('un indice hors liste est ignoré', () => {
    const c = creerControleur(2);
    c.choisir(5);
    expect(c.courant()).toBe(0);
  });
});

describe('surveillance « sans signe de vie »', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  it('échec une seule fois après le délai', () => {
    const surEchec = jest.fn();
    surveiller(5000, surEchec);
    jest.advanceTimersByTime(4999);
    expect(surEchec).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(surEchec).toHaveBeenCalledWith('délai dépassé');
    jest.advanceTimersByTime(60_000);
    expect(surEchec).toHaveBeenCalledTimes(1);
  });
  it('un signe de vie arrête tout', () => {
    const surEchec = jest.fn();
    const v = surveiller(5000, surEchec);
    v.vivant();
    jest.advanceTimersByTime(60_000);
    v.echec('trop tard');
    expect(surEchec).not.toHaveBeenCalled();
  });
  it('échec immédiat (erreur de chargement) puis plus rien', () => {
    const surEchec = jest.fn();
    const v = surveiller(5000, surEchec);
    v.echec('erreur de chargement');
    v.echec('encore');
    jest.advanceTimersByTime(60_000);
    expect(surEchec).toHaveBeenCalledTimes(1);
    expect(surEchec).toHaveBeenCalledWith('erreur de chargement');
  });
  it('arrêté (démontage) : aucun échec', () => {
    const surEchec = jest.fn();
    surveiller(5000, surEchec).arreter();
    jest.advanceTimersByTime(60_000);
    expect(surEchec).not.toHaveBeenCalled();
  });
});

describe('sonde de l’hôte du lecteur', () => {
  const sonde = (url: string, f: (...a: unknown[]) => Promise<unknown>) => sonderHote(url, { fetch: f as never, delaiMs: 50 });
  it('hôte qui répond (même par une erreur HTTP, illisible en no-cors) : joignable', async () => {
    const f = jest.fn(async () => ({}));
    expect(await sonde('https://a-exemple.fr/embed/1', f)).toBe(true);
    expect(f).toHaveBeenCalledWith('https://a-exemple.fr/embed/1', expect.objectContaining({ method: 'HEAD', mode: 'no-cors', credentials: 'omit', referrerPolicy: 'no-referrer' }));
  });
  it('échec réseau (DNS, connexion refusée, TLS) : injoignable', async () => {
    expect(await sonde('https://mort-exemple.fr/embed/1', async () => Promise.reject(new TypeError('Failed to fetch')))).toBe(false);
  });
  it('sonde trop lente : pas de conclusion à tort', async () => {
    const lente = (_u: unknown, init: unknown) =>
      new Promise((_ok, ko) => {
        (init as { signal: AbortSignal }).signal.addEventListener('abort', () => ko(Object.assign(new Error('abort'), { name: 'AbortError' })));
      });
    expect(await sonde('https://lent-exemple.fr/embed/1', lente)).toBe(true);
  });
  it('sans fetch ou adresse invalide : on ne conclut pas', async () => {
    expect(await sonderHote('https://a-exemple.fr', { fetch: undefined, delaiMs: 10 }).then(r => r)).toBeDefined();
    expect(await sonde('pas-une-adresse', async () => Promise.reject(new Error('x')))).toBe(true);
  });
});
