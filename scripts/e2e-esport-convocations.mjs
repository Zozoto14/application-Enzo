/**
 * Test de bout en bout des CONVOCATIONS de l'Esport et du correctif des
 * statistiques de présence, sans Cloudflare :
 *
 *  - faux relais (relais/worker.mjs) et serveur Esport local ;
 *  - PC (1440 × 900), le Fondateur crée une RÉUNION dans l'écran Planning en
 *    convoquant 2 joueurs (Léa, Kai) et 1 Propriétaire choisi (Olga) : pas
 *    lui-même, ni Tom (Joueur non coché) ;
 *  - le cron des rappels relance Léa, Kai et Olga, jamais le Fondateur ni Tom ;
 *    Tom ne peut pas répondre (403) ;
 *  - le Fondateur voit l'événement au calendrier (« vous n'êtes pas convoqué »),
 *    la liste de présence ne contient que les convoqués, il MARQUE la présence
 *    (un appui enregistre) ;
 *  - les STATISTIQUES (3 mois, par mois) comptent les présents et calculent le
 *    taux ; le Fondateur n'y figure pas.
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-esport-convocations.mjs
 *
 * Variable : CAPTURES (dossier des captures, défaut docs/captures-esport-convocations).
 */

import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ongletTeam } from './esport-navigation.mjs';
import { allerPageApplications, nouveauContexte, tuileApp } from './e2e-acceptation.mjs';
import { chargerPlaywright, demarrerRelais, deverrouiller, pause, premierLancement, racine } from './mobile-outils.mjs';

const CAPTURES = process.env.CAPTURES ?? join(racine, 'docs/captures-esport-convocations');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-esport-convocations-01234';
const PORT_RELAIS = 8871;
const PORT_ESPORT = 8872;
const PORT_SITE = 5298;
const MDP = 'mot-de-passe-convocations-e2e-tres-long-42';
const log = (...a) => console.log('[e2e-convocations]', ...a);
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
const { rappelsPresence } = await import(pathToFileURL(join(racine, 'esport/noyau/planning/rappels.mjs')).href);
const { distribuer } = await import(pathToFileURL(join(racine, 'esport/noyau/evenements.mjs')).href);

// ------------------------------------------------------------- Dates (Paris)
const parisAujourdhui = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
};
const plusJours = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const DEMAIN = plusJours(parisAujourdhui(), 1);

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

const { chromium } = chargerPlaywright();
const navigateur = await chromium.launch({ headless: true });
let pc;
try {
  // ================================================================ Préparation (API) : team, joueurs, une 2e Propriétaire
  const sessFond = (await api('/session', JETON, { methode: 'POST' })).corps.session;
  await api('/moi', sessFond, { methode: 'PUT', corps: { pseudo: 'Fondateur' } });
  const teamId = (await api('/teams', sessFond, { methode: 'POST', corps: { nom: 'Faucons Valorant', jeu: 'valorant', preset: 'valorant_complet' } })).corps.team.id;
  const roles = Object.fromEntries((await api(`/teams/${teamId}/roles`, sessFond)).corps.roles.map(r => [r.cle, r]));
  const sessions = {};
  for (const [compte, pseudo, role] of [
    ['lea12345', 'Léa', 'joueur'],
    ['kai12345', 'Kai', 'joueur'],
    ['tom12345', 'Tom', 'joueur'],
    ['own12345', 'Olga', 'proprietaire'],
  ]) {
    sessions[compte] = (await api('/session', await jetonDeProfil(JETON, compte), { methode: 'POST' })).corps.session;
    await api('/moi', sessions[compte], { methode: 'PUT', corps: { pseudo } });
    const ajout = await api(`/teams/${teamId}/membres`, sessFond, { methode: 'POST', corps: { compte, roleId: roles[role].id } });
    verifier(ajout.statut === 200, `${pseudo} membre (${role})`);
  }

  // ================================================================ PC : le Fondateur crée la réunion
  log(`PC : réunion du ${DEMAIN}, 2 joueurs et 1 Propriétaire convoqués`);
  const ctxPc = await nouveauContexte(navigateur, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  pc = await ctxPc.newPage();
  pc.on('pageerror', e => log('erreur page :', e.message));
  const secret = await premierLancement(pc, { site: leSite.url, code: relais.code, motDePasse: MDP });
  await pc.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(pc, MDP, secret));
  await fermerPopups(pc);
  await allerPageApplications(pc);
  await tuileApp(pc, 'esport').first().click();
  await pc.getByTestId('app-esport').waitFor({ timeout: 20_000 });
  await pc.getByTestId('esport-team-faucons-valorant').click();
  await ongletTeam(pc, 'module-planning');
  await pc.getByTestId('esport-planning-nouveau').click();
  await pc.getByTestId('esport-formulaire').waitFor({ timeout: 20_000 });
  await pc.getByTestId('esport-formulaire-type-meeting').click();
  await pc.getByTestId('esport-formulaire-titre').fill('Réunion stratégie');
  await pc.getByTestId('esport-formulaire-date').fill(DEMAIN);
  await pc.getByTestId('esport-formulaire-debut').fill('10:00');
  await pc.getByTestId('esport-formulaire-fin').fill('11:00');
  await pc.getByTestId('esport-formulaire-convocation').waitFor({ timeout: 20_000 });
  // Par défaut : les joueurs (Léa, Kai, Tom), pas le Fondateur ni Olga (Propriétaires).
  const resumeDefaut = await pc.getByTestId('esport-formulaire-convocation-resume').innerText();
  verifier(/Joueurs — 3 convoqués/.test(resumeDefaut) && !/Propriétaire/.test(resumeDefaut), `par défaut : les joueurs, aucun Propriétaire (« ${resumeDefaut} »)`);
  // Joueurs nommément (on retire le raccourci « Joueurs » pour ne pas prendre Tom), puis Olga.
  await pc.getByTestId('esport-formulaire-convocation-groupe-joueurs').click();
  await pc.getByTestId('esport-formulaire-convocation-membre-lea12345').click();
  await pc.getByTestId('esport-formulaire-convocation-membre-kai12345').click();
  await pc.getByTestId('esport-formulaire-convocation-proprietaire-own12345').click();
  verifier(/3 convoqués/.test(await pc.getByTestId('esport-formulaire-convocation-resume').innerText()), 'résumé : 3 convoqués');
  await capture(pc, '01-pc-formulaire-convocation');
  await pc.getByTestId('esport-formulaire-enregistrer').click();
  await pc.getByTestId('esport-planning-avis').waitFor({ timeout: 20_000 });
  const ev = await esport.base.premier('SELECT * FROM planning_evenements WHERE team_id = ?', [teamId]);
  verifier(ev?.convocation === JSON.stringify({ groupes: [], membres: ['kai12345', 'lea12345'], exclus: [], proprietaires: ['own12345'] }), `convocation stockée : ${ev?.convocation}`);

  // ================================================================ Rappels : jamais le Fondateur
  log('cron : rappels de réponse');
  const avant = Date.parse(ev.debut) - 2 * 3_600_000;
  const n = await rappelsPresence(esport.base, { maintenant: avant });
  await distribuer(esport.base, { maintenant: avant });
  const rappels = (await esport.base.tous("SELECT compte_id FROM notifications WHERE type = 'rappel-rsvp' ORDER BY compte_id", [])).map(l => l.compte_id);
  verifier(n === 3 && rappels.join(',') === 'kai12345,lea12345,own12345', `rappels : ${rappels.join(', ')}`);
  verifier(!rappels.includes('principal') && !rappels.includes('tom12345'), 'le Fondateur non coché et Tom ne sont pas relancés');
  const occ = encodeURIComponent(ev.debut);
  verifier((await api(`/teams/${teamId}/planning/${ev.id}/occurrences/${occ}/rsvp`, sessions.tom12345, { methode: 'PUT', corps: { rsvp: 'oui' } })).statut === 403, 'Tom (non convoqué) : 403 en réponse');
  verifier((await api(`/teams/${teamId}/planning/${ev.id}/occurrences/${occ}/rsvp`, sessFond, { methode: 'PUT', corps: { rsvp: 'oui' } })).statut === 403, 'le Fondateur (non coché) : 403 en réponse');
  verifier((await api(`/teams/${teamId}/planning/${ev.id}/occurrences/${occ}/rsvp`, sessions.lea12345, { methode: 'PUT', corps: { rsvp: 'oui' } })).statut === 200, 'Léa répond « Oui »');
  const accueil = (await api(`/teams/${teamId}/planning/accueil`, sessFond)).corps;
  verifier(!accueil.prochains.some(o => o.evenementId === ev.id), 'accueil du Fondateur : la réunion n’est pas dans « ses » prochains événements');

  // ================================================================ PC : détail et marquage
  log('PC : liste de présence et marquage (un appui enregistre)');
  await pc.getByTestId('esport-planning-vue-liste').click();
  await pc.getByTestId('esport-planning-liste').waitFor({ timeout: 10_000 });
  await pc.getByTestId(`esport-occ-${ev.id.slice(0, 8)}-${DEMAIN}-ouvrir`).click();
  await pc.getByTestId('esport-presence-liste').waitFor({ timeout: 20_000 });
  verifier(await pc.getByTestId('esport-evenement-non-convoque').isVisible(), 'détail : « vous n’êtes pas convoqué » pour le Fondateur');
  verifier(/Convoqués \(3\)/.test(await pc.getByTestId('esport-evenement-convoques').innerText()), 'détail : 3 convoqués');
  verifier((await pc.getByTestId('esport-presence-principal').count()) === 0 && (await pc.getByTestId('esport-presence-tom12345').count()) === 0, 'liste de présence : ni le Fondateur ni Tom');
  for (const [compte, reel] of [
    ['lea12345', 'present'],
    ['kai12345', 'absent'],
    ['own12345', 'present'],
  ]) {
    await pc.getByTestId(`esport-marque-${compte}-${reel}`).click();
    let ligne;
    for (let i = 0; i < 20 && ligne?.reel !== reel; i++) {
      ligne = await esport.base.premier('SELECT reel FROM presences WHERE evenement_id = ? AND compte_id = ?', [ev.id, compte]);
      if (ligne?.reel !== reel) await pause(250);
    }
    verifier(ligne?.reel === reel, `${compte} : ${reel} enregistré dès l’appui`);
  }
  await capture(pc, '02-pc-presence-marquee');
  await pc.getByTestId('esport-evenement-retour').click();

  // ================================================================ PC : statistiques
  log('PC : statistiques (3 mois, par mois)');
  await ongletTeam(pc, 'module-attendance');
  await pc.getByTestId('esport-presence-stats').waitFor({ timeout: 20_000 });
  await pc.getByTestId('esport-presence-periode-90').click();
  await pc.getByTestId('esport-presence-granularite-mois').click();
  await pc.getByTestId('esport-stat-joueur-lea12345-taux').waitFor({ timeout: 20_000 });
  const taux = async id => (await pc.getByTestId(id).innerText()).trim();
  verifier((await taux('esport-stat-joueur-lea12345-taux')) === '100 %', 'Léa : 100 %');
  verifier((await taux('esport-stat-joueur-kai12345-taux')) === '0 %', 'Kai : 0 %');
  verifier((await taux('esport-stat-joueur-own12345-taux')) === '100 %', 'Olga (Propriétaire convoquée) : 100 %');
  verifier((await pc.getByTestId('esport-stat-joueur-principal').count()) === 0, 'le Fondateur (non convoqué) n’est pas compté');
  verifier((await taux('esport-presence-taux-global')) === '67 %', 'taux de la team : 67 %');
  verifier(/2 présent/.test(await pc.getByTestId('esport-stat-type-meeting').innerText()), 'Réunions : 2 présents');
  await capture(pc, '03-pc-statistiques');
} catch (e) {
  echecs++;
  console.error(e);
  if (pc) await pc.screenshot({ path: join(CAPTURES, 'echec-pc.jpg'), type: 'jpeg', quality: 60 }).catch(() => undefined);
} finally {
  await navigateur.close();
  leSite.fermer();
  relais.fermer();
  await esport.fermer();
}
console.log(echecs === 0 ? 'e2e convocations Esport : tout est bon' : `e2e convocations Esport : ${echecs} échec(s)`);
process.exit(echecs === 0 ? 0 : 1);
