/**
 * Claude Office v4 (scène) en vrai navigateur, mode démo : scène plein cadre, détails au survol (souris réelle),
 * au toucher (aperçu puis détail), zoom (boutons, molette, double-clic sur une zone), panoramique, suivi caméra,
 * mini-carte, relecture de la journée, plein écran (immersif) et écran d'ambiance, Échap ; bandeau « Mise en
 * route » réductible et mémorisé. Mesures sur PC 1440×900, iPad 1024×768 et 820×1180, iPhone 390×844, sombre et
 * clair : pas de débordement, cibles ≥ 44 px, textes ≥ 15 px hors scène ; animations réduites. Captures JPEG
 * légères (v4-*) dans docs/captures-claude-office/.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-claude-office-v4-scene.mjs
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { allerPageAdministration } from './e2e-acceptation.mjs';
import { chargerPlaywright, demarrerRelais, demarrerSite, deverrouiller, pause, premierLancement, racine, toucher } from './mobile-outils.mjs';

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-claude-office');
mkdirSync(CAPTURES, { recursive: true });
const MDP = 'mot-de-passe-office-v4-scene-très-long-42';
const PORT_SITE = 5281;
const PORT_RELAIS = 8881;
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
  // Écran tactile ET souris : la même page sert au survol (souris réelle) et aux touchers (iPad, iPhone).
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, hasTouch: true, ignoreHTTPSErrors: true });
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', e => erreurs.push(e.message));
  const secret = await premierLancement(page, { site: site.url, code: relais.code, motDePasse: MDP });
  await toucher(page, 'acceptation-case').catch(() => undefined);
  await toucher(page, 'acceptation-continuer').catch(() => undefined);
  await page.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(page, MDP, secret));
  await page.getByText(/Fermer|Terminé|Compris|Plus tard/).first().click({ timeout: 3000 }).catch(() => undefined);

  // Quelques captures gardées dans docs/ (les autres étapes sont vérifiées sans image) ; CAPTURES_TOUTES=1 : toutes.
  const GARDEES = new Set(['v4-pc-sombre', 'v4-pc-survol', 'v4-pc-sous-agent', 'v4-pc-plein-ecran', 'v4-ipad-paysage-clair', 'v4-iphone-sombre', 'v4-iphone-clair']);
  const prendre = async (nom, souris = true) => {
    if (!GARDEES.has(nom) && !process.env.CAPTURES_TOUTES) return;
    await pause(700);
    if (souris) await page.mouse.move(1, 1);
    await page.screenshot({ path: join(CAPTURES, `${nom}.jpg`), type: 'jpeg', quality: 60 });
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
  /** Débordement, cibles ≥ 44 px et textes ≥ 15 px dans Claude Office (hors scène décorative, aria-hidden). */
  const mesurer = (zones = ['bureau', 'bureau-detail', 'bureau-plateau']) => page.evaluate(ids => {
    const visible = el => {
      const st = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0 && !el.closest('[aria-hidden="true"]');
    };
    const racines = ids.map(id => document.querySelector(`[data-testid="${id}"]`)).filter(Boolean);
    const petites = [];
    const petitsTextes = [];
    const deborde = [];
    for (const zone of racines) {
      for (const el of [zone, ...zone.querySelectorAll('button, [role=button], [role=switch], [role=tab], [role=radio], a[href], input')]) {
        if (!el.matches('button, [role=button], [role=switch], [role=tab], [role=radio], a[href], input') || !visible(el)) continue;
        // Les cibles des personnages hors de la vue (zoom) sont coupées par le cadre : seules comptent celles qu'on voit.
        const r = el.getBoundingClientRect();
        if (el.closest('[data-testid="bureau-scene-defilement"]') && (r.right < 0 || r.left > innerWidth || r.bottom < 0 || r.top > innerHeight)) continue;
        if (r.width < 44 || r.height < 44) petites.push(`${el.getAttribute('data-testid') ?? el.textContent.trim().slice(0, 30)} (${Math.round(r.width)}×${Math.round(r.height)})`);
      }
      const marcheur = document.createTreeWalker(zone, NodeFilter.SHOW_TEXT);
      for (let n = marcheur.nextNode(); n; n = marcheur.nextNode()) {
        const t = n.textContent.trim();
        if (!t || !n.parentElement || !visible(n.parentElement) || n.parentElement.closest('style')) continue;
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
  const plateau = () => page.getByTestId('bureau-plateau');
  const remonter = () => page.evaluate(() => {
    for (let el = document.querySelector('[data-testid="bureau-plateau"]'); el; el = el.parentElement) if (el.scrollTop) el.scrollTop = 0;
    window.scrollTo(0, 0);
  }).then(() => pause(300));
  const zoom = async () => Number(await plateau().getAttribute('data-zoom'));
  const centre = async () => (await plateau().getAttribute('data-centre')).split(',').map(Number);
  const cadreVue = () => page.getByTestId('bureau-scene-defilement').boundingBox();
  const dansLEcran = r => r && r.x >= -1 && r.y >= -1 && r.x + r.width <= page.viewportSize().width + 1 && r.y + r.height <= page.viewportSize().height + 1;
  /**
   * Un point de la zone qui n'est couvert par rien (ni personnage, ni bouton flottant, ni mini-carte), le plus loin possible des
   * personnages : `niveau` 0 = marges larges, 1 et 2 = marges réduites (l'iPhone ne montre qu'un morceau de la pièce, plein de monde).
   */
  const pointZone = (zone, niveau = 0) => page.evaluate(([z, niveau]) => {
    const poly = document.querySelector(`[data-co-zone="${z}"]`);
    const r = poly.getBoundingClientRect();
    const v = document.querySelector('[data-testid="bureau-scene-defilement"]').getBoundingClientRect();
    const [margePerso, margeCadre] = [[45, 60], [28, 40], [14, 24]][niveau];
    const persos = [...document.querySelectorAll('[data-co-agent],[data-co-sous]')].map(e => e.getBoundingClientRect());
    const libre = (x, y) => persos.every(p => x < p.left - margePerso || x > p.right + margePerso || y < p.top - margePerso || y > p.bottom + margePerso);
    let meilleur;
    for (let fy = 0.1; fy <= 0.9; fy += 0.04) {
      for (let fx = 0.1; fx <= 0.9; fx += 0.04) {
        const x = r.x + r.width * fx;
        const y = r.y + r.height * fy;
        if (x < v.left + margeCadre || x > v.right - margeCadre || y < v.top + margeCadre || y > v.bottom - margeCadre - 10) continue;
        if (document.elementFromPoint(x, y)?.getAttribute('data-co-zone') !== z || !libre(x, y)) continue;
        // Le plus éloigné des personnages.
        const d = Math.min(1e9, ...persos.map(p => Math.hypot(Math.max(p.left - x, 0, x - p.right), Math.max(p.top - y, 0, y - p.bottom))));
        if (!meilleur || d > meilleur.d) meilleur = { x, y, d };
      }
    }
    return meilleur ? { x: meilleur.x, y: meilleur.y } : undefined;
  }, [zone, niveau]);
  /** Idem, en réduisant les marges jusqu'à trouver un point. */
  const pointZoneAuto = async zone => (await pointZone(zone, 0)) ?? (await pointZone(zone, 1)) ?? (await pointZone(zone, 2));
  /** Un point du plateau hors de tout personnage et de toute zone (pour « toucher ailleurs »). */
  const pointVide = () => page.evaluate(() => {
    const v = document.querySelector('[data-testid="bureau-scene-defilement"]').getBoundingClientRect();
    for (let fy = 0.1; fy < 0.9; fy += 0.025) {
      for (let fx = 0.1; fx < 0.95; fx += 0.025) {
        const x = v.left + v.width * fx;
        const y = v.top + v.height * fy;
        const el = document.elementFromPoint(x, y);
        if (el && el.closest('[data-testid="bureau-scene-defilement"]') && !el.closest('[data-co-agent],[data-co-sous],[data-co-zone],button,[data-testid^="scene-carte"],[data-testid^="scene-minicarte"],[data-testid^="scene-relecture"],[data-testid^="scene-suivi"],[data-testid^="scene-puce"]')) return { x, y };
      }
    }
    return undefined;
  });
  /** Première cible de personnage visible dans le cadre (installé, pas en train de marcher). */
  const cibleVisible = async () => {
    const v = await cadreVue();
    // Repérée par sa clé (stable), pas par son rang : des sous-agents vont et viennent entre deux touchers.
    const cles = await page.locator('[data-co-agent]').evaluateAll(els => els.map(e => e.getAttribute('data-co-agent')));
    for (const cle of cles) {
      const cible = page.locator(`[data-co-agent="${cle}"]`);
      const b = await cible.boundingBox();
      const mode = await page.locator(`g[data-cle="${cle}"]`).first().getAttribute('data-mode').catch(() => 'marche');
      if (b && mode !== 'marche' && b.x > v.x + 50 && b.x + b.width < v.x + v.width - 50 && b.y > v.y + 50 && b.y + b.height < v.y + v.height - 60) return cible;
    }
    return page.locator(`[data-co-agent="${cles[0]}"]`);
  };

  // 1. Mise en route (site sans copie) : réductible à la main malgré la ligne rouge, mémorisée, une ligne compacte.
  await ouvrir();
  await page.getByTestId('mise-en-route').waitFor({ timeout: 20_000 });
  const hautAvant = (await plateau().boundingBox())?.y ?? 0;
  await page.getByTestId('mise-en-route-reduire').click();
  await page.getByTestId('mise-en-route-reduite').waitFor();
  const ligne = await page.getByTestId('mise-en-route-reduite').innerText();
  verifier(/Mise en route · \d+ points? à régler/.test(ligne) && (await page.getByTestId('mise-en-route-reduite').getAttribute('aria-expanded')) === 'false', `mise en route réduite en une ligne, aria-expanded (« ${ligne.replace(/\s+/g, ' ')} »)`);
  verifier(((await plateau().boundingBox())?.y ?? 0) < hautAvant - 100, 'mise en route réduite : la scène remonte');
  await page.reload();
  await deverrouiller(page, MDP, secret).catch(() => undefined);
  await ouvrir();
  await page.getByTestId('mise-en-route-reduite').waitFor({ timeout: 20_000 }).catch(() => undefined);
  verifier((await page.getByTestId('mise-en-route-reduite').count()) === 1 && (await page.getByTestId('mise-en-route').count()) === 0, 'mise en route : toujours réduite après rechargement (même point rouge)');
  await page.getByTestId('mise-en-route-reduite').click();
  verifier((await page.getByTestId('mise-en-route').count()) === 1, 'mise en route : rouverte d’un geste');
  await page.getByTestId('mise-en-route-reduire').click();

  // 2. Démo, PC (souris) : la scène est l'élément principal.
  await page.getByTestId('bureau-demo').click();
  await pause(6000);
  const vp = page.viewportSize();
  const cadre = await cadreVue();
  verifier(cadre.width >= vp.width - 60 && cadre.height >= 560 && cadre.y + cadre.height <= vp.height + 2, `PC : scène pleine largeur, hauteur disponible (${Math.round(cadre.width)}×${Math.round(cadre.height)} à y=${Math.round(cadre.y)})`);
  verifier((await page.getByTestId('bureau-compteurs').count()) === 0 && (await page.getByTestId('bureau-legende').count()) === 0, 'PC : compteurs et légende repliés dans « Options »');
  verifier((await page.locator('[data-testid="scene-bulle"]').count()) === 0, 'PC : plus de bulle permanente dans la scène');
  await controler('PC, démo (sombre)');
  await prendre('v4-pc-sombre');

  // Survol réel d'un agent : carte élégante, dans l'écran, décrite (aria-describedby).
  const agent = await cibleVisible();
  await agent.hover();
  await page.getByTestId('scene-carte').waitFor({ timeout: 3000 }).catch(() => undefined);
  const carte = await page.getByTestId('scene-carte').boundingBox();
  verifier(dansLEcran(carte) && /Dernière activité/.test(await page.getByTestId('scene-carte').innerText()), 'survol d’un agent : carte (projet, état, depuis quand, demande) dans l’écran');
  const decrit = await agent.getAttribute('aria-describedby');
  verifier(Boolean(decrit) && (await page.locator(`[id="${decrit}"]`).count()) === 1, 'carte décrite pour les lecteurs d’écran (aria-describedby)');
  await controler('PC, carte de survol', ['bureau-plateau']);
  await prendre('v4-pc-survol', false);
  // Intégration : le surnom donné dans l'Équipe (démo : « facturation » = Félix) s'affiche au survol.
  await page.mouse.move(1, 1);
  await pause(400);
  const cleFelix = (await page.locator('[data-co-agent]').evaluateAll(els => els.map(e => e.getAttribute('data-co-agent')))).find(c => c.endsWith('|demo-facturation'));
  if (cleFelix) {
    await page.locator(`[data-co-agent="${cleFelix}"]`).hover().catch(() => undefined);
    await page.getByTestId('scene-carte-surnom').waitFor({ timeout: 3000 }).catch(() => undefined);
  }
  const surnomVu = await page.getByTestId('scene-carte-surnom').innerText().catch(() => '');
  const libelleFelix = cleFelix ? await page.locator(`[data-co-agent="${cleFelix}"]`).getAttribute('aria-label') : '';
  verifier(surnomVu === 'Félix' && /^Félix \(facturation\)/.test(libelleFelix ?? ''), `Équipe : surnom affiché au survol et dans la cible accessible (« ${surnomVu} », « ${(libelleFelix ?? '').slice(0, 40)} »)`);
  // Cohérence avec l'onglet Suivi : l'agent qui attend (pastille de la barre) est celui de l'alerte de la démo.
  verifier((await page.getByTestId('bureau-pastille-attend').count()) === 1 && /Félix|facturation/.test(await page.locator(`[data-co-agent="${cleFelix}"]`).getAttribute('aria-label').catch(() => '')) && /Attend ta réponse/.test(libelleFelix ?? ''), 'pastille « attend ta réponse » : l’agent de l’alerte de démo (facturation) est bien au guichet');
  await page.mouse.move(1, 1);
  await pause(400);
  // Survol d'une zone : nom, nombre, rôle.
  await page.mouse.move(1, 1);
  await pause(400);
  const pz = await pointZoneAuto('bibliotheque');
  if (pz) {
    await page.mouse.move(pz.x, pz.y);
    await page.mouse.move(pz.x + 3, pz.y + 2);
    await page.getByTestId('scene-carte-zone').waitFor({ timeout: 3000 }).catch(() => undefined);
  }
  verifier(Boolean(pz) && /Bibliothèque/.test(await page.getByTestId('scene-carte-zone').innerText().catch(() => '')), 'survol d’une zone : nom, nombre d’agents, à quoi elle sert');
  const pg = await pointZoneAuto('guichet');
  if (pg) {
    await page.mouse.move(pg.x, pg.y);
    await page.mouse.move(pg.x + 2, pg.y + 1);
    await pause(700);
  }
  verifier(/Attend ta réponse/.test(await page.getByTestId('scene-carte-zone').innerText().catch(() => '')), 'survol du guichet : qui attend');
  await page.keyboard.press('Escape');
  await pause(300);
  verifier((await page.getByTestId('scene-carte-zone').count()) === 0 && (await page.getByTestId('bureau').count()) === 1, 'Échap ferme la carte (et pas l’app)');

  // Clic sur un agent : panneau Détail ; Échap le ferme sans fermer l'app.
  await (await cibleVisible()).click();
  await page.getByTestId('bureau-detail').waitFor({ timeout: 5000 });
  verifier(true, 'clic sur un agent : panneau Détail');
  await page.keyboard.press('Escape');
  await pause(600);
  verifier((await page.getByTestId('bureau-detail').count()) === 0 && (await page.getByTestId('bureau').count()) === 1, 'Échap ferme le détail, l’app reste ouverte');

  // Zoom : boutons, molette (autour du pointeur), limites ; glisser ; double-clic sur une zone ; Recentrer.
  const z0 = await zoom();
  await page.getByTestId('scene-zoom-plus').click();
  await pause(400);
  const z1 = await zoom();
  verifier(z1 > z0 * 1.3, `zoom + (${z0} → ${z1})`);
  const v = await cadreVue();
  await page.mouse.move(v.x + v.width / 2, v.y + v.height / 2);
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, -240);
  await pause(300);
  const zMax = await zoom();
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -240);
  verifier(zMax > z1 && Math.abs((await zoom()) - zMax) < 1e-3, `molette : zoom jusqu’à la limite (${zMax})`);
  const c0 = await centre();
  await page.mouse.move(v.x + v.width / 2, v.y + v.height / 2);
  await page.mouse.down();
  await page.mouse.move(v.x + v.width / 2 + 160, v.y + v.height / 2 + 60, { steps: 8 });
  await page.mouse.up();
  await pause(900);
  const c1 = await centre();
  verifier(c1[0] < c0[0] - 20, `glisser : la vue se déplace (${c0} → ${c1}), avec inertie bornée`);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 240);
  await pause(300);
  const zMin = await zoom();
  verifier(Math.abs(zMin - z0) < 0.02, `molette : retour à la vue d’ensemble, pas en deçà (${zMin})`);
  // Au-delà, la page défile (normal) : on remonte.
  await remonter();
  await page.getByTestId('scene-recentrer').click();
  await pause(500);
  const pa = await pointZoneAuto('atelier');
  if (pa) await page.mouse.dblclick(pa.x, pa.y);
  await pause(700);
  verifier(Boolean(pa) && (await zoom()) > z0 * 1.4, `double-clic sur l’Atelier : la zone est cadrée (${await zoom()})`);
  await prendre('v4-pc-zoom');
  await page.getByTestId('scene-recentrer').click();
  await pause(600);
  verifier(Math.abs((await zoom()) - z0) < 0.02, 'Recentrer : vue de départ');

  // Suivi caméra depuis la carte de survol.
  const suivie = await cibleVisible();
  const cleSuivie = await suivie.getAttribute('data-co-agent');
  await suivie.hover();
  await page.getByTestId('scene-carte-suivre').click({ timeout: 3000 });
  await pause(1500);
  const posAgent = await page.evaluate(cle => {
    const b = document.querySelector(`[data-co-agent="${cle}"]`).getBoundingClientRect();
    const v = document.querySelector('[data-testid="bureau-scene-defilement"]').getBoundingClientRect();
    return { dx: b.x + b.width / 2 - (v.x + v.width / 2), dy: b.y + b.height / 2 - (v.y + v.height / 2) };
  }, cleSuivie);
  verifier((await page.getByTestId('scene-suivi').count()) === 1 && Math.hypot(posAgent.dx, posAgent.dy) < 120 && (await zoom()) > z0, `« Suivre cet agent » : la caméra le centre (écart ${Math.round(Math.hypot(posAgent.dx, posAgent.dy))} px)`);
  await page.getByTestId('scene-suivi').click();
  verifier((await page.getByTestId('scene-suivi').count()) === 0, 'suivi arrêté');
  await page.getByTestId('scene-recentrer').click();

  // Mini-carte : repliable, et on s'y déplace.
  if (!(await page.getByTestId('scene-minicarte').count())) await page.getByTestId('scene-minicarte-basculer').click();
  const mini = await page.getByTestId('scene-minicarte').boundingBox();
  await page.mouse.click(mini.x + mini.width * 0.85, mini.y + mini.height * 0.5);
  await pause(500);
  await page.getByTestId('scene-zoom-plus').click();
  await page.mouse.click(mini.x + mini.width * 0.85, mini.y + mini.height * 0.5);
  // Attente explicite de la caméra (la transition vers le point touché), pas d'une durée fixe.
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="bureau-plateau"]').getAttribute('data-centre').split(',')[0]) > 700, undefined, { timeout: 5000, polling: 'raf' }).catch(() => undefined);
  verifier((await centre())[0] > 700, `mini-carte : un toucher y déplace la vue (${await centre()})`);
  await page.getByTestId('scene-minicarte-basculer').click();
  verifier((await page.getByTestId('scene-minicarte').count()) === 0, 'mini-carte repliée');
  await page.getByTestId('scene-minicarte-basculer').click();
  await page.getByTestId('scene-recentrer').click();

  // Relecture de la journée : lecture accélérée, vitesse, curseur, retour au direct.
  await page.getByTestId('scene-relecture-ouvrir').click();
  await page.getByTestId('scene-relecture').waitFor();
  const h0 = await page.getByTestId('scene-relecture-heure').innerText();
  await pause(2000);
  const h1 = await page.getByTestId('scene-relecture-heure').innerText();
  verifier(h0 !== h1, `relecture : le temps défile en accéléré (${h0} → ${h1})`);
  await page.getByTestId('scene-relecture-lecture').click();
  await page.getByTestId('scene-relecture-x10').click();
  verifier((await page.getByTestId('scene-relecture-x10').getAttribute('aria-checked')) === 'true', 'relecture : vitesse ×10');
  const curseur = await page.getByTestId('scene-relecture-curseur').boundingBox();
  await page.mouse.click(curseur.x + curseur.width * 0.95, curseur.y + curseur.height / 2);
  await pause(1500);
  verifier((await page.locator('[data-testid^="scene-cible-"]').count()) >= 3, `relecture : à la fin de la journée, les agents sont là (${await page.locator('[data-testid^="scene-cible-"]').count()})`);
  await controler('PC, relecture', ['bureau-plateau']);
  await prendre('v4-pc-relecture');
  await page.getByTestId('scene-relecture-quitter').click();
  verifier((await page.getByTestId('scene-relecture').count()) === 0, 'relecture : retour au direct');

  // Plein écran (API Fullscreen, ou immersif) puis Échap ; écran d'ambiance sans interface.
  await page.getByTestId('scene-plein-ecran').click();
  await pause(1200);
  const pe = await plateau().boundingBox();
  verifier((await plateau().getAttribute('data-mode')) === 'immersif' && pe.width >= vp.width - 1 && pe.height >= vp.height - 1, `plein écran : la scène couvre l’écran (${Math.round(pe.width)}×${Math.round(pe.height)})`);
  await controler('PC, plein écran', ['bureau-plateau']);
  await prendre('v4-pc-plein-ecran');
  // Détail par-dessus le plein écran.
  await (await cibleVisible()).click();
  await page.getByTestId('bureau-detail').waitFor({ timeout: 5000 });
  verifier(await page.getByTestId('bureau-detail-fermer').isVisible(), 'plein écran : le détail s’ouvre par-dessus');
  await page.keyboard.press('Escape');
  await pause(500);
  await page.mouse.move(1, 1);
  await pause(400);
  await page.keyboard.press('Escape');
  await pause(300);
  if ((await plateau().getAttribute('data-mode')) !== 'normal') await page.keyboard.press('Escape');
  await pause(600);
  verifier((await plateau().getAttribute('data-mode')) === 'normal' && (await page.getByTestId('bureau').count()) === 1, 'Échap : on quitte le plein écran (l’app reste ouverte)');
  await page.getByTestId('scene-ambiance').click();
  await pause(4500);
  verifier((await plateau().getAttribute('data-mode')) === 'ambiance' && (await page.getByTestId('scene-zoom-plus').count()) === 0 && (await page.locator('[data-testid^="scene-cible-"]').count()) === 0, 'écran d’ambiance : plein écran sans interface');
  await prendre('v4-pc-ambiance', false);
  await page.keyboard.press('Escape');
  await pause(600);
  verifier((await plateau().getAttribute('data-mode')) === 'normal', 'écran d’ambiance quitté (Échap)');

  // Raccourcis branchés sur la scène : F bascule le plein écran ; J / K suivent l'agent suivant / précédent.
  await page.mouse.move(1, 1);
  await page.locator('body').click({ position: { x: 2, y: 2 } }).catch(() => undefined);
  await page.keyboard.press('f');
  await pause(900);
  const modeF = await plateau().getAttribute('data-mode');
  await page.keyboard.press('f');
  await pause(900);
  verifier(modeF === 'immersif' && (await plateau().getAttribute('data-mode')) === 'normal', `touche F : plein écran puis retour (${modeF})`);
  // Chaque touche est suivie d'une attente explicite du nouvel état (le libellé de suivi change), sans pause arbitraire :
  // l'ordre des agents évolue avec la démo, donc J, J, K doivent s'enchaîner vite pour juger le même ordre.
  const lireSuivi = () => page.getByTestId('scene-suivi').innerText({ timeout: 2000 }).catch(() => '');
  const attendreSuiviDifferent = avant => page.waitForFunction(t => { const e = document.querySelector('[data-testid="scene-suivi"]'); return Boolean(e) && e.textContent !== t; }, avant, { timeout: 5000 }).catch(() => undefined);
  await page.keyboard.press('j');
  await attendreSuiviDifferent('');
  const suiviJ = await lireSuivi();
  await page.keyboard.press('j');
  await attendreSuiviDifferent(suiviJ);
  const suiviJ2 = await lireSuivi();
  await page.keyboard.press('k');
  await attendreSuiviDifferent(suiviJ2);
  const suiviK = await lireSuivi();
  verifier(Boolean(suiviJ) && suiviJ2 !== suiviJ && suiviK === suiviJ && (await page.getByTestId('scene-carte').count()) === 1 && (await page.getByTestId('bureau-detail').count()) === 0, `touches J / K : la caméra suit l’agent suivant puis le précédent (« ${suiviJ} » → « ${suiviJ2} » → « ${suiviK} »)`);
  await page.getByTestId('scene-suivi').click().catch(() => undefined);
  await page.keyboard.press('Escape');
  await page.getByTestId('scene-recentrer').click();
  await pause(500);

  // Intégration : un sous-agent est dessiné DÈS son SubagentStart (module de données), sans attendre la fin de
  // l'outil Agent. Démo « refonte » : le sous-agent « c » démarre à +3 s et son outil Agent n'est noté qu'à +44 s.
  let vuDesLeDebut;
  for (let i = 0; i < 100 && !vuDesLeDebut; i++) {
    vuDesLeDebut = (await page.locator('[data-sous][data-phase="travaille"]').evaluateAll(e => e.map(x => x.getAttribute('data-sous')))).find(x => /^demo-agent-\d+-c$/.test(x));
    if (!vuDesLeDebut) await pause(1000);
  }
  const parentRefonte = vuDesLeDebut ? await page.locator(`[data-sous="${vuDesLeDebut}"]`).getAttribute('data-parent') : '';
  verifier(Boolean(vuDesLeDebut) && /\|demo-refonte$/.test(parentRefonte ?? ''), `sous-agent visible dès SubagentStart, avant la fin de son outil Agent (${vuDesLeDebut}, parent ${parentRefonte})`);

  // Sous-agents (démo) : un petit personnage sort de la réunion, travaille, rend son travail au parent et disparaît.
  await remonter();
  await page.getByTestId('scene-recentrer').click();
  // Un sous-agent qui vient d'apparaître ET qui vit longtemps : le « general-purpose » de la démo (« …-c », 41 s de travail avant
  // de rendre son travail). Les autres vivent 12 à 27 s : trop justes pour enchaîner survol, détail et attente du rendu.
  const deja = new Set(await page.locator('[data-sous]').evaluateAll(e => e.map(x => x.getAttribute('data-sous'))));
  let idSous;
  for (let i = 0; i < 130 && !idSous; i++) {
    const ids = await page.locator('[data-sous][data-phase="travaille"]').evaluateAll(e => e.map(x => x.getAttribute('data-sous')));
    idSous = ids.find(x => !deja.has(x) && /^demo-agent-\d+-c$/.test(x));
    if (!idSous) await pause(1000);
  }
  verifier(Boolean(idSous), `sous-agent : un mini-personnage apparaît (${idSous})`);
  verifier((await page.getByTestId('scene-compteur-sous-agents').count()) >= 1, 'sous-agent : compteur discret sur le parent');
  const cibleSous = page.locator(`[data-co-sous="${idSous}"]`);
  await pause(2800); // le temps qu'il arrive à sa place
  await cibleSous.hover().catch(() => undefined);
  await page.getByTestId('scene-carte-sous').waitFor({ timeout: 3000 }).catch(() => undefined);
  verifier(/Sous-agent de .+/.test(await page.getByTestId('scene-carte-sous').innerText().catch(() => '')) && (await page.getByTestId('scene-lien-sous-agent').count()) === 1, 'survol d’un sous-agent : carte « Sous-agent de … » et lien pointillé vers le parent');
  await prendre('v4-pc-sous-agent', false);
  await cibleSous.click().catch(() => undefined);
  await page.getByTestId('bureau-detail').waitFor({ timeout: 5000 }).catch(() => undefined);
  verifier((await page.getByTestId('bureau-detail-sous-agents').count()) === 1, `détail du parent : section « Sous-agents » (détail ouvert : ${await page.getByTestId('bureau-detail').count()})`);
  await page.getByTestId('bureau-detail-fermer').click().catch(() => undefined);
  await page.mouse.move(1, 1);
  // Attentes d'état (sondées à chaque image, pas toutes les secondes : la phase « rendu » ne dure que ~4 s), sans pause arbitraire.
  const vuRendu = await page.waitForFunction(id => document.querySelector(`[data-sous="${id}"]`)?.getAttribute('data-phase') === 'rendu', idSous, { timeout: 90_000, polling: 'raf' }).then(() => true, () => false);
  const parti = vuRendu && (await page.waitForFunction(id => !document.querySelector(`[data-sous="${id}"]`), idSous, { timeout: 20_000, polling: 'raf' }).then(() => true, () => false));
  verifier(vuRendu && parti, `sous-agent : à sa fin, il rend son travail au parent puis disparaît (rendu vu : ${vuRendu})`);
  await page.getByTestId('bureau-vue-liste').click();
  await page.locator('[data-testid^="bureau-sous-agents-"]').first().waitFor({ timeout: 40_000 }).catch(() => undefined);
  verifier((await page.locator('[data-testid^="bureau-sous-agents-"]').count()) >= 1, 'vue Liste : sous-agents indentés sous leur parent');
  await page.getByTestId('bureau-vue-scene').click();
  await pause(800);

  // 3. iPad et iPhone, au toucher : premier tap = aperçu, second = détail ; tap ailleurs = ferme.
  for (const [l, h, nom] of [[1024, 768, 'iPad paysage'], [820, 1180, 'iPad portrait'], [390, 844, 'iPhone']]) {
    await page.setViewportSize({ width: l, height: h });
    await pause(1500);
    await page.getByTestId('scene-recentrer').click();
    await pause(700);
    const c = await cadreVue();
    if (nom === 'iPhone') verifier((await zoom()) >= 0.7 && c.height >= 440, `iPhone : vue rapprochée lisible (échelle ${await zoom()}, cadre ${Math.round(c.height)} px)`);
    const cible = await cibleVisible();
    await cible.tap();
    await page.getByTestId('scene-carte').waitFor({ timeout: 3000 }).catch(() => undefined);
    const ca = await page.getByTestId('scene-carte').boundingBox();
    verifier(dansLEcran(ca) && (await page.getByTestId('bureau-detail').count()) === 0, `${nom} : premier tap = carte d’aperçu, dans l’écran`);
    await controler(`${nom}, aperçu`, ['bureau', 'bureau-plateau']);
    if (nom === 'iPhone') await prendre('v4-iphone-apercu-sombre', false);
    await cible.tap();
    await page.getByTestId('bureau-detail').waitFor({ timeout: 5000 }).catch(() => undefined);
    verifier((await page.getByTestId('bureau-detail').count()) === 1, `${nom} : second tap = panneau Détail`);
    await page.getByTestId('bureau-detail-fermer').tap();
    await pause(400);
    await (await cibleVisible()).tap();
    await page.getByTestId('scene-carte').waitFor({ timeout: 3000 }).catch(() => undefined);
    await page.getByTestId('scene-carte-detail').tap();
    await page.getByTestId('bureau-detail').waitFor({ timeout: 5000 }).catch(() => undefined);
    verifier((await page.getByTestId('bureau-detail').count()) === 1, `${nom} : bouton « Voir le détail » de la carte`);
    await page.getByTestId('bureau-detail-fermer').tap();
    await pause(400);
    await (await cibleVisible()).tap();
    await pause(300);
    const pzt = await pointVide();
    verifier(Boolean(pzt), `${nom} : un point libre existe dans la scène pour « tap ailleurs »`);
    if (pzt) await page.touchscreen.tap(pzt.x, pzt.y);
    await pause(400);
    verifier((await page.getByTestId('scene-carte').count()) === 0, `${nom} : tap ailleurs = la carte se ferme`);
    // Double-tap sur une zone : cadrée.
    await page.getByTestId('scene-recentrer').tap();
    await pause(500);
    const zr = await zoom();
    // Un point de zone loin des personnages (la démo en compte beaucoup) : marges larges d'abord, zone par zone, puis réduites.
    let pd;
    let zd;
    for (const niveau of [0, 1, 2]) for (const z of ['atelier', 'reflexion', 'cafe', 'bibliotheque', 'detente', 'reunion', 'machines', 'accueil']) if (!pd && (pd = await pointZone(z, niveau))) zd = z;
    // Rien ne doit couvrir le point choisi (carte d'aperçu restée ouverte, bouton flottant) : on le vérifie AVANT les touchers,
    // pour que les deux touchers se suivent sans pause ni mesure entre eux (le double-tap se joue en moins de 340 ms).
    verifier((await page.getByTestId('scene-carte').count()) === 0, `${nom} : aucune carte ouverte avant le double-tap`);
    const sousLeDoigt = pd ? await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.getAttribute('data-co-zone') ?? 'couvert', [pd.x, pd.y]) : '';
    verifier(Boolean(pd) && sousLeDoigt === zd, `${nom} : le point du double-tap est bien sur la zone « ${zd} » (sous le doigt : ${sousLeDoigt})`);
    // « Cadrer » une zone = l'amener tout entière dans la vue (au-dessus de l'échelle de départ pour une petite zone, un peu en
    // dessous pour une grande zone sur un téléphone, où la vue ne montre qu'un morceau de la pièce). Le test juge donc l'état de la
    // caméra : elle a bougé ET la zone tient entièrement dans le cadre, une fois la transition terminée.
    const avant = { zoom: zr, centre: await centre() };
    const zoneCadree = ([z, avant]) => {
      const plateau = document.querySelector('[data-testid="bureau-plateau"]');
      const [cx, cy] = plateau.getAttribute('data-centre').split(',').map(Number);
      const bouge = Math.abs(Number(plateau.getAttribute('data-zoom')) / avant.zoom - 1) > 0.02 || Math.hypot(cx - avant.centre[0], cy - avant.centre[1]) > 2;
      const v = document.querySelector('[data-testid="bureau-scene-defilement"]').getBoundingClientRect();
      const r = document.querySelector(`polygon[data-co-zone="${z}"]`).getBoundingClientRect();
      return bouge && r.left >= v.left - 3 && r.right <= v.right + 3 && r.top >= v.top - 3 && r.bottom <= v.bottom + 3;
    };
    let cadree = false;
    if (pd) {
      await page.touchscreen.tap(pd.x, pd.y);
      await page.touchscreen.tap(pd.x, pd.y);
      cadree = await page.waitForFunction(zoneCadree, [zd, avant], { timeout: 5000, polling: 'raf' }).then(() => true, () => false);
      // La transition (380 ms) se termine : l'état final est stable.
      const z1 = await zoom();
      await page.waitForFunction(z => Math.abs(Number(document.querySelector('[data-testid="bureau-plateau"]').getAttribute('data-zoom')) - z) < 1e-6, z1, { timeout: 3000, polling: 'raf' }).catch(() => undefined);
      cadree = cadree && (await page.evaluate(zoneCadree, [zd, avant]));
    }
    verifier(Boolean(pd) && cadree, `${nom} : double-tap sur une zone = zone cadrée (${zd}, échelle ${zr} → ${await zoom()}, centre ${avant.centre} → ${await centre()})`);
    await page.getByTestId('scene-recentrer').tap();
    await pause(500);
    await controler(`${nom}, démo en scène (sombre)`);
    if (nom === 'iPad portrait') await prendre('v4-ipad-portrait-sombre');
    if (nom === 'iPhone') await prendre('v4-iphone-sombre');
  }

  // 4. Thème clair : PC, iPad, iPhone ; captures.
  await page.setViewportSize({ width: 1440, height: 900 });
  await changerTheme('ivoire');
  await ouvrir();
  if (!(await page.getByTestId('scene-demo').count())) await page.getByTestId('bureau-demo').click();
  await pause(6000);
  for (const [l, h, nom, cap] of [[1440, 900, 'PC', 'v4-pc-clair'], [1024, 768, 'iPad paysage', 'v4-ipad-paysage-clair'], [820, 1180, 'iPad portrait', ''], [390, 844, 'iPhone', 'v4-iphone-clair']]) {
    await page.setViewportSize({ width: l, height: h });
    await pause(1400);
    await page.getByTestId('scene-recentrer').click();
    await controler(`${nom}, démo en scène (clair)`);
    if (cap) await prendre(cap);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await pause(800);
  await (await cibleVisible()).hover();
  await page.getByTestId('scene-carte').waitFor({ timeout: 3000 }).catch(() => undefined);
  await prendre('v4-pc-clair-survol', false);
  await page.getByTestId('bureau-options').click();
  verifier((await page.getByTestId('bureau-compteurs').count()) === 1 && (await page.getByTestId('bureau-legende').count()) === 1 && (await page.getByTestId('bureau-aujourdhui').count()) === 1, '« Options » : résumé du jour, compteurs, recherche, filtres et légende restent trouvables');
  await controler('PC, options (clair)');
  await page.getByTestId('bureau-options').click();

  // 5. Animations réduites : scène fixe, pas d'inertie.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await pause(1500);
  verifier((await page.getByTestId('bureau-piece-fixe').count()) === 1 && (await page.locator('[data-testid="bureau-plateau"] svg.co-fixe').count()) === 1, 'animations réduites : scène fixe');
  const za = await zoom();
  await page.getByTestId('scene-zoom-plus').click();
  verifier((await zoom()) > za * 1.3, 'animations réduites : le zoom est immédiat (sans transition)');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  verifier(erreurs.length === 0, `aucune erreur JavaScript ${JSON.stringify(erreurs.slice(0, 3))}`);
} finally {
  await navigateur.close();
  site.fermer();
  relais.fermer();
}
process.exit(echec ? 1 : 0);
