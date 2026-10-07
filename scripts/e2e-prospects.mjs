/**
 * Test de bout en bout de l'app PROSPECTS : Fondateur (site relié à un faux
 * relais) → tuile « Prospects » → ajout rapide, ajout en lot (doublons,
 * invalides), import CSV, filtre « À relancer aujourd'hui », « Écrire »
 * (un lien mailto: avec le modèle), « Ne plus contacter » qui bloque Écrire,
 * export CSV, suppression avec confirmation → le dépôt d'administration sur
 * le relais ne contient aucune adresse en clair → une amie (Léa) n'a ni la
 * tuile ni les données → passage en 390 × 844 : cartes, feuille basse,
 * bouton principal, mesures (débordement, cibles de 44 px, textes de 15 px).
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-prospects.mjs
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
import { mesurer } from './mobile-outils.mjs';

const racine = fileURLToPath(new URL('..', import.meta.url));
const requireGlobal = createRequire(join(process.env.PLAYWRIGHT_PATH ?? '/opt/node22/lib/node_modules', 'x.js'));
const { chromium } = requireGlobal('playwright');
const worker = (await import(pathToFileURL(join(racine, 'relais/worker.mjs')).href)).default;

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-prospects');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-prospects-0123456789abcdef0123';
const PORT_RELAIS = 8801;
const PORT_SITE = 5211;
const MDP_ADMIN = 'mot-de-passe-du-pc-e2e-prospects-42';
const ADRESSE_SECRETE = 'lea.prospect@atelier-lune.fr';

// ------------------------------------------------------------- Faux relais (KV avec liste et métadonnées)
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
const dossier = mkdtempSync(join(tmpdir(), 'e2e-prospects-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dossier, 'k.pem'), '-out', join(dossier, 'c.pem'), '-subj', '/CN=localhost', '-days', '1'], { stdio: 'ignore' });
const serveurRelais = https.createServer({ key: readFileSync(join(dossier, 'k.pem')), cert: readFileSync(join(dossier, 'c.pem')) }, async (req, res) => {
  const morceaux = [];
  for await (const m of req) morceaux.push(m);
  const requete = new Request(`https://localhost:${PORT_RELAIS}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(morceaux) });
  const reponse = await worker.fetch(requete, env);
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
const CODE_PC = 'AB1.' + base64url(JSON.stringify({ r: `https://localhost:${PORT_RELAIS}`, j: JETON }));
const SITE = `http://localhost:${PORT_SITE}/`;
const pause = ms => new Promise(ok => setTimeout(ok, ms));
const log = (...a) => console.log('[e2e-prospects]', ...a);
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
const jourFr = decalage => {
  const d = new Date(Date.now() + decalage * 86_400_000);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

async function deverrouiller(page, motDePasse, secret, attendu = 'hub') {
  for (const decalage of [0, 1, -1]) {
    await page.locator('input[type=password]').first().fill(motDePasse);
    await page.locator('input:not([type=password])').first().fill(totp(secret, decalage));
    await page.getByTestId('bouton-deverrouiller').click();
    if (await page.getByTestId(attendu).waitFor({ timeout: 25_000 }).then(() => true, () => false)) return;
  }
  throw new Error('déverrouillage impossible');
}
async function fermerPopups(page) {
  for (let i = 0; i < 3; i++) {
    const clique = await page.getByText(/^(Fermer|Terminé|Compris|Plus tard)$/).first().click({ timeout: 2500 }).then(() => true, () => false);
    if (!clique) break;
  }
  await page.keyboard.press('Escape').catch(() => undefined);
}
async function identiteSiDemandee(page) {
  const demandee = await page.getByTestId('admin-identite-mdp').waitFor({ timeout: 4000 }).then(() => true, () => false);
  if (!demandee) return;
  for (const decalage of [0, 1, -1]) {
    await page.getByTestId('admin-identite-mdp').fill(MDP_ADMIN);
    await page.getByTestId('admin-identite-code').fill(totp(secretAdmin, decalage));
    await page.getByTestId('admin-identite-valider').click();
    if (await page.getByTestId('admin-identite').waitFor({ state: 'detached', timeout: 15_000 }).then(() => true, () => false)) return;
  }
  throw new Error('vérification d’identité impossible');
}
const idsCartes = page => page.locator('[data-testid^="prospects-carte-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid').replace('prospects-carte-', '')));
async function idDe(page, texte) {
  for (const id of await idsCartes(page)) {
    if ((await page.getByTestId(`prospects-carte-${id}`).innerText()).includes(texte)) return id;
  }
  throw new Error(`fiche ${texte} introuvable`);
}
const avis = page => page.getByTestId('prospects-avis').innerText();

let secretAdmin;
const navigateur = await chromium.launch({ headless: true });
const options = { ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 }, acceptDownloads: true };
try {
  const pc = await (await nouveauContexte(navigateur, options)).newPage();
  pc.on('pageerror', e => log('erreur page PC :', e.message));

  log('Site : coffre du Fondateur, relié au relais');
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
  secretAdmin = ((await pc.locator('body').innerText()).match(/\b[A-Z2-7]{16,}\b/) ?? [])[0];
  if (!secretAdmin) throw new Error('secret TOTP introuvable');
  await pc.getByRole('switch').click();
  await pc.getByTestId('bouton-continuer').click();
  await pc.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(pc, MDP_ADMIN, secretAdmin));
  await fermerPopups(pc);

  // ---------------------------------------------------------------- Tuile
  const tuile = pc.getByTestId('tuile-prospects');
  verifier(await tuile.waitFor({ timeout: 20_000 }).then(() => true, () => false), 'le hub du Fondateur affiche la tuile « Prospects »');
  await capture(pc, '01-hub-tuile');
  await tuile.click();
  await pc.getByTestId('app-prospects').waitFor({ timeout: 20_000 });
  const adminAvant = kv.get('p:principal:admin');
  verifier(/RGPD/.test(await pc.getByTestId('prospects-rgpd').innerText()), 'rappel honnête sur la prospection (RGPD, désinscription) affiché');

  // ---------------------------------------------------------------- Ajout rapide
  log('Ajout rapide');
  await pc.getByTestId('prospects-nouveau').click();
  await pc.getByTestId('prospects-form-nom').fill('Léa Martin');
  await pc.getByTestId('prospects-form-entreprise').fill('Atelier Lune');
  await pc.getByTestId('prospects-form-email').fill(ADRESSE_SECRETE);
  await pc.getByTestId('prospects-form-source').fill('Salon du design');
  await pc.getByTestId('prospects-form-etiquettes').fill('salon, chaud');
  await pc.getByTestId('prospects-form-relance').fill(jourFr(0));
  await pc.getByTestId('prospects-form-valider').click();
  verifier(/Léa Martin ajouté/.test(await avis(pc)), 'fiche ajoutée');
  const idLea = await idDe(pc, 'Léa Martin');

  // Doublon (casse).
  await pc.getByTestId('prospects-nouveau').click();
  await pc.getByTestId('prospects-form-email').fill(ADRESSE_SECRETE.toUpperCase());
  await pc.getByTestId('prospects-form-valider').click();
  verifier(/déjà dans le carnet/.test(await avis(pc)), 'doublon refusé (casse ignorée)');
  await pc.getByTestId('prospects-form-annuler').click();

  // ---------------------------------------------------------------- Ajout en lot
  log('Ajout en lot');
  await pc.getByTestId('prospects-ajout-lot').click();
  await pc.getByTestId('prospects-lot-texte').fill(`hugo@beton.fr; HUGO@beton.fr, paul@exemple.org\n${ADRESSE_SECRETE}\npas-une-adresse`);
  await pc.getByTestId('prospects-lot-source').fill('Liste du salon');
  await capture(pc, '02-ajout-lot');
  await pc.getByTestId('prospects-lot-valider').click();
  const bilanLot = await avis(pc);
  verifier(/2 adresses ajoutées · 2 doublons ignorés · 1 invalide/.test(bilanLot), `bilan du lot : « ${bilanLot} »`);

  // ---------------------------------------------------------------- Import CSV
  log('Import CSV');
  await pc.getByTestId('prospects-ouvrir-import').click();
  await pc.getByTestId('prospects-import-texte').fill('nom;entreprise;email;statut;prochaine_relance\nZoé Durand;Studio Z;zoe@studio-z.fr;Répond;01/01/2026\nDoublon;X;paul@exemple.org;;\n');
  await pc.getByTestId('prospects-import-valider').click();
  const bilanImport = await avis(pc);
  verifier(/1 ajouté, 1 doublon ignoré, 0 ligne invalide/.test(bilanImport), `bilan de l’import : « ${bilanImport} »`);
  verifier((await idsCartes(pc)).length === 4, '4 fiches dans le carnet');
  verifier(/^4/.test(await pc.getByTestId('prospects-compteur-total').innerText()), 'compteur : 4 fiches');

  // ---------------------------------------------------------------- Relances
  await pc.getByTestId('prospects-vue-relancer').click();
  const relancer = await idsCartes(pc);
  verifier(relancer.length === 2 && relancer.includes(idLea), `« À relancer aujourd’hui » : Léa (aujourd’hui) et Zoé (en retard) — ${relancer.length} fiche(s)`);
  await capture(pc, '03-a-relancer');
  await pc.getByTestId('prospects-vue-tous').click();
  await pc.getByTestId('prospects-statut-repond').click();
  verifier((await idsCartes(pc)).length === 1, 'filtre par statut « Répond »');
  await pc.getByTestId('prospects-statut-tous').click();
  await pc.getByTestId('prospects-recherche').fill('atelier');
  verifier((await idsCartes(pc)).length === 1, 'recherche « atelier »');
  await pc.getByTestId('prospects-recherche').fill('');

  // ---------------------------------------------------------------- Écrire
  log('Écrire');
  await pc.evaluate(() => {
    window.__liens = [];
    window.open = url => {
      window.__liens.push(String(url));
      return null;
    };
  });
  await pc.getByTestId(`prospects-ecrire-${idLea}`).click();
  verifier(/Bonjour Léa/.test(await pc.getByTestId('prospects-ecrire-sujet').innerText()), 'modèle personnalisé ({prenom})');
  verifier(/Atelier Lune/.test(await pc.getByTestId('prospects-ecrire-corps').innerText()), 'modèle personnalisé ({entreprise})');
  await capture(pc, '04-ecrire');
  await pc.getByTestId('prospects-ecrire-ouvrir').click();
  const liens = await pc.evaluate(() => window.__liens);
  verifier(liens.length === 1 && liens[0].startsWith(`mailto:${ADRESSE_SECRETE}?subject=`), `un seul lien mailto: ouvert (${(liens[0] ?? '').slice(0, 60)}…)`);
  await pc.getByTestId('prospects-ecrire-noter').click();
  verifier(/Contacté/.test(await pc.getByTestId(`prospects-statut-${idLea}`).innerText()), 'envoi noté : Léa passe à « Contacté », relance dans 7 jours');

  // ---------------------------------------------------------------- Ne plus contacter
  const idHugo = await idDe(pc, 'hugo@beton.fr');
  await pc.getByTestId(`prospects-modifier-${idHugo}`).click();
  await pc.getByTestId('prospects-form-nom').fill('Hugo Béton');
  await pc.getByTestId('prospects-form-ne-plus-contacter').click();
  await pc.getByTestId('prospects-form-valider').click();
  verifier(await pc.getByTestId(`prospects-ecrire-${idHugo}`).isDisabled(), '« Ne plus contacter » : le bouton Écrire est bloqué');
  await capture(pc, '05-carnet-bureau');

  // ---------------------------------------------------------------- Export CSV
  const [telechargement] = await Promise.all([pc.waitForEvent('download', { timeout: 20_000 }).catch(() => undefined), pc.getByTestId('prospects-export').click()]);
  if (telechargement) {
    const csv = readFileSync(await telechargement.path(), 'utf8');
    verifier(/nom,entreprise,email,telephone/.test(csv) && csv.includes(ADRESSE_SECRETE) && /historique/.test(csv) && csv.split('\r\n').length >= 5, 'export CSV complet (4 fiches, toutes les colonnes)');
  } else verifier(false, 'export CSV : aucun téléchargement');

  // ---------------------------------------------------------------- Suppression
  const idPaul = await idDe(pc, 'paul@exemple.org');
  await pc.getByTestId(`prospects-supprimer-${idPaul}`).click();
  verifier((await pc.getByTestId('prospects-suppression').count()) === 1, 'suppression : confirmation demandée');
  await pc.getByTestId('prospects-confirmer-suppression').click();
  verifier((await pc.getByTestId(`prospects-carte-${idPaul}`).count()) === 0, 'suppression confirmée');

  // ---------------------------------------------------------------- Relais : chiffré
  log('Relais : dépôt d’administration scellé');
  const publie = await attendre(async () => {
    await pc.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const admin = kv.get('p:principal:admin');
    return Boolean(admin) && admin !== adminAvant;
  }, 120_000, 3000);
  verifier(publie, 'les données d’administration (avec les prospects) sont déposées sur le relais');
  const tout = [...kv.values()].join('\n');
  verifier(!tout.includes(ADRESSE_SECRETE) && !tout.includes('Atelier Lune') && !tout.includes('beton.fr'), 'aucune adresse ni entreprise en clair sur le relais');

  // ---------------------------------------------------------------- Une amie : ni tuile ni données
  log('Amie : création, puis connexion sur un autre navigateur');
  await pc.getByTestId('retour-hub').click();
  await pc.locator('[data-testid="tuile-administration"]').first().click();
  await pc.getByTestId('app-administration').waitFor({ timeout: 20_000 });
  await pc.getByTestId('admin-onglet-utilisateurs').click();
  await pc.getByTestId('admin-nouveau').click();
  await pc.getByTestId('admin-nom').fill('Léa');
  await pc.getByTestId('admin-nouveau-informe').click();
  // Tenter de lui ouvrir toutes les apps : Prospects n'est pas proposée.
  verifier((await pc.locator('[data-testid*="prospects"]').count()) === 0, 'Administration : Prospects n’est jamais proposée aux amis');
  await pc.getByTestId('admin-creer').click();
  await pc.getByTestId('admin-identifiants').waitFor({ timeout: 60_000 });
  const mdpAmie = (await pc.getByTestId('admin-mot-de-passe').innerText()).replace(/^\s*Mot de passe\s*/, '').trim();
  const secretAmie = (await pc.getByTestId('admin-secret-totp').innerText()).replace(/^\s*Clé TOTP\s*/, '').replace(/\s+/g, '');
  await pc.getByTestId('admin-transmis').click().catch(() => undefined);
  await pc.getByTestId('admin-termine').click();
  await pc.getByTestId('admin-liste').getByText('Léa', { exact: true }).first().click();
  await pc.getByTestId('admin-detail').waitFor({ timeout: 20_000 });
  await pc.getByTestId('admin-code-site-generer').click();
  await identiteSiDemandee(pc);
  await pc.getByTestId('admin-code-site').waitFor({ timeout: 20_000 });
  const codeAmie = (await pc.getByTestId('admin-code-site').innerText()).trim();
  const amie = await (await nouveauContexte(navigateur, options)).newPage();
  amie.on('pageerror', e => log('erreur page amie :', e.message));
  await amie.goto(`${SITE}#liaison=${codeAmie}`);
  await amie.getByTestId('accueil-site').waitFor({ timeout: 60_000 });
  await amie.getByTestId('bouton-relier-accueil').click();
  await amie.getByTestId('connexion-prenom').waitFor({ timeout: 60_000 });
  await amie.getByTestId('connexion-prenom').fill('Léa');
  await amie.getByTestId('connexion-continuer').click();
  await amie.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 });
  await deverrouiller(amie, mdpAmie, secretAmie);
  await fermerPopups(amie);
  await pause(4000);
  verifier((await amie.locator('[data-testid="tuile-prospects"], [data-testid="cellule-prospects"]').count()) === 0, 'l’amie ne voit pas la tuile Prospects');
  const pageAmie = await amie.locator('body').innerText();
  verifier(!pageAmie.includes(ADRESSE_SECRETE) && !/Prospects/.test(pageAmie), 'aucune donnée de prospection chez l’amie');
  await capture(amie, '06-hub-amie-sans-prospects');

  // ---------------------------------------------------------------- Téléphone (390 × 844)
  log('Téléphone : 390 × 844');
  await pc.getByTestId('retour-hub').click();
  await pc.setViewportSize({ width: 390, height: 844 });
  await pause(800);
  await pc.locator('[data-testid="cellule-prospects"], [data-testid="tuile-prospects"]').first().click();
  await pc.getByTestId('app-prospects').waitFor({ timeout: 20_000 });
  await pause(1500);
  await capture(pc, '07-telephone-liste');
  verifier((await pc.getByTestId('pied-collant').count()) === 1, 'téléphone : « Nouveau prospect » en bouton principal collé en bas');
  const m1 = await mesurer(pc);
  verifier(m1.debordementPage === 0 && m1.deborde.length === 0, `téléphone : aucun débordement horizontal (${m1.deborde.slice(0, 3).join(' ; ')})`);
  verifier(m1.petitesCibles === 0, `téléphone : cibles ≥ 44 px (${m1.exemplesCibles.slice(0, 4).join(' ; ')})`);
  verifier(m1.petitsTextes === 0, `téléphone : textes ≥ 15 px (${m1.exemplesPetits.join(' ; ')})`);
  await capture(pc, '07-telephone-liste');
  await pc.getByTestId(`prospects-carte-${idLea}`).click();
  await pc.getByTestId(`prospects-fiche-${idLea}`).waitFor({ timeout: 10_000 });
  await pause(500);
  const m2 = await mesurer(pc);
  verifier(m2.petitesCibles === 0 && m2.petitsTextes === 0, `téléphone, fiche en feuille basse : cibles et textes (${[...m2.exemplesCibles, ...m2.exemplesPetits].slice(0, 4).join(' ; ')})`);
  await capture(pc, '08-telephone-fiche');
  await pc.getByTestId('prospects-feuille-fermer').click();
  await pc.getByTestId('prospects-nouveau').click();
  await pc.getByTestId('prospects-formulaire').waitFor({ timeout: 10_000 });
  await pause(500);
  const m3 = await mesurer(pc);
  verifier(m3.petitesCibles === 0 && m3.petitsTextes === 0, `téléphone, ajout en feuille basse : cibles et textes (${[...m3.exemplesCibles, ...m3.exemplesPetits].slice(0, 4).join(' ; ')})`);
  await capture(pc, '09-telephone-ajout');
  await pc.getByTestId('prospects-form-nom').fill('Nina Mobile');
  await pc.getByTestId('prospects-form-email').fill('nina@exemple.fr');
  await pc.getByTestId('prospects-form-valider').click();
  await pause(500);
  verifier((await idsCartes(pc)).length === 4, 'téléphone : fiche ajoutée depuis la feuille basse');
  await pc.getByTestId('prospects-filtres').click();
  await pc.getByTestId('prospects-feuille-filtres').waitFor({ timeout: 10_000 });
  await capture(pc, '10-telephone-filtres');
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
