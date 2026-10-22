/**
 * Test de bout en bout de l'Administration : invitation par e-mail et
 * nouveaux réglages (docs/hub/administration.md, docs/connexion-amis.md).
 *
 *  - PC du Fondateur : réglages des comptes (politique du mot de passe des
 *    amis : 14 caractères, force « Solide »), modèle du message ; création de
 *    Léa AVEC son adresse e-mail → le bouton « Envoyer l'invitation par
 *    e-mail » est un lien mailto: qui porte son adresse, l'objet et le lien
 *    d'invitation ; « Copier le message » ; historique (date, canal) ; aucune
 *    adresse en clair sur le relais ;
 *  - tableau de bord (invitations en attente, appareils), matrice comptes ×
 *    apps, action groupée (fermer une app, renvoyer l'invitation) ;
 *  - iPhone neuf de Léa : la politique s'applique dans le parcours d'invitation ;
 *  - un Gestionnaire ne voit ni les Réglages ni la sauvegarde ;
 *  - zone Danger : suppression d'un compte avec effacement de ses copies sur le relais ;
 *  - iPhone du Fondateur (même coffre, relié) : création avec e-mail, mailto et
 *    « Partager » (feuille de partage d'iOS, simulée).
 *
 * Faux relais local qui exécute relais/relais.mjs (version 6).
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-admin-invitations.mjs
 *
 * Variables : PLAYWRIGHT_PATH (dossier de node_modules contenant playwright),
 * CAPTURES (dossier des captures, défaut docs/captures-admin-invitations).
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
const { relais: coeurRelais } = await import(pathToFileURL(join(racine, 'relais/relais.mjs')).href);

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-admin-invitations');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-admin-invit-0123456789ab';
const PORT_RELAIS = 8815;
const PORT_SITE = 5225;
const RELAIS = `https://localhost:${PORT_RELAIS}`;
const SITE = `http://localhost:${PORT_SITE}/`;
const MDP_ADMIN = 'mot-de-passe-du-fondateur-e2e-43';
const EMAIL_LEA = 'lea.martin+amis@exemple.fr';
const EMAIL_NINA = 'nina@exemple.fr';

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
const dossier = mkdtempSync(join(tmpdir(), 'e2e-admin-invit-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dossier, 'k.pem'), '-out', join(dossier, 'c.pem'), '-subj', '/CN=localhost', '-days', '1'], { stdio: 'ignore' });
const serveurRelais = https.createServer({ key: readFileSync(join(dossier, 'k.pem')), cert: readFileSync(join(dossier, 'c.pem')) }, async (req, res) => {
  const morceaux = [];
  for await (const m of req) morceaux.push(m);
  const corps = Buffer.concat(morceaux);
  const requete = new Request(`${RELAIS}${req.url}`, { method: req.method, headers: { ...req.headers, 'x-adresse-client': '198.51.100.7' }, body: ['GET', 'HEAD'].includes(req.method) ? undefined : corps });
  const reponse = await coeurRelais.traiter(requete, env);
  res.writeHead(reponse.status, Object.fromEntries(reponse.headers));
  res.end(Buffer.from(await reponse.arrayBuffer()));
});
await new Promise(ok => serveurRelais.listen(PORT_RELAIS, ok));

// ------------------------------------------------------------- Site statique (et relais.json)
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
const local = lien => lien.replace(/^https?:\/\/[^/]+\//, SITE);
const texteDe = (page, id, delai = 30_000) => page.getByTestId(id).first().innerText({ timeout: delai }).catch(() => '');
/** Paramètre d'un lien mailto:, décodé. */
const parametre = (url, nom) => {
  const requete = url.split('?')[1] ?? '';
  const brut = requete.split('&').find(p => p.startsWith(`${nom}=`));
  return brut ? decodeURIComponent(brut.slice(nom.length + 1)) : undefined;
};

/** Les clics sur un lien mailto: sont notés (et la navigation empêchée) ; la feuille de partage d'iOS est simulée. */
const SCRIPT_TEST = `
  window.__mailtos = [];
  window.__partages = [];
  document.addEventListener('click', e => {
    const a = e.target && e.target.closest ? e.target.closest('a[href^="mailto:"]') : null;
    if (a) { window.__mailtos.push(a.getAttribute('href')); e.preventDefault(); }
  }, true);
  if (navigator.userAgent.includes('iPhone')) {
    Object.defineProperty(navigator, 'share', { configurable: true, value: async donnees => { window.__partages.push(donnees); } });
  }
`;
async function contexteTest(navigateur, options) {
  const contexte = await nouveauContexte(navigateur, options);
  await contexte.addInitScript(SCRIPT_TEST);
  return contexte;
}

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
async function confirmerIdentite(page, secret, motDePasse = MDP_ADMIN) {
  if (!(await page.getByTestId('admin-identite-mdp').waitFor({ timeout: 8_000 }).then(() => true, () => false))) return;
  for (const decalage of [0, 1, -1]) {
    await page.getByTestId('admin-identite-mdp').fill(motDePasse);
    await page.getByTestId('admin-identite-code').fill(totp(secret, decalage));
    await page.getByTestId('admin-identite-valider').click();
    if (await page.getByTestId('admin-identite').waitFor({ state: 'detached', timeout: 15_000 }).then(() => true, () => false)) return;
  }
  throw new Error('vérification d’identité impossible');
}
async function fermerPopups(page) {
  for (let i = 0; i < 3; i++) {
    const clique = await page.getByText(/^(Fermer|Terminé|Compris|Plus tard)$/).first().click({ timeout: 2500 }).then(() => true, () => false);
    if (!clique) break;
  }
  await page.keyboard.press('Escape').catch(() => undefined);
}
async function ouvrirAdministration(page) {
  await allerPageAdministration(page);
  await page.locator('[data-testid="cellule-administration"], [data-testid="tuile-administration"]').first().click();
  await page.getByTestId('app-administration').waitFor({ timeout: 20_000 });
}
/** Crée un compte ; rend son invitation (lien, mailto) et ses identifiants manuels. */
async function creerAmi(page, nom, email) {
  await page.getByTestId('admin-onglet-utilisateurs').click();
  await page.getByTestId('admin-nouveau').click();
  await page.getByTestId('admin-nom').fill(nom);
  if (email) await page.getByTestId('admin-nouveau-email').fill(email);
  await page.getByTestId('admin-nouveau-informe').click();
  await page.getByTestId('admin-creer').click();
  await page.getByTestId('admin-identifiants').waitFor({ timeout: 90_000 });
  await page.locator('[data-testid="admin-invitation"], [data-testid="admin-invitation-erreur"]').first().waitFor({ timeout: 90_000 });
  const lien = (await texteDe(page, 'admin-invitation-lien', 5_000)).trim();
  const mailto = (await page.getByTestId('admin-invitation-email').getAttribute('href').catch(() => '')) ?? '';
  const motDePasse = (await page.getByTestId('admin-mot-de-passe').innerText()).replace(/^\s*Mot de passe\s*/, '').trim();
  const secret = (await page.getByTestId('admin-secret-totp').innerText()).replace(/^\s*Clé TOTP\s*/, '').replace(/\s+/g, '');
  return { lien, mailto, motDePasse, secret };
}
async function terminer(page) {
  // Un envoi (e-mail, copie, partage) coche déjà « J'ai envoyé l'invitation ».
  if ((await page.getByTestId('admin-termine').getAttribute('aria-disabled')) === 'true') await page.getByTestId('admin-transmis').click();
  await page.getByTestId('admin-termine').click();
}
async function idDe(page, nom) {
  await page.getByTestId('admin-onglet-utilisateurs').click();
  const ligne = page.locator('[data-testid^="admin-ligne-"]').filter({ hasText: nom }).first();
  return ((await ligne.getAttribute('data-testid')) ?? '').replace('admin-ligne-', '');
}
async function ficheDe(page, nom) {
  await page.getByTestId('admin-onglet-utilisateurs').click();
  await page.getByTestId('admin-liste').getByText(nom, { exact: true }).first().click();
  await page.getByTestId('admin-detail').waitFor({ timeout: 20_000 });
}
async function connecter(page, prenom, motDePasse, secret) {
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
const avis = async page => {
  await page.getByTestId('admin-avis').waitFor({ timeout: 60_000 });
  return page.getByTestId('admin-avis').innerText();
};

const iphone = { ...devices['iPhone 13'], ignoreHTTPSErrors: true, permissions: [] };
delete iphone.defaultBrowserType;
const navigateur = await chromium.launch({ headless: true });
const optionsPc = { ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] };
try {
  // ================================================================ PC du Fondateur
  const pc = await (await contexteTest(navigateur, optionsPc)).newPage();
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
  await ouvrirAdministration(pc);

  // ---------------------------------------------------------------- Réglages des comptes et modèle
  log('PC : réglages des comptes (politique 14 caractères, « Solide ») et modèle du message');
  await pc.getByTestId('admin-onglet-reglages').click();
  await pc.getByTestId('admin-rc-mdpLongueurMin').fill('14');
  await pc.getByTestId('admin-rc-force-3').click();
  await pc.getByTestId('admin-rc-enregistrer').click();
  verifier(/enregistrés/.test(await texteDe(pc, 'admin-rc-message')), 'réglages des comptes enregistrés (Fondateur)');
  await pc.getByTestId('admin-modele-objet').fill('Invitation AppDashboard pour {prenom}');
  await pc.getByTestId('admin-modele-corps').fill('Bonjour {prenom}');
  verifier(/\{lien\}/.test(await texteDe(pc, 'admin-modele-erreur', 5_000)), 'un modèle sans {lien} est refusé (message clair)');
  await pc.getByTestId('admin-modele-defaut').click();
  await pc.getByTestId('admin-modele-objet').fill('Invitation AppDashboard pour {prenom}');
  await pc.getByTestId('admin-modele-enregistrer').click();
  verifier(/Invitation AppDashboard pour Léa/.test(await texteDe(pc, 'admin-modele-apercu')), 'aperçu du modèle avec les variables remplacées');
  await capture(pc, '01-pc-reglages-comptes-modele');

  // ---------------------------------------------------------------- Création de Léa avec son adresse
  log('PC : création de Léa avec son adresse e-mail');
  await pc.getByTestId('admin-onglet-utilisateurs').click();
  await pc.getByTestId('admin-nouveau').click();
  await pc.getByTestId('admin-nom').fill('Léa');
  await pc.getByTestId('admin-nouveau-email').fill('lea@exemple');
  verifier(/invalide/.test(await texteDe(pc, 'admin-nouveau-email-erreur', 5_000)), 'adresse invalide signalée');
  verifier((await pc.getByTestId('admin-creer').getAttribute('aria-disabled')) === 'true', 'création bloquée tant que l’adresse est invalide');
  await pc.getByTestId('admin-creation-annuler').click();
  const lea = await creerAmi(pc, 'Léa', EMAIL_LEA);
  verifier(/#invitation=AI1\./.test(lea.lien), `lien d’invitation : ${lea.lien.slice(0, 50)}…`);
  verifier(lea.mailto.startsWith('mailto:lea.martin%2Bamis@exemple.fr?subject='), `bouton e-mail = lien mailto: à l’adresse de Léa (${lea.mailto.slice(0, 48)}…)`);
  verifier(parametre(lea.mailto, 'subject') === 'Invitation AppDashboard pour Léa', `objet encodé : « ${parametre(lea.mailto, 'subject')} »`);
  const corps = parametre(lea.mailto, 'body') ?? '';
  verifier(corps.includes(lea.lien) && corps.includes('\r\n') && /14 caractères au moins/.test(corps) && /Ton identifiant : Léa/.test(corps), 'corps : lien, retours à la ligne CRLF, politique (14 caractères), identifiant');
  verifier(!corps.includes(lea.motDePasse) && lea.mailto.length <= 2000 && !/\s/.test(lea.mailto), `ni mot de passe, ni espace brut ; ${lea.mailto.length} caractères (≤ 2 000)`);
  await pc.getByTestId('admin-invitation-email').click();
  const mailtos = await pc.evaluate(() => window.__mailtos);
  verifier(mailtos.length === 1 && mailtos[0] === lea.mailto, 'clic sur « Envoyer l’invitation par e-mail » : la messagerie reçoit ce lien (navigation simulée)');
  await pc.getByTestId('admin-invitation-copier').click();
  const message = await pc.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  verifier(message.includes(lea.lien) && /Ton identifiant : Léa/.test(message), '« Copier le message » : lien + instructions');
  verifier((await pc.getByTestId('admin-invitation-partager').count()) === 0, 'PC sans feuille de partage : pas de bouton « Partager »');
  await pc.getByTestId('admin-invitation').evaluate(e => e.scrollIntoView({ block: 'start' }));
  await capture(pc, '02-pc-invitation-lea-email');
  await terminer(pc);
  const idLea = await idDe(pc, 'Léa');
  await ficheDe(pc, 'Léa');
  const historique = await texteDe(pc, 'admin-historique-invitations');
  verifier(/E-mail/.test(historique) && /Message copié \(relance\)/.test(historique), `historique des invitations : ${historique.replace(/\n/g, ' | ')}`);
  verifier((await pc.getByTestId('admin-fiche-email').inputValue()) === EMAIL_LEA, 'fiche : adresse e-mail enregistrée');
  await capture(pc, '03-pc-fiche-lea-contact');

  log('PC : Hugo et Max (sans adresse)');
  const hugo = await creerAmi(pc, 'Hugo');
  verifier(lea.mailto && hugo.mailto.startsWith('mailto:?subject='), 'sans adresse : la messagerie s’ouvre sans destinataire');
  await terminer(pc);
  const max = await creerAmi(pc, 'Max');
  await terminer(pc);
  const idHugo = await idDe(pc, 'Hugo');

  // Le relais ne connaît pas l'adresse (données de l'Administration scellées par la clé du Fondateur).
  await attendre(async () => [...kv.keys()].some(c => c.startsWith('p:principal:')), 90_000);
  verifier(![...kv.values()].join('\n').includes('lea.martin'), 'aucune adresse e-mail en clair sur le relais');

  // ---------------------------------------------------------------- Tableau de bord
  log('PC : tableau de bord');
  await pc.getByTestId('admin-onglet-tableau').click();
  const invites = (await texteDe(pc, 'admin-stat-invites')).replace(/\D+/g, ' ').trim();
  verifier(/3$/.test(invites), `tableau de bord : 3 invités en attente (${invites})`);
  verifier((await pc.getByTestId('admin-stat-expirees').count()) === 1 && (await pc.getByTestId('admin-stat-appareils').count()) === 1, 'chiffres « Invitations expirées » et « Appareils »');
  const attente = await texteDe(pc, `admin-attente-${idLea}`);
  verifier(/envoyée/.test(attente), `invitations en attente : Léa « ${attente.replace(/\n/g, ' ')} »`);
  verifier((await pc.getByTestId('admin-dernieres-connexions').count()) === 1, 'panneau « Dernières connexions »');
  await capture(pc, '04-pc-tableau-de-bord');
  await pc.getByTestId('admin-invitations-attente').evaluate(e => e.scrollIntoView({ block: 'center' }));
  await capture(pc, '04b-pc-tableau-invitations-attente');

  // ---------------------------------------------------------------- Matrice comptes × apps
  log('PC : matrice comptes × apps');
  await pc.getByTestId('admin-onglet-acces').click();
  const caseHugo = pc.getByTestId(`admin-matrice-${idHugo}-tsuzuku`);
  const avant = await caseHugo.getAttribute('aria-label');
  await caseHugo.click();
  await avis(pc);
  const apres = await attendre(async () => (await caseHugo.getAttribute('aria-label')) !== avant, 20_000, 300);
  verifier(apres, `matrice : la case Hugo × Tsuzuku change (${avant} → ${await caseHugo.getAttribute('aria-label')})`);
  await capture(pc, '05-pc-matrice');

  // ---------------------------------------------------------------- Actions groupées
  log('PC : actions groupées (fermer une app, renvoyer l’invitation)');
  await pc.getByTestId('admin-onglet-utilisateurs').click();
  await pc.getByTestId(`admin-case-${idLea}`).click();
  await pc.getByTestId(`admin-case-${idHugo}`).click();
  await pc.getByTestId('admin-groupe-app-tsuzuku').click();
  await pc.getByTestId('admin-groupe-app-fermer').click();
  verifier(/Tsuzuku fermée/.test(await avis(pc)), 'action groupée : Tsuzuku fermée pour Léa et Hugo');
  await pc.getByTestId('admin-onglet-acces').click();
  const fermees = await attendre(async () => /Aucun/.test((await pc.getByTestId(`admin-matrice-${idHugo}-tsuzuku`).getAttribute('aria-label')) ?? '') && /Aucun/.test((await pc.getByTestId(`admin-matrice-${idLea}-tsuzuku`).getAttribute('aria-label')) ?? ''), 20_000, 300);
  verifier(fermees, 'la matrice montre l’accès fermé pour les deux');
  await pc.getByTestId('admin-onglet-utilisateurs').click();
  await pc.getByTestId(`admin-case-${idHugo}`).click();
  await pc.getByTestId('admin-groupe-renvoyer').click();
  await confirmerIdentite(pc, secretAdmin);
  await pc.getByTestId('admin-groupe-invitations').waitFor({ timeout: 90_000 });
  const lienGroupe = await pc.getByTestId(`admin-groupe-invitation-${idHugo}`).getByTestId('admin-invitation-email').getAttribute('href');
  verifier(/^mailto:\?subject=/.test(lienGroupe ?? '') && decodeURIComponent(lienGroupe ?? '').includes('#invitation=AI1.'), 'renvoi groupé : nouvelle invitation de Hugo, prête à envoyer (mailto)');
  await capture(pc, '06-pc-action-groupee-renvoi');
  await pc.getByTestId('admin-groupe-invitations-fermer').click();

  log('PC : Max devient Gestionnaire');
  await ficheDe(pc, 'Max');
  await pc.getByTestId('admin-rang-changer').click();
  await pc.getByTestId('admin-rang-choix-gestionnaire').click();
  await pc.getByTestId('admin-rang-confirmer').click();
  await confirmerIdentite(pc, secretAdmin);
  verifier(/Gestionnaire/.test(await avis(pc)), 'Max est Gestionnaire');

  // ================================================================ iPhone neuf de Léa : la politique s'applique
  log('iPhone neuf : Léa ouvre son lien (politique 14 caractères, « Solide »)');
  const tel = await (await contexteTest(navigateur, iphone)).newPage();
  tel.on('pageerror', e => log('erreur page iPhone :', e.message));
  await tel.goto(local(lea.lien));
  await tel.getByTestId('invitation-mdp').waitFor({ timeout: 60_000 });
  const consigne = await texteDe(tel, 'invitation-force-libelle');
  verifier(/14 caractères/.test(consigne) && /Solide/.test(consigne), `consigne de l’écran : « ${consigne} »`);
  await tel.getByTestId('invitation-mdp').fill('Biarritz 2026');
  await tel.getByTestId('invitation-mdp-confirmation').fill('Biarritz 2026');
  verifier(/14 caractères/.test(await texteDe(tel, 'invitation-regles', 5_000)) && (await tel.getByTestId('invitation-valider').getAttribute('aria-disabled')) === 'true', 'trop court pour la politique : refusé');
  await tel.getByTestId('invitation-mdp').fill('abcdefghijklmnop');
  await tel.getByTestId('invitation-mdp-confirmation').fill('abcdefghijklmnop');
  verifier(/Solide/.test(await texteDe(tel, 'invitation-regles', 5_000)) && (await tel.getByTestId('invitation-valider').getAttribute('aria-disabled')) === 'true', 'assez long mais pas assez solide : refusé');
  await capture(tel, '07-iphone-politique-refus');
  await tel.getByTestId('invitation-mdp').fill('Été à Biarritz 2026');
  await tel.getByTestId('invitation-mdp-confirmation').fill('Été à Biarritz 2026');
  await tel.getByTestId('invitation-valider').click();
  await tel.getByTestId('hub').waitFor({ timeout: 90_000 });
  verifier(true, 'mot de passe conforme : Léa est connectée');
  await fermerPopups(tel);
  await capture(tel, '08-iphone-lea-connectee');

  // ================================================================ Gestionnaire : pas de réglages réservés
  log('PC : connexion en Max (Gestionnaire)');
  await connecter(pc, 'Max', max.motDePasse, max.secret);
  await ouvrirAdministration(pc);
  verifier((await pc.getByTestId('admin-mon-rang').innerText()).includes('Gestionnaire'), 'Max se voit Gestionnaire');
  verifier((await pc.getByTestId('admin-onglet-reglages').count()) === 0 && (await pc.getByTestId('admin-onglet-securite').count()) === 0, 'un Gestionnaire ne voit ni Réglages (modèle, politique, sauvegarde) ni Sécurité');
  verifier((await pc.getByTestId('admin-onglet-acces').count()) === 1, 'il a la matrice des accès (ses amis seulement)');
  await pc.getByTestId('admin-onglet-acces').click();
  verifier((await pc.locator('[data-testid^="admin-matrice-ligne-"]').count()) === 0, 'matrice du Gestionnaire : aucun compte d’autrui');
  await capture(pc, '09-pc-gestionnaire-sans-reglages');

  // ================================================================ Zone Danger : suppression + relais
  log('PC : retour du Fondateur, suppression de Hugo avec nettoyage du relais');
  await connecter(pc, 'admin', MDP_ADMIN, secretAdmin);
  await ouvrirAdministration(pc);
  const publieHugo = await attendre(async () => [...kv.keys()].some(c => c.startsWith(`p:${idHugo}:`)), 60_000);
  verifier(publieHugo, 'Hugo a des copies sur le relais avant la suppression');
  await ficheDe(pc, 'Hugo');
  await pc.getByTestId('admin-supprimer').click();
  verifier((await pc.getByTestId('admin-supprimer-relais').innerText()).includes('✓'), 'zone Danger : « Effacer aussi ses copies sur le relais » coché par défaut');
  await capture(pc, '10-pc-zone-danger');
  await pc.getByTestId('admin-confirmation-nom').fill('Hugo');
  await pc.getByTestId('admin-confirmer').click();
  await confirmerIdentite(pc, secretAdmin);
  const avisSuppression = await avis(pc);
  verifier(/copie\(s\) effacée\(s\) du relais/.test(avisSuppression), `suppression : « ${avisSuppression} »`);
  // Reste au plus l'index de son espace, vide (le relais le tient à jour ; il ne contient aucune donnée).
  const restes = () => [...kv.keys()].filter(c => c.startsWith(`p:${idHugo}:`) && !(c.endsWith('~index') && Object.keys(JSON.parse(kv.get(c) ?? '{}')).every(n => n.startsWith('~'))));
  const nettoye = await attendre(async () => restes().length === 0, 30_000, 500);
  verifier(nettoye, `plus aucune copie de Hugo sur le relais${nettoye ? '' : ` (restes : ${restes().join(', ')})`}`);
  const revoque = await coeurRelais.traiter(new Request(`https://relais/revocations/${idHugo}`, { headers: { Authorization: `Bearer ${JETON}` } }), env);
  verifier(revoque.ok && (await revoque.json()).revoque === true, 'jeton de Hugo révoqué sur le relais');
  await pc.getByTestId('admin-onglet-journal').click();
  verifier((await pc.getByText(/Copies de Hugo effacées du relais/).count()) > 0, 'journal : nettoyage du relais inscrit');

  // ================================================================ iPhone du Fondateur
  log('iPhone du Fondateur (même coffre) : création de Nina avec e-mail, mailto et Partager');
  const telF = await (await contexteTest(navigateur, iphone)).newPage();
  telF.on('pageerror', e => log('erreur page iPhone Fondateur :', e.message));
  // iPhone déjà relié au compte du Fondateur (relais version 9 : plus de carte « code de liaison » à l'accueil).
  await telF.goto(`${SITE}#liaison=${CODE_PC}`);
  await telF.locator('[data-testid="bouton-deverrouiller"], [data-testid="connexion-prenom"]').first().waitFor({ timeout: 90_000 });
  if (await telF.getByTestId('connexion-prenom').count()) {
    await telF.getByTestId('connexion-prenom').fill('admin');
    await telF.getByTestId('connexion-continuer').click();
    await telF.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 });
  }
  await deverrouiller(telF, MDP_ADMIN, secretAdmin);
  await fermerPopups(telF);
  await ouvrirAdministration(telF);
  const nina = await creerAmi(telF, 'Nina', EMAIL_NINA);
  verifier(nina.mailto.startsWith('mailto:nina@exemple.fr?subject=') && (parametre(nina.mailto, 'body') ?? '').includes(nina.lien), 'iPhone : bouton e-mail = mailto à Nina, avec son lien');
  verifier((await telF.getByTestId('admin-invitation-partager').count()) === 1, 'iPhone : bouton « Partager… » (feuille de partage)');
  await telF.getByTestId('admin-invitation-partager').click();
  const partages = await telF.evaluate(() => window.__partages);
  verifier(partages.length === 1 && partages[0].text.includes(nina.lien) && /Nina/.test(partages[0].title ?? ''), 'iPhone : « Partager » transmet le message (lien compris) à la feuille de partage');
  await telF.getByTestId('admin-invitation-email').scrollIntoViewIfNeeded();
  await capture(telF, '11-iphone-fondateur-invitation');
  await terminer(telF);
  await telF.getByTestId('admin-onglet-acces').click();
  await telF.getByTestId('admin-matrice').waitFor({ timeout: 20_000 });
  await capture(telF, '12-iphone-fondateur-matrice');
  const largeur = await telF.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  verifier(largeur, 'iPhone : pas de défilement horizontal de la page (la matrice défile dans son cadre)');
} catch (erreur) {
  console.error('[e2e] arrêt :', erreur);
  echecs++;
} finally {
  await navigateur.close();
  serveurRelais.close();
  serveurSite.close();
}
console.log(echecs === 0 ? '[e2e] TOUT EST VERT' : `[e2e] ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
