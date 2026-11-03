/**
 * Temps réel côté app (docs/esport/temps-reel.md) :
 *  - UNE seule connexion longue pour plusieurs onglets (Web Locks + BroadcastChannel simulés), relais des
 *    messages à tous les onglets, relève quand le meneur se masque ;
 *  - repli automatique : flux SSE → attente longue → sondage (serveur « sondage », 429) ; flux retenu par un
 *    mandataire (pas de « bonjour ») → attente longue ;
 *  - reprise par curseur (`depuis`) après une coupure ;
 *  - verrou optimiste du client : `X-Version-Lue` envoyée, `X-Version-Objet` notée, 409 lisible ;
 *  - bandeau de conflit (Recharger, Copier mes modifications) et pastille de présence.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { themeHub } from '../../hub/themes';
import type { CanalOnglets, VerrousWeb } from '../../sync/relais/meneurOnglets';
import { clientEsport, ErreurEsport, noterVersionLue, versionLue } from '../client';
import { definirLangue } from '../i18n';
import { CanalEsport, EcouteurEsport, type EtatCanal, type LotTempsReel } from './transport';
import { canalPour, concerne, fabriqueCanal, oublierCanaux, type VerrouOptimiste } from './hooks';
import { BandeauConflit, PastillePresence } from './ui';

const pause = (ms = 0) => new Promise<void>(ok => setTimeout(ok, ms));
const theme = themeHub('nuit');

function verrousNavigateur(): VerrousWeb {
  const files = new Map<string, Array<() => void>>();
  const tenus = new Set<string>();
  const suivant = (nom: string) => {
    const prochain = files.get(nom)?.shift();
    if (prochain) prochain();
    else tenus.delete(nom);
  };
  return {
    request(nom, options, rappel) {
      return new Promise((ok, ko) => {
        const lancer = () => {
          tenus.add(nom);
          Promise.resolve(rappel({ name: nom }))
            .then(ok, ko)
            .finally(() => suivant(nom));
        };
        if (!tenus.has(nom)) return lancer();
        const f = files.get(nom) ?? [];
        files.set(nom, f);
        f.push(lancer);
        options.signal?.addEventListener('abort', () => {
          const i = f.indexOf(lancer);
          if (i >= 0) {
            f.splice(i, 1);
            ko(new Error('AbortError'));
          }
        });
      });
    },
  };
}

function canauxNavigateur() {
  const ouverts = new Map<string, Set<CanalOnglets>>();
  return (nom: string): CanalOnglets => {
    const groupe = ouverts.get(nom) ?? new Set();
    ouverts.set(nom, groupe);
    const canal: CanalOnglets = {
      onmessage: null,
      postMessage(m) {
        for (const autre of groupe) if (autre !== canal) setTimeout(() => autre.onmessage?.({ data: m }), 0);
      },
      close() {
        groupe.delete(canal);
      },
    };
    groupe.add(canal);
    return canal;
  };
}

/** Flux SSE simulé : le test y pousse des blocs ; `fermer()` termine la réponse. */
function fluxSimule(signal?: AbortSignal) {
  const encodeur = new (globalThis as unknown as { TextEncoder: new () => { encode(t: string): Uint8Array } }).TextEncoder();
  const file: Uint8Array[] = [];
  let attente: ((r: { done: boolean; value?: Uint8Array }) => void) | undefined;
  let fini = false;
  const livrer = () => {
    if (!attente) return;
    if (file.length) {
      const a = attente;
      attente = undefined;
      a({ done: false, value: file.shift() });
    } else if (fini) {
      const a = attente;
      attente = undefined;
      a({ done: true });
    }
  };
  signal?.addEventListener('abort', () => {
    fini = true;
    livrer();
  });
  return {
    pousser(texte: string) {
      file.push(encodeur.encode(texte));
      livrer();
    },
    fermer() {
      fini = true;
      livrer();
    },
    get ouvert() {
      return !fini;
    },
    reponse: {
      ok: true,
      status: 200,
      headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'text/event-stream; charset=utf-8' : null) },
      body: {
        getReader: () => ({
          read: () =>
            new Promise<{ done: boolean; value?: Uint8Array }>(ok => {
              attente = ok;
              livrer();
            }),
          cancel: async () => {
            fini = true;
            livrer();
          },
        }),
      },
    } as unknown as Response,
  };
}

const json = (corps: unknown, statut = 200, entetes: Record<string, string> = {}) =>
  ({ ok: statut >= 200 && statut < 300, status: statut, headers: { get: (n: string) => entetes[n] ?? (n.toLowerCase() === 'content-type' ? 'application/json' : null) }, json: async () => corps }) as unknown as Response;

const source = { adresse: 'https://esport.test', jeton: async () => 'es1.session' };

describe('CanalEsport : une seule connexion par navigateur', () => {
  it('4 onglets visibles : UN flux ; chaque onglet reçoit les messages ; relève quand le meneur se masque', async () => {
    const verrous = verrousNavigateur();
    const creerCanal = canauxNavigateur();
    const flux: Array<ReturnType<typeof fluxSimule>> = [];
    const urls: string[] = [];
    const requete = (async (url: string, init?: RequestInit) => {
      urls.push(url);
      const f = fluxSimule(init?.signal ?? undefined);
      flux.push(f);
      setTimeout(() => f.pousser(`:${' '.repeat(2048)}\n\nevent: bonjour\ndata: {"dernierId":5,"mode":"sse"}\n\n`), 0);
      return f.reponse;
    }) as unknown as typeof fetch;
    const visibles = [true, true, true, true];
    const rappels: Array<() => void> = [];
    const onglets = visibles.map(
      (_, i) =>
        new CanalEsport({
          cle: 'esport|compte',
          source,
          requete,
          verrous,
          creerCanal,
          appareil: 'nav-test-1',
          visible: () => visibles[i],
          surVisibilite: f => {
            rappels[i] = f;
            return () => undefined;
          },
        }),
    );
    const recus: LotTempsReel[][] = onglets.map(() => []);
    const etats: EtatCanal[][] = onglets.map(() => []);
    onglets.forEach((o, i) => {
      o.suivreEtat(e => etats[i].push(e));
      o.ecouter(l => recus[i].push(l));
    });
    await pause(20);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/\/temps-reel\/flux\?depuis=0&appareil=/);
    expect(onglets.filter(o => o.estMeneur)).toHaveLength(1);
    // État relayé : tous les onglets affichent « En direct ».
    await pause(10);
    expect(onglets.map(o => o.etat)).toEqual(['direct', 'direct', 'direct', 'direct']);
    flux[0].pousser('id: 6\nevent: maj\ndata: {"type":"maj","id":6,"sujet":"cm","cle":"cm-carte:1","version":2}\n\n');
    await pause(20);
    for (const r of recus) expect(r.flatMap(l => l.messages).map(m => m.id)).toEqual([6]);
    // Le meneur se masque : sa connexion est rendue, un autre onglet visible prend la suite (une seule à la fois).
    const meneur = onglets.findIndex(o => o.estMeneur);
    visibles[meneur] = false;
    rappels[meneur]();
    await pause(20);
    expect(flux[0].ouvert).toBe(false);
    expect(flux.filter(f => f.ouvert)).toHaveLength(1);
    expect(urls).toHaveLength(2);
    // Reprise : le nouvel onglet meneur repart du dernier message vu (curseur relayé).
    expect(urls[1]).toMatch(/depuis=6/);
    // L'onglet masqué n'a plus de connexion à lui, mais reçoit toujours ce que relaie le nouveau meneur.
    expect(onglets[meneur].estMeneur).toBe(false);
    expect(onglets[meneur].etat).toBe('direct');
    onglets.forEach(o => o.fermer());
    await pause(10);
    expect(flux.filter(f => f.ouvert)).toHaveLength(0);
  });

  it('dernier écouteur parti : connexion fermée (rien ne reste ouvert au repos)', async () => {
    const flux: Array<ReturnType<typeof fluxSimule>> = [];
    const requete = (async (_url: string, init?: RequestInit) => {
      const f = fluxSimule(init?.signal ?? undefined);
      flux.push(f);
      setTimeout(() => f.pousser('event: bonjour\ndata: {"dernierId":1}\n\n'), 0);
      return f.reponse;
    }) as unknown as typeof fetch;
    const canal = new CanalEsport({ cle: 'x', source, requete, verrous: null, creerCanal: null, visible: () => true, surVisibilite: () => () => undefined });
    const arreter = canal.ecouter(() => undefined);
    await pause(10);
    expect(flux[0].ouvert).toBe(true);
    arreter();
    await pause(10);
    expect(flux[0].ouvert).toBe(false);
    expect(canal.etat).toBe('arret');
  });
});

describe('EcouteurEsport : repli automatique et reprise', () => {
  const ecouteur = (requete: typeof fetch, extra: Partial<ConstructorParameters<typeof EcouteurEsport>[0]> = {}) => {
    const etats: string[] = [];
    const lots: LotTempsReel[] = [];
    let curseur = 0;
    const e = new EcouteurEsport({
      source,
      requete,
      curseur: () => curseur,
      surLot: (l, id) => {
        lots.push(l);
        if (id) curseur = Math.max(curseur, id);
      },
      surEtat: etat => etats.push(etat),
      alea: () => 0,
      ...extra,
    });
    return { e, etats, lots, curseur: () => curseur };
  };

  it('flux sans lecture en continu → attente longue ; serveur « sondage » (429) → sondage, sans boucle', async () => {
    const actions: string[] = [];
    const requete = (async (url: string) => {
      const action = /temps-reel\/([a-z]+)/.exec(url)![1];
      actions.push(action);
      if (action === 'flux') return json({}, 200); // réponse transformée par un intermédiaire (pas de flux)
      if (action === 'attendre') return json({ erreur: 'x', code: 'mode-sondage', mode: 'sondage', pas: 15 }, 429, { 'Retry-After': '15' });
      return json({ evenements: [{ type: 'maj', id: 9, sujet: 'cm' }], dernierId: 9, pas: 15 });
    }) as unknown as typeof fetch;
    const minuteries: Array<{ f: () => void; ms: number }> = [];
    const { e, etats, lots } = ecouteur(requete, {
      minuteries: {
        setTimeout: (f, ms) => {
          minuteries.push({ f, ms });
          return minuteries.length;
        },
        clearTimeout: () => undefined,
        setInterval: () => 0,
        clearInterval: () => undefined,
      },
    });
    e.demarrer();
    await pause(10);
    expect(actions).toEqual(['flux', 'attendre']);
    expect(e.modeCourant).toBe('sondage');
    // Le sondage attend au moins le pas (et Retry-After) : jamais en rafale.
    const prochaine = minuteries.filter(m => m.ms >= 15_000).pop();
    expect(prochaine).toBeDefined();
    prochaine!.f();
    await pause(10);
    expect(actions).toEqual(['flux', 'attendre', 'evenements']);
    expect(lots.flatMap(l => l.messages).map(m => m.id)).toEqual([9]);
    expect(etats).toContain('sondage');
    e.arreter();
  });

  it('flux retenu par un mandataire (pas de « bonjour » en 4 s) → attente longue tout de suite', async () => {
    const actions: string[] = [];
    let attenteFaite = false;
    const requete = (async (url: string, init?: RequestInit) => {
      const action = /temps-reel\/([a-z]+)/.exec(url)![1];
      actions.push(action);
      if (action === 'flux') return fluxSimule(init?.signal ?? undefined).reponse; // rien ne passe
      if (!attenteFaite) {
        attenteFaite = true;
        return json({ evenements: [{ type: 'maj', id: 3, sujet: 'trombi' }], dernierId: 3, mode: 'sse' });
      }
      return new Promise<Response>(() => undefined);
    }) as unknown as typeof fetch;
    const { e, lots, curseur } = ecouteur(requete, { delaiBonjourMs: 30 });
    e.demarrer();
    await pause(80);
    expect(actions.slice(0, 2)).toEqual(['flux', 'attendre']);
    expect(lots.flatMap(l => l.messages).map(m => m.sujet)).toEqual(['trombi']);
    expect(curseur()).toBe(3);
    // L'attente suivante repart du curseur.
    expect(actions[2]).toBe('attendre');
    e.arreter();
  });

  it('reprise : après une coupure, le flux rouvre avec le curseur ; erreurs espacées (backoff)', async () => {
    const urls: string[] = [];
    const flux: Array<ReturnType<typeof fluxSimule>> = [];
    const requete = (async (url: string, init?: RequestInit) => {
      urls.push(url);
      const f = fluxSimule(init?.signal ?? undefined);
      flux.push(f);
      setTimeout(() => f.pousser('event: bonjour\ndata: {"dernierId":10}\n\n'), 0);
      return f.reponse;
    }) as unknown as typeof fetch;
    const pauses: number[] = [];
    const { e } = ecouteur(requete, {
      minuteries: {
        setTimeout: (f, ms) => {
          if (ms >= 1_000 && ms < 4_000) pauses.push(ms);
          return setTimeout(f, ms >= 1_000 && ms < 4_000 ? 1 : ms);
        },
        clearTimeout: id => clearTimeout(id as ReturnType<typeof setTimeout>),
        setInterval: () => 0,
        clearInterval: () => undefined,
      },
    });
    e.demarrer();
    await pause(10);
    flux[0].pousser('id: 12\nevent: maj\ndata: {"type":"maj","id":12,"sujet":"cm"}\n\n');
    await pause(5);
    flux[0].fermer(); // coupure (réseau) avant 30 s : comptée comme une erreur
    await pause(20);
    expect(urls[1]).toMatch(/depuis=12/);
    expect(pauses[0]).toBeGreaterThanOrEqual(1_000);
    e.arreter();
  });
});

describe('Client : « le premier qui enregistre a la main »', () => {
  it('X-Version-Lue part avec la modification de l’objet ouvert ; X-Version-Objet notée ; 409 lisible', async () => {
    const vus: Array<{ url: string; entetes: Record<string, string> }> = [];
    let conflit = false;
    const requete = (async (url: string, init?: RequestInit) => {
      vus.push({ url, entetes: { ...(init?.headers as Record<string, string>) } });
      if (url.endsWith('/session')) return json({ session: 'es1.s', expire: new Date(Date.now() + 3_600_000).toISOString(), fonctions: ['temps-reel'] });
      if (conflit) return json({ erreur: 'Quelqu’un a enregistré cet élément entre-temps : vos modifications n’ont pas été enregistrées (rien n’a été écrasé).', code: 'conflit-version', details: { version: 5, par: { compte: 'c', pseudo: 'Clara' }, le: '2026-11-03T10:00:00.000Z' } }, 409);
      return json({ ok: true }, 200, { 'X-Version-Objet': '4' });
    }) as unknown as typeof fetch;
    const client = clientEsport({ adresse: 'https://esport.verrou', jetonRelais: 'jeton' }, requete as never);
    expect(await client.tempsReelDisponible!()).toBe(true);
    noterVersionLue('https://esport.verrou', '/cm/cartes/c1', 3);
    await client.requete('/cm/cartes/c1', 'PATCH', { titre: 'a' });
    expect(vus.at(-1)!.entetes['X-Version-Lue']).toBe('3');
    expect(versionLue('https://esport.verrou', '/cm/cartes/c1')).toBe(4);
    // Une autre route (commentaire) ne porte pas l'en-tête.
    await client.requete('/cm/cartes/c1/commentaires', 'POST', { texte: 'x' });
    expect(vus.at(-1)!.entetes['X-Version-Lue']).toBeUndefined();
    conflit = true;
    const e = await client.requete('/cm/cartes/c1', 'PATCH', { titre: 'b' }).catch(x => x);
    expect(e).toBeInstanceOf(ErreurEsport);
    expect((e as ErreurEsport).code).toBe('conflit-version');
    expect((e as ErreurEsport).details).toMatchObject({ par: { pseudo: 'Clara' } });
    noterVersionLue('https://esport.verrou', '/cm/cartes/c1', undefined);
  });

  it('sujets : `team:x:*` couvre toute la team, `cm` seulement la section', () => {
    expect(concerne('team:x:*', { type: 'maj', sujet: 'team:x:planning' })).toBe(true);
    expect(concerne('team:x:*', { type: 'maj', sujet: 'team:x' })).toBe(true);
    expect(concerne('team:x:*', { type: 'maj', sujet: 'team:xy:planning' })).toBe(false);
    expect(concerne('cm', { type: 'maj', sujet: 'cm:drive' })).toBe(false);
    expect(concerne(['cm', 'compte'], { type: 'maj', sujet: 'compte' })).toBe(true);
  });
});

describe('Bandeau de conflit et présence', () => {
  beforeEach(() => definirLangue('fr'));
  const verrou = (extra: Partial<VerrouOptimiste> = {}): VerrouOptimiste => ({
    version: 2,
    distant: undefined,
    conflit: undefined,
    presences: [],
    signalerConflit: () => false,
    recharger: jest.fn(async () => undefined),
    ignorer: jest.fn(),
    ...extra,
  });

  it('conflit : qui, quand, rien d’écrasé ; Recharger relit ; Copier mes modifications', async () => {
    const v = verrou({ conflit: { pseudo: 'Clara', le: Date.now() - 12_000, supprime: false, version: 5 } });
    const recharger = jest.fn();
    const ecrit: string[] = [];
    (globalThis as { navigator?: unknown }).navigator = { clipboard: { writeText: async (t: string) => void ecrit.push(t) } };
    await render(<BandeauConflit theme={theme} verrou={v} onRecharger={recharger} mesModifications={{ titre: 'Mon titre' }} chargerServeur={async () => ({ titre: 'Son titre' })} />);
    expect(screen.getByText('Pas enregistré : Clara a modifié cet élément il y a 12 s.')).toBeTruthy();
    expect(screen.getByText(/Rien n’a été écrasé/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-conflit-copier'));
    await waitFor(() => expect(ecrit).toEqual(['titre : Mon titre']));
    await fireEvent.press(screen.getByTestId('esport-conflit-difference'));
    await waitFor(() => expect(screen.getByText('Version enregistrée : Son titre')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('esport-conflit-recharger'));
    await waitFor(() => expect(v.recharger).toHaveBeenCalled());
    expect(recharger).toHaveBeenCalled();
  });

  it('changement distant (avant d’enregistrer) et pastille « en train de modifier » ; anglais', async () => {
    const v = verrou({ distant: { pseudo: 'Kai', le: Date.now(), supprime: false } });
    const { rerender } = await render(<BandeauConflit theme={theme} verrou={v} onRecharger={() => undefined} />);
    expect(screen.getByText('Kai a modifié cet élément à l’instant.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-conflit-ignorer'));
    expect(v.ignorer).toHaveBeenCalled();
    await rerender(<PastillePresence theme={theme} presences={[{ compte: 'a', pseudo: 'Léa' }]} />);
    expect(screen.getByText('Léa est en train de modifier')).toBeTruthy();
    definirLangue('en');
    await rerender(<PastillePresence theme={theme} presences={[{ compte: 'a', pseudo: 'Léa' }, { compte: 'b', pseudo: 'Kai' }]} />);
    expect(screen.getByText('Léa and 1 other person are editing')).toBeTruthy();
  });
});

describe('Jamais de vrai réseau en test (CI : réseau sortant ouvert)', () => {
  afterEach(() => {
    fabriqueCanal.actifEnTest = false;
    oublierCanaux();
  });

  it('sous Jest : aucun canal par défaut (les écrans gardent leur relecture, rien ne reste ouvert)', () => {
    const client = clientEsport({ adresse: 'https://esport.appdashboard.fr', jetonRelais: 'j' }, (async () => {
      throw new Error('réseau interdit');
    }) as never);
    expect(canalPour(client)).toBeUndefined();
  });

  it('activé : le canal passe par le fetch DU CLIENT (faux serveur SSE qui ne ferme jamais), jamais par le fetch global ; fermé = coupé', async () => {
    fabriqueCanal.actifEnTest = true;
    const globalAvant = globalThis.fetch;
    const globalAppele = jest.fn();
    globalThis.fetch = globalAppele as never;
    const flux: Array<ReturnType<typeof fluxSimule>> = [];
    const requete = (async (url: string, init?: RequestInit) => {
      if (url.endsWith('/session')) return json({ session: 'es1.s', expire: new Date(Date.now() + 3_600_000).toISOString(), fonctions: ['temps-reel'] });
      const f = fluxSimule(init?.signal ?? undefined);
      flux.push(f);
      setTimeout(() => f.pousser('event: bonjour\ndata: {"dernierId":1}\n\n'), 0);
      return f.reponse;
    }) as unknown as typeof fetch;
    try {
      const client = clientEsport({ adresse: 'https://esport.ouvert', jetonRelais: 'j2' }, requete as never);
      const e = canalPour(client)!;
      expect(await e.disponible).toBe(true);
      const arreter = e.canal.ecouter(() => undefined);
      await pause(20);
      expect(flux).toHaveLength(1);
      expect(flux[0].ouvert).toBe(true);
      expect(globalAppele).not.toHaveBeenCalled();
      arreter();
      await pause(10);
      expect(flux[0].ouvert).toBe(false);
    } finally {
      globalThis.fetch = globalAvant;
    }
  });
});
