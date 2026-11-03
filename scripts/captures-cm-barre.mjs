/**
 * Captures de l'espace CM du club rangé dans la barre latérale (comme une team) : PC 1440 × 900 (Accueil CM, groupes et
 * sous-onglets, visuels par défaut rangés, sélecteurs « ⇄ Changer » dans les deux sens, barre réduite) et iPhone
 * 390 × 844 (sélecteur de groupe puis sous-onglets en haut de page). Serveur Esport local avec graines, Fondateur.
 *
 *   npx vite build
 *   SORTIE=/chemin PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/captures-cm-barre.mjs
 */

import { existsSync, mkdirSync, statSync, createReadStream } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { allerPageApplications, nouveauContexte, tuileApp } from './e2e-acceptation.mjs';
import { chargerPlaywright, demarrerRelais, deverrouiller, mesurer, pause, premierLancement, racine } from './mobile-outils.mjs';

const SORTIE = process.env.SORTIE ?? join(racine, '.captures-cm-barre');
mkdirSync(SORTIE, { recursive: true });
const JETON = 'jeton-captures-esport-0123456789abcd';
const PORT_RELAIS = 8893;
const PORT_ESPORT = 8894;
const PORT_SITE = 5393;
const MDP = 'mot-de-passe-captures-esport-tres-long-42';
const log = (...a) => console.log('[captures]', ...a);

const { demarrerServeurEsport } = await import(pathToFileURL(join(racine, 'esport/outils/serveur-local.mjs')).href);
const relais = await demarrerRelais(PORT_RELAIS, JETON);
const esport = await demarrerServeurEsport({ port: PORT_ESPORT, jetonDev: JETON, graines: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const dist = process.env.DIST ?? join(racine, 'bureau/dist');
if (!existsSync(join(dist, 'index.html'))) throw new Error('bureau/dist absent : lancez « npx vite build » d’abord');
const serveur = http.createServer((req, res) => {
  const chemin = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  if (chemin === '/relais.json' || chemin === '/esport.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(chemin === '/relais.json' ? { relais: `https://localhost:${PORT_RELAIS}` } : { esport: esport.url }));
    return;
  }
  let fichier = join(dist, chemin);
  if (!existsSync(fichier) || statSync(fichier).isDirectory()) fichier = join(dist, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[extname(fichier)] ?? 'application/octet-stream' });
  createReadStream(fichier).pipe(res);
});
await new Promise(ok => serveur.listen(PORT_SITE, ok));

async function api(chemin, jeton, { methode = 'GET', corps } = {}) {
  const r = await fetch(`${esport.url}${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jeton}` }, body: corps ? JSON.stringify(corps) : undefined });
  return r.json().catch(() => null);
}
// Seconde team (pour le Dashboard et le sélecteur de team).
const session = (await api('/session', JETON, { methode: 'POST' })).session;
await api('/teams', session, { methode: 'POST', corps: { nom: 'Faucons Académie', jeu: 'valorant', preset: 'minimal', description: 'L’équipe réserve : entraînements du mardi et du jeudi.' } });


const present = (page, id, delai = 1500) => page.getByTestId(id).first().waitFor({ timeout: delai }).then(() => true, () => false);
const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
try {
  const ctx = await nouveauContexte(navigateur, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => log('erreur page :', e.message));
  const secret = await premierLancement(page, { site: `http://localhost:${PORT_SITE}/`, code: relais.code, motDePasse: MDP });
  await page.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(page, MDP, secret));
  for (let i = 0; i < 3; i++) if (!(await page.getByText(/^(Fermer|Terminé|Compris|Plus tard)$/).first().click({ timeout: 2000 }).then(() => true, () => false))) break;
  for (const [nom, taille] of [['1440x900', { width: 1440, height: 900 }], ['390x844', { width: 390, height: 844 }]]) {
    await page.setViewportSize(taille);
    await pause(600);
    if (await page.getByTestId('app-esport').count()) await page.getByTestId('retour-hub').first().click();
    await page.evaluate(() => localStorage.removeItem('esport.barre-laterale-reduite'));
    await allerPageApplications(page);
    await tuileApp(page, 'esport').first().click();
    await page.getByTestId('app-esport').waitFor({ timeout: 20_000 });
    if (await present(page, 'esport-profil-initial', 3000)) {
      await page.getByTestId('esport-pseudo').fill('Fondateur');
      await page.getByTestId('esport-pseudo-valider').click();
    }
    await page.getByTestId('esport-nav-teams').first().click();
    await page.getByTestId('esport-teams-cm-ouvrir').waitFor({ timeout: 15_000 });
    await page.getByTestId('esport-teams-cm-ouvrir').click();
    await page.getByTestId('esport-cm').waitFor({ timeout: 15_000 });
    await pause(1500);
    await page.screenshot({ path: join(SORTIE, `${nom}-cm-etendue.png`) });
    if (nom === '1440x900') {
      // Contenus : sous-onglets Tableaux | À valider | Calendrier en haut de la page.
      await page.getByTestId('esport-cm-groupe-contenus').click();
      await page.getByTestId('esport-cm-onglet-calendrier').click();
      await pause(1200);
      await page.screenshot({ path: join(SORTIE, `${nom}-cm-calendrier.png`) });
      // Médias › Visuels : un modèle par défaut rangé dans un dossier (sans changer le modèle).
      await page.getByTestId('esport-cm-groupe-medias').click();
      await page.getByTestId('esport-cm-onglet-visuels').click();
      await page.getByTestId('esport-vi-modeles-defaut-resultat').waitFor({ timeout: 15_000 });
      await pause(1200);
      await page.mouse.move(800, 400);
      await page.mouse.wheel(0, -6000);
      await pause(400);
      await page.screenshot({ path: join(SORTIE, `${nom}-cm-visuels-avant.png`) });
      await page.mouse.move(800, 400);
      await page.mouse.wheel(0, -6000);
      await pause(400);
      await page.getByTestId('esport-vi-modeles-defaut-resultat-menu').click();
      await page.getByText('Déplacer vers…').click();
      await page.getByTestId('esport-vi-modeles-destination').getByText('Résultats').first().click();
      await page.getByTestId('esport-vi-modeles-destination-ok').click();
      await pause(1500);
      await page.mouse.wheel(0, -6000);
      await pause(400);
      await page.screenshot({ path: join(SORTIE, `${nom}-cm-visuels-range.png`) });
      await page.getByTestId('esport-vi-modeles-reinitialiser').waitFor({ timeout: 5000 });
      await page.getByTestId('esport-vi-modeles-reinitialiser').click();
      await page.getByText('Remettre les modèles par défaut à leur place d’origine ?').click();
      await pause(800);
      // « ⇄ Changer » du CM : Teams et toutes les teams ; puis « ⇄ Changer de team » d'une team : « CM du club » en tête.
      await page.getByTestId('esport-cm-changer').click();
      await pause(500);
      await page.screenshot({ path: join(SORTIE, `${nom}-cm-changer.png`) });
      await page.locator('[role="menuitem"][data-testid^="esport-cm-changer-"]').nth(1).click();
      await page.getByTestId('esport-team').waitFor({ timeout: 15_000 });
      await page.getByTestId('esport-changer-team').click();
      await pause(500);
      await page.screenshot({ path: join(SORTIE, `${nom}-team-changer.png`) });
      await page.getByTestId('esport-changer-cm').click();
      await page.getByTestId('esport-cm').waitFor({ timeout: 15_000 });
      await page.getByTestId('esport-cm-groupe-medias').click();
      await page.getByTestId('esport-barre-bascule').click();
      await pause(700);
      await page.getByTestId('esport-cm-groupe-contenus').hover();
      await pause(400);
      await page.getByTestId('esport-barre-infobulle').waitFor({ timeout: 3000 });
      await page.screenshot({ path: join(SORTIE, `${nom}-cm-reduite.png`) });
      await page.getByTestId('esport-barre-bascule').click();
    } else {
      await page.getByTestId('esport-cm-sections').click();
      await pause(500);
      await page.screenshot({ path: join(SORTIE, `${nom}-cm-menu-sections.png`) });
      await page.getByTestId('esport-cm-groupe-contenus').click();
      await pause(900);
      await page.screenshot({ path: join(SORTIE, `${nom}-cm-sous-onglets.png`) });
    }
    log(nom);
  }
} finally {
  await navigateur.close();
  serveur.close();
  await esport.fermer?.();
  await relais.fermer?.();
}
process.exit(0);
