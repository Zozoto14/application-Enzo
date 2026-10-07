import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ajouterEntree, analyserLignes, construireEntree, creerLecteur, dossierHistorique, ecrireReglages, enregistrerEvenement, fichierCourant,
  importerJournal, lireJournal, lireReglages, masquerSecrets, supprimerEntrees, compterSuppression, DEBUT_ENTREE,
} from './officeHistorique.mjs';
import { appliquerHooks, enchainerPlans, planifierHistorique, planifierHooks } from './claudeOffice.mjs';

const ici = dirname(fileURLToPath(import.meta.url));
const racineProjet = join(ici, '..', '..');
const HOOK = join(racineProjet, 'scripts', 'office-historique-hook.mjs');

function bac() {
  const racine = mkdtempSync(join(tmpdir(), 'office-historique-'));
  const dossier = join(racine, 'historique');
  return { racine, dossier, nettoyer: () => rmSync(racine, { recursive: true, force: true }) };
}

const demande = (texte, extra = {}) => ({ hook_event_name: 'UserPromptSubmit', prompt: texte, session_id: 'sess-1', cwd: '/home/moi/projets/budget', ...extra });

test('le hook écrit la demande dans le journal, sans serveur, en 0600, et rien sur la sortie standard', () => {
  const b = bac();
  try {
    const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(demande('Ajoute un export CSV')), env: { ...process.env, OFFICE_HISTORIQUE_DIR: b.dossier }, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    const { entrees } = lireJournal(b.dossier);
    assert.equal(entrees.length, 1);
    assert.equal(entrees[0].type, 'demande');
    assert.equal(entrees[0].texte, 'Ajoute un export CSV');
    assert.equal(entrees[0].projet, 'budget');
    assert.match(entrees[0].appareilId, /^[0-9a-f]{12}$/);
    const [fichier] = readdirSync(b.dossier).filter(n => n.endsWith('.jsonl'));
    assert.match(fichier, /^\d{4}-\d{2}\.jsonl$/);
    if (process.platform !== 'win32') {
      assert.equal(statSync(join(b.dossier, fichier)).mode & 0o777, 0o600);
      assert.equal(statSync(b.dossier).mode & 0o777, 0o700);
    }
    // Charge illisible : sortie 0, rien d'écrit, rien d'affiché.
    const casse = spawnSync(process.execPath, [HOOK], { input: '{pas du json', env: { ...process.env, OFFICE_HISTORIQUE_DIR: b.dossier }, encoding: 'utf8' });
    assert.equal(casse.status, 0);
    assert.equal(casse.stdout + casse.stderr, '');
    assert.equal(lireJournal(b.dossier).entrees.length, 1);
  } finally {
    b.nettoyer();
  }
});

test('écriture concurrente : 8 processus × 40 entrées, aucune ligne mêlée ni perdue', async () => {
  const b = bac();
  try {
    const code = `
      import { ajouterEntree, construireEntree, lireReglages } from ${JSON.stringify(new URL('./officeHistorique.mjs', import.meta.url).href)};
      const dossier = process.argv[1];
      const reglages = lireReglages(dossier);
      for (let i = 0; i < 40; i++) {
        ajouterEntree(dossier, construireEntree({ hook_event_name: 'UserPromptSubmit', prompt: 'x'.repeat(3000) + process.pid + '-' + i, session_id: 's' }, { reglages }), { reglages });
      }`;
    await Promise.all(
      Array.from({ length: 8 }, () => new Promise((ok, ko) => {
        const p = spawn(process.execPath, ['--input-type=module', '-e', code, b.dossier], { stdio: 'inherit' });
        p.on('exit', c => (c === 0 ? ok() : ko(new Error(`sortie ${c}`))));
      })),
    );
    const { entrees, ignorees } = lireJournal(b.dossier);
    assert.equal(ignorees, 0);
    assert.equal(entrees.length, 320);
    assert.equal(new Set(entrees.map(e => e.id)).size, 320);
    // Un seul identifiant d'appareil malgré les créations simultanées.
    assert.equal(new Set(entrees.map(e => e.appareilId)).size, 1);
  } finally {
    b.nettoyer();
  }
});

test('reprise après crash : une ligne tronquée est ignorée, la suivante récupérée', () => {
  const b = bac();
  try {
    const reglages = lireReglages(b.dossier);
    const premiere = construireEntree(demande('avant le crash'), { reglages });
    const fichier = ajouterEntree(b.dossier, premiere, { reglages });
    // Crash au milieu d'une écriture : pas de fin de ligne.
    appendFileSync(fichier, `${DEBUT_ENTREE}coupé-net","ts":"2026`);
    const apres = construireEntree(demande('après le crash'), { reglages });
    ajouterEntree(b.dossier, apres, { reglages });
    const { entrees, ignorees } = lireJournal(b.dossier);
    assert.deepEqual(entrees.map(e => e.texte), ['avant le crash', 'après le crash']);
    assert.equal(ignorees, 1);
    assert.deepEqual(analyserLignes('n’importe quoi\n\n').entrees, []);
  } finally {
    b.nettoyer();
  }
});

test('lecture incrémentale et déduplication : relire ne double rien, seules les lignes ajoutées sont lues', () => {
  const b = bac();
  try {
    const reglages = lireReglages(b.dossier);
    const lecteur = creerLecteur(b.dossier);
    const e1 = construireEntree(demande('un'), { reglages });
    ajouterEntree(b.dossier, e1, { reglages });
    assert.equal(lecteur.lire().entrees.length, 1);
    // Ligne en cours d'écriture (pas encore de fin de ligne) : attendue au tour suivant.
    const fichier = fichierCourant(b.dossier, reglages);
    const e2 = construireEntree(demande('deux'), { reglages });
    const ligne = JSON.stringify(e2);
    appendFileSync(fichier, ligne.slice(0, 20));
    assert.equal(lecteur.lire().entrees.length, 1);
    appendFileSync(fichier, `${ligne.slice(20)}\n`);
    assert.equal(lecteur.lire().entrees.length, 2);
    // La même entrée importée d'ailleurs : une seule fois.
    importerJournal(b.dossier, `${JSON.stringify(e1)}\n`, { origine: 'autre-pc.jsonl' });
    const lu = lecteur.lire();
    assert.equal(lu.entrees.length, 2);
    assert.equal(lu.fichiers, 2);
    assert.equal(lecteur.lire().entrees.length, 2);
  } finally {
    b.nettoyer();
  }
});

test('rotation et taille bornée : fichier suivant au-delà de la limite, les plus anciens effacés', () => {
  const b = bac();
  try {
    ecrireReglages(b.dossier, { maxFichierMo: 1, maxTotalMo: 10 });
    const reglages = lireReglages(b.dossier);
    assert.equal(reglages.maxFichierMo, 1);
    const gros = 'y'.repeat(15_000);
    const maintenant = new Date('2026-10-07T10:00:00Z');
    for (let i = 0; i < 80; i++) ajouterEntree(b.dossier, construireEntree(demande(gros), { reglages, maintenant }), { reglages, maintenant });
    const noms = readdirSync(b.dossier).filter(n => n.endsWith('.jsonl')).sort();
    assert.deepEqual(noms, ['2026-10.2.jsonl', '2026-10.jsonl']);
    assert.ok(statSync(join(b.dossier, '2026-10.jsonl')).size <= 1024 * 1024 + 20_000);
    // Taille totale : 10 Mo au plus ; d'anciens mois remplis d'office sont effacés à la création d'un fichier.
    for (const m of ['2025-01', '2025-02', '2025-03']) writeFileSync(join(b.dossier, `${m}.jsonl`), 'z'.repeat(4 * 1024 * 1024));
    const novembre = new Date('2026-11-02T10:00:00Z');
    ajouterEntree(b.dossier, construireEntree(demande('novembre'), { reglages, maintenant: novembre }), { reglages, maintenant: novembre });
    const restants = readdirSync(b.dossier).filter(n => n.endsWith('.jsonl'));
    assert.ok(!restants.includes('2025-01.jsonl'));
    assert.ok(restants.includes('2026-11.jsonl'));
    const total = restants.reduce((s, n) => s + statSync(join(b.dossier, n)).size, 0);
    assert.ok(total <= 10 * 1024 * 1024, `total ${total}`);
  } finally {
    b.nettoyer();
  }
});

test('masquage des secrets avant écriture (et désactivable)', () => {
  const cas = {
    'export ANTHROPIC_API_KEY=sk-ant-api03-AbCdEf0123456789xyz': 'sk-ant-api03',
    'git remote add o https://moi:ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/x': 'ghp_',
    'curl -H "Authorization: Bearer abcdefghijklmnop0123456789"': 'abcdefghijklmnop0123456789',
    'mysql --password Hunter2Secret -u root': 'Hunter2Secret',
    '{"apiKey": "AIzaSyA-1234567890abcdefghijklmnopqrstu"}': 'AIzaSyA',
    'mot_de_passe: "Tr0ub4dor&3"': 'Tr0ub4dor',
    'cle AKIAIOSFODNN7EXAMPLE et jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.SflKxwRJSMeKKF2QT4fwpM': 'AKIAIOSFODNN7EXAMPLE',
    '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----': 'MIIEow',
    'code de liaison AB1.eyJyIjoiaHR0cHM6Ly9yZWxhaXMifQxyz': 'AB1.eyJ',
  };
  for (const [texte, secret] of Object.entries(cas)) {
    const masque = masquerSecrets(texte);
    assert.ok(!masque.includes(secret), `${texte} → ${masque}`);
    assert.match(masque, /\[secret masqué\]/);
  }
  // Une phrase ordinaire n'est pas abîmée.
  assert.equal(masquerSecrets('le token expire demain, le mot de passe aussi'), 'le token expire demain, le mot de passe aussi');
  const avec = construireEntree(demande('TOKEN=abcdef123456'), { reglages: { ...lireReglagesParDefaut(), masquerSecrets: true } });
  assert.equal(avec.texte, 'TOKEN=[secret masqué]');
  const sans = construireEntree(demande('TOKEN=abcdef123456'), { reglages: { ...lireReglagesParDefaut(), masquerSecrets: false } });
  assert.equal(sans.texte, 'TOKEN=abcdef123456');
});

function lireReglagesParDefaut() {
  return { actif: true, enregistrerSorties: false, masquerSecrets: true, maxFichierMo: 10, maxTotalMo: 200, appareil: 'PC-test', appareilId: '0123456789ab' };
}

test('outils : un résumé court par défaut, jamais la sortie brute (sauf réglage)', () => {
  const charge = {
    hook_event_name: 'PostToolUse', tool_name: 'Bash', session_id: 's', cwd: 'C:\\Users\\moi\\AppDashboard',
    tool_input: { command: 'npm test -- --password Secr3tValue', description: 'Lance les tests' },
    tool_response: { stdout: 'x'.repeat(50_000), is_error: true },
  };
  const court = construireEntree(charge, { reglages: lireReglagesParDefaut() });
  assert.equal(court.outil, 'Bash');
  assert.equal(court.projet, 'AppDashboard');
  assert.match(court.resume, /^Lance les tests — npm test/);
  assert.ok(!court.resume.includes('Secr3tValue'));
  assert.equal(court.echec, true);
  assert.equal(court.sortie, undefined);
  assert.equal(court.entree, undefined);
  const complet = construireEntree(charge, { reglages: { ...lireReglagesParDefaut(), enregistrerSorties: true } });
  assert.ok(complet.sortie.length < 2_100);
  assert.ok(!complet.entree.includes('Secr3tValue'));
  // Hook désactivé : rien n'est écrit.
  const b = bac();
  try {
    ecrireReglages(b.dossier, { actif: false });
    assert.equal(enregistrerEvenement(demande('rien'), { env: { OFFICE_HISTORIQUE_DIR: b.dossier } }), undefined);
    assert.equal(lireJournal(b.dossier).entrees.length, 0);
    // Valeurs retouchées : bornées, inconnues ignorées.
    const r = ecrireReglages(b.dossier, { maxTotalMo: 1e9, maxFichierMo: -3, inconnu: 1, appareil: '  Bureau\u0007 ' });
    assert.equal(r.maxTotalMo, 5000);
    assert.equal(r.maxFichierMo, 1);
    assert.equal(r.appareil, 'Bureau');
    assert.equal('inconnu' in r, false);
  } finally {
    b.nettoyer();
  }
});

test('suppression : une entrée, une période, tout — réécriture atomique, le reste intact', () => {
  const b = bac();
  try {
    const reglages = lireReglages(b.dossier);
    const dates = ['2026-09-01T10:00:00Z', '2026-09-15T10:00:00Z', '2026-10-01T10:00:00Z', '2026-10-05T10:00:00Z'];
    const ecrites = dates.map((d, i) => {
      const maintenant = new Date(d);
      const e = construireEntree(demande(`n°${i}`), { reglages, maintenant });
      ajouterEntree(b.dossier, e, { reglages, maintenant });
      return e;
    });
    importerJournal(b.dossier, `${JSON.stringify({ ...ecrites[0], id: 'importee-1', texte: 'importée' })}\n`, { origine: 'Autre PC.jsonl' });
    assert.equal(lireJournal(b.dossier).entrees.length, 5);
    assert.deepEqual(supprimerEntrees(b.dossier, { ids: [ecrites[1].id] }), { supprimees: 1 });
    assert.deepEqual(lireJournal(b.dossier).entrees.map(e => e.texte), ['n°0', 'importée', 'n°2', 'n°3']);
    assert.equal(compterSuppression(b.dossier, { du: '2026-09-30T00:00:00Z', au: '2026-10-02T00:00:00Z' }).nombre, 1);
    supprimerEntrees(b.dossier, { du: '2026-09-30T00:00:00Z', au: '2026-10-02T00:00:00Z' });
    assert.deepEqual(lireJournal(b.dossier).entrees.map(e => e.texte), ['n°0', 'importée', 'n°3']);
    // Le hook continue d'écrire après une suppression.
    ajouterEntree(b.dossier, construireEntree(demande('nouvelle'), { reglages }), { reglages });
    assert.equal(lireJournal(b.dossier).entrees.length, 4);
    assert.throws(() => supprimerEntrees(b.dossier, {}), /invalide/);
    assert.throws(() => supprimerEntrees(b.dossier, { ids: [] }), /Aucune/);
    supprimerEntrees(b.dossier, { tout: true });
    assert.equal(lireJournal(b.dossier).entrees.length, 0);
    assert.ok(!readdirSync(b.dossier).some(n => n.endsWith('.suppression') || n.endsWith('.nouveau')));
  } finally {
    b.nettoyer();
  }
});

test('import d’un journal d’un autre appareil : seules les entrées valides, nom fabriqué ici', () => {
  const b = bac();
  try {
    const bonne = construireEntree(demande('depuis le portable'), { reglages: lireReglagesParDefaut() });
    const texte = `${JSON.stringify(bonne)}\nligne cassée\n{"v":1,"id":"x"}\n`;
    const r = importerJournal(b.dossier, texte, { origine: '../../etc/passwd.jsonl' });
    assert.equal(r.importees, 1);
    assert.equal(r.ignorees, 2);
    assert.match(r.fichier, /^etc-passwd-[0-9t-]+z\.jsonl$/);
    assert.ok(existsSync(join(b.dossier, 'importes', r.fichier)));
    assert.equal(lireJournal(b.dossier).entrees[0].importe, true);
  } finally {
    b.nettoyer();
  }
});

test('aucun chemin en dur : dossier du journal depuis la variable ou le dossier personnel (Windows compris)', () => {
  assert.equal(dossierHistorique({ OFFICE_HISTORIQUE_DIR: 'D:\\journal' }, '/m'), 'D:\\journal');
  assert.equal(dossierHistorique({}, '/m'), join('/m', '.agent-office', 'historique'));
  const source = ['bureau/electron/officeHistorique.mjs', 'scripts/office-historique-hook.mjs'].map(f => readFileSync(join(racineProjet, f), 'utf8')).join('\n');
  const code = source.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /[A-Z]:\\\\|zozot|\/Users\/|\/home\//i);
  const projet = construireEntree({ ...demande('x'), cwd: 'C:\\Users\\moi\\Desktop\\AppDashboard' }, { reglages: lireReglagesParDefaut() });
  assert.equal(projet.projet, 'AppDashboard');
});

test('hook d’historique dans settings.json : aperçu, sauvegarde, idempotent, avec Claude Office en une écriture, désinstallation', () => {
  const b = bac();
  try {
    const reglages = join(b.racine, 'maison', '.claude', 'settings.json');
    mkdirSync(dirname(reglages), { recursive: true });
    const tiers = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo tiers' }] };
    writeFileSync(reglages, JSON.stringify({ hooks: { PreToolUse: [tiers] } }));
    const plan = planifierHistorique({ racineProjet, fichier: reglages });
    assert.equal(plan.change, true);
    assert.deepEqual(plan.ajouts.map(a => a.evenement), ['UserPromptSubmit', 'PostToolUse', 'SessionStart', 'SessionEnd', 'Stop', 'SubagentStop']);
    assert.match(plan.commande, /^node ".*\/scripts\/office-historique-hook\.mjs"$/);
    const { sauvegarde } = appliquerHooks(plan);
    assert.ok(sauvegarde && existsSync(sauvegarde));
    assert.equal(planifierHistorique({ racineProjet, fichier: reglages }).change, false);
    // Avec Claude Office : une seule écriture, son hook et le nôtre côte à côte.
    const office = join(b.racine, 'Claude Office');
    mkdirSync(join(office, 'hooks'), { recursive: true });
    writeFileSync(join(office, 'hooks', 'agent-tracker.mjs'), '//');
    const ensemble = enchainerPlans(reglages, [
      lire => planifierHooks({ dossier: office, fichier: reglages, lire }),
      lire => planifierHistorique({ racineProjet, fichier: reglages, lire }),
    ]);
    assert.equal(ensemble.parties.length, 1);
    appliquerHooks(ensemble);
    const json = JSON.parse(readFileSync(reglages, 'utf8'));
    assert.equal(json.hooks.UserPromptSubmit.length, 2);
    assert.deepEqual(json.hooks.PreToolUse[0], tiers);
    // Retirer l'historique laisse Claude Office et le hook tiers.
    appliquerHooks(planifierHistorique({ racineProjet, fichier: reglages, desinstaller: true }));
    const apres = JSON.parse(readFileSync(reglages, 'utf8'));
    assert.equal(apres.hooks.UserPromptSubmit.length, 1);
    assert.match(apres.hooks.UserPromptSubmit[0].hooks[0].command, /agent-tracker/);
    assert.equal(apres.hooks.SubagentStop.length, 1);
  } finally {
    b.nettoyer();
  }
});

test('npm run office:hooks : à blanc par défaut, historique installé même sans Claude Office, puis rien à faire', () => {
  const b = bac();
  try {
    const script = join(racineProjet, 'scripts', 'office-hooks.mjs');
    const reglages = join(b.racine, 's.json');
    const env = { ...process.env, CLAUDE_OFFICE_DIR: '' };
    const apercu = execFileSync(process.execPath, [script, '--settings', reglages, '--a-blanc', '--historique-seul'], { encoding: 'utf8', env });
    assert.match(apercu, /office-historique-hook\.mjs/);
    assert.match(apercu, /À blanc/);
    assert.equal(existsSync(reglages), false);
    execFileSync(process.execPath, [script, '--settings', reglages, '--oui', '--historique-seul'], { encoding: 'utf8', env });
    assert.ok(JSON.parse(readFileSync(reglages, 'utf8')).hooks.UserPromptSubmit);
    assert.match(execFileSync(process.execPath, [script, '--settings', reglages, '--oui', '--historique-seul'], { encoding: 'utf8', env }), /déjà installés/);
    execFileSync(process.execPath, [script, '--settings', reglages, '--oui', '--desinstaller', '--historique-seul'], { encoding: 'utf8', env });
    assert.deepEqual(JSON.parse(readFileSync(reglages, 'utf8')).hooks, {});
  } finally {
    b.nettoyer();
  }
});

test('pont du PC : lecture, réglages en liste fermée, suppression et hook seulement après la confirmation native', async () => {
  const { brancherClaudeOffice } = await import('./claudeOfficeIpc.mjs');
  const b = bac();
  const ancien = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = join(b.racine, 'conf');
  try {
    const gestionnaires = {};
    const reponses = [];
    const boites = [];
    brancherClaudeOffice({
      ipcMain: { handle: (canal, f) => (gestionnaires[canal] = f) },
      dialog: {
        showMessageBox: async (_f, options) => (boites.push(options), { response: reponses.shift() ?? 0 }),
        showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      },
      BrowserWindow: { fromWebContents: () => undefined },
      shell: {},
      fichierReglages: () => join(b.racine, 'claude-office.json'),
      ecrire: async () => undefined,
      racineProjet: async () => racineProjet,
      dossierHistorique: () => b.dossier,
    });
    const appel = (canal, ...args) => gestionnaires[canal]({ sender: {} }, ...args);
    enregistrerEvenement(demande('première'), { env: { OFFICE_HISTORIQUE_DIR: b.dossier } });
    let lu = await appel('claude-office:historique-lire');
    assert.equal(lu.ok, true);
    assert.equal(lu.entrees.length, 1);
    assert.equal(lu.reglages.enregistrerSorties, false);
    enregistrerEvenement(demande('deuxième'), { env: { OFFICE_HISTORIQUE_DIR: b.dossier } });
    lu = await appel('claude-office:historique-lire');
    assert.equal(lu.entrees.length, 2);
    const r = await appel('claude-office:historique-reglages', { enregistrerSorties: true, maxTotalMo: 1, dossier: '/etc' });
    assert.equal(r.reglages.enregistrerSorties, true);
    assert.equal(r.reglages.maxTotalMo, 200);
    // Suppression : annulée dans la boîte native → rien ; confirmée → fait.
    assert.deepEqual(await appel('claude-office:historique-supprimer', { tout: true }), { ok: false, annule: true });
    assert.equal(lireJournal(b.dossier).entrees.length, 2);
    assert.match(boites.at(-1).message, /2 entrées/);
    reponses.push(1);
    assert.deepEqual(await appel('claude-office:historique-supprimer', { tout: true }), { ok: true, supprimees: 2 });
    assert.equal((await appel('claude-office:historique-lire')).entrees.length, 0);
    assert.equal((await appel('claude-office:historique-supprimer', { chemin: '/' })).ok, false);
    // Hook : aperçu sans écriture, installation annulée puis confirmée ; l'état le dit.
    assert.equal((await appel('claude-office:etat')).historique, 'absents');
    assert.equal((await appel('claude-office:historique-apercu-hooks', false)).ok, true);
    assert.equal(existsSync(join(b.racine, 'conf', 'settings.json')), false);
    assert.deepEqual(await appel('claude-office:historique-installer-hooks', false), { ok: false, annule: true });
    reponses.push(1);
    assert.equal((await appel('claude-office:historique-installer-hooks', false)).ecrit, true);
    assert.equal((await appel('claude-office:etat')).historique, 'installes');
    assert.deepEqual(await appel('claude-office:historique-importer'), { ok: false, annule: true });
  } finally {
    if (ancien === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = ancien;
    b.nettoyer();
  }
});
