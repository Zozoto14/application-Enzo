/**
 * Aperçu d'un import d'opérations (historique), avant tout enregistrement.
 *
 * Trois soucis que l'aperçu règle :
 * - **Quel format ?** Le modèle est reconnu à ses colonnes, parmi ceux que
 *   l'application connaît ; un modèle provisoire est signalé.
 * - **Les doublons.** Réimporter le même relevé ne doit rien ajouter : une
 *   opération identique (compte, date, type, valeur, montants) est écartée.
 * - **La reprise de positions.** Si vos positions ont été importées d'abord,
 *   leurs achats « de reprise » feraient double emploi avec les vrais achats
 *   de l'historique : l'aperçu propose de les remplacer.
 */

import type { Titre, Transaction, TypeTransaction } from '../../core/domain/types';
import { importerCsv, type AnomalieImport, type IndicesTitre, type ModeleImport } from '../../core/import/import';
import { MODELES } from '../../core/import/modeles';

export interface NouveauTitre {
  id: string;
  isin: string;
  nom: string;
  ticker: string;
}

export interface ApercuOperations {
  modele?: ModeleImport;
  /** Colonnes attendues introuvables, quand aucun modèle ne convient. */
  colonnesManquantes: string[];
  transactions: Transaction[];
  doublons: number;
  anomalies: AnomalieImport[];
  parType: Partial<Record<TypeTransaction, number>>;
  periode?: { debut: string; fin: string };
  /** Valeurs inconnues, créées à l'import (repérées par leur ISIN). */
  nouveauxTitres: NouveauTitre[];
  /** Achats de reprise que l'historique peut remplacer. */
  reprise: Transaction[];
}

const NOTE_REPRISE = 'Reprise d’antériorité';

export function estReprise(transaction: Transaction): boolean {
  return Boolean(transaction.note?.startsWith(NOTE_REPRISE));
}

function normaliser(texte: string): string {
  return texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function empreinte(transaction: Transaction): string {
  const champs: string[] = [transaction.compteId, transaction.date, transaction.type];
  if ('titreId' in transaction) champs.push(String(transaction.titreId ?? ''));
  if ('quantite' in transaction) champs.push(transaction.quantite.toString(), transaction.prixUnitaire.toString());
  if ('montantNet' in transaction) champs.push(transaction.montantNet.toString());
  if ('montant' in transaction) champs.push(String((transaction as { montant: { toString(): string } }).montant));
  return champs.join('|');
}

export interface ContexteApercu {
  compteId: string;
  devise: string;
  titres: readonly Titre[];
  existantes: readonly Transaction[];
  genererId(prefixe: string): string;
}

export function apercuOperations(contenu: string, contexte: ContexteApercu): ApercuOperations {
  const vide: ApercuOperations = {
    colonnesManquantes: [],
    transactions: [],
    doublons: 0,
    anomalies: [],
    parType: {},
    nouveauxTitres: [],
    reprise: [],
  };
  if (!contenu.trim()) {
    return vide;
  }

  const nouveaux = new Map<string, NouveauTitre>();
  const resoudreTitre = (indices: IndicesTitre): string | undefined => {
    const isin = indices.isin?.trim().toUpperCase();
    const ticker = indices.ticker?.trim().toUpperCase();
    const connu =
      contexte.titres.find(titre => isin && titre.isin.toUpperCase() === isin) ??
      contexte.titres.find(titre => ticker && titre.ticker.toUpperCase() === ticker) ??
      contexte.titres.find(
        titre => indices.libelle && normaliser(indices.libelle).includes(normaliser(titre.nom)),
      );
    if (connu) return connu.id;
    // Une valeur inconnue avec un ISIN se crée ; sans ISIN, on ne devine pas.
    if (isin && /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin)) {
      const existant = nouveaux.get(isin);
      if (existant) return existant.id;
      const cree = { id: contexte.genererId(`titre-${isin}`), isin, nom: indices.libelle?.trim() || isin, ticker: '' };
      nouveaux.set(isin, cree);
      return cree.id;
    }
    return undefined;
  };

  // Le premier modèle dont toutes les colonnes sont là.
  let meilleur: { modele: ModeleImport; manquantes: string[] } | undefined;
  for (const modele of MODELES) {
    nouveaux.clear();
    const essai = importerCsv(contenu, modele, {
      compteId: contexte.compteId,
      deviseParDefaut: contexte.devise,
      resoudreTitre,
      genererId: ligne => contexte.genererId(`import-${ligne}`),
    });
    if (essai.colonnesManquantes.length === 0) {
      const existantes = new Set(contexte.existantes.map(empreinte));
      const nouvelles = essai.transactions.filter(transaction => !existantes.has(empreinte(transaction)));
      const parType: Partial<Record<TypeTransaction, number>> = {};
      for (const transaction of nouvelles) parType[transaction.type] = (parType[transaction.type] ?? 0) + 1;
      const dates = nouvelles.map(transaction => transaction.date).sort();
      const utilises = new Set(nouvelles.flatMap(transaction => ('titreId' in transaction && transaction.titreId ? [transaction.titreId] : [])));
      return {
        modele,
        colonnesManquantes: [],
        transactions: nouvelles,
        doublons: essai.transactions.length - nouvelles.length,
        anomalies: essai.anomalies,
        parType,
        periode: dates.length > 0 ? { debut: dates[0], fin: dates[dates.length - 1] } : undefined,
        nouveauxTitres: [...nouveaux.values()].filter(titre => utilises.has(titre.id)),
        reprise: nouvelles.some(transaction => transaction.type === 'ACHAT')
          ? contexte.existantes.filter(transaction => transaction.compteId === contexte.compteId && estReprise(transaction))
          : [],
      };
    }
    if (!meilleur || essai.colonnesManquantes.length < meilleur.manquantes.length) {
      meilleur = { modele, manquantes: essai.colonnesManquantes };
    }
  }
  return { ...vide, colonnesManquantes: meilleur?.manquantes ?? [] };
}
