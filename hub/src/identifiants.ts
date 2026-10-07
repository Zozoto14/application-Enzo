/**
 * Identifiants d'un ami, générés par l'administrateur.
 *
 * On ne réinvente rien : le compte d'un ami est un coffre ordinaire, créé par
 * le `initialiser` du coffre de l'hôte (dans le portefeuille :
 * `Session.initialiser`) exactement comme au premier lancement — même
 * Argon2id, même secret TOTP scellé par la clé maîtresse, mêmes codes de
 * récupération. La seule différence est que le mot de passe est tiré au
 * hasard au lieu d'être saisi, puis montré **une seule fois** à
 * l'administrateur, qui le transmet.
 *
 * La session est reverrouillée aussitôt : la clé maîtresse de l'ami ne reste
 * pas en mémoire dans la session de l'administrateur.
 */

import type { IdentifiantsAmi } from './types';

/** Source d'octets aléatoires cryptographiques, fournie par l'hôte. */
export type SourceAleatoire = (octets: number) => Uint8Array;

/**
 * Coffre vierge d'un profil, tel que l'hôte le fournit. La `Session` du
 * portefeuille respecte ce contrat sans adaptation.
 */
export interface CoffreInitialisable {
  statut(): string;
  initialiser(options: { motDePasse: string; compte: string }): {
    codesRecuperation: string[];
    secretTotp: string;
    uriTotp: string;
  };
  verrouiller(): void;
}

/** Sans caractères ambigus (0/O, 1/l/I) : le mot de passe se recopie à la main. */
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const GROUPES = 4;
const TAILLE_GROUPE = 5;

/**
 * Mot de passe aléatoire : 4 groupes de 5 caractères parmi 56, soit environ
 * 116 bits d'entropie — bien au-delà du minimum de 12 caractères exigé.
 * Tirage par rejet : aucun caractère n'est favorisé par le modulo.
 */
export function genererMotDePasse(alea: SourceAleatoire): string {
  const limite = 256 - (256 % ALPHABET.length);
  const caracteres: string[] = [];
  while (caracteres.length < GROUPES * TAILLE_GROUPE) {
    for (const octet of alea(32)) {
      if (octet < limite && caracteres.length < GROUPES * TAILLE_GROUPE) {
        caracteres.push(ALPHABET[octet % ALPHABET.length]);
      }
    }
  }
  const groupes: string[] = [];
  for (let i = 0; i < GROUPES; i++) {
    groupes.push(caracteres.slice(i * TAILLE_GROUPE, (i + 1) * TAILLE_GROUPE).join(''));
  }
  return groupes.join('-');
}

/**
 * Crée le coffre d'un ami dans une session vierge (ses propres fichiers) et
 * rend ses identifiants. La session est verrouillée à l'issue.
 */
export function creerAccesAmi(session: CoffreInitialisable, compte: string, alea: SourceAleatoire): IdentifiantsAmi {
  if (session.statut() !== 'non-initialise') {
    throw new Error('Ce profil a déjà un coffre : effacez-le avant d’en créer un nouveau.');
  }
  const motDePasse = genererMotDePasse(alea);
  const initialisation = session.initialiser({ motDePasse, compte });
  session.verrouiller();
  return {
    motDePasse,
    codesRecuperation: initialisation.codesRecuperation,
    secretTotp: initialisation.secretTotp,
    uriTotp: initialisation.uriTotp,
  };
}
