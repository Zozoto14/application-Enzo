/**
 * Test de bout en bout de l'affichage téléphone du PORTEFEUILLE (émulation d'iPhone, tactile).
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-mobile-portefeuille.mjs
 *
 * Variables : ECRANS (liste de préfixes, ex. « resume,positions »), THEMES (« nuit,ivoire,terminal »),
 * CAPTURES (défaut docs/mobile/captures-apres/portefeuille), PETIT=1 (iPhone SE 375 × 667).
 *
 * Le parcours (`parcoursPortefeuille`) est aussi appelé par `e2e-mobile.mjs`. Il vérifie, sur CHAQUE écran :
 * aucun débordement horizontal, cibles ≥ 44 px, textes ≥ 15 px, champs ≥ 16 px ; puis capture l'écran.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  chargerPlaywright, demarrerRelais, demarrerSite, deverrouiller, mesurer, optionsIphone, pause, premierLancement, racine, toucher, visible,
} from './mobile-outils.mjs';
import { OPERATIONS_ESSAI, simulerMarche, simulerMarcheServeur } from './mobile-marche.mjs';

const log = (...a) => console.log('[e2e-mobile-portefeuille]', ...a);

/** Crée un compte, importe l'historique d'essai, charge les cours : un portefeuille bien rempli. */
export async function preparerPortefeuille(page) {
  await page.locator('[data-testid="cellule-portefeuille"], [data-testid="tuile-portefeuille"]').first().tap();
  await pause(1200);
  if (await visible(page, 'bouton-creer-compte-depuis-tableau', 5000)) {
    await toucher(page, 'bouton-creer-compte-depuis-tableau');
    await page.getByPlaceholder('PEA BoursoBank').first().fill('PEA Essai');
    await page.getByPlaceholder('JJ/MM/AAAA').first().fill('01/03/2024').catch(async () => {
      await page.locator('input[type=date]').first().fill('2024-03-01');
    });
    await toucher(page, 'bouton-creer-compte');
    await pause(1200);
  }
  if (await visible(page, 'visite-guidee', 2500)) {
    await toucher(page, 'visite-passer').catch(() => toucher(page, 'visite-arreter'));
    await pause(500);
  }
  for (const [nom, isin, ticker] of [['Amundi MSCI World', 'LU1681043599', 'CW8.PA'], ['Air Liquide', 'FR0000120073', 'AI.PA'], ['TotalEnergies', 'FR0000120271', 'TTE.PA'], ['Stellantis', 'NL00150001Q9', 'STLAP.PA']]) {
    await allerA(page, 'saisie');
    await toucher(page, 'bouton-creer-titre-depuis-saisie');
    await page.getByLabel('Nom', { exact: true }).first().fill(nom);
    await page.getByLabel('ISIN', { exact: true }).first().fill(isin);
    await page.getByLabel('Ticker', { exact: true }).first().fill(ticker);
    await toucher(page, 'bouton-creer-titre');
    await pause(700);
  }
  await allerA(page, 'import');
  await toucher(page, 'mode-import-Opérations');
  await page.getByLabel('Contenu du fichier').first().fill(OPERATIONS_ESSAI);
  await toucher(page, 'bouton-importer-operations');
  await pause(1500);
  await allerA(page, 'tableau');
  await toucher(page, 'onglet-resume').catch(() => undefined);
  if (await visible(page, 'bouton-rafraichir-cours', 5000)) {
    await toucher(page, 'bouton-rafraichir-cours');
    await pause(2500);
  }
  if (await visible(page, 'bouton-charger-historique', 3000)) {
    await toucher(page, 'bouton-charger-historique');
    await pause(4000);
  }
}

/** Va à une destination : barre basse, sinon feuille « Plus ». */
export async function allerA(page, cle) {
  if (await page.getByTestId(`barre-basse-app-${cle}`).count()) {
    await toucher(page, `barre-basse-app-${cle}`);
  } else if (await page.getByTestId('barre-basse-app-plus').count()) {
    await toucher(page, 'barre-basse-app-plus');
    await toucher(page, `nav-${cle}`);
  } else {
    await toucher(page, `nav-${cle}`);
  }
  await pause(700);
}

/**
 * Parcourt les écrans du Portefeuille. `ctx` : { controler(page, nom), capture(page, nom), verifier(ok, msg), filtre }.
 */
export async function parcoursPortefeuille(page, ctx) {
  const { controler, capture, verifier } = ctx;
  const filtre = ctx.filtre ?? [];
  const retenu = nom => filtre.length === 0 || filtre.some(f => nom.startsWith(f));
  const etape = async (nom, action) => {
    if (!retenu(nom)) return;
    try {
      await action?.();
      await pause(600);
      await controler?.(page, nom);
      await capture?.(page, nom);
    } catch (e) {
      verifier(false, `${nom} : ${String(e.message).split('\n')[0]}`);
    }
  };

  await allerA(page, 'tableau');
  await etape('resume', async () => {
    await toucher(page, 'onglet-resume');
  });
  for (const onglet of ['positions', 'exposition', 'risque', 'performances', 'dividendes', 'flux', 'impots']) {
    await etape(onglet, async () => {
      await toucher(page, `onglet-${onglet}`);
    });
  }
  for (const [cle, nom] of [['saisie', 'saisie'], ['import', 'import'], ['recherche', 'recherche'], ['screener', 'screener'], ['watchlist', 'watchlist'], ['carnet', 'carnet'], ['journal', 'journal'], ['comparateur', 'comparateur'], ['objectifs', 'objectifs'], ['projection', 'projection'], ['sauvegarde', 'sauvegarde'], ['diagnostic', 'diagnostic'], ['podcast', 'podcast']]) {
    await etape(nom, async () => {
      await allerA(page, cle);
    });
  }
}

// ======================================================================= Exécution directe
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/mobile/captures-apres/portefeuille');
  mkdirSync(CAPTURES, { recursive: true });
  const MDP = 'mot-de-passe-e2e-mobile-très-long-42';
  let echecs = 0;
  const verifier = (ok, message) => {
    console.log(ok ? '  OK   ' : '  ECHEC', message);
    if (!ok) echecs++;
  };
  const petit = process.env.PETIT === '1';
  const filtre = (process.env.ECRANS ?? '').split(',').filter(Boolean);
  const themes = (process.env.THEMES ?? 'nuit').split(',').filter(Boolean);
  const controler = async (page, nom) => {
    const m = await mesurer(page);
    verifier(m.debordementPage === 0 && m.deborde.length === 0, `${nom} : aucun débordement horizontal${m.deborde.length ? ` (${m.deborde.join(' | ')})` : ''}`);
    verifier(m.petitesCibles === 0, `${nom} : ${m.interactifs} éléments interactifs ≥ 44 px${m.petitesCibles ? ` (sous 44 px : ${m.exemplesCibles.join(' | ')})` : ''}`);
    verifier(m.petitsTextes === 0, `${nom} : textes ≥ 15 px${m.petitsTextes ? ` (${m.exemplesPetits.join(' | ')})` : ''}`);
    const zoom = m.champs.filter(c => c.includes('zoom iOS'));
    verifier(zoom.length === 0, `${nom} : champs ≥ 16 px${zoom.length ? ` (${zoom.join(' | ')})` : ''}`);
  };
  const site = await demarrerSite(5271);
  const relais = await demarrerRelais(8871);
  const { chromium } = chargerPlaywright();
  const navigateur = await chromium.launch({ headless: true });
  try {
    const contexte = await navigateur.newContext({ ...optionsIphone(petit ? { largeur: 375, hauteur: 667 } : {}), ...(process.env.ALTO ? { viewport: { width: 390, height: Number(process.env.ALTO) }, deviceScaleFactor: Number(process.env.DSF ?? 2) } : {}) });
    await simulerMarche(contexte);
    simulerMarcheServeur();
    const page = await contexte.newPage();
    page.on('pageerror', e => {
      echecs++;
      log('erreur page :', e.message);
    });
    const secret = await premierLancement(page, { site: site.url, code: relais.code, motDePasse: MDP });
    await page.getByTestId('acceptation-juridique').waitFor({ timeout: 60_000 });
    await toucher(page, 'acceptation-case');
    await toucher(page, 'acceptation-continuer');
    await page.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(page, MDP, secret));
    await page.getByText(/Fermer|Terminé|Compris|Plus tard/).first().tap({ timeout: 3000 }).catch(() => undefined);
    await page.getByTestId('hub').waitFor({ timeout: 20_000 });
    await preparerPortefeuille(page);
    for (const theme of themes) {
      let rang = 0;
      const capture = (p, nom) => p.screenshot({ path: join(CAPTURES, `${petit ? 'se-' : ''}${theme}-${String(++rang).padStart(2, '0')}-${nom}.jpg`), type: 'jpeg', quality: 75 });
      await parcoursPortefeuille(page, { controler, capture, verifier, filtre });
    }
  } catch (e) {
    echecs++;
    console.error(e);
  } finally {
    await navigateur.close();
    site.fermer();
    relais.fermer();
  }
  log(echecs === 0 ? 'TOUT EST VERT' : `${echecs} échec(s)`);
  process.exit(echecs === 0 ? 0 : 1);
}
