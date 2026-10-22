/**
 * Test de bout en bout des STATISTIQUES D'USAGE de l'Esport (page réservée au Fondateur) :
 *
 *  - faux relais (relais/relais.mjs), serveur Esport local, site construit (bureau/dist) ;
 *  - le Fondateur (PC) crée dans l'Administration les comptes de Léa (Joueuse) et de Kai (Propriétaire) ;
 *  - Léa (iPhone) et Kai (iPad) ouvrent l'Esport et NAVIGUENT : l'app envoie ses lots d'usage (intervalle
 *    raccourci pour le test), et un dernier lot part au départ de la page (keepalive) ;
 *  - Kai, Propriétaire, n'a PAS l'entrée « Statistiques » et reçoit 404 sur la route ;
 *  - le Fondateur ouvre Statistiques : utilisateurs actifs, Léa et Kai dans la liste avec leurs pages
 *    préférées, les pages les plus et les moins utilisées, les pages jamais ouvertes, la fiche de Léa ;
 *    l'écran tient sur iPhone (pas de défilement horizontal).
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-esport-statistiques.mjs
 *
 * Variable : CAPTURES (dossier des captures, défaut docs/captures-esport-statistiques).
 */

import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ongletTeam } from './esport-navigation.mjs';
import { allerPageAdministration, allerPageApplications, nouveauContexte, tuileApp } from './e2e-acceptation.mjs';
import { chargerPlaywright, demarrerRelais, deverrouiller, optionsIphone, pause, premierLancement, racine, totp } from './mobile-outils.mjs';

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-esport-statistiques');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-esport-statistiques-0123';
const PORT_RELAIS = 8981;
const PORT_ESPORT = 8982;
const PORT_SITE = 5381;
const MDP = 'mot-de-passe-statistiques-e2e-tres-long-42';
const log = (...a) => console.log('[e2e-statistiques]', ...a);
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
    // texte
  }
  return { statut: r.status, corps: lu };
}

async function fermerPopups(page) {
  for (let i = 0; i < 3; i++) {
    const clique = await page.getByText(/^(Fermer|Terminé|Compris|Plus tard)$/).first().click({ timeout: 2000 }).then(() => true, () => false);
    if (!clique) break;
  }
}

async function confirmerIdentite(page, secret) {
  if (!(await page.getByTestId('admin-identite-mdp').waitFor({ timeout: 8_000 }).then(() => true, () => false))) return;
  for (const decalage of [0, 1, -1]) {
    await page.getByTestId('admin-identite-mdp').fill(MDP);
    await page.getByTestId('admin-identite-code').fill(totp(secret, decalage));
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

async function attendre(f, essais = 60) {
  for (let i = 0; i < essais; i++) {
    const v = await f();
    if (v) return v;
    await pause(250);
  }
  return f();
}

const debordement = page => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

/** Compte du hub « Esport seulement » créé dans l'Administration ; rend le lien d'invitation. */
async function creerCompte(pc, secret, nom) {
  await allerPageAdministration(pc);
  await pc.locator('[data-testid="cellule-administration"], [data-testid="tuile-administration"]').first().click();
  await pc.getByTestId('app-administration').waitFor({ timeout: 20_000 });
  await confirmerIdentite(pc, secret);
  await pc.getByTestId('admin-onglet-utilisateurs').click();
  await pc.getByTestId('admin-nouveau').click();
  await pc.getByTestId('admin-nom').fill(nom);
  await pc.getByTestId('admin-nouveau-modele-esport').click();
  await pc.getByTestId('admin-nouveau-informe').click();
  await pc.getByTestId('admin-creer').click();
  await confirmerIdentite(pc, secret);
  await pc.getByTestId('admin-invitation-lien').first().waitFor({ timeout: 90_000 });
  const lien = (await pc.getByTestId('admin-invitation-lien').first().innerText()).trim();
  await pc.getByTestId('admin-transmis').click().catch(() => undefined);
  await pc.getByTestId('admin-termine').click();
  await pc.getByTestId('retour-hub').first().click();
  return lien;
}

/** Le membre ouvre son invitation, son hub, puis l'Esport (pseudo) ; intervalle des lots raccourci. */
async function membre(navigateur, options, lien, pseudo, motDePasse, pages) {
  const ctx = await nouveauContexte(navigateur, options);
  await ctx.addInitScript(() => {
    window.__ESPORT_USAGE_INTERVALLE__ = 1500;
  });
  const p = await ctx.newPage();
  pages.push([pseudo, p]);
  p.on('pageerror', e => log(`erreur page (${pseudo}) :`, e.message));
  await p.goto(lien.replace(/^https?:\/\/[^/]+\//, leSite.url));
  await p.getByTestId('invitation-mdp').waitFor({ timeout: 60_000 });
  await p.getByTestId('invitation-mdp').fill(motDePasse);
  await p.getByTestId('invitation-mdp-confirmation').fill(motDePasse);
  await p.getByTestId('invitation-valider').click();
  await p.getByTestId('hub').waitFor({ timeout: 90_000 });
  await fermerPopups(p);
  await ouvrirEsport(p);
  await p.getByTestId('esport-profil-initial').waitFor({ timeout: 30_000 });
  await p.getByTestId('esport-pseudo').fill(pseudo);
  await p.getByTestId('esport-pseudo-valider').click();
  await p.getByTestId('esport-dashboard').waitFor({ timeout: 20_000 });
  return p;
}

/** Simule le départ de la page (onglet masqué) : le dernier lot part avec keepalive. */
const masquer = page =>
  page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });

const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
const pages = [];
try {
  // ================================================================ Préparation : team (API)
  const sessFond = (await api('/session', JETON, { methode: 'POST' })).corps.session;
  await api('/moi', sessFond, { methode: 'PUT', corps: { pseudo: 'Fondateur' } });
  const teamId = (await api('/teams', sessFond, { methode: 'POST', corps: { nom: 'Faucons Valorant', jeu: 'valorant', preset: 'valorant_complet' } })).corps.team.id;
  const roles = Object.fromEntries((await api(`/teams/${teamId}/roles`, sessFond)).corps.roles.map(r => [r.cle, r]));

  // ================================================================ PC : le Fondateur, comptes de Léa et Kai
  const ctxPc = await nouveauContexte(navigateur, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const pc = await ctxPc.newPage();
  pages.push(['PC', pc]);
  pc.on('pageerror', e => log('erreur page (PC) :', e.message));
  const secret = await premierLancement(pc, { site: leSite.url, code: relais.code, motDePasse: MDP });
  await pc.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(pc, MDP, secret));
  await fermerPopups(pc);
  log('PC : comptes du hub de Léa et Kai');
  const lienLea = await creerCompte(pc, secret, 'Léa');
  const lienKai = await creerCompte(pc, secret, 'Kai');

  // ================================================================ Léa (iPhone) et Kai (iPad) naviguent
  log('iPhone : Léa ; iPad : Kai');
  const lea = await membre(navigateur, optionsIphone(), lienLea, 'Léa', 'Été à Biarritz 2026 !', pages);
  const kai = await membre(navigateur, { viewport: { width: 1024, height: 1366 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true, userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' }, lienKai, 'Kai', 'Hiver à Chamonix 2026 !', pages);
  const idLea = (await esport.base.premier("SELECT id FROM comptes WHERE pseudo = 'Léa'", [])).id;
  const idKai = (await esport.base.premier("SELECT id FROM comptes WHERE pseudo = 'Kai'", [])).id;
  verifier((await api(`/teams/${teamId}/membres`, sessFond, { methode: 'POST', corps: { compte: idLea, roleId: roles.joueur.id } })).statut === 200, 'Léa membre (Joueuse)');
  verifier((await api(`/teams/${teamId}/membres`, sessFond, { methode: 'POST', corps: { compte: idKai, roleId: roles.proprietaire.id } })).statut === 200, 'Kai membre (Propriétaire)');

  log('Léa : Teams › Faucons › Planning, Disponibilités, Planning, Ressources');
  await lea.getByTestId('esport-nav-teams').click();
  await lea.getByTestId('esport-team-faucons-valorant').first().click();
  await ongletTeam(lea, 'module-planning');
  await pause(1200);
  await ongletTeam(lea, 'module-availability');
  await pause(800);
  await ongletTeam(lea, 'module-planning');
  await pause(1500);
  await ongletTeam(lea, 'module-resources');
  await pause(800);
  verifier((await lea.getByTestId('esport-nav-statistiques').count()) === 0, 'Léa (Joueuse) : pas d’entrée « Statistiques »');

  log('Kai (Propriétaire) : pas d’entrée Statistiques, 404 sur la route ; il navigue');
  await kai.getByTestId('esport-nav-teams').waitFor({ timeout: 20_000 });
  verifier((await kai.getByTestId('esport-nav-statistiques').count()) === 0, 'Kai (Propriétaire) : pas d’entrée « Statistiques » dans la navigation');
  const sessKai = (await api('/session', await jetonDeProfil(JETON, idKai), { methode: 'POST' })).corps.session;
  verifier((await api('/statistiques', sessKai)).statut === 404, 'Kai (Propriétaire) : GET /statistiques → 404');
  verifier((await api(`/statistiques/membres/${idLea}`, sessKai)).statut === 404, 'Kai (Propriétaire) : fiche d’un membre → 404');
  verifier((await api('/statistiques/reglages', sessKai, { methode: 'PUT', corps: { collecte: false } })).statut === 404, 'Kai (Propriétaire) : couper la collecte → 404');
  await kai.getByTestId('esport-nav-teams').click();
  await kai.getByTestId('esport-team-faucons-valorant').first().click();
  await ongletTeam(kai, 'module-planning');
  await pause(1000);
  await ongletTeam(kai, 'parametres');
  await pause(800);
  await kai.getByTestId('esport-nav-membres').click().catch(() => undefined);
  await pause(800);
  await capture(kai, '01-ipad-proprietaire-sans-statistiques');

  // Lots : l'intervalle (1,5 s) a fait partir les premiers ; le départ envoie le reste (keepalive).
  await pause(2500);
  await masquer(lea);
  await masquer(kai);
  const parCompte = await attendre(async () => {
    const lignes = await esport.base.tous("SELECT compte_id, page, appareil, duree_ms FROM usage_evenements WHERE genre = 'page'", []);
    const l = lignes.filter(x => x.compte_id === idLea);
    const k = lignes.filter(x => x.compte_id === idKai);
    return l.some(x => x.page === 'team.jeu.resources') && k.some(x => x.page === 'team.agenda.planning') ? { l, k } : null;
  });
  verifier(Boolean(parCompte), 'pages de Léa et Kai reçues par le serveur (lots, puis keepalive au départ)');
  if (parCompte) {
    verifier(parCompte.l.every(x => x.appareil === 'telephone') && parCompte.k.every(x => x.appareil === 'tablette'), `appareils : Léa téléphone, Kai tablette (${[...new Set(parCompte.l.map(x => x.appareil))]}, ${[...new Set(parCompte.k.map(x => x.appareil))]})`);
    verifier(parCompte.l.filter(x => x.page === 'team.agenda.planning').length >= 2 && parCompte.l.every(x => Number(x.duree_ms) >= 0), 'Léa : planning ouvert deux fois, durées mesurées');
  }
  const lots = Number((await esport.base.premier("SELECT COUNT(DISTINCT session_id) AS n FROM usage_evenements WHERE compte_id = ?", [idLea])).n);
  verifier(lots === 1, `Léa : une seule session d’app (${lots})`);
  const ip = await esport.base.premier("SELECT COUNT(*) AS n FROM usage_evenements WHERE message LIKE '%127.0.0.1%'", []);
  verifier(Number(ip.n) === 0, 'aucune adresse IP stockée');

  // ================================================================ PC : le Fondateur ouvre Statistiques
  log('PC : Esport › Statistiques');
  await ouvrirEsport(pc);
  await pc.getByTestId('esport-nav-statistiques').click();
  await pc.getByTestId('esport-statistiques').waitFor({ timeout: 20_000 });
  await pc.getByTestId('esport-stats-valeur-jour').waitFor({ timeout: 20_000 });
  const actifs = Number((await pc.getByTestId('esport-stats-valeur-jour').innerText()).replace(/\D/g, ''));
  verifier(actifs >= 2, `vue d’ensemble : ${actifs} actifs aujourd’hui (Léa et Kai au moins)`);
  await capture(pc, '02-pc-vue-ensemble');

  await pc.getByTestId('esport-stats-onglet-pages').click();
  await pc.getByTestId('esport-stats-plus').waitFor({ timeout: 20_000 });
  const plus = await pc.getByTestId('esport-stats-plus').innerText();
  verifier(/Agenda › Planning/.test(plus.split('\n').slice(0, 4).join('\n')), 'pages les plus utilisées : Agenda › Planning en tête');
  const moins = await pc.getByTestId('esport-stats-moins').innerText();
  verifier(/Disponibilit|Ressources|Paramètres|Teams|Membres/.test(moins), 'pages les moins utilisées : listées');
  verifier((await pc.getByTestId('esport-stats-jamais-team.jeu.strat_editor').count()) === 1, 'jamais ouvertes : Jeu › Strats');
  verifier((await pc.getByTestId('esport-stats-non-utilise-faucons-valorant-strat_editor').count()) === 1, 'modules activés mais pas utilisés : Strats (Faucons Valorant)');
  await capture(pc, '03-pc-pages');

  await pc.getByTestId('esport-stats-onglet-utilisateurs').click();
  await pc.getByTestId(`esport-stats-utilisateurs-${idLea}`).waitFor({ timeout: 20_000 });
  verifier((await pc.getByTestId(`esport-stats-utilisateurs-${idKai}`).count()) === 1, 'utilisateurs : Léa et Kai listés');
  verifier(/Planning/.test(await pc.getByTestId(`esport-stats-preferees-${idLea}`).innerText()), 'Léa : page préférée « Agenda › Planning »');
  verifier(/Téléphone/.test(await pc.getByTestId(`esport-stats-utilisateurs-${idLea}`).innerText()), 'Léa : appareil « Téléphone »');
  await capture(pc, '04-pc-utilisateurs');
  await pc.getByTestId(`esport-stats-utilisateurs-${idLea}`).click();
  await pc.getByTestId('esport-stats-fiche-resume').waitFor({ timeout: 20_000 });
  verifier(/Agenda › Planning/.test(await pc.getByTestId('esport-stats-chronologie').innerText()), 'fiche de Léa : chronologie de son activité');
  await capture(pc, '05-pc-fiche-lea');
  await pc.getByTestId('esport-stats-volet-fermer').click();

  await pc.getByTestId('esport-stats-onglet-activite').click();
  await pc.getByTestId('esport-stats-chaleur').waitFor({ timeout: 20_000 });
  verifier((await pc.getByTestId('esport-stats-appareil-telephone').count()) === 1 && (await pc.getByTestId('esport-stats-appareil-tablette').count()) === 1, 'activité : téléphone et tablette');
  await capture(pc, '06-pc-activite');

  log('Même page en largeur iPhone (390 px)');
  await pc.setViewportSize({ width: 390, height: 844 });
  await pause(800);
  await pc.getByTestId('esport-stats-onglet-pages').click().catch(() => undefined);
  await pause(600);
  verifier(!(await debordement(pc)), 'iPhone : pas de défilement horizontal (Statistiques)');
  await capture(pc, '07-iphone-pages');
  await pc.setViewportSize({ width: 1440, height: 900 });

  // RGPD et API : 404 pour Léa aussi, la mention dans l'app.
  const sessLea = (await api('/session', await jetonDeProfil(JETON, idLea), { methode: 'POST' })).corps.session;
  verifier((await api('/statistiques', sessLea)).statut === 404, 'Léa (Joueuse) : /statistiques → 404');
  const exportLea = (await api('/moi/export', sessLea)).corps;
  verifier(Array.isArray(exportLea.usage?.evenements) && exportLea.usage.evenements.length > 0, 'export RGPD de Léa : son usage y figure');
} catch (e) {
  echecs++;
  console.error(e);
  for (const [nom, p] of pages) await p.screenshot({ path: join(CAPTURES, `echec-${nom}.jpg`), type: 'jpeg', quality: 60 }).catch(() => undefined);
} finally {
  await navigateur.close();
  leSite.fermer();
  relais.fermer();
  await esport.fermer();
}
console.log(echecs === 0 ? 'e2e statistiques Esport : tout est bon' : `e2e statistiques Esport : ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
