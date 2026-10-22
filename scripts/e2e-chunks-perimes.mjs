/**
 * Morceaux JS périmés après un déploiement : le site est construit, ouvert, puis le morceau de l'Esport
 * est SUPPRIMÉ à la main (comme le fait un déploiement qui efface l'ancien assets/). En ouvrant l'Esport :
 *
 *  - la page se recharge automatiquement UNE fois, sans écran « Affichage impossible » ;
 *  - si le morceau manque toujours (ici : jamais redéployé), l'erreur qui revient n'entraîne PAS de boucle :
 *    l'écran « Une nouvelle version est disponible » et son bouton « Recharger » remplacent le message technique ;
 *  - version.json servi sans cache : au retour sur l'onglet, « Nouvelle version — recharger » s'affiche
 *    quand l'identifiant publié change.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-chunks-perimes.mjs
 */

import http from 'node:http';
import { cpSync, createReadStream, existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { allerPageApplications, tuileApp } from './e2e-acceptation.mjs';
import { chargerPlaywright, pause, premierLancement, racine, deverrouiller, toucher } from './mobile-outils.mjs';

const log = (...a) => console.log('[e2e-chunks]', ...a);
let echecs = 0;
const verifier = (ok, message) => {
  console.log(ok ? '  OK   ' : '  ECHEC', message);
  if (!ok) echecs++;
};
const MDP = 'mot-de-passe-e2e-chunks-perimes-très-long-42';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

// Copie du build : on y supprime un morceau sans toucher à bureau/dist.
const dist = mkdtempSync(join(tmpdir(), 'chunks-perimes-'));
cpSync(join(racine, 'bureau/dist'), dist, { recursive: true });
const serveur = http.createServer((req, res) => {
  const chemin = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  let fichier = join(dist, chemin);
  const existe = existsSync(fichier) && !statSync(fichier).isDirectory();
  if (!existe && chemin.startsWith('/assets/')) {
    res.writeHead(404);
    return res.end('introuvable');
  }
  if (!existe) fichier = join(dist, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[extname(fichier)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  createReadStream(fichier).pipe(res);
});
await new Promise(ok => serveur.listen(0, ok));
const site = `http://localhost:${serveur.address().port}/`;

const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch();
try {
  const contexte = await navigateur.newContext({ locale: 'fr-FR', viewport: { width: 1440, height: 900 } });
  const page = await contexte.newPage();
  let navigations = 0;
  page.on('framenavigated', f => f === page.mainFrame() && navigations++);
  const secret = await premierLancement(page, { site, motDePasse: MDP });
  await toucher(page, 'acceptation-case').catch(() => undefined);
  await toucher(page, 'acceptation-continuer').catch(() => undefined);
  page.on('pageerror', e => log('erreur page :', e.message));
  await page.getByTestId('hub').waitFor({ timeout: 30_000 }).catch(async () => { await page.screenshot({ path: '/tmp/chunks.png' }); log((await page.locator('body').innerText()).slice(0, 400)); throw new Error('hub absent'); });
  for (let i = 0; i < 3; i++) {
    if (!(await page.getByText(/^(Fermer|Terminé|Compris|Plus tard)$/).first().click({ timeout: 2000 }).then(() => true, () => false))) break;
  }
  log('hub affiché');

  // Un déploiement efface l'ancien morceau de l'Esport.
  const morceau = readdirSync(join(dist, 'assets')).find(f => /^RacineEsport-.*\.js$/.test(f));
  verifier(!!morceau, `morceau de l'Esport trouvé (${morceau})`);
  rmSync(join(dist, 'assets', morceau));

  const avant = navigations;
  await allerPageApplications(page);
  await tuileApp(page, 'esport').first().click();
  // Rechargement automatique : la page repart (écran de déverrouillage, coffre fermé).
  const recharge = await page.getByTestId('bouton-deverrouiller').waitFor({ timeout: 30_000 }).then(() => true, () => false);
  verifier(recharge, 'la page s\'est rechargée automatiquement');
  verifier(navigations > avant, 'une navigation (rechargement) a eu lieu');
  verifier((await page.getByTestId('garde-erreur').count()) === 0, 'aucun écran « Affichage impossible » après le rechargement');
  const garde = await page.evaluate(() => sessionStorage.getItem('enzo:rechargement-chunk'));
  verifier(!!garde, 'garde-fou posé dans sessionStorage');

  // Le morceau manque toujours : pas de seconde boucle, message « nouvelle version ».
  await deverrouiller(page, MDP, secret);
  const apres = navigations;
  await allerPageApplications(page);
  await tuileApp(page, 'esport').first().click();
  const ecran = await page.getByTestId('garde-erreur-version').waitFor({ timeout: 30_000 }).then(() => true, () => false);
  verifier(ecran, 'l\'erreur qui revient affiche « Une nouvelle version est disponible »');
  verifier(/Une nouvelle version est disponible/.test(await page.locator('body').innerText()), 'texte « Une nouvelle version est disponible »');
  verifier(!/Failed to fetch dynamically imported module/.test(await page.locator('body').innerText()), 'plus de message technique');
  verifier(await page.getByTestId('garde-erreur-recharger').count() === 1, 'bouton « Recharger » présent');
  await pause(1500);
  verifier(navigations === apres, 'aucun deuxième rechargement automatique (pas de boucle)');

  // Bonus : version.json différent → bandeau au retour sur l'onglet.
  const p2 = await contexte.newPage();
  await premierLancementOuDeverrou(p2);
  async function premierLancementOuDeverrou(p) {
    await p.goto(site);
    await p.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 });
    await deverrouiller(p, MDP, secret);
  }
  verifier((await p2.getByTestId('bandeau-nouvelle-version').count()) === 0, 'pas de bandeau tant que la version est la même');
  writeFileSync(join(dist, 'version.json'), '{"id":"autre-build"}\n');
  await p2.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const bandeau = await p2.getByTestId('bandeau-nouvelle-version').waitFor({ timeout: 10_000 }).then(() => true, () => false);
  verifier(bandeau, 'bandeau « Nouvelle version — recharger » au retour sur l\'onglet');
} finally {
  await navigateur.close();
  serveur.close();
  rmSync(dist, { recursive: true, force: true });
}
console.log(echecs ? `\n${echecs} ÉCHEC(S)` : '\nTout est OK');
process.exit(echecs ? 1 : 0);
