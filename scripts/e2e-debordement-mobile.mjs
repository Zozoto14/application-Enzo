/**
 * Non-régression : aucune page principale de l'Esport ni du hub ne doit défiler horizontalement sur téléphone
 * (390 × 844 et 360 × 800). Parcourt Dashboard, Teams, Membres, Tickets (et sa configuration), Jeux (dans « Plus »), Notifications, l'espace CM (chaque
 * groupe et chaque sous-onglet), la page de la team (chaque section et chaque module), les Réglages de la team
 * et ceux du hub. Mesure `document.documentElement.scrollWidth > window.innerWidth` ; en cas d'échec, liste les
 * éléments qui dépassent à droite. Code de sortie 1 au moindre débordement.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-debordement-mobile.mjs
 *
 * Variable : TAILLES (« 390x844,360x800 » par défaut), CAPTURES (dossier de captures des pages en échec).
 */

import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { allerPageApplications, nouveauContexte, tuileApp } from './e2e-acceptation.mjs';
import { chargerPlaywright, demarrerRelais, deverrouiller, pause, premierLancement, racine } from './mobile-outils.mjs';

const TAILLES = (process.env.TAILLES ?? '390x844,360x800').split(',').map(t => t.split('x').map(Number));
const CAPTURES = process.env.CAPTURES ?? join(racine, '.captures-audit/debordement');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-debordement-mobile-0123456789ab';
const PORT_RELAIS = 8893;
const PORT_ESPORT = 8894;
const PORT_SITE = 5393;
const MDP = 'mot-de-passe-debordement-tres-long-42';
const log = (...a) => console.log('[debordement]', ...a);

const { demarrerServeurEsport } = await import(pathToFileURL(join(racine, 'esport/outils/serveur-local.mjs')).href);
const relais = await demarrerRelais(PORT_RELAIS, JETON);
const esport = await demarrerServeurEsport({ port: PORT_ESPORT, jetonDev: JETON, graines: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff' };
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
await new Promise(ok => serveur.listen(PORT_SITE, ok));

const present = (page, id, delai = 1500) => page.getByTestId(id).first().waitFor({ timeout: delai }).then(() => true, () => false);
const testIds = (page, prefixe) => page.locator(`[data-testid^="${prefixe}"]`).evaluateAll(els => els.map(e => e.getAttribute('data-testid')));

let echecs = 0;
let controles = 0;
/** Vérifie la page courante : pas de défilement horizontal du document. */
async function controler(page, nom, [largeur, hauteur]) {
  await pause(700);
  controles++;
  const m = await page.evaluate(() => {
    const e = document.documentElement;
    const l = window.innerWidth;
    const fautifs = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > l + 1 && fautifs.length < 6 && getComputedStyle(el).visibility !== 'hidden') {
        // Ignore ce qui est dans une rangée qui défile horizontalement exprès (puces, onglets) ; un parent « hidden » ne compte pas.
        let p = el.parentElement;
        let clippe = false;
        while (p && p !== document.body) {
          const o = getComputedStyle(p);
          if (/(auto|scroll)/.test(o.overflowX) && p.getBoundingClientRect().right <= l + 1) { clippe = true; break; }
          p = p.parentElement;
        }
        if (!clippe) fautifs.push(`${el.tagName.toLowerCase()}[${el.getAttribute('data-testid') ?? ''}] droite=${Math.round(r.right)} « ${(el.textContent ?? '').trim().slice(0, 30)} »`);
      }
    }
    return { scrollWidth: e.scrollWidth, innerWidth: l, fautifs };
  });
  // Le document peut ne pas défiler (corps en overflow:hidden) alors qu'un bouton sort de l'écran : on contrôle aussi les éléments.
  const ok = m.scrollWidth <= m.innerWidth && !m.fautifs.length;
  console.log(ok ? '  OK   ' : '  ECHEC', `${largeur}x${hauteur} ${nom} (scrollWidth ${m.scrollWidth} / ${m.innerWidth})`);
  if (!ok) {
    echecs++;
    for (const f of m.fautifs) console.log('         ->', f);
    await page.screenshot({ path: join(CAPTURES, `${largeur}x${hauteur}-${nom.replace(/[^a-z0-9]+/gi, '-')}.jpg`), type: 'jpeg', quality: 60 }).catch(() => undefined);
  }
}

const GROUPES = {
  accueil: 'accueil', 'module-planning': 'agenda', 'module-availability': 'agenda', 'module-attendance': 'agenda',
  'module-strat_editor': 'jeu', 'module-playbook': 'jeu', 'module-resources': 'jeu', 'module-video_review': 'jeu', 'module-scouting': 'jeu',
  'module-tournois': 'competition', 'module-resultats': 'competition',
  'module-meeting_summaries': 'equipe', 'module-goals_tasks': 'equipe', 'module-player_notes': 'equipe', 'module-cm': 'equipe', membres: 'equipe',
  parametres: 'reglages', 'module-discord': 'reglages', journal: 'reglages',
};

async function ouvrirEsport(page) {
  if (await page.getByTestId('app-esport').count()) await page.getByTestId('retour-hub').first().click();
  await allerPageApplications(page);
  await tuileApp(page, 'esport').first().click();
  await page.getByTestId('app-esport').waitFor({ timeout: 20_000 });
  if (await present(page, 'esport-team-retour', 2500)) await page.getByTestId('esport-team-retour').first().click();
  if (await present(page, 'esport-profil-initial', 3000)) {
    await page.getByTestId('esport-pseudo').fill('Fondateur');
    await page.getByTestId('esport-pseudo-valider').click();
  }
}

/** Ouvre le menu des groupes de l'espace CM (téléphone) et choisit un groupe. */
async function groupeCm(page, id) {
  if (!(await present(page, id, 400)) && (await present(page, 'esport-cm-sections', 1500))) await page.getByTestId('esport-cm-sections').click();
  await page.getByTestId(id).first().click();
}

async function parcourir(page, taille) {
  await page.setViewportSize({ width: taille[0], height: taille[1] });
  await pause(600);
  await ouvrirEsport(page);
  for (const onglet of ['dashboard', 'teams', 'membres', 'tickets', 'jeux']) {
    // Téléphone : au-delà de cinq entrées, les dernières (Jeux, Statistiques) sont dans « Plus ».
    if (!(await present(page, `esport-nav-${onglet}`, 1500)) && (await present(page, 'esport-nav-plus', 500))) {
      await page.getByTestId('esport-nav-plus').first().click();
      await controler(page, 'esport-plus', taille);
      if (await present(page, `esport-plus-${onglet}`, 1500)) {
        await page.getByTestId(`esport-plus-${onglet}`).first().click();
        await controler(page, `esport-${onglet}`, taille);
        continue;
      }
    }
    if (!(await present(page, `esport-nav-${onglet}`, 2000))) {
      log(`onglet ${onglet} absent`);
      continue;
    }
    await page.getByTestId(`esport-nav-${onglet}`).first().click();
    await controler(page, `esport-${onglet}`, taille);
    // Tickets : chaque section de la configuration (docs/esport/tickets.md).
    if (onglet === 'tickets') {
      for (const s of ['connexion', 'general', 'categories', 'panneaux', 'messages', 'liste', 'horaires', 'commandes']) {
        if (!(await present(page, `esport-tk-conf-onglet-${s}`, 2000))) continue;
        await page.getByTestId(`esport-tk-conf-onglet-${s}`).first().click();
        await controler(page, `esport-tickets-${s}`, taille);
      }
      if (await present(page, 'esport-tk-conf-onglet-categories', 1000)) {
        await page.getByTestId('esport-tk-conf-onglet-categories').first().click();
        await page.getByTestId('esport-tk-cat-nouvelle').first().click();
        await controler(page, 'esport-tickets-categorie-editeur', taille);
        await page.getByTestId('esport-tk-cat-annuler').first().click();
      }
    }
  }
  // Notifications : cloche de l'en-tête (téléphone).
  if (await present(page, 'esport-cloche', 2000)) {
    await page.getByTestId('esport-cloche').first().click();
    await page.getByTestId('esport-notifications-page').waitFor({ timeout: 15_000 });
    await controler(page, 'esport-notifications', taille);
    await page.getByTestId('esport-notifs-filtres').click();
    await controler(page, 'esport-notifications-filtres', taille);
    await page.getByTestId('esport-notifs-prefs').click();
    await controler(page, 'esport-notifications-preferences', taille);
  } else {
    echecs++;
    console.log('  ECHEC cloche de notifications introuvable');
  }
  // Espace CM : chaque groupe et chaque sous-onglet.
  await page.getByTestId('esport-nav-teams').first().click();
  if (await present(page, 'esport-teams-cm-ouvrir', 3000)) {
    await page.getByTestId('esport-teams-cm-ouvrir').click();
    await page.getByTestId('esport-cm').waitFor({ timeout: 15_000 });
    await controler(page, 'cm-accueil', taille);
    await page.getByTestId('esport-cm-sections').click();
    const groupes = [...new Set(await testIds(page, 'esport-cm-groupe-'))];
    for (const g of groupes) {
      await groupeCm(page, g);
      await controler(page, g.replace('esport-cm-groupe-', 'cm-groupe-'), taille);
      for (const o of [...new Set(await testIds(page, 'esport-cm-onglet-'))]) {
        await page.getByTestId(o).first().click().catch(() => undefined);
        await controler(page, `cm-${g.replace('esport-cm-groupe-', '')}-${o.replace('esport-cm-onglet-', '')}`, taille);
      }
    }
    await page.getByTestId('esport-cm-retour').first().click();
  } else {
    echecs++;
    console.log('  ECHEC espace CM introuvable');
  }
  // Page de la team : chaque section.
  await page.getByTestId('esport-nav-teams').first().click();
  await page.getByTestId('esport-team-faucons-valorant').first().click();
  await page.getByTestId('esport-team').waitFor({ timeout: 20_000 });
  for (const id of Object.keys(GROUPES)) {
    const groupe = GROUPES[id];
    if (!(await present(page, `esport-section-${groupe}`, 800))) continue;
    await page.getByTestId(`esport-section-${groupe}`).first().click();
    if (await present(page, `esport-onglet-${id}`, 1200)) await page.getByTestId(`esport-onglet-${id}`).first().click();
    else if (groupe !== 'accueil' && !(await present(page, `esport-contenu-${id}`, 800))) continue;
    await controler(page, `team-${id}`, taille);
  }
  await page.getByTestId('esport-team-retour').first().click();
  // Réglages du hub.
  await page.getByTestId('retour-hub').first().click();
  await page.getByTestId('hub').waitFor({ timeout: 20_000 });
  await controler(page, 'hub', taille);
  await page.getByTestId(await present(page, 'hub-parametres-ouvrir', 1500) ? 'hub-parametres-ouvrir' : 'barre-basse-parametres').click();
  await page.getByTestId('hub-parametres').waitFor({ timeout: 10_000 });
  await controler(page, 'hub-parametres', taille);
  for (const id of [...new Set(await testIds(page, 'parametres-section-'))]) {
    await page.getByTestId(id).first().click().catch(() => undefined);
    await controler(page, id.replace('parametres-section-', 'hub-parametres-'), taille);
    if (await present(page, 'parametres-retour', 800)) await page.getByTestId('parametres-retour').click();
  }
  await page.getByTestId('hub-parametres-fermer').click();
  await page.getByTestId('hub').waitFor({ timeout: 10_000 });
}

const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
try {
  const ctx = await nouveauContexte(navigateur, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => log('erreur page :', e.message));
  const secret = await premierLancement(page, { site: `http://localhost:${PORT_SITE}/`, code: relais.code, motDePasse: MDP });
  await page.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(page, MDP, secret));
  for (let i = 0; i < 3; i++) if (!(await page.getByText(/^(Fermer|Terminé|Compris|Plus tard)$/).first().click({ timeout: 2000 }).then(() => true, () => false))) break;
  for (const taille of TAILLES) await parcourir(page, taille);
} finally {
  await navigateur.close();
  serveur.close();
  await esport.fermer?.();
  await relais.fermer?.();
}
console.log(echecs ? `\n${echecs} page(s) avec défilement horizontal sur ${controles} contrôles` : `\nAucun débordement horizontal (${controles} contrôles)`);
process.exit(echecs ? 1 : 0);
