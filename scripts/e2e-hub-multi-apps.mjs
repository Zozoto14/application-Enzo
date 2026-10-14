/**
 * Test de bout en bout : PLUSIEURS APPS OUVERTES EN MÊME TEMPS (onglets, côte à côte, fenêtres, liens profonds).
 *
 *  - PC (1440 × 900), le Fondateur : Portefeuille + Tâches + Claude Office ouverts en onglets ; chaque
 *    app garde son état quand on revient (recherche de Tâches, onglet interne de Claude Office) ; un
 *    onglet masqué n'a plus rien dans la page ; clic molette et appui long sur une tuile = nouvel
 *    onglet sans quitter le hub ; raccourcis Ctrl+Tab, Ctrl+Maj+Tab, Ctrl+1…9, Ctrl+W (et rien
 *    pendant la saisie) ; côte à côte, séparation glissée, côtés échangés puis fermés ; onglets
 *    restaurés après rechargement ;
 *  - app de bureau simulée (faux pont « fenetres ») : « Ouvrir dans une nouvelle fenêtre » ouvre une
 *    vraie fenêtre sur l'app, sans second déverrouillage ; verrouiller la fenêtre principale la ferme ;
 *  - site : « Ouvrir dans un nouvel onglet du navigateur » et lien profond #/app/<id> (l'app s'ouvre
 *    après le déverrouillage) ;
 *  - un ami ne peut pas ouvrir une app interdite par lien profond ;
 *  - iPad paysage (1366 × 1024, tactile) : côte à côte ;
 *  - iPhone (390 × 844) : pas de barre ni de côte à côte, sélecteur compact des apps ouvertes.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-hub-multi-apps.mjs
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { allerPageAdministration, allerPageApplications, nouveauContexte } from './e2e-acceptation.mjs';
import { chargerPlaywright, demarrerSite, deverrouiller, mesurer, optionsIphone, pause, premierLancement, racine, totp, toucher } from './mobile-outils.mjs';

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-hub-multi');
mkdirSync(CAPTURES, { recursive: true });
const MDP = 'mot-de-passe-hub-multi-apps-tres-long-42';
const log = (...a) => console.log('[e2e-hub-multi]', ...a);
let echecs = 0;
const verifier = (ok, message) => {
  console.log(ok ? '  OK   ' : '  ECHEC', message);
  if (!ok) echecs++;
};
const capture = async (page, nom) => {
  await pause(500);
  await page.screenshot({ path: join(CAPTURES, `${nom}.jpg`), type: 'jpeg', quality: 60 });
  log(`capture ${nom}`);
};
const attendre = async (condition, delai = 30_000, pas = 250) => {
  const debut = Date.now();
  while (Date.now() - debut < delai) {
    if (await condition().catch(() => false)) return true;
    await pause(pas);
  }
  return false;
};
const tuile = (page, id) => page.locator(`[data-testid="cellule-${id}"], [data-testid="tuile-${id}"]`).first();
const presents = (page, id) => page.locator(`[data-testid="${id}"]`).count();
const boite = async (page, id) => page.getByTestId(id).first().boundingBox();
const actif = async page => page.locator('[data-testid^="onglets-app-"][data-testid$="-ouvrir"][aria-selected="true"]').getAttribute('data-testid').catch(() => undefined);

async function fermerPopups(page) {
  for (let i = 0; i < 3; i++) {
    const clique = await page.getByText(/^(Fermer|Terminé|Compris|Plus tard)$/).first().click({ timeout: 2000 }).then(() => true, () => false);
    if (!clique) break;
  }
}

async function nouveauCompte(contexte, site, nom) {
  const page = await contexte.newPage();
  page.on('pageerror', e => log(`erreur page (${nom}) :`, e.message));
  const secret = await premierLancement(page, { site, motDePasse: MDP });
  await page.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(page, MDP, secret));
  await fermerPopups(page);
  return { page, secret };
}

async function deverrouillerSiDemande(page, secret, attendu) {
  const demande = await page.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 }).then(() => true, () => false);
  if (demande) await deverrouiller(page, MDP, secret, attendu);
}

const site = await demarrerSite(5277);
const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
try {
  // ======================================================================= PC
  log('PC : coffre du Fondateur, hub');
  const contextePc = await nouveauContexte(navigateur, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const { page: pc, secret } = await nouveauCompte(contextePc, site.url, 'PC');
  verifier((await presents(pc, 'onglets-barre')) === 0, 'hub sans app ouverte : pas de barre d’onglets');

  log('PC : Portefeuille, Tâches et Claude Office en onglets');
  await tuile(pc, 'portefeuille').click();
  await pc.getByTestId('onglets-barre').waitFor({ timeout: 20_000 });
  verifier((await presents(pc, 'onglets-app-portefeuille')) === 1, 'Portefeuille ouvert : son onglet apparaît');
  await pc.getByTestId('onglets-hub').click();
  await tuile(pc, 'taches').click();
  await pc.getByTestId('app-taches').waitFor({ timeout: 20_000 });
  await pc.getByTestId('taches-demo').click();
  await pc.getByTestId('taches-recherche').waitFor({ timeout: 20_000 });
  await pc.getByTestId('taches-recherche').fill('Facture');
  await pc.getByTestId('onglets-hub').click();
  await allerPageAdministration(pc);
  await tuile(pc, 'claude-office').click();
  await pc.getByTestId('claude-office-onglet-historique').waitFor({ timeout: 20_000 });
  await pc.getByTestId('claude-office-onglet-historique').click();
  const ids = await pc.locator('[data-testid^="onglets-app-"][data-testid$="-ouvrir"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid')));
  verifier(JSON.stringify(ids) === JSON.stringify(['onglets-app-portefeuille-ouvrir', 'onglets-app-taches-ouvrir', 'onglets-app-claude-office-ouvrir']), `trois onglets dans l’ordre d’ouverture (${ids.join(', ')})`);
  verifier((await pc.getByTestId('onglets-compte').innerText()).trim() === '3/8', 'compteur 3/8');
  await capture(pc, '01-pc-trois-onglets');

  log('PC : chaque app garde son état');
  await pc.getByTestId('onglets-app-taches-ouvrir').click();
  await pc.getByTestId('app-taches').waitFor({ timeout: 10_000 });
  verifier((await pc.getByTestId('taches-recherche').inputValue()) === 'Facture', 'Tâches : la recherche en cours est toujours là');
  verifier((await presents(pc, 'claude-office-onglet-historique')) === 0, 'onglet masqué (Claude Office) : plus rien de lui dans la page');
  await pc.getByTestId('onglets-app-claude-office-ouvrir').click();
  await pc.getByTestId('claude-office-onglet-historique').waitFor({ timeout: 10_000 });
  verifier((await pc.getByTestId('claude-office-onglet-historique').getAttribute('aria-selected')) === 'true', 'Claude Office : l’onglet « Historique » choisi est toujours affiché');
  verifier((await presents(pc, 'taches-recherche')) === 0, 'Tâches, masquée : rien d’elle dans la page');

  log('PC : raccourcis');
  await pc.mouse.click(720, 450).catch(() => undefined);
  await pc.keyboard.press('Control+1');
  verifier(await attendre(async () => (await actif(pc)) === 'onglets-app-portefeuille-ouvrir', 5000), 'Ctrl+1 : Portefeuille');
  await pc.keyboard.press('Control+Tab');
  verifier(await attendre(async () => (await actif(pc)) === 'onglets-app-taches-ouvrir', 5000), 'Ctrl+Tab : onglet suivant (Tâches)');
  await pc.keyboard.press('Control+Shift+Tab');
  verifier(await attendre(async () => (await actif(pc)) === 'onglets-app-portefeuille-ouvrir', 5000), 'Ctrl+Maj+Tab : onglet précédent (Portefeuille)');
  await pc.keyboard.press('Control+9');
  verifier(await attendre(async () => (await actif(pc)) === 'onglets-app-claude-office-ouvrir', 5000), 'Ctrl+9 : dernier onglet (Claude Office)');
  await pc.getByTestId('onglets-app-taches-ouvrir').click();
  await pc.getByTestId('taches-recherche').click();
  await pc.keyboard.press('Control+Tab');
  await pause(400);
  verifier((await actif(pc)) === 'onglets-app-taches-ouvrir', 'pendant la saisie, Ctrl+Tab ne change pas d’onglet');
  await pc.getByTestId('onglets-hub').click();

  log('PC : clic molette et appui long sur une tuile = nouvel onglet, sans quitter le hub');
  await allerPageApplications(pc);
  await tuile(pc, 'tsuzuku').click({ button: 'middle' });
  verifier(await attendre(async () => (await presents(pc, 'onglets-app-tsuzuku')) === 1, 5000), 'clic molette : Tsuzuku en nouvel onglet');
  verifier((await presents(pc, 'hub')) === 1 && (await presents(pc, 'tsuzuku-racine')) === 0, '… et l’on reste sur le hub');
  await pc.getByTestId('onglets-app-tsuzuku-fermer').click();
  const boiteTsuzuku = await tuile(pc, 'tsuzuku').boundingBox();
  await pc.mouse.move(boiteTsuzuku.x + boiteTsuzuku.width / 2, boiteTsuzuku.y + boiteTsuzuku.height / 2);
  await pc.mouse.down();
  await pause(900);
  await pc.mouse.up();
  verifier(await attendre(async () => (await presents(pc, 'onglets-app-tsuzuku')) === 1, 5000), 'appui long : Tsuzuku en nouvel onglet');
  verifier((await presents(pc, 'hub')) === 1, '… toujours sur le hub');
  verifier((await presents(pc, 'tuile-taches-ouverte')) === 1, 'la tuile d’une app ouverte le dit (« OUVERTE »)');
  await capture(pc, '02-pc-hub-onglets');

  log('PC : Ctrl+W ferme l’onglet affiché');
  await pc.getByTestId('onglets-app-tsuzuku-ouvrir').click();
  await pc.getByTestId('tsuzuku-racine').waitFor({ timeout: 20_000 });
  await pc.mouse.click(720, 600).catch(() => undefined);
  await pc.keyboard.press('Control+w');
  verifier(await attendre(async () => (await presents(pc, 'onglets-app-tsuzuku')) === 0, 5000), 'Ctrl+W : onglet Tsuzuku fermé');

  log('PC : côte à côte');
  await pc.getByTestId('onglets-app-taches-ouvrir').click();
  await pc.getByTestId('onglets-app-claude-office-menu').click();
  await pc.getByTestId('onglets-menu-a-cote').click();
  await pc.getByTestId('onglets-separation').waitFor({ timeout: 10_000 });
  const g1 = await boite(pc, 'onglets-contenu-taches');
  const d1 = await boite(pc, 'onglets-contenu-claude-office');
  verifier(g1 && d1 && g1.x < 10 && Math.abs(g1.width - d1.width) < 30 && d1.x > g1.x + g1.width - 10, `Tâches à gauche, Claude Office à droite, moitié-moitié (${Math.round(g1?.width)} / ${Math.round(d1?.width)} px)`);
  verifier((await pc.getByTestId('taches-recherche').inputValue()) === 'Facture', 'côte à côte, Tâches garde sa recherche');
  const sep = await boite(pc, 'onglets-separation');
  await pc.mouse.move(sep.x + sep.width / 2, sep.y + sep.height / 2);
  await pc.mouse.down();
  await pc.mouse.move(sep.x + sep.width / 2 - 120, sep.y + sep.height / 2, { steps: 8 });
  await pc.mouse.move(sep.x + sep.width / 2 - 220, sep.y + sep.height / 2, { steps: 8 });
  await pc.mouse.up();
  const g2 = await boite(pc, 'onglets-contenu-taches');
  const d2 = await boite(pc, 'onglets-contenu-claude-office');
  verifier(g2.width < g1.width - 150 && d2.width > d1.width + 150, `séparation glissée : ${Math.round(g2.width)} / ${Math.round(d2.width)} px`);
  await capture(pc, '03-pc-cote-a-cote');
  await pc.getByTestId('onglets-echanger').click();
  const g3 = await boite(pc, 'onglets-contenu-claude-office');
  const d3 = await boite(pc, 'onglets-contenu-taches');
  verifier(g3.x < 10 && d3.x > g3.x + 100 && Math.abs(g3.width - d2.width) < 20, 'côtés échangés : chaque app garde sa largeur');
  await pc.getByTestId('onglets-quitter-droite').click();
  verifier(await attendre(async () => (await presents(pc, 'onglets-separation')) === 0, 5000), 'côté droit fermé : une seule app à l’écran');
  verifier((await presents(pc, 'onglets-app-taches')) === 1, '… son onglet reste dans la barre');

  log('PC : onglets restaurés après rechargement (sur le hub)');
  await pc.reload();
  await deverrouillerSiDemande(pc, secret, 'hub');
  await fermerPopups(pc);
  await pc.getByTestId('onglets-barre').waitFor({ timeout: 30_000 });
  const restaures = await pc.locator('[data-testid^="onglets-app-"][data-testid$="-ouvrir"]').count();
  verifier(restaures === 3, `onglets restaurés (${restaures})`);
  verifier((await presents(pc, 'hub')) === 1 && (await presents(pc, 'app-taches')) === 0, 'au redémarrage : sur le hub, rien ne s’ouvre seul');

  // ===================================================== App de bureau simulée
  log('Bureau (simulé) : « Ouvrir dans une nouvelle fenêtre »');
  await pc.evaluate(() => {
    window.applibourse = Object.assign(window.applibourse ?? {}, { bureau: true, fenetres: { version: 1 } });
  });
  await pc.getByTestId('onglets-app-taches-ouvrir').click();
  await pc.getByTestId('app-taches').waitFor({ timeout: 20_000 });
  await pc.getByTestId('onglets-app-taches-menu').click();
  const libelle = await pc.getByTestId('onglets-menu-ailleurs').innerText();
  verifier(/nouvelle fenêtre/.test(libelle), `menu : « ${libelle.trim()} »`);
  const [fenetre] = await Promise.all([pc.waitForEvent('popup'), pc.getByTestId('onglets-menu-ailleurs').click()]);
  fenetre.on('pageerror', e => log('erreur fenêtre annexe :', e.message));
  const ouverte = await fenetre.getByTestId('app-taches').waitFor({ timeout: 60_000 }).then(() => true, () => false);
  verifier(ouverte, 'la nouvelle fenêtre affiche Tâches');
  verifier((await presents(fenetre, 'bouton-deverrouiller')) === 0, '… sans second déverrouillage (même session)');
  verifier((await presents(fenetre, 'onglets-barre')) === 0, '… sans barre d’onglets (une app par fenêtre)');
  verifier(await attendre(async () => (await presents(pc, 'onglets-app-taches')) === 0, 5000), 'l’onglet Tâches quitte la fenêtre principale (pas deux fois la même app)');
  await fenetre.setViewportSize({ width: 1100, height: 800 });
  await capture(fenetre, '04-bureau-fenetre-taches');
  // Rouvrir Tâches depuis le hub : la fenêtre existante passe au premier plan (pas de doublon).
  await pc.getByTestId('onglets-hub').click();
  await allerPageApplications(pc);
  await tuile(pc, 'taches').click();
  await pause(600);
  verifier((await presents(pc, 'onglets-app-taches')) === 0, 'rouvrir Tâches depuis le hub : sa fenêtre est remontée, pas de second exemplaire');
  // Verrouiller la fenêtre principale ferme la fenêtre annexe.
  await pc.getByTestId('hub-verrouiller').click();
  verifier(await attendre(async () => fenetre.isClosed(), 10_000), 'verrouiller : la fenêtre annexe se ferme');
  await deverrouillerSiDemande(pc, secret, 'hub');
  await fermerPopups(pc);

  // ======================================================= Site : liens profonds
  log('Site : « Ouvrir dans un nouvel onglet du navigateur »');
  await pc.evaluate(() => {
    delete window.applibourse.bureau;
    delete window.applibourse.fenetres;
  });
  await pc.getByTestId('onglets-barre').waitFor({ timeout: 20_000 });
  await pc.getByTestId('onglets-app-claude-office-menu').click();
  const libelleSite = await pc.getByTestId('onglets-menu-ailleurs').innerText();
  verifier(/onglet du navigateur/.test(libelleSite), `menu du site : « ${libelleSite.trim()} »`);
  const [ongletNav] = await Promise.all([contextePc.waitForEvent('page'), pc.getByTestId('onglets-menu-ailleurs').click()]);
  await ongletNav.waitForLoadState('domcontentloaded');
  verifier(/#\/app\/claude-office$/.test(ongletNav.url()), `adresse profonde (${ongletNav.url().replace(site.url, '/')})`);
  await deverrouillerSiDemande(ongletNav, secret, 'claude-office-onglet-bureau');
  verifier((await presents(ongletNav, 'claude-office-onglet-bureau')) === 1, 'après le déverrouillage, Claude Office s’ouvre directement');
  verifier(!/#\/app\//.test(ongletNav.url()), 'le lien suivi s’efface de l’adresse');
  await ongletNav.close();
  log('Site : lien profond tapé à la main');
  const profond = await contextePc.newPage();
  await profond.goto(`${site.url}#/app/taches`);
  await deverrouillerSiDemande(profond, secret, 'app-taches');
  verifier((await presents(profond, 'app-taches')) === 1, '#/app/taches : Tâches s’ouvre après le déverrouillage');
  await capture(profond, '05-site-lien-profond');
  await profond.close();

  // ================================================== Ami : lien interdit
  log('Ami : un lien profond vers une app interdite ne l’ouvre pas');
  await pc.bringToFront();
  await pc.getByTestId('onglets-hub').click();
  await allerPageAdministration(pc);
  await tuile(pc, 'administration').click();
  await pc.getByTestId('app-administration').waitFor({ timeout: 20_000 });
  await pc.getByTestId('admin-onglet-utilisateurs').click();
  await pc.getByTestId('admin-nouveau').click();
  await pc.getByTestId('admin-nom').fill('Léa');
  await pc.getByTestId('admin-nouveau-informe').click();
  await pc.getByTestId('admin-creer').click();
  await pc.getByTestId('admin-identifiants').waitFor({ timeout: 60_000 });
  const mdpLea = (await pc.getByTestId('admin-mot-de-passe').innerText()).replace(/^\s*Mot de passe\s*/, '').trim();
  const secretLea = (await pc.getByTestId('admin-secret-totp').innerText()).replace(/^\s*Clé TOTP\s*/, '').replace(/\s+/g, '');
  await pc.getByTestId('admin-transmis').click().catch(() => undefined);
  await pc.getByTestId('admin-termine').click();
  const lea = await contextePc.newPage();
  for (const app of ['administration', 'claude-office']) {
    await lea.goto(`${site.url}#/app/${app}`);
    await lea.getByTestId('connexion-prenom').waitFor({ timeout: 60_000 });
    await lea.getByTestId('connexion-prenom').fill('Léa');
    await lea.getByTestId('connexion-continuer').click();
    await lea.getByTestId('bouton-deverrouiller').waitFor({ timeout: 60_000 });
    for (const decalage of [0, 1, -1]) {
      await lea.locator('input[type=password]').first().fill(mdpLea);
      await lea.locator('input:not([type=password])').first().fill(totp(secretLea, decalage));
      await lea.getByTestId('bouton-deverrouiller').click();
      if (await lea.getByTestId('hub').waitFor({ timeout: 25_000 }).then(() => true, () => false)) break;
    }
    await fermerPopups(lea);
    verifier((await presents(lea, 'hub')) === 1, `Léa, lien #/app/${app} : elle reste sur le hub`);
    verifier((await presents(lea, `onglets-app-${app}`)) === 0 && (await presents(lea, 'app-administration')) === 0, `… sans onglet ${app}`);
    verifier(await attendre(async () => (await presents(lea, 'avis-onglets')) === 1, 5000), '… et un avis le dit');
    if (app === 'administration') await capture(lea, '06-ami-lien-interdit');
  }
  await lea.close();

  // ======================================================= iPad paysage
  log('iPad paysage : côte à côte');
  const contexteIpad = await nouveauContexte(navigateur, {
    viewport: { width: 1366, height: 1024 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: false,
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  const { page: ipad } = await nouveauCompte(contexteIpad, site.url, 'iPad');
  await toucher(ipad, 'tuile-taches');
  await ipad.getByTestId('app-taches').waitFor({ timeout: 20_000 });
  await toucher(ipad, 'onglets-hub');
  await toucher(ipad, 'tuile-portefeuille');
  await toucher(ipad, 'onglets-app-taches-menu');
  await toucher(ipad, 'onglets-menu-a-cote');
  await ipad.getByTestId('onglets-separation').waitFor({ timeout: 10_000 });
  const gi = await boite(ipad, 'vue-principale');
  const di = await boite(ipad, 'onglets-contenu-taches');
  verifier(gi && di && gi.x < 10 && di.x > 600 && Math.abs(gi.width - di.width) < 30, `iPad : Portefeuille à gauche, Tâches à droite (${Math.round(gi?.width)} / ${Math.round(di?.width)} px)`);
  await capture(ipad, '07-ipad-cote-a-cote');
  await contexteIpad.close();

  // ======================================================= iPhone
  log('iPhone : onglets compacts');
  const contexteIphone = await nouveauContexte(navigateur, optionsIphone());
  const { page: iphone } = await nouveauCompte(contexteIphone, site.url, 'iPhone');
  await toucher(iphone, 'tuile-taches');
  await iphone.getByTestId('app-taches').waitFor({ timeout: 20_000 });
  verifier((await presents(iphone, 'onglets-barre')) === 0, 'iPhone : pas de barre d’onglets');
  await toucher(iphone, 'retour-hub');
  await toucher(iphone, 'tuile-tsuzuku');
  await iphone.getByTestId('tsuzuku-racine').waitFor({ timeout: 20_000 });
  await toucher(iphone, 'onglets-mobile-ouvrir');
  await iphone.getByTestId('onglets-mobile-taches').waitFor({ timeout: 10_000 });
  await capture(iphone, '08-iphone-selecteur');
  await toucher(iphone, 'onglets-mobile-taches');
  verifier(await attendre(async () => (await presents(iphone, 'app-taches')) === 1 && (await presents(iphone, 'tsuzuku-racine')) === 0, 8000), 'iPhone : le sélecteur ramène à Tâches (Tsuzuku masquée)');
  verifier((await presents(iphone, 'onglets-separation')) === 0, 'iPhone : jamais de côte à côte');
  const mesures = await mesurer(iphone);
  verifier(mesures.debordementPage === 0, `iPhone : aucun débordement horizontal (${mesures.debordementPage} px)`);
  await contexteIphone.close();
} catch (erreur) {
  echecs++;
  log('ERREUR', erreur instanceof Error ? erreur.stack : erreur);
} finally {
  await navigateur.close();
  site.fermer();
}
log(echecs === 0 ? 'TOUT EST VERT' : `${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
