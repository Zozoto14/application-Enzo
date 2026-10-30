/**
 * « Tester les MP » (Réglages › Discord), sans réseau réel : MP de test à des membres choisis (langue du membre,
 * boutons « Test reçu »), cause en clair de chaque échec, simulation d'une relance, relance de test à UN membre,
 * limite anti-abus, journal (bus), et aucun effet sur le registre « déjà pingé », les MP retenus, les réponses.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { texteCharge } from '../noyau/discord/messages.mjs';

const APP = '424242424242424242';
const JETON_BOT = 'jeton-bot-de-test-jamais-reel';
const GUILD = '700000000000000001';
const SALON = '710000000000000001';
const D = { lea: '800000000000000001', tom: '800000000000000002', ana: '800000000000000004' };
const MEMBRES = {
  max12345: { pseudo: 'Max', role: 'manager' },
  lea12345: { pseudo: 'Léa', role: 'joueur' },
  tom12345: { pseudo: 'Tom', role: 'joueur' },
  ana12345: { pseudo: 'Ana', role: 'joueur' },
};
const hexa = o => Buffer.from(o).toString('hex');

function fauxDiscord() {
  const appels = [];
  const programme = [];
  const repondre = (statut, corps) => new Response(JSON.stringify(corps), { status: statut, headers: { 'Content-Type': 'application/json' } });
  const fetch = async (url, init) => {
    const u = new URL(String(url));
    const corps = init.body ? JSON.parse(init.body) : null;
    appels.push({ chemin: u.pathname, methode: init.method, corps });
    const i = programme.findIndex(p => p.si(u.pathname, init.method, corps));
    if (i >= 0) {
      const [r] = programme.splice(i, 1);
      return repondre(r.statut, r.corps);
    }
    if (u.pathname === '/api/v10/users/@me/channels') return repondre(200, { id: `96${corps.recipient_id.slice(2)}`, type: 1 });
    const msg = /^\/api\/v10\/channels\/(\d+)\/messages$/.exec(u.pathname);
    if (msg && init.method === 'POST') return repondre(200, { id: '900000000000000001', channel_id: msg[1] });
    return repondre(200, {});
  };
  const mps = () =>
    appels
      .map(a => ({ ...a, m: /^\/api\/v10\/channels\/96(\d{16})\/messages$/.exec(a.chemin) }))
      .filter(a => a.m && a.methode === 'POST')
      .map(a => ({ ...a, a: `80${a.m[1]}` }));
  return { appels, programme, fetch, mps };
}

async function preparer({ bot = true, serveur = true, lies = ['lea', 'tom'] } = {}) {
  const paire = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const publique = hexa(await crypto.subtle.exportKey('raw', paire.publicKey));
  const discord = fauxDiscord();
  const b = await banc({ fetchDiscord: discord.fetch, lienApp: 'https://app.exemple/esport', discordBot: { applicationId: APP, publicKey: publique, jetonBot: bot ? JETON_BOT : '' }, attenteDiffere: () => new Promise(() => {}) });
  const A = await teamAvecMembres(b, { nom: 'Valorant', membres: MEMBRES });
  const t0 = new Date(b.horloge.t).toISOString();
  if (serveur) await b.base.executer('INSERT INTO discord_serveurs (team_id, guild_id, salon_id, salon_nom, lie_par_discord, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?)', [A.teamId, GUILD, SALON, 'annonces', '800000000000000009', t0, t0]);
  for (const cle of lies) await b.base.executer('INSERT INTO discord_comptes (compte_id, discord_user_id, discord_nom, super_admin, lie_le) VALUES (?, ?, ?, 0, ?)', [`${cle}12345`, D[cle], cle, t0]);
  const url = (suite = '') => `/teams/${A.teamId}/discord/testmp${suite}`;
  const appel = (suite, corps, jeton = A.sessions.max12345) => b.appel(url(suite), corps === undefined ? { jeton } : { methode: 'POST', jeton, corps });
  async function clic(customId, qui) {
    const corps = JSON.stringify({ type: 3, locale: 'fr', id: '2', token: 'jeton-mp', application_id: APP, channel_id: `96${qui.slice(2)}`, user: { id: qui, username: 'x' }, data: { custom_id: customId, component_type: 2 } });
    const h = String(Math.floor(b.horloge.t / 1000));
    const sig = hexa(await crypto.subtle.sign('Ed25519', paire.privateKey, new TextEncoder().encode(h + corps)));
    const r = await b.traiter(new Request('https://esport.test/discord/interactions', { method: 'POST', headers: { 'X-Signature-Ed25519': sig, 'X-Signature-Timestamp': h, 'Content-Type': 'application/json' }, body: corps }));
    return r.json();
  }
  const scrim = async (corps = {}) => {
    const r = await b.appel(`/teams/${A.teamId}/planning`, { methode: 'POST', jeton: A.sessions.fondateur, corps: { type: 'scrim', titre: 'Scrim Faucons', date: '2026-10-22', heureDebut: '20:30', heureFin: '22:00', ...corps } });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
    return b.base.premier('SELECT id, debut FROM planning_evenements WHERE titre = ? AND team_id = ?', [corps.titre ?? 'Scrim Faucons', A.teamId]);
  };
  const etatBase = async () => ({
    mentions: await b.base.tous('SELECT * FROM discord_mentions'),
    envois: await b.base.tous('SELECT * FROM discord_mp_envois'),
    injoignables: await b.base.tous('SELECT * FROM discord_injoignables'),
    presences: await b.base.tous('SELECT * FROM presences'),
    file: await b.base.tous('SELECT id FROM discord_file'),
    annonces: await b.base.tous('SELECT * FROM discord_annonces'),
  });
  return { b, A, discord, appel, clic, scrim, etatBase };
}

test('succès : MP de test dans la langue du membre, boutons « Test reçu » ; Léa (anglais) et Tom (français)', async () => {
  const p = await preparer();
  assert.equal((await p.b.appel('/moi/langue', { methode: 'PUT', jeton: p.A.sessions.lea12345, corps: { langue: 'en' } })).statut, 200);
  const r = await p.appel('', { comptes: ['lea12345', 'tom12345'] });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.deepEqual(r.corps.resultats.map(x => [x.pseudo, x.ok]), [['Léa', true], ['Tom', true]]);
  const mps = p.discord.mps();
  assert.deepEqual(mps.map(m => m.a).sort(), [D.lea, D.tom].sort());
  const lea = texteCharge(mps.find(m => m.a === D.lea).corps);
  const tom = texteCharge(mps.find(m => m.a === D.tom).corps);
  assert.match(lea, /Test/);
  assert.match(lea, /DM|reminders/);
  assert.match(tom, /Test/);
  assert.match(tom, /relances|MP/);
  const boutons = mps[0].corps.components[0].components;
  assert.deepEqual(boutons.map(b => b.custom_id), ['tmp:o', 'tmp:p', 'tmp:n']);
  assert.deepEqual(mps[0].corps.allowed_mentions, { parse: [] });
  assert.equal(mps[0].corps.username, undefined);
  assert.equal(r.corps.quota.restant, 8);
});

test('par défaut : moi-même ; clic sur un bouton de test → « Test reçu », rien n’est enregistré', async () => {
  const p = await preparer();
  await p.b.base.executer("UPDATE comptes SET discord_id = ? WHERE id = 'principal' OR pseudo = 'Fondateur'", ['800000000000000099']);
  const avant = await p.etatBase();
  const r = await p.appel('', {}, p.A.sessions.fondateur);
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.resultats.length, 1);
  assert.equal(r.corps.resultats[0].ok, true);
  const rep = await p.clic('tmp:o', D.lea);
  assert.match(JSON.stringify(rep), /Test reçu/);
  const rep2 = await p.clic('tmp:n', '800000000000000077');
  assert.match(JSON.stringify(rep2), /Test reçu/, 'même un compte non lié');
  assert.deepEqual(await p.etatBase(), avant);
});

test('échecs expliqués : non lié, MP fermés (50007), jeton refusé, limite de débit, panne', async () => {
  const p = await preparer({ lies: ['lea', 'tom'] });
  p.discord.programme.push({ si: (c, m) => m === 'POST' && c === `/api/v10/channels/96${D.tom.slice(2)}/messages`, statut: 403, corps: { code: 50007, message: 'Cannot send messages to this user' } });
  let r = await p.appel('', { comptes: ['lea12345', 'tom12345', 'ana12345'] });
  assert.deepEqual(Object.fromEntries(r.corps.resultats.map(x => [x.pseudo, x.motif ?? 'ok'])), { Léa: 'ok', Tom: 'mp_fermes', Ana: 'non_lie' });
  assert.equal(p.discord.mps().filter(m => m.a === D.tom).length, 1, 'tentative faite pour Tom');
  assert.equal(p.discord.mps().filter(m => m.a === D.lea).length, 1);

  p.discord.programme.push({ si: (c, m) => m === 'POST' && c === '/api/v10/users/@me/channels', statut: 401, corps: { code: 0 } });
  r = await p.appel('', { comptes: ['lea12345'] });
  assert.equal(r.corps.resultats[0].motif, 'bot_bloque');
  p.discord.programme.push({ si: (c, m) => m === 'POST' && c === '/api/v10/users/@me/channels', statut: 429, corps: { retry_after: 7 } });
  r = await p.appel('', { comptes: ['lea12345'] });
  assert.equal(r.corps.resultats[0].motif, 'limite');
  assert.equal(r.corps.resultats[0].attenteS, 7);
  p.discord.programme.push({ si: (c, m) => m === 'POST' && c === '/api/v10/users/@me/channels', statut: 500, corps: {} });
  r = await p.appel('', { comptes: ['lea12345'] });
  assert.equal(r.corps.resultats[0].motif, 'indisponible');
});

test('bot non configuré (DISCORD_BOT_TOKEN) ou absent du serveur : aucun appel à Discord, cause en clair', async () => {
  const sansJeton = await preparer({ bot: false });
  let r = await sansJeton.appel('', { comptes: ['lea12345', 'ana12345'] });
  assert.deepEqual(r.corps.resultats.map(x => x.motif), ['bot_non_configure', 'bot_non_configure']);
  assert.equal(sansJeton.discord.appels.length, 0);
  const sansServeur = await preparer({ serveur: false });
  r = await sansServeur.appel('', { comptes: ['lea12345'] });
  assert.equal(r.corps.resultats[0].motif, 'bot_absent');
  assert.equal(sansServeur.discord.appels.length, 0);
  const e = await sansServeur.appel('');
  assert.equal(e.corps.botLie, false);
  assert.equal(e.corps.botConfigure, true);
});

test('limite anti-abus : 10 tests par tranche de 10 minutes et par team, puis le délai s’écoule', async () => {
  const p = await preparer();
  for (let i = 0; i < 10; i++) assert.equal((await p.appel('', { comptes: ['lea12345'] })).statut, 200);
  const r = await p.appel('', { comptes: ['lea12345'] });
  assert.equal(r.statut, 429, JSON.stringify(r.corps));
  assert.ok(r.corps.attente > 0);
  assert.equal((await p.appel('')).corps.quota.restant, 0);
  assert.equal(p.discord.mps().length, 10, 'rien envoyé au-delà');
  p.b.horloge.t += 11 * 60_000;
  assert.equal((await p.appel('', { comptes: ['lea12345'] })).statut, 200);
});

test('droits et validations : discord.manage requis, membre de la team, liste non vide', async () => {
  const p = await preparer();
  assert.equal((await p.appel('', { comptes: ['lea12345'] }, p.A.sessions.lea12345)).statut, 403);
  assert.equal((await p.appel('', undefined, p.A.sessions.lea12345)).statut, 403);
  assert.equal((await p.appel('', { comptes: [] })).statut, 400);
  assert.equal((await p.appel('', { comptes: ['inconnu'] })).statut, 404);
  assert.equal((await p.appel('/simulation', { evenementId: 'x', occurrence: 'y' }, p.A.sessions.lea12345)).statut, 403);
  assert.equal((await p.appel('/simulation', { evenementId: 'x' })).statut, 400);
  assert.equal(p.discord.appels.length, 0);
});

test('journal : un événement « test MP » par membre testé, sans identifiant Discord', async () => {
  const p = await preparer();
  await p.appel('', { comptes: ['lea12345', 'ana12345'] });
  await p.b.appel('/sante', { methode: 'POST' });
  const l = await p.b.base.tous("SELECT meta, acteur_id FROM journal WHERE team_id = ? AND action = 'discord.test_mp'", [p.A.teamId]);
  assert.equal(l.length, 2);
  const metas = l.map(x => JSON.parse(x.meta)).sort((a, b) => a.compte.localeCompare(b.compte));
  assert.deepEqual(metas.map(m => [m.compte, m.ok, m.motif ?? null]), [['ana12345', false, 'non_lie'], ['lea12345', true, null]]);
  assert.ok(!JSON.stringify(l).includes(D.lea));
});

test('simulation : qui reçoit un MP, qui est cité dans le salon, qui est déjà pingé ; rien n’est envoyé ni enregistré', async () => {
  const p = await preparer({ lies: ['lea', 'tom'] });
  const ev = await p.scrim({ convocation: { groupes: [], membres: ['lea12345', 'tom12345', 'ana12345'] } });
  const occ = new Date(ev.debut).toISOString();
  // Tom a ses MP fermés (dernier MP refusé), Léa a déjà été pingée dans l'annonce.
  const t = new Date(p.b.horloge.t).toISOString();
  await p.b.base.executer("INSERT INTO discord_injoignables (team_id, compte_id, discord_user_id, motif, depuis_le, maj_le) VALUES (?, 'tom12345', ?, 'mp_fermes', ?, ?)", [p.A.teamId, D.tom, t, t]);
  // L'annonce a déjà cité les convoqués liés : seule Léa reste « déjà pingée » pour ce test.
  await p.b.base.executer('DELETE FROM discord_mentions WHERE cible <> ?', [D.lea]);
  await p.b.base.executer('INSERT INTO discord_mentions (team_id, sujet, cible, ligne_id, cree_le) VALUES (?, ?, ?, ?, ?) ON CONFLICT (team_id, sujet, cible) DO NOTHING', [p.A.teamId, `occ:${ev.id}:${occ}`, D.lea, 'l1', t]);
  const avant = await p.etatBase();
  const appelsAvant = p.discord.appels.length;
  const e = await p.appel('');
  assert.ok(e.corps.evenements.some(x => x.evenementId === ev.id));
  const r = await p.appel('/simulation', { evenementId: ev.id, occurrence: occ });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  const par = Object.fromEntries(r.corps.membres.map(m => [m.pseudo, m]));
  assert.deepEqual([par.Léa.voie, par.Léa.dejaPinge], ['mp', true]);
  assert.deepEqual([par.Tom.voie, par.Tom.motif, par.Tom.mention], ['salon', 'mp_fermes', true]);
  assert.deepEqual([par.Ana.voie, par.Ana.motif, par.Ana.mention], ['salon', 'non_lie', false]);
  assert.deepEqual(r.corps.dejaPinges.map(x => x.pseudo), ['Léa']);
  assert.equal(r.corps.botPret, true);
  assert.equal(p.discord.appels.length, appelsAvant, 'rien n’est envoyé');
  assert.deepEqual(await p.etatBase(), avant);
  // Option « Relances par MP » coupée : tout le monde dans le salon.
  assert.equal((await p.b.appel(`/teams/${p.A.teamId}/discord/mp`, { methode: 'PUT', jeton: p.A.sessions.max12345, corps: { relancesMp: false } })).statut, 200);
  const r2 = await p.appel('/simulation', { evenementId: ev.id, occurrence: occ });
  assert.ok(r2.corps.membres.every(m => m.voie === 'salon'));
  assert.equal(r2.corps.membres.find(m => m.pseudo === 'Léa').motif, 'option_coupee');
  // Événement inconnu.
  assert.equal((await p.appel('/simulation', { evenementId: '00000000-0000-0000-0000-000000000000', occurrence: occ })).statut, 404);
});

test('relance de test à UN membre : relance marquée « test », boutons de test, aucune réponse ni registre modifié', async () => {
  const p = await preparer({ lies: ['lea', 'tom'] });
  const ev = await p.scrim({ convocation: { groupes: [], membres: ['lea12345', 'tom12345'] } });
  const occ = new Date(ev.debut).toISOString();
  const avant = await p.etatBase();
  const r = await p.appel('/relance', { evenementId: ev.id, occurrence: occ, compte: 'lea12345' });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.deepEqual(r.corps.resultats.map(x => [x.pseudo, x.ok]), [['Léa', true]]);
  const [mp] = p.discord.mps();
  assert.equal(mp.a, D.lea);
  assert.match(mp.corps.content, /TEST/i);
  assert.match(texteCharge(mp.corps), /Scrim Faucons/);
  assert.deepEqual(mp.corps.components[0].components.map(b => b.custom_id), ['tmp:o', 'tmp:p', 'tmp:n']);
  assert.deepEqual(mp.corps.allowed_mentions, { parse: [] });
  assert.deepEqual(await p.etatBase(), avant);
  assert.equal((await p.appel('/relance', { evenementId: ev.id, occurrence: occ, compte: 'inconnu' })).statut, 404);
});
