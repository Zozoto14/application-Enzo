/**
 * Sauvegarde chiffrée des données de l'Administration (Fondateurs) : réglages,
 * modèle d'invitation, contacts (adresses e-mail), notes privées, journal,
 * abonnements et prospects.
 *
 * Le fichier est scellé par une **phrase de sauvegarde** choisie au moment de
 * l'export (Argon2id → clé de 32 octets → XChaCha20-Poly1305, mêmes briques
 * que le coffre) : sans elle, il est illisible. Rien n'est envoyé nulle part,
 * le fichier est enregistré là où le Fondateur le choisit. Aucun secret
 * d'accès n'y figure (ni mot de passe, ni clé, ni code de séquestre).
 */

import { utf8ToBytes } from '@noble/hashes/utils.js';
import { aleatoireParDefaut, type SourceAleatoire } from '../../securite/aleatoire';
import { deriverCle, PARAMETRES_KDF_DEFAUT, type ParametresKdf } from '../../securite/kdf';
import { descellerOctets, scellerOctets } from '../../securite/scelle';
import { utf8DepuisOctets } from '../../securite/sequestre';
import { depuisBase64, versBase64 } from '../../sync/relais/chiffrement';
import { ecrireDonnees, lireDonnees, type DonneesAdmin } from './donnees';
import { exiger } from './roles';
import type { Profil } from '../../profils/profils';

export const FORMAT_SAUVEGARDE = 'appdashboard-administration';
export const VERSION_SAUVEGARDE = 1;
export const LONGUEUR_MIN_PHRASE = 12;

export class ErreurSauvegarde extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurSauvegarde';
  }
}

type Acteur = Pick<Profil, 'id' | 'admin' | 'role'>;

function lireKdf(brut: unknown): ParametresKdf | undefined {
  if (!brut || typeof brut !== 'object') return undefined;
  const o = brut as Record<string, unknown>;
  const entier = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
  if (o.algorithme !== 'argon2id' || !entier(o.passes, 1, 10) || !entier(o.memoireKio, 8, 1_048_576) || !entier(o.fils, 1, 16) || o.longueurCle !== 32) return undefined;
  return { algorithme: 'argon2id', passes: o.passes as number, memoireKio: o.memoireKio as number, fils: o.fils as number, longueurCle: 32 };
}

/** Problème de la phrase choisie, ou undefined si elle convient. */
export function erreurPhrase(phrase: string, confirmation?: string): string | undefined {
  if (phrase.length < LONGUEUR_MIN_PHRASE) return `Phrase de sauvegarde : ${LONGUEUR_MIN_PHRASE} caractères au moins.`;
  if (confirmation !== undefined && confirmation !== phrase) return 'Les deux phrases ne sont pas identiques.';
  return undefined;
}

/** Fichier de sauvegarde (texte JSON), scellé par la phrase. */
export function exporterSauvegarde(donnees: DonneesAdmin, phrase: string, maintenant: number, alea: SourceAleatoire = aleatoireParDefaut, kdf: ParametresKdf = PARAMETRES_KDF_DEFAUT): string {
  const erreur = erreurPhrase(phrase);
  if (erreur) throw new ErreurSauvegarde(erreur);
  const sel = alea(16);
  const cle = deriverCle(phrase, sel, kdf);
  try {
    const charge = scellerOctets(cle, utf8ToBytes(ecrireDonnees(donnees)), alea);
    return JSON.stringify({ format: FORMAT_SAUVEGARDE, version: VERSION_SAUVEGARDE, creeLe: new Date(maintenant).toISOString(), kdf, sel: versBase64(sel), charge: versBase64(charge) }, null, 1);
  } finally {
    cle.fill(0);
  }
}

/** Relit une sauvegarde ; lève une erreur claire (fichier illisible, phrase incorrecte). */
export function importerSauvegarde(texte: string, phrase: string): DonneesAdmin {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(texte) as Record<string, unknown>;
  } catch {
    throw new ErreurSauvegarde('Ce fichier n’est pas une sauvegarde de l’Administration.');
  }
  if (!o || o.format !== FORMAT_SAUVEGARDE || typeof o.sel !== 'string' || typeof o.charge !== 'string') {
    throw new ErreurSauvegarde('Ce fichier n’est pas une sauvegarde de l’Administration.');
  }
  if (typeof o.version !== 'number' || o.version > VERSION_SAUVEGARDE) {
    throw new ErreurSauvegarde('Sauvegarde faite par une version plus récente : mettez l’application à jour.');
  }
  const kdf = lireKdf(o.kdf);
  if (!kdf) throw new ErreurSauvegarde('Paramètres de chiffrement illisibles.');
  if (!phrase) throw new ErreurSauvegarde('Saisissez la phrase de sauvegarde.');
  const cle = deriverCle(phrase, depuisBase64(o.sel), kdf);
  try {
    return lireDonnees(utf8DepuisOctets(descellerOctets(cle, depuisBase64(o.charge))));
  } catch {
    throw new ErreurSauvegarde('Phrase de sauvegarde incorrecte, ou fichier abîmé.');
  } finally {
    cle.fill(0);
  }
}

export function exporterSauvegardePar(acteur: Acteur | undefined, donnees: DonneesAdmin, phrase: string, maintenant: number, alea?: SourceAleatoire, kdf?: ParametresKdf): string {
  exiger(acteur, 'sauvegarde-admin');
  return exporterSauvegarde(donnees, phrase, maintenant, alea, kdf);
}

export function importerSauvegardePar(acteur: Acteur | undefined, texte: string, phrase: string): DonneesAdmin {
  exiger(acteur, 'sauvegarde-admin');
  return importerSauvegarde(texte, phrase);
}
