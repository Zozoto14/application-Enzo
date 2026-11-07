/**
 * Bienvenue par rôle (Tickets › Configuration › Bienvenue) : quand un membre reçoit le rôle choisi (ex. « The Nuke
 * End »), Esport HQ le mentionne UNE fois dans le salon choisi. Réglages validés ; titulaires actuels notés sans
 * message à l'activation ; Gateway tenue même tickets désactivés, avec l'intent GUILD_MEMBERS ; repli sans lui si
 * Discord le refuse (4014) ; message d'essai ; export et RGPD. Faux Discord (REST et Gateway), jamais de réseau réel.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc } from './aide.mjs';
import { attendre, bancTickets, fauxDiscordRest, fauxGateway } from './tickets-aide.mjs';
import { baseMigree } from './base.mjs';
import { INTENTS_TICKETS } from '../noyau/tickets/gateway.mjs';
import { creerSuperviseurTickets } from '../noyau/tickets/superviseur.mjs';
import { INTENT_GUILDS, INTENT_MEMBRES, MESSAGE_DEFAUT, intentsVoulus, lireEtatBienvenue, texteBienvenue, validerBienvenue, BIENVENUE_DEFAUT } from '../noyau/tickets/bienvenue.mjs';
import { effacementParDiscord } from '../noyau/tickets/rgpd.mjs';
import { TABLES } from '../noyau/transfert.mjs';

const JETON = 'jeton-bot-de-test-jamais-reel';
const RAPIDE = { attenteMin: 20, attenteMax: 200, hasard: () => 0.5 };
const GUILD = '700000000000000001';
const ROLE = '720000000000000009';
const SALON = '710000000000000013';
const silencieux = { error() {}, warn() {} };

test('réglages : rôle et salon obligatoires pour activer ; activation = nouveau départ ; message par défaut', () => {
  assert.throws(() => validerBienvenue({ actif: true }, { ...BIENVENUE_DEFAUT }, 0), /rôle/);
  assert.throws(() => validerBienvenue({ actif: true, roleId: ROLE }, { ...BIENVENUE_DEFAUT }, 0), /salon/);
  assert.throws(() => validerBienvenue({ roleId: '@everyone' }, { ...BIENVENUE_DEFAUT }, 0), /Identifiant/);
  const t = Date.parse('2026-11-21T12:00:00Z');
  const a = validerBienvenue({ actif: true, roleId: ROLE, salonId: SALON, roleNom: 'The Nuke End', message: '  ' }, { ...BIENVENUE_DEFAUT }, t);
  assert.equal(a.recommencer, true);
  assert.equal(a.reglages.depuis, '2026-11-21T12:00:00.000Z');
  assert.equal(a.reglages.message, MESSAGE_DEFAUT);
  // Message seul modifié : pas de nouveau départ ; rôle changé : nouveau départ.
  assert.equal(validerBienvenue({ message: 'Salut {membre}' }, a.reglages, t + 1).recommencer, false);
  assert.equal(validerBienvenue({ roleId: '720000000000000008' }, a.reglages, t + 1).recommencer, true);
  assert.equal(texteBienvenue('Bienvenue {membre} dans {role} sur {serveur} !', { membreId: '81', role: 'The Nuke End', serveur: 'LZ' }), 'Bienvenue <@81> dans The Nuke End sur LZ !');
});

test('intents : tickets seuls, bienvenue seule, les deux ; repli sans GUILD_MEMBERS', () => {
  assert.equal(intentsVoulus({ actif: true }, { actif: false }), INTENTS_TICKETS);
  assert.equal(intentsVoulus({ actif: false }, { actif: true }), INTENT_GUILDS | INTENT_MEMBRES);
  assert.equal(intentsVoulus({ actif: true }, { actif: true }), INTENTS_TICKETS | INTENT_MEMBRES);
  assert.equal(intentsVoulus({ actif: true }, { actif: true }, { sansMembres: true }), INTENTS_TICKETS);
});

test('configuration dans l’app : serveur requis, titulaires actuels notés sans message, message d’essai, export', async () => {
  const k = await bancTickets({ banc });
  // Sans serveur choisi : refus clair.
  const r0 = await k.api('/tickets/config/bienvenue', undefined, { methode: 'PUT', corps: { actif: true, roleId: ROLE, salonId: SALON } });
  assert.equal(r0.statut, 400);
  await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { guildId: k.GUILD } });
  // Deux titulaires actuels du rôle (et un membre sans le rôle) : notés « existant », aucun message.
  k.discord.programme.push({ si: (m, c) => m === 'GET' && c.startsWith(`/guilds/${GUILD}/members`), statut: 200, corps: [
    { user: { id: '810000000000000001' }, roles: [ROLE] },
    { user: { id: '810000000000000002' }, roles: [] },
    { user: { id: '810000000000000003' }, roles: [ROLE, '1'] },
  ] });
  const r = await k.api('/tickets/config/bienvenue', undefined, { methode: 'PUT', corps: { actif: true, roleId: ROLE, roleNom: 'The Nuke End', salonId: SALON, message: 'Bienvenue {membre} ! 💥' } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.deepEqual(r.corps.titulaires, { ok: true, notes: 2 });
  assert.equal(r.corps.bienvenue.existantsNotes, true);
  assert.equal((await k.b.base.tous("SELECT discord_user_id FROM discord_bienvenues WHERE issue = 'existant' ORDER BY 1", [])).length, 2);
  assert.ok(!k.discord.appels.some(a => a.methode === 'POST' && a.chemin === `/channels/${SALON}/messages`), 'aucune mention à l’activation');
  const c = await k.api('/tickets/config');
  assert.equal(c.corps.bienvenue.roleNom, 'The Nuke End');
  // Message d'essai : dans le salon choisi, sans mentionner personne.
  const essai = await k.api('/tickets/config/bienvenue/test', undefined, { methode: 'POST', corps: {} });
  assert.equal(essai.corps.ok, true);
  const post = k.discord.appels.find(a => a.methode === 'POST' && a.chemin === `/channels/${SALON}/messages`);
  assert.match(post.corps.content, /^🧪 Bienvenue /);
  assert.deepEqual(post.corps.allowed_mentions, { parse: [] });
  // Droit : sans tickets.configurer, refusé.
  const voir = await k.compteAvec('voir1234', 'Voir', ['tickets.voir']);
  assert.equal((await k.api('/tickets/config/bienvenue', voir.jeton, { methode: 'PUT', corps: { actif: false } })).statut, 403);
  // Export de la base : la table suit ; RGPD : les lignes de la personne sont effacées.
  assert.ok(TABLES.some(([n]) => n === 'discord_bienvenues'));
  assert.ok(effacementParDiscord(['810000000000000001']).some(i => i.sql.includes('discord_bienvenues')));
});

async function activerBienvenue(base, { ticketsActifs = false, existantsNotes = true, depuis = '2026-01-01T00:00:00.000Z' } = {}) {
  const t = new Date().toISOString();
  await base.executer('INSERT INTO tickets_reglages (cle, valeur, maj_le) VALUES (?, ?, ?)', ['general', JSON.stringify({ actif: ticketsActifs, guildId: GUILD, guildNom: 'Ligne Zéro', categorieOuverts: '710000000000000010' }), t]);
  await base.executer('INSERT INTO tickets_reglages (cle, valeur, maj_le) VALUES (?, ?, ?)', ['bienvenue', JSON.stringify({ actif: true, roleId: ROLE, roleNom: 'The Nuke End', salonId: SALON, message: 'Bienvenue {membre} dans {role} !', depuis, existantsNotes }), t]);
}

const membre = (id, roles, extra = {}) => ({ guild_id: GUILD, user: { id, username: `u${id.slice(-2)}` }, roles, joined_at: '2026-11-21T12:00:00.000Z', ...extra });

test('Gateway : bienvenue seule (tickets désactivés) → GUILD_MEMBERS demandé ; nouvelle recrue mentionnée UNE fois', async () => {
  const base = await baseMigree();
  await activerBienvenue(base);
  await base.executer("INSERT INTO discord_bienvenues (guild_id, discord_user_id, role_id, issue, accueilli_le) VALUES (?, '810000000000000001', ?, 'existant', '2026-01-01T00:00:00.000Z')", [GUILD, ROLE]);
  const gw = await fauxGateway({ intervalle: 1000 });
  const rest = fauxDiscordRest({ gateway: gw });
  const sup = creerSuperviseurTickets({ base, jetonBot: JETON, fetch: rest.fetch, identifiant: 'p', intervalle: 1_000_000, gateway: RAPIDE, journal: silencieux });
  try {
    const r = await sup.passage();
    assert.equal(r.meneur, true, 'la Gateway est tenue pour la bienvenue seule');
    await attendre(() => sup.etat().gateway?.etat === 'pret');
    const identify = gw.recus.find(m => m.op === 2);
    assert.equal(identify.d.intents, INTENT_GUILDS | INTENT_MEMBRES);
    const conn = gw.connexions[0];
    const postes = () => rest.appels.filter(a => a.methode === 'POST' && a.chemin === `/channels/${SALON}/messages`);
    // Arrivée sans le rôle, puis rôle ajouté : une seule mention, uniquement de cette personne.
    conn.dispatch('GUILD_MEMBER_ADD', membre('810000000000000005', []));
    conn.dispatch('GUILD_MEMBER_UPDATE', membre('810000000000000005', [ROLE]));
    await attendre(() => postes().length === 1);
    assert.equal(postes()[0].corps.content, 'Bienvenue <@810000000000000005> dans The Nuke End !');
    assert.deepEqual(postes()[0].corps.allowed_mentions, { parse: [], users: ['810000000000000005'] });
    // Autres changements de la même personne (pseudo…), titulaire déjà noté, autre serveur, bot : rien.
    conn.dispatch('GUILD_MEMBER_UPDATE', membre('810000000000000005', [ROLE], { nick: 'Nouveau pseudo' }));
    conn.dispatch('GUILD_MEMBER_UPDATE', membre('810000000000000001', [ROLE]));
    conn.dispatch('GUILD_MEMBER_ADD', membre('810000000000000006', [ROLE], { guild_id: '799999999999999999' }));
    conn.dispatch('GUILD_MEMBER_ADD', { ...membre('810000000000000007', [ROLE]), user: { id: '810000000000000007', bot: true } });
    // Arrivée directement avec le rôle (lien d'invitation, onboarding) : accueillie.
    conn.dispatch('GUILD_MEMBER_ADD', membre('810000000000000008', [ROLE]));
    await attendre(() => postes().length === 2);
    await new Promise(ok => setTimeout(ok, 80));
    assert.equal(postes().length, 2);
    assert.equal((await lireEtatBienvenue(base)).dernier.ok, true);
  } finally {
    await sup.arreter();
    await gw.arreter();
  }
});

test('titulaires non lus à l’activation : seules les arrivées après l’activation sont accueillies ; échec noté', async () => {
  const base = await baseMigree();
  await activerBienvenue(base, { existantsNotes: false, depuis: '2026-11-21T00:00:00.000Z' });
  const gw = await fauxGateway({ intervalle: 1000 });
  const rest = fauxDiscordRest({ gateway: gw });
  const sup = creerSuperviseurTickets({ base, jetonBot: JETON, fetch: rest.fetch, identifiant: 'p', intervalle: 1_000_000, gateway: RAPIDE, journal: silencieux });
  try {
    await sup.passage();
    await attendre(() => sup.etat().gateway?.etat === 'pret');
    const conn = gw.connexions[0];
    conn.dispatch('GUILD_MEMBER_UPDATE', membre('810000000000000010', [ROLE], { joined_at: '2025-05-01T00:00:00.000Z' }));
    rest.programme.push({ si: (m, c) => m === 'POST' && c === `/channels/${SALON}/messages`, statut: 403, corps: { code: 50013 } });
    conn.dispatch('GUILD_MEMBER_UPDATE', membre('810000000000000011', [ROLE], { joined_at: '2026-11-21T18:00:00.000Z' }));
    await attendre(async () => (await base.premier("SELECT issue FROM discord_bienvenues WHERE discord_user_id = '810000000000000011'", []))?.issue === 'echec');
    assert.ok(!(await base.premier("SELECT issue FROM discord_bienvenues WHERE discord_user_id = '810000000000000010'", [])), 'arrivé avant l’activation : pas accueilli');
    const e = await lireEtatBienvenue(base);
    assert.deepEqual([e.dernier.ok, e.dernier.statut, e.dernier.code], [false, 403, 50013]);
  } finally {
    await sup.arreter();
    await gw.arreter();
  }
});

test('intent « Server Members » refusé (4014) : la connexion repart sans lui, les tickets continuent ; l’app le dit', async () => {
  const base = await baseMigree();
  await activerBienvenue(base, { ticketsActifs: true });
  const gw = await fauxGateway({ intervalle: 1000 });
  const rest = fauxDiscordRest({ gateway: gw });
  const sup = creerSuperviseurTickets({ base, jetonBot: JETON, fetch: rest.fetch, identifiant: 'p', intervalle: 1_000_000, gateway: RAPIDE, journal: silencieux });
  try {
    await sup.passage();
    await attendre(() => gw.recus.some(m => m.op === 2));
    assert.equal(gw.recus.find(m => m.op === 2).d.intents, INTENTS_TICKETS | INTENT_MEMBRES);
    gw.fermer(gw.connexions[0], 4014);
    await attendre(() => sup.etat().gateway?.etat === 'fatal');
    await sup.passage();
    await attendre(() => gw.recus.filter(m => m.op === 2).length === 2);
    assert.equal(gw.recus.filter(m => m.op === 2)[1].d.intents, INTENTS_TICKETS, 'nouvel IDENTIFY sans GUILD_MEMBERS');
    await attendre(() => sup.etat().gateway?.etat === 'pret');
    assert.equal((await lireEtatBienvenue(base)).membresRefuses, true);
  } finally {
    await sup.arreter();
    await gw.arreter();
  }
});
