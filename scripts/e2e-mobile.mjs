/**
 * Test de bout en bout de l'affichage téléphone (émulation d'iPhone, tactile, densité 3).
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-mobile.mjs
 *
 * Parcours : connexion complète (accueil du site → création du coffre → secrets → documents légaux)
 * → hub → personnalisation (boutons) → Paramètres (liste → sous-page → retour) → Support (ticket vers
 * un faux Discord par le vrai relais) → retour → feuille « Compte » → verrouiller → déverrouiller.
 *
 * Sur CHAQUE écran, vérifié par code : aucun débordement horizontal, tous les éléments interactifs
 * visibles ≥ 44 × 44 px, tous les textes visibles ≥ 15 px, champs ≥ 16 px (pas de zoom iOS).
 * Puis captures « après » à 390 × 844 dans trois thèmes (Nuit, Ivoire, Terminal), et un passage du hub
 * à 375 × 667 (petit iPhone).
 *
 * Variables : PLAYWRIGHT_PATH, CAPTURES (défaut docs/mobile/captures-apres).
 */

import { mkdirSync } from 'node:fs';
import { SCRIPT_PC, SCRIPT_REPORTER_MIGRATION } from './e2e-acceptation.mjs';
import { join } from 'node:path';
import { chargerPlaywright, demarrerRelais, demarrerSite, deverrouiller, mesurer, optionsIphone, pause, premierLancement, racine, toucher, visible } from './mobile-outils.mjs';

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/mobile/captures-apres');
mkdirSync(CAPTURES, { recursive: true });
const MDP = 'mot-de-passe-e2e-mobile-très-long-42';
const log = (...a) => console.log('[e2e-mobile]', ...a);
let echecs = 0;
const verifier = (ok, message) => {
  console.log(ok ? '  OK   ' : '  ECHEC', message);
  if (!ok) echecs++;
};

/** Contrôle d'un écran : débordement, cibles, textes, champs. */
async function controler(page, nom) {
  await pause(400);
  const m = await mesurer(page);
  verifier(m.debordementPage === 0 && m.deborde.length === 0, `${nom} : aucun débordement horizontal${m.deborde.length ? ` (${m.deborde.join(' | ')})` : ''}`);
  verifier(m.petitesCibles === 0, `${nom} : ${m.interactifs} éléments interactifs, tous ≥ 44 px${m.petitesCibles ? ` (sous 44 px : ${m.exemplesCibles.join(' | ')})` : ''}`);
  verifier(m.petitsTextes === 0, `${nom} : textes ≥ 15 px${m.petitsTextes ? ` (${m.exemplesPetits.join(' | ')})` : ''}`);
  const zoom = m.champs.filter(c => c.includes('zoom iOS'));
  verifier(zoom.length === 0, `${nom} : champs ≥ 16 px${zoom.length ? ` (${zoom.join(' | ')})` : ''}`);
  return m;
}

let rang = 0;
const capture = (page, theme, nom) => page.screenshot({ path: join(CAPTURES, `${theme}-${String(++rang).padStart(2, '0')}-${nom}.jpg`), type: 'jpeg', quality: 75 });

const site = await demarrerSite(5261);
const relais = await demarrerRelais(8861);
const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
try {
  const contexte = await navigateur.newContext(optionsIphone({ largeur: 390, hauteur: 844 }));
  // PC simulé (relais version 9) : le lien de test tient lieu du relais-local.json ; migration reportée.
  await contexte.addInitScript(SCRIPT_PC);
  await contexte.addInitScript(SCRIPT_REPORTER_MIGRATION);
  const page = await contexte.newPage();
  const erreursPage = [];
  page.on('pageerror', e => {
    erreursPage.push(e.message);
    log('erreur page :', e.message);
  });

  // ================================================================ Connexion complète
  log('Premier lancement sur téléphone');
  const secret = await premierLancement(page, {
    site: site.url,
    code: relais.code,
    motDePasse: MDP,
    etape: async nom => {
      await controler(page, nom);
      if (nom === 'accueil-site') {
        // Relais version 9 : plus de « Relier ce navigateur » (code de liaison) ; on se connecte par identifiant.
        verifier(await visible(page, 'connexion-id-valider', 2000), 'accueil : « Se connecter » (identifiant + mot de passe) est là, sans code de liaison');
      }
      if (nom === 'premier-lancement') {
        const types = await page.locator('input[type=password]').evaluateAll(els => els.map(e => `${e.getAttribute('autocomplete')}/${e.getAttribute('enterkeyhint')}`));
        verifier(types.every(t => t.startsWith('new-password/')), `création : mots de passe en « new-password » pour le gestionnaire (${types.join(', ')})`);
      }
    },
  });
  await page.getByTestId('acceptation-juridique').waitFor({ timeout: 60_000 });
  await controler(page, 'acceptation');
  const barreAvant = await page.getByTestId('acceptation-continuer').boundingBox();
  verifier(barreAvant && barreAvant.y + barreAvant.height > 844 - 160, '« Continuer » est en bas de l’écran, sous le pouce');
  await toucher(page, 'acceptation-case');
  await toucher(page, 'acceptation-continuer');
  await page.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(page, MDP, secret));
  await page.getByText(/Fermer|Terminé|Compris|Plus tard/).first().tap({ timeout: 3000 }).catch(() => undefined);
  await page.getByTestId('hub').waitFor({ timeout: 20_000 });

  // ================================================================ Hub
  log('Hub');
  verifier(await visible(page, 'hub-entete-mobile', 5000), 'le hub a son en-tête compact de téléphone');
  verifier(await visible(page, 'barre-basse', 5000), 'la barre de navigation basse est là (Accueil · Support · Réglages · Compte)');
  verifier((await page.getByTestId('barre-basse-accueil').getAttribute('aria-selected')) === 'true', '« Accueil » est l’onglet actif');
  await controler(page, 'hub');
  const tuile = await page.getByTestId('tuile-portefeuille').boundingBox();
  verifier(tuile && tuile.width < 200, `tuiles compactes en 2 colonnes (largeur ${Math.round(tuile?.width ?? 0)} px)`);

  log('Personnalisation tactile');
  await toucher(page, 'hub-personnaliser');
  await page.getByTestId('hub-barre-edition').waitFor({ timeout: 5000 });
  await controler(page, 'hub-personnaliser');
  const ordreAvant = await page.locator('[data-testid^="edition-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid')));
  await toucher(page, `${ordreAvant[1].replace('edition-', 'edit-')}-avant`);
  await pause(300);
  const ordreApres = await page.locator('[data-testid^="edition-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid')));
  verifier(ordreApres[0] === ordreAvant[1], `réordonner par bouton ▲ : ${ordreAvant[1]} passe en premier`);
  await toucher(page, `${ordreApres[0].replace('edition-', 'edit-')}-apres`);
  await toucher(page, 'hub-terminer');
  await page.getByTestId('barre-basse').waitFor({ timeout: 5000 });

  // ================================================================ Paramètres
  log('Paramètres');
  await toucher(page, 'barre-basse-parametres');
  await page.getByTestId('hub-parametres').waitFor({ timeout: 10_000 });
  verifier(await visible(page, 'parametres-section-general', 3000), 'Paramètres : une liste de sections');
  await controler(page, 'parametres');
  for (const id of ['general', 'synchro', 'securite', 'support', 'apropos']) {
    if (!(await visible(page, `parametres-section-${id}`, 2000))) continue;
    await toucher(page, `parametres-section-${id}`);
    await page.getByTestId(`parametres-panneau-${id}`).waitFor({ timeout: 5000 });
    await controler(page, `parametres › ${id}`);
    await toucher(page, 'parametres-retour');
    await page.getByTestId('parametres-section-general').waitFor({ timeout: 5000 });
  }
  await page.getByTestId('parametres-recherche').fill('theme');
  verifier(await visible(page, 'parametres-resultats', 3000), 'la recherche filtre les réglages');
  await page.getByTestId('parametres-recherche').fill('');

  // ================================================================ Support
  log('Support');
  await toucher(page, 'barre-basse-support');
  await page.getByTestId('hub-support').waitFor({ timeout: 10_000 });
  await controler(page, 'support');
  await toucher(page, 'support-categorie-bug');
  await page.getByTestId('support-titre').fill('Affichage sur téléphone');
  await page.getByTestId('support-message').fill('Test de bout en bout du formulaire mobile.');
  await toucher(page, 'support-envoyer');
  const envoye = await page.getByTestId('support-resultat').waitFor({ timeout: 30_000 }).then(() => true, () => false);
  verifier(envoye && relais.discord.length === 1, 'le ticket part du téléphone (faux Discord par le vrai relais)');
  await toucher(page, 'hub-support-fermer');
  await page.getByTestId('hub').waitFor({ timeout: 10_000 });
  verifier(true, '« ‹ Accueil » ramène au hub');

  // ================================================================ Compte → verrouiller → déverrouiller
  log('Compte, verrouillage');
  await toucher(page, 'barre-basse-compte');
  await page.getByTestId('feuille-compte').waitFor({ timeout: 5000 });
  await controler(page, 'feuille Compte');
  await toucher(page, 'feuille-compte-verrouiller');
  await page.getByTestId('bouton-deverrouiller').waitFor({ timeout: 20_000 });
  await controler(page, 'déverrouillage');
  const code = await page.locator('input:not([type=password])').first().evaluate(e => `${e.getAttribute('inputmode')}/${e.getAttribute('autocomplete')}`);
  verifier(code === 'numeric/one-time-code', `code TOTP : clavier numérique et « one-time-code » (${code})`);
  await deverrouiller(page, MDP, secret);
  verifier(true, 'connexion de nouveau, hub affiché');

  // ================================================================ Petit iPhone
  log('375 × 667');
  await page.setViewportSize({ width: 375, height: 667 });
  await controler(page, 'hub (375 × 667)');
  await page.setViewportSize({ width: 390, height: 844 });

  // ================================================================ Captures dans trois thèmes
  for (const theme of ['nuit', 'ivoire', 'terminal']) {
    log(`Captures : ${theme}`);
    rang = 0;
    await toucher(page, 'barre-basse-parametres');
    await toucher(page, 'parametres-section-general');
    await toucher(page, `parametres-theme-${theme}`);
    await pause(500);
    await capture(page, theme, 'parametres-general');
    await toucher(page, 'parametres-retour');
    await capture(page, theme, 'parametres');
    await toucher(page, 'barre-basse-accueil');
    await page.getByTestId('hub').waitFor();
    await pause(600);
    await capture(page, theme, 'hub');
    await toucher(page, 'hub-personnaliser');
    await capture(page, theme, 'hub-personnaliser');
    await toucher(page, 'hub-terminer');
    await toucher(page, 'barre-basse-support');
    await capture(page, theme, 'support');
    await toucher(page, 'hub-support-fermer');
    await toucher(page, 'barre-basse-compte');
    await pause(400);
    await capture(page, theme, 'feuille-compte');
    await toucher(page, 'feuille-compte-verrouiller');
    await page.getByTestId('bouton-deverrouiller').waitFor({ timeout: 20_000 });
    await pause(400);
    await capture(page, theme, 'deverrouillage');
    await deverrouiller(page, MDP, secret);
    await controler(page, `hub (${theme})`);
  }

  // Écrans d'entrée dans un navigateur neuf (thème par défaut)
  const contexteNeuf = await navigateur.newContext(optionsIphone());
  await contexteNeuf.addInitScript(SCRIPT_REPORTER_MIGRATION);
  const neuf = await contexteNeuf.newPage();
  rang = 0;
  // Navigateur NEUF : aucun compte ici (relais version 9 : on s'y connecterait par identifiant).
  await neuf.goto(site.url);
  await neuf.getByTestId('accueil-site').waitFor({ timeout: 60_000 });
  await pause(500);
  await capture(neuf, 'entree', 'accueil-site');
  await toucher(neuf, 'accueil-creer');
  await pause(500);
  await capture(neuf, 'entree', 'feuille-creer-coffre');
  await toucher(neuf, 'accueil-creer-confirmer');
  await neuf.locator('input[type=password]').first().waitFor({ timeout: 60_000 });
  await capture(neuf, 'entree', 'premier-lancement');

  verifier(erreursPage.length === 0, `aucune erreur JavaScript (${erreursPage.length})`);
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
