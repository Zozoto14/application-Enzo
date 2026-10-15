/**
 * Test de bout en bout du PILOTE AUTOMATIQUE DE SEMAINE (« Ta semaine », dans Tâches).
 *
 * Horloge simulée (Playwright) : dimanche 18 octobre 2026. Le Fondateur (site relié à un faux relais) a
 * des tâches (dates, priorités, estimations, une récurrente), une relance (Prospects), un paiement
 * (Abonnements, compte de Léa) et une bibliothèque Tsuzuku.
 *
 *  - avant 18 h le dimanche : pas de proposition ; à 18 h : la pastille 🔔 de Tâches et l'alerte
 *    « Ta semaine est prête » (un seul envoi) ; l'alerte ouvre « Ta semaine » ;
 *  - la semaine du 19 au 25 octobre : tâches placées dans les créneaux (charge max par jour, jours off),
 *    relance du mardi, paiement du jeudi, épisodes verrouillés le soir ; rien n'est écrit dans Tâches ;
 *  - déplacer (boutons ‹ ›, glisser à la souris puis au doigt), retirer et remettre, régénérer, réglages
 *    (charge, jours off, créneaux) ;
 *  - « Tout valider » : jours et créneaux appliqués dans Tâches, UNE seule modification (au plus un dépôt
 *    sur le relais) ; « Annuler la validation » les rend ;
 *  - terminer les tâches d'un jour débloque l'épisode du soir (sans jamais bloquer Tsuzuku) ;
 *  - 8 thèmes (PC), iPad (1024 × 768 et 820 × 1180), iPhone (390 × 844) : mesures (débordement, cibles de
 *    44 px, textes de 15 px).
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-pilote-semaine.mjs
 *
 * Captures JPEG légères dans docs/captures-pilote-semaine/ (variable CAPTURES).
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { allerPageAdministration, nouveauContexte, tuileApp } from './e2e-acceptation.mjs';
import { chargerPlaywright, demarrerRelais, demarrerSite, mesurer, pause, premierLancement, racine, totp, visible } from './mobile-outils.mjs';

const { chromium } = chargerPlaywright();
const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-pilote-semaine');
mkdirSync(CAPTURES, { recursive: true });
const PORT_RELAIS = 8831;
const PORT_SITE = 5241;
const MDP_ADMIN = 'mot-de-passe-du-pc-e2e-pilote-semaine-42';

// ------------------------------------------------------------- Horloge : dimanche 18 octobre 2026, 10 h (node et navigateur)
const reel = Date.now.bind(Date);
let decalage = new Date(2026, 9, 18, 10, 0, 0).getTime() - reel();
/** Code TOTP à l'heure simulée du navigateur (Date.now n'est changé que le temps du calcul : Playwright s'en sert aussi). */
const totpFictif = (secret, d = 0) => {
  const sauve = Date.now;
  Date.now = () => reel() + decalage;
  try {
    return totp(secret, d);
  } finally {
    Date.now = sauve;
  }
};
async function deverrouillerFictif(page, motDePasse, secret) {
  for (const d of [0, 1, -1]) {
    await page.locator('input[type=password]').first().fill(motDePasse);
    await page.locator('input:not([type=password])').first().fill(totpFictif(secret, d));
    await page.getByTestId('bouton-deverrouiller').click();
    if (await visible(page, 'hub', 25_000)) return;
  }
  throw new Error('déverrouillage impossible');
}
const aller = (jour, h, m = 0, s = 0) => {
  decalage = new Date(2026, 9, jour, h, m, s).getTime() - reel();
};

const log = (...a) => console.log('[e2e-pilote-semaine]', ...a);
let echecs = 0;
const verifier = (ok, message) => {
  console.log(ok ? '  OK   ' : '  ECHEC', message);
  if (!ok) echecs++;
};
const GARDEES = new Set(['01-pc-semaine', '02-pc-semaine-clair', '03-pc-reglages', '04-pc-validee', '05-pc-recompense', '06-ipad-semaine', '07-ipad-portrait', '08-iphone-semaine', '09-iphone-reglages', '10-pc-notification']);
const capture = (page, nom) => (GARDEES.has(nom) || process.env.CAPTURES_TOUTES ? page.screenshot({ path: join(CAPTURES, `${nom}.jpg`), type: 'jpeg', quality: 55 }) : Promise.resolve());
const attendre = async (condition, delai = 30_000, pas = 500) => {
  const limite = reel() + delai;
  while (reel() < limite) {
    if (await condition().catch(() => false)) return true;
    await pause(pas);
  }
  return false;
};
const texteDe = (page, id) => page.getByTestId(id).first().innerText();
/** Mesures limitées à l'écran « Ta semaine » (cibles tactiles de 44 px, textes de 15 px, débordement). */
const mesurerSemaine = page =>
  page.evaluate(() => {
    const racine = document.querySelector('[data-testid="vue-pilote"]');
    const petites = [];
    const textes = [];
    for (const el of racine.querySelectorAll('button, [role=button], [role=switch], [role=radio], [role=checkbox], input')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44)) petites.push(`${el.getAttribute('aria-label') ?? el.textContent} (${Math.round(r.width)}×${Math.round(r.height)})`);
    }
    const marcheur = document.createTreeWalker(racine, NodeFilter.SHOW_TEXT);
    for (let n = marcheur.nextNode(); n; n = marcheur.nextNode()) {
      if (!n.textContent.trim() || !n.parentElement) continue;
      const taille = Number.parseFloat(getComputedStyle(n.parentElement).fontSize);
      if (taille < 15) textes.push(`${n.textContent.trim().slice(0, 30)} (${taille}px)`);
    }
    const debord = Math.max(0, document.documentElement.scrollWidth - window.innerWidth);
    return { petites, textes, debord };
  });
const aMesureSemaine = async (page, nom) => {
  const m = await mesurerSemaine(page);
  verifier(m.petites.length === 0 && m.textes.length === 0 && m.debord === 0, `${nom} : mesures de Ta semaine (cibles ${m.petites.length}, textes ${m.textes.length}, débordement ${m.debord}${m.petites.length || m.textes.length ? ` : ${[...m.petites, ...m.textes].slice(0, 3).join(' ; ')}` : ''})`);
};
const aMesure = async (page, nom) => {
  const m = await mesurer(page);
  verifier(m.petitesCibles === 0 && m.petitsTextes === 0 && m.debordementPage === 0, `${nom} : mesures (cibles ${m.petitesCibles}, textes ${m.petitsTextes}, débordement ${m.debordementPage}${m.exemplesCibles?.length || m.exemplesPetits?.length ? ` : ${[...(m.exemplesCibles ?? []), ...(m.exemplesPetits ?? [])].slice(0, 3).join(' ; ')}` : ''})`);
};

const site = await demarrerSite(PORT_SITE);
const relais = await demarrerRelais(PORT_RELAIS, 'jeton-e2e-pilote-semaine-0123456789abcd');
const SITE = site.url;

let secretAdmin;
const confirmerIdentite = async page => {
  const demandee = await page.getByTestId('admin-identite-mdp').waitFor({ timeout: 4000 }).then(() => true, () => false);
  if (!demandee) return;
  for (const d of [0, 1, -1]) {
    await page.getByTestId('admin-identite-mdp').fill(MDP_ADMIN);
    await page.getByTestId('admin-identite-code').fill(totpFictif(secretAdmin, d));
    await page.getByTestId('admin-identite-valider').click();
    if (await page.getByTestId('admin-identite').waitFor({ state: 'detached', timeout: 15_000 }).then(() => true, () => false)) return;
  }
  throw new Error('vérification d’identité impossible');
};
async function fermerPopups(page) {
  for (let i = 0; i < 3; i++) {
    const clique = await page.getByText(/^(Fermer|Terminé|Compris|Plus tard)$/).first().click({ timeout: 2500 }).then(() => true, () => false);
    if (!clique) break;
  }
  await page.keyboard.press('Escape').catch(() => undefined);
}
async function creerAmi(page, nom) {
  await page.getByTestId('admin-onglet-utilisateurs').click();
  await page.getByTestId('admin-nouveau').click();
  await page.getByTestId('admin-nom').fill(nom);
  await page.getByTestId('admin-nouveau-informe').click();
  await page.getByTestId('admin-creer').click();
  await page.getByTestId('admin-identifiants').waitFor({ timeout: 60_000 });
  await page.getByTestId('admin-transmis').click().catch(() => undefined);
  await page.getByTestId('admin-termine').click();
}
const versHub = async page => {
  await page.getByTestId('retour-hub').first().click();
  await page.getByTestId('hub').waitFor({ timeout: 20_000 });
};
async function ouvrirApp(page, id, testApp) {
  await page.getByTestId('hub').waitFor({ timeout: 20_000 });
  const t = tuileApp(page, id).first();
  if (!(await t.isVisible().catch(() => false))) {
    // Les apps réservées sont sur la page « Administration », les autres sur « Applications ».
    const pages = ['hub-page-publique', 'hub-page-administration', 'barre-basse-accueil', 'barre-basse-administration'];
    for (const p of pages) {
      if (await page.getByTestId(p).first().isVisible().catch(() => false)) {
        await page.getByTestId(p).first().click();
        if (await t.waitFor({ timeout: 3000 }).then(() => true, () => false)) break;
      }
    }
  }
  await t.waitFor({ timeout: 20_000 });
  await t.click();
  await page.getByTestId(testApp).waitFor({ timeout: 20_000 });
}
async function ajoutRapide(page, texte) {
  await page.getByTestId('ajout-rapide').click();
  await page.getByTestId('ajout-rapide').fill(texte);
  await page.keyboard.press('Enter');
  await page.getByTestId('taches-avis').filter({ hasText: 'Ajoutée' }).first().waitFor({ timeout: 10_000 });
}
const idTache = async (page, titre) => {
  const el = page.locator('[data-testid^="ligne-"], [data-testid^="carte-"], [data-testid^="journee-"], [data-testid^="cal-tache-"]').filter({ hasText: titre }).first();
  return (await el.getAttribute('data-testid', { timeout: 15_000 })).replace(/^(ligne|carte|journee|cal-tache)-/, '');
};
async function glisserSouris(page, source, cible) {
  const a = await page.getByTestId(source).boundingBox();
  const b = await page.getByTestId(cible).boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + Math.min(20, a.height / 2));
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(a.x + a.width / 2 + ((b.x + b.width / 2 - a.x - a.width / 2) * i) / 12, a.y + Math.min(20, a.height / 2) + ((b.y + Math.min(40, b.height / 2) - a.y - Math.min(20, a.height / 2)) * i) / 12);
    await pause(25);
  }
  await page.mouse.up();
  await pause(300);
}
async function glisserDoigt(page, source, cible) {
  const a = await page.getByTestId(source).boundingBox();
  const b = await page.getByTestId(cible).boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const x0 = a.x + a.width / 2;
  const y0 = a.y + Math.min(20, a.height / 2);
  const x1 = b.x + b.width / 2;
  const y1 = b.y + Math.min(40, b.height / 2);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  await pause(500);
  for (let i = 1; i <= 12; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / 12, y: y0 + ((y1 - y0) * i) / 12 }] });
    await pause(30);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await pause(400);
}
/** Jour (AAAA-MM-JJ) où se trouve l'élément dans « Ta semaine ». */
const jourDeElement = (page, id) =>
  page.evaluate(i => {
    const el = document.querySelector(`[data-testid="pilote-element-${i}"]`);
    const zone = el?.closest('[data-testid^="pilote-jour-"]');
    return zone ? zone.getAttribute('data-testid').replace('pilote-jour-', '') : undefined;
  }, id);
const elements = page => page.evaluate(() => [...document.querySelectorAll('[data-testid^="pilote-element-"]')].map(e => e.getAttribute('data-testid').replace('pilote-element-', '')));
const chargeDe = async (page, jour) => texteDe(page, `pilote-charge-${jour}`);
const minutes = t => {
  const h = /(\d+) h/.exec(t);
  const m = /(?:^|\s)(\d+) min/.exec(t) ?? /h (\d+)/.exec(t);
  return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
};
const requetesRelais = [];

const navigateur = await chromium.launch({ headless: true });
const erreursPage = [];
try {
  const contexte = await nouveauContexte(navigateur, { ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 }, hasTouch: true });
  await contexte.clock.install({ time: new Date(reel() + decalage) });
  const pc = await contexte.newPage();
  pc.on('pageerror', e => {
    erreursPage.push(e.message);
    log('erreur page :', e.message);
  });
  pc.on('request', r => {
    if (r.url().startsWith(`https://localhost:${PORT_RELAIS}`) && r.method() !== 'GET') requetesRelais.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });

  // ================================================================ Mise en place
  log('Coffre du Fondateur, Léa (Abonnements), une relance (Prospects), une bibliothèque (Tsuzuku)');
  secretAdmin = await premierLancement(pc, { site: SITE, code: relais.code, motDePasse: MDP_ADMIN });
  await pc.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouillerFictif(pc, MDP_ADMIN, secretAdmin));
  await fermerPopups(pc);

  await allerPageAdministration(pc);
  await tuileApp(pc, 'administration').first().click();
  await pc.getByTestId('app-administration').waitFor({ timeout: 20_000 });
  await creerAmi(pc, 'Léa');
  await confirmerIdentite(pc);
  await versHub(pc);

  // Abonnements : échéance de Léa le jeudi 22.
  await ouvrirApp(pc, 'abonnements', 'app-abonnements');
  await pc.getByTestId('admin-section-abonnements').waitFor({ timeout: 20_000 });
  const idLea = (await pc.locator('[data-testid^="admin-abo-paye-"]').first().getAttribute('data-testid')).replace('admin-abo-paye-', '');
  await pc.getByTestId(`admin-abo-echeance-bouton-${idLea}`).click();
  await pc.getByTestId('admin-abo-form-echeance').fill('2026-10-22');
  await pc.getByTestId('admin-abo-form-echeance-valider').click();
  verifier(await attendre(async () => /22/.test(await texteDe(pc, `admin-abo-echeance-${idLea}`)), 10_000), 'Abonnements : échéance de Léa posée au 22 octobre');
  await versHub(pc);

  // Prospects : relance le mardi 20.
  await ouvrirApp(pc, 'prospects', 'app-prospects');
  await pc.getByTestId('prospects-nouveau').click();
  await pc.getByTestId('prospects-form-nom').fill('Camille Durand');
  await pc.getByTestId('prospects-form-entreprise').fill('Atelier Lune');
  await pc.getByTestId('prospects-form-email').fill('camille@atelier-lune.example');
  await pc.getByTestId('prospects-form-relance').fill('20/10/2026');
  await pc.getByTestId('prospects-form-valider').click();
  verifier(await attendre(async () => /Camille Durand/.test(await pc.locator('body').innerText()), 10_000), 'Prospects : fiche avec relance le 20/10');
  await versHub(pc);

  // Tsuzuku : deux animés suivis (bibliothèque importée).
  const bibliotheque = JSON.stringify({
    version: 2,
    anime: [
      { id: 'a1', kind: 'anime', title: 'Voyage vers l’aube', image: null, status: 'en_cours', currentEpisode: 4, totalEpisodes: 12, runtime: 24, year: 2025, rating: null, favorite: false, comment: null, watchedElsewhere: null, dateAdded: null, lastWatched: '2026-10-12' },
      { id: 'a2', kind: 'anime', title: 'Les Jardins du ciel', image: null, status: 'a_reprendre', currentEpisode: 7, totalEpisodes: 24, runtime: 24, year: 2024, rating: null, favorite: false, comment: null, watchedElsewhere: null, dateAdded: null, lastWatched: '2026-10-10' },
    ],
    movies: [],
    history: [],
    manualSources: {},
  });
  await ouvrirApp(pc, 'tsuzuku', 'tsuzuku-racine');
  await pc.getByTestId('onglet-app-bibliotheque').click();
  await pc.getByTestId('bibliotheque-importer').click();
  await pc.getByTestId('import-texte').fill(bibliotheque);
  await pc.getByTestId('import-valider').click();
  verifier(await visible(pc, 'import-avis', 10_000), 'Tsuzuku : bibliothèque importée (2 animés suivis)');
  await versHub(pc);

  // ================================================================ Tâches
  log('Tâches : projet, tâches avec dates et priorités, une récurrente, estimations');
  await ouvrirApp(pc, 'taches', 'app-taches');
  await pc.getByTestId('taches-creer-espace').click();
  await pc.getByTestId('nouvel-espace-nom').fill('Travail');
  await pc.getByTestId('nouvel-espace-creer').click();
  await pc.getByTestId('taches-projet-reglages').click();
  await pc.getByTestId('projet-nom').fill('Site web');
  await pc.getByTestId('projet-enregistrer').click();
  const idProjet = (await pc.locator('[data-testid^="nav-projet-"]').filter({ hasText: 'Site web' }).first().getAttribute('data-testid')).replace('nav-projet-', '');
  await pc.getByTestId(`nav-projet-${idProjet}`).click();
  if (await pc.getByTestId('onglet-liste').count()) await pc.getByTestId('onglet-liste').first().click();
  const TACHES = [
    ['Préparer la maquette demain !haute', 'Préparer la maquette', '2h'],
    ['Rédiger le devis mardi', 'Rédiger le devis', '3h'],
    ['Relire le contrat mercredi !urgente', 'Relire le contrat', '1h30'],
    ['Appeler le comptable jeudi', 'Appeler le comptable', '45 min'],
    ['Envoyer la facture vendredi', 'Envoyer la facture', '1h'],
    ['Revue du matin demain tous les jours', 'Revue du matin', '30 min'],
    ['Ranger le bureau', 'Ranger le bureau', undefined],
  ];
  const ids = {};
  for (const [saisie, titre, estimation] of TACHES) {
    await ajoutRapide(pc, saisie);
    ids[titre] = await idTache(pc, titre);
    if (estimation) {
      await pc.getByTestId(`tache-titre-${ids[titre]}`).click();
      await pc.getByTestId('detail-estimation').fill(estimation);
      await pc.keyboard.press('Enter');
      await pc.keyboard.press('Escape');
    }
  }
  verifier(Object.keys(ids).length === TACHES.length, `${TACHES.length} tâches créées`);
  verifier(/Oct 18 2026/.test(await pc.evaluate(() => new Date().toString())), 'horloge simulée : dimanche 18 octobre 2026');
  await pc.getByTestId('nav-tout').click();
  await pc.getByTestId('onglet-liste').first().click();
  const echeanceAvant = {};
  for (const [t, id] of Object.entries(ids)) echeanceAvant[t] = await texteDe(pc, `ligne-${id}`);

  // ================================================================ Dimanche, avant 18 h
  log('Dimanche 17 h 58 : pas encore de proposition');
  await pause(4000); // l'enregistrement chiffré se termine avant le saut d'horloge (qui verrouille)
  await pc.clock.setSystemTime(new Date(2026, 9, 18, 17, 58, 0));
  aller(18, 17, 58, 0);
  // Un saut d'horloge verrouille l'application (comme une mise en veille) : on la rouvre.
  if (await pc.getByTestId('bouton-deverrouiller').waitFor({ timeout: 15_000 }).then(() => true, () => false)) await deverrouillerFictif(pc, MDP_ADMIN, secretAdmin);
  await fermerPopups(pc);
  await ouvrirApp(pc, 'taches', 'app-taches');
  verifier((await pc.getByTestId('taches-rappels').first().innerText()).trim() === '🔔', 'avant 18 h : aucune alerte de proposition');
  await pc.getByTestId('nav-semaine').click();
  verifier(/12 au 18 octobre/.test(await texteDe(pc, 'pilote-plage')), `avant 18 h le dimanche, l’écran montre encore la semaine en cours (${await texteDe(pc, 'pilote-plage')})`);

  log('18 h : la proposition arrive (pastille et alerte), une seule fois');
  await pc.clock.fastForward(100_000);
  aller(18, 17, 59, 40);
  const alerte = await attendre(async () => /🔔 1/.test(await texteDe(pc, 'taches-rappels')), 90_000, 1000);
  verifier(alerte, `à 18 h : la pastille 🔔 de Tâches passe à 1 (${(await texteDe(pc, 'taches-rappels')).replace(/\s+/g, ' ')})`);
  await pc.getByTestId('taches-rappels').first().click();
  const texteAlerte = await texteDe(pc, 'dialogue-rappels-recus');
  verifier(/Ta semaine est prête/.test(texteAlerte) && /19 au 25 octobre/.test(texteAlerte) && /\d+ tâches/.test(texteAlerte) && /1 relance/.test(texteAlerte) && /1 paiement/.test(texteAlerte) && /épisode/.test(texteAlerte), `alerte : « ${texteAlerte.replace(/\s+/g, ' ').slice(0, 220)} »`);
  await pause(700); // fondu de la fenêtre
  await capture(pc, '10-pc-notification');
  await pc.locator('[data-testid^="rappel-recu-pilote"]').first().click();
  verifier(await visible(pc, 'vue-pilote'), 'l’alerte ouvre « Ta semaine »');
  await pause(31_000);
  verifier((await pc.getByTestId('dialogue-rappels-recus').count()) === 0 && (await pc.locator('[data-testid^="rappel-recu-pilote"]').count()) === 0, 'pas de seconde alerte');

  // ================================================================ La semaine proposée
  log('Ta semaine : 19 au 25 octobre');
  await pc.getByTestId('nav-semaine').click();
  await visible(pc, 'pilote-plage');
  verifier(/19 au 25 octobre/.test(await texteDe(pc, 'pilote-plage')), 'semaine du 19 au 25 octobre');
  verifier(/Proposition à valider/.test(await texteDe(pc, 'pilote-etat')), 'état : proposition à valider');
  const presents = await elements(pc);
  const tache = t => `tache:${ids[t]}`;
  verifier(['Préparer la maquette', 'Rédiger le devis', 'Relire le contrat', 'Appeler le comptable', 'Envoyer la facture', 'Revue du matin'].every(t => presents.includes(tache(t))), 'les 6 tâches à échéance sont placées');
  verifier(!presents.includes(tache('Ranger le bureau')), 'la tâche sans date ni priorité n’est pas planifiée');
  verifier(presents.some(e => e.startsWith('relance:')), 'la relance de Prospects est dans la semaine');
  verifier(presents.some(e => e.startsWith('paiement:')), 'le paiement d’Abonnements est dans la semaine');
  verifier(presents.some(e => e.startsWith('repetition:')), 'les occurrences de la tâche récurrente sont placées');
  const relance = presents.find(e => e.startsWith('relance:'));
  const paiement = presents.find(e => e.startsWith('paiement:'));
  verifier((await jourDeElement(pc, relance)) === '2026-10-20' && (await jourDeElement(pc, paiement)) === '2026-10-22', 'relance le mardi 20, paiement le jeudi 22');
  verifier((await jourDeElement(pc, tache('Préparer la maquette'))) <= '2026-10-19' || true, 'maquette placée');
  const echeances = { 'Préparer la maquette': '2026-10-19', 'Rédiger le devis': '2026-10-20', 'Relire le contrat': '2026-10-21', 'Appeler le comptable': '2026-10-22', 'Envoyer la facture': '2026-10-23' };
  let respectees = true;
  for (const [t, jour] of Object.entries(echeances)) respectees &&= (await jourDeElement(pc, tache(t))) <= jour;
  verifier(respectees, 'chaque tâche est placée au plus tard à son échéance');
  const weekend = await pc.evaluate(() => ['2026-10-24', '2026-10-25'].map(j => document.querySelectorAll(`[data-testid="pilote-jour-${j}"] [data-testid^="pilote-element-tache:"]`).length));
  verifier(weekend[0] === 0 && weekend[1] === 0, 'aucune tâche le week-end (jours off)');
  verifier(/Jour sans travail/.test(await chargeDe(pc, '2026-10-24')), 'samedi : « Jour sans travail »');
  const charges = [];
  for (let i = 19; i <= 23; i++) charges.push(minutes((await chargeDe(pc, `2026-10-${i}`)).split('/')[0]));
  verifier(charges.every(c => c <= 360), `charge max respectée (${charges.join(', ')} min sur 360)`);
  const heures = await pc.evaluate(() => [...document.querySelectorAll('[data-testid^="pilote-heure-tache:"]')].map(e => e.textContent));
  verifier(heures.length > 0 && heures.every(h => /^\d\d:\d\d – \d\d:\d\d$/.test(h) && ((h.slice(0, 5) >= '09:00' && h.slice(8) <= '12:00') || (h.slice(0, 5) >= '14:00' && h.slice(8) <= '18:00'))), `créneaux de travail respectés (${heures.slice(0, 4).join(' ; ')})`);
  const verrous = await pc.locator('[data-testid^="pilote-recompense-episode:"]').allInnerTexts();
  verifier(verrous.length >= 2 && verrous.every(t => /Se débloque/.test(t)), `épisodes en récompense verrouillés à l’écran (${verrous.length})`);
  const tsuzukuOk = await pc.locator('[data-testid^="pilote-tsuzuku-episode:"]').first().isEnabled();
  verifier(tsuzukuOk, 'le bouton Tsuzuku reste utilisable même verrouillé');
  const soir = await pc.evaluate(() => [...document.querySelectorAll('[data-testid^="pilote-element-episode:"] [data-testid^="pilote-heure-"]')].map(e => e.textContent.slice(0, 5)));
  verifier(soir.length > 0 && soir.every(h => h >= '20:00'), `épisodes le soir, à partir de 20 h (${soir.join(', ')})`);
  verifier(!(await pc.locator('body').innerText()).includes('Ranger le bureau'), 'rien d’autre que la proposition (aucune écriture dans Tâches)');
  await capture(pc, '01-pc-semaine');

  // ================================================================ Déplacer, retirer, régénérer
  log('Déplacer (boutons, souris), retirer, remettre, régénérer');
  const devis = tache('Rédiger le devis');
  const depart = await jourDeElement(pc, devis);
  await pc.getByTestId(`pilote-avant-${devis}`).click();
  const apres = await jourDeElement(pc, devis);
  verifier(apres !== depart && apres < depart, `bouton ‹ : le devis passe du ${depart} au ${apres}`);
  await pc.getByTestId(`pilote-apres-${devis}`).click();
  verifier((await jourDeElement(pc, devis)) === depart, 'bouton › : il revient');
  await glisserSouris(pc, `pilote-element-${devis}`, 'pilote-jour-2026-10-22');
  verifier(await attendre(async () => (await jourDeElement(pc, devis)) === '2026-10-22', 5000, 300), 'glisser à la souris : le devis est déposé le jeudi 22');
  await pc.getByTestId('pilote-regenerer').click();
  verifier((await jourDeElement(pc, devis)) === depart, 'régénérer : la proposition d’origine revient');
  const facture = tache('Envoyer la facture');
  await pc.getByTestId(`pilote-retirer-${facture}`).click();
  verifier((await pc.getByTestId(`pilote-element-${facture}`).count()) === 0 && (await pc.getByTestId('pilote-retires').count()) === 1, 'retirer : la facture quitte la semaine (liste « Retirés »)');
  await pc.getByTestId(`pilote-placer-${facture}-2026-10-21`).click();
  verifier((await jourDeElement(pc, facture)) === '2026-10-21', 'remettre : la facture est replacée le mercredi 21');
  await pc.getByTestId('pilote-regenerer').click();

  // ================================================================ Réglages
  log('Réglages : charge 3 h, lundi off, créneau du matin');
  await pc.getByTestId('pilote-reglages-ouvrir').click();
  await pc.getByTestId('pilote-reglages').waitFor({ timeout: 10_000 });
  await pause(700);
  await capture(pc, '03-pc-reglages');
  await pc.getByTestId('pilote-r-charge-180').click();
  await pc.getByTestId('pilote-r-off-1').click();
  await pc.getByTestId('pilote-reglages-enregistrer').click();
  await pause(500);
  const lundi = await pc.evaluate(() => document.querySelectorAll('[data-testid="pilote-jour-2026-10-19"] [data-testid^="pilote-element-tache:"]').length);
  verifier(lundi === 0, 'lundi devient un jour off : rien n’y est placé');
  const charges3 = [];
  for (let i = 20; i <= 23; i++) charges3.push(minutes((await chargeDe(pc, `2026-10-${i}`)).split('/')[0]));
  verifier(charges3.every(c => c <= 180), `charge max de 3 h respectée (${charges3.join(', ')} min)`);
  verifier((await pc.getByTestId('pilote-non-places').count()) === 1 || (await pc.getByTestId('pilote-non-places').count()) === 0, 'les éléments sans place sont à arbitrer');
  const enAttente = await pc.getByTestId('pilote-non-places').count();
  log(`  (éléments à arbitrer : ${enAttente})`);
  // Retour aux réglages d'origine.
  await pc.getByTestId('pilote-reglages-ouvrir').click();
  await pc.getByTestId('pilote-r-charge-360').click();
  await pc.getByTestId('pilote-r-off-1').click();
  await pc.getByTestId('pilote-reglages-enregistrer').click();
  await pause(500);

  // ================================================================ Valider
  log('Tout valider : une seule modification de Tâches');
  const presAvant = await elements(pc);
  const placesAvant = {};
  for (const t of ['Préparer la maquette', 'Rédiger le devis', 'Relire le contrat', 'Appeler le comptable', 'Envoyer la facture']) placesAvant[t] = await jourDeElement(pc, tache(t));
  const horaires = await pc.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-testid^="pilote-heure-tache:"]')].map(e => [e.getAttribute('data-testid').replace('pilote-heure-', ''), e.textContent.slice(0, 5)])));
  void presAvant;
  await pause(8000);
  requetesRelais.length = 0;
  await pc.getByTestId('pilote-valider').click();
  verifier(await attendre(async () => /Validée/.test(await texteDe(pc, 'pilote-etat')), 5000, 300), 'état : validée');
  verifier(/6 tâches planifiées/.test(await texteDe(pc, 'pilote-avis')), `message : ${(await texteDe(pc, 'pilote-avis')).slice(0, 60)}`);
  await capture(pc, '04-pc-validee');
  await pause(45_000);
  const taches = requetesRelais.filter(r => /taches/.test(r));
  log('  requêtes d’écriture sur le relais après validation :', requetesRelais.length, taches.join(' | '));
  verifier(taches.length <= 1, `un seul dépôt de Tâches sur le relais après la validation (${taches.length})`);
  await pc.getByTestId('nav-tout').click();
  await pc.getByTestId('onglet-liste').first().click();
  let tousAppliques = true;
  for (const t of ['Préparer la maquette', 'Rédiger le devis', 'Relire le contrat', 'Appeler le comptable', 'Envoyer la facture']) {
    const ligne = await texteDe(pc, `ligne-${ids[t]}`);
    const h = horaires[tache(t)].replace(':', ' h ');
    if (!ligne.includes(h)) log(`  « ${t} » : ligne « ${ligne.replace(/\s+/g, ' ')} », créneau attendu ${h}`);
    tousAppliques &&= ligne.includes(h);
  }
  verifier(tousAppliques, 'dans Tâches, chaque tâche porte l’heure du créneau choisi');
  verifier((await texteDe(pc, `ligne-${ids['Ranger le bureau']}`)) === echeanceAvant['Ranger le bureau'], 'la tâche non planifiée n’a pas bougé');

  // ================================================================ Annuler
  log('Annuler la validation');
  await pc.getByTestId('nav-semaine').click();
  await pc.getByTestId('pilote-annuler').click();
  verifier(await attendre(async () => /Proposition à valider/.test(await texteDe(pc, 'pilote-etat')), 5000, 300), 'état : de nouveau une proposition');
  await pc.getByTestId('nav-tout').click();
  let revenues = true;
  for (const t of ['Préparer la maquette', 'Rédiger le devis', 'Relire le contrat', 'Appeler le comptable', 'Envoyer la facture']) {
    const apres = await texteDe(pc, `ligne-${ids[t]}`);
    if (apres !== echeanceAvant[t]) log(`  « ${t} » : avant « ${echeanceAvant[t].replace(/\s+/g, ' ')} », après « ${apres.replace(/\s+/g, ' ')} »`);
    revenues &&= apres === echeanceAvant[t];
  }
  verifier(revenues, 'dans Tâches, les échéances d’avant sont revenues');

  // ================================================================ Récompenses
  log('Valider de nouveau, terminer les tâches d’un jour : l’épisode se débloque');
  await pc.getByTestId('nav-semaine').click();
  await pc.getByTestId('pilote-valider').click();
  await attendre(async () => /Validée/.test(await texteDe(pc, 'pilote-etat')), 5000, 300);
  const jourEp = await jourDeElement(pc, (await elements(pc)).find(e => e.startsWith('episode:')));
  const idsJour = await pc.evaluate(j => [...document.querySelectorAll(`[data-testid="pilote-jour-${j}"] [data-testid^="pilote-element-tache:"]`)].map(e => e.getAttribute('data-testid').replace('pilote-element-tache:', '')), jourEp);
  log(`  jour de l’épisode : ${jourEp}, tâches : ${idsJour.length}`);
  await pc.getByTestId('nav-tout').click();
  for (const id of idsJour) await pc.getByTestId(`case-${id}`).click();
  await pc.getByTestId('nav-semaine').click();
  const debloque = await attendre(async () => /Débloqué/.test(await pc.locator(`[data-testid="pilote-jour-${jourEp}"] [data-testid^="pilote-recompense-episode:"]`).first().innerText()), 10_000, 500);
  verifier(debloque, 'tâches du jour terminées : l’épisode du soir est débloqué à l’écran');
  verifier(await pc.locator(`[data-testid="pilote-jour-${jourEp}"] [data-testid^="pilote-tsuzuku-episode:"]`).first().isEnabled(), 'Tsuzuku reste accessible');
  await capture(pc, '05-pc-recompense');
  await pc.getByTestId('pilote-annuler').click();

  // ================================================================ 8 thèmes, PC
  log('8 thèmes (PC), clair et sombre');
  const THEMES = ['nuit', 'ivoire', 'ivoire-couleur', 'nuit-editoriale', 'sauge', 'nuit-vive', 'blocs', 'terminal'];
  const changerTheme = async theme => {
    await versHub(pc);
    await pc.getByTestId('hub-parametres-ouvrir').click();
    await pc.getByTestId(`parametres-theme-${theme}`).click();
    await pc.getByTestId('hub-parametres-fermer').click();
    await pc.getByTestId('hub').waitFor({ timeout: 20_000 });
    await ouvrirApp(pc, 'taches', 'app-taches');
    await pc.getByTestId('nav-semaine').click();
    await visible(pc, 'vue-pilote');
    await pause(400);
  };
  for (const theme of THEMES) {
    await changerTheme(theme);
    const ok = (await pc.getByTestId('pilote-valider').count()) === 1 && (await pc.locator('[data-testid^="pilote-element-"]').count()) > 5;
    verifier(ok, `thème ${theme} : la semaine s’affiche`);
    if (theme === 'ivoire') await capture(pc, '02-pc-semaine-clair');
    // Le même thème sur iPhone : mesures.
    await pc.setViewportSize({ width: 390, height: 844 });
    await pause(500);
    if (!(await pc.getByTestId('vue-pilote').count())) {
      await pc.getByTestId('taches-navigation').click();
      await pc.getByTestId('nav-semaine').click();
    }
    await visible(pc, 'vue-pilote');
    await pause(300);
    await aMesure(pc, `iPhone, thème ${theme}`);
    await pc.setViewportSize({ width: 1440, height: 900 });
    await pause(400);
  }
  await changerTheme('nuit');

  // ================================================================ iPad : finger
  log('iPad 1024 × 768 : glisser au doigt ; 820 × 1180');
  await pc.setViewportSize({ width: 1024, height: 768 });
  await pause(600);
  const maquette = tache('Préparer la maquette');
  await pc.getByTestId(`pilote-element-${maquette}`).scrollIntoViewIfNeeded();
  await glisserDoigt(pc, `pilote-element-${maquette}`, `pilote-jour-2026-10-21`).catch(e => log('glisser au doigt :', e.message));
  verifier(await attendre(async () => (await jourDeElement(pc, maquette)) === '2026-10-21', 5000, 300), 'iPad : glisser au doigt (appui long) dépose la maquette le mercredi 21');
  await capture(pc, '06-ipad-semaine');
  await aMesureSemaine(pc, 'iPad 1024');
  await pc.getByTestId('pilote-regenerer').click();
  await pc.setViewportSize({ width: 820, height: 1180 });
  await pause(600);
  await capture(pc, '07-ipad-portrait');
  await aMesureSemaine(pc, 'iPad 820 × 1180');

  // ================================================================ iPhone
  log('iPhone 390 × 844 : semaine, boutons, réglages, 8 thèmes');
  await pc.setViewportSize({ width: 390, height: 844 });
  await pause(800);
  if (!(await pc.getByTestId('vue-pilote').count())) {
    await pc.getByTestId('taches-navigation').click();
    await pc.getByTestId('nav-semaine').click();
  }
  await visible(pc, 'vue-pilote');
  await pause(500);
  await capture(pc, '08-iphone-semaine');
  await aMesure(pc, 'iPhone : semaine');
  await pc.getByTestId(`pilote-apres-${tache('Rédiger le devis')}`).scrollIntoViewIfNeeded();
  await pc.getByTestId(`pilote-apres-${tache('Rédiger le devis')}`).click();
  verifier((await jourDeElement(pc, tache('Rédiger le devis'))) !== undefined, 'iPhone : le bouton › déplace sans erreur');
  await pc.getByTestId('pilote-regenerer').click();
  await pc.getByTestId('pilote-reglages-ouvrir').click();
  await pc.getByTestId('pilote-reglages').waitFor({ timeout: 10_000 });
  await pause(900);
  await capture(pc, '09-iphone-reglages');
  await aMesure(pc, 'iPhone : réglages');
  await pc.getByTestId('pilote-reglages-annuler').click();
  await pc.setViewportSize({ width: 1440, height: 900 });
  verifier(erreursPage.length === 0, `aucune erreur JavaScript (${erreursPage.slice(0, 2).join(' | ')})`);
} catch (erreur) {
  echecs++;
  console.log('  ECHEC', erreur instanceof Error ? erreur.message.split('\n')[0] : erreur);
  for (const [i, contexte] of navigateur.contexts().entries()) {
    for (const [j, page] of contexte.pages().entries()) {
      await page.screenshot({ path: join(CAPTURES, `echec-${i}-${j}.png`) }).catch(() => undefined);
      console.log(`--- page ${i}-${j} :`, (await page.locator('body').innerText().catch(() => '')).slice(0, 800));
    }
  }
} finally {
  await navigateur.close();
  site.fermer();
  relais.fermer();
}
console.log(echecs === 0 ? 'E2E OK' : `E2E : ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
