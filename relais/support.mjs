/**
 * Support du relais (version 2) : demandes d'assistance rangées sur le relais, annoncées sur Discord.
 *
 * Pourquoi sur le relais (et pas sur le serveur Esport) : TOUS les comptes du hub ont un jeton du
 * relais (maître pour le Fondateur, jeton de profil `p1.<id>.<hmac>` pour chaque ami), alors que
 * seuls les membres de l'Esport ont une session Esport. Le relais a déjà sa boîte (KV sur
 * Cloudflare, table `relais_kv` dans PostgreSQL chez o2switch). Chaque demande est rangée sous
 * l'identifiant du compte VÉRIFIÉ par le jeton (`support:t:<compte>:<id>`) : un compte ne lit, ne
 * complète et ne marque lues que SES demandes (404 sinon, même réponse qu'une demande inexistante) ;
 * seul le jeton maître (le Fondateur) les liste toutes et y répond.
 *
 * Routes (jeton obligatoire) :
 *   POST /support                          créer une demande (catégorie, titre, message riche,
 *                                           capture facultative, infos techniques en liste fermée)
 *   GET  /support/tickets                  mes demandes (le Fondateur : `?tous=1` pour toutes)
 *   POST /support/tickets/<id>/messages    répondre (Fondateur) ou compléter (auteur de la demande)
 *   POST /support/tickets/<id>/lu          l'auteur a vu les réponses (notification effacée)
 *   POST /support/tickets/<id>/statut      Fondateur : ouvert, en cours, répondu, résolu
 *   POST /support/tickets/<id>/discord     Fondateur : renvoyer l'annonce sur Discord (après une panne)
 *   GET  /support/etat                     Fondateur : diagnostic (webhook présent ? dernier envoi ?)
 *
 * Discord : l'adresse du webhook est un secret (`DISCORD_WEBHOOK_URL`, jamais renvoyée ni journalisée).
 *  - salon FORUM (recommandé) : chaque demande ouvre son propre fil (`thread_name`), les réponses
 *    vont dans ce fil (`thread_id`) ;
 *  - salon TEXTE : la demande est un message ; si `DISCORD_BOT_TOKEN` est configuré sur le relais, la
 *    première réponse ouvre un fil sur ce message (le bot), sinon les réponses sont postées dans le
 *    salon, avec le numéro de la demande.
 * Le mode est détecté tout seul (codes d'erreur 220001 / 220003 de Discord) et retenu.
 * Mentions : textes nettoyés (`@everyone`, `<@id>`… neutralisés) ET `allowed_mentions: { parse: [] }`.
 * Une panne de Discord ne perd rien : la demande est rangée d'abord, l'annonce peut être renvoyée.
 */

const CATEGORIES = {
  bug: { fr: 'Bug', en: 'Bug', couleur: 0xe5484d, emoji: '🐞' },
  idee: { fr: 'Idée', en: 'Idea', couleur: 0xf5a524, emoji: '💡' },
  question: { fr: 'Question', en: 'Question', couleur: 0x3b82f6, emoji: '❓' },
  compte: { fr: 'Compte', en: 'Account', couleur: 0x8b5cf6, emoji: '👤' },
};
/** Anciennes catégories (applications pas encore mises à jour). */
const ALIAS_CATEGORIES = { demande: 'idee', autre: 'question' };
export const STATUTS_SUPPORT = ['ouvert', 'en_cours', 'repondu', 'resolu'];
const LIBELLES_STATUT = { ouvert: 'Ouvert', en_cours: 'En cours', repondu: 'Répondu', resolu: 'Résolu' };
const COULEUR_REPONSE = 0x22a06b;
const COULEUR_COMPLEMENT = 0x64748b;

export const TITRE_MAX = 100;
export const MESSAGE_MAX = 4000;
const TAILLE_MAX_CORPS = 6 * 1024 * 1024;
export const TAILLE_MAX_PIECE = 4 * 1024 * 1024;
const MESSAGES_MAX = 60;
const DEMANDES_GARDEES_PAR_COMPTE = 100;
const DEMANDES_INDEX_GLOBAL = 1000;
/** Demandes par heure et par compte ; compléments par heure ; réponses du Fondateur par heure. */
export const LIMITE_DEMANDES = 5;
const LIMITE_COMPLEMENTS = 20;
const LIMITE_REPONSES = 120;
const FENETRE_MS = 3_600_000;
/** Capture gardée tant qu'elle n'est pas arrivée sur Discord (renvoi après une panne), 7 jours au plus. */
const DUREE_PIECE_S = 7 * 86_400;

export const MOTIF_WEBHOOK = /^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api\/webhooks\/\d{5,25}\/[A-Za-z0-9_-]{10,200}$/;
const MOTIF_ID = /^[0-9a-f]{16}$/;
const TYPES_PIECE = {
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/gif': [0x47, 0x49, 0x46, 0x38],
  'image/webp': [0x52, 0x49, 0x46, 0x46],
};
const EXTENSIONS_PIECE = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
/** Infos techniques : liste fermée (un secret glissé dans un autre champ n'est jamais gardé). */
const CHAMPS_TECHNIQUES = [
  ['version', 40],
  ['plateforme', 40],
  ['appareil', 60],
  ['app', 40],
  ['langue', 5],
  ['rang', 30],
];
const limitesMemoire = new Map();

// ------------------------------------------------------------------ Textes

/** Texte destiné à Discord : sans caractères de contrôle, mentions neutralisées, tronqué. */
export function nettoyerTexteDiscord(valeur, max) {
  let texte = String(valeur ?? '')
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g, '')
    .replace(/\r\n?/g, '\n')
    // @everyone, @here, <@id>, <@&role>, <#salon> : rendus inoffensifs (en plus de allowed_mentions).
    .replace(/@(everyone|here)/gi, '@​$1')
    .replace(/<(@[!&]?|#)(\d+)>/g, '<​$1$2>');
  if (texte.length > max) texte = `${texte.slice(0, max - 1)}…`;
  return texte;
}

/** Markdown limité de l'app → Markdown de Discord : couleurs {{x|…}} retirées, ==surlignage== en souligné. */
export function versMarkdownDiscord(texte) {
  return String(texte ?? '')
    .replace(/\{\{[a-z]+\|([^}]*)\}\}/g, '$1')
    .replace(/==([^=\n]+)==/g, '__$1__')
    .replace(/^(\s*)- \[( |x)\] /gim, (_, e, c) => `${e}${c.toLowerCase() === 'x' ? '☑' : '☐'} `);
}

const uneLigne = t => t.replace(/\s*\n+\s*/g, ' ').trim();

function versOctets(base64) {
  try {
    const binaire = atob(base64);
    const octets = new Uint8Array(binaire.length);
    for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
    return octets;
  } catch {
    return undefined;
  }
}

function hexa(octets) {
  return [...octets].map(o => o.toString(16).padStart(2, '0')).join('');
}

const nouvelId = () => hexa(crypto.getRandomValues(new Uint8Array(8)));

// ------------------------------------------------------------------ Validation

/** Demande reçue, validée ; `{ refus: { motif, statut } }` sinon. Accepte l'ancien format (`sujet`). */
export function validerTicket(corps) {
  const refus = (motif, statut = 400) => ({ refus: { motif, statut } });
  if (!corps || typeof corps !== 'object' || Array.isArray(corps)) return refus('Demande illisible.');
  const categorie = ALIAS_CATEGORIES[corps.categorie] ?? corps.categorie;
  if (!Object.hasOwn(CATEGORIES, categorie ?? '')) return refus('Catégorie inconnue.');
  const brut = typeof corps.titre === 'string' ? corps.titre : typeof corps.sujet === 'string' ? corps.sujet : '';
  const titre = uneLigne(nettoyerTexteDiscord(brut, TITRE_MAX));
  const message = nettoyerTexteDiscord(typeof corps.message === 'string' ? corps.message : '', MESSAGE_MAX).trim();
  if (titre.length < 3) return refus('Le titre est trop court (3 caractères au moins).');
  if (message.length < 10) return refus('Le message est trop court (10 caractères au moins).');
  const numero = Number.isInteger(corps.numero) && corps.numero > 0 && corps.numero < 1_000_000 ? corps.numero : undefined;
  const auteur = typeof corps.auteur === 'string' ? uneLigne(nettoyerTexteDiscord(corps.auteur, 40)) : '';

  let technique;
  if (corps.technique !== undefined && corps.technique !== null) {
    const t = corps.technique;
    if (typeof t !== 'object' || Array.isArray(t)) return refus('Informations techniques invalides.');
    technique = {};
    for (const [cle, max] of CHAMPS_TECHNIQUES) {
      if (typeof t[cle] === 'string' && t[cle].trim()) technique[cle] = uneLigne(nettoyerTexteDiscord(t[cle], max));
    }
  }

  let piece;
  if (corps.piece !== undefined && corps.piece !== null) {
    const p = corps.piece;
    if (typeof p !== 'object' || typeof p.donnees !== 'string' || !Object.hasOwn(TYPES_PIECE, p.type ?? '')) {
      return refus('Pièce jointe refusée : une image PNG, JPEG, GIF ou WebP est attendue.');
    }
    if (p.donnees.length > Math.ceil((TAILLE_MAX_PIECE * 4) / 3) + 8) return refus('Pièce jointe trop volumineuse (4 Mo au plus).', 413);
    const octets = versOctets(p.donnees);
    if (!octets || octets.length === 0 || octets.length > TAILLE_MAX_PIECE) return refus('Pièce jointe illisible ou trop volumineuse (4 Mo au plus).');
    if (!TYPES_PIECE[p.type].every((v, i) => octets[i] === v)) return refus('Le contenu de la pièce jointe ne correspond pas à son type.');
    const base = String(p.nom ?? 'capture').replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'capture';
    piece = { octets, donnees: p.donnees, type: p.type, nom: `${base}.${EXTENSIONS_PIECE[p.type]}` };
  }
  const langue = corps.langue === 'en' ? 'en' : 'fr';
  return { ticket: { categorie, titre, message, numero, auteur, technique, piece, langue } };
}

// ------------------------------------------------------------------ Boîte

async function lireJson(env, cle, defaut) {
  try {
    const brut = await env.BOITE.get(cle);
    return brut ? JSON.parse(brut) : defaut;
  } catch {
    return defaut;
  }
}
const ecrireJson = (env, cle, valeur, options) => env.BOITE.put(cle, JSON.stringify(valeur), options);
const cleTicket = (compte, id) => `support:t:${compte}:${id}`;

async function lireTicket(env, id) {
  if (!MOTIF_ID.test(id ?? '')) return undefined;
  const compte = await env.BOITE.get(`support:id:${id}`);
  if (!compte) return undefined;
  const t = await lireJson(env, cleTicket(compte, id));
  return t && typeof t === 'object' ? t : undefined;
}

async function enregistrerTicket(env, t) {
  t.maj = new Date().toISOString();
  await ecrireJson(env, cleTicket(t.compte, t.id), t, { metadata: { date: t.maj, statut: t.statut } });
}

/** Limite de débit glissante (boîte si présente, sinon mémoire de l'instance). */
export async function limiter(env, cle, max, fenetre = FENETRE_MS, maintenant = Date.now()) {
  let dates = [];
  if (env.BOITE) {
    const lu = await lireJson(env, cle, []);
    if (Array.isArray(lu)) dates = lu.filter(d => Number.isFinite(d));
  } else {
    dates = limitesMemoire.get(cle) ?? [];
  }
  dates = dates.filter(d => maintenant - d < fenetre);
  if (dates.length >= max) return { ok: false, attenteS: Math.max(1, Math.ceil((dates[0] + fenetre - maintenant) / 1000)) };
  return {
    ok: true,
    enregistrer: async (n = 1) => {
      const suivantes = [...dates, ...Array.from({ length: n }, () => maintenant)];
      if (env.BOITE) await ecrireJson(env, cle, suivantes, { expirationTtl: Math.ceil(fenetre / 1000) + 100 });
      else limitesMemoire.set(cle, suivantes);
    },
  };
}

// ------------------------------------------------------------------ Discord

/** État du webhook, sans jamais le révéler. */
export function etatWebhook(env) {
  const w = typeof env.DISCORD_WEBHOOK_URL === 'string' ? env.DISCORD_WEBHOOK_URL.trim() : '';
  if (!w) return 'absent';
  return MOTIF_WEBHOOK.test(w) ? 'ok' : 'invalide';
}

async function noterDiagnostic(env, resultat) {
  try {
    await ecrireJson(env, 'support:diag', { date: new Date().toISOString(), ok: resultat.ok, statut: resultat.statut ?? null, code: resultat.code ?? null });
  } catch {
    // Diagnostic seulement.
  }
}

/**
 * Poste sur le webhook (`?wait=true` : Discord rend le message, donc l'identifiant du fil d'un forum).
 * Rend `{ ok, statut, code?, message? }` ; jamais l'adresse ni le corps d'une erreur.
 */
async function posterWebhook(env, charge, { piece, fil } = {}) {
  const base = env.DISCORD_WEBHOOK_URL.trim();
  const url = `${base}?wait=true${fil ? `&thread_id=${fil}` : ''}`;
  let envoi;
  if (piece) {
    const formulaire = new FormData();
    formulaire.append('payload_json', JSON.stringify({ ...charge, attachments: [{ id: 0, filename: piece.nom }] }));
    formulaire.append('files[0]', new Blob([piece.octets], { type: piece.type }), piece.nom);
    envoi = { method: 'POST', body: formulaire };
  } else {
    envoi = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(charge) };
  }
  let r;
  try {
    r = await fetch(url, envoi);
  } catch {
    return { ok: false, statut: 0 };
  }
  let lu;
  try {
    lu = await r.json();
  } catch {
    lu = undefined;
  }
  if (!r.ok) return { ok: false, statut: r.status, code: Number.isInteger(lu?.code) ? lu.code : undefined };
  return { ok: true, statut: r.status, message: lu && typeof lu.id === 'string' ? { id: lu.id, salon: typeof lu.channel_id === 'string' ? lu.channel_id : undefined } : undefined };
}

const FORUM_SANS_NOM = 220001;
const FIL_HORS_FORUM = 220003;

/**
 * Annonce d'une demande : un fil par demande dans un forum, un message dans un salon texte.
 * Mode retenu dans `support:mode` après la première réponse claire de Discord.
 */
async function annoncerDemande(env, charge, nomFil, piece) {
  const mode = await env.BOITE.get('support:mode');
  const essais = mode === 'texte' ? [false, true] : [true, false];
  let dernier;
  for (const avecFil of essais) {
    const r = await posterWebhook(env, avecFil ? { ...charge, thread_name: nomFil } : charge, { piece });
    dernier = r;
    if (r.ok) {
      const suivant = avecFil ? 'forum' : 'texte';
      if (mode !== suivant) await env.BOITE.put('support:mode', suivant);
      return { ...r, mode: suivant };
    }
    // Seule une erreur « forum / pas forum » mérite l'autre essai.
    const autre = r.statut === 400 && (r.code === FIL_HORS_FORUM || r.code === FORUM_SANS_NOM || (avecFil && r.code === undefined));
    if (!autre) break;
  }
  return dernier;
}

/** Salon texte + bot du relais : ouvre un fil sur le message de la demande (rend son identifiant). */
async function ouvrirFilParBot(env, t) {
  const jeton = typeof env.DISCORD_BOT_TOKEN === 'string' ? env.DISCORD_BOT_TOKEN.trim() : '';
  if (!jeton || !t.discord?.message || !t.discord?.salon) return undefined;
  try {
    const r = await fetch(`https://discord.com/api/v10/channels/${t.discord.salon}/messages/${t.discord.message}/threads`, {
      method: 'POST',
      headers: { Authorization: `Bot ${jeton}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nomDuFil(t), auto_archive_duration: 10080 }),
    });
    if (!r.ok) return undefined;
    const lu = await r.json();
    return typeof lu?.id === 'string' ? lu.id : undefined;
  } catch {
    return undefined;
  }
}

function nomDuFil(t) {
  const c = CATEGORIES[t.categorie];
  return nettoyerTexteDiscord(`#${t.numero} · ${c.emoji} ${c.fr} · ${t.titre}`, 100);
}

const lienAdministration = env => `${String(env.LIEN_APP || 'https://appdashboard.fr').trim().replace(/\/+$/, '')}/#/app/administration`;

/** Message Discord d'une demande : embed coloré par catégorie, auteur, app, version, appareil, lien. */
export function chargeDemande(t, env = {}) {
  const c = CATEGORIES[t.categorie];
  const champs = [];
  const tech = t.technique ?? {};
  const ajouter = (nom, valeur) => valeur && champs.push({ name: nom, value: nettoyerTexteDiscord(valeur, 100), inline: true });
  ajouter('Catégorie', `${c.emoji} ${c.fr}`);
  ajouter('App', tech.app);
  ajouter('Version', tech.version);
  ajouter('Appareil', [tech.appareil, tech.plateforme].filter(Boolean).join(' · '));
  ajouter('Rang', tech.rang);
  ajouter('Langue', tech.langue ? tech.langue.toUpperCase() : '');
  ajouter('Demande', `#${t.numero} · \`${t.id}\``);
  const embed = {
    author: { name: nettoyerTexteDiscord(`${t.auteur || 'Utilisateur'} · compte ${t.compte === 'principal' ? 'Fondateur' : t.compte.slice(0, 6)}`, 256) },
    title: nettoyerTexteDiscord(`${c.emoji} ${c.fr} · ${t.titre}`, 256),
    url: lienAdministration(env),
    description: nettoyerTexteDiscord(versMarkdownDiscord(t.message), MESSAGE_MAX),
    color: c.couleur,
    fields: champs,
    footer: { text: 'AppDashboard · Support · répondre depuis Administration › Support' },
    timestamp: t.cree,
    ...(t.pieceNom ? { image: { url: `attachment://${t.pieceNom}` } } : {}),
  };
  // Aucune mention ne notifie qui que ce soit, quoi que contienne la demande.
  return { username: 'AppDashboard Support', allowed_mentions: { parse: [] }, embeds: [embed] };
}

function chargeMessage(t, m, env) {
  const equipe = m.de === 'equipe';
  return {
    username: 'AppDashboard Support',
    allowed_mentions: { parse: [] },
    embeds: [
      {
        author: { name: equipe ? 'Réponse du Fondateur' : nettoyerTexteDiscord(`${t.auteur || 'Utilisateur'} a complété sa demande`, 256) },
        title: nettoyerTexteDiscord(`#${t.numero} · ${t.titre}`, 256),
        url: lienAdministration(env),
        description: nettoyerTexteDiscord(versMarkdownDiscord(m.texte), MESSAGE_MAX),
        color: equipe ? COULEUR_REPONSE : COULEUR_COMPLEMENT,
        footer: { text: `Statut : ${LIBELLES_STATUT[t.statut] ?? t.statut}` },
        timestamp: m.date,
      },
    ],
  };
}

/** Annonce (ou renvoie) une demande sur Discord ; met à jour `t.discord`. */
async function publierDemande(env, t, piece) {
  const etat = etatWebhook(env);
  if (etat !== 'ok') {
    t.discord = { etat: 'non-configure' };
    return false;
  }
  const r = await annoncerDemande(env, chargeDemande(t, env), nomDuFil(t), piece);
  await noterDiagnostic(env, r);
  if (!r.ok) {
    t.discord = { etat: 'echec', statut: r.statut, ...(r.code ? { code: r.code } : {}) };
    return false;
  }
  t.discord = {
    etat: 'envoye',
    mode: r.mode,
    ...(r.message?.id ? { message: r.message.id } : {}),
    ...(r.message?.salon ? { salon: r.message.salon } : {}),
    ...(r.mode === 'forum' && r.message?.salon ? { fil: r.message.salon } : {}),
  };
  return true;
}

/** Reporte un message (réponse ou complément) dans le fil de la demande, sinon dans le salon. */
async function publierMessage(env, t, m) {
  if (etatWebhook(env) !== 'ok' || t.discord?.etat !== 'envoye') return false;
  if (!t.discord.fil && t.discord.mode === 'texte') {
    const fil = await ouvrirFilParBot(env, t);
    if (fil) t.discord.fil = fil;
  }
  const r = await posterWebhook(env, chargeMessage(t, m, env), { fil: t.discord.fil });
  await noterDiagnostic(env, r);
  return r.ok;
}

// ------------------------------------------------------------------ Vue

/** Ce que rend l'API : jamais la capture, jamais l'identifiant Discord du salon. */
function vue(t, pourFondateur) {
  const nonLus = t.messages.filter(m => m.de === 'equipe' && (!t.vuLe || m.date > t.vuLe)).length;
  return {
    id: t.id,
    numero: t.numero,
    ...(pourFondateur ? { compte: t.compte, auteur: t.auteur } : {}),
    categorie: t.categorie,
    titre: t.titre,
    message: t.message,
    statut: t.statut,
    cree: t.cree,
    maj: t.maj,
    technique: t.technique ?? null,
    pieceNom: t.pieceNom ?? null,
    messages: t.messages.map(m => ({ id: m.id, de: m.de, texte: m.texte, date: m.date, ...(pourFondateur && m.discord !== undefined ? { discord: m.discord } : {}) })),
    nonLus,
    discord: t.discord?.etat ?? 'non-configure',
    ...(pourFondateur ? { discordFil: Boolean(t.discord?.fil), notifie: t.notifie ?? null } : {}),
  };
}

// ------------------------------------------------------------------ Routes

async function lireCorps(requete, max = TAILLE_MAX_CORPS) {
  const longueur = Number(requete.headers.get('Content-Length') ?? 0);
  if (longueur > max) return { trop: true };
  const texte = await requete.text();
  if (texte.length > max) return { trop: true };
  try {
    return { corps: JSON.parse(texte) };
  } catch {
    return { corps: undefined };
  }
}

async function ajouterIndex(env, cle, entree, max) {
  const liste = await lireJson(env, cle, []);
  const propre = Array.isArray(liste) ? liste.filter(x => x !== entree && x?.id !== entree?.id) : [];
  const suite = [entree, ...propre].slice(0, max);
  await ecrireJson(env, cle, suite);
  return [entree, ...propre].slice(max);
}

async function creer(requete, env, portee, o) {
  const { trop, corps } = await lireCorps(requete);
  if (trop) return o.erreur('Demande trop volumineuse.', 413);
  if (corps === undefined) return o.erreur('Demande illisible.', 400);
  const { refus, ticket } = validerTicket(corps);
  if (refus) return o.erreur(refus.motif, refus.statut);
  const compte = portee.maitre ? 'principal' : portee.profil;
  const limite = await limiter(env, `support:limite:${portee.maitre ? 'maitre' : compte}`, LIMITE_DEMANDES);
  if (!limite.ok) {
    const r = o.erreur(`Trop de demandes : ${LIMITE_DEMANDES} par heure au plus. Réessayez dans ${Math.ceil(limite.attenteS / 60)} min.`, 429);
    r.headers.set('Retry-After', String(limite.attenteS));
    return r;
  }
  const numero = Number((await env.BOITE.get('support:compteur')) ?? 0) + 1;
  await env.BOITE.put('support:compteur', String(numero));
  const id = nouvelId();
  const maintenant = new Date().toISOString();
  const t = {
    v: 2,
    id,
    numero,
    compte,
    auteur: ticket.auteur,
    categorie: ticket.categorie,
    titre: ticket.titre,
    message: ticket.message,
    langue: ticket.langue,
    ...(ticket.technique ? { technique: ticket.technique } : {}),
    ...(ticket.piece ? { pieceNom: ticket.piece.nom } : {}),
    ...(ticket.numero ? { numeroLocal: ticket.numero } : {}),
    statut: 'ouvert',
    cree: maintenant,
    messages: [],
  };
  await env.BOITE.put(`support:id:${id}`, compte);
  // Rangée D'ABORD : une panne de Discord ne perd jamais une demande.
  const envoye = await publierDemande(env, t, ticket.piece);
  if (!envoye && ticket.piece) {
    await ecrireJson(env, `support:piece:${id}`, { nom: ticket.piece.nom, type: ticket.piece.type, donnees: ticket.piece.donnees }, { expirationTtl: DUREE_PIECE_S });
  }
  await enregistrerTicket(env, t);
  const sortis = await ajouterIndex(env, `support:idx:${compte}`, id, DEMANDES_GARDEES_PAR_COMPTE);
  // Au-delà des 100 demandes gardées par compte, les plus anciennes sont effacées.
  for (const ancien of sortis) {
    await env.BOITE.delete(cleTicket(compte, ancien));
    await env.BOITE.delete(`support:id:${ancien}`);
  }
  await ajouterIndex(env, 'support:idx', { compte, id }, DEMANDES_INDEX_GLOBAL);
  await limite.enregistrer();
  return o.reponse({
    ok: true,
    numero: ticket.numero ?? numero,
    ticket: vue(t, portee.maitre),
    discord: envoye,
    ...(envoye ? {} : { avertissement: t.discord?.etat === 'non-configure' ? 'Demande enregistrée ; le salon Discord du support n’est pas configuré sur le relais.' : 'Demande enregistrée ; Discord n’a pas pu être prévenu (nouvel essai possible).' }),
  });
}

async function lister(requete, env, portee, o) {
  const tous = portee.maitre && new URL(requete.url).searchParams.get('tous') === '1';
  const ids = tous ? await lireJson(env, 'support:idx', []) : (await lireJson(env, `support:idx:${portee.maitre ? 'principal' : portee.profil}`, [])).map(id => ({ compte: portee.maitre ? 'principal' : portee.profil, id }));
  const tickets = [];
  for (const e of Array.isArray(ids) ? ids : []) {
    if (!e || !MOTIF_ID.test(e.id ?? '')) continue;
    const t = await lireJson(env, cleTicket(e.compte, e.id));
    if (t && typeof t === 'object') tickets.push(vue(t, portee.maitre));
  }
  return o.reponse({ tickets, ...(tous ? { discord: etatWebhook(env), mode: (await env.BOITE.get('support:mode')) ?? null } : {}) });
}

async function ajouterMessage(requete, env, portee, t, o) {
  // Le Fondateur (jeton maître) répond ; l'auteur complète sa demande.
  const equipe = Boolean(portee.maitre);
  const { trop, corps } = await lireCorps(requete, 64 * 1024);
  if (trop) return o.erreur('Message trop long.', 413);
  const texte = nettoyerTexteDiscord(typeof corps?.texte === 'string' ? corps.texte : '', MESSAGE_MAX).trim();
  if (texte.length < 2) return o.erreur('Le message est vide.', 400);
  const limite = await limiter(env, `support:limite-msg:${portee.maitre ? 'maitre' : portee.profil}`, equipe ? LIMITE_REPONSES : LIMITE_COMPLEMENTS);
  if (!limite.ok) {
    const r = o.erreur('Trop de messages en peu de temps : réessayez plus tard.', 429);
    r.headers.set('Retry-After', String(limite.attenteS));
    return r;
  }
  const m = { id: nouvelId(), de: equipe ? 'equipe' : 'utilisateur', texte, date: new Date().toISOString() };
  t.messages = [...t.messages, m].slice(-MESSAGES_MAX);
  if (equipe) t.statut = STATUTS_SUPPORT.includes(corps?.statut) ? corps.statut : 'repondu';
  else if (t.statut === 'repondu' || t.statut === 'resolu') t.statut = 'ouvert';
  m.discord = await publierMessage(env, t, m);
  // Réponse du Fondateur : e-mail à l'auteur si l'app a joint son adresse (jamais gardée ici, seulement masquée au journal).
  let courriel;
  if (equipe && corps?.courriel && typeof env.ENVOYER_COURRIEL === 'function' && o.envoyerCourriel) {
    // Langue de l'e-mail : celle du compte de l'auteur si l'app la donne (langue par défaut réglée par le Fondateur), sinon celle de la demande.
    const langueMail = corps.courriel.langue === 'en' || corps.courriel.langue === 'fr' ? corps.courriel.langue : t.langue === 'en' ? 'en' : 'fr';
    courriel = await o.envoyerCourriel(env, {
      destinataires: [{ adresse: corps.courriel.adresse, nom: t.auteur, langue: langueMail }],
      modele: 'support',
      langue: langueMail,
      variables: { numero: t.numero, titre: t.titre, reponse: texte, prenom: t.auteur },
      ref: `support:${t.id}`,
    });
    t.notifie = { date: m.date, courriel: courriel.ok ? 'envoye' : 'echec' };
  } else if (equipe) {
    t.notifie = { date: m.date, courriel: null };
  }
  await enregistrerTicket(env, t);
  await limite.enregistrer();
  return o.reponse({ ok: true, ticket: vue(t, portee.maitre), discord: m.discord, ...(courriel ? { courriel: { ok: courriel.ok, ...(courriel.erreur ? { erreur: courriel.erreur } : {}) } } : {}) });
}

/** `/support…` (jeton déjà vérifié par le relais). `o` : `{ reponse, erreur, envoyerCourriel? }`. */
export async function routeSupport(requete, env, portee, chemin, o) {
  if (!env.BOITE) return o.erreur('Boîte non configurée sur le relais.', 500);
  const m = requete.method;
  if (chemin === '/support' || chemin === '/support/') {
    if (m !== 'POST') return o.erreur('Méthode non autorisée.', 405);
    return creer(requete, env, portee, o);
  }
  if (chemin === '/support/tickets') {
    if (m !== 'GET') return o.erreur('Méthode non autorisée.', 405);
    return lister(requete, env, portee, o);
  }
  if (chemin === '/support/etat') {
    if (!portee.maitre) return o.erreur('Réservé au Fondateur.', 403);
    return o.reponse({
      webhook: etatWebhook(env),
      mode: (await env.BOITE.get('support:mode')) ?? null,
      bot: Boolean(typeof env.DISCORD_BOT_TOKEN === 'string' && env.DISCORD_BOT_TOKEN.trim()),
      dernierEnvoi: await lireJson(env, 'support:diag', null),
      courriel: typeof env.ENVOYER_COURRIEL === 'function',
    });
  }
  const route = /^\/support\/tickets\/([^/]+)\/(messages|lu|statut|discord)$/.exec(chemin);
  if (!route || m !== 'POST') return o.erreur('Adresse inconnue.', 404);
  const t = await lireTicket(env, route[1]);
  // Une demande d'un autre compte répond comme une demande inexistante : rien n'en sort.
  if (!t || (!portee.maitre && t.compte !== portee.profil)) return o.erreur('Demande introuvable.', 404);
  t.messages = Array.isArray(t.messages) ? t.messages : [];
  const action = route[2];
  if (action === 'messages') return ajouterMessage(requete, env, portee, t, o);
  if (action === 'lu') {
    if (portee.maitre && t.compte !== 'principal') return o.reponse({ ok: true, ticket: vue(t, true) });
    t.vuLe = new Date().toISOString();
    await enregistrerTicket(env, t);
    return o.reponse({ ok: true, ticket: vue(t, portee.maitre) });
  }
  if (!portee.maitre) return o.erreur('Réservé au Fondateur.', 403);
  if (action === 'statut') {
    const { corps } = await lireCorps(requete, 4096);
    if (!STATUTS_SUPPORT.includes(corps?.statut)) return o.erreur('Statut inconnu.', 400);
    t.statut = corps.statut;
    await enregistrerTicket(env, t);
    return o.reponse({ ok: true, ticket: vue(t, true) });
  }
  // action === 'discord' : renvoi de l'annonce après une panne (avec la capture si elle est encore gardée).
  if (t.discord?.etat === 'envoye') return o.reponse({ ok: true, discord: true, ticket: vue(t, true) });
  const p = await lireJson(env, `support:piece:${t.id}`, null);
  const piece = p && typeof p.donnees === 'string' ? { nom: p.nom, type: p.type, octets: versOctets(p.donnees) } : undefined;
  const envoye = await publierDemande(env, t, piece?.octets ? piece : undefined);
  if (envoye) await env.BOITE.delete(`support:piece:${t.id}`);
  await enregistrerTicket(env, t);
  return o.reponse({ ok: envoye, discord: envoye, ticket: vue(t, true) }, envoye ? 200 : 502);
}
