/**
 * Planning : type d'événement « Review » (migration 0080) et disponibilités unifiées de l'équipe CM (migration 0081).
 * SQLite par défaut, PostgreSQL avec ESPORT_TEST_PG (npm run esport:tester:pg).
 *
 *  - migration 0080 sur une base remplie : événements, séries, exceptions, présences et lignes liées identiques après
 *    la migration (toutes les tables comparées ligne à ligne), contrainte CHECK élargie à 'review' seulement, clés
 *    étrangères et ON DELETE CASCADE intacts ; en SQLite : reconstruction clés étrangères coupées, puis remises ;
 *    une reconstruction qui laisserait une ligne orpheline est annulée ;
 *  - type Review : création, filtres, modification, présence et statistiques, iCal, annonce et rappel Discord,
 *    calendrier des teams de l'espace CM, commande /planning du bot ;
 *  - disponibilités : migration 0081 (reprise sans perte des disponibilités des Réunions CM), import d'un export
 *    antérieur, et les Réunions qui lisent et écrivent les disponibilités de la team CM du club (semaine type,
 *    semaines personnalisées, absences et congés).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { baseMigree, baseVierge, lireMigrations, nomsIndex, nomsTables, SUR_POSTGRES } from './base.mjs';
import { appliquerMigrations, estReconstruction, sqlDuDialecte } from '../noyau/migrations.mjs';
import { TEAM_CM_ID } from '../noyau/cm/teamCm.mjs';
import { TYPES_EVENEMENT } from '../noyau/planning/service.mjs';
import { TYPES_CHOIX } from '../noyau/discord/bot/commandes.mjs';
import { COULEURS_TYPES, EMOJIS_TYPES, couleurType, nomType } from '../noyau/discord/embeds.mjs';
import { rappelsDiscord } from '../noyau/discord/rappels.mjs';
import { traiterFile } from '../noyau/discord/file.mjs';
import { texteCharge } from '../noyau/discord/messages.mjs';
import { distribuer } from '../noyau/evenements.mjs';
import { CLE } from './aide.mjs';
import { exporterBase, importerBase, reprendreDisposCm } from '../noyau/transfert.mjs';
import { URL_TEST } from './discord-aide.mjs';

const D = '2026-10-01T00:00:00.000Z';

// ------------------------------------------------------------------ Migrateur : sections par moteur

test('migrateur : sections « @dialecte » (communes + celles du moteur), marqueur « @reconstruction »', () => {
  const sql = 'CREATE TABLE a (x TEXT);\n-- @dialecte postgres\nSELECT 1;\n-- @dialecte sqlite\nSELECT 2;\n-- @dialecte commun\nSELECT 3;';
  assert.equal(sqlDuDialecte(sql, 'postgres'), 'CREATE TABLE a (x TEXT);\nSELECT 1;\nSELECT 3;');
  assert.equal(sqlDuDialecte(sql, 'sqlite'), 'CREATE TABLE a (x TEXT);\nSELECT 2;\nSELECT 3;');
  assert.equal(sqlDuDialecte('SELECT 1;', 'sqlite'), 'SELECT 1;');
  assert.throws(() => sqlDuDialecte('-- @dialecte oracle\nSELECT 1;', 'sqlite'), /inconnue/);
  const m = lireMigrations().find(x => x.nom.startsWith('0080_'));
  assert.ok(m && estReconstruction(m.sql), '0080 : reconstruction en SQLite');
  assert.match(sqlDuDialecte(m.sql, 'postgres'), /DROP CONSTRAINT/);
  assert.doesNotMatch(sqlDuDialecte(m.sql, 'postgres'), /^DROP TABLE/m);
  assert.match(sqlDuDialecte(m.sql, 'sqlite'), /DROP TABLE planning_evenements;/);
  assert.doesNotMatch(sqlDuDialecte(m.sql, 'sqlite'), /^DO \$\$/m);
  assert.ok(!estReconstruction(lireMigrations().find(x => x.nom.startsWith('0081_')).sql));
});

// ------------------------------------------------------------------ Migration 0080 sur une base remplie

/** Toutes les lignes de toutes les tables (hors suivi des migrations), triées : comparaison exacte avant / après. */
async function photo(base) {
  const sortie = {};
  for (const t of await nomsTables(base)) {
    if (t === 'migrations_esport') continue;
    const lignes = (await base.tous(`SELECT * FROM ${t}`, [])).map(l => JSON.stringify(Object.fromEntries(Object.entries(l).sort(([a], [b]) => a.localeCompare(b)))));
    sortie[t] = lignes.sort();
  }
  return sortie;
}

async function baseAvant0080() {
  const base = await baseVierge();
  const migrations = lireMigrations();
  await appliquerMigrations(base, migrations.filter(m => m.nom < '0080'));
  const x = (sql, p = []) => base.executer(sql, p);
  for (const t of ['t1', 't2']) await x("INSERT INTO teams (id, nom, slug, jeu, cree_par, cree_le, maj_le) VALUES (?, ?, ?, 'valorant', 'principal', ?, ?)", [t, `Team ${t}`, t, D, D]);
  const ev = (id, team, type, o = {}) =>
    x('INSERT INTO planning_evenements (id, team_id, type, titre, description, debut, fin, fuseau, lieu, adversaire_id, review_id, recurrence, fin_serie, concernes, cree_par, cree_le, maj_le, supprime_le, convocation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      id, team, type, o.titre ?? `Événement ${id}`, o.description ?? 'Desc « accentuée »', o.debut ?? '2026-10-22T18:00:00.000Z', o.fin ?? '2026-10-22T20:00:00.000Z', 'Europe/Paris', o.lieu ?? '', o.adversaire ?? null, o.review ?? null, o.recurrence ?? null, o.finSerie ?? null, o.concernes ?? '[]', 'principal', D, D, o.supprime ?? null, o.convocation ?? null,
    ]);
  await ev('e1', 't1', 'scrim', { adversaire: 'adv1', lieu: 'Serveur 1' });
  await ev('e2', 't1', 'training', { recurrence: JSON.stringify({ jours: [1, 3], intervalle: 1, nombre: 10 }), finSerie: '2026-12-31', convocation: JSON.stringify({ groupes: ['joueurs'] }), concernes: '["lea12345"]' });
  await ev('e3', 't1', 'match', { supprime: D, review: 'rev1' });
  await ev('e4', 't2', 'tournament');
  await ev('e5', 't2', 'meeting');
  await ev('e6', 't2', 'other');
  for (const [occ, annulee] of [['2026-10-26T18:00:00.000Z', 1], ['2026-10-28T18:00:00.000Z', 0]]) {
    await x("INSERT INTO planning_exceptions (evenement_id, occurrence, team_id, annulee, titre, maj_par, maj_le, convocation) VALUES ('e2', ?, 't1', ?, 'Déplacé', 'principal', ?, NULL)", [occ, annulee, D]);
  }
  const presence = (ev, occ, compte, team, rsvp, reel) =>
    x("INSERT INTO presences (evenement_id, occurrence, compte_id, team_id, rsvp, reel, note, maj_le, retard_prevu, motif_prevu, retard_minutes, motif, hors_convocation) VALUES (?, ?, ?, ?, ?, ?, 'note', ?, 5, 'bus', 7, 'train', 0)", [ev, occ, compte, team, rsvp, reel, D]);
  await presence('e1', '2026-10-22T18:00:00.000Z', 'lea12345', 't1', 'oui', 'present');
  await presence('e1', '2026-10-22T18:00:00.000Z', 'kai12345', 't1', 'non', 'absent');
  await presence('e2', '2026-10-26T18:00:00.000Z', 'lea12345', 't1', 'peut_etre', 'retard');
  await presence('e2', '2026-10-28T18:00:00.000Z', 'lea12345', 't1', 'oui', 'excuse');
  await presence('e4', '2026-10-22T18:00:00.000Z', 'nox12345', 't2', 'sans_reponse', 'inconnu');
  // Lignes liées sans clé étrangère (rappels, annonces, débuts publiés sur Discord).
  await x("INSERT INTO discord_rappels (evenement_id, occurrence, genre, team_id, cree_le) VALUES ('e1', '2026-10-22T18:00:00.000Z', 'd1', 't1', ?)", [D]);
  await x("INSERT INTO discord_annonces (evenement_id, occurrence, team_id, salon_id, message_id, cle, cree_le, maj_le) VALUES ('e1', '2026-10-22T18:00:00.000Z', 't1', '1', '2', 'event_created', ?, ?)", [D, D]);
  await x("INSERT INTO discord_debuts (evenement_id, occurrence, team_id, cree_le) VALUES ('e4', '2026-10-22T18:00:00.000Z', 't2', ?)", [D]);
  return { base, migrations };
}

test('migration 0080 : événements, séries, exceptions, présences et lignes liées identiques ; CHECK élargi à review ; cascade intacte', async () => {
  const { base, migrations } = await baseAvant0080();
  const avant = await photo(base);
  assert.equal(avant.planning_evenements.length, 6);
  assert.equal(avant.presences.length, 5);
  assert.equal(avant.planning_exceptions.length, 2);
  // Avant : 'review' refusé.
  await assert.rejects(base.executer("UPDATE planning_evenements SET type = 'review' WHERE id = 'e6'", []));

  assert.deepEqual(await appliquerMigrations(base, migrations.filter(m => m.nom < '0081')), ['0080_planning_type_review.sql']);
  const apres = await photo(base);
  // Exactement les mêmes tables et les mêmes lignes (nombre ET contenu), présences et liens compris.
  assert.deepEqual(Object.keys(apres).sort(), Object.keys(avant).sort());
  for (const t of Object.keys(avant)) assert.deepEqual(apres[t], avant[t], `table ${t}`);
  for (const i of ['planning_evenements_team', 'planning_evenements_adversaire']) assert.ok((await nomsIndex(base)).includes(i), `index ${i}`);

  // CHECK : 'review' accepté, le reste toujours refusé.
  await base.executer("UPDATE planning_evenements SET type = 'review' WHERE id = 'e6'", []);
  await assert.rejects(base.executer("UPDATE planning_evenements SET type = 'vod' WHERE id = 'e6'", []));
  // Clés étrangères toujours là : présence vers un événement inconnu refusée ; suppression d'un événement = ses présences.
  await assert.rejects(base.executer("INSERT INTO presences (evenement_id, occurrence, compte_id, team_id, maj_le) VALUES ('fantome', 'o', 'c', 't1', ?)", [D]));
  await base.executer("DELETE FROM planning_evenements WHERE id = 'e1'", []);
  assert.equal(Number((await base.premier("SELECT COUNT(*) AS n FROM presences WHERE evenement_id = 'e1'", [])).n), 0);
  assert.equal(Number((await base.premier('SELECT COUNT(*) AS n FROM presences', [])).n), 3, 'les autres présences restent');
  await base.executer("DELETE FROM teams WHERE id = 't2'", []);
  assert.equal(Number((await base.premier("SELECT COUNT(*) AS n FROM planning_evenements WHERE team_id = 't2'", [])).n), 0, 'cascade depuis la team');

  if (SUR_POSTGRES) {
    const c = await base.tous("SELECT conname, convalidated, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'planning_evenements'::regclass AND contype = 'c'", []);
    assert.equal(c.length, 1, JSON.stringify(c));
    assert.equal(c[0].conname, 'planning_evenements_type_check');
    assert.equal(Number(c[0].convalidated), 1);
    assert.match(c[0].def, /'review'/);
  } else {
    assert.equal(Number((await base.premier('PRAGMA foreign_keys', [])).foreign_keys), 1, 'clés étrangères remises');
    assert.deepEqual(await base.tous('PRAGMA foreign_key_check', []), []);
    assert.deepEqual((await base.tous('PRAGMA foreign_key_list(presences)', [])).map(f => [f.table, f.on_delete]), [['planning_evenements', 'CASCADE']]);
    assert.deepEqual((await base.tous('PRAGMA foreign_key_list(planning_exceptions)', [])).map(f => [f.table, f.on_delete]), [['planning_evenements', 'CASCADE']]);
    assert.equal((await base.tous("SELECT name FROM sqlite_master WHERE name = 'planning_evenements_v79'", [])).length, 0);
  }
  // Rejouée : rien.
  assert.deepEqual(await appliquerMigrations(base, migrations), migrations.filter(m => m.nom >= '0081').map(m => m.nom));
  assert.deepEqual(await appliquerMigrations(base, migrations), []);
});

test('SQLite : une reconstruction qui laisserait une ligne orpheline est annulée, données et clés étrangères intactes', { skip: SUR_POSTGRES }, async () => {
  const base = await baseVierge();
  await base.script('CREATE TABLE p (id TEXT PRIMARY KEY); CREATE TABLE f (p_id TEXT NOT NULL REFERENCES p (id) ON DELETE CASCADE);');
  await base.executer("INSERT INTO p (id) VALUES ('a'), ('b')", []);
  await base.executer("INSERT INTO f (p_id) VALUES ('a'), ('b')", []);
  // La copie oublie « b » : la vérification des clés étrangères refuse, tout est annulé.
  await assert.rejects(base.scriptReconstruction("CREATE TABLE p2 (id TEXT PRIMARY KEY); INSERT INTO p2 SELECT id FROM p WHERE id = 'a'; DROP TABLE p; ALTER TABLE p2 RENAME TO p;"), /clé étrangère/);
  assert.deepEqual((await base.tous('SELECT id FROM p ORDER BY id', [])).map(l => l.id), ['a', 'b']);
  assert.equal(Number((await base.premier('SELECT COUNT(*) AS n FROM f', [])).n), 2, 'aucune cascade');
  assert.equal(Number((await base.premier('PRAGMA foreign_keys', [])).foreign_keys), 1);
  // Reconstruction correcte : le DROP TABLE ne vide pas la table fille.
  await base.scriptReconstruction('CREATE TABLE p2 (id TEXT PRIMARY KEY, x TEXT); INSERT INTO p2 (id) SELECT id FROM p; DROP TABLE p; ALTER TABLE p2 RENAME TO p;');
  assert.equal(Number((await base.premier('SELECT COUNT(*) AS n FROM f', [])).n), 2);
  assert.equal(Number((await base.premier('PRAGMA foreign_keys', [])).foreign_keys), 1);
});

// ------------------------------------------------------------------ Type Review : de bout en bout

function fauxDiscord() {
  const appels = [];
  const fetch = async (url, init) => {
    appels.push({ url, corps: JSON.parse(init.body) });
    return new Response(null, { status: 204 });
  };
  return { appels, fetch, contenus: () => appels.map(a => texteCharge(a.corps)) };
}

test('type Review : listes du serveur et du bot, couleur sarcelle distincte, libellés FR / EN', () => {
  assert.ok(TYPES_EVENEMENT.includes('review'));
  assert.equal(TYPES_EVENEMENT.at(-1), 'other', 'Autre reste en dernier');
  assert.ok(TYPES_CHOIX.some(c => c.value === 'review' && c.name === 'Review'));
  assert.equal(COULEURS_TYPES.review, '#0d9488');
  assert.equal(new Set(Object.values(COULEURS_TYPES)).size, Object.keys(COULEURS_TYPES).length, 'couleurs distinctes');
  assert.equal(couleurType('review'), 0x0d9488);
  assert.ok(EMOJIS_TYPES.review);
  assert.equal(nomType('review', 'fr'), 'Review');
  assert.equal(nomType('review', 'en'), 'Review');
});

test('type Review : création, filtres, modification, présence et statistiques, iCal, annonce et rappel Discord, calendrier CM', async () => {
  const discord = fauxDiscord();
  const b = await banc({ fetchDiscord: discord.fetch });
  const A = await teamAvecMembres(b, { membres: { coach123: { pseudo: 'Zed', role: 'coach' }, lea12345: { pseudo: 'Léa', role: 'joueur' }, max12345: { pseudo: 'Max', role: 'manager' } } });
  const s = A.sessions;
  const api = (chemin, jeton, o = {}) => b.appel(chemin, { jeton, methode: o.methode, corps: o.corps });
  const ok = async (chemin, jeton, o = {}) => {
    const r = await api(chemin, jeton, o);
    assert.equal(r.statut, 200, `${o.methode ?? 'GET'} ${chemin} : ${r.statut} ${JSON.stringify(r.corps)}`);
    return r.corps;
  };
  assert.equal((await api(`/teams/${A.teamId}/discord/webhook`, s.max12345, { methode: 'PUT', corps: { url: URL_TEST } })).statut, 200);
  const t = `/teams/${A.teamId}/planning`;
  const review = await ok(t, s.coach123, { methode: 'POST', corps: { type: 'review', titre: 'Review VOD Nova', date: '2026-10-21', heureDebut: '08:00', heureFin: '09:30' } });
  const idReview = review.id ?? review.evenement?.id;
  assert.ok(idReview, JSON.stringify(review));
  await ok(t, s.coach123, { methode: 'POST', corps: { type: 'scrim', titre: 'Scrim Faucons', date: '2026-10-22', heureDebut: '20:00', heureFin: '22:00' } });
  // Type inconnu toujours refusé.
  assert.equal((await api(t, s.coach123, { methode: 'POST', corps: { type: 'vod', titre: 'X', date: '2026-10-22', heureDebut: '20:00', heureFin: '21:00' } })).statut, 400);

  // Filtre par type.
  const liste = await ok(`${t}?debut=2026-10-19&fin=2026-10-26&types=review`, s.lea12345);
  const occurrences = liste.occurrences ?? liste.evenements ?? liste.liste;
  assert.deepEqual(occurrences.map(o => [o.type, o.titre]), [['review', 'Review VOD Nova']]);
  const tous = await ok(`${t}?debut=2026-10-19&fin=2026-10-26&types=review,scrim`, s.lea12345);
  assert.equal((tous.occurrences ?? tous.evenements ?? tous.liste).length, 2);

  // Modification (le type reste review) puis passage d'un scrim en review.
  await ok(`${t}/${idReview}`, s.coach123, { methode: 'PATCH', corps: { titre: 'Review VOD Nova (map 2)' } });
  const detail = await ok(`${t}/${idReview}`, s.lea12345);
  assert.equal((detail.evenement ?? detail).type, 'review');

  // Annonce Discord « Nouvel événement » : type « Review », couleur sarcelle.
  const annonce = discord.contenus().find(c => c.includes('Review VOD Nova'));
  assert.ok(annonce, JSON.stringify(discord.contenus()));
  assert.match(annonce, /\(Review\)/);
  const avecEmbed = discord.appels.find(a => texteCharge(a.corps).includes('Review VOD Nova') && a.corps.embeds?.length);
  if (avecEmbed?.corps.embeds[0].color !== undefined) assert.equal(avecEmbed.corps.embeds[0].color, 0x0d9488);

  // Rappel J-1 (le mercredi 21 à 08:00 Paris, horloge le 20 à 10:00Z).
  const t0 = b.horloge.t;
  assert.ok((await rappelsDiscord(b.base, { maintenant: t0 })) >= 1);
  await distribuer(b.base, { maintenant: t0 });
  await traiterFile(b.base, { cle: CLE, fetch: discord.fetch, maintenant: t0 });
  assert.ok(discord.contenus().some(c => /Rappel\*\* : Review VOD Nova \(map 2\) \(Review\)/.test(c)), JSON.stringify(discord.contenus()));

  // Présence : RSVP puis appel ; statistiques par type.
  const occ = (await ok(`${t}?debut=2026-10-19&fin=2026-10-26&types=review`, s.lea12345));
  const o = (occ.occurrences ?? occ.evenements ?? occ.liste)[0];
  const cle = o.cle ?? o.occurrence;
  await ok(`${t}/${idReview}/occurrences/${encodeURIComponent(cle)}/rsvp`, s.lea12345, { methode: 'PUT', corps: { rsvp: 'oui' } });
  const feuille = await ok(`${t}/${idReview}/occurrences/${encodeURIComponent(cle)}/presence`, s.coach123);
  assert.ok(JSON.stringify(feuille).includes('lea12345'));
  const marquer = await api(`${t}/${idReview}/occurrences/${encodeURIComponent(cle)}/presence`, s.coach123, { methode: 'PUT', corps: { marques: [{ compte: 'lea12345', reel: 'present' }] } });
  assert.equal(marquer.statut, 200, JSON.stringify(marquer.corps));
  const stats = await ok(`/teams/${A.teamId}/presence/stats?debut=2026-10-19&fin=2026-10-26&types=review`, s.coach123);
  assert.ok(JSON.stringify(stats).includes('"review"'), JSON.stringify(stats).slice(0, 400));

  // iCal : catégorie / libellé du type.
  const ics = await api(`${t}/export.ics`, s.lea12345);
  assert.equal(ics.statut, 200);
  assert.match(String(ics.corps?.contenu ?? ics.texte ?? ics.corps), /Review/);

  // Calendrier des teams de l'espace CM : la review y figure, avec son type.
  const cal = await ok('/cm/calendrier/teams?du=2026-10-19&au=2026-11-01', s.fondateur);
  const evs = cal.teams.find(x => x.id === A.teamId).evenements;
  assert.ok(evs.some(e => e.type === 'review' && e.titre.startsWith('Review VOD Nova')), JSON.stringify(evs.map(e => [e.type, e.titre])));

  // Suppression.
  await ok(`${t}/${idReview}`, s.coach123, { methode: 'DELETE' });
  const apres = await ok(`${t}?debut=2026-10-19&fin=2026-10-26&types=review`, s.lea12345);
  assert.equal((apres.occurrences ?? apres.evenements ?? apres.liste).length, 0);
});

// ------------------------------------------------------------------ Migration 0081 : disponibilités unifiées

const REGLE = "INSERT INTO cm_dispo_regles (id, compte_id, jour, debut, fin, type, fuseau, cree_le) VALUES (?, ?, ?, '18:00', '22:00', 'disponible', 'Europe/Paris', ?)";
const REGLE_TEAM = "INSERT INTO dispo_regles (id, team_id, compte_id, jour, debut, fin, type, fuseau, cree_le) VALUES (?, ?, ?, ?, '10:00', '12:00', 'disponible', 'Europe/Paris', ?)";
const ids = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('migration 0081 : disponibilités des Réunions CM reprises sans perte dans celles de la team CM du club', async () => {
  const base = await baseVierge();
  const migrations = lireMigrations();
  await appliquerMigrations(base, migrations.filter(m => m.nom < '0081'));
  const x = (sql, p) => base.executer(sql, p);
  await x("INSERT INTO teams (id, nom, slug, jeu, cree_par, cree_le, maj_le) VALUES ('t1', 'T1', 't1', 'valorant', 'principal', ?, ?)", [D, D]);
  // ana : seulement les Réunions ; bob : les deux, Réunions plus récentes ; cid : les deux, team plus récente.
  await x(REGLE, [ids(1), 'ana12345', 1, '2026-11-01T00:00:00.000Z']);
  await x(REGLE, [ids(2), 'ana12345', 3, '2026-11-01T00:00:00.000Z']);
  await x(REGLE, [ids(3), 'bob12345', 2, '2026-11-05T00:00:00.000Z']);
  await x(REGLE, [ids(4), 'cid12345', 4, '2026-10-01T00:00:00.000Z']);
  await x(REGLE, [ids(5), 'cid12345', 5, '2026-10-01T00:00:00.000Z']);
  await x(REGLE_TEAM, [ids(11), TEAM_CM_ID, 'bob12345', 6, '2026-11-01T00:00:00.000Z']);
  await x(REGLE_TEAM, [ids(12), TEAM_CM_ID, 'cid12345', 6, '2026-11-02T00:00:00.000Z']);
  await x(REGLE_TEAM, [ids(13), TEAM_CM_ID, 'cid12345', 7, '2026-11-02T00:00:00.000Z']);
  await x(REGLE_TEAM, [ids(14), 't1', 'ana12345', 1, '2026-09-01T00:00:00.000Z']);
  for (const [n, compte, type] of [[21, 'ana12345', 'absence'], [22, 'bob12345', 'conge'], [23, 'cid12345', 'disponible']]) {
    await x("INSERT INTO cm_dispo_exceptions (id, compte_id, debut, fin, type, note, cree_le) VALUES (?, ?, '2026-11-20T00:00:00.000Z', '2026-11-22T00:00:00.000Z', ?, 'Vacances', ?)", [ids(n), compte, type, D]);
  }
  await x("INSERT INTO dispo_exceptions (id, team_id, compte_id, debut, fin, type, note, cree_le) VALUES (?, 't1', 'ana12345', '2026-11-01T18:00:00.000Z', '2026-11-01T20:00:00.000Z', 'indisponible', '', ?)", [ids(24), D]);

  assert.deepEqual(await appliquerMigrations(base, migrations.filter(m => m.nom <= '0081_dispos_cm_unifiees.sql')), ['0081_dispos_cm_unifiees.sql']);
  const regles = async compte => (await base.tous('SELECT id, jour FROM dispo_regles WHERE team_id = ? AND compte_id = ? ORDER BY jour', [TEAM_CM_ID, compte])).map(r => [r.id, Number(r.jour)]);
  assert.deepEqual(await regles('ana12345'), [[ids(1), 1], [ids(2), 3]], 'ana : sa semaine des Réunions, mêmes identifiants');
  assert.deepEqual(await regles('bob12345'), [[ids(3), 2]], 'bob : la plus récente (Réunions)');
  assert.deepEqual(await regles('cid12345'), [[ids(12), 6], [ids(13), 7]], 'cid : la plus récente (team)');
  const reprises = (await base.tous('SELECT id, compte_id, origine, debut, fin, type, fuseau, cree_le FROM dispo_regles_reprises ORDER BY id', [])).map(r => [r.id, r.compte_id, r.origine]);
  assert.deepEqual(reprises, [[ids(4), 'cid12345', 'reunions_cm'], [ids(5), 'cid12345', 'reunions_cm'], [ids(11), 'bob12345', 'planning']]);
  // Rien de perdu : 5 règles des Réunions + 3 de la team CM = 5 gardées + 3 mises de côté.
  assert.equal(Number((await base.premier('SELECT COUNT(*) AS n FROM dispo_regles WHERE team_id = ?', [TEAM_CM_ID])).n) + reprises.length, 8);
  assert.deepEqual((await base.tous("SELECT id FROM dispo_regles WHERE team_id = 't1'", [])).map(r => r.id), [ids(14)], 'les autres teams ne bougent pas');
  const exc = await base.tous('SELECT id, compte_id, type, motif, note, debut, fin FROM dispo_exceptions WHERE team_id = ? ORDER BY id', [TEAM_CM_ID]);
  assert.deepEqual(exc.map(e => [e.id, e.type, e.motif ?? null, e.note]), [[ids(21), 'indisponible', 'absence', 'Vacances'], [ids(22), 'indisponible', 'conge', 'Vacances'], [ids(23), 'disponible', null, 'Vacances']]);
  assert.equal(exc[0].debut, '2026-11-20T00:00:00.000Z');
  assert.equal(Number((await base.premier("SELECT COUNT(*) AS n FROM dispo_exceptions WHERE team_id = 't1'", [])).n), 1);
  const tables = await nomsTables(base);
  for (const t of ['cm_dispo_regles', 'cm_dispo_exceptions']) assert.ok(!tables.includes(t), `${t} supprimée`);
  await assert.rejects(base.executer("UPDATE dispo_exceptions SET motif = 'maladie' WHERE id = ?", [ids(21)]));
});

test('import d’un export antérieur à 0081 : même reprise (reprendreDisposCm)', async () => {
  const r = { compte_id: 'bob12345', jour: 2, debut: '18:00', fin: '22:00', type: 'disponible', fuseau: 'Europe/Paris' };
  const tables = reprendreDisposCm({
    dispo_regles: [{ ...r, id: ids(11), team_id: TEAM_CM_ID, cree_le: '2026-11-01T00:00:00.000Z' }, { ...r, id: ids(12), team_id: TEAM_CM_ID, compte_id: 'cid12345', cree_le: '2026-11-02T00:00:00.000Z' }],
    cm_dispo_regles: [{ ...r, id: ids(1), compte_id: 'ana12345', cree_le: D }, { ...r, id: ids(3), cree_le: '2026-11-05T00:00:00.000Z' }, { ...r, id: ids(4), compte_id: 'cid12345', cree_le: D }],
    cm_dispo_exceptions: [{ id: ids(21), compte_id: 'ana12345', debut: D, fin: D, type: 'conge', note: 'x', cree_le: D }],
  });
  assert.ok(!('cm_dispo_regles' in tables) && !('cm_dispo_exceptions' in tables));
  assert.deepEqual(tables.dispo_regles.map(x => [x.id, x.compte_id, x.team_id]).sort(), [[ids(1), 'ana12345', TEAM_CM_ID], [ids(12), 'cid12345', TEAM_CM_ID], [ids(3), 'bob12345', TEAM_CM_ID]].sort());
  assert.deepEqual(tables.dispo_regles_reprises.map(x => [x.id, x.origine]).sort(), [[ids(11), 'planning'], [ids(4), 'reunions_cm']].sort());
  assert.deepEqual(tables.dispo_exceptions.map(x => [x.id, x.type, x.motif]), [[ids(21), 'indisponible', 'conge']]);
  // Un export récent passe tel quel.
  const recent = { dispo_regles: [] };
  assert.equal(reprendreDisposCm(recent), recent);
});

// ------------------------------------------------------------------ Réunions CM : la même source que l'onglet Disponibilités

async function preparerCm() {
  const b = await banc();
  const A = await teamAvecMembres(b, { membres: { cor12345: { pseudo: 'Cora', role: 'joueur' } } });
  const s = { ...A.sessions };
  s.res12345 = await b.session('res12345', 'Rita');
  const api = (chemin, jeton, o = {}) => b.appel(chemin, { jeton, methode: o.methode, corps: o.corps });
  const ok = async (chemin, jeton, o = {}) => {
    const r = await api(chemin, jeton, o);
    assert.equal(r.statut, 200, `${o.methode ?? 'GET'} ${chemin} : ${r.statut} ${JSON.stringify(r.corps)}`);
    return r.corps;
  };
  // Rita : Responsable CM du club (membre de la team CM du club). Cora : Correspondante CM d'une team (hors team CM).
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'res12345', roleId: 'cm-role-responsable', portee: 'club' } });
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'cor12345', roleId: 'cm-role-correspondant', portee: A.teamId } });
  return { b, A, s, api, ok };
}

test('Réunions CM : grille, « Trouver un créneau » et statut lisent les disponibilités de la team CM du club (semaines personnalisées comprises)', async () => {
  const { b, s, api, ok } = await preparerCm();
  const T = `/teams/${TEAM_CM_ID}/dispos`;
  // Rita saisit sa semaine type dans l'onglet Disponibilités (team CM du club) : tous les jours 18:00–22:00.
  await ok(`${T}/moi/regles`, s.res12345, { methode: 'PUT', corps: { fuseau: 'Europe/Paris', regles: [1, 2, 3, 4, 5, 6, 7].map(jour => ({ jour, debut: '18:00', fin: '22:00', type: 'disponible' })) } });
  // Les Réunions voient la même semaine type.
  const mes = await ok('/cm/reunions/dispos/moi', s.res12345);
  assert.equal(mes.regles.length, 7);
  assert.equal(mes.teamId, TEAM_CM_ID);
  // Cora (hors team CM) saisit la sienne depuis les Réunions : mercredi 20:00–21:00 ; rangée dans la team CM du club.
  await ok('/cm/reunions/dispos/moi/regles', s.cor12345, { methode: 'PUT', corps: { fuseau: 'Europe/Paris', regles: [{ jour: 3, debut: '20:00', fin: '21:00', type: 'disponible' }] } });
  assert.deepEqual((await b.base.tous('SELECT team_id, jour, debut, fin FROM dispo_regles WHERE compte_id = ?', ['cor12345'])).map(r => [r.team_id, Number(r.jour), r.debut, r.fin]), [[TEAM_CM_ID, 3, '20:00', '21:00']]);

  // Grille de l'équipe : mercredi 21 octobre 19:00, Rita libre.
  const g = await ok('/cm/reunions/equipe/grille?semaine=2026-10-19&fuseau=Europe/Paris', s.res12345);
  const h19 = g.creneaux.indexOf('19:00');
  assert.ok(g.cellules[2][h19].comptes.includes('res12345'));
  assert.ok(!g.sansCreneaux.includes('res12345') && !g.sansCreneaux.includes('cor12345'));
  // Semaine personnalisée (onglet Disponibilités, semaine du 26 octobre) vide : Rita indisponible toute la semaine.
  await ok(`${T}/semaines/moi/2026-10-26`, s.res12345, { methode: 'PUT', corps: { regles: [], fuseau: 'Europe/Paris' } });
  const g2 = await ok('/cm/reunions/equipe/grille?semaine=2026-10-26&fuseau=Europe/Paris', s.res12345);
  assert.ok(!g2.cellules[2][h19].comptes.includes('res12345'), 'semaine personnalisée prise en compte');
  assert.ok(g.cellules[2][h19].comptes.includes('res12345'), 'la semaine type vaut pour les autres semaines');

  // Trouver un créneau mercredi : 20:00–21:00, les deux libres.
  const c = await ok('/cm/reunions/creneaux', s.res12345, { methode: 'POST', corps: { participants: ['cor12345'], duree: 60, du: '2026-10-21', jours: 1, fuseau: 'Europe/Paris' } });
  assert.equal(c.propositions[0].local.heure, '20:00');
  assert.equal(c.propositions[0].tous, true);
  // Semaine personnalisée : mercredi 28, Rita absente partout.
  const c2 = await ok('/cm/reunions/creneaux', s.res12345, { methode: 'POST', corps: { participants: ['cor12345'], duree: 60, du: '2026-10-28', jours: 1, fuseau: 'Europe/Paris' } });
  assert.ok(c2.propositions.every(p => p.absents.includes('res12345')), JSON.stringify(c2.propositions));

  // Congé posé dans l'onglet Disponibilités (motif congé) : absente aux Réunions, statut « absent » pendant.
  await ok(`${T}/moi/exceptions`, s.res12345, { methode: 'POST', corps: { date: '2026-10-20', heureDebut: '00:00', heureFin: '23:59', type: 'indisponible', motif: 'conge', note: 'Repos', fuseau: 'Europe/Paris' } });
  assert.equal((await api(`${T}/moi/exceptions`, s.res12345, { methode: 'POST', corps: { date: '2026-10-20', heureDebut: '10:00', heureFin: '11:00', type: 'disponible', motif: 'conge' } })).statut, 400, 'motif réservé à une exception indisponible');
  const moi = await ok('/cm/reunions/moi', s.cor12345);
  const rita = moi.equipe.find(m => m.compte === 'res12345');
  assert.equal(rita.statut, 'absent');
  assert.equal(rita.fuseau, 'Europe/Paris');
  const mes2 = await ok('/cm/reunions/dispos/moi', s.res12345);
  assert.ok(mes2.exceptions.some(x => x.type === 'conge' && x.note === 'Repos'));

  // Absence posée dans les Réunions : exception de la team CM du club, motif « absence », visible dans l'onglet Disponibilités.
  await ok('/cm/reunions/dispos/moi/exceptions', s.res12345, { methode: 'POST', corps: { type: 'absence', jourDebut: '2026-10-23', jourFin: '2026-10-23', fuseau: 'Europe/Paris', note: 'Salon' } });
  const team = await ok(`${T}/moi`, s.res12345);
  const absence = team.exceptions.find(x => x.note === 'Salon');
  assert.deepEqual([absence.type, absence.motif], ['indisponible', 'absence']);
  // Semaine type changée depuis les Réunions : l'onglet Disponibilités la montre.
  await ok('/cm/reunions/dispos/moi/regles', s.res12345, { methode: 'PUT', corps: { fuseau: 'Europe/Paris', regles: [{ jour: 1, debut: '09:00', fin: '12:00', type: 'disponible' }] } });
  assert.deepEqual((await ok(`${T}/moi`, s.res12345)).regles.map(r => [r.jour, r.debut, r.fin]), [[1, '09:00', '12:00']]);
  // Suppression depuis les Réunions.
  await ok(`/cm/reunions/dispos/moi/exceptions/${absence.id}`, s.res12345, { methode: 'DELETE' });
  assert.ok(!(await ok(`${T}/moi`, s.res12345)).exceptions.some(x => x.note === 'Salon'));
  // La carte de la team CM du club (membres seulement) compte Rita, pas Cora (hors team).
  const carte = await ok(`${T}/carte?semaine=2026-10-19&fuseau=Europe/Paris`, s.res12345);
  assert.ok(!Object.keys(carte.noms).includes('cor12345'));
  assert.ok(Object.keys(carte.noms).includes('res12345'));
});

test('RGPD et export de la base : disponibilités de l’équipe CM depuis la source unique ; suppression du compte', async () => {
  const { b, s, ok } = await preparerCm();
  await ok('/cm/reunions/dispos/moi/regles', s.res12345, { methode: 'PUT', corps: { fuseau: 'Europe/Paris', regles: [{ jour: 2, debut: '10:00', fin: '12:00', type: 'disponible' }] } });
  await ok('/cm/reunions/dispos/moi/exceptions', s.res12345, { methode: 'POST', corps: { type: 'conge', jourDebut: '2026-10-30', fuseau: 'Europe/Paris' } });
  await b.base.executer("INSERT INTO dispo_regles_reprises (id, compte_id, jour, debut, fin, type, fuseau, cree_le, origine, repris_le) VALUES (?, 'res12345', 4, '08:00', '09:00', 'disponible', 'Europe/Paris', ?, 'reunions_cm', ?)", [ids(99), D, D]);
  const exp = await ok('/moi/export', s.res12345);
  assert.equal(exp.cmDisponibilites.creneaux.length, 1);
  assert.deepEqual(exp.cmDisponibilites.exceptions.map(x => x.type), ['conge']);
  assert.equal(exp.cmDisponibilites.misesDeCote.length, 1);
  const donnees = await exporterBase(b.base, b.horloge.t);
  assert.equal(donnees.tables.dispo_regles_reprises.length, 1);
  const neuve = await baseMigree();
  const bilan = await importerBase(neuve, JSON.parse(JSON.stringify(donnees)));
  assert.equal(bilan.dispo_regles_reprises, 1);
  assert.equal(bilan.dispo_exceptions, 1);
  const supp = await b.appel('/moi', { methode: 'DELETE', jeton: s.res12345, corps: { confirmation: 'SUPPRIMER' } });
  assert.equal(supp.statut, 200, JSON.stringify(supp.corps));
  for (const t of ['dispo_regles', 'dispo_exceptions', 'dispo_regles_reprises']) assert.equal(Number((await b.base.premier(`SELECT COUNT(*) AS n FROM ${t} WHERE compte_id = 'res12345'`, [])).n), 0, t);
});
