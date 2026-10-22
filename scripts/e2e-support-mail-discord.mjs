/**
 * Test de bout en bout : support → Discord, réponse du Fondateur, e-mails envoyés par le serveur.
 *
 * Tout tourne en local, sans vrai Discord, sans vrai serveur de messagerie :
 *  - le VRAI relais en serveur Node (relais/serveur/app.mjs, comme chez o2switch) avec sa boîte dans
 *    PostgreSQL (schéma de test neuf) et le VRAI transport SMTP (nodemailer) ;
 *  - un FAUX Discord local (http) : le relais y poste à la place de discord.com (embed, pièce jointe
 *    multipart, fil d'un salon forum, réponse dans le fil) ;
 *  - un FAUX serveur SMTP local (relais/test-smtp/faux-smtp.mjs) qui garde les e-mails reçus.
 *
 * Parcours :
 *  1. PC, le Fondateur crée le compte de Léa (Administration, avec son adresse) : l'invitation part
 *     DIRECTEMENT par e-mail (modèle HTML, bouton, lien) ; aucune adresse en clair sur le serveur ;
 *  2. Léa ouvre le lien REÇU PAR E-MAIL, choisit son mot de passe, puis envoie une demande de support
 *     (Bug, titre, message riche, capture) : le faux Discord reçoit un embed soigné et la capture ;
 *  3. le Fondateur répond depuis Administration › Support (case « par e-mail » cochée) : la réponse
 *     part dans le fil Discord de la demande et par e-mail ;
 *  4. Léa rouvre le Support : notification « Nouvelle réponse », conversation, statut « Répondu » ;
 *  5. Administration › Messagerie : e-mail libre à Léa, historique « Envoyé ».
 *
 *   npx vite build
 *   ESPORT_TEST_PG=postgres://esport_test:esport_test@127.0.0.1:5432/esport_test \
 *     PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-support-mail-discord.mjs
 *
 * Variable : CAPTURES (dossier des captures, défaut docs/captures-support-mail-discord).
 */

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { allerPageAdministration, nouveauContexte } from './e2e-acceptation.mjs';
import { chargerPlaywright, deverrouiller, pause, premierLancement, racine, totp } from './mobile-outils.mjs';

const URL_PG = process.env.ESPORT_TEST_PG || process.env.RELAIS_TEST_PG;
if (!URL_PG) {
  console.error('ESPORT_TEST_PG absent : adresse postgres://… d’une base de test (voir l’en-tête).');
  process.exit(2);
}
const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-support-mail-discord');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-support-mail-0123456789abcdef';
const PORT_RELAIS = 8851;
const PORT_DISCORD = 8852;
const PORT_SITE = 5295;
const MDP = 'mot-de-passe-support-e2e-tres-long-44';
const MDP_LEA = 'Été à Biarritz 2026 !';
const WEBHOOK = 'https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
const SITE = `http://localhost:${PORT_SITE}/`;
const log = (...a) => console.log('[e2e-support-mail]', ...a);
let echecs = 0;
const verifier = (ok, message) => {
  console.log(ok ? '  OK   ' : '  ECHEC', message);
  if (!ok) echecs++;
};
const capture = async (page, nom) => {
  await pause(500);
  await page.screenshot({ path: join(CAPTURES, `${nom}.jpg`), type: 'jpeg', quality: 70 });
  log(`capture ${nom}`);
};
const attendre = async (condition, ms = 30_000) => {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await condition()) return true;
    await pause(200);
  }
  return false;
};

const { preparerRelais } = await import(pathToFileURL(join(racine, 'relais/serveur/app.mjs')).href);
const { basePostgres } = await import(pathToFileURL(join(racine, 'esport/adaptateurs/postgres.mjs')).href);
const { configSmtp } = await import(pathToFileURL(join(racine, 'esport/serveur/courriel-smtp.mjs')).href);
const { decoderMessage, fauxSmtp } = await import(pathToFileURL(join(racine, 'relais/test-smtp/faux-smtp.mjs')).href);

// ------------------------------------------------------------- Faux Discord (salon forum)
const discord = [];
let n = 0;
const fauxDiscord = http.createServer(async (req, res) => {
  const morceaux = [];
  for await (const m of req) morceaux.push(m);
  const corps = Buffer.concat(morceaux);
  const url = new URL(req.url, 'http://x');
  let charge = {};
  let fichier;
  if (/multipart\/form-data/.test(req.headers['content-type'] ?? '')) {
    const form = await new Request('http://x', { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body: corps }).formData();
    charge = JSON.parse(form.get('payload_json'));
    const f = form.get('files[0]');
    fichier = f ? { nom: f.name, type: f.type, taille: f.size } : undefined;
  } else if (corps.length) {
    charge = JSON.parse(corps.toString('utf8'));
  }
  const fil = url.searchParams.get('thread_id');
  // Salon forum : sans thread_name ni thread_id, Discord refuse (220001).
  if (!fil && !charge.thread_name) {
    res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ code: 220001, message: 'Webhooks posted to forum channels must have a thread_name or thread_id' }));
    return;
  }
  n++;
  discord.push({ chemin: url.pathname, fil, attendre: url.searchParams.get('wait'), charge, fichier });
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id: `80000000000000000${n}`, channel_id: fil ?? `70000000000000000${n}` }));
});
await new Promise(ok => fauxDiscord.listen(PORT_DISCORD, '127.0.0.1', ok));
const fetchReel = globalThis.fetch;
globalThis.fetch = (url, init) => (String(url).startsWith('https://discord.com/') ? fetchReel(String(url).replace('https://discord.com', `http://127.0.0.1:${PORT_DISCORD}`), init) : fetchReel(url, init));

// ------------------------------------------------------------- Faux SMTP
const smtp = await fauxSmtp({ utilisateur: 'noreply@appdashboard.fr', motDePasse: 'mdp-smtp-e2e' });

// ------------------------------------------------------------- Relais Node + PostgreSQL (schéma neuf)
// Préfixe à part : les suites PostgreSQL (relais:tester:pg, esport:tester:pg) effacent tous les schémas « t_… » à la fin.
const schema = `e2e_support_${randomBytes(6).toString("hex")}`;
const admin = await basePostgres({ connexion: URL_PG, max: 1 });
await admin.script(`CREATE SCHEMA ${schema}`);
const base = await basePostgres({ connexion: URL_PG, schema, max: 4 });
const relais = await preparerRelais({
  base,
  config: { JETON, DISCORD_WEBHOOK_URL: WEBHOOK, LIEN_APP: 'https://appdashboard.fr', smtp: configSmtp(smtp.env), smtpManques: [], ORIGINES_SITE: SITE.replace(/\/$/, ''), baseConfiguree: true },
});
const dossier = mkdtempSync(join(tmpdir(), 'e2e-support-mail-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dossier, 'k.pem'), '-out', join(dossier, 'c.pem'), '-subj', '/CN=localhost', '-days', '1'], { stdio: 'ignore' });
const serveurRelais = https.createServer({ key: readFileSync(join(dossier, 'k.pem')), cert: readFileSync(join(dossier, 'c.pem')) }, async (req, res) => {
  const morceaux = [];
  for await (const m of req) morceaux.push(m);
  const requete = new Request(`https://localhost:${PORT_RELAIS}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(morceaux) });
  const reponse = await relais.traiter(requete);
  res.writeHead(reponse.status, Object.fromEntries(reponse.headers));
  res.end(Buffer.from(await reponse.arrayBuffer()));
});
await new Promise(ok => serveurRelais.listen(PORT_RELAIS, ok));
const base64url = t => Buffer.from(t).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const CODE = 'AB1.' + base64url(JSON.stringify({ r: `https://localhost:${PORT_RELAIS}`, j: JETON }));

// ------------------------------------------------------------- Site
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const dist = join(racine, 'bureau/dist');
if (!existsSync(join(dist, 'index.html'))) throw new Error('bureau/dist absent : lancez « npx vite build » d’abord');
const serveurSite = http.createServer((req, res) => {
  const chemin = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  if (chemin === '/relais.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ relais: `https://localhost:${PORT_RELAIS}` }));
    return;
  }
  let fichier = join(dist, chemin);
  if (!existsSync(fichier) || statSync(fichier).isDirectory()) fichier = join(dist, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[extname(fichier)] ?? 'application/octet-stream' });
  createReadStream(fichier).pipe(res);
});
await new Promise(ok => serveurSite.listen(PORT_SITE, ok));

// ------------------------------------------------------------- Aides
async function fermerPopups(page) {
  for (let i = 0; i < 3; i++) {
    const clique = await page.getByText(/^(Fermer|Terminé|Compris|Plus tard)$/).first().click({ timeout: 2000 }).then(() => true, () => false);
    if (!clique) break;
  }
}
async function confirmerIdentite(page) {
  if (!(await page.getByTestId('admin-identite-mdp').waitFor({ timeout: 8_000 }).then(() => true, () => false))) return;
  for (const decalage of [0, 1, -1]) {
    await page.getByTestId('admin-identite-mdp').fill(MDP);
    await page.getByTestId('admin-identite-code').fill(totp(page.secret, decalage));
    await page.getByTestId('admin-identite-valider').click();
    if (await page.getByTestId('admin-identite').waitFor({ state: 'detached', timeout: 15_000 }).then(() => true, () => false)) return;
  }
  throw new Error('vérification d’identité impossible');
}
async function ouvrirAdministration(page) {
  if (await page.getByTestId('app-administration').count()) return;
  await allerPageAdministration(page);
  await page.locator('[data-testid="cellule-administration"], [data-testid="tuile-administration"]').first().click();
  await page.getByTestId('app-administration').waitFor({ timeout: 20_000 });
  await confirmerIdentite(page);
}
const boite = async () => (await base.tous('SELECT cle, valeur FROM relais_kv', [])).map(l => `${l.cle}=${l.valeur}`).join('\n');
// Petite image PNG valide (1 × 1).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const pages = [];
const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
try {
  // ================================================================ 1. PC : compte de Léa, invitation par e-mail
  log('PC : coffre du Fondateur relié au relais (jeton maître)');
  const pc = await (await nouveauContexte(navigateur, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true })).newPage();
  pages.push(['PC', pc]);
  pc.on('pageerror', e => log('erreur page (PC) :', e.message));
  pc.secret = await premierLancement(pc, { site: SITE, code: CODE, motDePasse: MDP });
  await pc.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(pc, MDP, pc.secret));
  await fermerPopups(pc);

  log('PC : Administration › Utilisateurs › Léa (avec son adresse) → invitation envoyée directement');
  await ouvrirAdministration(pc);
  await pc.getByTestId('admin-onglet-utilisateurs').click();
  await pc.getByTestId('admin-nouveau').click();
  await pc.getByTestId('admin-nom').fill('Léa');
  await pc.getByTestId('admin-nouveau-email').fill('lea@exemple.fr');
  await pc.getByTestId('admin-nouveau-informe').click();
  await pc.getByTestId('admin-creer').click();
  await pc.getByTestId('admin-invitation-envoyer-direct').waitFor({ timeout: 90_000 });
  verifier(true, 'SMTP configuré : bouton « Envoyer l’e-mail maintenant » (le mailto reste en secours)');
  verifier((await pc.getByTestId('admin-invitation-email').innerText()).includes('Ouvrir ma messagerie'), 'secours : « Ouvrir ma messagerie »');
  await capture(pc, '01-pc-invitation-envoi-direct');
  await pc.getByTestId('admin-invitation-envoyer-direct').click();
  verifier(await attendre(() => smtp.messages.length === 1), 'le faux serveur SMTP a reçu l’e-mail d’invitation');
  const invitation = smtp.messages[0];
  const mailInv = decoderMessage(invitation.donnees);
  const htmlInv = mailInv.parties.find(p => /text\/html/.test(p.entetes))?.corps ?? '';
  const texteInv = mailInv.parties.find(p => /text\/plain/.test(p.entetes))?.corps ?? '';
  verifier(JSON.stringify(invitation.a) === '["lea@exemple.fr"]' && invitation.auth, 'destinataire lea@exemple.fr, envoi authentifié (SMTP_USER / SMTP_PASS)');
  verifier(/From: AppDashboard <noreply@appdashboard\.fr>/.test(mailInv.entetes), 'expéditeur : MAIL_FROM (AppDashboard <noreply@appdashboard.fr>)');
  const lienMail = (/href="(https:\/\/[^"]+#invitation=[^"]+)"/.exec(htmlInv) ?? [])[1]?.replace(/&amp;/g, '&');
  verifier(Boolean(lienMail) && /Accepter l’invitation/.test(htmlInv), 'HTML : bouton « Accepter l’invitation » vers le lien');
  verifier(texteInv.includes(lienMail ?? '¤'), 'version texte : le même lien');
  verifier(/E-mail d’invitation envoyé à lea@exemple\.fr/.test(await pc.getByTestId('admin-invitation-copie').innerText()), 'l’app confirme l’envoi');
  const apres = await boite();
  verifier(!apres.includes('lea@exemple.fr') && apres.includes('l***@e***.fr'), 'serveur : aucune adresse en clair, seulement masquée dans le journal d’envoi');
  await capture(pc, '02-pc-invitation-envoyee');
  if ((await pc.getByTestId('admin-termine').getAttribute('aria-disabled')) === 'true') await pc.getByTestId('admin-transmis').click();
  await pc.getByTestId('admin-termine').click();

  // ================================================================ 2. Léa : lien de l'e-mail, demande de support
  log('Léa : ouvre le lien REÇU PAR E-MAIL, choisit son mot de passe');
  const lea = await (await nouveauContexte(navigateur, { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true })).newPage();
  pages.push(['Léa', lea]);
  lea.on('pageerror', e => log('erreur page (Léa) :', e.message));
  await lea.goto(lienMail.replace(/^https?:\/\/[^/]+\//, SITE));
  await lea.getByTestId('invitation-mdp').waitFor({ timeout: 60_000 });
  await lea.getByTestId('invitation-mdp').fill(MDP_LEA);
  await lea.getByTestId('invitation-mdp-confirmation').fill(MDP_LEA);
  await lea.getByTestId('invitation-valider').click();
  await lea.getByTestId('hub').waitFor({ timeout: 90_000 });
  await fermerPopups(lea);
  // Première connexion : documents légaux à accepter.
  if (await lea.getByTestId('acceptation-juridique').waitFor({ timeout: 5000 }).then(() => true, () => false)) {
    await lea.getByTestId('acceptation-case').click();
    await lea.getByTestId('acceptation-continuer').click();
  }
  verifier(true, 'Léa est connectée');

  log('Léa : Support › Bug, titre, message riche, capture');
  await lea.getByTestId('hub-support-ouvrir').click();
  await lea.getByTestId('hub-support').waitFor({ timeout: 15_000 });
  await lea.getByTestId('support-categorie-bug').click();
  await lea.getByTestId('support-titre').fill('Le graphique reste vide');
  await lea.getByTestId('support-message').fill('Depuis ce matin, le **graphique** du portefeuille reste vide.\n- ouvert sur le PC\n- @everyone regardez');
  await lea.locator('input[data-testid="support-capture"]').setInputFiles({ name: 'Capture écran.png', mimeType: 'image/png', buffer: PNG });
  await lea.getByTestId('support-capture-nom').waitFor({ timeout: 10_000 });
  await capture(lea, '03-lea-support-formulaire');
  await lea.getByTestId('support-envoyer').click();
  verifier(await attendre(() => discord.length === 1), 'le faux Discord a reçu la demande');
  const annonce = discord[0];
  const embed = annonce?.charge.embeds?.[0] ?? {};
  verifier(annonce?.attendre === 'true' && annonce?.charge.thread_name === '#1 · 🐞 Bug · Le graphique reste vide', 'salon forum : un fil par demande (thread_name), ?wait=true');
  verifier(embed.color === 0xe5484d && embed.title === '🐞 Bug · Le graphique reste vide', 'embed : couleur et titre de la catégorie « Bug »');
  verifier(/^Léa · compte /.test(embed.author?.name ?? ''), `embed : auteur (${embed.author?.name})`);
  const champs = Object.fromEntries((embed.fields ?? []).map(f => [f.name, f.value]));
  verifier(Boolean(champs.Version) && Boolean(champs.Appareil) && champs.App === 'hub', `embed : app, version, appareil (${JSON.stringify(champs)})`);
  verifier(embed.url === 'https://appdashboard.fr/#/app/administration', 'embed : lien vers Administration › Support');
  verifier(/\*\*graphique\*\*/.test(embed.description ?? '') && !/@everyone/.test(embed.description ?? ''), 'message riche (Markdown) ; @everyone neutralisé');
  verifier(JSON.stringify(annonce?.charge.allowed_mentions) === '{"parse":[]}', 'allowed_mentions : { parse: [] }');
  verifier(annonce?.fichier?.nom === 'Capture-cran.png' && annonce?.fichier.type === 'image/png' && annonce?.fichier.taille === PNG.length, `capture jointe en pièce jointe (multipart) : ${JSON.stringify(annonce?.fichier)}`);
  verifier(embed.image?.url === 'attachment://Capture-cran.png', 'embed : la capture s’affiche dans le message');
  await lea.getByTestId('support-resultat').waitFor({ timeout: 10_000 });
  verifier(/Demande n° 1 envoyée/.test(await lea.getByTestId('support-resultat').innerText()), 'Léa : « Demande n° 1 envoyée »');
  verifier((await lea.getByTestId('support-ticket-1-statut').innerText()) === 'Ouverte', 'Mes demandes : statut « Ouverte »');
  await capture(lea, '04-lea-demande-envoyee');
  await lea.getByTestId('hub-support-fermer').click();

  // ================================================================ 3. PC : Administration › Support, réponse
  log('PC : Administration › Support, réponse (app, fil Discord, e-mail)');
  await ouvrirAdministration(pc);
  await pc.getByTestId('admin-onglet-support').click();
  await pc.getByTestId('admin-support-ticket-1').waitFor({ timeout: 20_000 });
  verifier(/Webhook Discord configuré \(salon forum/.test(await pc.getByTestId('admin-support-diagnostic').innerText()), 'diagnostic : webhook configuré, salon forum détecté');
  await pc.getByTestId('admin-support-ticket-1').click();
  await pc.getByTestId('admin-support-detail').waitFor({ timeout: 10_000 });
  verifier(/De Léa/.test(await pc.getByTestId('admin-support-detail').innerText()), 'détail : auteur, message, infos techniques');
  await pc.getByTestId('admin-support-reponse').fill('Bonjour Léa, c’est **corrigé** dans la prochaine version. Merci !');
  await capture(pc, '05-pc-support-reponse');
  await pc.getByTestId('admin-support-repondre').click();
  await pc.getByTestId('admin-support-retour').waitFor({ timeout: 20_000 });
  verifier(/visible dans l’app de l’utilisateur et dans le fil Discord ; e-mail envoyé/.test(await pc.getByTestId('admin-support-retour').innerText()), `retour : ${await pc.getByTestId('admin-support-retour').innerText()}`);
  const reponse = discord[1];
  verifier(reponse?.fil === '700000000000000001' && reponse?.charge.embeds?.[0]?.author?.name === 'Réponse du Fondateur', 'Discord : la réponse arrive dans le fil de la demande (thread_id)');
  verifier(await attendre(() => smtp.messages.length === 2), 'e-mail de réponse envoyé à Léa');
  const mailRep = decoderMessage(smtp.messages[1].donnees);
  verifier(JSON.stringify(smtp.messages[1].a) === '["lea@exemple.fr"]' && /c’est <strong>corrigé<\/strong>/.test(mailRep.texte), 'e-mail : la réponse mise en forme');
  verifier(!(await boite()).includes('lea@exemple.fr'), 'serveur : toujours aucune adresse en clair');
  await capture(pc, '06-pc-support-repondu');

  // ================================================================ 4. Léa : la réponse arrive dans l'app
  log('Léa : rouvre le Support, la réponse est là');
  await lea.getByTestId('hub-support-ouvrir').click();
  await lea.getByTestId('hub-support').waitFor({ timeout: 15_000 });
  verifier(await attendre(async () => (await lea.getByTestId('support-ticket-1-nouveau').count()) === 1, 20_000), 'notification « 🔔 Nouvelle réponse »');
  verifier((await lea.getByTestId('support-ticket-1-statut').innerText()) === 'Répondu', 'statut « Répondu »');
  await lea.getByTestId('support-ticket-1-ouvrir').click();
  await lea.getByTestId('support-ticket-1-message-equipe').waitFor({ timeout: 10_000 });
  verifier(/corrigé/.test(await lea.getByTestId('support-ticket-1-message-equipe').innerText()), 'conversation : la réponse du Fondateur');
  await capture(lea, '07-lea-reponse-recue');
  verifier(await attendre(async () => (await lea.getByTestId('support-ticket-1-nouveau').count()) === 0, 15_000), 'vue : la notification s’efface');

  // ================================================================ 5. PC : Messagerie
  log('PC : Administration › Messagerie, e-mail à Léa');
  await pc.getByTestId('admin-onglet-messagerie').click();
  await pc.getByTestId('admin-messagerie-pret').waitFor({ timeout: 20_000 });
  await pc.getByTestId('admin-messagerie-dest-' + (await pc.locator('[data-testid^="admin-messagerie-dest-"]').first().getAttribute('data-testid')).replace('admin-messagerie-dest-', '')).click();
  await pc.getByTestId('admin-messagerie-objet').fill('Tournoi de samedi');
  await pc.getByTestId('admin-messagerie-message').fill('# Rendez-vous\n**Samedi 14 h**, salle B.');
  await capture(pc, '08-pc-messagerie');
  await pc.getByTestId('admin-messagerie-envoyer').click();
  await pc.getByTestId('admin-messagerie-retour').waitFor({ timeout: 20_000 });
  verifier(/1 e-mail envoyé/.test(await pc.getByTestId('admin-messagerie-retour').innerText()), 'Messagerie : 1 e-mail envoyé');
  verifier(await attendre(() => smtp.messages.length === 3), 'le faux SMTP a reçu le message');
  verifier(/Subject: Tournoi de samedi/.test(decoderMessage(smtp.messages[2].donnees).entetes), 'objet de l’e-mail');
  await pc.locator('[data-testid^="admin-messagerie-envoi-"]').first().waitFor({ timeout: 20_000 });
  verifier(/Tournoi de samedi[\s\S]*Envoyé ×1/.test(await pc.getByTestId('admin-messagerie-historique').innerText()), 'historique : « Tournoi de samedi », Envoyé ×1');
  await capture(pc, '09-pc-messagerie-historique');
} catch (e) {
  echecs++;
  console.error(e);
  for (const [nom, page] of pages) await page.screenshot({ path: join(CAPTURES, `echec-${nom}.jpg`), type: 'jpeg', quality: 60 }).catch(() => undefined);
} finally {
  await navigateur.close();
  serveurSite.close();
  serveurRelais.close();
  fauxDiscord.closeAllConnections();
  fauxDiscord.close();
  await relais.fermer();
  await base.fermer();
  await admin.script(`DROP SCHEMA ${schema} CASCADE`).catch(() => undefined);
  await admin.fermer();
  await smtp.fermer();
}
console.log(echecs === 0 ? 'e2e support, e-mails et Discord : tout est bon' : `e2e support, e-mails et Discord : ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
