/**
 * Finitions (phase 7) : journal d'activité complet (filtres, pagination,
 * export CSV, rétention et purge par le cron), statistiques de la team,
 * exports CSV des tâches et des objectifs, RGPD (export et suppression par le
 * membre ou par le Fondateur), index de la migration 0007.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { purgerJournal, moduleDAction } from '../noyau/journal.mjs';
import { purgerLimites } from '../noyau/limites.mjs';
import { distribuer } from '../noyau/evenements.mjs';
import { banc, teamAvecMembres } from './aide.mjs';
import { SUR_POSTGRES, nomsIndex } from './base.mjs';

const MEMBRES = {
  max12345: { pseudo: 'Max', role: 'manager' },
  coach123: { pseudo: 'Zed', role: 'coach' },
  lea12345: { pseudo: 'Léa', role: 'joueur' },
  kai12345: { pseudo: 'Kai', role: 'joueur' },
};
const MARDI = '2026-10-20T18:00:00.000Z';

async function preparer() {
  const b = await banc();
  const A = await teamAvecMembres(b, { nom: 'Team Alpha', membres: MEMBRES });
  const api = (chemin, jeton, options = {}) => b.appel(chemin, { jeton, ...options });
  return { b, A, s: A.sessions, api, t: `/teams/${A.teamId}` };
}

// ------------------------------------------------------------------ Journal

test('journal : filtres membre, module, action et période ; pagination ; membres proposés', async () => {
  const { b, s, api, t } = await preparer();
  await api(`${t}/taches`, s.coach123, { methode: 'POST', corps: { titre: 'Revoir la défense B', assigne: 'lea12345' } });
  b.horloge.t += 3 * 86_400_000;
  const session = async c => b.session(c);
  await api(`${t}/planning`, await session('coach123'), { methode: 'POST', corps: { type: 'scrim', titre: 'Scrim', date: '2026-10-25', heureDebut: '20:00', heureFin: '22:00' } });
  const max = await session('max12345');
  const tout = (await api(`${t}/journal`, max)).corps;
  assert.ok(tout.entrees.length >= 7);
  assert.ok(tout.membres.some(m => m.compte === 'lea12345' && m.pseudo === 'Léa'), 'membres pour le filtre');
  assert.equal(tout.retentionJours, 365);
  assert.ok(tout.entrees.every(e => typeof e.module === 'string'));
  // Membre.
  const zed = (await api(`${t}/journal?acteur=coach123`, max)).corps.entrees;
  assert.deepEqual([...new Set(zed.map(e => e.action))].sort(), ['event.created', 'member.joined', 'task.assigned', 'task.created']);
  // Module.
  assert.deepEqual((await api(`${t}/journal?module=planning`, max)).corps.entrees.map(e => e.action), ['event.created']);
  assert.deepEqual((await api(`${t}/journal?module=goals_tasks`, max)).corps.entrees.map(e => e.action).sort(), ['task.assigned', 'task.created']);
  assert.ok((await api(`${t}/journal?module=coeur`, max)).corps.entrees.every(e => e.module === 'coeur'));
  // Action (famille ou exacte).
  assert.equal((await api(`${t}/journal?action=task`, max)).corps.entrees.length, 2);
  assert.equal((await api(`${t}/journal?action=task.created`, max)).corps.entrees.length, 1);
  // Période (dates de la team) : le jour de la tâche seulement.
  const jour = (await api(`${t}/journal?du=2026-10-20&au=2026-10-20&module=goals_tasks`, max)).corps.entrees;
  assert.equal(jour.length, 2);
  assert.equal((await api(`${t}/journal?du=2026-10-21&module=goals_tasks`, max)).corps.entrees.length, 0);
  assert.equal((await api(`${t}/journal?du=2026-10-23&au=2026-10-20`, max)).statut, 400);
  assert.equal((await api(`${t}/journal?module=finances`, max)).statut, 400);
  // Pagination par curseur : sans doublon ni trou.
  const vus = [];
  let avant;
  for (let i = 0; i < 20; i++) {
    const p = (await api(`${t}/journal?limite=2${avant ? `&avant=${encodeURIComponent(avant)}` : ''}`, max)).corps;
    vus.push(...p.entrees.map(e => e.id));
    if (!p.suite) break;
    avant = p.suite;
  }
  // Plusieurs entrées ont la même date (un même lot) : le curseur « date|id » n'en saute ni n'en répète aucune.
  assert.equal(new Set(vus).size, vus.length);
  assert.deepEqual(vus, tout.entrees.map(e => e.id));
  assert.equal((await api(`${t}/journal?avant=pas-une-date`, max)).statut, 400);
  // Droits : le Joueur ne lit pas le journal.
  assert.equal((await api(`${t}/journal`, await session('lea12345'))).statut, 403);
  assert.equal(moduleDAction('strat.share_created'), 'strat_editor');
});

test('journal : export CSV (pseudos, filtres, formules neutralisées) ; append-only (aucune route d’écriture)', async () => {
  const { s, api, t } = await preparer();
  await api(`${t}/taches`, s.coach123, { methode: 'POST', corps: { titre: '=HYPERLINK("http://x")' } });
  const r = await api(`${t}/journal/export.csv?module=goals_tasks`, s.max12345);
  assert.equal(r.statut, 200);
  assert.match(r.entetes.get('Content-Type'), /text\/csv/);
  assert.match(r.entetes.get('Content-Disposition'), /attachment; filename="journal-team-alpha-/);
  const lignes = r.corps.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lignes[0], '"Date (UTC)","Membre","Module","Action","Élément","Identifiant","Détails"');
  assert.equal(lignes.length, 2);
  assert.match(lignes[1], /"Zed","goals_tasks","task.created"/);
  // Enveloppe JSON pour l'app.
  const j = await api(`${t}/journal/export.csv?format=json`, s.max12345);
  assert.equal(j.corps.type, 'text/csv; charset=utf-8');
  assert.ok(j.corps.contenu.includes('task.created'));
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal((await api(`${t}/journal`, s.fondateur, { methode: m, corps: m === 'DELETE' ? undefined : {} })).statut, 404, m);
});

test('journal : rétention réglable (team.manage) et purge par le cron, événements traités effacés', async () => {
  const { b, A, s, api, t } = await preparer();
  const r = await api(`${t}/journal/reglages`, s.max12345);
  assert.deepEqual([r.corps.retentionJours, r.corps.modifiable], [365, true]);
  assert.equal((await api(`${t}/journal/reglages`, s.max12345, { methode: 'PUT', corps: { retentionJours: 45 } })).statut, 400);
  assert.equal((await api(`${t}/journal/reglages`, s.max12345, { methode: 'PUT', corps: { retentionJours: 30 } })).corps.retentionJours, 30);
  assert.equal((await api(`${t}/journal/reglages`, s.lea12345, { methode: 'PUT', corps: { retentionJours: 0 } })).statut, 403);
  // Une autre team garde la durée par défaut.
  const B = await teamAvecMembres(b, { nom: 'Team Bravo' });
  const avant = Number((await b.base.premier('SELECT COUNT(*) AS n FROM journal WHERE team_id = ?', [A.teamId])).n);
  assert.ok(avant > 5);
  // 40 jours plus tard : tout le journal de A (30 jours) part, celui de B (365 jours) reste.
  b.horloge.t += 40 * 86_400_000;
  const nouvelle = await b.session('max12345');
  await api(`${t}/taches`, await b.session('coach123'), { methode: 'POST', corps: { titre: 'Récente' } });
  await distribuer(b.base, { maintenant: b.horloge.t });
  const bilan = await purgerJournal(b.base, { maintenant: b.horloge.t });
  assert.ok(bilan.journal >= avant - 1, JSON.stringify(bilan));
  assert.ok(bilan.evenements > 0, 'événements traités de plus de 30 jours');
  const restant = (await api(`${t}/journal`, nouvelle)).corps.entrees.map(e => e.action);
  assert.deepEqual(restant, ['task.created']);
  assert.ok(Number((await b.base.premier('SELECT COUNT(*) AS n FROM journal WHERE team_id = ?', [B.teamId])).n) > 0);
  // 0 = illimitée.
  await api(`${t}/journal/reglages`, nouvelle, { methode: 'PUT', corps: { retentionJours: 0 } });
  b.horloge.t += 5000 * 86_400_000;
  await distribuer(b.base, { maintenant: b.horloge.t });
  await purgerJournal(b.base, { maintenant: b.horloge.t });
  assert.ok(Number((await b.base.premier('SELECT COUNT(*) AS n FROM journal WHERE team_id = ?', [A.teamId])).n) >= 2);
  // Compteurs de débit anciens : effacés aussi.
  assert.ok((await purgerLimites(b.base, b.horloge.t)) >= 1);
});

// ------------------------------------------------------------------ Statistiques

test('stats : présence, tâches, résumés et activité sur une période ; blocs selon les droits', async () => {
  const { b, s, api, t } = await preparer();
  const ev = await api(`${t}/planning`, s.coach123, { methode: 'POST', corps: { type: 'training', titre: 'Entraînement', date: '2026-10-20', heureDebut: '20:00', heureFin: '22:00' } });
  assert.equal(ev.statut, 200, JSON.stringify(ev.corps));
  const occ = encodeURIComponent(MARDI);
  await api(`${t}/planning/${ev.corps.id}/occurrences/${occ}/rsvp`, s.lea12345, { methode: 'PUT', corps: { rsvp: 'oui' } });
  const marque = await api(`${t}/planning/${ev.corps.id}/occurrences/${occ}/presence`, s.coach123, { methode: 'PUT', corps: { marques: [{ compte: 'lea12345', reel: 'present' }, { compte: 'kai12345', reel: 'absent' }] } });
  assert.equal(marque.statut, 200, JSON.stringify(marque.corps));
  const tache = await api(`${t}/taches`, s.coach123, { methode: 'POST', corps: { titre: 'Faite', assigne: 'lea12345' } });
  await api(`${t}/taches/${tache.corps.id}`, s.lea12345, { methode: 'PATCH', corps: { statut: 'fait' } });
  await api(`${t}/taches`, s.coach123, { methode: 'POST', corps: { titre: 'En retard', echeance: '2026-10-01' } });
  const types = (await api(`${t}/resumes/types`, s.lea12345)).corps.types;
  await api(`${t}/resumes`, s.lea12345, { methode: 'POST', corps: { lien: 'https://exemple.fr/r', typeId: types[0].id, dateReunion: '2026-10-19', titre: 'Hebdo' } });

  const st = (await api(`${t}/stats?du=2026-10-01&au=2026-10-31`, s.max12345)).corps;
  assert.deepEqual(st.periode, { du: '2026-10-01', au: '2026-10-31', fuseau: 'Europe/Paris' });
  assert.equal(st.membres.actifs, 5);
  assert.equal(st.presence.seances, 1);
  assert.equal(st.presence.taux, 50);
  assert.deepEqual(st.presence.joueurs.map(j => [j.pseudo, j.taux]), [['Léa', 100], ['Kai', 0]]);
  assert.equal(st.presence.rsvp.oui, 1);
  assert.deepEqual([st.taches.creees, st.taches.terminees, st.taches.ouvertes, st.taches.enRetard], [2, 1, 1, 1]);
  assert.deepEqual([st.resumes.deposes, st.resumes.enAttente], [1, 1]);
  assert.ok(st.activite.actions >= 5);
  assert.ok(st.activite.parModule.goals_tasks >= 2);
  assert.ok(st.activite.parJour.length >= 1);
  // Période vide.
  const vide = (await api(`${t}/stats?du=2025-01-01&au=2025-01-31`, s.max12345)).corps;
  assert.equal(vide.presence.taux, null);
  assert.equal(vide.taches.creees, 0);
  // Le Joueur : pas la présence de toute l'équipe, pas le journal ; les tâches oui.
  const lea = (await api(`${t}/stats`, s.lea12345)).corps;
  assert.equal(lea.presence, null);
  assert.equal(lea.activite, null);
  assert.equal(lea.resumes, null);
  assert.ok(lea.taches);
  assert.equal((await api(`${t}/stats?du=2026-13-01&au=2026-10-31`, s.max12345)).statut, 400);
  // Plus de deux ans : refusé.
  assert.equal((await api(`${t}/stats?du=2020-01-01&au=2026-10-31`, s.max12345)).statut, 400);
  assert.ok(b);
});

// ------------------------------------------------------------------ Exports CSV des tâches et objectifs

test('exports CSV : tâches (filtres) et objectifs (progression) ; pagination des tâches', async () => {
  const { s, api, t } = await preparer();
  const obj = await api(`${t}/objectifs`, s.coach123, { methode: 'POST', corps: { titre: 'Monter Immortel', proprietaire: 'lea12345' } });
  for (let i = 0; i < 5; i++) await api(`${t}/taches`, s.coach123, { methode: 'POST', corps: { titre: `Tâche ${i}`, objectifId: obj.corps.id, assigne: i % 2 ? 'lea12345' : null, statut: i === 0 ? 'fait' : 'a_faire' } });
  const csv = (await api(`${t}/taches/export.csv?format=json`, s.lea12345)).corps;
  assert.match(csv.nom, /^taches-team-alpha-\d{4}-\d{2}-\d{2}\.csv$/);
  const lignes = csv.contenu.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lignes.length, 6);
  assert.match(lignes[0], /^"Titre","Description","Objectif","Assigné"/);
  assert.equal((await api(`${t}/taches/export.csv?format=json&filtre=miennes`, s.lea12345)).corps.contenu.trim().split('\r\n').length, 3);
  const brut = await api(`${t}/taches/export.csv`, s.lea12345);
  assert.match(brut.entetes.get('Content-Disposition'), /attachment/);
  const o = (await api(`${t}/objectifs/export.csv?format=json`, s.lea12345)).corps.contenu;
  assert.match(o, /"Monter Immortel","","Léa","","En cours","1","5","20"/);
  // Pagination : 2 par page, sans doublon.
  const p1 = (await api(`${t}/taches?limite=2`, s.lea12345)).corps;
  const p2 = (await api(`${t}/taches?limite=2&decalage=${p1.suite}`, s.lea12345)).corps;
  const p3 = (await api(`${t}/taches?limite=2&decalage=${p2.suite}`, s.lea12345)).corps;
  assert.deepEqual([p1.taches.length, p2.taches.length, p3.taches.length, p3.suite], [2, 2, 1, null]);
  assert.equal(new Set([...p1.taches, ...p2.taches, ...p3.taches].map(x => x.id)).size, 5);
});

// ------------------------------------------------------------------ RGPD

test('RGPD : export complet de mes données (toutes les catégories), sans secret', async () => {
  const { s, api, t } = await preparer();
  await api('/moi', s.lea12345, { methode: 'PUT', corps: { pseudo: 'Léa', riotId: 'Lea#EUW', discord: 'lea.gg' } });
  await api(`${t}/taches`, s.coach123, { methode: 'POST', corps: { titre: 'Pour Léa', assigne: 'lea12345' } });
  const types = (await api(`${t}/resumes/types`, s.lea12345)).corps.types;
  await api(`${t}/resumes`, s.lea12345, { methode: 'POST', corps: { lien: 'https://exemple.fr/r', typeId: types[0].id, dateReunion: '2026-10-19', titre: 'Ma réunion' } });
  await api(`${t}/planning/ical`, s.lea12345, { methode: 'POST', corps: { libelle: 'Téléphone' } });
  const e = (await api('/moi/export', s.lea12345)).corps;
  assert.equal(e.format, 'applibourse-esport-mes-donnees');
  assert.deepEqual(e.profil.riotId, 'Lea#EUW');
  for (const cle of ['teams', 'notifications', 'journal', 'disponibilites', 'presences', 'reunionsDeposees', 'taches', 'objectifs', 'reviewReperes', 'reviewCommentaires', 'strats', 'playbook', 'abonnementsIcal', 'invitationsCreees']) {
    assert.ok(cle in e, cle);
  }
  assert.equal(e.reunionsDeposees[0].titre, 'Ma réunion');
  assert.equal(e.taches[0].assigneAMoi, true);
  assert.equal(e.abonnementsIcal[0].libelle, 'Téléphone');
  assert.ok(!JSON.stringify(e).includes('ical_'), 'jamais le jeton iCal');
  assert.ok(!JSON.stringify(e).includes('jeton_hash'));
});

test('RGPD : suppression par le membre → données effacées, contenus de team anonymisés', async () => {
  const { b, A, s, api, t } = await preparer();
  const tache = await api(`${t}/taches`, s.coach123, { methode: 'POST', corps: { titre: 'Pour Léa', assigne: 'lea12345' } });
  const types = (await api(`${t}/resumes/types`, s.lea12345)).corps.types;
  await api(`${t}/resumes`, s.lea12345, { methode: 'POST', corps: { lien: 'https://exemple.fr/r', typeId: types[0].id, dateReunion: '2026-10-19', titre: 'Ma réunion' } });
  assert.equal((await api('/moi', s.lea12345, { methode: 'DELETE' })).statut, 200);
  assert.ok(!(await b.base.premier("SELECT id FROM comptes WHERE id = 'lea12345'", [])));
  assert.ok(!(await b.base.premier("SELECT id FROM membres WHERE compte_id = 'lea12345'", [])));
  assert.ok(!(await b.base.premier("SELECT id FROM notifications WHERE compte_id = 'lea12345'", [])));
  // La tâche reste à la team, sans assigné ; la réunion reste, sans pseudo.
  const tt = (await api(`${t}/taches`, s.coach123)).corps.taches.find(x => x.id === tache.corps.id);
  assert.equal(tt.assigne, null);
  const boite = (await api(`/resumes/boite?team=${A.teamId}`, s.fondateur)).corps.depots;
  assert.equal(boite[0].deposePar.pseudo, null);
  // Rien n'est recréé à son nom par la distribution du bus.
  await distribuer(b.base, { maintenant: b.horloge.t });
  assert.ok(!(await b.base.premier("SELECT id FROM notifications WHERE compte_id = 'lea12345'", [])));
});

test('RGPD : le Fondateur exporte et supprime le compte Esport d’un membre ; journalisé', async () => {
  const { b, s, api, t } = await preparer();
  const e = await api('/admin/comptes/kai12345/export', s.fondateur);
  assert.equal(e.statut, 200);
  assert.equal(e.corps.compte, 'kai12345');
  assert.equal(e.corps.profil.pseudo, 'Kai');
  assert.equal((await api('/admin/comptes/inconnu99/export', s.fondateur)).statut, 404);
  assert.equal((await api('/admin/comptes/..%2F..%2Fx/export', s.fondateur)).statut, 404);
  assert.equal((await api('/admin/comptes/kai12345', s.fondateur, { methode: 'DELETE' })).statut, 200);
  assert.ok(!(await b.base.premier("SELECT id FROM comptes WHERE id = 'kai12345'", [])));
  const journal = (await api(`${t}/journal`, s.max12345)).corps.entrees;
  const retrait = journal.find(x => x.action === 'member.removed');
  assert.equal(retrait.meta.compte, 'kai12345');
  assert.equal(retrait.meta.suppression, true);
  // Le dernier Propriétaire ne peut pas être effacé sans successeur.
  const B = await teamAvecMembres(b, { nom: 'Team Solo', membres: { own12345: { pseudo: 'Solo', role: 'proprietaire' } } });
  await api(`/teams/${B.teamId}/membres/${B.membres.principal.id}`, s.fondateur, { methode: 'DELETE' });
  const bloque = await api('/admin/comptes/own12345', await b.session('principal'), { methode: 'DELETE' });
  assert.equal(bloque.statut, 409);
  assert.equal(bloque.corps.code, 'dernier-proprietaire');
});

// ------------------------------------------------------------------ Performances

test('migration 0007 : index présents sur les requêtes fréquentes, table des limites', async () => {
  const { b } = await preparer();
  const index = await nomsIndex(b.base);
  for (const i of ['membres_team_statut', 'journal_team_action', 'journal_team_acteur', 'journal_cree', 'reunions_team_statut', 'taches_team_echeance', 'taches_team_termine', 'strats_team_maj', 'presences_team_compte', 'limites_debut']) {
    assert.ok(index.includes(i), i);
  }
  // Le plan d'exécution du journal filtré passe par un index (pas de parcours complet) : vérifié sur SQLite
  // (sur une table presque vide, Postgres préfère à raison un parcours séquentiel).
  if (SUR_POSTGRES) return;
  const plan = await b.base.tous("EXPLAIN QUERY PLAN SELECT * FROM journal WHERE team_id = ? AND action = ? ORDER BY cree_le DESC LIMIT 50", ['x', 'task.created']);
  assert.ok(plan.some(l => /USING (COVERING )?INDEX/.test(l.detail)), JSON.stringify(plan));
});
