/**
 * Essais de la voix naturelle contre un faux service local.
 *
 *   node --test bureau/electron/voix.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { debit, echapper, jetonGec, messageSsml, morceauAudio, synthetiser } from './voix.mjs';

const require = createRequire(import.meta.url);

function trameAudio(octets) {
  const entete = Buffer.from('X-RequestId:1\r\nContent-Type:audio/mpeg\r\nPath:audio\r\n');
  return Buffer.concat([Buffer.from([entete.length >> 8, entete.length & 255]), entete, Buffer.from(octets)]);
}

test('jeton : stable sur cinq minutes, en hexadécimal majuscule', () => {
  const jeton = jetonGec(Date.UTC(2026, 8, 25, 12, 0, 10));
  assert.match(jeton, /^[0-9A-F]{64}$/);
  assert.equal(jetonGec(Date.UTC(2026, 8, 25, 12, 4, 59)), jeton);
  assert.notEqual(jetonGec(Date.UTC(2026, 8, 25, 12, 5, 0)), jeton);
});

test('SSML : texte échappé, voix au nom long, débit', () => {
  assert.equal(echapper(`Pertes & <profits> l'an`), 'Pertes &amp; &lt;profits&gt; l&apos;an');
  assert.equal(debit(1.15), '+15%');
  assert.equal(debit(0.9), '-10%');
  const message = messageSsml('Bonjour', 'fr-FR-DeniseNeural', 1);
  assert.match(message, /Path:ssml\r\n\r\n<speak/);
  assert.match(message, /Microsoft Server Speech Text to Speech Voice \(fr-FR, DeniseNeural\)/);
});

test('ne garde que le son des trames binaires', () => {
  assert.deepEqual([...morceauAudio(trameAudio([1, 2, 3]))], [1, 2, 3]);
  const entete = Buffer.from('Path:audio.metadata\r\n');
  assert.equal(morceauAudio(Buffer.concat([Buffer.from([0, entete.length]), entete])), undefined);
});

test('refuse une voix hors liste', async () => {
  await assert.rejects(synthetiser('Bonjour', 'fr-FR-Inconnue', 1), /Voix inconnue/);
});

test('assemble le MP3 reçu jusqu’à la fin du tour', async t => {
  let ws;
  try {
    ws = require('ws');
  } catch {
    t.skip('paquet ws absent');
    return;
  }
  const http = createServer();
  const serveur = new ws.Server({ server: http });
  const recus = [];
  let entetes;
  serveur.on('connection', (socket, requete) => {
    entetes = requete.headers;
    socket.on('message', message => {
      recus.push(String(message));
      if (String(message).includes('Path:ssml')) {
        socket.send('Path:turn.start\r\n\r\n{}');
        socket.send(trameAudio([0xff, 0xf3]));
        socket.send(trameAudio([0x44]));
        socket.send('X-RequestId:1\r\nPath:turn.end\r\n\r\n{}');
      }
    });
  });
  await new Promise(fin => http.listen(0, fin));
  try {
    const mp3 = await synthetiser('Le CAC 40 monte.', 'fr-FR-VivienneMultilingualNeural', 1.15, {
      adresse: `ws://127.0.0.1:${http.address().port}/v1`,
    });
    assert.deepEqual([...mp3], [0xff, 0xf3, 0x44]);
    assert.equal(entetes.origin, 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold');
    assert.match(recus[0], /Path:speech.config/);
    assert.match(recus[1], /rate='\+15%' volume='\+0%'>Le CAC 40 monte\.<\/prosody>/);
  } finally {
    serveur.close();
    http.close();
  }
});
