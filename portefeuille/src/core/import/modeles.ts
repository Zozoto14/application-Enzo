/**
 * Modèles d'import prédéfinis.
 *
 * MODELE_GENERIQUE est le format de référence : c'est lui que produit l'export
 * de l'application, et celui vers lequel se rabattre quand un relevé n'entre
 * dans aucun autre modèle.
 *
 * MODELE_BOURSOBANK reste marqué `provisoire`, mais plus entièrement à
 * l'aveugle. Un avis d'opéré réel (achat STELLANTIS du 03/08/2026) a confirmé
 * les conventions de la banque :
 *   - libellé d'opération « ACHAT COMPTANT » ;
 *   - dates en JJ/MM/AAAA, virgule décimale, cours à trois décimales ;
 *   - commission de courtage et taxe sur les transactions financières
 *     comptées séparément, d'où deux colonnes de frais à additionner ;
 *   - montant net au débit = quantité x cours + frais.
 *
 * Ce qui reste une hypothèse : les **noms de colonnes** du fichier CSV, qu'un
 * avis d'opéré ne révèle pas. Le drapeau `provisoire` reste donc levé, et
 * l'interface doit continuer de l'afficher, jusqu'à confrontation avec un
 * véritable export CSV.
 */

import type { ModeleImport } from './import';
import type { ModelePositions } from './positions';

export const MODELE_GENERIQUE: ModeleImport = {
  id: 'generique',
  libelle: 'Modèle générique',
  formatDate: 'AAAA-MM-JJ',
  formatNombre: 'EN',
  colonnes: {
    date: 'date',
    operation: 'operation',
    libelle: 'libelle',
    isin: 'isin',
    ticker: 'ticker',
    quantite: 'quantite',
    prixUnitaire: 'prix_unitaire',
    montant: 'montant',
    frais: 'frais',
    devise: 'devise',
  },
  operations: {
    achat: 'ACHAT',
    vente: 'VENTE',
    dividende: 'DIVIDENDE',
    versement: 'VERSEMENT',
    retrait: 'RETRAIT',
    frais: 'FRAIS',
  },
};

export const MODELE_BOURSOBANK: ModeleImport = {
  id: 'boursobank',
  libelle: 'Relevé BoursoBank',
  provisoire: true,
  delimiteur: ';',
  formatDate: 'JJ/MM/AAAA',
  formatNombre: 'FR',
  colonnes: {
    date: 'Date',
    operation: 'Operation',
    libelle: 'Libelle',
    isin: 'Code ISIN',
    quantite: 'Quantite',
    prixUnitaire: 'Cours',
    montant: 'Montant',
    // Deux colonnes additionnées : l'avis d'opéré distingue la commission de
    // courtage de la taxe sur les transactions financières.
    frais: ['Commission', 'Frais'],
    devise: 'Devise',
  },
  operations: {
    achat: 'ACHAT',
    'achat comptant': 'ACHAT',
    souscription: 'ACHAT',
    vente: 'VENTE',
    'vente comptant': 'VENTE',
    dividende: 'DIVIDENDE',
    coupon: 'DIVIDENDE',
    versement: 'VERSEMENT',
    'virement recu': 'VERSEMENT',
    retrait: 'RETRAIT',
    'virement emis': 'RETRAIT',
    'frais de courtage': 'FRAIS',
    'droits de garde': 'FRAIS',
  },
};

/**
 * Relevé de mouvements espèces BoursoBank.
 *
 * Colonnes relevées sur un document réel :
 * `Date opération | Libellé | Valeur | Débit | Crédit`.
 *
 * Deux pièges y sont désamorcés :
 *
 *  1. **« Valeur » est la date de valeur**, pas la valeur boursière. La colonne
 *     est volontairement absente du mappage : l'y associer par réflexe
 *     rattacherait chaque ligne à un titre inexistant.
 *
 *  2. **Ce relevé ne contient ni quantité, ni ISIN, ni cours.** Il ne permet
 *     donc pas de reconstruire les positions, seulement les flux d'espèces :
 *     versements, retraits, dividendes et frais. Les achats et ventes y sont
 *     repérés et signalés ligne par ligne, avec un message invitant à les
 *     saisir depuis leur avis d'opéré, qui seul porte la quantité.
 *
 * Les motifs de libellé restent provisoires : le document observé n'en montre
 * que les intitulés de colonnes, pas des lignes réelles.
 */
export const MODELE_BOURSOBANK_MOUVEMENTS: ModeleImport = {
  id: 'boursobank-mouvements',
  libelle: 'Relevé de mouvements BoursoBank',
  provisoire: true,
  delimiteur: ';',
  formatDate: 'JJ/MM/AAAA',
  formatNombre: 'FR',
  colonnes: {
    date: 'Date opération',
    libelle: 'Libellé',
    debit: 'Débit',
    credit: 'Crédit',
  },
  operations: {},
  // Ordre significatif : les motifs les plus spécifiques d'abord.
  reglesLibelle: [
    { motif: 'achat', type: 'ACHAT' },
    { motif: 'vente|cession', type: 'VENTE' },
    { motif: 'dividende|coupon', type: 'DIVIDENDE' },
    { motif: 'frais|commission|droits de garde|taxe', type: 'FRAIS' },
    // Un virement peut aller dans les deux sens : la colonne tranche.
    {
      motif: 'virement|versement|prelevement',
      type: { debit: 'RETRAIT', credit: 'VERSEMENT' },
    },
  ],
};

/**
 * Export « positions instantanées » de BoursoBank.
 *
 * Seul des trois documents observés à porter à la fois l'ISIN, la quantité et
 * le prix de revient : c'est donc le seul qui permette de reconstituer un
 * portefeuille sans ressaisie.
 *
 * Ses en-têtes sont en anglais (`name;isin;quantity;...`) alors que ses
 * nombres sont au format français (virgule décimale, espace pour les
 * milliers) — un mélange qu'aucune heuristique ne devinerait, d'où ce modèle
 * explicite. Confronté à un export réel, il n'est donc pas provisoire.
 */
export const MODELE_BOURSOBANK_POSITIONS: ModelePositions = {
  id: 'boursobank-positions',
  libelle: 'Positions instantanées BoursoBank',
  delimiteur: ';',
  formatNombre: 'FR',
  colonnes: {
    nom: 'name',
    isin: 'isin',
    quantite: 'quantity',
    pru: 'buyingPrice',
    dernierCours: 'lastPrice',
    valeurMarche: 'amount',
    // Permet de retrouver le coût de revient exact, sans passer par le PRU
    // affiché, qui est arrondi au centime.
    variationMontant: 'amountVariation',
  },
};

export const MODELES: readonly ModeleImport[] = [
  MODELE_GENERIQUE,
  MODELE_BOURSOBANK,
  MODELE_BOURSOBANK_MOUVEMENTS,
];

export function modeleParId(id: string): ModeleImport | undefined {
  return MODELES.find(modele => modele.id === id);
}
