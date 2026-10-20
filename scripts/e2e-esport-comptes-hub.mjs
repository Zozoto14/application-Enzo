/**
 * Test de bout en bout : un compte du hub créé dans l'ADMINISTRATION (rang Ami,
 * accès à l'Esport), jamais ouvert dans l'Esport, apparaît dans Esport ›
 * Membres (« Jamais connecté · Sans team ») ; le Fondateur l'ajoute à une team
 * (pré-enregistrement, comme une invitation directe) ; le joueur ouvre ensuite
 * l'Esport sur son iPhone et voit directement sa team, sans code ni pseudo.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-esport-comptes-hub.mjs
 *
 * Variable : CAPTURES (dossier des captures, défaut docs/captures-esport-comptes-hub).
 */

import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { allerPageAdministration, allerPageApplications, nouveauContexte, tuileApp } from './e2e-acceptation.mjs';
import { chargerPlaywright, demarrerRelais, deverrouiller, optionsIphone, pause, premierLancement, racine, totp } from './mobile-outils.mjs';

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-esport-comptes-hub');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-esport-comptes-hub-012345';
const PORT_RELAIS = 8821;
const PORT_ESPORT = 8822;
const PORT_SITE = 5301;
const MDP = 'mot-de-passe-comptes-hub-e2e-tres-long-42';
const log = (...a) => console.log('[e2e-comptes-hub]', ...a);
let echecs = 0;
const verifier = (ok, message) => {
  console.log(ok ? '  OK   ' : '  ECHEC', message);
  if (!ok) echecs++;
};
const capture = async (page, nom) => {
  await pause(600);
  await page.screenshot({ path: join(CAPTURES, `${nom}.jpg`), type: 'jpeg', quality: 70 });
  log(`capture ${nom}`);
};

const { demarrerServeurEsport } = await import(pathToFileURL(join(racine, 'esport/outils/serveur-local.mjs')).href);

// ------------------------------------------------------------- Serveurs
const relais = await demarrerRelais(PORT_RELAIS, JETON);
const esport = await demarrerServeurEsport({ port: PORT_ESPORT, jetonDev: JETON });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff' };
function site(port) {
  const dist = join(racine, 'bureau/dist');
  if (!existsSync(join(dist, 'index.html'))) throw new Error('bureau/dist absent : lancez « npx vite build » d’abord');
  const serveur = http.createServer((req, res) => {
    const chemin = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    if (chemin === '/relais.json' || chemin === '/esport.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(chemin === '/relais.json' ? { relais: `https://localhost:${PORT_RELAIS}` } : { esport: esport.url }));
      return;
    }
    let fichier = join(dist, chemin);
    if (!existsSync(fichier) || statSync(fichier).isDirectory()) fichier = join(dist, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[extname(fichier)] ?? 'application/octet-stream' });
    createReadStream(fichier).pipe(res);
  });
  return new Promise(ok => serveur.listen(port, () => ok({ url: `http://localhost:${port}/`, fermer: () => serveur.close() })));
}
const leSite = await site(PORT_SITE);

async function api(chemin, jeton, { methode = 'GET', corps } = {}) {
  const r = await fetch(`${esport.url}${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
  const texte = await r.text();
  let lu = texte;
  try {
    lu = JSON.parse(texte);
  } catch {
    // texte (iCal)
  }
  return { statut: r.status, corps: lu };
}

async function fermerPopups(page) {
  for (let i = 0; i < 3; i++) {
    const clique = await page.getByText(/^(Fermer|Terminé|Compris|Plus tard)$/).first().click({ timeout: 2000 }).then(() => true, () => false);
    if (!clique) break;
  }
}

const pages = [];
async function compte(contexte, url, code, nom) {
  const page = await contexte.newPage();
  pages.push([nom, page]);
  page.on('pageerror', e => log(`erreur page (${nom}) :`, e.message));
  const secret = await premierLancement(page, { site: url, code, motDePasse: MDP });
  await page.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(page, MDP, secret));
  await fermerPopups(page);
  page.secret = secret;
  return page;
}

async function confirmerIdentite(page) {
  if (!(await page.getByTestId('admin-identite-mdp').waitFor({ timeout: 8_000 }).then(() => true, () => false))) return;
  for (const decalage of [0, 1, -1]) {
    await page.getByTestId('admin-identite-mdp').fill(MDP);
    await page.getByTestId('admin-identite-code').fill(totp(page.secret, decalage));
    await page.getByTestId('admin-identite-valider').click();
    if (await page.getByTestId('admin-identite').waitFor({ state: 'detached', timeout: 15_000 }).then(() => true, () => false)) return;
  }
  throw new Error('vérification d’identité impossible');
}

async function ouvrirEsport(page) {
  if (await page.getByTestId('app-esport').count()) await page.getByTestId('retour-hub').first().click();
  await allerPageApplications(page);
  const tuile = tuileApp(page, 'esport').first();
  await tuile.waitFor({ timeout: 30_000 });
  await tuile.click();
  await page.getByTestId('app-esport').waitFor({ timeout: 20_000 });
}

const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
try {
  // ================================================================ Préparation (API) : la team
  const sessFond = (await api('/session', JETON, { methode: 'POST' })).corps.session;
  await api('/moi', sessFond, { methode: 'PUT', corps: { pseudo: 'Fondateur' } });
  const team = (await api('/teams', sessFond, { methode: 'POST', corps: { nom: 'Faucons Valorant', jeu: 'valorant', preset: 'minimal' } })).corps;
  const teamId = team.team.id;
  const roles = (await api(`/teams/${teamId}/roles`, sessFond)).corps.roles;
  const joueur = roles.find(r => r.cle === 'joueur');

  // ================================================================ PC : compte de Luca dans l'Administration
  log('PC : Administration, compte Ami « Luca » avec accès à l’Esport');
  const ctxPc = await nouveauContexte(navigateur, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const pc = await compte(ctxPc, leSite.url, relais.code, 'PC');
  await allerPageAdministration(pc);
  await pc.locator('[data-testid="cellule-administration"], [data-testid="tuile-administration"]').first().click();
  await pc.getByTestId('app-administration').waitFor({ timeout: 20_000 });
  await confirmerIdentite(pc);
  await pc.getByTestId('admin-onglet-utilisateurs').click();
  await pc.getByTestId('admin-nouveau').click();
  await pc.getByTestId('admin-nom').fill('Luca');
  await pc.getByTestId('admin-nouveau-modele-esport').click();
  await pc.getByTestId('admin-nouveau-informe').click();
  await pc.getByTestId('admin-creer').click();
  await confirmerIdentite(pc);
  await pc.getByTestId('admin-invitation-lien').first().waitFor({ timeout: 90_000 });
  const lienLuca = (await pc.getByTestId('admin-invitation-lien').first().innerText()).trim();
  await pc.getByTestId('admin-transmis').click().catch(() => undefined);
  await pc.getByTestId('admin-termine').click();
  await pc.getByTestId('retour-hub').first().click();
  verifier(!(await esport.base.premier("SELECT id FROM comptes WHERE pseudo = 'Luca'", [])), 'Luca : aucune fiche Esport (jamais ouvert)');

  // ================================================================ PC : Esport › Membres
  log('PC : Esport › Membres, Luca visible « Sans team », ajout à Faucons Valorant');
  await ouvrirEsport(pc);
  const profilInitial = await pc.getByTestId('esport-profil-initial').waitFor({ timeout: 8_000 }).then(() => true, () => false);
  if (profilInitial) {
    await pc.getByTestId('esport-pseudo').fill('Fondateur');
    await pc.getByTestId('esport-pseudo-valider').click();
  }
  await pc.getByTestId('esport-nav-membres').click();
  await pc.getByTestId('esport-membres-global').waitFor({ timeout: 20_000 });
  const ligne = pc.locator('[data-testid^="esport-compte-"]').filter({ hasText: 'Luca' }).first();
  await ligne.waitFor({ timeout: 30_000 });
  const idLuca = (await ligne.getAttribute('data-testid')).replace('esport-compte-', '');
  verifier(/^[a-z0-9]{6,16}$/.test(idLuca), `Luca listé dans Membres (${idLuca})`);
  verifier((await pc.getByTestId(`esport-compte-statut-${idLuca}`).innerText()).includes('Jamais connecté'), 'statut « Jamais connecté »');
  verifier((await pc.getByTestId(`esport-compte-sans-team-${idLuca}`).count()) === 1, 'pastille « Sans team »');
  verifier(/2 comptes, dont 1 sans team/.test(await pc.getByTestId('esport-membres-entete').innerText()), 'en-tête : 2 comptes, dont 1 sans team');
  await pc.getByTestId('esport-membres-statut-sansteam').click();
  verifier((await pc.getByTestId('esport-compte-principal').count()) === 0 && (await pc.getByTestId(`esport-compte-${idLuca}`).count()) === 1, 'filtre « Sans team » : Luca seulement');
  await capture(pc, '01-pc-membres-sans-team');
  await pc.getByLabel('Gérer Luca').click();
  await pc.getByTestId(`esport-ajout-team-${idLuca}-${teamId}`).click();
  await pc.getByTestId(`esport-ajout-role-${idLuca}-${joueur.id}`).click();
  await pc.getByTestId(`esport-ajout-valider-${idLuca}`).click();
  await pc.getByTestId('esport-membres-global-avis').waitFor({ timeout: 20_000 });
  verifier(/Luca est ajouté à Faucons Valorant/.test(await pc.getByTestId('esport-membres-global-avis').innerText()), 'Luca ajouté à Faucons Valorant');
  const fiche = await esport.base.premier('SELECT id, invite_le, active_le FROM comptes WHERE id = ?', [idLuca]);
  verifier(Boolean(fiche?.invite_le) && !fiche?.active_le, 'pré-enregistrement côté serveur : statut invité');
  const membre = await esport.base.premier('SELECT role_id FROM membres WHERE compte_id = ? AND team_id = ?', [idLuca, teamId]);
  verifier(membre?.role_id === joueur.id, 'membre de Faucons Valorant (Joueur)');
  await pc.getByTestId('esport-membres-statut-tous').click();
  await capture(pc, '02-pc-membres-ajoute');

  // ================================================================ iPhone : Luca ouvre l'Esport
  log('iPhone : Luca ouvre son invitation, puis l’Esport : sa team est là, sans code');
  const ctxLuca = await nouveauContexte(navigateur, optionsIphone());
  const luca = await ctxLuca.newPage();
  pages.push(['Luca', luca]);
  luca.on('pageerror', e => log('erreur page (Luca) :', e.message));
  await luca.goto(lienLuca.replace(/^https?:\/\/[^/]+\//, leSite.url));
  await luca.getByTestId('invitation-mdp').waitFor({ timeout: 60_000 });
  await luca.getByTestId('invitation-mdp').fill('Été à Biarritz 2026 !');
  await luca.getByTestId('invitation-mdp-confirmation').fill('Été à Biarritz 2026 !');
  await luca.getByTestId('invitation-valider').click();
  await luca.getByTestId('hub').waitFor({ timeout: 90_000 });
  await fermerPopups(luca);
  await ouvrirEsport(luca);
  await luca.getByTestId('esport-dashboard').waitFor({ timeout: 30_000 });
  verifier((await luca.getByTestId('esport-profil-initial').count()) === 0, 'Luca : pas d’écran de pseudo (déjà pré-enregistré)');
  await luca.getByTestId('esport-nav-teams').click();
  await luca.getByTestId('esport-team-faucons-valorant').waitFor({ timeout: 20_000 });
  verifier((await luca.getByTestId('esport-code').count()) === 0, 'Luca : aucun code demandé');
  await capture(luca, '03-iphone-luca-teams');
  await luca.getByTestId('esport-team-faucons-valorant').click();
  await luca.getByTestId('esport-barre').waitFor({ timeout: 20_000 });
  verifier(true, 'Luca ouvre sa team');
  const active = await esport.base.premier('SELECT active_le FROM comptes WHERE id = ?', [idLuca]);
  verifier(Boolean(active?.active_le), 'première session : invité → actif');
  await capture(luca, '04-iphone-luca-team');
} catch (e) {
  echecs++;
  console.error(e);
  for (const [nom, page] of pages) await page.screenshot({ path: join(CAPTURES, `echec-${nom}.jpg`), type: 'jpeg', quality: 60 }).catch(() => undefined);
} finally {
  await navigateur.close();
  leSite.fermer();
  relais.fermer();
  await esport.fermer();
}
console.log(echecs === 0 ? 'e2e comptes du hub (Esport) : tout est bon' : `e2e comptes du hub (Esport) : ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
