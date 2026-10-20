/**
 * Planning, fonctions pures : fuseaux et changement d'heure, récurrence
 * hebdomadaire (exceptions comprises), heatmap et seuil, statistiques de
 * présence, CSV, iCal valide.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heatmap, libresDe, plagesPropices, soustraire, union } from '../noyau/planning/dispos.mjs';
import { calendrierIcs, echapper, plier } from '../noyau/planning/ical.mjs';
import { champCsv, csv, lireMinutes, periodeDe, seriesAbsences, statistiques } from '../noyau/planning/presence.mjs';
import { estOccurrence, lireRecurrence, occurrences, occurrencesBrutes } from '../noyau/planning/recurrence.mjs';
import { decalage, fuseauValide, instantMural, lireDate, lireHeure, partiesLocales, versUtc } from '../noyau/planning/temps.mjs';
import { appliquerMigrations } from '../noyau/migrations.mjs';
import { baseVierge, lireMigrations } from './base.mjs';
import { verifierIcs } from './ics.mjs';

const Z = t => new Date(t).toISOString();
const PARIS = 'Europe/Paris';

// ------------------------------------------------------------------ Fuseaux

test('fuseaux : décalages été/hiver, conversion murale ↔ UTC, fuseaux invalides', () => {
  assert.ok(fuseauValide(PARIS) && fuseauValide('America/New_York') && fuseauValide('UTC'));
  assert.ok(!fuseauValide('Mars/Olympus') && !fuseauValide('../etc') && !fuseauValide(''));
  assert.equal(decalage(PARIS, Date.parse('2026-07-01T12:00:00Z')), 120);
  assert.equal(decalage(PARIS, Date.parse('2026-12-01T12:00:00Z')), 60);
  assert.equal(decalage('America/New_York', Date.parse('2026-07-01T12:00:00Z')), -240);
  assert.equal(Z(versUtc(PARIS, { annee: 2026, mois: 10, jour: 20, heure: 20, minute: 0 })), '2026-10-20T18:00:00.000Z');
  assert.equal(Z(versUtc(PARIS, { annee: 2026, mois: 10, jour: 27, heure: 20, minute: 0 })), '2026-10-27T19:00:00.000Z');
  assert.deepEqual(partiesLocales(PARIS, Date.parse('2026-10-27T19:00:00Z')).heure, 20);
  // Passage à l'heure d'été (29 mars 2026, 02:00 → 03:00) : 02:30 n'existe pas → décalé à 03:30 (01:30 UTC).
  assert.equal(Z(versUtc(PARIS, { annee: 2026, mois: 3, jour: 29, heure: 2, minute: 30 })), '2026-03-29T01:30:00.000Z');
  // Passage à l'heure d'hiver (25 octobre 2026, 03:00 → 02:00) : 02:30 existe deux fois → la première (00:30 UTC).
  assert.equal(Z(versUtc(PARIS, { annee: 2026, mois: 10, jour: 25, heure: 2, minute: 30 })), '2026-10-25T00:30:00.000Z');
  // Minuit + 1440 minutes = minuit du lendemain.
  assert.equal(Z(instantMural(PARIS, { annee: 2026, mois: 10, jour: 24 }, 1440)), '2026-10-24T22:00:00.000Z');
  assert.equal(lireHeure('24:00'), 1440);
  assert.equal(lireHeure('25:00'), undefined);
  assert.equal(lireDate('2026-02-30'), undefined);
});

// ------------------------------------------------------------------ Récurrence

const ENTRAINEMENT = {
  debut: '2026-10-20T18:00:00.000Z', // mardi 20:00 à Paris (heure d'été)
  fin: '2026-10-20T20:00:00.000Z',
  fuseau: PARIS,
  recurrence: { freq: 'hebdo', intervalle: 1, jours: [2, 4], jusqua: null, nombre: null },
};

test('récurrence hebdomadaire : l’heure murale tient à travers le changement d’heure (Paris)', () => {
  const o = occurrencesBrutes(ENTRAINEMENT, Date.parse('2026-10-19T00:00:00Z'), Date.parse('2026-11-02T00:00:00Z'));
  assert.deepEqual(
    o.map(x => x.cle),
    [
      '2026-10-20T18:00:00.000Z', // mardi 20 (UTC+2)
      '2026-10-22T18:00:00.000Z', // jeudi 22 (UTC+2)
      '2026-10-27T19:00:00.000Z', // mardi 27 (UTC+1, après le 25)
      '2026-10-29T19:00:00.000Z',
    ],
  );
  for (const x of o) {
    assert.equal(partiesLocales(PARIS, x.debut).heure, 20);
    assert.equal(x.fin - x.debut, 2 * 3_600_000);
  }
});

test('récurrence : passage à l’heure d’été au printemps, et un autre fuseau (New York)', () => {
  const ev = { debut: '2026-03-22T19:00:00.000Z', fin: '2026-03-22T21:00:00.000Z', fuseau: PARIS, recurrence: { freq: 'hebdo', intervalle: 1, jours: [7] } };
  assert.deepEqual(
    occurrencesBrutes(ev, Date.parse('2026-03-20T00:00:00Z'), Date.parse('2026-04-06T00:00:00Z')).map(x => x.cle),
    ['2026-03-22T19:00:00.000Z', '2026-03-29T18:00:00.000Z', '2026-04-05T18:00:00.000Z'],
  );
  const ny = { debut: '2026-10-27T23:00:00.000Z', fin: '2026-10-28T00:00:00.000Z', fuseau: 'America/New_York', recurrence: { freq: 'hebdo', intervalle: 1, jours: [2] } };
  // 19:00 à New York : 23:00 UTC avant le 1er novembre, 00:00 UTC (le lendemain) après.
  assert.deepEqual(
    occurrencesBrutes(ny, Date.parse('2026-10-26T00:00:00Z'), Date.parse('2026-11-12T00:00:00Z')).map(x => x.cle),
    ['2026-10-27T23:00:00.000Z', '2026-11-04T00:00:00.000Z', '2026-11-11T00:00:00.000Z'],
  );
});

test('récurrence : intervalle, fin par date ou par nombre, fenêtre lointaine', () => {
  const tous15 = { ...ENTRAINEMENT, recurrence: { freq: 'hebdo', intervalle: 2, jours: [2], jusqua: '2026-11-17', nombre: null } };
  assert.deepEqual(
    occurrencesBrutes(tous15, Date.parse('2026-10-01T00:00:00Z'), Date.parse('2027-01-01T00:00:00Z')).map(x => x.cle),
    ['2026-10-20T18:00:00.000Z', '2026-11-03T19:00:00.000Z', '2026-11-17T19:00:00.000Z'],
  );
  const trois = { ...ENTRAINEMENT, recurrence: { freq: 'hebdo', intervalle: 1, jours: [2, 4], nombre: 3 } };
  assert.equal(occurrencesBrutes(trois, 0, Date.parse('2030-01-01T00:00:00Z')).length, 3);
  // Sans fin : une fenêtre dans deux ans ne calcule que ce qu'il faut.
  const loin = occurrencesBrutes(ENTRAINEMENT, Date.parse('2028-10-02T00:00:00Z'), Date.parse('2028-10-09T00:00:00Z'));
  assert.equal(loin.length, 2);
  assert.equal(partiesLocales(PARIS, loin[0].debut).heure, 20);
  assert.ok(estOccurrence(ENTRAINEMENT, '2026-10-27T19:00:00.000Z'));
  assert.ok(!estOccurrence(ENTRAINEMENT, '2026-10-27T18:00:00.000Z'));
  assert.ok(!estOccurrence(ENTRAINEMENT, '2026-10-19T18:00:00.000Z'));
});

test('récurrence : règle saisie validée', () => {
  assert.equal(lireRecurrence(null, 2), null);
  assert.deepEqual(lireRecurrence({ jours: [4, 2, 2] }, 2), { freq: 'hebdo', intervalle: 1, jours: [2, 4], jusqua: null, nombre: null });
  assert.deepEqual(lireRecurrence({}, 5).jours, [5]);
  assert.throws(() => lireRecurrence({ freq: 'mensuel' }, 1), /hebdomadaire/);
  assert.throws(() => lireRecurrence({ intervalle: 9 }, 1));
  assert.throws(() => lireRecurrence({ jours: [8] }, 1));
  assert.throws(() => lireRecurrence({ jusqua: '2026-13-01' }, 1));
  assert.throws(() => lireRecurrence({ nombre: 500 }, 1));
});

test('occurrences : exceptions (annulée, déplacée, renommée)', () => {
  const x = new Map([
    ['2026-10-22T18:00:00.000Z', { annulee: 1 }],
    ['2026-10-27T19:00:00.000Z', { annulee: 0, titre: 'Scrim spécial', debut: '2026-10-28T19:00:00.000Z', fin: '2026-10-28T21:00:00.000Z' }],
  ]);
  const o = occurrences(ENTRAINEMENT, Date.parse('2026-10-19T00:00:00Z'), Date.parse('2026-11-02T00:00:00Z'), x);
  assert.deepEqual(o.map(v => [v.cle, Z(v.debut), v.titre]), [
    ['2026-10-20T18:00:00.000Z', '2026-10-20T18:00:00.000Z', null],
    ['2026-10-27T19:00:00.000Z', '2026-10-28T19:00:00.000Z', 'Scrim spécial'],
    ['2026-10-29T19:00:00.000Z', '2026-10-29T19:00:00.000Z', null],
  ]);
  // Une occurrence déplacée HORS de sa semaine d'origine est trouvée par la fenêtre où elle tombe.
  const deplacee = new Map([['2026-10-20T18:00:00.000Z', { annulee: 0, debut: '2026-11-10T19:00:00.000Z', fin: '2026-11-10T20:00:00.000Z' }]]);
  const nov = occurrences(ENTRAINEMENT, Date.parse('2026-11-10T00:00:00Z'), Date.parse('2026-11-11T00:00:00Z'), deplacee);
  assert.deepEqual(nov.map(v => v.cle), ['2026-10-20T18:00:00.000Z', '2026-11-10T19:00:00.000Z']);
});

// ------------------------------------------------------------------ Disponibilités

test('intervalles : union et soustraction', () => {
  assert.deepEqual(union([{ s: 5, e: 8 }, { s: 1, e: 3 }, { s: 2, e: 6 }]), [{ s: 1, e: 8 }]);
  assert.deepEqual(soustraire([{ s: 0, e: 10 }], [{ s: 2, e: 3 }, { s: 5, e: 12 }]), [{ s: 0, e: 2 }, { s: 3, e: 5 }]);
});

test('disponibilités : règles, exception disponible et indisponible prioritaires', () => {
  const joueur = {
    regles: [
      { jour: 2, debut: '18:00', fin: '23:00', type: 'disponible', fuseau: PARIS },
      { jour: 2, debut: '20:00', fin: '21:00', type: 'indisponible', fuseau: PARIS },
    ],
    exceptions: [
      { debut: '2026-10-20T19:30:00.000Z', fin: '2026-10-20T20:30:00.000Z', type: 'indisponible' },
      { debut: '2026-10-21T16:00:00.000Z', fin: '2026-10-21T18:00:00.000Z', type: 'disponible' },
    ],
  };
  const l = libresDe(joueur, Date.parse('2026-10-19T00:00:00Z'), Date.parse('2026-10-26T00:00:00Z'));
  assert.deepEqual(
    l.map(i => [Z(i.s), Z(i.e)]),
    [
      ['2026-10-20T16:00:00.000Z', '2026-10-20T18:00:00.000Z'], // 18:00-20:00 Paris (puis indisponible 20:00-21:00)
      ['2026-10-20T19:00:00.000Z', '2026-10-20T19:30:00.000Z'], // 21:00-21:30 (avant l'exception)
      ['2026-10-20T20:30:00.000Z', '2026-10-20T21:00:00.000Z'], // 22:30-23:00 (après l'exception)
      ['2026-10-21T16:00:00.000Z', '2026-10-21T18:00:00.000Z'], // exception disponible
    ],
  );
});

const regle = (jour, debut, fin, type = 'disponible', fuseau = PARIS) => ({ jour, debut, fin, type, fuseau });

test('heatmap : nombre de joueurs libres par créneau, seuil, plages propices', () => {
  const joueurs = [
    { compte: 'a', regles: [regle(1, '18:00', '23:00')] },
    { compte: 'b', regles: [regle(1, '19:00', '22:00')] },
    { compte: 'c', regles: [regle(1, '20:00', '24:00')] },
    { compte: 'd', regles: [regle(1, '20:00', '21:00'), regle(3, '10:00', '12:00')] },
    { compte: 'e', regles: [] },
  ];
  const carte = heatmap({ lundi: { annee: 2026, mois: 10, jour: 19 }, fuseau: PARIS, pas: 60, joueurs, seuil: 3 });
  assert.equal(carte.jours[0], '2026-10-19');
  assert.equal(carte.creneaux.length, 24);
  const lundi = carte.cellules[0];
  assert.deepEqual(lundi.slice(17, 24).map(c => c.n), [0, 1, 2, 4, 3, 2, 1]);
  assert.deepEqual(lundi[20].comptes.sort(), ['a', 'b', 'c', 'd']);
  assert.equal(lundi[20].debut, '2026-10-19T18:00:00.000Z');
  assert.equal(lundi[19].atteint, false);
  assert.equal(lundi[20].atteint, true);
  assert.deepEqual(plagesPropices(carte), [{ jour: '2026-10-19', debut: '2026-10-19T18:00:00.000Z', fin: '2026-10-19T20:00:00.000Z', n: 3 }]);
  // Seuil plus haut : rien de propice.
  assert.deepEqual(plagesPropices(heatmap({ lundi: { annee: 2026, mois: 10, jour: 19 }, fuseau: PARIS, pas: 60, joueurs, seuil: 5 })), []);
  // Pas de 30 minutes : 48 créneaux.
  assert.equal(heatmap({ lundi: { annee: 2026, mois: 10, jour: 19 }, fuseau: PARIS, pas: 30, joueurs, seuil: 3 }).creneaux.length, 48);
});

test('heatmap : règle saisie à Paris vue depuis New York, et jours de changement d’heure', () => {
  const joueurs = [{ compte: 'a', regles: [regle(1, '20:00', '22:00')] }];
  const ny = heatmap({ lundi: { annee: 2026, mois: 10, jour: 19 }, fuseau: 'America/New_York', pas: 60, joueurs, seuil: 1 });
  // 20:00 Paris = 14:00 New York (UTC+2 / UTC-4).
  assert.deepEqual(ny.cellules[0].map((c, i) => (c?.n ? ny.creneaux[i] : null)).filter(Boolean), ['14:00', '15:00']);
  // Printemps : à Paris, le créneau 02:00 du 29 mars 2026 n'existe pas.
  const mars = heatmap({ lundi: { annee: 2026, mois: 3, jour: 23 }, fuseau: PARIS, pas: 60, joueurs: [{ compte: 'a', regles: [regle(7, '20:00', '22:00')] }], seuil: 1 });
  assert.equal(mars.cellules[6][2], null);
  assert.equal(mars.cellules[6][20].n, 1);
  assert.equal(mars.cellules[6][20].debut, '2026-03-29T18:00:00.000Z');
  // Automne : le créneau 02:00 du 25 octobre dure deux heures ; la règle du dimanche reste à 20:00.
  const oct = heatmap({ lundi: { annee: 2026, mois: 10, jour: 19 }, fuseau: PARIS, pas: 60, joueurs: [{ compte: 'a', regles: [regle(7, '20:00', '22:00')] }], seuil: 1 });
  const c2 = oct.cellules[6][2];
  assert.equal(Date.parse(c2.fin) - Date.parse(c2.debut), 2 * 3_600_000);
  assert.equal(oct.cellules[6][20].debut, '2026-10-25T19:00:00.000Z');
  assert.equal(oct.cellules[6][20].n, 1);
});

// ------------------------------------------------------------------ Présence

test('statistiques de présence : par joueur, par type, par période ; taux = (présents + retards) / marqués, non marqués hors du taux', () => {
  const t = s => Date.parse(s);
  const lignes = [
    { compte: 'lea', type: 'training', debut: t('2026-09-01T18:00:00Z'), rsvp: 'oui', reel: 'present' },
    { compte: 'lea', type: 'training', debut: t('2026-09-08T18:00:00Z'), rsvp: 'oui', reel: 'retard', retardMinutes: 10 },
    { compte: 'lea', type: 'scrim', debut: t('2026-10-02T18:00:00Z'), rsvp: 'non', reel: 'excuse' },
    { compte: 'lea', type: 'match', debut: t('2026-10-05T18:00:00Z'), rsvp: 'sans_reponse', reel: 'absent' },
    { compte: 'kai', type: 'training', debut: t('2026-09-01T18:00:00Z'), rsvp: 'peut_etre', reel: 'absent' },
    { compte: 'kai', type: 'scrim', debut: t('2026-10-02T18:00:00Z'), rsvp: 'oui', reel: 'inconnu' },
    // Tom n'était pas convoqué au scrim : venu en plus, jamais dans les taux.
    { compte: 'tom', type: 'scrim', debut: t('2026-10-02T18:00:00Z'), rsvp: 'sans_reponse', reel: 'present', hors: true },
  ];
  const s = statistiques(lignes, { fuseau: PARIS, milieu: t('2026-09-20T00:00:00Z') });
  const lea = s.joueurs.find(j => j.compte === 'lea');
  assert.equal(lea.evenements, 4);
  assert.equal(lea.marques, 4);
  assert.equal(lea.taux, 2 / 4); // (présent + retard) / séances convoquées ET marquées (l'excusé compte, comme une absence justifiée)
  assert.equal(lea.ponctualite, 1 / 2);
  assert.equal(lea.retardMoyen, 10);
  assert.equal(lea.tauxReponse, 3 / 4);
  assert.equal(lea.serie, 2, 'deux absences de suite (excusé puis absent) à la fin');
  assert.equal(lea.serieMax, 2);
  assert.equal(lea.tendance, 0 - 1, 'septembre 100 %, octobre 0 %');
  const kai = s.joueurs.find(j => j.compte === 'kai');
  assert.equal(kai.marques, 1);
  assert.equal(kai.nonMarques, 1);
  assert.equal(kai.taux, 0);
  assert.equal(kai.tendance, null, 'rien de marqué en octobre : pas de tendance');
  const tom = s.joueurs.find(j => j.compte === 'tom');
  assert.equal(tom.evenements, 0);
  assert.equal(tom.taux, null);
  assert.equal(tom.enPlus, 1);
  const training = s.parType.find(x => x.type === 'training');
  assert.equal(training.taux, 2 / 3);
  assert.equal(s.parType.find(x => x.type === 'scrim').taux, 0, 'un excusé (marqué) et un non marqué ; le venu en plus ne compte pas');
  assert.equal(s.parType.find(x => x.type === 'scrim').evenements, 2);
  assert.deepEqual(s.parPeriode.map(p => p.periode), ['2026-09', '2026-10']);
  assert.equal(s.parPeriode[0].taux, 2 / 3);
  assert.equal(s.global.taux, 2 / 5);
  assert.equal(s.global.enPlus, 1);
  assert.equal(periodeDe(t('2026-10-20T18:00:00Z'), PARIS, 'semaine'), '2026-S43');
  assert.equal(periodeDe(t('2027-01-01T12:00:00Z'), PARIS, 'semaine'), '2026-S53');
  assert.deepEqual(statistiques([]).joueurs, []);
  assert.equal(statistiques([]).global.taux, null);
});

test('séries d’absences et minutes de retard', () => {
  const l = reel => ({ reel });
  assert.deepEqual(seriesAbsences([l('absent'), l('absent'), l('present'), l('excuse'), l('inconnu'), l('absent')]), { serie: 2, serieMax: 2 });
  assert.deepEqual(seriesAbsences([l('absent'), l('absent'), l('absent'), l('retard')]), { serie: 0, serieMax: 3 });
  assert.deepEqual(seriesAbsences([{ reel: 'absent', hors: true }]), { serie: 0, serieMax: 0 });
  assert.equal(lireMinutes(15), 15);
  assert.equal(lireMinutes('5'), 5);
  assert.equal(lireMinutes(null), null);
  assert.equal(lireMinutes(0), null);
  assert.equal(lireMinutes(601), undefined);
  assert.equal(lireMinutes(2.5), undefined);
  assert.equal(lireMinutes('abc'), undefined);
});

test('CSV : guillemets, BOM, CRLF, formules neutralisées', () => {
  assert.equal(champCsv('a"b'), '"a""b"');
  assert.equal(champCsv('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(champCsv(null), '""');
  const t = csv(['A', 'B'], [['1', 'x,y']]);
  assert.ok(t.startsWith('﻿"A","B"\r\n"1","x,y"\r\n'));
});

// ------------------------------------------------------------------ iCal

test('iCal : calendrier valide (CRLF, pliage à 75 octets, échappement, UID stables)', () => {
  assert.equal(echapper('a;b,c\\d\ne'), 'a\\;b\\,c\\\\d\\ne');
  const longue = `DESCRIPTION:${'é'.repeat(80)}`;
  assert.ok(plier(longue).split('\r\n').every(l => new TextEncoder().encode(l).length <= 75));
  assert.equal(plier(longue).replace(/\r\n /g, ''), longue);
  const ics = calendrierIcs({
    nom: 'Faucons, Valorant',
    fuseau: PARIS,
    maintenant: Date.parse('2026-10-20T10:00:00Z'),
    occurrences: occurrences(ENTRAINEMENT, Date.parse('2026-10-19T00:00:00Z'), Date.parse('2026-11-02T00:00:00Z')).map(o => ({
      evenementId: 'e1',
      cle: o.cle,
      debut: o.debut,
      fin: o.fin,
      titre: 'Entraînement ; aim, util',
      description: `Ligne 1\nLigne 2 ${'x'.repeat(120)}`,
      lieu: 'https://discord.gg/abc',
      type: 'training',
    })),
  });
  const evs = verifierIcs(ics);
  assert.equal(evs.length, 4);
  assert.equal(evs[2].DTSTART, '20261027T190000Z');
  assert.equal(evs[0].SUMMARY, '[Entraînement] Entraînement \\; aim\\, util');
  assert.ok(ics.includes('X-WR-CALNAME:Faucons\\, Valorant'));
});

test('migrations : numéros croissants avec des trous acceptés (0001, 0003 puis 0002)', async () => {
  const [m1] = lireMigrations();
  const base = await baseVierge();
  const m3 = { nom: '0003_autre_branche.sql', sql: 'CREATE TABLE essai_trois (id TEXT PRIMARY KEY);' };
  assert.deepEqual(await appliquerMigrations(base, [m1, m3]), ['0001_fondations.sql', '0003_autre_branche.sql']);
  const m2 = lireMigrations().find(m => m.nom.startsWith('0002_'));
  assert.deepEqual(await appliquerMigrations(base, [m1, m2, m3]), [m2.nom]);
});
