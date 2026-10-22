/**
 * Test de bout en bout du module RESSOURCES de l'Esport (canal de ressources de la team), sans
 * Cloudflare et sans réseau réel :
 *
 *  - faux relais et serveur Esport local ; l'aperçu des liens passe par un téléchargeur SIMULÉ côté
 *    serveur (la vraie protection anti-SSRF refuserait de toute façon une page locale) ; YouTube est un
 *    FAUX SCRIPT local (https://www.youtube.com/iframe_api intercepté), toute autre requête vers
 *    YouTube est refusée et comptée ;
 *  - PC (1440 × 900), le Fondateur : Jeu › Ressources ; il CRÉE UNE CATÉGORIE, puis publie un LIEN
 *    (aperçu récupéré par le serveur), une VIDÉO YOUTUBE (lecteur intégré, « Ouvrir en review
 *    vidéo ») et un PDF (envoi par morceaux), et une note réservée au staff ;
 *  - iPhone (390 × 844), Léa (Joueuse, compte du hub « Esport seulement ») : elle voit les trois
 *    ressources, RÉAGIT (👍) et COMMENTE ; la ressource réservée au staff reste invisible (fil et API) ;
 *    pas de défilement horizontal.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-esport-ressources.mjs
 *
 * Variable : CAPTURES (dossier des captures, défaut docs/captures-esport-ressources).
 */

import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ongletTeam } from './esport-navigation.mjs';
import { allerPageAdministration, allerPageApplications, nouveauContexte, tuileApp } from './e2e-acceptation.mjs';
import { chargerPlaywright, demarrerRelais, deverrouiller, optionsIphone, pause, premierLancement, racine, totp } from './mobile-outils.mjs';

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-esport-ressources');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-esport-ressources-012345';
const PORT_RELAIS = 8961;
const PORT_ESPORT = 8962;
const PORT_SITE = 5361;
const MDP = 'mot-de-passe-ressources-e2e-tres-long-42';
const ID = 'dQw4w9WgXcQ';
const log = (...a) => console.log('[e2e-ressources]', ...a);
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

// ---- Faux script YouTube (remplace https://www.youtube.com/iframe_api)
const FAUX_YOUTUBE = `
(function () {
  var etat = (window.__fauxYoutube = { temps: 0, duree: 600, lecture: false, vitesse: 1, creations: 0, videoId: null });
  function Player(cible, options) {
    var self = this;
    etat.creations++;
    etat.videoId = options.videoId;
    var boite = document.createElement('div');
    boite.setAttribute('data-testid', 'faux-youtube');
    boite.style.cssText = 'width:100%;height:100%;background:#102a43;color:#fff;display:flex;align-items:center;justify-content:center;font:16px sans-serif';
    boite.textContent = 'Faux lecteur YouTube : ' + options.videoId;
    cible.replaceWith(boite);
    self.getCurrentTime = function () { return etat.temps; };
    self.getDuration = function () { return etat.duree; };
    self.seekTo = function (s) { etat.temps = s; };
    self.setPlaybackRate = function (v) { etat.vitesse = v; };
    self.playVideo = function () { etat.lecture = true; };
    self.pauseVideo = function () { etat.lecture = false; };
    self.destroy = function () { boite.remove(); };
    setTimeout(function () { options.events.onReady({ target: self }); }, 30);
  }
  window.YT = { Player: Player, PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } };
  if (window.onYouTubeIframeAPIReady) window.onYouTubeIframeAPIReady();
})();`;
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

// ---- Pages « publiques » vues par le serveur (téléchargeur simulé de l'aperçu des liens)
const PAGES = {
  'https://blitz.gg/valorant/viper-lineups': '<html><head><title>Viper</title><meta property="og:title" content="Lineups Viper : Ascent B"><meta property="og:description" content="Toutes les lineups de Viper pour prendre B."><meta property="og:image" content="https://blitz.gg/img/viper.gif"><meta property="og:site_name" content="Blitz"></head></html>',
};
const apercusDemandes = [];
const apercuLiens = {
  telecharger: async url => {
    apercusDemandes.push(url);
    if (!PAGES[url]) throw new Error('page inconnue');
    return { statut: 200, type: 'text/html; charset=utf-8', location: null, corps: PAGES[url] };
  },
};

const { jetonDeProfil } = await import(pathToFileURL(join(racine, 'relais/worker.mjs')).href);
const { demarrerServeurEsport } = await import(pathToFileURL(join(racine, 'esport/outils/serveur-local.mjs')).href);

// ------------------------------------------------------------- Serveurs
const relais = await demarrerRelais(PORT_RELAIS, JETON);
const esport = await demarrerServeurEsport({ port: PORT_ESPORT, jetonDev: JETON, apercuLiens });
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

async function attendre(f, essais = 40) {
  for (let i = 0; i < essais; i++) {
    const v = await f();
    if (v) return v;
    await pause(250);
  }
  return f();
}

const debordement = page => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

/** Faux YouTube, images d'aperçu et valorant-api.com : jamais de réseau réel. */
let horsFaux = 0;
async function routerFaux(ctx) {
  await ctx.route(/^https:\/\/([a-z0-9-]+\.)?(youtube\.com|youtube-nocookie\.com|ytimg\.com|googlevideo\.com)\//, route => {
    const u = route.request().url();
    if (u === 'https://www.youtube.com/iframe_api') return route.fulfill({ status: 200, contentType: 'text/javascript', body: FAUX_YOUTUBE });
    if (/ytimg\.com/.test(u)) return route.fulfill({ status: 200, contentType: 'image/gif', body: GIF });
    horsFaux++;
    return route.abort();
  });
  await ctx.route(/^https:\/\/blitz\.gg\//, route => route.fulfill({ status: 200, contentType: 'image/gif', body: GIF }));
  await ctx.route(/^https:\/\/(media\.)?valorant-api\.com\//, route => route.abort());
}

/** Petit PDF valide (une page, un texte). */
function pdfFactice() {
  const objets = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'];
  const flux = 'BT /F1 24 Tf 72 760 Td (Guide des lineups Viper) Tj ET';
  objets.push(`<< /Length ${flux.length} >>\nstream\n${flux}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let sortie = '%PDF-1.4\n';
  const positions = [];
  objets.forEach((o, i) => {
    positions.push(sortie.length);
    sortie += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = sortie.length;
  sortie += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n${positions.map(p => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(sortie, 'latin1');
}

const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
const pages = [];
try {
  // ================================================================ Préparation (API)
  const sessFond = (await api('/session', JETON, { methode: 'POST' })).corps.session;
  await api('/moi', sessFond, { methode: 'PUT', corps: { pseudo: 'Fondateur' } });
  const teamId = (await api('/teams', sessFond, { methode: 'POST', corps: { nom: 'Faucons Valorant', jeu: 'valorant', preset: 'valorant_complet' } })).corps.team.id;
  const detailTeam = (await api(`/teams/${teamId}`, sessFond)).corps;
  verifier(detailTeam.modules.some(m => m.cle === 'resources' && m.active), 'preset « Team Valorant complète » : module Ressources activé');
  const roles = Object.fromEntries((await api(`/teams/${teamId}/roles`, sessFond)).corps.roles.map(r => [r.cle, r]));

  // ================================================================ PC : le Fondateur
  const ctxPc = await nouveauContexte(navigateur, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  await routerFaux(ctxPc);
  const pc = await ctxPc.newPage();
  pages.push(['PC', pc]);
  pc.on('pageerror', e => log('erreur page (PC) :', e.message));
  const secret = await premierLancement(pc, { site: leSite.url, code: relais.code, motDePasse: MDP });
  await pc.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(pc, MDP, secret));
  await fermerPopups(pc);
  // ================================================================ Léa (Joueuse) : compte du hub
  log('PC : compte du hub de Léa');
  await allerPageAdministration(pc);
  await pc.locator('[data-testid="cellule-administration"], [data-testid="tuile-administration"]').first().click();
  await pc.getByTestId('app-administration').waitFor({ timeout: 20_000 });
  await confirmerIdentite(pc, secret);
  await pc.getByTestId('admin-onglet-utilisateurs').click();
  await pc.getByTestId('admin-nouveau').click();
  await pc.getByTestId('admin-nom').fill('Léa');
  await pc.getByTestId('admin-nouveau-modele-esport').click();
  await pc.getByTestId('admin-nouveau-informe').click();
  await pc.getByTestId('admin-creer').click();
  await confirmerIdentite(pc, secret);
  await pc.getByTestId('admin-invitation-lien').first().waitFor({ timeout: 90_000 });
  const lienLea = (await pc.getByTestId('admin-invitation-lien').first().innerText()).trim();
  await pc.getByTestId('admin-transmis').click().catch(() => undefined);
  await pc.getByTestId('admin-termine').click();
  await pc.getByTestId('retour-hub').first().click();

  await ouvrirEsport(pc);
  await pc.getByTestId('esport-team-faucons-valorant').first().click();
  log('PC : Jeu › Ressources');
  await ongletTeam(pc, 'module-resources');
  await pc.getByTestId('esport-ressources').waitFor({ timeout: 20_000 });
  await pc.getByTestId('esport-ressources-vide').waitFor({ timeout: 20_000 });
  const cats = await esport.base.tous('SELECT cle_defaut FROM ressource_categories WHERE team_id = ? ORDER BY position', [teamId]);
  verifier(cats.map(c => c.cle_defaut).join(',') === 'guides,videos_pros,lineups,aim,outils,mental,divers', 'sept catégories par défaut créées à la première ouverture');
  await capture(pc, '01-pc-canal-vide');

  // ---------------------------------------------------------------- Catégorie
  log('PC : nouvelle catégorie');
  await pc.getByTestId('esport-menu').first().click();
  await pc.getByTestId('esport-ressources-categories').click();
  await pc.getByTestId('esport-ressources-categories-volet').waitFor({ timeout: 10_000 });
  await pc.getByTestId('esport-categorie-nouvelle').fill('Lineups Viper');
  await pc.getByTestId('esport-categorie-ajouter').click();
  const cat = await attendre(() => esport.base.premier("SELECT * FROM ressource_categories WHERE team_id = ? AND nom = 'Lineups Viper'", [teamId]));
  verifier(Boolean(cat), 'catégorie « Lineups Viper » créée');
  await capture(pc, '02-pc-categories');
  await pc.getByTestId('esport-ressources-categories-volet-fermer').click();
  await pc.getByTestId(`esport-ressources-cat-${cat.id}`).waitFor({ timeout: 10_000 });

  // ---------------------------------------------------------------- Lien (aperçu par le serveur)
  log('PC : publier un lien');
  await pc.getByTestId('esport-ressources-nouvelle').click();
  await pc.getByTestId('esport-ressource-form').waitFor({ timeout: 10_000 });
  await pc.getByTestId('esport-ressource-url').fill('https://blitz.gg/valorant/viper-lineups');
  await pc.getByTestId('esport-ressource-apercu-recuperer').click();
  await pc.getByTestId('esport-ressource-apercu-carte').waitFor({ timeout: 15_000 });
  verifier((await pc.getByTestId('esport-ressource-apercu-carte').innerText()).includes('Lineups Viper : Ascent B'), 'aperçu du lien récupéré par le serveur (titre Open Graph)');
  verifier((await pc.getByTestId('esport-ressource-titre').inputValue()) === 'Lineups Viper : Ascent B', 'titre prérempli par l’aperçu');
  await pc.getByTestId(`esport-ressource-categorie-${cat.id}`).click();
  await pc.getByTestId('esport-ressource-tags').fill('viper, ascent');
  await capture(pc, '03-pc-nouveau-lien');
  await pc.getByTestId('esport-ressource-publier').click();
  const lien = await attendre(() => esport.base.premier("SELECT * FROM ressources WHERE team_id = ? AND genre = 'lien'", [teamId]));
  verifier(lien?.categorie_id === cat.id && JSON.parse(lien.apercu ?? '{}').site === 'Blitz', 'lien publié dans « Lineups Viper », aperçu enregistré');
  await pc.getByTestId('esport-ressource-detail').waitFor({ timeout: 15_000 });
  await pc.getByTestId('esport-ressource-apercu').waitFor({ timeout: 10_000 });
  await capture(pc, '04-pc-detail-lien');
  await pc.getByTestId('esport-ressource-detail-fermer').click();

  // ---------------------------------------------------------------- Vidéo YouTube
  log('PC : publier une vidéo YouTube');
  await pc.getByTestId('esport-ressources-nouvelle').click();
  await pc.getByTestId('esport-ressource-genre-youtube').click();
  await pc.getByTestId('esport-ressource-url').fill(`https://youtu.be/${ID}?t=42`);
  verifier((await pc.getByTestId('esport-ressource-youtube-reconnue').innerText()).includes(ID), 'adresse YouTube reconnue dans le formulaire');
  await pc.getByTestId('esport-ressource-titre').fill('TenZ : retake B sur Ascent');
  await pc.getByTestId(`esport-ressource-categorie-${(await esport.base.premier("SELECT id FROM ressource_categories WHERE team_id = ? AND cle_defaut = 'videos_pros'", [teamId])).id}`).click();
  await pc.getByTestId('esport-ressource-publier').click();
  await pc.getByTestId('esport-ressource-detail').waitFor({ timeout: 15_000 });
  await pc.getByTestId('faux-youtube').waitFor({ timeout: 20_000 });
  const video = await esport.base.premier("SELECT * FROM ressources WHERE team_id = ? AND genre = 'youtube'", [teamId]);
  verifier(video?.video_id === ID, 'vidéo publiée avec son identifiant YouTube');
  verifier((await pc.evaluate(() => window.__fauxYoutube?.videoId)) === ID, 'lecteur intégré (faux YouTube) pour cette vidéo');
  await capture(pc, '05-pc-detail-video');

  // ---------------------------------------------------------------- PDF (envoi par morceaux)
  log('PC : déposer un PDF');
  await pc.getByTestId('esport-ressource-detail-fermer').click();
  await pc.getByTestId('esport-ressources-nouvelle').click();
  await pc.getByTestId('esport-ressource-genre-fichier').click();
  const choix = pc.waitForEvent('filechooser');
  await pc.getByTestId('esport-ressource-fichier-choisir').click();
  const pdf = pdfFactice();
  await (await choix).setFiles({ name: 'Guide Viper.pdf', mimeType: 'application/pdf', buffer: pdf });
  await pc.getByTestId('esport-ressource-fichier-choisi').waitFor({ timeout: 10_000 });
  await pc.getByTestId('esport-ressource-titre').fill('Guide Viper (PDF)');
  await pc.getByTestId('esport-ressource-publier').click();
  const fichierRes = await attendre(() => esport.base.premier("SELECT * FROM ressources WHERE team_id = ? AND genre = 'fichier'", [teamId]));
  const fichier = fichierRes ? await esport.base.premier('SELECT * FROM fichiers WHERE id = ?', [fichierRes.fichier_id]) : null;
  verifier(fichier?.type_mime === 'application/pdf' && Number(fichier.taille) === pdf.length && fichier.entite_type === 'ressource_fichier', `PDF déposé par morceaux (${pdf.length} octets, stockage privé)`);
  await pc.getByTestId('esport-ressource-fichier').waitFor({ timeout: 15_000 });
  await capture(pc, '06-pc-detail-pdf');
  await pc.getByTestId('esport-ressource-detail-fermer').click();

  // ---------------------------------------------------------------- Note réservée au staff
  log('PC : note réservée au staff');
  await pc.getByTestId('esport-ressources-nouvelle').click();
  await pc.getByTestId('esport-ressource-genre-note').click();
  await pc.getByTestId('esport-ressource-titre').fill('Plan anti-Nova (staff)');
  await pc.getByTestId('esport-ressource-description').fill('Ne pas diffuser : **leurs habitudes en défense**.');
  await pc.getByTestId('esport-ressource-visibilite-staff').click();
  await pc.getByTestId('esport-ressource-publier').click();
  const staff = await attendre(() => esport.base.premier("SELECT * FROM ressources WHERE team_id = ? AND visibilite = 'staff'", [teamId]));
  verifier(Boolean(staff), 'note « staff seulement » publiée');
  await pc.getByTestId('esport-ressource-detail-fermer').click();
  await pc.getByTestId(`esport-ressource-${staff.id}-staff`).waitFor({ timeout: 10_000 });
  await pc.getByTestId('esport-ressources-vue-grille').click();
  await pc.getByTestId('esport-ressources-grille').waitFor({ timeout: 10_000 });
  await capture(pc, '07-pc-canal-grille');
  await pc.getByTestId('esport-ressources-vue-liste').click();

  // « Ouvrir en review vidéo » : la review est créée et s'ouvre.
  await pc.getByTestId(`esport-ressource-${video.id}`).click();
  await pc.getByTestId('esport-ressource-ouvrir-review').click();
  await pc.getByTestId('esport-review-detail').waitFor({ timeout: 20_000 });
  const review = await attendre(() => esport.base.premier('SELECT * FROM reviews WHERE team_id = ?', [teamId]));
  verifier(review?.video_id === ID && (await esport.base.premier('SELECT review_id FROM ressources WHERE id = ?', [video.id])).review_id === review.id, '« Ouvrir en review vidéo » : review créée et ouverte');
  await capture(pc, '08-pc-ouvert-en-review');

  const ctxLea = await nouveauContexte(navigateur, optionsIphone());
  await routerFaux(ctxLea);
  const lea = await ctxLea.newPage();
  pages.push(['Léa', lea]);
  lea.on('pageerror', e => log('erreur page (Léa) :', e.message));
  await lea.goto(lienLea.replace(/^https?:\/\/[^/]+\//, leSite.url));
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
  const idLea = (await esport.base.premier("SELECT id FROM comptes WHERE pseudo = 'Léa'", [])).id;
  verifier((await api(`/teams/${teamId}/membres`, sessFond, { methode: 'POST', corps: { compte: idLea, roleId: roles.joueur.id } })).statut === 200, 'Léa membre (Joueuse)');
  const sessLea = (await api('/session', await jetonDeProfil(JETON, idLea), { methode: 'POST' })).corps.session;

  // ================================================================ iPhone : Léa voit, réagit, commente
  log('iPhone : Léa dans le canal');
  await lea.getByTestId('esport-nav-teams').click();
  await lea.getByTestId('esport-team-faucons-valorant').first().click();
  await ongletTeam(lea, 'module-resources');
  await lea.getByTestId(`esport-ressource-${lien.id}`).waitFor({ timeout: 20_000 });
  for (const [r, nom] of [[lien, 'le lien'], [video, 'la vidéo YouTube'], [fichierRes, 'le PDF']]) verifier(await lea.getByTestId(`esport-ressource-${r.id}`).isVisible(), `Léa voit ${nom}`);
  verifier((await lea.getByTestId(`esport-ressource-${staff.id}`).count()) === 0, 'Léa ne voit pas la note réservée au staff (fil)');
  verifier((await api(`/teams/${teamId}/ressources/${staff.id}`, sessLea)).statut === 404, 'note du staff : 404 pour Léa (API)');
  verifier((await lea.getByTestId('esport-ressources-nouvelle').count()) === 0, 'Léa ne publie pas (propositions fermées)');
  verifier(!(await debordement(lea)), 'iPhone (canal) : pas de défilement horizontal');
  await capture(lea, '09-iphone-lea-canal');
  await lea.getByTestId(`esport-ressource-${lien.id}`).click();
  await lea.getByTestId('esport-ressource-detail').waitFor({ timeout: 15_000 });
  await lea.getByTestId('esport-ressource-reagir-0').click();
  verifier(Boolean(await attendre(() => esport.base.premier("SELECT * FROM ressource_reactions WHERE ressource_id = ? AND compte_id = ? AND emoji = '👍'", [lien.id, idLea]))), 'Léa a réagi 👍 (en base)');
  await lea.getByTestId('esport-ressource-reagir-0-n').waitFor({ timeout: 10_000 });
  await lea.getByTestId('esport-ressource-commentaire').fill('Merci, la lineup du mollie B est top !');
  await lea.getByTestId('esport-ressource-commenter').click();
  verifier(Boolean(await attendre(() => esport.base.premier('SELECT * FROM ressource_commentaires WHERE ressource_id = ? AND auteur_id = ?', [lien.id, idLea]))), 'Léa a commenté (en base)');
  await lea.getByText('Merci, la lineup du mollie B est top !').waitFor({ timeout: 10_000 });
  verifier(!(await debordement(lea)), 'iPhone (détail) : pas de défilement horizontal');
  await capture(lea, '10-iphone-lea-reaction-commentaire');
  await lea.getByTestId('esport-ressource-detail-fermer').click();
  // Le PDF s'ouvre par un lien signé (lecture privée).
  const lienPdf = await api(`/teams/${teamId}/ressources/${fichierRes.id}/fichier/lien`, sessLea, { methode: 'POST', corps: {} });
  const lu = lienPdf.statut === 200 ? await fetch(lienPdf.corps.url) : null;
  verifier(lu?.status === 200 && lu.headers.get('content-type') === 'application/pdf', 'Léa lit le PDF par lien signé');

  // Le Fondateur est prévenu du commentaire (notification in-app) ; le journal a tout.
  verifier(Boolean(await attendre(() => esport.base.premier("SELECT id FROM notifications WHERE compte_id = 'principal' AND type = 'ressource-commentaire'", []))), 'le Fondateur est prévenu du commentaire');
  const journal = await esport.base.tous("SELECT action FROM journal WHERE team_id = ? AND action LIKE 'resource%'", [teamId]);
  verifier(['resource.created', 'resource_category.created', 'resource.reaction_changed', 'resource.commented'].every(a => journal.some(j => j.action === a)), 'journal : publications, catégorie, réaction, commentaire');
  verifier(apercusDemandes.every(u => u.startsWith('https://blitz.gg/')), 'aperçus : seulement la page publique demandée');
  verifier(horsFaux === 0, `aucune requête réelle vers YouTube (${horsFaux})`);
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
console.log(echecs === 0 ? 'e2e ressources : tout est bon' : `e2e ressources : ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
