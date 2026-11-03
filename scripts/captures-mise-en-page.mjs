/**
 * Captures de la mise en page de l'Esport (avant / après, barre latérale réduite) : serveur Esport local
 * avec ses graines (team « Faucons Valorant » complète) et une seconde team,
 * le Fondateur sur le site construit (bureau/dist).
 *
 * Chaque écran (Dashboard, Teams, Membres, et chaque section de la team) est
 * pris sur PC (1440 × 900), iPad (1024 × 1366) et iPhone (390 × 844), en
 * sombre (Nuit) et en clair (Ivoire). Les pages principales vont, en PNG
 * compressé, dans docs/captures-esport-refonte/<PHASE>/ ; tout le reste (audit)
 * dans AUDIT (JPEG), avec les mesures iPhone (débordement, cibles, textes).
 *
 *   npx vite build
 *   PHASE=apres AUDIT=/tmp/audit PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/captures-esport-refonte.mjs
 */

import { existsSync, mkdirSync, statSync, createReadStream } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { allerPageApplications, nouveauContexte, tuileApp } from './e2e-acceptation.mjs';
import { chargerPlaywright, demarrerRelais, deverrouiller, mesurer, pause, premierLancement, racine } from './mobile-outils.mjs';

const PHASE = process.env.PHASE ?? 'apres';
const SORTIE = process.env.SORTIE ?? join(racine, '.captures-mise-en-page', PHASE);
mkdirSync(SORTIE, { recursive: true });
const JETON = 'jeton-captures-esport-0123456789abcd';
const PORT_RELAIS = 8891;
const PORT_ESPORT = 8892;
const PORT_SITE = 5391;
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
const FORMATS = [
  ['1024x768', { width: 1024, height: 768 }],
  ['1280x800', { width: 1280, height: 800 }],
  ['1440x900', { width: 1440, height: 900 }],
  ['1920x1080', { width: 1920, height: 1080 }],
  ['390x844', { width: 390, height: 844 }],
];
const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
const mesures = {};
try {
  const ctx = await nouveauContexte(navigateur, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => log('erreur page :', e.message));
  const secret = await premierLancement(page, { site: `http://localhost:${PORT_SITE}/`, code: relais.code, motDePasse: MDP });
  await page.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(page, MDP, secret));
  for (let i = 0; i < 3; i++) if (!(await page.getByText(/^(Fermer|Terminé|Compris|Plus tard)$/).first().click({ timeout: 2000 }).then(() => true, () => false))) break;
  for (const [nom, taille] of FORMATS) {
    await page.setViewportSize(taille);
    await pause(600);
    if (await page.getByTestId('app-esport').count()) await page.getByTestId('retour-hub').first().click();
    await page.evaluate(() => localStorage.removeItem('esport.barre-laterale-reduite')); // choix par défaut de la largeur
    await allerPageApplications(page);
    await tuileApp(page, 'esport').first().click();
    await page.getByTestId('app-esport').waitFor({ timeout: 20_000 });
    if (await present(page, 'esport-team-retour', 2500)) await page.getByTestId('esport-team-retour').first().click();
    if (await present(page, 'esport-profil-initial', 3000)) {
      await page.getByTestId('esport-pseudo').fill('Fondateur');
      await page.getByTestId('esport-pseudo-valider').click();
    }
    const mesure = () => page.evaluate(() => ({ debordement: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
    for (const onglet of ['dashboard', 'teams', 'membres']) {
      await page.getByTestId(`esport-nav-${onglet}`).first().click();
      await pause(1200);
      await page.screenshot({ path: join(SORTIE, `${nom}-${onglet}.png`) });
      mesures[`${nom}-${onglet}`] = await mesure();
    }
    // Barre latérale : état inverse (réduite si étendue, étendue si réduite), PC seulement.
    if (await present(page, 'esport-barre-bascule', 800)) {
      await page.getByTestId('esport-nav-dashboard').first().click();
      await page.getByTestId('esport-barre-bascule').click();
      await pause(700);
      await page.screenshot({ path: join(SORTIE, `${nom}-dashboard-barre-inverse.png`) });
      await page.getByTestId('esport-barre-bascule').click();
    }
    log(nom);
  }
  console.log(JSON.stringify(mesures));
} finally {
  await navigateur.close();
  serveur.close();
  await esport.fermer?.();
  await relais.fermer?.();
}
process.exit(0);
