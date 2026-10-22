/**
 * Test de bout en bout : langue par défaut des comptes et e-mails en anglais, sans vrai serveur de messagerie.
 *
 *  - le VRAI relais (relais/relais.mjs) avec le VRAI transport SMTP (nodemailer) vers un FAUX serveur SMTP local
 *    (relais/test-smtp/faux-smtp.mjs) ; serveur Esport local (même API que le serveur o2switch) ;
 *  - PC (navigateur en français), le Fondateur : Esport › Membres › Créer un compte « Sam » en ENGLISH → l'invitation est
 *    proposée en anglais et part par e-mail : le faux SMTP la reçoit en anglais (objet, HTML, texte, pied de page) ;
 *  - iPhone (navigateur en FRANÇAIS), Sam : ouvre le lien reçu par e-mail, choisit son mot de passe ; son interface Esport
 *    est en ANGLAIS (langue définie par l'administrateur) ; il choisit Français (son choix prime) puis « Revenir à la langue
 *    définie par l'administrateur » ;
 *  - PC : Administration › Nouvel utilisateur « Lucie » en Français (par défaut), invitation reçue en français ;
 *  - PC : Messagerie vers Sam (EN) et Lucie (FR) : pastilles de langue, aperçu dans chaque langue, envoi groupé mixte (chacun
 *    reçoit l'habillage dans sa langue, le corps tel qu'écrit), puis deux versions FR/EN du message (chacun reçoit la sienne) ;
 *  - serveur Esport : jamais d'adresse e-mail ; la langue par défaut et le choix de l'utilisateur sont bien distincts.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-langue-comptes.mjs
 *
 * Variable : CAPTURES (dossier des captures, défaut docs/captures-langue-comptes).
 */

import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { allerPageAdministration, allerPageApplications, nouveauContexte, tuileApp } from './e2e-acceptation.mjs';
import { chargerPlaywright, demarrerRelais, deverrouiller, optionsIphone, pause, premierLancement, racine, totp } from './mobile-outils.mjs';

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-langue-comptes');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-langue-comptes-0123456789';
const PORT_RELAIS = 8861;
const PORT_ESPORT = 8862;
const PORT_SITE = 5297;
const MDP = 'mot-de-passe-langue-e2e-tres-long-46';
const MDP_SAM = 'Été à Biarritz 2026 !';
const log = (...a) => console.log('[e2e-langue-comptes]', ...a);
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

const { demarrerServeurEsport } = await import(pathToFileURL(join(racine, 'esport/outils/serveur-local.mjs')).href);
const { configSmtp, creerEnvoyeur } = await import(pathToFileURL(join(racine, 'esport/serveur/courriel-smtp.mjs')).href);
const { decoderMessage, fauxSmtp } = await import(pathToFileURL(join(racine, 'relais/test-smtp/faux-smtp.mjs')).href);

// ------------------------------------------------------------- Serveurs
const smtp = await fauxSmtp({ utilisateur: 'noreply@appdashboard.fr', motDePasse: 'mdp-smtp-e2e-langue' });
const envoyeur = await creerEnvoyeur(configSmtp(smtp.env));
const relais = await demarrerRelais(PORT_RELAIS, JETON, { ENVOYER_COURRIEL: envoyeur, LIEN_APP: 'https://appdashboard.fr' });
const esport = await demarrerServeurEsport({ port: PORT_ESPORT, jetonDev: JETON });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const dist = join(racine, 'bureau/dist');
if (!existsSync(join(dist, 'index.html'))) throw new Error('bureau/dist absent : lancez « npx vite build » d’abord');
const serveurSite = http.createServer((req, res) => {
  const chemin = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  if (chemin === '/relais.json' || chemin === '/esport.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(chemin === '/relais.json' ? { relais: `https://localhost:${PORT_RELAIS}` } : { esport: esport.url }));
    return;
  }
  let fichier = join(dist, chemin);
  if (!existsSync(fichier) || statSync(fichier).isDirectory()) fichier = join(dist, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[extname(fichier)] ?? 'application/octet-stream' });
  createReadStream(fichier).pipe(res);
});
await new Promise(ok => serveurSite.listen(PORT_SITE, ok));
const SITE = `http://localhost:${PORT_SITE}/`;

// ------------------------------------------------------------- Outils
async function fermerPopups(page) {
  for (let i = 0; i < 3; i++) {
    const clique = await page.getByText(/^(Fermer|Terminé|Compris|Plus tard|Close|Done|Got it|Later)$/).first().click({ timeout: 2000 }).then(() => true, () => false);
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

async function ouvrirEsport(page) {
  if (await page.getByTestId('app-esport').count()) await page.getByTestId('retour-hub').first().click();
  await allerPageApplications(page);
  const tuile = tuileApp(page, 'esport').first();
  await tuile.waitFor({ timeout: 30_000 });
  await tuile.click();
  await page.getByTestId('app-esport').waitFor({ timeout: 20_000 });
}

async function ouvrirAdministration(page) {
  if (await page.getByTestId('app-esport').count()) await page.getByTestId('retour-hub').first().click();
  await allerPageAdministration(page);
  await page.locator('[data-testid="cellule-administration"], [data-testid="tuile-administration"]').first().click();
  await page.getByTestId('app-administration').waitFor({ timeout: 20_000 });
  await confirmerIdentite(page);
}

async function api(chemin, jeton, { methode = 'GET', corps } = {}) {
  const r = await fetch(`${esport.url}${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}

/** Segment choisi ? (react-native-web ne rend pas toujours aria-checked : le segment choisi a un autre fond que son voisin). */
async function segmentActif(page, testID, autreTestID) {
  const fond = id => page.getByTestId(id).evaluate(n => ({ checked: n.getAttribute('aria-checked'), fond: getComputedStyle(n).backgroundColor }));
  const [a, b] = [await fond(testID), await fond(autreTestID)];
  return a.checked === 'true' || b.checked === 'false' || a.fond !== b.fond;
}

/** Objet d'un e-mail : mots encodés « =?UTF-8?Q?…?= » ou « =?UTF-8?B?…?= » décodés. */
const decoderObjet = brut =>
  brut.replace(/=\?UTF-8\?([QB])\?([^?]*)\?=/gi, (_, genre, valeur) =>
    genre.toUpperCase() === 'B'
      ? Buffer.from(valeur, 'base64').toString('utf8')
      : Buffer.from(valeur.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8'),
  );

/** E-mails reçus par le faux SMTP depuis `depuis`, décodés (destinataire, objet, HTML, texte). */
const recus = depuis =>
  smtp.messages.slice(depuis).map(m => {
    const d = decoderMessage(m.donnees);
    return { a: m.a[0], entetes: d.entetes, objet: decoderObjet(/Subject: (.*)/.exec(d.entetes)?.[1] ?? ''), html: d.parties.find(p => /text\/html/.test(p.entetes))?.corps ?? '', texte: d.parties.find(p => /text\/plain/.test(p.entetes))?.corps ?? '' };
  });
const attendreEmails = async (depuis, n, ms = 30_000) => {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (smtp.messages.length - depuis >= n) return recus(depuis);
    await pause(200);
  }
  return recus(depuis);
};

const pages = [];
const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
try {
  // ================================================================ PC : le Fondateur
  log('PC : coffre du Fondateur, relié au relais (jeton maître), profil Esport');
  const ctxPc = await nouveauContexte(navigateur, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const pc = await ctxPc.newPage();
  pages.push(['PC', pc]);
  pc.on('pageerror', e => log('erreur page (PC) :', e.message));
  pc.secret = await premierLancement(pc, { site: SITE, code: relais.code, motDePasse: MDP });
  await pc.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(pc, MDP, pc.secret));
  await fermerPopups(pc);
  await ouvrirEsport(pc);
  await pc.getByTestId('esport-profil-initial').waitFor({ timeout: 30_000 });
  await pc.getByTestId('esport-pseudo').fill('Fondateur');
  await pc.getByTestId('esport-pseudo-valider').click();
  await pc.getByTestId('esport-dashboard').waitFor({ timeout: 20_000 });
  const sessFond = (await api('/session', JETON, { methode: 'POST' })).corps.session;
  const faucons = (await api('/teams', sessFond, { methode: 'POST', corps: { nom: 'Faucons Valorant', jeu: 'valorant', preset: 'valorant_complet' } })).corps.team;
  const teamB = (await api('/teams', sessFond, { methode: 'POST', corps: { nom: 'Team B', jeu: 'valorant', preset: 'valorant_complet' } })).corps.team;
  verifier(Boolean(faucons?.id && teamB?.id), 'teams « Faucons Valorant » et « Team B » prêtes');

  // ================================================================ Esport › Membres › Créer un compte, en English
  log('PC : Esport › Membres › Créer un compte (Sam, English) ; l’invitation part par e-mail');
  await pc.getByTestId('esport-nav-membres').click();
  await pc.getByTestId('esport-membres-global').waitFor({ timeout: 20_000 });
  await pc.getByTestId('esport-membres-creer').click();
  await pc.getByTestId('esport-creation-compte').waitFor({ timeout: 20_000 });
  verifier(await segmentActif(pc, 'esport-compte-langue-fr', 'esport-compte-langue-en'), 'création : Français choisi par défaut');
  await pc.getByTestId('esport-compte-nom').fill('Sam');
  await pc.getByTestId('esport-compte-email').fill('sam@exemple.com');
  await pc.getByTestId('esport-compte-discord-id').fill('412345678901234567');
  await pc.getByTestId('esport-compte-langue-en').click();
  verifier(await segmentActif(pc, 'esport-compte-langue-en', 'esport-compte-langue-fr'), 'création : English choisi');
  await pc.getByTestId('esport-compte-team-faucons-valorant').click();
  await capture(pc, '01-pc-creer-compte-english');
  await pc.getByTestId('esport-compte-creer').click();
  await confirmerIdentite(pc);
  await pc.getByTestId('esport-compte-cree').waitFor({ timeout: 120_000 });
  await pc.getByTestId('admin-invitation-lien').first().waitFor({ timeout: 90_000 });
  const idSam = (await esport.base.premier("SELECT id FROM comptes WHERE pseudo = 'Sam'", [])).id;
  const sam = await esport.base.premier('SELECT langue, langue_defaut FROM comptes WHERE id = ?', [idSam]);
  verifier(sam.langue_defaut === 'en' && sam.langue === null, 'serveur Esport : langue par défaut de Sam = en, aucun choix personnel');
  verifier(await segmentActif(pc, 'admin-invitation-langue-en', 'admin-invitation-langue-fr'), 'invitation : proposée en anglais d’emblée (langue du compte)');
  const avant1 = smtp.messages.length;
  await pc.getByTestId('admin-invitation-envoyer-direct').click();
  const [mailSam] = await attendreEmails(avant1, 1);
  verifier(Boolean(mailSam) && mailSam.a === 'sam@exemple.com', 'faux SMTP : l’invitation est arrivée à sam@exemple.com');
  verifier(/Your administrator invites you to Esport/.test(mailSam?.objet ?? ''), `invitation reçue : objet en anglais (${mailSam?.objet})`);
  verifier(/<html lang="en">/.test(mailSam?.html ?? '') && /Accept the invitation/.test(mailSam?.html ?? ''), 'invitation reçue : HTML en anglais, bouton « Accept the invitation »');
  verifier(/You are receiving this e-mail because you have an AppDashboard account/.test(mailSam?.html ?? ''), 'invitation reçue : pied de page en anglais');
  verifier(/Open this link/.test(mailSam?.texte ?? '') && !/Ouvre ce lien/.test(mailSam?.texte ?? ''), 'invitation reçue : texte brut en anglais');
  verifier(/Content-Language: en/.test(mailSam?.entetes ?? ''), 'invitation reçue : en-tête Content-Language: en');
  const lienSam = /href="(https?:\/\/[^"]*#invitation=[^"]+)"/.exec(mailSam?.html ?? '')?.[1]?.replace(/&amp;/g, '&') ?? '';
  verifier(Boolean(lienSam), 'invitation reçue : lien de première connexion dans l’e-mail');
  await capture(pc, '02-pc-invitation-envoyee-en');
  await pc.getByTestId('esport-compte-termine').click();
  await pc.getByTestId(`esport-compte-statut-${idSam}`).waitFor({ timeout: 20_000 });
  // Membres : la langue du compte est visible et modifiable (Fondateur).
  await pc.getByLabel('Gérer Sam').click();
  await pc.getByTestId(`esport-langue-compte-${idSam}`).waitFor({ timeout: 10_000 });
  verifier(/Langue par défaut : English/.test(await pc.getByTestId(`esport-langue-compte-valeur-${idSam}`).innerText()), 'Membres : « Langue par défaut : English » (Fondateur)');
  await capture(pc, '03-pc-membres-langue');

  // ================================================================ iPhone (navigateur en français) : Sam
  log('iPhone en FRANÇAIS : Sam ouvre le lien reçu par e-mail ; son interface Esport est en anglais');
  const ctxSam = await nouveauContexte(navigateur, optionsIphone());
  const samPage = await ctxSam.newPage();
  pages.push(['Sam', samPage]);
  samPage.on('pageerror', e => log('erreur page (Sam) :', e.message));
  await samPage.goto(lienSam.replace(/^https?:\/\/[^/]+\//, SITE));
  await samPage.getByTestId('invitation-mdp').waitFor({ timeout: 60_000 });
  await samPage.getByTestId('invitation-mdp').fill(MDP_SAM);
  await samPage.getByTestId('invitation-mdp-confirmation').fill(MDP_SAM);
  await samPage.getByTestId('invitation-valider').click();
  await samPage.getByTestId('hub').waitFor({ timeout: 90_000 });
  await fermerPopups(samPage);
  await ouvrirEsport(samPage);
  await samPage.getByTestId('esport-dashboard').waitFor({ timeout: 30_000 });
  const langueDe = async () => ((await samPage.evaluate(() => navigator.language)) ?? '').slice(0, 2);
  verifier((await langueDe()) === 'fr', 'iPhone de Sam : navigateur en français');
  const corpsSam = async () => samPage.locator('body').innerText();
  await samPage.getByText('All your teams at a glance', { exact: false }).first().waitFor({ timeout: 20_000 }).catch(() => undefined);
  let texte = await corpsSam();
  verifier(/All your teams at a glance/.test(texte) && !/Toutes vos teams en un coup d’œil/.test(texte), 'interface Esport de Sam : ANGLAIS (langue définie par l’administrateur)');
  await capture(samPage, '04-iphone-sam-esport-en');
  const apres = await esport.base.premier('SELECT langue, langue_defaut FROM comptes WHERE id = ?', [idSam]);
  verifier(apres.langue === null && apres.langue_defaut === 'en', 'serveur : toujours aucun choix personnel (la langue par défaut a suffi)');

  log('iPhone : Mon profil — son propre choix prime, puis « Revenir à la langue définie par l’administrateur »');
  await samPage.getByTestId('esport-nav-teams').click();
  await samPage.getByTestId('esport-mon-profil-ouvrir').click();
  await samPage.getByTestId('esport-profil-langue-defaut').waitFor({ timeout: 20_000 });
  verifier(/set by the administrator: English/.test(await samPage.getByTestId('esport-profil-langue-defaut').innerText()), 'Mon profil : « Your account language, set by the administrator: English »');
  await samPage.getByTestId('esport-profil-langue-fr').click();
  await samPage.getByTestId('esport-profil-langue-admin').waitFor({ timeout: 20_000 });
  verifier(/Enregistrer le profil/.test(await corpsSam()), 'Sam choisit Français : interface en français aussitôt (son choix prime)');
  verifier(/Revenir à la langue définie par l’administrateur \(English\)/.test(await samPage.getByTestId('esport-profil-langue-admin').innerText()), '« Revenir à la langue définie par l’administrateur (English) » proposé');
  await pause(500);
  verifier((await esport.base.premier('SELECT langue FROM comptes WHERE id = ?', [idSam])).langue === 'fr', 'serveur : choix personnel de Sam = fr');
  await capture(samPage, '05-iphone-sam-choix-fr');
  await samPage.getByTestId('esport-profil-langue-admin').click();
  await samPage.getByTestId('esport-profil-langue-defaut').waitFor({ timeout: 20_000 });
  verifier(/Save the profile/.test(await corpsSam()), 'retour à la langue de l’administrateur : interface en anglais');
  verifier((await esport.base.premier('SELECT langue, langue_defaut FROM comptes WHERE id = ?', [idSam])).langue === null, 'serveur : choix personnel effacé');

  // ================================================================ PC : Administration › Nouvel utilisateur (Lucie, Français)
  log('PC : Administration › Nouvel utilisateur « Lucie » (Français par défaut) ; l’invitation part en français');
  await ouvrirAdministration(pc);
  await pc.getByTestId('admin-onglet-utilisateurs').click();
  await pc.getByTestId('admin-nouveau').click();
  await pc.getByTestId('admin-nom').fill('Lucie');
  await pc.getByTestId('admin-nouveau-email').fill('lucie@exemple.fr');
  verifier(await segmentActif(pc, 'admin-nouveau-langue-fr', 'admin-nouveau-langue-en'), 'Administration : Français par défaut à la création');
  await pc.getByTestId('admin-nouveau-informe').click();
  await pc.getByTestId('admin-creer').click();
  await pc.getByTestId('admin-identifiants').waitFor({ timeout: 90_000 });
  await pc.getByTestId('admin-invitation-envoyer-direct').waitFor({ timeout: 30_000 });
  const avant2 = smtp.messages.length;
  await pc.getByTestId('admin-invitation-envoyer-direct').click();
  const [mailLucie] = await attendreEmails(avant2, 1);
  verifier(mailLucie?.a === 'lucie@exemple.fr' && /<html lang="fr">/.test(mailLucie?.html ?? '') && /Accepter l’invitation/.test(mailLucie?.html ?? ''), 'invitation de Lucie reçue en français (HTML, bouton)');
  verifier(/Vous recevez cet e-mail parce que vous avez un compte AppDashboard/.test(mailLucie?.html ?? ''), 'invitation de Lucie : pied de page en français');
  if ((await pc.getByTestId('admin-termine').getAttribute('aria-disabled')) === 'true') await pc.getByTestId('admin-transmis').click();
  await pc.getByTestId('admin-termine').click();
  await pc.getByTestId('admin-onglet-utilisateurs').click();
  const idLucie = ((await pc.locator('[data-testid^="admin-ligne-"]').filter({ hasText: 'Lucie' }).first().getAttribute('data-testid')) ?? '').replace('admin-ligne-', '');
  // Fiche de Sam : langue par défaut visible (English) et modifiable.
  await pc.getByTestId(`admin-ligne-${idSam}`).click();
  await pc.getByTestId('admin-fiche-langue-en').waitFor({ timeout: 20_000 });
  verifier(await segmentActif(pc, 'admin-fiche-langue-en', 'admin-fiche-langue-fr'), 'fiche de Sam : langue par défaut English');
  await capture(pc, '06-pc-fiche-langue');

  // ================================================================ PC : Messagerie vers Sam (EN) et Lucie (FR)
  log('PC : Messagerie vers Sam (English) et Lucie (Français) — habillage dans la langue de chacun');
  await pc.getByTestId('admin-onglet-messagerie').click();
  await pc.getByTestId('admin-messagerie-pret').waitFor({ timeout: 20_000 });
  await pc.getByTestId(`admin-messagerie-langue-${idSam}`).waitFor({ timeout: 20_000 });
  verifier((await pc.getByTestId(`admin-messagerie-langue-${idSam}`).innerText()).trim() === 'EN', 'Messagerie : Sam marqué EN');
  verifier((await pc.getByTestId(`admin-messagerie-langue-${idLucie}`).innerText()).trim() === 'FR', 'Messagerie : Lucie marquée FR');
  await pc.getByTestId(`admin-messagerie-dest-${idSam}`).click();
  await pc.getByTestId(`admin-messagerie-dest-${idLucie}`).click();
  verifier(await segmentActif(pc, 'admin-messagerie-langue-auto', 'admin-messagerie-langue-fr'), 'Messagerie : « Langue du destinataire » par défaut');
  verifier(/1 en français, 1 en anglais/.test(await pc.getByTestId('admin-messagerie-langues-resume').innerText()), 'Messagerie : « 1 en français, 1 en anglais »');
  await pc.getByTestId('admin-messagerie-objet').fill('Tournoi de samedi');
  await pc.getByTestId('admin-messagerie-message').fill('Rendez-vous **samedi** à 14 h, salle B.');
  // Aperçu dans chaque langue, avant l'envoi.
  await pc.getByTestId('admin-messagerie-apercu-basculer').click();
  await pc.getByTestId('admin-messagerie-apercu-html').waitFor({ timeout: 20_000 });
  const cadre = () => pc.frameLocator('[data-testid="admin-messagerie-apercu-html"]').locator('body');
  await cadre().getByText('Vous recevez cet e-mail', { exact: false }).waitFor({ timeout: 20_000 });
  verifier(/Rendez-vous samedi à 14 h/.test(await cadre().innerText()), 'aperçu en Français : habillage français, corps tel qu’écrit');
  await pc.getByTestId('admin-messagerie-apercu-langue-en').click();
  await cadre().getByText('You are receiving this e-mail', { exact: false }).waitFor({ timeout: 20_000 });
  verifier(/Rendez-vous samedi à 14 h/.test(await cadre().innerText()) && !/Vous recevez/.test(await cadre().innerText()), 'aperçu en English : habillage anglais, corps tel qu’écrit');
  await capture(pc, '07-pc-messagerie-apercu-en');
  const avant3 = smtp.messages.length;
  await pc.getByTestId('admin-messagerie-envoyer').click();
  await pc.getByTestId('admin-messagerie-retour').waitFor({ timeout: 30_000 });
  const lot1 = await attendreEmails(avant3, 2);
  const deSam = lot1.find(m => m.a === 'sam@exemple.com');
  const deLucie = lot1.find(m => m.a === 'lucie@exemple.fr');
  verifier(lot1.length === 2 && Boolean(deSam) && Boolean(deLucie), 'faux SMTP : deux e-mails, un par destinataire');
  verifier(/<html lang="en">/.test(deSam?.html ?? '') && /You are receiving this e-mail/.test(deSam?.html ?? '') && /Content-Language: en/.test(deSam?.entetes ?? ''), 'Sam : habillage anglais (HTML, pied de page, Content-Language)');
  verifier(/<html lang="fr">/.test(deLucie?.html ?? '') && /Vous recevez cet e-mail/.test(deLucie?.html ?? '') && /Content-Language: fr/.test(deLucie?.entetes ?? ''), 'Lucie : habillage français (HTML, pied de page, Content-Language)');
  verifier(/Rendez-vous <strong>samedi<\/strong> à 14 h/.test(deSam?.html ?? '') && /Rendez-vous <strong>samedi<\/strong> à 14 h/.test(deLucie?.html ?? ''), 'le corps reste celui que le Fondateur a écrit, pour les deux');
  verifier(/Tournoi de samedi/.test(deSam?.objet ?? '') && /Tournoi de samedi/.test(deLucie?.objet ?? ''), 'objet identique, tel qu’écrit');
  await capture(pc, '08-pc-messagerie-envoyee');

  log('PC : deux versions FR/EN du message — chacun reçoit la sienne');
  // Les destinataires restent choisis après un envoi ; le formulaire, lui, est vidé.
  await pc.getByTestId('admin-messagerie-objet').fill('Entraînement mardi');
  await pc.getByTestId('admin-messagerie-message').fill('Entraînement mardi à 20 h, tenue de scrim.');
  await pc.getByTestId('admin-messagerie-deux-versions').click();
  await pc.getByTestId('admin-messagerie-objet-en').fill('Practice on Tuesday');
  await pc.getByTestId('admin-messagerie-message-en').fill('Practice on Tuesday at 8 pm, scrim outfit.');
  const avant4 = smtp.messages.length;
  await pc.getByTestId('admin-messagerie-envoyer').click();
  const lot2 = await attendreEmails(avant4, 2);
  const sam2 = lot2.find(m => m.a === 'sam@exemple.com');
  const lucie2 = lot2.find(m => m.a === 'lucie@exemple.fr');
  verifier(/Subject: Practice on Tuesday/.test(sam2?.entetes ?? '') && /Practice on Tuesday at 8 pm/.test(sam2?.texte ?? '') && !/Entraînement/.test(sam2?.texte ?? ''), 'Sam : reçoit la version anglaise (objet et texte)');
  verifier(/Entraînement mardi/.test(lucie2?.objet ?? '') && /Entraînement mardi à 20 h/.test(lucie2?.texte ?? '') && !/Practice on/.test(lucie2?.texte ?? ''), 'Lucie : reçoit la version française (objet et texte)');
  const histo = await pc.getByTestId('admin-messagerie-historique').innerText();
  verifier(/Tournoi de samedi/.test(histo) && /Entraînement mardi|Practice/.test(histo), 'historique des envois mis à jour');

  // ================================================================ Confidentialité
  verifier(!JSON.stringify(await esport.base.tous('SELECT * FROM comptes', [])).match(/exemple\.(com|fr)/), 'serveur Esport : jamais l’adresse e-mail');
  const debord = await samPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  verifier(!debord, 'iPhone : pas de défilement horizontal');
} catch (e) {
  echecs++;
  console.error(e);
  for (const [nom, page] of pages) await page.screenshot({ path: join(CAPTURES, `echec-${nom}.jpg`), type: 'jpeg', quality: 60 }).catch(() => undefined);
} finally {
  await navigateur.close();
  serveurSite.close();
  relais.fermer();
  envoyeur.fermer?.();
  await smtp.fermer();
  await esport.fermer();
}
console.log(echecs === 0 ? 'e2e langue des comptes et e-mails : tout est bon' : `e2e langue des comptes et e-mails : ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
