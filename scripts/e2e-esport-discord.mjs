/**
 * Test de bout en bout de l'Esport, phase 4 (notifications Discord), sans Cloudflare ni vrai
 * Discord : faux relais (le vrai relais/worker.mjs), serveur Esport local (SQLite en mémoire) et
 * FAUX serveur Discord local (http) qui reçoit les messages à la place de discord.com.
 *
 *  - PC (1440 × 900), le Fondateur : team « Faucons Valorant » (par l'API) ; onglet « Discord » ;
 *    saisie du webhook (champ masqué), affichage « …/abcd » sans jamais l'adresse ; message de test
 *    reçu par le faux Discord ; modèle et rôle d'une notification ;
 *  - un événement ajouté au planning (API) arrive au faux Discord avec le modèle et la mention de
 *    rôle ; un titre piégé (@everyone) est neutralisé ;
 *  - Discord en panne : l'envoi attend et le tableau « Derniers envois » le montre ;
 *  - un Joueur (API) reçoit 403 sur tout l'écran Discord ; l'adresse n'est ni dans la base en clair,
 *    ni dans le journal.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-esport-discord.mjs
 *
 * Variable : CAPTURES (dossier des captures, défaut docs/captures-esport-discord).
 */

import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ongletTeam } from './esport-navigation.mjs';
import { nouveauContexte, allerPageApplications, tuileApp } from './e2e-acceptation.mjs';
import { chargerPlaywright, demarrerRelais, deverrouiller, pause, premierLancement, racine } from './mobile-outils.mjs';

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-esport-discord');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-esport-discord-0123456789abcdef';
const PORT_RELAIS = 8821;
const PORT_ESPORT = 8822;
const PORT_DISCORD = 8823;
const PORT_SITE = 5292;
const MDP = 'mot-de-passe-esport-e2e-tres-long-43';
// Faux identifiant et faux jeton fabriqués pour le test : jamais une vraie adresse de webhook.
const ID_FAUX = '123456789012345678';
const JETON_FAUX = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcd';
const URL_FAUSSE = `https://discord.com/api/webhooks/${ID_FAUX}/${JETON_FAUX}`;
const ROLE = '555666777888999000';
const log = (...a) => console.log('[e2e-esport-discord]', ...a);
let echecs = 0;
const verifier = (ok, message) => {
  console.log(ok ? '  OK   ' : '  ECHEC', message);
  if (!ok) echecs++;
};
const capture = async (page, nom) => {
  await pause(600);
  await page.screenshot({ path: join(CAPTURES, `${nom}.jpg`), type: 'jpeg', quality: 70 });
  log(`capture ${nom}`);
};

const { jetonDeProfil } = await import(pathToFileURL(join(racine, 'relais/worker.mjs')).href);
const { demarrerServeurEsport } = await import(pathToFileURL(join(racine, 'esport/outils/serveur-local.mjs')).href);

// ------------------------------------------------------------- Faux Discord
const recus = [];
let discordEnPanne = false;
const fauxDiscord = http.createServer((req, res) => {
  const morceaux = [];
  req.on('data', m => morceaux.push(m));
  req.on('end', () => {
    if (discordEnPanne) {
      res.writeHead(503).end();
      return;
    }
    recus.push({ chemin: req.url, corps: JSON.parse(Buffer.concat(morceaux).toString('utf8')) });
    res.writeHead(204).end();
  });
});
await new Promise(ok => fauxDiscord.listen(PORT_DISCORD, '127.0.0.1', ok));
const versFauxDiscord = (url, init) => fetch(String(url).replace('https://discord.com', `http://127.0.0.1:${PORT_DISCORD}`), { ...init, redirect: 'manual' });

// ------------------------------------------------------------- Serveurs
const relais = await demarrerRelais(PORT_RELAIS, JETON);
const esport = await demarrerServeurEsport({ port: PORT_ESPORT, jetonDev: JETON, fetchDiscord: versFauxDiscord });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff' };
function site(port) {
  const dist = join(racine, 'bureau/dist');
  if (!existsSync(join(dist, 'index.html'))) throw new Error('bureau/dist absent : lancez « npx vite build » d’abord');
  const serveur = http.createServer((req, res) => {
    const chemin = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    if (chemin === '/relais.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ relais: `https://localhost:${PORT_RELAIS}` }));
      return;
    }
    if (chemin === '/esport.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ esport: esport.url }));
      return;
    }
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
async function compte(contexte, url, code, nom) {
  const page = await contexte.newPage();
  pages.push([nom, page]);
  page.on('pageerror', e => log(`erreur page (${nom}) :`, e.message));
  const secret = await premierLancement(page, { site: url, code, motDePasse: MDP });
  await page.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(page, MDP, secret));
  await fermerPopups(page);
  return page;
}

async function api(chemin, jeton, { methode = 'GET', corps } = {}) {
  const r = await fetch(`${esport.url}${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}
const attendre = async (condition, ms = 15_000) => {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await condition()) return true;
    await pause(150);
  }
  return false;
};

const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
try {
  // ================================================================ Mise en place (API)
  log('API : le Fondateur, la team « Faucons Valorant » (tous les modules), un Joueur');
  const sessFond = (await api('/session', JETON, { methode: 'POST' })).corps.session;
  await api('/moi', sessFond, { methode: 'PUT', corps: { pseudo: 'Fondateur' } });
  const faucons = (await api('/teams', sessFond, { methode: 'POST', corps: { nom: 'Faucons Valorant', jeu: 'valorant', preset: 'valorant_complet' } })).corps.team;
  const roles = (await api(`/teams/${faucons.id}/roles`, sessFond)).corps.roles;
  const jetonLea = await jetonDeProfil(JETON, 'lea12345');
  const sessLea = (await api('/session', jetonLea, { methode: 'POST' })).corps.session;
  await api('/moi', sessLea, { methode: 'PUT', corps: { pseudo: 'Léa' } });
  // Invitation directe (sans code) : le Fondateur ajoute le compte de Léa à la team.
  await api(`/teams/${faucons.id}/membres`, sessFond, { methode: 'POST', corps: { compte: 'lea12345', roleId: roles.find(r => r.cle === 'joueur').id } });

  // ================================================================ PC : écran Discord
  log('PC : onglet Discord de la team');
  const ctxPc = await nouveauContexte(navigateur, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const pc = await compte(ctxPc, siteAvec.url, relais.code, 'PC');
  await allerPageApplications(pc);
  const tuile = tuileApp(pc, 'esport').first();
  await tuile.waitFor({ timeout: 30_000 });
  await tuile.click();
  await pc.getByTestId('app-esport').waitFor({ timeout: 20_000 });
  await pc.getByTestId('esport-team-faucons-valorant').waitFor({ timeout: 30_000 });
  await pc.getByTestId('esport-team-faucons-valorant').click();
  await ongletTeam(pc, 'module-discord');
  await pc.getByTestId('esport-discord').waitFor({ timeout: 20_000 });
  verifier((await pc.getByTestId('esport-discord-masque').count()) === 0, 'aucun webhook au départ');
  verifier(await pc.getByTestId('esport-discord-test').isDisabled().catch(() => true), 'bouton de test inactif sans webhook');
  await capture(pc, '01-pc-discord-vide');

  // Webhook : saisie masquée, puis affichage masqué.
  verifier((await pc.getByTestId('esport-discord-url').getAttribute('type')) === 'password', 'champ de l’adresse : saisie masquée');
  await pc.getByTestId('esport-discord-url').fill(URL_FAUSSE);
  await pc.getByTestId('esport-discord-enregistrer').click();
  await pc.getByTestId('esport-discord-masque').waitFor({ timeout: 20_000 });
  const html = await pc.content();
  verifier((await pc.getByTestId('esport-discord-masque').innerText()).includes('…/abcd'), 'webhook affiché masqué « …/abcd »');
  verifier(!html.includes(JETON_FAUX) && !html.includes(ID_FAUX), 'la page ne contient ni le jeton ni l’identifiant du webhook');
  verifier((await pc.getByTestId('esport-discord-url').inputValue()) === '', 'le champ est vidé après l’enregistrement');

  // Message de test.
  await pc.getByTestId('esport-discord-test').click();
  await pc.getByTestId('esport-discord-avis').waitFor({ timeout: 20_000 });
  verifier(await attendre(() => recus.length === 1), 'le faux Discord a reçu le message de test');
  verifier(recus[0]?.chemin === `/api/webhooks/${ID_FAUX}/${JETON_FAUX}` && /Message de test/.test(JSON.stringify(recus[0]?.corps.embeds ?? '')), 'message de test au bon webhook');
  await capture(pc, '02-pc-discord-test-envoye');

  // Modèle et rôle de « Nouvel événement au planning ».
  await pc.getByTestId('esport-discord-ouvrir-event_created').click();
  await pc.getByTestId('esport-discord-modele-event_created').fill('Nouveau : {titre} ({type}), {date} à {heure}');
  await pc.getByTestId('esport-discord-role-event_created').fill(ROLE);
  await pc.getByTestId('esport-discord-enregistrer-event_created').click();
  await pc.getByText(/« Nouvel événement au planning » enregistré/).waitFor({ timeout: 20_000 });
  verifier((await pc.getByTestId('esport-discord-apercu-event_created').innerText()).includes('Scrim contre les Faucons'), 'aperçu du message');
  await capture(pc, '03-pc-discord-reglage');

  // Rôle refusé.
  await pc.getByTestId('esport-discord-role-event_created').fill('1234');
  await pc.getByTestId('esport-discord-enregistrer-event_created').click();
  await pc.getByTestId('esport-discord-erreur').waitFor({ timeout: 20_000 });
  verifier(/identifiant numérique/.test(await pc.getByTestId('esport-discord-erreur').innerText()), 'rôle invalide : erreur lisible');
  await pc.getByTestId('esport-discord-role-event_created').fill(ROLE);
  await pc.getByTestId('esport-discord-enregistrer-event_created').click();
  await pc.getByTestId('esport-discord-erreur').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => undefined);

  // ================================================================ Un événement du planning part vers Discord
  log('API : un événement du planning arrive au faux Discord');
  const ev = await api(`/teams/${faucons.id}/planning`, sessFond, { methode: 'POST', corps: { type: 'scrim', titre: 'Scrim @everyone Faucons', date: '2026-12-10', heureDebut: '20:30', heureFin: '22:00' } });
  verifier(ev.statut === 200, 'événement créé');
  verifier(await attendre(() => recus.length === 2), 'le faux Discord a reçu le message de l’événement');
  const m = recus[1]?.corps;
  const description = m?.embeds?.[0]?.description ?? '';
  verifier(Boolean(m) && m.content === `<@&${ROLE}>` && description.startsWith('Nouveau : Scrim') && /à 20:30$/.test(description), 'embed avec le modèle personnalisé, mention du rôle configuré');
  verifier(!/@everyone/.test(JSON.stringify(m ?? {})), '« @everyone » du titre neutralisé');
  verifier(m?.embeds?.[0]?.color === 0x7c3aed && /^⚔️ Scrim/.test(m?.embeds?.[0]?.title ?? ''), 'embed : couleur et emoji du scrim');
  verifier(JSON.stringify(m?.allowed_mentions) === JSON.stringify({ parse: [], roles: [ROLE] }), 'seule la mention du rôle est autorisée');

  // ================================================================ Discord en panne
  log('Discord en panne : le message attend');
  discordEnPanne = true;
  await api(`/teams/${faucons.id}/planning`, sessFond, { methode: 'POST', corps: { type: 'training', titre: 'Entraînement du soir', date: '2026-12-11', heureDebut: '19:00', heureFin: '21:00' } });
  verifier(await attendre(async () => (await esport.base.premier("SELECT COUNT(*) AS n FROM discord_file WHERE statut = 'attente'", [])).n === 1), 'message en attente (essai 1)');
  await ongletTeam(pc, 'accueil');
  await ongletTeam(pc, 'module-discord');
  await pc.getByTestId('esport-discord-envoi').first().waitFor({ timeout: 20_000 });
  verifier(/En attente \(essai 1\)/.test(await pc.getByTestId('esport-discord-envois').innerText()), 'écran : « En attente (essai 1) »');
  await capture(pc, '04-pc-discord-envois');
  discordEnPanne = false;

  // ================================================================ Permissions et secret
  log('API : permissions et secret');
  for (const [methode, chemin, corps] of [
    ['GET', `/teams/${faucons.id}/discord`],
    ['PUT', `/teams/${faucons.id}/discord/webhook`, { url: URL_FAUSSE }],
    ['POST', `/teams/${faucons.id}/discord/test`],
  ]) {
    const r = await api(chemin, sessLea, { methode, corps });
    verifier(r.statut === 403, `Joueur : ${methode} ${chemin.replace(faucons.id, ':team')} refusé (403)`);
  }
  const ligne = await esport.base.premier('SELECT url_chiffree FROM discord_webhooks WHERE team_id = ?', [faucons.id]);
  verifier(Boolean(ligne) && !ligne.url_chiffree.includes(JETON_FAUX) && ligne.url_chiffree.startsWith('dw1.'), 'base : adresse chiffrée au repos');
  const journal = JSON.stringify(await esport.base.tous('SELECT * FROM journal', []));
  verifier(!journal.includes(JETON_FAUX), 'journal : jamais l’adresse');
  const etat = await api(`/teams/${faucons.id}/discord`, sessFond);
  verifier(!JSON.stringify(etat.corps).includes(JETON_FAUX) && etat.corps.webhook.masque === '…/abcd', 'API : adresse jamais renvoyée en clair');
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
  fauxDiscord.closeAllConnections();
  fauxDiscord.close();
}
console.log(echecs === 0 ? 'e2e Esport (Discord) : tout est bon' : `e2e Esport (Discord) : ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
