/**
 * Modèles de vue des onglets du portefeuille.
 *
 * Même principe que pour le tableau de bord : tout le calcul et tout le
 * formatage vivent ici, les écrans n'affichent que des chaînes prêtes.
 *
 * Particularité de ces trois onglets : ils manipulent des mesures qui peuvent
 * légitimement ne pas exister. Une mesure indisponible est donc un cas de
 * premier rang — elle porte un motif affichable — et non une exception.
 */

import { Decimal } from '../../core/money/decimal';
import type { Cession, Compte, Transaction } from '../../core/domain/types';
import type { EtatPortefeuille } from '../../core/portfolio/engine';
import { plusValuesParAnnee } from '../../core/portfolio/engine';
import {
  annualiser,
  drawdown,
  joursEntre,
  rendementsPeriodiques,
  sharpe,
  tri,
  twr,
  volatilite,
  type PointValorisation,
} from '../../core/performance/rendements';
import { fluxPourTri } from '../../core/performance/serie';
import { impotSurGainCTO } from '../../core/tax/impots';
import {
  ancienneteEnAnnees,
  estExonereImpotRevenu,
  estPEA,
  etatPlafond,
} from '../../core/tax/pea';
import {
  formaterDate,
  formaterMontant,
  formaterPourcentage,
  formaterTypeCompte,
  tendance,
  type Tendance,
} from '../format';

/** Mesure prête à afficher, éventuellement absente et motivée. */
export interface MesureAffichee {
  valeur: string | null;
  motif?: string;
}

function afficherMesure(
  mesure: { valeur: number | null; motif?: string },
  decimales = 2,
  suffixe = ' %',
): MesureAffichee {
  if (mesure.valeur === null) {
    return { valeur: null, motif: mesure.motif };
  }
  return {
    valeur: `${formaterMontant(mesure.valeur, {
      decimales,
      signeExplicite: true,
      devise: null,
    })}${suffixe}`,
  };
}

// ------------------------------------------------------------ Performances

export interface PointGraphique {
  date: string;
  valeur: string;
  /** Position verticale entre 0 et 1, pour tracer la courbe. */
  fraction: number;
}

export interface VuePerformance {
  /** Nombre de points de valorisation disponibles. */
  nombrePoints: number;
  /** Explication quand l'historique ne permet pas de mesurer. */
  messageHistorique?: string;
  twr: MesureAffichee;
  tri: MesureAffichee;
  rendementAnnualise: MesureAffichee;
  volatilite: MesureAffichee;
  sharpe: MesureAffichee;
  perteMaximale: MesureAffichee;
  baisseEnCours: MesureAffichee;
  dateCreux?: string;
  points: PointGraphique[];
  /** Nombre de jours couverts par l'historique. */
  jours: number;
}

export interface EntreesPerformance {
  points: readonly PointValorisation[];
  transactions: readonly Transaction[];
}

export function construirePerformance(entrees: EntreesPerformance): VuePerformance {
  const { points } = entrees;
  const indisponible = (motif: string): MesureAffichee => ({ valeur: null, motif });

  if (points.length < 2) {
    const motif =
      points.length === 0
        ? "Aucune valorisation enregistrée. Rafraîchissez les cours pour commencer l’historique."
        : "Une seule valorisation connue. La performance se mesure entre deux relevés : revenez après un prochain rafraîchissement des cours.";

    return {
      nombrePoints: points.length,
      messageHistorique: motif,
      twr: indisponible(motif),
      tri: indisponible(motif),
      rendementAnnualise: indisponible(motif),
      volatilite: indisponible(motif),
      sharpe: indisponible(motif),
      perteMaximale: indisponible(motif),
      baisseEnCours: indisponible(motif),
      points: [],
      jours: 0,
    };
  }

  const premier = points[0];
  const dernier = points[points.length - 1];
  const jours = joursEntre(premier.date, dernier.date);

  const mesureTwr = twr(points);
  const annualise =
    mesureTwr.valeur === null
      ? { valeur: null, motif: mesureTwr.motif }
      : annualiser(mesureTwr.valeur, jours);

  const rendements = rendementsPeriodiques(points);
  // Les points suivent les relevés de cours, pas un rythme fixe : on annualise
  // sur une base quotidienne, l'hypothèse la moins fausse ici.
  const mesureVolatilite = volatilite(rendements, 252);
  const mesureSharpe =
    annualise.valeur !== null && mesureVolatilite.valeur !== null
      ? sharpe(annualise.valeur, mesureVolatilite.valeur)
      : {
          valeur: null,
          motif: annualise.motif ?? mesureVolatilite.motif,
        };

  const baisse = drawdown(points);
  const valeurs = points.map(point => point.valeurTotale.toNumber());
  const minimum = Math.min(...valeurs);
  const maximum = Math.max(...valeurs);
  const amplitude = maximum - minimum;

  return {
    nombrePoints: points.length,
    twr: afficherMesure(mesureTwr),
    tri: afficherMesure(
      tri(fluxPourTri(entrees.transactions, dernier.valeurTotale, dernier.date)),
    ),
    rendementAnnualise: afficherMesure(annualise),
    volatilite: afficherMesure(mesureVolatilite),
    sharpe: afficherMesure(mesureSharpe, 2, ''),
    perteMaximale: baisse
      ? afficherMesure({ valeur: baisse.perteMaximale })
      : indisponible('Historique insuffisant.'),
    baisseEnCours: baisse
      ? afficherMesure({ valeur: baisse.baisseEnCours })
      : indisponible('Historique insuffisant.'),
    dateCreux: baisse?.dateCreux ? formaterDate(baisse.dateCreux) : undefined,
    points: points.map((point, index) => ({
      date: formaterDate(point.date),
      valeur: formaterMontant(point.valeurTotale),
      // Série plate : tout au milieu, plutôt qu'une division par zéro.
      fraction: amplitude === 0 ? 0.5 : (valeurs[index] - minimum) / amplitude,
    })),
    jours,
  };
}

// -------------------------------------------------------------------- Flux

export interface LigneFluxPeriode {
  periode: string;
  versements: string;
  retraits: string;
  net: string;
  tendance: Tendance;
  /** Poids relatif, pour dessiner une barre. */
  fraction: number;
}

export interface MouvementFlux {
  date: string;
  type: string;
  compte: string;
  montant: string;
  tendance: Tendance;
}

export interface VueFlux {
  versementsTotal: string;
  retraitsTotal: string;
  fluxNet: string;
  tendanceNet: Tendance;
  moyenneMensuelle: string;
  parAnnee: LigneFluxPeriode[];
  mouvements: MouvementFlux[];
  aucunMouvement: boolean;
}

const LIBELLES_FLUX: Record<string, string> = {
  VERSEMENT: 'Dépôt',
  RETRAIT: 'Retrait',
};

export function construireFlux(
  transactions: readonly Transaction[],
  comptes: readonly Compte[],
): VueFlux {
  const nomDuCompte = new Map(comptes.map(compte => [compte.id, compte.nom]));
  const mouvements = transactions
    .filter(t => t.type === 'VERSEMENT' || t.type === 'RETRAIT')
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  let versements = Decimal.ZERO;
  let retraits = Decimal.ZERO;
  const parAnnee = new Map<string, { versements: Decimal; retraits: Decimal }>();

  for (const mouvement of mouvements) {
    const montant = 'montant' in mouvement ? mouvement.montant : Decimal.ZERO;
    const annee = mouvement.date.slice(0, 4);
    const cumul = parAnnee.get(annee) ?? {
      versements: Decimal.ZERO,
      retraits: Decimal.ZERO,
    };

    if (mouvement.type === 'VERSEMENT') {
      versements = versements.add(montant);
      cumul.versements = cumul.versements.add(montant);
    } else {
      retraits = retraits.add(montant);
      cumul.retraits = cumul.retraits.add(montant);
    }
    parAnnee.set(annee, cumul);
  }

  const net = versements.sub(retraits);

  // Moyenne mensuelle calculée sur la période réellement couverte, pas sur
  // douze mois : sur deux mois d'historique, diviser par douze donnerait un
  // versement mensuel quatre fois trop faible.
  const dates = mouvements.map(m => m.date).sort();
  const mois =
    dates.length > 0
      ? Math.max(1, Math.round(joursEntre(dates[0], dates[dates.length - 1]) / 30.44) + 1)
      : 1;

  const maximum = [...parAnnee.values()].reduce(
    (max, cumul) => Decimal.max(max, cumul.versements),
    Decimal.ZERO,
  );

  return {
    versementsTotal: formaterMontant(versements),
    retraitsTotal: formaterMontant(retraits),
    fluxNet: formaterMontant(net, { signeExplicite: true }),
    tendanceNet: tendance(net),
    moyenneMensuelle: formaterMontant(versements.div(mois)),
    parAnnee: [...parAnnee.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([annee, cumul]) => {
        const netAnnee = cumul.versements.sub(cumul.retraits);
        return {
          periode: annee,
          versements: formaterMontant(cumul.versements),
          retraits: formaterMontant(cumul.retraits),
          net: formaterMontant(netAnnee, { signeExplicite: true }),
          tendance: tendance(netAnnee),
          fraction: maximum.estPositif()
            ? cumul.versements.div(maximum).toNumber()
            : 0,
        };
      }),
    mouvements: mouvements.map(mouvement => {
      const montant = 'montant' in mouvement ? mouvement.montant : Decimal.ZERO;
      const entrant = mouvement.type === 'VERSEMENT';
      return {
        date: formaterDate(mouvement.date),
        type: LIBELLES_FLUX[mouvement.type] ?? mouvement.type,
        compte: nomDuCompte.get(mouvement.compteId) ?? mouvement.compteId,
        montant: formaterMontant(entrant ? montant : montant.neg(), {
          signeExplicite: true,
        }),
        tendance: entrant ? 'hausse' : 'baisse',
      };
    }),
    aucunMouvement: mouvements.length === 0,
  };
}

// ------------------------------------------------------------------ Impôts

export interface VuePlafond {
  verse: string;
  plafond: string;
  restant: string;
  pourcentage: string;
  fraction: number;
  depassement?: string;
}

export interface VueCompteFiscal {
  nom: string;
  type: string;
  plafond?: VuePlafond;
  /** Années révolues depuis l'ouverture, pour un PEA. */
  anciennete?: string;
  /** Situation vis-à-vis de l'exonération d'impôt sur le revenu. */
  situationFiscale: string;
  /** Vrai si la vente est imposable sur ce compte. */
  venteImposable: boolean;
}

export interface LigneAnnee {
  annee: number;
  plusValue: string;
  tendance: Tendance;
  impotEstime?: string;
}

export interface VueImpots {
  comptes: VueCompteFiscal[];
  annees: LigneAnnee[];
  aucuneCession: boolean;
  /** Rappel de fin d'année, affiché quand il est utile. */
  rappelFinAnnee?: string;
}

export interface EntreesImpots {
  etat: EtatPortefeuille;
  comptes: readonly Compte[];
  cessions: readonly Cession[];
  /** Date du jour, au format ISO. */
  aujourdhui: string;
}

export function construireImpots(entrees: EntreesImpots): VueImpots {
  const parCompte = new Map(entrees.comptes.map(compte => [compte.id, compte]));

  const comptes: VueCompteFiscal[] = entrees.comptes.map(compte => {
    const etatCompte = entrees.etat.comptes.get(compte.id);
    const versements = etatCompte?.versementsCumules ?? Decimal.ZERO;

    if (!estPEA(compte.type)) {
      return {
        nom: compte.nom,
        type: formaterTypeCompte(compte.type),
        situationFiscale:
          'Chaque vente en gain est imposable, au prélèvement forfaitaire unique de 30 % par défaut.',
        venteImposable: true,
      };
    }

    const plafond = etatPlafond(compte, versements);
    const annees = ancienneteEnAnnees(compte.dateOuverture, entrees.aujourdhui);
    const exonere = estExonereImpotRevenu(compte, entrees.aujourdhui);

    return {
      nom: compte.nom,
      type: formaterTypeCompte(compte.type),
      plafond: {
        verse: formaterMontant(plafond.verse),
        plafond: formaterMontant(plafond.plafond),
        restant: formaterMontant(plafond.restant),
        pourcentage: formaterPourcentage(plafond.pourcentageUtilise, 1),
        fraction: Math.min(1, Math.max(0, plafond.pourcentageUtilise.toNumber() / 100)),
        depassement: plafond.depassement.estPositif()
          ? formaterMontant(plafond.depassement)
          : undefined,
      },
      anciennete: `${annees} an${annees > 1 ? 's' : ''}`,
      situationFiscale: exonere
        ? 'Plan de plus de cinq ans : les gains échappent à l’impôt sur le revenu. Les prélèvements sociaux de 17,2 % restent dus.'
        : `Plan de ${annees} an${annees > 1 ? 's' : ''} : un retrait serait taxé à 30 % et fermerait le plan. L’exonération arrive à cinq ans.`,
      venteImposable: false,
    };
  });

  const parAnnee = plusValuesParAnnee(entrees.cessions);
  const annees: LigneAnnee[] = [...parAnnee.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([annee, plusValue]) => {
      // L'impôt n'est estimé que sur les cessions de comptes-titres : dans un
      // PEA, une vente ne déclenche rien.
      const cessionsImposables = entrees.cessions.filter(
        cession =>
          cession.annee === annee &&
          !estPEA(parCompte.get(cession.compteId)?.type ?? 'CTO'),
      );
      const gainImposable = Decimal.somme(
        cessionsImposables.map(cession => cession.plusValue),
      );

      return {
        annee,
        plusValue: formaterMontant(plusValue, { signeExplicite: true }),
        tendance: tendance(plusValue),
        impotEstime: gainImposable.estPositif()
          ? formaterMontant(impotSurGainCTO(gainImposable).total)
          : undefined,
      };
    });

  const anneeCourante = Number(entrees.aujourdhui.slice(0, 4));
  const gainCourant = parAnnee.get(anneeCourante);
  const mois = Number(entrees.aujourdhui.slice(5, 7));

  return {
    comptes,
    annees,
    aucuneCession: entrees.cessions.length === 0,
    rappelFinAnnee:
      mois >= 11 && gainCourant?.estPositif()
        ? `Vous avez réalisé ${formaterMontant(gainCourant)} de plus-values cette année. Solder une ligne en moins-value avant le 31 décembre les réduirait d’autant.`
        : undefined,
  };
}
