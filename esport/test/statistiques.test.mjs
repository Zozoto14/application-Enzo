/**
 * Statistiques d'usage internes (migration 0018) : collecte par lots, page « Statistiques » réservée au
 * Fondateur (404 pour tout autre compte, Propriétaire compris), agrégation journalière par le cron,
 * rétention (90 jours de détail brut), RGPD (export, effacement), désactivation de la collecte, limites
 * de débit, reconstitution de l'historique depuis le journal. SQLite et PostgreSQL (ESPORT_TEST_PG).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { tachesPlanifiees } from '../noyau/cron.mjs';
import { agregerUsage, nettoyerMessage, noterCommandeBot, purgerUsage } from '../noyau/usage/collecte.mjs';
import { exporterBase } from '../noyau/transfert.mjs';

const MEMBRES = {
  lea12345: { pseudo: 'Léa', role: 'joueur' },
  kai12345: { pseudo: 'Kai', role: 'joueur' },
  own12345: { pseudo: 'Olga', role: 'proprietaire' },
};

async function preparer() {
  const b = await banc();
  const t = await teamAvecMembres(b, { membres: MEMBRES });
  return { b, ...t };
}

const lot = (evenements, { session = 'sessionA1', appareil = 'pc', langue = 'fr' } = {}) => ({ session, appareil, langue, evenements });
const page = (p, d, t) => ({ g: 'page', p, d, ...(t ? { t } : {}) });

/** Sessions renouvelées (elles durent une heure) après un saut de l'horloge. */
async function rafraichir(b, sessions) {
  for (const compte of Object.keys(sessions)) sessions[compte] = await b.session(compte === 'fondateur' ? 'principal' : compte);
}

async function envoyer(b, jeton, corps, ip = '203.0.113.77') {
  return b.appel('/usage', { methode: 'POST', jeton, corps, ip, entetes: { 'X-Forwarded-For': ip } });
}

test('route /statistiques : 404 pour tout autre compte que le Fondateur, Propriétaire compris', async () => {
  const { b, sessions } = await preparer();
  for (const compte of ['lea12345', 'own12345']) {
    for (const [chemin, methode, corps] of [
      ['/statistiques', 'GET'],
      ['/statistiques?du=2026-10-01&au=2026-10-20', 'GET'],
      ['/statistiques/reglages', 'GET'],
      ['/statistiques/reglages', 'PUT', { collecte: false }],
      ['/statistiques/membres/lea12345', 'GET'],
      ['/api/esport/statistiques', 'GET'],
    ]) {
      const r = await b.appel(chemin, { methode, jeton: sessions[compte], corps });
      assert.equal(r.statut, 404, `${compte} ${methode} ${chemin}`);
      assert.equal(r.corps.code, 'route');
    }
  }
  assert.equal((await b.appel('/statistiques')).statut, 401, 'sans session : 401');
  const f = await b.appel('/statistiques', { jeton: sessions.fondateur });
  assert.equal(f.statut, 200);
  assert.ok(f.corps.apercu && f.corps.pages && f.corps.activite && f.corps.fonctions);
  // La collecte n'a pas été coupée par la tentative du Propriétaire.
  assert.equal((await b.appel('/statistiques/reglages', { jeton: sessions.fondateur })).corps.collecte, true);
});

test('ingestion par lots : validation, team vérifiée, aucune adresse IP ni contenu stocké', async () => {
  const { b, sessions, teamId } = await preparer();
  const autreTeam = '00000000-0000-4000-8000-000000000000';
  const r = await envoyer(
    b,
    sessions.lea12345,
    lot([
      page('esport.dashboard', 12_000),
      page('team.agenda.planning', 30_000, teamId),
      page('team.jeu.strats', 5_000, autreTeam),
      { g: 'action', a: 'rsvp', t: teamId },
      { g: 'action', a: 'piratage.total' },
      { g: 'action', a: 'bot.commande' },
      { g: 'page', p: '<script>' },
      { g: 'page', p: 'esport.teams', d: 99 * 3_600_000 },
      { g: 'erreur', p: 'team.agenda.planning', m: 'TypeError: x is undefined https://site.test/?jeton=abcdef léa@exemple.fr 1234567' },
      null,
      'texte',
    ]),
  );
  assert.equal(r.statut, 200);
  assert.deepEqual(r.corps, { actif: true, recus: 6 });
  const lignes = await b.base.tous("SELECT * FROM usage_evenements WHERE compte_id = 'lea12345' ORDER BY genre, page", []);
  assert.equal(lignes.length, 6);
  assert.ok(!Object.keys(lignes[0]).some(c => /ip|adresse/i.test(c)), 'aucune colonne d’adresse IP');
  assert.ok(!JSON.stringify(lignes).includes('203.0.113.77'), 'l’adresse IP n’est écrite nulle part');
  const strats = lignes.find(l => l.page === 'team.jeu.strats');
  assert.equal(strats.team_id, null, 'une team dont il n’est pas membre n’est pas retenue');
  assert.equal(Number(lignes.find(l => l.page === 'esport.teams').duree_ms), 4 * 3_600_000, 'durée bornée à 4 h');
  const erreur = lignes.find(l => l.genre === 'erreur');
  assert.equal(erreur.message, 'TypeError: x is undefined <url> <e-mail> #');
  assert.ok(!lignes.some(l => l.action === 'bot.commande' || l.action === 'piratage.total'), 'actions hors liste ignorées');
  // Lots illisibles.
  assert.equal((await envoyer(b, sessions.lea12345, lot([], { session: 'x' }))).statut, 400);
  assert.equal((await envoyer(b, sessions.lea12345, lot([], { appareil: 'grille-pain' }))).statut, 400);
  assert.equal((await envoyer(b, sessions.lea12345, lot(Array.from({ length: 101 }, () => page('esport.dashboard', 1))))).statut, 413);
  const texte = await b.appel('/usage', { methode: 'POST', jeton: sessions.lea12345, corps: lot([]), type: 'text/plain' });
  assert.equal(texte.statut, 415, 'corps non JSON refusé (pas de requête « simple » d’un site tiers)');
  assert.equal((await b.appel('/usage', { methode: 'POST', corps: lot([]) })).statut, 401, 'sans session : 401');
  // Âge annoncé (envoi différé) : l'heure de l'événement est reculée, 10 minutes au plus.
  await envoyer(b, sessions.kai12345, lot([{ ...page('esport.membres', 1000), il: 60_000 }, { ...page('esport.teams', 1000), il: 86_400_000 }], { session: 'sessionK1' }));
  const kai = await b.base.tous("SELECT page, cree_le FROM usage_evenements WHERE compte_id = 'kai12345' ORDER BY page", []);
  assert.equal(kai.find(l => l.page === 'esport.membres').cree_le, new Date(b.horloge.t - 60_000).toISOString());
  assert.equal(kai.find(l => l.page === 'esport.teams').cree_le, new Date(b.horloge.t - 600_000).toISOString());
});

test('limites de débit : 150 lots par heure et par compte, puis 429 avec Retry-After', async () => {
  const { b, sessions } = await preparer();
  for (let i = 0; i < 150; i++) assert.equal((await envoyer(b, sessions.lea12345, lot([page('esport.dashboard', 1000)]))).statut, 200);
  const trop = await envoyer(b, sessions.lea12345, lot([page('esport.dashboard', 1000)]));
  assert.equal(trop.statut, 429);
  assert.ok(Number(trop.entetes.get('Retry-After')) > 0);
  // Un autre compte n'est pas bloqué.
  assert.equal((await envoyer(b, sessions.kai12345, lot([page('esport.dashboard', 1000)]))).statut, 200);
  b.horloge.t += 3_601_000;
  await rafraichir(b, sessions);
  assert.equal((await envoyer(b, sessions.lea12345, lot([page('esport.dashboard', 1000)]))).statut, 200, 'fenêtre suivante : de nouveau accepté');
});

test('désactivation de la collecte par le Fondateur : lots ignorés, puis rétablie', async () => {
  const { b, sessions } = await preparer();
  const off = await b.appel('/statistiques/reglages', { methode: 'PUT', jeton: sessions.fondateur, corps: { collecte: false } });
  assert.equal(off.statut, 200);
  assert.equal(off.corps.collecte, false);
  assert.deepEqual((await envoyer(b, sessions.lea12345, lot([page('esport.dashboard', 1000)]))).corps, { actif: false, recus: 0 });
  assert.equal(await noterCommandeBot(b.base, '123456789012345678', b.horloge.t), false);
  assert.equal(Number((await b.base.premier('SELECT COUNT(*) AS n FROM usage_evenements', [])).n), 0);
  assert.equal((await b.appel('/statistiques', { jeton: sessions.fondateur })).corps.collecte.actif, false);
  assert.equal((await b.appel('/statistiques/reglages', { methode: 'PUT', jeton: sessions.fondateur, corps: { collecte: 'non' } })).statut, 400);
  await b.appel('/statistiques/reglages', { methode: 'PUT', jeton: sessions.fondateur, corps: { collecte: true } });
  assert.deepEqual((await envoyer(b, sessions.lea12345, lot([page('esport.dashboard', 1000)]))).corps, { actif: true, recus: 1 });
});

test('statistiques : utilisateurs, pages les plus et les moins utilisées, jamais ouvertes, modules non utilisés, chaleur, appareils, erreurs, fiche', async () => {
  const { b, sessions, teamId } = await preparer();
  // Léa (PC) : planning très utilisé ; Kai (téléphone, anglais) : accueil et ressources.
  await envoyer(b, sessions.lea12345, lot([page('esport.dashboard', 10_000), page('team.agenda.planning', 60_000, teamId), page('team.agenda.planning', 30_000, teamId), page('team.agenda.planning', 20_000, teamId), { g: 'action', a: 'rsvp', t: teamId }, { g: 'action', a: 'connexion' }]));
  await envoyer(
    b,
    sessions.kai12345,
    lot([page('team.accueil.accueil', 5_000, teamId), page('team.agenda.planning', 8_000, teamId), page('team.jeu.resources', 2_000, teamId), { g: 'action', a: 'ressource.publiee', t: teamId }, { g: 'erreur', p: 'team.jeu.resources', m: 'Erreur 1234 : impossible' }, { g: 'erreur', p: 'team.jeu.resources', m: 'Erreur 5678 : impossible' }], { session: 'sessionK1', appareil: 'telephone', langue: 'en' }),
  );
  const r = await b.appel('/statistiques?du=2026-10-14&au=2026-10-20', { jeton: sessions.fondateur });
  assert.equal(r.statut, 200);
  const s = r.corps;
  assert.equal(s.apercu.actifsJour, 2);
  assert.equal(s.apercu.periode.actifs, 2);
  assert.equal(s.apercu.periode.sessions, 2);
  assert.equal(s.apercu.periode.vues, 7);
  assert.equal(s.apercu.periode.dureeMoyenneMs, Math.round(135_000 / 2));
  assert.equal(s.apercu.precedente.actifs, 0);
  // Pages : la plus utilisée en tête, la moins utilisée en queue, visiteurs uniques et temps moyen.
  const planning = s.pages.classement[0];
  assert.deepEqual([planning.page, planning.vues, planning.visiteurs, planning.dureeMoyenneMs], ['team.agenda.planning', 4, 2, Math.round(118_000 / 4)]);
  assert.ok(['team.jeu.resources', 'team.accueil.accueil', 'esport.dashboard'].includes(s.pages.classement.at(-1).page));
  assert.ok(s.pages.jamais.includes('team.jeu.strat_editor') && s.pages.jamais.includes('esport.statistiques') && !s.pages.jamais.includes('team.agenda.planning'));
  const nonUtilises = s.pages.nonUtilises.find(x => x.team.id === teamId);
  assert.ok(nonUtilises.modules.includes('strat_editor') && !nonUtilises.modules.includes('planning') && !nonUtilises.modules.includes('resources'));
  // Utilisateurs : actifs, inactifs (Olga n'a jamais rien fait), pages préférées, appareil.
  const lea = s.utilisateurs.find(u => u.compte === 'lea12345');
  assert.equal(lea.pagesPreferees[0].page, 'team.agenda.planning');
  assert.equal(lea.appareil, 'pc');
  assert.equal(lea.sessions, 1);
  assert.equal(lea.source, 'mesure');
  assert.equal(s.utilisateurs.find(u => u.compte === 'kai12345').appareil, 'telephone');
  const olga = s.utilisateurs.find(u => u.compte === 'own12345');
  assert.ok(olga.vues === 0 && olga.sessions === 0 && olga.source === 'journal', 'Olga : aucune page mesurée, activité connue par le journal seulement');
  // Activité : carte de chaleur (mardi 20 octobre, 12 h à Paris), appareils, langues.
  assert.equal(s.activite.chaleur[1][12], 10);
  assert.equal(s.activite.chaleur.flat().reduce((x, y) => x + y, 0), 10);
  assert.deepEqual(s.activite.appareils.map(a => a.appareil), ['pc', 'telephone']);
  assert.deepEqual(s.activite.langues.map(l => l.langue).sort(), ['en', 'fr']);
  assert.equal(s.activite.quotidien.at(-1).actifs, 2);
  // Teams, fonctionnalités, erreurs regroupées (nombres retirés).
  assert.equal(s.teams[0].visiteurs, 2);
  assert.equal(s.teams[0].membres, 4);
  assert.equal(s.teams[0].adoption, 50);
  const f = Object.fromEntries(s.fonctions.map(x => [x.fonction, x]));
  assert.equal(f.rsvp.n, 1);
  assert.equal(f.ressources.n, 1);
  assert.equal(f.connexion.n, 1);
  assert.equal(s.erreurs.length, 1);
  assert.deepEqual([s.erreurs[0].n, s.erreurs[0].utilisateurs, s.erreurs[0].page], [2, 1, 'team.jeu.resources']);
  // Filtres : appareil, rôle, team.
  assert.equal((await b.appel('/statistiques?appareil=telephone', { jeton: sessions.fondateur })).corps.apercu.periode.actifs, 1);
  const proprio = (await b.appel('/statistiques?role=proprietaire', { jeton: sessions.fondateur })).corps;
  assert.equal(proprio.apercu.periode.actifs, 0);
  assert.ok(proprio.utilisateurs.every(u => u.teams.some(t => t.cle === 'proprietaire')));
  assert.equal((await b.appel(`/statistiques?team=${teamId}`, { jeton: sessions.fondateur })).corps.pages.classement[0].page, 'team.agenda.planning');
  assert.equal((await b.appel('/statistiques?appareil=grille-pain', { jeton: sessions.fondateur })).statut, 400);
  assert.equal((await b.appel('/statistiques?du=2026-13-01', { jeton: sessions.fondateur })).statut, 400);
  // Fiche d'un membre : chronologie.
  const fiche = (await b.appel('/statistiques/membres/lea12345', { jeton: sessions.fondateur })).corps;
  assert.equal(fiche.pseudo, 'Léa');
  assert.equal(fiche.totaux.vues, 4);
  assert.ok(fiche.chronologie.some(e => e.source === 'mesure' && e.page === 'team.agenda.planning'));
  assert.ok(fiche.chronologie.some(e => e.source === 'journal'), 'le journal complète la chronologie');
  assert.equal((await b.appel('/statistiques/membres/inconnu99', { jeton: sessions.fondateur })).statut, 404);
});

test('agrégation nocturne par le cron : mêmes chiffres avant et après, une fois par jour, idempotente', async () => {
  const { b, sessions, teamId } = await preparer();
  await envoyer(b, sessions.lea12345, lot([page('team.agenda.planning', 40_000, teamId), page('esport.dashboard', 5_000), { g: 'action', a: 'evenement.cree', t: teamId }]));
  b.horloge.t += 86_400_000; // 21 octobre
  await rafraichir(b, sessions);
  await envoyer(b, sessions.kai12345, lot([page('team.jeu.resources', 7_000, teamId)], { session: 'sessionK2', appareil: 'tablette' }));
  const avant = (await b.appel('/statistiques?du=2026-10-20&au=2026-10-21', { jeton: sessions.fondateur })).corps;
  const rapport = await tachesPlanifiees(b.base, { maintenant: () => b.horloge.t });
  assert.ok(rapport.find(x => x.tache === 'agrégation de l’usage')?.ok);
  assert.ok(rapport.find(x => x.tache === 'rétention de l’usage')?.ok);
  assert.equal((await b.base.premier("SELECT valeur FROM usage_reglages WHERE cle = 'agrege_jusqua'", [])).valeur, '2026-10-21', 'le 20 est agrégé, pas le 21 (pas terminé)');
  const lignes = await b.base.tous('SELECT * FROM usage_jour_pages ORDER BY page', []);
  assert.deepEqual(lignes.map(l => [l.jour, l.page, Number(l.vues), Number(l.duree_ms)]), [
    ['2026-10-20', 'esport.dashboard', 1, 5000],
    ['2026-10-20', 'team.agenda.planning', 1, 40000],
  ]);
  assert.equal(Number((await b.base.premier("SELECT sessions FROM usage_jour_membres WHERE compte_id = 'lea12345'", [])).sessions), 1);
  assert.equal(Number((await b.base.premier("SELECT n FROM usage_jour_actions WHERE action = 'evenement.cree'", [])).n), 1);
  assert.equal(await agregerUsage(b.base, { maintenant: b.horloge.t }), 0, 'rien à refaire le même jour');
  const apres = (await b.appel('/statistiques?du=2026-10-20&au=2026-10-21', { jeton: sessions.fondateur })).corps;
  for (const cle of ['apercu', 'pages', 'teams', 'fonctions']) assert.deepEqual(apres[cle], avant[cle], cle);
  assert.deepEqual(apres.activite.chaleur, avant.activite.chaleur);
  // Le lendemain : le 21 est agrégé à son tour.
  b.horloge.t += 86_400_000;
  assert.equal(await agregerUsage(b.base, { maintenant: b.horloge.t }), 1);
  assert.equal(Number((await b.base.premier("SELECT COUNT(*) AS n FROM usage_jour_pages WHERE jour = '2026-10-21'", [])).n), 1);
  // Export complet de la base : les tables d'usage y sont.
  const exp = await exporterBase(b.base);
  assert.ok(exp.tables.usage_evenements.length === 4 && exp.tables.usage_jour_pages.length === 3 && exp.tables.usage_reglages.length >= 2);
});

test('rétention : détail brut effacé après 90 jours (une fois agrégé), agrégats gardés', async () => {
  const { b, sessions } = await preparer();
  await envoyer(b, sessions.lea12345, lot([page('esport.dashboard', 5_000)]));
  b.horloge.t += 2 * 86_400_000;
  await rafraichir(b, sessions);
  await agregerUsage(b.base, { maintenant: b.horloge.t });
  assert.equal(await purgerUsage(b.base, { maintenant: b.horloge.t }), 0, 'pas encore 90 jours');
  b.horloge.t += 89 * 86_400_000;
  await rafraichir(b, sessions);
  await envoyer(b, sessions.lea12345, lot([page('esport.teams', 5_000)]));
  await tachesPlanifiees(b.base, { maintenant: () => b.horloge.t });
  const restants = await b.base.tous('SELECT page FROM usage_evenements', []);
  assert.deepEqual(restants.map(r => r.page), ['esport.teams'], 'seul le détail récent reste');
  assert.equal(Number((await b.base.premier("SELECT COUNT(*) AS n FROM usage_jour_pages WHERE page = 'esport.dashboard'", [])).n), 1, 'agrégat conservé');
  const s = (await b.appel('/statistiques?du=2026-10-20&au=2026-10-20', { jeton: sessions.fondateur })).corps;
  assert.equal(s.pages.classement[0].page, 'esport.dashboard', 'les vieilles périodes restent lisibles (agrégats)');
});

test('RGPD : l’usage figure dans l’export du membre et s’efface avec son compte', async () => {
  const { b, sessions } = await preparer();
  await envoyer(b, sessions.lea12345, lot([page('esport.dashboard', 5_000), { g: 'action', a: 'connexion' }]));
  await envoyer(b, sessions.kai12345, lot([page('esport.dashboard', 5_000)], { session: 'sessionK3' }));
  b.horloge.t += 2 * 86_400_000;
  await rafraichir(b, sessions);
  await agregerUsage(b.base, { maintenant: b.horloge.t });
  await envoyer(b, sessions.lea12345, lot([page('esport.teams', 5_000)]));
  const moi = (await b.appel('/moi/export', { jeton: sessions.lea12345 })).corps;
  assert.match(moi.usage.mention, /visibles par l’administrateur/);
  assert.deepEqual(moi.usage.evenements.map(e => e.page ?? e.action), ['esport.dashboard', 'connexion', 'esport.teams']);
  assert.equal(moi.usage.parJour.length, 1);
  assert.deepEqual(moi.usage.parPage, [{ page: 'esport.dashboard', vues: 1, dureeMs: 5000 }]);
  const parFondateur = (await b.appel('/admin/comptes/lea12345/export', { jeton: sessions.fondateur })).corps;
  assert.equal(parFondateur.usage.evenements.length, 3);
  // Suppression par le membre : tout son usage disparaît, celui des autres reste.
  assert.equal((await b.appel('/moi', { methode: 'DELETE', jeton: sessions.lea12345 })).statut, 200);
  for (const table of ['usage_evenements', 'usage_jour_pages', 'usage_jour_membres', 'usage_jour_actions', 'usage_jour_heures', 'usage_jour_erreurs']) {
    assert.equal(Number((await b.base.premier(`SELECT COUNT(*) AS n FROM ${table} WHERE compte_id = 'lea12345'`, [])).n), 0, table);
  }
  assert.ok(Number((await b.base.premier("SELECT COUNT(*) AS n FROM usage_evenements WHERE compte_id = 'kai12345'", [])).n) > 0);
  // Compte supprimé dans l'Administration : même effacement.
  assert.equal((await b.appel('/admin/comptes/kai12345/hub', { methode: 'DELETE', jeton: sessions.fondateur })).statut, 200);
  assert.equal(Number((await b.base.premier("SELECT COUNT(*) AS n FROM usage_jour_membres WHERE compte_id = 'kai12345'", [])).n), 0);
  assert.equal(Number((await b.base.premier("SELECT COUNT(*) AS n FROM usage_evenements WHERE compte_id = 'kai12345'", [])).n), 0);
});

test('historique reconstitué depuis le journal (avant le premier jour mesuré), et commandes du bot', async () => {
  const { b, sessions, teamId } = await preparer();
  // Une semaine plus tôt : un événement créé (journal), avant toute collecte.
  b.horloge.t -= 7 * 86_400_000;
  await rafraichir(b, sessions);
  const ev = await b.appel(`/teams/${teamId}/planning`, { methode: 'POST', jeton: sessions.fondateur, corps: { type: 'scrim', titre: 'Scrim', debut: '2026-10-20T18:00:00.000Z', fin: '2026-10-20T20:00:00.000Z', fuseau: 'Europe/Paris' } });
  assert.equal(ev.statut, 200, JSON.stringify(ev.corps));
  b.horloge.t += 7 * 86_400_000;
  await rafraichir(b, sessions);
  await envoyer(b, sessions.lea12345, lot([page('esport.dashboard', 5_000)]));
  const s = (await b.appel('/statistiques?du=2026-10-01&au=2026-10-20', { jeton: sessions.fondateur })).corps;
  assert.equal(s.collecte.debut, '2026-10-20');
  assert.deepEqual([s.historique.reconstitue, s.historique.au], [true, '2026-10-19']);
  const jour = s.activite.quotidien.find(j => j.jour === '2026-10-13');
  assert.ok(jour.reconstitue && jour.actifs >= 1 && jour.actions >= 1, JSON.stringify(jour));
  assert.ok(!s.activite.quotidien.find(j => j.jour === '2026-10-20').reconstitue);
  assert.ok(s.fonctions.find(f => f.fonction === 'planning').reconstitue >= 1);
  // Bot Discord : commande comptée pour le compte dont le Discord ID est connu.
  await b.base.executer("UPDATE comptes SET discord_id = '123456789012345678' WHERE id = 'kai12345'", []);
  assert.equal(await noterCommandeBot(b.base, '123456789012345678', b.horloge.t), true);
  assert.equal(await noterCommandeBot(b.base, '999999999999999999', b.horloge.t), false, 'inconnu : rien');
  const apres = (await b.appel('/statistiques?du=2026-10-20&au=2026-10-20', { jeton: sessions.fondateur })).corps;
  assert.equal(apres.fonctions.find(f => f.fonction === 'bot').n, 1);
  assert.ok(apres.activite.appareils.some(a => a.appareil === 'discord'));
});

test('nettoyage des messages d’erreur : ni adresse, ni e-mail, ni jeton', () => {
  assert.equal(nettoyerMessage('Échec https://x.y/z?a=1 pour a.b@c.fr jeton es1.abc.def 0123456789 et 3fa85f64-5717-4562-b3fc-2c963f66afa6'), 'Échec <url> pour <e-mail> jeton <jeton> # et <id>');
  assert.equal(nettoyerMessage('ab '.repeat(200)).length, 200);
});
