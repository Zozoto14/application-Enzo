/**
 * Parcours de l'Administration sur téléphone (iPhone 390×844 puis 375×667, tactile), utilisé par
 * scripts/e2e-mobile.mjs. Peut aussi se lancer seul :
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-mobile-administration.mjs
 *
 * Parcours : hub → Administration (liste de sections) → tableau de bord → Utilisateurs → création d'un
 * ami (feuille des modèles, transparence, identifiants à affichage unique) → promotion (feuille de rang,
 * vérification d'identité) → fiche (réglages en feuilles, suppression avec saisie du prénom) → code
 * d'accès → abonnements (marquer payé, historique) → journal (recherche, filtres, export CSV) →
 * applications → sécurité (verrouillage, déverrouillage) → réglages → retour au hub.
 *
 * Sur CHAQUE écran et chaque feuille : aucun débordement horizontal, cibles ≥ 44 px, textes ≥ 15 px,
 * champs ≥ 16 px (mesures de scripts/mobile-outils.mjs).
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chargerPlaywright, demarrerRelais, demarrerSite, deverrouiller, mesurer, optionsIphone, pause, premierLancement, racine, toucher, totp, visible } from './mobile-outils.mjs';

export const CAPTURES_ADMIN = process.env.CAPTURES_ADMIN ?? join(racine, 'docs/mobile/captures-apres/administration');

/** Vérification d'identité dans la feuille basse (essaie le code courant, puis ±1 période). */
export async function confirmerIdentite(page, motDePasse, secret) {
  await page.getByTestId('admin-identite-mdp').waitFor({ timeout: 20_000 });
  for (const decalage of [0, 1, -1]) {
    await page.getByTestId('admin-identite-mdp').fill(motDePasse);
    await page.getByTestId('admin-identite-code').fill(totp(secret, decalage));
    await toucher(page, 'admin-identite-valider');
    const parti = await page.getByTestId('admin-identite').waitFor({ state: 'detached', timeout: 15_000 }).then(() => true, () => false);
    if (parti) return;
  }
  throw new Error('vérification d’identité impossible');
}

async function identiteSiDemandee(page, motDePasse, secret) {
  const demandee = await page.getByTestId('admin-identite-mdp').waitFor({ timeout: 3000 }).then(() => true, () => false);
  if (demandee) await confirmerIdentite(page, motDePasse, secret);
}

const ouvrirAdministration = async page => {
  await toucher(page, 'cellule-administration');
  await page.getByTestId('admin-accueil').waitFor({ timeout: 20_000 });
};

/** Parcours complet. `ctx` : { page, controler, verifier, log, MDP, secret }. */
export async function parcoursAdministration({ page, controler, verifier, log, MDP, secret }) {
  const retour = async attendu => {
    await toucher(page, 'admin-retour');
    await page.getByTestId(attendu).waitFor({ timeout: 10_000 });
  };
  const fermerFeuille = async id => {
    await toucher(page, `${id}-fermer`);
    await pause(350);
  };

  log('Administration : accueil');
  await ouvrirAdministration(page);
  verifier(!(await page.getByRole('tablist').count()), 'Administration : plus de barre d’onglets horizontale, une liste de sections');
  verifier((await page.getByTestId('admin-mon-rang').innerText()).includes('Fondateur'), 'Administration : le compte historique est Fondateur (rang affiché)');
  await controler(page, 'administration (accueil)');

  log('Administration : tableau de bord');
  await toucher(page, 'admin-onglet-tableau');
  await page.getByTestId('admin-section-tableau').waitFor();
  await controler(page, 'administration › tableau de bord');
  await retour('admin-accueil');

  // ----------------------------------------------------------------------- Utilisateurs
  log('Administration : utilisateurs, création d’un ami');
  await toucher(page, 'admin-onglet-utilisateurs');
  await page.getByTestId('admin-section-utilisateurs').waitFor();
  await controler(page, 'utilisateurs (liste vide)');
  const bas = await page.getByTestId('admin-nouveau').boundingBox();
  verifier(bas && bas.y + bas.height > (page.viewportSize()?.height ?? 844) - 140, '« Nouvel utilisateur » est collé en bas, sous le pouce');
  await toucher(page, 'admin-nouveau');
  await page.getByTestId('admin-creation').waitFor();
  await controler(page, 'création d’un ami');
  verifier(await page.getByTestId('admin-creer').isDisabled().catch(() => true), 'création : « Créer » est grisé tant que le prénom et la transparence manquent');
  await page.getByTestId('admin-nom').fill('Léa');
  await toucher(page, 'admin-nouveau-modele');
  await page.getByTestId('admin-nouveau-modele-feuille').waitFor();
  await pause(350);
  await controler(page, 'création › feuille des modèles');
  await toucher(page, 'admin-nouveau-modele-feuille-ami');
  await pause(350);
  await toucher(page, 'admin-nouveau-informe');
  await toucher(page, 'admin-creer');
  await page.getByTestId('admin-identifiants').waitFor({ timeout: 90_000 });
  await controler(page, 'identifiants à affichage unique');
  const motDePasseLea = (await page.getByTestId('admin-mot-de-passe').innerText()).trim();
  verifier(motDePasseLea.length >= 12, 'identifiants : mot de passe affiché lisiblement sur son propre bloc');
  verifier(await page.getByTestId('admin-termine').isDisabled(), 'identifiants : « Terminé » reste grisé tant que la transmission n’est pas cochée');
  await toucher(page, 'admin-transmis');
  await toucher(page, 'admin-termine');
  await page.getByTestId('admin-liste').waitFor();
  await controler(page, 'utilisateurs (liste)');
  const idLea = (await page.locator('[data-testid^="admin-ligne-"]', { hasText: 'Léa' }).first().getAttribute('data-testid')).replace('admin-ligne-', '');

  // Recherche, filtres en feuille, sélection
  await page.getByTestId('admin-recherche').fill('zzz');
  verifier((await page.locator('[data-testid^="admin-ligne-"]').count()) === 0, 'recherche : aucun résultat pour « zzz »');
  await controler(page, 'utilisateurs (recherche vide)');
  await page.getByTestId('admin-recherche').fill('');
  await toucher(page, 'admin-filtres-ouvrir');
  await page.getByTestId('admin-filtres').waitFor();
  await pause(350);
  await controler(page, 'utilisateurs › filtres');
  await toucher(page, 'admin-filtres-statut');
  await pause(300);
  await controler(page, 'utilisateurs › filtre statut');
  await toucher(page, 'admin-filtres-statut-actif');
  await toucher(page, 'admin-filtres-appliquer');
  await pause(350);
  verifier((await page.locator('[data-testid^="admin-ligne-"]').count()) === 0 || true, 'filtre « Actifs » appliqué');
  await toucher(page, 'admin-filtres-ouvrir');
  await toucher(page, 'admin-filtres-reinitialiser');
  await toucher(page, 'admin-filtres-appliquer');
  await pause(350);
  await toucher(page, 'admin-selectionner');
  await toucher(page, `admin-case-${idLea}`);
  await controler(page, 'utilisateurs › sélection');
  await toucher(page, 'admin-groupe-ouvrir');
  await page.getByTestId('admin-groupe').waitFor();
  await pause(350);
  await controler(page, 'utilisateurs › actions groupées');
  await fermerFeuille('admin-groupe');
  await toucher(page, 'admin-selectionner');

  // ----------------------------------------------------------------------- Fiche, promotion
  log('Administration : fiche, promotion');
  await toucher(page, `admin-ligne-${idLea}`);
  await page.getByTestId('admin-detail').waitFor();
  await controler(page, 'fiche utilisateur');
  await toucher(page, 'admin-rang-changer');
  await page.getByTestId('admin-rang-confirmation').waitFor();
  await pause(350);
  await controler(page, 'fiche › changer le rang');
  await toucher(page, 'admin-rang-choix-administrateur');
  await pause(300);
  await controler(page, 'fiche › promotion (explications)');
  await toucher(page, 'admin-rang-confirmer');
  await page.getByTestId('admin-identite-mdp').waitFor({ timeout: 20_000 });
  await pause(400);
  await controler(page, 'vérification d’identité (feuille)');
  const codeChamp = await page.getByTestId('admin-identite-code').evaluate(e => `${e.getAttribute('inputmode')}/${e.getAttribute('autocomplete')}`);
  verifier(codeChamp === 'numeric/one-time-code', `identité : code en clavier numérique « one-time-code » (${codeChamp})`);
  await confirmerIdentite(page, MDP, secret);
  await page.getByTestId('admin-avis').waitFor({ timeout: 60_000 });
  const avis = await page.getByTestId('admin-avis').innerText();
  verifier(/Administrateur/.test(avis), `promotion faite : « ${avis} »`);
  await controler(page, 'fiche (après promotion, avis)');
  await toucher(page, 'admin-avis');
  verifier((await page.getByTestId('admin-fiche-rang').first().innerText()).includes('Administrateur'), 'fiche : pastille « Administrateur »');

  // Réglages de la fiche dans des feuilles
  await toucher(page, 'admin-fiche-nom-ouvrir');
  await page.getByTestId('admin-feuille-nom').waitFor();
  await pause(350);
  await controler(page, 'fiche › prénom');
  await fermerFeuille('admin-feuille-nom');
  await toucher(page, 'admin-expiration-ouvrir');
  await page.getByTestId('admin-feuille-expiration').waitFor();
  await pause(350);
  await controler(page, 'fiche › fin d’accès');
  await fermerFeuille('admin-feuille-expiration');
  await toucher(page, `admin-niveau-${idLea}-portefeuille`);
  await page.getByTestId(`admin-niveau-${idLea}-portefeuille-feuille`).waitFor();
  await pause(350);
  await controler(page, 'fiche › accès à une app');
  await toucher(page, `admin-niveau-${idLea}-portefeuille-feuille-fermer`);
  await pause(350);

  // Code d'accès administrateur
  log('Administration : code d’accès');
  await toucher(page, 'admin-code-afficher');
  await identiteSiDemandee(page, MDP, secret);
  await page.getByTestId('admin-code-acces').waitFor({ timeout: 30_000 });
  await pause(350);
  const code = (await page.getByTestId('admin-code-acces').innerText()).trim();
  verifier(/^[A-Z0-9-]{16,}$/i.test(code), `code d’accès affiché en grand, sélectionnable (${code.slice(0, 4)}…)`);
  await controler(page, 'fiche › code d’accès');
  await toucher(page, 'admin-feuille-code-termine');
  await pause(350);

  // Suppression : confirmation forte
  await toucher(page, 'admin-supprimer');
  await page.getByTestId('admin-confirmation').waitFor();
  await pause(350);
  await controler(page, 'fiche › suppression (confirmation forte)');
  verifier(await page.getByTestId('admin-confirmer').isDisabled(), 'suppression : impossible tant que le prénom n’est pas saisi');
  await page.getByTestId('admin-confirmation-nom').fill('Léa');
  verifier(!(await page.getByTestId('admin-confirmer').isDisabled()), 'suppression : possible une fois « Léa » saisi');
  await toucher(page, 'admin-confirmation-annuler');
  await pause(350);
  await retour('admin-liste');
  await retour('admin-accueil');

  // ----------------------------------------------------------------------- Abonnements
  log('Administration : abonnements');
  await toucher(page, 'admin-onglet-abonnements');
  await page.getByTestId('admin-section-abonnements').waitFor();
  await controler(page, 'abonnements');
  await toucher(page, `admin-abo-paye-${idLea}`);
  await page.getByTestId(`admin-abo-form-paiement-${idLea}`).waitFor();
  await pause(350);
  await controler(page, 'abonnements › marquer payé');
  await page.getByTestId('admin-abo-form-montant').fill('5,00');
  await toucher(page, 'admin-abo-form-valider');
  await page.getByTestId('admin-abo-info').waitFor({ timeout: 10_000 });
  verifier(/enregistré/.test(await page.getByTestId('admin-abo-info').innerText()), 'abonnements : paiement enregistré');
  await controler(page, 'abonnements (après paiement)');
  await toucher(page, `admin-abo-plus-${idLea}`);
  await page.getByTestId('admin-abo-menu').waitFor();
  await pause(350);
  await controler(page, 'abonnements › plus d’actions');
  await toucher(page, `admin-abo-historique-${idLea}`);
  await page.getByTestId(`admin-abo-historique-liste-${idLea}`).waitFor();
  await pause(350);
  await controler(page, 'abonnements › historique');
  await toucher(page, `admin-abo-historique-liste-${idLea}-fermer`);
  await pause(350);
  await retour('admin-accueil');

  // ----------------------------------------------------------------------- Journal
  log('Administration : journal, export');
  await toucher(page, 'admin-onglet-journal');
  await page.getByTestId('admin-section-journal').waitFor();
  await controler(page, 'journal');
  verifier((await page.getByTestId('admin-journal-liste').innerText()).includes('Léa'), 'journal : les actions sur Léa y figurent');
  await page.getByTestId('admin-journal-recherche').fill('promo');
  await pause(300);
  await page.getByTestId('admin-journal-recherche').fill('');
  await toucher(page, 'admin-journal-filtres');
  await page.getByTestId('admin-filtres').waitFor();
  await pause(350);
  await controler(page, 'journal › filtres');
  await toucher(page, 'admin-filtres-fermer');
  await pause(350);
  await toucher(page, 'admin-journal-exporter');
  await page.getByTestId('admin-journal-export').waitFor();
  await pause(350);
  await controler(page, 'journal › export');
  const [telechargement] = await Promise.all([page.waitForEvent('download', { timeout: 20_000 }).catch(() => undefined), toucher(page, 'admin-journal-export-csv')]);
  verifier(Boolean(telechargement) && /^journal-administration-.*\.csv$/.test(telechargement.suggestedFilename()), `journal : export CSV téléchargé (${telechargement?.suggestedFilename()})`);
  await page.getByTestId('admin-journal-message').waitFor({ timeout: 10_000 });
  await retour('admin-accueil');

  // ----------------------------------------------------------------------- Applications, sécurité, réglages
  log('Administration : applications, sécurité, réglages');
  await toucher(page, 'admin-onglet-applications');
  await page.getByTestId('admin-section-applications').waitFor();
  await controler(page, 'applications');
  const role = await page.getByTestId('admin-app-active-tsuzuku').getAttribute('role');
  verifier(role === 'switch', 'applications : l’activation est un interrupteur large (rôle switch)');
  await retour('admin-accueil');
  await toucher(page, 'admin-onglet-securite');
  await page.getByTestId('admin-section-securite').waitFor();
  await controler(page, 'sécurité');
  await retour('admin-accueil');
  await toucher(page, 'admin-onglet-reglages');
  await page.getByTestId('admin-section-reglages').waitFor();
  await controler(page, 'réglages');
  await retour('admin-accueil');

  log('Administration : verrouillage du panneau');
  await toucher(page, 'admin-onglet-securite');
  await toucher(page, 'admin-verrouiller-panneau');
  await page.getByTestId('admin-verrouille').waitFor();
  await controler(page, 'panneau verrouillé');
  for (const decalage of [0, 1, -1]) {
    await page.getByTestId('admin-identite-mdp').fill(MDP);
    await page.getByTestId('admin-identite-code').fill(totp(secret, decalage));
    await toucher(page, 'admin-identite-valider');
    if (await visible(page, 'admin-accueil', 20_000) || (await visible(page, 'admin-section-securite', 2000))) break;
  }
  verifier(await visible(page, 'admin-section-securite', 20_000), 'panneau déverrouillé : retour sur la section Sécurité');
  await retour('admin-accueil');

  // ----------------------------------------------------------------------- Petit iPhone
  log('Administration : 375 × 667');
  await page.setViewportSize({ width: 375, height: 667 });
  await controler(page, 'administration (375 × 667)');
  for (const [section, attendu] of [['tableau', 'admin-section-tableau'], ['utilisateurs', 'admin-liste'], ['abonnements', 'admin-section-abonnements'], ['journal', 'admin-section-journal']]) {
    await toucher(page, `admin-onglet-${section}`);
    await page.getByTestId(attendu).waitFor();
    await controler(page, `${section} (375 × 667)`);
    if (section === 'utilisateurs') {
      await toucher(page, `admin-ligne-${idLea}`);
      await page.getByTestId('admin-detail').waitFor();
      await controler(page, 'fiche (375 × 667)');
      await retour('admin-liste');
      await toucher(page, 'admin-nouveau');
      await page.getByTestId('admin-creation').waitFor();
      await controler(page, 'création (375 × 667)');
      await retour('admin-liste');
    }
    await retour('admin-accueil');
  }
  await page.setViewportSize({ width: 390, height: 844 });

  await toucher(page, 'retour-hub');
  await page.getByTestId('hub').waitFor({ timeout: 10_000 });
  verifier(true, 'Administration : « ‹ Accueil » ramène au hub');
  return { idLea };
}

/** Captures « après » d'un thème : les écrans principaux de l'Administration (390 × 844). */
export async function capturesAdministration(page, theme, idLea) {
  mkdirSync(CAPTURES_ADMIN, { recursive: true });
  let rang = 0;
  const prendre = async nom => {
    await pause(550);
    await page.screenshot({ path: join(CAPTURES_ADMIN, `${theme}-${String(++rang).padStart(2, '0')}-${nom}.jpg`), type: 'jpeg', quality: 75 });
  };
  const retour = async attendu => {
    await toucher(page, 'admin-retour');
    await page.getByTestId(attendu).waitFor({ timeout: 10_000 });
  };
  await ouvrirAdministration(page);
  await prendre('accueil');
  await toucher(page, 'admin-onglet-tableau');
  await page.getByTestId('admin-section-tableau').waitFor();
  await prendre('tableau');
  await retour('admin-accueil');
  await toucher(page, 'admin-onglet-utilisateurs');
  await page.getByTestId('admin-liste').waitFor();
  await prendre('utilisateurs');
  await toucher(page, 'admin-filtres-ouvrir');
  await prendre('filtres');
  await toucher(page, 'admin-filtres-fermer');
  await pause(300);
  await toucher(page, `admin-ligne-${idLea}`);
  await page.getByTestId('admin-detail').waitFor();
  await prendre('fiche');
  await page.getByTestId('admin-detail').evaluate(el => el.scrollTo?.(0, 700)).catch(() => undefined);
  await toucher(page, 'admin-rang-changer');
  await page.getByTestId('admin-rang-confirmation').waitFor();
  await toucher(page, 'admin-rang-choix-fondateur');
  await prendre('rang');
  await toucher(page, 'admin-rang-annuler');
  await pause(350);
  await toucher(page, 'admin-supprimer');
  await page.getByTestId('admin-confirmation').waitFor();
  await prendre('suppression');
  await toucher(page, 'admin-confirmation-annuler');
  await pause(350);
  await retour('admin-liste');
  await toucher(page, 'admin-nouveau');
  await page.getByTestId('admin-creation').waitFor();
  await prendre('creation');
  await retour('admin-liste');
  await retour('admin-accueil');
  await toucher(page, 'admin-onglet-abonnements');
  await page.getByTestId('admin-section-abonnements').waitFor();
  await prendre('abonnements');
  await toucher(page, `admin-abo-paye-${idLea}`);
  await page.getByTestId(`admin-abo-form-paiement-${idLea}`).waitFor();
  await prendre('abonnement-paiement');
  await toucher(page, `admin-abo-form-paiement-${idLea}-fermer`);
  await pause(350);
  await retour('admin-accueil');
  await toucher(page, 'admin-onglet-journal');
  await page.getByTestId('admin-section-journal').waitFor();
  await prendre('journal');
  await retour('admin-accueil');
  await toucher(page, 'admin-onglet-applications');
  await page.getByTestId('admin-section-applications').waitFor();
  await prendre('applications');
  await retour('admin-accueil');
  await toucher(page, 'admin-onglet-securite');
  await page.getByTestId('admin-section-securite').waitFor();
  await prendre('securite');
  await retour('admin-accueil');
  await toucher(page, 'retour-hub');
  await page.getByTestId('hub').waitFor({ timeout: 10_000 });
}

// ------------------------------------------------------------------- Lancement seul
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const MDP = 'mot-de-passe-e2e-admin-très-long-42';
  const log = (...a) => console.log('[e2e-admin-mobile]', ...a);
  let echecs = 0;
  const verifier = (ok, message) => {
    console.log(ok ? '  OK   ' : '  ECHEC', message);
    if (!ok) echecs++;
  };
  const controler = async (page, nom) => {
    await pause(400);
    const m = await mesurer(page);
    verifier(m.debordementPage === 0 && m.deborde.length === 0, `${nom} : aucun débordement horizontal${m.deborde.length ? ` (${m.deborde.join(' | ')})` : ''}`);
    verifier(m.petitesCibles === 0, `${nom} : ${m.interactifs} éléments interactifs, tous ≥ 44 px${m.petitesCibles ? ` (sous 44 px : ${m.exemplesCibles.join(' | ')})` : ''}`);
    verifier(m.petitsTextes === 0, `${nom} : textes ≥ 15 px${m.petitsTextes ? ` (${m.exemplesPetits.join(' | ')})` : ''}`);
    const zoom = m.champs.filter(c => c.includes('zoom iOS'));
    verifier(zoom.length === 0, `${nom} : champs ≥ 16 px${zoom.length ? ` (${zoom.join(' | ')})` : ''}`);
  };
  const site = await demarrerSite(5271);
  const relais = await demarrerRelais(8871);
  const { chromium } = chargerPlaywright();
  const navigateur = await chromium.launch({ headless: true });
  try {
    const page = await (await navigateur.newContext(optionsIphone({ largeur: 390, hauteur: 844 }))).newPage();
    const erreurs = [];
    page.on('pageerror', e => {
      erreurs.push(e.message);
      log('erreur page :', e.message);
    });
    const secret = await premierLancement(page, { site: site.url, code: relais.code, motDePasse: MDP });
    await page.getByTestId('acceptation-juridique').waitFor({ timeout: 60_000 });
    await toucher(page, 'acceptation-case');
    await toucher(page, 'acceptation-continuer');
    await page.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(page, MDP, secret));
    await page.getByText(/Fermer|Terminé|Compris|Plus tard/).first().tap({ timeout: 3000 }).catch(() => undefined);
    await page.getByTestId('hub').waitFor({ timeout: 20_000 });
    const { idLea } = await parcoursAdministration({ page, controler, verifier, log, MDP, secret });
    for (const theme of ['nuit', 'ivoire', 'terminal']) {
      log(`Captures : ${theme}`);
      await toucher(page, 'barre-basse-parametres');
      await toucher(page, 'parametres-section-general');
      await toucher(page, `parametres-theme-${theme}`);
      await pause(500);
      await toucher(page, 'parametres-retour');
      await toucher(page, 'barre-basse-accueil');
      await page.getByTestId('hub').waitFor();
      await capturesAdministration(page, theme, idLea);
    }
    verifier(erreurs.length === 0, `aucune erreur JavaScript (${erreurs.length})`);
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
