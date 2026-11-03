/**
 * Test de bout en bout : tableaux CM façon Trello (Esport › Teams › CM du club), site construit dans Chromium,
 * serveur Esport local DERRIÈRE un faux frontal o2switch qui refuse PATCH, PUT et DELETE (POST + X-Methode).
 *
 *  - chaque modification d'une carte depuis l'écran (titre tapé lettre à lettre, description, étiquettes,
 *    échéance, membre, checklist et élément, pièce jointe, commentaire, couverture), relue par l'API ;
 *  - post : textes, soumission, validation, post validé modifié → « à valider », texte saisi PUIS une autre
 *    action de la fiche (le texte reste et s'enregistre : le bug d'enregistrement) ;
 *  - déplacements : menu ⋯ et glisser-déposer ;
 *  - structure : la colonne de 17 cartes défile seule, la page ne défile pas, colonne réduite, fond ;
 *  - calendrier : calendrier d'une team superposé, interrupteur ;
 *  - captures 1440 × 900 et 390 × 844 (CAPTURES).
 *
 *   npx vite build
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-esport-cm-tableaux.mjs
 *   (MOBILE=1 : tout le parcours en 390 × 844)
 */

import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { allerPageApplications, nouveauContexte, tuileApp } from './e2e-acceptation.mjs';
import { demarrerFrontalRestrictif } from './frontal-restrictif.mjs';
import { chargerPlaywright, demarrerRelais, deverrouiller, pause, premierLancement, racine } from './mobile-outils.mjs';

const CAPTURES = process.env.CAPTURES ?? join(racine, '.captures-audit/cm-tableaux');
mkdirSync(CAPTURES, { recursive: true });
const JETON = 'jeton-e2e-esport-cm-tableaux-0123456789';
const PORT_RELAIS = 8871;
const PORT_ESPORT = 8872;
const PORT_SITE = 5321;
const MDP = 'mot-de-passe-esport-e2e-tres-long-42';
const log = (...a) => console.log('[e2e-esport-cm-tableaux]', ...a);
let echecs = 0;
const verifier = (ok, message) => {
  console.log(ok ? '  OK   ' : '  ECHEC', message);
  if (!ok) echecs++;
};

const { demarrerServeurEsport } = await import(pathToFileURL(join(racine, 'esport/outils/serveur-local.mjs')).href);
const relais = await demarrerRelais(PORT_RELAIS, JETON);
const esport = await demarrerServeurEsport({ port: PORT_ESPORT, jetonDev: JETON });
const frontal = await demarrerFrontalRestrictif({ cible: esport.url, port: PORT_ESPORT + 100 });
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
  const ctx = await nouveauContexte(navigateur, { viewport: process.env.MOBILE ? { width: 390, height: 844 } : { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const pc = await ctx.newPage();
  pc.on('pageerror', e => log('erreur page :', e.message));
  pc.on('console', m => { if (m.type() === 'error') log('console :', m.text().slice(0, 300)); });
  pc.on('request', r => { if (r.url().startsWith(frontal.url) && r.method() !== 'GET' && r.method() !== 'OPTIONS') log('->', r.method(), r.url().slice(frontal.url.length), r.headers()['x-methode'] ?? '', (r.postData() ?? '').slice(0, 200)); });
  pc.on('response', r => { if (r.url().startsWith(frontal.url) && r.request().method() !== 'GET' && r.request().method() !== 'OPTIONS') log('<-', r.status(), r.url().slice(frontal.url.length)); });
  pc.secret = await premierLancement(pc, { site: SITE, code: relais.code, motDePasse: MDP });
  await pc.getByTestId('hub').waitFor({ timeout: 60_000 }).catch(() => deverrouiller(pc, MDP, pc.secret));
  for (let i = 0; i < 3; i++) if (!(await pc.getByText(/^(Fermer|Terminé|Compris|Plus tard)$/).first().click({ timeout: 2000 }).then(() => true, () => false))) break;
  const sess = (await api('/session', JETON, { methode: 'POST' })).corps.session;
  await api('/moi', sess, { methode: 'PUT', corps: { pseudo: 'Fondateur' } });
  const club = (await api('/cm/tableaux', sess)).corps.tableaux[0];
  const tb = (await api(`/cm/tableaux/${club.id}`, sess)).corps;
  const carte = (await api(`/cm/tableaux/${club.id}/cartes`, sess, { methode: 'POST', corps: { listeId: tb.listes[0].id, titre: 'Carte à modifier' } })).corps.carte;

  // Tableau « Ligne zéro ALL » comme le Trello de la CM : Demande / The Nuke End (17 cartes) / Valorant.
  const ligneZero = (await api('/cm/tableaux', sess, { methode: 'POST', corps: { nom: 'Ligne zéro ALL', portee: 'club', couleur: '#0c66e4' } })).corps.tableau;
  const colonnes = {};
  for (const nom of ['Demande', 'The Nuke End', 'Valorant']) colonnes[nom] = (await api(`/cm/tableaux/${ligneZero.id}/listes`, sess, { methode: 'POST', corps: { nom } })).corps.id;
  const etiq = {};
  for (const [nom, couleur] of [['Vidéo', '#4bce97'], ['Urgent', '#f87462'], ['Tournoi', '#9f8fef']]) etiq[nom] = (await api(`/cm/tableaux/${ligneZero.id}/etiquettes`, sess, { methode: 'POST', corps: { nom, couleur } })).corps.id;
  const nouvelle = async (liste, titre, extra = {}) => {
    const c = (await api(`/cm/tableaux/${ligneZero.id}/cartes`, sess, { methode: 'POST', corps: { listeId: colonnes[liste], titre, ...(extra.post ? { post: true, reseaux: ['x', 'instagram'] } : {}) } })).corps.carte;
    const patch = {};
    if (extra.etiquettes) patch.etiquettes = extra.etiquettes.map(e => etiq[e]);
    if (extra.description) patch.description = extra.description;
    if (extra.echeance) patch.echeance = extra.echeance;
    if (extra.membres) patch.membres = extra.membres;
    if (Object.keys(patch).length) await api(`/cm/cartes/${c.id}`, sess, { methode: 'PATCH', corps: patch });
    if (extra.checklist) {
      const k = (await api(`/cm/cartes/${c.id}/checklists`, sess, { methode: 'POST', corps: { nom: 'À faire' } })).corps.carte.checklists[0];
      for (const t of extra.checklist) await api(`/cm/checklists/${k.id}/elements`, sess, { methode: 'POST', corps: { texte: t } });
    }
    if (extra.commentaire) await api(`/cm/cartes/${c.id}/commentaires`, sess, { methode: 'POST', corps: { texte: extra.commentaire } });
    return c;
  };
  await nouvelle('Demande', 'Visuel annonce roster');
  await nouvelle('Demande', 'Interview coach', { description: 'Questions à préparer', etiquettes: ['Vidéo'] });
  const nuke = [];
  for (let i = 1; i <= 17; i++) {
    const extra = i % 5 === 0 ? { etiquettes: ['Urgent', 'Tournoi'], echeance: '2026-11-20 18:00', membres: ['principal'] } : i % 4 === 0 ? { description: 'Brief', checklist: ['Script', 'Montage'] } : i % 3 === 0 ? { commentaire: 'Ok pour moi' } : {};
    nuke.push(await nouvelle('The Nuke End', i % 2 ? `Clip ${i} — ace sur Nuke` : `Épisode ${i} : coulisses`, extra));
  }
  await nouvelle('Valorant', 'Annonce match vendredi', { post: true, etiquettes: ['Tournoi'] });
  await nouvelle('Valorant', 'Recap de la semaine');

  await allerPageApplications(pc);
  await tuileApp(pc, 'esport').first().click();
  await pc.getByTestId('app-esport').waitFor({ timeout: 20_000 });
  await pc.getByTestId('esport-nav-teams').first().click();
  await pc.getByTestId('esport-teams-cm-ouvrir').click();
  await pc.getByTestId('esport-cm-groupe-contenus').first().click();
  await pc.getByTestId('esport-cm-tableau-club').click();
  await pc.getByTestId(`esport-cm-carte-${carte.id}-tuile`).click();
  await pc.getByTestId('esport-cm-fiche-titre').waitFor();
  const relire = async () => (await api(`/cm/cartes/${carte.id}`, sess)).corps.carte;
  const erreurFiche = async () => (await pc.getByTestId('esport-cm-fiche-erreur').innerText({ timeout: 500 }).catch(() => ''));
  const etape = async (nom, faire, controle) => {
    try {
      await faire();
      await pause(900);
      const c = await relire();
      const ok = await controle(c);
      const e = await erreurFiche();
      verifier(ok && !e, `${nom}${e ? ` (erreur : ${e})` : ''}`);
    } catch (e) {
      verifier(false, `${nom} : ${e.message.split('\n')[0]}`);
    }
  };
  await etape('titre', async () => {
    await pc.getByTestId('esport-cm-fiche-titre').fill('');
    await pc.getByTestId('esport-cm-fiche-titre').pressSequentially('Titre ', { delay: 30 });
    await pause(process.env.MOBILE ? 100 : 14_000);
    await pc.getByTestId('esport-cm-fiche-titre').pressSequentially('modifié', { delay: 30 });
    await pc.screenshot({ path: join(CAPTURES, 'repro-titre-saisi.jpg'), type: 'jpeg', quality: 70 });
    await pc.getByTestId('esport-cm-fiche-titre-ok').click({ timeout: 3000 });
  }, c => c.titre === 'Titre modifié');
  await etape('description', async () => {
    await pc.getByTestId('esport-cm-fiche-description-champ').click();
    await pc.getByTestId('esport-cm-fiche-description-champ').pressSequentially('Une **description**', { delay: 30 });
    await pc.getByTestId('esport-cm-fiche-description-ok').click();
  }, c => c.description === 'Une **description**');
  await etape('nouvelle étiquette', async () => {
    await pc.getByTestId('esport-cm-etiquette-nouvelle').click();
    await pc.getByTestId('esport-cm-etiquette-nom').fill('Valorant');
    await pc.getByTestId('esport-cm-etiquette-creer').click();
  }, c => c.etiquettes.length === 1);
  await etape('retirer l’étiquette', async () => {
    const c = await relire();
    await pc.getByTestId(`esport-cm-fiche-etiquette-${c.etiquettes[0]}`).click();
  }, c => c.etiquettes.length === 0);
  await etape('échéance', async () => {
    await pc.getByTestId('esport-cm-fiche-echeance-date').fill('2026-12-01');
    await pc.getByTestId('esport-cm-fiche-echeance-heure').fill('18:00');
    await pc.getByTestId('esport-cm-fiche-echeance-ok').click();
  }, c => c.echeance === '2026-12-01T17:00:00.000Z');
  await etape('membre', async () => {
    await pc.getByTestId('esport-cm-fiche-membre-principal').click();
  }, c => c.membres.includes('principal'));
  await etape('checklist', async () => {
    await pc.getByTestId('esport-cm-checklist-nouvelle').fill('À faire');
    await pc.getByTestId('esport-cm-checklist-creer').click();
  }, c => c.checklists.length === 1);
  await etape('élément de checklist', async () => {
    const c = await relire();
    await pc.getByTestId(`esport-cm-checklist-${c.checklists[0].id}-nouveau`).fill('Monter la vidéo');
    await pc.getByTestId(`esport-cm-checklist-${c.checklists[0].id}-ajouter`).click();
  }, c => c.checklists[0]?.elements.length === 1);
  await etape('cocher l’élément', async () => {
    const c = await relire();
    await pc.getByTestId(`esport-cm-element-${c.checklists[0].elements[0].id}`).click();
  }, c => c.checklists[0]?.elements[0]?.fait === true);
  await etape('pièce jointe (lien)', async () => {
    await pc.getByTestId('esport-cm-piece-url').fill('https://site-exemple.fr/affiche');
    await pc.getByTestId('esport-cm-piece-nom').fill('Affiche');
    await pc.getByTestId('esport-cm-piece-ajouter-lien').click();
  }, c => c.pieces.length === 1);
  await etape('commentaire', async () => {
    await pc.getByTestId('esport-cm-commentaire-champ').fill('Bien vu');
    await pc.getByTestId('esport-cm-commenter').click();
  }, c => c.commentaires.length === 1);
  await etape('couverture', async () => {
    await pc.getByTestId('esport-cm-couverture-4bce97').click();
  }, c => c.couverture?.couleur === '#4bce97');
  await pc.screenshot({ path: join(CAPTURES, 'repro-fiche.jpg'), type: 'jpeg', quality: 70, fullPage: true });

  // ---------------------------------------------------------------- Post : textes, validation, invalidation
  const post = (await api(`/cm/tableaux/${club.id}/cartes`, sess, { methode: 'POST', corps: { listeId: tb.listes[0].id, titre: 'Post à préparer', post: true, reseaux: ['x'] } })).corps.carte;
  await pc.getByTestId('esport-cm-fiche-fermer').click();
  await pause(1500);
  await pc.getByTestId(`esport-cm-carte-${post.id}-tuile`).click();
  const relirePost = async () => (await api(`/cm/cartes/${post.id}`, sess)).corps.carte;
  const etapePost = async (nom, faire, controle) => {
    try {
      await faire();
      await pause(900);
      const c = await relirePost();
      const e = await erreurFiche();
      verifier((await controle(c)) && !e, `${nom}${e ? ` (erreur : ${e})` : ''} [statut ${c.statut}]`);
    } catch (e) {
      verifier(false, `${nom} : ${e.message.split('\n')[0]}`);
    }
  };
  await etapePost('post : textes FR/EN', async () => {
    await pc.getByTestId('esport-cm-post-x-fr').fill('Bonjour');
    await pc.getByTestId('esport-cm-post-x-en').fill('Hello');
    await pc.getByTestId('esport-cm-post-enregistrer').click();
  }, c => c.textes.x?.fr === 'Bonjour');
  await etapePost('post : soumettre', () => pc.getByTestId('esport-cm-circuit-soumettre').click(), c => c.statut === 'a_valider');
  await etapePost('post : valider', () => pc.getByTestId('esport-cm-circuit-valider').click(), c => c.statut === 'valide');
  await etapePost('post validé : texte modifié → à valider', async () => {
    await pc.getByTestId('esport-cm-post-x-fr').fill('Bonjour à tous');
    await pc.getByTestId('esport-cm-post-enregistrer').click();
  }, c => c.textes.x?.fr === 'Bonjour à tous' && c.statut === 'a_valider');
  await etapePost('post : texte saisi, PUIS une checklist créée : le texte reste et s’enregistre (bug d’enregistrement)', async () => {
    await pc.getByTestId('esport-cm-checklist-nouvelle').fill('Relire');
    await pc.getByTestId('esport-cm-post-x-en').fill('Hello all');
    await pc.getByTestId('esport-cm-checklist-creer').click();
    await pause(900);
    await pc.getByTestId('esport-cm-post-enregistrer').click({ timeout: 3000 });
  }, c => c.textes.x?.en === 'Hello all');
  await etapePost('post : titre', async () => {
    await pc.getByTestId('esport-cm-fiche-titre').fill('Post renommé');
    await pc.getByTestId('esport-cm-fiche-titre-ok').click();
  }, c => c.titre === 'Post renommé');

  // ---------------------------------------------------------------- Déplacements
  await pc.getByTestId('esport-cm-fiche-fermer').click();
  await pause(1200);
  const listeDe = async id => (await api(`/cm/cartes/${id}`, sess)).corps.carte.listeId;
  try {
    await pc.getByTestId(`esport-cm-carte-${carte.id}-menu`).click();
    await pc.getByTestId(`esport-cm-carte-${carte.id}-droite`).click();
    await pause(1200);
    verifier((await listeDe(carte.id)) === tb.listes[1].id, 'déplacement par le menu ⋯ (liste suivante)');
  } catch (e) {
    verifier(false, `déplacement par le menu : ${e.message.split('\n')[0]}`);
  }
  try {
    const poignee = pc.getByTestId(`esport-cm-carte-${carte.id}-poignee`);
    const boite = await poignee.boundingBox();
    const cibleListe = await pc.getByTestId('esport-cm-liste-a_valider').boundingBox();
    await pc.mouse.move(boite.x + boite.width / 2, boite.y + boite.height / 2);
    await pc.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await pc.mouse.move(boite.x + ((cibleListe.x + 60 - boite.x) * i) / 12, boite.y + 40 * (i / 12), { steps: 2 });
      await pause(40);
    }
    await pc.mouse.up();
    await pause(1500);
    verifier((await listeDe(carte.id)) === tb.listes[2].id, 'glisser-déposer vers « À valider »');
  } catch (e) {
    verifier(false, `glisser-déposer : ${e.message.split('\n')[0]}`);
  }

  // ---------------------------------------------------------------- Structure façon Trello (colonne de 17 cartes)
  const surface = async sel => pc.locator(`[data-testid="${sel}"]`).first().evaluate(e => {
    const r = e.getBoundingClientRect();
    return { haut: r.top, bas: r.bottom, hauteur: r.height, largeur: r.width, scrollHeight: e.scrollHeight, clientHeight: e.clientHeight, scrollTop: e.scrollTop };
  });
  try {
    await pc.getByTestId('esport-cm-tableau-retour').click();
    await pc.getByTestId(`esport-cm-tableau-${ligneZero.id}`).click();
    await pc.getByTestId(`esport-cm-liste-${colonnes['The Nuke End']}-cartes`).waitFor();
    await pause(800);
    // Fond : dégradé (voile sombre par-dessus).
    await pc.getByTestId('esport-cm-tableau-menu').click();
    await pc.getByTestId('esport-cm-tableau-fond').click();
    await pc.getByTestId('esport-cm-fond-degrade-ocean').click();
    await pc.getByTestId('esport-cm-voile').waitFor({ timeout: 5000 });
    verifier((await api(`/cm/tableaux/${ligneZero.id}`, sess)).corps.tableau.fond?.cle === 'ocean', 'fond « Océan » enregistré (POST + X-Methode: PATCH)');
    await pause(500);
    const col = await surface(`esport-cm-liste-${colonnes['The Nuke End']}-cartes`);
    verifier(col.scrollHeight > col.clientHeight + 50, `la colonne de 17 cartes a sa propre barre de défilement (${col.scrollHeight} > ${col.clientHeight})`);
    const zone = await surface('esport-cm-zone');
    const vue = pc.viewportSize();
    verifier(zone.bas <= vue.height + 1, `le tableau tient dans la fenêtre (bas ${Math.round(zone.bas)} ≤ ${vue.height})`);
    await pc.locator(`[data-testid="esport-cm-liste-${colonnes['The Nuke End']}-cartes"]`).first().evaluate(e => e.scrollBy(0, 260));
    await pause(400);
    verifier((await surface(`esport-cm-liste-${colonnes['The Nuke End']}-cartes`)).scrollTop > 0, 'la colonne défile, pas la page');
    verifier((await surface(`esport-cm-ajout-${colonnes['The Nuke End']}`)).bas <= zone.bas + 1, '« + Ajouter une carte » reste visible en bas de la colonne');
    const simple = await surface(`esport-cm-carte-${nuke[0].id}`);
    const riche = await surface(`esport-cm-carte-${nuke[4].id}`);
    verifier(simple.hauteur <= 48, `carte sans information : compacte (${Math.round(simple.hauteur)} px)`);
    verifier(riche.hauteur > simple.hauteur + 20, `carte avec étiquettes, échéance et membre : plus haute (${Math.round(riche.hauteur)} px)`);
    await pc.screenshot({ path: join(CAPTURES, `tableau-${vue.width}x${vue.height}.png`) });
    // Colonne réduite : bande verticale, choix mémorisé en base.
    await pc.getByTestId(`esport-cm-liste-${colonnes.Demande}-reduire`).click();
    await pause(800);
    const prefs = (await api('/cm/preferences', sess)).corps.preferences;
    verifier(JSON.stringify(prefs[`tableau.${ligneZero.id}.reduites`]) === JSON.stringify([colonnes.Demande]), 'colonne « Demande » réduite, mémorisée pour le compte');
    verifier((await surface(`esport-cm-liste-${colonnes.Demande}`).catch(() => surface('esport-cm-liste-' + colonnes.Demande))).largeur < 60, 'colonne réduite : bande verticale');
    await pc.screenshot({ path: join(CAPTURES, `tableau-${vue.width}x${vue.height}-colonne-reduite.png`) });
    await pc.getByTestId(`esport-cm-liste-${colonnes.Demande}`).click();
    await pc.getByTestId(`esport-cm-liste-${colonnes.Demande}-cartes`).waitFor({ timeout: 5000 });
    verifier(true, 'colonne « Demande » agrandie d’un clic');
    await pause(600);
    // Téléphone : une colonne par écran.
    if (!process.env.MOBILE) {
      await pc.setViewportSize({ width: 390, height: 844 });
      await pause(1500);
      // Le passage au format téléphone remonte la page (autre mise en page) : on rouvre le tableau si besoin.
      if (!(await pc.getByTestId(`esport-cm-liste-${colonnes.Demande}`).count())) {
        await pc.getByTestId(`esport-cm-tableau-${ligneZero.id}`).click();
        await pc.getByTestId(`esport-cm-liste-${colonnes.Demande}`).waitFor();
        await pause(1200);
      }
      const col2 = await surface(`esport-cm-liste-${colonnes.Demande}`);
      verifier(col2.largeur > 300 && col2.largeur <= 390, `téléphone : une colonne par écran (${Math.round(col2.largeur)} px)`);
      const zone2 = await surface('esport-cm-zone');
      verifier(zone2.bas <= 844 - 56, `téléphone : le tableau tient au-dessus de la barre du bas (bas ${Math.round(zone2.bas)})`);
      await pc.screenshot({ path: join(CAPTURES, 'tableau-390x844.png') });
      await pc.locator('[data-testid="esport-cm-listes"]').first().evaluate(e => e.scrollBy({ left: 400 }));
      await pause(900);
      await pc.screenshot({ path: join(CAPTURES, 'tableau-390x844-colonne-2.png') });
      await pc.setViewportSize({ width: 1440, height: 900 });
      await pause(1000);
    }
  } catch (e) {
    verifier(false, `structure du tableau : ${e.message.split('\n')[0]}`);
  }

  // ---------------------------------------------------------------- Calendrier : calendrier d'une team superposé
  try {
    const team = (await api('/teams', sess, { methode: 'POST', corps: { nom: 'Faucons Valorant', jeu: 'valorant', preset: 'valorant_complet' } })).corps.team;
    const demain = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const ev = await api(`/teams/${team.id}/planning`, sess, { methode: 'POST', corps: { type: 'match', titre: 'Match contre Nova', date: demain, heureDebut: '20:00', heureFin: '22:00', convocation: { groupes: ['joueurs'] } } });
    verifier(ev.statut === 200, `match au planning de la team (${ev.statut})`);
    await pc.getByTestId('esport-cm-groupe-contenus').first().click();
    await pc.getByTestId('esport-cm-onglet-calendrier').first().click();
    await pc.getByTestId(`esport-cm-calendrier-team-${team.id}`).waitFor({ timeout: 15_000 });
    const evenement = pc.locator(`[data-testid^="esport-cm-calendrier-ev-${team.id}-"]`).first();
    await evenement.waitFor({ timeout: 10_000 });
    verifier(true, 'calendrier de la team superposé au calendrier éditorial');
    await pc.screenshot({ path: join(CAPTURES, 'calendrier-1440x900.png') });
    await pc.getByTestId(`esport-cm-calendrier-team-${team.id}`).click();
    await pause(800);
    verifier((await pc.locator(`[data-testid^="esport-cm-calendrier-ev-${team.id}-"]`).count()) === 0, 'interrupteur : la team masquée disparaît');
    verifier((await api('/cm/preferences', sess)).corps.preferences['calendrier.teams']?.[team.id] === false, 'choix des teams mémorisé en base');
    await pc.getByTestId(`esport-cm-calendrier-team-${team.id}`).click();
    await pc.locator(`[data-testid^="esport-cm-calendrier-ev-${team.id}-"]`).first().click();
    await pc.getByTestId('esport-cm-calendrier-creer-post').click();
    await pause(1500);
    const tous = (await api(`/cm/tableaux/${club.id}`, sess)).corps.cartes;
    verifier(tous.some(c => c.titre === 'Match contre Nova' && c.post && c.datePublication), '« Créer un post pour cet événement » : post daté dans « Idées »');
  } catch (e) {
    verifier(false, `calendrier : ${e.message.split('\n')[0]}`);
  }
} finally {
  await navigateur.close();
  await new Promise(ok => serveurSite.close(ok));
  await frontal.fermer?.();
  await esport.fermer();
  await relais.fermer?.();
}
log(echecs ? `${echecs} échec(s)` : 'tout est vert');
process.exit(echecs ? 1 : 0);
