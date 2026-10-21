/**
 * E2E : lecture des sources de Tsuzuku DEPUIS LE SITE WEB (navigateur), par la
 * route `POST /tsuzuku/requete` du relais. Aucun pont du PC ici : la version
 * navigateur du site appelle le relais avec le jeton du compte Fondateur relié.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-tsuzuku-site-relais.mjs
 *
 * Le relais est le VRAI `relais/worker.mjs` (route `relais/tsuzuku.mjs`) servi en
 * HTTPS local ; seuls ses appels sortants (`fetch` global du Worker) sont
 * détournés vers un « internet » local NEUTRE (domaines fictifs *-exemple.fr,
 * aucun site réel), DNS sur HTTPS compris. Sites simulés : application
 * JavaScript (+ API JSON), AJAX en POST, ISO-8859-1, protection anti-robot,
 * redirection vers un miroir, nom qui résout vers le réseau local.
 *
 * Parcours : Fondateur relié (code du PC) → « via le relais » → import des
 * sources → fiche protégée (anti-robot, diagnostic « via le relais », sans
 * cookie) → « Tester une source sur ce titre » pour chaque site simulé → lecture
 * d'un épisode → réseau local refusé → relais pas à jour (404) → limite de débit
 * (429) → téléphone 390 px → l'amie Léa (jeton de profil) ne voit pas la
 * fonction (403 au relais) → catalogue WordPress (lecteurs « LECTEUR A/B/C/D » nommés dans
 * un menu : iframe visible, table base64 dans un script, AJAX, page `?host=`) sur iPad puis
 * iPhone : la zone du lecteur ne contient QUE l'iframe de l'hôte, jamais la page du site
 * (recherche, filtres, menus), bascule entre lecteurs, « Lecteur introuvable » sinon
 * → navigateur sans relais : message clair.
 * Captures : docs/captures-tsuzuku-site-relais/.
 */

import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { allerPageAdministration, allerPageApplications, nouveauContexte } from './e2e-acceptation.mjs';

const racine = fileURLToPath(new URL('..', import.meta.url));
const requireGlobal = createRequire(join(process.env.PLAYWRIGHT_PATH ?? '/opt/node22/lib/node_modules', 'x.js'));
const { chromium } = requireGlobal('playwright');
const moduleRelais = await import(pathToFileURL(join(racine, 'relais/worker.mjs')).href);
const worker = moduleRelais.default;

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-tsuzuku-site-relais');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-site-relais-0123456789abcdef';
const PORT_RELAIS = 8799;
const PORT_SITE = 5213;
const ORIGINE_SITE = `http://localhost:${PORT_SITE}`;
const SITE = `${ORIGINE_SITE}/`;
const MDP_ADMIN = 'mot-de-passe-du-fondateur-e2e-relais-42';
const MDP_AUTRE = 'mot-de-passe-du-navigateur-sans-relais-7';

// ------------------------------------------------------------- Catalogue (neutre)
const img = id => `https://img-exemple.fr/${id}.jpg`;
const ANIMES = [
  { id: 1, title: 'Nagai Tabi', en: 'The Long Voyage', fr: 'Le Long Voyage' },
  { id: 3, title: 'Eien no Natsu', en: 'Eternal Summer', fr: 'Été éternel' },
];
const jikan = a => ({
  mal_id: a.id, title: a.title, title_english: a.en, title_japanese: a.title, titles: [{ type: 'Default', title: a.title }, { type: 'English', title: a.en }, { type: 'French', title: a.fr }],
  synopsis: `Synopsis neutre de ${a.en}.`, images: { jpg: { large_image_url: img(a.id), image_url: img(a.id) } }, episodes: 6, status: 'Finished Airing', score: 8, year: 2024, type: 'TV',
  genres: [{ name: 'Aventure' }], studios: [], streaming: [],
});
const media = a => ({ id: a.id, idMal: a.id, title: { romaji: a.title, english: a.en, native: a.title }, description: 'x', episodes: 6, status: 'FINISHED', format: 'TV', seasonYear: 2024, averageScore: 80, popularity: 10, genres: ['Aventure'], coverImage: { extraLarge: img(a.id) }, studios: { nodes: [] }, externalLinks: [] });

// ------------------------------------------------------------- Sites simulés (lus par le relais)
const j = (o, statut = 200) => ({ statut, type: 'application/json', corps: JSON.stringify(o) });
const page = (corps, tete = '') => ({ statut: 200, type: 'text/html; charset=utf-8', corps: `<!doctype html><html><head><meta charset="utf-8"><title>Exemple</title>${tete}</head><body>${corps}</body></html>` });
const episodes = (prefixe, de, a) => Array.from({ length: a - de + 1 }, (_, i) => `<li><a href="${prefixe}/episode-${de + i}">Épisode ${de + i}</a></li>`).join('');
const lecteur = id => page(`<div class="video"><iframe src="https://lecteur-exemple.fr/embed/${id}"></iframe></div>`);
/** Habillage d'une page d'épisode d'un catalogue WordPress : ce qui ne doit JAMAIS apparaître dans le lecteur. */
const TEXTES_SITE_SOURCE = ['Rechercher en VOSTFR', 'Generic filters', 'Exact matches only', 'Search in title', 'Search in content', 'ACCUEIL', 'RECHERCHE AV', 'Comédie'];
const HABILLAGE = `<header><form class="search-form"><input type="text" placeholder="Rechercher en VOSTFR..." name="s"><span>Rechercher en VOSTFR...</span></form>
  <div class="search-advanced"><label><input type="checkbox"> Generic filters</label><label><input type="checkbox" checked> Exact matches only</label><label><input type="checkbox" checked> Search in title</label><label><input type="checkbox" checked> Search in content</label></div>
  <nav><ul><li><a href="/">ACCUEIL</a></li><li><a href="/liste/">LISTE</a></li><li><a href="/nouveau/">NOUVEAU</a></li><li><a href="/bientot/">BIENTÔT</a></li><li><a href="/?s=&post_type=wp-manga">RECHERCHE AV</a></li></ul></nav></header>
  <ul class="genres"><li><a href="/genre/action/">Action</a></li><li><a href="/genre/aventure/">Aventure</a></li><li><a href="/genre/comedie/">Comédie</a></li></ul>`;
const b64 = t => Buffer.from(t).toString('base64');
const episodeWordPress = hote =>
  page(`${HABILLAGE}<h1>Le Long Voyage · Épisode 1</h1>
  <select class="selectpicker host-select"><option value="LECTEUR A"${hote ? '' : ' selected'}>LECTEUR A</option><option value="LECTEUR B">LECTEUR B</option>
  <option value="LECTEUR C" data-post="4242" data-nume="3" data-type="tv">LECTEUR C</option><option value="LECTEUR D"${hote === 'LECTEUR D' ? ' selected' : ''}>LECTEUR D</option></select>
  <div class="chapter-video-frame"><p><iframe src="${hote === 'LECTEUR D' ? 'https://hote-d-exemple.fr/v/444' : 'https://hote-a-exemple.fr/embed/111'}" allowfullscreen></iframe></p></div>
  <script>var thisChapterSources = {"LECTEUR B":"${b64('<iframe src="https://hote-b-exemple.fr/e/222"></iframe>')}"};</script><footer>Pied de page du site</footer>`);

function repondre(hote, methode, chemin, corpsRecu) {
  const url = new URL(chemin, 'https://x');
  const p = url.pathname;
  const q = (url.searchParams.get('q') ?? url.searchParams.get('terme') ?? '').toLowerCase();
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
  if (/^hote-[a-d]-exemple\.fr$/.test(hote)) return { statut: 200, type: 'text/html; charset=utf-8', corps: `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#111;color:#eee;font:22px sans-serif;display:grid;place-items:center;height:100vh">Hôte ${hote[5].toUpperCase()} : lecteur neutre (${p})</body>` };
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
      // Pas de <meta charset> : seul l'en-tête dit ISO-8859-1, décodé par le Worker.
      const latin = corps => ({ statut: 200, type: 'text/html; charset=iso-8859-1', corps: Buffer.from(`<!doctype html><html><body>${corps}</body></html>`, 'latin1') });
      if (p === '/recherche') return latin('<ul class="res"><li><a href="/serie/ete">Été éternel</a></li></ul>');
      if (p === '/serie/ete') return latin(`<ul class="eps">${episodes('/serie/ete', 1, 2)}</ul>`);
      if (/episode-\d+$/.test(p)) return lecteur(`latin-${p.split('-').pop()}`);
      break;
    }
    case 'wordpress-exemple.fr': {
      const s = (url.searchParams.get('s') ?? '').toLowerCase();
      if (p === '/' && url.searchParams.get('post_type') === 'wp-manga')
        return page(`${HABILLAGE}<div class="c-tabs-item">${/voyage|nagai/.test(s) ? '<div class="row c-tabs-item__content"><div class="post-title"><h3><a href="https://wordpress-exemple.fr/anime/le-long-voyage/">Le Long Voyage</a></h3></div></div>' : ''}</div>`);
      if (p === '/anime/le-long-voyage/') return page(`${HABILLAGE}<ul class="main version-chap">${[2, 1].map(n => `<li class="wp-manga-chapter"><a href="https://wordpress-exemple.fr/anime/le-long-voyage/episode-${n}/">Episode ${n}</a><span class="chapter-release-date">12/03/2025</span></li>`).join('')}</ul>`);
      if (p === '/anime/le-long-voyage/episode-1/') return episodeWordPress(url.searchParams.get('host'));
      // Épisode 2 : la page n'a aucun lecteur extractible.
      if (p === '/anime/le-long-voyage/episode-2/') return page(`${HABILLAGE}<h1>Le Long Voyage · Épisode 2</h1><div class="chapter-video-frame"><p>Bientôt disponible.</p></div>`);
      if (p === '/wp-admin/admin-ajax.php' && methode === 'POST') {
        const f = new URLSearchParams(corpsRecu);
        return f.get('action') === 'doo_player_ajax' && f.get('nume') === '3' ? j({ embed_url: '<iframe src="https://hote-c-exemple.fr/embed/333" frameborder="0"></iframe>', type: 'iframe' }) : j({ embed_url: '' });
      }
      // Toute autre page du site (ex. ancienne résolution « …/episode-1/LECTEUR%20A ») : la page de l'épisode, comme le vrai site.
      if (p.startsWith('/anime/le-long-voyage/episode-1/')) return episodeWordPress(null);
      break;
    }
    case 'interne-exemple.fr':
      return page('<p>Ne doit jamais être lu : ce nom résout vers le réseau local.</p>');
  }
  return { statut: 404, type: 'text/plain', corps: 'introuvable' };
}

// ------------------------------------------------------------- Sortie du Worker : DNS sur HTTPS et « internet » local
const fetchNatif = globalThis.fetch.bind(globalThis);
const sortants = [];
const resolutions = [];
globalThis.fetch = async (entree, init = {}) => {
  const url = new URL(typeof entree === 'string' ? entree : entree.url);
  if (url.hostname === 'cloudflare-dns.com') {
    const nom = url.searchParams.get('name');
    const type = url.searchParams.get('type');
    resolutions.push(nom);
    const ip = type !== 'A' ? null : nom === 'interne-exemple.fr' ? '192.168.1.10' : nom.endsWith('-exemple.fr') ? '93.184.215.14' : null;
    return Response.json({ Status: ip ? 0 : 3, Answer: ip ? [{ name: nom, type: 1, TTL: 60, data: ip }] : [] });
  }
  if (url.hostname.endsWith('-exemple.fr')) {
    const methode = init.method ?? 'GET';
    sortants.push({ methode, hote: url.hostname, chemin: url.pathname + url.search, entetes: { ...(init.headers ?? {}) }, redirect: init.redirect, credentials: init.credentials });
    const r = repondre(url.hostname, methode, url.pathname + url.search, typeof init.body === 'string' ? init.body : '');
    return new Response(r.corps, { status: r.statut, headers: { 'content-type': r.type, ...(r.entetes ?? {}) } });
  }
  return fetchNatif(entree, init);
};

// ------------------------------------------------------------- Relais local (HTTPS) : le vrai Worker
const kv = new Map();
const metas = new Map();
const env = {
  JETON,
  ORIGINES_SITE: ORIGINE_SITE,
  LIMITE_TSUZUKU_MINUTE: '1000',
  BOITE: {
    get: async cle => (kv.has(cle) ? kv.get(cle) : null),
    put: async (cle, valeur, options) => {
      kv.set(cle, valeur);
      if (options?.metadata) metas.set(cle, options.metadata);
      else metas.delete(cle);
    },
    delete: async cle => {
      kv.delete(cle);
      metas.delete(cle);
    },
    list: async ({ prefix = '' } = {}) => ({ keys: [...kv.keys()].filter(c => c.startsWith(prefix)).sort().map(name => ({ name, metadata: metas.get(name) })), list_complete: true }),
  },
};
const journalRelais = [];
const journalWorker = [];
const logOrigine = console.log;
let ancienRelais = false;
const dossier = mkdtempSync(join(tmpdir(), 'e2e-site-relais-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dossier, 'k.pem'), '-out', join(dossier, 'c.pem'), '-subj', '/CN=localhost', '-days', '1'], { stdio: 'ignore' });
const serveurRelais = https.createServer({ key: readFileSync(join(dossier, 'k.pem')), cert: readFileSync(join(dossier, 'c.pem')) }, async (req, res) => {
  const morceaux = [];
  for await (const m of req) morceaux.push(m);
  const corps = Buffer.concat(morceaux);
  const jeton = String(req.headers.authorization ?? '').replace(/^Bearer\s+/, '');
  const portee = jeton === JETON ? 'maitre' : jeton.startsWith('p1.') ? jeton.split('.')[1] : '?';
  let reponse;
  if (ancienRelais && req.url.startsWith('/tsuzuku/')) {
    // Relais d'avant cette version : la route n'existe pas (passerelle → « Adresse inconnue. »).
    reponse = req.method === 'OPTIONS'
      ? new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS' } })
      : new Response(JSON.stringify({ erreur: 'Adresse inconnue.' }), { status: 404, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } });
  } else {
    const requete = new Request(`https://localhost:${PORT_RELAIS}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : corps });
    // Le journal du Worker (console.log) est capturé pour vérifier qu'il ne contient ni adresse complète ni corps.
    console.log = (...a) => journalWorker.push(a.join(' '));
    try {
      reponse = await worker.fetch(requete, env);
    } finally {
      console.log = logOrigine;
    }
  }
  journalRelais.push({ methode: req.method, chemin: req.url, statut: reponse.status, portee });
  res.writeHead(reponse.status, Object.fromEntries(reponse.headers));
  res.end(Buffer.from(await reponse.arrayBuffer()));
});
await new Promise(ok => serveurRelais.listen(PORT_RELAIS, ok));

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
const base64url = t => Buffer.from(t).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const CODE_PC = 'AB1.' + base64url(JSON.stringify({ r: `https://localhost:${PORT_RELAIS}`, j: JETON }));
const pause = ms => new Promise(ok => setTimeout(ok, ms));
const log = (...a) => logOrigine('[e2e]', ...a);
let echecs = 0;
const verifier = (ok, message) => {
  logOrigine(ok ? '  OK   ' : '  ECHEC', message);
  if (!ok) echecs++;
};
const capture = async (pg, nom, pleine = false) => {
  await pause(350);
  await pg.screenshot({ path: join(CAPTURES, `${nom}.png`), fullPage: pleine });
};
const visible = (pg, id, delai = 20_000) => pg.getByTestId(id).first().waitFor({ timeout: delai }).then(() => true, () => false);
const debordement = pg => pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const voir = async (pg, id) => pg.getByTestId(id).first().scrollIntoViewIfNeeded().catch(() => undefined);
const appelsTsuzuku = portee => journalRelais.filter(a => a.chemin.startsWith('/tsuzuku/') && a.methode === 'POST' && (!portee || a.portee === portee));
async function deverrouiller(pg, motDePasse, secret) {
  for (const decalage of [0, 1, -1]) {
    await pg.locator('input[type=password]').first().fill(motDePasse);
    await pg.locator('input:not([type=password])').first().fill(totp(secret, decalage));
    await pg.getByTestId('bouton-deverrouiller').click();
    if (await visible(pg, 'hub', 25_000)) return;
  }
  throw new Error('déverrouillage impossible');
}
async function fermerPopups(pg) {
  for (let i = 0; i < 3; i++) {
    const clique = await pg.getByText(/^(Fermer|Terminé|Compris|Plus tard)$/).first().click({ timeout: 2500 }).then(() => true, () => false);
    if (!clique) break;
  }
  await pg.keyboard.press('Escape').catch(() => undefined);
}
async function creerCoffre(pg, motDePasse, adresse) {
  await pg.goto(adresse);
  await pg.getByTestId('accueil-site').waitFor({ timeout: 60_000 });
  await pg.getByTestId('accueil-creer').click();
  await pg.getByTestId('accueil-creer-confirmer').click();
  const champs = pg.locator('input[type=password]');
  await champs.nth(0).waitFor({ timeout: 60_000 });
  await champs.nth(0).fill(motDePasse);
  await champs.nth(1).fill(motDePasse);
  await pg.getByTestId('bouton-creer').click();
  await pg.getByText('À noter maintenant').waitFor({ timeout: 60_000 });
  const secret = ((await pg.locator('body').innerText()).match(/\b[A-Z2-7]{16,}\b/) ?? [])[0];
  if (!secret) throw new Error('secret TOTP introuvable');
  await pg.getByRole('switch').click();
  await pg.getByTestId('bouton-continuer').click();
  await pg.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(pg, motDePasse, secret));
  await fermerPopups(pg);
  await pg.getByTestId('hub').waitFor({ timeout: 20_000 });
  return secret;
}
async function ouvrirTsuzuku(pg) {
  await allerPageApplications(pg);
  await pg.locator('[data-testid="cellule-tsuzuku"], [data-testid="tuile-tsuzuku"]').first().click();
  await pg.getByTestId('tsuzuku-racine').waitFor({ timeout: 20_000 });
}
async function ouvrirFiche(pg, id) {
  await pg.getByTestId('onglet-app-accueil').click();
  await pg.getByTestId(`carte-anime-${id}`).first().click();
  await pg.getByTestId('fiche-titre').waitFor({ timeout: 20_000 });
}
async function testerSurFiche(pg, id) {
  if (!(await pg.getByTestId(`fiche-tester-${id}`).count())) await pg.getByTestId('fiche-tester-ouvrir').click();
  await pg.getByTestId(`fiche-tester-${id}`).click();
  await pg.getByTestId(`fiche-test-${id}-bilan`).waitFor({ timeout: 30_000 });
  return pg.getByTestId(`fiche-test-${id}-bilan`).innerText();
}
/** Appel direct de la route depuis la page (même origine que le site). */
const appelDirect = (pg, jeton, corps) =>
  pg.evaluate(
    async ({ relais, jeton, corps }) => {
      const r = await fetch(`${relais}/tsuzuku/requete`, { method: 'POST', headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' }, body: JSON.stringify(corps) });
      return { statut: r.status, json: await r.json().catch(() => null) };
    },
    { relais: `https://localhost:${PORT_RELAIS}`, jeton, corps },
  );
async function routerCatalogue(contexte) {
  await contexte.route(
    url => ['api.jikan.moe', 'graphql.anilist.co', 'img-exemple.fr', 'lecteur-exemple.fr', 'wordpress-exemple.fr'].includes(url.hostname) || /^hote-[a-d]-exemple\.fr$/.test(url.hostname),
    async route => {
      const url = new URL(route.request().url());
      const r = repondre(url.hostname, route.request().method(), url.pathname + url.search, route.request().postData() ?? '');
      await route.fulfill({ status: r.statut, contentType: r.type, body: r.corps, headers: { 'access-control-allow-origin': '*' } });
    },
  );
}

// ------------------------------------------------------------- Sources (une clé fictive dans une adresse : jamais dans le diagnostic copié)
const S = (id, name, baseUrl, extra, enabled = false) => ({ id, name, baseUrl, enabled, language: 'indifferent', player: { iframe: 'iframe' }, ...extra });
const SOURCES = [
  S('protege', 'Site protégé', 'https://protege-exemple.fr', { search: { path: '/recherche?q={query}&api_key=CLE-FICTIVE-E2E', item: '.r' } }, true),
  S('spa-html', 'Site JavaScript (HTML)', 'https://spa-exemple.fr', { search: { path: '/recherche?q={query}', item: '.resultat', title: 'a', link: 'a' } }),
  S('spa-api', 'Site JavaScript (API JSON)', 'https://spa-exemple.fr', { search: { path: '/api/recherche?terme={q}', type: 'json', item: 'data.resultats', title: 'titre', link: 'slug', linkFormat: '/anime/{value}' } }),
  S('ajax', 'Site AJAX (POST)', 'https://ajax-exemple.fr', { search: { path: '/ajax/recherche', method: 'POST', body: 'action=recherche&terme={query}', item: 'li.r', title: 'a', link: 'a' } }),
  S('ancien', 'Ancienne adresse (miroir)', 'https://ancien-exemple.fr', { search: { path: '/recherche?q={query}', item: 'ul.res li', title: 'a', link: 'a' }, episodes: { item: 'ol.eps li', link: 'a' } }),
  S('latin', 'Site ISO-8859-1', 'https://latin-exemple.fr', { search: { path: '/recherche?q={query}', item: 'ul.res li', title: 'a', link: 'a' }, episodes: { item: 'ul.eps li', link: 'a' } }),
  S('interne', 'Nom vers le réseau local', 'https://interne-exemple.fr', { search: { path: '/recherche?q={query}', item: 'ul.res li', title: 'a', link: 'a' } }),
  S('wordpress', 'Catalogue WordPress', 'https://wordpress-exemple.fr', {
    search: { path: '/?s={query}&post_type=wp-manga', item: '.c-tabs-item__content', title: '.post-title a', link: '.post-title a' },
    episodes: { item: 'li.wp-manga-chapter', link: 'a' },
    player: { options: 'select.host-select option', optionAttr: 'value' },
  }),
];

/** Zone du lecteur : uniquement l'iframe de l'hôte attendu, aucun texte de la page du site (ni dans la zone, ni dans l'iframe). */
async function zoneSeulementHote(pg, hote, nom) {
  await pg.waitForFunction(h => document.querySelector('[data-testid="lecteur-zone"] iframe')?.src.startsWith(`https://${h}/`), hote, { timeout: 20_000 }).catch(() => undefined);
  const zone = await pg.evaluate(() => {
    const z = document.querySelector('[data-testid="lecteur-zone"]');
    const f = z?.querySelector('iframe');
    const r = f?.getBoundingClientRect();
    return z && { iframes: z.querySelectorAll('iframe').length, enfants: z.children.length, src: f?.src ?? '', srcdoc: f?.hasAttribute('srcdoc'), sandbox: f?.getAttribute('sandbox'), allow: f?.getAttribute('allow'), plein: f?.hasAttribute('allowfullscreen'), texte: z.textContent, l: r?.width ?? 0, h: r?.height ?? 0, zl: z.getBoundingClientRect().width };
  });
  const cadre = pg.frameLocator('[data-testid="lecteur-zone"] iframe');
  const dansCadre = await cadre.locator('body').innerText({ timeout: 15_000 }).catch(() => '');
  const ecran = await pg.getByTestId('tsuzuku-lecteur').innerText();
  const fuite = TEXTES_SITE_SOURCE.filter(t => dansCadre.includes(t) || ecran.includes(t) || (zone?.texte ?? '').includes(t));
  verifier(
    zone && zone.iframes === 1 && zone.enfants === 1 && zone.src.startsWith(`https://${hote}/`) && !zone.srcdoc && dansCadre.startsWith(`Hôte ${hote[5].toUpperCase()}`) && fuite.length === 0,
    `${nom} : la zone ne contient QUE l'iframe de ${hote} (« ${dansCadre.slice(0, 40)} »)${fuite.length ? ` — textes du site trouvés : ${fuite.join(', ')}` : ''}`,
  );
  return zone;
}

const navigateur = await chromium.launch({ headless: true });
const options = { ignoreHTTPSErrors: true, viewport: { width: 1100, height: 820 } };
try {
  const contexte = await nouveauContexte(navigateur, options);
  await contexte.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGINE_SITE }).catch(() => undefined);
  await routerCatalogue(contexte);
  const pg = await contexte.newPage();
  const erreursPage = [];
  pg.on('pageerror', e => {
    erreursPage.push(e.message);
    log('erreur page :', e.message);
  });

  // ============================================================ Fondateur relié au relais (code du PC)
  log('Site : coffre du Fondateur, relié au relais avec le code du PC');
  const secretAdmin = await creerCoffre(pg, MDP_ADMIN, `${SITE}#liaison=${CODE_PC}`);
  verifier(await pg.evaluate(() => !globalThis.applibourse?.tsuzuku && typeof globalThis.applibourse?.tsuzukuRelais?.envoyer === 'function'), 'version navigateur : pas de pont du PC, transport du relais présent');
  await ouvrirTsuzuku(pg);
  verifier((await pg.getByTestId('tsuzuku-site').count()) === 0, 'Fondateur relié : pas de message « sources indisponibles sur le site »');
  await pg.getByTestId('onglet-app-sources').click();
  verifier(await visible(pg, 'sources-via-relais'), 'page Sources : « lues via le relais »');
  await pg.getByTestId('sources-import-texte').fill(JSON.stringify({ sources: SOURCES }));
  await pg.getByTestId('sources-importer').click();
  await pause(800);
  verifier((await pg.getByTestId('sources-compte').innerText()).includes(`${SOURCES.length} source(s) · 1 active(s)`), `${SOURCES.length} sources importées, seule « Site protégé » active`);
  await capture(pg, '01-site-sources-via-relais', true);

  // ============================================================ Fiche : source protégée (anti-robot)
  log('Fiche : la seule source active bloque les requêtes automatiques (lue par le relais)');
  await ouvrirFiche(pg, 1);
  verifier(await visible(pg, 'fiche-sources-via-relais', 30_000), 'fiche : « Site web : lecture via le relais »');
  await pg.getByTestId('fiche-sources-echec-message').waitFor({ timeout: 30_000 });
  const message = await pg.getByTestId('fiche-sources-echec-message').innerText();
  verifier(/bloque les requêtes automatiques/.test(message) && !/CORS/.test(message), 'message précis « bloque les requêtes automatiques » (pas le message CORS)');
  await pg.getByTestId('fiche-sources-echec-detail-bouton').click();
  const detail = await pg.getByTestId('fiche-sources-echec-detail').innerText();
  verifier(/via le relais/.test(detail) && /HTTP 503/.test(detail) && /anti-robot/.test(detail) && !detail.includes('CLE-FICTIVE-E2E'), 'détail : « via le relais », HTTP 503, anti-robot, clé masquée');
  await pg.getByTestId('fiche-sources-echec-copier').click();
  await pg.getByTestId('fiche-sources-echec-texte').waitFor({ timeout: 10_000 });
  const copie = await pg.getByTestId('fiche-sources-echec-texte').inputValue();
  verifier(copie.includes('Plateforme : site web (navigateur), via le relais') && !copie.includes('CLE-FICTIVE-E2E') && !copie.includes('valeur-secrete'), 'diagnostic copié : plateforme « via le relais », sans clé ni cookie');
  await voir(pg, 'fiche-sources');
  await capture(pg, '02-site-fiche-protegee-via-relais', true);

  // ============================================================ « Tester une source sur ce titre »
  log('Fiche : chaque site simulé, lu par le relais');
  const spaHtml = await testerSurFiche(pg, 'spa-html');
  const etapeSpa = await pg.getByTestId('fiche-test-spa-html-recherche-ko').innerText().catch(() => '');
  verifier(/incomplet/.test(spaHtml) && /construite en JavaScript/.test(etapeSpa), 'application JavaScript : « construite en JavaScript » (le relais ne fait pas de rendu)');
  for (const id of ['spa-api', 'ajax', 'ancien']) {
    verifier(/Test réussi/.test(await testerSurFiche(pg, id)), `« ${SOURCES.find(s => s.id === id).name} » : recherche → épisodes → lecteur OK, via le relais`);
  }
  verifier(sortants.some(a => a.methode === 'POST' && a.hote === 'ajax-exemple.fr'), 'la recherche AJAX part bien en POST par le relais');
  const iAncien = sortants.findIndex(a => a.hote === 'ancien-exemple.fr');
  verifier(iAncien >= 0 && sortants[iAncien + 1]?.hote === 'miroir-exemple.fr', 'redirection vers le miroir : le relais rend la 301, le site la suit (deux appels distincts au relais)');
  const interne = await testerSurFiche(pg, 'interne');
  const etapeInterne = await pg.getByTestId('fiche-test-interne-recherche-ko').innerText().catch(() => '');
  verifier(/incomplet/.test(interne) && /non publique/.test(etapeInterne) && !sortants.some(a => a.hote === 'interne-exemple.fr'), 'nom qui résout vers le réseau local : refusé par le relais, jamais appelé');
  await voir(pg, 'fiche-tester-sources');
  await capture(pg, '03-site-tests-via-relais');
  await ouvrirFiche(pg, 3);
  verifier(/Test réussi/.test(await testerSurFiche(pg, 'latin')), '« Site ISO-8859-1 » : accents décodés par le Worker, « Été éternel » reconnu');

  // ============================================================ Lecture
  log('Lecture : seule la source « API JSON » active');
  await pg.getByTestId('onglet-app-sources').click();
  await pg.getByTestId('source-activer-protege').click();
  await pause(300);
  await pg.getByTestId('source-activer-spa-api').click();
  await pause(500);
  await ouvrirFiche(pg, 1);
  verifier(await visible(pg, 'fiche-sources-ok', 30_000) && (await pg.getByTestId('fiche-sources-ok').innerText()).includes('6 épisode(s)'), 'fiche : « Le Long Voyage » trouvé via le relais, 6 épisodes');
  await voir(pg, 'fiche-sources');
  await capture(pg, '04-site-fiche-trouvee-via-relais');
  await pg.getByTestId('episode-2').click();
  verifier(await pg.frameLocator('[data-testid="lecteur-iframe"]').getByText('Lecteur neutre (/embed/spa-2)').waitFor({ timeout: 20_000 }).then(() => true, () => false), 'l’épisode 2 se lit depuis le site');
  await capture(pg, '05-site-lecture');
  await pg.getByTestId('lecteur-retour').click();
  // Seconde ouverture de la fiche : depuis le cache (gardé dans la base du profil), sans passer par le relais.
  const appelsAvant = appelsTsuzuku('maitre').length;
  const debutFiche = Date.now();
  await ouvrirFiche(pg, 1);
  await pg.getByTestId('fiche-sources-ok').waitFor({ timeout: 30_000 });
  const reouverture = Date.now() - debutFiche;
  const mesureFiche = await pg.getByTestId('fiche-sources-mesure').innerText().catch(() => '');
  verifier(reouverture < 2500 && /^Depuis le cache/.test(mesureFiche) && appelsTsuzuku('maitre').length === appelsAvant, `fiche rouverte en ${reouverture} ms « ${mesureFiche} », aucun appel au relais`);

  // ============================================================ Garde du relais, appels directs depuis la page
  log('Garde du relais (appels directs depuis la page)');
  const local = await appelDirect(pg, JETON, { url: `http://127.0.0.1:${PORT_SITE}/` });
  const decimal = await appelDirect(pg, JETON, { url: 'http://2130706433/' });
  const metadonnees = await appelDirect(pg, JETON, { url: 'http://169.254.169.254/latest/meta-data/' });
  const port = await appelDirect(pg, JETON, { url: 'https://spa-exemple.fr:22/' });
  verifier([local, decimal, metadonnees, port].every(r => r.statut === 400 && r.json?.code === 'adresse'), 'IP locale, décimale, métadonnées cloud, port interdit : 400 (adresse)');
  const cookie = await appelDirect(pg, JETON, { url: 'https://protege-exemple.fr/', headers: { Cookie: 'session=1', Authorization: 'Basic x' } });
  const dernier = sortants[sortants.length - 1];
  verifier(cookie.statut === 200 && cookie.json.headers['x-tsuzuku-cookie'] === '1' && !JSON.stringify(cookie.json).includes('valeur-secrete') && !('cookie' in dernier.entetes) && !('authorization' in dernier.entetes), 'aucun cookie envoyé ni rendu (Set-Cookie seulement signalé)');
  verifier(sortants.every(a => a.redirect === 'manual' && !Object.keys(a.entetes).some(n => /^(cookie|authorization|origin)$/i.test(n))), 'chaque appel sortant : redirect manuel, ni cookie, ni identifiants, ni origine');
  verifier(resolutions.includes('spa-exemple.fr') && resolutions.includes('interne-exemple.fr'), 'chaque nom est résolu (DNS sur HTTPS) avant l’appel');
  verifier(journalWorker.length > 0 && journalWorker.every(l => !/\/recherche|\?|api_key|terme=|CLE-FICTIVE/.test(l)), `journal du Worker : hôte, statut et durée seulement (${journalWorker[0]})`);

  // ============================================================ Relais pas à jour, limite de débit
  log('Relais pas encore mis à jour (404), puis limite de débit (429)');
  ancienRelais = true;
  await ouvrirFiche(pg, 1);
  await pg.getByTestId('fiche-sources-reessayer').click().catch(() => undefined);
  await pg.getByTestId('fiche-sources-echec-message').waitFor({ timeout: 30_000 });
  const pasAJour = await pg.getByTestId('fiche-sources-echec-message').innerText();
  verifier(/mettez à jour le relais/.test(pasAJour) && /Actions/.test(pasAJour), `relais sans la route : « mettez à jour le relais : … » (${pasAJour.slice(0, 90)}…)`);
  await voir(pg, 'fiche-sources');
  await capture(pg, '06-site-relais-pas-a-jour');
  ancienRelais = false;
  env.LIMITE_TSUZUKU_MINUTE = '1';
  await pg.getByTestId('fiche-sources-echec-reessayer').click();
  const debit = await pg
    .waitForFunction(() => /Trop de requêtes vers le relais/.test(document.querySelector('[data-testid="fiche-sources"]')?.textContent ?? ''), null, { timeout: 30_000 })
    .then(() => true, () => false);
  verifier(debit && journalRelais.some(a => a.statut === 429), 'limite de débit : « Trop de requêtes vers le relais » (429), pas « aucun résultat »');
  await capture(pg, '07-site-limite-debit');
  env.LIMITE_TSUZUKU_MINUTE = '1000';
  await pg.getByTestId('fiche-sources-echec-reessayer').click();
  verifier(await visible(pg, 'fiche-sources-ok', 30_000), 'après la limite : « Réessayer » retrouve les épisodes');

  // ============================================================ Téléphone 390 px
  log('Téléphone 390 × 844');
  await pg.setViewportSize({ width: 390, height: 844 });
  await ouvrirFiche(pg, 1);
  await visible(pg, 'fiche-sources-ok', 30_000);
  await voir(pg, 'fiche-sources');
  verifier((await debordement(pg)) <= 0, 'téléphone : fiche « via le relais » sans défilement horizontal');
  await capture(pg, '08-tel-fiche-via-relais', true);
  await pg.setViewportSize({ width: 1100, height: 820 });

  // ============================================================ Catalogue WordPress : lecteurs nommés (iPad, puis iPhone)
  log('Catalogue WordPress : lecteurs « LECTEUR A/B/C/D » (iframe, script base64, AJAX, ?host=), iPad puis iPhone');
  await pg.getByTestId('onglet-app-sources').click();
  await pg.getByTestId('source-activer-spa-api').click();
  await pause(300);
  await pg.getByTestId('source-activer-wordpress').click();
  await pause(500);
  for (const [appareil, taille] of [['iPad', { width: 820, height: 1180 }], ['iPhone', { width: 390, height: 844 }]]) {
    await pg.setViewportSize(taille);
    await ouvrirFiche(pg, 1);
    await pg.getByTestId('episode-1').waitFor({ timeout: 30_000 });
    await pg.getByTestId('episode-1').click();
    await pg.getByTestId('lecteur-choix-3').waitFor({ timeout: 30_000 });
    const libelles = await Promise.all([0, 1, 2, 3].map(i => pg.getByTestId(`lecteur-choix-${i}`).innerText()));
    verifier(libelles.join('|') === ['A', 'B', 'C', 'D'].map(x => `Catalogue WordPress - LECTEUR ${x}`).join('|'), `${appareil} : 4 lecteurs nommés comme sur le site (${libelles.join(', ')})`);
    const zone = await zoneSeulementHote(pg, 'hote-a-exemple.fr', `${appareil} LECTEUR A`);
    if (zone) {
      verifier(zone.sandbox === 'allow-scripts allow-same-origin allow-presentation' && /autoplay/.test(zone.allow) && /fullscreen/.test(zone.allow) && /encrypted-media/.test(zone.allow) && zone.plein, `${appareil} : iframe cloisonné (sandbox, autoplay, plein écran)`);
      verifier(Math.abs(zone.l - zone.zl) <= 1 && Math.abs(zone.l / zone.h - 16 / 9) < 0.02, `${appareil} : plein cadre 16:9 (${Math.round(zone.l)} × ${Math.round(zone.h)})`);
    }
    verifier((await debordement(pg)) <= 0, `${appareil} : pas de défilement horizontal`);
    await voir(pg, 'lecteur-zone');
    await capture(pg, `11-${appareil.toLowerCase()}-lecteur-hote-a`);
    for (const [i, hote] of [[1, 'hote-b-exemple.fr'], [2, 'hote-c-exemple.fr'], [3, 'hote-d-exemple.fr'], [0, 'hote-a-exemple.fr']]) {
      await pg.getByTestId(`lecteur-choix-${i}`).click();
      await zoneSeulementHote(pg, hote, `${appareil} bascule vers LECTEUR ${'ABCD'[i]}`);
    }
    if (appareil === 'iPhone') await capture(pg, '12-iphone-lecteur-bascule');
    if (appareil === 'iPad' && (await pg.getByTestId('onglets-hub').count())) {
      // Onglets multi-apps : Tsuzuku masqué → l'iframe de l'hôte est retiré (un iframe masqué jouerait encore le son).
      await pg.getByTestId('onglets-hub').click();
      const retire = await pg.waitForFunction(() => document.querySelectorAll('[data-testid="lecteur-iframe"]').length === 0, null, { timeout: 10_000 }).then(() => true, () => false);
      await pg.getByTestId('onglets-n1-ouvrir').click();
      await zoneSeulementHote(pg, 'hote-a-exemple.fr', 'iPad retour sur l’onglet Tsuzuku');
      verifier(retire, 'iPad : onglet Tsuzuku masqué (Hub affiché) → lecteur en pause, iframe retiré ; rétabli au retour');
    }
    // Épisode 2 : aucun lecteur extractible → message, bouton vers le site, diagnostic ; jamais la page.
    await pg.getByTestId('lecteur-suivant').click();
    verifier(await visible(pg, 'lecteur-introuvable', 30_000), `${appareil} : épisode sans lecteur → « Lecteur introuvable sur cette page »`);
    const diag = await pg.getByTestId('lecteur-introuvable-diagnostic').innerText().catch(() => '');
    const ecran2 = await pg.getByTestId('tsuzuku-lecteur').innerText();
    verifier(
      (await pg.getByTestId('lecteur-ouvrir-site').count()) === 1 && /Sélecteurs essayés : select\.host-select option/.test(diag) && /0 iframe/.test(diag) && (await pg.locator('[data-testid="tsuzuku-lecteur"] iframe').count()) === 0 && !TEXTES_SITE_SOURCE.some(t => ecran2.includes(t)),
      `${appareil} : « Ouvrir l’épisode sur le site », diagnostic (${diag.slice(0, 70)}…), aucun iframe`,
    );
    await voir(pg, 'lecteur-introuvable');
    await capture(pg, `13-${appareil.toLowerCase()}-lecteur-introuvable`);
    await pg.getByTestId('lecteur-retour').click();
  }
  verifier(sortants.some(a => a.methode === 'POST' && a.chemin === '/wp-admin/admin-ajax.php') && sortants.some(a => a.chemin.includes('?host=LECTEUR+D')), 'lecteur C par l’AJAX du thème, lecteur D par la page « ?host= », via le relais');
  await pg.setViewportSize({ width: 1100, height: 820 });

  // ============================================================ L'amie Léa : pas de lecture des sources
  log('Léa (Ami, jeton de profil) : la fonction n’apparaît pas, le relais refuse');
  await pg.getByTestId('tsuzuku-retour').click().catch(() => undefined);
  await pg.goto(SITE);
  await pg.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 });
  await deverrouiller(pg, MDP_ADMIN, secretAdmin);
  await fermerPopups(pg);
  await allerPageAdministration(pg);
  await pg.locator('[data-testid="cellule-administration"], [data-testid="tuile-administration"]').first().click();
  await pg.getByTestId('app-administration').waitFor({ timeout: 20_000 });
  await pg.getByTestId('admin-onglet-utilisateurs').click();
  await pg.getByTestId('admin-nouveau').click();
  await pg.getByTestId('admin-nom').fill('Léa');
  await pg.getByTestId('admin-nouveau-informe').click();
  await pg.getByTestId('admin-creer').click();
  await pg.getByTestId('admin-identifiants').waitFor({ timeout: 60_000 });
  const mdpLea = (await pg.getByTestId('admin-mot-de-passe').innerText()).replace(/^\s*Mot de passe\s*/, '').trim();
  const secretLea = (await pg.getByTestId('admin-secret-totp').innerText()).replace(/^\s*Clé TOTP\s*/, '').replace(/\s+/g, '');
  await pg.getByTestId('admin-transmis').click().catch(() => undefined);
  await pg.getByTestId('admin-termine').click();
  const idLea = (await pg.locator('[data-testid^="admin-ligne-"]').filter({ hasText: 'Léa' }).first().getAttribute('data-testid')).replace('admin-ligne-', '');
  const jetonLea = await moduleRelais.jetonDeProfil(JETON, idLea);
  const refusLea = await appelDirect(pg, jetonLea, { url: 'https://spa-exemple.fr/api/recherche?terme=voyage' });
  verifier(refusLea.statut === 403 && refusLea.json?.code === 'interdit', 'relais : le jeton de profil de Léa reçoit 403 (réservé au Fondateur)');
  await pg.goto(SITE);
  await pg.getByTestId('connexion-prenom').waitFor({ timeout: 60_000 });
  await pg.getByTestId('connexion-prenom').fill('Léa');
  await pg.getByTestId('connexion-continuer').click();
  await pg.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 });
  await deverrouiller(pg, mdpLea, secretLea);
  await fermerPopups(pg);
  const avantLea = appelsTsuzuku().length;
  await ouvrirTsuzuku(pg);
  verifier(await visible(pg, 'tsuzuku-site'), 'Léa : message du site (lecture des sources réservée au Fondateur relié)');
  const texteLea = await pg.getByTestId('tsuzuku-site').innerText();
  verifier(/Fondateur/.test(texteLea) && /app PC\/iPhone/.test(texteLea), 'le message dit quoi faire (Fondateur relié au relais, sinon app PC/iPhone)');
  verifier((await pg.getByTestId('onglet-app-sources').count()) === 0, 'Léa : pas d’onglet Sources');
  await ouvrirFiche(pg, 1);
  await pause(1500);
  verifier((await pg.getByTestId('fiche-sources-via-relais').count()) === 0 && (await pg.getByTestId('fiche-tester-ouvrir').count()) === 0, 'Léa : ni « via le relais », ni test des sources sur la fiche');
  verifier(appelsTsuzuku().length === avantLea, 'Léa n’a fait aucun appel à la route des sources');
  await capture(pg, '09-amie-sans-lecture-des-sources');

  // ============================================================ Navigateur sans relais
  log('Navigateur sans relais : message clair');
  const sansRelais = await nouveauContexte(navigateur, options);
  await routerCatalogue(sansRelais);
  const autre = await sansRelais.newPage();
  autre.on('pageerror', e => {
    erreursPage.push(e.message);
    log('erreur page (sans relais) :', e.message);
  });
  const avantAutre = journalRelais.length;
  await creerCoffre(autre, MDP_AUTRE, SITE);
  await ouvrirTsuzuku(autre);
  const texteSans = await autre.getByTestId('tsuzuku-site').innerText().catch(() => '');
  verifier(/relais/.test(texteSans) && /identifiant/.test(texteSans) && /app PC\/iPhone/.test(texteSans), 'sans relais : « … compte Fondateur connecté (identifiant et mot de passe) ; sinon app PC/iPhone »');
  await autre.getByTestId('onglet-app-sources').click();
  verifier(await visible(autre, 'sources-site'), 'page Sources : le navigateur ne lit pas les pages (CORS), comment faire');
  await autre.getByTestId('sources-import-texte').fill(JSON.stringify({ sources: [SOURCES[2]].map(s => ({ ...s, enabled: true })) }));
  await autre.getByTestId('sources-importer').click();
  await pause(600);
  await ouvrirFiche(autre, 1);
  await autre.getByTestId('fiche-sources-echec-message').waitFor({ timeout: 30_000 });
  const messageSans = await autre.getByTestId('fiche-sources-echec-message').innerText();
  verifier(/CORS/.test(messageSans) && /relais/.test(messageSans), 'fiche sans relais : CORS expliqué, et comment lire les sources');
  // Le PC du Fondateur, resté ouvert, continue ses tours (toutes les 30 s depuis la version 9) : seuls comptent
  // les appels sans jeton connu, ceux de ce navigateur.
  verifier(journalRelais.slice(avantAutre).every(a => a.portee === 'maitre' || /^[a-z0-9]{6,16}$/.test(a.portee ?? '')), 'aucun appel au relais depuis ce navigateur');
  await voir(autre, 'fiche-sources');
  await capture(autre, '10-sans-relais-message');

  verifier(erreursPage.length === 0, `aucune erreur JavaScript dans la page (${erreursPage.length})`);
  log(`relais : ${appelsTsuzuku('maitre').length} lecture(s) de sources par le Fondateur, ${journalRelais.filter(a => a.statut === 429).length} refus 429`);
} catch (erreur) {
  verifier(false, erreur instanceof Error ? erreur.message.split('\n')[0] : String(erreur));
} finally {
  await navigateur.close();
  serveurSite.close();
  serveurRelais.close();
}
if (echecs > 0) {
  logOrigine(`E2E ECHEC (${echecs})`);
  process.exit(1);
}
logOrigine('E2E OK');
process.exit(0);
