import { test } from 'node:test';
import assert from 'node:assert/strict';
import relais, { jetonValide } from './worker.mjs';

const JETON = 'jeton-de-test-0123456789abcdef';

function kvMemoire() {
  const donnees = new Map();
  return {
    donnees,
    get: async cle => (donnees.has(cle) ? donnees.get(cle) : null),
    put: async (cle, valeur) => void donnees.set(cle, valeur),
    delete: async cle => void donnees.delete(cle),
  };
}

const appeler = (env, chemin, options = {}) =>
  relais.fetch(
    new Request(`https://relais.test${chemin}`, {
      ...options,
      headers: { Authorization: `Bearer ${JETON}`, ...(options.headers ?? {}) },
    }),
    env,
  );

const enveloppe = (appareil, date = '2026-09-26T10:00:00Z') =>
  JSON.stringify({ format: 'applibourse-relais', version: 1, appareil, date, charge: 'abcd' });

test('refuse sans le bon jeton', async () => {
  const env = { JETON, BOITE: kvMemoire() };
  const sans = await relais.fetch(new Request('https://relais.test/sante'), env);
  assert.equal(sans.status, 401);
  const faux = await appeler(env, '/sante', { headers: { Authorization: 'Bearer autre-jeton-0123456789ab' } });
  assert.equal(faux.status, 401);
  assert.equal((await appeler(env, '/sante')).status, 200);
});

test('un jeton trop court ne vaut rien, même identique', () => {
  assert.equal(jetonValide('court', 'court'), false);
  assert.equal(jetonValide(JETON, JETON), true);
  assert.equal(jetonValide(JETON.slice(0, -1), JETON), false);
});

test('répond au prévol CORS sans jeton', async () => {
  const r = await relais.fetch(new Request('https://relais.test/boite', { method: 'OPTIONS' }), { JETON });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), '*');
});

test('dépose, liste, relit et oublie un appareil', async () => {
  const env = { JETON, BOITE: kvMemoire() };
  assert.equal((await appeler(env, '/boite/pc123456', { method: 'PUT', body: enveloppe('pc123456') })).status, 200);
  assert.equal((await appeler(env, '/boite/ip987654', { method: 'PUT', body: enveloppe('ip987654', '2026-09-27T08:00:00Z') })).status, 200);

  const index = await (await appeler(env, '/boite')).json();
  assert.deepEqual(Object.keys(index.appareils).sort(), ['ip987654', 'pc123456']);
  assert.equal(index.appareils.ip987654.date, '2026-09-27T08:00:00Z');

  const relu = await (await appeler(env, '/boite/pc123456')).json();
  assert.equal(relu.appareil, 'pc123456');

  assert.equal((await appeler(env, '/boite/pc123456', { method: 'DELETE' })).status, 200);
  assert.equal((await appeler(env, '/boite/pc123456')).status, 404);
  assert.deepEqual(Object.keys((await (await appeler(env, '/boite')).json()).appareils), ['ip987654']);
});

test('refuse ce qui n’est pas une enveloppe, ou une enveloppe au mauvais nom', async () => {
  const env = { JETON, BOITE: kvMemoire() };
  assert.equal((await appeler(env, '/boite/pc123456', { method: 'PUT', body: '{"a":1}' })).status, 400);
  assert.equal((await appeler(env, '/boite/pc123456', { method: 'PUT', body: enveloppe('autre123') })).status, 400);
  assert.equal((await appeler(env, '/boite/..%2Fx', { method: 'PUT', body: enveloppe('..%2Fx') })).status, 400);
  assert.equal(env.BOITE.donnees.size, 0);
});

test('la passerelle refuse les adresses hors liste', async () => {
  const env = { JETON, BOITE: kvMemoire() };
  const yahoo = await appeler(env, '/yahoo/json', { method: 'POST', body: JSON.stringify({ url: 'https://evil.example/v8/finance/chart/X' }) });
  assert.equal(yahoo.status, 403);
  const flux = await appeler(env, '/medias/flux', { method: 'POST', body: JSON.stringify({ url: 'https://evil.example/rss' }) });
  assert.equal(flux.status, 403);
  const page = await appeler(env, '/medias/page', { method: 'POST', body: JSON.stringify({ url: 'http://lemonde.fr/x' }) });
  assert.equal(page.status, 403);
});
