/**
 * Bout en bout de la refonte « le serveur est la référence » (relais version 9) :
 *
 *  1. le PC du Fondateur (jeton maître, comme relais-local.json) crée son coffre, choisit un thème ;
 *     à la première ouverture, l'app lui demande un identifiant et un mot de passe (migration), lui
 *     montre ses nouveaux codes de récupération et téléverse tout (coffre serveur chiffré) ;
 *  2. un navigateur NEUF : plus de carte « code de liaison » ; dès qu'on tape « Enzo », le style du
 *     compte s'applique ; nom + mot de passe → toutes ses apps et données (thème, disposition) ;
 *  3. modification sur le navigateur B, visible sur le PC A sans aucune liaison ;
 *  4. hors ligne sur B : la modification attend (« en attente »), puis part au retour du réseau ;
 *  5. une amie (invitation) se connecte, puis sur un autre appareil par identifiant + mot de passe ;
 *  6. Paramètres : plus de section Synchronisation, un indicateur de connexion au serveur ;
 *  7. le relais ne garde rien en clair (ni mot de passe, ni identifiant, ni thème dans le coffre).
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-synchro-serveur.mjs
 *
 * Variables : PLAYWRIGHT_PATH, CAPTURES (défaut docs/captures-synchro-serveur).
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

const racine = fileURLToPath(new URL('..', import.meta.url));
const requireGlobal = createRequire(join(process.env.PLAYWRIGHT_PATH ?? '/opt/node22/lib/node_modules', 'x.js'));
const { chromium, devices } = requireGlobal('playwright');
const worker = (await import(pathToFileURL(join(racine, 'relais/worker.mjs')).href)).default;
const { coffresMemoire } = await import(pathToFileURL(join(racine, 'relais/coffres.mjs')).href);

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-synchro-serveur');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-serveur-0123456789abcdef';
const PORT_RELAIS = 8867;
const PORT_SITE = 5267;
const RELAIS = `https://localhost:${PORT_RELAIS}`;
const SITE = `http://localhost:${PORT_SITE}/`;
const MDP_PC = 'ancien-mot-de-passe-du-pc-e2e-42';
const MDP_ENZO = 'Ma phrase de connexion 2026';
const MDP_LEA = 'Été à Biarritz 2026';
const FONDS = { sauge: 'rgb(238, 242, 236)', terminal: 'rgb(10, 10, 10)', nuit: 'rgb(11, 15, 23)' };

// ------------------------------------------------------------- Faux relais (vrai worker, boîte et coffre en mémoire)
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
const dossier = mkdtempSync(join(tmpdir(), 'e2e-serveur-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dossier, 'k.pem'), '-out', join(dossier, 'c.pem'), '-subj', '/CN=localhost', '-days', '1'], { stdio: 'ignore' });
const serveurRelais = https.createServer({ key: readFileSync(join(dossier, 'k.pem')), cert: readFileSync(join(dossier, 'c.pem')) }, async (req, res) => {
  const morceaux = [];
  for await (const m of req) morceaux.push(m);
  const corps = Buffer.concat(morceaux);
  const requete = new Request(`${RELAIS}${req.url}`, { method: req.method, headers: { ...req.headers, 'cf-connecting-ip': '198.51.100.9' }, body: ['GET', 'HEAD'].includes(req.method) ? undefined : corps });
  const reponse = await worker.fetch(requete, env);
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
try {
  // ================================================================ 1. PC du Fondateur
  log('PC du Fondateur (jeton maître, comme relais-local.json) : coffre, thème Sauge, disposition en liste');
  const contexteA = await nouveauContexte(navigateur, options);
  await contexteA.addInitScript(() => localStorage.setItem('e2e.migration', 'garder'));
  const A = await contexteA.newPage();
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
  await A.getByRole('switch').click();
  await A.getByTestId('bouton-continuer').click();
  await A.getByTestId('hub').waitFor({ timeout: 60_000 });
  await fermerBulles(A);
  // Le PC connaît son relais et son jeton maître (relais-local.json) : simulé ici, puis réouverture.
  await relierCommePc(A, CODE_PC);
  await deverrouiller(A, MDP_PC, secret);
  await fermerBulles(A);
  await A.keyboard.press('Escape').catch(() => undefined);

  log('PC : à la première ouverture, l’app demande un identifiant et un mot de passe (migration)');
  await A.getByTestId('fondateur-connexion').waitFor({ timeout: 60_000 });
  await capture(A, '01-pc-migration-identifiant');
  await A.getByTestId('fondateur-identifiant').fill('Enzo');
  await A.getByTestId('fondateur-mdp-actuel').fill(MDP_PC);
  await A.getByTestId('fondateur-totp').fill(totp(secret));
  const pasMigration = Math.floor(Date.now() / 30_000);
  // Changer de mot de passe est facultatif (version 10) : on le change ici.
  await A.getByTestId('fondateur-changer-mdp').click();
  await A.getByTestId('fondateur-mdp').fill(MDP_ENZO);
  await A.getByTestId('fondateur-mdp-confirmation').fill(MDP_ENZO);
  await A.getByTestId('fondateur-valider').click();
  await A.getByTestId('fondateur-connexion-faite').waitFor({ timeout: 60_000 });
  const codes = (await texteDe(A, 'fondateur-codes')).split('\n').map(c => c.trim()).filter(Boolean);
  verifier(codes.length === 10, `dix nouveaux codes de récupération affichés (${codes[0]}…)`);
  await capture(A, '02-pc-codes-recuperation');
  await A.getByTestId('fondateur-codes-notes').click();
  verifier([...kv.keys()].some(c => c.startsWith('acces:')), 'accès par identifiant du Fondateur publié');

  log('PC : thème Sauge et disposition en liste (synchronisés)');
  await parametres(A, 'general');
  await A.getByTestId('parametres-theme-sauge').click();
  verifier((await A.getByTestId('parametres-section-synchro').count()) === 0, 'Paramètres : plus de section « Synchronisation »');
  verifier((await A.getByTestId('reglage-synchro-etat').count()) > 0, 'Paramètres › Général : « Connexion au serveur »');
  await A.getByTestId('parametres-disposition-liste').click().catch(() => undefined);
  await capture(A, '03-pc-parametres-general');
  await fermerParametres(A);
  const envoye = await attendre(async () => {
    await reveiller(A);
    const etat = await coffres.etat('principal');
    return etat.enregistrements > 0 && kv.has('appareil:coffre') && [...kv.keys()].some(c => c.startsWith('theme:'));
  }, 120_000, 2000);
  verifier(envoye, 'données, coffre et nom du thème publiés sur le serveur');
  const contenus = (await coffres.lire('principal', 0, 10_000)).enregistrements.map(e => e.valeur).join('\n') + [...kv.values()].join('\n');
  for (const secretClair of [MDP_ENZO, MDP_PC, 'Enzo', 'hub.theme', '"sauge"']) {
    verifier(!contenus.includes(secretClair), `le serveur ne garde pas « ${secretClair} » en clair`);
  }

  // ================================================================ 2. Navigateur neuf : nom + mot de passe
  log('Navigateur neuf : plus de carte « code de liaison », style appliqué en tapant le nom, connexion');
  const B = await (await nouveauContexte(navigateur, options)).newPage();
  B.on('pageerror', e => log('erreur page B :', e.message));
  await B.goto(SITE);
  await B.getByTestId('accueil-site').waitFor({ timeout: 60_000 });
  const accueil = await B.locator('body').innerText();
  // Seule exception, TEMPORAIRE (bureau/liaisonTemporaire.ts) : le lien discret « relier avec un code de liaison (temporaire) ».
  verifier(!/code de liaison|AB1/i.test(accueil.replace('Administrateur : relier avec un code de liaison (temporaire)', '')), 'accueil : aucune mention de code de liaison');
  verifier(/J’ai reçu une invitation/.test(accueil), 'accueil : « J’ai reçu une invitation » est gardé');
  await capture(B, '04-navigateur-neuf-accueil');
  const avant = await fond(B);
  await B.getByTestId('connexion-id-identifiant').fill('enzo');
  const style = await attendre(async () => (await fond(B)) === FONDS.sauge, 15_000, 300);
  verifier(style, `le style du compte s’applique dès qu’on tape le nom (fond ${avant} → ${await fond(B)})`);
  await capture(B, '05-navigateur-style-enzo');
  await B.getByTestId('connexion-id-identifiant').fill('quelquun-dinconnu');
  await pause(1500);
  verifier((await fond(B)) === FONDS.sauge || (await fond(B)) === avant, 'identifiant inconnu : réponse neutre (aucun autre style révélé)');
  await B.getByTestId('connexion-id-identifiant').fill('Enzo');
  await B.getByTestId('connexion-id-mdp').fill('mauvais mot de passe');
  await B.getByTestId('connexion-id-valider').click();
  const refus = await texteDe(B, 'connexion-id-erreur', 60_000);
  verifier(/Identifiant ou mot de passe incorrect/.test(refus), `mauvais mot de passe : « ${refus.slice(0, 60)} »`);
  await B.getByTestId('connexion-id-mdp').fill(MDP_ENZO);
  await B.getByTestId('connexion-id-valider').click();
  // Version 10 : le code à six chiffres du PC est gardé, le serveur le demande (le pas de la migration est consommé).
  if (await B.getByTestId('connexion-id-code').waitFor({ timeout: 60_000 }).then(() => true, () => false)) {
    while (Math.floor(Date.now() / 30_000) <= pasMigration) await pause(500);
    await B.getByTestId('connexion-id-code').fill(totp(secret));
    await B.getByTestId('connexion-id-valider').click();
  }
  await B.getByTestId('hub').waitFor({ timeout: 120_000 });
  await fermerBulles(B);
  verifier(true, 'le Fondateur est connecté sur un navigateur neuf avec son nom et son mot de passe, sans code');
  const jetons = journal.filter(a => a.jeton !== 'maitre' && a.jeton !== '' && /^\/v(9|10)\/coffre\/principal/.test(a.chemin));
  verifier(jetons.length > 0 && jetons.every(a => a.jeton === 's1.'), 'le navigateur parle au serveur avec une SESSION (jamais le jeton maître)');
  const recu = await attendre(async () => (await fond(B)) === FONDS.sauge, 60_000, 1000);
  verifier(recu, 'ses données arrivent du serveur : thème Sauge');
  await parametres(B, 'general');
  verifier(await B.getByTestId('parametres-theme-sauge').getAttribute('aria-checked').then(v => v === 'true').catch(() => false), 'Paramètres › thème Sauge coché sur le navigateur neuf');
  await capture(B, '06-navigateur-donnees-recues');

  // ================================================================ 3. Modification B → A
  log('Modification sur B, visible sur A sans liaison');
  await B.getByTestId('parametres-theme-terminal').click();
  await fermerParametres(B);
  const versA = await attendre(async () => {
    await reveiller(A);
    return (await fond(A)) === FONDS.terminal;
  }, 120_000, 2000);
  verifier(versA, 'le thème Terminal choisi sur B arrive sur le PC A');
  await capture(A, '07-pc-recoit-theme-de-b');

  // ================================================================ 4. Hors ligne puis retour du réseau
  log('B hors ligne : modification gardée, envoyée au retour');
  await B.context().setOffline(true);
  await B.evaluate(() => window.dispatchEvent(new Event('offline')));
  await parametres(B, 'general');
  await B.getByTestId('parametres-theme-sauge').click();
  await fermerParametres(B);
  const horsLigne = await attendre(async () => /Hors ligne|attente|injoignable/i.test(await texteDe(B, 'synchro-libelle', 2000)), 30_000, 1000);
  verifier(horsLigne, `indicateur : « ${await texteDe(B, 'synchro-libelle', 2000)} »`);
  await capture(B, '08-navigateur-hors-ligne');
  await B.context().setOffline(false);
  await B.evaluate(() => window.dispatchEvent(new Event('online')));
  const repart = await attendre(async () => {
    await reveiller(A);
    return (await fond(A)) === FONDS.sauge;
  }, 120_000, 2000);
  verifier(repart, 'au retour du réseau, la modification part et arrive sur A');
  verifier(/À jour/.test(await texteDe(B, 'synchro-libelle', 5000)), `indicateur revenu : « ${await texteDe(B, 'synchro-libelle', 2000)} »`);

  // ================================================================ 5. Une amie
  log('PC : invitation de Léa ; Léa se connecte, puis sur un autre appareil par identifiant');
  await allerPageAdministration(A);
  await A.locator('[data-testid="cellule-administration"], [data-testid="tuile-administration"]').first().click();
  await A.getByTestId('app-administration').waitFor({ timeout: 20_000 });
  await A.getByTestId('admin-onglet-utilisateurs').click();
  await A.getByTestId('admin-nouveau').click();
  await A.getByTestId('admin-nom').fill('Léa');
  await A.getByTestId('admin-nouveau-informe').click();
  await A.getByTestId('admin-creer').click();
  // Vérification d'identité éventuelle (mot de passe seulement, depuis la migration).
  if (await A.getByTestId('admin-identite-mdp').waitFor({ timeout: 5_000 }).then(() => true, () => false)) {
    await A.getByTestId('admin-identite-mdp').fill(MDP_ENZO);
    await A.getByTestId('admin-identite-valider').click();
  }
  await A.getByTestId('admin-invitation').waitFor({ timeout: 90_000 });
  const lien = (await texteDe(A, 'admin-invitation-lien', 10_000)).trim();
  verifier(/#invitation=AI1\./.test(lien), 'lien d’invitation créé');
  await A.getByTestId('admin-transmis').click().catch(() => undefined);
  await A.getByTestId('admin-termine').click().catch(() => undefined);
  const iphone = { ...devices['iPhone 13'], ignoreHTTPSErrors: true };
  delete iphone.defaultBrowserType;
  const tel = await (await nouveauContexte(navigateur, iphone)).newPage();
  await tel.goto(local(lien));
  await tel.getByTestId('invitation-mdp').waitFor({ timeout: 90_000 });
  await tel.getByTestId('invitation-mdp').fill(MDP_LEA);
  await tel.getByTestId('invitation-mdp-confirmation').fill(MDP_LEA);
  await tel.getByTestId('invitation-valider').click();
  await tel.getByTestId('hub').waitFor({ timeout: 120_000 });
  verifier(true, 'Léa est connectée par son invitation');
  const autre = await (await nouveauContexte(navigateur, options)).newPage();
  await autre.goto(SITE);
  await autre.getByTestId('connexion-id-identifiant').waitFor({ timeout: 60_000 });
  await autre.getByTestId('connexion-id-identifiant').fill('LEA');
  await autre.getByTestId('connexion-id-mdp').fill(MDP_LEA);
  await autre.getByTestId('connexion-id-valider').click();
  await autre.getByTestId('hub').waitFor({ timeout: 120_000 });
  verifier(true, 'Léa se connecte sur un autre appareil avec son identifiant et son mot de passe');
  const coffreLea = await attendre(async () => (await coffres.etat((await coffresLea()) ?? 'x')).enregistrements > 0, 90_000, 2000);
  verifier(coffreLea, 'Léa a son propre coffre serveur (ses données y sont, chiffrées par sa clé)');
  await capture(autre, '09-amie-autre-appareil');
  async function coffresLea() {
    const p = journal.find(a => /^\/v(9|10)\/coffre\/(?!principal)[a-z0-9]+$/.test(a.chemin));
    return p?.chemin.split('/')[3];
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
