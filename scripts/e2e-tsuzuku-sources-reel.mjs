/**
 * E2E : « quand je mets une source, ça ne trouve pas l'anime » — comportements RÉELS des sites,
 * simulés par un petit « internet » local NEUTRE (domaines fictifs *-exemple.fr, aucun site réel).
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-tsuzuku-sources-reel.mjs
 *
 * Le pont Electron est le VRAI module `bureau/electron/tsuzuku.mjs` (garde anti-SSRF, décodage du
 * jeu de caractères, décompression, cookies jamais gardés) ; seul son transport est détourné vers
 * l'internet local. Sites simulés :
 *   - spa-exemple.fr      : page de recherche vide (application JavaScript) + API JSON ;
 *   - ajax-exemple.fr     : recherche en POST (point AJAX) qui renvoie du HTML dans du JSON ;
 *   - articles-exemple.fr : cartes <article>, la recherche liste aussi des épisodes, épisodes paginés ;
 *   - protege-exemple.fr  : protection anti-robot (« Just a moment… », 503) ;
 *   - ancien-exemple.fr   : redirige vers miroir-exemple.fr (autre domaine), <base href> ;
 *   - latin-exemple.fr    : pages en ISO-8859-1, compressées (gzip) ;
 *   - slug-exemple.fr     : pas de recherche, adresse /anime/{slug} (404 sinon) ;
 *   - saisons-exemple.fr  : onglets de saisons masqués sur la même page.
 *
 * Parcours (PC 1100 px, puis 390 px) : import des sources → fiche dont la seule source active est
 * protégée : message « bloque les requêtes automatiques » (pas « aucun résultat »), détail du
 * diagnostic (HTTP 503, anti-robot) et texte copié SANS la clé présente dans une adresse → page de
 * recherche JavaScript : « construite en JavaScript » → « Tester une source sur ce titre » pour
 * chaque site simulé (OK) → lecture d'un épisode par l'API JSON → aide « Comment bien configurer
 * une source ». Captures : docs/captures-tsuzuku-sources-reel/.
 */

import { createHmac } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import http from 'node:http';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { allerPageApplications, nouveauContexte } from './e2e-acceptation.mjs';

const racine = fileURLToPath(new URL('..', import.meta.url));
const requireGlobal = createRequire(join(process.env.PLAYWRIGHT_PATH ?? '/opt/node22/lib/node_modules', 'x.js'));
const { chromium } = requireGlobal('playwright');
const { requeteTsuzuku } = await import(pathToFileURL(join(racine, 'bureau/electron/tsuzuku.mjs')).href);

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-tsuzuku-sources-reel');
mkdirSync(CAPTURES, { recursive: true });
const PORT_SITE = 5199;
const PORT_INTERNET = 5198;
const MDP_ADMIN = 'mot-de-passe-du-pc-e2e-sources-reel-42';

// ------------------------------------------------------------- Catalogue (neutre)
const img = id => `https://img-exemple.fr/${id}.jpg`;
const ANIMES = [
  { id: 1, title: 'Nagai Tabi', en: 'The Long Voyage', fr: 'Le Long Voyage' },
  { id: 2, title: 'Nagai Tabi 2nd Season', en: 'The Long Voyage Season 2', fr: 'Le Long Voyage Saison 2' },
  { id: 3, title: 'Eien no Natsu', en: 'Eternal Summer', fr: 'Été éternel' },
];
const jikan = a => ({
  mal_id: a.id, title: a.title, title_english: a.en, title_japanese: a.title, titles: [{ type: 'Default', title: a.title }, { type: 'English', title: a.en }, { type: 'French', title: a.fr }],
  synopsis: `Synopsis neutre de ${a.en}.`, images: { jpg: { large_image_url: img(a.id), image_url: img(a.id) } }, episodes: 6, status: 'Finished Airing', score: 8, year: 2024, type: 'TV',
  genres: [{ name: 'Aventure' }], studios: [], streaming: [],
});
const media = a => ({ id: a.id, idMal: a.id, title: { romaji: a.title, english: a.en, native: a.title }, description: 'x', episodes: 6, status: 'FINISHED', format: 'TV', seasonYear: 2024, averageScore: 80, popularity: 10, genres: ['Aventure'], coverImage: { extraLarge: img(a.id) }, studios: { nodes: [] }, externalLinks: [] });

// ------------------------------------------------------------- Sites simulés
const j = (o, statut = 200) => ({ statut, type: 'application/json', corps: JSON.stringify(o) });
const page = (corps, tete = '') => ({ statut: 200, type: 'text/html; charset=utf-8', corps: `<!doctype html><html><head><meta charset="utf-8"><title>Exemple</title>${tete}</head><body>${corps}</body></html>` });
const episodes = (prefixe, de, a) => Array.from({ length: a - de + 1 }, (_, i) => `<li><a href="${prefixe}/episode-${de + i}">Épisode ${de + i}</a></li>`).join('');
const lecteur = id => page(`<div class="video"><iframe src="https://lecteur-exemple.fr/embed/${id}"></iframe></div>`);

function repondre(hote, methode, chemin, corpsRecu) {
  const url = new URL(chemin, 'https://x');
  const p = url.pathname;
  const q = (url.searchParams.get('q') ?? url.searchParams.get('s') ?? url.searchParams.get('terme') ?? '').toLowerCase();
  if (hote === 'api.jikan.moe') {
    const fiche = /\/anime\/(\d+)\/full/.exec(p);
    if (fiche) return j({ data: jikan(ANIMES.find(a => a.id === Number(fiche[1]))) });
    if (/\/anime\/\d+\/episodes/.test(p)) return j({ data: [], pagination: { last_visible_page: 1 } });
    if (p === '/v4/genres/anime') return j({ data: [] });
    return j({ data: ANIMES.filter(a => !q || `${a.en} ${a.fr}`.toLowerCase().includes(q)).map(jikan), pagination: { has_next_page: false, last_visible_page: 1 } });
  }
  if (hote === 'graphql.anilist.co') {
    const m = ANIMES.map(media);
    return j({ data: { trending: { media: m }, popular: { media: [] }, airing: { media: [] }, topRated: { media: [] }, movies: { media: [] } } });
  }
  if (hote === 'img-exemple.fr') {
    const id = Number(/(\d+)/.exec(p)?.[1] ?? 0);
    return { statut: 200, type: 'image/svg+xml', corps: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="435"><rect width="300" height="435" fill="hsl(${id * 97 % 360},55%,38%)"/></svg>` };
  }
  if (hote === 'lecteur-exemple.fr') return { statut: 200, type: 'text/html', corps: `<!doctype html><body style="margin:0;background:#111;color:#eee;font:22px sans-serif;display:grid;place-items:center;height:100vh">Lecteur neutre (${p})</body>` };
  switch (hote) {
    case 'spa-exemple.fr':
      if (p === '/recherche') return page('<div id="app"></div><script type="module" src="/assets/app.js"></script>');
      if (p === '/api/recherche') {
        const tous = [{ titre: { rendered: 'Le Long Voyage' }, slug: 'le-long-voyage' }, { titre: { rendered: 'Lanternes de minuit' }, slug: 'lanternes' }];
        return j({ data: { resultats: tous.filter(x => x.titre.rendered.toLowerCase().includes(q.split(' ').pop() ?? '')) } });
      }
      if (p === '/anime/le-long-voyage') return page(`<h1>Le Long Voyage</h1><ul>${episodes('/anime/le-long-voyage', 1, 6)}</ul>`);
      if (/\/episode-\d+$/.test(p)) return lecteur(`spa-${p.split('-').pop()}`);
      break;
    case 'ajax-exemple.fr':
      if (p === '/ajax/recherche' && methode === 'POST') {
        const terme = new URLSearchParams(corpsRecu).get('terme') ?? '';
        return j({ success: true, data: /voyage/i.test(terme) ? '<ul><li class="r"><a href="/serie/voyage">Le Long Voyage</a></li></ul>' : '' });
      }
      if (p === '/serie/voyage') return page(`<ul>${episodes('/serie/voyage', 1, 4)}</ul>`);
      if (/episode-\d+$/.test(p)) return lecteur(`ajax-${p.split('-').pop()}`);
      break;
    case 'articles-exemple.fr':
      if (p === '/' && url.searchParams.has('s')) {
        return page(`<header><nav><a href="/">Accueil</a></nav></header><main>
          <article class="post"><h2 class="entry-title"><a href="/le-long-voyage-episode-12-vostfr/">Le Long Voyage Episode 12 VOSTFR</a></h2></article>
          <article class="post"><h2 class="entry-title"><a href="/serie/le-long-voyage/">Le Long Voyage</a></h2></article>
          <article class="post"><h2 class="entry-title"><a href="/serie/le-long-voyage-film/">Le Long Voyage – Le Film</a></h2></article></main>`);
      }
      if (p === '/serie/le-long-voyage/') {
        const n = Number(url.searchParams.get('page') ?? 1);
        return page(`<div class="liste">${episodes('/le-long-voyage', n === 1 ? 1 : 4, n === 1 ? 3 : 6)}</div>${n < 2 ? '<div class="pagination"><a class="next" href="?page=2">Suivant</a></div>' : ''}`);
      }
      if (/episode-\d+$/.test(p)) return lecteur(`articles-${p.split('-').pop()}`);
      break;
    case 'protege-exemple.fr':
      return { statut: 503, type: 'text/html', entetes: { server: 'cloudflare', 'set-cookie': '__cf_bm=valeur-secrete; HttpOnly' }, corps: '<!doctype html><html><head><title>Just a moment...</title></head><body>Checking your browser before accessing. <div id="challenge-platform"></div></body></html>' };
    case 'ancien-exemple.fr':
      return { statut: 301, type: 'text/plain', entetes: { location: `https://miroir-exemple.fr${chemin}` }, corps: '' };
    case 'miroir-exemple.fr':
      if (p === '/recherche') return page('<ul class="res"><li><a href="serie/voyage">Le Long Voyage</a></li></ul>', '<base href="https://miroir-exemple.fr/v2/">');
      if (p === '/v2/serie/voyage') return page(`<ol class="eps">${episodes('/v2/serie/voyage', 1, 2)}</ol>`);
      if (/episode-\d+$/.test(p)) return lecteur(`miroir-${p.split('-').pop()}`);
      break;
    case 'latin-exemple.fr': {
      const latin = corps => ({ statut: 200, type: 'text/html; charset=iso-8859-1', gzip: true, corps: Buffer.from(`<!doctype html><html><body>${corps}</body></html>`, 'latin1') });
      if (p === '/recherche') return latin('<ul class="res"><li><a href="/serie/ete">Été éternel</a></li></ul>');
      if (p === '/serie/ete') return latin(`<ul class="eps">${episodes('/serie/ete', 1, 2)}</ul>`);
      if (/episode-\d+$/.test(p)) return lecteur(`latin-${p.split('-').pop()}`);
      break;
    }
    case 'slug-exemple.fr':
      if (p === '/anime/le-long-voyage-saison-2') return page(`<h1>Le Long Voyage Saison 2</h1><ul>${[1, 2, 3].map(n => `<li><a href="/anime/le-long-voyage-saison-2/s2e${n}">S2E0${n}</a></li>`).join('')}</ul>`, '<meta property="og:title" content="Le Long Voyage Saison 2">');
      if (/\/s2e\d+$/.test(p)) return lecteur(`slug-${p.slice(-1)}`);
      return { statut: 404, type: 'text/html', corps: '<p>Introuvable</p>' };
    case 'saisons-exemple.fr':
      if (p === '/recherche') return page('<div class="r"><a href="/voyage">Le Long Voyage</a></div>');
      if (p === '/voyage') {
        const s = n => `<div class="tab"${n > 1 ? ' style="display:none"' : ''}>${[1, 2, 3].map(e => `<a href="/voyage/saison-${n}/episode-${e}">Saison ${n} - Épisode ${e}</a>`).join('')}</div>`;
        return page(`${s(1)}${s(2)}`);
      }
      if (/episode-\d+$/.test(p)) return lecteur(`saisons-${p.split('/').slice(-2).join('-')}`);
      break;
  }
  return { statut: 404, type: 'text/plain', corps: 'introuvable' };
}
const HOTES_NAVIGATEUR = ['api.jikan.moe', 'graphql.anilist.co', 'img-exemple.fr', 'lecteur-exemple.fr'];
const appels = [];
const serveurInternet = http.createServer((req, res) => {
  let recu = '';
  req.on('data', c => (recu += c));
  req.on('end', () => {
    const hote = String(req.headers.host ?? '').split(':')[0];
    appels.push(`${req.method} ${hote}${req.url}`);
    const r = repondre(hote, req.method, req.url, recu);
    const corps = r.gzip ? zlib.gzipSync(r.corps) : r.corps;
    res.writeHead(r.statut, { 'Content-Type': r.type, 'Access-Control-Allow-Origin': '*', ...(r.gzip ? { 'Content-Encoding': 'gzip' } : {}), ...(r.entetes ?? {}) });
    res.end(corps);
  });
});
await new Promise(ok => serveurInternet.listen(PORT_INTERNET, '127.0.0.1', ok));
const requeterVersInternetLocal = (url, options, rappel) =>
  http.request({ host: '127.0.0.1', port: PORT_INTERNET, path: url.pathname + url.search, method: options.method, headers: { ...options.headers, host: url.hostname } }, rappel);
const pontRequete = requete => requeteTsuzuku(requete, { requeter: requeterVersInternetLocal });

// ------------------------------------------------------------- Sources à importer (une clé fictive dans une adresse : jamais dans le diagnostic copié)
const S = (id, name, baseUrl, extra, enabled = false) => ({ id, name, baseUrl, enabled, language: 'indifferent', player: { iframe: 'iframe' }, ...extra });
const SOURCES = [
  S('protege', 'Site protégé', 'https://protege-exemple.fr', { search: { path: '/recherche?q={query}&api_key=CLE-FICTIVE-E2E', item: '.r' } }, true),
  S('spa-html', 'Site JavaScript (HTML)', 'https://spa-exemple.fr', { search: { path: '/recherche?q={query}', item: '.resultat', title: 'a', link: 'a' } }),
  S('spa-api', 'Site JavaScript (API JSON)', 'https://spa-exemple.fr', { search: { path: '/api/recherche?terme={q}', type: 'json', item: 'data.resultats', title: 'titre', link: 'slug', linkFormat: '/anime/{value}' } }),
  S('ajax', 'Site AJAX (POST)', 'https://ajax-exemple.fr', { search: { path: '/ajax/recherche', method: 'POST', body: 'action=recherche&terme={query}', item: 'li.r', title: 'a', link: 'a' } }),
  S('articles', 'Site à articles', 'https://articles-exemple.fr', { search: { path: '/?s={query}', item: 'div.derniers .carte', title: 'h3', link: 'a' } }),
  S('ancien', 'Ancienne adresse (miroir)', 'https://ancien-exemple.fr', { search: { path: '/recherche?q={query}', item: 'ul.res li', title: 'a', link: 'a' }, episodes: { item: 'ol.eps li', link: 'a' } }),
  S('latin', 'Site ISO-8859-1', 'https://latin-exemple.fr', { search: { path: '/recherche?q={query}', item: 'ul.res li', title: 'a', link: 'a' }, episodes: { item: 'ul.eps li', link: 'a' } }),
  S('slug', 'Site à slug', 'https://slug-exemple.fr', { search: { path: '/anime/{slug}' } }),
  S('saisons', 'Site à saisons', 'https://saisons-exemple.fr', { search: { path: '/recherche?q={query}', item: 'div.r', title: 'a', link: 'a' } }),
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
/** « Tester une source sur ce titre » depuis la fiche ; rend le bilan. */
async function testerSurFiche(pg, id) {
  if (!(await pg.getByTestId(`fiche-tester-${id}`).count())) await pg.getByTestId('fiche-tester-ouvrir').click();
  await pg.getByTestId(`fiche-tester-${id}`).click();
  await pg.getByTestId(`fiche-test-${id}-bilan`).waitFor({ timeout: 30_000 });
  return pg.getByTestId(`fiche-test-${id}-bilan`).innerText();
}

const navigateur = await chromium.launch({ headless: true });
try {
  const contexte = await nouveauContexte(navigateur, { viewport: { width: 1100, height: 820 } });
  await contexte.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: SITE.replace(/\/$/, '') }).catch(() => undefined);
  await contexte.route(url => HOTES_NAVIGATEUR.includes(url.hostname), async route => {
    const url = new URL(route.request().url());
    const r = repondre(url.hostname, route.request().method(), url.pathname + url.search, route.request().postData() ?? '');
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

  // ============================================================ PC : import des sources simulées
  log('PC (pont Electron réel) : import des sources');
  await activerPontPc();
  await allerPageApplications(pg);
  await pg.locator('[data-testid="cellule-tsuzuku"], [data-testid="tuile-tsuzuku"]').first().click();
  await pg.getByTestId('tsuzuku-racine').waitFor({ timeout: 20_000 });
  await pg.getByTestId('onglet-app-sources').click();
  await pg.getByTestId('sources-import-texte').fill(JSON.stringify({ sources: SOURCES }));
  await pg.getByTestId('sources-importer').click();
  await pause(800);
  verifier((await pg.getByTestId('sources-compte').innerText()).includes(`${SOURCES.length} source(s) · 1 active(s)`), `${SOURCES.length} sources importées, seule « Site protégé » active`);

  // Aide « Comment bien configurer une source »
  await pg.getByTestId('sources-aide-config-ouvrir').click();
  const aide = await pg.getByTestId('sources-aide-config').innerText();
  verifier(['{query}', '{slug}', '{n}', '"type": "json"', 'POST', 'anti-robot', 'Copier le diagnostic'].every(x => aide.includes(x)), 'aide « Comment bien configurer une source » : modèles {query}/{q}, {slug}, {n}, JSON, POST, limites, diagnostic');
  await voir(pg, 'sources-aide-config');
  await capture(pg, '01-pc-aide-configurer-une-source', true);
  await pg.getByTestId('sources-aide-config-fermer').click();

  // ============================================================ Fiche : source protégée
  log('Fiche : la seule source active bloque les requêtes automatiques');
  await ouvrirFiche(pg, 1);
  await pg.getByTestId('fiche-sources-echec-message').waitFor({ timeout: 30_000 });
  const message = await pg.getByTestId('fiche-sources-echec-message').innerText();
  verifier(/bloque les requêtes automatiques/.test(message) && !/Titre non trouvé/.test(message), 'message précis : « le site bloque les requêtes automatiques », pas « aucun résultat »');
  verifier(appels.filter(a => a.includes('protege-exemple.fr')).length === 1, 'une seule requête vers le site protégé (inutile d’essayer toutes les variantes du titre)');
  await pg.getByTestId('fiche-sources-echec-detail-bouton').click();
  const detail = await pg.getByTestId('fiche-sources-echec-detail').innerText();
  verifier(/HTTP 503/.test(detail) && /anti-robot/.test(detail) && detail.includes('api_key=***') && !detail.includes('CLE-FICTIVE-E2E'), 'détail : HTTP 503, anti-robot, clé de l’adresse masquée');
  await pg.getByTestId('fiche-sources-echec-copier').click();
  await pg.getByTestId('fiche-sources-echec-texte').waitFor({ timeout: 10_000 });
  const copie = await pg.getByTestId('fiche-sources-echec-texte').inputValue();
  const pressePapiers = await pg.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  verifier(copie.startsWith('Diagnostic Tsuzuku') && copie.includes('Plateforme : app PC') && copie.includes('Oeuvre : The Long Voyage') && !copie.includes('CLE-FICTIVE-E2E') && !copie.includes('valeur-secrete'), 'diagnostic copiable : en-tête, plateforme, oeuvre, sans clé ni cookie');
  verifier(!pressePapiers || pressePapiers === copie, 'presse-papiers : le même texte');
  await voir(pg, 'fiche-sources');
  await capture(pg, '02-pc-fiche-site-protege-diagnostic', true);

  // ============================================================ « Tester une source sur ce titre » : chaque site simulé
  log('Fiche : « Tester une source sur ce titre » pour chaque site simulé');
  const spaHtml = await testerSurFiche(pg, 'spa-html');
  const etapeSpa = await pg.getByTestId('fiche-test-spa-html-recherche-ko').innerText().catch(() => '');
  verifier(/incomplet/.test(spaHtml) && /construite en JavaScript/.test(etapeSpa), 'page de recherche JavaScript : « construite en JavaScript », piste API JSON');
  await voir(pg, 'fiche-test-spa-html');
  await capture(pg, '03-pc-test-site-javascript');
  for (const id of ['spa-api', 'ajax', 'articles', 'ancien']) {
    verifier(/Test réussi/.test(await testerSurFiche(pg, id)), `« ${SOURCES.find(s => s.id === id).name} » : recherche → épisodes → lecteur OK (sur ce titre)`);
  }
  verifier(appels.some(a => a.startsWith('POST ajax-exemple.fr/ajax/recherche')), 'la recherche AJAX part bien en POST par le pont');
  verifier(appels.some(a => a.startsWith('GET miroir-exemple.fr/v2/serie/voyage')), 'redirection vers le miroir suivie, liens résolus par <base href>');
  await voir(pg, 'fiche-test-articles');
  await capture(pg, '04-pc-tests-sites-ok');

  // Saison 2 : slug (variantes de saison) et onglets de saisons masqués.
  await ouvrirFiche(pg, 2);
  verifier(/Test réussi/.test(await testerSurFiche(pg, 'slug')), '« Site à slug » : /anime/{slug}, variante « -saison-2 » trouvée');
  verifier(/Test réussi/.test(await testerSurFiche(pg, 'saisons')) && (await pg.getByTestId('fiche-test-saisons-lecteur-ok').innerText()).includes('saisons-saison-2-episode-1'), '« Site à saisons » : la saison 2 est gardée parmi les onglets masqués');
  await capture(pg, '05-pc-tests-slug-saisons');

  // ISO-8859-1 compressé : décodé par le vrai module du PC.
  await ouvrirFiche(pg, 3);
  verifier(/Test réussi/.test(await testerSurFiche(pg, 'latin')), '« Site ISO-8859-1 » (gzip) : accents décodés, « Été éternel » reconnu');

  // ============================================================ Lecture par l'API JSON
  log('Lecture : seule la source « API JSON » active');
  await pg.getByTestId('onglet-app-sources').click();
  await pg.getByTestId('source-activer-protege').click();
  await pause(300);
  await pg.getByTestId('source-activer-spa-api').click();
  await pause(500);
  await ouvrirFiche(pg, 1);
  verifier(await visible(pg, 'fiche-sources-ok', 30_000) && (await pg.getByTestId('fiche-sources-ok').innerText()).includes('6 épisode(s)'), 'fiche : « Le Long Voyage » trouvé par l’API JSON, 6 épisodes');
  await voir(pg, 'fiche-sources');
  await capture(pg, '06-pc-fiche-trouvee-par-api');
  await pg.getByTestId('episode-2').click();
  verifier(await pg.frameLocator('[data-testid="lecteur-iframe"]').getByText('Lecteur neutre (/embed/spa-2)').waitFor({ timeout: 20_000 }).then(() => true, () => false), 'l’épisode 2 se lit (page JavaScript contournée par son API, sans rendu JavaScript)');
  await pg.getByTestId('lecteur-retour').click();

  // ============================================================ Téléphone 390 px
  log('Téléphone 390 × 844');
  await pg.setViewportSize({ width: 390, height: 844 });
  await pg.getByTestId('onglet-app-sources').click();
  await pg.getByTestId('source-activer-spa-api').click();
  await pause(300);
  await pg.getByTestId('source-activer-protege').click();
  await pause(500);
  await ouvrirFiche(pg, 1);
  await pg.getByTestId('fiche-sources-echec-detail-bouton').click();
  await pg.getByTestId('fiche-sources-echec-copier').click();
  await voir(pg, 'fiche-sources-echec-detail');
  verifier((await debordement(pg)) <= 0, 'téléphone : diagnostic détaillé sans défilement horizontal');
  await capture(pg, '07-tel-fiche-diagnostic', true);

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
