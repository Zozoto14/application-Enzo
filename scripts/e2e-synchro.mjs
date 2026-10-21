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
import { allerPageAdministration, allerPageApplications, nouveauContexte, tuileApp } from './e2e-acceptation.mjs';

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
  // Seuls les dépôts du portefeuille comptent ici (pas ceux des comptes, dans /p/…).
  if (req.method === 'PUT' && req.url.startsWith('/boite/')) compteurs.put++;
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
  const contexteA = await nouveauContexte(navigateur, { ignoreHTTPSErrors: true, viewport: { width: 1100, height: 800 } });
  const contexteB = await nouveauContexte(navigateur, { ignoreHTTPSErrors: true, viewport: { width: 1100, height: 800 } });
  const A = await contexteA.newPage();
  const B = await contexteB.newPage();
  for (const [nom, p] of [['A', A], ['B', B]]) p.on('pageerror', e => log(`erreur page ${nom}:`, e.message));

  // ----- Appareil A : création du coffre, liaison au relais
  log('A : premier lancement');
  await A.goto(URL_SITE);
  // Navigateur neuf : relier d'abord ; ici, on crée un coffre neuf (après l'avertissement).
  await A.getByTestId('accueil-creer').click({ timeout: 60_000 });
  await A.getByTestId('accueil-creer-confirmer').click();
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
  // Navigateur déjà relié avant la mise à jour (relais sans coffre serveur : ancienne synchronisation).
  await B.goto(URL_SITE);
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
  // Plus de section Synchronisation : l'état de la connexion au serveur est dans Général (« Réessayer »).
  await A.getByTestId('parametres-section-general').click();
  await A.getByTestId('synchro-maintenant').scrollIntoViewIfNeeded();
  await A.screenshot({ path: join(CAPTURES, '05b-A-parametres-connexion-serveur.png') });
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

  // ----- Sources Tsuzuku du compte : ajoutées sur A, reçues sur B ; désactivées sur B, reçues sur A ; supprimées
  log('Tsuzuku : sources du compte entre A et B');
  const SOURCE = { name: 'Médiathèque synchro', baseUrl: 'https://mediatheque-exemple.fr', language: 'vostfr', search: { path: '/recherche?q={query}', item: 'li.carte', title: 'a', link: 'a' }, episodes: { item: 'li.ep', number: '.num', link: 'a' }, player: { iframe: 'iframe' } };
  const ouvrirSources = async pg => {
    await pg.getByTestId('hub-parametres-fermer').click().catch(() => undefined);
    if (!(await pg.getByTestId('tsuzuku-racine').count())) {
      await pg.getByTestId('retour-hub').click().catch(() => undefined);
      await pg.getByTestId('hub').waitFor({ timeout: 20_000 });
      await allerPageApplications(pg);
      await tuileApp(pg, 'tsuzuku').first().click();
      await pg.getByTestId('tsuzuku-racine').waitFor({ timeout: 20_000 });
    }
    await pg.getByTestId('onglet-app-accueil').click();
    await pg.getByTestId('onglet-app-sources').click();
    await pg.getByTestId('tsuzuku-sources').waitFor({ timeout: 20_000 });
  };
  /** Attend une condition sur la page Sources de `pg`, en relançant le tour (retour au premier plan) et en rouvrant la page. */
  const attendreSources = async (pg, condition, delai = 120_000) => {
    const debutS = Date.now();
    while (Date.now() - debutS < delai) {
      await pg.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await pause(4000);
      await ouvrirSources(pg);
      if (await condition()) return true;
    }
    return false;
  };
  await ouvrirSources(A);
  await A.getByTestId('sources-ajouter').click();
  await A.getByTestId('sources-json').click();
  await A.getByTestId('assistant-json').fill(JSON.stringify(SOURCE));
  await A.getByTestId('assistant-verifier').click();
  await A.getByTestId('assistant-suivant').click();
  await A.getByTestId('assistant-enregistrer').click();
  await A.getByTestId('source-nouvelle').waitFor({ timeout: 20_000 });
  verifier(await A.getByTestId('sources-synchro-en-attente').count().then(n => n === 1, () => false) || await A.getByTestId('sources-synchro-synchronise').count().then(n => n === 1), 'A : pastille de synchro des sources affichée');
  await A.screenshot({ path: join(CAPTURES, '10-A-source-ajoutee-en-attente.png') });
  const synchroA = await A.getByTestId('sources-synchro-synchronise').waitFor({ timeout: 90_000 }).then(() => true, () => false);
  verifier(synchroA, 'A : la source part seule (déclencheur après modification), pastille « Synchronisé »');
  await A.screenshot({ path: join(CAPTURES, '11-A-source-synchronisee.png') });
  const recueB = await attendreSources(B, async () => (await B.getByText('Médiathèque synchro', { exact: true }).count()) > 0);
  verifier(recueB, 'B (même compte, autre appareil) reçoit la source ajoutée sur A');
  verifier(!JSON.stringify([...kv.values()]).includes('mediatheque-exemple.fr'), 'relais : l’adresse de la source n’y est jamais en clair (charge chiffrée)');
  await B.screenshot({ path: join(CAPTURES, '12-B-source-recue.png') });
  // B désactive la source : A reçoit l'état.
  await B.locator('[data-testid^="source-activer-"]').first().click();
  await pause(800);
  const desactiveeA = await attendreSources(A, async () => (await A.locator('[data-testid^="source-activer-"]').first().innerText().catch(() => '')).includes('Activer'));
  verifier(desactiveeA, 'A reçoit la désactivation faite sur B');
  // A supprime la source : B la perd (pierre tombale), elle ne renaît pas.
  await A.locator('[data-testid^="source-supprimer-"]').first().click();
  const supprimeeB = await attendreSources(B, async () => (await B.getByText('Médiathèque synchro', { exact: true }).count()) === 0);
  verifier(supprimeeB, 'B : la source supprimée sur A disparaît');
  await pause(5000);
  await ouvrirSources(A);
  verifier((await A.getByText('Médiathèque synchro', { exact: true }).count()) === 0, 'A : la source supprimée ne renaît pas');
  await B.screenshot({ path: join(CAPTURES, '13-B-source-supprimee.png') });
  for (const pg of [A, B]) {
    await pg.getByTestId('retour-hub').click().catch(() => undefined);
    await pg.getByTestId('hub').waitFor({ timeout: 20_000 }).catch(() => undefined);
  }

  // ----- Un seul thème pour toutes les pages, pastille de synchro partout, démarrage sans flash
  log('A : thème unique et pastille de synchro dans le portefeuille et l’administration');
  const rgb = hex => `rgb(${Number.parseInt(hex.slice(1, 3), 16)}, ${Number.parseInt(hex.slice(3, 5), 16)}, ${Number.parseInt(hex.slice(5, 7), 16)})`;
  // Fond effectif d'un élément : celui de son premier ancêtre non transparent.
  const fondDe = (page, id) =>
    page.getByTestId(id).first().evaluate(e => {
      for (let n = e; n; n = n.parentElement) {
        const c = getComputedStyle(n).backgroundColor;
        if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c;
      }
      return 'transparent';
    });
  const TERMINAL = rgb('#0A0A0A');
  const IVOIRE = rgb('#F6F3EC');
  await A.getByTestId('hub').waitFor({ timeout: 30_000 });
  verifier((await fondDe(A, 'hub')) === TERMINAL, 'hub au thème Terminal');

  await A.getByTestId('tuile-portefeuille').click();
  await A.getByTestId('entete-app').waitFor({ timeout: 30_000 });
  verifier((await A.locator('[data-testid="entete-app"] [data-testid="synchro-indicateur"]').count()) === 1, 'portefeuille : la pastille de synchro est dans l’en-tête');
  verifier(/À jour|attente|Synchronisation/.test(await A.locator('[data-testid="entete-app"] [data-testid="synchro-libelle"]').textContent()), 'portefeuille : la pastille dit l’état');
  verifier((await fondDe(A, 'entete-app')) === TERMINAL, 'portefeuille au thème Terminal (celui du hub)');
  await A.screenshot({ path: join(CAPTURES, '07-portefeuille-pastille-synchro.png') });
  await A.locator('[data-testid="entete-app"] [data-testid="synchro-indicateur"]').click();
  await A.getByTestId('parametres-panneau-general').waitFor({ timeout: 10_000 });
  await A.getByTestId('reglage-synchro-etat').waitFor({ timeout: 10_000 });
  verifier(true, 'la pastille du portefeuille ouvre Paramètres › Général (connexion au serveur)');
  await A.getByTestId('hub-parametres-fermer').click();
  await A.getByTestId('entete-app').waitFor({ timeout: 10_000 });
  verifier(true, 'Retour ramène au portefeuille');
  await A.keyboard.press('Escape');
  await A.getByTestId('hub').waitFor({ timeout: 10_000 });

  await allerPageAdministration(A);
  await A.getByTestId('tuile-administration').click();
  await A.getByTestId('retour-hub').waitFor({ timeout: 30_000 });
  verifier((await A.getByTestId('synchro-indicateur').count()) === 1 && (await A.getByTestId('app-parametres-ouvrir').count()) === 1, 'administration : pastille de synchro et bouton Paramètres dans la barre');
  verifier((await fondDe(A, 'app-administration')) === TERMINAL, 'administration au thème Terminal');
  await A.screenshot({ path: join(CAPTURES, '08-administration-pastille-synchro.png') });

  // Le thème change depuis la page Paramètres et s'applique à toutes les pages.
  await A.getByTestId('app-parametres-ouvrir').click();
  await A.getByTestId('parametres-theme-ivoire').click();
  await pause(300);
  verifier((await fondDe(A, 'hub-parametres')) === IVOIRE, 'page Paramètres en Ivoire');
  await A.screenshot({ path: join(CAPTURES, '09-parametres-general-ivoire.png') });
  await A.getByTestId('hub-parametres-fermer').click();
  verifier((await fondDe(A, 'app-administration')) === IVOIRE, 'administration passée en Ivoire');
  await A.keyboard.press('Escape');
  await A.getByTestId('hub').waitFor({ timeout: 10_000 });
  await allerPageApplications(A);
  verifier((await fondDe(A, 'hub')) === IVOIRE, 'hub passé en Ivoire');
  await A.getByTestId('tuile-portefeuille').click();
  await A.getByTestId('entete-app').waitFor({ timeout: 10_000 });
  verifier((await fondDe(A, 'entete-app')) === IVOIRE, 'portefeuille passé en Ivoire');
  await A.screenshot({ path: join(CAPTURES, '10-portefeuille-ivoire.png') });
  await A.keyboard.press('Escape');

  // Chaque section, la recherche, le clavier.
  log('A : sections, recherche, clavier');
  await A.getByTestId('hub-parametres-ouvrir').click();
  for (const id of ['general', 'securite', 'portefeuille', 'administration', 'nouveautes', 'apropos']) {
    await A.getByTestId(`parametres-section-${id}`).click();
    await A.getByTestId(`parametres-panneau-${id}`).waitFor({ timeout: 10_000 });
    await A.screenshot({ path: join(CAPTURES, `11-parametres-${id}.png`) });
  }
  verifier((await A.getByTestId('parametres-section-synchro').count()) === 0, 'plus de section « Synchronisation »');
  verifier(true, 'les sections s’ouvrent');
  await A.getByTestId('parametres-recherche').fill('récupération');
  await A.getByTestId('parametres-resultats').waitFor({ timeout: 10_000 });
  const trouves = await A.locator('[data-testid^="reglage-"]').count();
  verifier(trouves >= 1 && (await A.getByTestId('reglage-codes-recuperation').count()) === 1, `recherche « récupération » : ${trouves} réglage(s), dont les codes de récupération`);
  await A.screenshot({ path: join(CAPTURES, '12-parametres-recherche.png') });
  await A.keyboard.press('Escape');
  await pause(300);
  verifier((await A.getByTestId('parametres-recherche').inputValue()) === '' && (await A.getByTestId('hub-parametres').count()) === 1, 'Échap efface la recherche sans fermer la page');
  await A.getByTestId('parametres-section-general').focus();
  await A.keyboard.press('ArrowDown');
  await pause(300);
  verifier((await A.getByTestId('parametres-section-securite').getAttribute('aria-selected')) === 'true', 'flèche bas : section suivante');
  await A.keyboard.press('ArrowUp');
  await pause(300);
  verifier((await A.getByTestId('parametres-section-general').getAttribute('aria-selected')) === 'true', 'flèche haut : section précédente');
  await A.getByTestId('parametres-section-general').focus();
  await A.keyboard.press('/');
  await pause(300);
  verifier(await A.getByTestId('parametres-recherche').evaluate(e => e === document.activeElement), 'la touche « / » va à la recherche');
  await A.keyboard.press('Escape');
  await A.getByTestId('hub').waitFor({ timeout: 10_000 });
  verifier(true, 'Échap ferme la page Paramètres');

  // Les huit thèmes s'appliquent à la page Paramètres et au portefeuille.
  for (const id of ['nuit', 'ivoire', 'ivoire-couleur', 'nuit-editoriale', 'sauge', 'nuit-vive', 'blocs', 'terminal']) {
    await A.getByTestId('hub-parametres-ouvrir').click();
    await A.getByTestId(`parametres-theme-${id}`).click();
    await pause(150);
    await A.screenshot({ path: join(CAPTURES, `13-theme-${id}-parametres.png`) });
    await A.getByTestId('hub-parametres-fermer').click();
  }
  await A.getByTestId('hub-parametres-ouvrir').click();
  await A.getByTestId('parametres-theme-ivoire').click();
  await A.getByTestId('hub-parametres-fermer').click();
  await pause(500);

  // Lancement à froid : l'écran de connexion est déjà en Ivoire, sans image dans un autre thème.
  log('A : lancement à froid avec le thème Ivoire mémorisé');
  await A.addInitScript(() => {
    window.__fonds = new Set();
    const relever = () => {
      // Deux coins de la page (hors champs de saisie, dont le fond est celui des cartes).
      for (const [x, y] of [[4, 4], [window.innerWidth - 4, window.innerHeight - 4]]) {
        let n = document.elementFromPoint(x, y);
        let couleur = 'transparent';
        for (; n; n = n.parentElement) {
          const c = getComputedStyle(n).backgroundColor;
          if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') {
            couleur = c;
            break;
          }
        }
        window.__fonds.add(couleur);
      }
      requestAnimationFrame(relever);
    };
    requestAnimationFrame(relever);
  });
  await A.reload();
  await A.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 });
  await A.screenshot({ path: join(CAPTURES, '14-lancement-a-froid-connexion-ivoire.png') });
  const fondsConnexion = await A.evaluate(() => [...window.__fonds]);
  verifier(fondsConnexion.length > 0 && fondsConnexion.every(c => c === IVOIRE || c === 'transparent'), `écran de connexion déjà en Ivoire (fonds vus : ${fondsConnexion.join(' | ')})`);
  await deverrouiller(A, secret);
  await A.getByTestId('synchro-indicateur').waitFor({ timeout: 60_000 });
  await pause(800);
  const fondsApres = await A.evaluate(() => [...window.__fonds]);
  verifier(fondsApres.every(c => c === IVOIRE || c === 'transparent'), `aucun flash au déverrouillage (fonds vus : ${fondsApres.join(' | ')})`);
  await A.screenshot({ path: join(CAPTURES, '15-hub-apres-deverrouillage-ivoire.png') });

  // Mobile 390 px.
  log('A : mobile 390 px');
  await A.setViewportSize({ width: 390, height: 844 });
  await pause(300);
  // Téléphone : les Paramètres s'ouvrent par la barre basse (« Réglages ») ; liste → sous-page → « ‹ Réglages ».
  await A.getByTestId('barre-basse-parametres').click();
  for (const id of ['general', 'securite', 'portefeuille', 'administration', 'apropos']) {
    if (id !== 'general') await A.getByTestId('parametres-retour').click();
    await A.getByTestId(`parametres-section-${id}`).click();
    await A.getByTestId(`parametres-panneau-${id}`).waitFor({ timeout: 10_000 });
    const debord = await A.evaluate(() => {
      const largeur = window.innerWidth;
      const cartes = [...document.querySelectorAll('[data-testid^="reglage-"]')];
      return { pageDebordante: document.documentElement.scrollWidth > largeur + 1, cartesDebordantes: cartes.filter(c => c.getBoundingClientRect().right > largeur + 1).length };
    });
    verifier(!debord.pageDebordante && debord.cartesDebordantes === 0, `390 px, section ${id} : pas de défilement horizontal de la page`);
    await A.screenshot({ path: join(CAPTURES, `16-mobile-${id}.png`) });
  }
  await A.getByTestId('parametres-retour').click();
  await A.getByTestId('hub-parametres-fermer').click();
  await allerPageApplications(A);
  await A.getByTestId('tuile-portefeuille').click();
  await A.getByTestId('entete-app').waitFor({ timeout: 10_000 });
  await A.screenshot({ path: join(CAPTURES, '17-mobile-portefeuille.png') });

  log(`relais : ${compteurs.put} PUT, ${compteurs.get} GET`);
} finally {
  await navigateur.close();
  serveurRelais.close();
  serveurSite.close();
}
console.log(echecs === 0 ? 'E2E OK' : `E2E : ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
