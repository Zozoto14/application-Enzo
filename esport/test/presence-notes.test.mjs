/**
 * Refonte de la présence (feuille d'appel, retards, motifs, non-convoqués,
 * « À marquer », historique, fiche, statistiques et définitions, CSV) et
 * suivi des joueurs (notes du staff : permissions, invisibilité pour le
 * joueur concerné et les autres joueurs, partage d'une note, isolation entre
 * teams, journal sans contenu, RGPD).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';

const MEMBRES = {
  max12345: { pseudo: 'Max', role: 'manager' },
  coach123: { pseudo: 'Zed', role: 'coach' },
  ana12345: { pseudo: 'Ana', role: 'analyste' },
  lea12345: { pseudo: 'Léa', role: 'joueur' },
  kai12345: { pseudo: 'Kai', role: 'joueur' },
  tom12345: { pseudo: 'Tom', role: 'remplacant' },
};
const MARDI = '2026-10-20T18:00:00.000Z'; // mardi 20/10, 20:00 à Paris
const JEUDI = '2026-10-22T18:00:00.000Z';
const occ = cle => encodeURIComponent(cle);

async function preparer() {
  const b = await banc();
  const A = await teamAvecMembres(b, { nom: 'Team Alpha', membres: MEMBRES });
  const B = await teamAvecMembres(b, { nom: 'Team Bravo', membres: { bob12345: { pseudo: 'Bob', role: 'coach' } } });
  const s = { ...A.sessions, bob12345: B.sessions.bob12345 };
  const api = (chemin, jeton, options = {}) => b.appel(chemin, { jeton, ...options });
  const t = `/teams/${A.teamId}`;
  const avancer = async iso => {
    b.horloge.t = Date.parse(iso);
    for (const compte of Object.keys(s)) s[compte] = await b.session(compte === 'fondateur' ? 'principal' : compte);
  };
  return { b, A, B, s, api, t, avancer };
}

// Entraînement récurrent (mardi, jeudi) : les joueurs (Léa, Kai, Tom) sont convoqués.
const ENTRAINEMENT = { type: 'training', titre: 'Entraînement', date: '2026-10-20', heureDebut: '20:00', heureFin: '22:00', recurrence: { jours: [2, 4] } };

// ======================================================================== Présence

test('feuille d’appel : marquage en un appui, compteurs, « tout le monde présent » sans écraser les exceptions, retard en minutes, motifs', async () => {
  const { s, api, t, avancer } = await preparer();
  const id = (await api(`${t}/planning`, s.coach123, { methode: 'POST', corps: ENTRAINEMENT })).corps.id;
  const pres = `${t}/planning/${id}/occurrences/${occ(MARDI)}/presence`;
  const marquer = corps => api(pres, s.coach123, { methode: 'PUT', corps });
  await api(`${t}/planning/${id}/occurrences/${occ(MARDI)}/rsvp`, s.lea12345, { methode: 'PUT', corps: { rsvp: 'oui' } });
  await avancer('2026-10-20T18:30:00.000Z'); // la séance a commencé

  // Vue de la séance : compteurs et liste des convoqués.
  const v = (await api(pres, s.coach123)).corps;
  assert.equal(v.commence, true);
  assert.equal(v.termine, false);
  assert.deepEqual(v.lignes.map(l => l.pseudo), ['Kai', 'Léa', 'Tom']);
  assert.equal(v.compteurs.convoques, 3);
  assert.equal(v.compteurs.oui, 1);
  assert.equal(v.compteurs.sansReponse, 2);
  assert.equal(v.compteurs.nonMarques, 3);
  // Membres non convoqués qu'on peut ajouter (staff, Propriétaire…).
  assert.ok(v.ajoutables.some(m => m.compte === 'max12345') && !v.ajoutables.some(m => m.compte === 'lea12345'));

  // Un appui = un enregistrement : Kai en retard de 12 minutes.
  const r = await marquer({ marques: [{ compte: 'kai12345', reel: 'retard', retardMinutes: 12 }] });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.lignes.find(l => l.compte === 'kai12345').retardMinutes, 12);
  assert.equal(r.corps.compteurs.retard, 1);
  // Minutes illisibles : 400 ; les minutes ne valent qu'avec « en retard ».
  assert.equal((await marquer({ marques: [{ compte: 'kai12345', reel: 'retard', retardMinutes: 0.5 }] })).statut, 400);
  assert.equal((await marquer({ marques: [{ compte: 'kai12345', reel: 'retard', retardMinutes: 601 }] })).statut, 400);
  // Re-marquer « en retard » sans minutes garde les minutes déjà saisies.
  assert.equal((await marquer({ marques: [{ compte: 'kai12345', reel: 'retard' }] })).corps.lignes.find(l => l.compte === 'kai12345').retardMinutes, 12);
  // Tom excusé avec un motif.
  const ex = await marquer({ marques: [{ compte: 'tom12345', reel: 'excuse', motif: 'Rendez-vous médical' }] });
  assert.equal(ex.corps.lignes.find(l => l.compte === 'tom12345').motif, 'Rendez-vous médical');

  // « Tout le monde présent » : seule Léa (pas encore marquée) passe présente ; Kai et Tom gardent leur exception.
  const tout = await marquer({ toutPresent: true });
  assert.equal(tout.statut, 200);
  const par = Object.fromEntries(tout.corps.lignes.map(l => [l.compte, l]));
  assert.equal(par.lea12345.reel, 'present');
  assert.equal(par.kai12345.reel, 'retard');
  assert.equal(par.tom12345.reel, 'excuse');
  assert.deepEqual([tout.corps.compteurs.marques, tout.corps.compteurs.nonMarques], [3, 0]);
  // Rien à changer : pas d'écriture inutile.
  assert.equal((await marquer({ toutPresent: true })).statut, 200);

  // Passer « présent » efface minutes et motif.
  const p = await marquer({ marques: [{ compte: 'tom12345', reel: 'present' }, { compte: 'kai12345', reel: 'present' }] });
  assert.equal(p.corps.lignes.find(l => l.compte === 'tom12345').motif, '');
  assert.equal(p.corps.lignes.find(l => l.compte === 'kai12345').retardMinutes, null);
  // Un motif envoyé avec « présent » est ignoré.
  assert.equal((await marquer({ marques: [{ compte: 'lea12345', reel: 'present', motif: 'x' }] })).corps.lignes.find(l => l.compte === 'lea12345').motif, '');
  // Un joueur ne marque pas (403), corps vide (400).
  assert.equal((await api(pres, s.lea12345, { methode: 'PUT', corps: { toutPresent: true } })).statut, 403);
  assert.equal((await marquer({})).statut, 400);
});

test('non-convoqué venu quand même : refusé sans le dire, ajouté avec horsConvocation, hors des taux, compté « en plus », retiré par « non marqué »', async () => {
  const { s, api, t, avancer } = await preparer();
  const id = (await api(`${t}/planning`, s.coach123, { methode: 'POST', corps: ENTRAINEMENT })).corps.id;
  const pres = `${t}/planning/${id}/occurrences/${occ(MARDI)}/presence`;
  const marquer = marques => api(pres, s.coach123, { methode: 'PUT', corps: { marques } });
  await avancer('2026-10-20T21:00:00.000Z');
  const refus = await marquer([{ compte: 'ana12345', reel: 'present' }]);
  assert.equal(refus.statut, 400);
  assert.equal(refus.corps.code, 'non-convoque');
  // Compte inconnu de la team (Bob, Team Bravo) : 400 même « hors convocation ».
  assert.equal((await marquer([{ compte: 'bob12345', reel: 'present', horsConvocation: true }])).statut, 400);
  const ajout = await marquer([{ compte: 'ana12345', reel: 'present', horsConvocation: true }, { compte: 'lea12345', reel: 'present' }, { compte: 'kai12345', reel: 'absent' }, { compte: 'tom12345', reel: 'present' }]);
  assert.equal(ajout.statut, 200, JSON.stringify(ajout.corps));
  const ana = ajout.corps.lignes.find(l => l.compte === 'ana12345');
  assert.equal(ana.horsConvocation, true);
  assert.equal(ajout.corps.compteurs.convoques, 3, 'les convoqués ne changent pas');
  assert.equal(ajout.corps.compteurs.enPlus, 1);
  assert.ok(!ajout.corps.ajoutables.some(m => m.compte === 'ana12345'));
  // Re-marquer Ana (déjà ajoutée) n'exige plus le drapeau.
  assert.equal((await marquer([{ compte: 'ana12345', reel: 'retard', retardMinutes: 5 }])).statut, 200);

  const st = (await api(`${t}/presence/stats?debut=2026-10-01&fin=2026-11-01`, s.coach123)).corps;
  const anaSt = st.joueurs.find(j => j.compte === 'ana12345');
  assert.equal(anaSt.evenements, 0);
  assert.equal(anaSt.taux, null);
  assert.equal(anaSt.enPlus, 1);
  assert.equal(st.global.taux, 2 / 3, 'Léa et Tom présents, Kai absent ; Ana hors du taux');
  assert.equal(st.global.enPlus, 1);
  const csv = (await api(`${t}/presence/export.csv?debut=2026-10-01&fin=2026-11-01`, s.coach123)).corps.replace(/^﻿/, '').trim().split('\r\n');
  assert.ok(csv.includes('"2026-10-20","20:00","Entraînement","Entraînement","Ana","Non (venu en plus)","Sans réponse","","","En retard","5","",""'), csv.join('\n'));
  // Remis « non marqué » : retiré de la feuille d'appel.
  const retrait = await marquer([{ compte: 'ana12345', reel: 'inconnu' }]);
  assert.ok(!retrait.corps.lignes.some(l => l.compte === 'ana12345'));
  assert.equal(retrait.corps.compteurs.enPlus, 0);
});

test('réponse du joueur en un appui, avec « en retard de X min » ou « absent : motif » ; même modèle pour le bot Discord ; le journal n’a pas le motif', async () => {
  const { b, s, api, t, avancer } = await preparer();
  const id = (await api(`${t}/planning`, s.coach123, { methode: 'POST', corps: ENTRAINEMENT })).corps.id;
  const rsvp = (qui, corps, cle = MARDI) => api(`${t}/planning/${id}/occurrences/${occ(cle)}/rsvp`, s[qui], { methode: 'PUT', corps });
  const r = await rsvp('lea12345', { rsvp: 'oui', retardPrevu: 15 });
  assert.equal(r.statut, 200);
  assert.deepEqual(r.corps, { ok: true, rsvp: 'oui', retardPrevu: 15, motif: '' });
  assert.equal((await rsvp('lea12345', { rsvp: 'oui', retardPrevu: 1000 })).statut, 400);
  // Le bot (et un nouvel appui) n'envoie que la réponse : le retard annoncé reste.
  assert.equal((await rsvp('lea12345', { rsvp: 'peut_etre' })).corps.retardPrevu, 15);
  // « Non » efface le retard, garde le motif ; « Oui » efface le motif.
  const non = await rsvp('kai12345', { rsvp: 'non', motif: 'Examen de maths' });
  assert.deepEqual([non.corps.retardPrevu, non.corps.motif], [null, 'Examen de maths']);
  assert.equal((await rsvp('kai12345', { rsvp: 'non' })).corps.motif, 'Examen de maths');
  assert.equal((await rsvp('kai12345', { rsvp: 'oui' })).corps.motif, '');
  await rsvp('kai12345', { rsvp: 'non', motif: 'Examen de maths' });
  // Le staff voit l'annonce dans la feuille d'appel ; la liste du planning la rend au joueur.
  const v = (await api(`${t}/planning/${id}/occurrences/${occ(MARDI)}/presence`, s.coach123)).corps;
  assert.equal(v.lignes.find(l => l.compte === 'lea12345').retardPrevu, 15);
  assert.equal(v.lignes.find(l => l.compte === 'kai12345').motifPrevu, 'Examen de maths');
  const liste = (await api(`${t}/planning?debut=2026-10-19&fin=2026-10-21`, s.lea12345)).corps;
  assert.deepEqual(liste.occurrences[0].maReponse, { retardPrevu: 15, motif: '' });
  // Journal : réponse et retard, jamais le motif.
  await avancer('2026-10-20T12:00:00.000Z');
  const journal = await b.base.tous("SELECT meta FROM journal WHERE action = 'attendance.rsvp'", []);
  assert.ok(journal.length >= 4);
  assert.ok(!journal.some(j => j.meta.includes('Examen')));
});

test('« À marquer », historique, fiche d’un joueur, période (7 j, 30 j, saison) et début de saison réglable', async () => {
  const { s, api, t, avancer } = await preparer();
  const id = (await api(`${t}/planning`, s.coach123, { methode: 'POST', corps: ENTRAINEMENT })).corps.id;
  const marquer = (cle, marques) => api(`${t}/planning/${id}/occurrences/${occ(cle)}/presence`, s.coach123, { methode: 'PUT', corps: { marques } });
  await avancer('2026-10-22T18:30:00.000Z'); // jeudi, la séance a commencé
  const am = (await api(`${t}/presence/a-marquer`, s.coach123)).corps;
  assert.equal(am.total, 2);
  assert.deepEqual(am.seances.map(o => [o.cle, o.enCours, o.restants]), [
    [JEUDI, true, 3],
    [MARDI, false, 3],
  ]);
  assert.equal((await api(`${t}/presence/a-marquer`, s.lea12345)).statut, 403);
  // L'accueil signale aussi la séance EN COURS (commencée), comme la page Présence.
  const accueil = (await api(`${t}/planning/accueil`, s.coach123)).corps;
  assert.deepEqual(accueil.alertes.filter(a => a.genre === 'a-marquer').map(a => a.cle).sort(), [MARDI, JEUDI]);

  await marquer(MARDI, [
    { compte: 'lea12345', reel: 'present' },
    { compte: 'kai12345', reel: 'absent', motif: 'Malade' },
    { compte: 'tom12345', reel: 'retard', retardMinutes: 20 },
  ]);
  await marquer(JEUDI, [{ compte: 'kai12345', reel: 'excuse', motif: 'Malade' }]);
  const am2 = (await api(`${t}/presence/a-marquer`, s.coach123)).corps;
  assert.deepEqual(am2.seances.map(o => [o.cle, o.restants]), [[JEUDI, 2]], 'mardi complet : il disparaît');

  const h = (await api(`${t}/presence/historique?periode=30`, s.coach123)).corps;
  assert.deepEqual(h.seances.map(x => [x.cle, x.present, x.retard, x.absent, x.excuse, x.nonMarques]), [
    [JEUDI, 0, 0, 0, 1, 2],
    [MARDI, 1, 1, 1, 0, 0],
  ]);
  assert.equal(h.seances[1].taux, 2 / 3);
  assert.equal((await api(`${t}/presence/historique?periode=30`, s.lea12345)).statut, 403);

  // Fiche de Kai (staff) : deux absences de suite, motifs regroupés.
  const kai = (await api(`${t}/presence/joueurs/kai12345?periode=30`, s.coach123)).corps;
  assert.equal(kai.pseudo, 'Kai');
  assert.equal(kai.taux, 0);
  assert.deepEqual([kai.serie, kai.serieMax], [2, 2]);
  assert.deepEqual(kai.motifs, [{ motif: 'Malade', n: 2 }]);
  assert.deepEqual(kai.historique.map(x => [x.cle, x.reel]), [
    [JEUDI, 'excuse'],
    [MARDI, 'absent'],
  ]);
  // Le joueur voit SA fiche (« moi »), pas celle d'un autre.
  const moi = await api(`${t}/presence/joueurs/moi?periode=30`, s.tom12345);
  assert.equal(moi.statut, 200);
  assert.equal(moi.corps.retardMoyen, 20);
  assert.equal((await api(`${t}/presence/joueurs/kai12345`, s.tom12345)).statut, 403);

  // Périodes : 7 jours (16/10 → 23/10), saison (1er septembre par défaut, réglable).
  const sept = (await api(`${t}/presence/stats?periode=7`, s.coach123)).corps;
  assert.deepEqual([sept.debut, sept.fin], ['2026-10-16', '2026-10-23']);
  const saison = (await api(`${t}/presence/stats?periode=saison`, s.coach123)).corps;
  assert.deepEqual([saison.debut, saison.debutSaison], ['2026-09-01', '09-01']);
  assert.equal((await api(`${t}/planning/reglages`, s.fondateur, { methode: 'PUT', corps: { debutSaison: '13-01' } })).statut, 400);
  assert.equal((await api(`${t}/planning/reglages`, s.fondateur, { methode: 'PUT', corps: { debutSaison: '11-15' } })).statut, 200);
  assert.equal((await api(`${t}/presence/stats?periode=saison`, s.coach123)).corps.debut, '2025-11-15', 'avant le 15/11 : la saison a commencé l’an dernier');
  // Définitions : taux = (présents + retards) / marqués.
  const st = (await api(`${t}/presence/stats?periode=30`, s.coach123)).corps;
  const tom = st.joueurs.find(j => j.compte === 'tom12345');
  assert.deepEqual([tom.taux, tom.ponctualite, tom.retardMoyen, tom.nonMarques], [1, 0, 20, 1]);
  assert.equal(st.joueurs.find(j => j.compte === 'kai12345').serie, 2);
});

// ======================================================================== Suivi des joueurs

test('suivi des joueurs : le staff écrit et lit ; JAMAIS le joueur concerné ni les autres joueurs ; partage d’une note', async () => {
  const { s, api, t, b } = await preparer();
  const note = (qui, joueur, corps) => api(`${t}/suivi/${joueur}/notes`, s[qui], { methode: 'POST', corps });
  const c1 = await note('coach123', 'lea12345', { contenu: 'Très bon entry sur **Ascent**.', categorie: 'performance', ton: 'positif', tags: ['entry', '#Ascent', 'entry'], date: '2026-10-18' });
  assert.equal(c1.statut, 200, JSON.stringify(c1.corps));
  assert.deepEqual(c1.corps.tags, ['entry', 'Ascent']);
  assert.equal(c1.corps.partagee, false, 'privée par défaut');
  assert.equal(c1.corps.auteur.pseudo, 'Zed');
  const c2 = await note('ana12345', 'lea12345', { contenu: 'Comms tardives en retake.', categorie: 'communication', ton: 'a_travailler', epinglee: true });
  assert.equal(c2.statut, 200);
  assert.equal((await note('max12345', 'kai12345', { contenu: 'Ponctuel cette semaine.', categorie: 'comportement' })).statut, 200);
  // Validation.
  assert.equal((await note('coach123', 'lea12345', { contenu: '   ' })).statut, 400);
  assert.equal((await note('coach123', 'lea12345', { contenu: 'x', categorie: 'humeur' })).statut, 400);
  assert.equal((await note('coach123', 'lea12345', { contenu: 'x', ton: 'mauvais' })).statut, 400);
  assert.equal((await note('coach123', 'lea12345', { contenu: 'x', tags: Array.from({ length: 11 }, (_, i) => `t${i}`) })).statut, 400);
  assert.equal((await note('coach123', 'bob12345', { contenu: 'x' })).statut, 404, 'pas membre de la team');

  // Les joueurs (Léa, Kai) et le Remplaçant : 403 partout, y compris sur leur propre fiche.
  for (const qui of ['lea12345', 'kai12345', 'tom12345']) {
    assert.equal((await api(`${t}/suivi`, s[qui])).statut, 403, qui);
    assert.equal((await api(`${t}/suivi/lea12345`, s[qui])).statut, 403, qui);
    assert.equal((await note(qui, 'kai12345', { contenu: 'x' })).statut, 403, qui);
  }
  // Fiche (staff) : épinglée d'abord, filtres, recherche.
  const f = (await api(`${t}/suivi/lea12345`, s.coach123)).corps;
  assert.deepEqual(f.notes.map(n => n.categorie), ['communication', 'performance']);
  assert.equal(f.notes[0].epinglee, true);
  assert.deepEqual(f.etiquettes, ['Ascent', 'entry']);
  assert.equal(f.resume.total, 2);
  assert.ok(f.resume.presence, 'résumé : présence (le Coach la voit)');
  assert.ok(f.resume.taches, 'résumé : tâches');
  assert.deepEqual((await api(`${t}/suivi/lea12345?categorie=performance`, s.coach123)).corps.notes.map(n => n.id), [c1.corps.id]);
  assert.deepEqual((await api(`${t}/suivi/lea12345?q=retake`, s.coach123)).corps.notes.map(n => n.id), [c2.corps.id]);
  assert.deepEqual((await api(`${t}/suivi/lea12345?tag=ascent`, s.coach123)).corps.notes.map(n => n.id), [c1.corps.id]);
  assert.deepEqual((await api(`${t}/suivi/lea12345?ton=a_travailler`, s.coach123)).corps.notes.map(n => n.id), [c2.corps.id]);
  // L'Analyste n'a pas la présence dans son résumé (pas attendance.view_all).
  assert.equal((await api(`${t}/suivi/lea12345`, s.ana12345)).corps.resume.presence, null);

  // Le staff concerné ne voit pas SA fiche : une note sur Ana lui reste invisible.
  assert.equal((await note('coach123', 'ana12345', { contenu: 'Analyse trop longue en réunion.', categorie: 'communication' })).statut, 200);
  const propre = await api(`${t}/suivi/ana12345`, s.ana12345);
  assert.equal(propre.statut, 403);
  assert.equal(propre.corps.code, 'propre-fiche');
  assert.ok(!(await api(`${t}/suivi`, s.ana12345)).corps.joueurs.some(j => j.compte === 'ana12345'));
  assert.deepEqual((await api(`${t}/suivi/moi`, s.ana12345)).corps.notes, []);

  // Rien n'est partagé : Léa ne voit rien.
  assert.deepEqual((await api(`${t}/suivi/moi`, s.lea12345)).corps.notes, []);
  // Partage d'UNE note, sans l'auteur : Léa la voit seule, en lecture.
  const part = await api(`${t}/suivi/lea12345/notes/${c1.corps.id}`, s.coach123, { methode: 'PATCH', corps: { partagee: true, auteurMasque: true } });
  assert.equal(part.statut, 200, JSON.stringify(part.corps));
  const vue = (await api(`${t}/suivi/moi`, s.lea12345)).corps.notes;
  assert.equal(vue.length, 1);
  assert.equal(vue[0].contenu, 'Très bon entry sur **Ascent**.');
  assert.equal(vue[0].auteur, null, 'auteur masqué');
  assert.equal(vue[0].lien, undefined);
  // Kai (autre joueur) ne voit pas la note partagée avec Léa.
  assert.deepEqual((await api(`${t}/suivi/moi`, s.kai12345)).corps.notes, []);
  // Notification à Léa, sans le contenu.
  const notifs = (await api('/notifications', s.lea12345)).corps.liste.filter(n => n.type === 'note-partagee');
  assert.equal(notifs.length, 1);
  assert.ok(!JSON.stringify(notifs).includes('Ascent'));
  // Auteur visible si non masqué.
  await api(`${t}/suivi/lea12345/notes/${c1.corps.id}`, s.coach123, { methode: 'PATCH', corps: { auteurMasque: false } });
  assert.equal((await api(`${t}/suivi/moi`, s.lea12345)).corps.notes[0].auteur, 'Zed');
  // Partage retiré : plus rien.
  await api(`${t}/suivi/lea12345/notes/${c1.corps.id}`, s.coach123, { methode: 'PATCH', corps: { partagee: false } });
  assert.deepEqual((await api(`${t}/suivi/moi`, s.lea12345)).corps.notes, []);

  // Journal : « note ajoutée sur X », jamais le contenu.
  const journal = await b.base.tous("SELECT action, meta FROM journal WHERE action LIKE 'player_note.%'", []);
  assert.ok(journal.some(j => j.action === 'player_note.created' && JSON.parse(j.meta).compte === 'lea12345'));
  assert.ok(journal.some(j => j.action === 'player_note.shared'));
  for (const j of journal) assert.deepEqual(Object.keys(JSON.parse(j.meta)).filter(k => !['compte', 'partagee'].includes(k)), [], j.meta);
  assert.ok(!journal.some(j => /Ascent|retake|Analyse/.test(j.meta)));
  const entrees = (await api(`${t}/journal?module=player_notes`, s.fondateur)).corps.entrees;
  assert.ok(entrees.length >= 4);
});

test('suivi des joueurs : modifier, épingler, supprimer selon le rôle ; lien vers un événement ; isolation entre teams ; module désactivé', async () => {
  const { A, B, s, api, t } = await preparer();
  const creer = (qui, corps, joueur = 'kai12345') => api(`${t}/suivi/${joueur}/notes`, s[qui], { methode: 'POST', corps });
  const n1 = (await creer('coach123', { contenu: 'Note du coach', categorie: 'mental' })).corps;
  const n2 = (await creer('ana12345', { contenu: 'Note de l’analyste', categorie: 'performance' })).corps;
  const patch = (qui, id, corps) => api(`${t}/suivi/kai12345/notes/${id}`, s[qui], { methode: 'PATCH', corps });
  const suppr = (qui, id) => api(`${t}/suivi/kai12345/notes/${id}`, s[qui], { methode: 'DELETE' });
  // L'Analyste épingle la note du Coach, mais n'en change pas le texte ni le partage.
  assert.equal((await patch('ana12345', n1.id, { epinglee: true })).corps.epinglee, true);
  assert.equal((await patch('ana12345', n1.id, { contenu: 'Réécrit' })).statut, 403);
  assert.equal((await patch('ana12345', n1.id, { partagee: true })).statut, 403);
  assert.equal(n1.peutSupprimer, true);
  assert.equal(n2.peutSupprimer, true, 'l’auteur supprime sa note');
  const vueAna = (await api(`${t}/suivi/kai12345`, s.ana12345)).corps.notes.find(n => n.id === n1.id);
  assert.deepEqual([vueAna.peutModifier, vueAna.peutSupprimer], [false, false]);
  assert.equal((await suppr('ana12345', n1.id)).statut, 403);
  // Le Manager (player_notes.delete) modifie et supprime toute note.
  assert.equal((await patch('max12345', n2.id, { ton: 'positif', date: '2026-10-01' })).corps.date, '2026-10-01');
  assert.equal((await suppr('ana12345', n2.id)).statut, 200, 'auteur');
  assert.equal((await suppr('max12345', n1.id)).statut, 200);
  assert.equal((await api(`${t}/suivi/kai12345`, s.coach123)).corps.notes.length, 0);
  assert.equal((await suppr('max12345', n1.id)).statut, 404);

  // Lien vers un événement de la team ; pas vers celui d'une autre team.
  const ev = (await api(`${t}/planning`, s.coach123, { methode: 'POST', corps: { type: 'scrim', titre: 'Scrim vs Nova', date: '2026-10-21', heureDebut: '19:00', heureFin: '21:00' } })).corps.id;
  const evB = (await api(`/teams/${B.teamId}/planning`, s.bob12345, { methode: 'POST', corps: { type: 'scrim', titre: 'Autre', date: '2026-10-21', heureDebut: '19:00', heureFin: '21:00' } })).corps.id;
  const lie = await creer('coach123', { contenu: 'Bon scrim', lien: { type: 'evenement', id: ev, occurrence: '2026-10-21T17:00:00.000Z' } });
  assert.equal(lie.statut, 200, JSON.stringify(lie.corps));
  assert.deepEqual(lie.corps.lien, { type: 'evenement', id: ev, occurrence: '2026-10-21T17:00:00.000Z', titre: 'Scrim vs Nova' });
  assert.equal((await creer('coach123', { contenu: 'x', lien: { type: 'evenement', id: evB } })).statut, 400);
  assert.equal((await creer('coach123', { contenu: 'x', lien: { type: 'review', id: evB } })).statut, 400);

  // Isolation : Bob (Coach de Team Bravo) ne voit ni les fiches ni la note de Team Alpha.
  assert.equal((await api(`${t}/suivi`, s.bob12345)).statut, 404);
  assert.equal((await api(`${t}/suivi/kai12345`, s.bob12345)).statut, 404);
  assert.equal((await api(`/teams/${B.teamId}/suivi/kai12345`, s.bob12345)).statut, 404, 'Kai n’est pas dans Team Bravo');
  assert.equal((await api(`/teams/${B.teamId}/suivi/kai12345/notes/${lie.corps.id}`, s.bob12345, { methode: 'DELETE' })).statut, 404);
  // Une note de Team Alpha ne se modifie pas par l'adresse d'un autre joueur.
  assert.equal((await api(`${t}/suivi/lea12345/notes/${lie.corps.id}`, s.coach123, { methode: 'PATCH', corps: { contenu: 'x' } })).statut, 404);

  // Module désactivé : 404 pour tous, y compris /suivi/moi.
  await api(`/teams/${A.teamId}/modules`, s.fondateur, { methode: 'PUT', corps: { modules: { player_notes: false } } });
  assert.equal((await api(`${t}/suivi`, s.coach123)).statut, 404);
  assert.equal((await api(`${t}/suivi/moi`, s.kai12345)).statut, 404);
});

test('suivi des joueurs et RGPD : export du joueur (notes partagées seulement), export par le Fondateur (privées aussi), suppression du compte', async () => {
  const { b, s, api, t } = await preparer();
  const creer = (corps, joueur = 'lea12345', qui = 'coach123') => api(`${t}/suivi/${joueur}/notes`, s[qui], { methode: 'POST', corps });
  await creer({ contenu: 'Partagée avec Léa', partagee: true });
  await creer({ contenu: 'Privée du staff' });
  await creer({ contenu: 'Sur Kai, écrite par Léa ? impossible' }, 'kai12345', 'lea12345');
  await creer({ contenu: 'Sur Kai' }, 'kai12345');
  const lea = (await api('/moi/export', s.lea12345)).corps;
  assert.deepEqual(lea.notesPartagees.map(n => n.contenu), ['Partagée avec Léa']);
  assert.equal(lea.notesStaffPrivees, undefined);
  assert.ok(!JSON.stringify(lea).includes('Privée du staff'));
  const parFondateur = (await api('/admin/comptes/lea12345/export', s.fondateur)).corps;
  assert.deepEqual(parFondateur.notesStaffPrivees.map(n => n.contenu), ['Privée du staff']);
  const coach = (await api('/moi/export', s.coach123)).corps;
  assert.deepEqual(coach.notesRedigees.map(n => n.notes), [3]);
  assert.ok(!JSON.stringify(coach).includes('Sur Kai'), 'l’export de l’auteur ne contient pas les notes sur les autres');

  // Suppression du compte de Léa : les notes sur elle disparaissent.
  assert.equal((await api('/moi', s.lea12345, { methode: 'DELETE' })).statut, 200);
  assert.equal((await b.base.tous("SELECT id FROM notes_joueurs WHERE joueur_id = 'lea12345'", [])).length, 0);
  // Suppression du compte du Coach : ses notes restent, anonymisées.
  assert.equal((await api('/admin/comptes/coach123', s.fondateur, { methode: 'DELETE' })).statut, 200);
  const restantes = await b.base.tous("SELECT auteur_id, auteur_masque FROM notes_joueurs WHERE joueur_id = 'kai12345'", []);
  assert.deepEqual(restantes.map(n => [n.auteur_id, Number(n.auteur_masque)]), [[null, 1]]);
  const fiche = (await api(`${t}/suivi/kai12345`, s.max12345)).corps;
  assert.equal(fiche.notes[0].auteur, null);
});
