/**
 * Options de chaque hub des salons vocaux temporaires (vocaux/hubs.mjs, docs/esport/vocaux.md « Options de chaque
 * hub ») : salons créés rangés juste sous le hub (PATCH des positions après le déplacement), salons verrouillés
 * visibles mais pas joignables (ou cachés), hub caché aux personnes sans accès (surcharges d'origine gardées puis
 * rendues), resynchronisation quand les rôles d'un événement changent ; rôles staff supplémentaires d'un événement.
 * Faux Discord, jamais de réseau réel.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc } from './aide.mjs';
import { bancTickets, fauxDiscordRest } from './tickets-aide.mjs';
import { baseMigree } from './base.mjs';
import { creerMoteurVocaux } from '../noyau/vocaux/moteur.mjs';
import { validerVocaux, VOCAUX_DEFAUT } from '../noyau/vocaux/reglages.mjs';
import { PV, surchargesSalon } from '../noyau/vocaux/salons.mjs';
import { CLE_ORIGINES, positionsSousHub } from '../noyau/vocaux/hubs.mjs';

const JETON = 'jeton-bot-de-test-jamais-reel';
const GUILD = '700000000000000001';
const BOT = '424242424242424242';
const CAT = '710000000000000050';
const HUB = '710000000000000051';
const GENERAL = '710000000000000059';
const MEMBRE_R = '720000000000000077';
const STAFF = '720000000000000001';
const U1 = '810000000000000001';
const silencieux = { error() {}, warn() {}, info() {} };
const VC = PV.VOIR | PV.CONNECTER;
const a = (o, id) => BigInt(o.find(x => x.id === id)?.allow ?? '0');
const d = (o, id) => BigInt(o.find(x => x.id === id)?.deny ?? '0');

test('positions : salons du hub juste sous lui, du plus récent au plus ancien ; seuls les salons déplacés sont envoyés', () => {
  const salons = [
    { id: '710000000000000060', type: 0, parent_id: CAT, position: 0 }, // salon écrit : ignoré
    { id: '710000000000000058', type: 2, parent_id: CAT, position: 2 }, // au-dessus du hub : ne bouge pas
    { id: HUB, type: 2, parent_id: CAT, position: 3 },
    { id: GENERAL, type: 2, parent_id: CAT, position: 4 },
    { id: '910000000000000001', type: 2, parent_id: CAT, position: 5 }, // ancien salon du hub
    { id: '910000000000000002', type: 2, parent_id: CAT, position: 6 }, // nouveau, mis en bas par Discord
    { id: '710000000000000070', type: 2, parent_id: '710000000000000099', position: 4 }, // autre catégorie
  ];
  assert.deepEqual(positionsSousHub(salons, { id: HUB, parent_id: CAT }, ['910000000000000002', '910000000000000001']), [
    { id: '910000000000000002', position: 4 },
    { id: GENERAL, position: 6 }, // l'ancien salon (5) est déjà à sa place : non envoyé
  ]);
  // Déjà rangé : rien à envoyer.
  const ranges = [{ id: HUB, type: 2, parent_id: CAT, position: 3 }, { id: '910000000000000002', type: 2, parent_id: CAT, position: 4 }, { id: GENERAL, type: 2, parent_id: CAT, position: 5 }];
  assert.deepEqual(positionsSousHub(ranges, { id: HUB, parent_id: CAT }, ['910000000000000002']), []);
});

async function moteurAvecHub(hub = {}) {
  const base = await baseMigree();
  const t = new Date().toISOString();
  await base.executer('INSERT INTO tickets_reglages (cle, valeur, maj_le) VALUES (?, ?, ?)', ['general', JSON.stringify({ actif: false, guildId: GUILD, langue: 'fr' }), t]);
  await base.executer('INSERT INTO tickets_reglages (cle, valeur, maj_le) VALUES (?, ?, ?)', ['vocaux', JSON.stringify({ actif: true, hubs: [{ id: HUB, nom: 'Créer un salon', modeleNom: 'Salon de {pseudo}', ...hub }], rolesStaff: [STAFF], delaiSuppressionS: 5, maxParMembre: 1 }), t]);
  const rest = fauxDiscordRest();
  rest.etat.salons.set(CAT, { id: CAT, type: 4, name: 'Vocaux', guild_id: GUILD, position: 2, permission_overwrites: [] });
  rest.etat.salons.set(HUB, { id: HUB, type: 2, name: 'Créer un salon', guild_id: GUILD, parent_id: CAT, position: 3, permission_overwrites: [{ id: MEMBRE_R, type: 0, allow: String(PV.VOIR), deny: '0' }] });
  rest.etat.salons.set(GENERAL, { id: GENERAL, type: 2, name: 'Général', guild_id: GUILD, parent_id: CAT, position: 4, permission_overwrites: [] });
  const moteur = creerMoteurVocaux({ base, fetch: rest.fetch, jetonBot: JETON, botId: () => BOT, delaiMs: 60, journal: silencieux });
  await moteur.evenement('GUILD_CREATE', { id: GUILD, channels: [...rest.etat.salons.values()], voice_states: [], members: [] });
  return { base, rest, moteur };
}
const vs = (userId, channelId, nom = 'Léa', roles = []) => ({ guild_id: GUILD, user_id: userId, channel_id: channelId, member: { user: { id: userId, username: nom.toLowerCase() }, nick: nom, roles } });

test('placement : après le déplacement du membre, PATCH des positions qui place le nouveau salon juste sous le hub ; option coupée : rien', async () => {
  const k = await moteurAvecHub();
  // Discord ignore `position` : le salon créé arrive en bas de la catégorie.
  k.rest.programme.push({ si: (m, c) => m === 'POST' && c === `/guilds/${GUILD}/channels`, statut: 201, corps: { id: '910000000000000001', type: 2, parent_id: CAT, position: 9, name: 'Salon de Léa' } });
  k.rest.etat.salons.set('910000000000000001', { id: '910000000000000001', type: 2, guild_id: GUILD, parent_id: CAT, position: 9, permission_overwrites: [] });
  await k.moteur.evenement('VOICE_STATE_UPDATE', vs(U1, HUB));
  await k.moteur.attendre();
  const iCree = k.rest.appels.findIndex(x => x.methode === 'POST' && x.chemin === `/guilds/${GUILD}/channels`);
  const iDeplace = k.rest.appels.findIndex(x => x.methode === 'PATCH' && x.chemin === `/guilds/${GUILD}/members/${U1}`);
  const iPos = k.rest.appels.findIndex(x => x.methode === 'PATCH' && x.chemin === `/guilds/${GUILD}/channels`);
  assert.ok(iCree < iDeplace && iDeplace < iPos, 'création, déplacement, puis positions');
  assert.equal(k.rest.appels[iCree].corps.position, 4, 'position demandée à la création aussi');
  assert.deepEqual(k.rest.appels[iPos].corps, [
    { id: '910000000000000001', position: 4 },
    { id: GENERAL, position: 5 },
  ]);
  assert.equal(k.moteur.cache.salons.get('910000000000000001').position, 4, 'cache mis à jour');
  k.moteur.arreter();

  const k2 = await moteurAvecHub({ placerSousHub: false });
  await k2.moteur.evenement('VOICE_STATE_UPDATE', vs(U1, HUB));
  await k2.moteur.attendre();
  assert.ok(!k2.rest.appels.some(x => x.methode === 'PATCH' && x.chemin === `/guilds/${GUILD}/channels`));
  k2.moteur.arreter();
});

test('placement : limite de débit (429) → un seul nouvel essai après le délai annoncé', async () => {
  // Les attentes du client Discord ne retiennent pas le processus : une minuterie le garde en vie pendant le test.
  const garde = setInterval(() => {}, 1000);
  const k = await moteurAvecHub();
  k.rest.programme.push({ si: (m, c) => m === 'PATCH' && c === `/guilds/${GUILD}/channels`, statut: 429, corps: { message: 'You are being rate limited.', retry_after: 0.3, global: false }, entetes: { 'Retry-After': '0.3' } });
  await k.moteur.evenement('VOICE_STATE_UPDATE', vs(U1, HUB));
  await k.moteur.attendre();
  const pos = k.rest.appels.filter(x => x.methode === 'PATCH' && x.chemin === `/guilds/${GUILD}/channels`);
  assert.equal(pos.length, 2);
  assert.deepEqual(pos[0].corps, pos[1].corps);
  k.moteur.arreter();
  clearInterval(garde);
});

test('salon verrouillé : caché aux personnes sans accès (défaut) ou visible mais pas joignable ; catégorie privée jamais élargie ; ouvert : inchangé', () => {
  const base = [{ id: GUILD, type: 0, allow: '0', deny: '0' }, { id: MEMBRE_R, type: 0, allow: String(PV.VOIR), deny: '0' }];
  const s = { verrouille: true, proprietaireId: U1, amis: [{ id: '810000000000000003', nom: 'Ami' }], basePermissions: base };
  const cache = surchargesSalon(s, { guildId: GUILD, botId: BOT, rolesStaff: [STAFF] });
  for (const id of [GUILD, MEMBRE_R]) assert.equal(d(cache, id) & VC, VC, `${id} : ni voir ni se connecter`);
  for (const id of [STAFF, U1, '810000000000000003', BOT]) assert.equal(a(cache, id) & VC, VC, id);
  const visible = surchargesSalon(s, { guildId: GUILD, botId: BOT, rolesStaff: [STAFF], visibleNonJoignable: true });
  for (const id of [GUILD, MEMBRE_R]) {
    assert.equal(a(visible, id) & PV.VOIR, PV.VOIR, `${id} voit`);
    assert.equal(d(visible, id) & PV.CONNECTER, PV.CONNECTER, `${id} ne se connecte pas`);
  }
  for (const id of [STAFF, U1, BOT]) assert.equal(a(visible, id) & VC, VC, id);
  // Hub dans une catégorie privée (@everyone sans « voir ») : l'option ne l'ouvre pas à tout le serveur.
  const prive = surchargesSalon({ ...s, basePermissions: [{ id: GUILD, type: 0, allow: '0', deny: String(PV.VOIR) }] }, { guildId: GUILD, botId: BOT, visibleNonJoignable: true });
  assert.equal(d(prive, GUILD) & PV.VOIR, PV.VOIR);
  // Ouvert : surcharges du hub telles quelles.
  const ouvert = surchargesSalon({ ...s, verrouille: false }, { guildId: GUILD, botId: BOT, visibleNonJoignable: true });
  assert.equal(d(ouvert, GUILD), 0n);
  assert.equal(a(ouvert, MEMBRE_R), PV.VOIR);
});

test('réglages : options des hubs (placement oui, visibles non, hub caché : événement oui, ordinaire non et seulement avec des rôles)', () => {
  const s = validerVocaux({ hubs: [{ id: HUB }, { id: GENERAL, masquerHub: true }] }, { ...VOCAUX_DEFAUT });
  assert.deepEqual([s.hubs[0].placerSousHub, s.hubs[0].visibleNonJoignable, s.hubs[0].masquerHub, s.hubs[0].rolesHub], [true, false, false, []]);
  assert.equal(s.hubs[1].masquerHub, true);
  assert.equal(validerVocaux({ hubs: [{ id: HUB, tournoiId: '11111111-2222-4333-8444-555555555555' }] }, { ...VOCAUX_DEFAUT }).hubs[0].masquerHub, true);
});

async function application() {
  const k = await bancTickets({ banc });
  // Rôles existants du serveur (lus pour vérifier les rôles staff supplémentaires).
  k.discord.etat.listerCrees = true;
  for (const [id, name] of [['720000000000000090', 'Casteur'], ['720000000000000091', 'Admin LAN']]) k.discord.etat.roles.set(id, { id, name, position: 1, permissions: '0' });
  await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { guildId: k.GUILD, guildNom: 'Club' } });
  k.discord.etat.salons.set(HUB, { id: HUB, type: 2, name: 'Créer un salon', guild_id: k.GUILD, parent_id: CAT, position: 3, permission_overwrites: [{ id: MEMBRE_R, type: 0, allow: String(PV.VOIR), deny: '0' }] });
  return k;
}
const patchs = (k, id) => k.discord.appels.filter(x => x.methode === 'PATCH' && x.chemin === `/channels/${id}`);
const origines = async k => JSON.parse((await k.b.base.premier('SELECT valeur FROM tickets_reglages WHERE cle = ?', [CLE_ORIGINES]))?.valeur ?? '{}');

test('hub ordinaire caché : @everyone sans « voir », rôles qui peuvent l’utiliser et bot admis ; surcharges d’origine gardées puis rendues', async () => {
  const k = await application();
  const R = '720000000000000088';
  // Option sans rôle : sans effet (rien n'est caché).
  await k.api('/vocaux/config', undefined, { methode: 'PUT', corps: { hubs: [{ id: HUB, masquerHub: true }] } });
  assert.equal(patchs(k, HUB).length, 0);
  const r = await k.api('/vocaux/config', undefined, { methode: 'PUT', corps: { hubs: [{ id: HUB, masquerHub: true, rolesHub: [R] }] } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  const o = patchs(k, HUB).at(-1).corps.permission_overwrites;
  assert.equal(d(o, k.GUILD) & PV.VOIR, PV.VOIR);
  for (const id of [R, STAFF].filter(x => x === R)) assert.equal(a(o, id) & VC, VC, id);
  assert.equal(a(o, k.APP) & (VC | PV.DEPLACER), VC | PV.DEPLACER, 'le bot garde son accès');
  assert.equal(a(o, MEMBRE_R), PV.VOIR, 'surcharges d’origine gardées');
  assert.deepEqual((await origines(k))[HUB], [{ id: MEMBRE_R, type: 0, allow: String(PV.VOIR), deny: '0' }]);
  // Option coupée : surcharges d'origine rendues, plus rien de gardé.
  await k.api('/vocaux/config', undefined, { methode: 'PUT', corps: { hubs: [{ id: HUB, masquerHub: false, rolesHub: [R] }] } });
  assert.deepEqual(patchs(k, HUB).at(-1).corps.permission_overwrites, [{ id: MEMBRE_R, type: 0, allow: String(PV.VOIR), deny: '0' }]);
  assert.deepEqual(await origines(k), {});
  // Hub retiré pendant qu'il est caché : rendu aussi.
  await k.api('/vocaux/config', undefined, { methode: 'PUT', corps: { hubs: [{ id: HUB, masquerHub: true, rolesHub: [R] }] } });
  await k.api('/vocaux/config', undefined, { methode: 'PUT', corps: { hubs: [] } });
  assert.deepEqual(patchs(k, HUB).at(-1).corps.permission_overwrites, [{ id: MEMBRE_R, type: 0, allow: String(PV.VOIR), deny: '0' }]);
  assert.deepEqual(await origines(k), {});
});

test('option « visibles mais pas joignables » changée : salons verrouillés déjà ouverts recalculés', async () => {
  const k = await application();
  await k.api('/vocaux/config', undefined, { methode: 'PUT', corps: { hubs: [{ id: HUB, verrouille: true }] } });
  const SALON = '910000000000000005';
  k.discord.etat.salons.set(SALON, { id: SALON, type: 2, guild_id: k.GUILD, parent_id: CAT, permission_overwrites: [] });
  const t = new Date().toISOString();
  await k.b.base.executer("INSERT INTO vocaux_salons (salon_id, guild_id, hub_id, proprietaire_id, verrouille, base_permissions, cree_le, maj_le) VALUES (?, ?, ?, ?, 1, '[]', ?, ?)", [SALON, k.GUILD, HUB, U1, t, t]);
  await k.api('/vocaux/config', undefined, { methode: 'PUT', corps: { hubs: [{ id: HUB, verrouille: true, visibleNonJoignable: true }] } });
  const o = patchs(k, SALON).at(-1).corps.permission_overwrites;
  assert.equal(a(o, k.GUILD) & PV.VOIR, PV.VOIR);
  assert.equal(d(o, k.GUILD) & PV.CONNECTER, PV.CONNECTER);
  await k.api('/vocaux/config', undefined, { methode: 'PUT', corps: { hubs: [{ id: HUB, verrouille: true, visibleNonJoignable: false }] } });
  assert.equal(d(patchs(k, SALON).at(-1).corps.permission_overwrites, k.GUILD) & VC, VC);
});

test('hub d’événement caché (défaut) : resynchronisé quand une équipe, le rôle staff ou les rôles staff supplémentaires changent ; rendu à la suppression de l’événement', async () => {
  const k = await application();
  const e = await k.api('/evenements', undefined, { methode: 'POST', corps: { nom: 'The Nuke End' } });
  const id = e.corps.evenement.id;
  const CASTER = '720000000000000060';
  const SUP = '720000000000000090';
  const r = await k.api(`/evenements/${id}/vocaux`, undefined, { methode: 'POST', corps: { id: HUB, rolesAutorises: [CASTER] } });
  assert.equal(r.corps.hubs[0].masquerHub, true);
  let o = patchs(k, HUB).at(-1).corps.permission_overwrites;
  assert.equal(d(o, k.GUILD) & PV.VOIR, PV.VOIR);
  assert.equal(a(o, CASTER) & VC, VC);
  // Équipe ajoutée (rôle créé) : son rôle voit le hub.
  const eq = (await k.api(`/evenements/${id}/equipes`, undefined, { methode: 'POST', corps: { equipes: [{ nom: 'Ligne Zéro', tag: 'LZ0' }] } })).corps.equipes[0];
  o = patchs(k, HUB).at(-1).corps.permission_overwrites;
  assert.equal(a(o, eq.roleId) & VC, VC, 'rôle de l’équipe admis');
  // Rôle staff créé (catégorie de tickets) et rôle staff supplémentaire : admis aussi.
  const cat = (await k.api('/tickets/config/categories', undefined, { methode: 'POST', corps: { nom: { fr: 'Inscription', en: 'Registration' }, modeleNom: 't-{numero}' } })).corps.id;
  const m = await k.api(`/evenements/${id}`, undefined, { methode: 'PATCH', corps: { categoriesTickets: [cat], discord: { staffRolesSup: [SUP] } } });
  assert.equal(m.statut, 200, JSON.stringify(m.corps));
  const staff = m.corps.evenement.discord.staffRoleId;
  o = patchs(k, HUB).at(-1).corps.permission_overwrites;
  for (const x of [staff, SUP, CASTER, eq.roleId]) assert.equal(a(o, x) & VC, VC, x);
  // Équipe retirée : son rôle ne voit plus le hub.
  await k.api(`/evenements/${id}/equipes/${eq.id}`, undefined, { methode: 'DELETE' });
  o = patchs(k, HUB).at(-1).corps.permission_overwrites;
  assert.ok(!o.some(x => x.id === eq.roleId));
  // Événement supprimé : hub rendu tel qu'avant (surcharges d'origine).
  assert.equal((await k.api(`/evenements/${id}`, undefined, { methode: 'DELETE' })).statut, 200);
  assert.deepEqual(patchs(k, HUB).at(-1).corps.permission_overwrites, [{ id: MEMBRE_R, type: 0, allow: String(PV.VOIR), deny: '0' }]);
  assert.deepEqual(await origines(k), {});
});

test('rôles staff supplémentaires : ajoutés aux catégories de tickets (là où ils n’étaient pas), ouverts sur les salons de l’événement ; retirés sans être supprimés', async () => {
  const k = await application();
  const SUP = '720000000000000090';
  const DEJA = '720000000000000091';
  const cat = async nom => (await k.api('/tickets/config/categories', undefined, { methode: 'POST', corps: { nom: { fr: nom, en: nom }, modeleNom: 't-{numero}' } })).corps.id;
  const c1 = await cat('Inscription');
  const c2 = await cat('Support');
  // DEJA traite déjà les tickets de c1 (avant l'événement) : jamais retiré par l'événement.
  await k.b.base.executer('UPDATE tickets_categories SET roles_discord = ? WHERE id = ?', [JSON.stringify([DEJA]), c1]);
  const id = (await k.api('/evenements', undefined, { methode: 'POST', corps: { nom: 'LAN' } })).corps.evenement.id;
  const SALON = '910000000000000007';
  const t = new Date().toISOString();
  k.discord.etat.salons.set(SALON, { id: SALON, type: 2, guild_id: k.GUILD, permission_overwrites: [] });
  await k.b.base.executer("INSERT INTO vocaux_salons (salon_id, guild_id, hub_id, proprietaire_id, tournoi_id, verrouille, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, 1, ?, ?)", [SALON, k.GUILD, HUB, U1, id, t, t]);
  const m = await k.api(`/evenements/${id}`, undefined, { methode: 'PATCH', corps: { categoriesTickets: [c1, c2], discord: { staffRolesSup: [{ id: SUP, supprimerFin: false }, { id: DEJA, supprimerFin: false }] } } });
  assert.equal(m.statut, 200, JSON.stringify(m.corps));
  assert.deepEqual(m.corps.evenement.discord.staffRolesSup.map(e => [e.id, e.nom, e.supprimerFin, e.cree]), [[SUP, 'Casteur', false, false], [DEJA, 'Admin LAN', false, false]]);
  const roles = async c => JSON.parse((await k.b.base.premier('SELECT roles_discord FROM tickets_categories WHERE id = ?', [c])).roles_discord);
  assert.ok((await roles(c1)).includes(SUP) && (await roles(c2)).includes(SUP) && (await roles(c2)).includes(DEJA));
  for (const x of [SUP, DEJA]) assert.ok(k.discord.appels.some(p => p.methode === 'PUT' && p.chemin === `/channels/${SALON}/permissions/${x}`), x);
  // Retiré de la liste : retiré de c1 et c2 (ajouts de l'événement) et des salons de l'événement ; DEJA reste dans c1.
  await k.api(`/evenements/${id}`, undefined, { methode: 'PATCH', corps: { discord: { staffRolesSup: [{ id: DEJA }] } } });
  assert.ok(!(await roles(c1)).includes(SUP) && !(await roles(c2)).includes(SUP));
  assert.ok(k.discord.appels.some(p => p.methode === 'DELETE' && p.chemin === `/channels/${SALON}/permissions/${SUP}`));
  // Suppression de l'événement : DEJA retiré de c2 (ajout de l'événement), gardé dans c1 ; aucun rôle supprimé.
  await k.api(`/evenements/${id}`, undefined, { methode: 'DELETE' });
  assert.deepEqual([await roles(c1), await roles(c2)], [[DEJA], []]);
  assert.ok(!k.discord.appels.some(p => p.methode === 'DELETE' && [SUP, DEJA].some(x => p.chemin === `/guilds/${k.GUILD}/roles/${x}`)));
});
