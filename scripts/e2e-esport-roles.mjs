/**
 * Test de bout en bout : modifier les permissions d'un rôle existant (Esport › team › Équipe ›
 * Membres et rôles), sans Cloudflare ni réseau réel (faux relais, serveur Esport local).
 *
 *  - PC (1440 × 900), le Fondateur : team « Faucons Valorant » (API) ; compte du hub « Zed »
 *    (modèle « Esport seulement », Administration) ajouté à la team en Coach ;
 *  - second PC, Zed (Coach) : onglet Strats, le bouton « Nouvelle strat » est là ;
 *  - Fondateur : matrice du rôle Coach, « Modifier les permissions », décoche « Strats : Créer »
 *    (case surlignée, « 1 changement non enregistré »), Enregistrer → confirmation (rôle système) ;
 *  - Zed : plus de bouton « Nouvelle strat », et l'API répond 403 ; Journal du Fondateur ;
 *  - Fondateur : « Rétablir les permissions par défaut » → Zed retrouve le bouton, l'API répond 200.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-esport-roles.mjs
 *
 * Variable : CAPTURES (dossier des captures, défaut docs/captures-esport-roles).
 */

import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ongletTeam } from './esport-navigation.mjs';
import { allerPageAdministration, allerPageApplications, nouveauContexte, tuileApp } from './e2e-acceptation.mjs';
import { chargerPlaywright, demarrerRelais, deverrouiller, pause, premierLancement, racine, totp } from './mobile-outils.mjs';

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-esport-roles');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-esport-roles-0123456789abcd';
const PORT_RELAIS = 8851;
const PORT_ESPORT = 8852;
const PORT_SITE = 5301;
const MDP = 'mot-de-passe-esport-e2e-tres-long-42';
const MDP_ZED = 'Coach Zed à Lyon 2026 !';
const ASCENT = { cle: 'ascent', nom: 'Ascent', image: 'https://media.valorant-api.com/maps/7eaecc1b/displayicon.png' };
const log = (...a) => console.log('[e2e-esport-roles]', ...a);
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

const { jetonDeProfil } = await import(pathToFileURL(join(racine, 'relais/worker.mjs')).href);
const { demarrerServeurEsport } = await import(pathToFileURL(join(racine, 'esport/outils/serveur-local.mjs')).href);

// ------------------------------------------------------------- Serveurs
const relais = await demarrerRelais(PORT_RELAIS, JETON);
const esport = await demarrerServeurEsport({ port: PORT_ESPORT, jetonDev: JETON });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const dist = join(racine, 'bureau/dist');
if (!existsSync(join(dist, 'index.html'))) throw new Error('bureau/dist absent : lancez « npx vite build » d’abord');
const serveurSite = http.createServer((req, res) => {
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
await new Promise(ok => serveurSite.listen(PORT_SITE, ok));
const SITE = `http://localhost:${PORT_SITE}/`;

async function fermerPopups(page) {
  for (let i = 0; i < 3; i++) {
    const clique = await page.getByText(/^(Fermer|Terminé|Compris|Plus tard)$/).first().click({ timeout: 2000 }).then(() => true, () => false);
    if (!clique) break;
  }
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

/** (Ré)ouvre la team « Faucons Valorant » depuis le hub (permissions relues), puis une section. */
async function allerSection(page, id) {
  await ouvrirEsport(page);
  if (!(await page.getByTestId('esport-team').isVisible().catch(() => false))) {
    await page.getByTestId('esport-nav-teams').click().catch(() => undefined);
    await page.getByTestId('esport-team-faucons-valorant').waitFor({ timeout: 30_000 });
    await page.getByTestId('esport-team-faucons-valorant').click();
  }
  await ongletTeam(page, id);
}

async function api(chemin, jeton, { methode = 'GET', corps } = {}) {
  const r = await fetch(`${esport.url}${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}

const pages = [];
const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
try {
  // ================================================================ PC : le Fondateur
  log('PC : coffre du Fondateur, profil Esport, team « Faucons Valorant » (API)');
  const ctxPc = await nouveauContexte(navigateur, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const pc = await ctxPc.newPage();
  pages.push(['PC', pc]);
  pc.on('pageerror', e => log('erreur page (PC) :', e.message));
  pc.secret = await premierLancement(pc, { site: SITE, code: relais.code, motDePasse: MDP });
  await pc.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(pc, MDP, pc.secret));
  await fermerPopups(pc);
  const sessFond = (await api('/session', JETON, { methode: 'POST' })).corps.session;
  await api('/moi', sessFond, { methode: 'PUT', corps: { pseudo: 'Fondateur' } });
  const faucons = (await api('/teams', sessFond, { methode: 'POST', corps: { nom: 'Faucons Valorant', jeu: 'valorant', preset: 'valorant_complet' } })).corps.team;
  verifier(Boolean(faucons?.id), 'team « Faucons Valorant » prête');

  log('PC : Administration, compte « Zed » (Esport seulement)');
  await allerPageAdministration(pc);
  await pc.locator('[data-testid="cellule-administration"], [data-testid="tuile-administration"]').first().click();
  await pc.getByTestId('app-administration').waitFor({ timeout: 20_000 });
  await confirmerIdentite(pc);
  await pc.getByTestId('admin-onglet-utilisateurs').click();
  await pc.getByTestId('admin-nouveau').click();
  await pc.getByTestId('admin-nom').fill('Zed');
  await pc.getByTestId('admin-nouveau-modele-esport').click();
  await pc.getByTestId('admin-nouveau-informe').click();
  await pc.getByTestId('admin-creer').click();
  await confirmerIdentite(pc);
  await pc.getByTestId('admin-invitation-lien').first().waitFor({ timeout: 90_000 });
  const lienZed = (await pc.getByTestId('admin-invitation-lien').first().innerText()).trim();
  await pc.getByTestId('admin-transmis').click().catch(() => undefined);
  await pc.getByTestId('admin-termine').click();
  await pc.getByTestId('retour-hub').first().click();

  // ================================================================ Zed : son compte, pseudo, ajouté en Coach
  log('Second PC : Zed ouvre son invitation, choisit son pseudo');
  const ctxZed = await nouveauContexte(navigateur, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const zed = await ctxZed.newPage();
  pages.push(['Zed', zed]);
  zed.on('pageerror', e => log('erreur page (Zed) :', e.message));
  await zed.goto(lienZed.replace(/^https?:\/\/[^/]+\//, SITE));
  await zed.getByTestId('invitation-mdp').waitFor({ timeout: 60_000 });
  await zed.getByTestId('invitation-mdp').fill(MDP_ZED);
  await zed.getByTestId('invitation-mdp-confirmation').fill(MDP_ZED);
  await zed.getByTestId('invitation-valider').click();
  await zed.getByTestId('hub').waitFor({ timeout: 90_000 });
  await fermerPopups(zed);
  await ouvrirEsport(zed);
  await zed.getByTestId('esport-profil-initial').waitFor({ timeout: 30_000 });
  await zed.getByTestId('esport-pseudo').fill('Zed');
  await zed.getByTestId('esport-pseudo-valider').click();
  await zed.getByTestId('esport-dashboard-vide').waitFor({ timeout: 20_000 });

  const idZed = (await esport.base.premier("SELECT id FROM comptes WHERE pseudo = 'Zed'", [])).id;
  const roles = Object.fromEntries((await api(`/teams/${faucons.id}/roles`, sessFond)).corps.roles.map(r => [r.cle ?? r.nom, r]));
  const ajout = await api(`/teams/${faucons.id}/membres`, sessFond, { methode: 'POST', corps: { compte: idZed, roleId: roles.coach.id } });
  verifier(ajout.statut === 200, `Zed ajouté à Faucons Valorant en Coach (${ajout.statut})`);
  const sessZed = (await api('/session', await jetonDeProfil(JETON, idZed), { methode: 'POST' })).corps.session;
  const creerStrat = () => api(`/teams/${faucons.id}/strats`, sessZed, { methode: 'POST', corps: { titre: 'Exec B', type: 'execute', carte: ASCENT, side: 'attaque' } });

  log('Zed : onglet Strats, le bouton « Nouvelle strat » est là');
  await allerSection(zed, 'module-strat_editor');
  verifier((await zed.getByTestId('esport-strats-nouvelle').count()) === 1, 'Coach : bouton « Nouvelle strat » visible');
  await capture(zed, '01-coach-strats-avant');

  // ================================================================ Fondateur : matrice du Coach
  log('PC : Membres et rôles › Coach › Modifier les permissions › décocher « Strats : Créer »');
  await allerSection(pc, 'membres');
  await pc.getByTestId('esport-matrice').waitFor({ timeout: 20_000 });
  await pc.getByTestId(`esport-role-choisi-${roles.coach.id}`).click();
  verifier(/permissions par défaut/.test(await pc.getByTestId('esport-role-description').innerText()), 'Coach : « permissions par défaut »');
  await pc.getByTestId('esport-role-modifier').click();
  await pc.getByTestId('esport-perm-strats.create').click();
  verifier((await pc.getByTestId('esport-perm-changee-strats.create').count()) === 1, 'case « Strats : Créer » surlignée (non enregistrée)');
  verifier(/1 changement non enregistré/.test(await pc.getByTestId('esport-role-changements').innerText()), '« 1 changement non enregistré »');
  await pc.getByTestId('esport-perm-changee-strats.create').scrollIntoViewIfNeeded();
  await capture(pc, '02-fondateur-matrice-modifiee');
  await pc.getByTestId('esport-role-enregistrer').click();
  await pc.getByTestId('esport-role-confirmation').waitFor({ timeout: 10_000 });
  verifier(/rôle système/.test(await pc.getByTestId('esport-role-confirmation').innerText()), 'confirmation demandée pour un rôle système');
  await capture(pc, '03-fondateur-confirmation');
  await pc.getByTestId('esport-role-enregistrer-confirmer').click();
  await pc.getByTestId('esport-roles-avis').waitFor({ timeout: 20_000 });
  verifier(/modifiées pour cette team/.test(await pc.getByTestId('esport-role-description').innerText()), 'Coach : « permissions modifiées pour cette team »');
  await capture(pc, '04-fondateur-enregistre');

  log('Zed : plus de bouton, et 403 côté serveur');
  await allerSection(zed, 'module-strat_editor');
  await pause(800);
  verifier((await zed.getByTestId('esport-strats-nouvelle').count()) === 0, 'Coach : plus de bouton « Nouvelle strat »');
  const refus = await creerStrat();
  verifier(refus.statut === 403 && refus.corps?.code === 'permission', `Coach : création de strat refusée par le serveur (${refus.statut})`);
  await capture(zed, '05-coach-strats-apres');

  log('PC : Journal');
  await allerSection(pc, 'journal');
  const journal = await pc.getByTestId('esport-contenu-journal').first().innerText();
  verifier(/a modifié les permissions du rôle Coach : retrait de Strats/.test(journal), 'Journal : « … a modifié les permissions du rôle Coach : retrait de Strats … »');
  await capture(pc, '06-fondateur-journal');

  log('PC : Rétablir les permissions par défaut');
  await allerSection(pc, 'membres');
  await pc.getByTestId(`esport-role-choisi-${roles.coach.id}`).click();
  await pc.getByTestId('esport-role-retablir').click();
  await pc.getByTestId('esport-role-retablir-confirmer').click();
  await pc.getByTestId('esport-roles-avis').waitFor({ timeout: 20_000 });
  verifier(/permissions par défaut/.test(await pc.getByTestId('esport-role-description').innerText()), 'Coach : de nouveau « permissions par défaut »');
  await capture(pc, '07-fondateur-retabli');

  await allerSection(zed, 'module-strat_editor');
  await zed.getByTestId('esport-strats-nouvelle').waitFor({ timeout: 20_000 }).catch(() => undefined);
  verifier((await zed.getByTestId('esport-strats-nouvelle').count()) === 1, 'Coach : bouton « Nouvelle strat » revenu');
  verifier((await creerStrat()).statut === 200, 'Coach : création de strat acceptée par le serveur');
  await capture(zed, '08-coach-strats-retabli');
} catch (e) {
  echecs++;
  console.error(e);
  for (const [nom, page] of pages) await page.screenshot({ path: join(CAPTURES, `echec-${nom}.jpg`), type: 'jpeg', quality: 60 }).catch(() => undefined);
} finally {
  await navigateur.close();
  serveurSite.close();
  relais.fermer();
  await esport.fermer();
}
console.log(echecs === 0 ? 'e2e rôles Esport : tout est bon' : `e2e rôles Esport : ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
