/**
 * Test de bout en bout : DÉPLACER des tâches et menu « ÉQUIPE » de Tâches.
 *
 *  - PC (1440 × 900), le Fondateur : Léa (iPad) et Hugo (iPhone) reliés au
 *    relais local ; projets « Site web », « Recette » et « Privé » ; droits
 *    donnés par la MATRICE du menu Équipe (Léa écriture sur Site web et
 *    Recette, Hugo lecture sur Site web) ;
 *  - déplacer : depuis le détail (« Emplacement », vers un projet partagé :
 *    avertissement de visibilité, Léa la reçoit) ; multi-sélection (cases,
 *    « Déplacer 2 tâches… » vers « Privé » : elles disparaissent chez Léa) ;
 *    glisser une ligne sur la barre latérale (souris), « Annuler » ;
 *    convertir en sous-tâche (menu ⋯) ; Léa glisse au DOIGT une tâche de
 *    « Site web » vers « Recette » (iPad) : le Fondateur reçoit le
 *    déplacement ;
 *  - Équipe : fiche de Léa (ses tâches), retirer de tous les projets avec
 *    réassignation (sa copie se vide) ; Hugo (iPhone) voit l'équipe en
 *    lecture seule ; iPhone du Fondateur : mesures (débordement, cibles,
 *    textes) de l'équipe, de la matrice, de la liste et de « Déplacer ».
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-taches-equipe.mjs
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
import { accepterInvitationAmi, allerPageAdministration, allerPageApplications, lienInvitationDuPanneau, nouveauContexte, tuileApp } from './e2e-acceptation.mjs';
import { mesurer } from './mobile-outils.mjs';

const racine = fileURLToPath(new URL('..', import.meta.url));
const requireGlobal = createRequire(join(process.env.PLAYWRIGHT_PATH ?? '/opt/node22/lib/node_modules', 'x.js'));
const { chromium } = requireGlobal('playwright');
const worker = (await import(pathToFileURL(join(racine, 'relais/worker.mjs')).href)).default;

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-taches');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-taches-equipe-0123456789abcd07';
const PORT_RELAIS = 8819;
const PORT_SITE = 5229;
const MDP_ADMIN = 'mot-de-passe-du-pc-e2e-taches-equipe-42';

// ------------------------------------------------------------- Faux relais (KV avec liste et métadonnées)
const kv = new Map();
const metas = new Map();
let ecrituresKv = 0;
const parCle = new Map();
const env = {
  JETON,
  BOITE: {
    get: async cle => (kv.has(cle) ? kv.get(cle) : null),
    put: async (cle, valeur, options) => {
      ecrituresKv++;
      parCle.set(cle, (parCle.get(cle) ?? 0) + 1);
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
const dossier = mkdtempSync(join(tmpdir(), 'e2e-taches-equipe-'));
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
const log = (...a) => console.log('[e2e-taches-equipe]', ...a);
let echecs = 0;
const verifier = (ok, message) => {
  console.log(ok ? '  OK   ' : '  ECHEC', message);
  if (!ok) echecs++;
};
/** Captures gardées dans le dépôt (les autres seulement avec CAPTURES_TOUTES=1). */
const GARDEES = new Set(['equipe-01-pc-membres', 'equipe-02-pc-matrice', 'equipe-03-pc-deplacer', 'equipe-04-pc-selection', 'equipe-05-pc-glisser', 'equipe-06-ipad-lea-glisser', 'equipe-07-pc-fiche', 'equipe-08-iphone-hugo-equipe', 'equipe-09-iphone-equipe', 'equipe-10-iphone-matrice', 'equipe-11-iphone-deplacer']);
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
  // Relais version 9 : l'ami se connecte par son invitation (plus de code de connexion au site).
  const lien = await lienInvitationDuPanneau(page);
  await page.getByTestId('admin-transmis').click().catch(() => undefined);
  await page.getByTestId('admin-termine').click();
  const ligne = await page.locator('[data-testid^="admin-ligne-"]').filter({ hasText: nom }).first().getAttribute('data-testid');
  return { motDePasse, secret, lien, id: ligne.replace('admin-ligne-', '') };
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
  if (!(await pc.getByTestId('app-administration').count())) {
    await allerPageAdministration(pc);
    await tuileApp(pc, 'administration').first().click();
    await pc.getByTestId('app-administration').waitFor({ timeout: 20_000 });
  }
  if (!(await pc.getByTestId('admin-liste').count())) await pc.getByTestId('admin-onglet-utilisateurs').click();
  await pc.getByTestId('admin-liste').getByText(nom, { exact: true }).first().click();
  await pc.getByTestId('admin-detail').waitFor({ timeout: 20_000 });
  const code = ami.lien;
  await pc.keyboard.press('Escape').catch(() => undefined);
  const page = await (await nouveauContexte(navigateur, options)).newPage();
  page.on('pageerror', e => {
    erreursPage.push(e.message);
    log(`erreur page ${nom} :`, e.message);
  });
  await accepterInvitationAmi(page, code, SITE);
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

/** Attend que le membre ne voie plus un texte dans Tâches (déplacée hors de ses projets, accès retiré). */
async function nevoitPlus(page, texte, delai = 180_000) {
  return attendre(async () => {
    await relancer(page);
    await pause(1500);
    if (await page.getByTestId('nav-tout').count()) await page.getByTestId('nav-tout').first().click().catch(() => undefined);
    return !(await page.locator('body').innerText()).includes(texte);
  }, delai, 5000);
}
/** Le Fondateur : texte d'une ligne de projet après synchronisation. */
async function fondateurVoitDans(page, idProjet, texte, delai = 180_000) {
  return attendre(async () => {
    await relancer(page);
    await pause(1500);
    await page.getByTestId(`nav-projet-${idProjet}`).first().click().catch(() => undefined);
    await pause(500);
    return (await page.getByTestId('vue-liste').first().innerText().catch(() => '')).includes(texte);
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

  // ================================================================ Fondateur : coffre, deux amis
  log('PC : coffre du Fondateur relié au relais ; Léa (iPad), Hugo (iPhone)');
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
  const ipad = await relierAmi(pc, 'Léa', lea, optionsIpad);
  const iphone = await relierAmi(pc, 'Hugo', hugo, optionsIphone);
  if (await pc.getByTestId('retour-hub').count()) await quitterTaches(pc);

  // ================================================================ Projets et tâches
  log('PC : « Site web », « Recette », « Privé » et leurs tâches');
  await ouvrirTaches(pc);
  await pc.getByTestId('taches-creer-espace').click();
  await pc.getByTestId('nouvel-espace-nom').fill('Travail');
  await pc.getByTestId('nouvel-espace-creer').click();
  await pc.getByTestId('taches-projet-reglages').click();
  await pc.getByTestId('projet-nom').fill('Site web');
  await pc.getByTestId('projet-enregistrer').click();
  const idSite = await idProjet(pc, 'Site web');
  const idEspace = (await pc.locator('[data-testid^="nav-nouveau-projet-"]').first().getAttribute('data-testid')).replace('nav-nouveau-projet-', '');
  for (const nom of ['Recette', 'Privé']) {
    await pc.getByTestId(`nav-nouveau-projet-${idEspace}`).click();
    await pc.getByTestId('nouveau-projet-nom').fill(nom);
    await pc.getByTestId('nouveau-projet-creer').click();
    await pc.getByTestId('taches-titre').filter({ hasText: nom }).waitFor({ timeout: 10_000 });
  }
  const idRecette = await idProjet(pc, 'Recette');
  const idPrive = await idProjet(pc, 'Privé');
  await ajoutRapide(pc, 'Budget');
  const idBudget = await idTache(pc, 'Budget');
  await pc.getByTestId(`nav-projet-${idSite}`).click();
  for (const t of ['Maquette', 'Textes', 'Photos']) await ajoutRapide(pc, t);
  const idMaquette = await idTache(pc, 'Maquette');
  const idTextes = await idTache(pc, 'Textes');
  const idPhotos = await idTache(pc, 'Photos');

  // ================================================================ Menu Équipe : inviter, matrice
  log('PC : menu « Équipe » — inviter Léa et Hugo, droits par la matrice');
  await pc.getByTestId('nav-equipe').click();
  await pc.getByTestId('vue-equipe').waitFor({ timeout: 10_000 });
  verifier((await texteDe(pc, 'taches-titre')) === 'Équipe', 'l’entrée « Équipe » de la barre de navigation ouvre le menu');
  // Le modèle d'accès « Ami » ouvre déjà Tâches : le tour du hub les a peut-être invités. Sinon, « Inviter à Tâches ».
  for (const ami of [lea, hugo]) {
    if (await pc.getByTestId(`equipe-inviter-${ami.id}`).count()) await pc.getByTestId(`equipe-inviter-${ami.id}`).click();
    await pc.getByTestId(`equipe-membre-${ami.id}`).waitFor({ timeout: 15_000 });
  }
  verifier(/Accès ouvert/.test(await texteDe(pc, `equipe-acces-${lea.id}`)), 'Léa invitée : accès ouvert (même vérité que l’Administration)');
  await pc.getByTestId('equipe-onglet-droits').click();
  for (const [compte, projet, droit] of [[lea.id, idSite, 'ecriture'], [lea.id, idRecette, 'ecriture'], [hugo.id, idSite, 'lecture']]) {
    await pc.getByTestId(`matrice-${compte}-${projet}`).click();
    await pc.getByTestId(`matrice-choix-${droit}`).click();
  }
  verifier(/3 changements en attente/.test(await texteDe(pc, 'matrice-en-attente')), 'matrice : 3 changements en attente (rien d’écrit avant « Appliquer »)');
  await capture(pc, 'equipe-02-pc-matrice');
  await pc.getByTestId('matrice-appliquer').click();
  await pause(500);
  verifier(/Écriture/.test(await texteDe(pc, `matrice-${lea.id}-${idRecette}`)), 'matrice appliquée : Léa en écriture sur « Recette »');
  await pc.getByTestId('equipe-onglet-membres').click();
  verifier(/Site web · Écriture/.test(await texteDe(pc, `equipe-membre-${lea.id}`)) && /Recette · Écriture/.test(await texteDe(pc, `equipe-membre-${lea.id}`)), 'carte de Léa : ses projets et son droit');
  await capture(pc, 'equipe-01-pc-membres');
  verifier(await voit(ipad, 'Maquette'), 'Léa reçoit « Site web »');
  verifier(await voit(iphone, 'Maquette'), 'Hugo reçoit « Site web » (lecture)');

  // ================================================================ Déplacer depuis le détail : vers un projet partagé
  log('PC : « Budget » (Privé) → « Site web » depuis le détail ; avertissement de visibilité');
  await pc.getByTestId(`nav-projet-${idPrive}`).click();
  await ouvrirDetail(pc, idBudget);
  verifier(/Travail › Privé/.test(await texteDe(pc, 'detail-emplacement')), 'détail : « Emplacement » Travail › Privé');
  await pc.getByTestId('detail-emplacement').click();
  await pc.getByTestId('dialogue-deplacer').first().waitFor({ timeout: 10_000 });
  await pc.getByTestId('deplacer-recherche').fill('site');
  await pc.locator('[data-testid^="deplacer-option-"]').filter({ hasText: 'Site web' }).first().click();
  const avert = await texteDe(pc, 'deplacer-visibilite');
  verifier(/Elle sera visible par Hugo \(lecture\), Léa \(écriture\)/.test(avert), `avertissement de visibilité : ${avert.replace(/\s+/g, ' ')}`);
  await capture(pc, 'equipe-03-pc-deplacer');
  await pc.getByTestId('deplacer-valider').click();
  verifier(/« Budget » déplacée vers « Travail › Site web »/.test(await texteDe(pc, 'taches-annulable')), 'avis « déplacée vers… » avec « Annuler »');
  await pc.getByTestId('detail-fermer').click().catch(() => undefined);
  verifier(await voit(ipad, 'Budget'), 'Léa reçoit « Budget » (déplacée dans un projet partagé)');

  // ================================================================ Multi-sélection : hors du projet partagé
  log('PC : multi-sélection (Maquette, Textes) → « Privé » ; elles disparaissent chez Léa');
  await pc.getByTestId(`nav-projet-${idSite}`).click();
  await pc.getByTestId(`choisir-${idMaquette}`).click();
  await pc.getByTestId(`choisir-${idTextes}`).click();
  verifier(/2 tâches sélectionnées/.test(await texteDe(pc, 'barre-selection')), 'barre « 2 tâches sélectionnées »');
  await capture(pc, 'equipe-04-pc-selection');
  await pc.getByTestId('selection-deplacer').click();
  await pc.locator('[data-testid^="deplacer-option-"]').filter({ hasText: 'Privé' }).first().click();
  verifier(/Elles disparaîtront chez Hugo, Léa/.test(await texteDe(pc, 'deplacer-disparition')), 'avertissement : elles disparaîtront chez Hugo et Léa');
  await pc.getByTestId('deplacer-valider').click();
  verifier(/2 tâches déplacées vers « Travail › Privé »/.test(await texteDe(pc, 'taches-annulable')), 'avis « 2 tâches déplacées »');
  verifier(await nevoitPlus(ipad, 'Maquette'), 'Léa ne voit plus « Maquette » (pierre tombale de déplacement)');
  verifier(!(await ipad.locator('body').innerText()).includes('Textes'), 'Léa ne voit plus « Textes »');

  // ================================================================ Glisser une ligne sur la barre latérale (souris), Annuler
  log('PC : glisser « Photos » sur « Recette » (souris), puis « Annuler »');
  await pc.getByTestId(`nav-projet-${idSite}`).click();
  await pause(500);
  await glisserSouris(pc, `echeance-${idPhotos}`, `zone-projet-${idRecette}`);
  // Hugo voit « Site web » mais pas « Recette » : la fenêtre s'ouvre sur la bonne destination.
  verifier(await visible(pc, 'dialogue-deplacer', 8000), 'dépôt sur la barre latérale : fenêtre « Déplacer » (Hugo la perdra)');
  verifier(/Elle disparaîtra chez Hugo/.test(await texteDe(pc, 'deplacer-disparition')), 'glisser : avertissement pour Hugo');
  await capture(pc, 'equipe-05-pc-glisser');
  await pc.getByTestId('deplacer-valider').click();
  verifier(await fondateurVoitDans(pc, idRecette, 'Photos', 15_000), '« Photos » est dans « Recette »');
  await pc.getByTestId('taches-annuler').click();
  verifier(await fondateurVoitDans(pc, idSite, 'Photos', 15_000), '« Annuler » : « Photos » revient dans « Site web »');

  // ================================================================ Convertir en sous-tâche (menu ⋯)
  log('PC : « Budget » devient sous-tâche de « Photos » (menu ⋯)');
  await pc.getByTestId(`ligne-menu-${idBudget}`).click();
  await pc.getByTestId('menu-tache-sous').click();
  await pc.getByTestId('deplacer-recherche').fill('photos');
  await pc.locator('[data-testid^="deplacer-option-"]').filter({ hasText: 'Photos' }).first().click();
  await pc.getByTestId('deplacer-valider').click();
  verifier(/« Budget » devient sous-tâche de « Photos »/.test(await texteDe(pc, 'taches-annulable')), 'convertie en sous-tâche');
  verifier(!(await pc.getByTestId(`ligne-${idBudget}`).count()) && /↳ 0\/1/.test(await texteDe(pc, `ligne-${idPhotos}`)), 'la liste montre « Photos » avec sa sous-tâche');

  // ================================================================ Léa (iPad) : glisser au doigt vers « Recette »
  log('iPad : Léa glisse « Photos » au doigt sur « Recette » ; le Fondateur reçoit le déplacement');
  await ipad.getByTestId(`nav-projet-${idSite}`).first().click();
  await pause(800);
  await glisserDoigt(ipad, `echeance-${idPhotos}`, `zone-projet-${idRecette}`);
  const dialogueLea = await visible(ipad, 'dialogue-deplacer', 3000);
  if (dialogueLea) await ipad.getByTestId('deplacer-valider').click();
  verifier(/déplacée vers « Travail › Recette »/.test(await texteDe(ipad, 'taches-annulable').catch(() => '')), `Léa : « Photos » déplacée au doigt${dialogueLea ? ' (après la fenêtre)' : ''}`);
  await capture(ipad, 'equipe-06-ipad-lea-glisser');
  verifier(await fondateurVoitDans(pc, idRecette, 'Photos'), 'le Fondateur reçoit le déplacement de Léa (Site web → Recette)');
  await pc.getByTestId(`nav-projet-${idRecette}`).click();
  await ouvrirDetail(pc, idPhotos);
  await pc.getByTestId('detail-historique').click();
  verifier(/Déplacée de « Travail › Site web » vers « Travail › Recette »/.test(await pc.getByTestId('detail-tache').innerText()), 'historique : « Déplacée de … vers … »');
  await pc.getByTestId('detail-fermer').click();

  // ================================================================ Équipe : fiche, retrait de tous les projets, réassignation
  log('PC : fiche de Léa, retrait de tous ses projets avec réassignation');
  await ajoutRapide(pc, 'Relecture @Léa');
  const idRelecture = await idTache(pc, 'Relecture');
  await pc.getByTestId('nav-equipe').click();
  await pc.getByTestId(`equipe-fiche-${lea.id}`).click();
  await pc.getByTestId('equipe-fiche').first().waitFor({ timeout: 10_000 });
  verifier(/Relecture/.test(await pc.getByTestId('equipe-fiche').first().innerText()), 'fiche de Léa : ses tâches');
  verifier(/Déplacée/.test(await pc.getByTestId('equipe-fiche').first().innerText()), 'fiche de Léa : son activité récente');
  await pause(700);
  await capture(pc, 'equipe-07-pc-fiche');
  await pc.getByTestId('fiche-retirer-tous').click();
  await pc.getByTestId('retrait-vers-fondateur').click();
  await pc.getByTestId('retrait-confirmer').click();
  verifier(/Léa est retiré de tous les projets ; 1 tâche réassignée/.test(await texteDe(pc, 'taches-avis')), 'retrait de Léa avec réassignation (avis)');
  verifier(/Aucun projet partagé/.test(await texteDe(pc, `equipe-membre-${lea.id}`)), 'carte de Léa : plus aucun projet');
  await fermer(pc);
  verifier(await nevoitPlus(ipad, 'Photos'), 'Léa ne voit plus rien (clés tournées, dépôt réécrit)');
  verifier(await fondateurVoitDans(pc, idRecette, 'Relecture', 10_000), '« Relecture » toujours là chez le Fondateur');
  await ouvrirDetail(pc, idRelecture);
  await pc.getByTestId('detail-historique').click();
  verifier(/Assignée à Moi|Assignée à/.test(await pc.getByTestId('detail-tache').innerText()), 'tâche réassignée (historique)');
  await pc.getByTestId('detail-fermer').click();

  // ================================================================ Hugo (iPhone) : l'équipe en lecture seule
  log('iPhone : Hugo voit l’équipe de « Site web » en lecture seule');
  await relancer(iphone);
  await iphone.getByTestId('taches-navigation').click();
  await iphone.getByTestId('nav-equipe').click();
  verifier(await visible(iphone, 'vue-equipe-membre', 10_000), 'Hugo : menu Équipe en lecture seule');
  verifier((await iphone.getByTestId('equipe-onglet-droits').count()) === 0, 'Hugo : pas de matrice ni d’action de gestion');
  const mHugo = await mesurer(iphone);
  verifier(mHugo.debordementPage === 0 && mHugo.deborde.length === 0 && mHugo.petitesCibles === 0 && mHugo.petitsTextes === 0, `iPhone (Hugo) équipe : mesures (${[...mHugo.deborde, ...mHugo.exemplesCibles, ...mHugo.exemplesPetits].slice(0, 4).join(' ; ')})`);
  await capture(iphone, 'equipe-08-iphone-hugo-equipe');

  // ================================================================ iPhone du Fondateur : mesures
  log('iPhone 390 × 844 (Fondateur) : équipe, matrice, liste avec cases, « Déplacer »');
  await pc.getByTestId('nav-equipe').click();
  await pc.setViewportSize({ width: 390, height: 844 });
  await pause(1000);
  const mesures = [];
  mesures.push(['équipe', await mesurer(pc)]);
  await capture(pc, 'equipe-09-iphone-equipe');
  await pc.getByTestId('equipe-onglet-droits').click();
  await pause(500);
  mesures.push(['matrice', await mesurer(pc)]);
  await capture(pc, 'equipe-10-iphone-matrice');
  await pc.getByTestId('taches-navigation').click();
  await pc.getByTestId(`nav-projet-${idRecette}`).click();
  await pc.getByTestId('onglet-liste').click();
  await pause(500);
  mesures.push(['liste', await mesurer(pc)]);
  await pc.getByTestId(`choisir-${idRelecture}`).click();
  await pc.getByTestId('selection-deplacer').click();
  await pause(600);
  mesures.push(['déplacer', await mesurer(pc)]);
  await capture(pc, 'equipe-11-iphone-deplacer');
  await fermer(pc);
  for (const [nom, m] of mesures) {
    verifier(m.debordementPage === 0 && m.deborde.length === 0, `iPhone ${nom} : aucun débordement (${m.deborde.slice(0, 3).join(' ; ')})`);
    verifier(m.petitesCibles === 0, `iPhone ${nom} : cibles ≥ 44 px (${m.exemplesCibles.slice(0, 4).join(' ; ')})`);
    verifier(m.petitsTextes === 0, `iPhone ${nom} : textes ≥ 15 px (${m.exemplesPetits.slice(0, 4).join(' ; ')})`);
  }
  verifier(erreursPage.length === 0, `aucune erreur JavaScript (${erreursPage.slice(0, 2).join(' | ')})`);
} catch (erreur) {
  echecs++;
  console.log('  ECHEC', erreur instanceof Error ? erreur.message.split('\n').slice(0, 3).join(' | ') : erreur);
  for (const [i, contexte] of navigateur.contexts().entries()) {
    for (const [j, page] of contexte.pages().entries()) {
      await page.screenshot({ path: join(CAPTURES, `echec-equipe-${i}-${j}.png`) }).catch(() => undefined);
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
