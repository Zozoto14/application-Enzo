/**
 * Bout en bout de la synchro quasi immédiate (relais version 10) et de la validation en deux étapes :
 *
 *  1. le PC du Fondateur (jeton maître) crée son coffre AVEC son code à six chiffres et parle à l'ANCIEN
 *     relais (Worker Cloudflare en mode transmission : `proxifier`) ; en route, un intermédiaire PERD le
 *     corps des PUT (comme certains frontaux mutualisés) — la cause probable du « 400 » de la
 *     migration. Il migre en gardant son mot de passe actuel : identifiant « admin », mot de passe
 *     actuel, code à six chiffres ; son secret TOTP est confié au serveur (même application) ;
 *  2. navigateur neuf : aide « Administrateur : première connexion ? » ; identifiant + mot de passe →
 *     le serveur demande le code ; code faux refusé ; bon code → connecté ; ce code rejoué sur un
 *     troisième navigateur → refusé ;
 *  3. délai A ↔ B mesuré (modification sur l'un, visible sur l'autre, SANS aucun événement de focus) :
 *     avec les avis par flux SSE, puis SANS SSE (un mandataire retient le flux, comme un tampon
 *     LiteSpeed/Apache : repli seul sur l'attente longue) ;
 *  4. hors ligne puis retour du réseau ; onglet fermé juste après une modification (keepalive).
 *
 * Avec DIST=<dossier d'un ancien build> (relais toujours en version 10), seules les mesures de délai
 * sont faites : c'est le « avant » du rapport.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-synchro-rapide.mjs
 *
 * Variables : PLAYWRIGHT_PATH, CAPTURES (défaut docs/captures-synchro-rapide), DIST, MESURES (nombre de mesures, 5),
 * PC_DIRECT=1 (le PC parle directement au nouveau relais), PUT_INTACT=1 (aucun corps de PUT perdu).
 */

// L'ancien relais (même processus) transmet par `fetch` au nouveau, dont le certificat est auto-signé.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

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
const { chromium } = requireGlobal('playwright');
const { traiterRequete, proxifier } = await import(pathToFileURL(join(racine, 'relais/worker.mjs')).href);
const { coffresMemoire } = await import(pathToFileURL(join(racine, 'relais/coffres.mjs')).href);
const { envoyerFlux } = await import(pathToFileURL(join(racine, 'esport/serveur/commun.mjs')).href);

const AVANT = Boolean(process.env.DIST);
const CAPTURES = process.env.CAPTURES ?? join(racine, AVANT ? 'docs/captures-synchro-rapide/avant' : 'docs/captures-synchro-rapide');
mkdirSync(CAPTURES, { recursive: true });
const NB_MESURES = Number(process.env.MESURES) || 5;
const JETON = 'jeton-e2e-rapide-0123456789abcdef';
const PORT_RELAIS = 8871;
const PORT_SITE = 5271;
const RELAIS = `https://localhost:${PORT_RELAIS}`;
const PORT_ANCIEN = 8872;
const RELAIS_ANCIEN = `https://localhost:${PORT_ANCIEN}`;
const PC_DIRECT = Boolean(process.env.PC_DIRECT);
const PUT_INTACT = Boolean(process.env.PUT_INTACT);
const SITE = `http://localhost:${PORT_SITE}/`;
const MDP_PC = 'ancien-mot-de-passe-du-pc-e2e-42';
// Le Fondateur GARDE son mot de passe actuel à la migration (le changer est facultatif).
const MDP = MDP_PC;
const FONDS = { sauge: 'rgb(238, 242, 236)', terminal: 'rgb(10, 10, 10)', nuit: 'rgb(11, 15, 23)' };

// ------------------------------------------------------------- Relais (vrai worker, réponses en flux)
const kv = new Map();
const env = {
  JETON,
  COFFRES: coffresMemoire(),
  BOITE: {
    get: async cle => (kv.has(cle) ? kv.get(cle) : null),
    put: async (cle, valeur) => void kv.set(cle, valeur),
    delete: async cle => void kv.delete(cle),
    list: async ({ prefix = '' } = {}) => ({ keys: [...kv.keys()].filter(c => c.startsWith(prefix)).sort().map(name => ({ name })), list_complete: true }),
  },
};
const journal = [];
/** Simule un mandataire qui RETIENT les flux (tampon) : rien ne part avant la fin de la réponse. */
let tamponSse = false;
const fluxOuverts = new Set();
const dossier = mkdtempSync(join(tmpdir(), 'e2e-rapide-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dossier, 'k.pem'), '-out', join(dossier, 'c.pem'), '-subj', '/CN=localhost', '-days', '1'], { stdio: 'ignore' });
const serveurRelais = https.createServer({ key: readFileSync(join(dossier, 'k.pem')), cert: readFileSync(join(dossier, 'c.pem')) }, async (req, res) => {
  const morceaux = [];
  for await (const m of req) morceaux.push(m);
  // Intermédiaire mutualisé (simulé) : le corps d'un PUT n'arrive jamais au relais.
  const perdu = req.method === 'PUT' && !PUT_INTACT;
  if (perdu) journal.push({ methode: 'PUT', chemin: req.url.split('?')[0], statut: 'corps perdu', le: Date.now() });
  const requete = new Request(`${RELAIS}${req.url}`, { method: req.method, headers: { ...req.headers, 'cf-connecting-ip': '198.51.100.9' }, body: ['GET', 'HEAD'].includes(req.method) || perdu ? undefined : Buffer.concat(morceaux) });
  const reponse = await traiterRequete(requete, env, {});
  const chemin = req.url.split('?')[0];
  journal.push({ methode: req.method, chemin, statut: reponse.status, le: Date.now() });
  res.writeHead(reponse.status, Object.fromEntries(reponse.headers));
  if (!reponse.body) return res.end();
  if (/event-stream/.test(reponse.headers.get('content-type') ?? '')) {
    fluxOuverts.add(res);
    res.on('close', () => fluxOuverts.delete(res));
    if (tamponSse) {
      // Mandataire qui garde tout en tampon : le client ne voit rien tant que le flux n'est pas fini.
      const lu = [];
      const lecteur = reponse.body.getReader();
      res.on('close', () => lecteur.cancel().catch(() => undefined));
      for (;;) {
        const { done, value } = await lecteur.read().catch(() => ({ done: true }));
        if (done) break;
        lu.push(value);
      }
      if (!res.writableEnded) res.end(Buffer.concat(lu.map(v => Buffer.from(v))));
      return;
    }
    return envoyerFlux(reponse.body, res);
  }
  res.end(Buffer.from(await reponse.arrayBuffer()));
});
await new Promise(ok => serveurRelais.listen(PORT_RELAIS, ok));
// Ancien relais (Worker Cloudflare en mode RELAIS_CIBLE) : transmet tout au nouveau, tel quel.
const serveurAncien = https.createServer({ key: readFileSync(join(dossier, 'k.pem')), cert: readFileSync(join(dossier, 'c.pem')) }, async (req, res) => {
  const morceaux = [];
  for await (const m of req) morceaux.push(m);
  const requete = new Request(`${RELAIS_ANCIEN}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(morceaux) });
  const reponse = await proxifier(requete, RELAIS).catch(e => new Response(JSON.stringify({ erreur: String(e) }), { status: 502 }));
  journal.push({ methode: req.method, chemin: `ancien:${req.url.split('?')[0]}`, statut: reponse.status, le: Date.now() });
  const entetes = Object.fromEntries(reponse.headers);
  delete entetes['content-encoding'];
  delete entetes['content-length'];
  res.writeHead(reponse.status, entetes);
  if (!reponse.body) return res.end();
  return envoyerFlux(reponse.body, res);
});
await new Promise(ok => serveurAncien.listen(PORT_ANCIEN, ok));

// ------------------------------------------------------------- Site statique
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const dist = process.env.DIST ?? join(racine, 'bureau/dist');
const serveurSite = http.createServer((req, res) => {
  const chemin = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  if (chemin === '/relais.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ relais: RELAIS }));
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
/** Attend un pas TOTP qui ne basculera pas dans les prochaines secondes. */
async function pasStable(marge = 8_000) {
  const reste = 30_000 - (Date.now() % 30_000);
  if (reste < marge) await pause(reste + 100);
}
const base64url = t => Buffer.from(t).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const CODE_PC = 'AB1.' + base64url(JSON.stringify({ r: PC_DIRECT ? RELAIS : RELAIS_ANCIEN, j: JETON }));
const pause = ms => new Promise(ok => setTimeout(ok, ms));
const log = (...a) => console.log('[e2e]', ...a);
let echecs = 0;
const verifier = (ok, message) => {
  console.log(ok ? '  OK   ' : '  ECHEC', message);
  if (!ok) echecs++;
};
const capture = (page, nom) => page.screenshot({ path: join(CAPTURES, `${nom}.png`) }).catch(() => undefined);
const texteDe = (page, id, delai = 30_000) => page.getByTestId(id).first().innerText({ timeout: delai }).catch(() => '');
const fermerBulles = page => page.getByText(/^(Fermer|Terminé|Compris|Plus tard)$/).first().click({ timeout: 2500 }).catch(() => undefined);
async function parametres(page, section) {
  await page.getByTestId('hub-parametres-ouvrir').click();
  if (section) await page.getByTestId(`parametres-section-${section}`).click();
}
const fermerParametres = page => page.getByTestId('hub-parametres-fermer').click().catch(() => undefined);
const fond = page => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const mediane = l => [...l].sort((a, b) => a - b)[Math.floor(l.length / 2)];

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

/**
 * Délai entre le clic sur un thème dans `source` et le changement de fond de `cible`, sans aucun
 * événement de focus ou de visibilité (seuls les avis du serveur, ou le tour périodique, l'apportent).
 */
async function mesurerDelais(source, cible, nom, nombre = NB_MESURES, plafond = 60_000) {
  const delais = [];
  await parametres(source, 'general');
  for (let i = 0; i < nombre; i++) {
    const courants = [await themeCourant(cible), await themeCourant(source)];
    const theme = ['terminal', 'sauge', 'nuit'].find(t => !courants.includes(t));
    const attendu = FONDS[theme];
    const debut = Date.now();
    await source.getByTestId(`parametres-theme-${theme}`).click();
    const vu = await cible
      .waitForFunction(f => getComputedStyle(document.body).backgroundColor === f, attendu, { polling: 25, timeout: plafond })
      .then(() => true, () => false);
    const d = Date.now() - debut;
    delais.push(vu ? d : plafond);
    await pause(400);
  }
  await fermerParametres(source);
  log(`${nom} : ${delais.join(', ')} ms (médiane ${mediane(delais)} ms)`);
  return delais;
}
async function themeCourant(page) {
  const f = await fond(page);
  return Object.entries(FONDS).find(([, v]) => v === f)?.[0];
}

const navigateur = await chromium.launch({ headless: true });
const options = { ignoreHTTPSErrors: true, viewport: { width: 1200, height: 860 } };
const mesures = {};
try {
  // ================================================================ 1. PC du Fondateur : migration avec A2F
  log(`PC du Fondateur : coffre avec code à six chiffres${AVANT ? ' (ANCIEN build)' : ''}`);
  const contexteA = await nouveauContexte(navigateur, options);
  await contexteA.addInitScript(() => localStorage.setItem('e2e.migration', 'garder'));
  const A = await contexteA.newPage();
  A.on('pageerror', e => log('erreur page A :', e.message));
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
  await relierCommePc(A, CODE_PC);
  await deverrouiller(A, MDP_PC, secret);
  await fermerBulles(A);
  await A.keyboard.press('Escape').catch(() => undefined);
  await A.getByTestId('fondateur-connexion').waitFor({ timeout: 60_000 });
  await pasStable();
  await A.getByTestId('fondateur-identifiant').fill('admin');
  await A.getByTestId('fondateur-mdp-actuel').fill(MDP_PC);
  await A.getByTestId('fondateur-totp').fill(totp(secret));
  const pasMigration = Math.floor(Date.now() / 30_000);
  if (AVANT) {
    // Ancien écran : nouveau mot de passe obligatoire (on remet le même).
    await A.getByTestId('fondateur-mdp').fill(MDP);
    await A.getByTestId('fondateur-mdp-confirmation').fill(MDP);
  } else {
    verifier((await A.getByTestId('fondateur-mdp').count()) === 0, 'migration : nouveau mot de passe FACULTATIF (case « Changer de mot de passe » décochée)');
  }
  await capture(A, '00-pc-migration-formulaire');
  await A.getByTestId('fondateur-valider').click();
  const issue = await A.locator('[data-testid="fondateur-connexion-faite"], [data-testid="fondateur-erreur"]').first().waitFor({ timeout: 90_000 }).then(() => true, () => false);
  if (issue && (await A.getByTestId('fondateur-erreur').count()) > 0) {
    const message = await texteDe(A, 'fondateur-erreur', 2000);
    await capture(A, '00-pc-migration-erreur');
    throw new Error(`migration refusée : ${message}`);
  }
  await A.getByTestId('fondateur-connexion-faite').waitFor({ timeout: 60_000 });
  if (!AVANT) {
    const perdus = journal.filter(j => j.statut === 'corps perdu').length;
    verifier(PUT_INTACT || perdus > 0, `migration réussie malgré ${perdus} PUT dont le corps a été perdu en route (repli POST + X-Methode)`);
    verifier(PC_DIRECT || journal.some(j => j.chemin.startsWith('ancien:/acces/')), `le PC passe par ${PC_DIRECT ? 'le nouveau relais' : 'l’ancien relais qui transmet'}`);
  }
  const fait = await A.getByTestId('fondateur-connexion-faite').innerText();
  if (!AVANT) {
    verifier(/code à six chiffres de ton application/.test(fait), 'migration : l’écran final dit que le code à six chiffres reste demandé');
    verifier(kv.has('a2f:principal') && !kv.get('a2f:principal').includes(secret), 'secret TOTP confié au serveur, rangé chiffré (jamais en clair)');
  }
  await capture(A, '01-pc-migration-avec-a2f');
  await A.getByTestId('fondateur-codes-notes').click();

  // ================================================================ 2. Navigateur neuf : mot de passe + code
  log('Navigateur neuf : identifiant + mot de passe, puis le code demandé par le serveur');
  const B = await (await nouveauContexte(navigateur, options)).newPage();
  B.on('pageerror', e => log('erreur page B :', e.message));
  await B.goto(SITE);
  await B.getByTestId('connexion-id-identifiant').waitFor({ timeout: 60_000 });
  if (!AVANT) {
    await B.getByTestId('connexion-aide-admin').click();
    const aide = await texteDe(B, 'connexion-aide-admin-texte', 5_000);
    verifier(/sur ton PC/.test(aide) && /code à six chiffres/.test(aide), 'aide « Administrateur : première connexion ? » : la démarche, sans rien dire d’un compte');
    await capture(B, '02-aide-premiere-connexion');
  }
  await B.getByTestId('connexion-id-identifiant').fill(' ADMIN ');
  await B.getByTestId('connexion-id-mdp').fill(MDP);
  await B.getByTestId('connexion-id-valider').click();
  const demande = await B.getByTestId('connexion-id-code').waitFor({ timeout: 60_000 }).then(() => true, () => false);
  if (!AVANT) {
    verifier(demande, 'mot de passe juste : le serveur demande le code à six chiffres (rien n’est encore ouvert)');
    verifier((await B.getByTestId('hub').count()) === 0, 'pas de hub avant le code');
    await capture(B, '03-code-demande');
    // Le code de la migration est consommé (anti-rejeu) : on attend le pas suivant, comme le ferait l'application.
    while (Math.floor(Date.now() / 30_000) <= pasMigration) await pause(500);
    await pasStable(15_000);
    const juste = totp(secret);
    const faux = ['000000', '111111'].find(c => c !== juste && c !== totp(secret, -1) && c !== totp(secret, 1));
    await B.getByTestId('connexion-id-code').fill(faux);
    await B.getByTestId('connexion-id-valider').click();
    const refus = await texteDe(B, 'connexion-id-erreur', 60_000);
    verifier(/incorrect ou déjà utilisé/.test(refus), `code faux refusé : « ${refus.slice(0, 50)}… »`);
    await capture(B, '04-code-faux');
    await B.getByTestId('connexion-id-code').fill(juste);
    await B.getByTestId('connexion-id-valider').click();
    if (!(await B.getByTestId('hub').waitFor({ timeout: 90_000 }).then(() => true, () => false))) {
      await capture(B, '99-echec-connexion');
      throw new Error(`pas de hub après le bon code : ${(await B.locator('body').innerText()).slice(0, 400)}`);
    }
    verifier(true, 'bon code : connecté sur le navigateur neuf (même application d’authentification qu’avant)');
    // Le même code, rejoué ailleurs : refusé.
    const C = await (await nouveauContexte(navigateur, options)).newPage();
    await C.goto(SITE);
    await C.getByTestId('connexion-id-identifiant').fill('admin');
    await C.getByTestId('connexion-id-mdp').fill(MDP);
    await C.getByTestId('connexion-id-valider').click();
    await C.getByTestId('connexion-id-code').waitFor({ timeout: 60_000 });
    await C.getByTestId('connexion-id-code').fill(juste);
    await C.getByTestId('connexion-id-valider').click();
    const rejoue = await texteDe(C, 'connexion-id-erreur', 60_000);
    verifier(/incorrect ou déjà utilisé/.test(rejoue) && (await C.getByTestId('hub').count()) === 0, 'code rejoué sur un troisième navigateur : refusé');
    await capture(C, '05-code-rejoue');
    await C.context().close();
  } else {
    await B.getByTestId('hub').waitFor({ timeout: 120_000 });
  }
  await fermerBulles(B);
  await A.keyboard.press('Escape').catch(() => undefined);
  await fermerBulles(A);
  // Les deux appareils ont fait leur premier tour.
  await pause(3000);

  // ================================================================ 3. Délais A ↔ B
  log('Délai B → A et A → B (aucun événement de focus : seuls les avis du serveur ou le tour périodique)');
  journal.length = 0;
  mesures.sse = [...(await mesurerDelais(B, A, `B → A${AVANT ? ' (avant)' : ' (flux SSE)'}`)), ...(await mesurerDelais(A, B, `A → B${AVANT ? ' (avant)' : ' (flux SSE)'}`))];
  const flux = fluxOuverts.size;
  if (!AVANT) {
    verifier(flux >= 2, `avis par flux SSE (${flux} flux ouverts en ce moment, un par appareil)`);
    verifier(Math.max(...mesures.sse) < 1000, `délai < 1 s avec SSE (médiane ${mediane(mesures.sse)} ms, max ${Math.max(...mesures.sse)} ms)`);
    const posts = journal.filter(j => j.methode === 'POST' && /\/v10\/coffre\/principal$/.test(j.chemin)).length;
    verifier(posts >= mesures.sse.length, `chaque modification part par /v10 (${posts} envois)`);
    await capture(A, '06-mesure-sse');

    log('Sans SSE : un mandataire retient le flux (tampon) → repli sur l’attente longue');
    tamponSse = true;
    for (const r of fluxOuverts) r.destroy();
    await pause(6_000);
    journal.length = 0;
    mesures.attente = [...(await mesurerDelais(B, A, 'B → A (sans SSE)')), ...(await mesurerDelais(A, B, 'A → B (sans SSE)'))];
    const attentes = journal.filter(j => j.chemin.endsWith('/attendre')).length;
    verifier(attentes > 0, `repli sur l’attente longue (${attentes} attentes)`);
    verifier(Math.max(...mesures.attente) < 1000, `délai < 1 s sans SSE (médiane ${mediane(mesures.attente)} ms, max ${Math.max(...mesures.attente)} ms)`);
    tamponSse = false;

    // ================================================================ 4. Hors ligne, puis retour du réseau
    log('B hors ligne : modification gardée, partie au retour du réseau');
    await B.context().setOffline(true);
    await B.evaluate(() => window.dispatchEvent(new Event('offline')));
    await parametres(B, 'general');
    const cibleHL = (await themeCourant(A)) === 'terminal' ? 'sauge' : 'terminal';
    await B.getByTestId(`parametres-theme-${cibleHL}`).click();
    await fermerParametres(B);
    await pause(3000);
    verifier((await fond(A)) !== FONDS[cibleHL], 'hors ligne : rien n’est parti');
    const libelle = await texteDe(B, 'synchro-libelle', 5000);
    verifier(/Hors ligne|attente|injoignable/i.test(libelle), `indicateur hors ligne : « ${libelle} »`);
    await capture(B, '07-hors-ligne');
    const debut = Date.now();
    await B.context().setOffline(false);
    await B.evaluate(() => window.dispatchEvent(new Event('online')));
    const revenu = await A.waitForFunction(f => getComputedStyle(document.body).backgroundColor === f, FONDS[cibleHL], { polling: 25, timeout: 30_000 }).then(() => true, () => false);
    mesures.retourReseau = Date.now() - debut;
    verifier(revenu, `retour du réseau : la modification arrive sur A en ${mesures.retourReseau} ms`);

    // ================================================================ 5. Onglet fermé juste après une modification
    log('B modifie puis ferme l’onglet tout de suite : la file part en keepalive');
    await pause(1000);
    await parametres(B, 'general');
    const cibleFermeture = (await themeCourant(A)) === 'nuit' ? 'sauge' : 'nuit';
    await B.getByTestId(`parametres-theme-${cibleFermeture}`).click();
    await B.close({ runBeforeUnload: true });
    const recuApresFermeture = await A.waitForFunction(f => getComputedStyle(document.body).backgroundColor === f, FONDS[cibleFermeture], { polling: 25, timeout: 30_000 }).then(() => true, () => false);
    verifier(recuApresFermeture, 'onglet fermé pendant l’envoi : la modification arrive quand même sur A');
    await capture(A, '08-apres-fermeture-onglet');
  }
} catch (erreur) {
  echecs++;
  console.error(erreur);
} finally {
  await navigateur.close();
  serveurRelais.close();
  serveurAncien.close();
  serveurSite.close();
}
console.log(`\nMESURES ${JSON.stringify(mesures)}`);
console.log(echecs === 0 ? '\nTout est bon.' : `\n${echecs} échec(s).`);
process.exit(echecs === 0 ? 0 : 1);
