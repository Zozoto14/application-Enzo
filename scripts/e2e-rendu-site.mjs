/**
 * Rendu du site de secours, sur PC (1440×900), iPad (1024×768, tactile) et iPhone (390×844, tactile) :
 *
 *  - polices du thème posées dès l'accueil, même quand aucun thème n'a jamais été choisi (avant :
 *    tout le site en police du système), couleur de barre (`theme-color`) = fond du thème affiché ;
 *  - aucun débordement horizontal du hub et des Paramètres, à chaque taille ;
 *  - rappel « Échap » seulement là où un clavier est probable (pas sur tablette ni téléphone) ;
 *  - Historique de Claude Office sur téléphone : champs ≥ 16 px (pas de zoom de Safari au focus),
 *    filtres ≥ 44 px, textes ≥ 15 px ;
 *  - favicon déclaré, ressources à empreinte gardées en cache (`_headers`, traduit en .htaccess pour o2switch).
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-rendu-site.mjs
 *
 * Variables : PLAYWRIGHT_PATH, CAPTURES (dossier des captures, défaut : aucune capture).
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chargerPlaywright, demarrerRelais, demarrerSite, deverrouiller, mesurer, optionsIphone, pause, premierLancement, racine, toucher, visible } from './mobile-outils.mjs';

const CAPTURES = process.env.CAPTURES ? resolve(racine, process.env.CAPTURES) : undefined;
if (CAPTURES) mkdirSync(CAPTURES, { recursive: true });
const MDP = 'mot-de-passe-e2e-rendu-site-très-long-42';
const NUIT = '#0B0F17';
const IVOIRE = '#F6F3EC';
const log = (...a) => console.log('[e2e-rendu]', ...a);
let echecs = 0;
const verifier = (ok, message) => {
  console.log(ok ? '  OK   ' : '  ECHEC', message);
  if (!ok) echecs++;
};

// ------------------------------------------------------------- Fichiers publiés
const dist = join(racine, 'bureau/dist');
const index = readFileSync(join(dist, 'index.html'), 'utf8');
verifier(/<link rel="icon"[^>]*href="\.\/icone-/.test(index), 'favicon déclaré (plus de /favicon.ico introuvable)');
verifier(new RegExp(`<meta name="theme-color" content="${NUIT}"`, 'i').test(index), 'theme-color initial = fond du thème par défaut (Nuit)');
verifier(/\/assets\/\*\s+Cache-Control: public, max-age=31536000, immutable/.test(readFileSync(join(dist, '_headers'), 'utf8')), '_headers : fichiers à empreinte gardés en cache un an');

const etatDocument = page =>
  page.evaluate(async () => {
    await document.fonts.ready;
    return {
      police: getComputedStyle(document.documentElement).getPropertyValue('--police-texte').trim(),
      policeCorps: getComputedStyle(document.querySelector('#racine *') ?? document.body).fontFamily,
      manrope: document.fonts.check('16px Manrope') && [...document.fonts].some(f => f.family.replace(/"/g, '') === 'Manrope' && f.status === 'loaded'),
      barre: document.querySelector('meta[name="theme-color"]').getAttribute('content').toUpperCase(),
      echap: /Échap|ÉCHAP/.test(document.body.innerText),
    };
  });

async function choisirTheme(page, id) {
  await toucher(page, (await visible(page, 'hub-parametres-ouvrir', 1500)) ? 'hub-parametres-ouvrir' : 'barre-basse-parametres');
  await page.getByTestId('hub-parametres').waitFor({ timeout: 10_000 });
  if (await visible(page, 'parametres-section-general', 1500)) await toucher(page, 'parametres-section-general');
  await toucher(page, `parametres-theme-${id}`, { timeout: 5000 });
  await pause(400);
  if (await visible(page, 'parametres-retour', 800)) await toucher(page, 'parametres-retour');
  const m = await mesurer(page);
  await toucher(page, 'hub-parametres-fermer');
  await page.getByTestId('hub').waitFor({ timeout: 10_000 });
  return m;
}

const TAILLES = [
  { nom: 'pc', opts: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true }, clavier: true },
  {
    nom: 'ipad',
    opts: {
      viewport: { width: 1024, height: 768 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
      ignoreHTTPSErrors: true,
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    },
    clavier: false,
  },
  { nom: 'iphone', opts: { ...optionsIphone(), deviceScaleFactor: 2 }, clavier: false, telephone: true },
];

const site = await demarrerSite(5371);
const relais = await demarrerRelais(8971);
const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
try {
  for (const taille of TAILLES) {
    log(`— ${taille.nom} (${taille.opts.viewport.width}×${taille.opts.viewport.height})`);
    const contexte = await navigateur.newContext(taille.opts);
    const page = await contexte.newPage();
    page.on('pageerror', e => log('erreur page :', e.message));
    const capture = async nom => {
      if (CAPTURES) await page.screenshot({ path: join(CAPTURES, `${taille.nom}-${nom}.jpg`), type: 'jpeg', quality: 70 });
    };

    // Accueil du site : aucun thème choisi, les polices du thème par défaut sont déjà là.
    const secret = await premierLancement(page, {
      site: site.url,
      code: relais.code,
      motDePasse: MDP,
      etape: async nom => {
        if (nom !== 'accueil-site') return;
        const d = await etatDocument(page);
        verifier(d.police.includes('Manrope') && d.manrope, `${taille.nom} : accueil du site en Manrope, police du thème (${d.policeCorps})`);
        verifier(d.barre === NUIT, `${taille.nom} : barre du navigateur au fond du thème Nuit (${d.barre})`);
      },
    });
    await toucher(page, 'acceptation-case').catch(() => undefined);
    await toucher(page, 'acceptation-continuer').catch(() => undefined);
    await page.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(page, MDP, secret));
    await page.getByText(/Fermer|Terminé|Compris|Plus tard/).first().click({ timeout: 3000 }).catch(() => undefined);
    await page.getByTestId('hub').waitFor({ timeout: 20_000 });
    await pause(800);

    const d = await etatDocument(page);
    verifier(d.police.includes('Manrope') && d.policeCorps.includes('Manrope'), `${taille.nom} : hub en Manrope sans avoir jamais choisi de thème (${d.policeCorps})`);
    verifier(d.echap === taille.clavier, `${taille.nom} : rappel « Échap » ${taille.clavier ? 'affiché (clavier)' : 'masqué (écran tactile)'}`);
    const hub = await mesurer(page);
    verifier(hub.debordementPage === 0 && hub.deborde.length === 0, `${taille.nom} : hub sans débordement horizontal ${JSON.stringify(hub.deborde)}`);
    await capture('hub-nuit');

    const parametres = await choisirTheme(page, 'ivoire');
    verifier(parametres.debordementPage === 0 && parametres.deborde.length === 0, `${taille.nom} : Paramètres sans débordement horizontal ${JSON.stringify(parametres.deborde)}`);
    verifier((await etatDocument(page)).barre === IVOIRE, `${taille.nom} : barre du navigateur suit le thème (Ivoire)`);

    if (taille.telephone) {
      // Historique de Claude Office (copie chiffrée, côté site).
      await toucher(page, 'barre-basse-administration');
      await page.locator('[data-testid="tuile-claude-office"], [data-testid="cellule-claude-office"]').first().tap();
      await toucher(page, 'claude-office-onglet-historique', { timeout: 20_000 });
      await page.getByTestId('historique').waitFor({ timeout: 10_000 });
      await pause(600);
      const m = await mesurer(page);
      const zoom = m.champs.filter(c => c.includes('zoom iOS'));
      verifier(zoom.length === 0, `iphone : champs de l’historique ≥ 16 px, pas de zoom au focus ${JSON.stringify(zoom)}`);
      verifier(m.petitesCibles === 0, `iphone : filtres de l’historique ≥ 44 px ${JSON.stringify(m.exemplesCibles)}`);
      verifier(m.petitsTextes === 0, `iphone : textes de l’historique ≥ 15 px ${JSON.stringify(m.exemplesPetits)}`);
      verifier(m.debordementPage === 0 && m.deborde.length === 0, `iphone : historique sans débordement ${JSON.stringify(m.deborde)}`);
      await capture('claude-office-historique');
    }
    await contexte.close();
  }
} finally {
  await navigateur.close();
  site.fermer();
  relais.fermer();
}
log(echecs ? `${echecs} échec(s)` : 'tout est vert');
process.exit(echecs ? 1 : 0);
