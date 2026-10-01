/**
 * Test de bout en bout de l'écran de déverrouillage (site) : identifiants
 * JUSTES refusés à tort. Un « PC » simulé crée le coffre de l'administrateur
 * et le publie ; des navigateurs reliés avec son code vérifient :
 *
 *  - mot de passe collé avec espace final / caractère invisible : accepté ;
 *  - horloge de l'appareil décalée de 90 s : avis « décalée de 90 secondes » ;
 *  - mémoire refusée à la dérivation (erreur technique simulée) : message
 *    distinct, aucune tentative comptée ;
 *  - coffre local d'un autre compte : suggestion « relier mon compte » ;
 *  - lien « Diagnostic » : sans secret, copiable.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-deverrouillage.mjs
 *
 * Variables : PLAYWRIGHT_PATH, CAPTURES (défaut docs/captures-deverrouillage).
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
const worker = (await import(pathToFileURL(join(racine, 'relais/worker.mjs')).href)).default;

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-deverrouillage');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-deverrouillage-0123456789ab';
const PORT_RELAIS = 8797;
const PORT_SITE = 5207;
const MDP_ADMIN = 'mot-de-passe-du-pc-e2e-très-long-42';
const MDP_AUTRE = 'coffre-d-un-autre-compte-e2e-long-17';

// ------------------------------------------------------------- Faux relais (KV avec liste et métadonnées)
const kv = new Map();
const metas = new Map();
const compteurs = { put: 0, get: 0, list: 0 };
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
    list: async ({ prefix = '' } = {}) => {
      compteurs.list++;
      const keys = [...kv.keys()].filter(c => c.startsWith(prefix)).sort().map(name => ({ name, metadata: metas.get(name) }));
      return { keys, list_complete: true };
    },
  },
};
const journalRelais = [];
const dossier = mkdtempSync(join(tmpdir(), 'e2e-connexion-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dossier, 'k.pem'), '-out', join(dossier, 'c.pem'), '-subj', '/CN=localhost', '-days', '1'], { stdio: 'ignore' });
const serveurRelais = https.createServer({ key: readFileSync(join(dossier, 'k.pem')), cert: readFileSync(join(dossier, 'c.pem')) }, async (req, res) => {
  const morceaux = [];
  for await (const m of req) morceaux.push(m);
  const corps = Buffer.concat(morceaux);
  if (req.method === 'PUT') compteurs.put++;
  if (req.method === 'GET') compteurs.get++;
  const requete = new Request(`https://localhost:${PORT_RELAIS}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : corps,
  });
  const reponse = await worker.fetch(requete, env);
  const jeton = String(req.headers.authorization ?? '').replace(/^Bearer\s+/, '');
  journalRelais.push({ methode: req.method, chemin: req.url, statut: reponse.status, portee: jeton === JETON ? 'maitre' : jeton.startsWith('p1.') ? jeton.split('.')[1] : '?' });
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

// ------------------------------------------------------------------ Outils
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
const capture = (page, nom) => page.screenshot({ path: join(CAPTURES, `${nom}.png`) });
const attendre = async (condition, delai = 90_000, pas = 1000) => {
  const debut = Date.now();
  while (Date.now() - debut < delai) {
    if (await condition()) return true;
    await pause(pas);
  }
  return false;
};

async function deverrouiller(page, motDePasse, secret, attendu = 'hub') {
  for (const decalage of [0, 1, -1]) {
    await page.locator('input[type=password]').first().fill(motDePasse);
    await page.locator('input:not([type=password])').first().fill(totp(secret, decalage));
    await page.getByTestId('bouton-deverrouiller').click();
    const reussi = await page.getByTestId(attendu).waitFor({ timeout: 25_000 }).then(() => true, () => false);
    if (reussi) return;
  }
  throw new Error('déverrouillage impossible');
}


/** Horloge de la page décalée (Date.now et new Date()), posée avant tout script. */
const decalerHorloge = ms => `(() => {
  const D = Date;
  class Decalee extends D {
    constructor(...a) { if (a.length === 0) super(D.now() + ${ms}); else super(...a); }
    static now() { return D.now() + ${ms}; }
  }
  globalThis.Date = Decalee;
})();`;

/** Mémoire refusée aux grosses allocations (comme Safari iOS sous pression) : seulement quand la page le demande. */
const MEMOIRE_LIMITEE = `(() => {
  const U = Uint32Array;
  globalThis.Uint32Array = new Proxy(U, {
    construct(cible, args) {
      if (globalThis.__memoireLimitee && typeof args[0] === 'number' && args[0] > 2000000) throw new RangeError('Out of memory');
      return Reflect.construct(cible, args);
    },
  });
})();`;

async function saisir(page, motDePasse, code) {
  await page.locator('input[type=password]').first().fill(motDePasse);
  await page.locator('input:not([type=password])').first().fill(code);
  await page.getByTestId('bouton-deverrouiller').click();
}

/** Navigateur relié au PC (son code), arrivé sur l'écran Déverrouiller. */
async function navigateurRelie(options, init = []) {
  const contexte = await nouveauContexte(navigateur, options);
  for (const script of init) await contexte.addInitScript(script);
  const page = await contexte.newPage();
  page.on('pageerror', e => log('erreur page :', e.message));
  await page.goto(`${SITE}#liaison=${CODE_PC}`);
  await page.getByTestId('accueil-site').waitFor({ timeout: 60_000 });
  await page.getByTestId('bouton-relier-accueil').click();
  await page.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 });
  return page;
}

const navigateur = await chromium.launch({ headless: true });
const options = { ignoreHTTPSErrors: true, viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1, acceptDownloads: true };
try {
  // ================================================================ PC simulé
  log('PC : création du coffre de l’administrateur, relié au relais');
  const pc = await (await nouveauContexte(navigateur, options)).newPage();
  pc.on('pageerror', e => log('erreur page PC :', e.message));
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
  const secret = ((await pc.locator('body').innerText()).match(/\b[A-Z2-7]{16,}\b/) ?? [])[0];
  if (!secret) throw new Error('secret TOTP introuvable');
  await pc.getByRole('switch').click();
  await pc.getByTestId('bouton-continuer').click();
  await pc.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(pc, MDP_ADMIN, secret));
  verifier(await attendre(() => kv.has('appareil:coffre'), 120_000), 'le PC a publié son coffre');

  // ================================================================ 1. Espace final + invisible collés
  log('iPad relié : mot de passe collé avec espace final et caractère invisible');
  const ipad = await navigateurRelie(options);
  verifier(await ipad.getByText(/Lier à mon compte/).isVisible(), 'écran Déverrouiller sans prénom, « Lier à mon compte » visible (comme la capture)');
  const attributs = await ipad.locator('input[type=password]').first().evaluate(e => [e.getAttribute('autocapitalize'), e.getAttribute('autocorrect'), e.getAttribute('spellcheck')].join(','));
  verifier(/^(none|off),off,false$/.test(attributs), `correcteurs iOS coupés sur le mot de passe (${attributs})`);
  let reussi = false;
  for (const decalage of [0, 1, -1]) {
    await saisir(ipad, `\u200B${MDP_ADMIN} `, totp(secret, decalage));
    reussi = await ipad.getByTestId('hub').waitFor({ timeout: 25_000 }).then(() => true, () => false);
    if (reussi) break;
  }
  verifier(reussi, 'mot de passe avec espace final et caractère invisible : accepté');
  await capture(ipad, '01-espace-final-accepte');

  // Diagnostic (écran verrouillé de nouveau).
  await ipad.reload();
  await ipad.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 });
  await ipad.getByTestId('lien-diagnostic').click();
  await ipad.getByText(/Écart d’horloge avec le relais : [+-]?\d+ s/).waitFor({ timeout: 20_000 });
  const diagnostic = await ipad.getByTestId('texte-diagnostic').innerText();
  verifier(/Liaison au relais : oui/.test(diagnostic) && /Coffre local : oui/.test(diagnostic) && /Coffre local = coffre publié par le PC : oui/.test(diagnostic), 'diagnostic : liaison oui, coffre local oui, identique au PC');
  verifier(!diagnostic.includes(JETON) && !diagnostic.includes(MDP_ADMIN) && !diagnostic.includes(secret) && !/AB1\.|https?:/.test(diagnostic), 'diagnostic sans secret (ni jeton, ni mot de passe, ni secret TOTP, ni adresse)');
  await capture(ipad, '02-diagnostic');

  // ================================================================ 2. Horloge décalée de 90 s
  log('Appareil à l’horloge en avance de 90 s');
  const decale = await navigateurRelie(options, [decalerHorloge(90_000)]);
  await saisir(decale, MDP_ADMIN, totp(secret));
  await decale.getByText(/Mot de passe ou code incorrect/).first().waitFor({ timeout: 25_000 });
  const avis = await decale.getByTestId('avis-horloge').innerText({ timeout: 20_000 }).catch(() => '');
  verifier(/décalée de (8[5-9]|9[0-5]) secondes \(en avance\)/.test(avis), `avis d’horloge : « ${avis.trim()} »`);
  await capture(decale, '03-horloge-decalee-90s');

  // ================================================================ 3. Erreur technique simulée
  log('Mémoire refusée à la dérivation (erreur technique)');
  const pauvre = await navigateurRelie(options, [MEMOIRE_LIMITEE]);
  await pauvre.evaluate(() => {
    globalThis.__memoireLimitee = true;
  });
  for (let i = 0; i < 5; i++) {
    await saisir(pauvre, MDP_ADMIN, totp(secret));
    await pauvre.getByText(/Impossible de calculer la clé sur cet appareil/).first().waitFor({ timeout: 25_000 });
    await pause(300);
  }
  const texte = await pauvre.locator('body').innerText();
  verifier(!/incorrect/i.test(texte), 'erreur technique : jamais « Mot de passe ou code incorrect »');
  verifier(!/Trop de tentatives/.test(texte), 'erreur technique ×5 : aucune tentative comptée (pas de « Trop de tentatives »)');
  await capture(pauvre, '04-erreur-technique');
  await pauvre.evaluate(() => {
    globalThis.__memoireLimitee = false;
  });
  reussi = false;
  for (const decalage of [0, 1, -1]) {
    await saisir(pauvre, MDP_ADMIN, totp(secret, decalage));
    reussi = await pauvre.getByTestId('hub').waitFor({ timeout: 25_000 }).then(() => true, () => false);
    if (reussi) break;
  }
  verifier(reussi, 'mémoire revenue : les mêmes identifiants ouvrent aussitôt');

  // ================================================================ 4. Coffre d'un autre compte
  log('Navigateur au coffre d’un autre compte, puis relié au PC');
  const autreCtx = await nouveauContexte(navigateur, options);
  const autre = await autreCtx.newPage();
  autre.on('pageerror', e => log('erreur page autre :', e.message));
  await autre.goto(SITE);
  await autre.getByTestId('accueil-site').waitFor({ timeout: 60_000 });
  await autre.getByTestId('accueil-creer').click();
  await autre.getByTestId('accueil-creer-confirmer').click();
  const champsAutre = autre.locator('input[type=password]');
  await champsAutre.nth(0).waitFor({ timeout: 60_000 });
  await champsAutre.nth(0).fill(MDP_AUTRE);
  await champsAutre.nth(1).fill(MDP_AUTRE);
  await autre.getByTestId('bouton-creer').click();
  await autre.getByText('À noter maintenant').waitFor({ timeout: 60_000 });
  await autre.getByRole('switch').click();
  await autre.getByTestId('bouton-continuer').click();
  await pause(1500);
  // Code du PC retenu sur ce navigateur (comme après un ancien lien), sans remplacer le coffre.
  await autre.evaluate(code => localStorage.setItem('applibourse.liaisons', JSON.stringify({ maitre: code, comptes: {} })), CODE_PC);
  await autre.reload();
  await autre.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 });
  await saisir(autre, 'pas-le-bon-mot-de-passe', '000000');
  await autre.getByText(/Mot de passe ou code incorrect/).first().waitFor({ timeout: 25_000 });
  verifier((await autre.getByTestId('suggestion-autre-coffre').count()) === 0, 'après 1 échec : pas encore de suggestion');
  await pause(500);
  await saisir(autre, 'pas-le-bon-mot-de-passe-2', '000000');
  const suggestion = await autre.getByTestId('suggestion-autre-coffre').innerText({ timeout: 25_000 }).catch(() => '');
  verifier(/autre coffre que celui de ton PC : relier mon compte/.test(suggestion), `après 2 échecs : « ${suggestion.split('\n')[0]} »`);
  await capture(autre, '05-autre-coffre-suggestion');
  await pause(500);
  await saisir(autre, MDP_ADMIN, totp(secret));
  const differe = await autre.getByText(/ouvrent le compte publié par votre PC/).first().innerText({ timeout: 25_000 }).catch(() => '');
  verifier(Boolean(differe), `identifiants du PC sur ce coffre : « ${differe.slice(0, 90)}… »`);
  await capture(autre, '06-autre-coffre-identifiants-pc');
  await autre.getByTestId('lien-diagnostic').click();
  await autre.getByText(/Coffre local = coffre publié par le PC : non/).waitFor({ timeout: 20_000 });
  verifier(true, 'diagnostic : coffre local ≠ coffre publié par le PC');
  await capture(autre, '07-autre-coffre-diagnostic');
} catch (erreur) {
  echecs++;
  console.log('  ECHEC', erreur instanceof Error ? erreur.message.split('\n')[0] : erreur);
  for (const [i, contexte] of navigateur.contexts().entries()) {
    for (const page of contexte.pages()) {
      await page.screenshot({ path: join(CAPTURES, `echec-${i}.png`) }).catch(() => undefined);
      console.log(`--- page ${i} :`, (await page.locator('body').innerText().catch(() => '')).slice(0, 600));
    }
  }
} finally {
  await navigateur.close();
  serveurRelais.close();
  serveurSite.close();
}
console.log(echecs === 0 ? 'E2E OK' : `E2E : ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
