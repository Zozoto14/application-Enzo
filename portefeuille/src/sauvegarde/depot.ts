/**
 * Export et restauration de la base.
 *
 * Fait le lien entre les dépôts et le format d'archive. La restauration est
 * volontairement **destructive et transactionnelle** : elle remplace le
 * contenu, elle ne le fusionne pas.
 *
 * Fusionner supposerait de savoir arbitrer entre deux versions d'une même
 * transaction, ce qu'aucune règle automatique ne peut trancher correctement.
 * Mieux vaut un remplacement dont l'utilisateur comprend l'effet qu'une fusion
 * dont personne ne sait dire ce qu'elle a fait.
 */

import { Decimal } from '../core/money/decimal';
import {
  DepotComptes,
  DepotCours,
  DepotParametres,
  DepotTitres,
  DepotTransactions,
  PARAMETRES,
} from '../db/depots';
import type { PiloteSqlite } from '../db/pilote';
import type { ParametresKdf } from '../securite/kdf';
import type { SourceAleatoire } from '../securite/aleatoire';
import {
  creerArchive,
  type Archive,
  type ContenuArchive,
  type CoursSauvegarde,
} from './archive';

export interface OptionsExportBase {
  motDePasse: string;
  date: string;
  kdf?: ParametresKdf;
  alea?: SourceAleatoire;
  /**
   * Inclure la clé d'API du fournisseur de cours.
   * Exclue par défaut : une sauvegarde peut être posée sur un service tiers,
   * et un identifiant technique n'a pas à s'y retrouver.
   */
  inclureSecrets?: boolean;
}

function coursDeLaBase(pilote: PiloteSqlite): CoursSauvegarde[] {
  const historique = new DepotCours(pilote).historique();
  const lignes: CoursSauvegarde[] = [];
  for (const [titreId, points] of historique) {
    for (const point of points) {
      lignes.push({ titreId, date: point.date, cloture: point.cloture.toString() });
    }
  }
  return lignes;
}

export function exporterDepuisBase(
  pilote: PiloteSqlite,
  options: OptionsExportBase,
): Archive {
  const parametres = new DepotParametres(pilote);
  const fournisseur = parametres.lire(PARAMETRES.fournisseurCours);
  const cleApi = options.inclureSecrets
    ? parametres.lire(PARAMETRES.cleApiCours)
    : undefined;

  const retenus: Array<{ cle: string; valeur: string }> = [];
  if (fournisseur) {
    retenus.push({ cle: PARAMETRES.fournisseurCours, valeur: fournisseur });
  }
  if (cleApi) {
    retenus.push({ cle: PARAMETRES.cleApiCours, valeur: cleApi });
  }

  return creerArchive({
    motDePasse: options.motDePasse,
    date: options.date,
    kdf: options.kdf,
    alea: options.alea,
    contenu: {
      comptes: new DepotComptes(pilote).tous(),
      titres: new DepotTitres(pilote).tous(),
      transactions: new DepotTransactions(pilote).toutes(),
      cours: coursDeLaBase(pilote),
      parametres: retenus,
    },
  });
}

export interface RapportRestauration {
  comptes: number;
  titres: number;
  transactions: number;
  cours: number;
  parametres: number;
}

/**
 * Remplace le contenu de la base par celui de l'archive.
 *
 * Tout se joue dans une seule transaction SQL : une restauration interrompue
 * laisserait sinon une base à moitié vidée, c'est-à-dire pire que celle dont
 * on partait.
 *
 * L'ordre d'écriture suit les clés étrangères — comptes et titres d'abord,
 * puis ce qui s'y rattache.
 */
export function restaurerDansBase(
  pilote: PiloteSqlite,
  contenu: ContenuArchive,
): RapportRestauration {
  return pilote.transaction(() => {
    // Ordre inverse des dépendances pour la suppression.
    pilote.executer('DELETE FROM cours');
    pilote.executer('DELETE FROM transactions');
    pilote.executer('DELETE FROM titres');
    pilote.executer('DELETE FROM comptes');
    pilote.executer('DELETE FROM parametres');

    const comptes = new DepotComptes(pilote);
    for (const compte of contenu.comptes) {
      comptes.enregistrer(compte);
    }

    const titres = new DepotTitres(pilote);
    for (const titre of contenu.titres) {
      titres.enregistrer(titre);
    }

    const transactions = new DepotTransactions(pilote);
    for (const transaction of contenu.transactions) {
      transactions.enregistrer(transaction);
    }

    const cours = new DepotCours(pilote);
    for (const ligne of contenu.cours) {
      cours.enregistrer(ligne.titreId, ligne.date, Decimal.de(ligne.cloture));
    }

    const parametres = new DepotParametres(pilote);
    for (const parametre of contenu.parametres) {
      parametres.ecrire(parametre.cle, parametre.valeur);
    }

    return {
      comptes: contenu.comptes.length,
      titres: contenu.titres.length,
      transactions: contenu.transactions.length,
      cours: contenu.cours.length,
      parametres: contenu.parametres.length,
    };
  });
}
