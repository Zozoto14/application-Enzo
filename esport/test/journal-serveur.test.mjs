/**
 * Journal des serveurs (~/logs/relais.log, ~/logs/esport.log : esport/serveur/journal-fichier.mjs) : horodatage et
 * niveau, rotation par taille, secrets jamais écrits (valeurs de l'environnement, jetons, URL de base, webhooks,
 * adresses e-mail masquées), erreurs non rattrapées, réglages JOURNAL_FICHIER et JOURNAL_DESACTIVE. Et le
 * redémarrage des apps (esport/serveur/redemarrer-apps.sh) : cloudlinux-selector s'il existe, sinon restart.txt seul.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerFichierJournal, fichierJournalParDefaut, installerJournal, masquerJournal, valeursSensibles } from '../serveur/journal-fichier.mjs';
import { ligneDemarrage } from '../serveur/app.mjs';

const dossierTemp = prefixe => mkdtempSync(join(tmpdir(), prefixe));

test('masquage : valeurs sensibles de l’environnement, jetons, URL de base, webhooks, e-mails partiellement', () => {
  const env = { SMTP_PASS: 'Motdepasse-Tres-Secret', JETON: 'jeton-maitre-0123456789', DISCORD_BOT_TOKEN: 'court', SMTP_HOST: 'poisson.o2switch.net', CLE_A2F: 'true', FICHIERS_DIR: '/home/x/esport-fichiers', PGPASSWORD: 'pg-secret-42' };
  const secrets = valeursSensibles(env);
  assert.deepEqual(secrets, ['jeton-maitre-0123456789', 'Motdepasse-Tres-Secret', 'pg-secret-42'], 'courtes, booléennes et chemins exclus ; plus longues d’abord');
  const l = masquerJournal(
    [
      'auth avec Motdepasse-Tres-Secret et jeton-maitre-0123456789',
      'base postgres://jayo:pg-secret-42@localhost/base',
      'webhook https://discord.com/api/webhooks/123456789012345678/AbCdEf_gh-IJ',
      'Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345',
      'SMTP_PASS=autre-chose DATABASE_URL: postgres://x',
      'mot de passe : hunter2',
      'profil p1.abc123def.QUJDREVGR0hJSktMTU5PUA',
      'envoi à lea.martin@exemple.fr depuis noreply@appdashboard.fr',
      'clé ' + 'A'.repeat(60),
    ].join('\n'),
    secrets,
  );
  for (const fuite of ['Motdepasse-Tres-Secret', 'jeton-maitre-0123456789', 'pg-secret-42', 'AbCdEf_gh-IJ', 'abcdefghijklmnopqrstuvwxyz012345', 'autre-chose', 'hunter2', 'QUJDREVGR0hJSktMTU5PUA', 'lea.martin', 'exemple.fr', 'noreply@', 'A'.repeat(60)]) {
    assert.ok(!l.includes(fuite), `fuite : ${fuite}\n${l}`);
  }
  assert.match(l, /envoi à l\*\*\*@e\*\*\*\.fr depuis n\*\*\*@a\*\*\*\.fr/);
  assert.match(l, /webhooks\/123456789012345678\/\*\*\*/);
  // Ce qui doit rester lisible : chemins, commits, codes d'erreur, nom du serveur SMTP.
  const lisible = masquerJournal('at /home/jayo8828/application-enzo/esport/serveur/app.mjs:12 commit ' + 'a'.repeat(40) + ' EAUTH 535 poisson.o2switch.net:465', secrets);
  assert.equal(lisible, 'at /home/jayo8828/application-enzo/esport/serveur/app.mjs:12 commit ' + 'a'.repeat(40) + ' EAUTH 535 poisson.o2switch.net:465');
});

test('fichier : horodatage, niveau, rotation par taille (3 fichiers), dossier créé', () => {
  const d = dossierTemp('journal-');
  try {
    const fichier = join(d, 'logs', 'relais.log');
    let t = Date.parse('2026-11-10T12:00:00.000Z');
    const f = creerFichierJournal({ fichier, tailleMax: 200, fichiers: 3, maintenant: () => t });
    f.ecrire('log', '[relais] démarrage');
    f.ecrire('warn', 'attention');
    f.ecrire('error', 'panne');
    const lignes = readFileSync(fichier, 'utf8').trim().split('\n');
    assert.deepEqual(lignes, ['2026-11-10T12:00:00.000Z INFO  [relais] démarrage', '2026-11-10T12:00:00.000Z WARN  attention', '2026-11-10T12:00:00.000Z ERROR panne']);
    for (let i = 0; i < 30; i++) {
      t += 1000;
      f.ecrire('log', `ligne ${i} ${'x'.repeat(40)}`);
    }
    const fichiers = readdirSync(join(d, 'logs')).sort();
    assert.deepEqual(fichiers, ['relais.log', 'relais.log.1', 'relais.log.2'], 'trois fichiers au plus');
    for (const n of fichiers) assert.ok(readFileSync(join(d, 'logs', n)).length <= 200, `${n} borné`);
    assert.match(readFileSync(fichier, 'utf8'), /ligne 29/);
    assert.match(readFileSync(`${fichier}.1`, 'utf8'), /ligne 2[0-9]/);
    // Taille reprise d'un fichier existant (redémarrage) : la rotation tient compte de ce qui est déjà écrit.
    const g = creerFichierJournal({ fichier, tailleMax: 200, fichiers: 3 });
    g.ecrire('log', 'y'.repeat(150));
    assert.ok(readFileSync(fichier).length <= 200);
    // Écriture impossible (dossier à la place du fichier) : jamais d'exception.
    mkdirSync(join(d, 'dossier.log'));
    creerFichierJournal({ fichier: join(d, 'dossier.log') }).ecrire('log', 'rien');
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('installerJournal : console recopiée et masquée, erreurs non rattrapées, signaux, JOURNAL_FICHIER et JOURNAL_DESACTIVE', () => {
  const d = dossierTemp('journal-');
  try {
    const fichier = join(d, 'esport.log');
    const vus = [];
    const cible = { log: (...a) => vus.push(['log', a]), info: (...a) => vus.push(['info', a]), warn: (...a) => vus.push(['warn', a]), error: (...a) => vus.push(['error', a]) };
    const processus = new EventEmitter();
    let sortie;
    processus.exit = code => (sortie = code);
    const env = { JOURNAL_FICHIER: fichier, SMTP_PASS: 'Secret-SMTP-123' };
    const j = installerJournal({ app: 'esport', env, cible, processus });
    assert.equal(j.fichier, fichier);
    cible.log('[esport] prêt sur %s', 'http://127.0.0.1:3000');
    cible.warn('mot de passe Secret-SMTP-123 pour lea@exemple.fr');
    cible.error('[esport] erreur', new Error('boum'));
    processus.emit('uncaughtExceptionMonitor', new Error('exception perdue'), 'uncaughtException');
    processus.emit('unhandledRejection', new Error('rejet perdu'));
    processus.emit('SIGTERM', 'SIGTERM');
    processus.emit('exit', 0);
    assert.equal(sortie, 0, 'SIGTERM : arrêt propre, comme avant');
    assert.equal(vus.length, 3, 'la console d’origine reçoit toujours tout');
    assert.equal(vus[1][1][0], 'mot de passe Secret-SMTP-123 pour lea@exemple.fr', 'la console elle-même est inchangée');
    const texte = readFileSync(fichier, 'utf8');
    assert.match(texte, /INFO  \[esport\] prêt sur http:\/\/127\.0\.0\.1:3000/);
    assert.match(texte, /WARN  mot de passe \*\*\* pour l\*\*\*@e\*\*\*\.fr/);
    assert.match(texte, /ERROR \[esport\] erreur Error: boum\n {4}at /, 'pile d’appels gardée');
    assert.match(texte, /ERROR \[esport\] erreur non rattrapée \(uncaughtException\) : Error: exception perdue/);
    assert.match(texte, /ERROR \[esport\] promesse rejetée non gérée : Error: rejet perdu/);
    assert.match(texte, /INFO  \[esport\] signal SIGTERM reçu : arrêt/);
    assert.match(texte, /INFO  \[esport\] arrêt du processus \(code 0\)/);
    assert.ok(!texte.includes('Secret-SMTP-123'));
    j.retirer();
    cible.log('après');
    assert.ok(!readFileSync(fichier, 'utf8').includes('après'), 'retirer() rend la console d’origine');
    assert.equal(processus.listenerCount('unhandledRejection'), 0);

    assert.equal(installerJournal({ app: 'esport', env: { JOURNAL_DESACTIVE: '1', JOURNAL_FICHIER: join(d, 'non.log') }, cible, processus }), null);
    assert.equal(existsSync(join(d, 'non.log')), false);
    assert.equal(fichierJournalParDefaut('relais', { HOME: '/home/jayo8828' }), '/home/jayo8828/logs/relais.log');
    assert.equal(fichierJournalParDefaut('esport', { HOME: '/home/jayo8828', JOURNAL_FICHIER: ' /tmp/x.log ' }), '/tmp/x.log');
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('ligne de démarrage de l’Esport : version, Node, pid, configuration, e-mails', () => {
  const infos = { app: 'esport', commit: 'def5678'.padEnd(40, '0'), demarreLe: '2026-11-10T12:00:00.000Z', pid: 9, node: '22.12.0' };
  assert.equal(
    ligneDemarrage({ infos, config: { fichierEnv: '/h/.appdashboard/esport.env' }, journal: { fichier: '/h/logs/esport.log' }, env: {} }),
    '[esport] démarrage : version def5678, Node 22.12.0, pid 9, configuration /h/.appdashboard/esport.env, journal /h/logs/esport.log ; e-mails : SMTP non configuré (facultatif : récapitulatif par e-mail)',
  );
  assert.match(ligneDemarrage({ infos: { ...infos, commit: null }, config: {}, journal: null, env: { SMTP_HOST: 'h', SMTP_USER: 'u@a.fr' } }), /version inconnue.*SMTP incomplet \(manquant : SMTP_PASS, MAIL_FROM\)$/);
});

// ---------------------------------------------------------------- redemarrer-apps.sh

const SCRIPT = join(fileURLToPath(new URL('../serveur/', import.meta.url)), 'redemarrer-apps.sh');

function redemarrer(home, env = {}, ...apps) {
  execFileSync('bash', [SCRIPT, ...apps], { env: { PATH: process.env.PATH, HOME: home, ...env }, encoding: 'utf8' });
  return readFileSync(join(home, 'logs', 'esport-deploy.log'), 'utf8');
}

function fauxSelecteur(dossier, { code = 0, sortie = '{"result": "success", "timestamp": 1}' } = {}) {
  mkdirSync(dossier, { recursive: true });
  const chemin = join(dossier, 'cloudlinux-selector');
  writeFileSync(chemin, `#!/bin/bash\necho "$*" >> "${join(dossier, 'appels.txt')}"\necho '${sortie}'\nexit ${code}\n`);
  chmodSync(chemin, 0o755);
  return chemin;
}

test('redemarrer-apps.sh : cloudlinux-selector absent → restart.txt seul ; présent → restart des deux apps ; échec noté sans arrêter', () => {
  const home = dossierTemp('redemarrer-');
  try {
    const depot = join(home, 'application-enzo');
    mkdirSync(join(depot, 'esport'), { recursive: true });
    mkdirSync(join(depot, 'relais'), { recursive: true });

    // 1. Commande absente (CLOUDLINUX_SELECTOR=aucun) : restart.txt posé, et dit au journal.
    let j = redemarrer(home, { CLOUDLINUX_SELECTOR: 'aucun' });
    assert.ok(existsSync(join(depot, 'esport/tmp/restart.txt')) && existsSync(join(depot, 'relais/tmp/restart.txt')));
    assert.match(j, /redémarrage esport : restart\.txt posé \(cloudlinux-selector absent\)/);
    assert.match(j, /redémarrage relais : restart\.txt posé \(cloudlinux-selector absent\)/);

    // 2. Commande trouvée dans le PATH : appelée avec la racine de l'app relative au dossier personnel.
    const bin = join(home, 'bin');
    fauxSelecteur(bin);
    j = redemarrer(home, { PATH: `${bin}:${process.env.PATH}` });
    assert.deepEqual(readFileSync(join(bin, 'appels.txt'), 'utf8').trim().split('\n'), [
      'restart --json --interpreter nodejs --app-root application-enzo/esport',
      'restart --json --interpreter nodejs --app-root application-enzo/relais',
    ]);
    assert.match(j, /redémarrage relais : fait \(cloudlinux-selector, application-enzo\/relais\)/);

    // 3. Une seule app, commande en échec : noté (code et sortie), restart.txt reste posé, code de sortie 0.
    const bin2 = join(home, 'bin2');
    const echec = fauxSelecteur(bin2, { code: 1, sortie: '{"result": "No such application"}' });
    rmSync(join(depot, 'relais/tmp'), { recursive: true });
    j = redemarrer(home, { CLOUDLINUX_SELECTOR: echec }, 'relais');
    assert.ok(existsSync(join(depot, 'relais/tmp/restart.txt')));
    assert.match(j, /redémarrage relais : cloudlinux-selector a échoué \(code 1 : \{"result": "No such application"\}\) ; restart\.txt posé/);
    assert.equal(readFileSync(join(bin2, 'appels.txt'), 'utf8').trim(), 'restart --json --interpreter nodejs --app-root application-enzo/relais');
    assert.ok(!/ÉCHEC/.test(j), 'pas un échec de déploiement (page Mises à jour)');

    // 4. Code 0 mais pas de « success » : traité comme un échec.
    const bin3 = join(home, 'bin3');
    j = redemarrer(home, { CLOUDLINUX_SELECTOR: fauxSelecteur(bin3, { sortie: '{"result": "error"}' }) }, 'esport');
    assert.match(j, /redémarrage esport : cloudlinux-selector a échoué \(code 0/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('deployer.sh appelle redemarrer-apps.sh et note code-deploye avant le redémarrage', () => {
  const texte = readFileSync(join(fileURLToPath(new URL('../serveur/', import.meta.url)), 'deployer.sh'), 'utf8');
  const i = texte.indexOf('echo "$APRES" > "$ETAT/code-deploye"');
  const k = texte.indexOf('esport/serveur/redemarrer-apps.sh esport relais');
  assert.ok(i > 0 && k > i, 'code-deploye écrit, puis redémarrage');
});
