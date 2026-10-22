/**
 * Test de bout en bout de l'Esport (phase 1) :
 *
 *  - faux relais (le vrai relais/relais.mjs, version 7) et serveur Esport local (esport/outils/
 *    serveur-local.mjs : même API que le serveur o2switch, base SQLite en mémoire) ;
 *  - PC (1440 × 900), le Fondateur : tuile Esport (Dashboard · Teams · Membres), pseudo, assistant
 *    de création en 3 étapes, seconde team « Team B » ;
 *  - Léa a un compte « Esport seulement » créé dans l'Administration (avant l'invitation directe) :
 *    le Fondateur l'ajoute à sa team depuis Esport › Membres (« Ajouter à une team »), sans code ;
 *  - iPhone (390 × 844), Léa (son propre compte : jeton de profil) : pseudo, la team est déjà là,
 *    page de la team limitée à son rôle (pas de Journal, pas d'invitation) ; accès restreint vérifié
 *    côté serveur (la Team B répond 404) ;
 *  - retour au Fondateur : Journal (« Léa a rejoint la team (Joueur) »), matrice des rôles ;
 *  - iPad (1024 × 1366) : rendu de la page de la team ;
 *  - serveur Esport absent : « Esport pas encore activé », le reste de l'app marche.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-esport.mjs
 *
 * Variable : CAPTURES (dossier des captures, défaut docs/captures-esport).
 */

import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ongletPresent, ongletTeam } from './esport-navigation.mjs';
import { allerPageAdministration, allerPageApplications, nouveauContexte, tuileApp } from './e2e-acceptation.mjs';
import { demarrerFrontalRestrictif } from './frontal-restrictif.mjs';
import { chargerPlaywright, connecterAppareilFondateur, demarrerRelais, deverrouiller, optionsIphone, pause, premierLancement, racine, totp } from './mobile-outils.mjs';

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-esport');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-esport-0123456789abcdef';
const PORT_RELAIS = 8801;
const PORT_ESPORT = 8802;
const PORT_SITE = 5281;
const PORT_SITE_SANS = 5282;
const MDP = 'mot-de-passe-esport-e2e-tres-long-42';
const log = (...a) => console.log('[e2e-esport]', ...a);
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

const { jetonDeProfil } = await import(pathToFileURL(join(racine, 'relais/relais.mjs')).href);
const { demarrerServeurEsport } = await import(pathToFileURL(join(racine, 'esport/outils/serveur-local.mjs')).href);

// ------------------------------------------------------------- Serveurs
const relais = await demarrerRelais(PORT_RELAIS, JETON);
// Le serveur Esport valide les jetons avec le MÊME jeton maître (relais de développement en mémoire).
const esport = await demarrerServeurEsport({ port: PORT_ESPORT, jetonDev: JETON });
// L'app passe par un faux frontal o2switch qui refuse PATCH, PUT et DELETE (POST + X-Methode).
const frontal = await demarrerFrontalRestrictif({ cible: esport.url, port: PORT_ESPORT + 100 });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff' };
function site(port, avecEsport) {
  const dist = join(racine, 'bureau/dist');
  if (!existsSync(join(dist, 'index.html'))) throw new Error('bureau/dist absent : lancez « npx vite build » d’abord');
  const serveur = http.createServer((req, res) => {
    const chemin = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    if (chemin === '/relais.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ relais: `https://localhost:${PORT_RELAIS}` }));
      return;
    }
    if (chemin === '/esport.json') {
      if (!avecEsport) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('absent');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ esport: frontal.url }));
      return;
    }
    let fichier = join(dist, chemin);
    if (!existsSync(fichier) || statSync(fichier).isDirectory()) fichier = join(dist, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[extname(fichier)] ?? 'application/octet-stream' });
    createReadStream(fichier).pipe(res);
  });
  return new Promise(ok => serveur.listen(port, () => ok({ url: `http://localhost:${port}/`, fermer: () => serveur.close() })));
}
const siteAvec = await site(PORT_SITE, true);
const siteSans = await site(PORT_SITE_SANS, false);

async function fermerPopups(page) {
  for (let i = 0; i < 3; i++) {
    const clique = await page.getByText(/^(Fermer|Terminé|Compris|Plus tard)$/).first().click({ timeout: 2000 }).then(() => true, () => false);
    if (!clique) break;
  }
}

const pages = [];
async function compte(contexte, url, code, nom, fondateur) {
  const page = await contexte.newPage();
  pages.push([nom, page]);
  page.on('pageerror', e => log(`erreur page (${nom}) :`, e.message));
  // Autre appareil du Fondateur : SON coffre, relu sur le serveur (Léa arrivée : écran prénom d'abord).
  const secret = fondateur
    ? await connecterAppareilFondateur(page, { site: url, code, motDePasse: MDP, secret: fondateur.secret })
    : await premierLancement(page, { site: url, code, motDePasse: MDP });
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
  // Déjà dans une app (l'Esport) : retour au hub d'abord.
  if (await page.getByTestId('app-esport').count()) await page.getByTestId('retour-hub').first().click();
  await allerPageApplications(page);
  const tuile = tuileApp(page, 'esport').first();
  await tuile.waitFor({ timeout: 30_000 });
  await tuile.click();
  await page.getByTestId('app-esport').waitFor({ timeout: 20_000 });
  // L'onglet de l'app garde sa page : on repart de la liste des teams.
  // (Premier passage : écran du pseudo, sans navigation.)
  const nav = page.getByTestId('esport-nav-teams');
  if (await nav.waitFor({ timeout: 8_000 }).then(() => true, () => false)) await nav.click();
}

async function api(chemin, jeton, { methode = 'GET', corps } = {}) {
  const r = await fetch(`${esport.url}${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}

const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
try {
  // ================================================================ PC : le Fondateur
  log('PC : coffre du Fondateur, relié au relais (jeton maître)');
  const ctxPc = await nouveauContexte(navigateur, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const pc = await compte(ctxPc, siteAvec.url, relais.code, 'PC');
  await ouvrirEsport(pc);
  await pc.getByTestId('esport-profil-initial').waitFor({ timeout: 30_000 });
  verifier((await pc.getByTestId('esport-mention').innerText()).includes('en clair sur le serveur'), 'mention : données Esport en clair côté serveur');
  await pc.getByTestId('esport-pseudo').fill('Fondateur');
  await pc.getByTestId('esport-pseudo-valider').click();
  await pc.getByTestId('esport-dashboard').waitFor({ timeout: 20_000 });
  verifier((await pc.getByTestId('esport-nav-dashboard').count()) === 1 && (await pc.getByTestId('esport-nav-membres').count()) === 1, 'navigation de premier niveau : Dashboard · Teams · Membres');
  await pc.getByTestId('esport-nav-teams').click();
  await pc.getByTestId('esport-teams').waitFor({ timeout: 20_000 });
  verifier((await pc.getByTestId('esport-rejoindre').count()) === 0, 'plus de « Rejoindre une team avec un code »');
  await capture(pc, '01-pc-teams-vide');

  log('PC : assistant de création (3 étapes)');
  await pc.getByTestId('esport-creer').click();
  await pc.getByTestId('esport-assistant-nom').fill('Faucons Valorant');
  await pc.getByTestId('esport-assistant-description').fill('Team principale, Ascendant.');
  await capture(pc, '02-pc-assistant-1');
  await pc.getByTestId('esport-assistant-suivant').click();
  await pc.getByTestId('esport-assistant-preset-valorant_complet').click();
  await capture(pc, '03-pc-assistant-2');
  await pc.getByTestId('esport-assistant-suivant').click();
  // Personnalisé : on retire le Scouting.
  await pc.getByTestId('esport-assistant-module-scouting').click();
  await capture(pc, '04-pc-assistant-3');
  await pc.getByTestId('esport-assistant-creer').click();
  await pc.getByTestId('esport-team').waitFor({ timeout: 20_000 });
  await pc.getByTestId('esport-membres').waitFor({ timeout: 20_000 });
  verifier(!(await ongletPresent(pc, 'module-scouting')), 'barre latérale : le module désactivé (Scouting) n’apparaît pas');
  verifier((await ongletPresent(pc, 'module-planning')), 'barre latérale : Planning activé (écran livré en phase 2)');
  verifier((await ongletPresent(pc, 'journal')), 'barre latérale : Journal');
  // Retour sur Membres et rôles (section Équipe), où l'assistant avait ouvert la team.
  await ongletTeam(pc, 'membres');

  verifier((await pc.getByTestId('esport-invitation-creer').count()) === 0, 'plus de création de code esp_ dans la team');
  verifier((await pc.getByTestId('esport-inviter').count()) === 1, 'Membres et rôles : renvoi vers la page Membres pour inviter');
  await capture(pc, '05-pc-membres-team');

  log('PC : une seconde team, sans Léa');
  await pc.getByTestId('esport-team-retour').first().click();
  await pc.getByTestId('esport-creer').click();
  await pc.getByTestId('esport-assistant-nom').fill('Team B');
  await pc.getByTestId('esport-assistant-suivant').click();
  await pc.getByTestId('esport-assistant-preset-minimal').click();
  await pc.getByTestId('esport-assistant-suivant').click();
  await pc.getByTestId('esport-assistant-creer').click();
  await pc.getByTestId('esport-team').waitFor({ timeout: 20_000 });
  await pc.getByTestId('esport-team-retour').first().click();
  await pc.getByTestId('esport-team-team-b').waitFor({ timeout: 20_000 });
  await capture(pc, '06-pc-deux-teams');

  // ================================================================ Administration : compte « Esport seulement »
  log('PC : Administration, compte de Léa avec le modèle « Esport seulement »');
  await pc.getByTestId('retour-hub').first().click();
  await allerPageAdministration(pc);
  await pc.locator('[data-testid="cellule-administration"], [data-testid="tuile-administration"]').first().click();
  await pc.getByTestId('app-administration').waitFor({ timeout: 20_000 });
  await confirmerIdentite(pc);
  await pc.getByTestId('admin-onglet-utilisateurs').click();
  await pc.getByTestId('admin-nouveau').click();
  await pc.getByTestId('admin-nom').fill('Léa');
  await pc.getByTestId('admin-nouveau-modele-esport').click();
  await pc.getByTestId('admin-nouveau-informe').click();
  await capture(pc, '07-pc-admin-modele-esport');
  await pc.getByTestId('admin-creer').click();
  await confirmerIdentite(pc);
  await pc.getByTestId('admin-identifiants').waitFor({ timeout: 90_000 });
  await pc.getByTestId('admin-invitation-lien').first().waitFor({ timeout: 90_000 });
  const lienLea = (await pc.getByTestId('admin-invitation-lien').first().innerText()).trim();
  await pc.getByTestId('admin-transmis').click().catch(() => undefined);
  await pc.getByTestId('admin-termine').click();
  const badges = pc.locator('[data-testid^="admin-esport-"]');
  await badges.first().waitFor({ timeout: 20_000 }).catch(() => undefined);
  verifier((await badges.count()) === 1, 'Administration : badge « Esport » sur le compte de Léa');
  await capture(pc, '08-pc-admin-badge-esport');
  await pc.getByTestId('retour-hub').first().click();

  // ================================================================ iPhone : Léa (son compte du hub)
  log('iPhone neuf : Léa ouvre son invitation du hub');
  const ctxLea = await nouveauContexte(navigateur, optionsIphone());
  const lea = await ctxLea.newPage();
  pages.push(['Léa', lea]);
  lea.on('pageerror', e => log('erreur page (Léa) :', e.message));
  await lea.goto(lienLea.replace(/^https?:\/\/[^/]+\//, siteAvec.url));
  await lea.getByTestId('invitation-mdp').waitFor({ timeout: 60_000 });
  await lea.getByTestId('invitation-mdp').fill('Été à Biarritz 2026 !');
  await lea.getByTestId('invitation-mdp-confirmation').fill('Été à Biarritz 2026 !');
  await lea.getByTestId('invitation-valider').click();
  await lea.getByTestId('hub').waitFor({ timeout: 90_000 });
  await fermerPopups(lea);
  await tuileApp(lea, 'esport').first().waitFor({ timeout: 30_000 });
  const tuiles = await lea.locator('[data-testid^="cellule-"], [data-testid^="tuile-"]').evaluateAll(els => [...new Set(els.map(e => e.getAttribute('data-testid').replace(/^(cellule|tuile)-/, '')))]);
  verifier(JSON.stringify(tuiles.filter(t => !/-/.test(t))) === JSON.stringify(['esport']), `hub de Léa : seulement l’Esport (${tuiles.join(', ')})`);
  verifier((await lea.locator('[data-testid="hub-page-administration"], [data-testid="barre-basse-administration"]').count()) === 0, 'hub de Léa : pas de page Administration');
  await capture(lea, '09-iphone-lea-hub');
  await ouvrirEsport(lea);
  await lea.getByTestId('esport-profil-initial').waitFor({ timeout: 30_000 });
  await lea.getByTestId('esport-pseudo').fill('Léa');
  await lea.getByTestId('esport-riot').fill('Lea#EUW');
  await lea.getByTestId('esport-pseudo-valider').click();
  await lea.getByTestId('esport-dashboard-vide').waitFor({ timeout: 20_000 });
  verifier(true, 'Léa, sans team : Dashboard vide (aucun code demandé)');

  // ================================================================ PC : Esport › Membres › « Ajouter à une team » (compte existant)
  log('PC : Esport › Membres, ajout du compte existant de Léa à Faucons Valorant (Joueur)');
  await ouvrirEsport(pc);
  await pc.getByTestId('esport-nav-membres').click();
  await pc.getByTestId('esport-membres-global').waitFor({ timeout: 20_000 });
  const idLea = (await esport.base.premier("SELECT id FROM comptes WHERE pseudo = 'Léa'", [])).id;
  await pc.getByTestId(`esport-compte-${idLea}`).waitFor({ timeout: 20_000 });
  await pc.getByLabel('Gérer Léa').click();
  await pc.getByTestId(`esport-ajout-team-${idLea}-faucons-valorant`).click();
  await pc.getByTestId(`esport-ajout-poste-${idLea}-faucons-valorant`).fill('Duelliste');
  await capture(pc, '10-pc-membres-ajout');
  await pc.getByTestId(`esport-ajout-valider-${idLea}`).click();
  await pc.getByTestId('esport-membres-global-avis').waitFor({ timeout: 20_000 });
  verifier(/Léa est ajouté à Faucons Valorant/.test(await pc.getByTestId('esport-membres-global-avis').innerText()), 'Membres : Léa ajoutée à Faucons Valorant');

  log('iPhone : la team de Léa apparaît, sans code');
  await lea.getByTestId('esport-nav-teams').click();
  await lea.getByTestId('esport-teams').waitFor({ timeout: 20_000 });
  verifier((await lea.getByTestId('esport-creer').count()) === 0, 'Léa : pas de bouton « Créer une team » (réservé au Fondateur)');
  verifier((await lea.getByTestId('esport-code').count()) === 0, 'Léa : aucun champ de code');
  await lea.getByTestId('esport-team-faucons-valorant').waitFor({ timeout: 20_000 });
  verifier((await lea.getByTestId('esport-team-team-b').count()) === 0, 'Léa ne voit pas la Team B');
  await capture(lea, '11-iphone-lea-teams');
  await lea.getByTestId('esport-team-faucons-valorant').click();
  await lea.getByTestId('esport-barre').waitFor({ timeout: 20_000 });
  verifier(!(await ongletPresent(lea, 'journal')), 'Joueur : pas de Journal');
  verifier((await ongletPresent(lea, 'membres')), 'Joueur : Membres visibles');
  await capture(lea, '12-iphone-lea-team');
  await ongletTeam(lea, 'membres');
  await lea.getByTestId('esport-liste-membres').waitFor({ timeout: 20_000 });
  verifier((await lea.getByTestId('esport-inviter').count()) === 0, 'Joueur : pas de panneau d’invitation');
  await capture(lea, '13-iphone-lea-membres');

  log('Accès restreint côté serveur (API directe avec le jeton de Léa)');
  const jetonLea = await jetonDeProfil(JETON, idLea);
  const sessLea = (await api('/session', jetonLea, { methode: 'POST' })).corps.session;
  const sessFond = (await api('/session', JETON, { methode: 'POST' })).corps.session;
  const teams = (await api('/teams', sessFond)).corps.teams;
  const teamB = teams.find(t => t.nom === 'Team B');
  const faucons = teams.find(t => t.nom === 'Faucons Valorant');
  verifier((await api(`/teams/${teamB.id}`, sessLea)).statut === 404, 'Team B : 404 pour Léa');
  verifier((await api(`/teams/${teamB.id}/membres`, sessLea)).statut === 404, 'Team B (membres) : 404 pour Léa');
  verifier((await api(`/teams/${faucons.id}/journal`, sessLea)).statut === 403, 'Journal de sa team : 403 (Joueur)');
  const roles = (await api(`/teams/${faucons.id}/roles`, sessLea)).corps.roles;
  verifier((await api(`/teams/${faucons.id}/membres`, sessLea, { methode: 'POST', corps: { compte: idLea, roleId: roles[0].id } })).statut === 403, 'Ajouter un membre : 403 (Joueur)');
  verifier((await api(`/teams/${faucons.id}/invitations`, sessFond, { methode: 'POST', corps: { roleId: roles[0].id } })).statut === 410, 'codes esp_ retirés : 410');
  verifier((await api('/comptes', sessLea, { methode: 'POST', corps: { compte: 'pirate01', pseudo: 'Pirate', affectations: [{ teamId: faucons.id, roleId: roles[0].id }] } })).statut === 403, 'créer un compte : réservé au Fondateur (403)');
  const dashLea = (await api('/dashboard', sessLea)).corps;
  verifier(dashLea.teams.length === 1 && !JSON.stringify(dashLea).includes(teamB.id), 'Dashboard de Léa : sa team seulement');
  verifier((await api(`/teams/${faucons.id}/m/scouting`, sessFond)).statut === 404, 'module désactivé (Scouting) : 404');

  // ================================================================ Retour au Fondateur
  log('PC : Journal et matrice des rôles');
  await ouvrirEsport(pc);
  await pc.getByTestId('esport-team-faucons-valorant').click();
  await ongletTeam(pc, 'journal');
  await pc.getByTestId('esport-journal').waitFor({ timeout: 20_000 });
  await pc.getByText(/Léa a rejoint la team \(Joueur\)/).first().waitFor({ timeout: 20_000 }).catch(() => undefined);
  verifier((await pc.getByText(/Léa a rejoint la team \(Joueur\)/).count()) >= 1, 'Journal : « Léa a rejoint la team (Joueur) »');
  verifier((await pc.getByText(/Fondateur a ajouté Léa à la team \(Joueur\)/).count()) >= 1, 'Journal : ajout par le Fondateur');
  await capture(pc, '14-pc-journal');
  // Phase 7 : filtres, export CSV et durée de conservation du journal.
  await pc.getByTestId('esport-journal-module-coeur').click();
  await pc.getByText(/Léa a rejoint la team \(Joueur\)/).first().waitFor({ timeout: 20_000 }).catch(() => undefined);
  verifier((await pc.getByText(/Léa a rejoint la team \(Joueur\)/).count()) >= 1, 'Journal filtré (Team et membres) : arrivée de Léa');
  verifier(await pc.getByTestId('esport-journal-csv').isVisible(), 'Journal : bouton « Exporter (CSV) »');
  verifier(/Conservation : 1 an/.test((await pc.getByTestId('esport-journal-retention').textContent({ timeout: 20_000 })) ?? ''), 'Journal : conservation 1 an');
  verifier((await api(`/teams/${faucons.id}/journal/export.csv?format=json`, sessFond)).corps?.contenu?.includes('member.joined'), 'Journal : export CSV');
  // Statistiques de la team sur l'accueil.
  await ongletTeam(pc, 'accueil');
  await pc.getByTestId('esport-stats').waitFor({ timeout: 20_000 });
  verifier(await pc.getByTestId('esport-stats-membres').isVisible(), 'Accueil : statistiques de la team');
  await capture(pc, '14b-pc-stats');
  // Navigation au clavier : la section « Équipe », puis son sous-onglet « Membres et rôles », s'ouvrent avec Entrée.
  await pc.getByTestId('esport-section-equipe').focus();
  await pc.keyboard.press('Enter');
  await pc.getByTestId('esport-onglet-membres').waitFor({ timeout: 20_000 });
  await pc.getByTestId('esport-onglet-membres').focus();
  await pc.keyboard.press('Enter');
  await pc.getByTestId(`esport-membre-${idLea}`).waitFor({ timeout: 20_000 });
  verifier(true, 'Clavier : section et sous-onglet ouverts avec Entrée');
  await pc.getByTestId('esport-matrice').waitFor({ timeout: 20_000 });
  await capture(pc, '15-pc-membres-matrice');

  // ================================================================ iPad
  log('iPad : page de la team');
  const ctxIpad = await nouveauContexte(navigateur, { viewport: { width: 1024, height: 1366 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true });
  const ipad = await compte(ctxIpad, siteAvec.url, relais.code, 'iPad', pc);
  await ouvrirEsport(ipad);
  await ipad.getByTestId('esport-team-faucons-valorant').click();
  await ipad.getByTestId('esport-barre').waitFor({ timeout: 20_000 });
  await ongletTeam(ipad, 'membres');
  await ipad.getByTestId('esport-matrice').waitFor({ timeout: 20_000 });
  await capture(ipad, '16-ipad-membres');
  const debord = await ipad.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  verifier(!debord, 'iPad : pas de défilement horizontal de la page');

  // ================================================================ Serveur absent
  log('Serveur Esport absent : « Esport pas encore activé »');
  const ctxSans = await nouveauContexte(navigateur, { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const sans = await compte(ctxSans, siteSans.url, relais.code, 'sans', pc);
  await ouvrirEsport(sans);
  await sans.getByTestId('esport-inactif').waitFor({ timeout: 30_000 });
  verifier((await sans.getByText('Esport pas encore activé').count()) === 1, '« Esport pas encore activé » affiché');
  verifier((await sans.getByTestId('esport-doc').count()) === 1, 'lien vers la marche à suivre (Fondateur)');
  await capture(sans, '17-pc-esport-pas-active');
  await sans.getByTestId('retour-hub').first().click();
  await sans.getByTestId('hub').waitFor({ timeout: 20_000 });
  verifier((await tuileApp(sans, 'portefeuille').count()) >= 1, 'le reste du hub marche');
} catch (e) {
  echecs++;
  console.error(e);
  for (const [nom, page] of pages) await page.screenshot({ path: join(CAPTURES, `echec-${nom}.jpg`), type: 'jpeg', quality: 60 }).catch(() => undefined);
} finally {
  await navigateur.close();
  siteAvec.fermer();
  siteSans.fermer();
  relais.fermer();
  await esport.fermer();
}
console.log(echecs === 0 ? 'e2e Esport : tout est bon' : `e2e Esport : ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
