/**
 * Analyses de performance et de risque au-delà des mesures de base.
 *
 * Drawdown dans le temps, rendements mois par mois, ratios de Sortino et de
 * Calmar, frontière efficiente : ce qu'affichent les outils de suivi
 * avancés. Tout part des facteurs cumulés de `cumul.ts` et des séries de
 * cours, jamais d'une donnée recalculée ailleurs.
 *
 * Les mêmes garde-fous qu'ailleurs s'appliquent : une mesure qui n'a pas de
 * sens sur trop peu de données est refusée, avec son motif.
 */

import type { FacteurDate, PointPourcentage } from './cumul';
import type { Mesure } from './rendements';
import { alignerSeries, rendementsDeSerie } from './risque';
import type { CoursDate } from './serie';

const indisponible = (motif: string): Mesure => ({ valeur: null, motif });

// ---------------------------------------------------------------- Drawdown

/** Baisse depuis le plus haut précédent, à chaque date, en pourcentage. */
export function serieDrawdown(facteurs: readonly FacteurDate[]): PointPourcentage[] {
  let sommet = 0;
  return facteurs.map(point => {
    sommet = Math.max(sommet, point.facteur);
    return {
      date: point.date,
      valeur: sommet > 0 ? (point.facteur / sommet - 1) * 100 : 0,
    };
  });
}

const MS_PAR_JOUR = 86_400_000;
const jours = (debut: string, fin: string) =>
  (Date.parse(`${fin}T00:00:00Z`) - Date.parse(`${debut}T00:00:00Z`)) / MS_PAR_JOUR;

/**
 * Plus longue période passée sous un ancien sommet, en jours.
 *
 * Une baisse encore en cours compte jusqu'au dernier point : ne pas l'avoir
 * encore effacée fait partie de la durée.
 */
export function recuperationLaPlusLongue(facteurs: readonly FacteurDate[]): number {
  if (facteurs.length < 2) {
    return 0;
  }
  let sommet = facteurs[0].facteur;
  let dateSommet = facteurs[0].date;
  let sousLeSommet = false;
  let plusLongue = 0;
  for (const point of facteurs) {
    if (point.facteur >= sommet) {
      if (sousLeSommet) {
        plusLongue = Math.max(plusLongue, jours(dateSommet, point.date));
      }
      sommet = point.facteur;
      dateSommet = point.date;
      sousLeSommet = false;
    } else {
      sousLeSommet = true;
    }
  }
  const dernier = facteurs[facteurs.length - 1];
  return sousLeSommet ? Math.max(plusLongue, jours(dateSommet, dernier.date)) : plusLongue;
}

// ------------------------------------------------------ Rendements mensuels

export interface RendementsMensuels {
  /** Année → mois (1 à 12) → rendement du mois, en pourcentage. */
  parMois: Map<number, Map<number, number>>;
  /** Année → rendement de l'année (ou de sa partie couverte). */
  parAnnee: Map<number, number>;
}

/**
 * Rendements mois par mois, chaînés sur les facteurs de fin de mois.
 *
 * Le premier mois se mesure depuis le premier point : un portefeuille ouvert
 * le 20 n'a que dix jours de mars, et c'est ce que dit son mois de mars.
 */
export function rendementsMensuels(facteurs: readonly FacteurDate[]): RendementsMensuels {
  const parMois = new Map<number, Map<number, number>>();
  const parAnnee = new Map<number, number>();
  if (facteurs.length < 2) {
    return { parMois, parAnnee };
  }

  // Dernier facteur connu de chaque mois.
  const finDeMois = new Map<string, number>();
  for (const point of facteurs) {
    finDeMois.set(point.date.slice(0, 7), point.facteur);
  }

  let precedent = facteurs[0].facteur;
  let debutAnnee = facteurs[0].facteur;
  let anneeCourante = Number(facteurs[0].date.slice(0, 4));

  for (const [cle, facteur] of [...finDeMois.entries()].sort()) {
    const annee = Number(cle.slice(0, 4));
    const mois = Number(cle.slice(5, 7));
    if (annee !== anneeCourante) {
      parAnnee.set(anneeCourante, (precedent / debutAnnee - 1) * 100);
      debutAnnee = precedent;
      anneeCourante = annee;
    }
    const ligne = parMois.get(annee) ?? new Map<number, number>();
    ligne.set(mois, precedent > 0 ? (facteur / precedent - 1) * 100 : 0);
    parMois.set(annee, ligne);
    precedent = facteur;
  }
  parAnnee.set(anneeCourante, (precedent / debutAnnee - 1) * 100);

  return { parMois, parAnnee };
}

export interface StatistiquesMensuelles {
  meilleur?: { cle: string; valeur: number };
  pire?: { cle: string; valeur: number };
  /** Part des mois en hausse, en pourcentage. */
  moisPositifs: number | null;
  nombre: number;
}

export function statistiquesMensuelles(rendements: RendementsMensuels): StatistiquesMensuelles {
  const tous: Array<{ cle: string; valeur: number }> = [];
  for (const [annee, ligne] of rendements.parMois) {
    for (const [mois, valeur] of ligne) {
      tous.push({ cle: `${annee}-${String(mois).padStart(2, '0')}`, valeur });
    }
  }
  if (tous.length === 0) {
    return { moisPositifs: null, nombre: 0 };
  }
  const tries = [...tous].sort((a, b) => a.valeur - b.valeur);
  return {
    meilleur: tries[tries.length - 1],
    pire: tries[0],
    moisPositifs: (tous.filter(mois => mois.valeur > 0).length / tous.length) * 100,
    nombre: tous.length,
  };
}

// ------------------------------------------------------- Ratios de risque

/** Rendements successifs d'une série de facteurs, en proportion. */
export function rendementsDeFacteurs(facteurs: readonly FacteurDate[]): number[] {
  const rendements: number[] = [];
  for (let i = 1; i < facteurs.length; i++) {
    if (facteurs[i - 1].facteur > 0) {
      rendements.push(facteurs[i].facteur / facteurs[i - 1].facteur - 1);
    }
  }
  return rendements;
}

/**
 * Volatilité à la baisse : écart-type des seuls rendements négatifs,
 * annualisé, en pourcentage. C'est le risque qu'on ressent.
 */
export function volatiliteBaisse(rendements: readonly number[], periodesParAn = 252): Mesure {
  if (rendements.length < 20) {
    return indisponible('Trop peu de séances pour mesurer la volatilité à la baisse.');
  }
  const carres = rendements.map(r => Math.min(0, r) ** 2);
  const variance = carres.reduce((a, b) => a + b, 0) / rendements.length;
  return { valeur: Math.sqrt(variance) * Math.sqrt(periodesParAn) * 100 };
}

/** Ratio de Sortino : rendement annualisé par unité de volatilité à la baisse. */
export function sortino(rendementAnnualise: number | null, baisse: Mesure): Mesure {
  if (rendementAnnualise === null) {
    return indisponible('Rendement annualisé indisponible.');
  }
  if (baisse.valeur === null || baisse.valeur <= 0) {
    return indisponible(baisse.motif ?? 'Aucune baisse mesurée : le ratio n’est pas défini.');
  }
  return { valeur: rendementAnnualise / baisse.valeur };
}

/** Ratio de Calmar : rendement annualisé rapporté à la perte maximale. */
export function calmar(rendementAnnualise: number | null, perteMaximale: number | null): Mesure {
  if (rendementAnnualise === null || perteMaximale === null) {
    return indisponible('Rendement annualisé ou perte maximale indisponible.');
  }
  if (perteMaximale >= 0) {
    return indisponible('Aucune baisse depuis un sommet : le ratio n’est pas défini.');
  }
  return { valeur: rendementAnnualise / Math.abs(perteMaximale) };
}

// ------------------------------------------------------ Frontière efficiente

export interface Actif {
  id: string;
  serie: readonly CoursDate[];
  /** Poids actuel dans le portefeuille, entre 0 et 1. */
  poids: number;
}

export interface PointRisqueRendement {
  /** Volatilité annualisée, en pourcentage. */
  volatilite: number;
  /** Rendement annualisé, en pourcentage. */
  rendement: number;
}

export interface Frontiere {
  actifs: Array<PointRisqueRendement & { id: string }>;
  actuel: PointRisqueRendement;
  /** Portefeuille qui maximise le ratio de Sharpe. */
  tangence: PointRisqueRendement & { poids: Record<string, number> };
  /** Enveloppe supérieure des portefeuilles possibles, par volatilité croissante. */
  courbe: PointRisqueRendement[];
  /** Nombre de séances communes utilisées. */
  observations: number;
}

/** Générateur pseudo-aléatoire reproductible (mulberry32). */
function generateur(graine: number): () => number {
  let etat = graine >>> 0;
  return () => {
    etat = (etat + 0x6d2b79f5) >>> 0;
    let t = etat;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rendements des actifs sur leurs dates communes, alignés colonne par colonne. */
function rendementsAlignes(actifs: readonly Actif[]): number[][] {
  let dates = new Set(actifs[0].serie.map(point => point.date));
  for (const actif of actifs.slice(1)) {
    const siennes = new Set(actif.serie.map(point => point.date));
    dates = new Set([...dates].filter(date => siennes.has(date)));
  }
  return actifs.map(actif =>
    rendementsDeSerie(actif.serie.filter(point => dates.has(point.date))),
  );
}

/**
 * Frontière efficiente, sans vente à découvert.
 *
 * Moyennes et covariances annualisées sur les séances communes ; puis des
 * milliers de répartitions tirées au hasard — reproductibles — dont on garde,
 * par tranche de volatilité, la plus rentable. Pour quelques lignes, c'est
 * plus robuste qu'une optimisation quadratique, et bien assez précis pour un
 * graphique.
 *
 * Rendements passés, projetés tels quels : la frontière décrit l'historique,
 * pas l'avenir. L'écran doit le dire.
 */
export function frontiereEfficiente(
  actifs: readonly Actif[],
  options: { tirages?: number; tauxSansRisque?: number; observationsMinimum?: number } = {},
): Frontiere | { motif: string } {
  const minimum = options.observationsMinimum ?? 60;
  if (actifs.length < 2) {
    return { motif: 'Il faut au moins deux lignes avec un historique de cours.' };
  }
  const rendements = rendementsAlignes(actifs);
  const n = Math.min(...rendements.map(serie => serie.length));
  if (n < minimum) {
    return { motif: `${n} séances communes, ${minimum} nécessaires pour une frontière qui ait un sens.` };
  }

  const moyennes = rendements.map(serie => serie.slice(0, n).reduce((a, b) => a + b, 0) / n);
  const cov = rendements.map((a, i) =>
    rendements.map((b, j) => {
      let somme = 0;
      for (let k = 0; k < n; k++) {
        somme += (a[k] - moyennes[i]) * (b[k] - moyennes[j]);
      }
      return (somme / (n - 1)) * 252;
    }),
  );
  const annuels = moyennes.map(m => m * 252);

  const evaluer = (poids: readonly number[]): PointRisqueRendement => {
    let rendement = 0;
    let variance = 0;
    for (let i = 0; i < poids.length; i++) {
      rendement += poids[i] * annuels[i];
      for (let j = 0; j < poids.length; j++) {
        variance += poids[i] * poids[j] * cov[i][j];
      }
    }
    return { rendement: rendement * 100, volatilite: Math.sqrt(Math.max(0, variance)) * 100 };
  };

  const hasard = generateur(20260925);
  const tirages = options.tirages ?? 4000;
  const sansRisque = options.tauxSansRisque ?? 0;
  const candidats: Array<PointRisqueRendement & { poids: number[] }> = [];

  // Les portefeuilles à une seule ligne d'abord : ce sont les extrémités.
  for (let i = 0; i < actifs.length; i++) {
    const poids = actifs.map((_, j) => (i === j ? 1 : 0));
    candidats.push({ ...evaluer(poids), poids });
  }
  for (let t = 0; t < tirages; t++) {
    // Loi exponentielle normalisée : des répartitions uniformes sur le simplexe.
    const bruts = actifs.map(() => -Math.log(Math.max(1e-12, hasard())));
    const somme = bruts.reduce((a, b) => a + b, 0);
    const poids = bruts.map(b => b / somme);
    candidats.push({ ...evaluer(poids), poids });
  }

  let tangence = candidats[0];
  let meilleurSharpe = -Infinity;
  for (const candidat of candidats) {
    if (candidat.volatilite <= 0) {
      continue;
    }
    const ratio = (candidat.rendement - sansRisque) / candidat.volatilite;
    if (ratio > meilleurSharpe) {
      meilleurSharpe = ratio;
      tangence = candidat;
    }
  }

  // Enveloppe supérieure : par tranche de volatilité, le meilleur rendement,
  // puis on ne garde que la partie croissante, au-dessus du minimum de variance.
  const volMin = Math.min(...candidats.map(c => c.volatilite));
  const volMax = Math.max(...candidats.map(c => c.volatilite));
  const tranches = 40;
  const meilleurs: PointRisqueRendement[] = [];
  for (let k = 0; k < tranches; k++) {
    const bas = volMin + ((volMax - volMin) * k) / tranches;
    const haut = volMin + ((volMax - volMin) * (k + 1)) / tranches;
    const dans = candidats.filter(c => c.volatilite >= bas && c.volatilite <= haut);
    if (dans.length > 0) {
      const meilleur = dans.reduce((a, b) => (b.rendement > a.rendement ? b : a));
      meilleurs.push({ volatilite: meilleur.volatilite, rendement: meilleur.rendement });
    }
  }
  const depart = meilleurs.reduce((indexMin, point, index) =>
    point.volatilite < meilleurs[indexMin].volatilite ? index : indexMin, 0);
  const courbe: PointRisqueRendement[] = [];
  let plafond = -Infinity;
  for (const point of meilleurs.slice(depart)) {
    if (point.rendement >= plafond) {
      courbe.push(point);
      plafond = point.rendement;
    }
  }

  const totalPoids = actifs.reduce((somme, actif) => somme + actif.poids, 0) || 1;
  return {
    actifs: actifs.map((actif, i) => ({
      id: actif.id,
      ...evaluer(actifs.map((_, j) => (i === j ? 1 : 0))),
    })),
    actuel: evaluer(actifs.map(actif => actif.poids / totalPoids)),
    tangence: {
      volatilite: tangence.volatilite,
      rendement: tangence.rendement,
      poids: Object.fromEntries(actifs.map((actif, i) => [actif.id, tangence.poids[i]])),
    },
    courbe,
    observations: n,
  };
}

// ------------------------------------------------------ Corrélations

/** Corrélation moyenne entre lignes, pondérée par le produit de leurs poids. */
export function correlationMoyennePonderee(
  paires: ReadonlyArray<{ poidsA: number; poidsB: number; correlation: number | null }>,
): number | null {
  let somme = 0;
  let poids = 0;
  for (const paire of paires) {
    if (paire.correlation === null) {
      continue;
    }
    const w = paire.poidsA * paire.poidsB;
    somme += w * paire.correlation;
    poids += w;
  }
  return poids > 0 ? somme / poids : null;
}

/** Deux séries de cours rebasées au même départ, pour superposer leurs courbes. */
export function seriesAlignees(
  a: readonly CoursDate[],
  b: readonly CoursDate[],
): { dates: string[]; a: number[]; b: number[] } {
  const alignees = alignerSeries(a, b);
  return {
    dates: alignees.dates,
    a: alignees.a.map(valeur => valeur.toNumber()),
    b: alignees.b.map(valeur => valeur.toNumber()),
  };
}
