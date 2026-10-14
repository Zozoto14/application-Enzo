/**
 * Essais des appels réseau de Tâches (IA, GitHub) contre un faux `fetch`.
 *
 *   node --test bureau/electron/tachesReseau.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appelerClaude, lireGithub, URL_API_CLAUDE } from './tachesReseau.mjs';

const CLE = 'sk-ant-api03-' + 'a'.repeat(40);
const demande = { cle: CLE, modele: 'claude-sonnet-5-5', systeme: 'Consignes', message: '<donnees>x</donnees>', schema: { type: 'object' }, maxTokens: 4000 };

function fauxFetch(reponse, statut = 200) {
  const appels = [];
  const f = async (url, init) => {
    appels.push({ url, init });
    return { ok: statut >= 200 && statut < 300, status: statut, json: async () => reponse, text: async () => JSON.stringify(reponse) };
  };
  return { f, appels };
}

test('IA : requête vers l’API Claude (clé dans l’en-tête, sortie structurée, repli serveur)', async () => {
  const { f, appels } = fauxFetch({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"sousTaches":[{"titre":"A"}]}' }] });
  const r = await appelerClaude(demande, f);
  assert.deepEqual(r, { ok: true, json: { sousTaches: [{ titre: 'A' }] } });
  assert.equal(appels[0].url, URL_API_CLAUDE);
  const h = appels[0].init.headers;
  assert.equal(h['x-api-key'], CLE);
  assert.equal(h['anthropic-version'], '2023-06-01');
  assert.equal(h['anthropic-beta'], 'server-side-fallback-2026-07-01');
  const corps = JSON.parse(appels[0].init.body);
  assert.equal(corps.model, 'claude-sonnet-5-5');
  assert.equal(corps.fallbacks, 'default');
  assert.deepEqual(corps.output_config, { format: { type: 'json_schema', schema: { type: 'object' } } });
  assert.equal(corps.messages[0].content, '<donnees>x</donnees>');
  assert.ok(!JSON.stringify(corps).includes(CLE), 'la clé n’est pas dans le corps');
});

test('IA : un autre modèle n’a pas le repli ; refus, réponse coupée et erreurs lisibles', async () => {
  const { f, appels } = fauxFetch({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }] });
  await appelerClaude({ ...demande, modele: 'claude-haiku-5-5' }, f);
  assert.equal(appels[0].init.headers['anthropic-beta'], undefined);
  assert.equal(JSON.parse(appels[0].init.body).fallbacks, undefined);
  assert.match((await appelerClaude(demande, fauxFetch({ stop_reason: 'refusal', content: [] }).f)).erreur, /refusé/);
  assert.match((await appelerClaude(demande, fauxFetch({ stop_reason: 'max_tokens', content: [] }).f)).erreur, /coupée/);
  assert.match((await appelerClaude(demande, fauxFetch({ error: { type: 'authentication_error' } }, 401).f)).erreur, /refusée/);
  assert.match((await appelerClaude(demande, fauxFetch({}, 529).f)).erreur, /surchargée/);
  assert.match((await appelerClaude(demande, fauxFetch({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'pas du json' }] }).f)).erreur, /illisible/);
});

test('IA : demandes invalides refusées avant tout envoi', async () => {
  const { f, appels } = fauxFetch({});
  assert.equal((await appelerClaude({ ...demande, cle: 'abc' }, f)).ok, false);
  assert.equal((await appelerClaude({ ...demande, modele: 'gpt-4' }, f)).ok, false);
  assert.equal((await appelerClaude({ ...demande, message: 'x'.repeat(70_000) }, f)).ok, false);
  assert.equal(appels.length, 0);
});

test('GitHub : liste fermée de chemins, jeton en en-tête, lecture seule', async () => {
  const { f, appels } = fauxFetch({ number: 3, merged: true });
  const jeton = 'github_pat_' + 'b'.repeat(40);
  const r = await lireGithub({ chemin: '/repos/zozoto14/tsuzuku/pulls/3', jeton }, f);
  assert.equal(r.statut, 200);
  assert.deepEqual(r.json, { number: 3, merged: true });
  assert.equal(appels[0].url, 'https://api.github.com/repos/zozoto14/tsuzuku/pulls/3');
  assert.equal(appels[0].init.method, 'GET');
  assert.equal(appels[0].init.headers.authorization, `Bearer ${jeton}`);
  for (const chemin of ['/user', '/repos/a/b/issues', 'https://evil.example/x', '/repos/a/b/pulls/3/merge', '/repos/a/b/../../user']) {
    assert.equal((await lireGithub({ chemin, jeton }, f)).erreur, 'Adresse GitHub refusée.', chemin);
  }
  assert.equal((await lireGithub({ chemin: '/repos/a/b', jeton: 'mauvais' }, f)).erreur, 'Jeton GitHub invalide.');
  assert.equal(appels.length, 1);
});
