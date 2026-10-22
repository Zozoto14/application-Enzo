/**
 * Synchronisation dès le démarrage, de bout en bout : deux « appareils » (deux
 * contextes Chromium) et un faux relais local qui exécute relais/relais.mjs.
 *
 *  - B change le thème et crée un compte pendant que A est fermé ;
 *  - A démarre (verrouillé) : « 1 mise à jour reçue, en attente de déverrouillage » ;
 *  - A se déverrouille SANS relais joignable : thème et compte sont là dès la
 *    première image (fusion du cache `entrant`) ;
 *  - A, relais coupé, change le thème ; A redémarre : « 1 élément prêt à
 *    envoyer » ; le relais revient : l'envoi part tout seul, sans déverrouiller.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-demarrage.mjs
 *
 * Variables : PLAYWRIGHT_PATH (dossier de node_modules contenant playwright),
 * CAPTURES (dossier des captures, défaut docs/captures-demarrage).
 * Rien n'est installé ni versionné : le certificat auto-signé vit dans un
 * dossier temporaire.
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
const { relais: coeurRelais } = await import(pathToFileURL(join(racine, 'relais/relais.mjs')).href);

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-demarrage');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-0123456789abcdef';
const PORT_RELAIS = 8795;
const PORT_SITE = 5205;
const MOT_DE_PASSE = 'un-mot-de-passe-e2e-très-long-42';

// ------------------------------------------------------------- Faux relais
const kv = new Map();
const compteurs = { put: 0, get: 0 };
/** Appareil de chaque dépôt, dans l'ordre. */
const depots = [];
const env = {
  JETON,
  BOITE: {
    get: async cle => (kv.has(cle) ? kv.get(cle) : null),
    put: async (cle, valeur) => void kv.set(cle, valeur),
    delete: async cle => void kv.delete(cle),
  },
};
const dossier = mkdtempSync(join(tmpdir(), 'e2e-demarrage-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dossier, 'k.pem'), '-out', join(dossier, 'c.pem'), '-subj', '/CN=localhost', '-days', '1'], { stdio: 'ignore' });
const serveurRelais = https.createServer({ key: readFileSync(join(dossier, 'k.pem')), cert: readFileSync(join(dossier, 'c.pem')) }, async (req, res) => {
  const morceaux = [];
  for await (const m of req) morceaux.push(m);
  const corps = Buffer.concat(morceaux);
  // Seuls les dépôts du portefeuille comptent ici (pas ceux des comptes, dans /p/…).
  if (req.method === 'PUT' && req.url.startsWith('/boite/')) {
    compteurs.put++;
    depots.push(req.url.slice('/boite/'.length));
  }
  if (req.method === 'GET' && req.url.startsWith('/boite')) compteurs.get++;
  const requete = new Request(`https://localhost:${PORT_RELAIS}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : corps,
  });
  const reponse = await coeurRelais.traiter(requete, env);
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
  for (const c of texte.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
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
const CODE = 'AB1.' + base64url(JSON.stringify({ r: `https://localhost:${PORT_RELAIS}`, j: JETON }));
const URL_SITE = `http://localhost:${PORT_SITE}/#liaison=${CODE}`;
const pause = ms => new Promise(ok => setTimeout(ok, ms));
const log = (...a) => console.log('[e2e]', ...a);
let echecs = 0;
const verifier = (ok, message) => {
  console.log(ok ? '  OK   ' : '  ECHEC', message);
  if (!ok) echecs++;
};
const attendreTexte = async (page, motif, delai = 60_000) => {
  await page.getByText(motif).first().waitFor({ timeout: delai });
};
const libelleSynchro = async page => (await page.getByTestId('synchro-libelle').first().textContent({ timeout: 5000 }).catch(() => null)) ?? '(absent)';

async function deverrouiller(page, secret) {
  await page.locator('input[type=password]').first().fill(MOT_DE_PASSE);
  for (const decalage of [0, 1, -1]) {
    await page.locator('input:not([type=password])').first().fill(totp(secret, decalage));
    await page.getByTestId('bouton-deverrouiller').click();
    const reussi = await page.getByTestId('hub').waitFor({ timeout: 25_000 }).then(() => true, () => false);
    if (reussi) return;
  }
  throw new Error('déverrouillage impossible');
}


const rgb = hex => `rgb(${Number.parseInt(hex.slice(1, 3), 16)}, ${Number.parseInt(hex.slice(3, 5), 16)}, ${Number.parseInt(hex.slice(5, 7), 16)})`;
const IVOIRE = rgb('#F6F3EC');
const fondHub = page =>
  page.evaluate(() => {
    const hub = document.querySelector('[data-testid="hub"]');
    return hub ? getComputedStyle(hub).backgroundColor : null;
  });
const ligneDemarrage = async page => (await page.getByTestId('synchro-demarrage').first().innerText({ timeout: 2000 }).catch(() => '')).replace(/\s+/g, ' ');
const attendreLigne = async (page, motif, delai = 60_000) => {
  const debut = Date.now();
  let texte = '';
  while (Date.now() - debut < delai) {
    texte = await ligneDemarrage(page);
    if (motif.test(texte)) return texte;
    await pause(500);
  }
  return texte;
};
/** Date du dernier dépôt d'un appareil sur le relais. */
const dateDepot = id => {
  try {
    return JSON.parse(kv.get(`appareil:${id}`) ?? kv.get(`boite:${id}`) ?? 'null')?.date;
  } catch {
    return undefined;
  }
};
/** Enregistre, à chaque image, le fond du hub dès qu'il existe (premier rendu compris). */
const ENREGISTREUR = () => {
  window.__fondsHub = [];
  const relever = () => {
    const hub = document.querySelector('[data-testid="hub"]');
    if (hub) window.__fondsHub.push(getComputedStyle(hub).backgroundColor);
    requestAnimationFrame(relever);
  };
  requestAnimationFrame(relever);
};

const navigateur = await chromium.launch({ headless: true });
try {
  const contexteA = await nouveauContexte(navigateur, { ignoreHTTPSErrors: true, viewport: { width: 1100, height: 800 } });
  const contexteB = await nouveauContexte(navigateur, { ignoreHTTPSErrors: true, viewport: { width: 1100, height: 800 } });
  let A = await contexteA.newPage();
  const B = await contexteB.newPage();
  for (const [nom, p] of [['A', A], ['B', B]]) p.on('pageerror', e => log(`erreur page ${nom}:`, e.message));

  // ----- A : création du coffre, liaison au relais
  log('A : premier lancement');
  await A.goto(URL_SITE);
  await A.getByTestId('accueil-creer').click({ timeout: 60_000 });
  await A.getByTestId('accueil-creer-confirmer').click();
  const champs = A.locator('input[type=password]');
  await champs.nth(0).waitFor({ timeout: 60_000 });
  await champs.nth(0).fill(MOT_DE_PASSE);
  await champs.nth(1).fill(MOT_DE_PASSE);
  await A.getByTestId('bouton-creer').click();
  await A.getByText('À noter maintenant').waitFor({ timeout: 60_000 });
  const secret = ((await A.locator('body').innerText()).match(/\b[A-Z2-7]{16,}\b/) ?? [])[0];
  if (!secret) throw new Error('secret TOTP introuvable');
  await A.getByRole('switch').click();
  await A.getByTestId('bouton-continuer').click();
  await A.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(async () => deverrouiller(A, secret));
  await A.getByTestId('synchro-indicateur').waitFor({ timeout: 60_000 });
  await attendreTexte(A, /À jour/);
  for (let i = 0; i < 30 && !kv.has('appareil:coffre'); i++) await pause(1000);
  const idA = depots.find(id => id !== 'coffre');
  verifier(Boolean(idA), `A a déposé (appareil ${idA})`);
  // Le marquage du devblog part au dépôt suivant (30 s mini) : on le laisse partir.
  const putsCreation = compteurs.put;
  for (let i = 0; i < 70 && compteurs.put === putsCreation; i++) await pause(1000);

  // ----- B : « Lier à mon compte »
  log('B : liaison');
  // Navigateur déjà relié avant la mise à jour (ce scénario teste l'ancienne boîte, relais sans coffre serveur).
  await B.goto(URL_SITE);
  await B.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 });
  await deverrouiller(B, secret);
  await B.getByTestId('synchro-indicateur').waitFor({ timeout: 60_000 });
  await attendreTexte(B, /À jour/);
  // A reçoit B une première fois (B connu de A), puis A se ferme.
  await A.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await pause(4000);
  await attendreTexte(A, /À jour/);
  const fondAvant = await fondHub(A);
  verifier(fondAvant !== IVOIRE, `A au thème par défaut avant fermeture (${fondAvant})`);
  log('A : fermeture');
  await A.close();

  // ----- B : thème Ivoire + nouveau compte, pendant que A est fermé
  log('B : thème Ivoire et nouveau compte');
  const idB = depots.filter(id => id !== 'coffre' && id !== idA).at(-1);
  await B.getByTestId('hub-parametres-ouvrir').click();
  await B.getByTestId('parametres-theme-ivoire').click();
  await B.getByTestId('hub-parametres-fermer').click();
  await B.getByTestId('tuile-portefeuille').click();
  await B.getByTestId('bouton-creer-compte-depuis-tableau').click({ timeout: 30_000 });
  await B.getByPlaceholder('PEA BoursoBank').fill('Livret Démarrage');
  await B.getByPlaceholder('JJ/MM/AAAA').fill('15/03/2019');
  await B.getByTestId('bouton-creer-compte').click();
  await B.getByText('Livret Démarrage').first().waitFor({ timeout: 30_000 });
  const changeLe = new Date().toISOString();
  await B.screenshot({ path: join(CAPTURES, '01-B-theme-ivoire-nouveau-compte.png') });
  // Dépôt de B contenant les deux changements (délai minimal de 30 s respecté).
  let depotB = false;
  for (let i = 0; i < 90 && !depotB; i++) {
    await pause(1000);
    depotB = (dateDepot(idB) ?? '') > changeLe && /À jour/.test(await libelleSynchro(B));
  }
  verifier(depotB, `B a déposé ses changements (${dateDepot(idB)})`);
  await B.keyboard.press('Escape');

  // ----- A démarre, verrouillé : la mise à jour est déjà téléchargée (chiffrée)
  log('A : démarrage verrouillé');
  const getsAvant = compteurs.get;
  A = await contexteA.newPage();
  A.on('pageerror', e => log('erreur page A:', e.message));
  await A.addInitScript(ENREGISTREUR);
  await A.goto(URL_SITE);
  await A.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 });
  const ligne1 = await attendreLigne(A, /1 mise à jour reçue, en attente de déverrouillage/);
  verifier(/1 mise à jour reçue, en attente de déverrouillage/.test(ligne1), `A verrouillé : « ${ligne1} »`);
  verifier(/Synchronisé (à l’instant|il y a)/.test(ligne1), 'A verrouillé : « Synchronisé … » affiché');
  verifier(compteurs.get > getsAvant, `A a contacté le relais avant le déverrouillage (${compteurs.get - getsAvant} GET)`);
  verifier(!(await A.locator('body').innerText()).includes('Livret Démarrage'), 'rien du contenu reçu n’est visible avant le déverrouillage');
  await A.screenshot({ path: join(CAPTURES, '02-A-verrouille-1-mise-a-jour-recue.png') });

  // ----- Déverrouillage SANS relais : la fusion part du cache
  log('A : déverrouillage, relais injoignable');
  await A.route(`https://localhost:${PORT_RELAIS}/**`, route => route.abort());
  await A.locator('input[type=password]').first().fill(MOT_DE_PASSE);
  let ouvert = false;
  for (const decalage of [0, 1, -1]) {
    await A.locator('input:not([type=password])').first().fill(totp(secret, decalage));
    await A.evaluate(() => (window.__fondsHub = []));
    await A.getByTestId('bouton-deverrouiller').click();
    ouvert = await A.getByTestId('hub').waitFor({ timeout: 25_000 }).then(() => true, () => false);
    if (ouvert) break;
  }
  if (!ouvert) throw new Error('déverrouillage impossible');
  await pause(600);
  const fondsHub = await A.evaluate(() => window.__fondsHub);
  verifier(fondsHub.length > 0 && fondsHub.every(c => c === IVOIRE), `thème Ivoire dès la première image du hub (${fondsHub.length} images, fonds : ${[...new Set(fondsHub)].join(' | ')})`);
  await A.screenshot({ path: join(CAPTURES, '03-A-deverrouille-ivoire-immediat.png') });
  // Premier compte reçu : la visite guidée du portefeuille se propose (comportement habituel) ; on la passe.
  await A.getByText('Passer la visite').first().click({ timeout: 5000 }).catch(() => undefined);
  await A.getByTestId('tuile-portefeuille').click();
  const compteVu = await A.getByText('Livret Démarrage').first().waitFor({ timeout: 10_000 }).then(() => true, () => false);
  verifier(compteVu, 'le compte créé sur B est là, relais injoignable (fusion du cache)');
  await A.screenshot({ path: join(CAPTURES, '04-A-compte-recu-sans-reseau.png') });
  await A.keyboard.press('Escape');
  await A.getByTestId('hub').waitFor({ timeout: 10_000 });

  // ----- Relais coupé : A change le thème, puis redémarre
  log('A : changement hors ligne, puis redémarrage');
  await A.getByTestId('hub-parametres-ouvrir').click();
  await A.getByTestId('parametres-theme-sauge').click();
  await A.getByTestId('hub-parametres-fermer').click();
  await pause(6000); // ~2 s : l'enveloppe `sortant` est scellée ; le tour échoue (relais coupé).
  await A.screenshot({ path: join(CAPTURES, '05-A-changement-relais-coupe.png') });
  const putsA = () => depots.filter(id => id === idA).length;
  const putsAAvant = putsA();
  await A.close();
  A = await contexteA.newPage();
  A.on('pageerror', e => log('erreur page A:', e.message));
  await A.route(`https://localhost:${PORT_RELAIS}/**`, route => route.abort());
  await A.goto(URL_SITE);
  await A.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 });
  const ligne2 = await attendreLigne(A, /1 élément prêt à envoyer/, 20_000);
  verifier(/1 élément prêt à envoyer/.test(ligne2), `A redémarré, relais coupé : « ${ligne2} »`);
  await A.screenshot({ path: join(CAPTURES, '06-A-redemarre-1-element-pret.png') });

  // ----- Le réseau revient : l'envoi part tout seul, sans déverrouiller
  log('A : retour du réseau (toujours verrouillé)');
  await A.unroute(`https://localhost:${PORT_RELAIS}/**`);
  let parti = false;
  const debut = Date.now();
  while (Date.now() - debut < 90_000 && !parti) {
    await pause(1000);
    parti = putsA() > putsAAvant;
  }
  verifier(parti, `l’enveloppe en attente est partie toute seule (${Math.round((Date.now() - debut) / 1000)} s, toujours verrouillé)`);
  verifier((await A.getByTestId('bouton-deverrouiller').count()) === 1, 'A est resté verrouillé');
  const ligne3 = await attendreLigne(A, /Synchronisé à l’instant/, 20_000);
  verifier(/Synchronisé/.test(ligne3) && !/prêt à envoyer/.test(ligne3), `A après envoi : « ${ligne3} »`);
  await A.screenshot({ path: join(CAPTURES, '07-A-envoye-sans-deverrouiller.png') });

  // ----- B reçoit le thème Sauge choisi hors ligne sur A
  const fondB = await fondHub(B);
  let recu = false;
  const debutB = Date.now();
  while (Date.now() - debutB < 90_000 && !recu) {
    await B.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await pause(4000);
    recu = (await fondHub(B)) !== fondB;
  }
  verifier(recu, 'B a reçu le thème choisi hors ligne sur A');
  await B.screenshot({ path: join(CAPTURES, '08-B-recoit-theme-de-A.png') });

  // ----- Fichiers des caches : aucune donnée en clair
  const caches = await A.evaluate(
    () =>
      new Promise(ok => {
        const demande = indexedDB.open('applibourse', 1);
        demande.onsuccess = () => {
          const t = demande.result.transaction('fichiers', 'readonly').objectStore('fichiers');
          const sortie = {};
          const curseur = t.openCursor();
          curseur.onsuccess = () => {
            const c = curseur.result;
            if (!c) return ok(sortie);
            if (String(c.key).startsWith('synchro-')) sortie[c.key] = new TextDecoder().decode(c.value);
            c.continue();
          };
        };
      }),
  );
  const textes = Object.values(caches).join('\n');
  verifier(Object.keys(caches).length > 0, `caches présents sur A (${Object.keys(caches).join(', ')})`);
  verifier(!/Livret|ivoire|sauge|jeton-e2e|PEA/i.test(textes), 'les caches ne contiennent ni contenu, ni thème, ni jeton en clair');

  log(`relais : ${compteurs.put} PUT, ${compteurs.get} GET`);
} finally {
  await navigateur.close();
  serveurRelais.close();
  serveurSite.close();
}
console.log(echecs === 0 ? 'E2E OK' : `E2E : ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
