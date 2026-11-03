/**
 * Section CM (migration 0023) :
 *  - règles pures : compteur de caractères par réseau (X pondéré), hashtags, mentions, adresses de posts ;
 *  - migration sur une base existante (rôles CM, permissions de team, envois gardés) ;
 *  - permissions et PÉRIMÈTRE : espace du club, partie CM d'une team (module), correspondant de team,
 *    Responsable CM sans accès aux strats / scouting / notes / résultats staff, anti-escalade des rôles CM ;
 *  - tableaux façon Trello : listes, cartes, glisser-déposer (index), étiquettes, checklists, commentaires
 *    (@mentions), pièces jointes (lien, fichier par morceaux, lien signé), recherche, calendrier, versions ;
 *  - posts et circuit de validation : soumission (textes manquants ou trop longs), validation, invalidation
 *    après modification, refus motivé, publication (adresses), événement `cm.post_publie` ;
 *  - suggestions automatiques (tournoi, J-1, jour J, résultat, classement final ; publiable seulement) ;
 *  - dépôt d'informations, clips des joueurs (lien, fichier, tri, carte, notifications) ;
 *  - import Trello (fichier d'exemple anonymisé, idempotence, entrées malformées, contenu hostile) ;
 *  - RGPD et export / import de la base.
 *
 * Tourne sur SQLite (défaut) et sur PostgreSQL (ESPORT_TEST_PG, esport/test/pg/lancer.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { banc, teamAvecMembres } from './aide.mjs';
import { baseVierge, lireMigrations } from './base.mjs';
import { mp4Factice, morceau, sha } from './medias-aide.mjs';
import { appliquerMigrations } from '../noyau/migrations.mjs';
import { permissionsRoleSysteme, TOUTES_PERMISSIONS } from '../noyau/permissions.mjs';
import { TABLES, exporterBase, importerBase } from '../noyau/transfert.mjs';
import { analyserTexte, compterCaracteres, hashtags, mentions, urlPostValide } from '../noyau/cm/reseaux.mjs';
import { empreinteContenu, problemesPost } from '../noyau/cm/posts.mjs';
import { TrelloInvalide, lireExportTrello } from '../noyau/cm/trello.mjs';

const TRELLO = JSON.parse(readFileSync(new URL('./donnees/trello-exemple.json', import.meta.url), 'utf8'));
const copie = o => JSON.parse(JSON.stringify(o));

// ------------------------------------------------------------------ Règles pures

test('réseaux : X compte les adresses 23 et les emoji 2 ; hashtags, mentions ; adresses des posts par réseau', () => {
  assert.equal(compterCaracteres('Bonjour', 'x'), 7);
  assert.equal(compterCaracteres('Voir https://site-exemple.fr/une/tres/longue/adresse/qui/depasse', 'x'), 5 + 23);
  assert.equal(compterCaracteres('GG 🎉', 'x'), 5);
  assert.equal(compterCaracteres('GG 🎉', 'instagram'), 4);
  assert.equal(compterCaracteres('é'.repeat(281), 'x'), 281);
  assert.deepEqual(analyserTexte('a'.repeat(281), 'x').problemes, ['trop-long']);
  assert.deepEqual(analyserTexte('a'.repeat(281), 'instagram').problemes, []);
  assert.deepEqual(analyserTexte(Array.from({ length: 31 }, (_, i) => `#tag${i}`).join(' '), 'instagram').problemes, ['trop-de-hashtags']);
  assert.deepEqual(hashtags('Victoire ! #Esport #GG #esport #2026 rue#pas'), ['Esport', 'GG']);
  assert.deepEqual(mentions('Bravo @Kai_ et @lea.x. Écrire à contact@site-exemple.fr'), ['Kai_', 'lea.x']);
  assert.ok(urlPostValide('https://x.com/club/status/1', 'x'));
  assert.ok(urlPostValide('https://www.instagram.com/p/abc/', 'instagram'));
  assert.ok(!urlPostValide('https://x.com/club/status/1', 'instagram'));
  assert.ok(!urlPostValide('http://x.com/a', 'x'));
  assert.ok(!urlPostValide('https://x.com.site-exemple.fr/a', 'x'));
  assert.deepEqual(problemesPost({ reseaux: [], textes: {} }).map(p => p.code), ['aucun-reseau']);
  assert.deepEqual(problemesPost({ reseaux: ['x'], textes: { x: { fr: '', en: '' } } }).map(p => p.code), ['texte-manquant']);
  assert.deepEqual(problemesPost({ reseaux: ['x'], textes: { x: { fr: 'ok', en: '' } } }), []);
});

test('empreinte du contenu : stable, sensible au contenu, insensible à l’ordre des clés et des pièces', async () => {
  const a = await empreinteContenu({ titre: 'T', reseaux: ['x'], textes: { x: { fr: 'a', en: 'b' } }, datePublication: null, liens: {}, pieces: ['p1', 'p2'] });
  const b = await empreinteContenu({ liens: {}, pieces: ['p2', 'p1'], textes: { x: { en: 'b', fr: 'a' } }, titre: 'T', reseaux: ['x'], datePublication: null });
  const c = await empreinteContenu({ titre: 'T', reseaux: ['x'], textes: { x: { fr: 'a!', en: 'b' } }, datePublication: null, liens: {}, pieces: ['p1', 'p2'] });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('catalogue : module cm, permissions de team (voir, déposer, proposer des clips) ; les joueurs proposent des clips', () => {
  for (const p of ['cm.voir', 'cm.deposer', 'cm.clips.proposer']) assert.ok(TOUTES_PERMISSIONS.includes(p), p);
  for (const p of ['cm.editer', 'cm.valider', 'cm.gerer']) assert.ok(!TOUTES_PERMISSIONS.includes(p), `${p} : permission du club, jamais d’un rôle de team`);
  assert.ok(permissionsRoleSysteme('joueur').includes('cm.clips.proposer'));
  assert.ok(!permissionsRoleSysteme('joueur').includes('cm.voir'));
  assert.ok(permissionsRoleSysteme('manager').includes('cm.deposer'));
  for (const t of ['cm_roles', 'cm_affectations', 'cm_tableaux', 'cm_cartes', 'cm_clips', 'cm_fichiers', 'cm_pieces', 'cm_commentaires']) assert.ok(TABLES.some(([n]) => n === t), `export : ${t}`);
});

// ------------------------------------------------------------------ Migration

test('migration 0023 sur une base existante : rôles CM système, permissions de team, envois en cours gardés', async () => {
  const base = await baseVierge();
  const migrations = lireMigrations();
  await appliquerMigrations(base, migrations.filter(m => m.nom < '0023'));
  const d = '2026-01-01T00:00:00.000Z';
  await base.executer("INSERT INTO teams (id, nom, slug, jeu, cree_par, cree_le, maj_le) VALUES ('t', 'T', 't', 'valorant', 'principal', ?, ?)", [d, d]);
  for (const cle of ['manager', 'coach', 'joueur']) await base.executer('INSERT INTO roles (id, team_id, cle_systeme, nom, couleur, systeme, position, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)', [cle, 't', cle, cle, '#000000', d, d]);
  await base.executer("INSERT INTO roles (id, team_id, cle_systeme, nom, couleur, systeme, position, cree_le, maj_le) VALUES ('perso', 't', NULL, 'Perso', '#000000', 0, 9, ?, ?)", [d, d]);
  await base.executer(
    "INSERT INTO envois (id, team_id, compte_id, usage, nom_original, taille, taille_morceau, morceaux, recus, empreinte_etat, cle_stockage, statut, cree_le, maj_le) VALUES ('e1', 't', 'abc123', 'review', 'v.mp4', 10, 10, 1, 0, '{}', 'teams/t/videos/x.media', 'en_cours', ?, ?)",
    [d, d],
  );
  assert.deepEqual(await appliquerMigrations(base, migrations.filter(m => m.nom < '0024')), ['0023_cm.sql']);
  const perms = async role => (await base.tous("SELECT permission FROM role_permissions WHERE role_id = ? AND permission LIKE 'cm.%' ORDER BY permission", [role])).map(l => l.permission);
  assert.deepEqual(await perms('manager'), ['cm.clips.proposer', 'cm.deposer', 'cm.voir']);
  assert.deepEqual(await perms('joueur'), ['cm.clips.proposer']);
  assert.deepEqual(await perms('perso'), []);
  const e = await base.premier("SELECT * FROM envois WHERE id = 'e1'", []);
  assert.equal(e.portee, 't');
  assert.equal(e.usage, 'review');
  const roles = await base.tous('SELECT cle_systeme FROM cm_roles ORDER BY position', []);
  assert.deepEqual(roles.map(r => r.cle_systeme), ['responsable', 'correspondant']);
  assert.equal((await base.tous("SELECT module FROM team_modules WHERE module = 'cm'", [])).length, 0, 'module pas activé d’office');
  assert.deepEqual(await appliquerMigrations(base, migrations.filter(m => m.nom < '0024')), []);
});

// ------------------------------------------------------------------ Banc

async function preparer() {
  const b = await banc();
  const A = await teamAvecMembres(b, {
    membres: {
      coach123: { pseudo: 'Zed', role: 'coach' },
      lea12345: { pseudo: 'Léa', role: 'joueur' },
      kai12345: { pseudo: 'Kai', role: 'joueur' },
      man12345: { pseudo: 'Max', role: 'manager' },
    },
  });
  const B = await teamAvecMembres(b, { nom: 'Team Bravo', membres: { nox12345: { pseudo: 'Nox', role: 'joueur' } } });
  const s = { ...A.sessions, nox12345: B.sessions.nox12345 };
  // CM du club (Responsable CM, membre d'aucune team) et un rédacteur sans droit de valider.
  s.cm123456 = await b.session('cm123456', 'Clara');
  s.red12345 = await b.session('red12345', 'Remi');
  const api = (chemin, jeton, o = {}) => b.appel(chemin, { jeton, methode: o.methode, corps: o.corps });
  const ok = async (chemin, jeton, o = {}) => {
    const r = await api(chemin, jeton, o);
    assert.equal(r.statut, 200, `${o.methode ?? 'GET'} ${chemin} : ${r.statut} ${JSON.stringify(r.corps)}`);
    return r.corps;
  };
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'cm123456', roleId: 'cm-role-responsable', portee: 'club' } });
  return { b, A, B, s, api, ok };
}

const activerCm = (ok, s, teamId) => ok(`/teams/${teamId}/modules`, s.fondateur, { methode: 'PUT', corps: { modules: { cm: true } } });
// Le preset « Team Valorant complète » active le module CM : certains tests partent d'une team sans lui.
const desactiverCm = (ok, s, teamId) => ok(`/teams/${teamId}/modules`, s.fondateur, { methode: 'PUT', corps: { modules: { cm: false } } });

// ------------------------------------------------------------------ Permissions et périmètre

test('périmètre : le CM du club voit la section CM mais ni les strats, ni le scouting, ni les notes, ni un résultat staff', async () => {
  const { A, B, s, api, ok } = await preparer();
  await desactiverCm(ok, s, A.teamId);
  await desactiverCm(ok, s, B.teamId);
  const moi = await ok('/cm/moi', s.cm123456);
  assert.equal(moi.espace, true);
  assert.ok(moi.club.includes('cm.valider') && moi.gerer);
  // Module CM pas encore activé : la team n'apparaît pas, ses routes CM répondent 404.
  assert.deepEqual(moi.teams, []);
  assert.equal((await api(`/cm/teams/${A.teamId}`, s.cm123456)).statut, 404);
  await activerCm(ok, s, A.teamId);
  assert.equal((await ok('/cm/moi', s.cm123456)).teams.length, 1);
  // Hors section CM : la team reste fermée au CM (il n'en est pas membre).
  for (const chemin of [`/teams/${A.teamId}`, `/teams/${A.teamId}/strats`, `/teams/${A.teamId}/scouting/adversaires`, `/teams/${A.teamId}/suivi`, `/teams/${A.teamId}/resultats`, `/teams/${A.teamId}/planning`]) {
    assert.equal((await api(chemin, s.cm123456)).statut, 404, chemin);
  }
  // Résultats : seuls les publiables sortent (jamais un résultat staff, ni un scrim non publiable).
  const nova = (await ok(`/teams/${A.teamId}/scouting/adversaires`, s.coach123, { methode: 'POST', corps: { nom: 'Nova' } })).id;
  const resultat = corps => ok(`/teams/${A.teamId}/resultats`, s.coach123, { methode: 'POST', corps: { genre: 'officiel', date: '2026-10-19 20:00', bo: 1, adversaires: [{ id: nova }], manches: [{ carteCle: 'ascent', nous: 13, eux: 7 }], ...corps } });
  const publie = (await resultat({})).resultat.id;
  const staff = (await resultat({ visibilite: 'staff' })).resultat.id;
  const scrim = (await resultat({ genre: 'scrim' })).resultat.id;
  const matchs = await ok(`/cm/teams/${A.teamId}/matchs`, s.cm123456);
  assert.deepEqual(matchs.resultats.map(r => r.id), [publie]);
  assert.equal(JSON.stringify(matchs).includes('notes'), false);
  assert.equal((await api(`/cm/teams/${A.teamId}/resume?genre=resultat&id=${staff}`, s.cm123456)).corps.code, 'non-publiable');
  assert.equal((await api(`/cm/teams/${A.teamId}/resume?genre=resultat&id=${scrim}`, s.cm123456)).corps.code, 'non-publiable');
  const pre = await ok(`/cm/teams/${A.teamId}/resume?genre=resultat&id=${publie}`, s.cm123456);
  assert.match(pre.textes.x.fr, /Victoire 13-7 contre Nova/);
  assert.match(pre.textes.x.en, /Victory 13-7 vs Nova/);
  assert.equal(pre.liens.resultatId, publie);
});

test('permissions : joueur (clips seulement), correspondant de team, autre team 404, anti-escalade des rôles CM', async () => {
  const { A, B, s, api, ok } = await preparer();
  await activerCm(ok, s, A.teamId);
  // Joueur : propose des clips, ne voit ni les tableaux de sa team ni ceux du club.
  const pageJoueur = await ok(`/cm/teams/${A.teamId}`, s.lea12345);
  assert.deepEqual(pageJoueur.permissions, ['cm.clips.proposer']);
  assert.deepEqual(pageJoueur.tableaux, []);
  assert.equal((await ok('/cm/moi', s.lea12345)).espace, false);
  const club = (await ok('/cm/tableaux', s.cm123456)).tableaux.find(t => t.portee === 'club');
  assert.ok(club && club.cleDefaut === 'contenus');
  assert.equal((await api(`/cm/tableaux/${club.id}`, s.lea12345)).statut, 404);
  assert.equal((await api(`/cm/teams/${A.teamId}/depots`, s.lea12345, { methode: 'POST', corps: { titre: 'Info' } })).statut, 403);
  await desactiverCm(ok, s, B.teamId);
  // Joueur d'une autre team : 404 (la team n'existe pas pour lui).
  assert.equal((await api(`/cm/teams/${A.teamId}`, s.nox12345)).statut, 404);
  assert.equal((await api(`/cm/teams/${B.teamId}`, s.nox12345)).statut, 404, 'module CM pas activé dans Bravo');

  // Correspondant : rôle « Correspondant CM » sur la team (il doit en être membre actif).
  assert.equal((await api('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'nox12345', roleId: 'cm-role-correspondant', portee: A.teamId } })).corps.code, 'pas-membre');
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'kai12345', roleId: 'cm-role-correspondant', portee: A.teamId } });
  const pageKai = await ok(`/cm/teams/${A.teamId}`, s.kai12345);
  // 0027 : le Correspondant CM voit et alimente le Drive de sa team.
  assert.deepEqual(pageKai.permissions, ['cm.clips.proposer', 'cm.deposer', 'cm.drive.envoyer', 'cm.drive.voir', 'cm.reunions.voir', 'cm.voir']);
  assert.equal(pageKai.tableaux.length, 1);
  assert.equal((await api(`/cm/tableaux/${club.id}`, s.kai12345)).statut, 404, 'le correspondant ne voit pas le tableau du club');
  const depot = await ok(`/cm/teams/${A.teamId}/depots`, s.kai12345, { methode: 'POST', corps: { genre: 'recrue', titre: 'Nouvelle recrue', description: 'Bienvenue à **Ivy**', liens: ['https://site-exemple.fr/photo'] } });
  const carte = await ok(`/cm/cartes/${depot.id}`, s.kai12345);
  assert.equal(carte.carte.depotGenre, 'recrue');
  assert.equal(carte.carte.pieces[0].url, 'https://site-exemple.fr/photo');
  assert.equal(carte.droits.modifier, true, 'il retouche son dépôt');
  await ok(`/cm/cartes/${depot.id}`, s.kai12345, { methode: 'PATCH', corps: { titre: 'Nouvelle recrue : Ivy' } });
  assert.equal((await api(`/cm/cartes/${depot.id}`, s.kai12345, { methode: 'PATCH', corps: { post: true } })).statut, 403);
  assert.equal((await api(`/cm/cartes/${depot.id}/deplacer`, s.kai12345, { methode: 'POST', corps: { listeId: carte.carte.listeId, index: 0 } })).statut, 403);
  // Le CM du club voit le dépôt (tableau de la team) et en est prévenu.
  assert.equal((await ok(`/cm/cartes/${depot.id}`, s.cm123456)).carte.titre, 'Nouvelle recrue : Ivy');
  assert.ok((await ok('/notifications', s.cm123456)).liste.some(n => n.type === 'cm-depot'));
  // Le Manager de la team (cm.voir + cm.deposer par son rôle) voit la partie CM ; le retrait du module la ferme.
  assert.ok((await ok(`/cm/teams/${A.teamId}`, s.man12345)).permissions.includes('cm.deposer'));
  await ok(`/teams/${A.teamId}/modules`, s.fondateur, { methode: 'PUT', corps: { modules: { cm: false } } });
  assert.equal((await api(`/cm/teams/${A.teamId}`, s.kai12345)).corps.code, 'module-desactive');
  assert.equal((await api(`/cm/cartes/${depot.id}`, s.cm123456)).statut, 404);

  // Rôles CM : un gestionnaire sans cm.valider ne crée pas de rôle qui l'a (anti-escalade) ; rôle système verrouillé.
  const role = await ok('/cm/roles', s.fondateur, { methode: 'POST', corps: { nom: 'Rédacteur', couleur: '#123456', permissions: ['cm.voir', 'cm.editer', 'cm.gerer'] } });
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'red12345', roleId: role.id, portee: 'club' } });
  assert.equal((await api('/cm/roles', s.red12345, { methode: 'POST', corps: { nom: 'Valideur', permissions: ['cm.voir', 'cm.valider'] } })).corps.code, 'escalade');
  assert.equal((await api(`/cm/roles/${role.id}`, s.red12345, { methode: 'PATCH', corps: { permissions: ['cm.voir', 'cm.editer', 'cm.gerer', 'cm.valider'] } })).corps.code, 'escalade');
  assert.equal((await api('/cm/affectations', s.red12345, { methode: 'POST', corps: { compte: 'lea12345', roleId: 'cm-role-responsable', portee: 'club' } })).corps.code, 'escalade');
  assert.equal((await api('/cm/roles/cm-role-responsable', s.fondateur, { methode: 'PATCH', corps: { nom: 'Chef' } })).corps.code, 'role-systeme');
  const modifie = await ok('/cm/roles/cm-role-correspondant', s.fondateur, { methode: 'PATCH', corps: { permissions: ['cm.voir', 'cm.deposer'] } });
  assert.equal(modifie.modifie, true);
  assert.equal((await ok('/cm/roles/cm-role-correspondant/retablir', s.fondateur, { methode: 'POST' })).modifie, false);
  assert.equal((await api('/cm/roles', s.lea12345)).statut, 403);
  assert.ok((await ok('/notifications', s.red12345)).liste.some(n => n.type === 'cm-affecte'));
});

// ------------------------------------------------------------------ Tableaux

test('tableaux : listes, cartes, glisser-déposer, étiquettes, checklists, commentaires et mentions, recherche, versions', async () => {
  const { s, api, ok } = await preparer();
  const { tableaux } = await ok('/cm/tableaux', s.cm123456);
  const club = tableaux.find(t => t.cleDefaut === 'contenus');
  let t = await ok(`/cm/tableaux/${club.id}`, s.cm123456);
  assert.deepEqual(t.listes.map(l => l.cle), ['idees', 'preparation', 'a_valider', 'valide', 'publie']);
  assert.ok(t.droits.editer && t.droits.valider);
  const [idees, prepa] = t.listes;
  const v0 = (await ok('/cm/etat', s.cm123456)).versions[club.id];
  const c1 = (await ok(`/cm/tableaux/${club.id}/cartes`, s.cm123456, { methode: 'POST', corps: { listeId: idees.id, titre: 'Carte 1' } })).carte;
  const c2 = (await ok(`/cm/tableaux/${club.id}/cartes`, s.cm123456, { methode: 'POST', corps: { listeId: idees.id, titre: 'Carte 2', description: '<b>gras</b> [x](javascript:alert(1))' } })).carte;
  const c3 = (await ok(`/cm/tableaux/${club.id}/cartes`, s.cm123456, { methode: 'POST', corps: { listeId: idees.id, titre: 'Carte 3' } })).carte;
  assert.equal(c2.description, '&lt;b&gt;gras&lt;/b&gt; x', 'Markdown nettoyé (HTML neutralisé, lien non http retiré)');
  assert.ok((await ok('/cm/etat', s.cm123456)).versions[club.id] > v0, 'la version du tableau augmente');
  // Glisser-déposer : Carte 3 en tête de liste, puis Carte 1 dans « En préparation ».
  await ok(`/cm/cartes/${c3.id}/deplacer`, s.cm123456, { methode: 'POST', corps: { listeId: idees.id, index: 0 } });
  await ok(`/cm/cartes/${c1.id}/deplacer`, s.cm123456, { methode: 'POST', corps: { listeId: prepa.id, index: 0 } });
  t = await ok(`/cm/tableaux/${club.id}`, s.cm123456);
  assert.deepEqual(t.cartes.filter(c => c.listeId === idees.id).sort((a, b) => a.position - b.position).map(c => c.titre), ['Carte 3', 'Carte 2']);
  assert.equal(t.cartes.find(c => c.id === c1.id).listeId, prepa.id);
  // Beaucoup d'insertions au même endroit : les positions restent distinctes (renumérotation).
  for (let i = 0; i < 60; i++) await ok(`/cm/cartes/${i % 2 ? c2.id : c3.id}/deplacer`, s.cm123456, { methode: 'POST', corps: { listeId: idees.id, index: 1 } });
  t = await ok(`/cm/tableaux/${club.id}`, s.cm123456);
  const pos = t.cartes.filter(c => c.listeId === idees.id).map(c => c.position);
  assert.equal(new Set(pos).size, pos.length);
  // Listes : création, renommage, déplacement.
  const liste = await ok(`/cm/tableaux/${club.id}/listes`, s.cm123456, { methode: 'POST', corps: { nom: 'Sponsors' } });
  await ok(`/cm/listes/${liste.id}/deplacer`, s.cm123456, { methode: 'POST', corps: { index: 0 } });
  await ok(`/cm/listes/${idees.id}`, s.cm123456, { methode: 'PATCH', corps: { nom: 'Idées du club' } });
  t = await ok(`/cm/tableaux/${club.id}`, s.cm123456);
  assert.equal(t.listes[0].nom, 'Sponsors');
  assert.equal(t.listes.find(l => l.id === idees.id).cle, 'idees', 'renommée, la liste garde son rôle');
  // Étiquettes, membres (seulement les personnes du tableau), échéance, checklist, commentaire avec @mention.
  const etiquette = await ok(`/cm/tableaux/${club.id}/etiquettes`, s.cm123456, { methode: 'POST', corps: { nom: 'Vidéo', couleur: '#4bce97' } });
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'red12345', roleId: 'cm-role-correspondant', portee: 'club' } });
  assert.equal((await api(`/cm/cartes/${c1.id}`, s.cm123456, { methode: 'PATCH', corps: { membres: ['lea12345'] } })).corps.code, 'membre');
  let d = await ok(`/cm/cartes/${c1.id}`, s.cm123456, { methode: 'PATCH', corps: { etiquettes: [etiquette.id], membres: ['red12345'], echeance: '2026-11-02 18:00', couverture: { couleur: '#579dff' } } });
  assert.deepEqual(d.carte.etiquettes, [etiquette.id]);
  assert.equal(d.carte.echeance, '2026-11-02T17:00:00.000Z', 'heure de Paris');
  assert.ok((await ok('/notifications', s.red12345)).liste.some(n => n.type === 'cm-assigne'));
  d = await ok(`/cm/cartes/${c1.id}/checklists`, s.cm123456, { methode: 'POST', corps: { nom: 'À faire' } });
  d = await ok(`/cm/checklists/${d.carte.checklists[0].id}/elements`, s.cm123456, { methode: 'POST', corps: { texte: 'Visuel' } });
  d = await ok(`/cm/elements/${d.carte.checklists[0].elements[0].id}`, s.cm123456, { methode: 'PATCH', corps: { fait: true } });
  assert.equal(d.carte.checklists[0].elements[0].fait, true);
  d = await ok(`/cm/cartes/${c1.id}/commentaires`, s.cm123456, { methode: 'POST', corps: { texte: 'Tu peux relire @Remi ? <script>x</script>' } });
  assert.match(d.carte.commentaires[0].texte, /&lt;script&gt;/);
  assert.ok((await ok('/notifications', s.red12345)).liste.some(n => n.type === 'cm-mention'));
  t = await ok(`/cm/tableaux/${club.id}`, s.cm123456);
  const resume = t.cartes.find(c => c.id === c1.id);
  assert.deepEqual([resume.commentaires, resume.checklist, resume.membres, resume.couverture], [1, { total: 1, faits: 1 }, ['red12345'], { couleur: '#579dff' }]);
  assert.ok(d.carte.activite.some(a => a.action === 'deplacee'));
  // Recherche, archivage.
  assert.deepEqual((await ok('/cm/recherche?q=carte%202', s.cm123456)).cartes.map(c => c.id), [c2.id]);
  assert.deepEqual((await ok('/cm/recherche?q=%25', s.cm123456)).cartes, [], 'les jokers SQL sont échappés');
  await ok(`/cm/cartes/${c2.id}`, s.cm123456, { methode: 'PATCH', corps: { archive: true } });
  assert.ok(!(await ok(`/cm/tableaux/${club.id}`, s.cm123456)).cartes.some(c => c.id === c2.id));
  assert.ok((await ok(`/cm/tableaux/${club.id}?archives=1`, s.cm123456)).cartes.some(c => c.id === c2.id));
  // Le tableau par défaut ne se supprime pas ; un autre si (cm.gerer).
  assert.equal((await api(`/cm/tableaux/${club.id}`, s.cm123456, { methode: 'DELETE' })).corps.code, 'tableau-defaut');
  const autre = await ok('/cm/tableaux', s.cm123456, { methode: 'POST', corps: { nom: 'Sponsors', modele: 'contenus' } });
  assert.equal(autre.listes.length, 5);
  await ok(`/cm/tableaux/${autre.tableau.id}`, s.cm123456, { methode: 'DELETE' });
  assert.equal((await api(`/cm/tableaux/${autre.tableau.id}`, s.cm123456)).statut, 404);
});

// ------------------------------------------------------------------ Posts et validation

test('posts : soumission, validation, invalidation après modification, refus motivé, publication et cm.post_publie', async () => {
  const { b, s, api, ok } = await preparer();
  const role = await ok('/cm/roles', s.fondateur, { methode: 'POST', corps: { nom: 'Rédacteur', permissions: ['cm.voir', 'cm.editer', 'cm.deposer'] } });
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'red12345', roleId: role.id, portee: 'club' } });
  const club = (await ok('/cm/tableaux', s.red12345)).tableaux.find(t => t.cleDefaut === 'contenus');
  const t = await ok(`/cm/tableaux/${club.id}`, s.red12345);
  const liste = cle => t.listes.find(l => l.cle === cle).id;
  let p = await ok(`/cm/tableaux/${club.id}/cartes`, s.red12345, { methode: 'POST', corps: { listeId: liste('idees'), titre: 'Annonce', post: true, reseaux: ['x', 'instagram'] } });
  const id = p.carte.id;
  assert.equal(p.carte.statut, 'brouillon');
  // Textes manquants, puis trop longs pour X : la soumission est refusée avec le détail.
  let r = await api(`/cm/cartes/${id}/soumettre`, s.red12345, { methode: 'POST' });
  assert.equal(r.corps.code, 'post-incomplet');
  await ok(`/cm/cartes/${id}`, s.red12345, { methode: 'PATCH', corps: { textes: { x: { fr: 'a'.repeat(300), en: '' }, instagram: { fr: 'Texte', en: 'Text' } } } });
  r = await api(`/cm/cartes/${id}/soumettre`, s.red12345, { methode: 'POST' });
  assert.deepEqual(r.corps.details.problemes, [{ reseau: 'x', langue: 'fr', code: 'trop-long' }]);
  await ok(`/cm/cartes/${id}`, s.red12345, { methode: 'PATCH', corps: { textes: { x: { fr: 'Ce soir on joue ! #GG', en: 'Tonight we play! #GG' }, instagram: { fr: 'Texte', en: 'Text' } }, datePublication: '2026-11-03 18:00' } });
  p = await ok(`/cm/cartes/${id}/soumettre`, s.red12345, { methode: 'POST' });
  assert.equal(p.carte.statut, 'a_valider');
  assert.equal(p.carte.listeId, liste('a_valider'), 'rangé dans « À valider »');
  // Le rédacteur ne valide pas (cm.valider) ; il ne publie pas un post non validé.
  assert.equal((await api(`/cm/cartes/${id}/valider`, s.red12345, { methode: 'POST', corps: {} })).statut, 403);
  assert.equal((await api(`/cm/cartes/${id}/publier`, s.red12345, { methode: 'POST', corps: {} })).corps.code, 'validation-requise');
  // File « À valider » et notification des valideurs.
  const file = await ok('/cm/a-valider', s.cm123456);
  assert.deepEqual(file.cartes.map(c => c.id), [id]);
  assert.ok(file.cartes[0].droits.valider);
  assert.equal((await ok('/cm/etat', s.cm123456)).aValider, 1);
  assert.ok((await ok('/notifications', s.cm123456)).liste.some(n => n.type === 'cm-a-valider'));
  // Version attendue périmée : refus (on valide ce qu'on a lu).
  assert.equal((await api(`/cm/cartes/${id}/valider`, s.cm123456, { methode: 'POST', corps: { versionAttendue: 1 } })).corps.code, 'modifiee-entre-temps');
  p = await ok(`/cm/cartes/${id}/valider`, s.cm123456, { methode: 'POST', corps: { versionAttendue: p.carte.version, commentaire: 'Parfait' } });
  assert.equal(p.carte.statut, 'valide');
  assert.equal(p.carte.listeId, liste('valide'));
  assert.ok((await ok('/notifications', s.red12345)).liste.some(n => n.type === 'cm-valide'));
  // Les étiquettes, commentaires ou checklists ne touchent pas au contenu : le post reste validé.
  await ok(`/cm/cartes/${id}/commentaires`, s.red12345, { methode: 'POST', corps: { texte: 'Merci' } });
  assert.equal((await ok(`/cm/cartes/${id}`, s.red12345)).carte.statut, 'valide');
  // Toute modification du contenu après validation : retour « à valider », valideurs prévenus.
  p = await ok(`/cm/cartes/${id}`, s.red12345, { methode: 'PATCH', corps: { textes: { x: { fr: 'Ce soir on joue !! #GG', en: 'Tonight we play! #GG' }, instagram: { fr: 'Texte', en: 'Text' } } } });
  assert.equal(p.carte.statut, 'a_valider');
  assert.equal(p.carte.validePar, null);
  assert.ok(p.carte.activite.some(a => a.action === 'invalidee'));
  // Même chose pour une pièce jointe ajoutée, ou une date changée.
  p = await ok(`/cm/cartes/${id}/valider`, s.cm123456, { methode: 'POST', corps: { versionAttendue: p.carte.version } });
  p = await ok(`/cm/cartes/${id}/pieces`, s.red12345, { methode: 'POST', corps: { genre: 'lien', url: 'https://site-exemple.fr/visuel.png', nom: 'Visuel' } });
  assert.equal(p.carte.statut, 'a_valider');
  p = await ok(`/cm/cartes/${id}/valider`, s.cm123456, { methode: 'POST', corps: { versionAttendue: p.carte.version } });
  p = await ok(`/cm/cartes/${id}`, s.red12345, { methode: 'PATCH', corps: { datePublication: '2026-11-04 18:00' } });
  assert.equal(p.carte.statut, 'a_valider');
  // Refus : motif obligatoire, l'auteur est prévenu, le post revient « En préparation ».
  assert.equal((await api(`/cm/cartes/${id}/refuser`, s.cm123456, { methode: 'POST', corps: {} })).corps.code, 'motif');
  p = await ok(`/cm/cartes/${id}/refuser`, s.cm123456, { methode: 'POST', corps: { motif: 'Mauvaise date' } });
  assert.deepEqual([p.carte.statut, p.carte.refusMotif, p.carte.listeId], ['refuse', 'Mauvaise date', liste('preparation')]);
  assert.ok((await ok('/notifications', s.red12345)).liste.some(n => n.type === 'cm-refuse' && n.charge.motif === 'Mauvaise date'));
  p = await ok(`/cm/cartes/${id}/soumettre`, s.red12345, { methode: 'POST' });
  p = await ok(`/cm/cartes/${id}/valider`, s.cm123456, { methode: 'POST', corps: { versionAttendue: p.carte.version } });
  // Publication : adresses par réseau ciblé, sur le domaine du réseau.
  assert.equal((await api(`/cm/cartes/${id}/publier`, s.red12345, { methode: 'POST', corps: { publications: { x: 'https://site-exemple.fr/post' } } })).corps.code, 'url-post');
  assert.equal((await api(`/cm/cartes/${id}/publier`, s.red12345, { methode: 'POST', corps: { publications: { tiktok: 'https://tiktok.com/@club/video/1' } } })).corps.code, 'publications');
  p = await ok(`/cm/cartes/${id}/publier`, s.red12345, { methode: 'POST', corps: { publications: { x: 'https://x.com/club/status/1' } } });
  assert.deepEqual([p.carte.statut, p.carte.publications, p.carte.listeId], ['publie', { x: 'https://x.com/club/status/1' }, liste('publie')]);
  const ev = await b.base.premier("SELECT * FROM evenements WHERE type = 'cm.post_publie' AND entite_id = ?", [id]);
  assert.deepEqual(JSON.parse(ev.charge).reseaux, ['x', 'instagram']);
  assert.equal(JSON.parse(ev.charge).publications.x, 'https://x.com/club/status/1');
  // Adresse ajoutée ensuite : pas de nouvel événement ; contenu verrouillé tant que le post est publié.
  await ok(`/cm/cartes/${id}/publier`, s.red12345, { methode: 'POST', corps: { publications: { instagram: 'https://www.instagram.com/p/abc/' } } });
  assert.equal((await b.base.tous("SELECT id FROM evenements WHERE type = 'cm.post_publie'", [])).length, 1);
  assert.equal((await api(`/cm/cartes/${id}`, s.red12345, { methode: 'PATCH', corps: { titre: 'Autre' } })).corps.code, 'post-publie');
  // Calendrier éditorial : le post prévu le 4 novembre.
  const cal = await ok('/cm/calendrier?du=2026-11-01&au=2026-11-30', s.red12345);
  assert.deepEqual(cal.cartes.map(c => [c.id, c.datePublication]), [[id, '2026-11-04T17:00:00.000Z']]);
  assert.deepEqual((await ok('/cm/calendrier?du=2026-11-01&au=2026-11-30&reseau=tiktok', s.red12345)).cartes, []);
  assert.equal((await api('/cm/calendrier?du=2026-01-01&au=2026-12-31', s.red12345)).corps.code, 'periode');
  // Journal : la team n'en voit rien (portée club) ; le journal de la section, si.
  assert.ok((await ok('/cm/journal', s.cm123456)).entrees.some(e => e.action === 'cm.post_publie'));
});

// ------------------------------------------------------------------ Suggestions automatiques

test('suggestions : tournoi, J-1 et jour J d’un match, résultat, classement final ; jamais un résultat staff ; désactivables', async () => {
  const { A, s, ok } = await preparer();
  const t = `/teams/${A.teamId}/tournois`;
  await desactiverCm(ok, s, A.teamId);
  // Module CM inactif : aucune suggestion.
  await ok(t, s.coach123, { methode: 'POST', corps: { nom: 'Coupe muette', formatCle: '5v5', bo: 3 } });
  const idees = async () => {
    const club = (await ok('/cm/tableaux', s.cm123456)).tableaux.find(x => x.cleDefaut === 'contenus');
    const tb = await ok(`/cm/tableaux/${club.id}`, s.cm123456);
    const l = tb.listes.find(x => x.cle === 'idees').id;
    return tb.cartes.filter(c => c.listeId === l && c.origine === 'suggestion');
  };
  assert.equal((await idees()).length, 0);
  await activerCm(ok, s, A.teamId);
  const tournoi = (await ok(t, s.coach123, { methode: 'POST', corps: { nom: 'Coupe d’automne', formatCle: '5v5', bo: 3 } })).tournoi;
  let cartes = await idees();
  assert.deepEqual(cartes.map(c => c.titre), ['Annonce : Coupe d’automne']);
  assert.ok(cartes[0].post && cartes[0].statut === 'brouillon');
  const nova = (await ok(`/teams/${A.teamId}/scouting/adversaires`, s.coach123, { methode: 'POST', corps: { nom: 'Nova' } })).id;
  const match = await ok(`${t}/${tournoi.id}/matchs`, s.coach123, { methode: 'POST', corps: { tour: 'Quart de finale', date: '2026-10-24', heure: '20:00', adversaires: [{ id: nova }] } });
  const matchId = match.matchs.at(-1).id;
  cartes = await idees();
  const j1 = cartes.find(c => c.titre.startsWith('J-1'));
  const jourj = cartes.find(c => c.titre.startsWith('Jour J'));
  assert.equal(j1.datePublication, '2026-10-23T18:00:00.000Z');
  assert.equal(jourj.datePublication, '2026-10-24T15:00:00.000Z');
  const detail = await ok(`/cm/cartes/${j1.id}`, s.cm123456);
  assert.match(detail.carte.textes.x.fr, /^Demain : Team Alpha · Coupe d’automne · Quart de finale contre Nova/);
  assert.match(detail.carte.textes.x.en, /^Tomorrow: Team Alpha · Coupe d’automne · Quart de finale vs Nova/);
  assert.equal(detail.carte.liens.matchId, matchId);
  // Match redaté : la suggestion pas retouchée suit ; retouchée, elle ne bouge plus.
  await ok(`/cm/cartes/${jourj.id}`, s.cm123456, { methode: 'PATCH', corps: { titre: 'Jour J retouché' } });
  await ok(`${t}/${tournoi.id}/matchs/${matchId}`, s.coach123, { methode: 'PATCH', corps: { date: '2026-10-25', heure: '20:00' } });
  cartes = await idees();
  assert.equal(cartes.find(c => c.id === j1.id).datePublication, '2026-10-24T19:00:00.000Z', 'heure d’hiver le 25');
  assert.equal(cartes.find(c => c.id === jourj.id).datePublication, '2026-10-24T15:00:00.000Z');
  assert.equal(cartes.filter(c => c.titre.startsWith('J-1')).length, 1, 'pas de doublon');
  // Résultats : publiable → suggestion ; staff → rien.
  const r = `/teams/${A.teamId}/resultats`;
  await ok(r, s.coach123, { methode: 'POST', corps: { genre: 'officiel', date: '2026-10-19 20:00', bo: 1, adversaires: [{ id: nova }], manches: [{ carteCle: 'ascent', nous: 13, eux: 7 }], visibilite: 'staff' } });
  assert.equal((await idees()).filter(c => c.titre.startsWith('Résultat')).length, 0);
  await ok(r, s.coach123, { methode: 'POST', corps: { genre: 'officiel', date: '2026-10-19 20:00', bo: 1, adversaires: [{ id: nova }], manches: [{ carteCle: 'ascent', nous: 13, eux: 7 }] } });
  assert.deepEqual((await idees()).filter(c => c.titre.startsWith('Résultat')).map(c => c.titre), ['Résultat · Match officiel · Victoire 13-7 contre Nova']);
  // Classement final.
  await ok(`${t}/${tournoi.id}`, s.coach123, { methode: 'PATCH', corps: { classementFinal: 3, participants: 16 } });
  await ok(`${t}/${tournoi.id}`, s.coach123, { methode: 'PATCH', corps: { statut: 'termine' } });
  assert.ok((await idees()).some(c => c.titre === 'Classement final : Coupe d’automne'));
  // Désactivées : plus rien.
  await ok('/cm/reglages', s.cm123456, { methode: 'PUT', corps: { suggestions: { actif: false } } });
  await ok(t, s.coach123, { methode: 'POST', corps: { nom: 'Coupe d’hiver', formatCle: '5v5', bo: 3 } });
  assert.ok(!(await idees()).some(c => c.titre.includes('hiver')));
  await ok('/cm/reglages', s.cm123456, { methode: 'PUT', corps: { suggestions: { actif: true, types: { tournoi: false }, hashtags: '#GoAlpha' } } });
  await ok(t, s.coach123, { methode: 'POST', corps: { nom: 'Coupe de printemps', formatCle: '5v5', bo: 3 } });
  assert.ok(!(await idees()).some(c => c.titre.includes('printemps')));
  assert.equal((await ok('/cm/reglages', s.cm123456)).suggestions.hashtags, '#GoAlpha');
});

// ------------------------------------------------------------------ Clips

test('clips : proposition (lien ou fichier), visibilité, tri par le CM, carte, notifications du proposeur', async () => {
  const { b, A, s, api, ok } = await preparer();
  await activerCm(ok, s, A.teamId);
  const nova = (await ok(`/teams/${A.teamId}/scouting/adversaires`, s.coach123, { methode: 'POST', corps: { nom: 'Nova' } })).id;
  const resultat = (await ok(`/teams/${A.teamId}/resultats`, s.coach123, { methode: 'POST', corps: { genre: 'officiel', date: '2026-10-19 20:00', bo: 1, adversaires: [{ id: nova }], manches: [{ carteCle: 'ascent', nous: 13, eux: 7 }] } })).resultat.id;
  const staff = (await ok(`/teams/${A.teamId}/resultats`, s.coach123, { methode: 'POST', corps: { genre: 'officiel', date: '2026-10-19 20:00', bo: 1, adversaires: [{ id: nova }], manches: [{ carteCle: 'ascent', nous: 13, eux: 7 }], visibilite: 'staff' } })).resultat.id;
  const c = `/cm/teams/${A.teamId}/clips`;
  assert.equal((await api(c, s.lea12345, { methode: 'POST', corps: { genre: 'lien', url: 'javascript:alert(1)', titre: 'Ace' } })).corps.code, 'lien');
  assert.equal((await api(c, s.lea12345, { methode: 'POST', corps: { genre: 'lien', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', titre: 'Ace', resultatId: staff } })).corps.code, 'resultat');
  assert.equal((await api(c, s.lea12345, { methode: 'POST', corps: { genre: 'lien', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', titre: 'Ace', instant: '99:99' } })).corps.code, 'instant');
  const liste = await ok(c, s.lea12345, { methode: 'POST', corps: { genre: 'lien', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', titre: 'Ace sur Ascent', description: 'Round 12', instant: '12:34', resultatId: resultat } });
  const clip = liste.clips[0];
  assert.deepEqual([clip.instant, clip.youtube, clip.statut, clip.resultat.adversaires], [754, 'dQw4w9WgXcQ', 'propose', ['Nova']]);
  // Fichier (envoi par morceaux, portée de la team).
  const octets = mp4Factice({ taille: 3000 });
  const debut = await ok(`/cm/portees/${A.teamId}/envois`, s.kai12345, { methode: 'POST', corps: { nom: 'clip.mp4', taille: octets.length } });
  assert.equal((await morceau(b, s.kai12345, `/cm/portees/${A.teamId}/envois/${debut.id}`, 0, octets)).statut, 200);
  await ok(`/cm/portees/${A.teamId}/envois/${debut.id}/fin`, s.kai12345, { methode: 'POST', corps: { sha256: sha(octets) } });
  const avecFichier = await ok(c, s.kai12345, { methode: 'POST', corps: { genre: 'fichier', envoi: debut.id, titre: 'Clutch 1v3' } });
  const clipFichier = avecFichier.clips.find(x => x.genre === 'fichier');
  assert.equal(clipFichier.fichier.type, 'video/mp4');
  // Chacun voit ses clips ; le CM les voit tous, et en a été prévenu.
  assert.deepEqual((await ok(c, s.lea12345)).clips.map(x => x.titre), ['Ace sur Ascent']);
  assert.equal((await ok(c, s.lea12345)).tous, false);
  assert.equal((await api(`/cm/clips/${clipFichier.id}/lien`, s.lea12345, { methode: 'POST', corps: {} })).statut, 404, 'clip d’un autre joueur');
  assert.equal((await ok('/cm/clips', s.cm123456)).clips.length, 2);
  assert.ok((await ok('/notifications', s.cm123456)).liste.some(n => n.type === 'cm-clip-propose'));
  // Lien signé du fichier : lisible par l'auteur et le CM, pas par un compte qui n'a plus accès.
  const lien = await ok(`/cm/clips/${clipFichier.id}/lien`, s.kai12345, { methode: 'POST', corps: {} });
  const lu = await b.brut(lien.url);
  assert.equal(lu.status, 200);
  assert.equal(lu.headers.get('Content-Type'), 'video/mp4');
  const faux = new URL(lien.url);
  faux.searchParams.set('c', 'lea12345');
  assert.equal((await b.brut(faux.toString())).status, 403, 'signature liée au compte');
  const lienCm = await ok(`/cm/clips/${clipFichier.id}/lien`, s.cm123456, { methode: 'POST', corps: {} });
  assert.equal((await b.brut(lienCm.url)).status, 200);
  // Tri : le joueur ne décide pas ; refus motivé, notification du proposeur.
  assert.equal((await api(`/cm/clips/${clip.id}`, s.lea12345, { methode: 'PATCH', corps: { statut: 'retenu' } })).statut, 403);
  await ok(`/cm/clips/${clip.id}`, s.cm123456, { methode: 'PATCH', corps: { statut: 'refuse', motif: 'Trop court' } });
  const notifLea = (await ok('/notifications', s.lea12345)).liste.find(n => n.type === 'cm-clip-decide');
  assert.deepEqual([notifLea.charge.statut, notifLea.charge.motif], ['refuse', 'Trop court']);
  // Carte : post brouillon dans « Idées » du club, le clip en pièce jointe, lié au résultat ; clip « utilisé ».
  await ok(`/cm/clips/${clip.id}`, s.cm123456, { methode: 'PATCH', corps: { statut: 'retenu' } });
  const { carteId } = await ok(`/cm/clips/${clip.id}/carte`, s.cm123456, { methode: 'POST', corps: {} });
  const carte = await ok(`/cm/cartes/${carteId}`, s.cm123456);
  assert.deepEqual([carte.carte.post, carte.carte.origine, carte.carte.liens.resultatId, carte.carte.liens.clips, carte.carte.pieces[0].url], [true, 'clip', resultat, [clip.id], 'https://www.youtube.com/watch?v=dQw4w9WgXcQ']);
  assert.equal(carte.carte.resumes.resultat.phrase, 'Victoire 13-7 contre Nova');
  assert.equal((await ok(c, s.lea12345)).clips[0].statut, 'utilise');
  // Clip fichier joint à une carte existante : même fichier, pas de copie.
  await ok(`/cm/clips/${clipFichier.id}/carte`, s.cm123456, { methode: 'POST', corps: { carteId } });
  const avec = await ok(`/cm/cartes/${carteId}`, s.cm123456);
  assert.equal(avec.carte.pieces.length, 2);
  const lienPiece = await ok(`/cm/pieces/${avec.carte.pieces.find(x => x.genre === 'fichier').id}/lien`, s.cm123456, { methode: 'POST', corps: { telecharger: true } });
  assert.match((await b.brut(lienPiece.url)).headers.get('Content-Disposition'), /attachment/);
});

// ------------------------------------------------------------------ Import Trello

test('import Trello : aperçu, import (listes, cartes, étiquettes, checklists, commentaires, liens), contenu hostile neutralisé', async () => {
  const { s, api, ok } = await preparer();
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'red12345', roleId: 'cm-role-correspondant', portee: 'club' } });
  const apercu = await ok('/cm/import/trello/apercu', s.cm123456, { methode: 'POST', corps: { trello: TRELLO } });
  assert.deepEqual([apercu.bilan.listes, apercu.bilan.cartes, apercu.bilan.etiquettes, apercu.bilan.commentaires, apercu.bilan.piecesDeposees], [3, 3, 3, 2, 2]);
  assert.deepEqual(apercu.archivees, { listes: 1, cartes: 1 });
  assert.deepEqual(apercu.membresTrello.map(m => m.identifiant), ['alice_ex', 'bobex']);
  assert.equal(apercu.dejaImporte, null);
  assert.equal(apercu.piecesIgnorees, 1, 'javascript: ignoré');
  const imp = await ok('/cm/import/trello', s.cm123456, { methode: 'POST', corps: { trello: TRELLO, correspondances: { [TRELLO.members[0].id]: 'red12345', [TRELLO.members[1].id]: 'lea12345' } } });
  assert.equal(imp.nouveau, true);
  assert.equal(imp.bilan.membresAssocies, 1, 'un compte sans accès au tableau n’est pas associé');
  const tb = await ok(`/cm/tableaux/${imp.tableauId}`, s.cm123456);
  assert.equal(tb.tableau.nom, 'Contenus réseaux (exemple)');
  assert.deepEqual(tb.listes.map(l => l.nom), ['Idées', 'En cours', 'Publié']);
  assert.deepEqual(tb.cartes.filter(c => c.listeId === tb.listes[1].id).map(c => c.titre), ['Interview joueur', 'Recap de la semaine'], 'positions de Trello');
  const annonce = tb.cartes.find(c => c.titre === 'Annonce du tournoi d’automne');
  assert.deepEqual([annonce.etiquettes.length, annonce.membres, annonce.checklist, annonce.pieces, annonce.couverture], [2, ['red12345'], { total: 3, faits: 1 }, 2, { couleur: '#6cc3e0' }]);
  assert.equal(tb.etiquettes.find(e => e.nom === 'Urgent').couleur, '#c9372c');
  const detail = await ok(`/cm/cartes/${annonce.id}`, s.cm123456);
  assert.equal(detail.carte.description.includes('<script>'), false);
  assert.equal(detail.carte.description.includes('javascript:'), false);
  assert.match(detail.carte.description, /\[lien sûr\]\(https:\/\/site-exemple\.fr\/page\)/);
  assert.equal(detail.carte.echeance, '2026-11-02T17:00:00.000Z');
  assert.deepEqual(detail.carte.commentaires.map(c => [c.auteur, c.auteurNom, c.texte.includes('<img')]), [['red12345', null, false]]);
  const recap = await ok(`/cm/cartes/${tb.cartes.find(c => c.titre === 'Recap de la semaine').id}`, s.cm123456);
  assert.deepEqual(recap.carte.commentaires.map(c => [c.auteur, c.auteurNom]), [[null, 'Bob Exemple']]);
  assert.deepEqual(detail.carte.pieces.map(p => [p.genre, p.trello]).sort(), [['lien', false], ['lien', true]]);
  assert.ok(detail.carte.trello);
  // Relancer : rien n'est dupliqué ; les changements de Trello sont repris (sauf une carte devenue post).
  await ok(`/cm/cartes/${annonce.id}`, s.cm123456, { methode: 'PATCH', corps: { post: true } });
  const modifie = copie(TRELLO);
  modifie.cards[1].name = 'Recap hebdo';
  modifie.cards[0].name = 'Titre changé dans Trello';
  modifie.actions.push({ id: 'f'.repeat(24), type: 'commentCard', date: '2026-10-22T09:00:00.000Z', idMemberCreator: TRELLO.members[1].id, data: { text: 'Nouveau', card: { id: TRELLO.cards[1].id } } });
  const encore = await ok('/cm/import/trello', s.cm123456, { methode: 'POST', corps: { trello: modifie } });
  assert.deepEqual([encore.tableauId, encore.nouveau, encore.bilan.cartesCreees, encore.bilan.listesCreees, encore.bilan.cartesPostsInchangees], [imp.tableauId, false, 0, 0, 1]);
  const tb2 = await ok(`/cm/tableaux/${imp.tableauId}`, s.cm123456);
  assert.equal(tb2.cartes.length, 3);
  assert.equal(tb2.etiquettes.length, 3);
  assert.ok(tb2.cartes.some(c => c.titre === 'Recap hebdo'));
  assert.ok(tb2.cartes.some(c => c.titre === 'Annonce du tournoi d’automne'), 'le post n’est pas écrasé');
  const recap2 = tb2.cartes.find(c => c.titre === 'Recap hebdo');
  assert.equal(recap2.commentaires, 2);
  assert.equal((await ok(`/cm/cartes/${annonce.id}`, s.cm123456)).carte.checklists[0].elements.length, 3);
  // Archivées en option.
  const avec = await ok('/cm/import/trello', s.cm123456, { methode: 'POST', corps: { trello: TRELLO, avecArchivees: true } });
  assert.equal(avec.bilan.listesCreees, 1);
  assert.equal((await ok(`/cm/tableaux/${imp.tableauId}?archives=1`, s.cm123456)).cartes.length, 5);
  // Aperçu d'un tableau déjà importé.
  assert.equal((await ok('/cm/import/trello/apercu', s.cm123456, { methode: 'POST', corps: { trello: TRELLO } })).dejaImporte.id, imp.tableauId);
  // Droit : cm.gerer.
  assert.equal((await api('/cm/import/trello', s.red12345, { methode: 'POST', corps: { trello: TRELLO } })).statut, 403);
});

test('import Trello : entrées malformées refusées avec le chemin fautif, volumes bornés', async () => {
  const lire = o => lireExportTrello(o);
  const raison = (o, chemin) => assert.throws(() => lire(o), e => e instanceof TrelloInvalide && e.chemin === chemin, chemin);
  raison([], '(racine)');
  raison({ ...copie(TRELLO), id: 'pas-un-id' }, 'id');
  raison({ ...copie(TRELLO), name: '' }, 'name');
  raison({ id: TRELLO.id, name: 'x' }, 'lists');
  const m = copie(TRELLO);
  m.cards[0].idList = 'a'.repeat(24);
  raison(m, 'cards[0].idList');
  const m2 = copie(TRELLO);
  m2.cards[1].idLabels = ['<script>'];
  raison(m2, 'cards[1].idLabels[0]');
  const m3 = copie(TRELLO);
  m3.lists = 'non';
  raison(m3, 'lists');
  const m4 = copie(TRELLO);
  m4.cards = Array.from({ length: 5001 }, (_, i) => ({ ...TRELLO.cards[1], id: i.toString(16).padStart(24, '0') }));
  raison(m4, 'cards');
  // Doublons d'identifiants (fichier retouché) : gardés une fois.
  const m5 = copie(TRELLO);
  m5.cards.push(copie(TRELLO.cards[1]));
  assert.equal(lire(m5).cartes.filter(c => c.trelloId === TRELLO.cards[1].id).length, 2, 'le lecteur garde tout ; l’import dédoublonne');

  const { s, api, ok } = await preparer();
  for (const corps of [{}, { trello: 'texte' }, { trello: [] }, { trello: { ...copie(TRELLO), lists: [{ id: 'x' }] } }]) {
    const r = await api('/cm/import/trello/apercu', s.cm123456, { methode: 'POST', corps });
    assert.equal(r.corps.code, 'trello-invalide', JSON.stringify(corps).slice(0, 40));
  }
  assert.equal((await api('/cm/import/trello/apercu', s.cm123456, { methode: 'POST', corps: { trello: { ...copie(TRELLO), lists: [{ id: 'x' }] } } })).corps.details.chemin, 'lists[0].id');
  const doublons = await ok('/cm/import/trello', s.cm123456, { methode: 'POST', corps: { trello: m5 } });
  assert.equal((await ok(`/cm/tableaux/${doublons.tableauId}`, s.cm123456)).cartes.length, 3);
});

// ------------------------------------------------------------------ Pièces jointes, RGPD, export

test('pièces jointes déposées au niveau du club, RGPD (export, suppression), export / import de la base', async () => {
  const { b, A, s, api, ok } = await preparer();
  await activerCm(ok, s, A.teamId);
  const club = (await ok('/cm/tableaux', s.cm123456)).tableaux.find(t => t.cleDefaut === 'contenus');
  const tb = await ok(`/cm/tableaux/${club.id}`, s.cm123456);
  const carte = (await ok(`/cm/tableaux/${club.id}/cartes`, s.cm123456, { methode: 'POST', corps: { listeId: tb.listes[0].id, titre: 'Visuel', post: true } })).carte;
  // Un joueur n'envoie rien au niveau du club.
  assert.equal((await api('/cm/portees/club/envois', s.lea12345, { methode: 'POST', corps: { nom: 'x.png', taille: 100 } })).statut, 403);
  const png = new Uint8Array(200);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const env = await ok('/cm/portees/club/envois', s.cm123456, { methode: 'POST', corps: { nom: 'visuel.png', taille: png.length } });
  await morceau(b, s.cm123456, `/cm/portees/club/envois/${env.id}`, 0, png);
  await ok(`/cm/portees/club/envois/${env.id}/fin`, s.cm123456, { methode: 'POST', corps: { sha256: sha(png) } });
  let d = await ok(`/cm/cartes/${carte.id}/pieces`, s.cm123456, { methode: 'POST', corps: { genre: 'fichier', envoi: env.id } });
  const piece = d.carte.pieces[0];
  assert.equal(piece.fichier.type, 'image/png');
  d = await ok(`/cm/cartes/${carte.id}`, s.cm123456, { methode: 'PATCH', corps: { couverture: { pieceId: piece.id } } });
  const resume = (await ok(`/cm/tableaux/${club.id}`, s.cm123456)).cartes.find(c => c.id === carte.id);
  assert.match(resume.couverture.image, /\/cm\/fichiers\//);
  assert.equal((await b.brut(resume.couverture.image)).status, 200);
  // Un envoi déjà rattaché ne se réutilise pas.
  assert.equal((await api(`/cm/cartes/${carte.id}/pieces`, s.cm123456, { methode: 'POST', corps: { genre: 'fichier', envoi: env.id } })).corps.code, 'envoi-rattache');
  // Lien signé révoqué quand le compte perd l'accès.
  const lien = await ok(`/cm/pieces/${piece.id}/lien`, s.cm123456, { methode: 'POST', corps: {} });
  const aff = (await ok('/cm/affectations', s.fondateur)).affectations.find(a => a.compte === 'cm123456');
  await ok(`/cm/affectations/${aff.id}`, s.fondateur, { methode: 'DELETE' });
  assert.equal((await b.brut(lien.url)).status, 403);
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'cm123456', roleId: 'cm-role-responsable', portee: 'club' } });

  // RGPD : export et suppression d'un compte (affectations effacées, contenu gardé sans auteur).
  await ok(`/cm/cartes/${carte.id}/commentaires`, s.cm123456, { methode: 'POST', corps: { texte: 'Note' } });
  await ok(`/cm/teams/${A.teamId}/clips`, s.lea12345, { methode: 'POST', corps: { genre: 'lien', url: 'https://video-exemple.fr/1', titre: 'Mon clip' } });
  await ok(`/cm/cartes/${carte.id}`, s.cm123456, { methode: 'PATCH', corps: { liens: { membres: ['lea12345'] } } });
  const exp = await ok('/moi/export', s.cm123456);
  assert.equal(exp.cmRoles[0].role, 'Responsable CM');
  assert.ok(exp.cmCartesCreees.some(c => c.titre === 'Visuel'));
  assert.equal(exp.cmCommentaires[0].texte, 'Note');
  assert.equal((await ok('/moi/export', s.lea12345)).cmClips[0].titre, 'Mon clip');
  // Export / import de la base : les tables CM suivent (rôles système remplacés, pas doublés).
  const sauvegarde = await exporterBase(b.base);
  assert.ok(sauvegarde.tables.cm_cartes.length >= 1 && sauvegarde.tables.cm_roles.length === 2);
  const { baseMigree } = await import('./base.mjs');
  const neuve = await baseMigree();
  const bilan = await importerBase(neuve, JSON.parse(JSON.stringify(sauvegarde)));
  assert.equal(bilan.cm_roles, 2);
  assert.equal((await neuve.tous('SELECT id FROM cm_roles', [])).length, 2);
  assert.equal((await neuve.premier('SELECT titre FROM cm_cartes WHERE id = ?', [carte.id])).titre, 'Visuel');
  // Suppression : le compte disparaît des affectations et des liens, ses commentaires restent sans auteur.
  await ok('/moi', s.lea12345, { methode: 'DELETE' });
  assert.deepEqual((await ok(`/cm/cartes/${carte.id}`, s.cm123456)).carte.liens, {});
  assert.equal((await b.base.premier("SELECT propose_par FROM cm_clips WHERE titre = 'Mon clip'", [])).propose_par, null);
  await ok('/moi', s.cm123456, { methode: 'DELETE' });
  assert.equal((await b.base.tous("SELECT id FROM cm_affectations WHERE compte_id = 'cm123456'", [])).length, 0);
  assert.equal((await b.base.premier('SELECT auteur_id FROM cm_commentaires WHERE carte_id = ?', [carte.id])).auteur_id, null);
});

// ------------------------------------------------------------------ Étiquettes : gestion (migration 0029)

test('étiquettes : renommer et recolorer (cm.editer) se voit sur les cartes, supprimer et fusionner (cm.gerer) retirent partout, journal', async () => {
  const { b, s, api, ok } = await preparer();
  // Rédacteur : cm.editer sans cm.gerer ; lecteur : cm.voir seulement.
  const redacteur = await ok('/cm/roles', s.fondateur, { methode: 'POST', corps: { nom: 'Rédacteur seul', couleur: '#123456', permissions: ['cm.voir', 'cm.editer'] } });
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'red12345', roleId: redacteur.id, portee: 'club' } });
  const roleLecteur = await ok('/cm/roles', s.fondateur, { methode: 'POST', corps: { nom: 'Lecteur', couleur: '#654321', permissions: ['cm.voir'] } });
  const lecteur = await b.session('lec12345', 'Lou');
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'lec12345', roleId: roleLecteur.id, portee: 'club' } });
  const club = (await ok('/cm/tableaux', s.cm123456)).tableaux.find(t => t.portee === 'club');
  const nouvelle = async (nom, couleur) => (await ok(`/cm/tableaux/${club.id}/etiquettes`, s.cm123456, { methode: 'POST', corps: { nom, couleur } })).id;
  const [e1, e2, e3] = [await nouvelle('Vidéo', '#4bce97'), await nouvelle('Urgent', '#f87462'), await nouvelle('Sponso', '#9f8fef')];
  let t = await ok(`/cm/tableaux/${club.id}`, s.cm123456);
  const liste = t.listes[0].id;
  const cartes = [];
  for (const titre of ['Carte 1', 'Carte 2', 'Carte 3']) cartes.push((await ok(`/cm/tableaux/${club.id}/cartes`, s.cm123456, { methode: 'POST', corps: { titre, listeId: liste } })).carte.id);
  await ok(`/cm/cartes/${cartes[0]}`, s.cm123456, { methode: 'PATCH', corps: { etiquettes: [e1, e2] } });
  await ok(`/cm/cartes/${cartes[1]}`, s.cm123456, { methode: 'PATCH', corps: { etiquettes: [e1] } });
  await ok(`/cm/cartes/${cartes[2]}`, s.cm123456, { methode: 'PATCH', corps: { etiquettes: [e1, e3] } });
  await ok(`/cm/cartes/${cartes[2]}`, s.cm123456, { methode: 'PATCH', corps: { archive: true } });

  t = await ok(`/cm/tableaux/${club.id}?archives=1`, s.cm123456);
  assert.deepEqual(t.etiquettes.map(e => [e.nom, e.cartes]), [['Vidéo', 3], ['Urgent', 1], ['Sponso', 1]], 'nombre de cartes par étiquette, archivées comprises');

  // Renommer / recolorer : cm.editer suffit, la carte pointe sur l'identifiant, donc le changement est visible partout.
  const v0 = t.tableau.version;
  await ok(`/cm/etiquettes/${e1}`, s.red12345, { methode: 'PATCH', corps: { nom: 'Vidéos', couleur: '#ABCDEF' } });
  t = await ok(`/cm/tableaux/${club.id}`, s.cm123456);
  assert.deepEqual([t.etiquettes[0].nom, t.etiquettes[0].couleur], ['Vidéos', '#abcdef']);
  assert.ok(t.tableau.version > v0, 'les autres écrans relisent le tableau');
  assert.deepEqual(t.cartes.find(c => c.id === cartes[0]).etiquettes, [e1, e2]);
  assert.equal((await api(`/cm/etiquettes/${e1}`, s.red12345, { methode: 'PATCH', corps: { couleur: 'rouge' } })).corps.code, 'couleur');
  assert.equal((await api(`/cm/etiquettes/${e1}`, s.lea12345, { methode: 'PATCH', corps: { nom: 'x' } })).statut, 404, 'joueur : tableau invisible');
  assert.equal((await api(`/cm/etiquettes/${e1}`, lecteur, { methode: 'PATCH', corps: { nom: 'x' } })).statut, 403);

  // Réordonner (cm.editer) : les étiquettes non citées suivent.
  await ok(`/cm/tableaux/${club.id}/etiquettes/ordre`, s.red12345, { methode: 'PUT', corps: { ids: [e3, e1] } });
  t = await ok(`/cm/tableaux/${club.id}`, s.cm123456);
  assert.deepEqual(t.etiquettes.map(e => e.id), [e3, e1, e2]);
  assert.equal((await api(`/cm/tableaux/${club.id}/etiquettes/ordre`, s.red12345, { methode: 'PUT', corps: { ids: ['pas-un-id'] } })).corps.code, 'etiquettes');

  // Suppression définitive et fusion : cm.gerer (le rédacteur seul reçoit 403, rien ne bouge).
  assert.equal((await api(`/cm/etiquettes/${e2}`, s.red12345, { methode: 'DELETE' })).statut, 403);
  assert.equal((await api(`/cm/etiquettes/${e2}/fusionner`, s.red12345, { methode: 'POST', corps: { vers: e1 } })).statut, 403);
  assert.equal((await ok(`/cm/tableaux/${club.id}`, s.cm123456)).etiquettes.length, 3);
  // Fusion : Urgent -> Vidéos ; la carte 1 n'a pas de doublon.
  const fus = await ok(`/cm/etiquettes/${e2}/fusionner`, s.cm123456, { methode: 'POST', corps: { vers: e1 } });
  assert.equal(fus.cartes, 1);
  assert.equal((await api(`/cm/etiquettes/${e1}/fusionner`, s.cm123456, { methode: 'POST', corps: { vers: e1 } })).corps.code, 'fusion');
  t = await ok(`/cm/tableaux/${club.id}`, s.cm123456);
  assert.deepEqual(t.etiquettes.map(e => e.id), [e3, e1]);
  assert.deepEqual(t.cartes.find(c => c.id === cartes[0]).etiquettes, [e1]);
  // Suppression : retirée de TOUTES les cartes (archivée comprise), sans corbeille.
  const sup = await ok(`/cm/etiquettes/${e1}`, s.cm123456, { methode: 'DELETE' });
  assert.equal(sup.cartes, 3);
  t = await ok(`/cm/tableaux/${club.id}?archives=1`, s.cm123456);
  assert.deepEqual(t.etiquettes.map(e => e.id), [e3]);
  assert.deepEqual(t.cartes.map(c => c.etiquettes).sort(), [[], [], [e3]]);
  assert.equal(Number((await b.base.premier('SELECT COUNT(*) AS n FROM cm_carte_etiquettes WHERE etiquette_id = ?', [e1])).n), 0);
  assert.equal((await ok(`/cm/cartes/${cartes[0]}`, s.cm123456)).carte.etiquettes.length, 0);
  assert.equal((await api(`/cm/etiquettes/${e1}`, s.cm123456, { methode: 'DELETE' })).statut, 404);

  // Journal : renommage, fusion, suppression.
  const actions = (await ok('/cm/journal', s.cm123456)).entrees.map(e => e.action);
  for (const a of ['cm.etiquette_modifiee', 'cm.etiquette_fusionnee', 'cm.etiquette_supprimee']) assert.ok(actions.includes(a), a);
});

test('étiquettes importées de Trello : modifiables, supprimables ; relancer l’import ne défait ni le renommage ni la suppression', async () => {
  const { b, s, ok } = await preparer();
  const imp = await ok('/cm/import/trello', s.cm123456, { methode: 'POST', corps: { trello: TRELLO } });
  let tb = await ok(`/cm/tableaux/${imp.tableauId}`, s.cm123456);
  assert.equal(tb.etiquettes.length, 3);
  const urgent = tb.etiquettes.find(e => e.nom === 'Urgent');
  const autre = tb.etiquettes.find(e => e.id !== urgent.id);
  const reste = tb.etiquettes.find(e => e.id !== urgent.id && e.id !== autre.id);
  await ok(`/cm/etiquettes/${urgent.id}`, s.cm123456, { methode: 'PATCH', corps: { nom: 'Prioritaire', couleur: '#112233' } });
  const fusion = await ok(`/cm/etiquettes/${autre.id}/fusionner`, s.cm123456, { methode: 'POST', corps: { vers: reste.id } });
  const sup = await ok(`/cm/etiquettes/${reste.id}`, s.cm123456, { methode: 'DELETE' });
  assert.ok(fusion.cartes >= 0 && sup.cartes >= 0);
  // Relancer l'import (avec un nom changé côté Trello) : ni retour des étiquettes retirées, ni écrasement du renommage.
  const modifie = copie(TRELLO);
  for (const l of modifie.labels) l.name = `${l.name ?? ''} (Trello)`;
  await ok('/cm/import/trello', s.cm123456, { methode: 'POST', corps: { trello: modifie } });
  tb = await ok(`/cm/tableaux/${imp.tableauId}`, s.cm123456);
  assert.deepEqual(tb.etiquettes.map(e => [e.id, e.nom, e.couleur]), [[urgent.id, 'Prioritaire', '#112233']]);
  assert.equal(Number((await b.base.premier('SELECT COUNT(*) AS n FROM cm_etiquettes_retirees WHERE tableau_id = ?', [imp.tableauId])).n), 2);
  assert.ok(tb.cartes.every(c => c.etiquettes.every(id => id === urgent.id)), 'aucune carte ne garde une étiquette disparue');
});
