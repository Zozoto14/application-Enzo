/**
 * Test de bout en bout de la synchronisation : deux « appareils » (deux
 * contextes Chromium) et un faux relais local qui exécute relais/worker.mjs.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-synchro.mjs
 *
 * Variables : PLAYWRIGHT_PATH (dossier de node_modules contenant playwright),
 * CAPTURES (dossier des captures, défaut docs/captures-synchro).
 * Rien n'est installé ni versionné : le certificat auto-signé vit dans un
 * dossier temporaire.
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

const racine = fileURLToPath(new URL('..', import.meta.url));
const requireGlobal = createRequire(join(process.env.PLAYWRIGHT_PATH ?? '/opt/node22/lib/node_modules', 'x.js'));
const { chromium } = requireGlobal('playwright');
const worker = (await import(pathToFileURL(join(racine, 'relais/worker.mjs')).href)).default;

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-synchro');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-0123456789abcdef';
const PORT_RELAIS = 8788;
const PORT_SITE = 5199;
const MOT_DE_PASSE = 'un-mot-de-passe-e2e-très-long-42';

// ------------------------------------------------------------- Faux relais
const kv = new Map();
const compteurs = { put: 0, get: 0 };
const env = {
  JETON,
  BOITE: {
    get: async cle => (kv.has(cle) ? kv.get(cle) : null),
    put: async (cle, valeur) => void kv.set(cle, valeur),
    delete: async cle => void kv.delete(cle),
  },
};
const dossier = mkdtempSync(join(tmpdir(), 'e2e-synchro-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dossier, 'k.pem'), '-out', join(dossier, 'c.pem'), '-subj', '/CN=localhost', '-days', '1'], { stdio: 'ignore' });
const serveurRelais = https.createServer({ key: readFileSync(join(dossier, 'k.pem')), cert: readFileSync(join(dossier, 'c.pem')) }, async (req, res) => {
  const morceaux = [];
  for await (const m of req) morceaux.push(m);
  const corps = Buffer.concat(morceaux);
  if (req.method === 'PUT') compteurs.put++;
  if (req.method === 'GET' && req.url.startsWith('/boite')) compteurs.get++;
  const requete = new Request(`https://localhost:${PORT_RELAIS}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : corps,
  });
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

// ------------------------------------------------------------------- TOTP
function base32(texte) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of texte.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
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
const base64url = t => Buffer.from(t).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const CODE = 'AB1.' + base64url(JSON.stringify({ r: `https://localhost:${PORT_RELAIS}`, j: JETON }));
const URL_SITE = `http://localhost:${PORT_SITE}/#liaison=${CODE}`;
const pause = ms => new Promise(ok => setTimeout(ok, ms));
const log = (...a) => console.log('[e2e]', ...a);
let echecs = 0;
const verifier = (ok, message) => {
  console.log(ok ? '  OK   ' : '  ECHEC', message);
  if (!ok) echecs++;
};
const attendreTexte = async (page, motif, delai = 60_000) => {
  await page.getByText(motif).first().waitFor({ timeout: delai });
};
const libelleSynchro = async page => (await page.getByTestId('synchro-libelle').first().textContent({ timeout: 5000 }).catch(() => null)) ?? '(absent)';

async function deverrouiller(page, secret) {
  await page.locator('input[type=password]').first().fill(MOT_DE_PASSE);
  for (const decalage of [0, 1, -1]) {
    await page.locator('input:not([type=password])').first().fill(totp(secret, decalage));
    await page.getByTestId('bouton-deverrouiller').click();
    const reussi = await page.getByTestId('hub').waitFor({ timeout: 25_000 }).then(() => true, () => false);
    if (reussi) return;
  }
  throw new Error('déverrouillage impossible');
}

const navigateur = await chromium.launch({ headless: true });
try {
  const contexteA = await navigateur.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1100, height: 800 } });
  const contexteB = await navigateur.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1100, height: 800 } });
  const A = await contexteA.newPage();
  const B = await contexteB.newPage();
  for (const [nom, p] of [['A', A], ['B', B]]) p.on('pageerror', e => log(`erreur page ${nom}:`, e.message));

  // ----- Appareil A : création du coffre, liaison au relais
  log('A : premier lancement');
  await A.goto(URL_SITE);
  const champs = A.locator('input[type=password]');
  await champs.nth(0).waitFor({ timeout: 60_000 });
  await champs.nth(0).fill(MOT_DE_PASSE);
  await champs.nth(1).fill(MOT_DE_PASSE);
  await A.getByTestId('bouton-creer').click();
  await A.getByText('À noter maintenant').waitFor({ timeout: 60_000 });
  const secret = ((await A.locator('body').innerText()).match(/\b[A-Z2-7]{16,}\b/) ?? [])[0];
  if (!secret) throw new Error('secret TOTP introuvable');
  await A.getByRole('switch').click();
  await A.getByTestId('bouton-continuer').click();
  await A.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(async () => {
    log('A : déverrouillage après création');
    await deverrouiller(A, secret);
  });
  await A.getByTestId('synchro-indicateur').waitFor({ timeout: 60_000 });
  await attendreTexte(A, /À jour/);
  verifier(true, `A relié : « ${await libelleSynchro(A)} »`);
  await A.screenshot({ path: join(CAPTURES, '01-A-a-jour.png') });

  // Le portefeuille de A a un dépôt et un coffre sur le relais : B peut se lier.
  const coffreSurRelais = () => kv.has('appareil:coffre');
  for (let i = 0; i < 30 && !coffreSurRelais(); i++) await pause(1000);
  verifier(coffreSurRelais(), 'le coffre de A est déposé sur le relais');
  // A a marqué le devblog « vu » juste après son premier dépôt : ce marquage part au dépôt suivant
  // (délai minimal de 30 s entre deux dépôts). On laisse ce dépôt partir avant de lier B.
  const putsCreation = compteurs.put;
  for (let i = 0; i < 70 && compteurs.put === putsCreation; i++) await pause(1000);
  verifier(compteurs.put > putsCreation, `le dépôt de A avec les versions vues du devblog est parti (${compteurs.put - putsCreation} dépôt(s) après le premier)`);

  // ----- Appareil B : « Lier à mon compte », déverrouillage
  log('B : liaison');
  await B.goto(URL_SITE);
  await B.getByTestId('bouton-lier-compte').waitFor({ timeout: 60_000 });
  await B.getByTestId('bouton-lier-compte').click();
  await B.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 });
  await deverrouiller(B, secret);
  await B.getByTestId('synchro-indicateur').waitFor({ timeout: 60_000 });
  await attendreTexte(B, /À jour/);
  verifier((await B.getByTestId('dialogue-devblog').count()) === 0 && (await B.getByText('Quoi de neuf').count()) === 0, 'B (profil relié, non neuf) n’affiche pas les patch notes grâce aux versions vues de A');
  await B.screenshot({ path: join(CAPTURES, '02-B-lie-sans-devblog.png') });

  // ----- A : change le thème du hub, l'ordre des tuiles, lit le devblog
  log('A : thème + tuiles + nouveautés');
  await A.getByTestId('hub-parametres-ouvrir').click();
  await A.getByTestId('parametres-theme-ivoire').click();
  await A.getByTestId('hub-parametres-fermer').click();
  await A.getByTestId('hub-personnaliser').click();
  const avant = A.locator('[data-testid^="edit-"][data-testid$="-avant"]:not([aria-disabled="true"])').first();
  const cellulesAvant = await A.locator('[data-testid^="cellule-"]').evaluateAll(n => n.map(e => e.getAttribute('data-testid')));
  await avant.click();
  await A.getByTestId('hub-terminer').click();
  const cellulesApres = await A.locator('[data-testid^="cellule-"]').evaluateAll(n => n.map(e => e.getAttribute('data-testid')));
  verifier(JSON.stringify(cellulesAvant) !== JSON.stringify(cellulesApres), `A : ordre des tuiles changé (${cellulesAvant.join(',')} → ${cellulesApres.join(',')})`);
  await A.getByTestId('hub-parametres-ouvrir').click();
  await A.getByTestId('parametres-section-nouveautes').click();
  await A.getByTestId('parametres-nouveautes').click();
  await A.getByText(/Synchronisation complète/).first().waitFor({ timeout: 10_000 });
  await A.screenshot({ path: join(CAPTURES, '03-A-devblog.png') });
  await A.keyboard.press('Escape');
  await A.getByText(/Terminé|Fermer|J’ai compris|Compris/).first().click({ timeout: 3000 }).catch(() => undefined);
  await pause(500);
  // Le devblog s'ouvre par-dessus la page Paramètres : on revient au hub.
  await A.getByTestId('hub-parametres-fermer').click().catch(() => undefined);

  // ----- B reçoit sans aucune action (retour au premier plan)
  log('B : retour au premier plan, attente de la réception automatique');
  const themeB = () => B.evaluate(() => document.querySelector('[data-testid="hub"]') && getComputedStyle(document.querySelector('[data-testid="hub"]')).backgroundColor);
  const themeAvantB = await themeB();
  const debut = Date.now();
  let recu = false;
  while (Date.now() - debut < 90_000 && !recu) {
    // On simule le retour de B au premier plan (dans un vrai navigateur, l'onglet redevient visible).
    await B.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await pause(4000);
    recu = (await themeB()) !== themeAvantB;
  }
  verifier(recu, `B a reçu le thème du hub de A sans action (${Math.round((Date.now() - debut) / 1000)} s)`);
  const cellulesB = await B.locator('[data-testid^="cellule-"]').evaluateAll(n => n.map(e => e.getAttribute('data-testid')));
  verifier(JSON.stringify(cellulesB) === JSON.stringify(cellulesApres), `B a le même ordre de tuiles que A (${cellulesB.join(',')})`);
  await B.screenshot({ path: join(CAPTURES, '04-B-recoit-theme-tuiles.png') });

  // ----- Rechargement de B : pas de patch notes, préférences conservées
  log('B : relance (« lancement du site »)');
  await B.reload();
  await B.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 });
  await deverrouiller(B, secret);
  await B.getByTestId('synchro-indicateur').waitFor({ timeout: 60_000 });
  await pause(1500);
  verifier((await B.getByText('Quoi de neuf').count()) === 0, 'B relancé : pas de patch notes');
  const cellulesB2 = await B.locator('[data-testid^="cellule-"]').evaluateAll(n => n.map(e => e.getAttribute('data-testid')));
  verifier(JSON.stringify(cellulesB2) === JSON.stringify(cellulesApres), 'B relancé : ordre des tuiles conservé');

  // ----- Coupure réseau sur A
  log('A : coupure du réseau');
  await contexteA.setOffline(true);
  await A.getByTestId('hub-parametres-ouvrir').click();
  await A.getByTestId('parametres-theme-terminal').click();
  await A.getByTestId('parametres-disposition-liste').click().catch(() => undefined);
  await A.getByText(/en attente \(hors ligne\)/).first().waitFor({ timeout: 30_000 });
  const libHors = await libelleSynchro(A);
  verifier(/en attente \(hors ligne\)/.test(libHors), `A hors ligne : « ${libHors} »`);
  await A.screenshot({ path: join(CAPTURES, '05-A-hors-ligne-en-attente.png') });
  await A.getByTestId('parametres-section-synchro').click();
  await A.getByTestId('synchro-maintenant').scrollIntoViewIfNeeded();
  await A.screenshot({ path: join(CAPTURES, '05b-A-parametres-synchronisation.png') });
  const putsAvant = compteurs.put;
  log('A : retour du réseau');
  await contexteA.setOffline(false);
  await A.getByText(/À jour/).first().waitFor({ timeout: 90_000 });
  await A.getByTestId('hub-parametres-fermer').click().catch(() => undefined);
  verifier(compteurs.put > putsAvant, `A : envoi automatique au retour en ligne (${compteurs.put - putsAvant} dépôt(s))`);
  await A.screenshot({ path: join(CAPTURES, '06-A-de-retour-a-jour.png') });

  // ----- B reçoit le nouveau thème
  const fond2 = await themeB();
  const debut2 = Date.now();
  let recu2 = false;
  while (Date.now() - debut2 < 90_000 && !recu2) {
    await B.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await pause(4000);
    recu2 = (await themeB()) !== fond2;
  }
  verifier(recu2, 'B a reçu le thème « terminal » choisi hors ligne sur A');
  log(`relais : ${compteurs.put} PUT, ${compteurs.get} GET`);
} finally {
  await navigateur.close();
  serveurRelais.close();
  serveurSite.close();
}
console.log(echecs === 0 ? 'E2E OK' : `E2E : ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
