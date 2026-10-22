/**
 * Test de bout en bout du planning Esport (phase 2) :
 *
 *  - faux relais (relais/relais.mjs) et serveur Esport local (esport/outils/serveur-local.mjs) ;
 *  - PC (1440 × 900), le Fondateur : team et invitation (API), compte du hub de Léa
 *    (Administration, modèle « Esport seulement »), puis CRÉATION D'UN ÉVÉNEMENT RÉCURRENT dans
 *    l'écran Planning (vue mois) ;
 *  - iPhone (390 × 844), Léa (Joueur) : rejoint la team, voit l'événement à l'accueil et répond
 *    « Oui » en UN appui ; pas de bouton de création, et 403 en appel direct ;
 *  - PC : MARQUAGE DE LA PRÉSENCE de Léa depuis le détail de l'occurrence, puis STATISTIQUES
 *    (Léa : 100 %) ; export iCal valide ;
 *  - iPhone : disponibilités (créneau) et heatmap, sans défilement horizontal.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-esport-planning.mjs
 *
 * Variable : CAPTURES (dossier des captures, défaut docs/captures-esport-planning).
 */

import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ongletPresent, ongletTeam } from './esport-navigation.mjs';
import { allerPageAdministration, allerPageApplications, nouveauContexte, tuileApp } from './e2e-acceptation.mjs';
import { chargerPlaywright, demarrerRelais, deverrouiller, optionsIphone, pause, premierLancement, racine, totp } from './mobile-outils.mjs';

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-esport-planning');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-esport-planning-0123456789';
const PORT_RELAIS = 8811;
const PORT_ESPORT = 8812;
const PORT_SITE = 5291;
const MDP = 'mot-de-passe-planning-e2e-tres-long-42';
const log = (...a) => console.log('[e2e-planning]', ...a);
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

const { jetonDeProfil } = await import(pathToFileURL(join(racine, 'relais/relais.mjs')).href);
const { demarrerServeurEsport } = await import(pathToFileURL(join(racine, 'esport/outils/serveur-local.mjs')).href);

// ------------------------------------------------------------- Dates (Paris)
const parisAujourdhui = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
};
const plusJours = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const jourIso = d => new Date(Date.parse(`${d}T00:00:00Z`)).getUTCDay() || 7;
const DEMAIN = plusJours(parisAujourdhui(), 1);
const APRES = plusJours(DEMAIN, 2);

// ------------------------------------------------------------- Serveurs
const relais = await demarrerRelais(PORT_RELAIS, JETON);
const esport = await demarrerServeurEsport({ port: PORT_ESPORT, jetonDev: JETON });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff' };
function site(port) {
  const dist = join(racine, 'bureau/dist');
  if (!existsSync(join(dist, 'index.html'))) throw new Error('bureau/dist absent : lancez « npx vite build » d’abord');
  const serveur = http.createServer((req, res) => {
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
  return new Promise(ok => serveur.listen(port, () => ok({ url: `http://localhost:${port}/`, fermer: () => serveur.close() })));
}
const leSite = await site(PORT_SITE);

async function api(chemin, jeton, { methode = 'GET', corps } = {}) {
  const r = await fetch(`${esport.url}${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
  const texte = await r.text();
  let lu = texte;
  try {
    lu = JSON.parse(texte);
  } catch {
    // texte (iCal)
  }
  return { statut: r.status, corps: lu };
}

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
  page.secret = secret;
  return page;
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
  await allerPageApplications(page);
  const tuile = tuileApp(page, 'esport').first();
  await tuile.waitFor({ timeout: 30_000 });
  await tuile.click();
  await page.getByTestId('app-esport').waitFor({ timeout: 20_000 });
}

const debordement = page => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
try {
  // ================================================================ Préparation (API) : team et invitation
  const sessFond = (await api('/session', JETON, { methode: 'POST' })).corps.session;
  await api('/moi', sessFond, { methode: 'PUT', corps: { pseudo: 'Fondateur' } });
  const team = (await api('/teams', sessFond, { methode: 'POST', corps: { nom: 'Faucons Valorant', jeu: 'valorant', preset: 'valorant_complet' } })).corps;
  const teamId = team.team.id;
  const roles = (await api(`/teams/${teamId}/roles`, sessFond)).corps.roles;
  verifier(roles.some(r => r.cle === 'joueur'), 'team prête (API)');

  // ================================================================ PC : compte du hub de Léa
  log('PC : Fondateur, compte « Esport seulement » de Léa');
  const ctxPc = await nouveauContexte(navigateur, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const pc = await compte(ctxPc, leSite.url, relais.code, 'PC');
  await allerPageAdministration(pc);
  await pc.locator('[data-testid="cellule-administration"], [data-testid="tuile-administration"]').first().click();
  await pc.getByTestId('app-administration').waitFor({ timeout: 20_000 });
  await confirmerIdentite(pc);
  await pc.getByTestId('admin-onglet-utilisateurs').click();
  await pc.getByTestId('admin-nouveau').click();
  await pc.getByTestId('admin-nom').fill('Léa');
  await pc.getByTestId('admin-nouveau-modele-esport').click();
  await pc.getByTestId('admin-nouveau-informe').click();
  await pc.getByTestId('admin-creer').click();
  await confirmerIdentite(pc);
  await pc.getByTestId('admin-invitation-lien').first().waitFor({ timeout: 90_000 });
  const lienLea = (await pc.getByTestId('admin-invitation-lien').first().innerText()).trim();
  await pc.getByTestId('admin-transmis').click().catch(() => undefined);
  await pc.getByTestId('admin-termine').click();
  await pc.getByTestId('retour-hub').first().click();

  // ================================================================ iPhone : Léa rejoint la team
  log('iPhone : Léa rejoint la team');
  const ctxLea = await nouveauContexte(navigateur, optionsIphone());
  const lea = await ctxLea.newPage();
  pages.push(['Léa', lea]);
  lea.on('pageerror', e => log('erreur page (Léa) :', e.message));
  await lea.goto(lienLea.replace(/^https?:\/\/[^/]+\//, leSite.url));
  await lea.getByTestId('invitation-mdp').waitFor({ timeout: 60_000 });
  await lea.getByTestId('invitation-mdp').fill('Été à Biarritz 2026 !');
  await lea.getByTestId('invitation-mdp-confirmation').fill('Été à Biarritz 2026 !');
  await lea.getByTestId('invitation-valider').click();
  await lea.getByTestId('hub').waitFor({ timeout: 90_000 });
  await fermerPopups(lea);
  await ouvrirEsport(lea);
  await lea.getByTestId('esport-profil-initial').waitFor({ timeout: 30_000 });
  await lea.getByTestId('esport-pseudo').fill('Léa');
  await lea.getByTestId('esport-pseudo-valider').click();
  await lea.getByTestId('esport-dashboard').waitFor({ timeout: 20_000 });
  const idLea = (await esport.base.premier("SELECT id FROM comptes WHERE pseudo = 'Léa'", [])).id;
  // Invitation directe, sans code : le Fondateur ajoute le compte existant de Léa à la team.
  const ajout = await api(`/teams/${teamId}/membres`, sessFond, { methode: 'POST', corps: { compte: idLea, roleId: roles.find(r => r.cle === 'joueur').id } });
  verifier(ajout.statut === 200, 'Léa est membre (Joueur), ajoutée sans code');
  await lea.getByTestId('esport-nav-teams').click();
  await lea.getByTestId('esport-team-faucons-valorant').waitFor({ timeout: 20_000 });

  // ================================================================ PC : événement récurrent
  log(`PC : création d’un entraînement récurrent (à partir du ${DEMAIN})`);
  await ouvrirEsport(pc);
  await pc.getByTestId('esport-team-faucons-valorant').click();
  await ongletTeam(pc, 'module-planning');
  await pc.getByTestId('esport-planning-mois').waitFor({ timeout: 20_000 });
  await capture(pc, '01-pc-planning-mois-vide');
  await pc.getByTestId('esport-planning-nouveau').click();
  await pc.getByTestId('esport-formulaire').waitFor({ timeout: 20_000 });
  await pc.getByTestId('esport-formulaire-type-training').click();
  await pc.getByTestId('esport-formulaire-titre').fill('Entraînement');
  await pc.getByTestId('esport-formulaire-date').fill(DEMAIN);
  await pc.getByTestId('esport-formulaire-debut').fill('20:00');
  await pc.getByTestId('esport-formulaire-fin').fill('22:00');
  await pc.getByTestId('esport-formulaire-lieu').fill('Discord · Entraînement');
  await pc.getByTestId('esport-formulaire-repeter').click();
  await pc.getByTestId(`esport-formulaire-jour-${jourIso(APRES)}`).click();
  await capture(pc, '02-pc-formulaire-recurrent');
  await pc.getByTestId('esport-formulaire-enregistrer').click();
  await pc.getByTestId('esport-planning-avis').waitFor({ timeout: 20_000 });
  verifier(/Événement créé/.test(await pc.getByTestId('esport-planning-avis').innerText()), 'événement créé');
  const evs = await esport.base.tous('SELECT * FROM planning_evenements WHERE team_id = ?', [teamId]);
  const regle = JSON.parse(evs[0]?.recurrence ?? 'null');
  verifier(evs.length === 1 && regle?.freq === 'hebdo' && regle.jours.length === 2, `règle stockée : ${evs[0]?.recurrence}`);
  const puces = await pc.locator(`[data-testid^="esport-puce-${evs[0].id.slice(0, 8)}"]`).count();
  verifier(puces >= 2, `vue mois : ${puces} occurrence(s) affichée(s)`);
  await capture(pc, '03-pc-planning-mois');
  await pc.getByTestId('esport-planning-vue-semaine').click();
  await pc.getByTestId('esport-planning-semaine').waitFor({ timeout: 10_000 });
  await capture(pc, '04-pc-planning-semaine');

  // ================================================================ iPhone : RSVP en un appui
  log('iPhone : Léa répond « Oui » depuis l’accueil de la team');
  await lea.getByTestId('esport-team-faucons-valorant').click();
  await lea.getByTestId('esport-accueil-prochains').waitFor({ timeout: 20_000 });
  const bouton = lea.getByTestId(`esport-prochain-${DEMAIN}-rsvp-oui`);
  await bouton.waitFor({ timeout: 20_000 });
  verifier((await lea.getByTestId('esport-alerte-rsvp').count()) >= 1, 'alerte de présence : réponse attendue');
  const boite = await bouton.boundingBox();
  verifier(boite && boite.height >= 44, `bouton « Oui » assez grand pour le pouce (${Math.round(boite?.height ?? 0)} px)`);
  await capture(lea, '05-iphone-accueil-rsvp');
  await bouton.click();
  let rsvp;
  for (let i = 0; i < 20 && !rsvp; i++) {
    rsvp = await esport.base.premier("SELECT rsvp FROM presences WHERE compte_id = ? AND rsvp = 'oui'", [idLea]);
    if (!rsvp) await pause(250);
  }
  verifier(rsvp?.rsvp === 'oui', 'RSVP « Oui » enregistré côté serveur');
  await capture(lea, '06-iphone-rsvp-oui');
  verifier(!(await debordement(lea)), 'iPhone (accueil) : pas de défilement horizontal');
  await ongletTeam(lea, 'module-planning');
  await lea.getByTestId('esport-planning-liste').waitFor({ timeout: 20_000 });
  verifier((await lea.getByTestId('esport-planning-nouveau').count()) === 0, 'Joueur : pas de bouton « Nouvel événement »');
  await capture(lea, '07-iphone-planning-liste');
  verifier(!(await debordement(lea)), 'iPhone (planning) : pas de défilement horizontal');
  const sessLea = (await api('/session', await jetonDeProfil(JETON, idLea), { methode: 'POST' })).corps.session;
  verifier((await api(`/teams/${teamId}/planning`, sessLea, { methode: 'POST', corps: { type: 'scrim', titre: 'Piraté', date: DEMAIN, heureDebut: '10:00', heureFin: '11:00' } })).statut === 403, 'Joueur : 403 en création directe');
  verifier((await api(`/teams/${teamId}/planning/${evs[0].id}`, sessLea, { methode: 'DELETE' })).statut === 403, 'Joueur : 403 en suppression directe');

  // ================================================================ PC : marquage de la présence
  log('PC : marquage de la présence');
  await pc.getByTestId('esport-planning-vue-liste').click();
  await pc.getByTestId('esport-planning-liste').waitFor({ timeout: 10_000 });
  await pc.getByTestId(`esport-occ-${evs[0].id.slice(0, 8)}-${DEMAIN}-ouvrir`).click();
  await pc.getByTestId('esport-presence-liste').waitFor({ timeout: 20_000 });
  await pc.getByTestId(`esport-marque-${idLea}-present`).waitFor({ timeout: 20_000 });
  verifier((await pc.getByTestId(`esport-presence-${idLea}`).innerText()).includes('Réponse : Oui'), 'liste de présence : réponse de Léa visible');
  // Un appui enregistre (plus de bouton « Enregistrer la présence » à ne pas oublier).
  await pc.getByTestId(`esport-marque-${idLea}-present`).click();
  await pc.getByTestId('esport-presence-avis').waitFor({ timeout: 20_000 });
  const marque = await esport.base.premier('SELECT reel FROM presences WHERE compte_id = ?', [idLea]);
  verifier(marque?.reel === 'present', 'présence réelle de Léa : présente');
  await capture(pc, '08-pc-marquage');
  // Le détail s'ouvre dans un volet latéral (PC) : on le referme avant de changer de section.
  verifier((await pc.getByTestId('esport-planning-volet').count()) === 1, 'PC : détail de l’occurrence dans un volet latéral (calendrier gardé derrière)');
  await pc.getByTestId('esport-evenement-retour').click();
  await pc.getByTestId('esport-planning-volet').waitFor({ state: 'detached', timeout: 10_000 });

  // ================================================================ PC : statistiques
  log('PC : statistiques de présence');
  await ongletTeam(pc, 'module-attendance');
  await pc.getByTestId('esport-presence-onglet-stats').click();
  await pc.getByTestId('esport-presence-stats').waitFor({ timeout: 20_000 });
  // La réunion a lieu DEMAIN (marquée d'avance) : période « Dates… » qui l'englobe (les périodes toutes faites
  // s'arrêtent à aujourd'hui, la séance de demain y entrera une fois passée).
  await pc.getByTestId('esport-presence-periode-perso').click();
  await pc.getByTestId('esport-presence-du').fill(plusJours(DEMAIN, -89));
  await pc.getByTestId('esport-presence-au').fill(DEMAIN);
  await pc.getByTestId(`esport-stat-joueur-${idLea}-taux`).waitFor({ timeout: 20_000 });
  verifier((await pc.getByTestId(`esport-stat-joueur-${idLea}-taux`).innerText()).trim() === '100 %', 'statistiques : Léa à 100 %');
  verifier((await pc.getByTestId('esport-stat-type-training').count()) === 1, 'statistiques par type d’événement');
  await capture(pc, '09-pc-statistiques');
  const ics = await api(`/teams/${teamId}/planning/export.ics`, sessFond);
  verifier(ics.statut === 200 && ics.corps.startsWith('BEGIN:VCALENDAR\r\n') && ics.corps.includes('SUMMARY:[Entraînement] Entraînement'), 'export iCal');
  const journal = (await api(`/teams/${teamId}/journal?action=attendance`, sessFond)).corps.entrees.map(e => e.action);
  verifier(journal.includes('attendance.rsvp') && journal.includes('attendance.marked'), 'journal : RSVP et marquage');

  // ================================================================ iPhone : disponibilités
  log('iPhone : disponibilités et heatmap');
  await ongletTeam(lea, 'module-availability');
  await lea.getByTestId('esport-dispos-creneaux').waitFor({ timeout: 20_000 });
  await lea.getByTestId('esport-creneau-jour-2').click();
  await lea.getByTestId('esport-creneau-ajouter').click();
  await lea.getByTestId('esport-creneau-enregistrer').click();
  await lea.getByTestId('esport-creneaux-avis').waitFor({ timeout: 20_000 });
  await lea.getByTestId('esport-heatmap-legende').waitFor({ timeout: 20_000 });
  verifier(Number((await esport.base.premier('SELECT COUNT(*) AS n FROM dispo_regles WHERE compte_id = ?', [idLea])).n) === 2, 'créneaux de Léa enregistrés (lundi et mardi)');
  await capture(lea, '10-iphone-disponibilites');
  verifier(!(await debordement(lea)), 'iPhone (disponibilités) : pas de défilement horizontal');
} catch (e) {
  echecs++;
  console.error(e);
  for (const [nom, page] of pages) await page.screenshot({ path: join(CAPTURES, `echec-${nom}.jpg`), type: 'jpeg', quality: 60 }).catch(() => undefined);
} finally {
  await navigateur.close();
  leSite.fermer();
  relais.fermer();
  await esport.fermer();
}
console.log(echecs === 0 ? 'e2e planning Esport : tout est bon' : `e2e planning Esport : ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
