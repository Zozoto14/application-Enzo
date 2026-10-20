/**
 * Captures de l'Esport pour la refonte (avant / après) : serveur Esport local
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

import { existsSync, mkdirSync, statSync, writeFileSync, createReadStream } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { allerPageApplications, nouveauContexte, tuileApp } from './e2e-acceptation.mjs';
import { chargerPlaywright, demarrerRelais, deverrouiller, mesurer, pause, premierLancement, racine } from './mobile-outils.mjs';
import { compacterPng } from './png-compact.mjs';

const PHASE = process.env.PHASE ?? 'apres';
const SORTIE = join(racine, 'docs/captures-esport-refonte', PHASE);
const AUDIT = process.env.AUDIT ?? join(racine, '.captures-audit', PHASE);
mkdirSync(SORTIE, { recursive: true });
mkdirSync(AUDIT, { recursive: true });
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
const dist = join(racine, 'bureau/dist');
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

/** Section de la team → groupe de la navigation (après la refonte). */
const GROUPES = {
  accueil: 'accueil',
  'module-planning': 'agenda',
  'module-availability': 'agenda',
  'module-attendance': 'agenda',
  'module-strat_editor': 'jeu',
  'module-playbook': 'jeu',
  'module-video_review': 'jeu',
  'module-scouting': 'jeu',
  'module-meeting_summaries': 'equipe',
  'module-goals_tasks': 'equipe',
  membres: 'equipe',
  parametres: 'reglages',
  'module-discord': 'reglages',
  journal: 'reglages',
};
const PRINCIPALES = new Set(['dashboard', 'teams', 'membres', 'accueil', 'module-planning', 'module-meeting_summaries', 'module-strat_editor']);
const NOMS = { dashboard: '1-dashboard', teams: '2-teams', membres: '3-membres', accueil: '4-accueil-team', 'module-planning': '5-planning', 'module-meeting_summaries': '6-resumes', 'module-strat_editor': '7-strats' };

const present = (page, id, delai = 1500) => page.getByTestId(id).first().waitFor({ timeout: delai }).then(() => true, () => false);

async function ouvrirEsport(page) {
  if (await page.getByTestId('app-esport').count()) await page.getByTestId('retour-hub').first().click();
  await allerPageApplications(page);
  await tuileApp(page, 'esport').first().click();
  await page.getByTestId('app-esport').waitFor({ timeout: 20_000 });
  if (await present(page, 'esport-team-retour', 2500)) await page.getByTestId('esport-team-retour').first().click();
}

async function changerTheme(page, theme) {
  if (await page.getByTestId('app-esport').count()) await page.getByTestId('retour-hub').first().click();
  await page.getByTestId('hub-parametres-ouvrir').click();
  await page.getByTestId(`parametres-theme-${theme}`).click();
  await page.getByTestId('hub-parametres-fermer').click();
  await page.getByTestId('hub').waitFor({ timeout: 20_000 });
}

async function allerSection(page, id) {
  const groupe = GROUPES[id];
  if (groupe && (await present(page, `esport-section-${groupe}`, 800))) await page.getByTestId(`esport-section-${groupe}`).first().click();
  if (await present(page, `esport-onglet-${id}`, 1500)) await page.getByTestId(`esport-onglet-${id}`).first().click();
}

const mesures = {};
async function prendre(page, theme, format, id, premierNiveau = false) {
  await pause(1400);
  const tampon = await page.screenshot({ type: 'png' });
  const nom = `${format}-${theme === 'nuit' ? 'sombre' : 'clair'}`;
  // « membres » : la page Membres de l'Esport (premier niveau), pas la section Membres et rôles de la team.
  if (PRINCIPALES.has(id) && (id !== 'membres' || premierNiveau) && format !== 'ipad') writeFileSync(join(SORTIE, `${NOMS[id]}-${nom}.png`), compacterPng(tampon));
  await page.screenshot({ path: join(AUDIT, `${nom}-${premierNiveau ? 'esport-' : ''}${id}.jpg`), type: 'jpeg', quality: 60 });
  if (format === 'iphone' && theme === 'nuit') {
    const m = await mesurer(page);
    mesures[`${premierNiveau ? 'esport-' : ''}${id}`] = { debordement: m.debordementPage, petitesCibles: m.petitesCibles, petitsTextes: m.petitsTextes, exemples: [...(m.exemplesCibles ?? []), ...(m.exemplesPetits ?? []), ...(m.deborde ?? [])].slice(0, 6) };
  }
  log(`${nom} ${id}`);
}

const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
const FORMATS = [
  ['pc', { width: 1440, height: 900 }],
  ['ipad', { width: 1024, height: 1366 }],
  ['iphone', { width: 390, height: 844 }],
];
try {
  const ctx = await nouveauContexte(navigateur, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => log('erreur page :', e.message));
  const secret = await premierLancement(page, { site: `http://localhost:${PORT_SITE}/`, code: relais.code, motDePasse: MDP });
  await page.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(page, MDP, secret));
  for (let i = 0; i < 3; i++) if (!(await page.getByText(/^(Fermer|Terminé|Compris|Plus tard)$/).first().click({ timeout: 2000 }).then(() => true, () => false))) break;
  const seulement = process.env.FORMATS ? process.env.FORMATS.split(',') : undefined;
  for (const theme of process.env.THEMES ? process.env.THEMES.split(',') : ['nuit', 'ivoire']) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await pause(500);
    await changerTheme(page, theme);
    for (const [format, taille] of FORMATS) {
      if (seulement && !seulement.includes(format)) continue;
      await page.setViewportSize(taille);
      await pause(600);
      await ouvrirEsport(page);
      if (await present(page, 'esport-profil-initial', 3000)) {
        await page.getByTestId('esport-pseudo').fill('Fondateur');
        await page.getByTestId('esport-pseudo-valider').click();
      }
      for (const onglet of ['dashboard', 'teams', 'membres']) {
        await page.getByTestId(`esport-nav-${onglet}`).first().click();
        await prendre(page, theme, format, onglet, true);
      }
      await page.getByTestId('esport-nav-teams').first().click();
      await page.getByTestId('esport-team-faucons-valorant').first().click();
      await page.getByTestId('esport-team').waitFor({ timeout: 20_000 });
      for (const id of Object.keys(GROUPES).filter(i => !process.env.PAGES || process.env.PAGES.split(',').includes(i))) {
        await allerSection(page, id);
        await prendre(page, theme, format, id);
      }
      await page.getByTestId('esport-team-retour').first().click();
    }
  }
  writeFileSync(join(AUDIT, 'mesures-iphone.json'), JSON.stringify(mesures, null, 2));
  log('mesures iPhone :', JSON.stringify(mesures, null, 1));
} finally {
  await navigateur.close();
  serveur.close();
  await esport.fermer?.();
  await relais.fermer?.();
}
process.exit(0);
