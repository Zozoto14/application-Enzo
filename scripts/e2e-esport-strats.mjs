/**
 * Test de bout en bout de l'Esport, phase 6 (atelier de strats et playbook), sans réseau réel : faux relais (le
 * vrai relais/relais.mjs), serveur Esport local (SQLite en mémoire, stockage mémoire) et FAUX valorant-api.com
 * local (JSON des cartes et agents, images PNG GÉNÉRÉES : minimap à fond transparent, portraits, icônes) vers
 * lequel le navigateur est redirigé (aucune requête ne sort, aucune image de jeu dans le dépôt).
 *
 * Parties (variable PARTIES, toutes par défaut) :
 *  - parcours  : PC 1440 × 900, le Fondateur. Nouvelle strat sur Ascent ; l'atelier s'ouvre en PLEIN ÉCRAN
 *                (canevas ≥ 70 % de la fenêtre, aucun défilement de page) ; agent et smoke posés depuis le dock,
 *                flèche, mur de Viper en cliquant-glissant, poignées tirées (longueur bornée à 60 m),
 *                enregistrement automatique, étape ajoutée (reprise des pions à la fin de leur trajet),
 *                sélection multiple et déplacement de groupe, menu contextuel, glisser un portrait du dock sur
 *                la map, présentation ; recharger, exporter un PNG, playbook, lien de lecture seule révoqué ;
 *  - visuel    : strat Valorant aux 14 capacités variées (callouts et sites du profil), à 100 % et 300 %, image
 *                d'origine de la map (pas de thème), 1920 × 1080 ;
 *  - thefinals : strat The Finals (image de type photo, gadgets, étages), « Atténuer la map » ; jeu générique ;
 *  - ipad      : iPad portrait 820 × 1180 et 1024 × 1366 (tactile) : canevas ≥ 60 %, agent posé au doigt, poignée
 *                de regard tirée au doigt, repli hors ligne ;
 *  - telephone : 390 × 844, lecture d'abord, « Modifier », aucun débordement horizontal.
 *
 *   npx vite build
 *   CAPTURES=<dossier> PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-esport-strats.mjs
 *
 * Variables : CAPTURES (dossier des captures, défaut : dossier temporaire), PARTIES (« parcours,visuel »…).
 */

import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { ongletTeam } from './esport-navigation.mjs';
import { nouveauContexte, allerPageApplications, tuileApp } from './e2e-acceptation.mjs';
import { chargerPlaywright, connecterAppareilFondateur, demarrerRelais, deverrouiller, pause, premierLancement, racine } from './mobile-outils.mjs';

const CAPTURES = process.env.CAPTURES ?? mkdtempSync(join(tmpdir(), 'captures-strats-'));
mkdirSync(CAPTURES, { recursive: true });
const PARTIES = new Set((process.env.PARTIES ?? 'parcours,visuel,thefinals,ipad,telephone').split(',').map(s => s.trim()));
const TELECHARGEMENTS = mkdtempSync(join(tmpdir(), 'e2e-strats-'));
const JETON = 'jeton-e2e-esport-strats-0123456789abcdef';
const PORT_RELAIS = 8831;
const PORT_ESPORT = 8832;
const PORT_VALORANT = 8833;
const PORT_SITE = 5293;
const MDP = 'mot-de-passe-esport-e2e-tres-long-44';
const log = (...a) => console.log('[e2e-esport-strats]', ...a);
let echecs = 0;
const verifier = (ok, message) => {
  console.log(ok ? '  OK   ' : '  ECHEC', message);
  if (!ok) echecs++;
};
const capture = async (page, nom) => {
  await pause(700);
  await page.screenshot({ path: join(CAPTURES, `${nom}.jpg`), type: 'jpeg', quality: 78 });
  log(`capture ${nom}`);
};

const { jetonDeProfil } = await import(pathToFileURL(join(racine, 'relais/relais.mjs')).href);
const { demarrerServeurEsport } = await import(pathToFileURL(join(racine, 'esport/outils/serveur-local.mjs')).href);

// ------------------------------------------------------------- Images générées (aucune image de jeu)
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc(octets) {
  let c = 0xffffffff;
  for (const o of octets) c = crcTable[(c ^ o) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** PNG RVBA généré sans dépendance : `pixel(x, y)` rend [r, v, b, a]. */
function png(taille, pixel) {
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
  const brut = Buffer.alloc(taille * (taille * 4 + 1));
  for (let y = 0; y < taille; y++) {
    const debut = y * (taille * 4 + 1);
    for (let x = 0; x < taille; x++) {
      const [r, g, b, a] = pixel(x / taille, y / taille);
      brut.set([r, g, b, a], debut + 1 + x * 4);
    }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloc('IHDR', ihdr), bloc('IDAT', deflateSync(brut)), bloc('IEND', Buffer.alloc(0))]);
}
/** Minimap « façon Valorant » : couloirs et salles clairs sur fond TRANSPARENT, deux sites, un mid. */
const SALLES = [
  [0.1, 0.12, 0.34, 0.3], [0.62, 0.1, 0.9, 0.3], [0.4, 0.34, 0.6, 0.62], [0.08, 0.66, 0.36, 0.9], [0.6, 0.68, 0.92, 0.9],
  [0.18, 0.3, 0.26, 0.66], [0.72, 0.3, 0.8, 0.68], [0.34, 0.18, 0.62, 0.25], [0.36, 0.76, 0.6, 0.84], [0.26, 0.44, 0.4, 0.52], [0.6, 0.46, 0.72, 0.54], [0.46, 0.25, 0.54, 0.34], [0.46, 0.62, 0.54, 0.76],
];
function minimap(x, y) {
  const dedans = SALLES.some(([x1, y1, x2, y2]) => x >= x1 && x <= x2 && y >= y1 && y <= y2);
  if (!dedans) return [0, 0, 0, 0];
  // Reliefs : caisses et marches un peu plus sombres.
  const caisse = (Math.floor(x * 40) + Math.floor(y * 40)) % 11 === 0;
  const v = caisse ? 150 : 205 + Math.round(12 * Math.sin(x * 30) * Math.cos(y * 26));
  return [v, v, v, 255];
}
/** Vue de dessus « façon photo » (The Finals) : immeubles, rues, végétation, bruit. */
function photo(x, y) {
  const bruit = (Math.sin(x * 157.1 + y * 311.7) * 43758.5453) % 1;
  const rue = Math.abs((x * 5) % 1 - 0.5) < 0.07 || Math.abs((y * 5) % 1 - 0.5) < 0.07;
  if (rue) return [72 + bruit * 14, 74 + bruit * 14, 80 + bruit * 14, 255];
  const bloc = (Math.floor(x * 5) * 7 + Math.floor(y * 5) * 13) % 5;
  const base = [[176, 148, 110], [120, 150, 96], [196, 190, 176], [150, 96, 84], [96, 128, 160]][bloc];
  return [base[0] + bruit * 26, base[1] + bruit * 26, base[2] + bruit * 26, 255];
}
/** Portrait généré : disque à deux tons, propre à chaque agent. */
const portrait = (r, g, b) => (x, y) => {
  const d = Math.hypot(x - 0.5, y - 0.5);
  if (d > 0.5) return [0, 0, 0, 0];
  if (Math.hypot(x - 0.5, y - 0.4) < 0.18) return [235, 215, 190, 255];
  if (y > 0.62 && Math.abs(x - 0.5) < 0.3) return [Math.min(255, r + 40), Math.min(255, g + 40), Math.min(255, b + 40), 255];
  return [r, g, b, 255];
};
/** Icône de capacité générée : symbole clair sur transparent. */
const icone = n => (x, y) => {
  const d = Math.hypot(x - 0.5, y - 0.5);
  const forme = n % 4 === 0 ? d < 0.36 && d > 0.2 : n % 4 === 1 ? Math.abs(x - 0.5) + Math.abs(y - 0.5) < 0.36 : n % 4 === 2 ? Math.abs(x - 0.5) < 0.1 || Math.abs(y - 0.5) < 0.1 : y > 0.25 && Math.abs(x - 0.5) < (y - 0.25) * 0.6;
  return forme ? [240, 244, 250, 255] : [0, 0, 0, 0];
};

const CDN = 'https://media.valorant-api.com';
const COULEURS_AGENTS = { omen: [70, 50, 140], jett: [120, 180, 220], viper: [40, 160, 80], sova: [60, 110, 200], breach: [200, 110, 60], cypher: [200, 200, 205], neon: [50, 110, 230], sage: [70, 200, 190], phoenix: [240, 150, 60], killjoy: [240, 205, 60] };
const NOMS_CAPACITES = {
  omen: ['Pas ténébreux', 'Paranoïa', 'Voile sombre', 'Depuis les ombres'],
  viper: ['Morsure de serpent', 'Nuage toxique', 'Écran toxique', 'Fosse à vipères'],
  sova: ['Drone rapace', 'Flèche électrique', 'Flèche de reconnaissance', 'Fureur du chasseur'],
  breach: ['Réplique', 'Point d’ignition', 'Ligne de faille', 'Onde sismique'],
  cypher: ['Fil de détente', 'Cybercage', 'Caméra espionne', 'Vol neural'],
  neon: ['Voie rapide', 'Éclair relais', 'Vitesse supérieure', 'Surcharge'],
  sage: ['Orbe barrière', 'Orbe de lenteur', 'Orbe de soin', 'Résurrection'],
  phoenix: ['Brasier', 'Balle courbe', 'Mains brûlantes', 'Revanche'],
  killjoy: ['Nanoessaim', 'Alarmbot', 'Tourelle', 'Confinement'],
  jett: ['Averse', 'Courant ascendant', 'Vent arrière', 'Tempête de lames'],
};
const IMAGES = {
  '/maps/ascent/displayicon.png': png(512, minimap),
  '/maps/bind/displayicon.png': png(256, (x, y) => (Math.abs(x - 0.5) < 0.4 && Math.abs(y - 0.5) < 0.32 ? [210, 210, 210, 255] : [0, 0, 0, 0])),
};
const ROLES = { omen: 'Contrôleur', viper: 'Contrôleur', sova: 'Initiateur', breach: 'Initiateur', cypher: 'Sentinelle', neon: 'Duelliste', sage: 'Sentinelle', phoenix: 'Duelliste', killjoy: 'Sentinelle', jett: 'Duelliste' };
const AGENTS = { status: 200, data: [] };
for (const [cle, [r, g, b]] of Object.entries(COULEURS_AGENTS)) {
  IMAGES[`/agents/${cle}/displayicon.png`] = png(96, portrait(r, g, b));
  const slots = ['Grenade', 'Ability1', 'Ability2', 'Ultimate'];
  slots.forEach((slot, i) => {
    IMAGES[`/agents/${cle}/abilities/${slot.toLowerCase()}/displayicon.png`] = png(48, icone(i + cle.length));
  });
  AGENTS.data.push({
    displayName: cle[0].toUpperCase() + cle.slice(1),
    isPlayableCharacter: true,
    displayIcon: `${CDN}/agents/${cle}/displayicon.png`,
    role: { displayName: ROLES[cle] },
    abilities: slots.map((slot, i) => ({ slot, displayName: NOMS_CAPACITES[cle][i], displayIcon: `${CDN}/agents/${cle}/abilities/${slot.toLowerCase()}/displayicon.png` })),
  });
}
const CARTES = {
  status: 200,
  data: [
    { uuid: 'a', displayName: 'Ascent', displayIcon: `${CDN}/maps/ascent/displayicon.png`, tacticalDescription: 'A/B Sites' },
    { uuid: 'b', displayName: 'Bind', displayIcon: `${CDN}/maps/bind/displayicon.png`, tacticalDescription: 'A/B Sites' },
    { uuid: 'r', displayName: 'The Range', displayIcon: null, tacticalDescription: null },
  ],
};
const appelsValorant = [];
let valorantEnPanne = false;
const fauxValorant = http.createServer((req, res) => {
  appelsValorant.push(req.url);
  const entetes = { 'Access-Control-Allow-Origin': '*' };
  if (valorantEnPanne) return res.writeHead(503, entetes).end();
  const chemin = new URL(req.url, 'http://x').pathname;
  if (chemin === '/v1/maps') return res.writeHead(200, { ...entetes, 'Content-Type': 'application/json' }).end(JSON.stringify(CARTES));
  if (chemin === '/v1/agents') return res.writeHead(200, { ...entetes, 'Content-Type': 'application/json' }).end(JSON.stringify(AGENTS));
  const image = IMAGES[chemin.replace(/^\/media/, '')];
  if (image) return res.writeHead(200, { ...entetes, 'Content-Type': 'image/png' }).end(image);
  res.writeHead(404, entetes).end();
});
await new Promise(ok => fauxValorant.listen(PORT_VALORANT, '127.0.0.1', ok));

/** Toute requête du navigateur vers valorant-api.com part au faux serveur local ; rien d'autre ne sort. */
async function rediriger(contexte) {
  await contexte.route(/^https:\/\/(media\.)?valorant-api\.com\//, async route => {
    const u = new URL(route.request().url());
    const local = `http://127.0.0.1:${PORT_VALORANT}${u.hostname.startsWith('media.') ? '/media' : ''}${u.pathname}${u.search}`;
    const r = await fetch(local).catch(() => undefined);
    if (!r) return route.abort();
    await route.fulfill({ status: r.status, headers: Object.fromEntries(r.headers), body: Buffer.from(await r.arrayBuffer()) });
  });
}

// ------------------------------------------------------------- Serveurs
const relais = await demarrerRelais(PORT_RELAIS, JETON);
const esport = await demarrerServeurEsport({ port: PORT_ESPORT, jetonDev: JETON });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const fichiersSite = [];
function site(port) {
  const dist = join(racine, 'bureau/dist');
  if (!existsSync(join(dist, 'index.html'))) throw new Error('bureau/dist absent : lancez « npx vite build » d’abord');
  const serveur = http.createServer((req, res) => {
    const chemin = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    fichiersSite.push(chemin);
    if (chemin === '/relais.json') return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ relais: `https://localhost:${PORT_RELAIS}` }));
    if (chemin === '/esport.json') return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ esport: esport.url }));
    let fichier = join(dist, chemin);
    if (!existsSync(fichier) || statSync(fichier).isDirectory()) fichier = join(dist, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[extname(fichier)] ?? 'application/octet-stream' });
    createReadStream(fichier).pipe(res);
  });
  return new Promise(ok => serveur.listen(port, () => ok({ url: `http://localhost:${port}/`, fermer: () => serveur.close() })));
}
const siteAvec = await site(PORT_SITE);

async function fermerPopups(page) {
  for (let i = 0; i < 3; i++) {
    const clique = await page.getByText(/^(Fermer|Terminé|Compris|Plus tard)$/).first().click({ timeout: 2000 }).then(() => true, () => false);
    if (!clique) break;
  }
}

const pages = [];
const secrets = new Map();
const requetesExternes = [];
async function compte(contexte, url, code, nom, fondateur) {
  const page = await contexte.newPage();
  pages.push([nom, page]);
  page.on('pageerror', e => log(`erreur page (${nom}) :`, e.message));
  page.on('request', r => {
    const u = new URL(r.url());
    if (!['localhost', '127.0.0.1'].includes(u.hostname) && !u.hostname.endsWith('valorant-api.com') && !['data:', 'blob:'].includes(u.protocol)) requetesExternes.push(r.url());
  });
  // Autre appareil du Fondateur : SON coffre, relu sur le serveur (pas de nouveau coffre).
  const secret = fondateur
    ? await connecterAppareilFondateur(page, { site: url, code, motDePasse: MDP, secret: secrets.get(fondateur) })
    : await premierLancement(page, { site: url, code, motDePasse: MDP });
  secrets.set(page, secret);
  await page.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(page, MDP, secret));
  await fermerPopups(page);
  return page;
}

async function api(chemin, jeton, { methode = 'GET', corps } = {}) {
  const r = await fetch(`${esport.url}${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}

const teamOuverte = new Map();
/** Ouvre l'onglet d'un module d'une team (par son slug). */
async function allerModule(page, cle, team = 'faucons-valorant') {
  // L'atelier ouvert recouvre l'app : on revient d'abord à la liste.
  if (await page.getByTestId('esport-atelier-hote').count()) {
    await page.getByTestId('esport-editeur-retour').click();
    await page.getByTestId('esport-atelier-hote').waitFor({ state: 'detached', timeout: 20_000 });
  }
  if (!(await page.getByTestId('app-esport').isVisible().catch(() => false))) {
    await allerPageApplications(page);
    const tuile = tuileApp(page, 'esport').first();
    await tuile.waitFor({ timeout: 30_000 });
    await tuile.click();
    await page.getByTestId('app-esport').waitFor({ timeout: 20_000 });
  }
  // La team voulue : depuis la liste des teams (on y revient si une autre team est ouverte).
  if (teamOuverte.get(page) !== team || !(await page.getByTestId('esport-team').isVisible().catch(() => false))) {
    const liste = page.getByTestId('esport-nav-teams').first();
    if (await liste.isVisible().catch(() => false)) await liste.click();
    await page.getByTestId(`esport-team-${team}`).first().waitFor({ timeout: 30_000 });
    await page.getByTestId(`esport-team-${team}`).first().click();
    await page.getByTestId('esport-team').waitFor({ timeout: 20_000 });
    teamOuverte.set(page, team);
  }
  await ongletTeam(page, `module-${cle}`);
}

/** Choix dans un sélecteur repliable (ouvert au besoin par « Modifier »). */
async function choisir(page, testID, id) {
  const option = page.getByTestId(`${testID}-${id}`);
  if (!(await option.isVisible().catch(() => false))) await page.getByTestId(`${testID}-modifier`).click();
  await option.click();
}

/** Glisser au doigt (événements tactiles du navigateur, comme sur iPad) de `de` à `a` (coordonnées de la page). */
async function glisserDoigt(page, de, a, etapes = 10) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: de.x, y: de.y }] });
  for (let i = 1; i <= etapes; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: de.x + ((a.x - de.x) * i) / etapes, y: de.y + ((a.y - de.y) * i) / etapes }] });
    await pause(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** Glisser à la souris de `de` à `a` (coordonnées de la page). */
async function glisserSouris(page, de, a, etapes = 12) {
  await page.mouse.move(de.x, de.y);
  await page.mouse.down();
  await page.mouse.move(a.x, a.y, { steps: etapes });
  await page.mouse.up();
}

/** Point du document (carré de 1000) → coordonnées de la page, d'après le cadrage publié par le canevas. */
async function point(page, x, y, testID = 'esport-canevas') {
  const el = page.getByTestId(testID);
  const boite = await el.boundingBox();
  const [px, dx, dy] = (await el.getAttribute('data-cadre')).split(',').map(Number);
  return { x: boite.x + dx + x * px, y: boite.y + dy + y * px };
}

/** Part de la fenêtre occupée par le canevas (boîte, puis part non recouverte par les panneaux), défilement de la page. */
async function mesure(page) {
  return page.evaluate(() => {
    const c = document.querySelector('[data-testid="esport-canevas"]').getBoundingClientRect();
    const hote = document.querySelector('[data-testid="esport-atelier-hote"]');
    const fenetre = window.innerWidth * window.innerHeight;
    let couvert = 0;
    for (const id of ['esport-atelier-rail', 'esport-atelier-frise', 'esport-atelier-tiroir', 'esport-atelier-options-panneau', 'esport-atelier-legende']) {
      for (const el of document.querySelectorAll(`[data-testid="${id}"]`)) {
        const r = el.getBoundingClientRect();
        const l = Math.max(0, Math.min(r.right, c.right) - Math.max(r.left, c.left));
        const h = Math.max(0, Math.min(r.bottom, c.bottom) - Math.max(r.top, c.top));
        couvert += l * h;
      }
    }
    const racinePage = document.scrollingElement ?? document.documentElement;
    return {
      part: (c.width * c.height) / fenetre,
      libre: (c.width * c.height - couvert) / fenetre,
      canevas: `${Math.round(c.width)} × ${Math.round(c.height)}`,
      defilePage: racinePage.scrollHeight > window.innerHeight + 1 || racinePage.scrollWidth > window.innerWidth + 1,
      defileHote: hote.scrollHeight > hote.clientHeight + 1 || hote.scrollWidth > hote.clientWidth + 1,
      // L'app derrière l'atelier n'est plus atteignable : le point en haut à gauche est dans l'hôte.
      recouvre: Boolean(document.elementFromPoint(6, 6)?.closest('[data-testid="esport-atelier-hote"]')) && Boolean(document.elementFromPoint(window.innerWidth - 6, window.innerHeight - 6)?.closest('[data-testid="esport-atelier-hote"]')),
    };
  });
}
const pourcent = n => `${Math.round(n * 1000) / 10} %`;
const bilan = [];
async function controlerPlace(page, nom, seuil) {
  const m = await mesure(page);
  bilan.push(`${nom} : canevas ${m.canevas}, ${pourcent(m.part)} de la fenêtre (${pourcent(m.libre)} sans les panneaux posés dessus)`);
  verifier(m.part >= seuil, `${nom} : le canevas couvre ${pourcent(m.part)} de la fenêtre (≥ ${seuil * 100} %), ${pourcent(m.libre)} hors panneaux flottants`);
  verifier(m.libre >= seuil - 0.1, `${nom} : part non recouverte ${pourcent(m.libre)} (≥ ${Math.round((seuil - 0.1) * 100)} %)`);
  verifier(!m.defilePage && !m.defileHote, `${nom} : aucun défilement de la page dans l’atelier`);
  verifier(m.recouvre, `${nom} : l’atelier recouvre toute la fenêtre (barre du hub, barre latérale et onglets masqués)`);
  return m;
}

/** Attend que l'atelier ait enregistré (appuie sur l'état si des changements attendent). */
async function enregistrer(page, { toucher = false } = {}) {
  const etat = page.getByTestId('esport-editeur-enregistrer');
  if ((await etat.getAttribute('data-etat')) !== 'enregistre') await (toucher ? etat.tap() : etat.click()).catch(() => undefined);
  await page.locator('[data-testid="esport-editeur-enregistrer"][data-etat="enregistre"]').waitFor({ timeout: 20_000 });
}
const ouvrirStrat = async (page, id, { toucher = false } = {}) => {
  const bouton = page.getByTestId(`esport-strat-ouvrir-${id}`);
  await bouton.waitFor({ timeout: 20_000 });
  await (toucher ? bouton.tap() : bouton.click());
  await page.locator('[data-testid="esport-canevas"] canvas').first().waitFor({ timeout: 30_000 });
  await pause(900);
};

// ------------------------------------------------------------- Documents de démonstration (créés par l'API)
const J = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7'];
const ic = (agent, slot) => `${CDN}/agents/${agent}/abilities/${slot.toLowerCase()}/displayicon.png`;
const pion = (id, agent, joueur, x, y, plus = {}) => ({ id, type: 'agent', x, y, agent, nom: agent[0].toUpperCase() + agent.slice(1), icone: `${CDN}/agents/${agent}/displayicon.png`, joueur, couleur: joueur === null ? '#ef4444' : J[joueur], ...plus });
const cap = (id, agent, slot, i, joueur, x, y, zone, ordre, plus = {}) => ({ id, type: 'capacite', x, y, agent, capacite: slot, nom: NOMS_CAPACITES[agent][i], icone: ic(agent, slot), joueur, couleur: joueur === null ? '#ef4444' : J[joueur], zone, ordre, ...plus });
function documentDemo() {
  return {
    format: 'esport-strat', version: 3, jeu: 'valorant', modele: 'valorant', side: 'attaque', economie: 'full',
    carte: { cle: 'ascent', nom: 'Ascent', image: `${CDN}/maps/ascent/displayicon.png`, echelle: null },
    joueurs: [
      { nom: 'Kai', couleur: J[0], agent: 'omen', role: 'IGL' }, { nom: 'Léa', couleur: J[1], agent: 'sova', role: 'Info' }, { nom: 'Noa', couleur: J[2], agent: 'viper', role: 'Lurk' },
      { nom: 'Sam', couleur: J[3], agent: 'breach', role: 'Entry' }, { nom: 'Mia', couleur: J[4], agent: 'neon', role: 'Entry' },
    ],
    etapes: [
      {
        id: 'e1', titre: 'Prise du site A', note: '**Smoke heaven**, puis flash de Breach.\n\n- Omen joue le lurk\n- Plant par défaut', phase: 'execute', duree: 8,
        objets: [
          pion('p1', 'omen', 0, 220, 760, { angle: -70 }), pion('p2', 'sova', 1, 300, 820), pion('p3', 'viper', 2, 790, 800, { angle: -100 }), pion('p4', 'breach', 3, 240, 560), pion('p5', 'neon', 4, 180, 600),
          pion('x1', 'jett', null, 200, 190), pion('x2', 'inconnu', null, 760, 200),
          cap('c1', 'omen', 'Ability2', 2, 0, 220, 300, { forme: 'cercle', rayon: 4.1 }, 1),
          cap('c2', 'omen', 'Ability2', 2, 0, 300, 180, { forme: 'cercle', rayon: 4.1 }, 2, { creux: true }),
          cap('c3', 'viper', 'Grenade', 0, 2, 760, 560, { forme: 'cercle', rayon: 4.5 }, 3),
          cap('c4', 'viper', 'Ability2', 2, 2, 640, 720, { forme: 'mur', angle: -80, longueur: 44, largeur: 1, courbure: 0 }, 4),
          cap('c5', 'breach', 'Ability1', 1, 3, 230, 520, { forme: 'cone', angle: -88, ouverture: 110, portee: 12 }, 5),
          cap('c6', 'sova', 'Ability2', 2, 1, 500, 470, { forme: 'trajet', dx: -190, dy: 330, rayon: 9 }, 6),
          cap('c7', 'cypher', 'Grenade', 0, null, 690, 130, { forme: 'ligne', angle: 0, longueur: 15 }, 7),
          cap('c8', 'neon', 'Grenade', 0, 4, 190, 560, { forme: 'mur', angle: -90, longueur: 24, largeur: 4.5, courbure: 0, double: true }, 8),
          cap('c9', 'sage', 'Grenade', 0, null, 480, 215, { forme: 'mur', angle: 0, longueur: 10.5, largeur: 1, courbure: 0 }, 9),
          cap('c10', 'phoenix', 'Grenade', 0, null, 560, 420, { forme: 'mur', angle: 20, longueur: 18, largeur: 1, courbure: 0, trace: [5, 1, 10, 4, 14, 9] }, 10),
          cap('c11', 'killjoy', 'Ability2', 2, null, 760, 240, { forme: 'cone', angle: 90, ouverture: 100, portee: 14 }, 11),
          cap('c12', 'killjoy', 'Ultimate', 3, null, 820, 800, { forme: 'cercle', rayon: 12 }, 12),
          cap('c13', 'breach', 'Ability2', 2, 3, 300, 600, { forme: 'rect', angle: -60, longueur: 20, largeur: 5 }, 13),
          cap('c14', 'killjoy', 'Ability1', 1, null, 650, 800, { forme: 'cercle', rayon: 5.5 }, 14),
          { id: 'f1', type: 'fleche', points: [220, 760, 215, 640, 222, 520, 230, 400], couleur: J[0], epaisseur: 5, tirets: false, joueur: 0, t0: 1, t1: 6 },
          { id: 'f2', type: 'fleche', points: [790, 800, 700, 780, 600, 790, 500, 700], couleur: J[2], epaisseur: 5, tirets: true },
          { id: 'f3', type: 'fleche', points: [300, 820, 420, 700, 500, 520], couleur: J[1], epaisseur: 5, tirets: false, usage: 'regard' },
          { id: 'm1', type: 'marqueur', x: 250, y: 215, genre: 'plant', etiquette: 'Plant défaut', couleur: '#f97316' },
          { id: 'm2', type: 'marqueur', x: 500, y: 300, genre: 'danger', etiquette: '', couleur: '#ef4444' },
          { id: 'v1', type: 'vision', x: 200, y: 190, angle: 80, ouverture: 70, portee: 22, joueur: null, couleur: '#ef4444' },
          { id: 't1', type: 'texte', x: 560, y: 880, texte: 'Rotation B à 0:40', couleur: '#ffffff', taille: 24 },
        ],
      },
      { id: 'e2', titre: 'Post-plant', note: 'On tient croisé.', phase: 'post-plant', duree: 6, objets: [pion('q1', 'omen', 0, 300, 250), pion('q2', 'sova', 1, 180, 330), pion('q3', 'viper', 2, 500, 400), cap('d1', 'viper', 'Ability1', 1, 2, 250, 215, { forme: 'cercle', rayon: 4.5 }, 1)] },
    ],
  };
}

const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
try {
  // ================================================================ Mise en place (API)
  log('API : le Fondateur, les teams (Valorant, The Finals, générique), un Joueur');
  const sessFond = (await api('/session', JETON, { methode: 'POST' })).corps.session;
  await api('/moi', sessFond, { methode: 'PUT', corps: { pseudo: 'Fondateur' } });
  const faucons = (await api('/teams', sessFond, { methode: 'POST', corps: { nom: 'Faucons Valorant', jeu: 'valorant', preset: 'valorant_complet' } })).corps.team;
  const roles = (await api(`/teams/${faucons.id}/roles`, sessFond)).corps.roles;
  const sessLea = (await api('/session', await jetonDeProfil(JETON, 'lea12345'), { methode: 'POST' })).corps.session;
  await api('/moi', sessLea, { methode: 'PUT', corps: { pseudo: 'Léa' } });
  // Invitation directe (sans code) : le Fondateur ajoute le compte de Léa à la team.
  await api(`/teams/${faucons.id}/membres`, sessFond, { methode: 'POST', corps: { compte: 'lea12345', roleId: roles.find(r => r.cle === 'joueur').id } });

  const ctxPc = await nouveauContexte(navigateur, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true, acceptDownloads: true });
  await rediriger(ctxPc);
  const pc = await compte(ctxPc, siteAvec.url, relais.code, 'PC');
  let id;

  verifier(!fichiersSite.some(f => /CanevasStrat/.test(f)), 'Konva n’est pas chargé au démarrage du site');
  await allerModule(pc, 'strat_editor');
  if (PARTIES.has('parcours')) {
    // ================================================================ PC : créer une strat, l'atelier plein écran
    log('PC : onglet Strats, nouvelle strat');
    await pc.getByTestId('esport-strats').waitFor({ timeout: 20_000 });
    await pc.getByTestId('esport-strats-nouvelle').click();
    await pc.getByTestId('esport-strats-titre').fill('Exécution A (split)');
    await choisir(pc, 'esport-strats-carte', 'ascent');
    await pc.getByTestId('esport-strats-side-attaque').click();
    await pc.getByTestId('esport-strats-type-execute').click();
    await pc.getByTestId('esport-strats-tags').fill('A, split');
    await pc.getByTestId('esport-strats-creer').click();
    await pc.getByTestId('esport-editeur').waitFor({ timeout: 20_000 });
    await pc.locator('[data-testid="esport-canevas"] canvas').first().waitFor({ timeout: 30_000 });
    verifier(fichiersSite.some(f => /CanevasStrat/.test(f)), 'Konva chargé à la demande (morceau séparé) à l’ouverture de l’éditeur');
    verifier(appelsValorant.some(u => u.startsWith('/v1/maps')) && appelsValorant.some(u => u.startsWith('/v1/agents')), 'cartes et agents lus sur le (faux) valorant-api.com');
    await pause(1200);
    await controlerPlace(pc, 'PC 1440 × 900 (strat vide)', 0.7);
    verifier((await pc.getByTestId('esport-canevas').getAttribute('data-zoom')) === '100', 'à l’ouverture : map entière (zoom 100 %), centrée');
    const carre = await pc.evaluate(() => {
      const c = document.querySelector('[data-testid="esport-canevas"]');
      const r = c.getBoundingClientRect();
      const [px, dx, dy] = c.getAttribute('data-cadre').split(',').map(Number);
      return { gauche: dx, haut: dy, droite: r.width - dx - 1000 * px, bas: r.height - dy - 1000 * px };
    });
    verifier(carre.gauche > 0 && carre.haut > 0 && carre.droite > 0 && carre.bas > 0, `la map entière tient dans le canevas (marges ${Math.round(carre.gauche)}, ${Math.round(carre.haut)}, ${Math.round(carre.droite)}, ${Math.round(carre.bas)} px)`);
    verifier((await pc.getByTestId('esport-atelier-tiroir').count()) === 0, 'tiroir fermé tant que rien n’est choisi');

    log('PC : poser un agent et sa smoke depuis le dock, dessiner une flèche');
    await pc.getByTestId('esport-agent-omen').click();
    verifier((await pc.getByTestId('esport-canevas').getAttribute('data-outil')) === 'agent', 'un appui sur un portrait du dock arme la pose du pion');
    let p = await point(pc, 300, 650);
    await pc.mouse.click(p.x, p.y);
    await pc.getByTestId('esport-capacite-Ability2').click();
    await pc.getByTestId('esport-zone-cercle').click();
    p = await point(pc, 420, 330);
    await pc.mouse.click(p.x, p.y);
    await pc.getByTestId('esport-outil-fleche').click();
    const depart = await point(pc, 300, 650);
    await pc.mouse.move(depart.x, depart.y);
    await pc.mouse.down();
    for (const [x, y] of [[330, 580], [360, 500], [400, 420], [420, 360]]) {
      const q = await point(pc, x, y);
      await pc.mouse.move(q.x, q.y, { steps: 4 });
    }
    await pc.mouse.up();
    log('PC : mur de Viper posé en cliquant-glissant, poignées tirées à la souris');
    await pc.getByTestId('esport-agent-viper').click();
    verifier((await pc.getByTestId('esport-agent-viper-portrait-image').count()) === 1, 'dock : portrait de Viper');
    await pc.getByTestId('esport-capacite-Ability2').click();
    verifier(await pc.getByTestId('esport-barre-capacites').isVisible(), 'dock : capacités de l’agent choisi (C, Q, E, X)');
    await pc.getByTestId('esport-zone-auto').click();
    await glisserSouris(pc, await point(pc, 500, 500), await point(pc, 900, 500));
    verifier((await pc.getByTestId('esport-atelier-tiroir').count()) === 1, 'le tiroir s’ouvre quand un objet est choisi');
    const murDuServeur = async () => {
      const l0 = (await api(`/teams/${faucons.id}/strats`, sessFond)).corps.strats;
      return (await api(`/teams/${faucons.id}/strats/${l0[0].id}`, sessFond)).corps.donnees.etapes[0].objets.find(o => o.type === 'capacite' && o.agent === 'viper');
    };
    // Extrémité saisie à 15 px de son centre (zone de prise de 48 px) : le mur tourne autour de son origine.
    const fin = await point(pc, 900, 500);
    await glisserSouris(pc, { x: fin.x + 11, y: fin.y + 10 }, await point(pc, 750, 750));
    // Puis tirée bien au-delà de la longueur réelle, en diagonale : bornée à 60 m (480 unités à l'échelle par défaut).
    const fin2 = await point(pc, 750, 750);
    await glisserSouris(pc, fin2, await point(pc, 980, 980));
    await capture(pc, '11-pc-1440-selection-tiroir');
    await enregistrer(pc);
    let murViper = await murDuServeur();
    log('mur de Viper (poignée de fin)', JSON.stringify(murViper?.zone), murViper?.x, murViper?.y);
    verifier(murViper?.zone?.forme === 'mur' && Math.abs(murViper.x - 500) < 1 && Math.abs(murViper.y - 500) < 1, 'serveur : mur de Viper posé par cliquer-glisser, origine à l’appui');
    verifier(murViper?.zone.longueur === 60, `poignée de fin saisie hors centre puis tirée au-delà : longueur bornée à 60 m (${murViper?.zone.longueur} m)`);
    verifier(murViper && Math.abs(murViper.zone.angle - 45) < 4, `poignée de fin : rotation autour de l’origine (${murViper?.zone.angle}°)`);
    const fin0 = murViper ? { x: murViper.x + murViper.zone.longueur * 8 * Math.cos((murViper.zone.angle * Math.PI) / 180), y: murViper.y + murViper.zone.longueur * 8 * Math.sin((murViper.zone.angle * Math.PI) / 180) } : { x: 0, y: 0 };
    verifier(murViper?.icone === `${CDN}/agents/viper/abilities/ability2/displayicon.png`, 'icône de la capacité (CDN Riot) dans le document');
    // Première extrémité tirée : le point de pose suit, l'autre extrémité reste.
    await glisserSouris(pc, await point(pc, 500, 500), await point(pc, 440, 520));
    // Enregistrement AUTOMATIQUE : rien à cliquer, l'état repasse à « Enregistré ».
    verifier(['modifie', 'enregistrement'].includes(await pc.getByTestId('esport-editeur-enregistrer').getAttribute('data-etat')), 'après un changement : « Modifications non enregistrées »');
    await pc.locator('[data-testid="esport-editeur-enregistrer"][data-etat="enregistre"]').waitFor({ timeout: 15_000 });
    verifier(true, 'enregistrement automatique : l’état revient à « Enregistré » sans clic');
    murViper = await murDuServeur();
    log('mur de Viper (poignée de début)', JSON.stringify(murViper?.zone), murViper?.x, murViper?.y);
    verifier(murViper && murViper.x < 490 && murViper.y > 510 && murViper.zone.longueur === 60, `poignée de début : le point de pose a suivi la souris, longueur bornée à 60 m (${murViper?.x}, ${murViper?.y})`);
    const finX = murViper ? murViper.x + murViper.zone.longueur * 8 * Math.cos((murViper.zone.angle * Math.PI) / 180) : 0;
    const finY = murViper ? murViper.y + murViper.zone.longueur * 8 * Math.sin((murViper.zone.angle * Math.PI) / 180) : 0;
    verifier(Math.abs(finX - fin0.x) < 3 && Math.abs(finY - fin0.y) < 3, `poignée de début : l’autre extrémité est restée en place (${Math.round(finX)}, ${Math.round(finY)})`);

    log('PC : titre et note de l’étape, annuler / rétablir, étape ajoutée avec reprise des pions');
    await pc.getByTestId('esport-etape-titre').fill('Mise en place');
    await pc.getByTestId('esport-etape-note-ouvrir').click();
    await pc.getByTestId('esport-etape-note').fill('Smoke heaven, Omen joue le lurk.');
    await pc.keyboard.press('Escape');
    await pc.keyboard.press('Control+z');
    await pc.keyboard.press('Control+Shift+z');
    await pc.getByTestId('esport-etape-num-ajouter').click();
    verifier((await pc.getByTestId('esport-etape-position').textContent()).includes('Étape 2 / 2'), 'étape ajoutée (2 / 2)');
    await capture(pc, '01-pc-editeur-etape-2');
    await enregistrer(pc);
    const liste = (await api(`/teams/${faucons.id}/strats`, sessFond)).corps.strats;
    id = liste[0]?.id;
    let detail = (await api(`/teams/${faucons.id}/strats/${id}`, sessFond)).corps;
    const repris = detail.donnees?.etapes[1]?.objets ?? [];
    const omen2 = repris.find(o => o.type === 'agent' && o.agent === 'omen');
    verifier(repris.length === 1 && omen2 && Math.abs(omen2.x - 420) < 12 && Math.abs(omen2.y - 360) < 12, `nouvelle étape : le pion d’Omen est repris au BOUT de sa flèche (${omen2?.x}, ${omen2?.y}), sans les utilitaires`);
    await pc.getByTestId('esport-etape-num-0').click();
    if (await pc.getByTestId('esport-tiroir-fermer').count()) await pc.getByTestId('esport-tiroir-fermer').click();
    await pc.mouse.move(700, 120);
    await capture(pc, '10-pc-1440-defaut');
    await controlerPlace(pc, 'PC 1440 × 900 (panneaux par défaut)', 0.7);

    const objets = detail.donnees?.etapes[0]?.objets ?? [];
    verifier(detail.donnees?.etapes.length === 2, 'serveur : deux étapes');
    verifier(objets.some(o => o.type === 'agent' && o.agent === 'omen' && o.icone === `${CDN}/agents/omen/displayicon.png`), 'serveur : agent Omen (icône Riot directe)');
    verifier(objets.some(o => o.type === 'capacite' && o.capacite === 'Ability2' && o.zone?.forme === 'cercle'), 'serveur : smoke (capacité, zone cercle)');
    verifier(objets.some(o => o.type === 'fleche' && o.points.length >= 4), 'serveur : flèche dessinée');
    verifier(detail.donnees?.etapes[0].note === 'Smoke heaven, Omen joue le lurk.', 'serveur : note de l’étape');
    verifier(detail.donnees?.etapes[0].titre === 'Mise en place', 'serveur : titre de l’étape (saisi dans la frise)');
    verifier(detail.donnees?.carte.image === `${CDN}/maps/ascent/displayicon.png`, 'serveur : minimap d’Ascent en fond');
    verifier(Boolean(detail.miniature?.url), 'serveur : miniature stockée');
    const mini = detail.miniature ? await fetch(detail.miniature.url) : undefined;
    verifier(mini?.status === 200 && mini.headers.get('content-type') === 'image/jpeg', 'miniature lisible par son lien signé (JPEG)');

    log('PC : sélection multiple (rectangle), déplacement de groupe, menu contextuel');
    await pc.getByTestId('esport-outil-selection').click();
    await glisserSouris(pc, await point(pc, 250, 280), await point(pc, 470, 700));
    verifier((await pc.getByTestId('esport-tiroir-multi-compte').textContent()).includes('4'), 'rectangle de sélection : pion, smoke, flèche et mur choisis (4 objets)');
    await glisserSouris(pc, await point(pc, 300, 650), await point(pc, 340, 660));
    await enregistrer(pc);
    detail = (await api(`/teams/${faucons.id}/strats/${id}`, sessFond)).corps;
    const apres = detail.donnees.etapes[0].objets;
    const omen = apres.find(o => o.type === 'agent' && o.agent === 'omen');
    const smoke = apres.find(o => o.type === 'capacite' && o.agent === 'omen');
    verifier(Math.abs(omen.x - 340) < 6 && Math.abs(smoke.x - 460) < 6 && Math.abs(smoke.y - 340) < 6, `déplacement de groupe : le pion (${omen.x}) et la smoke (${smoke.x}, ${smoke.y}) ont bougé ensemble`);
    await pc.keyboard.press('Control+z');
    await pc.keyboard.press('Escape');
    const surSmoke = await point(pc, 420, 330);
    await pc.mouse.click(surSmoke.x, surSmoke.y, { button: 'right' });
    await pc.getByTestId('esport-menu-contextuel').waitFor({ timeout: 5000 });
    verifier((await pc.getByTestId('esport-menu-verrou').count()) === 1 && (await pc.getByTestId('esport-menu-copier-suivante').count()) === 1, 'clic droit sur un objet : menu contextuel (dupliquer, copier vers l’étape suivante, premier plan, verrouiller…)');
    await capture(pc, '12-pc-menu-contextuel');
    await pc.keyboard.press('Escape');
    verifier((await pc.getByTestId('esport-menu-contextuel').count()) === 0 && (await pc.getByTestId('esport-editeur').count()) === 1, 'Échap ferme d’abord le menu, l’atelier reste ouvert');
    await pc.mouse.click(surSmoke.x, surSmoke.y, { button: 'right' });
    await pc.getByTestId('esport-menu-dupliquer').click();
    await pc.keyboard.press('Escape');

    log('PC : glisser un portrait du dock sur la map');
    await pc.getByTestId('esport-agent-jett').scrollIntoViewIfNeeded();
    const jett = await pc.getByTestId('esport-agent-jett').boundingBox();
    await glisserSouris(pc, { x: jett.x + jett.width / 2, y: jett.y + jett.height / 2 }, await point(pc, 620, 240), 14);
    // Une capacité se glisse de la même façon (la morsure de Viper, joueur 1).
    const morsure = await pc.getByTestId('esport-capacite-Grenade').boundingBox();
    await glisserSouris(pc, { x: morsure.x + morsure.width / 2, y: morsure.y + morsure.height / 2 }, await point(pc, 700, 760), 14);
    await enregistrer(pc);
    detail = (await api(`/teams/${faucons.id}/strats/${id}`, sessFond)).corps;
    const o1 = detail.donnees.etapes[0].objets;
    const jettPose = o1.find(o => o.type === 'agent' && o.agent === 'jett');
    verifier(jettPose && Math.abs(jettPose.x - 620) < 8 && Math.abs(jettPose.y - 240) < 8, `portrait glissé du dock : pion de Jett posé à l’endroit du lâcher (${jettPose?.x}, ${jettPose?.y})`);
    const morsurePosee = o1.find(o => o.type === 'capacite' && o.capacite === 'Grenade');
    verifier(morsurePosee && Math.abs(morsurePosee.x - 700) < 8 && morsurePosee.zone?.forme === 'cercle', `capacité glissée du dock : posée à sa taille réelle (${morsurePosee?.x}, ${morsurePosee?.y}, rayon ${morsurePosee?.zone?.rayon} m)`);
    verifier(o1.filter(o => o.type === 'capacite' && o.agent === 'omen').length === 2, 'menu contextuel « Dupliquer » : deux smokes');

    log('PC : bulle « tous les agents », présentation');
    await pc.keyboard.press('Escape');
    await pc.keyboard.press('Escape');
    await pc.getByTestId('esport-dock-grille').click();
    await pc.getByTestId('esport-grille-agents').waitFor({ timeout: 5000 });
    await capture(pc, '13-pc-1440-dock-agents');
    await pc.keyboard.press('Escape');
    await pc.getByTestId('esport-editeur-presentation').click();
    await pc.getByTestId('esport-presentation').waitFor({ timeout: 10_000 });
    await pc.locator('[data-testid="esport-presentation-canevas"] canvas').first().waitFor({ timeout: 20_000 });
    verifier((await pc.getByTestId('esport-presentation-titre').textContent()).includes('1. Mise en place'), 'présentation : titre de l’étape');
    await pc.keyboard.press('ArrowRight');
    verifier((await pc.getByTestId('esport-presentation-position').textContent()).includes('2 / 2'), 'présentation : flèche droite = étape suivante');
    await pc.keyboard.press('ArrowLeft');
    await pc.getByTestId('esport-presentation-joueur-0').click();
    await pc.getByTestId('esport-presentation-laser').click();
    await glisserSouris(pc, await point(pc, 300, 300, 'esport-presentation-canevas'), await point(pc, 520, 420, 'esport-presentation-canevas'), 10);
    await capture(pc, '14-pc-1440-presentation');
    await pc.keyboard.press('Escape');
    verifier((await pc.getByTestId('esport-presentation').count()) === 0 && (await pc.getByTestId('esport-editeur').count()) === 1, 'Échap quitte la présentation et revient à l’atelier');
    await pc.getByTestId('esport-editeur-aide').click();
    verifier(await pc.getByTestId('esport-mention-riot').first().isVisible(), 'mention Riot « Legal Jibber Jabber » affichée dans l’aide de l’atelier');
    verifier(await pc.getByTestId('esport-editeur-raccourcis').isVisible(), 'aide « ? » : raccourcis et gestes');
    await pc.keyboard.press('Escape');

    // ================================================================ Recharger, rouvrir, exporter
    log('PC : recharger la page, rouvrir la strat, exporter un PNG');
    await enregistrer(pc);
    await pc.reload();
    teamOuverte.delete(pc);
    // Le site rouvre l'app où l'on était (Esport), derrière le déverrouillage.
    await pc.locator('[data-testid="hub"]:visible, [data-testid="app-esport"]').first().waitFor({ state: 'attached', timeout: 15_000 }).catch(() => deverrouiller(pc, MDP, secrets.get(pc), 'app-esport'));
    await fermerPopups(pc);
    await allerModule(pc, 'strat_editor');
    await pc.getByTestId(`esport-strat-${id}`).waitFor({ timeout: 20_000 });
    await capture(pc, '03-pc-strats-grille');
    await ouvrirStrat(pc, id);
    verifier((await pc.getByTestId('esport-etape-position').textContent()).includes('Étape 1 / 2'), 'rechargée : deux étapes');
    await pc.getByTestId('esport-etape-note-ouvrir').click();
    verifier((await pc.getByTestId('esport-etape-note').inputValue()) === 'Smoke heaven, Omen joue le lurk.', 'rechargée : note de l’étape (tiroir)');
    await pc.keyboard.press('Escape');
    await pause(800);
    const [telechargement] = await Promise.all([pc.waitForEvent('download', { timeout: 20_000 }), pc.getByTestId('esport-editeur-exporter').click().then(() => pc.getByTestId('esport-editeur-png').click())]);
    const cheminPng = join(TELECHARGEMENTS, telechargement.suggestedFilename());
    await telechargement.saveAs(cheminPng);
    const octets = readFileSync(cheminPng);
    verifier(octets.subarray(1, 4).toString('ascii') === 'PNG' && /\.png$/.test(telechargement.suggestedFilename()), `PNG exporté (${telechargement.suggestedFilename()})`);
    verifier(octets.readUInt32BE(16) === 2000 && octets.readUInt32BE(20) === 2000, 'PNG de 2000 × 2000 (carte entière, ×2)');
    verifier(octets.length > 20_000, 'PNG non vide (carte et objets dessinés)');
    if (process.env.CAPTURES) await telechargement.saveAs(join(CAPTURES, '15-export-etape-1.png'));

    // ================================================================ Playbook
    log('PC : retour à la liste, ajouter au playbook, filtrer, valider');
    await pc.getByTestId('esport-editeur-retour').click();
    await pc.getByTestId('esport-atelier-hote').waitFor({ state: 'detached', timeout: 20_000 });
    verifier(await pc.getByTestId('esport-strats').isVisible(), 'bouton « Strats » : retour à la liste, l’app retrouve sa barre et ses onglets');
    // Actions secondaires de la carte : menu « ⋯ ».
    await pc.getByTestId(`esport-strat-actions-${id}`).click();
    await pc.getByTestId(`esport-strat-playbook-${id}`).click();
    await pc.getByTestId('esport-playbook').waitFor({ timeout: 20_000 });
    const entree = (await api(`/teams/${faucons.id}/playbook`, sessFond)).corps.entrees[0];
    await pc.getByTestId(`esport-playbook-entree-${entree.id}`).waitFor({ timeout: 20_000 });
    await api(`/teams/${faucons.id}/playbook`, sessFond, { methode: 'POST', corps: { titre: 'Protocole anti-éco', type: 'eco', carte: null, description: 'Stack B, pas de peek seul.' } });
    await pc.getByTestId('esport-playbook-filtre-type-execute').click();
    await pc.getByTestId('esport-playbook-compte').filter({ hasText: '1 entrée sur 2' }).waitFor({ timeout: 20_000 });
    verifier(await pc.getByTestId(`esport-playbook-entree-${entree.id}`).isVisible(), 'filtre type « Exécution » : la strat');
    await pc.getByTestId('esport-playbook-filtre-type-eco').click();
    await pc.getByTestId(`esport-playbook-entree-${entree.id}`).waitFor({ state: 'detached', timeout: 20_000 });
    verifier(true, 'filtre type « Éco » : la strat disparaît');
    await pc.getByTestId('esport-playbook-filtre-type-defaut').click();
    await pc.getByTestId('esport-playbook-filtre-carte-ascent').click();
    await pc.getByTestId('esport-playbook-recherche').fill('split');
    await pc.getByTestId('esport-playbook-compte').filter({ hasText: '1 entrée sur 2' }).waitFor({ timeout: 20_000 });
    verifier(await pc.getByTestId(`esport-playbook-entree-${entree.id}`).isVisible(), 'filtres combinés (carte Ascent + recherche) : la strat');
    await pc.getByTestId(`esport-playbook-valider-${entree.id}`).click();
    await pc.getByText(/Entrée validée/).waitFor({ timeout: 20_000 });
    verifier((await pc.getByTestId('esport-playbook-miniature').count()) === 1 && Boolean((await api(`/teams/${faucons.id}/playbook`, sessFond)).corps.entrees.find(e => e.id === entree.id)?.miniature), 'miniature de la strat dans la grille du playbook');
    await capture(pc, '04-pc-playbook');
    const notifsLea = (await api('/notifications', sessLea)).corps.liste.map(n => n.type);
    verifier(notifsLea.includes('playbook-valide'), 'le Joueur est prévenu de l’entrée validée');
    const journal = (await api(`/teams/${faucons.id}/journal`, sessFond)).corps.entrees.map(e => e.action);
    verifier(journal.includes('strat.created') && journal.includes('playbook.validated'), 'journal : strat créée, playbook validé');

    // ================================================================ Lien de lecture seule, puis révoqué
    log('Lien de lecture seule : page publique, puis révocation');
    const lien = (await api(`/teams/${faucons.id}/strats/${id}/partages`, sessFond, { methode: 'POST', corps: {} })).corps;
    const lecture = await ctxPc.newPage();
    await lecture.goto(lien.url);
    verifier((await lecture.locator('svg').count()) === 2 && (await lecture.content()).includes('Legal Jibber Jabber'), 'page publique : deux étapes en SVG, mention Riot');
    await capture(lecture, '05-lien-lecture-seule');
    await api(`/teams/${faucons.id}/strats/${id}/partages/${lien.id}`, sessFond, { methode: 'DELETE' });
    const revoque = await lecture.goto(lien.url);
    verifier(revoque?.status() === 404, 'lien révoqué : 404');
    await lecture.close();
  }

  // Strat de démonstration (toutes les parties suivantes) : 14 capacités variées, deux étapes.
  const demo = (await api(`/teams/${faucons.id}/strats`, sessFond, { methode: 'POST', corps: { titre: 'Démo visuelle', type: 'execute', carte: { cle: 'ascent', nom: 'Ascent', image: `${CDN}/maps/ascent/displayicon.png` }, side: 'attaque' } })).corps;
  const demoEnr = await api(`/teams/${faucons.id}/strats/${demo.id}`, sessFond, { methode: 'PUT', corps: { revision: demo.revision, donnees: documentDemo() } });
  verifier(demoEnr.statut === 200, `strat de démonstration enregistrée par l’API (${demoEnr.statut} ${demoEnr.corps?.message ?? ''})`);
  const objetsDemo = demoEnr.corps?.donnees?.etapes?.[0]?.objets ?? [];
  verifier(objetsDemo.find(o => o.id === 'c2')?.creux === true && objetsDemo.find(o => o.id === 'f3')?.usage === 'regard', 'serveur : variante creuse d’une smoke et usage « regard » d’un tracé gardés dans le document');
  // Callouts, sites et échelle d'Ascent dans le profil Valorant (Administration › Jeux).
  const profil = (await api('/jeux/valorant', sessFond)).corps;
  if (profil?.donnees) {
    const cartes = (profil.donnees.cartes ?? []).filter(c => c.cle !== 'ascent');
    cartes.push({
      cle: 'ascent', nom: 'Ascent', actif: true,
      echelle: { points: [100, 500, 900, 500], distance: 100 },
      zones: [
        { cle: 'a-main', nom: 'A Main', points: [180, 300, 260, 300, 260, 660, 180, 660], couleur: '#38bdf8' },
        { cle: 'mid', nom: 'Mid', points: [400, 340, 600, 340, 600, 620, 400, 620] },
        { cle: 'b-main', nom: 'B Main', points: [720, 300, 800, 300, 800, 680, 720, 680], couleur: '#f472b6' },
        { cle: 'heaven', nom: 'Heaven', points: [340, 180, 620, 180, 620, 250, 340, 250] },
      ],
      reperes: [
        { cle: 'a', nom: 'A', type: 'site', x: 220, y: 210 }, { cle: 'b', nom: 'B', type: 'site', x: 760, y: 200 },
        { cle: 'spawn-att', nom: 'Spawn attaque', type: 'spawn-attaque', x: 480, y: 800 }, { cle: 'spawn-def', nom: 'Spawn défense', type: 'spawn-defense', x: 500, y: 215 },
        { cle: 'market', nom: 'Market', type: 'callout', x: 660, y: 500 }, { cle: 'tree', nom: 'Tree', type: 'callout', x: 330, y: 480 },
      ],
    });
    const maj = await api('/jeux/valorant', sessFond, { methode: 'PATCH', corps: { version: profil.version, donnees: { ...profil.donnees, cartes } } });
    verifier(maj.statut === 200, `profil Valorant : callouts, sites et échelle d’Ascent (${maj.statut} ${maj.corps?.message ?? ''})`);
  } else log('profil Valorant illisible : pas de callouts dans les captures', JSON.stringify(profil).slice(0, 200));

  if (PARTIES.has('visuel')) {
    log('Visuel : strat aux 14 capacités, 100 % et 300 %, image d’origine de la map, 1920 × 1080');
    await pc.reload();
    teamOuverte.delete(pc);
    await pc.locator('[data-testid="hub"]:visible, [data-testid="app-esport"]').first().waitFor({ state: 'attached', timeout: 15_000 }).catch(() => deverrouiller(pc, MDP, secrets.get(pc), 'app-esport'));
    await fermerPopups(pc);
    await allerModule(pc, 'strat_editor');
    await ouvrirStrat(pc, demo.id);
    await pause(1500);
    await capture(pc, '20-visuel-1440-100');
    await controlerPlace(pc, 'PC 1440 × 900 (strat chargée)', 0.7);
    // Légende, puis zoom à 300 % au pointeur (molette) sur le site A.
    await pc.getByTestId('esport-editeur-plus').click();
    await pc.getByTestId('esport-plus-legende').click();
    await pc.keyboard.press('Escape');
    await capture(pc, '21-visuel-1440-legende');
    const cible = await point(pc, 250, 330);
    await pc.mouse.move(cible.x, cible.y);
    for (let i = 0; i < 10; i++) {
      await pc.mouse.wheel(0, -120);
      await pause(40);
    }
    await pause(500);
    const zoom = Number(await pc.getByTestId('esport-canevas').getAttribute('data-zoom'));
    const apresZoom = await point(pc, 250, 330);
    verifier(zoom >= 290 && Math.hypot(apresZoom.x - cible.x, apresZoom.y - cible.y) < 3, `zoom à la molette : ${zoom} %, le point sous le pointeur n’a pas bougé`);
    await capture(pc, '22-visuel-1440-300');
    // Double-clic sur le vide : map entière.
    const vide = await pc.getByTestId('esport-canevas').boundingBox();
    await pc.mouse.dblclick(vide.x + vide.width - 30, vide.y + vide.height - 30);
    await pause(300);
    verifier((await pc.getByTestId('esport-canevas').getAttribute('data-zoom')) === '100', 'double-clic sur le vide : map entière');
    // Valorant : toujours l'image d'origine de la map, ni thème ni atténuation proposés.
    await pc.getByTestId('esport-editeur-plus').click();
    await pc.getByTestId('esport-plus-affichage').click();
    verifier((await pc.getByTestId('esport-theme-carte-clair').count()) === 0 && (await pc.getByTestId('esport-attenuer-1').count()) === 0, 'Valorant : pas de thème ni d’atténuation de la map');
    await pc.keyboard.press('Escape');
    // Lecture animée : déploiement, anneaux de durée, trajets.
    await pc.getByTestId('esport-barre-lecture').click();
    await pause(2600);
    await pc.getByTestId('esport-barre-lecture').click();
    await capture(pc, '24-visuel-lecture');
    await pc.getByTestId('esport-lecture-arreter').click();
    // Comparaison avec l'étape d'une autre version.
    await pc.getByTestId('esport-editeur-comparer').click();
    await pc.getByTestId('esport-comparaison').waitFor({ timeout: 10_000 });
    await pc.locator('[data-testid="esport-comparaison-a"] canvas').first().waitFor({ timeout: 20_000 });
    await pause(600);
    const choix = pc.locator('[data-testid^="esport-comparaison-choix-"]').first();
    if (await choix.count()) await choix.click();
    await pause(900);
    await capture(pc, '25-visuel-comparaison');
    verifier((await pc.locator('[data-testid="esport-comparaison-a"] canvas').count()) > 0, 'comparaison côte à côte à la place du canevas');
    await pc.getByTestId('esport-editeur-comparer').click();
    // 1920 × 1080.
    await pc.setViewportSize({ width: 1920, height: 1080 });
    await pause(900);
    await capture(pc, '26-visuel-1920-100');
    await controlerPlace(pc, 'PC 1920 × 1080', 0.7);
    await pc.setViewportSize({ width: 1440, height: 900 });
    await pause(500);
  }

  if (PARTIES.has('thefinals')) {
    log('The Finals : profil (image de type photo déposée), strat aux gadgets, étages ; jeu générique');
    const image = png(512, photo).toString('base64');
    const cree = await api('/jeux', sessFond, { methode: 'POST', corps: { cle: 'the-finals', nom: 'The Finals', modeleStrat: 'thefinals', donnees: { formats: [{ nom: '3v3v3v3', equipes: 4, joueursParEquipe: 3, bo: [1] }], cartes: [{ nom: 'Monaco' }] } } });
    const depot = await api('/jeux/the-finals/images', sessFond, { methode: 'POST', corps: { type: 'image/png', donnees: image, nom: 'monaco.png' } });
    log('profil The Finals', cree.statut, 'image', depot.statut, JSON.stringify(depot.corps).slice(0, 160));
    const tfProfil = (await api('/jeux/the-finals', sessFond)).corps;
    const fichier = depot.corps?.id ?? depot.corps?.fichier ?? depot.corps?.image?.id;
    const majTf = await api('/jeux/the-finals', sessFond, {
      methode: 'PATCH',
      corps: {
        version: tfProfil.version,
        donnees: {
          ...tfProfil.donnees,
          cartes: [{
            cle: 'monaco', nom: 'Monaco', actif: true, ...(fichier ? { fichier } : {}),
            niveaux: [{ cle: 'rdc', nom: 'RDC' }, { cle: 'etage-1', nom: 'Étage 1' }, { cle: 'toit', nom: 'Toit' }],
            reperes: [{ cle: 'cashout-a', nom: 'Cashout A', type: 'cashout', x: 300, y: 300 }, { cle: 'cashout-b', nom: 'Cashout B', type: 'cashout', x: 700, y: 640 }, { cle: 'coffre-1', nom: 'Coffre', type: 'coffre', x: 520, y: 180 }],
            zones: [{ cle: 'place', nom: 'Place', points: [400, 400, 600, 400, 600, 600, 400, 600], couleur: '#fbbf24' }],
          }],
        },
      },
    });
    verifier(majTf.statut === 200, `profil The Finals : map Monaco, image déposée, étages, cashouts (${majTf.statut} ${majTf.corps?.message ?? ''})`);
    const tf = (await api('/teams', sessFond, { methode: 'POST', corps: { nom: 'Finalistes', jeu: 'the-finals' } })).corps.team;
    const mods = (await api(`/teams/${tf.id}`, sessFond)).corps;
    log('team The Finals', tf?.slug, 'modules', (mods?.modules ?? []).filter(m => m.active).map(m => m.cle).join(','));
    if (!(mods?.modules ?? []).some(m => m.cle === 'strat_editor' && m.active)) await api(`/teams/${tf.id}/modules/strat_editor`, sessFond, { methode: 'PUT', corps: { active: true } });
    const stratTf = (await api(`/teams/${tf.id}/strats`, sessFond, { methode: 'POST', corps: { titre: 'Défense du cashout', type: 'default', carte: { cle: 'monaco', nom: 'Monaco', image: null }, side: 'attaque' } })).corps;
    verifier(stratTf?.modele === 'thefinals' && stratTf.donnees?.joueurs.length === 3, `strat The Finals : modèle du jeu, 3 joueurs (${stratTf?.modele}, ${stratTf?.donnees?.joueurs?.length})`);
    const g = (id, classe, capacite, nom, joueur, x, y, zone, ordre, plus = {}) => ({ id, type: 'capacite', x, y, agent: classe, capacite, nom, icone: null, joueur, couleur: joueur === null ? '#f43f5e' : J[joueur], zone, ordre, ...plus });
    const docTf = {
      ...stratTf.donnees,
      etapes: [{
        id: 'e1', titre: 'Tenue du cashout A', note: 'Heavy tient la porte, Medium soigne.', phase: 'tenue', duree: 8,
        objets: [
          { id: 'p1', type: 'agent', x: 280, y: 360, agent: 'heavy', nom: 'Heavy', icone: null, joueur: 0, couleur: J[0], niveau: 0 },
          { id: 'p2', type: 'agent', x: 360, y: 280, agent: 'medium', nom: 'Medium', icone: null, joueur: 1, couleur: J[1], niveau: 0 },
          { id: 'p3', type: 'agent', x: 240, y: 240, agent: 'light', nom: 'Light', icone: null, joueur: 2, couleur: J[2], niveau: 1 },
          { id: 'x1', type: 'agent', x: 640, y: 420, agent: 'heavy', nom: 'Heavy', icone: null, joueur: null, couleur: '#f43f5e' },
          { id: 'x2', type: 'agent', x: 700, y: 520, agent: 'inconnu', nom: '?', icone: null, joueur: null, couleur: '#f59e0b' },
          g('g1', 'heavy', 'dome-shield', 'Dome Shield', 0, 300, 300, { forme: 'cercle', rayon: 5 }, 1),
          g('g2', 'heavy', 'barricade', 'Barricade', 0, 380, 380, { forme: 'mur', angle: 40, longueur: 5, largeur: 0.6, courbure: 0 }, 2),
          g('g3', 'heavy', 'goo-grenade', 'Goo Grenade', 0, 420, 300, { forme: 'cercle', rayon: 3 }, 3),
          g('g4', 'medium', 'jump-pad', 'Jump Pad', 1, 200, 420, { forme: 'cercle', rayon: 2 }, 4),
          g('g5', 'medium', 'gas-mine', 'Gas Mine', 1, 470, 430, { forme: 'cercle', rayon: 5 }, 5),
          g('g6', 'medium', 'zipline', 'Zipline', 1, 420, 180, { forme: 'ligne', angle: 180, longueur: 22 }, 6),
          g('g7', 'light', 'smoke-grenade', 'Smoke Grenade', 2, 560, 330, { forme: 'cercle', rayon: 6 }, 7),
          g('g8', 'light', 'pyro-grenade', 'Pyro Grenade', 2, 600, 460, { forme: 'cercle', rayon: 4 }, 8),
          g('g9', 'light', 'thermal-vision', 'Thermal Vision', 2, 240, 240, { forme: 'cone', angle: 20, ouverture: 90, portee: 30 }, 9),
          g('g10', 'heavy', 'mesh-shield', 'Mesh Shield', null, 640, 420, { forme: 'mur', angle: 100, longueur: 4, largeur: 0.5, courbure: 0.4 }, 10),
          { id: 'm1', type: 'marqueur', x: 520, y: 520, genre: 'destruction-mur', etiquette: 'Mur à casser', couleur: '#f97316' },
          { id: 'm2', type: 'marqueur', x: 340, y: 520, genre: 'destruction-sol', etiquette: '', couleur: '#f97316' },
          { id: 'm3', type: 'marqueur', x: 760, y: 300, genre: 'ennemi', etiquette: '', couleur: '#f43f5e', equipe: 2 },
          { id: 'm4', type: 'marqueur', x: 820, y: 720, genre: 'tiers', etiquette: 'Third-party', couleur: '#8b5cf6' },
          { id: 'f1', type: 'fleche', points: [640, 420, 560, 400, 470, 360, 380, 330], couleur: '#f43f5e', epaisseur: 5, tirets: true },
        ],
      }],
    };
    const enrTf = await api(`/teams/${tf.id}/strats/${stratTf.id}`, sessFond, { methode: 'PUT', corps: { revision: stratTf.revision, donnees: docTf } });
    verifier(enrTf.statut === 200, `strat The Finals enregistrée (gadgets, marqueurs de destruction, étages) (${enrTf.statut} ${enrTf.corps?.message ?? ''})`);
    await pc.reload();
    teamOuverte.delete(pc);
    await pc.locator('[data-testid="hub"]:visible, [data-testid="app-esport"]').first().waitFor({ state: 'attached', timeout: 15_000 }).catch(() => deverrouiller(pc, MDP, secrets.get(pc), 'app-esport'));
    await fermerPopups(pc);
    await allerModule(pc, 'strat_editor', tf.slug);
    await ouvrirStrat(pc, stratTf.id);
    await pause(1500);
    verifier((await pc.getByTestId('esport-editeur-mode').count()) === 1 && (await pc.getByTestId('esport-editeur-side-attaque').count()) === 0, 'The Finals : mode (Cashout / Final Round) dans la barre, pas d’attaque / défense');
    verifier((await pc.getByTestId('esport-editeur-niveau').count()) === 1, 'The Finals : étage courant dans la barre');
    verifier((await pc.locator('[data-testid^="esport-joueur-"][data-testid$="-portrait-initiales"], [data-testid^="esport-joueur-"][data-testid$="-portrait-image"]').count()) === 3, 'The Finals : trois joueurs dans le dock');
    await capture(pc, '30-thefinals-1440');
    await controlerPlace(pc, 'The Finals, PC 1440 × 900', 0.7);
    await pc.getByTestId('esport-agent-heavy').click();
    verifier((await pc.getByTestId('esport-dock-categorie-gadget').count()) === 1, 'The Finals : spécialisations, gadgets et armes de la classe dans le dock');
    await pc.getByTestId('esport-dock-categorie-gadget').click();
    await pc.getByTestId('esport-agents-camp-ennemi').click();
    verifier((await pc.getByTestId('esport-agents-equipe-3').count()) === 1, 'The Finals : équipes adverses 1 à 3');
    await pc.getByTestId('esport-agents-camp-allie').click();
    await pc.keyboard.press('Escape');
    await pc.getByTestId('esport-editeur-plus').click();
    await pc.getByTestId('esport-plus-affichage').click();
    await pc.getByTestId('esport-attenuer-1').click();
    await pc.keyboard.press('Escape');
    await pause(700);
    await capture(pc, '31-thefinals-attenuee');
    await pc.getByTestId('esport-editeur-niveau-plus').click();
    await pause(300);
    await capture(pc, '32-thefinals-etage');
    await pc.getByTestId('esport-editeur-plus').click();
    await pc.getByTestId('esport-plus-affichage').click();
    await pc.getByTestId('esport-attenuer-0').click();
    await pc.keyboard.press('Escape');

    // Jeu générique : pions sans personnage, attaque / défense.
    await api('/jeux', sessFond, { methode: 'POST', corps: { cle: 'rocket-league', nom: 'Rocket League', donnees: { formats: [{ nom: '3v3', equipes: 2, joueursParEquipe: 3, bo: [5] }], cartes: [{ nom: 'DFH Stadium' }] } } });
    const rl = (await api('/teams', sessFond, { methode: 'POST', corps: { nom: 'Fusées', jeu: 'rocket-league' } })).corps.team;
    const modsRl = (await api(`/teams/${rl.id}`, sessFond)).corps;
    if (!(modsRl?.modules ?? []).some(m => m.cle === 'strat_editor' && m.active)) await api(`/teams/${rl.id}/modules/strat_editor`, sessFond, { methode: 'PUT', corps: { active: true } });
    const stratRl = (await api(`/teams/${rl.id}/strats`, sessFond, { methode: 'POST', corps: { titre: 'Kickoff', type: 'default', carte: { cle: 'dfh-stadium', nom: 'DFH Stadium', image: null }, side: 'attaque' } })).corps;
    verifier(stratRl?.modele === 'generique', `strat générique (${stratRl?.modele})`);
    await pc.reload();
    teamOuverte.delete(pc);
    await pc.locator('[data-testid="hub"]:visible, [data-testid="app-esport"]').first().waitFor({ state: 'attached', timeout: 15_000 }).catch(() => deverrouiller(pc, MDP, secrets.get(pc), 'app-esport'));
    await fermerPopups(pc);
    await allerModule(pc, 'strat_editor', rl.slug);
    await ouvrirStrat(pc, stratRl.id);
    await pc.getByTestId('esport-outil-agent').click();
    const milieu = await point(pc, 500, 500);
    await pc.mouse.click(milieu.x, milieu.y);
    await enregistrer(pc);
    const objetsRl = (await api(`/teams/${rl.id}/strats/${stratRl.id}`, sessFond)).corps.donnees.etapes[0].objets;
    verifier(objetsRl.some(o => o.type === 'agent' && Math.abs(o.x - 500) < 4), `jeu générique : pion posé (${JSON.stringify(objetsRl.map(o => o.agent))})`);
    await pc.keyboard.press('Escape');
    await capture(pc, '33-generique-1440');
    await controlerPlace(pc, 'Générique, PC 1440 × 900', 0.7);
  }

  if (PARTIES.has('ipad')) {
    // ================================================================ iPad portrait (tactile)
    for (const [l, h] of [[820, 1180], [1024, 1366]]) {
      log(`iPad portrait ${l} × ${h} (tactile)`);
      valorantEnPanne = l === 1024;
      const ctxIpad = await nouveauContexte(navigateur, {
        viewport: { width: l, height: h },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        ignoreHTTPSErrors: true,
        userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      });
      await rediriger(ctxIpad);
      const ipad = await compte(ctxIpad, siteAvec.url, relais.code, `iPad-${l}`, pc);
      await allerModule(ipad, 'strat_editor');
      await ouvrirStrat(ipad, demo.id, { toucher: true });
      await pause(1200);
      await controlerPlace(ipad, `iPad portrait ${l} × ${h}`, 0.6);
      await capture(ipad, `40-ipad-${l}-defaut`);
      if (l === 1024) {
        // valorant-api.com en panne : repli générique ; un agent posé du doigt, sa poignée de regard tirée au doigt.
        const kayo = ipad.getByTestId('esport-agent-kay-o');
        verifier((await kayo.count()) === 1, 'repli hors ligne : agents de la liste intégrée');
        await kayo.scrollIntoViewIfNeeded();
        await kayo.tap();
        const doigt = await point(ipad, 880, 420);
        await ipad.touchscreen.tap(doigt.x, doigt.y);
        await enregistrer(ipad, { toucher: true });
        const surIpad = (await api(`/teams/${faucons.id}/strats/${demo.id}`, sessFond)).corps.donnees.etapes[0].objets;
        const kayoIpad = surIpad.find(o => o.type === 'agent' && o.agent === 'kay-o');
        if (!kayoIpad) console.log('  objets :', JSON.stringify(surIpad.map(o => [o.type, o.agent ?? '', o.icone ?? null])));
        // Le document ne garde qu'une adresse du CDN officiel (ou rien) : jamais un lien signé du stockage.
        verifier(Boolean(kayoIpad) && (kayoIpad.icone === null || /^https:\/\/media\.valorant-api\.com\//.test(kayoIpad.icone)), 'iPad : agent posé au doigt (portrait : adresse du CDN officiel ou initiales, jamais un lien signé)');
        // Le pion posé est sélectionné : sa poignée de regard (au-dessus, 48 unités) se tire au doigt.
        const regard = await point(ipad, 880, 372);
        await glisserDoigt(ipad, { x: regard.x + 8, y: regard.y + 6 }, await point(ipad, 990, 420));
        await capture(ipad, '41-ipad-1024-poignee-regard');
        let kayoPose;
        for (let i = 0; i < 40 && !(kayoPose && typeof kayoPose.angle === 'number'); i++) {
          await pause(300);
          kayoPose = (await api(`/teams/${faucons.id}/strats/${demo.id}`, sessFond)).corps.donnees.etapes[0].objets.find(o => o.type === 'agent' && o.agent === 'kay-o');
        }
        verifier(kayoPose && Math.abs(kayoPose.angle) <= 20, `iPad : poignée de regard saisie au doigt hors centre et tirée de -90° vers 0° (${kayoPose?.angle}°), enregistrée automatiquement`);
        verifier((await ipad.getByTestId('esport-atelier-tiroir').count()) === 1, 'iPad : le tiroir s’ouvre en feuille basse à la sélection');
        await capture(ipad, '42-ipad-1024-feuille');
      } else {
        await ipad.getByTestId('esport-editeur-presentation').tap();
        await ipad.locator('[data-testid="esport-presentation-canevas"] canvas').first().waitFor({ timeout: 20_000 });
        await pause(800);
        await capture(ipad, '43-ipad-820-presentation');
        await ipad.getByTestId('esport-presentation-fermer').tap();
      }
      const defile = await ipad.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      verifier(!defile, `iPad ${l} : pas de défilement horizontal de la page`);
      await ctxIpad.close();
      valorantEnPanne = false;
    }
  }

  if (PARTIES.has('telephone')) {
    log('Téléphone 390 × 844 : lecture d’abord, « Modifier »');
    const ctxTel = await nouveauContexte(navigateur, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
    await rediriger(ctxTel);
    const tel = await compte(ctxTel, siteAvec.url, relais.code, 'Telephone', pc);
    await allerModule(tel, 'strat_editor');
    await ouvrirStrat(tel, demo.id, { toucher: true });
    await pause(1200);
    const m = await mesure(tel);
    bilan.push(`Téléphone 390 × 844 : canevas ${m.canevas}, ${pourcent(m.part)} de la fenêtre`);
    verifier(m.part >= 0.6 && !m.defilePage && !m.defileHote && m.recouvre, `téléphone : canevas ${pourcent(m.part)} de la fenêtre, aucun défilement, atelier plein écran`);
    verifier((await tel.getByTestId('esport-outil-agent').count()) === 0, 'téléphone : lecture d’abord (pas d’outils tant que l’on n’a pas choisi « Modifier »)');
    await capture(tel, '50-tel-390-lecture');
    await tel.getByTestId('esport-joueur-2').tap();
    await tel.getByTestId('esport-barre-lecture').tap();
    await pause(1500);
    await tel.getByTestId('esport-barre-lecture').tap();
    await capture(tel, '51-tel-390-mon-role');
    await tel.getByTestId('esport-lecture-arreter').tap();
    await tel.getByTestId('esport-etape-suivante').tap();
    verifier((await tel.getByTestId('esport-etape-position').textContent()).includes('2/2'), 'téléphone : étape suivante');
    await tel.getByTestId('esport-etape-note-ouvrir').tap();
    await pause(400);
    await capture(tel, '52-tel-390-note');
    await tel.getByTestId('esport-tiroir-fermer').tap();
    await tel.getByTestId('esport-atelier-mode-edition').tap();
    verifier((await tel.getByTestId('esport-outil-agent').count()) === 1, 'téléphone : « Modifier » ouvre les outils');
    await capture(tel, '53-tel-390-edition');
    const debord = await tel.evaluate(() => {
      const hote = document.querySelector('[data-testid="esport-atelier-hote"]');
      return document.documentElement.scrollWidth > window.innerWidth + 1 || hote.scrollWidth > hote.clientWidth + 1;
    });
    verifier(!debord, 'téléphone : rien ne déborde horizontalement');
    await ctxTel.close();
  }

  verifier(requetesExternes.length === 0, `aucune requête réseau réelle (${requetesExternes.slice(0, 3).join(', ')})`);
  const debord = await pc.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  verifier(!debord, 'PC : pas de défilement horizontal de la page');
  console.log('\nPlace du canevas :');
  for (const ligne of bilan) console.log(`  ${ligne}`);
} catch (e) {
  echecs++;
  console.error(e);
  for (const [nom, page] of pages) await page.screenshot({ path: join(CAPTURES, `echec-${nom}.jpg`), type: 'jpeg', quality: 60 }).catch(() => undefined);
} finally {
  await navigateur.close();
  siteAvec.fermer();
  relais.fermer();
  await esport.fermer();
  fauxValorant.closeAllConnections();
  fauxValorant.close();
}
console.log(echecs === 0 ? 'e2e Esport (strats et playbook) : tout est bon' : `e2e Esport (strats et playbook) : ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
