/**
 * Intégration « comme sur o2switch » : le relais (relais/serveur/app.mjs) et le serveur Esport
 * (esport/serveur/app.mjs) démarrés en VRAI (HTTP), sur PostgreSQL, fichiers sur le disque ; l'Esport
 * fait valider les jetons par le relais en HTTP (RELAIS_URL). On crée une team, on dépose un PDF, on
 * lance le cron ; puis on déménage un « ancien » serveur (SQLite) vers PostgreSQL avec importer.mjs.
 * Lancé par `npm run esport:tester:pg` (sauté sans ESPORT_TEST_PG).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jetonDeProfil } from '../../../relais/worker.mjs';
import { basePostgres } from '../../adaptateurs/postgres.mjs';
import { baseSqliteMigree } from '../../adaptateurs/sqlite.mjs';
import { stockageDisque } from '../../adaptateurs/stockage.mjs';
import { demarrer as demarrerRelais } from '../../../relais/serveur/app.mjs';
import { demarrer as demarrerEsport } from '../../serveur/app.mjs';
import { executerCron } from '../../serveur/cron.mjs';
import { migrer } from '../../serveur/migrer.mjs';
import { principal as importer } from '../../serveur/importer.mjs';

const URL_PG = process.env.ESPORT_TEST_PG;
const options = { skip: URL_PG ? false : 'PostgreSQL absent (ESPORT_TEST_PG)', timeout: 60_000 };
const JETON = 'jeton-maitre-o2switch-de-test-0123456789';
const CLE = 'cle-de-session-esport-o2switch-de-test-0123456789abcdef';
const HEBDO = '00000000-0000-4000-8000-000000000001';
const PDF = new TextEncoder().encode('%PDF-1.7\n% résumé o2switch\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');

async function schemaNeuf() {
  const schema = `t_${randomBytes(8).toString('hex')}`;
  const admin = await basePostgres({ connexion: URL_PG, max: 1 });
  await admin.script(`CREATE SCHEMA ${schema}`);
  await admin.fermer();
  // Même forme que la DATABASE_URL du Fondateur, plus le schéma de test.
  const url = `${URL_PG}${URL_PG.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${schema}`)}`;
  return { schema, url, base: await basePostgres({ connexion: url, max: 4 }) };
}

const configEsport = (relais, dossier, extra = {}) => ({
  cleSession: CLE,
  relais,
  dossierFichiers: dossier,
  creationTeams: 'fondateur',
  lienApp: '',
  discordBot: {},
  baseConfiguree: true,
  ...extra,
});

async function api(url, chemin, { methode = 'GET', jeton, corps, octets, type = 'application/json' } = {}) {
  const headers = { 'Content-Type': octets ? 'application/pdf' : type };
  if (jeton) headers.Authorization = `Bearer ${jeton}`;
  const r = await fetch(`${url}${chemin}`, { method: methode, headers, body: octets ?? (corps === undefined ? undefined : JSON.stringify(corps)) });
  const texte = await r.text();
  return { statut: r.status, entetes: r.headers, corps: (r.headers.get('Content-Type') ?? '').includes('json') && texte ? JSON.parse(texte) : texte };
}

async function sessionFondateur(url) {
  const s = await api(url, '/session', { methode: 'POST', jeton: JETON });
  assert.equal(s.statut, 200, JSON.stringify(s.corps));
  assert.equal(s.corps.superAdmin, true);
  return s.corps.session;
}

test('o2switch : relais + Esport sur PostgreSQL, team, dépôt de PDF, cron', options, async () => {
  const { base } = await schemaNeuf();
  await migrer(base);
  const relais = await demarrerRelais({ port: 0, hote: '127.0.0.1', base, config: { JETON, ORIGINES_SITE: 'https://appdashboard.fr', baseConfiguree: true } });
  const dossier = mkdtempSync(join(tmpdir(), 'esport-o2switch-'));
  const esport = await demarrerEsport({ port: 0, hote: '127.0.0.1', base, config: configEsport(relais.url, dossier) });
  try {
    // Santé des deux serveurs, en-têtes de sécurité et CORS comme sur Cloudflare.
    const sante = await api(esport.url, '/sante');
    assert.equal(sante.statut, 200);
    assert.equal(sante.corps.service, 'esport');
    assert.equal(sante.corps.stockage, true);
    assert.equal(sante.entetes.get('access-control-allow-origin'), '*');
    assert.equal(sante.entetes.get('x-content-type-options'), 'nosniff');
    assert.match(sante.entetes.get('strict-transport-security') ?? '', /max-age=/);
    const pre = await fetch(`${esport.url}/teams`, { method: 'OPTIONS', headers: { Origin: 'https://appdashboard.fr', 'Access-Control-Request-Method': 'POST' } });
    assert.equal(pre.status, 204);
    assert.match(pre.headers.get('access-control-allow-headers') ?? '', /Authorization/);
    assert.equal((await api(relais.url, '/sante', { jeton: JETON })).corps.version >= 8, true);
    // Une IP usurpée (CF-Connecting-IP posé par le client) n'est jamais crue.
    const usurpe = await fetch(`${relais.url}/jeton/verifier`, { method: 'POST', headers: { 'CF-Connecting-IP': '1.2.3.4' }, body: '{}' });
    assert.equal(usurpe.status, 200);

    // Session du Fondateur : jeton maître validé par le relais EN HTTP.
    const f = await sessionFondateur(esport.url);
    assert.equal((await api(esport.url, '/moi', { methode: 'PUT', jeton: f, corps: { pseudo: 'Fondateur' } })).statut, 200);
    // Un ami (jeton de profil p1) : validé aussi ; un jeton révoqué est refusé.
    const lea = await api(esport.url, '/session', { methode: 'POST', jeton: await jetonDeProfil(JETON, 'lea12345') });
    assert.equal(lea.statut, 200);
    assert.equal(lea.corps.compte, 'lea12345');
    assert.equal((await api(relais.url, '/revocations/kai12345', { methode: 'PUT', jeton: JETON })).statut, 200);
    assert.equal((await api(esport.url, '/session', { methode: 'POST', jeton: await jetonDeProfil(JETON, 'kai12345') })).statut, 403);

    // Team.
    const team = await api(esport.url, '/teams', { methode: 'POST', jeton: f, corps: { nom: 'Team o2switch', jeu: 'valorant', preset: 'valorant_complet' } });
    assert.equal(team.statut, 200, JSON.stringify(team.corps));
    const teamId = team.corps.team.id;
    assert.deepEqual((await api(esport.url, '/teams', { jeton: f })).corps.teams.map(t => t.nom), ['Team o2switch']);

    // Dépôt d'une réunion puis de son résumé PDF : fichier sur le disque, hors de tout dossier public.
    const depot = await api(esport.url, `/teams/${teamId}/resumes`, { methode: 'POST', jeton: f, corps: { lien: 'https://youtu.be/abc123', typeId: HEBDO, dateReunion: '2026-10-19', titre: 'Réunion du lundi' } });
    assert.equal(depot.statut, 200, JSON.stringify(depot.corps));
    const envoi = await api(esport.url, `/teams/${teamId}/resumes/${depot.corps.id}/pdf`, { methode: 'PUT', jeton: f, octets: PDF });
    assert.equal(envoi.statut, 200, JSON.stringify(envoi.corps));
    const fichier = await base.premier('SELECT cle_stockage FROM fichiers WHERE team_id = ?', [teamId]);
    assert.ok(existsSync(join(dossier, fichier.cle_stockage)));
    assert.deepEqual(new Uint8Array(readFileSync(join(dossier, fichier.cle_stockage))), PDF);
    // Lecture par l'admin (route du déménagement) : mêmes octets.
    const lu = await fetch(`${esport.url}/admin/fichier?cle=${encodeURIComponent(fichier.cle_stockage)}`, { headers: { Authorization: `Bearer ${f}` } });
    assert.equal(lu.status, 200);
    assert.equal(lu.headers.get('x-type-fichier'), 'application/pdf');
    assert.deepEqual(new Uint8Array(await lu.arrayBuffer()), PDF);
    assert.equal((await api(esport.url, `/admin/fichier?cle=${encodeURIComponent(fichier.cle_stockage)}`, { jeton: lea.corps.session })).statut, 403);

    // Cron (comme la tâche cron cPanel) : toutes les tâches passent.
    await base.executer("INSERT INTO evenements (id, type, team_id, acteur_id, charge, cree_le, essais) VALUES ('e-cron', 'team.updated', ?, 'principal', '{}', ?, 0)", [teamId, new Date().toISOString()]);
    await base.executer("INSERT INTO relais_kv (cle, valeur, expire_le, maj_le) VALUES ('limite:vieille', '{}', 1, 1)", []);
    const rapport = await executerCron(base, { cleSession: CLE, lienApp: '', discordBot: {} });
    assert.deepEqual(rapport.filter(r => !r.ok), []);
    assert.ok((await base.premier("SELECT traite_le FROM evenements WHERE id = 'e-cron'", [])).traite_le);
    assert.equal(await base.premier("SELECT cle FROM relais_kv WHERE cle = 'limite:vieille'", []), null);
    // Journal (lu par l'API) : la création de la team et le dépôt.
    const journal = await api(esport.url, `/teams/${teamId}/journal`, { jeton: f });
    assert.ok(journal.corps.entrees.some(e => e.action === 'team.created'));
  } finally {
    await esport.fermer();
    await relais.fermer();
    await base.fermer();
  }
});

test('o2switch : déménagement d’un ancien serveur (base et fichiers) vers PostgreSQL avec importer.mjs, comptes vérifiés', options, async () => {
  // L'« ancien » serveur : SQLite + fichiers, avec le même relais (comme le Worker Cloudflare).
  const cible = await schemaNeuf();
  const relais = await demarrerRelais({ port: 0, hote: '127.0.0.1', base: cible.base, config: { JETON, baseConfiguree: true } });
  await migrer(cible.base);
  const ancienneBase = await baseSqliteMigree();
  const ancienDossier = mkdtempSync(join(tmpdir(), 'esport-ancien-'));
  // Comme le Worker en LECTURE_SEULE : les clés du serveur sont reprises par l'importeur.
  const ancien = await demarrerEsport({ port: 0, hote: '127.0.0.1', base: ancienneBase, stockage: await stockageDisque(ancienDossier), config: configEsport(relais.url, ancienDossier, { cleDiscord: 'cle-discord-de-cloudflare-0123456789' }), secretsExportables: true });
  const nouveauDossier = mkdtempSync(join(tmpdir(), 'esport-nouveau-'));
  try {
    const f = await sessionFondateur(ancien.url);
    await api(ancien.url, '/moi', { methode: 'PUT', jeton: f, corps: { pseudo: 'Fondateur' } });
    const teamId = (await api(ancien.url, '/teams', { methode: 'POST', jeton: f, corps: { nom: 'Team Cloudflare', jeu: 'valorant', preset: 'valorant_complet' } })).corps.team.id;
    const depot = await api(ancien.url, `/teams/${teamId}/resumes`, { methode: 'POST', jeton: f, corps: { lien: 'https://youtu.be/abc123', typeId: HEBDO, dateReunion: '2026-10-19', titre: 'À déménager' } });
    assert.equal((await api(ancien.url, `/teams/${teamId}/resumes/${depot.corps.id}/pdf`, { methode: 'PUT', jeton: f, octets: PDF })).statut, 200);

    const messages = [];
    const fichierEnv = join(nouveauDossier, 'esport.env');
    writeFileSync(fichierEnv, `DATABASE_URL=${URL_PG}\nCLE_ESPORT=cle-provisoire-${'x'.repeat(40)}\nRELAIS_URL=${relais.url}\n`);
    const env = { DATABASE_URL: URL_PG, SCHEMA_BASE: cible.schema, ESPORT_SOURCE: ancien.url, JETON, FICHIERS_DIR: nouveauDossier, RELAIS_URL: relais.url, ESPORT_ENV: fichierEnv, RELAIS_ENV: '/inexistant', FICHIER_REDEMARRAGE: join(nouveauDossier, 'tmp', 'restart.txt') };
    const r = await importer([], env, { journal: { log: m => messages.push(m) } });
    assert.equal(r.ok, true);
    assert.ok(messages.some(m => /mêmes nombres de lignes/.test(m)), messages.join('\n'));
    assert.ok(messages.some(m => /Fichiers : 1 copiés/.test(m)), messages.join('\n'));
    // Clés reprises : CLE_ESPORT et CLE_DISCORD de « Cloudflare » dans le fichier .env (privé), sauvegarde gardée.
    assert.equal(r.cles, true);
    const lu = readFileSync(fichierEnv, 'utf8');
    assert.match(lu, new RegExp(`^CLE_ESPORT=${CLE}$`, 'm'));
    assert.match(lu, /^CLE_DISCORD=cle-discord-de-cloudflare-0123456789$/m);
    assert.match(lu, /^RELAIS_URL=/m);
    assert.equal(statSync(fichierEnv).mode & 0o777, 0o600);
    assert.ok(existsSync(`${fichierEnv}.avant-import`));
    assert.equal((await cible.base.premier('SELECT nom FROM teams', [])).nom, 'Team Cloudflare');
    const cle = (await cible.base.premier('SELECT cle_stockage FROM fichiers', [])).cle_stockage;
    assert.deepEqual(new Uint8Array(readFileSync(join(nouveauDossier, cle))), PDF);
    // Rejouer : refusé (base non vide) ; reprise des fichiers seulement : rien à recopier.
    await assert.rejects(importer([], env, { journal: { log: () => {} } }), /déjà des données/);
    const reprise = await importer(['--fichiers-seulement'], env, { journal: { log: () => {} } });
    assert.deepEqual(reprise.fichiers, { copies: 0, deja: 1, absents: [] });

    // Le nouveau serveur sert les données déménagées, avec le même jeton maître et la même clé de session.
    const nouveau = await demarrerEsport({ port: 0, hote: '127.0.0.1', base: cible.base, stockage: await stockageDisque(nouveauDossier), config: configEsport(relais.url, nouveauDossier) });
    try {
      const f2 = await sessionFondateur(nouveau.url);
      assert.deepEqual((await api(nouveau.url, '/teams', { jeton: f2 })).corps.teams.map(t => t.nom), ['Team Cloudflare']);
      // Hors déménagement, jamais de clé exportée.
      assert.equal((await api(nouveau.url, '/admin/secrets', { jeton: f2 })).statut, 404);
      // Une session ouverte sur l'ancien serveur reste valable (même CLE_ESPORT).
      assert.equal((await api(nouveau.url, '/moi', { jeton: f })).statut, 200);
    } finally {
      await nouveau.fermer();
    }
  } finally {
    await ancien.fermer();
    await relais.fermer();
    ancienneBase.fermer();
    await cible.base.fermer();
  }
});
