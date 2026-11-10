#!/usr/bin/env node
/**
 * Mesure de la vitesse du site (docs/performance.md) : build de production servi comme chez o2switch
 * (compression gzip, assets/ gardés un an, index.html et version.json revalidés), Chromium bridé
 * comme un iPad ou un PC moyen en 4G : réseau 1,6 Mb/s, 150 ms d'aller-retour, processeur 4 fois plus lent.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/mesure-performance.mjs [--sans-bridage] [--json]
 *
 * Scénarios :
 *  1. première visite, cache vide → écran d'accueil (JS transféré, LCP, TBT, temps) ;
 *  2. compte créé (non mesuré), puis visite suivante (cache chaud) → écran de déverrouillage ;
 *  3. déverrouillage → hub affiché ;
 *  4. ouverture de l'app Tâches depuis le hub, 6 s après son affichage (le code des apps est préchargé au repos
 *     4 s après l'affichage du hub : src/app/App.tsx).
 * Chaque scénario est mesuré `TOURS` fois (défaut 3), la médiane est rendue.
 */

import http from 'node:http';
import zlib from 'node:zlib';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chargerPlaywright, deverrouiller, pause, premierLancement, racine, toucher } from './mobile-outils.mjs';
import { allerPageApplications, tuileApp } from './e2e-acceptation.mjs';

const args = new Set(process.argv.slice(2));
const BRIDE = !args.has('--sans-bridage');
const TOURS = Number(process.env.TOURS ?? 3);
const MDP = 'mot-de-passe-mesure-performance-très-long-42';
const dist = join(racine, 'bureau/dist');
if (!existsSync(join(dist, 'index.html'))) throw new Error('bureau/dist absent : lancer « npx vite build » d’abord.');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json' };
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.wasm', '.webmanifest']);

// ---------------------------------------------------------------- Serveur « comme o2switch »
const cacheGz = new Map();
const serveur = http.createServer((req, res) => {
  const chemin = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  let fichier = join(dist, chemin);
  if (!existsSync(fichier) || statSync(fichier).isDirectory()) {
    if (chemin.startsWith('/assets/')) {
      res.writeHead(404);
      return res.end();
    }
    fichier = join(dist, 'index.html');
  }
  const ext = extname(fichier);
  const entetes = { 'Content-Type': MIME[ext] ?? 'application/octet-stream', Vary: 'Accept-Encoding' };
  entetes['Cache-Control'] = chemin.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
    let corps = cacheGz.get(fichier);
    if (!corps) cacheGz.set(fichier, (corps = zlib.gzipSync(readFileSync(fichier), { level: 6 })));
    res.writeHead(200, { ...entetes, 'Content-Encoding': 'gzip', 'Content-Length': corps.length });
    return res.end(corps);
  }
  res.writeHead(200, { ...entetes, 'Content-Length': statSync(fichier).size });
  createReadStream(fichier).pipe(res);
});
await new Promise(ok => serveur.listen(0, ok));
const site = `http://localhost:${serveur.address().port}/`;

// ---------------------------------------------------------------- Mesures dans la page
const SONDE = () => {
  const m = { longues: [], lcp: 0, fcp: 0 };
  globalThis.__mesures = m;
  try {
    new PerformanceObserver(l => l.getEntries().forEach(e => m.longues.push([e.startTime, e.duration]))).observe({ type: 'longtask', buffered: true });
    new PerformanceObserver(l => l.getEntries().forEach(e => (m.lcp = e.startTime))).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(l => l.getEntries().forEach(e => e.name === 'first-contentful-paint' && (m.fcp = e.startTime))).observe({ type: 'paint', buffered: true });
  } catch {
    // Navigateur sans ces observateurs.
  }
};

async function brider(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  if (BRIDE) {
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  const octets = { js: 0, css: 0, autres: 0, requetes: 0, jsFichiers: [] };
  const urls = new Map();
  cdp.on('Network.responseReceived', e => urls.set(e.requestId, { url: e.response.url, cache: e.response.fromDiskCache || e.response.fromMemoryCache }));
  cdp.on('Network.loadingFinished', e => {
    const r = urls.get(e.requestId);
    if (!r) return;
    octets.requetes++;
    if (r.cache) return;
    if (/\.js(\?|$)/.test(r.url)) {
      octets.js += e.encodedDataLength;
      octets.jsFichiers.push([r.url.replace(/^.*\/assets\//, ''), e.encodedDataLength]);
    } else if (/\.css(\?|$)/.test(r.url)) octets.css += e.encodedDataLength;
    else octets.autres += e.encodedDataLength;
  });
  return { cdp, octets, remettre: () => Object.assign(octets, { js: 0, css: 0, autres: 0, requetes: 0, jsFichiers: [] }) };
}

const lireSonde = page =>
  page.evaluate(() => {
    const m = globalThis.__mesures ?? { longues: [], lcp: 0, fcp: 0 };
    const tbt = m.longues.filter(([debut]) => debut >= m.fcp).reduce((s, [, d]) => s + Math.max(0, d - 50), 0);
    // « bloque » : tout le temps de thread principal au-delà de 50 ms par tâche, chargement compris (avant le FCP).
    const bloque = m.longues.reduce((s, [, d]) => s + Math.max(0, d - 50), 0);
    return { lcp: Math.round(m.lcp), fcp: Math.round(m.fcp), tbt: Math.round(tbt), bloque: Math.round(bloque), taches: m.longues.length };
  });

const ko = n => Math.round(n / 1024);
const mediane = l => [...l].sort((a, b) => a - b)[Math.floor(l.length / 2)];

const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ args: ['--no-sandbox'] });
const resultats = { accueil: [], verrou: [], hub: [], taches: [] };
let detailJs;
try {
  for (let tour = 0; tour < TOURS; tour++) {
    const contexte = await navigateur.newContext({ locale: 'fr-FR', viewport: { width: 1024, height: 768 } });
    await contexte.addInitScript(SONDE);
    const page = await contexte.newPage();
    const { octets, remettre } = await brider(page);

    // 1. Première visite, cache vide.
    let t0 = Date.now();
    await page.goto(site);
    await page.getByTestId('accueil-site').waitFor({ timeout: 180_000 });
    const tAccueil = Date.now() - t0;
    await pause(1500);
    resultats.accueil.push({ ms: tAccueil, js: ko(octets.js), css: ko(octets.css), autres: ko(octets.autres), ...(await lireSonde(page)) });
    if (!detailJs) detailJs = [...octets.jsFichiers].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, o]) => `${n} ${ko(o)} Ko`);

    // Compte créé (non mesuré).
    const secret = await premierLancement(page, { site, motDePasse: MDP });
    await toucher(page, 'acceptation-case').catch(() => undefined);
    await toucher(page, 'acceptation-continuer').catch(() => undefined);
    await page.getByTestId('hub').waitFor({ timeout: 120_000 });
    await pause(1000);

    // 2. Visite suivante (cache chaud) → déverrouillage.
    remettre();
    t0 = Date.now();
    await page.reload();
    await page.getByTestId('bouton-deverrouiller').waitFor({ timeout: 180_000 });
    const tVerrou = Date.now() - t0;
    await pause(800);
    resultats.verrou.push({ ms: tVerrou, js: ko(octets.js), ...(await lireSonde(page)) });

    // 3. Déverrouillage → hub.
    t0 = Date.now();
    await deverrouiller(page, MDP, secret);
    resultats.hub.push({ ms: Date.now() - t0 });

    // 4. Ouverture de Tâches, 6 s après l'affichage du hub.
    await allerPageApplications(page);
    await pause(6_000);
    remettre();
    t0 = Date.now();
    await tuileApp(page, 'taches').first().click();
    await page.locator('[data-testid^="taches-"]').first().waitFor({ timeout: 120_000 });
    resultats.taches.push({ ms: Date.now() - t0, js: ko(octets.js) });
    await contexte.close();
  }
} finally {
  await navigateur.close();
  serveur.close();
}

const synthese = Object.fromEntries(
  Object.entries(resultats).map(([nom, l]) => [nom, Object.fromEntries(Object.keys(l[0] ?? {}).map(k => [k, mediane(l.map(x => x[k]))]))]),
);
if (args.has('--json')) console.log(JSON.stringify({ bride: BRIDE, synthese, detailJs }, null, 2));
else {
  console.log(`Mesure ${BRIDE ? 'bridée (4G lente 1,6 Mb/s, 150 ms, CPU x4)' : 'sans bridage'} — médiane de ${TOURS} tours`);
  console.log('1. Première visite → accueil :', synthese.accueil);
  console.log('   JS les plus lourds :', detailJs.join(', '));
  console.log('2. Visite suivante → déverrouillage :', synthese.verrou);
  console.log('3. Déverrouillage → hub :', synthese.hub);
  console.log('4. Ouverture de Tâches (6 s après le hub) :', synthese.taches);
}
