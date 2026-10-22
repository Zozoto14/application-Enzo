/**
 * Portées du relais, côté application.
 *
 * Le relais reconnaît deux sortes de jetons (voir relais/relais.mjs) :
 *  - le jeton MAÎTRE, celui de l'administrateur : tous les droits ;
 *  - un jeton de PROFIL `p1.<id>.<HMAC-SHA256(jeton maître, « applibourse-profil-v1|<id> »)>`,
 *    qui n'ouvre que l'espace `p/<id>/` de ce compte (et la passerelle).
 *
 * L'administrateur fabrique le jeton de profil d'un ami hors ligne, avec le
 * même calcul que le relais : c'est ce jeton, jamais le jeton maître, que
 * porte le code de liaison PROPRE à l'ami (« Envoyer un code de connexion au
 * site », panneau d'Administration).
 */

import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { Liaison } from './liaison';

/** Même motif que les identifiants de l'annuaire. */
const MOTIF_ID_AMI = /^[a-z0-9]{6,16}$/;
const MOTIF_JETON_PROFIL = /^p1\.([a-z0-9]{6,16})\.[0-9a-f]{64}$/;
/** Espace de l'administrateur : jamais de jeton de profil pour lui. */
export const ESPACE_ADMIN = 'principal';

export type Portee = { maitre: true } | { profil: string };

export function jetonDeProfil(jetonMaitre: string, id: string): string {
  if (!MOTIF_ID_AMI.test(id) || id === ESPACE_ADMIN) {
    throw new Error('Identifiant de compte invalide pour un jeton de profil.');
  }
  return `p1.${id}.${bytesToHex(hmac(sha256, utf8ToBytes(jetonMaitre), utf8ToBytes(`applibourse-profil-v1|${id}`)))}`;
}

/** Portée d'un jeton, lue sur sa forme (le relais, lui, vérifie la signature). */
export function porteeDuJeton(jeton: string): Portee {
  const trouve = MOTIF_JETON_PROFIL.exec(jeton);
  return trouve ? { profil: trouve[1] } : { maitre: true };
}

export const estMaitre = (liaison: Pick<Liaison, 'jeton'>): boolean => 'maitre' in porteeDuJeton(liaison.jeton);

/** Compte auquel une liaison est réservée (jeton de profil), sinon rien. */
export function compteDeLiaison(liaison: Pick<Liaison, 'jeton'>): string | undefined {
  const portee = porteeDuJeton(liaison.jeton);
  return 'profil' in portee ? portee.profil : undefined;
}

/** Liaison propre à un ami : même relais, même site, SON jeton de profil. */
export function liaisonPourProfil(maitre: Liaison, id: string): Liaison {
  if (!estMaitre(maitre)) {
    throw new Error('Seul le code de l’administrateur permet de fabriquer celui d’un ami.');
  }
  return { relais: maitre.relais, jeton: jetonDeProfil(maitre.jeton, id), ...(maitre.site ? { site: maitre.site } : {}) };
}

/** Liaison utilisable pour l'espace `id` : la maîtresse, ou celle de ce compte. */
export function peutOuvrirEspace(liaison: Pick<Liaison, 'jeton'>, id: string): boolean {
  const portee = porteeDuJeton(liaison.jeton);
  return 'maitre' in portee || portee.profil === id;
}
