/**
 * Appels au relais pour les invitations et la connexion par identifiant
 * (relais version 6, voir relais/worker.mjs et docs/connexion-amis.md).
 *
 * Chaque échec est traduit en une cause PRÉCISE (`ErreurInvitation.code`) :
 * relais injoignable, relais pas encore redéployé, invitation expirée,
 * utilisée ou révoquée, identifiant inconnu, mot de passe incorrect, trop de
 * tentatives (avec le délai), accès révoqué.
 */

import {
  ErreurInvitation,
  messageErreur,
  type CodeErreurConnexion,
  type DepotAcces,
} from '../../profils/invitation';
import type { ParametresKdf } from '../../securite/kdf';
import type { Liaison } from './liaison';

type Fetch = typeof fetch;

/** Version minimale du relais pour les invitations, l'accès par identifiant et les révocations. */
export const VERSION_CONNEXION = 6;

async function demander(adresse: string, chemin: string, options: { methode?: string; corps?: unknown; jeton?: string } = {}, requete: Fetch = fetch): Promise<Response> {
  const controle = typeof AbortController === 'undefined' ? undefined : new AbortController();
  const minuterie = controle ? setTimeout(() => controle.abort(), 25_000) : undefined;
  try {
    return await requete(`${adresse}${chemin}`, {
      method: options.methode ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...(options.jeton ? { Authorization: `Bearer ${options.jeton}` } : {}) },
      body: options.corps === undefined ? undefined : JSON.stringify(options.corps),
      signal: controle?.signal,
    });
  } catch {
    throw new ErreurInvitation('relais-injoignable');
  } finally {
    if (minuterie) clearTimeout(minuterie);
  }
}

async function corps(reponse: Response): Promise<Record<string, unknown>> {
  try {
    const lu = (await reponse.json()) as unknown;
    return lu && typeof lu === 'object' ? (lu as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Traduit une réponse refusée d'une route publique en cause précise. */
async function causeDe(reponse: Response, qui?: string): Promise<ErreurInvitation> {
  const lu = await corps(reponse);
  const motif = typeof lu.motif === 'string' ? lu.motif : '';
  const erreur = (code: CodeErreurConnexion, attenteS?: number) => new ErreurInvitation(code, messageErreur(code, { qui, attenteS }));
  // Un relais d'avant la version 6 exige un jeton partout (401), et ne connaît pas ces routes (404/405 sans motif).
  if (reponse.status === 401 || ((reponse.status === 404 || reponse.status === 405) && !motif)) return erreur('relais-ancien');
  if (reponse.status === 429) {
    const attente = Number(reponse.headers.get('Retry-After') ?? lu.attente) || 60;
    return erreur('trop-de-tentatives', attente);
  }
  switch (motif) {
    case 'inconnue':
      return erreur('invitation-inconnue');
    case 'utilisee':
      return erreur('invitation-utilisee');
    case 'expiree':
      return erreur('invitation-expiree');
    case 'revoquee':
      return erreur('invitation-revoquee');
    case 'identifiant-inconnu':
      return erreur('identifiant-inconnu');
    case 'mot-de-passe':
      return typeof lu.attente === 'number' ? erreur('trop-de-tentatives', lu.attente) : erreur('mot-de-passe');
    case 'revoque':
      return erreur('acces-revoque');
    case 'identifiant-pris':
      return erreur('identifiant-pris');
    case 'preuve':
      return erreur('lien-illisible');
    default:
      return new ErreurInvitation('relais-injoignable', `Le serveur de synchronisation a répondu ${reponse.status}. Réessaie dans un instant.`);
  }
}

/** Version et fonctions du relais (jeton requis), ou `undefined` s'il ne répond pas. */
export async function versionRelais(liaison: Liaison, requete: Fetch = fetch): Promise<{ version: number; fonctions: string[] } | undefined> {
  try {
    const reponse = await demander(liaison.relais, '/sante', { jeton: liaison.jeton }, requete);
    if (!reponse.ok) return undefined;
    const lu = await corps(reponse);
    return { version: Number(lu.version) || 1, fonctions: Array.isArray(lu.fonctions) ? lu.fonctions.filter((f): f is string => typeof f === 'string') : [] };
  } catch {
    return undefined;
  }
}

export const relaisAJour = (v: { version: number } | undefined): boolean => Boolean(v && v.version >= VERSION_CONNEXION);

// ------------------------------------------------------------ Côté Fondateur (jeton maître)

export interface DepotInvitation {
  id: string;
  profil: string;
  expire: string;
  charge: string;
  verif: string;
  /** Empreinte de l'identifiant attribué à ce compte (accès par identifiant). */
  acces?: string;
  court?: { id: string; charge: string; verif: string };
}

export async function publierInvitation(maitre: Liaison, depot: DepotInvitation, requete: Fetch = fetch): Promise<void> {
  const { id, ...reste } = depot;
  const reponse = await demander(maitre.relais, `/invitations/${id}`, { methode: 'PUT', jeton: maitre.jeton, corps: reste }, requete);
  if (!reponse.ok) {
    throw reponse.status === 404 || reponse.status === 405 ? new ErreurInvitation('relais-ancien') : await causeDe(reponse);
  }
}

export async function revoquerInvitation(maitre: Liaison, id: string, requete: Fetch = fetch): Promise<void> {
  const reponse = await demander(maitre.relais, `/invitations/${id}`, { methode: 'DELETE', jeton: maitre.jeton }, requete);
  if (!reponse.ok && reponse.status !== 404) throw await causeDe(reponse);
}

/** Révoque (ou rétablit) le jeton de profil d'un compte sur le relais. */
export async function revoquerCompte(maitre: Liaison, compte: string, revoque: boolean, requete: Fetch = fetch): Promise<void> {
  const reponse = await demander(maitre.relais, `/revocations/${compte}`, { methode: revoque ? 'PUT' : 'DELETE', jeton: maitre.jeton }, requete);
  if (!reponse.ok) {
    throw reponse.status === 404 || reponse.status === 405 ? new ErreurInvitation('relais-ancien') : await causeDe(reponse);
  }
}

export async function compteRevoque(maitre: Liaison, compte: string, requete: Fetch = fetch): Promise<boolean | undefined> {
  try {
    const reponse = await demander(maitre.relais, `/revocations/${compte}`, { jeton: maitre.jeton }, requete);
    if (!reponse.ok) return undefined;
    return (await corps(reponse)).revoque === true;
  } catch {
    return undefined;
  }
}

/** Retire l'accès par identifiant (mot de passe réinitialisé, compte révoqué). */
export async function supprimerAcces(liaison: Liaison, h: string, requete: Fetch = fetch): Promise<void> {
  const reponse = await demander(liaison.relais, `/acces/${h}`, { methode: 'DELETE', jeton: liaison.jeton }, requete);
  if (!reponse.ok && reponse.status !== 404) throw await causeDe(reponse);
}

// ------------------------------------------------------------ Côté ami (sans jeton, puis jeton de profil)

export async function lireInvitationRelais(relais: string, id: string, qui?: string, requete: Fetch = fetch): Promise<{ charge: string; expire: string; heure?: number }> {
  const reponse = await demander(relais, `/invitations/${id}`, {}, requete);
  if (!reponse.ok) throw await causeDe(reponse, qui);
  const lu = await corps(reponse);
  if (typeof lu.charge !== 'string' || typeof lu.expire !== 'string') throw new ErreurInvitation('lien-illisible');
  return { charge: lu.charge, expire: lu.expire, ...(typeof lu.heure === 'number' ? { heure: lu.heure } : {}) };
}

export async function utiliserInvitationRelais(relais: string, id: string, preuve: string, requete: Fetch = fetch): Promise<void> {
  const reponse = await demander(relais, `/invitations/${id}/utiliser`, { methode: 'POST', corps: { preuve } }, requete);
  if (!reponse.ok) throw await causeDe(reponse);
}

export async function publierAcces(liaison: Liaison, h: string, depot: DepotAcces, requete: Fetch = fetch): Promise<void> {
  const reponse = await demander(liaison.relais, `/acces/${h}`, { methode: 'PUT', jeton: liaison.jeton, corps: depot }, requete);
  if (!reponse.ok) {
    throw reponse.status === 404 || reponse.status === 405 ? new ErreurInvitation('relais-ancien') : await causeDe(reponse);
  }
}

export async function lireSelAcces(relais: string, h: string, requete: Fetch = fetch): Promise<{ sel: string; kdf: ParametresKdf; secours?: { sel: string; kdf: ParametresKdf } }> {
  const reponse = await demander(relais, `/acces/${h}`, {}, requete);
  if (!reponse.ok) throw await causeDe(reponse);
  const lu = await corps(reponse);
  const kdf = lu.kdf as ParametresKdf | undefined;
  if (typeof lu.sel !== 'string' || !kdf) throw new ErreurInvitation('relais-injoignable', 'Réponse illisible du serveur de synchronisation.');
  const s = lu.secours as { sel?: unknown; kdf?: ParametresKdf } | undefined;
  return { sel: lu.sel, kdf, ...(s && typeof s.sel === 'string' && s.kdf ? { secours: { sel: s.sel, kdf: s.kdf } } : {}) };
}

/**
 * Preuve présentée au relais. Version 9 : le Fondateur reçoit en plus un jeton de SESSION (`jeton`),
 * et l'accès de secours (`secours`) dit lequel des codes de récupération a servi.
 */
export async function ouvrirAccesRelais(
  relais: string,
  h: string,
  preuve: string,
  requete: Fetch = fetch,
  route: 'ouvrir' | 'secours' = 'ouvrir',
): Promise<{ compte: string; charge: string; jeton?: string; secours?: number }> {
  const reponse = await demander(relais, `/acces/${h}/${route}`, { methode: 'POST', corps: { preuve } }, requete);
  if (!reponse.ok) {
    const erreur = await causeDe(reponse);
    if (route === 'secours' && erreur.code === 'mot-de-passe') throw new ErreurInvitation('code-recuperation', messageErreur('code-recuperation'));
    throw erreur;
  }
  const lu = await corps(reponse);
  if (typeof lu.compte !== 'string' || typeof lu.charge !== 'string') throw new ErreurInvitation('relais-injoignable', 'Réponse illisible du serveur de synchronisation.');
  return {
    compte: lu.compte,
    charge: lu.charge,
    ...(typeof lu.jeton === 'string' && /^s1\.[0-9a-f]{64}$/.test(lu.jeton) ? { jeton: lu.jeton } : {}),
    ...(typeof lu.secours === 'number' ? { secours: lu.secours } : {}),
  };
}

// ------------------------------------------------------------ Style public (version 9)

/** Nom du thème d'un identifiant (rien d'autre ; `undefined` : aucun, inconnu, ou serveur injoignable). */
export async function lireThemePublic(relais: string, h: string, requete: Fetch = fetch): Promise<string | undefined> {
  try {
    const reponse = await demander(relais, `/v9/theme/${h}`, {}, requete);
    if (!reponse.ok) return undefined;
    const lu = await corps(reponse);
    return typeof lu.theme === 'string' && /^[a-z0-9-]{1,40}$/.test(lu.theme) ? lu.theme : undefined;
  } catch {
    return undefined;
  }
}

export async function publierThemePublic(liaison: Liaison, h: string, theme: string | null, requete: Fetch = fetch): Promise<void> {
  const reponse = await demander(liaison.relais, `/v9/theme/${h}`, { methode: 'PUT', jeton: liaison.jeton, corps: { theme } }, requete);
  if (!reponse.ok) throw await causeDe(reponse);
}

/** Ferme la session de ce navigateur (Fondateur). */
export async function fermerSession(liaison: Liaison, requete: Fetch = fetch): Promise<void> {
  await demander(liaison.relais, '/v9/sessions/courante', { methode: 'DELETE', jeton: liaison.jeton }, requete).catch(() => undefined);
}

/** Heure du relais (jeton de profil), pour juger une expiration sans se fier à l'horloge de l'appareil. */
export async function heureRelais(liaison: Liaison, requete: Fetch = fetch): Promise<number | undefined> {
  try {
    const reponse = await demander(liaison.relais, '/heure', { jeton: liaison.jeton }, requete);
    if (!reponse.ok) return undefined;
    const lu = await corps(reponse);
    return typeof lu.heure === 'number' ? lu.heure : undefined;
  } catch {
    return undefined;
  }
}
