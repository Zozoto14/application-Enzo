/**
 * Non-régression du bureau, Administration : capture cinq écrans (tableau de bord, utilisateurs,
 * applications, abonnements, sécurité) à 1280×800 et, si REFERENCE est donné, compare pixel à pixel.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers CAPTURES=docs/mobile/captures-bureau-administration-avant node scripts/captures-bureau-administration.mjs
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers CAPTURES=docs/mobile/captures-bureau-administration-apres REFERENCE=docs/mobile/captures-bureau-administration-avant node scripts/captures-bureau-administration.mjs
 *
 * L'heure est figée (Date.now fixe) : deux passes du même code donnent les mêmes pixels.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chargerPlaywright, demarrerSite, deverrouiller, pause, premierLancement, racine, toucher } from './mobile-outils.mjs';

const CAPTURES = join(racine, process.env.CAPTURES ?? 'docs/mobile/captures-bureau-administration-apres');
const REFERENCE = process.env.REFERENCE ? join(racine, process.env.REFERENCE) : undefined;
mkdirSync(CAPTURES, { recursive: true });
const MDP = 'mot-de-passe-bureau-très-long-42';
const log = (...a) => console.log('[bureau-admin]', ...a);

const site = await demarrerSite(Number(process.env.PORT_SITE ?? 5293));
const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
let ecarts = 0;
try {
  const page = await (await navigateur.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })).newPage();
  await page.clock.setFixedTime(new Date('2026-10-01T10:00:00'));
  const secret = await premierLancement(page, { site: site.url, motDePasse: MDP });
  await toucher(page, 'acceptation-case').catch(() => undefined);
  await toucher(page, 'acceptation-continuer').catch(() => undefined);
  await page.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(page, MDP, secret));
  await page.getByText(/Fermer|Terminé|Compris|Plus tard/).first().click({ timeout: 3000 }).catch(() => undefined);
  await page.locator('[data-testid="cellule-administration"], [data-testid="tuile-administration"]').first().click();
  await page.getByTestId('app-administration').waitFor({ timeout: 20_000 });
  const prendre = async nom => {
    await pause(1200);
    await page.mouse.move(1, 1);
    const image = await page.screenshot({ path: join(CAPTURES, `${nom}.png`), animations: 'disabled', caret: 'hide' });
    if (REFERENCE) {
      const ref = join(REFERENCE, `${nom}.png`);
      const identique = existsSync(ref) && readFileSync(ref).equals(image);
      if (!identique) ecarts++;
      log(`${nom} : ${identique ? 'identique à la référence' : 'DIFFÉRENT de la référence'}`);
    } else log(`${nom} : capturé`);
  };
  await prendre('1-tableau');
  for (const [id, nom] of [['utilisateurs', '2-utilisateurs'], ['applications', '3-applications'], ['abonnements', '4-abonnements'], ['securite', '5-securite']]) {
    await page.getByTestId(`admin-onglet-${id}`).click();
    await page.getByTestId(`admin-section-${id}`).waitFor();
    await prendre(nom);
  }
} finally {
  await navigateur.close();
  site.fermer();
}
process.exit(ecarts > 0 ? 1 : 0);
