/**
 * Tickets paramétrables (migration 0055, docs/esport/tickets.md, « Tickets qui ne se ferment jamais ») : ordre de
 * priorité de la fermeture automatique (ticket permanent > catégorie > général), catégorie « Jamais » (ni
 * avertissement ni fermeture), délai propre d'une catégorie, ticket rendu permanent depuis l'app (tickets.gerer) et
 * par /ticket permanent (avertissement en attente annulé ; commande désactivable ou réservée à des rôles), catégorie
 * « Seul le staff peut fermer » (bouton, fenêtre de la raison, /ticket fermer).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc } from './aide.mjs';
import { bancTickets } from './tickets-aide.mjs';
import { delaiFermeture } from '../noyau/tickets/reglages.mjs';

const OUVERTS = '710000000000000010';
const ARCHIVES = '710000000000000011';
const STAFF = '720000000000000001';
const AUTRE_ROLE = '720000000000000009';
const LEA = '800000000000000001';
const KAI = '800000000000000002';
const H = 3_600_000;

async function preparer({ general = {} } = {}) {
  const k = await bancTickets({ banc });
  const g = await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { guildId: k.GUILD, categorieOuverts: OUVERTS, categorieArchives: ARCHIVES, actif: true, ...general } });
  assert.equal(g.statut, 200, JSON.stringify(g.corps));
  const categorie = async corps => {
    const r = await k.api('/tickets/config/categories', undefined, { methode: 'POST', corps: { rolesDiscord: [STAFF], ...corps } });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
    return r.corps.id;
  };
  const membre = (id, roles = []) => ({ user: { id, username: `u${id.slice(-3)}`, global_name: `Membre ${id.slice(-3)}` }, roles, permissions: '0' });
  const cmd = (sous, options = {}, { qui = KAI, roles = [STAFF], salon = '710000000000000013' } = {}) =>
    k.interaction({ type: 2, locale: 'fr', guild_id: k.GUILD, channel_id: salon, member: membre(qui, roles), data: { name: 'ticket', options: [{ type: 1, name: sous, options: Object.entries(options).map(([name, value]) => ({ name, value })) }] } });
  const clic = (custom_id, { qui = LEA, roles = [], salon }) => k.interaction({ type: 3, locale: 'fr', guild_id: k.GUILD, channel_id: salon, member: membre(qui, roles), data: { custom_id, component_type: 2 } });
  const fenetre = (custom_id, valeurs, { qui = LEA, roles = [], salon }) =>
    k.interaction({ type: 5, locale: 'fr', guild_id: k.GUILD, channel_id: salon, member: membre(qui, roles), data: { custom_id, components: Object.entries(valeurs).map(([id, value]) => ({ type: 1, components: [{ type: 4, custom_id: id, value }] })) } });
  const ouvrir = async (cat, qui = LEA) => {
    const r = await cmd('ouvrir', { categorie: cat }, { qui, roles: [] });
    assert.match(r.corps.data.content, /Ticket créé/, JSON.stringify(r.corps));
    return k.b.base.premier('SELECT * FROM tickets ORDER BY numero DESC LIMIT 1', []);
  };
  const ticket = id => k.b.base.premier('SELECT * FROM tickets WHERE id = ?', [id]);
  const recule = (id, h) => k.b.base.executer('UPDATE tickets SET derniere_activite_le = ? WHERE id = ?', [new Date(k.b.horloge.t - h * H).toISOString(), id]);
  const cycle = k.b.traiter.ticketsCycle;
  return { k, categorie, cmd, clic, fenetre, ouvrir, ticket, recule, cycle };
}

test('ordre de priorité (pur) : ticket permanent > catégorie (null : général ; 0 : jamais) > général', () => {
  const general = { fermetureAutoH: 168 };
  assert.deepEqual(delaiFermeture({ permanent: 0 }, { fermetureAutoH: null }, general), { heures: 168, source: 'general' });
  assert.deepEqual(delaiFermeture({ permanent: 0 }, undefined, general), { heures: 168, source: 'general' });
  assert.deepEqual(delaiFermeture({ permanent: 0 }, { fermetureAutoH: 48 }, general), { heures: 48, source: 'categorie' });
  assert.deepEqual(delaiFermeture({ permanent: 0 }, { fermetureAutoH: 0 }, general), { heures: 0, source: 'categorie' });
  assert.deepEqual(delaiFermeture({ permanent: 0 }, { fermetureAutoH: 24 }, { fermetureAutoH: 0 }), { heures: 24, source: 'categorie' }, 'la catégorie l’emporte sur « jamais » général');
  assert.deepEqual(delaiFermeture({ permanent: 0 }, { fermetureAutoH: null }, { fermetureAutoH: 0 }), { heures: 0, source: 'general' });
  assert.deepEqual(delaiFermeture({ permanent: 1 }, { fermetureAutoH: 48 }, general), { heures: 0, source: 'ticket' });
  assert.deepEqual(delaiFermeture({ permanent: '1' }, { fermetureAutoH: null }, general), { heures: 0, source: 'ticket' }, 'PostgreSQL ou SQLite : même lecture');
});

test('catégorie « Jamais » : ni avertissement ni fermeture ; délai propre : appliqué à la place du général ; réglages relus', async () => {
  const p = await preparer();
  const sponsors = await p.categorie({ nom: { fr: 'Sponsors', en: 'Sponsors' }, fermetureAutoH: 0, fermetureStaffSeul: true });
  const rapide = await p.categorie({ nom: { fr: 'Rapide', en: 'Quick' }, fermetureAutoH: 48 });
  const normale = await p.categorie({ nom: { fr: 'Aide', en: 'Help' } });
  const conf = (await p.k.api('/tickets/config')).corps;
  const parId = Object.fromEntries(conf.categories.map(c => [c.id, c]));
  assert.equal(parId[sponsors].fermetureAutoH, 0);
  assert.equal(parId[sponsors].fermetureStaffSeul, true);
  assert.equal(parId[rapide].fermetureAutoH, 48);
  assert.equal(parId[rapide].fermetureStaffSeul, false);
  assert.equal(parId[normale].fermetureAutoH, null);

  const tS = await p.ouvrir(sponsors);
  const tR = await p.ouvrir(rapide, KAI);
  const tN = await p.ouvrir(normale, '800000000000000005');
  for (const t of [tS, tR, tN]) await p.recule(t.id, 47);
  const b1 = await p.cycle.tachesCycle();
  assert.equal(b1.avertis, 1, 'seul le ticket « Rapide » (48 h) est averti');
  assert.ok((await p.ticket(tR.id)).avertissement_le);
  assert.equal((await p.ticket(tS.id)).avertissement_le, null);
  assert.equal((await p.ticket(tN.id)).avertissement_le, null);
  for (const t of [tS, tR, tN]) await p.recule(t.id, 24 * 400);
  const b2 = await p.cycle.tachesCycle();
  assert.equal(b2.fermes, 2, 'Rapide et Aide (délai général) fermés');
  assert.equal((await p.ticket(tR.id)).statut, 'ferme');
  assert.equal((await p.ticket(tN.id)).statut, 'ferme');
  const s = await p.ticket(tS.id);
  assert.notEqual(s.statut, 'ferme', 'Sponsors : jamais fermé');
  assert.equal(s.avertissement_le, null);

  // L'app : délai et origine annoncés dans le détail.
  const d = (await p.k.api(`/tickets/${tS.id}`)).corps;
  assert.deepEqual({ heures: d.fermeture.heures, source: d.fermeture.source, staffSeul: d.fermeture.staffSeul }, { heures: 0, source: 'categorie', staffSeul: true });
  assert.equal(d.permanent, false);

  // Catégorie repassée au délai général : le ticket se ferme normalement ; validation des valeurs.
  assert.equal((await p.k.api(`/tickets/config/categories/${sponsors}`, undefined, { methode: 'PATCH', corps: { fermetureAutoH: 5000 } })).statut, 400);
  assert.equal((await p.k.api(`/tickets/config/categories/${sponsors}`, undefined, { methode: 'PATCH', corps: { fermetureAutoH: null } })).statut, 200);
  assert.equal((await p.cycle.tachesCycle()).fermes, 1);
  assert.equal((await p.ticket(tS.id)).statut, 'ferme');
});

test('catégorie passée à « Jamais » après un avertissement : l’avertissement est oublié, rien n’est fermé', async () => {
  const p = await preparer();
  const cat = await p.categorie({ nom: { fr: 'Aide', en: 'Help' } });
  const tk = await p.ouvrir(cat);
  await p.recule(tk.id, 150);
  assert.equal((await p.cycle.tachesCycle()).avertis, 1);
  assert.ok((await p.ticket(tk.id)).avertissement_le);
  await p.k.api(`/tickets/config/categories/${cat}`, undefined, { methode: 'PATCH', corps: { fermetureAutoH: 0 } });
  await p.recule(tk.id, 1000);
  const b = await p.cycle.tachesCycle();
  assert.equal(b.fermes + b.avertis, 0);
  assert.equal((await p.ticket(tk.id)).avertissement_le, null);
});

test('réglage général « jamais » : une catégorie à délai propre ferme quand même ; le général s’applique aux autres', async () => {
  const p = await preparer({ general: { fermetureAutoH: 0 } });
  const propre = await p.categorie({ nom: { fr: 'Propre', en: 'Own' }, fermetureAutoH: 24 });
  const generale = await p.categorie({ nom: { fr: 'Aide', en: 'Help' } });
  const a = await p.ouvrir(propre);
  const b = await p.ouvrir(generale, KAI);
  await p.recule(a.id, 30);
  await p.recule(b.id, 3000);
  assert.equal((await p.cycle.tachesCycle()).fermes, 1);
  assert.equal((await p.ticket(a.id)).statut, 'ferme');
  assert.notEqual((await p.ticket(b.id)).statut, 'ferme');
});

test('ticket permanent depuis l’app (tickets.gerer) : avertissement annulé, jamais fermé, annoncé ; retiré : fermeture normale', async () => {
  const p = await preparer();
  const cat = await p.categorie({ nom: { fr: 'Rapide', en: 'Quick' }, fermetureAutoH: 48 });
  const support = await p.k.compteAvec('supp1234', 'Support', ['tickets.voir', 'tickets.repondre']);
  const gestion = await p.k.compteAvec('gest1234', 'Gestion', ['tickets.voir', 'tickets.repondre', 'tickets.gerer']);
  const tk = await p.ouvrir(cat);
  await p.recule(tk.id, 30);
  assert.equal((await p.cycle.tachesCycle()).avertis, 1);
  assert.ok((await p.ticket(tk.id)).avertissement_le);

  // tickets.repondre seul : refusé.
  assert.equal((await p.k.api(`/tickets/${tk.id}/permanent`, support.jeton, { methode: 'POST', corps: { permanent: true } })).statut, 403);
  const r = await p.k.api(`/tickets/${tk.id}/permanent`, gestion.jeton, { methode: 'POST', corps: { permanent: true } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.permanent, true);
  assert.deepEqual([r.corps.fermeture.heures, r.corps.fermeture.source, r.corps.fermeture.permanentPar], [0, 'ticket', 'Gestion']);
  const l = await p.ticket(tk.id);
  assert.equal(Number(l.permanent), 1);
  assert.equal(l.avertissement_le, null, 'avertissement en attente annulé');
  // Par défaut, rien n'est posté dans le salon (« Messages automatiques dans le salon ») : noté dans l'app seulement.
  assert.doesNotMatch(JSON.stringify(p.k.discord.etat.messages.get(tk.salon_id).at(-1)), /jamais fermé automatiquement/);
  assert.ok(r.corps.messages.some(m => m.genre === 'systeme' && m.nonPublie && /jamais fermé automatiquement/.test(m.contenu)), 'noté dans la conversation de l’app');
  const liste = (await p.k.api('/tickets', gestion.jeton)).corps;
  assert.equal(liste.tickets.find(x => x.id === tk.id).permanent, true);

  await p.recule(tk.id, 24 * 400);
  const b = await p.cycle.tachesCycle();
  assert.equal(b.fermes + b.avertis, 0);
  assert.notEqual((await p.ticket(tk.id)).statut, 'ferme');

  // Retiré : de nouveau soumis au délai de la catégorie.
  const off = await p.k.api(`/tickets/${tk.id}/permanent`, gestion.jeton, { methode: 'POST', corps: { permanent: false } });
  assert.equal(off.corps.permanent, false);
  assert.equal(off.corps.fermeture.source, 'categorie');
  assert.equal((await p.cycle.tachesCycle()).fermes, 1);
  assert.equal((await p.ticket(tk.id)).statut, 'ferme');
});

test('/ticket permanent on / off : staff seulement, avertissement annulé, réponses FR / EN ; désactivable et réservable à des rôles', async () => {
  const p = await preparer();
  const cat = await p.categorie({ nom: { fr: 'Partenariat', en: 'Partnership' }, fermetureAutoH: 48 });
  const tk = await p.ouvrir(cat);
  await p.recule(tk.id, 30);
  assert.equal((await p.cycle.tachesCycle()).avertis, 1);

  assert.match((await p.cmd('permanent', { etat: 'on' }, { qui: LEA, roles: [], salon: tk.salon_id })).corps.data.content, /Seul le staff/, 'l’auteur ne peut pas');
  assert.match((await p.cmd('permanent', { etat: 'on' }, { salon: '710000000000000099' })).corps.data.content, /salon d’un ticket/);
  const on = await p.cmd('permanent', { etat: 'on' }, { salon: tk.salon_id });
  assert.match(on.corps.data.content, /Ticket permanent : il ne sera jamais fermé automatiquement/);
  assert.equal(on.corps.data.flags, 64, 'réponse éphémère');
  const l = await p.ticket(tk.id);
  assert.equal(Number(l.permanent), 1);
  assert.equal(l.avertissement_le, null);
  await p.recule(tk.id, 24 * 400);
  assert.equal((await p.cycle.tachesCycle()).fermes, 0);

  // Réponse en anglais pour une personne dont Discord est en anglais.
  const en = await p.k.interaction({ type: 2, locale: 'en-US', guild_id: p.k.GUILD, channel_id: tk.salon_id, member: { user: { id: KAI, username: 'kai' }, roles: [STAFF], permissions: '0' }, data: { name: 'ticket', options: [{ type: 1, name: 'permanent', options: [{ name: 'etat', value: 'off' }] }] } });
  assert.match(en.corps.data.content, /no longer permanent/);
  assert.equal(Number((await p.ticket(tk.id)).permanent), 0);
  assert.match((await p.cmd('permanent', { etat: 'peut-etre' }, { salon: tk.salon_id })).corps.data.content, /Impossible|réessayez|Réessayez/i);

  // Réservée à un rôle : le staff sans ce rôle est refusé ; coupée : refusée à tous.
  await p.k.api('/tickets/config/commandes', undefined, { methode: 'PUT', corps: { permanent: { actif: true, roles: [AUTRE_ROLE] } } });
  assert.match((await p.cmd('permanent', { etat: 'on' }, { salon: tk.salon_id })).corps.data.content, /rôle nécessaire/);
  assert.match((await p.cmd('permanent', { etat: 'on' }, { roles: [STAFF, AUTRE_ROLE], salon: tk.salon_id })).corps.data.content, /Ticket permanent/);
  await p.k.api('/tickets/config/commandes', undefined, { methode: 'PUT', corps: { permanent: { actif: false } } });
  assert.match((await p.cmd('permanent', { etat: 'off' }, { roles: [STAFF, AUTRE_ROLE], salon: tk.salon_id })).corps.data.content, /désactivée/);
  assert.equal(Number((await p.ticket(tk.id)).permanent), 1);
  const conf = (await p.k.api('/tickets/config')).corps;
  assert.ok(conf.choix.commandes.includes('permanent') && conf.choix.commandesStaff.includes('permanent'));
});

test('« Seul le staff peut fermer » : l’auteur est refusé (bouton, raison, /ticket fermer) ; le staff ferme ; ailleurs l’auteur ferme', async () => {
  const p = await preparer();
  const sponsors = await p.categorie({ nom: { fr: 'Sponsors', en: 'Sponsors' }, fermetureAutoH: 0, fermetureStaffSeul: true });
  const aide = await p.categorie({ nom: { fr: 'Aide', en: 'Help' } });
  const tk = await p.ouvrir(sponsors);
  const salon = tk.salon_id;
  assert.match((await p.clic(`tk:x:${tk.id}`, { salon })).corps.data.content, /Seul le staff peut fermer les tickets de cette catégorie/);
  assert.match((await p.clic(`tk:xc:${tk.id}`, { salon })).corps.data.content, /Seul le staff peut fermer/);
  assert.match((await p.clic(`tk:xr:${tk.id}`, { salon })).corps.data.content, /Seul le staff peut fermer/);
  assert.match((await p.fenetre(`tk:xm:${tk.id}`, { raison: 'fini' }, { salon })).corps.data.content, /Seul le staff peut fermer/);
  assert.match((await p.cmd('fermer', {}, { qui: LEA, roles: [], salon })).corps.data.content, /Seul le staff peut fermer/);
  assert.notEqual((await p.ticket(tk.id)).statut, 'ferme');
  // L'auteur qui est aussi du staff de la catégorie peut fermer.
  assert.equal((await p.clic(`tk:x:${tk.id}`, { salon, roles: [STAFF] })).corps.data.components[0].components[0].custom_id, `tk:xc:${tk.id}`);
  // Le staff ferme.
  assert.match((await p.cmd('fermer', { raison: 'contrat terminé' }, { salon })).corps.data.content, /fermé/);
  assert.equal((await p.ticket(tk.id)).statut, 'ferme');
  // Catégorie ordinaire : l'auteur ferme toujours son ticket.
  const t2 = await p.ouvrir(aide);
  assert.match((await p.cmd('fermer', {}, { qui: LEA, roles: [], salon: t2.salon_id })).corps.data.content, /fermé/);
  assert.equal((await p.ticket(t2.id)).statut, 'ferme');
  // Désactiver le réglage rend la main à l'auteur.
  await p.k.api(`/tickets/config/categories/${sponsors}`, undefined, { methode: 'PATCH', corps: { fermetureStaffSeul: false } });
  const t3 = await p.ouvrir(sponsors);
  assert.match((await p.cmd('fermer', {}, { qui: LEA, roles: [], salon: t3.salon_id })).corps.data.content, /fermé/);
});
