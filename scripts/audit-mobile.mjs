/**
 * Audit visuel de l'affichage téléphone : parcourt tous les écrans principaux en émulation d'iPhone,
 * capture chacun et mesure ses défauts (débordement, zones tactiles < 44 px, textes < 15 px, champs mal
 * typés pour le clavier mobile). Sert d'état « avant » et « après » d'une refonte.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/audit-mobile.mjs
 *
 * Variables : CAPTURES (défaut docs/mobile/captures-avant), LARGEUR / HAUTEUR (défaut 390×844),
 * ECRANS (liste de préfixes séparés par des virgules pour n'auditer qu'une partie : « hub,parametres »).
 * Sortie : une capture PNG par écran et `mesures.json` (une entrée par écran).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  chargerPlaywright,
  demarrerRelais,
  demarrerSite,
  deverrouiller,
  mesurer,
  optionsIphone,
  pause,
  premierLancement,
  racine,
  simulerInternet,
  toucher,
  visible,
} from './mobile-outils.mjs';

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/mobile/captures-avant');
mkdirSync(CAPTURES, { recursive: true });
const LARGEUR = Number(process.env.LARGEUR ?? 390);
const HAUTEUR = Number(process.env.HAUTEUR ?? 844);
const FILTRE = (process.env.ECRANS ?? '').split(',').map(s => s.trim()).filter(Boolean);
const MDP = 'mot-de-passe-audit-mobile-très-long-42';
const log = (...a) => console.log('[audit]', ...a);

const site = await demarrerSite(5231);
const relais = await demarrerRelais(8831);
const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
const mesures = {};
let rang = 0;

async function etape(page, nom, { pleinePage = false } = {}) {
  rang++;
  const fichier = `${String(rang).padStart(2, '0')}-${nom}.jpg`;
  if (FILTRE.length && !FILTRE.some(f => nom.startsWith(f))) return;
  await pause(350);
  await page.screenshot({ path: join(CAPTURES, fichier), fullPage: pleinePage, type: 'jpeg', quality: 72 });
  mesures[nom] = { capture: fichier, ...(await mesurer(page)) };
  const m = mesures[nom];
  log(`${fichier} : débordement ${m.debordementPage}px, cibles<44 ${m.petitesCibles}/${m.interactifs}, textes<15 ${m.petitsTextes}, champs ${m.champs.length}`);
}
const essayer = async (nom, action) => {
  try {
    await action();
  } catch (e) {
    log(`(${nom} non capturé : ${String(e.message).slice(0, 700)})`);
  }
};
const retourHub = async page => {
  if (await visible(page, 'retour-hub', 1500)) await toucher(page, 'retour-hub');
  else if (await visible(page, 'nav-hub', 1500)) await toucher(page, 'nav-hub');
  else if (await visible(page, 'barre-basse-hub', 1500)) await toucher(page, 'barre-basse-hub');
  else await page.keyboard.press('Escape');
  await page.getByTestId('hub').waitFor({ timeout: 20_000 });
};

try {
  const contexte = await navigateur.newContext(optionsIphone({ largeur: LARGEUR, hauteur: HAUTEUR }));
  await simulerInternet(contexte);
  const page = await contexte.newPage();
  page.on('pageerror', e => log('erreur page :', e.message));

  // ----- Entrée : accueil, création du coffre, secrets ; l'acceptation est capturée avant d'être validée
  const secret = await premierLancement(page, { site: site.url, code: relais.code, motDePasse: MDP, etape: nom => etape(page, nom) });
  await essayer('acceptation', async () => {
    await page.getByTestId('acceptation-juridique').waitFor({ timeout: 8000 });
    await etape(page, 'acceptation-juridique');
    await toucher(page, 'acceptation-lire-cookies');
    await page.getByTestId('hub-juridique').waitFor({ timeout: 10_000 });
    await etape(page, 'document-juridique');
    await toucher(page, 'juridique-fermer');
    await toucher(page, 'acceptation-case');
    await toucher(page, 'acceptation-continuer');
  });
  await page.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(page, MDP, secret));
  await page.getByText(/Fermer|Terminé|Compris|Plus tard/).first().tap({ timeout: 3000 }).catch(() => undefined);
  await pause(1500);
  await page.getByTestId('hub').waitFor({ timeout: 20_000 });
  await etape(page, 'hub');
  await etape(page, 'hub-page-entiere', { pleinePage: true });

  // ----- Hub : personnaliser, thèmes
  await essayer('hub-personnaliser', async () => {
    const bouton = (await visible(page, 'hub-personnaliser', 2000)) ? 'hub-personnaliser' : 'parametres-personnaliser';
    await toucher(page, bouton);
    await pause(500);
    await etape(page, 'hub-personnaliser');
    await toucher(page, 'hub-terminer').catch(() => toucher(page, 'hub-edition-termine'));
  });
  await essayer('hub-themes', async () => {
    await toucher(page, 'hub-theme', { timeout: 3000 });
    await etape(page, 'hub-menu-themes');
    await page.keyboard.press('Escape');
    await toucher(page, 'hub-theme', { timeout: 2000 }).catch(() => undefined);
  });

  // ----- Paramètres : accueil puis chaque section
  await essayer('parametres', async () => {
    await toucher(page, (await visible(page, 'hub-parametres-ouvrir', 2000)) ? 'hub-parametres-ouvrir' : 'barre-basse-parametres');
    await page.getByTestId('hub-parametres').waitFor({ timeout: 10_000 });
    await etape(page, 'parametres');
    const sections = await page.locator('[data-testid^="parametres-section-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid')));
    for (const id of sections) {
      await essayer(id, async () => {
        await toucher(page, id, { timeout: 5000 });
        await pause(400);
        await etape(page, id.replace('parametres-section-', 'parametres-'));
        if (await visible(page, 'parametres-retour', 800)) await toucher(page, 'parametres-retour');
      });
    }
    await toucher(page, 'hub-parametres-fermer');
    await page.getByTestId('hub').waitFor({ timeout: 10_000 });
  });

  // ----- Support
  await essayer('support', async () => {
    await toucher(page, (await visible(page, 'hub-support-ouvrir', 2000)) ? 'hub-support-ouvrir' : 'barre-basse-support');
    await page.getByTestId('hub-support').waitFor({ timeout: 10_000 });
    await etape(page, 'support');
    await etape(page, 'support-page-entiere', { pleinePage: true });
    await toucher(page, 'hub-support-fermer');
    await page.getByTestId('hub').waitFor({ timeout: 10_000 });
  });

  // ----- Portefeuille : un compte, puis chaque onglet et chaque destination
  await essayer('portefeuille', async () => {
    await page.locator('[data-testid="cellule-portefeuille"], [data-testid="tuile-portefeuille"]').first().tap();
    await pause(1200);
    await etape(page, 'portefeuille-vide');
    if (await visible(page, 'bouton-creer-compte-depuis-tableau', 3000)) {
      await toucher(page, 'bouton-creer-compte-depuis-tableau');
      await pause(400);
      await etape(page, 'portefeuille-creation-compte');
      await page.getByPlaceholder('PEA BoursoBank').first().fill('PEA Audit');
      await page.getByPlaceholder('JJ/MM/AAAA').first().fill('01/01/2020');
      await toucher(page, 'bouton-creer-compte');
      await pause(1200);
    }
    // La visite guidée s'ouvre au premier compte : capturée puis passée.
    if (await visible(page, 'visite-guidee', 3000)) {
      await etape(page, 'portefeuille-visite-guidee');
      await toucher(page, 'visite-passer').catch(() => toucher(page, 'visite-arreter'));
      await pause(500);
    }
    if (await visible(page, 'nav-tableau', 1500)) await toucher(page, 'nav-tableau');
    await pause(800);
    await etape(page, 'portefeuille-tableau');
    const onglets = await page.locator('[data-testid^="onglet-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid')).filter(id => !id.startsWith('onglet-app-')));
    for (const id of onglets) {
      await essayer(id, async () => {
        await toucher(page, id, { timeout: 4000 });
        await pause(500);
        await etape(page, `portefeuille-${id}`);
      });
    }
    const EXCLUES = ['nav-hub', 'nav-tableau', 'nav-reglages', 'nav-baggr', 'nav-podcast', 'nav-verrouiller', 'nav-discretion'];
    if (await visible(page, 'barre-basse-app', 1500)) {
      // Coque du téléphone : sections principales dans la barre basse, les autres dans « Plus ».
      const principales = await page.locator('[data-testid^="barre-basse-app-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid')));
      for (const id of principales.filter(d => d !== 'barre-basse-app-plus' && d !== 'barre-basse-app-tableau')) {
        await essayer(id, async () => {
          await toucher(page, id, { timeout: 4000 });
          await pause(600);
          await etape(page, `portefeuille-${id.replace('barre-basse-app-', 'nav-')}`);
        });
      }
      await toucher(page, 'barre-basse-app-plus');
      await pause(500);
      await etape(page, 'portefeuille-feuille-plus');
      const autres = await page.locator('[data-testid="feuille-plus"] [data-testid^="nav-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid')));
      await toucher(page, 'feuille-plus-fermer');
      for (const id of autres.filter(d => !EXCLUES.includes(d))) {
        await essayer(id, async () => {
          await toucher(page, 'barre-basse-app-plus', { timeout: 4000 });
          await toucher(page, id, { timeout: 4000 });
          await pause(600);
          await etape(page, `portefeuille-${id}`);
        });
      }
    } else {
      const destinations = await page.locator('[data-testid^="nav-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid')));
      for (const id of destinations.filter(d => !EXCLUES.includes(d))) {
        await essayer(id, async () => {
          await toucher(page, id, { timeout: 4000 });
          await pause(600);
          await etape(page, `portefeuille-${id}`);
        });
      }
    }
    await retourHub(page);
  });

  // ----- Administration : chaque section
  await essayer('administration', async () => {
    await page.locator('[data-testid="cellule-administration"], [data-testid="tuile-administration"]').first().tap();
    await page.getByTestId('app-administration').waitFor({ timeout: 20_000 });
    await pause(600);
    await etape(page, 'administration');
    const sections = await page.locator('[data-testid^="admin-onglet-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid')));
    for (const id of sections) {
      await essayer(id, async () => {
        await toucher(page, id, { timeout: 4000 });
        await pause(600);
        await etape(page, id.replace('admin-onglet-', 'administration-'));
      });
    }
    await retourHub(page);
  });

  // ----- Tsuzuku : accueil, catalogue, fiche, lecteur, bibliothèque
  await essayer('tsuzuku', async () => {
    await page.locator('[data-testid="cellule-tsuzuku"], [data-testid="tuile-tsuzuku"]').first().tap();
    await page.getByTestId('tsuzuku-racine').waitFor({ timeout: 20_000 });
    await pause(1500);
    await etape(page, 'tsuzuku-accueil');
    await essayer('tsuzuku-catalogue', async () => {
      await page.getByTestId('accueil-recherche').fill('Frieren');
      await toucher(page, 'accueil-chercher');
      await page.getByTestId('catalogue-grille').waitFor({ timeout: 20_000 });
      await pause(800);
      await etape(page, 'tsuzuku-catalogue');
      await toucher(page, 'carte-anime-1');
      await page.getByTestId('fiche-titre').waitFor({ timeout: 20_000 });
      await pause(800);
      await etape(page, 'tsuzuku-fiche');
      await toucher(page, 'fiche-lire');
      await pause(800);
      await etape(page, 'tsuzuku-lecteur');
      if (await visible(page, 'lecteur-retour', 2000)) await toucher(page, 'lecteur-retour');
      else if (await visible(page, 'lecteur-vers-fiche', 2000)) await toucher(page, 'lecteur-vers-fiche');
    });
    await essayer('tsuzuku-bibliotheque', async () => {
      await toucher(page, 'onglet-app-bibliotheque');
      await pause(800);
      await etape(page, 'tsuzuku-bibliotheque');
    });
    await retourHub(page);
  });

  // ----- Verrouillage, déverrouillage, mot de passe oublié
  await essayer('verrouillage', async () => {
    if (await visible(page, 'hub-verrouiller', 2000)) await toucher(page, 'hub-verrouiller');
    else {
      await toucher(page, 'barre-basse-compte');
      await toucher(page, 'feuille-compte-verrouiller');
    }
    await page.getByTestId('bouton-deverrouiller').waitFor({ timeout: 20_000 });
    await pause(500);
    await etape(page, 'deverrouillage');
    await page.getByText('Mot de passe oublié').first().tap();
    await pause(500);
    await etape(page, 'mot-de-passe-oublie');
  });

} finally {
  writeFileSync(join(CAPTURES, 'mesures.json'), JSON.stringify(mesures, null, 2));
  await navigateur.close();
  site.fermer();
  relais.fermer();
}
log(`${Object.keys(mesures).length} écrans audités → ${CAPTURES}`);
process.exit(0);
