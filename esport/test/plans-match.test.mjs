/**
 * Module Plan de match (migration 0083, docs/esport/plans-match.md) : contenu validé (pur), création et édition,
 * droits (voir : plans prêts seulement ; éditer), liens (événement du planning, fiche de scouting, strats, playbook,
 * lineups, résultat), statuts brouillon → prêt → joué, notification « plan prêt » et son lien direct, debrief
 * (événement « Review »), checklist, duplication et modèles, corbeille et purge, temps réel et verrou optimiste,
 * confidentialité (IA externe refusée, annonce Discord sans contenu tactique), RGPD et export de la base, migration.
 *
 * Tourne sur SQLite (défaut) et sur PostgreSQL (ESPORT_TEST_PG, esport/test/pg/lancer.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { baseVierge, lireMigrations } from './base.mjs';
import { ASCENT } from './strats-aide.mjs';
import { appliquerMigrations } from '../noyau/migrations.mjs';
import { EVENEMENTS_DISCORD } from '../noyau/discord/catalogue.mjs';
import { tacheConfidentielle } from '../noyau/ia/confidentialite.mjs';
import { CHAMPS_ECRITURE } from '../noyau/ia/ecriture.mjs';
import { cibleEvenement } from '../noyau/notifications/cibles.mjs';
import { TYPES_PLANS } from '../noyau/plans/bus.mjs';
import { DUREE_CORBEILLE_PLANS_MS, LIMITES_PLAN, lireContenu, purgerCorbeillePlans } from '../noyau/plans/service.mjs';
import { objetDe, sujetsEvenement } from '../noyau/temps-reel/regles.mjs';
import { TABLES } from '../noyau/transfert.mjs';

const MEMBRES = {
  coach123: { pseudo: 'Coach Zed', role: 'coach' },
  max12345: { pseudo: 'Max', role: 'manager' },
  ana12345: { pseudo: 'Ana', role: 'analyste' },
  lea12345: { pseudo: 'Léa', role: 'joueur' },
  kai12345: { pseudo: 'Kai', role: 'joueur' },
  tom12345: { pseudo: 'Tom', role: 'remplacant' },
};

async function preparer(options = {}) {
  const b = await banc(options.banc);
  const A = await teamAvecMembres(b, { membres: MEMBRES, ...options.team });
  const api = (chemin, jeton, o = {}) => b.appel(chemin, { jeton, methode: o.methode, corps: o.corps, entetes: o.entetes });
  const ok = async (chemin, jeton, o = {}) => {
    const r = await api(chemin, jeton, o);
    assert.equal(r.statut, 200, `${o.methode ?? 'GET'} ${chemin} : ${r.statut} ${JSON.stringify(r.corps)}`);
    return r.corps;
  };
  const tic = () => {
    b.horloge.t += 1000;
  };
  return { b, A, s: A.sessions, pm: `/teams/${A.teamId}/plans`, api, ok, tic };
}

const CONTENU = {
  veto: [
    { action: 'ban', camp: 'nous', carte: { cle: 'bind', nom: 'Bind' }, replis: [{ cle: 'split', nom: 'Split' }], note: 'Leur meilleure map' },
    { action: 'pick', camp: 'nous', carte: { cle: 'ascent', nom: 'Ascent' } },
    { action: 'decider', camp: 'eux', carte: null },
  ],
  cartes: [
    {
      carte: { cle: 'ascent', nom: 'Ascent' },
      compo: [
        { membre: 'lea12345', personnage: { cle: 'jett', nom: 'Jett' }, role: 'Entry' },
        { membre: 'kai12345', personnage: { cle: 'omen', nom: 'Omen' }, role: 'IGL' },
        { nom: 'Stand-in', personnage: null, role: 'Flex' },
      ],
      strats: [{ side: 'attaque', type: 'pistol', titre: 'Rush B secret', note: 'Si spawn court' }],
      lineups: [],
      conditions: 'Gagner le contrôle du mid',
      tendances: 'Ils stackent A en éco',
      calls: 'Kai call les rotations',
      notes: '',
    },
  ],
  checklist: [{ id: 'aaaa1111', texte: 'Échauffement fait' }, { id: 'bbbb2222', texte: 'Vocal testé' }],
  notes: 'Rester calmes après le pistol',
};

test('contenu d’un plan (pur) : normalisé, identifiants recréés, limites et formes refusées', () => {
  const c = lireContenu(CONTENU);
  assert.deepEqual(c.veto.map(v => [v.action, v.camp, v.carte?.nom ?? null, v.replis.map(r => r.nom)]), [['ban', 'nous', 'Bind', ['Split']], ['pick', 'nous', 'Ascent', []], ['decider', 'eux', null, []]]);
  assert.ok(c.veto.every(v => /^[a-z0-9]{4,16}$/.test(v.id)));
  assert.equal(new Set(c.veto.map(v => v.id)).size, 3);
  assert.deepEqual(c.checklist.map(e => e.id), ['aaaa1111', 'bbbb2222'], 'identifiants valides gardés');
  assert.deepEqual(c.cartes[0].compo.map(l => [l.membre, l.nom, l.role, l.gadgets]), [['lea12345', '', 'Entry', []], ['kai12345', '', 'IGL', []], [null, 'Stand-in', 'Flex', []]]);
  assert.deepEqual(lireContenu(null), { veto: [], cartes: [], checklist: [], notes: '' });
  const refuse = (brut, code) => assert.throws(() => lireContenu(brut), e => e.code === code, JSON.stringify(brut).slice(0, 80));
  refuse({ veto: [{ action: 'vole', camp: 'nous' }] }, 'veto');
  refuse({ veto: [{ action: 'ban', camp: 'arbitre' }] }, 'veto');
  refuse({ cartes: [{ carte: null }] }, 'cartes');
  refuse({ cartes: [{ carte: { nom: 'Ascent' }, strats: [{ type: 'pistol', titre: '' }] }] }, 'strats');
  refuse({ cartes: [{ carte: { nom: 'Ascent' }, strats: [{ type: 'inconnu', titre: 'x' }] }] }, 'strats');
  refuse({ cartes: [{ carte: { nom: 'Ascent' }, lineups: ['pas-un-uuid'] }] }, 'lineups');
  refuse({ cartes: [{ carte: { nom: 'Ascent' }, compo: [{ membre: 'a b' }] }] }, 'compo');
  refuse({ cartes: Array.from({ length: LIMITES_PLAN.cartes + 1 }, () => ({ carte: { nom: 'M' } })) }, 'cartes');
  refuse({ cartes: Array.from({ length: 9 }, () => ({ carte: { nom: 'M' }, conditions: 'x'.repeat(1500), tendances: 'y'.repeat(1500), calls: 'z'.repeat(1500), notes: 'n'.repeat(1500), strats: Array.from({ length: 30 }, () => ({ type: 'defaut', titre: 't'.repeat(80), note: 'n'.repeat(300) })) })) }, 'plan-trop-gros');
});

test('plans par l’API : création, édition, droits (brouillon caché de la team, prêt visible), liens, filtres', async () => {
  const { b, A, s, pm, api, ok } = await preparer();
  const t = A.teamId;
  // Ce que le plan lie : un match du planning, une fiche de scouting, une strat, une entrée du playbook, un lineup.
  const adversaire = await ok(`/teams/${t}/scouting/adversaires`, s.coach123, { methode: 'POST', corps: { nom: 'Karmine', notes: 'Agressifs en pistol' } });
  await ok(`/teams/${t}/scouting/adversaires/${adversaire.id}/tendances`, s.coach123, { methode: 'POST', corps: { map: 'Ascent', side: 'attaque', notes: 'Exec A rapide', tauxVictoire: 60 } });
  const ev = await ok(`/teams/${t}/planning`, s.coach123, { methode: 'POST', corps: { type: 'match', titre: 'Match vs Karmine', date: '2026-10-25', heureDebut: '21:00', heureFin: '23:00', adversaireId: adversaire.id } });
  const evId = ev.evenement?.id ?? ev.id;
  const occurrence = (await ok(`/teams/${t}/planning?debut=2026-10-20&fin=2026-10-30`, s.coach123)).occurrences.find(o => o.evenementId === evId);
  const strat = await ok(`/teams/${t}/strats`, s.coach123, { methode: 'POST', corps: { titre: 'Exec A split', type: 'execute', carte: ASCENT, side: 'attaque' } });
  const lineup = await ok(`/teams/${t}/lineups`, s.coach123, { methode: 'POST', corps: { titre: 'Smoke Heaven', carte: { cle: 'ascent', nom: 'Ascent' }, personnage: { cle: 'omen', nom: 'Omen' } } });

  // Seuls ceux qui éditent créent ; un joueur lit, sans rien voir tant que c'est un brouillon.
  assert.equal((await api(pm, s.lea12345, { methode: 'POST', corps: { titre: 'Plan' } })).statut, 403);
  assert.equal((await api(pm, s.ana12345, { methode: 'POST', corps: { titre: 'Plan' } })).statut, 403);
  const liens = await ok(`${pm}/liens`, s.coach123);
  assert.ok(liens.evenements.some(e => e.id === evId && e.occurrence === occurrence.cle && e.heure === '21:00' && e.jour === '2026-10-25'));
  assert.deepEqual([liens.adversaires.map(a => a.nom), liens.strats.map(x => x.titre), liens.lineups.map(x => x.titre)], [['Karmine'], ['Exec A split'], ['Smoke Heaven']]);
  assert.ok(liens.membres.some(m => m.compte === 'lea12345' && m.pseudo === 'Léa'));
  assert.equal((await api(`${pm}/liens`, s.lea12345)).statut, 403);

  // Création depuis l'événement : date, heure et adversaire repris ; titre proposé.
  let plan = (await ok(pm, s.coach123, { methode: 'POST', corps: { evenementId: evId, occurrence: occurrence.cle } })).plan;
  assert.deepEqual([plan.titre, plan.statut, plan.dateMatch, plan.evenement.heure, plan.adversaire, plan.estModele], ['Plan contre Karmine', 'brouillon', '2026-10-25', '21:00', { id: adversaire.id, nom: 'Karmine' }, false]);
  assert.deepEqual(plan.moi, { editer: true, debrief: true });
  // Un événement n'a qu'un plan.
  const double = await api(pm, s.coach123, { methode: 'POST', corps: { evenementId: evId, occurrence: occurrence.cle } });
  assert.deepEqual([double.statut, double.corps.code], [409, 'plan-existe']);

  const contenu = { ...CONTENU, cartes: [{ ...CONTENU.cartes[0], strats: [{ side: 'attaque', type: 'execution', strat: strat.id, note: 'Round 3' }, ...CONTENU.cartes[0].strats], lineups: [lineup.id] }] };
  plan = (await ok(`${pm}/${plan.id}`, s.coach123, { methode: 'PATCH', corps: { format: 'bo3', contenu } })).plan;
  const carte = plan.contenu.cartes[0];
  assert.deepEqual(carte.strats.map(x => [x.type, x.titre, x.ouvrable]), [['execution', 'Exec A split', true], ['pistol', 'Rush B secret', false]], 'titre de la strat recopié');
  assert.deepEqual(carte.lineups.map(l => [l.titre, l.personnage, l.ouvrable]), [['Smoke Heaven', 'Omen', true]]);
  assert.deepEqual(carte.compo.map(l => [l.pseudo, l.moi]), [['Léa', false], ['Kai', false], [null, false]]);
  assert.deepEqual([plan.format, plan.cartes, plan.checklist], ['bo3', ['Ascent'], { faits: 0, total: 2 }]);
  // Fiche de scouting en lecture seule, pour qui a le droit de la voir.
  assert.deepEqual(plan.scouting, { nom: 'Karmine', notes: 'Agressifs en pistol', tendances: [{ map: 'Ascent', side: 'attaque', notes: 'Exec A rapide', tauxVictoire: 60 }] });

  // Références inconnues refusées : strat d'une autre team, lineup inexistant, joueur hors de la team.
  const idInconnu = '00000000-0000-4000-8000-000000000000';
  for (const [c, code] of [
    [{ cartes: [{ carte: { nom: 'Ascent' }, strats: [{ type: 'defaut', strat: idInconnu }] }] }, 'strats'],
    [{ cartes: [{ carte: { nom: 'Ascent' }, strats: [{ type: 'defaut', playbook: idInconnu }] }] }, 'strats'],
    [{ cartes: [{ carte: { nom: 'Ascent' }, lineups: [idInconnu] }] }, 'lineups'],
    [{ cartes: [{ carte: { nom: 'Ascent' }, compo: [{ membre: 'zoe12345' }] }] }, 'compo'],
  ]) {
    const r = await api(`${pm}/${plan.id}`, s.coach123, { methode: 'PATCH', corps: { contenu: c } });
    assert.deepEqual([r.statut, r.corps.code], [400, code], JSON.stringify(r.corps));
  }
  for (const [corps, code] of [[{ titre: 'x' }, 'titre'], [{ format: 'bo7' }, 'format'], [{ statut: 'archive' }, 'statut'], [{ evenementId: idInconnu }, 'evenement'], [{ adversaireId: idInconnu }, 'adversaire'], [{ resultatId: idInconnu }, 'resultat']]) {
    const r = await api(`${pm}/${plan.id}`, s.coach123, { methode: 'PATCH', corps });
    assert.deepEqual([r.statut, r.corps.code], [400, code], JSON.stringify(corps));
  }

  // Brouillon : invisible de la team (liste, détail, bouton de l'événement, accueil).
  assert.deepEqual((await ok(pm, s.lea12345)).plans, []);
  assert.equal((await api(`${pm}/${plan.id}`, s.lea12345)).statut, 404);
  assert.deepEqual(await ok(`${pm}/evenement?evenement=${evId}&occurrence=${encodeURIComponent(occurrence.cle)}`, s.lea12345), { plan: null, droits: { editer: false } });
  assert.equal((await ok(`${pm}/prochain`, s.lea12345)).plan, null);
  assert.equal((await ok(`${pm}/prochain`, s.coach123)).plan.id, plan.id);
  // Prêt : la joueuse le lit, se voit dans la composition, mais ne modifie rien ; la fiche de scouting reste au staff.
  await ok(`${pm}/${plan.id}`, s.coach123, { methode: 'PATCH', corps: { statut: 'pret' } });
  const vu = (await ok(`${pm}/${plan.id}`, s.lea12345)).plan;
  assert.deepEqual(vu.contenu.cartes[0].compo.map(l => l.moi), [true, false, false]);
  assert.deepEqual([vu.statut, vu.moi, vu.scouting], ['pret', { editer: false, debrief: false }, null]);
  assert.equal((await ok(`${pm}/evenement?evenement=${evId}&occurrence=${encodeURIComponent(occurrence.cle)}`, s.lea12345)).plan.id, plan.id);
  assert.equal((await ok(`${pm}/prochain`, s.tom12345)).plan.id, plan.id);
  for (const [chemin, o] of [[`${pm}/${plan.id}`, { methode: 'PATCH', corps: { titre: 'Piraté' } }], [`${pm}/${plan.id}/coches`, { methode: 'PUT', corps: { coches: ['aaaa1111'] } }], [`${pm}/${plan.id}/dupliquer`, { methode: 'POST', corps: {} }], [`${pm}/${plan.id}`, { methode: 'DELETE' }], [`${pm}/corbeille`, {}]]) {
    assert.equal((await api(chemin, s.lea12345, o)).statut, 403, chemin);
  }
  // Filtres de la liste (staff).
  await ok(pm, s.coach123, { methode: 'POST', corps: { titre: 'Scrim du jeudi', date: '2026-10-22', adversaireNom: 'Mandatory' } });
  assert.deepEqual((await ok(`${pm}?statut=pret`, s.coach123)).plans.map(p => p.titre), ['Plan contre Karmine']);
  assert.deepEqual((await ok(`${pm}?adversaire=${adversaire.id}`, s.coach123)).plans.length, 1);
  assert.equal((await ok(pm, s.coach123)).plans.length, 2);
  // Une autre team ne voit rien ; module désactivé : 404.
  const B = await teamAvecMembres(b, { nom: 'Team Beta', membres: { bob12345: { pseudo: 'Bob', role: 'coach' } } });
  assert.equal((await api(`/teams/${B.teamId}/plans/${plan.id}`, B.sessions.bob12345)).statut, 404);
  assert.equal((await api(pm, B.sessions.bob12345)).statut, 404);
  await ok(`/teams/${t}/modules`, s.fondateur, { methode: 'PUT', corps: { modules: { plans_match: false } } });
  assert.equal((await api(pm, s.coach123)).statut, 404);
});

test('prêt → joué : notification de la team avec lien direct, checklist, résultat lié, debrief « Review », journal', async () => {
  const { b, A, s, pm, api, ok, tic } = await preparer();
  const t = A.teamId;
  let plan = (await ok(pm, s.coach123, { methode: 'POST', corps: { titre: 'Finale', adversaireNom: 'Vitality', date: '2026-10-28', contenu: CONTENU } })).plan;
  assert.equal(plan.pretLe, null);
  tic();
  plan = (await ok(`${pm}/${plan.id}`, s.coach123, { methode: 'PATCH', corps: { statut: 'pret' } })).plan;
  assert.ok(plan.pretLe);
  tic();
  tic();
  // Toute la team qui lit les plans est prévenue, sauf celui qui l'a publié.
  const recue = async qui => (await ok('/notifications/centre', s[qui])).liste.find(x => x.type === 'plan-pret');
  for (const qui of ['lea12345', 'kai12345', 'tom12345', 'ana12345', 'max12345', 'fondateur']) {
    const n = await recue(qui);
    assert.ok(n, qui);
    assert.deepEqual(n.cible, { v: 1, g: 'plan_match', plan: plan.id, team: t });
    assert.deepEqual(Object.keys(n.charge ?? {}).sort(), ['adversaire', 'date', 'plan', 'titre'], 'rien de tactique dans la notification');
  }
  assert.equal(await recue('coach123'), undefined);
  const n = await recue('lea12345');
  assert.deepEqual(await ok('/notifications/cible', s.lea12345, { methode: 'POST', corps: { cible: n.cible } }), { etat: 'ok', cible: n.cible });
  // Réenregistrer un plan déjà prêt ne renvoie pas de notification.
  await ok(`${pm}/${plan.id}`, s.coach123, { methode: 'PATCH', corps: { titre: 'Finale (v2)' } });
  tic();
  tic();
  assert.equal((await ok('/notifications/centre', s.lea12345)).liste.filter(x => x.type === 'plan-pret').length, 1);
  // Checklist : cases gardées avec le plan ; une case inconnue est ignorée.
  plan = (await ok(`${pm}/${plan.id}/coches`, s.coach123, { methode: 'PUT', corps: { coches: ['aaaa1111', 'zzzz9999'] } })).plan;
  assert.deepEqual([plan.coches, plan.checklist], [['aaaa1111'], { faits: 1, total: 2 }]);
  assert.deepEqual((await ok(`${pm}/${plan.id}`, s.lea12345)).plan.coches, ['aaaa1111']);
  tic();
  // Joué : résultat lié, debrief créé au planning (type « review »), une seule fois.
  plan = (await ok(`${pm}/${plan.id}`, s.coach123, { methode: 'PATCH', corps: { statut: 'joue' } })).plan;
  const deb = (await ok(`${pm}/${plan.id}/debrief`, s.coach123, { methode: 'POST', corps: { date: '2026-10-29', heureDebut: '20:00', heureFin: '21:00' } })).plan.debrief;
  assert.ok(deb?.id);
  const evDebrief = await b.base.premier('SELECT type, titre FROM planning_evenements WHERE id = ?', [deb.id]);
  assert.deepEqual([evDebrief.type, evDebrief.titre], ['review', 'Debrief : Vitality']);
  assert.equal((await api(`${pm}/${plan.id}/debrief`, s.coach123, { methode: 'POST', corps: { date: '2026-10-30', heureDebut: '20:00', heureFin: '21:00' } })).statut, 409);
  assert.equal((await api(`${pm}/${plan.id}/debrief`, s.lea12345, { methode: 'POST', corps: { date: '2026-10-30', heureDebut: '20:00', heureFin: '21:00' } })).statut, 403);
  // Journal : le staff voit tout, la team seulement « prêt » et « joué ».
  const actions = async qui => (await ok(`/teams/${t}/journal?module=plans_match`, s[qui])).entrees.map(e => e.action).reverse();
  assert.deepEqual(await actions('fondateur'), ['plan_match.created', 'plan_match.ready', 'plan_match.updated', 'plan_match.played']);
  // Lien direct : supprimé → « n'existe plus ».
  await ok(`${pm}/${plan.id}`, s.coach123, { methode: 'DELETE' });
  assert.deepEqual(await ok('/notifications/cible', s.lea12345, { methode: 'POST', corps: { cible: n.cible } }), { etat: 'supprime' });
});

test('duplication, modèles, corbeille de 30 jours et purge', async () => {
  const { b, s, pm, api, ok } = await preparer();
  const plan = (await ok(pm, s.coach123, { methode: 'POST', corps: { titre: 'Plan BO3', adversaireNom: 'Karmine', date: '2026-10-25', format: 'bo3', contenu: CONTENU } })).plan;
  await ok(`${pm}/${plan.id}/coches`, s.coach123, { methode: 'PUT', corps: { coches: ['aaaa1111'] } });
  // Copie : brouillon, même contenu, cases remises à zéro, sans date.
  const copie = (await ok(`${pm}/${plan.id}/dupliquer`, s.coach123, { methode: 'POST', corps: { titre: 'Plan BO3 (copie)' } })).plan;
  assert.deepEqual([copie.titre, copie.statut, copie.format, copie.adversaire.nom, copie.dateMatch, copie.coches, copie.contenu.cartes[0].conditions], ['Plan BO3 (copie)', 'brouillon', 'bo3', 'Karmine', null, [], 'Gagner le contrôle du mid']);
  // Modèle : sans adversaire, rangé à part, jamais « prêt », invisible de la team ; un plan en part.
  const modele = (await ok(`${pm}/${plan.id}/dupliquer`, s.coach123, { methode: 'POST', corps: { modele: true, titre: 'Modèle BO3' } })).plan;
  assert.deepEqual([modele.estModele, modele.adversaire], [true, null]);
  assert.equal((await ok(`${pm}/${modele.id}`, s.coach123, { methode: 'PATCH', corps: { statut: 'pret' } })).plan.statut, 'brouillon');
  const liste = await ok(pm, s.coach123);
  assert.deepEqual([liste.plans.map(p => p.titre).sort(), liste.modeles.map(p => p.titre)], [['Plan BO3', 'Plan BO3 (copie)'], ['Modèle BO3']]);
  assert.deepEqual((await ok(pm, s.lea12345)).modeles, []);
  const depuis = (await ok(pm, s.coach123, { methode: 'POST', corps: { depuis: modele.id, titre: 'Plan contre Vitality', adversaireNom: 'Vitality' } })).plan;
  assert.deepEqual([depuis.estModele, depuis.format, depuis.adversaire.nom, depuis.contenu.veto.length, depuis.contenu.checklist.length], [false, 'bo3', 'Vitality', 3, 2]);
  // Corbeille : suppression douce, restauration, purge après 30 jours.
  await ok(`${pm}/${copie.id}`, s.coach123, { methode: 'DELETE' });
  assert.equal((await api(`${pm}/${copie.id}`, s.coach123)).statut, 404);
  assert.deepEqual((await ok(`${pm}/corbeille`, s.coach123)).plans.map(p => [p.titre, p.supprimePar.pseudo]), [['Plan BO3 (copie)', 'Coach Zed']]);
  assert.equal((await ok(`${pm}/${copie.id}/restaurer`, s.max12345, { methode: 'POST' })).plan.titre, 'Plan BO3 (copie)');
  await ok(`${pm}/${copie.id}`, s.coach123, { methode: 'DELETE' });
  assert.equal(await purgerCorbeillePlans(b.base, { maintenant: b.horloge.t + DUREE_CORBEILLE_PLANS_MS - 1000 }), 0);
  assert.equal(await purgerCorbeillePlans(b.base, { maintenant: b.horloge.t + DUREE_CORBEILLE_PLANS_MS + 1000 }), 1);
  assert.equal(await b.base.premier('SELECT id FROM plans_match WHERE id = ?', [copie.id]) ?? null, null);
});

test('temps réel et verrou optimiste : sujet du module, plan sondé, enregistrement périmé refusé (409)', async () => {
  assert.deepEqual(sujetsEvenement({ type: 'plan_match.ready', team_id: 't1' }), [{ sujet: 'team:t1:plans_match', invalider: false }]);
  const chemin1 = '/teams/t1/plans/11111111-1111-4111-8111-111111111111';
  assert.deepEqual(objetDe(chemin1), { sujet: 'team:t1:plans_match', cle: 'plan_match:11111111-1111-4111-8111-111111111111', sonde: chemin1, objetPublic: false, exact: true });
  for (const reserve of ['prochain', 'liens', 'evenement', 'corbeille']) assert.equal(objetDe(`/teams/t1/plans/${reserve}`), null, reserve);
  const { A, s, pm, api, ok, tic } = await preparer();
  const plan = (await ok(pm, s.coach123, { methode: 'POST', corps: { titre: 'Plan' } })).plan;
  const chemin = `/teams/${A.teamId}/plans/${plan.id}`;
  const lue = (await ok(`/temps-reel/version?chemin=${encodeURIComponent(chemin)}`, s.coach123)).version;
  tic();
  await ok(chemin, s.max12345, { methode: 'PATCH', corps: { titre: 'Plan de Max' } });
  const r = await api(chemin, s.coach123, { methode: 'PATCH', corps: { titre: 'Plan du Coach' }, entetes: { 'X-Version-Lue': String(lue) } });
  assert.deepEqual([r.statut, r.corps.code], [409, 'conflit-version'], JSON.stringify(r.corps));
  assert.equal((await ok(chemin, s.coach123)).plan.titre, 'Plan de Max');
});

test('confidentialité : tâche IA confidentielle, assistant d’écriture refusé, annonce Discord sans contenu tactique', async () => {
  for (const t of ['plans-match', 'plan-match', 'plan-de-match', 'plans_match', 'plans-match.notes']) assert.equal(tacheConfidentielle(t), 'strats', t);
  assert.ok(!Object.keys(CHAMPS_ECRITURE).some(c => /plan/i.test(c) && !/planning/i.test(c)), 'aucun champ de plan de match permis à l’assistant d’écriture');
  // Discord : un seul type de message, sur « prêt », désactivé par défaut, sans variable tactique.
  const defs = EVENEMENTS_DISCORD.filter(d => d.types.some(t => t.startsWith('plan_match.')));
  assert.deepEqual(defs.map(d => [d.cle, d.types, d.defaut]), [['plan_match_ready', ['plan_match.ready'], false]]);
  assert.deepEqual(Object.keys(defs[0].variables).filter(v => !['team', 'lien', 'mention'].includes(v)).sort(), ['contre', 'pourLe']);
  const corpsEnvoyes = [];
  const { b, A, s, pm, api, ok } = await preparer({ banc: { fetchDiscord: async (u, o) => (corpsEnvoyes.push(String(o?.body ?? '')), new Response(null, { status: 204 })) } });
  const w = await api(`/teams/${A.teamId}/discord/webhook`, s.fondateur, { methode: 'PUT', corps: { url: 'https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcd' } });
  assert.equal(w.statut, 200, JSON.stringify(w.corps));
  const file = () => b.base.tous('SELECT cle, modele, variables FROM discord_file WHERE team_id = ?', [A.teamId]);
  // Par défaut : rien ne part.
  let plan = (await ok(pm, s.coach123, { methode: 'POST', corps: { titre: 'Rush B surprise', adversaireNom: 'Karmine', date: '2026-10-25', contenu: CONTENU } })).plan;
  await ok(`${pm}/${plan.id}`, s.coach123, { methode: 'PATCH', corps: { statut: 'pret' } });
  assert.deepEqual((await file()).filter(l => l.cle === 'plan_match_ready'), []);
  // Tous les messages activés : seul « prêt » annonce, et le message ne porte que l'adversaire et la date.
  for (const d of EVENEMENTS_DISCORD) await api(`/teams/${A.teamId}/discord/parametres/${d.cle}`, s.fondateur, { methode: 'PUT', corps: { actif: true } });
  await b.base.executer('DELETE FROM discord_file', []);
  corpsEnvoyes.length = 0;
  await ok(`${pm}/${plan.id}`, s.coach123, { methode: 'PATCH', corps: { statut: 'brouillon' } });
  plan = (await ok(`${pm}/${plan.id}`, s.coach123, { methode: 'PATCH', corps: { statut: 'pret', contenu: CONTENU } })).plan;
  await ok(`${pm}/${plan.id}`, s.coach123, { methode: 'PATCH', corps: { statut: 'joue' } });
  const lignes = await file();
  assert.deepEqual(lignes.map(l => l.cle), ['plan_match_ready'], JSON.stringify(lignes));
  assert.ok(corpsEnvoyes.length >= 1, 'le message est parti');
  const tout = `${JSON.stringify(lignes)} ${corpsEnvoyes.join(' ')}`;
  assert.match(tout, /Karmine/);
  for (const secret of ['Rush B', 'Ascent', 'Bind', 'Jett', 'Entry', 'IGL', 'contrôle du mid', 'stackent', 'rotations', 'Échauffement', 'pistol']) assert.ok(!tout.includes(secret), `« ${secret} » ne doit pas partir sur Discord`);
  // Assistant d'écriture : un champ de plan est refusé (403) avant tout appel à une IA.
  const r = await api('/ia/ecriture', s.fondateur, { methode: 'POST', corps: { mode: 'corriger', texte: 'On rush B', champ: 'plans-match.notes' } });
  assert.deepEqual([r.statut, r.corps.code], [403, 'ecriture-confidentielle'], JSON.stringify(r.corps));
});

test('RGPD et export de la base : export du compte, suppression (anonymisation, composition), table exportée', async () => {
  const { b, s, pm, api, ok } = await preparer();
  const plan = (await ok(pm, s.coach123, { methode: 'POST', corps: { titre: 'Plan RGPD', adversaireNom: 'Karmine', contenu: CONTENU } })).plan;
  const duCoach = await ok('/moi/export', s.coach123);
  assert.deepEqual(duCoach.plansMatch.map(p => [p.team, p.titre, p.statut, p.adversaire]), [['Team Alpha', 'Plan RGPD', 'brouillon', 'Karmine']]);
  const deLea = await ok('/moi/export', s.lea12345);
  assert.deepEqual([deLea.plansMatch, deLea.plansMatchRoles], [[], [{ team: 'Team Alpha', plan: 'Plan RGPD', carte: 'Ascent', personnage: 'Jett', role: 'Entry' }]]);
  // Suppression des comptes : le plan reste à la team, sans auteur ; la joueuse sort de la composition.
  assert.equal((await api('/moi', s.lea12345, { methode: 'DELETE' })).statut, 200);
  const reste = (await ok(`${pm}/${plan.id}`, s.max12345)).plan;
  assert.deepEqual(reste.contenu.cartes[0].compo.map(l => l.membre), [null, 'kai12345', null]);
  assert.ok(!JSON.stringify((await b.base.premier('SELECT contenu FROM plans_match WHERE id = ?', [plan.id])).contenu).includes('lea12345'));
  assert.equal((await api('/moi', s.coach123, { methode: 'DELETE' })).statut, 200);
  assert.deepEqual((await ok(`${pm}/${plan.id}`, s.max12345)).plan.creePar, { compte: null, pseudo: null });
  assert.ok(TABLES.map(([t]) => t).includes('plans_match'));
  assert.equal((await ok('/admin/export', s.fondateur)).tables.plans_match.length, 1);
});

test('événements et cibles : types rangés, cible d’un événement', () => {
  assert.deepEqual(TYPES_PLANS, ['plan_match.created', 'plan_match.updated', 'plan_match.ready', 'plan_match.played', 'plan_match.deleted', 'plan_match.restored']);
  assert.deepEqual(cibleEvenement({ type: 'plan_match.ready', team_id: 't1', entite_type: 'plan_match', entite_id: 'p1', charge: '{}' }), { v: 1, g: 'plan_match', plan: 'p1', team: 't1' });
  assert.equal(cibleEvenement({ type: 'plan_match.deleted', team_id: 't1', entite_type: 'plan_match', entite_id: 'p1', charge: '{}' }), null);
});

test('migration 0083 : module activé pour les teams qui ont les strats ou le planning, permissions des rôles système', async () => {
  const base = await baseVierge();
  const migrations = lireMigrations();
  await appliquerMigrations(base, migrations.filter(m => m.nom < '0083'));
  const d = '2026-01-01T00:00:00.000Z';
  for (const [id, module, actif] of [['t-strats', 'strat_editor', 1], ['t-planning', 'planning', 1], ['t-sans', 'planning', 0]]) {
    await base.executer('INSERT INTO teams (id, nom, slug, jeu, cree_par, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, id, id, 'valorant', 'principal', d, d]);
    await base.executer("INSERT INTO team_modules (team_id, module, active, config, maj_le) VALUES (?, ?, ?, '{}', ?)", [id, module, actif, d]);
  }
  for (const cle of ['manager', 'coach', 'analyste', 'joueur', 'remplacant']) {
    await base.executer('INSERT INTO roles (id, team_id, cle_systeme, nom, couleur, systeme, position, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)', [cle, 't-strats', cle, cle, '#000000', d, d]);
  }
  await appliquerMigrations(base, migrations);
  const actif = async id => Number((await base.premier("SELECT active FROM team_modules WHERE team_id = ? AND module = 'plans_match'", [id]))?.active ?? 0);
  assert.deepEqual([await actif('t-strats'), await actif('t-planning'), await actif('t-sans')], [1, 1, 0]);
  const perms = async role => (await base.tous("SELECT permission FROM role_permissions WHERE role_id = ? AND permission LIKE 'plans.%' ORDER BY permission", [role])).map(l => l.permission);
  assert.deepEqual([await perms('manager'), await perms('coach'), await perms('analyste'), await perms('joueur'), await perms('remplacant')], [['plans.editer', 'plans.voir'], ['plans.editer', 'plans.voir'], ['plans.voir'], ['plans.voir'], ['plans.voir']]);
});
