/**
 * Test de bout en bout du parcours d'accès d'un ami (docs/connexion-amis.md) :
 * le Fondateur crée Léa sur son « PC », copie le message d'invitation ; Léa
 * ouvre le lien sur un iPhone NEUF (émulation iPhone Safari : agent, écran,
 * tactile), choisit son mot de passe et se connecte ; puis son deuxième
 * appareil (identifiant + mot de passe), les pièges réels (accents NFC/NFD,
 * espaces et retour à la ligne collés, identifiant en majuscules, champs sans
 * majuscule ni correction automatiques), invitation réutilisée, expirée,
 * profil pas encore publié, relais injoignable, réinitialisation, révocation,
 * ancien ami (code de liaison + TOTP) toujours valable, et relais pas encore
 * redéployé (invitation « lien », message « relais à mettre à jour »).
 * Faux relais local qui exécute relais/relais.mjs (version 6).
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-connexion-amis.mjs
 *
 * Variables : PLAYWRIGHT_PATH (dossier de node_modules contenant playwright),
 * CAPTURES (dossier des captures, défaut docs/captures-connexion-amis).
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
import { allerPageAdministration, nouveauContexte } from './e2e-acceptation.mjs';

const racine = fileURLToPath(new URL('..', import.meta.url));
const requireGlobal = createRequire(join(process.env.PLAYWRIGHT_PATH ?? '/opt/node22/lib/node_modules', 'x.js'));
const { chromium, devices } = requireGlobal('playwright');
const moduleRelais = await import(pathToFileURL(join(racine, 'relais/relais.mjs')).href);
const worker = { fetch: moduleRelais.relais.traiter };

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-connexion-amis');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-amis-0123456789abcdef';
const PORT_RELAIS = 8797;
const PORT_SITE = 5217;
const RELAIS = `https://localhost:${PORT_RELAIS}`;
const SITE = `http://localhost:${PORT_SITE}/`;
const MDP_ADMIN = 'mot-de-passe-du-fondateur-e2e-42';
const MDP_LEA = 'Été à Biarritz 2026';

// ------------------------------------------------------------- Faux relais (vrai relais, boîte en mémoire)
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
/** Pannes et situations simulées. */
const relais = {
  /** Relais d'avant la version 6 (pas encore redéployé). */
  ancien: false,
  /** Relais injoignable (connexion coupée). */
  horsLigne: false,
  /** Comptes déjà publiés : tout AUTRE espace ne se publie pas (appareil du Fondateur « éteint » avant de publier). */
  bloquerSauf: undefined,
  /** Adresse IP vue par le relais (anti-force brute par adresse). */
  ip: '198.51.100.1',
};
const journal = [];
const dossier = mkdtempSync(join(tmpdir(), 'e2e-amis-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dossier, 'k.pem'), '-out', join(dossier, 'c.pem'), '-subj', '/CN=localhost', '-days', '1'], { stdio: 'ignore' });
const serveurRelais = https.createServer({ key: readFileSync(join(dossier, 'k.pem')), cert: readFileSync(join(dossier, 'c.pem')) }, async (req, res) => {
  if (relais.horsLigne) {
    req.socket.destroy();
    return;
  }
  const morceaux = [];
  for await (const m of req) morceaux.push(m);
  const corps = Buffer.concat(morceaux);
  const entetes = { ...req.headers, 'x-adresse-client': relais.ip };
  const chemin = req.url.split('?')[0];
  const nouvelleRoute = /^\/(invitations|acces|revocations)\//.test(chemin);
  if (relais.ancien && nouvelleRoute && req.method !== 'OPTIONS') {
    // Relais d'avant : jeton exigé partout, routes inconnues.
    const jeton = String(req.headers.authorization ?? '').replace(/^Bearer\s+/, '');
    const statut = jeton ? 404 : 401;
    res.writeHead(statut, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ erreur: statut === 401 ? 'Jeton du relais manquant ou incorrect.' : 'Adresse inconnue.' }));
    return;
  }
  const espacePublie = /^\/p\/([a-z0-9]+)\/boite\//.exec(chemin)?.[1];
  if (relais.bloquerSauf && req.method === 'PUT' && espacePublie && espacePublie !== 'principal' && !relais.bloquerSauf.has(espacePublie)) {
    res.writeHead(503, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' });
    res.end('{"erreur":"indisponible"}');
    return;
  }
  const requete = new Request(`${RELAIS}${req.url}`, { method: req.method, headers: entetes, body: ['GET', 'HEAD'].includes(req.method) ? undefined : corps });
  let reponse = await worker.fetch(requete, env);
  if (relais.ancien && chemin === '/sante' && req.method === 'GET' && reponse.ok) {
    const lu = await reponse.json();
    delete lu.fonctions;
    reponse = new Response(JSON.stringify({ ...lu, version: 5 }), { status: 200, headers: reponse.headers });
  }
  journal.push({ methode: req.method, chemin, statut: reponse.status });
  res.writeHead(reponse.status, Object.fromEntries(reponse.headers));
  res.end(Buffer.from(await reponse.arrayBuffer()));
});
await new Promise(ok => serveurRelais.listen(PORT_RELAIS, ok));

// ------------------------------------------------------------- Site statique (et relais.json)
const site = { relaisJson: true };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const dist = join(racine, 'bureau/dist');
const serveurSite = http.createServer((req, res) => {
  const chemin = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  if (chemin === '/relais.json') {
    if (!site.relaisJson) {
      res.writeHead(404);
      res.end();
      return;
    }
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
  const compteur = Math.floor(Date.now() / 30000) + decalage;
  const tampon = Buffer.alloc(8);
  tampon.writeBigUInt64BE(BigInt(compteur));
  const h = createHmac('sha1', base32(secret)).update(tampon).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, '0');
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
const attendre = async (condition, delai = 90_000, pas = 1000) => {
  const debut = Date.now();
  while (Date.now() - debut < delai) {
    if (await condition()) return true;
    await pause(pas);
  }
  return false;
};
/** Le lien pointe vers le site de production : on le sert ici. */
const local = lien => lien.replace(/^https?:\/\/[^/]+\//, SITE);
const texteDe = (page, id, delai = 60_000) => page.getByTestId(id).first().innerText({ timeout: delai }).catch(() => '');

async function deverrouiller(page, motDePasse, secret, attendu = 'hub') {
  for (const decalage of [0, 1, -1]) {
    await page.locator('input[type=password]').first().fill(motDePasse);
    if (secret) await page.locator('input:not([type=password])').first().fill(totp(secret, decalage));
    await page.getByTestId('bouton-deverrouiller').click();
    if (await page.getByTestId(attendu).waitFor({ timeout: 25_000 }).then(() => true, () => false)) return;
    if (!secret) break;
  }
  throw new Error('déverrouillage impossible');
}

async function confirmerIdentite(page, secret) {
  // Identité vérifiée il y a peu : l'Administration ne la redemande pas.
  if (!(await page.getByTestId('admin-identite-mdp').waitFor({ timeout: 8_000 }).then(() => true, () => false))) return;
  for (const decalage of [0, 1, -1]) {
    await page.getByTestId('admin-identite-mdp').fill(MDP_ADMIN);
    await page.getByTestId('admin-identite-code').fill(totp(secret, decalage));
    await page.getByTestId('admin-identite-valider').click();
    if (await page.getByTestId('admin-identite').waitFor({ state: 'detached', timeout: 15_000 }).then(() => true, () => false)) return;
  }
  throw new Error('vérification d’identité impossible');
}

async function ouvrirAdministration(page) {
  await allerPageAdministration(page);
  await page.locator('[data-testid="cellule-administration"], [data-testid="tuile-administration"]').first().click();
  await page.getByTestId('app-administration').waitFor({ timeout: 20_000 });
}

/** Crée un ami depuis l'Administration ; rend son invitation et ses identifiants manuels. */
async function creerAmi(page, nom, { jours } = {}) {
  await page.getByTestId('admin-onglet-utilisateurs').click();
  await page.getByTestId('admin-nouveau').click();
  await page.getByTestId('admin-nom').fill(nom);
  if (jours) await page.getByTestId('admin-nouveau-invitation').fill(String(jours));
  await page.getByTestId('admin-nouveau-informe').click();
  await page.getByTestId('admin-creer').click();
  await page.getByTestId('admin-identifiants').waitFor({ timeout: 90_000 });
  await page.locator('[data-testid="admin-invitation"], [data-testid="admin-invitation-erreur"], [data-testid="admin-invitation-indisponible"]').first().waitFor({ timeout: 90_000 });
  const lien = (await texteDe(page, 'admin-invitation-lien', 5_000)).trim();
  const codeCourt = (await texteDe(page, 'admin-invitation-code-court', 2_000)).trim();
  const publie = (await page.getByTestId('admin-invitation-publie').count()) > 0;
  const nonPublie = (await page.getByTestId('admin-invitation-non-publie').count()) > 0;
  const avertissement = await texteDe(page, 'admin-invitation-avertissement', 1_000);
  const motDePasse = (await page.getByTestId('admin-mot-de-passe').innerText()).replace(/^\s*Mot de passe\s*/, '').trim();
  const secret = (await page.getByTestId('admin-secret-totp').innerText()).replace(/^\s*Clé TOTP\s*/, '').replace(/\s+/g, '');
  return { lien, codeCourt, publie, nonPublie, avertissement, motDePasse, secret };
}
async function terminerIdentifiants(page) {
  await page.getByTestId('admin-transmis').click().catch(() => undefined);
  await page.getByTestId('admin-termine').click();
}

/** Ouvre une invitation dans un navigateur neuf et choisit le mot de passe. */
async function accepter(page, lien, motDePasse, confirmation = motDePasse) {
  await page.goto(local(lien));
  await page.getByTestId('invitation-mdp').waitFor({ timeout: 60_000 });
  await page.getByTestId('invitation-mdp').fill(motDePasse);
  await page.getByTestId('invitation-mdp-confirmation').fill(confirmation);
  await page.getByTestId('invitation-valider').click();
}

const iphone = { ...devices['iPhone 13'], ignoreHTTPSErrors: true, permissions: [] };
delete iphone.defaultBrowserType;
const navigateur = await chromium.launch({ headless: true });
const optionsPc = { ignoreHTTPSErrors: true, viewport: { width: 1280, height: 860 }, permissions: ['clipboard-read', 'clipboard-write'] };
const nouvelIphone = async () => {
  const page = await (await nouveauContexte(navigateur, iphone)).newPage();
  page.on('pageerror', e => log('erreur page iPhone :', e.message));
  return page;
};
try {
  // ================================================================ PC du Fondateur
  const pc = await (await nouveauContexte(navigateur, optionsPc)).newPage();
  pc.on('pageerror', e => log('erreur page PC :', e.message));
  log('PC : coffre du Fondateur (Enzo), relié au relais');
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
  await pc.keyboard.press('Escape').catch(() => undefined);
  await ouvrirAdministration(pc);

  // ---------------------------------------------------------------- Ancien ami (méthode d'avant), créé avant tout
  log('PC : Hugo, ami « à l’ancienne » (code de liaison + mot de passe + TOTP)');
  const hugo = await creerAmi(pc, 'Hugo');
  await terminerIdentifiants(pc);

  log('PC : création de Léa, invitation');
  const lea = await creerAmi(pc, 'Léa');
  verifier(/#invitation=AI1\./.test(lea.lien), `lien d’invitation (secret dans le fragment #) : ${lea.lien.slice(0, 60)}…`);
  verifier(!lea.lien.includes(lea.motDePasse) && !lea.lien.includes(JETON) && !lea.lien.includes('p1.'), 'le lien ne porte ni mot de passe, ni jeton');
  verifier(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/.test(lea.codeCourt), `code court à taper : ${lea.codeCourt}`);
  verifier(lea.publie, 'compte de Léa publié sur le relais dès l’invitation (« ✓ Compte publié »)');
  await pc.getByTestId('admin-invitation-copier').click();
  const message = await pc.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  verifier(message.includes(lea.lien) && /Ton identifiant : Léa/.test(message) && !message.includes(lea.motDePasse), `« Copier le message d’invitation » : lien + instructions, sans mot de passe (${message.split('\n')[0]})`);
  await capture(pc, '01-pc-invitation-lea');
  const valeursRelais = [...kv.values()].join('\n');
  verifier(!valeursRelais.includes(lea.motDePasse) && !valeursRelais.includes(MDP_LEA), 'le relais ne contient aucun mot de passe en clair');
  await terminerIdentifiants(pc);

  // ================================================================ iPhone neuf de Léa
  log('iPhone neuf (Safari) : Léa ouvre le lien');
  const tel = await nouvelIphone();
  await tel.goto(local(lea.lien));
  await tel.getByTestId('invitation-identifiant').waitFor({ timeout: 60_000 });
  verifier((await tel.getByTestId('invitation-identifiant').innerText()).trim() === 'Léa', 'l’écran montre son identifiant : Léa');
  const champ = tel.getByTestId('invitation-mdp');
  const attributs = await champ.evaluate(e => ({ cap: e.getAttribute('autocapitalize'), cor: e.getAttribute('autocorrect'), ortho: e.getAttribute('spellcheck'), auto: e.getAttribute('autocomplete'), type: e.getAttribute('type') }));
  verifier((attributs.cap === 'none' || attributs.cap === 'off') && attributs.cor === 'off' && attributs.ortho === 'false' && attributs.auto === 'new-password' && attributs.type === 'password', `champ sans majuscule ni correction automatiques, gestionnaire de mots de passe (${JSON.stringify(attributs)})`);
  await champ.fill('lea12345');
  await tel.getByTestId('invitation-mdp-confirmation').fill('lea12345');
  verifier((await tel.getByTestId('invitation-valider').getAttribute('aria-disabled')) === 'true', 'mot de passe trop faible : refusé, règles affichées');
  verifier(/10 caractères/.test(await texteDe(tel, 'invitation-regles', 5_000)), 'règle « 10 caractères au moins » affichée');
  await capture(tel, '02-iphone-invitation-regles');
  await champ.fill(MDP_LEA);
  // Confirmation collée depuis une note : espaces et retour à la ligne autour.
  await tel.getByTestId('invitation-mdp-confirmation').fill(`  ${MDP_LEA}\n`);
  verifier(/Force : (Solide|Excellent|Bien)/.test(await texteDe(tel, 'invitation-force-libelle')), `indicateur de force : ${await texteDe(tel, 'invitation-force-libelle')}`);
  await capture(tel, '03-iphone-invitation-mot-de-passe');
  await tel.getByTestId('invitation-valider').click();
  await tel.getByTestId('hub').waitFor({ timeout: 90_000 });
  verifier(true, 'Léa est connectée (sans code TOTP, sans code de liaison)');
  await tel.getByText(/Fermer|Terminé|Compris|Plus tard/).first().click({ timeout: 3000 }).catch(() => undefined);
  await capture(tel, '04-iphone-lea-connectee');
  verifier(!tel.url().includes('invitation='), 'l’adresse ne garde plus l’invitation (un rechargement ne la rejoue pas)');

  log('iPhone : verrouillage puis reconnexion (prénom pré-rempli, mot de passe seul, saisie NFD + espaces)');
  await tel.reload();
  await tel.getByTestId('connexion-prenom').waitFor({ timeout: 60_000 });
  verifier((await tel.getByTestId('connexion-prenom').inputValue()) === 'Léa', 'identifiant retenu sur cet appareil');
  await tel.getByTestId('connexion-prenom').fill('Lea Martin');
  await tel.getByTestId('connexion-continuer').click();
  const inconnu = await texteDe(tel, 'connexion-prenom-erreur', 20_000);
  verifier(/Identifiant inconnu/.test(inconnu), `identifiant inconnu : message précis (« ${inconnu.slice(0, 80)}… »)`);
  await tel.getByTestId('connexion-prenom').fill('  LEA ');
  await tel.getByTestId('connexion-continuer').click();
  await tel.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 });
  verifier((await tel.locator('input').count()) === 1, 'déverrouillage : un seul champ (mot de passe), pas de code à six chiffres');
  await tel.locator('input[type=password]').first().fill('été à biarritz 2026');
  await tel.getByTestId('bouton-deverrouiller').click();
  const mauvais = await tel.getByText(/Mot de passe incorrect/).first().innerText({ timeout: 30_000 }).catch(() => '');
  verifier(/Mot de passe incorrect/.test(mauvais), `mot de passe faux (casse) : « ${mauvais.slice(0, 60)}… »`);
  await capture(tel, '05-iphone-mot-de-passe-incorrect');
  await deverrouiller(tel, `  ${MDP_LEA.normalize('NFD')}\n`);
  verifier(true, 'mot de passe saisi en NFD (iOS), avec espaces et retour à la ligne : accepté');

  log('Invitation volée réutilisée');
  const voleur = await nouvelIphone();
  await voleur.goto(local(lea.lien));
  const reutilisee = await texteDe(voleur, 'invitation-erreur');
  verifier(/déjà été utilisée/.test(reutilisee), `invitation rejouée : « ${reutilisee.slice(0, 70)}… »`);
  await capture(voleur, '06-invitation-deja-utilisee');

  // ================================================================ Deuxième appareil de Léa (PC, navigateur neuf)
  log('Deuxième appareil (PC de Léa) : identifiant + mot de passe, site seul');
  relais.ip = '198.51.100.2';
  const pcLea = await (await nouveauContexte(navigateur, optionsPc)).newPage();
  await pcLea.goto(SITE);
  await pcLea.getByTestId('connexion-id-identifiant').waitFor({ timeout: 60_000 });
  const attrId = await pcLea.getByTestId('connexion-id-identifiant').evaluate(e => ({ cap: e.getAttribute('autocapitalize'), auto: e.getAttribute('autocomplete') }));
  verifier(attrId.auto === 'username', `identifiant : autocomplete=username (${JSON.stringify(attrId)})`);
  await capture(pcLea, '07-pc-site-connexion');
  await pcLea.getByTestId('connexion-id-identifiant').fill('Lucas');
  await pcLea.getByTestId('connexion-id-mdp').fill(MDP_LEA);
  await pcLea.getByTestId('connexion-id-valider').click();
  const erreurInconnu = await texteDe(pcLea, 'connexion-id-erreur');
  await pcLea.getByTestId('connexion-id-identifiant').fill(' LÉA ');
  await pcLea.getByTestId('connexion-id-mdp').fill('mauvais mot de passe');
  await pcLea.getByTestId('connexion-id-valider').click();
  const erreurMdp = await texteDe(pcLea, 'connexion-id-erreur');
  // Relais version 9 : la même réponse pour un identifiant inconnu et un mot de passe faux (pas d'énumération des comptes).
  verifier(/Identifiant ou mot de passe incorrect/.test(erreurInconnu) && erreurInconnu === erreurMdp, `identifiant inconnu et mot de passe faux : même message neutre (« ${erreurMdp.slice(0, 50)}… »)`);
  await pcLea.getByTestId('connexion-id-mdp').fill(`${MDP_LEA}\n`);
  await pcLea.getByTestId('connexion-id-valider').click();
  await pcLea.getByTestId('hub').waitFor({ timeout: 90_000 });
  verifier(true, 'Léa connectée sur son deuxième appareil (identifiant en majuscules, retour à la ligne collé)');
  await capture(pcLea, '08-pc-lea-connectee');

  log('Anti-force brute : essais répétés sur l’identifiant de Léa');
  relais.ip = '198.51.100.3';
  const brute = await (await nouveauContexte(navigateur, optionsPc)).newPage();
  await brute.goto(SITE);
  await brute.getByTestId('connexion-id-identifiant').waitFor({ timeout: 60_000 });
  await brute.getByTestId('connexion-id-identifiant').fill('Léa');
  let dernier = '';
  for (let i = 0; i < 6; i++) {
    relais.ip = `198.51.100.${10 + i}`;
    await brute.getByTestId('connexion-id-mdp').fill(`essai-${i}-faux-mot`);
    await brute.getByTestId('connexion-id-valider').click();
    await brute.getByTestId('connexion-id-valider').waitFor({ timeout: 60_000 });
    dernier = await texteDe(brute, 'connexion-id-erreur');
  }
  verifier(/Trop de tentatives/.test(dernier), `délai progressif côté relais, même en changeant d’adresse : « ${dernier} »`);
  await capture(brute, '09-trop-de-tentatives');
  // Le délai est levé (simulé) pour la suite.
  for (const cle of [...kv.keys()].filter(c => c.startsWith('limite:acces:'))) kv.delete(cle);

  // Relais version 9 : plus de « code de connexion au site » (AB1) ; un ancien ami (comme Hugo) se connecte par
  // identifiant + mot de passe après « Réinitialiser l'accès » (nouveau lien), voir docs/connexion-amis.md.
  void hugo;

  // ================================================================ Profil pas encore publié
  log('Zoé : le PC « s’éteint » avant de publier son compte');
  await pc.getByTestId('admin-onglet-journal').click();
  const idsAvant = new Set([...kv.keys()].map(c => /^(?:p:|inv-profil:)([a-z0-9]+)/.exec(c)?.[1]).filter(Boolean));
  // L'identifiant de Zoé n'est connu qu'à la création : aucun espace nouveau ne se publie.
  relais.bloquerSauf = idsAvant;
  const zoe = await creerAmi(pc, 'Zoé');
  const idZoe = [...kv.keys()].map(c => /^inv-profil:([a-z0-9]+)/.exec(c)?.[1]).find(id => id && !idsAvant.has(id));
  verifier(zoe.nonPublie || !kv.has(`p:${idZoe}:coffre`), 'Administration : « pas encore publié : gardez l’app ouverte »');
  await capture(pc, '10-pc-non-publie');
  await terminerIdentifiants(pc);
  const telZoe = await nouvelIphone();
  if (!kv.has(`p:${idZoe}:coffre`)) {
    await accepter(telZoe, zoe.lien, 'Une phrase pour Zoé 7');
    const nonPublie = await texteDe(telZoe, 'invitation-erreur');
    verifier(/pas encore publié.*demande à .*d’ouvrir AppDashboard/s.test(nonPublie), `message clair : « ${nonPublie.slice(0, 110)}… »`);
    await capture(telZoe, '11-iphone-non-publie');
  } else {
    verifier(false, 'le blocage de publication de Zoé n’a pas pris');
  }
  relais.bloquerSauf = undefined;
  await pc.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const publieZoe = await attendre(async () => {
    await pc.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    return kv.has(`p:${idZoe}:coffre`) && kv.has(`p:${idZoe}:annuaire`);
  }, 150_000, 3000);
  verifier(publieZoe, 'le PC rallumé publie le compte de Zoé');
  await telZoe.getByTestId('invitation-valider').click();
  await telZoe.getByTestId('hub').waitFor({ timeout: 90_000 }).catch(() => undefined);
  verifier((await telZoe.getByTestId('hub').count()) > 0, 'même lien, nouvel essai : Zoé est connectée');

  // ================================================================ Invitation expirée
  log('Invitation expirée');
  const ines = await creerAmi(pc, 'Inès', { jours: 1 });
  await terminerIdentifiants(pc);
  for (const [cle, valeur] of kv) {
    if (!cle.startsWith('inv:')) continue;
    const inv = JSON.parse(valeur);
    if (inv.etat === 'active') kv.set(cle, JSON.stringify({ ...inv, expire: Date.now() - 60_000 }));
  }
  const telInes = await nouvelIphone();
  await telInes.goto(local(ines.lien));
  const expiree = await texteDe(telInes, 'invitation-erreur');
  verifier(/expiré.*Renvoyer une invitation/s.test(expiree), `invitation expirée : « ${expiree.slice(0, 90)}… »`);
  await capture(telInes, '12-invitation-expiree');

  // ================================================================ Relais injoignable
  log('Relais injoignable');
  relais.horsLigne = true;
  const telHors = await nouvelIphone();
  await telHors.goto(local(ines.lien));
  const hors = await texteDe(telHors, 'invitation-erreur');
  verifier(/injoignable.*connexion Internet/s.test(hors), `relais injoignable : « ${hors.slice(0, 80)}… »`);
  relais.horsLigne = false;

  // ================================================================ Réinitialisation (mot de passe oublié)
  log('Léa a oublié son mot de passe : le Fondateur réinitialise son accès');
  await pc.getByTestId('admin-onglet-utilisateurs').click();
  await pc.getByText('Léa', { exact: true }).first().click();
  // Le retour de Léa (connexion, appareils) arrive au tour suivant du PC.
  await attendre(async () => {
    await pc.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    return /Actif/.test(await texteDe(pc, 'admin-acces-etat', 2_000));
  }, 120_000, 3000);
  const etatLea = await texteDe(pc, 'admin-acces-etat');
  verifier(/Actif · dernière connexion/.test(etatLea), `fiche : état clair (« ${etatLea} »)`);
  await pc.getByTestId('admin-invitation-envoyer').click();
  await confirmerIdentite(pc, secretAdmin);
  await pc.getByTestId('admin-invitation-lien').waitFor({ timeout: 90_000 });
  const lienReset = (await pc.getByTestId('admin-invitation-lien').innerText()).trim();
  verifier(lienReset !== lea.lien && /#invitation=AI1\./.test(lienReset), 'nouveau lien de réinitialisation');
  await capture(pc, '13-pc-reinitialiser-acces');
  const telReset = await nouvelIphone();
  await accepter(telReset, lienReset, 'Nouvelle phrase de Léa 2027');
  await telReset.getByTestId('hub').waitFor({ timeout: 90_000 });
  verifier(true, 'Léa a choisi un nouveau mot de passe (ses données sont gardées)');
  relais.ip = '198.51.100.40';
  const pcAncien = await (await nouveauContexte(navigateur, optionsPc)).newPage();
  await pcAncien.goto(SITE);
  await pcAncien.getByTestId('connexion-id-identifiant').fill('Léa');
  await pcAncien.getByTestId('connexion-id-mdp').fill(MDP_LEA);
  await pcAncien.getByTestId('connexion-id-valider').click();
  verifier(/mot de passe incorrect/i.test(await texteDe(pcAncien, 'connexion-id-erreur')), 'l’ancien mot de passe ne marche plus');
  await pcAncien.getByTestId('connexion-id-mdp').fill('Nouvelle phrase de Léa 2027');
  await pcAncien.getByTestId('connexion-id-valider').click();
  await pcAncien.getByTestId('hub').waitFor({ timeout: 90_000 });
  verifier(true, 'le nouveau mot de passe ouvre le compte sur un autre appareil');

  // ================================================================ Révocation
  log('Révocation de Zoé');
  await pc.getByText('Zoé', { exact: true }).first().click();
  await pc.getByTestId('admin-acces-revoquer').click();
  await confirmerIdentite(pc, secretAdmin);
  await pc.getByTestId('admin-acces-revoque').waitFor({ timeout: 30_000 });
  await capture(pc, '14-pc-acces-revoque');
  const jetonZoe = await moduleRelais.jetonDeProfil(JETON, idZoe);
  const refus = await worker.fetch(new Request(`${RELAIS}/p/${idZoe}/boite`, { headers: { Authorization: `Bearer ${jetonZoe}` } }), env);
  verifier(refus.status === 403, `le relais refuse le jeton de Zoé (${refus.status})`);
  relais.ip = '198.51.100.50';
  const telZoe2 = await nouvelIphone();
  await telZoe2.goto(SITE);
  await telZoe2.getByTestId('connexion-id-identifiant').fill('Zoé');
  await telZoe2.getByTestId('connexion-id-mdp').fill('Une phrase pour Zoé 7');
  await telZoe2.getByTestId('connexion-id-valider').click();
  const revoque = await texteDe(telZoe2, 'connexion-id-erreur');
  verifier(/révoqué/.test(revoque), `Zoé révoquée : « ${revoque} »`);
  await pc.getByTestId('admin-acces-retablir').click();
  await confirmerIdentite(pc, secretAdmin);
  await pc.getByTestId('admin-acces-revoquer').waitFor({ timeout: 30_000 });
  verifier(true, 'accès de Zoé rétabli');

  // ================================================================ Relais pas encore redéployé
  log('Relais pas encore redéployé : invitation « lien »');
  relais.ancien = true;
  const nina = await creerAmi(pc, 'Nina');
  verifier(/Relais à mettre à jour/.test(nina.avertissement), `Administration : « ${nina.avertissement.slice(0, 70)}… »`);
  verifier(!nina.codeCourt, 'pas de code court sans relais à jour');
  await capture(pc, '15-pc-relais-a-mettre-a-jour');
  await terminerIdentifiants(pc);
  const telNina = await nouvelIphone();
  await accepter(telNina, nina.lien, 'La phrase de Nina 2026');
  await telNina.getByTestId('hub').waitFor({ timeout: 90_000 });
  verifier(true, 'Nina connectée malgré l’ancien relais');
  const telNina2 = await nouvelIphone();
  await telNina2.goto(local(nina.lien));
  await telNina2.getByTestId('invitation-mdp').waitFor({ timeout: 60_000 }).catch(() => undefined);
  if ((await telNina2.getByTestId('invitation-mdp').count()) > 0) {
    await telNina2.getByTestId('invitation-mdp').fill('Autre phrase pirate 99');
    await telNina2.getByTestId('invitation-mdp-confirmation').fill('Autre phrase pirate 99');
    await telNina2.getByTestId('invitation-valider').click();
  }
  verifier(/déjà été utilisée/.test(await texteDe(telNina2, 'invitation-erreur')), 'ancien relais : le lien ne sert qu’une fois');
  const pcNina = await (await nouveauContexte(navigateur, optionsPc)).newPage();
  await pcNina.goto(SITE);
  await pcNina.getByTestId('connexion-id-identifiant').fill('Nina');
  await pcNina.getByTestId('connexion-id-mdp').fill('La phrase de Nina 2026');
  await pcNina.getByTestId('connexion-id-valider').click();
  const ancien = await texteDe(pcNina, 'connexion-id-erreur');
  verifier(/mis à jour/.test(ancien), `connexion par identifiant : « ${ancien.slice(0, 80)}… »`);
  await capture(pcNina, '16-relais-a-mettre-a-jour');
  relais.ancien = false;

  // ================================================================ Liste des accès
  await pc.getByTestId('admin-onglet-utilisateurs').click();
  await pause(1500);
  await capture(pc, '17-pc-liste-acces');
} catch (erreur) {
  echecs++;
  console.log("  ECHEC", erreur instanceof Error ? erreur.message.split("\n").slice(0, 4).join(" | ") : erreur);
  for (const [i, contexte] of navigateur.contexts().entries()) {
    for (const [j, page] of contexte.pages().entries()) {
      await page.screenshot({ path: join(CAPTURES, `echec-${i}-${j}.png`) }).catch(() => undefined);
      console.log(`--- page ${i}.${j} :`, (await page.locator('body').innerText().catch(() => '')).slice(0, 500));
    }
  }
} finally {
  await navigateur.close();
  serveurRelais.close();
  serveurSite.close();
}
console.log(echecs === 0 ? 'E2E OK' : `E2E : ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
