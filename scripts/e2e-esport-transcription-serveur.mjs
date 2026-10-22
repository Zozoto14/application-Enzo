/**
 * Test de bout en bout de la transcription SUR LE SERVEUR (Esport, migration 0016), sans modèle ni
 * réseau externe : le serveur Esport local est déclaré « transcription installée » et le processus de
 * fond (esport/serveur/transcription/travailleur.mjs) tourne ici avec un transcripteur SIMULÉ.
 *
 *  - PC (1440 × 900), le Fondateur : Paramètres de la team › « Transcription des réunions » (mode par
 *    défaut : Serveur) ;
 *  - Résumés › Déposer : un audio WAV ; « Transcrire automatiquement » coché, mode « Serveur
 *    (automatique) » présélectionné ; dépôt → travail en file (« En file d'attente sur le serveur ») ;
 *  - le processus de fond transcrit par morceaux de 30 s au plus (progression visible dans l'app),
 *    génère le PDF et notifie : l'écran passe tout seul à « Transcription prête » ; PDF téléchargé et
 *    vérifié ; notification « transcription prête » reçue.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-esport-transcription-serveur.mjs
 *
 * Variable : CAPTURES (dossier des captures, défaut docs/captures-esport-transcription-serveur).
 */

import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ongletTeam } from './esport-navigation.mjs';
import { allerPageApplications, nouveauContexte, tuileApp } from './e2e-acceptation.mjs';
import { chargerPlaywright, demarrerRelais, deverrouiller, pause, premierLancement, racine } from './mobile-outils.mjs';

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-esport-transcription-serveur');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-esport-transcription-serveur-0123456789';
const PORT_RELAIS = 8895;
const PORT_ESPORT = 8896;
const PORT_SITE = 5335;
const MDP = 'mot-de-passe-transcription-e2e-tres-long-42';
const log = (...a) => console.log('[e2e-transcription-serveur]', ...a);
let echecs = 0;
const verifier = (ok, message) => {
  console.log(ok ? '  OK   ' : '  ECHEC', message);
  if (!ok) echecs++;
};
const capture = async (page, nom) => {
  await pause(400);
  await page.screenshot({ path: join(CAPTURES, `${nom}.jpg`), type: 'jpeg', quality: 70 });
};

const imp = chemin => import(pathToFileURL(join(racine, chemin)).href);
const { demarrerServeurEsport } = await imp('esport/outils/serveur-local.mjs');
const { wavFactice } = await imp('esport/test/medias-aide.mjs');
const { configTranscriptionServeur } = await imp('esport/noyau/medias/fileTranscription.mjs');
const { servicesMedias } = await imp('esport/noyau/medias/service.mjs');
const { servicesResumes } = await imp('esport/noyau/resumes.mjs');
const { distribuer } = await imp('esport/noyau/evenements.mjs');
const { executerTravaux } = await imp('esport/serveur/transcription/travailleur.mjs');

const SERVEUR = { ...configTranscriptionServeur({}), disponible: true, repos: 0 };
const relais = await demarrerRelais(PORT_RELAIS, JETON);
const esport = await demarrerServeurEsport({ port: PORT_ESPORT, jetonDev: JETON, medias: { plafond: 50 * 1024 * 1024, tailleMorceau: 256 * 1024 }, transcriptionServeur: SERVEUR });
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
/** Segment choisi ? (react-native-web ne rend pas toujours aria-checked : le segment choisi a le fond de l'accent). */
async function segmentActif(page, testID) {
  const attributs = await page.getByTestId(testID).evaluate(n => ({ checked: n.getAttribute('aria-checked'), fond: getComputedStyle(n).backgroundColor, html: n.outerHTML.slice(0, 300) }));
  const actif = attributs.checked === 'true' || !['transparent', 'rgba(0, 0, 0, 0)'].includes(attributs.fond);
  if (!actif) log('segment', testID, attributs.html);
  return actif;
}
async function fermerPopups(page) {
  for (let i = 0; i < 3; i++) {
    const clique = await page.getByText(/^(Fermer|Terminé|Compris|Plus tard)$/).first().click({ timeout: 2000 }).then(() => true, () => false);
    if (!clique) break;
  }
}

const dossierTravail = mkdtempSync(join(tmpdir(), 'e2e-transcription-'));
const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
try {
  const sessFond = (await api('/session', JETON, { methode: 'POST' })).corps.session;
  await api('/moi', sessFond, { methode: 'PUT', corps: { pseudo: 'Fondateur' } });
  const teamId = (await api('/teams', sessFond, { methode: 'POST', corps: { nom: 'Faucons Valorant', jeu: 'valorant', preset: 'valorant_complet' } })).corps.team.id;
  verifier(Boolean(teamId), 'team prête (API)');
  verifier((await api('/sante')).corps.medias?.transcriptionServeur === true, '/sante : transcription sur le serveur installée');

  const ctx = await nouveauContexte(navigateur, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true, acceptDownloads: true });
  // Aucun modèle dans le navigateur : la transcription doit se faire sur le serveur.
  await ctx.route(/^https:\/\/([a-z0-9-]+\.)?(jsdelivr\.net|huggingface\.co)\//, route => route.abort());
  const pc = await ctx.newPage();
  pc.on('pageerror', e => log('erreur page :', e.message));
  const secret = await premierLancement(pc, { site: leSite.url, code: relais.code, motDePasse: MDP });
  await pc.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(pc, MDP, secret));
  await fermerPopups(pc);
  await allerPageApplications(pc);
  await tuileApp(pc, 'esport').first().click();
  await pc.getByTestId('app-esport').waitFor({ timeout: 20_000 });
  await pc.getByTestId('esport-nav-teams').click().catch(() => undefined);
  await pc.getByTestId('esport-team-faucons-valorant').click();

  // ================================================================ Paramètres de la team
  log('PC : Paramètres › Transcription des réunions');
  await ongletTeam(pc, 'parametres');
  const reglages = pc.getByTestId('esport-parametres-transcription');
  await reglages.waitFor({ timeout: 20_000 });
  verifier(await segmentActif(pc, 'esport-parametres-transcription-mode-serveur'), 'mode par défaut de la team : « Serveur (automatique) »');
  await pc.getByTestId('esport-parametres-transcription-mode-navigateur').click();
  const navigateurChoisi = await attendre(async () => (await api(`/teams/${teamId}/resumes/reglages-transcription`, sessFond)).corps.choisi === 'navigateur');
  verifier(Boolean(navigateurChoisi), 'Paramètres : « Navigateur (ce PC) » enregistré');
  await reglages.scrollIntoViewIfNeeded();
  await capture(pc, '01-parametres-transcription');
  await pc.getByTestId('esport-parametres-transcription-defaut').click();
  verifier(Boolean(await attendre(async () => (await api(`/teams/${teamId}/resumes/reglages-transcription`, sessFond)).corps.choisi === null)), 'Paramètres : retour au réglage du serveur (Serveur)');

  // ================================================================ Dépôt : mode serveur
  log('PC : dépôt d’une réunion (audio), transcription sur le serveur');
  await ongletTeam(pc, 'module-meeting_summaries');
  await pc.getByTestId('esport-depot-formulaire').waitFor({ timeout: 20_000 });
  const audio = Buffer.from(wavFactice(70, 8000));
  const choixAudio = pc.waitForEvent('filechooser');
  await pc.getByTestId('esport-depot-fichier').click();
  await (await choixAudio).setFiles({ name: 'reunion-hebdo.wav', mimeType: 'audio/wav', buffer: audio });
  await pc.getByTestId('esport-depot-fichier-infos').waitFor({ timeout: 10_000 });
  await pc.getByTestId('esport-depot-titre').fill('Réunion serveur (test)');
  verifier((await pc.getByTestId('esport-depot-transcrire').innerText()).includes('✓'), '« Transcrire automatiquement » coché par défaut');
  await pc.getByTestId('esport-depot-mode-transcription-serveur').waitFor({ timeout: 10_000 });
  verifier(await segmentActif(pc, 'esport-depot-mode-transcription-serveur'), 'mode « Serveur (automatique) » présélectionné');
  verifier((await pc.getByTestId('esport-depot-mode-explication').innerText()).includes('fermer l’app'), 'explication : on peut fermer l’app');
  await capture(pc, '02-depot-mode-serveur');
  await pc.getByTestId('esport-depot-envoyer').click();
  const reunion = await attendre(() => esport.base.premier("SELECT * FROM reunions WHERE titre = 'Réunion serveur (test)'", []), 120);
  verifier(reunion?.transcription_statut === 'serveur', `réunion déposée, transcription confiée au serveur (${reunion?.transcription_statut})`);
  const travail = await esport.base.premier('SELECT * FROM travaux_transcription WHERE reunion_id = ?', [reunion?.id ?? '']);
  verifier(travail?.statut === 'attente', 'travail « à transcrire » mis en file en base');
  verifier((await pc.getByTestId('esport-transcriptions-bandeau').count()) === 0, 'aucune transcription dans le navigateur');

  // Mes dépôts : état du travail.
  await pc.getByTestId(`esport-transcription-${reunion.id}-serveur-etat`).waitFor({ timeout: 20_000 });
  verifier((await pc.getByTestId(`esport-transcription-${reunion.id}-serveur-etat`).innerText()).includes('En file d’attente sur le serveur'), 'Mes dépôts : « En file d’attente sur le serveur »');
  await capture(pc, '03-en-file');

  // ================================================================ Processus de fond (simulé) : morceaux, PDF, notification
  log('Serveur : processus de transcription (transcripteur simulé, morceaux de 30 s)');
  const socle = { contexteTeam: async () => { throw new Error('pas de contexte'); } };
  const medias = servicesMedias({ base: esport.base, stockage: esport.stockage, cleSession: 'x'.repeat(40), socle });
  const resumes = servicesResumes({ base: esport.base, stockage: esport.stockage, cleSession: 'x'.repeat(40), socle, medias, transcriptionServeur: SERVEUR });
  let morceaux = 0;
  let vuEnCours = false;
  const bilan = await executerTravaux({
    resumes,
    stockage: esport.stockage,
    config: SERVEUR,
    dossierTravail,
    journal: { log() {}, error: (...a) => log(...a) },
    apresTravail: () => distribuer(esport.base, { maintenant: Date.now() }),
    creerTranscripteur: async () => ({
      moteur: 'Whisper simulé (serveur)',
      async transcrireMorceau(pcm) {
        morceaux += 1;
        // Au 2e morceau, l'app (rafraîchie toutes les 15 s) montre la progression.
        if (morceaux === 2) {
          vuEnCours = await pc
            .waitForFunction(id => /Sur le serveur : \d+/.test(document.querySelector(`[data-testid="esport-transcription-${id}-serveur-etat"]`)?.textContent ?? ''), reunion.id, { timeout: 40_000 })
            .then(() => true, () => false);
          await capture(pc, '04-progression-serveur');
        }
        return { texte: morceaux === 1 ? 'Bonjour à tous, réunion de test sur le serveur.' : `On revoit la rotation, morceau ${morceaux} (${(pcm.length / 16000).toFixed(0)} s).`, langue: 'fr' };
      },
    }),
  });
  verifier(bilan.termines === 1 && morceaux === 3, `processus de fond : ${bilan.termines} transcription terminée, ${morceaux} morceaux (70 s)`);
  verifier(vuEnCours, 'progression visible dans l’app pendant le travail (« Sur le serveur : … % »)');

  // L'écran passe tout seul à « Transcription prête » (suivi toutes les 15 s).
  const prete = await pc
    .waitForFunction(id => document.querySelector(`[data-testid="esport-transcription-${id}-statut"]`)?.textContent?.includes('prête'), reunion.id, { timeout: 40_000 })
    .then(() => true, () => false);
  verifier(prete, 'l’écran passe tout seul à « Transcription prête »');
  await capture(pc, '05-transcription-prete');
  const transcription = await esport.base.premier('SELECT * FROM transcriptions WHERE reunion_id = ?', [reunion.id]);
  const segments = JSON.parse(transcription?.segments ?? '[]');
  verifier(segments.length === 3 && segments[0][0] === 0 && segments.every(s => s[1] - s[0] <= 30), 'segments horodatés (≤ 30 s) enregistrés');

  // PDF (généré par le serveur), téléchargé par le lien signé de l'app.
  await pc.getByTestId(`esport-transcription-${reunion.id}-telecharger`).waitFor({ timeout: 20_000 });
  const lienPdf = pc.waitForResponse(r => r.url().includes('/transcription/lien'));
  const onglet = ctx.waitForEvent('page').catch(() => undefined);
  await pc.getByTestId(`esport-transcription-${reunion.id}-telecharger`).click();
  const urlPdf = (await (await lienPdf).json()).url;
  (await onglet)?.close().catch(() => undefined);
  const pdf = Buffer.from(await (await fetch(urlPdf)).arrayBuffer());
  const textePdf = pdf.toString('latin1');
  verifier(textePdf.startsWith('%PDF-') && /\(00:00:00\) Tj/.test(textePdf) && /Whisper simul\\351 \\\(serveur\\\)|Whisper simul\\351 \(serveur\)/.test(textePdf), `PDF prêt (${pdf.length} octets) : timecodes, moteur « Whisper simulé (serveur) »`);

  // Notification au déposant.
  const notifs = (await api('/notifications', sessFond)).corps.liste ?? [];
  verifier(notifs.some(n => n.type === 'transcription-prete' && n.charge?.reunion === reunion.id), 'notification « transcription prête » au déposant');
  verifier((await api(`/teams/${teamId}/resumes/${reunion.id}/transcription`, sessFond)).corps.travail?.statut === 'termine', 'travail « terminé » dans la file');
} finally {
  await navigateur.close();
  leSite.fermer();
  relais.fermer();
  await esport.fermer();
  rmSync(dossierTravail, { recursive: true, force: true });
}
console.log(echecs === 0 ? 'e2e transcription sur le serveur : tout est bon' : `e2e transcription sur le serveur : ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
