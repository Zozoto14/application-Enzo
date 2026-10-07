/**
 * Test de bout en bout du parcours de connexion du site : un « PC » simulé
 * (administrateur + un ami créé), un navigateur neuf relié avec le code du
 * PC, le téléphone de l'ami relié avec SON code, et un navigateur qui
 * contenait un ancien coffre. Faux relais local qui exécute relais/worker.mjs.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-site-connexion.mjs
 *
 * Variables : PLAYWRIGHT_PATH (dossier de node_modules contenant playwright),
 * CAPTURES (dossier des captures, défaut docs/captures-connexion).
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
import { allerPageAdministration, nouveauContexte, ONGLET_ADMINISTRATION } from './e2e-acceptation.mjs';

const racine = fileURLToPath(new URL('..', import.meta.url));
const requireGlobal = createRequire(join(process.env.PLAYWRIGHT_PATH ?? '/opt/node22/lib/node_modules', 'x.js'));
const { chromium } = requireGlobal('playwright');
const worker = (await import(pathToFileURL(join(racine, 'relais/worker.mjs')).href)).default;

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-connexion');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-connexion-0123456789abcdef';
const PORT_RELAIS = 8789;
const PORT_SITE = 5198;
const MDP_ADMIN = 'mot-de-passe-du-pc-e2e-très-long-42';
const MDP_ANCIEN = 'ancien-coffre-du-site-e2e-long-17';

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

async function confirmerIdentite(page, motDePasse, secret) {
  await page.getByTestId('admin-identite-mdp').waitFor({ timeout: 20_000 });
  for (const decalage of [0, 1, -1]) {
    await page.getByTestId('admin-identite-mdp').fill(motDePasse);
    await page.getByTestId('admin-identite-code').fill(totp(secret, decalage));
    await page.getByTestId('admin-identite-valider').click();
    const parti = await page.getByTestId('admin-identite').waitFor({ state: 'detached', timeout: 15_000 }).then(() => true, () => false);
    if (parti) return;
  }
  throw new Error('vérification d’identité impossible');
}

async function ouvrirAdministration(page) {
  await allerPageAdministration(page);
  const tuile = page.locator('[data-testid="cellule-administration"], [data-testid="tuile-administration"]').first();
  await tuile.click();
  await page.getByTestId('app-administration').waitFor({ timeout: 20_000 });
}

/** Crée un ami depuis l'Administration ouverte ; rend ses identifiants. */
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
  return { motDePasse, secret };
}

/** Relie un navigateur neuf avec un code (lien #liaison=) et attend l'écran suivant. */
async function relier(page, code) {
  await page.goto(`${SITE}#liaison=${code}`);
  await page.getByTestId('accueil-site').waitFor({ timeout: 60_000 });
  await page.getByTestId('bouton-relier-accueil').click();
}

const navigateur = await chromium.launch({ headless: true });
const options = { ignoreHTTPSErrors: true, viewport: { width: 1100, height: 820 }, acceptDownloads: true };
try {
  const pc = await (await nouveauContexte(navigateur, options)).newPage();
  pc.on('pageerror', e => log('erreur page PC :', e.message));

  // ================================================================ PC simulé
  log('PC : création du coffre de l’administrateur, relié au relais');
  await pc.goto(`${SITE}#liaison=${CODE_PC}`);
  await pc.getByTestId('accueil-site').waitFor({ timeout: 60_000 });
  await capture(pc, '01-accueil-navigateur-neuf');
  await pc.getByTestId('accueil-creer').click();
  verifier(await pc.getByTestId('accueil-avertissement').isVisible(), 'créer un coffre n’arrive qu’après un avertissement');
  await pc.getByTestId('accueil-creer-confirmer').click();
  const champs = pc.locator('input[type=password]');
  await champs.nth(0).waitFor({ timeout: 60_000 });
  await champs.nth(0).fill(MDP_ADMIN);
  await champs.nth(1).fill(MDP_ADMIN);
  await pc.getByTestId('bouton-creer').click();
  await pc.getByText('À noter maintenant').waitFor({ timeout: 60_000 });
  const secretAdmin = ((await pc.locator('body').innerText()).match(/\b[A-Z2-7]{16,}\b/) ?? [])[0];
  if (!secretAdmin) throw new Error('secret TOTP introuvable');
  await pc.getByRole('switch').click();
  await pc.getByTestId('bouton-continuer').click();
  await pc.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(pc, MDP_ADMIN, secretAdmin));
  await pc.getByText(/Fermer|Terminé|Compris|Plus tard/).first().click({ timeout: 3000 }).catch(() => undefined);
  await pc.keyboard.press('Escape').catch(() => undefined);

  log('PC : création de l’amie Léa, et de son code de connexion au site');
  await ouvrirAdministration(pc);
  const lea = await creerAmi(pc, 'Léa');
  await pc.getByText('Léa', { exact: true }).first().click();
  await pc.getByTestId('admin-code-site-generer').click();
  await confirmerIdentite(pc, MDP_ADMIN, secretAdmin);
  await pc.getByTestId('admin-code-site').waitFor({ timeout: 20_000 });
  const codeLea = (await pc.getByTestId('admin-code-site').innerText()).trim();
  verifier(/^AB1\./.test(codeLea) && !codeLea.includes(JETON), 'le code de Léa est un code AB1 sans le jeton maître');
  const decode = JSON.parse(Buffer.from(codeLea.slice(4).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  verifier(/^p1\.[a-z0-9]+\.[0-9a-f]{64}$/.test(decode.j), `le code de Léa porte un jeton de profil (${decode.j.slice(0, 16)}…)`);
  const idLea = decode.j.split('.')[1];
  await capture(pc, '02-pc-code-connexion-lea');

  const publie = await attendre(() => kv.has('p:principal:annuaire') && kv.has(`p:${idLea}:coffre`) && kv.has(`p:${idLea}:annuaire`) && kv.has('appareil:coffre'), 120_000);
  verifier(publie, 'le PC a publié l’annuaire, le compte de Léa et son propre coffre');
  const annuaireRelais = kv.get('p:principal:annuaire') ?? '';
  verifier(!/Léa|L\\u00e9a/.test(annuaireRelais), 'aucun prénom en clair dans l’annuaire publié');

  // ================================================================ Navigateur neuf (administrateur)
  log('Navigateur neuf : relier avec le code du PC');
  const site = await (await nouveauContexte(navigateur, options)).newPage();
  site.on('pageerror', e => log('erreur page site :', e.message));
  await relier(site, CODE_PC);
  await site.getByTestId('connexion-prenom').waitFor({ timeout: 60_000 });
  verifier(true, 'après la liaison : l’écran prénom, comme sur le PC');
  await capture(site, '03-site-ecran-prenom');
  const avant = journalRelais.length;
  await site.getByTestId('connexion-prenom').fill('admin');
  await site.getByTestId('connexion-continuer').click();
  await site.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 });
  const telecharges = journalRelais.slice(avant).filter(a => a.methode === 'GET').map(a => a.chemin);
  verifier(!telecharges.some(c => c.includes(`/p/${idLea}/`)), `après le prénom, seul le coffre de ce compte est lu (${telecharges.join(', ')})`);
  await deverrouiller(site, MDP_ADMIN, secretAdmin);
  await site.getByText(/Fermer|Terminé|Compris|Plus tard/).first().click({ timeout: 3000 }).catch(() => undefined);
  await ouvrirAdministration(site);
  await site.getByTestId('admin-onglet-utilisateurs').click();
  verifier(await site.getByText('Léa', { exact: true }).first().isVisible().catch(() => false), 'l’administration du site montre Léa, créée sur le PC');
  await capture(site, '04-site-administration-utilisateurs');
  await site.getByTestId('admin-onglet-journal').click();
  const journalVu = await attendre(async () => (await site.getByText(/Léa/).count()) > 0, 60_000);
  verifier(journalVu, 'le journal du site contient les événements du PC (création de Léa)');
  await capture(site, '05-site-journal');

  log('Site : création de Hugo, qui doit remonter au PC');
  await creerAmi(site, 'Hugo');
  await pc.getByTestId('admin-onglet-journal').click();
  await pc.getByTestId('admin-onglet-utilisateurs').click();
  const hugoAuPc = await attendre(async () => {
    await pc.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    return (await pc.getByText('Hugo', { exact: true }).count()) > 0;
  }, 180_000, 4000);
  verifier(hugoAuPc, 'Hugo, créé sur le site, apparaît dans l’administration du PC');
  await capture(pc, '06-pc-recoit-hugo');

  // ================================================================ Téléphone de Léa
  log('Téléphone de Léa : relier avec SON code');
  const tel = await (await nouveauContexte(navigateur, { ...options, viewport: { width: 420, height: 860 } })).newPage();
  tel.on('pageerror', e => log('erreur page téléphone :', e.message));
  await relier(tel, codeLea);
  await tel.getByTestId('connexion-prenom').waitFor({ timeout: 60_000 });
  await capture(tel, '07-telephone-lea-prenom');

  // Leurre : prénom de l'administrateur → même écran, même erreur, aucun 404.
  const avantLeurre = journalRelais.length;
  await tel.getByTestId('connexion-prenom').fill('admin');
  await tel.getByTestId('connexion-continuer').click();
  await tel.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 });
  const appelsLeurre = journalRelais.slice(avantLeurre);
  verifier(appelsLeurre.every(a => a.statut === 200 && a.portee === idLea), `leurre : appels du même espace, sans 404 (${appelsLeurre.map(a => `${a.methode} ${a.chemin} ${a.statut}`).join(', ')})`);
  await tel.locator('input[type=password]').first().fill(lea.motDePasse);
  await tel.locator('input:not([type=password])').first().fill(totp(lea.secret));
  await tel.getByTestId('bouton-deverrouiller').click();
  const erreurLeurre = await tel.getByText(/incorrect/i).first().innerText({ timeout: 20_000 }).catch(() => '');
  verifier(/incorrect/i.test(erreurLeurre), `leurre : échec « ${erreurLeurre} »`);
  await capture(tel, '08-telephone-leurre');

  await tel.getByTestId('changer-profil-verrou').click();
  await tel.getByTestId('connexion-prenom').waitFor({ timeout: 60_000 });
  await tel.getByTestId('connexion-prenom').fill('Léa');
  await tel.getByTestId('connexion-continuer').click();
  await tel.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 });
  await deverrouiller(tel, lea.motDePasse, lea.secret);
  await tel.getByText(/Fermer|Terminé|Compris|Plus tard/).first().click({ timeout: 3000 }).catch(() => undefined);
  verifier((await tel.locator('[data-testid="cellule-administration"], [data-testid="tuile-administration"]').count()) === 0 && (await tel.locator(ONGLET_ADMINISTRATION).count()) === 0, 'Léa n’a pas d’Administration (ni tuile ni page)');
  const refusLea = journalRelais.filter(a => a.portee === idLea && a.statut === 403);
  const horsEspace = journalRelais.filter(a => a.portee === idLea && !a.chemin.startsWith(`/p/${idLea}/`) && !/^\/(sante|heure|yahoo|medias)/.test(a.chemin));
  verifier(horsEspace.length === 0 && refusLea.length === 0, `le téléphone de Léa n’a appelé que son espace (${horsEspace.length} appel(s) ailleurs, ${refusLea.length} refus)`);
  const lire = chemin => worker.fetch(new Request(`https://relais${chemin}`, { headers: { Authorization: `Bearer ${decode.j}` } }), env);
  const statuts = [(await lire('/p/principal/boite/annuaire')).status, (await lire('/boite/coffre')).status, (await lire(`/p/${idLea === 'aaaaaaaa' ? 'bbbbbbbb' : 'aaaaaaaa'}/boite/coffre`)).status];
  verifier(statuts.every(s => s === 403), `le jeton de Léa ne lit ni l’annuaire, ni le coffre de l’administrateur, ni un autre espace (${statuts.join(', ')})`);
  await capture(tel, '09-telephone-lea-hub');

  // ================================================================ Ancien coffre local
  log('Navigateur avec un ancien coffre local : remplacement');
  const ancien = await (await nouveauContexte(navigateur, options)).newPage();
  ancien.on('pageerror', e => log('erreur page ancien :', e.message));
  await ancien.goto(SITE);
  await ancien.getByTestId('accueil-site').waitFor({ timeout: 60_000 });
  await ancien.getByTestId('accueil-creer').click();
  await ancien.getByTestId('accueil-creer-confirmer').click();
  const champsAncien = ancien.locator('input[type=password]');
  await champsAncien.nth(0).waitFor({ timeout: 60_000 });
  await champsAncien.nth(0).fill(MDP_ANCIEN);
  await champsAncien.nth(1).fill(MDP_ANCIEN);
  await ancien.getByTestId('bouton-creer').click();
  await ancien.getByText('À noter maintenant').waitFor({ timeout: 60_000 });
  await ancien.getByRole('switch').click();
  await ancien.getByTestId('bouton-continuer').click();
  await pause(1500);
  await ancien.reload();
  await ancien.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 });
  // Identifiants du PC sur l'ancien coffre : échec, puis « Lier à mon compte ».
  await ancien.locator('input[type=password]').first().fill(MDP_ADMIN);
  await ancien.locator('input:not([type=password])').first().fill(totp(secretAdmin));
  await ancien.getByTestId('bouton-deverrouiller').click();
  await ancien.getByText(/incorrect/i).first().waitFor({ timeout: 20_000 });
  await ancien.getByTestId('montrer-lier').click();
  await ancien.getByTestId('champ-code-lier').fill(CODE_PC);
  await ancien.getByTestId('bouton-lier-compte').click();
  await ancien.getByTestId('remplacer-donnees').waitFor({ timeout: 60_000 });
  await capture(ancien, '10-ancien-coffre-remplacer');
  const [telechargement] = await Promise.all([ancien.waitForEvent('download', { timeout: 20_000 }), ancien.getByTestId('remplacer-exporter').click()]);
  verifier(/ancien-coffre/.test(telechargement.suggestedFilename()), `sauvegarde de l’ancien coffre proposée (${telechargement.suggestedFilename()})`);
  await ancien.getByTestId('remplacer-confirmer').click();
  await ancien.getByTestId('connexion-prenom').waitFor({ timeout: 60_000 });
  await ancien.getByTestId('connexion-prenom').fill('admin');
  await ancien.getByTestId('connexion-continuer').click();
  await ancien.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 });
  await deverrouiller(ancien, MDP_ADMIN, secretAdmin);
  verifier(true, 'après remplacement : connexion avec les identifiants du PC');
  await capture(ancien, '11-ancien-coffre-remplace-hub');
  log(`relais : ${compteurs.put} PUT, ${compteurs.get} GET, ${compteurs.list} listes`);
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
