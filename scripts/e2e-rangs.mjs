/**
 * Test de bout en bout des RANGS : coffre du Fondateur (PC simulé) → amis Léa
 * et Hugo → Hugo promu Administrateur (paire créée, Léa re-scellée pour lui)
 * → connexion en Hugo sur le PC puis sur un navigateur relié avec SON code :
 * il ouvre Léa avec son code d'accès (bandeau, journal), ne voit ni n'ouvre
 * le Fondateur → le Fondateur rétrograde Hugo → Hugo n'a plus accès.
 * Faux relais local qui exécute relais/worker.mjs.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-rangs.mjs
 *
 * Variables : PLAYWRIGHT_PATH (dossier de node_modules contenant playwright),
 * CAPTURES (dossier des captures, défaut docs/captures-rangs).
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
import { ONGLET_ADMINISTRATION, allerPageAdministration, codeAmiDejaRelie, idCompteAdmin, nouveauContexte } from './e2e-acceptation.mjs';

const racine = fileURLToPath(new URL('..', import.meta.url));
const requireGlobal = createRequire(join(process.env.PLAYWRIGHT_PATH ?? '/opt/node22/lib/node_modules', 'x.js'));
const { chromium } = requireGlobal('playwright');
const worker = (await import(pathToFileURL(join(racine, 'relais/worker.mjs')).href)).default;

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-rangs');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-rangs-0123456789abcdef01';
const PORT_RELAIS = 8791;
const PORT_SITE = 5201;
const MDP_ADMIN = 'mot-de-passe-du-pc-e2e-très-long-42';

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
const dossier = mkdtempSync(join(tmpdir(), 'e2e-rangs-'));
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
  // Navigateur déjà relié avant la version 9 (plus de carte « code de liaison » à l'accueil).
  await page.goto(`${SITE}#liaison=${code}`);
}

/** Recharge la page (la session en mémoire disparaît) et ouvre un compte par son prénom. */
async function connecter(page, prenom, motDePasse, secret) {
  // Une page qui se recharge (« Revenir à mon compte ») peut interrompre la navigation : on réessaie.
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

async function fermerPopups(page) {
  for (let i = 0; i < 3; i++) {
    const clique = await page.getByText(/^(Fermer|Terminé|Compris|Plus tard)$/).first().click({ timeout: 2500 }).then(() => true, () => false);
    if (!clique) break;
  }
  await page.keyboard.press('Escape').catch(() => undefined);
}

/** Vérification d'identité si elle est demandée (fenêtre de confiance sinon). */
async function identiteSiDemandee(page, motDePasse, secret) {
  const demandee = await page.getByTestId('admin-identite-mdp').waitFor({ timeout: 4000 }).then(() => true, () => false);
  if (demandee) await confirmerIdentite(page, motDePasse, secret);
}

async function ficheDe(page, nom) {
  await page.getByTestId('admin-onglet-utilisateurs').click();
  await page.getByTestId('admin-liste').getByText(nom, { exact: true }).first().click();
  await page.getByTestId('admin-detail').waitFor({ timeout: 20_000 });
}

/** Change le rang depuis la fiche ouverte (confirmation + mot de passe + code). */
async function changerRang(page, rang, motDePasse, secret) {
  await page.getByTestId('admin-rang-changer').click();
  await page.getByTestId(`admin-rang-choix-${rang}`).click();
  await page.getByTestId('admin-rang-confirmer').click();
  await confirmerIdentite(page, motDePasse, secret);
  await page.getByTestId('admin-avis').waitFor({ timeout: 60_000 });
  return page.getByTestId('admin-avis').innerText();
}

/** Ouvre le compte de `nom` avec le code d'accès affiché (titulaire connecté, Administration ouverte). */
async function ouvrirCompteDe(page, nom, motDePasse, secret) {
  await ficheDe(page, nom);
  await page.getByTestId('admin-code-afficher').click();
  await identiteSiDemandee(page, motDePasse, secret);
  await page.getByTestId('admin-code-acces').waitFor({ timeout: 30_000 });
  await page.getByTestId('admin-ouvrir-compte').click();
  await page.getByTestId('admin-ouvrir-code-affiche').click();
  await page.getByTestId('admin-ouvrir-confirmer').click();
  await identiteSiDemandee(page, motDePasse, secret);
  await page.getByTestId('bandeau-session-admin').waitFor({ timeout: 60_000 });
  return page.getByTestId('bandeau-session-texte').innerText();
}

const tuileAdministration = page => page.locator('[data-testid="cellule-administration"], [data-testid="tuile-administration"]');
const avecJeton = (jeton, chemin) => worker.fetch(new Request(`https://relais${chemin}`, { headers: { Authorization: `Bearer ${jeton}` } }), env);
const charge = cle => JSON.parse(JSON.parse(kv.get(cle)).charge ?? 'null');

const navigateur = await chromium.launch({ headless: true });
const options = { ignoreHTTPSErrors: true, viewport: { width: 1100, height: 860 }, acceptDownloads: true };
try {
  const pc = await (await nouveauContexte(navigateur, options)).newPage();
  pc.on('pageerror', e => log('erreur page PC :', e.message));

  // ================================================================ PC simulé : le Fondateur
  log('PC : coffre du compte historique (Fondateur), relié au relais');
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
  if (!secretAdmin) throw new Error('secret TOTP introuvable');
  await pc.getByRole('switch').click();
  await pc.getByTestId('bouton-continuer').click();
  await pc.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(pc, MDP_ADMIN, secretAdmin));
  await fermerPopups(pc);

  log('PC : le Fondateur crée Léa et Hugo');
  await ouvrirAdministration(pc);
  verifier((await pc.getByTestId('admin-mon-rang').innerText()).includes('Fondateur'), 'le compte historique est Fondateur (badge de rang)');
  const lea = await creerAmi(pc, 'Léa');
  const hugo = await creerAmi(pc, 'Hugo');

  log('PC : Hugo promu Administrateur');
  await ficheDe(pc, 'Hugo');
  const avisPromotion = await changerRang(pc, 'administrateur', MDP_ADMIN, secretAdmin);
  verifier(/Administrateur/.test(avisPromotion) && !/attente/.test(avisPromotion), `promotion faite, clé créée et Léa re-scellée (« ${avisPromotion} »)`);
  verifier((await pc.getByTestId('admin-fiche-rang').first().innerText()).includes('Administrateur'), 'badge « Administrateur » sur la fiche de Hugo');
  await pc.getByTestId('admin-onglet-utilisateurs').click();
  await capture(pc, '01-fondateur-hugo-promu');
  verifier((await pc.getByTestId('admin-filtre-rang-administrateur').count()) === 1, 'filtre par rang (Administrateurs) proposé au Fondateur');

  // ================================================================ Hugo sur le PC
  log('PC : connexion en Hugo (Administrateur)');
  await connecter(pc, 'Hugo', hugo.motDePasse, hugo.secret);
  await allerPageAdministration(pc);
  await tuileAdministration(pc).first().waitFor({ timeout: 30_000 });
  verifier((await pc.locator('[data-testid="cellule-claude-office"], [data-testid="tuile-claude-office"]').count()) === 0, 'Hugo (Administrateur) ne voit pas Claude Office, réservé au Fondateur');
  await ouvrirAdministration(pc);
  verifier((await pc.getByTestId('admin-mon-rang').innerText()).includes('Administrateur'), 'Hugo se voit Administrateur');
  await pc.getByTestId('admin-onglet-utilisateurs').click();
  const leaVue = await attendre(async () => (await pc.getByTestId('admin-liste').getByText('Léa', { exact: true }).count()) > 0, 30_000);
  verifier(leaVue, 'Hugo voit Léa (Ami)');
  verifier((await pc.getByTestId('admin-ligne-principal').count()) === 0, 'Hugo ne voit pas le Fondateur dans la liste');
  verifier((await pc.getByTestId('admin-filtre-rang-fondateur').count()) === 0 && (await pc.getByTestId('admin-filtre-rang-administrateur').count()) === 0, 'le filtre de Hugo ne propose ni Fondateurs ni Administrateurs');
  verifier((await pc.getByTestId('admin-onglet-applications').count()) === 0, 'pas de section « Applications » (apps globales) pour un Administrateur');
  await capture(pc, '02-pc-hugo-administration');
  const bandeauPc = await ouvrirCompteDe(pc, 'Léa', hugo.motDePasse, hugo.secret);
  verifier(/Hugo \(Administrateur\)/.test(bandeauPc) && /Léa/.test(bandeauPc), `bandeau de session : « ${bandeauPc} »`);
  await capture(pc, '03-pc-hugo-ouvre-lea');
  await pc.getByTestId('quitter-session-admin').click();
  await connecter(pc, 'Hugo', hugo.motDePasse, hugo.secret);
  await ouvrirAdministration(pc);
  await pc.getByTestId('admin-onglet-journal').click();
  const journalHugo = await attendre(async () => (await pc.getByText(/Ouverture du compte de Léa par Hugo \(Administrateur/).count()) > 0, 20_000);
  verifier(journalHugo, 'journal de Hugo : « Ouverture du compte de Léa par Hugo (Administrateur, code d’accès) »');
  await capture(pc, '04-pc-hugo-journal');

  // ================================================================ Retour du Fondateur : publication, code de Hugo
  log('PC : le Fondateur revient (journal, publication, code de Hugo pour le site)');
  await connecter(pc, 'admin', MDP_ADMIN, secretAdmin);
  await ouvrirAdministration(pc);
  await pc.getByTestId('admin-onglet-journal').click();
  const journalFondateur = await attendre(async () => (await pc.getByText(/Ouverture du compte de Léa par Hugo/).count()) > 0, 30_000);
  verifier(journalFondateur, 'le journal du Fondateur reçoit l’accès de Hugo (avec son nom)');
  await capture(pc, '05-fondateur-journal-acces-hugo');
  // Navigateur de Hugo déjà relié avant la version 9 (plus de « code de connexion au site »).
  await pc.getByTestId('admin-onglet-utilisateurs').click();
  const codeHugo = await codeAmiDejaRelie(`https://localhost:${PORT_RELAIS}`, JETON, await idCompteAdmin(pc, 'Hugo'));
  const jetonHugo = JSON.parse(Buffer.from(codeHugo.slice(4).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).j;
  const idHugo = jetonHugo.split('.')[1];
  const publie = await attendre(() => kv.has(`p:${idHugo}:annuaire`) && kv.has('rangs') && Object.keys(JSON.parse(kv.get('rangs')).delegations ?? {}).includes(idHugo), 120_000);
  verifier(publie, 'projection de Hugo et délégations publiées');
  const projection = charge(`p:${idHugo}:annuaire`);
  const idLea = (projection?.comptes ?? []).map(c => c.id).find(id => id !== idHugo);
  const annuaireComplet = charge('p:principal:annuaire');
  const empreinteFondateur = annuaireComplet?.entites?.admin?.empreinte;
  const brutHugo = JSON.stringify(projection);
  verifier(
    Boolean(idLea) &&
      projection.comptes.length === 2 &&
      !brutHugo.includes(empreinteFondateur) &&
      JSON.stringify(Object.keys(projection.admin)) === '["cleSequestre"]' &&
      !/"(fondateurs|journalGestion|priveeScellee|registre|partage)"/.test(brutHugo) &&
      projection.prive === undefined &&
      Object.keys(projection.comptes.find(c => c.id === idLea).sequestres ?? {}).join() === idHugo,
    'espace relais de Hugo : Léa et lui seulement ; rien du Fondateur (ni empreinte, ni clé privée scellée, ni registre, ni bloc privé)',
  );
  verifier(JSON.stringify(JSON.parse(kv.get('rangs')).delegations[idHugo]) === JSON.stringify([idLea]), 'délégation de Hugo : le coffre et le portefeuille de Léa seulement');

  // ================================================================ Navigateur de Hugo
  log('Navigateur de Hugo : relier avec SON code');
  const nav = await (await nouveauContexte(navigateur, options)).newPage();
  nav.on('pageerror', e => log('erreur page navigateur de Hugo :', e.message));
  await relier(nav, codeHugo);
  await nav.getByTestId('connexion-prenom').waitFor({ timeout: 60_000 });
  // Le Fondateur n'existe pas sur ce navigateur (relié au seul compte de Hugo) : son prénom ne mène à rien,
  // avec un message précis (le leurre reste réservé aux appareils du Fondateur, voir docs/connexion-amis.md).
  await nav.getByTestId('connexion-prenom').fill('admin');
  await nav.getByTestId('connexion-continuer').click();
  const leurre = await nav.getByTestId('connexion-prenom-erreur').innerText({ timeout: 20_000 }).catch(() => '');
  verifier(/Identifiant inconnu sur ce navigateur/.test(leurre) && (await nav.getByTestId('bouton-deverrouiller').count()) === 0, `navigateur de Hugo : le Fondateur n’y ouvre rien (« ${leurre.slice(0, 50)}… »)`);
  await nav.getByTestId('connexion-prenom').fill('Hugo');
  await nav.getByTestId('connexion-continuer').click();
  await nav.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 });
  await deverrouiller(nav, hugo.motDePasse, hugo.secret);
  await fermerPopups(nav);
  await ouvrirAdministration(nav);
  await nav.getByTestId('admin-onglet-utilisateurs').click();
  const leaSite = await attendre(async () => (await nav.getByTestId('admin-liste').getByText('Léa', { exact: true }).count()) > 0, 30_000);
  verifier(leaSite, 'sur le site, Hugo administre Léa');
  verifier((await nav.getByTestId('admin-ligne-principal').count()) === 0, 'sur le site, aucun Fondateur dans la liste de Hugo');
  await capture(nav, '06-site-hugo-administration');
  const avantOuvertureSite = journalRelais.length;
  const bandeauSite = await ouvrirCompteDe(nav, 'Léa', hugo.motDePasse, hugo.secret);
  verifier(/Hugo \(Administrateur\)/.test(bandeauSite) && /Léa/.test(bandeauSite), `site : bandeau « ${bandeauSite} »`);
  const appelsHugo = journalRelais.slice(avantOuvertureSite).filter(a => a.portee === idHugo);
  verifier(appelsHugo.some(a => a.chemin === `/p/${idLea}/boite/coffre` && a.statut === 200), 'site : le coffre de Léa arrive par délégation');
  await capture(nav, '07-site-hugo-ouvre-lea');
  const tousAppelsHugo = journalRelais.filter(a => a.portee === idHugo);
  verifier(!tousAppelsHugo.some(a => a.chemin.startsWith('/p/principal/') || a.chemin.startsWith('/boite')), 'le navigateur de Hugo n’a jamais appelé l’espace du Fondateur');
  const statutsHugo = [
    (await avecJeton(jetonHugo, '/p/principal/boite/annuaire')).status,
    (await avecJeton(jetonHugo, '/p/principal/boite/admin')).status,
    (await avecJeton(jetonHugo, `/p/${idLea}/boite/annuaire`)).status,
    (await avecJeton(jetonHugo, '/boite/coffre')).status,
    (await avecJeton(jetonHugo, '/rangs')).status,
  ];
  verifier(statutsHugo.every(s => s === 403), `le jeton de Hugo ne lit rien du Fondateur ni l’annuaire de Léa (${statutsHugo.join(', ')})`);
  await nav.getByTestId('quitter-session-admin').click();
  await connecter(nav, 'Hugo', hugo.motDePasse, hugo.secret);
  await ouvrirAdministration(nav);
  await nav.getByTestId('admin-onglet-journal').click();
  verifier(await attendre(async () => (await nav.getByText(/Ouverture du compte de Léa par Hugo/).count()) > 0, 20_000), 'site : l’accès est au journal de Hugo');
  await capture(nav, '08-site-hugo-journal');

  // ================================================================ Rétrogradation
  log('PC : le Fondateur rétrograde Hugo');
  await ficheDe(pc, 'Hugo');
  const avisRetro = await changerRang(pc, 'ami', MDP_ADMIN, secretAdmin);
  verifier(/n’est|maintenant Ami|Ami/.test(avisRetro), `rétrogradation (« ${avisRetro} »)`);
  await capture(pc, '09-fondateur-retrograde-hugo');
  const retire = await attendre(async () => {
    await pc.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    return !Object.keys(JSON.parse(kv.get('rangs') ?? '{}').delegations ?? {}).includes(idHugo);
  }, 120_000, 3000);
  verifier(retire, 'délégation de Hugo retirée du relais');
  verifier((await avecJeton(jetonHugo, `/p/${idLea}/boite/coffre`)).status === 403, 'le jeton de Hugo ne lit plus le coffre de Léa (403)');
  const projectionApres = await attendre(() => (charge(`p:${idHugo}:annuaire`)?.comptes ?? []).length === 1, 60_000);
  verifier(projectionApres, 'l’espace de Hugo ne contient plus que son compte');
  await connecter(nav, 'Hugo', hugo.motDePasse, hugo.secret);
  const sansTuileSite = await attendre(async () => (await tuileAdministration(nav).count()) === 0 && (await nav.locator(ONGLET_ADMINISTRATION).count()) === 0, 30_000);
  verifier(sansTuileSite, 'site : Hugo n’a plus d’Administration');
  await capture(nav, '10-site-hugo-retrograde');
  await connecter(pc, 'Hugo', hugo.motDePasse, hugo.secret);
  const sansTuilePc = await attendre(async () => (await tuileAdministration(pc).count()) === 0 && (await pc.locator(ONGLET_ADMINISTRATION).count()) === 0, 30_000);
  verifier(sansTuilePc, 'PC : Hugo n’a plus d’Administration');
  await capture(pc, '11-pc-hugo-retrograde');
  log(`relais : ${compteurs.put} PUT, ${compteurs.get} GET, ${compteurs.list} listes`);
  void lea;
} catch (erreur) {
  echecs++;
  console.log('  ECHEC', erreur instanceof Error ? erreur.message.split('\n')[0] : erreur);
  for (const [i, contexte] of navigateur.contexts().entries()) {
    for (const page of contexte.pages()) {
      await page.screenshot({ path: join(CAPTURES, `echec-${i}.png`) }).catch(() => undefined);
      console.log(`--- page ${i} :`, (await page.locator('body').innerText().catch(() => '')).slice(0, 800));
    }
  }
} finally {
  await navigateur.close();
  serveurRelais.close();
  serveurSite.close();
}
console.log(echecs === 0 ? 'E2E OK' : `E2E : ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
