/**
 * Modèle de vue de l'onglet Résumé.
 *
 * Trois chiffres d'abord — ce que vaut le portefeuille, ce qu'il a rapporté,
 * ce qu'il a versé en dividendes — puis la courbe de performance face à une
 * référence, la répartition entre comptes, les meilleures et moins bonnes
 * lignes, et une carte par compte.
 *
 * Le « Total Return » est dit en euros avant de l'être en pourcentage : c'est
 * la différence entre ce que vaut le portefeuille et ce qu'on y a versé, net
 * des retraits. Un chiffre qui se vérifie de tête.
 */

import { Decimal } from '../../core/money/decimal';
import type { Compte, Titre, Transaction } from '../../core/domain/types';
import type { EtatPortefeuille } from '../../core/portfolio/engine';
import { valoriserPositions, totaux } from '../../core/portfolio/valorisation';
import {
  annualiser,
  joursEntre,
  tri,
  type PointValorisation,
} from '../../core/performance/rendements';
import { fluxPourTri, type CoursDate } from '../../core/performance/serie';
import {
  alignerReference,
  debutPeriode,
  facteursCours,
  facteursTwr,
  rebaser,
  type FacteurDate,
  type Periode,
  type PointPourcentage,
} from '../../core/performance/cumul';
import {
  formaterDate,
  formaterMontant,
  formaterPourcentage,
  formaterTypeCompte,
  tendance,
  type Tendance,
} from '../format';

export interface ValeurSignee {
  texte: string;
  tendance: Tendance;
}

export interface LigneClassement {
  titreId: string;
  nom: string;
  symbole: string;
  variationPct: ValeurSignee;
  variation: ValeurSignee;
}

export interface CarteCompte {
  compteId: string;
  nom: string;
  type: string;
  depuis: string;
  frais: string;
  solde: string;
  valeurTotale: string;
  investi: string;
  totalReturn: ValeurSignee;
  totalReturnPct: ValeurSignee;
  tri: ValeurSignee | null;
  dividendes: string;
  rendementDividendes: string;
}

export interface PartCompte {
  libelle: string;
  valeur: number;
  texte: string;
}

export interface VueResume {
  sousTitre: string;
  /** Variation sur la dernière séance, versements neutralisés. */
  variationSeance?: { montant: ValeurSignee; pourcentage: ValeurSignee; date: string };
  devise: string;
  valeurTotale: string;
  investi: string;
  totalReturn: ValeurSignee;
  totalReturnPct: ValeurSignee;
  tri: ValeurSignee | null;
  motifTri?: string;
  dividendes: string;
  rendementDividendes: string;
  /** Facteurs cumulés du portefeuille, à rebaser selon la période choisie. */
  facteursPortefeuille: FacteurDate[];
  /** Facteurs de la référence, s'il y en a une avec des cours. */
  facteursReference: FacteurDate[];
  nomReference?: string;
  repartitionComptes: PartCompte[];
  top: LigneClassement[];
  flop: LigneClassement[];
  comptes: CarteCompte[];
  /** Vrai quand aucune courbe n'est traçable faute de cours historiques. */
  sansHistorique: boolean;
}

export interface EntreesResume {
  etat: EtatPortefeuille;
  comptes: readonly Compte[];
  titres: readonly Titre[];
  transactions: readonly Transaction[];
  cours: ReadonlyMap<string, Decimal>;
  points: readonly PointValorisation[];
  reference?: { nom: string; serie: readonly CoursDate[] };
  aujourdhui: string;
}

const TAILLE_CLASSEMENT = 5;

function signe(valeur: Decimal | number, texte: string): ValeurSignee {
  return { texte, tendance: tendance(valeur) };
}

function pourcentageDe(part: Decimal, total: Decimal): Decimal | null {
  return total.estPositif() ? part.div(total).mul(100) : null;
}

function dividendesDouzeMois(
  transactions: readonly Transaction[],
  aujourdhui: string,
): Decimal {
  const annee = Number(aujourdhui.slice(0, 4));
  const depuis = `${annee - 1}${aujourdhui.slice(4)}`;
  return Decimal.somme(
    transactions
      .filter(t => t.type === 'DIVIDENDE' && t.date > depuis && t.date <= aujourdhui)
      .map(t => (t.type === 'DIVIDENDE' ? t.montantNet : Decimal.ZERO)),
  );
}

function mesureTri(
  transactions: readonly Transaction[],
  valeur: Decimal,
  aujourdhui: string,
): { valeur: ValeurSignee | null; motif?: string } {
  const mesure = tri(fluxPourTri(transactions, valeur, aujourdhui));
  if (mesure.valeur === null) {
    return { valeur: null, motif: mesure.motif };
  }
  return {
    valeur: signe(
      mesure.valeur,
      formaterPourcentage(mesure.valeur),
    ),
  };
}

export function construireResume(entrees: EntreesResume): VueResume {
  const titres = new Map(entrees.titres.map(titre => [titre.id, titre]));
  const { valorisees } = valoriserPositions(entrees.etat.positions, entrees.cours);
  const etatsComptes = [...entrees.etat.comptes.values()];
  const agregats = totaux(valorisees, etatsComptes);

  const verse = Decimal.somme(etatsComptes.map(compte => compte.versementsCumules));
  const retire = Decimal.somme(etatsComptes.map(compte => compte.retraitsCumules));
  const investi = verse.sub(retire);
  const gain = agregats.valeurTotale.sub(investi);
  const gainPct = pourcentageDe(gain, investi);

  const dividendes = Decimal.somme(etatsComptes.map(compte => compte.dividendesPercus));
  const douzeMois = dividendesDouzeMois(entrees.transactions, entrees.aujourdhui);
  const rendement = pourcentageDe(douzeMois, agregats.valeurTotale);

  const triGlobal = mesureTri(entrees.transactions, agregats.valeurTotale, entrees.aujourdhui);

  // Classement des lignes par plus-value en pourcentage : ce qui a le mieux
  // et le moins bien marché, indépendamment de la taille de la ligne.
  const classees = valorisees
    .map(position => {
      const titre = titres.get(position.titreId);
      return {
        titreId: position.titreId,
        nom: titre?.nom ?? position.titreId,
        symbole: titre?.ticker ?? '',
        pct: position.plusValueLatentePct,
        montant: position.plusValueLatente,
      };
    })
    .filter(ligne => ligne.pct !== null);

  const enLigne = (ligne: (typeof classees)[number]): LigneClassement => ({
    titreId: ligne.titreId,
    nom: ligne.nom,
    symbole: ligne.symbole,
    variationPct: signe(ligne.pct!, formaterPourcentage(ligne.pct)),
    variation: signe(ligne.montant, formaterMontant(ligne.montant, { signeExplicite: true })),
  });

  const top = classees
    .filter(ligne => ligne.pct!.estPositif())
    .sort((a, b) => b.pct!.compare(a.pct!))
    .slice(0, TAILLE_CLASSEMENT)
    .map(enLigne);
  const flop = classees
    .filter(ligne => ligne.pct!.estNegatif())
    .sort((a, b) => a.pct!.compare(b.pct!))
    .slice(0, TAILLE_CLASSEMENT)
    .map(enLigne);

  const valeurParCompte = new Map<string, Decimal>();
  for (const position of valorisees) {
    valeurParCompte.set(
      position.compteId,
      (valeurParCompte.get(position.compteId) ?? Decimal.ZERO).add(position.valeurMarche),
    );
  }

  const comptes: CarteCompte[] = entrees.comptes.map(compte => {
    const etat = entrees.etat.comptes.get(compte.id);
    const cash = etat?.cash ?? Decimal.ZERO;
    const valeur = (valeurParCompte.get(compte.id) ?? Decimal.ZERO).add(cash);
    const investiCompte = (etat?.versementsCumules ?? Decimal.ZERO).sub(
      etat?.retraitsCumules ?? Decimal.ZERO,
    );
    const gainCompte = valeur.sub(investiCompte);
    const transactionsCompte = entrees.transactions.filter(t => t.compteId === compte.id);
    const douzeMoisCompte = dividendesDouzeMois(transactionsCompte, entrees.aujourdhui);
    const gainPctCompte = pourcentageDe(gainCompte, investiCompte);

    return {
      compteId: compte.id,
      nom: compte.nom,
      type: formaterTypeCompte(compte.type),
      depuis: formaterDate(compte.dateOuverture),
      frais: formaterMontant(etat?.fraisCumules ?? Decimal.ZERO),
      solde: formaterMontant(cash),
      valeurTotale: formaterMontant(valeur),
      investi: formaterMontant(investiCompte),
      totalReturn: signe(gainCompte, formaterMontant(gainCompte, { signeExplicite: true })),
      totalReturnPct: signe(gainPctCompte ?? 0, formaterPourcentage(gainPctCompte)),
      tri: mesureTri(transactionsCompte, valeur, entrees.aujourdhui).valeur,
      dividendes: formaterMontant(etat?.dividendesPercus ?? Decimal.ZERO),
      rendementDividendes: formaterPourcentage(pourcentageDe(douzeMoisCompte, valeur), 2, {
        signeExplicite: false,
      }),
    };
  });

  const repartitionComptes: PartCompte[] = entrees.comptes
    .map(compte => {
      const cash = entrees.etat.comptes.get(compte.id)?.cash ?? Decimal.ZERO;
      const valeur = (valeurParCompte.get(compte.id) ?? Decimal.ZERO).add(cash);
      return { libelle: compte.nom, valeur: valeur.toNumber(), texte: formaterMontant(valeur) };
    })
    .filter(part => part.valeur > 0);

  const facteursPortefeuille = facteursTwr(entrees.points);
  const facteursReference = entrees.reference ? facteursCours(entrees.reference.serie) : [];

  // Dernière séance : écart entre les deux derniers points, flux retirés.
  const points = entrees.points;
  const dernier = points[points.length - 1];
  const veille = points[points.length - 2];
  let variationSeance: VueResume['variationSeance'];
  if (dernier && veille && veille.valeurTotale.estPositif()) {
    const ecart = dernier.valeurTotale.sub(dernier.fluxExterne).sub(veille.valeurTotale);
    const pct = ecart.div(veille.valeurTotale).mul(100);
    variationSeance = {
      montant: signe(ecart, formaterMontant(ecart, { signeExplicite: true })),
      pourcentage: signe(pct, formaterPourcentage(pct)),
      date: formaterDate(dernier.date),
    };
  }

  const nombre = entrees.comptes.length;
  return {
    variationSeance,
    sousTitre:
      nombre === 0
        ? 'Commencez par créer un compte titre.'
        : `${nombre} compte${nombre > 1 ? 's' : ''} titre paramétré${nombre > 1 ? 's' : ''}.`,
    devise: entrees.comptes[0]?.devise ?? 'EUR',
    valeurTotale: formaterMontant(agregats.valeurTotale),
    investi: formaterMontant(investi),
    totalReturn: signe(gain, formaterMontant(gain, { signeExplicite: true })),
    totalReturnPct: signe(gainPct ?? 0, formaterPourcentage(gainPct)),
    tri: triGlobal.valeur,
    motifTri: triGlobal.motif,
    dividendes: formaterMontant(dividendes),
    rendementDividendes: formaterPourcentage(rendement, 2, { signeExplicite: false }),
    facteursPortefeuille,
    facteursReference,
    nomReference: entrees.reference?.nom,
    repartitionComptes,
    top,
    flop,
    comptes,
    sansHistorique: facteursPortefeuille.length < 2,
  };
}

export interface CourbePerformance {
  portefeuille: PointPourcentage[];
  reference: PointPourcentage[];
  /** Rendement de la fenêtre, formaté. */
  performance: ValeurSignee | null;
  performanceReference: ValeurSignee | null;
  /** Rendement annualisé de la fenêtre, s'il a un sens. */
  cagr: string | null;
  cagrReference: string | null;
}

function annualiseTexte(points: readonly PointPourcentage[]): string | null {
  if (points.length < 2) {
    return null;
  }
  const jours = joursEntre(points[0].date, points[points.length - 1].date);
  const mesure = annualiser(points[points.length - 1].valeur, jours);
  return mesure.valeur === null ? null : formaterPourcentage(mesure.valeur);
}

/** Courbes d'une période, prêtes à tracer. */
export function courbePerformance(
  vue: Pick<VueResume, 'facteursPortefeuille' | 'facteursReference'>,
  periode: Periode,
  aujourdhui: string,
): CourbePerformance {
  const portefeuille = rebaser(vue.facteursPortefeuille, debutPeriode(periode, aujourdhui));
  const reference = alignerReference(vue.facteursReference, portefeuille);
  const dernier = portefeuille[portefeuille.length - 1];
  const dernierReference = reference[reference.length - 1];

  return {
    portefeuille,
    reference,
    performance:
      dernier && portefeuille.length > 1
        ? signe(dernier.valeur, formaterPourcentage(dernier.valeur))
        : null,
    performanceReference:
      dernierReference && reference.length > 1
        ? signe(dernierReference.valeur, formaterPourcentage(dernierReference.valeur))
        : null,
    cagr: annualiseTexte(portefeuille),
    cagrReference: annualiseTexte(reference),
  };
}
