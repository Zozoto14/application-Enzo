/**
 * Test de bout en bout : invitation directe depuis l'Esport, sans Cloudflare.
 *
 *  - faux relais (le vrai relais/worker.mjs) et serveur Esport local (même API que le Worker) ;
 *  - PC (1440 × 900), le Fondateur : Esport › Membres › « Créer un compte » (nom, e-mail, team,
 *    rôle, poste) → vérification d'identité → compte du hub « Esport seulement » créé, adresse
 *    enregistrée, compte pré-enregistré « invité » dans sa team → e-mail d'invitation (mailto) ;
 *  - iPhone neuf (390 × 844), Léa : ouvre le lien, choisit SON mot de passe, son hub ne montre que
 *    l'Esport ; dans l'Esport : pas d'écran de pseudo, pas de code, sa team est déjà là (Dashboard
 *    et Teams) ; elle passe « active » côté serveur ;
 *  - PC : Dashboard (toutes les teams), page Membres (Léa active) ;
 *  - PC : suppression du compte de Léa dans l'Administration → retirée de l'Esport.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-esport-invitations.mjs
 *
 * Variable : CAPTURES (dossier des captures, défaut docs/captures-esport-invitations).
 */

import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ongletPresent, ongletTeam } from './esport-navigation.mjs';
import { allerPageAdministration, allerPageApplications, nouveauContexte, tuileApp } from './e2e-acceptation.mjs';
import { chargerPlaywright, demarrerRelais, deverrouiller, optionsIphone, pause, premierLancement, racine, totp } from './mobile-outils.mjs';

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-esport-invitations');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-esport-invit-0123456789ab';
const PORT_RELAIS = 8831;
const PORT_ESPORT = 8832;
const PORT_SITE = 5291;
const MDP = 'mot-de-passe-esport-e2e-tres-long-42';
const MDP_LEA = 'Été à Biarritz 2026 !';
const log = (...a) => console.log('[e2e-esport-invitations]', ...a);
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

// ------------------------------------------------------------- Serveurs
const relais = await demarrerRelais(PORT_RELAIS, JETON);
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

async function ouvrirEsport(page) {
  if (await page.getByTestId('app-esport').count()) await page.getByTestId('retour-hub').first().click();
  await allerPageApplications(page);
  const tuile = tuileApp(page, 'esport').first();
  await tuile.waitFor({ timeout: 30_000 });
  await tuile.click();
  await page.getByTestId('app-esport').waitFor({ timeout: 20_000 });
}

async function api(chemin, jeton, { methode = 'GET', corps } = {}) {
  const r = await fetch(`${esport.url}${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}

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

  log('API : deux teams du Fondateur');
  const sessFond = (await api('/session', JETON, { methode: 'POST' })).corps.session;
  const faucons = (await api('/teams', sessFond, { methode: 'POST', corps: { nom: 'Faucons Valorant', jeu: 'valorant', preset: 'valorant_complet' } })).corps.team;
  const teamB = (await api('/teams', sessFond, { methode: 'POST', corps: { nom: 'Team B', jeu: 'valorant', preset: 'valorant_complet' } })).corps.team;
  verifier(Boolean(faucons?.id && teamB?.id), 'teams « Faucons Valorant » et « Team B » prêtes');

  // ================================================================ PC : Esport › Membres › Créer un compte
  log('PC : Esport › Membres › Créer un compte (Léa, e-mail, Faucons Valorant en Joueur, Duelliste)');
  await pc.getByTestId('esport-nav-membres').click();
  await pc.getByTestId('esport-membres-global').waitFor({ timeout: 20_000 });
  await pc.getByTestId('esport-membres-creer').click();
  await pc.getByTestId('esport-creation-compte').waitFor({ timeout: 20_000 });
  await pc.getByTestId('esport-compte-nom').fill('Léa');
  await pc.getByTestId('esport-compte-email').fill('lea@exemple.fr');
  await pc.getByTestId('esport-compte-team-faucons-valorant').click();
  await pc.getByTestId('esport-compte-poste-faucons-valorant').fill('Duelliste');
  await capture(pc, '01-pc-creer-compte');
  await pc.getByTestId('esport-compte-creer').click();
  await confirmerIdentite(pc);
  await pc.getByTestId('esport-compte-cree').waitFor({ timeout: 120_000 });
  await pc.getByTestId('admin-invitation-lien').first().waitFor({ timeout: 90_000 });
  const lienLea = (await pc.getByTestId('admin-invitation-lien').first().innerText()).trim();
  verifier(/#invitation=/.test(lienLea), 'lien d’invitation de première connexion (usage unique)');
  const mailto = await pc.getByTestId('admin-invitation-email').getAttribute('href');
  verifier((mailto ?? '').startsWith('mailto:lea@exemple.fr?subject='), 'e-mail : destinataire pré-rempli (mailto)');
  const corps = decodeURIComponent((mailto ?? '').split('body=')[1] ?? '');
  verifier(corps.includes(lienLea) && /dans la team Faucons Valorant/.test(corps) && /aucun code à saisir/.test(corps), 'e-mail : lien, team, « aucun code à saisir »');
  await capture(pc, '02-pc-invitation-email');
  const idLea = (await esport.base.premier("SELECT id FROM comptes WHERE pseudo = 'Léa'", [])).id;
  const ligne = await esport.base.premier('SELECT invite_le, active_le FROM comptes WHERE id = ?', [idLea]);
  verifier(Boolean(ligne.invite_le) && !ligne.active_le, 'serveur : compte pré-enregistré « invité »');
  const membre = await esport.base.premier('SELECT m.poste_jeu, r.nom FROM membres m JOIN roles r ON r.id = m.role_id WHERE m.compte_id = ? AND m.team_id = ?', [idLea, faucons.id]);
  verifier(membre?.nom === 'Joueur' && membre?.poste_jeu === 'Duelliste', 'serveur : Léa dans Faucons Valorant (Joueur, Duelliste)');
  verifier(!JSON.stringify(await esport.base.tous('SELECT * FROM comptes', [])).includes('exemple.fr'), 'serveur Esport : jamais l’adresse e-mail');
  await pc.getByTestId('esport-compte-termine').click();
  await pc.getByTestId(`esport-compte-statut-${idLea}`).waitFor({ timeout: 20_000 });
  verifier((await pc.getByTestId(`esport-compte-statut-${idLea}`).innerText()).trim() === 'Invité', 'Membres : Léa « Invité »');
  await capture(pc, '03-pc-membres-invite');

  log('PC : Administration, compte de Léa (badge Esport, adresse enregistrée)');
  await pc.getByTestId('retour-hub').first().click();
  await allerPageAdministration(pc);
  await pc.locator('[data-testid="cellule-administration"], [data-testid="tuile-administration"]').first().click();
  await pc.getByTestId('app-administration').waitFor({ timeout: 20_000 });
  await confirmerIdentite(pc);
  await pc.getByTestId('admin-onglet-utilisateurs').click();
  await pc.getByTestId(`admin-esport-${idLea}`).waitFor({ timeout: 20_000 });
  verifier(true, 'Administration : compte de Léa avec le badge « Esport »');
  await pc.getByTestId(`admin-ligne-${idLea}`).click();
  await pc.getByTestId('admin-fiche-email').waitFor({ timeout: 20_000 });
  verifier((await pc.getByTestId('admin-fiche-email').inputValue()) === 'lea@exemple.fr', 'Administration : adresse e-mail de Léa enregistrée');
  await capture(pc, '04-pc-administration-lea');
  await pc.getByTestId('retour-hub').first().click();

  // ================================================================ iPhone : première connexion de Léa
  log('iPhone neuf : Léa ouvre le lien et choisit son mot de passe');
  const ctxLea = await nouveauContexte(navigateur, optionsIphone());
  const lea = await ctxLea.newPage();
  pages.push(['Léa', lea]);
  lea.on('pageerror', e => log('erreur page (Léa) :', e.message));
  await lea.goto(lienLea.replace(/^https?:\/\/[^/]+\//, SITE));
  await lea.getByTestId('invitation-mdp').waitFor({ timeout: 60_000 });
  await capture(lea, '05-iphone-choisir-mot-de-passe');
  await lea.getByTestId('invitation-mdp').fill(MDP_LEA);
  await lea.getByTestId('invitation-mdp-confirmation').fill(MDP_LEA);
  await lea.getByTestId('invitation-valider').click();
  await lea.getByTestId('hub').waitFor({ timeout: 90_000 });
  await fermerPopups(lea);
  await tuileApp(lea, 'esport').first().waitFor({ timeout: 30_000 });
  const tuiles = await lea.locator('[data-testid^="cellule-"], [data-testid^="tuile-"]').evaluateAll(els => [...new Set(els.map(e => e.getAttribute('data-testid').replace(/^(cellule|tuile)-/, '')))]);
  verifier(JSON.stringify(tuiles.filter(t => !/-/.test(t))) === JSON.stringify(['esport']), `hub de Léa : seulement l’Esport (${tuiles.join(', ')})`);
  await ouvrirEsport(lea);
  await lea.getByTestId('esport-dashboard').waitFor({ timeout: 30_000 });
  verifier((await lea.getByTestId('esport-profil-initial').count()) === 0, 'Léa : pas d’écran de pseudo (déjà choisi par le Fondateur)');
  await lea.getByTestId('esport-team-faucons-valorant').waitFor({ timeout: 20_000 });
  verifier((await lea.getByTestId('esport-team-team-b').count()) === 0, 'Dashboard de Léa : sa team seulement');
  await capture(lea, '06-iphone-lea-dashboard');
  await lea.getByTestId('esport-nav-teams').click();
  await lea.getByTestId('esport-teams').waitFor({ timeout: 20_000 });
  verifier((await lea.getByTestId('esport-code').count()) === 0, 'Teams de Léa : aucun code à saisir');
  verifier((await lea.getByTestId('esport-team-faucons-valorant').count()) === 1 && (await lea.getByTestId('esport-team-team-b').count()) === 0, 'Teams de Léa : Faucons Valorant, pas la Team B');
  await capture(lea, '07-iphone-lea-teams');
  await lea.getByTestId('esport-team-faucons-valorant').click();
  await lea.getByTestId('esport-barre').waitFor({ timeout: 20_000 });
  verifier(!(await ongletPresent(lea, 'journal')), 'Léa (Joueur) : pas de Journal');
  await capture(lea, '08-iphone-lea-team');
  const active = await esport.base.premier('SELECT active_le FROM comptes WHERE id = ?', [idLea]);
  verifier(Boolean(active.active_le), 'serveur : Léa « active » depuis sa première session');
  const debord = await lea.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  verifier(!debord, 'iPhone : pas de défilement horizontal');

  // ================================================================ PC : Dashboard et Membres
  log('PC : Dashboard (toutes les teams) et Membres (Léa active)');
  await ouvrirEsport(pc);
  await pc.getByTestId('esport-nav-dashboard').click();
  await pc.getByTestId('esport-dashboard-teams').waitFor({ timeout: 20_000 });
  verifier((await pc.getByTestId('esport-team-faucons-valorant').count()) === 1 && (await pc.getByTestId('esport-team-team-b').count()) === 1, 'Dashboard du Fondateur : les deux teams');
  await capture(pc, '09-pc-dashboard');
  await pc.getByTestId('esport-nav-membres').click();
  await pc.getByTestId(`esport-compte-statut-${idLea}`).waitFor({ timeout: 20_000 });
  verifier((await pc.getByTestId(`esport-compte-statut-${idLea}`).innerText()).trim() === 'Actif', 'Membres : Léa « Actif »');
  await capture(pc, '10-pc-membres-actif');

  // ================================================================ PC : suppression dans l'Administration
  log('PC : suppression du compte de Léa dans l’Administration → retirée de l’Esport');
  await pc.getByTestId('retour-hub').first().click();
  await allerPageAdministration(pc);
  await pc.locator('[data-testid="cellule-administration"], [data-testid="tuile-administration"]').first().click();
  await pc.getByTestId('app-administration').waitFor({ timeout: 20_000 });
  await confirmerIdentite(pc);
  await pc.getByTestId('admin-onglet-utilisateurs').click();
  await pc.getByTestId(`admin-ligne-${idLea}`).click();
  await pc.getByTestId('admin-supprimer').click();
  await pc.getByTestId('admin-confirmation-nom').fill('Léa');
  await pc.getByTestId('admin-confirmer').click();
  await confirmerIdentite(pc);
  await pc.getByTestId('admin-avis').waitFor({ timeout: 60_000 });
  const avis = await pc.getByTestId('admin-avis').innerText();
  verifier(/Retiré aussi de l’Esport \(1 team\)/.test(avis), `Administration : « Retiré aussi de l’Esport » (${avis.slice(0, 120)})`);
  const reste = await esport.base.premier('SELECT COUNT(*) AS n FROM membres WHERE compte_id = ?', [idLea]);
  verifier(Number(reste.n) === 0, 'serveur : Léa n’est plus dans aucune team');
  verifier(!(await esport.base.premier('SELECT id FROM comptes WHERE id = ?', [idLea])), 'serveur : profil Esport de Léa effacé');
  await capture(pc, '11-pc-suppression');
} catch (e) {
  echecs++;
  console.error(e);
  for (const [nom, page] of pages) await page.screenshot({ path: join(CAPTURES, `echec-${nom}.jpg`), type: 'jpeg', quality: 60 }).catch(() => undefined);
} finally {
  await navigateur.close();
  serveurSite.close();
  relais.fermer();
  await esport.fermer();
}
console.log(echecs === 0 ? 'e2e Esport (invitations) : tout est bon' : `e2e Esport (invitations) : ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
