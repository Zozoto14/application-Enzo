/**
 * Identité de l'appareil, et génération d'identifiants qui survivent à la
 * synchronisation.
 *
 * Le défaut que ce module corrige : jusqu'ici, un identifiant de transaction
 * valait `op-<horodatage en millisecondes>`. Sur un seul appareil, cela suffit.
 * Dès qu'un iPhone et un iPad tiennent le même portefeuille, deux opérations
 * **différentes** saisies dans la même milliseconde portent le même
 * identifiant — et une fusion, qui reconnaît les doublons par l'identifiant,
 * en supprimerait une silencieusement.
 *
 * La correction tient en un préfixe : chaque appareil tire une fois un
 * identifiant aléatoire, le conserve, et le place dans tout ce qu'il crée. Deux
 * appareils ne peuvent alors plus produire le même identifiant, et la fusion
 * de deux journaux devient une simple union.
 *
 * L'identifiant d'appareil n'est ni un identifiant matériel ni un numéro de
 * série : c'est un tirage aléatoire, sans lien avec le téléphone, qui ne quitte
 * la base chiffrée que dans les archives que vous synchronisez vous-même.
 */

import { aleatoireParDefaut, type SourceAleatoire } from '../securite/aleatoire';

/** Longueur de l'identifiant d'appareil, en caractères hexadécimaux. */
export const LONGUEUR_IDENTIFIANT_APPAREIL = 8;

const HEXA = '0123456789abcdef';

function hexa(octets: Uint8Array): string {
  let sortie = '';
  for (const octet of octets) {
    sortie += HEXA[(octet >> 4) & 0xf] + HEXA[octet & 0xf];
  }
  return sortie;
}

/** Tire un identifiant d'appareil. Appelé une seule fois par installation. */
export function tirerIdentifiantAppareil(
  aleatoire: SourceAleatoire = aleatoireParDefaut,
): string {
  return hexa(aleatoire(LONGUEUR_IDENTIFIANT_APPAREIL / 2));
}

const MOTIF_APPAREIL = /^[0-9a-f]{8}$/;

export function identifiantAppareilValide(valeur: string): boolean {
  return MOTIF_APPAREIL.test(valeur);
}

export interface DepotIdentiteAppareil {
  lire(cle: string): string | undefined;
  ecrire(cle: string, valeur: string): void;
}

/**
 * Identifiant de cet appareil, tiré au premier appel puis mémorisé.
 *
 * Un identifiant enregistré mais illisible est retiré : mieux vaut un nouvel
 * appareil aux yeux de la fusion qu'un préfixe qui ne garantit plus rien.
 */
export function identifiantAppareil(
  depot: DepotIdentiteAppareil,
  cle: string,
  aleatoire: SourceAleatoire = aleatoireParDefaut,
): string {
  const memorise = depot.lire(cle);
  if (memorise && identifiantAppareilValide(memorise)) {
    return memorise;
  }

  const nouveau = tirerIdentifiantAppareil(aleatoire);
  depot.ecrire(cle, nouveau);
  return nouveau;
}

/**
 * Générateur d'identifiants d'entités, uniques entre appareils.
 *
 * Forme : `<préfixe>-<appareil>-<instant en base 36>-<compteur>`. Le compteur
 * lève l'ambiguïté des créations dans la même milliseconde sur un même
 * appareil — saisir trois opérations d'affilée est plus rapide que l'horloge.
 */
export function creerGenerateurId(
  appareil: string,
  maintenant: () => number = Date.now,
): (prefixe: string) => string {
  let dernierInstant = -1;
  let compteur = 0;

  return (prefixe: string) => {
    const instant = maintenant();
    if (instant === dernierInstant) {
      compteur++;
    } else {
      dernierInstant = instant;
      compteur = 0;
    }
    return `${prefixe}-${appareil}-${instant.toString(36)}-${compteur}`;
  };
}

/**
 * Appareil d'origine d'un identifiant, quand il en porte un.
 *
 * Sert au diagnostic après une fusion : savoir d'où vient une opération
 * qu'on ne reconnaît pas vaut mieux que de la supprimer par précaution.
 */
export function appareilDe(identifiant: string): string | undefined {
  const parties = identifiant.split('-');
  const candidat = parties[1];
  return candidat && identifiantAppareilValide(candidat) ? candidat : undefined;
}
