/**
 * Test de bout en bout : verrouillage automatique, Support (tickets vers un faux webhook Discord par le VRAI
 * relais/worker.mjs), documents légaux et acceptation à la première connexion.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-support-verrou.mjs
 *
 * Le faux « Discord » est un simple tableau en mémoire : le relais appelle `fetch(https://discord.com/api/webhooks/…)`,
 * intercepté ici. Captures dans docs/captures-support (variable CAPTURES).
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

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-support');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-support-0123456789abcdef';
const PORT_RELAIS = 8791;
const PORT_SITE = 5197;
const MDP_ADMIN = 'mot-de-passe-du-pc-e2e-très-long-42';
const MDP_ANCIEN = 'ancien-coffre-du-site-e2e-long-17';

// ------------------------------------------------------------- Faux relais (KV avec liste et métadonnées)
const kv = new Map();
const metas = new Map();
const compteurs = { put: 0, get: 0, list: 0 };
const WEBHOOK = 'https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
const discord = [];
const fetchReel = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url) === WEBHOOK) {
    discord.push({ contentType: init?.headers?.['Content-Type'] ?? init?.headers?.['content-type'] ?? '', body: init?.body });
    return new Response(null, { status: 204 });
  }
  return fetchReel(url, init);
};
const env = {
  JETON,
  DISCORD_WEBHOOK_URL: WEBHOOK,
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
const dossier = mkdtempSync(join(tmpdir(), 'e2e-support-'));
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
const erreursPage = [];
try {
  const page = await (await navigateur.newContext(options)).newPage();
  page.on('pageerror', e => {
    erreursPage.push(e.message);
    log('erreur page :', e.message);
  });

  log('Création du coffre (relié au faux relais)');
  await page.goto(`${SITE}#liaison=${CODE_PC}`);
  await page.getByTestId('accueil-site').waitFor({ timeout: 60_000 });
  await page.getByTestId('accueil-creer').click();
  await page.getByTestId('accueil-creer-confirmer').click();
  const champs = page.locator('input[type=password]');
  await champs.nth(0).waitFor({ timeout: 60_000 });
  await champs.nth(0).fill(MDP_ADMIN);
  await champs.nth(1).fill(MDP_ADMIN);
  await page.getByTestId('bouton-creer').click();
  await page.getByText('À noter maintenant').waitFor({ timeout: 60_000 });
  const secret = ((await page.locator('body').innerText()).match(/\b[A-Z2-7]{16,}\b/) ?? [])[0];
  if (!secret) throw new Error('secret TOTP introuvable');
  await page.getByRole('switch').click();
  await page.getByTestId('bouton-continuer').click();

  // ================================================================ Acceptation à la première connexion
  log('Première connexion : acceptation des documents');
  const barriere = await page.getByTestId('acceptation-juridique').waitFor({ timeout: 60_000 }).then(() => true, () => false);
  verifier(barriere, 'la première connexion demande d’accepter les documents légaux');
  verifier((await page.getByTestId('hub').count()) === 0, 'le hub n’est pas accessible avant l’acceptation');
  await capture(page, '01-acceptation-premiere-connexion');
  await page.getByTestId('acceptation-continuer').click();
  verifier(await page.getByTestId('acceptation-juridique').isVisible(), '« Continuer » ne passe pas sans la case cochée');
  await page.getByTestId('acceptation-lire-cookies').click();
  await page.getByTestId('hub-juridique').waitFor({ timeout: 10_000 });
  const cookies = await page.getByTestId('juridique-texte').innerText();
  verifier(/aucun cookie de suivi/i.test(cookies) && /stockage local/i.test(cookies), 'le texte « Cookies » est véridique : aucun cookie de suivi, stockage local fonctionnel');
  verifier(/relire par un professionnel du droit/i.test(await page.getByTestId('juridique-avertissement').innerText()), 'l’avertissement « à faire relire par un professionnel du droit » est affiché');
  await capture(page, '02-document-cookies');
  await page.getByTestId('juridique-fermer').click();
  await page.getByTestId('acceptation-case').click();
  await page.getByTestId('acceptation-continuer').click();
  await page.getByTestId('hub').waitFor({ timeout: 30_000 });
  verifier(true, 'après acceptation, le hub s’ouvre');
  await page.getByText(/Fermer|Terminé|Compris|Plus tard/).first().click({ timeout: 3000 }).catch(() => undefined);
  await page.keyboard.press('Escape').catch(() => undefined);

  // ================================================================ Support → faux Discord
  log('Support : ticket vers le faux webhook par le vrai relais');
  await page.getByTestId('hub-support-ouvrir').click();
  await page.getByTestId('hub-support').waitFor({ timeout: 10_000 });
  await page.getByTestId('support-categorie-bug').click();
  await page.getByTestId('support-sujet').fill('Le graphique est vide');
  await page.getByTestId('support-message').fill('Depuis ce matin le graphique reste vide. @everyone regardez vite !');
  await capture(page, '03-support-formulaire');
  await page.getByTestId('support-envoyer').click();
  const envoye = await attendre(async () => discord.length === 1, 30_000, 300);
  verifier(envoye, 'le relais a posté un message sur le webhook (faux Discord)');
  await page.getByTestId('support-resultat').waitFor({ timeout: 10_000 });
  verifier(/Ticket n° 1 envoyé/.test(await page.getByTestId('support-resultat').innerText()), 'l’application annonce « Ticket n° 1 envoyé »');
  const posté = JSON.parse(typeof discord[0]?.body === 'string' ? discord[0].body : '{}');
  verifier(JSON.stringify(posté.allowed_mentions) === '{"parse":[]}', 'allowed_mentions : { parse: [] } (aucune mention ne notifie)');
  verifier(/Le graphique est vide/.test(JSON.stringify(posté)), 'le sujet du ticket est dans le message Discord');
  verifier(!/mot de passe|jeton-e2e|AbCdEf/i.test(JSON.stringify(posté)), 'aucun secret (jeton, webhook) dans le message Discord');
  verifier((await page.getByTestId('support-ticket-1-statut').innerText()) === 'Envoyé', '« Mes tickets » : ticket n° 1, état Envoyé');
  await capture(page, '04-support-ticket-envoye');
  // L'adresse du webhook n'est nulle part côté client.
  const fuites = await page.evaluate(async webhook => {
    const morceau = webhook.split('/').slice(-1)[0];
    const trouves = [];
    const html = document.documentElement.outerHTML;
    if (html.includes(morceau)) trouves.push('html');
    for (const s of [localStorage, sessionStorage]) for (let i = 0; i < s.length; i++) if ((s.getItem(s.key(i)) ?? '').includes(morceau)) trouves.push('storage');
    return trouves;
  }, WEBHOOK);
  verifier(fuites.length === 0, `l’adresse du webhook n’apparaît ni dans la page ni dans le stockage du navigateur (${fuites.join(',') || 'rien'})`);
  verifier(!kv.has('support') && ![...kv.keys()].some(c => /ticket|support/i.test(c) && c !== 'support:limite'), 'aucun ticket n’est stocké sur le relais');
  // Retour sans jeton : refus.
  const sansJeton = await fetchReel(`https://localhost:${PORT_RELAIS}/support`, { method: 'POST', body: '{}' }).then(r => r.status, () => 0).catch(() => 0);
  verifier(sansJeton === 401 || sansJeton === 0, 'POST /support sans jeton refusé (401)');
  await page.getByTestId('hub-support-fermer').click();

  // ================================================================ Paramètres › Sécurité › Verrouillage automatique
  log('Paramètres : verrouillage automatique et documents');
  await page.getByTestId('hub-parametres-ouvrir').click().catch(async () => page.getByText('Paramètres').first().click());
  await page.getByTestId('hub-parametres').waitFor({ timeout: 20_000 });
  await page.getByTestId('parametres-section-securite').click();
  await page.getByTestId('parametres-verrou-auto').waitFor({ timeout: 10_000 });
  verifier((await page.getByTestId('verrou-auto-45').getAttribute('aria-checked')) === 'true', 'le délai par défaut est 45 minutes');
  for (const m of [5, 15, 30, 45, 60, 120, 0]) verifier((await page.getByTestId(`verrou-auto-${m}`).count()) === 1, `choix ${m === 0 ? 'Jamais' : m + ' min'} proposé`);
  await page.getByTestId('verrou-auto-15').click();
  verifier((await page.evaluate(() => localStorage.getItem('appdashboard.verrou-auto-minutes'))) === '15', 'le réglage est écrit dans le stockage de l’appareil (non synchronisé)');
  await capture(page, '05-parametres-verrouillage-auto');
  await page.getByTestId('verrou-auto-45').click();
  await page.getByTestId('parametres-section-support').click();
  await page.getByTestId('parametres-support').waitFor({ timeout: 10_000 });
  await capture(page, '06-parametres-support');
  await page.getByTestId('parametres-section-apropos').click();
  await page.getByTestId('parametres-juridique').waitFor({ timeout: 10_000 });
  await capture(page, '07-parametres-a-propos-juridique');
  await page.getByTestId('lien-juridique-conditions').click();
  await page.getByTestId('hub-juridique').waitFor({ timeout: 10_000 });
  const conditions = await page.getByTestId('juridique-texte').innerText();
  verifier(!/(sources?|liens?) [^.]{0,60}(sont|est) légal/i.test(conditions), 'aucune phrase ne dit que l’usage de sources tierces est légal');
  verifier(/ne héberge, ne stocke et ne distribue aucun film/i.test(conditions), 'Tsuzuku n’héberge aucun contenu (conditions)');
  await capture(page, '08-document-conditions');

  // Le Fondateur modifie le texte : pas de nouvelle acceptation pour lui-même, le texte est stocké dans l'annuaire synchronisé.
  await page.getByTestId('juridique-modifier').click();
  await page.getByTestId('juridique-edition').fill('## 1. Objet\n\nConditions personnalisées par le Fondateur (essai).');
  await page.getByTestId('juridique-enregistrer').click();
  await page.getByTestId('juridique-message').waitFor({ timeout: 15_000 });
  verifier(/Texte enregistré/.test(await page.getByTestId('juridique-message').innerText()), 'le Fondateur enregistre son texte');
  verifier(/Conditions personnalisées/.test(await page.getByTestId('juridique-texte').innerText()), 'le texte personnalisé s’affiche');
  await capture(page, '09-document-modifie-par-le-fondateur');
  const annuaireRelais = await attendre(() => [...kv.entries()].some(([c, v]) => c.includes('annuaire') && String(v).length > 0), 60_000);
  verifier(annuaireRelais, 'l’annuaire des comptes est publié sur le relais (les textes légaux voyagent avec lui)');

  // ================================================================ Verrouillage automatique (délai d'essai court)
  log('Verrouillage automatique : délai court');
  await page.getByTestId('juridique-fermer').click();
  await page.getByTestId('juridique-fermer').click().catch(() => undefined);
  await page.evaluate(() => {
    localStorage.setItem('appdashboard.verrou-auto-essai-ms', '3000');
    window.dispatchEvent(new StorageEvent('storage', { key: 'appdashboard.verrou-auto-essai-ms' }));
  });
  const verrouille = await page.getByTestId('bouton-deverrouiller').waitFor({ timeout: 15_000 }).then(() => true, () => false);
  verifier(verrouille, 'sans aucun geste, l’application se verrouille seule après le délai');
  const message = await page.getByTestId('message-deverrouillage').innerText().catch(() => '');
  verifier(/inactivité/.test(message), `l’écran de connexion l’explique (« ${message} »)`);
  await capture(page, '10-verrouille-apres-inactivite');
  verifier((await page.getByTestId('lien-juridique-mentions').count()) === 1, 'le pied de page de l’écran de connexion propose les documents légaux');
  await page.getByTestId('lien-juridique-conditions').click();
  await page.getByTestId('hub-juridique').waitFor({ timeout: 10_000 });
  verifier(/Conditions personnalisées/.test(await page.getByTestId('juridique-texte').innerText()), 'les documents se lisent sans être connecté, avec le texte du Fondateur');
  await capture(page, '11-document-avant-connexion');
  await page.getByTestId('juridique-fermer').click();
  await page.getByTestId('juridique-fermer').click();

  // Un geste repousse l'échéance (et la version acceptée est mémorisée : pas de nouvelle demande).
  await deverrouiller(page, MDP_ADMIN, secret);
  verifier((await page.getByTestId('acceptation-juridique').count()) === 0, 'déjà accepté : pas de nouvelle demande à la connexion suivante');
  for (let i = 0; i < 8; i++) {
    await page.mouse.move(100 + i * 20, 200);
    await pause(700);
  }
  verifier(await page.getByTestId('hub').isVisible().catch(() => false), 'des gestes réguliers (souris) empêchent le verrouillage');
  await page.evaluate(() => {
    localStorage.removeItem('appdashboard.verrou-auto-essai-ms');
    window.dispatchEvent(new StorageEvent('storage', { key: 'appdashboard.verrou-auto-essai-ms' }));
  });

  verifier(erreursPage.length === 0, `aucune erreur JavaScript dans la page (${erreursPage.length})`);
} finally {
  await navigateur.close();
  serveurSite.close();
  serveurRelais.close();
}
if (echecs > 0) {
  console.log(`E2E ECHEC (${echecs})`);
  process.exit(1);
}
console.log('E2E OK');
process.exit(0);
