/**
 * Test de bout en bout du module Lineups (navigateur réel, sans réseau réel) : serveur Esport local semé
 * (esport/outils/graines-lineups.mjs), faux relais, FAUX valorant-api.com (minimaps, portraits et icônes générés).
 *
 * PC (1440 × 900), le Fondateur : grille (cartes, image), filtre par agent, vue par map (pins, groupe, pin cliqué :
 * trajectoire et fiche à côté), fiche complète (visionneuse au clavier), formulaire (points posés en cliquant sur la
 * carte, image choisie et envoyée, lineup créé avec ses points). iPad (820 × 1180, tactile) : point posé au doigt,
 * balayage dans la visionneuse. Téléphone (390 × 844) : mêmes écrans. Team The Finals : « Lineups et placements ».
 * Captures de chaque écran aux trois tailles (CAPTURES ; à regarder puis à effacer : jamais versionnées).
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers CAPTURES=/tmp/captures-lineups node scripts/e2e-esport-lineups.mjs
 */

import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { allerPageApplications, nouveauContexte, tuileApp } from './e2e-acceptation.mjs';
import { ongletTeam } from './esport-navigation.mjs';
import { chargerPlaywright, demarrerRelais, deverrouiller, pause, premierLancement, racine } from './mobile-outils.mjs';

const CAPTURES = process.env.CAPTURES ?? join(racine, '.captures-audit/lineups');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-esport-lineups-0123456789ab';
const PORT_RELAIS = 8861;
const PORT_ESPORT = 8862;
const PORT_SITE = 5361;
const MDP = 'mot-de-passe-lineups-e2e-tres-long-42';
const log = (...a) => console.log('[e2e-esport-lineups]', ...a);
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

  // ----------------------------------------------------------- PC : grille, filtres
  await ouvrirTeam(page, 'faucons-valorant');
  await ongletTeam(page, 'module-lineups');
  await page.locator('[data-testid^="esport-lineup-carte-"]').first().waitFor({ timeout: 20_000 });
  verifier((await cartesGrille(page)) === 7, 'grille : les 7 lineups semés');
  const smokeId = (await esport.base.premier("SELECT id FROM lineups WHERE titre = 'Smoke Heaven depuis A main'", [])).id;
  const image = page.getByTestId(`esport-lineup-image-${smokeId}`);
  await image.waitFor({ timeout: 15_000 });
  verifier(await image.locator('img').evaluate(i => i.complete && i.naturalWidth > 0).catch(() => false), 'grille : l’image du lineup est chargée (lien signé)');
  await capture(page, 'grille-pc');
  await choisir(page, 'esport-lineups-filtre-personnage', 'omen');
  await pause(300);
  verifier((await cartesGrille(page)) === 3, 'filtre par agent : 3 lineups d’Omen (sans nouvel appel au serveur)');
  await capture(page, 'grille-filtree-pc');
  await page.getByTestId('esport-lineups-filtres-effacer').click();

  // ----------------------------------------------------------- PC : vue par map
  await page.getByTestId('esport-lineups-vue-carte').click();
  await page.getByTestId('esport-lineups-carte').waitFor({ timeout: 10_000 });
  await pause(800);
  const pins = await page.locator('[data-testid^="esport-lineups-carte-pin-"]').count();
  verifier(pins >= 3 && pins <= 5, `vue par map : pins posés sur Ascent (${pins}, dont un groupe)`);
  verifier((await page.locator('[data-testid^="esport-lineups-carte-pin-"][data-testid*="+"]').count()) >= 1, 'vue par map : les lineups proches sont regroupés');
  await capture(page, 'carte-pc');
  await page.getByTestId(`esport-lineups-carte-pin-${smokeId}`).click();
  await page.getByTestId(`esport-lineups-carte-arc-${smokeId}`).waitFor({ timeout: 5000 });
  verifier(await present(page, 'esport-lineup-fiche'), 'pin cliqué : trajectoire dessinée et fiche ouverte à côté');
  await capture(page, 'carte-pin-pc');
  // Groupe : la liste de ses lineups.
  await page.locator('[data-testid^="esport-lineups-carte-pin-"][data-testid*="+"]').first().click();
  verifier(await present(page, 'esport-lineups-groupe'), 'groupe cliqué : la liste de ses lineups');
  await capture(page, 'carte-groupe-pc');
  await page.getByTestId(`esport-lineups-carte-pin-${smokeId}`).click();

  // ----------------------------------------------------------- PC : fiche et visionneuse
  await page.getByTestId('esport-lineup-ouvrir').click();
  await page.getByTestId('esport-lineup-galerie-grande').waitFor({ timeout: 10_000 });
  await capture(page, 'fiche-pc');
  await sansDebordement(page, 'fiche PC');
  await page.getByTestId('esport-lineup-galerie-grande').click();
  await page.getByTestId('esport-lineup-visionneuse').waitFor({ timeout: 5000 });
  await page.keyboard.press('ArrowRight');
  await pause(200);
  verifier(((await page.getByTestId('esport-lineup-visionneuse-titre').innerText()) ?? '').includes('2 sur 3'), 'visionneuse : flèche droite du clavier → image 2 sur 3');
  await capture(page, 'visionneuse-pc');
  await page.keyboard.press('Escape');
  await pause(300);
  verifier(!(await present(page, 'esport-lineup-visionneuse', 600)) && (await present(page, 'esport-lineup-retour')), 'visionneuse : Échap la ferme et laisse la fiche à l’écran (sans retour au Hub)');

  // ----------------------------------------------------------- PC : formulaire, points posés à la souris, image envoyée
  await page.getByTestId('esport-lineup-retour').click();
  await page.getByTestId('esport-lineups-nouveau').click();
  await page.getByTestId('esport-lineup-form-titre').fill('Flash A main (e2e)');
  await choisir(page, 'esport-lineup-form-carte', 'ascent');
  await choisir(page, 'esport-lineup-form-personnage', 'skye');
  await page.getByTestId('esport-lineup-form-instructions').fill('Viser le haut de la caisse, lancer en avançant.');
  const zone = page.getByTestId('esport-lineup-form-carte-points-toucher');
  await zone.scrollIntoViewIfNeeded();
  const boite = await zone.boundingBox();
  await page.mouse.click(boite.x + boite.width * 0.25, boite.y + boite.height * 0.75);
  await page.mouse.click(boite.x + boite.width * 0.5, boite.y + boite.height * 0.25);
  verifier((await present(page, 'esport-lineup-form-carte-points-depart-form')) && (await present(page, 'esport-lineup-form-carte-points-arrivee-form')), 'formulaire : deux clics posent la position puis l’arrivée');
  const [choix] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('esport-lineup-form-ajouter-image').click()]);
  await choix.setFiles({ name: 'position.png', mimeType: 'image/png', buffer: Buffer.from(pngDemo(640, 360, [90, 120, 170])) });
  await pause(300);
  await capture(page, 'formulaire-pc');
  await sansDebordement(page, 'formulaire PC');
  await page.getByTestId('esport-lineup-form-enregistrer').click();
  await page.getByTestId('esport-lineup-fiche').waitFor({ timeout: 30_000 });
  const cree = await esport.base.premier("SELECT * FROM lineups WHERE titre = 'Flash A main (e2e)'", []);
  verifier(Boolean(cree) && Math.abs(cree.depart_x - 250) <= 6 && Math.abs(cree.depart_y - 750) <= 6 && Math.abs(cree.arrivee_x - 500) <= 6 && Math.abs(cree.arrivee_y - 250) <= 6, `lineup créé avec ses points (${cree?.depart_x}, ${cree?.depart_y}) → (${cree?.arrivee_x}, ${cree?.arrivee_y})`);
  const medias = await esport.base.tous('SELECT m.role, f.type_mime FROM lineup_medias m JOIN fichiers f ON f.id = m.fichier_id WHERE m.lineup_id = ?', [cree.id]);
  verifier(medias.length === 1 && medias[0].role === 'position' && medias[0].type_mime === 'image/png', 'image envoyée par morceaux et rattachée (rôle « position »)');
  await page.getByTestId('esport-lineup-galerie-grande').waitFor({ timeout: 10_000 });
  await capture(page, 'fiche-nouvelle-pc');
  await page.getByTestId('esport-lineup-retour').click();

  // ----------------------------------------------------------- iPad (tactile)
  await taille(page, 'ipad');
  await page.locator('[data-testid^="esport-lineup-carte-"]').first().waitFor({ timeout: 10_000 });
  await capture(page, 'grille-ipad');
  await sansDebordement(page, 'grille iPad');
  await page.getByTestId('esport-lineups-vue-carte').click();
  await page.getByTestId('esport-lineups-carte').waitFor({ timeout: 10_000 });
  await pause(600);
  await toucherPin(page, smokeId);
  verifier(await present(page, `esport-lineups-carte-arc-${smokeId}`, 4000), 'iPad : un pin touché au doigt montre la trajectoire');
  await capture(page, 'carte-pin-ipad');
  await sansDebordement(page, 'vue par map iPad');
  await page.getByTestId('esport-lineup-ouvrir').click();
  await page.getByTestId('esport-lineup-galerie-grande').waitFor({ timeout: 10_000 });
  await capture(page, 'fiche-ipad');
  await page.getByTestId('esport-lineup-galerie-grande').click();
  await page.getByTestId('esport-lineup-visionneuse-zone').waitFor({ timeout: 5000 });
  const bz = await page.getByTestId('esport-lineup-visionneuse-zone').boundingBox();
  const cdp = await ctx.newCDPSession(page);
  const glisser = async (de, a) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: de, y: bz.y + bz.height / 2 }] });
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: de + ((a - de) * i) / 8, y: bz.y + bz.height / 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await pause(250);
  };
  await glisser(bz.x + bz.width * 0.8, bz.x + bz.width * 0.2);
  verifier(((await page.getByTestId('esport-lineup-visionneuse-titre').innerText()) ?? '').includes('2 sur 3'), 'iPad : un balayage vers la gauche passe à l’image suivante');
  await glisser(bz.x + bz.width * 0.2, bz.x + bz.width * 0.8);
  verifier(((await page.getByTestId('esport-lineup-visionneuse-titre').innerText()) ?? '').includes('1 sur 3'), 'iPad : un balayage vers la droite revient à la précédente');
  await capture(page, 'visionneuse-ipad');
  await page.getByTestId('esport-lineup-visionneuse-fermer').click();
  // Formulaire : point posé au doigt.
  await page.getByTestId('esport-lineup-modifier').click();
  const zi = page.getByTestId('esport-lineup-form-carte-points-toucher');
  await zi.scrollIntoViewIfNeeded();
  await page.getByTestId('esport-lineup-form-pose-arrivee').click();
  const bi = await zi.boundingBox();
  await page.touchscreen.tap(bi.x + bi.width * 0.6, bi.y + bi.height * 0.4);
  await pause(300);
  await capture(page, 'formulaire-ipad');
  await sansDebordement(page, 'formulaire iPad');
  await page.getByTestId('esport-lineup-form-enregistrer').click();
  await page.getByTestId('esport-lineup-fiche').waitFor({ timeout: 20_000 });
  const corrige = await esport.base.premier('SELECT arrivee_x, arrivee_y FROM lineups WHERE id = ?', [smokeId]);
  verifier(Math.abs(corrige.arrivee_x - 600) <= 8 && Math.abs(corrige.arrivee_y - 400) <= 8, `iPad : l’arrivée posée au doigt est enregistrée (${corrige.arrivee_x}, ${corrige.arrivee_y})`);
  await page.getByTestId('esport-lineup-retour').click();

  // ----------------------------------------------------------- Téléphone
  await taille(page, 'tel');
  await page.getByTestId('esport-lineups-vue-grille').click();
  await page.locator('[data-testid^="esport-lineup-carte-"]').first().waitFor({ timeout: 10_000 });
  await capture(page, 'grille-tel');
  await sansDebordement(page, 'grille téléphone');
  await page.getByTestId('esport-lineups-filtres-ouvrir').click();
  await capture(page, 'filtres-tel');
  await sansDebordement(page, 'filtres téléphone');
  await page.getByTestId('esport-lineups-filtres-ouvrir').click();
  await page.getByTestId('esport-lineups-vue-carte').click();
  await page.getByTestId('esport-lineups-carte').waitFor({ timeout: 10_000 });
  await pause(600);
  await capture(page, 'carte-tel');
  await sansDebordement(page, 'vue par map téléphone');
  await toucherPin(page, smokeId);
  await page.getByTestId('esport-lineup-fiche').waitFor({ timeout: 5000 });
  await capture(page, 'carte-pin-tel');
  await page.getByTestId('esport-lineup-ouvrir').scrollIntoViewIfNeeded();
  await page.getByTestId('esport-lineup-ouvrir').click();
  await page.getByTestId('esport-lineup-galerie-grande').waitFor({ timeout: 10_000 });
  await capture(page, 'fiche-tel');
  await sansDebordement(page, 'fiche téléphone');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByTestId('esport-lineup-modifier').scrollIntoViewIfNeeded();
  await page.getByTestId('esport-lineup-modifier').click();
  await page.getByTestId('esport-lineup-formulaire').waitFor({ timeout: 10_000 });
  await capture(page, 'formulaire-tel');
  await page.getByTestId('esport-lineup-form-carte-points-toucher').scrollIntoViewIfNeeded();
  await capture(page, 'formulaire-points-tel');
  await sansDebordement(page, 'formulaire téléphone');
  await page.getByTestId('esport-lineup-form-annuler').scrollIntoViewIfNeeded();
  await page.getByTestId('esport-lineup-form-annuler').click();

  // ----------------------------------------------------------- The Finals : « Lineups et placements »
  await taille(page, 'pc');
  await ouvrirTeam(page, 'the-final-lz0');
  await page.getByTestId('esport-section-jeu').first().click();
  const onglet = page.getByTestId('esport-onglet-module-lineups').first();
  await onglet.waitFor({ timeout: 10_000 });
  verifier(((await onglet.innerText()) ?? '').includes('Lineups et placements'), 'The Finals : l’onglet s’appelle « Lineups et placements »');
  await onglet.click();
  await page.locator('[data-testid^="esport-lineup-carte-"]').first().waitFor({ timeout: 20_000 });
  verifier((await cartesGrille(page)) === 3, 'The Finals : 3 placements semés');
  await capture(page, 'finals-grille-pc');
  await page.getByTestId('esport-lineups-vue-carte').click();
  await page.getByTestId('esport-lineups-carte').waitFor({ timeout: 10_000 });
  await page.locator('[data-testid^="esport-lineups-carte-pin-"]').first().click();
  await capture(page, 'finals-carte-pc');
  verifier(externes.length === 0, `aucune requête vers l’extérieur (${externes.slice(0, 3).join(', ') || 'aucune'})`);
} catch (e) {
  echecs++;
  console.error('[e2e-esport-lineups] arrêt :', e);
} finally {
  await navigateur.close();
  serveur.close();
  await esport.fermer?.();
  await relais.fermer?.();
}
console.log(echecs ? `\n${echecs} échec(s)` : '\nTout est bon.');
process.exit(echecs ? 1 : 0);
