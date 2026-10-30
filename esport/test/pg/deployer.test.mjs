/**
 * Déploiement « par pull » (esport/serveur/deployer.sh), joué en vrai sur une copie locale : dépôt
 * « GitHub » (dépôt nu), clone « cPanel », public_html avec des fichiers d'o2switch, base PostgreSQL.
 * Vérifie : reset sur origin/main, migrations, redémarrage Passenger, site synchronisé (protections,
 * bloc .htaccess fusionné, sauvegarde), idempotence et verrou. Lancé par `npm run esport:tester:pg`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { basePostgres } from '../../adaptateurs/postgres.mjs';

const URL_PG = process.env.ESPORT_TEST_PG;
const outil = cmd => {
  try {
    execFileSync('bash', ['-c', `command -v ${cmd}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const options = { skip: !URL_PG ? 'PostgreSQL absent (ESPORT_TEST_PG)' : !outil('git') || !outil('rsync') ? 'git ou rsync absent' : false, timeout: 120_000 };
const RACINE = fileURLToPath(new URL('../../../', import.meta.url));
const SCRIPT = join(RACINE, 'esport/serveur/deployer.sh');
// Identité git locale à ces commandes seulement (aucune configuration n'est écrite).
const IDENTITE = { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@exemple.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@exemple.invalid' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...IDENTITE } }).trim();

function lancer(env) {
  return new Promise((ok, ko) => {
    const p = spawn('bash', [SCRIPT], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => (err += d));
    p.on('error', ko);
    p.on('close', code => ok({ code, err }));
  });
}

test('deployer.sh : code, dépendances, migrations, redémarrage, site ; idempotent et verrouillé', options, async () => {
  const racineTest = mkdtempSync(join(tmpdir(), 'deployer-'));
  const home = join(racineTest, 'home');
  mkdirSync(join(home, '.appdashboard'), { recursive: true });
  // « GitHub » : dépôt nu avec main (code actuel) et deploiement-o2switch (site construit).
  const nu = join(racineTest, 'github.git');
  execFileSync('git', ['init', '-q', '--bare', nu]);
  const source = join(racineTest, 'source');
  mkdirSync(source);
  git(source, 'init', '-q', '-b', 'main');
  // Le code de travail (non commité compris) des dossiers utiles devient le main du test.
  for (const d of ['esport', 'relais', 'scripts']) execFileSync('rsync', ['-a', '--exclude=node_modules', '--exclude=*.db*', `${join(RACINE, d)}/`, `${join(source, d)}/`]);
  git(source, 'add', '-A');
  git(source, 'commit', '-q', '-m', 'main de test');
  git(source, 'push', '-q', nu, 'HEAD:refs/heads/main');
  git(nu, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  const site = join(racineTest, 'site');
  mkdirSync(join(site, 'assets'), { recursive: true });
  writeFileSync(join(site, 'index.html'), '<!doctype html><title>AppDashboard</title>');
  writeFileSync(join(site, 'assets', 'app-1234.js'), 'console.log(1)');
  writeFileSync(join(site, 'esport.json'), '{"esport":"https://esport.appdashboard.fr"}\n');
  writeFileSync(join(site, 'htaccess-appdashboard.conf'), execFileSync(process.execPath, [join(RACINE, 'scripts/htaccess-o2switch.mjs'), 'generer', join(RACINE, 'bureau/public')], { encoding: 'utf8' }));
  git(site, 'init', '-q');
  git(site, 'checkout', '-q', '-b', 'deploiement-o2switch');
  git(site, 'add', '-A');
  git(site, 'commit', '-q', '-m', 'site 1');
  git(site, 'push', '-q', nu, 'deploiement-o2switch');
  // « cPanel Git Version Control » : clone du dépôt.
  const depot = join(home, 'application-enzo');
  execFileSync('git', ['clone', '-q', nu, depot]);
  // node_modules de l'environnement virtuel (lien), comme chez cPanel.
  execFileSync('ln', ['-s', join(RACINE, 'esport/node_modules'), join(depot, 'esport/node_modules')]);
  // public_html avec ce qu'o2switch y met déjà.
  const pub = join(home, 'public_html');
  mkdirSync(join(pub, '.well-known', 'acme-challenge'), { recursive: true });
  mkdirSync(join(pub, 'cgi-bin'), { recursive: true });
  mkdirSync(join(pub, 'maj'), { recursive: true });
  writeFileSync(join(pub, '.well-known', 'acme-challenge', 'jeton'), 'letsencrypt');
  writeFileSync(join(pub, 'maj', 'manifeste.json'), '{"version":3}');
  writeFileSync(join(pub, 'ancien.html'), 'à effacer');
  writeFileSync(join(pub, '.htaccess'), '# php -- BEGIN cPanel-generated handler, do not edit\nAddHandler application/x-httpd-ea-php81 .php\n# php -- END cPanel-generated handler, do not edit\n');
  // Base : un schéma neuf ; configuration dans ~/.appdashboard/esport.env (comme chez le Fondateur).
  const schema = `t_${randomBytes(8).toString('hex')}`;
  const admin = await basePostgres({ connexion: URL_PG, max: 1 });
  await admin.script(`CREATE SCHEMA ${schema}`);
  writeFileSync(join(home, '.appdashboard', 'esport.env'), `# test\nDATABASE_URL=${URL_PG}\nSCHEMA_BASE=${schema}\nCLE_ESPORT=${'c'.repeat(64)}\n`);

  // DEPLOYER_GUET=0 : une seule vérification (le guet de ~4 minutes est testé à part, plus bas).
  const env = { PATH: process.env.PATH, HOME: home, NODE_BIN: process.execPath, NPM_BIN: 'true', DEPLOYER_GUET: '0', ...IDENTITE };
  const journalDe = () => readFileSync(join(home, 'logs', 'esport-deploy.log'), 'utf8');

  const r1 = await lancer(env);
  assert.equal(r1.code, 0, r1.err + journalDe());
  assert.equal(git(depot, 'rev-parse', 'HEAD'), git(nu, 'rev-parse', 'main'));
  assert.ok(existsSync(join(depot, 'esport/tmp/restart.txt')) && existsSync(join(depot, 'relais/tmp/restart.txt')));
  const migrees = await admin.tous(`SELECT nom FROM ${schema}.migrations_esport ORDER BY nom`, []);
  assert.ok(migrees.length >= 12);
  assert.ok(await admin.premier(`SELECT to_regclass('${schema}.relais_kv') IS NOT NULL AS ok`, []).then(l => l.ok));
  // Site : copié, ancien fichier effacé, fichiers d'o2switch et paquet iPhone gardés, bloc .htaccess ajouté.
  assert.ok(existsSync(join(pub, 'index.html')) && existsSync(join(pub, 'assets', 'app-1234.js')));
  assert.equal(existsSync(join(pub, 'ancien.html')), false);
  assert.equal(readFileSync(join(pub, '.well-known', 'acme-challenge', 'jeton'), 'utf8'), 'letsencrypt');
  assert.equal(readFileSync(join(pub, 'maj', 'manifeste.json'), 'utf8'), '{"version":3}');
  assert.ok(existsSync(join(pub, 'cgi-bin')));
  assert.equal(existsSync(join(pub, 'htaccess-appdashboard.conf')), false);
  const ht = readFileSync(join(pub, '.htaccess'), 'utf8');
  assert.match(ht, /cPanel-generated handler/);
  assert.match(ht, /BEGIN AppDashboard[\s\S]*RewriteRule \^ index\.html[\s\S]*END AppDashboard/);
  assert.equal(readdirSync(join(home, 'sauvegardes')).filter(f => f.startsWith('public_html-')).length, 1);
  assert.match(journalDe(), /serveurs Esport et relais redémarrés/);
  assert.match(journalDe(), /site : public_html à jour/);
  // public_html reste lisible par le serveur web (le dossier temporaire en 700 ne doit pas déteindre : 403 sinon).
  assert.equal(statSync(pub).mode & 0o777, 0o755);
  assert.equal(statSync(join(pub, 'assets')).mode & 0o005, 0o005);
  assert.equal(statSync(join(pub, 'index.html')).mode & 0o004, 0o004);

  // Deuxième passage sans nouveauté : rien n'est refait (journal inchangé, pas de redémarrage) ; seul un
  // `git ls-remote` a eu lieu (aucun fetch : la date de FETCH_HEAD ne bouge pas), et l'heure de la vérification est notée.
  const lignes = journalDe().split('\n').length;
  const redemarre = statSync(join(depot, 'esport/tmp/restart.txt')).mtimeMs;
  const fetchHead = statSync(join(depot, '.git', 'FETCH_HEAD')).mtimeMs;
  const verif = join(home, '.appdashboard', 'derniere-verification');
  writeFileSync(verif, '0\n');
  assert.equal((await lancer(env)).code, 0);
  assert.equal(journalDe().split('\n').length, lignes);
  assert.equal(statSync(join(depot, 'esport/tmp/restart.txt')).mtimeMs, redemarre);
  assert.equal(statSync(join(depot, '.git', 'FETCH_HEAD')).mtimeMs, fetchHead, 'pas de git fetch sans nouveauté');
  assert.ok(Math.abs(Number(readFileSync(verif, 'utf8')) - Date.now() / 1000) < 120, 'heure de la vérification notée');

  // « Vérifier maintenant » (drapeau déposé par le serveur Esport) : passage complet, drapeau consommé.
  const drapeau = join(home, '.appdashboard', 'deployer-demande');
  writeFileSync(drapeau, '2026-10-30T12:00:00.000Z\n');
  assert.equal((await lancer(env)).code, 0);
  assert.equal(existsSync(drapeau), false, 'drapeau consommé');
  assert.match(journalDe(), /vérification demandée depuis l'app/);
  assert.ok(statSync(join(depot, '.git', 'FETCH_HEAD')).mtimeMs >= fetchHead);

  // Nouveau commit sur main + nouveau site : appliqués ; le .htaccess garde un seul bloc.
  writeFileSync(join(source, 'NOUVEAU.txt'), 'v2');
  git(source, 'add', '-A');
  git(source, 'commit', '-q', '-m', 'v2');
  git(source, 'push', '-q', nu, 'HEAD:refs/heads/main');
  writeFileSync(join(site, 'index.html'), '<!doctype html><title>v2</title>');
  // Nouveau build : l'ancien morceau haché (app-1234.js) disparaît de la branche, un nouveau (app-5678.js) arrive.
  execFileSync('git', ['rm', '-q', 'assets/app-1234.js'], { cwd: site });
  mkdirSync(join(site, 'assets'), { recursive: true });
  writeFileSync(join(site, 'assets', 'app-5678.js'), 'console.log(2)');
  git(site, 'add', '-A');
  git(site, 'commit', '-q', '-am', 'site 2');
  git(site, 'push', '-q', nu, 'deploiement-o2switch');
  // Deux exécutions simultanées : le verrou laisse passer une seule mise à jour, sans erreur.
  const [a, b] = await Promise.all([lancer(env), lancer(env)]);
  assert.equal(a.code, 0, a.err);
  assert.equal(b.code, 0, b.err);
  assert.ok(existsSync(join(depot, 'NOUVEAU.txt')));
  assert.match(readFileSync(join(pub, 'index.html'), 'utf8'), /v2/);
  assert.equal(readFileSync(join(pub, '.htaccess'), 'utf8').split('BEGIN AppDashboard').length, 2);
  assert.equal(journalDe().split('\n').filter(l => l.includes('code :')).length, 1, 'une seule mise à jour du code pour v2');

  // Assets hachés : l'ancien morceau reste après le nouveau déploiement (un onglet ouvert en a encore besoin)…
  assert.ok(existsSync(join(pub, 'assets', 'app-1234.js')), 'ancien asset conservé après le déploiement');
  assert.ok(existsSync(join(pub, 'assets', 'app-5678.js')));
  // … alors que le reste du site garde la synchronisation stricte (fichier retiré = effacé).
  const jours = n => String(Math.floor(Date.now() / 1000) + n * 86400);
  const dans = async n => assert.equal((await lancer({ ...env, DEPLOYER_MAINTENANT: jours(n) })).code, 0);
  await dans(13);
  assert.ok(existsSync(join(pub, 'assets', 'app-1234.js')), 'encore là à 13 jours');
  await dans(15);
  assert.equal(existsSync(join(pub, 'assets', 'app-1234.js')), false, 'purgé après 14 jours');
  assert.ok(existsSync(join(pub, 'assets', 'app-5678.js')), 'l\'asset du build courant n\'est jamais purgé');
  assert.match(journalDe(), /1 ancien\(s\) fichier\(s\) de assets\/ purgé/);
  assert.equal(statSync(pub).mode & 0o777, 0o755);
  assert.equal(readFileSync(join(pub, '.well-known', 'acme-challenge', 'jeton'), 'utf8'), 'letsencrypt');

  // Guet : lancé par le cron, le script vérifie chaque seconde ici (chaque minute en vrai) ; un nouveau site
  // poussé PENDANT qu'il guette est publié dans la même exécution, sans attendre le cron suivant.
  writeFileSync(join(site, 'index.html'), '<!doctype html><title>v3</title>');
  git(site, 'commit', '-q', '-am', 'site 3');
  const guet = lancer({ ...env, DEPLOYER_GUET: '15', DEPLOYER_PAS: '1' });
  await new Promise(ok => setTimeout(ok, 1500));
  assert.doesNotMatch(readFileSync(join(pub, 'index.html'), 'utf8'), /v3/);
  git(site, 'push', '-q', nu, 'deploiement-o2switch');
  for (let i = 0; i < 100 && !readFileSync(join(pub, 'index.html'), 'utf8').includes('v3'); i++) await new Promise(ok => setTimeout(ok, 100));
  const r = await guet;
  assert.equal(r.code, 0, r.err);
  assert.match(readFileSync(join(pub, 'index.html'), 'utf8'), /v3/, `publié pendant le guet\n${journalDe().split('\n').slice(-8).join('\n')}`);
  await admin.script(`DROP SCHEMA ${schema} CASCADE`);
  await admin.fermer();
});
