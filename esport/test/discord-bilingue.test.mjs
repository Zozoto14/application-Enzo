/**
 * Messages Discord bilingues (migration 0020), sans réseau réel : message ANGLAIS dans le salon
 * (embed, boutons, mentions), puis fil français ouvert par le bot sur ce message, avec la version
 * FRANÇAISE (sans mention) ; webhook (?wait=true, ?thread_id=) comme bot ; salon forum ; fil
 * impossible (bot absent, permission manquante) → alerte qui mentionne le Fondateur, au plus une
 * par salon et par 24 h, jamais de second message français ; idempotence des réessais (429, 5xx,
 * fil déjà créé) ; réglage par team (activé par défaut) ; message de test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { traiterFile } from '../noyau/discord/file.mjs';
import { texteCharge } from '../noyau/discord/messages.mjs';
import { MOTIFS_FIL, chargeAlerteFil, motifRefusFil, nomFil, nomPost } from '../noyau/discord/bilingue.mjs';
import { texte as T } from '../noyau/langues.mjs';
import { EN } from '../noyau/textes/en.mjs';
import { FR } from '../noyau/textes/fr.mjs';
import { banc, CLE, teamAvecMembres } from './aide.mjs';
import { ID, URL_TEST } from './discord-aide.mjs';

const JETON_BOT = 'jeton-bot-de-test-jamais-reel';
const GUILD = '700000000000000001';
const SALON = '710000000000000001';
const SALON_WEBHOOK = '720000000000000001';
const FONDATEUR = '800000000000000010';
const LEA = '800000000000000001';
const MEMBRES = {
  max12345: { pseudo: 'Max', role: 'manager' },
  coach123: { pseudo: 'Zed', role: 'coach' },
  lea12345: { pseudo: 'Léa', role: 'joueur' },
};
const HEURE = 3_600_000;

/**
 * Faux Discord : webhook (?wait=true → message avec `channel_id`), API du bot (messages, fils).
 * Un fil ouvert sur un message porte l'identifiant de ce message, comme chez Discord.
 * `programme` : réponses imposées `{ si: (url, methode) => bool, statut, corps }`, consommées une fois.
 */
function fauxDiscord({ salonWebhook = SALON_WEBHOOK } = {}) {
  const appels = [];
  const programme = [];
  let n = 0;
  const nouvelId = () => `9${String(++n).padStart(17, '0')}`;
  const repondre = (statut, corps) => new Response(corps === undefined ? null : JSON.stringify(corps), { status: statut, headers: { 'Content-Type': 'application/json' } });
  const fetch = async (url, init) => {
    const u = new URL(String(url));
    const corps = init.body ? JSON.parse(init.body) : null;
    appels.push({ url: String(url), chemin: u.pathname, params: Object.fromEntries(u.searchParams), methode: init.method, corps, auth: init.headers?.Authorization ?? null });
    const i = programme.findIndex(p => p.si(String(url), init.method));
    if (i >= 0) {
      const [r] = programme.splice(i, 1);
      return repondre(r.statut, r.corps);
    }
    const fil = /^\/api\/v10\/channels\/(\d+)\/messages\/(\d+)\/threads$/.exec(u.pathname);
    if (fil) return repondre(201, { id: fil[2], type: 11, parent_id: fil[1], name: corps.name });
    if (u.pathname.startsWith('/api/webhooks/')) {
      if (u.searchParams.get('wait') !== 'true') return repondre(204);
      const salon = u.searchParams.get('thread_id') ?? (corps?.thread_name ? nouvelId() : salonWebhook);
      return repondre(200, { id: corps?.thread_name ? salon : nouvelId(), channel_id: salon });
    }
    const msg = /^\/api\/v10\/channels\/(\d+)\/messages$/.exec(u.pathname);
    if (msg && init.method === 'POST') return repondre(200, { id: nouvelId(), channel_id: msg[1] });
    return repondre(200, {});
  };
  const posts = () => appels.filter(a => a.methode === 'POST');
  return { appels, programme, fetch, posts, fils: () => appels.filter(a => /\/threads$/.test(a.chemin)) };
}

/**
 * Team bilingue (réglage par défaut : aucune ligne discord_bilingue). `canal` : 'webhook' ou 'bot'
 * (serveur lié directement en base). `jeton` : le serveur Esport a-t-il DISCORD_BOT_TOKEN ?
 */
async function preparer({ canal = 'webhook', jeton = true, fondateur = true, discord = fauxDiscord() } = {}) {
  const b = await banc({ fetchDiscord: discord.fetch, lienApp: 'https://app.exemple/esport', discordBot: jeton ? { applicationId: '424242424242424242', publicKey: '00'.repeat(32), jetonBot: JETON_BOT } : {} });
  const A = await teamAvecMembres(b, { nom: 'Team Alpha', membres: MEMBRES, filFr: true });
  const d = `/teams/${A.teamId}/discord`;
  const t0 = new Date(b.horloge.t).toISOString();
  if (canal === 'webhook') {
    assert.equal((await b.appel(`${d}/webhook`, { methode: 'PUT', jeton: A.sessions.max12345, corps: { url: URL_TEST } })).statut, 200);
  } else {
    await b.base.executer('INSERT INTO discord_serveurs (team_id, guild_id, salon_id, salon_nom, lie_par_discord, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?)', [A.teamId, GUILD, SALON, 'annonces', '800000000000000009', t0, t0]);
    await b.base.executer('INSERT INTO discord_comptes (compte_id, discord_user_id, discord_nom, super_admin, lie_le) VALUES (?, ?, ?, 0, ?)', ['lea12345', LEA, 'lea', t0]);
  }
  if (fondateur) await b.base.executer("UPDATE comptes SET discord_id = ? WHERE id = 'principal'", [FONDATEUR]);
  // Léa est la seule convoquée : sans ce réglage, ses messages partiraient en MP (« joueur seul »). Ces tests portent
  // sur le fil français dans le salon ; les MP ont les leurs (discord-pings-mp.test.mjs).
  await b.base.executer('INSERT INTO discord_mp_reglages (team_id, relances_mp, maj_le) VALUES (?, 0, ?)', [A.teamId, t0]);
  const scrim = (titre = 'Scrim Faucons', date = '2026-10-22') =>
    b.appel(`/teams/${A.teamId}/planning`, { methode: 'POST', jeton: A.sessions.coach123, corps: { type: 'scrim', titre, date, heureDebut: '20:30', heureFin: '22:00' } });
  const traiter = (maintenant = b.horloge.t) => traiterFile(b.base, { cle: CLE, fetch: discord.fetch, maintenant, lienApp: 'https://app.exemple/esport', jetonBot: jeton ? JETON_BOT : undefined });
  const file = () => b.base.tous('SELECT * FROM discord_file WHERE team_id = ? ORDER BY cree_le, id', [A.teamId]);
  const journal = async action => (await b.base.tous('SELECT action, meta FROM journal WHERE team_id = ? AND action = ?', [A.teamId, action])).map(l => JSON.parse(l.meta));
  return { b, A, d, discord, scrim, traiter, file, journal };
}

// ------------------------------------------------------------------ Fonctions pures

test('bilingue : noms de fil et de post bornés à 100 caractères, motifs de refus, textes EN et FR présents', () => {
  const titre = 'x'.repeat(300);
  const nom = nomFil({ embeds: [{ title: `⚔️ Scrim · ${titre}` }] });
  assert.ok(nom.startsWith('🇫🇷 Version française · ⚔️ Scrim'), nom);
  assert.ok(nom.length <= 100, String(nom.length));
  assert.equal(nomFil({}), '🇫🇷 Version française');
  assert.ok(nomPost({ embeds: [{ title: titre }] }).length <= 100);
  assert.equal(motifRefusFil({ statut: 403, code: 50013 }, 'creer'), 'creer_fil');
  assert.equal(motifRefusFil({ statut: 403, code: 50013 }, 'ecrire'), 'ecrire_fil');
  assert.equal(motifRefusFil({ statut: 403, code: 50001 }, 'creer'), 'acces');
  assert.equal(motifRefusFil({ statut: 404, code: 10003 }, 'creer'), 'acces');
  assert.equal(motifRefusFil({ statut: 400, code: 50035 }, 'creer'), 'autre');
  // Toutes les chaînes du fil français existent dans les deux langues (mêmes variables : langues.test.mjs).
  for (const cle of ['fil.nom', 'fil.fondateur', 'fil.alerte.titre', 'fil.alerte.texte', ...Object.keys(MOTIFS_FIL).map(m => `fil.permission.${m}`), 'fil.permission.autre']) {
    assert.ok(EN[cle] && FR[cle] && EN[cle] !== FR[cle], cle);
  }
  // Alerte : anglais court puis français ; mention du Fondateur seule ; sans ID, « Fondateur » sans ping.
  const a = chargeAlerteFil({ motif: 'creer_fil', fondateurId: FONDATEUR, team: { nom: 'Alpha' } });
  assert.equal(a.content, `<@${FONDATEUR}>`);
  assert.deepEqual(a.allowed_mentions, { parse: [], users: [FONDATEUR] });
  assert.match(texteCharge(a), /Create Public Threads[\s\S]*🇫🇷 Le bot n’a pas accès pour créer le fil français/);
  const sans = chargeAlerteFil({ motif: 'bot_absent', fondateurId: null, team: { nom: 'Alpha' } });
  assert.equal(sans.content, 'Fondateur');
  assert.deepEqual(sans.allowed_mentions, { parse: [] });
  assert.match(texteCharge(chargeAlerteFil({ motif: 'autre', statut: 400 })), /HTTP 400/);
});

// ------------------------------------------------------------------ Webhook

test('webhook : anglais d’abord (?wait=true), fil créé par le bot sur ce message, version française dans le fil (?thread_id=)', async () => {
  const p = await preparer();
  assert.equal((await p.scrim()).statut, 200);
  const [en, fil, fr, ...reste] = p.discord.appels;
  assert.equal(reste.length, 0, JSON.stringify(reste.map(a => a.url)));
  // 1. Anglais, par le webhook, avec ?wait=true pour connaître l'identifiant du message.
  assert.equal(en.chemin, `/api/webhooks/${ID}/${URL_TEST.split('/').at(-1)}`);
  assert.equal(en.params.wait, 'true');
  assert.equal(en.auth, null, 'jamais le jeton du bot vers un webhook');
  const texteEn = texteCharge(en.corps);
  assert.match(texteEn, /New event\*\*: Scrim Faucons \(Scrim\), on Thursday 22 October at 20:30/);
  assert.doesNotMatch(texteEn, /Nouvel|jeudi/);
  assert.equal(en.corps.components[0].components.at(-1).label, 'Open in the app');
  // 2. Fil : par le bot, sur le message anglais, dans le salon du webhook.
  assert.match(fil.chemin, new RegExp(`^/api/v10/channels/${SALON_WEBHOOK}/messages/\\d+/threads$`));
  assert.equal(fil.auth, `Bot ${JETON_BOT}`);
  assert.ok(fil.corps.name.startsWith('🇫🇷 Version française · '), fil.corps.name);
  assert.ok(fil.corps.name.length <= 100);
  const idEn = fil.chemin.split('/')[6];
  // 3. Français, par le webhook, dans le fil (thread_id = identifiant du message).
  assert.equal(fr.params.thread_id, idEn);
  assert.match(texteCharge(fr.corps), /Nouvel événement\*\* : Scrim Faucons \(Scrim\), le jeudi 22 octobre à 20:30/);
  assert.equal(fr.corps.components[0].components.at(-1).label, 'Ouvrir dans l’app');
  assert.deepEqual(fr.corps.allowed_mentions, { parse: [] });
  assert.equal(fr.corps.content, undefined, 'aucune mention dans le fil');
  const [ligne] = await p.file();
  assert.equal(ligne.statut, 'envoye');
  assert.equal(ligne.message_id, idEn);
  assert.equal(ligne.fil_id, idEn);
  assert.equal(ligne.derniere_erreur, null);
  // L'écran Discord le sait : fil activé par défaut, dernier fil réussi, permissions à vérifier.
  const etat = (await p.b.appel(p.d, { jeton: p.A.sessions.max12345 })).corps;
  assert.equal(etat.bilingue.filFr, true);
  assert.equal(etat.languePrincipale, 'en');
  assert.ok(etat.bilingue.dernierFil);
  assert.equal(etat.bilingue.probleme, false);
  assert.ok(etat.bilingue.permissions.includes('Create Public Threads') && etat.bilingue.permissions.includes('Send Messages in Threads'));
  assert.match(etat.parametres.find(x => x.cle === 'event_created').apercu, /New event/);
});

test('webhook : le rôle mentionné reste sur le message anglais ; le fil n’a aucune mention', async () => {
  const p = await preparer();
  assert.equal((await p.b.appel(`${p.d}/parametres/event_created`, { methode: 'PUT', jeton: p.A.sessions.max12345, corps: { roleMention: '555666777888999000' } })).statut, 200);
  await p.scrim();
  const [en, , fr] = p.discord.appels;
  assert.equal(en.corps.content, '<@&555666777888999000>');
  assert.deepEqual(en.corps.allowed_mentions, { parse: [], roles: ['555666777888999000'] });
  assert.equal(fr.corps.content, undefined);
  assert.deepEqual(fr.corps.allowed_mentions, { parse: [] });
});

test('webhook vers un salon forum : le message anglais ouvre un post (thread_name), la version française y répond, sans le bot', async () => {
  const discord = fauxDiscord();
  // Discord refuse un message de webhook sans thread_name dans un forum (code 220001).
  discord.programme.push({ si: (url, m) => m === 'POST' && url.includes('/api/webhooks/') && !url.includes('thread_id'), statut: 400, corps: { code: 220001, message: 'Webhooks posted to forum channels must have a thread_name or thread_id' } });
  const p = await preparer({ discord, jeton: false });
  await p.scrim();
  const [refus, post, fr, ...reste] = discord.appels;
  assert.equal(reste.length, 0);
  assert.equal(refus.corps.thread_name, undefined);
  assert.ok(post.corps.thread_name.startsWith('⚔️ Scrim · Scrim Faucons'), post.corps.thread_name);
  assert.match(texteCharge(post.corps), /New event/);
  assert.ok(fr.params.thread_id);
  assert.match(texteCharge(fr.corps), /Nouvel événement/);
  assert.equal(discord.fils().length, 0, 'un post de forum est déjà un fil : pas besoin du bot');
  assert.equal((await p.file())[0].statut, 'envoye');
});

// ------------------------------------------------------------------ Bot

test('bot : annonce anglaise (pings des convoqués, boutons RSVP), fil, version française avec boutons ; un clic réédite les deux', async () => {
  const p = await preparer({ canal: 'bot' });
  await p.scrim();
  const [en, fil, fr, ...reste] = p.discord.appels;
  assert.equal(reste.length, 0, JSON.stringify(reste.map(a => a.url)));
  assert.equal(en.chemin, `/api/v10/channels/${SALON}/messages`);
  assert.equal(en.corps.content, `<@${LEA}>`, 'les pings des convoqués restent sur le message principal');
  assert.deepEqual(en.corps.allowed_mentions, { parse: [], users: [LEA] });
  assert.equal(en.corps.username, undefined);
  assert.equal(en.corps.embeds[0].title, '⚔️ Scrim · Scrim Faucons');
  assert.deepEqual(en.corps.components[0].components.slice(0, 3).map(c => c.label), ['Yes', 'Maybe', 'No']);
  assert.equal(typeof en.corps.nonce, 'string');
  assert.ok(en.corps.nonce.length <= 25 && en.corps.enforce_nonce === true);
  const idEn = '900000000000000001';
  assert.equal(fil.chemin, `/api/v10/channels/${SALON}/messages/${idEn}/threads`);
  assert.equal(fil.corps.auto_archive_duration, 1440);
  assert.equal(fr.chemin, `/api/v10/channels/${idEn}/messages`);
  assert.equal(fr.corps.content, undefined);
  assert.deepEqual(fr.corps.allowed_mentions, { parse: [] });
  assert.notEqual(fr.corps.nonce, en.corps.nonce);
  assert.deepEqual(fr.corps.components[0].components.slice(0, 3).map(c => c.label), ['Oui', 'Peut-être', 'Non']);
  assert.equal(fr.corps.components[0].components[0].custom_id, en.corps.components[0].components[0].custom_id, 'mêmes boutons RSVP : ils marchent dans le fil');
  assert.match(texteCharge(fr.corps), /Convoqués|Réponses/);
  const annonce = await p.b.base.premier('SELECT * FROM discord_annonces', []);
  assert.equal(annonce.message_id, idEn);
  assert.equal(annonce.langue, 'en');
  assert.equal(annonce.fr_salon_id, idEn);
  assert.equal(annonce.fr_message_id, '900000000000000002');
  // Une réponse (depuis l'app) : l'annonce anglaise ET sa version française sont rééditées.
  const occ = (await p.b.appel(`/teams/${p.A.teamId}/planning`, { jeton: p.A.sessions.lea12345 })).corps.occurrences.find(o => o.titre === 'Scrim Faucons');
  assert.equal((await p.b.appel(`/teams/${p.A.teamId}/planning/${occ.evenementId}/occurrences/${encodeURIComponent(occ.cle)}/rsvp`, { methode: 'PUT', jeton: p.A.sessions.lea12345, corps: { rsvp: 'oui' } })).statut, 200);
  const editions = p.discord.appels.filter(a => a.methode === 'PATCH');
  assert.deepEqual(editions.map(e => e.chemin), [`/api/v10/channels/${SALON}/messages/${idEn}`, `/api/v10/channels/${idEn}/messages/900000000000000002`]);
  assert.match(texteCharge(editions[0].corps), /Yes/);
  assert.match(texteCharge(editions[1].corps), /✅ \*\*1\*\* Oui/);
  assert.deepEqual(editions[1].corps.allowed_mentions, { parse: [] });
});

// ------------------------------------------------------------------ Fil impossible : alerte au Fondateur

test('permission manquante (403, 50013) : l’anglais reste, aucun second message français, alerte qui mentionne le Fondateur', async () => {
  const discord = fauxDiscord();
  discord.programme.push({ si: url => url.endsWith('/threads'), statut: 403, corps: { code: 50013, message: 'Missing Permissions' } });
  const p = await preparer({ canal: 'bot', discord });
  await p.scrim();
  const [en, fil, alerte, ...reste] = discord.appels;
  assert.equal(reste.length, 0, JSON.stringify(reste.map(a => a.url)));
  assert.match(texteCharge(en.corps), /New event/);
  assert.ok(fil.chemin.endsWith('/threads'));
  assert.equal(alerte.chemin, `/api/v10/channels/${SALON}/messages`);
  assert.equal(alerte.corps.content, `<@${FONDATEUR}>`);
  assert.deepEqual(alerte.corps.allowed_mentions, { parse: [], users: [FONDATEUR] });
  const texteAlerte = texteCharge(alerte.corps);
  assert.match(texteAlerte, /does not have access to create the French thread[\s\S]*Create Public Threads/);
  assert.match(texteAlerte, /🇫🇷 Le bot n’a pas accès pour créer le fil français dans ce salon/);
  assert.doesNotMatch(texteAlerte, /Nouvel événement/, 'pas de version française en second message');
  const [ligne] = await p.file();
  assert.equal(ligne.statut, 'envoye');
  assert.equal(ligne.derniere_erreur, MOTIFS_FIL.creer_fil);
  assert.equal((await p.journal('discord.french_thread_unavailable')).length, 1);
  const etat = (await p.b.appel(p.d, { jeton: p.A.sessions.max12345 })).corps.bilingue;
  assert.equal(etat.probleme, true);
  assert.equal(etat.motifEchec, MOTIFS_FIL.creer_fil);
  // Anti-spam : un deuxième message dans les 24 h → pas de nouvelle alerte dans ce salon.
  discord.programme.push({ si: url => url.endsWith('/threads'), statut: 403, corps: { code: 50013 } });
  assert.equal((await p.scrim('Scrim 2', '2026-10-23')).statut, 200);
  const apres = discord.appels.slice(3);
  assert.equal(apres.length, 2, JSON.stringify(apres.map(a => a.url)));
  assert.ok(apres.every(a => a.corps.content !== `<@${FONDATEUR}>`));
  assert.equal((await p.journal('discord.french_thread_unavailable')).length, 2, 'chaque fil impossible reste journalisé');
  // L'alerte date de plus de 24 h : une nouvelle peut partir.
  const vieille = new Date(p.b.horloge.t - 25 * HEURE).toISOString();
  await p.b.base.executer('UPDATE discord_alertes_fil SET alerte_le = ?', [vieille]);
  discord.programme.push({ si: url => url.endsWith('/threads'), statut: 403, corps: { code: 50013 } });
  assert.equal((await p.scrim('Scrim 3', '2026-10-24')).statut, 200);
  assert.equal(discord.appels.slice(5).filter(a => a.corps?.content === `<@${FONDATEUR}>`).length, 1);
});

test('fil créé mais écriture refusée (Send Messages in Threads) : alerte avec cette permission', async () => {
  const discord = fauxDiscord();
  discord.programme.push({ si: (url, m) => m === 'POST' && /\/channels\/900000000000000001\/messages$/.test(url), statut: 403, corps: { code: 50013 } });
  const p = await preparer({ canal: 'bot', discord });
  await p.scrim();
  const alerte = discord.appels.at(-1);
  assert.equal(alerte.chemin, `/api/v10/channels/${SALON}/messages`);
  assert.match(texteCharge(alerte.corps), /Send Messages in Threads/);
  assert.equal((await p.file())[0].derniere_erreur, MOTIFS_FIL.ecrire_fil);
});

test('bot non configuré (webhook, sans DISCORD_BOT_TOKEN) : l’anglais part, alerte par le webhook ; sans Discord ID du Fondateur, « Fondateur » sans ping et journal', async () => {
  const p = await preparer({ jeton: false, fondateur: false });
  await p.scrim();
  const [en, alerte, ...reste] = p.discord.appels;
  assert.equal(reste.length, 0);
  assert.match(texteCharge(en.corps), /New event/);
  assert.equal(p.discord.fils().length, 0);
  assert.ok(alerte.chemin.startsWith('/api/webhooks/'));
  assert.equal(alerte.params.thread_id, undefined);
  assert.equal(alerte.corps.content, 'Fondateur');
  assert.deepEqual(alerte.corps.allowed_mentions, { parse: [] });
  assert.match(texteCharge(alerte.corps), /bot is not configured/);
  assert.equal((await p.file())[0].derniere_erreur, MOTIFS_FIL.bot_absent);
  assert.equal((await p.journal('discord.founder_discord_missing')).length, 1);
  const anti = await p.b.base.premier('SELECT * FROM discord_alertes_fil', []);
  assert.equal(anti.salon_id, SALON_WEBHOOK);
});

test('liaison /lier du Fondateur : elle prime sur le Discord ID saisi', async () => {
  const discord = fauxDiscord();
  discord.programme.push({ si: url => url.endsWith('/threads'), statut: 403, corps: { code: 50001 } });
  const p = await preparer({ canal: 'bot', discord });
  await p.b.base.executer("INSERT INTO discord_comptes (compte_id, discord_user_id, discord_nom, super_admin, lie_le) VALUES ('principal', '800000000000000077', 'fondateur', 1, '2026-01-01T00:00:00.000Z')", []);
  await p.scrim();
  const alerte = discord.appels.at(-1);
  assert.equal(alerte.corps.content, '<@800000000000000077>');
  assert.match(texteCharge(alerte.corps), /View Channel/);
});

// ------------------------------------------------------------------ Idempotence et réessais

test('réessais : 429 sur le fil puis 5xx sur le français → reprise à l’étape suivante, jamais de doublon', async () => {
  const discord = fauxDiscord();
  discord.programme.push({ si: url => url.endsWith('/threads'), statut: 429, corps: { retry_after: 5 } });
  const p = await preparer({ canal: 'bot', discord });
  await p.scrim();
  assert.equal(discord.appels.length, 2);
  let [ligne] = await p.file();
  assert.equal(ligne.statut, 'attente');
  assert.equal(ligne.message_id, '900000000000000001');
  assert.equal(ligne.fil_id, null);
  assert.equal(Number(ligne.essais), 0, 'un 429 ne compte pas d’essai');
  // Trop tôt : rien ne part.
  await p.traiter(p.b.horloge.t + 1000);
  assert.equal(discord.appels.length, 2);
  // Après l'attente : fil créé ; le français échoue (502) → réessai plus tard, l'anglais n'est pas reposté.
  discord.programme.push({ si: (url, m) => m === 'POST' && url.endsWith('/channels/900000000000000001/messages'), statut: 502, corps: {} });
  await p.traiter(p.b.horloge.t + 6000);
  assert.deepEqual(discord.appels.slice(2).map(a => a.chemin), ['/api/v10/channels/710000000000000001/messages/900000000000000001/threads', '/api/v10/channels/900000000000000001/messages']);
  [ligne] = await p.file();
  assert.equal(ligne.statut, 'attente');
  assert.equal(ligne.fil_id, '900000000000000001');
  assert.equal(Number(ligne.essais), 1);
  // Réessai : seulement le français.
  await p.traiter(p.b.horloge.t + 2 * 60_000);
  assert.deepEqual(discord.appels.slice(4).map(a => a.chemin), ['/api/v10/channels/900000000000000001/messages']);
  // Même nonce pour la même étape : Discord dédoublonne un envoi rejoué.
  assert.equal(discord.appels[4].corps.nonce, discord.appels[3].corps.nonce);
  [ligne] = await p.file();
  assert.equal(ligne.statut, 'envoye');
  const anglais = discord.appels.filter(a => a.chemin === `/api/v10/channels/${SALON}/messages`);
  assert.equal(anglais.length, 1, 'un seul message anglais');
  assert.equal(discord.fils().length, 2, 'le fil n’est demandé qu’après le 429, une fois');
  // Rien ne repart ensuite.
  await p.traiter(p.b.horloge.t + HEURE);
  assert.equal(discord.appels.length, 5);
});

test('réessai après un fil déjà créé (160004) : le fil du message est réutilisé', async () => {
  const discord = fauxDiscord();
  discord.programme.push({ si: url => url.endsWith('/threads'), statut: 400, corps: { code: 160004, message: 'A thread has already been created for this message' } });
  const p = await preparer({ canal: 'bot', discord });
  await p.scrim();
  const fr = discord.appels.at(-1);
  assert.equal(fr.chemin, '/api/v10/channels/900000000000000001/messages');
  assert.match(texteCharge(fr.corps), /Nouvel événement/);
  assert.equal((await p.file())[0].statut, 'envoye');
});

test('échec du message anglais : rien d’autre ne part (ni fil, ni français) ; le réessai envoie les trois étapes', async () => {
  const discord = fauxDiscord();
  discord.programme.push({ si: url => url.includes('/api/webhooks/'), statut: 503, corps: {} });
  const p = await preparer({ discord });
  await p.scrim();
  assert.equal(discord.appels.length, 1);
  assert.equal((await p.file())[0].message_id, null);
  await p.traiter(p.b.horloge.t + 2 * 60_000);
  assert.equal(discord.appels.length, 4);
  assert.equal((await p.file())[0].statut, 'envoye');
});

// ------------------------------------------------------------------ Réglage par team

test('réglage : fil français activé par défaut ; désactivé → un seul message, dans la langue choisie ; réservé à discord.manage', async () => {
  const p = await preparer();
  const refus = await p.b.appel(`${p.d}/bilingue`, { methode: 'PUT', jeton: p.A.sessions.lea12345, corps: { filFr: false } });
  assert.equal(refus.statut, 403);
  assert.equal((await p.b.appel(`${p.d}/bilingue`, { methode: 'PUT', jeton: p.A.sessions.max12345, corps: { filFr: 'non' } })).statut, 400);
  const off = await p.b.appel(`${p.d}/bilingue`, { methode: 'PUT', jeton: p.A.sessions.max12345, corps: { filFr: false } });
  assert.equal(off.statut, 200);
  assert.equal(off.corps.filFr, false);
  const etat = (await p.b.appel(p.d, { jeton: p.A.sessions.max12345 })).corps;
  assert.equal(etat.bilingue.filFr, false);
  assert.equal(etat.languePrincipale, 'fr', 'sans fil : la langue choisie (français par défaut)');
  await p.scrim();
  assert.equal(p.discord.appels.length, 1);
  assert.match(texteCharge(p.discord.appels[0].corps), /Nouvel événement/);
  assert.equal(p.discord.appels[0].params.wait, undefined);
  // Réactivé : anglais + fil.
  assert.equal((await p.b.appel(`${p.d}/bilingue`, { methode: 'PUT', jeton: p.A.sessions.max12345, corps: { filFr: true } })).corps.filFr, true);
  await p.scrim('Scrim 2', '2026-10-23');
  assert.equal(p.discord.appels.length, 4);
  assert.match(texteCharge(p.discord.appels[1].corps), /New event/);
});

test('team créée sans réglage : fil français actif (défaut de la migration 0020)', async () => {
  const b = await banc();
  const A = await teamAvecMembres(b, { membres: MEMBRES, filFr: true });
  assert.ok(!(await b.base.premier('SELECT * FROM discord_bilingue WHERE team_id = ?', [A.teamId])));
  const etat = (await b.appel(`/teams/${A.teamId}/discord`, { jeton: A.sessions.max12345 })).corps;
  assert.equal(etat.bilingue.filFr, true);
  assert.equal(etat.languePrincipale, 'en');
  assert.equal(etat.bilingue.botConfigure, false);
});

test('message de test : anglais puis fil français ; sans bot, le résultat dit pourquoi (aucune alerte dans le salon)', async () => {
  const p = await preparer();
  const r = await p.b.appel(`${p.d}/test`, { methode: 'POST', jeton: p.A.sessions.max12345, corps: {} });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.deepEqual(r.corps.fil, { cree: true, motif: null });
  const [en, fil, fr] = p.discord.appels;
  assert.match(texteCharge(en.corps), new RegExp(T('en', 'test.titre')));
  assert.ok(fil.chemin.endsWith('/threads'));
  assert.match(texteCharge(fr.corps), new RegExp(T('fr', 'test.titre')));

  const q = await preparer({ jeton: false });
  const r2 = await q.b.appel(`${q.d}/test`, { methode: 'POST', jeton: q.A.sessions.max12345, corps: {} });
  assert.equal(r2.statut, 200);
  assert.deepEqual(r2.corps.fil, { cree: false, motif: MOTIFS_FIL.bot_absent });
  assert.equal(q.discord.appels.length, 1);
  assert.equal((await q.b.appel(q.d, { jeton: q.A.sessions.max12345 })).corps.bilingue.probleme, true);
});
