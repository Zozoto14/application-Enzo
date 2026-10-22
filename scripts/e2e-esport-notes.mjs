/**
 * Test de bout en bout de l'ÉDITEUR DE NOTES de l'Esport (ChampNote), SANS
 * appeler YouTube (faux script IFrame, comme e2e-esport-review.mjs) :
 *
 *  - PC (1440 × 900), le Fondateur : ouvre un repère (touche M), vérifie la grande zone de saisie
 *    (11 lignes) qui grandit avec le texte, clique « Agrandir » (éditeur et aperçu côte à côte), tape
 *    un titre, une liste numérotée (Entrée continue la liste, Entrée sur un élément vide en sort), une
 *    case, du code et un bloc de code, vérifie l'aperçu, coche la case DANS l'aperçu, annule / rétablit,
 *    enregistre, recharge la page et retrouve la note (rendue puis rouverte en édition) ;
 *  - serveur : note nettoyée (aucun HTML), syntaxe maison de couleur validée ;
 *  - iPhone (390 × 844) : barre défilable horizontalement, menu « ⋯ », onglets Écrire / Aperçu.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-esport-notes.mjs
 *
 * Variable : CAPTURES (dossier des captures, défaut docs/captures-esport-notes).
 */

import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ongletTeam } from './esport-navigation.mjs';
import { nouveauContexte } from './e2e-acceptation.mjs';
import { chargerPlaywright, demarrerRelais, deverrouiller, pause, premierLancement, racine } from './mobile-outils.mjs';

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-esport-notes');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-esport-notes-0123456789';
const PORT_RELAIS = 8831;
const PORT_ESPORT = 8832;
const PORT_SITE = 5293;
const MDP = 'mot-de-passe-review-e2e-tres-long-42';
const ID = 'dQw4w9WgXcQ';
const log = (...a) => console.log('[e2e-notes]', ...a);
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

  // ---------------------------------------------------------------- Ouvrir un repère
  log('PC : ouverture d’un repère (M)');
  await pc.evaluate(() => (window.__fauxYoutube.temps = 83));
  await pause(500);
  await pc.keyboard.press('m');
  await pc.getByTestId('esport-repere-form').waitFor({ timeout: 10_000 });
  await pc.getByTestId('esport-repere-titre').fill('Plan de jeu sur B');
  const champ = pc.getByTestId('esport-repere-note');
  const hauteur = async () => (await champ.boundingBox()).height;
  const h0 = await hauteur();
  verifier(h0 >= 11 * 22, `zone de saisie grande par défaut : ${Math.round(h0)} px (11 lignes ou plus)`);
  verifier((await pc.getByTestId('esport-repere-note-gras').boundingBox()).height >= 43.5, 'boutons de la barre : 44 px');
  for (const id of ['gras', 'italique', 'barre', 'surligne', 'couleur', 'titre1', 'titre2', 'titre3', 'liste', 'numerotee', 'case', 'citation', 'code', 'bloc', 'separateur', 'lien', 'emoji', 'mention', 'annuler', 'retablir', 'agrandir', 'voir-apercu']) {
    if ((await pc.getByTestId(`esport-repere-note-${id}`).count()) !== 1) verifier(false, `bouton « ${id} » présent`);
  }
  verifier(true, 'barre complète présente (gras … agrandir)');

  // Hauteur automatique : 30 lignes font grandir la zone (au plus 560 px), puis elle défile.
  await champ.fill(Array.from({ length: 30 }, (_, i) => `ligne ${i + 1}`).join('\n'));
  await pause(300);
  const h30 = await hauteur();
  verifier(h30 > h0 && h30 <= 562, `hauteur automatique : ${Math.round(h0)} → ${Math.round(h30)} px (maximum 560)`);
  await champ.fill('');
  await pause(300);
  verifier(Math.abs((await hauteur()) - h0) < 4, 'la zone retrouve sa taille minimale quand le texte disparaît');
  verifier((await champ.evaluate(el => getComputedStyle(el).resize)) === 'vertical', 'poignée de redimensionnement (web)');

  // ---------------------------------------------------------------- Agrandir
  log('PC : Agrandir, titre, liste numérotée, case, code');
  await pc.getByTestId('esport-repere-note-agrandir').click();
  await pc.getByTestId('esport-repere-note-agrandi').waitFor({ timeout: 10_000 });
  const gr = await champ.boundingBox();
  const ap = await pc.getByTestId('esport-repere-apercu').count();
  verifier(gr.height > 400, `panneau agrandi : champ de ${Math.round(gr.height)} px de haut`);
  await champ.click();
  await pc.keyboard.type('# Plan de jeu\n\n1. Placer la smoke\nAppuyer sur le site\n\n- [ ] Vérifier le trade\n\n```\nconst x = 1 < 2;\n```\n\nPuis **gras** et ~~barré~~ et {{rouge|alerte}} avec ==surligné==');
  const attendu = '# Plan de jeu\n\n1. Placer la smoke\n2. Appuyer sur le site\n- [ ] Vérifier le trade\n```\nconst x = 1 < 2;\n```\n\nPuis **gras** et ~~barré~~ et {{rouge|alerte}} avec ==surligné==';
  const valeur = await champ.inputValue();
  verifier(valeur.startsWith('# Plan de jeu\n\n1. Placer la smoke\n2. Appuyer sur le site\n'), 'Entrée dans une liste numérotée : « 2. » ajouté automatiquement');
  verifier(!valeur.includes('3. ') && valeur.includes('- [ ] Vérifier le trade'), 'Entrée sur un élément vide : on sort de la liste');
  verifier(valeur.includes('- [ ] Vérifier le trade\n') && valeur.includes('```\nconst x = 1 < 2;\n```'), 'case et bloc de code saisis');
  verifier(valeur === attendu, `texte saisi exact${valeur === attendu ? '' : ' : ' + JSON.stringify(valeur)}`);
  const apercu = pc.getByTestId('esport-repere-apercu');
  await apercu.waitFor({ timeout: 10_000 });
  const boite = await apercu.boundingBox();
  verifier(boite.x > gr.x + gr.width / 2 - 40 || boite.x > 600, 'PC : éditeur et aperçu côte à côte');
  verifier((await apercu.getByRole('heading', { name: 'Plan de jeu' }).count()) === 1, 'aperçu : titre');
  const texteApercu = await apercu.innerText();
  verifier(/1\.[\s\S]*Placer la smoke[\s\S]*2\.[\s\S]*Appuyer sur le site/.test(texteApercu), 'aperçu : liste numérotée 1. 2.');
  verifier(texteApercu.includes('const x = 1 < 2;'), 'aperçu : bloc de code (le < reste du texte)');
  verifier((await apercu.locator('[role=checkbox]').count()) === 1, 'aperçu : case à cocher');
  verifier(await apercu.evaluate(el => [...el.querySelectorAll('*')].some(x => x.textContent === 'gras' && Number(getComputedStyle(x).fontWeight) >= 700)), 'aperçu : gras');
  verifier(await apercu.evaluate(el => [...el.querySelectorAll('*')].some(x => x.textContent === 'barré' && getComputedStyle(x).textDecorationLine.includes('line-through'))), 'aperçu : barré');
  verifier(await apercu.evaluate(el => [...el.querySelectorAll('*')].some(x => x.textContent === 'alerte' && getComputedStyle(x).color === 'rgb(229, 72, 77)')), 'aperçu : couleur rouge prédéfinie');
  verifier((await apercu.locator('script, img').count()) === 0, 'aperçu : aucun HTML brut');
  await capture(pc, '01-pc-agrandi');

  // Case cochée DANS l'aperçu, puis annuler / rétablir.
  await apercu.locator('[role=checkbox]').click();
  verifier((await champ.inputValue()).includes('- [x] Vérifier le trade'), 'case cochée depuis l’aperçu : « - [x] »');
  await pc.getByTestId('esport-repere-note-annuler').click();
  verifier((await champ.inputValue()).includes('- [ ] Vérifier le trade'), 'annuler : case décochée');
  await pc.getByTestId('esport-repere-note-retablir').click();
  verifier((await champ.inputValue()).includes('- [x] Vérifier le trade'), 'rétablir : case cochée');

  // Raccourcis clavier réels.
  await champ.press('Control+End');
  await pc.keyboard.type('\n\nfin');
  await pc.keyboard.press('Shift+Home');
  await pc.keyboard.press('Control+b');
  verifier((await champ.inputValue()).endsWith('**fin**'), 'Ctrl+B met la sélection en gras');
  await pc.keyboard.press('Control+z');
  verifier((await champ.inputValue()).endsWith('\n\nfin'), 'Ctrl+Z annule');
  await pc.getByTestId('esport-repere-note-emoji').click();
  await pc.getByTestId('esport-repere-note-emoji-🔥').click();
  verifier((await champ.inputValue()).includes('🔥'), 'sélecteur d’emoji');
  await champ.press('Control+z');
  await pc.getByTestId('esport-repere-note-voir-apercu').click();
  verifier((await pc.getByTestId('esport-repere-apercu').count()) === 0, 'aperçu replié : plus de place pour l’écriture');
  await pc.getByTestId('esport-repere-note-voir-apercu').click();
  await pc.getByTestId('esport-repere-note-reduire').click();
  await pc.getByTestId('esport-repere-note-agrandi').waitFor({ state: 'detached', timeout: 10_000 });
  verifier((await champ.inputValue()).includes('Vérifier le trade'), 'Réduire : le texte est conservé');

  // ---------------------------------------------------------------- Enregistrer, recharger
  log('PC : enregistrement puis rechargement');
  await pc.getByTestId('esport-repere-enregistrer').click();
  await pc.getByTestId('esport-repere-form').waitFor({ state: 'detached', timeout: 20_000 });
  const repere = await esport.base.premier('SELECT * FROM review_reperes WHERE team_id IS NOT NULL OR 1=1 ORDER BY debut_s', []);
  const enBase = repere?.note ?? '';
  verifier(enBase.includes('# Plan de jeu') && enBase.includes('- [x] Vérifier le trade') && enBase.includes('```\nconst x = 1 &lt; 2;\n```'), 'note enregistrée (< neutralisé dans le code)');
  verifier(!/<[a-z/!]/i.test(enBase) && enBase.includes('{{rouge|alerte}}') && enBase.includes('~~barré~~'), 'serveur : aucun HTML, syntaxes conservées');
  // Une couleur hors liste envoyée directement à l'API est ramenée au texte seul.
  const maj = await api(`/teams/${teamId}/review/${review.id}/reperes/${repere.id}`, sessFond, { methode: 'PATCH', corps: { note: '{{javascript|piège}} {{vert|ok}} <b>x</b> > cite' } });
  verifier(maj.statut === 200 && !/<b>/.test(JSON.stringify(maj.corps)), 'API : mise à jour acceptée');
  const apres = await esport.base.premier('SELECT note FROM review_reperes WHERE id = ?', [repere.id]);
  verifier(apres.note === 'piège {{vert|ok}} &lt;b&gt;x&lt;/b&gt; > cite' || apres.note.startsWith('piège {{vert|ok}} &lt;b&gt;'), `serveur : couleur inconnue retirée, couleur valide gardée (${apres.note})`);
  await api(`/teams/${teamId}/review/${review.id}/reperes/${repere.id}`, sessFond, { methode: 'PATCH', corps: { note: valeur } });

  await pc.reload();
  const premierEcran = await Promise.race([
    pc.getByTestId('hub').waitFor({ timeout: 60_000 }).then(() => 'hub'),
    pc.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 }).then(() => 'verrou'),
  ]);
  if (premierEcran !== 'hub') await deverrouiller(pc, MDP, secret);
  await fermerPopups(pc);
  await ouvrirEsport(pc);
  await pc.getByTestId('esport-team-faucons-valorant').click();
  await ongletTeam(pc, 'module-video_review');
  await pc.getByTestId('esport-review-liste').waitFor({ timeout: 20_000 });
  await pc.locator('[data-testid^="esport-review-"][aria-label^="Ouvrir la review"]').first().click();
  await pc.getByTestId('esport-review-detail').waitFor({ timeout: 20_000 });
  const rendu = pc.getByTestId(`esport-repere-note-${repere.id}`);
  await rendu.waitFor({ timeout: 20_000 });
  const t = await rendu.innerText();
  verifier(t.includes('Plan de jeu') && t.includes('Placer la smoke') && t.includes('const x = 1 < 2;'), 'après rechargement : note rendue (titre, liste, code)');
  await capture(pc, '02-pc-recharge');
  await pc.getByTestId(`esport-repere-modifier-${repere.id}`).click();
  await pc.getByTestId('esport-repere-form').waitFor({ timeout: 10_000 });
  verifier((await pc.getByTestId('esport-repere-note').inputValue()) === valeur, 'après rechargement : la note rouverte en édition est identique (le < du code redevient < dans l’éditeur)');

  // ---------------------------------------------------------------- iPhone
  log('iPhone : barre défilable, menu ⋯, onglets Écrire / Aperçu');
  await pc.setViewportSize({ width: 390, height: 844 });
  await pause(800);
  const barre = pc.getByTestId('esport-repere-note-outils');
  await barre.scrollIntoViewIfNeeded();
  verifier(await barre.evaluate(el => [...el.querySelectorAll('*')].some(x => x.scrollWidth > x.clientWidth + 1 && getComputedStyle(x).overflowX !== 'visible') || el.scrollWidth > el.clientWidth + 1), 'iPhone : barre défilable horizontalement');
  verifier(!(await debordement(pc)), 'iPhone : pas de défilement horizontal de la page');
  const h1 = (await pc.getByTestId('esport-repere-note').boundingBox()).height;
  verifier(h1 >= 8 * 22 - 2, `iPhone : zone de saisie de ${Math.round(h1)} px (8 lignes)`);
  await pc.getByTestId('esport-repere-note-plus').click();
  await pc.getByTestId('esport-repere-note-menu-plus').waitFor({ timeout: 5000 });
  verifier((await pc.getByTestId('esport-repere-note-titre1').count()) === 1 && (await pc.getByTestId('esport-repere-note-titre1').boundingBox()).height >= 43.5, 'iPhone : « ⋯ » ouvre le reste de la mise en forme (44 px)');
  await capture(pc, '03-iphone-barre');
  await pc.getByTestId('esport-repere-note-agrandir').click();
  await pc.getByTestId('esport-repere-note-onglet-apercu').waitFor({ timeout: 10_000 });
  await pc.getByTestId('esport-repere-note-onglet-apercu').click();
  verifier((await pc.getByTestId('esport-repere-apercu').innerText()).includes('Plan de jeu'), 'iPhone : onglet Aperçu');
  await capture(pc, '04-iphone-apercu');
  await pc.getByTestId('esport-repere-note-onglet-ecrire').click();
  await pc.getByTestId('esport-repere-note').waitFor({ timeout: 5000 });
  verifier(!(await debordement(pc)), 'iPhone agrandi : pas de défilement horizontal');
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
console.log(echecs === 0 ? 'e2e notes Esport : tout est bon' : `e2e notes Esport : ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
