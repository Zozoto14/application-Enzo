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
 * Tsuzuku (réseau externe bloqué : API simulées comme dans e2e-tsuzuku) : hub → Tsuzuku → Animés / Films →
 * recherche → filtre en feuille → fiche → lien de source → lecture simulée (iframe) → épisode suivant →
 * « vu ailleurs » → bibliothèque → feuille Plus → Paramètres › Tsuzuku ; mêmes contrôles, puis 375 × 667.
 * Captures dans captures-apres/tsuzuku/ (Nuit, Ivoire, Terminal).
 *
 * Variables : PLAYWRIGHT_PATH, CAPTURES (défaut docs/mobile/captures-apres).
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chargerPlaywright, demarrerRelais, demarrerSite, deverrouiller, mesurer, optionsIphone, pause, premierLancement, racine, simulerInternet, toucher, visible } from './mobile-outils.mjs';

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/mobile/captures-apres');
mkdirSync(CAPTURES, { recursive: true });
const CAPTURES_TSUZUKU = join(CAPTURES, 'tsuzuku');
mkdirSync(CAPTURES_TSUZUKU, { recursive: true });
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


// ================================================================== Tsuzuku
// Le faux lecteur de mobile-outils répond « Lecteur neutre » sans le chemin : on vérifie aussi l'adresse du cadre.
const dansCadre = async (page, texte) => {
  const chemin = /\(([^)]*)\)/.exec(texte)?.[1];
  const ok = await page.frameLocator('[data-testid="lecteur-iframe"]').getByText(/Lecteur neutre/).waitFor({ timeout: 15_000 }).then(() => true, () => false);
  const src = (await page.getByTestId('lecteur-iframe').getAttribute('src')) ?? '';
  return ok && (!chemin || src.endsWith(chemin));
};

async function ouvrirTsuzuku(page) {
  await toucher(page, 'tuile-tsuzuku');
  await page.getByTestId('tsuzuku-racine').waitFor({ timeout: 20_000 });
  await page.getByTestId('rangee-trending').waitFor({ timeout: 30_000 });
  await pause(500);
}
async function retourAuHub(page) {
  await toucher(page, 'retour-hub');
  await page.getByTestId('hub').waitFor({ timeout: 20_000 });
}
/** Revient sur l'accueil Animés de Tsuzuku, quelle que soit la page. */
async function accueilAnimes(page) {
  for (let i = 0; i < 4 && !(await page.getByTestId('onglet-app').isVisible().catch(() => false)); i++) {
    await toucher(page, (await page.getByTestId('lecteur-retour').count()) ? 'lecteur-retour' : 'fiche-retour');
    await pause(300);
  }
  await toucher(page, 'onglet-app-accueil');
  await toucher(page, 'mode-anime');
  await page.getByTestId('rangee-trending').waitFor({ timeout: 30_000 });
  await pause(300);
}
const debordementPage = page => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

/** Parcours complet de Tsuzuku sur téléphone, avec les contrôles de recette à chaque écran. */
async function parcoursTsuzuku(page) {
  log('Tsuzuku : accueil Animés');
  await ouvrirTsuzuku(page);
  verifier(await visible(page, 'tsuzuku-une', 5000), 'Tsuzuku : bandeau « à la une » (héros)');
  verifier(await visible(page, 'onglet-app', 3000), 'Tsuzuku : barre basse Accueil · Catalogue · Bibliothèque · Plus');
  verifier((await page.getByTestId('mode-anime').getAttribute('aria-checked')) === 'true', 'Tsuzuku : sélecteur Animés | Films en haut (Animés actif)');
  verifier((await page.locator('[data-testid^="carte-anime-"] img').count()) > 0, 'Tsuzuku : les affiches se chargent (API simulées)');
  await controler(page, 'tsuzuku › accueil Animés');

  log('Tsuzuku : rangée qui défile');
  const cible = page.getByTestId('rangee-trending').locator('[data-testid^="carte-anime-"]').last();
  const avant = await page.getByTestId('rangee-trending').evaluate(el => Math.max(...[...el.querySelectorAll('*')].map(n => n.scrollLeft)));
  await page.getByTestId('rangee-trending').evaluate(el => [...el.querySelectorAll('*')].forEach(n => { if (n.scrollWidth > n.clientWidth + 5) n.scrollLeft = 300; }));
  const apres = await page.getByTestId('rangee-trending').evaluate(el => Math.max(...[...el.querySelectorAll('*')].map(n => n.scrollLeft)));
  verifier(apres > avant, 'Tsuzuku : la rangée défile horizontalement');
  void cible;
  await page.getByTestId('rangee-trending').evaluate(el => [...el.querySelectorAll('*')].forEach(n => { n.scrollLeft = 0; }));
  await pause(300);

  log('Tsuzuku : Films');
  await toucher(page, 'mode-movie');
  await page.getByText(/Sans clé TMDB/).waitFor({ timeout: 20_000 });
  verifier(await visible(page, 'tsuzuku-une', 10_000), 'Tsuzuku : accueil Films avec bandeau à l’affiche');
  verifier((await page.getByTestId('mode-movie').getAttribute('aria-checked')) === 'true', 'Tsuzuku : Films actif (l’accent change)');
  await controler(page, 'tsuzuku › accueil Films');
  await toucher(page, 'mode-anime');
  await page.getByTestId('rangee-trending').waitFor({ timeout: 30_000 });

  log('Tsuzuku : catalogue et recherche');
  await toucher(page, 'onglet-app-catalogue');
  await page.getByTestId('catalogue-grille').waitFor({ timeout: 20_000 });
  await controler(page, 'tsuzuku › catalogue');
  const colonnes = await page.locator('[data-testid="catalogue-grille"] > div').evaluateAll(els => new Set(els.map(e => Math.round(e.getBoundingClientRect().left))).size);
  verifier(colonnes === 2, `Tsuzuku : grille d’affiches à 2 colonnes (${colonnes})`);
  await toucher(page, 'catalogue-filtres');
  await page.getByTestId('catalogue-feuille-genres').waitFor({ timeout: 5000 });
  await controler(page, 'tsuzuku › filtres (feuille)');
  await toucher(page, 'genre-tous');
  await page.getByTestId('catalogue-recherche').fill('Frieren');
  await page.getByTestId('catalogue-recherche').press('Enter');
  await page.getByText('Résultats pour « Frieren »').waitFor({ timeout: 20_000 });
  await page.getByTestId('carte-anime-1').waitFor({ timeout: 20_000 });
  verifier((await page.locator('[data-testid^="carte-anime-"]').count()) === 1, 'Tsuzuku : la recherche (touche « Rechercher » du clavier) trouve Frieren');
  await controler(page, 'tsuzuku › recherche');

  log('Tsuzuku : fiche');
  await toucher(page, 'carte-anime-1');
  await page.getByTestId('fiche-titre').waitFor({ timeout: 20_000 });
  await page.getByTestId('episode-3').waitFor({ timeout: 20_000 });
  const pied = await page.getByTestId('fiche-lire').boundingBox();
  verifier(pied && pied.y + pied.height > 844 - 200, 'Tsuzuku : « Lire » est collé en bas de la fiche, sous le pouce');
  verifier(await visible(page, 'liens-legaux', 3000), 'Tsuzuku : plateformes légales proposées comme simples liens');
  await controler(page, 'tsuzuku › fiche');
  await toucher(page, 'fiche-synopsis-plus').catch(() => undefined);
  verifier(await visible(page, 'fiche-synopsis', 2000), 'Tsuzuku : synopsis présent (repliable)');

  log('Tsuzuku : lecture sans source, puis lien direct');
  await toucher(page, 'fiche-lire');
  await page.getByTestId('lecteur-message').waitFor({ timeout: 20_000 });
  await controler(page, 'tsuzuku › lecteur sans source');
  await toucher(page, 'lecteur-vers-fiche');
  await page.getByTestId('fiche-titre').waitFor({ timeout: 20_000 });
  await toucher(page, 'lien-anime-ouvrir');
  await page.getByTestId('lien-feuille').waitFor({ timeout: 5000 });
  await page.getByTestId('lien-anime-adresse').fill('https://lecteur-exemple.fr/embed/frieren-ep-1');
  await page.getByTestId('lien-anime-episode').fill('1');
  await toucher(page, 'lien-anime-analyser');
  await page.getByTestId('lien-anime-motif').waitFor({ timeout: 5000 });
  const motif = await page.getByTestId('lien-anime-motif').inputValue();
  verifier(motif === 'https://lecteur-exemple.fr/embed/frieren-ep-{n}', `Tsuzuku : motif {n} déduit du lien collé (${motif})`);
  await controler(page, 'tsuzuku › lien de source (feuille)');
  await toucher(page, 'lien-anime-enregistrer');
  await page.getByTestId('lien-anime-resume').waitFor({ timeout: 10_000 });
  await page.getByTestId('lien-feuille-fermer').tap();
  await pause(300);

  log('Tsuzuku : lecture simulée');
  await toucher(page, 'fiche-lire');
  await page.getByTestId('lecteur-iframe').waitFor({ timeout: 20_000 });
  verifier(await dansCadre(page, 'Lecteur neutre (/embed/frieren-ep-1)'), 'Tsuzuku : le lecteur (iframe cloisonné) joue l’épisode 1');
  const video = await page.getByTestId('lecteur-iframe').boundingBox();
  verifier(video && Math.abs(video.width - 390) < 2 && Math.abs(video.height - 390 * 9 / 16) < 3, `Tsuzuku : vidéo 16:9 pleine largeur (${Math.round(video?.width ?? 0)} × ${Math.round(video?.height ?? 0)})`);
  verifier(await visible(page, 'lecteur-plein-ecran', 2000), 'Tsuzuku : bouton « Plein écran » (paysage)');
  await controler(page, 'tsuzuku › lecteur');
  await toucher(page, 'lecteur-suivant');
  verifier(await dansCadre(page, 'Lecteur neutre (/embed/frieren-ep-2)'), 'Tsuzuku : « Suivant » enchaîne l’épisode 2');
  await toucher(page, 'lecteur-precedent');
  verifier(await dansCadre(page, 'Lecteur neutre (/embed/frieren-ep-1)'), 'Tsuzuku : « Précédent » revient à l’épisode 1');
  await page.evaluate(() => window.scrollTo(0, 0));

  log('Tsuzuku : vu ailleurs');
  await accueilAnimes(page);
  await toucher(page, 'carte-anime-2');
  await page.getByTestId('fiche-titre').waitFor({ timeout: 20_000 });
  await toucher(page, 'vu-ailleurs-ouvrir');
  await page.getByTestId('vu-ailleurs-formulaire').waitFor({ timeout: 5000 });
  await page.getByTestId('vu-ailleurs-note').fill('9');
  await page.getByTestId('vu-ailleurs-commentaire').fill('Vu chez des amis');
  await controler(page, 'tsuzuku › vu ailleurs (feuille)');
  await toucher(page, 'vu-ailleurs-enregistrer');
  verifier(await page.getByTestId('fiche-statut').filter({ hasText: 'Vu ailleurs' }).waitFor({ timeout: 10_000 }).then(() => true, () => false), 'Tsuzuku : le titre passe à « Vu ailleurs »');
  await toucher(page, 'fiche-biblio');
  await page.getByTestId('fiche-feuille-biblio').waitFor({ timeout: 5000 });
  await controler(page, 'tsuzuku › ma bibliothèque (feuille)');
  await toucher(page, 'fiche-feuille-biblio-ok');
  await pause(300);

  log('Tsuzuku : bibliothèque');
  await toucher(page, 'fiche-retour');
  await toucher(page, 'onglet-app-bibliotheque');
  await page.getByTestId('bibliotheque-stats').waitFor({ timeout: 10_000 });
  await toucher(page, 'onglet-vu_ailleurs');
  verifier(await visible(page, 'carte-anime-2', 5000), 'Tsuzuku : l’onglet « Vu ailleurs » contient le titre, avec son badge');
  verifier(await visible(page, 'badge-deja-vu', 3000), 'Tsuzuku : badge « Vu ailleurs » sur l’affiche');
  await controler(page, 'tsuzuku › bibliothèque (vu ailleurs)');
  await toucher(page, 'onglet-en_cours');
  verifier(await visible(page, 'carte-anime-1', 5000), 'Tsuzuku : l’onglet « En cours » contient Frieren');
  await controler(page, 'tsuzuku › bibliothèque (en cours)');
  await toucher(page, 'bibliotheque-sauvegarde');
  await page.getByTestId('bibliotheque-feuille-sauvegarde').waitFor({ timeout: 5000 });
  await controler(page, 'tsuzuku › sauvegarde (feuille)');
  await page.getByTestId('bibliotheque-feuille-sauvegarde-fermer').tap();

  log('Tsuzuku : Plus, Paramètres');
  await toucher(page, 'onglet-app-plus');
  await page.getByTestId('tsuzuku-plus').waitFor({ timeout: 5000 });
  await controler(page, 'tsuzuku › Plus (feuille)');
  await toucher(page, 'tsuzuku-reglages');
  await page.getByTestId('hub-parametres').waitFor({ timeout: 20_000 });
  if (!(await visible(page, 'parametres-panneau-tsuzuku', 3000))) await toucher(page, 'parametres-section-tsuzuku');
  await page.getByTestId('parametres-panneau-tsuzuku').waitFor({ timeout: 5000 });
  verifier(await visible(page, 'reglage-tsuzuku-lecture', 3000), 'Paramètres › Tsuzuku : doublage, épisode suivant, déjà vus');
  await controler(page, 'paramètres › Tsuzuku');
  await toucher(page, 'tsuzuku-langue-vf');
  await toucher(page, 'parametres-retour');
  await toucher(page, 'barre-basse-accueil').catch(() => undefined);
  await page.getByTestId('hub').waitFor({ timeout: 10_000 });
}

/** Captures « après » de Tsuzuku dans le thème courant. */
async function capturesTsuzuku(page, theme) {
  const cap = async nom => {
    await pause(500);
    await page.screenshot({ path: join(CAPTURES_TSUZUKU, `${theme}-${nom}.jpg`), type: 'jpeg', quality: 78 });
  };
  await ouvrirTsuzuku(page);
  await cap('01-accueil-animes');
  await page.evaluate(() => document.querySelector('[data-testid="tsuzuku-une"]')?.scrollIntoView({ block: 'start' }));
  await page.evaluate(() => { const d = [...document.querySelectorAll('div')].find(e => e.scrollHeight > e.clientHeight + 50 && getComputedStyle(e).overflowY === 'auto'); if (d) d.scrollTop = 520; });
  await cap('02-accueil-rangees');
  await toucher(page, 'mode-movie');
  await page.getByTestId('tsuzuku-une').waitFor({ timeout: 20_000 });
  await cap('03-accueil-films');
  await toucher(page, 'mode-anime');
  await page.getByTestId('rangee-trending').waitFor({ timeout: 30_000 });
  await toucher(page, 'onglet-app-catalogue');
  await page.getByTestId('catalogue-grille').waitFor({ timeout: 20_000 });
  await cap('04-catalogue');
  await toucher(page, 'catalogue-filtres');
  await cap('05-catalogue-filtres');
  await toucher(page, 'genre-tous');
  await toucher(page, 'carte-anime-2');
  await page.getByTestId('fiche-titre').waitFor({ timeout: 20_000 });
  await page.getByTestId('episode-3').waitFor({ timeout: 20_000 });
  await cap('06-fiche');
  await page.evaluate(() => { const d = [...document.querySelectorAll('div')].find(e => e.scrollHeight > e.clientHeight + 50 && getComputedStyle(e).overflowY === 'auto'); if (d) d.scrollTop = 700; });
  await cap('07-fiche-episodes');
  await toucher(page, 'fiche-biblio');
  await cap('08-fiche-bibliotheque');
  await toucher(page, 'fiche-feuille-biblio-ok');
  await toucher(page, 'lien-anime-ouvrir');
  await cap('09-fiche-lien');
  await page.getByTestId('lien-feuille-fermer').tap();
  await toucher(page, 'fiche-lire');
  await page.getByTestId('lecteur-message').or(page.getByTestId('lecteur-iframe')).first().waitFor({ timeout: 20_000 });
  await cap('10-lecteur');
  await toucher(page, 'lecteur-retour');
  await toucher(page, 'vu-ailleurs-ouvrir');
  await cap('11-vu-ailleurs');
  await page.getByTestId('vu-ailleurs-formulaire-fermer').tap();
  await toucher(page, 'fiche-retour');
  await toucher(page, 'onglet-app-bibliotheque');
  await page.getByTestId('bibliotheque-stats').waitFor({ timeout: 10_000 });
  await cap('12-bibliotheque');
  await toucher(page, 'onglet-app-plus');
  await cap('13-plus');
  await page.getByTestId('tsuzuku-plus-fermer').tap();
  await retourAuHub(page);
}

const site = await demarrerSite(5261);
const relais = await demarrerRelais(8861);
const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
try {
  const contexte = await navigateur.newContext(optionsIphone({ largeur: 390, hauteur: 844 }));
  await simulerInternet(contexte);
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
        verifier(await visible(page, 'pied-collant', 2000), 'accueil : « Relier ce navigateur » est collé en bas de l’écran');
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
  await page.getByTestId('support-sujet').fill('Affichage sur téléphone');
  await page.getByTestId('support-message').fill('Test de bout en bout du formulaire mobile.');
  await toucher(page, 'support-envoyer');
  const envoye = await page.getByTestId('support-resultat').waitFor({ timeout: 30_000 }).then(() => true, () => false);
  verifier(envoye && relais.discord.length === 1, 'le ticket part du téléphone (faux Discord par le vrai relais)');
  await toucher(page, 'hub-support-fermer');
  await page.getByTestId('hub').waitFor({ timeout: 10_000 });
  verifier(true, '« ‹ Accueil » ramène au hub');

  // ================================================================ Tsuzuku
  await parcoursTsuzuku(page);
  await retourAuHub(page).catch(() => undefined);

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
  await ouvrirTsuzuku(page);
  await controler(page, 'tsuzuku accueil (375 × 667)');
  await toucher(page, 'onglet-app-catalogue');
  await page.getByTestId('catalogue-grille').waitFor({ timeout: 20_000 });
  await controler(page, 'tsuzuku catalogue (375 × 667)');
  await toucher(page, 'carte-anime-1');
  await page.getByTestId('fiche-titre').waitFor({ timeout: 20_000 });
  await controler(page, 'tsuzuku fiche (375 × 667)');
  await toucher(page, 'fiche-lire');
  await page.getByTestId('lecteur-iframe').waitFor({ timeout: 20_000 });
  await controler(page, 'tsuzuku lecteur (375 × 667)');
  await toucher(page, 'lecteur-retour');
  await toucher(page, 'fiche-retour');
  await toucher(page, 'onglet-app-bibliotheque');
  await page.getByTestId('bibliotheque-stats').waitFor({ timeout: 10_000 });
  await controler(page, 'tsuzuku bibliothèque (375 × 667)');
  await retourAuHub(page);
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
    await capturesTsuzuku(page, theme);
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
  const neuf = await (await navigateur.newContext(optionsIphone())).newPage();
  rang = 0;
  await neuf.goto(`${site.url}#liaison=${relais.code}`);
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
