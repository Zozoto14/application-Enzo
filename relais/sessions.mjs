/**
 * Relais version 9 : sessions du Fondateur, style public d'un identifiant, sels « leurres ».
 *
 *  - Session : quand le Fondateur se connecte avec son identifiant et son mot de passe
 *    (`POST /acces/<h>/ouvrir`, preuve juste), le relais lui remet un jeton de SESSION
 *    `s1.<64 hexa>` tiré au hasard. Le relais n'en garde que l'empreinte SHA-256
 *    (`session:<empreinte>` dans la boîte, 180 jours, prolongée à l'usage). Ce jeton vaut le jeton
 *    maître pour les routes du compte, sans l'être : le jeton maître reste un secret du serveur
 *    (et du PC historique), il ne voyage plus jamais vers un navigateur. Il se révoque
 *    (`DELETE /v9/sessions/courante`, ou toutes : `DELETE /v9/sessions`).
 *  - Style : `GET /v9/theme/<h>` (public) rend `{ theme }`, le NOM du thème choisi par ce compte, et
 *    rien d'autre ; un identifiant inconnu rend la même réponse qu'un compte sans thème
 *    (`{ theme: null }`). Débit borné par adresse IP. `PUT /v9/theme/<h>` : le compte lui-même.
 *  - Sel leurre : `GET /acces/<h>` d'un identifiant inconnu rend un sel stable (HMAC du jeton
 *    maître) au lieu d'un 404 : la réponse ne dit pas si l'identifiant existe.
 */

const encodeur = new TextEncoder();
export const PREFIXE_SESSION = 'session:';
export const DUREE_SESSION_S = 180 * 86_400;
const MOTIF_SESSION = /^s1\.[0-9a-f]{64}$/;
const MOTIF_THEME = /^[a-z0-9-]{1,40}$/;

const hexa = octets => [...new Uint8Array(octets)].map(o => o.toString(16).padStart(2, '0')).join('');
export const empreinteSession = async jeton => hexa(await crypto.subtle.digest('SHA-256', encodeur.encode(jeton)));

export async function creerSession(boite, compte, maintenant = Date.now()) {
  const jeton = `s1.${hexa(crypto.getRandomValues(new Uint8Array(32)))}`;
  await boite.put(`${PREFIXE_SESSION}${await empreinteSession(jeton)}`, JSON.stringify({ compte, cree: maintenant, vu: maintenant }), { expirationTtl: DUREE_SESSION_S });
  return jeton;
}

/** Portée d'un jeton de session, ou undefined (inconnu, expiré, révoqué). */
export async function porteeSession(boite, jeton, maintenant = Date.now()) {
  if (!boite || typeof jeton !== 'string' || !MOTIF_SESSION.test(jeton)) return undefined;
  const cle = `${PREFIXE_SESSION}${await empreinteSession(jeton)}`;
  let lu;
  try {
    lu = JSON.parse((await boite.get(cle)) ?? 'null');
  } catch {
    lu = null;
  }
  if (!lu || lu.compte !== 'principal') return undefined;
  // Prolongée à l'usage, au plus une écriture par jour.
  if (!(maintenant - Number(lu.vu) < 86_400_000)) {
    await boite.put(cle, JSON.stringify({ ...lu, vu: maintenant }), { expirationTtl: DUREE_SESSION_S });
  }
  return { maitre: true, session: cle };
}

export const estJetonSession = jeton => typeof jeton === 'string' && MOTIF_SESSION.test(jeton);

/** Sel stable et neutre pour un identifiant inconnu (32 hexa), tiré du jeton maître. */
export async function selLeurre(jetonMaitre, h, usage = 'sel') {
  const cle = await crypto.subtle.importKey('raw', encodeur.encode(String(jetonMaitre)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hexa(await crypto.subtle.sign('HMAC', cle, encodeur.encode(`applibourse-leurre-v9|${usage}|${h}`))).slice(0, 32);
}

const json = (corps, statut = 200, entetes = {}) =>
  new Response(JSON.stringify(corps), {
    status: statut,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...entetes,
    },
  });

/** `DELETE /v9/sessions/courante` (se déconnecter) ou `DELETE /v9/sessions` (toutes, Fondateur). */
export async function routeSessions(requete, env, portee, quoi) {
  if (requete.method !== 'DELETE') return json({ erreur: 'Méthode non autorisée.' }, 405);
  if (!portee?.maitre) return json({ erreur: 'Réservé au Fondateur.' }, 403);
  if (quoi === 'courante') {
    if (portee.session) await env.BOITE.delete(portee.session);
    return json({ ok: true });
  }
  if (typeof env.BOITE.list !== 'function') return json({ erreur: 'Cette boîte ne sait pas se lister.' }, 501);
  let n = 0;
  let curseur;
  do {
    const page = await env.BOITE.list({ prefix: PREFIXE_SESSION, cursor: curseur });
    for (const cle of page.keys ?? []) {
      await env.BOITE.delete(cle.name);
      n++;
    }
    curseur = page.list_complete === false ? page.cursor : undefined;
  } while (curseur);
  return json({ ok: true, fermees: n });
}

// ------------------------------------------------------------ Style public (thème)

const LIMITE_THEME = 240;
const FENETRE_THEME_MS = 15 * 60_000;
const debitsTheme = new Map();

function debitTheme(ip, maintenant) {
  if (debitsTheme.size > 5000) debitsTheme.clear();
  const d = debitsTheme.get(ip);
  if (!d || maintenant - d.debut > FENETRE_THEME_MS) {
    debitsTheme.set(ip, { debut: maintenant, n: 1 });
    return 0;
  }
  d.n++;
  return d.n > LIMITE_THEME ? Math.ceil((d.debut + FENETRE_THEME_MS - maintenant) / 1000) : 0;
}

export async function routeTheme(requete, env, portee, h, ip) {
  if (!/^[0-9a-f]{64}$/.test(h)) return json({ erreur: 'Identifiant invalide.' }, 400);
  const maintenant = Date.now();
  if (requete.method === 'GET') {
    const attente = debitTheme(ip, maintenant);
    if (attente > 0) return json({ erreur: 'Trop de demandes : réessayez plus tard.', motif: 'trop-de-tentatives', attente }, 429, { 'Retry-After': String(attente) });
    const acces = await env.BOITE.get(`acces:${h}`);
    const theme = acces ? await env.BOITE.get(`theme:${h}`) : null;
    // Identifiant inconnu et compte sans thème : même réponse.
    return json({ theme: theme && MOTIF_THEME.test(theme) ? theme : null });
  }
  if (requete.method === 'PUT') {
    if (!portee) return json({ erreur: 'Jeton du relais manquant ou incorrect.' }, 401);
    let depot;
    try {
      depot = JSON.parse((await env.BOITE.get(`acces:${h}`)) ?? 'null');
    } catch {
      depot = null;
    }
    if (!depot || (!portee.maitre && portee.profil !== depot.compte)) return json({ erreur: 'Cet identifiant n’est pas le vôtre.' }, 403);
    let corps;
    try {
      corps = await requete.json();
    } catch {
      corps = undefined;
    }
    if (corps?.theme === null) {
      await env.BOITE.delete(`theme:${h}`);
      return json({ ok: true });
    }
    if (typeof corps?.theme !== 'string' || !MOTIF_THEME.test(corps.theme)) return json({ erreur: 'Thème invalide.' }, 400);
    await env.BOITE.put(`theme:${h}`, corps.theme);
    return json({ ok: true });
  }
  return json({ erreur: 'Méthode non autorisée.' }, 405);
}
