/**
 * Test de bout en bout de Tsuzuku dans le hub (navigateur Chromium, réseau externe simulé).
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-tsuzuku.mjs
 *
 * Un « internet » local remplace Jikan, AniList, TMDB, les images, une source neutre
 * (mediatheque-exemple.fr) et un lecteur neutre (lecteur-exemple.fr) : le navigateur y est
 * redirigé par `page.route`, et — pour le mode PC — le pont Electron est simulé par le VRAI
 * module `bureau/electron/tsuzuku.mjs` (garde anti-SSRF, redirections rendues, aucun cookie),
 * dont seul le transport est détourné vers l'internet local.
 *
 * Parcours : hub → tuile Tsuzuku → Animés/Films → fiche → lien direct → lecture → vu ailleurs →
 * retour au hub (tuile à jour) ; ami sans permission (pas de tuile) ; Paramètres › Tsuzuku ;
 * mode PC (sources, lecture par source, garde) ; 390 px ; trois thèmes.
 *
 * Variables : PLAYWRIGHT_PATH (dossier de node_modules contenant playwright),
 * CAPTURES (dossier des captures, défaut docs/captures-tsuzuku).
 */

import { createHmac } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { nouveauContexte } from './e2e-acceptation.mjs';

const racine = fileURLToPath(new URL('..', import.meta.url));
const requireGlobal = createRequire(join(process.env.PLAYWRIGHT_PATH ?? '/opt/node22/lib/node_modules', 'x.js'));
const { chromium } = requireGlobal('playwright');
const { requeteTsuzuku } = await import(pathToFileURL(join(racine, 'bureau/electron/tsuzuku.mjs')).href);

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-tsuzuku');
mkdirSync(CAPTURES, { recursive: true });
const PORT_SITE = 5199;
const PORT_INTERNET = 5198;
const MDP_ADMIN = 'mot-de-passe-du-pc-e2e-très-long-42';

// ------------------------------------------------------------- Internet local (par nom d'hôte)
const ANIMES = [
  [1, 'Frieren', 2023], [2, 'Dandadan', 2024], [3, 'One Piece', 1999], [4, 'Spy x Family', 2022], [5, 'Bleach', 2004], [6, 'Mob Psycho 100', 2016],
];
const FILMS_MAL = [[199, 'Your Name', 2016], [431, 'Le Château ambulant', 2004], [523, 'Mon voisin Totoro', 1988]];
const FILMS_TMDB = [[1001, 'Le Voyage de Chihiro', 2001], [1002, 'Akira', 1988], [1003, 'Princesse Mononoké', 1997], [1004, 'Perfect Blue', 1997]];
const img = id => `https://img-exemple.fr/${id}.jpg`;
const jikanAnime = ([id, titre, annee]) => ({
  mal_id: id, title: titre, title_english: titre, title_japanese: titre, synopsis: `Synopsis de ${titre} : une histoire neutre pour les besoins du test.`,
  images: { jpg: { large_image_url: img(id), image_url: img(id) } }, episodes: 12, status: 'Currently Airing', score: 8.4, year: annee, type: 'TV',
  genres: [{ name: 'Aventure' }, { name: 'Drame' }], studios: [{ name: 'Studio Exemple' }], streaming: [{ name: 'Plateforme légale', url: 'https://legal-exemple.fr/catalogue' }],
});
const jikanFilm = ([id, titre, annee]) => ({ ...jikanAnime([id, titre, annee]), type: 'Movie', episodes: 1, duration: '107 min per ep' });
const media = ([id, titre, annee]) => ({
  id, idMal: id, title: { romaji: titre, english: titre, native: titre }, description: `Synopsis de ${titre}`, episodes: 12, status: 'RELEASING', format: 'TV', seasonYear: annee,
  averageScore: 84, popularity: 100, genres: ['Aventure'], coverImage: { extraLarge: img(id) }, studios: { nodes: [] }, externalLinks: [],
});
const tmdbFilm = ([id, titre, annee]) => ({ id, title: titre, original_title: titre, overview: `Résumé de ${titre}.`, poster_path: `/${id}.jpg`, backdrop_path: null, release_date: `${annee}-06-01`, vote_average: 8.1, genre_ids: [16] });
const j = (o, statut = 200) => ({ statut, type: 'application/json', corps: JSON.stringify(o) });

function repondre(hote, chemin, methode, corps) {
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
    const film = url.searchParams.get('type') === 'movie' || p.includes('type=movie');
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
    const q = (url.searchParams.get('query') ?? '').toLowerCase();
    return j({ page: 1, total_pages: 1, total_results: FILMS_TMDB.length, results: FILMS_TMDB.filter(f => !q || f[1].toLowerCase().includes(q)).map(tmdbFilm) });
  }
  if (hote === 'img-exemple.fr' || hote === 'image.tmdb.org') {
    const id = Number(/(\d+)/.exec(p)?.[1] ?? 0);
    const teinte = (id * 47) % 360;
    return { statut: 200, type: 'image/svg+xml', corps: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="435"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${teinte},70%,45%)"/><stop offset="1" stop-color="hsl(${(teinte + 60) % 360},60%,25%)"/></linearGradient></defs><rect width="300" height="435" fill="url(#g)"/><text x="150" y="240" font-size="90" text-anchor="middle" fill="white" opacity="0.8" font-family="sans-serif">${id}</text></svg>` };
  }
  if (hote === 'lecteur-exemple.fr') {
    return { statut: 200, type: 'text/html', corps: `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#111;color:#eee;font:24px sans-serif;display:grid;place-items:center;height:100vh"><div>Lecteur neutre (${p})</div>` };
  }
  if (hote === 'mediatheque-exemple.fr') {
    if (p === '/recherche') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const trouve = ANIMES.filter(a => a[1].toLowerCase().includes(q));
      return { statut: 200, type: 'text/html', corps: `<!doctype html><html><body><ul class="resultats">${trouve.map(a => `<li><a class="titre" href="/serie/${a[0]}">${a[1]}</a></li>`).join('')}</ul></body></html>` };
    }
    const serie = /^\/serie\/(\d+)$/.exec(p);
    if (serie) {
      return { statut: 200, type: 'text/html', corps: `<!doctype html><html><body><ol class="episodes">${Array.from({ length: 12 }, (_, i) => `<li><span class="num">${i + 1}</span><a href="/serie/${serie[1]}/ep/${i + 1}">Ép ${i + 1}</a></li>`).join('')}</ol></body></html>` };
    }
    const ep = /^\/serie\/(\d+)\/ep\/(\d+)$/.exec(p);
    if (ep) return { statut: 200, type: 'text/html', corps: `<!doctype html><html><body><div class="lecteur"><iframe src="https://lecteur-exemple.fr/embed/${ep[1]}-${ep[2]}"></iframe></div></body></html>` };
  }
  if (hote === 'legal-exemple.fr') return { statut: 200, type: 'text/html', corps: '<p>Plateforme légale</p>' };
  return { statut: 404, type: 'text/plain', corps: 'introuvable' };
}
const HOTES = ['image.tmdb.org', 'api.jikan.moe', 'graphql.anilist.co', 'api.themoviedb.org', 'img-exemple.fr', 'lecteur-exemple.fr', 'mediatheque-exemple.fr', 'legal-exemple.fr'];
const requetesInternet = [];
const serveurInternet = http.createServer((req, res) => {
  const hote = String(req.headers.host ?? '').split(':')[0];
  requetesInternet.push(`${req.method} ${hote}${req.url}`);
  const r = repondre(hote, req.url, req.method);
  res.writeHead(r.statut, { 'Content-Type': r.type, 'Access-Control-Allow-Origin': '*' });
  res.end(r.corps);
});
await new Promise(ok => serveurInternet.listen(PORT_INTERNET, '127.0.0.1', ok));

/** Transport du pont PC simulé : la vraie garde valide l'adresse publique, puis la connexion part vers l'internet local. */
const requeterVersInternetLocal = (url, options, rappel) =>
  http.request({ host: '127.0.0.1', port: PORT_INTERNET, path: url.pathname + url.search, method: options.method, headers: { ...options.headers, host: url.hostname } }, rappel);
const pontRequete = requete => requeteTsuzuku(requete, { requeter: requeterVersInternetLocal });

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

// ------------------------------------------------------------------- TOTP
function base32(texte) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of texte.replace(/[=\s]+/g, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  return Buffer.from(bits.match(/.{8}/g).map(o => Number.parseInt(o, 2)));
}
function totp(secret, decalage = 0) {
  const compteur = Math.floor(Date.now() / 30000) + decalage;
  const tampon = Buffer.alloc(8);
  tampon.writeBigUInt64BE(BigInt(compteur));
  const h = createHmac('sha1', base32(secret)).update(tampon).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, '0');
}

// ------------------------------------------------------------------ Outils
const SITE = `http://localhost:${PORT_SITE}/`;
const pause = ms => new Promise(ok => setTimeout(ok, ms));
const log = (...a) => console.log('[e2e]', ...a);
let echecs = 0;
const verifier = (ok, message) => {
  console.log(ok ? '  OK   ' : '  ECHEC', message);
  if (!ok) echecs++;
};
const capture = (page, nom) => page.screenshot({ path: join(CAPTURES, `${nom}.png`) });
const attendre = async (condition, delai = 30_000, pas = 500) => {
  const debut = Date.now();
  while (Date.now() - debut < delai) {
    if (await condition()) return true;
    await pause(pas);
  }
  return false;
};
const visible = (page, id, delai = 20_000) => page.getByTestId(id).first().waitFor({ timeout: delai }).then(() => true, () => false);
const debordement = page => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function deverrouiller(page, motDePasse, secret) {
  for (const decalage of [0, 1, -1]) {
    await page.locator('input[type=password]').first().fill(motDePasse);
    await page.locator('input:not([type=password])').first().fill(totp(secret, decalage));
    await page.getByTestId('bouton-deverrouiller').click();
    if (await visible(page, 'hub', 25_000)) return;
  }
  throw new Error('déverrouillage impossible');
}
async function fermerDevblog(page) {
  await page.getByText(/Fermer|Terminé|Compris|Plus tard/).first().click({ timeout: 3000 }).catch(() => undefined);
}
const tuile = (page, id) => page.locator(`[data-testid="cellule-${id}"], [data-testid="tuile-${id}"]`).first();

async function creerAmi(page, nom) {
  await page.getByTestId('admin-onglet-utilisateurs').click();
  await page.getByTestId('admin-nouveau').click();
  await page.getByTestId('admin-nom').fill(nom);
  await page.getByTestId('admin-nouveau-informe').click();
  await page.getByTestId('admin-creer').click();
  await page.getByTestId('admin-identifiants').waitFor({ timeout: 60_000 });
  const motDePasse = (await page.getByTestId('admin-mot-de-passe').innerText()).replace(/^\s*Mot de passe\s*/, '').trim();
  const secret = (await page.getByTestId('admin-secret-totp').innerText()).replace(/^\s*Clé TOTP\s*/, '').replace(/\s+/g, '');
  await page.getByTestId('admin-transmis').click().catch(() => undefined);
  await page.getByTestId('admin-termine').click();
  return { motDePasse, secret };
}

async function ouvrirTsuzuku(page) {
  await tuile(page, 'tsuzuku').click();
  await page.getByTestId('tsuzuku-racine').waitFor({ timeout: 20_000 });
}
async function retourHub(page) {
  await page.getByTestId('retour-hub').click();
  await page.getByTestId('hub').waitFor({ timeout: 20_000 });
}

const navigateur = await chromium.launch({ headless: true });
try {
  const contexte = await nouveauContexte(navigateur, { viewport: { width: 1100, height: 820 }, acceptDownloads: true });
  // Le réseau externe n'existe pas ici : tout ce qui vise nos faux sites part vers l'internet local.
  await contexte.route(url => HOTES.includes(url.hostname), async route => {
    const url = new URL(route.request().url());
    const r = repondre(url.hostname, url.pathname + url.search, route.request().method());
    await route.fulfill({ status: r.statut, contentType: r.type, body: r.corps, headers: { 'access-control-allow-origin': '*' } });
  });
  const page = await contexte.newPage();
  const erreursPage = [];
  page.on('pageerror', e => {
    erreursPage.push(e.message);
    log('erreur page :', e.message);
  });
  await page.exposeFunction('__tsuRequete', pontRequete);
  await page.exposeFunction('__tsuLecteur', async () => true);
  const activerPontPc = () => page.evaluate(() => { globalThis.applibourse = { tsuzuku: { requete: r => globalThis.__tsuRequete(r), lecteur: u => globalThis.__tsuLecteur(u) } }; });
  const desactiverPontPc = () => page.evaluate(() => { delete globalThis.applibourse; });

  // ============================================================ Coffre de l'administrateur
  log('Création du coffre de l’administrateur (site sans relais)');
  await page.goto(SITE);
  await page.getByTestId('accueil-site').waitFor({ timeout: 60_000 });
  await page.getByTestId('accueil-creer').click();
  await page.getByTestId('accueil-creer-confirmer').click();
  const champs = page.locator('input[type=password]');
  await champs.nth(0).waitFor({ timeout: 60_000 });
  await champs.nth(0).fill(MDP_ADMIN);
  await champs.nth(1).fill(MDP_ADMIN);
  await page.getByTestId('bouton-creer').click();
  await page.getByText('À noter maintenant').waitFor({ timeout: 60_000 });
  const secretAdmin = ((await page.locator('body').innerText()).match(/\b[A-Z2-7]{16,}\b/) ?? [])[0];
  if (!secretAdmin) throw new Error('secret TOTP introuvable');
  await page.getByRole('switch').click();
  await page.getByTestId('bouton-continuer').click();
  await page.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(page, MDP_ADMIN, secretAdmin));
  await fermerDevblog(page);
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.getByTestId('hub').waitFor({ timeout: 20_000 });
  verifier(await tuile(page, 'tsuzuku').isVisible(), 'le hub de l’administrateur montre la tuile Tsuzuku');
  await pause(1500);
  await capture(page, '01-hub-tuile-tsuzuku');

  // ============================================================ Amis : Léa sans Tsuzuku, Hugo avec
  log('Administration : Léa (sans Tsuzuku) et Hugo (avec)');
  await tuile(page, 'administration').click();
  await page.getByTestId('app-administration').waitFor({ timeout: 20_000 });
  const lea = await creerAmi(page, 'Léa');
  const hugo = await creerAmi(page, 'Hugo');
  await page.getByText('Léa', { exact: true }).first().click();
  const ligneLea = await page.locator('[data-testid^="admin-ligne-"]').filter({ hasText: 'Léa' }).first().getAttribute('data-testid');
  const idLea = ligneLea.replace('admin-ligne-', '');
  verifier(await page.getByTestId(`admin-niveau-${idLea}-tsuzuku-complet`).isVisible(), 'l’Administration propose Tsuzuku parmi les apps attribuables (accès complet par défaut)');
  await page.getByTestId(`admin-niveau-${idLea}-tsuzuku-aucun`).click();
  await capture(page, '02-administration-permission-tsuzuku');
  await pause(1000);
  await page.getByTestId('retour-hub').click();
  await page.getByTestId('hub').waitFor({ timeout: 20_000 });

  // ============================================================ Tsuzuku : Animés (mode site)
  log('Tsuzuku : Animés, mode site');
  await desactiverPontPc();
  await ouvrirTsuzuku(page);
  verifier(await visible(page, 'rangee-trending', 30_000), 'l’accueil Animés montre les rangées du catalogue (AniList simulé)');
  verifier(await page.getByTestId('tsuzuku-site').isVisible(), 'sur le site : « Lecture des sources disponible sur l’app PC/iPhone ; sur le site, bientôt »');
  verifier((await page.locator('[data-testid^="carte-anime-"] img').count()) > 0, 'les affiches se chargent');
  await capture(page, '03-animes-accueil-site');

  await page.getByTestId('accueil-recherche').fill('Frieren');
  await page.getByTestId('accueil-chercher').click();
  await page.getByTestId('catalogue-grille').waitFor({ timeout: 20_000 });
  verifier((await page.locator('[data-testid^="carte-anime-"]').count()) === 1, 'la recherche « Frieren » (Jikan simulé) ne rend qu’un résultat');
  await capture(page, '04-animes-recherche');
  await page.getByTestId('carte-anime-1').click();
  await page.getByTestId('fiche-titre').waitFor({ timeout: 20_000 });
  verifier(await visible(page, 'episode-3'), 'la fiche liste les épisodes');
  verifier(await page.getByTestId('liens-legaux').isVisible(), 'les plateformes légales du catalogue sont proposées comme simples liens');
  await capture(page, '05-animes-fiche');

  // Lecture sans source ni lien : message clair.
  await page.getByTestId('fiche-lire').click();
  verifier(await visible(page, 'lecteur-message'), 'sans source ni lien, le lecteur explique quoi faire');
  await capture(page, '06-animes-lecteur-sans-source');
  await page.getByTestId('lecteur-vers-fiche').click();

  // Lien manuel : motif {n} pour l'épisode et les suivants.
  await page.getByTestId('lien-anime-ouvrir').click();
  await page.getByTestId('lien-anime-adresse').fill('https://lecteur-exemple.fr/embed/frieren-ep-1');
  await page.getByTestId('lien-anime-episode').fill('1');
  await page.getByTestId('lien-anime-analyser').click();
  const motif = await page.getByTestId('lien-anime-motif').inputValue();
  verifier(motif === 'https://lecteur-exemple.fr/embed/frieren-ep-{n}', `le motif {n} est déduit (${motif})`);
  verifier((await page.getByTestId('apercu-2').innerText()).includes('frieren-ep-2'), 'l’aperçu montre l’épisode suivant');
  await capture(page, '07-animes-lien-manuel');
  await page.getByTestId('lien-anime-enregistrer').click();
  await page.getByTestId('lien-anime-resume').waitFor({ timeout: 10_000 });
  await page.getByTestId('fiche-lire').click();
  await page.getByTestId('lecteur-iframe').waitFor({ timeout: 20_000 });
  const cadre = page.frameLocator('[data-testid="lecteur-iframe"]');
  verifier(await cadre.getByText('Lecteur neutre (/embed/frieren-ep-1)').waitFor({ timeout: 10_000 }).then(() => true, () => false), 'le lecteur (iframe) affiche l’épisode 1 par le lien manuel');
  verifier((await page.getByTestId('lecteur-iframe').getAttribute('sandbox')) === 'allow-scripts allow-same-origin allow-presentation allow-forms', 'l’iframe est cloisonné (sandbox sans navigation du parent ni fenêtres)');
  await capture(page, '08-animes-lecteur');
  await page.getByTestId('lecteur-suivant').click();
  verifier(await cadre.getByText('Lecteur neutre (/embed/frieren-ep-2)').waitFor({ timeout: 10_000 }).then(() => true, () => false), 'l’épisode suivant s’enchaîne avec le motif');
  await page.getByTestId('lecteur-retour').click();

  // Vu ailleurs sur un autre animé.
  await page.getByTestId('onglet-app-accueil').click();
  await page.getByTestId('carte-anime-2').first().click();
  await page.getByTestId('fiche-titre').waitFor({ timeout: 20_000 });
  await page.getByTestId('vu-ailleurs-ouvrir').click();
  await page.getByTestId('vu-ailleurs-note').fill('9');
  await page.getByTestId('vu-ailleurs-commentaire').fill('Vu chez des amis');
  await capture(page, '09-animes-vu-ailleurs');
  await page.getByTestId('vu-ailleurs-enregistrer').click();
  verifier(await page.getByTestId('fiche-statut').filter({ hasText: 'Vu ailleurs' }).waitFor({ timeout: 10_000 }).then(() => true, () => false), 'le titre passe à « Vu ailleurs »');

  // Bibliothèque.
  await page.getByTestId('onglet-app-bibliotheque').click();
  await page.getByTestId('bibliotheque-stats').waitFor({ timeout: 10_000 });
  await page.getByTestId('onglet-vu_ailleurs').click();
  verifier(await page.getByTestId('carte-anime-2').isVisible(), 'l’onglet « Vu ailleurs » contient le titre');
  await page.getByTestId('onglet-en_cours').click();
  verifier(await page.getByTestId('carte-anime-1').isVisible(), 'l’onglet « En cours » contient Frieren (épisode 2)');
  await capture(page, '10-animes-bibliotheque');

  // Retour au hub : la tuile est à jour.
  await retourHub(page);
  const texteTuile = await tuile(page, 'tsuzuku').innerText();
  verifier(/Reprendre Frieren · Ép\. 3/.test(texteTuile), `la tuile Tsuzuku est à jour (« ${texteTuile.replace(/\s+/g, ' ').slice(0, 90)} »)`);
  await pause(1500);
  await capture(page, '11-hub-tuile-a-jour');

  // ============================================================ Films : lien direct, lecture
  log('Tsuzuku : Films, mode site');
  await ouvrirTsuzuku(page);
  await page.getByTestId('mode-movie').click();
  verifier(await visible(page, 'tsuzuku-accueil'), 'mode Films');
  await page.getByText(/Sans clé TMDB/).waitFor({ timeout: 20_000 });
  await capture(page, '12-films-accueil-jikan');
  await page.locator('[data-testid^="carte-movie-"]').first().click();
  await page.getByTestId('tsuzuku-fiche-film').waitFor({ timeout: 20_000 });
  await page.getByTestId('lien-film-ouvrir').click();
  await page.getByTestId('lien-film-adresse').fill('https://lecteur-exemple.fr/embed/film-neutre');
  await page.getByTestId('lien-film-nom').fill('Ma copie');
  await page.getByTestId('lien-film-enregistrer').click();
  await page.getByTestId('lien-film-resume').waitFor({ timeout: 10_000 });
  await capture(page, '13-films-fiche-lien-direct');
  await page.getByTestId('fiche-lire').click();
  await page.getByTestId('lecteur-iframe').waitFor({ timeout: 20_000 });
  verifier(await page.frameLocator('[data-testid="lecteur-iframe"]').getByText('Lecteur neutre (/embed/film-neutre)').waitFor({ timeout: 10_000 }).then(() => true, () => false), 'le film se lit par son lien direct');
  await page.getByTestId('lecteur-marquer-vu').click();
  await capture(page, '14-films-lecteur');
  await page.getByTestId('lecteur-retour').click();
  await page.getByTestId('fiche-statut').filter({ hasText: 'Vu' }).waitFor({ timeout: 10_000 });

  // ============================================================ Paramètres › Tsuzuku (clé TMDB)
  log('Paramètres › Tsuzuku : clé TMDB');
  await page.getByTestId('tsuzuku-reglages').click();
  await page.getByTestId('hub-parametres').waitFor({ timeout: 20_000 });
  verifier(await page.getByTestId('parametres-section-tsuzuku').isVisible(), 'la page Paramètres a une section Tsuzuku');
  await page.getByTestId('parametres-section-tsuzuku').click();
  verifier((await page.getByTestId('reglage-tsuzuku-tmdb').count()) === 1 && (await page.getByTestId('reglage-tsuzuku-lecture').count()) === 1, 'clé TMDB et lecture : dans la page unifiée (pas d’écran de réglages séparé)');
  await page.getByTestId('tsuzuku-cle-tmdb').fill('cle-tmdb-de-test-0123456789');
  await page.getByTestId('tsuzuku-cle-enregistrer').click();
  verifier((await page.getByTestId('tsuzuku-cle-etat').innerText()).includes('Clé enregistrée'), 'la clé est enregistrée (dans la base du profil)');
  await page.getByTestId('tsuzuku-langue-vf').click();
  await page.getByTestId('tsuzuku-masquer-oui').click();
  await capture(page, '15-parametres-tsuzuku');
  await page.getByTestId('hub-parametres-fermer').click();
  await page.getByTestId('tsuzuku-racine').waitFor({ timeout: 20_000 });
  await page.getByTestId('onglet-app-accueil').click();
  await page.getByTestId('rangee-tendances').waitFor({ timeout: 20_000 });
  verifier((await page.getByText(/Sans clé TMDB/).count()) === 0, 'avec la clé, les films viennent de TMDB (plus d’avertissement Jikan)');
  verifier(await page.getByTestId('carte-movie-tmdb-1001').first().isVisible(), 'le catalogue TMDB simulé est affiché');
  await capture(page, '16-films-accueil-tmdb');
  // « Masquer les déjà vus » : Dandadan (vu ailleurs) disparaît du catalogue des animés, Frieren (en cours) reste.
  await page.getByTestId('mode-anime').click();
  await page.getByTestId('rangee-trending').waitFor({ timeout: 20_000 });
  verifier((await page.getByTestId('carte-anime-2').count()) === 0 && (await page.getByTestId('carte-anime-1').count()) > 0, 'réglage « masquer les déjà vus » : le titre vu ailleurs disparaît du catalogue');
  await page.getByTestId('tsuzuku-reglages').click();
  await page.getByTestId('parametres-section-tsuzuku').click();
  await page.getByTestId('tsuzuku-masquer-non').click();
  await page.getByTestId('hub-parametres-fermer').click();
  await page.getByTestId('tsuzuku-racine').waitFor({ timeout: 20_000 });

  // ============================================================ Mode PC : sources et garde
  log('Mode PC (pont Electron simulé, vraie garde du processus principal)');
  await retourHub(page);
  await activerPontPc();
  await ouvrirTsuzuku(page);
  verifier((await page.getByTestId('tsuzuku-site').count()) === 0, 'mode PC : plus de bandeau « site »');
  await page.getByTestId('onglet-app-sources').click();
  verifier(await visible(page, 'sources-vide'), 'les sources sont VIDES par défaut');
  await page.getByTestId('source-ajouter').click();
  await page.getByTestId('source-nom').fill('Ma médiathèque (neutre)');
  await page.getByTestId('source-adresse').fill('https://mediatheque-exemple.fr');
  await page.getByTestId('source-langue-vostfr').click();
  const champ = (chemin, valeur) => page.getByTestId(`source-champ-${chemin}`).fill(valeur);
  await champ('search.path', '/recherche?q={query}');
  await champ('search.item', 'ul.resultats li');
  await champ('search.title', 'a.titre');
  await champ('search.link', 'a.titre');
  await champ('episodes.item', 'ol.episodes li');
  await champ('episodes.number', '.num');
  await champ('episodes.link', 'a');
  await champ('player.iframe', 'div.lecteur iframe');
  await capture(page, '17-sources-formulaire');
  await page.getByTestId('source-enregistrer').click();
  await pause(800);
  if (await page.getByTestId('sources-erreur').count()) log('erreur source :', await page.getByTestId('sources-erreur').innerText());
  await page.getByText('Ma médiathèque (neutre)', { exact: true }).first().waitFor({ timeout: 10_000 });
  await page.getByTestId('sources-titre-test').fill('Dandadan');
  await page.locator('[data-testid^="source-tester-"]').first().click();
  verifier(await page.getByText(/1 resultat\(s\) sur 1 bloc\(s\)/).waitFor({ timeout: 15_000 }).then(() => true, () => false), 'le test de la source trouve « Dandadan » (page neutre lue via le pont, garde du principal)');
  await capture(page, '18-sources-test');

  // Une source vers le réseau local est refusée dès la saisie.
  await page.getByTestId('source-ajouter').click();
  await page.getByTestId('source-nom').fill('Maison');
  await page.getByTestId('source-adresse').fill('http://192.168.1.10');
  await page.getByTestId('source-enregistrer').click();
  verifier(await visible(page, 'sources-erreur'), 'une source visant le réseau local est refusée');
  await page.getByTestId('source-annuler').click();

  // Garde côté principal, directement : le pont refuse ce que le moteur aurait dû refuser.
  const refus = await page.evaluate(async () => {
    const sortie = [];
    for (const url of ['http://192.168.1.1/', 'http://127.0.0.1:5199/', 'http://localhost/', 'https://exemple.fr:22/', 'file:///etc/passwd']) {
      try {
        await globalThis.applibourse.tsuzuku.requete({ url, methode: 'GET', entetes: {}, delaiMs: 3000, tailleMax: 100000 });
        sortie.push(`${url} : ACCEPTÉE`);
      } catch (e) {
        sortie.push('refus');
      }
    }
    return sortie;
  });
  verifier(refus.every(r => r === 'refus'), `le pont refuse le réseau local, localhost, un port exotique et file: (${refus.join(', ')})`);

  // Lecture d'un épisode par la source.
  await page.getByTestId('onglet-app-accueil').click();
  await page.getByTestId('accueil-recherche').fill('Dandadan');
  await page.getByTestId('accueil-chercher').click();
  await page.getByTestId('carte-anime-2').first().click();
  await page.getByTestId('fiche-titre').waitFor({ timeout: 20_000 });
  await page.getByTestId('episode-4').click();
  await page.getByTestId('lecteur-iframe').waitFor({ timeout: 30_000 });
  verifier(await page.frameLocator('[data-testid="lecteur-iframe"]').getByText('Lecteur neutre (/embed/2-4)').waitFor({ timeout: 10_000 }).then(() => true, () => false), 'l’épisode 4 est trouvé par la source (recherche → série → épisode → lecteur)');
  await capture(page, '19-animes-lecteur-par-source');

  // ============================================================ 390 px
  log('390 px');
  await page.setViewportSize({ width: 390, height: 844 });
  await pause(500);
  for (const [nom, action] of [
    ['lecteur', async () => undefined],
    ['fiche', async () => page.getByTestId('lecteur-retour').click()],
    ['accueil', async () => { await page.getByTestId('fiche-retour').click(); }],
    ['bibliotheque', async () => page.getByTestId('onglet-app-bibliotheque').click()],
    ['sources', async () => page.getByTestId('onglet-app-sources').click()],
  ]) {
    await action();
    await pause(700);
    verifier((await debordement(page)) <= 0, `390 px, ${nom} : pas de défilement horizontal de la page`);
    await capture(page, `20-390px-${nom}`);
  }
  await page.getByTestId('onglet-app-accueil').click();
  await page.getByTestId('mode-movie').click();
  await pause(1500);
  verifier((await debordement(page)) <= 0, '390 px, films : pas de défilement horizontal');
  await capture(page, '21-390px-films');
  await page.setViewportSize({ width: 1100, height: 820 });

  // ============================================================ Trois thèmes
  log('Trois thèmes');
  for (const theme of ['ivoire', 'sauge', 'terminal']) {
    await page.getByTestId('tsuzuku-reglages').click();
    await page.getByTestId('hub-parametres').waitFor({ timeout: 20_000 });
    await page.getByTestId('parametres-section-general').click();
    await page.getByTestId(`parametres-theme-${theme}`).click();
    await page.getByTestId('hub-parametres-fermer').click();
    await page.getByTestId('tsuzuku-racine').waitFor({ timeout: 20_000 });
    await page.getByTestId('mode-anime').click();
    await page.getByTestId('rangee-trending').waitFor({ timeout: 20_000 });
    await pause(400);
    await capture(page, `22-theme-${theme}-animes`);
    await page.getByTestId('mode-movie').click();
    await page.getByTestId('tsuzuku-accueil').waitFor({ timeout: 20_000 });
    await page.getByTestId('rangee-tendances').waitFor({ timeout: 20_000 });
    await pause(400);
    await capture(page, `23-theme-${theme}-films`);
    verifier(true, `thème ${theme} : Animés et Films capturés`);
  }
  await retourHub(page);

  // ============================================================ Amis : sans permission, pas de tuile
  log('Amis');
  await page.getByTestId('parametres-verrouiller').count();
  async function seConnecter(prenom, identifiants) {
    await page.reload();
    await page.getByTestId('connexion-prenom').waitFor({ timeout: 60_000 });
    await page.getByTestId('connexion-prenom').fill(prenom);
    await page.getByTestId('connexion-continuer').click();
    await page.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 });
    await deverrouiller(page, identifiants.motDePasse, identifiants.secret);
    await fermerDevblog(page);
    await page.getByTestId('hub').waitFor({ timeout: 30_000 });
  }
  await seConnecter('Léa', lea);
  verifier((await tuile(page, 'tsuzuku').count()) === 0, 'Léa, sans permission « tsuzuku », ne voit pas la tuile Tsuzuku');
  verifier(await tuile(page, 'portefeuille').isVisible().catch(() => false), 'Léa voit toujours le portefeuille');
  await pause(1500);
  await capture(page, '24-ami-sans-tuile');
  await seConnecter('Hugo', hugo);
  verifier(await tuile(page, 'tsuzuku').isVisible(), 'Hugo, avec la permission, voit la tuile Tsuzuku');
  await ouvrirTsuzuku(page);
  verifier((await page.getByText(/Reprendre/).count()) === 0, 'la bibliothèque de Hugo est vide : rien de celle de l’administrateur (profils isolés)');
  await page.getByTestId('onglet-app-bibliotheque').click();
  verifier(await page.getByText('Votre bibliothèque est vide', { exact: false }).isVisible().catch(() => false), 'Hugo voit une bibliothèque vide');
  verifier((await page.getByTestId('bibliotheque-importer').count()) === 0, 'Hugo n’a pas l’import (réservé à l’administrateur)');
  await page.getByTestId('onglet-app-sources').click();
  verifier(await visible(page, 'tsuzuku-sources-interdit'), 'Hugo voit les sources en lecture seule (gérées par l’administrateur)');
  await capture(page, '25-ami-avec-tuile-sources');
  await page.keyboard.press('Escape');
  verifier(await visible(page, 'hub'), 'Échap ramène au hub depuis Tsuzuku');

  // ============================================================ Présence : verrouillage automatique pendant une lecture
  log('Présence pendant une lecture');
  await seConnecter('admin', { motDePasse: MDP_ADMIN, secret: secretAdmin });
  await activerPontPc();
  await ouvrirTsuzuku(page);
  await page.getByTestId('onglet-app-accueil').click();
  await page.getByTestId('accueil-recherche').fill('Dandadan');
  await page.getByTestId('accueil-chercher').click();
  await page.getByTestId('carte-anime-2').first().click();
  await page.getByTestId('fiche-titre').waitFor({ timeout: 20_000 });
  await page.getByTestId('episode-4').click();
  await page.getByTestId('lecteur-iframe').waitFor({ timeout: 30_000 });
  // Délai d'essai court (4 s) et 8 s pour répondre : posés comme le ferait un autre onglet (évènement storage).
  const reglerEssai = (ms, secondes) =>
    page.evaluate(([delai, presence]) => {
      localStorage.setItem('appdashboard.verrou-auto-essai-ms', String(delai));
      localStorage.setItem('appdashboard.presence-essai-s', String(presence));
      window.dispatchEvent(new StorageEvent('storage', { key: 'appdashboard.verrou-auto-essai-ms' }));
    }, [ms, secondes]);
  await reglerEssai(4000, 8);
  const dialogue = await page.getByTestId('presence-dialogue').waitFor({ timeout: 12_000 }).then(() => true, () => false);
  verifier(dialogue, 'pendant la lecture, « Êtes-vous toujours là ? » s’affiche au lieu de verrouiller');
  verifier((await page.getByTestId('bouton-deverrouiller').count()) === 0, 'l’application n’est pas verrouillée tant que le compte à rebours court');
  await capture(page, '26-presence-etes-vous-toujours-la');
  await page.getByTestId('presence-suis-la').click();
  verifier(await page.getByTestId('presence-dialogue').waitFor({ state: 'detached', timeout: 5_000 }).then(() => true, () => false), '« Je suis là » ferme le dialogue');
  verifier(await visible(page, 'lecteur-iframe'), 'la lecture continue après « Je suis là »');
  const encore = await page.getByTestId('presence-dialogue').waitFor({ timeout: 12_000 }).then(() => true, () => false);
  verifier(encore, 'le dialogue revient après un nouveau délai sans geste');
  const verrouille = await page.getByTestId('bouton-deverrouiller').waitFor({ timeout: 14_000 }).then(() => true, () => false);
  verifier(verrouille, 'sans réponse pendant le compte à rebours, l’application se verrouille');
  verifier(/toujours là/.test(await page.getByTestId('message-deverrouillage').innerText().catch(() => '')), 'l’écran de connexion dit pourquoi');
  await capture(page, '27-verrouille-sans-reponse-presence');

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
