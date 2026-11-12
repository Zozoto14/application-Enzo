/**
 * Avis du site LigneZero (« synchronisation poussée », docs/esport/evenements.md) : POST /site-lz/evenement.
 *
 * Le site prévient l'AppDashboard dès qu'un match, un lobby, une phase, un résultat, un horaire ou le staff assigné
 * change (déclencheurs de sa base, file d'envoi avec réessais, api/serveur/pousse.mjs du dépôt site-ligne-zero). L'avis
 * ne porte AUCUNE donnée du site : l'identifiant du tournoi et ceux des matchs et lobbies changés (`tout` : tout le
 * tournoi, pour une phase ou une équipe). L'AppDashboard relit alors ces matchs par le pont signé habituel (lecture
 * seule) et les traite en quelques secondes (anti-rebond 2,5 s, evenements-club/salons-match.mjs).
 *
 * Sécurité : même secret que le pont (CLE_PONT de ~/.lignezero/api.env, jamais transmis), même calcul de signature
 * dans l'autre sens : HMAC-SHA256 de « LZ1, POST, /site-lz/evenement, horodatage, nonce, empreinte SHA-256 du corps »
 * (le chemin signé diffère de celui des requêtes du pont : une signature ne vaut que pour son sens). Fenêtre de 5
 * minutes, nonce à usage unique (table site_lz_nonces), comparaison en temps constant sur chaque clé acceptée
 * (CLE_PONT, et CLE_PONT_ANCIENNE pendant une rotation). Corps de 16 Ko au plus, débit borné par adresse.
 * Avis signé mais inconnu (autre version du site, tournoi non lié, salons de match désactivés) : accepté et ignoré.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { echec, iso } from '../outils.mjs';

export const CHEMIN_POUSSEE = '/site-lz/evenement';
export const FENETRE_POUSSEE_MS = 5 * 60_000;
export const TAILLE_MAX_POUSSEE = 16 * 1024;
const NONCE = /^[A-Za-z0-9_-]{16,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IDS = 500;
const MOTIFS = Object.freeze({ entetes: 'en-têtes', horloge: 'horloge', signature: 'signature', rejeu: 'rejeu' });

/** Signature d'un avis (le site fait le même calcul : api/serveur/cles.mjs, `signer`). */
export function signerPoussee(cle, { horodatage, nonce, corps, chemin = CHEMIN_POUSSEE, methode = 'POST' }) {
  const empreinte = createHash('sha256').update(corps ?? '').digest('hex');
  return createHmac('sha256', cle).update(`LZ1\n${methode}\n${chemin}\n${horodatage}\n${nonce}\n${empreinte}`).digest('base64url');
}

const egal = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Vérifie un avis. `cles` : clés acceptées ; `nonceNeuf(nonce, expire)` rend false si le nonce a déjà servi. Lève 401
 * (motif : en-têtes, horloge, signature, rejeu) ou 503 (pont non configuré).
 */
export async function verifierPoussee({ cles, entetes, corps, maintenant, nonceNeuf }) {
  const refuser = motif => echec(401, 'poussee-refusee', `Avis du site refusé (${motif}).`);
  if (!cles.length) throw echec(503, 'site-non-configure', 'Clé du pont absente sur cet hébergement.');
  const horodatage = String(entetes.get('x-lz-horodatage') ?? '');
  const nonce = String(entetes.get('x-lz-nonce') ?? '');
  const signature = String(entetes.get('x-lz-signature') ?? '');
  if (!/^\d{10,16}$/.test(horodatage) || !NONCE.test(nonce) || !signature) throw refuser(MOTIFS.entetes);
  if (Math.abs(maintenant - Number(horodatage)) > FENETRE_POUSSEE_MS) throw refuser(MOTIFS.horloge);
  let ok = false;
  for (const c of cles) ok = egal(signature, signerPoussee(c, { horodatage, nonce, corps })) || ok;
  if (!ok) throw refuser(MOTIFS.signature);
  if (!(await nonceNeuf(nonce, Number(horodatage) + FENETRE_POUSSEE_MS))) throw refuser(MOTIFS.rejeu);
}

/** Lit le contenu d'un avis : `{ tournoi, matchs, lobbies, tout }`, ou null s'il n'est pas reconnu (ignoré). */
export function lireAvis(texte) {
  let x;
  try {
    x = JSON.parse(texte);
  } catch {
    return null;
  }
  if (!x || typeof x !== 'object' || !UUID.test(String(x.tournoi ?? ''))) return null;
  const ids = v => (Array.isArray(v) ? [...new Set(v.filter(i => typeof i === 'string' && UUID.test(i)))] : []);
  const matchs = ids(x.matchs);
  const lobbies = ids(x.lobbies);
  const tout = x.tout === true || matchs.length + lobbies.length > MAX_IDS || (!matchs.length && !lobbies.length);
  return { tournoi: String(x.tournoi), matchs: tout ? [] : matchs, lobbies: tout ? [] : lobbies, tout };
}

/**
 * Récepteur des avis : `traiter(requete, ip)` rend la réponse JSON (`{ ok, evenements }`). `cles()` : clés du pont lues
 * sur l'hébergement (relues à chaque avis : rotation prise sans redémarrage) ; `salonsMatch` : service des salons.
 */
export function creerRecepteurPoussees({ base, cles, salonsMatch, maintenant = () => Date.now(), limite = null }) {
  const nonceNeuf = async (nonce, expire) => {
    await base.executer('DELETE FROM site_lz_nonces WHERE expire_le < ?', [iso(maintenant())]);
    const r = await base.executer('INSERT INTO site_lz_nonces (nonce, expire_le) VALUES (?, ?) ON CONFLICT (nonce) DO NOTHING', [nonce, iso(expire)]);
    return Number(r.changements) === 1;
  };
  return {
    async traiter(requete, ip) {
      if (limite) await limite('site_lz_poussee', ip || 'inconnu');
      const longueur = Number(requete.headers.get('Content-Length') ?? 0);
      if (longueur > TAILLE_MAX_POUSSEE) throw echec(413, 'trop-gros', 'Avis trop volumineux.');
      const texte = await requete.text();
      if (texte.length > TAILLE_MAX_POUSSEE) throw echec(413, 'trop-gros', 'Avis trop volumineux.');
      await verifierPoussee({ cles: cles(), entetes: requete.headers, corps: texte, maintenant: maintenant(), nonceNeuf });
      const avis = lireAvis(texte);
      if (!avis) return { ok: true, ignore: true, evenements: 0 };
      const r = await salonsMatch.recevoirPoussee(avis);
      return { ok: true, evenements: r.evenements };
    },
  };
}
