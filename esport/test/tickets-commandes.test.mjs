/**
 * Tickets, étape 4 : commandes slash. Définitions (FR / EN, limites de Discord), /ticket prendre, liberer, ajouter,
 * retirer, renommer, priorite, transferer, attente, note (JAMAIS postée sur Discord), transcript (en MP, sans les notes
 * internes), rouvrir, stats, panneau (administrateur ou compte qui configure) ; /tickets (mes tickets) et
 * /tickets liste:file (staff) ; chaque commande désactivable ou réservée à des rôles dans l'app ; refus hors d'un
 * ticket et pour qui n'est pas du staff.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc } from './aide.mjs';
import { bancTickets } from './tickets-aide.mjs';
import { SOUS_COMMANDES_TICKET, definitionsCommandes } from '../noyau/discord/bot/commandes.mjs';

const OUVERTS = '710000000000000010';
const STAFF = '720000000000000001';
const LEA = '800000000000000001';
const KAI = '800000000000000002';
const BOB = '800000000000000003';

async function preparer() {
  const k = await bancTickets({ banc });
  await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { guildId: k.GUILD, categorieOuverts: OUVERTS, categorieArchives: '710000000000000011', actif: true } });
  const A = (await k.api('/tickets/config/categories', undefined, { methode: 'POST', corps: { nom: { fr: 'Aide', en: 'Help' }, rolesDiscord: [STAFF] } })).corps.id;
  const B = (await k.api('/tickets/config/categories', undefined, { methode: 'POST', corps: { nom: { fr: 'Partenariat', en: 'Partnership' }, rolesDiscord: [STAFF] } })).corps.id;
  const membre = (id, roles = [], permissions = '0') => ({ user: { id, username: `u${id.slice(-3)}`, global_name: `Membre ${id.slice(-3)}` }, roles, permissions });
  const cmd = (nom, sous, options = {}, { qui = KAI, roles = [STAFF], salon = '710000000000000013', permissions = '0', resolved } = {}) =>
    k.interaction({
      type: 2,
      locale: 'fr',
      guild_id: k.GUILD,
      channel_id: salon,
      member: membre(qui, roles, permissions),
      data: nom === 'ticket' ? { name: 'ticket', options: [{ type: 1, name: sous, options: Object.entries(options).map(([name, value]) => ({ name, value })) }], ...(resolved ? { resolved } : {}) } : { name: 'tickets', options: Object.entries(options).map(([name, value]) => ({ name, value })) },
    });
  const ouvrir = async (qui = LEA, cat = A) => {
    const r = await cmd('ticket', 'ouvrir', { categorie: cat }, { qui, roles: [] });
    assert.match(r.corps.data.content, /Ticket créé/, JSON.stringify(r.corps));
    return k.b.base.premier('SELECT * FROM tickets ORDER BY numero DESC LIMIT 1', []);
  };
  const ticket = id => k.b.base.premier('SELECT * FROM tickets WHERE id = ?', [id]);
  return { k, A, B, cmd, ouvrir, ticket };
}

test('définitions : /ticket (sous-commandes) et /tickets, descriptions FR / EN, limites de Discord', () => {
  const defs = definitionsCommandes();
  const ticket = defs.find(d => d.name === 'ticket');
  assert.deepEqual(ticket.options.map(o => o.name), ['ouvrir', 'fermer', 'prendre', 'liberer', 'ajouter', 'retirer', 'renommer', 'priorite', 'transferer', 'rouvrir', 'transcript', 'note', 'attente', 'stats', 'panneau']);
  assert.ok(ticket.options.length <= 25);
  for (const s of SOUS_COMMANDES_TICKET) {
    assert.equal(s.type, 1);
    assert.ok(s.description.length <= 100 && s.description_localizations.fr.length <= 100, s.name);
    for (const o of s.options ?? []) assert.ok(/^[a-z]{1,32}$/.test(o.name) && o.description_localizations.fr, `${s.name}.${o.name}`);
  }
  const tickets = defs.find(d => d.name === 'tickets');
  assert.deepEqual(tickets.options[0].choices.map(c => c.value), ['mes', 'file']);
  // Taille totale d'une commande (noms, descriptions, valeurs) sous la limite de Discord.
  const taille = o => (o.name?.length ?? 0) + (o.description?.length ?? 0) + (o.options ?? []).reduce((s, x) => s + taille(x), 0) + (o.choices ?? []).reduce((s, c) => s + c.name.length + String(c.value).length, 0);
  assert.ok(taille(ticket) < 4000, `taille ${taille(ticket)}`);
});

test('commandes du staff dans un ticket : prendre, priorité, renommer, ajouter, retirer, transférer, attente, libérer', async () => {
  const p = await preparer();
  const tk = await p.ouvrir();
  const ici = { salon: tk.salon_id };
  assert.match((await p.cmd('ticket', 'prendre', {}, { salon: '710000000000000013' })).corps.data.content, /salon d’un ticket/);
  assert.match((await p.cmd('ticket', 'prendre', {}, { ...ici, qui: BOB, roles: [] })).corps.data.content, /Seul le staff/);
  assert.match((await p.cmd('ticket', 'prendre', {}, ici)).corps.data.content, /prend en charge/);
  assert.equal((await p.ticket(tk.id)).responsable_discord_id, KAI);
  await p.cmd('ticket', 'priorite', { niveau: 'critique' }, ici);
  assert.equal((await p.ticket(tk.id)).priorite, 'critique');
  const r = await p.cmd('ticket', 'renommer', { nom: 'Litige paiement' }, ici);
  assert.match(r.corps.data.content, /litige-paiement/);
  assert.equal(p.k.discord.etat.salons.get(tk.salon_id).name, 'litige-paiement');
  await p.cmd('ticket', 'ajouter', { membre: BOB }, { ...ici, resolved: { users: { [BOB]: { id: BOB, username: 'bob' } } } });
  assert.ok(p.k.discord.etat.salons.get(tk.salon_id).permission_overwrites.some(o => o.id === BOB));
  await p.cmd('ticket', 'retirer', { membre: BOB }, ici);
  assert.ok(!p.k.discord.etat.salons.get(tk.salon_id).permission_overwrites.some(o => o.id === BOB));
  await p.cmd('ticket', 'transferer', { categorie: p.B }, ici);
  assert.equal((await p.ticket(tk.id)).categorie_id, p.B);
  await p.cmd('ticket', 'attente', {}, ici);
  assert.equal((await p.ticket(tk.id)).statut, 'en_attente');
  await p.cmd('ticket', 'liberer', {}, ici);
  assert.equal((await p.ticket(tk.id)).responsable_discord_id, null);
});

test('/ticket note : note interne jamais postée ; /ticket transcript : en MP, sans les notes ; /ticket rouvrir', async () => {
  const p = await preparer();
  const tk = await p.ouvrir();
  const ici = { salon: tk.salon_id };
  const avant = p.k.discord.appels.length;
  assert.match((await p.cmd('ticket', 'note', { texte: 'Secret du staff' }, ici)).corps.data.content, /Note interne enregistrée/);
  assert.equal(p.k.discord.appels.length, avant, 'aucun appel à Discord');
  assert.ok(await p.k.b.base.premier("SELECT id FROM tickets_messages WHERE genre = 'note' AND contenu = 'Secret du staff'", []));
  assert.match((await p.cmd('ticket', 'transcript', {}, ici)).corps.data.content, /message privé/);
  const mp = p.k.discord.appels.filter(a => a.methode === 'POST' && /\/channels\/96\d+\/messages$/.test(a.chemin)).at(-1);
  assert.equal(mp.corps.multipart, true, 'fichier joint');
  assert.ok(!JSON.stringify(p.k.discord.appels).includes('Secret du staff'), 'la note interne n’est jamais partie sur Discord');
  // Fermer puis rouvrir par commande.
  await p.cmd('ticket', 'fermer', { raison: 'fini' }, ici);
  assert.equal((await p.ticket(tk.id)).statut, 'ferme');
  assert.match((await p.cmd('ticket', 'rouvrir', {}, ici)).corps.data.content, /rouvert/);
  assert.notEqual((await p.ticket(tk.id)).statut, 'ferme');
});

test('/tickets : mes tickets ; liste:file réservée au staff ; /ticket stats ; /ticket panneau (droits)', async () => {
  const p = await preparer();
  const tk = await p.ouvrir(LEA);
  await p.ouvrir(BOB, p.B);
  const mes = await p.cmd('tickets', null, {}, { qui: LEA, roles: [] });
  assert.match(mes.corps.data.content, new RegExp(`<#${tk.salon_id}>`));
  assert.ok(!mes.corps.data.content.includes('Partenariat'));
  assert.match((await p.cmd('tickets', null, { liste: 'file' }, { qui: LEA, roles: [] })).corps.data.content, /Seul le staff/);
  const file = await p.cmd('tickets', null, { liste: 'file' });
  assert.equal(file.corps.data.content.split('\n').length, 3, 'titre + deux tickets non pris en charge');
  const stats = await p.cmd('ticket', 'stats', {});
  assert.match(stats.corps.data.embeds[0].description, /Aide : 1 ouvert\(s\), 1 créé\(s\)/);
  // Panneau : un membre du staff sans droit d'administration ne republie pas ; un administrateur du serveur, si.
  const pan = await p.k.api('/tickets/config/panneaux', undefined, { methode: 'POST', corps: { titre: { fr: 'Support', en: 'Support' }, categories: [p.A], salonId: '710000000000000013' } });
  assert.match((await p.cmd('ticket', 'panneau', {})).corps.data.content, /administrateur/);
  assert.match((await p.cmd('ticket', 'panneau', {}, { permissions: '8' })).corps.data.content, /Panneau publié/);
  assert.ok((await p.k.b.base.premier('SELECT message_id FROM tickets_panneaux WHERE id = ?', [pan.corps.id])).message_id);
});

test('commandes désactivées ou réservées à des rôles dans l’app', async () => {
  const p = await preparer();
  const tk = await p.ouvrir();
  await p.k.api('/tickets/config/commandes', undefined, { methode: 'PUT', corps: { stats: { actif: false }, prendre: { actif: true, roles: ['720000000000000099'] } } });
  assert.match((await p.cmd('ticket', 'stats', {})).corps.data.content, /désactivée/);
  assert.match((await p.cmd('ticket', 'prendre', {}, { salon: tk.salon_id })).corps.data.content, /rôle nécessaire/);
  assert.match((await p.cmd('ticket', 'prendre', {}, { salon: tk.salon_id, roles: [STAFF, '720000000000000099'] })).corps.data.content, /prend en charge/);
});
