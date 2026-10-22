/**
 * Test de bout en bout de la review vidéo v2 (Esport), SANS
 * appeler YouTube (faux script local intercepté, comme e2e-esport-review.mjs) :
 *
 *  - PC (1440 × 900), le Fondateur : GRAS par Ctrl+B dans la note d'un repère
 *    (la sélection est entourée de **…**, aperçu rendu), puis DESSIN D'UNE
 *    FLÈCHE sur la vidéo (bouton « Dessiner » : pause, calque, annuler /
 *    rétablir), enregistrement, RECHARGEMENT de la page, et réaffichage du
 *    dessin par-dessus la vidéo au bon timestamp (masquable) ;
 *  - iPad (820 × 1180), Léa (Joueur, son propre compte du hub) : 👍 puis 👎 sur
 *    un repère : une seule réaction, compteurs à jour, tri « plus dislikés ».
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-esport-review-v2.mjs
 *
 * Variable : CAPTURES (dossier des captures, défaut docs/captures-esport-review-v2).
 */

import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ongletTeam } from './esport-navigation.mjs';
import { allerPageAdministration, allerPageApplications, nouveauContexte, tuileApp } from './e2e-acceptation.mjs';
import { chargerPlaywright, demarrerRelais, deverrouiller, pause, premierLancement, racine, totp } from './mobile-outils.mjs';

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-esport-review-v2');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-esport-review-v2-0123456789';
const PORT_RELAIS = 8851;
const PORT_ESPORT = 8852;
const PORT_SITE = 5297;
const MDP = 'mot-de-passe-review-v2-e2e-tres-long-42';
const ID = 'dQw4w9WgXcQ';
const log = (...a) => console.log('[e2e-review-v2]', ...a);
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
const faux = (page, expr) => page.evaluate(`(${expr})(window.__fauxYoutube)`);
const attendre = async (fn, essais = 40) => {
  for (let i = 0; i < essais; i++) {
    const v = await fn();
    if (v) return v;
    await pause(250);
  }
  return undefined;
};

let horsFaux = 0;
async function simulerYoutube(ctx) {
  await ctx.route(/^https:\/\/([a-z0-9-]+\.)?(youtube\.com|youtube-nocookie\.com|ytimg\.com|googlevideo\.com)\//, route => {
    const u = route.request().url();
    if (u === 'https://www.youtube.com/iframe_api') return route.fulfill({ status: 200, contentType: 'text/javascript', body: FAUX_YOUTUBE });
    if (/ytimg\.com/.test(u)) return route.fulfill({ status: 200, contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64') });
    horsFaux++;
    return route.abort();
  });
}

const pages = [];
async function compte(contexte, nom) {
  const page = await contexte.newPage();
  pages.push([nom, page]);
  page.on('pageerror', e => log(`erreur page (${nom}) :`, e.message));
  const secret = await premierLancement(page, { site: leSite.url, code: relais.code, motDePasse: MDP });
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

async function ouvrirReview(page, reviewId) {
  if (!(await page.getByTestId('app-esport').isVisible().catch(() => false))) await ouvrirEsport(page);
  await page.getByTestId('esport-nav-teams').click().catch(() => undefined);
  await page.getByTestId('esport-team-faucons-valorant').click();
  await ongletTeam(page, 'module-video_review');
  await page.getByTestId(`esport-review-${reviewId}`).click();
  await page.getByTestId('esport-review-detail').waitFor({ timeout: 20_000 });
  await page.getByTestId('faux-youtube').waitFor({ timeout: 20_000 });
}

const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
try {
  // ================================================================ Préparation (API) : team, review, repère
  const sessFond = (await api('/session', JETON, { methode: 'POST' })).corps.session;
  await api('/moi', sessFond, { methode: 'PUT', corps: { pseudo: 'Fondateur' } });
  const teamId = (await api('/teams', sessFond, { methode: 'POST', corps: { nom: 'Faucons Valorant', jeu: 'valorant', preset: 'valorant_complet' } })).corps.team.id;
  const roles = (await api(`/teams/${teamId}/roles`, sessFond)).corps.roles;
  const review = (await api(`/teams/${teamId}/review`, sessFond, { methode: 'POST', corps: { titre: 'Faucons vs Nova · Ascent', url: `https://youtu.be/${ID}` } })).corps;
  const peek = (await api(`/teams/${teamId}/review/${review.id}/reperes`, sessFond, { methode: 'POST', corps: { debut: 83, categorie: 'erreur', titre: 'Peek trop large' } })).corps;
  await api(`/teams/${teamId}/review/${review.id}/reperes`, sessFond, { methode: 'POST', corps: { debut: 40, categorie: 'bonne_action', titre: 'Bon trade' } });
  verifier(Boolean(review.id && peek.id), 'team, review et repères prêts (API)');

  // ================================================================ PC : compte du hub de Léa
  log('PC : Fondateur, compte « Esport seulement » de Léa');
  const ctxPc = await nouveauContexte(navigateur, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  await simulerYoutube(ctxPc);
  const pc = await compte(ctxPc, 'PC');
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

  // ================================================================ PC : gras par Ctrl+B
  log('PC : note d’un repère, gras par Ctrl+B');
  await ouvrirReview(pc, review.id);
  await pc.evaluate(() => (window.__fauxYoutube.temps = 120));
  await pause(500);
  await pc.keyboard.press('m');
  await pc.getByTestId('esport-repere-form').waitFor({ timeout: 10_000 });
  await pc.getByTestId('esport-repere-titre').fill('Rotation lente');
  const note = pc.getByTestId('esport-repere-note');
  await note.fill('Erreur grave');
  await note.evaluate(el => {
    el.focus();
    el.setSelectionRange(7, 12);
  });
  await pc.keyboard.press('Control+b');
  verifier((await note.inputValue()) === 'Erreur **grave**', `Ctrl+B entoure la sélection : « ${await note.inputValue()} »`);
  const grasRendu = await pc.getByTestId('esport-repere-apercu').evaluate(el => [...el.querySelectorAll('*')].some(x => x.textContent === 'grave' && Number(getComputedStyle(x).fontWeight) >= 700));
  verifier(grasRendu, 'aperçu : « grave » rendu en gras (composants de l’app, pas de HTML brut)');
  const outils = await pc.getByTestId('esport-repere-note-gras').boundingBox();
  verifier(outils && outils.height >= 44 && outils.width >= 44, `bouton Gras de 44 px (${Math.round(outils?.width ?? 0)} × ${Math.round(outils?.height ?? 0)})`);
  // Le bouton « I » de la barre d'outils, sur une nouvelle ligne de texte.
  await note.press('End');
  await note.type(' à corriger');
  await note.evaluate(el => el.setSelectionRange(el.value.length - 8, el.value.length));
  await pc.getByTestId('esport-repere-note-italique').click();
  verifier((await note.inputValue()) === 'Erreur **grave** à *corriger*', `bouton Italique : « ${await note.inputValue()} »`);
  await capture(pc, '01-pc-note-gras');
  await pc.getByTestId('esport-repere-enregistrer').click();
  await pc.getByTestId('esport-repere-form').waitFor({ state: 'detached', timeout: 20_000 });
  const rotation = await attendre(() => esport.base.premier("SELECT * FROM review_reperes WHERE titre = 'Rotation lente'", []));
  verifier(rotation?.note === 'Erreur **grave** à *corriger*', 'note enregistrée en Markdown (gras, italique)');

  // ================================================================ PC : dessin d'une flèche
  log('PC : dessin d’une flèche sur la vidéo');
  await pc.evaluate(() => {
    window.__fauxYoutube.temps = 300;
    window.__fauxYoutube.lecture = true;
  });
  await pause(400);
  await pc.getByTestId('esport-review-dessiner').click();
  await pc.getByTestId('esport-dessin-barre').waitFor({ timeout: 10_000 });
  verifier(!(await faux(pc, 'e => e.lecture')), 'Dessiner : la vidéo se met en pause');
  const calque = pc.getByTestId('esport-dessin-calque');
  await calque.locator('canvas').first().waitFor({ timeout: 30_000 });
  const instantDessin = await faux(pc, 'e => e.temps');
  const boite = await calque.boundingBox();
  const lecteur = await pc.getByTestId('esport-lecteur-zone').boundingBox();
  verifier(boite && lecteur && Math.abs(boite.width - lecteur.width) < 2 && Math.abs(boite.height - lecteur.height) < 2, 'le calque couvre exactement le lecteur');
  const point = (fx, fy) => [boite.x + boite.width * fx, boite.y + boite.height * fy];
  const tracer = async (a, b) => {
    await pc.mouse.move(...point(...a));
    await pc.mouse.down();
    for (let i = 1; i <= 12; i++) await pc.mouse.move(...point(a[0] + ((b[0] - a[0]) * i) / 12, a[1] + ((b[1] - a[1]) * i) / 12));
    await pc.mouse.up();
  };
  await tracer([0.2, 0.3], [0.6, 0.7]);
  verifier((await pc.getByTestId('esport-dessin-nombre').innerText()).startsWith('1 '), 'une flèche tracée');
  await pc.getByTestId('esport-dessin-annuler').click();
  verifier((await pc.getByTestId('esport-dessin-nombre').innerText()).startsWith('0 '), 'annuler : plus de flèche');
  await pc.getByTestId('esport-dessin-retablir').click();
  verifier((await pc.getByTestId('esport-dessin-nombre').innerText()).startsWith('1 '), 'rétablir : la flèche revient');
  await capture(pc, '02-pc-dessin-fleche');
  await pc.getByTestId('esport-dessin-enregistrer').click();
  await pc.getByTestId('esport-dessin-barre').waitFor({ state: 'detached', timeout: 20_000 });
  const dessine = await attendre(() => esport.base.premier('SELECT * FROM review_reperes WHERE dessin IS NOT NULL', []));
  const d = JSON.parse(dessine?.dessin ?? 'null');
  const f = d?.objets?.[0];
  verifier(dessine?.debut_s === Math.round(instantDessin * 10) / 10 && /^Dessin /.test(dessine.titre), `repère créé au timestamp courant (${dessine?.debut_s} s, « ${dessine?.titre} »)`);
  verifier(
    d?.objets.length === 1 && f.t === 'fleche' && Math.abs(f.p[0] - 0.2) < 0.03 && Math.abs(f.p[1] - 0.3) < 0.03 && Math.abs(f.p[2] - 0.6) < 0.03 && Math.abs(f.p[3] - 0.7) < 0.03,
    `flèche stockée en coordonnées relatives : ${JSON.stringify(f?.p)}`,
  );

  // ================================================================ PC : rechargement, réaffichage au timestamp
  log('PC : rechargement, puis réaffichage du dessin au bon instant');
  await pc.reload();
  // Deux comptes sur l'appareil (le Fondateur, Léa) : le site demande d'abord le prénom.
  const premierEcran = await Promise.race([
    pc.getByTestId('hub').waitFor({ timeout: 60_000 }).then(() => 'hub'),
    pc.getByTestId('connexion-prenom').waitFor({ timeout: 60_000 }).then(() => 'prenom'),
    pc.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 }).then(() => 'verrou'),
  ]);
  if (premierEcran === 'prenom') {
    await pc.getByTestId('connexion-prenom').fill('admin');
    await pc.getByTestId('connexion-continuer').click();
    await pc.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 });
  }
  if (premierEcran !== 'hub') await deverrouiller(pc, MDP, pc.secret);
  await fermerPopups(pc);
  await ouvrirReview(pc, review.id);
  const affiche = pc.getByTestId(`esport-dessin-affiche-${dessine.id}`);
  verifier((await pc.getByTestId(`esport-repere-miniature-${dessine.id}`).locator('svg line').count()) === 1, 'miniature du dessin dans la liste des repères');
  verifier((await pc.getByTestId(`esport-repere-icone-dessin-${dessine.id}`).count()) === 1, 'icône ✏️ sur le repère dessiné');
  await pc.evaluate(() => (window.__fauxYoutube.temps = 100));
  await pause(600);
  verifier((await affiche.count()) === 0, 'avant le repère : pas de dessin sur la vidéo');
  await pc.getByTestId(`esport-repere-aller-${dessine.id}`).click();
  await pause(600);
  verifier((await faux(pc, 'e => e.seeks.at(-1)')) === dessine.debut_s, 'saut au repère dessiné');
  verifier((await affiche.locator('line').count()) === 1 && (await affiche.locator('polygon').count()) === 1, 'au timestamp : la flèche s’affiche par-dessus la vidéo');
  const svg = await affiche.boundingBox();
  verifier(svg && lecteur && Math.abs(svg.width - lecteur.width) < 2, 'le dessin suit la taille du lecteur');
  await capture(pc, '03-pc-dessin-reaffiche');
  await pc.getByTestId('esport-dessins-bascule').click();
  verifier((await affiche.count()) === 0, 'bouton « Masquer les dessins »');
  await pc.getByTestId('esport-dessins-bascule').click();
  verifier((await affiche.count()) === 1, 'bouton « Afficher les dessins »');
  await pc.evaluate(t => (window.__fauxYoutube.temps = t + 10), dessine.debut_s);
  await pause(600);
  verifier((await affiche.count()) === 0, 'après la durée du repère (3 s par défaut) : le dessin disparaît');
  const md = await api(`/teams/${teamId}/review/${review.id}/export.md?format=json`, sessFond);
  verifier(/✏️ Dessin sur la vidéo : 1 forme \(flèche\)/.test(md.corps.contenu), 'export Markdown : le dessin est mentionné');

  // ================================================================ iPad : Léa rejoint la team
  log('iPad : Léa (Joueur) rejoint la team');
  const ctxLea = await nouveauContexte(navigateur, { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true, hasTouch: true });
  await simulerYoutube(ctxLea);
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
  await lea.getByTestId('esport-dashboard').waitFor({ timeout: 20_000 }).catch(() => lea.getByTestId('esport-dashboard-vide').waitFor({ timeout: 20_000 }));
  const idLea = (await esport.base.premier("SELECT id FROM comptes WHERE pseudo = 'Léa'", [])).id;
  const ajout = await api(`/teams/${teamId}/membres`, sessFond, { methode: 'POST', corps: { compte: idLea, roleId: roles.find(r => r.cle === 'joueur').id } });
  verifier(ajout.statut === 200, 'Léa est membre (Joueur)');

  // ================================================================ iPad : 👍 puis 👎
  log('iPad : Léa like puis dislike un repère');
  await ouvrirReview(lea, review.id);
  const like = lea.getByTestId(`esport-repere-reaction-${peek.id}-like`);
  const dislike = lea.getByTestId(`esport-repere-reaction-${peek.id}-dislike`);
  const n = async v => Number(await lea.getByTestId(`esport-repere-reaction-${peek.id}-${v}-n`).innerText());
  await like.scrollIntoViewIfNeeded();
  const taille = await like.boundingBox();
  verifier(taille && taille.height >= 44, `bouton 👍 assez grand pour le doigt (${Math.round(taille?.height ?? 0)} px)`);
  await like.click();
  verifier(Boolean(await attendre(async () => (await n('like')) === 1)), '👍 : compteur à 1');
  const apresLike = await esport.base.tous('SELECT valeur FROM review_reactions WHERE compte_id = ?', [idLea]);
  verifier(apresLike.length === 1 && Number(apresLike[0].valeur) === 1, 'serveur : une réaction « like »');
  await capture(lea, '04-ipad-like');
  await dislike.click();
  verifier(Boolean(await attendre(async () => (await n('dislike')) === 1 && (await n('like')) === 0)), '👎 : le like devient un dislike (👍 0 · 👎 1)');
  const apresDislike = await esport.base.tous('SELECT valeur FROM review_reactions WHERE compte_id = ?', [idLea]);
  verifier(apresDislike.length === 1 && Number(apresDislike[0].valeur) === -1, 'serveur : toujours UNE réaction, désormais « dislike »');
  verifier((await dislike.getAttribute('aria-pressed')) === 'true' || (await dislike.getAttribute('aria-selected')) === 'true', 'ma réaction est signalée (état sélectionné)');
  await lea.getByTestId('esport-review-tri-dislikes').click();
  const premier = await lea.locator('[data-testid^="esport-repere-aller-"]').first().getAttribute('data-testid');
  verifier(premier === `esport-repere-aller-${peek.id}`, 'tri « plus dislikés » : le repère dislike en tête');
  verifier((await lea.getByTestId('esport-review-dessiner').count()) === 1, 'iPad (navigateur) : le Joueur peut dessiner');
  await capture(lea, '05-ipad-dislike');
  const vuParFond = (await api(`/teams/${teamId}/review/${review.id}`, sessFond)).corps.reperes.find(r => r.id === peek.id).reactions;
  verifier(vuParFond.like === 0 && vuParFond.dislike === 1 && vuParFond.qui.dislike[0]?.pseudo === 'Léa', 'compteurs et noms visibles par les autres membres');
  verifier(Number((await esport.base.premier("SELECT COUNT(*) AS n FROM notifications WHERE type LIKE 'review%' AND charge LIKE '%reaction%'", [])).n) === 0, 'aucune notification de réaction');

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
console.log(echecs === 0 ? 'e2e review v2 Esport : tout est bon' : `e2e review v2 Esport : ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
