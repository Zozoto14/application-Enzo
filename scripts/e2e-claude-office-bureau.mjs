/**
 * Bureau natif de Claude Office (onglet « Bureau ») : un vrai journal d'essai est écrit par le hook
 * (scripts/office-historique-hook.mjs, dossier temporaire), servi à l'écran par un faux pont du PC ; la copie
 * chiffrée est déposée sur un faux relais local (le vrai relais/worker.mjs, KV en mémoire), puis relue par le
 * site, en fenêtre de PC (1280×800), d'iPad (820×1180) puis de téléphone (390×844). Vérifie : agents et états,
 * open space dessiné (un personnage par session, animations gelées onglet masqué), « en direct » sur le PC, âge du
 * dépôt ailleurs, secrets masqués, mode « démo » étiqueté et réversible, thèmes nuit et jour, rien d'installé sans
 * clic, aucun accès réseau hors du relais, pas de débordement, cibles ≥ 44 px et textes ≥ 15 px sur téléphone (vue
 * rapprochée défilante comprise), animations coupées si réduites. Captures (JPEG légers) relues.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-claude-office-bureau.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lireJournal } from '../bureau/electron/officeHistorique.mjs';
import { allerPageAdministration, nouveauContexte } from './e2e-acceptation.mjs';
import { chargerPlaywright, demarrerRelais, demarrerSite, deverrouiller, pause, premierLancement, racine, toucher } from './mobile-outils.mjs';

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-claude-office');
mkdirSync(CAPTURES, { recursive: true });
const MDP = 'mot-de-passe-bureau-office-très-long-42';
const PORT_SITE = 5265;
const PORT_RELAIS = 8865;
const log = (...a) => console.log('[bureau]', ...a);
let echec = false;
const verifier = (ok, quoi) => {
  if (!ok) echec = true;
  log(`${ok ? 'OK' : 'ÉCHEC'} : ${quoi}`);
};

// 1. Journal d'essai écrit par le VRAI hook (horodatage actuel) : quatre sessions dans des états différents.
const dossier = mkdtempSync(join(tmpdir(), 'e2e-bureau-'));
const hook = join(racine, 'scripts', 'office-historique-hook.mjs');
const cwd = { budget: 'C:\\Users\\moi\\AppDashboard', tsuzuku: '/home/moi/tsuzuku', hub: 'C:\\Users\\moi\\hub', relais: 'C:\\Users\\moi\\relais' };
const evenements = [
  { hook_event_name: 'UserPromptSubmit', prompt: 'Relis le worker du relais et résume les limites', session_id: 'sess-relais', cwd: cwd.relais },
  { hook_event_name: 'Stop', session_id: 'sess-relais', cwd: cwd.relais },
  { hook_event_name: 'UserPromptSubmit', prompt: 'Pourquoi la tuile du hub clignote au démarrage ?', session_id: 'sess-hub', cwd: cwd.hub },
  { hook_event_name: 'SessionStart', source: 'startup', session_id: 'sess-budget', cwd: cwd.budget },
  { hook_event_name: 'UserPromptSubmit', prompt: 'Ajoute un export CSV des dépenses du budget', session_id: 'sess-budget', cwd: cwd.budget },
  { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: 'C:\\Users\\moi\\AppDashboard\\budget\\js\\export.js' }, session_id: 'sess-budget', cwd: cwd.budget },
  { hook_event_name: 'UserPromptSubmit', prompt: 'Mon token GitHub est ghp_abcdefghijklmnopqrstuvwxyz0123456789, lance les tests', session_id: 'sess-tsu', cwd: cwd.tsuzuku },
  { hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: 'C:\\Users\\moi\\AppDashboard\\budget\\js\\export.js' }, session_id: 'sess-budget', cwd: cwd.budget },
  { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test', description: 'Lance les tests' }, tool_response: { stdout: 'ok' }, session_id: 'sess-tsu', cwd: cwd.tsuzuku },
];
for (const e of evenements) {
  const r = spawnSync(process.execPath, [hook], { input: JSON.stringify(e), env: { ...process.env, OFFICE_HISTORIQUE_DIR: dossier }, encoding: 'utf8' });
  if (r.status !== 0 || r.stdout) throw new Error('Le hook a échoué ou écrit sur la sortie standard.');
}
const { entrees } = lireJournal(dossier);
verifier(entrees.length === evenements.length, `${entrees.length} entrées écrites par le hook`);
verifier(!JSON.stringify(entrees).includes('ghp_abcdef'), 'jeton GitHub masqué dans le journal');
rmSync(dossier, { recursive: true, force: true });

const relais = await demarrerRelais(PORT_RELAIS);
const site = await demarrerSite(PORT_SITE);
const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
try {
  // PC simulé (relais version 9 : le site ne lit plus de code de liaison dans l'adresse) : le lien de test
  // `#liaison=` tient lieu du fichier relais-local.json du PC (jeton maître), voir SCRIPT_PC.
  const contexte = await nouveauContexte(navigateur, { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const page = await contexte.newPage();
  // Requêtes faites pendant l'écran Claude Office : seulement le site et le relais local.
  let surveiller = false;
  const horsPrevu = [];
  page.on('request', r => {
    if (!surveiller) return;
    const u = new URL(r.url());
    const permis = (u.hostname === 'localhost' && [String(PORT_SITE), String(PORT_RELAIS)].includes(u.port)) || u.protocol === 'data:' || u.protocol === 'blob:';
    if (!permis) horsPrevu.push(r.url());
  });
  const secret = await premierLancement(page, { site: site.url, code: relais.code, motDePasse: MDP });
  await toucher(page, 'acceptation-case').catch(() => undefined);
  await toucher(page, 'acceptation-continuer').catch(() => undefined);
  await page.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(page, MDP, secret));
  await page.getByText(/Fermer|Terminé|Compris|Plus tard/).first().click({ timeout: 3000 }).catch(() => undefined);
  // Le premier tour de synchro configure la liaison (compte principal) : la copie chiffrée devient disponible.
  const attendreSynchro = async () => {
    for (let i = 0; i < 60; i++) {
      if (/À jour/.test((await page.getByTestId('synchro-libelle').first().textContent({ timeout: 2000 }).catch(() => '')) ?? '')) return true;
      await pause(1000);
    }
    return false;
  };
  verifier(await attendreSynchro(), 'compte principal relié au relais local (synchro à jour)');
  const prendre = async (nom, pleinePage = false) => {
    await pause(1200);
    await page.mouse.move(1, 1);
    await page.screenshot({ path: join(CAPTURES, `${nom}.jpg`), fullPage: pleinePage, type: 'jpeg', quality: 78 });
    log(`${nom} : capturé`);
  };
  // Personnages dessinés dans l'open space (une session = un personnage).
  const personnages = () => page.locator('[data-testid^="scene-"] g[class^="co-m-"]').count();
  const changerTheme = async theme => {
    await page.getByTestId('retour-hub').first().click();
    await page.getByTestId('hub-parametres-ouvrir').click();
    await page.getByTestId(`parametres-theme-${theme}`).click();
    await page.getByTestId('hub-parametres-fermer').click();
  };
  /** Mesures « téléphone » : débordement, cibles, tailles de texte (hors scène décorative). */
  const mesurerTelephone = () => page.evaluate(() => {
    const zone = document.querySelector('[data-testid="bureau"]');
    const onglets = [...document.querySelectorAll('[data-testid^="claude-office-onglet-"]')];
    const visible = el => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0 && !el.closest('[aria-hidden="true"]');
    };
    const petites = [];
    for (const el of [...zone.querySelectorAll('button, [role=button], [role=switch], [role=tab], a[href], input')].concat(onglets)) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 44 || r.height < 44) petites.push(`${el.getAttribute('data-testid') ?? el.textContent.trim().slice(0, 30)} (${Math.round(r.width)}×${Math.round(r.height)})`);
    }
    const petitsTextes = [];
    const marcheur = document.createTreeWalker(zone, NodeFilter.SHOW_TEXT);
    for (let n = marcheur.nextNode(); n; n = marcheur.nextNode()) {
      const t = n.textContent.trim();
      if (!t || !n.parentElement || !visible(n.parentElement)) continue;
      const taille = Number.parseFloat(getComputedStyle(n.parentElement).fontSize);
      if (taille < 15) petitsTextes.push(`${t.slice(0, 30)} (${taille}px)`);
    }
    const deborde = [];
    for (const el of zone.querySelectorAll('*')) {
      // Rangée des projets, et contenu de la scène (zoomée, coupée par son cadre) : hors mesure.
      if (!visible(el) || el.closest('[data-testid="bureau-filtres"], [data-testid="bureau-scene-defilement"]')) continue;
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 1 || r.left < -1) deborde.push(el.getAttribute('data-testid') ?? el.tagName);
    }
    const defilement = document.querySelector('[data-testid="bureau-scene-defilement"]');
    const cadreScene = defilement?.getBoundingClientRect();
    return {
      debordementPage: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      deborde: deborde.slice(0, 5), petites, petitsTextes: petitsTextes.slice(0, 8),
      sceneDansLEcran: !cadreScene || (cadreScene.left >= -1 && cadreScene.right <= window.innerWidth + 1),
    };
  });
  const tuile = page.locator('[data-testid="cellule-claude-office"], [data-testid="tuile-claude-office"]');
  const ouvrirTuile = async () => {
    await allerPageAdministration(page);
    await tuile.first().waitFor({ timeout: 20_000 });
    await tuile.first().click();
    await page.getByTestId('bureau').waitFor({ timeout: 20_000 });
  };

  // 2. Site, avant tout dépôt : le bureau s'affiche (onglet par défaut), état vide pédagogique, aucune commande.
  surveiller = true;
  await ouvrirTuile();
  await page.getByTestId('bureau-vide-texte').waitFor();
  verifier(/Rien à installer ici/.test(await page.getByTestId('bureau-vide-texte').innerText()), 'site : état vide pédagogique (rien à installer ici)');
  verifier((await page.getByTestId('claude-office-commande-site').count()) === 0, 'site : plus de simple « commande à lancer »');
  await prendre('6-bureau-site-vide');
  await page.getByTestId('retour-hub').first().click();

  // 3. PC : faux pont qui sert le journal d'essai (canal d'activité + lecture complète pour la copie).
  await page.evaluate(journal => {
    window.__appels = { activite: 0, installer: 0, ouvrir: 0 };
    const reglages = { actif: true, enregistrerSorties: false, masquerSecrets: true, maxFichierMo: 10, maxTotalMo: 200, appareil: 'PC-BUREAU', appareilId: journal[0].appareilId };
    const lecture = { ok: true, dossier: 'C:/Users/moi/.agent-office/historique', entrees: journal, total: journal.length, ignorees: 0, octets: 4096, fichiers: 1, reglages };
    window.applibourse = {
      bureau: true,
      claudeOffice: {
        etat: async () => ({ url: 'http://127.0.0.1:3334', dossier: null, hooks: 'inconnus', historique: 'installes', serveur: { joignable: false } }),
        choisirDossier: async () => ({ ok: false }), reglerUrl: async url => ({ ok: true, url }),
        apercuHooks: async () => ({ ok: false }), installerHooks: async () => ((window.__appels.installer += 1), { ok: false, annule: true }),
        ouvrir: async () => ((window.__appels.ouvrir += 1), true),
        historique: {
          lire: async () => lecture,
          activite: async connu => ((window.__appels.activite += 1), connu === 'sig' ? { ok: true, inchange: true, signature: 'sig' } : { ok: true, signature: 'sig', entrees: journal, appareilId: reglages.appareilId, appareil: reglages.appareil }),
          reglages: async () => ({ ok: true, reglages }),
          supprimer: async () => ({ ok: false, annule: true }), importer: async () => ({ ok: false, annule: true }),
          apercuHooks: async () => ({ ok: true }), installerHooks: async () => ((window.__appels.installer += 1), { ok: false, annule: true }),
        },
      },
    };
  }, entrees);
  await ouvrirTuile();
  await page.getByTestId('bureau-postes').waitFor();
  await pause(2500);
  const etats = await page.getByTestId('bureau-etat-agent').allInnerTexts();
  verifier(JSON.stringify(etats.slice(0, 3)) === JSON.stringify(['Écrit du code', 'Utilise un outil', 'Réfléchit']) && /^Terminé .* à voir$/.test(etats[3]), `PC : quatre agents dans le bon ordre, le dernier (fin de réponse) en salle d’attente (${etats.join(', ')})`);
  verifier(/En direct/.test(await page.getByTestId('bureau-fraicheur').innerText()), 'PC : « en direct » (journal local)');
  const bulles = (await page.getByTestId('bureau-bulle').allInnerTexts()).join(' | ');
  verifier(bulles.includes('Ajoute un export CSV') && !bulles.includes('ghp_abcdef') && bulles.includes('[secret masqué]'), 'PC : bulles résumées, secret masqué');
  verifier((await page.evaluate(() => window.__appels.activite)) >= 2, 'PC : journal relu par le canal d’activité (toutes les 2 s)');
  verifier((await page.getByTestId('claude-office-serveur').count()) === 0, 'PC : vrai Claude Office replié en option avancée');
  verifier((await page.getByTestId('scene-animee').count()) === 1 && (await personnages()) === 4, `PC : open space animé, un personnage par session (${await personnages()})`);
  // Onglet masqué : animations gelées (classe co-gele), reprises au retour.
  const classeScene = () => page.locator('[data-testid="scene-animee"] svg').first().getAttribute('class');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await pause(300);
  const gelee = /co-gele/.test((await classeScene()) ?? '');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await pause(300);
  verifier(gelee && !/co-gele/.test((await classeScene()) ?? ''), 'PC : animations gelées quand l’onglet est masqué, reprises ensuite');
  await prendre('7-bureau-pc');
  await page.getByTestId('bureau-agent-sess-tsu').click();
  await page.getByTestId('bureau-detail').waitFor();
  await prendre('8-bureau-pc-detail', true);
  await page.getByTestId('bureau-detail-fermer').click();
  // Copie chiffrée activée depuis le bureau, puis dépôt immédiat (« Synchroniser maintenant » de l'Historique).
  await page.getByTestId('bureau-copie-active').click();
  await page.getByTestId('bureau-message').waitFor();
  await page.getByTestId('claude-office-onglet-historique').click();
  // L'onglet dépose tout seul dès qu'il lit le journal (copie active) ; sinon « Synchroniser maintenant ».
  await page.getByTestId('historique-synchroniser').click();
  await page.getByTestId('historique-message').waitFor({ timeout: 20_000 });
  const depot = await page.getByTestId('historique-synchro-derniere').innerText();
  verifier(!/Dernier dépôt : jamais/.test(depot), `PC : copie chiffrée déposée sur le relais local (${depot.split('\n')[0]})`);
  const appels = await page.evaluate(() => window.__appels);
  verifier(appels.installer === 0 && appels.ouvrir === 0, 'PC : rien installé ni ouvert sans clic');
  // Tuile de la page Administration : état compact des agents.
  await page.getByTestId('retour-hub').first().click();
  await allerPageAdministration(page);
  const texteTuile = await tuile.first().innerText({ timeout: 20_000 });
  verifier(/En direct sur ce PC/i.test(texteTuile) && /Au travail/i.test(texteTuile), `tuile : état compact des agents (${texteTuile.replace(/\s+/g, ' ').slice(0, 80)})`);
  await prendre('12-tuile-administration');
  surveiller = false;

  // 4. Site (plus de pont : la page est rechargée) : le bureau relit la copie chiffrée, avec son âge.
  await page.reload();
  await deverrouiller(page, MDP, secret);
  await attendreSynchro();
  surveiller = true;
  await ouvrirTuile();
  await page.getByTestId('bureau-postes').waitFor({ timeout: 30_000 });
  const fraicheur = await page.getByTestId('bureau-fraicheur').innerText();
  verifier(/Copie chiffrée · à jour (à l’instant|il y a \d+ min)/.test(fraicheur), `site : âge du dépôt affiché (${fraicheur.trim()})`);
  verifier(!/En direct/.test(await page.getByTestId('bureau').innerText()), 'site : aucun faux « en direct »');
  verifier((await page.getByTestId('bureau-etat-agent').count()) === 4, 'site : quatre agents relus de la copie');
  verifier(!(await page.getByTestId('bureau').innerText()).includes('ghp_abcdef'), 'site : secret masqué');
  verifier((await personnages()) === 4, 'site : quatre personnages dans l’open space');
  await prendre('9-bureau-site-copie');

  // 4 bis. Mode démo (nuit puis jour), clairement étiqueté et réversible ; iPad en mode jour.
  await page.getByTestId('bureau-demo').click();
  await pause(7000);
  verifier(/Démo · sessions fictives/.test(await page.getByTestId('bureau-fraicheur').innerText()) && (await page.getByTestId('scene-demo').count()) === 1, 'démo : étiquetée « Démo » (pastille et scène)');
  verifier((await personnages()) >= 3, `démo : des personnages arrivent (${await personnages()})`);
  await prendre('13-bureau-demo-nuit');
  await pause(9000);
  verifier((await page.getByTestId('bureau-etat-agent').count()) >= 5, 'démo : cinq sessions fictives au moins');
  await prendre('14-bureau-demo-nuit-suite');
  await page.getByTestId('bureau-demo').click();
  verifier(/Copie chiffrée/.test(await page.getByTestId('bureau-fraicheur').innerText()) && (await page.getByTestId('scene-demo').count()) === 0, 'démo : quittée, retour à la copie chiffrée');
  await changerTheme('ivoire');
  await ouvrirTuile();
  await page.getByTestId('bureau-postes').waitFor({ timeout: 30_000 });
  await prendre('15-bureau-pc-jour');
  await page.getByTestId('bureau-demo').click();
  await pause(12_000);
  await prendre('16-bureau-demo-jour');
  await page.setViewportSize({ width: 820, height: 1180 });
  await pause(1500);
  const mesureIpad = await mesurerTelephone();
  verifier(mesureIpad.debordementPage === 0 && mesureIpad.deborde.length === 0, `iPad : aucun débordement ${JSON.stringify(mesureIpad.deborde)}`);
  await prendre('17-bureau-ipad-demo-jour');
  await page.getByTestId('bureau-demo').click();
  await page.setViewportSize({ width: 1280, height: 800 });

  // 5. Téléphone (390×844), animations réduites : pas de débordement, cibles ≥ 44 px, textes ≥ 15 px.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await deverrouiller(page, MDP, secret);
  await attendreSynchro();
  await ouvrirTuile();
  await page.getByTestId('bureau-postes').waitFor({ timeout: 30_000 });
  await pause(1500);
  verifier((await page.getByTestId('bureau-piece-fixe').count()) === 1, 'téléphone : animations coupées (prefers-reduced-motion)');
  const mesure = await mesurerTelephone();
  verifier(mesure.debordementPage === 0 && mesure.deborde.length === 0, `téléphone : aucun débordement ${JSON.stringify(mesure.deborde)}`);
  verifier(mesure.petites.length === 0, `téléphone : cibles ≥ 44 px ${JSON.stringify(mesure.petites)}`);
  verifier(mesure.petitsTextes.length === 0, `téléphone : textes ≥ 15 px ${JSON.stringify(mesure.petitsTextes)}`);
  const echelle = Number(await page.getByTestId('bureau-plateau').getAttribute('data-zoom'));
  verifier(mesure.sceneDansLEcran && echelle >= 0.7, `téléphone : vue rapprochée lisible dans son cadre (échelle ${echelle}), qu’on fait glisser`);
  await prendre('10-bureau-telephone');
  await prendre('11-bureau-telephone-page', true);
  // Vue d'ensemble (dézoom au maximum), puis démo animée sur téléphone : mêmes contrôles.
  for (let i = 0; i < 4; i++) await page.getByTestId('scene-zoom-moins').click();
  await pause(400);
  verifier(Number(await page.getByTestId('bureau-plateau').getAttribute('data-zoom')) < echelle, 'téléphone : « − » jusqu’à la vue d’ensemble de toute la scène');
  await page.getByTestId('scene-recentrer').click();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByTestId('bureau-demo').click();
  await pause(9000);
  const mesureDemo = await mesurerTelephone();
  verifier(mesureDemo.debordementPage === 0 && mesureDemo.deborde.length === 0 && mesureDemo.petites.length === 0 && mesureDemo.petitsTextes.length === 0,
    `téléphone (démo animée) : ni débordement, ni petite cible, ni petit texte ${JSON.stringify(mesureDemo)}`);
  await prendre('18-bureau-telephone-demo');
  await page.getByTestId('bureau-demo').click();
  surveiller = false;
  verifier(horsPrevu.length === 0, `aucun accès réseau hors du site et du relais local ${JSON.stringify(horsPrevu.slice(0, 5))}`);
} finally {
  await navigateur.close();
  site.fermer();
  relais.fermer();
}
process.exit(echec ? 1 : 0);
