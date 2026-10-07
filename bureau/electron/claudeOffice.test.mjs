import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  adresseLocale, appliquerHooks, commandeHook, EVENEMENTS, fichierReglages, lireReglagesOffice, planifierHooks,
  sonderServeur, trouverDossier, URL_DEFAUT,
} from './claudeOffice.mjs';

const ici = dirname(fileURLToPath(import.meta.url));

/** Un faux Claude Office (avec une espace dans le nom, comme sous Windows) et un faux dossier personnel. */
function bac() {
  const racine = mkdtempSync(join(tmpdir(), 'claude-office-'));
  const office = join(racine, 'AppDashboard', 'Claude Office');
  mkdirSync(join(office, 'hooks'), { recursive: true });
  writeFileSync(join(office, 'hooks', 'agent-tracker.mjs'), '// faux\n');
  const reglages = join(racine, 'maison', '.claude', 'settings.json');
  return { racine, office, reglages, nettoyer: () => rmSync(racine, { recursive: true, force: true }) };
}

test('à blanc : l’aperçu n’écrit rien, même pas le dossier .claude', () => {
  const b = bac();
  try {
    const plan = planifierHooks({ dossier: b.office, fichier: b.reglages });
    assert.equal(plan.change, true);
    assert.equal(plan.existe, false);
    assert.deepEqual(plan.ajouts.map(a => a.evenement), EVENEMENTS.claude);
    assert.equal(existsSync(dirname(b.reglages)), false);
    const json = JSON.parse(plan.apresTexte);
    assert.equal(json.hooks.PreToolUse[0].hooks[0].command, commandeHook(b.office));
    assert.match(commandeHook(b.office), /^node ".*\/AppDashboard\/Claude Office\/hooks\/agent-tracker\.mjs" claude$/);
  } finally {
    b.nettoyer();
  }
});

test('installation : sauvegarde horodatée, hooks tiers conservés, puis idempotente', () => {
  const b = bac();
  try {
    mkdirSync(dirname(b.reglages), { recursive: true });
    const tiers = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo tiers' }] };
    const original = `\uFEFF${JSON.stringify({ model: 'opus', hooks: { PreToolUse: [tiers] } })}`;
    writeFileSync(b.reglages, original);
    const plan = planifierHooks({ dossier: b.office, fichier: b.reglages });
    const { ecrit, sauvegarde } = appliquerHooks(plan, { maintenant: new Date('2026-10-07T10:00:00Z') });
    assert.equal(ecrit, true);
    assert.equal(readFileSync(sauvegarde, 'utf8'), original);
    assert.match(sauvegarde, /settings\.json\.claude-office-2026-10-07T10-00-00-000Z\.bak$/);
    const json = JSON.parse(readFileSync(b.reglages, 'utf8'));
    assert.equal(json.model, 'opus');
    assert.deepEqual(json.hooks.PreToolUse[0], tiers);
    assert.equal(json.hooks.PreToolUse.length, 2);
    // Deuxième passage : rien à faire, rien d'écrit.
    const encore = planifierHooks({ dossier: b.office, fichier: b.reglages });
    assert.equal(encore.change, false);
    assert.deepEqual(appliquerHooks(encore), { ecrit: false, sauvegarde: null });
    assert.equal(readdirSync(dirname(b.reglages)).filter(f => f.endsWith('.bak')).length, 1);
    // Désinstallation : seul le hook tiers reste.
    const retrait = planifierHooks({ dossier: b.office, fichier: b.reglages, desinstaller: true });
    appliquerHooks(retrait);
    assert.deepEqual(JSON.parse(readFileSync(b.reglages, 'utf8')).hooks, { PreToolUse: [tiers] });
  } finally {
    b.nettoyer();
  }
});

test('une ancienne entrée (agent-tracker.sh, autre chemin) est remplacée, pas doublée', () => {
  const b = bac();
  try {
    mkdirSync(dirname(b.reglages), { recursive: true });
    writeFileSync(b.reglages, JSON.stringify({ hooks: { PostToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'bash /vieux/hooks/agent-tracker.sh' }] }] } }));
    const plan = planifierHooks({ dossier: b.office, fichier: b.reglages });
    assert.deepEqual(plan.retraits, [{ evenement: 'PostToolUse', commande: 'bash /vieux/hooks/agent-tracker.sh' }]);
    const json = JSON.parse(plan.apresTexte);
    assert.equal(json.hooks.PostToolUse.length, 1);
    assert.equal(json.hooks.PostToolUse[0].hooks[0].command, commandeHook(b.office));
  } finally {
    b.nettoyer();
  }
});

test('refus sans rien écrire : JSON invalide, dossier sans Claude Office, fichier modifié après l’aperçu', () => {
  const b = bac();
  try {
    mkdirSync(dirname(b.reglages), { recursive: true });
    writeFileSync(b.reglages, '{ cassé');
    assert.throws(() => planifierHooks({ dossier: b.office, fichier: b.reglages }), /JSON valide/);
    assert.equal(readFileSync(b.reglages, 'utf8'), '{ cassé');
    assert.throws(() => planifierHooks({ dossier: join(b.racine, 'ailleurs'), fichier: b.reglages }), /introuvable/);
    assert.throws(() => planifierHooks({ dossier: undefined, fichier: b.reglages }), /--dossier/);
    writeFileSync(b.reglages, '{}');
    const plan = planifierHooks({ dossier: b.office, fichier: b.reglages });
    writeFileSync(b.reglages, '{"autre":1}');
    assert.throws(() => appliquerHooks(plan), /a changé/);
    assert.equal(readFileSync(b.reglages, 'utf8'), '{"autre":1}');
  } finally {
    b.nettoyer();
  }
});

test('Gemini seulement sur demande, avec hooksConfig.enabled', () => {
  const b = bac();
  try {
    const plan = planifierHooks({ dossier: b.office, cible: 'gemini', fichier: b.reglages });
    const json = JSON.parse(plan.apresTexte);
    assert.equal(json.hooksConfig.enabled, true);
    assert.ok(json.hooks.BeforeTool[0].hooks[0].command.endsWith(' gemini'));
    assert.match(fichierReglages('gemini', {}, '/m'), /[/\\]m[/\\]\.gemini[/\\]settings\.json$/);
  } finally {
    b.nettoyer();
  }
});

test('aucun chemin en dur : CLAUDE_CONFIG_DIR, dossier trouvé à côté du projet, sinon rien', () => {
  const b = bac();
  try {
    assert.equal(fichierReglages('claude', { CLAUDE_CONFIG_DIR: '/conf' }, '/m'), join('/conf', 'settings.json'));
    assert.equal(fichierReglages('claude', {}, '/m'), join('/m', '.claude', 'settings.json'));
    const projet = join(b.racine, 'AppDashboard');
    assert.equal(trouverDossier({ env: {}, racineProjet: projet }), b.office);
    assert.equal(trouverDossier({ env: { CLAUDE_OFFICE_DIR: b.office } }), b.office);
    assert.equal(trouverDossier({ env: {}, racineProjet: join(b.racine, 'vide') }), undefined);
    const source = readFileSync(join(ici, 'claudeOffice.mjs'), 'utf8') + readFileSync(join(ici, '..', '..', 'scripts', 'office-hooks.mjs'), 'utf8');
    const code = source.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /[A-Z]:\\\\|zozot|\/Users\/|\/home\//i);
  } finally {
    b.nettoyer();
  }
});

test('npm run office:hooks : --a-blanc n’écrit rien, sans terminal il refuse d’écrire sans --oui', () => {
  const b = bac();
  try {
    const script = join(ici, '..', '..', 'scripts', 'office-hooks.mjs');
    const sortie = execFileSync(process.execPath, [script, '--dossier', b.office, '--settings', b.reglages, '--a-blanc'], { encoding: 'utf8' });
    assert.match(sortie, /\+ PreToolUse/);
    assert.match(sortie, /À blanc/);
    assert.equal(existsSync(b.reglages), false);
    const refus = spawnSync(process.execPath, [script, '--dossier', b.office, '--settings', b.reglages], { encoding: 'utf8', input: 'oui\n' });
    assert.equal(refus.status, 2);
    assert.match(refus.stderr, /sans terminal/);
    assert.equal(existsSync(b.reglages), false);
    execFileSync(process.execPath, [script, '--dossier', b.office, '--settings', b.reglages, '--oui'], { encoding: 'utf8' });
    assert.ok(JSON.parse(readFileSync(b.reglages, 'utf8')).hooks.Stop);
    const deja = execFileSync(process.execPath, [script, '--dossier', b.office, '--settings', b.reglages, '--oui'], { encoding: 'utf8' });
    assert.match(deja, /déjà installés/);
  } finally {
    b.nettoyer();
  }
});

test('le serveur doit être sur ce PC ; la sonde rend l’état sans lever', async () => {
  for (const ok of ['http://127.0.0.1:3334', 'http://localhost:3333/', 'http://[::1]:3334']) {
    assert.doesNotThrow(() => adresseLocale(ok), ok);
  }
  for (const non of ['http://192.168.1.2:3334', 'https://exemple.fr', 'file:///c:/x', 'http://u:p@127.0.0.1:3334', 'http://127.0.0.1.exemple.fr', '']) {
    assert.throws(() => adresseLocale(non), /.*/, non);
  }
  assert.equal((await sonderServeur('http://10.0.0.1:3334')).joignable, false);
  const serveur = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(req.url === '/health' ? JSON.stringify({ status: 'ok', agents: 2, clients: 1 }) : '{}');
  });
  await new Promise(r => serveur.listen(0, '127.0.0.1', r));
  try {
    const { port } = serveur.address();
    assert.deepEqual(await sonderServeur(`http://127.0.0.1:${port}`), { joignable: true, agents: 2, clients: 1 });
  } finally {
    serveur.close();
  }
  assert.equal((await sonderServeur('http://127.0.0.1:1', { delaiMs: 500 })).joignable, false);
  assert.deepEqual(lireReglagesOffice('{"url":"http://evil.example"}'), { dossier: undefined, url: URL_DEFAUT });
  assert.deepEqual(lireReglagesOffice('pas du json'), { dossier: undefined, url: URL_DEFAUT });
});

test('pont du PC : rien ne s’écrit sans la confirmation native, la fenêtre ne donne aucun chemin', async () => {
  const { brancherClaudeOffice } = await import('./claudeOfficeIpc.mjs');
  const b = bac();
  const ancien = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dirname(b.reglages);
  try {
    const gestionnaires = {};
    const reponses = [];
    const boites = [];
    let reglagesOffice = '{}';
    brancherClaudeOffice({
      ipcMain: { handle: (canal, f) => (gestionnaires[canal] = f) },
      dialog: { showMessageBox: async (_f, options) => (boites.push(options), { response: reponses.shift() ?? 0 }) },
      BrowserWindow: { fromWebContents: () => undefined },
      shell: {},
      fichierReglages: () => join(b.racine, 'claude-office.json'),
      ecrire: async (_f, octets) => (reglagesOffice = octets.toString()),
      racineProjet: async () => join(b.racine, 'AppDashboard'),
    });
    const appel = (canal, ...args) => gestionnaires[canal]({ sender: {} }, ...args);
    const etat = await appel('claude-office:etat');
    assert.equal(etat.dossier, b.office);
    assert.equal(etat.hooks, 'absents');
    assert.equal(etat.serveur.joignable, false);
    const apercu = await appel('claude-office:apercu-hooks', false);
    assert.equal(apercu.plan.fichier, b.reglages);
    assert.equal(existsSync(b.reglages), false);
    // Annulé dans la boîte native : rien d'écrit.
    assert.deepEqual(await appel('claude-office:installer-hooks', false), { ok: false, annule: true });
    assert.equal(existsSync(b.reglages), false);
    assert.match(boites[0].detail, /\+ PreToolUse/);
    reponses.push(1);
    const fait = await appel('claude-office:installer-hooks', false);
    assert.equal(fait.ecrit, true);
    assert.equal((await appel('claude-office:etat')).hooks, 'installes');
    // L'adresse reste sur ce PC.
    assert.equal((await appel('claude-office:regler-url', 'http://192.168.0.2:3334')).ok, false);
    assert.equal((await appel('claude-office:regler-url', 'http://localhost:3333')).ok, true);
    assert.equal(JSON.parse(reglagesOffice).url, 'http://localhost:3333');
  } finally {
    if (ancien === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = ancien;
    b.nettoyer();
  }
});
