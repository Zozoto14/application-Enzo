/**
 * Claude Office v4 (fonctionnalités), en vrai navigateur : onglet « Suivi » (récap, alertes, équipe, notes) et
 * raccourcis clavier.
 *
 * Parcours PC (faux pont servant un journal) : une session attend une autorisation depuis 7 min → alerte, pastille
 * « Suivi · N » ; notification de Windows activée pour la règle, puis une nouvelle attente → notification envoyée ;
 * raccourcis (?, B/H/S, /, J/K, Échap, F sans effet, inactifs en saisie) ; note de session depuis le détail (visible
 * dans l'Historique, retrouvée par la recherche des notes) ; personnaliser un projet (Équipe) ; copier le récap
 * (presse-papiers, secret masqué). Puis site sur iPhone 390×844, iPad 820×1180 et PC, sombre et clair, en démo :
 * alertes déclenchées, récap, équipe (éditeur), notes ; pas de débordement, cibles ≥ 44 px, textes ≥ 15 px.
 * Captures JPEG légères dans docs/captures-claude-office/ (40…).
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-claude-office-v4-fonctions.mjs
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { allerPageAdministration, nouveauContexte } from './e2e-acceptation.mjs';
import { chargerPlaywright, demarrerRelais, demarrerSite, deverrouiller, pause, premierLancement, racine, toucher } from './mobile-outils.mjs';

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-claude-office');
mkdirSync(CAPTURES, { recursive: true });
const MDP = 'mot-de-passe-office-v4-très-long-42';
const PORT_SITE = 5277;
const PORT_RELAIS = 8877;
const log = (...a) => console.log('[v4]', ...a);
let echec = false;
const verifier = (ok, quoi) => {
  if (!ok) echec = true;
  log(`${ok ? 'OK' : 'ÉCHEC'} : ${quoi}`);
};

const relais = await demarrerRelais(PORT_RELAIS);
const site = await demarrerSite(PORT_SITE);
const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
try {
  // PC simulé (relais version 9 : le site ne lit plus de code de liaison dans l'adresse) : le lien de test
  // `#liaison=` tient lieu du fichier relais-local.json du PC (jeton maître), voir SCRIPT_PC.
  const contexte = await nouveauContexte(navigateur, { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  await contexte.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: site.url });
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', e => erreurs.push(e.message));
  const secret = await premierLancement(page, { site: site.url, code: relais.code, motDePasse: MDP });
  await toucher(page, 'acceptation-case').catch(() => undefined);
  await toucher(page, 'acceptation-continuer').catch(() => undefined);
  await page.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(page, MDP, secret));
  await page.getByText(/Fermer|Terminé|Compris|Plus tard/).first().click({ timeout: 3000 }).catch(() => undefined);
  const prendre = async nom => {
    await pause(700);
    await page.mouse.move(1, 1);
    await page.screenshot({ path: join(CAPTURES, `${nom}.jpg`), type: 'jpeg', quality: 70 });
    log(`${nom} : capturé`);
  };
  const tuile = page.locator('[data-testid="cellule-claude-office"], [data-testid="tuile-claude-office"]');
  const ouvrir = async () => {
    await allerPageAdministration(page);
    await tuile.first().waitFor({ timeout: 20_000 });
    await tuile.first().click();
    // L'onglet de l'app garde sa page (onglets du hub) : on revient explicitement sur « Bureau ».
    await page.getByTestId('claude-office-onglet-bureau').click({ timeout: 20_000 });
    await page.getByTestId('bureau').waitFor({ timeout: 20_000 });
  };
  const changerTheme = async theme => {
    await page.getByTestId('retour-hub').first().click();
    await page.getByTestId('hub-parametres-ouvrir').click();
    await page.getByTestId(`parametres-theme-${theme}`).click();
    await page.getByTestId('hub-parametres-fermer').click();
  };
  const mesurer = zones => page.evaluate(ids => {
    const visible = el => {
      const st = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0 && !el.closest('[aria-hidden="true"]');
    };
    const racines = ids.map(id => document.querySelector(`[data-testid="${id}"]`)).filter(Boolean)
      .concat([...document.querySelectorAll('[data-testid^="claude-office-onglet-"]')]);
    const petites = [];
    const petitsTextes = [];
    const deborde = [];
    const cibles = 'button, [role=button], [role=switch], [role=tab], [role=radio], a[href], input, textarea';
    for (const zone of racines) {
      for (const el of [zone, ...zone.querySelectorAll(cibles)]) {
        if (!el.matches(cibles) || !visible(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 44 || r.height < 44) petites.push(`${el.getAttribute('data-testid') ?? el.textContent.trim().slice(0, 30)} (${Math.round(r.width)}×${Math.round(r.height)})`);
      }
      const marcheur = document.createTreeWalker(zone, NodeFilter.SHOW_TEXT);
      for (let n = marcheur.nextNode(); n; n = marcheur.nextNode()) {
        const t = n.textContent.trim();
        if (!t || !n.parentElement || !visible(n.parentElement)) continue;
        const taille = Number.parseFloat(getComputedStyle(n.parentElement).fontSize);
        if (taille < 15) petitsTextes.push(`${t.slice(0, 30)} (${taille}px)`);
      }
      for (const el of zone.querySelectorAll('*')) {
        if (!visible(el) || el.closest('[data-testid="bureau-scene-defilement"], [data-testid="bureau-filtres"]')) continue;
        const r = el.getBoundingClientRect();
        if (r.right > window.innerWidth + 1 || r.left < -1) deborde.push(el.getAttribute('data-testid') ?? el.tagName);
      }
    }
    return { trouvees: racines.length, debordementPage: Math.max(0, document.documentElement.scrollWidth - window.innerWidth), deborde: [...new Set(deborde)].slice(0, 5), petites: petites.slice(0, 6), petitsTextes: petitsTextes.slice(0, 6) };
  }, zones);
  const controler = async (quoi, zones = ['suivi']) => {
    const m = await mesurer(zones);
    verifier(m.debordementPage === 0 && m.deborde.length === 0, `${quoi} : aucun débordement ${JSON.stringify(m.deborde)}`);
    verifier(m.petites.length === 0, `${quoi} : cibles ≥ 44 px ${JSON.stringify(m.petites)}`);
    verifier(m.petitsTextes.length === 0, `${quoi} : textes ≥ 15 px ${JSON.stringify(m.petitsTextes)}`);
  };
  const ongletSuivi = () => page.getByTestId('claude-office-onglet-suivi').innerText();
  const attendre = async (condition, ms = 40_000) => {
    const fin = Date.now() + ms;
    while (Date.now() < fin) {
      if (await condition().catch(() => false)) return true;
      await pause(500);
    }
    return false;
  };
  const actif = () => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName);

  // 1. PC : faux pont servant un journal ; une session attend une autorisation depuis 7 min.
  await page.evaluate(() => {
    const t = min => new Date(Date.now() - min * 60_000).toISOString();
    let n = 0;
    const ev = (session, projet, min, type, extra = {}) => ({ v: 1, id: `e2e-v4-${++n}`, ts: t(min), type, appareil: 'PC-BUREAU', appareilId: 'e2ev4pc00001', session, projet, dossier: `C:/Users/moi/${projet}`, ...extra });
    window.__fabrique = ev;
    window.__journal = [
      ev('sess-v4-budget', 'budget', 20, 'debut-session'),
      ev('sess-v4-budget', 'budget', 19, 'demande', { texte: 'Ajoute un export CSV, clé sk-ant-abcdefghijklmnopqrstuvwxyz' }),
      ev('sess-v4-budget', 'budget', 18, 'outil', { outil: 'Read', resume: 'budget/js/export.js', duree: 300 }),
      ev('sess-v4-budget', 'budget', 7, 'attente', { outil: 'Bash', resume: 'Autoriser Bash (npm publish) ?', motif: 'permission' }),
      ev('sess-v4-hub', 'hub', 4, 'demande', { texte: 'Relis le hub' }),
      ev('sess-v4-hub', 'hub', 3, 'outil', { outil: 'Grep', resume: '« hub »', duree: 200 }),
    ];
    window.__signature = 1;
    window.__notifs = [];
    const reglages = { actif: true, enregistrerSorties: false, masquerSecrets: true, maxFichierMo: 10, maxTotalMo: 200, appareil: 'PC-BUREAU', appareilId: 'e2ev4pc00001' };
    window.applibourse = {
      bureau: true,
      systeme: { notifier: async (titre, corps) => (window.__notifs.push(`${titre} | ${corps}`), true) },
      claudeOffice: {
        etat: async () => ({ url: 'http://127.0.0.1:3334', dossier: null, hooks: 'inconnus', historique: 'installes', serveur: { joignable: false } }),
        choisirDossier: async () => ({ ok: false }), reglerUrl: async url => ({ ok: true, url }),
        apercuHooks: async () => ({ ok: false }), installerHooks: async () => ({ ok: false, annule: true }), ouvrir: async () => true,
        historique: {
          lire: async () => ({ ok: true, dossier: 'C:/Users/moi/.agent-office/historique', entrees: window.__journal, total: window.__journal.length, ignorees: 0, reglages }),
          activite: async connu => (connu === `s${window.__signature}` ? { ok: true, inchange: true, signature: connu } : { ok: true, signature: `s${window.__signature}`, entrees: window.__journal, appareilId: reglages.appareilId, appareil: 'PC-BUREAU' }),
          reglages: async () => ({ ok: true, reglages }), supprimer: async () => ({ ok: false, annule: true }), importer: async () => ({ ok: false, annule: true }),
          apercuHooks: async () => ({ ok: true }), installerHooks: async () => ({ ok: true, ecrit: false }),
        },
      },
    };
  });
  await ouvrir();
  verifier(await attendre(async () => /Suivi · [1-9]/.test(await ongletSuivi()), 30_000), `PC : alerte « attend ta réponse depuis 7 min » → pastille de l’onglet (${await ongletSuivi()})`);
  await page.getByTestId('claude-office-onglet-suivi').click();
  await page.getByTestId('suivi-section-alertes').click();
  await page.getByTestId('alertes-journal').waitFor();
  const journal = await page.getByTestId('alertes-journal').innerText();
  verifier(/budget attend ta réponse depuis 7 min/.test(journal) && /npm publish/.test(journal), 'journal des alertes : « budget attend ta réponse depuis 7 min »');
  verifier(!/Suivi ·/.test(await ongletSuivi()), 'journal ouvert : alertes lues, plus de pastille');
  // Notification de Windows : activée pour la règle, puis une nouvelle attente (autre session) la déclenche.
  await page.getByTestId('alertes-regler-attente').click();
  await page.getByTestId('alertes-notifier-attente').click();
  await page.getByTestId('alertes-seuil-attente-1').click();
  await prendre('40-alertes-pc');
  await page.evaluate(() => {
    window.__journal = [...window.__journal, window.__fabrique('sess-v4-hub', 'hub', 2, 'attente', { outil: 'Edit', resume: 'Autoriser Edit (hub.ts) ?', motif: 'permission' })];
    window.__signature += 1;
  });
  verifier(await attendre(async () => (await page.evaluate(() => window.__notifs)).some(x => /hub attend ta réponse/.test(x)), 45_000), 'PC : notification de Windows envoyée pour la nouvelle attente (règle réglée)');
  verifier((await page.evaluate(() => window.__notifs)).filter(x => /hub attend ta réponse/.test(x)).length === 1, 'anti-répétition : une seule notification pour cette attente');

  // 2. Raccourcis clavier (PC).
  await page.mouse.click(5, 300);
  await page.keyboard.press('h');
  verifier(await attendre(async () => (await page.getByTestId('historique').count()) === 1, 5000), 'H : onglet Historique');
  await page.keyboard.press('s');
  verifier(await attendre(async () => (await page.getByTestId('stats').count()) === 1, 5000), 'S : onglet Statistiques');
  await page.keyboard.press('b');
  verifier(await attendre(async () => (await page.getByTestId('bureau-visuel').count()) === 1, 5000), 'B : onglet Bureau');
  await page.keyboard.press('?');
  verifier(await attendre(async () => page.getByTestId('raccourcis-aide').isVisible(), 5000), '? : aide des raccourcis');
  await controler('PC, aide des raccourcis', ['raccourcis-aide']);
  await prendre('41-raccourcis-pc');
  await page.keyboard.press('Escape');
  verifier(await attendre(async () => (await page.getByTestId('raccourcis-aide').count()) === 0, 5000) && (await page.getByTestId('bureau').count()) === 1, 'Échap : l’aide se ferme, on reste dans Claude Office');
  await page.keyboard.press('/');
  verifier(await attendre(async () => (await actif()) === 'bureau-recherche', 3000), '/ : focus dans la recherche');
  await page.keyboard.type('bhs');
  verifier((await page.getByTestId('bureau-recherche').inputValue()) === 'bhs' && (await page.getByTestId('bureau-visuel').count()) === 1, 'saisie : B, H, S tapés dans le champ, aucun raccourci déclenché');
  await page.getByTestId('bureau-recherche').fill('');
  await page.getByTestId('bureau-options').click();
  // Vue Liste : J / K ouvrent le détail (dans la scène, ils font suivre l'agent : e2e-claude-office-v4-scene).
  await page.getByTestId('bureau-vue-liste').click();
  await page.mouse.click(5, 300);
  await page.keyboard.press('j');
  verifier(await attendre(async () => page.getByTestId('bureau-detail').isVisible(), 5000), 'J : détail du premier agent');
  const premier = await page.getByTestId('bureau-detail').innerText();
  await page.keyboard.press('j');
  await pause(500);
  const second = await page.getByTestId('bureau-detail').innerText();
  verifier(premier.split('\n')[0] !== second.split('\n')[0], 'J : agent suivant');
  await page.keyboard.press('k');
  await pause(500);
  verifier((await page.getByTestId('bureau-detail').innerText()).split('\n')[0] === premier.split('\n')[0], 'K : agent précédent');
  await page.keyboard.press('f');
  verifier((await page.getByTestId('bureau-detail').count()) === 1 && erreurs.length === 0, 'F en vue Liste : pas de scène, rien ne se passe (aucune erreur)');

  // 3. Note de session depuis le détail ; visible dans l'Historique ; recherche des notes.
  const idNote = await page.locator('[data-testid^="note-modifier-"]').first().getAttribute('data-testid');
  const sessionNote = idNote.replace('note-modifier-', '');
  await page.getByTestId(idNote).click();
  await page.getByTestId(`note-champ-${sessionNote}`).fill('À vérifier : export CSV');
  await page.getByTestId(`note-enregistrer-${sessionNote}`).click();
  verifier(/À vérifier : export CSV/.test(await page.getByTestId(`note-texte-${sessionNote}`).innerText()), 'note ajoutée dans le détail');
  await controler('PC, détail avec note', ['bureau-detail']);
  await prendre('42-detail-note-pc');
  await page.keyboard.press('Escape');
  verifier(await attendre(async () => (await page.getByTestId('bureau-detail').count()) === 0, 5000) && (await page.getByTestId('bureau').count()) === 1, 'Échap : le détail se ferme, on reste dans Claude Office');
  await page.getByTestId('bureau-vue-scene').click();
  await page.getByTestId('claude-office-onglet-historique').click();
  verifier(await attendre(async () => /À vérifier : export CSV/.test(await page.getByTestId(`note-texte-${sessionNote}`).first().innerText()), 10_000), 'note visible dans l’Historique');
  await page.getByTestId('claude-office-onglet-suivi').click();
  await page.getByTestId('suivi-section-notes').click();
  await page.getByTestId('suivi-notes-recherche').fill('a verifier');
  verifier((await page.locator('[data-testid^="notes-ligne-"]').count()) === 1, 'recherche dans les notes (sans accents)');

  // 4. Équipe : personnaliser le projet budget.
  await page.getByTestId('suivi-section-equipe').click();
  await page.getByTestId('equipe-modifier-budget').click();
  await page.getByTestId('equipe-surnom').fill('Félix');
  await page.getByTestId('equipe-couleur-E94F9B').click();
  await page.getByTestId('equipe-accessoire-couronne').click();
  await controler('PC, éditeur d’équipe', ['equipe-editeur']);
  await page.getByTestId('equipe-enregistrer').click();
  await page.getByTestId('equipe-favori-budget').click();
  verifier(/Félix/.test(await page.getByTestId('equipe-projet-budget').innerText()), 'équipe : surnom enregistré');
  await prendre('43-equipe-pc');

  // 5. Récap : copier (presse-papiers), secret masqué.
  await page.getByTestId('suivi-section-recap').click();
  await page.getByTestId('recap-copier-texte').click();
  await page.getByTestId('recap-message').waitFor();
  const copie = await page.evaluate(() => navigator.clipboard.readText());
  verifier(/^Récap du /.test(copie) && /budget/.test(copie) && !/sk-ant-abcdef/.test(copie), `récap copié (texte), secret masqué : « ${copie.split('\n')[1]} »`);
  await page.getByTestId('recap-copier-markdown').click();
  verifier(/^## Récap du /.test(await page.evaluate(() => navigator.clipboard.readText())), 'récap copié en Markdown');
  await controler('PC, récap');
  await prendre('44-recap-pc');

  // 6. Site (rechargé, plus de pont) : démo sur iPhone, iPad, PC ; sombre puis clair.
  await page.reload();
  await deverrouiller(page, MDP, secret);
  await ouvrir();
  await page.getByTestId('bureau-demo').click();
  verifier(await attendre(async () => /Suivi · 4/.test(await ongletSuivi()), 20_000), `démo : quatre alertes déclenchées (${await ongletSuivi()})`);
  await page.getByTestId('claude-office-onglet-suivi').click();
  for (const [section, zones] of [['alertes', ['suivi']], ['recap', ['suivi']], ['equipe', ['suivi']], ['notes', ['suivi']]]) {
    await page.getByTestId(`suivi-section-${section}`).click();
    for (const [l, h, nom] of [[390, 844, 'iPhone'], [820, 1180, 'iPad'], [1280, 800, 'PC']]) {
      await page.setViewportSize({ width: l, height: h });
      await pause(400);
      await controler(`${nom}, ${section} (démo, sombre)`, zones);
      if (nom === 'iPhone') await prendre(`45-${section}-iphone-sombre`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('suivi-section-alertes').click();
  for (const r of ['attente', 'erreurs', 'fini', 'session-longue']) verifier((await page.getByTestId(`alerte-${r}`).count()) >= 1, `démo : alerte « ${r} » au journal`);
  await page.getByTestId('suivi-section-equipe').click();
  await page.getByTestId('equipe-modifier-boutique').click();
  await page.getByTestId('equipe-editeur').waitFor();
  await controler('iPhone, éditeur d’équipe (démo)', ['equipe-editeur']);
  await prendre('46-equipe-editeur-iphone');
  await page.getByTestId('equipe-editeur-fermer').click();

  await page.setViewportSize({ width: 1280, height: 800 });
  await changerTheme('ivoire');
  await ouvrir();
  await page.getByTestId('bureau-demo').click();
  await page.getByTestId('claude-office-onglet-suivi').click();
  for (const section of ['recap', 'alertes', 'equipe', 'notes']) {
    await page.getByTestId(`suivi-section-${section}`).click();
    for (const [l, h, nom] of [[390, 844, 'iPhone'], [820, 1180, 'iPad']]) {
      await page.setViewportSize({ width: l, height: h });
      await pause(400);
      await controler(`${nom}, ${section} (démo, clair)`);
      if (nom === 'iPad' && (section === 'recap' || section === 'equipe')) await prendre(`47-${section}-ipad-clair`);
    }
  }
  verifier(erreurs.length === 0, `aucune erreur JavaScript ${JSON.stringify(erreurs.slice(0, 3))}`);
} finally {
  await navigateur.close();
  site.fermer();
  relais.fermer();
}
process.exit(echec ? 1 : 0);
