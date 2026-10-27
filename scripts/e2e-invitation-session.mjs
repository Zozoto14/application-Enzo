/**
 * Bout en bout du bug de production « Le relais refuse ce code de liaison » (octobre 2026) : le
 * Fondateur, connecté sur un NAVIGATEUR par identifiant (jeton de SESSION `s1.…`, jamais le jeton
 * maître), invite un ami ; l'ami choisit son mot de passe et clique « Créer mon accès ».
 *
 *  1. PC du Fondateur (jeton maître) : coffre, migration vers identifiant + mot de passe (codes) ;
 *  2. navigateur neuf : le Fondateur s'y connecte (session) ;
 *  3. depuis ce navigateur : création de RaphouT → lien → l'ami choisit son mot de passe → son hub ;
 *     puis connexion de RaphouT sur un autre appareil par identifiant ;
 *  4. « Réinitialiser l'accès » (changement de mot de passe de l'ami) : nouveau lien, nouveau mot de
 *     passe ; l'ancien ne marche plus ;
 *  5. invitation dont le lien porte l'ANCIENNE adresse du relais (Worker Cloudflare) : réécrite vers
 *     le relais du site (relais.json), aucune requête vers l'ancien hôte ;
 *  6. « Mot de passe oublié » du Fondateur : identifiant + code de récupération → nouveau mot de passe.
 *
 * FRONTAL=1 : le relais est derrière un faux frontal o2switch (même comportement que
 * scripts/frontal-restrictif.mjs : PUT/DELETE/PATCH et leur préliminaire CORS refusés, page HTML 405).
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-invitation-session.mjs
 *   FRONTAL=1 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-invitation-session.mjs
 *
 * Variables : PLAYWRIGHT_PATH, CAPTURES (défaut docs/captures-invitation-session).
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
import { allerPageAdministration, nouveauContexte, relierCommePc } from './e2e-acceptation.mjs';
import { METHODES_BLOQUEES } from './frontal-restrictif.mjs';

const racine = fileURLToPath(new URL('..', import.meta.url));
const requireGlobal = createRequire(join(process.env.PLAYWRIGHT_PATH ?? '/opt/node22/lib/node_modules', 'x.js'));
const { chromium, devices } = requireGlobal('playwright');
const { relais: coeurRelais } = await import(pathToFileURL(join(racine, 'relais/relais.mjs')).href);
const { coffresMemoire } = await import(pathToFileURL(join(racine, 'relais/coffres.mjs')).href);

const FRONTAL = process.env.FRONTAL === '1';
const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-invitation-session');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-invit-session-0123456789';
const PORT_RELAIS = FRONTAL ? 8873 : 8871;
const PORT_SITE = FRONTAL ? 5273 : 5271;
const RELAIS = `https://localhost:${PORT_RELAIS}`;
const SITE = `http://localhost:${PORT_SITE}/`;
const ANCIEN = 'https://applibourse-relais.enzo-e2e.workers.dev';
const MDP_PC = 'ancien-mot-de-passe-du-pc-e2e-77';
const MDP_ENZO = 'Ma phrase de connexion 2026';
const MDP_ENZO_NOUVEAU = 'Nouvelle phrase du Fondateur 2027';
const MDP_RAPH = 'Raphou solide mot de passe 2026 !';
const MDP_RAPH_NOUVEAU = 'Raphou encore plus solide 2027 ?';

// ------------------------------------------------------------- Relais (vrai cœur, boîte et coffres en mémoire)
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
const journal = [];
const refusFrontal = [];
const reponses401 = [];
const dossier = mkdtempSync(join(tmpdir(), 'e2e-invit-session-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dossier, 'k.pem'), '-out', join(dossier, 'c.pem'), '-subj', '/CN=localhost', '-days', '1'], { stdio: 'ignore' });
const serveurRelais = https.createServer({ key: readFileSync(join(dossier, 'k.pem')), cert: readFileSync(join(dossier, 'c.pem')) }, async (req, res) => {
  const annoncee = String(req.headers['access-control-request-method'] ?? '').toUpperCase();
  if (FRONTAL && (METHODES_BLOQUEES.includes(req.method) || (req.method === 'OPTIONS' && METHODES_BLOQUEES.includes(annoncee)))) {
    refusFrontal.push(`${req.method === 'OPTIONS' ? `OPTIONS(${annoncee})` : req.method} ${req.url}`);
    req.resume();
    res.writeHead(405, { 'Content-Type': 'text/html' });
    res.end('<html><body><h1>405 Method Not Allowed</h1>LiteSpeed (simulé)</body></html>');
    return;
  }
  const morceaux = [];
  for await (const m of req) morceaux.push(m);
  const corps = Buffer.concat(morceaux);
  const requete = new Request(`${RELAIS}${req.url}`, { method: req.method, headers: { ...req.headers, 'x-adresse-client': '198.51.100.9' }, body: ['GET', 'HEAD'].includes(req.method) ? undefined : corps });
  const reponse = await coeurRelais.traiter(requete, env);
  const jeton = String(req.headers.authorization ?? '').replace(/^Bearer\s+/, '');
  journal.push({ methode: req.method, surcharge: req.headers['x-methode'], chemin: req.url.split('?')[0], statut: reponse.status, jeton: jeton === JETON ? 'maitre' : jeton.slice(0, 3) });
  if (reponse.status === 401) reponses401.push(`${req.method} ${req.url}`);
  res.writeHead(reponse.status, Object.fromEntries(reponse.headers));
  res.end(Buffer.from(await reponse.arrayBuffer()));
});
await new Promise(ok => serveurRelais.listen(PORT_RELAIS, ok));

// ------------------------------------------------------------- Site statique (et relais.json, comme sur o2switch)
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
const prefixe = FRONTAL ? 'frontal-' : '';
const capture = (page, nom) => page.screenshot({ path: join(CAPTURES, `${prefixe}${nom}.png`) }).catch(() => undefined);
const texteDe = (page, id, delai = 30_000) => page.getByTestId(id).first().innerText({ timeout: delai }).catch(() => '');
const local = lien => lien.replace(/^https?:\/\/[^/]+\//, SITE);
const fermerBulles = page => page.getByText(/^(Fermer|Terminé|Compris|Plus tard)$/).first().click({ timeout: 2500 }).catch(() => undefined);

async function deverrouiller(page, motDePasse, secretTotp) {
  for (const decalage of [0, 1, -1]) {
    await page.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 });
    await page.locator('input[type=password]').first().fill(motDePasse);
    if (secretTotp) await page.locator('input:not([type=password])').first().fill(totp(secretTotp, decalage));
    await page.getByTestId('bouton-deverrouiller').click();
    if (await page.getByTestId('hub').waitFor({ timeout: 25_000 }).then(() => true, () => false)) return;
    if (!secretTotp) break;
  }
  throw new Error('déverrouillage impossible');
}

/** Connexion par identifiant sur un navigateur neuf (code à six chiffres si le serveur le demande). */
let dernierPasTotp = 0;
async function connecter(page, identifiant, motDePasse, secretTotp) {
  await page.goto(SITE);
  await page.getByTestId('connexion-id-identifiant').waitFor({ timeout: 60_000 });
  await page.getByTestId('connexion-id-identifiant').fill(identifiant);
  await page.getByTestId('connexion-id-mdp').fill(motDePasse);
  await page.getByTestId('connexion-id-valider').click();
  const issue = await Promise.race([
    page.getByTestId('hub').waitFor({ timeout: 120_000 }).then(() => 'hub'),
    page.getByTestId('connexion-id-code').waitFor({ timeout: 120_000 }).then(() => 'code'),
    page.getByTestId('connexion-id-erreur').waitFor({ timeout: 120_000 }).then(() => 'erreur'),
  ]).catch(() => 'rien');
  if (issue === 'code' && secretTotp) {
    // Un code n'est accepté qu'une fois : on attend le pas suivant si besoin.
    while (Math.floor(Date.now() / 30_000) <= dernierPasTotp) await pause(500);
    dernierPasTotp = Math.floor(Date.now() / 30_000);
    await page.getByTestId('connexion-id-code').fill(totp(secretTotp));
    await page.getByTestId('connexion-id-valider').click();
    await page.getByTestId('hub').waitFor({ timeout: 120_000 });
    return 'hub';
  }
  return issue;
}

/** L'ami ouvre un lien d'invitation et choisit son mot de passe ; rend « hub » ou le texte de l'erreur. */
async function accepter(page, lien, motDePasse, nom) {
  await page.goto(lien);
  await page.getByTestId('invitation-mdp').waitFor({ timeout: 90_000 });
  verifier(new RegExp(`Bienvenue, ${nom}`).test(await page.locator('body').innerText()), `écran « Bienvenue, ${nom} ! »`);
  await page.getByTestId('invitation-mdp').fill(motDePasse);
  await page.getByTestId('invitation-mdp-confirmation').fill(motDePasse);
  await page.getByTestId('invitation-valider').click();
  const fin = await Promise.race([
    page.getByTestId('hub').waitFor({ timeout: 120_000 }).then(() => 'hub'),
    page.getByText(/refuse ce code de liaison|Invitation introuvable|a expiré|déjà été utilisée|annulée|ne reconnaît pas|pare-feu|injoignable/).first().waitFor({ timeout: 120_000 }).then(async () => (await page.locator('body').innerText()).slice(0, 400)),
  ]).catch(e => `rien (${e.message.slice(0, 60)})`);
  return fin;
}

/** Fondateur (navigateur B, session) : Administration › Utilisateurs. */
async function ouvrirAdministration(page) {
  await allerPageAdministration(page);
  await page.locator('[data-testid="cellule-administration"], [data-testid="tuile-administration"]').first().click();
  await page.getByTestId('app-administration').waitFor({ timeout: 20_000 });
  await page.getByTestId('admin-onglet-utilisateurs').click();
}
/** Toujours dans l'Administration : retour à la liste des comptes. */
async function revenirAuxUtilisateurs(page) {
  if (!(await page.getByTestId('app-administration').isVisible().catch(() => false))) await ouvrirAdministration(page);
  await page.getByTestId('admin-onglet-utilisateurs').click();
}
let secretFondateur;
async function confirmerIdentite(page, motDePasse) {
  if (!(await page.getByTestId('admin-identite-mdp').waitFor({ timeout: 6_000 }).then(() => true, () => false))) return;
  for (const decalage of [0, 1, -1]) {
    await page.getByTestId('admin-identite-mdp').fill(motDePasse);
    const champCode = page.getByTestId('admin-identite-code');
    if (secretFondateur && (await champCode.isVisible().catch(() => false))) await champCode.fill(totp(secretFondateur, decalage));
    await page.getByTestId('admin-identite-valider').click({ timeout: 5_000 }).catch(() => undefined);
    if (await page.getByTestId('admin-identite').waitFor({ state: 'detached', timeout: 15_000 }).then(() => true, () => false)) return;
  }
}
async function creerCompte(page, nom) {
  await page.getByTestId('admin-nouveau').click();
  await page.getByTestId('admin-nom').fill(nom);
  await page.getByTestId('admin-nouveau-informe').click();
  await page.getByTestId('admin-creer').click();
  await confirmerIdentite(page, MDP_ENZO);
  await page.locator('[data-testid="admin-invitation"], [data-testid="admin-invitation-erreur"]').first().waitFor({ timeout: 90_000 });
  const erreur = await texteDe(page, 'admin-invitation-erreur', 1000);
  const lien = (await texteDe(page, 'admin-invitation-lien', 10_000)).trim();
  await page.getByTestId('admin-transmis').click().catch(() => undefined);
  await page.getByTestId('admin-termine').click().catch(() => undefined);
  return { lien, erreur };
}

const navigateur = await chromium.launch({ headless: true });
const options = { ignoreHTTPSErrors: true, viewport: { width: 1200, height: 860 }, permissions: ['clipboard-read', 'clipboard-write'] };
const iphone = { ...devices['iPhone 13'], ignoreHTTPSErrors: true };
delete iphone.defaultBrowserType;
log(FRONTAL ? 'Relais DERRIÈRE le frontal o2switch simulé (PUT/DELETE coupés)' : 'Relais en direct (sans frontal)');
try {
  // ================================================================ 1. PC du Fondateur
  log('PC du Fondateur (jeton maître) : coffre, puis identifiant + mot de passe');
  const contexteA = await nouveauContexte(navigateur, options);
  await contexteA.addInitScript(() => localStorage.setItem('e2e.migration', 'garder'));
  const A = await contexteA.newPage();
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
  secretFondateur = secret;
  await A.getByRole('switch').click();
  await A.getByTestId('bouton-continuer').click();
  await A.getByTestId('hub').waitFor({ timeout: 60_000 });
  await fermerBulles(A);
  await relierCommePc(A, CODE_PC);
  await deverrouiller(A, MDP_PC, secret);
  await fermerBulles(A);
  await A.keyboard.press('Escape').catch(() => undefined);
  await A.getByTestId('fondateur-connexion').waitFor({ timeout: 60_000 });
  await A.getByTestId('fondateur-identifiant').fill('Enzo');
  await A.getByTestId('fondateur-mdp-actuel').fill(MDP_PC);
  await A.getByTestId('fondateur-totp').fill(totp(secret));
  dernierPasTotp = Math.floor(Date.now() / 30_000);
  await A.getByTestId('fondateur-changer-mdp').click();
  await A.getByTestId('fondateur-mdp').fill(MDP_ENZO);
  await A.getByTestId('fondateur-mdp-confirmation').fill(MDP_ENZO);
  await A.getByTestId('fondateur-valider').click();
  await A.getByTestId('fondateur-connexion-faite').waitFor({ timeout: 90_000 });
  const codes = (await texteDe(A, 'fondateur-codes')).split('\n').map(c => c.trim()).filter(Boolean);
  verifier(codes.length === 10, 'migration : dix codes de récupération');
  await A.getByTestId('fondateur-codes-notes').click();
  verifier([...kv.keys()].some(c => c.startsWith('acces:')), 'accès par identifiant du Fondateur publié' + (FRONTAL ? ' (derrière le frontal)' : ''));
  // Le coffre serveur du Fondateur doit être publié avant la connexion d'un navigateur neuf.
  await pause(3000);
  await contexteA.close();

  // ================================================================ 2. Navigateur du Fondateur (SESSION)
  log('Navigateur neuf : le Fondateur se connecte par identifiant (session s1.)');
  const B = await (await nouveauContexte(navigateur, options)).newPage();
  B.on('pageerror', e => log('erreur page B :', e.message));
  verifier((await connecter(B, 'Enzo', MDP_ENZO, secret)) === 'hub', 'Fondateur connecté sur le navigateur');
  await fermerBulles(B);
  const jetonsB = journal.filter(a => a.jeton && a.jeton !== 'maitre' && /^\/v(9|10)\/coffre\/principal/.test(a.chemin));
  verifier(jetonsB.length > 0 && jetonsB.every(a => a.jeton === 's1.'), 'le navigateur du Fondateur parle avec une SESSION (cas de production)');

  // ================================================================ 3. Invitation de RaphouT depuis ce navigateur
  log('Navigateur du Fondateur : création de RaphouT et invitation');
  await ouvrirAdministration(B);
  const raph = await creerCompte(B, 'RaphouT');
  verifier(/#invitation=AI1\./.test(raph.lien) && !raph.erreur, `lien d’invitation créé depuis la session${raph.erreur ? ` (erreur : ${raph.erreur})` : ''}`);
  verifier(journal.some(a => /^\/v10\/jeton-profil\//.test(a.chemin) && a.statut === 200), 'jeton de profil de RaphouT demandé au serveur (pas calculé avec la session)');
  verifier([...kv.keys()].some(c => c.startsWith('inv:')), 'invitation déposée sur le serveur' + (FRONTAL ? ' malgré le frontal (POST + X-Methode)' : ''));
  await capture(B, '01-fondateur-invitation');

  log('RaphouT ouvre son lien, choisit son mot de passe, « Créer mon accès »');
  const tel = await (await nouveauContexte(navigateur, iphone)).newPage();
  const avant401 = reponses401.length;
  const fin = await accepter(tel, local(raph.lien), MDP_RAPH, 'RaphouT');
  verifier(fin === 'hub', `RaphouT arrive sur son hub (${fin === 'hub' ? 'ok' : fin})`);
  verifier(reponses401.length === avant401, `aucun refus 401 du relais pendant l’acceptation (${reponses401.slice(avant401).join(', ') || 'aucun'})`);
  await capture(tel, '02-raphout-hub');

  log('RaphouT sur un autre appareil : identifiant + mot de passe');
  const autre = await (await nouveauContexte(navigateur, options)).newPage();
  verifier((await connecter(autre, 'raphout', MDP_RAPH)) === 'hub', 'RaphouT connecté sur un autre appareil');

  // ================================================================ 4. Changement de mot de passe (Réinitialiser l'accès)
  log('Fondateur : « Réinitialiser l’accès » de RaphouT (nouveau mot de passe)');
  await revenirAuxUtilisateurs(B);
  await B.locator('[data-testid^="admin-ligne-"]').filter({ hasText: 'RaphouT' }).first().click();
  await B.getByTestId('admin-invitation-envoyer').waitFor({ timeout: 30_000 });
  await B.getByTestId('admin-invitation-envoyer').click();
  await confirmerIdentite(B, MDP_ENZO);
  await B.getByTestId('admin-invitation-lien').first().waitFor({ timeout: 90_000 });
  const lienReinit = (await texteDe(B, 'admin-invitation-lien', 10_000)).trim();
  verifier(/#invitation=AI1\./.test(lienReinit) && lienReinit !== raph.lien, 'nouveau lien (réinitialisation)');
  await capture(B, '03-fondateur-reinitialisation');
  const tel2 = await (await nouveauContexte(navigateur, iphone)).newPage();
  const fin2 = await accepter(tel2, local(lienReinit), MDP_RAPH_NOUVEAU, 'RaphouT');
  verifier(fin2 === 'hub', `RaphouT choisit un nouveau mot de passe (${fin2 === 'hub' ? 'ok' : fin2})`);
  const ancienRefuse = await (await nouveauContexte(navigateur, options)).newPage();
  verifier((await connecter(ancienRefuse, 'RaphouT', MDP_RAPH)) === 'erreur', 'l’ancien mot de passe de RaphouT est refusé');
  const nouveauOk = await (await nouveauContexte(navigateur, options)).newPage();
  verifier((await connecter(nouveauOk, 'RaphouT', MDP_RAPH_NOUVEAU)) === 'hub', 'le nouveau mot de passe de RaphouT marche');
  // Le premier lien, déjà utilisé : la vraie raison.
  const tel3 = await (await nouveauContexte(navigateur, iphone)).newPage();
  await tel3.goto(local(raph.lien));
  const raison = await tel3.getByText(/déjà été utilisée|annulée ou remplacée/).first().waitFor({ timeout: 60_000 }).then(() => true, () => false);
  verifier(raison, 'ancien lien : « déjà utilisée » / « remplacée », pas « refuse ce code de liaison »');

  // ================================================================ 5. Lien à l'ancienne adresse du relais
  log('Invitation de Nina dont le lien porte l’ancienne adresse du relais (Worker Cloudflare)');
  await revenirAuxUtilisateurs(B);
  const nina = await creerCompte(B, 'Nina');
  const code = /AI1\.([A-Za-z0-9_-]+)/.exec(nina.lien)[1];
  const corps = JSON.parse(Buffer.from(code.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  const lienAncien = `${SITE}#invitation=AI1.${base64url(JSON.stringify({ ...corps, r: ANCIEN }))}`;
  const tel4ctx = await nouveauContexte(navigateur, iphone);
  const versAncien = [];
  tel4ctx.on('request', r => {
    if (r.url().startsWith(ANCIEN)) versAncien.push(`${r.method()} ${r.url()}`);
  });
  const tel4 = await tel4ctx.newPage();
  const fin4 = await accepter(tel4, lienAncien, 'Nina a un mot de passe 2026 !', 'Nina');
  verifier(fin4 === 'hub', `Nina entre avec un lien à l’ancienne adresse (${fin4 === 'hub' ? 'ok' : fin4})`);
  verifier(versAncien.length === 0, `aucune requête vers l’ancien relais (${versAncien.length})`);

  // ================================================================ 6. Mot de passe oublié (Fondateur)
  log('Fondateur : « Mot de passe oublié » avec un code de récupération');
  const C = await (await nouveauContexte(navigateur, options)).newPage();
  await C.goto(SITE);
  await C.getByTestId('connexion-oubli').waitFor({ timeout: 60_000 });
  await C.getByTestId('connexion-oubli').click();
  await C.getByTestId('connexion-secours').waitFor({ timeout: 30_000 });
  const champIdentifiant = C.getByTestId('connexion-id-identifiant');
  if (await champIdentifiant.isVisible().catch(() => false)) await champIdentifiant.fill('Enzo');
  await C.getByTestId('connexion-secours-code').fill(codes[2]);
  await C.getByTestId('connexion-secours-mdp').fill(MDP_ENZO_NOUVEAU);
  await C.getByTestId('connexion-secours-confirmation').fill(MDP_ENZO_NOUVEAU);
  await C.getByTestId('connexion-secours-valider').click();
  const nouveauxCodes = await C.getByTestId('fondateur-codes').waitFor({ timeout: 120_000 }).then(() => true, () => false);
  verifier(nouveauxCodes, 'mot de passe oublié : nouveau mot de passe, nouveaux codes affichés');
  await capture(C, '04-fondateur-secours');
  const D = await (await nouveauContexte(navigateur, options)).newPage();
  verifier((await connecter(D, 'Enzo', MDP_ENZO_NOUVEAU, secret)) === 'hub', 'le Fondateur se connecte avec son nouveau mot de passe');

  if (FRONTAL) {
    verifier(refusFrontal.length > 0, `le frontal a bien coupé des PUT/DELETE (${refusFrontal.length}), tout est passé en POST + X-Methode`);
    verifier(journal.some(a => a.methode === 'POST' && a.surcharge), 'des requêtes POST + X-Methode ont atteint le relais');
  }
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
