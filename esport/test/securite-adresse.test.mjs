/**
 * Sécurité (docs/securite.md) : l'adresse du navigateur transmise au relais est prouvée par HMAC (clé partagée du
 * même hébergement, créée par le relais), et l'adresse du client n'est jamais prise dans la première entrée de
 * X-Forwarded-For.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verificateurRelais } from '../noyau/authentification.mjs';
import { lireCleAdresse, ipClient } from '../serveur/commun.mjs';
import { relais, jetonDeProfil } from '../../relais/relais.mjs';

const JETON = 'jeton-maitre-de-test-adresse-0123456789';

test('clé de preuve : créée une fois (droits 600), relue ensuite ; la variable d’environnement la remplace', () => {
  const fichier = join(mkdtempSync(join(tmpdir(), 'cle-adr-')), 'sous', 'adresse-relais.cle');
  assert.equal(lireCleAdresse({ env: {}, fichier }), '');
  const cle = lireCleAdresse({ env: {}, fichier, creer: true });
  assert.ok(cle.length >= 32);
  assert.equal(statSync(fichier).mode & 0o777, 0o600);
  assert.equal(lireCleAdresse({ env: {}, fichier, creer: true }), cle);
  assert.equal(readFileSync(fichier, 'utf8').trim(), cle);
  assert.equal(lireCleAdresse({ env: { CLE_ADRESSE_RELAIS: 'x'.repeat(40) }, fichier }), 'x'.repeat(40));
});

test('Esport → relais : adresse du navigateur prouvée, acceptée par le relais ; sans clé, rien d’annoncé', async () => {
  const CLE = 'c'.repeat(43);
  const vues = [];
  const liaison = {
    fetch: async (url, init) => {
      vues.push(init.headers);
      // Le relais voit la connexion du serveur Esport (même adresse pour tous les navigateurs).
      const h = { ...init.headers, 'X-Adresse-Client': '203.0.113.1' };
      return relais.traiter(new Request(url, { ...init, headers: h }), { JETON, BOITE: kvMemoire(), CLE_ADRESSE: CLE });
    },
  };
  const ami = await jetonDeProfil(JETON, 'ami12345');
  assert.deepEqual(await verificateurRelais({ liaison, cleAdresse: () => CLE })(ami, '198.51.100.20'), { compte: 'ami12345', superAdmin: false });
  assert.equal(vues[0]['X-Adresse-Navigateur'], '198.51.100.20');
  assert.match(vues[0]['X-Adresse-Preuve'], /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(vues[0]).includes(CLE), 'la clé ne voyage pas');
  await verificateurRelais({ liaison })(ami, '198.51.100.21');
  assert.equal(vues[1]['X-Adresse-Preuve'], undefined);
});

test('adresse du client côté serveur Node : dernière entrée de X-Forwarded-For', () => {
  assert.equal(ipClient({ headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }, socket: {} }), '2.2.2.2');
});

function kvMemoire() {
  const d = new Map();
  return { get: async c => d.get(c) ?? null, put: async (c, v) => void d.set(c, v), delete: async c => void d.delete(c), list: async () => ({ keys: [] }) };
}
