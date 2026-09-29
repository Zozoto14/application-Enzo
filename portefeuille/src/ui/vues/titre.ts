/**
 * Création d'une valeur.
 *
 * Nécessaire à la saisie manuelle : sans titre en base, impossible d'enregistrer
 * un achat sur une valeur que l'import n'a pas ramenée.
 *
 * L'ISIN est vérifié pour de bon, clé de contrôle comprise. Une faute de frappe
 * sur douze caractères passerait autrement inaperçue et créerait un doublon
 * silencieux de la même valeur.
 */

import type { Titre, TypeCompte } from '../../core/domain/types';

export interface FormulaireTitre {
  nom: string;
  isin: string;
  ticker: string;
  deviseCotation: string;
  secteur: string;
  zoneGeographique: string;
  eligiblePEA: boolean;
}

export const FORMULAIRE_TITRE_VIDE: FormulaireTitre = {
  nom: '',
  isin: '',
  ticker: '',
  deviseCotation: 'EUR',
  secteur: '',
  zoneGeographique: '',
  eligiblePEA: true,
};

export type ChampTitre = keyof FormulaireTitre;
export type ErreursTitre = Partial<Record<ChampTitre, string>>;

export interface ResultatTitre {
  titre?: Titre;
  erreurs: ErreursTitre;
}

const MOTIF_ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

/**
 * Vérifie la clé de contrôle d'un ISIN (norme ISO 6166).
 *
 * Chaque lettre est remplacée par sa position dans l'alphabet augmentée de 9
 * (A vaut 10, Z vaut 35), puis l'ensemble est soumis à l'algorithme de Luhn.
 * Une seule faute de frappe est ainsi détectée dans la quasi-totalité des cas.
 */
export function isinValide(isin: string): boolean {
  const normalise = isin.trim().toUpperCase();
  if (!MOTIF_ISIN.test(normalise)) {
    return false;
  }

  const chiffres = [...normalise]
    .map(caractere =>
      /[A-Z]/.test(caractere)
        ? String(caractere.charCodeAt(0) - 'A'.charCodeAt(0) + 10)
        : caractere,
    )
    .join('');

  let somme = 0;
  let doubler = true; // On part de la droite, le dernier chiffre est la clé.
  for (let i = chiffres.length - 2; i >= 0; i--) {
    let valeur = Number(chiffres[i]);
    if (doubler) {
      valeur *= 2;
      if (valeur > 9) {
        valeur -= 9;
      }
    }
    somme += valeur;
    doubler = !doubler;
  }

  const cle = (10 - (somme % 10)) % 10;
  return cle === Number(chiffres[chiffres.length - 1]);
}

/** Pays d'émission, lu sur les deux premières lettres de l'ISIN. */
export function paysDeLIsin(isin: string): string | undefined {
  const normalise = isin.trim().toUpperCase();
  return MOTIF_ISIN.test(normalise) ? normalise.slice(0, 2) : undefined;
}

export function validerTitre(
  formulaire: FormulaireTitre,
  titresExistants: readonly Titre[],
  genererId: () => string,
): ResultatTitre {
  const erreurs: ErreursTitre = {};

  const nom = formulaire.nom.trim();
  if (nom === '') {
    erreurs.nom = 'Champ obligatoire';
  }

  const isin = formulaire.isin.trim().toUpperCase();
  if (isin === '') {
    erreurs.isin = 'Champ obligatoire';
  } else if (!MOTIF_ISIN.test(isin)) {
    erreurs.isin = 'Format attendu : 2 lettres puis 10 caractères';
  } else if (!isinValide(isin)) {
    erreurs.isin = 'Clé de contrôle incorrecte : vérifiez la saisie';
  } else if (titresExistants.some(titre => titre.isin === isin)) {
    erreurs.isin = 'Cette valeur existe déjà';
  }

  const devise = formulaire.deviseCotation.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(devise)) {
    erreurs.deviseCotation = 'Code à trois lettres, par exemple EUR';
  }

  if (Object.keys(erreurs).length > 0) {
    return { erreurs };
  }

  return {
    erreurs: {},
    titre: {
      id: genererId(),
      isin,
      nom,
      ticker: formulaire.ticker.trim().toUpperCase() || isin.slice(0, 6),
      deviseCotation: devise,
      secteur: formulaire.secteur.trim() || undefined,
      zoneGeographique: formulaire.zoneGeographique.trim() || undefined,
      eligiblePEA: formulaire.eligiblePEA,
    },
  };
}

/** Vrai si ce titre peut être logé dans ce type de compte. */
export function compatibleAvec(titre: Titre, type: TypeCompte): boolean {
  return type === 'CTO' || titre.eligiblePEA;
}
