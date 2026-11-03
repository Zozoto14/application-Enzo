/**
 * Captures des niveaux d'urgence des cartes CM : un tableau (fond dégradé) avec les quatre niveaux, thèmes sombre (Nuit)
 * et clair (Ivoire), PC 1440 × 900 et iPhone 390 × 844 ; fiche d'une carte critique et légende ouverte (thème sombre).
 *
 *   npx vite build            (ou DIST=/chemin/vers/dist pour comparer avec une autre version)
 *   SORTIE=/chemin PREFIXE=apres PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/captures-cm-urgence.mjs
 */

import { existsSync, mkdirSync, statSync, createReadStream } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { allerPageApplications, nouveauContexte, tuileApp } from './e2e-acceptation.mjs';
import { chargerPlaywright, demarrerRelais, deverrouiller, pause, premierLancement, racine } from './mobile-outils.mjs';

const SORTIE = process.env.SORTIE ?? join(racine, '.captures-cm-urgence');
const PREFIXE = process.env.PREFIXE ?? 'apres';
mkdirSync(SORTIE, { recursive: true });
const JETON = 'jeton-captures-esport-0123456789abcd';
const PORT_RELAIS = 8895;
const PORT_ESPORT = 8896;
const PORT_SITE = 5395;
const MDP = 'mot-de-passe-captures-esport-tres-long-42';
const log = (...a) => console.log('[captures]', ...a);

const { demarrerServeurEsport } = await import(pathToFileURL(join(racine, 'esport/outils/serveur-local.mjs')).href);
const relais = await demarrerRelais(PORT_RELAIS, JETON);
const esport = await demarrerServeurEsport({ port: PORT_ESPORT, jetonDev: JETON, graines: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const dist = process.env.DIST ?? join(racine, 'bureau/dist');
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
await new Promise(ok => serveur.listen(PORT_SITE, ok));

async function api(chemin, jeton, { methode = 'GET', corps } = {}) {
  const r = await fetch(`${esport.url}${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jeton}`, ...(methode === 'PATCH' ? { 'X-Methode': 'PATCH' } : {}) }, method: methode === 'PATCH' ? 'POST' : methode, body: corps ? JSON.stringify(corps) : undefined });
  return r.json().catch(() => null);
}
const session = (await api('/session', JETON, { methode: 'POST' })).session;
await api('/moi', session, { methode: 'PUT', corps: { pseudo: 'Fondateur' } });
// Tableau de démonstration : fond dégradé, deux colonnes, les quatre niveaux (+ une carte sans drapeau).
const tableau = (await api('/cm/tableaux', session, { methode: 'POST', corps: { nom: 'Urgences du mois', portee: 'club', couleur: '#0c66e4' } })).tableau;
await api(`/cm/tableaux/${tableau.id}`, session, { methode: 'PATCH', corps: { fond: { genre: 'degrade', cle: 'ocean' }, version: tableau.version } });
const colonnes = {};
for (const nom of ['À faire', 'En cours']) colonnes[nom] = (await api(`/cm/tableaux/${tableau.id}/listes`, session, { methode: 'POST', corps: { nom } })).id;
const etiquette = (await api(`/cm/tableaux/${tableau.id}/etiquettes`, session, { methode: 'POST', corps: { nom: 'Vidéo', couleur: '#4bce97' } })).id;
const CARTES = [
  ['À faire', 'Annonce du roster à publier avant 18 h', 'critique', true],
  ['À faire', 'Relire le script du teaser', 'urgent', true],
  ['À faire', 'Planifier les posts du week-end', 'moyen', false],
  ['À faire', 'Ranger les visuels de la saison passée', 'faible', false],
  ['À faire', 'Idée : interview d’un joueur', null, false],
  ['En cours', 'Miniatures du tournoi de novembre', 'critique', false],
  ['En cours', 'Montage du récap de match', 'urgent', true],
  ['En cours', 'Mettre à jour la bannière Twitch', 'moyen', false],
  ['En cours', 'Archiver les rushs', 'faible', false],
];
let critique;
for (const [liste, titre, urgence, etiq] of CARTES) {
  const c = (await api(`/cm/tableaux/${tableau.id}/cartes`, session, { methode: 'POST', corps: { listeId: colonnes[liste], titre } })).carte;
  const patch = { ...(urgence ? { urgence } : {}), ...(etiq ? { etiquettes: [etiquette] } : {}) };
  if (Object.keys(patch).length) await api(`/cm/cartes/${c.id}`, session, { methode: 'PATCH', corps: patch });
  critique ??= urgence === 'critique' ? c : undefined;
}

const present = (page, id, delai = 1500) => page.getByTestId(id).first().waitFor({ timeout: delai }).then(() => true, () => false);
const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
try {
  const ctx = await nouveauContexte(navigateur, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  await ctx.addInitScript(() => {
    localStorage.setItem('applibourse.theme.appareil', localStorage.getItem('capture.theme') ?? 'nuit');
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => log('erreur page :', e.message));
  const secret = await premierLancement(page, { site: `http://localhost:${PORT_SITE}/`, code: relais.code, motDePasse: MDP });
  await page.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(page, MDP, secret));
  for (let i = 0; i < 3; i++) if (!(await page.getByText(/^(Fermer|Terminé|Compris|Plus tard)$/).first().click({ timeout: 2000 }).then(() => true, () => false))) break;
  for (const [themeNom, theme] of [['sombre', 'nuit'], ['clair', 'ivoire']]) {
    if (themeNom === 'clair') {
      await page.evaluate(() => localStorage.setItem('capture.theme', 'ivoire'));
      await page.reload();
      await page.getByTestId('hub').waitFor({ timeout: 30_000 }).catch(() => deverrouiller(page, MDP, secret));
    }
    for (const [taille, viewport] of [['1440x900', { width: 1440, height: 900 }], ['390x844', { width: 390, height: 844 }]]) {
      await page.setViewportSize(viewport);
      await pause(600);
      if (await page.getByTestId('app-esport').count()) await page.getByTestId('retour-hub').first().click();
      await allerPageApplications(page);
      await tuileApp(page, 'esport').first().click();
      await page.getByTestId('app-esport').waitFor({ timeout: 20_000 });
      if (await present(page, 'esport-profil-initial', 3000)) {
        await page.getByTestId('esport-pseudo').fill('Fondateur');
        await page.getByTestId('esport-pseudo-valider').click();
      }
      await page.getByTestId('esport-nav-teams').first().click();
      await page.getByTestId('esport-teams-cm-ouvrir').waitFor({ timeout: 15_000 });
      await page.getByTestId('esport-teams-cm-ouvrir').click();
      await page.getByTestId('esport-cm').waitFor({ timeout: 15_000 });
      if (taille === '390x844') {
        await page.getByTestId('esport-cm-sections').click();
        await pause(400);
      }
      await page.getByTestId('esport-cm-groupe-contenus').click();
      await pause(600);
      await page.getByTestId(`esport-cm-tableau-${tableau.id}`).click();
      await page.getByTestId(`esport-cm-liste-${colonnes['À faire']}-cartes`).waitFor({ timeout: 15_000 });
      await pause(1200);
      await page.screenshot({ path: join(SORTIE, `${PREFIXE}-${themeNom}-${taille}-tableau.png`) });
      if (themeNom === 'sombre') {
        // Légende ouverte, puis fiche de la carte critique.
        if (await present(page, 'esport-cm-urgence-legende-bouton', 500)) {
          await page.getByTestId('esport-cm-urgence-legende-bouton').click();
          await pause(500);
          await page.screenshot({ path: join(SORTIE, `${PREFIXE}-${themeNom}-${taille}-legende.png`) });
          await page.getByTestId('esport-cm-urgence-legende-bouton').click();
        }
        await page.getByTestId(`esport-cm-carte-${critique.id}-tuile`).click();
        await page.getByTestId('esport-cm-fiche-contenu').waitFor({ timeout: 15_000 });
        await pause(1000);
        await page.screenshot({ path: join(SORTIE, `${PREFIXE}-${themeNom}-${taille}-fiche.png`) });
      }
      log(themeNom, taille);
    }
  }
  await ctx.close();
} finally {
  await navigateur.close();
  serveur.close();
  await esport.fermer?.();
  await relais.fermer?.();
}
process.exit(0);
