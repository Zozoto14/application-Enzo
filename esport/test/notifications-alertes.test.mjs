/**
 * Avis de tickets et alertes techniques du centre de notifications (migration 0077, docs/esport/notifications.md
 * « Alertes et avis ») : avis d'un ticket (ceux qui traitent la catégorie, le Fondateur ; jamais une catégorie qu'on ne voit
 * pas), alertes (destinataires par permission, accès relu à chaque lecture, interrupteur par type dans les préférences),
 * dédoublonnage (une notification par alerte, destinataire et fenêtre de 6 h, avec compteur), liens directs (vérification
 * au clic). Les sources d'alertes (salons de match, vocaux, rôles d'événement, rôles temporaires) sont testées avec leur
 * module (salons-match, vocaux, evenements-club, roles-temp).
 *
 * Tourne sur SQLite (défaut) et sur PostgreSQL (ESPORT_TEST_PG, esport/test/pg/lancer.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { bancTickets } from './tickets-aide.mjs';
import { distribuer } from '../noyau/evenements.mjs';
import { signalerAlerte, PAUSE_SIGNALEMENT_MS } from '../noyau/notifications/signaler.mjs';
import { ALERTES, FENETRE_ALERTE_MS, TYPES_COUPABLES } from '../noyau/notifications/alertes.mjs';
import { normaliserCible } from '../noyau/notifications/cibles.mjs';

const H = 3_600_000;
const OUVERTS = '710000000000000010';
const ARCHIVES = '710000000000000011';
const JOURNAUX = '710000000000000012';
const STAFF = '720000000000000001';
const LEA = '800000000000000001';

/** Notifications d'un type pour un compte (liste du centre, session rouverte : l'horloge avance). */
async function recues(k, compte, type) {
  const r = await k.api('/notifications/centre?limite=100', await k.b.session(compte));
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  return r.corps.liste.filter(n => n.type === type);
}
const distribuerTout = k => distribuer(k.b.base, { maintenant: k.b.horloge.t });

async function monter() {
  const k = await bancTickets({ banc });
  const gestion = await k.compteAvec('gest1234', 'Gestion', ['evenements.gerer']);
  const vocal = await k.compteAvec('voc12345', 'Vocal', ['vocaux.configurer']);
  const simple = await k.compteAvec('simp1234', 'Simple', ['tickets.voir']);
  const ev = await k.api('/evenements', undefined, { methode: 'POST', corps: { nom: 'The Nuke End', debut: '2026-10-20', fin: '2026-10-21' } });
  assert.equal(ev.statut, 200, JSON.stringify(ev.corps));
  return { ...k, gestion, vocal, simple, evenement: ev.corps.evenement.id };
}

/** Émet une alerte puis distribue (le cron le fait en production). */
async function alerter(k, genre, cle, charge = {}, extra = {}) {
  const emis = await signalerAlerte(k.b.base, genre, { cle, charge, maintenant: k.b.horloge.t, ...extra });
  await distribuerTout(k);
  return emis;
}

test('alertes : destinataires par permission (et le Fondateur), jamais les autres ; lien direct par zone', async () => {
  const k = await monter();
  await alerter(k, 'vocal', 'vocal:creation:hierarchie', { code: 'hierarchie', quoi: 'creation', statut: 403 });
  await alerter(k, 'salon_match', `salon-match:${k.evenement}:m1:equipe-sans-role`, { code: 'equipe-sans-role', evenement: k.evenement, match: 'm:1', nom: '[DLT] Delta' });
  await alerter(k, 'role_evenement', `role-evenement:${k.evenement}:creation:hierarchie`, { code: 'hierarchie', quoi: 'creation', evenement: k.evenement });
  // Vocaux : vocaux.configurer et le Fondateur.
  assert.equal((await recues(k, 'voc12345', 'vocal-alerte')).length, 1);
  assert.equal((await recues(k, 'principal', 'vocal-alerte')).length, 1);
  assert.equal((await recues(k, 'gest1234', 'vocal-alerte')).length, 0);
  assert.equal((await recues(k, 'simp1234', 'vocal-alerte')).length, 0);
  // Salons de match et rôles d'événement : evenements.gerer et le Fondateur.
  const sm = await recues(k, 'gest1234', 'salon-match-alerte');
  assert.equal(sm.length, 1);
  assert.deepEqual(sm[0].cible, { v: 1, g: 'salon_match', evenement: k.evenement, match: 'm:1' });
  assert.equal(sm[0].categorie, 'discord');
  assert.equal(sm[0].charge.code, 'equipe-sans-role');
  assert.equal((await recues(k, 'voc12345', 'salon-match-alerte')).length, 0);
  assert.equal((await recues(k, 'principal', 'salon-match-alerte')).length, 1);
  const re = await recues(k, 'gest1234', 'role-evenement-alerte');
  assert.deepEqual(re[0].cible, { v: 1, g: 'alerte_discord', zone: 'evenement', evenement: k.evenement });
  const vo = await recues(k, 'voc12345', 'vocal-alerte');
  assert.deepEqual(vo[0].cible, { v: 1, g: 'alerte_discord', zone: 'vocaux' });
  // Jamais dans le fil des autres (règle « aucun ») : seulement les notifications personnelles.
  assert.equal((await k.api('/notifications/centre?limite=100', await k.b.session('simp1234'))).corps.liste.filter(n => n.type.startsWith('alerte.')).length, 0);
  assert.equal((await k.api('/notifications/centre?limite=100', k.fondateur)).corps.liste.filter(n => n.type.startsWith('alerte.')).length, 0);
});

test('rôles temporaires : discord.manage de la team (Manager) et le Fondateur ; pas les autres membres ; lien vers la team', async () => {
  const k = await monter();
  const T = await teamAvecMembres(k.b, { nom: 'The Final', membres: { manager01: { pseudo: 'Manon', role: 'manager' }, coach0001: { pseudo: 'Coach', role: 'coach' } } });
  const U = await teamAvecMembres(k.b, { nom: 'Autre team', membres: { autre001: { pseudo: 'Autre', role: 'manager' } } });
  await signalerAlerte(k.b.base, 'role_temp', { cle: `role-temp:${T.teamId}:hierarchie`, teamId: T.teamId, charge: { code: 'hierarchie', quoi: 'expiration', statut: 403 }, maintenant: k.b.horloge.t });
  await distribuerTout(k);
  const manager = await recues(k, 'manager01', 'role-temp-alerte');
  assert.equal(manager.length, 1);
  assert.deepEqual(manager[0].cible, { v: 1, g: 'alerte_discord', zone: 'role_temp', team: T.teamId });
  assert.equal((await recues(k, 'principal', 'role-temp-alerte')).length, 1);
  assert.equal((await recues(k, 'coach0001', 'role-temp-alerte')).length, 0, 'un coach n’a pas discord.manage');
  assert.equal((await recues(k, 'autre001', 'role-temp-alerte')).length, 0, 'une autre team');
  // Lien : la team concernée, avec discord.manage.
  const verifier = async (compte, cible) => (await k.api('/notifications/cible', await k.b.session(compte), { methode: 'POST', corps: { cible } })).corps;
  assert.equal((await verifier('manager01', manager[0].cible)).etat, 'ok');
  assert.equal((await verifier('autre001', manager[0].cible)).etat, 'interdit');
  // Rôle retiré à la lecture : l'alerte disparaît tout de suite (accès relu à chaque lecture).
  const roleManager = T.roles.manager?.id ?? Object.values(T.roles).find(r => r.nom === 'Manager').id;
  const coach = Object.values(T.roles).find(r => r.nom === 'Coach' || r.cle === 'coach');
  await k.b.base.executer('UPDATE membres SET role_id = ? WHERE team_id = ? AND compte_id = ?', [coach.id, T.teamId, 'manager01']);
  assert.equal(roleManager === coach.id, false);
  assert.equal((await recues(k, 'manager01', 'role-temp-alerte')).length, 0);
});

test('accès relu à chaque lecture : permission retirée, alerte masquée ; interrupteur par type dans les préférences', async () => {
  const k = await monter();
  await alerter(k, 'vocal', 'vocal:creation:hierarchie', { code: 'hierarchie' });
  await alerter(k, 'salon_match', `salon-match:${k.evenement}:*:ancre-supprimee`, { code: 'ancre-supprimee', evenement: k.evenement });
  const prefs = async compte => (await k.api('/notifications/preferences', await k.b.session(compte))).corps;
  // Préférences : seulement les types que le rôle permet de recevoir.
  assert.deepEqual((await prefs('voc12345')).types, ['vocal-alerte']);
  assert.deepEqual((await prefs('gest1234')).types.sort(), ['role-evenement-alerte', 'salon-match-alerte']);
  assert.deepEqual((await prefs('principal')).types.sort(), [...TYPES_COUPABLES].sort(), 'le Fondateur : tous');
  assert.deepEqual((await prefs('simp1234')).types, []);
  assert.deepEqual((await prefs('voc12345')).typesMasques, []);
  // Interrupteur : un type coupé n'apparaît plus ni dans la liste ni dans le compteur.
  assert.equal((await recues(k, 'voc12345', 'vocal-alerte')).length, 1);
  const compteurAvant = (await k.api('/notifications/compteur', await k.b.session('voc12345'))).corps.nonLues;
  assert.ok(compteurAvant >= 1);
  const coupe = await k.api('/notifications/preferences', await k.b.session('voc12345'), { methode: 'PUT', corps: { typesMasques: ['vocal-alerte'] } });
  assert.equal(coupe.statut, 200, JSON.stringify(coupe.corps));
  assert.deepEqual(coupe.corps.typesMasques, ['vocal-alerte']);
  assert.equal((await recues(k, 'voc12345', 'vocal-alerte')).length, 0);
  assert.equal((await k.api('/notifications/compteur', await k.b.session('voc12345'))).corps.nonLues, compteurAvant - 1);
  // Type inconnu refusé ; remis, il revient.
  assert.equal((await k.api('/notifications/preferences', await k.b.session('voc12345'), { methode: 'PUT', corps: { typesMasques: ['inconnu'] } })).statut, 400);
  await k.api('/notifications/preferences', await k.b.session('voc12345'), { methode: 'PUT', corps: { typesMasques: [] } });
  assert.equal((await recues(k, 'voc12345', 'vocal-alerte')).length, 1);
  // Permission retirée : l'alerte disparaît à la lecture suivante, sans attendre.
  await k.b.base.executer('DELETE FROM roles_globaux_affectations WHERE compte_id = ?', ['voc12345']);
  assert.equal((await recues(k, 'voc12345', 'vocal-alerte')).length, 0);
  // Couper un type ne touche pas aux préférences de catégories.
  assert.deepEqual((await prefs('gest1234')).masquees, []);
});

test('dédoublonnage : une notification par alerte et destinataire dans les 6 h, avec compteur ; au-delà, une nouvelle', async () => {
  const k = await monter();
  const cle = 'vocal:creation:hierarchie';
  const charge = { code: 'hierarchie', quoi: 'creation', statut: 403 };
  assert.equal(await alerter(k, 'vocal', cle, charge), true);
  const premiere = (await recues(k, 'voc12345', 'vocal-alerte'))[0];
  assert.equal(premiere.charge.compteur, 1);
  // Répétée dans la foulée (même processus, moins de 15 minutes) : pas même d'événement.
  k.b.horloge.t += 5 * 60_000;
  assert.equal(await alerter(k, 'vocal', cle, charge), false, 'limité à un événement par quart d’heure');
  // Répétée toutes les 20 minutes : le compteur monte, la notification reste unique, non relue.
  await k.api('/notifications/centre/lues', await k.b.session('voc12345'), { methode: 'POST', corps: { ids: [premiere.id] } });
  for (let i = 0; i < 3; i++) {
    k.b.horloge.t += PAUSE_SIGNALEMENT_MS + 60_000;
    assert.equal(await alerter(k, 'vocal', cle, charge), true);
  }
  let liste = await recues(k, 'voc12345', 'vocal-alerte');
  assert.equal(liste.length, 1, 'une seule notification');
  assert.equal(liste[0].id, premiere.id);
  assert.equal(liste[0].charge.compteur, 4);
  assert.equal(liste[0].date, premiere.date, 'la date reste celle de la première fois');
  assert.equal((await recues(k, 'principal', 'vocal-alerte'))[0].charge.compteur, 4, 'par destinataire');
  // Une autre cause (autre clé) : une autre notification.
  await alerter(k, 'vocal', 'vocal:creation:discord-500', { code: 'discord-500', quoi: 'creation', statut: 500 });
  assert.equal((await recues(k, 'voc12345', 'vocal-alerte')).length, 2);
  // Un nouvel essai de la distribution d'un événement déjà compté ne change rien.
  await k.b.base.executer('UPDATE evenements SET traite_le = NULL, essais = 0', []);
  await distribuerTout(k);
  liste = await recues(k, 'voc12345', 'vocal-alerte');
  assert.equal(liste.find(n => n.id === premiere.id).charge.compteur, 4);
  // Après 6 h depuis la première : nouvelle notification, compteur à 1.
  k.b.horloge.t = Date.parse(premiere.date) + FENETRE_ALERTE_MS + 60_000;
  await alerter(k, 'vocal', cle, charge);
  liste = (await recues(k, 'voc12345', 'vocal-alerte')).filter(n => n.charge.code === 'hierarchie');
  assert.equal(liste.length, 2);
  assert.deepEqual(liste.map(n => n.charge.compteur).sort(), [1, 4]);
  // Les destinataires sont indépendants : la ligne de dédoublonnage de chacun existe.
  assert.ok(Number((await k.b.base.premier('SELECT COUNT(*) AS n FROM notifs_alertes', [])).n) >= 4);
});

test('liens directs des alertes : élément supprimé, accès perdu, match disparu (la ligne n’est plus visée)', async () => {
  const k = await monter();
  const verifier = async (compte, cible) => (await k.api('/notifications/cible', await k.b.session(compte), { methode: 'POST', corps: { cible } })).corps;
  const vers = { v: 1, g: 'salon_match', evenement: k.evenement, match: 'm:1' };
  // Match sans ligne de salon : l'événement s'ouvre, sans mise en avant d'une ligne qui n'existe plus.
  assert.deepEqual(await verifier('gest1234', vers), { etat: 'ok', cible: { v: 1, g: 'salon_match', evenement: k.evenement } });
  await k.b.base.executer("INSERT INTO club_salons_match (id, evenement_id, site_match_id, genre, titre, statut, cree_le, maj_le) VALUES ('s1', ?, 'm:1', 'match', 'A vs B', 'ouvert', '2026-10-20T10:00:00.000Z', '2026-10-20T10:00:00.000Z')", [k.evenement]);
  assert.deepEqual((await verifier('gest1234', vers)).cible, vers);
  assert.equal((await verifier('simp1234', vers)).etat, 'interdit');
  assert.equal((await verifier('voc12345', vers)).etat, 'interdit', 'vocaux.configurer n’ouvre pas les événements');
  assert.equal((await verifier('principal', vers)).etat, 'ok');
  assert.equal((await verifier('gest1234', { ...vers, evenement: 'inconnu' })).etat, 'supprime');
  // Salons vocaux : vocaux.configurer ; événement : evenements.gerer.
  assert.equal((await verifier('voc12345', { v: 1, g: 'alerte_discord', zone: 'vocaux' })).etat, 'ok');
  assert.equal((await verifier('gest1234', { v: 1, g: 'alerte_discord', zone: 'vocaux' })).etat, 'interdit');
  assert.equal((await verifier('gest1234', { v: 1, g: 'alerte_discord', zone: 'evenement', evenement: k.evenement })).etat, 'ok');
  assert.equal((await verifier('gest1234', { v: 1, g: 'alerte_discord', zone: 'evenement', evenement: 'x' })).etat, 'supprime');
  assert.equal((await verifier('gest1234', { v: 1, g: 'alerte_discord', zone: 'role_temp', team: 'inconnue' })).etat, 'supprime');
  // Format : zone connue, événement / team obligatoires pour leur zone.
  assert.equal(normaliserCible({ v: 1, g: 'alerte_discord', zone: 'autre' }), null);
  assert.equal(normaliserCible({ v: 1, g: 'alerte_discord', zone: 'evenement' }), null);
  assert.equal(normaliserCible({ v: 1, g: 'alerte_discord', zone: 'role_temp' }), null);
  assert.deepEqual(normaliserCible({ v: 1, g: 'alerte_discord', zone: 'vocaux', x: 'y' }), { v: 1, g: 'alerte_discord', zone: 'vocaux' });
  assert.equal(normaliserCible({ v: 1, g: 'salon_match' }), null);
});

// ------------------------------------------------------------------ Avis de tickets

async function monterTickets() {
  const k = await bancTickets({ banc });
  const g = await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { guildId: k.GUILD, categorieOuverts: OUVERTS, categorieArchives: ARCHIVES, salonJournaux: JOURNAUX, actif: true } });
  assert.equal(g.statut, 200, JSON.stringify(g.corps));
  const recrue = await k.compteAvec('recr1234', 'Recrue', ['tickets.repondre']);
  const chef = await k.compteAvec('chef1234', 'Chef', ['tickets.gerer']);
  const config = await k.compteAvec('conf1234', 'Config', ['tickets.voir', 'tickets.configurer']);
  const hors = await k.compteAvec('hors1234', 'Hors', ['tickets.voir']);
  const cat = async (nom, roleIds) => (await k.api('/tickets/config/categories', undefined, { methode: 'POST', corps: { nom: { fr: nom, en: nom }, rolesDiscord: [STAFF], rolesApp: roleIds.map(r => `club:${r}`) } })).corps.id;
  const A = await cat('Recrutement', [recrue.roleId, config.roleId]);
  const B = await cat('Partenariat', [chef.roleId]);
  const membre = id => ({ user: { id, username: `u${id.slice(-3)}`, global_name: `Membre ${id.slice(-3)}` }, roles: [], permissions: '0' });
  const ouvrir = async categorie => {
    const r = await k.interaction({ type: 3, locale: 'fr', guild_id: k.GUILD, channel_id: '710000000000000013', member: membre(LEA), data: { custom_id: `tk:o:${categorie}`, component_type: 2 } });
    assert.match(r.corps.data.content, /Ticket créé/, JSON.stringify(r.corps));
    return k.b.base.premier('SELECT * FROM tickets ORDER BY numero DESC LIMIT 1', []);
  };
  const fermer = async tk => assert.equal((await k.api(`/tickets/${tk.id}/fermer`, k.fondateur, { methode: 'POST', corps: {} })).statut, 200);
  const noter = async (tk, note) => {
    await k.interaction({ type: 3, locale: 'fr', channel_id: `96${LEA.slice(2)}`, user: { id: LEA, username: 'auteur' }, data: { custom_id: `tk:n:${tk.id}:${note}`, component_type: 2 } });
    await distribuerTout(k);
  };
  return { ...k, recrue, chef, config, hors, A, B, ouvrir, fermer, noter };
}

test('avis d’un ticket : ceux qui traitent la catégorie et le Fondateur (pas celui qui l’a pris, qui a sa notification), jamais une autre catégorie', async () => {
  const k = await monterTickets();
  const t1 = await k.ouvrir(k.A);
  await k.api(`/tickets/${t1.id}/prendre`, k.recrue.jeton, { methode: 'POST', corps: {} });
  await k.fermer(t1);
  await k.noter(t1, 4);
  // Catégorie A : la recrue l'a prise (tk-note), le chef (tout), la config (rôle de la catégorie) et le Fondateur (tk-avis).
  const avisChef = await recues(k, 'chef1234', 'tk-avis');
  assert.equal(avisChef.length, 1);
  assert.equal(avisChef[0].charge.note, 4);
  assert.equal(avisChef[0].charge.numero, t1.numero);
  assert.equal(avisChef[0].categorie, 'tickets');
  assert.deepEqual(avisChef[0].cible, { v: 1, g: 'avis_ticket', ticket: t1.id });
  assert.equal((await recues(k, 'conf1234', 'tk-avis')).length, 1);
  assert.equal((await recues(k, 'principal', 'tk-avis')).length, 1);
  assert.equal((await recues(k, 'recr1234', 'tk-avis')).length, 0, 'celui qui l’a pris a tk-note');
  assert.equal((await recues(k, 'recr1234', 'tk-note')).length, 1);
  assert.equal((await recues(k, 'hors1234', 'tk-avis')).length, 0, 'tickets.voir sans le rôle de la catégorie');
  // Catégorie B : ni la recrue ni la config (rôles de A seulement).
  const t2 = await k.ouvrir(k.B);
  await k.fermer(t2);
  k.b.horloge.t += 1000;
  await k.noter(t2, 2);
  assert.equal((await recues(k, 'chef1234', 'tk-avis')).length, 2);
  assert.equal((await recues(k, 'conf1234', 'tk-avis')).length, 1);
  assert.equal((await recues(k, 'recr1234', 'tk-avis')).length, 0);
  // Accès relu à chaque lecture : la catégorie A n'est plus ouverte à la config, plus rien de A ne s'affiche pour elle.
  const maj = await k.api(`/tickets/config/categories/${k.A}`, undefined, { methode: 'PATCH', corps: { rolesApp: [`club:${k.chef.roleId}`] } });
  assert.equal(maj.statut, 200, JSON.stringify(maj.corps));
  assert.equal((await recues(k, 'conf1234', 'tk-avis')).length, 0, 'catégorie de tickets plus visible');
  // Nouvelle note du même auteur : même notification (compteur), pas une de plus.
  k.b.horloge.t += 20 * 60_000;
  await k.noter(t1, 5);
  assert.equal((await recues(k, 'chef1234', 'tk-avis')).filter(n => n.charge.ticket === t1.id).length, 1);
  assert.equal((await recues(k, 'chef1234', 'tk-avis')).find(n => n.charge.ticket === t1.id).charge.note, 5);
});

test('avis : lien vers Tickets › Avis (tickets.gerer / configurer), sinon vers le ticket ; supprimé ; interdit ; type coupé', async () => {
  const k = await monterTickets();
  const t = await k.ouvrir(k.A);
  await k.fermer(t);
  await k.noter(t, 5);
  const verifier = async (compte, cible) => (await k.api('/notifications/cible', await k.b.session(compte), { methode: 'POST', corps: { cible } })).corps;
  const vers = { v: 1, g: 'avis_ticket', ticket: t.id };
  assert.deepEqual(await verifier('chef1234', vers), { etat: 'ok', cible: vers });
  assert.deepEqual(await verifier('conf1234', vers), { etat: 'ok', cible: vers }, 'configurer : avis des catégories de ses rôles');
  assert.equal((await verifier('principal', vers)).cible.g, 'avis_ticket');
  // Qui répond sans gérer les avis : le ticket, où la note est visible.
  assert.deepEqual(await verifier('recr1234', vers), { etat: 'ok', cible: { v: 1, g: 'ticket', ticket: t.id } });
  assert.equal((await verifier('hors1234', vers)).etat, 'interdit');
  assert.equal((await verifier('chef1234', { ...vers, ticket: 'inconnu' })).etat, 'supprime');
  // Ticket supprimé : « n'existe plus » (l'avis gardé anonyme n'a plus de lien).
  await k.b.base.executer("UPDATE tickets SET supprime_le = '2026-10-21T00:00:00.000Z' WHERE id = ?", [t.id]);
  assert.equal((await verifier('chef1234', vers)).etat, 'supprime');
  // Interrupteur du type.
  assert.equal((await recues(k, 'chef1234', 'tk-avis')).length, 1);
  await k.api('/notifications/preferences', await k.b.session('chef1234'), { methode: 'PUT', corps: { typesMasques: ['tk-avis'] } });
  assert.equal((await recues(k, 'chef1234', 'tk-avis')).length, 0);
  assert.ok((await k.api('/notifications/preferences', await k.b.session('chef1234'))).corps.types.includes('tk-avis'));
});

test('catalogue des alertes : chaque type a une catégorie, un accès et son événement ; textes et préférences', () => {
  for (const [type, a] of Object.entries(ALERTES)) {
    assert.ok(['tickets', 'discord'].includes(a.categorie), type);
    assert.ok(a.acces === 'tickets' || /^(club|team):[a-z_.]+$/.test(a.acces), type);
    assert.ok(a.evenement, type);
  }
  assert.equal(TYPES_COUPABLES.length, 5);
});
