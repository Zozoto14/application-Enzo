/**
 * Bout en bout du RETOUR TEMPORAIRE du code de liaison AB1 (bureau/liaisonTemporaire.ts) : le
 * Fondateur, loin de son PC, active sa connexion par identifiant depuis une tablette.
 *
 *  1. le PC du Fondateur (jeton maître, comme relais-local.json) a son coffre (mot de passe + code à
 *     six chiffres), un thème (Sauge) ; il n'a PAS encore choisi d'identifiant (« Plus tard ») ;
 *  2. tablette neuve : « Administrateur : relier avec un code de liaison (temporaire) » ; un code
 *     illisible, un code d'ami et un serveur inconnu sont refusés ; le bon code AB1 relie la tablette ;
 *  3. déverrouillage avec le mot de passe et le code à six chiffres : ses données (thème Sauge) ;
 *  4. l'écran « Se connecter partout avec un identifiant » s'ouvre seul : « admin », mot de passe
 *     actuel, code → connexion par identifiant active, dix codes de récupération ;
 *  5. le code AB1 est ensuite refusé (« déjà active ») ; un lien `#liaison=AB1.…` l'apporte bien ;
 *  6. navigateur neuf : « admin » + mot de passe + code à six chiffres → le hub et ses données.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-ab1-temporaire.mjs
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
import { nouveauContexte, relierCommePc } from './e2e-acceptation.mjs';

const racine = fileURLToPath(new URL('..', import.meta.url));
const requireGlobal = createRequire(join(process.env.PLAYWRIGHT_PATH ?? '/opt/node22/lib/node_modules', 'x.js'));
const { chromium, devices } = requireGlobal('playwright');
const { relais: coeurRelais } = await import(pathToFileURL(join(racine, 'relais/relais.mjs')).href);
const { coffresMemoire } = await import(pathToFileURL(join(racine, 'relais/coffres.mjs')).href);

const CAPTURES = process.env.CAPTURES ?? join(tmpdir(), 'captures-ab1-temporaire');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-ab1-temporaire-0123456789';
const PORT_RELAIS = 8941;
const PORT_SITE = 5341;
const RELAIS = `https://localhost:${PORT_RELAIS}`;
const SITE = `http://localhost:${PORT_SITE}/`;
const MDP_PC = 'ancien-mot-de-passe-du-pc-e2e-42';
const FONDS = { sauge: 'rgb(238, 242, 236)', terminal: 'rgb(10, 10, 10)', nuit: 'rgb(11, 15, 23)' };

// ------------------------------------------------------------- Faux relais (vrai relais, boîte et coffre en mémoire)
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
const dossier = mkdtempSync(join(tmpdir(), 'e2e-ab1-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dossier, 'k.pem'), '-out', join(dossier, 'c.pem'), '-subj', '/CN=localhost', '-days', '1'], { stdio: 'ignore' });
const serveurRelais = https.createServer({ key: readFileSync(join(dossier, 'k.pem')), cert: readFileSync(join(dossier, 'c.pem')) }, async (req, res) => {
  const morceaux = [];
  for await (const m of req) morceaux.push(m);
  const corps = Buffer.concat(morceaux);
  const requete = new Request(`${RELAIS}${req.url}`, { method: req.method, headers: { ...req.headers, 'x-adresse-client': '198.51.100.9' }, body: ['GET', 'HEAD'].includes(req.method) ? undefined : corps });
  const reponse = await coeurRelais.traiter(requete, env);
  const jeton = String(req.headers.authorization ?? '').replace(/^Bearer\s+/, '');
  journal.push({ methode: req.method, chemin: req.url.split('?')[0], statut: reponse.status, jeton: jeton === JETON ? 'maitre' : jeton.slice(0, 3) });
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
const capture = (page, nom) => page.screenshot({ path: join(CAPTURES, `${nom}.png`) });
const attendre = async (condition, delai = 90_000, pas = 1000) => {
  const debut = Date.now();
  while (Date.now() - debut < delai) {
    if (await condition().catch(() => false)) return true;
    await pause(pas);
  }
  return false;
};
const fond = page => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const texteDe = (page, id, delai = 30_000) => page.getByTestId(id).first().innerText({ timeout: delai }).catch(() => '');
const local = lien => lien.replace(/^https?:\/\/[^/]+\//, SITE);
const fermerBulles = page => page.getByText(/^(Fermer|Terminé|Compris|Plus tard)$/).first().click({ timeout: 2500 }).catch(() => undefined);
async function parametres(page, section) {
  await page.getByTestId('hub-parametres-ouvrir').click();
  if (section) await page.getByTestId(`parametres-section-${section}`).click();
}
const fermerParametres = page => page.getByTestId('hub-parametres-fermer').click().catch(() => undefined);
const reveiller = page => page.evaluate(() => {
  window.dispatchEvent(new Event('focus'));
  document.dispatchEvent(new Event('visibilitychange'));
});

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

const navigateur = await chromium.launch({ headless: true });
const options = { ignoreHTTPSErrors: true, viewport: { width: 1200, height: 860 }, permissions: ['clipboard-read', 'clipboard-write'] };
const tablette = { ...devices['iPad (gen 7)'], ignoreHTTPSErrors: true };
delete tablette.defaultBrowserType;
try {
  // ================================================================ 1. PC du Fondateur (pas encore d'identifiant)
  log('PC du Fondateur : coffre (mot de passe + code), jeton maître, thème Sauge ; identifiant « Plus tard »');
  const A = await (await nouveauContexte(navigateur, options)).newPage();
  A.on('pageerror', e => log('erreur page PC :', e.message));
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
  verifier(Boolean(secret), 'secret du code à six chiffres lu');
  await A.getByRole('switch').click();
  await A.getByTestId('bouton-continuer').click();
  await A.getByTestId('hub').waitFor({ timeout: 60_000 });
  await fermerBulles(A);
  await relierCommePc(A, CODE_PC);
  await deverrouiller(A, MDP_PC, secret);
  await fermerBulles(A);
  await A.keyboard.press('Escape').catch(() => undefined);
  await parametres(A, 'general');
  await A.getByTestId('parametres-theme-sauge').click();
  await fermerParametres(A);
  const publie = await attendre(async () => {
    await reveiller(A);
    return (await coffres.etat('principal')).enregistrements > 0 && kv.has('appareil:coffre');
  }, 120_000, 2000);
  verifier(publie, 'données et coffre du Fondateur publiés sur le serveur');
  verifier(![...kv.keys()].some(c => c.startsWith('acces:')), 'aucune connexion par identifiant encore (le Fondateur n’a pas son PC)');

  // ================================================================ 2. Tablette : le code AB1
  log('Tablette neuve : relier avec le code de liaison (temporaire)');
  const contexteB = await nouveauContexte(navigateur, tablette);
  await contexteB.addInitScript(() => localStorage.setItem('e2e.migration', 'garder'));
  const B = await contexteB.newPage();
  B.on('pageerror', e => log('erreur page tablette :', e.message));
  await B.goto(SITE);
  await B.getByTestId('accueil-site').waitFor({ timeout: 60_000 });
  verifier((await B.getByTestId('champ-code-accueil').count()) === 0, 'accueil : le champ du code reste caché derrière un lien discret');
  await B.getByTestId('accueil-ab1-ouvrir').click();
  await capture(B, '01-tablette-lien-ab1');
  const essayer = async code => {
    await B.getByTestId('champ-code-accueil').fill(code);
    await B.getByTestId('bouton-relier-accueil').click();
    await B.getByTestId('accueil-ab1').getByText(/illisible|pas celui|inconnu/).first().waitFor({ timeout: 30_000 }).catch(() => undefined);
    return B.getByTestId('accueil-ab1').innerText();
  };
  verifier(/illisible/.test(await essayer('AB1.pas-un-code')), 'code illisible refusé');
  const jetonAmi = `p1.lea0000001.${'a'.repeat(64)}`;
  verifier(/pas celui de l’administrateur/.test(await essayer('AB1.' + base64url(JSON.stringify({ r: RELAIS, j: jetonAmi })))), 'code d’ami refusé (il se connecte par identifiant)');
  verifier(/serveur inconnu/.test(await essayer('AB1.' + base64url(JSON.stringify({ r: 'https://relais.pirate.example', j: JETON })))), 'serveur inconnu refusé');
  await B.getByTestId('champ-code-accueil').fill(CODE_PC);
  await B.getByTestId('bouton-relier-accueil').click();

  // ================================================================ 3. Déverrouillage : ses données
  log('Tablette : déverrouillage (mot de passe + code à six chiffres), données du Fondateur');
  await deverrouiller(B, MDP_PC, secret);
  verifier(true, 'tablette déverrouillée avec le mot de passe et le code à six chiffres');
  const sauge = await attendre(async () => (await fond(B)) === FONDS.sauge, 90_000, 1000);
  verifier(sauge, `données du Fondateur visibles (thème Sauge : ${await fond(B)})`);
  await capture(B, '02-tablette-donnees');

  // ================================================================ 4. Activation de la connexion par identifiant
  log('Tablette : « Se connecter partout avec un identifiant » (seul, ou Paramètres › Sécurité)');
  let seul = await B.getByTestId('fondateur-connexion').waitFor({ timeout: 45_000 }).then(() => true, () => false);
  if (!seul) {
    await fermerBulles(B);
    await parametres(B, 'securite');
    await B.getByTestId('connexion-identifiant-configurer').click();
    seul = await B.getByTestId('fondateur-connexion').waitFor({ timeout: 30_000 }).then(() => true, () => false);
    verifier(seul, 'écran ouvert par Paramètres › Sécurité › Identifiant et mot de passe de connexion');
  } else {
    verifier(true, 'l’écran « Se connecter partout avec un identifiant » s’ouvre tout seul');
  }
  await capture(B, '03-tablette-activation');
  await B.getByTestId('fondateur-identifiant').fill('admin');
  await B.getByTestId('fondateur-mdp-actuel').fill(MDP_PC);
  await B.getByTestId('fondateur-totp').fill(totp(secret));
  const pasMigration = Math.floor(Date.now() / 30_000);
  await B.getByTestId('fondateur-valider').click();
  await B.getByTestId('fondateur-connexion-faite').waitFor({ timeout: 90_000 });
  const codes = (await texteDe(B, 'fondateur-codes')).split('\n').map(c => c.trim()).filter(Boolean);
  verifier(codes.length === 10, 'connexion par identifiant activée, dix codes de récupération affichés');
  await capture(B, '04-tablette-codes');
  await B.getByTestId('fondateur-codes-notes').click();
  verifier([...kv.keys()].some(c => c.startsWith('acces:')), 'accès par identifiant publié sur le serveur');
  await attendre(async () => (await coffres.etat('principal')).enregistrements > 0, 30_000, 1000);
  const coffreCanonique = await attendre(async () => /canonique\\*":true/.test(String(kv.get('appareil:coffre') ?? '')), 60_000, 1000);
  verifier(coffreCanonique, 'coffre publié : connexion par identifiant active');

  // ================================================================ 5. Le code AB1 ne sert plus ; le lien #liaison=
  log('Après activation : le code AB1 est refusé ; un lien #liaison= apporte bien le code');
  const D = await (await navigateur.newContext({ ignoreHTTPSErrors: true, locale: 'fr-FR' })).newPage();
  await D.goto(`${SITE}#liaison=${CODE_PC}`);
  await D.getByTestId('accueil-code-connu').waitFor({ timeout: 60_000 });
  verifier(!(await D.evaluate(() => location.hash)).includes('AB1'), 'lien #liaison= : code reçu, retiré de l’adresse');
  await D.getByTestId('bouton-relier-accueil').click();
  await D.getByText(/déjà active/).first().waitFor({ timeout: 30_000 }).catch(() => undefined);
  verifier(/déjà active/.test(await D.getByTestId('accueil-ab1').innerText()), 'code AB1 refusé : la connexion par identifiant est déjà active');
  await D.reload();
  await D.getByTestId('accueil-site').waitFor({ timeout: 60_000 });
  verifier((await D.getByTestId('accueil-ab1-ouvrir').count()) === 0, 'le lien temporaire disparaît de ce navigateur');

  // ================================================================ 6. Navigateur neuf : admin + mot de passe + code
  log('Navigateur neuf : admin + mot de passe + code à six chiffres');
  const C = await (await nouveauContexte(navigateur, options)).newPage();
  C.on('pageerror', e => log('erreur page C :', e.message));
  await C.goto(SITE);
  await C.getByTestId('connexion-id-identifiant').waitFor({ timeout: 60_000 });
  await C.getByTestId('connexion-id-identifiant').fill('admin');
  await C.getByTestId('connexion-id-mdp').fill(MDP_PC);
  await C.getByTestId('connexion-id-valider').click();
  const codeDemande = await C.getByTestId('connexion-id-code').waitFor({ timeout: 60_000 }).then(() => true, () => false);
  verifier(codeDemande, 'le serveur demande le code à six chiffres');
  while (Math.floor(Date.now() / 30_000) <= pasMigration) await pause(500);
  await C.getByTestId('connexion-id-code').fill(totp(secret));
  await C.getByTestId('connexion-id-valider').click();
  const hub = await C.getByTestId('hub').waitFor({ timeout: 120_000 }).then(() => true, () => false);
  verifier(hub, 'connecté sur un navigateur neuf avec admin + mot de passe + code');
  const saugeC = await attendre(async () => (await fond(C)) === FONDS.sauge, 60_000, 1000);
  verifier(saugeC, 'ses données arrivent (thème Sauge)');
  await capture(C, '05-navigateur-neuf-admin');
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
