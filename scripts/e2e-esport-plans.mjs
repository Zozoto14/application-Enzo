/**
 * Test de bout en bout du module Plan de match (navigateur réel, sans réseau réel) : serveur Esport local semé
 * (esport/outils/graines-plans.mjs), faux relais, FAUX valorant-api.com.
 *
 * PC (1440 × 900), le Fondateur : carte « Prochain plan de match » de l'accueil, liste, page du plan (résumé, veto,
 * maps, checklist cochée), éditeur (conditions de victoire modifiées et enregistrées). iPad (820 × 1180) et
 * téléphone (390 × 844) : page et éditeur sans défilement horizontal. Captures (CAPTURES ; à regarder puis à
 * effacer : jamais versionnées).
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers CAPTURES=/tmp/captures-plans node scripts/e2e-esport-plans.mjs
 */

import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { allerPageApplications, nouveauContexte, tuileApp } from './e2e-acceptation.mjs';
import { ongletTeam } from './esport-navigation.mjs';
import { chargerPlaywright, demarrerRelais, deverrouiller, pause, premierLancement, racine } from './mobile-outils.mjs';

const CAPTURES = process.env.CAPTURES ?? join(racine, '.captures-audit/plans');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-esport-plans-0123456789abcd';
const PORT_RELAIS = 8871;
const PORT_ESPORT = 8872;
const PORT_SITE = 5371;
const MDP = 'mot-de-passe-plans-e2e-tres-long-4242';
const log = (...a) => console.log('[e2e-esport-plans]', ...a);
let echecs = 0;
const verifier = (ok, message) => {
  console.log(ok ? '  OK   ' : '  ECHEC', message);
  if (!ok) echecs++;
};

// ------------------------------------------------------------- Images générées (faux valorant-api.com)
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function pngRgba(taille, pixel) {
  const crc = octets => {
    let c = 0xffffffff;
    for (const o of octets) c = crcTable[(c ^ o) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const bloc = (type, donnees) => {
    const t = Buffer.from(type, 'ascii');
    const longueur = Buffer.alloc(4);
    longueur.writeUInt32BE(donnees.length);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(Buffer.concat([t, donnees])));
    return Buffer.concat([longueur, t, donnees, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(taille, 0);
  ihdr.writeUInt32BE(taille, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const lignes = Buffer.alloc((taille * 4 + 1) * taille);
  for (let y = 0; y < taille; y++) for (let x = 0; x < taille; x++) lignes.set(pixel(x / taille, y / taille), y * (taille * 4 + 1) + 1 + x * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloc('IHDR', ihdr), bloc('IDAT', deflateSync(lignes)), bloc('IEND', Buffer.alloc(0))]);
}
/** Minimap factice : des salles et des couloirs clairs sur fond transparent (comme une minimap du jeu). */
function minimap(decalage) {
  const salles = [
    [0.1, 0.52, 0.22, 0.3], [0.24, 0.24, 0.28, 0.26], [0.3, 0.5, 0.1, 0.12], [0.5, 0.18, 0.2, 0.14], [0.56, 0.3, 0.1, 0.34],
    [0.62, 0.6, 0.26, 0.2], [0.38, 0.66, 0.26, 0.1], [0.14, 0.34, 0.12, 0.2], [0.7, 0.14, 0.16, 0.5], [0.44, 0.44, 0.14, 0.08],
  ].map(([x, y, l, h]) => [x + decalage, y, l, h]);
  return pngRgba(512, (x, y) => {
    const dedans = salles.some(([sx, sy, l, h]) => x >= sx && x <= sx + l && y >= sy && y <= sy + h);
    const bord = salles.some(([sx, sy, l, h]) => x >= sx - 0.006 && x <= sx + l + 0.006 && y >= sy - 0.006 && y <= sy + h + 0.006);
    return dedans ? [150, 160, 172, 235] : bord ? [225, 230, 236, 255] : [0, 0, 0, 0];
  });
}
/** Portrait ou icône factice : un disque coloré (icônes des capacités : blanches). */
const disque = (taille, [r, g, b]) => pngRgba(taille, (x, y) => (Math.hypot(x - 0.5, y - 0.5) < 0.42 ? [r, g, b, 255] : [0, 0, 0, 0]));
const losange = taille => pngRgba(taille, (x, y) => (Math.abs(x - 0.5) + Math.abs(y - 0.5) < 0.4 && Math.abs(x - 0.5) + Math.abs(y - 0.5) > 0.2 ? [255, 255, 255, 255] : [0, 0, 0, 0]));

const CDN = 'https://media.valorant-api.com';
const AGENTS = [
  ['Omen', 'Contrôleur', [90, 70, 170]], ['Sova', 'Initiateur', [70, 130, 200]], ['Viper', 'Contrôleur', [60, 160, 90]], ['Killjoy', 'Sentinelle', [230, 200, 70]],
  ['Jett', 'Duelliste', [150, 200, 230]], ['Sage', 'Sentinelle', [90, 200, 190]], ['Skye', 'Initiateur', [120, 190, 110]], ['Brimstone', 'Contrôleur', [200, 110, 60]],
];
const cle = nom => nom.toLowerCase();
const IMAGES = new Map([['/maps/ascent/displayicon.png', minimap(0)], ['/maps/bind/displayicon.png', minimap(0.04)], ['/icone-capacite.png', losange(64)]]);
for (const [nom, , couleur] of AGENTS) IMAGES.set(`/agents/${cle(nom)}/displayicon.png`, disque(96, couleur));
const CARTES = { status: 200, data: ['Ascent', 'Bind', 'Haven', 'Split', 'Lotus', 'Sunset', 'Icebox'].map((nom, i) => ({ uuid: String(i), displayName: nom, displayIcon: ['Ascent', 'Bind'].includes(nom) ? `${CDN}/maps/${cle(nom)}/displayicon.png` : `${CDN}/maps/ascent/displayicon.png`, tacticalDescription: 'A/B Sites' })) };
const AGENTS_API = {
  status: 200,
  data: AGENTS.map(([nom, role]) => ({
    displayName: nom,
    isPlayableCharacter: true,
    displayIcon: `${CDN}/agents/${cle(nom)}/displayicon.png`,
    role: { displayName: role },
    abilities: ['Grenade', 'Ability1', 'Ability2', 'Ultimate'].map(slot => ({ slot, displayName: `${nom} ${slot}`, displayIcon: `${CDN}/icone-capacite.png` })),
  })),
};
/** Toute requête vers valorant-api.com est servie ici ; rien ne sort. */
async function rediriger(contexte) {
  await contexte.route(/^https:\/\/(media\.)?valorant-api\.com\//, async route => {
    const u = new URL(route.request().url());
    const entetes = { 'Access-Control-Allow-Origin': '*' };
    if (u.pathname === '/v1/maps') return route.fulfill({ status: 200, headers: { ...entetes, 'Content-Type': 'application/json' }, body: JSON.stringify(CARTES) });
    if (u.pathname === '/v1/agents') return route.fulfill({ status: 200, headers: { ...entetes, 'Content-Type': 'application/json' }, body: JSON.stringify(AGENTS_API) });
    const image = IMAGES.get(u.pathname);
    return image ? route.fulfill({ status: 200, headers: { ...entetes, 'Content-Type': 'image/png' }, body: image }) : route.fulfill({ status: 404, headers: entetes, body: '' });
  });
}

// ------------------------------------------------------------- Serveurs
const { demarrerServeurEsport } = await import(pathToFileURL(join(racine, 'esport/outils/serveur-local.mjs')).href);
const { pngDemo } = await import(pathToFileURL(join(racine, 'esport/outils/graines-lineups.mjs')).href);
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

const present = (page, id, delai = 1500) => page.getByTestId(id).first().waitFor({ timeout: delai }).then(() => true, () => false);
const capture = async (page, nom) => {
  await pause(600);
  await page.screenshot({ path: join(CAPTURES, `${nom}.jpg`), type: 'jpeg', quality: 78 });
  log(`capture ${nom}`);
};
const TAILLES = { pc: [1440, 900], ipad: [820, 1180], tel: [390, 844] };
const taille = async (page, nom) => {
  await page.setViewportSize({ width: TAILLES[nom][0], height: TAILLES[nom][1] });
  await pause(500);
};
/** Aucun défilement horizontal de la page. */
const sansDebordement = (page, nom) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1).then(ok => verifier(ok, `${nom} : pas de défilement horizontal`));

async function ouvrirTeam(page, slug) {
  if (await present(page, 'esport-team-retour', 800)) await page.getByTestId('esport-team-retour').first().click();
  if (!(await present(page, `esport-team-${slug}`, 1500))) {
    if (await page.getByTestId('app-esport').count()) {
      await page.getByTestId('esport-nav-teams').first().click().catch(() => undefined);
    } else {
      await allerPageApplications(page);
      await tuileApp(page, 'esport').first().click();
      await page.getByTestId('app-esport').waitFor({ timeout: 20_000 });
      if (await present(page, 'esport-profil-initial', 3000)) {
        await page.getByTestId('esport-pseudo').fill('Fondateur');
        await page.getByTestId('esport-pseudo-valider').click();
      }
    }
  }
  await page.getByTestId(`esport-team-${slug}`).first().click({ timeout: 30_000 });
  await page.getByTestId('esport-team').waitFor({ timeout: 20_000 });
}
/** Choix dans un filtre ou un champ (sélecteur repliable ouvert au besoin). */
async function choisir(page, testID, id) {
  const option = page.getByTestId(`${testID}-${id}`).first();
  if (!(await option.isVisible().catch(() => false))) await page.getByTestId(`${testID}-modifier`).first().click();
  await option.click();
}
const cartesGrille = page => page.locator('[data-testid^="esport-lineup-carte-"]').count();
/** Touche au doigt le pin d'un lineup ; s'il est dans un groupe (carte étroite), le groupe puis sa ligne. */
async function toucherPin(page, id) {
  const pin = page.locator(`[data-testid^="esport-lineups-carte-pin-"][data-testid*="${id}"]`).first();
  await pin.scrollIntoViewIfNeeded();
  const b = await pin.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  const ligne = page.getByTestId(`esport-lineups-groupe-${id}`);
  if (await ligne.isVisible().catch(() => false)) await ligne.tap();
}

const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
try {
  const ctx = await nouveauContexte(navigateur, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true, hasTouch: true });
  await rediriger(ctx);
  const page = await ctx.newPage();
  const externes = [];
  page.on('pageerror', e => {
    log('erreur page :', e.message);
    echecs++;
  });
  page.on('request', r => {
    const u = new URL(r.url());
    if (!['localhost', '127.0.0.1'].includes(u.hostname) && !u.hostname.endsWith('valorant-api.com') && !['data:', 'blob:'].includes(u.protocol)) externes.push(r.url());
  });
  const secret = await premierLancement(page, { site: `http://localhost:${PORT_SITE}/`, code: relais.code, motDePasse: MDP });
  await page.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(page, MDP, secret));
  for (let i = 0; i < 3; i++) if (!(await page.getByText(/^(Fermer|Terminé|Compris|Plus tard)$/).first().click({ timeout: 2000 }).then(() => true, () => false))) break;

  // ----------------------------------------------------------- PC : accueil, liste, page
  await ouvrirTeam(page, 'faucons-valorant');
  verifier(await present(page, 'esport-accueil-plan', 6000), 'accueil de la team : carte « Prochain plan de match »');
  await capture(page, 'accueil-pc');
  await page.getByTestId('esport-accueil-plan-ouvrir').click();
  await page.getByTestId('esport-plan-resume').waitFor({ timeout: 20_000 });
  verifier(true, 'la carte de l’accueil ouvre le plan');
  await page.getByTestId('esport-plan-retour').click();
  await page.locator('[data-testid^="esport-plan-carte-"]').first().waitFor({ timeout: 20_000 });
  verifier((await page.locator('[data-testid="esport-plans-a-venir"] [data-testid^="esport-plan-ouvrir-"]').count()) === 1, 'liste : le plan semé est « à venir »');
  verifier(await present(page, 'esport-plans-modeles'), 'liste : le modèle semé est proposé au staff');
  await capture(page, 'liste-pc');
  await sansDebordement(page, 'liste PC');
  await page.locator('[data-testid="esport-plans-a-venir"] [data-testid^="esport-plan-ouvrir-"]').first().click();
  await page.getByTestId('esport-plan-resume').waitFor({ timeout: 20_000 });
  verifier((await page.locator('[data-testid^="esport-plan-veto-"]').count()) === 7, 'page : veto BO3 en sept étapes');
  verifier(await present(page, 'esport-plan-compo'), 'page : composition de la première map');
  await capture(page, 'plan-pc');
  await sansDebordement(page, 'plan PC');
  await page.getByTestId('esport-plan-carte').scrollIntoViewIfNeeded();
  await capture(page, 'plan-carte-pc');
  // Checklist : une case cochée est gardée par le serveur.
  const planId = (await esport.base.premier("SELECT id FROM plans_match WHERE est_modele = 0 AND statut = 'pret' AND format = 'bo3'", [])).id;
  const avant = JSON.parse((await esport.base.premier('SELECT coches FROM plans_match WHERE id = ?', [planId])).coches).length;
  const derniere = page.locator('[data-testid^="esport-plan-coche-"]').last();
  await derniere.scrollIntoViewIfNeeded();
  await derniere.click();
  await pause(800);
  verifier(JSON.parse((await esport.base.premier('SELECT coches FROM plans_match WHERE id = ?', [planId])).coches).length === avant + 1, 'checklist : la case cochée est enregistrée');
  await capture(page, 'plan-checklist-pc');

  // ----------------------------------------------------------- PC : éditeur
  await page.getByTestId('esport-plan-modifier').scrollIntoViewIfNeeded();
  await page.getByTestId('esport-plan-modifier').click();
  await page.getByTestId('esport-plan-form').waitFor({ timeout: 20_000 });
  await capture(page, 'editeur-pc');
  await sansDebordement(page, 'éditeur PC');
  await page.getByTestId('esport-plan-form-maps').scrollIntoViewIfNeeded();
  await capture(page, 'editeur-maps-pc');
  await page.getByTestId('esport-plan-form-conditions').fill('Tenir le mid (e2e).');
  await page.getByTestId('esport-plan-form-enregistrer').scrollIntoViewIfNeeded();
  await page.getByTestId('esport-plan-form-enregistrer').click();
  await page.getByTestId('esport-plan-resume').waitFor({ timeout: 20_000 });
  const enregistre = JSON.parse((await esport.base.premier('SELECT contenu FROM plans_match WHERE id = ?', [planId])).contenu);
  verifier(enregistre.cartes[0].conditions === 'Tenir le mid (e2e).' && enregistre.veto.length === 7 && enregistre.cartes[0].compo.length === 5, 'éditeur : conditions enregistrées, le reste du plan intact');

  // ----------------------------------------------------------- iPad et téléphone
  for (const [nom, libelle] of [['ipad', 'iPad'], ['tel', 'téléphone']]) {
    await taille(page, nom);
    // Changer de taille remonte la page de la team : retour à l'onglet, puis au plan.
    if (!(await present(page, 'esport-plan-resume', 3000))) {
      if (!(await present(page, 'esport-plans', 1500))) {
        await page.getByTestId('esport-section-jeu').first().click();
        await page.getByTestId('esport-onglet-module-plans_match').first().click();
      }
      await page.locator('[data-testid="esport-plans-a-venir"] [data-testid^="esport-plan-ouvrir-"]').first().click({ timeout: 20_000 });
    }
    await page.getByTestId('esport-plan-resume').waitFor({ timeout: 20_000 });
    await page.getByTestId('esport-plan-retour').scrollIntoViewIfNeeded();
    await capture(page, `plan-${nom}`);
    await sansDebordement(page, `plan ${libelle}`);
    await page.getByTestId('esport-plan-carte').scrollIntoViewIfNeeded();
    await capture(page, `plan-carte-${nom}`);
    await page.getByTestId('esport-plan-modifier').scrollIntoViewIfNeeded();
    await page.getByTestId('esport-plan-modifier').click();
    await page.getByTestId('esport-plan-form').waitFor({ timeout: 20_000 });
    await capture(page, `editeur-${nom}`);
    await page.getByTestId('esport-plan-form-maps').scrollIntoViewIfNeeded();
    await capture(page, `editeur-maps-${nom}`);
    await sansDebordement(page, `éditeur ${libelle}`);
    await page.getByTestId('esport-plan-form-annuler').scrollIntoViewIfNeeded();
    await page.getByTestId('esport-plan-form-annuler').click();
    await page.getByTestId('esport-plan-resume').waitFor({ timeout: 20_000 });
  }
  await page.getByTestId('esport-plan-retour').scrollIntoViewIfNeeded();
  await page.getByTestId('esport-plan-retour').click();
  await page.locator('[data-testid^="esport-plan-carte-"]').first().waitFor({ timeout: 20_000 });
  await capture(page, 'liste-tel');
  await sansDebordement(page, 'liste téléphone');
  verifier(externes.length === 0, `aucune requête vers l’extérieur (${externes.slice(0, 3).join(', ') || 'aucune'})`);
} catch (e) {
  echecs++;
  console.error('[e2e-esport-plans] arrêt :', e);
} finally {
  await navigateur.close();
  serveur.close();
  await esport.fermer?.();
  await relais.fermer?.();
}
console.log(echecs ? `\n${echecs} échec(s)` : '\nTout est bon.');
process.exit(echecs ? 1 : 0);
