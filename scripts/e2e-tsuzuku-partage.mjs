/**
 * Test de bout en bout du PARTAGE DES SOURCES de Tsuzuku : le Fondateur (PC
 * simulé, relié au relais) ajoute une source avec l'assistant (page neutre
 * locale), la partage à Léa seulement ; Léa la voit (pas Hugo), sans pouvoir la
 * modifier ; retrait du partage : elle disparaît chez Léa.
 * Faux relais local qui exécute relais/worker.mjs ; pages lues par le VRAI
 * module `bureau/electron/tsuzuku.mjs` (garde anti-SSRF), transport détourné
 * vers un « internet » local. Aucun site réel : fixtures neutres faites main.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-tsuzuku-partage.mjs
 *
 * Variables : PLAYWRIGHT_PATH, CAPTURES (défaut docs/captures-tsuzuku-partage).
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
import { nouveauContexte } from './e2e-acceptation.mjs';

const racine = fileURLToPath(new URL('..', import.meta.url));
const requireGlobal = createRequire(join(process.env.PLAYWRIGHT_PATH ?? '/opt/node22/lib/node_modules', 'x.js'));
const { chromium } = requireGlobal('playwright');
const moduleRelais = await import(pathToFileURL(join(racine, 'relais/worker.mjs')).href);
const worker = moduleRelais.default;
const { requeteTsuzuku } = await import(pathToFileURL(join(racine, 'bureau/electron/tsuzuku.mjs')).href);

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-tsuzuku-partage');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-partage-0123456789abcdef';
const PORT_RELAIS = 8793;
const PORT_SITE = 5203;
const PORT_INTERNET = 5204;
const MDP_ADMIN = 'mot-de-passe-du-pc-e2e-très-long-42';

// ------------------------------------------------------------- Faux relais
const kv = new Map();
const metas = new Map();
const env = {
  JETON,
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
const dossier = mkdtempSync(join(tmpdir(), 'e2e-partage-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dossier, 'k.pem'), '-out', join(dossier, 'c.pem'), '-subj', '/CN=localhost', '-days', '1'], { stdio: 'ignore' });
const serveurRelais = https.createServer({ key: readFileSync(join(dossier, 'k.pem')), cert: readFileSync(join(dossier, 'c.pem')) }, async (req, res) => {
  const morceaux = [];
  for await (const m of req) morceaux.push(m);
  const requete = new Request(`https://localhost:${PORT_RELAIS}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(morceaux) });
  const reponse = await worker.fetch(requete, env);
  res.writeHead(reponse.status, Object.fromEntries(reponse.headers));
  res.end(Buffer.from(await reponse.arrayBuffer()));
});
await new Promise(ok => serveurRelais.listen(PORT_RELAIS, ok));

// ------------------------------------------------------------- Internet local : une médiathèque NEUTRE
const OEUVRES = [[1, 'Le Voyage'], [2, 'La Rivière'], [3, 'Les Nuages']];
function repondre(hote, chemin) {
  const url = new URL(chemin, 'https://x');
  if (hote !== 'mediatheque-exemple.fr') return { statut: 404, type: 'text/plain', corps: 'introuvable' };
  if (url.pathname === '/recherche') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const trouve = OEUVRES.filter(a => a[1].toLowerCase().includes(q));
    return { statut: 200, type: 'text/html', corps: `<!doctype html><html><head><title>Médiathèque exemple</title></head><body><form action="/recherche"><input name="q"></form><ul class="resultats">${trouve.map(a => `<li class="carte"><a class="titre" href="/serie/${a[0]}">${a[1]}</a></li>`).join('')}</ul></body></html>` };
  }
  return { statut: 404, type: 'text/plain', corps: 'introuvable' };
}
const serveurInternet = http.createServer((req, res) => {
  const r = repondre(String(req.headers.host ?? '').split(':')[0], req.url);
  res.writeHead(r.statut, { 'Content-Type': r.type });
  res.end(r.corps);
});
await new Promise(ok => serveurInternet.listen(PORT_INTERNET, '127.0.0.1', ok));
const pontRequete = requete =>
  requeteTsuzuku(requete, {
    requeter: (url, options, rappel) => http.request({ host: '127.0.0.1', port: PORT_INTERNET, path: url.pathname + url.search, method: options.method, headers: { ...options.headers, host: url.hostname } }, rappel),
  });

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
const CODE_PC = 'AB1.' + base64url(JSON.stringify({ r: `https://localhost:${PORT_RELAIS}`, j: JETON }));
const SITE = `http://localhost:${PORT_SITE}/`;
const pause = ms => new Promise(ok => setTimeout(ok, ms));
const log = (...a) => console.log('[e2e]', ...a);
let echecs = 0;
const verifier = (ok, message) => {
  console.log(ok ? '  OK   ' : '  ECHEC', message);
  if (!ok) echecs++;
};
const capture = (page, nom) => page.screenshot({ path: join(CAPTURES, `${nom}.png`), fullPage: true });
const attendre = async (condition, delai = 90_000, pas = 1000) => {
  const debut = Date.now();
  while (Date.now() - debut < delai) {
    if (await condition()) return true;
    await pause(pas);
  }
  return false;
};
const visible = (page, id, delai = 20_000) => page.getByTestId(id).first().waitFor({ timeout: delai }).then(() => true, () => false);

async function deverrouiller(page, motDePasse, secret) {
  for (const decalage of [0, 1, -1]) {
    await page.locator('input[type=password]').first().fill(motDePasse);
    await page.locator('input:not([type=password])').first().fill(totp(secret, decalage));
    await page.getByTestId('bouton-deverrouiller').click();
    if (await page.getByTestId('hub').waitFor({ timeout: 25_000 }).then(() => true, () => false)) return;
  }
  throw new Error('déverrouillage impossible');
}
async function fermerPopups(page) {
  for (let i = 0; i < 3; i++) {
    const clique = await page.getByText(/^(Fermer|Terminé|Compris|Plus tard)$/).first().click({ timeout: 2500 }).then(() => true, () => false);
    if (!clique) break;
  }
  await page.keyboard.press('Escape').catch(() => undefined);
}
async function connecter(page, prenom, motDePasse, secret) {
  for (let essai = 0; ; essai++) {
    const ok = await page.goto(SITE).then(() => true, erreur => (essai < 3 ? false : Promise.reject(erreur)));
    if (ok) break;
    await pause(1500);
  }
  await page.getByTestId('connexion-prenom').waitFor({ timeout: 60_000 });
  await page.getByTestId('connexion-prenom').fill(prenom);
  await page.getByTestId('connexion-continuer').click();
  await page.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 });
  await deverrouiller(page, motDePasse, secret);
  await fermerPopups(page);
  await activerPontPc(page);
}
/** Pont PC simulé pour Tsuzuku seulement (lecture des pages par le vrai module du processus principal). */
const activerPontPc = page => page.evaluate(() => { globalThis.applibourse = { ...(globalThis.applibourse ?? {}), tsuzuku: { requete: r => globalThis.__tsuRequete(r), lecteur: () => Promise.resolve(true) } }; });
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
  const ligne = await page.locator('[data-testid^="admin-ligne-"]').filter({ hasText: nom }).first().getAttribute('data-testid');
  return { motDePasse, secret, id: ligne.replace('admin-ligne-', '') };
}
async function parametres(page, section) {
  await page.getByTestId('hub-parametres-ouvrir').click();
  await page.getByTestId('hub-parametres').waitFor({ timeout: 20_000 });
  await page.getByTestId(`parametres-section-${section}`).click();
}
async function fermerParametres(page) {
  await page.getByTestId('hub-parametres-fermer').click();
  await page.getByTestId('hub').waitFor({ timeout: 20_000 });
}
/** Fait tourner la synchronisation des comptes (visibilité retrouvée) jusqu'à la condition. */
const synchroniserJusqua = (page, condition, delai = 120_000) =>
  attendre(async () => {
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))).catch(() => undefined);
    return condition();
  }, delai, 3000);

const JSON_IA = {
  name: 'Médiathèque exemple',
  baseUrl: 'https://mediatheque-exemple.fr',
  language: 'vostfr',
  search: { path: '/recherche?q={query}', item: 'ul.resultats li.carte', title: 'a.titre', link: 'a.titre', image: '', imageAttr: 'src', year: '' },
  episodes: { item: 'ol.episodes li', number: '.num', title: '', link: 'a' },
  player: { iframe: 'div.lecteur iframe', attr: 'src', label: 'Lecteur', options: '', optionAttr: 'value', optionLabel: '' },
  movies: { search: { path: '', item: '' }, player: { iframe: '' } },
};

const navigateur = await chromium.launch({ headless: true });
const options = { ignoreHTTPSErrors: true, viewport: { width: 1100, height: 860 } };
try {
  const pc = await (await nouveauContexte(navigateur, options)).newPage();
  const erreursPage = [];
  pc.on('pageerror', e => {
    erreursPage.push(e.message);
    log('erreur page :', e.message);
  });
  await pc.exposeFunction('__tsuRequete', pontRequete);

  // ================================================================ Fondateur : coffre, Léa et Hugo
  log('PC : coffre du Fondateur relié au relais, Léa et Hugo (Tsuzuku autorisé aux deux)');
  await pc.goto(`${SITE}#liaison=${CODE_PC}`);
  await pc.getByTestId('accueil-site').waitFor({ timeout: 60_000 });
  await pc.getByTestId('accueil-creer').click();
  await pc.getByTestId('accueil-creer-confirmer').click();
  const champs = pc.locator('input[type=password]');
  await champs.nth(0).waitFor({ timeout: 60_000 });
  await champs.nth(0).fill(MDP_ADMIN);
  await champs.nth(1).fill(MDP_ADMIN);
  await pc.getByTestId('bouton-creer').click();
  await pc.getByText('À noter maintenant').waitFor({ timeout: 60_000 });
  const secretAdmin = ((await pc.locator('body').innerText()).match(/\b[A-Z2-7]{16,}\b/) ?? [])[0];
  await pc.getByRole('switch').click();
  await pc.getByTestId('bouton-continuer').click();
  await pc.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(pc, MDP_ADMIN, secretAdmin));
  await fermerPopups(pc);
  await pc.locator('[data-testid="cellule-administration"], [data-testid="tuile-administration"]').first().click();
  await pc.getByTestId('app-administration').waitFor({ timeout: 20_000 });
  const lea = await creerAmi(pc, 'Léa');
  const hugo = await creerAmi(pc, 'Hugo');
  verifier(Boolean(lea.id && hugo.id), `comptes créés (Léa ${lea.id}, Hugo ${hugo.id})`);

  // Chaque ami ouvre une première fois son compte : sa clé de réception part sur le relais.
  for (const [nom, ami] of [['Léa', lea], ['Hugo', hugo]]) {
    await connecter(pc, nom, ami.motDePasse, ami.secret);
    const cle = await synchroniserJusqua(pc, () => kv.has(`p:${ami.id}:tsuzuku-cle`));
    verifier(cle, `${nom} a déposé sa clé PUBLIQUE de réception dans SON espace`);
    await parametres(pc, 'tsuzuku');
    verifier((await pc.getByTestId('reglage-admin-tsuzuku-sources').count()) === 0 && (await pc.getByTestId('parametres-section-administration').count()) === 0, `${nom} (Ami) : aucune Administration › Tsuzuku (ni sources ni clés)`);
    await fermerParametres(pc);
  }
  verifier(!JSON.parse(kv.get(`p:${lea.id}:tsuzuku-cle`)).charge.includes('privee'), 'la clé privée de réception ne quitte pas la base de Léa');

  // ================================================================ Fondateur : assistant et partage
  log('Fondateur : assistant d’ajout (page neutre locale) puis partage à Léa seulement');
  await connecter(pc, 'admin', MDP_ADMIN, secretAdmin);
  await parametres(pc, 'administration');
  await pc.getByTestId('reglage-admin-tsuzuku-sources').scrollIntoViewIfNeeded();
  verifier(await visible(pc, 'sources-vide'), 'aucune source préconfigurée');
  await pc.getByTestId('sources-assistant').click();
  verifier((await pc.getByTestId('assistant-rappel').innerText()).includes('N’ajoutez que des sources dont vous avez le droit d’utiliser le contenu.'), 'rappel des droits visible dans l’assistant');
  await pc.getByTestId('assistant-adresse').fill('https://mediatheque-exemple.fr/recherche?q=a');
  await pc.getByTestId('assistant-analyser').click();
  await pc.getByTestId('assistant-prompt').waitFor({ timeout: 20_000 });
  const prompt = await pc.getByTestId('assistant-prompt').inputValue();
  verifier(prompt.includes('li.carte × 3') && prompt.includes('"movies"') && prompt.includes('GET /recherche ; champs : q'), 'le prompt décrit la structure de la page (éléments récurrents, formulaire) et tout le format (animés et films)');
  await capture(pc, '01-assistant-prompt');
  await pc.getByTestId('assistant-json').fill('```json\n' + JSON.stringify(JSON_IA, null, 2) + '\n```');
  await pc.getByTestId('assistant-verifier').click();
  verifier(await visible(pc, 'assistant-valide'), 'le JSON renvoyé est validé par le schéma du moteur');
  await pc.getByTestId('assistant-titre-test').fill('Rivière');
  await pc.getByTestId('assistant-tester').click();
  verifier(await visible(pc, 'assistant-diag-ok'), 'test pas à pas : la recherche trouve « La Rivière » (page lue par le pont, garde du principal)');
  await capture(pc, '02-assistant-test');
  await pc.getByTestId('assistant-enregistrer').click();
  await pc.getByTestId('sources-avis').waitFor({ timeout: 10_000 });
  const idSource = (await pc.locator('[data-testid^="source-partage-"][data-testid$="-selection"]').first().getAttribute('data-testid')).replace('source-partage-', '').replace(/-selection$/, '');
  await pc.getByTestId(`source-partage-${idSource}-selection`).click();
  await pc.getByTestId(`source-partage-${idSource}-compte-${lea.id}`).click();
  await pc.getByTestId(`source-acces-${idSource}`).filter({ hasText: '1 utilisateur' }).waitFor({ timeout: 10_000 });
  verifier((await pc.getByTestId(`source-partage-${idSource}-compte-${hugo.id}`).count()) === 1, 'Hugo est proposé mais non coché');
  await capture(pc, '03-partage-lea-seule');
  await pc.getByTestId('reglage-admin-tsuzuku-cles').scrollIntoViewIfNeeded();
  await pc.getByTestId('tsuzuku-cle-tmdb').fill('CLE-TMDB-E2E-SECRETE-0123456789');
  await pc.getByTestId('tsuzuku-cle-enregistrer').click();
  verifier((await pc.getByTestId('tsuzuku-cle-etat').innerText()).includes('6789') && !(await pc.locator('body').innerText()).includes('CLE-TMDB-E2E-SECRETE'), 'clé TMDB enregistrée, jamais réaffichée en entier');
  const publie = await synchroniserJusqua(pc, () => kv.has(`p:${lea.id}:tsuzuku-sources`));
  verifier(publie, 'sources partagées publiées dans l’espace de Léa');
  verifier(!kv.has(`p:${hugo.id}:tsuzuku-sources`), 'rien n’est publié chez Hugo');
  const brut = kv.get(`p:${lea.id}:tsuzuku-sources`);
  verifier(!/Médiathèque|mediatheque-exemple|CLE-TMDB|admin|Hugo|ul\.resultats/.test(brut), 'publication scellée : ni nom, ni sélecteur, ni clé d’API, ni autre compte en clair');
  const jetonLea = await moduleRelais.jetonDeProfil(JETON, lea.id);
  const jetonHugo = await moduleRelais.jetonDeProfil(JETON, hugo.id);
  const appel = (jeton, chemin, methode = 'GET', corps) => worker.fetch(new Request(`https://relais${chemin}`, { method: methode, body: corps, headers: { Authorization: `Bearer ${jeton}` } }), env);
  const statuts = [
    (await appel(jetonLea, `/p/${lea.id}/boite/tsuzuku-sources`, 'PUT', JSON.stringify({ date: new Date().toISOString(), charge: '{}' }))).status,
    (await appel(jetonLea, `/p/${lea.id}/boite/tsuzuku-sources`, 'DELETE')).status,
    (await appel(jetonHugo, `/p/${lea.id}/boite/tsuzuku-sources`)).status,
  ];
  verifier(statuts.every(s => s === 403), `relais : Léa ne réécrit ni n’efface ses sources partagées, Hugo ne les lit pas (${statuts.join(', ')})`);
  await fermerParametres(pc);

  // ================================================================ Léa la voit, Hugo non
  log('Léa voit la source partagée ; Hugo non');
  await connecter(pc, 'Léa', lea.motDePasse, lea.secret);
  const recue = await attendre(async () => {
    await parametres(pc, 'tsuzuku');
    const n = await pc.getByTestId(`source-partagee-${idSource}`).count();
    await fermerParametres(pc);
    if (!n) await pc.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    return n > 0;
  }, 120_000, 4000);
  verifier(recue, 'Léa voit « Médiathèque exemple » dans Paramètres › Tsuzuku › Sources partagées');
  await parametres(pc, 'tsuzuku');
  const texteLea = await pc.getByTestId('reglage-tsuzuku-sources-partagees').innerText();
  verifier(texteLea.includes('Médiathèque exemple') && texteLea.includes('Animés') && !texteLea.includes('mediatheque-exemple.fr') && !texteLea.includes('ul.resultats'), 'Léa voit nom, type et état, sans adresse ni sélecteurs');
  verifier((await pc.getByTestId('reglage-admin-tsuzuku-sources').count()) === 0 && (await pc.getByTestId('source-ajouter').count()) === 0 && (await pc.getByTestId(`source-modifier-${idSource}`).count()) === 0, 'Léa ne peut ni ajouter, ni modifier, ni supprimer une source');
  verifier(!(await pc.locator('body').innerText()).includes('CLE-TMDB'), 'aucune clé d’API exposée à Léa');
  await pc.getByTestId(`source-partagee-activer-${idSource}`).click();
  verifier(await pc.getByTestId(`source-partagee-${idSource}`).filter({ hasText: 'désactivée pour vous' }).waitFor({ timeout: 10_000 }).then(() => true, () => false), 'Léa la désactive pour elle seule');
  await pc.getByTestId(`source-partagee-activer-${idSource}`).click();
  await capture(pc, '04-lea-source-partagee');
  await fermerParametres(pc);

  await connecter(pc, 'Hugo', hugo.motDePasse, hugo.secret);
  await synchroniserJusqua(pc, async () => true, 5000);
  await parametres(pc, 'tsuzuku');
  verifier(await visible(pc, 'sources-partagees-vide') && (await pc.getByTestId(`source-partagee-${idSource}`).count()) === 0, 'Hugo ne voit pas la source (non partagée avec lui)');
  await capture(pc, '05-hugo-rien');
  await fermerParametres(pc);

  // ================================================================ Retrait
  log('Retrait du partage');
  await connecter(pc, 'admin', MDP_ADMIN, secretAdmin);
  const avantRetrait = JSON.parse(kv.get(`p:${lea.id}:tsuzuku-sources`)).date;
  await parametres(pc, 'administration');
  await pc.getByTestId(`source-partage-${idSource}-personne`).click();
  await pc.getByTestId(`source-acces-${idSource}`).filter({ hasText: 'vous seul' }).waitFor({ timeout: 10_000 });
  await capture(pc, '06-retrait');
  const retire = await synchroniserJusqua(pc, () => !kv.has(`p:${lea.id}:tsuzuku-sources`) || JSON.parse(kv.get(`p:${lea.id}:tsuzuku-sources`)).date !== avantRetrait);
  verifier(retire, 'retrait publié (liste vide scellée pour Léa)');
  await fermerParametres(pc);
  await connecter(pc, 'Léa', lea.motDePasse, lea.secret);
  const disparue = await attendre(async () => {
    await parametres(pc, 'tsuzuku');
    const vide = (await pc.getByTestId('sources-partagees-vide').count()) > 0;
    await fermerParametres(pc);
    if (!vide) await pc.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    return vide;
  }, 120_000, 4000);
  verifier(disparue, 'la source a disparu chez Léa');
  await parametres(pc, 'tsuzuku');
  await capture(pc, '07-lea-apres-retrait');
  verifier(erreursPage.length === 0, `aucune erreur JavaScript (${erreursPage.length})`);
} catch (erreur) {
  echecs++;
  console.log('  ECHEC', erreur instanceof Error ? erreur.message.split('\n')[0] : erreur);
  for (const [i, contexte] of navigateur.contexts().entries()) {
    for (const [j, page] of contexte.pages().entries()) await page.screenshot({ path: join(CAPTURES, `echec-${i}-${j}.png`) }).catch(() => undefined);
  }
} finally {
  await navigateur.close();
  serveurSite.close();
  serveurRelais.close();
  serveurInternet.close();
}
if (echecs > 0) {
  console.log(`E2E ECHEC (${echecs})`);
  process.exit(1);
}
console.log('E2E OK');
process.exit(0);
