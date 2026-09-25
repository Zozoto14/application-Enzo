/**
 * Saisie d'une opération : validation et construction de la transaction.
 *
 * Tout est ici, en données pures. L'écran ne fait qu'afficher des champs et
 * des messages, ce qui permet de tester chaque règle de saisie — y compris les
 * refus — sans monter de rendu.
 *
 * Les erreurs sont rendues **par champ** plutôt qu'en une phrase globale : sur
 * un formulaire à sept champs, « saisie invalide » oblige à tout relire.
 */

import { Decimal } from '../../core/money/decimal';
import type {
  Compte,
  Position,
  Titre,
  Transaction,
  TypeTransaction,
} from '../../core/domain/types';
import { ErreurConversion, parseDate, parseNombre } from '../../core/import/valeurs';

export interface FormulaireOperation {
  type: TypeTransaction;
  compteId: string;
  titreId: string;
  /** Saisie libre au format JJ/MM/AAAA. */
  date: string;
  quantite: string;
  prixUnitaire: string;
  frais: string;
  montant: string;
  note: string;
}

export const FORMULAIRE_VIDE: FormulaireOperation = {
  type: 'ACHAT',
  compteId: '',
  titreId: '',
  date: '',
  quantite: '',
  prixUnitaire: '',
  frais: '',
  montant: '',
  note: '',
};

export type ChampOperation = keyof FormulaireOperation;

export const LIBELLES_TYPE: Record<TypeTransaction, string> = {
  ACHAT: 'Achat',
  VENTE: 'Vente',
  DIVIDENDE: 'Dividende',
  VERSEMENT: 'Versement',
  RETRAIT: 'Retrait',
  FRAIS: 'Frais',
};

const CHAMPS_PAR_TYPE: Record<TypeTransaction, ChampOperation[]> = {
  ACHAT: ['titreId', 'quantite', 'prixUnitaire', 'frais'],
  VENTE: ['titreId', 'quantite', 'prixUnitaire', 'frais'],
  DIVIDENDE: ['titreId', 'montant'],
  VERSEMENT: ['montant'],
  RETRAIT: ['montant'],
  FRAIS: ['montant'],
};

/** Champs à afficher pour un type donné, en plus du compte et de la date. */
export function champsVisibles(type: TypeTransaction): ChampOperation[] {
  return CHAMPS_PAR_TYPE[type];
}

export interface ContexteSaisie {
  comptes: readonly Compte[];
  titres: readonly Titre[];
  /** Positions ouvertes, pour refuser une vente à découvert. */
  positions: readonly Position[];
  genererId(): string;
}

export type ErreursSaisie = Partial<Record<ChampOperation, string>>;

export interface ResultatSaisie {
  transaction?: Transaction;
  erreurs: ErreursSaisie;
}

function lireMontant(
  texte: string,
  champ: ChampOperation,
  erreurs: ErreursSaisie,
  { obligatoire = true, strictementPositif = true } = {},
): Decimal | undefined {
  const brut = texte.trim();
  if (brut === '') {
    if (obligatoire) {
      erreurs[champ] = 'Champ obligatoire';
    }
    return obligatoire ? undefined : Decimal.ZERO;
  }
  try {
    const valeur = parseNombre(brut, 'FR');
    if (valeur.estNegatif()) {
      erreurs[champ] = 'La valeur ne peut pas être négative';
      return undefined;
    }
    if (strictementPositif && valeur.estZero()) {
      erreurs[champ] = 'La valeur doit être supérieure à zéro';
      return undefined;
    }
    return valeur;
  } catch {
    erreurs[champ] = 'Nombre illisible';
    return undefined;
  }
}

export function validerOperation(
  formulaire: FormulaireOperation,
  contexte: ContexteSaisie,
): ResultatSaisie {
  const erreurs: ErreursSaisie = {};
  const { type } = formulaire;
  const visibles = new Set(champsVisibles(type));

  const compte = contexte.comptes.find(c => c.id === formulaire.compteId);
  if (!compte) {
    erreurs.compteId = 'Choisissez un compte';
  }

  let date: string | undefined;
  try {
    date = parseDate(formulaire.date, 'JJ/MM/AAAA');
  } catch (erreur) {
    erreurs.date =
      erreur instanceof ErreurConversion ? 'Date invalide (JJ/MM/AAAA)' : 'Date invalide';
  }

  let titre: Titre | undefined;
  if (visibles.has('titreId')) {
    titre = contexte.titres.find(t => t.id === formulaire.titreId);
    if (!titre) {
      erreurs.titreId = 'Choisissez une valeur';
    } else if (compte && titre.eligiblePEA === false && compte.type !== 'CTO') {
      // Refus utile : un titre non éligible logé dans un PEA expose à la
      // clôture du plan, bien plus coûteuse qu'une saisie corrigée.
      erreurs.titreId = `${titre.nom} n'est pas éligible au PEA`;
    }
  }

  const quantite = visibles.has('quantite')
    ? lireMontant(formulaire.quantite, 'quantite', erreurs)
    : undefined;
  const prixUnitaire = visibles.has('prixUnitaire')
    ? lireMontant(formulaire.prixUnitaire, 'prixUnitaire', erreurs)
    : undefined;
  const frais = visibles.has('frais')
    ? lireMontant(formulaire.frais, 'frais', erreurs, {
        obligatoire: false,
        strictementPositif: false,
      })
    : undefined;
  const montant = visibles.has('montant')
    ? lireMontant(formulaire.montant, 'montant', erreurs)
    : undefined;

  if (type === 'VENTE' && quantite && titre && compte) {
    const position = contexte.positions.find(
      p => p.compteId === compte.id && p.titreId === titre!.id,
    );
    const detenue = position?.quantite ?? Decimal.ZERO;
    if (quantite.gt(detenue)) {
      erreurs.quantite = `Vous détenez ${detenue.toString()} titre(s) sur ce compte`;
    }
  }

  if (Object.keys(erreurs).length > 0) {
    return { erreurs };
  }

  const base = {
    id: contexte.genererId(),
    compteId: compte!.id,
    date: date!,
    devise: compte!.devise,
    note: formulaire.note.trim() || undefined,
  };

  switch (type) {
    case 'ACHAT':
    case 'VENTE':
      return {
        erreurs: {},
        transaction: {
          ...base,
          type,
          titreId: titre!.id,
          quantite: quantite!,
          prixUnitaire: prixUnitaire!,
          frais: frais ?? Decimal.ZERO,
        },
      };
    case 'DIVIDENDE':
      return {
        erreurs: {},
        transaction: { ...base, type, titreId: titre!.id, montantNet: montant! },
      };
    default:
      return { erreurs: {}, transaction: { ...base, type, montant: montant! } };
  }
}

/** Aperçu chiffré de l'opération, affiché avant validation. */
export function resumeOperation(
  formulaire: FormulaireOperation,
): { total: Decimal; libelle: string } | undefined {
  if (formulaire.type !== 'ACHAT' && formulaire.type !== 'VENTE') {
    return undefined;
  }
  try {
    const quantite = parseNombre(formulaire.quantite || '0', 'FR');
    const prix = parseNombre(formulaire.prixUnitaire || '0', 'FR');
    const frais = parseNombre(formulaire.frais || '0', 'FR');
    if (!quantite.estPositif() || !prix.estPositif()) {
      return undefined;
    }
    const brut = quantite.mul(prix);
    return formulaire.type === 'ACHAT'
      ? { total: brut.add(frais), libelle: 'Montant débité' }
      : { total: brut.sub(frais), libelle: 'Montant crédité' };
  } catch {
    return undefined;
  }
}
