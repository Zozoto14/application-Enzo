/**
 * Claude Office v3 (zones, salle d'attente, « attend ta réponse », mise en route, détail, statistiques), en vrai
 * navigateur. Le journal est écrit par le VRAI hook (scripts/office-historique-hook.mjs, dossier temporaire) au fil du
 * test, puis servi par un faux pont du PC ; le site relit la copie chiffrée d'un faux relais local (le vrai
 * relais/worker.mjs, KV en mémoire).
 *
 * Parcours : mise en route (site : aucune copie, commande à copier ; PC : hook à mettre à jour → installé) ; un agent
 * passe de la Bibliothèque à l'Atelier puis à la Salle d'attente ; un autre lève la main au guichet ; détail (récap,
 * chronologie avec durée), « Marquer comme vu » (il quitte la salle), « Voir dans l'Historique » (filtré sur la
 * session), Statistiques ; bascule Scène / Liste mémorisée. Mesures sur iPhone 390×844, iPad 820×1180 et 1024×768, PC
 * 1280×800, clair et sombre : pas de débordement, cibles ≥ 44 px, textes ≥ 15 px hors scène ; animations réduites.
 * Captures JPEG légères dans docs/captures-claude-office/.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-claude-office-v3.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lireJournal } from '../bureau/electron/officeHistorique.mjs';
import { allerPageAdministration } from './e2e-acceptation.mjs';
import { chargerPlaywright, demarrerRelais, demarrerSite, deverrouiller, pause, premierLancement, racine, toucher } from './mobile-outils.mjs';

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-claude-office');
mkdirSync(CAPTURES, { recursive: true });
const MDP = 'mot-de-passe-office-v3-très-long-42';
const PORT_SITE = 5267;
const PORT_RELAIS = 8867;
const log = (...a) => console.log('[v3]', ...a);
let echec = false;
const verifier = (ok, quoi) => {
  if (!ok) echec = true;
  log(`${ok ? 'OK' : 'ÉCHEC'} : ${quoi}`);
};

// Journal écrit par le vrai hook, étape par étape.
const dossier = mkdtempSync(join(tmpdir(), 'e2e-office-v3-'));
const hook = join(racine, 'scripts', 'office-historique-hook.mjs');
const cwd = { budget: 'C:\\Users\\moi\\AppDashboard', hub: 'C:\\Users\\moi\\hub' };
const ecrire = evenements => {
  for (const e of evenements) {
    const r = spawnSync(process.execPath, [hook], { input: JSON.stringify(e), env: { ...process.env, OFFICE_HISTORIQUE_DIR: dossier }, encoding: 'utf8' });
    if (r.status !== 0 || r.stdout) throw new Error('Le hook a échoué ou écrit sur la sortie standard.');
  }
  return lireJournal(dossier).entrees;
};
const s = { session_id: 'sess-v3-budget', cwd: cwd.budget };
const outil = (nom, entree, id) => [
  { ...s, hook_event_name: 'PreToolUse', tool_name: nom, tool_input: entree, tool_use_id: id },
  { ...s, hook_event_name: 'PostToolUse', tool_name: nom, tool_input: entree, tool_use_id: id, tool_response: {} },
];
const etape1 = ecrire([
  { ...s, hook_event_name: 'SessionStart', source: 'startup' },
  { ...s, hook_event_name: 'UserPromptSubmit', prompt: 'Ajoute un export CSV des dépenses, clé sk-ant-abcdefghijklmnopqrstuvwxyz' },
  ...outil('Read', { file_path: 'C:\\Users\\moi\\AppDashboard\\budget\\js\\export.js' }, 'toolu_1'),
  ...outil('Grep', { pattern: 'exporter', path: 'budget' }, 'toolu_2'),
  { session_id: 'sess-v3-hub', cwd: cwd.hub, hook_event_name: 'UserPromptSubmit', prompt: 'Pousse la branche du hub' },
  { session_id: 'sess-v3-hub', cwd: cwd.hub, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'git push' } },
]);
verifier(etape1.some(e => e.type === 'attente' && e.motif === 'permission'), 'hook : « attend ta réponse » noté (PermissionRequest)');
verifier(etape1.filter(e => e.type === 'outil').every(e => typeof e.duree === 'number'), 'hook : durée des outils notée (PreToolUse → PostToolUse)');
verifier(!JSON.stringify(etape1).includes('sk-ant-abcdef'), 'hook : secret masqué');

const relais = await demarrerRelais(PORT_RELAIS);
const site = await demarrerSite(PORT_SITE);
const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
try {
  const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', e => erreurs.push(e.message));
  const secret = await premierLancement(page, { site: site.url, code: relais.code, motDePasse: MDP });
  await toucher(page, 'acceptation-case').catch(() => undefined);
  await toucher(page, 'acceptation-continuer').catch(() => undefined);
  await page.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(page, MDP, secret));
  await page.getByText(/Fermer|Terminé|Compris|Plus tard/).first().click({ timeout: 3000 }).catch(() => undefined);
  const attendreSynchro = async () => {
    for (let i = 0; i < 60; i++) {
      if (/À jour/.test((await page.getByTestId('synchro-libelle').first().textContent({ timeout: 2000 }).catch(() => '')) ?? '')) return true;
      await pause(1000);
    }
    return false;
  };
  verifier(await attendreSynchro(), 'compte principal relié au relais local');
  const prendre = async nom => {
    await pause(900);
    await page.mouse.move(1, 1);
    await page.screenshot({ path: join(CAPTURES, `${nom}.jpg`), type: 'jpeg', quality: 72 });
    log(`${nom} : capturé`);
  };
  const tuile = page.locator('[data-testid="cellule-claude-office"], [data-testid="tuile-claude-office"]');
  const ouvrir = async () => {
    await allerPageAdministration(page);
    await tuile.first().waitFor({ timeout: 20_000 });
    await tuile.first().click();
    await page.getByTestId('bureau').waitFor({ timeout: 20_000 });
  };
  const changerTheme = async theme => {
    await page.getByTestId('retour-hub').first().click();
    await page.getByTestId('hub-parametres-ouvrir').click();
    await page.getByTestId(`parametres-theme-${theme}`).click();
    await page.getByTestId('hub-parametres-fermer').click();
  };
  /** Débordement, cibles ≥ 44 px et textes ≥ 15 px dans les zones de Claude Office (hors scène décorative). */
  const mesurer = (zones = ['bureau', 'historique', 'stats', 'bureau-detail']) => page.evaluate(ids => {
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
    for (const zone of racines) {
      for (const el of [zone, ...zone.querySelectorAll('button, [role=button], [role=switch], [role=tab], [role=radio], a[href], input')]) {
        if (!el.matches('button, [role=button], [role=switch], [role=tab], [role=radio], a[href], input') || !visible(el)) continue;
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
    return { debordementPage: Math.max(0, document.documentElement.scrollWidth - window.innerWidth), deborde: [...new Set(deborde)].slice(0, 5), petites: petites.slice(0, 6), petitsTextes: petitsTextes.slice(0, 6) };
  }, zones);
  const controler = async (quoi, zones) => {
    const m = await mesurer(zones);
    verifier(m.debordementPage === 0 && m.deborde.length === 0, `${quoi} : aucun débordement ${JSON.stringify(m.deborde)}`);
    verifier(m.petites.length === 0, `${quoi} : cibles ≥ 44 px ${JSON.stringify(m.petites)}`);
    verifier(m.petitsTextes.length === 0, `${quoi} : textes ≥ 15 px ${JSON.stringify(m.petitsTextes)}`);
  };
  const perso = cle => page.locator(`[data-testid^="scene-"] g[data-cle="${cle}"]`).first();
  const zoneDe = async cle => (await perso(cle).count()) ? perso(cle).getAttribute('data-zone') : undefined;
  const attendreZone = async (cle, zone, ms = 45_000) => {
    // La scène ne s'anime que visible à l'écran : on la garde en vue.
    await page.locator('[data-testid="bureau-piece-animee"], [data-testid="bureau-piece-fixe"]').first().scrollIntoViewIfNeeded().catch(() => undefined);
    const fin = Date.now() + ms;
    while (Date.now() < fin) {
      if ((await zoneDe(cle)) === zone && (await perso(cle).getAttribute('data-mode')) !== 'marche') return true;
      if (process.env.DEBUG) log('…', cle, await zoneDe(cle), await perso(cle).getAttribute('data-mode').catch(() => '?'));
      await pause(500);
    }
    return false;
  };

  // 1. Site sans aucune copie : la mise en route dit quoi faire, avec la commande à copier.
  await ouvrir();
  await page.getByTestId('mise-en-route').waitFor({ timeout: 20_000 });
  verifier(await page.getByTestId('mise-en-route-copie-niveau-erreur').isVisible(), 'site : « Aucune copie reçue du PC » en rouge');
  verifier(/npm run office:hooks/.test(await page.getByTestId('mise-en-route-commande-copie').innerText()), 'site : commande à copier (npm run office:hooks)');
  await page.setViewportSize({ width: 390, height: 844 });
  await pause(800);
  await controler('iPhone, site sans copie');
  await prendre('20-mise-en-route-telephone');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByTestId('retour-hub').first().click();

  // 2. PC (faux pont servant le journal du vrai hook) ; hook « à mettre à jour », puis installé d'un geste.
  await page.evaluate(journal => {
    window.__journal = journal;
    window.__signature = 1;
    window.__hook = 'incomplet';
    window.__appels = { installer: 0 };
    window.__notifs = [];
    const reglages = { actif: true, enregistrerSorties: false, masquerSecrets: true, maxFichierMo: 10, maxTotalMo: 200, appareil: 'PC-BUREAU', appareilId: journal[0].appareilId };
    window.applibourse = {
      bureau: true,
      systeme: { notifier: async (t, c) => (window.__notifs.push(`${t} | ${c}`), true) },
      claudeOffice: {
        etat: async () => ({ url: 'http://127.0.0.1:3334', dossier: null, hooks: 'inconnus', historique: window.__hook, serveur: { joignable: false } }),
        choisirDossier: async () => ({ ok: false }), reglerUrl: async url => ({ ok: true, url }),
        apercuHooks: async () => ({ ok: false }), installerHooks: async () => ({ ok: false, annule: true }), ouvrir: async () => true,
        historique: {
          lire: async () => ({ ok: true, dossier: 'C:/Users/moi/.agent-office/historique', entrees: window.__journal, total: window.__journal.length, ignorees: 0, reglages }),
          activite: async connu => (connu === `s${window.__signature}` ? { ok: true, inchange: true, signature: connu } : { ok: true, signature: `s${window.__signature}`, entrees: window.__journal, appareilId: reglages.appareilId, appareil: 'PC-BUREAU' }),
          reglages: async () => ({ ok: true, reglages }), supprimer: async () => ({ ok: false, annule: true }), importer: async () => ({ ok: false, annule: true }),
          apercuHooks: async () => ({ ok: true }),
          installerHooks: async () => ((window.__appels.installer += 1), (window.__hook = 'installes'), { ok: true, ecrit: true, sauvegarde: 'settings.json.bak' }),
        },
      },
    };
  }, etape1);
  const servir = journal => page.evaluate(j => { window.__journal = j; window.__signature += 1; }, journal);
  await ouvrir();
  await page.getByTestId('mise-en-route-hook-niveau-attention').waitFor({ timeout: 20_000 });
  verifier(true, 'PC : hook « à mettre à jour » signalé');
  verifier((await page.evaluate(() => window.__appels.installer)) === 0, 'PC : rien installé sans clic');
  await page.getByTestId('mise-en-route-action-hook').click();
  await page.getByTestId('mise-en-route-hook-niveau-ok').waitFor({ timeout: 10_000 }).catch(() => undefined);
  verifier((await page.getByTestId('mise-en-route-hook-niveau-ok').count()) === 1 && (await page.evaluate(() => window.__appels.installer)) === 1, 'PC : hook mis à jour en un geste, ligne verte');
  // Notification système : désactivée par défaut, activable.
  await page.getByTestId('bureau-notifier-attente').click();

  // 3. Un agent à la Bibliothèque (lectures), un autre lève la main au guichet.
  const cleBudget = `${etape1[0].appareilId}|sess-v3-budget`;
  const cleHub = `${etape1[0].appareilId}|sess-v3-hub`;
  verifier(await attendreZone(cleBudget, 'bibliotheque', 20_000), 'lectures (Read, Grep) : l’agent est à la Bibliothèque');
  verifier(await attendreZone(cleHub, 'guichet', 20_000), 'autorisation demandée : l’agent est au guichet « Attend ta réponse »');
  verifier((await page.locator('[data-testid="scene-attend"]').count()) >= 1 && /attend ta réponse/.test(await page.getByTestId('bureau-pastille-attend').innerText()), 'main levée : pastille « ! » et « 1 attend ta réponse »');
  verifier((await page.evaluate(() => window.__notifs)).some(n => /Claude attend ta réponse \| hub/.test(n)), 'PC : notification système envoyée (réglage activé)');

  // 4. Il écrit : après le séjour minimal, il passe à l'Atelier code.
  const t0 = Date.now();
  await servir(ecrire([...outil('Edit', { file_path: 'C:\\Users\\moi\\AppDashboard\\budget\\js\\export.js' }, 'toolu_3'), ...outil('Write', { file_path: 'C:\\Users\\moi\\AppDashboard\\budget\\js\\csv.js' }, 'toolu_4')]));
  verifier(await attendreZone(cleBudget, 'atelier', 40_000), `écriture (Edit, Write) : l’agent marche jusqu’à l’Atelier code (${Math.round((Date.now() - t0) / 1000)} s, hystérésis comprise)`);

  // 5. Fin de la tâche : salle d'attente, pastille « à voir », détail (récap, chronologie avec durée), « vu ».
  await servir(ecrire([{ ...s, hook_event_name: 'Stop' }]));
  verifier(await attendreZone(cleBudget, 'salle', 30_000), 'fin de réponse : l’agent va en Salle d’attente');
  verifier(/1 terminé à voir/.test(await page.getByTestId('bureau-pastille-a-voir').innerText()), 'pastille « 1 terminé à voir »');
  verifier(/Salle d’attente · 1/.test(await page.getByTestId('scene-zone-salle').textContent()), 'enseigne de la salle d’attente : 1 présent');
  await prendre('22-salle-attente-pc');
  await page.getByTestId('bureau-pastille-a-voir').click();
  await page.getByTestId('bureau-detail').waitFor();
  const recap = await page.getByTestId('bureau-detail-recap').innerText();
  verifier(/Ajoute un export CSV/.test(recap) && /csv\.js/.test(recap) && !/sk-ant-abcdef/.test(recap), 'détail : ce qu’il a fini (demande, fichiers), secret masqué');
  const chrono = await page.getByTestId('bureau-detail-chronologie').innerText();
  verifier(/Read/.test(chrono) && /Edit/.test(chrono) && /Réponse terminée/.test(chrono) && /\d+ ms|\d+ s/.test(chrono), 'détail : chronologie (outils avec durée, fin de réponse)');
  await prendre('23-detail-pc');
  await page.getByTestId('bureau-detail-vu').click();
  await pause(1500);
  verifier((await page.getByTestId('bureau-pastille-a-voir').count()) === 0, '« Marquer comme vu » : plus rien à voir');
  const quitte = Date.now() + 20_000;
  while (Date.now() < quitte && (await zoneDe(cleBudget)) === 'salle') await pause(500);
  verifier((await zoneDe(cleBudget)) !== 'salle', `« vu » : il quitte la salle d’attente (${await zoneDe(cleBudget)})`);

  // 6. Détail → « Voir dans l'Historique » : filtré sur la session ; puis Statistiques.
  await page.getByTestId('bureau-agent-sess-v3-budg').click();
  await page.getByTestId('bureau-detail-historique').click();
  await page.getByTestId('historique-filtre-session').waitFor();
  verifier((await page.getByTestId('historique-compte-sessions').innerText()).trim() === '1', 'historique filtré sur la session');
  await page.getByTestId('claude-office-onglet-stats').click();
  await page.getByTestId('stats-kpi-demandes').waitFor();
  verifier(Number(await page.getByTestId('stats-kpi-demandes').innerText()) === 2, 'statistiques : demandes comptées depuis le journal');
  verifier(/Read|Edit/.test(await page.getByTestId('stats-outils-liste').innerText()), 'statistiques : outils les plus utilisés');
  await prendre('25-stats-pc');
  await page.getByTestId('claude-office-onglet-bureau').click();
  // Copie chiffrée activée d'un geste depuis la mise en route, puis déposée (« Synchroniser maintenant »).
  await page.getByTestId('bureau-copie-active').click();
  await page.getByTestId('claude-office-onglet-historique').click();
  await page.getByTestId('historique-synchroniser').click();
  await page.getByTestId('historique-message').waitFor({ timeout: 20_000 });

  // 7. Site (rechargé, plus de pont) : copie reçue, appareil d'origine ; démo ; tailles sur iPad, iPhone, PC.
  await page.reload();
  await deverrouiller(page, MDP, secret);
  await attendreSynchro();
  await ouvrir();
  await page.getByTestId('bureau-postes').waitFor({ timeout: 30_000 });
  const miseEnRoute = await page.locator('[data-testid="mise-en-route"], [data-testid="mise-en-route-reduite"]').first().innerText();
  verifier(/tout est prêt|Copie chiffrée reçue/.test(miseEnRoute), `site : mise en route à jour (${miseEnRoute.replace(/\s+/g, ' ').slice(0, 60)})`);
  // Scène / Liste : mémorisée sur l'appareil.
  await page.getByTestId('bureau-vue-liste').click();
  await page.getByTestId('bureau-liste').waitFor();
  await page.getByTestId('retour-hub').first().click();
  await ouvrir();
  verifier((await page.getByTestId('bureau-liste').count()) === 1, 'vue Liste mémorisée');
  await page.getByTestId('bureau-demo').click();
  await pause(4000);
  verifier((await page.getByTestId('bureau-groupe-salle').count()) === 1 && (await page.getByTestId('bureau-groupe-guichet').count()) === 1, 'démo (Liste) : « Terminés récemment » et « Attend ta réponse »');
  for (const [l, h, nom] of [[390, 844, 'iPhone'], [820, 1180, 'iPad portrait'], [1024, 768, 'iPad paysage'], [1280, 800, 'PC']]) {
    await page.setViewportSize({ width: l, height: h });
    await pause(700);
    await controler(`${nom}, démo en liste (sombre)`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('bureau-vue-scene').click();
  await pause(9000);
  await controler('iPhone, démo en scène (sombre)');
  await prendre('27-scene-telephone-sombre');
  await page.getByTestId('bureau-pastille-a-voir').click();
  await page.getByTestId('bureau-detail').waitFor();
  await controler('iPhone, détail', ['bureau-detail']);
  await prendre('28-detail-telephone');
  await page.getByTestId('bureau-detail-fermer').click();
  await page.getByTestId('claude-office-onglet-stats').click();
  await page.getByTestId('stats-demo').waitFor();
  await controler('iPhone, statistiques (démo)');
  await page.getByTestId('claude-office-onglet-historique').click();
  await page.getByTestId('historique-demo').waitFor();
  await controler('iPhone, historique (démo)');
  await page.getByTestId('claude-office-onglet-bureau').click();
  await page.getByTestId('bureau-aide-ouvrir').click();
  await page.getByTestId('bureau-aide').waitFor();
  await controler('iPhone, aide', ['bureau-aide']);
  await page.getByTestId('bureau-aide-fermer').click();

  // Thème clair : iPad et PC ; animations réduites.
  await page.setViewportSize({ width: 1280, height: 800 });
  await changerTheme('ivoire');
  await ouvrir();
  await page.getByTestId('bureau-demo').click();
  await pause(10_000);
  for (const [l, h, nom] of [[820, 1180, 'iPad portrait'], [1024, 768, 'iPad paysage'], [1280, 800, 'PC'], [390, 844, 'iPhone']]) {
    await page.setViewportSize({ width: l, height: h });
    await pause(1200);
    await controler(`${nom}, démo en scène (clair)`);
    if (nom === 'iPad portrait') await prendre('30-scene-ipad-portrait-clair');
  }
  await page.getByTestId('claude-office-onglet-stats').click();
  await page.setViewportSize({ width: 820, height: 1180 });
  await pause(800);
  await controler('iPad, statistiques (clair)');
  await prendre('31-stats-ipad-clair');
  await page.getByTestId('claude-office-onglet-bureau').click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await pause(1500);
  verifier((await page.getByTestId('bureau-piece-fixe').count()) === 1, 'animations réduites : scène fixe (fondu au changement de zone)');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  verifier(erreurs.length === 0, `aucune erreur JavaScript ${JSON.stringify(erreurs.slice(0, 3))}`);
} finally {
  await navigateur.close();
  site.fermer();
  relais.fermer();
  rmSync(dossier, { recursive: true, force: true });
}
process.exit(echec ? 1 : 0);
