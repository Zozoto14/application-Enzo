/**
 * Suppression d'un ticket en deux temps (migration 0065, docs/esport/tickets.md, « Supprimer un ticket fermé ») :
 * « Supprimer » (app, suppression groupée, /ticket supprimer) supprime tout de suite le salon Discord mais garde le
 * ticket lisible 30 jours dans « Supprimés » (conversation, notes, pièces, transcript, avis) ; absent des listes, des
 * compteurs et des statistiques de tickets ; « Restaurer » (avec ou sans réouverture) ; effacement définitif par le
 * cron après le délai (horloge simulée), avis anonyme gardé ou supprimé selon le choix de la suppression ; « Supprimer
 * définitivement maintenant » ; journal sans contenu.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc } from './aide.mjs';
import { bancTickets } from './tickets-aide.mjs';
import { REGLAGES_SUPPRESSION } from '../noyau/tickets/bot.mjs';

REGLAGES_SUPPRESSION.delaiSalonMs = 0;

const OUVERTS = '710000000000000010';
const ARCHIVES = '710000000000000011';
const JOURNAUX = '710000000000000012';
const STAFF = '720000000000000001';
const LEA = '800000000000000001';
const BOB = '800000000000000002';
const KAI = '800000000000000003';
const J = 86_400_000;

async function preparer() {
  const k = await bancTickets({ banc });
  const g = await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { guildId: k.GUILD, categorieOuverts: OUVERTS, categorieArchives: ARCHIVES, salonJournaux: JOURNAUX, actif: true } });
  assert.equal(g.statut, 200, JSON.stringify(g.corps));
  const recrue = await k.compteAvec('recr1234', 'Recrue', ['tickets.repondre']);
  const chef = await k.compteAvec('chef1234', 'Chef', ['tickets.gerer']);
  const A = (await k.api('/tickets/config/categories', undefined, { methode: 'POST', corps: { nom: { fr: 'Recrutement', en: 'Recruiting' }, rolesDiscord: [STAFF], rolesApp: [`club:${recrue.roleId}`] } })).corps.id;
  const membre = (id, roles = []) => ({ user: { id, username: `u${id.slice(-3)}`, global_name: `Membre ${id.slice(-3)}` }, roles, permissions: '0' });
  const ouvrir = async (qui = LEA) => {
    const r = await k.interaction({ type: 3, locale: 'fr', guild_id: k.GUILD, channel_id: '710000000000000013', member: membre(qui), data: { custom_id: `tk:o:${A}`, component_type: 2 } });
    assert.match(r.corps.data.content, /Ticket créé/, JSON.stringify(r.corps));
    return k.b.base.premier('SELECT * FROM tickets ORDER BY numero DESC LIMIT 1', []);
  };
  const fermer = async tk => assert.equal((await k.api(`/tickets/${tk.id}/fermer`, k.fondateur, { methode: 'POST', corps: {} })).statut, 200);
  const noter = async (tk, note, commentaire, qui = LEA) => {
    const mp = `96${qui.slice(2)}`;
    await k.interaction({ type: 3, locale: 'fr', channel_id: mp, user: { id: qui, username: 'auteur' }, data: { custom_id: `tk:n:${tk.id}:${note}`, component_type: 2 } });
    if (commentaire !== undefined) await k.interaction({ type: 5, locale: 'fr', channel_id: mp, user: { id: qui, username: 'auteur' }, data: { custom_id: `tk:nc:${tk.id}:${note}`, components: [{ type: 1, components: [{ type: 4, custom_id: 'commentaire', value: commentaire }] }] } });
  };
  const cmd = (sous, options = {}, { qui = KAI, roles = [STAFF], salon, locale = 'fr' } = {}) =>
    k.interaction({ type: 2, locale, guild_id: k.GUILD, channel_id: salon, member: membre(qui, roles), data: { name: 'ticket', options: [{ type: 1, name: sous, options: Object.entries(options).map(([name, value]) => ({ name, value })) }] } });
  const clic = (custom_id, { qui = KAI, roles = [STAFF], salon }) => k.interaction({ type: 3, locale: 'fr', guild_id: k.GUILD, channel_id: salon, member: membre(qui, roles), data: { custom_id, component_type: 2 } });
  const ticket = id => k.b.base.premier('SELECT * FROM tickets WHERE id = ?', [id]);
  const liste = async (statut, jeton = chef.jeton) => (await k.api(`/tickets?statut=${statut}`, jeton)).corps;
  const supprimer = (tk, corps = {}, jeton = chef.jeton) => k.api(`/tickets/${tk.id}/supprimer`, jeton, { methode: 'POST', corps });
  const cron = () => k.b.traiter.ticketsCycle.tachesCycle();
  /** Avance l'horloge simulée ; les sessions de l'app expirent : elles sont renouvelées. */
  const avancer = async ms => {
    k.b.horloge.t += ms;
    chef.jeton = await k.b.session('chef1234', 'Chef');
    recrue.jeton = await k.b.session('recr1234', 'Recrue');
    k.fondateur = await k.b.session('principal', 'Fondateur');
  };
  /** Ticket fermé avec conversation, note interne, pièce jointe et avis (note + commentaire), prêt à supprimer. */
  const garni = async (qui = LEA, note = 4, commentaire = 'Très bien') => {
    const tk = await ouvrir(qui);
    const r = await k.api(`/tickets/${tk.id}/messages`, recrue.jeton, { methode: 'POST', corps: { texte: 'Voici le règlement', pieces: [{ nom: 'regles.pdf', type: 'application/pdf', base64: Buffer.from('%PDF-1.4 test').toString('base64') }] } });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
    await k.api(`/tickets/${tk.id}/notes`, recrue.jeton, { methode: 'POST', corps: { texte: 'Note interne secrète' } });
    await fermer(tk);
    if (note) await noter(tk, note, commentaire, qui);
    const piece = await k.b.base.premier('SELECT cle_stockage FROM tickets_pieces WHERE ticket_id = ?', [tk.id]);
    return { tk: await ticket(tk.id), piece: piece.cle_stockage };
  };
  const lignes = async (table, id) => Number((await k.b.base.premier(`SELECT COUNT(*) AS n FROM ${table} WHERE ticket_id = ?`, [id])).n);
  const lier = (compte, discordId) => k.b.base.executer('INSERT INTO discord_comptes (compte_id, discord_user_id, discord_nom, super_admin, lie_le) VALUES (?, ?, ?, 0, ?)', [compte, discordId, compte, '2026-01-01T00:00:00.000Z']);
  return { k, recrue, chef, A, avancer, ouvrir, fermer, noter, cmd, clic, ticket, liste, supprimer, cron, garni, lignes, lier };
}

test('supprimer : le salon Discord disparaît tout de suite, le ticket reste lisible dans « Supprimés » avec tout son contenu', async () => {
  const p = await preparer();
  const { tk, piece } = await p.garni();
  const salon = tk.salon_id;
  assert.ok(p.k.discord.etat.salons.has(salon));
  const s = await p.supprimer(tk);
  assert.equal(s.statut, 200, JSON.stringify(s.corps));
  assert.deepEqual([s.corps.ok, s.corps.numero, s.corps.jours, s.corps.effaceLe], [true, tk.numero, 30, new Date(p.k.b.horloge.t + 30 * J).toISOString()]);
  // Discord : salon supprimé, ticket marqué, rien d'autre perdu.
  assert.equal(p.k.discord.etat.salons.has(salon), false);
  const l = await p.ticket(tk.id);
  assert.deepEqual([l.supprime_le, l.supprime_par, Number(l.supprime_garder_avis)], [new Date(p.k.b.horloge.t).toISOString(), 'Chef', 1]);
  assert.ok(l.salon_supprime_le, 'salon noté supprimé');
  assert.equal(await p.lignes('tickets_messages', tk.id) > 0, true);
  assert.equal(await p.lignes('tickets_pieces', tk.id), 1);
  assert.ok(await p.k.b.stockage.lire(piece), 'octets de la pièce gardés');
  // Lisible dans l'app : conversation, notes, avis, indication de l'effacement, transcript.
  const d = (await p.k.api(`/tickets/${tk.id}`, p.chef.jeton)).corps;
  assert.deepEqual([d.supprime.par, d.supprime.effaceLe, d.supprime.garderAvis], ['Chef', new Date(p.k.b.horloge.t + 30 * J).toISOString(), true]);
  assert.ok(d.messages.some(m => m.contenu === 'Voici le règlement' && m.pieces.length === 1));
  assert.ok(d.messages.some(m => m.genre === 'note' && m.contenu === 'Note interne secrète'));
  assert.deepEqual([d.note, d.noteCommentaire, d.salon.supprime], [4, 'Très bien', true]);
  assert.match((await p.k.api(`/tickets/${tk.id}/transcript`, p.chef.jeton)).corps.contenu ?? JSON.stringify((await p.k.api(`/tickets/${tk.id}/transcript`, p.chef.jeton)).corps), /Voici le règlement/);
  // Journal : qui, quel numéro, jamais le contenu ; message dans le salon des journaux du staff.
  const ev = await p.k.b.base.premier("SELECT * FROM evenements WHERE type = 'ticket.corbeille'", []);
  assert.equal(ev.acteur_id, 'chef1234');
  assert.deepEqual([JSON.parse(ev.charge).numero, JSON.parse(ev.charge).jours, JSON.parse(ev.charge).avisGarde], [tk.numero, 30, true]);
  assert.ok(!/règlement|secrète|Très bien/.test(ev.charge), 'aucun contenu dans le journal');
  assert.match(p.k.discord.etat.messages.get(JOURNAUX).at(-1).embeds[0].description, new RegExp(`n° ${tk.numero} supprimé de Discord par .*encore lisible dans l’app jusqu’au`));
  // Déjà supprimé : refusé ; plus aucune action possible, ni réponse, ni note, ni réouverture sans restauration.
  assert.equal((await p.supprimer(tk)).statut, 409);
  assert.equal((await p.k.api(`/tickets/${tk.id}/rouvrir`, p.chef.jeton, { methode: 'POST', corps: {} })).statut, 409);
  assert.equal((await p.k.api(`/tickets/${tk.id}/notes`, p.chef.jeton, { methode: 'POST', corps: { texte: 'x' } })).statut, 409);
  assert.equal((await p.k.api(`/tickets/${tk.id}/prendre`, p.chef.jeton, { methode: 'POST', corps: {} })).statut, 409);
  // La note de l'auteur (MP) n'est plus prise pour un ticket supprimé.
  await p.noter(tk, 1, 'Changement');
  assert.equal(Number((await p.ticket(tk.id)).note), 4);
});

test('supprimer : absent des listes, des compteurs, des statistiques de tickets et de la fermeture automatique ; l’avis reste dans les statistiques', async () => {
  const p = await preparer();
  const ouvert = await p.ouvrir(BOB);
  const { tk } = await p.garni(LEA, 5, 'Parfait');
  const autre = (await p.garni(KAI, 3, 'Moyen')).tk;
  assert.equal((await p.liste('ferme')).tickets.length, 2);
  assert.equal((await p.k.api('/tickets/compteur', p.chef.jeton)).corps.ouverts, 1);
  const avant = (await p.k.api('/tickets/stats', p.chef.jeton)).corps.total;
  assert.deepEqual([avant.crees, avant.fermes, avant.notes], [3, 2, 2]);

  assert.equal((await p.supprimer(tk)).statut, 200);
  for (const statut of ['ouverts', 'ferme', 'tous', 'ouvert']) {
    const nums = (await p.liste(statut)).tickets.map(x => x.numero);
    assert.ok(!nums.includes(tk.numero), `absent de la liste « ${statut} »`);
  }
  assert.deepEqual((await p.liste('ferme')).tickets.map(x => x.numero), [autre.numero]);
  assert.equal((await p.k.api(`/tickets?q=${tk.numero}`, p.chef.jeton)).corps.tickets.length, 0, 'ni par la recherche');
  const corb = await p.liste('supprimes');
  assert.deepEqual(corb.tickets.map(x => [x.numero, x.supprime.par, x.statut]), [[tk.numero, 'Chef', 'ferme']]);
  assert.equal(corb.nbSupprimes, 1);
  assert.equal(corb.retentionSuppressionJours, 30);
  assert.equal((await p.liste('ferme')).nbSupprimes, 1);
  // Compteur de tickets ouverts inchangé ; statistiques : un ticket de moins, l'avis reste.
  assert.equal((await p.k.api('/tickets/compteur', p.chef.jeton)).corps.ouverts, 1);
  const st = (await p.k.api('/tickets/stats', p.chef.jeton)).corps;
  assert.deepEqual([st.total.crees, st.total.fermes, st.total.notes, st.total.satisfaction, st.total.ouverts], [2, 1, 2, 4, 1]);
  const av = (await p.k.api('/tickets/avis', p.chef.jeton)).corps;
  assert.deepEqual([av.total, av.avis.map(a => a.note).sort()], [2, [3, 5]]);
  // Le ticket ouvert n'est pas touché par la fermeture automatique, le supprimé non plus (il est fermé).
  await p.avancer(20 * J);
  const bilan = await p.cron();
  assert.equal(bilan.fermes, 1, 'seul le ticket ouvert est fermé');
  assert.ok((await p.ticket(tk.id)).supprime_le);
  // Un avis à supprimer avec le ticket n'est plus compté dès la suppression.
  assert.equal((await p.supprimer(autre, { garderAvis: false })).statut, 200);
  const av2 = (await p.k.api('/tickets/avis', p.chef.jeton)).corps;
  assert.deepEqual([av2.total, av2.avis.map(a => a.note)], [1, [5]]);
  assert.equal((await p.k.api('/tickets/stats', p.chef.jeton)).corps.total.notes, 1);
  void ouvert;
});

test('restaurer : sans réouverture le ticket redevient un ticket fermé sans salon ; avec réouverture un nouveau salon est créé ; droits', async () => {
  const p = await preparer();
  const { tk } = await p.garni();
  const { tk: tk2 } = await p.garni(BOB, 2, 'Bof');
  await p.supprimer(tk);
  await p.supprimer(tk2);
  assert.equal((await p.k.api(`/tickets/${tk.id}/restaurer`, p.recrue.jeton, { methode: 'POST', corps: {} })).statut, 403, 'tickets.repondre ne suffit pas');
  assert.equal((await p.k.api(`/tickets/${tk.id}`, p.recrue.jeton)).corps.droits.supprimer, false);
  assert.equal((await p.k.api(`/tickets/${tk.id}/restaurer`, p.chef.jeton, { methode: 'POST', corps: {} })).statut, 200);
  const l = await p.ticket(tk.id);
  assert.deepEqual([l.supprime_le, l.supprime_par, l.statut], [null, null, 'ferme']);
  assert.equal(p.k.discord.etat.salons.has(l.salon_id), false, 'pas de nouveau salon');
  assert.deepEqual((await p.liste('ferme')).tickets.map(x => x.numero), [tk.numero]);
  assert.equal((await p.liste('supprimes')).nbSupprimes, 1);
  assert.equal((await p.k.api(`/tickets/${tk.id}/restaurer`, p.chef.jeton, { methode: 'POST', corps: {} })).statut, 409, 'plus supprimé');
  assert.ok(await p.lignes('tickets_messages', tk.id) > 0, 'conversation intacte');
  const ev = await p.k.b.base.premier("SELECT * FROM evenements WHERE type = 'ticket.restaure'", []);
  assert.deepEqual([ev.acteur_id, JSON.parse(ev.charge).numero, JSON.parse(ev.charge).rouvert], ['chef1234', tk.numero, false]);
  assert.match(p.k.discord.etat.messages.get(JOURNAUX).at(-1).embeds[0].description, new RegExp(`n° ${tk.numero} restauré par`));
  // Restaurer et rouvrir : un nouveau salon dans la catégorie des tickets ouverts.
  const r = await p.k.api(`/tickets/${tk2.id}/restaurer`, p.chef.jeton, { methode: 'POST', corps: { rouvrir: true } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  const ro = await p.ticket(tk2.id);
  assert.deepEqual([ro.statut, ro.supprime_le, ro.salon_supprime_le], ['ouvert', null, null]);
  assert.ok(ro.salon_id && ro.salon_id !== tk2.salon_id && p.k.discord.etat.salons.has(ro.salon_id));
  assert.equal(JSON.parse((await p.k.b.base.premier("SELECT charge FROM evenements WHERE type = 'ticket.restaure' AND entite_id = ?", [tk2.id])).charge).rouvert, true);
  // Plus de suppression prévue : le cron ne l'efface jamais.
  await p.avancer(60 * J);
  await p.cron();
  assert.ok(await p.ticket(tk.id));
  assert.ok(await p.ticket(tk2.id), 'ni le ticket rouvert');
});

test('cron : effacement définitif après 30 jours (horloge simulée) ; avis gardé anonyme ou supprimé selon le choix de la suppression', async () => {
  const p = await preparer();
  const a = await p.garni(LEA, 4, 'Merci');
  const b = await p.garni(BOB, 1, 'Nul');
  await p.supprimer(a.tk, { garderAvis: true });
  await p.supprimer(b.tk, { garderAvis: false });
  await p.avancer(29 * J + 23 * 3_600_000);
  assert.equal((await p.cron()).corbeille, 0, 'pas avant 30 jours');
  assert.ok(await p.ticket(a.tk.id) && await p.ticket(b.tk.id));
  await p.avancer(2 * 3_600_000);
  const bilan = await p.cron();
  assert.equal(bilan.corbeille, 2);
  for (const { tk, piece } of [a, b]) {
    assert.ok(!(await p.ticket(tk.id)));
    for (const table of ['tickets_messages', 'tickets_pieces', 'tickets_membres', 'tickets_lectures']) assert.equal(await p.lignes(table, tk.id), 0, table);
    assert.equal(await p.k.b.stockage.lire(piece), null, 'octets effacés');
    assert.equal((await p.k.api(`/tickets/${tk.id}`, p.chef.jeton)).statut, 404);
  }
  const anon = await p.k.b.base.tous('SELECT note, commentaire, categorie_id FROM tickets_avis_anonymes', []);
  assert.deepEqual(anon.map(x => [Number(x.note), x.commentaire, x.categorie_id]), [[4, 'Merci', p.A]], 'seul l’avis dont le choix était « garder » reste, anonyme');
  assert.equal((await p.k.api('/tickets/avis', p.chef.jeton)).corps.total, 1);
  const evs = await p.k.b.base.tous("SELECT * FROM evenements WHERE type = 'ticket.purge' ORDER BY cree_le", []);
  assert.equal(evs.length, 2);
  assert.equal(evs[0].acteur_id, null);
  assert.ok(!/Merci|Nul|règlement|secrète/.test(evs.map(e => e.charge).join()), 'aucun contenu');
  assert.deepEqual(evs.map(e => JSON.parse(e.charge).avisGarde).sort(), [false, true]);
  assert.match(p.k.discord.etat.messages.get(JOURNAUX).at(-1).embeds[0].description, /effacé définitivement/);
  // Numéro jamais réutilisé.
  assert.equal((await p.ouvrir(KAI)).numero, b.tk.numero + 1);
  assert.equal((await p.cron()).corbeille, 0);
});

test('délai réglable (Configuration › Général, retentionSuppressionJours), 30 par défaut ; valeurs hors limites refusées', async () => {
  const p = await preparer();
  const conf = (await p.k.api('/tickets/config')).corps;
  assert.equal(conf.general.retentionSuppressionJours, 30);
  for (const v of [0, 366, 1.5, 'x']) assert.equal((await p.k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { retentionSuppressionJours: v } })).statut, 400, String(v));
  const r = await p.k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { retentionSuppressionJours: 10 } });
  assert.equal(r.corps.general.retentionSuppressionJours, 10);
  const { tk } = await p.garni();
  const s = await p.supprimer(tk);
  assert.equal(s.corps.jours, 10);
  assert.equal((await p.k.api(`/tickets/${tk.id}`, p.chef.jeton)).corps.supprime.effaceLe, new Date(p.k.b.horloge.t + 10 * J).toISOString());
  await p.avancer(9 * J);
  assert.equal((await p.cron()).corbeille, 0);
  await p.avancer(2 * J);
  assert.equal((await p.cron()).corbeille, 1);
  assert.ok(!(await p.ticket(tk.id)));
});

test('supprimer définitivement maintenant : seulement un ticket déjà supprimé, droits, choix de l’avis (celui de la suppression par défaut)', async () => {
  const p = await preparer();
  const a = await p.garni(LEA, 5, 'Top');
  const b = await p.garni(BOB, 2, 'Moyen');
  const effacer = (tk, corps = {}, jeton = p.chef.jeton) => p.k.api(`/tickets/${tk.id}/effacer`, jeton, { methode: 'POST', corps });
  assert.equal((await effacer(a.tk)).statut, 409, 'pas supprimé : « Supprimer » d’abord');
  await p.supprimer(a.tk, { garderAvis: true });
  await p.supprimer(b.tk, { garderAvis: true });
  assert.equal((await effacer(a.tk, {}, p.recrue.jeton)).statut, 403);
  assert.ok(await p.ticket(a.tk.id));
  const e = await effacer(a.tk);
  assert.deepEqual(e.corps, { ok: true, numero: a.tk.numero });
  assert.ok(!(await p.ticket(a.tk.id)));
  assert.equal(await p.k.b.stockage.lire(a.piece), null);
  // Le choix peut être changé au moment de l'effacement : ici, l'avis part aussi.
  assert.equal((await effacer(b.tk, { garderAvis: false })).statut, 200);
  assert.deepEqual((await p.k.b.base.tous('SELECT note, commentaire FROM tickets_avis_anonymes', [])).map(x => [Number(x.note), x.commentaire]), [[5, 'Top']]);
  const ev = await p.k.b.base.tous("SELECT charge FROM evenements WHERE type = 'ticket.supprime' ORDER BY cree_le", []);
  assert.deepEqual(ev.map(x => [JSON.parse(x.charge).avisGarde, JSON.parse(x.charge).corbeille]), [[true, true], [false, true]]);
  assert.match(p.k.discord.etat.messages.get(JOURNAUX).at(-1).embeds[0].description, /supprimé définitivement par/);
});

test('suppression groupée : les tickets fermés vont dans « Supprimés » ; l’ouvert est refusé', async () => {
  const p = await preparer();
  const a = (await p.garni(LEA)).tk;
  const b = (await p.garni(BOB)).tk;
  const ouvert = await p.ouvrir(KAI);
  const g = await p.k.api('/tickets/supprimer', p.chef.jeton, { methode: 'POST', corps: { ids: [a.id, b.id, ouvert.id], garderAvis: false } });
  assert.equal(g.statut, 200, JSON.stringify(g.corps));
  assert.deepEqual(g.corps.supprimes.sort(), [a.numero, b.numero].sort());
  assert.deepEqual(g.corps.echecs.map(e => [e.id, e.code]), [[ouvert.id, 'ticket-supprimer_pas_ferme']]);
  assert.deepEqual((await p.liste('supprimes')).tickets.map(x => x.numero).sort(), [a.numero, b.numero].sort());
  assert.equal(Number((await p.ticket(a.id)).supprime_garder_avis), 0);
  assert.equal((await p.liste('supprimes', p.recrue.jeton)).tickets.length, 2, 'qui voit la catégorie lit les supprimés');
});

test('/ticket supprimer : salon supprimé après la réponse, ticket lisible 30 jours, confirmation avec le délai, déjà supprimé refusé, FR / EN', async () => {
  const p = await preparer();
  const { tk } = await p.garni(LEA, 4, 'Merci');
  const salon = tk.salon_id;
  await p.lier('chef1234', KAI);
  const conf = await p.cmd('supprimer', {}, { salon });
  assert.match(conf.corps.data.content, /Ce salon va disparaître de Discord/);
  assert.match(conf.corps.data.content, /pendant 30 jours/);
  assert.ok((await p.ticket(tk.id)) && !(await p.ticket(tk.id)).supprime_le, 'rien avant la confirmation');
  assert.match((await p.cmd('supprimer', {}, { salon, locale: 'en-US' })).corps.data.content, /stays readable in the app for 30 days/);
  const fait = await p.clic(`tk:dc:${tk.id}:s`, { salon });
  assert.match(fait.corps.data.content, new RegExp(`Ticket n° ${tk.numero} supprimé de Discord`));
  assert.match(fait.corps.data.content, /30 jours/);
  assert.equal(fait.corps.apres, undefined);
  assert.equal(p.k.discord.etat.salons.has(salon), false, 'salon supprimé après la réponse');
  const l = await p.ticket(tk.id);
  assert.deepEqual([Boolean(l.supprime_le), l.supprime_par, Number(l.supprime_garder_avis), Boolean(l.salon_supprime_le)], [true, 'Membre 003', 0, true]);
  assert.ok(await p.lignes('tickets_messages', tk.id) > 0);
  assert.equal((await p.liste('supprimes')).tickets.length, 1);
  assert.equal(JSON.parse((await p.k.b.base.premier("SELECT charge FROM evenements WHERE type = 'ticket.corbeille'", [])).charge).avisGarde, false);
  // Le salon n'existe plus : la commande n'a plus de salon où être tapée ; un second clic ne fait rien de plus.
  assert.match((await p.clic(`tk:dc:${tk.id}:g`, { salon })).corps.data.content, /déjà supprimé/);
});

test('salon Discord qui ne se supprime pas : le ticket est quand même supprimé, le cron réessaie ; salon déjà disparu (404) ignoré', async () => {
  const p = await preparer();
  const a = (await p.garni(LEA)).tk;
  const b = (await p.garni(BOB)).tk;
  p.k.discord.programme.push({ si: (m, c) => m === 'DELETE' && c === `/channels/${a.salon_id}`, statut: 403, corps: { code: 50013 } });
  const erreurs = [];
  const avant = console.error;
  console.error = (...x) => erreurs.push(x.join(' '));
  try {
    assert.equal((await p.supprimer(a)).statut, 200);
  } finally {
    console.error = avant;
  }
  assert.ok(erreurs.some(e => e.includes(`ticket ${a.numero}`) && e.includes('403')), erreurs.join('\n'));
  assert.ok((await p.ticket(a.id)).supprime_le);
  assert.equal((await p.ticket(a.id)).salon_supprime_le, null);
  assert.equal(p.k.discord.etat.salons.has(a.salon_id), true);
  // Le cron réessaie : le salon part.
  assert.ok((await p.cron()).salonsSupprimes >= 1);
  assert.equal(p.k.discord.etat.salons.has(a.salon_id), false);
  assert.ok((await p.ticket(a.id)).salon_supprime_le);
  // Salon supprimé à la main sur Discord : 404 ignoré.
  p.k.discord.etat.salons.delete(b.salon_id);
  assert.equal((await p.supprimer(b)).statut, 200);
  assert.ok((await p.ticket(b.id)).salon_supprime_le);
});
