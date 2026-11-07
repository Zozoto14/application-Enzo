/**
 * Bot Discord (interactions HTTP), sans réseau réel : signature Ed25519 (clé de
 * test générée ici), PING, liaison serveur ↔ team et joueur ↔ compte par code
 * (expiration, usage unique), chaque commande (non lié, lié sans droit, lié
 * avec droit), isolation entre teams et serveurs, boutons RSVP qui mettent à
 * jour la présence (et l'annonce, rééditée), pings limités aux convoqués liés
 * avec `allowed_mentions` strict, réunions staff jamais annoncées, file (429,
 * réessais, abandon), réponses différées, « c'est maintenant », relances
 * groupées, RGPD, et un parcours de bout en bout vers un faux Discord local.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { debutsDiscord } from '../noyau/discord/rappels.mjs';
import { traiterFile } from '../noyau/discord/file.mjs';
import { texteCharge } from '../noyau/discord/messages.mjs';
import { occurrenceCourte } from '../noyau/discord/embeds.mjs';
import { lireDateSaisie, lireHeureSaisie } from '../noyau/discord/bot/interactions.mjs';
import { verifierSignature } from '../noyau/discord/bot/signature.mjs';
import { definitionsCommandes } from '../noyau/discord/bot/commandes.mjs';
import { permissionsInvitation } from '../noyau/discord/permissions-bot.mjs';
import { banc, CLE, teamAvecMembres } from './aide.mjs';

const APP = '424242424242424242';
const JETON_BOT = 'jeton-bot-de-test-jamais-reel';
const G1 = '700000000000000001';
const G2 = '700000000000000002';
const G3 = '700000000000000003';
const SALON = '710000000000000001';
const SALON_B = '710000000000000002';
const SALON_C = '710000000000000003';
const D = { lea: '800000000000000001', tom: '800000000000000002', coach: '800000000000000003', max: '800000000000000004', bob: '800000000000000005', admin: '800000000000000009', inconnu: '800000000000000099', fond: '800000000000000010' };
const MEMBRES = {
  max12345: { pseudo: 'Max', role: 'manager' },
  coach123: { pseudo: 'Zed', role: 'coach' },
  ana12345: { pseudo: 'Ana', role: 'analyste' },
  lea12345: { pseudo: 'Léa', role: 'joueur' },
  tom12345: { pseudo: 'Tom', role: 'remplacant' },
};
const hexa = o => Buffer.from(o).toString('hex');

async function cles() {
  const paire = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  return { paire, publique: hexa(await crypto.subtle.exportKey('raw', paire.publicKey)) };
}

/** Faux Discord : POST de message → identifiant ; réponses programmables ; tout est enregistré. */
function fauxDiscord() {
  const appels = [];
  const programme = [];
  let n = 0;
  const fetch = async (url, init) => {
    const corps = init.body ? JSON.parse(init.body) : null;
    appels.push({ url: String(url), methode: init.method, corps, entetes: init.headers });
    const r = programme.length > 0 ? programme.shift() : null;
    if (r instanceof Error) throw r;
    if (r) return new Response(r.corps === undefined ? null : JSON.stringify(r.corps), { status: r.statut, headers: r.entetes ?? {} });
    // Salon privé (MP) : « 96 » suivi de la fin de l'identifiant du destinataire.
    if (init.method === 'POST' && /\/users\/@me\/channels$/.test(url)) return new Response(JSON.stringify({ id: `96${corps.recipient_id.slice(2)}`, type: 1 }), { status: 200 });
    if (init.method === 'POST' && /\/channels\/\d+\/messages$/.test(url)) return new Response(JSON.stringify({ id: `90000000000000${String(++n).padStart(4, '0')}` }), { status: 200 });
    return new Response(JSON.stringify({}), { status: 200 });
  };
  const enMp = a => /\/users\/@me\/|\/channels\/96\d+\//.test(a.url);
  // Messages du SALON (les MP sont à part : `mps()`, avec le destinataire).
  const messages = () => appels.filter(a => a.methode === 'POST' && /\/channels\//.test(a.url) && !enMp(a));
  const mps = () => appels.filter(a => a.methode === 'POST' && /\/channels\/96\d+\/messages$/.test(a.url)).map(a => ({ ...a, destinataire: `80${/\/channels\/96(\d+)\//.exec(a.url)[1]}` }));
  return { appels, programme, fetch, messages, mps, editions: () => appels.filter(a => a.methode === 'PATCH' && /\/channels\//.test(a.url)) };
}

async function preparer({ bot = true, attenteDiffere, lienApp = 'https://app.exemple/esport' } = {}) {
  // Réponse différée : pilotée par le test (`p.ralentir = true`), sinon jamais (attente infinie).
  const ralenti = { actif: false };
  attenteDiffere ??= () => (ralenti.actif ? Promise.resolve() : new Promise(() => {}));
  const k = await cles();
  const discord = fauxDiscord();
  const b = await banc({ fetchDiscord: discord.fetch, lienApp, discordBot: bot ? { applicationId: APP, publicKey: k.publique, jetonBot: JETON_BOT } : {}, attenteDiffere });
  const A = await teamAvecMembres(b, { nom: 'Team Alpha', membres: MEMBRES });
  const B = await teamAvecMembres(b, { nom: 'Team Bravo', membres: { bob12345: { pseudo: 'Bob', role: 'joueur' } } });
  const C = await teamAvecMembres(b, { nom: 'Team Charlie', preset: 'personnalise', modules: ['activity_log', 'planning', 'availability', 'discord'], membres: { lea12345: { pseudo: 'Léa', role: 'joueur' } } });
  const s = { ...A.sessions, bob12345: B.sessions.bob12345 };
  const fond = A.sessions.fondateur;
  const differes = [];

  /** Interaction signée (ou altérée) envoyée au serveur. */
  async function interaction(corps, { horodatage = Math.floor(b.horloge.t / 1000), signer = true, cle = k.paire.privateKey, signature } = {}) {
    const texte = JSON.stringify(corps);
    const sig = signature ?? (signer ? hexa(await crypto.subtle.sign('Ed25519', cle, new TextEncoder().encode(`${horodatage}${texte}`))) : undefined);
    const entetes = { 'Content-Type': 'application/json', 'X-Signature-Timestamp': String(horodatage) };
    if (sig) entetes['X-Signature-Ed25519'] = sig;
    const r = await b.traiter(new Request('https://esport.test/discord/interactions', { method: 'POST', headers: entetes, body: texte }), { attendre: p => differes.push(p) });
    const lu = await r.text();
    // Distribution du bus et suivis différés (tâches après la réponse) : attendus ici.
    await Promise.all(differes.splice(0));
    return { statut: r.status, corps: lu ? JSON.parse(lu) : null };
  }
  const utilisateur = id => ({ id, username: `u${id.slice(-3)}`, global_name: `Joueur ${id.slice(-3)}` });
  /** Commande tapée dans un serveur (client Discord en français par défaut : `locale`). */
  const commande = (nom, options = {}, { qui = D.lea, guild = G1, salon = SALON, permissions = '0', locale = 'fr' } = {}) =>
    interaction({
      type: 2,
      ...(locale ? { locale } : {}),
      id: '1',
      token: `jeton-interaction-${nom}`,
      application_id: APP,
      guild_id: guild,
      channel_id: salon,
      channel: { id: salon, name: 'annonces' },
      member: { user: utilisateur(qui), permissions },
      data: { name: nom, options: Object.entries(options).map(([name, value]) => ({ name, value })) },
    });
  const composant = (customId, { qui = D.lea, guild = G1, valeurs, locale = 'fr' } = {}) =>
    interaction({ type: 3, ...(locale ? { locale } : {}), id: '2', token: 'jeton-composant', application_id: APP, guild_id: guild, channel_id: SALON, member: { user: utilisateur(qui), permissions: '0' }, data: { custom_id: customId, component_type: valeurs ? 3 : 2, ...(valeurs ? { values: valeurs } : {}) } });
  const autocomplete = (nom, options, { qui = D.coach, guild = G1, locale = 'fr' } = {}) =>
    interaction({ type: 4, ...(locale ? { locale } : {}), id: '3', token: 't', application_id: APP, guild_id: guild, channel_id: SALON, member: { user: utilisateur(qui), permissions: '0' }, data: { name: nom, options } });

  /** Liaisons : code demandé dans l'app, tapé dans Discord. */
  async function lierServeur(teamId, jeton, guild, salon, admin = D.admin) {
    const code = await b.appel(`/teams/${teamId}/discord/bot/code`, { methode: 'POST', jeton });
    assert.equal(code.statut, 200, JSON.stringify(code.corps));
    return commande('esport-lier-serveur', { code: code.corps.code }, { qui: admin, guild, salon, permissions: '32' });
  }
  async function lierCompte(jeton, discordId, guild = G1) {
    const code = await b.appel('/moi/discord/code', { methode: 'POST', jeton });
    assert.equal(code.statut, 200, JSON.stringify(code.corps));
    return commande('lier', { code: code.corps.code }, { qui: discordId, guild });
  }
  const traiter = (extra = {}) => traiterFile(b.base, { cle: CLE, fetch: discord.fetch, maintenant: b.horloge.t, lienApp, jetonBot: JETON_BOT, ...extra });
  const scrim = (corps = {}, jeton = s.coach123, team = A.teamId) =>
    b.appel(`/teams/${team}/planning`, { methode: 'POST', jeton, corps: { type: 'scrim', titre: 'Scrim Faucons', date: '2026-10-22', heureDebut: '20:30', heureFin: '22:00', ...corps } });
  const texteReponse = r => texteCharge(r.corps.data ?? {});
  return { ralenti, b, k, A, B, C, s, fond, discord, interaction, commande, composant, autocomplete, lierServeur, lierCompte, traiter, scrim, differes, texteReponse };
}

/** Team A liée à G1, Léa et Tom liés ; Zed (coach) lié ; Max (manager) NON lié. */
async function preparerLie(options) {
  const p = await preparer(options);
  const r = await p.lierServeur(p.A.teamId, p.s.max12345, G1, SALON);
  assert.match(p.texteReponse(r), /Serveur lié/, p.texteReponse(r));
  for (const [jeton, id] of [[p.s.lea12345, D.lea], [p.s.tom12345, D.tom], [p.s.coach123, D.coach]]) assert.match(p.texteReponse(await p.lierCompte(jeton, id)), /Compte lié/);
  return p;
}

// ------------------------------------------------------------------ Signature et PING

test('signature Ed25519 : PING → PONG ; signature invalide, absente, autre clé, horodatage trop ancien → 401', async () => {
  const p = await preparer();
  const ping = await p.interaction({ type: 1 });
  assert.equal(ping.statut, 200);
  assert.deepEqual(ping.corps, { type: 1 });
  assert.equal((await p.interaction({ type: 1 }, { signer: false })).statut, 401);
  assert.equal((await p.interaction({ type: 1 }, { signature: 'ab'.repeat(64) })).statut, 401);
  const autre = await cles();
  assert.equal((await p.interaction({ type: 1 }, { cle: autre.paire.privateKey })).statut, 401);
  const ancien = Math.floor(p.b.horloge.t / 1000) - 301;
  const r = await p.interaction({ type: 1 }, { horodatage: ancien });
  assert.equal(r.statut, 401);
  assert.equal(r.corps.code, 'signature');
  assert.equal((await p.interaction({ type: 1 }, { horodatage: Math.floor(p.b.horloge.t / 1000) + 400 })).statut, 401, 'futur lointain refusé');
  // Corps modifié après signature.
  const horodatage = Math.floor(p.b.horloge.t / 1000);
  const sig = hexa(await crypto.subtle.sign('Ed25519', p.k.paire.privateKey, new TextEncoder().encode(`${horodatage}{"type":1}`)));
  assert.equal((await verifierSignature({ clePublique: p.k.publique, signature: sig, horodatage: String(horodatage), corps: '{"type":2}', maintenant: p.b.horloge.t })).ok, false);
  assert.equal((await verifierSignature({ clePublique: p.k.publique, signature: sig, horodatage: String(horodatage), corps: '{"type":1}', maintenant: p.b.horloge.t })).ok, true);
  assert.equal((await verifierSignature({ clePublique: 'pas-une-cle', signature: sig, horodatage: String(horodatage), corps: '{"type":1}' })).ok, false);
});

test('bot non configuré : /discord/interactions répond 503, /sante le dit, aucun code de liaison', async () => {
  const p = await preparer({ bot: false });
  const r = await p.b.traiter(new Request('https://esport.test/discord/interactions', { method: 'POST', body: '{"type":1}' }));
  assert.equal(r.status, 503);
  assert.equal((await p.b.appel('/sante')).corps.bot, false);
  assert.equal((await p.b.appel('/moi/discord/code', { methode: 'POST', jeton: p.s.lea12345 })).corps.code, 'bot-absent');
  const etat = await p.b.appel(`/teams/${p.A.teamId}/discord/bot`, { jeton: p.s.max12345 });
  assert.deepEqual([etat.corps.disponible, etat.corps.invitation], [false, null]);
});

// ------------------------------------------------------------------ Liaisons par code

test('liaison serveur : admin du serveur seulement, code à usage unique, salon par défaut ; état dans l’app (discord.manage)', async () => {
  const p = await preparer();
  assert.equal((await p.b.appel('/sante')).corps.bot, true);
  // Le code ne se demande qu'avec discord.manage.
  assert.equal((await p.b.appel(`/teams/${p.A.teamId}/discord/bot/code`, { methode: 'POST', jeton: p.s.lea12345 })).statut, 403);
  const code = (await p.b.appel(`/teams/${p.A.teamId}/discord/bot/code`, { methode: 'POST', jeton: p.s.max12345 })).corps;
  assert.match(code.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(code.commande, `/esport-lier-serveur code:${code.code}`);
  // Pas admin du serveur Discord : refusé, et le code reste valable.
  assert.match(p.texteReponse(await p.commande('esport-lier-serveur', { code: code.code }, { qui: D.admin, permissions: '2048' })), /administrateur du serveur/);
  const r = await p.commande('esport-lier-serveur', { code: code.code.toLowerCase().replace('-', ' ') }, { qui: D.admin, permissions: '8' });
  assert.equal(r.corps.type, 4);
  assert.equal(r.corps.data.flags, 64, 'réponse éphémère');
  assert.match(p.texteReponse(r), /Team Alpha/);
  assert.match(r.corps.data.embeds[0].description, new RegExp(`<#${SALON}>`));
  // Usage unique.
  assert.match(p.texteReponse(await p.commande('esport-lier-serveur', { code: code.code }, { qui: D.admin, permissions: '8' })), /Code invalide/);
  const etat = (await p.b.appel(`/teams/${p.A.teamId}/discord/bot`, { jeton: p.s.max12345 })).corps;
  assert.equal(etat.serveur.salonNom, 'annonces');
  assert.equal(etat.serveur.serveur, `${G1.slice(0, 4)}…${G1.slice(-4)}`, 'identifiant masqué');
  assert.match(etat.invitation, new RegExp(`client_id=${APP}&scope=bot%20applications.commands&permissions=${permissionsInvitation()}`));
  assert.equal((await p.b.appel(`/teams/${p.A.teamId}/discord/bot`, { jeton: p.s.lea12345 })).statut, 403, 'un Joueur ne voit pas qui est lié');
  const journal = await p.b.base.tous("SELECT action FROM journal WHERE team_id = ? AND action = 'discord.server_linked'", [p.A.teamId]);
  assert.equal(journal.length, 1);
  // Délier depuis l'app.
  assert.equal((await p.b.appel(`/teams/${p.A.teamId}/discord/bot/serveur`, { methode: 'DELETE', jeton: p.s.max12345 })).statut, 200);
  assert.equal((await p.b.appel(`/teams/${p.A.teamId}/discord/bot`, { jeton: p.s.max12345 })).corps.serveur, null);
});

test('liaison joueur : code de 10 minutes, usage unique, mauvais genre refusé ; liste « qui est lié » ; délier (app et Discord)', async () => {
  const p = await preparer();
  await p.lierServeur(p.A.teamId, p.s.max12345, G1, SALON);
  // Code expiré.
  let code = (await p.b.appel('/moi/discord/code', { methode: 'POST', jeton: p.s.lea12345 })).corps;
  p.b.horloge.t += 10 * 60_000 + 1000;
  assert.match(p.texteReponse(await p.commande('lier', { code: code.code })), /expiré/);
  // Un code de serveur ne lie pas un compte.
  const codeServeur = (await p.b.appel(`/teams/${p.A.teamId}/discord/bot/code`, { methode: 'POST', jeton: p.s.max12345 })).corps.code;
  assert.match(p.texteReponse(await p.commande('lier', { code: codeServeur })), /Code invalide/);
  // Nouveau code : lié, puis réutilisation refusée.
  code = (await p.b.appel('/moi/discord/code', { methode: 'POST', jeton: p.s.lea12345 })).corps;
  assert.match(p.texteReponse(await p.commande('lier', { code: code.code })), /Compte lié.*Léa/s);
  assert.match(p.texteReponse(await p.commande('lier', { code: code.code }, { qui: D.tom })), /Code invalide/);
  assert.deepEqual((await p.b.appel('/moi/discord', { jeton: p.s.lea12345 })).corps, { botDisponible: true, lie: true, discordNom: 'Joueur 001', lieLe: new Date(p.b.horloge.t).toISOString() });
  // Le code n'est jamais stocké en clair.
  assert.ok(!JSON.stringify(await p.b.base.tous('SELECT * FROM discord_codes', [])).includes(code.code.replace('-', '')));
  const comptes = (await p.b.appel(`/teams/${p.A.teamId}/discord/bot`, { jeton: p.s.max12345 })).corps.comptes;
  assert.deepEqual(comptes.filter(c => c.lie).map(c => c.pseudo), ['Léa']);
  // Délier depuis Discord, puis relier et délier depuis l'app.
  assert.match(p.texteReponse(await p.commande('delier')), /Compte délié/);
  assert.equal((await p.b.appel('/moi/discord', { jeton: p.s.lea12345 })).corps.lie, false);
  await p.lierCompte(p.s.lea12345, D.lea);
  assert.equal((await p.b.appel('/moi/discord', { methode: 'DELETE', jeton: p.s.lea12345 })).statut, 200);
  assert.match(p.texteReponse(await p.commande('prochain')), /Lie ton compte avec \/lier/);
  // Anti-force brute : 10 codes tapés par 10 minutes et par utilisateur Discord.
  for (let n = 0; n < 10; n++) await p.commande('lier', { code: 'AAAA-AAAA' }, { qui: D.inconnu });
  assert.match(p.texteReponse(await p.commande('lier', { code: 'AAAA-AAAA' }, { qui: D.inconnu })), /Trop de demandes/);
});

// ------------------------------------------------------------------ Commandes : non lié, sans droit, avec droit

test('commandes : un utilisateur Discord non lié reçoit « Lie ton compte avec /lier » (sauf /aide et /lier)', async () => {
  const p = await preparerLie();
  for (const [nom, options] of [['prochain', {}], ['planning', {}], ['rsvp', {}], ['dispo', {}], ['taches', {}], ['strat', { map: 'ascent' }], ['resume', { titre: 'R', lien: 'https://x.fr', type: 'x' }], ['evenement-creer', { type: 'scrim', titre: 'X', date: 'demain', heure: '20h' }], ['relancer', { evenement: 'x|y' }], ['delier', {}]]) {
    const r = await p.commande(nom, options, { qui: D.inconnu });
    assert.match(p.texteReponse(r), /Lie ton compte avec \/lier/, nom);
    assert.equal(r.corps.data.flags, 64, `${nom} : éphémère`);
  }
  const aide = await p.commande('aide', {}, { qui: D.inconnu });
  assert.match(p.texteReponse(aide), /\/prochain/);
  assert.deepEqual(aide.corps.data.allowed_mentions, { parse: [] });
  // Max (manager) n'est pas lié : même réponse, et rien n'est journalisé à son nom.
  assert.match(p.texteReponse(await p.commande('planning', {}, { qui: D.max })), /Lie ton compte/);
});

test('commandes de lecture : /prochain, /planning (pagination), /dispo, /taches, /strat — avec droit, et sans module', async () => {
  const p = await preparerLie();
  // Planning : 8 événements (pagination à 6), dont un où Léa n'est pas convoquée.
  for (let n = 0; n < 7; n++) assert.equal((await p.scrim({ titre: `Scrim ${n}`, date: `2026-10-${21 + Math.floor(n / 2)}`, heureDebut: n % 2 ? '18:00' : '20:30', heureFin: n % 2 ? '19:30' : '22:00' })).statut, 200);
  assert.equal((await p.scrim({ titre: 'Réunion coachs', type: 'meeting', convocation: { groupes: [], membres: ['coach123', 'max12345'] } })).statut, 200);
  const prochain = await p.commande('prochain');
  assert.equal(prochain.corps.data.flags, 64);
  assert.match(prochain.corps.data.embeds[0].description, /7 événements/);
  assert.ok(!p.texteReponse(prochain).includes('Réunion coachs'), 'pas convoquée');
  assert.match(prochain.corps.data.embeds[0].fields[0].value, /<t:\d+:f> · <t:\d+:R>/);
  const planning = await p.commande('planning', { jours: 7 });
  const emb = planning.corps.data.embeds[0];
  assert.equal(emb.fields.length, 6);
  assert.match(emb.footer.text, /Page 1 \/ 2/);
  const boutons = planning.corps.data.components[0].components;
  assert.deepEqual(boutons.map(x => x.custom_id), ['pg:planning.7:0', 'pg:noop:1', 'pg:planning.7:2']);
  assert.equal(boutons[0].disabled, true);
  const page2 = await p.composant('pg:planning.7:2');
  assert.equal(page2.corps.type, 7, 'la pagination met à jour le message');
  assert.equal(page2.corps.data.embeds[0].fields.length, 2);
  assert.match(page2.corps.data.embeds[0].footer.text, /Page 2 \/ 2/);
  // Dispos.
  await p.b.appel(`/teams/${p.A.teamId}/dispos/moi/regles`, { methode: 'PUT', jeton: p.s.lea12345, corps: { regles: [{ jour: 1, debut: '18:00', fin: '23:00' }, { jour: 3, debut: '10:00', fin: '12:00', type: 'indisponible' }] } });
  const dispo = await p.commande('dispo');
  assert.equal(dispo.corps.data.embeds[0].fields.find(f => f.name === 'Lundi').value, '🟢 18:00–23:00');
  assert.equal(dispo.corps.data.embeds[0].fields.find(f => f.name === 'Mercredi').value, '🔴 10:00–12:00');
  assert.equal(dispo.corps.data.components[0].components[0].url, 'https://app.exemple/esport');
  // Tâches : en retard d'abord.
  await p.b.appel(`/teams/${p.A.teamId}/taches`, { methode: 'POST', jeton: p.s.coach123, corps: { titre: 'Revoir la VOD', assigne: 'lea12345', echeance: '2026-10-25' } });
  await p.b.appel(`/teams/${p.A.teamId}/taches`, { methode: 'POST', jeton: p.s.coach123, corps: { titre: 'Lineups B', assigne: 'lea12345', echeance: '2026-10-10' } });
  const taches = await p.commande('taches');
  assert.match(taches.corps.data.embeds[0].description, /2 ouvertes · 🔴 \*\*1 en retard\*\*/);
  assert.match(taches.corps.data.embeds[0].fields[0].name, /🔴 Lineups B/);
  // Strat : entrée validée du playbook, map en autocomplétion.
  const e = await p.b.appel(`/teams/${p.A.teamId}/playbook`, { methode: 'POST', jeton: p.s.coach123, corps: { titre: 'Exec A main', carte: { cle: 'ascent', nom: 'Ascent' }, side: 'attaque', type: 'execute', statut: 'validee', tags: ['rapide'] } });
  assert.equal(e.statut, 200, JSON.stringify(e.corps));
  await p.b.appel(`/teams/${p.A.teamId}/playbook`, { methode: 'POST', jeton: p.s.coach123, corps: { titre: 'Brouillon B', carte: { cle: 'ascent', nom: 'Ascent' }, side: 'defense', type: 'retake' } });
  const ac = await p.autocomplete('strat', [{ name: 'map', value: 'asc', focused: true }], { qui: D.lea });
  assert.deepEqual(ac.corps, { type: 8, data: { choices: [{ name: 'Ascent', value: 'ascent' }] } });
  const strat = await p.commande('strat', { map: 'Ascent' });
  assert.equal(strat.corps.data.embeds[0].fields.length, 1, 'seulement les validées');
  assert.match(p.texteReponse(strat), /Exec A main[\s\S]*Attaque · Execute[\s\S]*`rapide`/);
  assert.match(strat.corps.data.embeds[0].thumbnail.url, /media\.valorant-api\.com\/maps\/7eaecc1b/);
  // Module absent (Team Charlie, preset minimal, liée à G3) : refus lisible.
  await p.lierServeur(p.C.teamId, p.fond, G3, SALON_C);
  for (const [nom, options, motif] of [['taches', {}, /Objectifs et tâches n’est pas activé/], ['strat', { map: 'ascent' }, /module n’est pas activé/], ['resume', { titre: 'Réu', lien: 'https://x.fr/r', type: '00000000-0000-4000-8000-000000000001' }, /module n’est pas activé|permission/]]) {
    assert.match(p.texteReponse(await p.commande(nom, options, { guild: G3 })), motif, nom);
  }
  // Journalisé, dans la bonne team.
  const j = await p.b.base.tous("SELECT meta FROM journal WHERE team_id = ? AND action = 'discord.command_used' AND acteur_id = 'lea12345'", [p.A.teamId]);
  assert.ok(['prochain', 'planning', 'dispo', 'taches', 'strat'].every(c => j.some(l => JSON.parse(l.meta).commande === c)));
});

test('commandes d’écriture : /resume (dépôt), /evenement-creer et /relancer réservés au staff, avec les vrais droits', async () => {
  const p = await preparerLie();
  // /resume : Léa (joueur) peut déposer ; type en autocomplétion.
  const types = await p.autocomplete('resume', [{ name: 'type', value: '', focused: true }], { qui: D.lea });
  const hebdo = types.corps.data.choices.find(c => /Hebdo/.test(c.name));
  assert.ok(hebdo, JSON.stringify(types.corps));
  const dep = await p.commande('resume', { titre: 'Débrief du scrim', lien: 'https://youtu.be/abc123', type: hebdo.value });
  assert.match(p.texteReponse(dep), /Réunion déposée/);
  assert.equal((await p.b.base.premier("SELECT titre, depose_par FROM reunions WHERE titre = 'Débrief du scrim'", [])).depose_par, 'lea12345');
  assert.match(p.texteReponse(await p.commande('resume', { titre: 'X', lien: 'pas un lien', type: hebdo.value })), /adresse http/);
  // /evenement-creer : Léa (joueur) n'a pas planning.create.
  assert.match(p.texteReponse(await p.commande('evenement-creer', { type: 'scrim', titre: 'Scrim pirate', date: 'demain', heure: '20h' })), /pas la permission/);
  assert.equal(await p.b.base.premier("SELECT id FROM planning_evenements WHERE titre = 'Scrim pirate'", []), null);
  // Zed (coach) : créé, convoqués = joueurs (pas le staff, jamais les Propriétaires).
  const cree = await p.commande('evenement-creer', { type: 'match', titre: 'Match de ligue', date: '24/10', heure: '20h30', duree: 90 }, { qui: D.coach });
  assert.match(p.texteReponse(cree), /Événement créé/, p.texteReponse(cree));
  const ev = await p.b.base.premier("SELECT * FROM planning_evenements WHERE titre = 'Match de ligue'", []);
  assert.deepEqual(JSON.parse(ev.convocation).groupes, ['joueurs'], 'convocation : les joueurs');
  assert.deepEqual((await p.b.appel(`/teams/${p.A.teamId}/planning/${ev.id}`, { jeton: p.s.coach123 })).corps.concernes.sort(), ['lea12345', 'tom12345']);
  assert.equal(ev.debut, '2026-10-24T18:30:00.000Z', '20:30 à Paris');
  assert.equal(ev.fin, '2026-10-24T20:00:00.000Z');
  assert.equal(ev.cree_par, 'coach123');
  assert.match(p.texteReponse(await p.commande('evenement-creer', { type: 'meeting', titre: 'Staff', date: 'demain', heure: 'midi' }, { qui: D.coach })), /Heure illisible/);
  // /relancer : autocomplétion (staff seulement), relance groupée.
  const choix = (await p.autocomplete('relancer', [{ name: 'evenement', value: 'ligue', focused: true }], { qui: D.coach })).corps.data.choices;
  assert.equal(choix.length, 1);
  assert.equal((await p.autocomplete('relancer', [{ name: 'evenement', value: '', focused: true }], { qui: D.lea })).corps.data.choices.length, 0, 'un joueur ne voit rien à relancer');
  assert.match(p.texteReponse(await p.commande('relancer', { evenement: choix[0].value })), /pas la permission/);
  await p.traiter();
  const avant = p.discord.messages().length;
  const r = await p.commande('relancer', { evenement: choix[0].value }, { qui: D.coach });
  assert.match(p.texteReponse(r), /Relance envoyée/);
  await p.traiter();
  // Relances par MP (défaut) : un MP à chaque sans-réponse lié, rien dans le salon (ils sont tous joints).
  assert.equal(p.discord.messages().length, avant, 'aucun message dans le salon');
  const relances = p.discord.mps();
  assert.deepEqual(relances.map(m => m.destinataire).sort(), [D.lea, D.tom].sort());
  for (const m of relances) {
    assert.equal(m.corps.content, undefined, 'un MP ne mentionne personne');
    assert.deepEqual(m.corps.allowed_mentions, { parse: [] });
    assert.match(m.corps.embeds[0].author.name, /Relance/);
    assert.equal(m.corps.enforce_nonce, true, 'nonce : un réessai ne double pas le MP');
  }
  // Journal : création et relance au nom des comptes liés.
  const j = await p.b.base.tous("SELECT action, acteur_id FROM journal WHERE team_id = ? AND action IN ('event.created', 'attendance.relance')", [p.A.teamId]);
  assert.deepEqual(j.map(l => [l.action, l.acteur_id]).sort(), [['attendance.relance', 'coach123'], ['event.created', 'coach123']]);
});

// ------------------------------------------------------------------ Isolation

test('isolation : chaque serveur ne voit que ses teams ; un bouton d’une autre team ou d’un autre serveur ne fait rien', async () => {
  const p = await preparerLie();
  await p.lierServeur(p.B.teamId, p.B.sessions.fondateur, G2, SALON_B);
  await p.lierCompte(p.s.bob12345, D.bob, G2);
  await p.scrim({ titre: 'Scrim secret Alpha' });
  // Bob (Bravo) sur le serveur d'Alpha : aucune team.
  assert.match(p.texteReponse(await p.commande('planning', {}, { qui: D.bob })), /membre d’aucune team liée à ce serveur/);
  // Bob sur son serveur : il ne voit pas Alpha.
  assert.ok(!p.texteReponse(await p.commande('planning', {}, { qui: D.bob, guild: G2 })).includes('Secret'));
  // Serveur non lié.
  assert.match(p.texteReponse(await p.commande('planning', {}, { guild: '700000000000000077' })), /lié à aucune team/);
  // Léa (Alpha) sur le serveur de Bravo.
  assert.match(p.texteReponse(await p.commande('prochain', {}, { guild: G2 })), /membre d’aucune team/);
  // Bouton RSVP d'un événement d'Alpha cliqué sur le serveur de Bravo : ignoré.
  const ev = await p.b.base.premier("SELECT id, debut FROM planning_evenements WHERE titre = 'Scrim secret Alpha'", []);
  const id = `r:${ev.id}:${occurrenceCourte(ev.debut)}:o`;
  assert.match(p.texteReponse(await p.composant(id, { qui: D.bob, guild: G2 })), /introuvable sur ce serveur/);
  assert.match(p.texteReponse(await p.composant(id, { guild: G2 })), /membre d’aucune team liée à ce serveur/);
  // Bob ne répond pas pour Alpha même sur le bon serveur.
  assert.match(p.texteReponse(await p.composant(id, { qui: D.bob })), /membre d’aucune team/);
  assert.equal((await p.b.base.tous('SELECT * FROM presences WHERE evenement_id = ?', [ev.id])).length, 0);
  // Option « team » : seulement une team liée à ce serveur.
  assert.match(p.texteReponse(await p.commande('planning', { team: p.B.teamId })), /pas liée à ce serveur/);
  // La file : chaque team poste dans SON salon (deux convoqués pour Bravo : annonce d'équipe, pas un MP).
  await p.scrim({ titre: 'Scrim Bravo', convocation: { groupes: [], membres: ['bob12345', 'principal'] } }, p.B.sessions.fondateur, p.B.teamId);
  await p.traiter();
  const salons = Object.fromEntries(p.discord.messages().map(m => [m.corps.embeds[0].title, m.url]));
  assert.match(salons['⚔️ Scrim · Scrim secret Alpha'], new RegExp(`/channels/${SALON}/messages$`));
  assert.match(salons['⚔️ Scrim · Scrim Bravo'], new RegExp(`/channels/${SALON_B}/messages$`));
});

// ------------------------------------------------------------------ Annonces, pings et RSVP

test('annonce d’un scrim : embed soigné, mentions des SEULS convoqués liés, allowed_mentions strict, boutons RSVP', async () => {
  const p = await preparerLie();
  await p.b.appel(`/teams/${p.A.teamId}/discord/parametres/event_created`, { methode: 'PUT', jeton: p.s.max12345, corps: { modele: 'GG à tous @everyone {titre}' } });
  // Convocation (planning/convocations.mjs) : les joueurs (Léa, Tom), plus Ana (non liée) et Zed cochés.
  assert.equal((await p.scrim({ titre: 'Scrim @here vs Ascent Kings', lieu: 'Ascent', convocation: { groupes: ['joueurs'], membres: ['ana12345', 'coach123'] } })).statut, 200);
  await p.traiter();
  const [m] = p.discord.messages();
  assert.equal(m.url, `https://discord.com/api/v10/channels/${SALON}/messages`);
  assert.equal(m.entetes.Authorization, `Bot ${JETON_BOT}`);
  // Convoqués : Léa, Tom, Ana, Zed ; liés : Léa, Tom, Zed. Max (Manager, lié ou non) n'est pas convoqué.
  assert.deepEqual(m.corps.content.split(' ').sort(), [D.lea, D.tom, D.coach].map(id => `<@${id}>`).sort());
  assert.deepEqual([...m.corps.allowed_mentions.users].sort(), [D.lea, D.tom, D.coach].sort());
  assert.deepEqual(Object.keys(m.corps.allowed_mentions).sort(), ['parse', 'users']);
  assert.deepEqual(m.corps.allowed_mentions.parse, []);
  assert.ok(!/@everyone|@here/.test(texteCharge(m.corps)), 'mentions de masse neutralisées');
  assert.equal(m.corps.username, undefined);
  const e = m.corps.embeds[0];
  assert.equal(e.color, 0x7c3aed);
  assert.match(e.title, /^⚔️ Scrim · Scrim/);
  assert.equal(e.author.name, '📣 Nouvel événement');
  assert.match(e.fields[0].value, /^<t:\d+:F>\n<t:\d+:R>$/);
  assert.equal(e.fields.find(f => f.name === '🗺️ Map').value, 'Ascent');
  assert.match(e.thumbnail.url, /listviewicon\.png$/);
  const convoques = e.fields.find(f => f.name.startsWith('👥 Convoqués')).value;
  assert.match(convoques, /Ana/, 'non liés : cités par leur pseudo');
  assert.match(convoques, new RegExp(`<@${D.lea}>`));
  assert.ok(!convoques.includes('Fondateur'), 'jamais les Propriétaires par défaut');
  assert.equal(e.fields.find(f => f.name === '🗳️ Réponses').value, '✅ **0** Oui · 🤔 **0** Peut-être · ❌ **0** Non · ⏳ 4 sans réponse');
  assert.equal(e.footer.text, 'Team Alpha · Esport');
  assert.equal(e.url, 'https://app.exemple/esport');
  const boutons = m.corps.components[0].components;
  assert.deepEqual(boutons.map(b => [b.style, b.label, b.emoji.name]), [[3, 'Oui', '✅'], [2, 'Peut-être', '🤔'], [4, 'Non', '❌'], [5, 'Ouvrir dans l’app', '📲']]);
  // L'annonce est retenue pour être éditée.
  const annonce = await p.b.base.premier('SELECT * FROM discord_annonces', []);
  assert.equal(annonce.message_id, '900000000000000001');

  // Ping désactivé pour les scrims : annonce sans aucune mention.
  assert.equal((await p.b.appel(`/teams/${p.A.teamId}/discord/bot/pings/scrim`, { methode: 'PUT', jeton: p.s.max12345, corps: { ping: false } })).statut, 200);
  await p.scrim({ titre: 'Scrim sans ping' });
  await p.traiter();
  const sansPing = p.discord.messages().at(-1).corps;
  assert.equal(sansPing.content, undefined);
  assert.deepEqual(sansPing.allowed_mentions, { parse: [] });
});

test('boutons RSVP : un clic met à jour la présence (visible dans l’app) et réédite l’annonce avec les compteurs', async () => {
  const p = await preparerLie();
  await p.scrim({ convocation: { groupes: ['joueurs'], membres: ['coach123'] } });
  await p.traiter();
  const [annonce] = p.discord.messages();
  const oui = annonce.corps.components[0].components[0].custom_id;
  const r = await p.composant(oui);
  assert.equal(r.corps.type, 4);
  assert.equal(r.corps.data.flags, 64);
  assert.match(p.texteReponse(r), /C’est noté[\s\S]*Oui/);
  // Visible dans l'app.
  const planning = (await p.b.appel(`/teams/${p.A.teamId}/planning`, { jeton: p.s.lea12345 })).corps.occurrences.find(o => o.titre === 'Scrim Faucons');
  assert.equal(planning.monRsvp, 'oui');
  // Tom : Non ; l'annonce est ÉDITÉE à chaque réponse (jamais un nouveau message).
  await p.composant(oui.replace(/:o$/, ':n'), { qui: D.tom });
  await p.traiter();
  assert.equal(p.discord.messages().length, 1, 'pas de nouveau message');
  const editions = p.discord.editions().slice(-1);
  assert.equal(editions[0].url, `https://discord.com/api/v10/channels/${SALON}/messages/900000000000000001`);
  assert.equal(editions[0].corps.embeds[0].fields.find(f => f.name === '🗳️ Réponses').value, '✅ **1** Oui · 🤔 **0** Peut-être · ❌ **1** Non · ⏳ 1 sans réponse');
  assert.deepEqual(editions[0].corps.allowed_mentions, { parse: [] });
  assert.equal(editions[0].corps.content, undefined, 'une édition ne remet aucune mention');
  // /rsvp : menu des événements, puis la carte avec les boutons.
  const menu = await p.commande('rsvp', {}, { qui: D.coach });
  const options = menu.corps.data.components[0].components[0].options;
  assert.equal(options.length, 1);
  const carte = await p.composant('rs', { qui: D.coach, valeurs: [options[0].value] });
  assert.equal(carte.corps.type, 7);
  assert.match(carte.corps.data.embeds[0].description, /Pas encore répondu/);
  await p.composant(carte.corps.data.components[0].components[1].custom_id, { qui: D.coach });
  assert.equal((await p.b.base.premier("SELECT rsvp FROM presences WHERE compte_id = 'coach123'", [])).rsvp, 'peut_etre');
  // Événement terminé : refusé par le service (même contrôle que l'API).
  p.b.horloge.t = Date.parse('2026-10-23T00:00:00Z');
  assert.match(p.texteReponse(await p.composant(oui)), /terminé/);
});

test('réunions staff jamais annoncées ; réunion avec des joueurs annoncée', async () => {
  const p = await preparerLie();
  await p.scrim({ type: 'meeting', titre: 'Réunion staff', convocation: { groupes: ['staff'] } });
  await p.scrim({ type: 'meeting', titre: 'Réunion d’équipe', convocation: { groupes: [], membres: ['coach123', 'lea12345'] } });
  await p.traiter();
  const titres = p.discord.messages().map(m => m.corps.embeds[0].title);
  assert.deepEqual(titres, ['📋 Réunion · Réunion d’équipe']);
  assert.deepEqual(p.discord.messages()[0].corps.allowed_mentions.users.sort(), [D.coach, D.lea].sort());
  // Ni rappel ni « c'est maintenant » pour la réunion staff.
  p.b.horloge.t = Date.parse('2026-10-22T18:25:00Z');
  assert.equal(await debutsDiscord(p.b.base, { maintenant: p.b.horloge.t }), 2);
  await p.b.appel('/sante', { methode: 'POST' });
  await p.traiter();
  assert.ok(!p.discord.messages().some(m => /Réunion staff/.test(texteCharge(m.corps))));
});

test('« c’est maintenant » : publié une fois au début, sans re-mentionner les convoqués déjà pingés par l’annonce', async () => {
  const p = await preparerLie();
  await p.scrim({ convocation: { groupes: [], membres: ['lea12345', 'ana12345'] } });
  await p.traiter();
  p.b.horloge.t = Date.parse('2026-10-22T18:27:00Z');
  assert.equal(await debutsDiscord(p.b.base, { maintenant: p.b.horloge.t }), 1);
  assert.equal(await debutsDiscord(p.b.base, { maintenant: p.b.horloge.t + 60_000 }), 0, 'une seule fois');
  await p.b.appel('/sante', { methode: 'POST' });
  await p.traiter();
  const m = p.discord.messages().at(-1).corps;
  assert.equal(m.embeds[0].author.name, '🔴 C’est maintenant !');
  // Léa a été mentionnée par l'annonce : un ping UNE seule fois par événement.
  assert.equal(p.discord.messages()[0].corps.content, `<@${D.lea}>`);
  assert.equal(m.content, undefined);
  assert.deepEqual(m.allowed_mentions, { parse: [] });
});

// ------------------------------------------------------------------ File : 429, réessais, abandon

test('file du bot : 429 (attente de Discord), erreur 5xx (réessai), 403 (abandon), repli webhook sans serveur', async () => {
  const p = await preparerLie();
  // L'envoi part juste après la requête : Discord répond 429 au premier, la team attend.
  p.discord.programme.push({ statut: 429, corps: { retry_after: 12.5, global: false } });
  await p.scrim({ titre: 'Un' });
  await p.scrim({ titre: 'Deux' });
  const s = await p.b.base.premier('SELECT bloque_jusqua FROM discord_serveurs WHERE team_id = ?', [p.A.teamId]);
  assert.equal(s.bloque_jusqua, new Date(p.b.horloge.t + 13_000).toISOString());
  assert.equal(p.discord.messages().length, 1, 'un seul essai pendant le blocage');
  assert.equal((await p.b.base.tous("SELECT * FROM discord_file WHERE statut = 'attente' AND prochain_essai_le = ?", [s.bloque_jusqua])).length, 2, 'les deux attendent la fin du blocage');
  let bilan = await p.traiter();
  assert.deepEqual(bilan, { envoyes: 0, abandonnes: 0, reportes: 0 }, 'rien n’est dû avant la fin du blocage');
  p.b.horloge.t += 14_000;
  p.discord.programme.push({ statut: 502 });
  bilan = await p.traiter();
  assert.deepEqual(bilan, { envoyes: 1, abandonnes: 0, reportes: 1 });
  const echoue = await p.b.base.premier("SELECT * FROM discord_file WHERE statut = 'attente'", []);
  assert.equal(echoue.essais, 1);
  assert.match(echoue.derniere_erreur, /HTTP 502/);
  assert.equal(echoue.prochain_essai_le, new Date(p.b.horloge.t + 60_000).toISOString(), 'nouvel essai dans 1 min');
  p.b.horloge.t += 61_000;
  p.discord.programme.push({ statut: 403 });
  bilan = await p.traiter();
  assert.deepEqual(bilan, { envoyes: 0, abandonnes: 1, reportes: 0 });
  const j = await p.b.base.tous("SELECT meta FROM journal WHERE action = 'discord.delivery_abandoned'", []);
  assert.match(JSON.parse(j[0].meta).motif, /Bot ou salon refusé/);
  assert.ok(!JSON.stringify(await p.b.base.tous('SELECT * FROM journal', [])).includes(JETON_BOT), 'jamais le jeton du bot');
  // Serveur délié : le webhook reprend (embed, sans boutons interactifs ni mentions d'utilisateurs).
  await p.b.appel(`/teams/${p.A.teamId}/discord/bot/serveur`, { methode: 'DELETE', jeton: p.s.max12345 });
  await p.b.appel(`/teams/${p.A.teamId}/discord/webhook`, { methode: 'PUT', jeton: p.s.max12345, corps: { url: 'https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcd' } });
  await p.scrim({ titre: 'Quatre' });
  const w = p.discord.appels.at(-1);
  assert.match(w.url, /\/api\/webhooks\//);
  assert.equal(w.entetes.Authorization, undefined);
  assert.deepEqual(w.corps.allowed_mentions, { parse: [] });
  assert.ok(w.corps.components.every(r => r.components.every(c => c.style === 5)), 'webhook : seulement le bouton lien');
  assert.match(w.corps.embeds[0].title, /Quatre/);
});

test('bot sans jeton sur le serveur : interactions possibles, messages abandonnés avec un motif clair', async () => {
  const k = await cles();
  const discord = fauxDiscord();
  const b = await banc({ fetchDiscord: discord.fetch, discordBot: { applicationId: APP, publicKey: k.publique } });
  assert.equal((await b.appel('/sante')).corps.bot, false);
  const A = await teamAvecMembres(b, { nom: 'Team Alpha', membres: MEMBRES });
  await b.base.executer("INSERT INTO discord_serveurs (team_id, guild_id, salon_id, lie_par_discord, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?)", [A.teamId, G1, SALON, D.admin, new Date(b.horloge.t).toISOString(), new Date(b.horloge.t).toISOString()]);
  await b.appel(`/teams/${A.teamId}/planning`, { methode: 'POST', jeton: A.sessions.coach123, corps: { type: 'scrim', titre: 'Sans jeton', date: '2026-10-22', heureDebut: '20:30', heureFin: '22:00' } });
  assert.equal(discord.appels.length, 0);
  assert.match((await b.base.premier("SELECT derniere_erreur FROM discord_file WHERE statut = 'abandonne'", [])).derniere_erreur, /DISCORD_BOT_TOKEN/);
});

// ------------------------------------------------------------------ Réponse différée

test('réponse différée : au-delà du délai, type 5 éphémère puis suivi par PATCH du message d’origine', async () => {
  const p = await preparerLie();
  p.ralenti.actif = true;
  const r = await p.commande('prochain');
  assert.deepEqual(r.corps, { type: 5, data: { flags: 64 } });
  const suivi = p.discord.appels.at(-1);
  assert.equal(suivi.methode, 'PATCH');
  assert.equal(suivi.url, `https://discord.com/api/v10/webhooks/${APP}/jeton-interaction-prochain/messages/@original`);
  assert.match(texteCharge(suivi.corps), /Tes prochains événements/);
  assert.equal(suivi.corps.flags, undefined);
  assert.deepEqual(suivi.corps.allowed_mentions, { parse: [] });
  // Pagination différée : mise à jour (type 6).
  assert.deepEqual((await p.composant('pg:taches:1')).corps, { type: 6 });
});

// ------------------------------------------------------------------ RGPD, saisies, commandes

test('RGPD : la liaison Discord est dans l’export et disparaît avec le compte', async () => {
  const p = await preparerLie();
  const exp = (await p.b.appel('/moi/export', { jeton: p.s.lea12345 })).corps;
  assert.deepEqual(exp.discord, { lie: true, discordUserId: D.lea, discordNom: 'Joueur 001', lieLe: new Date(p.b.horloge.t).toISOString() });
  assert.equal((await p.b.appel(`/admin/comptes/lea12345/export`, { jeton: p.fond })).corps.discord.lie, true);
  assert.equal((await p.b.appel('/moi', { methode: 'DELETE', jeton: p.s.lea12345 })).statut, 200);
  assert.equal(await p.b.base.premier("SELECT * FROM discord_comptes WHERE compte_id = 'lea12345'", []), null);
  assert.match(p.texteReponse(await p.commande('prochain')), /Lie ton compte/);
});

test('saisies de /evenement-creer, définitions des commandes', () => {
  const t = Date.parse('2026-10-20T10:00:00Z');
  assert.equal(lireDateSaisie('demain', 'Europe/Paris', t), '2026-10-21');
  assert.equal(lireDateSaisie("Aujourd'hui", 'Europe/Paris', t), '2026-10-20');
  assert.equal(lireDateSaisie('24/10', 'Europe/Paris', t), '2026-10-24');
  assert.equal(lireDateSaisie('02/01', 'Europe/Paris', t), '2027-01-02', 'date passée : l’an prochain');
  assert.equal(lireDateSaisie('2026-12-31', 'Europe/Paris', t), '2026-12-31');
  assert.equal(lireDateSaisie('31/02', 'Europe/Paris', t), null);
  assert.equal(lireHeureSaisie('20h30'), '20:30');
  assert.equal(lireHeureSaisie('9h'), '09:00');
  assert.equal(lireHeureSaisie('25:00'), null);
  const defs = definitionsCommandes();
  assert.deepEqual(defs.map(d => d.name).sort(), ['aide', 'delier', 'dispo', 'esport-lier-serveur', 'evenement-creer', 'lier', 'planning', 'prochain', 'relancer', 'resume', 'rsvp', 'strat', 'taches', 'ticket', 'tickets', 'voc']);
  for (const d of defs) {
    assert.match(d.name, /^[a-z-]{1,32}$/);
    assert.ok(d.description.length <= 100, d.name);
    for (const o of d.options ?? []) assert.ok(o.description.length <= 100 && /^[a-z][a-z-]{0,31}$/.test(o.name), `${d.name}.${o.name}`);
  }
  assert.equal(defs.find(d => d.name === 'esport-lier-serveur').default_member_permissions, '32');
});

// ------------------------------------------------------------------ Bout en bout : faux Discord local (http)

test('e2e : un faux Discord local reçoit l’annonce d’un scrim avec les mentions attendues ; une interaction RSVP signée met à jour la présence', async () => {
  const recus = [];
  const serveur = createServer((req, res) => {
    const morceaux = [];
    req.on('data', m => morceaux.push(m));
    req.on('end', () => {
      recus.push({ methode: req.method, chemin: req.url, auth: req.headers.authorization, corps: JSON.parse(Buffer.concat(morceaux).toString('utf8') || 'null') });
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id: '930000000000000001' }));
    });
  });
  await new Promise(ok => serveur.listen(0, '127.0.0.1', ok));
  const port = serveur.address().port;
  try {
    const k = await cles();
    const versFaux = (url, init) => fetch(String(url).replace('https://discord.com', `http://127.0.0.1:${port}`), init);
    const b = await banc({ fetchDiscord: versFaux, discordBot: { applicationId: APP, publicKey: k.publique, jetonBot: JETON_BOT } });
    const A = await teamAvecMembres(b, { nom: 'Faucons', membres: MEMBRES });
    const signer = async corps => {
      const texte = JSON.stringify(corps);
      const h = String(Math.floor(b.horloge.t / 1000));
      const sig = hexa(await crypto.subtle.sign('Ed25519', k.paire.privateKey, new TextEncoder().encode(h + texte)));
      const r = await b.traiter(new Request('https://esport.test/discord/interactions', { method: 'POST', headers: { 'X-Signature-Ed25519': sig, 'X-Signature-Timestamp': h, 'Content-Type': 'application/json' }, body: texte }));
      return r.json();
    };
    const cmd = (qui, nom, options, permissions = '0') => signer({ type: 2, locale: 'fr', token: 't', guild_id: G1, channel_id: SALON, channel: { id: SALON, name: 'scrims' }, member: { user: { id: qui, username: 'x' }, permissions }, data: { name: nom, options: Object.entries(options).map(([name, value]) => ({ name, value })) } });
    await cmd(D.admin, 'esport-lier-serveur', { code: (await b.appel(`/teams/${A.teamId}/discord/bot/code`, { methode: 'POST', jeton: A.sessions.max12345 })).corps.code }, '8');
    await cmd(D.lea, 'lier', { code: (await b.appel('/moi/discord/code', { methode: 'POST', jeton: A.sessions.lea12345 })).corps.code });
    // Un scrim créé dans l'app : l'annonce part vers le faux Discord.
    await b.appel(`/teams/${A.teamId}/planning`, { methode: 'POST', jeton: A.sessions.coach123, corps: { type: 'scrim', titre: 'Scrim e2e', date: '2026-10-22', heureDebut: '20:30', heureFin: '22:00' } });
    const annonce = recus.find(r => r.chemin === `/api/v10/channels/${SALON}/messages`);
    assert.ok(annonce, JSON.stringify(recus));
    assert.equal(annonce.auth, `Bot ${JETON_BOT}`);
    assert.equal(annonce.corps.content, `<@${D.lea}>`);
    assert.deepEqual(annonce.corps.allowed_mentions, { parse: [], users: [D.lea] });
    assert.equal(annonce.corps.embeds[0].title, '⚔️ Scrim · Scrim e2e');
    // Clic « Oui » simulé et signé.
    const r = await signer({ type: 3, locale: 'fr', token: 't', guild_id: G1, channel_id: SALON, member: { user: { id: D.lea, username: 'lea' }, permissions: '0' }, data: { custom_id: annonce.corps.components[0].components[0].custom_id, component_type: 2 } });
    assert.match(texteCharge(r.data), /C’est noté/);
    const vu = (await b.appel(`/teams/${A.teamId}/planning`, { jeton: A.sessions.lea12345 })).corps.occurrences.find(o => o.titre === 'Scrim e2e');
    assert.equal(vu.monRsvp, 'oui', 'visible dans l’app');
    const presence = (await b.appel(`/teams/${A.teamId}/planning/${vu.evenementId}/occurrences/${encodeURIComponent(vu.cle)}/presence`, { jeton: A.sessions.coach123 })).corps;
    assert.equal(presence.lignes.find(l => l.compte === 'lea12345')?.rsvp, 'oui', JSON.stringify(presence));
    // L'annonce a été rééditée chez le faux Discord.
    const edition = recus.find(x => x.methode === 'PATCH' && x.chemin === `/api/v10/channels/${SALON}/messages/930000000000000001`);
    assert.ok(edition);
    assert.match(edition.corps.embeds[0].fields.find(f => f.name === '🗳️ Réponses').value, /✅ \*\*1\*\* Oui/);
  } finally {
    serveur.close();
  }
});

test('langue des réponses : anglais par défaut ; locale Discord française → français ; le choix de l’utilisateur prime ; la langue par défaut réglée par le Fondateur ne compte plus', async () => {
  const p = await preparerLie();
  const demander = async locale => p.texteReponse(await p.commande('taches', {}, { qui: D.lea, locale }));
  const en = await demander(null);
  assert.match(en, /open|overdue|no tasks|task/i, en);
  assert.equal(await demander('en-US'), en);
  assert.equal(await demander('de'), en, 'toute autre locale : anglais');
  const fr = await demander('fr');
  assert.notEqual(fr, en);
  assert.doesNotMatch(fr, /open/i, fr);
  // Langue par défaut du compte réglée par le Fondateur : sans effet sur le bot (il reste en anglais par défaut).
  assert.equal((await p.b.appel('/comptes/lea12345/langue-defaut', { methode: 'PUT', jeton: p.fond, corps: { langue: 'fr' } })).statut, 200);
  assert.equal(await demander(null), en);
  // Léa choisit le français dans son profil : son choix prime, même avec un client Discord anglais.
  await p.b.appel('/moi/langue', { methode: 'PUT', jeton: p.s.lea12345, corps: { langue: 'fr' } });
  assert.equal(await demander('en-US'), fr);
  // Elle choisit l'anglais : son choix prime sur la locale française.
  await p.b.appel('/moi/langue', { methode: 'PUT', jeton: p.s.lea12345, corps: { langue: 'en' } });
  assert.equal(await demander('fr'), en);
  // Retour à « pas de choix » : la locale décide.
  await p.b.appel('/moi/langue', { methode: 'PUT', jeton: p.s.lea12345, corps: { langue: null } });
  assert.equal(await demander('fr'), fr);
});
