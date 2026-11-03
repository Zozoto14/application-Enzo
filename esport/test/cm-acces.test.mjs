/**
 * Accès RESTREINT aux tableaux CM (docs/esport/cm.md, « Accès au tableau », migration 0046).
 *
 *  - un compte qui a accès au CM mais n'est pas du tableau ne voit RIEN de lui, par chaque route : liste, tableau,
 *    carte, commentaires, visuels d'une carte, calendrier, recherche, « à valider », état (compteurs), journal,
 *    centre de notifications et notifications personnelles, temps réel (version, présence, sondage) ;
 *  - « peut voir » lit mais n'écrit rien (403) ; « peut modifier » garde ses permissions CM ;
 *  - retrait immédiat (tableau, carte, anciennes notifications, temps réel) ; le Fondateur voit tout ;
 *  - garde-fous : tableau par défaut toujours ouvert, au moins un gestionnaire, pas de retrait de soi-même ;
 *  - rôles CM, du club et de team ; export / import de la base ; RGPD.
 *
 * Tourne sur SQLite (défaut) et sur PostgreSQL (ESPORT_TEST_PG, esport/test/pg/lancer.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { niveauxTableau } from '../noyau/cm/acces.mjs';
import { exporterBase, importerBase } from '../noyau/transfert.mjs';
import { morceau, sha } from './medias-aide.mjs';

async function preparer() {
  const b = await banc();
  const A = await teamAvecMembres(b, { membres: { coach123: { pseudo: 'Zed', role: 'coach' }, lea12345: { pseudo: 'Léa', role: 'joueur' } } });
  const s = { ...A.sessions };
  s.cm123456 = await b.session('cm123456', 'Clara');
  s.red12345 = await b.session('red12345', 'Remi');
  s.osc12345 = await b.session('osc12345', 'Oscar');
  s.vue12345 = await b.session('vue12345', 'Vera');
  const api = (chemin, jeton, o = {}) => b.appel(chemin, { jeton, methode: o.methode, corps: o.corps, entetes: o.entetes });
  const ok = async (chemin, jeton, o = {}) => {
    const r = await api(chemin, jeton, o);
    assert.equal(r.statut, 200, `${o.methode ?? 'GET'} ${chemin} : ${r.statut} ${JSON.stringify(r.corps)}`);
    return r.corps;
  };
  // Clara, Remi et Oscar : Responsables CM du club (tout le CM, cm.gerer compris) ; Vera : lectrice (cm.voir).
  for (const c of ['cm123456', 'red12345', 'osc12345']) await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: c, roleId: 'cm-role-responsable', portee: 'club' } });
  const lecteur = await ok('/cm/roles', s.fondateur, { methode: 'POST', corps: { nom: 'Lecteur', couleur: '#123456', permissions: ['cm.voir'] } });
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'vue12345', roleId: lecteur.id, portee: 'club' } });
  return { b, A, s, api, ok, roleLecteur: lecteur.id };
}

/** Tableau « Secret » de Clara, restreint à Clara (modifier), Remi (modifier) et Vera (voir), avec une carte post. */
async function tableauSecret({ ok, s }) {
  const tb = (await ok('/cm/tableaux', s.cm123456, { methode: 'POST', corps: { nom: 'Secret', modele: 'contenus' } })).tableau;
  const regles = [
    { genre: 'compte', cible: 'cm123456', niveau: 'modifier' },
    { genre: 'compte', cible: 'red12345', niveau: 'modifier' },
    { genre: 'compte', cible: 'vue12345', niveau: 'voir' },
  ];
  const acces = await ok(`/cm/tableaux/${tb.id}/acces`, s.cm123456, { methode: 'PUT', corps: { acces: 'restreint', regles } });
  assert.equal(acces.acces, 'restreint');
  const detail = await ok(`/cm/tableaux/${tb.id}`, s.cm123456);
  const L = Object.fromEntries(detail.listes.map(l => [l.cle, l.id]));
  const { carte } = await ok(`/cm/tableaux/${tb.id}/cartes`, s.cm123456, { methode: 'POST', corps: { listeId: L.idees, titre: 'Projet Licorne', description: 'Annonce confidentielle', post: true, datePublication: '2026-12-10 18:00', textes: { x: { fr: 'Bientôt', en: 'Soon' }, instagram: { fr: 'Bientôt', en: 'Soon' }, tiktok: { fr: 'Bientôt', en: 'Soon' } } } });
  await ok(`/cm/cartes/${carte.id}`, s.cm123456, { methode: 'PATCH', corps: { membres: ['red12345'] } });
  await ok(`/cm/cartes/${carte.id}/commentaires`, s.cm123456, { methode: 'POST', corps: { texte: 'Relis @Remi' } });
  await ok(`/cm/cartes/${carte.id}/soumettre`, s.cm123456, { methode: 'POST', corps: {} });
  return { tb, carte, regles, L };
}

const contient = (valeur, ...aiguilles) => aiguilles.some(a => JSON.stringify(valeur).includes(a));

test('un compte du CM qui n’est pas du tableau restreint n’en voit rien, par aucune route', async () => {
  const ctx = await preparer();
  const { b, s, api, ok } = ctx;
  const { tb, carte } = await tableauSecret(ctx);
  const secrets = [tb.id, carte.id, 'Projet Licorne', 'Secret'];
  // Ressource (DATA › Ressources) liée à la carte : Oscar voit la ressource, jamais la carte liée.
  const lien = (await ok('/cm/liens', s.cm123456, { methode: 'POST', corps: { titre: 'Brief', url: 'https://www.canva.com/brief' } })).lien;
  await ok(`/cm/liens/${lien.id}/liaisons`, s.cm123456, { methode: 'POST', corps: { genre: 'carte', cibleId: carte.id } });
  assert.equal((await ok(`/cm/liens/${lien.id}/liaisons`, s.cm123456)).cartes.length, 1);
  assert.ok(!contient(await ok(`/cm/liens/${lien.id}/liaisons`, s.osc12345), ...secrets), 'ressources liées');
  assert.ok(!contient(await ok('/cm/liens', s.osc12345), ...secrets));
  assert.equal((await api(`/cm/liens/cible/carte/${carte.id}`, s.osc12345)).statut, 404);
  assert.equal((await api(`/cm/liens/${lien.id}/liaisons`, s.vue12345, { methode: 'POST', corps: { genre: 'carte', cibleId: carte.id } })).statut, 403, '« peut voir » ne lie rien');
  // Oscar a tout le CM (cm.gerer) mais n'est pas du tableau.
  const liste = await ok('/cm/tableaux', s.osc12345);
  assert.ok(!contient(liste, ...secrets), 'liste des tableaux');
  assert.ok(liste.tableaux.some(t => t.cleDefaut === 'contenus'), 'il voit toujours le tableau par défaut');
  for (const chemin of [`/cm/tableaux/${tb.id}`, `/cm/tableaux/${tb.id}?archives=1`, `/cm/cartes/${carte.id}`, `/cm/cartes/${carte.id}/visuels`, `/cm/visuels?carte=${carte.id}`, `/cm/tableaux/${tb.id}/acces`]) {
    const r = await api(chemin, s.osc12345);
    assert.equal(r.statut, 404, `${chemin} : ${r.statut}`);
    assert.ok(!contient(r.corps, 'Projet Licorne'), chemin);
  }
  for (const [chemin, methode, corps] of [
    [`/cm/cartes/${carte.id}/commentaires`, 'POST', { texte: 'Je passe' }],
    [`/cm/cartes/${carte.id}`, 'PATCH', { titre: 'Piraté' }],
    [`/cm/cartes/${carte.id}/valider`, 'POST', { version: 1 }],
    [`/cm/tableaux/${tb.id}/cartes`, 'POST', { listeId: tb.id, titre: 'Intrus' }],
    [`/cm/tableaux/${tb.id}/acces`, 'PUT', { acces: 'tous', regles: [] }],
    [`/cm/tableaux/${tb.id}`, 'DELETE'],
  ]) assert.equal((await api(chemin, s.osc12345, { methode, corps })).statut, 404, `${methode} ${chemin}`);
  assert.ok(!contient(await ok('/cm/calendrier?du=2026-12-01&au=2026-12-31', s.osc12345), ...secrets), 'calendrier éditorial');
  assert.ok(!contient(await ok('/cm/recherche?q=Licorne', s.osc12345), ...secrets), 'recherche');
  assert.ok(!contient(await ok('/cm/a-valider', s.osc12345), ...secrets), 'à valider');
  const etat = await ok('/cm/etat', s.osc12345);
  assert.ok(!contient(etat, tb.id), 'état');
  assert.equal(etat.aValider, 0, 'compteur « à valider »');
  assert.ok(!contient(await ok('/cm/journal', s.osc12345), ...secrets), 'journal de la section');
  // Notifications : aucune personnelle (« à valider » n'est pas parti vers lui), rien dans le fil.
  assert.ok(!(await ok('/notifications', s.osc12345)).liste.some(n => n.type === 'cm-a-valider'));
  assert.ok(!contient(await ok('/notifications/centre?limite=100', s.osc12345), ...secrets), 'centre de notifications');
  const compteurOscar = (await ok('/notifications/compteur', s.osc12345)).nonLues;
  // Temps réel : ni version, ni présence, ni clé de la carte dans le sondage.
  const chemin = `/cm/cartes/${carte.id}`;
  assert.equal((await api(`/temps-reel/version?chemin=${encodeURIComponent(chemin)}`, s.osc12345)).statut, 404);
  assert.equal((await api('/temps-reel/presence', s.osc12345, { methode: 'POST', corps: { chemin, etat: 'edition' } })).statut, 404);
  const avant = (await ok('/temps-reel/evenements', s.osc12345)).dernierId;
  await ok(chemin, s.cm123456, { methode: 'PATCH', corps: { description: 'Toujours secret' } });
  const flux = await ok(`/temps-reel/evenements?depuis=${avant}`, s.osc12345);
  assert.ok(!contient(flux.evenements, carte.id, tb.id), 'sondage temps réel');
  assert.ok((await ok(`/temps-reel/evenements?depuis=${avant}`, s.cm123456)).evenements.some(e => e.cle === `cm-carte:${carte.id}`), 'Clara reçoit la clé');
  assert.equal((await ok('/notifications/compteur', s.osc12345)).nonLues, compteurOscar, 'compteur inchangé');
  // Commentaires non lus : un commentaire du tableau restreint ne compte jamais pour Oscar.
  await ok(`/cm/cartes/${carte.id}/commentaires`, s.red12345, { methode: 'POST', corps: { texte: 'Nouveau commentaire' } });
  const etatApres = await ok('/cm/etat', s.osc12345);
  assert.equal(etatApres.nonLus.total, 0, 'pastille de commentaires non lus');
  assert.ok(!contient(etatApres.nonLus, tb.id));
  assert.ok(!contient(await ok('/cm/tableaux', s.osc12345), tb.id));
  // Le Fondateur, absent des règles, voit tout.
  assert.equal((await ok(`/cm/cartes/${carte.id}`, s.fondateur)).carte.titre, 'Projet Licorne');
  assert.ok((await ok('/cm/tableaux', s.fondateur)).tableaux.some(t => t.id === tb.id && t.acces === 'restreint'));
  assert.ok(contient(await ok('/notifications/centre?limite=100', s.fondateur), carte.id), 'le Fondateur voit le fil');
  // Remi (membre « peut modifier ») : assigné et mentionné, il a ses notifications et voit la carte.
  const remi = (await ok('/notifications', s.red12345)).liste.map(n => n.type);
  assert.ok(remi.includes('cm-assigne') && remi.includes('cm-mention') && remi.includes('cm-a-valider'), remi.join());
  // Base : rien n'a été écrit par Oscar.
  assert.equal((await b.base.premier('SELECT titre FROM cm_cartes WHERE id = ?', [carte.id])).titre, 'Projet Licorne');
  assert.equal((await b.base.tous('SELECT id FROM cm_commentaires WHERE carte_id = ?', [carte.id])).length, 2, 'Clara et Remi seulement');
});

test('« peut voir » lit le tableau mais ne modifie rien ; « peut modifier » garde ses permissions', async () => {
  const ctx = await preparer();
  const { s, api, ok } = ctx;
  const { tb, carte, L } = await tableauSecret(ctx);
  const vue = await ok(`/cm/tableaux/${tb.id}`, s.vue12345);
  assert.equal(vue.droits.editer, false);
  assert.equal(vue.droits.acces, false);
  assert.equal((await ok(`/cm/cartes/${carte.id}`, s.vue12345)).droits.commenter, false);
  // Remi, Responsable CM et « peut modifier » : il peut tout ; restreint au niveau « voir », plus rien.
  await ok(`/cm/tableaux/${tb.id}/acces`, s.cm123456, { methode: 'PUT', corps: { acces: 'restreint', regles: [{ genre: 'compte', cible: 'cm123456', niveau: 'modifier' }, { genre: 'compte', cible: 'red12345', niveau: 'voir' }] } });
  for (const qui of ['red12345']) {
    for (const [chemin, methode, corps] of [
      [`/cm/cartes/${carte.id}`, 'PATCH', { titre: 'Modifié' }],
      [`/cm/cartes/${carte.id}/commentaires`, 'POST', { texte: 'Commentaire' }],
      [`/cm/cartes/${carte.id}/valider`, 'POST', {}],
      [`/cm/cartes/${carte.id}/deplacer`, 'POST', { listeId: L.preparation, index: 0 }],
      [`/cm/tableaux/${tb.id}/cartes`, 'POST', { listeId: L.idees, titre: 'Nouvelle' }],
      [`/cm/tableaux/${tb.id}/listes`, 'POST', { nom: 'Liste' }],
      [`/cm/tableaux/${tb.id}`, 'PATCH', { fond: { genre: 'couleur', cle: 'vert' } }],
      [`/cm/tableaux/${tb.id}`, 'DELETE'],
      [`/cm/tableaux/${tb.id}/acces`, 'PUT', { acces: 'tous', regles: [] }],
    ]) assert.equal((await api(chemin, s[qui], { methode, corps })).statut, 403, `${qui} ${methode} ${chemin}`);
  }
  // Une carte d'un autre tableau ne peut pas y être déplacée par qui ne fait que voir.
  const club = (await ok('/cm/tableaux', s.red12345)).tableaux.find(t => t.cleDefaut === 'contenus' && t.portee === 'club');
  const idees = (await ok(`/cm/tableaux/${club.id}`, s.red12345)).listes.find(l => l.cle === 'idees');
  const autre = (await ok(`/cm/tableaux/${club.id}/cartes`, s.red12345, { methode: 'POST', corps: { listeId: idees.id, titre: 'Ailleurs' } })).carte;
  assert.equal((await api(`/cm/cartes/${autre.id}/deplacer`, s.red12345, { methode: 'POST', corps: { listeId: L.idees, tableauId: tb.id, index: 0 } })).statut, 403);
  // Personnes assignables : celles qui voient le tableau (« peut voir » compris), jamais Oscar.
  assert.ok((await ok(`/cm/tableaux/${tb.id}`, s.cm123456)).personnes.some(p => p.compte === 'red12345'));
  assert.ok(!(await ok(`/cm/tableaux/${tb.id}`, s.cm123456)).personnes.some(p => p.compte === 'osc12345'), 'Oscar n’est pas assignable');
  assert.equal((await api(`/cm/cartes/${carte.id}`, s.cm123456, { methode: 'PATCH', corps: { membres: ['red12345', 'osc12345'] } })).corps.code, 'membre');
  // Remi repasse « peut modifier » : il commente.
  await ok(`/cm/tableaux/${tb.id}/acces`, s.cm123456, { methode: 'PUT', corps: { acces: 'restreint', regles: [{ genre: 'compte', cible: 'cm123456', niveau: 'modifier' }, { genre: 'compte', cible: 'red12345', niveau: 'modifier' }] } });
  await ok(`/cm/cartes/${carte.id}/commentaires`, s.red12345, { methode: 'POST', corps: { texte: 'Ok pour moi' } });
});

test('retrait immédiat : tableau, carte, pièce jointe, anciennes notifications et temps réel ; le Fondateur voit toujours tout', async () => {
  const ctx = await preparer();
  const { b, s, api, ok } = ctx;
  const { tb, carte } = await tableauSecret(ctx);
  const chemin = `/cm/cartes/${carte.id}`;
  // Pièce jointe (image envoyée par morceaux) : Remi obtient un lien signé à son nom.
  const png = new Uint8Array(200);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const env = await ok('/cm/portees/club/envois', s.cm123456, { methode: 'POST', corps: { nom: 'licorne.png', taille: png.length } });
  await morceau(b, s.cm123456, `/cm/portees/club/envois/${env.id}`, 0, png);
  await ok(`/cm/portees/club/envois/${env.id}/fin`, s.cm123456, { methode: 'POST', corps: { sha256: sha(png) } });
  const piece = (await ok(`${chemin}/pieces`, s.cm123456, { methode: 'POST', corps: { genre: 'fichier', envoi: env.id } })).carte.pieces[0];
  const lienRemi = await ok(`/cm/pieces/${piece.id}/lien`, s.red12345, { methode: 'POST', corps: {} });
  assert.equal((await b.brut(lienRemi.url)).status, 200);
  assert.equal((await api(`/cm/pieces/${piece.id}/lien`, s.osc12345, { methode: 'POST', corps: {} })).statut, 404, 'Oscar : pas de lien');
  await ok(`/temps-reel/version?chemin=${encodeURIComponent(chemin)}`, s.red12345);
  await ok('/temps-reel/presence', s.red12345, { methode: 'POST', corps: { chemin, etat: 'edition' } });
  assert.ok((await ok('/notifications', s.red12345)).liste.some(n => n.type === 'cm-assigne'));
  assert.ok(contient(await ok('/notifications/centre?limite=100', s.red12345), carte.id));
  // Remi suit la carte (notification « nouveau commentaire »).
  await ok(`${chemin}/suivre`, s.red12345, { methode: 'POST', corps: { suivre: true } });
  // Clara retire Remi.
  await ok(`/cm/tableaux/${tb.id}/acces`, s.cm123456, { methode: 'PUT', corps: { acces: 'restreint', regles: [{ genre: 'compte', cible: 'cm123456', niveau: 'modifier' }] } });
  assert.equal((await api(chemin, s.red12345)).statut, 404);
  assert.equal((await api(`/cm/tableaux/${tb.id}`, s.red12345)).statut, 404);
  assert.ok(!contient(await ok('/cm/tableaux', s.red12345), tb.id));
  assert.equal((await b.brut(lienRemi.url)).status, 403, 'son ancien lien signé ne lit plus le fichier');
  // Suiveur retiré : plus de notification « nouveau commentaire » (ni pour une carte de ce tableau).
  await ok(`${chemin}/commentaires`, s.cm123456, { methode: 'POST', corps: { texte: 'Après le retrait' } });
  assert.equal((await b.base.tous("SELECT id FROM notifications WHERE compte_id = 'red12345' AND type = 'cm-commentaire'", [])).length, 0);
  assert.equal((await ok('/cm/etat', s.red12345)).nonLus.total, 0);
  const perso = (await ok('/notifications', s.red12345)).liste;
  assert.ok(!perso.some(n => ['cm-assigne', 'cm-mention', 'cm-a-valider'].includes(n.type)), JSON.stringify(perso.map(n => n.type)));
  assert.ok(!contient(await ok('/notifications/centre?limite=100', s.red12345), carte.id, tb.id, 'Projet Licorne'), 'anciennes notifications masquées');
  assert.equal((await api(`/temps-reel/version?chemin=${encodeURIComponent(chemin)}`, s.red12345)).statut, 404, 'temps réel : plus de version');
  assert.equal((await api('/temps-reel/presence', s.red12345, { methode: 'POST', corps: { chemin, etat: 'edition' } })).statut, 404);
  // Clara ne voit plus la présence de Remi (il a perdu l'accès) — et la sienne ne part pas vers lui.
  const avant = (await ok('/temps-reel/evenements', s.red12345)).dernierId;
  await ok(chemin, s.cm123456, { methode: 'PATCH', corps: { titre: 'Projet Licorne v2' } });
  assert.ok(!contient((await ok(`/temps-reel/evenements?depuis=${avant}`, s.red12345)).evenements, carte.id));
  // Rouvert à tous : il revoit tout (ses notifications reviennent).
  await ok(`/cm/tableaux/${tb.id}/acces`, s.cm123456, { methode: 'PUT', corps: { acces: 'tous', regles: [] } });
  assert.equal((await ok(chemin, s.red12345)).carte.titre, 'Projet Licorne v2');
  assert.ok((await ok('/notifications', s.red12345)).liste.some(n => n.type === 'cm-assigne'));
  // Le Fondateur, jamais cité, voit tout et peut régler l'accès.
  await ok(`/cm/tableaux/${tb.id}/acces`, s.fondateur, { methode: 'PUT', corps: { acces: 'restreint', regles: [{ genre: 'compte', cible: 'cm123456', niveau: 'modifier' }] } });
  assert.equal((await ok(chemin, s.fondateur)).carte.id, carte.id);
  assert.equal((await ok(`/cm/tableaux/${tb.id}/acces`, s.fondateur)).acces, 'restreint');
  // Perdre son rôle CM ferme aussi le tableau (l'accès au tableau ne donne jamais rien seul).
  const aff = (await ok('/cm/affectations', s.fondateur)).affectations.find(a => a.compte === 'cm123456');
  await ok(`/cm/affectations/${aff.id}`, s.fondateur, { methode: 'DELETE' });
  assert.equal((await api(chemin, s.cm123456)).statut, 404);
});

test('garde-fous : tableau par défaut ouvert, au moins un gestionnaire, pas de retrait de soi-même, droits du réglage', async () => {
  const ctx = await preparer();
  const { s, api, ok, roleLecteur } = ctx;
  const { tb } = await tableauSecret(ctx);
  const club = (await ok('/cm/tableaux', s.cm123456)).tableaux.find(t => t.cleDefaut === 'contenus' && t.portee === 'club');
  assert.equal(club.acces, 'tous', 'tableau par défaut existant : ouvert');
  const r1 = await api(`/cm/tableaux/${club.id}/acces`, s.fondateur, { methode: 'PUT', corps: { acces: 'restreint', regles: [{ genre: 'compte', cible: 'cm123456', niveau: 'modifier' }] } });
  assert.deepEqual([r1.statut, r1.corps.code], [409, 'tableau-defaut']);
  // Personne capable de le gérer (Vera ne fait que voir, n'a pas cm.gerer) : refusé, même au Fondateur.
  const r2 = await api(`/cm/tableaux/${tb.id}/acces`, s.fondateur, { methode: 'PUT', corps: { acces: 'restreint', regles: [{ genre: 'compte', cible: 'vue12345', niveau: 'modifier' }, { genre: 'role_cm', cible: roleLecteur, niveau: 'modifier' }] } });
  assert.deepEqual([r2.statut, r2.corps.code], [409, 'acces-sans-gestionnaire']);
  const r3 = await api(`/cm/tableaux/${tb.id}/acces`, s.fondateur, { methode: 'PUT', corps: { acces: 'restreint', regles: [] } });
  assert.equal(r3.corps.code, 'acces-sans-gestionnaire');
  // Clara ne se retire pas elle-même (Remi gère encore).
  const r4 = await api(`/cm/tableaux/${tb.id}/acces`, s.cm123456, { methode: 'PUT', corps: { acces: 'restreint', regles: [{ genre: 'compte', cible: 'red12345', niveau: 'modifier' }] } });
  assert.deepEqual([r4.statut, r4.corps.code], [409, 'acces-soi-meme']);
  // Le créateur sans cm.gerer règle l'accès de SON tableau ; un autre éditeur, non.
  const redacteur = await ok('/cm/roles', s.fondateur, { methode: 'POST', corps: { nom: 'Rédacteur', couleur: '#654321', permissions: ['cm.voir', 'cm.editer'] } });
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'coach123', roleId: redacteur.id, portee: 'club' } });
  await ok(`/cm/tableaux/${tb.id}/acces`, s.cm123456, { methode: 'PUT', corps: { acces: 'restreint', regles: [{ genre: 'compte', cible: 'cm123456', niveau: 'modifier' }, { genre: 'compte', cible: 'coach123', niveau: 'modifier' }] } });
  assert.equal((await api(`/cm/tableaux/${tb.id}/acces`, s.coach123)).statut, 403, 'éditeur non créateur');
  assert.equal((await ok(`/cm/tableaux/${tb.id}`, s.coach123)).droits.acces, false);
  // Entrées illisibles ou inconnues.
  for (const corps of [{ acces: 'prive' }, { acces: 'restreint', regles: [{ genre: 'groupe', cible: 'x' }] }, { acces: 'restreint', regles: [{ genre: 'compte', cible: 'cm123456', niveau: 'admin' }] }]) {
    assert.equal((await api(`/cm/tableaux/${tb.id}/acces`, s.cm123456, { methode: 'PUT', corps })).statut, 400, JSON.stringify(corps));
  }
  const inconnu = await api(`/cm/tableaux/${tb.id}/acces`, s.cm123456, { methode: 'PUT', corps: { acces: 'restreint', regles: [{ genre: 'compte', cible: 'cm123456', niveau: 'modifier' }, { genre: 'compte', cible: 'lea12345', niveau: 'voir' }] } });
  assert.equal(inconnu.corps.code, 'regle-inconnue', 'Léa n’a pas accès au CM du club');
  // Le réglage donne les options (personnes, rôles CM, du club, de team) et qui voit vraiment le tableau.
  const reglage = await ok(`/cm/tableaux/${tb.id}/acces`, s.cm123456);
  assert.ok(reglage.options.personnes.some(p => p.compte === 'osc12345'));
  assert.ok(reglage.options.rolesCm.some(r => r.id === roleLecteur));
  assert.ok(reglage.options.rolesClub.some(r => r.id === 'role-global-second-ceo'));
  assert.deepEqual(reglage.effectifs.map(p => p.compte).sort(), ['cm123456', 'coach123', 'principal'].sort());
  // Événement réservé aux gestionnaires qui voient le tableau.
  assert.ok(!contient(await ok('/notifications/centre?limite=100', s.osc12345), tb.id));
});

test('rôles : un rôle CM, du club ou de team ouvre le tableau à ceux qui l’ont aujourd’hui', async () => {
  const ctx = await preparer();
  const { b, A, s, api, ok, roleLecteur } = ctx;
  const { tb, carte } = await tableauSecret(ctx);
  // Rôle CM « Lecteur » (Vera, et Oscar à qui on le donne en plus) au niveau « voir ».
  await ok(`/cm/tableaux/${tb.id}/acces`, s.cm123456, { methode: 'PUT', corps: { acces: 'restreint', regles: [{ genre: 'compte', cible: 'cm123456', niveau: 'modifier' }, { genre: 'role_cm', cible: roleLecteur, niveau: 'voir' }] } });
  assert.equal((await ok(`/cm/cartes/${carte.id}`, s.vue12345)).carte.titre, 'Projet Licorne');
  assert.equal((await api(`/cm/cartes/${carte.id}`, s.osc12345)).statut, 404);
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'osc12345', roleId: roleLecteur, portee: 'club' } });
  const o = await ok(`/cm/cartes/${carte.id}`, s.osc12345);
  assert.equal(o.droits.editer, false, 'le rôle donne « voir » : Oscar, pourtant Responsable, ne modifie pas');
  // Rôle retiré : plus rien, tout de suite.
  const aff = (await ok('/cm/affectations', s.fondateur)).affectations.find(a => a.compte === 'osc12345' && a.role?.id === roleLecteur || (a.compte === 'osc12345' && a.roleId === roleLecteur));
  await ok(`/cm/affectations/${aff.id}`, s.fondateur, { methode: 'DELETE' });
  assert.equal((await api(`/cm/cartes/${carte.id}`, s.osc12345)).statut, 404);
  // Rôle du club et rôle de team (évaluation directe : membres actifs seulement).
  await b.base.executer("INSERT INTO roles_globaux_affectations (role_id, compte_id, attribue_le) VALUES ('role-global-second-ceo', 'osc12345', '2026-11-01T00:00:00.000Z')", []);
  const coach = await b.base.premier("SELECT id FROM roles WHERE team_id = ? AND cle_systeme = 'coach'", [A.teamId]);
  const ligne = await b.base.premier('SELECT * FROM cm_tableaux WHERE id = ?', [tb.id]);
  const niveaux = await niveauxTableau(b.base, { ...ligne, team_id: A.teamId }, [
    { genre: 'role_club', cible: 'role-global-second-ceo', niveau: 'modifier' },
    { genre: 'role_team', cible: coach.id, niveau: 'voir' },
  ]);
  assert.equal(niveaux.get('osc12345'), 'modifier');
  assert.equal(niveaux.get('coach123'), 'voir');
  await b.base.executer("UPDATE membres SET statut = 'suspendu' WHERE compte_id = 'coach123' AND team_id = ?", [A.teamId]);
  assert.equal((await niveauxTableau(b.base, { ...ligne, team_id: A.teamId }, [{ genre: 'role_team', cible: coach.id, niveau: 'voir' }])).get('coach123'), undefined, 'membre suspendu : rien');
  assert.equal(niveaux.has('principal'), false, 'le Fondateur n’a pas besoin de règle');
  await ok(`/cm/tableaux/${tb.id}/acces`, s.cm123456, { methode: 'PUT', corps: { acces: 'restreint', regles: [{ genre: 'compte', cible: 'cm123456', niveau: 'modifier' }, { genre: 'role_club', cible: 'role-global-second-ceo', niveau: 'voir' }] } });
  assert.equal((await ok(`/cm/cartes/${carte.id}`, s.osc12345)).carte.id, carte.id, 'Oscar, Second CEO : voit');
});

test('export / import de la base et RGPD : les règles suivent ; un compte supprimé en sort', async () => {
  const ctx = await preparer();
  const { b, s, ok } = ctx;
  const { tb } = await tableauSecret(ctx);
  const exp = await ok('/moi/export', s.vue12345);
  assert.deepEqual(exp.cmTableauxAcces.map(a => [a.tableau, a.niveau]), [['Secret', 'voir']]);
  const sauvegarde = await exporterBase(b.base);
  assert.equal(sauvegarde.tables.cm_tableau_acces.length, 3);
  const { baseMigree } = await import('./base.mjs');
  const neuve = await baseMigree();
  await importerBase(neuve, JSON.parse(JSON.stringify(sauvegarde)));
  assert.equal((await neuve.tous('SELECT cible FROM cm_tableau_acces WHERE tableau_id = ?', [tb.id])).length, 3);
  assert.equal((await neuve.premier('SELECT acces FROM cm_tableaux WHERE id = ?', [tb.id])).acces, 'restreint');
  await ok('/moi', s.vue12345, { methode: 'DELETE' });
  assert.equal((await b.base.tous("SELECT cible FROM cm_tableau_acces WHERE genre = 'compte' AND cible = 'vue12345'", [])).length, 0);
});
