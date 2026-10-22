/**
 * Script d'enregistrement des commandes du bot (esport/outils/discord-commandes.mjs),
 * sans réseau : rien sans jeton, appels attendus, jeton jamais affiché, identité.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appelsDiscord, executer } from '../outils/discord-commandes.mjs';

const identite = JSON.parse(readFileSync(new URL('../../docs/esport/bot/identite.json', import.meta.url), 'utf8'));

test('enregistrement : sans identifiant ni jeton, rien n’est envoyé et le workflow continue', async () => {
  const lignes = [];
  const r = await executer({ env: {}, args: [], fetch: () => assert.fail('aucun réseau'), journal: l => lignes.push(l) });
  assert.equal(r.fait, false);
  assert.match(lignes[0], /étape facultative/);
});

test('enregistrement : commandes (PUT), adresse des interactions, identité ; le jeton n’apparaît jamais', async () => {
  const appels = [];
  const lignes = [];
  const jeton = 'jeton-secret-du-bot';
  const fetch = async (url, init) => {
    appels.push({ url, methode: init.method, corps: JSON.parse(init.body), auth: init.headers.Authorization });
    return appels.length === 1 ? new Response('[]', { status: 200 }) : new Response(`{"message":"refus ${jeton}"}`, { status: 400 });
  };
  const r = await executer({ env: { DISCORD_APPLICATION_ID: '424242424242424242', DISCORD_BOT_TOKEN: jeton }, args: ['--adresse', 'https://esport.exemple.fr/'], fetch, journal: (...l) => lignes.push(l.join(' ')) });
  assert.equal(appels[0].url, 'https://discord.com/api/v10/applications/424242424242424242/commands');
  assert.equal(appels[0].methode, 'PUT');
  assert.equal(appels[0].auth, `Bot ${jeton}`);
  assert.ok(appels[0].corps.some(c => c.name === 'rsvp'));
  assert.deepEqual(appels[1].corps, { interactions_endpoint_url: 'https://esport.exemple.fr/discord/interactions' });
  assert.equal(r.erreurs, 1);
  assert.ok(!lignes.join('\n').includes(jeton), 'jeton masqué dans les messages');
  // Identité : description, icône et bannière de l'application, avatar et bannière du bot.
  const a = appelsDiscord({ applicationId: '1', identite, avecIdentite: true, images: { avatar: 'data:image/png;base64,AA', banniere: 'data:image/png;base64,BB' } });
  assert.deepEqual(a.map(x => `${x.methode} ${x.chemin}`), ['PUT /applications/1/commands', 'PATCH /applications/@me', 'PATCH /users/@me']);
  assert.deepEqual(Object.keys(a[1].corps), ['description', 'icon', 'cover_image']);
  assert.deepEqual(a[2].corps, { avatar: 'data:image/png;base64,AA', banner: 'data:image/png;base64,BB' });
  assert.ok(identite.aPropos.length <= 190, 'À propos : 190 caractères au plus');
  assert.ok(identite.description.length <= 400);
});
