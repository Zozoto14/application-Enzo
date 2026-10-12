/**
 * Site : transport de Tsuzuku vers la route `/tsuzuku/requete` du relais. Le
 * jeton est celui de la liaison déjà en place, et SEULEMENT s'il est maître
 * (compte Fondateur relié) : un jeton de profil (ami…) n'appelle jamais la route.
 */

import { definirRelaisActif } from '../src/sync/relais/actif';
import { jetonDeProfil } from '../src/sync/relais/portees';
import { transportTsuzuku } from './web';

const RELAIS = 'https://relais-exemple.fr';
const MAITRE = 'jeton-maitre-de-test-0123456789';

afterEach(() => definirRelaisActif(undefined));

it('jeton maître : disponible, appelle POST /tsuzuku/requete avec le jeton, sans cookie ni cache', async () => {
  definirRelaisActif({ relais: RELAIS, jeton: MAITRE });
  const fetchFn = jest.fn(async () => new Response(JSON.stringify({ status: 200, headers: {}, texte: 'ok' }), { status: 200 }));
  const t = transportTsuzuku(fetchFn as unknown as typeof fetch);
  expect(t.disponible()).toBe(true);
  const r = await t.envoyer({ url: 'https://spa-exemple.fr/', method: 'GET', headers: { accept: 'text/html' } }, 15_000);
  expect(r).toEqual({ statut: 200, json: { status: 200, headers: {}, texte: 'ok' } });
  const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe(`${RELAIS}/tsuzuku/requete`);
  expect(init.method).toBe('POST');
  expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${MAITRE}`);
  expect(init.credentials).toBe('omit');
  expect(init.cache).toBe('no-store');
  expect(JSON.parse(String(init.body))).toEqual({ url: 'https://spa-exemple.fr/', method: 'GET', headers: { accept: 'text/html' } });
});

it('jeton de profil (ami, administrateur…) ou aucun relais : indisponible, aucun appel', async () => {
  const fetchFn = jest.fn();
  const t = transportTsuzuku(fetchFn as unknown as typeof fetch);
  expect(t.disponible()).toBe(false);
  definirRelaisActif({ relais: RELAIS, jeton: jetonDeProfil(MAITRE, 'amilea0001') });
  expect(t.disponible()).toBe(false);
  expect((await t.envoyer({ url: 'https://spa-exemple.fr/', method: 'GET', headers: {} }, 1000)).statut).toBe(403);
  expect(fetchFn).not.toHaveBeenCalled();
});

it('réponse sans JSON (ancien relais, page d’erreur) : le statut seul', async () => {
  definirRelaisActif({ relais: RELAIS, jeton: MAITRE });
  const t = transportTsuzuku((async () => new Response('Not found', { status: 404 })) as unknown as typeof fetch);
  expect(await t.envoyer({ url: 'https://spa-exemple.fr/', method: 'GET', headers: {} }, 1000)).toEqual({ statut: 404, json: null });
});
