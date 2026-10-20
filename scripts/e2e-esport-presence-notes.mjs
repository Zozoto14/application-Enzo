/**
 * Test de bout en bout de la REFONTE DE LA PRÉSENCE et du SUIVI DES JOUEURS
 * (notes du staff), sans Cloudflare :
 *
 *  - faux relais (relais/worker.mjs) et serveur Esport local ;
 *  - préparation (API) : team « valorant_complet » (le Suivi joueurs y est), Léa
 *    et Kai (Joueurs), Zed (Coach), et un entraînement d'hier soir où les
 *    joueurs sont convoqués ;
 *  - iPhone (390 × 844), le Fondateur : Agenda › Présence › « À marquer (1) »,
 *    FEUILLE D'APPEL plein écran : « Tout le monde présent », puis Kai « En
 *    retard » de 15 minutes, et Zed (Coach, non convoqué) ajouté « venu sans
 *    convocation » ; chaque appui est en base aussitôt ; « À marquer » se vide ;
 *    les STATISTIQUES sont justes (100 %, ponctualité 50 %, retard moyen 15 min,
 *    Zed hors des taux) ; pas de défilement horizontal ;
 *  - PC (1440 × 900), le Fondateur : Équipe › Suivi joueurs › fiche de Léa,
 *    NOUVELLE NOTE (privée par défaut) ; Léa (API) ne la voit pas (fiche 403,
 *    « mes notes » vide) ; le Fondateur la PARTAGE (menu ⋯) ;
 *  - iPhone, Léa (compte du hub « Esport seulement ») : la note partagée est sur
 *    l'accueil de la team, en lecture, et l'onglet Suivi joueurs n'existe pas
 *    pour elle ; le journal ne contient pas le texte de la note.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-esport-presence-notes.mjs
 *
 * Variable : CAPTURES (dossier des captures, défaut docs/captures-esport-presence-notes).
 */

import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ongletPresent, ongletTeam } from './esport-navigation.mjs';
import { allerPageAdministration, allerPageApplications, nouveauContexte, tuileApp } from './e2e-acceptation.mjs';
import { chargerPlaywright, demarrerRelais, deverrouiller, optionsIphone, pause, premierLancement, racine, totp } from './mobile-outils.mjs';

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-esport-presence-notes');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-esport-presence-notes-0123';
const PORT_RELAIS = 8883;
const PORT_ESPORT = 8884;
const PORT_SITE = 5303;
const MDP = 'mot-de-passe-presence-notes-e2e-tres-long-42';
const NOTE = 'Comms tardives en retake : annoncer plus tôt les contacts.';
const log = (...a) => console.log('[e2e-presence-notes]', ...a);
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

const parisAujourdhui = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
};
const plusJours = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const HIER = plusJours(parisAujourdhui(), -1);

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
    // texte
  }
  return { statut: r.status, corps: lu };
}

async function fermerPopups(page) {
  for (let i = 0; i < 3; i++) {
    const clique = await page.getByText(/^(Fermer|Terminé|Compris|Plus tard)$/).first().click({ timeout: 2000 }).then(() => true, () => false);
    if (!clique) break;
  }
}

async function confirmerIdentite(page, secret) {
  if (!(await page.getByTestId('admin-identite-mdp').waitFor({ timeout: 8_000 }).then(() => true, () => false))) return;
  for (const decalage of [0, 1, -1]) {
    await page.getByTestId('admin-identite-mdp').fill(MDP);
    await page.getByTestId('admin-identite-code').fill(totp(secret, decalage));
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

/** Attend qu'une condition sur la base soit vraie (l'appui part en arrière-plan). */
async function attendre(f, essais = 24) {
  for (let i = 0; i < essais; i++) {
    const v = await f();
    if (v) return v;
    await pause(250);
  }
  return f();
}

const debordement = page => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
const pages = [];
try {
  // ================================================================ Préparation (API)
  const sessFond = (await api('/session', JETON, { methode: 'POST' })).corps.session;
  await api('/moi', sessFond, { methode: 'PUT', corps: { pseudo: 'Fondateur' } });
  const teamId = (await api('/teams', sessFond, { methode: 'POST', corps: { nom: 'Faucons Valorant', jeu: 'valorant', preset: 'valorant_complet' } })).corps.team.id;
  const roles = Object.fromEntries((await api(`/teams/${teamId}/roles`, sessFond)).corps.roles.map(r => [r.cle, r]));
  for (const [compte, pseudo, role] of [
    ['kai12345', 'Kai', 'joueur'],
    ['zed12345', 'Zed', 'coach'],
  ]) {
    const s = (await api('/session', await jetonDeProfil(JETON, compte), { methode: 'POST' })).corps.session;
    await api('/moi', s, { methode: 'PUT', corps: { pseudo } });
    verifier((await api(`/teams/${teamId}/membres`, sessFond, { methode: 'POST', corps: { compte, roleId: roles[role].id } })).statut === 200, `${pseudo} membre (${role})`);
  }

  // ================================================================ PC : compte du hub de Léa (Esport seulement)
  log('PC : compte du hub de Léa');
  const ctxPc = await nouveauContexte(navigateur, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const pc = await ctxPc.newPage();
  pages.push(['PC', pc]);
  pc.on('pageerror', e => log('erreur page (PC) :', e.message));
  const secret = await premierLancement(pc, { site: leSite.url, code: relais.code, motDePasse: MDP });
  await pc.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(pc, MDP, secret));
  await fermerPopups(pc);
  await allerPageAdministration(pc);
  await pc.locator('[data-testid="cellule-administration"], [data-testid="tuile-administration"]').first().click();
  await pc.getByTestId('app-administration').waitFor({ timeout: 20_000 });
  await confirmerIdentite(pc, secret);
  await pc.getByTestId('admin-onglet-utilisateurs').click();
  await pc.getByTestId('admin-nouveau').click();
  await pc.getByTestId('admin-nom').fill('Léa');
  await pc.getByTestId('admin-nouveau-modele-esport').click();
  await pc.getByTestId('admin-nouveau-informe').click();
  await pc.getByTestId('admin-creer').click();
  await confirmerIdentite(pc, secret);
  await pc.getByTestId('admin-invitation-lien').first().waitFor({ timeout: 90_000 });
  const lienLea = (await pc.getByTestId('admin-invitation-lien').first().innerText()).trim();
  await pc.getByTestId('admin-transmis').click().catch(() => undefined);
  await pc.getByTestId('admin-termine').click();
  await pc.getByTestId('retour-hub').first().click();

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
  verifier((await api(`/teams/${teamId}/membres`, sessFond, { methode: 'POST', corps: { compte: idLea, roleId: roles.joueur.id } })).statut === 200, 'Léa membre (Joueur)');
  const sessLea = (await api('/session', await jetonDeProfil(JETON, idLea), { methode: 'POST' })).corps.session;

  // Les joueurs sont arrivés il y a un mois : convoqués à l'entraînement d'hier.
  await esport.base.executer('UPDATE membres SET rejoint_le = ? WHERE team_id = ?', [new Date(Date.now() - 30 * 86_400_000).toISOString(), teamId]);
  const ev = (await api(`/teams/${teamId}/planning`, sessFond, { methode: 'POST', corps: { type: 'training', titre: 'Entraînement du soir', date: HIER, heureDebut: '20:00', heureFin: '22:00' } })).corps;
  verifier(Boolean(ev.id), `entraînement d’hier (${HIER}) créé`);
  const aMarquerApi = (await api(`/teams/${teamId}/presence/a-marquer`, sessFond)).corps;
  verifier(aMarquerApi.total === 1 && aMarquerApi.seances[0].restants === 2, `à marquer (API) : 1 séance, 2 convoqués (${JSON.stringify(aMarquerApi.seances?.map(s => s.restants))})`);

  // ================================================================ iPhone : feuille d'appel
  log('iPhone : feuille d’appel');
  const ctxIph = await nouveauContexte(navigateur, optionsIphone());
  const iph = await ctxIph.newPage();
  pages.push(['iPhone', iph]);
  iph.on('pageerror', e => log('erreur page (iPhone) :', e.message));
  const secretIph = await premierLancement(iph, { site: leSite.url, code: relais.code, motDePasse: MDP });
  await iph.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(iph, MDP, secretIph));
  await fermerPopups(iph);
  await ouvrirEsport(iph);
  await iph.getByTestId('esport-team-faucons-valorant').first().click();
  await ongletTeam(iph, 'module-attendance');
  await iph.getByTestId('esport-presence-a-marquer').waitFor({ timeout: 20_000 });
  verifier((await iph.getByTestId('esport-presence-onglet-a-marquer').innerText()).includes('(1)'), 'onglet « À marquer (1) » avec son compteur');
  const carte = `esport-a-marquer-${ev.id.slice(0, 8)}-${HIER}`;
  verifier(/2 à marquer sur 2/.test(await iph.getByTestId(`${carte}-restants`).innerText()), 'séance : « 2 à marquer sur 2 »');
  await capture(iph, '01-iphone-a-marquer');
  await iph.getByTestId(`${carte}-appel`).click();
  await iph.getByTestId('esport-presence-seance').waitFor({ timeout: 20_000 });
  verifier(await iph.getByTestId('esport-presence-fermer').isVisible(), 'feuille d’appel plein écran (bouton Retour)');
  await capture(iph, '02-iphone-feuille-appel');
  const ligne = compte => esport.base.premier('SELECT * FROM presences WHERE evenement_id = ? AND compte_id = ?', [ev.id, compte]);

  await iph.getByTestId('esport-presence-tout-present').click();
  const tous = await attendre(async () => (await ligne(idLea))?.reel === 'present' && (await ligne('kai12345'))?.reel === 'present');
  verifier(tous, '« Tout le monde présent » : Léa et Kai présents en base, en un appui');
  await iph.getByTestId('esport-marque-kai12345-retard').click();
  await iph.getByTestId('esport-presence-kai12345-ok').waitFor({ timeout: 10_000 });
  verifier(await attendre(async () => (await ligne('kai12345'))?.reel === 'retard'), 'Kai « En retard » enregistré dès l’appui (✓ Enregistré sur sa ligne)');
  await iph.getByTestId('esport-presence-kai12345-min-15').click();
  verifier(await attendre(async () => Number((await ligne('kai12345'))?.retard_minutes) === 15), 'Kai : 15 minutes de retard enregistrées');
  await iph.getByTestId('esport-presence-ajouter').click();
  await iph.getByTestId('esport-presence-ajouter-zed12345').click();
  verifier(await attendre(async () => Number((await ligne('zed12345'))?.hors_convocation) === 1), 'Zed (non convoqué) ajouté « venu sans convocation »');
  await iph.getByTestId('esport-presence-zed12345-hors').waitFor({ timeout: 10_000 });
  verifier(!(await debordement(iph)), 'iPhone (feuille d’appel) : pas de défilement horizontal');
  await capture(iph, '03-iphone-feuille-appel-marquee');
  await iph.getByTestId('esport-presence-fermer').click();
  await iph.getByTestId('esport-presence-a-marquer-vide').waitFor({ timeout: 20_000 });
  verifier(true, '« À marquer » vide : tout est marqué');

  // Statistiques
  await iph.getByTestId('esport-presence-onglet-stats').click();
  await iph.getByTestId('esport-presence-taux-global').waitFor({ timeout: 20_000 });
  verifier((await iph.getByTestId('esport-presence-taux-global').innerText()).trim() === '100 %', 'taux de la team : 100 % (présent + en retard)');
  verifier((await iph.getByTestId(`esport-stat-joueur-${idLea}-taux`).innerText()).trim() === '100 %', 'Léa : 100 %');
  verifier((await iph.getByTestId('esport-stat-joueur-kai12345-taux').innerText()).trim() === '100 %', 'Kai : 100 % (un retard compte présent)');
  const kai = await iph.getByTestId('esport-stat-joueur-kai12345').innerText();
  verifier(/1 en retard/.test(kai) && /ponctualité 0 %/.test(kai), `Kai : 1 en retard, ponctualité 0 % (« ${kai.replace(/\s+/g, ' ')} »)`);
  const zed = await iph.getByTestId('esport-stat-joueur-zed12345-taux').innerText();
  verifier(/non convoqué/.test(zed), 'Zed : « non convoqué », hors des taux');
  const pageStats = await iph.getByTestId('esport-presence-stats').innerText();
  verifier(!/(^|\s)—(\s|$)/.test(pageStats), 'statistiques : aucun « — »');
  verifier(/retard moyen : 15 min/.test(pageStats), 'ponctualité : retard moyen 15 min');
  verifier(!(await debordement(iph)), 'iPhone (statistiques) : pas de défilement horizontal');
  await capture(iph, '04-iphone-statistiques');
  // Fiche de Kai.
  await iph.getByTestId('esport-stat-joueur-kai12345').click();
  await iph.getByTestId('esport-fiche-presence').waitFor({ timeout: 20_000 });
  verifier(/En retard \(15 min\)/.test(await iph.getByTestId('esport-fiche-presence-historique').innerText()), 'fiche de Kai : « En retard (15 min) »');
  await capture(iph, '05-iphone-fiche-kai');
  // CSV : les mêmes chiffres.
  const csv = (await api(`/teams/${teamId}/presence/export.csv?periode=7`, sessFond)).corps;
  verifier(csv.includes('"Kai","Oui","Sans réponse","","","En retard","15"') && csv.includes('"Zed","Non (venu en plus)"'), 'CSV : retard en minutes et venue sans convocation');

  // ================================================================ PC : note du staff
  log('PC : suivi joueurs, nouvelle note sur Léa');
  await ouvrirEsport(pc);
  await pc.getByTestId('esport-team-faucons-valorant').first().click();
  await ongletTeam(pc, 'module-player_notes');
  await pc.getByTestId(`esport-suivi-joueur-${idLea}`).click();
  await pc.getByTestId('esport-suivi-fiche').waitFor({ timeout: 20_000 });
  verifier((await pc.getByTestId('esport-suivi-resume-presence').innerText()).trim() === '100 %', 'résumé de la fiche : présence 100 % (depuis la refonte)');
  await pc.getByTestId('esport-suivi-nouvelle').click();
  await pc.getByTestId('esport-suivi-contenu').fill(NOTE);
  await pc.getByTestId('esport-suivi-categorie-communication').click();
  await pc.getByTestId('esport-suivi-ton-a_travailler').click();
  await pc.getByTestId('esport-suivi-tags').fill('comms, retake');
  await capture(pc, '06-pc-nouvelle-note');
  await pc.getByTestId('esport-suivi-enregistrer').click();
  await pc.getByTestId('esport-suivi-fiche-avis').waitFor({ timeout: 20_000 });
  const note = await esport.base.premier('SELECT * FROM notes_joueurs WHERE joueur_id = ?', [idLea]);
  verifier(note?.contenu === NOTE && Number(note.partagee) === 0 && note.categorie === 'communication', 'note enregistrée, privée par défaut');
  // Léa ne voit pas la note privée.
  verifier((await api(`/teams/${teamId}/suivi/${idLea}`, sessLea)).statut === 403, 'Léa : sa fiche lui est refusée (403)');
  verifier((await api(`/teams/${teamId}/suivi/moi`, sessLea)).corps.notes?.length === 0, 'Léa : aucune note visible (note privée)');
  await capture(pc, '07-pc-fiche-note');
  // Partage (menu ⋯).
  const idNote = `esport-suivi-note-${note.id.slice(0, 8)}`;
  await pc.getByTestId(`${idNote}-menu`).click();
  await pc.getByTestId(`${idNote}-partager`).click();
  await pc.getByTestId(`${idNote}-partagee`).waitFor({ timeout: 20_000 });
  verifier(Number((await esport.base.premier('SELECT partagee FROM notes_joueurs WHERE id = ?', [note.id])).partagee) === 1, 'note partagée avec Léa');
  await capture(pc, '08-pc-note-partagee');

  // ================================================================ iPhone : Léa voit la note partagée
  log('iPhone : Léa voit la note partagée, en lecture');
  await lea.getByTestId('esport-nav-teams').click();
  await lea.getByTestId('esport-team-faucons-valorant').first().click();
  await lea.getByTestId('esport-mes-notes').waitFor({ timeout: 20_000 });
  verifier((await lea.getByTestId('esport-mes-notes').innerText()).includes('Comms tardives en retake'), 'Léa : la note partagée est sur son accueil');
  verifier((await lea.getByTestId('esport-suivi-nouvelle').count()) === 0, 'Léa : rien à modifier (lecture seule)');
  await lea.getByTestId('esport-mes-notes').scrollIntoViewIfNeeded();
  await capture(lea, '09-iphone-lea-note-partagee');
  verifier(!(await ongletPresent(lea, 'module-player_notes')), 'Léa : pas d’onglet « Suivi joueurs »');
  const journal = await esport.base.tous("SELECT meta FROM journal WHERE action LIKE 'player_note.%'", []);
  verifier(journal.length >= 2 && !journal.some(j => j.meta.includes('Comms')), 'journal : « note ajoutée sur Léa », sans le texte');
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
console.log(echecs === 0 ? 'e2e présence et suivi des joueurs : tout est bon' : `e2e présence et suivi des joueurs : ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
