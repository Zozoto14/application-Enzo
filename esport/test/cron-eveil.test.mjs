/**
 * Cron : garde le serveur Esport et le relais éveillés (GET /sante toutes les 5 minutes), note les réveils lents
 * (démarrage à froid de Passenger). Voir docs/performance.md.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { garderEveilles, SEUIL_EVEIL_LENT_MS } from '../serveur/cron.mjs';

test('appelle /sante des deux serveurs et mesure la durée', async () => {
  const appels = [];
  let t = 0;
  const fetch = async url => {
    appels.push(url);
    t += url.includes('relais') ? SEUIL_EVEIL_LENT_MS + 500 : 40;
    return new Response('{"ok":true}', { status: 200 });
  };
  const r = await garderEveilles({ urlPublique: 'https://esport.exemple.fr/', relais: 'https://relais.exemple.fr' }, { fetch, maintenant: () => t });
  assert.deepEqual(appels.sort(), ['https://esport.exemple.fr/sante', 'https://relais.exemple.fr/sante']);
  assert.ok(r.every(l => l.ok));
  assert.equal(r.find(l => l.tache === 'éveil relais').lent, true);
});

test('sans adresse : rien ; serveur injoignable : échec noté, jamais d’exception', async () => {
  assert.deepEqual(await garderEveilles({}, { fetch: async () => assert.fail('aucun appel') }), []);
  const r = await garderEveilles({ urlPublique: 'https://esport.exemple.fr' }, { fetch: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal(r[0].ok, false);
  assert.match(r[0].erreur, /ECONNREFUSED/);
});
