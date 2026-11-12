/**
 * Salons de match Discord des événements liés à un tournoi du site LigneZero (evenements-club/salons-match.mjs,
 * migration 0073) : réglages, création (salon privé, accès des rôles des équipes — lobby à 3 équipes —, du staff et du
 * bot), embed et mentions, équipe sans rôle signalée au staff, mise à jour (embed modifié + « Mise à jour »), rappel 10 min
 * une seule fois, résultat puis suppression après le délai avec historique enregistré, match supprimé du site, aucun
 * doublon (passages simultanés, redémarrage, salon déjà créé retrouvé), suppression manuelle, historique réservé,
 * fin et suppression de l'événement, cron et passage rapide, export et effacement RGPD. Faux site et faux Discord : jamais de réseau réel.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fauxDiscordRest, fauxGateway } from './tickets-aide.mjs';
import { baseMigree } from './base.mjs';
import { creerSuperviseurTickets } from '../noyau/tickets/superviseur.mjs';
import { tachesPlanifiees } from '../noyau/cron.mjs';
import { DROITS_EQUIPE, DROITS_STAFF, creerSalonsMatch, lireReglages, nomSalon, validerReglages } from '../noyau/evenements-club/salons-match.mjs';
import { TABLES } from '../noyau/transfert.mjs';
import { effacementParDiscord } from '../noyau/tickets/rgpd.mjs';
import { distribuer } from '../noyau/evenements.mjs';

import { T1, EA, EB, EC, ED, M1, L1, CAT, CAP_A, J_A, CAP_B, CAP_C, STAFF, SILENCE, fauxSite, monter, salonsCrees, messagesDe, lignes, synchro, activer } from './salons-match-aide.mjs';

test('réglages : défauts, bornes, nom de salon nettoyé', () => {
  assert.deepEqual(lireReglages(null).delaiSuppressionMin, 30);
  assert.equal(lireReglages('{"delaiSuppressionMin":99999}').delaiSuppressionMin, 1440);
  assert.throws(() => validerReglages({ delaiSuppressionMin: 4 }), e => e.code === 'salons-match-delai');
  assert.throws(() => validerReglages({ delaiSuppressionMin: 1441 }), e => e.code === 'salons-match-delai');
  assert.throws(() => validerReglages({ actif: true }), e => e.code === 'salons-match-categorie');
  assert.throws(() => validerReglages({ langue: 'de' }), e => e.code === 'salons-match-langue');
  assert.equal(validerReglages({ actif: true, categorieId: CAT, delaiSuppressionMin: 5 }).delaiSuppressionMin, 5);
  assert.equal(nomSalon('{round}-{equipes}', { round: 'r1', equipes: 'ALP-vs-BRV' }), 'r1-alp-vs-brv');
  assert.equal(nomSalon('{phase} {match} : Été !!', { phase: 'Poule A', match: 'm2' }), 'poule-a-m2-ete');
  assert.equal(nomSalon('@everyone', {}), 'everyone');
  assert.equal(nomSalon('???', {}), 'match');
  assert.ok(nomSalon('x'.repeat(300), {}).length <= 100);
});

test('création : salon privé par match (lobby à 3 équipes compris), accès, embed, mentions ; aucun doublon', async () => {
  const k = await monter();
  const v = await activer(k);
  assert.ok(v.categories.some(c => c.id === CAT && c.nom === 'Matchs'));
  assert.equal(salonsCrees(k).length, 2, 'un salon pour le match, un pour le lobby');
  const [lm, ll] = [...(await lignes(k))].sort((a, b) => a.site_match_id.localeCompare(b.site_match_id)).reverse();
  assert.equal(lm.site_match_id, `m:${M1}`);
  assert.equal(ll.site_match_id, `l:${L1}`);
  assert.equal(lm.statut, 'ouvert');
  const salonM = k.discord.etat.salons.get(lm.salon_id);
  const salonL = k.discord.etat.salons.get(ll.salon_id);
  assert.equal(salonM.type, 0);
  assert.equal(salonM.parent_id, CAT);
  assert.equal(salonM.name, 'r1-alp-vs-brv');
  assert.equal(salonL.name, 'r1-alp-brv-cha');
  // Accès : @everyone refusé, chaque rôle d'équipe du match, rôle staff (gérer les messages en plus), bot.
  const o = id => salonL.permission_overwrites.find(x => x.id === id);
  assert.equal(o(k.GUILD).deny, String(1n << 10n));
  for (const tag of ['ALP', 'BRV', 'CHA']) assert.equal(o(k.roles[tag]).allow, DROITS_EQUIPE, tag);
  assert.equal(o(k.staffRole).allow, DROITS_STAFF);
  assert.equal(o(k.APP).type, 1);
  assert.equal(salonM.permission_overwrites.find(x => x.id === k.roles.CHA), undefined, 'Charlie ne joue pas le match 1v1');
  // Message : mentions des rôles et des capitaines, embed avec horaire Discord (absolu et relatif), joueurs mentionnés.
  const [accueil] = messagesDe(k, lm.salon_id);
  assert.match(accueil.content, new RegExp(`<@&${k.roles.ALP}>`));
  assert.match(accueil.content, new RegExp(`<@${CAP_A}>`));
  // Rôles des équipes non mentionnables (créés ainsi par l'app) et bot sans « Mentionner @everyone » : les joueurs sont
  // mentionnés un par un, sinon personne n'était notifié.
  assert.deepEqual(accueil.allowed_mentions.users.sort(), [CAP_A, J_A, CAP_B].sort());
  assert.deepEqual(accueil.allowed_mentions.parse, []);
  assert.ok(accueil.allowed_mentions.roles.includes(k.roles.ALP));
  assert.match(accueil.content, new RegExp(`<@${J_A}>`));
  // Envoi par la file : nonce Discord (jamais de doublon), message envoyé noté.
  assert.equal(typeof accueil.nonce, 'string');
  assert.equal(accueil.enforce_nonce, true);
  const ts = Date.parse('2026-10-20T12:00:00.000Z') / 1000;
  assert.match(accueil.embeds[0].description, new RegExp(`<t:${ts}:F> \\(<t:${ts}:R>\\)`));
  assert.ok(accueil.embeds[0].fields.some(f => f.name === '[ALP] Alpha' && f.value.includes(`<@${J_A}>`) && f.value.includes('(capitaine)')));
  assert.equal(lm.message_id, accueil.id);
  // Nouveaux passages : rien de plus.
  await synchro(k);
  await synchro(k);
  assert.equal(salonsCrees(k).length, 2);
  // Deux processus en même temps (deux services sur la même base) : toujours un seul salon par match.
  k.site.tables.tournament_matches.push({ ...k.site.tables.tournament_matches[0], id: '44444444-4444-4444-8444-000000000002', position: 2, scheduled_at: null });
  const deux = [1, 2].map(() => creerSalonsMatch({ base: k.b.base, site: k.site, fetch: k.discord.fetch, jetonBot: 'jeton-bot-de-test-jamais-reel', botId: k.APP, maintenant: () => k.b.horloge.t, journal: SILENCE }));
  await Promise.all([deux[0].synchroniser(k.id), deux[1].synchroniser(k.id)]);
  await deux[1].synchroniser(k.id);
  assert.equal(salonsCrees(k).length, 3);
  assert.equal((await lignes(k)).length, 3);
  // Liste dans l'app.
  const vue = (await k.api(k.sm)).corps;
  assert.equal(vue.salons.length, 3);
  assert.ok(vue.salons.every(s => s.lien?.startsWith(`https://discord.com/channels/${k.GUILD}/`)));
  assert.equal(vue.matchs.length, 0);
});

test('salon déjà créé par un passage interrompu : retrouvé par son sujet, pas recréé', async () => {
  const k = await monter();
  await k.api(k.sm, undefined, { methode: 'PUT', corps: { actif: false, categorieId: CAT } });
  // Processus arrêté net : la ligne est réservée, le salon existe sur Discord, l'identifiant n'a pas été noté.
  await k.b.base.executer("INSERT INTO club_salons_match (id, evenement_id, site_match_id, genre, titre, statut, cree_le, maj_le) VALUES ('orphelin-1', ?, ?, 'match', '', 'creation', '2026-10-20T10:00:00.000Z', '2026-10-20T10:00:00.000Z')", [k.id, `m:${M1}`]);
  k.discord.etat.salons.set('730000000000000001', { id: '730000000000000001', type: 0, name: 'r1-alp-vs-brv', parent_id: CAT, topic: `Round 1 · esport-hq:match:m:${M1} · ${k.id.slice(0, 8)}`, permission_overwrites: [] });
  await activer(k);
  const l = (await lignes(k)).find(x => x.site_match_id === `m:${M1}`);
  assert.equal(l.salon_id, '730000000000000001');
  assert.equal(salonsCrees(k).length, 1, 'seul le lobby est créé');
});

test('équipe sans rôle Discord : signalée dans l’embed, staff averti une fois', async () => {
  const k = await monter();
  await k.api(k.sm, undefined, { methode: 'PUT', corps: { actif: false, categorieId: CAT } });
  // Équipe ajoutée sur le site après le lien (pas encore dans l'événement) : aucun rôle.
  k.site.tables.tournament_teams.push({ id: ED, tournament_id: T1, name: 'Delta', tag: 'DLT' });
  k.site.tables.tournament_lobby_entries.push({ id: 'e4', lobby_id: L1, team_id: ED, placement: null, points: 0, dnf: false, sort_order: 3 });
  await activer(k);
  const ll = (await lignes(k)).find(x => x.site_match_id === `l:${L1}`);
  const msgs = messagesDe(k, ll.salon_id);
  assert.ok(msgs[0].embeds[0].fields.some(f => f.name === '[DLT] Delta' && /pas de rôle Discord/.test(f.value)));
  const alerte = msgs.find(m => /Attention staff/.test(m.content ?? ''));
  assert.ok(alerte, 'staff averti');
  assert.match(alerte.content, new RegExp(`<@&${k.staffRole}>`));
  assert.match(alerte.content, /\[DLT\] Delta/);
  await synchro(k);
  assert.equal(messagesDe(k, ll.salon_id).filter(m => /Attention staff/.test(m.content ?? '')).length, 1);
  // Les équipes reliées ont accès, Delta non (pas de rôle).
  assert.equal(k.discord.etat.salons.get(ll.salon_id).permission_overwrites.filter(o => o.allow === DROITS_EQUIPE).length, 3);
});

test('mise à jour : horaire et équipes changés → embed modifié, accès suivis, « Mise à jour » ; rappel 10 min avant une seule fois', async () => {
  const k = await monter();
  await activer(k);
  const lm = (await lignes(k)).find(x => x.site_match_id === `m:${M1}`);
  const avant = messagesDe(k, lm.salon_id).length;
  // Horaire avancé à 12h30, et Charlie remplace Bravo.
  Object.assign(k.site.tables.tournament_matches[0], { scheduled_at: '2026-10-20T12:30:00.000Z', team_b_id: EC });
  await synchro(k);
  const patch = k.discord.appels.filter(a => a.methode === 'PATCH' && a.chemin === `/channels/${lm.salon_id}/messages/${lm.message_id}`);
  assert.equal(patch.length, 1, 'embed modifié tout de suite');
  assert.match(patch[0].corps.embeds[0].description, new RegExp(`<t:${Date.parse('2026-10-20T12:30:00.000Z') / 1000}:F>`));
  // « Mise à jour » : regroupe les changements des 30 secondes (envoyée au passage suivant la fenêtre).
  assert.equal(messagesDe(k, lm.salon_id).length, avant);
  k.b.horloge.t += 31_000;
  await synchro(k);
  const msgs = messagesDe(k, lm.salon_id);
  assert.equal(msgs.length, avant + 1);
  assert.match(msgs.at(-1).content, /Mise à jour du match : horaire, équipes/);
  assert.match(msgs.at(-1).content, new RegExp(`<@${CAP_C}>`));
  const s = k.discord.etat.salons.get(lm.salon_id);
  assert.ok(s.permission_overwrites.some(o => o.id === k.roles.CHA));
  assert.ok(!s.permission_overwrites.some(o => o.id === k.roles.BRV), 'Bravo n’a plus accès');
  await synchro(k);
  assert.equal(messagesDe(k, lm.salon_id).length, avant + 1, 'rien de nouveau');

  // Rappel : seulement 10 minutes avant (une fois) ; aucun rappel 30 minutes avant.
  const rappels = () => messagesDe(k, lm.salon_id).filter(m => /Rappel/.test(m.content ?? '')).length;
  k.b.horloge.t = Date.parse('2026-10-20T12:03:00.000Z');
  await synchro(k);
  assert.equal(rappels(), 0, 'pas de rappel 30 minutes avant');
  k.b.horloge.t = Date.parse('2026-10-20T12:21:00.000Z');
  await synchro(k);
  assert.equal(rappels(), 1);
  await synchro(k);
  k.b.horloge.t = Date.parse('2026-10-20T12:25:00.000Z');
  await synchro(k);
  assert.equal(rappels(), 1, 'une seule fois');
  assert.match(messagesDe(k, lm.salon_id).filter(m => /Rappel/.test(m.content)).at(-1).content, /<t:\d+:R>/);
});

test('résultat → posté, suppression après le délai avec historique ; match supprimé du site → avis puis suppression', async () => {
  const k = await monter();
  await activer(k, { delaiSuppressionMin: 30 });
  const lig = async cle => (await lignes(k)).find(x => x.site_match_id === cle);
  const m = await lig(`m:${M1}`);
  // Un joueur écrit avec une pièce jointe, le staff complète.
  k.discord.posterUtilisateur(m.salon_id, CAP_A, 'Prêts !', { attachments: [{ id: '1', filename: 'lineup.png', size: 2048, url: 'https://cdn.discordapp.com/attachments/1/2/lineup.png' }] });
  k.discord.posterUtilisateur(m.salon_id, STAFF, 'Lobby code : 1234');
  Object.assign(k.site.tables.tournament_matches[0], { status: 'finished', score_a: 2, score_b: 1, winner_id: EA });
  await synchro(k);
  let l = await lig(`m:${M1}`);
  assert.equal(l.statut, 'termine');
  assert.equal(l.suppression_le, new Date(k.b.horloge.t + 30 * 60_000).toISOString());
  const res = messagesDe(k, m.salon_id).at(-1);
  assert.match(res.content, /Résultat enregistré/);
  assert.match(res.content, /sera supprimé <t:\d+:R>/);
  assert.match(res.embeds[0].description, /\[ALP\] Alpha \*\*2\*\*/);
  assert.match(res.embeds[0].description, /Vainqueur : \[ALP\] Alpha/);
  await synchro(k);
  assert.equal(messagesDe(k, m.salon_id).filter(x => /Résultat/.test(x.content ?? '')).length, 1, 'posté une fois');
  // Avant le délai : rien ; après : historique enregistré, salon supprimé.
  k.b.horloge.t += 29 * 60_000;
  await synchro(k);
  assert.ok(k.discord.etat.salons.has(m.salon_id));
  k.b.horloge.t += 2 * 60_000;
  await synchro(k);
  assert.ok(!k.discord.etat.salons.has(m.salon_id), 'salon supprimé');
  l = await lig(`m:${M1}`);
  assert.equal(l.statut, 'supprime');
  const h = await k.api(`${k.sm}/${l.id}/historique`);
  assert.equal(h.statut, 200, JSON.stringify(h.corps));
  const contenus = h.corps.messages.map(x => x.contenu);
  assert.ok(contenus.includes('Prêts !') && contenus.includes('Lobby code : 1234'));
  const piece = h.corps.messages.find(x => x.contenu === 'Prêts !').pieces[0];
  assert.deepEqual(piece, { nom: 'lineup.png', url: 'https://cdn.discordapp.com/attachments/1/2/lineup.png', taille: 2048 });
  assert.ok(h.corps.messages.some(x => x.bot && x.embeds.length), 'messages du bot (embeds en texte)');
  assert.equal(h.corps.salon.nbMessages, h.corps.messages.length);
  // Jamais recréé automatiquement.
  await synchro(k);
  assert.equal(salonsCrees(k).length, 2);
  // Historique : réservé (ni evenements.gerer, ni staff de l'événement).
  const autre = await k.compteAvec('voir1234', 'Voir', ['tickets.voir']);
  assert.equal((await k.api(`${k.sm}/${l.id}/historique`, autre.jeton)).statut, 403);
  assert.equal((await k.api(k.sm, autre.jeton)).statut, 403);

  // Lobby supprimé du site (« Supprimer le déroulé ») : avis, suppression programmée, puis faite.
  const lo = await lig(`l:${L1}`);
  k.site.tables.tournament_lobbies = [];
  k.site.tables.tournament_lobby_entries = [];
  await synchro(k);
  const annule = await lig(`l:${L1}`);
  assert.equal(annule.statut, 'annule');
  assert.match(messagesDe(k, lo.salon_id).at(-1).content, /supprimé ou annulé sur le site/);
  k.b.horloge.t += 31 * 60_000;
  await synchro(k);
  assert.ok(!k.discord.etat.salons.has(lo.salon_id));
  assert.equal((await lig(`l:${L1}`)).statut, 'supprime');
});

test('lobby de phase de groupes « terminé » sans aucun résultat (bouton Enregistrer du site) : salon créé ; diagnostic du passage', async () => {
  const k = await monter();
  await k.api(k.sm, undefined, { methode: 'PUT', corps: { actif: false, categorieId: CAT } });
  // Données réelles (bug du 12/11/2026, « The Nuke End ») : phase de groupes à 1 lobby, aucun match 1v1, « Lobby A »
  // marqué « finished » par « Enregistrer » sans placement (scores « - », 0 point), horaire à définir ; l'équipe « Test »
  // ajoutée sur le site après le lien (pas d'équipe de l'événement, donc aucun rôle Discord).
  const LA = '55555555-5555-4555-8555-00000000000a';
  const LB = '55555555-5555-4555-8555-00000000000b';
  const LC = '55555555-5555-4555-8555-00000000000c';
  const t = k.site.tables;
  t.tournament_stages = [{ id: '66666666-6666-4666-8666-000000000001', tournament_id: T1, kind: 'groups', name: 'Phase de groupes', sort_order: 0 }];
  t.tournament_matches = [];
  t.tournament_teams.push({ id: ED, tournament_id: T1, name: 'Test', tag: null });
  t.tournament_lobbies = [
    { id: LA, tournament_id: T1, round: 1, position: 1, label: 'Lobby A', status: 'finished', scheduled_at: null, stream_url: null },
    // Vrai résultat saisi : ignoré (terminé) ; une seule équipe : ignoré (moins de deux équipes).
    { id: LB, tournament_id: T1, round: 1, position: 2, label: 'Lobby B', status: 'finished', scheduled_at: null, stream_url: null },
    { id: LC, tournament_id: T1, round: 1, position: 3, label: 'Lobby C', status: 'pending', scheduled_at: null, stream_url: null },
  ];
  t.tournament_lobby_entries = [
    { id: 'e1', lobby_id: LA, team_id: EA, placement: null, points: 0, dnf: false, sort_order: 0 },
    { id: 'e2', lobby_id: LA, team_id: ED, placement: null, points: 0, dnf: false, sort_order: 1 },
    { id: 'e3', lobby_id: LB, team_id: EB, placement: 1, points: 12, dnf: false, sort_order: 0 },
    { id: 'e4', lobby_id: LB, team_id: EC, placement: 2, points: 8, dnf: false, sort_order: 1 },
    { id: 'e5', lobby_id: LC, team_id: EB, placement: null, points: 0, dnf: false, sort_order: 0 },
  ];
  const v = await activer(k);
  const ls = await lignes(k);
  assert.deepEqual(ls.map(l => l.site_match_id), [`l:${LA}`], 'seul le lobby A a son salon');
  const salon = k.discord.etat.salons.get(ls[0].salon_id);
  assert.equal(salon.name, 'r1-alp-test');
  // Équipe sans rôle : listée dans l'embed (pas d'accès), l'autre a accès.
  assert.ok(salon.permission_overwrites.some(o => o.id === k.roles.ALP && o.allow === DROITS_EQUIPE));
  const [accueil] = messagesDe(k, ls[0].salon_id);
  assert.match(accueil.embeds[0].title, /Lobby A · Round 1/);
  assert.match(accueil.embeds[0].description, /à venir/);
  assert.ok(accueil.embeds[0].fields.some(f => f.name === 'Test' && /pas de rôle Discord/.test(f.value)));
  // Diagnostic : lu sur le site, ignorés avec leur raison.
  const e = v.etat;
  assert.deepEqual(e.lus, { matchs: 0, lobbies: 3 });
  assert.equal(e.crees, 1);
  assert.deepEqual(e.ignores, { termine: 1, equipes: 1, delai: 0, ferme: 0 });
  assert.deepEqual(e.details.map(d => [d.titre, d.raison]), [['Lobby B · Round 1', 'termine'], ['Lobby C · Round 1', 'equipes']]);
  assert.equal(e.details[1].n, 1);
  assert.equal(e.arret, null);
  // Passage suivant : le salon est suivi, rien de plus.
  const v2 = await synchro(k);
  assert.equal(v2.etat.suivis, 1);
  assert.equal(salonsCrees(k).length, 1);
  // Création anticipée : hors délai signalé.
  t.tournament_lobby_entries.push({ id: 'e6', lobby_id: LC, team_id: EC, placement: null, points: 0, dnf: false, sort_order: 1 });
  t.tournament_lobbies[2].scheduled_at = '2026-10-25T12:00:00.000Z';
  const v3 = (await k.api(k.sm, undefined, { methode: 'PUT', corps: { avanceH: 2 } })).corps;
  assert.equal(v3.etat.ignores.delai, 1);
  assert.ok(v3.etat.details.some(d => d.raison === 'delai' && d.prevu === '2026-10-25T12:00:00.000Z'));
  // Désactivé : le passage dit pourquoi il n'a rien fait.
  const v4 = (await k.api(k.sm, undefined, { methode: 'PUT', corps: { actif: false } })).corps;
  const v5 = await synchro(k);
  assert.ok(v4);
  assert.equal(v5.etat.arret, 'inactif');
});

test('site injoignable : rien n’est considéré comme supprimé', async () => {
  const k = await monter();
  await activer(k);
  const lister = k.site.lister;
  k.site.lister = async () => {
    throw new Error('Le site LigneZero ne répond pas.');
  };
  const v = await synchro(k);
  assert.match(v.etat.erreur, /site/);
  assert.ok((await lignes(k)).every(l => l.statut === 'ouvert'));
  k.site.lister = lister;
});

test('manuel : créer maintenant, supprimer maintenant (historique gardé), recréer ; fin et suppression de l’événement', async () => {
  const k = await monter();
  // Désactivé : rien n'est créé tout seul, la liste propose les matchs du site.
  const v = (await k.api(k.sm, undefined, { methode: 'PUT', corps: { actif: false, categorieId: CAT } })).corps;
  assert.equal(salonsCrees(k).length, 0);
  assert.deepEqual(v.matchs.map(x => x.cle).sort(), [`l:${L1}`, `m:${M1}`]);
  assert.equal(v.matchs.find(x => x.genre === 'lobby').equipes.length, 3);
  const c = await k.api(`${k.sm}/creer`, undefined, { methode: 'POST', corps: { cle: `m:${M1}` } });
  assert.equal(c.statut, 200, JSON.stringify(c.corps));
  assert.equal(salonsCrees(k).length, 1);
  assert.equal(c.corps.salons[0].statut, 'ouvert');
  assert.equal((await k.api(`${k.sm}/creer`, undefined, { methode: 'POST', corps: { cle: `m:${M1}` } })).statut, 409);
  assert.equal((await k.api(`${k.sm}/creer`, undefined, { methode: 'POST', corps: { cle: 'x' } })).statut, 400);
  const id = c.corps.salons[0].id;
  const salon = c.corps.salons[0].salonId;
  k.discord.posterUtilisateur(salon, CAP_B, 'gg');
  const s = await k.api(`${k.sm}/${id}/supprimer`, undefined, { methode: 'POST', corps: {} });
  assert.equal(s.statut, 200, JSON.stringify(s.corps));
  assert.ok(!k.discord.etat.salons.has(salon));
  assert.equal(s.corps.salons[0].statut, 'supprime');
  assert.equal(s.corps.salons[0].historique, true);
  // Recréer : nouvelle ligne, l'ancien historique reste consultable.
  const r = await k.api(`${k.sm}/creer`, undefined, { methode: 'POST', corps: { cle: `m:${M1}` } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.salons.length, 2);
  assert.ok((await k.api(`${k.sm}/${id}/historique`)).corps.messages.some(x => x.contenu === 'gg'));

  // Fin de l'événement : salons restants fermés (historique enregistré) par le nettoyage.
  const ouvert = r.corps.salons.find(x => x.statut === 'ouvert');
  await k.api(k.chemin, undefined, { methode: 'PATCH', corps: { statut: 'termine' } });
  await tachesPlanifiees(k.b.base, { jetonBot: 'jeton-bot-de-test-jamais-reel', fetch: k.discord.fetch, maintenant: () => k.b.horloge.t, siteLz: k.site, journal: SILENCE });
  assert.ok(!k.discord.etat.salons.has(ouvert.salonId));
  assert.equal((await lignes(k)).find(x => x.id === ouvert.id).statut, 'supprime');
  // Suppression de l'événement : lignes et historiques effacés avec lui.
  const del = await k.api(k.chemin, undefined, { methode: 'DELETE' });
  assert.equal(del.statut, 200, JSON.stringify(del.corps));
  assert.equal((await lignes(k)).length, 0);
});

test('suppression de l’événement : salons encore ouverts fermés avec historique avant l’effacement', async () => {
  const k = await monter();
  await activer(k);
  const salons = (await lignes(k)).map(l => l.salon_id);
  assert.equal(salons.length, 2);
  const del = await k.api(k.chemin, undefined, { methode: 'DELETE' });
  assert.equal(del.statut, 200, JSON.stringify(del.corps));
  assert.equal(del.corps.nettoyage.salonsMatch, 2);
  for (const s of salons) assert.ok(!k.discord.etat.salons.has(s));
});

test('cron et passage rapide du meneur (une fois par minute, événement en cours)', async () => {
  const k = await monter();
  await k.api(k.sm, undefined, { methode: 'PUT', corps: { actif: false, categorieId: CAT } });
  await k.b.base.executer('UPDATE club_evenements SET salons_match = ? WHERE id = ?', [JSON.stringify({ ...lireReglages(null), actif: true, categorieId: CAT }), k.id]);
  const rapport = await tachesPlanifiees(k.b.base, { jetonBot: 'jeton-bot-de-test-jamais-reel', fetch: k.discord.fetch, maintenant: () => k.b.horloge.t, siteLz: k.site, journal: SILENCE });
  assert.ok(rapport.find(x => x.tache === 'salons de match').ok);
  assert.equal(salonsCrees(k).length, 2);
  // Passage rapide : seulement les événements en cours (dates du jour), au plus une fois par minute.
  const sm = k.b.traiter.salonsMatch;
  k.site.lectures.length = 0;
  assert.deepEqual(await sm.tacheRapide(), { evenements: 1, enCours: 1 });
  assert.equal(await sm.tacheRapide(), null);
  assert.ok(k.site.lectures.includes('tournament_matches'));
  k.b.horloge.t += 61_000;
  await k.b.base.executer("UPDATE club_evenements SET debut = '2026-12-01', fin = '2026-12-02' WHERE id = ?", [k.id]);
  assert.deepEqual(await sm.tacheRapide(), { evenements: 0, enCours: 0 });
});

test('données : table exportée ; effacement RGPD d’une personne : historiques où elle a écrit effacés', async () => {
  assert.ok(TABLES.some(([n]) => n === 'club_salons_match'));
  const k = await monter();
  await activer(k);
  const [a, b] = await lignes(k);
  k.discord.posterUtilisateur(a.salon_id, CAP_A, 'message de CapA');
  k.discord.posterUtilisateur(b.salon_id, CAP_B, 'message de CapB');
  for (const l of [a, b]) assert.equal((await k.api(`${k.sm}/${l.id}/supprimer`, undefined, { methode: 'POST', corps: {} })).statut, 200);
  await k.b.base.lot(effacementParDiscord([CAP_A]));
  const apres = await lignes(k);
  assert.equal(apres.find(x => x.id === a.id).transcript, null);
  assert.match(apres.find(x => x.id === b.id).transcript, /message de CapB/);
});

test('meneur de la Gateway : passage rapide lancé sans attendre (le bail passe d’abord), un seul à la fois, attendu à l’arrêt', async () => {
  const base = await baseMigree();
  await base.executer('INSERT INTO tickets_reglages (cle, valeur, maj_le) VALUES (?, ?, ?)', ['general', JSON.stringify({ actif: true, guildId: '700000000000000001', categorieOuverts: '710000000000000010' }), new Date().toISOString()]);
  const gw = await fauxGateway({ intervalle: 1000 });
  const rest = fauxDiscordRest({ gateway: gw });
  let appels = 0;
  let liberer;
  const tachesMeneur = () => {
    appels++;
    return new Promise(ok => {
      liberer = ok;
    });
  };
  const sup = creerSuperviseurTickets({ base, jetonBot: 'jeton-bot-de-test-jamais-reel', fetch: rest.fetch, identifiant: 'p', intervalle: 1_000_000, gateway: { attenteMin: 20, attenteMax: 200, hasard: () => 0.5 }, tachesMeneur, journal: SILENCE });
  try {
    const r = await sup.passage();
    assert.equal(r.meneur, true, 'le passage n’attend pas le passage rapide');
    await sup.passage();
    assert.equal(appels, 1, 'un seul à la fois');
    liberer();
    await new Promise(ok => setTimeout(ok, 10));
    await sup.passage();
    assert.equal(appels, 2);
    liberer();
  } finally {
    await sup.arreter();
    await gw.arreter();
  }
});

const ANCRE = '740000000000000001';
const DESSUS = '740000000000000000';
const DESSOUS = '740000000000000002';
const M2 = '44444444-4444-4444-8444-000000000009';
const placements = k => k.discord.appels.filter(a => a.methode === 'PATCH' && a.chemin === `/guilds/${k.GUILD}/channels`);

async function monterAncre() {
  const k = await monter();
  for (const [id, name, position] of [[DESSUS, 'annonces', 1], [ANCRE, 'matchs-du-jour', 3], [DESSOUS, 'resultats', 4]]) k.discord.etat.salons.set(id, { id, type: 0, name, parent_id: CAT, guild_id: k.GUILD, permission_overwrites: [], position });
  k.site.tables.tournament_matches.push({ ...k.site.tables.tournament_matches[0], id: M2, position: 2, team_a_id: EB, team_b_id: EC, scheduled_at: null });
  return k;
}

test('placer sous le salon : catégorie du repère, salons rangés juste sous lui par horaire (sans horaire à la fin), re-tri quand un horaire change', async () => {
  const k = await monterAncre();
  // Sans catégorie choisie : celle du salon repère.
  const v = await activer(k, { categorieId: null, ancreId: ANCRE });
  assert.equal(v.reglages.ancreId, ANCRE);
  assert.ok(v.salonsTexte.some(x => x.id === ANCRE && x.type === 'texte' && x.parent === CAT));
  assert.ok(v.salonsTexte.some(x => x.id === CAT && x.type === 'categorie'));
  const par = async cle => (await lignes(k)).find(x => x.site_match_id === cle).salon_id;
  const [sM1, sL1, sM2] = [await par(`m:${M1}`), await par(`l:${L1}`), await par(`m:${M2}`)];
  for (const id of [sM1, sL1, sM2]) assert.equal(k.discord.etat.salons.get(id).parent_id, CAT);
  // Un seul PATCH : repère (3), puis M1 (12h), L1 (14h), M2 (sans horaire) ; le salon du dessous suit ; celui du dessus ne bouge pas.
  assert.equal(placements(k).length, 1);
  assert.deepEqual(placements(k)[0].corps, [{ id: sM1, position: 4 }, { id: sL1, position: 5 }, { id: sM2, position: 6 }, { id: DESSOUS, position: 7 }]);
  // Rien ne change : aucun nouveau PATCH.
  await synchro(k);
  assert.equal(placements(k).length, 1);
  // M2 passe à 11h : re-tri.
  k.site.tables.tournament_matches.find(x => x.id === M2).scheduled_at = '2026-10-20T11:00:00.000Z';
  await synchro(k);
  assert.equal(placements(k).length, 2);
  assert.deepEqual(placements(k)[1].corps, [{ id: sM2, position: 4 }, { id: sM1, position: 5 }, { id: sL1, position: 6 }]);
  assert.equal(k.discord.etat.salons.get(DESSUS).position, 1);
});

test('placer sous le salon : limite de débit → au passage suivant ; repère supprimé → catégorie choisie, staff averti une fois', async () => {
  const k = await monterAncre();
  k.discord.programme.push({ si: (m, c) => m === 'PATCH' && c === `/guilds/${k.GUILD}/channels`, statut: 429, corps: { retry_after: 30, global: false } });
  await activer(k, { ancreId: ANCRE });
  assert.equal(placements(k).length, 1, 'refusé (429)');
  assert.equal((await synchro(k)).etat.places, 4, 'rangés au passage suivant');
  // Repère supprimé sur Discord.
  k.discord.etat.salons.delete(ANCRE);
  k.site.tables.tournament_matches.push({ ...k.site.tables.tournament_matches[0], id: '44444444-4444-4444-8444-000000000010', position: 3, scheduled_at: null });
  const v = await synchro(k);
  assert.equal(v.etat.erreur, 'ancre-introuvable');
  const nouveau = (await lignes(k)).find(x => x.site_match_id === 'm:44444444-4444-4444-8444-000000000010');
  assert.equal(k.discord.etat.salons.get(nouveau.salon_id).parent_id, CAT, 'catégorie choisie');
  const avertis = () => [...k.discord.etat.messages.values()].flat().filter(m => /salon repère/.test(m.content ?? ''));
  assert.equal(avertis().length, 1);
  assert.match(avertis()[0].content, new RegExp(`<@&${k.staffRole}>`));
  await synchro(k);
  assert.equal(avertis().length, 1, 'une seule fois');
  // Repère supprimé et aucune catégorie : aucune création.
  await k.api(k.sm, undefined, { methode: 'PUT', corps: { categorieId: null } });
  const avant = salonsCrees(k).length;
  k.site.tables.tournament_matches.push({ ...k.site.tables.tournament_matches[0], id: '44444444-4444-4444-8444-000000000011', position: 4 });
  await synchro(k);
  assert.equal(salonsCrees(k).length, avant);
  assert.throws(() => validerReglages({ ancreId: 'x' }), e => e.code === 'salons-match-ancre');
  assert.equal(validerReglages({ actif: true, ancreId: ANCRE }).ancreId, ANCRE);
});

test('staff assigné sur le site : accès par membre, mentionné dans l’embed, absents signalés ; assignation changée → accès et embed', async () => {
  const k = await monter();
  const ARB = '810000000000000301';
  const ARB2 = '810000000000000302';
  const ABS = '810000000000000303';
  k.discord.etat.absents.add(ABS);
  k.site.tables.tournament_match_staff_discord.push(
    { id: 's1', tournament_id: T1, match_id: M1, lobby_id: null, profile_id: 'p1', display_name: 'Arbitre', discord_id: ARB },
    { id: 's2', tournament_id: T1, match_id: M1, lobby_id: null, profile_id: 'p2', display_name: 'Absent', discord_id: ABS },
    { id: 's3', tournament_id: T1, match_id: M1, lobby_id: null, profile_id: 'p3', display_name: 'Sans Discord', discord_id: null },
  );
  await activer(k);
  const lm = (await lignes(k)).find(x => x.site_match_id === `m:${M1}`);
  const salon = () => k.discord.etat.salons.get(lm.salon_id);
  assert.equal(salon().permission_overwrites.find(o => o.id === ARB).allow, DROITS_STAFF);
  assert.equal(salon().permission_overwrites.find(o => o.id === ARB).type, 1);
  assert.equal(salon().permission_overwrites.find(o => o.id === ABS), undefined, 'absent du serveur : pas d’accès');
  const [accueil] = messagesDe(k, lm.salon_id);
  const champ = accueil.embeds[0].fields.find(f => f.name === 'Staff assigné');
  assert.match(champ.value, new RegExp(`<@${ARB}>`));
  assert.match(champ.value, /Absent \(absent du serveur\)/);
  assert.match(champ.value, /Sans Discord \(pas de Discord lié\)/);
  const alertes = () => messagesDe(k, lm.salon_id).filter(m => /introuvable sur le serveur/.test(m.content ?? ''));
  assert.equal(alertes().length, 1);
  assert.match(alertes()[0].content, /Absent, Sans Discord/);
  // Le lobby n'a pas de staff assigné : pas de champ.
  const ll = (await lignes(k)).find(x => x.site_match_id === `l:${L1}`);
  assert.ok(!messagesDe(k, ll.salon_id)[0].embeds[0].fields.some(f => f.name === 'Staff assigné'));
  await synchro(k);
  assert.equal(alertes().length, 1, 'une fois');
  // Assignation changée sur le site : ARB remplacé par ARB2.
  k.site.tables.tournament_match_staff_discord = [{ id: 's4', tournament_id: T1, match_id: M1, lobby_id: null, profile_id: 'p4', display_name: 'Arbitre 2', discord_id: ARB2 }];
  await synchro(k);
  k.b.horloge.t += 31_000;
  await synchro(k);
  assert.ok(salon().permission_overwrites.some(o => o.id === ARB2 && o.allow === DROITS_STAFF));
  assert.ok(!salon().permission_overwrites.some(o => o.id === ARB));
  const patch = k.discord.appels.filter(a => a.methode === 'PATCH' && a.chemin === `/channels/${lm.salon_id}/messages/${lm.message_id}`).at(-1);
  assert.match(patch.corps.embeds[0].fields.find(f => f.name === 'Staff assigné').value, new RegExp(`<@${ARB2}>`));
  const maj = messagesDe(k, lm.salon_id).at(-1);
  assert.match(maj.content, /Mise à jour du match : staff assigné/);
  assert.match(maj.content, new RegExp(`<@${ARB2}>`));
  assert.doesNotMatch(maj.content, new RegExp(`<@&${k.roles.ALP}>`), 'les équipes ne sont pas mentionnées');
  // Liste dans l'app : staff assigné.
  const v = (await k.api(k.sm)).corps;
  assert.deepEqual(v.salons.find(x => x.id === lm.id).staff, [{ nom: 'Arbitre 2', present: true }]);
});

// ------------------------------------------------------------------ Alertes pour le staff (notifications, migration 0077)

/** Alertes `salon-match-alerte` reçues par un compte (liste du centre ; la distribution est faite avant). */
async function alertes(k, compte) {
  await distribuer(k.b.base, { maintenant: k.b.horloge.t });
  const r = await k.api('/notifications/centre?limite=100', await k.b.session(compte));
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  return r.corps.liste.filter(n => n.type === 'salon-match-alerte');
}

test('alertes : équipe sans rôle et staff introuvable → evenements.gerer et Fondateur, lien vers le match ; une fois', async () => {
  const k = await monter();
  const gestion = await k.compteAvec('gest1234', 'Gestion', ['evenements.gerer']);
  const autre = await k.compteAvec('autr1234', 'Autre', ['vocaux.configurer']);
  const ABS = '810000000000000303';
  k.discord.etat.absents.add(ABS);
  k.site.tables.tournament_match_staff_discord.push({ id: 's2', tournament_id: T1, match_id: M1, lobby_id: null, profile_id: 'p2', display_name: 'Absent', discord_id: ABS });
  k.site.tables.tournament_teams.push({ id: ED, tournament_id: T1, name: 'Delta', tag: 'DLT' });
  k.site.tables.tournament_lobby_entries.push({ id: 'e4', lobby_id: L1, team_id: ED, placement: null, points: 0, dnf: false, sort_order: 3 });
  await activer(k);
  const recues = await alertes(k, 'gest1234');
  const parCode = Object.fromEntries(recues.map(n => [n.charge.code, n]));
  assert.deepEqual(Object.keys(parCode).sort(), ['equipe-sans-role', 'staff-introuvable']);
  assert.equal(parCode['equipe-sans-role'].charge.nom, '[DLT] Delta');
  assert.deepEqual(parCode['equipe-sans-role'].cible, { v: 1, g: 'salon_match', evenement: k.id, match: `l:${L1}` });
  assert.deepEqual(parCode['staff-introuvable'].cible, { v: 1, g: 'salon_match', evenement: k.id, match: `m:${M1}` });
  assert.equal(parCode['staff-introuvable'].charge.nom, 'Absent');
  assert.equal((await alertes(k, 'principal')).length, 2, 'le Fondateur aussi');
  assert.equal((await alertes(k, 'autr1234')).length, 0, 'ni les autres permissions');
  // Le lien mène à la fiche de l'événement, ligne du match.
  const verif = await k.api('/notifications/cible', await k.b.session('gest1234'), { methode: 'POST', corps: { cible: parCode['equipe-sans-role'].cible } });
  assert.equal(verif.corps.etat, 'ok');
  assert.equal(verif.corps.cible.match, `l:${L1}`);
  // Passages suivants : rien de plus (déjà signalé).
  k.b.horloge.t += 20 * 60_000;
  await synchro(k);
  assert.equal((await alertes(k, 'gest1234')).length, 2);
});

test('alertes : création refusée par Discord (hiérarchie), catégorie pleine (50 salons), repère supprimé → compteur sans doublon', async () => {
  const k = await monterAncre();
  const gestion = await k.compteAvec('gest1234', 'Gestion', ['evenements.gerer']);
  // Repère supprimé sur Discord (catégorie choisie gardée), puis catégorie pleine.
  await activer(k, { ancreId: ANCRE });
  k.discord.etat.salons.delete(ANCRE);
  for (let i = 0; i < 50; i++) k.discord.etat.salons.set(`75000000000000${String(i).padStart(4, '0')}`, { id: `75000000000000${String(i).padStart(4, '0')}`, type: 0, name: `s${i}`, parent_id: CAT, guild_id: k.GUILD, permission_overwrites: [] });
  k.site.tables.tournament_matches.push({ ...k.site.tables.tournament_matches[0], id: '44444444-4444-4444-8444-000000000020', position: 7, scheduled_at: null });
  k.b.horloge.t += 20 * 60_000;
  assert.equal((await synchro(k)).etat.erreur, 'categorie-pleine');
  let liste = await alertes(k, 'gest1234');
  const codes = liste.map(n => n.charge.code).sort();
  assert.ok(codes.includes('ancre-supprimee'), JSON.stringify(codes));
  assert.ok(codes.includes('categorie-pleine'), JSON.stringify(codes));
  assert.equal(liste.find(n => n.charge.code === 'categorie-pleine').cible.g, 'salon_match');
  // Repassages toutes les 20 minutes : le compteur monte, pas de nouvelle notification.
  for (let i = 0; i < 2; i++) {
    k.b.horloge.t += 20 * 60_000;
    await synchro(k);
  }
  liste = await alertes(k, 'gest1234');
  assert.equal(liste.length, codes.length);
  assert.ok(liste.find(n => n.charge.code === 'categorie-pleine').charge.compteur >= 3);
  // Création refusée par Discord : salon non créé, alerte « création refusée (hiérarchie) ».
  for (let i = 0; i < 50; i++) k.discord.etat.salons.delete(`75000000000000${String(i).padStart(4, '0')}`);
  k.discord.programme.push({ si: (m, c) => m === 'POST' && c === `/guilds/${k.GUILD}/channels`, statut: 403, corps: { code: 50013, message: 'Missing Permissions' } });
  k.discord.programme.push({ si: (m, c) => m === 'POST' && c === `/guilds/${k.GUILD}/channels`, statut: 403, corps: { code: 50013, message: 'Missing Permissions' } });
  k.b.horloge.t += 20 * 60_000;
  await synchro(k);
  const refus = (await alertes(k, 'gest1234')).find(n => n.charge.code === 'creation-hierarchie');
  assert.ok(refus, 'création refusée signalée');
  assert.equal(refus.cible.match, 'm:44444444-4444-4444-8444-000000000020');
  assert.equal(refus.charge.statut, 403);
});
