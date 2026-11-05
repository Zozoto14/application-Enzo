/**
 * Avis de satisfaction et suppression d'un ticket fermé (migration 0056, docs/esport/tickets.md, « Avis » et
 * « Supprimer un ticket fermé ») : liste des avis filtrée par les catégories qu'on gère (tickets.gerer ; configurer :
 * catégories de ses rôles), moyenne, nombre, répartition, filtres et tri ; suppression (ticket fermé seulement,
 * permission, salon Discord supprimé au mieux, 404 ignoré, pièces effacées du stockage, avis gardé anonyme ou supprimé,
 * numéro jamais réutilisé, journal sans contenu) ; suppression groupée ; /ticket supprimer (confirmation, droits,
 * commande désactivable ou réservée à des rôles, réponses FR / EN).
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
const AUTRE_ROLE = '720000000000000009';
const LEA = '800000000000000001';
const BOB = '800000000000000002';
const KAI = '800000000000000003';
const NOE = '800000000000000004';

async function preparer() {
  const k = await bancTickets({ banc });
  const g = await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { guildId: k.GUILD, categorieOuverts: OUVERTS, categorieArchives: ARCHIVES, salonJournaux: JOURNAUX, actif: true } });
  assert.equal(g.statut, 200, JSON.stringify(g.corps));
  const recrue = await k.compteAvec('recr1234', 'Recrue', ['tickets.repondre']);
  const chef = await k.compteAvec('chef1234', 'Chef', ['tickets.gerer']);
  const config = await k.compteAvec('conf1234', 'Config', ['tickets.voir', 'tickets.configurer']);
  const cat = async (nom, roleIds, extra = {}) => (await k.api('/tickets/config/categories', undefined, { methode: 'POST', corps: { nom: { fr: nom, en: nom }, rolesDiscord: [STAFF], rolesApp: roleIds.map(r => `club:${r}`), ...extra } })).corps.id;
  const A = await cat('Recrutement', [recrue.roleId, config.roleId]);
  const B = await cat('Partenariat', [chef.roleId]);
  const membre = (id, roles = []) => ({ user: { id, username: `u${id.slice(-3)}`, global_name: `Membre ${id.slice(-3)}` }, roles, permissions: '0' });
  const ouvrir = async (categorie, qui = LEA) => {
    const r = await k.interaction({ type: 3, locale: 'fr', guild_id: k.GUILD, channel_id: '710000000000000013', member: membre(qui), data: { custom_id: `tk:o:${categorie}`, component_type: 2 } });
    assert.match(r.corps.data.content, /Ticket créé/, JSON.stringify(r.corps));
    return k.b.base.premier('SELECT * FROM tickets ORDER BY numero DESC LIMIT 1', []);
  };
  const fermer = async tk => {
    const r = await k.api(`/tickets/${tk.id}/fermer`, k.fondateur, { methode: 'POST', corps: {} });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
  };
  /** Note (et commentaire) laissés par l'auteur dans le MP de fermeture. */
  const noter = async (tk, note, commentaire, qui = LEA) => {
    const mp = `96${qui.slice(2)}`;
    await k.interaction({ type: 3, locale: 'fr', channel_id: mp, user: { id: qui, username: 'auteur' }, data: { custom_id: `tk:n:${tk.id}:${note}`, component_type: 2 } });
    if (commentaire !== undefined) await k.interaction({ type: 5, locale: 'fr', channel_id: mp, user: { id: qui, username: 'auteur' }, data: { custom_id: `tk:nc:${tk.id}:${note}`, components: [{ type: 1, components: [{ type: 4, custom_id: 'commentaire', value: commentaire }] }] } });
  };
  const cmd = (sous, options = {}, { qui = KAI, roles = [STAFF], salon, locale = 'fr' } = {}) =>
    k.interaction({ type: 2, locale, guild_id: k.GUILD, channel_id: salon, member: membre(qui, roles), data: { name: 'ticket', options: [{ type: 1, name: sous, options: Object.entries(options).map(([name, value]) => ({ name, value })) }] } });
  const clic = (custom_id, { qui = KAI, roles = [STAFF], salon, locale = 'fr' }) => k.interaction({ type: 3, locale, guild_id: k.GUILD, channel_id: salon, member: membre(qui, roles), data: { custom_id, component_type: 2 } });
  const ticket = id => k.b.base.premier('SELECT * FROM tickets WHERE id = ?', [id]);
  const lier = (compte, discordId) => k.b.base.executer('INSERT INTO discord_comptes (compte_id, discord_user_id, discord_nom, super_admin, lie_le) VALUES (?, ?, ?, 0, ?)', [compte, discordId, compte, '2026-01-01T00:00:00.000Z']);
  return { k, recrue, chef, config, A, B, ouvrir, fermer, noter, cmd, clic, ticket, lier };
}

test('avis : liste filtrée par les catégories qu’on gère, moyenne, nombre, répartition, filtres, tri ; avis dans la vue du ticket', async () => {
  const p = await preparer();
  const a1 = await p.ouvrir(p.A);
  await p.k.api(`/tickets/${a1.id}/prendre`, p.recrue.jeton, { methode: 'POST', corps: {} });
  await p.fermer(a1);
  await p.noter(a1, 5, 'Réponse rapide, merci');
  p.k.b.horloge.t += 60_000;
  const a2 = await p.ouvrir(p.A, BOB);
  await p.fermer(a2);
  await p.noter(a2, 2, undefined, BOB);
  p.k.b.horloge.t += 60_000;
  const b1 = await p.ouvrir(p.B, KAI);
  await p.k.api(`/tickets/${b1.id}/prendre`, p.chef.jeton, { methode: 'POST', corps: {} });
  await p.fermer(b1);
  await p.noter(b1, 4, 'Bien', KAI);
  // Ticket fermé sans note : absent des avis.
  const sans = await p.ouvrir(p.B, NOE);
  await p.fermer(sans);

  // Fondateur et tickets.gerer : tout.
  const tout = await p.k.api('/tickets/avis');
  assert.equal(tout.statut, 200, JSON.stringify(tout.corps));
  assert.equal(tout.corps.total, 3);
  assert.deepEqual(tout.corps.repartition, [0, 1, 0, 1, 1]);
  assert.ok(Math.abs(tout.corps.moyenne - 11 / 3) < 1e-9);
  assert.deepEqual(tout.corps.avis.map(x => x.numero), [b1.numero, a2.numero, a1.numero], 'du plus récent au plus ancien');
  const premier = tout.corps.avis.find(x => x.numero === a1.numero);
  assert.equal(premier.commentaire, 'Réponse rapide, merci');
  assert.equal(premier.auteur, 'Membre 001');
  assert.equal(premier.responsable.nom, 'Recrue');
  assert.equal(premier.categorie.id, p.A);
  assert.equal(premier.ticketId, a1.id);
  assert.equal(premier.anonyme, false);
  assert.equal((await p.k.api('/tickets/avis', p.chef.jeton)).corps.total, 3);

  // tickets.configurer : seulement les catégories de ses rôles (A) ; tickets.repondre seul : refusé.
  const conf = await p.k.api('/tickets/avis', p.config.jeton);
  assert.equal(conf.statut, 200);
  assert.deepEqual(conf.corps.avis.map(x => x.numero).sort(), [a1.numero, a2.numero].sort());
  assert.deepEqual(conf.corps.categories.map(c => c.id), [p.A]);
  assert.equal((await p.k.api(`/tickets/avis?categorie=${p.B}`, p.config.jeton)).corps.total, 0, 'catégorie non gérée demandée : rien');
  assert.equal((await p.k.api('/tickets/avis', p.recrue.jeton)).statut, 403);
  const sansDroit = await p.k.b.session('sans1234', 'Sans');
  assert.equal((await p.k.api('/tickets/avis', sansDroit)).statut, 404);

  // Filtres : catégorie, note (la répartition garde les cinq notes), responsable, période ; tri par note.
  assert.equal((await p.k.api(`/tickets/avis?categorie=${p.B}`)).corps.total, 1);
  const cinq = (await p.k.api('/tickets/avis?note=5')).corps;
  assert.deepEqual(cinq.avis.map(x => x.numero), [a1.numero]);
  assert.deepEqual(cinq.repartition, [0, 1, 0, 1, 1]);
  const quiRecrue = tout.corps.responsables.find(r => r.nom === 'Recrue');
  assert.ok(quiRecrue, JSON.stringify(tout.corps.responsables));
  const parRecrue = (await p.k.api(`/tickets/avis?responsable=${encodeURIComponent(quiRecrue.cle)}`)).corps;
  assert.deepEqual([parRecrue.total, parRecrue.moyenne], [1, 5]);
  const jour = new Date(p.k.b.horloge.t).toISOString().slice(0, 10);
  assert.equal((await p.k.api(`/tickets/avis?du=${jour}&au=${jour}`)).corps.total, 3);
  assert.equal((await p.k.api('/tickets/avis?au=2020-01-01')).corps.total, 0);
  assert.deepEqual((await p.k.api('/tickets/avis?tri=note_bas')).corps.avis.map(x => x.note), [2, 4, 5]);
  assert.deepEqual((await p.k.api('/tickets/avis?tri=note_haut')).corps.avis.map(x => x.note), [5, 4, 2]);

  // La vue du ticket fermé montre la note, le commentaire et sa date.
  const d = (await p.k.api(`/tickets/${a1.id}`, p.chef.jeton)).corps;
  assert.deepEqual([d.note, d.noteCommentaire, Boolean(d.noteLe)], [5, 'Réponse rapide, merci', true]);
  assert.equal(d.droits.supprimer, true);
  assert.equal((await p.k.api(`/tickets/${a1.id}`, p.recrue.jeton)).corps.droits.supprimer, false);
});

test('suppression depuis l’app : ticket fermé seulement, permission, salon Discord, pièces, avis gardé anonyme, numéro jamais réutilisé, journal', async () => {
  const p = await preparer();
  const tk = await p.ouvrir(p.A);
  const salon = tk.salon_id;
  // Une pièce jointe envoyée depuis l'app (copiée dans le stockage) et une note interne.
  const r = await p.k.api(`/tickets/${tk.id}/messages`, p.recrue.jeton, { methode: 'POST', corps: { texte: 'Voici le règlement', pieces: [{ nom: 'regles.pdf', type: 'application/pdf', base64: Buffer.from('%PDF-1.4 test').toString('base64') }] } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  await p.k.api(`/tickets/${tk.id}/notes`, p.recrue.jeton, { methode: 'POST', corps: { texte: 'Note interne secrète' } });
  const piece = await p.k.b.base.premier('SELECT cle_stockage FROM tickets_pieces WHERE ticket_id = ?', [tk.id]);
  assert.ok(piece?.cle_stockage && (await p.k.b.stockage.lire(piece.cle_stockage)), 'pièce copiée');

  // Ticket ouvert : refusé (409) ; sans la permission : 403 ; catégorie non visible : 404.
  assert.equal((await p.k.api(`/tickets/${tk.id}/supprimer`, p.chef.jeton, { methode: 'POST', corps: {} })).statut, 409);
  await p.fermer(tk);
  await p.noter(tk, 3, 'Correct');
  assert.equal((await p.k.api(`/tickets/${tk.id}/supprimer`, p.recrue.jeton, { methode: 'POST', corps: {} })).statut, 403);
  const parte = await p.k.compteAvec('part1234', 'Parte', ['tickets.voir', 'tickets.configurer']);
  assert.equal((await p.k.api(`/tickets/${tk.id}/supprimer`, parte.jeton, { methode: 'POST', corps: {} })).statut, 404, 'catégorie qu’il ne voit pas');

  const avant = p.k.discord.appels.length;
  const s = await p.k.api(`/tickets/${tk.id}/supprimer`, p.chef.jeton, { methode: 'POST', corps: {} });
  assert.equal(s.statut, 200, JSON.stringify(s.corps));
  assert.deepEqual(s.corps, { ok: true, numero: tk.numero });
  assert.ok(p.k.discord.appels.slice(avant).some(a => a.methode === 'DELETE' && a.chemin === `/channels/${salon}`), 'salon archivé supprimé');
  assert.equal(p.k.discord.etat.salons.has(salon), false);
  assert.ok(!(await p.ticket(tk.id)));
  for (const table of ['tickets_messages', 'tickets_pieces', 'tickets_membres', 'tickets_lectures']) assert.equal(Number((await p.k.b.base.premier(`SELECT COUNT(*) AS n FROM ${table} WHERE ticket_id = ?`, [tk.id])).n), 0, table);
  assert.equal(await p.k.b.stockage.lire(piece.cle_stockage), null, 'octets de la pièce effacés');
  assert.equal((await p.k.api(`/tickets/${tk.id}`, p.chef.jeton)).statut, 404);

  // Avis gardé, anonyme : compté dans les avis et les statistiques, sans lien ni auteur.
  const anon = await p.k.b.base.tous('SELECT * FROM tickets_avis_anonymes', []);
  assert.equal(anon.length, 1);
  assert.deepEqual([Number(anon[0].note), anon[0].commentaire, anon[0].categorie_id], [3, 'Correct', p.A]);
  assert.ok(!JSON.stringify(anon[0]).includes(LEA) && !JSON.stringify(anon[0]).includes(tk.id), 'aucun lien vers le ticket ni l’auteur');
  const av = (await p.k.api('/tickets/avis', p.chef.jeton)).corps;
  assert.equal(av.total, 1);
  assert.deepEqual([av.avis[0].anonyme, av.avis[0].numero, av.avis[0].ticketId, av.avis[0].auteur, av.avis[0].commentaire], [true, null, null, null, 'Correct']);
  assert.equal((await p.k.api('/tickets/avis', p.config.jeton)).corps.total, 1, 'catégorie de ses rôles : il voit l’avis anonyme');
  const st = (await p.k.api('/tickets/stats', p.chef.jeton)).corps;
  assert.deepEqual([st.total.satisfaction, st.total.notes], [3, 1]);

  // Journal : qui a supprimé quel numéro, jamais le contenu ; message dans le salon des journaux.
  const ev = await p.k.b.base.premier("SELECT * FROM evenements WHERE type = 'ticket.supprime'", []);
  assert.ok(ev);
  assert.equal(ev.acteur_id, 'chef1234');
  const charge = JSON.parse(ev.charge);
  assert.equal(charge.numero, tk.numero);
  assert.equal(charge.avisGarde, true);
  assert.ok(!/règlement|secrète|Correct/.test(ev.charge), 'aucun contenu dans le journal');
  assert.match(p.k.discord.etat.messages.get(JOURNAUX).at(-1).embeds[0].description, new RegExp(`n° ${tk.numero} supprimé définitivement`));

  // Numéro jamais réutilisé, même si c'était le dernier.
  const suivant = await p.ouvrir(p.A, BOB);
  assert.equal(suivant.numero, tk.numero + 1);
});

test('suppression : avis supprimé aussi, salon déjà supprimé sur Discord (404 ignoré), autre échec journalisé ; suppression groupée', async () => {
  const p = await preparer();
  const t1 = await p.ouvrir(p.A);
  await p.fermer(t1);
  await p.noter(t1, 1, 'Bof');
  // Le salon a disparu sur Discord : DELETE → 404, ignoré.
  p.k.discord.etat.salons.delete(t1.salon_id);
  const s = await p.k.api(`/tickets/${t1.id}/supprimer`, p.k.fondateur, { methode: 'POST', corps: { garderAvis: false } });
  assert.equal(s.statut, 200, JSON.stringify(s.corps));
  assert.ok(!(await p.ticket(t1.id)));
  assert.equal(Number((await p.k.b.base.premier('SELECT COUNT(*) AS n FROM tickets_avis_anonymes', [])).n), 0, 'avis supprimé');
  assert.equal((await p.k.api('/tickets/avis')).corps.total, 0);
  assert.equal(JSON.parse((await p.k.b.base.premier("SELECT charge FROM evenements WHERE type = 'ticket.supprime'", [])).charge).avisGarde, false);

  // Discord refuse (403) : la suppression est faite quand même, l'échec journalisé (sans contenu).
  const t2 = await p.ouvrir(p.A, BOB);
  await p.fermer(t2);
  p.k.discord.programme.push({ si: (m, c) => m === 'DELETE' && c === `/channels/${t2.salon_id}`, statut: 403, corps: { code: 50013 } });
  const erreurs = [];
  const avant = console.error;
  console.error = (...a) => erreurs.push(a.join(' '));
  try {
    assert.equal((await p.k.api(`/tickets/${t2.id}/supprimer`, p.k.fondateur, { methode: 'POST', corps: {} })).statut, 200);
  } finally {
    console.error = avant;
  }
  assert.ok(!(await p.ticket(t2.id)));
  assert.ok(erreurs.some(e => e.includes(`ticket ${t2.numero}`) && e.includes('403')), erreurs.join('\n'));

  // Groupée : les fermés sont supprimés, l'ouvert est refusé ; 50 au plus ; tickets.repondre : refusé.
  const t3 = await p.ouvrir(p.B, KAI);
  const t4 = await p.ouvrir(p.B, NOE);
  const t5 = await p.ouvrir(p.A, LEA);
  await p.fermer(t3);
  await p.fermer(t4);
  assert.equal((await p.k.api('/tickets/supprimer', p.recrue.jeton, { methode: 'POST', corps: { ids: [t3.id] } })).statut, 403);
  assert.equal((await p.k.api('/tickets/supprimer', p.chef.jeton, { methode: 'POST', corps: { ids: [] } })).statut, 400);
  const g = await p.k.api('/tickets/supprimer', p.chef.jeton, { methode: 'POST', corps: { ids: [t3.id, t4.id, t5.id] } });
  assert.equal(g.statut, 200, JSON.stringify(g.corps));
  assert.deepEqual(g.corps.supprimes.sort(), [t3.numero, t4.numero].sort());
  assert.deepEqual(g.corps.echecs.map(e => [e.id, e.code]), [[t5.id, 'ticket-supprimer_pas_ferme']]);
  assert.ok(await p.ticket(t5.id));
  // tickets.configurer : seulement les catégories de ses rôles.
  const t6 = await p.ouvrir(p.B, BOB);
  await p.fermer(t6);
  const c = await p.k.api('/tickets/supprimer', p.config.jeton, { methode: 'POST', corps: { ids: [t6.id] } });
  assert.deepEqual([c.corps.supprimes, c.corps.echecs[0].code], [[], 'ticket']);
  assert.ok(await p.ticket(t6.id));
});

test('/ticket supprimer : ticket fermé, compte lié qui gère, confirmation, salon supprimé après la réponse ; désactivable ; FR / EN', async () => {
  const p = await preparer();
  const tk = await p.ouvrir(p.A);
  const salon = tk.salon_id;
  // Ouvert : refusé ; ailleurs que dans un ticket : refusé.
  assert.match((await p.cmd('supprimer', {}, { salon: '710000000000000013' })).corps.data.content, /salon d’un ticket/);
  await p.lier('chef1234', KAI);
  assert.match((await p.cmd('supprimer', {}, { salon })).corps.data.content, /Seul un ticket fermé peut être supprimé/);
  await p.fermer(tk);
  await p.noter(tk, 4, 'Merci');
  // Rôle Discord du staff sans compte lié qui gère : refusé (c'est irréversible).
  assert.match((await p.cmd('supprimer', {}, { qui: NOE, salon })).corps.data.content, /compte Esport lié/);
  await p.lier('recr1234', NOE);
  assert.match((await p.cmd('supprimer', {}, { qui: NOE, salon })).corps.data.content, /compte Esport lié/, 'tickets.repondre ne suffit pas');

  // Confirmation éphémère, puis clic : avis gardé par défaut.
  const conf = await p.cmd('supprimer', {}, { salon });
  assert.equal(conf.corps.data.flags, 64);
  assert.match(conf.corps.data.content, /DÉFINITIVEMENT le ticket n° \d+/);
  assert.match(conf.corps.data.content, /gardé, anonyme/);
  const bouton = conf.corps.data.components[0].components[0];
  assert.equal(bouton.custom_id, `tk:dc:${tk.id}:g`);
  assert.equal(bouton.style, 4);
  assert.ok(await p.ticket(tk.id), 'rien de supprimé avant la confirmation');
  // Option « supprimer aussi l'avis » : autre bouton ; réponse en anglais.
  const en = await p.cmd('supprimer', { avis: 'supprimer' }, { salon, locale: 'en-US' });
  assert.match(en.corps.data.content, /PERMANENTLY delete ticket #\d+/);
  assert.match(en.corps.data.content, /deleted too/);
  assert.equal(en.corps.data.components[0].components[0].custom_id, `tk:dc:${tk.id}:s`);

  // Commande désactivée : le clic sur la confirmation aussi est refusé.
  await p.k.api('/tickets/config/commandes', undefined, { methode: 'PUT', corps: { supprimer: { actif: false } } });
  assert.match((await p.cmd('supprimer', {}, { salon })).corps.data.content, /désactivée/);
  assert.match((await p.clic(`tk:dc:${tk.id}:g`, { salon })).corps.data.content, /désactivée/);
  // Réservée à un rôle.
  await p.k.api('/tickets/config/commandes', undefined, { methode: 'PUT', corps: { supprimer: { actif: true, roles: [AUTRE_ROLE] } } });
  assert.match((await p.cmd('supprimer', {}, { salon })).corps.data.content, /rôle nécessaire/);
  assert.ok(await p.ticket(tk.id));

  const fait = await p.clic(`tk:dc:${tk.id}:g`, { salon, roles: [STAFF, AUTRE_ROLE] });
  assert.match(fait.corps.data.content, new RegExp(`Ticket n° ${tk.numero} supprimé`));
  assert.equal(fait.corps.apres, undefined, 'le travail d’après n’est jamais envoyé à Discord');
  assert.ok(!(await p.ticket(tk.id)));
  assert.equal(p.k.discord.etat.salons.has(salon), false, 'salon supprimé après la réponse');
  const anon = await p.k.b.base.tous('SELECT note, commentaire FROM tickets_avis_anonymes', []);
  assert.deepEqual(anon.map(a => [Number(a.note), a.commentaire]), [[4, 'Merci']]);
  const ev = await p.k.b.base.premier("SELECT acteur_id, charge FROM evenements WHERE type = 'ticket.supprime'", []);
  assert.equal(ev.acteur_id, 'chef1234');
  // Déjà supprimé : le bouton ne fait plus rien.
  assert.match((await p.clic(`tk:dc:${tk.id}:g`, { salon, roles: [STAFF, AUTRE_ROLE] })).corps.data.content, /salon d’un ticket/);
  const conf2 = (await p.k.api('/tickets/config')).corps;
  assert.ok(conf2.choix.commandes.includes('supprimer') && conf2.choix.commandesStaff.includes('supprimer'));
});
