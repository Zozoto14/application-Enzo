/**
 * Corbeille des strats (migration 0028) : suppression à droits contrôlés (Fondateur, Coach, auteur), suppression
 * multiple, corbeille de 30 jours, restauration (et ses limites), entrées du playbook liées, purge par le cron.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { ASCENT, docExemple, jpegDataUrl } from './strats-aide.mjs';
import { tachesPlanifiees } from '../noyau/cron.mjs';
import { purgerCorbeilleStrats } from '../noyau/strats/service.mjs';

const JOUR = 86_400_000;
const MEMBRES = {
  coach123: { pseudo: 'Coach Zed', role: 'coach' },
  ana12345: { pseudo: 'Ana', role: 'analyste' },
  mana1234: { pseudo: 'Manon', role: 'manager' },
  lea12345: { pseudo: 'Léa', role: 'joueur' },
};

async function preparer() {
  const b = await banc();
  const team = await teamAvecMembres(b, { membres: MEMBRES });
  const url = `/teams/${team.teamId}/strats`;
  const creer = async (jeton, corps = {}) => (await b.appel(url, { methode: 'POST', jeton, corps: { titre: 'Exec A', type: 'execute', carte: ASCENT, side: 'attaque', ...corps } })).corps;
  return { b, ...team, url, creer, pb: `/teams/${team.teamId}/playbook` };
}

test('le Fondateur et le Coach peuvent supprimer (moi.supprimer), l’Analyste seulement la sienne, le Joueur jamais', async () => {
  const { b, sessions, url, creer } = await preparer();
  const duCoach = await creer(sessions.coach123, { titre: 'Du Coach' });
  const deAna = await creer(sessions.ana12345, { titre: 'De Ana' });
  const moi = async (jeton, id) => (await b.appel(`${url}/${id}`, { jeton })).corps.moi.supprimer;
  assert.equal(await moi(sessions.fondateur, duCoach.id), true, 'Fondateur : toutes les permissions');
  assert.equal(await moi(sessions.coach123, deAna.id), true);
  assert.equal(await moi(sessions.ana12345, deAna.id), true);
  assert.equal(await moi(sessions.ana12345, duCoach.id), false);
  assert.equal(await moi(sessions.lea12345, deAna.id), false);
  assert.equal((await b.appel(`${url}/${duCoach.id}`, { methode: 'DELETE', jeton: sessions.lea12345 })).statut, 403);
  assert.equal((await b.appel(`${url}/${duCoach.id}`, { methode: 'DELETE', jeton: sessions.fondateur })).statut, 200);
});

test('suppression multiple : les strats permises partent, les autres sont listées ; corbeille puis restauration', async () => {
  const { b, sessions, url, creer } = await preparer();
  const a = await creer(sessions.ana12345, { titre: 'Ana 1' });
  const a2 = await creer(sessions.ana12345, { titre: 'Ana 2' });
  const c = await creer(sessions.coach123, { titre: 'Coach 1' });
  const lot = await b.appel(`${url}/supprimer`, { methode: 'POST', jeton: sessions.ana12345, corps: { ids: [a.id, a2.id, c.id, a.id, '0f0f0f0f-0f0f-0f0f-0f0f-0f0f0f0f0f0f'] } });
  assert.equal(lot.statut, 200, JSON.stringify(lot.corps));
  assert.deepEqual(lot.corps.supprimees, [a.id, a2.id]);
  assert.deepEqual(lot.corps.echecs.map(e => [e.id, e.code]), [[c.id, 'permission'], ['0f0f0f0f-0f0f-0f0f-0f0f-0f0f0f0f0f0f', 'strat-introuvable']]);
  assert.deepEqual((await b.appel(url, { jeton: sessions.lea12345 })).corps.strats.map(s => s.titre), ['Coach 1']);
  assert.equal((await b.appel(`${url}/supprimer`, { methode: 'POST', jeton: sessions.ana12345, corps: { ids: [] } })).statut, 400);
  assert.equal((await b.appel(`${url}/supprimer`, { methode: 'POST', jeton: sessions.lea12345, corps: { ids: [c.id] } })).corps.echecs[0].code, 'permission');
  // Corbeille : chacun voit ce qu’il peut restaurer ; le Joueur rien.
  const corbeille = async jeton => (await b.appel(`${url}/corbeille`, { jeton })).corps.strats;
  assert.deepEqual((await corbeille(sessions.ana12345)).map(s => s.titre).sort(), ['Ana 1', 'Ana 2']);
  assert.deepEqual((await corbeille(sessions.coach123)).map(s => s.titre).sort(), ['Ana 1', 'Ana 2']);
  assert.deepEqual(await corbeille(sessions.lea12345), []);
  const ligne = (await corbeille(sessions.coach123))[0];
  assert.equal(ligne.supprimePar.pseudo, 'Ana');
  assert.equal(ligne.expireLe, new Date(Date.parse(ligne.supprimeLe) + 30 * JOUR).toISOString());
  // Restauration : refusée au Joueur et à l’Analyste pour une strat qui n’est pas la sienne ; permise à l’auteur.
  assert.equal((await b.appel(`${url}/${a.id}/restaurer`, { methode: 'POST', jeton: sessions.lea12345 })).statut, 403);
  const r = await b.appel(`${url}/${a.id}/restaurer`, { methode: 'POST', jeton: sessions.ana12345 });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.titre, 'Ana 1');
  assert.ok((await b.appel(`${url}/${a.id}`, { jeton: sessions.lea12345 })).corps.donnees);
  assert.equal((await b.appel(`${url}/${a.id}/restaurer`, { methode: 'POST', jeton: sessions.ana12345 })).statut, 404, 'déjà restaurée');
  assert.equal((await b.appel(`${url}/${a2.id}/restaurer`, { methode: 'POST', jeton: sessions.coach123 })).statut, 200);
  // Une strat du Coach supprimée par lui : l’Analyste ne la restaure pas.
  await b.appel(`${url}/${c.id}`, { methode: 'DELETE', jeton: sessions.coach123 });
  assert.equal((await b.appel(`${url}/${c.id}/restaurer`, { methode: 'POST', jeton: sessions.ana12345 })).statut, 403);
  // Journal : suppression et restauration.
  const actions = (await b.appel(`/teams/${(await b.base.premier('SELECT team_id FROM strats WHERE id = ?', [a.id])).team_id}/journal`, { jeton: sessions.fondateur })).corps;
  const liste = JSON.stringify(actions);
  assert.ok(liste.includes('strat.deleted') && liste.includes('strat.restored'));
});

test('hors délai : une strat à la corbeille depuis plus de 30 jours n’est plus listée ni restaurable', async () => {
  const { b, sessions, url, creer } = await preparer();
  const s = await creer(sessions.coach123);
  await b.appel(`${url}/${s.id}`, { methode: 'DELETE', jeton: sessions.coach123 });
  const supprimeLe = async jours => b.base.executer('UPDATE strats SET supprime_le = ? WHERE id = ?', [new Date(b.horloge.t - jours * JOUR).toISOString(), s.id]);
  await supprimeLe(29);
  assert.equal((await b.appel(`${url}/corbeille`, { jeton: sessions.coach123 })).corps.strats.length, 1);
  await supprimeLe(31);
  assert.equal((await b.appel(`${url}/corbeille`, { jeton: sessions.coach123 })).corps.strats.length, 0);
  assert.equal((await b.appel(`${url}/${s.id}/restaurer`, { methode: 'POST', jeton: sessions.coach123 })).statut, 404);
});

test('playbook : l’entrée garde sa strat à la corbeille et la retrouve à la restauration ; retrait d’une entrée annulable', async () => {
  const { b, sessions, url, creer, pb } = await preparer();
  const s = await creer(sessions.coach123, { titre: 'Exec liée' });
  await b.appel(`${url}/${s.id}`, { methode: 'PUT', jeton: sessions.coach123, corps: { revision: 1, donnees: docExemple(), miniature: jpegDataUrl() } });
  const e = (await b.appel(pb, { methode: 'POST', jeton: sessions.coach123, corps: { stratId: s.id } })).corps;
  assert.equal(e.strat.id, s.id);
  await b.appel(`${url}/${s.id}`, { methode: 'DELETE', jeton: sessions.coach123 });
  let entrees = (await b.appel(pb, { jeton: sessions.lea12345 })).corps.entrees;
  assert.equal(entrees.length, 1);
  assert.equal(entrees[0].strat, null, 'sans sa strat tant qu’elle est à la corbeille');
  await b.appel(`${url}/${s.id}/restaurer`, { methode: 'POST', jeton: sessions.coach123 });
  entrees = (await b.appel(pb, { jeton: sessions.lea12345 })).corps.entrees;
  assert.equal(entrees[0].strat.id, s.id, 'lien retrouvé');
  assert.ok(entrees[0].miniature);
  // Retrait d’une entrée puis « Annuler ».
  assert.equal((await b.appel(`${pb}/${e.id}`, { methode: 'DELETE', jeton: sessions.coach123 })).statut, 200);
  assert.equal((await b.appel(pb, { jeton: sessions.lea12345 })).corps.entrees.length, 0);
  assert.equal((await b.appel(`${pb}/${e.id}/restaurer`, { methode: 'POST', jeton: sessions.lea12345 })).statut, 403);
  assert.equal((await b.appel(`${pb}/${e.id}/restaurer`, { methode: 'POST', jeton: sessions.coach123 })).statut, 200);
  assert.equal((await b.appel(pb, { jeton: sessions.lea12345 })).corps.entrees.length, 1);
  assert.equal((await b.appel(`${pb}/${e.id}/restaurer`, { methode: 'POST', jeton: sessions.coach123 })).statut, 404, 'déjà restaurée');
});

test('purge (cron) à 30 jours : strat, historique, liens, miniature effacés ; l’entrée du playbook reste sans strat', async () => {
  const { b, sessions, url, creer, pb } = await preparer();
  const s = await creer(sessions.coach123, { titre: 'À purger' });
  const garde = await creer(sessions.coach123, { titre: 'À garder' });
  await b.appel(`${url}/${s.id}`, { methode: 'PUT', jeton: sessions.coach123, corps: { revision: 1, donnees: docExemple(), miniature: jpegDataUrl() } });
  await b.appel(`${url}/${s.id}/partages`, { methode: 'POST', jeton: sessions.coach123, corps: {} });
  const copie = (await b.appel(`${url}/${s.id}/dupliquer`, { methode: 'POST', jeton: sessions.coach123, corps: {} })).corps;
  const e = (await b.appel(pb, { methode: 'POST', jeton: sessions.coach123, corps: { stratId: s.id } })).corps;
  const cle = (await b.base.premier("SELECT cle_stockage FROM fichiers WHERE entite_type = 'strat' AND entite_id = ?", [s.id])).cle_stockage;
  assert.ok(await b.stockage.lire(cle));
  await b.appel(`${url}/${s.id}`, { methode: 'DELETE', jeton: sessions.coach123 });
  await b.appel(`${pb}/${(await b.appel(pb, { methode: 'POST', jeton: sessions.coach123, corps: { titre: 'Texte seul' } })).corps.id}`, { methode: 'DELETE', jeton: sessions.coach123 });
  assert.deepEqual(await purgerCorbeilleStrats(b.base, b.stockage, { maintenant: b.horloge.t + 29 * JOUR }), { strats: 0, entrees: 0 });
  const rapport = await tachesPlanifiees(b.base, { maintenant: () => b.horloge.t + 31 * JOUR, stockage: b.stockage, journal: { error() {} } });
  assert.ok(rapport.find(x => x.tache === 'corbeille des strats').ok);
  for (const [table, col] of [['strats', 'id'], ['strat_versions', 'strat_id'], ['strat_partages', 'strat_id']]) assert.equal((await b.base.premier(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`, [s.id])).n, 0, table);
  assert.equal(await b.stockage.lire(cle), null, 'octets de la miniature effacés');
  assert.equal(await b.base.premier("SELECT id FROM fichiers WHERE entite_type = 'strat' AND entite_id = ?", [s.id]), null);
  assert.equal((await b.base.premier('SELECT strat_id FROM playbook_entrees WHERE id = ?', [e.id])).strat_id, null);
  assert.equal((await b.base.premier('SELECT origine_id FROM strats WHERE id = ?', [copie.id])).origine_id, null);
  assert.ok(await b.base.premier('SELECT id FROM strats WHERE id = ?', [garde.id]));
  assert.equal((await b.base.tous('SELECT id FROM playbook_entrees WHERE supprime_le IS NOT NULL')).length, 0, 'entrée retirée depuis plus de 30 jours effacée');
});

test('migration 0028 sur une base existante : les strats déjà supprimées gardent leur date, supprime_par vide', async () => {
  const { appliquerMigrations } = await import('../noyau/migrations.mjs');
  const { baseVierge, lireMigrations } = await import('./base.mjs');
  const base = await baseVierge();
  const migrations = lireMigrations();
  await appliquerMigrations(base, migrations.filter(m => m.nom < '0028'));
  const d = '2026-01-01T00:00:00.000Z';
  await base.executer("INSERT INTO teams (id, nom, slug, jeu, cree_par, cree_le, maj_le) VALUES ('t', 'T', 't', 'valorant', 'principal', ?, ?)", [d, d]);
  await base.executer("INSERT INTO strats (id, team_id, titre, carte, carte_nom, side, donnees, version_document, cree_par, cree_le, maj_par, maj_le, supprime_le) VALUES ('s', 't', 'Vieille', 'ascent', 'Ascent', 'attaque', '{}', 2, 'principal', ?, 'principal', ?, ?)", [d, d, d]);
  assert.deepEqual(await appliquerMigrations(base, migrations), migrations.filter(m => m.nom >= '0028').map(m => m.nom));
  const l = await base.premier("SELECT supprime_le, supprime_par FROM strats WHERE id = 's'");
  assert.deepEqual([l.supprime_le, l.supprime_par], [d, null]);
});
