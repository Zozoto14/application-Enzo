/**
 * Coffre de clés : chiffrement à enveloppe.
 *
 * Le mot de passe ne chiffre pas la base. Il chiffre une **clé maîtresse**
 * tirée au hasard, et c'est elle qui chiffre la base (SQLCipher).
 *
 * Cette indirection résout deux problèmes que la dérivation directe rend
 * insolubles :
 *
 *  1. **Changer de mot de passe** ne demande que de rechiffrer 32 octets. Sans
 *     enveloppe, il faudrait déchiffrer puis rechiffrer toute la base, avec le
 *     risque de tout perdre si l'opération est interrompue.
 *
 *  2. **Les codes de récupération** peuvent ouvrir la même base. Chaque code
 *     chiffre une copie indépendante de la clé maîtresse. Perdre son mot de
 *     passe n'est donc plus une perte de données, exactement comme le prévoit
 *     le cadrage.
 *
 * Le coffre lui-même n'est pas secret : sans le mot de passe ni un code, ses
 * enveloppes sont inexploitables. Il peut être stocké en clair, sauvegardé et
 * synchronisé comme n'importe quel fichier.
 *
 * Chaque enveloppe est scellée par XChaCha20-Poly1305 : une clé fausse ne
 * produit pas des octets aléatoires, elle fait échouer la vérification
 * d'intégrité. Vérifier un mot de passe ne demande donc aucune comparaison
 * supplémentaire, et aucun témoin de vérification à stocker.
 */

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { aleatoireParDefaut, type SourceAleatoire } from './aleatoire';
import { depuisBase32, versBase32 } from './encodage';
import {
  PARAMETRES_KDF_DEFAUT,
  deriverCle,
  type ParametresKdf,
} from './kdf';
import { genererCodeRecuperation, normaliserCode } from './codes-recuperation';

/** Longueur du nonce de XChaCha20-Poly1305. */
const LONGUEUR_NONCE = 24;
/** Longueur de la clé maîtresse, imposée par SQLCipher en AES-256. */
export const LONGUEUR_CLE_MAITRESSE = 32;

export const VERSION_COFFRE = 1;
export const NOMBRE_CODES_DEFAUT = 10;

export type UsageEnveloppe = 'motdepasse' | 'recuperation';

export interface Enveloppe {
  usage: UsageEnveloppe;
  /** Sel de dérivation, propre à cette enveloppe. */
  sel: string;
  nonce: string;
  /** Clé maîtresse chiffrée. */
  charge: string;
  kdf: ParametresKdf;
}

export interface SecretScelle {
  nonce: string;
  charge: string;
}

export interface Coffre {
  version: number;
  enveloppes: Enveloppe[];
  /** Secret TOTP, scellé par la clé maîtresse. */
  totp?: SecretScelle;
}

export class ErreurDeverrouillage extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurDeverrouillage';
  }
}

/**
 * La clé n'a pas pu être CALCULÉE (mémoire refusée par le navigateur,
 * paramètres de dérivation illisibles…). Ce n'est pas un échec
 * d'authentification : rien ne permet de dire si le mot de passe est juste,
 * et la tentative ne doit pas compter comme un échec.
 */
export class ErreurCalculCle extends Error {
  constructor(readonly cause: unknown) {
    super(
      'Impossible de calculer la clé sur cet appareil (mémoire insuffisante ou navigateur trop limité). ' +
        'Fermez les autres onglets ou applications puis réessayez, ou déverrouillez depuis un autre appareil.',
    );
    this.name = 'ErreurCalculCle';
  }
}

/**
 * Donnée associée liant chaque enveloppe à son usage.
 * Une enveloppe de récupération ne peut donc pas être présentée à la place
 * d'une enveloppe de mot de passe : le déchiffrement échouerait.
 */
const donneeAssociee = (usage: UsageEnveloppe): Uint8Array =>
  utf8ToBytes(`applibourse/coffre/v${VERSION_COFFRE}/${usage}`);

function sceller(
  cle: Uint8Array,
  contenu: Uint8Array,
  usage: UsageEnveloppe,
  alea: SourceAleatoire,
): { nonce: string; charge: string } {
  const nonce = alea(LONGUEUR_NONCE);
  const charge = xchacha20poly1305(cle, nonce, donneeAssociee(usage)).encrypt(contenu);
  return { nonce: bytesToHex(nonce), charge: bytesToHex(charge) };
}

function desceller(
  cle: Uint8Array,
  nonce: string,
  charge: string,
  usage: UsageEnveloppe,
): Uint8Array {
  return xchacha20poly1305(
    cle,
    hexToBytes(nonce),
    donneeAssociee(usage),
  ).decrypt(hexToBytes(charge));
}

function creerEnveloppe(
  cleMaitresse: Uint8Array,
  secret: string,
  usage: UsageEnveloppe,
  parametres: ParametresKdf,
  alea: SourceAleatoire,
): Enveloppe {
  const sel = alea(16);
  const cle = deriverCle(secret, sel, parametres);
  const { nonce, charge } = sceller(cle, cleMaitresse, usage, alea);
  return { usage, sel: bytesToHex(sel), nonce, charge, kdf: parametres };
}

export interface OptionsCreation {
  motDePasse: string;
  /** Nombre de codes de récupération à produire. */
  nombreCodes?: number;
  kdf?: ParametresKdf;
  alea?: SourceAleatoire;
}

export interface CoffreCree {
  coffre: Coffre;
  /**
   * Codes de récupération en clair. Ils ne sont affichés qu'une fois, à la
   * création : le coffre n'en garde que la forme chiffrée, et ils ne peuvent
   * plus être retrouvés ensuite.
   */
  codesRecuperation: string[];
  cleMaitresse: Uint8Array;
}

export function creerCoffre(options: OptionsCreation): CoffreCree {
  const alea = options.alea ?? aleatoireParDefaut;
  const parametres = options.kdf ?? PARAMETRES_KDF_DEFAUT;
  const cleMaitresse = alea(LONGUEUR_CLE_MAITRESSE);

  const codesRecuperation = Array.from(
    { length: options.nombreCodes ?? NOMBRE_CODES_DEFAUT },
    () => genererCodeRecuperation(alea),
  );

  const enveloppes: Enveloppe[] = [
    creerEnveloppe(cleMaitresse, options.motDePasse, 'motdepasse', parametres, alea),
    ...codesRecuperation.map(code =>
      creerEnveloppe(cleMaitresse, normaliserCode(code), 'recuperation', parametres, alea),
    ),
  ];

  return {
    coffre: { version: VERSION_COFFRE, enveloppes },
    codesRecuperation,
    cleMaitresse,
  };
}

function ouvrir(enveloppe: Enveloppe, secret: string): Uint8Array | null {
  let cle: Uint8Array;
  try {
    cle = deriverCle(secret, hexToBytes(enveloppe.sel), enveloppe.kdf);
  } catch (erreur) {
    // La dérivation n'a PAS eu lieu (RangeError d'allocation sur Safari iOS,
    // paramètres illisibles) : ce n'est pas un mot de passe faux. Le confondre
    // avec un échec d'authentification faisait refuser des identifiants justes
    // et consommait des tentatives.
    throw new ErreurCalculCle(erreur);
  }
  try {
    return desceller(cle, enveloppe.nonce, enveloppe.charge, enveloppe.usage);
  } catch {
    // Échec d'authentification : secret faux, ou enveloppe altérée. Les deux
    // cas sont indiscernables de l'extérieur, et c'est voulu.
    return null;
  }
}

export function deverrouillerParMotDePasse(
  coffre: Coffre,
  motDePasse: string,
): Uint8Array {
  for (const enveloppe of coffre.enveloppes) {
    if (enveloppe.usage !== 'motdepasse') {
      continue;
    }
    const cleMaitresse = ouvrir(enveloppe, motDePasse);
    if (cleMaitresse) {
      return cleMaitresse;
    }
  }
  throw new ErreurDeverrouillage('Mot de passe incorrect');
}

export interface DeverrouillageRecuperation {
  cleMaitresse: Uint8Array;
  /** Coffre privé du code utilisé : un code de récupération ne sert qu'une fois. */
  coffre: Coffre;
  /** Nombre de codes encore utilisables. */
  codesRestants: number;
}

export function deverrouillerParCodeRecuperation(
  coffre: Coffre,
  code: string,
): DeverrouillageRecuperation {
  const normalise = normaliserCode(code);

  for (const enveloppe of coffre.enveloppes) {
    if (enveloppe.usage !== 'recuperation') {
      continue;
    }
    const cleMaitresse = ouvrir(enveloppe, normalise);
    if (!cleMaitresse) {
      continue;
    }

    const restantes = coffre.enveloppes.filter(autre => autre !== enveloppe);
    return {
      cleMaitresse,
      coffre: { ...coffre, enveloppes: restantes },
      codesRestants: restantes.filter(e => e.usage === 'recuperation').length,
    };
  }
  throw new ErreurDeverrouillage('Code de récupération invalide ou déjà utilisé');
}

/**
 * Remplace l'enveloppe de mot de passe.
 * La base n'est pas touchée : la clé maîtresse reste la même, seule sa
 * protection change. Les codes de récupération restent valides.
 */
export function changerMotDePasse(
  coffre: Coffre,
  cleMaitresse: Uint8Array,
  nouveauMotDePasse: string,
  options: { kdf?: ParametresKdf; alea?: SourceAleatoire } = {},
): Coffre {
  const alea = options.alea ?? aleatoireParDefaut;
  const parametres = options.kdf ?? PARAMETRES_KDF_DEFAUT;

  return {
    ...coffre,
    enveloppes: [
      creerEnveloppe(cleMaitresse, nouveauMotDePasse, 'motdepasse', parametres, alea),
      ...coffre.enveloppes.filter(enveloppe => enveloppe.usage !== 'motdepasse'),
    ],
  };
}

/** Remplace tous les codes de récupération, par exemple après en avoir consommé un. */
export function regenererCodesRecuperation(
  coffre: Coffre,
  cleMaitresse: Uint8Array,
  options: { nombreCodes?: number; kdf?: ParametresKdf; alea?: SourceAleatoire } = {},
): { coffre: Coffre; codesRecuperation: string[] } {
  const alea = options.alea ?? aleatoireParDefaut;
  const parametres = options.kdf ?? PARAMETRES_KDF_DEFAUT;

  const codesRecuperation = Array.from(
    { length: options.nombreCodes ?? NOMBRE_CODES_DEFAUT },
    () => genererCodeRecuperation(alea),
  );

  return {
    coffre: {
      ...coffre,
      enveloppes: [
        ...coffre.enveloppes.filter(enveloppe => enveloppe.usage !== 'recuperation'),
        ...codesRecuperation.map(code =>
          creerEnveloppe(cleMaitresse, normaliserCode(code), 'recuperation', parametres, alea),
        ),
      ],
    },
    codesRecuperation,
  };
}

/**
 * Scelle le secret TOTP avec la clé maîtresse.
 *
 * Le secret est converti en octets avant d'être chiffré, et réencodé en base32
 * à la lecture : rien ne dépend donc de `TextDecoder`, absent de certains
 * moteurs JavaScript embarqués.
 */
export function definirSecretTotp(
  coffre: Coffre,
  cleMaitresse: Uint8Array,
  secret: string,
  alea: SourceAleatoire = aleatoireParDefaut,
): Coffre {
  return {
    ...coffre,
    totp: sceller(cleMaitresse, depuisBase32(secret), 'motdepasse', alea),
  };
}

export function lireSecretTotp(
  coffre: Coffre,
  cleMaitresse: Uint8Array,
): string | undefined {
  if (!coffre.totp) {
    return undefined;
  }
  return versBase32(
    desceller(cleMaitresse, coffre.totp.nonce, coffre.totp.charge, 'motdepasse'),
  );
}

/** Clé au format attendu par SQLCipher (`PRAGMA key = "x'...'"`). */
export function cleHexadecimale(cleMaitresse: Uint8Array): string {
  return bytesToHex(cleMaitresse);
}
