/**
 * Outils partagés par l'audit et le test de bout en bout de l'affichage téléphone
 * (scripts/audit-mobile.mjs, scripts/e2e-mobile.mjs) :
 *
 *  - site statique (bureau/dist), faux relais (relais/worker.mjs, KV en mémoire, faux webhook Discord),
 *    faux « internet » de Tsuzuku (catalogues, images, lecteur neutre) ;
 *  - émulation d'iPhone (390×844 ou 375×667, densité 3, tactile) ;
 *  - mesures faites DANS la page : débordement horizontal, zones tactiles < 44 px, textes < 15 px,
 *    champs sans type/inputMode/autocomplete/enterkeyhint, police des champs < 16 px (zoom iOS).
 *
 * Rien n'est installé : Playwright est celui de l'image (/opt/node22/lib/node_modules), les navigateurs
 * ceux de PLAYWRIGHT_BROWSERS_PATH.
 */

import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createReadStream, existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const racine = fileURLToPath(new URL('..', import.meta.url));
export const pause = ms => new Promise(ok => setTimeout(ok, ms));

export function chargerPlaywright() {
  const requireGlobal = createRequire(join(process.env.PLAYWRIGHT_PATH ?? '/opt/node22/lib/node_modules', 'x.js'));
  return requireGlobal('playwright');
}

/** Options de contexte Playwright d'un iPhone (Safari mobile). */
export function optionsIphone({ largeur = 390, hauteur = 844 } = {}) {
  return {
    viewport: { width: largeur, height: hauteur },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    ignoreHTTPSErrors: true,
    acceptDownloads: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  };
}

// ------------------------------------------------------------------- Serveurs

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff' };

/** Sert bureau/dist (construit par `npx vite build`). */
export async function demarrerSite(port) {
  const dist = join(racine, 'bureau/dist');
  if (!existsSync(join(dist, 'index.html'))) throw new Error('bureau/dist absent : lancez « npx vite build » d’abord');
  const serveur = http.createServer((req, res) => {
    const chemin = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    let fichier = join(dist, chemin);
    if (!existsSync(fichier) || statSync(fichier).isDirectory()) fichier = join(dist, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[extname(fichier)] ?? 'application/octet-stream' });
    createReadStream(fichier).pipe(res);
  });
  await new Promise(ok => serveur.listen(port, ok));
  return { url: `http://localhost:${port}/`, fermer: () => serveur.close() };
}

/** Faux relais : le vrai worker, une KV en mémoire, et un faux webhook Discord (pour le Support). */
export async function demarrerRelais(port, jeton = 'jeton-e2e-mobile-0123456789abcdef', extraEnv = {}) {
  const worker = (await import(pathToFileURL(join(racine, 'relais/worker.mjs')).href)).default;
  const kv = new Map();
  const metas = new Map();
  const WEBHOOK = 'https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
  const discord = [];
  const fetchReel = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    // Le relais poste sur `<webhook>?wait=true` (et `&thread_id=` pour les réponses) : préfixe.
    if (String(url).startsWith(WEBHOOK)) {
      discord.push({ url: String(url), body: init?.body });
      return Response.json({ id: `80000000000000${String(discord.length).padStart(4, '0')}`, channel_id: '700000000000000001' });
    }
    return fetchReel(url, init);
  };
  const env = {
    JETON: jeton,
    DISCORD_WEBHOOK_URL: WEBHOOK,
    // Facultatif : par exemple `ENVOYER_COURRIEL` (vrai transport vers un FAUX serveur SMTP local) pour tester les e-mails.
    ...extraEnv,
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
      list: async ({ prefix = '' } = {}) => ({
        keys: [...kv.keys()].filter(c => c.startsWith(prefix)).sort().map(name => ({ name, metadata: metas.get(name) })),
        list_complete: true,
      }),
    },
  };
  const dossier = mkdtempSync(join(tmpdir(), 'e2e-mobile-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dossier, 'k.pem'), '-out', join(dossier, 'c.pem'), '-subj', '/CN=localhost', '-days', '1'], { stdio: 'ignore' });
  const serveur = https.createServer({ key: readFileSync(join(dossier, 'k.pem')), cert: readFileSync(join(dossier, 'c.pem')) }, async (req, res) => {
    const morceaux = [];
    for await (const m of req) morceaux.push(m);
    const requete = new Request(`https://localhost:${port}${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(morceaux),
    });
    const reponse = await worker.fetch(requete, env);
    res.writeHead(reponse.status, Object.fromEntries(reponse.headers));
    res.end(Buffer.from(await reponse.arrayBuffer()));
  });
  await new Promise(ok => serveur.listen(port, ok));
  const base64url = t => Buffer.from(t).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return {
    code: 'AB1.' + base64url(JSON.stringify({ r: `https://localhost:${port}`, j: jeton })),
    discord,
    fermer: () => serveur.close(),
  };
}

// ------------------------------------------------------------- Internet de Tsuzuku

const ANIMES = [[1, 'Frieren', 2023], [2, 'Dandadan', 2024], [3, 'One Piece', 1999], [4, 'Spy x Family', 2022], [5, 'Bleach', 2004], [6, 'Mob Psycho 100', 2016]];
const FILMS_MAL = [[199, 'Your Name', 2016], [431, 'Le Château ambulant', 2004], [523, 'Mon voisin Totoro', 1988]];
const FILMS_TMDB = [[1001, 'Le Voyage de Chihiro', 2001], [1002, 'Akira', 1988], [1003, 'Princesse Mononoké', 1997]];
const img = id => `https://img-exemple.fr/${id}.jpg`;
const jikanAnime = ([id, titre, annee]) => ({
  mal_id: id, title: titre, title_english: titre, title_japanese: titre, synopsis: `Synopsis de ${titre} : une histoire neutre pour les besoins du test.`,
  images: { jpg: { large_image_url: img(id), image_url: img(id) } }, episodes: 12, status: 'Currently Airing', score: 8.4, year: annee, type: 'TV',
  genres: [{ name: 'Aventure' }, { name: 'Drame' }], studios: [{ name: 'Studio Exemple' }], streaming: [{ name: 'Plateforme légale', url: 'https://legal-exemple.fr/catalogue' }],
});
const jikanFilm = a => ({ ...jikanAnime(a), type: 'Movie', episodes: 1, duration: '107 min per ep' });
const media = ([id, titre, annee]) => ({
  id, idMal: id, title: { romaji: titre, english: titre, native: titre }, description: `Synopsis de ${titre}`, episodes: 12, status: 'RELEASING', format: 'TV', seasonYear: annee,
  averageScore: 84, popularity: 100, genres: ['Aventure'], coverImage: { extraLarge: img(id) }, studios: { nodes: [] }, externalLinks: [],
});
const tmdbFilm = ([id, titre, annee]) => ({ id, title: titre, original_title: titre, overview: `Résumé de ${titre}.`, poster_path: `/${id}.jpg`, backdrop_path: null, release_date: `${annee}-06-01`, vote_average: 8.1, genre_ids: [16] });
const j = (o, statut = 200) => ({ statut, type: 'application/json', corps: JSON.stringify(o) });

function repondreInternet(hote, chemin) {
  const url = new URL(chemin, 'https://x');
  const p = url.pathname;
  if (hote === 'api.jikan.moe') {
    if (/\/anime\/(\d+)\/full/.test(p)) {
      const id = Number(/\/anime\/(\d+)\/full/.exec(p)[1]);
      const a = ANIMES.find(x => x[0] === id) ?? FILMS_MAL.find(x => x[0] === id);
      return a ? j({ data: id >= 199 ? jikanFilm(a) : jikanAnime(a) }) : j({}, 404);
    }
    if (/\/anime\/\d+\/episodes/.test(p)) return j({ data: Array.from({ length: 12 }, (_, i) => ({ mal_id: i + 1, title: `Épisode ${i + 1} : titre neutre`, aired: null, filler: false })), pagination: { last_visible_page: 1 } });
    if (p === '/v4/genres/anime') return j({ data: [{ mal_id: 1, name: 'Action' }, { mal_id: 2, name: 'Aventure' }] });
    const film = url.searchParams.get('type') === 'movie';
    const liste = film ? FILMS_MAL.map(jikanFilm) : ANIMES.map(jikanAnime);
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    return j({ data: q ? liste.filter(a => a.title.toLowerCase().includes(q)) : liste, pagination: { current_page: 1, has_next_page: false, last_visible_page: 1 } });
  }
  if (hote === 'graphql.anilist.co') {
    const m = ANIMES.map(media);
    return j({ data: { trending: { media: m.slice(0, 4) }, popular: { media: m.slice(2) }, airing: { media: m.slice(1, 5) }, topRated: { media: m.slice(0, 3) }, movies: { media: [] } } });
  }
  if (hote === 'api.themoviedb.org') {
    if (p.endsWith('/genre/movie/list')) return j({ genres: [{ id: 16, name: 'Animation' }] });
    const m = /\/movie\/(\d+)$/.exec(p);
    if (m) {
      const f = FILMS_TMDB.find(x => x[0] === Number(m[1]));
      return f ? j({ ...tmdbFilm(f), runtime: 125, genres: [{ id: 16, name: 'Animation' }], tagline: 'Un film neutre', videos: { results: [] }, 'watch/providers': { results: {} } }) : j({}, 404);
    }
    return j({ page: 1, total_pages: 1, total_results: FILMS_TMDB.length, results: FILMS_TMDB.map(tmdbFilm) });
  }
  if (hote === 'img-exemple.fr' || hote === 'image.tmdb.org') {
    const id = Number(/(\d+)/.exec(p)?.[1] ?? 0);
    const teinte = (id * 47) % 360;
    return { statut: 200, type: 'image/svg+xml', corps: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="435"><rect width="300" height="435" fill="hsl(${teinte},55%,40%)"/><text x="150" y="240" font-size="90" text-anchor="middle" fill="white" opacity="0.8" font-family="sans-serif">${id}</text></svg>` };
  }
  if (hote === 'lecteur-exemple.fr') {
    return { statut: 200, type: 'text/html', corps: `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#111;color:#eee;font:20px sans-serif;display:grid;place-items:center;height:100vh"><div>Lecteur neutre</div>` };
  }
  return { statut: 404, type: 'text/plain', corps: 'introuvable' };
}
const HOTES = ['image.tmdb.org', 'api.jikan.moe', 'graphql.anilist.co', 'api.themoviedb.org', 'img-exemple.fr', 'lecteur-exemple.fr', 'legal-exemple.fr'];

/** Détourne les requêtes de Tsuzuku vers l'internet local (aucune sortie réseau). */
export async function simulerInternet(contexte) {
  await contexte.route(url => HOTES.includes(url.hostname), async route => {
    const url = new URL(route.request().url());
    const r = repondreInternet(url.hostname, url.pathname + url.search);
    await route.fulfill({ status: r.statut, contentType: r.type, body: r.corps, headers: { 'access-control-allow-origin': '*' } });
  });
}

// ------------------------------------------------------------------- TOTP

function base32(texte) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of texte.replace(/[=\s]+/g, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  return Buffer.from(bits.match(/.{8}/g).map(o => Number.parseInt(o, 2)));
}
export function totp(secret, decalage = 0) {
  const compteur = Math.floor(Date.now() / 30000) + decalage;
  const tampon = Buffer.alloc(8);
  tampon.writeBigUInt64BE(BigInt(compteur));
  const h = createHmac('sha1', base32(secret)).update(tampon).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, '0');
}

// ------------------------------------------------------------------- Parcours

/** Touche (tap) un élément : sur mobile, c'est un `tap`, pas un clic de souris. */
export async function toucher(page, testId, options = {}) {
  const el = page.getByTestId(testId).first();
  await el.waitFor({ timeout: options.timeout ?? 20_000 });
  await el.scrollIntoViewIfNeeded().catch(() => undefined);
  // Sans écran tactile (fenêtre de PC), un clic.
  const tactile = await page.evaluate(() => 'ontouchstart' in window || navigator.maxTouchPoints > 0);
  if (tactile) await el.tap({ timeout: options.timeout ?? 20_000 });
  else await el.click({ timeout: options.timeout ?? 20_000 });
}

export const visible = (page, id, delai = 20_000) => page.getByTestId(id).first().waitFor({ timeout: delai }).then(() => true, () => false);

/**
 * Premier lancement complet sur le site : création du coffre, secrets notés, documents légaux.
 * `etapes(nom)` est appelé à chaque écran (captures de l'audit). Rend le secret TOTP.
 */
export async function premierLancement(page, { site, code, motDePasse, etape = async () => {} }) {
  await page.goto(code ? `${site}#liaison=${code}` : site);
  await page.getByTestId('accueil-site').waitFor({ timeout: 60_000 });
  await pause(600);
  await etape('accueil-site');
  await toucher(page, 'accueil-creer');
  await pause(300);
  await etape('accueil-creer-avertissement');
  await toucher(page, 'accueil-creer-confirmer');
  const champs = page.locator('input[type=password]');
  await champs.nth(0).waitFor({ timeout: 60_000 });
  await pause(400);
  await etape('premier-lancement');
  await champs.nth(0).fill(motDePasse);
  await champs.nth(1).fill(motDePasse);
  await toucher(page, 'bouton-creer');
  await page.getByText('À noter maintenant').waitFor({ timeout: 60_000 });
  await pause(400);
  await etape('premier-lancement-secrets');
  const secret = ((await page.locator('body').innerText()).match(/\b[A-Z2-7]{16,}\b/) ?? [])[0];
  if (!secret) throw new Error('secret TOTP introuvable');
  await page.getByRole('switch').first().click();
  await toucher(page, 'bouton-continuer');
  return secret;
}

/**
 * Autre appareil du Fondateur relié au relais par le jeton maître (comme le PC avec relais-local.json). Le coffre
 * du Fondateur est sur le serveur (relais version 9, « serveur = référence ») : l'appareil n'en crée pas un autre,
 * il n'y a donc pas d'accueil « créer un coffre » (réservé à un navigateur sans compte). Si un ami existe déjà,
 * l'annuaire relu sur le relais compte plusieurs comptes : écran prénom, où le Fondateur tape « admin » ; sinon,
 * l'écran de déverrouillage de son coffre s'affiche directement. Mot de passe et code à six chiffres du premier
 * appareil (même coffre, même secret TOTP). Rend le secret quand le hub est affiché.
 */
export async function connecterAppareilFondateur(page, { site, code, motDePasse, secret }) {
  await page.goto(`${site}#liaison=${code}`);
  const ecran = await Promise.race([
    page.getByTestId('connexion-prenom').waitFor({ timeout: 60_000 }).then(() => 'prenom', () => null),
    page.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 }).then(() => 'verrou', () => null),
  ]);
  if (!ecran) throw new Error('ni écran prénom ni déverrouillage sur l’appareil du Fondateur');
  if ((await page.getByTestId('accueil-site').count()) !== 0) throw new Error('accueil « créer un coffre » sur un appareil du Fondateur');
  if (ecran === 'prenom') {
    await page.getByTestId('connexion-prenom').fill('admin');
    await toucher(page, 'connexion-continuer');
    await page.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 });
  }
  await deverrouiller(page, motDePasse, secret);
  return secret;
}

export async function deverrouiller(page, motDePasse, secret, attendu = 'hub') {
  for (const decalage of [0, 1, -1]) {
    await page.locator('input[type=password]').first().fill(motDePasse);
    await page.locator('input:not([type=password])').first().fill(totp(secret, decalage));
    await toucher(page, 'bouton-deverrouiller');
    if (await visible(page, attendu, 25_000)) return;
  }
  throw new Error('déverrouillage impossible');
}

// ------------------------------------------------------------------- Mesures

/**
 * Mesure, dans la page, ce qui fait un mauvais écran de téléphone. Rend un objet sérialisable.
 * Ne compte que les éléments visibles dans la fenêtre ou atteignables par défilement vertical.
 */
export function mesurer(page) {
  return page.evaluate(() => {
    const largeur = window.innerWidth;
    const visibleEl = el => {
      const s = getComputedStyle(el);
      if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const dansDefilementHorizontal = el => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && p.scrollWidth > p.clientWidth + 1) return true;
      }
      return false;
    };
    const masque = el => el.closest('[aria-hidden="true"]') !== null;
    const nom = el =>
      (el.getAttribute('data-testid') ? `#${el.getAttribute('data-testid')} ` : '') +
      (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);

    // Débordement horizontal de la page
    const debordementPage = Math.max(0, document.documentElement.scrollWidth - largeur);
    const deborde = [];
    for (const el of document.querySelectorAll('body *')) {
      if (!visibleEl(el) || masque(el)) continue;
      const r = el.getBoundingClientRect();
      if ((r.right > largeur + 1 || r.left < -1) && !dansDefilementHorizontal(el)) {
        // On ne garde que les éléments dont le parent, lui, ne déborde pas (la racine du problème).
        const p = el.parentElement?.getBoundingClientRect();
        if (!p || (p.right <= largeur + 1 && p.left >= -1)) deborde.push(nom(el));
      }
    }

    // Zones tactiles
    const SELECTEUR = 'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=tab], [role=switch], [role=checkbox], [role=radio], [role=menuitem], [role=option]';
    const petites = [];
    let interactifs = 0;
    for (const el of document.querySelectorAll(SELECTEUR)) {
      if (!visibleEl(el) || masque(el)) continue;
      if (el.closest('[data-cible-exemptee]')) continue;
      // Les cases et interrupteurs natifs reçoivent la zone de leur parent cliquable.
      interactifs++;
      const r = el.getBoundingClientRect();
      if (r.width < 44 || r.height < 44) petites.push(`${nom(el)} (${Math.round(r.width)}×${Math.round(r.height)})`);
    }

    // Textes
    const tailles = {};
    let petitsTextes = 0;
    const exemplesPetits = [];
    const marcheur = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = marcheur.nextNode(); n; n = marcheur.nextNode()) {
      const t = n.textContent.trim();
      if (!t) continue;
      const el = n.parentElement;
      if (!el || !visibleEl(el) || masque(el)) continue;
      if (el.closest('[data-texte-exempte]')) continue;
      const taille = Number.parseFloat(getComputedStyle(el).fontSize);
      tailles[taille] = (tailles[taille] ?? 0) + 1;
      if (taille < 15) {
        petitsTextes++;
        if (exemplesPetits.length < 8) exemplesPetits.push(`${t.slice(0, 30)} (${taille}px)`);
      }
    }

    // Champs
    const champs = [];
    for (const el of document.querySelectorAll('input:not([type=hidden]), textarea')) {
      if (!visibleEl(el)) continue;
      const t = el.getAttribute('type') ?? 'text';
      if (['checkbox', 'radio', 'range', 'file'].includes(t)) continue;
      const defauts = [];
      if (Number.parseFloat(getComputedStyle(el).fontSize) < 16) defauts.push('police < 16 px (zoom iOS)');
      if (!el.getAttribute('autocomplete') && t !== 'search') defauts.push('sans autocomplete');
      if (!el.getAttribute('enterkeyhint')) defauts.push('sans enterkeyhint');
      if (t === 'text' && !el.getAttribute('inputmode')) defauts.push('sans inputmode');
      if (!el.getAttribute('aria-label') && !el.labels?.length) defauts.push('sans libellé');
      if (defauts.length) champs.push(`${nom(el)} [${t}] : ${defauts.join(', ')}`);
    }

    // Zones de sécurité
    const sheets = [...document.styleSheets].flatMap(s => {
      try {
        return [...s.cssRules].map(r => r.cssText);
      } catch {
        return [];
      }
    });
    const inline = [...document.querySelectorAll('[style*="safe-area"]')].length;
    const zonesSecurite = sheets.some(t => t.includes('safe-area-inset')) || inline > 0;

    return {
      debordementPage,
      deborde: [...new Set(deborde)].slice(0, 10),
      interactifs,
      petitesCibles: petites.length,
      exemplesCibles: petites.slice(0, 10),
      petitsTextes,
      exemplesPetits,
      tailles,
      champs,
      zonesSecurite,
    };
  });
}
