/**
 * Playbook (phase 6) : filtres combinés et tri (purs), statuts (brouillon,
 * validée, archivée), favoris, entrée liée à une strat ou textuelle, droits
 * (lecture pour tous, gestion Coach et Analyste), événement « validée »
 * (journal, notification, Discord), migration des rôles système.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { ASCENT, docExemple, jpegDataUrl } from './strats-aide.mjs';
import { filtrerPlaybook, trierPlaybook } from '../noyau/strats/playbook.mjs';
import { appliquerMigrations } from '../noyau/migrations.mjs';
import { baseVierge, lireMigrations } from './base.mjs';

const entree = (champs = {}) => ({ titre: 'X', description: '', tags: [], carte: null, side: null, type: 'default', statut: 'brouillon', favori: false, majLe: '2026-10-01', ...champs });

test('filtres combinés et tri (purs) : texte sans accents, carte, side, type, statut, tag, favoris', () => {
  const liste = [
    entree({ titre: 'Exécution A', carte: { cle: 'ascent', nom: 'Ascent' }, side: 'attaque', type: 'execute', statut: 'validee', tags: ['Rapide'], majLe: '2026-10-03' }),
    entree({ titre: 'Retake B', carte: { cle: 'ascent', nom: 'Ascent' }, side: 'defense', type: 'retake', favori: true, majLe: '2026-10-02' }),
    entree({ titre: 'Anti-éco', type: 'eco', description: 'Protocole général', statut: 'validee', majLe: '2026-10-04' }),
    entree({ titre: 'Vieux default', carte: { cle: 'bind', nom: 'Bind' }, side: 'attaque', statut: 'archivee' }),
  ];
  const titres = f => filtrerPlaybook(liste, f).map(e => e.titre);
  assert.deepEqual(titres({}), ['Exécution A', 'Retake B', 'Anti-éco'], 'archivées masquées par défaut');
  assert.deepEqual(titres({ statut: 'tous' }).length, 4);
  assert.deepEqual(titres({ statut: 'archivee' }), ['Vieux default']);
  assert.deepEqual(titres({ carte: 'ascent', side: 'defense' }), ['Retake B']);
  assert.deepEqual(titres({ q: 'execution' }), ['Exécution A'], 'accents ignorés');
  assert.deepEqual(titres({ q: 'PROTOCOLE' }), ['Anti-éco'], 'casse ignorée, description');
  assert.deepEqual(titres({ q: 'ascent', type: 'execute' }), ['Exécution A'], 'nom de carte cherché');
  assert.deepEqual(titres({ tag: 'rapide' }), ['Exécution A']);
  assert.deepEqual(titres({ favoris: true }), ['Retake B']);
  assert.deepEqual(titres({ statut: 'validee', type: 'eco' }), ['Anti-éco']);
  assert.deepEqual(trierPlaybook(filtrerPlaybook(liste, { statut: 'tous' })).map(e => e.titre), ['Retake B', 'Anti-éco', 'Exécution A', 'Vieux default'], 'favoris, validées (récentes d’abord), brouillons, archivées');
});

const MEMBRES = {
  coach123: { pseudo: 'Coach Zed', role: 'coach' },
  ana12345: { pseudo: 'Ana', role: 'analyste' },
  lea12345: { pseudo: 'Léa', role: 'joueur' },
  tom12345: { pseudo: 'Tom', role: 'remplacant' },
  max12345: { pseudo: 'Max', role: 'manager' },
};

test('playbook par l’API : entrées liées et textuelles, statuts, favoris, filtres, droits', async () => {
  const b = await banc();
  const { teamId, sessions } = await teamAvecMembres(b, { membres: MEMBRES });
  const pb = `/teams/${teamId}/playbook`;
  const strat = (await b.appel(`/teams/${teamId}/strats`, { methode: 'POST', jeton: sessions.coach123, corps: { titre: 'Exec A split', type: 'execute', carte: ASCENT, side: 'attaque', tags: ['A'] } })).corps;
  await b.appel(`/teams/${teamId}/strats/${strat.id}`, { methode: 'PUT', jeton: sessions.coach123, corps: { revision: 1, donnees: docExemple(), miniature: jpegDataUrl() } });

  // Entrée liée : titre, carte, side, type repris de la strat ; miniature dans la grille.
  let r = await b.appel(pb, { methode: 'POST', jeton: sessions.ana12345, corps: { stratId: strat.id, tags: ['A', 'Exec'] } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  const liee = r.corps;
  assert.equal(liee.titre, 'Exec A split');
  assert.deepEqual([liee.carte.cle, liee.side, liee.type, liee.statut], ['ascent', 'attaque', 'execute', 'brouillon']);
  assert.equal(liee.strat.id, strat.id);
  assert.ok(liee.miniature.url.includes('/fichiers/'));
  // Entrée purement textuelle, valable partout.
  const texte = (await b.appel(pb, { methode: 'POST', jeton: sessions.coach123, corps: { titre: 'Anti-éco', type: 'eco', description: 'Stack B, pas de peek.', carte: null } })).corps;
  assert.equal(texte.carte, null);
  assert.equal(texte.strat, null);
  // Droits : le Joueur, le Manager et le Remplaçant lisent ; seuls Coach et Analyste gèrent.
  for (const qui of ['lea12345', 'tom12345', 'max12345']) {
    const lu = await b.appel(pb, { jeton: sessions[qui] });
    assert.equal(lu.statut, 200, qui);
    assert.equal(lu.corps.entrees.length, 2);
    assert.equal(lu.corps.gerer, false);
    assert.equal((await b.appel(pb, { methode: 'POST', jeton: sessions[qui], corps: { titre: 'Moi' } })).statut, 403, qui);
    assert.equal((await b.appel(`${pb}/${texte.id}`, { methode: 'PATCH', jeton: sessions[qui], corps: { favori: true } })).statut, 403, qui);
  }
  // Le Remplaçant voit l'entrée liée, mais ne peut pas ouvrir la strat (pas strats.view).
  const vueTom = (await b.appel(pb, { jeton: sessions.tom12345 })).corps.entrees.find(e => e.id === liee.id);
  assert.equal(vueTom.strat.ouvrable, false);
  assert.equal((await b.appel(pb, { jeton: sessions.lea12345 })).corps.entrees.find(e => e.id === liee.id).strat.ouvrable, true);

  // Statuts : validée (événement), favori, archivée (masquée par défaut).
  r = await b.appel(`${pb}/${liee.id}`, { methode: 'PATCH', jeton: sessions.coach123, corps: { statut: 'validee', favori: true } });
  assert.equal(r.corps.statut, 'validee');
  assert.equal(r.corps.validePar.pseudo, 'Coach Zed');
  assert.equal(r.corps.favori, true);
  await b.appel(`${pb}/${texte.id}`, { methode: 'PATCH', jeton: sessions.ana12345, corps: { statut: 'archivee' } });
  assert.equal((await b.appel(`${pb}/${texte.id}`, { methode: 'PATCH', jeton: sessions.ana12345, corps: { statut: 'publiee' } })).statut, 400);
  const titres = async q => (await b.appel(`${pb}${q}`, { jeton: sessions.lea12345 })).corps.entrees.map(e => e.titre);
  assert.deepEqual(await titres(''), ['Exec A split']);
  assert.deepEqual(await titres('?statut=tous'), ['Exec A split', 'Anti-éco']);
  assert.deepEqual(await titres('?statut=archivee&q=ECO'), ['Anti-éco']);
  assert.deepEqual(await titres('?favoris=1&carte=ascent&side=attaque&type=execute&tag=exec'), ['Exec A split']);
  assert.deepEqual(await titres('?carte=bind'), []);
  assert.equal((await b.appel(`${pb}?side=milieu`, { jeton: sessions.lea12345 })).statut, 400);
  const facettes = (await b.appel(pb, { jeton: sessions.lea12345 })).corps;
  assert.deepEqual(facettes.cartes, [{ cle: 'ascent', nom: 'Ascent' }]);
  assert.deepEqual(facettes.tags, ['A', 'Exec']);

  // Validation : journal, notification in-app de la team (pas de l'auteur), Discord en file si activé.
  const notifs = async jeton => (await b.appel('/notifications', { jeton })).corps.liste.filter(n => n.type === 'playbook-valide');
  assert.equal((await notifs(sessions.lea12345)).length, 1);
  assert.equal((await notifs(sessions.lea12345))[0].charge.titre, 'Exec A split');
  assert.equal((await notifs(sessions.coach123)).length, 0);
  const journal = (await b.appel(`/teams/${teamId}/journal?action=playbook`, { jeton: sessions.fondateur })).corps.entrees.map(e => e.action);
  for (const a of ['playbook.created', 'playbook.validated', 'playbook.archived']) assert.ok(journal.includes(a), a);

  // Suppression de la strat liée : l'entrée reste, sans strat.
  await b.appel(`/teams/${teamId}/strats/${strat.id}`, { methode: 'DELETE', jeton: sessions.coach123 });
  const apres = (await b.appel(pb, { jeton: sessions.lea12345 })).corps.entrees[0];
  assert.equal(apres.titre, 'Exec A split');
  assert.equal(apres.strat, null);
  assert.equal(apres.miniature, null);
  // Suppression d'une entrée ; module désactivé : 404.
  assert.equal((await b.appel(`${pb}/${texte.id}`, { methode: 'DELETE', jeton: sessions.coach123 })).statut, 200);
  await b.appel(`/teams/${teamId}/modules`, { methode: 'PUT', jeton: sessions.fondateur, corps: { modules: { playbook: false } } });
  assert.equal((await b.appel(pb, { jeton: sessions.coach123 })).statut, 404);
});

test('playbook : une strat privée ne se lie pas ; Discord « playbook validé » quand il est activé', async () => {
  const urls = [];
  const b = await banc({ fetchDiscord: async u => (urls.push(String(u)), new Response(null, { status: 204 })) });
  const { teamId, sessions } = await teamAvecMembres(b, { membres: { coach123: MEMBRES.coach123 } });
  const privee = (await b.appel(`/teams/${teamId}/strats`, { methode: 'POST', jeton: sessions.coach123, corps: { titre: 'Perso', carte: ASCENT, side: 'attaque', visibilite: 'privee' } })).corps;
  const r = await b.appel(`/teams/${teamId}/playbook`, { methode: 'POST', jeton: sessions.coach123, corps: { stratId: privee.id } });
  assert.equal(r.statut, 400);
  assert.equal(r.corps.code, 'strat-privee');
  // Discord : webhook, puis notification activée.
  const f = sessions.fondateur;
  const w = await b.appel(`/teams/${teamId}/discord/webhook`, { methode: 'PUT', jeton: f, corps: { url: 'https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcd' } });
  assert.equal(w.statut, 200, JSON.stringify(w.corps));
  const p = await b.appel(`/teams/${teamId}/discord/parametres/playbook_validated`, { methode: 'PUT', jeton: f, corps: { actif: true } });
  assert.equal(p.statut, 200, JSON.stringify(p.corps));
  await b.appel(`/teams/${teamId}/playbook`, { methode: 'POST', jeton: sessions.coach123, corps: { titre: 'Défense Ascent', carte: { cle: 'ascent', nom: 'Ascent' }, statut: 'validee' } });
  const file = await b.base.tous("SELECT cle, variables FROM discord_file WHERE cle = 'playbook_validated'", []);
  assert.equal(file.length, 1);
  assert.equal(JSON.parse(file[0].variables).surCarte, ' sur Ascent');
  assert.ok(urls.length >= 1, 'message envoyé au (faux) Discord');
});

test('migration 0006 : les Coachs et Analystes des teams existantes reçoivent strats.share', async () => {
  const base = await baseVierge();
  const migrations = lireMigrations();
  await appliquerMigrations(base, migrations.filter(m => m.nom < '0006'));
  const d = '2026-01-01T00:00:00.000Z';
  await base.executer("INSERT INTO teams (id, nom, slug, jeu, cree_par, cree_le, maj_le) VALUES ('t', 'T', 't', 'valorant', 'principal', ?, ?)", [d, d]);
  for (const cle of ['coach', 'analyste', 'joueur']) {
    await base.executer('INSERT INTO roles (id, team_id, cle_systeme, nom, couleur, systeme, position, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)', [cle, 't', cle, cle, '#000000', d, d]);
  }
  await appliquerMigrations(base, migrations);
  const a = async role => (await base.tous("SELECT permission FROM role_permissions WHERE role_id = ? AND permission LIKE 'strats.%'", [role])).map(l => l.permission);
  assert.deepEqual(await a('coach'), ['strats.share']);
  assert.deepEqual(await a('analyste'), ['strats.share']);
  assert.deepEqual(await a('joueur'), []);
});
