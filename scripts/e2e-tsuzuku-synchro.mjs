/**
 * Bout en bout : documents légaux et Tsuzuku dans le coffre serveur du compte.
 *
 *  1. navigateur A : le Fondateur crée son compte, ACCEPTE les documents légaux (écran « Avant de
 *     commencer », sans aide automatique), passe à la connexion par identifiant ;
 *  2. A : ajoute une source (JSON), un animé à sa bibliothèque, et marque 3 épisodes vus ;
 *  3. navigateur B NEUF : connexion par identifiant + mot de passe. L'écran « Avant de commencer »
 *     n'apparaît JAMAIS (pas même un instant) ; la bibliothèque, la source et la progression sont là.
 *
 * Faux relais : le VRAI worker (relais/worker.mjs) avec le coffre serveur en mémoire. Catalogue
 * (Jikan, AniList) et images simulés. Aucun site réel : *-exemple.fr.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-tsuzuku-synchro.mjs
 *
 * Variables : PLAYWRIGHT_PATH, CAPTURES (défaut docs/captures-tsuzuku-synchro).
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
import { SCRIPT_PC, allerPageApplications, relierCommePc } from './e2e-acceptation.mjs';

const racine = fileURLToPath(new URL('..', import.meta.url));
const requireGlobal = createRequire(join(process.env.PLAYWRIGHT_PATH ?? '/opt/node22/lib/node_modules', 'x.js'));
const { chromium } = requireGlobal('playwright');
const worker = (await import(pathToFileURL(join(racine, 'relais/worker.mjs')).href)).default;
const { coffresMemoire } = await import(pathToFileURL(join(racine, 'relais/coffres.mjs')).href);

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-tsuzuku-synchro');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-tsuzuku-synchro-0123456789';
const PORT_RELAIS = 8873;
const PORT_SITE = 5273;
const RELAIS = `https://localhost:${PORT_RELAIS}`;
const SITE = `http://localhost:${PORT_SITE}/`;
const MDP_PC = 'mot-de-passe-du-pc-e2e-tsuzuku-42';
const MDP_ENZO = 'Ma phrase de connexion Tsuzuku 2026';

// ------------------------------------------------------------- Faux relais (vrai worker, coffre en mémoire)
const kv = new Map();
const metas = new Map();
const coffres = coffresMemoire();
const env = {
  JETON,
  COFFRES: coffres,
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
const dossier = mkdtempSync(join(tmpdir(), 'e2e-tsuzuku-synchro-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dossier, 'k.pem'), '-out', join(dossier, 'c.pem'), '-subj', '/CN=localhost', '-days', '1'], { stdio: 'ignore' });
const serveurRelais = https.createServer({ key: readFileSync(join(dossier, 'k.pem')), cert: readFileSync(join(dossier, 'c.pem')) }, async (req, res) => {
  const morceaux = [];
  for await (const m of req) morceaux.push(m);
  const requete = new Request(`${RELAIS}${req.url}`, { method: req.method, headers: { ...req.headers, 'cf-connecting-ip': '198.51.100.9' }, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(morceaux) });
  const reponse = await worker.fetch(requete, env);
  res.writeHead(reponse.status, Object.fromEntries(reponse.headers));
  res.end(Buffer.from(await reponse.arrayBuffer()));
});
await new Promise(ok => serveurRelais.listen(PORT_RELAIS, ok));

// ------------------------------------------------------------- Site statique (et relais.json)
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const dist = join(racine, 'bureau/dist');
const serveurSite = http.createServer((req, res) => {
  const chemin = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  if (chemin === '/relais.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ relais: RELAIS }));
    return;
  }
  let fichier = join(dist, chemin);
  if (!existsSync(fichier) || statSync(fichier).isDirectory()) fichier = join(dist, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[extname(fichier)] ?? 'application/octet-stream' });
  createReadStream(fichier).pipe(res);
});
await new Promise(ok => serveurSite.listen(PORT_SITE, ok));

// ------------------------------------------------------------- Catalogue simulé (aucun site réel)
const ANIMES = [[1, 'Frieren', 2023], [2, 'Dandadan', 2024]];
const img = id => `https://img-exemple.fr/${id}.jpg`;
const jikanAnime = ([id, titre, annee]) => ({
  mal_id: id, title: titre, title_english: titre, title_japanese: titre, synopsis: `Synopsis de ${titre}.`,
  images: { jpg: { large_image_url: img(id), image_url: img(id) } }, episodes: 12, status: 'Currently Airing', score: 8.4, year: annee, type: 'TV',
  genres: [{ name: 'Aventure' }], studios: [{ name: 'Studio Exemple' }], streaming: [],
});
const media = ([id, titre, annee]) => ({
  id, idMal: id, title: { romaji: titre, english: titre, native: titre }, description: `Synopsis de ${titre}`, episodes: 12, status: 'RELEASING', format: 'TV', seasonYear: annee,
  averageScore: 84, popularity: 100, genres: ['Aventure'], coverImage: { extraLarge: img(id) }, studios: { nodes: [] }, externalLinks: [],
});
const j = (o, statut = 200) => ({ statut, type: 'application/json', corps: JSON.stringify(o) });
function repondre(hote, chemin) {
  const url = new URL(chemin, 'https://x');
  const p = url.pathname;
  if (hote === 'api.jikan.moe') {
    const full = /\/anime\/(\d+)\/full/.exec(p);
    if (full) {
      const a = ANIMES.find(x => x[0] === Number(full[1]));
      return a ? j({ data: jikanAnime(a) }) : j({}, 404);
    }
    if (/\/anime\/\d+\/episodes/.test(p)) return j({ data: Array.from({ length: 12 }, (_, i) => ({ mal_id: i + 1, title: `Épisode ${i + 1}` })), pagination: { last_visible_page: 1 } });
    if (p === '/v4/genres/anime') return j({ data: [{ mal_id: 1, name: 'Action' }] });
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    return j({ data: ANIMES.map(jikanAnime).filter(a => !q || a.title.toLowerCase().includes(q)), pagination: { current_page: 1, has_next_page: false, last_visible_page: 1 } });
  }
  if (hote === 'graphql.anilist.co') {
    const m = ANIMES.map(media);
    return j({ data: { trending: { media: m }, popular: { media: m }, airing: { media: [] }, topRated: { media: [] }, movies: { media: [] } } });
  }
  if (hote === 'img-exemple.fr') return { statut: 200, type: 'image/svg+xml', corps: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="435"><rect width="300" height="435" fill="#456"/></svg>' };
  return { statut: 404, type: 'text/plain', corps: 'introuvable' };
}
const HOTES = ['api.jikan.moe', 'graphql.anilist.co', 'img-exemple.fr', 'mediatheque-exemple.fr', 'lecteur-exemple.fr'];
const SOURCE_JSON = {
  name: 'Médiathèque exemple',
  baseUrl: 'https://mediatheque-exemple.fr',
  language: 'vostfr',
  search: { path: '/recherche?q={query}', item: 'ul.resultats li.carte', title: 'a.titre', link: 'a.titre' },
  episodes: { item: 'ol.episodes li.ep', number: '.num', link: 'a' },
  player: { iframe: 'div.lecteur iframe', attr: 'src' },
};

// ------------------------------------------------------------------- Outils
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
const CODE_PC = 'AB1.' + base64url(JSON.stringify({ r: RELAIS, j: JETON }));
const pause = ms => new Promise(ok => setTimeout(ok, ms));
const log = (...a) => console.log('[e2e]', ...a);
let echecs = 0;
const verifier = (ok, message) => {
  console.log(ok ? '  OK   ' : '  ECHEC', message);
  if (!ok) echecs++;
};
const capture = (page, nom) => page.screenshot({ path: join(CAPTURES, `${nom}.png`) });
const visible = (page, id, delai = 20_000) => page.getByTestId(id).first().waitFor({ timeout: delai }).then(() => true, () => false);
const attendre = async (condition, delai = 90_000, pas = 1000) => {
  const debut = Date.now();
  while (Date.now() - debut < delai) {
    if (await condition().catch(() => false)) return true;
    await pause(pas);
  }
  return false;
};
const fermerBulles = page => page.getByText(/^(Fermer|Terminé|Compris|Plus tard)$/).first().click({ timeout: 2500 }).catch(() => undefined);
const reveiller = page => page.evaluate(() => {
  window.dispatchEvent(new Event('focus'));
  document.dispatchEvent(new Event('visibilitychange'));
});
const tuile = (page, id) => page.locator(`[data-testid="cellule-${id}"], [data-testid="tuile-${id}"]`).first();

/**
 * Sans l'aide « acceptation automatique » des autres scénarios : on veut VOIR l'écran. Une sentinelle
 * note si l'écran « Avant de commencer » apparaît, même un instant (clignotement).
 */
const SENTINELLE = `
(() => {
  const noter = () => {
    if (document.querySelector('[data-testid="acceptation-juridique"]')) sessionStorage.setItem('e2e.acceptation.vue', String(Date.now()));
  };
  new MutationObserver(noter).observe(document, { childList: true, subtree: true });
})();
`;
async function contexte(navigateur) {
  const c = await navigateur.newContext({ locale: 'fr-FR', ignoreHTTPSErrors: true, viewport: { width: 1200, height: 860 } });
  await c.addInitScript(SCRIPT_PC);
  await c.addInitScript(SENTINELLE);
  await c.route(url => HOTES.includes(url.hostname), async route => {
    const url = new URL(route.request().url());
    const r = repondre(url.hostname, url.pathname + url.search);
    await route.fulfill({ status: r.statut, contentType: r.type, body: r.corps, headers: { 'access-control-allow-origin': '*' } });
  });
  return c;
}
const acceptationVue = page => page.evaluate(() => sessionStorage.getItem('e2e.acceptation.vue'));

async function deverrouiller(page, motDePasse, secret) {
  for (const decalage of [0, 1, -1]) {
    await page.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 });
    await page.locator('input[type=password]').first().fill(motDePasse);
    await page.locator('input:not([type=password])').first().fill(totp(secret, decalage));
    await page.getByTestId('bouton-deverrouiller').click();
    if (await page.locator('[data-testid="hub"], [data-testid="acceptation-juridique"], [data-testid="fondateur-connexion"]').first().waitFor({ timeout: 25_000 }).then(() => true, () => false)) return;
  }
  throw new Error('déverrouillage impossible');
}
async function ouvrirTsuzuku(page) {
  await allerPageApplications(page);
  await tuile(page, 'tsuzuku').click();
  await page.getByTestId('tsuzuku-racine').waitFor({ timeout: 30_000 });
}

const navigateur = await chromium.launch({ headless: true });
try {
  // ================================================================ 1. Navigateur A : compte, acceptation
  log('A : création du compte du Fondateur ; l’écran « Avant de commencer » est accepté à la main');
  const A = await (await contexte(navigateur)).newPage();
  A.on('pageerror', e => log('erreur page A :', e.message));
  await A.goto(SITE);
  await A.getByTestId('accueil-site').waitFor({ timeout: 60_000 });
  await A.getByTestId('accueil-creer').click();
  await A.getByTestId('accueil-creer-confirmer').click();
  const champs = A.locator('input[type=password]');
  await champs.nth(0).waitFor({ timeout: 60_000 });
  await champs.nth(0).fill(MDP_PC);
  await champs.nth(1).fill(MDP_PC);
  await A.getByTestId('bouton-creer').click();
  await A.getByText('À noter maintenant').waitFor({ timeout: 60_000 });
  const secret = ((await A.locator('body').innerText()).match(/\b[A-Z2-7]{16,}\b/) ?? [])[0];
  await A.getByRole('switch').click();
  await A.getByTestId('bouton-continuer').click();
  verifier(await visible(A, 'acceptation-juridique', 60_000), 'A : première connexion du compte → « Avant de commencer »');
  await capture(A, '01-a-avant-de-commencer');
  await A.getByTestId('acceptation-case').click();
  await A.getByTestId('acceptation-continuer').click();
  await A.getByTestId('hub').waitFor({ timeout: 60_000 });
  await fermerBulles(A);
  await A.keyboard.press('Escape').catch(() => undefined);

  log('A : relais du PC, puis connexion par identifiant (migration)');
  await relierCommePc(A, CODE_PC);
  await deverrouiller(A, MDP_PC, secret);
  await A.getByTestId('fondateur-connexion').waitFor({ timeout: 60_000 });
  verifier(!(await A.getByTestId('acceptation-juridique').count()), 'A : rouvert, l’acceptation n’est pas redemandée');
  await A.getByTestId('fondateur-identifiant').fill('Enzo');
  await A.getByTestId('fondateur-mdp-actuel').fill(MDP_PC);
  await A.getByTestId('fondateur-totp').fill(totp(secret));
  const pasMigration = Math.floor(Date.now() / 30_000);
  await A.getByTestId('fondateur-changer-mdp').click();
  await A.getByTestId('fondateur-mdp').fill(MDP_ENZO);
  await A.getByTestId('fondateur-mdp-confirmation').fill(MDP_ENZO);
  await A.getByTestId('fondateur-valider').click();
  await A.getByTestId('fondateur-connexion-faite').waitFor({ timeout: 60_000 });
  await A.getByTestId('fondateur-codes-notes').click();
  await A.getByTestId('hub').waitFor({ timeout: 60_000 });
  await fermerBulles(A);

  // ================================================================ 2. A : source, animé, épisodes vus
  log('A : ajoute une source (JSON), un animé à la bibliothèque, 3 épisodes vus');
  await ouvrirTsuzuku(A);
  await A.getByTestId('onglet-app-sources').click();
  await A.getByTestId('sources-ajouter').click();
  await A.getByTestId('sources-json').click();
  await A.getByTestId('assistant-json').fill(JSON.stringify(SOURCE_JSON, null, 2));
  await A.getByTestId('assistant-verifier').click();
  await A.getByTestId('assistant-valide').waitFor({ timeout: 20_000 });
  await A.getByTestId('assistant-suivant').click();
  await A.getByTestId('assistant-enregistrer').click();
  verifier(await A.getByText('Médiathèque exemple', { exact: true }).first().isVisible({ timeout: 20_000 }).catch(() => false), 'A : la source « Médiathèque exemple » est ajoutée');
  await capture(A, '02-a-source-ajoutee');
  await A.getByTestId('onglet-app-accueil').click();
  await A.getByTestId('accueil-recherche').fill('Frieren');
  await A.getByTestId('accueil-chercher').click();
  await A.getByTestId('carte-anime-1').first().click();
  await A.getByTestId('fiche-titre').waitFor({ timeout: 30_000 });
  await A.getByTestId('statut-en_cours').click();
  await A.getByTestId('vu-ailleurs-ouvrir').click();
  await A.getByTestId('vu-ailleurs-episodes').fill('3');
  await A.getByTestId('vu-ailleurs-enregistrer').click();
  verifier(await attendre(async () => /vu/.test((await A.getByTestId('episode-3').getAttribute('aria-label')) ?? ''), 15_000, 500), 'A : épisodes 1 à 3 marqués vus');
  await capture(A, '03-a-fiche-episodes-vus');
  const envoye = await attendre(async () => {
    await reveiller(A);
    const libelle = await A.getByTestId('synchro-libelle').first().innerText({ timeout: 2000 }).catch(() => '');
    return /À jour/.test(libelle) && (await coffres.etat('principal')).enregistrements > 5;
  }, 90_000, 1500);
  verifier(envoye, 'A : tout est parti au coffre serveur (« À jour »)');
  const contenus = (await coffres.lire('principal', 0, 10_000)).enregistrements.map(e => e.valeur).join('\n');
  for (const clair of ['Frieren', 'mediatheque-exemple', 'juridique', 'tsuzuku']) verifier(!contenus.includes(clair), `le serveur ne garde pas « ${clair} » en clair`);

  // ================================================================ 3. Navigateur B neuf
  log('B : navigateur neuf, connexion par identifiant + mot de passe');
  const B = await (await contexte(navigateur)).newPage();
  B.on('pageerror', e => log('erreur page B :', e.message));
  await B.goto(SITE);
  await B.getByTestId('connexion-id-identifiant').waitFor({ timeout: 60_000 });
  await B.getByTestId('connexion-id-identifiant').fill('Enzo');
  await B.getByTestId('connexion-id-mdp').fill(MDP_ENZO);
  await B.getByTestId('connexion-id-valider').click();
  if (await B.getByTestId('connexion-id-code').waitFor({ timeout: 60_000 }).then(() => true, () => false)) {
    while (Math.floor(Date.now() / 30_000) <= pasMigration) await pause(500);
    await B.getByTestId('connexion-id-code').fill(totp(secret));
    await B.getByTestId('connexion-id-valider').click();
  }
  await B.locator('[data-testid="hub"], [data-testid="acceptation-juridique"]').first().waitFor({ timeout: 120_000 });
  await pause(3000);
  verifier((await B.getByTestId('hub').count()) > 0, 'B : le hub s’ouvre directement');
  verifier(!(await acceptationVue(B)), 'B : l’écran « Avant de commencer » n’est JAMAIS apparu (ni affiché, ni clignoté)');
  await capture(B, '04-b-hub-sans-acceptation');
  await fermerBulles(B);

  await ouvrirTsuzuku(B);
  await B.getByTestId('onglet-app-bibliotheque').click();
  verifier(await attendre(async () => (await B.getByTestId('carte-anime-1').count()) > 0, 30_000, 1000), 'B : Frieren est dans la bibliothèque');
  await capture(B, '05-b-bibliotheque');
  await B.getByTestId('carte-anime-1').first().click();
  await B.getByTestId('fiche-titre').waitFor({ timeout: 30_000 });
  const vus = await Promise.all([1, 2, 3, 4].map(n => B.getByTestId(`episode-${n}`).getAttribute('aria-label').catch(() => '')));
  verifier(vus.slice(0, 3).every(l => /, vu$/.test(l ?? '')) && !/, vu$/.test(vus[3] ?? ''), `B : progression reçue (épisodes 1 à 3 vus, pas le 4)`);
  await capture(B, '06-b-fiche-progression');
  await B.getByTestId('onglet-app-sources').click();
  verifier(await B.getByText('Médiathèque exemple', { exact: true }).first().isVisible({ timeout: 20_000 }).catch(() => false), 'B : la source « Médiathèque exemple » est là');
  await capture(B, '07-b-sources');
  verifier(!(await acceptationVue(B)), 'B : toujours aucun écran « Avant de commencer »');
} catch (erreur) {
  echecs++;
  console.error(erreur);
} finally {
  await navigateur.close();
  serveurRelais.close();
  serveurSite.close();
}
console.log(echecs === 0 ? '\nTout est bon.' : `\n${echecs} échec(s).`);
process.exit(echecs === 0 ? 0 : 1);
