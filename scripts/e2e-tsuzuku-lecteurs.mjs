/**
 * E2E : bascule automatique de lecteur et préchargement de l'épisode suivant.
 * Petit « internet » local NEUTRE (domaines fictifs *-exemple.fr, aucun site réel) :
 *   - bascule-exemple.fr : « Le Long Voyage », 3 épisodes. Épisodes 1 et 2 : lecteur 1 sur
 *     mort-exemple.fr (injoignable), lecteur 2 sur lecteur-exemple.fr (répond). Épisode 3 : les deux morts.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-tsuzuku-lecteurs.mjs
 *
 * Vérifie : passage automatique au lecteur 2 avec le message discret, lecteur qui marche mémorisé
 * (premier à la réouverture), choix manuel possible, page de l'épisode suivant lue pendant la
 * lecture (sans lancer de vidéo) et « Suivant » rapide, tous échoués : message + Réessayer.
 * Captures : docs/captures-tsuzuku-lecteurs/.
 */

import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHmac } from 'node:crypto';
import { allerPageApplications, nouveauContexte } from './e2e-acceptation.mjs';

const racine = fileURLToPath(new URL('..', import.meta.url));
const requireGlobal = createRequire(join(process.env.PLAYWRIGHT_PATH ?? '/opt/node22/lib/node_modules', 'x.js'));
const { chromium } = requireGlobal('playwright');
const { requeteTsuzuku } = await import(pathToFileURL(join(racine, 'bureau/electron/tsuzuku.mjs')).href);

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-tsuzuku-lecteurs');
mkdirSync(CAPTURES, { recursive: true });
const PORT_SITE = 5199;
const PORT_INTERNET = 5198;
const MDP_ADMIN = 'mot-de-passe-du-pc-e2e-lecteurs-42';

// ------------------------------------------------------------- Catalogue (neutre)
const img = id => `https://img-exemple.fr/${id}.jpg`;
const ANIMES = [{ id: 1, title: 'Nagai Tabi', en: 'The Long Voyage', fr: 'Le Long Voyage' }];
const jikan = a => ({
  mal_id: a.id, title: a.title, title_english: a.en, title_japanese: a.title, titles: [{ type: 'Default', title: a.title }, { type: 'English', title: a.en }, { type: 'French', title: a.fr }],
  synopsis: `Synopsis neutre de ${a.en}.`, images: { jpg: { large_image_url: img(a.id), image_url: img(a.id) } }, episodes: 3, status: 'Finished Airing', score: 8, year: 2024, type: 'TV',
  genres: [{ name: 'Aventure' }], studios: [], streaming: [],
});
const media = a => ({ id: a.id, idMal: a.id, title: { romaji: a.title, english: a.en, native: a.title }, description: 'x', episodes: 3, status: 'FINISHED', format: 'TV', seasonYear: 2024, averageScore: 80, popularity: 10, genres: ['Aventure'], coverImage: { extraLarge: img(a.id) }, studios: { nodes: [] }, externalLinks: [] });

// ------------------------------------------------------------- Sites simulés
const j = (o, statut = 200) => ({ statut, type: 'application/json', corps: JSON.stringify(o) });
const page = corps => ({ statut: 200, type: 'text/html; charset=utf-8', corps: `<!doctype html><html><head><meta charset="utf-8"><title>Exemple</title></head><body>${corps}</body></html>` });
const episodes = (prefixe, n) => Array.from({ length: n }, (_, i) => `<li class="ep"><a href="${prefixe}/episode-${i + 1}">Épisode ${i + 1}</a></li>`).join('');
const deuxLecteurs = (n, vivantLe2 = true) => page(`<div class="video"><iframe src="https://mort-exemple.fr/embed/${n}"></iframe><iframe src="${vivantLe2 ? 'https://lecteur-exemple.fr' : 'https://mort2-exemple.fr'}/embed/${n}"></iframe></div>`);

function repondre(hote, methode, chemin) {
  const url = new URL(chemin, 'https://x');
  const p = url.pathname;
  const q = (url.searchParams.get('q') ?? url.searchParams.get('s') ?? '').toLowerCase();
  if (hote === 'api.jikan.moe') {
    const fiche = /\/anime\/(\d+)\/full/.exec(p);
    if (fiche) return j({ data: jikan(ANIMES.find(a => a.id === Number(fiche[1]))) });
    if (/\/anime\/\d+\/episodes/.test(p)) return j({ data: [], pagination: { last_visible_page: 1 } });
    if (p === '/v4/genres/anime') return j({ data: [] });
    return j({ data: ANIMES.filter(a => !q || `${a.en} ${a.fr}`.toLowerCase().includes(q)).map(jikan), pagination: { has_next_page: false, last_visible_page: 1 } });
  }
  if (hote === 'graphql.anilist.co') return j({ data: { trending: { media: ANIMES.map(media) }, popular: { media: [] }, airing: { media: [] }, topRated: { media: [] }, movies: { media: [] } } });
  if (hote === 'img-exemple.fr') {
    const id = Number(/(\d+)/.exec(p)?.[1] ?? 0);
    return { statut: 200, type: 'image/svg+xml', corps: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="435"><rect width="300" height="435" fill="hsl(${(id * 97) % 360},55%,38%)"/></svg>` };
  }
  if (hote === 'lecteur-exemple.fr') return { statut: 200, type: 'text/html', corps: `<!doctype html><body style="margin:0;background:#111;color:#eee;font:22px sans-serif;display:grid;place-items:center;height:100vh">Lecteur neutre (${p})</body>` };
  if (hote === 'bascule-exemple.fr') {
    if (p === '/' && url.searchParams.has('s')) return page(`<ul class="resultats"><li class="r"><a href="/anime/le-long-voyage/">Le Long Voyage</a></li></ul>`);
    if (p === '/anime/le-long-voyage/') return page(`<h1>Le Long Voyage</h1><ul>${episodes('/anime/le-long-voyage', 3)}</ul>`);
    const ep = /^\/anime\/le-long-voyage\/episode-(\d+)$/.exec(p);
    if (ep) return deuxLecteurs(ep[1], ep[1] !== '3');
  }
  return { statut: 404, type: 'text/plain', corps: 'introuvable' };
}
const HOTES_NAVIGATEUR = ['api.jikan.moe', 'graphql.anilist.co', 'img-exemple.fr', 'lecteur-exemple.fr'];
const HOTES_MORTS = ['mort-exemple.fr', 'mort2-exemple.fr'];
const appels = [];
const serveurInternet = http.createServer((req, res) => {
  req.on('data', () => undefined);
  req.on('end', () => {
    const hote = String(req.headers.host ?? '').split(':')[0];
    appels.push(`${req.method} ${hote}${req.url}`);
    const r = repondre(hote, req.method, req.url);
    res.writeHead(r.statut, { 'Content-Type': r.type, 'Access-Control-Allow-Origin': '*' });
    res.end(r.corps);
  });
});
await new Promise(ok => serveurInternet.listen(PORT_INTERNET, '127.0.0.1', ok));
const requeterVersInternetLocal = (url, options, rappel) =>
  http.request({ host: '127.0.0.1', port: PORT_INTERNET, path: url.pathname + url.search, method: options.method, headers: { ...options.headers, host: url.hostname } }, rappel);
const pontRequete = requete => requeteTsuzuku(requete, { requeter: requeterVersInternetLocal });

const SOURCES = [{ id: 'bascule', name: 'Site à deux lecteurs', baseUrl: 'https://bascule-exemple.fr', enabled: true, language: 'indifferent', search: { path: '/?s={query}', item: 'li.r', title: 'a', link: 'a' }, episodes: { item: 'li.ep', link: 'a' }, player: { iframe: 'iframe' } }];

// ------------------------------------------------------------- Site statique
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const dist = join(racine, 'bureau/dist');
const serveurSite = http.createServer((req, res) => {
  const chemin = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  let fichier = join(dist, chemin);
  if (!existsSync(fichier) || statSync(fichier).isDirectory()) fichier = join(dist, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[extname(fichier)] ?? 'application/octet-stream' });
  createReadStream(fichier).pipe(res);
});
await new Promise(ok => serveurSite.listen(PORT_SITE, ok));

// ------------------------------------------------------------- Outils
function base32(texte) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of texte.replace(/[=\s]+/g, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  return Buffer.from(bits.match(/.{8}/g).map(o => Number.parseInt(o, 2)));
}
function totp(secret, decalage = 0) {
  const tampon = Buffer.alloc(8);
  tampon.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + decalage));
  const h = createHmac('sha1', base32(secret)).update(tampon).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
const SITE = `http://localhost:${PORT_SITE}/`;
const pause = ms => new Promise(ok => setTimeout(ok, ms));
const log = (...a) => console.log('[e2e]', ...a);
let echecs = 0;
const verifier = (ok, message) => {
  console.log(ok ? '  OK   ' : '  ECHEC', message);
  if (!ok) echecs++;
};
const capture = async (pg, nom, pleine = false) => {
  await pause(350);
  await pg.screenshot({ path: join(CAPTURES, `${nom}.png`), fullPage: pleine });
};
const visible = (pg, id, delai = 20_000) => pg.getByTestId(id).first().waitFor({ timeout: delai }).then(() => true, () => false);
const debordement = pg => pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const voir = async (pg, id) => pg.getByTestId(id).first().scrollIntoViewIfNeeded().catch(() => undefined);
async function deverrouiller(pg, motDePasse, secret) {
  for (const decalage of [0, 1, -1]) {
    await pg.locator('input[type=password]').first().fill(motDePasse);
    await pg.locator('input:not([type=password])').first().fill(totp(secret, decalage));
    await pg.getByTestId('bouton-deverrouiller').click();
    if (await visible(pg, 'hub', 25_000)) return;
  }
  throw new Error('déverrouillage impossible');
}
const fermerDevblog = pg => pg.getByText(/Fermer|Terminé|Compris|Plus tard/).first().click({ timeout: 3000 }).catch(() => undefined);
async function ouvrirFiche(pg, id) {
  await pg.getByTestId('onglet-app-accueil').click();
  await pg.getByTestId(`carte-anime-${id}`).first().click();
  await pg.getByTestId('fiche-titre').waitFor({ timeout: 20_000 });
}

const iframeDit = (pg, texte, delai = 25_000) => pg.frameLocator('[data-testid="lecteur-iframe"]').getByText(texte).waitFor({ timeout: delai }).then(() => true, () => false);
const pagesEpisode = n => appels.filter(a => a === `GET bascule-exemple.fr/anime/le-long-voyage/episode-${n}`);

const navigateur = await chromium.launch({ headless: true });
try {
  const contexte = await nouveauContexte(navigateur, { viewport: { width: 1100, height: 820 } });
  await contexte.route(url => HOTES_NAVIGATEUR.includes(url.hostname), async route => {
    const url = new URL(route.request().url());
    const r = repondre(url.hostname, route.request().method(), url.pathname + url.search);
    await route.fulfill({ status: r.statut, contentType: r.type, body: r.corps, headers: { 'access-control-allow-origin': '*' } });
  });
  await contexte.route(url => HOTES_MORTS.includes(url.hostname), route => route.abort('connectionrefused'));
  const pg = await contexte.newPage();
  const erreursPage = [];
  pg.on('pageerror', e => {
    erreursPage.push(e.message);
    log('erreur page :', e.message);
  });
  await pg.exposeFunction('__tsuRequete', pontRequete);
  await pg.exposeFunction('__tsuLecteur', async () => true);
  const activerPontPc = () => pg.evaluate(() => { globalThis.applibourse = { tsuzuku: { requete: r => globalThis.__tsuRequete(r), lecteur: u => globalThis.__tsuLecteur(u) } }; });

  // ============================================================ Coffre du Fondateur
  log('Coffre du Fondateur');
  await pg.goto(SITE);
  await pg.getByTestId('accueil-site').waitFor({ timeout: 60_000 });
  await pg.getByTestId('accueil-creer').click();
  await pg.getByTestId('accueil-creer-confirmer').click();
  const champs = pg.locator('input[type=password]');
  await champs.nth(0).waitFor({ timeout: 60_000 });
  await champs.nth(0).fill(MDP_ADMIN);
  await champs.nth(1).fill(MDP_ADMIN);
  await pg.getByTestId('bouton-creer').click();
  await pg.getByText('À noter maintenant').waitFor({ timeout: 60_000 });
  const secretAdmin = ((await pg.locator('body').innerText()).match(/\b[A-Z2-7]{16,}\b/) ?? [])[0];
  if (!secretAdmin) throw new Error('secret TOTP introuvable');
  await pg.getByRole('switch').click();
  await pg.getByTestId('bouton-continuer').click();
  await pg.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(pg, MDP_ADMIN, secretAdmin));
  await fermerDevblog(pg);
  await pg.keyboard.press('Escape').catch(() => undefined);
  await pg.getByTestId('hub').waitFor({ timeout: 20_000 });

  // ============================================================ PC : sources
  log('PC (pont Electron réel) : import des sources');
  await activerPontPc();
  await allerPageApplications(pg);
  await pg.locator('[data-testid="cellule-tsuzuku"], [data-testid="tuile-tsuzuku"]').first().click();
  await pg.getByTestId('tsuzuku-racine').waitFor({ timeout: 20_000 });
  await pg.getByTestId('onglet-app-sources').click();
  await pg.getByTestId('sources-import-texte').fill(JSON.stringify({ sources: SOURCES }));
  await pg.getByTestId('sources-importer').click();
  await pause(800);
  verifier((await pg.getByTestId('sources-compte').innerText()).includes('1 source(s) · 1 active(s)'), 'source importée et active');

  log('Épisode 1 : lecteur 1 mort → lecteur 2');
  await ouvrirFiche(pg, 1);
  await pg.getByTestId('episode-1').click();
  verifier(await iframeDit(pg, 'Lecteur neutre (/embed/1)'), 'épisode 1 : le lecteur qui répond s’affiche tout seul');
  verifier(/indisponible, passage à/.test(await pg.getByTestId('lecteur-bascule-avis').innerText().catch(() => '')), 'message discret « … indisponible, passage à … »');
  verifier((await pg.getByTestId('lecteur-tous-echoues').count()) === 0, 'pas de message d’échec général');
  await capture(pg, '01-bascule-automatique');

  log('Préchargement de l’épisode suivant');
  for (let i = 0; i < 40 && !pagesEpisode(2).length; i++) await pause(250);
  verifier(pagesEpisode(2).length === 1, 'page de l’épisode 2 lue pendant la lecture de l’épisode 1');
  verifier(!appels.some(a => /episode-3/.test(a)), 'une seule étape à la fois : épisode 3 non préchargé');
  const avant = Date.now();
  await pg.getByTestId('lecteur-suivant').click();
  verifier(await iframeDit(pg, 'Lecteur neutre (/embed/2)'), 'épisode 2 affiché');
  const suivant = Date.now() - avant;
  verifier(suivant < 5000, `passage à l’épisode suivant en ${suivant} ms`);
  verifier(pagesEpisode(2).length === 1, 'épisode 2 : page non relue (servie du cache)');

  log('Lecteur qui marche mémorisé, choix manuel');
  await pg.getByTestId('lecteur-choix-0').waitFor({ timeout: 10_000 });
  await pg.getByTestId('lecteur-retour').click();
  await pg.getByTestId('fiche-titre').waitFor({ timeout: 20_000 });
  await pg.getByTestId('episode-1').click();
  await pg.getByTestId('lecteur-choix-0').waitFor({ timeout: 20_000 });
  verifier((await pg.getByTestId('lecteur-choix-0').first().innerText()).length > 0 && await iframeDit(pg, 'Lecteur neutre (/embed/1)'), 'réouverture : le lecteur qui marche est affiché sans passer par le mort');
  await pg.getByTestId('lecteur-choix-1').click();
  verifier((await pg.getByTestId('lecteur-choix-1').count()) === 1, 'choix manuel d’un autre lecteur possible');

  log('Tous les lecteurs échouent');
  await pg.getByTestId('lecteur-retour').click();
  await pg.getByTestId('fiche-titre').waitFor({ timeout: 20_000 });
  await pg.getByTestId('episode-3').click();
  verifier(await visible(pg, 'lecteur-tous-echoues', 40_000), 'épisode 3 : message clair quand tous échouent');
  verifier(await visible(pg, 'lecteur-reessayer', 2000), 'bouton « Réessayer » présent');
  await capture(pg, '02-tous-echoues');
  await pg.getByTestId('lecteur-reessayer').click();
  verifier(await visible(pg, 'lecteur-tous-echoues', 40_000), 'Réessayer relance puis le constat revient (rien ne répond)');

  verifier(erreursPage.length === 0, `aucune erreur JavaScript dans la page (${erreursPage.length})`);
} finally {
  await navigateur.close();
  serveurSite.close();
  serveurInternet.close();
}
if (echecs > 0) {
  console.log(`E2E ECHEC (${echecs})`);
  process.exit(1);
}
console.log('E2E OK');
process.exit(0);
