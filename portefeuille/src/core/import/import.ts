/**
 * Transformation d'un relevé CSV en transactions du domaine.
 *
 * Principe directeur : une ligne illisible ne fait jamais échouer l'import
 * entier. Elle est écartée et rapportée, pour être corrigée à la main dans
 * l'écran d'import. Sur un relevé de plusieurs centaines de lignes, tout
 * rejeter parce qu'une cellule est vide rendrait la fonction inutilisable.
 *
 * Les montants sont pris en valeur absolue : c'est le type d'opération qui
 * porte le sens, pas le signe. Un relevé qui note un achat « -1 005,00 » et un
 * autre « 1 005,00 » produisent donc la même transaction.
 */

import { Decimal } from '../money/decimal';
import type { Transaction, TypeTransaction } from '../domain/types';
import { lireCsv } from './csv';
import {
  ErreurConversion,
  normaliser,
  parseDate,
  parseNombre,
  type FormatDate,
  type FormatNombre,
} from './valeurs';

export interface ColonnesModele {
  date: string;
  /**
   * Colonne portant le sens de l'opération (achat, vente, dividende...).
   * Absente des relevés de mouvements espèces, qui n'ont qu'un libellé libre :
   * le type se déduit alors de `reglesLibelle`.
   */
  operation?: string;
  libelle?: string;
  isin?: string;
  ticker?: string;
  quantite?: string;
  prixUnitaire?: string;
  montant?: string;
  /**
   * Colonne de frais, ou plusieurs colonnes à additionner.
   *
   * BoursoBank sépare la commission de courtage de la taxe sur les
   * transactions financières, sur deux lignes distinctes de l'avis d'opéré.
   * N'en retenir qu'une sous-estimerait le prix de revient sur toute valeur
   * soumise à la TTF, et donc surestimerait la plus-value.
   */
  frais?: string | string[];
  devise?: string;
  /**
   * Montants répartis sur deux colonnes de sens opposés, comme sur un relevé
   * de compte. `debit` sort de l'argent, `credit` en fait entrer. Alternative
   * à `montant` : une seule des deux cellules est renseignée par ligne.
   */
  debit?: string;
  credit?: string;
}

/** Sens d'un mouvement sur un relevé à deux colonnes. */
export type SensMouvement = 'debit' | 'credit';

export interface RegleLibelle {
  /** Expression régulière appliquée au libellé normalisé (sans accent, en minuscules). */
  motif: string;
  /**
   * Type à retenir. Un libellé ambigu — « virement » peut aller dans les deux
   * sens — se résout par le sens du mouvement.
   */
  type: TypeTransaction | Record<SensMouvement, TypeTransaction>;
}

export interface ModeleImport {
  id: string;
  libelle: string;
  /** Vrai tant que le modèle n'a pas été confronté à un export réel. */
  provisoire?: boolean;
  delimiteur?: string;
  lignesIgnorees?: number;
  formatDate: FormatDate;
  formatNombre: FormatNombre;
  colonnes: ColonnesModele;
  /** Libellé d'opération tel qu'écrit dans le relevé -> type de transaction. */
  operations: Record<string, TypeTransaction>;
  /**
   * Règles de repli, appliquées dans l'ordre au libellé libre quand aucune
   * colonne d'opération ne donne le type. La première qui correspond gagne,
   * donc les motifs les plus spécifiques se placent en tête.
   */
  reglesLibelle?: RegleLibelle[];
}

export interface IndicesTitre {
  isin?: string;
  ticker?: string;
  libelle?: string;
}

export interface ContexteImport {
  compteId: string;
  /** Devise du compte, utilisée quand le relevé n'en précise aucune. */
  deviseParDefaut: string;
  /** Rattache une ligne à un titre connu. `undefined` si le titre est inconnu. */
  resoudreTitre(indices: IndicesTitre): string | undefined;
  /** Permet d'injecter des identifiants déterministes dans les tests. */
  genererId?(numeroLigne: number): string;
}

export interface AnomalieImport {
  /** Numéro de ligne dans le fichier d'origine. */
  ligne: number;
  message: string;
  brut: string;
}

export interface ResultatImport {
  transactions: Transaction[];
  anomalies: AnomalieImport[];
  /** Colonnes déclarées par le modèle mais absentes du fichier. */
  colonnesManquantes: string[];
  /** Nombre de lignes de données examinées. */
  lignesLues: number;
}

const TYPES_AVEC_TITRE: ReadonlySet<TypeTransaction> = new Set<TypeTransaction>([
  'ACHAT',
  'VENTE',
  'DIVIDENDE',
]);

function valeur(champs: Record<string, string>, colonne?: string): string {
  if (!colonne) {
    return '';
  }
  return (champs[colonne] ?? '').trim();
}

/** Somme des colonnes de frais déclarées par le modèle. */
function sommeFrais(
  champs: Record<string, string>,
  colonnes: string | string[] | undefined,
  format: FormatNombre,
): Decimal {
  if (!colonnes) {
    return Decimal.ZERO;
  }
  const liste = Array.isArray(colonnes) ? colonnes : [colonnes];
  return liste.reduce(
    (total, colonne) => total.add(parseNombre(valeur(champs, colonne), format).abs()),
    Decimal.ZERO,
  );
}

/**
 * Colonnes indispensables au fonctionnement du modèle.
 * Sans colonne d'opération, c'est le libellé qui porte le type : il devient
 * alors obligatoire.
 */
function colonnesRequises(modele: ModeleImport): string[] {
  const { colonnes } = modele;
  const requises = [colonnes.date];
  if (colonnes.operation) {
    requises.push(colonnes.operation);
  } else if (colonnes.libelle) {
    requises.push(colonnes.libelle);
  }
  return requises;
}

/**
 * Montant de la ligne et sens du mouvement.
 * Une colonne `montant` unique ne dit rien du sens ; deux colonnes opposées le
 * disent, ce qui permet de lever l'ambiguïté d'un libellé comme « virement ».
 */
function montantDeLaLigne(
  champs: Record<string, string>,
  colonnes: ColonnesModele,
  format: FormatNombre,
): { montant: Decimal; sens?: SensMouvement } {
  if (colonnes.montant && valeur(champs, colonnes.montant)) {
    return { montant: parseNombre(valeur(champs, colonnes.montant), format).abs() };
  }
  if (colonnes.debit && valeur(champs, colonnes.debit)) {
    return {
      montant: parseNombre(valeur(champs, colonnes.debit), format).abs(),
      sens: 'debit',
    };
  }
  if (colonnes.credit && valeur(champs, colonnes.credit)) {
    return {
      montant: parseNombre(valeur(champs, colonnes.credit), format).abs(),
      sens: 'credit',
    };
  }
  return { montant: Decimal.ZERO };
}

/** Détermine le type de transaction, par colonne dédiée ou par libellé. */
function resoudreType(
  champs: Record<string, string>,
  modele: ModeleImport,
  operations: ReadonlyMap<string, TypeTransaction>,
  sens: SensMouvement | undefined,
): TypeTransaction {
  const { colonnes } = modele;

  if (colonnes.operation) {
    const brut = valeur(champs, colonnes.operation);
    const type = operations.get(normaliser(brut));
    if (type) {
      return type;
    }
    throw new ErreurConversion(
      `Opération non reconnue : "${brut}". Ajoutez-la au modèle d'import pour la prendre en compte.`,
    );
  }

  const libelle = normaliser(valeur(champs, colonnes.libelle));
  for (const regle of modele.reglesLibelle ?? []) {
    if (!new RegExp(regle.motif).test(libelle)) {
      continue;
    }
    if (typeof regle.type === 'string') {
      return regle.type;
    }
    if (!sens) {
      throw new ErreurConversion(
        `Libellé "${libelle}" ambigu : ni débit ni crédit renseigné, impossible de trancher le sens.`,
      );
    }
    return regle.type[sens];
  }

  throw new ErreurConversion(
    `Libellé non reconnu : "${libelle}". Aucune règle du modèle d'import ne lui correspond.`,
  );
}

export function importerCsv(
  contenu: string,
  modele: ModeleImport,
  contexte: ContexteImport,
): ResultatImport {
  const fichier = lireCsv(contenu, {
    delimiteur: modele.delimiteur,
    lignesIgnorees: modele.lignesIgnorees,
  });

  const colonnesManquantes = colonnesRequises(modele).filter(
    colonne => !fichier.entetes.includes(colonne),
  );
  if (colonnesManquantes.length > 0) {
    return {
      transactions: [],
      anomalies: [],
      colonnesManquantes,
      lignesLues: fichier.lignes.length,
    };
  }

  const operations = new Map(
    Object.entries(modele.operations).map(([libelle, type]) => [
      normaliser(libelle),
      type,
    ]),
  );

  const transactions: Transaction[] = [];
  const anomalies: AnomalieImport[] = [];

  for (const ligne of fichier.lignes) {
    try {
      const transaction = convertir(ligne.champs, ligne.numero, modele, operations, contexte);
      transactions.push(transaction);
    } catch (erreur) {
      anomalies.push({
        ligne: ligne.numero,
        message: erreur instanceof Error ? erreur.message : String(erreur),
        brut: ligne.brut,
      });
    }
  }

  return {
    transactions,
    anomalies,
    colonnesManquantes: [],
    lignesLues: fichier.lignes.length,
  };
}

function convertir(
  champs: Record<string, string>,
  numero: number,
  modele: ModeleImport,
  operations: ReadonlyMap<string, TypeTransaction>,
  contexte: ContexteImport,
): Transaction {
  const { colonnes } = modele;

  const { montant: montantLigne, sens } = montantDeLaLigne(
    champs,
    colonnes,
    modele.formatNombre,
  );
  const type = resoudreType(champs, modele, operations, sens);

  const date = parseDate(valeur(champs, colonnes.date), modele.formatDate);
  const nombre = (colonne?: string): Decimal =>
    parseNombre(valeur(champs, colonne), modele.formatNombre);

  const id = contexte.genererId?.(numero) ?? `csv-${numero}`;
  const base = {
    id,
    compteId: contexte.compteId,
    date,
    devise: valeur(champs, colonnes.devise) || contexte.deviseParDefaut,
    note: valeur(champs, colonnes.libelle) || undefined,
  };

  let titreId: string | undefined;
  if (TYPES_AVEC_TITRE.has(type)) {
    titreId = contexte.resoudreTitre({
      isin: valeur(champs, colonnes.isin) || undefined,
      ticker: valeur(champs, colonnes.ticker) || undefined,
      libelle: valeur(champs, colonnes.libelle) || undefined,
    });
    if (!titreId) {
      const indice =
        valeur(champs, colonnes.isin) ||
        valeur(champs, colonnes.ticker) ||
        valeur(champs, colonnes.libelle) ||
        '(aucun identifiant)';
      throw new ErreurConversion(
        `Titre inconnu : ${indice}. Créez-le ou associez-le avant de réimporter cette ligne.`,
      );
    }
  }

  switch (type) {
    case 'ACHAT':
    case 'VENTE': {
      const quantite = nombre(colonnes.quantite).abs();
      if (!quantite.estPositif()) {
        // Un relevé de mouvements espèces ne porte aucune quantité : le cas
        // mérite mieux qu'un « champ manquant », qui laisserait croire à une
        // erreur de saisie alors que l'information n'existe pas dans le fichier.
        throw new ErreurConversion(
          colonnes.quantite
            ? 'Quantité absente ou nulle'
            : 'Ce relevé ne contient pas les quantités : saisissez cet achat ou cette vente depuis son avis d’opéré.',
        );
      }
      const frais = sommeFrais(champs, colonnes.frais, modele.formatNombre);

      // Le prix unitaire est repris tel quel s'il figure au relevé. Sinon il est
      // déduit du montant, supposé alors brut de frais.
      const prixColonne = valeur(champs, colonnes.prixUnitaire);
      const prixUnitaire = prixColonne
        ? parseNombre(prixColonne, modele.formatNombre).abs()
        : montantLigne.div(quantite);

      if (!prixUnitaire.estPositif()) {
        throw new ErreurConversion('Prix unitaire absent ou nul');
      }

      return { ...base, type, titreId: titreId!, quantite, prixUnitaire, frais };
    }

    case 'DIVIDENDE': {
      const montantNet = montantLigne;
      if (!montantNet.estPositif()) {
        throw new ErreurConversion('Montant du dividende absent ou nul');
      }
      return { ...base, type, titreId: titreId!, montantNet };
    }

    case 'VERSEMENT':
    case 'RETRAIT':
    case 'FRAIS': {
      const montant = montantLigne;
      if (!montant.estPositif()) {
        throw new ErreurConversion('Montant absent ou nul');
      }
      return { ...base, type, montant };
    }
  }
}
