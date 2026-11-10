/**
 * Connexions des membres refusées « au hasard » (docs/diagnostic-comptes.md), côté serveur Esport :
 *  - tout un club sur la même adresse (Wi-Fi, 4G CGNAT) ouvre ses sessions sans « Trop de demandes » ;
 *  - SQLite partagé par plusieurs processus (serveur, cron, bot) : une écriture attend la fin de
 *    l'autre au lieu d'échouer aussitôt (« database is locked »).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { banc } from './aide.mjs';
import { SUR_POSTGRES } from './base.mjs';
import { baseSqlite } from '../adaptateurs/sqlite.mjs';

test('club sur une seule adresse : 60 membres ouvrent leur session dans la même minute', async () => {
  const b = await banc();
  const statuts = [];
  for (let i = 0; i < 60; i++) {
    const jeton = await b.jetonDeProfil(`club${String(i).padStart(4, '0')}`);
    statuts.push((await b.appel('/session', { methode: 'POST', jeton, ip: '203.0.113.200' })).statut);
  }
  // Avant : 30 par minute et par adresse, le 31e membre recevait 429.
  assert.deepEqual([...new Set(statuts)], [200]);
});

test('jeton faux répété depuis une adresse : refus 401 (le relais protège), jamais 500', async () => {
  const b = await banc();
  for (let i = 0; i < 5; i++) {
    const r = await b.appel('/session', { methode: 'POST', jeton: `p1.lea12345.${String(i).repeat(64).slice(0, 64)}`, ip: '203.0.113.201' });
    assert.equal(r.statut, 401);
  }
});

test('SQLite fichier partagé : une écriture attend le verrou d’un autre processus au lieu d’échouer', { skip: SUR_POSTGRES }, async () => {
  const dossier = mkdtempSync(join(tmpdir(), 'esport-sqlite-'));
  const fichier = join(dossier, 'esport.db');
  try {
    const base = await baseSqlite(fichier);
    await base.script('CREATE TABLE t (n INTEGER)');
    assert.equal((await base.premier('PRAGMA journal_mode')).journal_mode, 'wal');
    // Un autre « processus » (fil séparé, sa propre connexion) tient le verrou d'écriture 400 ms.
    const autre = new Worker(
      `const { parentPort, workerData } = require('node:worker_threads');
       const { DatabaseSync } = require('node:sqlite');
       const db = new DatabaseSync(workerData);
       db.exec('BEGIN IMMEDIATE'); db.exec('INSERT INTO t VALUES (1)');
       parentPort.postMessage('verrou');
       Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
       db.exec('COMMIT'); db.close(); parentPort.postMessage('fini');`,
      { eval: true, workerData: fichier },
    );
    await new Promise(ok => autre.once('message', ok));
    const debut = Date.now();
    // Avant : SQLITE_BUSY tout de suite (« database is locked »), connexion refusée au hasard.
    await base.executer('INSERT INTO t VALUES (2)');
    assert.ok(Date.now() - debut >= 200, 'a attendu le verrou');
    assert.equal(Number((await base.premier('SELECT COUNT(*) AS n FROM t')).n), 2);
    await new Promise(ok => autre.once('exit', ok));
    base.fermer();
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});
