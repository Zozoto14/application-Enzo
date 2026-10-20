/**
 * Infrastructure : migrations versionnées, adaptateur D1 et entrée du Worker
 * (sur un faux D1 bâti sur node:sqlite, même API que Cloudflare), graines,
 * export/import en ligne de commande, serveur local.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import relais, { jetonDeProfil } from '../../relais/worker.mjs';
import { baseSqlite, baseSqliteMigree, lireMigrations } from '../adaptateurs/sqlite.mjs';
import { stockageDisque, stockageMemoire } from '../adaptateurs/stockage.mjs';
import { appliquerMigrations } from '../noyau/migrations.mjs';
import { exporterBase } from '../noyau/transfert.mjs';
import { COMPTES_GRAINES, semer } from '../outils/graines.mjs';
import { demarrerServeurEsport } from '../outils/serveur-local.mjs';
import { principal as transfert } from '../outils/transfert.mjs';
import worker from '../worker.mjs';
import { kvMemoire } from './aide.mjs';

/** Faux D1 : prepare/bind/all/first/run/batch/exec, comme l'API Cloudflare. */
function fauxD1() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const instruction = (sql, params = []) => ({
    bind: (...p) => instruction(sql, p),
    all: async () => ({ results: db.prepare(sql).all(...params).map(l => ({ ...l })) }),
    first: async () => {
      const l = db.prepare(sql).get(...params);
      return l ? { ...l } : null;
    },
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...params).changes) } }),
    _executer: () => ({ meta: { changes: Number(db.prepare(sql).run(...params).changes) } }),
  });
  return {
    prepare: sql => instruction(sql),
    batch: async liste => {
      db.exec('BEGIN');
      try {
        const r = liste.map(i => i._executer());
        db.exec('COMMIT');
        return r;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    exec: async sql => db.exec(sql),
    db,
  };
}

test('migrations : fichiers NNNN_nom.sql, appliquées une seule fois, schéma complet', async () => {
  const migrations = lireMigrations();
  assert.ok(migrations.length >= 1);
  assert.equal(migrations[0].nom, '0001_fondations.sql');
  for (const { sql } of migrations) {
    // SQL standard : rien de propre à D1/SQLite (AUTOINCREMENT, datetime(), strftime, json_…, PRAGMA, WITHOUT ROWID).
    assert.doesNotMatch(sql, /AUTOINCREMENT|datetime\(|strftime|json_|PRAGMA|WITHOUT ROWID|INSERT OR /i);
  }
  const base = await baseSqlite();
  // Toutes les migrations du dossier, dans l'ordre des noms (les numéros peuvent avoir des trous).
  assert.deepEqual(await appliquerMigrations(base, migrations), migrations.map(m => m.nom).sort());
  assert.deepEqual(await appliquerMigrations(base, migrations), []);
  const tables = (await base.tous("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name", [])).map(l => l.name);
  for (const t of ['comptes', 'teams', 'team_modules', 'roles', 'role_permissions', 'membres', 'invitations', 'tentatives', 'evenements', 'journal', 'notifications', 'types_reunion', 'fichiers', 'reunions', 'objectifs', 'taches', 'planning_evenements', 'planning_exceptions', 'presences', 'dispo_regles', 'dispo_exceptions', 'ical_jetons']) {
    assert.ok(tables.includes(t), t);
  }
});

test('lot atomique : une instruction en échec annule tout le lot', async () => {
  const base = await baseSqliteMigree();
  const date = new Date().toISOString();
  await assert.rejects(
    base.lot([
      { sql: 'INSERT INTO comptes (id, pseudo, pseudo_cle, cree_le, maj_le) VALUES (?, ?, ?, ?, ?)', params: ['abc12345', 'A', 'a', date, date] },
      { sql: 'INSERT INTO comptes (id, pseudo, pseudo_cle, cree_le, maj_le) VALUES (?, ?, ?, ?, ?)', params: ['abc12345', 'B', 'b', date, date] },
    ]),
  );
  assert.equal(await base.premier('SELECT * FROM comptes', []), null);
});

test('Worker Cloudflare (entrée worker.mjs + adaptateur D1) : session par la liaison RELAIS, team, journal, cron', async () => {
  const d1 = fauxD1();
  for (const { sql } of lireMigrations()) d1.db.exec(sql);
  const JETON = 'jeton-maitre-worker-esport-0123456789';
  const envRelais = { JETON, BOITE: kvMemoire() };
  const env = {
    BASE: d1,
    FICHIERS: undefined,
    CLE_ESPORT: 'cle-esport-du-worker-de-test-0123456789abcdef',
    RELAIS: { fetch: (url, init) => relais.fetch(new Request(url, init), envRelais) },
  };
  const attentes = [];
  const ctx = { waitUntil: p => attentes.push(p) };
  const appel = async (chemin, { methode = 'GET', jeton, corps } = {}) => {
    const r = await worker.fetch(new Request(`https://esport.test${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) }, body: corps ? JSON.stringify(corps) : undefined }), env, ctx);
    await Promise.all(attentes.splice(0));
    return { statut: r.status, corps: await r.json() };
  };
  const s = (await appel('/session', { methode: 'POST', jeton: JETON })).corps.session;
  assert.equal((await appel('/moi', { methode: 'PUT', jeton: s, corps: { pseudo: 'Fondateur' } })).statut, 200);
  const team = await appel('/teams', { methode: 'POST', jeton: s, corps: { nom: 'Team Worker', preset: 'minimal' } });
  assert.equal(team.statut, 200);
  const journal = await appel(`/teams/${team.corps.team.id}/journal`, { jeton: s });
  assert.deepEqual(journal.corps.entrees.map(e => e.action), ['team.created']);
  // Ami : jeton de profil → session de son compte, pas super admin.
  const lea = await appel('/session', { methode: 'POST', jeton: await jetonDeProfil(JETON, 'lea12345') });
  assert.equal(lea.corps.compte, 'lea12345');
  assert.equal(lea.corps.superAdmin, false);
  assert.equal((await appel(`/teams/${team.corps.team.id}`, { jeton: lea.corps.session })).statut, 404);
  // Sans D1 : réponse claire, pas de plantage.
  const r = await worker.fetch(new Request('https://esport.test/sante'), {}, ctx);
  assert.equal(r.status, 503);
  // Cron : distribue ce qui reste.
  d1.db.prepare("INSERT INTO evenements (id, type, team_id, acteur_id, charge, cree_le, essais) VALUES ('e1', 'team.updated', ?, 'principal', '{}', ?, 0)").run(team.corps.team.id, new Date().toISOString());
  await worker.scheduled({}, env, ctx);
  await Promise.all(attentes.splice(0));
  assert.ok(d1.db.prepare("SELECT traite_le FROM evenements WHERE id = 'e1'").get().traite_le);
});

test('graines : une team Valorant complète avec ses membres et rôles', async () => {
  const base = await baseSqliteMigree();
  const id = await semer(base);
  const membres = await base.tous('SELECT c.pseudo, r.nom AS role, m.poste_jeu FROM membres m JOIN comptes c ON c.id = m.compte_id JOIN roles r ON r.id = m.role_id WHERE m.team_id = ?', [id]);
  assert.equal(membres.length, COMPTES_GRAINES.length + 1);
  assert.ok(membres.some(m => m.pseudo === 'Léa' && m.role === 'Joueur' && m.poste_jeu === 'Duelliste'));
  assert.ok(membres.some(m => m.pseudo === 'Fondateur' && m.role === 'Propriétaire'));
  const roles = await base.tous('SELECT nom FROM roles WHERE team_id = ?', [id]);
  assert.ok(roles.some(r => r.nom === 'Capitaine'));
  const modules = await base.tous('SELECT module FROM team_modules WHERE team_id = ? AND active = 1', [id]);
  assert.equal(modules.length, 11);
  // Planning : des événements (dont une série), des disponibilités, des présences marquées.
  const evenements = await base.tous('SELECT type, recurrence FROM planning_evenements WHERE team_id = ?', [id]);
  assert.deepEqual([...new Set(evenements.map(e => e.type))].sort(), ['match', 'meeting', 'other', 'scrim', 'tournament', 'training']);
  assert.ok(evenements.some(e => e.recurrence));
  assert.ok(Number((await base.premier("SELECT COUNT(*) AS n FROM presences WHERE team_id = ? AND reel <> 'inconnu'", [id])).n) >= 10);
  assert.ok(Number((await base.premier('SELECT COUNT(*) AS n FROM dispo_regles WHERE team_id = ?', [id])).n) >= 10);
  // Phase 3 : dépôts de réunion et tâches (sans stockage : pas de PDF).
  const statuts = (await base.tous('SELECT statut FROM reunions WHERE team_id = ? ORDER BY statut', [id])).map(l => l.statut);
  assert.deepEqual(statuts, ['a_resumer', 'a_resumer', 'en_cours']);
  assert.equal((await base.tous('SELECT id FROM taches WHERE team_id = ?', [id])).length, 4);
  assert.equal((await base.tous('SELECT id FROM objectifs WHERE team_id = ?', [id])).length, 2);
});

test('graines avec stockage : un résumé terminé avec son PDF ; stockage sur disque', async () => {
  const base = await baseSqliteMigree();
  const dossier = mkdtempSync(join(tmpdir(), 'esport-fichiers-'));
  const st = await stockageDisque(dossier);
  const id = await semer(base, { stockage: st });
  const fait = await base.premier("SELECT r.titre, f.cle_stockage, f.nom_original FROM reunions r JOIN fichiers f ON f.id = r.fichier_id WHERE r.team_id = ? AND r.statut = 'termine'", [id]);
  assert.equal(fait.titre, 'Bilan du mois');
  assert.equal(fait.nom_original, 'Bilan du mois.pdf');
  const lu = await st.lire(fait.cle_stockage);
  assert.equal(new TextDecoder().decode(lu.octets.slice(0, 5)), '%PDF-');
  assert.equal(lu.type, 'application/pdf');
  await st.supprimer(fait.cle_stockage);
  assert.equal(await st.lire(fait.cle_stockage), null);
  await assert.rejects(st.deposer('../evasion', new Uint8Array([1])));
});

test('transfert en ligne de commande : export SQLite → import SQLite neuve, identique', async () => {
  const dossier = mkdtempSync(join(tmpdir(), 'esport-transfert-'));
  const source = join(dossier, 'source.db');
  const cible = join(dossier, 'cible.db');
  const fichier = join(dossier, 'export.json');
  const base = await baseSqliteMigree(source);
  await semer(base);
  base.fermer();
  const journal = console.log;
  console.log = () => {};
  try {
    await transfert(['exporter', '--sqlite', source, '--sortie', fichier]);
    await transfert(['importer', '--sqlite', cible, '--entree', fichier]);
    await assert.rejects(transfert(['importer', '--sqlite', cible, '--entree', fichier]), /pas vide/);
  } finally {
    console.log = journal;
  }
  const exporte = JSON.parse(readFileSync(fichier, 'utf8'));
  const relu = await exporterBase(await baseSqliteMigree(cible), Date.parse(exporte.exporteLe));
  assert.deepEqual(relu, exporte);
});

test('serveur local : HTTP, graines, relais de développement', async () => {
  const s = await demarrerServeurEsport({ port: 18790, graines: true, jetonDev: 'jeton-dev-serveur-local-0123456789' });
  try {
    const sante = await (await fetch(`${s.url}/sante`)).json();
    assert.equal(sante.service, 'esport');
    const lea = await jetonDeProfil('jeton-dev-serveur-local-0123456789', 'lea12345');
    const sess = await (await fetch(`${s.url}/session`, { method: 'POST', headers: { Authorization: `Bearer ${lea}` } })).json();
    const teams = await (await fetch(`${s.url}/teams`, { headers: { Authorization: `Bearer ${sess.session}` } })).json();
    assert.deepEqual(teams.teams.map(t => t.nom), ['Faucons Valorant']);
    assert.equal(teams.teams[0].role.nom, 'Joueur');
  } finally {
    await s.fermer();
  }
});

test('stockage mémoire (interface des fichiers) : dépôt, lecture, suppression, clés sûres', async () => {
  const st = stockageMemoire();
  await st.deposer('teams/a/resume.pdf', new Uint8Array([1, 2, 3]), { type: 'application/pdf' });
  assert.deepEqual([...(await st.lire('teams/a/resume.pdf')).octets], [1, 2, 3]);
  await st.supprimer('teams/a/resume.pdf');
  assert.equal(await st.lire('teams/a/resume.pdf'), null);
  await assert.rejects(st.deposer('../evasion', new Uint8Array()));
});
