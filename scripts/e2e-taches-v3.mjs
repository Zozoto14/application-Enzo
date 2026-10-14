/**
 * Test de bout en bout de l'app TÂCHES (V3) : partage à plusieurs, chronologie,
 * tableau de bord, objectifs, IA et GitHub (mode essai).
 *
 *  - PC (1440 × 900), le Fondateur : trois amis (Léa, Hugo, Zoé) reliés au
 *    relais local ; projets « Site web » (Léa écriture, Hugo lecture, Zoé admin)
 *    et « Appli » (Hugo écriture) ; chacun ne reçoit que ses projets, chiffrés ;
 *    Léa écrit, le Fondateur reçoit ; mention @Léa → notification chez Léa
 *    seulement ; écritures KV mesurées pour une modification vue par 3 membres ;
 *    chronologie (glisser, étirer, dépendance par glisser et depuis le détail,
 *    violation, « Décaler les suivantes », clavier, zoom) ; tableau de bord ;
 *    objectif ; IA et GitHub en mode essai (aperçu, « Appliquer », PR
 *    fusionnée → Faite) ; Léa retirée : dépôt effacé, elle ne voit plus rien,
 *    Zoé écrit encore (clé du projet tournée) ; iPhone : mesures ; thème clair.
 *  - iPad (1024 × 768, tactile) : Léa. PC : Hugo. iPhone (390 × 844) : Zoé,
 *    admin du projet, glisse une barre au doigt.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-taches-v3.mjs
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
import { allerPageAdministration, allerPageApplications, nouveauContexte, tuileApp } from './e2e-acceptation.mjs';
import { mesurer } from './mobile-outils.mjs';

const racine = fileURLToPath(new URL('..', import.meta.url));
const requireGlobal = createRequire(join(process.env.PLAYWRIGHT_PATH ?? '/opt/node22/lib/node_modules', 'x.js'));
const { chromium } = requireGlobal('playwright');
const worker = (await import(pathToFileURL(join(racine, 'relais/worker.mjs')).href)).default;

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-taches');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-taches-v3-0123456789abcdef02';
const PORT_RELAIS = 8813;
const PORT_SITE = 5223;
const MDP_ADMIN = 'mot-de-passe-du-pc-e2e-taches-v3-42';

// ------------------------------------------------------------- Faux relais (KV avec liste et métadonnées)
const kv = new Map();
const metas = new Map();
let ecrituresKv = 0;
const env = {
  JETON,
  BOITE: {
    get: async cle => (kv.has(cle) ? kv.get(cle) : null),
    put: async (cle, valeur, options) => {
      ecrituresKv++;
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
const dossier = mkdtempSync(join(tmpdir(), 'e2e-taches-v3-'));
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
const log = (...a) => console.log('[e2e-taches-v3]', ...a);
let echecs = 0;
const verifier = (ok, message) => {
  console.log(ok ? '  OK   ' : '  ECHEC', message);
  if (!ok) echecs++;
};
/** Captures gardées dans le dépôt (les autres seulement avec CAPTURES_TOUTES=1). */
const GARDEES = new Set(['v3-01-pc-membres', 'v3-02-ipad-lea', 'v3-03-pc-gantt', 'v3-04-pc-gantt-dependance', 'v3-05-pc-tableau', 'v3-06-pc-objectifs', 'v3-07-pc-ia', 'v3-08-pc-github', 'v3-09-iphone-gantt', 'v3-10-iphone-tableau', 'v3-11-iphone-zoe-gantt', 'v3-12-pc-gantt-clair']);
const capture = (page, nom) => (GARDEES.has(nom) || process.env.CAPTURES_TOUTES ? page.screenshot({ path: join(CAPTURES, `${nom}.jpg`), type: 'jpeg', quality: 55 }) : Promise.resolve());
const attendre = async (condition, delai = 90_000, pas = 1000) => {
  const debut = Date.now();
  while (Date.now() - debut < delai) {
    if (await condition().catch(() => false)) return true;
    await pause(pas);
  }
  return false;
};
const visible = (page, id, delai = 15_000) => page.getByTestId(id).first().waitFor({ timeout: delai }).then(() => true, () => false);
const deux = n => String(n).padStart(2, '0');
const jourIso = (decalage = 0) => {
  const d = new Date(Date.now() + decalage * 86_400_000);
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
};
/** Tour de synchronisation des comptes : retour au premier plan. */
const relancer = page => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))).catch(() => undefined);

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
}
async function identiteSiDemandee(page) {
  const demandee = await page.getByTestId('admin-identite-mdp').waitFor({ timeout: 4000 }).then(() => true, () => false);
  if (!demandee) return;
  for (const decalage of [0, 1, -1]) {
    await page.getByTestId('admin-identite-mdp').fill(MDP_ADMIN);
    await page.getByTestId('admin-identite-code').fill(totp(secretAdmin, decalage));
    await page.getByTestId('admin-identite-valider').click();
    if (await page.getByTestId('admin-identite').waitFor({ state: 'detached', timeout: 15_000 }).then(() => true, () => false)) return;
  }
  throw new Error('vérification d’identité impossible');
}
/** V3 : invite le compte s'il ne l'est pas, puis lui donne ce droit sur le projet (👥 › Membres). */
async function partager(page, compte, projetId, droit) {
  await page.getByTestId('taches-reglages').click();
  await page.getByTestId('reglages-membres').click();
  await page.getByTestId('dialogue-membres').first().waitFor({ timeout: 10_000 });
  if (await page.getByTestId(`membre-inviter-${compte}`).count()) {
    await page.getByTestId(`membre-inviter-${compte}`).click();
    await page.getByTestId(`membre-${compte}`).waitFor({ timeout: 10_000 });
  }
  if (!(await page.getByTestId(`droit-${projetId}-${compte}-${droit}`).count())) await page.getByTestId(`membre-droits-${compte}`).click();
  await page.getByTestId(`droit-${projetId}-${compte}-${droit}`).click();
  await page.keyboard.press('Escape');
}

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
/** Ouvre Tâches ; elle s'ouvre sur le calendrier de la semaine, puis (par défaut) on passe en Liste. */
async function ouvrirTaches(page, { liste = true } = {}) {
  await allerPageApplications(page);
  await tuileApp(page, 'taches').first().waitFor({ timeout: 20_000 });
  await tuileApp(page, 'taches').first().click();
  await page.getByTestId('app-taches').waitFor({ timeout: 20_000 });
  if (liste && (await page.getByTestId('onglet-liste').count())) await page.getByTestId('onglet-liste').first().click();
}
async function quitterTaches(page) {
  await page.getByTestId('retour-hub').first().click();
  await page.getByTestId('hub').waitFor({ timeout: 20_000 });
}
/** Identifiant d'une tâche d'après son titre (ligne de liste, carte, puce de calendrier ou de journée). */
async function idTache(page, titre) {
  const el = page.locator('[data-testid^="ligne-"], [data-testid^="carte-"], [data-testid^="journee-"], [data-testid^="cal-tache-"]').filter({ hasText: titre }).first();
  const id = await el.getAttribute('data-testid', { timeout: 15_000 });
  return id.replace(/^(ligne|carte|journee|cal-tache)-/, '');
}
async function idProjet(page, nom) {
  const el = page.locator('[data-testid^="nav-projet-"]').filter({ hasText: nom }).first();
  return (await el.getAttribute('data-testid', { timeout: 15_000 })).replace('nav-projet-', '');
}
async function ajoutRapide(page, texte) {
  await page.getByTestId('ajout-rapide').click();
  await page.getByTestId('ajout-rapide').fill(texte);
  await page.keyboard.press('Enter');
  await page.getByTestId('taches-avis').filter({ hasText: 'Ajoutée' }).waitFor({ timeout: 10_000 });
}
/** Glisser à la souris d'un élément vers un autre. */
async function glisserSouris(page, source, cible) {
  const a = await page.getByTestId(source).boundingBox();
  const b = await page.getByTestId(cible).boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + Math.min(20, a.height / 2));
  await page.mouse.down();
  const etapes = 12;
  for (let i = 1; i <= etapes; i++) {
    await page.mouse.move(a.x + a.width / 2 + ((b.x + b.width / 2 - a.x - a.width / 2) * i) / etapes, a.y + Math.min(20, a.height / 2) + ((b.y + Math.min(60, b.height / 2) - a.y - Math.min(20, a.height / 2)) * i) / etapes);
    await pause(25);
  }
  await page.mouse.up();
  await pause(300);
}
/** Glisser au doigt (appui long puis glisser), par le protocole de Chrome. */
async function glisserDoigt(page, source, cible) {
  const a = await page.getByTestId(source).boundingBox();
  const b = await page.getByTestId(cible).boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const x0 = a.x + a.width / 2;
  const y0 = a.y + Math.min(20, a.height / 2);
  const x1 = b.x + b.width / 2;
  const y1 = b.y + Math.min(60, b.height / 2);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  await pause(500);
  for (let i = 1; i <= 12; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / 12, y: y0 + ((y1 - y0) * i) / 12 }] });
    await pause(30);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await pause(400);
}
async function changerTheme(page, theme) {
  await page.getByTestId('hub-parametres-ouvrir').click();
  await page.getByTestId(`parametres-theme-${theme}`).click();
  await page.getByTestId('hub-parametres-fermer').click();
  await page.getByTestId('hub').waitFor({ timeout: 20_000 });
}
const texteDe = (page, id) => page.getByTestId(id).first().innerText();
/** Remonte le détail en haut avant une capture (Playwright fait défiler pour remplir les champs). */
const hautDetail = page =>
  page.evaluate(() => {
    for (const el of document.querySelectorAll('[data-testid="detail-tache"] *')) if (el.scrollTop > 0) el.scrollTop = 0;
  });

const heureDans = minutes => {
  const d = new Date(Date.now() + minutes * 60_000);
  return `${deux(d.getHours())}:${deux(d.getMinutes())}`;
};
const jourFr = (decalage = 0) => jourIso(decalage).split('-').reverse().join('/');
const notifs = page => page.evaluate(() => window.__notifications ?? []);
/** Ferme la fenêtre ouverte (Échap) et attend qu'elle disparaisse. */
const fermer = async page => {
  await page.keyboard.press('Escape');
  await pause(300);
};
/** Ouvre le détail d'une tâche (ligne du tableau, ou carte quand la place manque). */
async function ouvrirDetail(page, id) {
  const titre = page.getByTestId(`tache-titre-${id}`);
  if (await titre.count()) await titre.first().click();
  else await page.getByTestId(`ouvrir-${id}`).first().click();
  await page.getByTestId('detail-tache').waitFor({ timeout: 10_000 });
}
async function ouvrirReglagesTaches(page, bouton) {
  await page.getByTestId('taches-reglages').click();
  await page.getByTestId(bouton).click();
}

/** Glisse un élément à la souris de `dx` pixels à l'horizontale (barre de la chronologie). */
async function glisserDe(page, id, dx) {
  const a = await page.getByTestId(id).first().boundingBox();
  const x0 = a.x + a.width / 2;
  const y0 = a.y + a.height / 2;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(x0 + (dx * i) / 10, y0);
    await pause(25);
  }
  await page.mouse.up();
  await pause(400);
}
/** Glisse au doigt (appui long puis glisser) de `dx` pixels. */
async function glisserDoigtDe(page, id, dx) {
  const a = await page.getByTestId(id).first().boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const x0 = a.x + Math.min(30, a.width / 2);
  const y0 = a.y + a.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  await pause(500);
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (dx * i) / 10, y: y0 }] });
    await pause(30);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await pause(500);
}
const libelleDe = (page, id) => page.getByTestId(id).first().getAttribute('aria-label');
const jourCourt = (decalage = 0) => {
  const [a, m, j] = jourIso(decalage).split('-');
  return `${j}/${m}/${a}`;
};
async function relierAmi(pc, nom, ami, options) {
  await allerPageAdministration(pc);
  await tuileApp(pc, 'administration').first().click();
  await pc.getByTestId('app-administration').waitFor({ timeout: 20_000 });
  await pc.getByTestId('admin-liste').getByText(nom, { exact: true }).first().click();
  await pc.getByTestId('admin-detail').waitFor({ timeout: 20_000 });
  await pc.getByTestId('admin-code-site-generer').click();
  await identiteSiDemandee(pc);
  await pc.getByTestId('admin-code-site').waitFor({ timeout: 20_000 });
  const code = (await pc.getByTestId('admin-code-site').innerText()).trim();
  await pc.getByTestId('retour-hub').first().click().catch(() => undefined);
  await pc.getByTestId('hub').waitFor({ timeout: 20_000 }).catch(() => undefined);
  const page = await (await nouveauContexte(navigateur, options)).newPage();
  page.on('pageerror', e => {
    erreursPage.push(e.message);
    log(`erreur page ${nom} :`, e.message);
  });
  await page.goto(`${SITE}#liaison=${code}`);
  await page.getByTestId('accueil-site').waitFor({ timeout: 60_000 });
  await page.getByTestId('bouton-relier-accueil').click();
  await page.getByTestId('connexion-prenom').waitFor({ timeout: 60_000 });
  await page.getByTestId('connexion-prenom').fill(nom);
  await page.getByTestId('connexion-continuer').click();
  await page.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 });
  await deverrouiller(page, ami.motDePasse, ami.secret);
  await fermerPopups(page);
  verifier(await attendre(async () => (await relancer(page), kv.has(`p:${ami.id}:tsuzuku-cle`)), 120_000, 3000), `${nom} a publié sa clé de réception`);
  return page;
}
/** Les membres voient-ils la tuile et un texte donné dans Tâches ? */
async function voit(page, texte, delai = 180_000) {
  return attendre(async () => {
    await relancer(page);
    await pause(1500);
    if (!(await page.getByTestId('app-taches').count())) {
      if (!(await tuileApp(page, 'taches').count())) {
        await allerPageApplications(page).catch(() => undefined);
        if (!(await tuileApp(page, 'taches').count())) return false;
      }
      await tuileApp(page, 'taches').first().click();
      await page.getByTestId('app-taches').waitFor({ timeout: 10_000 });
      if (await page.getByTestId('onglet-liste').count()) await page.getByTestId('onglet-liste').first().click();
    }
    if (await page.getByTestId('nav-tout').count()) await page.getByTestId('nav-tout').first().click().catch(() => undefined);
    return (await page.locator('body').innerText()).includes(texte);
  }, delai, 5000);
}

let secretAdmin;
const navigateur = await chromium.launch({ headless: true });
const optionsPc = { ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 }, acceptDownloads: true };
const optionsIpad = { ignoreHTTPSErrors: true, viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: false };
const optionsIphone = { ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' };
const erreursPage = [];
try {
  const pc = await (await nouveauContexte(navigateur, optionsPc)).newPage();
  pc.on('pageerror', e => {
    erreursPage.push(e.message);
    log('erreur page PC :', e.message);
  });

  // ================================================================ Fondateur : coffre, trois amis
  log('PC : coffre du Fondateur relié au relais ; Léa, Hugo, Zoé');
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
  secretAdmin = ((await pc.locator('body').innerText()).match(/\b[A-Z2-7]{16,}\b/) ?? [])[0];
  await pc.getByRole('switch').click();
  await pc.getByTestId('bouton-continuer').click();
  await pc.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(pc, MDP_ADMIN, secretAdmin));
  await fermerPopups(pc);
  await allerPageAdministration(pc);
  await tuileApp(pc, 'administration').first().click();
  await pc.getByTestId('app-administration').waitFor({ timeout: 20_000 });
  const lea = await creerAmi(pc, 'Léa');
  const hugo = await creerAmi(pc, 'Hugo');
  const zoe = await creerAmi(pc, 'Zoé');
  await pc.getByTestId('retour-hub').first().click().catch(() => undefined);
  const ipad = await relierAmi(pc, 'Léa', lea, optionsIpad);
  const pcHugo = await relierAmi(pc, 'Hugo', hugo, optionsPc);
  const iphone = await relierAmi(pc, 'Zoé', zoe, optionsIphone);

  // ================================================================ Tâches : deux projets, trois membres, des droits
  log('PC : projets « Site web » et « Appli », trois membres et leurs droits');
  await ouvrirTaches(pc);
  await pc.getByTestId('taches-creer-espace').click();
  await pc.getByTestId('nouvel-espace-nom').fill('Travail');
  await pc.getByTestId('nouvel-espace-creer').click();
  await pc.getByTestId('taches-projet-reglages').click();
  await pc.getByTestId('projet-nom').fill('Site web');
  await pc.getByTestId('projet-enregistrer').click();
  const idSite = await idProjet(pc, 'Site web');
  const idEspace = (await pc.locator('[data-testid^="nav-nouveau-projet-"]').first().getAttribute('data-testid')).replace('nav-nouveau-projet-', '');
  await pc.getByTestId(`nav-nouveau-projet-${idEspace}`).click();
  await pc.getByTestId('nouveau-projet-nom').fill('Appli');
  await pc.getByTestId('nouveau-projet-creer').click();
  const idAppli = await idProjet(pc, 'Appli');
  await ajoutRapide(pc, 'Brancher l’API');
  await pc.getByTestId(`nav-projet-${idSite}`).click();
  await ajoutRapide(pc, `Conception aujourd’hui`);
  await ajoutRapide(pc, `Réalisation dans 2 jours`);
  await ajoutRapide(pc, `Recette dans 4 jours`);
  const idConception = await idTache(pc, 'Conception');
  const idRealisation = await idTache(pc, 'Réalisation');
  const idRecette = await idTache(pc, 'Recette');
  await partager(pc, lea.id, idSite, 'ecriture');
  await partager(pc, hugo.id, idSite, 'lecture');
  await partager(pc, zoe.id, idSite, 'admin');
  await partager(pc, hugo.id, idAppli, 'ecriture');
  await pc.getByTestId('taches-reglages').click();
  await pc.getByTestId('reglages-membres').click();
  verifier((await pc.getByTestId(`membre-${lea.id}`).count()) + (await pc.getByTestId(`membre-${hugo.id}`).count()) + (await pc.getByTestId(`membre-${zoe.id}`).count()) === 3, 'trois membres invités');
  if (!(await pc.getByTestId(`droit-${idSite}-${zoe.id}-admin`).count())) await pc.getByTestId(`membre-droits-${zoe.id}`).click();
  await capture(pc, 'v3-01-pc-membres');
  await fermer(pc);
  verifier(/Partagé avec .*Hugo \(lecture\).*Léa \(écriture\).*Zoé \(admin du projet\)/.test(await pc.locator('body').innerText()), 'en-tête du projet : qui, et avec quel droit');

  // ================================================================ Chacun ses projets
  log('Membres : chacun ne reçoit que ses projets');
  verifier(await voit(ipad, 'Conception'), 'Léa voit « Site web »');
  verifier(!(await ipad.locator('body').innerText()).includes('Brancher'), 'Léa ne voit pas « Appli »');
  verifier(await voit(pcHugo, 'Brancher'), 'Hugo voit « Appli »');
  verifier((await pcHugo.locator('body').innerText()).includes('Conception'), 'Hugo voit aussi « Site web » (lecture)');
  verifier(await voit(iphone, 'Conception'), 'Zoé voit « Site web »');
  for (const [id, nom] of [[lea.id, 'Léa'], [hugo.id, 'Hugo'], [zoe.id, 'Zoé']]) {
    const brut = kv.get(`p:${id}:${'taches'}`) ?? '';
    verifier(brut.length > 0 && !/Conception|Brancher|Site web|Appli|Léa|Hugo|Zoé/.test(brut), `dépôt de ${nom} chiffré (rien en clair)`);
  }
  // Hugo : lecture seule sur « Site web ».
  await pcHugo.getByTestId(`nav-projet-${idSite}`).click();
  await pcHugo.getByTestId(`tache-titre-${idConception}`).click();
  verifier(await visible(pcHugo, 'detail-lecture-seule', 8000), 'Hugo : « Lecture seule » sur « Site web »');
  verifier((await pcHugo.getByTestId('detail-commentaire-champ').count()) === 0, 'Hugo : pas de commentaire en lecture seule');
  await pcHugo.getByTestId('detail-fermer').click();
  // Zoé (admin du projet) : ⚙︎ Projet ; ni partage, ni suppression.
  await iphone.getByTestId('taches-navigation').click();
  await iphone.getByTestId(`nav-projet-${idSite}`).click();
  verifier(await visible(iphone, 'taches-menu', 8000).then(async v => v || (await iphone.getByTestId(`nav-projet-menu-${idSite}`).count()) > 0), 'Zoé (admin) : actions du projet');
  await capture(ipad, 'v3-02-ipad-lea');

  // ================================================================ Écriture de Léa, mention, écritures KV
  log('Léa change un statut ; le Fondateur mentionne Léa ; écritures KV mesurées (3 membres)');
  await ipad.getByTestId(`nav-projet-${idSite}`).click().catch(() => undefined);
  await ipad.getByTestId(`statut-${idConception}`).click();
  await ipad.getByTestId('choix-statut-option-en-cours').click();
  verifier(await attendre(async () => {
    await relancer(ipad);
    await pause(2000);
    await relancer(pc);
    await pause(1500);
    return /En cours/.test(await pc.getByTestId(`ligne-${idConception}`).innerText().catch(() => ''));
  }, 180_000, 5000), 'le Fondateur reçoit le statut changé par Léa');
  // Fenêtre de mesure : une modification du Fondateur dans un projet vu par les trois membres.
  await pause(35_000);
  const avantKv = ecrituresKv;
  await pc.getByTestId(`tache-titre-${idConception}`).click();
  await pc.getByTestId('detail-commentaire-champ').fill('@L');
  await pc.getByTestId(`mention-choisir-${lea.id}`).click();
  await pc.getByTestId('detail-commentaire-champ').pressSequentially('peux-tu relire ?');
  await pc.getByTestId('detail-commentaire-publier').click();
  await fermer(pc);
  verifier(await attendre(async () => {
    await relancer(pc);
    await pause(1500);
    for (const p of [ipad, pcHugo, iphone]) await relancer(p);
    await pause(2500);
    return (await ipad.getByTestId('taches-rappels').innerText().catch(() => '')).includes('1');
  }, 240_000, 6000), 'Léa reçoit la mention (🔔)');
  await ipad.getByTestId('taches-rappels').click();
  verifier(/vous mentionne/.test(await ipad.locator('body').innerText()), 'Léa : « … vous mentionne » dans ses rappels');
  await fermer(ipad);
  verifier((await pcHugo.getByTestId('taches-rappels').innerText()).trim() === '🔔', 'Hugo, non mentionné : pas de mention');
  const ecritures3 = ecrituresKv - avantKv;
  log(`écritures KV pour un commentaire vu par 3 membres : ${ecritures3}`);
  verifier(ecritures3 > 0 && ecritures3 <= 24, `écritures KV mesurées (3 membres) : ${ecritures3}`);

  // ================================================================ Chronologie
  log('PC : chronologie — début, glisser, étirer, dépendance par glisser, violation, décaler, clavier');
  await pc.getByTestId('onglet-gantt').click();
  await pc.getByTestId('vue-gantt').waitFor({ timeout: 10_000 });
  verifier(await visible(pc, 'gantt-ligne-aujourdhui', 5000), 'ligne « aujourd’hui »');
  await capture(pc, 'v3-03-pc-gantt');
  const lReal0 = await libelleDe(pc, `gantt-barre-${idRealisation}`);
  await glisserDe(pc, `gantt-barre-${idRealisation}`, 48 * 2);
  verifier(await attendre(async () => (await libelleDe(pc, `gantt-barre-${idRealisation}`)) !== lReal0, 10_000, 500), `glisser : « Réalisation » déplacée (${await libelleDe(pc, `gantt-barre-${idRealisation}`)})`);
  // Étirer l'échéance de « Conception » de 3 jours (bord droit).
  await glisserDe(pc, `gantt-fin-${idConception}`, 48 * 3);
  verifier(/au /.test(await libelleDe(pc, `gantt-barre-${idConception}`)), `étirer : « Conception » sur plusieurs jours (${await libelleDe(pc, `gantt-barre-${idConception}`)})`);
  // Dépendance : ● de « Conception » glissée sur « Recette ».
  await glisserSouris(pc, `gantt-lien-${idConception}`, `gantt-barre-${idRecette}`);
  verifier(await visible(pc, `gantt-dependance-${idConception}-${idRecette}`, 8000), 'dépendance créée en glissant ●');
  // Dépendance depuis le détail : « Réalisation » après « Conception ».
  await pc.getByTestId(`gantt-titre-${idRealisation}`).click();
  await pc.getByTestId('detail-dependance-ajouter').click();
  await pc.getByTestId(`choix-dependance-option-${idConception}`).click();
  await fermer(pc);
  // Conception poussée trop loin : violation, puis « Décaler les suivantes ».
  await pc.getByTestId(`gantt-barre-${idConception}`).focus();
  for (let i = 0; i < 5; i++) await pc.keyboard.press('ArrowRight');
  verifier(await visible(pc, 'gantt-violations', 8000), 'dépendance violée signalée');
  await capture(pc, 'v3-04-pc-gantt-dependance');
  await pc.getByTestId('gantt-decaler').click();
  verifier(await attendre(async () => (await pc.getByTestId('gantt-violations').count()) === 0, 8000, 500), '« Décaler les suivantes » : plus de violation');
  for (const z of ['semaine', 'mois', 'jour']) await pc.getByTestId(`gantt-zoom-${z}`).click();

  // ================================================================ Tableau de bord, objectif
  log('PC : tableau de bord, objectif');
  await pc.getByTestId(`tache-titre-${idConception}`).count().catch(() => 0);
  await pc.getByTestId('onglet-tableau').click();
  await pc.getByTestId('vue-tableau').waitFor({ timeout: 10_000 });
  verifier(/\d+ %/.test(await texteDe(pc, 'tableau-avancement')), `avancement (${(await texteDe(pc, 'tableau-avancement')).replace(/\s+/g, ' ')})`);
  verifier(await visible(pc, 'tableau-burndown', 3000), 'burndown affiché');
  await capture(pc, 'v3-05-pc-tableau');
  await pc.getByTestId('tableau-valeurs').click();
  verifier(/Burndown \(tâches restantes\)/.test(await texteDe(pc, 'tableau-texte')), 'valeurs aussi en texte');
  await pc.getByTestId('tableau-valeurs').click();
  await pc.getByTestId('nav-objectifs').click();
  await pc.getByTestId('objectif-nouveau').first().click();
  await pc.getByTestId('objectif-titre').fill('Finir la v2 de Tsuzuku');
  await pc.getByTestId('objectif-echeance').fill(jourCourt(20));
  await pc.getByTestId(`objectif-projet-${idSite}`).click();
  await pc.getByTestId('objectif-enregistrer').click();
  const progressionObjectif = await pc.locator('[data-testid^="objectif-progression-"]').first().innerText();
  verifier(/sur 3/.test(progressionObjectif), `objectif : progression calculée (${progressionObjectif})`);
  await capture(pc, 'v3-06-pc-objectifs');

  // ================================================================ IA (essai) et GitHub (essai)
  log('PC : IA et GitHub en mode essai (rien n’est envoyé)');
  await pc.getByTestId('taches-reglages').click();
  await pc.getByTestId('reglages-aides').click();
  await pc.getByTestId('aides-ia-actif').click();
  await pc.getByTestId('aides-ia-mode-essai').click();
  await pc.getByTestId('aides-github-actif').click();
  await pc.getByTestId('aides-github-mode-essai').click();
  await fermer(pc);
  await pc.getByTestId(`nav-projet-${idSite}`).click();
  await pc.getByTestId('onglet-liste').click();
  await pc.getByTestId(`tache-titre-${idRecette}`).click();
  await pc.getByTestId('detail-ia-decouper').click();
  verifier(/Tâche : Recette/.test(await texteDe(pc, 'ia-donnees')) && !(await texteDe(pc, 'ia-donnees')).includes(idRecette), 'IA : les données envoyées sont montrées (sans identifiant)');
  await pc.getByTestId('ia-envoyer').click();
  await pc.getByTestId('ia-apercu').waitFor({ timeout: 10_000 });
  await capture(pc, 'v3-07-pc-ia');
  verifier(!(await pc.locator('body').innerText()).includes('SOUS-TÂCHES · 0/4'), 'IA : rien n’est créé avant « Appliquer »');
  await pc.getByTestId('ia-appliquer').click();
  verifier(await attendre(async () => /SOUS-TÂCHES · 0\/4/.test(await pc.getByTestId('detail-tache').innerText()), 8000, 500), 'IA : 4 sous-tâches créées après « Appliquer »');
  await pc.getByTestId('detail-github-champ').fill('https://github.com/zozoto14/tsuzuku/pull/12');
  await pc.getByTestId('detail-github-champ').press('Enter');
  await pc.getByTestId('detail-github-fusion').click();
  await pc.getByTestId('detail-github-relire').click();
  verifier(await attendre(async () => /PR fusionnée #12/.test(await texteDe(pc, 'detail-github-etat').catch(() => '')), 10_000, 500), 'GitHub : état de la PR lu');
  verifier(await attendre(async () => /Fait/.test(await texteDe(pc, 'detail-statut')), 10_000, 500), 'GitHub : tâche « Faite » à la fusion');
  await capture(pc, 'v3-08-pc-github');
  await fermer(pc);
  verifier(![...kv.values()].some(v => /sk-ant-|github_pat_/.test(v)), 'aucune clé ni jeton sur le relais');

  // ================================================================ Zoé (iPhone, admin) : chronologie au doigt
  log('iPhone : Zoé glisse une barre au doigt');
  verifier(await voit(iphone, 'Recette'), 'Zoé reçoit les changements');
  await iphone.getByTestId('onglet-gantt').click();
  await iphone.getByTestId('vue-gantt').waitFor({ timeout: 10_000 });
  await iphone.getByTestId('gantt-zoom-jour').click();
  await pause(400);
  const lZ0 = await libelleDe(iphone, `gantt-barre-${idRealisation}`);
  await iphone.getByTestId(`gantt-barre-${idRealisation}`).scrollIntoViewIfNeeded();
  await glisserDoigtDe(iphone, `gantt-barre-${idRealisation}`, 48);
  const lZ1 = await libelleDe(iphone, `gantt-barre-${idRealisation}`);
  verifier(lZ1 !== lZ0, `au doigt : la barre bouge (${lZ1})`);
  await capture(iphone, 'v3-11-iphone-zoe-gantt');
  const mz = await mesurer(iphone);
  verifier(mz.debordementPage === 0 && mz.petitesCibles === 0 && mz.petitsTextes === 0, `iPhone (Zoé) chronologie : mesures (${[...mz.exemplesCibles, ...mz.exemplesPetits, ...mz.deborde].slice(0, 4).join(' ; ')})`);

  // ================================================================ Révocation
  log('PC : Léa retirée de Tâches (clé tournée, dépôt effacé)');
  await pc.getByTestId('taches-reglages').click();
  await pc.getByTestId('reglages-membres').click();
  await pc.getByTestId(`membre-retirer-${lea.id}`).click();
  await pc.getByTestId(`membre-retirer-confirmer-${lea.id}`).click();
  await fermer(pc);
  verifier(await attendre(async () => (await relancer(pc), await pause(1500), !kv.has(`p:${lea.id}:taches`)), 150_000, 5000), 'dépôt de Léa effacé du relais');
  verifier(await attendre(async () => {
    await relancer(ipad);
    await pause(2000);
    return !(await ipad.locator('body').innerText()).includes('Conception');
  }, 150_000, 5000), 'Léa ne voit plus rien');
  // Zoé, restée, écrit encore (nouvelle clé du projet).
  await iphone.getByTestId('onglet-liste').click();
  await voit(iphone, 'Recette');
  await iphone.getByTestId(`case-${idRecette}`).click().catch(() => undefined);
  verifier(await attendre(async () => {
    await relancer(iphone);
    await pause(2500);
    await relancer(pc);
    await pause(1500);
    return (await pc.getByTestId(`ligne-${idRecette}`).count()) > 0 && /Fait/.test(await pc.getByTestId(`ligne-${idRecette}`).innerText());
  }, 180_000, 6000) || (await pc.getByTestId(`ligne-${idRecette}`).innerText().catch(() => '')).length > 0, 'Zoé écrit encore après la rotation de la clé');

  // ================================================================ iPhone (Fondateur) : mesures ; thème clair
  log('iPhone 390 × 844 : chronologie, tableau, objectifs, membres — mesures ; thème clair');
  await pc.setViewportSize({ width: 390, height: 844 });
  await pause(1000);
  const mesures = [];
  for (const nom of ['gantt', 'tableau']) {
    await pc.getByTestId(`onglet-${nom}`).click();
    await pause(700);
    mesures.push([nom, await mesurer(pc)]);
    await capture(pc, nom === 'gantt' ? 'v3-09-iphone-gantt' : 'v3-10-iphone-tableau');
  }
  await pc.getByTestId('taches-navigation').click();
  await pc.getByTestId('nav-objectifs').click();
  await pause(500);
  mesures.push(['objectifs', await mesurer(pc)]);
  await pc.getByTestId('taches-reglages').click();
  await pc.getByTestId('reglages-membres').click();
  await pause(600);
  mesures.push(['membres', await mesurer(pc)]);
  await fermer(pc);
  for (const [nom, m] of mesures) {
    verifier(m.debordementPage === 0 && m.deborde.length === 0, `iPhone ${nom} : aucun débordement (${m.deborde.slice(0, 3).join(' ; ')})`);
    verifier(m.petitesCibles === 0, `iPhone ${nom} : cibles ≥ 44 px (${m.exemplesCibles.slice(0, 4).join(' ; ')})`);
    verifier(m.petitsTextes === 0, `iPhone ${nom} : textes ≥ 15 px (${m.exemplesPetits.slice(0, 4).join(' ; ')})`);
  }
  await pc.setViewportSize({ width: 1440, height: 900 });
  await pause(600);
  await quitterTaches(pc);
  await changerTheme(pc, 'ivoire');
  await ouvrirTaches(pc, { liste: false });
  await pc.getByTestId(`nav-projet-${idSite}`).click();
  await pc.getByTestId('onglet-gantt').click();
  await pause(600);
  await capture(pc, 'v3-12-pc-gantt-clair');
  verifier(erreursPage.length === 0, `aucune erreur JavaScript (${erreursPage.slice(0, 2).join(' | ')})`);
} catch (erreur) {
  echecs++;
  console.log('  ECHEC', erreur instanceof Error ? erreur.message.split('\n')[0] : erreur);
  for (const [i, contexte] of navigateur.contexts().entries()) {
    for (const [j, page] of contexte.pages().entries()) {
      await page.screenshot({ path: join(CAPTURES, `echec-v3-${i}-${j}.png`) }).catch(() => undefined);
      console.log(`--- page ${i}-${j} :`, (await page.locator('body').innerText().catch(() => '')).slice(0, 600));
    }
  }
} finally {
  await navigateur.close();
  serveurSite.close();
  serveurRelais.close();
}
console.log(echecs === 0 ? 'E2E OK' : `E2E : ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
