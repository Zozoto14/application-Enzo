/**
 * Test de bout en bout de la review vidéo et du scouting Esport (phase 5), sans
 * Cloudflare et SANS appeler YouTube :
 *
 *  - faux relais et serveur Esport local ; PC (1440 × 900), le Fondateur ;
 *  - l'API YouTube IFrame est remplacée par un FAUX SCRIPT local (interception de
 *    https://www.youtube.com/iframe_api) : lecteur factice avec temps, seekTo et vitesse ;
 *    toute autre requête vers YouTube est refusée et comptée (doit rester à zéro) ;
 *  - CRÉATION D'UNE REVIEW depuis une adresse YouTube, AJOUT DE REPÈRES AU CLAVIER (M),
 *    SAUT À UN REPÈRE (timeline), COMMENTAIRE, export Markdown et PDF (impression) ;
 *  - FICHE ADVERSAIRE, VOD, puis « Ouvrir en review vidéo » ;
 *  - iPad (820 × 1180) et iPhone (390 × 844) : pas de défilement horizontal.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-esport-review.mjs
 *
 * Variable : CAPTURES (dossier des captures, défaut docs/captures-esport-review).
 */

import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ongletTeam } from './esport-navigation.mjs';
import { nouveauContexte } from './e2e-acceptation.mjs';
import { chargerPlaywright, demarrerRelais, deverrouiller, pause, premierLancement, racine } from './mobile-outils.mjs';

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-esport-review');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-esport-review-0123456789';
const PORT_RELAIS = 8821;
const PORT_ESPORT = 8822;
const PORT_SITE = 5292;
const MDP = 'mot-de-passe-review-e2e-tres-long-42';
const ID = 'dQw4w9WgXcQ';
const log = (...a) => console.log('[e2e-review]', ...a);
let echecs = 0;
const verifier = (ok, message) => {
  console.log(ok ? '  OK   ' : '  ECHEC', message);
  if (!ok) echecs++;
};
const capture = async (page, nom) => {
  await pause(500);
  await page.screenshot({ path: join(CAPTURES, `${nom}.jpg`), type: 'jpeg', quality: 70 });
};

// ---- Faux script YouTube (remplace https://www.youtube.com/iframe_api)
const FAUX_YOUTUBE = `
(function () {
  var etat = (window.__fauxYoutube = { temps: 0, duree: 1800, lecture: false, vitesse: 1, seeks: [], creations: 0, videoId: null });
  setInterval(function () { if (etat.lecture) etat.temps += 0.25 * etat.vitesse; }, 250);
  function Player(cible, options) {
    var self = this;
    etat.creations++;
    etat.videoId = options.videoId;
    etat.options = { host: options.host, origin: options.playerVars && options.playerVars.origin };
    var boite = document.createElement('div');
    boite.setAttribute('data-testid', 'faux-youtube');
    boite.style.cssText = 'width:100%;height:100%;background:#102a43;color:#fff;display:flex;align-items:center;justify-content:center;font:16px sans-serif';
    boite.textContent = 'Faux lecteur YouTube : ' + options.videoId;
    cible.replaceWith(boite);
    self.getCurrentTime = function () { return etat.temps; };
    self.getDuration = function () { return etat.duree; };
    self.seekTo = function (s) { etat.temps = s; etat.seeks.push(s); };
    self.setPlaybackRate = function (v) { etat.vitesse = v; };
    self.playVideo = function () { etat.lecture = true; };
    self.pauseVideo = function () { etat.lecture = false; };
    self.destroy = function () { boite.remove(); };
    setTimeout(function () { options.events.onReady({ target: self }); }, 30);
  }
  window.YT = { Player: Player, PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } };
  if (window.onYouTubeIframeAPIReady) window.onYouTubeIframeAPIReady();
})();`;

const { demarrerServeurEsport } = await import(pathToFileURL(join(racine, 'esport/outils/serveur-local.mjs')).href);

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
    // texte brut
  }
  return { statut: r.status, corps: lu };
}

async function fermerPopups(page) {
  for (let i = 0; i < 3; i++) {
    const clique = await page.getByText(/^(Fermer|Terminé|Compris|Plus tard)$/).first().click({ timeout: 2000 }).then(() => true, () => false);
    if (!clique) break;
  }
}
const debordement = page => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const faux = (page, expr) => page.evaluate(`(${expr})(window.__fauxYoutube)`);

const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
const pages = [];
let horsFaux = 0;
try {
  // ================================================================ Préparation : team (API)
  const sessFond = (await api('/session', JETON, { methode: 'POST' })).corps.session;
  await api('/moi', sessFond, { methode: 'PUT', corps: { pseudo: 'Fondateur' } });
  const teamId = (await api('/teams', sessFond, { methode: 'POST', corps: { nom: 'Faucons Valorant', jeu: 'valorant', preset: 'valorant_complet' } })).corps.team.id;
  verifier(Boolean(teamId), 'team prête (API)');

  // ================================================================ PC
  const ctx = await nouveauContexte(navigateur, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true, acceptDownloads: true });
  // YouTube est simulé : le faux script répond, tout le reste de YouTube est refusé (et compté).
  await ctx.route(/^https:\/\/([a-z0-9-]+\.)?(youtube\.com|youtube-nocookie\.com|ytimg\.com|googlevideo\.com)\//, route => {
    const u = route.request().url();
    if (u === 'https://www.youtube.com/iframe_api') return route.fulfill({ status: 200, contentType: 'text/javascript', body: FAUX_YOUTUBE });
    if (/ytimg\.com/.test(u)) return route.fulfill({ status: 200, contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64') });
    horsFaux++;
    return route.abort();
  });
  const pc = await ctx.newPage();
  pages.push(['PC', pc]);
  pc.on('pageerror', e => log('erreur page (PC) :', e.message));
  const secret = await premierLancement(pc, { site: leSite.url, code: relais.code, motDePasse: MDP });
  await pc.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(pc, MDP, secret));
  await fermerPopups(pc);
  await pc.evaluate(() => {
    window.__impressions = [];
    window.print = () => window.__impressions.push(document.getElementById('impression-esport')?.innerHTML ?? '');
  });

  const { allerPageApplications, tuileApp } = await import(pathToFileURL(join(racine, 'scripts/e2e-acceptation.mjs')).href);
  const ouvrirEsport = async page => {
    await allerPageApplications(page);
    const tuile = tuileApp(page, 'esport').first();
    await tuile.waitFor({ timeout: 30_000 });
    await tuile.click();
    await page.getByTestId('app-esport').waitFor({ timeout: 20_000 });
  };
  await ouvrirEsport(pc);
  await pc.getByTestId('esport-team-faucons-valorant').click();

  // ---------------------------------------------------------------- Création d'une review
  log('PC : création d’une review depuis une adresse YouTube');
  await ongletTeam(pc, 'module-video_review');
  await pc.getByTestId('esport-review-nouvelle').waitFor({ timeout: 20_000 });
  verifier((await pc.getByTestId('esport-review-limite').count()) === 0, 'plus de mention « pas de dessin sur la vidéo » (le dessin existe)');
  await pc.getByTestId('esport-review-url').fill('https://exemple.fr/pas-youtube');
  verifier(/non reconnue/.test(await pc.getByTestId('esport-review-url-etat').innerText()), 'adresse non YouTube refusée');
  await pc.getByTestId('esport-review-url').fill(`https://youtu.be/${ID}`);
  verifier((await pc.getByTestId('esport-review-url-etat').innerText()).includes(ID), 'identifiant YouTube extrait');
  await pc.getByTestId('esport-review-titre').fill('Faucons vs Nova · Ascent');
  await pc.getByTestId('esport-review-reference').fill('Match de ligue J4');
  await capture(pc, '01-pc-nouvelle-review');
  await pc.getByTestId('esport-review-creer').click();
  await pc.getByTestId('esport-review-detail').waitFor({ timeout: 20_000 });
  await pc.getByTestId('faux-youtube').waitFor({ timeout: 20_000 });
  const review = await esport.base.premier('SELECT * FROM reviews WHERE team_id = ?', [teamId]);
  verifier(review?.video_id === ID && review.titre === 'Faucons vs Nova · Ascent', 'review enregistrée avec l’identifiant YouTube');
  verifier((await faux(pc, 'e => e.videoId')) === ID, 'lecteur IFrame créé pour cette vidéo (faux YouTube)');
  verifier((await faux(pc, 'e => e.options.host')).includes('youtube-nocookie.com'), 'vidéo servie par youtube-nocookie.com');

  // ---------------------------------------------------------------- Repères au clavier
  log('PC : repères ajoutés au clavier (M)');
  await pc.evaluate(() => (window.__fauxYoutube.temps = 83));
  await pause(500);
  await pc.keyboard.press('m');
  await pc.getByTestId('esport-repere-form').waitFor({ timeout: 10_000 });
  verifier((await pc.getByTestId('esport-repere-instant').inputValue()) === '01:23', 'M : le formulaire reprend le temps courant (01:23)');
  verifier(!(await faux(pc, 'e => e.lecture')), 'M : la lecture est mise en pause');
  await pc.getByTestId('esport-repere-titre').fill('Peek trop large');
  await pc.getByTestId('esport-repere-categorie-erreur').click();
  await pc.getByTestId('esport-repere-note').fill('Il fallait **jouer le trade**.\n- attendre Kai\n<script>window.__xss = 1</script>');
  await pc.getByTestId('esport-repere-apercu').waitFor();
  await capture(pc, '02-pc-ajout-repere');
  await pc.getByTestId('esport-repere-enregistrer').click();
  await pc.getByTestId('esport-review-avis').waitFor({ timeout: 20_000 });
  // Deuxième repère, avec durée, au clavier : la saisie dans un champ ne déclenche PAS le raccourci.
  await pc.evaluate(() => (window.__fauxYoutube.temps = 754));
  await pause(500);
  await pc.keyboard.press('M');
  await pc.getByTestId('esport-repere-form').waitFor({ timeout: 10_000 });
  await pc.getByTestId('esport-repere-titre').fill('Clutch 1v3 : mmm');
  verifier((await pc.getByTestId('esport-repere-titre').inputValue()) === 'Clutch 1v3 : mmm', 'taper « m » dans un champ ne rouvre rien');
  await pc.getByTestId('esport-repere-categorie-bonne_action').click();
  await pc.getByTestId('esport-repere-duree').fill('20');
  await pc.getByTestId('esport-repere-enregistrer').click();
  await pc.getByTestId('esport-repere-form').waitFor({ state: 'detached', timeout: 20_000 });
  const reperes = await esport.base.tous('SELECT * FROM review_reperes ORDER BY debut_s', []);
  verifier(reperes.length === 2 && reperes[0].debut_s === 83 && reperes[1].debut_s === 754 && reperes[1].fin_s === 774, 'deux repères enregistrés (83 s ; 754 s + 20 s)');
  verifier(!/[<>]/.test(reperes[0].note), 'la note est nettoyée côté serveur (XSS)');
  verifier((await pc.evaluate(() => window.__xss)) === undefined, 'aucun script de la note n’a tourné');
  verifier((await pc.getByTestId(`esport-repere-note-${reperes[0].id}`).innerText()).includes('jouer le trade'), 'note rendue (Markdown léger)');
  verifier((await pc.getByTestId(`esport-timeline-repere-${reperes[1].id}`).count()) === 1, 'timeline : un repère coloré par repère');
  await capture(pc, '03-pc-review');

  // ---------------------------------------------------------------- Saut à un repère
  log('PC : saut à un repère par la timeline');
  await pc.evaluate(() => (window.__fauxYoutube.seeks.length = 0));
  await pc.getByTestId(`esport-timeline-repere-${reperes[1].id}`).click();
  verifier((await faux(pc, 'e => e.seeks.at(-1)')) === 754, 'clic sur la timeline : seekTo(754)');
  await pc.getByTestId(`esport-repere-aller-${reperes[0].id}`).click();
  verifier((await faux(pc, 'e => e.seeks.at(-1)')) === 83, 'clic dans la liste : seekTo(83)');
  await pc.getByTestId('esport-review-vitesse-1.5').click();
  verifier((await faux(pc, 'e => e.vitesse')) === 1.5, 'vitesse de lecture 1,5×');
  // Liste synchronisée : le repère en cours est mis en avant.
  await pc.evaluate(() => (window.__fauxYoutube.temps = 760));
  await pause(700);
  verifier((await pc.getByTestId(`esport-repere-actif-${reperes[1].id}`).count()) === 1, 'liste latérale synchronisée avec la lecture');
  // Filtres.
  await pc.getByTestId('esport-filtre-cat-erreur').click();
  verifier((await pc.getByTestId(`esport-repere-${reperes[1].id}`).count()) === 0 && (await pc.getByTestId(`esport-repere-${reperes[0].id}`).count()) === 1, 'filtre par catégorie');
  await pc.getByTestId('esport-filtre-effacer').click();

  // ---------------------------------------------------------------- Commentaire
  log('PC : commentaire sur un repère');
  if ((await pc.getByTestId(`esport-commentaire-texte-${reperes[0].id}`).count()) === 0) await pc.getByTestId(`esport-repere-commentaires-${reperes[0].id}`).click();
  await pc.getByTestId(`esport-commentaire-texte-${reperes[0].id}`).fill('Compris, je repasse derrière Kai.');
  await pc.getByTestId(`esport-commentaire-envoyer-${reperes[0].id}`).click();
  await pc.getByText('Compris, je repasse derrière Kai.').waitFor({ timeout: 20_000 });
  verifier(Number((await esport.base.premier('SELECT COUNT(*) AS n FROM review_commentaires', [])).n) === 1, 'commentaire enregistré');
  await capture(pc, '04-pc-commentaire');

  // ---------------------------------------------------------------- Exports
  log('PC : export Markdown et PDF');
  const md = await api(`/teams/${teamId}/review/${review.id}/export.md?format=json`, sessFond);
  verifier(md.statut === 200 && md.corps.contenu.includes('### [01:23] Peek trop large') && md.corps.contenu.includes('Compris, je repasse derrière Kai.') && !/<script/i.test(md.corps.contenu), 'export Markdown : repères et commentaires, sans HTML');
  await pc.getByTestId('esport-review-export-pdf').click();
  await pc.getByTestId('esport-review-avis').waitFor({ timeout: 20_000 });
  await pause(300);
  const imprime = await pc.evaluate(() => window.__impressions);
  verifier(imprime.length === 1 && imprime[0].includes('Faucons vs Nova') && imprime[0].includes('Peek trop large') && !/<script/i.test(imprime[0]), 'export PDF : le document d’impression est prêt (échappé)');
  await pc.getByTestId('esport-review-export-md').click();

  // ---------------------------------------------------------------- Scouting
  log('PC : fiche adversaire, VOD, « Ouvrir en review vidéo »');
  await pc.getByTestId('esport-review-retour').click();
  await ongletTeam(pc, 'module-scouting');
  await pc.getByTestId('esport-adversaire-nouveau').waitFor({ timeout: 20_000 });
  await pc.getByTestId('esport-adversaire-nom').fill('Team Nova');
  await pc.getByTestId('esport-adversaire-notes').fill('Équipe rapide, aime les rushs B.');
  await pc.getByTestId('esport-adversaire-creer').click();
  await pc.getByTestId('esport-adversaire-detail').waitFor({ timeout: 20_000 });
  await pc.getByTestId('esport-joueur-adverse-ajouter').click();
  await pc.getByTestId('esport-joueur-adverse-pseudo').fill('Phantom');
  await pc.getByTestId('esport-joueur-adverse-agents').fill('Jett, Raze');
  await pc.getByTestId('esport-joueur-adverse-enregistrer').click();
  await pc.getByText(/Agents : Jett, Raze/).waitFor({ timeout: 20_000 });
  await pc.getByTestId('esport-tendance-ajouter').click();
  await pc.getByTestId('esport-tendance-map').fill('Ascent');
  await pc.getByTestId('esport-tendance-taux').fill('58');
  await pc.getByTestId('esport-tendance-enregistrer').click();
  await pc.getByText(/Ascent · Attaque · 58 %/).waitFor({ timeout: 20_000 });
  await pc.getByTestId('esport-vod-url').fill(`https://www.youtube.com/watch?v=${ID}&t=30s`);
  await pc.getByTestId('esport-vod-titre').fill('Finale de ligue');
  await pc.getByTestId('esport-vod-ajouter').click();
  const vod = await (async () => {
    for (let i = 0; i < 40; i++) {
      const v = await esport.base.premier('SELECT * FROM adversaire_vods', []);
      if (v) return v;
      await pause(250);
    }
  })();
  await pc.getByTestId(`esport-vod-review-${vod.id}`).waitFor({ timeout: 20_000 });
  await capture(pc, '05-pc-fiche-adversaire');
  await pc.getByTestId(`esport-vod-review-${vod.id}`).click();
  await pc.getByTestId('esport-review-detail').waitFor({ timeout: 20_000 });
  await pc.getByTestId('faux-youtube').waitFor({ timeout: 20_000 });
  const lie = await esport.base.premier('SELECT v.review_id, r.titre FROM adversaire_vods v JOIN reviews r ON r.id = v.review_id', []);
  verifier(lie?.titre === 'Team Nova · Finale de ligue', 'la VOD est ouverte en review (créée et liée)');
  verifier((await pc.getByTestId('esport-review-nom').innerText()) === 'Team Nova · Finale de ligue', 'l’écran Review affiche la review de la VOD');
  verifier(Number((await esport.base.premier('SELECT COUNT(*) AS n FROM reviews', [])).n) === 2, 'une seule nouvelle review (pas de doublon)');
  const crees = await esport.base.tous("SELECT type FROM evenements WHERE type = 'review.created'", []);
  verifier(crees.length === 2, 'événement « review.created » publié sur le bus (2 reviews)');
  await capture(pc, '06-pc-review-depuis-vod');

  // ---------------------------------------------------------------- iPad et iPhone
  for (const [nom, w, h] of [['ipad', 820, 1180], ['iphone', 390, 844]]) {
    log(`${nom} : pas de défilement horizontal`);
    await pc.setViewportSize({ width: w, height: h });
    await pause(700);
    await pc.getByTestId('esport-review-detail').waitFor({ timeout: 10_000 });
    verifier(!(await debordement(pc)), `${nom} (review) : pas de défilement horizontal`);
    await capture(pc, `07-${nom}-review`);
    await pc.getByTestId('esport-review-retour').click();
    await ongletTeam(pc, 'module-scouting');
    await pc.getByTestId('esport-scouting').waitFor({ timeout: 10_000 });
    verifier(!(await debordement(pc)), `${nom} (scouting) : pas de défilement horizontal`);
    await ongletTeam(pc, 'module-video_review');
    await pc.getByTestId('esport-review-liste').waitFor({ timeout: 10_000 });
    await pc.locator('[data-testid^="esport-review-"][aria-label^="Ouvrir la review"]').first().click();
  }
  verifier(horsFaux === 0, `aucune requête vers YouTube hors du faux script (${horsFaux})`);
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
console.log(echecs === 0 ? 'e2e review Esport : tout est bon' : `e2e review Esport : ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
