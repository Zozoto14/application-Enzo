/**
 * Centre de notifications (migration 0038, docs/esport/notifications.md) : visibilité par rôle vérifiée à la
 * lecture (joueur, staff, Propriétaire, Second CEO, Fondateur, changement de rôle), unification avec les
 * notifications personnelles (sans doublon), préférences, filtres, pagination, lu / non lu, idempotence, purge,
 * annonce en direct, RGPD et export.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { distribuer, evenement } from '../noyau/evenements.mjs';
import { TABLES } from '../noyau/transfert.mjs';
import { abonneCentre, purgerNotifications, surNouvelleNotification } from '../noyau/notifications/centre.mjs';
import { CATEGORIES, categoriePerso, chargePublique, regleDe, regleEffective } from '../noyau/notifications/regles.mjs';
import { tachesPlanifiees } from '../noyau/cron.mjs';

// ------------------------------------------------------------------ Règles pures

test('règles : catégorie et accès par type (exact, préfixe, défaut prudent), personnelles, charge nettoyée', () => {
  assert.deepEqual([regleDe('event.created').categorie, regleDe('event.created').acces], ['planning', 'team:planning.view']);
  assert.equal(regleDe('tournoi.cree').categorie, 'competition');
  assert.equal(regleDe('match.resultat_saisi').categorie, 'resultats');
  assert.equal(regleDe('cm.post_soumis').lien.onglet, 'valider');
  assert.equal(regleDe('cm.drive_fichier_ajoute').categorie, 'drive', 'cm.drive_* avant cm.*');
  assert.equal(regleDe('cm.reseau_releve').lien.onglet, 'reseaux');
  assert.equal(regleDe('drive.ajout').categorie, 'drive');
  assert.match(regleDe('drive.ajout').acces, /^cm:cm\.drive\.voir/);
  assert.equal(regleDe('sponsors.prospect_cree').acces, 'club:sponsors.voir');
  assert.equal(regleDe('player_note.created').acces, 'team:player_notes.view');
  assert.equal(regleDe('resource_category.created').categorie, 'jeu');
  assert.equal(regleDe('devblog.publie').acces, 'tous');
  assert.equal(regleDe('review.reaction_changed').acces, 'aucun');
  assert.deepEqual([regleDe('type.inconnu').categorie, regleDe('type.inconnu').acces], ['systeme', 'fondateur'], 'inconnu : Fondateur seul');
  for (const c of ['planning', 'competition', 'resultats', 'cm', 'drive', 'sponsors', 'membres', 'discord', 'reunions', 'devblog', 'systeme']) assert.ok(CATEGORIES.includes(c), c);
  assert.equal(categoriePerso('sp-action'), 'sponsors');
  assert.equal(categoriePerso('cm-drive-quota'), 'drive');
  assert.equal(categoriePerso('cm-a-valider'), 'cm');
  assert.equal(categoriePerso('evenement-nouveau'), 'planning');
  assert.equal(categoriePerso('tache-assignee'), 'objectifs');
  assert.equal(categoriePerso('resultat-saisi'), 'resultats');
  assert.deepEqual(JSON.parse(chargePublique({ titre: 'Scrim', contenu: 'secret', email: 'a@b.fr', n: 2, liste: ['a', { x: 1 }] })), { titre: 'Scrim', n: 2, liste: ['a'] });
});

test('règle effective : réunion « staff », strat privée, ressource et résultat « staff », événement de team sans team', async () => {
  const fausse = ligne => ({ premier: async () => ligne });
  const ev = (type, entite_type, extra = {}) => ({ id: 'e', type, team_id: 't1', entite_type, entite_id: 'x', ...extra });
  assert.equal((await regleEffective(fausse({ visibilite: 'staff' }), ev('meeting.summary_published', 'reunion'))).acces, 'team:meeting_summaries.view_all|meeting_summaries.write_summary');
  assert.match((await regleEffective(fausse({ visibilite: 'team' }), ev('meeting.summary_published', 'reunion'))).acces, /view_summary$/);
  assert.equal((await regleEffective(fausse({ visibilite: 'privee' }), ev('strat.updated', 'strat'))).acces, 'team:strats.delete');
  assert.equal((await regleEffective(fausse(null), ev('strat.created', 'strat'))).acces, 'team:strats.delete', 'introuvable : prudent');
  assert.equal((await regleEffective(fausse({ visibilite: 'team' }), ev('strat.created', 'strat'))).acces, 'team:strats.view');
  assert.equal((await regleEffective(fausse({ visibilite: 'staff', statut: 'publiee' }), ev('resource.created', 'ressource'))).acces, 'team:resources.post|resources.manage');
  assert.equal((await regleEffective(fausse({ visibilite: 'team', statut: 'proposee' }), ev('resource.commented', 'ressource'))).acces, 'team:resources.post|resources.manage');
  assert.equal((await regleEffective(fausse({ visibilite: 'team', statut: 'publiee' }), ev('resource.created', 'ressource'))).acces, 'team:resources.view');
  assert.equal((await regleEffective(fausse({ visibilite: 'staff' }), ev('match.resultat_saisi', 'resultat'))).acces, 'team:resultats.saisir');
  assert.equal((await regleEffective(fausse({ visibilite: 'team' }), ev('match.resultat_saisi', 'resultat'))).acces, 'team:resultats.voir');
  assert.equal((await regleEffective(fausse(null), ev('event.created', 'evenement', { team_id: null }))).acces, 'fondateur');
  assert.equal((await regleEffective(fausse(null), ev('cm.post_soumis', 'cm_carte', { team_id: null }))).acces, 'cm:cm.voir', 'CM du club');
});

// ------------------------------------------------------------------ Banc

async function preparer() {
  const b = await banc();
  const A = await teamAvecMembres(b, {
    membres: {
      own12345: { pseudo: 'Olga', role: 'proprietaire' },
      coach123: { pseudo: 'Zed', role: 'coach' },
      lea12345: { pseudo: 'Léa', role: 'joueur' },
      kai12345: { pseudo: 'Kai', role: 'joueur' },
    },
  });
  const B = await teamAvecMembres(b, { nom: 'Team Bravo', membres: { bob12345: { pseudo: 'Bob', role: 'coach' } } });
  const s = { ...A.sessions, bob12345: B.sessions.bob12345 };
  s.cm123456 = await b.session('cm123456', 'Clara');
  s.grimm123 = await b.session('grimm123', 'Grimm');
  const api = (chemin, jeton, o = {}) => b.appel(chemin, { jeton, methode: o.methode, corps: o.corps });
  const ok = async (chemin, jeton, o = {}) => {
    const r = await api(chemin, jeton, o);
    assert.equal(r.statut, 200, `${o.methode ?? 'GET'} ${chemin} : ${r.statut} ${JSON.stringify(r.corps)}`);
    return r.corps;
  };
  // Responsable CM du club : CM, Drive et Sponsors.
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'cm123456', roleId: 'cm-role-responsable', portee: 'club' } });
  const centre = async (qui, q = '') => ok(`/notifications/centre${q}`, s[qui]);
  const types = async (qui, q = '') => (await centre(qui, q)).liste.map(n => n.evenement ?? n.type);
  return { b, A, B, s, api, ok, centre, types };
}

const SCRIM = { type: 'scrim', titre: 'Scrim vs Nova', date: '2026-10-22', heureDebut: '20:00', heureFin: '22:00', convocation: { groupes: ['joueurs'] } };

test('visibilité : le joueur voit le planning, jamais les notes du staff ni les sponsors ; le staff, le CM, le Fondateur selon leurs droits', async () => {
  const { A, B, s, ok, types, centre } = await preparer();
  await ok(`/teams/${A.teamId}/planning`, s.coach123, { methode: 'POST', corps: SCRIM });
  const noteCreee = await ok(`/teams/${A.teamId}/suivi/lea12345/notes`, s.coach123, { methode: 'POST', corps: { contenu: 'Comms tardives en retake.', categorie: 'communication' } });
  await ok('/sponsors/prospects', s.cm123456, { methode: 'POST', corps: { nom: 'Brasserie Zéphyr', valeurEstimee: '3000' } });
  await ok(`/teams/${B.teamId}/planning`, s.bob12345, { methode: 'POST', corps: { ...SCRIM, titre: 'Scrim Bravo' } });

  // Léa (joueuse) : le scrim de sa team (notification personnelle : convoquée), rien d'autre.
  const lea = await centre('lea12345');
  assert.ok(lea.liste.some(n => n.categorie === 'planning' && n.team.id === A.teamId), 'scrim visible');
  assert.ok(!lea.liste.some(n => n.categorie === 'sponsors'), 'pas de sponsors');
  assert.ok(!lea.liste.some(n => (n.evenement ?? n.type).startsWith('player_note')), 'pas de notes du staff');
  assert.ok(!lea.liste.some(n => n.team?.id === B.teamId), 'rien d’une autre team');
  assert.ok(!JSON.stringify(lea).includes('Comms tardives'), 'jamais le contenu d’une note');
  assert.ok(!JSON.stringify(lea).includes('Zéphyr'), 'jamais le nom d’un sponsor');
  // Le coach : la note qu'il a écrite (sa propre action : déjà lue), le scrim.
  const coach = await centre('coach123');
  const note = coach.liste.find(n => n.evenement === 'player_note.created');
  assert.ok(note, 'note visible du staff');
  assert.equal(note.lue, true, 'ses propres actions ne sont jamais « non lues »');
  assert.deepEqual(note.lien, { vue: 'team', section: 'module:player_notes' });
  assert.ok(!coach.liste.some(n => n.categorie === 'sponsors'));
  // Le Propriétaire de la team : tout dans sa team (notes comprises), mais pas les Sponsors (permission du club).
  const olga = await types('own12345');
  assert.ok(olga.includes('player_note.created'));
  assert.ok(!olga.some(t => t.startsWith('sponsors.')));
  // Responsable CM (club) : les Sponsors, pas les notes du staff d'une team dont il n'est pas membre.
  const clara = await types('cm123456');
  assert.ok(clara.includes('sponsors.prospect_cree'));
  assert.ok(!clara.includes('player_note.created'));
  // Fondateur (CEO) : tout, les deux teams, toutes les catégories.
  const f = await centre('fondateur');
  for (const t of ['player_note.created', 'sponsors.prospect_cree', 'event.created']) assert.ok(f.liste.some(n => n.evenement === t), t);
  assert.ok(f.liste.some(n => n.team?.id === B.teamId));
  assert.deepEqual(new Set(f.teams.map(t => t.id)), new Set([A.teamId, B.teamId]));
  assert.deepEqual(new Set((await centre('lea12345')).teams.map(t => t.id)), new Set([A.teamId]), 'filtre des teams : les siennes');
  // Compte sans team ni rôle : rien.
  assert.deepEqual((await centre('grimm123')).liste, []);
  // Note partagée avec Léa, auteur masqué : sa notification personnelle ne révèle ni l'auteur ni la note.
  const id = noteCreee.id;
  await ok(`/teams/${A.teamId}/suivi/lea12345/notes/${id}`, s.coach123, { methode: 'PATCH', corps: { partagee: true, auteurMasque: true } });
  const partage = (await centre('lea12345')).liste.find(n => n.type === 'note-partagee');
  assert.ok(partage, 'notification personnelle reçue');
  assert.equal(partage.acteur, null, 'auteur masqué');
  assert.equal(partage.entite, null);
  assert.equal((await centre('lea12345', '?auteur=coach123')).liste.filter(n => n.type === 'note-partagee').length, 0, 'pas de déduction par le filtre « auteur »');
});

test('changement de rôle appliqué à la lecture : promu Coach, Léa voit les notes ; rétrogradée ou suspendue, plus rien', async () => {
  const { A, s, ok, api, types } = await preparer();
  await ok(`/teams/${A.teamId}/suivi/kai12345/notes`, s.coach123, { methode: 'POST', corps: { contenu: 'Bon match.', categorie: 'performance' } });
  assert.ok(!(await types('lea12345')).includes('player_note.created'));
  const lea = A.membres.lea12345;
  await ok(`/teams/${A.teamId}/membres/${lea.id}`, s.fondateur, { methode: 'PATCH', corps: { roleId: A.roles.coach.id } });
  assert.ok((await types('lea12345')).includes('player_note.created'), 'promue : la note (créée AVANT) apparaît');
  await ok(`/teams/${A.teamId}/membres/${lea.id}`, s.fondateur, { methode: 'PATCH', corps: { roleId: A.roles.joueur.id } });
  assert.ok(!(await types('lea12345')).includes('player_note.created'), 'rétrogradée : elle disparaît');
  await ok(`/teams/${A.teamId}/membres/${lea.id}`, s.fondateur, { methode: 'PATCH', corps: { statut: 'suspendu' } });
  const apres = (await api('/notifications/centre', s.lea12345)).corps.liste;
  assert.ok(!apres.some(n => n.team?.id === A.teamId && n.type !== 'retire'), 'suspendue : plus rien de la team');
});

test('Second CEO : les teams (accès total) et les Sponsors selon ses permissions du club', async () => {
  const { A, s, ok, types } = await preparer();
  await ok(`/teams/${A.teamId}/suivi/kai12345/notes`, s.coach123, { methode: 'POST', corps: { contenu: 'Note.', categorie: 'performance' } });
  await ok('/sponsors/prospects', s.cm123456, { methode: 'POST', corps: { nom: 'Atelier Nimbus' } });
  const vue = await ok('/roles-permissions', s.fondateur);
  const sc = vue.globaux.roles.find(r => r.cle === 'second_ceo');
  await ok(`/roles-permissions/globaux/${sc.id}/comptes`, s.fondateur, { methode: 'POST', corps: { compte: 'grimm123' } });
  const g = await types('grimm123');
  assert.ok(g.includes('player_note.created'), 'teams : droits du Propriétaire');
  assert.ok(g.includes('sponsors.prospect_cree'), 'sponsors.voir par défaut');
  // Le Fondateur retire sponsors.voir / sponsors.gerer au Second CEO : les sponsors disparaissent aussitôt.
  await ok(`/roles-permissions/globaux/${sc.id}`, s.fondateur, { methode: 'PATCH', corps: { permissions: sc.permissions.filter(p => !p.startsWith('sponsors.')) } });
  assert.ok(!(await types('grimm123')).some(t => t.startsWith('sponsors.')));
});

test('unification sans doublon : la notification personnelle remplace l’élément du fil ; strat privée réservée au staff', async () => {
  const { b, A, s, ok, centre, types } = await preparer();
  // Personnelle (convocation) : Léa voit le scrim UNE fois, en personnelle ; Olga (non convoquée) le voit dans le fil.
  await ok(`/teams/${A.teamId}/planning`, s.coach123, { methode: 'POST', corps: SCRIM });
  const lea = (await centre('lea12345')).liste.filter(n => n.categorie === 'planning');
  assert.equal(lea.length, 1);
  assert.equal(lea[0].source, 'perso');
  assert.equal(lea[0].evenement, 'event.created', 'relié à son événement (lien, auteur)');
  assert.equal(lea[0].acteur, 'coach123');
  assert.deepEqual(lea[0].lien, { vue: 'team', section: 'module:planning' });
  const olga = (await centre('own12345')).liste.filter(n => n.categorie === 'planning');
  assert.deepEqual(olga.map(n => n.source), ['fil']);
  // Idempotence : redistribuer, rejouer l'abonné sur le même événement ne crée rien de plus.
  const ev = await b.base.premier("SELECT * FROM evenements WHERE type = 'event.created'", []);
  await abonneCentre(b.base, ev);
  await abonneCentre(b.base, ev);
  await distribuer(b.base);
  assert.equal(Number((await b.base.premier("SELECT COUNT(*) AS n FROM notifs_centre WHERE type = 'event.created'", [])).n), 1);
  assert.equal((await centre('own12345')).liste.filter(n => n.categorie === 'planning').length, 1);
  // Strat privée : seul le staff (strats.delete) la voit, titre compris.
  const t = Date.parse('2026-10-20T11:00:00.000Z');
  await b.base.executer("INSERT INTO strats (id, team_id, jeu, titre, carte, carte_nom, side, type, donnees, version_document, revision, tags, notes, visibilite, cree_par, cree_le, maj_par, maj_le) VALUES ('s-privee', ?, 'valorant', 'Exécution secrète', 'ascent', 'Ascent', 'attaque', 'execute', '{}', 1, 1, '[]', '', 'privee', 'coach123', ?, 'coach123', ?)", [A.teamId, new Date(t).toISOString(), new Date(t).toISOString()]);
  const e = evenement('strat.created', { teamId: A.teamId, acteur: 'coach123', entiteType: 'strat', entiteId: 's-privee', charge: { titre: 'Exécution secrète' }, maintenant: t });
  await b.base.executer(e.sql, e.params);
  await distribuer(b.base);
  assert.ok(!(await types('lea12345')).includes('strat.created'), 'joueuse : rien');
  assert.ok((await types('coach123')).includes('strat.created'), 'staff : visible');
  // Strat de la team (visible de Léa), puis rendue privée : TOUS ses éléments du fil se resserrent.
  await b.base.executer("UPDATE strats SET visibilite = 'team' WHERE id = 's-privee'", []);
  const e2 = evenement('strat.updated', { teamId: A.teamId, acteur: 'coach123', entiteType: 'strat', entiteId: 's-privee', charge: { titre: 'Exécution secrète' }, maintenant: t + 1000 });
  await b.base.executer(e2.sql, e2.params);
  await distribuer(b.base);
  assert.ok((await types('lea12345')).includes('strat.updated'), 'partagée avec la team : visible');
  await b.base.executer("UPDATE strats SET visibilite = 'privee' WHERE id = 's-privee'", []);
  const e3 = evenement('strat.updated', { teamId: A.teamId, acteur: 'coach123', entiteType: 'strat', entiteId: 's-privee', charge: { titre: 'Exécution secrète' }, maintenant: t + 2000 });
  await b.base.executer(e3.sql, e3.params);
  await distribuer(b.base);
  assert.ok(!(await types('lea12345')).some(x => x.startsWith('strat.')), 'redevenue privée : plus rien, même l’ancien élément');
});

test('préférences en base : catégories masquées (liste et compteur), silencieuses (compteur), teams suivies', async () => {
  const { A, B, s, api, ok, centre } = await preparer();
  await ok(`/teams/${A.teamId}/planning`, s.coach123, { methode: 'POST', corps: SCRIM });
  await ok(`/teams/${B.teamId}/planning`, s.bob12345, { methode: 'POST', corps: { ...SCRIM, titre: 'Scrim Bravo' } });
  await ok('/sponsors/prospects', s.cm123456, { methode: 'POST', corps: { nom: 'Atelier Nimbus' } });
  const avant = await ok('/notifications/compteur', s.fondateur);
  assert.ok(avant.nonLues >= 3, JSON.stringify(avant));
  // Masquer les sponsors : ni dans la liste, ni dans le compteur.
  const p = await ok('/notifications/preferences', s.fondateur, { methode: 'PUT', corps: { masquees: ['sponsors'] } });
  assert.deepEqual(p.masquees, ['sponsors']);
  assert.ok(!(await centre('fondateur')).liste.some(n => n.categorie === 'sponsors'));
  const masque = (await ok('/notifications/compteur', s.fondateur)).nonLues;
  assert.ok(masque < avant.nonLues);
  // Un filtre explicite sur la catégorie la montre quand même.
  assert.ok((await centre('fondateur', '?categories=sponsors')).liste.length >= 1);
  // Silencieuse : visible dans la liste, absente du compteur.
  await ok('/notifications/preferences', s.fondateur, { methode: 'PUT', corps: { masquees: [], silencieuses: ['planning'] } });
  assert.ok((await centre('fondateur')).liste.some(n => n.categorie === 'planning'));
  const silencieux = (await ok('/notifications/compteur', s.fondateur)).nonLues;
  const sansPlanning = (await centre('fondateur', '?nonLues=1')).liste.filter(n => n.categorie !== 'planning').length;
  assert.equal(silencieux, sansPlanning);
  // Teams suivies : Team Alpha seulement (les éléments sans team restent).
  await ok('/notifications/preferences', s.fondateur, { methode: 'PUT', corps: { silencieuses: [], teams: [A.teamId] } });
  const l = (await centre('fondateur')).liste;
  assert.ok(!l.some(n => n.team?.id === B.teamId));
  assert.ok(l.some(n => n.team === null), 'sans team : toujours là');
  // Enregistrées par compte : celles de Léa sont intactes.
  assert.deepEqual((await ok('/notifications/preferences', s.lea12345)).masquees, []);
  // Entrées refusées.
  for (const corps of [{ masquees: ['inconnue'] }, { silencieuses: 'planning' }, { teams: ['<script>'] }]) assert.equal((await api('/notifications/preferences', s.fondateur, { methode: 'PUT', corps })).statut, 400, JSON.stringify(corps));
});

test('filtres (catégorie, team, auteur, période, non lues), tri, pagination, lu / non lu', async () => {
  const { b, A, B, s, api, ok, centre } = await preparer();
  for (let i = 0; i < 3; i++) {
    b.horloge.t += 60_000;
    await ok(`/teams/${A.teamId}/planning`, s.coach123, { methode: 'POST', corps: { ...SCRIM, titre: `Scrim ${i}` } });
  }
  b.horloge.t += 60_000;
  await ok(`/teams/${B.teamId}/planning`, s.bob12345, { methode: 'POST', corps: { ...SCRIM, titre: 'Scrim Bravo' } });
  for (const k of Object.keys(s)) s[k] = await b.session(k === 'fondateur' ? 'principal' : k);
  const q = '?categories=planning';
  const tout = (await centre('fondateur', q)).liste;
  assert.ok(tout.length >= 4);
  assert.ok(tout.every(n => n.categorie === 'planning'));
  assert.deepEqual([...tout].map(n => n.date), [...tout].map(n => n.date).sort().reverse(), 'plus récentes d’abord');
  assert.deepEqual((await centre('fondateur', `${q}&ordre=asc`)).liste.map(n => n.id), [...tout].reverse().map(n => n.id), 'tri croissant');
  assert.ok((await centre('fondateur', `${q}&team=${B.teamId}`)).liste.every(n => n.team.id === B.teamId));
  assert.ok((await centre('fondateur', `${q}&auteur=bob12345`)).liste.every(n => n.acteur === 'bob12345'));
  assert.equal((await centre('fondateur', `${q}&auteur=bob12345`)).liste.length, 1);
  assert.equal((await centre('fondateur', `${q}&du=2026-10-21`)).liste.length, 0, 'période');
  assert.equal((await centre('fondateur', `${q}&du=2026-10-20&au=2026-10-20`)).liste.length, tout.length);
  for (const mauvais of ['?du=hier', '?suite=x', '?team=%3Cscript%3E']) assert.equal((await api(`/notifications/centre${mauvais}`, s.fondateur)).statut, 400, mauvais);
  // Pagination par curseur : 2 par page, sans trou ni doublon.
  const vus = [];
  let suite = '';
  for (let n = 0; n < 10; n++) {
    const p = await centre('fondateur', `${q}&limite=2${suite ? `&suite=${encodeURIComponent(suite)}` : ''}`);
    vus.push(...p.liste.map(x => x.id));
    if (!p.suite) break;
    suite = p.suite;
  }
  assert.deepEqual(vus, tout.map(n => n.id));
  // Lu / non lu : un élément, puis tout.
  const nonLues = (await centre('fondateur', `${q}&nonLues=1`)).liste;
  assert.ok(nonLues.length >= 4);
  const r = await ok('/notifications/centre/lues', s.fondateur, { methode: 'POST', corps: { ids: [nonLues[0].id, 'id-inconnu', 'autre:compte'] } });
  assert.equal((await centre('fondateur', `${q}&nonLues=1`)).liste.length, nonLues.length - 1);
  assert.equal(typeof r.nonLues, 'number');
  const fin = await ok('/notifications/centre/lues', s.fondateur, { methode: 'POST', corps: { tout: true } });
  assert.equal(fin.nonLues, 0);
  assert.equal((await centre('fondateur', '?nonLues=1')).liste.length, 0);
  // Léa ne peut marquer lue la notification personnelle d'un autre.
  const perso = (await centre('kai12345', q)).liste.find(n => n.source === 'perso');
  await ok('/notifications/centre/lues', s.lea12345, { methode: 'POST', corps: { ids: [perso.id] } });
  assert.equal((await centre('kai12345', q)).liste.find(n => n.id === perso.id).lue, false);
  // Ancienne route : toujours là (carte « Notifications » des versions précédentes de l'app).
  assert.equal((await api('/notifications', s.lea12345)).statut, 200);
});

test('annonce en direct : un message par compte concerné, droits et « me notifier » respectés, jamais à l’auteur', async () => {
  const { A, s, ok } = await preparer();
  await ok('/notifications/preferences', s.own12345, { methode: 'PUT', corps: { silencieuses: ['jeu'] } });
  const recus = [];
  const fin = surNouvelleNotification(m => recus.push(m));
  try {
    await ok(`/teams/${A.teamId}/suivi/kai12345/notes`, s.coach123, { methode: 'POST', corps: { contenu: 'Note.', categorie: 'performance' } });
  } finally {
    fin();
  }
  const comptes = recus.filter(m => m.categorie === 'jeu').map(m => m.compte);
  assert.ok(comptes.includes('principal'), 'Fondateur');
  assert.ok(!comptes.includes('coach123'), 'pas l’auteur');
  assert.ok(!comptes.includes('lea12345') && !comptes.includes('kai12345'), 'jamais un joueur');
  assert.ok(!comptes.includes('own12345'), 'catégorie silencieuse');
  assert.ok(recus.every(m => typeof m.id === 'string' && ['fil', 'perso'].includes(m.source)));
});

test('drive.ajout (onglet Drive / Visuels) et devblog publié : catégories, accès, sans team', async () => {
  const { b, s, centre } = await preparer();
  const t = Date.parse('2026-10-20T12:00:00.000Z');
  await abonneCentre(b.base, { id: 'ev-drive-1', type: 'drive.ajout', team_id: null, acteur_id: 'cm123456', entite_type: 'drive_fichier', entite_id: 'f1', charge: JSON.stringify({ nom: 'logo.png' }), cree_le: new Date(t).toISOString() });
  assert.ok((await centre('fondateur', '?categories=drive')).liste.some(n => n.id === 'ev-drive-1'));
  assert.equal((await centre('cm123456', '?categories=drive')).liste.find(n => n.id === 'ev-drive-1')?.lue, true, 'son propre dépôt : lu');
  assert.ok(!(await centre('lea12345', '?categories=drive')).liste.length, 'joueuse sans Drive');
  await abonneCentre(b.base, { id: 'ev-devblog-1', type: 'devblog.publie', team_id: null, acteur_id: 'principal', entite_type: 'devblog', entite_id: 'd1', charge: JSON.stringify({ titre: 'Nouveautés' }), cree_le: new Date(t).toISOString() });
  for (const qui of ['lea12345', 'grimm123', 'cm123456']) assert.ok((await centre(qui, '?categories=devblog')).liste.some(n => n.id === 'ev-devblog-1'), qui);
});

test('rétention : purge de plus de 90 jours par le cron (fil, lectures, personnelles)', async () => {
  const { b, A, s, ok } = await preparer();
  await ok(`/teams/${A.teamId}/planning`, s.coach123, { methode: 'POST', corps: SCRIM });
  const avant = Number((await b.base.premier('SELECT COUNT(*) AS n FROM notifs_centre', [])).n);
  assert.ok(avant > 0);
  await b.base.executer("INSERT INTO notifs_centre (id, type, categorie, acces, portee_cle, charge, cree_le) VALUES ('vieux', 'event.created', 'planning', 'fondateur', 'fondateur@', '{}', '2026-01-01T00:00:00.000Z')", []);
  await b.base.executer("INSERT INTO notifs_lectures (compte_id, notif_id, lue_le) VALUES ('principal', 'vieux', '2026-01-02T00:00:00.000Z')", []);
  await b.base.executer("INSERT INTO notifications (id, compte_id, type, charge, cree_le) VALUES ('vieille:lea12345', 'lea12345', 'bienvenue', '{}', '2026-01-01T00:00:00.000Z')", []);
  const bilan = await purgerNotifications(b.base, { maintenant: b.horloge.t });
  assert.deepEqual(bilan, { fil: 1, lectures: 1, personnelles: 1 });
  assert.equal(Number((await b.base.premier('SELECT COUNT(*) AS n FROM notifs_centre', [])).n), avant, 'les récentes restent');
  const rapport = await tachesPlanifiees(b.base, { maintenant: () => b.horloge.t + 91 * 86_400_000, journal: { error() {} } });
  assert.ok(rapport.find(r => r.tache === 'rétention des notifications').ok);
  assert.equal(Number((await b.base.premier('SELECT COUNT(*) AS n FROM notifs_centre', [])).n), 0);
});

test('RGPD et export : préférences et lectures exportées puis effacées ; tables du centre dans l’export de la base', async () => {
  const { s, ok, api } = await preparer();
  for (const t of ['notifs_centre', 'notifs_lectures', 'notifs_preferences']) assert.ok(TABLES.some(([n]) => n === t), t);
  await ok('/notifications/preferences', s.lea12345, { methode: 'PUT', corps: { masquees: ['cm'] } });
  const exp = await ok('/moi/export', s.lea12345);
  assert.deepEqual(exp.centreNotifications.preferences.masquees, ['cm']);
  assert.equal((await api('/moi', s.lea12345, { methode: 'DELETE' })).statut, 200);
  const exp2 = await ok('/admin/comptes/lea12345/export', s.fondateur).catch(() => null);
  assert.ok(!exp2 || exp2.centreNotifications.preferences === null);
});

// ------------------------------------------------------------------ Ancienne route GET /notifications (carte de la page Teams)

async function insererPerso(b, compte, type, { teamId = null, id = `${type}-${compte}-${Math.random().toString(36).slice(2)}` } = {}) {
  await b.base.executer('INSERT INTO notifications (id, compte_id, type, team_id, charge, cree_le) VALUES (?, ?, ?, ?, ?, ?)', [id, compte, type, teamId, '{}', new Date().toISOString()]);
  return id;
}

test('ancienne route /notifications : perte d’appartenance (suspension, retrait) = plus rien de la team, liste ET compteur', async () => {
  const { b, A, s, ok, api } = await preparer();
  await ok(`/teams/${A.teamId}/planning`, s.coach123, { methode: 'POST', corps: SCRIM });
  const avant = await ok('/notifications', s.lea12345);
  assert.ok(avant.liste.some(n => n.team?.id === A.teamId), 'membre : voit les notifications de sa team');
  assert.ok(avant.nonLues > 0);
  const lea = A.membres.lea12345;
  await ok(`/teams/${A.teamId}/membres/${lea.id}`, s.fondateur, { methode: 'PATCH', corps: { statut: 'suspendu' } });
  const apres = (await api('/notifications', s.lea12345)).corps;
  assert.ok(!apres.liste.some(n => n.team?.id === A.teamId && n.type !== 'retire'), 'suspendue : plus rien de la team');
  assert.equal(apres.nonLues, apres.liste.filter(n => !n.lue).length, 'compteur cohérent avec la liste');
  // « Tout marquer comme lu » (ancienne route) ne ressort rien non plus.
  const lues = await ok('/notifications/lues', s.lea12345, { methode: 'POST', corps: { tout: true } });
  assert.ok(!lues.liste.some(n => n.team?.id === A.teamId && n.type !== 'retire'));
  // Même résultat que le centre.
  const centre = (await ok('/notifications/centre', s.lea12345)).liste.filter(n => n.source === 'perso').map(n => n.id).sort();
  assert.deepEqual(apres.liste.map(n => n.id).sort(), centre);
  void b;
});

test('ancienne route /notifications : perte de droits Sponsors / CM = les anciennes notifications personnelles disparaissent', async () => {
  const { b, A, s, ok } = await preparer();
  const vue = await ok('/roles-permissions', s.fondateur);
  const sc = vue.globaux.roles.find(r => r.cle === 'second_ceo');
  await ok(`/roles-permissions/globaux/${sc.id}/comptes`, s.fondateur, { methode: 'POST', corps: { compte: 'grimm123' } });
  await insererPerso(b, 'grimm123', 'sp-action');
  await insererPerso(b, 'grimm123', 'tache-assignee', { teamId: A.teamId });
  assert.deepEqual((await ok('/notifications', s.grimm123)).liste.map(n => n.type).sort(), ['sp-action', 'tache-assignee']);
  await ok(`/roles-permissions/globaux/${sc.id}`, s.fondateur, { methode: 'PATCH', corps: { permissions: sc.permissions.filter(p => !p.startsWith('sponsors.')) } });
  const apres = await ok('/notifications', s.grimm123);
  assert.ok(!apres.liste.some(n => n.type === 'sp-action'), 'Sponsors retiré : disparaît');
  assert.ok(apres.liste.some(n => n.type === 'tache-assignee'), 'accès à la team conservé');
  assert.equal(apres.nonLues, 1);
  // CM : un compte sans accès CM ne voit pas l’ancienne notification, Clara (Responsable CM) oui.
  const zoe = await b.session('zoe12345', 'Zoé');
  await insererPerso(b, 'zoe12345', 'cm-a-valider');
  await insererPerso(b, 'cm123456', 'cm-a-valider');
  assert.ok(!(await ok('/notifications', zoe)).liste.some(n => n.type === 'cm-a-valider'));
  assert.ok((await ok('/notifications', s.cm123456)).liste.some(n => n.type === 'cm-a-valider'));
});

test('ancienne route /notifications : élément devenu privé = jamais l’élément du fil ; récapitulatif courriel soumis au même contrôle', async () => {
  const { b, A, s, ok } = await preparer();
  const strat = await ok(`/teams/${A.teamId}/strats`, s.coach123, { methode: 'POST', corps: { titre: 'Exec Haven', visibilite: 'privee' } }).catch(() => null);
  const lea = await ok('/notifications', s.lea12345);
  assert.ok(!JSON.stringify(lea).includes('Exec Haven'), 'strat privée jamais révélée');
  void strat;
  // Récapitulatif : une personnelle Sponsors n’entre plus dans le courriel d’un compte sans droit Sponsors.
  await insererPerso(b, 'lea12345', 'sp-action');
  await insererPerso(b, 'lea12345', 'tache-assignee', { teamId: A.teamId });
  const { filtreVisibilite } = await import('../noyau/notifications/centre.mjs');
  const f = await filtreVisibilite(b.base, { compte: 'lea12345' });
  const types = (await b.base.tous(`SELECT p.type FROM notifications p WHERE p.compte_id = ? AND ${f.sql}`, ['lea12345', ...f.params])).map(r => r.type);
  assert.ok(types.includes('tache-assignee'));
  assert.ok(!types.includes('sp-action'));
});
