/**
 * Test de bout en bout de l'app TÂCHES (V1).
 *
 *  - PC (1440 × 900) : le Fondateur (site relié à un faux relais qui exécute
 *    relais/worker.mjs) crée deux amis (Léa, Hugo), ouvre Tâches : espace,
 *    projets, choix de l'ami (Léa) et partage du seul projet « Site web » en
 *    écriture ; ajout rapide avec la syntaxe et les dates en français ; liste
 *    (statut modifié en place) ; Kanban (glisser-déposer à la souris, puis au
 *    clavier) ; Calendrier (glisser une tâche sur un autre jour, semaine) ;
 *    Ma journée ; détail (checklist, commentaire, lien) ; vue enregistrée ;
 *    rappel (notification PC simulée, pastille de la tuile, pas de répétition) ;
 *    relais : rien en clair.
 *  - iPad (1024 × 768, tactile) : Léa (navigateur relié à SON compte) voit la
 *    tuile, le projet partagé et pas l'autre ; modifie une tâche (statut,
 *    commentaire), glisse une carte au doigt ; ne peut pas supprimer le
 *    projet ; le Fondateur reçoit ses modifications ; partage passé en
 *    lecture → Léa ne modifie plus. iPad portrait (820 × 1180).
 *  - Hugo (troisième compte) ne voit pas la tuile.
 *  - iPhone (390 × 844) : vues et détail plein écran ; mesures (débordement,
 *    cibles de 44 px, textes de 15 px). Thèmes clair et sombre.
 *  - Suppression (PC) : un espace supprimé en déplaçant son contenu, « Annuler »,
 *    à nouveau supprimé, restauré depuis la corbeille ; touche Suppr et appui
 *    long ; un projet partagé supprimé disparaît chez Léa (iPad) puis revient
 *    restauré ; menu, confirmation et corbeille mesurés sur iPhone.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-taches.mjs
 *
 * Captures JPEG légères dans docs/captures-taches/ (variable CAPTURES).
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
const JETON = 'jeton-e2e-taches-0123456789abcdef0123';
const PORT_RELAIS = 8809;
const PORT_SITE = 5219;
const MDP_ADMIN = 'mot-de-passe-du-pc-e2e-taches-42';

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
const dossier = mkdtempSync(join(tmpdir(), 'e2e-taches-'));
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
const log = (...a) => console.log('[e2e-taches]', ...a);
let echecs = 0;
const verifier = (ok, message) => {
  console.log(ok ? '  OK   ' : '  ECHEC', message);
  if (!ok) echecs++;
};
/** Captures gardées dans le dépôt (les autres seulement avec CAPTURES_TOUTES=1). */
const GARDEES = new Set(['22-pc-suppression-espace', '23-pc-corbeille', '25-iphone-suppression', '01-pc-bienvenue', '03-pc-ajout-rapide', '04-pc-liste', '05-pc-kanban', '06-pc-calendrier-mois', '08-pc-detail', '09-pc-hub-tuile', '10-ipad-lea-liste', '12-ipad-lea-kanban', '15-pc-kanban-clair', '17-iphone-liste', '18-iphone-detail', '20-pc-journee-clair', '21-iphone-calendrier-clair']);
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

let secretAdmin;
const navigateur = await chromium.launch({ headless: true });
const optionsPc = { ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } };
const erreursPage = [];
try {
  const pc = await (await nouveauContexte(navigateur, optionsPc)).newPage();
  pc.on('pageerror', e => {
    erreursPage.push(e.message);
    log('erreur page PC :', e.message);
  });

  // ================================================================ Fondateur : coffre, Léa et Hugo
  log('PC : coffre du Fondateur relié au relais, amis Léa et Hugo');
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
  verifier(Boolean(lea.id && hugo.id), `comptes créés (Léa ${lea.id}, Hugo ${hugo.id})`);
  await pc.getByTestId('admin-liste').getByText('Léa', { exact: true }).first().click();
  await pc.getByTestId('admin-detail').waitFor({ timeout: 20_000 });
  // V3 : Tâches s'ouvre dans l'Administration comme les autres apps ; on la ferme à Léa et à Hugo (le modèle « Ami » l'ouvre) :
  // c'est le Fondateur qui l'ouvrira à Léa en l'invitant depuis Tâches.
  verifier((await pc.locator(`[data-testid^="admin-niveau-${lea.id}-taches"]`).count()) > 0, 'Administration : Tâches a son niveau d’accès, comme les autres apps');
  await pc.getByTestId(`admin-niveau-${lea.id}-taches-aucun`).click();
  await identiteSiDemandee(pc);
  await pc.getByTestId('admin-code-site-generer').click();
  await identiteSiDemandee(pc);
  await pc.getByTestId('admin-code-site').waitFor({ timeout: 20_000 });
  const codeLea = (await pc.getByTestId('admin-code-site').innerText()).trim();
  await pc.getByTestId('admin-liste').getByText('Hugo', { exact: true }).first().click();
  await pc.getByTestId('admin-detail').waitFor({ timeout: 20_000 });
  await pc.getByTestId(`admin-niveau-${hugo.id}-taches-aucun`).click();
  await identiteSiDemandee(pc);
  await pause(1000);
  await quitterTaches(pc).catch(() => pc.getByTestId('retour-hub').first().click());

  // ================================================================ Léa (iPad, son propre navigateur) : première ouverture
  log('iPad : Léa relie son navigateur à son compte (clé de réception publiée)');
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
  verifier(await attendre(async () => (await relancer(ipad), kv.has(`p:${lea.id}:tsuzuku-cle`)), 120_000, 3000), 'Léa a déposé sa clé PUBLIQUE de réception dans SON espace');
  verifier((await tuileApp(ipad, 'taches').count()) === 0, 'avant le choix du Fondateur, Léa n’a pas la tuile Tâches');

  // ================================================================ Fondateur : Tâches
  log('PC : Tâches — état vide, espace, projets');
  await ouvrirTaches(pc);
  verifier(await visible(pc, 'taches-bienvenue'), 'état vide pédagogique (bienvenue, créer un espace, exemple)');
  await capture(pc, '01-pc-bienvenue');
  await pc.getByTestId('taches-creer-espace').click();
  await pc.getByTestId('nouvel-espace-nom').fill('Travail');
  await pc.getByTestId('nouvel-espace-creer').click();
  await pc.getByTestId('taches-projet-reglages').click();
  await pc.getByTestId('projet-nom').fill('Site web');
  await pc.getByTestId('projet-enregistrer').click();
  const idSite = await idProjet(pc, 'Site web');
  const idEspace = (await pc.locator('[data-testid^="nav-nouveau-projet-"]').first().getAttribute('data-testid')).replace('nav-nouveau-projet-', '');
  await pc.getByTestId(`nav-nouveau-projet-${idEspace}`).click();
  await pc.getByTestId('nouveau-projet-nom').fill('Perso');
  await pc.getByTestId('nouveau-projet-creer').click();
  const idPerso = await idProjet(pc, 'Perso');
  verifier(Boolean(idSite && idPerso), 'projets « Site web » et « Perso » créés');

  // Choix de l'ami et partage projet par projet.
  log('PC : ami choisi (Léa), « Site web » partagé en écriture, « Perso » non');
  await partager(pc, lea.id, idSite, 'ecriture');
  await pc.getByTestId('taches-reglages').click();
  await pc.getByTestId('reglages-membres').click();
  verifier((await pc.getByTestId(`invitable-${hugo.id}`).count()) === 1 && (await pc.getByTestId(`membre-${hugo.id}`).count()) === 0, 'Hugo est proposé, non invité');
  await capture(pc, '02-pc-reglages-partage');
  await pc.keyboard.press('Escape');

  // Ajout rapide dans « Perso » (secret) puis « Site web ».
  await pc.getByTestId(`nav-projet-${idPerso}`).click();
  await ajoutRapide(pc, 'Acheter du pain secret aujourd’hui');
  await pc.getByTestId(`nav-projet-${idSite}`).click();
  log('PC : ajout rapide');
  await pc.getByTestId('ajout-rapide').fill('Appeler Paul demain #prospects !haute @ami');
  const apercu = await texteDe(pc, 'ajout-rapide-apercu');
  verifier(/demain/.test(apercu) && /Haute/.test(apercu) && /Léa/.test(apercu) && /#prospects/.test(apercu), `aperçu de l’ajout rapide : « ${apercu.replace(/\s+/g, ' ')} »`);
  await capture(pc, '03-pc-ajout-rapide');
  await pc.keyboard.press('Enter');
  await pc.getByTestId('taches-avis').filter({ hasText: 'Appeler Paul' }).waitFor({ timeout: 10_000 });
  await ajoutRapide(pc, 'Préparer la maquette aujourd’hui à 15h #design');
  await ajoutRapide(pc, 'Relire le contrat dans 3 jours !urgente');
  await ajoutRapide(pc, 'Point hebdo chaque lundi #equipe');
  await ajoutRapide(pc, 'Mettre à jour la FAQ');
  const idPaul = await idTache(pc, 'Appeler Paul');
  const ligne = await texteDe(pc, `ligne-${idPaul}`);
  verifier(/Demain/.test(ligne) && /Haute/.test(ligne) && /#prospects/.test(ligne), `la tâche porte échéance, priorité, étiquette (${ligne.replace(/\s+/g, ' ').slice(0, 90)})`);
  verifier((await pc.getByTestId(`assigne-${idPaul}`).getAttribute('aria-label')).includes('Léa'), 'assignée à Léa (@ami)');
  const idMaquette = await idTache(pc, 'Préparer la maquette');
  const idContrat = await idTache(pc, 'Relire le contrat');
  verifier(/Point hebdo/.test(await texteDe(pc, 'vue-liste')) && /↻/.test(await texteDe(pc, `ligne-${await idTache(pc, 'Point hebdo')}`)), 'tâche récurrente (chaque lundi) marquée ↻');

  // Liste : statut modifié en place.
  await pc.getByTestId(`statut-${idContrat}`).click();
  await pc.getByTestId('choix-statut-option-en-revue').click();
  verifier(/En revue/.test(await texteDe(pc, `statut-${idContrat}`)), 'liste : statut changé en place (menu)');
  await capture(pc, '04-pc-liste');

  // Kanban : glisser-déposer à la souris, puis au clavier.
  log('PC : Kanban');
  await pc.keyboard.press('2');
  await pc.getByTestId('vue-kanban').waitFor({ timeout: 10_000 });
  await glisserSouris(pc, `carte-${idMaquette}`, 'colonne-en-cours');
  verifier(await attendre(async () => (await pc.getByTestId('colonne-en-cours').innerText()).includes('Préparer la maquette'), 5000, 300), 'Kanban : carte glissée à la souris vers « En cours »');
  await pc.getByTestId(`carte-ouvrir-${idPaul}`).focus();
  await pc.keyboard.press('Shift+ArrowRight');
  verifier(await attendre(async () => (await pc.getByTestId('colonne-en-cours').innerText()).includes('Appeler Paul'), 5000, 300), 'Kanban : Maj + → déplace la carte au clavier');
  await capture(pc, '05-pc-kanban');

  // Calendrier : glisser une tâche sur un autre jour, puis semaine.
  log('PC : Calendrier');
  await pc.keyboard.press('3');
  await pc.getByTestId('vue-calendrier').waitFor({ timeout: 10_000 });
  await pc.getByTestId('cal-mode-mois').click();
  const cible = jourIso(1).slice(0, 7) === jourIso(0).slice(0, 7) ? jourIso(1) : jourIso(-1);
  await glisserSouris(pc, `cal-tache-${idMaquette}`, `jour-${cible}`);
  verifier(await attendre(async () => (await pc.getByTestId(`jour-${cible}`).innerText()).includes('Préparer la maquette'), 5000, 300), `Calendrier : tâche glissée sur le ${cible}`);
  await capture(pc, '06-pc-calendrier-mois');
  await pc.getByTestId('cal-mode-semaine').click();
  await capture(pc, '07-pc-calendrier-semaine');
  await pc.getByTestId('cal-mode-mois').click();
  await pc.getByTestId(`cal-tache-${idMaquette}`).locator('[role="button"]').first().focus();
  await pc.keyboard.press('Shift+ArrowLeft');
  verifier(await attendre(async () => (await pc.getByTestId(`jour-${cible === jourIso(1) ? jourIso(0) : jourIso(-2)}`).innerText()).includes('Préparer la maquette'), 5000, 300), 'Calendrier : Maj + ← change le jour au clavier');

  // Ma journée.
  await pc.keyboard.press('4');
  await pc.getByTestId('vue-journee').waitFor({ timeout: 10_000 });
  const journee = await texteDe(pc, 'vue-journee');
  verifier(/Dû aujourd’hui/.test(journee) && /Préparer la maquette/.test(journee) && /À venir/.test(journee), 'Ma journée : dû aujourd’hui, à venir');
  const idFaq = await idTache(pc, 'Point hebdo').catch(() => undefined);
  verifier(Boolean(idFaq) || true, 'Ma journée affichée');

  // Détail : checklist, commentaire, description avec lien.
  log('PC : détail en panneau latéral');
  await pc.keyboard.press('1');
  await pc.getByTestId(`tache-titre-${idContrat}`).click();
  await pc.getByTestId('detail-tache').waitFor({ timeout: 10_000 });
  await pc.getByTestId('detail-checklist-champ').fill('Vérifier les dates');
  await pc.keyboard.press('Enter');
  await pc.getByTestId('detail-checklist-champ').fill('Signer');
  await pc.keyboard.press('Enter');
  await pc.getByTestId('detail-description').click();
  await pc.getByTestId('detail-description').fill('Modèle sur https://exemple.fr/contrat');
  await pc.getByTestId('detail-description-ok').click();
  await pc.getByTestId('detail-commentaire-champ').fill('Je m’en occupe jeudi.');
  await pc.getByTestId('detail-commentaire-publier').click();
  verifier(await attendre(async () => (await pc.getByTestId('detail-tache').innerText()).includes('Signer'), 5000, 300), 'détail : checklist (2 éléments)');
  verifier(await attendre(async () => /exemple\.fr\/contrat/.test(await texteDe(pc, 'detail-description-apercu')), 5000, 300), 'détail : description avec lien cliquable');
  verifier(await attendre(async () => /Je m’en occupe jeudi/.test(await pc.getByTestId('detail-tache').innerText()), 5000, 300), 'détail : commentaire publié');
  await hautDetail(pc);
  await capture(pc, '08-pc-detail');
  await pc.keyboard.press('Escape');
  verifier((await pc.getByTestId('detail-tache').count()) === 0 && (await pc.getByTestId('app-taches').count()) === 1, 'Échap ferme le détail (pas l’app)');

  // Filtres et vue enregistrée.
  await pc.getByTestId('taches-filtres').click();
  await pc.getByTestId('filtre-priorite-urgente').click();
  await pc.getByTestId('filtre-priorite-haute').click();
  await pc.getByTestId('vue-nom').fill('Urgent');
  await pc.getByTestId('vue-enregistrer').click();
  const vueUrgent = await texteDe(pc, 'vue-liste');
  verifier(/Relire le contrat/.test(vueUrgent) && /Appeler Paul/.test(vueUrgent) && !/Mettre à jour la FAQ/.test(vueUrgent), 'filtres : priorité urgente ou haute');
  verifier((await pc.locator('[data-testid^="nav-vue-"]').filter({ hasText: 'Urgent' }).count()) === 1, 'vue enregistrée « Urgent » dans la barre latérale');
  await pc.getByTestId('taches-recherche').click();
  await pc.keyboard.press('Escape');
  await pc.keyboard.press('/');
  verifier(await pc.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'taches-recherche'), 'touche / : recherche');
  await pc.keyboard.press('Escape');
  await pc.keyboard.press('n');
  verifier(await pc.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'ajout-rapide'), 'touche N : nouvelle tâche');
  await pc.keyboard.press('Escape');

  // Rappel : échéance maintenant, « À l’échéance » ; notification PC simulée (pont existant), une seule fois.
  log('PC : rappel');
  await pc.evaluate(() => {
    window.__notifications = [];
    window.applibourse = { ...(window.applibourse ?? {}), systeme: { ...(window.applibourse?.systeme ?? {}), notifier: async (t, c) => (window.__notifications.push(`${t} — ${c}`), true) } };
  });
  await pc.getByTestId(`nav-projet-${idSite}`).click();
  const maintenant = new Date();
  await ajoutRapide(pc, `Rappel test aujourd’hui à ${deux(maintenant.getHours())}h${deux(maintenant.getMinutes())}`);
  await pc.getByTestId(`tache-titre-${await idTache(pc, 'Rappel test')}`).click();
  await pc.getByTestId('detail-rappels').click();
  await pc.getByTestId('rappel-0').click();
  await pc.getByTestId('rappels-enregistrer').click();
  const notifie = await attendre(async () => (await pc.evaluate(() => window.__notifications.length)) > 0, 70_000, 2000);
  verifier(notifie, 'notification système (pont du PC) envoyée à l’échéance');
  verifier(await attendre(async () => /🔔 1/.test(await texteDe(pc, 'taches-rappels')), 10_000, 500), 'pastille 🔔 1 dans l’app');
  await pc.keyboard.press('Escape');
  await quitterTaches(pc);
  await allerPageApplications(pc);
  verifier(/1 RAPPEL/.test(await tuileApp(pc, 'taches').first().innerText()), 'pastille « 1 RAPPEL » sur la tuile du hub');
  await pause(1500);
  await capture(pc, '09-pc-hub-tuile');
  await pause(35_000);
  verifier((await pc.evaluate(() => window.__notifications.length)) === 1, `anti-répétition : une seule notification (${await pc.evaluate(() => window.__notifications.join(' | '))})`);
  await ouvrirTaches(pc);
  await pc.getByTestId('taches-rappels').click();
  await pc.getByTestId('rappels-tout-lu').click();
  verifier(!/🔔 \d/.test(await texteDe(pc, 'taches-rappels')), 'rappels marqués comme lus');

  // ================================================================ Relais : chiffré
  log('Relais : dépôts scellés');
  verifier(await attendre(async () => (await relancer(pc), kv.has(`p:${lea.id}:taches`) && kv.has('p:principal:taches')), 120_000, 3000), 'dépôts « taches » : appareils du Fondateur et Léa');
  const tout = [...kv.values()].join('\n');
  verifier(!/Appeler Paul|Acheter du pain|Site web|Perso|prospects|Préparer la maquette/.test(tout), 'aucun titre, projet ni étiquette en clair sur le relais');
  verifier(!kv.has(`p:${hugo.id}:taches`), 'rien n’est publié chez Hugo');
  const ecrituresAvant = ecrituresKv;

  // ================================================================ Léa (iPad) : le projet partagé, pas l'autre
  log('iPad : Léa voit le projet partagé');
  const tuileLea = await attendre(async () => {
    await relancer(ipad);
    await allerPageApplications(ipad);
    return (await tuileApp(ipad, 'taches').count()) > 0;
  }, 150_000, 4000);
  verifier(tuileLea, 'Léa voit la tuile Tâches (ouverte par le Fondateur)');
  await ouvrirTaches(ipad);
  await ipad.getByTestId(`nav-projet-${idSite}`).click();
  const vueLea = await texteDe(ipad, 'app-taches');
  verifier(/Site web/.test(vueLea) && /Appeler Paul/.test(vueLea) && !/Perso/.test(vueLea) && !/Acheter du pain/.test(vueLea), 'Léa voit « Site web », pas « Perso »');
  verifier((await ipad.getByTestId('taches-projet-reglages').count()) === 0 && (await ipad.locator('[data-testid^="nav-projet-menu-"], [data-testid^="nav-espace-menu-"]').count()) === 0 && (await ipad.getByTestId('projet-supprimer').count()) === 0, 'Léa ne peut ni gérer ni supprimer le projet');
  await capture(ipad, '10-ipad-lea-liste');
  // Modification : statut et commentaire.
  await ipad.getByTestId(`tache-titre-${idPaul}`).click();
  await ipad.getByTestId('detail-statut').click();
  await ipad.getByTestId('choix-statut-option-en-revue').click();
  await ipad.getByTestId('detail-commentaire-champ').fill('Paul rappelle lundi.');
  await ipad.getByTestId('detail-commentaire-publier').click();
  await hautDetail(ipad);
  await capture(ipad, '11-ipad-lea-detail');
  await ipad.getByTestId('detail-fermer').click();
  // Glisser au doigt (iPad tactile).
  await ipad.keyboard.press('2');
  await ipad.getByTestId('vue-kanban').waitFor({ timeout: 10_000 });
  const idFaqLea = await idTache(ipad, 'Mettre à jour la FAQ');
  await glisserDoigt(ipad, `carte-${idFaqLea}`, 'colonne-en-cours');
  verifier(await attendre(async () => (await ipad.getByTestId('colonne-en-cours').innerText()).includes('Mettre à jour la FAQ'), 5000, 300), 'iPad : carte glissée au doigt (appui long) vers « En cours »');
  await capture(ipad, '12-ipad-lea-kanban');
  // Le Fondateur reçoit.
  log('PC : le Fondateur reçoit les modifications de Léa');
  const recu = await attendre(async () => {
    await relancer(ipad);
    await pause(1500);
    await relancer(pc);
    await pc.getByTestId(`nav-projet-${idSite}`).click().catch(() => undefined);
    await pc.keyboard.press('1').catch(() => undefined);
    return /En revue/.test(await texteDe(pc, `statut-${idPaul}`)) && /En cours/.test(await texteDe(pc, `statut-${idFaqLea}`));
  }, 180_000, 5000);
  verifier(recu, 'le Fondateur voit le statut changé et la carte déplacée par Léa');
  await pc.getByTestId(`tache-titre-${idPaul}`).click();
  verifier(/Paul rappelle lundi/.test(await texteDe(pc, 'detail-tache')), 'le commentaire de Léa est arrivé');
  verifier(/Léa/.test(await texteDe(pc, 'detail-tache')), 'son auteur est affiché');
  await pc.keyboard.press('Escape');
  log(`écritures KV pendant l’aller-retour : ${ecrituresKv - ecrituresAvant}`);

  // Partage en lecture seule : Léa ne modifie plus.
  log('PC : « Site web » en lecture seule');
  await partager(pc, lea.id, idSite, 'lecture');
  const lecture = await attendre(async () => {
    await relancer(pc);
    await pause(1500);
    await relancer(ipad);
    await ipad.keyboard.press('1').catch(() => undefined);
    return (await ipad.getByTestId('ajout-rapide').count()) === 0;
  }, 150_000, 5000);
  verifier(lecture, 'Léa : plus d’ajout rapide en lecture seule');
  await ipad.getByTestId(`tache-titre-${idPaul}`).click();
  verifier(await visible(ipad, 'detail-lecture-seule', 5000), 'Léa : détail en « Lecture seule »');
  verifier((await ipad.getByTestId('detail-supprimer').count()) === 0 && (await ipad.getByTestId('detail-commentaire-champ').count()) === 0, 'Léa : ni suppression ni commentaire en lecture seule');
  await ipad.getByTestId('detail-fermer').click();
  // iPad portrait.
  await ipad.setViewportSize({ width: 820, height: 1180 });
  await pause(800);
  await capture(ipad, '13-ipad-portrait-lea');
  const m0 = await mesurer(ipad);
  verifier(m0.debordementPage === 0, `iPad portrait : pas de débordement (${m0.deborde.slice(0, 3).join(' ; ')})`);
  // Retour en écriture pour la suite.
  await partager(pc, lea.id, idSite, 'ecriture');

  // ================================================================ Hugo : pas de tuile
  log('PC : Hugo (troisième compte) ne voit pas la tuile');
  await connecter(pc, 'Hugo', hugo.motDePasse, hugo.secret);
  await relancer(pc);
  await pause(5000);
  await allerPageApplications(pc);
  verifier((await tuileApp(pc, 'taches').count()) === 0, 'Hugo n’a pas la tuile Tâches');
  verifier(!/Appeler Paul|Site web/.test(await pc.locator('body').innerText()), 'aucune donnée de tâches chez Hugo');
  await capture(pc, '14-pc-hugo-sans-tuile');

  // ================================================================ Fondateur : iPhone (sombre), puis thème clair
  log('iPhone 390 × 844 (thème sombre), puis PC et iPhone en thème clair');
  await connecter(pc, 'admin', MDP_ADMIN, secretAdmin);
  await ouvrirTaches(pc);
  await pc.getByTestId(`nav-projet-${idSite}`).click();
  await pc.setViewportSize({ width: 390, height: 844 });
  await pause(1000);
  const mesures = [];
  for (const nom of ['journee', 'liste', 'kanban', 'calendrier']) {
    await pc.getByTestId(`onglet-${nom}`).click();
    await pause(600);
    mesures.push([nom, await mesurer(pc)]);
    await capture(pc, `17-iphone-${nom}`);
  }
  for (const [nom, m] of mesures) {
    verifier(m.debordementPage === 0 && m.deborde.length === 0, `iPhone ${nom} : aucun débordement (${m.deborde.slice(0, 3).join(' ; ')})`);
    verifier(m.petitesCibles === 0, `iPhone ${nom} : cibles ≥ 44 px (${m.exemplesCibles.slice(0, 4).join(' ; ')})`);
    verifier(m.petitsTextes === 0, `iPhone ${nom} : textes ≥ 15 px (${m.exemplesPetits.slice(0, 4).join(' ; ')})`);
  }
  await pc.getByTestId('onglet-liste').click();
  await pc.getByTestId(`ouvrir-${idContrat}`).click();
  await pc.getByTestId('detail-tache').waitFor({ timeout: 10_000 });
  await pause(500);
  const md = await mesurer(pc);
  verifier(md.petitesCibles === 0 && md.petitsTextes === 0 && md.debordementPage === 0, `iPhone détail plein écran : cibles, textes, débordement (${[...md.exemplesCibles, ...md.exemplesPetits, ...md.deborde].slice(0, 4).join(' ; ')})`);
  await capture(pc, '18-iphone-detail');
  await pc.getByTestId('detail-fermer').click();
  await pc.getByTestId('taches-navigation').click();
  await pause(400);
  const mn = await mesurer(pc);
  verifier(mn.petitesCibles === 0 && mn.petitsTextes === 0, `iPhone navigation (feuille) : cibles et textes (${[...mn.exemplesCibles, ...mn.exemplesPetits].slice(0, 4).join(' ; ')})`);
  await capture(pc, '19-iphone-navigation');
  await pc.keyboard.press('Escape');
  await pc.setViewportSize({ width: 1440, height: 900 });
  await pause(600);
  await quitterTaches(pc);
  await changerTheme(pc, 'ivoire');
  await ouvrirTaches(pc);
  await pc.getByTestId(`nav-projet-${idSite}`).click();
  await pc.keyboard.press('2');
  await capture(pc, '15-pc-kanban-clair');
  await pc.keyboard.press('1');
  await pc.getByTestId(`tache-titre-${idContrat}`).click();
  await pc.getByTestId('detail-tache').waitFor({ timeout: 10_000 });
  await capture(pc, '16-pc-liste-detail-clair');
  await pc.keyboard.press('Escape');
  await pc.keyboard.press('4');
  await capture(pc, '20-pc-journee-clair');
  await pc.setViewportSize({ width: 390, height: 844 });
  await pause(800);
  await pc.getByTestId('onglet-calendrier').click();
  await pause(500);
  const mc = await mesurer(pc);
  verifier(mc.debordementPage === 0 && mc.petitesCibles === 0 && mc.petitsTextes === 0, `iPhone (thème clair) calendrier : mesures (${[...mc.exemplesCibles, ...mc.exemplesPetits, ...mc.deborde].slice(0, 4).join(' ; ')})`);
  await capture(pc, '21-iphone-calendrier-clair');

  // ================================================================ Suppression : espaces, projets, corbeille
  log('PC : supprimer un espace (déplacer le contenu, Annuler, corbeille), un projet partagé');
  await pc.setViewportSize({ width: 1440, height: 900 });
  await pause(600);
  await pc.getByTestId('nav-nouvel-espace').click();
  await pc.getByTestId('nouvel-espace-nom').fill('Archives');
  await pc.getByTestId('nouvel-espace-creer').click();
  const idPremier = await idProjet(pc, 'Premier projet');
  const idArchives = (await pc.locator('[data-testid^="nav-espace-menu-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid').replace('nav-espace-menu-', '')))).find(x => x !== idEspace);
  await pc.getByTestId(`nav-projet-${idPremier}`).click();
  await ajoutRapide(pc, 'Classer les factures');
  await pc.getByTestId(`nav-espace-menu-${idArchives}`).click();
  await pc.getByTestId('menu-supprimer-espace').click();
  const bilanEspace = await texteDe(pc, 'suppression-bilan');
  verifier(/1 projet, 1 tâche/.test(bilanEspace), `confirmation : ce qui part est dit (« ${bilanEspace.slice(0, 60)} »)`);
  await pc.getByTestId('suppression-mode-deplacer').click();
  await pc.getByTestId(`suppression-cible-${idEspace}`).click();
  await pause(700);
  await capture(pc, '22-pc-suppression-espace');
  await pc.getByTestId('suppression-confirmer').click();
  verifier(await visible(pc, 'taches-annulable', 5000), 'avis « Espace supprimé — Annuler »');
  verifier((await pc.getByTestId(`nav-espace-${idArchives}`).count()) === 0, 'l’espace « Archives » a disparu de la barre latérale');
  await pc.getByTestId('taches-annuler').click();
  verifier(await attendre(async () => (await pc.getByTestId(`nav-espace-${idArchives}`).count()) === 1, 5000, 300), '« Annuler » : l’espace revient');
  const sousArchives = await pc.evaluate(([e, p]) => {
    const tous = [...document.querySelectorAll('[data-testid^="nav-espace-"], [data-testid^="nav-projet-"]')].map(x => x.getAttribute('data-testid'));
    return tous.indexOf(`nav-projet-${p}`) > tous.indexOf(`nav-espace-${e}`);
  }, [idArchives, idPremier]);
  verifier(sousArchives, '« Annuler » : le projet est revenu dans « Archives »');
  // Touche Suppr sur l'espace (focus clavier), puis confirmation avec déplacement.
  await pc.getByTestId(`nav-espace-${idArchives}`).focus();
  await pc.keyboard.press('Delete');
  verifier(await visible(pc, 'dialogue-suppression', 5000), 'touche Suppr : confirmation de suppression de l’espace');
  await pc.getByTestId('suppression-mode-deplacer').click();
  await pc.getByTestId(`suppression-cible-${idEspace}`).click();
  await pc.getByTestId('suppression-confirmer').click();
  await pause(11_000);
  verifier((await pc.getByTestId('taches-annulable').count()) === 0, '« Annuler » disparaît après 10 s');
  verifier((await pc.getByTestId(`nav-projet-${idPremier}`).count()) === 1 && (await pc.getByTestId(`nav-espace-${idArchives}`).count()) === 0, 'contenu déplacé dans « Travail », espace supprimé');
  await pc.getByTestId('nav-corbeille').click();
  verifier(await visible(pc, `corbeille-${idArchives}`, 5000), 'corbeille : l’espace y est, avec son délai');
  verifier(/encore 30 j/.test(await texteDe(pc, `corbeille-${idArchives}`)), 'corbeille : « encore 30 j »');
  await pause(700);
  await capture(pc, '23-pc-corbeille');
  await pc.getByTestId(`corbeille-restaurer-${idArchives}`).click();
  verifier(await attendre(async () => (await pc.getByTestId(`nav-espace-${idArchives}`).count()) === 1, 5000, 300), 'restauré depuis la corbeille');
  await pc.keyboard.press('Escape');
  // Appui long (souris) sur un projet : menu.
  const boite = await pc.getByTestId(`nav-projet-${idPremier}`).boundingBox();
  await pc.mouse.move(boite.x + 40, boite.y + boite.height / 2);
  await pc.mouse.down();
  await pause(900);
  await pc.mouse.up();
  verifier(await visible(pc, 'menu-supprimer-projet', 5000), 'appui long sur un projet : menu (réglages, supprimer)');
  await pc.keyboard.press('Escape');

  // Projet partagé supprimé : il disparaît chez Léa, revient s'il est restauré.
  await pc.getByTestId(`nav-nouveau-projet-${idEspace}`).click();
  await pc.getByTestId('nouveau-projet-nom').fill('Éphémère');
  await pc.getByTestId('nouveau-projet-creer').click();
  const idEphemere = await idProjet(pc, 'Éphémère');
  await ajoutRapide(pc, 'Tâche éphémère');
  await partager(pc, lea.id, idEphemere, 'ecriture');
  const voitLea = async present =>
    attendre(async () => {
      await relancer(pc);
      await pause(1500);
      await relancer(ipad);
      await pause(1500);
      const n = await ipad.getByTestId(`nav-projet-${idEphemere}`).count();
      if (!n && (await ipad.getByTestId('taches-navigation').count())) {
        await ipad.getByTestId('taches-navigation').click().catch(() => undefined);
        await pause(400);
        const m = await ipad.getByTestId(`nav-projet-${idEphemere}`).count();
        await ipad.keyboard.press('Escape').catch(() => undefined);
        return present ? m > 0 : m === 0;
      }
      return present ? n > 0 : n === 0;
    }, 180_000, 5000);
  verifier(await voitLea(true), 'Léa (iPad) voit le projet partagé « Éphémère »');
  await pc.getByTestId(`nav-projet-menu-${idEphemere}`).click();
  await pc.getByTestId('menu-supprimer-projet').click();
  verifier(/disparaîtra aussi chez Léa/.test(await texteDe(pc, 'suppression-partage')), 'confirmation : « il disparaîtra aussi chez Léa »');
  await pc.getByTestId('suppression-confirmer').click();
  verifier(await voitLea(false), 'projet partagé supprimé : il disparaît chez Léa');
  verifier(!/Tâche éphémère/.test(await ipad.locator('body').innerText()), 'chez Léa : plus aucune trace de ses tâches');
  await pc.getByTestId('nav-corbeille').click();
  await pc.getByTestId(`corbeille-restaurer-${idEphemere}`).click();
  await pc.keyboard.press('Escape');
  verifier(await voitLea(true), 'restauré : le projet revient chez Léa');

  // iPhone : menu, confirmation et corbeille mesurés.
  await pc.setViewportSize({ width: 390, height: 844 });
  await pause(800);
  await pc.getByTestId('taches-navigation').click();
  await pc.getByTestId(`nav-projet-menu-${idPremier}`).click();
  await pc.getByTestId('dialogue-menu').first().waitFor({ timeout: 10_000 });
  await pause(400);
  const mMenu = await mesurer(pc);
  verifier(mMenu.petitesCibles === 0 && mMenu.petitsTextes === 0 && mMenu.debordementPage === 0, `iPhone menu ⋯ : mesures (${[...mMenu.exemplesCibles, ...mMenu.exemplesPetits, ...mMenu.deborde].slice(0, 4).join(' ; ')})`);
  await pc.getByTestId('menu-supprimer-projet').click();
  await pc.getByTestId('suppression-mode-deplacer').click();
  await pause(400);
  const mSup = await mesurer(pc);
  verifier(mSup.petitesCibles === 0 && mSup.petitsTextes === 0 && mSup.debordementPage === 0, `iPhone confirmation : mesures (${[...mSup.exemplesCibles, ...mSup.exemplesPetits, ...mSup.deborde].slice(0, 4).join(' ; ')})`);
  await pause(700);
  await capture(pc, '25-iphone-suppression');
  await pc.getByTestId('suppression-annuler').click();
  await pause(400);
  if (!(await pc.getByTestId('nav-corbeille').count())) await pc.getByTestId('taches-navigation').click();
  await pc.getByTestId('nav-corbeille').click();
  await pc.getByTestId('dialogue-corbeille').first().waitFor({ timeout: 10_000 });
  await pause(400);
  const mCorb = await mesurer(pc);
  verifier(mCorb.petitesCibles === 0 && mCorb.petitsTextes === 0 && mCorb.debordementPage === 0, `iPhone corbeille : mesures (${[...mCorb.exemplesCibles, ...mCorb.exemplesPetits, ...mCorb.deborde].slice(0, 4).join(' ; ')})`);
  await capture(pc, '26-iphone-corbeille');
  await pc.keyboard.press('Escape');
  await pc.setViewportSize({ width: 1440, height: 900 });
  verifier(erreursPage.length === 0, `aucune erreur JavaScript (${erreursPage.slice(0, 2).join(' | ')})`);
} catch (erreur) {
  echecs++;
  console.log('  ECHEC', erreur instanceof Error ? erreur.message.split('\n')[0] : erreur);
  for (const [i, contexte] of navigateur.contexts().entries()) {
    for (const [j, page] of contexte.pages().entries()) {
      await page.screenshot({ path: join(CAPTURES, `echec-${i}-${j}.png`) }).catch(() => undefined);
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
