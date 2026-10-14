/**
 * E2E : « Rajoute un bouton quand je sélectionne un épisode pour choisir entre VF et VOSTFR ».
 * Petit « internet » local NEUTRE (domaines fictifs *-exemple.fr, aucun site réel) :
 *   - langues-exemple.fr : la recherche donne « Le Long Voyage » ET « Le Long Voyage (VF) »,
 *     deux fiches de 3 épisodes chacune ; chaque épisode a son lecteur neutre ;
 *   - muet-exemple.fr    : une seule fiche, rien ne dit la langue (« Langue inconnue »).
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-tsuzuku-langues.mjs
 *
 * Le pont Electron est le VRAI module `bureau/electron/tsuzuku.mjs` (seul son transport est
 * détourné vers l'internet local). Parcours PC (1100 px) puis téléphone (390 × 844) : fiche
 * (sélecteur au-dessus des épisodes) → épisode 1 en VOSTFR → bascule VF (même épisode, autre
 * lecteur) → retour VOSTFR au clavier (espace) → progression commune (épisode 1 vu une seule fois)
 * → au plus 2 pages de série lues → source muette : « Langue inconnue ». Cibles ≥ 44 px, textes
 * ≥ 15 px, aucun défilement horizontal. Captures : docs/captures-tsuzuku-langues/.
 */

import { createHmac } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { allerPageApplications, nouveauContexte } from './e2e-acceptation.mjs';

const racine = fileURLToPath(new URL('..', import.meta.url));
const requireGlobal = createRequire(join(process.env.PLAYWRIGHT_PATH ?? '/opt/node22/lib/node_modules', 'x.js'));
const { chromium } = requireGlobal('playwright');
const { requeteTsuzuku } = await import(pathToFileURL(join(racine, 'bureau/electron/tsuzuku.mjs')).href);

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-tsuzuku-langues');
mkdirSync(CAPTURES, { recursive: true });
const PORT_SITE = 5189;
const PORT_INTERNET = 5188;
const MDP_ADMIN = 'mot-de-passe-du-pc-e2e-langues-42';

// ------------------------------------------------------------- Catalogue (neutre)
const img = id => `https://img-exemple.fr/${id}.jpg`;
const ANIMES = [
  { id: 1, title: 'Nagai Tabi', en: 'The Long Voyage', fr: 'Le Long Voyage' },
  { id: 3, title: 'Eien no Natsu', en: 'Eternal Summer', fr: 'Été éternel' },
];
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
const lecteur = id => page(`<div class="video"><iframe src="https://lecteur-exemple.fr/embed/${id}"></iframe></div>`);

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
  if (hote === 'langues-exemple.fr') {
    if (p === '/' && url.searchParams.has('s')) {
      return page(`<ul class="resultats"><li class="r"><a href="/anime/le-long-voyage/">Le Long Voyage</a></li><li class="r"><a href="/anime/le-long-voyage-vf/">Le Long Voyage (VF)</a></li></ul>`);
    }
    if (p === '/anime/le-long-voyage/') return page(`<h1>Le Long Voyage</h1><ul>${episodes('/anime/le-long-voyage', 3)}</ul>`);
    if (p === '/anime/le-long-voyage-vf/') return page(`<h1>Le Long Voyage (VF)</h1><ul>${episodes('/anime/le-long-voyage-vf', 3)}</ul>`);
    const ep = /^\/anime\/le-long-voyage(-vf)?\/episode-(\d+)$/.exec(p);
    if (ep) return lecteur(`${ep[1] ? 'vf' : 'vostfr'}-${ep[2]}`);
  }
  if (hote === 'muet-exemple.fr') {
    if (p === '/recherche') return page('<ul><li class="r"><a href="/serie/ete">Été éternel</a></li></ul>');
    if (p === '/serie/ete') return page(`<ul>${episodes('/serie/ete', 2)}</ul>`);
    if (/episode-\d+$/.test(p)) return lecteur(`muet-${p.split('-').pop()}`);
  }
  return { statut: 404, type: 'text/plain', corps: 'introuvable' };
}
const HOTES_NAVIGATEUR = ['api.jikan.moe', 'graphql.anilist.co', 'img-exemple.fr', 'lecteur-exemple.fr'];
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

const S = (id, name, baseUrl, search) => ({ id, name, baseUrl, enabled: true, language: 'indifferent', search, episodes: { item: 'li.ep', link: 'a' }, player: { iframe: 'iframe' } });
const SOURCES = [
  S('langues', 'Site à deux fiches', 'https://langues-exemple.fr', { path: '/?s={query}', item: 'li.r', title: 'a', link: 'a' }),
  S('muet', 'Site muet', 'https://muet-exemple.fr', { path: '/recherche?q={query}', item: 'li.r', title: 'a', link: 'a' }),
];

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

/** Hauteur de la cible et taille du texte d'un bouton du sélecteur. */
const mesure = (pg, id) =>
  pg.getByTestId(id).first().evaluate(el => {
    const r = el.getBoundingClientRect();
    const tailles = [...el.querySelectorAll('*')].concat([el]).filter(x => x.childNodes.length && [...x.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())).map(x => Number.parseFloat(getComputedStyle(x).fontSize));
    return { hauteur: r.height, largeur: r.width, police: Math.min(...tailles) };
  });
const coche = (pg, id) => pg.getByTestId(id).first().getAttribute('aria-checked');
const iframeDit = (pg, texte, delai = 20_000) => pg.frameLocator('[data-testid="lecteur-iframe"]').getByText(texte).waitFor({ timeout: delai }).then(() => true, () => false);
const pagesSerie = () => appels.filter(a => /^GET langues-exemple\.fr\/anime\/[^/]+\/$/.test(a));

const navigateur = await chromium.launch({ headless: true });
try {
  const contexte = await nouveauContexte(navigateur, { viewport: { width: 1100, height: 820 } });
  await contexte.route(url => HOTES_NAVIGATEUR.includes(url.hostname), async route => {
    const url = new URL(route.request().url());
    const r = repondre(url.hostname, route.request().method(), url.pathname + url.search);
    await route.fulfill({ status: r.statut, contentType: r.type, body: r.corps, headers: { 'access-control-allow-origin': '*' } });
  });
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
  verifier((await pg.getByTestId('sources-compte').innerText()).includes('2 source(s) · 2 active(s)'), 'deux sources importées et actives');

  // ============================================================ Fiche : sélecteur au-dessus des épisodes
  log('Fiche « Le Long Voyage »');
  await ouvrirFiche(pg, 1);
  verifier(await visible(pg, 'fiche-langue-choix', 30_000), 'fiche : sélecteur « VF | VOSTFR » au-dessus de la liste d’épisodes');
  verifier((await coche(pg, 'fiche-langue-choix-vostfr')) === 'true' && (await coche(pg, 'fiche-langue-choix-vf')) === 'false', 'fiche : VOSTFR (réglage par défaut) choisie, VF proposée');
  verifier(/VOSTFR \(VF aussi\)/.test(await pg.getByTestId('fiche-sources-ok').innerText()), '« Sur vos sources » : VOSTFR (VF aussi)');
  await voir(pg, 'fiche-episodes');
  await capture(pg, '01-pc-fiche-selecteur-langue');

  // ============================================================ Lecteur : épisode 1 en VOSTFR, puis VF
  log('Épisode 1 : VOSTFR → VF → VOSTFR');
  await pg.getByTestId('episode-1').click();
  verifier(await iframeDit(pg, 'Lecteur neutre (/embed/vostfr-1)'), 'épisode 1 lu en VOSTFR (fiche sans marqueur, présumée VOSTFR)');
  await pg.getByTestId('lecteur-langue').waitFor({ timeout: 20_000 });
  const m = await mesure(pg, 'lecteur-langue-vf');
  verifier(m.hauteur >= 44 && m.police >= 15, `PC : cible ${Math.round(m.hauteur)} px (≥ 44), texte ${m.police} px (≥ 15)`);
  verifier((await pg.getByTestId('lecteur-langue').getByRole('radiogroup').count()) === 1 || (await pg.locator('[role="radiogroup"][aria-label="Langue de l’épisode"]').count()) === 1, 'groupe radio « Langue de l’épisode » pour les lecteurs d’écran');
  verifier(/épisodes \d,\d s · lecteur \d,\d s/.test(await pg.getByTestId('lecteur-mesure').innerText().catch(() => '')), 'temps de chaque étape affiché, discrètement, sous le lecteur');
  await capture(pg, '02-pc-lecteur-vostfr');
  // La page de l'épisode dans l'autre langue est préparée pendant la lecture : la bascule est immédiate.
  await pause(1500);
  const debutBascule = Date.now();
  await pg.getByTestId('lecteur-langue-vf').click();
  verifier(await iframeDit(pg, 'Lecteur neutre (/embed/vf-1)'), 'bascule VF : même épisode (1), lecteur de la fiche « (VF) »');
  const bascule = Date.now() - debutBascule;
  verifier(bascule < 2000, `bascule VF/VOSTFR en ${bascule} ms (< 2 s : lecteur préchargé)`);
  verifier(/Depuis le cache/.test(await pg.getByTestId('lecteur-mesure').innerText().catch(() => '')), 'bascule servie depuis le cache (« Depuis le cache » dans le temps affiché)');
  verifier((await coche(pg, 'lecteur-langue-vf')) === 'true' && /Épisode 1/.test(await pg.getByTestId('lecteur-titre').innerText()), 'VF cochée, toujours l’épisode 1');
  verifier(/VF retenue pour cette série/.test(await pg.getByTestId('lecteur-langue-note').innerText()), 'préférence retenue pour la série');
  verifier(pagesSerie().length === 2, `deux pages de série lues en tout (${pagesSerie().length})`);
  await capture(pg, '03-pc-lecteur-vf');
  // Clavier : focus sur VOSTFR, espace.
  await pg.getByTestId('lecteur-langue-vostfr').focus();
  await pg.keyboard.press(' ');
  verifier(await iframeDit(pg, 'Lecteur neutre (/embed/vostfr-1)'), 'clavier (espace) : retour en VOSTFR');
  verifier(pagesSerie().length === 2, 'retour en VOSTFR sans relire de page de série');
  // Progression commune.
  await pg.getByTestId('lecteur-retour').click();
  await pg.getByTestId('fiche-titre').waitFor({ timeout: 20_000 });
  const ep1 = await pg.getByTestId('episode-1').getAttribute('aria-label');
  verifier(/, vu$/.test(ep1 ?? '') && /épisode 1/.test(await pg.getByTestId('fiche-statut').innerText()), `épisode 1 vu une fois, quelle que soit la langue (« ${ep1} »)`);
  verifier((await coche(pg, 'fiche-langue-choix-vostfr')) === 'true', 'fiche : la langue retenue (VOSTFR) suit le dernier choix');

  // ============================================================ Source muette
  log('Source muette : « Langue inconnue »');
  await ouvrirFiche(pg, 3);
  verifier(await visible(pg, 'fiche-langue-choix-inconnue', 30_000) && !(await pg.getByTestId('fiche-langue-choix-vf').count()), 'source muette : « Langue inconnue », pas de sélecteur');
  await voir(pg, 'fiche-episodes');
  await capture(pg, '04-pc-langue-inconnue');

  // ============================================================ Téléphone 390 × 844
  log('Téléphone 390 × 844');
  await pg.setViewportSize({ width: 390, height: 844 });
  const avantReouverture = pagesSerie().length;
  const debutFiche = Date.now();
  await ouvrirFiche(pg, 1);
  await pg.getByTestId('fiche-langue-choix').waitFor({ timeout: 30_000 });
  const reouverture = Date.now() - debutFiche;
  verifier(reouverture < 2500 && pagesSerie().length === avantReouverture, `fiche rouverte en ${reouverture} ms, sans relire de page de série (cache)`);
  await voir(pg, 'fiche-langue-choix');
  verifier((await debordement(pg)) <= 0, 'téléphone : fiche sans défilement horizontal');
  await capture(pg, '05-tel-fiche-selecteur');
  await pg.getByTestId('episode-1').click();
  await pg.getByTestId('lecteur-langue').waitFor({ timeout: 20_000 });
  const t = await mesure(pg, 'lecteur-langue-vf');
  verifier(t.hauteur >= 44 && t.police >= 15 && t.largeur >= 120, `téléphone : cible ${Math.round(t.largeur)}×${Math.round(t.hauteur)} px, texte ${t.police} px`);
  await pg.getByTestId('lecteur-langue-vf').click();
  verifier(await iframeDit(pg, 'Lecteur neutre (/embed/vf-1)'), 'téléphone : bascule VF sur l’épisode 1');
  await voir(pg, 'lecteur-langue');
  verifier((await debordement(pg)) <= 0, 'téléphone : lecteur sans défilement horizontal');
  await capture(pg, '06-tel-lecteur-vf');

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
