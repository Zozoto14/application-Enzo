/**
 * Dérivation de clé à partir du mot de passe.
 *
 * Argon2id, seul algorithme de la famille recommandé par l'OWASP pour un
 * nouveau projet : il résiste à la fois aux attaques par GPU (coût mémoire) et
 * aux attaques par canal auxiliaire. PBKDF2, qui ne coûte que du calcul, se
 * casse bien plus vite sur du matériel dédié.
 *
 * Paramètres par défaut : ceux du minimum OWASP (19 MiB, 2 passes, 1 fil),
 * mesurés à ~160 ms sur PC. Sur un iPhone en JavaScript pur, compter plutôt
 * une seconde — acceptable pour un déverrouillage, qui n'arrive qu'à
 * l'ouverture de l'application. Les augmenter renforce la protection mais
 * allonge d'autant cette attente.
 *
 * Les paramètres sont stockés à côté de chaque enveloppe plutôt que figés dans
 * le code : une base créée aujourd'hui doit rester ouvrable après qu'on les
 * aura durcis, sinon le durcissement enferme les données dehors.
 */

import { argon2id } from '@noble/hashes/argon2.js';

export interface ParametresKdf {
  algorithme: 'argon2id';
  /** Nombre de passes. */
  passes: number;
  /** Coût mémoire, en kibioctets. */
  memoireKio: number;
  /** Degré de parallélisme. */
  fils: number;
  /** Longueur de la clé produite, en octets. */
  longueurCle: number;
}

export const PARAMETRES_KDF_DEFAUT: ParametresKdf = {
  algorithme: 'argon2id',
  passes: 2,
  memoireKio: 19456,
  fils: 1,
  longueurCle: 32,
};

export class ErreurKdf extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurKdf';
  }
}

/** Longueur minimale du sel, en octets. */
export const LONGUEUR_SEL = 16;

export function deriverCle(
  secret: string,
  sel: Uint8Array,
  parametres: ParametresKdf = PARAMETRES_KDF_DEFAUT,
): Uint8Array {
  if (parametres.algorithme !== 'argon2id') {
    throw new ErreurKdf(`Algorithme de dérivation inconnu : ${parametres.algorithme}`);
  }
  if (sel.length < LONGUEUR_SEL) {
    throw new ErreurKdf(
      `Sel trop court : ${sel.length} octets, ${LONGUEUR_SEL} attendus au minimum`,
    );
  }
  if (secret.length === 0) {
    throw new ErreurKdf('Secret vide');
  }

  return argon2id(secret, sel, {
    t: parametres.passes,
    m: parametres.memoireKio,
    p: parametres.fils,
    dkLen: parametres.longueurCle,
  });
}
