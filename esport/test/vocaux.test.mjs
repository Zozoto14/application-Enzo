/**
 * Salons vocaux temporaires (« rejoindre pour créer ») : réglages validés ; salon créé à l'arrivée dans un hub (juste
 * en dessous, même catégorie, surcharges du hub), membre déplacé, panneau publié ; un seul salon par membre ; contrôles
 * réservés au propriétaire et au staff ; verrouiller / déverrouiller, expulser, liste d'amis, transférer ; propriétaire
 * parti → propriété transmise ; salon vide supprimé après le délai ; redémarrage (rapprochement, rattrapage) ;
 * renommage limité par Discord ; Gateway avec GUILD_VOICE_STATES ; écran de configuration. Faux Discord, jamais de
 * réseau réel.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc } from './aide.mjs';
import { attendre, bancTickets, fauxDiscordRest, fauxGateway } from './tickets-aide.mjs';
import { baseMigree } from './base.mjs';
import { creerMoteurVocaux, INTENT_VOCAL } from '../noyau/vocaux/moteur.mjs';
import { creerBotVocaux } from '../noyau/vocaux/bot.mjs';
import { VOCAUX_DEFAUT, nomSalon, validerVocaux } from '../noyau/vocaux/reglages.mjs';
import { definitionsCommandes } from '../noyau/discord/bot/commandes.mjs';
import { PV, lireSalon, surchargesSalon } from '../noyau/vocaux/salons.mjs';
import { creerSuperviseurTickets } from '../noyau/tickets/superviseur.mjs';
import { intentsVoulus, INTENT_GUILDS } from '../noyau/tickets/bienvenue.mjs';
import { INTENTS_TICKETS } from '../noyau/tickets/gateway.mjs';
import { TABLES } from '../noyau/transfert.mjs';

const JETON = 'jeton-bot-de-test-jamais-reel';
const GUILD = '700000000000000001';
const BOT = '424242424242424242';
const CAT = '710000000000000050';
const HUB = '710000000000000051';
const JOURNAUX = '710000000000000013';
const STAFF = '720000000000000001';
const U1 = '810000000000000001';
const U2 = '810000000000000002';
const U3 = '810000000000000003';
const U4 = '810000000000000004';
const silencieux = { error() {}, warn() {} };
const RAPIDE = { attenteMin: 20, attenteMax: 200, hasard: () => 0.5 };
const CONNECT = PV.CONNECTER;

async function regler(base, vocaux = {}, general = {}) {
  const t = new Date().toISOString();
  await base.executer('INSERT INTO tickets_reglages (cle, valeur, maj_le) VALUES (?, ?, ?) ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur', ['general', JSON.stringify({ actif: false, guildId: GUILD, guildNom: 'Ligne Zéro', langue: 'fr', ...general }), t]);
  await base.executer('INSERT INTO tickets_reglages (cle, valeur, maj_le) VALUES (?, ?, ?) ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur', [
    'vocaux',
    JSON.stringify({ actif: true, hubs: [{ id: HUB, nom: 'Créer un salon', modeleNom: 'Salon de {pseudo}', limite: 0, verrouille: false }], rolesStaff: [STAFF], delaiSuppressionS: 5, maxParMembre: 1, quandProprietairePart: 'transferer', salonJournaux: JOURNAUX, ...vocaux }),
    t,
  ]);
}

function discordAvecHub() {
  const rest = fauxDiscordRest();
  rest.etat.salons.set(CAT, { id: CAT, type: 4, name: 'Vocaux', guild_id: GUILD, position: 2, permission_overwrites: [{ id: '720000000000000077', type: 0, allow: String(PV.VOIR), deny: '0' }] });
  rest.etat.salons.set(HUB, { id: HUB, type: 2, name: 'Créer un salon', guild_id: GUILD, parent_id: CAT, position: 3, permission_overwrites: [{ id: '720000000000000077', type: 0, allow: String(PV.VOIR), deny: '0' }] });
  return rest;
}

const vs = (userId, channelId, nom = `Joueur${userId.slice(-1)}`, roles = []) => ({ guild_id: GUILD, user_id: userId, channel_id: channelId, member: { user: { id: userId, username: nom.toLowerCase() }, nick: nom, roles } });
const guildCreate = (rest, voice_states = []) => ({ id: GUILD, channels: [...rest.etat.salons.values()], voice_states, members: [] });
const creations = rest => rest.appels.filter(a => a.methode === 'POST' && a.chemin === `/guilds/${GUILD}/channels`);

async function monter({ vocaux, delaiMs = 60 } = {}) {
  const base = await baseMigree();
  await regler(base, vocaux);
  const rest = discordAvecHub();
  const moteur = creerMoteurVocaux({ base, fetch: rest.fetch, jetonBot: JETON, botId: () => BOT, delaiMs, journal: silencieux });
  await moteur.evenement('GUILD_CREATE', guildCreate(rest));
  const bot = creerBotVocaux({ base, fetch: rest.fetch, jetonBot: JETON, botId: BOT });
  return { base, rest, moteur, bot };
}

/** Arrivée dans le hub : salon créé, puis le déplacement est rejoué comme un événement Discord. */
async function rejoindreHub(k, userId, nom) {
  const avant = new Set(k.rest.etat.salons.keys());
  await k.moteur.evenement('VOICE_STATE_UPDATE', vs(userId, HUB, nom));
  const salonId = [...k.rest.etat.salons.keys()].find(id => !avant.has(id));
  await k.moteur.evenement('VOICE_STATE_UPDATE', vs(userId, salonId, nom));
  return salonId;
}

const clic = (salonId, userId, custom_id, extra = {}) => ({ type: 3, guild_id: GUILD, channel_id: salonId, locale: 'fr', member: { user: { id: userId }, roles: extra.roles ?? [], permissions: extra.permissions ?? '0' }, data: { custom_id, ...(extra.data ?? {}) } });

test('réglages : un hub au moins pour activer, salon unique par hub, limites ; nom du salon', () => {
  assert.throws(() => validerVocaux({ actif: true }, { ...VOCAUX_DEFAUT }), /au moins un hub/);
  assert.throws(() => validerVocaux({ hubs: [{ id: HUB }, { id: HUB }] }, { ...VOCAUX_DEFAUT }), /deux hubs/);
  assert.throws(() => validerVocaux({ delaiSuppressionS: 1 }, { ...VOCAUX_DEFAUT }), /hors limites/);
  assert.throws(() => validerVocaux({ hubs: [{ id: HUB, limite: 100 }] }, { ...VOCAUX_DEFAUT }), /hors limites/);
  assert.throws(() => validerVocaux({ quandProprietairePart: 'rien' }, { ...VOCAUX_DEFAUT }), /départ du propriétaire/);
  const s = validerVocaux({ actif: true, hubs: [{ id: HUB, modeleNom: '  Chez   {pseudo} ', limite: 5 }], rolesStaff: [STAFF], delaiSuppressionS: 20 }, { ...VOCAUX_DEFAUT });
  assert.deepEqual([s.hubs[0].modeleNom, s.hubs[0].limite, s.hubs[0].verrouille, s.delaiSuppressionS, s.maxParMembre], ['Chez {pseudo}', 5, false, 20, 1]);
  assert.equal(validerVocaux({ hubs: [{ id: HUB, modeleNom: '' }] }, { ...VOCAUX_DEFAUT }).hubs[0].modeleNom, 'Salon de {pseudo}');
  assert.equal(nomSalon('Salon de {pseudo}', { pseudo: 'Léa @everyone' }), 'Salon de Léa everyone');
  assert.equal(nomSalon('{pseudo}', { pseudo: 'x'.repeat(150) }).length, 100);
});

test('intents : GUILD_VOICE_STATES ajouté quand les salons vocaux sont activés (tickets et bienvenue gardés)', () => {
  assert.equal(intentsVoulus({ actif: true }, { actif: false }, { vocaux: true }), INTENTS_TICKETS | INTENT_VOCAL);
  assert.equal(intentsVoulus({ actif: false }, { actif: false }, { vocaux: true }), INTENT_GUILDS | INTENT_VOCAL);
  assert.equal(INTENT_VOCAL, 1 << 7);
  assert.ok(INTENTS_TICKETS & (1 << 15), 'MESSAGE_CONTENT gardé');
});

test('surcharges : verrouillé = @everyone sans « Se connecter », propriétaire, amis et staff autorisés ; bot toujours', () => {
  const s = { verrouille: true, proprietaireId: U1, amis: [{ id: U3, nom: 'C' }], basePermissions: [{ id: GUILD, type: 0, allow: String(PV.VOIR | CONNECT), deny: '0' }] };
  const o = surchargesSalon(s, { guildId: GUILD, botId: BOT, rolesStaff: [STAFF] });
  const de = id => o.find(x => x.id === id);
  assert.equal(BigInt(de(GUILD).deny) & CONNECT, CONNECT);
  assert.equal(BigInt(de(GUILD).allow) & CONNECT, 0n);
  for (const id of [STAFF, U1, U3, BOT]) assert.equal(BigInt(de(id).allow) & CONNECT, CONNECT, id);
  assert.ok(BigInt(de(BOT).allow) & PV.DEPLACER);
  const ouvert = surchargesSalon({ ...s, verrouille: false }, { guildId: GUILD, botId: BOT, rolesStaff: [STAFF] });
  assert.equal(BigInt(ouvert.find(x => x.id === GUILD).deny), 0n, 'déverrouillé : surcharge du hub rendue telle quelle');
  assert.ok(!ouvert.some(x => x.id === U3 || x.id === STAFF));
});

test('arrivée dans le hub : salon juste en dessous, membre déplacé, propriétaire, panneau ; un seul salon par membre', async () => {
  const k = await monter();
  await k.moteur.evenement('VOICE_STATE_UPDATE', vs(U1, HUB, 'Léa'));
  const [c] = creations(k.rest);
  assert.equal(c.corps.name, 'Salon de Léa');
  assert.equal(c.corps.type, 2);
  assert.equal(c.corps.parent_id, CAT, 'même catégorie que le hub');
  assert.equal(c.corps.position, 4, 'position juste après le hub');
  assert.ok(c.corps.permission_overwrites.some(o => o.id === '720000000000000077' && BigInt(o.allow) & PV.VOIR), 'surcharges du hub reprises');
  assert.ok(c.corps.permission_overwrites.some(o => o.id === U1 && BigInt(o.allow) & CONNECT), 'propriétaire autorisé');
  const salon = [...k.rest.etat.salons.values()].find(s => s.name === 'Salon de Léa');
  const deplacement = k.rest.appels.find(a => a.methode === 'PATCH' && a.chemin === `/guilds/${GUILD}/members/${U1}`);
  assert.deepEqual(deplacement.corps, { channel_id: salon.id });
  const panneau = k.rest.etat.messages.get(salon.id)[0];
  assert.equal(panneau.content, `<@${U1}>`);
  assert.deepEqual(panneau.allowed_mentions, { parse: [], users: [U1] });
  assert.deepEqual(panneau.components.flatMap(r => r.components.map(b => b.custom_id.split(':')[1])), ['r', 'l', 'n', 'k', 'a', 't']);
  assert.match(panneau.embeds[0].description, /ce salon est à toi/);
  const ligne = await lireSalon(k.base, salon.id);
  assert.equal(ligne.proprietaireId, U1);
  assert.equal(ligne.panneauId, panneau.id);
  assert.ok(k.rest.appels.some(a => a.methode === 'POST' && a.chemin === `/channels/${JOURNAUX}/messages` && /créé/.test(a.corps.content)), 'journal');
  // Le déplacement arrive comme un événement : Léa est notée présente, le salon n'est plus « vide ».
  await k.moteur.evenement('VOICE_STATE_UPDATE', vs(U1, salon.id, 'Léa'));
  assert.deepEqual((await lireSalon(k.base, salon.id)).occupants, [{ id: U1, nom: 'Léa' }]);
  assert.equal((await lireSalon(k.base, salon.id)).videDepuis, null);
  // Elle repasse par le hub : déplacée dans SON salon, aucun nouveau salon.
  await k.moteur.evenement('VOICE_STATE_UPDATE', vs(U1, HUB, 'Léa'));
  assert.equal(creations(k.rest).length, 1);
  assert.equal(k.rest.appels.filter(a => a.methode === 'PATCH' && a.chemin === `/guilds/${GUILD}/members/${U1}`).at(-1).corps.channel_id, salon.id);
  k.moteur.arreter();
});

test('contrôles : propriétaire ou staff seulement ; verrouiller, déverrouiller, expulser, liste d’amis, transférer', async () => {
  const k = await monter();
  const salon = await rejoindreHub(k, U1, 'Léa');
  await k.moteur.evenement('VOICE_STATE_UPDATE', vs(U2, salon, 'Max'));
  // Un autre membre : refus éphémère.
  const refus = await k.bot.interaction(clic(salon, U2, `vc:l:${salon}`));
  assert.equal(refus.data.flags, 64);
  assert.match(refus.data.content, /Seul le propriétaire/);
  // Propriétaire : verrouille (une seule requête PATCH du salon avec toutes les surcharges).
  const v = await k.bot.interaction(clic(salon, U1, `vc:l:${salon}`));
  assert.match(v.data.content, /Salon verrouillé/);
  const patch = k.rest.appels.filter(a => a.methode === 'PATCH' && a.chemin === `/channels/${salon}`).at(-1);
  const de = id => patch.corps.permission_overwrites.find(o => o.id === id);
  assert.equal(BigInt(de(GUILD).deny) & CONNECT, CONNECT);
  assert.equal(BigInt(de(STAFF).allow) & CONNECT, CONNECT);
  assert.equal((await lireSalon(k.base, salon)).verrouille, true);
  // Le panneau suit (après la réponse) : bouton « Déverrouiller ».
  await v.apres();
  const panneau = k.rest.etat.messages.get(salon)[0];
  assert.ok(panneau.components[0].components.some(b => b.custom_id === `vc:u:${salon}`));
  // Liste d'amis : menu, ajout (surcharge « Se connecter » pour l'ami, salon verrouillé), retrait.
  const menuAmis = await k.bot.interaction(clic(salon, U1, `vc:a:${salon}`));
  assert.equal(menuAmis.data.components[0].components[0].type, 5);
  const ajout = await k.bot.interaction(clic(salon, U1, `vc:aa:${salon}`, { data: { values: [U3], resolved: { users: { [U3]: { id: U3, username: 'chloe' } } } } }));
  assert.match(ajout.data.content, /chloe/);
  let dernier = k.rest.appels.filter(a => a.methode === 'PATCH' && a.chemin === `/channels/${salon}`).at(-1);
  assert.equal(BigInt(dernier.corps.permission_overwrites.find(o => o.id === U3).allow) & CONNECT, CONNECT);
  const retrait = await k.bot.interaction(clic(salon, U1, `vc:ar:${salon}`, { data: { values: [U3] } }));
  assert.match(retrait.data.content, /n’est plus dans ta liste/);
  dernier = k.rest.appels.filter(a => a.methode === 'PATCH' && a.chemin === `/channels/${salon}`).at(-1);
  assert.ok(!dernier.corps.permission_overwrites.some(o => o.id === U3));
  // Expulser : menu des présents (sans soi), puis déconnexion (PATCH du membre, salon null).
  const menuExp = await k.bot.interaction(clic(salon, U1, `vc:k:${salon}`));
  assert.deepEqual(menuExp.data.components[0].components[0].options.map(o => o.value), [U2]);
  const exp = await k.bot.interaction(clic(salon, U1, `vc:ks:${salon}`, { data: { values: [U2] } }));
  assert.match(exp.data.content, /Max a été expulsé du salon\. Le salon est verrouillé/);
  assert.deepEqual(k.rest.appels.filter(a => a.chemin === `/guilds/${GUILD}/members/${U2}`).at(-1).corps, { channel_id: null });
  // Staff (rôle réglé) : peut déverrouiller le salon d'un autre.
  const staff = await k.bot.interaction(clic(salon, U4, `vc:u:${salon}`, { roles: [STAFF] }));
  assert.match(staff.data.content, /déverrouillé/);
  const tous = k.rest.appels.filter(a => a.methode === 'PATCH' && a.chemin === `/channels/${salon}`).at(-1).corps.permission_overwrites.find(o => o.id === GUILD);
  assert.equal(BigInt(tous?.deny ?? '0') & CONNECT, 0n, '@everyone peut de nouveau se connecter');
  // Transférer : à une personne présente seulement.
  await k.moteur.evenement('VOICE_STATE_UPDATE', vs(U3, salon, 'Chloé'));
  const menuT = await k.bot.interaction(clic(salon, U1, `vc:t:${salon}`));
  assert.deepEqual(menuT.data.components[0].components[0].options.map(o => o.value), [U3]);
  const tr = await k.bot.interaction(clic(salon, U1, `vc:ts:${salon}`, { data: { values: [U3] } }));
  assert.match(tr.data.content, /Chloé est maintenant propriétaire/);
  assert.equal((await lireSalon(k.base, salon)).proprietaireId, U3);
  assert.match((await k.bot.interaction(clic(salon, U1, `vc:l:${salon}`))).data.content, /Seul le propriétaire/, 'l’ancien propriétaire n’a plus la main');
  k.moteur.arreter();
});

test('renommer et limite : fenêtres ; renommage limité par Discord (2 toutes les 10 min) → délai annoncé', async () => {
  const k = await monter();
  const salon = await rejoindreHub(k, U1, 'Léa');
  const f = await k.bot.interaction(clic(salon, U1, `vc:r:${salon}`));
  assert.equal(f.type, 9);
  assert.equal(f.data.custom_id, `vc:rm:${salon}`);
  const fenetre = (id, champ, valeur) => ({ type: 5, guild_id: GUILD, channel_id: salon, locale: 'fr', member: { user: { id: U1 }, roles: [], permissions: '0' }, data: { custom_id: id, components: [{ type: 1, components: [{ type: 4, custom_id: champ, value: valeur }] }] } });
  const r = await k.bot.interaction(fenetre(`vc:rm:${salon}`, 'nom', 'QG de Léa'));
  assert.match(r.data.content, /Salon renommé : QG de Léa/);
  assert.equal(k.rest.etat.salons.get(salon).name, 'QG de Léa');
  k.rest.programme.push({ si: (m, c) => m === 'PATCH' && c === `/channels/${salon}`, statut: 429, corps: { message: 'You are being rate limited.', retry_after: 420, global: false } });
  const limite = await k.bot.interaction(fenetre(`vc:rm:${salon}`, 'nom', 'Encore'));
  assert.match(limite.data.content, /2 toutes les 10 minutes : réessaie dans 7 min/);
  const l = await k.bot.interaction(fenetre(`vc:nm:${salon}`, 'places', '5'));
  assert.match(l.data.content, /Limite : 5 places/);
  assert.equal(k.rest.etat.salons.get(salon).user_limit, 5);
  assert.match((await k.bot.interaction(fenetre(`vc:nm:${salon}`, 'places', 'abc'))).data.content, /de 0 à 99/);
  // Réponse en anglais pour un client anglais sans compte lié.
  const en = await k.bot.interaction({ ...fenetre(`vc:nm:${salon}`, 'places', '0'), locale: 'en-US' });
  assert.equal(en.data.content, 'No user limit any more.');
  k.moteur.arreter();
});

test('propriétaire parti : propriété transmise ; salon vide supprimé après le délai ; retour avant le délai = gardé', async () => {
  const k = await monter({ delaiMs: 80 });
  const salon = await rejoindreHub(k, U1, 'Léa');
  await k.moteur.evenement('VOICE_STATE_UPDATE', vs(U2, salon, 'Max'));
  await k.moteur.evenement('VOICE_STATE_UPDATE', vs(U1, null, 'Léa'));
  let ligne = await lireSalon(k.base, salon);
  assert.equal(ligne.proprietaireId, U2);
  assert.ok(k.rest.etat.messages.get(salon).some(m => /<@810000000000000002> est maintenant propriétaire/.test(m.content)));
  // Max part puis revient avant le délai : rien n'est supprimé.
  await k.moteur.evenement('VOICE_STATE_UPDATE', vs(U2, null, 'Max'));
  assert.ok((await lireSalon(k.base, salon)).videDepuis);
  await k.moteur.evenement('VOICE_STATE_UPDATE', vs(U2, salon, 'Max'));
  await new Promise(ok => setTimeout(ok, 150));
  await k.moteur.attendre();
  assert.ok(k.rest.etat.salons.has(salon));
  // Il part pour de bon : supprimé après le délai, ligne oubliée.
  await k.moteur.evenement('VOICE_STATE_UPDATE', vs(U2, null, 'Max'));
  await attendre(async () => !(await lireSalon(k.base, salon)), { delai: 2000 });
  assert.ok(k.rest.appels.some(a => a.methode === 'DELETE' && a.chemin === `/channels/${salon}`));
  assert.ok(!k.rest.etat.salons.has(salon));
  k.moteur.arreter();
});

test('mode « garder » : le propriétaire parti garde la propriété', async () => {
  const k = await monter({ vocaux: { quandProprietairePart: 'garder' } });
  const salon = await rejoindreHub(k, U1, 'Léa');
  await k.moteur.evenement('VOICE_STATE_UPDATE', vs(U2, salon, 'Max'));
  await k.moteur.evenement('VOICE_STATE_UPDATE', vs(U1, null, 'Léa'));
  assert.equal((await lireSalon(k.base, salon)).proprietaireId, U1);
  k.moteur.arreter();
});

test('redémarrage : salons disparus oubliés, vides supprimés, propriétaire resynchronisé, personne restée dans le hub servie ; rattrapage', async () => {
  const base = await baseMigree();
  await regler(base);
  const rest = discordAvecHub();
  const ligne = (id, proprietaire, occupants, extra = {}) =>
    base.executer("INSERT INTO vocaux_salons (salon_id, guild_id, hub_id, proprietaire_id, nom, occupants, cree_le, maj_le, vide_depuis) VALUES (?, ?, ?, ?, ?, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', ?)", [id, GUILD, HUB, proprietaire, `Salon ${id.slice(-2)}`, JSON.stringify(occupants), extra.vide ?? null]);
  const VIDE = '710000000000000061';
  const DISPARU = '710000000000000062';
  const OCCUPE = '710000000000000063';
  for (const id of [VIDE, OCCUPE]) rest.etat.salons.set(id, { id, type: 2, name: `Salon ${id.slice(-2)}`, guild_id: GUILD, parent_id: CAT, position: 4, permission_overwrites: [] });
  await ligne(VIDE, U1, [{ id: U1, nom: 'Léa' }]);
  await ligne(DISPARU, U2, [{ id: U2, nom: 'Max' }]);
  await ligne(OCCUPE, U3, [{ id: U3, nom: 'Chloé' }]);
  const moteur = creerMoteurVocaux({ base, fetch: rest.fetch, jetonBot: JETON, botId: () => BOT, delaiMs: 60, journal: silencieux });
  // Chloé (propriétaire) est partie pendant l'absence du bot, Max est dans OCCUPE ; Hugo attend dans le hub.
  await moteur.evenement('GUILD_CREATE', { ...guildCreate(rest, [{ user_id: U2, channel_id: OCCUPE }, { user_id: U4, channel_id: HUB }]), members: [{ user: { id: U2, username: 'max' } }, { user: { id: U4, username: 'hugo' } }] });
  assert.equal(await lireSalon(base, DISPARU), null, 'salon disparu de Discord : oublié');
  assert.equal(await lireSalon(base, VIDE), null, 'salon vide : supprimé tout de suite');
  assert.ok(rest.appels.some(a => a.methode === 'DELETE' && a.chemin === `/channels/${VIDE}`));
  const occupe = await lireSalon(base, OCCUPE);
  assert.deepEqual(occupe.occupants.map(o => o.id), [U2]);
  assert.equal(occupe.proprietaireId, U2, 'propriété resynchronisée');
  assert.ok(creations(rest).some(c => c.corps.name === 'Salon de hugo'), 'personne restée dans le hub : salon créé');
  moteur.arreter();
  // Processus remplacé (minuteries perdues) : le passage du superviseur supprime un salon vide arrivé au délai.
  const ANCIEN = '710000000000000064';
  rest.etat.salons.set(ANCIEN, { id: ANCIEN, type: 2, name: 'Ancien', guild_id: GUILD, permission_overwrites: [] });
  await ligne(ANCIEN, U1, [], { vide: '2026-01-01T00:00:00.000Z' });
  const autre = creerMoteurVocaux({ base, fetch: rest.fetch, jetonBot: JETON, botId: () => BOT, delaiMs: 60, journal: silencieux });
  await autre.passage();
  assert.equal(await lireSalon(base, ANCIEN), null);
  assert.ok(rest.appels.some(a => a.methode === 'DELETE' && a.chemin === `/channels/${ANCIEN}`));
  autre.arreter();
});

test('Discord refuse la création : erreur notée pour l’app, journal, rien en base', async () => {
  const k = await monter();
  k.rest.programme.push({ si: (m, c) => m === 'POST' && c === `/guilds/${GUILD}/channels`, statut: 403, corps: { code: 50013, message: 'Missing Permissions' } });
  await k.moteur.evenement('VOICE_STATE_UPDATE', vs(U1, HUB, 'Léa'));
  assert.equal((await k.base.tous('SELECT * FROM vocaux_salons', [])).length, 0);
  const etat = JSON.parse((await k.base.premier("SELECT valeur FROM tickets_etat WHERE cle = 'vocaux'", [])).valeur);
  assert.deepEqual([etat.derniereErreur.motif, etat.derniereErreur.statut, etat.derniereErreur.code], ['creation', 403, 50013]);
  assert.ok(k.rest.appels.some(a => a.chemin === `/channels/${JOURNAUX}/messages` && /50013/.test(a.corps.content)));
  // Alerte pour ceux qui configurent les salons vocaux (notification `vocal-alerte`, notifications/alertes.mjs) : hiérarchie.
  const alertes = async () => k.base.tous("SELECT entite_id, charge FROM evenements WHERE type = 'alerte.vocal' ORDER BY cree_le", []);
  const [a1, ...reste] = await alertes();
  assert.equal(reste.length, 0);
  assert.equal(a1.entite_id, 'vocal:creation:hierarchie');
  assert.deepEqual([JSON.parse(a1.charge).code, JSON.parse(a1.charge).quoi, JSON.parse(a1.charge).statut], ['hierarchie', 'creation', 403]);
  // Même refus dans la foulée : pas un événement de plus (compté par le dédoublonnage de l'abonné, 6 h).
  k.rest.programme.push({ si: (m, c) => m === 'POST' && c === `/guilds/${GUILD}/channels`, statut: 403, corps: { code: 50013, message: 'Missing Permissions' } });
  await k.moteur.evenement('VOICE_STATE_UPDATE', vs(U1, HUB, 'Léa'));
  assert.equal((await alertes()).length, 1);
  k.moteur.arreter();
});

test('Gateway : salons vocaux activés → GUILD_VOICE_STATES demandé ; arrivée dans le hub vue en direct', async () => {
  const base = await baseMigree();
  await regler(base);
  const gw = await fauxGateway({ intervalle: 1000 });
  const rest = discordAvecHub();
  const rest2 = fauxDiscordRest({ gateway: gw });
  const fetch = (url, init) => (String(url).endsWith('/gateway/bot') ? rest2.fetch(url, init) : rest.fetch(url, init));
  const sup = creerSuperviseurTickets({ base, jetonBot: JETON, fetch, identifiant: 'p', intervalle: 1_000_000, gateway: RAPIDE, journal: silencieux, vocaux: { delaiMs: 60 } });
  try {
    const r = await sup.passage();
    assert.equal(r.meneur, true, 'la Gateway est tenue pour les salons vocaux seuls');
    await attendre(() => sup.etat().gateway?.etat === 'pret');
    assert.equal(gw.recus.find(m => m.op === 2).d.intents, INTENT_GUILDS | INTENT_VOCAL);
    const conn = gw.connexions[0];
    conn.dispatch('GUILD_CREATE', guildCreate(rest));
    conn.dispatch('VOICE_STATE_UPDATE', vs(U1, HUB, 'Léa'));
    await attendre(() => creations(rest).length === 1);
    await attendre(async () => (await base.tous('SELECT * FROM vocaux_salons', [])).length === 1);
    assert.equal((await sup.passage()).mode, 'direct');
  } finally {
    await sup.arreter();
    await gw.arreter();
  }
});

test('application : réglages (vocaux.configurer), serveur Discord lu (salons vocaux), connexion, interaction signée, export', async () => {
  const k = await bancTickets({ banc });
  const moi = await k.api('/moi');
  assert.equal(moi.corps.peutConfigurerVocaux, true);
  // Sans serveur des tickets : refus clair à l'activation.
  const r0 = await k.api('/vocaux/config', undefined, { methode: 'PUT', corps: { actif: true, hubs: [{ id: HUB }] } });
  assert.equal(r0.statut, 400);
  await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { guildId: k.GUILD } });
  const r = await k.api('/vocaux/config', undefined, { methode: 'PUT', corps: { actif: true, hubs: [{ id: HUB, modeleNom: 'Salon de {pseudo}', limite: 4 }], rolesStaff: [STAFF], delaiSuppressionS: 30 } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.reglages.hubs[0].limite, 4);
  assert.equal(r.corps.connexion.mode, 'hors_ligne', 'aucune Gateway en test : l’écran prévient');
  assert.match(r.corps.lienInvitation, /permissions=378279284304/);
  // Serveur Discord : les salons vocaux sont proposés comme hubs, avec les permissions du bot.
  k.discord.etat.salons.set(HUB, { id: HUB, type: 2, name: 'Créer un salon', guild_id: k.GUILD, parent_id: '710000000000000010', position: 1, permission_overwrites: [] });
  const d = await k.api('/vocaux/discord');
  assert.equal(d.statut, 200, JSON.stringify(d.corps));
  assert.ok(d.corps.salons.some(s => s.id === HUB && s.type === 'vocal'));
  assert.ok(d.corps.salons.some(s => s.type === 'categorie'));
  assert.deepEqual(d.corps.permissions.serveur, ['connecter', 'parler', 'flux', 'vad', 'deplacer_membres'], 'le faux bot n’a pas encore ces permissions');
  assert.equal(d.corps.permissions.hubs[0].id, HUB);
  // Sans la permission : 403.
  const voir = await k.compteAvec('voir1234', 'Voir', ['tickets.voir']);
  assert.equal((await k.api('/vocaux/config', voir.jeton)).statut, 403);
  assert.equal((await k.api('/moi', voir.jeton)).corps.peutConfigurerVocaux, false);
  const conf = await k.compteAvec('voca1234', 'Voca', ['vocaux.configurer']);
  assert.equal((await k.api('/vocaux/config', conf.jeton)).statut, 200);
  // Interaction signée : un bouton du panneau d'un salon inconnu → refus éphémère des salons vocaux.
  const i = await k.interaction({ type: 3, guild_id: k.GUILD, channel_id: '710000000000000099', member: { user: { id: U1, username: 'lea' }, roles: [], permissions: '0' }, data: { custom_id: 'vc:l:710000000000000099', component_type: 2 } });
  assert.equal(i.statut, 200);
  assert.equal(i.corps.data.flags, 64);
  assert.ok(TABLES.some(([n]) => n === 'vocaux_salons'));
});

/** Commande /voc <sous> tapée dans `salon` (fil du salon vocal, ou un autre salon). */
const voc = (salonId, userId, sous, options = [], extra = {}) => ({
  type: 2,
  guild_id: GUILD,
  channel_id: salonId,
  locale: 'fr',
  member: { user: { id: userId }, roles: extra.roles ?? [], permissions: extra.permissions ?? '0' },
  data: { name: 'voc', options: [{ type: 1, name: sous, options }], resolved: extra.resolved ?? {} },
});

test('/voc : définition enregistrée (huit sous-commandes) ; chaque sous-commande dans son salon', async () => {
  const def = definitionsCommandes().find(c => c.name === 'voc');
  assert.deepEqual(def.options.map(o => o.name), ['renommer', 'verrouiller', 'deverrouiller', 'expulser', 'ami-ajouter', 'ami-retirer', 'limite', 'proprietaire']);
  assert.deepEqual(def.contexts, [0]);
  const k = await monter();
  const salon = await rejoindreHub(k, U1, 'Léa');
  await k.moteur.evenement('VOICE_STATE_UPDATE', vs(U2, salon, 'Max'));
  const r = await k.bot.interaction(voc(salon, U1, 'renommer', [{ name: 'nom', type: 3, value: 'Ranked' }]));
  assert.match(r.data.content, /Salon renommé : Ranked/);
  assert.equal(r.data.flags, 64);
  assert.match((await k.bot.interaction(voc(salon, U1, 'verrouiller'))).data.content, /verrouillé/);
  assert.equal((await lireSalon(k.base, salon)).verrouille, true);
  const ami = await k.bot.interaction(voc(salon, U1, 'ami-ajouter', [{ name: 'membre', type: 6, value: U3 }], { resolved: { users: { [U3]: { id: U3, username: 'chloe' } } } }));
  assert.match(ami.data.content, /chloe/);
  assert.equal(BigInt(k.rest.appels.filter(a => a.methode === 'PATCH' && a.chemin === `/channels/${salon}`).at(-1).corps.permission_overwrites.find(o => o.id === U3).allow) & CONNECT, CONNECT);
  assert.match((await k.bot.interaction(voc(salon, U1, 'ami-retirer', [{ name: 'membre', type: 6, value: U3 }]))).data.content, /n’est plus/);
  assert.match((await k.bot.interaction(voc(salon, U1, 'limite', [{ name: 'places', type: 4, value: 3 }]))).data.content, /3 places/);
  assert.match((await k.bot.interaction(voc(salon, U1, 'deverrouiller'))).data.content, /déverrouillé/);
  // Hors du salon, mais en étant dedans : la commande vise ce salon.
  assert.match((await k.bot.interaction(voc('710000000000000013', U1, 'expulser', [{ name: 'membre', type: 6, value: U2 }]))).data.content, /a été expulsé du salon\./);
  assert.deepEqual(k.rest.appels.filter(a => a.chemin === `/guilds/${GUILD}/members/${U2}`).at(-1).corps, { channel_id: null });
  // Max revient (salon ouvert), Léa lui donne la propriété ; la sienne passe, plus de contrôle pour elle.
  await k.moteur.evenement('VOICE_STATE_UPDATE', vs(U2, salon, 'Max'));
  assert.match((await k.bot.interaction(voc(salon, U1, 'proprietaire', [{ name: 'membre', type: 6, value: U2 }]))).data.content, /Max est maintenant propriétaire/);
  assert.match((await k.bot.interaction(voc(salon, U1, 'verrouiller'))).data.content, /Seul le propriétaire/);
  // Personne ne peut viser un absent ; quelqu'un sans salon temporaire reçoit l'explication.
  assert.match((await k.bot.interaction(voc(salon, U2, 'proprietaire', [{ name: 'membre', type: 6, value: U4 }]))).data.content, /n’est pas dans ton salon/);
  assert.match((await k.bot.interaction(voc('710000000000000013', U4, 'verrouiller'))).data.content, /Utilise cette commande dans ton salon vocal temporaire/);
  k.moteur.arreter();
});

test('/voc : sous-commande désactivée ou réservée à des rôles (administrateur toujours permis) ; salons vocaux éteints', async () => {
  const k = await monter();
  const salon = await rejoindreHub(k, U1, 'Léa');
  await k.base.executer("INSERT INTO tickets_reglages (cle, valeur, maj_le) VALUES ('vocaux_commandes', ?, '2026-01-01T00:00:00.000Z')", [JSON.stringify({ renommer: { actif: false, roles: [] }, limite: { actif: true, roles: ['720000000000000055'] } })]);
  assert.match((await k.bot.interaction(voc(salon, U1, 'renommer', [{ name: 'nom', type: 3, value: 'X' }]))).data.content, /désactivée/);
  assert.match((await k.bot.interaction(voc(salon, U1, 'limite', [{ name: 'places', type: 4, value: 2 }]))).data.content, /réservée à certains rôles/);
  assert.match((await k.bot.interaction(voc(salon, U1, 'limite', [{ name: 'places', type: 4, value: 2 }], { roles: ['720000000000000055'] }))).data.content, /2 places/);
  assert.match((await k.bot.interaction(voc(salon, U1, 'limite', [{ name: 'places', type: 4, value: 4 }], { permissions: '8' }))).data.content, /4 places/);
  await regler(k.base, { actif: false });
  assert.match((await k.bot.interaction(voc(salon, U1, 'verrouiller'))).data.content, /ne sont pas activés/);
  k.moteur.arreter();
});

test('application : commandes /voc réglées (vocaux.configurer) ; interaction /voc signée', async () => {
  const k = await bancTickets({ banc });
  await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { guildId: k.GUILD } });
  const r = await k.api('/vocaux/config/commandes', undefined, { methode: 'PUT', corps: { expulser: { actif: false }, limite: { actif: true, roles: [STAFF] } } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.deepEqual([r.corps.commandes.expulser.actif, r.corps.commandes.limite.roles, r.corps.commandes.renommer.actif], [false, [STAFF], true]);
  assert.equal((await k.api('/vocaux/config/commandes', undefined, { methode: 'PUT', corps: { limite: { roles: ['@everyone'] } } })).statut, 400);
  const i = await k.interaction({ type: 2, guild_id: k.GUILD, channel_id: '710000000000000013', member: { user: { id: U1, username: 'lea' }, roles: [], permissions: '0' }, data: { name: 'voc', options: [{ type: 1, name: 'verrouiller', options: [] }] } });
  assert.equal(i.statut, 200);
  assert.equal(i.corps.data.flags, 64);
  assert.match(i.corps.data.content, /not enabled/, 'sans locale ni compte lié : anglais');
});
