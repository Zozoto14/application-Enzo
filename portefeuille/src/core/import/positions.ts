/**
 * Import d'un export de positions instantanées.
 *
 * Ce fichier n'est pas un journal : il décrit l'état du portefeuille à un
 * instant, pas la suite d'opérations qui y a mené. Or tout le moteur repose
 * sur le rejeu d'un journal. L'import produit donc, pour chaque position, une
 * **transaction de reprise d'antériorité** : un achat fictif à la date choisie,
 * au prix de revient constaté, qui reproduit exactement la position sans
 * prétendre reconstituer l'historique réel.
 *
 * Les ventes passées, les dividendes déjà perçus et les plus-values réalisées
 * restent donc absents. C'est une base de départ, pas une reconstitution.
 *
 * Précision du prix de revient : le PRU affiché dans l'export est arrondi au
 * centime, et le reprendre tel quel fausse le coût total (6 centimes d'écart
 * mesurés sur un ETF à 11 966 €). Le coût exact se retrouve autrement —
 * voir `coutDeRevient`.
 */

import { Decimal } from '../money/decimal';
import type { Transaction } from '../domain/types';
import { lireCsv } from './csv';
import { ErreurConversion, parseNombre, type FormatNombre } from './valeurs';

export interface ColonnesPositions {
  nom: string;
  isin: string;
  quantite: string;
  /** Prix de revient unitaire, tel qu'affiché par le courtier (arrondi). */
  pru: string;
  dernierCours?: string;
  /** Valeur de marché de la ligne. */
  valeurMarche?: string;
  /** Plus ou moins-value latente en montant. */
  variationMontant?: string;
}

export interface ModelePositions {
  id: string;
  libelle: string;
  provisoire?: boolean;
  delimiteur?: string;
  formatNombre: FormatNombre;
  colonnes: ColonnesPositions;
}

export interface PositionImportee {
  nom: string;
  isin: string;
  quantite: Decimal;
  /** Prix de revient unitaire exact, recalculé à partir du coût total. */
  pru: Decimal;
  /** Coût de revient total de la ligne. */
  coutTotal: Decimal;
  dernierCours?: Decimal;
  valeurMarche?: Decimal;
  /**
   * Vrai si le coût a dû être estimé à partir du PRU arrondi, faute de pouvoir
   * le retrouver exactement. L'interface doit le signaler.
   */
  coutApproche: boolean;
}

export interface ResultatImportPositions {
  positions: PositionImportee[];
  anomalies: Array<{ ligne: number; message: string; brut: string }>;
  colonnesManquantes: string[];
}

/**
 * Coût de revient total d'une ligne.
 *
 * Deux chemins, et le premier est nettement meilleur :
 *
 *  1. `valeur de marché - plus-value latente`. Les deux montants sont donnés
 *     au centime par le courtier, et leur différence est le coût exact.
 *     Vérifié sur un cas réel : 84,47 - (-17,92) = 102,39, soit exactement le
 *     montant débité sur l'avis d'opéré correspondant.
 *
 *  2. `quantité x PRU affiché`, à défaut. Le PRU étant arrondi au centime,
 *     l'erreur est proportionnelle à la quantité : sur 17 parts d'un ETF à
 *     704 €, elle atteint 6 centimes. Marginal, mais évitable — d'où le
 *     drapeau `coutApproche`.
 */
function coutDeRevient(
  quantite: Decimal,
  pru: Decimal,
  valeurMarche: Decimal | undefined,
  variationMontant: Decimal | undefined,
): { coutTotal: Decimal; approche: boolean } {
  if (valeurMarche && variationMontant) {
    return { coutTotal: valeurMarche.sub(variationMontant), approche: false };
  }
  return { coutTotal: quantite.mul(pru), approche: true };
}

export function importerPositions(
  contenu: string,
  modele: ModelePositions,
): ResultatImportPositions {
  const fichier = lireCsv(contenu, { delimiteur: modele.delimiteur });
  const { colonnes } = modele;

  const requises = [colonnes.nom, colonnes.isin, colonnes.quantite, colonnes.pru];
  const colonnesManquantes = requises.filter(
    colonne => !fichier.entetes.includes(colonne),
  );
  if (colonnesManquantes.length > 0) {
    return { positions: [], anomalies: [], colonnesManquantes };
  }

  const positions: PositionImportee[] = [];
  const anomalies: ResultatImportPositions['anomalies'] = [];

  for (const ligne of fichier.lignes) {
    try {
      const lire = (colonne?: string): Decimal | undefined => {
        if (!colonne) {
          return undefined;
        }
        const brut = (ligne.champs[colonne] ?? '').trim();
        return brut === '' ? undefined : parseNombre(brut, modele.formatNombre);
      };

      const quantite = lire(colonnes.quantite);
      const pru = lire(colonnes.pru);
      const isin = (ligne.champs[colonnes.isin] ?? '').trim();
      const nom = (ligne.champs[colonnes.nom] ?? '').trim();

      if (!isin) {
        throw new ErreurConversion('ISIN absent');
      }
      if (!quantite || !quantite.estPositif()) {
        throw new ErreurConversion('Quantité absente ou nulle');
      }
      if (!pru || !pru.estPositif()) {
        throw new ErreurConversion('Prix de revient absent ou nul');
      }

      const valeurMarche = lire(colonnes.valeurMarche);
      const variationMontant = lire(colonnes.variationMontant);
      const { coutTotal, approche } = coutDeRevient(
        quantite,
        pru,
        valeurMarche,
        variationMontant,
      );

      positions.push({
        nom,
        isin,
        quantite,
        coutTotal,
        pru: coutTotal.div(quantite),
        dernierCours: lire(colonnes.dernierCours),
        valeurMarche,
        coutApproche: approche,
      });
    } catch (erreur) {
      anomalies.push({
        ligne: ligne.numero,
        message: erreur instanceof Error ? erreur.message : String(erreur),
        brut: ligne.brut,
      });
    }
  }

  return { positions, anomalies, colonnesManquantes: [] };
}

export interface OptionsReprise {
  compteId: string;
  /** Date portée par les transactions de reprise, au format ISO. */
  date: string;
  devise?: string;
  /** Rattache une position à un titre de la base. */
  resoudreTitre(position: PositionImportee): string;
  genererId?(position: PositionImportee, index: number): string;
  /**
   * Ajoute un versement couvrant le coût total des positions reprises.
   * Activé par défaut : sans lui, les achats de reprise débiteraient un compte
   * vide et afficheraient un solde espèces négatif de plusieurs milliers
   * d'euros, qui n'a jamais existé.
   *
   * Contrepartie à connaître : ce versement alimente le suivi du plafond PEA.
   * Son montant est le prix de revient actuel, pas la somme réellement versée
   * au fil des ans — les gains réinvestis en sont absents. Le suivi du plafond
   * est donc minoré tant que l'historique réel des versements n'a pas été
   * saisi.
   */
  equilibrerParVersement?: boolean;
}

/**
 * Transforme des positions en transactions de reprise d'antériorité.
 *
 * Chaque position devient un achat unique, sans frais, au prix de revient
 * constaté. Les frais sont mis à zéro parce qu'ils sont **déjà compris** dans
 * le prix de revient — les ajouter les compterait deux fois.
 *
 * Limite assumée : le coût total et le prix unitaire ne sont pas toujours
 * exacts tous les deux. 11 966,07 € divisé par 17 parts ne tombe pas juste,
 * et remultiplier le quotient par 17 redonne 11 966,07000003. Le journal
 * rejoué reproduit donc la position **au centime**, avec un résidu de l'ordre
 * du cent-millionième d'euro. Absorber ce résidu dans les frais donnerait un
 * montant de frais fictif : mieux vaut un résidu invisible qu'une donnée
 * fausse dans un champ qui a un sens.
 */
export function transactionsDeReprise(
  positions: readonly PositionImportee[],
  options: OptionsReprise,
): Transaction[] {
  const devise = options.devise ?? 'EUR';

  const achats: Transaction[] = positions.map((position, index) => ({
    id: options.genererId?.(position, index) ?? `reprise-${position.isin}`,
    compteId: options.compteId,
    date: options.date,
    devise,
    type: 'ACHAT' as const,
    titreId: options.resoudreTitre(position),
    quantite: position.quantite,
    prixUnitaire: position.pru,
    frais: Decimal.ZERO,
    note: position.coutApproche
      ? 'Reprise d’antériorité (prix de revient approché, arrondi du relevé)'
      : 'Reprise d’antériorité',
  }));

  if (options.equilibrerParVersement === false || positions.length === 0) {
    return achats;
  }

  const total = Decimal.somme(positions.map(position => position.coutTotal));
  const versement: Transaction = {
    id: 'reprise-versement',
    compteId: options.compteId,
    date: options.date,
    devise,
    type: 'VERSEMENT',
    montant: total,
    note: 'Reprise d’antériorité : apport couvrant le prix de revient des positions reprises. Montant approché pour le suivi du plafond.',
  };

  // Le versement précède les achats : à date égale, le moteur conserve l'ordre
  // de saisie, et un compte ne doit pas passer par un solde négatif.
  return [versement, ...achats];
}
