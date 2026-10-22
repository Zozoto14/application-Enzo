/**
 * `Reseau` du site (navigateur) PAR LE RELAIS : les pages des sources sont lues
 * par la route `POST /tsuzuku/requete` du relais (relais/tsuzuku.mjs),
 * avec le jeton du compte Fondateur déjà gardé par la liaison au relais (aucun
 * nouveau secret). Le relais refait toute la garde anti-SSRF, n'envoie ni ne
 * rend aucun cookie et ne suit aucune redirection : la 3xx revient ici, et le
 * client sûr du moteur (`creerClient`) revérifie chaque saut, 5 au plus,
 * exactement comme avec le pont du PC.
 *
 * Le transport (appel HTTP au relais, jeton) est posé par le site
 * (`bureau/web.ts`, `applibourse.tsuzukuRelais`) : rien ici ne connaît le jeton.
 */

import { echec, type CodeErreur } from '../moteur/erreurs';
import type { FonctionFetch, ReponseReseau, RequeteReseau, Reseau } from '../moteur/reseau';
import { hoteDeCatalogue, MESSAGE_SITE, reseauWeb } from './reseauWeb';

/** Ce que le relais reçoit (corps JSON borné). */
export interface DemandeRelais {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  /** GET d'une page publique que le relais peut garder (relais à jour ; un ancien relais l'ignore). */
  cache?: { nature: 'recherche' | 'page'; frais?: boolean };
}

/** Ce que le site expose (`window.applibourse.tsuzukuRelais`). */
export interface TransportRelais {
  /** Vrai si ce site est relié au relais avec le jeton du compte Fondateur (jeton maître). */
  disponible(): boolean;
  /** `POST /tsuzuku/requete` : statut HTTP du relais et son JSON (null s'il n'en a pas). */
  envoyer(demande: DemandeRelais, delaiMs: number): Promise<{ statut: number; json: unknown }>;
}

/** Réponse du relais pour une requête aboutie. */
interface ReponseRelais {
  status: number;
  headers?: Record<string, string>;
  finalUrl?: string;
  contentType?: string | null;
  charset?: string | null;
  texte?: string;
  bodyBase64?: string;
  tronque?: boolean;
  /** Relais à jour : la page venait de son cache (HIT) ou du site (MISS). */
  cache?: string;
}

export const MESSAGES_RELAIS = {
  pasAJour:
    'Le relais ne connaît pas encore la lecture des sources : mettez à jour le relais (serveur o2switch : docs/o2switch.md), puis « Réessayer ».',
  jeton: 'Le serveur refuse la session de ce site : reconnectez-vous (identifiant et mot de passe).',
  interdit: 'Le relais réserve la lecture des sources au compte Fondateur relié au relais (code de liaison du PC) : ce compte n’y a pas accès sur le site.',
  origine: 'Le relais n’autorise pas l’adresse de ce site : ajoutez-la à ORIGINES_SITE (relais.env du serveur), puis redémarrez le relais.',
  debit: 'Trop de requêtes vers le relais (limite par minute) : patientez un instant, puis « Réessayer ».',
  injoignable: 'Relais injoignable : vérifiez la connexion. Si cela persiste, le relais n’est peut-être pas en ligne ou à jour (docs/o2switch.md).',
  illisible: 'Réponse illisible du relais : mettez-le à jour, puis « Réessayer ».',
} as const;

/** Le transport du site, s'il existe (jamais celui du PC : clé différente). */
export function transportRelais(source: unknown = globalThis): TransportRelais | undefined {
  const t = (source as { applibourse?: { tsuzukuRelais?: TransportRelais } }).applibourse?.tsuzukuRelais;
  return t && typeof t.envoyer === 'function' && typeof t.disponible === 'function' ? t : undefined;
}

function octetsDepuisBase64(b64: string): Uint8Array {
  const binaire = (globalThis as { atob?: (s: string) => string }).atob?.(b64);
  if (binaire === undefined) throw echec(MESSAGES_RELAIS.illisible, 'reseau', 502);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
  return octets;
}

/** Décode un corps binaire selon le jeu de caractères annoncé (repli UTF-8). */
export function decoderOctets(octets: Uint8Array, charset?: string | null): string {
  const Decodeur = (globalThis as { TextDecoder?: new (label?: string) => { decode(o: Uint8Array): string } }).TextDecoder;
  if (!Decodeur) return Array.from(octets, o => String.fromCharCode(o)).join('');
  try {
    return new Decodeur(charset || 'utf-8').decode(octets);
  } catch {
    return new Decodeur('utf-8').decode(octets);
  }
}

/** Réponse du relais → réponse au format du moteur (`{ statut, entetes, corps }`). */
export function lireReponseRelais(brut: unknown): ReponseReseau {
  const r = brut as ReponseRelais | null;
  if (!r || typeof r !== 'object' || typeof r.status !== 'number') {
    throw echec(MESSAGES_RELAIS.illisible, 'reseau', 502);
  }
  const entetes: Record<string, string> = {};
  for (const [nom, valeur] of Object.entries(r.headers && typeof r.headers === 'object' ? r.headers : {})) {
    if (typeof valeur === 'string') entetes[nom.toLowerCase()] = valeur;
  }
  if (r.tronque) entetes['x-tsuzuku-tronque'] = '1';
  if (r.cache === 'HIT' || r.cache === 'MISS') entetes['x-tsuzuku-relais-cache'] = r.cache;
  let corps = '';
  if (typeof r.texte === 'string') corps = r.texte;
  else if (typeof r.bodyBase64 === 'string') corps = decoderOctets(octetsDepuisBase64(r.bodyBase64), r.charset);
  return { statut: r.status, entetes, corps };
}

/** Erreur du relais (statut HTTP du RELAIS, pas du site lu) → erreur claire du moteur. */
export function erreurRelais(statut: number, json: unknown): Error {
  const lu = (json && typeof json === 'object' ? json : {}) as { erreur?: unknown; code?: unknown };
  const code = typeof lu.code === 'string' ? lu.code : '';
  const motif = typeof lu.erreur === 'string' && lu.erreur.length < 300 ? lu.erreur : undefined;
  const garde: CodeErreur = 'garde';
  switch (statut) {
    case 404:
      return echec(MESSAGES_RELAIS.pasAJour, 'service', 502);
    case 401:
      return echec(MESSAGES_RELAIS.jeton, 'service', 401);
    case 403:
      return echec(code === 'origine' ? MESSAGES_RELAIS.origine : MESSAGES_RELAIS.interdit, 'service', 403);
    case 429:
      return echec(MESSAGES_RELAIS.debit, 'service', 429);
    case 413:
      return echec(motif ?? 'Requête ou réponse trop volumineuse pour le relais.', 'taille', 502);
    case 504:
      return echec(motif ?? 'Délai dépassé (relais).', 'delai', 504);
    case 400:
      return echec(motif ?? 'Adresse refusée par le relais.', code === 'adresse' || code === 'dns' ? garde : 'saisie', 400);
    default:
      return echec(motif ? `${motif} (relais)` : MESSAGES_RELAIS.injoignable, 'reseau', 502);
  }
}

/** Toutes les requêtes passent par le relais (un saut par appel ; le moteur suit les redirections). */
export function reseauRelais(transport: TransportRelais): Reseau {
  return {
    async requete(r: RequeteReseau): Promise<ReponseReseau> {
      let rep: { statut: number; json: unknown };
      try {
        rep = await transport.envoyer(
          { url: r.url, method: r.methode, headers: r.entetes, ...(r.corps !== undefined ? { body: r.corps } : {}), ...(r.cache && r.methode === 'GET' ? { cache: r.cache } : {}) },
          r.delaiMs,
        );
      } catch {
        throw echec(MESSAGES_RELAIS.injoignable, 'reseau', 502);
      }
      if (rep.statut !== 200) throw erreurRelais(rep.statut, rep.json);
      return lireReponseRelais(rep.json);
    },
  };
}

/**
 * `Reseau` du site : les catalogues qui autorisent le CORS (Jikan, AniList,
 * TMDB) sont joints directement ; tout le reste passe par le relais, s'il est
 * relié avec le jeton du Fondateur. Sinon : refus clair (MESSAGE_SITE).
 */
export function reseauSite(transport?: TransportRelais, fetchFn?: FonctionFetch): Reseau {
  const direct = reseauWeb(fetchFn);
  const relais = transport ? reseauRelais(transport) : undefined;
  return {
    async requete(r) {
      if (hoteDeCatalogue(r.url)) return direct.requete(r);
      if (!relais || !transport?.disponible()) throw echec(MESSAGE_SITE, 'reseau', 501);
      return relais.requete(r);
    },
  };
}
