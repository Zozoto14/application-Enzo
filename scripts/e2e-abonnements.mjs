/**
 * Test de bout en bout des ABONNEMENTS (suivi manuel) : Fondateur (PC simulé)
 * → crée Léa et Hugo → hub, page « Administration » → app Abonnements (plus
 * d'onglet Abonnements dans l'Administration) : « Marquer payé »
 * (échéance recalculée), notes privées, échéance dépassée (« En retard »),
 * message à copier, export CSV → la ligne d'état de Léa arrive dans SON espace
 * du relais (sans notes, sans historique, sans Hugo) → sur le site, son hub
 * affiche le rappel amical. Faux relais local qui exécute relais/relais.mjs.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-abonnements.mjs
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
import { allerPageAdministration, codeAmiDejaRelie, idCompteAdmin, nouveauContexte, tuileApp } from './e2e-acceptation.mjs';

const racine = fileURLToPath(new URL('..', import.meta.url));
const requireGlobal = createRequire(join(process.env.PLAYWRIGHT_PATH ?? '/opt/node22/lib/node_modules', 'x.js'));
const { chromium } = requireGlobal('playwright');
const { relais: coeurRelais } = await import(pathToFileURL(join(racine, 'relais/relais.mjs')).href);

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-abonnements');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-abonnements-0123456789abcdef01';
const PORT_RELAIS = 8793;
const PORT_SITE = 5203;
const MDP_ADMIN = 'mot-de-passe-du-pc-e2e-très-long-42';

// ------------------------------------------------------------- Faux relais (boîte avec liste et métadonnées)
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
const dossier = mkdtempSync(join(tmpdir(), 'e2e-abonnements-'));
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
  const reponse = await coeurRelais.traiter(requete, env);
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
const avecJeton = (jeton, chemin) => coeurRelais.traiter(new Request(`https://relais${chemin}`, { headers: { Authorization: `Bearer ${jeton}` } }), env);
const charge = cle => JSON.parse(JSON.parse(kv.get(cle)).charge ?? 'null');


const navigateur = await chromium.launch({ headless: true });
const options = { ignoreHTTPSErrors: true, viewport: { width: 1100, height: 900 }, acceptDownloads: true };
const isoJour = decalage => new Date(Date.now() + decalage * 86_400_000).toISOString().slice(0, 10);
const NOTE_SECRETE = 'NOTE-PRIVEE-ABO-XYZ';
try {
  const pc = await (await nouveauContexte(navigateur, options)).newPage();
  pc.on('pageerror', e => log('erreur page PC :', e.message));

  log('PC : coffre du Fondateur, relié au relais');
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
  const lea = await creerAmi(pc, 'Léa');
  const hugo = await creerAmi(pc, 'Hugo');

  // ---------------------------------------------------------------- App Abonnements
  verifier((await pc.getByTestId('admin-onglet-abonnements').count()) === 0 && (await pc.getByTestId('admin-section-abonnements').count()) === 0, 'Administration : plus d’onglet ni de section Abonnements');
  log('PC : hub, page Administration → app Abonnements');
  await pc.getByTestId('retour-hub').click();
  await pc.getByTestId('hub').waitFor({ timeout: 20_000 });
  verifier((await pc.getByTestId('hub-page-administration').getAttribute('aria-selected')) === 'true', 'retour de l’Administration : le hub reste sur la page Administration');
  verifier((await tuileApp(pc, 'abonnements').count()) > 0 && (await tuileApp(pc, 'portefeuille').count()) === 0, 'page Administration : tuile Abonnements, pas de Portefeuille');
  await pause(800); // apparition des tuiles
  await capture(pc, '00-hub-page-administration');
  await pc.getByTestId('hub-page-publique').click();
  verifier((await tuileApp(pc, 'abonnements').count()) === 0 && (await tuileApp(pc, 'portefeuille').count()) > 0, 'page Applications : Portefeuille, pas d’Abonnements');
  await allerPageAdministration(pc);
  await tuileApp(pc, 'abonnements').first().click();
  await pc.getByTestId('app-abonnements').waitFor({ timeout: 20_000 });
  await pc.getByTestId('admin-section-abonnements').waitFor({ timeout: 20_000 });
  const aide = await pc.getByTestId('admin-abonnements-aide').innerText();
  verifier(/manuel/i.test(aide) && /fiscal|juridique/i.test(aide), 'texte d’aide : suivi manuel, aucun conseil fiscal ou juridique');
  const ids = await pc.locator('[data-testid^="admin-abo-paye-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid').replace('admin-abo-paye-', '')));
  verifier(ids.length === 2, 'deux comptes suivis (Léa et Hugo)');
  const idDe = async nom => {
    for (const id of ids) {
      if ((await pc.getByTestId(`admin-abo-${id}`).innerText()).includes(nom)) return id;
    }
    throw new Error(`compte ${nom} introuvable`);
  };
  const idLea = await idDe('Léa');
  const idHugo = await idDe('Hugo');

  // Léa : notes privées, échéance dans 3 jours, puis « Marquer payé ».
  await pc.getByTestId(`admin-abo-modifier-${idLea}`).click();
  await pc.getByTestId('admin-abo-form-notes').fill(NOTE_SECRETE);
  await pc.getByTestId('admin-abo-form-compte-valider').click();
  await pc.getByTestId(`admin-abo-echeance-bouton-${idLea}`).click();
  const echeanceAvant = isoJour(-10);
  await pc.getByTestId('admin-abo-form-echeance').fill(echeanceAvant);
  await pc.getByTestId('admin-abo-form-echeance-valider').click();
  verifier(/En retard/.test(await pc.getByTestId(`admin-abo-statut-${idLea}`).innerText()), 'Léa : échéance dépassée de 10 jours → « En retard »');
  await capture(pc, '01-abonnements-retard');
  await pc.getByTestId(`admin-abo-paye-${idLea}`).click();
  await pc.getByTestId('admin-abo-form-valider').click();
  const apresPaiement = await pc.getByTestId(`admin-abo-echeance-${idLea}`).innerText();
  const attendue = new Date(echeanceAvant + 'T12:00:00Z');
  attendue.setUTCMonth(attendue.getUTCMonth() + 1);
  const [a, m, j] = attendue.toISOString().slice(0, 10).split('-');
  verifier(apresPaiement.includes(`${j}/${m}/${a}`), `marquer payé : échéance recalculée d’un mois (« ${apresPaiement} »)`);
  verifier(/Dernier|paiement/i.test(await pc.getByTestId(`admin-abo-dernier-${idLea}`).innerText()), 'dernier paiement affiché');
  await capture(pc, '02-abonnements-paye');

  // Léa repasse en retard (échéance hier) ; Hugo reste à jour (dans 200 jours).
  await pc.getByTestId(`admin-abo-echeance-bouton-${idLea}`).click();
  await pc.getByTestId('admin-abo-form-echeance').fill(isoJour(-1));
  await pc.getByTestId('admin-abo-form-echeance-valider').click();
  await pc.getByTestId(`admin-abo-echeance-bouton-${idHugo}`).click();
  await pc.getByTestId('admin-abo-form-echeance').fill(isoJour(200));
  await pc.getByTestId('admin-abo-form-echeance-valider').click();
  verifier(/En retard/.test(await pc.getByTestId(`admin-abo-statut-${idLea}`).innerText()), 'Léa : de nouveau en retard');
  verifier(/À jour/.test(await pc.getByTestId(`admin-abo-statut-${idHugo}`).innerText()), 'Hugo : à jour');
  const resume = await pc.getByTestId('admin-abonnements-resume').innerText();
  verifier(/1 abonnement en retard/.test(resume), `résumé des rappels : « ${resume} »`);

  // Message à copier, historique.
  await pc.getByTestId(`admin-abo-message-${idLea}`).click();
  const message = await pc.getByTestId('admin-abo-message-texte').inputValue();
  verifier(/Léa/.test(message), 'message de rappel personnalisé (nom)');
  await pc.getByTestId(`admin-abo-historique-${idLea}`).click();
  await pc.getByTestId(`admin-abo-historique-liste-${idLea}`).waitFor({ timeout: 10_000 });

  // Export CSV.
  const [telechargement] = await Promise.all([pc.waitForEvent('download', { timeout: 20_000 }).catch(() => undefined), pc.getByTestId('admin-abo-export').click()]);
  if (telechargement) {
    const chemin = await telechargement.path();
    const csv = readFileSync(chemin, 'utf8');
    verifier(/compte;|compte,/.test(csv) && /Léa/.test(csv) && !csv.includes(NOTE_SECRETE), 'export CSV : historique de Léa, sans notes privées');
  } else {
    verifier(false, 'export CSV : aucun téléchargement');
  }

  // Réglages : un onglet de l'app (plus dans Paramètres › Administration).
  await pc.getByTestId('abo-onglet-reglages').click();
  verifier((await pc.getByTestId('parametres-abonnements').count()) === 1, 'app Abonnements : onglet Réglages');
  await capture(pc, '02b-abonnements-reglages');
  await pc.getByTestId('abo-onglet-suivi').click();
  await pc.getByTestId('app-parametres-ouvrir').click();
  await pc.getByTestId('parametres-section-administration').click();
  await pc.getByTestId('reglage-admin-reglages').waitFor({ timeout: 10_000 }).catch(() => undefined);
  verifier((await pc.getByTestId('parametres-abonnements').count()) === 0, 'Paramètres › Administration : plus de réglages des abonnements');
  await pc.getByTestId('hub-parametres-fermer').click();

  // Tableau de bord de l'Administration : la cloche ouvre l'app Abonnements.
  await pc.keyboard.press('Escape');
  await pc.getByTestId('hub').waitFor({ timeout: 20_000 });
  await ouvrirAdministration(pc);
  await pc.getByTestId('admin-onglet-tableau').click();
  verifier((await pc.getByTestId('admin-abonnements-rappel').count()) === 1, 'tableau de bord : rappel des abonnements');
  await capture(pc, '03-tableau-rappel');
  await pc.getByTestId('admin-abonnements-rappel').click();
  verifier(await pc.getByTestId('app-abonnements').waitFor({ timeout: 20_000 }).then(() => true, () => false), 'le rappel du tableau de bord ouvre l’app Abonnements');
  await pc.getByTestId('retour-hub').click();
  await ouvrirAdministration(pc);

  // ---------------------------------------------------------------- Relais : isolation
  log('Relais : projection des comptes');
  const cle = id => `p:${id}:abonnement`;
  const publie = await attendre(async () => {
    await pc.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    return kv.has(cle(idLea));
  }, 120_000, 3000);
  verifier(publie, 'la ligne d’abonnement de Léa est publiée dans son espace');
  if (publie) {
    const brut = JSON.stringify(charge(cle(idLea)));
    verifier(!brut.includes(NOTE_SECRETE) && !/notes|paiements/.test(brut) && !brut.includes(idHugo), `la ligne de Léa : statut et échéance seulement (${brut.slice(0, 120)})`);
  }
  const brutHugo = kv.has(cle(idHugo)) ? JSON.stringify(charge(cle(idHugo))) : '';
  verifier(!brutHugo.includes(NOTE_SECRETE) && !brutHugo.includes(idLea), 'la ligne de Hugo ne contient rien de Léa');
  const tousBruts = [...kv.entries()].filter(([c]) => c !== 'index').map(([c, v]) => (c.startsWith('p:principal') ? '' : v)).join('');
  verifier(!tousBruts.includes(NOTE_SECRETE), 'les notes privées ne sortent jamais de la base de l’administrateur (rien de clair hors espace principal)');

  // ---------------------------------------------------------------- Léa et Hugo sur le site : chacun son rappel
  const ouvrirSite = async (nom, ami) => {
    await pc.getByTestId('admin-onglet-utilisateurs').click();
    await pc.getByTestId('admin-liste').getByText(nom, { exact: true }).first().click();
    await pc.getByTestId('admin-detail').waitFor({ timeout: 20_000 });
    // Navigateur de l'ami déjà relié avant la version 9 (plus de « code de connexion au site »).
    await pc.getByTestId('admin-onglet-utilisateurs').click();
    const code = await codeAmiDejaRelie(`https://localhost:${PORT_RELAIS}`, JETON, await idCompteAdmin(pc, nom));
    const nav = await (await nouveauContexte(navigateur, options)).newPage();
    nav.on('pageerror', e => log(`erreur page ${nom} :`, e.message));
    await relier(nav, code);
    await nav.getByTestId('connexion-prenom').waitFor({ timeout: 60_000 });
    await nav.getByTestId('connexion-prenom').fill(nom);
    await nav.getByTestId('connexion-continuer').click();
    await nav.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 });
    await deverrouiller(nav, ami.motDePasse, ami.secret);
    await fermerPopups(nav);
    return nav;
  };
  log('Site : Léa reçoit SON rappel');
  const navLea = await ouvrirSite('Léa', lea);
  const rappelLea = await navLea.getByTestId('hub-abonnement-rappel').waitFor({ timeout: 90_000 }).then(() => true, () => false);
  verifier(rappelLea, 'le hub de Léa affiche son rappel amical');
  if (rappelLea) {
    const texteLea = await navLea.getByTestId('hub-abonnement-rappel-texte').innerText();
    verifier(!texteLea.includes(NOTE_SECRETE), `message de Léa : « ${texteLea} »`);
    verifier(!(await navLea.locator('body').innerText()).includes(NOTE_SECRETE), 'la page de Léa ne contient aucune note privée');
    await capture(navLea, '04-hub-lea-rappel');
  }
  verifier((await navLea.getByTestId('hub-abonnements-admin').count()) === 0, 'Léa ne voit pas la cloche de l’administrateur');
  log('Site : Hugo (à jour) ne voit aucun rappel');
  const navHugo = await ouvrirSite('Hugo', hugo);
  await pause(8000);
  verifier((await navHugo.getByTestId('hub-abonnement-rappel').count()) === 0, 'le hub de Hugo (à jour) n’affiche aucun rappel');
  await capture(navHugo, '05-hub-hugo-sans-rappel');
  // La cloche de l'administrateur dans son hub.
  await pc.goto(SITE).catch(() => undefined);
  await connecter(pc, 'admin', MDP_ADMIN, secretAdmin);
  const cloche = await pc.getByTestId('hub-abonnements-texte').waitFor({ timeout: 30_000 }).then(() => pc.getByTestId('hub-abonnements-texte').innerText(), () => '');
  verifier(/1 abonnement en retard/.test(cloche), `hub de l’administrateur : cloche « ${cloche} »`);
  await capture(pc, '06-hub-admin-cloche');
  await pc.getByTestId('hub-abonnements-voir').click();
  verifier(await pc.getByTestId('app-abonnements').waitFor({ timeout: 20_000 }).then(() => true, () => false), '« Voir les abonnements » ouvre l’app Abonnements');
  verifier(/En retard/.test(await pc.getByTestId(`admin-abo-statut-${idLea}`).innerText()), 'après reconnexion : les données des abonnements sont intactes (Léa en retard)');
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
