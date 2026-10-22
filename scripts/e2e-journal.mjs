/**
 * Test de bout en bout du JOURNAL AUTOMATIQUE : Fondateur (site relié à un faux
 * relais) → Tâches (exemple + tâche terminée) → tuile « Journal » → page du jour
 * écrite à partir des tâches (fait marquant, chiffres clés), note, humeur,
 * épingle (conservées en quittant et en revenant) → jours, semaine, mois,
 * calendrier, recherche → export Markdown (fichier) et PDF (impression) →
 * réglage de l'heure → le relais n'a reçu AUCUNE écriture du journal et rien
 * en clair → une amie sans l'app n'a pas la tuile ; avec l'app, son journal
 * est vide et sans rien du Fondateur → iPhone 390 × 844 et iPad : mesures
 * (débordement, cibles de 44 px, textes de 15 px), thèmes clair et sombre.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-journal.mjs
 */

import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { accepterInvitationAmi, allerPageAdministration, allerPageApplications, lienInvitationDuPanneau, nouveauContexte, tuileApp } from './e2e-acceptation.mjs';
import { deverrouiller, mesurer, premierLancement, totp } from './mobile-outils.mjs';

const racine = fileURLToPath(new URL('..', import.meta.url));
const requireGlobal = createRequire(join(process.env.PLAYWRIGHT_PATH ?? '/opt/node22/lib/node_modules', 'x.js'));
const { chromium } = requireGlobal('playwright');
const { relais: coeurRelais } = await import(pathToFileURL(join(racine, 'relais/relais.mjs')).href);

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-journal');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-journal-0123456789abcdef0123';
const PORT_RELAIS = 8873;
const PORT_SITE = 5273;
const MDP_ADMIN = 'mot-de-passe-du-pc-e2e-journal-42';
const NOTE = 'Ma note secrète du soir : rendez-vous avec le notaire';

// ------------------------------------------------------------- Faux relais (KV, avec compte des écritures)
const kv = new Map();
const metas = new Map();
let ecrituresKv = 0;
const env = {
  JETON,
  BOITE: {
    get: async cle => (kv.has(cle) ? kv.get(cle) : null),
    put: async (cle, valeur, options) => {
      ecrituresKv++;
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
const dossier = mkdtempSync(join(tmpdir(), 'e2e-journal-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dossier, 'k.pem'), '-out', join(dossier, 'c.pem'), '-subj', '/CN=localhost', '-days', '1'], { stdio: 'ignore' });
const serveurRelais = https.createServer({ key: readFileSync(join(dossier, 'k.pem')), cert: readFileSync(join(dossier, 'c.pem')) }, async (req, res) => {
  const morceaux = [];
  for await (const m of req) morceaux.push(m);
  const requete = new Request(`https://localhost:${PORT_RELAIS}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(morceaux) });
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

// ------------------------------------------------------------------- Outils
const base64url = t => Buffer.from(t).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const CODE_PC = 'AB1.' + base64url(JSON.stringify({ r: `https://localhost:${PORT_RELAIS}`, j: JETON }));
const SITE = `http://localhost:${PORT_SITE}/`;
const pause = ms => new Promise(ok => setTimeout(ok, ms));
const log = (...a) => console.log('[e2e-journal]', ...a);
let echecs = 0;
const verifier = (ok, message) => {
  console.log(ok ? '  OK   ' : '  ECHEC', message);
  if (!ok) echecs++;
};
const capture = (page, nom) => page.screenshot({ path: join(CAPTURES, `${nom}.png`) });
const texteDe = (page, id) => page.getByTestId(id).first().innerText();
const present = (page, id, delai = 15_000) => page.getByTestId(id).first().waitFor({ timeout: delai }).then(() => true, () => false);

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
async function ouvrirApp(page, id, testApp) {
  await page.getByTestId('hub').waitFor({ timeout: 30_000 });
  await allerPageApplications(page);
  const tuile = tuileApp(page, id).first();
  await tuile.waitFor({ timeout: 30_000 });
  await tuile.click();
  await page.getByTestId(testApp).waitFor({ timeout: 30_000 });
}
async function retourHub(page) {
  await page.getByTestId('retour-hub').click();
  await page.getByTestId('hub').waitFor({ timeout: 20_000 });
}
async function changerTheme(page, theme) {
  await page.getByTestId('hub-parametres-ouvrir').click();
  await page.getByTestId(`parametres-theme-${theme}`).click();
  await page.getByTestId('hub-parametres-fermer').click();
  await page.getByTestId('hub').waitFor({ timeout: 20_000 });
}

let secretAdmin;
const navigateur = await chromium.launch({ headless: true });
const options = { ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 }, acceptDownloads: true };
const erreursPage = [];
try {
  const pc = await (await nouveauContexte(navigateur, options)).newPage();
  pc.on('pageerror', e => {
    erreursPage.push(e.message);
    log('erreur page PC :', e.message);
  });

  // ---------------------------------------------------------------- Coffre du Fondateur
  log('Site : coffre du Fondateur, relié au relais');
  secretAdmin = await premierLancement(pc, { site: SITE, code: CODE_PC, motDePasse: MDP_ADMIN });
  await pc.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(pc, MDP_ADMIN, secretAdmin));
  await fermerPopups(pc);

  // ---------------------------------------------------------------- Journal vide
  log('Tuile « Journal » et page vide');
  const tuile = tuileApp(pc, 'journal').first();
  verifier(await tuile.waitFor({ timeout: 30_000 }).then(() => true, () => false), 'le hub du Fondateur affiche la tuile « Journal »');
  await capture(pc, '01-hub-tuile');
  await tuile.click();
  await pc.getByTestId('app-journal').waitFor({ timeout: 30_000 });
  // Avant 21 h le journal neuf est vide ; après 21 h, la page du soir s'écrit toute seule dès l'ouverture.
  const apres21h = await pc.evaluate(() => new Date().getHours() >= 21);
  if (apres21h) verifier(await present(pc, 'journal-texte', 20_000), 'après 21 h : la page du jour s’est écrite toute seule à l’ouverture');
  else verifier(await present(pc, 'journal-vide'), 'journal neuf avant 21 h : pas de page, bouton « Écrire la page de ce jour »');
  await capture(pc, '02-journal-neuf');
  await pc.getByTestId('journal-reglages-ouvrir').click();
  verifier(/21 h/.test(await texteDe(pc, 'journal-heure')), 'heure d’écriture par défaut : 21 h');
  verifier(/Prochaine page (ce soir|demain) à 21 h|prête/.test(await texteDe(pc, 'journal-prochaine')), 'prochaine page annoncée');
  await retourHub(pc);

  // ---------------------------------------------------------------- Tâches : du contenu pour la journée
  log('Tâches : exemple, une tâche ajoutée puis terminée');
  await ouvrirApp(pc, 'taches', 'app-taches').catch(async () => {
    await tuileApp(pc, 'taches').first().click();
  });
  await pc.getByTestId('taches-demo').click();
  await pc.getByTestId('ajout-rapide').waitFor({ timeout: 20_000 });
  await pc.getByTestId('onglet-liste').click();
  await pc.getByTestId('ajout-rapide').click();
  await pc.getByTestId('ajout-rapide').fill('Relire le contrat Atelier Lune');
  await pc.keyboard.press('Enter');
  await pc.getByTestId('taches-avis').filter({ hasText: 'Ajoutée' }).waitFor({ timeout: 10_000 });
  const ligneContrat = pc.locator('[data-testid^="tache-titre-"]').filter({ hasText: 'Relire le contrat' }).first();
  await ligneContrat.waitFor({ timeout: 10_000 });
  await ligneContrat.click();
  await pc.getByTestId('detail-tache').waitFor({ timeout: 10_000 });
  await pc.getByTestId('detail-terminer').click();
  await pc.keyboard.press('Escape');
  await retourHub(pc);

  // ---------------------------------------------------------------- La page du jour
  log('Journal : la page du jour, lue dans Tâches');
    await ouvrirApp(pc, 'journal', 'app-journal');
  // La page existe peut-être déjà (écrite à 21 h, avant les tâches) : on la réécrit avec ce qui s'est passé depuis.
  if (await present(pc, 'journal-reecrire', 4_000)) await pc.getByTestId('journal-reecrire').click();
  else await pc.getByTestId('journal-ecrire-jour').click();
  await pc.getByTestId('journal-texte').waitFor({ timeout: 30_000 });
  await pc.getByTestId('journal-section-taches').waitFor({ timeout: 30_000 });
  const page1 = await texteDe(pc, 'journal-page');
  verifier(/Relire le contrat Atelier Lune/.test(page1), 'la page cite la tâche terminée dans Tâches');
  verifier(/Les tâches/i.test(await texteDe(pc, 'journal-section-taches')), 'section « Les tâches »');
  verifier(/Tâches terminées/.test(await texteDe(pc, 'journal-chiffres')) && /Tâches créées/.test(await texteDe(pc, 'journal-chiffres')), 'chiffres clés : tâches terminées et créées');
  verifier(await present(pc, 'journal-marquant'), 'un fait marquant du jour');
  verifier(!/undefined|NaN|\[object/.test(page1), 'aucun texte cassé (undefined, NaN)');
  await capture(pc, '03-pc-page-du-jour');

  // Note, humeur, épingle.
  await pc.getByTestId('journal-note').fill(NOTE);
  await pc.getByTestId('journal-note-enregistrer').click();
  await pc.getByTestId('journal-humeur-4').click();
  await pc.getByTestId('journal-epingler').click();
  verifier(/épinglée/.test(await texteDe(pc, 'journal-epingler')), 'journée épinglée');
  await capture(pc, '04-pc-note-humeur');
  await retourHub(pc);
  await ouvrirApp(pc, 'journal', 'app-journal');
  verifier((await pc.getByTestId('journal-note').inputValue()) === NOTE, 'la note est conservée en quittant et en revenant');
  const attrsHumeur = await pc.getByTestId('journal-humeur-4').evaluate(el => ({ coche: el.getAttribute('aria-checked'), fond: getComputedStyle(el).backgroundColor }));
  const autre = await pc.getByTestId('journal-humeur-2').evaluate(el => getComputedStyle(el).backgroundColor);
  verifier(attrsHumeur.coche === 'true' && attrsHumeur.fond !== autre, `l’humeur est conservée (${JSON.stringify(attrsHumeur)} contre ${autre})`);

  // Navigation par jour.
  await pc.getByTestId('journal-precedent').click();
  verifier(await present(pc, 'journal-vide'), 'hier : pas de page (le journal ne remonte pas avant son activation)');
  verifier((await pc.getByTestId('journal-suivant').isEnabled()), 'jour suivant disponible');
  await pc.getByTestId('journal-aujourdhui').click();
  verifier(await present(pc, 'journal-texte'), 'retour à aujourd’hui');

  // Semaine, mois, calendrier, recherche.
  await pc.getByTestId('journal-onglet-semaine').click();
  verifier(await present(pc, 'journal-recap') && /1 page/.test(await texteDe(pc, 'journal-recap')), 'récap de la semaine généré (1 page)');
  await capture(pc, '05-pc-semaine');
  await pc.getByTestId('journal-onglet-mois').click();
  verifier(await present(pc, 'journal-recap') && (await pc.locator('[data-testid^="journal-epinglee-"]').count()) === 1, 'récap du mois, journée épinglée listée');
  await capture(pc, '06-pc-mois');
  await pc.getByTestId('journal-onglet-calendrier').click();
  verifier(await present(pc, 'journal-calendrier') && (await pc.locator('[data-testid^="journal-cellule-"]').count()) >= 28, 'calendrier du mois');
  await capture(pc, '07-pc-calendrier');
  await pc.getByTestId('journal-onglet-recherche').click();
  await pc.getByTestId('journal-recherche-champ').fill('NOTAIRE');
  verifier(/1 page trouvée/.test(await texteDe(pc, 'journal-recherche-compte')), 'recherche « notaire » (note, sans casse) : 1 page');
  await pc.getByTestId('journal-recherche-champ').fill('contrat atelier');
  verifier(/1 page trouvée/.test(await texteDe(pc, 'journal-recherche-compte')), 'recherche « contrat atelier » : 1 page');
  await capture(pc, '08-pc-recherche');
  await pc.locator('[data-testid^="journal-resultat-"]').first().click();
  verifier(await present(pc, 'journal-texte'), 'un résultat ouvre la page du jour');

  // Réglage de l'heure (l'app reste montée dans son onglet : le panneau est peut-être déjà ouvert).
  if (!(await pc.getByTestId('journal-heure').count())) await pc.getByTestId('journal-reglages-ouvrir').click();
  await pc.getByTestId('journal-heure-moins').click();
  verifier(/20 h/.test(await texteDe(pc, 'journal-heure')), 'heure réglée à 20 h');
  await pc.getByTestId('journal-heure-plus').click();

  // Exports.
  log('Exports : Markdown et PDF');
  await pc.getByTestId('journal-reglages-ouvrir').click();
  verifier((await pc.getByTestId('journal-heure').count()) === 0, 'panneau des réglages refermé');
  const [telechargement] = await Promise.all([pc.waitForEvent('download', { timeout: 20_000 }).catch(() => undefined), pc.getByTestId('journal-exporter-md').click()]);
  if (telechargement) {
    const md = readFileSync(await telechargement.path(), 'utf8');
    verifier(/^# .* \d{4}/.test(md) && md.includes('Relire le contrat Atelier Lune') && md.includes(NOTE) && md.includes('## Chiffres clés'), `export Markdown complet (${telechargement.suggestedFilename()})`);
  } else verifier(false, 'export Markdown : aucun téléchargement');
  await pc.getByTestId('journal-exporter-pdf').click();
  const cadre = await pc.locator('iframe[data-testid="journal-cadre-impression"]').first().waitFor({ state: 'attached', timeout: 10_000 }).then(() => true, () => false);
  verifier(cadre, 'export PDF : document d’impression préparé (fenêtre d’impression du système)');
  if (cadre) {
    const srcdoc = await pc.locator('iframe[data-testid="journal-cadre-impression"]').first().getAttribute('srcdoc');
    verifier(srcdoc.includes(NOTE) && srcdoc.includes('page-break-after') && srcdoc.startsWith('<!doctype html>'), 'le document imprimable contient la page et la note');
  }

  // ---------------------------------------------------------------- Relais : aucune écriture du journal
  log('Relais : une rafale d’actions du journal ne coûte aucune écriture');
  await pause(6000);
  const avantRafale = ecrituresKv;
  await pc.getByTestId('journal-humeur-5').click();
  await pc.getByTestId('journal-humeur-3').click();
  await pc.getByTestId('journal-epingler').click();
  await pc.getByTestId('journal-epingler').click();
  await pc.getByTestId('journal-note').fill(`${NOTE} (relue)`);
  await pc.getByTestId('journal-note-enregistrer').click();
  await pc.getByTestId('journal-reecrire').click();
  await pc.getByTestId('journal-reecrire').click();
  await pc.getByTestId('journal-onglet-semaine').click();
  await pc.getByTestId('journal-onglet-calendrier').click();
  await pc.getByTestId('journal-onglet-jour').click();
  await pause(8000);
  verifier(ecrituresKv === avantRafale, `rafale (note, humeur, épingle, 2 réécritures, navigation) : ${ecrituresKv - avantRafale} écriture(s) sur le relais`);
  const tout = [...kv.values()].join('\n');
  verifier(!tout.includes('notaire') && !tout.includes('Atelier Lune') && !tout.includes('Relire le contrat') && !tout.includes('journal.'), 'aucun texte du journal ni nom de clé « journal » sur le relais');

  // ---------------------------------------------------------------- Amie : son propre journal
  log('Amie : un journal à elle, séparé de celui du Fondateur');
  await retourHub(pc);
  await allerPageAdministration(pc);
  await pc.locator('[data-testid="tuile-administration"]').first().click();
  await pc.getByTestId('app-administration').waitFor({ timeout: 20_000 });
  await pc.getByTestId('admin-onglet-utilisateurs').click();
  await pc.getByTestId('admin-nouveau').click();
  await pc.getByTestId('admin-nom').fill('Léa');
  await pc.getByTestId('admin-nouveau-informe').click();
  verifier((await pc.getByTestId('admin-nouveau-app-journal-complet').count()) === 1, 'Administration : le Journal est proposé comme app à ouvrir à un ami');
  await pc.getByTestId('admin-creer').click();
  await pc.getByTestId('admin-identifiants').waitFor({ timeout: 60_000 });
  // Relais version 9 : l'amie se connecte par son invitation (plus de code de connexion au site).
  const lienAmie = await lienInvitationDuPanneau(pc);
  await pc.getByTestId('admin-transmis').click().catch(() => undefined);
  await pc.getByTestId('admin-termine').click();
  const amie = await (await nouveauContexte(navigateur, options)).newPage();
  amie.on('pageerror', e => log('erreur page amie :', e.message));
  await accepterInvitationAmi(amie, lienAmie, SITE);
  await fermerPopups(amie);
  await pause(3000);
  verifier((await tuileApp(amie, 'journal').count()) >= 1, 'l’amie, à qui l’Administration ouvre les apps publiques, a la tuile Journal');
  await tuileApp(amie, 'journal').first().click();
  await amie.getByTestId('app-journal').waitFor({ timeout: 30_000 });
  await pause(1500);
  const corpsAmie = await amie.locator('body').innerText();
  verifier(!corpsAmie.includes('notaire') && !corpsAmie.includes('Atelier Lune') && !corpsAmie.includes('Relire le contrat'), 'rien du journal ni des tâches du Fondateur chez l’amie');
  verifier((await amie.getByTestId('journal-section-taches').count()) === 0 && (await amie.getByTestId('journal-note').inputValue().catch(() => '')) === '', 'le journal de l’amie est le sien : aucune section Tâches, note vide');
  verifier((await amie.getByTestId('journal-onglet-recherche').count()) === 1, 'l’amie a les mêmes outils de lecture');
  await amie.getByTestId('journal-onglet-recherche').click();
  await amie.getByTestId('journal-recherche-champ').fill('notaire');
  verifier(await present(amie, 'journal-recherche-vide', 5_000), 'la recherche de l’amie ne trouve rien du Fondateur');
  await capture(amie, '09-amie-journal');
  await amie.context().close();
  await retourHub(pc);

  // ---------------------------------------------------------------- iPad et iPhone, clair et sombre
  log('iPad, iPhone 390 × 844 : mesures et captures');
  await pc.setViewportSize({ width: 820, height: 1180 });
  await pause(800);
  await ouvrirApp(pc, 'journal', 'app-journal');
  await capture(pc, '10-ipad-page');
  const mi = await mesurer(pc);
  verifier(mi.debordementPage === 0, `iPad : aucun débordement horizontal (${mi.deborde.slice(0, 3).join(' ; ')})`);
  await pc.setViewportSize({ width: 390, height: 844 });
  await pause(1000);
  const vues = ['jour', 'semaine', 'mois', 'calendrier', 'recherche'];
  for (const vue of vues) {
    await pc.getByTestId(`journal-onglet-${vue}`).click();
    await pause(500);
    const m = await mesurer(pc);
    verifier(m.debordementPage === 0 && m.deborde.length === 0, `iPhone ${vue} : aucun débordement (${m.deborde.slice(0, 3).join(' ; ')})`);
    verifier(m.petitesCibles === 0, `iPhone ${vue} : cibles ≥ 44 px (${m.exemplesCibles.slice(0, 4).join(' ; ')})`);
    verifier(m.petitsTextes === 0, `iPhone ${vue} : textes ≥ 15 px (${m.exemplesPetits.slice(0, 4).join(' ; ')})`);
    await capture(pc, `11-iphone-${vue}`);
  }
  if (!(await pc.getByTestId('journal-heure').count())) await pc.getByTestId('journal-reglages-ouvrir').click();
  await pause(300);
  const mr = await mesurer(pc);
  verifier(mr.petitesCibles === 0 && mr.petitsTextes === 0, `iPhone réglages : cibles et textes (${[...mr.exemplesCibles, ...mr.exemplesPetits].slice(0, 4).join(' ; ')})`);
  await capture(pc, '12-iphone-reglages');
  await pc.getByTestId('journal-reglages-ouvrir').click();
  await pc.getByTestId('journal-onglet-jour').click();

  // Thème clair.
  await pc.setViewportSize({ width: 1440, height: 900 });
  await pause(600);
  await retourHub(pc);
  await changerTheme(pc, 'ivoire');
  await ouvrirApp(pc, 'journal', 'app-journal');
  await capture(pc, '13-pc-clair-page');
  await pc.getByTestId('journal-onglet-calendrier').click();
  await capture(pc, '14-pc-clair-calendrier');
  await pc.setViewportSize({ width: 390, height: 844 });
  await pause(800);
  await pc.getByTestId('journal-onglet-jour').click();
  const mc = await mesurer(pc);
  verifier(mc.debordementPage === 0 && mc.petitesCibles === 0 && mc.petitsTextes === 0, `iPhone (thème clair) : mesures (${[...mc.exemplesCibles, ...mc.exemplesPetits, ...mc.deborde].slice(0, 4).join(' ; ')})`);
  await capture(pc, '15-iphone-clair-page');
  verifier(erreursPage.length === 0, `aucune erreur de page (${erreursPage.slice(0, 2).join(' | ')})`);
} catch (erreur) {
  echecs++;
  console.log('  ECHEC', erreur instanceof Error ? erreur.message.split('\n').slice(0, 14).join('\n') : erreur);
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
