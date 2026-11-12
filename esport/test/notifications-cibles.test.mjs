/**
 * Liens directs des notifications (migration 0076, docs/esport/notifications.md « Liens directs ») : chaque type
 * d'événement du bus et chaque notification personnelle est rangé sous un genre de cible (le test échoue pour un
 * nouveau type pas encore rangé), format stable et versionné, cible enregistrée avec la notification, vérification au
 * clic (élément supprimé, accès perdu), anciennes notifications sans cible (lien de section), adresse partageable.
 *
 * Tourne sur SQLite (défaut) et sur PostgreSQL (ESPORT_TEST_PG, esport/test/pg/lancer.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { banc, teamAvecMembres } from './aide.mjs';
import { TYPES_EVENEMENTS } from '../noyau/evenements.mjs';
import { regleDe } from '../noyau/notifications/regles.mjs';
import {
  CHAMPS_CIBLES,
  CIBLES_EVENEMENTS,
  CIBLES_PERSONNELLES,
  GENRES_CIBLES,
  TYPES_PERSONNELS,
  cibleEvenement,
  ciblePersonnelle,
  fragmentCible,
  genreEvenement,
  lienProfond,
  normaliserCible,
} from '../noyau/notifications/cibles.mjs';

const RACINE = new URL('..', import.meta.url).pathname;

function fichiers(dossier) {
  return readdirSync(dossier).flatMap(n => {
    const p = join(dossier, n);
    return statSync(p).isDirectory() ? fichiers(p) : p.endsWith('.mjs') ? [p] : [];
  });
}

// ------------------------------------------------------------------ Tous les types sont rangés

test('chaque type d’événement du bus est rangé sous UN genre de cible (ou section / aucune)', () => {
  const ranges = Object.values(CIBLES_EVENEMENTS).flat();
  const manquants = TYPES_EVENEMENTS.filter(t => !genreEvenement(t));
  assert.deepEqual(manquants, [], `types sans cible : ajoutez-les à CIBLES_EVENEMENTS (cibles.mjs) : ${manquants.join(', ')}`);
  const doublons = ranges.filter((t, i) => ranges.indexOf(t) !== i);
  assert.deepEqual(doublons, [], 'un type rangé deux fois');
  const inconnus = ranges.filter(t => !TYPES_EVENEMENTS.includes(t));
  assert.deepEqual(inconnus, [], 'type rangé mais absent du bus');
  for (const g of Object.keys(CIBLES_EVENEMENTS)) assert.ok(g === 'section' || g === 'aucune' || GENRES_CIBLES.includes(g), g);
  // « aucune » : seulement des types jamais affichés (règle « aucun »), et inversement un type affiché a un endroit.
  for (const t of CIBLES_EVENEMENTS.aucune) assert.equal(regleDe(t).acces, 'aucun', t);
  for (const t of TYPES_EVENEMENTS) if (genreEvenement(t) !== 'aucune' && genreEvenement(t) !== 'section' && regleDe(t).acces !== 'aucun') assert.ok(regleDe(t).lien, `${t} : lien de section de repli`);
});

test('chaque notification personnelle écrite par un module est rangée sous un genre de cible', () => {
  const ignores = new Set(['devblog-brouillon', 'devblog-introuvable', 'devblog-salon-inconnu', 'devblog-salons']);
  const trouves = new Set();
  for (const f of fichiers(join(RACINE, 'noyau'))) {
    if (f.includes('/notifications/')) continue;
    const texte = readFileSync(f, 'utf8');
    if (!texte.includes('INTO notifications')) continue;
    for (const m of texte.matchAll(/'([a-z]+(?:-[a-z0-9]+)+)'/g)) if (!ignores.has(m[1])) trouves.add(m[1]);
  }
  assert.ok(trouves.size > 40, `types trouvés : ${trouves.size}`);
  const manquants = [...trouves].filter(t => !TYPES_PERSONNELS.includes(t));
  assert.deepEqual(manquants, [], `notifications personnelles sans cible : ajoutez-les à CIBLES_PERSONNELLES (cibles.mjs) : ${manquants.join(', ')}`);
  for (const t of ['bienvenue', 'retire', 'modules']) assert.ok(TYPES_PERSONNELS.includes(t), t);
  const ranges = Object.values(CIBLES_PERSONNELLES).flat();
  assert.equal(new Set(ranges).size, ranges.length, 'rangée deux fois');
  // L'app connaît exactement les mêmes genres (src/esport/notifications/cibles.ts).
  const app = readFileSync(join(RACINE, '..', 'src/esport/notifications/cibles.ts'), 'utf8');
  const liste = app.match(/GENRES_CIBLES = \[([^\]]*)\]/)?.[1] ?? '';
  assert.deepEqual([...liste.matchAll(/'([a-z_]+)'/g)].map(m => m[1]), [...GENRES_CIBLES]);
});

// ------------------------------------------------------------------ Format

test('format stable et versionné : genre connu, identifiants courts, champ principal obligatoire', () => {
  assert.deepEqual(normaliserCible({ v: 1, g: 'carte_cm', carte: 'c1', commentaire: 'k1', autre: 'x', tableau: '<script>' }), { v: 1, g: 'carte_cm', carte: 'c1', commentaire: 'k1' });
  assert.equal(normaliserCible({ v: 2, g: 'carte_cm', carte: 'c1' }), null, 'version inconnue');
  assert.equal(normaliserCible({ v: 1, g: 'inconnu', id: 'c1' }), null);
  assert.equal(normaliserCible({ v: 1, g: 'ticket' }), null, 'sans identifiant');
  assert.equal(normaliserCible({ v: 1, g: 'drive', portee: 'club' }), null, 'ni fichier ni dossier');
  assert.equal(normaliserCible('pas du json'), null);
  assert.deepEqual(normaliserCible('{"v":1,"g":"ticket","ticket":"t1","message":"m1"}'), { v: 1, g: 'ticket', ticket: 't1', message: 'm1' });
  for (const g of GENRES_CIBLES) assert.ok(Array.isArray(CHAMPS_CIBLES[g]), g);
});

test('cibles des événements du bus et des notifications personnelles', () => {
  const ev = (type, entite_type, entite_id, charge = {}, team_id = 'team1', acteur_id = 'acteur1') => ({ type, entite_type, entite_id, charge: JSON.stringify(charge), team_id, acteur_id });
  assert.deepEqual(cibleEvenement(ev('cm.commentaire_ajoute', 'cm_carte', 'c1', { tableau: 'tb1', commentaireId: 'k1' })), { v: 1, g: 'carte_cm', carte: 'c1', commentaire: 'k1', tableau: 'tb1' });
  assert.deepEqual(cibleEvenement(ev('event.created', 'evenement', 'e1', { debut: '2026-10-22T18:00:00.000Z' })), { v: 1, g: 'evenement', evenement: 'e1', team: 'team1' });
  assert.deepEqual(cibleEvenement(ev('attendance.rsvp', 'evenement', 'e1', { occurrence: '2026-10-22T18:00:00.000Z' })), { v: 1, g: 'evenement', evenement: 'e1', occurrence: '2026-10-22T18:00:00.000Z', team: 'team1' });
  assert.deepEqual(cibleEvenement(ev('cm.drive_fichier_ajoute', 'cm_drive', 'f1', { portee: 'club' }, null)), { v: 1, g: 'drive', fichier: 'f1', portee: 'club' });
  assert.deepEqual(cibleEvenement(ev('drive.ajout', 'cm_drive_dossier', 'd1', { portee: 'team1' })), { v: 1, g: 'drive', dossier: 'd1', portee: 'team1' });
  assert.deepEqual(cibleEvenement(ev('review.comment_added', 'commentaire', 'k1', { reviewId: 'r1', repereId: 'p1' })), { v: 1, g: 'review', review: 'r1', repere: 'p1', team: 'team1' });
  assert.deepEqual(cibleEvenement(ev('tournoi.match_planifie', 'tournoi_match', 'm1', { tournoiId: 'to1' })), { v: 1, g: 'tournoi', tournoi: 'to1', team: 'team1' });
  assert.deepEqual(cibleEvenement(ev('member.joined', 'membre', 'mb1', {})), { v: 1, g: 'membre', compte: 'acteur1', team: 'team1' });
  assert.deepEqual(cibleEvenement(ev('ticket.ouvert', 'ticket', 't1', { numero: 4 }, null)), { v: 1, g: 'ticket', ticket: 't1' });
  assert.equal(cibleEvenement(ev('discord.delivery_failed', 'discord', 'x')), null, 'section : le lien de section suffit');
  assert.equal(cibleEvenement(ev('type.inconnu', null, null)), null);

  const perso = (type, charge, extra = {}) => ciblePersonnelle({ id: `ev1:moi`, compte_id: 'moi', type, team_id: 'team1', charge: JSON.stringify(charge), ...extra });
  assert.deepEqual(perso('cm-mention', { carte: 'c1', tableau: 'tb1', commentaireId: 'k1' }), { v: 1, g: 'carte_cm', carte: 'c1', commentaire: 'k1', tableau: 'tb1' });
  assert.deepEqual(perso('tk-message', { ticket: 't1', numero: 3 }, { id: 'msg1:moi', team_id: null }), { v: 1, g: 'ticket', ticket: 't1', message: 'msg1' }, 'message du ticket');
  assert.deepEqual(perso('tk-nouveau', { ticket: 't1' }, { team_id: null }), { v: 1, g: 'ticket', ticket: 't1' }, 'jamais l’événement pris pour un message');
  assert.deepEqual(perso('evenement-nouveau', { evenementId: 'e1', debut: 'x' }), { v: 1, g: 'evenement', evenement: 'e1', team: 'team1' });
  assert.deepEqual(perso('rappel-rsvp', { evenementId: 'e1', occurrence: '2026-10-22T18:00:00.000Z' }), { v: 1, g: 'evenement', evenement: 'e1', occurrence: '2026-10-22T18:00:00.000Z', team: 'team1' });
  assert.deepEqual(perso('trombi-modifiee', { membre: 'staff1' }, { team_id: null }), { v: 1, g: 'membre', compte: 'moi' }, 'sa propre fiche');
  assert.deepEqual(perso('membre-arrive', { membre: 'nouveau1' }), { v: 1, g: 'membre', compte: 'nouveau1', team: 'team1' });
  assert.deepEqual(perso('cm-reunion-invite', { reunion: 'r1', debut: '2026-10-22T18:00:00.000Z' }, { team_id: null }), { v: 1, g: 'reunion_cm', reunion: 'r1', debut: '2026-10-22T18:00:00.000Z' });
  assert.deepEqual(perso('devblog-auto', { etat: 'brouillon', entree: 'd1' }, { team_id: null }), { v: 1, g: 'devblog', brouillon: 'd1' });
  assert.deepEqual(perso('sp-action', { prospect: 'p1' }, { team_id: null }), { v: 1, g: 'sponsor', prospect: 'p1' });
  assert.equal(perso('bienvenue', {}), null, 'section');
  // Repli : la charge ne nomme pas l'élément, l'événement d'origine (même genre) oui.
  assert.deepEqual(perso('cm-depot', {}, { team_id: null }), null);
  assert.deepEqual(ciblePersonnelle({ id: 'e:moi', compte_id: 'moi', type: 'cm-depot', charge: '{}' }, { cible: '{"v":1,"g":"carte_cm","carte":"c9"}' }), { v: 1, g: 'carte_cm', carte: 'c9' });
});

test('adresse partageable : même fragment que l’app, rien sans adresse https', () => {
  assert.equal(fragmentCible({ v: 1, g: 'carte_cm', carte: 'c1', commentaire: 'k 1' }), '#/app/esport/c/carte_cm?carte=c1');
  assert.equal(fragmentCible({ v: 1, g: 'ticket', ticket: 't1', message: 'm1' }), '#/app/esport/c/ticket?ticket=t1&message=m1');
  assert.equal(lienProfond('https://app.exemple.fr/', { v: 1, g: 'evenement', evenement: 'e1', team: 'tm1' }), 'https://app.exemple.fr/#/app/esport/c/evenement?evenement=e1&team=tm1');
  assert.equal(lienProfond('https://app.exemple.fr/#/vieux', { v: 1, g: 'ticket', ticket: 't1' }), 'https://app.exemple.fr/#/app/esport/c/ticket?ticket=t1');
  assert.equal(lienProfond('', { v: 1, g: 'ticket', ticket: 't1' }), '');
  assert.equal(lienProfond('http://app.exemple.fr', { v: 1, g: 'ticket', ticket: 't1' }), '');
});

// ------------------------------------------------------------------ Bout en bout

async function preparer() {
  const b = await banc();
  const A = await teamAvecMembres(b, {
    membres: {
      coach123: { pseudo: 'Zed', role: 'coach' },
      lea12345: { pseudo: 'Lea', role: 'joueur' },
    },
  });
  const B = await teamAvecMembres(b, { nom: 'Team Bravo', membres: { bob12345: { pseudo: 'Bob', role: 'coach' } } });
  const s = { ...A.sessions, bob12345: B.sessions.bob12345 };
  s.cm123456 = await b.session('cm123456', 'Clara');
  s.red12345 = await b.session('red12345', 'Remi');
  const api = (chemin, jeton, o = {}) => b.appel(chemin, { jeton, methode: o.methode, corps: o.corps });
  const ok = async (chemin, jeton, o = {}) => {
    const r = await api(chemin, jeton, o);
    assert.equal(r.statut, 200, `${o.methode ?? 'GET'} ${chemin} : ${r.statut} ${JSON.stringify(r.corps)}`);
    return r.corps;
  };
  const tic = () => {
    b.horloge.t += 1000;
  };
  const verifier = async (jeton, cible) => ok('/notifications/cible', jeton, { methode: 'POST', corps: { cible } });
  return { b, A, B, s, api, ok, tic, verifier };
}

test('carte CM commentée : la notification mène au commentaire ; carte supprimée, accès perdu', async () => {
  const { s, ok, api, tic, verifier } = await preparer();
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'cm123456', roleId: 'cm-role-responsable', portee: 'club' } });
  const redacteur = await ok('/cm/roles', s.fondateur, { methode: 'POST', corps: { nom: 'Rédacteur', couleur: '#654321', permissions: ['cm.voir', 'cm.editer'] } });
  const roleId = redacteur.id ?? redacteur.role?.id;
  const affectations = await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'red12345', roleId, portee: 'club' } });
  const affectation = (affectations.affectations ?? affectations).find(a => a.compte === 'red12345');
  const club = (await ok('/cm/tableaux', s.cm123456)).tableaux.find(t => t.portee === 'club');
  const tb = await ok(`/cm/tableaux/${club.id}`, s.cm123456);
  const carte = (await ok(`/cm/tableaux/${club.id}/cartes`, s.cm123456, { methode: 'POST', corps: { listeId: tb.listes[0].id, titre: 'Annonce roster' } })).carte;
  tic();
  const apres = await ok(`/cm/cartes/${carte.id}/commentaires`, s.cm123456, { methode: 'POST', corps: { texte: 'Relis ça @Remi' } });
  const commentaire = (apres.carte ?? apres).commentaires.at(-1).id;
  tic();
  const liste = (await ok('/notifications/centre', s.red12345)).liste;
  const n = liste.find(x => x.type === 'cm-mention');
  assert.ok(n, JSON.stringify(liste.map(x => x.type)));
  assert.deepEqual(n.cible, { v: 1, g: 'carte_cm', carte: carte.id, commentaire, tableau: club.id });
  assert.deepEqual(n.lien, { vue: 'cm', onglet: 'tableaux' }, 'le lien de section reste (repli)');
  // Au clic : la carte existe, le lecteur la voit → cible complétée (tableau).
  assert.deepEqual(await verifier(s.red12345, n.cible), { etat: 'ok', cible: { v: 1, g: 'carte_cm', carte: carte.id, commentaire, tableau: club.id } });
  // Un joueur sans accès CM : « vous n'avez plus accès » (rien d'autre n'est révélé).
  assert.deepEqual(await verifier(s.lea12345, n.cible), { etat: 'interdit' });
  // Accès retiré : la notification n'est plus listée, et le lien direct répond « plus accès ».
  await ok(`/cm/affectations/${affectation.id}`, s.fondateur, { methode: 'DELETE' });
  assert.deepEqual(await verifier(s.red12345, n.cible), { etat: 'interdit' });
  // Carte supprimée : « cet élément n'existe plus ».
  await ok(`/cm/cartes/${carte.id}`, s.cm123456, { methode: 'DELETE' });
  assert.deepEqual(await verifier(s.cm123456, n.cible), { etat: 'supprime' });
  // Cible illisible : 400.
  assert.equal((await api('/notifications/cible', s.cm123456, { methode: 'POST', corps: { cible: { v: 9, g: 'x' } } })).statut, 400);
});

const SCRIM = { type: 'scrim', titre: 'Scrim vs Nova', date: '2026-10-22', heureDebut: '20:00', heureFin: '22:00', convocation: { groupes: ['joueurs'] } };

test('événement du planning : la notification mène à l’événement de sa team ; autre team, événement supprimé', async () => {
  const { A, s, ok, tic, verifier } = await preparer();
  const cree = await ok(`/teams/${A.teamId}/planning`, s.coach123, { methode: 'POST', corps: SCRIM });
  const id = cree.evenement?.id ?? cree.id;
  tic();
  const n = (await ok('/notifications/centre', s.lea12345)).liste.find(x => x.type === 'evenement-nouveau');
  assert.ok(n);
  assert.deepEqual(n.cible, { v: 1, g: 'evenement', evenement: id, team: A.teamId });
  const r = await verifier(s.lea12345, n.cible);
  assert.equal(r.etat, 'ok');
  assert.equal(r.cible.team, A.teamId);
  assert.match(r.cible.occurrence, /^2026-10-22T/, 'date de l’événement pour l’ouvrir au bon jour');
  // Le coach d'une autre team : pas d'accès.
  assert.deepEqual(await verifier(s.bob12345, n.cible), { etat: 'interdit' });
  // Le fil (staff) porte la même cible.
  const fil = (await ok('/notifications/centre', s.fondateur)).liste.find(x => x.evenement === 'event.created' && x.source === 'fil');
  assert.deepEqual(fil?.cible, { v: 1, g: 'evenement', evenement: id, team: A.teamId });
  await ok(`/teams/${A.teamId}/planning/${id}`, s.coach123, { methode: 'DELETE' });
  assert.deepEqual(await verifier(s.lea12345, n.cible), { etat: 'supprime' });
});

test('anciennes notifications (sans cible) : lien de section, comme avant', async () => {
  const { b, A, s, ok } = await preparer();
  await b.base.executer("INSERT INTO notifications (id, compte_id, team_id, type, charge, cree_le, categorie, cible) VALUES ('vieille:lea12345', 'lea12345', ?, 'evenement-nouveau', '{\"titre\":\"Vieux scrim\"}', ?, 'planning', '')", [A.teamId, new Date(b.horloge.t).toISOString()]);
  const n = (await ok('/notifications/centre', s.lea12345)).liste.find(x => x.id === 'vieille:lea12345');
  assert.ok(n);
  assert.equal(n.cible, null);
  assert.deepEqual(n.lien, { vue: 'team', section: 'module:planning' });
});

test('ticket : message d’un ticket, ticket supprimé, catégorie plus visible', async () => {
  const { b, s, verifier } = await preparer();
  const t = new Date(b.horloge.t).toISOString();
  const cat = await b.base.premier('SELECT id FROM tickets_categories LIMIT 1', []);
  const categorie = cat?.id ?? 'cat-test';
  if (!cat) await b.base.executer("INSERT INTO tickets_categories (id, nom_fr, nom_en, position, cree_le, maj_le) VALUES (?, 'Support', 'Support', 0, ?, ?)", [categorie, t, t]);
  await b.base.executer("INSERT INTO tickets (id, numero, categorie_id, statut, priorite, auteur_discord_id, auteur_nom, salon_id, ouvert_le, maj_le, derniere_activite_le) VALUES ('tk1', 7, ?, 'ouvert', 'moyen', '123', 'Joueur', '456', ?, ?, ?)", [categorie, t, t, t]);
  await b.base.executer("INSERT INTO tickets_messages (id, ticket_id, genre, auteur_nom, staff, contenu, cree_le) VALUES ('msg1', 'tk1', 'discord', 'Joueur', 0, 'Bonjour', ?)", [t]);
  assert.deepEqual(await verifier(s.fondateur, { v: 1, g: 'ticket', ticket: 'tk1', message: 'msg1' }), { etat: 'ok', cible: { v: 1, g: 'ticket', ticket: 'tk1', message: 'msg1' } });
  assert.deepEqual(await verifier(s.fondateur, { v: 1, g: 'ticket', ticket: 'tk1', message: 'disparu' }), { etat: 'ok', cible: { v: 1, g: 'ticket', ticket: 'tk1' } }, 'message effacé : le ticket s’ouvre');
  assert.deepEqual(await verifier(s.lea12345, { v: 1, g: 'ticket', ticket: 'tk1' }), { etat: 'interdit' });
  await b.base.executer("UPDATE tickets SET supprime_le = ? WHERE id = 'tk1'", [t]);
  assert.deepEqual(await verifier(s.fondateur, { v: 1, g: 'ticket', ticket: 'tk1' }), { etat: 'supprime' });
  assert.deepEqual(await verifier(s.fondateur, { v: 1, g: 'ticket', ticket: 'jamais' }), { etat: 'supprime' });
});
