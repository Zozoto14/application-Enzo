/**
 * Modèle de vue des projections.
 *
 * Le rôle de cette couche est surtout de **refuser de dire plus que ce qu'on
 * sait**. Une projection se présente donc avec sa fourchette, jamais avec un
 * chiffre seul, et chaque hypothèse reste visible à côté de son résultat.
 */

import { Decimal } from '../../core/money/decimal';
import {
  ECART_SCENARIOS,
  INFLATION_DEFAUT,
  TAUX_RETRAIT_DEFAUT,
  independance,
  scenarios,
  type HypothesesProjection,
} from '../../core/projection/projection';
import { formaterMontant, formaterPourcentage } from '../format';

export interface ChampsProjection {
  capital: string;
  versementMensuel: string;
  rendementAnnuel: string;
  fraisAnnuels: string;
  inflation: string;
  annees: string;
  depensesAnnuelles: string;
  tauxRetrait: string;
}

export const CHAMPS_DEFAUT: ChampsProjection = {
  capital: '',
  versementMensuel: '300',
  rendementAnnuel: '7',
  fraisAnnuels: '0,5',
  inflation: String(INFLATION_DEFAUT),
  annees: '20',
  depensesAnnuelles: '',
  tauxRetrait: String(TAUX_RETRAIT_DEFAUT),
};

export interface PointCourbe {
  annee: number;
  /** Position verticale du scénario central, entre 0 et 1. */
  fraction: number;
  /** Position du scénario prudent, pour dessiner la fourchette. */
  fractionBasse: number;
  fractionHaute: number;
}

export interface VueProjection {
  /** Capital final du scénario central, en euros d'aujourd'hui. */
  centralReel: string;
  centralNominal: string;
  fourchette: string;
  verse: string;
  interets: string;
  /** Phrase qui situe la part des intérêts. */
  commentaireInterets: string;
  anneeBascule?: string;
  rendementNet: string;
  courbe: PointCourbe[];
  /** Renseigné quand un objectif de dépenses est saisi. */
  objectif?: {
    capitalNecessaire: string;
    resume: string;
    fraction: number;
  };
  /** Erreurs de saisie, champ par champ. */
  erreurs: Partial<Record<keyof ChampsProjection, string>>;
  /** Vrai si la projection a pu être calculée. */
  calculable: boolean;
}

/** Lit un nombre saisi à la française, virgule comprise. */
export function nombreSaisi(texte: string): number | undefined {
  const propre = texte.replace(/\s/g, '').replace(',', '.');
  if (propre === '') {
    return undefined;
  }
  const valeur = Number(propre);
  return Number.isFinite(valeur) ? valeur : undefined;
}

function erreurNombre(
  texte: string,
  { obligatoire = false, minimum, maximum }: {
    obligatoire?: boolean;
    minimum?: number;
    maximum?: number;
  } = {},
): string | undefined {
  const valeur = nombreSaisi(texte);
  if (valeur === undefined) {
    return obligatoire && texte.trim() !== '' ? 'Nombre attendu.' : undefined;
  }
  if (minimum !== undefined && valeur < minimum) {
    return `Au minimum ${minimum}.`;
  }
  if (maximum !== undefined && valeur > maximum) {
    return `Au maximum ${maximum}.`;
  }
  return undefined;
}

export interface EntreesProjection {
  champs: ChampsProjection;
  /** Valeur actuelle du portefeuille, proposée comme capital de départ. */
  capitalActuel: Decimal;
}

export function construireProjection(entrees: EntreesProjection): VueProjection {
  const { champs } = entrees;

  const erreurs: Partial<Record<keyof ChampsProjection, string>> = {};
  const poser = (cle: keyof ChampsProjection, erreur?: string) => {
    if (erreur) {
      erreurs[cle] = erreur;
    }
  };

  poser('capital', erreurNombre(champs.capital, { obligatoire: true, minimum: 0 }));
  poser(
    'versementMensuel',
    erreurNombre(champs.versementMensuel, { obligatoire: true, minimum: 0 }),
  );
  poser(
    'rendementAnnuel',
    erreurNombre(champs.rendementAnnuel, { obligatoire: true, minimum: -50, maximum: 50 }),
  );
  poser('fraisAnnuels', erreurNombre(champs.fraisAnnuels, { minimum: 0, maximum: 10 }));
  poser('inflation', erreurNombre(champs.inflation, { minimum: -5, maximum: 20 }));
  poser('annees', erreurNombre(champs.annees, { obligatoire: true, minimum: 0, maximum: 50 }));
  poser('depensesAnnuelles', erreurNombre(champs.depensesAnnuelles, { minimum: 0 }));
  poser('tauxRetrait', erreurNombre(champs.tauxRetrait, { minimum: 0.1, maximum: 20 }));

  // Le capital laisse vide reprend la valeur du portefeuille : c'est le cas
  // courant, et le retaper serait une occasion de se tromper.
  const capitalSaisi = nombreSaisi(champs.capital);
  const capital =
    capitalSaisi === undefined ? entrees.capitalActuel : Decimal.de(capitalSaisi);

  const hypotheses: HypothesesProjection = {
    capital,
    versementMensuel: Decimal.de(nombreSaisi(champs.versementMensuel) ?? 0),
    rendementAnnuel: nombreSaisi(champs.rendementAnnuel) ?? 0,
    fraisAnnuels: nombreSaisi(champs.fraisAnnuels) ?? 0,
    inflation: nombreSaisi(champs.inflation) ?? INFLATION_DEFAUT,
    annees: nombreSaisi(champs.annees) ?? 0,
  };

  const calculable = Object.keys(erreurs).length === 0 && hypotheses.annees > 0;

  if (!calculable) {
    return {
      centralReel: '—',
      centralNominal: '—',
      fourchette: '—',
      verse: '—',
      interets: '—',
      commentaireInterets: 'Complétez les hypothèses pour obtenir une projection.',
      rendementNet: '—',
      courbe: [],
      erreurs,
      calculable: false,
    };
  }

  const trois = scenarios(hypotheses);
  const central = trois.central;

  const maximum = trois.favorable.final.reel.toNumber();
  const courbe: PointCourbe[] = central.points.map((point, index) => ({
    annee: point.annee,
    fraction: maximum > 0 ? point.reel.toNumber() / maximum : 0,
    fractionBasse: maximum > 0 ? trois.prudent.points[index].reel.toNumber() / maximum : 0,
    fractionHaute: maximum > 0 ? trois.favorable.points[index].reel.toNumber() / maximum : 0,
  }));

  const partInterets = central.final.nominal.estPositif()
    ? central.final.interets.div(central.final.nominal).mul(100)
    : Decimal.ZERO;

  const depenses = nombreSaisi(champs.depensesAnnuelles);
  const objectif =
    depenses !== undefined && depenses > 0
      ? (() => {
          const resultat = independance(central, {
            depensesAnnuelles: Decimal.de(depenses),
            tauxRetrait: nombreSaisi(champs.tauxRetrait) ?? TAUX_RETRAIT_DEFAUT,
          });
          return {
            capitalNecessaire: formaterMontant(resultat.capitalNecessaire),
            resume:
              resultat.annees === null
                ? (resultat.motif ?? '')
                : resultat.annees === 0
                  ? 'Ce capital est déjà atteint aujourd’hui.'
                  : `Atteint au bout de ${resultat.annees} an(s), en euros d’aujourd’hui.`,
            fraction: resultat.progression,
          };
        })()
      : undefined;

  return {
    centralReel: formaterMontant(central.final.reel),
    centralNominal: formaterMontant(central.final.nominal),
    fourchette: `de ${formaterMontant(trois.prudent.final.reel)} à ${formaterMontant(trois.favorable.final.reel)}`,
    verse: formaterMontant(central.final.verse),
    interets: formaterMontant(central.final.interets, { signeExplicite: true }),
    commentaireInterets: `Les intérêts représentent ${formaterPourcentage(partInterets, 0, { signeExplicite: false })} du capital final. Le reste, vous l’avez versé.`,
    anneeBascule:
      central.anneeBascule === undefined
        ? undefined
        : `À partir de l’année ${central.anneeBascule}, les intérêts dépassent ce que vous avez versé.`,
    rendementNet: formaterPourcentage(central.rendementNet, 2, { signeExplicite: false }),
    courbe,
    objectif,
    erreurs,
    calculable: true,
  };
}

/** Écart de rendement entre les scénarios, exposé pour l'explication. */
export const ECART_AFFICHE = ECART_SCENARIOS;
