/**
 * Administration › Bot Esport HQ (GET|POST /bot-discord…) : droits (Fondateur, tickets.configurer ; 404 sinon), état
 * sans aucun secret, lien d'invitation calculé depuis la liste CENTRALE des permissions (annonces + tickets, et les
 * fonctionnalités à venir), lignes des teams selon discord.manage, vérification du serveur (ce qui manque, par
 * fonctionnalité), commandes enregistrées comparées à celles attendues et réenregistrement (même appel que le
 * script). Faux Discord REST, jamais de réseau réel. SQLite, et PostgreSQL avec ESPORT_TEST_PG.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { bancTickets } from './tickets-aide.mjs';
import { BITS, FONCTIONNALITES_PERMISSIONS, entierPermissions, lienInvitationBot, manquantesParFonctionnalite, permissionsInvitation } from '../noyau/discord/permissions-bot.mjs';
import { comparerCommandes, definitionsCommandes } from '../noyau/discord/bot/commandes.mjs';
import { appelsDiscord } from '../outils/discord-commandes.mjs';

const JETON = 'jeton-bot-de-test-jamais-reel';

/** Commandes telles que Discord les rend (champs en plus, `required: false` omis…). */
const commeDiscord = defs =>
  defs.map((c, i) => ({
    id: `80000000000000000${i}`,
    application_id: '424242424242424242',
    version: '1',
    nsfw: false,
    dm_permission: true,
    ...JSON.parse(JSON.stringify(c, (k, v) => (k === 'required' && v === false ? undefined : v))),
    default_member_permissions: c.default_member_permissions ?? null,
  }));

test('permissions du bot : une liste centrale ; l’invitation demande l’union de toutes les fonctionnalités', () => {
  const annonces = entierPermissions(FONCTIONNALITES_PERMISSIONS.find(f => f.id === 'annonces').permissions);
  assert.equal(annonces, 309237861376n, 'annonces : inchangé (bot-discord.md)');
  const tout = permissionsInvitation();
  for (const f of FONCTIONNALITES_PERMISSIONS) for (const p of f.permissions) assert.equal(tout & BITS[p], BITS[p], `${f.id} : ${p}`);
  // Une fonctionnalité de plus (salons vocaux…) : son entrée suffit, le lien la demande aussitôt.
  const avecVocaux = [...FONCTIONNALITES_PERMISSIONS, { id: 'vocaux', permissions: ['connecter', 'deplacer_membres', 'gerer_salons'] }];
  assert.equal(permissionsInvitation(avecVocaux), tout | BITS.connecter | BITS.deplacer_membres);
  assert.match(lienInvitationBot('424242424242424242', avecVocaux), new RegExp(`permissions=${tout | BITS.connecter | BITS.deplacer_membres}$`));
  assert.equal(lienInvitationBot('abc'), null);
  assert.throws(() => entierPermissions(['inconnue']), /inconnue/);
  const m = manquantesParFonctionnalite(BITS.voir_salons | BITS.envoyer);
  assert.deepEqual(m.find(f => f.id === 'annonces').manquantes, ['integrer', 'historique', 'mentionner', 'creer_fils_publics', 'envoyer_fils']);
});

test('commandes : comparaison avec ce que Discord rend ; le script et le bouton envoient le même appel', () => {
  const attendues = definitionsCommandes();
  assert.deepEqual(comparerCommandes(commeDiscord(attendues)), { aJour: true, manquantes: [], enTrop: [], differentes: [] });
  const lues = commeDiscord(attendues).filter(c => c.name !== 'aide');
  lues.find(c => c.name === 'ticket').options[0].description = 'Ancienne description';
  lues.push({ id: '1', type: 1, name: 'ancienne', description: 'x' });
  assert.deepEqual(comparerCommandes(lues), { aJour: false, manquantes: ['aide'], enTrop: ['ancienne'], differentes: ['ticket'] });
  assert.equal(comparerCommandes([]).manquantes.length, attendues.length);
  const [appel] = appelsDiscord({ applicationId: '424242424242424242', identite: {} });
  assert.deepEqual(appel, { methode: 'PUT', chemin: '/applications/424242424242424242/commands', corps: attendues, quoi: 'commandes' });
});

test('état : Fondateur et tickets.configurer seulement ; aucun secret ; invitation complète ; teams selon discord.manage', async () => {
  const k = await bancTickets({ banc });
  const alpha = await teamAvecMembres(k.b, { nom: 'Team Alpha', membres: { max12345: { pseudo: 'Max', role: 'manager' }, lea12345: { pseudo: 'Léa', role: 'joueur' } } });
  await teamAvecMembres(k.b, { nom: 'Team Bravo' });
  const r = await k.api('/bot-discord');
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  const e = r.corps;
  assert.equal(JSON.stringify(e).includes(JETON), false, 'jamais le jeton');
  assert.deepEqual(e.bot, { configure: true, applicationId: k.APP, clePublique: true, jeton: true });
  assert.equal(e.fondateur, true);
  assert.equal(e.permissions.entier, permissionsInvitation().toString());
  assert.deepEqual(e.permissions.fonctionnalites.map(f => f.id), ['annonces', 'tickets']);
  assert.equal(e.invitation, `https://discord.com/oauth2/authorize?client_id=${k.APP}&scope=bot%20applications.commands&permissions=${permissionsInvitation()}`);
  // Même lien partout : Tickets › Configuration et Discord d'une team.
  assert.equal((await k.api('/tickets/config')).corps.lienInvitation, e.invitation);
  assert.equal(e.serveur, null);
  assert.equal(e.tickets.actif, false);
  assert.equal(e.tickets.connexion.mode, 'hors_ligne');
  assert.equal(e.tickets.diagnostic.bot, true);
  assert.equal(e.tickets.commandes.ouvrir.actif, true);
  assert.deepEqual(e.teams.map(t => t.nom), ['Team Alpha', 'Team Bravo']);
  const ta = e.teams.find(t => t.id === alpha.teamId);
  assert.deepEqual([ta.moduleActif, ta.webhook, ta.serveurBot, ta.filFr, ta.relancesMp], [true, null, null, false, true]);
  assert.ok(e.commandes.some(c => c.nom === 'ticket' && c.sousCommandes.some(s => s.nom === 'ouvrir')));
  assert.equal(e.commandes.find(c => c.nom === 'esport-lier-serveur').admin, true);
  assert.equal(e.commandes.find(c => c.nom === 'lier').partout, true);
  assert.equal(e.commandes.find(c => c.nom === 'aide').description, 'Ce que sait faire le bot Esport', 'langue de l’app (français)');

  // Le serveur Discord du club : celui des tickets (une seule source).
  await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { guildId: k.GUILD, guildNom: 'Club' } });
  assert.deepEqual((await k.api('/bot-discord')).corps.serveur, { id: k.GUILD, nom: 'Club' });

  // tickets.configurer : la page, avec les teams où il a discord.manage seulement (Max est Manager d'Alpha).
  const conf = await k.compteAvec('max12345', 'Max', ['tickets.configurer']);
  const ec = (await k.api('/bot-discord', conf.jeton)).corps;
  assert.equal(ec.fondateur, false);
  assert.deepEqual(ec.teams.map(t => t.nom), ['Team Alpha']);
  // tickets.voir seul, Joueur, compte sans droit : 404 sur toute la rubrique.
  const voir = await k.compteAvec('voir1234', 'Voir', ['tickets.voir']);
  for (const jeton of [voir.jeton, alpha.sessions.lea12345, await k.b.session('rien1234', 'Rien')]) {
    for (const [chemin, methode] of [['/bot-discord', 'GET'], ['/bot-discord/serveur', 'GET'], ['/bot-discord/commandes', 'GET'], ['/bot-discord/commandes', 'POST']]) {
      assert.equal((await k.api(chemin, jeton, { methode })).statut, 404, `${chemin} ${methode}`);
    }
  }
  assert.equal(k.discord.appels.filter(a => a.chemin.includes('/commands')).length, 0, 'aucun appel à Discord pour un refus');
});

test('vérifier le serveur : ce qui manque au bot, par fonctionnalité ; bot absent ; sans serveur choisi', async () => {
  const k = await bancTickets({ banc });
  assert.deepEqual((await k.api('/bot-discord/serveur')).corps, { bot: true, serveur: null });
  await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { guildId: k.GUILD, guildNom: 'Club' } });
  const v = (await k.api('/bot-discord/serveur')).corps;
  assert.equal(v.erreur, null);
  assert.equal(v.membreTrouve, true);
  assert.equal(v.complet, false);
  // Rôle du bot du faux Discord : gérer les salons et les rôles, voir, envoyer, intégrer, joindre, historique.
  assert.deepEqual(v.fonctionnalites, [
    { id: 'annonces', manquantes: ['mentionner', 'creer_fils_publics', 'envoyer_fils'] },
    { id: 'tickets', manquantes: ['reactions', 'creer_fils_prives', 'creer_fils_publics', 'envoyer_fils'] },
  ]);
  // Bot retiré du serveur.
  k.discord.programme.push({ si: (m, c) => c === '/users/@me/guilds', statut: 200, corps: [] });
  assert.equal((await k.api('/bot-discord/serveur')).corps.erreur, 'bot-absent');
});

test('commandes : à jour, à réenregistrer (différences nommées), réenregistrement par le même appel que le script', async () => {
  const k = await bancTickets({ banc });
  const chemin = `/applications/${k.APP}/commands`;
  // Rien d'enregistré chez Discord : toutes manquent.
  k.discord.programme.push({ si: (m, c) => m === 'GET' && c === chemin, statut: 200, corps: [] });
  const vide = (await k.api('/bot-discord/commandes')).corps;
  assert.equal(vide.aJour, false);
  assert.equal(vide.manquantes.length, definitionsCommandes().length);
  const lecture = k.discord.appels.find(a => a.chemin === chemin);
  assert.match(lecture.url, /with_localizations=true/);
  // Ancienne liste (une commande en moins, une description changée) : différences nommées.
  const anciennes = commeDiscord(definitionsCommandes()).filter(c => c.name !== 'tickets');
  anciennes.find(c => c.name === 'planning').description = 'Old';
  k.discord.programme.push({ si: (m, c) => m === 'GET' && c === chemin, statut: 200, corps: anciennes });
  const d = (await k.api('/bot-discord/commandes')).corps;
  assert.deepEqual([d.aJour, d.manquantes, d.differentes, d.enTrop], [false, ['tickets'], ['planning'], []]);
  // Réenregistrer : PUT de toute la liste (comme discord-commandes.mjs), puis relecture.
  k.discord.programme.push({ si: (m, c) => m === 'PUT' && c === chemin, statut: 200, corps: commeDiscord(definitionsCommandes()) });
  k.discord.programme.push({ si: (m, c) => m === 'GET' && c === chemin, statut: 200, corps: commeDiscord(definitionsCommandes()) });
  const conf = await k.compteAvec('conf1234', 'Conf', ['tickets.configurer']);
  const r = await k.api('/bot-discord/commandes', conf.jeton, { methode: 'POST' });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.deepEqual([r.corps.ok, r.corps.n, r.corps.aJour], [true, definitionsCommandes().length, true]);
  const put = k.discord.appels.find(a => a.methode === 'PUT' && a.chemin === chemin);
  assert.deepEqual(put.corps, appelsDiscord({ applicationId: k.APP, identite: {} })[0].corps);
  assert.equal(put.entetes.Authorization, `Bot ${JETON}`);
  // Discord refuse : erreur lisible, sans le jeton.
  k.discord.programme.push({ si: (m, c) => m === 'PUT' && c === chemin, statut: 401, corps: { code: 0, message: '401: Unauthorized' } });
  const refus = await k.api('/bot-discord/commandes', undefined, { methode: 'POST' });
  assert.equal(refus.statut, 502);
  assert.equal(JSON.stringify(refus.corps).includes(JETON), false);
});

test('sans bot configuré : état lisible, commandes non lues, réenregistrement refusé (503)', async () => {
  const b = await banc();
  const f = await b.session('principal', 'Fondateur');
  const e = (await b.appel('/bot-discord', { jeton: f })).corps;
  assert.deepEqual(e.bot, { configure: false, applicationId: null, clePublique: false, jeton: false });
  assert.equal(e.invitation, null);
  assert.deepEqual((await b.appel('/bot-discord/serveur', { jeton: f })).corps, { bot: false });
  const c = (await b.appel('/bot-discord/commandes', { jeton: f })).corps;
  assert.deepEqual([c.bot, c.enregistrees], [false, null]);
  assert.equal((await b.appel('/bot-discord/commandes', { methode: 'POST', jeton: f })).statut, 503);
});
