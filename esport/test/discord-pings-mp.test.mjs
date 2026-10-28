/**
 * Pings Discord une seule fois et relances par MP (migration 0031), sans réseau réel : un joueur n'est mentionné
 * qu'UNE fois par événement (annonce anglaise ; jamais dans le fil français, les rappels J-1 / H-1 ni « c'est
 * maintenant ») ; un rôle mentionné couvre les convoqués (jamais rôle + mention individuelle) ; les relances
 * partent en MP, dans la langue du joueur, avec les boutons RSVP (qui marchent en MP) ; un message qui ne concerne
 * qu'un convoqué part en MP ; repli dans le salon (MP fermés : 50007, compte non lié) avec une mention unique ;
 * idempotence des réessais (panne, 429) ; joueur dans deux teams ; option « Relances par MP » de la team.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { traiterFile } from '../noyau/discord/file.mjs';
import { debutsDiscord, rappelsDiscord } from '../noyau/discord/rappels.mjs';
import { texteCharge } from '../noyau/discord/messages.mjs';
import { evenement } from '../noyau/evenements.mjs';
import { banc, CLE, teamAvecMembres } from './aide.mjs';

const APP = '424242424242424242';
const JETON_BOT = 'jeton-bot-de-test-jamais-reel';
const GUILD = '700000000000000001';
const SALON = '710000000000000001';
const SALON_F = '710000000000000002';
const ROLE = '760000000000000001';
const D = { lea: '800000000000000001', tom: '800000000000000002', coach: '800000000000000003', ana: '800000000000000004', bob: '800000000000000005' };
const MEMBRES = {
  max12345: { pseudo: 'Max', role: 'manager' },
  coach123: { pseudo: 'Zed', role: 'coach' },
  lea12345: { pseudo: 'Léa', role: 'joueur' },
  tom12345: { pseudo: 'Tom', role: 'joueur' },
  ana12345: { pseudo: 'Ana', role: 'joueur' },
};
const LIEN = 'https://app.exemple/esport';
const hexa = o => Buffer.from(o).toString('hex');

/**
 * Faux Discord : salon privé (POST /users/@me/channels → « 96 » + fin de l'identifiant du destinataire), messages,
 * fils. `programme` : réponses imposées `{ si: (chemin, methode, corps) => bool, statut, corps }`, consommées une fois.
 */
function fauxDiscord() {
  const appels = [];
  const programme = [];
  let n = 0;
  const repondre = (statut, corps) => new Response(corps === undefined ? null : JSON.stringify(corps), { status: statut, headers: { 'Content-Type': 'application/json' } });
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
    const fil = /^\/api\/v10\/channels\/(\d+)\/messages\/(\d+)\/threads$/.exec(u.pathname);
    if (fil) return repondre(201, { id: fil[2], type: 11 });
    const msg = /^\/api\/v10\/channels\/(\d+)\/messages$/.exec(u.pathname);
    if (msg && init.method === 'POST') return repondre(200, { id: `9${String(++n).padStart(17, '0')}`, channel_id: msg[1] });
    return repondre(200, {});
  };
  const posts = () => appels.filter(a => a.methode === 'POST' && /\/messages$/.test(a.chemin));
  /** Messages postés dans un salon (pas les fils, pas les MP). */
  const salon = (id = SALON) => posts().filter(a => a.chemin === `/api/v10/channels/${id}/messages`);
  /** MP postés, avec leur destinataire. */
  const mps = () =>
    posts()
      .map(a => ({ ...a, m: /^\/api\/v10\/channels\/96(\d{16})\/messages$/.exec(a.chemin) }))
      .filter(a => a.m)
      .map(a => ({ ...a, a: `80${a.m[1]}` }));
  /** Messages des fils (version française). */
  const fils = () => posts().filter(a => /^\/api\/v10\/channels\/9[0-9]{17}\/messages$/.test(a.chemin) && !/\/channels\/96/.test(a.chemin));
  return { appels, programme, fetch, salon, mps, fils };
}

/** Mentions d'un message : identifiants cités dans `content` (`<@id>`, `<@&id>`). */
const mentionsDe = corps => [...String(corps?.content ?? '').matchAll(/<@&?(\d+)>/g)].map(m => m[1]);

async function preparer({ filFr = true, lies = ['lea', 'tom', 'coach'] } = {}) {
  const paire = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const publique = hexa(await crypto.subtle.exportKey('raw', paire.publicKey));
  const discord = fauxDiscord();
  const b = await banc({ fetchDiscord: discord.fetch, lienApp: LIEN, discordBot: { applicationId: APP, publicKey: publique, jetonBot: JETON_BOT }, attenteDiffere: () => new Promise(() => {}) });
  const A = await teamAvecMembres(b, { nom: 'Valorant', membres: MEMBRES, filFr });
  const t0 = new Date(b.horloge.t).toISOString();
  const lierServeur = (teamId, salon) =>
    b.base.executer('INSERT INTO discord_serveurs (team_id, guild_id, salon_id, salon_nom, lie_par_discord, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?)', [teamId, GUILD, salon, 'annonces', '800000000000000009', t0, t0]);
  const lierCompte = (cle, compte = `${cle}12345`) => b.base.executer('INSERT INTO discord_comptes (compte_id, discord_user_id, discord_nom, super_admin, lie_le) VALUES (?, ?, ?, 0, ?)', [cle === 'coach' ? 'coach123' : compte, D[cle], cle, t0]);
  await lierServeur(A.teamId, SALON);
  for (const cle of lies) await lierCompte(cle);
  const traiter = () => traiterFile(b.base, { cle: CLE, fetch: discord.fetch, maintenant: b.horloge.t, lienApp: LIEN, jetonBot: JETON_BOT });
  /** Événements de domaine publiés par le cron : distribués par la requête suivante, puis la file est traitée. */
  const distribuer = async () => {
    await b.appel('/sante', { methode: 'POST' });
    await traiter();
  };
  const scrim = async (corps = {}, team = A) => {
    // Session neuve : l'horloge du test avance de plusieurs jours.
    const r = await b.appel(`/teams/${team.teamId}/planning`, { methode: 'POST', jeton: await b.session('principal', 'Fondateur'), corps: { type: 'scrim', titre: 'Scrim Faucons', date: '2026-10-22', heureDebut: '20:30', heureFin: '22:00', ...corps } });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
    await traiter();
    return b.base.premier('SELECT id, debut, team_id FROM planning_evenements WHERE titre = ? AND team_id = ?', [corps.titre ?? 'Scrim Faucons', team.teamId]);
  };
  /** Relance (/relancer) d'une occurrence, publiée comme le bot le fait. */
  const relancer = async ev => {
    await b.base.lot([
      evenement('attendance.relance', {
        teamId: ev.team_id,
        acteur: 'coach123',
        entiteType: 'evenement',
        entiteId: ev.id,
        charge: { evenementId: ev.id, occurrence: ev.debut, titre: 'Scrim', type: 'scrim', debut: ev.debut, origine: 'discord' },
        maintenant: b.horloge.t,
      }),
    ]);
    await distribuer();
  };
  /** Clic signé sur un bouton depuis un MP (pas de serveur : `user`, pas de `guild_id`). */
  async function clicMp(customId, qui) {
    const corps = JSON.stringify({ type: 3, locale: 'fr', id: '2', token: 'jeton-mp', application_id: APP, channel_id: `96${qui.slice(2)}`, user: { id: qui, username: 'x' }, data: { custom_id: customId, component_type: 2 } });
    const h = String(Math.floor(b.horloge.t / 1000));
    const sig = hexa(await crypto.subtle.sign('Ed25519', paire.privateKey, new TextEncoder().encode(h + corps)));
    const r = await b.traiter(new Request('https://esport.test/discord/interactions', { method: 'POST', headers: { 'X-Signature-Ed25519': sig, 'X-Signature-Timestamp': h, 'Content-Type': 'application/json' }, body: corps }));
    return r.json();
  }
  const etatMp = async (team = A) => (await b.appel(`/teams/${team.teamId}/discord`, { jeton: await b.session('principal', 'Fondateur') })).corps.mp;
  return { b, A, discord, traiter, distribuer, scrim, relancer, clicMp, lierServeur, lierCompte, etatMp };
}

test('un seul ping par événement : annonce anglaise (convoqués liés), fil français, J-1, H-1 et « c’est maintenant » sans re-mention', async () => {
  const p = await preparer();
  // Convoqués par défaut : les joueurs (Léa, Tom liés ; Ana non liée).
  await p.scrim();
  const [annonce] = p.discord.salon();
  assert.deepEqual(mentionsDe(annonce.corps).sort(), [D.lea, D.tom].sort());
  assert.deepEqual([...annonce.corps.allowed_mentions.users].sort(), [D.lea, D.tom].sort());
  // Fil français : aucune mention.
  const [fr] = p.discord.fils();
  assert.ok(fr, 'version française dans le fil');
  assert.equal(fr.corps.content, undefined);
  assert.deepEqual(fr.corps.allowed_mentions, { parse: [] });
  assert.equal(p.discord.mps().length, 0, 'annonce d’équipe : pas de MP');
  const registre = await p.b.base.tous('SELECT cible, sujet FROM discord_mentions WHERE team_id = ? ORDER BY cible', [p.A.teamId]);
  assert.deepEqual(registre.map(r => r.cible), [D.lea, D.tom].sort());

  // J-1 : publié dans le salon, sans mention.
  p.b.horloge.t = Date.parse('2026-10-21T20:00:00Z');
  assert.equal(await rappelsDiscord(p.b.base, { maintenant: p.b.horloge.t }), 1);
  await p.distribuer();
  const j1 = p.discord.salon().at(-1).corps;
  assert.match(texteCharge(j1), /Reminder|Rappel/);
  assert.equal(j1.content, undefined);
  assert.deepEqual(j1.allowed_mentions, { parse: [] });

  // Ana lie son compte avant H-1 : elle n'a jamais été mentionnée pour cet événement → une mention, la sienne seulement.
  await p.lierCompte('ana');
  p.b.horloge.t = Date.parse('2026-10-22T18:00:00Z');
  assert.equal(await rappelsDiscord(p.b.base, { maintenant: p.b.horloge.t }), 1);
  await p.distribuer();
  const h1 = p.discord.salon().at(-1).corps;
  assert.deepEqual(mentionsDe(h1), [D.ana]);
  assert.deepEqual(h1.allowed_mentions, { parse: [], users: [D.ana] });

  // « C'est maintenant » : tout le monde a déjà été mentionné.
  p.b.horloge.t = Date.parse('2026-10-22T18:27:00Z');
  assert.equal(await debutsDiscord(p.b.base, { maintenant: p.b.horloge.t }), 1);
  await p.distribuer();
  const maintenant = p.discord.salon().at(-1).corps;
  assert.match(texteCharge(maintenant), /now|maintenant/i);
  assert.equal(maintenant.content, undefined);
  assert.deepEqual(maintenant.allowed_mentions, { parse: [] });

  // Bilan : 4 messages dans le salon, chaque joueur mentionné UNE fois en tout, jamais dans un fil.
  assert.equal(p.discord.salon().length, 4);
  const toutes = p.discord.salon().flatMap(m => mentionsDe(m.corps));
  assert.deepEqual(toutes.sort(), [D.lea, D.tom, D.ana].sort());
  assert.ok(p.discord.fils().every(m => m.corps.content === undefined && !m.corps.allowed_mentions.users));
});

test('rôle configuré : le rôle seul (jamais rôle + mention individuelle), une seule fois par événement', async () => {
  const p = await preparer({ filFr: false });
  for (const cle of ['event_created', 'reminder_d1']) {
    assert.equal((await p.b.appel(`/teams/${p.A.teamId}/discord/parametres/${cle}`, { methode: 'PUT', jeton: p.A.sessions.max12345, corps: { roleMention: ROLE } })).statut, 200);
  }
  await p.scrim();
  const [annonce] = p.discord.salon();
  assert.equal(annonce.corps.content, `<@&${ROLE}>`);
  assert.deepEqual(annonce.corps.allowed_mentions, { parse: [], roles: [ROLE] });
  p.b.horloge.t = Date.parse('2026-10-21T20:00:00Z');
  await rappelsDiscord(p.b.base, { maintenant: p.b.horloge.t });
  await p.distribuer();
  const j1 = p.discord.salon().at(-1).corps;
  assert.equal(j1.content, undefined, 'rôle déjà mentionné pour cet événement');
  assert.deepEqual(j1.allowed_mentions, { parse: [] });
});

test('relance → un MP à chaque sans-réponse lié, dans SA langue, avec les boutons RSVP (qui marchent en MP) ; rien dans le salon', async () => {
  const p = await preparer({ filFr: true });
  const ev = await p.scrim({ convocation: { groupes: [], membres: ['lea12345', 'tom12345'] } });
  const avant = p.discord.salon().length;
  // Léa a choisi l'anglais dans son profil ; Tom n'a rien choisi : sa langue par défaut (français).
  assert.equal((await p.b.appel('/moi/langue', { methode: 'PUT', jeton: p.A.sessions.lea12345, corps: { langue: 'en' } })).statut, 200);
  await p.relancer(ev);
  assert.equal(p.discord.salon().length, avant, 'aucun message dans le salon');
  const mps = Object.fromEntries(p.discord.mps().map(m => [m.a, m.corps]));
  assert.deepEqual(Object.keys(mps).sort(), [D.lea, D.tom].sort());
  assert.match(texteCharge(mps[D.lea]), /Please respond/);
  assert.match(texteCharge(mps[D.tom]), /Pensez à répondre/);
  for (const m of Object.values(mps)) {
    assert.equal(m.content, undefined);
    assert.deepEqual(m.allowed_mentions, { parse: [] });
    assert.equal(m.username, undefined);
    assert.equal(m.enforce_nonce, true);
  }
  assert.equal((await p.b.base.tous('SELECT * FROM discord_mp_envois WHERE team_id = ?', [p.A.teamId])).length, 2);
  // Le bouton « Oui » du MP répond pour Léa (pas de serveur dans un MP).
  const oui = mps[D.lea].components[0].components.find(c => /:o$/.test(c.custom_id ?? '')).custom_id;
  const r = await p.clicMp(oui, D.lea);
  assert.equal(r.type, 4, JSON.stringify(r));
  assert.equal((await p.b.base.premier("SELECT rsvp FROM presences WHERE compte_id = 'lea12345' AND evenement_id = ?", [ev.id])).rsvp, 'oui');
  // Un compte non lié qui clique : « Lie ton compte ».
  assert.match(texteCharge((await p.clicMp(oui, D.bob)).data), /lier|link/i);
});

test('joueur seul convoqué → l’annonce et les rappels partent en MP, rien dans le salon ; avec un rôle, l’annonce reste dans le salon', async () => {
  const p = await preparer();
  await p.scrim({ convocation: { groupes: [], membres: ['lea12345'] } });
  assert.equal(p.discord.salon().length, 0);
  assert.deepEqual(p.discord.mps().map(m => m.a), [D.lea]);
  assert.equal(p.discord.fils().length, 0, 'un MP n’a pas de fil');
  p.b.horloge.t = Date.parse('2026-10-21T20:00:00Z');
  await rappelsDiscord(p.b.base, { maintenant: p.b.horloge.t });
  await p.distribuer();
  assert.equal(p.discord.salon().length, 0);
  assert.equal(p.discord.mps().length, 2, 'le rappel J-1 aussi, en MP');
  // Un rôle à mentionner : c'est une annonce d'équipe (salon).
  await p.b.appel(`/teams/${p.A.teamId}/discord/parametres/event_created`, { methode: 'PUT', jeton: await p.b.session('max12345', 'Max'), corps: { roleMention: ROLE } });
  await p.scrim({ titre: 'Scrim avec rôle', convocation: { groupes: [], membres: ['lea12345'] } });
  assert.equal(p.discord.salon().length, 1);
  assert.equal(p.discord.salon()[0].corps.content, `<@&${ROLE}>`);
});

test('repli : MP fermés (50007) ou compte non lié → cités dans le salon, mention unique par événement ; indicateur Réglages › Discord', async () => {
  const p = await preparer({ filFr: false, lies: ['lea', 'coach'] });
  const ev = await p.scrim({ convocation: { groupes: [], membres: ['lea12345', 'tom12345', 'ana12345'] } });
  assert.deepEqual(mentionsDe(p.discord.salon()[0].corps), [D.lea]);
  // Tom lie son compte après l'annonce (jamais mentionné), mais ses MP sont fermés.
  await p.lierCompte('tom');
  p.discord.programme.push({ si: (chemin, methode) => methode === 'POST' && chemin === `/api/v10/channels/96${D.tom.slice(2)}/messages`, statut: 403, corps: { code: 50007, message: 'Cannot send messages to this user' } });
  await p.relancer(ev);
  // Léa jointe en MP ; le MP de Tom a été tenté, Discord l'a refusé.
  assert.deepEqual(p.discord.mps().map(m => m.a).sort(), [D.lea, D.tom].sort());
  const repli = p.discord.salon().at(-1).corps;
  assert.equal(p.discord.salon().length, 2);
  assert.deepEqual(mentionsDe(repli), [D.tom], 'mention unique de Tom (jamais mentionné pour cet événement)');
  assert.deepEqual(repli.allowed_mentions, { parse: [], users: [D.tom] });
  assert.match(texteCharge(repli), /Tom.*Ana|Ana.*Tom/s);
  assert.match(repli.embeds[0].description, /Tom/);
  assert.doesNotMatch(repli.embeds[0].description, /Léa/, 'Léa a eu son MP : pas citée dans le texte');
  const journal = await p.b.base.tous("SELECT meta FROM journal WHERE team_id = ? AND action = 'discord.dm_failed'", [p.A.teamId]);
  assert.equal(journal.length, 1);
  assert.equal(JSON.parse(journal[0].meta).motif, 'mp_fermes');
  let mp = await p.etatMp();
  assert.equal(mp.relancesMp, true);
  // Max (Manager, jamais lié) y figure aussi : tout membre convocable sans Discord.
  assert.deepEqual(Object.fromEntries(mp.injoignables.map(i => [i.pseudo, i.motif])), { Ana: 'non_lie', Max: 'non_lie', Tom: 'mp_fermes' });

  // Une heure plus tard, nouvelle relance : Tom toujours fermé → cité, PAS re-mentionné.
  p.b.horloge.t += 3_600_000;
  p.discord.programme.push({ si: (chemin, methode) => methode === 'POST' && chemin === `/api/v10/channels/96${D.tom.slice(2)}/messages`, statut: 403, corps: { code: 50007 } });
  await p.relancer(ev);
  const second = p.discord.salon().at(-1).corps;
  assert.equal(p.discord.salon().length, 3);
  assert.equal(second.content, undefined);
  assert.deepEqual(second.allowed_mentions, { parse: [] });

  // Tom ouvre ses MP : le suivant passe, il quitte la liste.
  p.b.horloge.t += 3_600_000;
  await p.relancer(ev);
  // Seule Ana (non liée) reste citée dans le salon, sans mention possible.
  const troisieme = p.discord.salon().at(-1).corps;
  assert.equal(p.discord.salon().length, 4);
  assert.match(texteCharge(troisieme), /Ana/);
  assert.match(troisieme.embeds[0].description, /Ana/);
  assert.doesNotMatch(troisieme.embeds[0].description, /Tom/);
  assert.equal(troisieme.content, undefined);
  mp = await p.etatMp();
  assert.deepEqual(mp.injoignables.map(i => i.pseudo).sort(), ['Ana', 'Max']);
});

test('idempotence : panne pendant les MP → réessai sans doublon ; 429 respecté sans compter d’essai', async () => {
  const p = await preparer({ filFr: false });
  const ev = await p.scrim({ convocation: { groupes: [], membres: ['lea12345', 'tom12345'] } });
  p.discord.programme.push({ si: (chemin, methode) => methode === 'POST' && chemin === `/api/v10/channels/96${D.tom.slice(2)}/messages`, statut: 500, corps: {} });
  await p.relancer(ev);
  let ligne = await p.b.base.premier("SELECT * FROM discord_file WHERE cle = 'rsvp_relance'", []);
  assert.equal(ligne.statut, 'attente');
  assert.equal(Number(ligne.essais), 1);
  assert.equal(p.discord.mps().filter(m => m.a === D.lea).length, 1);
  // Réessai : Léa ne reçoit pas un second MP ; Tom reçoit le sien.
  p.b.horloge.t += 61_000;
  await p.traiter();
  assert.equal(p.discord.mps().filter(m => m.a === D.lea).length, 1, 'pas de doublon');
  assert.equal(p.discord.mps().filter(m => m.a === D.tom).length, 2, 'Tom : l’essai en panne puis le bon');
  ligne = await p.b.base.premier("SELECT * FROM discord_file WHERE cle = 'rsvp_relance'", []);
  assert.equal(ligne.statut, 'envoye');
  assert.equal(p.discord.salon().length, 1, 'tous joints : rien dans le salon');

  // 429 à l'ouverture du salon privé : on attend Discord, sans essai compté.
  p.b.horloge.t += 3_600_000;
  p.discord.programme.push({ si: chemin => chemin === '/api/v10/users/@me/channels', statut: 429, corps: { retry_after: 5 } });
  await p.relancer(ev);
  ligne = await p.b.base.premier("SELECT * FROM discord_file WHERE cle = 'rsvp_relance' AND statut = 'attente'", []);
  assert.equal(Number(ligne.essais), 0);
  assert.equal(ligne.prochain_essai_le, new Date(p.b.horloge.t + 5000).toISOString());
});

test('joueur dans deux teams (Valorant, The Finals) : une mention par team et par événement, un MP par team', async () => {
  const p = await preparer({ filFr: false });
  const F = await teamAvecMembres(p.b, { nom: 'The Finals', membres: { lea12345: { pseudo: 'Léa', role: 'joueur' }, bob12345: { pseudo: 'Bob', role: 'joueur' } } });
  await p.lierServeur(F.teamId, SALON_F);
  await p.lierCompte('bob');
  const evA = await p.scrim({ convocation: { groupes: [], membres: ['lea12345', 'tom12345'] } });
  const evF = await p.scrim({ titre: 'Scrim Finals', convocation: { groupes: [], membres: ['lea12345', 'bob12345'] } }, F);
  assert.deepEqual(mentionsDe(p.discord.salon(SALON)[0].corps).sort(), [D.lea, D.tom].sort());
  assert.deepEqual(mentionsDe(p.discord.salon(SALON_F)[0].corps).sort(), [D.lea, D.bob].sort());
  for (const m of [...p.discord.salon(SALON), ...p.discord.salon(SALON_F)]) assert.equal(new Set(mentionsDe(m.corps)).size, mentionsDe(m.corps).length, 'jamais deux fois dans un message');
  await p.relancer(evA);
  await p.relancer(evF);
  await p.traiter();
  const lea = p.discord.mps().filter(m => m.a === D.lea);
  assert.equal(lea.length, 2, 'un MP par team');
  assert.deepEqual(lea.map(m => m.corps.embeds[0].footer.text).sort(), ['The Finals · Esport', 'Valorant · Esport']);
  assert.equal(p.discord.salon(SALON).length + p.discord.salon(SALON_F).length, 2, 'aucune relance dans les salons');
});

test('option « Relances par MP » coupée : relance dans le salon, sans re-mentionner ; droits et validation', async () => {
  const p = await preparer({ filFr: false });
  const d = `/teams/${p.A.teamId}/discord/mp`;
  assert.equal((await p.b.appel(d, { methode: 'PUT', jeton: p.A.sessions.lea12345, corps: { relancesMp: false } })).statut, 403);
  assert.equal((await p.b.appel(d, { methode: 'PUT', jeton: p.A.sessions.max12345, corps: { relancesMp: 'non' } })).statut, 400);
  const r = await p.b.appel(d, { methode: 'PUT', jeton: p.A.sessions.max12345, corps: { relancesMp: false } });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.relancesMp, false);
  assert.equal((await p.etatMp()).relancesMp, false);
  const ev = await p.scrim({ convocation: { groupes: [], membres: ['lea12345', 'tom12345'] } });
  await p.relancer(ev);
  assert.equal(p.discord.mps().length, 0);
  const relance = p.discord.salon().at(-1).corps;
  assert.equal(p.discord.salon().length, 2);
  assert.match(texteCharge(relance), /Léa/);
  assert.equal(relance.content, undefined, 'déjà mentionnés par l’annonce');
  // Joueur seul, option coupée : l'annonce reste dans le salon, avec sa mention.
  await p.scrim({ titre: 'Coaching', convocation: { groupes: [], membres: ['tom12345'] } });
  assert.deepEqual(mentionsDe(p.discord.salon().at(-1).corps), [D.tom]);
});
