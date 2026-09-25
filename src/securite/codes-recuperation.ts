/**
 * Codes de récupération.
 *
 * Générés une seule fois, à la création du coffre, et destinés à être notés
 * hors ligne. Chacun ouvre la base une fois, puis est consommé.
 *
 * 80 bits d'entropie par code : hors de portée d'une recherche exhaustive,
 * même si le coffre tombe entre de mauvaises mains. Ils sont formatés en
 * quatre groupes de quatre caractères pour être recopiables sans erreur, dans
 * un alphabet qui exclut I, L, O et U.
 */

import type { SourceAleatoire } from './aleatoire';
import { normaliserCrockford, versCrockford } from './encodage';

/** 10 octets = 80 bits = 16 caractères en base32. */
const OCTETS_PAR_CODE = 10;
const TAILLE_GROUPE = 4;

export function genererCodeRecuperation(alea: SourceAleatoire): string {
  const brut = versCrockford(alea(OCTETS_PAR_CODE));
  const groupes = brut.match(new RegExp(`.{1,${TAILLE_GROUPE}}`, 'g')) ?? [brut];
  return groupes.join('-');
}

/**
 * Normalise un code saisi à la main avant comparaison.
 * Les tirets, les espaces, la casse et les confusions de lecture usuelles
 * (O pour 0, I ou L pour 1, U pour V) sont absorbés ici : sur un code recopié
 * d'une feuille de papier des mois plus tard, c'est ce qui fait la différence
 * entre récupérer ses données et les perdre.
 */
export function normaliserCode(code: string): string {
  return normaliserCrockford(code);
}

/** Vrai si le code a la forme attendue, sans rien dire de sa validité. */
export function formatValide(code: string): boolean {
  const normalise = normaliserCode(code);
  return (
    normalise.length === (OCTETS_PAR_CODE * 8) / 5 &&
    /^[0-9A-Z]+$/.test(normalise)
  );
}
