/**
 * Captures de Claude Office dans le bureau (fenêtre de PC 1280×800) : la tuile dans le hub, l'écran sur le
 * site (onglet « Bureau » natif, état vide), puis l'écran avec un faux pont du PC (options avancées : serveur en
 * marche, aperçu des hooks). Le bureau natif lui-même : scripts/e2e-claude-office-bureau.mjs.
 * Vérifie au passage que rien ne s'installe sans clic.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-claude-office.mjs
 *
 * Variable : CAPTURES (dossier des captures, défaut docs/captures-claude-office).
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { allerPageAdministration } from './e2e-acceptation.mjs';
import { chargerPlaywright, demarrerSite, deverrouiller, pause, premierLancement, racine, toucher } from './mobile-outils.mjs';

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-claude-office');
mkdirSync(CAPTURES, { recursive: true });
const MDP = 'mot-de-passe-claude-office-très-long-42';
const log = (...a) => console.log('[claude-office]', ...a);

const site = await demarrerSite(5261);
const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
let echec = false;
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
    await page.screenshot({ path: join(CAPTURES, `${nom}.png`) });
    log(`${nom} : capturé`);
  };

  // La tuile est sur la page « Administration » du hub.
  await allerPageAdministration(page);
  const tuile = page.locator('[data-testid="cellule-claude-office"]');
  await tuile.waitFor({ timeout: 20_000 });
  await prendre('1-hub-tuile');
  await tuile.click();
  await page.getByTestId('bureau-vide').waitFor();
  if ((await page.getByTestId('claude-office-avance').count()) !== 0) {
    echec = true;
    log('ÉCHEC : options du PC proposées sur le site');
  }
  await prendre('2-ecran-site');
  await page.getByTestId('retour-hub').first().click();

  // Faux pont du PC, posé après le déverrouillage (le reste de l'app ne le lit pas ici).
  await page.evaluate(() => {
    window.__appelsInstaller = 0;
    const plan = {
      fichier: 'C:/Users/moi/.claude/settings.json', existe: true, commande: 'node "D:/AppDashboard/Claude Office/hooks/agent-tracker.mjs" claude',
      change: true, ajouts: ['UserPromptSubmit', 'PreToolUse'], retraits: [],
      description: 'Fichier : C:/Users/moi/.claude/settings.json\nCommande lancée par Claude Code à chaque événement : node "D:/AppDashboard/Claude Office/hooks/agent-tracker.mjs" claude\n  + UserPromptSubmit : ajoute (matcher "*")\n  + PreToolUse : ajoute (matcher "*")\nUne copie de sauvegarde horodatée sera faite avant l’écriture.',
    };
    window.applibourse = {
      bureau: true,
      claudeOffice: {
        etat: async () => ({ url: 'http://127.0.0.1:3334', dossier: 'D:/AppDashboard/Claude Office', hooks: 'absents', serveur: { joignable: true, agents: 3, clients: 1 } }),
        choisirDossier: async () => ({ ok: false }),
        reglerUrl: async url => ({ ok: true, url }),
        apercuHooks: async () => ({ ok: true, plan }),
        installerHooks: async () => ((window.__appelsInstaller += 1), { ok: false, annule: true }),
        ouvrir: async () => true,
      },
    };
  });
  await allerPageAdministration(page);
  await tuile.click();
  // Le vrai Claude Office (fenêtre à part) est une option avancée, repliée par défaut.
  await page.getByTestId('claude-office-avance-basculer').click();
  await page.getByTestId('claude-office-serveur').waitFor();
  await page.getByText(/3 agents actifs/).waitFor();
  if ((await page.evaluate(() => window.__appelsInstaller)) !== 0) {
    echec = true;
    log('ÉCHEC : installation appelée sans clic');
  }
  await page.getByTestId('claude-office-apercu').click();
  await page.getByTestId('claude-office-plan').waitFor();
  await prendre('3-ecran-pc-apercu');
  log('aucune installation sans clic : OK');
} finally {
  await navigateur.close();
  site.fermer();
}
process.exit(echec ? 1 : 0);
