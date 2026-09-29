/**
 * Mises à jour sans Mac.
 *
 * Le problème : un seul build iOS sera possible, et tout changement de code
 * natif en exige un nouveau. Or une application React Native n'exécute pas du
 * code natif, elle exécute un **paquet JavaScript** que le binaire charge au
 * démarrage. Remplacer ce paquet met donc l'application à jour sans toucher au
 * binaire — et le paquet, lui, se fabrique sur PC (`npx react-native bundle`,
 * qui tourne sous Windows).
 *
 * Le danger : remplacer le code exécuté par une application qui détient la clé
 * de chiffrement du portefeuille, c'est exactement ce qu'un attaquant
 * souhaiterait. Un paquet n'est donc accepté que s'il est **signé** par la clé
 * privée qui vit sur le PC, et dont seule la partie publique est inscrite dans
 * le binaire.
 *
 * La chaîne de confiance part du build d'origine : le paquet installé vérifie
 * le candidat avant de l'autoriser, et le binaire ne charge que ce qui a été
 * autorisé.
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

export const VERSION_FORMAT = 1;

export interface Manifeste {
  /** Version du format de manifeste. */
  format: number;
  /** Numéro de version du paquet, strictement croissant. */
  version: number;
  /** Date de production, au format ISO. */
  date: string;
  /** Empreinte SHA-256 du paquet JavaScript, en hexadécimal. */
  empreinte: string;
  /** Taille du paquet en octets, contrôle grossier avant lecture. */
  taille: number;
  /** Signature Ed25519 du corps signé, en hexadécimal. */
  signature: string;
  /** Note de version, affichée avant d'appliquer. */
  notes?: string;
}

export class ErreurMiseAJour extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurMiseAJour';
  }
}

/**
 * Corps effectivement signé.
 *
 * Sérialisé dans un ordre fixe, champ par champ, plutôt que par
 * `JSON.stringify` de l'objet entier : l'ordre des clés d'un objet JavaScript
 * n'est pas garanti entre deux moteurs, et une signature qui dépend de cet
 * ordre casserait entre le PC et l'appareil.
 */
export function corpsSigne(
  manifeste: Pick<Manifeste, 'format' | 'version' | 'date' | 'empreinte' | 'taille'>,
): Uint8Array {
  return utf8ToBytes(
    [
      `format=${manifeste.format}`,
      `version=${manifeste.version}`,
      `date=${manifeste.date}`,
      `empreinte=${manifeste.empreinte}`,
      `taille=${manifeste.taille}`,
    ].join('\n'),
  );
}

export function empreinteDe(paquet: Uint8Array): string {
  return bytesToHex(sha256(paquet));
}

export interface ClesSignature {
  /** Clé privée, qui ne quitte jamais le PC. */
  privee: string;
  /** Clé publique, inscrite dans le binaire. */
  publique: string;
}

/** Génère la paire de clés de signature. À faire une seule fois. */
export function genererClesSignature(): ClesSignature {
  const privee = ed25519.utils.randomSecretKey();
  return {
    privee: bytesToHex(privee),
    publique: bytesToHex(ed25519.getPublicKey(privee)),
  };
}

export interface OptionsSignature {
  version: number;
  date: string;
  notes?: string;
  clePrivee: string;
}

/** Produit le manifeste signé d'un paquet. Exécuté sur le PC. */
export function signerPaquet(paquet: Uint8Array, options: OptionsSignature): Manifeste {
  if (!Number.isInteger(options.version) || options.version < 1) {
    throw new ErreurMiseAJour('Numéro de version invalide');
  }

  const base = {
    format: VERSION_FORMAT,
    version: options.version,
    date: options.date,
    empreinte: empreinteDe(paquet),
    taille: paquet.length,
  };

  return {
    ...base,
    notes: options.notes,
    signature: bytesToHex(
      ed25519.sign(corpsSigne(base), hexToBytes(options.clePrivee)),
    ),
  };
}

export interface ContexteVerification {
  /** Clé publique inscrite dans le binaire. */
  clePublique: string;
  /** Version actuellement installée. */
  versionInstallee: number;
  /** Taille maximale acceptée, garde-fou contre un fichier aberrant. */
  tailleMaximale?: number;
}

/** 32 Mio : un paquet JavaScript dépasse rarement quelques mégaoctets. */
export const TAILLE_MAXIMALE_DEFAUT = 32 * 1024 * 1024;

export interface ResultatVerification {
  valide: boolean;
  /** Motif du refus, rédigé pour être affiché tel quel. */
  motif?: string;
}

/**
 * Vérifie un paquet candidat.
 *
 * Les contrôles sont ordonnés du moins coûteux au plus coûteux, mais tous
 * sont faits avant d'accepter : la signature ne dispense pas de vérifier
 * l'empreinte, puisqu'elle ne porte que sur le manifeste.
 */
export function verifierPaquet(
  paquet: Uint8Array,
  manifeste: Manifeste,
  contexte: ContexteVerification,
): ResultatVerification {
  const refus = (motif: string): ResultatVerification => ({ valide: false, motif });

  if (manifeste.format !== VERSION_FORMAT) {
    return refus(
      `Format de manifeste inconnu (${manifeste.format}). Cette version de l’application ne sait pas le lire.`,
    );
  }

  if (!Number.isInteger(manifeste.version)) {
    return refus('Numéro de version invalide.');
  }

  // Refuser une version antérieure ou égale ferme la porte au rejeu : sans
  // cela, un ancien paquet signé, donc authentique, pourrait être réinstallé
  // pour ramener une faille déjà corrigée.
  if (manifeste.version <= contexte.versionInstallee) {
    return refus(
      `Ce paquet (version ${manifeste.version}) n’est pas plus récent que la version installée (${contexte.versionInstallee}).`,
    );
  }

  const tailleMaximale = contexte.tailleMaximale ?? TAILLE_MAXIMALE_DEFAUT;
  if (paquet.length !== manifeste.taille) {
    return refus('La taille du paquet ne correspond pas au manifeste.');
  }
  if (paquet.length === 0 || paquet.length > tailleMaximale) {
    return refus('Taille de paquet aberrante.');
  }

  if (empreinteDe(paquet) !== manifeste.empreinte) {
    return refus(
      "L’empreinte du paquet ne correspond pas au manifeste : le fichier est incomplet ou modifié.",
    );
  }

  let signatureValide = false;
  try {
    signatureValide = ed25519.verify(
      hexToBytes(manifeste.signature),
      corpsSigne(manifeste),
      hexToBytes(contexte.clePublique),
    );
  } catch {
    return refus('Signature illisible.');
  }

  if (!signatureValide) {
    return refus(
      "Signature invalide : ce paquet n’a pas été produit avec votre clé de mise à jour.",
    );
  }

  return { valide: true };
}
