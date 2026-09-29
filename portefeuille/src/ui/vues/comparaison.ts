/**
 * Modèle de vue de la comparaison à un indice de référence.
 *
 * Aucune donnée d'indice n'est fabriquée ni téléchargée en douce : la
 * référence est une valeur du portefeuille comme une autre — un tracker, un
 * indice saisi à la main — dont les cours viennent du même historique.
 *
 * Deux choses sont dites franchement, parce qu'elles décident de la lecture :
 * **sur quelle période** la comparaison porte, et **qu'elle ne porte pas sur
 * toute votre histoire** si la référence est plus jeune.
 */

import type { Titre } from '../../core/domain/types';
import type { PointValorisation } from '../../core/performance/rendements';
import { comparerAReference } from '../../core/performance/reference';
import type { HistoriqueCours } from '../../core/performance/serie';
import { formaterDate, formaterMontant, formaterPourcentage, tendance, type Tendance } from '../format';

export interface MesureComparee {
  valeur: string | null;
  motif?: string;
}

export interface ChoixReference {
  titreId: string;
  nom: string;
  /** Nombre de cours enregistrés, pour que le choix soit éclairé. */
  releves: number;
  /** Vrai si cette valeur est la référence retenue. */
  retenu: boolean;
}

export interface VueComparaison {
  /** Nom de la référence retenue, absent si aucune. */
  nom?: string;
  portefeuille: MesureComparee;
  reference: MesureComparee;
  ecart: MesureComparee;
  tendanceEcart: Tendance;
  beta: MesureComparee;
  alpha: MesureComparee;
  correlation: MesureComparee;
  /** Phrase qui situe la période réellement comparée. */
  periode?: string;
  /** Verdict en une phrase, quand l'écart est mesurable. */
  verdict?: string;
  /** Valeurs proposables comme référence. */
  choix: ChoixReference[];
  /** Explication quand rien n'est comparable. */
  message?: string;
}

export interface EntreesComparaison {
  points: readonly PointValorisation[];
  titres: readonly Titre[];
  historique: HistoriqueCours;
  /** Identifiant de la valeur retenue comme référence, s'il y en a une. */
  referenceId?: string;
}

function pourcentage(mesure: { valeur: number | null; motif?: string }): MesureComparee {
  return mesure.valeur === null
    ? { valeur: null, motif: mesure.motif }
    : { valeur: formaterPourcentage(mesure.valeur) };
}

/** Le bêta est un coefficient, pas un pourcentage : « 1,24 », sans signe. */
function coefficient(mesure: {
  valeur: number | null;
  motif?: string;
}): MesureComparee {
  return mesure.valeur === null
    ? { valeur: null, motif: mesure.motif }
    : { valeur: formaterMontant(mesure.valeur, { decimales: 2, devise: null }) };
}

function verdictEcart(ecart: number, nom: string): string {
  if (Math.abs(ecart) < 0.5) {
    return `Vous faites jeu égal avec ${nom} sur la période.`;
  }
  if (ecart > 0) {
    return `Vous faites mieux que ${nom} de ${formaterPourcentage(ecart)} sur la période. Un écart se juge sur des années, pas sur des semaines.`;
  }
  return `Vous faites moins bien que ${nom} de ${formaterPourcentage(Math.abs(ecart), 2, { signeExplicite: false })} sur la période. C’est le cas de la plupart des portefeuilles, la plupart du temps.`;
}

export function construireComparaison(entrees: EntreesComparaison): VueComparaison {
  const choix: ChoixReference[] = entrees.titres
    .map(titre => ({
      titreId: titre.id,
      nom: titre.nom,
      releves: (entrees.historique.get(titre.id) ?? []).length,
      retenu: titre.id === entrees.referenceId,
    }))
    .sort((a, b) => b.releves - a.releves);

  const vide: VueComparaison = {
    portefeuille: { valeur: null },
    reference: { valeur: null },
    ecart: { valeur: null },
    tendanceEcart: 'neutre',
    beta: { valeur: null },
    alpha: { valeur: null },
    correlation: { valeur: null },
    choix,
  };

  if (!entrees.referenceId) {
    return {
      ...vide,
      message:
        'Choisissez une valeur de référence — un tracker large, ou un indice dont vous saisissez les cours. La comparaison se fera sur ses relevés, jamais sur une donnée téléchargée ailleurs.',
    };
  }

  const titre = entrees.titres.find(valeur => valeur.id === entrees.referenceId);
  const serie = entrees.historique.get(entrees.referenceId) ?? [];
  const nom = titre?.nom ?? entrees.referenceId;

  const comparaison = comparerAReference(entrees.points, serie);

  const periode =
    comparaison.debut && comparaison.fin
      ? `Du ${formaterDate(comparaison.debut)} au ${formaterDate(comparaison.fin)}, soit ${comparaison.jours} jour(s) — la période où vos deux historiques se recouvrent.`
      : undefined;

  return {
    nom,
    portefeuille: pourcentage(comparaison.portefeuille),
    reference: pourcentage(comparaison.reference),
    ecart: pourcentage(comparaison.ecart),
    tendanceEcart: tendance(comparaison.ecart.valeur),
    beta: coefficient(comparaison.beta),
    alpha: pourcentage(comparaison.alpha),
    correlation: coefficient(comparaison.correlation),
    periode,
    verdict:
      comparaison.ecart.valeur === null
        ? undefined
        : verdictEcart(comparaison.ecart.valeur, nom),
    choix,
    message: comparaison.ecart.valeur === null ? comparaison.ecart.motif : undefined,
  };
}
