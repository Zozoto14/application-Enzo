/**
 * Modèle de vue du tableau de bord.
 *
 * Tout le travail de préparation de l'écran est fait ici, en données pures :
 * les composants n'ont plus qu'à afficher des chaînes déjà formatées. C'est ce
 * qui permet de tester ce que l'utilisateur lira réellement, sans monter un
 * rendu React ni un appareil.
 */

import { Decimal } from '../../core/money/decimal';
import type { Compte, EtatCompte, Titre } from '../../core/domain/types';
import type { EtatPortefeuille } from '../../core/portfolio/engine';
import {
  repartition,
  totaux,
  valoriserPositions,
  type PositionValorisee,
} from '../../core/portfolio/valorisation';
import {
  formaterMontant,
  formaterPourcentage,
  formaterQuantite,
  formaterTypeCompte,
  tendance,
  type Tendance,
} from '../format';

export interface LignePosition {
  titreId: string;
  nom: string;
  quantite: string;
  pru: string;
  cours: string;
  valeur: string;
  plusValue: string;
  plusValuePct: string;
  tendance: Tendance;
  compte: string;
  /**
   * Ligne de detail prete a afficher. Composee ici plutot que dans le JSX :
   * un texte assemble de fragments React se cherche mal dans les tests, et
   * surtout se relit mal quand il faut verifier ce que l'utilisateur voit.
   */
  resume: string;
}

export interface LigneRepartitionVue {
  cle: string;
  valeur: string;
  pourcentage: string;
  /** Part entre 0 et 1, pour dessiner une barre. */
  fraction: number;
}

export interface VueDashboard {
  valeurTotale: string;
  valeurTitres: string;
  cash: string;
  plusValueLatente: string;
  plusValueLatentePct: string;
  tendance: Tendance;
  positions: LignePosition[];
  repartitionParCompte: LigneRepartitionVue[];
  /**
   * Titres détenus dont aucun cours n'est connu. Ils sont exclus des totaux :
   * l'écran doit le dire, sinon l'utilisateur lit un patrimoine amputé sans
   * savoir pourquoi.
   */
  titresSansCours: string[];
  portefeuilleVide: boolean;
  /**
   * Aucun compte n'existe encore. Distinct d'un portefeuille vide : sans
   * compte, ni saisie ni import ne sont possibles, et l'ecran doit proposer
   * d'en creer un plutot qu'une operation.
   */
  sansCompte: boolean;
}

export interface EntreesDashboard {
  etat: EtatPortefeuille;
  comptes: readonly Compte[];
  titres: readonly Titre[];
  cours: ReadonlyMap<string, Decimal>;
}

function nomDuTitre(titres: ReadonlyMap<string, Titre>, titreId: string): string {
  return titres.get(titreId)?.nom ?? titreId;
}

function ligneDePosition(
  position: PositionValorisee,
  titres: ReadonlyMap<string, Titre>,
  comptes: ReadonlyMap<string, Compte>,
): LignePosition {
  const compte = comptes.get(position.compteId);
  return {
    titreId: position.titreId,
    nom: nomDuTitre(titres, position.titreId),
    quantite: formaterQuantite(position.quantite),
    pru: formaterMontant(position.pru),
    cours: formaterMontant(position.cours),
    valeur: formaterMontant(position.valeurMarche),
    plusValue: formaterMontant(position.plusValueLatente, { signeExplicite: true }),
    plusValuePct: formaterPourcentage(position.plusValueLatentePct),
    tendance: tendance(position.plusValueLatente),
    compte: compte ? compte.nom : formaterTypeCompte(position.compteId),
    resume: `${formaterQuantite(position.quantite)} x ${formaterMontant(
      position.cours,
    )} - PRU ${formaterMontant(position.pru)}`,
  };
}

export function construireDashboard(entrees: EntreesDashboard): VueDashboard {
  const titres = new Map(entrees.titres.map(titre => [titre.id, titre]));
  const comptes = new Map(entrees.comptes.map(compte => [compte.id, compte]));

  const { valorisees, sansCours } = valoriserPositions(
    entrees.etat.positions,
    entrees.cours,
  );
  const etatsComptes: EtatCompte[] = [...entrees.etat.comptes.values()];
  const agregats = totaux(valorisees, etatsComptes);

  const lignes = [...valorisees]
    .sort((a, b) => b.valeurMarche.compare(a.valeurMarche))
    .map(position => ligneDePosition(position, titres, comptes));

  const parCompte = repartition(valorisees, titres, 'compte').map(ligne => ({
    cle: comptes.get(ligne.cle)?.nom ?? ligne.cle,
    valeur: formaterMontant(ligne.valeur),
    pourcentage: formaterPourcentage(ligne.pourcentage, 1),
    fraction: Math.min(1, Math.max(0, ligne.pourcentage.toNumber() / 100)),
  }));

  return {
    valeurTotale: formaterMontant(agregats.valeurTotale),
    valeurTitres: formaterMontant(agregats.valeurTitres),
    cash: formaterMontant(agregats.cash),
    plusValueLatente: formaterMontant(agregats.plusValueLatente, {
      signeExplicite: true,
    }),
    plusValueLatentePct: formaterPourcentage(agregats.plusValueLatentePct),
    tendance: tendance(agregats.plusValueLatente),
    positions: lignes,
    repartitionParCompte: parCompte,
    titresSansCours: sansCours.map(position => nomDuTitre(titres, position.titreId)),
    portefeuilleVide: entrees.etat.positions.length === 0 && agregats.cash.estZero(),
    sansCompte: entrees.comptes.length === 0,
  };
}
