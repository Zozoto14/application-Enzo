/**
 * Espace « CM du club » réservé à l'équipe CM (migration 0053, docs/esport/cm.md, « Qui entre dans l'espace CM du
 * club ») : une permission CM d'un rôle de TEAM (Manager, joueurs) n'ouvre que l'onglet CM de cette team — déposer une
 * info, proposer un clip, suivre ce qui la concerne —, jamais l'espace du club (tuile, « Changer de team », tableaux,
 * ressources, Drive, réunions, équipe CM, sponsors, notifications personnelles du club, temps réel). Contrôlé côté
 * serveur. Inchangés : Fondateur, Second CEO, Responsable et Correspondant CM ; invité d'une réunion ; ressource partagée.
 *
 * Tourne sur SQLite (défaut) et sur PostgreSQL (ESPORT_TEST_PG, esport/test/pg/lancer.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { baseVierge, lireMigrations } from './base.mjs';
import { appliquerMigrations } from '../noyau/migrations.mjs';

async function preparer() {
  const b = await banc();
  const A = await teamAvecMembres(b, {
    membres: {
      man12345: { pseudo: 'Max', role: 'manager' },
      lea12345: { pseudo: 'Léa', role: 'joueur' },
      kai12345: { pseudo: 'Kai', role: 'joueur' },
    },
  });
  const s = { ...A.sessions };
  s.cm123456 = await b.session('cm123456', 'Clara');
  s.ceo12345 = await b.session('ceo12345', 'Grimm');
  const api = (chemin, jeton, o = {}) => b.appel(chemin, { jeton, methode: o.methode, corps: o.corps });
  const ok = async (chemin, jeton, o = {}) => {
    const r = await api(chemin, jeton, o);
    assert.equal(r.statut, 200, `${o.methode ?? 'GET'} ${chemin} : ${r.statut} ${JSON.stringify(r.corps)}`);
    return r.corps;
  };
  // Clara : Responsable CM (club). Kai : Correspondant CM de la team. Grimm : Second CEO (rôle du club).
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'cm123456', roleId: 'cm-role-responsable', portee: 'club' } });
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'kai12345', roleId: 'cm-role-correspondant', portee: A.teamId } });
  const sc = (await ok('/roles-permissions', s.fondateur)).globaux.roles.find(r => r.cle === 'second_ceo');
  await ok(`/roles-permissions/globaux/${sc.id}/comptes`, s.fondateur, { methode: 'POST', corps: { compte: 'ceo12345' } });
  await ok(`/teams/${A.teamId}/modules`, s.fondateur, { methode: 'PUT', corps: { modules: { cm: true } } });
  await ok(`/cm/teams/${A.teamId}`, s.cm123456);
  const club = (await ok('/cm/tableaux', s.cm123456)).tableaux.find(t => t.cleDefaut === 'contenus' && !t.team);
  const detail = await ok(`/cm/tableaux/${club.id}`, s.cm123456);
  const carte = (await ok(`/cm/tableaux/${club.id}/cartes`, s.cm123456, { methode: 'POST', corps: { listeId: detail.listes[0].id, titre: 'Plan du club SECRET' } })).carte;
  const ressource = (await ok('/cm/liens', s.cm123456, { methode: 'POST', corps: { titre: 'Charte du club', url: 'https://exemple.fr/charte' } })).lien;
  return { b, A, s, api, ok, club, carte, ressource };
}

const ROUTES_ESPACE = [
  '/cm/tableaux',
  '/cm/a-valider',
  '/cm/urgences',
  '/cm/terminees',
  '/cm/calendrier?du=2026-11-01&au=2026-11-30',
  '/cm/calendrier/teams?du=2026-11-01&au=2026-11-30',
  '/cm/recherche?q=Plan',
  '/cm/clips',
  '/cm/liens',
  '/cm/charte',
  '/cm/modeles',
  '/cm/visuels',
  '/cm/reseaux',
  '/cm/roles',
  '/cm/affectations',
  '/cm/journal',
  '/cm/reglages',
  '/cm/reunions/equipe/grille',
  '/sponsors/pipeline',
];

test('Manager d’une team : ni tuile, ni « Changer de team », ni aucune route de l’espace CM du club (serveur)', async () => {
  const { A, s, api, ok, club, carte, ressource } = await preparer();
  const moi = await ok('/cm/moi', s.man12345);
  assert.equal(moi.espace, false, 'tuile « CM du club » et entrée du sélecteur : absentes');
  assert.deepEqual(moi.teams, [], 'aucune portée de l’espace');
  assert.deepEqual(moi.club, []);
  assert.equal(moi.ressources, false);
  for (const chemin of ROUTES_ESPACE) assert.ok([403, 404].includes((await api(chemin, s.man12345)).statut), chemin);
  assert.ok([403, 404].includes((await api(`/cm/tableaux/${club.id}`, s.man12345)).statut), 'tableau du club');
  assert.ok([403, 404].includes((await api(`/cm/cartes/${carte.id}`, s.man12345)).statut), 'carte du club');
  assert.ok([403, 404].includes((await api(`/cm/liens/${ressource.id}/liaisons`, s.man12345)).statut), 'ressource du club');
  assert.ok([403, 404].includes((await api('/cm/drive?portee=club', s.man12345)).statut), 'Drive du club');
  // Réunions de l'équipe CM : aucune (il n'est invité à aucune), ni droits.
  const reunions = await ok('/cm/reunions', s.man12345);
  assert.deepEqual([reunions.reunions, reunions.droits], [[], { voir: false, gerer: false }]);
  // Le Drive de sa team : au plus le dépôt des joueurs (déposer, proposer), jamais le Drive du club.
  const drive = await api('/cm/drive/portees', s.man12345);
  if (drive.statut === 200) {
    assert.ok(!drive.corps.portees.some(p => p.portee === 'club'));
    assert.ok(drive.corps.portees.every(p => !p.droits.voir), 'dépôt seulement');
  }
  // L'état léger (pastilles de la tuile) ne rend rien du club.
  const etat = await ok('/cm/etat', s.man12345);
  assert.deepEqual(Object.keys(etat.versions), []);
  assert.equal(etat.aValider, 0);
  // Un joueur non plus.
  assert.equal((await ok('/cm/moi', s.lea12345)).espace, false);
  assert.equal((await api('/cm/tableaux', s.lea12345)).statut, 403);
  void A;
});

test('Manager d’une team : il dépose une info et propose un clip dans SA team (onglet CM), sans voir le tableau', async () => {
  const { A, s, ok } = await preparer();
  const page = await ok(`/cm/teams/${A.teamId}`, s.man12345);
  assert.deepEqual([...page.permissions].sort(), ['cm.clips.proposer', 'cm.deposer']);
  assert.deepEqual(page.tableaux, [], 'pas le tableau CM de la team (cm.voir retiré du Manager par défaut)');
  await ok(`/cm/teams/${A.teamId}/depots`, s.man12345, { methode: 'POST', corps: { genre: 'info', titre: 'Nouveau sponsor maillot' } });
  await ok(`/cm/teams/${A.teamId}/clips`, s.man12345, { methode: 'POST', corps: { genre: 'lien', url: 'https://video-exemple.fr/ace', titre: 'Ace de Max' } });
  const apres = await ok(`/cm/teams/${A.teamId}`, s.man12345);
  assert.deepEqual(apres.depots.map(d => d.titre), ['Nouveau sponsor maillot'], 'il suit ses dépôts');
  assert.deepEqual((await ok(`/cm/teams/${A.teamId}/clips`, s.man12345)).clips.map(c => c.titre), ['Ace de Max']);
  // Le CM du club reçoit bien le dépôt et le clip.
  const cmTeam = await ok(`/cm/teams/${A.teamId}`, s.cm123456);
  assert.ok(cmTeam.depots.some(d => d.titre === 'Nouveau sponsor maillot'));
  assert.ok((await ok('/cm/clips', s.cm123456)).clips.some(c => c.titre === 'Ace de Max'));
});

test('rôle de team personnalisé avec cm.voir : le tableau de SA team dans l’onglet CM, toujours pas l’espace du club', async () => {
  const { b, A, s, api, ok } = await preparer();
  await b.base.executer("INSERT INTO role_permissions (role_id, permission) VALUES (?, 'cm.voir')", [A.roles.manager.id]);
  const page = await ok(`/cm/teams/${A.teamId}`, s.man12345);
  assert.equal(page.tableaux.length, 1, 'le tableau CM de la team');
  await ok(`/cm/tableaux/${page.tableaux[0].id}`, s.man12345);
  // État léger : seulement ce tableau-là (pastille de l'onglet CM de la team).
  assert.deepEqual(Object.keys((await ok('/cm/etat', s.man12345)).versions), [page.tableaux[0].id]);
  const moi = await ok('/cm/moi', s.man12345);
  assert.equal(moi.espace, false);
  assert.deepEqual(moi.teams, []);
  for (const chemin of ROUTES_ESPACE) assert.ok([403, 404].includes((await api(chemin, s.man12345)).statut), chemin);
});

test('équipe CM inchangée : Fondateur, Second CEO, Responsable CM, Correspondant CM (sa team)', async () => {
  const { A, s, ok, club } = await preparer();
  for (const qui of ['fondateur', 'ceo12345', 'cm123456', 'kai12345']) {
    const moi = await ok('/cm/moi', s[qui]);
    assert.equal(moi.espace, true, qui);
    const tableaux = (await ok('/cm/tableaux', s[qui])).tableaux;
    assert.ok(tableaux.some(t => t.team?.id === A.teamId), `${qui} : tableau de la team`);
    assert.equal(tableaux.some(t => t.id === club.id), qui !== 'kai12345', `${qui} : tableau du club`);
    await ok('/cm/liens', s[qui]);
    await ok('/cm/charte', s[qui]);
  }
  assert.ok((await ok('/cm/moi', s.kai12345)).teams.some(t => t.id === A.teamId && t.permissions.includes('cm.voir')));
});

test('exceptions gardées : l’invité d’une réunion voit ses réunions ; la ressource partagée, et elle seule', async () => {
  const { b, A, s, api, ok, ressource } = await preparer();
  // Réunion : Max (Manager, hors équipe CM) invité.
  const r = (await ok('/cm/reunions', s.cm123456, { methode: 'POST', corps: { titre: 'Point sponsor', date: '2026-12-02', heureDebut: '18:00', heureFin: '19:00', fuseau: 'Europe/Paris', lieuGenre: 'lien', lien: 'https://meet.example.org/cm', participants: ['man12345'] } })).reunion;
  const moi = await ok('/cm/moi', s.man12345);
  assert.equal(moi.espace, true, 'l’invitation ouvre l’espace sur ses réunions');
  assert.equal(moi.reunions.invite, true);
  assert.equal(moi.ressources, false);
  await ok(`/cm/reunions/${r.id}`, s.man12345);
  for (const chemin of ['/cm/tableaux', '/cm/liens', '/cm/charte', '/cm/clips']) assert.equal((await api(chemin, s.man12345)).statut, 403, chemin);
  // Ressource partagée : Léa (joueuse dont le rôle porte cm.voir, personnalisé) reçoit « Partager avec… ».
  await b.base.executer("INSERT INTO role_permissions (role_id, permission) VALUES (?, 'cm.voir')", [A.roles.joueur.id]);
  const autre = (await ok('/cm/liens', s.cm123456, { methode: 'POST', corps: { titre: 'Kit presse', url: 'https://exemple.fr/kit' } })).lien;
  assert.equal((await api('/cm/liens', s.lea12345)).statut, 403, 'avant le partage : rien');
  await ok(`/cm/liens/${ressource.id}/partage`, s.cm123456, { methode: 'POST', corps: { comptes: ['lea12345'] } });
  const moiLea = await ok('/cm/moi', s.lea12345);
  assert.equal(moiLea.espace, true);
  assert.equal(moiLea.ressources, true);
  assert.deepEqual(moiLea.teams, []);
  const liste = await ok('/cm/liens', s.lea12345);
  assert.deepEqual(liste.liens.map(l => l.id), [ressource.id], 'seulement la ressource partagée');
  assert.equal(liste.liens[0].partageAvecMoi, true);
  assert.deepEqual(liste.liens[0].droits, { modifier: false, supprimer: false, acces: false, partager: false });
  assert.equal((await api(`/cm/liens/${autre.id}/liaisons`, s.lea12345)).statut, 404);
  assert.equal((await ok('/cm/etat', s.lea12345)).ressources, 1, 'pastille « Nouveau »');
  assert.ok((await ok('/notifications', s.lea12345)).liste.some(n => n.type === 'cm-lien-partage'), 'notification du partage');
  for (const chemin of ['/cm/tableaux', '/cm/charte', '/cm/clips', '/cm/a-valider']) assert.equal((await api(chemin, s.lea12345)).statut, 403, chemin);
});

test('notifications : un Manager ne voit aucune personnelle CM du club (relue à la lecture), sauf partage et réunion', async () => {
  const { b, s, ok } = await preparer();
  const t = new Date().toISOString();
  for (const [id, type] of [['n-assigne', 'cm-assigne'], ['n-mention', 'cm-mention'], ['n-partage', 'cm-lien-partage']]) {
    await b.base.executer('INSERT INTO notifications (id, compte_id, team_id, type, charge, cree_le) VALUES (?, ?, NULL, ?, ?, ?)', [id, 'man12345', type, JSON.stringify({ titre: 'Plan du club SECRET' }), t]);
  }
  const ancienne = (await ok('/notifications', s.man12345)).liste.map(n => n.type);
  assert.ok(!ancienne.includes('cm-assigne') && !ancienne.includes('cm-mention'), JSON.stringify(ancienne));
  assert.ok(ancienne.includes('cm-lien-partage'));
  const centre = (await ok('/notifications/centre?limite=100', s.man12345)).liste.map(n => n.type);
  assert.ok(!centre.includes('cm-assigne') && !centre.includes('cm-mention'), JSON.stringify(centre));
  assert.ok(centre.includes('cm-lien-partage'));
  // Le même compte devenu Correspondant CM (équipe CM) : elles réapparaissent.
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'man12345', roleId: 'cm-role-correspondant', portee: 'club' } });
  const apres = (await ok('/notifications', s.man12345)).liste.map(n => n.type);
  assert.ok(apres.includes('cm-assigne') && apres.includes('cm-mention'), JSON.stringify(apres));
});

test('temps réel : le Manager ne reçoit rien de la section CM ; la Responsable CM, si', async () => {
  const { s, ok, carte } = await preparer();
  const depuis = (await ok('/temps-reel/evenements', s.man12345)).dernierId;
  await ok(`/cm/cartes/${carte.id}`, s.fondateur, { methode: 'PATCH', corps: { titre: 'Plan du club v2' } });
  const recus = (await ok(`/temps-reel/evenements?depuis=${depuis}`, s.man12345)).evenements;
  assert.ok(!recus.some(m => String(m.sujet).startsWith('cm') || String(m.cle ?? '').startsWith('cm-')), JSON.stringify(recus));
  const cm = (await ok(`/temps-reel/evenements?depuis=${depuis}`, s.cm123456)).evenements;
  assert.ok(cm.some(m => m.sujet === 'cm'), JSON.stringify(cm));
});

test('migration 0053 : cm.voir retiré des Managers encore aux permissions CM par défaut ; une partie CM personnalisée ne change pas', async () => {
  const base = await baseVierge();
  const toutes = lireMigrations();
  await appliquerMigrations(base, toutes.filter(m => m.nom < '0053'));
  const d = '2026-01-01T00:00:00.000Z';
  await base.executer("INSERT INTO teams (id, nom, slug, jeu, cree_par, cree_le, maj_le) VALUES ('t', 'T', 't', 'valorant', 'principal', ?, ?)", [d, d]);
  for (const [id, cle, perms] of [
    ['m-defaut', 'manager', ['cm.voir', 'cm.deposer', 'cm.clips.proposer', 'planning.view']],
    ['m-perso', 'manager', ['cm.voir', 'cm.clips.proposer']],
    ['c-voit', 'coach', ['cm.voir', 'cm.deposer', 'cm.clips.proposer']],
  ]) {
    await base.executer('INSERT INTO roles (id, team_id, cle_systeme, nom, couleur, systeme, position, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)', [id, 't', cle, cle, '#000000', d, d]);
    for (const p of perms) await base.executer('INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)', [id, p]);
  }
  assert.deepEqual(await appliquerMigrations(base, toutes.filter(m => m.nom < '0054')), ['0053_cm_manager_sans_espace.sql']);
  const perms = async role => (await base.tous('SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission', [role])).map(l => l.permission);
  assert.deepEqual(await perms('m-defaut'), ['cm.clips.proposer', 'cm.deposer', 'planning.view']);
  assert.deepEqual(await perms('m-perso'), ['cm.clips.proposer', 'cm.voir'], 'partie CM personnalisée : gardée');
  assert.deepEqual(await perms('c-voit'), ['cm.clips.proposer', 'cm.deposer', 'cm.voir'], 'autre rôle : intact');
});
