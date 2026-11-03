/**
 * Réunions de l'équipe CM (migration 0039, docs/esport/cm-reunions.md) :
 *  - règles pures : « Trouver un créneau » (fuseaux, exceptions, réunions existantes), statut du moment ;
 *  - permissions : équipe CM (voir, créer), Responsable CM (gérer), Fondateur, membre du club invité, autres (404) ;
 *  - création, réponses (accepter, peut-être, refuser, proposer un autre horaire), modification (réponses remises en
 *    attente), annulation (série, occurrence), notifications et événements du bus ;
 *  - récurrence hebdomadaire (heure murale gardée au changement d'heure) ;
 *  - rendez-vous : offre, réservation, JAMAIS de double réservation, annulation qui libère le créneau ;
 *  - notes confidentielles : réservées aux participants, absentes des événements, MP, iCal ; tâche IA confidentielle ;
 *  - rappels (in-app + MP Discord du bot, langue du membre, une seule fois) ;
 *  - tâche de suivi → carte d'un tableau CM ; RGPD ; export / import ; migration.
 *
 * Tourne sur SQLite (défaut) et sur PostgreSQL (ESPORT_TEST_PG).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { TABLES, exporterBase, importerBase } from '../noyau/transfert.mjs';
import { baseMigree } from './base.mjs';
import { distribuer } from '../noyau/evenements.mjs';
import { proposerCreneaux, statutEffectif } from '../noyau/cm/reunions/regles.mjs';
import { rappelsReunions } from '../noyau/cm/reunions/rappels.mjs';
import { traiterMpReunions } from '../noyau/cm/reunions/mp.mjs';
import { tacheConfidentielle } from '../noyau/ia/confidentialite.mjs';
import { TOUTES_PERMISSIONS } from '../noyau/permissions.mjs';

const H = 3_600_000;
const JOUR = 24 * H;

// ------------------------------------------------------------------ Règles pures

test('trouver un créneau : disponibilités, absences, réunions existantes et fuseau de chacun', () => {
  // Mardi 20 octobre 2026. Ana (Paris) : dispo 14:00–18:00 heure de Paris. Ben (New York) : dispo 09:00–13:00 heure de New York
  // (= 15:00–19:00 à Paris). Commun : 15:00–18:00 Paris. Ben a déjà une réunion 15:00–16:00 Paris.
  const du = Date.parse('2026-10-19T22:00:00Z');
  const au = Date.parse('2026-10-20T22:00:00Z');
  const ana = { compte: 'ana12345', fuseau: 'Europe/Paris', regles: [{ jour: 2, debut: '14:00', fin: '18:00', type: 'disponible', fuseau: 'Europe/Paris' }], exceptions: [], occupes: [] };
  const ben = { compte: 'ben12345', fuseau: 'America/New_York', regles: [{ jour: 2, debut: '09:00', fin: '13:00', type: 'disponible', fuseau: 'America/New_York' }], exceptions: [], occupes: [{ s: Date.parse('2026-10-20T13:00:00Z'), e: Date.parse('2026-10-20T14:00:00Z') }] };
  const r = proposerCreneaux({ participants: [ana, ben], du, au, duree: 60, fuseau: 'Europe/Paris' });
  assert.equal(r[0].tous, true);
  // 16:00–17:00 heure de Paris (14:00Z) : le premier créneau où les deux sont libres.
  assert.equal(r[0].debut, '2026-10-20T14:00:00.000Z');
  assert.deepEqual(r[0].libres.sort(), ['ana12345', 'ben12345']);
  // À 15:00 Paris, Ben est en réunion : proposé seulement avec Ana, marqué « occupé ».
  const a15 = r.find(x => x.debut === '2026-10-20T13:00:00.000Z');
  if (a15) assert.deepEqual(a15.occupes, ['ben12345']);
  assert.ok(r.every(x => x.debut >= '2026-10-20T12:00:00.000Z'), 'jamais en dehors des créneaux d’Ana');

  // Absence (congé) d'Ana : plus aucun créneau commun.
  const conge = { ...ana, exceptions: [{ debut: '2026-10-20T00:00:00Z', fin: '2026-10-21T00:00:00Z', type: 'conge' }] };
  const r2 = proposerCreneaux({ participants: [conge, ben], du, au, duree: 60, fuseau: 'Europe/Paris' });
  assert.ok(r2.every(x => !x.tous && x.absents.includes('ana12345')));

  // Sans créneau saisi : libre (signalé « inconnu ») seulement dans SA journée (09:00–22:00 chez lui).
  const tokyo = { compte: 'kei12345', fuseau: 'Asia/Tokyo', regles: [], exceptions: [], occupes: [] };
  const r3 = proposerCreneaux({ participants: [tokyo], du, au, duree: 60, fuseau: 'Europe/Paris', heureMin: 0, heureMax: 1440 });
  for (const x of r3) {
    const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', hourCycle: 'h23' }).format(new Date(x.debut)));
    assert.ok(h >= 9 && h < 22, `heure de Tokyo ${h}`);
    assert.deepEqual(x.inconnus, ['kei12345']);
  }
  // Les propositions ne se chevauchent pas.
  for (const x of r) for (const y of r) if (x !== y) assert.ok(x.fin <= y.debut || y.fin <= x.debut);
});

test('statut du moment : choisi (jusqu’à sa fin), sinon absent (congé en cours), sinon en réunion, sinon disponible', () => {
  const t = Date.parse('2026-10-20T10:00:00Z');
  assert.equal(statutEffectif({ profil: { statut: 'ne_pas_deranger', message: 'Montage', statut_jusqua: '2026-10-20T12:00:00Z' } }, t).statut, 'ne_pas_deranger');
  assert.equal(statutEffectif({ profil: { statut: 'ne_pas_deranger', statut_jusqua: '2026-10-20T09:00:00Z' } }, t).statut, 'disponible');
  assert.equal(statutEffectif({ exceptions: [{ debut: '2026-10-19T00:00:00Z', fin: '2026-10-22T00:00:00Z', type: 'conge' }] }, t).statut, 'absent');
  assert.equal(statutEffectif({ enReunion: true }, t).statut, 'occupe');
  assert.equal(statutEffectif({}, t).auto, true);
});

test('catalogue : cm.reunions.voir / cm.reunions.gerer (permissions du club, jamais d’un rôle de team) ; export ; IA confidentielle', () => {
  for (const p of ['cm.reunions.voir', 'cm.reunions.gerer']) assert.ok(!TOUTES_PERMISSIONS.includes(p), p);
  for (const t of ['cm_reunions', 'cm_reunion_participants', 'cm_reunion_notes', 'cm_reunion_taches', 'cm_dispo_regles', 'cm_dispo_exceptions', 'cm_rdv_offres', 'cm_rdv_creneaux', 'cm_reunion_ical']) assert.ok(TABLES.some(([n]) => n === t), `export : ${t}`);
  assert.equal(tacheConfidentielle('cm-reunions'), 'resumes');
  assert.equal(tacheConfidentielle('notes-reunion'), 'resumes');
});

// ------------------------------------------------------------------ Banc

async function preparer(options = {}) {
  const b = await banc(options);
  const A = await teamAvecMembres(b, { membres: { cor12345: { pseudo: 'Cora', role: 'joueur' }, joe12345: { pseudo: 'Joe', role: 'joueur' } } });
  const s = { ...A.sessions };
  s.res12345 = await b.session('res12345', 'Rita');
  s.ext12345 = await b.session('ext12345', 'Xavi');
  const api = (chemin, jeton, o = {}) => b.appel(chemin, { jeton, methode: o.methode, corps: o.corps });
  const ok = async (chemin, jeton, o = {}) => {
    const r = await api(chemin, jeton, o);
    assert.equal(r.statut, 200, `${o.methode ?? 'GET'} ${chemin} : ${r.statut} ${JSON.stringify(r.corps)}`);
    return r.corps;
  };
  // Rita : Responsable CM (club). Cora : Correspondante CM de la team (équipe CM, voir seulement). Joe : joueur.
  // Xavi : compte du club sans aucun rôle CM.
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'res12345', roleId: 'cm-role-responsable', portee: 'club' } });
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'cor12345', roleId: 'cm-role-correspondant', portee: A.teamId } });
  const notifs = async (jeton, type) => (await ok('/notifications', jeton)).liste.filter(n => !type || n.type === type);
  return { b, A, s, api, ok, notifs };
}

const corpsReunion = (o = {}) => ({ titre: 'Point éditorial', date: '2026-10-22', heureDebut: '18:00', heureFin: '19:00', fuseau: 'Europe/Paris', lieuGenre: 'lien', lien: 'https://meet.example.org/cm', ordreDuJour: 'Plan de la semaine SECRET-ODJ', participants: [], ...o });

test('permissions : l’équipe CM voit et crée, la Responsable CM gère tout, un compte sans rôle ne voit rien, un invité voit sa réunion', async () => {
  const { s, api, ok } = await preparer();
  const moiCora = await ok('/cm/moi', s.cor12345);
  assert.deepEqual(moiCora.reunions, { voir: true, gerer: false, invite: false });
  assert.equal(moiCora.espace, true);
  assert.deepEqual((await ok('/cm/moi', s.res12345)).reunions, { voir: true, gerer: true, invite: false });
  assert.equal((await ok('/cm/moi', s.joe12345)).reunions.voir, false);
  // Sans rôle : pas de création, pas d'équipe, pas de dispos.
  assert.equal((await api('/cm/reunions', s.ext12345, { methode: 'POST', corps: corpsReunion() })).statut, 404);
  assert.equal((await api('/cm/reunions/dispos/moi', s.ext12345)).statut, 404);
  assert.deepEqual((await ok('/cm/reunions/moi', s.ext12345)).equipe, []);

  // Cora crée sa réunion et invite Xavi (membre du club, hors équipe CM).
  const r = (await ok('/cm/reunions', s.cor12345, { methode: 'POST', corps: corpsReunion({ participants: ['ext12345'] }) })).reunion;
  assert.equal(r.organisateur, 'cor12345');
  assert.equal(r.debut, '2026-10-22T16:00:00.000Z');
  // Xavi est invité : il voit l'espace CM (onglet Réunions seulement), sa réunion et ses notes ; il y répond.
  assert.deepEqual((await ok('/cm/moi', s.ext12345)).reunions, { voir: false, gerer: false, invite: true });
  const agendaX = await ok('/cm/reunions?du=2026-10-19&au=2026-10-25', s.ext12345);
  assert.deepEqual(agendaX.reunions.map(x => x.id), [r.id]);
  assert.ok((await ok(`/cm/reunions/${r.id}`, s.ext12345)).reunion.notes);
  // Joe (sans rôle CM, pas invité) : 404.
  assert.equal((await api(`/cm/reunions/${r.id}`, s.joe12345)).statut, 404);
  assert.deepEqual((await ok('/cm/reunions?du=2026-10-19&au=2026-10-25', s.joe12345)).reunions, []);
  // Rita (Responsable CM) voit l'agenda de l'équipe et gère la réunion de Cora ; Xavi ne la modifie pas.
  assert.ok((await ok('/cm/reunions?du=2026-10-19&au=2026-10-25', s.res12345)).reunions.some(x => x.id === r.id));
  assert.equal((await api(`/cm/reunions/${r.id}`, s.ext12345, { methode: 'PATCH', corps: { titre: 'Pirate' } })).statut, 403);
  assert.equal((await ok(`/cm/reunions/${r.id}`, s.res12345, { methode: 'PATCH', corps: { titre: 'Point éditorial (Rita)' } })).reunion.titre, 'Point éditorial (Rita)');
  // Une réunion de Rita : Cora la voit (agenda d'équipe) mais ne la modifie ni ne l'annule.
  const r2 = (await ok('/cm/reunions', s.res12345, { methode: 'POST', corps: corpsReunion({ titre: 'Réunion de Rita' }) })).reunion;
  assert.equal((await api(`/cm/reunions/${r2.id}`, s.cor12345, { methode: 'PATCH', corps: { titre: 'X' } })).statut, 403);
  assert.equal((await api(`/cm/reunions/${r2.id}/annuler`, s.cor12345, { methode: 'POST', corps: {} })).statut, 403);
  // Le Fondateur a tout.
  assert.equal((await ok(`/cm/reunions/${r2.id}/annuler`, s.fondateur, { methode: 'POST', corps: { motif: 'Doublon' } })).reunion.statut, 'annulee');
  // Le correspondant qui quitte la team sort de l'équipe CM.
  await ok('/cm/affectations', s.fondateur);
});

test('création, réponses, modification et annulation : notifications et événements du bus (sans les notes)', async () => {
  const { b, s, api, ok, notifs } = await preparer();
  const r = (await ok('/cm/reunions', s.res12345, { methode: 'POST', corps: corpsReunion({ participants: ['cor12345', 'ext12345'] }) })).reunion;
  assert.deepEqual(r.participants.map(p => [p.compte, p.reponse]).sort(), [['cor12345', 'attente'], ['ext12345', 'attente'], ['res12345', 'accepte']]);
  assert.ok((await notifs(s.cor12345, 'cm-reunion-invite')).length === 1);
  assert.equal((await ok('/cm/reunions/moi', s.cor12345)).aRepondre, 1);

  await ok(`/cm/reunions/${r.id}/reponse`, s.cor12345, { methode: 'PUT', corps: { reponse: 'accepte' } });
  await ok(`/cm/reunions/${r.id}/reponse`, s.ext12345, { methode: 'PUT', corps: { reponse: 'peut_etre', commentaire: 'Si je finis à temps' } });
  const prop = await ok(`/cm/reunions/${r.id}/reponse`, s.ext12345, { methode: 'PUT', corps: { reponse: 'propose', date: '2026-10-23', heureDebut: '18:00', heureFin: '19:00' } });
  assert.deepEqual(prop.reunion.participants.find(p => p.compte === 'ext12345').proposition, { debut: '2026-10-23T16:00:00.000Z', fin: '2026-10-23T17:00:00.000Z' });
  assert.equal((await api(`/cm/reunions/${r.id}/reponse`, s.ext12345, { methode: 'PUT', corps: { reponse: 'attente' } })).statut, 400);
  assert.equal((await api(`/cm/reunions/${r.id}/reponse`, s.joe12345, { methode: 'PUT', corps: { reponse: 'accepte' } })).statut, 404);
  const reponses = await notifs(s.res12345, 'cm-reunion-reponse');
  assert.equal(reponses.length, 3);

  // Nouvel horaire : les réponses repassent en attente (sauf l'organisatrice), les invités sont prévenus.
  const m = await ok(`/cm/reunions/${r.id}`, s.res12345, { methode: 'PATCH', corps: { date: '2026-10-23', heureDebut: '18:00', heureFin: '19:00', version: r.version } });
  assert.deepEqual(m.reunion.participants.map(p => [p.compte, p.reponse]).sort(), [['cor12345', 'attente'], ['ext12345', 'attente'], ['res12345', 'accepte']]);
  assert.equal((await notifs(s.cor12345, 'cm-reunion-modifiee'))[0].charge.changements.includes('horaire'), true);
  // Version périmée : 409.
  assert.equal((await api(`/cm/reunions/${r.id}`, s.res12345, { methode: 'PATCH', corps: { titre: 'Autre', version: r.version } })).statut, 409);

  // Annulation : les participants sont prévenus, avec le motif.
  await ok(`/cm/reunions/${r.id}/annuler`, s.res12345, { methode: 'POST', corps: { motif: 'Report au mois prochain' } });
  const an = await notifs(s.ext12345, 'cm-reunion-annulee');
  assert.equal(an[0].charge.motif, 'Report au mois prochain');
  assert.equal((await api(`/cm/reunions/${r.id}/reponse`, s.cor12345, { methode: 'PUT', corps: { reponse: 'accepte' } })).statut, 409);

  // Événements du bus pour le centre de notifications : aucun ne contient les notes.
  const evs = await b.base.tous("SELECT type, charge FROM evenements WHERE type LIKE 'cm.reunion%'", []);
  assert.deepEqual([...new Set(evs.map(e => e.type))].sort(), ['cm.reunion_annulee', 'cm.reunion_creee', 'cm.reunion_modifiee', 'cm.reunion_reponse']);
  assert.ok(evs.every(e => !e.charge.includes('SECRET-ODJ')));
});

test('récurrence : réunion hebdomadaire à 18:00 heure de Paris de part et d’autre du changement d’heure ; une occurrence annulée', async () => {
  const { s, api, ok } = await preparer();
  const r = (await ok('/cm/reunions', s.res12345, { methode: 'POST', corps: corpsReunion({ date: '2026-10-20', recurrence: { freq: 'hebdo', jours: [2], nombre: 4 }, participants: ['cor12345'] }) })).reunion;
  const ag = await ok('/cm/reunions?du=2026-10-19&au=2026-11-30', s.cor12345);
  const debuts = ag.reunions.filter(x => x.id === r.id).map(x => x.debut);
  assert.deepEqual(debuts, ['2026-10-20T16:00:00.000Z', '2026-10-27T17:00:00.000Z', '2026-11-03T17:00:00.000Z', '2026-11-10T17:00:00.000Z']);
  assert.ok(ag.reunions.filter(x => x.id === r.id).every(x => x.local.heure === '18:00'));
  // Annuler la seule occurrence du 27 octobre.
  await ok(`/cm/reunions/${r.id}/annuler`, s.res12345, { methode: 'POST', corps: { occurrence: '2026-10-27T17:00:00.000Z' } });
  const apres = (await ok('/cm/reunions?du=2026-10-19&au=2026-11-30', s.cor12345)).reunions.filter(x => x.id === r.id).map(x => x.debut);
  assert.equal(apres.length, 3);
  assert.ok(!apres.includes('2026-10-27T17:00:00.000Z'));
  assert.equal((await api(`/cm/reunions/${r.id}/annuler`, s.res12345, { methode: 'POST', corps: { occurrence: '2026-10-28T17:00:00.000Z' } })).statut, 404);
  assert.equal((await api('/cm/reunions', s.res12345, { methode: 'POST', corps: corpsReunion({ recurrence: { freq: 'mensuel' } }) })).statut, 400);
});

test('disponibilités, statut et « Trouver un créneau » : fuseau, exceptions et réunions existantes ; grille de l’équipe', async () => {
  const { s, api, ok } = await preparer();
  // Rita (Paris) : jeudi 14:00–20:00. Cora (Montréal) : jeudi 10:00–15:00 heure de Montréal (16:00–21:00 Paris).
  await ok('/cm/reunions/dispos/moi/regles', s.res12345, { methode: 'PUT', corps: { fuseau: 'Europe/Paris', regles: [{ jour: 4, debut: '14:00', fin: '20:00', type: 'disponible' }] } });
  await ok('/cm/reunions/dispos/moi/regles', s.cor12345, { methode: 'PUT', corps: { fuseau: 'America/Toronto', regles: [{ jour: 4, debut: '10:00', fin: '15:00', type: 'disponible' }] } });
  // Une réunion existante de Rita jeudi 16:00–17:00 Paris.
  await ok('/cm/reunions', s.res12345, { methode: 'POST', corps: corpsReunion({ date: '2026-10-22', heureDebut: '16:00', heureFin: '17:00' }) });
  const c = await ok('/cm/reunions/creneaux', s.res12345, { methode: 'POST', corps: { participants: ['cor12345'], duree: 60, du: '2026-10-22', jours: 1, fuseau: 'Europe/Paris' } });
  assert.equal(c.propositions[0].tous, true);
  // 17:00–18:00 Paris : premier créneau commun après la réunion de Rita.
  assert.equal(c.propositions[0].local.heure, '17:00');
  assert.ok(!c.propositions.some(p => p.tous && p.local.heure === '16:00'));
  // Congé de Cora jeudi : plus de créneau où tout le monde est libre.
  await ok('/cm/reunions/dispos/moi/exceptions', s.cor12345, { methode: 'POST', corps: { type: 'conge', jourDebut: '2026-10-22', jourFin: '2026-10-22', fuseau: 'America/Toronto', note: 'Congé' } });
  const c2 = await ok('/cm/reunions/creneaux', s.res12345, { methode: 'POST', corps: { participants: ['cor12345'], duree: 60, du: '2026-10-22', jours: 1, fuseau: 'Europe/Paris' } });
  assert.ok(c2.propositions.every(p => !p.tous && p.absents.includes('cor12345')));
  // Statut du moment, visible par l'équipe.
  await ok('/cm/reunions/statut', s.cor12345, { methode: 'PUT', corps: { statut: 'ne_pas_deranger', message: 'Tournage' } });
  const eq = (await ok('/cm/reunions/moi', s.res12345)).equipe;
  assert.deepEqual(eq.find(m => m.compte === 'cor12345') && { statut: eq.find(m => m.compte === 'cor12345').statut, message: eq.find(m => m.compte === 'cor12345').message }, { statut: 'ne_pas_deranger', message: 'Tournage' });
  assert.ok(eq.some(m => m.compte === 'res12345') && eq.some(m => m.compte === 'principal'));
  assert.equal((await api('/cm/reunions/statut', s.cor12345, { methode: 'PUT', corps: { statut: 'en_vacances' } })).statut, 400);
  // Grille superposée de l'équipe (semaine du 19 octobre, heure de Paris).
  const g = await ok('/cm/reunions/equipe/grille?semaine=2026-10-19&fuseau=Europe/Paris', s.res12345);
  const jeudi = g.cellules[3];
  assert.ok(jeudi[14].comptes.includes('res12345'));
  assert.ok(!jeudi[16].comptes.includes('res12345'), 'réunion existante déduite');
  assert.equal((await api('/cm/reunions/equipe/grille', s.ext12345)).statut, 404);
});

test('rendez-vous : un créneau n’est réservé qu’une fois (même en même temps) ; annuler libère le créneau', async () => {
  const { b, s, api, ok, notifs } = await preparer();
  const offres = (await ok('/cm/reunions/rdv', s.res12345, { methode: 'POST', corps: { titre: 'Rendez-vous avec la Responsable CM', dureeMinutes: 30, fuseau: 'Europe/Paris', lieuGenre: 'discord', lien: 'https://discord.com/channels/1/2', plages: [{ date: '2026-10-21', heureDebut: '14:00', heureFin: '15:00' }] } })).offres;
  const offre = offres.find(o => o.mienne);
  assert.equal(offre.creneaux.length, 2);
  const [c1, c2] = offre.creneaux;
  // Rita ne réserve pas son propre créneau.
  assert.equal((await api(`/cm/reunions/rdv/creneaux/${c1.id}/reserver`, s.res12345, { methode: 'POST', corps: {} })).statut, 409);
  // Deux réservations simultanées du même créneau : une seule passe.
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'ext12345', roleId: 'cm-role-correspondant', portee: 'club' } });
  const [x, y] = await Promise.all([api(`/cm/reunions/rdv/creneaux/${c1.id}/reserver`, s.cor12345, { methode: 'POST', corps: { note: 'Parler du planning' } }), api(`/cm/reunions/rdv/creneaux/${c1.id}/reserver`, s.ext12345, { methode: 'POST', corps: {} })]);
  assert.deepEqual([x.statut, y.statut].sort(), [200, 409]);
  const gagnant = x.statut === 200 ? x.corps : y.corps;
  assert.equal(gagnant.reunion.genre, 'rdv');
  assert.equal(gagnant.reunion.organisateur, 'res12345');
  assert.equal((await b.base.tous('SELECT id FROM cm_reunions WHERE creneau_id = ?', [c1.id])).length, 1);
  assert.ok((await notifs(s.res12345, 'cm-rdv-reserve')).length === 1);
  // Les autres ne voient plus le créneau pris (ni qui l'a pris).
  const vue = (await ok('/cm/reunions/rdv', s.ext12345)).offres.find(o => o.id === offre.id);
  assert.ok(vue.creneaux.every(c => !c.reserve || c.reservePar === 'ext12345'));
  // Un rendez-vous est privé : la 3e personne de l'équipe ne le voit pas dans l'agenda.
  const perdant = x.statut === 200 ? s.ext12345 : s.cor12345;
  assert.equal((await api(`/cm/reunions/${gagnant.reunion.id}`, perdant)).statut, 404);
  // La personne qui a réservé annule : le créneau redevient libre et réservable.
  const compteReserveur = x.statut === 200 ? 'cor12345' : 'ext12345';
  const reserveur = s[compteReserveur];
  await ok(`/cm/reunions/${gagnant.reunion.id}/annuler`, reserveur, { methode: 'POST', corps: { motif: 'Empêchement' } });
  assert.equal((await ok(`/cm/reunions/rdv/creneaux/${c1.id}/reserver`, perdant, { methode: 'POST', corps: {} })).reunion.genre, 'rdv');
  assert.equal((await api(`/cm/reunions/rdv/creneaux/${c2.id}/reserver`, s.joe12345, { methode: 'POST', corps: {} })).statut, 404);
  // Le créneau passé ne se réserve plus.
  b.horloge.t = Date.parse('2026-10-21T13:00:00Z');
  assert.equal((await api(`/cm/reunions/rdv/creneaux/${c2.id}/reserver`, await b.session(compteReserveur), { methode: 'POST', corps: {} })).statut, 409);
});

test('notes confidentielles : participants seulement ; jamais dans le bus, les MP ni l’iCal ; tâche de suivi → carte CM', async () => {
  const { b, s, api, ok } = await preparer();
  const r = (await ok('/cm/reunions', s.res12345, { methode: 'POST', corps: corpsReunion({ participants: ['ext12345'] }) })).reunion;
  await ok(`/cm/reunions/${r.id}/notes`, s.ext12345, { methode: 'PUT', corps: { compteRendu: 'Décision SECRET-CR : sponsor X' } });
  // Cora (équipe CM, pas invitée) voit la réunion dans l'agenda, mais pas ses notes.
  const vueCora = await ok(`/cm/reunions/${r.id}`, s.cor12345);
  assert.equal(vueCora.reunion.notes, undefined);
  assert.ok(!JSON.stringify(vueCora).includes('SECRET'));
  assert.equal((await api(`/cm/reunions/${r.id}/notes`, s.cor12345, { methode: 'PUT', corps: { compteRendu: 'x' } })).statut, 403);
  assert.ok(!JSON.stringify(await ok('/cm/reunions?du=2026-10-19&au=2026-10-25', s.cor12345)).includes('SECRET'));
  // Rita (gérer) les lit.
  assert.equal((await ok(`/cm/reunions/${r.id}`, s.res12345)).reunion.notes.compteRendu, 'Décision SECRET-CR : sponsor X');
  // Tâche de suivi → carte du tableau « Contenus » du club (cm.editer de Rita).
  const t = (await ok(`/cm/reunions/${r.id}/taches`, s.res12345, { methode: 'POST', corps: { texte: 'Préparer le visuel sponsor', assigneA: 'res12345', echeance: '2026-10-30' } })).reunion.notes.taches[0];
  const tableau = (await ok('/cm/tableaux', s.res12345)).tableaux.find(x => x.cleDefaut && !x.team);
  const d = await ok(`/cm/reunions/taches/${t.id}/carte`, s.res12345, { methode: 'POST', corps: { tableauId: tableau.id } });
  assert.ok(d.carte.id);
  const carte = (await ok(`/cm/cartes/${d.carte.id}`, s.res12345)).carte;
  assert.equal(carte.titre, 'Préparer le visuel sponsor');
  assert.ok(!JSON.stringify(carte).includes('SECRET'));
  // Xavi (invité, sans cm.editer) ne crée pas de carte.
  const t2 = (await ok(`/cm/reunions/${r.id}/taches`, s.ext12345, { methode: 'POST', corps: { texte: 'Relancer le sponsor' } })).reunion.notes.taches.find(x => x.texte === 'Relancer le sponsor');
  assert.notEqual((await api(`/cm/reunions/taches/${t2.id}/carte`, s.ext12345, { methode: 'POST', corps: { tableauId: tableau.id } })).statut, 200);
  // iCal (abonnement) : la réunion, le lien de visio, jamais les notes.
  const j = await ok('/cm/reunions/ical', s.ext12345, { methode: 'POST', corps: { libelle: 'Téléphone' } });
  const ics = await b.appel(j.chemin);
  assert.equal(ics.statut, 200);
  assert.match(ics.corps, /SUMMARY:Point éditorial/);
  assert.match(ics.corps, /meet\.example\.org/);
  assert.ok(!ics.corps.includes('SECRET'));
  assert.equal((await b.appel('/cm-reunions/ical/cmr_inconnu.ics')).statut, 404);
  const abonnements = await ok('/cm/reunions/ical', s.ext12345);
  await ok(`/cm/reunions/ical/${abonnements.abonnements[0].id}`, s.ext12345, { methode: 'DELETE' });
  assert.equal((await b.appel(j.chemin)).statut, 404);
  // Rien de confidentiel dans le bus ni dans le journal.
  for (const table of ['evenements', 'journal', 'notifications']) assert.ok(!JSON.stringify(await b.base.tous(`SELECT * FROM ${table}`, [])).includes('SECRET'), table);
});

test('rappels : une fois par participant (in-app + MP du bot dans sa langue), jamais pour qui a refusé', async () => {
  const appels = [];
  const fetchDiscord = async (url, init) => {
    appels.push({ url, corps: JSON.parse(init.body) });
    if (url.endsWith('/users/@me/channels')) return new Response(JSON.stringify({ id: '900000000000000001' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({ id: '900000000000000002', channel_id: '900000000000000001' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const { b, s, ok, notifs } = await preparer({ fetchDiscord });
  await b.base.executer("UPDATE comptes SET langue = 'en', discord_id = '123456789012345678' WHERE id = 'cor12345'", []);
  // Réunion à 10:30 UTC (dans 30 min), rappel 15 min avant.
  const r = (await ok('/cm/reunions', s.res12345, { methode: 'POST', corps: corpsReunion({ date: undefined, debut: '2026-10-20T10:30:00Z', fin: '2026-10-20T11:00:00Z', rappelMinutes: 15, participants: ['cor12345', 'ext12345'] }) })).reunion;
  await ok(`/cm/reunions/${r.id}/reponse`, s.ext12345, { methode: 'PUT', corps: { reponse: 'refuse' } });
  assert.equal(await rappelsReunions(b.base, { maintenant: b.horloge.t }), 0, 'trop tôt');
  const t = Date.parse('2026-10-20T10:16:00Z');
  assert.equal(await rappelsReunions(b.base, { maintenant: t }), 2);
  assert.equal(await rappelsReunions(b.base, { maintenant: t + 60_000 }), 0, 'une seule fois');
  await distribuer(b.base, { maintenant: t, limite: 100 });
  assert.equal((await notifs(s.cor12345, 'cm-reunion-rappel')).length, 1);
  assert.equal((await notifs(s.ext12345, 'cm-reunion-rappel')).length, 0);
  const bilan = await traiterMpReunions(b.base, { fetch: fetchDiscord, maintenant: t, jetonBot: 'jeton-bot' });
  // Cora (liée à Discord) reçoit le MP en anglais ; Rita (non liée) : abandon.
  assert.equal(bilan.envoyes, 1);
  const message = appels.find(a => a.url.includes('/messages'));
  assert.match(message.corps.embeds[0].title, /Meeting reminder/);
  assert.ok(!JSON.stringify(message.corps).includes('SECRET'));
  assert.equal((await traiterMpReunions(b.base, { fetch: fetchDiscord, maintenant: t, jetonBot: 'jeton-bot' })).envoyes, 0);
});

test('RGPD : export des réunions et disponibilités ; suppression du compte ; export / import de la base', async () => {
  const { b, s, ok } = await preparer();
  const r = (await ok('/cm/reunions', s.res12345, { methode: 'POST', corps: corpsReunion({ participants: ['ext12345'] }) })).reunion;
  await ok('/cm/reunions/dispos/moi/regles', s.res12345, { methode: 'PUT', corps: { fuseau: 'Europe/Paris', regles: [{ jour: 1, debut: '10:00', fin: '12:00', type: 'disponible' }] } });
  const exp = await ok('/moi/export', s.res12345);
  assert.equal(exp.cmReunions[0].titre, 'Point éditorial');
  assert.equal(exp.cmDisponibilites.creneaux.length, 1);
  const supp = await b.appel('/moi', { methode: 'DELETE', jeton: s.ext12345, corps: { confirmation: 'SUPPRIMER' } });
  assert.equal(supp.statut, 200, JSON.stringify(supp.corps));
  assert.equal((await b.base.tous("SELECT * FROM cm_reunion_participants WHERE compte_id = 'ext12345'", [])).length, 0);
  assert.equal((await b.base.tous('SELECT * FROM cm_reunions WHERE id = ?', [r.id])).length, 1);
  const donnees = await exporterBase(b.base, b.horloge.t);
  assert.ok(donnees.tables.cm_reunions.length >= 1);
  const neuve = await baseMigree();
  const bilan = await importerBase(neuve, JSON.parse(JSON.stringify(donnees)));
  assert.equal(bilan.cm_reunions, donnees.tables.cm_reunions.length);
  assert.equal(bilan.cm_dispo_regles, 1);
  // Rôles CM système : la migration pose les permissions des réunions.
  const perms = (await neuve.tous("SELECT permission FROM cm_role_permissions WHERE role_id = 'cm-role-correspondant' AND permission LIKE 'cm.reunions%'", [])).map(l => l.permission);
  assert.deepEqual(perms, ['cm.reunions.voir']);
  void JOUR;
});
