/**
 * Test de bout en bout du BOT Discord de l'Esport, sans Cloudflare ni vrai Discord : faux relais (le vrai
 * relais/worker.mjs), serveur Esport local (SQLite en mémoire) configuré avec une clé Ed25519 DE TEST générée
 * ici, et FAUX serveur Discord local (http) qui reçoit les messages du bot à la place de discord.com.
 *
 *  - PC (1440 × 900), le Fondateur : Réglages › Discord › « Lier un serveur Discord » affiche un code ; une
 *    interaction /esport-lier-serveur SIGNÉE (comme Discord) lie le serveur ; l'écran montre le salon ;
 *  - Léa lie son compte (code de l'API, /lier signé) ; l'écran montre « 1 compte lié » ;
 *  - Discord ID (migration 0015) : le Fondateur renseigne celui de Tom dans Esport › Membres (badge « Discord
 *    ID manquant » avant) ; un Propriétaire de team reçoit 403 en voulant le modifier ;
 *  - un scrim créé au planning arrive au faux Discord : embed, mention de Léa (liaison /lier, qui prime sur
 *    son Discord ID saisi) et de Tom (par son Discord ID), allowed_mentions strict, boutons RSVP ;
 *  - un clic « Oui » simulé et signé met à jour la présence : visible dans l'app (liste de présence du
 *    Fondateur), et l'annonce est rééditée chez le faux Discord avec les compteurs.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-esport-bot.mjs
 *
 * Variable : CAPTURES (dossier des captures, défaut docs/captures-esport-bot).
 */

import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ongletTeam } from './esport-navigation.mjs';
import { nouveauContexte, allerPageApplications, tuileApp } from './e2e-acceptation.mjs';
import { chargerPlaywright, demarrerRelais, deverrouiller, pause, premierLancement, racine } from './mobile-outils.mjs';

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-esport-bot');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-esport-bot-0123456789abcdef';
const PORT_RELAIS = 8831;
const PORT_ESPORT = 8832;
const PORT_DISCORD = 8833;
const PORT_SITE = 5293;
const MDP = 'mot-de-passe-esport-e2e-tres-long-43';
// Faux identifiants Discord fabriqués pour le test.
const APP = '424242424242424242';
const GUILD = '700000000000000001';
const SALON = '710000000000000001';
const ADMIN = '800000000000000009';
const LEA = '800000000000000001';
const LEA_CHAMP = '412345678901234560';
const TOM = '412345678901234561';
const log = (...a) => console.log('[e2e-esport-bot]', ...a);
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
const hexa = o => Buffer.from(o).toString('hex');

const { jetonDeProfil } = await import(pathToFileURL(join(racine, 'relais/worker.mjs')).href);
const { demarrerServeurEsport } = await import(pathToFileURL(join(racine, 'esport/outils/serveur-local.mjs')).href);

// ------------------------------------------------------------- Clé de test (jamais une vraie clé)
const paire = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const clePublique = hexa(await crypto.subtle.exportKey('raw', paire.publicKey));

// ------------------------------------------------------------- Faux Discord
const recus = [];
let numero = 0;
const fauxDiscord = http.createServer((req, res) => {
  const morceaux = [];
  req.on('data', m => morceaux.push(m));
  req.on('end', () => {
    const texte = Buffer.concat(morceaux).toString('utf8');
    recus.push({ methode: req.method, chemin: req.url, auth: req.headers.authorization, corps: texte ? JSON.parse(texte) : null });
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id: `9300000000000000${String(++numero).padStart(2, '0')}` }));
  });
});
await new Promise(ok => fauxDiscord.listen(PORT_DISCORD, '127.0.0.1', ok));
const versFauxDiscord = (url, init) => fetch(String(url).replace('https://discord.com', `http://127.0.0.1:${PORT_DISCORD}`), { ...init, redirect: 'manual' });

// ------------------------------------------------------------- Serveurs
const relais = await demarrerRelais(PORT_RELAIS, JETON);
const esport = await demarrerServeurEsport({ port: PORT_ESPORT, jetonDev: JETON, fetchDiscord: versFauxDiscord, discordBot: { applicationId: APP, publicKey: clePublique, jetonBot: 'jeton-bot-e2e-jamais-reel' }, lienApp: 'https://app.exemple/esport' });
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

async function api(chemin, jeton, { methode = 'GET', corps } = {}) {
  const r = await fetch(`${esport.url}${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}

/** Interaction comme Discord l'envoie : corps JSON signé (Ed25519) avec la clé de test. */
async function interaction(corps) {
  const texte = JSON.stringify(corps);
  const horodatage = String(Math.floor(Date.now() / 1000));
  const signature = hexa(await crypto.subtle.sign('Ed25519', paire.privateKey, new TextEncoder().encode(horodatage + texte)));
  const r = await fetch(`${esport.url}/discord/interactions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature-Ed25519': signature, 'X-Signature-Timestamp': horodatage }, body: texte });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}
const commande = (qui, nom, options, permissions = '0') =>
  interaction({ type: 2, id: '1', token: 'jeton-interaction', application_id: APP, guild_id: GUILD, channel_id: SALON, channel: { id: SALON, name: 'scrims' }, member: { user: { id: qui, username: 'e2e' }, permissions }, data: { name: nom, options: Object.entries(options).map(([name, value]) => ({ name, value })) } });
const texteDe = r => JSON.stringify(r.corps?.data ?? r.corps);

const attendre = async (condition, ms = 15_000) => {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await condition()) return true;
    await pause(150);
  }
  return false;
};

async function fermerPopups(page) {
  for (let i = 0; i < 3; i++) {
    const clique = await page.getByText(/^(Fermer|Terminé|Compris|Plus tard)$/).first().click({ timeout: 2000 }).then(() => true, () => false);
    if (!clique) break;
  }
}

const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
const pages = [];
try {
  // ================================================================ Mise en place (API)
  log('API : le Fondateur, la team « Faucons Valorant » (tous les modules), Léa (Joueur), Tom (Remplaçant)');
  const sessFond = (await api('/session', JETON, { methode: 'POST' })).corps.session;
  await api('/moi', sessFond, { methode: 'PUT', corps: { pseudo: 'Fondateur' } });
  const faucons = (await api('/teams', sessFond, { methode: 'POST', corps: { nom: 'Faucons Valorant', jeu: 'valorant', preset: 'valorant_complet' } })).corps.team;
  const roles = (await api(`/teams/${faucons.id}/roles`, sessFond)).corps.roles;
  const sessions = {};
  for (const [compte, pseudo, role] of [['lea12345', 'Léa', 'joueur'], ['tom12345', 'Tom', 'remplacant'], ['bob12345', 'Bob', 'proprietaire']]) {
    sessions[compte] = (await api('/session', await jetonDeProfil(JETON, compte), { methode: 'POST' })).corps.session;
    await api('/moi', sessions[compte], { methode: 'PUT', corps: { pseudo } });
    await api(`/teams/${faucons.id}/membres`, sessFond, { methode: 'POST', corps: { compte, roleId: roles.find(r => r.cle === role).id } });
  }
  verifier((await api('/sante')).corps?.bot === true, '/sante : bot configuré');

  // ================================================================ PC : lier le serveur
  log('PC : Réglages › Discord › Lier un serveur Discord');
  const ctxPc = await nouveauContexte(navigateur, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const pc = await ctxPc.newPage();
  pages.push(['PC', pc]);
  pc.on('pageerror', e => log('erreur page :', e.message));
  const secret = await premierLancement(pc, { site: siteAvec.url, code: relais.code, motDePasse: MDP });
  await pc.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(pc, MDP, secret));
  await fermerPopups(pc);
  await allerPageApplications(pc);
  await tuileApp(pc, 'esport').first().click({ timeout: 30_000 });
  await pc.getByTestId('esport-team-faucons-valorant').click({ timeout: 30_000 });
  await ongletTeam(pc, 'module-discord');
  await pc.getByTestId('esport-bot').waitFor({ timeout: 20_000 });
  verifier((await pc.getByTestId('esport-bot-inviter').count()) === 1, 'bouton « Inviter le bot sur un serveur »');
  await pc.getByTestId('esport-bot-lier').click();
  const code = (await pc.getByTestId('esport-bot-code-code').innerText({ timeout: 20_000 })).trim();
  verifier(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code), `code de liaison affiché (${code})`);
  await capture(pc, '01-pc-code-serveur');
  const liaison = await commande(ADMIN, 'esport-lier-serveur', { code }, '8');
  verifier(liaison.statut === 200 && /Serveur lié/.test(texteDe(liaison)), '/esport-lier-serveur signé : serveur lié');
  verifier((await interaction({ type: 1 })).corps?.type === 1, 'PING → PONG');
  const faux = await fetch(`${esport.url}/discord/interactions`, { method: 'POST', headers: { 'X-Signature-Ed25519': '00'.repeat(64), 'X-Signature-Timestamp': String(Math.floor(Date.now() / 1000)) }, body: '{"type":1}' });
  verifier(faux.status === 401, 'signature invalide : 401');

  // ================================================================ Léa lie son compte
  log('Léa : Lier mon Discord (code), /lier signé');
  const codeLea = (await api('/moi/discord/code', sessions.lea12345, { methode: 'POST' })).corps.code;
  verifier(/Compte lié/.test(texteDe(await commande(LEA, 'lier', { code: codeLea }))), '/lier : compte de Léa lié');
  verifier(/Lie ton compte avec \/lier/.test(texteDe(await commande('800000000000000077', 'prochain', {}))), 'un compte Discord non lié est renvoyé vers /lier');
  await ongletTeam(pc, 'accueil');
  await ongletTeam(pc, 'module-discord');
  await pc.getByTestId('esport-bot-serveur').waitFor({ timeout: 20_000 });
  verifier((await pc.getByTestId('esport-bot-serveur').innerText()).includes('#scrims'), 'écran : salon des annonces « #scrims »');
  verifier(/Comptes Discord liés : 1 \//.test(await pc.getByTestId('esport-bot-comptes').innerText()), 'écran : 1 compte lié (Léa)');
  await capture(pc, '02-pc-bot-lie');

  // ================================================================ Discord ID : le Fondateur seul
  log('PC : Esport › Membres, le Fondateur renseigne le Discord ID de Tom (badge « manquant » avant)');
  verifier((await api('/comptes/tom12345/discord-id', sessions.bob12345, { methode: 'PUT', corps: { discordId: TOM } })).statut === 403, 'un Propriétaire de team ne peut PAS modifier un Discord ID (403)');
  verifier((await api('/comptes/lea12345/discord-id', sessions.lea12345, { methode: 'PUT', corps: { discordId: LEA_CHAMP } })).statut === 403, 'le membre lui-même non plus (403)');
  verifier((await api('/comptes/lea12345/discord-id', sessFond, { methode: 'PUT', corps: { discordId: LEA_CHAMP } })).statut === 200, 'le Fondateur pose un Discord ID à Léa (sa liaison /lier primera)');
  await pc.getByTestId('esport-nav-membres').click({ timeout: 20_000 });
  await pc.getByTestId('esport-discord-manquant-tom12345').waitFor({ timeout: 20_000 });
  verifier(true, 'Membres : Tom porte le badge « Discord ID manquant »');
  await pc.getByTestId('esport-membres-statut-sansdiscord').click();
  verifier((await pc.getByTestId('esport-compte-lea12345').count()) === 0 && (await pc.getByTestId('esport-compte-tom12345').count()) === 1, 'filtre « Discord ID manquant » : Tom, pas Léa');
  await pc.getByLabel('Gérer Tom').click();
  await pc.getByTestId('esport-discord-id-modifier-tom12345').click();
  await pc.getByTestId('esport-discord-id-champ-tom12345').fill(TOM);
  await capture(pc, '02b-pc-discord-id-tom');
  await pc.getByTestId('esport-discord-id-enregistrer-tom12345').click();
  await attendre(async () => (await pc.getByTestId('esport-discord-manquant-tom12345').count()) === 0);
  verifier((await esport.base.premier("SELECT discord_id FROM comptes WHERE id = 'tom12345'", []))?.discord_id === TOM, 'serveur : Discord ID de Tom enregistré');
  await pc.getByTestId('esport-membres-statut-tous').click();
  await pc.getByTestId('esport-nav-teams').click({ timeout: 10_000 });
  await pc.getByTestId('esport-team-faucons-valorant').click({ timeout: 20_000 });
  await pc.getByTestId('esport-barre').waitFor({ timeout: 20_000 });

  // ================================================================ Annonce d'un scrim
  log('API : un scrim est créé, l’annonce part au faux Discord');
  const jour = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const ev = await api(`/teams/${faucons.id}/planning`, sessFond, { methode: 'POST', corps: { type: 'scrim', titre: 'Scrim @everyone vs Nova', date: jour, heureDebut: '20:30', heureFin: '22:00', lieu: 'Ascent' } });
  verifier(ev.statut === 200, 'scrim créé');
  verifier(await attendre(() => recus.some(r => r.methode === 'POST' && r.chemin === `/api/v10/channels/${SALON}/messages`)), 'le faux Discord a reçu l’annonce dans le salon lié');
  const annonce = recus.find(r => r.methode === 'POST' && r.chemin === `/api/v10/channels/${SALON}/messages`);
  verifier(annonce?.auth === 'Bot jeton-bot-e2e-jamais-reel', 'API du bot (jeton du bot)');
  const mentions = (annonce?.corps.content ?? '').split(' ').sort();
  verifier(JSON.stringify(mentions) === JSON.stringify([`<@${LEA}>`, `<@${TOM}>`].sort()), `convoqués pingués : Léa par /lier (pas son ID saisi), Tom par son Discord ID (${annonce?.corps.content})`);
  verifier(!String(annonce?.corps.content).includes(LEA_CHAMP), 'la liaison /lier vérifiée prime sur le Discord ID saisi');
  verifier(JSON.stringify([...(annonce?.corps.allowed_mentions?.users ?? [])].sort()) === JSON.stringify([LEA, TOM].sort()) && JSON.stringify(annonce?.corps.allowed_mentions?.parse) === '[]', 'allowed_mentions : exactement Léa et Tom');
  const embed = annonce?.corps.embeds?.[0];
  verifier(embed?.title?.startsWith('⚔️ Scrim · Scrim') && !/@everyone/.test(embed.title), 'embed : titre du scrim, @everyone neutralisé');
  verifier(embed?.color === 0x7c3aed, 'embed : couleur du scrim');
  const boutons = annonce?.corps.components?.[0]?.components ?? [];
  verifier(boutons.map(b => b.style).join(',') === '3,2,4,5', 'boutons : Oui (vert), Peut-être (gris), Non (rouge), lien');

  // ================================================================ Clic « Oui » signé
  log('Discord : Léa clique « Oui » (interaction signée)');
  const clic = await interaction({ type: 3, id: '2', token: 'jeton-clic', application_id: APP, guild_id: GUILD, channel_id: SALON, member: { user: { id: LEA, username: 'lea' }, permissions: '0' }, data: { custom_id: boutons[0].custom_id, component_type: 2 } });
  verifier(/C’est noté/.test(texteDe(clic)) && clic.corps.data.flags === 64, 'réponse éphémère « C’est noté »');
  verifier(await attendre(() => recus.some(r => r.methode === 'PATCH' && r.chemin.startsWith(`/api/v10/channels/${SALON}/messages/`))), 'l’annonce est rééditée (pas de nouveau message)');
  const edition = recus.filter(r => r.methode === 'PATCH').at(-1);
  verifier(/✅ \*\*1\*\* Oui/.test(JSON.stringify(edition?.corps.embeds)), 'annonce rééditée : ✅ 1 Oui');

  // Visible dans l'app : liste de présence du Fondateur.
  await ongletTeam(pc, 'module-planning');
  await pc.getByTestId('esport-planning-vue-liste').click({ timeout: 20_000 }).catch(() => undefined);
  await pc.getByTestId('esport-planning-liste').waitFor({ timeout: 20_000 });
  await pc.getByTestId(`esport-occ-${ev.corps.id.slice(0, 8)}-${jour}-ouvrir`).click({ timeout: 20_000 });
  await pc.getByTestId('esport-presence-lea12345').waitFor({ timeout: 20_000 });
  verifier((await pc.getByTestId('esport-presence-lea12345').innerText()).includes('Réponse : Oui'), 'app : la réponse « Oui » de Léa est visible dans la présence');
  await capture(pc, '03-pc-presence-oui');
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
console.log(echecs === 0 ? 'e2e Esport (bot Discord) : tout est bon' : `e2e Esport (bot Discord) : ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
