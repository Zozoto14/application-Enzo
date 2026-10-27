/**
 * Modules « Tournois » et « Résultats » (migration 0022) :
 *  - score selon le profil de jeu (pur) : Valorant (BO3 en 13 rounds, mi-temps, prolongations), jeu à
 *    plusieurs équipes avec classement et barème (The Finals) ; victoire / défaite / nul / place ;
 *  - catalogue, migration sur une base existante, activation des modules, permissions, isolation ;
 *  - tournoi : fiche, roster borné par le profil, inscription et check-in, parcours, matchs liés au
 *    planning (événement « Tournoi » convoquant le roster, mis à jour, retiré) ;
 *  - résultats : saisie validée, lien au match du tournoi, visibilité staff, bilans et filtres, vue par
 *    adversaire reliée au scouting ;
 *  - bus : journal, notifications, Discord (annonce, résultat, classement final ; publiable ou non) ;
 *  - accueil, Dashboard, RGPD (export, suppression), export / import de la base.
 *
 * Tourne sur SQLite (défaut) et sur PostgreSQL (ESPORT_TEST_PG, esport/test/pg/lancer.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { baseVierge, lireMigrations } from './base.mjs';
import { URL_TEST } from './discord-aide.mjs';
import { appliquerMigrations } from '../noyau/migrations.mjs';
import { modulesDuPreset, permissionsRoleSysteme } from '../noyau/permissions.mjs';
import { validerDonnees } from '../noyau/jeux/schema.mjs';
import { profilValorant } from '../noyau/jeux/valorant.mjs';
import { ScoreInvalide, calculerScore, classementFinal, regleDuProfil, validerRounds } from '../noyau/competition/score.mjs';
import { bilan, seriesDe } from '../noyau/competition/bilans.mjs';
import { ordinal } from '../noyau/competition/resume.mjs';
import { distribuer } from '../noyau/evenements.mjs';
import { TABLES } from '../noyau/transfert.mjs';

const VALORANT = profilValorant();
const FINALS = {
  formats: [
    { nom: '3v3v3v3', equipes: 4, joueursParEquipe: 3, bo: [1] },
    { nom: '3v3', equipes: 2, joueursParEquipe: 3, bo: [1, 3] },
  ],
  score: { type: 'placement', bareme: [{ place: 1, points: 10 }, { place: 2, points: 6 }, { place: 3, points: 3 }, { place: 4, points: 1 }] },
  modes: [{ nom: 'Cashout', formats: ['3v3v3v3'] }],
  cartes: [{ nom: 'Monaco', modes: ['cashout'] }, { nom: 'Seoul', modes: ['cashout'] }, { nom: 'Skyway Stadium', modes: ['cashout'] }],
  classes: [{ nom: 'Light' }, { nom: 'Medium' }, { nom: 'Heavy' }],
  personnages: [{ nom: 'Light', classe: 'light' }, { nom: 'Medium', classe: 'medium' }, { nom: 'Heavy', classe: 'heavy' }],
  roster: { titulaires: 3, remplacants: 1 },
};
const raison = (f, r) => assert.throws(f, e => e instanceof ScoreInvalide && e.raison === r, r);

// ------------------------------------------------------------------ Score (pur)

test('score Valorant : 13 rounds, mi-temps de 12, prolongations à deux rounds d’écart', () => {
  const s = VALORANT.score;
  assert.equal(s.type, 'rounds');
  assert.deepEqual(validerRounds({ nous: 13, eux: 11 }, s).issue, 'victoire');
  assert.deepEqual(validerRounds({ nous: 5, eux: 13 }, s).issue, 'defaite');
  assert.equal(validerRounds({ nous: 14, eux: 12 }, s).detail.enProlongations, true);
  assert.equal(validerRounds({ nous: 13, eux: 15 }, s).issue, 'defaite');
  // Mi-temps détaillées, puis prolongations : 6-6, 6-6, puis 2-0 → 14-12.
  const ot = validerRounds({ miTemps: [[6, 6], [6, 6]], prolongations: [2, 0] }, s);
  assert.deepEqual([ot.nous, ot.eux, ot.issue], [14, 12, 'victoire']);
  assert.deepEqual(validerRounds({ miTemps: [[7, 5], [6, 4]] }, s).nous, 13);
  raison(() => validerRounds({ nous: 13, eux: 12 }, s), 'ecart-prolongations');
  raison(() => validerRounds({ nous: 16, eux: 12 }, s), 'ecart-prolongations');
  raison(() => validerRounds({ nous: 12, eux: 10 }, s), 'rounds-insuffisants');
  raison(() => validerRounds({ nous: 12, eux: 12 }, s), 'egalite');
  raison(() => validerRounds({ nous: 14, eux: 10 }, s), 'rounds-trop');
  raison(() => validerRounds({ miTemps: [[7, 6], [6, 0]] }, s), 'mi-temps-trop');
  raison(() => validerRounds({ miTemps: [[6, 5], [7, 0]] }, s), 'mi-temps-incomplete');
  raison(() => validerRounds({ miTemps: [[7, 5], [6, 4]], prolongations: [1, 0] }, s), 'prolongations-inutiles');
  raison(() => validerRounds({ miTemps: [[6, 6], [6, 5]], prolongations: [2, 1] }, s), 'prolongations-sans-egalite');
  raison(() => validerRounds({ miTemps: [[7, 5], [6, 4]], nous: 12, eux: 9 }, s), 'total-incoherent');
  // Sans prolongations (autre jeu en rounds) : 12-12 est un nul ; écart réglable par le profil.
  assert.equal(validerRounds({ nous: 12, eux: 12 }, { roundsGagnants: 13, roundsParMiTemps: 12 }).issue, 'nul');
  assert.equal(validerRounds({ nous: 16, eux: 15 }, { roundsGagnants: 13, roundsParMiTemps: 12, prolongations: { active: true, ecart: 1 } }).detail.enProlongations, true);
});

test('série Valorant BO3 : 2-1 avec une map en prolongations ; manche après la décision, série incomplète, BO non prévu', () => {
  const regle = regleDuProfil(VALORANT);
  assert.equal(regle.systeme, 'serie');
  assert.deepEqual(regle.boPermis, [1, 3, 5]);
  const r = calculerScore(regle, { bo: 3, manches: [{ nous: 13, eux: 9 }, { nous: 12, eux: 14 }, { miTemps: [[6, 6], [6, 6]], prolongations: [3, 1] }] });
  assert.deepEqual([r.issue, r.manchesNous, r.manchesEux, r.bo], ['victoire', 2, 1, 3]);
  assert.equal(r.manches[2].nous, 15);
  assert.equal(calculerScore(regle, { bo: 3, manches: [{ nous: 2, eux: 13 }, { nous: 7, eux: 13 }] }).issue, 'defaite');
  raison(() => calculerScore(regle, { bo: 3, manches: [{ nous: 13, eux: 2 }, { nous: 13, eux: 7 }, { nous: 13, eux: 1 }] }), 'manche-apres-decision');
  raison(() => calculerScore(regle, { bo: 3, manches: [{ nous: 13, eux: 2 }] }), 'serie-incomplete');
  raison(() => calculerScore(regle, { bo: 2, manches: [] }), 'bo');
  assert.equal(calculerScore(regle, { bo: 1, forfait: 'pour' }).issue, 'victoire');
  assert.equal(calculerScore(regle, { manches: [{ nous: 13, eux: 3 }] }).bo, 1, 'BO par défaut : le premier du format');
  raison(() => regleDuProfil(VALORANT, 'inconnu'), 'format');
});

test('classement multi-équipes (The Finals, 3v3v3v3) : place, points du barème, place finale calculée ou saisie', () => {
  const d = validerDonnees(FINALS).donnees;
  const regle = regleDuProfil(d, '3v3v3v3');
  assert.deepEqual([regle.systeme, regle.equipes], ['classement', 4]);
  const une = calculerScore(regle, { manches: [{ place: 2 }] });
  assert.deepEqual([une.place, une.points, une.issue], [2, 6, null]);
  raison(() => calculerScore(regle, { manches: [{ place: 5 }] }), 'nombre');
  raison(() => calculerScore(regle, { manches: [{ place: 1, classement: [{ nom: 'Nova', place: 1 }] }] }), 'place-en-double');
  // Deux manches, classement complet : rang au total des points (nous 10 + 3 = 13 ; Nova 6 + 10 = 16 ; …).
  const autres = p => [
    { nom: 'Nova', place: p[0] },
    { nom: 'Orion', place: p[1] },
    { nom: 'Vega', place: p[2] },
  ];
  const deux = calculerScore(regle, { manches: [{ place: 1, classement: autres([2, 3, 4]) }, { place: 3, classement: autres([1, 2, 4]) }] });
  assert.deepEqual([deux.place, deux.points, deux.participants], [2, 13, 4]);
  raison(() => calculerScore(regle, { manches: [{ place: 1 }, { place: 2 }] }), 'place-finale-requise');
  assert.equal(calculerScore(regle, { manches: [{ place: 1 }, { place: 2 }], placeFinale: 3, participants: 16 }).place, 3);
  assert.deepEqual(classementFinal([{ place: 4, points: 1, classement: [] }], regle, {}).place, 4);
});

test('bilans : taux de victoire, par map et par adversaire, séries en cours et records, classements', () => {
  const r = (id, date, issue, adv, cartes = []) => ({ id, date, systeme: 'serie', issue, adversaires: [{ id: adv, nom: adv }], manches: cartes.map(([c, i, n, e]) => ({ carte: { cle: c, nom: c }, issue: i, nous: n, eux: e })) });
  const b = bilan([
    r('1', '2026-10-01', 'victoire', 'nova', [['ascent', 'victoire', 13, 5]]),
    r('2', '2026-10-02', 'defaite', 'orion', [['bind', 'defaite', 8, 13]]),
    r('3', '2026-10-03', 'victoire', 'nova', [['ascent', 'victoire', 13, 11], ['bind', 'defaite', 10, 13], ['haven', 'victoire', 13, 7]]),
    r('4', '2026-10-04', 'victoire', 'orion', [['ascent', 'defaite', 11, 13], ['bind', 'victoire', 13, 4], ['lotus', 'victoire', 14, 12]]),
    { id: '5', date: '2026-10-05', systeme: 'classement', place: 1, adversaires: [], manches: [{ carte: { cle: 'monaco', nom: 'Monaco' }, place: 1 }] },
    { id: '6', date: '2026-10-06', systeme: 'classement', place: 4, adversaires: [], manches: [] },
  ]);
  assert.deepEqual(b.series, { joues: 4, victoires: 3, defaites: 1, nuls: 0, taux: 75 });
  assert.deepEqual(b.classements, { joues: 2, placeMoyenne: 2.5, top1: 1, top3: 1 });
  const ascent = b.parCarte.find(c => c.cle === 'ascent');
  assert.deepEqual([ascent.joues, ascent.victoires, ascent.taux], [3, 2, 67]);
  assert.equal(b.parCarte.find(c => c.cle === 'monaco').classements.placeMoyenne, 1);
  assert.deepEqual(b.parAdversaire.map(a => [a.nom, a.victoires, a.joues]), [['nova', 2, 2], ['orion', 1, 2]]);
  assert.deepEqual(b.forme, ['V', 'V', 'D', 'V']);
  assert.deepEqual(b.enCours, { issue: 'victoire', n: 2 });
  assert.deepEqual([b.recordVictoires, b.recordDefaites], [2, 1]);
  assert.deepEqual(b.rounds, { pour: 95, contre: 78 });
  assert.deepEqual(seriesDe([]), { enCours: null, recordVictoires: 0, recordDefaites: 0 });
  assert.deepEqual([ordinal(1, 'fr'), ordinal(1, 'fr', { feminin: true }), ordinal(3, 'fr'), ordinal(1, 'en'), ordinal(2, 'en'), ordinal(13, 'en'), ordinal(23, 'en')], ['1er', '1re', '3e', '1st', '2nd', '13th', '23rd']);
});

// ------------------------------------------------------------------ Catalogue et migration

test('catalogue : modules tournois et resultats (preset complet), permissions par défaut des rôles système', () => {
  assert.ok(modulesDuPreset('valorant_complet').includes('tournois') && modulesDuPreset('valorant_complet').includes('resultats'));
  assert.ok(!modulesDuPreset('minimal').includes('tournois'));
  const a = role => permissionsRoleSysteme(role).filter(p => p.startsWith('tournois.') || p.startsWith('resultats.')).sort();
  assert.deepEqual(a('manager'), ['resultats.saisir', 'resultats.voir', 'tournois.gerer', 'tournois.voir']);
  assert.deepEqual(a('coach'), ['resultats.saisir', 'resultats.voir', 'tournois.gerer', 'tournois.voir']);
  assert.deepEqual(a('analyste'), ['resultats.saisir', 'resultats.voir', 'tournois.voir']);
  assert.deepEqual(a('joueur'), ['resultats.voir', 'tournois.voir']);
  assert.deepEqual(a('remplacant'), ['resultats.voir', 'tournois.voir']);
  for (const t of ['tournois', 'tournoi_roster', 'tournoi_matchs', 'resultats', 'resultat_manches', 'resultat_joueurs']) assert.ok(TABLES.some(([n]) => n === t), `export de la base : ${t}`);
});

test('migration 0022 sur une base existante : rôles système complétés, données d’avant intactes, modules pas activés d’office', async () => {
  const base = await baseVierge();
  const migrations = lireMigrations();
  await appliquerMigrations(base, migrations.filter(m => m.nom < '0022'));
  const d = '2026-01-01T00:00:00.000Z';
  await base.executer("INSERT INTO teams (id, nom, slug, jeu, cree_par, cree_le, maj_le) VALUES ('t', 'T', 't', 'valorant', 'principal', ?, ?)", [d, d]);
  for (const cle of ['manager', 'coach', 'analyste', 'joueur', 'remplacant']) {
    await base.executer('INSERT INTO roles (id, team_id, cle_systeme, nom, couleur, systeme, position, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)', [cle, 't', cle, cle, '#000000', d, d]);
  }
  await base.executer("INSERT INTO roles (id, team_id, cle_systeme, nom, couleur, systeme, position, cree_le, maj_le) VALUES ('perso', 't', NULL, 'Perso', '#000000', 0, 9, ?, ?)", [d, d]);
  await base.executer("INSERT INTO team_modules (team_id, module, active, config, maj_le) VALUES ('t', 'planning', 1, '{}', ?)", [d]);
  await base.executer("INSERT INTO planning_evenements (id, team_id, type, titre, description, debut, fin, fuseau, lieu, concernes, cree_par, cree_le, maj_le) VALUES ('e', 't', 'tournament', 'Cup', '', ?, ?, 'Europe/Paris', '', '[]', 'principal', ?, ?)", [d, d, d, d]);
  assert.deepEqual(await appliquerMigrations(base, migrations), ['0022_tournois_resultats.sql']);
  const perms = async role => (await base.tous("SELECT permission FROM role_permissions WHERE role_id = ? AND (permission LIKE 'tournois.%' OR permission LIKE 'resultats.%') ORDER BY permission", [role])).map(l => l.permission);
  assert.deepEqual(await perms('manager'), ['resultats.saisir', 'resultats.voir', 'tournois.gerer', 'tournois.voir']);
  assert.deepEqual(await perms('analyste'), ['resultats.saisir', 'resultats.voir', 'tournois.voir']);
  assert.deepEqual(await perms('joueur'), ['resultats.voir', 'tournois.voir']);
  assert.deepEqual(await perms('perso'), [], 'les rôles personnalisés ne changent pas');
  assert.equal((await base.tous("SELECT module FROM team_modules WHERE team_id = 't' AND module IN ('tournois', 'resultats')", [])).length, 0);
  assert.equal((await base.premier("SELECT titre FROM planning_evenements WHERE id = 'e'", [])).titre, 'Cup');
  // Rejouée : rien ne bouge (suivi des migrations).
  assert.deepEqual(await appliquerMigrations(base, migrations), []);
});

// ------------------------------------------------------------------ API

const PARIS_20H = '2026-10-24T18:00:00.000Z';

async function preparer(options = {}) {
  const b = await banc(options);
  const A = await teamAvecMembres(b, {
    membres: {
      coach123: { pseudo: 'Zed', role: 'coach' },
      ana12345: { pseudo: 'Ana', role: 'analyste' },
      lea12345: { pseudo: 'Léa', role: 'joueur' },
      kai12345: { pseudo: 'Kai', role: 'joueur' },
      tom12345: { pseudo: 'Tom', role: 'joueur' },
      sam12345: { pseudo: 'Sam', role: 'joueur' },
      ivy12345: { pseudo: 'Ivy', role: 'joueur' },
      rem12345: { pseudo: 'Rem', role: 'remplacant' },
    },
  });
  const B = await teamAvecMembres(b, { nom: 'Team Bravo', membres: { nox12345: { pseudo: 'Nox', role: 'coach' } } });
  const s = { ...A.sessions, nox12345: B.sessions.nox12345 };
  const api = (chemin, jeton, o = {}) => b.appel(chemin, { jeton, methode: o.methode, corps: o.corps });
  const t = `/teams/${A.teamId}/tournois`;
  const r = `/teams/${A.teamId}/resultats`;
  const nova = (await api(`/teams/${A.teamId}/scouting/adversaires`, s.coach123, { methode: 'POST', corps: { nom: 'Nova' } })).corps.id;
  return { b, A, B, s, api, t, r, nova };
}

test('activation : modules désactivés → 404 ; permissions : joueur 403 en écriture, analyste saisit sans gérer les tournois ; autre team 404', async () => {
  const { A, B, s, api, t, r } = await preparer();
  assert.equal((await api(t, s.lea12345)).statut, 200);
  assert.equal((await api(t, s.lea12345, { methode: 'POST', corps: { nom: 'Coupe' } })).statut, 403);
  assert.equal((await api(t, s.ana12345, { methode: 'POST', corps: { nom: 'Coupe' } })).statut, 403);
  assert.equal((await api(`${r}/formulaire`, s.lea12345)).statut, 403);
  assert.equal((await api(`${r}/formulaire`, s.ana12345)).statut, 200);
  assert.equal((await api(t, s.nox12345)).statut, 404, 'team dont on n’est pas membre');
  const cree = await api(t, s.coach123, { methode: 'POST', corps: { nom: 'Coupe' } });
  assert.equal(cree.statut, 200);
  assert.equal((await api(`/teams/${B.teamId}/tournois/${cree.corps.tournoi.id}`, s.nox12345)).statut, 404, 'tournoi d’une autre team');
  await api(`/teams/${A.teamId}/modules`, s.fondateur, { methode: 'PUT', corps: { modules: { tournois: false, resultats: false } } });
  assert.equal((await api(t, s.coach123)).statut, 404);
  assert.equal((await api(r, s.coach123)).statut, 404);
  assert.equal((await api(`/teams/${A.teamId}/competition/accueil`, s.coach123)).statut, 404);
  const detail = (await api(`/teams/${A.teamId}`, s.coach123)).corps;
  assert.ok(!detail.moi.permissions.includes('tournois.voir'), 'module désactivé : permission inutilisable');
});

test('tournoi : fiche selon le profil (format, BO, phases), roster borné, inscription, check-in, statut', async () => {
  const { b, A, s, api, t } = await preparer();
  const formulaire = (await api(t, s.coach123)).corps.jeu;
  assert.deepEqual(formulaire.formats.map(f => [f.cle, f.libelle, f.bo]), [['5v5', '5v5', [1, 3, 5]]]);
  assert.deepEqual(formulaire.roster, { titulairesMin: 5, titulairesMax: 5, remplacantsMax: 2 });
  assert.equal((await api(t, s.coach123, { methode: 'POST', corps: { nom: 'Coupe', formatCle: '3v3' } })).corps.code, 'format');
  assert.equal((await api(t, s.coach123, { methode: 'POST', corps: { nom: 'Coupe', formatCle: '5v5', bo: 2 } })).corps.code, 'bo');
  assert.equal((await api(t, s.coach123, { methode: 'POST', corps: { nom: 'Coupe', lien: 'http://pas-https.exemple' } })).corps.code, 'lien');
  const c = await api(t, s.coach123, {
    methode: 'POST',
    corps: {
      nom: 'Coupe d’automne',
      organisateur: 'Ligue Exemple',
      lien: 'https://tournois-exemple.fr/coupe',
      formatCle: '5v5',
      bo: 3,
      debut: '2026-10-24',
      fin: '2026-10-25',
      enLigne: true,
      phases: [{ type: 'poules', nom: 'Poules' }, { type: 'simple', nom: 'Playoffs' }],
      frais: '25,50',
      cashprize: 1500,
      inscriptionLimite: '2026-10-22 23:59',
      checkinOuverture: '2026-10-24 18:00',
      checkinLimite: '2026-10-24 19:30',
    },
  });
  assert.equal(c.statut, 200, JSON.stringify(c.corps));
  const tournoi = c.corps.tournoi;
  assert.deepEqual([tournoi.statut, tournoi.format.libelle, tournoi.bo, tournoi.fraisCentimes, tournoi.cashprizeCentimes, tournoi.devise], ['a_venir', '5v5', 3, 2550, 150000, 'EUR']);
  assert.deepEqual(tournoi.phases.map(p => [p.cle, p.type]), [['p1', 'poules'], ['p2', 'simple']]);
  assert.equal(tournoi.inscription.limite, '2026-10-22T21:59:00.000Z', 'heure murale de Paris convertie en UTC');
  const u = `${t}/${tournoi.id}`;
  // Roster : 5 titulaires et 2 remplaçants au plus (profil Valorant), membres de la team seulement.
  const six = ['lea12345', 'kai12345', 'tom12345', 'sam12345', 'ivy12345', 'coach123'];
  assert.equal((await api(`${u}/roster`, s.coach123, { methode: 'PUT', corps: { titulaires: six } })).corps.code, 'roster-titulaires');
  assert.equal((await api(`${u}/roster`, s.coach123, { methode: 'PUT', corps: { titulaires: ['nox12345'] } })).corps.code, 'roster-membre');
  // Inscription : il faut 5 titulaires.
  await api(`${u}/roster`, s.coach123, { methode: 'PUT', corps: { titulaires: six.slice(0, 4), remplacants: ['rem12345'] } });
  const incomplet = await api(`${u}/inscription`, s.coach123, { methode: 'POST', corps: {} });
  assert.deepEqual([incomplet.statut, incomplet.corps.code, incomplet.corps.details], [409, 'roster-incomplet', { titulaires: 4, minimum: 5 }]);
  await api(`${u}/roster`, s.coach123, { methode: 'PUT', corps: { titulaires: six.slice(0, 5), remplacants: ['rem12345'] } });
  assert.equal((await api(`${u}/checkin`, s.coach123, { methode: 'POST', corps: {} })).corps.code, 'non-inscrit');
  const inscrit = (await api(`${u}/inscription`, s.coach123, { methode: 'POST', corps: {} })).corps.tournoi;
  assert.equal(inscrit.statut, 'inscrit');
  assert.equal(inscrit.roster.length, 6);
  // Check-in : pas avant l'ouverture, pas après la limite.
  assert.equal((await api(`${u}/checkin`, s.coach123, { methode: 'POST', corps: {} })).corps.code, 'checkin-pas-ouvert');
  b.horloge.t = Date.parse('2026-10-24T17:00:00.000Z');
  s.coach123 = await b.session('coach123');
  const ck = await api(`${u}/checkin`, s.coach123, { methode: 'POST', corps: {} });
  assert.ok(ck.corps.tournoi?.checkin.faitLe, JSON.stringify(ck.corps));
  b.horloge.t = Date.parse('2026-10-26T10:00:00.000Z');
  s.coach123 = await b.session('coach123');
  s.fondateur = await b.session('principal');
  assert.equal((await api(`${u}/inscription`, s.coach123, { methode: 'POST', corps: { annuler: true } })).corps.tournoi.statut, 'a_venir');
  assert.equal((await api(`${u}/inscription`, s.coach123, { methode: 'POST', corps: {} })).corps.code, 'inscription-close');
  // Classement final : pas plus loin que le nombre de participants.
  assert.equal((await api(u, s.coach123, { methode: 'PATCH', corps: { participants: 16, classementFinal: 17 } })).corps.code, 'classement');
  const fini = (await api(u, s.coach123, { methode: 'PATCH', corps: { statut: 'termine', participants: 16, classementFinal: 3, gains: 150 } })).corps.tournoi;
  assert.deepEqual([fini.statut, fini.classementFinal, fini.gainsCentimes], ['termine', 3, 15000]);
  const journal = (await api(`/teams/${A.teamId}/journal?module=tournois`, s.fondateur)).corps.entrees.map(e => e.action);
  for (const a of ['tournoi.cree', 'tournoi.roster_change', 'tournoi.inscrit', 'tournoi.checkin', 'tournoi.termine']) assert.ok(journal.includes(a), a);
});

test('matchs du tournoi ↔ planning : événement « Tournoi » convoquant le roster, mis à jour, retiré ; sans module Planning : raison', async () => {
  const { A, s, api, t, nova } = await preparer();
  const tournoi = (await api(t, s.coach123, { methode: 'POST', corps: { nom: 'Coupe', formatCle: '5v5', bo: 3, phases: [{ type: 'double', nom: 'Bracket' }] } })).corps.tournoi;
  const u = `${t}/${tournoi.id}`;
  await api(`${u}/roster`, s.coach123, { methode: 'PUT', corps: { titulaires: ['lea12345', 'kai12345', 'tom12345', 'sam12345', 'ivy12345'], remplacants: ['rem12345'] } });
  const ajout = await api(`${u}/matchs`, s.coach123, { methode: 'POST', corps: { phase: 'p1', tour: 'Quart de finale', date: '2026-10-24', heure: '20:00', dureeMin: 120, adversaires: [{ id: nova }] } });
  assert.equal(ajout.statut, 200, JSON.stringify(ajout.corps));
  const evId = ajout.corps.planning.evenementId;
  assert.ok(evId, 'événement créé au planning');
  const ev = (await api(`/teams/${A.teamId}/planning/${evId}`, s.coach123)).corps;
  assert.deepEqual([ev.type, ev.titre, ev.debut, ev.fin, ev.adversaireId], ['tournament', 'Coupe · Quart de finale vs Nova', PARIS_20H, '2026-10-24T20:00:00.000Z', nova]);
  assert.deepEqual([...ev.concernes].sort(), ['ivy12345', 'kai12345', 'lea12345', 'rem12345', 'sam12345', 'tom12345'], 'convocation = roster');
  // Un joueur convoqué répond comme d'habitude (RSVP du planning).
  const occ = encodeURIComponent(PARIS_20H);
  assert.equal((await api(`/teams/${A.teamId}/planning/${evId}/occurrences/${occ}/rsvp`, s.lea12345, { methode: 'PUT', corps: { rsvp: 'oui' } })).statut, 200);
  // Le roster change : la convocation suit.
  await api(`${u}/roster`, s.coach123, { methode: 'PUT', corps: { titulaires: ['lea12345', 'kai12345', 'tom12345', 'sam12345', 'coach123'] } });
  assert.deepEqual([...(await api(`/teams/${A.teamId}/planning/${evId}`, s.coach123)).corps.concernes].sort(), ['coach123', 'kai12345', 'lea12345', 'sam12345', 'tom12345']);
  // L'horaire change : l'événement suit.
  const matchId = ajout.corps.match;
  await api(`${u}/matchs/${matchId}`, s.coach123, { methode: 'PATCH', corps: { date: '2026-10-25', heure: '18:30' } });
  assert.equal((await api(`/teams/${A.teamId}/planning/${evId}`, s.coach123)).corps.debut, '2026-10-25T17:30:00.000Z', 'heure d’hiver à Paris le 25/10');
  // Résultat rapide (sans le module Résultats) dans le parcours.
  const rapide = (await api(`${u}/matchs/${matchId}`, s.coach123, { methode: 'PATCH', corps: { issue: 'victoire', scoreTexte: '2-1' } })).corps;
  assert.deepEqual([rapide.matchs[0].statut, rapide.matchs[0].issue, rapide.matchs[0].scoreTexte, rapide.bilan.victoires], ['joue', 'victoire', '2-1', 1]);
  // Un match annulé quitte le planning.
  const second = (await api(`${u}/matchs`, s.coach123, { methode: 'POST', corps: { tour: 'Demi-finale', date: '2026-10-26', heure: '20:00', adversaires: [{ nom: 'Équipe sans fiche' }] } })).corps;
  assert.ok(second.planning.evenementId);
  await api(`${u}/matchs/${second.match}`, s.coach123, { methode: 'PATCH', corps: { statut: 'annule' } });
  assert.equal((await api(`/teams/${A.teamId}/planning/${second.planning.evenementId}`, s.coach123)).statut, 404);
  // Supprimer un match à venir le retire aussi du planning.
  const troisieme = (await api(`${u}/matchs`, s.coach123, { methode: 'POST', corps: { tour: 'Finale', debut: '2026-10-27T18:00:00.000Z' } })).corps;
  await api(`${u}/matchs/${troisieme.match}`, s.coach123, { methode: 'DELETE' });
  assert.equal((await api(`/teams/${A.teamId}/planning/${troisieme.planning.evenementId}`, s.coach123)).statut, 404);
  // Sans le module Planning : le match est gardé, sans événement, avec la raison.
  await api(`/teams/${A.teamId}/modules`, s.fondateur, { methode: 'PUT', corps: { modules: { planning: false } } });
  const sans = (await api(`${u}/matchs`, s.coach123, { methode: 'POST', corps: { tour: 'Bonus', date: '2026-10-28', heure: '20:00' } })).corps;
  assert.deepEqual(sans.planning, { evenementId: null, raison: 'module' });
  // Joueur : lecture seule ; l'adversaire (fiche du scouting) est nommé sans exiger scouting.view.
  const vu = (await api(u, s.lea12345)).corps;
  assert.equal(vu.matchs.find(m => m.tour === 'Quart de finale').adversaires[0].nom, 'Nova');
  assert.equal(vu.droits.gerer, false);
  assert.equal((await api(`${u}/matchs/${matchId}`, s.lea12345, { methode: 'PATCH', corps: { tour: 'x' } })).statut, 403);
});

test('résultats Valorant : BO3 avec prolongations validé par le profil, victoire calculée, lien au match du tournoi, refus clairs', async () => {
  const { A, s, api, t, r, nova } = await preparer();
  const tournoi = (await api(t, s.coach123, { methode: 'POST', corps: { nom: 'Coupe', formatCle: '5v5', bo: 3 } })).corps.tournoi;
  const m = (await api(`${t}/${tournoi.id}/matchs`, s.coach123, { methode: 'POST', corps: { tour: 'Finale', date: '2026-10-19', heure: '20:00', adversaires: [{ id: nova }] } })).corps.match;
  const form = (await api(`${r}/formulaire`, s.coach123)).corps;
  assert.equal(form.jeu.systeme, 'serie');
  assert.equal(form.jeu.score.roundsGagnants, 13);
  assert.ok(form.matchsTournoi.some(x => x.id === m));
  const joueurs = [
    { compte: 'lea12345', personnages: ['jett'], stats: { kills: 24, deaths: 15, acs: '268' } },
    { compte: 'kai12345', personnages: ['omen'] },
    { compte: 'tom12345', personnages: ['sova'] },
    { compte: 'sam12345', personnages: ['killjoy'] },
    { compte: 'ivy12345', personnages: ['kay-o'] },
  ];
  const saisie = {
    tournoiMatchId: m,
    manches: [
      { carteCle: 'ascent', modeCle: 'competition', nous: 13, eux: 9 },
      { carteCle: 'bind', miTemps: [[5, 7], [6, 6]], nous: 11, eux: 13 },
      { carteCle: 'haven', miTemps: [[6, 6], [6, 6]], prolongations: [2, 0] },
    ],
    joueurs,
    mvp: 'lea12345',
  };
  // Refus explicites.
  const mauvais = await api(r, s.coach123, { methode: 'POST', corps: { ...saisie, manches: [{ carteCle: 'ascent', nous: 13, eux: 12 }, saisie.manches[1], saisie.manches[2]] } });
  assert.deepEqual([mauvais.statut, mauvais.corps.code, mauvais.corps.details], [400, 'score-invalide', { chemin: 'manches.0', raison: 'ecart-prolongations' }]);
  assert.equal((await api(r, s.coach123, { methode: 'POST', corps: { ...saisie, manches: [{ carteCle: 'monaco', nous: 13, eux: 2 }, saisie.manches[1], saisie.manches[2]] } })).corps.details.raison, 'carte');
  assert.equal((await api(r, s.coach123, { methode: 'POST', corps: { ...saisie, joueurs: [{ compte: 'lea12345', personnages: ['light'] }] } })).corps.code, 'personnages');
  assert.equal((await api(r, s.coach123, { methode: 'POST', corps: { ...saisie, mvp: 'coach123' } })).corps.code, 'mvp');
  assert.equal((await api(r, s.coach123, { methode: 'POST', corps: { ...saisie, joueurs: [...joueurs, { compte: 'rem12345' }, { compte: 'coach123' }, { compte: 'ana12345' }] } })).corps.code, 'joueurs');
  // Saisie valide : 2-1, victoire, maps du profil, prolongations notées.
  const ok = await api(r, s.coach123, { methode: 'POST', corps: saisie });
  assert.equal(ok.statut, 200, JSON.stringify(ok.corps));
  const res = ok.corps.resultat;
  assert.deepEqual([res.genre, res.systeme, res.bo, res.issue, res.score, res.date], ['tournoi', 'serie', 3, 'victoire', '2-1', '2026-10-19T18:00:00.000Z']);
  assert.deepEqual(res.manches.map(x => [x.carte.nom, x.nous, x.eux, x.issue, x.enProlongations]), [['Ascent', 13, 9, 'victoire', false], ['Bind', 11, 13, 'defaite', false], ['Haven', 14, 12, 'victoire', true]]);
  assert.deepEqual(res.joueurs[0].personnages, [{ cle: 'jett', nom: 'Jett' }]);
  assert.deepEqual(res.joueurs[0].stats, { kills: 24, deaths: 15, acs: 268 });
  assert.deepEqual([res.mvp.pseudo, res.tournoi.nom, res.tour, res.adversaires[0].nom], ['Léa', 'Coupe', 'Finale', 'Nova']);
  // Le parcours du tournoi montre le résultat détaillé ; un second résultat pour ce match est refusé.
  const parcours = (await api(`${t}/${tournoi.id}`, s.lea12345)).corps.matchs[0];
  assert.deepEqual([parcours.statut, parcours.issue, parcours.scoreTexte], ['joue', 'victoire', '2-1']);
  assert.equal((await api(r, s.coach123, { methode: 'POST', corps: saisie })).corps.code, 'match-deja-saisi');
  // Modification d'un champ : le score est revalidé à partir de la saisie gardée.
  const modif = (await api(`${r}/${res.id}`, s.ana12345, { methode: 'PATCH', corps: { notes: 'Belle remontée' } })).corps.resultat;
  assert.deepEqual([modif.issue, modif.score, modif.notes, modif.manches[2].nous], ['victoire', '2-1', 'Belle remontée', 14]);
  // Module Tournois coupé depuis : le lien existant reste valable, la modification passe.
  await api(`/teams/${A.teamId}/modules`, s.fondateur, { methode: 'PUT', corps: { modules: { tournois: false } } });
  const sansModule = await api(`${r}/${res.id}`, s.coach123, { methode: 'PATCH', corps: { notes: 'Toujours là' } });
  assert.equal(sansModule.statut, 200, JSON.stringify(sansModule.corps));
  assert.equal(sansModule.corps.resultat.tournoi, null, 'le nom du tournoi n’est montré qu’avec le module');
  await api(`/teams/${A.teamId}/modules`, s.fondateur, { methode: 'PUT', corps: { modules: { tournois: true } } });
  // Résumé publiable (EN pour la future section CM).
  const resume = (await api(`${r}/${res.id}/resume?langue=en`, s.lea12345)).corps;
  assert.equal(resume.phrase, 'Victory 2-1 vs Nova');
  assert.equal(resume.publiable, true);
  assert.deepEqual(resume.manches.map(x => x.score), ['13-9', '11-13', '14-12']);
  // Suppression : le match redevient sans résultat détaillé.
  await api(`${r}/${res.id}`, s.coach123, { methode: 'DELETE' });
  assert.equal((await api(`${t}/${tournoi.id}`, s.coach123)).corps.matchs[0].aResultat, false);
  assert.equal((await api(`${r}/${res.id}`, s.coach123)).statut, 404);
  assert.equal((await api(`/teams/${A.teamId}/journal?module=resultats`, s.fondateur)).corps.entrees.filter(e => e.action.startsWith('match.')).length, 4);
});

test('résultat multi-équipes (The Finals, 3v3v3v3) : place et points du barème, personnages du profil, classement des autres équipes', async () => {
  const b = await banc();
  const f = await b.session('principal', 'Fondateur');
  assert.equal((await b.appel('/jeux', { methode: 'POST', jeton: f, corps: { nom: 'The Finals', couleur: '#d31f3c', donnees: FINALS } })).statut, 200);
  const F = await teamAvecMembres(b, { nom: 'Finals Squad', jeu: 'the-finals', membres: { lea12345: { pseudo: 'Léa', role: 'joueur' }, kai12345: { pseudo: 'Kai', role: 'joueur' }, tom12345: { pseudo: 'Tom', role: 'joueur' }, coach123: { pseudo: 'Zed', role: 'coach' } } });
  const api = (chemin, jeton, o = {}) => b.appel(chemin, { jeton, methode: o.methode, corps: o.corps });
  const r = `/teams/${F.teamId}/resultats`;
  const form = (await api(`${r}/formulaire`, F.sessions.coach123)).corps;
  assert.deepEqual([form.jeu.systeme, form.jeu.formats[0].libelle], ['classement', '3v3v3v3']);
  // Roster du tournoi : 3 titulaires et 1 remplaçant au plus.
  const t = `/teams/${F.teamId}/tournois`;
  const tournoi = (await api(t, F.sessions.coach123, { methode: 'POST', corps: { nom: 'Cashout Cup', formatCle: '3v3v3v3' } })).corps.tournoi;
  assert.equal((await api(`${t}/${tournoi.id}/roster`, F.sessions.coach123, { methode: 'PUT', corps: { titulaires: ['lea12345', 'kai12345', 'tom12345', 'coach123'] } })).corps.code, 'roster-titulaires');
  const orion = (await api(`/teams/${F.teamId}/competition/adversaires`, F.sessions.coach123, { methode: 'POST', corps: { nom: 'Orion' } })).corps.adversaire;
  assert.equal((await api(`/teams/${F.teamId}/competition/adversaires`, F.sessions.coach123, { methode: 'POST', corps: { nom: 'orion' } })).corps.existait, true, 'pas de doublon');
  const saisie = {
    formatCle: '3v3v3v3',
    date: '2026-10-19 21:00',
    adversaires: [{ id: orion.id }, { nom: 'Vega' }, { nom: 'Lynx' }],
    manches: [
      { carteCle: 'monaco', modeCle: 'cashout', place: 2, classement: [{ id: orion.id, nom: 'Orion', place: 1 }, { nom: 'Vega', place: 3 }, { nom: 'Lynx', place: 4 }] },
      { carteCle: 'seoul', modeCle: 'cashout', place: 1, classement: [{ id: orion.id, nom: 'Orion', place: 4 }, { nom: 'Vega', place: 2 }, { nom: 'Lynx', place: 3 }] },
    ],
    joueurs: [{ compte: 'lea12345', personnages: ['light'] }, { compte: 'kai12345', personnages: ['medium'] }, { compte: 'tom12345', personnages: ['heavy'] }],
  };
  assert.equal((await api(r, F.sessions.coach123, { methode: 'POST', corps: { ...saisie, joueurs: [{ compte: 'lea12345', personnages: ['jett'] }] } })).corps.code, 'personnages');
  const cree = await api(r, F.sessions.coach123, { methode: 'POST', corps: saisie });
  assert.equal(cree.statut, 200, JSON.stringify(cree.corps));
  const res = cree.corps.resultat;
  // Points : 6 + 10 = 16 ; Orion 10 + 1 = 11 ; Vega 3 + 6 = 9 ; Lynx 1 + 3 = 4 → 1re place.
  assert.deepEqual([res.systeme, res.issue, res.place, res.points, res.participants, res.score], ['classement', null, 1, 16, 4, '#1']);
  assert.deepEqual(res.manches.map(m => [m.carte.nom, m.mode.nom, m.place, m.points]), [['Monaco', 'Cashout', 2, 6], ['Seoul', 'Cashout', 1, 10]]);
  assert.deepEqual(res.adversaires.map(a => a.nom), ['Orion', 'Vega', 'Lynx']);
  const liste = (await api(r, F.sessions.lea12345)).corps;
  assert.deepEqual(liste.bilan.classements, { joues: 1, placeMoyenne: 1, top1: 1, top3: 1 });
  assert.equal(liste.bilan.series.joues, 0);
  assert.equal((await api(`${r}/${res.id}/resume`, F.sessions.lea12345)).corps.phrase, '1re place (1er sur 4)');
});

test('historique : visibilité staff, filtres (adversaire, map, période, genre), bilans ; vue par adversaire reliée au scouting', async () => {
  const { A, s, api, r, nova } = await preparer();
  const orion = (await api(`/teams/${A.teamId}/competition/adversaires`, s.ana12345, { methode: 'POST', corps: { nom: 'Orion' } })).corps.adversaire.id;
  const ajouter = async corps => {
    const x = await api(r, s.ana12345, { methode: 'POST', corps });
    assert.equal(x.statut, 200, JSON.stringify(x.corps));
    return x.corps.resultat;
  };
  await ajouter({ genre: 'officiel', date: '2026-10-01 20:00', bo: 1, adversaires: [{ id: nova }], manches: [{ carteCle: 'ascent', nous: 13, eux: 5 }] });
  await ajouter({ genre: 'officiel', date: '2026-10-05 20:00', bo: 1, adversaires: [{ id: orion }], manches: [{ carteCle: 'bind', nous: 8, eux: 13 }] });
  await ajouter({ genre: 'officiel', date: '2026-10-10 20:00', bo: 3, adversaires: [{ id: nova }], manches: [{ carteCle: 'ascent', nous: 13, eux: 11 }, { carteCle: 'bind', nous: 13, eux: 10 }] });
  const scrim = await ajouter({ genre: 'scrim', date: '2026-10-12 20:00', bo: 1, adversaires: [{ id: orion }], manches: [{ carteCle: 'lotus', nous: 3, eux: 13 }], visibilite: 'staff' });
  assert.equal(scrim.publiable, false, 'un scrim (ou un résultat staff) n’est pas publiable');
  // Joueur : ne voit pas le scrim réservé au staff (404 en appel direct).
  const joueur = (await api(r, s.lea12345)).corps;
  assert.equal(joueur.total, 3);
  assert.equal((await api(`${r}/${scrim.id}`, s.lea12345)).statut, 404);
  assert.deepEqual(joueur.bilan.series, { joues: 3, victoires: 2, defaites: 1, nuls: 0, taux: 67 });
  const staff = (await api(r, s.ana12345)).corps;
  assert.equal(staff.total, 4);
  assert.deepEqual(staff.bilan.forme, ['D', 'V', 'D', 'V']);
  assert.deepEqual(staff.bilan.enCours, { issue: 'defaite', n: 1 });
  // Filtres.
  assert.equal((await api(`${r}?adversaire=${nova}`, s.ana12345)).corps.total, 2);
  const ascent = (await api(`${r}?carte=ascent`, s.ana12345)).corps;
  assert.equal(ascent.total, 2);
  assert.deepEqual(ascent.bilan.parCarte.find(c => c.cle === 'ascent'), { cle: 'ascent', nom: 'Ascent', joues: 2, victoires: 2, defaites: 0, nuls: 0, taux: 100, classements: { joues: 0, placeMoyenne: null } });
  assert.equal((await api(`${r}?du=2026-10-05&au=2026-10-10`, s.ana12345)).corps.total, 2);
  assert.equal((await api(`${r}?genre=scrim`, s.ana12345)).corps.total, 1);
  assert.equal((await api(`${r}?du=2026-13-01`, s.ana12345)).statut, 400);
  assert.deepEqual(staff.filtres.cartes.map(c => c.cle), ['ascent', 'bind', 'lotus']);
  // Vue par adversaire : bilan face à lui ; fiche de scouting seulement pour qui la voit.
  const vueStaff = (await api(`${r}/adversaires/${nova}`, s.ana12345)).corps;
  assert.deepEqual([vueStaff.bilan.series.victoires, vueStaff.bilan.series.joues, vueStaff.scouting], [2, 2, { id: nova }]);
  const vueJoueur = (await api(`${r}/adversaires/${nova}`, s.lea12345)).corps;
  assert.equal(vueJoueur.scouting, null, 'le joueur n’a pas scouting.view');
  assert.equal((await api(`${r}/adversaires/${nova}`, s.nox12345)).statut, 404);
});

test('bus : notifications (inscription au roster, résultat aux alignés), accueil de la team et Dashboard', async () => {
  const { b, A, s, api, t, r, nova } = await preparer();
  const tournoi = (await api(t, s.coach123, { methode: 'POST', corps: { nom: 'Coupe', formatCle: '5v5', debut: '2026-10-24' } })).corps.tournoi;
  const u = `${t}/${tournoi.id}`;
  await api(`${u}/roster`, s.coach123, { methode: 'PUT', corps: { titulaires: ['lea12345', 'kai12345', 'tom12345', 'sam12345', 'ivy12345'] } });
  await api(`${u}/inscription`, s.coach123, { methode: 'POST', corps: {} });
  const notifs = async c => (await api('/notifications', s[c])).corps.liste.map(n => n.type);
  assert.ok((await notifs('lea12345')).includes('tournoi-inscrit'));
  assert.ok(!(await notifs('rem12345')).includes('tournoi-inscrit'), 'hors roster : rien');
  await api(`${u}/matchs`, s.coach123, { methode: 'POST', corps: { tour: 'Poules', date: '2026-10-24', heure: '20:00', adversaires: [{ id: nova }] } });
  assert.ok((await notifs('lea12345')).includes('evenement-nouveau'), 'le planning prévient les convoqués');
  await api(r, s.coach123, { methode: 'POST', corps: { genre: 'officiel', date: '2026-10-19 20:00', bo: 1, adversaires: [{ id: nova }], manches: [{ carteCle: 'ascent', nous: 13, eux: 7 }], joueurs: [{ compte: 'kai12345' }] } });
  assert.ok((await notifs('kai12345')).includes('resultat-saisi'));
  assert.ok(!(await notifs('tom12345')).includes('resultat-saisi'), 'pas aligné : rien');
  const accueil = (await api(`/teams/${A.teamId}/competition/accueil`, s.lea12345)).corps;
  assert.equal(accueil.prochains[0].adversaires[0].nom, 'Nova');
  assert.equal(accueil.tournois[0].nom, 'Coupe');
  assert.deepEqual([accueil.derniers[0].issue, accueil.derniers[0].score, accueil.forme], ['victoire', '13-7', ['V']]);
  const dash = (await api('/dashboard', s.lea12345)).corps.teams.find(x => x.team.id === A.teamId);
  assert.equal(dash.competition.prochains[0].tournoi.nom, 'Coupe');
  assert.equal(dash.competition.derniers[0].issue, 'victoire');
  await api(`/teams/${A.teamId}/modules`, s.fondateur, { methode: 'PUT', corps: { modules: { tournois: false, resultats: false } } });
  assert.equal((await api('/dashboard', s.lea12345)).corps.teams.find(x => x.team.id === A.teamId).competition, null);
  await distribuer(b.base, { maintenant: b.horloge.t });
});

test('Discord : inscription, annonce de match (remplace « Nouvel événement »), résultat, classement final ; jamais un résultat staff ni un scrim non publiable', async () => {
  const envois = [];
  const fetchDiscord = async (url, init) => {
    envois.push({ url, corps: JSON.parse(init.body) });
    return new Response(JSON.stringify({ id: '99999999999' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const { A, s, api, t, r, nova } = await preparer({ fetchDiscord, lienApp: 'https://app.exemple', cleDiscord: 'cle-discord-de-test-0123456789abcdef0123' });
  assert.equal((await api(`/teams/${A.teamId}/discord/webhook`, s.fondateur, { methode: 'PUT', corps: { url: URL_TEST } })).statut, 200);
  const params = (await api(`/teams/${A.teamId}/discord`, s.fondateur)).corps.parametres;
  for (const cle of ['tournament_registered', 'match_announced', 'match_result', 'tournament_final']) {
    const p = params.find(x => x.cle === cle);
    assert.deepEqual([p.actif, p.disponible], [true, true], cle);
  }
  const tournoi = (await api(t, s.coach123, { methode: 'POST', corps: { nom: 'Coupe d’automne', formatCle: '5v5', bo: 3, debut: '2026-10-24', lien: 'https://tournois-exemple.fr/coupe' } })).corps.tournoi;
  const u = `${t}/${tournoi.id}`;
  await api(`${u}/roster`, s.coach123, { methode: 'PUT', corps: { titulaires: ['lea12345', 'kai12345', 'tom12345', 'sam12345', 'ivy12345'] } });
  envois.length = 0;
  await api(`${u}/inscription`, s.coach123, { methode: 'POST', corps: {} });
  assert.equal(envois.length, 1);
  assert.match(envois[0].corps.embeds[0].author.name, /Inscription au tournoi/);
  assert.deepEqual(envois[0].corps.components[0].components.map(c => c.url), ['https://tournois-exemple.fr/coupe', 'https://app.exemple']);
  // Match daté : une seule annonce, celle du tournoi (pas de « Nouvel événement » pour son événement du planning).
  envois.length = 0;
  await api(`${u}/matchs`, s.coach123, { methode: 'POST', corps: { tour: 'Quart de finale', date: '2026-10-24', heure: '20:00', adversaires: [{ id: nova }] } });
  assert.equal(envois.length, 1, JSON.stringify(envois.map(e => e.corps.embeds[0].author?.name)));
  const annonce = envois[0].corps.embeds[0];
  assert.match(annonce.author.name, /Match à venir/);
  assert.match(annonce.title, /Coupe d’automne · Quart de finale/);
  assert.ok(annonce.fields.some(f => f.value.includes('Nova')));
  assert.ok(annonce.fields.some(f => f.value.includes('Léa')), 'roster');
  // Résultat publiable : embed vert, maps et score.
  envois.length = 0;
  await api(r, s.coach123, { methode: 'POST', corps: { tournoiMatchId: (await api(u, s.coach123)).corps.matchs[0].id, manches: [{ carteCle: 'ascent', nous: 13, eux: 9 }, { carteCle: 'bind', nous: 14, eux: 12 }], joueurs: [{ compte: 'lea12345', personnages: ['jett'] }], mvp: 'lea12345' } });
  assert.equal(envois.length, 1);
  const resultat = envois[0].corps.embeds[0];
  assert.match(resultat.title, /Victoire 2-0 contre Nova/);
  assert.equal(resultat.color, 0x16a34a);
  assert.ok(resultat.fields.some(f => /Ascent — \*\*13-9\*\*/.test(f.value) && /Bind — \*\*14-12\*\* \(prol\.\)/.test(f.value)));
  assert.ok(resultat.fields.some(f => f.name.includes('MVP') && f.value === 'Léa'));
  assert.deepEqual(envois[0].corps.allowed_mentions, { parse: [] });
  // Scrim (non publiable par défaut) et résultat staff : rien ne part.
  envois.length = 0;
  await api(r, s.coach123, { methode: 'POST', corps: { genre: 'scrim', date: '2026-10-19 20:00', bo: 1, adversaires: [{ id: nova }], manches: [{ carteCle: 'ascent', nous: 13, eux: 2 }] } });
  await api(r, s.coach123, { methode: 'POST', corps: { genre: 'officiel', date: '2026-10-19 20:00', bo: 1, adversaires: [{ id: nova }], manches: [{ carteCle: 'ascent', nous: 13, eux: 2 }], visibilite: 'staff', publiable: true } });
  assert.equal(envois.length, 0);
  // Option de la team : couper les résultats.
  await api(`/teams/${A.teamId}/discord/parametres/match_result`, s.fondateur, { methode: 'PUT', corps: { actif: false } });
  await api(r, s.coach123, { methode: 'POST', corps: { genre: 'officiel', date: '2026-10-19 20:00', bo: 1, adversaires: [{ id: nova }], manches: [{ carteCle: 'ascent', nous: 13, eux: 2 }] } });
  assert.equal(envois.length, 0);
  // Classement final.
  await api(u, s.coach123, { methode: 'PATCH', corps: { statut: 'termine', classementFinal: 1, participants: 16, gains: 1500 } });
  assert.equal(envois.length, 1);
  const final = envois[0].corps.embeds[0];
  assert.match(final.title, /🥇 Coupe d’automne : 1er sur 16/);
  assert.ok(final.fields.some(f => /1\s500,00/u.test(f.value)), JSON.stringify(final.fields));
  assert.ok(final.fields.some(f => f.name.includes('Parcours') && f.value.includes('Nova')));
});

test('Discord bilingue : message anglais (Result / Victory) puis fil français', async () => {
  const envois = [];
  const fetchDiscord = async (url, init) => {
    envois.push({ url, corps: JSON.parse(init.body) });
    return new Response(JSON.stringify({ id: `9999999999${envois.length}`, channel_id: '55555555555' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const b = await banc({ fetchDiscord, lienApp: 'https://app.exemple', cleDiscord: 'cle-discord-de-test-0123456789abcdef0123', discordBot: { jetonBot: 'jeton-bot-de-test' } });
  const A = await teamAvecMembres(b, { filFr: true, membres: { coach123: { pseudo: 'Zed', role: 'coach' } } });
  const api = (chemin, jeton, o = {}) => b.appel(chemin, { jeton, methode: o.methode, corps: o.corps });
  await api(`/teams/${A.teamId}/discord/webhook`, A.sessions.fondateur, { methode: 'PUT', corps: { url: URL_TEST } });
  const nova = (await api(`/teams/${A.teamId}/scouting/adversaires`, A.sessions.coach123, { methode: 'POST', corps: { nom: 'Nova' } })).corps.id;
  envois.length = 0;
  await api(`/teams/${A.teamId}/resultats`, A.sessions.coach123, { methode: 'POST', corps: { genre: 'officiel', date: '2026-10-19 20:00', bo: 1, adversaires: [{ id: nova }], manches: [{ carteCle: 'ascent', nous: 13, eux: 2 }] } });
  const textes = envois.map(e => e.corps.embeds?.[0]?.title ?? e.corps.name ?? '');
  assert.ok(textes.some(x => /Victory 13-2 vs Nova/.test(x)), JSON.stringify(textes));
  assert.ok(textes.some(x => /Victoire 13-2 contre Nova/.test(x)), JSON.stringify(textes));
});

test('RGPD : export (rosters, résultats joués, statistiques) ; suppression : roster retiré, lignes de résultat anonymes ; export / import de la base', async () => {
  const { b, A, s, api, t, r, nova } = await preparer();
  const tournoi = (await api(t, s.coach123, { methode: 'POST', corps: { nom: 'Coupe', formatCle: '5v5' } })).corps.tournoi;
  await api(`${t}/${tournoi.id}/roster`, s.coach123, { methode: 'PUT', corps: { titulaires: ['lea12345', 'kai12345'] } });
  const res = (await api(r, s.coach123, { methode: 'POST', corps: { genre: 'officiel', date: '2026-10-19 20:00', bo: 1, adversaires: [{ id: nova }], manches: [{ carteCle: 'ascent', nous: 13, eux: 2 }], joueurs: [{ compte: 'lea12345', personnages: ['jett'], stats: { kills: 20 } }, { compte: 'kai12345' }], mvp: 'lea12345' } })).corps.resultat;
  const exp = (await api('/moi/export', s.lea12345)).corps;
  assert.deepEqual(exp.tournois.map(x => [x.tournoi, x.role]), [['Coupe', 'titulaire']]);
  assert.deepEqual(exp.resultatsJoues.map(x => [x.issue, x.mvp, x.stats.kills, x.personnages]), [['victoire', true, 20, ['jett']]]);
  const base = await api('/admin/export', s.fondateur);
  for (const table of ['tournois', 'tournoi_roster', 'tournoi_matchs', 'resultats', 'resultat_manches', 'resultat_joueurs']) assert.ok(Array.isArray(base.corps.tables[table]) && base.corps.tables[table].length >= (table === 'tournoi_matchs' ? 0 : 1), table);
  assert.equal((await api('/moi', s.lea12345, { methode: 'DELETE' })).statut, 200);
  assert.equal((await b.base.premier("SELECT COUNT(*) AS n FROM tournoi_roster WHERE compte_id = 'lea12345'", [])).n * 1, 0);
  const apres = (await api(`${r}/${res.id}`, s.coach123)).corps.resultat;
  assert.equal(apres.mvp, null);
  assert.deepEqual(apres.joueurs.map(j => j.compte), [null, 'kai12345'], 'ligne gardée, anonyme');
  assert.equal(apres.issue, 'victoire', 'le résultat de la team reste');
  // Suppression par l'Administration : même effacement.
  assert.equal((await api('/admin/comptes/kai12345/hub', s.fondateur, { methode: 'DELETE' })).statut, 200);
  assert.equal((await b.base.premier("SELECT COUNT(*) AS n FROM resultat_joueurs WHERE compte_id = 'kai12345'", [])).n * 1, 0);
  assert.ok(A.teamId);
});
