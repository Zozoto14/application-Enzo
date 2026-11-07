/**
 * Disponibilités semaine par semaine (migration 0062) : une semaine personnalisée remplace le modèle (créneaux
 * récurrents) pour ses sept jours, les autres semaines gardent le modèle ; copier le modèle ou la semaine
 * précédente, revenir au modèle, appliquer aux N semaines suivantes ; heatmap sur la semaine effective ; bornes de
 * semaine au changement d'heure ; permissions (soi, staff du planning, refus) ; verrou optimiste (409) ; rétention.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intervallesEffectifs, libresDe, purgerDisposSemaines, RETENTION_SEMAINES_DISPOS } from '../noyau/planning/dispos.mjs';
import { tachesPlanifiees } from '../noyau/cron.mjs';
import { banc, teamAvecMembres } from './aide.mjs';

const MEMBRES = {
  max12345: { pseudo: 'Max', role: 'manager' },
  coach123: { pseudo: 'Zed', role: 'coach' },
  ana12345: { pseudo: 'Ana', role: 'analyste' },
  lea12345: { pseudo: 'Léa', role: 'joueur' },
  kai12345: { pseudo: 'Kai', role: 'joueur' },
  tom12345: { pseudo: 'Tom', role: 'remplacant' },
};

async function preparer() {
  const b = await banc(); // horloge : mardi 20 octobre 2026, 10:00 UTC (semaine du lundi 19)
  const A = await teamAvecMembres(b, { nom: 'Team Alpha', membres: MEMBRES });
  const s = A.sessions;
  const api = (chemin, jeton, options = {}) => b.appel(chemin, { jeton, ...options });
  const sem = (qui, jour, jeton, options) => api(`/teams/${A.teamId}/dispos/semaines/${qui}/${jour}`, jeton, options);
  const modele = (jeton, regles, fuseau) => api(`/teams/${A.teamId}/dispos/moi/regles`, jeton, { methode: 'PUT', corps: { regles, ...(fuseau ? { fuseau } : {}) } });
  return { b, A, s, api, sem, modele };
}

const P = 'Europe/Paris';
const regle = (jour, debut, fin, type = 'disponible') => ({ jour, debut, fin, type, fuseau: P });

test('pur : la semaine personnalisée remplace le modèle sur ses sept jours, le modèle reste ailleurs', () => {
  const regles = [regle(1, '19:00', '23:00'), regle(7, '20:00', '22:00')];
  const semaines = [{ semaine: '2026-10-19', regles: [regle(3, '14:00', '16:00')] }];
  const du = Date.parse('2026-10-18T22:00:00Z');
  const au = Date.parse('2026-11-02T00:00:00Z');
  const iv = intervallesEffectifs(regles, semaines, du, au).map(i => new Date(i.s).toISOString()).sort();
  assert.deepEqual(iv, [
    '2026-10-21T12:00:00.000Z', // mercredi 21 (semaine personnalisée), 14:00 Paris (heure d'été)
    '2026-10-26T18:00:00.000Z', // lundi 26 (modèle), 19:00 Paris (heure d'hiver)
    '2026-11-01T19:00:00.000Z', // dimanche 1er novembre (modèle)
  ]);
  // Semaine personnalisée VIDE : indisponible toute la semaine (le modèle ne revient pas).
  const vide = libresDe({ regles, semaines: [{ semaine: '2026-10-19', regles: [] }] }, du, Date.parse('2026-10-26T00:00:00Z'));
  assert.deepEqual(vide, []);
  // Sans semaine personnalisée : le modèle (comportement d'avant).
  assert.equal(libresDe({ regles }, du, Date.parse('2026-10-26T00:00:00Z')).length, 2);
});

test('pur : bornes de semaine au changement d’heure (dimanche 25 octobre, Paris passe à l’heure d’hiver)', () => {
  const regles = [regle(7, '20:00', '22:00'), regle(1, '20:00', '22:00')];
  // Semaine du 19 personnalisée : le dimanche 25 (jour du changement d'heure) est encore dans CETTE semaine.
  const semaines = [{ semaine: '2026-10-19', regles: [regle(7, '18:00', '20:00'), regle(7, '23:00', '01:00')] }];
  const du = Date.parse('2026-10-25T00:00:00Z');
  const au = Date.parse('2026-10-27T00:00:00Z');
  const l = libresDe({ regles, semaines }, du, au).map(i => [new Date(i.s).toISOString(), new Date(i.e).toISOString()]);
  assert.deepEqual(l, [
    ['2026-10-25T17:00:00.000Z', '2026-10-25T19:00:00.000Z'], // 18:00-20:00 Paris, heure d'hiver (UTC+1)
    ['2026-10-25T22:00:00.000Z', '2026-10-26T00:00:00.000Z'], // 23:00-01:00 : passe minuit, reste au dimanche
    ['2026-10-26T19:00:00.000Z', '2026-10-26T21:00:00.000Z'], // lundi 26 : nouvelle semaine, modèle
  ]);
  // Fuseau du membre ≠ UTC : le lundi 26 à 00:30 Paris est encore le dimanche 25 en UTC, mais compte pour la semaine
  // du 26 dans le fuseau du créneau (Paris).
  const nuit = libresDe({ regles: [regle(1, '00:30', '01:30')], semaines: [{ semaine: '2026-10-19', regles: [] }] }, du, au);
  assert.deepEqual(nuit.map(i => new Date(i.s).toISOString()), ['2026-10-25T23:30:00.000Z']);
});

test('API : semaine personnalisée, repli sur le modèle, copier, réinitialiser, appliquer aux N suivantes', async () => {
  const { A, s, api, sem, modele } = await preparer();
  assert.equal((await modele(s.lea12345, [{ jour: 1, debut: '18:00', fin: '23:00' }, { jour: 3, debut: '20:00', fin: '22:00' }])).statut, 200);

  // Lecture : semaine en cours par défaut, pas personnalisée, règles = modèle.
  let r = await api(`/teams/${A.teamId}/dispos/semaines/moi`, s.lea12345);
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.semaine, '2026-10-19');
  assert.equal(r.corps.dimanche, '2026-10-25');
  assert.equal(r.corps.cetteSemaine, '2026-10-19');
  assert.equal(r.corps.personnalisee, false);
  assert.equal(r.corps.version, 0);
  assert.deepEqual(r.corps.regles.map(x => [x.jour, x.debut]), [[1, '18:00'], [3, '20:00']]);
  assert.equal(r.corps.modifiable, true);
  assert.deepEqual(r.corps.membres, [], 'un joueur ne gère pas les autres');

  // N'importe quel jour de la semaine désigne son lundi.
  r = await sem('moi', '2026-10-29', s.lea12345);
  assert.equal(r.corps.semaine, '2026-10-26');

  // Personnaliser la semaine du 26 : seulement le jeudi.
  r = await sem('moi', '2026-10-26', s.lea12345, { methode: 'PUT', corps: { regles: [{ jour: 4, debut: '14:00', fin: '18:00' }], versionAttendue: 0 } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.personnalisee, true);
  assert.equal(r.corps.version, 1);
  assert.equal(r.corps.fuseau, P);
  assert.deepEqual(r.corps.personnalisees, ['2026-10-26']);
  assert.deepEqual(r.corps.precedente, { semaine: '2026-10-19', personnalisee: false, regles: r.corps.modele });
  // Deuxième écriture avec une version périmée : 409, rien d'écrasé.
  const conflit = await sem('moi', '2026-10-26', s.lea12345, { methode: 'PUT', corps: { regles: [], versionAttendue: 0 } });
  assert.equal(conflit.statut, 409);
  assert.equal(conflit.corps.code, 'version');
  assert.equal((await sem('moi', '2026-10-26', s.lea12345)).corps.regles.length, 1);

  // Heatmap : semaine du 19 = modèle (lundi soir) ; semaine du 26 = personnalisée (jeudi après-midi, pas de lundi).
  let carte = await api(`/teams/${A.teamId}/dispos/carte?semaine=2026-10-19`, s.coach123);
  assert.equal(carte.corps.cellules[0][20].n, 1);
  assert.deepEqual(carte.corps.personnalisees, []);
  carte = await api(`/teams/${A.teamId}/dispos/carte?semaine=2026-10-26`, s.coach123);
  assert.equal(carte.corps.cellules[0][20].n, 0, 'le lundi du modèle ne compte plus cette semaine-là');
  assert.equal(carte.corps.cellules[2][20].n, 0, 'le mercredi du modèle non plus');
  assert.equal(carte.corps.cellules[3][15].n, 1, 'jeudi 15:00 : semaine personnalisée');
  assert.deepEqual(carte.corps.personnalisees, ['lea12345']);
  // Semaine du 2 novembre : retour au modèle.
  carte = await api(`/teams/${A.teamId}/dispos/carte?semaine=2026-11-02`, s.coach123);
  assert.equal(carte.corps.cellules[0][20].n, 1);
  assert.equal(carte.corps.cellules[3][15].n, 0);

  // Copier la semaine précédente (celle du 26, personnalisée) sur la semaine du 2 novembre.
  r = await sem('moi', '2026-11-02', s.lea12345, { methode: 'PUT', corps: { copier: 'precedente' } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.deepEqual(r.corps.regles.map(x => [x.jour, x.debut, x.fin]), [[4, '14:00', '18:00']]);
  // Copier le modèle (pour le retoucher) : la semaine devient personnalisée avec les règles du modèle.
  r = await sem('moi', '2026-11-02', s.lea12345, { methode: 'PUT', corps: { copier: 'modele', versionAttendue: 1 } });
  assert.equal(r.corps.version, 2);
  assert.deepEqual(r.corps.regles.map(x => [x.jour, x.debut]), [[1, '18:00'], [3, '20:00']]);
  assert.equal(r.corps.personnalisee, true);
  assert.equal((await sem('moi', '2026-11-02', s.lea12345, { methode: 'PUT', corps: { copier: 'autre' } })).statut, 400);

  // Réinitialiser : retour au modèle (version périmée refusée).
  assert.equal((await sem('moi', '2026-11-02', s.lea12345, { methode: 'DELETE' })).statut, 200);
  r = await sem('moi', '2026-11-02', s.lea12345);
  assert.equal(r.corps.personnalisee, false);
  assert.deepEqual(r.corps.personnalisees, ['2026-10-26']);
  assert.equal((await api(`/teams/${A.teamId}/dispos/semaines/moi/2026-10-26?versionAttendue=7`, s.lea12345, { methode: 'DELETE' })).statut, 409);

  // Appliquer la semaine du 26 aux 3 semaines suivantes (2, 9, 16 novembre).
  r = await api(`/teams/${A.teamId}/dispos/semaines/moi/2026-10-26/appliquer`, s.lea12345, { methode: 'POST', corps: { semaines: 3 } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.deepEqual(r.corps.personnalisees, ['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16']);
  for (const j of ['2026-11-09', '2026-11-16']) assert.deepEqual((await sem('moi', j, s.lea12345)).corps.regles.map(x => x.jour), [4]);
  assert.equal((await sem('moi', '2026-11-23', s.lea12345)).corps.personnalisee, false);
  assert.equal((await api(`/teams/${A.teamId}/dispos/semaines/moi/2026-10-26/appliquer`, s.lea12345, { methode: 'POST', corps: { semaines: 0 } })).statut, 400);
  assert.equal((await api(`/teams/${A.teamId}/dispos/semaines/moi/2026-10-26/appliquer`, s.lea12345, { methode: 'POST', corps: { semaines: 99 } })).statut, 400);

  // Mes dispos (bot Discord /dispo) : semaine en cours effective et semaines personnalisées à venir.
  const mes = await api(`/teams/${A.teamId}/dispos/moi`, s.lea12345);
  assert.equal(mes.corps.semaine.semaine, '2026-10-19');
  assert.equal(mes.corps.semaine.personnalisee, false);
  assert.equal(mes.corps.personnalisees.length, 4);

  // Semaine finie : lecture oui, écriture non.
  r = await sem('moi', '2026-10-12', s.lea12345);
  assert.equal(r.corps.modifiable, false);
  assert.equal((await sem('moi', '2026-10-12', s.lea12345, { methode: 'PUT', corps: { regles: [] } })).corps.code, 'semaine-hors-limites');
  assert.equal((await sem('moi', '2028-01-03', s.lea12345, { methode: 'PUT', corps: { regles: [] } })).statut, 400);
  assert.equal((await sem('moi', '2026-13-01', s.lea12345)).statut, 400);
  // Créneaux invalides : mêmes règles que le modèle.
  assert.equal((await sem('moi', '2026-10-19', s.lea12345, { methode: 'PUT', corps: { regles: [{ jour: 8, debut: '10:00', fin: '11:00' }] } })).statut, 400);
});

test('API : permissions (soi, staff du planning, refus) et semaine personnalisée vide', async () => {
  const { A, s, api, sem, modele } = await preparer();
  await modele(s.lea12345, [{ jour: 1, debut: '18:00', fin: '23:00' }]);
  await modele(s.kai12345, [{ jour: 1, debut: '18:00', fin: '23:00' }]);
  // Un joueur ne modifie pas la semaine d'un autre (403), un remplaçant non plus.
  assert.equal((await sem('lea12345', '2026-10-26', s.kai12345, { methode: 'PUT', corps: { regles: [] } })).statut, 403);
  assert.equal((await sem('lea12345', '2026-10-26', s.kai12345)).statut, 403);
  assert.equal((await sem('lea12345', '2026-10-26', s.tom12345)).statut, 403);
  // L'Analyste lit les disponibilités mais ne gère pas le planning : 403.
  assert.equal((await sem('lea12345', '2026-10-26', s.ana12345, { methode: 'PUT', corps: { regles: [] } })).corps.code, 'dispos-autrui');
  // Le Coach (planning.update) modifie la semaine de Léa : elle est absente toute la semaine du 26.
  let r = await sem('lea12345', '2026-10-26', s.coach123);
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.pseudo, 'Léa');
  assert.equal(r.corps.soi, false);
  assert.ok(r.corps.membres.some(m => m.pseudo === 'Kai'));
  r = await sem('lea12345', '2026-10-26', s.coach123, { methode: 'PUT', corps: { regles: [], versionAttendue: 0 } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.majPar, 'Zed');
  const carte = await api(`/teams/${A.teamId}/dispos/carte?semaine=2026-10-26`, s.coach123);
  assert.deepEqual(carte.corps.cellules[0][20].comptes, ['kai12345']);
  // Léa voit la modification et peut revenir au modèle.
  r = await sem('moi', '2026-10-26', s.lea12345);
  assert.equal(r.corps.personnalisee, true);
  assert.deepEqual(r.corps.regles, []);
  assert.equal((await sem('moi', '2026-10-26', s.lea12345, { methode: 'DELETE', })).corps.personnalisee, false);
  // Compte inconnu ou pas membre : 404.
  assert.equal((await sem('inconnu1', '2026-10-26', s.coach123)).statut, 404);
  assert.equal((await sem('../x', '2026-10-26', s.coach123)).statut, 404);
});

test('rétention : le cron efface les semaines personnalisées finies depuis plus de 8 semaines', async () => {
  const { b, A, s, sem } = await preparer();
  assert.equal(RETENTION_SEMAINES_DISPOS, 8);
  assert.equal((await sem('moi', '2026-10-19', s.lea12345, { methode: 'PUT', corps: { regles: [] } })).statut, 200);
  assert.equal((await sem('moi', '2026-11-16', s.lea12345, { methode: 'PUT', corps: { regles: [] } })).statut, 200);
  // Huit semaines plus tard (lundi 14 décembre) : rien n'est encore assez vieux.
  assert.equal(await purgerDisposSemaines(b.base, { maintenant: Date.parse('2026-12-14T12:00:00Z') }), 0);
  // Le lundi 21 décembre : la semaine du 19 octobre (finie depuis plus de 8 semaines) part, celle du 16 novembre reste.
  const rapport = await tachesPlanifiees(b.base, { maintenant: () => Date.parse('2026-12-21T12:00:00Z'), journal: { error() {} } });
  assert.ok(rapport.find(x => x.tache === 'rétention des semaines de disponibilités')?.ok);
  const restantes = await b.base.tous('SELECT semaine FROM dispo_semaines WHERE team_id = ?', [A.teamId]);
  assert.deepEqual(restantes.map(l => l.semaine), ['2026-11-16']);
});
