/**
 * Colonnes de fin et cartes terminées (migration 0050, docs/esport/cm.md, partie « Colonnes de fin ») : création et
 * réglage d'une colonne de fin, effet sur les cartes (déposer : terminée, sortir : rouverte, date et auteur), exclusions
 * (urgences, compteurs, À valider), journal, notifications (créateur et suiveurs, sans spam), temps réel, tableau
 * restreint, circuit de validation, import Trello et statistiques par semaine.
 *
 * Tourne sur SQLite (défaut) et sur PostgreSQL (ESPORT_TEST_PG, esport/test/pg/lancer.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { banc, teamAvecMembres } from './aide.mjs';
import { debutSemaine, nomColonneDeFin } from '../noyau/cm/colonneFin.mjs';

const TRELLO = JSON.parse(readFileSync(new URL('./donnees/trello-exemple.json', import.meta.url), 'utf8'));

async function preparer() {
  const b = await banc();
  const A = await teamAvecMembres(b, { membres: { lea12345: { pseudo: 'Léa', role: 'joueur' } } });
  const s = { ...A.sessions };
  s.cm123456 = await b.session('cm123456', 'Clara');
  s.red12345 = await b.session('red12345', 'Remi');
  s.vue12345 = await b.session('vue12345', 'Vera');
  s.aut12345 = await b.session('aut12345', 'Aude');
  const api = (chemin, jeton, o = {}) => b.appel(chemin, { jeton, methode: o.methode, corps: o.corps });
  const ok = async (chemin, jeton, o = {}) => {
    const r = await api(chemin, jeton, o);
    assert.equal(r.statut, 200, `${o.methode ?? 'GET'} ${chemin} : ${r.statut} ${JSON.stringify(r.corps)}`);
    return r.corps;
  };
  const tic = () => {
    b.horloge.t += 1000;
  };
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'cm123456', roleId: 'cm-role-responsable', portee: 'club' } });
  const lecteur = await ok('/cm/roles', s.fondateur, { methode: 'POST', corps: { nom: 'Lecteur', couleur: '#123456', permissions: ['cm.voir'] } });
  const redacteur = await ok('/cm/roles', s.fondateur, { methode: 'POST', corps: { nom: 'Rédacteur', couleur: '#654321', permissions: ['cm.voir', 'cm.editer', 'cm.deposer'] } });
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'red12345', roleId: redacteur.id ?? redacteur.role?.id, portee: 'club' } });
  for (const c of ['vue12345', 'aut12345']) await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: c, roleId: lecteur.id ?? lecteur.role?.id, portee: 'club' } });
  const club = (await ok('/cm/tableaux', s.cm123456)).tableaux.find(t => t.portee === 'club');
  const plateau = async (jeton, id = club.id) => ok(`/cm/tableaux/${id}`, jeton);
  const tb = await plateau(s.cm123456);
  const L = Object.fromEntries(tb.listes.map(l => [l.cle, l.id]));
  const carte = async (titre, listeId = L.idees, jeton = s.cm123456, id = club.id) => (await ok(`/cm/tableaux/${id}/cartes`, jeton, { methode: 'POST', corps: { listeId, titre } })).carte;
  const colonne = async (nom, fin, jeton = s.cm123456, id = club.id) => (await ok(`/cm/tableaux/${id}/listes`, jeton, { methode: 'POST', corps: { nom, ...(fin === undefined ? {} : { fin }) } })).id;
  const deplacer = (jeton, id, listeId, index, tableauId) => api(`/cm/cartes/${id}/deplacer`, jeton, { methode: 'POST', corps: { listeId, index, ...(tableauId ? { tableauId } : {}) } });
  const notifs = async jeton => (await ok('/notifications', jeton)).liste.filter(n => n.type === 'cm-carte-terminee');
  const resume = async (jeton, id) => (await plateau(jeton)).cartes.find(c => c.id === id);
  return { b, s, api, ok, tic, club, L, carte, colonne, deplacer, notifs, plateau, resume };
}

test('noms de colonnes de fin et semaines : détection sans accents ni casse, lundi de la semaine', () => {
  for (const nom of ['Fini', 'FINI', 'Terminé', 'Terminées', 'Fait', 'Done', 'Publié', 'Published', 'Terminé ✓', 'Completed']) assert.equal(nomColonneDeFin(nom), true, nom);
  for (const nom of ['Idées', 'En cours', 'À valider', 'Finition', 'Pas fini', '', null]) assert.equal(nomColonneDeFin(nom), false, String(nom));
  assert.equal(debutSemaine('2026-11-03T10:00:00.000Z'), '2026-11-02');
  assert.equal(debutSemaine('2026-11-01T23:59:00.000Z'), '2026-10-26');
  assert.equal(debutSemaine('nimportequoi'), null);
});

test('création : la case « colonne de fin » est facultative (défaut non), modifiable ensuite, valeur illisible refusée, permission cm.editer', async () => {
  const { s, ok, api, tic, club, colonne, plateau } = await preparer();
  const a = await colonne('À relire');
  const f = await colonne('Fini', true);
  const g = await colonne('Archivés', true);
  let d = await plateau(s.vue12345);
  const fin = id => d.listes.find(l => l.id === id).fin;
  assert.equal(fin(a), false);
  assert.equal(fin(f), true);
  assert.equal(fin(g), true, 'plusieurs colonnes de fin possibles');
  assert.ok(d.listes.filter(l => l.cle).every(l => l.fin === false && l.finIgnoree === false), 'rien n’est coché automatiquement');
  tic();
  await ok(`/cm/listes/${a}`, s.red12345, { methode: 'PATCH', corps: { fin: true } });
  await ok(`/cm/listes/${f}`, s.red12345, { methode: 'PATCH', corps: { fin: false } });
  d = await plateau(s.vue12345);
  assert.equal(fin(a), true);
  assert.equal(fin(f), false);
  assert.equal((await api(`/cm/listes/${a}`, s.cm123456, { methode: 'PATCH', corps: { fin: 'oui' } })).statut, 400);
  assert.equal((await api(`/cm/tableaux/${club.id}/listes`, s.cm123456, { methode: 'POST', corps: { nom: 'X', fin: 'oui' } })).statut, 400);
  assert.equal((await api(`/cm/listes/${a}`, s.vue12345, { methode: 'PATCH', corps: { fin: false } })).statut, 403);
  assert.equal((await api(`/cm/tableaux/${club.id}/listes`, s.vue12345, { methode: 'POST', corps: { nom: 'Y', fin: true } })).statut, 403);
  // Proposition refusée : mémorisée pour la colonne.
  await ok(`/cm/listes/${f}`, s.cm123456, { methode: 'PATCH', corps: { finIgnoree: true } });
  assert.equal((await plateau(s.vue12345)).listes.find(l => l.id === f).finIgnoree, true);
});

test('déplacement : déposer dans une colonne de fin termine la carte (date, auteur) ; la sortir la rouvre ; journal de la carte', async () => {
  const { s, ok, tic, carte, colonne, deplacer, plateau, resume } = await preparer();
  const fini = await colonne('Fini', true);
  const encours = await colonne('En cours');
  const a = await carte('Annonce');
  assert.equal((await resume(s.cm123456, a.id)).terminee, false);
  tic();
  assert.equal((await deplacer(s.red12345, a.id, fini, 0)).statut, 200);
  const termine = await resume(s.vue12345, a.id);
  assert.equal(termine.terminee, true);
  assert.ok(termine.termineeLe);
  const fiche = (await ok(`/cm/cartes/${a.id}`, s.vue12345)).carte;
  assert.equal(fiche.termineePar, 'red12345');
  assert.equal(fiche.termineeLe, termine.termineeLe);
  // Rester dans la colonne (changer de rang) ne change rien.
  tic();
  await deplacer(s.red12345, a.id, fini, 0);
  assert.equal((await ok(`/cm/cartes/${a.id}`, s.vue12345)).carte.termineeLe, fiche.termineeLe);
  // Sortie : rouverte.
  tic();
  await deplacer(s.cm123456, a.id, encours, 0);
  assert.equal((await resume(s.vue12345, a.id)).terminee, false);
  const rouverte = (await ok(`/cm/cartes/${a.id}`, s.vue12345)).carte;
  assert.equal(rouverte.termineeLe, null);
  assert.equal(rouverte.termineePar, null);
  assert.deepEqual(rouverte.activite.map(x => x.action).filter(x => ['terminee', 'rouverte'].includes(x)).sort(), ['rouverte', 'terminee']);
  // Une carte créée directement dans une colonne de fin est terminée.
  const b2 = await carte('Déjà fait', fini);
  assert.equal((await resume(s.vue12345, b2.id)).terminee, true);
  assert.equal((await ok(`/cm/cartes/${b2.id}`, s.vue12345)).carte.termineePar, 'cm123456');
  void plateau;
});

test('colonne cochée ou décochée après coup : ses cartes deviennent terminées, puis sont rouvertes ; un seul événement, pas de notification par carte', async () => {
  const { b, s, ok, tic, carte, colonne, notifs, plateau } = await preparer();
  const l = await colonne('Terminé');
  const x = await carte('Une', l);
  const y = await carte('Deux', l);
  await ok(`/cm/cartes/${x.id}/suivre`, s.vue12345, { methode: 'POST', corps: { suivre: true } });
  tic();
  await ok(`/cm/listes/${l}`, s.cm123456, { methode: 'PATCH', corps: { fin: true } });
  let d = await plateau(s.vue12345);
  assert.deepEqual(d.cartes.filter(c => c.listeId === l).map(c => c.terminee), [true, true]);
  assert.equal((await notifs(s.vue12345)).length, 0, 'marquage en masse : aucune notification par carte');
  const evs = await b.base.tous("SELECT charge FROM evenements WHERE type = 'cm.liste_fin'", []);
  assert.equal(evs.length, 1);
  assert.equal(JSON.parse(evs[0].charge).cartes, 2);
  tic();
  await ok(`/cm/listes/${l}`, s.cm123456, { methode: 'PATCH', corps: { fin: false } });
  d = await plateau(s.vue12345);
  assert.deepEqual(d.cartes.filter(c => c.listeId === l).map(c => c.terminee), [false, false]);
  void y;
});

test('exclusions : une carte terminée sort des compteurs et de la liste des urgences, de l’état et de À valider ; le drapeau est conservé', async () => {
  const { s, ok, tic, club, carte, colonne, deplacer, plateau, resume } = await preparer();
  const fini = await colonne('Fini', true);
  const a = await carte('Sensible');
  const c = await carte('Autre');
  await ok(`/cm/cartes/${a.id}`, s.cm123456, { methode: 'PATCH', corps: { urgence: 'critique' } });
  await ok(`/cm/cartes/${c.id}`, s.cm123456, { methode: 'PATCH', corps: { urgence: 'urgent' } });
  assert.equal((await ok('/cm/etat', s.vue12345)).urgences, 2);
  tic();
  await deplacer(s.cm123456, a.id, fini, 0);
  assert.equal((await ok('/cm/etat', s.vue12345)).urgences, 1);
  assert.deepEqual((await ok('/cm/urgences', s.vue12345)).cartes.map(x => x.titre), ['Autre']);
  const entree = (await ok('/cm/tableaux', s.vue12345)).tableaux.find(t => t.id === club.id);
  assert.deepEqual(entree.urgences, { critique: 0, urgent: 1 });
  assert.equal((await resume(s.vue12345, a.id)).urgence, 'critique', 'le drapeau est conservé');
  // Rouverte : compte de nouveau.
  tic();
  await deplacer(s.cm123456, a.id, (await plateau(s.cm123456)).listes[0].id, 0);
  assert.equal((await ok('/cm/etat', s.vue12345)).urgences, 2);
  // À valider : un post soumis puis rangé dans une colonne de fin ne compte plus.
  const p = await carte('Post');
  await ok(`/cm/cartes/${p.id}`, s.cm123456, { methode: 'PATCH', corps: { post: true, reseaux: ['x'], textes: { x: { fr: 'Salut' } } } });
  await ok(`/cm/cartes/${p.id}/soumettre`, s.cm123456, { methode: 'POST', corps: {} });
  assert.equal((await ok('/cm/a-valider', s.cm123456)).cartes.length, 1);
  assert.equal((await ok('/cm/etat', s.cm123456)).aValider, 1);
  tic();
  await deplacer(s.cm123456, p.id, fini, 0);
  assert.equal((await ok('/cm/a-valider', s.cm123456)).cartes.length, 0);
  assert.equal((await ok('/cm/etat', s.cm123456)).aValider, 0);
  assert.equal((await ok('/cm/tableaux', s.cm123456)).tableaux.find(t => t.id === club.id).aValider, 0);
});

test('alertes d’urgence : monter une carte terminée en critique ne notifie personne', async () => {
  const { s, ok, tic, carte, colonne, deplacer } = await preparer();
  const fini = await colonne('Fini', true);
  const a = await carte('Close');
  await ok(`/cm/cartes/${a.id}`, s.cm123456, { methode: 'PATCH', corps: { membres: ['red12345'] } });
  await deplacer(s.cm123456, a.id, fini, 0);
  tic();
  await ok(`/cm/cartes/${a.id}`, s.cm123456, { methode: 'PATCH', corps: { urgence: 'critique' } });
  const n = (await ok('/notifications', s.red12345)).liste.filter(x => x.type === 'cm-urgence');
  assert.equal(n.length, 0);
});

test('notifications : créateur et suiveurs prévenus (pas l’auteur), une seule non lue par carte, rien à la réouverture', async () => {
  const { s, ok, tic, carte, colonne, deplacer, notifs } = await preparer();
  const fini = await colonne('Fini', true);
  const ouvert = await colonne('En cours');
  const a = await carte('Reportage', undefined, s.red12345);
  await ok(`/cm/cartes/${a.id}/suivre`, s.vue12345, { methode: 'POST', corps: { suivre: true } });
  await ok(`/cm/cartes/${a.id}`, s.cm123456, { methode: 'PATCH', corps: { membres: ['aut12345'] } });
  tic();
  await deplacer(s.cm123456, a.id, fini, 0);
  assert.equal((await notifs(s.red12345)).length, 1, 'créateur');
  assert.equal((await notifs(s.vue12345)).length, 1, 'suiveur');
  assert.equal((await notifs(s.aut12345)).length, 0, 'assignée sans suivre : non prévenue');
  assert.equal((await notifs(s.cm123456)).length, 0, 'auteur du dépôt');
  const charge = (await notifs(s.red12345))[0].charge ?? (await notifs(s.red12345))[0];
  assert.equal(JSON.stringify(charge).includes('Reportage'), true);
  // Va-et-vient : la notification non lue n'est pas dupliquée ; la réouverture ne prévient personne.
  tic();
  await deplacer(s.cm123456, a.id, ouvert, 0);
  tic();
  await deplacer(s.cm123456, a.id, fini, 0);
  assert.equal((await notifs(s.red12345)).length, 1);
  assert.equal((await notifs(s.vue12345)).length, 1);
  // Le créateur lui-même qui termine sa carte : ni lui ni personne d'autre que les suiveurs.
  const c = await carte('Perso', undefined, s.red12345);
  tic();
  await deplacer(s.red12345, c.id, fini, 0);
  assert.equal((await notifs(s.red12345)).length, 1, 'toujours celle de la première carte');
});

test('tableau restreint : notification seulement pour qui voit le tableau, statistiques et compteurs sans fuite', async () => {
  const { s, ok, tic, deplacer, notifs } = await preparer();
  const tb = (await ok('/cm/tableaux', s.cm123456, { methode: 'POST', corps: { nom: 'Secret', modele: 'contenus' } })).tableau;
  const fini = (await ok(`/cm/tableaux/${tb.id}/listes`, s.cm123456, { methode: 'POST', corps: { nom: 'Fini', fin: true } })).id;
  const detail = await ok(`/cm/tableaux/${tb.id}`, s.cm123456);
  const c = (await ok(`/cm/tableaux/${tb.id}/cartes`, s.cm123456, { methode: 'POST', corps: { listeId: detail.listes[0].id, titre: 'Projet Licorne' } })).carte;
  for (const j of [s.vue12345, s.aut12345]) await ok(`/cm/cartes/${c.id}/suivre`, j, { methode: 'POST', corps: { suivre: true } });
  const regles = [{ genre: 'compte', cible: 'cm123456', niveau: 'modifier' }, { genre: 'compte', cible: 'red12345', niveau: 'modifier' }, { genre: 'compte', cible: 'vue12345', niveau: 'voir' }];
  await ok(`/cm/tableaux/${tb.id}/acces`, s.cm123456, { methode: 'PUT', corps: { acces: 'restreint', regles } });
  tic();
  assert.equal((await deplacer(s.red12345, c.id, fini, 0)).statut, 200);
  assert.equal((await notifs(s.vue12345)).length, 1);
  assert.equal((await notifs(s.aut12345)).length, 0, 'Aude ne voit pas le tableau');
  assert.equal((await ok('/cm/terminees', s.vue12345)).total, 1);
  assert.equal((await ok('/cm/terminees', s.aut12345)).total, 0);
  // Aude ne peut ni voir ni déplacer.
  assert.equal((await deplacer(s.aut12345, c.id, detail.listes[0].id, 0)).statut, 404);
  // Vera (voir seulement) ne déplace pas.
  assert.equal((await deplacer(s.vue12345, c.id, detail.listes[0].id, 0)).statut, 403);
  // Vera perd l'accès : sa notification disparaît.
  await ok(`/cm/tableaux/${tb.id}/acces`, s.cm123456, { methode: 'PUT', corps: { acces: 'restreint', regles: regles.filter(r => r.cible !== 'vue12345') } });
  assert.equal((await notifs(s.vue12345)).length, 0);
  assert.equal((await ok('/cm/terminees', s.vue12345)).total, 0);
});

test('temps réel : déposer une carte dans une colonne de fin est diffusé (sujet cm) et incrémente la version du tableau', async () => {
  const { b, s, carte, colonne, deplacer, club, ok, tic } = await preparer();
  const fini = await colonne('Fini', true);
  const a = await carte('Carte A');
  const flux = async () => b.base.tous('SELECT sujet, acteur FROM temps_reel_flux ORDER BY id', []);
  const avant = (await flux()).length;
  const v0 = (await ok('/cm/etat', s.vue12345)).versions[club.id];
  tic();
  await deplacer(s.cm123456, a.id, fini, 0);
  assert.ok((await flux()).slice(avant).some(m => m.sujet === 'cm' && m.acteur === 'cm123456'));
  assert.ok((await ok('/cm/etat', s.vue12345)).versions[club.id] > v0);
  const types = (await b.base.tous('SELECT type FROM evenements ORDER BY cree_le', [])).map(e => e.type);
  assert.ok(types.includes('cm.carte_terminee'));
  tic();
  await deplacer(s.cm123456, a.id, (await ok(`/cm/tableaux/${club.id}`, s.cm123456)).listes[0].id, 0);
  assert.ok((await b.base.tous('SELECT type FROM evenements', [])).some(e => e.type === 'cm.carte_rouverte'));
});

test('circuit de validation : un post publié rejoint la colonne « Publié » cochée comme colonne de fin et devient terminé ; dépublié, il est rouvert', async () => {
  const { s, ok, tic, club, L, carte, resume } = await preparer();
  await ok(`/cm/listes/${L.publie}`, s.cm123456, { methode: 'PATCH', corps: { fin: true } });
  const p = await carte('Post à publier');
  await ok(`/cm/cartes/${p.id}`, s.cm123456, { methode: 'PATCH', corps: { post: true, reseaux: ['x'], textes: { x: { fr: 'Salut' } } } });
  tic();
  await ok(`/cm/cartes/${p.id}/soumettre`, s.cm123456, { methode: 'POST', corps: {} });
  assert.equal((await resume(s.cm123456, p.id)).terminee, false);
  tic();
  await ok(`/cm/cartes/${p.id}/valider`, s.fondateur, { methode: 'POST', corps: {} });
  tic();
  await ok(`/cm/cartes/${p.id}/publier`, s.cm123456, { methode: 'POST', corps: { publications: { x: 'https://x.com/club/status/1' } } });
  const publie = await resume(s.cm123456, p.id);
  assert.equal(publie.listeId, L.publie);
  assert.equal(publie.terminee, true);
  tic();
  await ok(`/cm/cartes/${p.id}/depublier`, s.cm123456, { methode: 'POST', corps: {} });
  const depublie = await resume(s.cm123456, p.id);
  assert.equal(depublie.terminee, false);
  void club;
});

test('déplacement vers un autre tableau : l’état suit la colonne de destination', async () => {
  const { s, ok, tic, carte, colonne, deplacer, club, resume, plateau } = await preparer();
  const autre = (await ok('/cm/tableaux', s.cm123456, { methode: 'POST', corps: { nom: 'Autre', modele: 'vide' } })).tableau;
  const finAutre = await colonne('Fini', true, s.cm123456, autre.id);
  const a = await carte('Voyageuse');
  tic();
  assert.equal((await deplacer(s.cm123456, a.id, finAutre, 0, autre.id)).statut, 200);
  const d = await plateau(s.cm123456, autre.id);
  assert.equal(d.cartes.find(c => c.id === a.id).terminee, true);
  tic();
  assert.equal((await deplacer(s.cm123456, a.id, (await plateau(s.cm123456)).listes[0].id, 0, club.id)).statut, 200);
  assert.equal((await resume(s.cm123456, a.id)).terminee, false);
});

test('statistiques : cartes terminées par semaine (8 semaines par défaut), semaine en cours à droite', async () => {
  const { b, s, ok, tic, carte, colonne, deplacer } = await preparer();
  const fini = await colonne('Fini', true);
  const x = await carte('Une');
  const y = await carte('Deux');
  tic();
  await deplacer(s.cm123456, x.id, fini, 0);
  await deplacer(s.cm123456, y.id, fini, 0);
  let r = await ok('/cm/terminees', s.vue12345);
  assert.equal(r.semaines.length, 8);
  assert.equal(r.semaines[7].n, 2);
  assert.equal(r.total, 2);
  // Une carte terminée il y a deux semaines compte dans sa semaine.
  const il_y_a = new Date(b.horloge.t - 14 * 86_400_000).toISOString();
  await b.base.executer('UPDATE cm_cartes SET terminee_le = ? WHERE id = ?', [il_y_a, x.id]);
  r = await ok('/cm/terminees?semaines=4', s.vue12345);
  assert.equal(r.semaines.length, 4);
  assert.equal(r.semaines[3].n + r.semaines[2].n + r.semaines[1].n, 2);
  assert.equal(r.total, 2);
  assert.equal((await ok('/cm/terminees?semaines=500', s.vue12345)).semaines.length, 26);
});

test('import Trello : listes archivées ou « Publié » proposées comme colonnes de fin, marquées sur demande, cartes terminées', async () => {
  const { s, ok } = await preparer();
  const trello = JSON.parse(JSON.stringify(TRELLO));
  const apercu = await ok('/cm/import/trello/apercu', s.cm123456, { methode: 'POST', corps: { trello, avecArchivees: true } });
  const propose = apercu.listes.filter(l => l.proposeFin).map(l => l.nom).sort();
  assert.deepEqual(propose, ['Ancienne liste', 'Publié']);
  const idPublie = apercu.listes.find(l => l.nom === 'Publié').trelloId;
  // Sans choix : rien n'est coché.
  const sans = await ok('/cm/import/trello', s.cm123456, { methode: 'POST', corps: { trello } });
  const t1 = await ok(`/cm/tableaux/${sans.tableauId}`, s.cm123456);
  assert.ok(t1.listes.every(l => l.fin === false));
  assert.ok(t1.cartes.every(c => c.terminee === false));
  // Relance avec le choix : la colonne devient colonne de fin, ses cartes terminées.
  const avec = await ok('/cm/import/trello', s.cm123456, { methode: 'POST', corps: { trello, listesFin: [idPublie, 'inconnue'] } });
  assert.equal(avec.bilan.colonnesFin, 1);
  const t2 = await ok(`/cm/tableaux/${avec.tableauId}`, s.cm123456, {});
  const publie = t2.listes.find(l => l.nom === 'Publié');
  assert.equal(publie.fin, true);
  assert.ok(t2.cartes.filter(c => c.listeId === publie.id).every(c => c.terminee));
  assert.ok(t2.cartes.filter(c => c.listeId !== publie.id).every(c => !c.terminee));
  // Un nouvel import sans le choix ne décoche pas la colonne.
  await ok('/cm/import/trello', s.cm123456, { methode: 'POST', corps: { trello } });
  assert.equal((await ok(`/cm/tableaux/${avec.tableauId}`, s.cm123456)).listes.find(l => l.nom === 'Publié').fin, true);
});

test('RGPD : la suppression du compte efface l’auteur de la fin, la carte reste terminée', async () => {
  const { b, s, carte, colonne, deplacer, ok } = await preparer();
  const fini = await colonne('Fini', true);
  const a = await carte('Close');
  await deplacer(s.red12345, a.id, fini, 0);
  assert.equal((await ok(`/cm/cartes/${a.id}`, s.cm123456)).carte.termineePar, 'red12345');
  const { effacementCm } = await import('../noyau/cm/rgpd.mjs');
  await b.base.lot(await effacementCm(b.base, 'red12345'));
  const ligne = await b.base.premier('SELECT terminee_le, terminee_par FROM cm_cartes WHERE id = ?', [a.id]);
  assert.equal(ligne.terminee_par, null);
  assert.ok(ligne.terminee_le, 'la carte reste terminée');
});
