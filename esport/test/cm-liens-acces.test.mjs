/**
 * Qui voit une ressource de DATA › Ressources (migration 0048, docs/esport/cm.md, « Qui voit la ressource ») :
 *
 *  - une ressource RESTREINTE ne se voit par aucune route pour qui n'en est pas : liste, « où est-elle liée », carte
 *    liée, dossier du Drive lié, écritures, état (pastille), journal, centre de notifications, notifications
 *    personnelles, temps réel ;
 *  - « Partager avec Lyna » : elle la voit (« Nouveau » jusqu'à l'ouverture, « Partagé avec moi »), reçoit une
 *    notification ; retrait immédiat (liste, cartes, notifications) ; créateur et Fondateur la voient toujours ;
 *  - rôles, « peut voir » (lecture seule), garde-fou (pas de retrait de soi-même), création restreinte, suppression
 *    (fil et journal nettoyés), export / import, RGPD.
 *
 * Tourne sur SQLite (défaut) et sur PostgreSQL (ESPORT_TEST_PG, esport/test/pg/lancer.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { TABLES, exporterBase, importerBase } from '../noyau/transfert.mjs';

async function preparer() {
  const b = await banc();
  const A = await teamAvecMembres(b, { membres: { kai12345: { pseudo: 'Kai', role: 'joueur' } } });
  const s = { ...A.sessions };
  s.cm123456 = await b.session('cm123456', 'Clara');
  s.osc12345 = await b.session('osc12345', 'Oscar');
  s.lyn12345 = await b.session('lyn12345', 'Lyna');
  s.vue12345 = await b.session('vue12345', 'Vera');
  const api = (chemin, jeton, o = {}) => b.appel(chemin, { jeton, methode: o.methode, corps: o.corps });
  const ok = async (chemin, jeton, o = {}) => {
    const r = await api(chemin, jeton, o);
    assert.equal(r.statut, 200, `${o.methode ?? 'GET'} ${chemin} : ${r.statut} ${JSON.stringify(r.corps)}`);
    return r.corps;
  };
  // Clara et Oscar : Responsables CM du club (tout le CM, Drive compris) ; Lyna : rédactrice ; Vera : lectrice.
  for (const c of ['cm123456', 'osc12345']) await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: c, roleId: 'cm-role-responsable', portee: 'club' } });
  const redac = await ok('/cm/roles', s.fondateur, { methode: 'POST', corps: { nom: 'Rédaction', couleur: '#335577', permissions: ['cm.voir', 'cm.editer'] } });
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'lyn12345', roleId: redac.id, portee: 'club' } });
  const lecteur = await ok('/cm/roles', s.fondateur, { methode: 'POST', corps: { nom: 'Lecture', couleur: '#123456', permissions: ['cm.voir'] } });
  const affVera = (await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'vue12345', roleId: lecteur.id, portee: 'club' } })).affectations.find(a => a.compte === 'vue12345');
  return { b, A, s, api, ok, roleLecteur: lecteur.id, affVera };
}

const contient = (valeur, ...aiguilles) => aiguilles.some(a => JSON.stringify(valeur).includes(a));

/** Ressource « Plan secret » de Clara, restreinte (à elle seule), liée à une carte du tableau par défaut et à un dossier du Drive. */
async function ressourceSecrete({ ok, s }) {
  const lien = (await ok('/cm/liens', s.cm123456, { methode: 'POST', corps: { titre: 'Plan secret', url: 'https://docs.exemple.fr/plan', categorie: 'Confidentiel', acces: 'restreint', regles: [] } })).lien;
  assert.equal(lien.acces, 'restreint');
  const club = (await ok('/cm/tableaux', s.cm123456)).tableaux.find(t => t.cleDefaut === 'contenus');
  const t = await ok(`/cm/tableaux/${club.id}`, s.cm123456);
  const carte = (await ok(`/cm/tableaux/${club.id}/cartes`, s.cm123456, { methode: 'POST', corps: { listeId: t.listes[0].id, titre: 'Tâches de la semaine' } })).carte;
  const dossier = (await ok('/cm/drive/dossiers', s.cm123456, { methode: 'POST', corps: { portee: 'club', nom: 'Briefs' } })).id;
  await ok(`/cm/liens/${lien.id}/liaisons`, s.cm123456, { methode: 'POST', corps: { genre: 'carte', cibleId: carte.id } });
  await ok(`/cm/liens/${lien.id}/liaisons`, s.cm123456, { methode: 'POST', corps: { genre: 'dossier', cibleId: dossier } });
  return { lien, carte, dossier, tableau: club.id };
}

test('une ressource restreinte ne se voit par aucune route pour qui n’en est pas ; créateur et Fondateur la voient', async () => {
  const ctx = await preparer();
  const { s, api, ok } = ctx;
  const { lien, carte, dossier } = await ressourceSecrete(ctx);
  const secrets = [lien.id, 'Plan secret', 'docs.exemple.fr', 'Confidentiel'];
  // Oscar a tout le CM (cm.gerer, Drive) mais n'est pas de la ressource.
  const liste = await ok('/cm/liens', s.osc12345);
  assert.ok(!contient(liste, ...secrets), 'liste, étiquettes comprises');
  assert.equal((await ok(`/cm/liens/cible/carte/${carte.id}`, s.osc12345)).liens.length, 0, 'carte liée');
  assert.equal((await ok(`/cm/liens/cible/dossier/${dossier}`, s.osc12345)).liens.length, 0, 'dossier du Drive lié');
  for (const [chemin, methode, corps] of [
    [`/cm/liens/${lien.id}/liaisons`, 'GET'],
    [`/cm/liens/${lien.id}/acces`, 'GET'],
    [`/cm/liens/${lien.id}/acces`, 'PUT', { acces: 'tous', regles: [] }],
    [`/cm/liens/${lien.id}/partage`, 'POST', { comptes: ['osc12345'] }],
    [`/cm/liens/${lien.id}/vu`, 'POST', {}],
    [`/cm/liens/${lien.id}`, 'PATCH', { titre: 'Piraté' }],
    [`/cm/liens/${lien.id}`, 'DELETE'],
    [`/cm/liens/${lien.id}/liaisons`, 'POST', { genre: 'carte', cibleId: carte.id }],
    [`/cm/liens/${lien.id}/liaisons/carte/${carte.id}`, 'DELETE'],
    ['/cm/liens/ordre', 'PUT', { ids: [lien.id] }],
  ]) {
    const r = await api(chemin, s.osc12345, { methode, corps });
    assert.equal(r.statut, 404, `${methode} ${chemin} : ${r.statut}`);
    assert.ok(!contient(r.corps, 'Plan secret'), chemin);
  }
  assert.equal((await ok('/cm/etat', s.osc12345)).ressources, 0);
  assert.ok(!contient(await ok('/cm/journal', s.osc12345), ...secrets), 'journal de la section');
  assert.ok(!contient(await ok('/notifications/centre?limite=100', s.osc12345), ...secrets), 'centre de notifications');
  assert.ok(!contient(await ok('/notifications', s.osc12345), ...secrets), 'notifications personnelles');
  // Temps réel : une modification de Clara ne fait partir aucune clé ni donnée de la ressource.
  const avant = (await ok('/temps-reel/evenements', s.osc12345)).dernierId;
  await ok(`/cm/liens/${lien.id}`, s.cm123456, { methode: 'PATCH', corps: { description: 'Toujours secret' } });
  assert.ok(!contient((await ok(`/temps-reel/evenements?depuis=${avant}`, s.osc12345)).evenements, ...secrets), 'sondage temps réel');
  // Base : rien n'a été écrit par Oscar.
  assert.equal((await ctx.b.base.premier('SELECT titre FROM cm_liens WHERE id = ?', [lien.id])).titre, 'Plan secret');
  // Clara (créatrice) et le Fondateur (absent des règles) la voient, avec cadenas.
  for (const jeton of [s.cm123456, s.fondateur]) {
    const l = (await ok('/cm/liens', jeton)).liens.find(x => x.id === lien.id);
    assert.equal(l?.acces, 'restreint');
    assert.equal(l.liaisons, 2);
    assert.equal((await ok(`/cm/liens/cible/carte/${carte.id}`, jeton)).liens.length, 1);
  }
  assert.ok(contient(await ok('/notifications/centre?limite=100', s.fondateur), lien.id), 'le Fondateur voit le fil');
  const reglage = await ok(`/cm/liens/${lien.id}/acces`, s.fondateur);
  assert.deepEqual(reglage.effectifs.map(p => p.compte).sort(), ['cm123456', 'principal']);
});

test('« Partager avec Lyna » : elle voit (Nouveau, Partagé avec moi), est notifiée ; retrait immédiat', async () => {
  const ctx = await preparer();
  const { s, api, ok } = ctx;
  const { lien, carte } = await ressourceSecrete(ctx);
  assert.equal((await ok('/cm/liens', s.lyn12345)).liens.length, 0);
  // Lyna ne peut pas se l'attribuer, ni partager une ressource qu'elle ne voit pas.
  assert.equal((await api(`/cm/liens/${lien.id}/partage`, s.lyn12345, { methode: 'POST', corps: { comptes: ['lyn12345'] } })).statut, 404);
  const p = await ok(`/cm/liens/${lien.id}/partage`, s.cm123456, { methode: 'POST', corps: { comptes: ['lyn12345'] } });
  assert.equal(p.partages, 1);
  // Elle voit la ressource, en lecture seule, avec « Nouveau » et « Partagé avec moi ».
  const vue = (await ok('/cm/liens', s.lyn12345)).liens.find(x => x.id === lien.id);
  assert.ok(vue, 'liste');
  assert.equal(vue.nouveau, true);
  assert.equal(vue.partageAvecMoi, true);
  assert.deepEqual(vue.droits, { modifier: false, supprimer: false, acces: false, partager: false });
  assert.equal((await ok('/cm/liens', s.lyn12345)).nouveaux, 1);
  assert.equal((await ok('/cm/etat', s.lyn12345)).ressources, 1, 'pastille');
  assert.equal((await ok(`/cm/liens/cible/carte/${carte.id}`, s.lyn12345)).liens.length, 1, 'sur la carte liée');
  assert.equal((await ok(`/cm/liens/${lien.id}/liaisons`, s.lyn12345)).cartes.length, 1, '« où est-il lié »');
  assert.equal((await api(`/cm/liens/${lien.id}`, s.lyn12345, { methode: 'PATCH', corps: { titre: 'X' } })).statut, 403, '« peut voir »');
  assert.equal((await api(`/cm/liens/${lien.id}/acces`, s.lyn12345)).statut, 403);
  // Notification personnelle, catégorie CM, qui mène aux Ressources.
  const notif = (await ok('/notifications', s.lyn12345)).liste.find(n => n.type === 'cm-lien-partage');
  assert.ok(notif, 'notification');
  const centre = (await ok('/notifications/centre?limite=100', s.lyn12345)).liste.find(n => n.type === 'cm-lien-partage');
  assert.equal(centre.categorie, 'cm');
  assert.equal(centre.charge.titre, 'Plan secret');
  assert.equal(centre.charge.membre, 'cm123456');
  assert.ok(JSON.stringify(centre.lien).includes('ressources'), JSON.stringify(centre.lien));
  // Oscar ne reçoit rien.
  assert.ok(!(await ok('/notifications', s.osc12345)).liste.some(n => n.type === 'cm-lien-partage'));
  // Ouverture : « Nouveau » disparaît, la notification passe en lue (état en base).
  await ok(`/cm/liens/${lien.id}/vu`, s.lyn12345, { methode: 'POST', corps: {} });
  assert.equal((await ok('/cm/liens', s.lyn12345)).liens.find(x => x.id === lien.id).nouveau, false);
  assert.equal((await ok('/cm/etat', s.lyn12345)).ressources, 0);
  assert.ok((await ctx.b.base.premier("SELECT vu_le FROM cm_lien_partages WHERE lien_id = ? AND compte_id = 'lyn12345'", [lien.id])).vu_le);
  assert.ok((await ctx.b.base.premier("SELECT lue_le FROM notifications WHERE compte_id = 'lyn12345' AND cm_lien_id = ?", [lien.id])).lue_le);
  // Retrait : Clara la remet à elle seule ; Lyna ne voit plus rien, tout de suite.
  const reglage = await ok(`/cm/liens/${lien.id}/acces`, s.cm123456);
  assert.deepEqual(reglage.regles.map(r => [r.genre, r.cible, r.niveau]), [['compte', 'lyn12345', 'voir']]);
  await ok(`/cm/liens/${lien.id}/acces`, s.cm123456, { methode: 'PUT', corps: { acces: 'restreint', regles: [] } });
  assert.ok(!contient(await ok('/cm/liens', s.lyn12345), lien.id, 'Plan secret'));
  assert.equal((await ok(`/cm/liens/cible/carte/${carte.id}`, s.lyn12345)).liens.length, 0);
  assert.equal((await api(`/cm/liens/${lien.id}/liaisons`, s.lyn12345)).statut, 404);
  assert.ok(!contient(await ok('/notifications', s.lyn12345), 'Plan secret'), 'ancienne notification masquée');
  assert.ok(!contient(await ok('/notifications/centre?limite=100', s.lyn12345), 'Plan secret', lien.id));
  // Le Fondateur et Clara la voient toujours.
  assert.ok((await ok('/cm/liens', s.fondateur)).liens.some(x => x.id === lien.id));
  assert.ok((await ok('/cm/liens', s.cm123456)).liens.some(x => x.id === lien.id));
});

test('rôles, « peut modifier », garde-fou, ressource ouverte partagée, création restreinte', async () => {
  const ctx = await preparer();
  const { s, api, ok, roleLecteur, affVera } = ctx;
  const { lien } = await ressourceSecrete(ctx);
  // Rôle CM « Lecture » : Vera voit ; son rôle retiré, plus rien (relu à chaque requête).
  await ok(`/cm/liens/${lien.id}/acces`, s.cm123456, { methode: 'PUT', corps: { acces: 'restreint', regles: [{ genre: 'role_cm', cible: roleLecteur, niveau: 'voir' }] } });
  assert.ok((await ok('/cm/liens', s.vue12345)).liens.some(x => x.id === lien.id));
  assert.ok(!(await ok('/cm/liens', s.lyn12345)).liens.some(x => x.id === lien.id));
  assert.ok(!(await ok('/notifications', s.vue12345)).liste.some(n => n.type === 'cm-lien-partage'), 'un rôle n’est pas notifié');
  await ok(`/cm/affectations/${affVera.id}`, s.fondateur, { methode: 'DELETE' });
  assert.equal((await api('/cm/liens', s.vue12345)).statut, 403);
  // Règles inconnues refusées.
  assert.equal((await api(`/cm/liens/${lien.id}/acces`, s.cm123456, { methode: 'PUT', corps: { acces: 'restreint', regles: [{ genre: 'compte', cible: 'inconnu1', niveau: 'voir' }] } })).statut, 400);
  assert.equal((await api(`/cm/liens/${lien.id}/acces`, s.cm123456, { methode: 'PUT', corps: { acces: 'secret', regles: [] } })).statut, 400);
  // Oscar « peut modifier » (cm.gerer) : il règle l'accès, mais ne peut pas s'en retirer.
  await ok(`/cm/liens/${lien.id}/acces`, s.cm123456, { methode: 'PUT', corps: { acces: 'restreint', regles: [{ genre: 'compte', cible: 'osc12345', niveau: 'modifier' }] } });
  assert.equal((await ok('/notifications', s.osc12345)).liste.filter(n => n.type === 'cm-lien-partage').length, 1, 'personne nommée : notifiée');
  assert.equal((await ok('/cm/liens', s.osc12345)).liens.find(x => x.id === lien.id).droits.acces, true);
  await ok(`/cm/liens/${lien.id}`, s.osc12345, { methode: 'PATCH', corps: { epingle: true } });
  const soi = await api(`/cm/liens/${lien.id}/acces`, s.osc12345, { methode: 'PUT', corps: { acces: 'restreint', regles: [] } });
  assert.equal(soi.statut, 409);
  assert.equal(soi.corps.code, 'acces-soi-meme');
  // Il partage avec Lyna en « peut modifier » : elle modifie.
  await ok(`/cm/liens/${lien.id}/partage`, s.osc12345, { methode: 'POST', corps: { comptes: ['lyn12345'], niveau: 'modifier' } });
  await ok(`/cm/liens/${lien.id}`, s.lyn12345, { methode: 'PATCH', corps: { description: 'Relu' } });
  // Partage refusé vers quelqu'un sans accès aux ressources du CM.
  assert.equal((await api(`/cm/liens/${lien.id}/partage`, s.cm123456, { methode: 'POST', corps: { comptes: ['kai12345'] } })).statut, 400);
  // Ressource ouverte à toute l'équipe : une éditrice la signale, sans rien changer à l'accès.
  const ouverte = (await ok('/cm/liens', s.cm123456, { methode: 'POST', corps: { titre: 'Charte', url: 'https://exemple.fr/charte' } })).lien;
  assert.equal(ouverte.acces, 'tous');
  await ok(`/cm/liens/${ouverte.id}/partage`, s.lyn12345, { methode: 'POST', corps: { comptes: ['osc12345'] } });
  const chezOscar = (await ok('/cm/liens', s.osc12345)).liens.find(x => x.id === ouverte.id);
  assert.equal(chezOscar.nouveau, true);
  assert.equal(chezOscar.acces, 'tous');
  assert.equal((await ctx.b.base.tous('SELECT * FROM cm_lien_acces WHERE lien_id = ?', [ouverte.id])).length, 0);
  // Création directement restreinte et partagée : Lyna est notifiée.
  const tache = (await ok('/cm/liens', s.fondateur, { methode: 'POST', corps: { titre: 'Tâches de Lyna', url: 'https://exemple.fr/taches', acces: 'restreint', regles: [{ genre: 'compte', cible: 'lyn12345', niveau: 'voir' }] } })).lien;
  const chezLyna = (await ok('/cm/liens', s.lyn12345)).liens.find(x => x.id === tache.id);
  assert.equal(chezLyna?.nouveau, true);
  assert.ok((await ok('/notifications', s.lyn12345)).liste.some(n => n.type === 'cm-lien-partage' && JSON.stringify(n).includes('Tâches de Lyna')));
  assert.ok(!(await ok('/cm/liens', s.osc12345)).liens.some(x => x.id === tache.id));
  // Options proposées à la création.
  const options = await ok('/cm/liens/acces', s.lyn12345);
  assert.ok(options.options.personnes.some(p => p.compte === 'osc12345'));
  assert.ok(!options.options.personnes.some(p => p.compte === 'kai12345'));
});

test('suppression d’une ressource restreinte : fil, notifications et détails du journal effacés ; export / import ; RGPD', async () => {
  const ctx = await preparer();
  const { b, s, ok } = ctx;
  const { lien } = await ressourceSecrete(ctx);
  await ok(`/cm/liens/${lien.id}/partage`, s.cm123456, { methode: 'POST', corps: { comptes: ['lyn12345'] } });
  for (const n of ['cm_lien_acces', 'cm_lien_partages']) assert.ok(TABLES.some(([x]) => x === n), `export : ${n}`);
  const sauvegarde = await exporterBase(b.base);
  const { baseMigree } = await import('./base.mjs');
  const neuve = await baseMigree();
  const bilan = await importerBase(neuve, JSON.parse(JSON.stringify(sauvegarde)));
  assert.equal(bilan.cm_lien_acces, 1);
  assert.equal(bilan.cm_lien_partages, 1);
  assert.equal((await neuve.premier('SELECT acces FROM cm_liens WHERE id = ?', [lien.id])).acces, 'restreint');
  // RGPD : Lyna exporte ses accès et partages ; à l'effacement, ils disparaissent.
  const exp = await ok('/moi/export', s.lyn12345);
  assert.deepEqual(exp.cmLiensAcces.map(a => [a.ressource, a.niveau]), [['Plan secret', 'voir']]);
  assert.equal(exp.cmLiensPartages.length, 1);
  await ok('/moi', s.lyn12345, { methode: 'DELETE' });
  assert.equal((await b.base.tous("SELECT * FROM cm_lien_acces WHERE cible = 'lyn12345'", [])).length, 0);
  assert.equal((await b.base.tous("SELECT * FROM cm_lien_partages WHERE compte_id = 'lyn12345'", [])).length, 0);
  // Suppression : plus rien de son titre nulle part (fil du Fondateur, journal, notifications).
  await ok(`/cm/liens/${lien.id}`, s.cm123456, { methode: 'DELETE' });
  assert.ok(!contient(await ok('/notifications/centre?limite=100', s.fondateur), 'Plan secret'));
  assert.ok(!contient(await ok('/cm/journal', s.fondateur), 'Plan secret', 'docs.exemple.fr'));
  assert.equal((await b.base.tous('SELECT * FROM notifications WHERE cm_lien_id = ?', [lien.id])).length, 0);
  assert.equal((await b.base.tous('SELECT * FROM cm_lien_acces WHERE lien_id = ?', [lien.id])).length, 0);
});
