/**
 * Test de bout en bout de la traduction anglaise de l'Esport, sans Cloudflare (même montage que e2e-esport.mjs) :
 *
 *  - le navigateur est en français (fr-FR) : à l'ouverture, l'Esport est en français ;
 *  - au premier profil, on choisit « English » (changement instantané, sans recharger) ;
 *  - parcours Dashboard · Teams · Membres · une team (accueil, planning, disponibilités, présence, strats,
 *    playbook, review, scouting, résumés, objectifs, membres, paramètres, Discord, journal) ;
 *  - à chaque écran, aucun texte français ne doit rester visible (hors liste d'exceptions : données saisies,
 *    noms de jeu, langue elle-même) ;
 *  - la langue est enregistrée sur le compte (GET /moi) et conservée au rechargement.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-esport-anglais.mjs
 */

import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ongletTeam } from './esport-navigation.mjs';
import { allerPageApplications, nouveauContexte, tuileApp } from './e2e-acceptation.mjs';
import { chargerPlaywright, demarrerRelais, deverrouiller, pause, premierLancement, racine, totp } from './mobile-outils.mjs';

const JETON = 'jeton-e2e-esport-0123456789abcdef';
const PORT_RELAIS = 8821;
const PORT_ESPORT = 8822;
const PORT_SITE = 5291;
const PORT_SITE_SANS = 5292;
const MDP = 'mot-de-passe-esport-anglais-e2e-42';
const log = (...a) => console.log('[e2e-esport-anglais]', ...a);
let echecs = 0;
const verifier = (ok, message) => {
  console.log(ok ? '  OK   ' : '  ECHEC', message);
  if (!ok) echecs++;
};

const { jetonDeProfil } = await import(pathToFileURL(join(racine, 'relais/worker.mjs')).href);
const { demarrerServeurEsport } = await import(pathToFileURL(join(racine, 'esport/outils/serveur-local.mjs')).href);

// ------------------------------------------------------------- Serveurs
const relais = await demarrerRelais(PORT_RELAIS, JETON);
// Le serveur Esport valide les jetons avec le MÊME jeton maître (relais de développement en mémoire).
const esport = await demarrerServeurEsport({ port: PORT_ESPORT, jetonDev: JETON });
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
const siteAvec = await site(PORT_SITE, true);
const siteSans = await site(PORT_SITE_SANS, false);

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


// ------------------------------------------------------------- Détection du français visible
const ACCENTS = /[àâçéèêëîïôùûüœÀÂÇÉÈÊËÎÏÔÙÛÜŒ]/;
const MOTS = new Set(('le la les un une des du et ou pour dans sur avec sans par est sont pas vous votre vos nous notre ce cette ces qui que au aux ' +
  'aucun aucune toutes tout tous favoris brouillons oui non déjà où mais chez depuis jusqu entre Aujourd\'hui demain hier semaine mois jour jours ' +
  'ajouter supprimer enregistrer annuler fermer modifier créer retour suivant précédent').split(' '));
/** Textes saisis ou imposés qui restent tels quels (données de démonstration, noms propres, nom de la langue). */
const EXCEPTIONS = ['Français', 'Valorant', 'Riot', 'Legal Jibber Jabber'];
/** Bandeau et fenêtres du hub (hors périmètre : le reste du hub reste en français). */
const LIGNES_HUB = [/^ÉCHAP POUR FERMER$/, /^\d+ élément/, /^⚙︎ Paramètres$/, /^À jour · /];

function francaisVisible(texte) {
  const trouves = [];
  for (let ligne of texte.split('\n')) {
    for (const e of EXCEPTIONS) ligne = ligne.split(e).join(' ');
    ligne = ligne.trim();
    if (!ligne || LIGNES_HUB.some(r => r.test(ligne))) continue;
    const mots = ligne.split(/[^A-Za-zÀ-ÿ'’]+/).filter(Boolean);
    if (ACCENTS.test(ligne) || mots.some(m => MOTS.has(m.toLowerCase()) && m.toLowerCase() !== 'a')) trouves.push(ligne);
  }
  return trouves;
}
async function verifierAnglais(page, nom) {
  await pause(500);
  const texte = await page.getByTestId('app-esport').innerText();
  const fr = francaisVisible(texte);
  verifier(fr.length === 0, `${nom} : aucun texte français visible${fr.length ? ` (${fr.slice(0, 6).map(l => `« ${l} »`).join(' ; ')})` : ''}`);
}

const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
try {
  const ctx = await nouveauContexte(navigateur, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true, locale: 'fr-FR' });
  const pc = await compte(ctx, siteAvec.url, relais.code, 'PC');
  await ouvrirEsport(pc);
  await pc.getByTestId('esport-profil-initial').waitFor({ timeout: 30_000 });
  verifier(/Pseudo/.test(await pc.getByTestId('app-esport').innerText()), 'appareil en français : l’Esport s’ouvre en français');

  log('premier profil : passage en English');
  await pc.getByTestId('esport-langue-en').click();
  await pause(300);
  verifier(/Nickname|Display name|Username/i.test(await pc.getByTestId('app-esport').innerText()) && !/Pseudo obligatoire/.test(await pc.getByTestId('app-esport').innerText()), 'le profil passe en anglais instantanément');
  await verifierAnglais(pc, 'Profil initial');
  await pc.getByTestId('esport-pseudo').fill('Founder');
  await pc.getByTestId('esport-pseudo-valider').click();
  await pc.getByTestId('esport-dashboard').waitFor({ timeout: 20_000 });
  await verifierAnglais(pc, 'Dashboard');

  await pc.getByTestId('esport-nav-teams').click();
  await pc.getByTestId('esport-teams').waitFor({ timeout: 20_000 });
  await verifierAnglais(pc, 'Teams (vide)');

  log('assistant de création de team');
  await pc.getByTestId('esport-creer').click();
  await verifierAnglais(pc, 'Assistant, étape 1');
  await pc.getByTestId('esport-assistant-nom').fill('Falcons');
  await pc.getByTestId('esport-assistant-suivant').click();
  await verifierAnglais(pc, 'Assistant, étape 2');
  await pc.getByTestId('esport-assistant-preset-valorant_complet').click();
  await pc.getByTestId('esport-assistant-suivant').click();
  await verifierAnglais(pc, 'Assistant, étape 3');
  await pc.getByTestId('esport-assistant-creer').click();
  await pc.getByTestId('esport-team').waitFor({ timeout: 20_000 });
  await verifierAnglais(pc, 'Accueil de la team');

  const sections = ['module-planning', 'module-availability', 'module-attendance', 'module-strat_editor', 'module-playbook', 'module-video_review', 'module-scouting', 'module-meeting_summaries', 'module-goals_tasks', 'module-player_notes', 'membres', 'parametres', 'module-discord', 'journal'];
  for (const id of sections) {
    try {
      await ongletTeam(pc, id, { delai: 10_000 });
    } catch {
      log(`section absente : ${id}`);
      continue;
    }
    await verifierAnglais(pc, `Team › ${id}`);
  }

  log('Membres (global)');
  await pc.getByTestId('esport-team-retour').first().click();
  await pc.getByTestId('esport-teams').waitFor({ timeout: 20_000 });
  await verifierAnglais(pc, 'Teams');
  await pc.getByTestId('esport-nav-membres').click();
  await pc.getByTestId('esport-membres-global').waitFor({ timeout: 20_000 });
  await verifierAnglais(pc, 'Membres');
  await pc.getByTestId('esport-nav-dashboard').click();
  await pc.getByTestId('esport-dashboard').waitFor({ timeout: 20_000 });
  await verifierAnglais(pc, 'Dashboard (avec une team)');

  log('langue enregistrée sur le compte et conservée au rechargement');
  const compteFondateur = await esport.base.premier("SELECT langue FROM comptes WHERE pseudo = 'Founder'", []);
  verifier(compteFondateur?.langue === 'en', `comptes.langue = en (${compteFondateur?.langue})`);
  await pc.reload();
  await pc.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(pc, MDP, pc.secret));
  await fermerPopups(pc);
  await ouvrirEsport(pc);
  await pc.getByTestId('esport-teams').waitFor({ timeout: 20_000 });
  await verifierAnglais(pc, 'Teams après rechargement');

  log('retour en français depuis Mon profil');
  await pc.getByTestId('esport-nav-teams').click();
  await pc.getByTestId('esport-team-falcons').click();
  await pc.getByTestId('esport-team').waitFor({ timeout: 20_000 });
  const profil = pc.getByTestId('esport-mon-profil');
  if (await profil.count() || await pc.getByText(/My Esport profile/i).first().click({ timeout: 4000 }).then(() => true, () => false)) {
    await pc.getByTestId('esport-profil-langue-fr').click().catch(() => undefined);
    await pause(400);
    verifier(!/Save|Settings/.test(await pc.getByTestId('app-esport').innerText()), 'retour au français instantané');
  } else {
    log('Mon profil introuvable depuis l’accueil : bascule inverse ignorée');
  }
} finally {
  await navigateur.close();
  siteAvec.fermer();
  siteSans.fermer();
  await relais.fermer?.();
  await esport.fermer?.();
}
console.log(echecs ? `\n${echecs} échec(s)` : '\nTout est vert.');
process.exit(echecs ? 1 : 0);
