/**
 * Planning, disponibilités et présence par l'API (sans Cloudflare) :
 * permissions (un Joueur reçoit 403), tests négatifs entre teams, modules
 * désactivés, occurrences et séries, RSVP et marquage, statistiques et CSV,
 * heatmap et seuil, iCal (export, abonnement, jeton révoqué), rappels du
 * cron par le bus, accueil de la team, migration des rôles système.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseSqlite, lireMigrations } from '../adaptateurs/sqlite.mjs';
import { distribuer } from '../noyau/evenements.mjs';
import { appliquerMigrations } from '../noyau/migrations.mjs';
import { rappelsPresence } from '../noyau/planning/rappels.mjs';
import { banc, teamAvecMembres } from './aide.mjs';
import { verifierIcs } from './ics.mjs';

const MEMBRES = {
  max12345: { pseudo: 'Max', role: 'manager' },
  coach123: { pseudo: 'Zed', role: 'coach' },
  ana12345: { pseudo: 'Ana', role: 'analyste' },
  lea12345: { pseudo: 'Léa', role: 'joueur' },
  kai12345: { pseudo: 'Kai', role: 'joueur' },
  tom12345: { pseudo: 'Tom', role: 'remplacant' },
};
const MARDI = '2026-10-20T18:00:00.000Z'; // mardi 20 octobre, 20:00 à Paris
const occ = cle => encodeURIComponent(cle);

async function preparer() {
  const b = await banc();
  const A = await teamAvecMembres(b, { nom: 'Team Alpha', membres: MEMBRES });
  const B = await teamAvecMembres(b, { nom: 'Team Bravo', membres: { bob12345: { pseudo: 'Bob', role: 'coach' } } });
  const s = { ...A.sessions, bob12345: B.sessions.bob12345 };
  const api = (chemin, jeton, options = {}) => b.appel(chemin, { jeton, ...options });
  const creer = (corps, jeton = s.coach123, team = A.teamId) => api(`/teams/${team}/planning`, jeton, { methode: 'POST', corps });
  /** L'horloge avance : les sessions (une heure) sont reprises. */
  const avancer = async iso => {
    b.horloge.t = Date.parse(iso);
    for (const compte of Object.keys(s)) s[compte] = await b.session(compte === 'fondateur' ? 'principal' : compte);
  };
  return { b, A, B, s, api, creer, avancer };
}

const ENTRAINEMENT = { type: 'training', titre: 'Entraînement', date: '2026-10-20', heureDebut: '20:00', heureFin: '22:00', lieu: 'Discord', recurrence: { jours: [2, 4] } };

test('planning : CRUD par le Coach ; un Joueur sans droit ne voit pas les boutons et reçoit 403', async () => {
  const { A, s, api, creer } = await preparer();
  const r = await creer(ENTRAINEMENT);
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.deepEqual(r.corps.recurrence, { freq: 'hebdo', intervalle: 1, jours: [2, 4], jusqua: null, nombre: null });
  assert.equal(r.corps.debut, MARDI);
  assert.equal(r.corps.fuseau, 'Europe/Paris');
  const id = r.corps.id;

  // Le Joueur : lecture oui, boutons non (droits), écriture 403 en appel direct.
  const liste = await api(`/teams/${A.teamId}/planning?debut=2026-10-19&fin=2026-11-02`, s.lea12345);
  assert.equal(liste.statut, 200);
  assert.deepEqual(liste.corps.occurrences.map(o => [o.jour, o.heureDebut]), [
    ['2026-10-20', '20:00'],
    ['2026-10-22', '20:00'],
    ['2026-10-27', '20:00'],
    ['2026-10-29', '20:00'],
  ]);
  assert.equal(liste.corps.occurrences[2].debut, '2026-10-27T19:00:00.000Z', 'heure d’hiver : 19:00 UTC');
  assert.deepEqual([liste.corps.droits.creer, liste.corps.droits.modifier, liste.corps.droits.supprimer, liste.corps.droits.rsvp], [false, false, false, true]);
  for (const [chemin, methode, corps] of [
    [`/teams/${A.teamId}/planning`, 'POST', ENTRAINEMENT],
    [`/teams/${A.teamId}/planning/${id}`, 'PATCH', { titre: 'Piraté' }],
    [`/teams/${A.teamId}/planning/${id}/occurrences/${occ(MARDI)}`, 'PATCH', { titre: 'Piraté' }],
    [`/teams/${A.teamId}/planning/${id}`, 'DELETE'],
    [`/teams/${A.teamId}/planning/${id}/occurrences/${occ(MARDI)}`, 'DELETE'],
    [`/teams/${A.teamId}/planning/reglages`, 'PUT', { effectifMin: 1 }],
  ]) {
    const x = await api(chemin, s.lea12345, { methode, corps });
    assert.equal(x.statut, 403, `${methode} ${chemin}`);
    assert.equal(x.corps.code, 'permission');
  }
  // L'Analyste lit sans écrire ; le Coach, lui, a tout.
  assert.equal((await api(`/teams/${A.teamId}/planning/${id}`, s.ana12345, { methode: 'PATCH', corps: { titre: 'X' } })).statut, 403);
  const coach = await api(`/teams/${A.teamId}/planning?debut=2026-10-19&fin=2026-10-26`, s.coach123);
  assert.deepEqual([coach.corps.droits.creer, coach.corps.droits.modifier, coach.corps.droits.supprimer, coach.corps.droits.marquer], [true, true, true, true]);

  // Validation.
  assert.equal((await creer({ ...ENTRAINEMENT, type: 'apero' })).statut, 400);
  assert.equal((await creer({ ...ENTRAINEMENT, titre: 'x' })).statut, 400);
  assert.equal((await creer({ ...ENTRAINEMENT, date: '2026-02-30' })).statut, 400);
  assert.equal((await creer({ ...ENTRAINEMENT, recurrence: { freq: 'mensuel' } })).statut, 400);
  assert.equal((await creer({ ...ENTRAINEMENT, adversaireId: 'pas-un-uuid' })).statut, 400);
  assert.equal((await creer({ ...ENTRAINEMENT, concernes: ['inconnu1'] })).statut, 400);
  assert.equal((await creer({ ...ENTRAINEMENT, fuseau: 'Mars/Olympus' })).statut, 400);
  // Passe minuit : fin le lendemain ; adversaire (scouting, phase 5) facultatif.
  const nuit = await creer({ type: 'match', titre: 'Match de nuit', date: '2026-10-24', heureDebut: '23:00', heureFin: '01:00', adversaireId: '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d' });
  assert.equal(nuit.statut, 200);
  assert.equal(nuit.corps.fin, '2026-10-24T23:00:00.000Z');
  assert.equal(nuit.corps.adversaireId, '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d');
  assert.equal(nuit.corps.recurrence, null);

  // Série : le Manager renomme ; filtres type et membre.
  assert.equal((await api(`/teams/${A.teamId}/planning/${id}`, s.max12345, { methode: 'PATCH', corps: { titre: 'Entraînement aim' } })).statut, 200);
  const matchs = await api(`/teams/${A.teamId}/planning?debut=2026-10-19&fin=2026-11-02&types=match`, s.lea12345);
  assert.deepEqual(matchs.corps.occurrences.map(o => o.titre), ['Match de nuit']);
  const tous = await api(`/teams/${A.teamId}/planning?debut=2026-10-19&fin=2026-11-02&types=training,match`, s.lea12345);
  assert.equal(tous.corps.occurrences.filter(o => o.titre === 'Entraînement aim').length, 4);
  // Plage trop longue.
  assert.equal((await api(`/teams/${A.teamId}/planning?debut=2026-01-01&fin=2026-12-31`, s.lea12345)).statut, 400);
});

test('planning : une occurrence ou la série (modifier, annuler, couper « à partir de celle-ci », supprimer)', async () => {
  const { A, s, api, creer } = await preparer();
  const id = (await creer(ENTRAINEMENT)).corps.id;
  const voir = async () => (await api(`/teams/${A.teamId}/planning?debut=2026-10-19&fin=2026-11-16`, s.lea12345)).corps.occurrences;
  assert.equal((await voir()).length, 8);

  // Une occurrence déplacée et renommée.
  let r = await api(`/teams/${A.teamId}/planning/${id}/occurrences/${occ('2026-10-22T18:00:00.000Z')}`, s.coach123, {
    methode: 'PATCH',
    corps: { titre: 'Entraînement décalé', date: '2026-10-23', heureDebut: '19:00', heureFin: '21:00' },
  });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  let o = await voir();
  const decale = o.find(x => x.cle === '2026-10-22T18:00:00.000Z');
  assert.deepEqual([decale.titre, decale.jour, decale.heureDebut, decale.modifiee], ['Entraînement décalé', '2026-10-23', '19:00', true]);
  // Occurrence inexistante ; déplacement trop lointain.
  assert.equal((await api(`/teams/${A.teamId}/planning/${id}/occurrences/${occ('2026-10-21T18:00:00.000Z')}`, s.coach123, { methode: 'PATCH', corps: { titre: 'X' } })).statut, 404);
  assert.equal((await api(`/teams/${A.teamId}/planning/${id}/occurrences/${occ(MARDI)}`, s.coach123, { methode: 'PATCH', corps: { date: '2027-01-20', heureDebut: '20:00', heureFin: '21:00' } })).statut, 400);

  // Annuler une occurrence.
  r = await api(`/teams/${A.teamId}/planning/${id}?portee=occurrence&occurrence=${occ('2026-10-27T19:00:00.000Z')}`, s.coach123, { methode: 'DELETE' });
  assert.equal(r.statut, 200);
  o = await voir();
  assert.equal(o.length, 7);
  assert.ok(!o.some(x => x.cle === '2026-10-27T19:00:00.000Z'));
  // RSVP sur une occurrence annulée : 404.
  assert.equal((await api(`/teams/${A.teamId}/planning/${id}/occurrences/${occ('2026-10-27T19:00:00.000Z')}/rsvp`, s.lea12345, { methode: 'PUT', corps: { rsvp: 'oui' } })).statut, 404);

  // Couper la série à partir du 5 novembre.
  r = await api(`/teams/${A.teamId}/planning/${id}?portee=suivantes&occurrence=${occ('2026-11-05T19:00:00.000Z')}`, s.coach123, { methode: 'DELETE' });
  assert.equal(r.statut, 200);
  o = await voir();
  assert.deepEqual(o.map(x => x.jour), ['2026-10-20', '2026-10-23', '2026-10-29', '2026-11-03']);
  const detail = (await api(`/teams/${A.teamId}/planning/${id}`, s.lea12345)).corps;
  assert.equal(detail.recurrence.jusqua, '2026-11-04');

  // Changer l'horaire de la série : les exceptions tombent.
  r = await api(`/teams/${A.teamId}/planning/${id}`, s.coach123, { methode: 'PATCH', corps: { date: '2026-10-20', heureDebut: '21:00', heureFin: '23:00' } });
  assert.equal(r.statut, 200);
  assert.deepEqual(r.corps.exceptions, []);
  o = await voir();
  assert.deepEqual(o.map(x => `${x.jour} ${x.heureDebut}`), ['2026-10-20 21:00', '2026-10-22 21:00', '2026-10-27 21:00', '2026-10-29 21:00', '2026-11-03 21:00']);

  // Supprimer la série (logique : l'historique reste).
  assert.equal((await api(`/teams/${A.teamId}/planning/${id}`, s.coach123, { methode: 'DELETE' })).statut, 200);
  assert.equal((await voir()).length, 0);
  assert.equal((await api(`/teams/${A.teamId}/planning/${id}`, s.lea12345)).statut, 404);
});

test('planning : tests négatifs entre teams (404), modules désactivés (404), session absente (401)', async () => {
  const { A, B, s, api, creer } = await preparer();
  const idA = (await creer(ENTRAINEMENT)).corps.id;
  const idB = (await creer({ ...ENTRAINEMENT, titre: 'Secret Bravo' }, s.bob12345, B.teamId)).corps.id;
  // Bob (Coach de B) n'a rien dans A, quelle que soit la route.
  for (const [chemin, methode, corps] of [
    [`/teams/${A.teamId}/planning`, 'GET'],
    [`/teams/${A.teamId}/planning`, 'POST', ENTRAINEMENT],
    [`/teams/${A.teamId}/planning/${idA}`, 'GET'],
    [`/teams/${A.teamId}/planning/${idA}`, 'PATCH', { titre: 'X' }],
    [`/teams/${A.teamId}/planning/${idA}`, 'DELETE'],
    [`/teams/${A.teamId}/planning/accueil`, 'GET'],
    [`/teams/${A.teamId}/planning/export.ics`, 'GET'],
    [`/teams/${A.teamId}/planning/ical`, 'POST', {}],
    [`/teams/${A.teamId}/planning/${idA}/occurrences/${occ(MARDI)}/presence`, 'GET'],
    [`/teams/${A.teamId}/planning/${idA}/occurrences/${occ(MARDI)}/presence`, 'PUT', { marques: [{ compte: 'lea12345', reel: 'absent' }] }],
    [`/teams/${A.teamId}/presence/stats`, 'GET'],
    [`/teams/${A.teamId}/presence/export.csv`, 'GET'],
    [`/teams/${A.teamId}/dispos/carte`, 'GET'],
    [`/teams/${A.teamId}/dispos/moi/regles`, 'PUT', { regles: [] }],
  ]) {
    const r = await api(chemin, s.bob12345, { methode, corps });
    assert.equal(r.statut, 404, `${methode} ${chemin} : ${r.statut}`);
    assert.equal(r.corps.code, 'team-introuvable');
  }
  // L'événement de A n'est pas joignable par la team B, même pour qui est Coach de B.
  assert.equal((await api(`/teams/${B.teamId}/planning/${idA}`, s.bob12345)).statut, 404);
  assert.equal((await api(`/teams/${B.teamId}/planning/${idA}`, s.bob12345, { methode: 'PATCH', corps: { titre: 'X' } })).statut, 404);
  assert.equal((await api(`/teams/${B.teamId}/planning/${idA}/occurrences/${occ(MARDI)}/presence`, s.bob12345, { methode: 'PUT', corps: { marques: [{ compte: 'lea12345', reel: 'absent' }] } })).statut, 404);
  // Et inversement : le Coach de A ne touche pas l'événement de B.
  assert.equal((await api(`/teams/${A.teamId}/planning/${idB}`, s.coach123, { methode: 'DELETE' })).statut, 404);
  // Un joueur de B ne peut pas être noté présent dans A.
  assert.equal((await api(`/teams/${A.teamId}/planning/${idA}/occurrences/${occ(MARDI)}/presence`, s.coach123, { methode: 'PUT', corps: { marques: [{ compte: 'bob12345', reel: 'present' }] } })).statut, 400);
  // La liste de B ne contient rien de A.
  const listeB = await api(`/teams/${B.teamId}/planning?debut=2026-10-19&fin=2026-10-26`, s.bob12345);
  assert.ok(listeB.corps.occurrences.every(o => o.evenementId === idB));
  // Sans session.
  assert.equal((await api(`/teams/${A.teamId}/planning`)).statut, 401);

  // Modules désactivés : 404 « module-desactive ».
  await api(`/teams/${A.teamId}/modules`, s.fondateur, { methode: 'PUT', corps: { modules: { attendance: false } } });
  let r = await api(`/teams/${A.teamId}/planning/${idA}/occurrences/${occ(MARDI)}/rsvp`, s.lea12345, { methode: 'PUT', corps: { rsvp: 'oui' } });
  assert.equal(r.statut, 404);
  assert.equal(r.corps.code, 'module-desactive');
  assert.equal((await api(`/teams/${A.teamId}/presence/stats`, s.coach123)).corps.code, 'module-desactive');
  r = await api(`/teams/${A.teamId}/planning?debut=2026-10-19&fin=2026-10-26`, s.lea12345);
  assert.equal(r.corps.occurrences[0].monRsvp, null, 'pas de présence sans le module');
  await api(`/teams/${A.teamId}/modules`, s.fondateur, { methode: 'PUT', corps: { modules: { availability: false, planning: false } } });
  assert.equal((await api(`/teams/${A.teamId}/planning`, s.lea12345)).corps.code, 'module-desactive');
  assert.equal((await api(`/teams/${A.teamId}/dispos/carte`, s.lea12345)).corps.code, 'module-desactive');
  // Réactivé : rien n'a été perdu.
  await api(`/teams/${A.teamId}/modules`, s.fondateur, { methode: 'PUT', corps: { modules: { planning: true } } });
  assert.equal((await api(`/teams/${A.teamId}/planning/${idA}`, s.lea12345)).corps.titre, 'Entraînement');
});

test('présence : RSVP du joueur, marquage par le staff, statistiques par joueur et par type, CSV', async () => {
  const { A, s, api, creer, avancer } = await preparer();
  const id = (await creer(ENTRAINEMENT)).corps.id;
  const scrim = (await creer({ type: 'scrim', titre: 'Scrim vs Zeta', date: '2026-10-21', heureDebut: '19:00', heureFin: '21:00', concernes: ['lea12345', 'kai12345'] })).corps.id;
  const SCRIM = '2026-10-21T17:00:00.000Z';
  const rsvp = (qui, ev, cle, valeur) => api(`/teams/${A.teamId}/planning/${ev}/occurrences/${occ(cle)}/rsvp`, s[qui], { methode: 'PUT', corps: { rsvp: valeur } });

  assert.equal((await rsvp('lea12345', id, MARDI, 'oui')).statut, 200);
  assert.equal((await rsvp('kai12345', id, MARDI, 'non')).statut, 200);
  assert.equal((await rsvp('tom12345', id, MARDI, 'peut_etre')).statut, 200);
  assert.equal((await rsvp('lea12345', id, MARDI, 'bof')).statut, 400);
  // Tom n'est pas convoqué au scrim.
  assert.equal((await rsvp('tom12345', scrim, SCRIM, 'oui')).statut, 403);
  assert.equal((await rsvp('lea12345', scrim, SCRIM, 'oui')).statut, 200);

  // La liste de l'occurrence : le staff voit tout le monde ; le joueur, sa seule ligne.
  const pres = await api(`/teams/${A.teamId}/planning/${id}/occurrences/${occ(MARDI)}/presence`, s.coach123);
  assert.deepEqual(pres.corps.lignes.map(l => [l.pseudo, l.rsvp]), [['Ana', 'sans_reponse'], ['Kai', 'non'], ['Léa', 'oui'], ['Tom', 'peut_etre']]);
  const moi = await api(`/teams/${A.teamId}/planning/${id}/occurrences/${occ(MARDI)}/presence`, s.lea12345);
  assert.deepEqual(moi.corps.lignes.map(l => l.pseudo), ['Léa']);
  const liste = await api(`/teams/${A.teamId}/planning?debut=2026-10-19&fin=2026-10-21`, s.coach123);
  assert.deepEqual(liste.corps.occurrences[0].reponses, { oui: 1, non: 1, peut_etre: 1 });
  assert.equal((await api(`/teams/${A.teamId}/planning?debut=2026-10-19&fin=2026-10-21`, s.lea12345)).corps.occurrences[0].reponses, null);

  // Marquage : 403 pour un joueur ; le staff marque.
  const marques = [
    { compte: 'lea12345', reel: 'present' },
    { compte: 'kai12345', reel: 'excuse', note: 'Examen' },
    { compte: 'tom12345', reel: 'retard' },
    { compte: 'ana12345', reel: 'absent' },
  ];
  assert.equal((await api(`/teams/${A.teamId}/planning/${id}/occurrences/${occ(MARDI)}/presence`, s.lea12345, { methode: 'PUT', corps: { marques } })).statut, 403);
  assert.equal((await api(`/teams/${A.teamId}/planning/${id}/occurrences/${occ(MARDI)}/presence`, s.coach123, { methode: 'PUT', corps: { marques: [{ compte: 'lea12345', reel: 'parti' }] } })).statut, 400);
  const m = await api(`/teams/${A.teamId}/planning/${id}/occurrences/${occ(MARDI)}/presence`, s.coach123, { methode: 'PUT', corps: { marques } });
  assert.equal(m.statut, 200);
  assert.deepEqual(m.corps.lignes.find(l => l.pseudo === 'Kai'), { compte: 'kai12345', pseudo: 'Kai', rsvp: 'non', reel: 'excuse', note: 'Examen', marqueLe: m.corps.lignes.find(l => l.pseudo === 'Kai').marqueLe });
  await api(`/teams/${A.teamId}/planning/${scrim}/occurrences/${occ(SCRIM)}/presence`, s.coach123, {
    methode: 'PUT',
    corps: { marques: [{ compte: 'lea12345', reel: 'absent' }, { compte: 'kai12345', reel: 'present' }] },
  });
  // Jeudi : Léa présente.
  await api(`/teams/${A.teamId}/planning/${id}/occurrences/${occ('2026-10-22T18:00:00.000Z')}/presence`, s.coach123, { methode: 'PUT', corps: { marques: [{ compte: 'lea12345', reel: 'present' }] } });

  // Après la fin : le joueur ne répond plus (409).
  await avancer('2026-10-20T21:00:00Z');
  assert.equal((await rsvp('lea12345', id, MARDI, 'non')).statut, 409);

  const st = await api(`/teams/${A.teamId}/presence/stats?debut=2026-10-01&fin=2026-11-01`, s.coach123);
  assert.equal(st.statut, 200);
  assert.equal(st.corps.tout, true);
  const par = Object.fromEntries(st.corps.joueurs.map(j => [st.corps.noms[j.compte], j]));
  assert.equal(par['Léa'].evenements, 3);
  assert.equal(par['Léa'].taux, 2 / 3);
  assert.equal(par.Kai.taux, 1, 'excusé hors du taux');
  assert.equal(par.Tom.taux, 1);
  assert.equal(par.Tom.ponctualite, 0);
  assert.equal(par.Ana.taux, 0);
  assert.equal(st.corps.parType.find(t => t.type === 'scrim').taux, 1 / 2);
  assert.equal(st.corps.parType.find(t => t.type === 'training').taux, 3 / 4); // mardi : 2 sur 3 (Kai excusé), jeudi : Léa
  assert.deepEqual(st.corps.parPeriode.map(p => p.periode), ['2026-10']);
  // Par type d'événement (filtre) et par semaine.
  const scrims = await api(`/teams/${A.teamId}/presence/stats?debut=2026-10-01&fin=2026-11-01&types=scrim&granularite=semaine`, s.coach123);
  assert.deepEqual(scrims.corps.parType.map(t => t.type), ['scrim']);
  assert.deepEqual(scrims.corps.parPeriode.map(p => p.periode), ['2026-S43']);
  // Le joueur ne voit que les siennes.
  const lea = await api(`/teams/${A.teamId}/presence/stats?debut=2026-10-01&fin=2026-11-01`, s.lea12345);
  assert.equal(lea.corps.tout, false);
  assert.deepEqual(lea.corps.joueurs.map(j => j.compte), ['lea12345']);

  // CSV : staff seulement.
  assert.equal((await api(`/teams/${A.teamId}/presence/export.csv?debut=2026-10-01&fin=2026-11-01`, s.lea12345)).statut, 403);
  const c = await api(`/teams/${A.teamId}/presence/export.csv?debut=2026-10-01&fin=2026-11-01`, s.coach123);
  assert.equal(c.statut, 200);
  assert.match(c.entetes.get('Content-Type'), /^text\/csv/);
  assert.match(c.entetes.get('Content-Disposition'), /attachment; filename="presence-team-alpha-2026-10-01-2026-11-01\.csv"/);
  const lignes = c.corps.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lignes[0], '"Date","Heure","Événement","Type","Joueur","Réponse","Présence","Note"');
  assert.ok(lignes.includes('"2026-10-20","20:00","Entraînement","Entraînement","Kai","Non","Excusé","Examen"'));
  assert.equal(lignes.length, 1 + 4 + 2 + 1);
  const json = await api(`/teams/${A.teamId}/presence/export.csv?debut=2026-10-01&fin=2026-11-01&format=json`, s.coach123);
  assert.equal(json.corps.nom, 'presence-team-alpha-2026-10-01-2026-11-01.csv');

  // Journal : RSVP et marquage tracés.
  const journal = await api(`/teams/${A.teamId}/journal?action=attendance`, s.fondateur);
  assert.ok(journal.corps.entrees.some(e => e.action === 'attendance.marked'));
  assert.ok(journal.corps.entrees.some(e => e.action === 'attendance.rsvp'));
});

test('disponibilités : créneaux récurrents et exceptions, heatmap, seuil configurable par team', async () => {
  const { A, s, api } = await preparer();
  const regles = corps => api(`/teams/${A.teamId}/dispos/moi/regles`, corps.qui, { methode: 'PUT', corps });
  // Lundi soir : Léa 18-23, Kai 19-22, Tom 20-24 (saisi depuis Montréal : 14-18 heure de Montréal = 20-24 Paris).
  assert.equal((await regles({ qui: s.lea12345, regles: [{ jour: 1, debut: '18:00', fin: '23:00' }, { jour: 3, debut: '20:00', fin: '22:00', type: 'disponible' }] })).statut, 200);
  assert.equal((await regles({ qui: s.kai12345, regles: [{ jour: 1, debut: '19:00', fin: '22:00' }] })).statut, 200);
  const tom = await regles({ qui: s.tom12345, fuseau: 'America/Montreal', regles: [{ jour: 1, debut: '14:00', fin: '18:00' }] });
  assert.equal(tom.statut, 200, JSON.stringify(tom.corps));
  assert.equal(tom.corps.regles[0].fuseau, 'America/Montreal');
  assert.equal((await regles({ qui: s.lea12345, regles: [{ jour: 9, debut: '18:00', fin: '19:00' }] })).statut, 400);
  assert.equal((await regles({ qui: s.lea12345, regles: [{ jour: 1, debut: '18:00', fin: '18:00' }] })).statut, 400);
  // Exception datée : Léa indisponible lundi 26 au soir.
  const x = await api(`/teams/${A.teamId}/dispos/moi/exceptions`, s.lea12345, { methode: 'POST', corps: { date: '2026-10-26', heureDebut: '17:00', heureFin: '23:30', type: 'indisponible', note: 'Partiel' } });
  assert.equal(x.statut, 200);
  assert.equal(x.corps.exceptions.length, 1);
  assert.equal(x.corps.exceptions[0].debut, '2026-10-26T16:00:00.000Z', 'stocké en UTC (heure d’hiver)');
  // La heatmap : Joueur oui (lecture des disponibilités de la team), Remplaçant non.
  assert.equal((await api(`/teams/${A.teamId}/dispos/carte?semaine=2026-10-19`, s.tom12345)).statut, 403);
  let carte = await api(`/teams/${A.teamId}/dispos/carte?semaine=2026-10-21`, s.lea12345);
  assert.equal(carte.statut, 200);
  assert.equal(carte.corps.jours[0], '2026-10-19');
  assert.equal(carte.corps.seuil, 5);
  assert.equal(carte.corps.renseignes, 3);
  const lundi = carte.corps.cellules[0];
  assert.deepEqual(lundi.slice(18, 24).map(c => c.n), [1, 2, 3, 3, 2, 1]);
  assert.deepEqual(lundi[20].comptes.map(c => carte.corps.noms[c]).sort(), ['Kai', 'Léa', 'Tom']);
  assert.deepEqual(carte.corps.plages, []);
  // Seuil : Manager seulement (team.manage) ; le Coach reçoit 403.
  assert.equal((await api(`/teams/${A.teamId}/planning/reglages`, s.coach123, { methode: 'PUT', corps: { effectifMin: 3 } })).statut, 403);
  assert.equal((await api(`/teams/${A.teamId}/planning/reglages`, s.max12345, { methode: 'PUT', corps: { effectifMin: 99 } })).statut, 400);
  const reg = await api(`/teams/${A.teamId}/planning/reglages`, s.max12345, { methode: 'PUT', corps: { effectifMin: 3, rappelHeures: 12 } });
  assert.deepEqual([reg.corps.effectifMin, reg.corps.rappelHeures], [3, 12]);
  carte = await api(`/teams/${A.teamId}/dispos/carte?semaine=2026-10-19`, s.coach123);
  assert.deepEqual(carte.corps.plages, [{ jour: '2026-10-19', debut: '2026-10-19T18:00:00.000Z', fin: '2026-10-19T20:00:00.000Z', n: 3, heureDebut: '20:00', heureFin: '22:00' }]);
  assert.ok(carte.corps.droits.creer, 'le Coach peut proposer un événement');
  // Semaine suivante : l'exception de Léa retire son lundi. Et Paris est passé à l'heure d'hiver (25 octobre)
  // mais pas encore Montréal (1er novembre) : le 14:00-18:00 de Tom tombe à 19:00-23:00 heure de Paris.
  carte = await api(`/teams/${A.teamId}/dispos/carte?semaine=2026-10-26`, s.coach123);
  assert.deepEqual(carte.corps.cellules[0].slice(18, 24).map(c => c.n), [0, 2, 2, 2, 1, 0]);
  assert.deepEqual(carte.corps.plages, []);
  // Affichage dans un autre fuseau : 20:00 Paris = 14:00 à Montréal.
  carte = await api(`/teams/${A.teamId}/dispos/carte?semaine=2026-10-19&fuseau=America/Montreal`, s.coach123);
  assert.equal(carte.corps.cellules[0][14].n, 3);
  // Pas de 30 minutes.
  assert.equal((await api(`/teams/${A.teamId}/dispos/carte?semaine=2026-10-19&pas=30`, s.coach123)).corps.creneaux.length, 48);
  assert.equal((await api(`/teams/${A.teamId}/dispos/carte?semaine=2026-10-19&pas=45`, s.coach123)).statut, 400);
  // Mes disponibilités, et suppression d'une exception (la sienne seulement).
  const mes = await api(`/teams/${A.teamId}/dispos/moi`, s.lea12345);
  assert.equal(mes.corps.regles.length, 2);
  assert.equal((await api(`/teams/${A.teamId}/dispos/moi/exceptions/${mes.corps.exceptions[0].id}`, s.kai12345, { methode: 'DELETE' })).statut, 404);
  assert.equal((await api(`/teams/${A.teamId}/dispos/moi/exceptions/${mes.corps.exceptions[0].id}`, s.lea12345, { methode: 'DELETE' })).corps.exceptions.length, 0);
});

test('iCal : export valide, abonnement par URL signée, jeton révoqué ou accès perdu → 404', async () => {
  const { A, s, api, creer } = await preparer();
  await creer(ENTRAINEMENT);
  await creer({ type: 'tournament', titre: 'Coupe ; finale, BO3', date: '2026-11-07', heureDebut: '14:00', heureFin: '20:00', description: 'Ligne 1\nLigne 2', lieu: 'Paris' });
  const exp = await api(`/teams/${A.teamId}/planning/export.ics`, s.lea12345);
  assert.equal(exp.statut, 200);
  assert.match(exp.entetes.get('Content-Type'), /^text\/calendar/);
  const evs = verifierIcs(exp.corps);
  assert.ok(evs.some(e => e.SUMMARY === '[Tournoi] Coupe \\; finale\\, BO3' && e.DTSTART === '20261107T130000Z' && e.LOCATION === 'Paris'));
  assert.ok(evs.some(e => e.DTSTART === '20261027T190000Z'));

  // Abonnement : jeton montré une fois, URL sans session.
  const cree = await api(`/teams/${A.teamId}/planning/ical`, s.lea12345, { methode: 'POST', corps: { libelle: 'iPhone' } });
  assert.equal(cree.statut, 200);
  assert.match(cree.corps.chemin, /^\/ical\/ical_[A-Za-z0-9_-]{43}\.ics$/);
  const flux = await api(cree.corps.chemin);
  assert.equal(flux.statut, 200);
  assert.match(flux.entetes.get('Content-Type'), /^text\/calendar/);
  verifierIcs(flux.corps);
  const liste = await api(`/teams/${A.teamId}/planning/ical`, s.lea12345);
  assert.equal(liste.corps.abonnements.length, 1);
  assert.ok(liste.corps.abonnements[0].dernierAcces);
  assert.ok(!JSON.stringify(liste.corps).includes(cree.corps.jeton), 'le jeton n’est jamais relu');
  // Jeton faux, jeton d'un autre : 404 ; un autre membre ne révoque pas celui de Léa.
  assert.equal((await api('/ical/ical_' + 'A'.repeat(43) + '.ics')).statut, 404);
  assert.equal((await api('/ical/nimporte.ics')).statut, 404);
  assert.equal((await api(`/teams/${A.teamId}/planning/ical/${cree.corps.abonnement.id}`, s.kai12345, { methode: 'DELETE' })).statut, 404);
  // Révoqué : 404.
  assert.equal((await api(`/teams/${A.teamId}/planning/ical/${cree.corps.abonnement.id}`, s.lea12345, { methode: 'DELETE' })).statut, 200);
  assert.equal((await api(cree.corps.chemin)).statut, 404);
  // Un second jeton ; le membre retiré de la team perd l'accès au flux.
  const autre = await api(`/teams/${A.teamId}/planning/ical`, s.kai12345, { methode: 'POST', corps: {} });
  assert.equal((await api(autre.corps.chemin)).statut, 200);
  await api(`/teams/${A.teamId}/modules`, s.fondateur, { methode: 'PUT', corps: { modules: { planning: false } } });
  assert.equal((await api(autre.corps.chemin)).statut, 404, 'module désactivé');
  await api(`/teams/${A.teamId}/modules`, s.fondateur, { methode: 'PUT', corps: { modules: { planning: true } } });
  assert.equal((await api(autre.corps.chemin)).statut, 200);
  const membres = (await api(`/teams/${A.teamId}/membres`, s.fondateur)).corps.membres;
  await api(`/teams/${A.teamId}/membres/${membres.find(x => x.compte === 'kai12345').id}`, s.fondateur, { methode: 'DELETE' });
  assert.equal((await api(autre.corps.chemin)).statut, 404, 'membre retiré');
  // Cinq abonnements actifs au plus.
  for (let i = 0; i < 5; i++) await api(`/teams/${A.teamId}/planning/ical`, s.lea12345, { methode: 'POST', corps: {} });
  assert.equal((await api(`/teams/${A.teamId}/planning/ical`, s.lea12345, { methode: 'POST', corps: {} })).statut, 409);
});

test('rappels : le cron publie attendance.reminder (bus) → notification in-app aux joueurs sans réponse, une seule fois', async () => {
  const { b, A, s, api, creer } = await preparer();
  const id = (await creer(ENTRAINEMENT)).corps.id;
  await api(`/teams/${A.teamId}/planning/${id}/occurrences/${occ(MARDI)}/rsvp`, s.lea12345, { methode: 'PUT', corps: { rsvp: 'oui' } });
  // 10:00 UTC : l'occurrence de 18:00 UTC est dans les 24 h ; celle de jeudi non.
  const n = await rappelsPresence(b.base, { maintenant: b.horloge.t });
  // Liste de présence : Ana, Kai, Tom sans réponse (Léa a répondu ; Coach et Manager marquent).
  assert.equal(n, 3);
  assert.equal(await rappelsPresence(b.base, { maintenant: b.horloge.t + 60_000 }), 0, 'une seule fois');
  await distribuer(b.base, { maintenant: b.horloge.t });
  const kai = await api('/notifications', s.kai12345);
  const rappel = kai.corps.liste.find(x => x.type === 'rappel-rsvp');
  assert.ok(rappel);
  assert.equal(rappel.charge.occurrence, MARDI);
  assert.equal(rappel.team.id, A.teamId);
  assert.ok(!(await api('/notifications', s.lea12345)).corps.liste.some(x => x.type === 'rappel-rsvp'));
  assert.ok(!(await api('/notifications', s.coach123)).corps.liste.some(x => x.type === 'rappel-rsvp'));
  const journal = await api(`/teams/${A.teamId}/journal?action=attendance.reminder`, s.fondateur);
  assert.equal(journal.corps.entrees.length, 3);
  // Rappel désactivé (0) : rien.
  await api(`/teams/${A.teamId}/planning/reglages`, s.max12345, { methode: 'PUT', corps: { rappelHeures: 0 } });
  assert.equal(await rappelsPresence(b.base, { maintenant: Date.parse('2026-10-22T08:00:00Z') }), 0);
  // Notification « nouvel événement » aux membres (pas à l'auteur).
  assert.ok(kai.corps.liste.some(x => x.type === 'evenement-nouveau' && x.charge.titre === 'Entraînement'));
  assert.ok(!(await api('/notifications', s.coach123)).corps.liste.some(x => x.type === 'evenement-nouveau'));
});

test('accueil de la team : prochains événements, alertes de présence (RSVP manquant, à marquer)', async () => {
  const { A, s, api, creer, avancer } = await preparer();
  const id = (await creer(ENTRAINEMENT)).corps.id;
  let lea = await api(`/teams/${A.teamId}/planning/accueil`, s.lea12345);
  assert.equal(lea.statut, 200);
  assert.equal(lea.corps.prochains[0].debut, MARDI);
  assert.equal(lea.corps.prochains[0].monRsvp, 'sans_reponse');
  assert.ok(lea.corps.alertes.some(a => a.genre === 'rsvp' && a.cle === MARDI));
  await api(`/teams/${A.teamId}/planning/${id}/occurrences/${occ(MARDI)}/rsvp`, s.lea12345, { methode: 'PUT', corps: { rsvp: 'oui' } });
  lea = await api(`/teams/${A.teamId}/planning/accueil`, s.lea12345);
  assert.equal(lea.corps.prochains[0].monRsvp, 'oui');
  assert.ok(!lea.corps.alertes.some(a => a.genre === 'rsvp' && a.cle === MARDI));
  let coach = await api(`/teams/${A.teamId}/planning/accueil`, s.coach123);
  assert.ok(coach.corps.alertes.some(a => a.genre === 'sans-reponse' && a.cle === MARDI && a.sansReponse === 3));
  await avancer('2026-10-21T08:00:00Z');
  coach = await api(`/teams/${A.teamId}/planning/accueil`, s.coach123);
  assert.ok(coach.corps.alertes.some(a => a.genre === 'a-marquer' && a.cle === MARDI && a.nonMarques === 4));
  // L'accueil d'un autre membre ne dévoile rien d'une autre team.
  assert.equal((await api(`/teams/${A.teamId}/planning/accueil`, s.bob12345)).statut, 404);
});

test('migration 0002 : les rôles système déjà créés reçoivent les permissions du plan', async () => {
  const base = await baseSqlite();
  const [m1, m2] = lireMigrations();
  await appliquerMigrations(base, [m1]);
  const d = '2026-10-01T00:00:00.000Z';
  await base.executer("INSERT INTO teams (id, nom, slug, jeu, cree_par, cree_le, maj_le) VALUES ('t1', 'T', 't', 'valorant', 'principal', ?, ?)", [d, d]);
  for (const [id, cle] of [['rj', 'joueur'], ['rr', 'remplacant'], ['ra', 'analyste'], ['rc', 'coach']]) {
    await base.executer("INSERT INTO roles (id, team_id, cle_systeme, nom, couleur, systeme, position, cree_le, maj_le) VALUES (?, 't1', ?, ?, '#000000', 1, 1, ?, ?)", [id, cle, cle, d, d]);
  }
  await base.executer("INSERT INTO role_permissions (role_id, permission) VALUES ('rj', 'availability.edit_own')", []);
  await appliquerMigrations(base, [m1, m2]);
  const perms = async r => (await base.tous('SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission', [r])).map(l => l.permission);
  assert.deepEqual(await perms('rj'), ['availability.edit_own', 'availability.view_all']);
  assert.deepEqual(await perms('rr'), ['availability.edit_own']);
  assert.deepEqual(await perms('ra'), ['availability.view_all']);
  assert.deepEqual(await perms('rc'), []);
});
