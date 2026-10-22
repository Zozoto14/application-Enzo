/**
 * Relais sur hébergement mutualisé : un PUT/DELETE refusé (400, 405, 411, 501) OU coupé en route
 * (erreur réseau : préliminaire CORS ou méthode bloqués par le frontal) est rejoué une fois en
 * POST + `X-Methode` ; un relais où ce repli a marché reçoit ensuite directement des POST.
 */

import { appeler, oublierRelaisEnSurcharge, relaisEnSurchargeConnu } from './synchroniser';
import { publierThemePublic } from './connexionAmis';

type Vu = { url: string; method: string; methode?: string };

function faux(repondre: (v: Vu) => number | 'reseau') {
  const vus: Vu[] = [];
  const requete = (async (url: string, init: RequestInit = {}) => {
    const entetes = (init.headers ?? {}) as Record<string, string>;
    const v = { url, method: init.method ?? 'GET', methode: entetes['X-Methode'] };
    vus.push(v);
    const r = repondre(v);
    if (r === 'reseau') throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify({ ok: r < 300 }), { status: r, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { vus, requete };
}

const liaison = { relais: 'https://relais.test', jeton: 'j' };

describe('relais : repli POST + X-Methode', () => {
  beforeEach(() => oublierRelaisEnSurcharge());

  it('PUT coupé en route (erreur réseau) : rejoué en POST + X-Methode, puis POST direct', async () => {
    const f = faux(v => (v.method === 'PUT' || v.method === 'DELETE' ? 'reseau' : 200));
    const r = await appeler(liaison, '/boite/a', { methode: 'PUT', corps: '{}' }, f.requete);
    expect(r.status).toBe(200);
    expect(f.vus.map(v => `${v.method} ${v.methode ?? '-'}`)).toEqual(['PUT -', 'POST PUT']);
    expect(relaisEnSurchargeConnu(liaison.relais)).toBe(true);
    await appeler(liaison, '/boite/b', { methode: 'DELETE' }, f.requete);
    expect(f.vus.slice(2).map(v => `${v.method} ${v.methode ?? '-'}`)).toEqual(['POST DELETE']);
  });

  it('PUT refusé par un code (405) : rejoué ; vraie panne : erreur d’origine', async () => {
    const f = faux(v => (v.method === 'PUT' ? 405 : 200));
    expect((await appeler(liaison, '/rangs', { methode: 'PUT', corps: '{}' }, f.requete)).status).toBe(200);
    expect(f.vus.map(v => v.method)).toEqual(['PUT', 'POST']);
    oublierRelaisEnSurcharge();
    const panne = faux(() => 'reseau');
    await expect(appeler(liaison, '/boite/a', { methode: 'PUT', corps: '{}' }, panne.requete)).rejects.toThrow(/injoignable/);
    expect(relaisEnSurchargeConnu(liaison.relais)).toBe(false);
  });

  it('GET et POST ne sont jamais rejoués', async () => {
    const f = faux(() => 'reseau');
    await expect(appeler(liaison, '/heure', {}, f.requete)).rejects.toThrow();
    await expect(appeler(liaison, '/x', { methode: 'POST' }, f.requete)).rejects.toThrow();
    expect(f.vus).toHaveLength(2);
  });

  it('connexion amis (invitations, accès, thème) : même repli sur erreur réseau', async () => {
    const f = faux(v => (v.method === 'PUT' ? 'reseau' : 200));
    await publierThemePublic(liaison, 'h1', 'nuit', f.requete);
    expect(f.vus.map(v => `${v.method} ${v.methode ?? '-'}`)).toEqual(['PUT -', 'POST PUT']);
  });
});
