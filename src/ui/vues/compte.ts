/**
 * Création d'un compte.
 *
 * La date d'ouverture n'est pas un détail administratif : pour un PEA, c'est
 * elle qui fait courir l'antériorité fiscale, donc l'exonération d'impôt sur
 * le revenu au bout de cinq ans. Le formulaire l'exige et explique pourquoi.
 */

import type { Compte, TypeCompte } from '../../core/domain/types';
import { ErreurConversion, parseDate } from '../../core/import/valeurs';
import { estPEA } from '../../core/tax/pea';

export interface FormulaireCompte {
  nom: string;
  type: TypeCompte;
  /** Saisie libre au format JJ/MM/AAAA. */
  dateOuverture: string;
  devise: string;
}

export const FORMULAIRE_COMPTE_VIDE: FormulaireCompte = {
  nom: '',
  type: 'PEA',
  dateOuverture: '',
  devise: 'EUR',
};

export const LIBELLES_TYPE_COMPTE: Record<TypeCompte, string> = {
  PEA: 'PEA',
  PEA_PME: 'PEA-PME',
  CTO: 'Compte-titres',
};

export type ChampCompte = keyof FormulaireCompte;
export type ErreursCompte = Partial<Record<ChampCompte, string>>;

export interface ResultatCompte {
  compte?: Compte;
  erreurs: ErreursCompte;
}

/** Aide contextuelle sur la date, différente selon l'enveloppe. */
export function indicationDate(type: TypeCompte): string {
  return estPEA(type)
    ? "Date du premier versement : c'est elle qui fait courir les cinq ans d'antériorité fiscale."
    : "Date d'ouverture du compte.";
}

export function validerCompte(
  formulaire: FormulaireCompte,
  comptesExistants: readonly Compte[],
  genererId: () => string,
): ResultatCompte {
  const erreurs: ErreursCompte = {};

  const nom = formulaire.nom.trim();
  if (nom === '') {
    erreurs.nom = 'Champ obligatoire';
  } else if (
    comptesExistants.some(compte => compte.nom.toLowerCase() === nom.toLowerCase())
  ) {
    erreurs.nom = 'Un compte porte déjà ce nom';
  }

  let dateOuverture: string | undefined;
  try {
    dateOuverture = parseDate(formulaire.dateOuverture, 'JJ/MM/AAAA');
  } catch (erreur) {
    erreurs.dateOuverture =
      erreur instanceof ErreurConversion
        ? 'Date invalide (JJ/MM/AAAA)'
        : 'Date invalide';
  }

  const devise = formulaire.devise.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(devise)) {
    erreurs.devise = 'Code à trois lettres, par exemple EUR';
  }

  if (Object.keys(erreurs).length > 0) {
    return { erreurs };
  }

  return {
    erreurs: {},
    compte: {
      id: genererId(),
      nom,
      type: formulaire.type,
      dateOuverture: dateOuverture!,
      devise,
    },
  };
}
