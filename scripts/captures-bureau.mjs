/**
 * Non-régression du bureau : capture trois écrans (hub, Paramètres, portefeuille) dans une fenêtre de PC
 * (1280×800) et, si un dossier de référence est donné, compare pixel à pixel.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers CAPTURES=docs/mobile/captures-bureau-avant node scripts/captures-bureau.mjs
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers CAPTURES=docs/mobile/captures-bureau-apres REFERENCE=docs/mobile/captures-bureau-avant node scripts/captures-bureau.mjs
 *
 * Les écrans sont figés (horloge arrêtée, pas de relais : « non relié ») pour que deux passes du même code
 * donnent exactement les mêmes pixels. Le code de sortie vaut 1 si une capture diffère de sa référence.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chargerPlaywright, demarrerSite, deverrouiller, pause, premierLancement, racine, toucher } from './mobile-outils.mjs';

const CAPTURES = join(racine, process.env.CAPTURES ?? 'docs/mobile/captures-bureau-apres');
const REFERENCE = process.env.REFERENCE ? join(racine, process.env.REFERENCE) : undefined;
mkdirSync(CAPTURES, { recursive: true });
const MDP = 'mot-de-passe-bureau-très-long-42';
const log = (...a) => console.log('[bureau]', ...a);

const site = await demarrerSite(5251);
const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
let ecarts = 0;
try {
  const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await contexte.newPage();
  // Heure figée : la salutation et les « il y a » ne bougent pas d'une passe à l'autre.
  await page.clock.install({ time: new Date('2026-10-01T10:00:00') });
  await page.clock.pauseAt(new Date('2026-10-01T10:00:00'));
  await page.clock.resume();
  const secret = await premierLancement(page, { site: site.url, motDePasse: MDP });
  await toucher(page, 'acceptation-case').catch(() => undefined);
  await toucher(page, 'acceptation-continuer').catch(() => undefined);
  await page.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(page, MDP, secret));
  await page.getByText(/Fermer|Terminé|Compris|Plus tard/).first().click({ timeout: 3000 }).catch(() => undefined);
  await page.mouse.move(1, 1);

  const prendre = async nom => {
    await pause(1200);
    await page.mouse.move(1, 1);
    const fichier = join(CAPTURES, `${nom}.png`);
    const image = await page.screenshot({ path: fichier, animations: 'disabled', caret: 'hide' });
    if (REFERENCE) {
      const ref = join(REFERENCE, `${nom}.png`);
      const identique = existsSync(ref) && readFileSync(ref).equals(image);
      if (!identique) ecarts++;
      log(`${nom} : ${identique ? 'identique à la référence' : 'DIFFÉRENT de la référence'}`);
    } else {
      log(`${nom} : capturé`);
    }
  };
  await page.getByTestId('hub').waitFor();
  await prendre('1-hub');
  await page.getByTestId('hub-parametres-ouvrir').click();
  await page.getByTestId('hub-parametres').waitFor();
  await prendre('2-parametres');
  await page.getByTestId('hub-parametres-fermer').click();
  await page.locator('[data-testid="cellule-portefeuille"]').click();
  await page.getByTestId('nav-tableau').waitFor({ timeout: 20_000 });
  await prendre('3-portefeuille');
} finally {
  await navigateur.close();
  site.fermer();
}
process.exit(ecarts > 0 ? 1 : 0);
