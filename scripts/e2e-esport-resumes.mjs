/**
 * Test de bout en bout de l'Esport, phase 3 (résumés de réunions, objectifs et tâches), sans
 * Cloudflare : faux relais (le vrai relais/worker.mjs), serveur Esport local (base SQLite en
 * mémoire, stockage des fichiers en mémoire).
 *
 *  - PC (1440 × 900), le Fondateur : team « Faucons Valorant » (par l'API), compte de Léa dans
 *    l'Administration (modèle « Esport seulement ») ;
 *  - iPhone (390 × 844), Léa (Joueur) : rejoint la team, DÉPOSE une réunion (lien, type, date,
 *    titre, note), la voit « À résumer » dans « Mes dépôts » ; pas de boîte de réception ;
 *  - PC, le Fondateur (rédacteur) : « Résumés à rédiger : 1 en attente » + « Nouveau », boîte de
 *    réception, ouverture (→ « Vu »), faux PDF refusé, UPLOAD du vrai PDF → « Terminé » ;
 *  - iPhone, Léa : notification « Le résumé … est prêt », « Ouvrir le PDF » → lien signé
 *    temporaire, téléchargé et vérifié (%PDF) ; la team B reste inaccessible ;
 *  - iPad (1024 × 1366), le Fondateur : objectifs et tâches (kanban), accueil de la team
 *    (derniers résumés, tâches en retard).
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-esport-resumes.mjs
 *
 * Variable : CAPTURES (dossier des captures, défaut docs/captures-esport-resumes).
 */

import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ongletPresent, ongletTeam } from './esport-navigation.mjs';
import { allerPageAdministration, allerPageApplications, nouveauContexte, tuileApp } from './e2e-acceptation.mjs';
import { chargerPlaywright, demarrerRelais, deverrouiller, optionsIphone, pause, premierLancement, racine, totp } from './mobile-outils.mjs';

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-esport-resumes');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-esport-resumes-0123456789abcdef';
const PORT_RELAIS = 8811;
const PORT_ESPORT = 8812;
const PORT_SITE = 5291;
const MDP = 'mot-de-passe-esport-e2e-tres-long-43';
const log = (...a) => console.log('[e2e-esport-resumes]', ...a);
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
const { pdfDeDemo } = await import(pathToFileURL(join(racine, 'esport/outils/graines.mjs')).href);

// ------------------------------------------------------------- Serveurs
const relais = await demarrerRelais(PORT_RELAIS, JETON);
const esport = await demarrerServeurEsport({ port: PORT_ESPORT, jetonDev: JETON });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff' };
function site(port) {
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
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ esport: esport.url }));
      return;
    }
    let fichier = join(dist, chemin);
    if (!existsSync(fichier) || statSync(fichier).isDirectory()) fichier = join(dist, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[extname(fichier)] ?? 'application/octet-stream' });
    createReadStream(fichier).pipe(res);
  });
  return new Promise(ok => serveur.listen(port, () => ok({ url: `http://localhost:${port}/`, fermer: () => serveur.close() })));
}
const siteAvec = await site(PORT_SITE);

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
  await allerPageApplications(page);
  const tuile = tuileApp(page, 'esport').first();
  await tuile.waitFor({ timeout: 30_000 });
  await tuile.click();
  await page.getByTestId('app-esport').waitFor({ timeout: 20_000 });
}

async function api(chemin, jeton, { methode = 'GET', corps } = {}) {
  const r = await fetch(`${esport.url}${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}

const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
try {
  // ================================================================ Mise en place (API) : le Fondateur, deux teams
  log('API : profil du Fondateur, team « Faucons Valorant » (tous les modules) et « Team B »');
  const sessFond = (await api('/session', JETON, { methode: 'POST' })).corps.session;
  await api('/moi', sessFond, { methode: 'PUT', corps: { pseudo: 'Fondateur' } });
  const faucons = (await api('/teams', sessFond, { methode: 'POST', corps: { nom: 'Faucons Valorant', jeu: 'valorant', preset: 'valorant_complet' } })).corps.team;
  const teamB = (await api('/teams', sessFond, { methode: 'POST', corps: { nom: 'Team B', jeu: 'valorant', preset: 'valorant_complet' } })).corps.team;
  const roles = (await api(`/teams/${faucons.id}/roles`, sessFond)).corps.roles;

  // ================================================================ PC : compte du hub de Léa
  log('PC : Administration, compte de Léa (« Esport seulement »)');
  const ctxPc = await nouveauContexte(navigateur, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const pc = await compte(ctxPc, siteAvec.url, relais.code, 'PC');
  await allerPageAdministration(pc);
  await pc.locator('[data-testid="cellule-administration"], [data-testid="tuile-administration"]').first().click();
  await pc.getByTestId('app-administration').waitFor({ timeout: 20_000 });
  await confirmerIdentite(pc);
  await pc.getByTestId('admin-onglet-utilisateurs').click();
  await pc.getByTestId('admin-nouveau').click();
  await pc.getByTestId('admin-nom').fill('Léa');
  await pc.getByTestId('admin-nouveau-modele-esport').click();
  await pc.getByTestId('admin-nouveau-informe').click();
  await pc.getByTestId('admin-creer').click();
  await confirmerIdentite(pc);
  await pc.getByTestId('admin-invitation-lien').first().waitFor({ timeout: 90_000 });
  const lienLea = (await pc.getByTestId('admin-invitation-lien').first().innerText()).trim();
  await pc.getByTestId('admin-transmis').click().catch(() => undefined);
  await pc.getByTestId('admin-termine').click();
  await pc.getByTestId('retour-hub').first().click();

  // ================================================================ iPhone : Léa dépose une réunion
  log('iPhone : Léa rejoint la team et dépose une réunion');
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
  await ouvrirEsport(lea);
  await lea.getByTestId('esport-profil-initial').waitFor({ timeout: 30_000 });
  await lea.getByTestId('esport-pseudo').fill('Léa');
  await lea.getByTestId('esport-pseudo-valider').click();
  await lea.getByTestId('esport-dashboard').waitFor({ timeout: 20_000 });
  // Invitation directe, sans code : le Fondateur ajoute le compte de Léa à la team.
  const idLeaAjout = (await esport.base.premier("SELECT id FROM comptes WHERE pseudo = 'Léa'", [])).id;
  verifier((await api(`/teams/${faucons.id}/membres`, sessFond, { methode: 'POST', corps: { compte: idLeaAjout, roleId: roles.find(r => r.cle === 'joueur').id } })).statut === 200, 'Léa ajoutée à Faucons Valorant (Joueur), sans code');
  await lea.getByTestId('esport-nav-teams').click();
  await lea.getByTestId('esport-teams').waitFor({ timeout: 20_000 });
  await lea.getByTestId('esport-team-faucons-valorant').waitFor({ timeout: 20_000 });
  verifier((await lea.getByTestId('esport-redacteur').count()) === 0, 'Léa (Joueur) : pas de bloc « Résumés à rédiger »');
  await lea.getByTestId('esport-team-faucons-valorant').click();
  await ongletTeam(lea, 'module-meeting_summaries');
  await lea.getByTestId('esport-depot-formulaire').waitFor({ timeout: 20_000 });
  verifier((await lea.getByTestId('esport-resumes-vue-boite').count()) === 0, 'Joueur : pas de boîte de réception');
  verifier((await lea.getByTestId('esport-resumes-vue-types').count()) === 0, 'Joueur : pas de gestion des types');
  await lea.getByTestId('esport-depot-lien').fill('https://www.youtube.com/watch?v=reunion-lundi');
  await lea.getByTestId('esport-depot-type-00000000-0000-4000-8000-000000000001').click();
  await lea.getByTestId('esport-depot-date').fill('19/10/2026');
  await lea.getByTestId('esport-depot-titre').fill('Réunion hebdo : retakes B');
  await lea.getByTestId('esport-depot-note').fill('On a surtout parlé des retakes sur Ascent.');
  await capture(lea, '01-iphone-lea-depot');
  await lea.getByTestId('esport-depot-envoyer').click();
  await lea.getByTestId('esport-mes-depots').waitFor({ timeout: 20_000 });
  await lea.getByText('Réunion hebdo : retakes B').first().waitFor({ timeout: 20_000 });
  const depot = (await esport.base.premier("SELECT id FROM reunions WHERE titre = 'Réunion hebdo : retakes B'", [])) ?? {};
  verifier(Boolean(depot.id), 'dépôt enregistré sur le serveur');
  verifier((await lea.getByTestId(`esport-depot-statut-${depot.id}`).innerText()).includes('À résumer'), 'Mes dépôts : « À résumer »');
  verifier((await lea.getByTestId(`esport-depot-pdf-${depot.id}`).count()) === 0, 'pas encore de PDF');
  await capture(lea, '02-iphone-lea-mes-depots');

  // ================================================================ PC : le Fondateur rédige
  log('PC : boîte de réception du rédacteur');
  await ouvrirEsport(pc);
  // Dashboard (premier écran) : le compteur global des résumés à rédiger.
  await pc.getByTestId('esport-dashboard-resumes-nombre').waitFor({ timeout: 30_000 });
  verifier((await pc.getByTestId('esport-dashboard-resumes-nombre').innerText()).trim() === '1', 'Dashboard : 1 résumé à rédiger');
  await pc.getByTestId('esport-nav-teams').click();
  await pc.getByTestId('esport-redacteur').waitFor({ timeout: 30_000 });
  verifier(/1 en attente/.test(await pc.getByTestId('esport-redacteur-compteur').innerText()), 'compteur : 1 en attente');
  verifier((await pc.getByTestId('esport-redacteur-nouveaux').count()) === 1, 'badge « Nouveau » sur l’accueil Esport');
  await capture(pc, '03-pc-teams-redacteur');
  await pc.getByTestId('esport-redacteur-ouvrir').click();
  await pc.getByTestId(`esport-boite-depot-${depot.id}`).waitFor({ timeout: 20_000 });
  verifier((await pc.getByTestId(`esport-boite-nouveau-${depot.id}`).count()) === 1, 'boîte : badge « Nouveau » sur le dépôt');
  verifier((await pc.getByText('Faucons Valorant · Hebdo').count()) >= 1, 'boîte : team et type affichés');
  await capture(pc, '04-pc-boite-nouveau');
  await pc.getByTestId(`esport-boite-depot-${depot.id}`).click();
  await pc.getByTestId('esport-detail-depot').waitFor({ timeout: 20_000 });
  await pc.getByTestId(`esport-boite-nouveau-${depot.id}`).waitFor({ state: 'detached', timeout: 20_000 }).catch(() => undefined);
  verifier((await pc.getByTestId(`esport-boite-nouveau-${depot.id}`).count()) === 0, 'ouvert : marqué « Vu » (plus de badge)');
  verifier((await esport.base.premier('SELECT vu_par FROM reunions WHERE id = ?', [depot.id])).vu_par === 'principal', 'serveur : vu par le Fondateur');
  await pc.getByTestId('esport-detail-statut-en_cours').click();
  await pc.getByText('Statut : En cours.').waitFor({ timeout: 20_000 });

  log('PC : faux PDF refusé, puis vrai PDF → Terminé');
  let choix = pc.waitForEvent('filechooser');
  await pc.getByTestId('esport-detail-pdf').click();
  await (await choix).setFiles({ name: 'faux.pdf', mimeType: 'application/pdf', buffer: Buffer.from('ceci n’est pas un PDF') });
  await pc.getByTestId('esport-detail-erreur').waitFor({ timeout: 20_000 });
  verifier(/pas un vrai PDF/.test(await pc.getByTestId('esport-detail-erreur').innerText()), 'faux PDF : « Ce fichier n’est pas un vrai PDF »');
  choix = pc.waitForEvent('filechooser');
  await pc.getByTestId('esport-detail-pdf').click();
  await (await choix).setFiles({ name: 'Résumé hebdo S43.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdfDeDemo('Resume hebdo S43 - Faucons')) });
  await pc.getByTestId('esport-detail-avis').waitFor({ timeout: 30_000 });
  verifier(/Résumé publié/.test(await pc.getByTestId('esport-detail-avis').innerText()), 'PDF déposé : « Résumé publié »');
  verifier((await pc.getByTestId('esport-detail-statut').innerText()).includes('Terminé'), 'statut automatique : Terminé');
  verifier((await pc.getByTestId('esport-detail-historique').innerText()).includes('Résumé hebdo S43.pdf'), 'historique : le PDF, avec son nom d’origine');
  verifier(esport.stockage.taille() === 1, 'stockage : un fichier (le faux n’a rien écrit)');
  await capture(pc, '05-pc-detail-termine');
  verifier(/0 en attente/.test(await pc.getByTestId('esport-boite-compteur').innerText()), 'boîte : 0 en attente');

  // ================================================================ iPhone : Léa reçoit et télécharge
  log('iPhone : notification et ouverture du PDF par Léa');
  await lea.getByTestId('esport-team-retour').first().click();
  await lea.getByTestId('esport-notifications').waitFor({ timeout: 20_000 });
  await lea.getByText(/Le résumé de « Réunion hebdo : retakes B » est prêt/).first().waitFor({ timeout: 20_000 });
  verifier(true, 'notification in-app : « Le résumé … est prêt »');
  await capture(lea, '06-iphone-lea-notification');
  await lea.getByTestId('esport-team-faucons-valorant').click();
  await ongletTeam(lea, 'module-meeting_summaries');
  await lea.getByTestId('esport-resumes-vue-miens').click();
  await lea.getByTestId(`esport-depot-pdf-${depot.id}`).waitFor({ timeout: 20_000 });
  verifier((await lea.getByTestId(`esport-depot-statut-${depot.id}`).innerText()).includes('Terminé'), 'Mes dépôts : « Terminé »');
  await capture(lea, '07-iphone-lea-pdf-pret');
  // L'onglet s'ouvre pendant le geste (Safari), puis charge le lien signé : on guette la requête.
  const requetePdf = ctxLea.waitForEvent('request', { predicate: q => q.url().includes('/fichiers/'), timeout: 20_000 });
  const popup = ctxLea.waitForEvent('page', { timeout: 20_000 });
  await lea.getByTestId(`esport-depot-pdf-${depot.id}`).click();
  const pagePdf = await popup;
  const urlPdf = (await requetePdf).url();
  verifier(/\/fichiers\/[0-9a-f-]{36}\?.*sig=/.test(urlPdf), `lien signé temporaire (${urlPdf.split('?')[0].slice(-12)}…)`);
  const r = await fetch(urlPdf);
  const octets = Buffer.from(await r.arrayBuffer());
  verifier(r.status === 200 && octets.subarray(0, 5).toString() === '%PDF-', 'PDF téléchargé par la déposante (%PDF)');
  verifier(r.headers.get('content-type') === 'application/pdf' && /no-store/.test(r.headers.get('cache-control') ?? ''), 'en-têtes : application/pdf, no-store');
  verifier((await fetch(urlPdf.replace(/sig=[^&]+/, 'sig=faux'))).status === 403, 'lien falsifié : 403');
  await pagePdf.close().catch(() => undefined);

  log('Accès restreint côté serveur (API directe avec le jeton de Léa)');
  const idLea = (await esport.base.premier("SELECT id FROM comptes WHERE pseudo = 'Léa'", [])).id;
  const sessLea = (await api('/session', await jetonDeProfil(JETON, idLea), { methode: 'POST' })).corps.session;
  verifier((await api(`/teams/${teamB.id}/resumes`, sessLea)).statut === 404, 'résumés de la Team B : 404 pour Léa');
  verifier((await api(`/teams/${faucons.id}/resumes/${depot.id}`, sessLea, { methode: 'PATCH', corps: { statut: 'en_cours' } })).statut === 403, 'Léa ne change pas le statut (403)');

  // ================================================================ iPad : objectifs et tâches, accueil
  log('iPad : objectifs, tâches (kanban), accueil de la team');
  const obj = (await api(`/teams/${faucons.id}/objectifs`, sessFond, { methode: 'POST', corps: { titre: 'Passer Immortel en équipe', dateCible: '2026-12-31' } })).corps;
  await api(`/teams/${faucons.id}/taches`, sessFond, { methode: 'POST', corps: { titre: 'Revoir la VOD du scrim', assigne: idLea, echeance: '2026-10-01', priorite: 'haute', objectifId: obj.id } });
  const faite = (await api(`/teams/${faucons.id}/taches`, sessFond, { methode: 'POST', corps: { titre: 'Compo de Lotus', objectifId: obj.id } })).corps;
  await api(`/teams/${faucons.id}/taches/${faite.id}`, sessFond, { methode: 'PATCH', corps: { statut: 'fait' } });
  const ctxIpad = await nouveauContexte(navigateur, { viewport: { width: 1024, height: 1366 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true });
  const ipad = await compte(ctxIpad, siteAvec.url, relais.code, 'iPad');
  await ouvrirEsport(ipad);
  await ipad.getByTestId('esport-team-faucons-valorant').click();
  await ipad.getByTestId('esport-accueil-retard').waitFor({ timeout: 20_000 });
  await ipad.getByText('Revoir la VOD du scrim').first().waitFor({ timeout: 20_000 });
  verifier(true, 'accueil : tâche en retard affichée');
  await ipad.getByText('Réunion hebdo : retakes B').first().waitFor({ timeout: 20_000 });
  verifier(true, 'accueil : dernier résumé affiché');
  await capture(ipad, '08-ipad-accueil');
  await ongletTeam(ipad, 'module-goals_tasks');
  await ipad.getByTestId(`esport-objectif-${obj.id}`).waitFor({ timeout: 20_000 });
  verifier((await ipad.getByTestId(`esport-objectif-pourcentage-${obj.id}`).innerText()).trim() === '50 %', 'progression calculée : 50 %');
  await ipad.getByTestId('esport-taches-vue-kanban').click();
  await ipad.getByTestId('esport-kanban-fait').waitFor({ timeout: 20_000 });
  await capture(ipad, '09-ipad-objectifs-kanban');
  const debord = await ipad.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  verifier(!debord, 'iPad : pas de défilement horizontal de la page');

  // Léa : « Mes tâches » sur iPhone, notification d'assignation.
  await lea.getByTestId('esport-team-retour').first().click();
  await lea.getByText(/vous a assigné « Revoir la VOD du scrim »/).first().waitFor({ timeout: 20_000 });
  verifier(true, 'Léa : notification d’assignation');
  await lea.getByTestId('esport-team-faucons-valorant').click();
  await ongletTeam(lea, 'module-goals_tasks');
  await lea.getByTestId('esport-taches-filtre-miennes').click();
  await lea.getByText('Revoir la VOD du scrim').first().waitFor({ timeout: 20_000 });
  verifier((await lea.getByTestId('esport-tache-nouvelle').count()) === 0 && (await lea.getByTestId('esport-tache-creer').count()) === 0, 'Joueur : pas de création de tâche');
  await capture(lea, '10-iphone-lea-mes-taches');
} catch (e) {
  echecs++;
  console.error(e);
  for (const [nom, page] of pages) await page.screenshot({ path: join(CAPTURES, `echec-${nom}.jpg`), type: 'jpeg', quality: 60 }).catch(() => undefined);
} finally {
  await navigateur.close();
  siteAvec.fermer();
  relais.fermer();
  await esport.fermer();
}
console.log(echecs === 0 ? 'e2e Esport (résumés, objectifs) : tout est bon' : `e2e Esport (résumés, objectifs) : ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
