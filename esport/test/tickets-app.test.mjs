/**
 * Tickets, étape 3 : les tickets dans l'app. Visibilité PAR CATÉGORIE (rôles de l'app ; 404 pour une catégorie qu'on ne
 * traite pas, temps réel revérifié par la même route), non lus et compteur, réponse depuis l'app (le bot poste « Staff ·
 * pseudo : … », mentions neutralisées, pièce jointe), notes internes JAMAIS envoyées sur Discord, actions et droits
 * (repondre / gerer), notification au responsable, transcript, lien signé d'une pièce (droit revérifié), liaisons,
 * statistiques.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc } from './aide.mjs';
import { bancTickets } from './tickets-aide.mjs';
import { ingererMessage } from '../noyau/tickets/conversation.mjs';
import { MOTIF_SUJET, publicationsDe } from '../noyau/temps-reel/regles.mjs';

const OUVERTS = '710000000000000010';
const LEA = '800000000000000001';
const BOB = '800000000000000002';

async function preparer() {
  const k = await bancTickets({ banc });
  await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { guildId: k.GUILD, categorieOuverts: OUVERTS, categorieArchives: '710000000000000011', actif: true } });
  const recrue = await k.compteAvec('recr1234', 'Recrue', ['tickets.repondre']);
  const parte = await k.compteAvec('part1234', 'Parte', ['tickets.voir']);
  const chef = await k.compteAvec('chef1234', 'Chef', ['tickets.gerer']);
  const cat = async (nom, roleId, extra = {}) => (await k.api('/tickets/config/categories', undefined, { methode: 'POST', corps: { nom: { fr: nom, en: nom }, rolesApp: [`club:${roleId}`], ...extra } })).corps.id;
  const A = await cat('Recrutement', recrue.roleId);
  const B = await cat('Partenariat', parte.roleId, { liaison: { type: 'sponsors' } });
  const ouvrir = async (categorie, qui = LEA) => {
    const r = await k.interaction({ type: 3, locale: 'fr', guild_id: k.GUILD, channel_id: '710000000000000013', member: { user: { id: qui, username: `u${qui.slice(-3)}`, global_name: qui === LEA ? 'Léa' : 'Bob' }, roles: [], permissions: '0' }, data: { custom_id: `tk:o:${categorie}`, component_type: 2 } });
    assert.match(r.corps.data.content, /Ticket créé/, JSON.stringify(r.corps));
    return k.b.base.premier('SELECT * FROM tickets ORDER BY numero DESC LIMIT 1', []);
  };
  const ecrit = (tk, qui, contenu, extra = {}) => ingererMessage({ base: k.b.base, maintenant: () => k.b.horloge.t, botId: k.APP, stockage: k.b.stockage, reglages: { copierPieces: true, pieceMaxMo: 8 }, telecharger: async () => ({ octets: new Uint8Array([1, 2, 3]), type: 'image/png' }), surNouveau: k.b.traiter.ticketsCycle.surNouveau }, { ...k.discord.posterUtilisateur(tk.salon_id, qui, contenu, { timestamp: new Date(k.b.horloge.t).toISOString(), ...extra }) });
  return { k, recrue, parte, chef, A, B, ouvrir, ecrit };
}

test('visibilité par catégorie : liste filtrée, 404 hors de ses catégories ; gerer et Fondateur voient tout', async () => {
  const p = await preparer();
  const ta = await p.ouvrir(p.A);
  const tb = await p.ouvrir(p.B, BOB);
  const ids = async jeton => (await p.k.api('/tickets', jeton)).corps.tickets.map(t => t.numero).sort();
  assert.deepEqual(await ids(p.recrue.jeton), [ta.numero]);
  assert.deepEqual(await ids(p.parte.jeton), [tb.numero]);
  assert.deepEqual(await ids(p.chef.jeton), [ta.numero, tb.numero]);
  assert.deepEqual(await ids(p.k.fondateur), [ta.numero, tb.numero]);
  assert.equal((await p.k.api(`/tickets/${tb.id}`, p.recrue.jeton)).statut, 404, 'catégorie non traitée : comme inexistant');
  assert.equal((await p.k.api(`/tickets/${tb.id}/notes`, p.recrue.jeton, { methode: 'POST', corps: { texte: 'x' } })).statut, 404);
  const sans = await p.k.b.session('sans1234', 'Sans');
  assert.equal((await p.k.api('/tickets', sans)).statut, 404);
  // Filtres : catégorie, recherche par numéro et par texte.
  assert.equal((await p.k.api(`/tickets?categorie=${p.B}`, p.chef.jeton)).corps.tickets.length, 1);
  assert.equal((await p.k.api(`/tickets?q=%23${ta.numero}`, p.chef.jeton)).corps.tickets[0].id, ta.id);
  await p.ecrit(ta, LEA, 'mot-clé introuvable ailleurs');
  assert.equal((await p.k.api('/tickets?q=introuvable', p.chef.jeton)).corps.tickets[0].id, ta.id);
  // Temps réel : sujet connu ; une écriture sur un ticket est revérifiée par GET /tickets/:id au nom de chacun.
  assert.ok(MOTIF_SUJET.test('tickets'));
  const pub = publicationsDe('POST', `/tickets/${ta.id}/messages`, { compte: 'x' });
  assert.deepEqual(pub.map(x => [x.sujet, x.cle, x.sonde]), [['tickets', `ticket:${ta.id}`, `/tickets/${ta.id}`]]);
  assert.deepEqual(publicationsDe('POST', `/tickets/${ta.id}/lu`, { compte: 'x' }), [], '« lu » reste personnel');
});

test('réponse depuis l’app : « Staff · pseudo : … », mentions neutralisées, pièce jointe ; notes internes jamais sur Discord', async () => {
  const p = await preparer();
  const tk = await p.ouvrir(p.A);
  const avant = p.k.discord.appels.length;
  const note = await p.k.api(`/tickets/${tk.id}/notes`, p.recrue.jeton, { methode: 'POST', corps: { texte: 'Profil douteux, vérifier son historique' } });
  assert.equal(note.statut, 200, JSON.stringify(note.corps));
  assert.equal(p.k.discord.appels.length, avant, 'aucun appel à Discord pour une note interne');
  assert.ok(note.corps.messages.some(m => m.genre === 'note' && m.contenu.startsWith('Profil douteux')));
  p.k.b.horloge.t += 1000;
  const r = await p.k.api(`/tickets/${tk.id}/messages`, p.recrue.jeton, { methode: 'POST', corps: { texte: 'Bonjour @everyone <@123>', pieces: [{ nom: 'regles.pdf', type: 'application/pdf', base64: Buffer.from('%PDF-1.4 test').toString('base64') }] } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  const post = p.k.discord.appels.filter(a => a.methode === 'POST' && a.chemin === `/channels/${tk.salon_id}/messages`).at(-1);
  assert.equal(post.corps.multipart, true, 'pièce jointe envoyée');
  assert.match(post.corps.content, /^\*\*Staff · Recrue\*\* : Bonjour @​everyone <​@123>$/);
  assert.deepEqual(post.corps.allowed_mentions, { parse: [] });
  const m = r.corps.messages.find(x => x.genre === 'app');
  assert.equal(m.genre, 'app');
  assert.equal(m.pieces[0].nom, 'regles.pdf');
  // Aucune note interne n'est jamais partie : contenu absent de tout ce qui a été envoyé à Discord.
  assert.ok(!JSON.stringify(p.k.discord.appels).includes('Profil douteux'));
  // Pièce : lien signé (5 min), droit revérifié à la lecture.
  const lien = await p.k.api(`/tickets/${tk.id}/pieces/${m.pieces[0].id}/lien`, p.recrue.jeton, { methode: 'POST' });
  const fichier = await p.k.b.brut(lien.corps.url);
  assert.equal(fichier.status, 200);
  assert.equal(await fichier.text(), '%PDF-1.4 test');
  await p.k.b.base.executer("DELETE FROM roles_globaux_affectations WHERE compte_id = 'recr1234'", []);
  assert.equal((await p.k.b.brut(lien.corps.url)).status, 403, 'droit retiré : le lien ne vaut plus rien');
  // Ticket fermé : plus de réponse.
  await p.k.api(`/tickets/${tk.id}/fermer`, p.k.fondateur, { methode: 'POST', corps: { raison: 'fini' } });
  assert.equal((await p.k.api(`/tickets/${tk.id}/messages`, p.k.fondateur, { methode: 'POST', corps: { texte: 'encore' } })).statut, 409);
});

test('non lus et compteur ; responsable prévenu (une notification tant qu’elle n’est pas lue) ; actions et droits', async () => {
  const p = await preparer();
  const tk = await p.ouvrir(p.A);
  assert.equal((await p.k.api('/tickets/compteur', p.recrue.jeton)).corps.nonLus, 0, 'l’accueil du bot ne compte pas');
  await p.ecrit(tk, LEA, 'Vous êtes là ?');
  assert.equal((await p.k.api('/tickets/compteur', p.recrue.jeton)).corps.nonLus, 1);
  assert.equal((await p.k.api('/tickets', p.recrue.jeton)).corps.tickets[0].nonLu, true);
  await p.k.api(`/tickets/${tk.id}/lu`, p.recrue.jeton, { methode: 'POST' });
  assert.equal((await p.k.api('/tickets/compteur', p.recrue.jeton)).corps.nonLus, 0);
  // Prise en charge depuis l'app ; le responsable est prévenu des messages de l'auteur.
  const pris = await p.k.api(`/tickets/${tk.id}/prendre`, p.recrue.jeton, { methode: 'POST' });
  assert.equal(pris.corps.statut, 'pris_en_charge');
  assert.equal(pris.corps.responsable.moi, true);
  await p.ecrit(tk, LEA, 'Premier');
  await p.ecrit(tk, LEA, 'Second');
  const notifs = await p.k.b.base.tous("SELECT * FROM notifications WHERE compte_id = 'recr1234' AND type = 'tk-message'", []);
  assert.equal(notifs.length, 1, 'une seule tant qu’elle n’est pas lue');
  const centre = async () => JSON.stringify((await p.k.api('/notifications/centre', p.recrue.jeton)).corps);
  assert.ok((await centre()).includes('tk-message'));
  // Droits : repondre ne peut ni assigner ni changer de catégorie ; gerer le peut.
  assert.equal((await p.k.api(`/tickets/${tk.id}/assigner`, p.recrue.jeton, { methode: 'POST', corps: { compte: 'chef1234' } })).statut, 403);
  assert.equal((await p.k.api(`/tickets/${tk.id}/categorie`, p.recrue.jeton, { methode: 'POST', corps: { categorie: p.B } })).statut, 403);
  assert.equal((await p.k.api(`/tickets/${tk.id}/transcript`, p.recrue.jeton)).statut, 403);
  assert.equal((await p.k.api(`/tickets/${tk.id}/assigner`, p.chef.jeton, { methode: 'POST', corps: { compte: 'part1234' } })).statut, 400, 'Parte ne traite pas cette catégorie');
  const a = await p.k.api(`/tickets/${tk.id}/assignables`, p.chef.jeton);
  assert.ok(a.corps.comptes.some(c => c.compte === 'recr1234'));
  assert.equal((await p.k.api(`/tickets/${tk.id}/priorite`, p.recrue.jeton, { methode: 'POST', corps: { priorite: 'urgent' } })).corps.priorite, 'urgent');
  const ajout = await p.k.api(`/tickets/${tk.id}/ajouter`, p.chef.jeton, { methode: 'POST', corps: { discordId: BOB, nom: 'Bob' } });
  assert.equal(ajout.corps.membres[0].discordId, BOB);
  // Transfert : la catégorie change, le ticket sort de la vue de la Recrue.
  const tr = await p.k.api(`/tickets/${tk.id}/categorie`, p.chef.jeton, { methode: 'POST', corps: { categorie: p.B } });
  assert.equal(tr.corps.categorie.id, p.B);
  assert.equal((await p.k.api(`/tickets/${tk.id}`, p.recrue.jeton)).statut, 404);
  assert.equal((await p.k.api(`/tickets/${tk.id}`, p.parte.jeton)).statut, 200);
  // Fermer et rouvrir depuis l'app.
  const f = await p.k.api(`/tickets/${tk.id}/fermer`, p.chef.jeton, { methode: 'POST', corps: { raison: 'ok' } });
  assert.equal(f.corps.statut, 'ferme');
  assert.equal((await p.k.api(`/tickets/${tk.id}/rouvrir`, p.chef.jeton, { methode: 'POST' })).corps.statut, 'pris_en_charge');
  // Rôle retiré : la Recrue ne voit plus la catégorie, ses notifications de tickets disparaissent du centre.
  await p.k.b.base.executer("DELETE FROM roles_globaux_affectations WHERE compte_id = 'recr1234'", []);
  assert.ok(!(await centre()).includes('tk-message'));
  assert.equal((await p.k.api('/tickets', p.recrue.jeton)).statut, 404);
});

test('transcript (notes comprises, HTML échappé) ; liaisons (prospect Sponsors, fiche) ; statistiques', async () => {
  const p = await preparer();
  const tk = await p.ouvrir(p.B, BOB);
  await p.ecrit(tk, BOB, '<script>alert(1)</script> Partenariat ?');
  await p.k.api(`/tickets/${tk.id}/notes`, p.chef.jeton, { methode: 'POST', corps: { texte: 'Budget 5k' } });
  const tr = await p.k.api(`/tickets/${tk.id}/transcript`, p.chef.jeton);
  assert.equal(tr.statut, 200);
  assert.match(tr.corps.nom, /^ticket-0001\.html$/);
  assert.ok(tr.corps.contenu.includes('&lt;script&gt;'), 'échappé');
  assert.ok(!tr.corps.contenu.includes('<script>alert'));
  assert.ok(tr.corps.contenu.includes('Budget 5k'), 'notes internes dans le transcript du staff');
  // Liaison Sponsors : créée avec les droits de l'acteur (Fondateur : sponsors.gerer).
  assert.equal((await p.k.api(`/tickets/${tk.id}/liaison`, p.chef.jeton, { methode: 'POST', corps: { type: 'sponsors' } })).statut, 404, 'pas de droit Sponsors : la rubrique n’existe pas pour lui');
  const l = await p.k.api(`/tickets/${tk.id}/liaison`, p.k.fondateur, { methode: 'POST', corps: { type: 'sponsors', nom: 'Marque X' } });
  assert.equal(l.statut, 200, JSON.stringify(l.corps));
  assert.equal(l.corps.liaison.type, 'sponsors');
  assert.ok(await p.k.b.base.premier('SELECT id FROM sp_prospects WHERE nom = ?', ['Marque X']));
  assert.equal((await p.k.api(`/tickets/${tk.id}/liaison`, p.k.fondateur, { methode: 'POST', corps: { type: 'fiche' } })).statut, 400, 'auteur sans compte lié');
  // Statistiques (gerer) : par catégorie, délai de 1re réponse, satisfaction.
  await p.k.api(`/tickets/${tk.id}/messages`, p.chef.jeton, { methode: 'POST', corps: { texte: 'Bonjour' } });
  await p.k.api(`/tickets/${tk.id}/fermer`, p.chef.jeton, { methode: 'POST', corps: {} });
  await p.k.interaction({ type: 3, locale: 'fr', channel_id: '960000000000000001', user: { id: BOB, username: 'bob' }, data: { custom_id: `tk:n:${tk.id}:5`, component_type: 2 } });
  const s = await p.k.api('/tickets/stats', p.chef.jeton);
  assert.equal(s.statut, 200);
  assert.equal(s.corps.total.crees, 1);
  assert.equal(s.corps.total.fermes, 1);
  assert.equal(s.corps.total.satisfaction, 5);
  assert.equal(s.corps.parCategorie[0].categorie.id, p.B);
  assert.ok(s.corps.parResponsable.length === 0 || s.corps.parResponsable[0].nom);
  assert.equal((await p.k.api('/tickets/stats', p.recrue.jeton)).statut, 403);
  // Préférences de MP (par compte).
  assert.deepEqual((await p.k.api('/tickets/preferences', p.recrue.jeton, { methode: 'PUT', corps: { mpNouveau: true, mpMessage: false } })).corps, { mpNouveau: true, mpMessage: false });
});
