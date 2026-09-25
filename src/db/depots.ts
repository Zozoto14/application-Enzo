/**
 * Dépôts : traduction entre les lignes SQL et les objets du domaine.
 *
 * C'est le seul endroit où le modèle relationnel et le modèle métier se
 * rencontrent. Une ligne incohérente y est rejetée avec un message nommant la
 * colonne fautive, plutôt que de produire un objet à moitié valide qui
 * planterait plus loin dans le moteur de calcul.
 */

import { Decimal } from '../core/money/decimal';
import type {
  Compte,
  Titre,
  Transaction,
  TypeCompte,
  TypeTransaction,
} from '../core/domain/types';
import { rejouer, type EtatPortefeuille } from '../core/portfolio/engine';
import type { PiloteSqlite, ValeurSql } from './pilote';

export class ErreurPersistance extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurPersistance';
  }
}

const texte = (valeur?: Decimal): string | null =>
  valeur === undefined ? null : valeur.toString();

function obligatoire(valeur: ValeurSql, id: string, colonne: string): Decimal {
  if (valeur === null || valeur === undefined || valeur === '') {
    throw new ErreurPersistance(
      `Transaction ${id} : colonne "${colonne}" vide alors qu'elle est requise`,
    );
  }
  try {
    return Decimal.de(String(valeur));
  } catch {
    throw new ErreurPersistance(
      `Transaction ${id} : colonne "${colonne}" illisible ("${String(valeur)}")`,
    );
  }
}

function facultatif(valeur: ValeurSql): Decimal | undefined {
  return valeur === null || valeur === undefined || valeur === ''
    ? undefined
    : Decimal.de(String(valeur));
}

function chaineObligatoire(valeur: ValeurSql, id: string, colonne: string): string {
  if (valeur === null || valeur === undefined || valeur === '') {
    throw new ErreurPersistance(
      `Transaction ${id} : colonne "${colonne}" vide alors qu'elle est requise`,
    );
  }
  return String(valeur);
}

// ---------------------------------------------------------------- Comptes

interface LigneCompte {
  id: string;
  nom: string;
  type: string;
  date_ouverture: string;
  devise: string;
}

export class DepotComptes {
  constructor(private readonly pilote: PiloteSqlite) {}

  enregistrer(compte: Compte): void {
    this.pilote.executer(
      `INSERT INTO comptes (id, nom, type, date_ouverture, devise)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         nom = excluded.nom,
         type = excluded.type,
         date_ouverture = excluded.date_ouverture,
         devise = excluded.devise`,
      [compte.id, compte.nom, compte.type, compte.dateOuverture, compte.devise],
    );
  }

  tous(): Compte[] {
    return this.pilote
      .lire<LigneCompte>('SELECT * FROM comptes ORDER BY date_ouverture, id')
      .map(ligne => ({
        id: ligne.id,
        nom: ligne.nom,
        type: ligne.type as TypeCompte,
        dateOuverture: ligne.date_ouverture,
        devise: ligne.devise,
      }));
  }

  parId(id: string): Compte | undefined {
    return this.tous().find(compte => compte.id === id);
  }

  supprimer(id: string): void {
    this.pilote.executer('DELETE FROM comptes WHERE id = ?', [id]);
  }
}

// ----------------------------------------------------------------- Titres

interface LigneTitre {
  id: string;
  isin: string;
  nom: string;
  ticker: string;
  devise_cotation: string;
  secteur: string | null;
  zone_geographique: string | null;
  eligible_pea: number;
  lien_externe: string | null;
}

export class DepotTitres {
  constructor(private readonly pilote: PiloteSqlite) {}

  enregistrer(titre: Titre): void {
    this.pilote.executer(
      `INSERT INTO titres
         (id, isin, nom, ticker, devise_cotation, secteur, zone_geographique,
          eligible_pea, lien_externe)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         isin = excluded.isin,
         nom = excluded.nom,
         ticker = excluded.ticker,
         devise_cotation = excluded.devise_cotation,
         secteur = excluded.secteur,
         zone_geographique = excluded.zone_geographique,
         eligible_pea = excluded.eligible_pea,
         lien_externe = excluded.lien_externe`,
      [
        titre.id,
        titre.isin,
        titre.nom,
        titre.ticker,
        titre.deviseCotation,
        titre.secteur ?? null,
        titre.zoneGeographique ?? null,
        titre.eligiblePEA ? 1 : 0,
        titre.lienExterne ?? null,
      ],
    );
  }

  tous(): Titre[] {
    return this.pilote
      .lire<LigneTitre>('SELECT * FROM titres ORDER BY nom')
      .map(ligne => ({
        id: ligne.id,
        isin: ligne.isin,
        nom: ligne.nom,
        ticker: ligne.ticker,
        deviseCotation: ligne.devise_cotation,
        secteur: ligne.secteur ?? undefined,
        zoneGeographique: ligne.zone_geographique ?? undefined,
        eligiblePEA: ligne.eligible_pea === 1,
        lienExterne: ligne.lien_externe ?? undefined,
      }));
  }

  parIsin(isin: string): Titre | undefined {
    return this.tous().find(titre => titre.isin === isin);
  }
}

// ----------------------------------------------------------- Transactions

interface LigneTransaction {
  id: string;
  compte_id: string;
  titre_id: string | null;
  type: string;
  date: string;
  devise: string;
  taux_change: string | null;
  note: string | null;
  quantite: string | null;
  prix_unitaire: string | null;
  frais: string | null;
  montant: string | null;
  montant_brut: string | null;
}

/** Reconstruit la transaction typée correspondant à une ligne. */
export function versTransaction(ligne: LigneTransaction): Transaction {
  const base = {
    id: ligne.id,
    compteId: ligne.compte_id,
    date: ligne.date,
    devise: ligne.devise,
    tauxChange: facultatif(ligne.taux_change),
    note: ligne.note ?? undefined,
  };

  const type = ligne.type as TypeTransaction;
  switch (type) {
    case 'ACHAT':
    case 'VENTE':
      return {
        ...base,
        type,
        titreId: chaineObligatoire(ligne.titre_id, ligne.id, 'titre_id'),
        quantite: obligatoire(ligne.quantite, ligne.id, 'quantite'),
        prixUnitaire: obligatoire(ligne.prix_unitaire, ligne.id, 'prix_unitaire'),
        frais: obligatoire(ligne.frais, ligne.id, 'frais'),
      };

    case 'DIVIDENDE':
      return {
        ...base,
        type,
        titreId: chaineObligatoire(ligne.titre_id, ligne.id, 'titre_id'),
        montantNet: obligatoire(ligne.montant, ligne.id, 'montant'),
        montantBrut: facultatif(ligne.montant_brut),
      };

    case 'VERSEMENT':
    case 'RETRAIT':
      return { ...base, type, montant: obligatoire(ligne.montant, ligne.id, 'montant') };

    case 'FRAIS':
      return {
        ...base,
        type,
        montant: obligatoire(ligne.montant, ligne.id, 'montant'),
        titreId: ligne.titre_id ?? undefined,
      };

    default:
      throw new ErreurPersistance(
        `Transaction ${ligne.id} : type inconnu "${ligne.type}"`,
      );
  }
}

/** Aplatit une transaction typée vers les colonnes de la table. */
function versParametres(transaction: Transaction): ValeurSql[] {
  const commun = {
    titreId: 'titreId' in transaction ? (transaction.titreId ?? null) : null,
    quantite: 'quantite' in transaction ? texte(transaction.quantite) : null,
    prixUnitaire: 'prixUnitaire' in transaction ? texte(transaction.prixUnitaire) : null,
    frais: 'frais' in transaction ? texte(transaction.frais) : null,
    montant:
      transaction.type === 'DIVIDENDE'
        ? texte(transaction.montantNet)
        : 'montant' in transaction
          ? texte(transaction.montant)
          : null,
    montantBrut:
      transaction.type === 'DIVIDENDE' ? texte(transaction.montantBrut) : null,
  };

  return [
    transaction.id,
    transaction.compteId,
    commun.titreId,
    transaction.type,
    transaction.date,
    transaction.devise,
    texte(transaction.tauxChange),
    transaction.note ?? null,
    commun.quantite,
    commun.prixUnitaire,
    commun.frais,
    commun.montant,
    commun.montantBrut,
  ];
}

export class DepotTransactions {
  constructor(private readonly pilote: PiloteSqlite) {}

  enregistrer(transaction: Transaction): void {
    this.pilote.executer(
      `INSERT INTO transactions
         (id, compte_id, titre_id, type, date, devise, taux_change, note,
          quantite, prix_unitaire, frais, montant, montant_brut)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         compte_id = excluded.compte_id,
         titre_id = excluded.titre_id,
         type = excluded.type,
         date = excluded.date,
         devise = excluded.devise,
         taux_change = excluded.taux_change,
         note = excluded.note,
         quantite = excluded.quantite,
         prix_unitaire = excluded.prix_unitaire,
         frais = excluded.frais,
         montant = excluded.montant,
         montant_brut = excluded.montant_brut`,
      versParametres(transaction),
    );
  }

  /**
   * Enregistre un lot dans une seule transaction SQL.
   * Utilisé par l'import CSV : soit le relevé entre en entier, soit la base
   * reste dans l'état où elle était avant.
   */
  enregistrerLot(transactions: readonly Transaction[]): void {
    this.pilote.transaction(() => {
      for (const transaction of transactions) {
        this.enregistrer(transaction);
      }
    });
  }

  toutes(): Transaction[] {
    return this.pilote
      .lire<LigneTransaction>('SELECT * FROM transactions ORDER BY date, id')
      .map(versTransaction);
  }

  parCompte(compteId: string): Transaction[] {
    return this.pilote
      .lire<LigneTransaction>(
        'SELECT * FROM transactions WHERE compte_id = ? ORDER BY date, id',
        [compteId],
      )
      .map(versTransaction);
  }

  supprimer(id: string): void {
    this.pilote.executer('DELETE FROM transactions WHERE id = ?', [id]);
  }

  compter(): number {
    const [ligne] = this.pilote.lire<{ n: number }>(
      'SELECT COUNT(*) AS n FROM transactions',
    );
    return ligne?.n ?? 0;
  }
}

// ------------------------------------------------------------- Watchlist

export interface LigneWatchlist {
  titreId: string;
  ajouteLe: string;
  /** Cours du jour de l'ajout, quand il etait connu. */
  coursAjout?: Decimal;
  note?: string;
}

/**
 * Valeurs suivies sans etre detenues.
 *
 * Distincte des positions a dessein : une ligne surveillee n'a ni quantite ni
 * prix de revient, et la faire entrer dans le portefeuille fausserait tous les
 * totaux.
 */
export class DepotWatchlist {
  constructor(private readonly pilote: PiloteSqlite) {}

  lister(): LigneWatchlist[] {
    const lignes = this.pilote.lire<{
      titre_id: string;
      ajoute_le: string;
      cours_ajout: string | null;
      note: string | null;
    }>('SELECT titre_id, ajoute_le, cours_ajout, note FROM watchlist ORDER BY ajoute_le DESC');

    return lignes.map(ligne => ({
      titreId: ligne.titre_id,
      ajouteLe: ligne.ajoute_le,
      coursAjout: ligne.cours_ajout === null ? undefined : Decimal.de(ligne.cours_ajout),
      note: ligne.note ?? undefined,
    }));
  }

  ajouter(ligne: LigneWatchlist): void {
    this.pilote.executer(
      `INSERT INTO watchlist (titre_id, ajoute_le, cours_ajout, note) VALUES (?, ?, ?, ?)
       ON CONFLICT(titre_id) DO UPDATE SET note = excluded.note`,
      [
        ligne.titreId,
        ligne.ajouteLe,
        ligne.coursAjout ? texte(ligne.coursAjout) : null,
        ligne.note ?? null,
      ],
    );
  }

  retirer(titreId: string): void {
    this.pilote.executer('DELETE FROM watchlist WHERE titre_id = ?', [titreId]);
  }

  contient(titreId: string): boolean {
    const [ligne] = this.pilote.lire<{ n: number }>(
      'SELECT COUNT(*) AS n FROM watchlist WHERE titre_id = ?',
      [titreId],
    );
    return (ligne?.n ?? 0) > 0;
  }
}

// ------------------------------------------------------------------ Cours

export class DepotCours {
  constructor(private readonly pilote: PiloteSqlite) {}

  enregistrer(titreId: string, date: string, cloture: Decimal): void {
    this.pilote.executer(
      `INSERT INTO cours (titre_id, date, cloture) VALUES (?, ?, ?)
       ON CONFLICT(titre_id, date) DO UPDATE SET cloture = excluded.cloture`,
      [titreId, date, cloture.toString()],
    );
  }

  /**
   * Historique complet, par titre et par date croissante.
   * Alimente la serie de valorisation, donc toutes les mesures de
   * performance : sans lui, l'application ne saurait que le present.
   */
  historique(): Map<string, Array<{ date: string; cloture: Decimal }>> {
    const lignes = this.pilote.lire<{
      titre_id: string;
      date: string;
      cloture: string;
    }>('SELECT titre_id, date, cloture FROM cours ORDER BY titre_id, date');

    const parTitre = new Map<string, Array<{ date: string; cloture: Decimal }>>();
    for (const ligne of lignes) {
      const serie = parTitre.get(ligne.titre_id) ?? [];
      serie.push({ date: ligne.date, cloture: Decimal.de(ligne.cloture) });
      parTitre.set(ligne.titre_id, serie);
    }
    return parTitre;
  }

  /** Dernier cours connu de chaque titre, prêt pour la valorisation. */
  derniersCours(): Map<string, Decimal> {
    const lignes = this.pilote.lire<{ titre_id: string; cloture: string }>(
      `SELECT c.titre_id, c.cloture
         FROM cours c
         JOIN (SELECT titre_id, MAX(date) AS date FROM cours GROUP BY titre_id) d
           ON d.titre_id = c.titre_id AND d.date = c.date`,
    );
    return new Map(lignes.map(ligne => [ligne.titre_id, Decimal.de(ligne.cloture)]));
  }
}

// ------------------------------------------------------------ Parametres

/** Cles de parametres connues, regroupees pour eviter les chaines eparpillees. */
export const PARAMETRES = {
  fournisseurCours: 'cours.fournisseur',
  cleApiCours: 'cours.cle_api',
  planningBriefings: 'notifications.planning',
  seuilsAlertes: 'notifications.seuils',
  briefingsEnvoyes: 'notifications.envoyes',
  titreReference: 'performance.reference',
  /** Indice de comparaison de la courbe du Résumé ; « aucun » pour n'en voir aucun. */
  indiceReference: 'performance.indice',
  /** Date du dernier chargement automatique de l'historique des cours. */
  historiqueChargeLe: 'cours.historique_charge_le',
  /** Secondes entre deux actualisations des cours, fenêtre ouverte ; « 0 » pour ne jamais actualiser. */
  intervalleActualisation: 'cours.intervalle_s',
  identifiantAppareil: 'sync.appareil',
} as const;

/**
 * Parametres de l'application.
 *
 * Vit dans la base chiffree : la cle d'API du fournisseur de cours n'est donc
 * lisible qu'apres deverrouillage. Le Trousseau iOS serait marginalement
 * mieux, au prix d'un module natif de plus pour un secret qui ne sert qu'une
 * fois la base ouverte.
 */
export class DepotParametres {
  constructor(private readonly pilote: PiloteSqlite) {}

  lire(cle: string): string | undefined {
    const [ligne] = this.pilote.lire<{ valeur: string }>(
      'SELECT valeur FROM parametres WHERE cle = ?',
      [cle],
    );
    return ligne?.valeur;
  }

  ecrire(cle: string, valeur: string): void {
    this.pilote.executer(
      `INSERT INTO parametres (cle, valeur) VALUES (?, ?)
       ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur`,
      [cle, valeur],
    );
  }

  supprimer(cle: string): void {
    this.pilote.executer('DELETE FROM parametres WHERE cle = ?', [cle]);
  }
}

// ------------------------------------------------------------- Chargement

export interface ContenuBase {
  comptes: Compte[];
  titres: Titre[];
  transactions: Transaction[];
  etat: EtatPortefeuille;
}

/** Relit la base et rejoue le journal pour obtenir l'état courant. */
export function chargerEtat(pilote: PiloteSqlite): ContenuBase {
  const comptes = new DepotComptes(pilote).tous();
  const titres = new DepotTitres(pilote).tous();
  const transactions = new DepotTransactions(pilote).toutes();

  return { comptes, titres, transactions, etat: rejouer(comptes, transactions) };
}
