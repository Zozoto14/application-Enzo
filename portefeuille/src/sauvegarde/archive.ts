/**
 * Sauvegarde chiffrée du portefeuille.
 *
 * Les codes de récupération sauvent la **clé**, pas les **données**. Un
 * téléphone perdu emporte la base avec lui, et aucun code n'y changera rien.
 * D'où ce format d'archive : tout le contenu, chiffré, dans un fichier qu'on
 * peut poser n'importe où sans risque.
 *
 * Choix de conception, et il n'est pas anodin : l'archive est chiffrée par un
 * mot de passe **choisi à l'export**, pas par la clé maîtresse du coffre.
 * Deux raisons :
 *
 *  - une sauvegarde doit rester lisible après un changement de mot de passe,
 *    ou une réinstallation qui créera un coffre neuf ;
 *  - une archive que seul l'appareil d'origine sait ouvrir ne sauve rien le
 *    jour où cet appareil disparaît, ce qui est précisément le cas prévu.
 *
 * L'archive porte donc son propre sel et ses propres paramètres de
 * dérivation, comme les enveloppes du coffre.
 */

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { Decimal } from '../core/money/decimal';
import type { Compte, Titre, Transaction } from '../core/domain/types';
import { aleatoireParDefaut, type SourceAleatoire } from '../securite/aleatoire';
import { PARAMETRES_KDF_DEFAUT, deriverCle, type ParametresKdf } from '../securite/kdf';

export const VERSION_ARCHIVE = 1;
const LONGUEUR_NONCE = 24;
const LONGUEUR_SEL = 16;

/**
 * Decodage UTF-8 sans dependance.
 *
 * `TextDecoder` n'est pas garanti dans le moteur JavaScript embarque, et une
 * sauvegarde illisible faute de decodeur serait un echec particulierement
 * mal venu : c'est precisement le moment ou l'on a tout perdu par ailleurs.
 */
export function texteDepuisOctets(octets: Uint8Array): string {
  let sortie = '';
  for (let i = 0; i < octets.length; ) {
    const premier = octets[i];
    let codePoint: number;
    let longueur: number;

    if (premier < 0x80) {
      codePoint = premier;
      longueur = 1;
    } else if (premier < 0xe0) {
      codePoint = premier & 0x1f;
      longueur = 2;
    } else if (premier < 0xf0) {
      codePoint = premier & 0x0f;
      longueur = 3;
    } else {
      codePoint = premier & 0x07;
      longueur = 4;
    }

    for (let j = 1; j < longueur; j++) {
      codePoint = (codePoint << 6) | (octets[i + j] & 0x3f);
    }
    sortie += String.fromCodePoint(codePoint);
    i += longueur;
  }
  return sortie;
}

export class ErreurArchive extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurArchive';
  }
}

export interface CoursSauvegarde {
  titreId: string;
  date: string;
  cloture: string;
}

/** Contenu en clair, tel qu'il est sérialisé avant chiffrement. */
export interface ContenuArchive {
  version: number;
  /** Date de production, au format ISO. */
  date: string;
  comptes: Compte[];
  titres: Titre[];
  transactions: Transaction[];
  cours: CoursSauvegarde[];
  parametres: Array<{ cle: string; valeur: string }>;
}

/**
 * Archive telle qu'elle est écrite sur le disque.
 *
 * L'en-tête est en clair — et c'est voulu. Il permet de savoir ce que
 * contient un fichier, et surtout de quand il date, sans avoir à le
 * déchiffrer. Retrouver trois sauvegardes anonymes et devoir toutes les
 * ouvrir pour identifier la bonne serait absurde.
 *
 * Il ne révèle rien de sensible : ni montant, ni valeur détenue, seulement
 * des comptages.
 */
export interface Archive {
  format: 'applibourse-sauvegarde';
  version: number;
  date: string;
  /** Comptages, pour reconnaître une archive sans l'ouvrir. */
  resume: {
    comptes: number;
    titres: number;
    transactions: number;
  };
  kdf: ParametresKdf;
  sel: string;
  nonce: string;
  /** Contenu chiffré, en hexadécimal. */
  charge: string;
  /** Empreinte du contenu en clair, vérifiée après déchiffrement. */
  empreinte: string;
}

/**
 * Les `Decimal` sont sérialisés en chaînes par leur `toJSON`, et doivent être
 * reconstruits à la lecture. Ces deux fonctions se répondent : toute
 * modification de l'une exige l'autre.
 */
function reconstruireDecimal(valeur: unknown): Decimal | undefined {
  return typeof valeur === 'string' && valeur !== '' ? Decimal.de(valeur) : undefined;
}

export function reconstruireTransaction(brut: Record<string, unknown>): Transaction {
  const base = {
    id: String(brut.id),
    compteId: String(brut.compteId),
    date: String(brut.date),
    devise: String(brut.devise),
    tauxChange: reconstruireDecimal(brut.tauxChange),
    note: brut.note === undefined ? undefined : String(brut.note),
  };

  const type = brut.type as Transaction['type'];
  switch (type) {
    case 'ACHAT':
    case 'VENTE':
      return {
        ...base,
        type,
        titreId: String(brut.titreId),
        quantite: reconstruireDecimal(brut.quantite)!,
        prixUnitaire: reconstruireDecimal(brut.prixUnitaire)!,
        frais: reconstruireDecimal(brut.frais) ?? Decimal.ZERO,
      };
    case 'DIVIDENDE':
      return {
        ...base,
        type,
        titreId: String(brut.titreId),
        montantNet: reconstruireDecimal(brut.montantNet)!,
        montantBrut: reconstruireDecimal(brut.montantBrut),
      };
    case 'VERSEMENT':
    case 'RETRAIT':
      return { ...base, type, montant: reconstruireDecimal(brut.montant)! };
    case 'FRAIS':
      return {
        ...base,
        type,
        montant: reconstruireDecimal(brut.montant)!,
        titreId: brut.titreId === undefined ? undefined : String(brut.titreId),
      };
    default:
      throw new ErreurArchive(`Type de transaction inconnu dans l’archive : ${String(type)}`);
  }
}

export interface OptionsExport {
  contenu: Omit<ContenuArchive, 'version' | 'date'>;
  motDePasse: string;
  date: string;
  kdf?: ParametresKdf;
  alea?: SourceAleatoire;
}

export function creerArchive(options: OptionsExport): Archive {
  if (options.motDePasse.length === 0) {
    throw new ErreurArchive('Un mot de passe est nécessaire pour chiffrer la sauvegarde.');
  }

  const alea = options.alea ?? aleatoireParDefaut;
  const parametres = options.kdf ?? PARAMETRES_KDF_DEFAUT;

  const contenu: ContenuArchive = {
    version: VERSION_ARCHIVE,
    date: options.date,
    ...options.contenu,
  };

  const clair = utf8ToBytes(JSON.stringify(contenu));
  const sel = alea(LONGUEUR_SEL);
  const nonce = alea(LONGUEUR_NONCE);
  const cle = deriverCle(options.motDePasse, sel, parametres);

  return {
    format: 'applibourse-sauvegarde',
    version: VERSION_ARCHIVE,
    date: options.date,
    resume: {
      comptes: contenu.comptes.length,
      titres: contenu.titres.length,
      transactions: contenu.transactions.length,
    },
    kdf: parametres,
    sel: bytesToHex(sel),
    nonce: bytesToHex(nonce),
    charge: bytesToHex(xchacha20poly1305(cle, nonce).encrypt(clair)),
    empreinte: bytesToHex(sha256(clair)),
  };
}

export type ResultatLecture =
  | { ouverte: true; contenu: ContenuArchive }
  | { ouverte: false; motif: string };

/**
 * Ouvre une archive.
 *
 * Ne lève pas sur un mot de passe faux : c'est un cas d'usage courant, pas une
 * anomalie. L'appelant reçoit un motif affichable.
 */
export function ouvrirArchive(archive: Archive, motDePasse: string): ResultatLecture {
  if (archive.format !== 'applibourse-sauvegarde') {
    return { ouverte: false, motif: 'Ce fichier n’est pas une sauvegarde AppliBourse.' };
  }
  if (archive.version > VERSION_ARCHIVE) {
    return {
      ouverte: false,
      motif: `Cette sauvegarde vient d’une version plus récente de l’application (format ${archive.version}). Mettez l’application à jour avant de la restaurer.`,
    };
  }

  let clair: Uint8Array;
  try {
    const cle = deriverCle(motDePasse, hexToBytes(archive.sel), archive.kdf);
    clair = xchacha20poly1305(cle, hexToBytes(archive.nonce)).decrypt(
      hexToBytes(archive.charge),
    );
  } catch {
    // Mot de passe faux et archive corrompue sont indiscernables ici : le
    // sceau Poly1305 échoue dans les deux cas, et c'est une bonne chose.
    return {
      ouverte: false,
      motif: 'Mot de passe incorrect, ou sauvegarde endommagée.',
    };
  }

  if (bytesToHex(sha256(clair)) !== archive.empreinte) {
    return { ouverte: false, motif: 'Sauvegarde endommagée : empreinte non conforme.' };
  }

  let brut: Record<string, unknown>;
  try {
    brut = JSON.parse(texteDepuisOctets(clair)) as Record<string, unknown>;
  } catch {
    return { ouverte: false, motif: 'Contenu de sauvegarde illisible.' };
  }

  try {
    return {
      ouverte: true,
      contenu: {
        version: Number(brut.version),
        date: String(brut.date),
        comptes: (brut.comptes ?? []) as Compte[],
        titres: (brut.titres ?? []) as Titre[],
        transactions: ((brut.transactions ?? []) as Array<Record<string, unknown>>).map(
          reconstruireTransaction,
        ),
        cours: (brut.cours ?? []) as CoursSauvegarde[],
        parametres: (brut.parametres ?? []) as Array<{ cle: string; valeur: string }>,
      },
    };
  } catch (erreur) {
    return {
      ouverte: false,
      motif: erreur instanceof Error ? erreur.message : 'Contenu de sauvegarde invalide.',
    };
  }
}

/** Résumé lisible d'une archive, sans la déchiffrer. */
export function decrireArchive(archive: Archive): string {
  const { resume } = archive;
  return `Sauvegarde du ${archive.date} — ${resume.comptes} compte(s), ${resume.titres} valeur(s), ${resume.transactions} opération(s).`;
}
