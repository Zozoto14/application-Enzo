/**
 * Tickets, étape 1 : configuration dans l'app (Tickets › Configuration) : permissions du club (404 sans droit, 403
 * sans tickets.configurer), réglages généraux, messages, horaires, commandes, catégories (formulaire limité à 5
 * champs, rôles Discord et de l'app), panneaux (aperçu = charge réelle, publication puis mise à jour du même message,
 * image du Drive), liste noire, lecture du serveur Discord et permissions du bot (ce qui manque), état de la
 * connexion, interactions des tickets sans compte lié, export / import.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc } from './aide.mjs';
import { bancTickets } from './tickets-aide.mjs';
import { baseMigree } from './base.mjs';
import { exporterBase, importerBase } from '../noyau/transfert.mjs';
import { bilingue, messageBilingue, ordreLangues } from '../noyau/tickets/textes.mjs';
import { chargePanneau, nomSalon } from '../noyau/tickets/panneaux.mjs';
import { dansHoraires } from '../noyau/tickets/reglages.mjs';
import { permissionsMembre, manquantes } from '../noyau/tickets/discord.mjs';

const CAT_OUVERTS = '710000000000000010';

test('textes bilingues : la langue de la personne d’abord, l’autre en citation ; modes réglables', () => {
  const textes = { fr: 'Bonjour', en: 'Hello' };
  assert.equal(bilingue(textes, { mode: 'auteur', langue: 'fr' }), 'Bonjour\n\n> Hello');
  assert.equal(bilingue(textes, { mode: 'auteur', langue: 'en' }), 'Hello\n\n> Bonjour');
  assert.equal(bilingue(textes, { mode: 'en_fr', langue: 'fr' }), 'Hello\n\n> Bonjour');
  assert.equal(bilingue(textes, { mode: 'fr' }), 'Bonjour');
  assert.deepEqual(ordreLangues('fr_en', 'en'), ['fr', 'en']);
  // Message personnalisé vide : texte par défaut ; variables remplies dans les deux langues.
  const m = messageBilingue({ prise_en_charge: { fr: '{staff} s’en occupe', en: '' } }, 'prise_en_charge', { staff: 'Kai' }, { mode: 'auteur', langue: 'fr' });
  assert.equal(m, 'Kai s’en occupe\n\n> Kai is now handling your ticket.');
});

test('noms de salon, horaires du support, permissions effectives du bot', () => {
  assert.equal(nomSalon('ticket-{numero}-{pseudo}', { numero: 7, pseudo: 'Léa <@1> Été!' }), 'ticket-0007-lea-1-ete');
  const h = { actif: true, fuseau: 'Europe/Paris', plages: [{ jour: 3, debut: '09:00', fin: '18:00' }] };
  assert.equal(dansHoraires(h, Date.parse('2026-11-04T10:00:00Z')), true, 'mercredi 11 h à Paris');
  assert.equal(dansHoraires(h, Date.parse('2026-11-04T20:00:00Z')), false, 'mercredi 21 h');
  assert.equal(dansHoraires({ actif: false }, 0), true);
  const roles = [{ id: 'g', permissions: String(1n << 10n) }, { id: 'r', permissions: String((1n << 11n) | (1n << 16n)) }];
  const salon = { permission_overwrites: [{ id: 'g', type: 0, deny: String(1n << 10n), allow: '0' }] };
  assert.deepEqual(manquantes(permissionsMembre({ guildId: 'g', roles, membreRoles: ['r'] })), ['gerer_salons', 'gerer_roles', 'joindre', 'integrer']);
  assert.ok(manquantes(permissionsMembre({ guildId: 'g', roles, membreRoles: ['r'], salon })).includes('voir_salons'), 'surcharge du salon appliquée');
});

test('accès : 404 sans permission ; tickets.voir sans configurer → 403 sur la configuration ; Fondateur : tout', async () => {
  const k = await bancTickets({ banc });
  const sans = await k.b.session('sans1234', 'Sans');
  assert.equal((await k.api('/tickets/config', sans)).statut, 404);
  assert.equal((await k.api('/tickets/moi', sans)).corps.voir, false);
  const voir = await k.compteAvec('voir1234', 'Voir', ['tickets.voir']);
  assert.equal((await k.api('/tickets/config', voir.jeton)).statut, 403);
  assert.equal((await k.api('/tickets/etat', voir.jeton)).statut, 200);
  const conf = await k.compteAvec('conf1234', 'Conf', ['tickets.configurer']);
  assert.equal((await k.api('/tickets/config', conf.jeton)).statut, 200);
  const moi = (await k.api('/tickets/moi', conf.jeton)).corps;
  assert.equal(moi.configurer, true);
  assert.equal(moi.voir, false, 'configurer n’ouvre aucun ticket');
  const f = (await k.api('/tickets/moi')).corps;
  assert.deepEqual([f.voir, f.repondre, f.gerer, f.configurer], [true, true, true, true]);
});

test('réglages : général (activation contrôlée), messages, horaires, commandes ; validations', async () => {
  const k = await bancTickets({ banc });
  const r0 = await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { actif: true } });
  assert.equal(r0.statut, 400, 'pas d’activation sans serveur ni catégorie Discord');
  const r = await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { guildId: k.GUILD, categorieOuverts: CAT_OUVERTS, categorieArchives: '710000000000000011', salonJournaux: '710000000000000012', langue: 'en_fr', fermetureAutoH: 72, actif: true } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.general.fermetureAutoH, 72);
  assert.equal(r.corps.general.avertissementH, 24, 'avertissement 24 h avant par défaut');
  assert.equal((await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { langue: 'klingon' } })).statut, 400);
  assert.equal((await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { guildId: '@everyone' } })).statut, 400);
  const m = await k.api('/tickets/config/messages', undefined, { methode: 'PUT', corps: { accueil: { fr: 'Salut {utilisateur}', en: 'Hi {utilisateur}' } } });
  assert.equal(m.corps.messages.accueil.fr, 'Salut {utilisateur}');
  assert.ok(m.corps.messagesDefaut.fermeture.en);
  const h = await k.api('/tickets/config/horaires', undefined, { methode: 'PUT', corps: { actif: true, fuseau: 'Europe/Paris', plages: [{ jour: 1, debut: '09:00', fin: '18:00' }] } });
  assert.equal(h.corps.horaires.plages.length, 1);
  assert.equal((await k.api('/tickets/config/horaires', undefined, { methode: 'PUT', corps: { plages: [{ jour: 1, debut: '18:00', fin: '09:00' }] } })).statut, 400);
  const c = await k.api('/tickets/config/commandes', undefined, { methode: 'PUT', corps: { stats: { actif: false }, panneau: { actif: true, roles: ['720000000000000001'] } } });
  assert.equal(c.corps.commandes.stats.actif, false);
  assert.deepEqual(c.corps.commandes.panneau.roles, ['720000000000000001']);
  assert.equal(c.corps.commandes.ouvrir.actif, true, 'les autres restent actives');
});

test('catégories : création, formulaire (5 champs au plus), rôles, liaison, ordre, suppression', async () => {
  const k = await bancTickets({ banc });
  const sup = await k.compteAvec('supp1234', 'Support', ['tickets.voir']);
  const champs = n => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, libelle: { fr: `Question ${i}`, en: `Question ${i}` }, style: i ? 'long' : 'court', requis: i === 0, placeholder: { fr: 'ex.', en: 'e.g.' } }));
  const a = await k.api('/tickets/config/categories', undefined, { methode: 'POST', corps: { nom: { fr: 'Recrutement', en: 'Recruitment' }, description: { fr: 'Rejoindre le club', en: 'Join the club' }, icone: 'membres', couleur: '#22aa66', formulaire: champs(3), rolesDiscord: ['720000000000000001'], rolesApp: [`club:${sup.roleId}`], prioriteDefaut: 'faible', modeleNom: 'recrutement-{numero}-{pseudo}', maxOuverts: 2, fermetureAutoH: 48, liaison: { type: 'fiche' } } });
  assert.equal(a.statut, 200, JSON.stringify(a.corps));
  const cat = a.corps.categories[0];
  assert.equal(cat.formulaire.length, 3);
  assert.equal(cat.formulaire[1].style, 'long');
  assert.deepEqual(cat.rolesApp, [`club:${sup.roleId}`]);
  assert.equal((await k.api('/tickets/config/categories', undefined, { methode: 'POST', corps: { nom: { fr: 'Trop' }, formulaire: champs(6) } })).statut, 400, 'limite des fenêtres Discord');
  assert.equal((await k.api('/tickets/config/categories', undefined, { methode: 'POST', corps: { nom: { fr: 'X' }, rolesApp: ['club:inconnu'] } })).statut, 400);
  assert.equal((await k.api('/tickets/config/categories', undefined, { methode: 'POST', corps: { nom: { fr: 'X' }, modeleNom: 'sans-numero' } })).statut, 400);
  assert.equal((await k.api('/tickets/config/categories', undefined, { methode: 'POST', corps: { nom: { fr: 'X' }, liaison: { type: 'cm', tableauId: 'nope' } } })).statut, 400);
  const b2 = await k.api('/tickets/config/categories', undefined, { methode: 'POST', corps: { nom: { fr: 'Partenariat', en: 'Partnership' }, liaison: { type: 'sponsors' } } });
  const ids = b2.corps.categories.map(c => c.id);
  const o = await k.api('/tickets/config/categories/ordre', undefined, { methode: 'PUT', corps: { ordre: [...ids].reverse() } });
  assert.equal(o.corps.categories[0].nom.fr, 'Partenariat');
  const p = await k.api(`/tickets/config/categories/${cat.id}`, undefined, { methode: 'PATCH', corps: { actif: false, accueil: { fr: 'Bienvenue', en: 'Welcome' } } });
  assert.equal(p.corps.categories.find(c => c.id === cat.id).actif, false);
  const d = await k.api(`/tickets/config/categories/${cat.id}`, undefined, { methode: 'DELETE' });
  assert.equal(d.corps.categories.length, 1);
});

test('panneaux : aperçu = charge réelle ; publication puis mise à jour du MÊME message ; liste noire', async () => {
  const k = await bancTickets({ banc });
  await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { guildId: k.GUILD, categorieOuverts: CAT_OUVERTS, actif: true, langue: 'auteur' } });
  const cats = [];
  for (const nom of ['Aide', 'Recrutement']) cats.push((await k.api('/tickets/config/categories', undefined, { methode: 'POST', corps: { nom: { fr: nom, en: `${nom} EN` }, description: { fr: 'd', en: 'd' } } })).corps.id);
  const p = await k.api('/tickets/config/panneaux', undefined, { methode: 'POST', corps: { titre: { fr: 'Support du club', en: 'Club support' }, texte: { fr: 'Ouvrez un ticket', en: 'Open a ticket' }, style: 'boutons', categories: cats, salonId: '710000000000000013' } });
  assert.equal(p.statut, 200, JSON.stringify(p.corps));
  const ap = (await k.api(`/tickets/config/panneaux/${p.corps.id}/apercu`)).corps.charge;
  assert.equal(ap.components[0].components.length, 2);
  assert.equal(ap.components[0].components[0].custom_id, `tk:o:${cats[0]}`);
  assert.equal(ap.components[0].components[0].label, 'Aide EN · Aide', 'panneau public : anglais puis français');
  assert.deepEqual(ap.allowed_mentions, { parse: [] });
  const pub = await k.api(`/tickets/config/panneaux/${p.corps.id}/publier`, undefined, { methode: 'POST' });
  assert.equal(pub.statut, 200, JSON.stringify(pub.corps));
  assert.ok(pub.corps.messageId);
  const post = k.discord.appels.filter(a => a.methode === 'POST' && a.chemin === '/channels/710000000000000013/messages');
  assert.equal(post.length, 1);
  // Menu déroulant, puis republication : le même message est modifié (PATCH), rien de nouveau n'est posté.
  await k.api(`/tickets/config/panneaux/${p.corps.id}`, undefined, { methode: 'PATCH', corps: { style: 'menu' } });
  const pub2 = await k.api(`/tickets/config/panneaux/${p.corps.id}/publier`, undefined, { methode: 'POST' });
  assert.equal(pub2.corps.messageId, pub.corps.messageId);
  const patch = k.discord.appels.find(a => a.methode === 'PATCH' && a.chemin === `/channels/710000000000000013/messages/${pub.corps.messageId}`);
  assert.equal(patch.corps.components[0].components[0].type, 3, 'menu déroulant');
  assert.equal(patch.corps.components[0].components[0].options.length, 2);
  // Discord refuse (permissions) : erreur claire, gardée sur le panneau.
  k.discord.programme.push({ si: m => m === 'PATCH', statut: 403, corps: { code: 50013 } });
  assert.equal((await k.api(`/tickets/config/panneaux/${p.corps.id}/publier`, undefined, { methode: 'POST' })).corps.code, 'panneau-permissions');
  // Liste noire.
  assert.equal((await k.api('/tickets/config/liste-noire', undefined, { methode: 'POST', corps: { discordId: '800000000000000666', nom: 'Troll', raison: 'spam' } })).statut, 200);
  assert.equal((await k.api('/tickets/config/liste-noire', undefined, { methode: 'POST', corps: { discordId: 'pas-un-id' } })).statut, 400);
  assert.equal((await k.api('/tickets/config')).corps.listeNoire[0].nom, 'Troll');
  await k.api('/tickets/config/liste-noire/800000000000000666', undefined, { methode: 'DELETE' });
  assert.equal((await k.api('/tickets/config')).corps.listeNoire.length, 0);
});

test('serveur Discord : choix du serveur, salons, rôles, permissions du bot et ce qui manque', async () => {
  const k = await bancTickets({ banc });
  const avant = (await k.api('/tickets/config/discord')).corps;
  assert.deepEqual(avant.serveurs, [{ id: k.GUILD, nom: 'Club' }]);
  await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { guildId: k.GUILD, categorieOuverts: CAT_OUVERTS, salonJournaux: '710000000000000012' } });
  const d = (await k.api('/tickets/config/discord')).corps;
  assert.ok(d.salons.some(s => s.id === CAT_OUVERTS && s.type === 'categorie'));
  assert.ok(d.roles.some(r => r.nom === 'Staff'));
  assert.ok(!d.roles.some(r => r.nom === 'Esport HQ'), 'le rôle géré du bot n’est pas proposé');
  assert.deepEqual(d.permissions.serveur, [], 'le bot a tout au niveau du serveur');
  // Le salon des journaux refuse « voir » au bot : signalé.
  k.discord.etat.salons.get('710000000000000012').permission_overwrites = [{ id: '720000000000000002', type: 0, deny: String(1n << 10n), allow: '0' }];
  const d2 = (await k.api('/tickets/config/discord')).corps;
  assert.ok(d2.permissions.journaux.manquantes.includes('voir_salons'));
});

test('interactions des tickets : sans compte lié, réponse éphémère ; autre serveur refusé ; état de connexion', async () => {
  const k = await bancTickets({ banc });
  const clic = guild => k.interaction({ type: 3, locale: 'fr', guild_id: guild, channel_id: '710000000000000013', member: { user: { id: '800000000000000001', username: 'lea' }, roles: [] }, data: { custom_id: 'tk:o:x', component_type: 2 } });
  const r0 = await clic(k.GUILD);
  assert.equal(r0.corps.data.flags, 64);
  assert.match(r0.corps.data.content, /pas encore configurés/);
  await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { guildId: k.GUILD, categorieOuverts: CAT_OUVERTS, actif: true } });
  const r1 = await clic('700000000000000099');
  assert.match(r1.corps.data.content, /serveur du club/);
  const etat = (await k.api('/tickets/etat')).corps;
  assert.equal(etat.actif, true);
  assert.equal(etat.connexion.mode, 'hors_ligne', 'aucun processus ne tient encore la Gateway');
});

test('export / import : les tables des tickets suivent', async () => {
  const k = await bancTickets({ banc });
  await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { guildId: k.GUILD, categorieOuverts: CAT_OUVERTS } });
  await k.api('/tickets/config/categories', undefined, { methode: 'POST', corps: { nom: { fr: 'Aide', en: 'Help' } } });
  const exp = await exporterBase(k.b.base, k.b.horloge.t);
  for (const t of ['tickets_reglages', 'tickets_categories', 'tickets_panneaux', 'tickets_liste_noire', 'tickets', 'tickets_messages', 'tickets_pieces', 'tickets_membres', 'tickets_lectures']) assert.ok(t in exp.tables, t);
  assert.equal(exp.tables.tickets_categories.length, 1);
  const neuve = await baseMigree();
  await importerBase(neuve, exp);
  assert.equal((await neuve.tous('SELECT * FROM tickets_categories', [])).length, 1);
});

test('charge de panneau : catégories inactives écartées, 25 au plus, mentions impossibles', () => {
  const cats = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, actif: i !== 0, nom: { fr: `F${i}`, en: `E${i}` }, description: { fr: '', en: '' } }));
  const c = chargePanneau({ titre: { fr: 'T', en: 'T' }, texte: { fr: '@everyone', en: '' }, couleur: '#ffffff', style: 'boutons' }, cats, { mode: 'fr' });
  assert.equal(c.components.flatMap(r => r.components).length, 25);
  assert.ok(!c.components.flatMap(r => r.components).some(b => b.custom_id === 'tk:o:c0'));
  assert.ok(c.components.every(r => r.components.length <= 5));
  assert.deepEqual(c.allowed_mentions, { parse: [] });
});
