/* eslint-disable no-bitwise -- le generateur deterministe de test manipule des bits par construction. */
/**
 * Source d'aléa.
 *
 * Injectable partout où elle sert, pour deux raisons : les tests ont besoin
 * d'un aléa reproductible, et l'application d'un générateur réellement
 * cryptographique.
 *
 * `randomBytes` de @noble/hashes s'appuie sur `crypto.getRandomValues`. Ce
 * dernier existe nativement dans Node, mais **pas dans le moteur JavaScript de
 * React Native** : côté application, il faudra installer le polyfill
 * `react-native-get-random-values` et l'importer au tout premier point d'entrée
 * du bundle, avant tout autre import. Sans lui, la génération de clés échoue —
 * bruyamment, ce qui vaut mieux qu'un aléa silencieusement prévisible.
 */

import { randomBytes } from '@noble/hashes/utils.js';

export type SourceAleatoire = (octets: number) => Uint8Array;

export const aleatoireParDefaut: SourceAleatoire = octets => randomBytes(octets);

/**
 * Générateur déterministe, **réservé aux tests**.
 * Produit une suite reproductible à partir d'une graine, pour vérifier des
 * scénarios de chiffrement sans dépendre du hasard.
 */
export function aleatoireDeterministe(graine = 1): SourceAleatoire {
  let etat = graine >>> 0;
  return (octets: number) => {
    const sortie = new Uint8Array(octets);
    for (let i = 0; i < octets; i++) {
      // Générateur congruentiel linéaire : sans aucune valeur cryptographique,
      // uniquement là pour rendre les tests reproductibles.
      etat = (etat * 1664525 + 1013904223) >>> 0;
      sortie[i] = (etat >>> 24) & 255;
    }
    return sortie;
  };
}
