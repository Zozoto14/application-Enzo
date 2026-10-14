/**
 * Test de bout en bout de l'app TÂCHES (V2) : suivi du temps, notifications,
 * liens avec les autres apps.
 *
 *  - PC (1440 × 900), le Fondateur : minuteur (un seul actif ; il survit au
 *    rechargement), saisie « 1h30 », estimation, relevé de la semaine et export
 *    CSV ; notifications : type désactivé → plus rien, rappel par défaut,
 *    heures calmes (rien ne sonne, la pastille garde), « Tester » ; Prospects :
 *    lien activé → tâche de relance, cochée → contact noté dans Prospects ;
 *    Claude Office (faux pont du PC) : « ＋ Créer une tâche » dans le Détail
 *    d'un agent, l'agent finit → tâche « En revue » + notification, la session
 *    s'ouvre dans l'Historique filtré.
 *  - iPad (1024 × 768, tactile) : Léa ne voit rien des autres apps ; elle
 *    chronomètre une tâche partagée, son temps arrive chez le Fondateur ; ses
 *    réglages de notifications sont les siens ; le Fondateur est prévenu de sa
 *    modification (pastille).
 *  - iPhone (390 × 844) : détail (temps), notifications, relevé — mesures.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-taches-v2.mjs
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
const JETON = 'jeton-e2e-taches-v2-0123456789abcdef01';
const PORT_RELAIS = 8811;
const PORT_SITE = 5221;
const MDP_ADMIN = 'mot-de-passe-du-pc-e2e-taches-v2-42';

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
const dossier = mkdtempSync(join(tmpdir(), 'e2e-taches-v2-'));
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
const log = (...a) => console.log('[e2e-taches-v2]', ...a);
let echecs = 0;
const verifier = (ok, message) => {
  console.log(ok ? '  OK   ' : '  ECHEC', message);
  if (!ok) echecs++;
};
/** Captures gardées dans le dépôt (les autres seulement avec CAPTURES_TOUTES=1). */
const GARDEES = new Set(['v2-00-pc-ouverture-semaine', 'v2-13-pc-debriefing', 'v2-14-ipad-lea-debriefing', 'v2-15-iphone-journal', 'v2-01-pc-minuteur', 'v2-02-pc-detail-temps', 'v2-03-pc-releve', 'v2-04-pc-notifications', 'v2-05-pc-liens', 'v2-06-pc-prospects', 'v2-07-office-detail', 'v2-08-pc-tache-revue', 'v2-09-ipad-lea', 'v2-10-iphone-detail', 'v2-11-iphone-notifications', 'v2-12-iphone-releve']);
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

let secretAdmin;
const navigateur = await chromium.launch({ headless: true });
const optionsPc = { ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 }, acceptDownloads: true };
const erreursPage = [];
try {
  const pc = await (await nouveauContexte(navigateur, optionsPc)).newPage();
  pc.on('pageerror', e => {
    erreursPage.push(e.message);
    log('erreur page PC :', e.message);
  });

  // ================================================================ Fondateur : coffre, Léa
  log('PC : coffre du Fondateur relié au relais, amie Léa');
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
  await pc.getByTestId('admin-liste').getByText('Léa', { exact: true }).first().click();
  await pc.getByTestId('admin-detail').waitFor({ timeout: 20_000 });
  await pc.getByTestId('admin-code-site-generer').click();
  await identiteSiDemandee(pc);
  await pc.getByTestId('admin-code-site').waitFor({ timeout: 20_000 });
  const codeLea = (await pc.getByTestId('admin-code-site').innerText()).trim();
  await quitterTaches(pc).catch(() => pc.getByTestId('retour-hub').first().click());

  log('iPad : Léa relie son navigateur');
  const optionsIpad = { ignoreHTTPSErrors: true, viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: false };
  const ipad = await (await nouveauContexte(navigateur, optionsIpad)).newPage();
  ipad.on('pageerror', e => {
    erreursPage.push(e.message);
    log('erreur page iPad :', e.message);
  });
  await ipad.goto(`${SITE}#liaison=${codeLea}`);
  await ipad.getByTestId('accueil-site').waitFor({ timeout: 60_000 });
  await ipad.getByTestId('bouton-relier-accueil').click();
  await ipad.getByTestId('connexion-prenom').waitFor({ timeout: 60_000 });
  await ipad.getByTestId('connexion-prenom').fill('Léa');
  await ipad.getByTestId('connexion-continuer').click();
  await ipad.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 });
  await deverrouiller(ipad, lea.motDePasse, lea.secret);
  await fermerPopups(ipad);
  verifier(await attendre(async () => (await relancer(ipad), kv.has(`p:${lea.id}:tsuzuku-cle`)), 120_000, 3000), 'Léa a publié sa clé de réception');

  // ================================================================ Tâches : espace, projet partagé, tâches
  log('PC : Tâches — projet « Site web » partagé avec Léa');
  await ouvrirTaches(pc);
  await pc.getByTestId('taches-creer-espace').click();
  await pc.getByTestId('nouvel-espace-nom').fill('Travail');
  await pc.getByTestId('nouvel-espace-creer').click();
  await pc.getByTestId('taches-projet-reglages').click();
  await pc.getByTestId('projet-nom').fill('Site web');
  await pc.getByTestId('projet-enregistrer').click();
  const idSite = await idProjet(pc, 'Site web');
  await pc.getByTestId('taches-reglages').click();
  await pc.getByTestId(`reglages-ami-${lea.id}`).click();
  await pc.getByTestId(`partage-${idSite}-ecriture`).click();
  await fermer(pc);
  await pc.getByTestId(`nav-projet-${idSite}`).click();
  await ajoutRapide(pc, 'Maquette #design');
  await ajoutRapide(pc, 'Rédiger la FAQ #redaction');
  const idMaquette = await idTache(pc, 'Maquette');
  const idFaq = await idTache(pc, 'Rédiger la FAQ');

  // ================================================================ Suivi du temps
  log('PC : minuteur (un seul actif), rechargement, saisie, estimation, relevé, CSV');
  await ouvrirDetail(pc, idMaquette);
  await pc.getByTestId('detail-minuteur').click();
  verifier(await visible(pc, 'taches-minuteur', 5000), 'minuteur démarré : pastille dans l’en-tête');
  await pause(32_000);
  await ouvrirDetail(pc, idFaq);
  await pc.getByTestId('detail-minuteur').click();
  verifier(/celui de « Maquette » est arrêté/.test(await texteDe(pc, 'taches-avis')), `un seul minuteur : celui de « Maquette » s’arrête (${await texteDe(pc, 'taches-avis')})`);
  verifier(/Rédiger la FAQ/.test(await texteDe(pc, 'taches-minuteur')), 'la pastille suit « Rédiger la FAQ »');
  await capture(pc, 'v2-01-pc-minuteur');
  // Rechargement : le minuteur tourne toujours (champ daté de la tâche, rien n'est écrit chaque seconde).
  const ecrituresAvantMinuteur = ecrituresKv;
  await pause(3000);
  // Rechargement complet de la page (nouvelle ouverture du site, connexion).
  await connecter(pc, 'admin', MDP_ADMIN, secretAdmin);
  await ouvrirTaches(pc, { liste: false });
  verifier((await pc.getByTestId('vue-calendrier').count()) === 1 && /Semaine du/.test(await texteDe(pc, 'cal-titre')), `vue d’ouverture : calendrier de la semaine (${await texteDe(pc, 'cal-titre').catch(() => '?')})`);
  await capture(pc, 'v2-00-pc-ouverture-semaine');
  await pc.getByTestId('onglet-liste').click();
  verifier(await visible(pc, 'taches-minuteur', 10_000) && /Rédiger la FAQ/.test(await texteDe(pc, 'taches-minuteur')), 'après rechargement : le minuteur tourne toujours');
  log(`écritures KV pendant que le minuteur tourne (rechargement compris) : ${ecrituresKv - ecrituresAvantMinuteur}`);
  await pause(25_000);
  await pc.getByTestId('taches-minuteur-arreter').click();
  verifier(/Minuteur arrêté : 1 min notées sur « Rédiger la FAQ »/.test(await texteDe(pc, 'taches-avis')), `minuteur arrêté depuis la pastille (${await texteDe(pc, 'taches-avis')})`);
  await pc.getByTestId(`nav-projet-${idSite}`).click();
  await ouvrirDetail(pc, idMaquette);
  await pc.getByTestId('detail-temps-saisir').click();
  await pc.getByTestId('temps-duree').fill('1h30');
  await pc.getByTestId('temps-valider').click();
  await pc.getByTestId('detail-estimation').fill('2h');
  await pc.keyboard.press('Enter');
  verifier(await attendre(async () => /1 h 3\d sur 2 h estimées/.test(await texteDe(pc, 'detail-temps')), 5000, 300), `détail : temps passé et estimation (${(await texteDe(pc, 'detail-temps')).split('\n')[0]})`);
  verifier(await visible(pc, 'detail-temps-barre', 3000), 'barre estimé / réel');
  await hautDetail(pc);
  await capture(pc, 'v2-02-pc-detail-temps');
  await fermer(pc);
  await pc.getByTestId('taches-releve').click();
  verifier(/Site web/.test(await texteDe(pc, 'releve-tableau')), 'relevé de la semaine : ligne « Site web »');
  await pc.getByTestId('releve-axe-etiquette').click();
  verifier(/#design/.test(await texteDe(pc, 'releve-tableau')) && /#redaction/.test(await texteDe(pc, 'releve-tableau')), 'relevé par étiquette');
  await pause(500);
  await capture(pc, 'v2-03-pc-releve');
  const [telechargement] = await Promise.all([pc.waitForEvent('download', { timeout: 15_000 }), pc.getByTestId('releve-exporter').click()]);
  const csv = readFileSync(await telechargement.path(), 'utf8');
  verifier(/^\uFEFF?date;projet;liste;tache/.test(csv) && /Maquette/.test(csv) && /;90;1,50;/.test(csv), `export CSV (${telechargement.suggestedFilename()})`);
  await fermer(pc);

  // ================================================================ Journal du jour et débriefing
  log('PC : journal du jour (note, proposition), débriefing, export Markdown');
  await pc.getByTestId(`nav-projet-${idSite}`).click();
  await pc.getByTestId('taches-journal').click();
  await pc.getByTestId('journal-champ').fill('Réunion de lancement avec le client');
  await pc.getByTestId('journal-ajouter').click();
  verifier(/Réunion de lancement/.test(await texteDe(pc, 'dialogue-journal')), 'journal : entrée notée');
  verifier(await visible(pc, `journal-proposition-${idMaquette}`, 5000), 'journal : le temps suivi sur « Maquette » est proposé');
  await pc.getByTestId(`journal-proposition-texte-${idMaquette}`).fill('Maquette : version 2 prête');
  await pc.getByTestId(`journal-proposition-ajouter-${idMaquette}`).click();
  verifier(/Maquette : version 2 prête/.test(await texteDe(pc, 'dialogue-journal')) && (await pc.getByTestId(`journal-proposition-${idMaquette}`).count()) === 0, 'proposition modifiée puis ajoutée');
  await pc.getByTestId('journal-onglet-debrief').click();
  const debrief = await texteDe(pc, 'debriefing');
  verifier(/Réunion de lancement/.test(debrief) && /Maquette/.test(debrief) && /CE QUI RESTE/i.test(debrief), 'débriefing du jour : entrées, tâches, ce qui reste');
  await pause(400);
  await capture(pc, 'v2-13-pc-debriefing');
  await pc.getByTestId('debrief-semaine').click();
  verifier(/Semaine du/.test(await texteDe(pc, 'journal-jour')), 'débriefing de la semaine');
  const [md] = await Promise.all([pc.waitForEvent('download', { timeout: 15_000 }), pc.getByTestId('debrief-exporter').click()]);
  const markdown = readFileSync(await md.path(), 'utf8');
  verifier(/^# Débriefing « Site web »/.test(markdown) && /\*\*En bref\*\*/.test(markdown) && /Réunion de lancement/.test(markdown), `export Markdown du débriefing (${md.suggestedFilename()})`);
  await fermer(pc);

  // ================================================================ Paramètres du projet, de l'espace
  log('PC : paramètres du projet (icône, description, statut retiré avec réaffectation), espace renommé');
  await pc.getByTestId(`statut-${idMaquette}`).click();
  await pc.getByTestId('choix-statut-option-en-revue').click();
  await pc.getByTestId(`nav-projet-menu-${idSite}`).click();
  await pc.getByTestId('menu-reglages-projet').click();
  await pc.getByTestId('projet-icone').fill('🚀');
  await pc.getByTestId('projet-description').fill('Refonte du site vitrine');
  await pc.getByTestId('projet-fin').fill('15/12');
  await pc.getByTestId('statut-retirer-en-revue').click();
  verifier(await visible(pc, 'statut-reaffecter-en-revue', 3000), 'statut retiré : choisir où vont ses tâches');
  await pc.getByTestId('statut-reaffecter-en-revue-en-cours').click();
  await pc.getByTestId('projet-enregistrer').click();
  verifier(/En cours/.test(await texteDe(pc, `statut-${idMaquette}`)), 'la tâche « En revue » est passée « En cours »');
  verifier(/🚀 Site web/.test(await texteDe(pc, `nav-projet-${idSite}`)), 'icône du projet dans la barre latérale');
  await pc.getByTestId('taches-projet-reglages').click();
  await pc.getByTestId('projet-historique').click();
  const histo = await texteDe(pc, 'dialogue-projet');
  verifier(/Icône : 🚀/.test(histo) && /Description modifiée/.test(histo) && /Statuts modifiés/.test(histo), 'historique des modifications du projet');
  verifier((await pc.getByTestId('statut-ligne-en-revue').count()) === 0, 'statut « En revue » retiré');
  await fermer(pc);
  const idEspaceTravail = (await pc.locator('[data-testid^="nav-espace-menu-"]').first().getAttribute('data-testid')).replace('nav-espace-menu-', '');
  await pc.getByTestId(`nav-espace-menu-${idEspaceTravail}`).click();
  await pc.getByTestId('menu-modifier-espace').click();
  await pc.getByTestId('espace-nom').fill('Boulot');
  await pc.getByTestId('espace-enregistrer').click();
  verifier(/Boulot/.test(await texteDe(pc, `nav-espace-${idEspaceTravail}`)), 'espace renommé');
  // Le statut « En revue » revient (Claude Office s'en sert plus loin).
  await pc.getByTestId('taches-projet-reglages').click();
  await pc.getByTestId('statut-nouveau').fill('En revue');
  await pc.getByTestId('statut-ajouter').click();
  await pc.getByTestId('projet-enregistrer').click();

  // ================================================================ Notifications
  log('PC : notifications — type désactivé, rappel par défaut, heures calmes, test');
  await pc.evaluate(() => {
    window.__notifications = [];
    window.applibourse = { ...(window.applibourse ?? {}), systeme: { ...(window.applibourse?.systeme ?? {}), notifier: async (t, c) => (window.__notifications.push(`${t} — ${c}`), true) } };
  });
  await ouvrirReglagesTaches(pc, 'reglages-notifications');
  await pc.getByTestId('notif-echeance-aucun').click();
  await pc.getByTestId('notif-delai-0').click();
  await pause(400);
  await capture(pc, 'v2-04-pc-notifications');
  await fermer(pc);
  await ajoutRapide(pc, `Échéance muette aujourd’hui à ${heureDans(0).replace(':', 'h')}`);
  const idMuette = await idTache(pc, 'Échéance muette');
  await ouvrirDetail(pc, idMuette);
  verifier(/À l’échéance/.test(await texteDe(pc, 'detail-rappels')), 'rappel par défaut « à l’heure » posé sur la nouvelle échéance');
  await fermer(pc);
  await pause(40_000);
  verifier((await notifs(pc)).length === 0, `type « Échéance atteinte » désactivé : aucune notification (${(await notifs(pc)).join(' | ')})`);
  await ouvrirReglagesTaches(pc, 'reglages-notifications');
  await pc.getByTestId('notif-echeance-les-deux').click();
  await fermer(pc);
  await ajoutRapide(pc, `Échéance sonore aujourd’hui à ${heureDans(0).replace(':', 'h')}`);
  verifier(await attendre(async () => (await notifs(pc)).some(n => /Échéance sonore/.test(n)), 75_000, 2000), 'réactivé : la notification part');
  // Heures calmes : plage autour de maintenant.
  await ouvrirReglagesTaches(pc, 'reglages-notifications');
  await pc.getByTestId('notif-calme').click();
  await pc.getByTestId('notif-calme-debut').fill(heureDans(-60));
  await pc.getByTestId('notif-calme-fin').click();
  await pc.getByTestId('notif-calme-fin').fill(heureDans(120));
  await pc.getByTestId('notif-calme-weekend').click();
  await pc.getByTestId('notif-calme-weekend').click();
  await fermer(pc);
  const avantCalme = (await notifs(pc)).length;
  const pastilleAvant = await texteDe(pc, 'taches-rappels');
  await ajoutRapide(pc, `Pendant les heures calmes aujourd’hui à ${heureDans(0).replace(':', 'h')}`);
  await pause(45_000);
  verifier((await notifs(pc)).length === avantCalme, `heures calmes : rien ne sonne (${(await notifs(pc)).slice(avantCalme).join(' | ')})`);
  verifier(await attendre(async () => (await texteDe(pc, 'taches-rappels')) !== pastilleAvant, 10_000, 500), `heures calmes : la pastille garde l’alerte (${pastilleAvant} → ${await texteDe(pc, 'taches-rappels')})`);
  await ouvrirReglagesTaches(pc, 'reglages-notifications');
  await pc.getByTestId('notif-calme').click();
  await pc.getByTestId('notif-tester').click();
  verifier(await attendre(async () => (await notifs(pc)).some(n => /notification de test/.test(n)), 5000, 300), '« Tester une notification » : notification envoyée');
  await fermer(pc);

  // ================================================================ Prospects
  log('PC : lien Prospects');
  await quitterTaches(pc);
  await allerPageAdministration(pc);
  await tuileApp(pc, 'prospects').first().click();
  await pc.getByTestId('prospects-nouveau').first().click();
  await pc.getByTestId('prospects-form-nom').fill('Paul Relance');
  await pc.getByTestId('prospects-form-email').fill('paul@exemple.fr');
  await pc.getByTestId('prospects-form-relance').fill(jourFr(0));
  await pc.getByTestId('prospects-form-valider').click();
  await pause(800);
  await pc.getByTestId('retour-hub').first().click();
  await pc.getByTestId('hub').waitFor({ timeout: 20_000 });
  await ouvrirTaches(pc);
  await ouvrirReglagesTaches(pc, 'reglages-liens');
  verifier((await pc.getByTestId('lien-office').getAttribute('aria-label'))?.includes('activé') && !(await pc.getByTestId('lien-office').getAttribute('aria-label'))?.includes('désactivé'), 'lien Claude Office activé par défaut');
  await pc.getByTestId('lien-prospects').click();
  await pause(500);
  await capture(pc, 'v2-05-pc-liens');
  await fermer(pc);
  verifier(await visible(pc, 'nav-projet-p-auto-prospects', 10_000), 'projet « Prospects » créé (espace « Applications »)');
  await pc.getByTestId('nav-projet-p-auto-prospects').click();
  const idRelance = await idTache(pc, 'Relancer Paul Relance');
  verifier(Boolean(idRelance), 'tâche « Relancer Paul Relance »');
  await capture(pc, 'v2-06-pc-prospects');
  await pc.getByTestId(`case-${idRelance}`).click();
  verifier(/Contact noté dans Prospects/.test(await texteDe(pc, 'taches-avis')), `cochée : contact noté dans Prospects (${await texteDe(pc, 'taches-avis')})`);
  await quitterTaches(pc);
  await allerPageAdministration(pc);
  await tuileApp(pc, 'prospects').first().click();
  const carte = await pc.locator('[data-testid^="prospects-carte-"]').filter({ hasText: 'Paul Relance' }).first().innerText();
  verifier(/Contacté/.test(carte) && /Pas de relance prévue/.test(carte) && /Relance faite \(cochée dans Tâches\)/.test(carte), `Prospects : fiche « Contacté », relance levée (${carte.replace(/\s+/g, ' ').slice(0, 120)})`);
  await pc.getByTestId('retour-hub').first().click();
  await pc.getByTestId('hub').waitFor({ timeout: 20_000 });

  // ================================================================ Claude Office (faux pont du PC)
  log('PC : Claude Office → ＋ Créer une tâche ; l’agent finit → « En revue »');
  await pc.evaluate(() => {
    const t = min => new Date(Date.now() - min * 60_000).toISOString();
    let n = 0;
    const ev = (min, type, extra = {}) => ({ v: 1, id: `e2e-tv2-${++n}`, ts: t(min), type, appareil: 'PC-BUREAU', appareilId: 'e2etv2pc0001', session: 'sess-tachesv2-0001', projet: 'appli', dossier: 'C:/Users/moi/appli', ...extra });
    window.__fabrique = ev;
    window.__journal = [ev(4, 'debut-session'), ev(3, 'demande', { texte: 'Corrige le test de synchro' }), ev(1, 'outil', { outil: 'Edit', resume: 'sync.ts', duree: 300 })];
    window.__signature = 1;
    const reglages = { actif: true, enregistrerSorties: false, masquerSecrets: true, maxFichierMo: 10, maxTotalMo: 200, appareil: 'PC-BUREAU', appareilId: 'e2etv2pc0001' };
    window.applibourse = {
      ...(window.applibourse ?? {}),
      bureau: true,
      claudeOffice: {
        etat: async () => ({ url: 'http://127.0.0.1:3334', dossier: null, hooks: 'inconnus', historique: 'installes', serveur: { joignable: false } }),
        choisirDossier: async () => ({ ok: false }), reglerUrl: async url => ({ ok: true, url }),
        apercuHooks: async () => ({ ok: false }), installerHooks: async () => ({ ok: false, annule: true }), ouvrir: async () => true,
        historique: {
          lire: async () => ({ ok: true, dossier: 'C:/Users/moi/.agent-office/historique', entrees: window.__journal, total: window.__journal.length, ignorees: 0, reglages }),
          activite: async connu => (connu === `s${window.__signature}` ? { ok: true, inchange: true, signature: connu } : { ok: true, signature: `s${window.__signature}`, entrees: window.__journal, appareilId: reglages.appareilId, appareil: 'PC-BUREAU' }),
          reglages: async () => ({ ok: true, reglages }), supprimer: async () => ({ ok: false, annule: true }), importer: async () => ({ ok: false, annule: true }),
          apercuHooks: async () => ({ ok: true }), installerHooks: async () => ({ ok: true, ecrit: false }),
        },
      },
    };
  });
  await allerPageAdministration(pc);
  await tuileApp(pc, 'claude-office').first().click();
  await pc.getByTestId('bureau').waitFor({ timeout: 20_000 });
  await pc.getByTestId('bureau-options').click();
  await pc.getByTestId('bureau-vue-liste').click();
  await pc.getByTestId('bureau-agent-sess-tachesv').first().click();
  await pc.getByTestId('bureau-detail').waitFor({ timeout: 10_000 });
  await pc.getByTestId('office-tache-creer').click();
  verifier((await pc.getByTestId('office-tache-titre').inputValue()) === 'Corrige le test de synchro', 'titre proposé : la demande en cours');
  await pause(400);
  await capture(pc, 'v2-07-office-detail');
  await pc.getByTestId('office-tache-valider').click();
  verifier(/créée dans « Claude Office »/.test(await texteDe(pc, 'office-tache-faite')), 'tâche créée, liée à la session');
  // L'agent finit.
  await pc.evaluate(() => {
    window.__journal = [...window.__journal, window.__fabrique(0, 'fin-reponse', { sortie: 'Test corrigé.' })];
    window.__signature += 1;
  });
  await pc.getByTestId('bureau-detail-fermer').click().catch(() => pc.keyboard.press('Escape'));
  await pause(500);
  if (!(await pc.getByTestId('hub').count())) await pc.getByTestId('retour-hub').first().click();
  await pc.getByTestId('hub').waitFor({ timeout: 20_000 });
  verifier(await attendre(async () => (await notifs(pc)).some(n => /L’agent lié a fini/.test(n)), 90_000, 2000), `l’agent a fini : notification « office » (${(await notifs(pc)).slice(-2).join(' | ')})`);
  await ouvrirTaches(pc);
  await pc.getByTestId('nav-projet-p-auto-office').click();
  const idOffice = await idTache(pc, 'Corrige le test de synchro');
  verifier(/En revue/.test(await texteDe(pc, `statut-${idOffice}`)), 'la tâche liée est passée « En revue »');
  await ouvrirDetail(pc, idOffice);
  verifier(/appli · sess-tac/.test(await texteDe(pc, 'detail-liens')) && /A fini le/.test(await texteDe(pc, 'detail-liens')), 'détail : session liée, « a fini »');
  await capture(pc, 'v2-08-pc-tache-revue');
  await pc.getByTestId('detail-session-0').click();
  verifier(await visible(pc, 'historique-filtre-session', 20_000), 'clic sur la session : Historique de Claude Office filtré sur elle');
  await pc.getByTestId('retour-hub').first().click();
  await pc.getByTestId('hub').waitFor({ timeout: 20_000 });

  // ================================================================ Léa (iPad)
  log('iPad : Léa — rien des autres apps ; minuteur ; ses notifications');
  verifier(await attendre(async () => (await relancer(pc), kv.has(`p:${lea.id}:taches`)), 120_000, 3000), 'dépôt chez Léa');
  verifier(!/Paul Relance|Corrige le test|sess-tachesv2|Prospects|Abonnements/.test(JSON.stringify([...kv.values()])), 'relais : rien en clair');
  const tuileLea = await attendre(async () => {
    await relancer(ipad);
    await allerPageApplications(ipad);
    return (await tuileApp(ipad, 'taches').count()) > 0;
  }, 150_000, 4000);
  verifier(tuileLea, 'Léa voit la tuile Tâches');
  await ouvrirTaches(ipad);
  await ipad.getByTestId(`nav-projet-${idSite}`).click();
  const vueLea = await texteDe(ipad, 'app-taches');
  verifier(/Maquette/.test(vueLea) && !/Paul Relance|Prospects|Claude Office|Corrige le test|Applications/.test(vueLea), 'Léa : le projet partagé, rien des autres apps');
  await ouvrirDetail(ipad, idFaq);
  await ipad.getByTestId('detail-minuteur').click();
  await pause(33_000);
  await ipad.getByTestId('detail-minuteur').click();
  verifier(/1 min notées/.test(await texteDe(ipad, 'taches-avis')), `Léa : temps noté (${await texteDe(ipad, 'taches-avis')})`);
  await capture(ipad, 'v2-09-ipad-lea');
  await ipad.getByTestId('detail-fermer').click();
  // Débriefing du projet partagé, et sa propre entrée au journal.
  await ipad.getByTestId('taches-journal').click();
  await ipad.getByTestId('journal-champ').fill('Relu les textes de la FAQ');
  await ipad.getByTestId('journal-ajouter').click();
  await ipad.getByTestId('journal-onglet-debrief').click();
  const debLea = await texteDe(ipad, 'debriefing');
  verifier(/Réunion de lancement/.test(debLea) && /Relu les textes/.test(debLea), 'Léa : le débriefing du projet partagé (entrées du Fondateur et les siennes)');
  await pause(400);
  await capture(ipad, 'v2-14-ipad-lea-debriefing');
  await fermer(ipad);
  await ouvrirReglagesTaches(ipad, 'reglages-notifications');
  verifier((await ipad.getByTestId('notif-type-office').count()) === 0 && (await ipad.getByTestId('notif-type-ami').count()) === 1, 'Léa : ses réglages (pas de type Claude Office)');
  await ipad.getByTestId('notif-ami-aucun').click();
  await fermer(ipad);
  // Le Fondateur reçoit son temps et ses réglages, et est prévenu (pastille) de sa modification.
  await ouvrirTaches(pc).catch(() => undefined);
  const tempsLea = await attendre(async () => {
    await relancer(ipad);
    await pause(1500);
    await relancer(pc);
    if (!(await pc.getByTestId('app-taches').count())) await ouvrirTaches(pc);
    await pc.getByTestId(`nav-projet-${idSite}`).click().catch(() => undefined);
    await ouvrirDetail(pc, idFaq).catch(() => undefined);
    const t = await texteDe(pc, 'detail-temps').catch(() => '');
    await fermer(pc);
    return /Léa/.test(t);
  }, 180_000, 5000);
  verifier(tempsLea, 'le Fondateur voit le temps de Léa sur « Rédiger la FAQ »');
  verifier(await attendre(async () => {
    await relancer(ipad);
    await pause(1500);
    await relancer(pc);
    if (!(await pc.getByTestId('app-taches').count())) await ouvrirTaches(pc);
    await pc.getByTestId(`nav-projet-${idSite}`).click().catch(() => undefined);
    await pc.getByTestId('taches-journal').click();
    const t = await texteDe(pc, 'dialogue-journal').catch(() => '');
    await fermer(pc);
    return /Relu les textes de la FAQ/.test(t);
  }, 180_000, 5000), 'le Fondateur voit l’entrée de Léa dans le journal du projet');
  verifier(await attendre(async () => {
    if (!(await pc.getByTestId('app-taches').count())) await ouvrirTaches(pc);
    await pc.getByTestId('taches-rappels').click();
    const t = await texteDe(pc, 'dialogue-rappels-recus').catch(() => '');
    await fermer(pc);
    return /Léa a modifié/.test(t);
  }, 90_000, 5000), 'le Fondateur : « Léa a modifié cette tâche » dans la pastille');

  // ================================================================ iPhone : mesures
  log('iPhone 390 × 844 : détail (temps), notifications, relevé');
  await pc.setViewportSize({ width: 390, height: 844 });
  await pause(800);
  await pc.getByTestId('taches-navigation').click();
  await pc.getByTestId(`nav-projet-${idSite}`).click();
  await pc.getByTestId('onglet-liste').click();
  await pc.getByTestId(`ouvrir-${idMaquette}`).click();
  await pc.getByTestId('detail-tache').waitFor({ timeout: 10_000 });
  await pc.getByTestId('detail-temps').scrollIntoViewIfNeeded();
  await pause(500);
  const m1 = await mesurer(pc);
  verifier(m1.petitesCibles === 0 && m1.petitsTextes === 0 && m1.debordementPage === 0 && m1.deborde.length === 0, `iPhone détail (temps) : mesures (${[...m1.exemplesCibles, ...m1.exemplesPetits, ...m1.deborde].slice(0, 4).join(' ; ')})`);
  await capture(pc, 'v2-10-iphone-detail');
  await pc.getByTestId('detail-fermer').click();
  await ouvrirReglagesTaches(pc, 'reglages-notifications');
  await pause(600);
  const m2 = await mesurer(pc);
  verifier(m2.petitesCibles === 0 && m2.petitsTextes === 0 && m2.debordementPage === 0 && m2.deborde.length === 0, `iPhone notifications : mesures (${[...m2.exemplesCibles, ...m2.exemplesPetits, ...m2.deborde].slice(0, 4).join(' ; ')})`);
  await capture(pc, 'v2-11-iphone-notifications');
  await fermer(pc);
  await ouvrirReglagesTaches(pc, 'reglages-releve');
  await pause(600);
  const m3 = await mesurer(pc);
  verifier(m3.petitesCibles === 0 && m3.petitsTextes === 0 && m3.debordementPage === 0 && m3.deborde.length === 0, `iPhone relevé : mesures (${[...m3.exemplesCibles, ...m3.exemplesPetits, ...m3.deborde].slice(0, 4).join(' ; ')})`);
  await capture(pc, 'v2-12-iphone-releve');
  await fermer(pc);
  await pc.getByTestId('taches-journal').click();
  await pause(600);
  const m5 = await mesurer(pc);
  verifier(m5.petitesCibles === 0 && m5.petitsTextes === 0 && m5.debordementPage === 0 && m5.deborde.length === 0, `iPhone journal : mesures (${[...m5.exemplesCibles, ...m5.exemplesPetits, ...m5.deborde].slice(0, 4).join(' ; ')})`);
  await capture(pc, 'v2-15-iphone-journal');
  await pc.getByTestId('journal-onglet-debrief').click();
  await pause(400);
  const m6 = await mesurer(pc);
  verifier(m6.petitesCibles === 0 && m6.petitsTextes === 0 && m6.debordementPage === 0 && m6.deborde.length === 0, `iPhone débriefing : mesures (${[...m6.exemplesCibles, ...m6.exemplesPetits, ...m6.deborde].slice(0, 4).join(' ; ')})`);
  await fermer(pc);
  await pc.getByTestId('taches-menu').click();
  await pc.getByTestId('menu-reglages-projet').click();
  await pause(600);
  const m7 = await mesurer(pc);
  verifier(m7.petitesCibles === 0 && m7.petitsTextes === 0 && m7.debordementPage === 0 && m7.deborde.length === 0, `iPhone paramètres du projet : mesures (${[...m7.exemplesCibles, ...m7.exemplesPetits, ...m7.deborde].slice(0, 4).join(' ; ')})`);
  await fermer(pc);
  await ouvrirReglagesTaches(pc, 'reglages-liens');
  await pause(600);
  const m4 = await mesurer(pc);
  verifier(m4.petitesCibles === 0 && m4.petitsTextes === 0 && m4.debordementPage === 0 && m4.deborde.length === 0, `iPhone liens : mesures (${[...m4.exemplesCibles, ...m4.exemplesPetits, ...m4.deborde].slice(0, 4).join(' ; ')})`);
  await fermer(pc);
  verifier(erreursPage.length === 0, `aucune erreur JavaScript (${erreursPage.slice(0, 2).join(' | ')})`);
} catch (erreur) {
  echecs++;
  console.log('  ECHEC', erreur instanceof Error ? erreur.message.split('\n')[0] : erreur);
  for (const [i, contexte] of navigateur.contexts().entries()) {
    for (const [j, page] of contexte.pages().entries()) {
      await page.screenshot({ path: join(CAPTURES, `echec-v2-${i}-${j}.png`) }).catch(() => undefined);
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
