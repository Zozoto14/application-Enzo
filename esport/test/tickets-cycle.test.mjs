/**
 * Tickets, étape 2 : cycle de vie avec un FAUX Discord (API REST simulée, interactions signées) : ouverture par le
 * bouton d'un panneau (fenêtre du formulaire, puis salon privé et droits : @everyone refusé, l'auteur, le rôle de la
 * catégorie et le bot autorisés), message d'accueil avec les réponses et les boutons ; refus (liste noire, plafond,
 * catégorie inactive, autre serveur) ; prise en charge (staff seulement), ajout d'une personne, priorité ; fermeture
 * avec raison (dernière relecture, salon verrouillé et archivé, MP récapitulatif, demande de note), note 1 à 5 et
 * commentaire ; réouverture (salon remis, ou recréé) ; fermeture automatique (avertissement 24 h avant), salons
 * archivés supprimés, rétention ; salon supprimé ; /ticket ouvrir et /ticket fermer ; RGPD.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc } from './aide.mjs';
import { bancTickets } from './tickets-aide.mjs';
import { exportParDiscord } from '../noyau/tickets/rgpd.mjs';
import { ingererMessage } from '../noyau/tickets/conversation.mjs';

const OUVERTS = '710000000000000010';
const ARCHIVES = '710000000000000011';
const JOURNAUX = '710000000000000012';
const STAFF = '720000000000000001';
const LEA = '800000000000000001';
const KAI = '800000000000000002';
const INTRUS = '800000000000000003';
const H = 3_600_000;

async function preparer({ formulaire = true, extra = {}, appSeule = false } = {}) {
  const k = await bancTickets({ banc });
  // Le staff écrit aussi dans le salon ; « Le staff répond uniquement depuis l'AppDashboard » : tickets-reponses-app.test.mjs.
  await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { guildId: k.GUILD, guildNom: 'Club', categorieOuverts: OUVERTS, categorieArchives: ARCHIVES, salonJournaux: JOURNAUX, actif: true, reponsesAppSeules: appSeule } });
  const support = await k.compteAvec('supp1234', 'Support', ['tickets.repondre']);
  const cat = await k.api('/tickets/config/categories', undefined, {
    methode: 'POST',
    corps: {
      nom: { fr: 'Recrutement', en: 'Recruitment' },
      rolesDiscord: [STAFF],
      rolesApp: [`club:${support.roleId}`],
      formulaire: formulaire ? [{ id: 'rang', libelle: { fr: 'Ton rang', en: 'Your rank' }, style: 'court', requis: true }, { id: 'motivation', libelle: { fr: 'Motivation', en: 'Motivation' }, style: 'long', requis: false }] : [],
      prioriteDefaut: 'moyen',
      ...extra,
    },
  });
  assert.equal(cat.statut, 200, JSON.stringify(cat.corps));
  const membre = (id, roles = []) => ({ user: { id, username: `u${id.slice(-3)}`, global_name: id === LEA ? 'Léa' : `Membre ${id.slice(-3)}` }, roles, permissions: '0' });
  const clic = (custom_id, { qui = LEA, roles = [], salon = '710000000000000013', valeurs, resolved, guild = k.GUILD, locale = 'fr' } = {}) =>
    k.interaction({ type: 3, locale, guild_id: guild, channel_id: salon, member: membre(qui, roles), data: { custom_id, component_type: valeurs ? 3 : 2, ...(valeurs ? { values: valeurs } : {}), ...(resolved ? { resolved } : {}) } });
  const fenetre = (custom_id, valeurs, { qui = LEA, roles = [], salon = '710000000000000013', guild = k.GUILD } = {}) =>
    k.interaction({ type: 5, locale: 'fr', guild_id: guild, channel_id: salon, member: membre(qui, roles), data: { custom_id, components: Object.entries(valeurs).map(([id, value]) => ({ type: 1, components: [{ type: 4, custom_id: id, value }] })) } });
  const commande = (sous, options = {}, { qui = LEA, roles = [], salon = '710000000000000013' } = {}) =>
    k.interaction({ type: 2, locale: 'fr', guild_id: k.GUILD, channel_id: salon, member: membre(qui, roles), data: { name: 'ticket', options: [{ type: 1, name: sous, options: Object.entries(options).map(([name, value]) => ({ name, value })) }] } });
  const mp = (custom_id, { qui = LEA } = {}) => k.interaction({ type: 3, locale: 'fr', channel_id: '960000000000000001', user: { id: qui, username: 'lea' }, data: { custom_id, component_type: 2 } });
  const mpFenetre = (custom_id, valeurs, { qui = LEA } = {}) => k.interaction({ type: 5, locale: 'fr', channel_id: '960000000000000001', user: { id: qui, username: 'lea' }, data: { custom_id, components: Object.entries(valeurs).map(([id, value]) => ({ type: 1, components: [{ type: 4, custom_id: id, value }] })) } });
  const ticket = () => k.b.base.premier('SELECT * FROM tickets ORDER BY numero DESC LIMIT 1', []);
  /** Ouvre un ticket de bout en bout (bouton, fenêtre) ; rend la ligne. */
  async function ouvrir(qui = LEA) {
    const r = await clic(`tk:o:${cat.corps.id}`, { qui });
    if (r.corps.type === 9) {
      const f = await fenetre(`tk:f:${cat.corps.id}`, { rang: 'Diamant 2', motivation: 'Jouer en équipe <@&1> @everyone' }, { qui });
      assert.match(f.corps.data.content, /Ticket créé : <#\d+>/, JSON.stringify(f.corps));
    } else assert.match(r.corps.data.content, /Ticket créé/);
    return ticket();
  }
  return { k, cat: cat.corps, support, clic, fenetre, commande, mp, mpFenetre, ticket, ouvrir };
}

test('ouverture : fenêtre du formulaire (langue de la personne), salon privé et droits, accueil, journal, notification', async () => {
  const p = await preparer();
  const r = await p.clic(`tk:o:${p.cat.id}`);
  assert.equal(r.corps.type, 9, 'fenêtre du formulaire');
  assert.equal(r.corps.data.custom_id, `tk:f:${p.cat.id}`);
  assert.equal(r.corps.data.title, 'Recrutement');
  const champs = r.corps.data.components.map(x => x.components[0]);
  assert.deepEqual(champs.map(c => [c.custom_id, c.label, c.style, c.required]), [['rang', 'Ton rang', 1, true], ['motivation', 'Motivation', 2, false]]);
  const tk = await p.ouvrir();
  assert.equal(tk.numero, 1);
  assert.equal(tk.statut, 'ouvert');
  assert.equal(tk.langue, 'fr');
  const salon = p.k.discord.etat.salons.get(tk.salon_id);
  assert.equal(salon.parent_id, OUVERTS);
  assert.equal(salon.name, 'ticket-0001-lea');
  const o = Object.fromEntries(salon.permission_overwrites.map(x => [x.id, x]));
  assert.equal(o[p.k.GUILD].deny, String(1n << 10n), '@everyone ne voit pas le salon');
  assert.ok(BigInt(o[LEA].allow) & (1n << 11n), 'l’auteur écrit');
  assert.ok(BigInt(o[STAFF].allow) & (1n << 10n), 'le rôle de la catégorie voit');
  assert.ok(BigInt(o[p.k.APP].allow) & (1n << 4n), 'le bot gère le salon');
  const accueil = p.k.discord.etat.messages.get(tk.salon_id)[0];
  assert.match(accueil.content, new RegExp(`<@${LEA}>`));
  assert.deepEqual(accueil.allowed_mentions, { users: [LEA], roles: [] });
  assert.match(accueil.embeds[0].description, /^Bonjour <@800000000000000001>.*\n\n> Hi <@800000000000000001>/s, 'français d’abord (langue de Léa), anglais en citation');
  assert.equal(accueil.embeds[0].fields[0].value, 'Diamant 2');
  assert.match(accueil.embeds[0].fields[1].value, /@​everyone/, 'mentions neutralisées dans les réponses');
  assert.deepEqual(accueil.components[0].components.map(b => b.custom_id), [`tk:c:${tk.id}`, `tk:a:${tk.id}`, `tk:p:${tk.id}`, `tk:x:${tk.id}`]);
  assert.ok(p.k.discord.etat.messages.get(JOURNAUX)?.length, 'journal Discord');
  // Notification personnelle au support (catégorie traitée par son rôle de l'app).
  const notifs = await p.k.api('/notifications/centre', p.support.jeton);
  assert.ok(JSON.stringify(notifs.corps).includes('tk-nouveau'), JSON.stringify(notifs.corps).slice(0, 300));
});

test('refus d’ouverture : liste noire, plafond par personne, catégorie inactive, autre serveur', async () => {
  const p = await preparer({ formulaire: false });
  await p.k.api('/tickets/config/liste-noire', undefined, { methode: 'POST', corps: { discordId: INTRUS } });
  assert.match((await p.clic(`tk:o:${p.cat.id}`, { qui: INTRUS })).corps.data.content, /ne pouvez pas/);
  const tk = await p.ouvrir();
  const r = await p.clic(`tk:o:${p.cat.id}`);
  assert.match(r.corps.data.content, new RegExp(`déjà 1 ticket.*<#${tk.salon_id}>`));
  assert.match((await p.clic(`tk:o:${p.cat.id}`, { guild: '700000000000000099' })).corps.data.content, /serveur du club/);
  await p.k.api(`/tickets/config/categories/${p.cat.id}`, undefined, { methode: 'PATCH', corps: { actif: false } });
  assert.match((await p.clic(`tk:o:${p.cat.id}`, { qui: KAI })).corps.data.content, /n’accepte plus/);
});

test('staff : prise en charge (rôle Discord ou compte lié), refus pour un autre ; ajout d’une personne ; priorité', async () => {
  const p = await preparer({ formulaire: false });
  const tk = await p.ouvrir();
  const dans = { salon: tk.salon_id };
  assert.match((await p.clic(`tk:c:${tk.id}`, { qui: INTRUS, ...dans })).corps.data.content, /Seul le staff/);
  assert.match((await p.clic(`tk:c:${tk.id}`, { qui: KAI, roles: [STAFF], ...dans })).corps.data.content, /prend en charge/);
  let l = await p.ticket();
  assert.equal(l.statut, 'pris_en_charge');
  assert.equal(l.responsable_discord_id, KAI);
  // Un compte lié qui a tickets.repondre et voit la catégorie est aussi du staff (sans rôle Discord).
  await p.k.b.base.executer("INSERT INTO discord_comptes (compte_id, discord_user_id, discord_nom, lie_le) VALUES ('supp1234', '800000000000000044', 'sup', '2026-01-01')", []);
  assert.match((await p.clic(`tk:c:${tk.id}`, { qui: '800000000000000044', ...dans })).corps.data.content, /déjà pris en charge/);
  // Un bouton d'un autre salon ne vaut rien.
  assert.match((await p.clic(`tk:c:${tk.id}`, { qui: KAI, roles: [STAFF], salon: '710000000000000013' })).corps.data.content, /salon d’un ticket/);
  const choix = await p.clic(`tk:a:${tk.id}`, { qui: KAI, roles: [STAFF], ...dans });
  assert.equal(choix.corps.data.components[0].components[0].type, 5, 'choix d’un membre');
  await p.clic(`tk:as:${tk.id}`, { qui: KAI, roles: [STAFF], valeurs: [INTRUS], resolved: { users: { [INTRUS]: { id: INTRUS, username: 'bob' } } }, ...dans });
  assert.ok(p.k.discord.etat.salons.get(tk.salon_id).permission_overwrites.some(o => o.id === INTRUS && BigInt(o.allow) & (1n << 11n)));
  await p.clic(`tk:ps:${tk.id}`, { qui: KAI, roles: [STAFF], valeurs: ['critique'], ...dans });
  l = await p.ticket();
  assert.equal(l.priorite, 'critique');
});

test('fermeture avec raison : relecture, salon verrouillé et archivé, MP récapitulatif et note ; note, commentaire ; réouverture', async () => {
  const p = await preparer({ formulaire: false });
  const tk = await p.ouvrir();
  const dans = { salon: tk.salon_id };
  // Un message posté sur Discord pendant que la Gateway ne tournait pas : rattrapé à la fermeture.
  p.k.discord.posterUtilisateur(tk.salon_id, LEA, 'Merci pour votre aide');
  const conf = await p.clic(`tk:x:${tk.id}`, dans);
  assert.deepEqual(conf.corps.data.components[0].components.map(b => b.custom_id), [`tk:xc:${tk.id}`, `tk:xr:${tk.id}`]);
  assert.equal((await p.clic(`tk:xr:${tk.id}`, dans)).corps.type, 9, 'fenêtre de la raison');
  const f = await p.fenetre(`tk:xm:${tk.id}`, { raison: 'Réglé' }, dans);
  assert.match(f.corps.data.content, /Ticket fermé/);
  const l = await p.ticket();
  assert.equal(l.statut, 'ferme');
  assert.equal(l.raison_fermeture, 'Réglé');
  assert.ok(l.archive_le);
  const salon = p.k.discord.etat.salons.get(tk.salon_id);
  assert.equal(salon.parent_id, ARCHIVES);
  const lea = salon.permission_overwrites.find(o => o.id === LEA);
  assert.ok(BigInt(lea.deny) & (1n << 11n), 'l’auteur ne peut plus écrire');
  const msgs = await p.k.b.base.tous('SELECT genre, contenu FROM tickets_messages WHERE ticket_id = ? ORDER BY cree_le', [tk.id]);
  assert.ok(msgs.some(m => m.contenu === 'Merci pour votre aide'), 'transcript complet');
  const mp = p.k.discord.etat.mp.find(m => m.destinataire === LEA);
  assert.ok(mp, 'MP récapitulatif');
  assert.match(mp.embeds[0].description, /Raison : Réglé/);
  assert.deepEqual(mp.components[0].components.map(b => b.custom_id), [1, 2, 3, 4, 5].map(n => `tk:n:${tk.id}:${n}`));
  // Note : l'auteur seulement.
  assert.match((await p.mp(`tk:n:${tk.id}:2`, { qui: INTRUS })).corps.data.content, /salon d’un ticket/);
  const n = await p.mp(`tk:n:${tk.id}:4`);
  assert.equal(n.corps.type, 9, 'fenêtre du commentaire');
  const c = await p.mpFenetre(`tk:nc:${tk.id}:4`, { commentaire: 'Rapide et efficace' });
  assert.match(c.corps.data.content, /Merci/);
  const noté = await p.ticket();
  assert.equal(noté.note, 4);
  assert.equal(noté.note_commentaire, 'Rapide et efficace');
  // Réouverture par le staff : salon remis dans les tickets ouverts, l'auteur peut écrire.
  const ro = await p.clic(`tk:r:${tk.id}`, { qui: KAI, roles: [STAFF], ...dans });
  assert.match(ro.corps.data.content, /rouvert/);
  assert.equal((await p.ticket()).statut, 'ouvert');
  assert.equal(p.k.discord.etat.salons.get(tk.salon_id).parent_id, OUVERTS);
  assert.ok(!(BigInt(p.k.discord.etat.salons.get(tk.salon_id).permission_overwrites.find(o => o.id === LEA).deny) & (1n << 11n)));
  // Salon supprimé entre-temps : rouvrir en recrée un.
  await p.commande('fermer', {}, { qui: LEA, salon: tk.salon_id });
  p.k.discord.etat.salons.delete(tk.salon_id);
  await p.clic(`tk:r:${tk.id}`, { qui: KAI, roles: [STAFF], ...dans });
  const neuf = await p.ticket();
  assert.notEqual(neuf.salon_id, tk.salon_id);
  assert.ok(p.k.discord.etat.salons.has(neuf.salon_id));
});

test('fermeture automatique : avertissement 24 h avant, fermeture après 7 jours sans message ; un message repousse', async () => {
  const p = await preparer({ formulaire: false });
  const tk = await p.ouvrir();
  const cycle = p.k.b.traiter.ticketsCycle;
  const recule = async h => p.k.b.base.executer('UPDATE tickets SET derniere_activite_le = ? WHERE id = ?', [new Date(p.k.b.horloge.t - h * H).toISOString(), tk.id]);
  await recule(100);
  assert.equal((await cycle.tachesCycle()).avertis, 0);
  await recule(145);
  const b1 = await cycle.tachesCycle();
  assert.equal(b1.avertis, 1);
  assert.ok((await p.ticket()).avertissement_le);
  const avert = p.k.discord.etat.messages.get(tk.salon_id).at(-1);
  assert.match(avert.embeds[0].description, /fermé automatiquement dans 23 h/);
  assert.equal((await cycle.tachesCycle()).avertis, 0, 'un seul avertissement');
  // Un message de l'auteur repousse la fermeture (activité, avertissement oublié).
  const m = p.k.discord.posterUtilisateur(tk.salon_id, LEA, 'Toujours là', { timestamp: new Date(p.k.b.horloge.t).toISOString() });
  await ingererMessage({ base: p.k.b.base, maintenant: () => p.k.b.horloge.t, botId: p.k.APP }, m);
  const repousse = await p.ticket();
  assert.equal(repousse.avertissement_le, null);
  assert.equal((await cycle.tachesCycle()).fermes, 0);
  await recule(169);
  const b2 = await cycle.tachesCycle();
  assert.equal(b2.fermes, 1);
  const l = await p.ticket();
  assert.equal(l.statut, 'ferme');
  assert.equal(l.raison_fermeture, 'inactivite');
  // Salon archivé supprimé après 7 jours ; puis rétention (365 jours) : conversation effacée, la ligne reste.
  p.k.b.horloge.t += 8 * 24 * H;
  assert.equal((await cycle.tachesCycle()).salonsSupprimes, 1);
  assert.ok(!p.k.discord.etat.salons.has(tk.salon_id));
  p.k.b.horloge.t += 366 * 24 * H;
  assert.equal((await cycle.tachesCycle()).purges, 1);
  assert.equal((await p.k.b.base.tous('SELECT id FROM tickets_messages WHERE ticket_id = ?', [tk.id])).length, 0);
  assert.ok((await p.ticket()).purge_le);
});

test('salon supprimé sur Discord : le ticket ouvert est fermé ; /ticket ouvrir (menu des catégories) et /ticket fermer', async () => {
  const p = await preparer({ formulaire: false });
  await p.k.api('/tickets/config/categories', undefined, { methode: 'POST', corps: { nom: { fr: 'Aide', en: 'Help' } } });
  const menu = await p.commande('ouvrir', {}, { qui: KAI });
  assert.equal(menu.corps.data.components[0].components[0].custom_id, 'tk:s');
  assert.equal(menu.corps.data.components[0].components[0].options.length, 2);
  const r = await p.commande('ouvrir', { categorie: p.cat.id }, { qui: KAI });
  assert.match(r.corps.data.content, /Ticket créé/);
  const tk = await p.ticket();
  assert.match((await p.commande('fermer', {}, { qui: INTRUS, salon: tk.salon_id })).corps.data.content, /Seul le staff/);
  assert.match((await p.commande('fermer', { raison: 'doublon' }, { qui: KAI, salon: tk.salon_id })).corps.data.content, /fermé/);
  const tk2 = await p.ouvrir(LEA);
  await p.k.b.traiter.ticketsCycle.salonSupprime(tk2.salon_id);
  assert.equal((await p.ticket()).statut, 'ferme');
  // Commande coupée dans l'app.
  await p.k.api('/tickets/config/commandes', undefined, { methode: 'PUT', corps: { ouvrir: { actif: false } } });
  assert.match((await p.commande('ouvrir', {}, { qui: KAI })).corps.data.content, /désactivée/);
});

test('RGPD : export et effacement d’une personne (Discord ID) ; suppression d’un compte lié', async () => {
  const p = await preparer({ formulaire: true });
  const tk = await p.ouvrir();
  p.k.discord.posterUtilisateur(tk.salon_id, LEA, 'Mes infos perso');
  await p.commande('fermer', {}, { qui: LEA, salon: tk.salon_id });
  const exp = await exportParDiscord(p.k.b.base, [LEA]);
  assert.equal(exp.ticketsOuverts.length, 1);
  assert.ok(exp.ticketsOuverts[0].conversation.some(m => m.texte === 'Mes infos perso'));
  const r = await p.k.api('/tickets/rgpd/export', undefined, { methode: 'POST', corps: { discordId: LEA } });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.ticketsOuverts[0].reponses[0].reponse, 'Diamant 2');
  assert.equal((await p.k.api('/tickets/rgpd/export', p.support.jeton, { methode: 'POST', corps: { discordId: LEA } })).statut, 403, 'Fondateur seulement');
  await p.k.api('/tickets/rgpd/effacer', undefined, { methode: 'POST', corps: { discordId: LEA } });
  const apres = await exportParDiscord(p.k.b.base, [LEA]);
  assert.ok(!apres.ticketsOuverts[0].conversation.some(m => m.texte === 'Mes infos perso'));
  assert.deepEqual(apres.ticketsOuverts[0].reponses, []);
  // Compte de l'app lié à Discord : « Mes données » contient ses tickets ; la suppression du compte les anonymise.
  const jeton = await p.k.b.session('kai12345', 'Kai');
  await p.k.b.base.executer("INSERT INTO discord_comptes (compte_id, discord_user_id, discord_nom, lie_le) VALUES ('kai12345', ?, 'kai', '2026-01-01')", [KAI]);
  await p.ouvrir(KAI);
  const mes = await p.k.api('/moi/export', jeton);
  assert.equal(mes.corps.ticketsOuverts.length, 1);
  assert.equal((await p.k.api('/moi', jeton, { methode: 'DELETE' })).statut, 200);
  assert.equal((await p.ticket()).auteur_nom, '');
});
