/**
 * Badges du trombinoscope (migration 0032) : rôles personnalisés sous le pseudo.
 *  - migration : badges proposés par défaut, permission `membres.badges.gerer` (Manager, Responsable CM) ;
 *  - PERMISSIONS : un joueur ne s'attribue rien (ni à un autre) ; le Manager attribue aux membres de SA team, pas
 *    à lui-même, et ne gère pas le catalogue ; le Responsable CM gère le catalogue et attribue dans tout le club ;
 *  - badges AUTOMATIQUES : « CEO » réservé au compte Fondateur (jamais attribuable, même par le Fondateur),
 *    « Responsable CM » / « Correspondant CM » qui suivent les affectations ; désactivables ;
 *  - ordre du catalogue sur les cartes, badge rattaché à une team, attribution à plusieurs membres (tout ou rien) ;
 *  - suppression définitive : retiré de tous les membres ; texte d'annonce et visuel « Recrue » ;
 *  - journal, RGPD (export, suppression du compte), export / import de la base.
 *
 * Tourne sur SQLite (défaut) et sur PostgreSQL (ESPORT_TEST_PG, esport/test/pg/lancer.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { baseMigree, baseVierge, lireMigrations } from './base.mjs';
import { appliquerMigrations } from '../noyau/migrations.mjs';
import { TABLES, exporterBase, importerBase } from '../noyau/transfert.mjs';
import { donneesVisuel } from '../noyau/cm/visuels/champs.mjs';
import { badgesAffiches, lireBadge } from '../noyau/trombi/badges.mjs';

test('règles : champs d’un badge, ordre du catalogue, badge de team masqué par le même badge global', () => {
  assert.deepEqual(lireBadge({ nom: '  Capitaine ', couleur: '#5B8CFF', icone: '©' }), { nom: 'Capitaine', couleur: '#5b8cff', icone: '©' });
  assert.throws(() => lireBadge({ nom: '', couleur: '#5b8cff' }), e => e.code === 'badge-nom');
  assert.throws(() => lireBadge({ nom: 'X', couleur: 'bleu' }), e => e.code === 'badge-couleur');
  assert.throws(() => lireBadge({ nom: 'X', couleur: '#000000', icone: 'une phrase' }), e => e.code === 'badge-icone');
  const cat = [
    { id: 'b', nom: 'IGL', couleur: '#000000', icone: '', position: 1 },
    { id: 'a', nom: 'Capitaine', couleur: '#000000', icone: '', position: 0 },
  ];
  const teams = new Map([['t1', 'Team Alpha']]);
  const aff = badgesAffiches(
    [
      { badge: 'b', portee: 'club' },
      { badge: 'a', portee: 't1' },
      { badge: 'a', portee: 't-cachee' },
    ],
    cat,
    teams,
  );
  assert.deepEqual(aff.map(x => [x.nom, x.teamNom]), [['Capitaine', 'Team Alpha'], ['IGL', null]], 'ordre du catalogue ; team non visible : rien');
  assert.deepEqual(badgesAffiches([{ badge: 'a', portee: 't1' }, { badge: 'a', portee: 'club' }], cat, teams).map(x => x.teamNom), [null]);
});

test('migration 0032 sur une base existante : badges proposés, permission du Manager et du Responsable CM', async () => {
  const base = await baseVierge();
  const migrations = lireMigrations();
  await appliquerMigrations(base, migrations.filter(m => m.nom < '0032'));
  const t = '2026-01-01T00:00:00.000Z';
  await base.executer("INSERT INTO teams (id, nom, slug, jeu, cree_par, cree_le, maj_le) VALUES ('team-1', 'Team', 'team', 'valorant', 'principal', ?, ?)", [t, t]);
  for (const cle of ['manager', 'coach', 'joueur']) {
    await base.executer('INSERT INTO roles (id, team_id, cle_systeme, nom, couleur, systeme, position, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)', [`role-${cle}`, 'team-1', cle, cle, '#123456', t, t]);
  }
  assert.ok((await appliquerMigrations(base, migrations.filter(m => m.nom < '0033'))).includes('0032_trombi_badges.sql'));
  const a = async (table, role) => (await base.tous(`SELECT permission FROM ${table} WHERE role_id = ? AND permission = 'membres.badges.gerer'`, [role])).length;
  assert.equal(await a('role_permissions', 'role-manager'), 1);
  assert.equal(await a('role_permissions', 'role-coach'), 0);
  assert.equal(await a('role_permissions', 'role-joueur'), 0);
  assert.equal(await a('cm_role_permissions', 'cm-role-responsable'), 1);
  assert.equal(await a('cm_role_permissions', 'cm-role-correspondant'), 0);
  const badges = await base.tous('SELECT nom, auto, reserve FROM trombi_badges ORDER BY position', []);
  assert.deepEqual(badges.slice(0, 5).map(b => [b.nom, b.auto, Number(b.reserve)]), [['CEO', 'fondateur', 0], ['Second CEO', null, 1], ['Responsable CM', 'cm-responsable', 0], ['Correspondant CM', 'cm-correspondant', 0], ['Capitaine', null, 0]]);
  for (const table of ['trombi_badges', 'trombi_badges_membres']) assert.ok(TABLES.some(([n]) => n === table), `export : ${table}`);
});

async function preparer() {
  const b = await banc();
  const A = await teamAvecMembres(b, {
    membres: {
      lea12345: { pseudo: 'Léa', role: 'joueur' },
      tom12345: { pseudo: 'Tom', role: 'joueur' },
      man12345: { pseudo: 'Max', role: 'manager' },
      coa12345: { pseudo: 'Coline', role: 'coach' },
    },
  });
  const B = await teamAvecMembres(b, { nom: 'Team Beta', membres: { zoe12345: { pseudo: 'Zoé', role: 'joueur' } } });
  const s = { ...A.sessions, zoe12345: B.sessions.zoe12345 };
  s.cm123456 = await b.session('cm123456', 'Clara');
  s.cor12345 = await b.session('cor12345', 'Corentin');
  const api = (chemin, jeton, o = {}) => b.appel(chemin, { jeton, methode: o.methode, corps: o.corps });
  const ok = async (chemin, jeton, o = {}) => {
    const r = await api(chemin, jeton, o);
    assert.equal(r.statut, 200, `${o.methode ?? 'GET'} ${chemin} : ${r.statut} ${JSON.stringify(r.corps)}`);
    return r.corps;
  };
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'cm123456', roleId: 'cm-role-responsable', portee: 'club' } });
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'cor12345', roleId: 'cm-role-correspondant', portee: 'club' } });
  const badgesDe = async (jeton, compte) => (await ok('/trombi', jeton)).fiches.find(f => f.compte === compte)?.badges.map(x => (x.teamNom ? `${x.nom} · ${x.teamNom}` : x.nom));
  return { b, A, B, s, api, ok, badgesDe };
}

const PUT = corps => ({ methode: 'PUT', corps });

test('permissions : le joueur ne s’attribue rien ; le Manager sa team (pas lui-même, pas le catalogue) ; le Responsable CM tout le club', async () => {
  const { A, s, api, ok, badgesDe } = await preparer();
  // Léa (joueuse) : ni à elle-même, ni à Tom.
  const soi = await api('/trombi/fiches/moi/badges', s.lea12345, PUT({ badges: ['badge-capitaine'] }));
  assert.equal(soi.statut, 403);
  assert.equal(soi.corps.code, 'badge-soi');
  assert.equal((await api('/trombi/fiches/tom12345/badges', s.lea12345, PUT({ badges: ['badge-capitaine'] }))).statut, 403);
  assert.equal((await api('/trombi/badges/badge-streamer/membres', s.lea12345, { methode: 'POST', corps: { comptes: ['lea12345'] } })).statut, 403);
  assert.equal((await ok('/trombi', s.lea12345)).droits.badges.attribuer, false);
  // Coach (sans la permission) : 403.
  const rc = await api('/trombi/fiches/tom12345/badges', s.coa12345, PUT({ badges: ['badge-capitaine'] }));
  assert.equal(rc.statut, 403, JSON.stringify(rc.corps));
  // Manager : Tom (sa team), en global et rattaché à la team ; pas lui-même ; pas Zoé ; pas le catalogue.
  const d = await ok('/trombi/fiches/tom12345/badges', s.man12345, PUT({ badges: [{ id: 'badge-capitaine', portee: A.teamId }, 'badge-igl'] }));
  assert.deepEqual(d.badges.map(x => [x.nom, x.teamNom]), [['Capitaine', 'Team Alpha'], ['IGL', null]]);
  assert.deepEqual(d.attribution.portees.map(p => p.id), ['club', A.teamId]);
  assert.equal(d.attribution.gerer, false, 'le Manager attribue mais ne gère pas le catalogue');
  assert.equal((await api('/trombi/fiches/moi/badges', s.man12345, PUT({ badges: ['badge-manager'] }))).corps.code, 'badge-soi');
  assert.equal((await api('/trombi/fiches/zoe12345/badges', s.man12345, PUT({ badges: ['badge-rookie'] }))).statut, 404, 'fiche hors de sa vue');
  assert.equal((await api('/trombi/badges', s.man12345, { methode: 'POST', corps: { nom: 'Pilier', couleur: '#123456' } })).statut, 403);
  assert.deepEqual((await ok('/trombi', s.man12345)).droits.badges, { gerer: false, attribuer: true, fondateur: false });
  assert.equal((await ok('/trombi', s.man12345)).fiches.find(f => f.compte === 'man12345').peutBadges, false);
  // Léa (joueuse) voit les badges de Tom sur sa carte.
  assert.deepEqual(await badgesDe(s.lea12345, 'tom12345'), ['Capitaine · Team Alpha', 'IGL']);
  // Responsable CM : crée un badge et l'attribue à Zoé (autre team) ; Correspondant CM (sans la permission) : 403.
  const cat = await ok('/trombi/badges', s.cm123456, { methode: 'POST', corps: { nom: 'Pilier', couleur: '#123456', icone: '🛡️' } });
  const pilier = cat.badges.find(x => x.nom === 'Pilier');
  assert.equal(pilier.position, cat.badges.length - 1, 'ajouté en fin de catalogue');
  assert.equal((await api('/trombi/badges', s.cm123456, { methode: 'POST', corps: { nom: 'pilier', couleur: '#123456' } })).corps.code, 'badge-doublon');
  await ok('/trombi/fiches/zoe12345/badges', s.cm123456, PUT({ badges: [pilier.id] }));
  assert.equal((await api('/trombi/fiches/zoe12345/badges', s.cor12345, PUT({ badges: [] }))).statut, 403);
  // Le Manager remet la liste de Tom : ce que le Responsable a mis hors de son périmètre reste.
  await ok('/trombi/fiches/tom12345/badges', s.cm123456, PUT({ badges: ['badge-capitaine', { id: 'badge-capitaine', portee: A.teamId }, 'badge-igl'] }));
  assert.equal((await api('/trombi/fiches/tom12345/badges', s.man12345, PUT({ badges: [{ id: 'badge-igl', portee: 'team-inconnue' }] }))).corps.code, 'badge-portee');
  // Le Fondateur peut s'en attribuer un à lui-même.
  await ok('/trombi/fiches/moi/badges', s.fondateur, PUT({ badges: ['badge-manager'] }));
});

test('badges automatiques : « CEO » au Fondateur SEUL (jamais attribuable), Responsable / Correspondant CM suivent les affectations', async () => {
  const { b, s, api, ok, badgesDe } = await preparer();
  assert.deepEqual(await badgesDe(s.fondateur, 'principal'), ['CEO']);
  assert.deepEqual(await badgesDe(s.cm123456, 'cm123456'), ['Responsable CM']);
  assert.deepEqual(await badgesDe(s.cor12345, 'cor12345'), ['Correspondant CM']);
  // « CEO » : ni par la fiche, ni par le lot, ni même par le Fondateur ; on ne le transforme pas en badge manuel.
  for (const jeton of [s.fondateur, s.cm123456]) {
    assert.equal((await api('/trombi/fiches/tom12345/badges', jeton, PUT({ badges: ['badge-ceo'] }))).corps.code, 'badge-auto');
    assert.equal((await api('/trombi/badges/badge-ceo/membres', jeton, { methode: 'POST', corps: { comptes: ['tom12345'] } })).corps.code, 'badge-auto');
  }
  assert.equal((await api('/trombi/fiches/moi/badges', s.fondateur, PUT({ badges: ['badge-ceo'] }))).corps.code, 'badge-auto');
  assert.equal((await api('/trombi/badges', s.fondateur, { methode: 'POST', corps: { nom: 'ceo', couleur: '#000000' } })).corps.code, 'badge-doublon');
  assert.equal((await b.base.premier("SELECT COUNT(*) AS n FROM trombi_badges_membres WHERE badge_id = 'badge-ceo'", [])).n * 1, 0);
  assert.ok(!(await ok('/trombi', s.fondateur)).fiches.some(f => f.compte !== 'principal' && f.badges.some(x => x.id === 'badge-ceo')));
  // Libellé modifiable ; désactivé : plus affiché ; réactivé.
  await ok('/trombi/badges/badge-ceo', s.fondateur, { methode: 'PATCH', corps: { nom: 'Président' } });
  assert.deepEqual(await badgesDe(s.fondateur, 'principal'), ['Président']);
  await ok('/trombi/badges/badge-ceo', s.fondateur, { methode: 'PATCH', corps: { autoActif: false } });
  assert.deepEqual(await badgesDe(s.fondateur, 'principal'), []);
  await ok('/trombi/badges/badge-ceo', s.fondateur, { methode: 'PATCH', corps: { autoActif: true } });
  assert.equal((await api('/trombi/badges/badge-igl', s.fondateur, { methode: 'PATCH', corps: { autoActif: false } })).corps.code, 'badge-auto');
  await ok('/trombi/badges/badge-ambassadeur', s.fondateur, { methode: 'PATCH', corps: { reserve: true } });
  // Badge réservé au Fondateur (« Second CEO » est devenu automatique, migration 0033 : on réserve « Ambassadeur »). Le Responsable CM ne l'attribue, ne le retire, ne le modifie ni
  // ne le supprime ; quand il remet la liste de Tom, le badge réservé reste.
  for (const r of [
    await api('/trombi/fiches/tom12345/badges', s.cm123456, PUT({ badges: ['badge-ambassadeur'] })),
    await api('/trombi/badges/badge-ambassadeur/membres', s.cm123456, { methode: 'POST', corps: { comptes: ['tom12345'] } }),
    await api('/trombi/badges/badge-ambassadeur', s.cm123456, { methode: 'PATCH', corps: { couleur: '#000000' } }),
    await api('/trombi/badges/badge-ambassadeur', s.cm123456, { methode: 'DELETE' }),
    await api('/trombi/badges/badge-igl', s.cm123456, { methode: 'PATCH', corps: { reserve: true } }),
  ]) assert.equal(r.corps.code, 'badge-reserve');
  await ok('/trombi/fiches/tom12345/badges', s.fondateur, PUT({ badges: ['badge-ambassadeur'] }));
  await ok('/trombi/fiches/tom12345/badges', s.cm123456, PUT({ badges: ['badge-igl'] }));
  assert.deepEqual(await badgesDe(s.cm123456, 'tom12345'), ['IGL', 'Ambassadeur']);
  assert.equal((await ok('/trombi/fiches/tom12345', s.cm123456)).attribution.gerer, true, 'le Responsable CM gère le catalogue');
  assert.equal((await ok('/trombi/fiches/tom12345', s.cm123456)).attribution.actuelles.some(a => a.id === 'badge-ambassadeur'), false);
  // Le rôle change : Corentin n'est plus Correspondant CM → plus de badge.
  const aff = await b.base.premier("SELECT id FROM cm_affectations WHERE compte_id = 'cor12345'", []);
  await ok(`/cm/affectations/${aff.id}`, s.fondateur, { methode: 'DELETE' });
  assert.deepEqual(await badgesDe(s.cor12345, 'cor12345'), []);
});

test('ordre du catalogue, filtre (catalogue dans GET /trombi), lot à plusieurs membres (tout ou rien), suppression définitive', async () => {
  const { b, s, api, ok, badgesDe } = await preparer();
  const lot = await ok('/trombi/badges/badge-streamer/membres', s.cm123456, { methode: 'POST', corps: { comptes: ['tom12345', 'lea12345', 'zoe12345'] } });
  assert.equal(lot.modifies, 3);
  await ok('/trombi/fiches/tom12345/badges', s.cm123456, PUT({ badges: ['badge-streamer', 'badge-rookie'] }));
  assert.deepEqual(await badgesDe(s.cm123456, 'tom12345'), ['Streamer', 'Rookie']);
  // Nouvel ordre : Rookie avant Streamer.
  const ids = (await ok('/trombi/badges', s.cm123456)).badges.map(x => x.id);
  const ordre = ['badge-rookie', ...ids.filter(i => i !== 'badge-rookie')];
  await ok('/trombi/badges/ordre', s.cm123456, PUT({ ids: ordre }));
  assert.deepEqual(await badgesDe(s.cm123456, 'tom12345'), ['Rookie', 'Streamer']);
  assert.equal((await api('/trombi/badges/ordre', s.cm123456, PUT({ ids: ordre.slice(1) }))).corps.code, 'badge-ordre');
  const liste = await ok('/trombi', s.cm123456);
  assert.deepEqual(liste.badges.slice(0, 2).map(x => x.id), ['badge-rookie', 'badge-ceo'], 'catalogue pour le filtre, dans l’ordre');
  // Lot du Manager : Zoé (hors de sa team) → 403, et rien n'est écrit pour Tom.
  const r = await api('/trombi/badges/badge-coach/membres', s.man12345, { methode: 'POST', corps: { comptes: ['tom12345', 'zoe12345'] } });
  assert.equal(r.statut, 403);
  assert.ok(!(await badgesDe(s.cm123456, 'tom12345')).includes('Coach'));
  // Retrait en lot.
  assert.equal((await ok('/trombi/badges/badge-streamer/membres', s.man12345, { methode: 'POST', corps: { comptes: ['lea12345'], retirer: true } })).modifies, 1);
  // Suppression définitive : nombre de membres annoncé, retiré partout.
  assert.equal((await ok('/trombi/badges', s.cm123456)).badges.find(x => x.id === 'badge-streamer').membres, 2);
  assert.equal((await api('/trombi/badges/badge-streamer', s.man12345, { methode: 'DELETE' })).statut, 403);
  const sup = await ok('/trombi/badges/badge-streamer', s.cm123456, { methode: 'DELETE' });
  assert.equal(sup.retires, 2);
  assert.deepEqual(await badgesDe(s.cm123456, 'tom12345'), ['Rookie']);
  assert.deepEqual(await badgesDe(s.cm123456, 'zoe12345'), []);
  assert.equal((await b.base.premier("SELECT COUNT(*) AS n FROM trombi_badges_membres WHERE badge_id = 'badge-streamer'", [])).n * 1, 0);
  // Journal (bus) : attribution, retrait, suppression ; sans team.
  const evs = await b.base.tous("SELECT type, team_id, charge FROM evenements WHERE type LIKE 'trombi.badge_%'", []);
  for (const t of ['trombi.badge_attribue', 'trombi.badge_retire', 'trombi.badge_supprime']) assert.ok(evs.some(e => e.type === t), t);
  assert.ok(evs.every(e => e.team_id === null));
});

test('texte d’annonce et visuel « Recrue » : les badges ; RGPD ; export / import de la base', async () => {
  const { b, A, s, api, ok } = await preparer();
  await ok('/trombi/fiches/tom12345/badges', s.man12345, PUT({ badges: [{ id: 'badge-capitaine', portee: A.teamId }, 'badge-igl'] }));
  const texte = await ok('/trombi/fiches/tom12345/texte', s.cm123456);
  assert.match(texte.fr, /^Tom\nBadges : © Capitaine · Team Alpha, IGL\n/);
  assert.match(texte.en, /^Tom\nBadges: © Capitaine · Team Alpha, IGL\n/);
  const v = await donneesVisuel(b.base, { genre: 'membre', teamId: A.teamId, id: 'tom12345' });
  assert.equal(v.fr.champs.badges, 'Capitaine · IGL');
  // Export RGPD, copie de la base, puis suppression du compte.
  const exp = await ok('/moi/export', s.tom12345);
  assert.deepEqual(exp.trombinoscopeBadges.map(x => [x.badge, x.team]), [['Capitaine', 'Team Alpha'], ['IGL', null]]);
  const copie = await exporterBase(b.base);
  const autre = await baseMigree();
  const bilan = await importerBase(autre, copie);
  assert.equal(bilan.trombi_badges_membres, 2);
  assert.ok(bilan.trombi_badges >= 12);
  assert.equal((await api('/moi', s.tom12345, { methode: 'DELETE' })).statut, 200);
  assert.equal((await b.base.premier("SELECT COUNT(*) AS n FROM trombi_badges_membres WHERE compte_id = 'tom12345'", [])).n * 1, 0);
  // Le Manager retiré : il n'est plus l'auteur d'aucune attribution.
  await ok('/trombi/fiches/lea12345/badges', s.man12345, PUT({ badges: ['badge-rookie'] }));
  assert.equal((await api('/admin/comptes/man12345/hub', s.fondateur, { methode: 'DELETE' })).statut, 200);
  assert.equal((await b.base.premier("SELECT attribue_par FROM trombi_badges_membres WHERE compte_id = 'lea12345'", [])).attribue_par, null);
});
