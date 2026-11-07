/**
 * Tickets : « Messages automatiques dans le salon » (Configuration › Messages) et mentions.
 *
 *  - par défaut, seul ce qui compte pour l'auteur est posté dans le salon (prise en charge, personne ajoutée,
 *    avertissement d'inactivité, fermeture, réouverture, MP récapitulatif) ; priorité, libération, attente, personne
 *    retirée, transfert, ticket permanent restent SILENCIEUX : notés dans la conversation de l'app (« non publié ») et
 *    dans le salon des journaux ; chaque événement se règle (activer / couper) ;
 *  - « Mentionner » depuis l'app (auteur, personnes ajoutées, rôles de la catégorie, staff lié, membre cherché) : le
 *    bot mentionne EXACTEMENT les cibles choisies (allowed_mentions), gardé dans la conversation, 3 par minute et par
 *    ticket ; /ticket ping (staff, réglable comme les autres commandes).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc } from './aide.mjs';
import { bancTickets } from './tickets-aide.mjs';
import { ANNONCES_DEFAUT } from '../noyau/tickets/reglages.mjs';

const OUVERTS = '710000000000000010';
const ARCHIVES = '710000000000000011';
const JOURNAUX = '710000000000000012';
const STAFF = '720000000000000001';
const AUTRE_ROLE = '720000000000000009';
const LEA = '800000000000000001';
const BOB = '800000000000000002';
const KAI = '800000000000000003';
const ZOE = '800000000000000077';
const H = 3_600_000;

async function preparer({ general = {} } = {}) {
  const k = await bancTickets({ banc });
  const g = await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { guildId: k.GUILD, guildNom: 'Club', categorieOuverts: OUVERTS, categorieArchives: ARCHIVES, salonJournaux: JOURNAUX, actif: true, ...general } });
  assert.equal(g.statut, 200, JSON.stringify(g.corps));
  const support = await k.compteAvec('supp1234', 'Support', ['tickets.voir', 'tickets.repondre', 'tickets.gerer']);
  const repondeur = await k.compteAvec('repo1234', 'Repondeur', ['tickets.voir', 'tickets.repondre']);
  const cat = (await k.api('/tickets/config/categories', undefined, { methode: 'POST', corps: { nom: { fr: 'Aide', en: 'Help' }, rolesDiscord: [STAFF], rolesApp: [`club:${support.roleId}`, `club:${repondeur.roleId}`], fermetureAutoH: 48 } })).corps;
  const autre = (await k.api('/tickets/config/categories', undefined, { methode: 'POST', corps: { nom: { fr: 'Autre', en: 'Other' }, rolesDiscord: [STAFF] } })).corps;
  const membre = (id, roles = []) => ({ user: { id, username: `u${id.slice(-3)}`, global_name: id === LEA ? 'Léa' : `Membre ${id.slice(-3)}` }, roles, permissions: '0' });
  const clic = (custom_id, { qui = LEA, roles = [], salon = '710000000000000013', valeurs, resolved } = {}) =>
    k.interaction({ type: 3, locale: 'fr', guild_id: k.GUILD, channel_id: salon, member: membre(qui, roles), data: { custom_id, component_type: valeurs ? 3 : 2, ...(valeurs ? { values: valeurs } : {}), ...(resolved ? { resolved } : {}) } });
  const cmd = (sous, options = {}, { qui = KAI, roles = [STAFF], salon, resolved } = {}) =>
    k.interaction({ type: 2, locale: 'fr', guild_id: k.GUILD, channel_id: salon, member: membre(qui, roles), data: { name: 'ticket', options: [{ type: 1, name: sous, options: Object.entries(options).map(([name, value]) => ({ name, value })) }], ...(resolved ? { resolved } : {}) } });
  const ouvrir = async (qui = LEA) => {
    const r = await clic(`tk:o:${cat.id}`, { qui });
    assert.match(r.corps.data.content, /Ticket créé/, JSON.stringify(r.corps));
    return k.b.base.premier('SELECT * FROM tickets ORDER BY numero DESC LIMIT 1', []);
  };
  const salon = tk => k.discord.etat.messages.get(tk.salon_id) ?? [];
  const journal = () => k.discord.etat.messages.get(JOURNAUX) ?? [];
  const action = (tk, nom, corps = {}, jeton = support.jeton) => k.api(`/tickets/${tk.id}/${nom}`, jeton, { methode: 'POST', corps });
  return { k, support, repondeur, cat, autre, clic, cmd, ouvrir, salon, journal, action, cycle: k.b.traiter.ticketsCycle };
}

/** Le dernier message posté dans le salon contient-il ce texte ? */
const texteDe = m => JSON.stringify(m ?? {});

test('par défaut : priorité, libération, attente, retrait, transfert, permanent silencieux (notés dans l’app et le journal) ; le reste posté', async () => {
  const p = await preparer();
  const conf = (await p.k.api('/tickets/config')).corps;
  assert.deepEqual(conf.general.annonces, ANNONCES_DEFAUT, 'réglage complet rendu à l’app');
  assert.deepEqual(conf.annoncesDefaut, ANNONCES_DEFAUT);
  const tk = await p.ouvrir();
  const depart = p.salon(tk).length;
  assert.equal(depart, 1, 'accueil seul');

  // Silencieux.
  const journalAvant = p.journal().length;
  for (const [nom, corps] of [['priorite', { priorite: 'urgent' }], ['attente', {}], ['permanent', { permanent: true }], ['permanent', { permanent: false }]]) {
    const r = await p.action(tk, nom, corps);
    assert.equal(r.statut, 200, `${nom} ${JSON.stringify(r.corps)}`);
  }
  // Bouton Discord « Priorité » : silencieux aussi.
  await p.clic(`tk:ps:${tk.id}`, { qui: KAI, roles: [STAFF], valeurs: ['critique'], salon: tk.salon_id });
  assert.equal(p.salon(tk).length, depart, 'rien de posté dans le salon');
  const d = (await p.k.api(`/tickets/${tk.id}`, p.support.jeton)).corps;
  const silencieux = d.messages.filter(m => m.nonPublie);
  assert.equal(silencieux.length, 5, JSON.stringify(d.messages.map(m => [m.genre, m.contenu.slice(0, 30), m.nonPublie])));
  assert.ok(silencieux.some(m => /Priorité : Urgente/.test(m.contenu)));
  assert.ok(silencieux.some(m => /attend votre réponse/.test(m.contenu)));
  assert.ok(silencieux.every(m => m.genre === 'systeme' && m.envoi === 'ok'));
  assert.equal(p.journal().length, journalAvant + 5, 'une ligne par événement dans le salon des journaux');
  assert.match(texteDe(p.journal().at(-1)), new RegExp(`Ticket n° ${tk.numero}|Ticket #${tk.numero}`));
  assert.deepEqual(p.journal().at(-1).allowed_mentions, { parse: [] });

  // Postés : prise en charge, personne ajoutée.
  await p.action(tk, 'prendre');
  assert.match(texteDe(p.salon(tk).at(-1)), /prend en charge votre ticket/);
  assert.equal(d.messages.filter(m => !m.nonPublie && m.genre === 'systeme').length, 1, 'l’accueil');
  await p.action(tk, 'ajouter', { discordId: BOB, nom: 'Bob' });
  assert.match(texteDe(p.salon(tk).at(-1)), /a été ajouté au ticket/);
  const n = p.salon(tk).length;
  // Silencieux : libération, retrait, transfert.
  await p.action(tk, 'liberer');
  await p.action(tk, 'retirer', { discordId: BOB });
  await p.action(tk, 'categorie', { categorie: p.autre.id });
  assert.equal(p.salon(tk).length, n, 'libération, retrait, transfert : silencieux');
  const d2 = (await p.k.api(`/tickets/${tk.id}`)).corps;
  assert.ok(d2.messages.some(m => m.nonPublie && /retiré du ticket/.test(m.contenu)));
  assert.ok(d2.messages.some(m => m.nonPublie && /transféré/.test(m.contenu)));

  // Fermeture (salon + MP récapitulatif) et réouverture : postées.
  await p.action(tk, 'fermer', { raison: 'Réglé' });
  assert.match(texteDe(p.salon(tk).at(-1)), /Ticket fermé par/);
  assert.ok(p.k.discord.etat.mp.some(m => m.destinataire === LEA && /est fermé/.test(texteDe(m))), 'MP récapitulatif');
  await p.action(tk, 'rouvrir');
  assert.match(texteDe(p.salon(tk).at(-1)), /Ticket rouvert par/);
});

test('avertissement d’inactivité posté par défaut ; coupé : noté sans bruit', async () => {
  const p = await preparer();
  const tk = await p.ouvrir();
  const recule = h => p.k.b.base.executer('UPDATE tickets SET derniere_activite_le = ? WHERE id = ?', [new Date(p.k.b.horloge.t - h * H).toISOString(), tk.id]);
  await recule(30);
  assert.equal((await p.cycle.tachesCycle()).avertis, 1);
  assert.match(texteDe(p.salon(tk).at(-1)), /fermé automatiquement/);
  await p.k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { annonces: { avertissement: false } } });
  const tk2 = await p.ouvrir(BOB);
  const n = p.salon(tk2).length;
  await p.k.b.base.executer('UPDATE tickets SET derniere_activite_le = ? WHERE id = ?', [new Date(p.k.b.horloge.t - 30 * H).toISOString(), tk2.id]);
  assert.equal((await p.cycle.tachesCycle()).avertis, 1);
  assert.equal(p.salon(tk2).length, n, 'rien de posté');
  assert.ok((await p.k.api(`/tickets/${tk2.id}`)).corps.messages.some(m => m.nonPublie && /fermé automatiquement/.test(m.contenu)));
});

test('réglage par événement : priorité réactivée, prise en charge / fermeture / MP coupés ; validation', async () => {
  const p = await preparer();
  const r = await p.k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { annonces: { priorite: true, prise_en_charge: false, fermeture: false, mp_fermeture: false, inconnu: true } } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.deepEqual(r.corps.general.annonces, { ...ANNONCES_DEFAUT, priorite: true, prise_en_charge: false, fermeture: false, mp_fermeture: false });
  // Un autre champ enregistré ensuite ne remet pas les messages par défaut.
  assert.equal((await p.k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { avertissementH: 12 } })).corps.general.annonces.priorite, true);
  assert.equal((await p.k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { annonces: 'non' } })).statut, 400);
  assert.equal((await p.k.api('/tickets/config/general', p.support.jeton, { methode: 'PUT', corps: { annonces: { priorite: false } } })).statut, 403);
  const tk = await p.ouvrir();
  await p.action(tk, 'priorite', { priorite: 'faible' });
  assert.match(texteDe(p.salon(tk).at(-1)), /Priorité : Faible/);
  const n = p.salon(tk).length;
  await p.action(tk, 'prendre');
  assert.equal(p.salon(tk).length, n, 'prise en charge coupée');
  const mpAvant = p.k.discord.etat.mp.length;
  await p.action(tk, 'fermer');
  assert.equal(p.salon(tk).length, n, 'fermeture coupée');
  assert.equal(p.k.discord.etat.mp.length, mpAvant, 'pas de MP récapitulatif');
  const l = await p.k.b.base.premier('SELECT statut, archive_le FROM tickets WHERE id = ?', [tk.id]);
  assert.equal(l.statut, 'ferme');
  assert.ok(l.archive_le, 'salon quand même verrouillé et archivé');
});

test('« Mentionner » depuis l’app : cibles proposées, mention exacte, gardée dans la conversation, 3 par minute', async () => {
  const p = await preparer();
  const tk = await p.ouvrir();
  await p.action(tk, 'ajouter', { discordId: BOB, nom: 'Bob' });
  await p.k.b.base.executer('INSERT INTO discord_comptes (compte_id, discord_user_id, discord_nom, super_admin, lie_le) VALUES (?, ?, ?, 0, ?)', ['repo1234', KAI, 'kai', '2026-01-01T00:00:00.000Z']);
  const m = await p.k.api(`/tickets/${tk.id}/mentionnables`, p.support.jeton);
  assert.equal(m.statut, 200, JSON.stringify(m.corps));
  assert.deepEqual(m.corps.auteur, { discordId: LEA, nom: 'Léa' });
  assert.deepEqual(m.corps.membres, [{ discordId: BOB, nom: 'Bob' }]);
  assert.deepEqual(m.corps.roles, [{ id: STAFF, nom: 'Staff' }], 'rôles de la catégorie, nommés');
  assert.deepEqual(m.corps.staff, [{ discordId: KAI, nom: 'Repondeur' }], 'staff au compte Discord lié');
  assert.equal(m.corps.recherche, null);
  const cherche = await p.k.api(`/tickets/${tk.id}/mentionnables?q=zo`, p.support.jeton);
  assert.deepEqual(cherche.corps.recherche.map(x => x.discordId), [ZOE, '800000000000000078'], 'bots écartés');
  assert.equal(cherche.corps.recherche[1].nom, 'Zorro le Grand');

  const n = p.salon(tk).length;
  const r = await p.k.api(`/tickets/${tk.id}/mentionner`, p.repondeur.jeton, { methode: 'POST', corps: { cibles: [{ type: 'membre', id: LEA, nom: 'Léa' }, { type: 'role', id: STAFF, nom: 'Staff' }, { type: 'membre', id: LEA, nom: 'Léa' }], message: 'Pouvez-vous confirmer ? @everyone <@&1>' } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(p.salon(tk).length, n + 1);
  const post = p.salon(tk).at(-1);
  assert.deepEqual(post.allowed_mentions, { parse: [], users: [LEA], roles: [STAFF] }, 'exactement les cibles choisies');
  assert.match(post.content, new RegExp(`^<@${LEA}> <@&${STAFF}>\\n\\*\\*Staff · Repondeur\\*\\* : Pouvez-vous confirmer \\?`));
  assert.doesNotMatch(post.content, /@everyone(?!​)/, 'mentions du texte neutralisées');
  assert.equal(post.components, undefined);
  const trace = r.corps.messages.find(x => x.contenu.startsWith('Mention'));
  assert.equal(trace.genre, 'systeme');
  assert.equal(trace.nonPublie, false);
  assert.match(trace.contenu, /^Mention : Léa, @Staff · Pouvez-vous confirmer/);
  assert.ok(await p.k.b.base.premier("SELECT id FROM evenements WHERE type = 'ticket.mention' AND entite_id = ?", [tk.id]));

  // Sans texte : message par défaut (bilingue).
  await p.k.api(`/tickets/${tk.id}/mentionner`, p.support.jeton, { methode: 'POST', corps: { cibles: [{ type: 'membre', id: BOB, nom: 'Bob' }] } });
  assert.match(p.salon(tk).at(-1).content, new RegExp(`^<@${BOB}>\\n.*vous mentionne dans ce ticket`, 's'));
  assert.deepEqual(p.salon(tk).at(-1).allowed_mentions, { parse: [], users: [BOB], roles: [] });
  // Troisième : accepté ; quatrième dans la minute : refusé (429) ; une minute plus tard : de nouveau possible.
  assert.equal((await p.k.api(`/tickets/${tk.id}/mentionner`, p.support.jeton, { methode: 'POST', corps: { cibles: [{ type: 'membre', id: LEA }] } })).statut, 200);
  const trop = await p.k.api(`/tickets/${tk.id}/mentionner`, p.support.jeton, { methode: 'POST', corps: { cibles: [{ type: 'membre', id: LEA }] } });
  assert.equal(trop.statut, 429);
  assert.equal(trop.corps.code, 'ticket-ping_trop_vite');
  p.k.b.horloge.t += 61_000;
  assert.equal((await p.k.api(`/tickets/${tk.id}/mentionner`, p.support.jeton, { methode: 'POST', corps: { cibles: [{ type: 'membre', id: LEA }] } })).statut, 200);

  // Refus : rôle hors catégorie, aucune cible, sans la permission de répondre.
  p.k.b.horloge.t += 61_000;
  assert.equal((await p.k.api(`/tickets/${tk.id}/mentionner`, p.support.jeton, { methode: 'POST', corps: { cibles: [{ type: 'role', id: AUTRE_ROLE }] } })).corps.code, 'ticket-ping_role_interdit');
  assert.equal((await p.k.api(`/tickets/${tk.id}/mentionner`, p.support.jeton, { methode: 'POST', corps: { cibles: [{ type: 'role', id: p.k.GUILD }] } })).corps.code, 'ticket-ping_role_interdit', 'jamais @everyone');
  assert.equal((await p.k.api(`/tickets/${tk.id}/mentionner`, p.support.jeton, { methode: 'POST', corps: { cibles: [] } })).corps.code, 'ticket-ping_vide');
  const lecteur = await p.k.compteAvec('lect1234', 'Lecteur', ['tickets.voir']);
  assert.equal((await p.k.api(`/tickets/${tk.id}/mentionner`, lecteur.jeton, { methode: 'POST', corps: { cibles: [{ type: 'membre', id: LEA }] } })).statut, 404, 'catégorie non visible');
});

test('« Mentionner » une personne trouvée par la recherche : ajoutée au ticket d’abord (tickets.gerer), puis mentionnée', async () => {
  const p = await preparer();
  const tk = await p.ouvrir();
  // tickets.repondre seul : ajouter quelqu'un est refusé.
  assert.equal((await p.k.api(`/tickets/${tk.id}/mentionner`, p.repondeur.jeton, { methode: 'POST', corps: { cibles: [{ type: 'membre', id: ZOE, nom: 'Zoé', ajouter: true }] } })).statut, 403);
  const r = await p.k.api(`/tickets/${tk.id}/mentionner`, p.support.jeton, { methode: 'POST', corps: { cibles: [{ type: 'membre', id: ZOE, nom: 'Zoé', ajouter: true }] } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.deepEqual(r.corps.membres.map(m => m.discordId), [ZOE]);
  const o = p.k.discord.etat.salons.get(tk.salon_id).permission_overwrites.find(x => x.id === ZOE);
  assert.ok(BigInt(o.allow) & (1n << 11n), 'elle peut écrire');
  assert.deepEqual(p.salon(tk).at(-1).allowed_mentions.users, [ZOE]);
});

test('/ticket ping : staff seulement, une personne ou un rôle de la catégorie, mention exacte ; désactivable', async () => {
  const p = await preparer();
  const tk = await p.ouvrir();
  const dans = { salon: tk.salon_id };
  assert.match((await p.cmd('ping', { qui: BOB }, { qui: LEA, roles: [], ...dans, resolved: { users: { [BOB]: { id: BOB, username: 'bob' } } } })).corps.data.content, /Seul le staff/);
  const r = await p.cmd('ping', { qui: BOB, message: 'On t’attend' }, { ...dans, resolved: { users: { [BOB]: { id: BOB, username: 'bob', global_name: 'Bob' } } } });
  assert.equal(r.corps.data.content, 'Mention envoyée dans le ticket.');
  assert.equal(r.corps.data.flags, 64);
  const post = p.salon(tk).at(-1);
  assert.deepEqual(post.allowed_mentions, { parse: [], users: [BOB], roles: [] });
  assert.match(post.content, new RegExp(`^<@${BOB}>\\n.*On t’attend`, 's'));
  assert.ok((await p.k.api(`/tickets/${tk.id}`)).corps.messages.some(m => m.contenu.startsWith('Mention : Bob')));
  const role = await p.cmd('ping', { qui: STAFF }, { ...dans, resolved: { roles: { [STAFF]: { id: STAFF, name: 'Staff' } } } });
  assert.match(role.corps.data.content, /Mention envoyée/);
  assert.deepEqual(p.salon(tk).at(-1).allowed_mentions, { parse: [], users: [], roles: [STAFF] });
  assert.match((await p.cmd('ping', { qui: AUTRE_ROLE }, { ...dans, resolved: { roles: { [AUTRE_ROLE]: { id: AUTRE_ROLE, name: 'Autre' } } } })).corps.data.content, /Seuls les rôles qui traitent cette catégorie/);
  assert.match((await p.cmd('ping', { qui: BOB }, { ...dans, resolved: { users: { [BOB]: { id: BOB } } } })).corps.data.content, /Mention envoyée/);
  assert.match((await p.cmd('ping', { qui: BOB }, { ...dans, resolved: { users: { [BOB]: { id: BOB } } } })).corps.data.content, /3 par minute/, 'limite partagée avec l’app');
  assert.match((await p.cmd('ping', { qui: BOB }, { salon: '710000000000000013' })).corps.data.content, /salon d’un ticket/);
  await p.k.api('/tickets/config/commandes', undefined, { methode: 'PUT', corps: { ping: { actif: false } } });
  assert.match((await p.cmd('ping', { qui: BOB }, dans)).corps.data.content, /désactivée/);
  const conf = (await p.k.api('/tickets/config')).corps;
  assert.ok(conf.choix.commandes.includes('ping') && conf.choix.commandesStaff.includes('ping'));
});
