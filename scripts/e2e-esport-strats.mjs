/**
 * Test de bout en bout de l'Esport, phase 6 (éditeur de strats et playbook), sans Cloudflare ni
 * réseau réel : faux relais (le vrai relais/worker.mjs), serveur Esport local (SQLite en mémoire,
 * stockage mémoire pour les miniatures) et FAUX valorant-api.com local (JSON des cartes et agents,
 * images PNG générées) vers lequel le navigateur est redirigé (aucune requête ne sort).
 *
 * PC (1440 × 900), le Fondateur : team « Faucons Valorant » (API) ; onglet Strats ; nouvelle strat
 * sur Ascent (carte du faux valorant-api.com) ; un agent (Omen) et sa smoke (zone cercle) posés,
 * une flèche dessinée, une étape ajoutée ; enregistrer ; recharger la page et rouvrir la strat ;
 * exporter un PNG ; l'ajouter au playbook ; filtrer le playbook ; valider l'entrée. Puis : lien de
 * lecture seule (page publique) révoqué, et repli générique quand valorant-api.com est en panne.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-esport-strats.mjs
 *
 * Variable : CAPTURES (dossier des captures, défaut docs/captures-esport-strats).
 */

import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { ongletTeam } from './esport-navigation.mjs';
import { nouveauContexte, allerPageApplications, tuileApp } from './e2e-acceptation.mjs';
import { chargerPlaywright, demarrerRelais, deverrouiller, pause, premierLancement, racine } from './mobile-outils.mjs';

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-esport-strats');
mkdirSync(CAPTURES, { recursive: true });
const TELECHARGEMENTS = mkdtempSync(join(tmpdir(), 'e2e-strats-'));
const JETON = 'jeton-e2e-esport-strats-0123456789abcdef';
const PORT_RELAIS = 8831;
const PORT_ESPORT = 8832;
const PORT_VALORANT = 8833;
const PORT_SITE = 5293;
const MDP = 'mot-de-passe-esport-e2e-tres-long-44';
const log = (...a) => console.log('[e2e-esport-strats]', ...a);
let echecs = 0;
const verifier = (ok, message) => {
  console.log(ok ? '  OK   ' : '  ECHEC', message);
  if (!ok) echecs++;
};
const capture = async (page, nom) => {
  await pause(700);
  await page.screenshot({ path: join(CAPTURES, `${nom}.jpg`), type: 'jpeg', quality: 70 });
  log(`capture ${nom}`);
};

const { jetonDeProfil } = await import(pathToFileURL(join(racine, 'relais/worker.mjs')).href);
const { demarrerServeurEsport } = await import(pathToFileURL(join(racine, 'esport/outils/serveur-local.mjs')).href);

// ------------------------------------------------------------- Faux valorant-api.com
/** PNG plein (une couleur, un carré clair au centre), généré sans dépendance. */
function png(taille, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = octets => {
    let c = 0xffffffff;
    for (const o of octets) c = crcTable[(c ^ o) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const bloc = (type, donnees) => {
    const t = Buffer.from(type, 'ascii');
    const longueur = Buffer.alloc(4);
    longueur.writeUInt32BE(donnees.length);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(Buffer.concat([t, donnees])));
    return Buffer.concat([longueur, t, donnees, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(taille, 0);
  ihdr.writeUInt32BE(taille, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const lignes = [];
  for (let y = 0; y < taille; y++) {
    const ligne = [0];
    for (let x = 0; x < taille; x++) {
      const centre = Math.abs(x - taille / 2) < taille / 6 && Math.abs(y - taille / 2) < taille / 6;
      ligne.push(...(centre ? [240, 240, 240] : [r, g, b]));
    }
    lignes.push(Buffer.from(ligne));
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloc('IHDR', ihdr), bloc('IDAT', deflateSync(Buffer.concat(lignes))), bloc('IEND', Buffer.alloc(0))]);
}
const CDN = 'https://media.valorant-api.com';
const IMAGES = {
  '/maps/ascent/displayicon.png': png(256, [70, 90, 120]),
  '/maps/bind/displayicon.png': png(256, [120, 90, 70]),
  '/agents/omen/displayicon.png': png(64, [60, 40, 120]),
  '/agents/jett/displayicon.png': png(64, [120, 180, 220]),
  '/agents/omen/abilities/ability2/displayicon.png': png(32, [90, 60, 160]),
};
const CARTES = {
  status: 200,
  data: [
    { uuid: 'a', displayName: 'Ascent', displayIcon: `${CDN}/maps/ascent/displayicon.png`, tacticalDescription: 'A/B Sites' },
    { uuid: 'b', displayName: 'Bind', displayIcon: `${CDN}/maps/bind/displayicon.png`, tacticalDescription: 'A/B Sites' },
    { uuid: 'r', displayName: 'The Range', displayIcon: null, tacticalDescription: null },
  ],
};
const AGENTS = {
  status: 200,
  data: [
    {
      displayName: 'Omen',
      isPlayableCharacter: true,
      displayIcon: `${CDN}/agents/omen/displayicon.png`,
      role: { displayName: 'Contrôleur' },
      abilities: [
        { slot: 'Grenade', displayName: 'Pas ténébreux', displayIcon: null },
        { slot: 'Ability1', displayName: 'Paranoïa', displayIcon: null },
        { slot: 'Ability2', displayName: 'Voile sombre', displayIcon: `${CDN}/agents/omen/abilities/ability2/displayicon.png` },
        { slot: 'Ultimate', displayName: 'Depuis les ombres', displayIcon: null },
      ],
    },
    { displayName: 'Jett', isPlayableCharacter: true, displayIcon: `${CDN}/agents/jett/displayicon.png`, role: { displayName: 'Duelliste' }, abilities: [] },
  ],
};
const appelsValorant = [];
let valorantEnPanne = false;
const fauxValorant = http.createServer((req, res) => {
  appelsValorant.push(req.url);
  const entetes = { 'Access-Control-Allow-Origin': '*' };
  if (valorantEnPanne) return res.writeHead(503, entetes).end();
  const chemin = new URL(req.url, 'http://x').pathname;
  if (chemin === '/v1/maps') return res.writeHead(200, { ...entetes, 'Content-Type': 'application/json' }).end(JSON.stringify(CARTES));
  if (chemin === '/v1/agents') return res.writeHead(200, { ...entetes, 'Content-Type': 'application/json' }).end(JSON.stringify(AGENTS));
  const image = IMAGES[chemin.replace(/^\/media/, '')];
  if (image) return res.writeHead(200, { ...entetes, 'Content-Type': 'image/png' }).end(image);
  res.writeHead(404, entetes).end();
});
await new Promise(ok => fauxValorant.listen(PORT_VALORANT, '127.0.0.1', ok));

/** Toute requête du navigateur vers valorant-api.com part au faux serveur local ; rien d'autre ne sort. */
async function rediriger(contexte) {
  await contexte.route(/^https:\/\/(media\.)?valorant-api\.com\//, async route => {
    const u = new URL(route.request().url());
    const local = `http://127.0.0.1:${PORT_VALORANT}${u.hostname.startsWith('media.') ? '/media' : ''}${u.pathname}${u.search}`;
    const r = await fetch(local).catch(() => undefined);
    if (!r) return route.abort();
    await route.fulfill({ status: r.status, headers: Object.fromEntries(r.headers), body: Buffer.from(await r.arrayBuffer()) });
  });
}

// ------------------------------------------------------------- Serveurs
const relais = await demarrerRelais(PORT_RELAIS, JETON);
const esport = await demarrerServeurEsport({ port: PORT_ESPORT, jetonDev: JETON });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const fichiersSite = [];
function site(port) {
  const dist = join(racine, 'bureau/dist');
  if (!existsSync(join(dist, 'index.html'))) throw new Error('bureau/dist absent : lancez « npx vite build » d’abord');
  const serveur = http.createServer((req, res) => {
    const chemin = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    fichiersSite.push(chemin);
    if (chemin === '/relais.json') return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ relais: `https://localhost:${PORT_RELAIS}` }));
    if (chemin === '/esport.json') return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ esport: esport.url }));
    let fichier = join(dist, chemin);
    if (!existsSync(fichier) || statSync(fichier).isDirectory()) fichier = join(dist, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[extname(fichier)] ?? 'application/octet-stream' });
    createReadStream(fichier).pipe(res);
  });
  return new Promise(ok => serveur.listen(port, () => ok({ url: `http://localhost:${port}/`, fermer: () => serveur.close() })));
}
const siteAvec = await site(PORT_SITE);

async function fermerPopups(page) {
  for (let i = 0; i < 3; i++) {
    const clique = await page.getByText(/^(Fermer|Terminé|Compris|Plus tard)$/).first().click({ timeout: 2000 }).then(() => true, () => false);
    if (!clique) break;
  }
}

const pages = [];
const secrets = new Map();
const requetesExternes = [];
async function compte(contexte, url, code, nom) {
  const page = await contexte.newPage();
  pages.push([nom, page]);
  page.on('pageerror', e => log(`erreur page (${nom}) :`, e.message));
  page.on('request', r => {
    const u = new URL(r.url());
    if (!['localhost', '127.0.0.1'].includes(u.hostname) && !u.hostname.endsWith('valorant-api.com') && !['data:', 'blob:'].includes(u.protocol)) requetesExternes.push(r.url());
  });
  const secret = await premierLancement(page, { site: url, code, motDePasse: MDP });
  secrets.set(page, secret);
  await page.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(page, MDP, secret));
  await fermerPopups(page);
  return page;
}

async function api(chemin, jeton, { methode = 'GET', corps } = {}) {
  const r = await fetch(`${esport.url}${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}

/** Ouvre l'onglet d'un module de la team « Faucons Valorant ». */
async function allerModule(page, cle) {
  if (!(await page.getByTestId('esport-team').isVisible().catch(() => false))) {
    await allerPageApplications(page);
    const tuile = tuileApp(page, 'esport').first();
    await tuile.waitFor({ timeout: 30_000 });
    await tuile.click();
    await page.getByTestId('app-esport').waitFor({ timeout: 20_000 });
    await page.getByTestId('esport-team-faucons-valorant').waitFor({ timeout: 30_000 });
    await page.getByTestId('esport-team-faucons-valorant').click();
  }
  await ongletTeam(page, `module-${cle}`);
}

/** Point du canevas en coordonnées du document (carré de 1000) → coordonnées de la page. */
async function point(page, x, y) {
  const boite = await page.getByTestId('esport-canevas').boundingBox();
  return { x: boite.x + (x / 1000) * boite.width, y: boite.y + (y / 1000) * boite.height };
}

const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
try {
  // ================================================================ Mise en place (API)
  log('API : le Fondateur, la team « Faucons Valorant » (tous les modules), un Joueur');
  const sessFond = (await api('/session', JETON, { methode: 'POST' })).corps.session;
  await api('/moi', sessFond, { methode: 'PUT', corps: { pseudo: 'Fondateur' } });
  const faucons = (await api('/teams', sessFond, { methode: 'POST', corps: { nom: 'Faucons Valorant', jeu: 'valorant', preset: 'valorant_complet' } })).corps.team;
  const roles = (await api(`/teams/${faucons.id}/roles`, sessFond)).corps.roles;
  const sessLea = (await api('/session', await jetonDeProfil(JETON, 'lea12345'), { methode: 'POST' })).corps.session;
  await api('/moi', sessLea, { methode: 'PUT', corps: { pseudo: 'Léa' } });
  // Invitation directe (sans code) : le Fondateur ajoute le compte de Léa à la team.
  await api(`/teams/${faucons.id}/membres`, sessFond, { methode: 'POST', corps: { compte: 'lea12345', roleId: roles.find(r => r.cle === 'joueur').id } });

  // ================================================================ PC : créer une strat
  const ctxPc = await nouveauContexte(navigateur, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true, acceptDownloads: true });
  await rediriger(ctxPc);
  const pc = await compte(ctxPc, siteAvec.url, relais.code, 'PC');
  verifier(!fichiersSite.some(f => /CanevasStrat/.test(f)), 'Konva n’est pas chargé au démarrage du site');
  log('PC : onglet Strats, nouvelle strat');
  await allerModule(pc, 'strat_editor');
  await pc.getByTestId('esport-strats').waitFor({ timeout: 20_000 });
  await pc.getByTestId('esport-strats-nouvelle').click();
  await pc.getByTestId('esport-strats-titre').fill('Exécution A (split)');
  await pc.getByTestId('esport-strats-carte-ascent').click();
  await pc.getByTestId('esport-strats-side-attaque').click();
  await pc.getByTestId('esport-strats-type-execute').click();
  await pc.getByTestId('esport-strats-tags').fill('A, split');
  await pc.getByTestId('esport-strats-creer').click();
  await pc.getByTestId('esport-editeur').waitFor({ timeout: 20_000 });
  await pc.locator('[data-testid="esport-canevas"] canvas').first().waitFor({ timeout: 30_000 });
  verifier(fichiersSite.some(f => /CanevasStrat/.test(f)), 'Konva chargé à la demande (morceau séparé) à l’ouverture de l’éditeur');
  verifier(appelsValorant.some(u => u.startsWith('/v1/maps')) && appelsValorant.some(u => u.startsWith('/v1/agents')), 'cartes et agents lus sur le (faux) valorant-api.com');
  verifier(await pc.getByTestId('esport-mention-riot').first().isVisible(), 'mention Riot « Legal Jibber Jabber » affichée dans l’éditeur');

  log('PC : poser un agent et sa smoke, dessiner une flèche, ajouter une étape');
  await pc.getByTestId('esport-outil-agent').click();
  await pc.getByTestId('esport-agent-omen').click();
  let p = await point(pc, 300, 650);
  await pc.mouse.click(p.x, p.y);
  await pc.getByTestId('esport-outil-capacite').click();
  await pc.getByTestId('esport-capacite-Ability2').click();
  await pc.getByTestId('esport-zone-cercle').click();
  p = await point(pc, 420, 330);
  await pc.mouse.click(p.x, p.y);
  await pc.getByTestId('esport-outil-fleche').click();
  const depart = await point(pc, 300, 650);
  await pc.mouse.move(depart.x, depart.y);
  await pc.mouse.down();
  for (const [x, y] of [[330, 580], [360, 500], [400, 420], [420, 360]]) {
    const q = await point(pc, x, y);
    await pc.mouse.move(q.x, q.y, { steps: 4 });
  }
  await pc.mouse.up();
  await pc.getByTestId('esport-etape-titre').fill('Mise en place');
  await pc.getByTestId('esport-etape-note').fill('Smoke heaven, Omen joue le lurk.');
  // Annuler / rétablir au clavier sur la flèche.
  await pc.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => undefined);
  await pc.keyboard.press('Control+z');
  await pc.keyboard.press('Control+Shift+z');
  await pc.getByTestId('esport-etape-ajouter').click();
  verifier((await pc.getByTestId('esport-etape-position').innerText()).includes('Étape 2 / 2'), 'étape ajoutée (2 / 2)');
  await capture(pc, '01-pc-editeur-etape-2');
  await pc.getByTestId('esport-etape-precedente').click();
  await capture(pc, '02-pc-editeur-etape-1');
  await pc.getByTestId('esport-editeur-enregistrer').click();
  await pc.getByText(/Strat enregistrée \(version 2\)/).waitFor({ timeout: 20_000 });

  const liste = (await api(`/teams/${faucons.id}/strats`, sessFond)).corps.strats;
  const id = liste[0]?.id;
  const detail = (await api(`/teams/${faucons.id}/strats/${id}`, sessFond)).corps;
  const objets = detail.donnees?.etapes[0]?.objets ?? [];
  verifier(detail.donnees?.etapes.length === 2, 'serveur : deux étapes');
  verifier(objets.some(o => o.type === 'agent' && o.agent === 'omen' && o.icone === `${CDN}/agents/omen/displayicon.png`), 'serveur : agent Omen (icône Riot directe)');
  verifier(objets.some(o => o.type === 'capacite' && o.capacite === 'Ability2' && o.zone?.forme === 'cercle'), 'serveur : smoke (capacité, zone cercle)');
  verifier(objets.some(o => o.type === 'fleche' && o.points.length >= 4), 'serveur : flèche dessinée');
  verifier(detail.donnees?.etapes[0].note === 'Smoke heaven, Omen joue le lurk.', 'serveur : note de l’étape');
  verifier(detail.donnees?.carte.image === `${CDN}/maps/ascent/displayicon.png`, 'serveur : minimap d’Ascent en fond');
  verifier(Boolean(detail.miniature?.url), 'serveur : miniature stockée');
  const mini = detail.miniature ? await fetch(detail.miniature.url) : undefined;
  verifier(mini?.status === 200 && mini.headers.get('content-type') === 'image/jpeg', 'miniature lisible par son lien signé (JPEG)');

  // ================================================================ Recharger, rouvrir, exporter
  log('PC : recharger la page, rouvrir la strat, exporter un PNG');
  await pc.reload();
  await pc.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(pc, MDP, secrets.get(pc)));
  await fermerPopups(pc);
  await allerModule(pc, 'strat_editor');
  await pc.getByTestId(`esport-strat-${id}`).waitFor({ timeout: 20_000 });
  await capture(pc, '03-pc-strats-grille');
  await pc.getByTestId(`esport-strat-ouvrir-${id}`).click();
  await pc.locator('[data-testid="esport-canevas"] canvas').first().waitFor({ timeout: 30_000 });
  verifier((await pc.getByTestId('esport-etape-position').innerText()).includes('Étape 1 / 2'), 'rechargée : deux étapes');
  verifier((await pc.getByTestId('esport-etape-note').inputValue()) === 'Smoke heaven, Omen joue le lurk.', 'rechargée : note de l’étape');
  await pause(800);
  const [telechargement] = await Promise.all([pc.waitForEvent('download', { timeout: 20_000 }), pc.getByTestId('esport-editeur-png').click()]);
  const cheminPng = join(TELECHARGEMENTS, telechargement.suggestedFilename());
  await telechargement.saveAs(cheminPng);
  const octets = readFileSync(cheminPng);
  verifier(octets.subarray(1, 4).toString('ascii') === 'PNG' && /\.png$/.test(telechargement.suggestedFilename()), `PNG exporté (${telechargement.suggestedFilename()})`);
  verifier(octets.readUInt32BE(16) === 2000 && octets.readUInt32BE(20) === 2000, 'PNG de 2000 × 2000 (carte entière, ×2)');
  verifier(octets.length > 20_000, 'PNG non vide (carte et objets dessinés)');

  // ================================================================ Playbook
  log('PC : ajouter au playbook, filtrer, valider');
  await pc.getByTestId('esport-editeur-retour').click();
  // Actions secondaires de la carte : menu « ⋯ ».
  await pc.getByTestId(`esport-strat-actions-${id}`).click();
  await pc.getByTestId(`esport-strat-playbook-${id}`).click();
  await pc.getByTestId('esport-playbook').waitFor({ timeout: 20_000 });
  const entree = (await api(`/teams/${faucons.id}/playbook`, sessFond)).corps.entrees[0];
  await pc.getByTestId(`esport-playbook-entree-${entree.id}`).waitFor({ timeout: 20_000 });
  await api(`/teams/${faucons.id}/playbook`, sessFond, { methode: 'POST', corps: { titre: 'Protocole anti-éco', type: 'eco', carte: null, description: 'Stack B, pas de peek seul.' } });
  await pc.getByTestId('esport-playbook-filtre-type-execute').click();
  await pc.getByTestId('esport-playbook-compte').filter({ hasText: '1 entrée(s) sur 2' }).waitFor({ timeout: 20_000 });
  verifier(await pc.getByTestId(`esport-playbook-entree-${entree.id}`).isVisible(), 'filtre type « Exécution » : la strat');
  await pc.getByTestId('esport-playbook-filtre-type-eco').click();
  await pc.getByTestId(`esport-playbook-entree-${entree.id}`).waitFor({ state: 'detached', timeout: 20_000 });
  verifier(true, 'filtre type « Éco » : la strat disparaît');
  await pc.getByTestId('esport-playbook-filtre-type-defaut').click();
  await pc.getByTestId('esport-playbook-filtre-carte-ascent').click();
  await pc.getByTestId('esport-playbook-recherche').fill('split');
  await pc.getByTestId('esport-playbook-compte').filter({ hasText: '1 entrée(s) sur 2' }).waitFor({ timeout: 20_000 });
  verifier(await pc.getByTestId(`esport-playbook-entree-${entree.id}`).isVisible(), 'filtres combinés (carte Ascent + recherche) : la strat');
  await pc.getByTestId(`esport-playbook-valider-${entree.id}`).click();
  await pc.getByText(/Entrée validée/).waitFor({ timeout: 20_000 });
  verifier((await pc.getByTestId('esport-playbook-miniature').count()) === 1 && Boolean((await api(`/teams/${faucons.id}/playbook`, sessFond)).corps.entrees.find(e => e.id === entree.id)?.miniature), 'miniature de la strat dans la grille du playbook');
  await capture(pc, '04-pc-playbook');
  const notifsLea = (await api('/notifications', sessLea)).corps.liste.map(n => n.type);
  verifier(notifsLea.includes('playbook-valide'), 'le Joueur est prévenu de l’entrée validée');
  const journal = (await api(`/teams/${faucons.id}/journal`, sessFond)).corps.entrees.map(e => e.action);
  verifier(journal.includes('strat.created') && journal.includes('playbook.validated'), 'journal : strat créée, playbook validé');

  // ================================================================ Lien de lecture seule, puis révoqué
  log('Lien de lecture seule : page publique, puis révocation');
  const lien = (await api(`/teams/${faucons.id}/strats/${id}/partages`, sessFond, { methode: 'POST', corps: {} })).corps;
  const lecture = await ctxPc.newPage();
  await lecture.goto(lien.url);
  verifier((await lecture.locator('svg').count()) === 2 && (await lecture.content()).includes('Legal Jibber Jabber'), 'page publique : deux étapes en SVG, mention Riot');
  await capture(lecture, '05-lien-lecture-seule');
  await api(`/teams/${faucons.id}/strats/${id}/partages/${lien.id}`, sessFond, { methode: 'DELETE' });
  const apres = await lecture.goto(lien.url);
  verifier(apres?.status() === 404, 'lien révoqué : 404');
  await lecture.close();

  // ================================================================ iPad (tactile), hors ligne
  log('iPad (Safari, tactile) : valorant-api.com en panne, repli générique, un agent posé du doigt');
  valorantEnPanne = true;
  const ctxIpad = await nouveauContexte(navigateur, {
    viewport: { width: 1024, height: 1366 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  await rediriger(ctxIpad);
  const ipad = await compte(ctxIpad, siteAvec.url, relais.code, 'iPad');
  await allerModule(ipad, 'strat_editor');
  await ipad.getByTestId(`esport-strat-ouvrir-${id}`).tap();
  await ipad.locator('[data-testid="esport-canevas"] canvas').first().waitFor({ timeout: 30_000 });
  await ipad.getByTestId('esport-outil-agent').tap();
  verifier((await ipad.getByTestId('esport-agent-kay-o').count()) === 1, 'repli générique : agents de la liste intégrée');
  await ipad.getByTestId('esport-agent-kay-o').tap();
  await ipad.getByTestId('esport-canevas').scrollIntoViewIfNeeded();
  const doigt = await point(ipad, 700, 300);
  await ipad.touchscreen.tap(doigt.x, doigt.y);
  await ipad.getByTestId('esport-editeur-enregistrer').tap();
  await ipad.getByText(/Strat enregistrée/).waitFor({ timeout: 20_000 });
  const surIpad = (await api(`/teams/${faucons.id}/strats/${id}`, sessFond)).corps.donnees.etapes[0].objets;
  verifier(surIpad.some(o => o.type === 'agent' && o.agent === 'kay-o' && o.icone === null), 'iPad : agent posé au doigt (jeton générique, sans image)');
  const defile = await ipad.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  verifier(!defile, 'iPad : pas de défilement horizontal de la page');
  await capture(ipad, '06-ipad-repli-hors-ligne');
  valorantEnPanne = false;

  verifier(requetesExternes.length === 0, `aucune requête réseau réelle (${requetesExternes.slice(0, 3).join(', ')})`);
  const debord = await pc.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  verifier(!debord, 'PC : pas de défilement horizontal de la page');
} catch (e) {
  echecs++;
  console.error(e);
  for (const [nom, page] of pages) await page.screenshot({ path: join(CAPTURES, `echec-${nom}.jpg`), type: 'jpeg', quality: 60 }).catch(() => undefined);
} finally {
  await navigateur.close();
  siteAvec.fermer();
  relais.fermer();
  await esport.fermer();
  fauxValorant.closeAllConnections();
  fauxValorant.close();
}
console.log(echecs === 0 ? 'e2e Esport (strats et playbook) : tout est bon' : `e2e Esport (strats et playbook) : ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
