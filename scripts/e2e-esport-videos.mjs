/**
 * Test de bout en bout des vidéos déposées et de la transcription des réunions (Esport), sans réseau
 * externe (ni YouTube, ni modèle Whisper : un FAUX transcripteur est injecté dans la page) :
 *
 *  - PC (1440 × 900), le Fondateur : une petite vidéo MP4 est GÉNÉRÉE dans le navigateur (canvas +
 *    MediaRecorder, quelques secondes), déposée par morceaux (barre de progression), la review s'ouvre
 *    sur le lecteur maison : lecture en streaming (réponses 206), avance au temps 2 s (seek), image par
 *    image (touche « . »), plein écran, ajout d'un repère (touche M) et d'un dessin sur la vidéo ;
 *  - Réunion : dépôt d'un fichier AUDIO de test (WAV généré), « Transcrire automatiquement » : extraction
 *    de l'audio dans le navigateur (Web Audio, 16 kHz), transcripteur simulé, PDF généré par le serveur,
 *    téléchargé et vérifié ; correction d'une phrase dans l'éditeur (nouveau PDF) ;
 *  - Paramètres : « Espace utilisé » liste la vidéo, l'enregistrement et le PDF.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-esport-videos.mjs
 *
 * Variable : CAPTURES (dossier des captures, défaut docs/captures-esport-videos).
 */

import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ongletTeam } from './esport-navigation.mjs';
import { allerPageApplications, nouveauContexte, tuileApp } from './e2e-acceptation.mjs';
import { chargerPlaywright, demarrerRelais, deverrouiller, pause, premierLancement, racine } from './mobile-outils.mjs';

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-esport-videos');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-esport-videos-0123456789abcdef';
const PORT_RELAIS = 8861;
const PORT_ESPORT = 8862;
const PORT_SITE = 5307;
const MDP = 'mot-de-passe-videos-e2e-tres-long-42';
const log = (...a) => console.log('[e2e-videos]', ...a);
let echecs = 0;
const verifier = (ok, message) => {
  console.log(ok ? '  OK   ' : '  ECHEC', message);
  if (!ok) echecs++;
};
const capture = async (page, nom) => {
  await pause(400);
  await page.screenshot({ path: join(CAPTURES, `${nom}.jpg`), type: 'jpeg', quality: 70 });
};

const { demarrerServeurEsport } = await import(pathToFileURL(join(racine, 'esport/outils/serveur-local.mjs')).href);
const { wavFactice } = await import(pathToFileURL(join(racine, 'esport/test/medias-aide.mjs')).href);

const relais = await demarrerRelais(PORT_RELAIS, JETON);
// Morceaux de 64 Kio : la petite vidéo part en plusieurs morceaux (progression, SHA-256 de chacun).
const esport = await demarrerServeurEsport({ port: PORT_ESPORT, jetonDev: JETON, medias: { plafond: 50 * 1024 * 1024, tailleMorceau: 64 * 1024 } });
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
  try {
    return { statut: r.status, corps: JSON.parse(texte) };
  } catch {
    return { statut: r.status, corps: texte };
  }
}
const attendre = async (fn, essais = 80, ms = 250) => {
  for (let i = 0; i < essais; i++) {
    const v = await fn();
    if (v) return v;
    await pause(ms);
  }
  return undefined;
};
async function fermerPopups(page) {
  for (let i = 0; i < 3; i++) {
    const clique = await page.getByText(/^(Fermer|Terminé|Compris|Plus tard)$/).first().click({ timeout: 2000 }).then(() => true, () => false);
    if (!clique) break;
  }
}

/** Faux transcripteur (aucun modèle, aucun réseau) : garde la taille de l'audio reçu (16 kHz attendu). */
const FAUX_TRANSCRIPTEUR = `
window.__esportTranscripteurFactice = () => ({
  nom: 'Faux Whisper (e2e)',
  transcrire: async pcm => {
    window.__audio = (window.__audio || []).concat(pcm.length);
    const s = pcm.length / 16000;
    return [
      { timestamp: [0, Math.min(1.5, s)], text: ' Bonjour à tous, réunion de test.' },
      { timestamp: [1.5, s], text: ' On revoit la rotation vers B.' },
    ];
  },
});`;

const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const sessFond = (await api('/session', JETON, { methode: 'POST' })).corps.session;
  await api('/moi', sessFond, { methode: 'PUT', corps: { pseudo: 'Fondateur' } });
  const teamId = (await api('/teams', sessFond, { methode: 'POST', corps: { nom: 'Faucons Valorant', jeu: 'valorant', preset: 'valorant_complet' } })).corps.team.id;
  verifier(Boolean(teamId), 'team prête (API)');

  const ctx = await nouveauContexte(navigateur, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true, acceptDownloads: true });
  await ctx.addInitScript(FAUX_TRANSCRIPTEUR);
  await ctx.route(/^https:\/\/([a-z0-9-]+\.)?(youtube\.com|youtube-nocookie\.com|ytimg\.com|jsdelivr\.net|huggingface\.co)\//, route => route.abort());
  const pc = await ctx.newPage();
  pc.on('pageerror', e => log('erreur page :', e.message));
  const reponses = [];
  pc.on('response', r => {
    if (r.url().includes('/fichiers/')) reponses.push({ statut: r.status(), plage: r.request().headers().range ?? null });
  });
  const secret = await premierLancement(pc, { site: leSite.url, code: relais.code, motDePasse: MDP });
  await pc.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(pc, MDP, secret));
  await fermerPopups(pc);
  await allerPageApplications(pc);
  await tuileApp(pc, 'esport').first().click();
  await pc.getByTestId('app-esport').waitFor({ timeout: 20_000 });
  await pc.getByTestId('esport-nav-teams').click().catch(() => undefined);
  await pc.getByTestId('esport-team-faucons-valorant').click();

  // ================================================================ Vidéo générée dans le navigateur
  log('PC : génération d’une petite vidéo MP4 (canvas + MediaRecorder)');
  const genere = await pc.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 180;
    const g = c.getContext('2d');
    const type = ['video/mp4;codecs=avc1', 'video/mp4;codecs=vp9', 'video/mp4'].find(t => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(c.captureStream(30), { mimeType: type, videoBitsPerSecond: 2_500_000 });
    const parts = [];
    rec.ondataavailable = e => parts.push(e.data);
    let f = 0;
    const dessiner = () => {
      g.fillStyle = `hsl(${(f * 9) % 360} 70% 40%)`;
      g.fillRect(0, 0, 320, 180);
      g.fillStyle = '#fff';
      g.font = 'bold 64px sans-serif';
      g.fillText(String(f), 30, 120);
      f++;
    };
    dessiner();
    const t = setInterval(dessiner, 33);
    rec.start(250);
    await new Promise(r => setTimeout(r, 4500));
    rec.stop();
    await new Promise(r => (rec.onstop = r));
    clearInterval(t);
    const o = new Uint8Array(await new Blob(parts, { type }).arrayBuffer());
    let s = '';
    for (let i = 0; i < o.length; i += 0x8000) s += String.fromCharCode(...o.subarray(i, i + 0x8000));
    return { b64: btoa(s), type };
  });
  const video = Buffer.from(genere.b64, 'base64');
  verifier(video.length > 64 * 1024 && video.subarray(4, 8).toString() === 'ftyp', `vidéo MP4 générée (${genere.type}, ${Math.round(video.length / 1024)} Kio)`);

  // ================================================================ Dépôt par morceaux
  await ongletTeam(pc, 'module-video_review');
  await pc.getByTestId('esport-review-source-fichier').click();
  const choix = pc.waitForEvent('filechooser');
  await pc.getByTestId('esport-review-fichier').click();
  await (await choix).setFiles({ name: 'scrim-ascent.mp4', mimeType: 'video/mp4', buffer: video });
  await pc.getByTestId('esport-review-fichier-infos').waitFor({ timeout: 10_000 });
  await pc.getByTestId('esport-review-titre').fill('Scrim Ascent (vidéo déposée)');
  await capture(pc, '01-pc-depot-video');
  await pc.getByTestId('esport-review-creer-fichier').click();
  const barreVue = await pc.getByTestId('esport-review-envoi').waitFor({ timeout: 10_000 }).then(() => true, () => false);
  verifier(barreVue, 'barre de progression de l’envoi affichée');
  await pc.getByTestId('esport-review-detail').waitFor({ timeout: 60_000 });
  const review = await attendre(() => esport.base.premier("SELECT * FROM reviews WHERE source = 'fichier'", []));
  const fichier = review ? await esport.base.premier('SELECT * FROM fichiers WHERE id = ?', [review.fichier_id]) : null;
  verifier(fichier?.taille === video.length && fichier.entite_type === 'review_video', `review créée sur le fichier déposé (${fichier?.taille} octets)`);
  const envoi = await esport.base.premier('SELECT * FROM envois WHERE fichier_id = ?', [fichier?.id ?? '']);
  verifier(envoi && Number(envoi.morceaux) === Math.ceil(video.length / 65536) && Number(envoi.recus) === Number(envoi.morceaux), `envoi en ${envoi?.morceaux} morceaux, tous reçus et vérifiés`);

  // ================================================================ Lecture : streaming, seek, image par image, plein écran
  log('PC : lecture (Range), seek, image par image, plein écran');
  await pc.waitForFunction(() => (document.querySelector('[data-testid="esport-video"]')?.readyState ?? 0) >= 1, null, { timeout: 30_000 });
  verifier(reponses.some(r => r.statut === 206 && r.plage), `lecture en streaming : réponse 206 à une requête Range (${reponses.map(r => r.statut).join(', ')})`);
  const seek = await pc.evaluate(
    () =>
      new Promise(ok => {
        const v = document.querySelector('[data-testid="esport-video"]');
        v.addEventListener('seeked', () => ok(v.currentTime), { once: true });
        v.currentTime = 2;
        setTimeout(() => ok(-1), 15000);
      }),
  );
  verifier(Math.abs(seek - 2) < 0.2, `seek à 2 s (${seek})`);
  await pc.getByTestId('esport-review-nom').click();
  await pc.keyboard.press('.');
  await pause(500);
  const apres = await pc.evaluate(() => {
    const v = document.querySelector('[data-testid="esport-video"]');
    return { t: v.currentTime, pause: v.paused };
  });
  verifier(apres.pause && apres.t > seek && apres.t - seek < 0.1, `image suivante (touche « . ») : ${seek.toFixed(3)} → ${apres.t.toFixed(3)} s, vidéo en pause`);
  await pc.getByTestId('esport-lecteur-image-precedente').click();
  await pause(300);
  const avant = await pc.evaluate(() => document.querySelector('[data-testid="esport-video"]').currentTime);
  verifier(avant < apres.t, `image précédente (bouton) : ${avant.toFixed(3)} s`);
  const pleinEcran = await pc
    .getByTestId('esport-lecteur-plein-ecran')
    .click()
    .then(() => pc.waitForFunction(() => document.fullscreenElement?.getAttribute('data-testid') === 'esport-lecteur-cadre', null, { timeout: 5000 }))
    .then(() => true, () => false);
  verifier(pleinEcran, 'plein écran : le cadre (vidéo + calque de dessin) passe en plein écran');
  if (pleinEcran) await pc.evaluate(() => document.exitFullscreen());
  verifier((await pc.getByTestId('esport-lecteur-avertissement').count()) === (/avc1/.test(genere.type) ? 0 : 1), 'avertissement « peu compatible avec iPhone » si le codec n’est pas H.264');
  await capture(pc, '02-pc-lecteur-maison');

  // ================================================================ Repère (touche M) et dessin
  log('PC : repère et dessin sur la vidéo déposée');
  await pc.evaluate(() => {
    const v = document.querySelector('[data-testid="esport-video"]');
    v.pause();
    v.currentTime = 1.5;
  });
  await pause(500);
  await pc.getByTestId('esport-review-nom').click();
  await pc.keyboard.press('m');
  await pc.getByTestId('esport-repere-form').waitFor({ timeout: 10_000 });
  await pc.getByTestId('esport-repere-titre').fill('Rotation trop lente');
  await pc.getByTestId('esport-repere-enregistrer').click();
  await pc.getByTestId('esport-repere-form').waitFor({ state: 'detached', timeout: 20_000 });
  const repere = await attendre(() => esport.base.premier("SELECT * FROM review_reperes WHERE titre = 'Rotation trop lente'", []));
  verifier(repere && Math.abs(repere.debut_s - 1.5) <= 0.6, `repère ajouté au temps de la vidéo (${repere?.debut_s} s)`);
  await pc.getByTestId('esport-review-dessiner').click();
  await pc.getByTestId('esport-dessin-barre').waitFor({ timeout: 10_000 });
  const calque = pc.getByTestId('esport-dessin-calque');
  await calque.locator('canvas').first().waitFor({ timeout: 30_000 });
  const boite = await calque.boundingBox();
  const zone = await pc.getByTestId('esport-lecteur-zone').boundingBox();
  verifier(boite && zone && Math.abs(boite.width - zone.width) < 2 && Math.abs(boite.height - zone.height) < 2, 'le calque de dessin couvre exactement la vidéo');
  const point = (fx, fy) => [boite.x + boite.width * fx, boite.y + boite.height * fy];
  await pc.mouse.move(...point(0.2, 0.3));
  await pc.mouse.down();
  for (let i = 1; i <= 10; i++) await pc.mouse.move(...point(0.2 + 0.04 * i, 0.3 + 0.04 * i));
  await pc.mouse.up();
  await pc.getByTestId('esport-dessin-enregistrer').click();
  await pc.getByTestId('esport-dessin-barre').waitFor({ state: 'detached', timeout: 20_000 });
  const dessine = await attendre(() => esport.base.premier('SELECT * FROM review_reperes WHERE dessin IS NOT NULL', []));
  verifier(JSON.parse(dessine?.dessin ?? '{}').objets?.[0]?.t === 'fleche', 'dessin (flèche) enregistré sur la vidéo déposée');
  await capture(pc, '03-pc-repere-dessin');

  // ================================================================ Réunion : audio déposé, transcription simulée, PDF
  log('PC : dépôt d’une réunion (audio) et transcription automatique (transcripteur simulé)');
  await ongletTeam(pc, 'module-meeting_summaries');
  await pc.getByTestId('esport-depot-formulaire').waitFor({ timeout: 20_000 });
  const audio = Buffer.from(wavFactice(3, 22050));
  const choixAudio = pc.waitForEvent('filechooser');
  await pc.getByTestId('esport-depot-fichier').click();
  await (await choixAudio).setFiles({ name: 'reunion-hebdo.wav', mimeType: 'audio/wav', buffer: audio });
  await pc.getByTestId('esport-depot-fichier-infos').waitFor({ timeout: 10_000 });
  await pc.getByTestId('esport-depot-titre').fill('Réunion hebdo (test)');
  // La case dessine « ✓ » quand elle est cochée.
  const estCochee = async () => (await pc.getByTestId('esport-depot-transcrire').innerText()).includes('✓');
  const coche = (await estCochee()) ? 'true' : 'false';
  const appareil = await pc.evaluate(() => ({ memoire: navigator.deviceMemory, coeurs: navigator.hardwareConcurrency }));
  // Coché par défaut sur un PC ; décoché (conseil « depuis un PC ») si le navigateur annonce un appareil faible.
  const faible = (appareil.memoire ?? 8) < 4 || (appareil.coeurs ?? 8) < 4;
  verifier(coche === (faible ? 'false' : 'true'), `« Transcrire automatiquement » : ${coche === 'true' ? 'coché' : 'décoché'} par défaut (mémoire ${appareil.memoire} Go, ${appareil.coeurs} cœurs)`);
  if (coche !== 'true') await pc.getByTestId('esport-depot-transcrire').click();
  verifier(await estCochee(), 'transcription automatique demandée');
  await capture(pc, '04-pc-depot-reunion');
  await pc.getByTestId('esport-depot-envoyer').click();
  const reunion = await attendre(() => esport.base.premier("SELECT * FROM reunions WHERE titre = 'Réunion hebdo (test)'", []), 120);
  verifier(reunion && reunion.lien === '' && reunion.enregistrement_id, 'réunion déposée avec son enregistrement (sans lien externe)');
  const bandeau = await pc.getByTestId('esport-transcriptions-bandeau').waitFor({ timeout: 20_000 }).then(() => true, () => false);
  if (!bandeau) log('pas de bandeau ; erreurs affichées :', await pc.locator('[data-testid$="-erreur"]').allInnerTexts(), await pc.locator('[data-testid$="-avis"]').allInnerTexts());
  verifier(bandeau, 'bandeau de la transcription en cours (visible sur tous les écrans de l’Esport)');
  const prete = await attendre(async () => (await esport.base.premier('SELECT transcription_statut FROM reunions WHERE id = ?', [reunion?.id ?? '']))?.transcription_statut === 'prete', 120);
  verifier(prete, 'transcription prête (bandeau, sans quitter l’app)');
  const tailles = await pc.evaluate(() => window.__audio ?? []);
  verifier(tailles.length === 1 && Math.abs(tailles[0] - 48000) < 200, `audio extrait dans le navigateur : 16 kHz mono (${tailles.join(', ')} échantillons pour 3 s)`);
  const transcription = await esport.base.premier('SELECT * FROM transcriptions WHERE reunion_id = ?', [reunion?.id ?? '']);
  const segments = JSON.parse(transcription?.segments ?? '[]');
  verifier(segments.length === 2 && segments[0][2] === 'Bonjour à tous, réunion de test.' && transcription.moteur === 'Faux Whisper (e2e)', 'segments horodatés enregistrés');
  await pc.getByTestId(`esport-transcription-bandeau-${reunion.id}-etat`).waitFor({ timeout: 10_000 });
  await capture(pc, '05-pc-transcription-prete');

  // PDF : téléchargé par le lien signé de l'app.
  await pc.getByTestId('esport-resumes-vue-miens').click();
  await pc.getByTestId(`esport-transcription-${reunion.id}`).waitFor({ timeout: 20_000 });
  verifier((await pc.getByTestId(`esport-transcription-${reunion.id}-statut`).innerText()).includes('prête'), 'Mes dépôts : « Transcription prête »');
  const lienPdf = pc.waitForResponse(r => r.url().includes('/transcription/lien'));
  const onglet = ctx.waitForEvent('page').catch(() => undefined);
  await pc.getByTestId(`esport-transcription-${reunion.id}-telecharger`).click();
  const urlPdf = (await (await lienPdf).json()).url;
  (await onglet)?.close().catch(() => undefined);
  const pdf = Buffer.from(await (await fetch(urlPdf)).arrayBuffer());
  const textePdf = pdf.toString('latin1');
  verifier(textePdf.startsWith('%PDF-') && /\(00:00:00\) Tj/.test(textePdf) && /R\\351union hebdo \(test\)|R\\351union hebdo \\\(test\\\)/.test(textePdf) && /\(Faucons Valorant\) Tj/.test(textePdf), `PDF de transcription téléchargé (${pdf.length} octets) : titre, team, timecodes`);

  // Correction dans l'éditeur : nouveau PDF.
  const ancienPdf = (await esport.base.premier('SELECT transcription_pdf_id FROM reunions WHERE id = ?', [reunion.id])).transcription_pdf_id;
  await pc.getByTestId(`esport-transcription-${reunion.id}-editeur`).click();
  await pc.getByTestId('esport-transcription-segment-1').fill('On revoit la rotation vers le site B.');
  await capture(pc, '06-pc-editeur-transcription');
  await pc.getByTestId('esport-transcription-enregistrer').click();
  const corrige = await attendre(async () => {
    const x = await esport.base.premier('SELECT r.transcription_pdf_id, t.segments FROM reunions r JOIN transcriptions t ON t.reunion_id = r.id WHERE r.id = ?', [reunion.id]);
    return x && x.transcription_pdf_id !== ancienPdf && x.segments.includes('site B') ? x : undefined;
  });
  verifier(Boolean(corrige), 'correction enregistrée : nouveau PDF généré');

  // ================================================================ Espace utilisé
  await ongletTeam(pc, 'parametres');
  await pc.getByTestId('esport-espace-total').waitFor({ timeout: 20_000 });
  const lignes = await pc.locator('[data-testid^="esport-espace-fichier-"]').count();
  verifier(lignes >= 3, `Espace utilisé : ${lignes} fichiers (vidéo, enregistrement, PDF) — total ${await pc.getByTestId('esport-espace-total').innerText()}`);
  await pc.getByTestId('esport-espace').scrollIntoViewIfNeeded();
  await capture(pc, '07-pc-espace-utilise');
} finally {
  await navigateur.close();
  leSite.fermer();
  relais.fermer();
  await esport.fermer();
}
console.log(echecs === 0 ? 'e2e vidéos et transcription Esport : tout est bon' : `e2e vidéos et transcription Esport : ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
