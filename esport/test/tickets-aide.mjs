/**
 * Aides des tests des tickets : FAUX serveur Gateway Discord (WebSocket écrit à la main sur node:http, sans
 * dépendance : poignée de main, trames texte et fermeture), FAUX Discord REST (salons, messages, MP, rôles…) et
 * interactions signées. Jamais de réseau réel.
 */

import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function trame(opcode, charge = Buffer.alloc(0)) {
  const n = charge.length;
  const tete = n < 126 ? Buffer.from([0x80 | opcode, n]) : n < 65536 ? Buffer.from([0x80 | opcode, 126, n >> 8, n & 255]) : null;
  if (!tete) throw new Error('trame trop grande');
  return Buffer.concat([tete, charge]);
}

/** Lit les trames (masquées) du client dans `tampon` ; rend { trames, reste }. */
function lireTrames(tampon) {
  const trames = [];
  let i = 0;
  while (tampon.length - i >= 2) {
    const op = tampon[i] & 0x0f;
    let n = tampon[i + 1] & 0x7f;
    const masque = (tampon[i + 1] & 0x80) !== 0;
    let j = i + 2;
    if (n === 126) {
      if (tampon.length < j + 2) break;
      n = tampon.readUInt16BE(j);
      j += 2;
    } else if (n === 127) {
      if (tampon.length < j + 8) break;
      n = Number(tampon.readBigUInt64BE(j));
      j += 8;
    }
    const cle = masque ? tampon.subarray(j, j + 4) : null;
    if (masque) j += 4;
    if (tampon.length < j + n) break;
    const charge = Buffer.from(tampon.subarray(j, j + n));
    if (cle) for (let k = 0; k < n; k++) charge[k] ^= cle[k % 4];
    trames.push({ op, charge });
    i = j + n;
  }
  return { trames, reste: tampon.subarray(i) };
}

/**
 * Faux serveur Gateway. `intervalle` : heartbeat_interval annoncé (ms). `auto` : HELLO à la connexion, ACK des
 * battements, READY à l'IDENTIFY, RESUMED au RESUME (réglables par connexion : `conn.sansAck = true`…).
 * Rend `{ url, connexions, recus, envoyer(conn, objet), fermer(conn, code), arreter() }`.
 */
export async function fauxGateway({ intervalle = 60, session = 'session-test-1' } = {}) {
  const connexions = [];
  const recus = [];
  const serveur = createServer();
  let url = '';
  serveur.on('upgrade', (req, socket) => {
    const accepte = createHash('sha1').update(`${req.headers['sec-websocket-key']}${GUID}`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accepte}\r\n\r\n`);
    const conn = { socket, chemin: req.url, recus: [], ferme: false, sansAck: false, seq: 0 };
    connexions.push(conn);
    const envoyer = o => {
      if (!conn.ferme) socket.write(trame(1, Buffer.from(JSON.stringify(o))));
    };
    conn.envoyer = envoyer;
    conn.dispatch = (t, d) => envoyer({ op: 0, t, s: ++conn.seq, d });
    let tampon = Buffer.alloc(0);
    socket.on('data', morceau => {
      tampon = Buffer.concat([tampon, morceau]);
      const { trames, reste } = lireTrames(tampon);
      tampon = Buffer.from(reste);
      for (const t of trames) {
        if (t.op === 8) {
          conn.codeClient = t.charge.length >= 2 ? t.charge.readUInt16BE(0) : null;
          if (!conn.ferme) socket.end(trame(8, t.charge.subarray(0, 2)));
          conn.ferme = true;
          continue;
        }
        if (t.op === 9) {
          socket.write(trame(10, t.charge));
          continue;
        }
        if (t.op !== 1) continue;
        const m = JSON.parse(t.charge.toString('utf8'));
        conn.recus.push(m);
        recus.push({ conn, ...m });
        if (m.op === 1 && !conn.sansAck) envoyer({ op: 11 });
        if (m.op === 2 && !conn.sansReady) conn.dispatch('READY', { v: 10, session_id: session, resume_gateway_url: url, user: { id: '424242424242424242', bot: true }, guilds: [] });
        if (m.op === 6) {
          if (conn.refuserReprise) envoyer({ op: 9, d: false });
          else {
            conn.seq = m.d.seq ?? 0;
            conn.dispatch('RESUMED', {});
          }
        }
      }
    });
    socket.on('close', () => {
      conn.ferme = true;
    });
    socket.on('error', () => undefined);
    envoyer({ op: 10, d: { heartbeat_interval: intervalle } });
  });
  await new Promise(ok => serveur.listen(0, '127.0.0.1', ok));
  url = `ws://127.0.0.1:${serveur.address().port}`;
  return {
    url,
    connexions,
    recus,
    ouvertes: () => connexions.filter(c => !c.ferme),
    /** Ferme une connexion côté serveur avec un code (4000 : reprise attendue ; 4014 : intents refusés). */
    fermer(conn, code = 4000) {
      if (conn.ferme) return;
      const b = Buffer.alloc(2);
      b.writeUInt16BE(code);
      conn.socket.end(trame(8, b));
      conn.ferme = true;
    },
    async arreter() {
      for (const c of connexions) c.socket.destroy();
      await new Promise(ok => serveur.close(() => ok()));
    },
  };
}

/** Attend qu'une condition soit vraie (sondage court), sinon échoue. */
export async function attendre(condition, { delai = 3000, pas = 10, message = 'condition non atteinte' } = {}) {
  const fin = Date.now() + delai;
  for (;;) {
    const v = await condition();
    if (v) return v;
    if (Date.now() > fin) throw new Error(message);
    await new Promise(ok => setTimeout(ok, pas));
  }
}

/**
 * Faux Discord REST pour les tickets : serveur, salons, rôles, membres, messages (création, édition, lecture), MP.
 * `etat` garde ce qui a été créé ; `appels` tout ce qui a été demandé ; `programme` : réponses imposées (FIFO).
 */
export function fauxDiscordRest({ gateway, guild = '700000000000000001', bot = '424242424242424242' } = {}) {
  const appels = [];
  const programme = [];
  // `roles`, `absents`, `attributions` : rôles créés, membres absents du serveur, attributions (vocaux/tournoi.mjs).
  const etat = { salons: new Map(), messages: new Map(), mp: [], n: 0, roles: new Map(), absents: new Set(), attributions: [], positions: new Map(), listerCrees: false, membres: [{ user: { id: '800000000000000077', username: 'zoe', global_name: 'Zoé' }, nick: null }, { user: { id: '800000000000000078', username: 'zorro', global_name: null }, nick: 'Zorro le Grand' }, { user: { id: '424242424242424243', username: 'zbot', bot: true }, nick: null }] };
  const id = () => `9${String(++etat.n).padStart(17, '0')}`;
  const rep = (corps, statut = 200, entetes = {}) => new Response(corps === undefined ? null : JSON.stringify(corps), { status: statut, headers: { 'Content-Type': 'application/json', ...entetes } });
  etat.salons.set('710000000000000010', { id: '710000000000000010', type: 4, name: 'Tickets', guild_id: guild, permission_overwrites: [] });
  etat.salons.set('710000000000000011', { id: '710000000000000011', type: 4, name: 'Archives', guild_id: guild, permission_overwrites: [] });
  etat.salons.set('710000000000000012', { id: '710000000000000012', type: 0, name: 'journaux', guild_id: guild, permission_overwrites: [] });
  etat.salons.set('710000000000000013', { id: '710000000000000013', type: 0, name: 'support', guild_id: guild, permission_overwrites: [] });
  const fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const methode = init.method ?? 'GET';
    let corps = null;
    if (typeof init.body === 'string') corps = JSON.parse(init.body);
    else if (init.body instanceof FormData) corps = { multipart: true, ...JSON.parse(init.body.get('payload_json')) };
    const chemin = u.pathname.replace(/^\/api\/v10/, '');
    appels.push({ methode, chemin, corps, url: String(url), entetes: init.headers });
    if (programme.length && (!programme[0].si || programme[0].si(methode, chemin))) {
      const r = programme.shift();
      if (r instanceof Error) throw r;
      return rep(r.corps, r.statut, r.entetes);
    }
    if (u.hostname === 'cdn.discordapp.com') return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'Content-Type': 'image/png', 'Content-Length': '4' } });
    if (chemin === '/gateway/bot') return rep({ url: gateway?.url ?? 'wss://gateway.discord.gg', shards: 1, session_start_limit: { total: 1000, remaining: 999, reset_after: 0, max_concurrency: 1 } });
    if (chemin === '/users/@me') return rep({ id: bot, username: 'Esport HQ', bot: true });
    if (chemin === '/users/@me/guilds') return rep([{ id: guild, name: 'Club' }]);
    if (chemin === `/guilds/${guild}/channels` && methode === 'GET') return rep([...etat.salons.values()]);
    if (chemin === `/guilds/${guild}/channels` && methode === 'POST') {
      const s = { id: id(), guild_id: guild, ...corps };
      etat.salons.set(s.id, s);
      return rep(s, 201);
    }
    // Positions des salons : [{ id, position }].
    if (chemin === `/guilds/${guild}/channels` && methode === 'PATCH') {
      for (const x of Array.isArray(corps) ? corps : []) if (etat.salons.has(x.id)) etat.salons.get(x.id).position = x.position;
      return rep(undefined, 204);
    }
    if (chemin === `/guilds/${guild}/roles` && methode === 'POST') {
      const r = { id: id(), position: 1, ...corps };
      etat.roles.set(r.id, r);
      return rep(r);
    }
    // Positions des rôles (événements du club : rôles placés sous un rôle repère) : [{ id, position }].
    if (chemin === `/guilds/${guild}/roles` && methode === 'PATCH') {
      for (const x of Array.isArray(corps) ? corps : []) {
        const r = etat.roles.get(x.id);
        if (r) r.position = x.position;
        else etat.positions.set(x.id, x.position);
      }
      return rep([...etat.roles.values()]);
    }
    const role = /^\/guilds\/\d+\/roles\/(\d+)$/.exec(chemin);
    if (role && methode === 'PATCH') {
      const r = etat.roles.get(role[1]);
      if (!r) return rep({ code: 10011, message: 'Unknown Role' }, 404);
      Object.assign(r, corps);
      return rep(r);
    }
    if (role && methode === 'DELETE') {
      if (!etat.roles.has(role[1])) return rep({ code: 10011, message: 'Unknown Role' }, 404);
      etat.roles.delete(role[1]);
      return rep(undefined, 204);
    }
    const attribution = /^\/guilds\/\d+\/members\/(\d+)\/roles\/(\d+)$/.exec(chemin);
    if (attribution) {
      if (etat.absents.has(attribution[1])) return rep({ code: 10007, message: 'Unknown Member' }, 404);
      if (!etat.roles.has(attribution[2])) return rep({ code: 10011, message: 'Unknown Role' }, 404);
      etat.attributions.push({ methode, membre: attribution[1], role: attribution[2] });
      return rep(undefined, 204);
    }
    if (chemin === `/guilds/${guild}/roles`) {
      const fixes = [{ id: guild, name: '@everyone', permissions: '1024', position: 0 }, { id: '720000000000000001', name: 'Staff', permissions: '0', position: 2 }, { id: '720000000000000002', name: 'Esport HQ', permissions: String((1n << 4n) | (1n << 10n) | (1n << 11n) | (1n << 14n) | (1n << 15n) | (1n << 16n) | (1n << 28n)), managed: true, position: 3 }];
      // Rôles créés par le bot (etat.roles) ajoutés à la liste quand un test le demande (`etat.listerCrees`) ;
      // `etat.positions` : positions déplacées (PATCH).
      return rep([...fixes.map(r => ({ ...r, position: etat.positions.get(r.id) ?? r.position })), ...(etat.listerCrees ? [...etat.roles.values()].map(r => ({ permissions: '0', position: 1, ...r })) : [])]);
    }
    if (chemin === `/guilds/${guild}/members/${bot}`) return rep({ user: { id: bot }, roles: ['720000000000000002'] });
    if (chemin === `/guilds/${guild}/members/search`) {
      const q = String(u.searchParams.get('query') ?? '').toLowerCase();
      return rep(etat.membres.filter(m => [m.user.username, m.user.global_name, m.nick].some(v => v && v.toLowerCase().startsWith(q))).slice(0, Number(u.searchParams.get('limit') ?? 1)));
    }
    const membre = /^\/guilds\/\d+\/members\/(\d+)$/.exec(chemin);
    if (membre && methode === 'GET') {
      if (etat.absents.has(membre[1])) return rep({ code: 10007, message: 'Unknown Member' }, 404);
      return rep({ user: { id: membre[1], username: `u${membre[1].slice(-3)}` }, roles: [] });
    }
    const salon = /^\/channels\/(\d+)$/.exec(chemin);
    if (salon) {
      const s = etat.salons.get(salon[1]);
      if (!s) return rep({ code: 10003, message: 'Unknown Channel' }, 404);
      if (methode === 'PATCH') Object.assign(s, corps);
      if (methode === 'DELETE') etat.salons.delete(salon[1]);
      return rep(s);
    }
    const perm = /^\/channels\/(\d+)\/permissions\/(\d+)$/.exec(chemin);
    if (perm) {
      const s = etat.salons.get(perm[1]);
      if (!s) return rep({ code: 10003 }, 404);
      s.permission_overwrites = (s.permission_overwrites ?? []).filter(o => o.id !== perm[2]);
      if (methode === 'PUT') s.permission_overwrites.push({ id: perm[2], ...corps });
      return rep(undefined, 204);
    }
    const msgs = /^\/channels\/(\d+)\/messages$/.exec(chemin);
    if (msgs) {
      if (methode === 'POST') {
        // `enforce_nonce` (comme Discord) : un message au même nonce déjà posté dans le salon est rendu, pas doublé.
        const deja = corps?.enforce_nonce && corps.nonce ? (etat.messages.get(msgs[1]) ?? []).find(x => x.nonce === corps.nonce) : null;
        if (deja) return rep(deja);
        const m = { id: id(), channel_id: msgs[1], author: { id: bot, bot: true }, ...corps, timestamp: new Date().toISOString() };
        if (!etat.messages.has(msgs[1])) etat.messages.set(msgs[1], []);
        etat.messages.get(msgs[1]).push(m);
        if (/^96/.test(msgs[1])) etat.mp.push({ destinataire: `80${msgs[1].slice(2)}`, ...m });
        return rep(m);
      }
      const liste = [...(etat.messages.get(msgs[1]) ?? [])];
      const apres = u.searchParams.get('after');
      return rep(liste.filter(m => !apres || BigInt(m.id) > BigInt(apres)).reverse().slice(0, Number(u.searchParams.get('limit') ?? 50)));
    }
    const msg = /^\/channels\/(\d+)\/messages\/(\d+)$/.exec(chemin);
    if (msg) {
      const m = (etat.messages.get(msg[1]) ?? []).find(x => x.id === msg[2]);
      if (!m) return rep({ code: 10008 }, 404);
      if (methode === 'PATCH') Object.assign(m, corps);
      if (methode === 'DELETE') {
        etat.messages.set(msg[1], etat.messages.get(msg[1]).filter(x => x.id !== msg[2]));
        return rep(undefined, 204);
      }
      return rep(m);
    }
    if (chemin === '/users/@me/channels' && methode === 'POST') return rep({ id: `96${corps.recipient_id.slice(2)}`, type: 1 });
    if (/^\/webhooks\//.test(chemin)) return rep({});
    return rep({});
  };
  /** Message posté par un utilisateur dans un salon (comme sur Discord), sans passer par la Gateway. */
  const posterUtilisateur = (salonId, auteur, contenu, extra = {}) => {
    const m = { id: id(), channel_id: salonId, type: 0, author: { id: auteur, username: `u${auteur.slice(-3)}` }, content: contenu, timestamp: new Date().toISOString(), attachments: [], ...extra };
    if (!etat.messages.has(salonId)) etat.messages.set(salonId, []);
    etat.messages.get(salonId).push(m);
    return m;
  };
  return { fetch, appels, programme, etat, posterUtilisateur, guild, bot };
}

/**
 * Banc des tickets : API avec un faux Discord REST, clé de signature de test, comptes de l'app (Fondateur, un
 * « Support » avec un rôle du club qui porte des permissions des tickets, un compte sans droit). `interaction(corps)`
 * envoie une interaction signée ; `config(corps)` règle les tickets en Fondateur. `modeles` : catégories par défaut
 * semées à la première lecture de la configuration (sinon, réglage `categories_defaut` déjà posé : base vierge).
 */
export async function bancTickets({ banc, attenteDiffere, modeles = false, siteLz, clesPontSite, antiRebondSalons } = {}) {
  const APP = '424242424242424242';
  const hexa = o => Buffer.from(o).toString('hex');
  const paire = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const publique = hexa(await crypto.subtle.exportKey('raw', paire.publicKey));
  const discord = fauxDiscordRest();
  const b = await banc({ fetchDiscord: discord.fetch, lienApp: 'https://app.exemple/esport', discordBot: { applicationId: APP, publicKey: publique, jetonBot: 'jeton-bot-de-test-jamais-reel' }, attenteDiffere: attenteDiffere ?? (() => new Promise(() => {})), ...(siteLz ? { siteLz } : {}), ...(clesPontSite ? { clesPontSite } : {}), ...(antiRebondSalons !== undefined ? { antiRebondSalons } : {}) });
  const fondateur = await b.session('principal', 'Fondateur');
  if (!modeles) await b.base.executer("INSERT INTO tickets_reglages (cle, valeur, maj_le) VALUES ('categories_defaut', '{}', '2026-01-01T00:00:00.000Z')", []);
  const differes = [];
  async function interaction(corps) {
    const horodatage = Math.floor(b.horloge.t / 1000);
    const texte = JSON.stringify({ application_id: APP, token: `jeton-${corps.type}`, id: '1', ...corps });
    const sig = hexa(await crypto.subtle.sign('Ed25519', paire.privateKey, new TextEncoder().encode(`${horodatage}${texte}`)));
    const r = await b.traiter(new Request('https://esport.test/discord/interactions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature-Timestamp': String(horodatage), 'X-Signature-Ed25519': sig }, body: texte }), { attendre: p => differes.push(p) });
    const lu = await r.text();
    await Promise.all(differes.splice(0));
    return { statut: r.status, corps: lu ? JSON.parse(lu) : null };
  }
  /** Compte de l'app avec un rôle du club qui porte `permissions`. */
  async function compteAvec(compte, pseudo, permissions) {
    const jeton = await b.session(compte, pseudo);
    const role = await b.appel('/roles-permissions/globaux', { methode: 'POST', jeton: fondateur, corps: { nom: `Rôle ${pseudo}`, couleur: '#336699', permissions } });
    if (role.statut !== 200) throw new Error(`rôle : ${role.statut} ${JSON.stringify(role.corps)}`);
    const id = role.corps.id ?? role.corps.role?.id ?? role.corps.roles?.find?.(r => r.nom === `Rôle ${pseudo}`)?.id ?? role.corps.globaux?.roles?.find?.(r => r.nom === `Rôle ${pseudo}`)?.id;
    const a = await b.appel(`/roles-permissions/globaux/${id}/comptes`, { methode: 'POST', jeton: fondateur, corps: { compte } });
    if (a.statut !== 200) throw new Error(`attribution : ${a.statut} ${JSON.stringify(a.corps)}`);
    return { jeton, roleId: id };
  }
  const api = (chemin, jeton = fondateur, options = {}) => b.appel(chemin, { jeton, ...options });
  return { b, discord, fondateur, interaction, compteAvec, api, APP, GUILD: discord.guild };
}
