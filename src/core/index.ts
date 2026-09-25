/**
 * Cœur métier de l'application, entièrement pur : aucune dépendance à React
 * Native, au stockage ou au réseau. Il est donc testable intégralement en
 * dehors d'un appareil, et réutilisable tel quel si la couche UI change.
 */

export { Decimal, d, type ValeurDecimale } from './money/decimal';

export type {
  Cession,
  Compte,
  Devise,
  EtatCompte,
  Position,
  Titre,
  Transaction,
  TransactionAchat,
  TransactionDividende,
  TransactionFrais,
  TransactionRetrait,
  TransactionVente,
  TransactionVersement,
  TypeCompte,
  TypeTransaction,
} from './domain/types';

export {
  ErreurTransaction,
  plusValuesParAnnee,
  rejouer,
  type EtatPortefeuille,
} from './portfolio/engine';

export {
  repartition,
  totaux,
  valoriser,
  valoriserPositions,
  type CritereRepartition,
  type LigneRepartition,
  type PositionValorisee,
  type TotauxPortefeuille,
} from './portfolio/valorisation';

export {
  ANNEES_EXONERATION_IR,
  PLAFOND_GLOBAL_PEA_ET_PEA_PME,
  PLAFOND_PEA,
  PLAFOND_PEA_PME,
  ancienneteEnAnnees,
  estExonereImpotRevenu,
  estPEA,
  etatPlafond,
  etatPlafondGlobal,
  plafondDe,
  type EtatPlafond,
  type EtatPlafondGlobal,
} from './tax/pea';

export {
  TAUX_IR_PFU,
  TAUX_PFU,
  TAUX_PRELEVEMENTS_SOCIAUX,
  assietteRetraitPEA,
  impotSurGain,
  impotSurGainCTO,
  impotSurGainPEA,
  impotSurRetraitPEA,
  type ImpotEstime,
  type OptionImposition,
  type OptionsImposition,
  type RetraitPEA,
} from './tax/impots';

export {
  ErreurSimulation,
  simulerVente,
  type ParametresVente,
  type ResultatSimulationVente,
} from './tax/simulation';

export { decouper, detecterDelimiteur, lireCsv, type FichierCsv, type LigneCsv } from './import/csv';

export {
  ErreurConversion,
  normaliser,
  parseDate,
  parseNombre,
  type FormatDate,
  type FormatNombre,
} from './import/valeurs';

export {
  importerCsv,
  type AnomalieImport,
  type ColonnesModele,
  type ContexteImport,
  type IndicesTitre,
  type ModeleImport,
  type RegleLibelle,
  type ResultatImport,
  type SensMouvement,
} from './import/import';

export {
  MODELES,
  MODELE_BOURSOBANK,
  MODELE_BOURSOBANK_MOUVEMENTS,
  MODELE_BOURSOBANK_POSITIONS,
  MODELE_GENERIQUE,
  modeleParId,
} from './import/modeles';

export {
  importerPositions,
  transactionsDeReprise,
  type ColonnesPositions,
  type ModelePositions,
  type OptionsReprise,
  type PositionImportee,
  type ResultatImportPositions,
} from './import/positions';
