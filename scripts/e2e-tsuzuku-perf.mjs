/**
 * E2E : TEMPS DE RÉPONSE de Tsuzuku, PC (pont Electron réel) et SITE (route `/tsuzuku/requete`
 * du VRAI relais), contre un « internet » local NEUTRE (domaines fictifs *-exemple.fr) qui simule
 * des latences réalistes : 200 à 800 ms par requête (déterministes), quelques réponses lentes
 * (3 à 5 s), et un aller-retour navigateur → relais de 80 ms sur le site.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-tsuzuku-perf.mjs
 *
 * Variables : MODES=pc,site (défaut : les deux) ; SORTIE=fichier.json (mesures brutes) ;
 * SEUILS=0 pour mesurer sans vérifier les seuils (mesure de la version d'avant).
 *
 * Sources actives, dans l'ordre de priorité :
 *   1. lente-exemple.fr   : chaque requête prend 3,5 à 4,5 s, et le titre n'y est pas ;
 *   2. langues-exemple.fr : « Le Long Voyage » et « Le Long Voyage (VF) », épisodes sur 2 pages.
 *
 * Parcours mesuré (temps jusqu'au premier affichage utile, et jusqu'à la fin) : ouverture de
 * l'app (Découvrir), recherche du catalogue, fiche (puis « Sur vos sources »), épisode 2,
 * bascule VF/VOSTFR, épisode suivant, seconde ouverture de la fiche, puis rechargement complet
 * de la page (cache persistant). Captures : docs/captures-tsuzuku-perf/.
 */

import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { allerPageApplications, nouveauContexte } from './e2e-acceptation.mjs';

const racine = fileURLToPath(new URL('..', import.meta.url));
const requireGlobal = createRequire(join(process.env.PLAYWRIGHT_PATH ?? '/opt/node22/lib/node_modules', 'x.js'));
const { chromium } = requireGlobal('playwright');
const { requeteTsuzuku } = await import(pathToFileURL(join(racine, 'bureau/electron/tsuzuku.mjs')).href);
const worker = (await import(pathToFileURL(join(racine, 'relais/worker.mjs')).href)).default;

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-tsuzuku-perf');
mkdirSync(CAPTURES, { recursive: true });
const MODES = (process.env.MODES ?? 'pc,site').split(',').map(m => m.trim()).filter(Boolean);
const AVEC_SEUILS = process.env.SEUILS !== '0';
const PORT_SITE = 5223;
const PORT_INTERNET = 5222;
const PORT_RELAIS = 8809;
const ORIGINE_SITE = `http://localhost:${PORT_SITE}`;
const SITE = `${ORIGINE_SITE}/`;
const JETON = 'jeton-e2e-perf-0123456789abcdef0123';
const MDP = 'mot-de-passe-e2e-perf-tsuzuku-42';
const ALLER_RETOUR_RELAIS_MS = 80;

// ------------------------------------------------------------- Latences (déterministes)
const hache = t => [...t].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
/** 200 à 800 ms selon l'adresse ; la source « lente » : 3,5 à 4,5 s. */
function latence(hote, chemin) {
  if (hote === 'lente-exemple.fr') return 3500 + (hache(chemin) % 1000);
  if (hote === 'img-exemple.fr' || hote === 'lecteur-exemple.fr') return 120;
  return 200 + (hache(`${hote}${chemin}`) % 600);
}
const dormir = ms => new Promise(ok => setTimeout(ok, ms));

// ------------------------------------------------------------- Catalogue (neutre)
const img = id => `https://img-exemple.fr/${id}.jpg`;
const ANIMES = [
  { id: 1, title: 'Nagai Tabi', en: 'The Long Voyage', fr: 'Le Long Voyage' },
  { id: 3, title: 'Eien no Natsu', en: 'Eternal Summer', fr: 'Été éternel' },
];
const jikan = a => ({
  mal_id: a.id, title: a.title, title_english: a.en, title_japanese: a.title, titles: [{ type: 'Default', title: a.title }, { type: 'English', title: a.en }, { type: 'French', title: a.fr }],
  synopsis: `Synopsis neutre de ${a.en}.`, images: { jpg: { large_image_url: img(a.id), image_url: img(a.id) } }, episodes: 12, status: 'Finished Airing', score: 8, year: 2024, type: 'TV',
  genres: [{ name: 'Aventure' }], studios: [], streaming: [],
});
const media = a => ({ id: a.id, idMal: a.id, title: { romaji: a.title, english: a.en, native: a.title }, description: 'x', episodes: 12, status: 'FINISHED', format: 'TV', seasonYear: 2024, averageScore: 80, popularity: 10, genres: ['Aventure'], coverImage: { extraLarge: img(a.id) }, studios: { nodes: [] }, externalLinks: [] });

// ------------------------------------------------------------- Sites simulés
const j = (o, statut = 200) => ({ statut, type: 'application/json', corps: JSON.stringify(o) });
const page = corps => ({ statut: 200, type: 'text/html; charset=utf-8', corps: `<!doctype html><html><head><meta charset="utf-8"><title>Exemple</title></head><body>${corps}</body></html>` });
const listeEps = (prefixe, de, a) => Array.from({ length: a - de + 1 }, (_, i) => `<li class="ep"><a href="${prefixe}/episode-${de + i}">Épisode ${de + i}</a></li>`).join('');
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
  if (hote === 'lente-exemple.fr') {
    if (p === '/recherche') return page('<ul><li class="r"><a href="/serie/lanternes">Lanternes de minuit</a></li></ul>');
    return { statut: 404, type: 'text/plain', corps: 'introuvable' };
  }
  if (hote === 'langues-exemple.fr') {
    if (p === '/' && url.searchParams.has('s')) {
      return /voyage/.test(q) ? page('<ul class="resultats"><li class="r"><a href="/anime/le-long-voyage/">Le Long Voyage</a></li><li class="r"><a href="/anime/le-long-voyage-vf/">Le Long Voyage (VF)</a></li></ul>') : page('<p>Aucun résultat.</p>');
    }
    const serie = /^\/anime\/le-long-voyage(-vf)?\/(?:page-(\d+)\/?)?$/.exec(p);
    if (serie) {
      const prefixe = `/anime/le-long-voyage${serie[1] ?? ''}`;
      const n = Number(serie[2] ?? 1);
      return page(`<h1>Le Long Voyage${serie[1] ? ' (VF)' : ''}</h1><ul>${n === 1 ? listeEps(prefixe, 1, 6) : listeEps(prefixe, 7, 12)}</ul>${n === 1 ? `<a rel="next" href="${prefixe}/page-2/">Suivant</a>` : ''}`);
    }
    const ep = /^\/anime\/le-long-voyage(-vf)?\/episode-(\d+)$/.exec(p);
    if (ep) return lecteur(`${ep[1] ? 'vf' : 'vostfr'}-${ep[2]}`);
  }
  return { statut: 404, type: 'text/plain', corps: 'introuvable' };
}

// Un compteur de requêtes par hôte (combien d'allers-retours chaque étape coûte).
const requetes = [];
const serveurInternet = http.createServer((req, res) => {
  req.on('data', () => undefined);
  req.on('end', async () => {
    const hote = String(req.headers.host ?? '').split(':')[0];
    requetes.push({ quand: Date.now(), hote, chemin: req.url });
    await dormir(latence(hote, req.url));
    const r = repondre(hote, req.method, req.url);
    res.writeHead(r.statut, { 'Content-Type': r.type, 'Access-Control-Allow-Origin': '*' });
    res.end(r.corps);
  });
});
await new Promise(ok => serveurInternet.listen(PORT_INTERNET, '127.0.0.1', ok));
const requeterVersInternetLocal = (url, options, rappel) =>
  http.request({ host: '127.0.0.1', port: PORT_INTERNET, path: url.pathname + url.search, method: options.method, headers: { ...options.headers, host: url.hostname } }, rappel);
const pontRequete = requete => requeteTsuzuku(requete, { requeter: requeterVersInternetLocal });

// ------------------------------------------------------------- Relais local (HTTPS) : le vrai Worker, sorties vers l'internet local
const fetchNatif = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (entree, init = {}) => {
  const url = new URL(typeof entree === 'string' ? entree : entree.url);
  if (url.hostname === 'cloudflare-dns.com') {
    const nom = url.searchParams.get('name');
    const ip = url.searchParams.get('type') === 'A' && nom.endsWith('-exemple.fr') ? '93.184.215.14' : null;
    return Response.json({ Status: ip ? 0 : 3, Answer: ip ? [{ name: nom, type: 1, TTL: 60, data: ip }] : [] });
  }
  if (url.hostname.endsWith('-exemple.fr')) {
    requetes.push({ quand: Date.now(), hote: url.hostname, chemin: url.pathname + url.search });
    await dormir(latence(url.hostname, url.pathname + url.search));
    const r = repondre(url.hostname, init.method ?? 'GET', url.pathname + url.search);
    return new Response(r.corps, { status: r.statut, headers: { 'content-type': r.type } });
  }
  return fetchNatif(entree, init);
};
const kv = new Map();
const env = {
  JETON,
  ORIGINES_SITE: ORIGINE_SITE,
  LIMITE_TSUZUKU_MINUTE: '1000',
  BOITE: {
    get: async cle => (kv.has(cle) ? kv.get(cle) : null),
    put: async (cle, valeur) => void kv.set(cle, valeur),
    delete: async cle => void kv.delete(cle),
    list: async ({ prefix = '' } = {}) => ({ keys: [...kv.keys()].filter(c => c.startsWith(prefix)).sort().map(name => ({ name })), list_complete: true }),
  },
};
let appelsRelais = 0;
const logOrigine = console.log;
const dossier = mkdtempSync(join(tmpdir(), 'e2e-perf-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dossier, 'k.pem'), '-out', join(dossier, 'c.pem'), '-subj', '/CN=localhost', '-days', '1'], { stdio: 'ignore' });
const serveurRelais = https.createServer({ key: readFileSync(join(dossier, 'k.pem')), cert: readFileSync(join(dossier, 'c.pem')) }, async (req, res) => {
  const morceaux = [];
  for await (const m of req) morceaux.push(m);
  const corps = Buffer.concat(morceaux);
  if (req.url.startsWith('/tsuzuku/') && req.method === 'POST') {
    appelsRelais += 1;
    // Aller-retour navigateur → Cloudflare (réseau mobile ou ADSL).
    await dormir(ALLER_RETOUR_RELAIS_MS);
  }
  const requete = new Request(`https://localhost:${PORT_RELAIS}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : corps });
  console.log = () => undefined;
  let reponse;
  try {
    reponse = await worker.fetch(requete, env);
  } finally {
    console.log = logOrigine;
  }
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
const log = (...a) => logOrigine('[e2e]', ...a);
let echecs = 0;
const verifier = (ok, message) => {
  logOrigine(ok ? '  OK   ' : '  ECHEC', message);
  if (!ok) echecs++;
};
const seuil = (ms, max, message) => {
  if (AVEC_SEUILS) verifier(ms != null && ms <= max, `${message} : ${ms == null ? 'non mesuré' : `${(ms / 1000).toFixed(2)} s`} (seuil ${(max / 1000).toFixed(1)} s)`);
};
const visible = (pg, id, delai = 20_000) => pg.getByTestId(id).first().waitFor({ timeout: delai }).then(() => true, () => false);
const capture = async (pg, nom, pleine = false) => {
  await dormir(300);
  await pg.screenshot({ path: join(CAPTURES, `${nom}.png`), fullPage: pleine });
};
async function deverrouiller(pg, secret) {
  for (const decalage of [0, 1, -1]) {
    await pg.locator('input[type=password]').first().fill(MDP);
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
async function creerCoffre(pg, adresse) {
  await pg.goto(adresse);
  await pg.getByTestId('accueil-site').waitFor({ timeout: 60_000 });
  await pg.getByTestId('accueil-creer').click();
  await pg.getByTestId('accueil-creer-confirmer').click();
  const champs = pg.locator('input[type=password]');
  await champs.nth(0).waitFor({ timeout: 60_000 });
  await champs.nth(0).fill(MDP);
  await champs.nth(1).fill(MDP);
  await pg.getByTestId('bouton-creer').click();
  await pg.getByText('À noter maintenant').waitFor({ timeout: 60_000 });
  const secret = ((await pg.locator('body').innerText()).match(/\b[A-Z2-7]{16,}\b/) ?? [])[0];
  if (!secret) throw new Error('secret TOTP introuvable');
  await pg.getByRole('switch').click();
  await pg.getByTestId('bouton-continuer').click();
  await pg.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(pg, secret));
  await fermerPopups(pg);
  await pg.getByTestId('hub').waitFor({ timeout: 20_000 });
  return secret;
}
const cliquerTuile = async pg => {
  await allerPageApplications(pg);
  await pg.locator('[data-testid="cellule-tsuzuku"], [data-testid="tuile-tsuzuku"]').first().click();
};
async function retourHub(pg) {
  await pg.getByTestId('retour-hub').first().click({ timeout: 5000 }).catch(() => pg.keyboard.press('Escape'));
  await pg.getByTestId('hub').waitFor({ timeout: 20_000 });
}
/** Temps entre une action et l'apparition d'un élément (null : jamais vu). */
async function chrono(action, attente) {
  const debut = Date.now();
  await action();
  return attente().then(() => Date.now() - debut, () => null);
}
const iframeAvec = (pg, texte, delai = 60_000) => pg.frameLocator('[data-testid="lecteur-iframe"]').getByText(texte).waitFor({ timeout: delai });
const S = (id, name, baseUrl, search) => ({ id, name, baseUrl, enabled: true, language: 'indifferent', search, episodes: { item: 'li.ep', link: 'a' }, player: { iframe: 'iframe' } });
const SOURCES = [
  S('lente', 'Médiathèque lente', 'https://lente-exemple.fr', { path: '/recherche?q={query}', item: 'li.r', title: 'a', link: 'a' }),
  S('langues', 'Médiathèque VF/VOSTFR', 'https://langues-exemple.fr', { path: '/?s={query}', item: 'li.r', title: 'a', link: 'a' }),
];

/** Le parcours complet sur une plateforme ; rend les temps (ms) de chaque étape. */
async function parcours(navigateur, mode) {
  const t = {};
  const contexte = await nouveauContexte(navigateur, { ignoreHTTPSErrors: true, viewport: { width: 1100, height: 820 } });
  await contexte.route(
    url => ['api.jikan.moe', 'graphql.anilist.co', 'img-exemple.fr', 'lecteur-exemple.fr'].includes(url.hostname),
    async route => {
      const url = new URL(route.request().url());
      await dormir(latence(url.hostname, url.pathname + url.search));
      const r = repondre(url.hostname, route.request().method(), url.pathname + url.search);
      await route.fulfill({ status: r.statut, contentType: r.type, body: r.corps, headers: { 'access-control-allow-origin': '*' } });
    },
  );
  const pg = await contexte.newPage();
  const erreurs = [];
  pg.on('pageerror', e => erreurs.push(e.message));
  if (mode === 'pc') {
    await pg.exposeFunction('__tsuRequete', pontRequete);
    await pg.exposeFunction('__tsuLecteur', async () => true);
  }
  const activerPontPc = () => (mode === 'pc' ? pg.evaluate(() => { globalThis.applibourse = { tsuzuku: { requete: r => globalThis.__tsuRequete(r), lecteur: u => globalThis.__tsuLecteur(u) } }; }) : undefined);
  const secret = await creerCoffre(pg, mode === 'site' ? `${SITE}#liaison=${CODE_PC}` : SITE);
  await activerPontPc();
  await cliquerTuile(pg);
  await pg.getByTestId('tsuzuku-racine').waitFor({ timeout: 20_000 });
  await pg.getByTestId('onglet-app-sources').click();
  await pg.getByTestId('sources-import-texte').fill(JSON.stringify({ sources: SOURCES }));
  await pg.getByTestId('sources-importer').click();
  await dormir(800);
  verifier((await pg.getByTestId('sources-compte').innerText()).includes('2 source(s) · 2 active(s)'), `${mode} : 2 sources actives importées`);
  await retourHub(pg);

  // 1. Ouverture de l'app : Découvrir.
  log(`${mode} : ouverture de l'app (Découvrir)`);
  t.accueil = await chrono(() => cliquerTuile(pg), () => pg.getByTestId('carte-anime-1').first().waitFor({ timeout: 30_000 }));
  await capture(pg, `${mode}-01-accueil`);

  // 2. Recherche dans le catalogue.
  log(`${mode} : recherche du catalogue`);
  await pg.getByTestId('accueil-recherche').fill('voyage');
  t.catalogue = await chrono(() => pg.getByTestId('accueil-chercher').click(), () => pg.getByTestId('catalogue-grille').getByTestId('carte-anime-1').first().waitFor({ timeout: 30_000 }));

  // 3. Fiche : premier affichage utile (titre), puis « Sur vos sources » (épisodes trouvés).
  log(`${mode} : fiche et recherche sur les sources`);
  const debutFiche = Date.now();
  await pg.getByTestId('catalogue-grille').getByTestId('carte-anime-1').first().click();
  t.fiche = await pg.getByTestId('fiche-titre').waitFor({ timeout: 30_000 }).then(() => Date.now() - debutFiche, () => null);
  // Premier affichage utile : le résultat provisoire (source moins prioritaire) ou le résultat final.
  t.ficheSourcesPremier = await pg.locator('[data-testid="fiche-sources-provisoire"], [data-testid="fiche-sources-ok"]').first().waitFor({ timeout: 90_000 }).then(() => Date.now() - debutFiche, () => null);
  const final = pg.getByTestId('fiche-sources-ok').waitFor({ timeout: 90_000 }).then(() => Date.now() - debutFiche, () => null);
  if (await pg.getByTestId('fiche-sources-provisoire').count()) {
    await pg.getByTestId('fiche-sources').scrollIntoViewIfNeeded().catch(() => undefined);
    await pg.screenshot({ path: join(CAPTURES, `${mode}-02a-fiche-provisoire.png`) }).catch(() => undefined);
  }
  t.ficheSources = await final;
  t.ficheLangues = await pg.getByTestId('fiche-langue-choix').waitFor({ timeout: 30_000 }).then(() => Date.now() - debutFiche, () => null);
  const texteOk = await pg.getByTestId('fiche-sources-ok').innerText().catch(() => '');
  verifier(/Médiathèque VF\/VOSTFR/.test(texteOk) && /12 épisode/.test(texteOk), `${mode} : « Le Long Voyage » trouvé sur la source 2 (12 épisodes, 2 pages)`);
  await pg.getByTestId('fiche-sources').scrollIntoViewIfNeeded().catch(() => undefined);
  await capture(pg, `${mode}-02-fiche-sources`);

  // 4. Épisode 2 : résolution du lecteur.
  log(`${mode} : épisode 2`);
  await pg.getByTestId('episode-2').scrollIntoViewIfNeeded();
  t.episode = await chrono(() => pg.getByTestId('episode-2').click(), () => iframeAvec(pg, /Lecteur neutre \(\/embed\/(vf|vostfr)-2\)/));
  const langue = (await pg.frameLocator('[data-testid="lecteur-iframe"]').locator('body').innerText().catch(() => '')).includes('vf-2') ? 'vf' : 'vostfr';
  await capture(pg, `${mode}-03-episode-2`);

  // 5. Bascule VF/VOSTFR.
  const autre = langue === 'vf' ? 'vostfr' : 'vf';
  log(`${mode} : bascule ${langue} → ${autre}`);
  t.langue = await chrono(() => pg.getByTestId(`lecteur-langue-${autre}`).click(), () => iframeAvec(pg, `Lecteur neutre (/embed/${autre}-2)`));

  // 6. Épisode suivant.
  log(`${mode} : épisode suivant`);
  await dormir(1500);
  t.suivant = await chrono(() => pg.getByTestId('lecteur-suivant').click(), () => iframeAvec(pg, `Lecteur neutre (/embed/${autre}-3)`));
  await capture(pg, `${mode}-04-episode-3`);

  // 7. Seconde ouverture de la fiche (retour au hub, l'app est rouverte).
  log(`${mode} : seconde ouverture de la fiche`);
  await pg.getByTestId('lecteur-retour').click();
  await retourHub(pg);
  await cliquerTuile(pg);
  await pg.getByTestId('carte-anime-1').first().waitFor({ timeout: 30_000 });
  const debut2 = Date.now();
  await pg.getByTestId('carte-anime-1').first().click();
  t.fiche2 = await pg.getByTestId('fiche-titre').waitFor({ timeout: 30_000 }).then(() => Date.now() - debut2, () => null);
  t.ficheSources2 = await pg.getByTestId('fiche-sources-ok').waitFor({ timeout: 90_000 }).then(() => Date.now() - debut2, () => null);

  // 8. Rechargement complet de la page (cache persistant dans la base du profil).
  log(`${mode} : rechargement de la page`);
  await pg.goto(SITE);
  await pg.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 });
  await deverrouiller(pg, secret);
  await fermerPopups(pg);
  await activerPontPc();
  t.accueil3 = await chrono(() => cliquerTuile(pg), () => pg.getByTestId('carte-anime-1').first().waitFor({ timeout: 30_000 }));
  const debut3 = Date.now();
  await pg.getByTestId('carte-anime-1').first().click();
  t.fiche3 = await pg.getByTestId('fiche-titre').waitFor({ timeout: 30_000 }).then(() => Date.now() - debut3, () => null);
  t.ficheSources3 = await pg.getByTestId('fiche-sources-ok').waitFor({ timeout: 90_000 }).then(() => Date.now() - debut3, () => null);
  await pg.getByTestId('fiche-sources').scrollIntoViewIfNeeded().catch(() => undefined);
  await capture(pg, `${mode}-05-fiche-apres-rechargement`);
  t.requetesSources = requetes.filter(r => !['img-exemple.fr', 'lecteur-exemple.fr'].includes(r.hote)).length;
  verifier(erreurs.length === 0, `${mode} : aucune erreur JavaScript (${erreurs.join(' | ').slice(0, 200)})`);
  await contexte.close();
  return t;
}

const ETAPES = [
  ['accueil', 'Ouverture de l’app (Découvrir, 1re carte)'],
  ['catalogue', 'Recherche du catalogue'],
  ['fiche', 'Fiche : premier affichage (titre)'],
  ['ficheSourcesPremier', 'Fiche : 1er résultat des sources affiché'],
  ['ficheSources', 'Fiche : « Sur vos sources » final'],
  ['ficheLangues', 'Fiche : sélecteur VF/VOSTFR'],
  ['episode', 'Épisode 2 : lecteur affiché'],
  ['langue', 'Bascule VF/VOSTFR'],
  ['suivant', 'Épisode suivant'],
  ['fiche2', '2e ouverture : fiche'],
  ['ficheSources2', '2e ouverture : « Sur vos sources »'],
  ['accueil3', 'Après rechargement : Découvrir'],
  ['ficheSources3', 'Après rechargement : « Sur vos sources »'],
  ['requetesSources', 'Requêtes vers les sources (tout le parcours)'],
  ['appelsRelais', 'Appels au relais (site)'],
];

const navigateur = await chromium.launch({ headless: true });
const mesures = {};
try {
  for (const mode of MODES) {
    requetes.length = 0;
    appelsRelais = 0;
    mesures[mode] = await parcours(navigateur, mode);
    if (mode === 'site') mesures[mode].appelsRelais = appelsRelais;
  }
} catch (erreur) {
  verifier(false, erreur instanceof Error ? erreur.message.split('\n')[0] : String(erreur));
} finally {
  await navigateur.close();
  serveurSite.close();
  serveurInternet.close();
  serveurRelais.close();
}

const s = ms => (ms == null ? '—' : `${(ms / 1000).toFixed(2)} s`);
logOrigine(`\n| Étape | ${MODES.join(' | ')} |\n| --- | ${MODES.map(() => '---').join(' | ')} |`);
for (const [cle, libelle] of ETAPES) {
  logOrigine(`| ${libelle} | ${MODES.map(m => (cle === 'requetesSources' || cle === 'appelsRelais' ? mesures[m]?.[cle] ?? '—' : s(mesures[m]?.[cle]))).join(' | ')} |`);
}
if (process.env.SORTIE) writeFileSync(process.env.SORTIE, JSON.stringify(mesures, null, 2));

// Seuils (version optimisée) : raisonnables pour une machine de test chargée.
for (const mode of MODES) {
  const m = mesures[mode] ?? {};
  seuil(m.fiche, 3000, `${mode} : fiche affichée`);
  seuil(m.ficheSourcesPremier, 5000, `${mode} : premier résultat des sources affiché (provisoire)`);
  seuil(m.ficheSources, 9000, `${mode} : « Sur vos sources » (source prioritaire lente : course + délai de grâce)`);
  seuil(m.episode, 4000, `${mode} : épisode lu depuis la fiche`);
  seuil(m.langue, 3000, `${mode} : bascule VF/VOSTFR`);
  seuil(m.suivant, 2000, `${mode} : épisode suivant (préchargé)`);
  seuil(m.ficheSources2, 1500, `${mode} : 2e ouverture quasi instantanée (cache)`);
  seuil(m.ficheSources3, 2500, `${mode} : après rechargement (cache persistant)`);
}
if (echecs > 0) {
  logOrigine(`E2E ECHEC (${echecs})`);
  process.exit(1);
}
logOrigine('E2E OK');
process.exit(0);
