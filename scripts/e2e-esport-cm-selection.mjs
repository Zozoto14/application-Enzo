/**
 * Non-régression : glisser une carte ou une colonne d'un tableau CM à la souris (web, bureau) ne sélectionne aucun
 * texte (titres de cartes, puces, en-têtes de colonnes, « + Ajouter une carte ») et n'affiche pas d'infobulle de titre.
 * Pendant le geste : window.getSelection() vide, <html data-cm-glisse>, aucun attribut « title » dans le tableau ;
 * après : la sélection de texte redevient possible (champ de saisie compris). Capture au milieu du geste (CAPTURES).
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-esport-cm-selection.mjs
 */

import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { allerPageApplications, nouveauContexte, tuileApp } from './e2e-acceptation.mjs';
import { chargerPlaywright, demarrerRelais, deverrouiller, pause, premierLancement, racine } from './mobile-outils.mjs';

const CAPTURES = process.env.CAPTURES ?? join(racine, '.captures-audit/cm-selection');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-esport-cm-selection-0123456789';
const PORT_RELAIS = 8881;
const PORT_ESPORT = 8882;
const PORT_SITE = 5331;
const MDP = 'mot-de-passe-esport-e2e-tres-long-42';
const log = (...a) => console.log('[e2e-esport-cm-selection]', ...a);
let echecs = 0;
const verifier = (ok, message) => {
  console.log(ok ? '  OK   ' : '  ECHEC', message);
  if (!ok) echecs++;
};

const { demarrerServeurEsport } = await import(pathToFileURL(join(racine, 'esport/outils/serveur-local.mjs')).href);
const relais = await demarrerRelais(PORT_RELAIS, JETON);
const esport = await demarrerServeurEsport({ port: PORT_ESPORT, jetonDev: JETON });
const frontal = { url: esport.url, fermer: async () => {} };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const dist = join(racine, 'bureau/dist');
if (!existsSync(join(dist, 'index.html'))) throw new Error('bureau/dist absent : lancez « npx vite build » d’abord');
const serveurSite = http.createServer((req, res) => {
  const chemin = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  if (chemin === '/relais.json' || chemin === '/esport.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(chemin === '/relais.json' ? { relais: `https://localhost:${PORT_RELAIS}` } : { esport: frontal.url }));
    return;
  }
  let fichier = join(dist, chemin);
  if (!existsSync(fichier) || statSync(fichier).isDirectory()) fichier = join(dist, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[extname(fichier)] ?? 'application/octet-stream' });
  createReadStream(fichier).pipe(res);
});
await new Promise(ok => serveurSite.listen(PORT_SITE, ok));
const SITE = `http://localhost:${PORT_SITE}/`;


async function api(chemin, jeton, { methode = 'GET', corps } = {}) {
  const r = await fetch(`${esport.url}${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}

const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
try {
  const ctx = await nouveauContexte(navigateur, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const pc = await ctx.newPage();
  pc.on('pageerror', e => log('erreur page :', e.message));
  pc.secret = await premierLancement(pc, { site: SITE, code: relais.code, motDePasse: MDP });
  await pc.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(pc, MDP, pc.secret));
  for (let i = 0; i < 3; i++) if (!(await pc.getByText(/^(Fermer|Terminé|Compris|Plus tard)$/).first().click({ timeout: 2000 }).then(() => true, () => false))) break;
  const sess = (await api('/session', JETON, { methode: 'POST' })).corps.session;
  await api('/moi', sess, { methode: 'PUT', corps: { pseudo: 'Fondateur' } });
  const tab = (await api('/cm/tableaux', sess, { methode: 'POST', corps: { nom: 'Ligne zéro ALL', portee: 'club', couleur: '#0c66e4' } })).corps.tableau;
  const col = {};
  for (const nom of ['Demande', 'The Nuke End', 'Valorant']) col[nom] = (await api(`/cm/tableaux/${tab.id}/listes`, sess, { methode: 'POST', corps: { nom } })).corps.id;
  const etiquette = (await api(`/cm/tableaux/${tab.id}/etiquettes`, sess, { methode: 'POST', corps: { nom: 'Urgent', couleur: '#f87462' } })).corps.id;
  const cartes = [];
  for (const [liste, titre] of [['Demande', 'Visuel annonce roster'], ['Demande', 'Interview coach'], ['The Nuke End', 'Clip 1 — ace sur Nuke'], ['The Nuke End', 'Épisode 2 : coulisses'], ['Valorant', 'Annonce match vendredi']]) {
    const c = (await api(`/cm/tableaux/${tab.id}/cartes`, sess, { methode: 'POST', corps: { listeId: col[liste], titre } })).corps.carte;
    await api(`/cm/cartes/${c.id}`, sess, { methode: 'PATCH', corps: { etiquettes: [etiquette], description: 'Brief' } });
    cartes.push(c);
  }

  await allerPageApplications(pc);
  await tuileApp(pc, 'esport').first().click();
  await pc.getByTestId('app-esport').waitFor({ timeout: 20_000 });
  await pc.getByTestId('esport-nav-teams').first().click();
  await pc.getByTestId('esport-teams-cm-ouvrir').click();
  await pc.getByTestId('esport-cm-groupe-contenus').first().click();
  await pc.getByTestId(`esport-cm-tableau-${tab.id}`).click().catch(async () => { await pc.getByText('Ligne zéro ALL').first().click(); });
  await pc.getByTestId(`esport-cm-carte-${cartes[0].id}-tuile`).waitFor({ timeout: 20_000 });
  await pause(800);

  const etat = () => pc.evaluate(() => ({
    texte: String(window.getSelection()),
    plages: window.getSelection().rangeCount,
    bloque: document.documentElement.hasAttribute('data-cm-glisse'),
    titres: [...document.querySelectorAll('[title]')].map(e => e.getAttribute('title')),
    glissable: document.querySelectorAll('[draggable="true"]').length,
  }));
  const centre = async id => {
    const b = await pc.getByTestId(id).boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };

  // 1. Carte : saisie de la poignée, déplacement lent à travers les colonnes (là où le texte se sélectionnait), capture, dépôt.
  const depart = await centre(`esport-cm-carte-${cartes[0].id}-poignee`);
  await pc.mouse.move(depart.x, depart.y);
  await pc.mouse.down();
  for (let i = 1; i <= 24; i++) {
    await pc.mouse.move(depart.x + i * 22, depart.y + i * 9, { steps: 3 });
    if (i === 12) {
      const e = await etat();
      verifier(e.texte === '' && e.plages === 0, `carte, pendant le glisser : sélection vide (« ${e.texte.slice(0, 40)} »)`);
      verifier(e.bloque, 'carte, pendant le glisser : <html data-cm-glisse> posé');
      verifier(e.titres.length === 0 && e.glissable === 0, `carte : aucune infobulle title (${JSON.stringify(e.titres)}), aucun élément draggable HTML5 (${e.glissable})`);
      verifier(await pc.getByTestId('esport-cm-fantome').isVisible(), 'carte : le fantôme suit le pointeur');
      await pc.screenshot({ path: join(CAPTURES, 'glisser-carte.png') });
    }
  }
  await pc.mouse.up();
  await pause(600);
  let e = await etat();
  verifier(e.texte === '' && !e.bloque, 'carte, après le dépôt : sélection vide et blocage levé');

  // 2. Colonne : saisie de l'en-tête, déplacement vers la droite.
  const liste = await centre(`esport-cm-liste-${col.Demande}-poignee`);
  await pc.mouse.move(liste.x, liste.y);
  await pc.mouse.down();
  for (let i = 1; i <= 24; i++) {
    await pc.mouse.move(liste.x + i * 20, liste.y + i * 12, { steps: 3 });
    if (i === 12) {
      e = await etat();
      verifier(e.texte === '' && e.plages === 0, `colonne, pendant le glisser : sélection vide (« ${e.texte.slice(0, 40)} »)`);
      verifier(e.bloque, 'colonne, pendant le glisser : <html data-cm-glisse> posé');
      verifier(e.titres.length === 0, `colonne : aucune infobulle title (${JSON.stringify(e.titres)})`);
      await pc.screenshot({ path: join(CAPTURES, 'glisser-colonne.png') });
    }
  }
  await pc.mouse.up();
  await pause(600);
  e = await etat();
  verifier(e.texte === '' && !e.bloque, 'colonne, après le dépôt : sélection vide et blocage levé');

  // 3. Hors glisser : le texte reste sélectionnable dans la fiche de carte (champ de saisie) et la sélection n'est plus bloquée.
  await pc.getByTestId(`esport-cm-carte-${cartes[2].id}-tuile`).click();
  await pc.getByTestId('esport-cm-fiche-titre').waitFor();
  await pc.getByTestId('esport-cm-fiche-titre').click();
  await pc.keyboard.press('Control+A');
  const champ = await pc.evaluate(() => ({ texte: String(window.getSelection()), actif: document.activeElement?.tagName, sel: document.activeElement?.selectionEnd - document.activeElement?.selectionStart }));
  verifier(champ.sel > 0, `fiche de carte : texte du titre sélectionnable (${champ.sel} caractères)`);
  const style = await pc.evaluate(() => getComputedStyle(document.querySelector('[data-testid="esport-cm-fiche-titre"]')).userSelect);
  verifier(style !== 'none', `fiche de carte : user-select du champ = ${style}`);
} finally {
  await navigateur.close().catch(() => {});
  await esport.fermer?.().catch?.(() => {});
  await relais.fermer?.().catch?.(() => {});
  serveurSite.close();
}
console.log(echecs ? `${echecs} échec(s)` : 'Tout est vert');
process.exit(echecs ? 1 : 0);
