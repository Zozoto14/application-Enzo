/**
 * Historique de Claude Office dans le bureau (fenêtre de PC 1280×800) : un vrai journal d'essai est écrit par le
 * hook (scripts/office-historique-hook.mjs, dossier temporaire), lu par la vraie logique du journal, puis servi à
 * l'écran par un faux pont du PC. Vérifie : compteurs, recherche, filtre, détail, secrets masqués, aucune
 * suppression ni installation sans clic, écran du site sans journal. Captures relues ensuite.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-claude-office-historique.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lireJournal } from '../bureau/electron/officeHistorique.mjs';
import { chargerPlaywright, demarrerSite, deverrouiller, pause, premierLancement, racine, toucher } from './mobile-outils.mjs';

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-claude-office');
mkdirSync(CAPTURES, { recursive: true });
const MDP = 'mot-de-passe-historique-très-long-42';
const log = (...a) => console.log('[historique]', ...a);
let echec = false;
const verifier = (ok, quoi) => {
  if (!ok) echec = true;
  log(`${ok ? 'OK' : 'ÉCHEC'} : ${quoi}`);
};

// 1. Journal d'essai écrit par le VRAI hook, comme Claude Code le ferait (application fermée).
const dossier = mkdtempSync(join(tmpdir(), 'e2e-historique-'));
const hook = join(racine, 'scripts', 'office-historique-hook.mjs');
const evenements = [
  { hook_event_name: 'SessionStart', source: 'startup', session_id: 'sess-budget', cwd: 'C:\\Users\\moi\\AppDashboard' },
  { hook_event_name: 'UserPromptSubmit', prompt: 'Ajoute un export CSV des dépenses du budget', session_id: 'sess-budget', cwd: 'C:\\Users\\moi\\AppDashboard' },
  { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: 'C:\\Users\\moi\\AppDashboard\\budget\\js\\export.js' }, tool_response: 'x'.repeat(5000), session_id: 'sess-budget', cwd: 'C:\\Users\\moi\\AppDashboard' },
  { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test', description: 'Lance les tests' }, tool_response: { stdout: 'ok' }, session_id: 'sess-budget', cwd: 'C:\\Users\\moi\\AppDashboard' },
  { hook_event_name: 'Stop', session_id: 'sess-budget', cwd: 'C:\\Users\\moi\\AppDashboard' },
  { hook_event_name: 'UserPromptSubmit', prompt: 'Mon token GitHub est ghp_abcdefghijklmnopqrstuvwxyz0123456789, pousse la branche', session_id: 'sess-tsu', cwd: '/home/moi/tsuzuku' },
  { hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: '/home/moi/tsuzuku/src/lecteur.ts' }, session_id: 'sess-tsu', cwd: '/home/moi/tsuzuku' },
];
for (const e of evenements) {
  const r = spawnSync(process.execPath, [hook], { input: JSON.stringify(e), env: { ...process.env, OFFICE_HISTORIQUE_DIR: dossier }, encoding: 'utf8' });
  if (r.status !== 0 || r.stdout) throw new Error('Le hook a échoué ou écrit sur la sortie standard.');
}
const { entrees } = lireJournal(dossier);
verifier(entrees.length === evenements.length, `${entrees.length} entrées écrites par le hook`);
verifier(!JSON.stringify(entrees).includes('ghp_abcdef'), 'jeton GitHub masqué dans le journal');
verifier(!JSON.stringify(entrees).includes('xxxxx'), 'sortie d’outil non enregistrée par défaut');
rmSync(dossier, { recursive: true, force: true });

const site = await demarrerSite(5263);
const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
try {
  const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await contexte.newPage();
  const secret = await premierLancement(page, { site: site.url, motDePasse: MDP });
  await toucher(page, 'acceptation-case').catch(() => undefined);
  await toucher(page, 'acceptation-continuer').catch(() => undefined);
  await page.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(page, MDP, secret));
  await page.getByText(/Fermer|Terminé|Compris|Plus tard/).first().click({ timeout: 3000 }).catch(() => undefined);
  const prendre = async nom => {
    await pause(1000);
    await page.mouse.move(1, 1);
    await page.screenshot({ path: join(CAPTURES, `${nom}.png`), fullPage: false });
    log(`${nom} : capturé`);
  };
  const tuile = page.locator('[data-testid="cellule-claude-office"]');
  // La tuile est rangée dans l'onglet « Administration » du hub.
  if (!(await tuile.isVisible().catch(() => false))) await page.getByText(/Administration$/).first().click().catch(() => undefined);
  await tuile.waitFor({ timeout: 20_000 }).catch(async e => {
    await page.screenshot({ path: join(CAPTURES, 'echec-historique.png') });
    throw e;
  });

  // Site : pas de journal ici, l'écran le dit.
  await tuile.click();
  await page.getByTestId('claude-office-onglet-historique').click();
  await page.getByTestId('historique-hors-pc').waitFor();
  verifier((await page.getByTestId('historique-supprimer-tout').count()) === 0, 'site : aucune suppression proposée');
  await page.getByTestId('retour-hub').first().click();
  if (!(await tuile.isVisible().catch(() => false))) await page.getByText(/Administration$/).first().click().catch(() => undefined);

  // PC : faux pont qui sert le journal d'essai.
  await page.evaluate(journal => {
    window.__appels = { supprimer: 0, installer: 0, lire: 0 };
    const lecture = {
      ok: true, dossier: 'C:/Users/moi/.agent-office/historique', entrees: journal, total: journal.length, ignorees: 0, octets: 4096, fichiers: 1,
      reglages: { actif: true, enregistrerSorties: false, masquerSecrets: true, maxFichierMo: 10, maxTotalMo: 200, appareil: null, appareilId: journal[0].appareilId },
    };
    window.applibourse = {
      bureau: true,
      claudeOffice: {
        etat: async () => ({ url: 'http://127.0.0.1:3334', dossier: null, hooks: 'inconnus', historique: 'installes', serveur: { joignable: false } }),
        choisirDossier: async () => ({ ok: false }), reglerUrl: async url => ({ ok: true, url }),
        apercuHooks: async () => ({ ok: false }), installerHooks: async () => ({ ok: false, annule: true }), ouvrir: async () => true,
        historique: {
          lire: async () => ((window.__appels.lire += 1), lecture),
          reglages: async () => ({ ok: true, reglages: lecture.reglages }),
          supprimer: async () => ((window.__appels.supprimer += 1), { ok: false, annule: true }),
          importer: async () => ({ ok: false, annule: true }),
          apercuHooks: async () => ({ ok: true, plan: { fichier: 'C:/Users/moi/.claude/settings.json', existe: true, commande: 'node "C:/Users/moi/AppDashboard/scripts/office-historique-hook.mjs"', change: false, ajouts: [], retraits: [], description: 'Hooks déjà installés à l’identique : rien à faire.' } }),
          installerHooks: async () => ((window.__appels.installer += 1), { ok: true, ecrit: false }),
        },
      },
    };
  }, entrees);
  await tuile.click();
  await page.getByTestId('claude-office-onglet-historique').click();
  await page.getByTestId('historique-compteurs').waitFor();
  verifier((await page.getByTestId('historique-compte-entrées').innerText()).trim() === String(evenements.length), 'compteur des entrées');
  verifier(await page.getByText(/Installé : chaque requête/).isVisible(), 'état du hook affiché');
  await prendre('4-historique-pc');
  await page.getByTestId('historique-recherche').fill('export csv');
  await page.getByText(/Ajoute un export CSV/).first().waitFor();
  verifier((await page.getByTestId('historique-compte-entrées').innerText()).trim() === '1', 'recherche plein texte');
  await page.getByTestId('historique-recherche').fill('');
  await page.getByTestId('filtre-projet-tsuzuku').click();
  verifier((await page.getByTestId('historique-compte-entrées').innerText()).trim() === '2', 'filtre par projet');
  await page.getByText(/Mon token GitHub/).first().click();
  const detail = await page.getByTestId('historique-detail-texte').innerText();
  verifier(detail.includes('[secret masqué]') && !detail.includes('ghp_abcdef'), 'détail : secret masqué');
  await prendre('5-historique-detail');
  const appels = await page.evaluate(() => window.__appels);
  verifier(appels.supprimer === 0 && appels.installer === 0, 'aucune suppression ni installation sans clic');
  verifier(appels.lire >= 1, 'journal lu par le pont');
} finally {
  await navigateur.close();
  site.fermer();
}
process.exit(echec ? 1 : 0);
