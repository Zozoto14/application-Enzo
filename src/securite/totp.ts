/* eslint-disable no-bitwise -- la troncature dynamique de la RFC 4226 est specifiee en operations binaires. */
/**
 * Codes TOTP (RFC 6238), compatibles Google Authenticator.
 *
 * Implémenté plutôt qu'importé : l'algorithme tient en quarante lignes, il est
 * spécifié par une RFC qui fournit ses propres vecteurs de test, et le code
 * vérifie ici exactement ces vecteurs. Une dépendance de plus dans la couche
 * de sécurité se justifierait mal.
 *
 * Sur ce que le TOTP protège vraiment, voir le README : il garde l'accès par
 * l'application, pas le fichier de base lui-même.
 */

import { hmac } from '@noble/hashes/hmac.js';
import { sha1 } from '@noble/hashes/legacy.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import type { SourceAleatoire } from './aleatoire';
import { depuisBase32, egaliteConstante, versBase32 } from './encodage';

export type AlgorithmeTotp = 'SHA1' | 'SHA256' | 'SHA512';

export interface OptionsTotp {
  /** Durée de validité d'un code, en secondes. */
  pas?: number;
  chiffres?: number;
  algorithme?: AlgorithmeTotp;
}

const PAS_DEFAUT = 30;
const CHIFFRES_DEFAUT = 6;
const ALGORITHME_DEFAUT: AlgorithmeTotp = 'SHA1';

const FONCTIONS = { SHA1: sha1, SHA256: sha256, SHA512: sha512 } as const;

/** Compteur sur 8 octets, gros-boutiste, tel que l'exige la RFC 4226. */
function versCompteur(valeur: number): Uint8Array {
  const octets = new Uint8Array(8);
  let reste = BigInt(Math.floor(valeur));
  for (let i = 7; i >= 0; i--) {
    octets[i] = Number(reste & 0xffn);
    reste >>= 8n;
  }
  return octets;
}

/** Troncature dynamique décrite par la RFC 4226. */
function tronquer(empreinte: Uint8Array, chiffres: number): string {
  const decalage = empreinte[empreinte.length - 1] & 0x0f;
  const binaire =
    ((empreinte[decalage] & 0x7f) << 24) |
    (empreinte[decalage + 1] << 16) |
    (empreinte[decalage + 2] << 8) |
    empreinte[decalage + 3];

  return String(binaire % 10 ** chiffres).padStart(chiffres, '0');
}

/** Code HOTP pour un compteur donné. */
export function codeHotp(
  secret: string,
  compteur: number,
  options: OptionsTotp = {},
): string {
  const algorithme = options.algorithme ?? ALGORITHME_DEFAUT;
  const empreinte = hmac(
    FONCTIONS[algorithme],
    depuisBase32(secret),
    versCompteur(compteur),
  );
  return tronquer(empreinte, options.chiffres ?? CHIFFRES_DEFAUT);
}

/** Numéro de la fenêtre temporelle courante. */
export function fenetreCourante(instantMs: number, pas = PAS_DEFAUT): number {
  return Math.floor(instantMs / 1000 / pas);
}

export function codeTotp(
  secret: string,
  instantMs: number,
  options: OptionsTotp = {},
): string {
  return codeHotp(secret, fenetreCourante(instantMs, options.pas ?? PAS_DEFAUT), options);
}

export interface OptionsVerification extends OptionsTotp {
  /**
   * Nombre de fenêtres acceptées de part et d'autre de la fenêtre courante.
   * 1 par défaut, soit ±30 secondes : compense la dérive d'horloge et le temps
   * de saisie. L'augmenter allonge d'autant la durée de validité d'un code
   * intercepté.
   */
  fenetre?: number;
}

/**
 * Vérifie un code, en tolérant la dérive d'horloge.
 * La comparaison est à temps constant, et toutes les fenêtres sont examinées
 * même après une correspondance : le temps de réponse ne révèle donc pas
 * quelle fenêtre a validé le code.
 */
export function verifierCodeTotp(
  secret: string,
  code: string,
  instantMs: number,
  options: OptionsVerification = {},
): boolean {
  const saisi = code.replace(/\s/g, '');
  const tolerance = options.fenetre ?? 1;
  const courante = fenetreCourante(instantMs, options.pas ?? PAS_DEFAUT);

  let valide = false;
  for (let decalage = -tolerance; decalage <= tolerance; decalage++) {
    const attendu = codeHotp(secret, courante + decalage, options);
    valide = egaliteConstante(attendu, saisi) || valide;
  }
  return valide;
}

/**
 * Secret TOTP de 160 bits, la taille recommandée par la RFC 4226 pour SHA-1.
 */
export function genererSecretTotp(alea: SourceAleatoire, octets = 20): string {
  return versBase32(alea(octets));
}

export interface OptionsUri {
  secret: string;
  /** Identifiant affiché dans l'application d'authentification. */
  compte: string;
  emetteur?: string;
  chiffres?: number;
  pas?: number;
  algorithme?: AlgorithmeTotp;
}

/** URI `otpauth://` à présenter en QR code lors de l'enrôlement. */
export function uriOtpauth(options: OptionsUri): string {
  const emetteur = options.emetteur ?? 'AppDashboard';
  const etiquette = `${encodeURIComponent(emetteur)}:${encodeURIComponent(options.compte)}`;

  const parametres = new URLSearchParams({
    secret: options.secret,
    issuer: emetteur,
    algorithm: options.algorithme ?? ALGORITHME_DEFAUT,
    digits: String(options.chiffres ?? CHIFFRES_DEFAUT),
    period: String(options.pas ?? PAS_DEFAUT),
  });

  return `otpauth://totp/${etiquette}?${parametres.toString()}`;
}
