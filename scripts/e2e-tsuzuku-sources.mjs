/**
 * E2E : page « Sources » de Tsuzuku et assistant guidé (navigateur Chromium, internet simulé).
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-tsuzuku-sources.mjs
 *
 * Un « internet » local remplace Jikan, AniList, les images, une médiathèque NEUTRE
 * (mediatheque-exemple.fr : recherche → série → épisode) et un lecteur neutre ; le pont
 * Electron est simulé par le VRAI module `bureau/electron/tsuzuku.mjs` (garde anti-SSRF), dont
 * seul le transport est détourné vers l'internet local. La « réponse de l'IA » est simulée (JSON
 * collé), d'abord fautive puis corrigée.
 *
 * Parcours (PC 1100 px, puis émulation iPhone 390 × 844) : Tsuzuku sans source (carte vide +
 * bouton) → Sources → Ajouter → assistant (4 étapes) → test → enregistrement → la source apparaît ;
 * export ; un ami ne voit ni l'onglet ni la page. Captures : docs/captures-tsuzuku-sources/.
 *
 * Variables : PLAYWRIGHT_PATH (dossier de node_modules contenant playwright), CAPTURES.
 */

import { createHmac } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { allerPageAdministration, allerPageApplications, nouveauContexte } from './e2e-acceptation.mjs';

const racine = fileURLToPath(new URL('..', import.meta.url));
const requireGlobal = createRequire(join(process.env.PLAYWRIGHT_PATH ?? '/opt/node22/lib/node_modules', 'x.js'));
const { chromium } = requireGlobal('playwright');
const { requeteTsuzuku } = await import(pathToFileURL(join(racine, 'bureau/electron/tsuzuku.mjs')).href);

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-tsuzuku-sources');
mkdirSync(CAPTURES, { recursive: true });
const PORT_SITE = 5197;
const PORT_INTERNET = 5196;
const MDP_ADMIN = 'mot-de-passe-du-pc-e2e-sources-42';

// ------------------------------------------------------------- Internet local (par nom d'hôte)
const ANIMES = [[1, 'Frieren', 2023], [2, 'Dandadan', 2024], [3, 'One Piece', 1999], [4, 'Spy x Family', 2022]];
const img = id => `https://img-exemple.fr/${id}.jpg`;
const jikanAnime = ([id, titre, annee]) => ({
  mal_id: id, title: titre, title_english: titre, title_japanese: titre, synopsis: `Synopsis de ${titre} : une histoire neutre pour les besoins du test.`,
  images: { jpg: { large_image_url: img(id), image_url: img(id) } }, episodes: 12, status: 'Currently Airing', score: 8.4, year: annee, type: 'TV',
  genres: [{ name: 'Aventure' }], studios: [{ name: 'Studio Exemple' }], streaming: [],
});
const media = ([id, titre, annee]) => ({
  id, idMal: id, title: { romaji: titre, english: titre, native: titre }, description: `Synopsis de ${titre}`, episodes: 12, status: 'RELEASING', format: 'TV', seasonYear: annee,
  averageScore: 84, popularity: 100, genres: ['Aventure'], coverImage: { extraLarge: img(id) }, studios: { nodes: [] }, externalLinks: [],
});
const j = (o, statut = 200) => ({ statut, type: 'application/json', corps: JSON.stringify(o) });
const page = corps => ({ statut: 200, type: 'text/html', corps: `<!doctype html><html><head><title>Médiathèque exemple</title></head><body>${corps}</body></html>` });

function repondre(hote, chemin) {
  const url = new URL(chemin, 'https://x');
  const p = url.pathname;
  if (hote === 'api.jikan.moe') {
    if (/\/anime\/(\d+)\/full/.test(p)) {
      const a = ANIMES.find(x => x[0] === Number(/\/anime\/(\d+)\/full/.exec(p)[1]));
      return a ? j({ data: jikanAnime(a) }) : j({}, 404);
    }
    if (/\/anime\/\d+\/episodes/.test(p)) return j({ data: Array.from({ length: 12 }, (_, i) => ({ mal_id: i + 1, title: `Épisode ${i + 1}` })), pagination: { last_visible_page: 1 } });
    if (p === '/v4/genres/anime') return j({ data: [{ mal_id: 1, name: 'Action' }] });
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const liste = ANIMES.map(jikanAnime);
    return j({ data: q ? liste.filter(a => a.title.toLowerCase().includes(q)) : liste, pagination: { current_page: 1, has_next_page: false, last_visible_page: 1 } });
  }
  if (hote === 'graphql.anilist.co') {
    const m = ANIMES.map(media);
    return j({ data: { trending: { media: m }, popular: { media: m.slice(1) }, airing: { media: [] }, topRated: { media: [] }, movies: { media: [] } } });
  }
  if (hote === 'img-exemple.fr') {
    const id = Number(/(\d+)/.exec(p)?.[1] ?? 0);
    const teinte = (id * 47) % 360;
    return { statut: 200, type: 'image/svg+xml', corps: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="435"><rect width="300" height="435" fill="hsl(${teinte},60%,40%)"/><text x="150" y="240" font-size="90" text-anchor="middle" fill="white" font-family="sans-serif">${id}</text></svg>` };
  }
  if (hote === 'lecteur-exemple.fr') return { statut: 200, type: 'text/html', corps: `<!doctype html><body style="margin:0;background:#111;color:#eee;font:24px sans-serif;display:grid;place-items:center;height:100vh">Lecteur neutre (${p})</body>` };
  if (hote === 'mediatheque-exemple.fr') {
    if (p === '/recherche' || p === '/') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const trouve = ANIMES.filter(a => a[1].toLowerCase().includes(q));
      return page(`<form class="recherche" action="/recherche"><input name="q"></form><ul class="resultats">${trouve.map(a => `<li class="carte"><a class="titre" href="/serie/${a[0]}">${a[1]}</a></li>`).join('')}</ul>`);
    }
    const serie = /^\/serie\/(\d+)$/.exec(p);
    if (serie) return page(`<ol class="episodes">${Array.from({ length: 12 }, (_, i) => `<li class="ep"><span class="num">${i + 1}</span><a href="/serie/${serie[1]}/ep/${i + 1}">Épisode ${i + 1}</a></li>`).join('')}</ol>`);
    const ep = /^\/serie\/(\d+)\/ep\/(\d+)$/.exec(p);
    if (ep) return page(`<div class="lecteur"><iframe src="https://lecteur-exemple.fr/embed/${ep[1]}-${ep[2]}"></iframe></div>`);
  }
  return { statut: 404, type: 'text/plain', corps: 'introuvable' };
}
const HOTES = ['api.jikan.moe', 'graphql.anilist.co', 'img-exemple.fr', 'lecteur-exemple.fr', 'mediatheque-exemple.fr'];
const serveurInternet = http.createServer((req, res) => {
  const r = repondre(String(req.headers.host ?? '').split(':')[0], req.url);
  res.writeHead(r.statut, { 'Content-Type': r.type, 'Access-Control-Allow-Origin': '*' });
  res.end(r.corps);
});
await new Promise(ok => serveurInternet.listen(PORT_INTERNET, '127.0.0.1', ok));
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

// ------------------------------------------------------------- TOTP et outils
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
const tuile = (pg, id) => pg.locator(`[data-testid="cellule-${id}"], [data-testid="tuile-${id}"]`).first();
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

async function creerAmi(pg, nom) {
  await pg.getByTestId('admin-onglet-utilisateurs').click();
  await pg.getByTestId('admin-nouveau').click();
  await pg.getByTestId('admin-nom').fill(nom);
  await pg.getByTestId('admin-nouveau-informe').click();
  await pg.getByTestId('admin-creer').click();
  await pg.getByTestId('admin-identifiants').waitFor({ timeout: 60_000 });
  const motDePasse = (await pg.getByTestId('admin-mot-de-passe').innerText()).replace(/^\s*Mot de passe\s*/, '').trim();
  const secret = (await pg.getByTestId('admin-secret-totp').innerText()).replace(/^\s*Clé TOTP\s*/, '').replace(/\s+/g, '');
  await pg.getByTestId('admin-transmis').click().catch(() => undefined);
  await pg.getByTestId('admin-termine').click();
  return { motDePasse, secret };
}
async function ouvrirTsuzuku(pg) {
  await allerPageApplications(pg);
  await tuile(pg, 'tsuzuku').click();
  await pg.getByTestId('tsuzuku-racine').waitFor({ timeout: 20_000 });
}

// « Réponses de l'IA » simulées : une fautive (virgule en trop), puis la bonne.
const JSON_IA = {
  name: 'Médiathèque exemple',
  baseUrl: 'https://mediatheque-exemple.fr',
  language: 'vostfr',
  search: { path: '/recherche?q={query}', pathVf: '', pathVostfr: '', item: 'ul.resultats li.carte', title: 'a.titre', link: 'a.titre', image: '', imageAttr: 'src', year: '' },
  episodes: { item: 'ol.episodes li.ep', number: '.num', title: '', link: 'a' },
  player: { iframe: 'div.lecteur iframe', attr: 'src', label: 'Lecteur', options: '', optionAttr: 'value', optionLabel: '' },
  movies: { search: { path: '', item: '' }, player: { iframe: '' } },
};
const REPONSE_FAUTIVE = '```json\n{\n  "name": "Médiathèque exemple",\n  "baseUrl": "https://mediatheque-exemple.fr",,\n  "search": { "path": "/recherche", "item": "ul.resultats li.carte" }\n}\n```';
const REPONSE_IA = (nom = JSON_IA.name) => '```json\n' + JSON.stringify({ ...JSON_IA, name: nom }, null, 2) + '\n```';

/** Parcours complet de l'assistant (4 étapes) ; `prefixe` : nom des captures. */
async function assistant(pg, prefixe, nom, partage) {
  await pg.getByTestId('sources-ajouter').click();
  verifier(await visible(pg, 'sources-choix-ajout'), `${prefixe} : « + Ajouter une source » propose l’assistant (recommandé) et le JSON`);
  await capture(pg, `${prefixe}-a-choix-ajout`);
  await pg.getByTestId('sources-assistant').click();
  // Étape 1
  verifier((await pg.getByTestId('assistant-etape-1').getAttribute('aria-selected')) === 'true' || (await visible(pg, 'assistant-etape-adresse')), `${prefixe} : étape 1 (adresse du site)`);
  await pg.getByTestId('assistant-adresse').fill('http://192.168.1.10/');
  await pg.getByTestId('assistant-analyser').click();
  verifier((await pg.getByTestId('assistant-erreur').innerText()).includes('Adresse refusée'), `${prefixe} : une adresse du réseau local est refusée avant toute requête`);
  await pg.getByTestId('assistant-adresse').fill('https://mediatheque-exemple.fr/recherche?q=a');
  await pg.getByTestId('assistant-cible-animes').click();
  await capture(pg, `${prefixe}-b-etape1-adresse`);
  await pg.getByTestId('assistant-analyser').click();
  // Étape 2
  await pg.getByTestId('assistant-prompt').waitFor({ timeout: 20_000 });
  const prompt = await pg.getByTestId('assistant-prompt').inputValue();
  verifier(['"search"', '"episodes"', '"player"', '"movies"', '"pathVf"', '"number"', '"iframe"', '"attr"', '"label"', '{query}', 'AU MOINS 2 exemples', 'Ne renvoie QUE le JSON', 'li.carte ×', '```html'].every(x => prompt.includes(x)), `${prefixe} : le prompt contient tout le format, un exemple, les règles et l’extrait analysé`);
  verifier(await visible(pg, 'assistant-ouvrir-chatgpt') && await visible(pg, 'assistant-ouvrir-claude') && await visible(pg, 'assistant-copier'), `${prefixe} : « Copier le prompt », « Ouvrir ChatGPT / Claude »`);
  await capture(pg, `${prefixe}-c-etape2-prompt`);
  await pg.getByTestId('assistant-suivant').click();
  // Étape 3 : réponse fautive, erreurs ligne par ligne, réparation, puis bonne réponse.
  await pg.getByTestId('assistant-json').fill(REPONSE_FAUTIVE);
  await pg.getByTestId('assistant-verifier').click();
  verifier(/Ligne 4, colonne/.test(await pg.getByTestId('assistant-invalide').innerText()), `${prefixe} : JSON fautif : erreur située (ligne, colonne)`);
  await pg.getByTestId('assistant-reparer').click();
  verifier((await pg.getByTestId('assistant-prompt-reparation').inputValue()).includes('Ligne 4, colonne'), `${prefixe} : « Réparer avec l’IA » prépare un prompt de correction contenant l’erreur`);
  await capture(pg, `${prefixe}-d-etape3-erreur-reparer`);
  await pg.getByTestId('assistant-json').fill(REPONSE_IA(nom));
  await pg.getByTestId('assistant-verifier').click();
  verifier(await visible(pg, 'assistant-valide'), `${prefixe} : la réponse corrigée est conforme au schéma du moteur`);
  await capture(pg, `${prefixe}-e-etape3-valide`);
  await pg.getByTestId('assistant-suivant').click();
  // Étape 4 : test pas à pas puis enregistrement.
  await pg.getByTestId('assistant-titre-test').fill('Dandadan');
  await pg.getByTestId('assistant-tester').click();
  await pg.getByTestId('assistant-test-bilan').waitFor({ timeout: 30_000 });
  const ok = ['recherche', 'episodes', 'lecteur'].map(c => pg.getByTestId(`assistant-test-${c}-ok`).count());
  verifier((await Promise.all(ok)).every(n => n === 1), `${prefixe} : test pas à pas OK (recherche → épisodes → lecteur, pages lues via le pont et sa garde)`);
  if (partage) await pg.getByTestId(`assistant-partage-${partage}`).click();
  await voir(pg, 'assistant-enregistrer');
  await capture(pg, `${prefixe}-f-etape4-test`);
  await pg.getByTestId('assistant-enregistrer').click();
  verifier(await visible(pg, 'source-nouvelle'), `${prefixe} : retour à la liste, la source ajoutée en évidence`);
  verifier(await pg.getByText(nom, { exact: true }).first().isVisible(), `${prefixe} : « ${nom} » apparaît dans la liste`);
  await pg.getByTestId('tsuzuku-sources').first().scrollIntoViewIfNeeded();
  await pg.evaluate(() => window.scrollTo(0, 0));
  await capture(pg, `${prefixe}-g-source-ajoutee`);
}

const navigateur = await chromium.launch({ headless: true });
try {
  const contexte = await nouveauContexte(navigateur, { viewport: { width: 1100, height: 820 }, acceptDownloads: true });
  await contexte.route(url => HOTES.includes(url.hostname), async route => {
    const url = new URL(route.request().url());
    const r = repondre(url.hostname, url.pathname + url.search);
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

  // ============================================================ Coffre du Fondateur, un ami
  log('Coffre du Fondateur et un ami (Hugo, accès à Tsuzuku)');
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
  await allerPageAdministration(pg);
  await tuile(pg, 'administration').click();
  await pg.getByTestId('app-administration').waitFor({ timeout: 20_000 });
  const hugo = await creerAmi(pg, 'Hugo');
  await pg.getByTestId('retour-hub').click();
  await pg.getByTestId('hub').waitFor({ timeout: 20_000 });

  // ============================================================ Site web : l'assistant propose de coller le HTML
  log('Site web (sans pont) : coller le HTML ou prompt sans extrait');
  await ouvrirTsuzuku(pg);
  await pg.getByTestId('onglet-app-sources').click();
  await pg.getByTestId('sources-ajouter').click();
  await pg.getByTestId('sources-assistant').click();
  verifier(await visible(pg, 'assistant-site') && await visible(pg, 'assistant-html') && await visible(pg, 'assistant-sans-extrait'), 'site web : coller le code HTML de la page, ou prompt sans extrait (CORS expliqué)');
  await pg.getByTestId('assistant-adresse').fill('https://mediatheque-exemple.fr/');
  await pg.getByTestId('assistant-sans-extrait').click();
  verifier(/analyse toi-même le site/.test(await pg.getByTestId('assistant-prompt').inputValue()), 'site web : le prompt sans extrait demande à l’IA d’analyser elle-même le site');
  await capture(pg, '00-site-web-prompt-sans-extrait');
  await pg.getByTestId('assistant-fermer').click();
  await pg.getByTestId('retour-hub').click();
  await pg.getByTestId('hub').waitFor({ timeout: 20_000 });

  // ============================================================ PC : carte vide → Sources → assistant
  log('PC (pont Electron simulé) : Tsuzuku sans source');
  await activerPontPc();
  await ouvrirTsuzuku(pg);
  verifier(await visible(pg, 'tsuzuku-sans-source'), 'accueil : carte « Aucune source configurée »');
  verifier((await pg.getByTestId('tsuzuku-sans-source').innerText()).includes('Tsuzuku a besoin d’au moins une source pour lire des épisodes et des films'), 'la carte explique pourquoi');
  verifier((await pg.getByTestId('onglet-sources-badge').innerText()).trim() === '0', 'onglet « Sources » avec le badge 0');
  await pg.getByTestId('sans-source-aide').click();
  verifier(await visible(pg, 'sans-source-explication'), '« Comment ça marche ? » : explication en 3 lignes');
  await capture(pg, '01-pc-accueil-sans-source');
  await pg.getByTestId('onglet-app-catalogue').click();
  verifier(await visible(pg, 'tsuzuku-sans-source'), 'catalogue : la carte est là aussi');
  await pg.getByTestId('onglet-app-accueil').click();
  await pg.getByTestId('sans-source-assistant').click();
  verifier(await visible(pg, 'assistant-source'), '« Ajouter une source avec l’assistant » ouvre la page Sources, assistant lancé');
  await pg.getByTestId('assistant-fermer').click();
  await pg.getByTestId('sources-aide-ouvrir').click();
  verifier(await visible(pg, 'sources-aide'), 'bouton « ? » : guide court');
  await capture(pg, '02-pc-sources-vide-aide');
  await pg.getByTestId('sources-aide-fermer').click();
  await assistant(pg, '03-pc', 'Médiathèque exemple', 'tous');
  verifier((await pg.getByTestId('onglet-sources-badge').innerText()).trim() === '1', 'badge de l’onglet : 1 source active');
  verifier((await pg.locator('[data-testid^="source-test-"]').first().innerText()).includes('Dernier test : OK'), 'la liste montre le dernier test (OK)');
  verifier((await pg.getByTestId('sources-qui-recoit').innerText()).includes('Hugo : Médiathèque exemple'), 'indicateur du partage : Hugo reçoit la source');
  // Export (sans clé d'API)
  const [telechargement] = await Promise.all([pg.waitForEvent('download', { timeout: 10_000 }).catch(() => null), pg.getByTestId('sources-exporter').click()]);
  let exporte = '';
  if (telechargement) {
    const flux = await telechargement.createReadStream();
    for await (const morceau of flux) exporte += morceau;
  } else if (await pg.getByTestId('sources-export-texte').count()) exporte = await pg.getByTestId('sources-export-texte').inputValue();
  verifier(exporte.includes('"tsuzuku-sources"') && exporte.includes('mediatheque-exemple.fr') && !/cleTmdb|partage/i.test(exporte), 'export JSON des sources, sans clé d’API ni partage');
  await voir(pg, 'sources-sauvegarde');
  await capture(pg, '04-pc-sauvegarde-export');
  // La source sert aussitôt : plus de carte vide, lecture d'un épisode par la source.
  await pg.getByTestId('onglet-app-accueil').click();
  await pg.getByTestId('tsuzuku-accueil').waitFor({ timeout: 20_000 });
  await pause(800);
  verifier((await pg.getByTestId('tsuzuku-sans-source').count()) === 0, 'avec une source active, plus de carte vide');
  await pg.getByTestId('accueil-recherche').fill('Dandadan');
  await pg.getByTestId('accueil-chercher').click();
  await pg.getByTestId('carte-anime-2').first().click();
  await pg.getByTestId('fiche-titre').waitFor({ timeout: 20_000 });
  verifier(await visible(pg, 'fiche-gerer-sources'), 'fiche : « Ajouter/modifier les sources » pour le Fondateur, à côté du lien manuel');
  await pg.getByTestId('episode-4').click();
  verifier(await pg.frameLocator('[data-testid="lecteur-iframe"]').getByText('Lecteur neutre (/embed/2-4)').waitFor({ timeout: 20_000 }).then(() => true, () => false), 'l’épisode 4 se lit par la source ajoutée avec l’assistant');
  await capture(pg, '05-pc-lecture-par-la-source');
  await pg.getByTestId('lecteur-retour').click();

  // ============================================================ Paramètres : la même page
  await pg.getByTestId('tsuzuku-reglages').click();
  await pg.getByTestId('hub-parametres').waitFor({ timeout: 20_000 });
  await pg.getByTestId('parametres-section-administration').click();
  await voir(pg, 'reglage-admin-tsuzuku-sources');
  verifier(await pg.getByText('Médiathèque exemple', { exact: true }).first().isVisible() && (await pg.getByTestId('sources-ajouter').count()) === 1, 'Paramètres › Administration › Tsuzuku · Sources : la même page (liste, + Ajouter, assistant)');
  await capture(pg, '06-pc-parametres-meme-page');
  await pg.getByTestId('hub-parametres-fermer').click();
  await pg.getByTestId('tsuzuku-racine').waitFor({ timeout: 20_000 });

  // ============================================================ Émulation iPhone 390 × 844
  log('Téléphone 390 × 844');
  await pg.setViewportSize({ width: 390, height: 844 });
  await pg.getByTestId('onglet-app-accueil').click();
  await pause(800);
  verifier(await visible(pg, 'onglet-app'), 'téléphone : barre basse de Tsuzuku');
  verifier((await pg.getByTestId('onglet-app-sources').innerText()).includes('Sources'), 'téléphone : « Sources » dans la barre basse, avec sa pastille');
  verifier((await debordement(pg)) <= 0, 'téléphone, accueil : pas de défilement horizontal');
  await capture(pg, '10-tel-accueil-barre-basse');
  await pg.getByTestId('onglet-app-sources').click();
  await pg.getByTestId('tsuzuku-sources').waitFor({ timeout: 20_000 });
  verifier((await debordement(pg)) <= 0, 'téléphone, page Sources : pas de défilement horizontal');
  await capture(pg, '11-tel-sources');
  await assistant(pg, '12-tel', 'Médiathèque (téléphone)');
  verifier((await debordement(pg)) <= 0, 'téléphone, après l’assistant : pas de défilement horizontal');
  verifier((await pg.getByTestId('onglet-app-sources').innerText()).includes('2'), 'téléphone : pastille « 2 » sources actives');
  await pg.setViewportSize({ width: 1100, height: 820 });
  await pg.getByTestId('retour-hub').click();
  await pg.getByTestId('hub').waitFor({ timeout: 20_000 });

  // ============================================================ Ami : ni onglet ni page
  log('Ami (Hugo) : ni onglet « Sources », ni page');
  await pg.reload();
  await pg.getByTestId('connexion-prenom').waitFor({ timeout: 60_000 });
  await pg.getByTestId('connexion-prenom').fill('Hugo');
  await pg.getByTestId('connexion-continuer').click();
  await pg.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 });
  await deverrouiller(pg, hugo.motDePasse, hugo.secret);
  await fermerDevblog(pg);
  await pg.getByTestId('hub').waitFor({ timeout: 30_000 });
  await ouvrirTsuzuku(pg);
  verifier((await pg.getByTestId('onglet-app-sources').count()) === 0, 'Hugo : pas d’onglet « Sources »');
  verifier(await visible(pg, 'sans-source-demander'), 'Hugo sans source : « Demande à l’administrateur d’ajouter des sources »');
  verifier((await pg.getByTestId('sans-source-assistant').count()) === 0 && (await pg.getByTestId('sources-ajouter').count()) === 0, 'Hugo : aucun lien d’édition');
  await capture(pg, '20-ami-pc-sans-source');
  await pg.getByTestId('carte-anime-1').first().click();
  await pg.getByTestId('fiche-titre').waitFor({ timeout: 20_000 });
  verifier((await pg.getByTestId('fiche-gerer-sources').count()) === 0 && (await pg.getByTestId('lien-anime-ouvrir').count()) === 1, 'Hugo, fiche : « coller un lien » oui, « Ajouter/modifier les sources » non');
  await pg.setViewportSize({ width: 390, height: 844 });
  await pg.getByTestId('fiche-retour').click();
  await pause(800);
  verifier((await pg.getByTestId('onglet-app-sources').count()) === 0 && (await visible(pg, 'onglet-app')), 'Hugo, téléphone : barre basse sans « Sources »');
  await capture(pg, '21-ami-tel-sans-source');
  await pg.getByTestId('app-parametres-ouvrir').first().click().catch(() => pg.getByTestId('tsuzuku-reglages').click());
  await pg.getByTestId('hub-parametres').waitFor({ timeout: 20_000 });
  verifier((await pg.getByTestId('reglage-admin-tsuzuku-sources').count()) === 0 && (await pg.getByTestId('tsuzuku-sources').count()) === 0, 'Hugo : pas de page Sources dans Paramètres');

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
