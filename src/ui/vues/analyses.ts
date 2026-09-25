/**
 * Modèles de vue des onglets d'analyse : Positions, Risque, Performances, Flux.
 *
 * Même principe que partout : les calculs et la mise en forme vivent ici,
 * les écrans posent des graphiques et des tableaux sur des données prêtes.
 * Quelques sorties restent numériques — les valeurs que les graphiques
 * placent — et sont toujours accompagnées de leur texte formaté.
 */

import { Decimal } from '../../core/money/decimal';
import type { Compte, Titre, Transaction } from '../../core/domain/types';
import { rejouer, type EtatPortefeuille } from '../../core/portfolio/engine';
import { valoriserPositions, type PositionValorisee } from '../../core/portfolio/valorisation';
import {
  annualiser,
  drawdown,
  joursEntre,
  sharpe,
  tri,
  volatilite,
  type PointValorisation,
} from '../../core/performance/rendements';
import { comparerAReference } from '../../core/performance/reference';
import {
  concentration,
  correlationEntreTitres,
  poidsDepuisMontants,
  rendementsDeSerie,
} from '../../core/performance/risque';
import { coursALaDate, type CoursDate, type HistoriqueCours } from '../../core/performance/serie';
import {
  alignerReference,
  debutPeriode,
  facteursCours,
  facteursTwr,
  rebaser,
  type Periode,
  type PointPourcentage,
} from '../../core/performance/cumul';
import {
  calmar,
  correlationMoyennePonderee,
  frontiereEfficiente,
  recuperationLaPlusLongue,
  rendementsDeFacteurs,
  rendementsMensuels,
  serieDrawdown,
  sortino,
  statistiquesMensuelles,
  volatiliteBaisse,
} from '../../core/performance/analyse';
import {
  formaterDate,
  formaterMontant,
  formaterPourcentage,
  formaterQuantite,
  tendance,
  type Tendance,
} from '../format';

export interface ValeurSignee {
  texte: string;
  tendance: Tendance;
}

export interface EntreesAnalyse {
  etat: EtatPortefeuille;
  comptes: readonly Compte[];
  titres: readonly Titre[];
  transactions: readonly Transaction[];
  /** Dernier cours de chaque titre. */
  cours: ReadonlyMap<string, Decimal>;
  /** Historique des titres, indices exclus. */
  historique: HistoriqueCours;
  points: readonly PointValorisation[];
  indice?: { nom: string; serie: readonly CoursDate[] };
  aujourdhui: string;
}

const signe = (valeur: Decimal | number | null, texte: string): ValeurSignee => ({
  texte,
  tendance: tendance(valeur),
});

const pct = (valeur: number | null, decimales = 2) =>
  valeur === null || !Number.isFinite(valeur) ? '—' : formaterPourcentage(valeur, decimales);

const pctNeutre = (valeur: number | null, decimales = 2) =>
  valeur === null || !Number.isFinite(valeur)
    ? '—'
    : formaterPourcentage(valeur, decimales, { signeExplicite: false });

const nombre = (valeur: number | null, decimales = 2) =>
  valeur === null || !Number.isFinite(valeur)
    ? '—'
    : formaterMontant(valeur, { decimales, devise: null });

function nomCourt(titre: Titre | undefined, repli: string): string {
  if (titre?.ticker?.trim()) {
    return titre.ticker.trim().replace(/\.[A-Z]{1,3}$/, '');
  }
  const nom = titre?.nom ?? repli;
  return nom.length > 12 ? `${nom.slice(0, 11)}…` : nom;
}

// ---------------------------------------------------------------- Positions

export interface LigneTitre {
  titreId: string;
  nom: string;
  symbole: string;
  compte: string;
  quantite: string;
  pru: string;
  cout: string;
  cours: string;
  variationJour: ValeurSignee | null;
  valeur: string;
  poids: string;
  latent: ValeurSignee;
  latentPct: ValeurSignee;
  /** Pour trier sans reparser les textes. */
  brut: { valeur: number; poids: number; latent: number; latentPct: number | null };
}

export interface PartGraphique {
  libelle: string;
  valeur: number;
  detail: string;
}

export interface SeriePoids {
  nom: string;
  points: PointPourcentage[];
}

export interface VuePositions {
  nombreLignes: string;
  lignes: LigneTitre[];
  repartition: {
    positions: PartGraphique[];
    secteurs: PartGraphique[];
    zones: PartGraphique[];
    comptes: PartGraphique[];
  };
  poidsDansLeTemps: SeriePoids[];
  distribution: Array<{ libelle: string; valeur: number; texte: string }>;
  tuiles: Array<{ libelle: string; poids: number; latentPct: number; lignes: string[] }>;
  statistiques: Array<{ libelle: string; valeur: string; tendance?: Tendance }>;
  pied: {
    lignes: number;
    latent: ValeurSignee;
    realise: ValeurSignee;
    dividendes: string;
    totalReturn: ValeurSignee;
  };
}

/** Au-delà, la répartition dans le temps échantillonne : le graphique n'en montre pas plus. */
const POINTS_MAXIMUM_TEMPS = 160;

function variationDuJour(serie: readonly CoursDate[] | undefined): ValeurSignee | null {
  if (!serie || serie.length < 2) {
    return null;
  }
  const dernier = serie[serie.length - 1].cloture;
  const veille = serie[serie.length - 2].cloture;
  if (!veille.estPositif()) {
    return null;
  }
  const variation = dernier.div(veille).sub(1).mul(100);
  return signe(variation, formaterPourcentage(variation));
}

function partsDe(
  valorisees: readonly PositionValorisee[],
  cle: (position: PositionValorisee) => string,
): PartGraphique[] {
  const cumuls = new Map<string, Decimal>();
  for (const position of valorisees) {
    const nom = cle(position);
    cumuls.set(nom, (cumuls.get(nom) ?? Decimal.ZERO).add(position.valeurMarche));
  }
  return [...cumuls.entries()]
    .sort((a, b) => b[1].compare(a[1]))
    .map(([libelle, valeur]) => ({ libelle, valeur: valeur.toNumber(), detail: formaterMontant(valeur) }));
}

/**
 * Poids de chaque ligne dans le temps, liquidités comprises.
 *
 * Échantillonné sur au plus quelques centaines de dates : le rejeu du journal
 * à chaque date coûte, et le graphique n'en montrerait pas davantage.
 */
export function poidsDansLeTemps(entrees: EntreesAnalyse): SeriePoids[] {
  const dates = entrees.points.map(point => point.date);
  if (dates.length < 2) {
    return [];
  }
  const pas = Math.max(1, Math.ceil(dates.length / POINTS_MAXIMUM_TEMPS));
  const echantillon = dates.filter((_, index) => index % pas === 0 || index === dates.length - 1);
  const nomDe = new Map(entrees.titres.map(titre => [titre.id, titre]));
  const series = new Map<string, PointPourcentage[]>();
  const liquidites: PointPourcentage[] = [];

  for (const date of echantillon) {
    const etat = rejouer(
      entrees.comptes,
      entrees.transactions.filter(transaction => transaction.date <= date),
    );
    const valeurs = new Map<string, number>();
    let total = 0;
    for (const position of etat.positions) {
      const cours = coursALaDate(entrees.historique.get(position.titreId) ?? [], date);
      if (!cours) {
        continue;
      }
      const valeur = position.quantite.mul(cours).toNumber();
      valeurs.set(position.titreId, (valeurs.get(position.titreId) ?? 0) + valeur);
      total += valeur;
    }
    const cash = [...etat.comptes.values()].reduce((somme, compte) => somme + compte.cash.toNumber(), 0);
    total += cash;
    if (total <= 0) {
      continue;
    }
    for (const id of new Set([...series.keys(), ...valeurs.keys()])) {
      const serie = series.get(id) ?? [];
      serie.push({ date, valeur: ((valeurs.get(id) ?? 0) / total) * 100 });
      series.set(id, serie);
    }
    liquidites.push({ date, valeur: (cash / total) * 100 });
  }

  // Les plus lourdes aujourd'hui d'abord : même ordre, donc mêmes couleurs,
  // que dans la répartition.
  const resultat = [...series.entries()]
    .map(([id, points]) => ({ nom: nomDe.get(id)?.nom ?? id, points }))
    .sort((a, b) => (b.points[b.points.length - 1]?.valeur ?? 0) - (a.points[a.points.length - 1]?.valeur ?? 0));
  if (liquidites.some(point => point.valeur > 0.05)) {
    resultat.push({ nom: 'Liquidités', points: liquidites });
  }
  return resultat;
}

export function construirePositions(entrees: EntreesAnalyse): VuePositions {
  const titres = new Map(entrees.titres.map(titre => [titre.id, titre]));
  const comptes = new Map(entrees.comptes.map(compte => [compte.id, compte]));
  const { valorisees } = valoriserPositions(entrees.etat.positions, entrees.cours);
  const totalTitres = Decimal.somme(valorisees.map(position => position.valeurMarche));

  const lignes: LigneTitre[] = [...valorisees]
    .sort((a, b) => b.valeurMarche.compare(a.valeurMarche))
    .map(position => {
      const titre = titres.get(position.titreId);
      const poids = totalTitres.estPositif()
        ? position.valeurMarche.div(totalTitres).mul(100)
        : Decimal.ZERO;
      return {
        titreId: position.titreId,
        nom: titre?.nom ?? position.titreId,
        symbole: titre?.ticker ?? '',
        compte: comptes.get(position.compteId)?.nom ?? position.compteId,
        quantite: formaterQuantite(position.quantite),
        pru: formaterMontant(position.pru),
        cout: formaterMontant(position.coutTotal),
        cours: formaterMontant(position.cours),
        variationJour: variationDuJour(entrees.historique.get(position.titreId)),
        valeur: formaterMontant(position.valeurMarche),
        poids: formaterPourcentage(poids, 2, { signeExplicite: false }),
        latent: signe(
          position.plusValueLatente,
          formaterMontant(position.plusValueLatente, { signeExplicite: true }),
        ),
        latentPct: signe(position.plusValueLatentePct, formaterPourcentage(position.plusValueLatentePct)),
        brut: {
          valeur: position.valeurMarche.toNumber(),
          poids: poids.toNumber(),
          latent: position.plusValueLatente.toNumber(),
          latentPct: position.plusValueLatentePct?.toNumber() ?? null,
        },
      };
    });

  const etatsComptes = [...entrees.etat.comptes.values()];
  const latent = Decimal.somme(valorisees.map(position => position.plusValueLatente));
  const realise = Decimal.somme(entrees.etat.cessions.map(cession => cession.plusValue));
  const dividendes = Decimal.somme(etatsComptes.map(compte => compte.dividendesPercus));
  const frais = Decimal.somme(etatsComptes.map(compte => compte.fraisCumules));
  const cash = Decimal.somme(etatsComptes.map(compte => compte.cash));
  const totalReturn = latent.add(realise).add(dividendes);

  const mesure = concentration(
    poidsDepuisMontants(lignes.map(ligne => ({ cle: ligne.titreId, montant: Decimal.de(ligne.brut.valeur) }))),
  );
  const valeurTotale = totalTitres.add(cash);

  // Ancienneté moyenne des lignes détenues, pondérée par leur valeur.
  const premiersAchats = new Map<string, string>();
  for (const transaction of entrees.transactions) {
    if (transaction.type === 'ACHAT') {
      const cle = `${transaction.compteId}::${transaction.titreId}`;
      const connue = premiersAchats.get(cle);
      if (!connue || transaction.date < connue) {
        premiersAchats.set(cle, transaction.date);
      }
    }
  }
  let sommeJours = 0;
  let sommePoids = 0;
  for (const position of valorisees) {
    const debut = premiersAchats.get(`${position.compteId}::${position.titreId}`);
    if (debut) {
      const poids = position.valeurMarche.toNumber();
      sommeJours += joursEntre(debut, entrees.aujourdhui) * poids;
      sommePoids += poids;
    }
  }
  const detention = sommePoids > 0 ? Math.round(sommeJours / sommePoids) : null;

  return {
    nombreLignes: `${lignes.length} ligne(s)`,
    lignes,
    repartition: {
      positions: partsDe(valorisees, position => titres.get(position.titreId)?.nom ?? position.titreId),
      secteurs: partsDe(valorisees, position => titres.get(position.titreId)?.secteur ?? 'Non renseigné'),
      zones: partsDe(valorisees, position => titres.get(position.titreId)?.zoneGeographique ?? 'Non renseignée'),
      comptes: partsDe(valorisees, position => comptes.get(position.compteId)?.nom ?? position.compteId),
    },
    poidsDansLeTemps: poidsDansLeTemps(entrees),
    distribution: lignes.map(ligne => ({
      libelle: nomCourt(titres.get(ligne.titreId), ligne.nom),
      valeur: ligne.brut.latentPct ?? 0,
      texte: ligne.latentPct.texte,
    })),
    tuiles: lignes.map(ligne => ({
      libelle: nomCourt(titres.get(ligne.titreId), ligne.nom),
      poids: ligne.brut.valeur,
      latentPct: ligne.brut.latentPct ?? 0,
      lignes: [ligne.latentPct.texte, ligne.poids],
    })),
    statistiques: [
      { libelle: 'Nombre de lignes', valeur: String(lignes.length) },
      {
        libelle: 'Première ligne',
        valeur: mesure ? pctNeutre(mesure.premierePart * 100, 1) : '—',
      },
      {
        libelle: 'Lignes équivalentes',
        valeur: mesure ? mesure.lignesEquivalentes.toFixed(1).replace('.', ',') : '—',
      },
      {
        libelle: 'Part des liquidités',
        valeur: valeurTotale.estPositif()
          ? formaterPourcentage(cash.div(valeurTotale).mul(100), 1, { signeExplicite: false })
          : '—',
      },
      { libelle: 'Plus-value latente', valeur: formaterMontant(latent, { signeExplicite: true }), tendance: tendance(latent) },
      { libelle: 'Plus-value réalisée', valeur: formaterMontant(realise, { signeExplicite: true }), tendance: tendance(realise) },
      { libelle: 'Dividendes perçus', valeur: formaterMontant(dividendes) },
      { libelle: 'Frais cumulés', valeur: formaterMontant(frais) },
      {
        libelle: 'Détention moyenne',
        valeur: detention === null ? '—' : `${detention} jour${detention > 1 ? 's' : ''}`,
      },
    ],
    pied: {
      lignes: lignes.length,
      latent: signe(latent, formaterMontant(latent, { signeExplicite: true })),
      realise: signe(realise, formaterMontant(realise, { signeExplicite: true })),
      dividendes: formaterMontant(dividendes),
      totalReturn: signe(totalReturn, formaterMontant(totalReturn, { signeExplicite: true })),
    },
  };
}

// ------------------------------------------------------------------- Risque

export interface MetriqueAffichee {
  libelle: string;
  valeur: string;
  tendance?: Tendance;
  /** Couleur d'alerte : un niveau à surveiller plutôt qu'une hausse. */
  alerte?: boolean;
}

export interface VueRisqueAvance {
  metriques: MetriqueAffichee[];
  drawdown: PointPourcentage[];
  metriquesDrawdown: MetriqueAffichee[];
  phraseDrawdown?: string;
  frontiere?: {
    actifs: Array<{ libelle: string; volatilite: number; rendement: number }>;
    actuel: { volatilite: number; rendement: number };
    tangence: { volatilite: number; rendement: number };
    courbe: Array<{ volatilite: number; rendement: number }>;
    observations: number;
  };
  motifFrontiere?: string;
  matrice: { noms: string[]; valeurs: Array<Array<number | null>> };
  periode?: string;
  /** Combien de mois dans chaque tranche de rendement : l'allure du risque. */
  distribution: TrancheRendement[];
}

export interface TrancheRendement {
  libelle: string;
  /** Borne basse de la tranche, en %. */
  debut: number;
  nombre: number;
}

/**
 * Histogramme des rendements mensuels, par tranches de `pas` points.
 * Les tranches vides du milieu sont gardées : un trou dit aussi quelque chose.
 */
export function histogrammeRendements(rendements: readonly number[], pas = 2): TrancheRendement[] {
  if (rendements.length === 0) {
    return [];
  }
  const indice = (valeur: number) => Math.floor(valeur / pas);
  const premier = Math.min(...rendements.map(indice));
  const dernier = Math.max(...rendements.map(indice));
  const tranches: TrancheRendement[] = [];
  for (let rang = premier; rang <= dernier; rang++) {
    const debut = rang * pas;
    tranches.push({
      libelle: `${debut > 0 ? '+' : ''}${debut} à ${debut + pas > 0 ? '+' : ''}${debut + pas} %`,
      debut,
      nombre: rendements.filter(valeur => indice(valeur) === rang).length,
    });
  }
  return tranches;
}

/** Lignes retenues dans la frontière et la matrice : les plus lourdes. */
const LIGNES_ANALYSEES = 10;

export function construireRisqueAvance(entrees: EntreesAnalyse): VueRisqueAvance {
  const titres = new Map(entrees.titres.map(titre => [titre.id, titre]));
  const { valorisees } = valoriserPositions(entrees.etat.positions, entrees.cours);

  const valeurParTitre = new Map<string, number>();
  for (const position of valorisees) {
    valeurParTitre.set(
      position.titreId,
      (valeurParTitre.get(position.titreId) ?? 0) + position.valeurMarche.toNumber(),
    );
  }
  const total = [...valeurParTitre.values()].reduce((a, b) => a + b, 0);
  const retenus = [...valeurParTitre.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, LIGNES_ANALYSEES)
    .map(([id, valeur]) => ({ id, poids: total > 0 ? valeur / total : 0 }));

  const facteurs = facteursTwr(entrees.points);
  const rendementsJour = rendementsDeFacteurs(facteurs);
  const jours = facteurs.length > 1 ? joursEntre(facteurs[0].date, facteurs[facteurs.length - 1].date) : 0;
  const cumul = facteurs.length > 1 ? (facteurs[facteurs.length - 1].facteur - 1) * 100 : null;
  const annualise = cumul === null ? null : annualiser(cumul, jours).valeur;
  const vol = volatilite(rendementsJour.map(r => r * 100), 252).valeur;
  const baisse = volatiliteBaisse(rendementsJour);
  const dd = drawdown(entrees.points);
  const perteMax = dd ? serieDrawdown(facteurs).reduce((min, p) => Math.min(min, p.valeur), 0) : null;
  const mensuels = statistiquesMensuelles(rendementsMensuels(facteurs));

  // Volatilité de chaque ligne, puis leur moyenne pondérée.
  const volatilites = new Map<string, number>();
  for (const { id } of retenus) {
    const serie = entrees.historique.get(id) ?? [];
    const rendements = rendementsDeSerie(serie);
    if (rendements.length >= 20) {
      const mesure = volatilite(rendements.map(r => r * 100), 252).valeur;
      if (mesure !== null) {
        volatilites.set(id, mesure);
      }
    }
  }
  const poidsVol = retenus.filter(ligne => volatilites.has(ligne.id));
  const sommePoidsVol = poidsVol.reduce((s, l) => s + l.poids, 0);
  const moyenneLignes =
    sommePoidsVol > 0
      ? poidsVol.reduce((s, l) => s + l.poids * volatilites.get(l.id)!, 0) / sommePoidsVol
      : null;

  // Matrice de corrélation, et sa moyenne pondérée hors diagonale.
  const noms = retenus.map(ligne => nomCourt(titres.get(ligne.id), ligne.id));
  const valeurs: Array<Array<number | null>> = retenus.map(() => retenus.map(() => null));
  const paires: Array<{ poidsA: number; poidsB: number; correlation: number | null }> = [];
  for (let i = 0; i < retenus.length; i++) {
    valeurs[i][i] = 1;
    for (let j = i + 1; j < retenus.length; j++) {
      const mesure = correlationEntreTitres(
        entrees.historique.get(retenus[i].id) ?? [],
        entrees.historique.get(retenus[j].id) ?? [],
      ).valeur;
      valeurs[i][j] = mesure;
      valeurs[j][i] = mesure;
      paires.push({ poidsA: retenus[i].poids, poidsB: retenus[j].poids, correlation: mesure });
    }
  }
  const correlationMoyenne = correlationMoyennePonderee(paires);

  const reference = entrees.indice ? comparerAReference(entrees.points, entrees.indice.serie) : undefined;
  const alphaAnnuel =
    reference?.alpha.valeur !== null && reference?.alpha.valeur !== undefined && reference.jours >= 90
      ? annualiser(reference.alpha.valeur, reference.jours).valeur
      : null;

  const conc = concentration(retenus.map(ligne => ({ cle: ligne.id, poids: ligne.poids })));

  const metriques: MetriqueAffichee[] = [
    { libelle: 'Corrélation moyenne pondérée', valeur: nombre(correlationMoyenne), alerte: (correlationMoyenne ?? 0) >= 0.7 },
    { libelle: 'Ratio de Sharpe', valeur: nombre(annualise !== null && vol ? sharpe(annualise, vol).valeur : null) },
    {
      libelle: 'Lignes effectives',
      valeur: conc ? `${conc.lignesEquivalentes.toFixed(1).replace('.', ',')} sur ${conc.nombreLignes}` : '—',
    },
    { libelle: 'Ratio de Sortino', valeur: nombre(sortino(annualise, baisse).valeur) },
    { libelle: 'Volatilité du portefeuille', valeur: pctNeutre(vol, 1) },
    { libelle: 'Ratio de Calmar', valeur: nombre(calmar(annualise, perteMax).valeur) },
    { libelle: 'Moyenne des lignes', valeur: pctNeutre(moyenneLignes, 1) },
    { libelle: 'Bêta', valeur: nombre(reference?.beta.valeur ?? null) },
    { libelle: 'Volatilité à la baisse', valeur: pctNeutre(baisse.valeur, 1) },
    { libelle: 'Alpha annualisé', valeur: pct(alphaAnnuel, 1), tendance: tendance(alphaAnnuel) },
    { libelle: 'Mois positifs', valeur: pctNeutre(mensuels.moisPositifs, 0) },
    { libelle: 'Corrélation à l’indice', valeur: nombre(reference?.correlation.valeur ?? null) },
  ];

  const serieDd = serieDrawdown(facteurs);
  const creux = serieDd.reduce<PointPourcentage | undefined>(
    (min, point) => (!min || point.valeur < min.valeur ? point : min),
    undefined,
  );
  const enCours = serieDd.length > 0 ? serieDd[serieDd.length - 1].valeur : null;
  const recuperation = recuperationLaPlusLongue(facteurs);

  const metriquesDrawdown: MetriqueAffichee[] = [
    { libelle: 'Perte maximale', valeur: pct(perteMax), tendance: tendance(perteMax) },
    { libelle: 'Volatilité réalisée', valeur: pctNeutre(vol, 1) },
    { libelle: 'Baisse en cours', valeur: pct(enCours), tendance: tendance(enCours) },
    {
      libelle: 'Meilleur mois',
      valeur: mensuels.meilleur ? `${pct(mensuels.meilleur.valeur)} (${moisLisible(mensuels.meilleur.cle)})` : '—',
      tendance: tendance(mensuels.meilleur?.valeur ?? null),
    },
    { libelle: 'Récupération la plus longue', valeur: facteurs.length > 1 ? `${Math.round(recuperation)} j` : '—' },
    {
      libelle: 'Pire mois',
      valeur: mensuels.pire ? `${pct(mensuels.pire.valeur)} (${moisLisible(mensuels.pire.cle)})` : '—',
      tendance: tendance(mensuels.pire?.valeur ?? null),
    },
  ];

  const frontiere = frontiereEfficiente(
    retenus.map(ligne => ({ id: ligne.id, serie: entrees.historique.get(ligne.id) ?? [], poids: ligne.poids })),
  );

  return {
    distribution: histogrammeRendements(
      [...rendementsMensuels(facteurs).parMois.values()].flatMap(ligne => [...ligne.values()]),
    ),
    metriques,
    drawdown: serieDd,
    metriquesDrawdown,
    phraseDrawdown:
      creux && creux.valeur < 0
        ? `Plus forte baisse : ${pct(creux.valeur)} au creux du ${formaterDate(creux.date)}${
            enCours !== null && enCours < 0 ? `, baisse de ${pct(enCours)} toujours en cours` : ', effacée depuis'
          }.`
        : undefined,
    frontiere:
      'motif' in frontiere
        ? undefined
        : {
            actifs: frontiere.actifs.map(actif => ({
              libelle: nomCourt(titres.get(actif.id), actif.id),
              volatilite: actif.volatilite,
              rendement: actif.rendement,
            })),
            actuel: frontiere.actuel,
            tangence: frontiere.tangence,
            courbe: frontiere.courbe,
            observations: frontiere.observations,
          },
    motifFrontiere: 'motif' in frontiere ? frontiere.motif : undefined,
    matrice: { noms, valeurs },
    periode:
      facteurs.length > 1
        ? `Du ${formaterDate(facteurs[0].date)} au ${formaterDate(facteurs[facteurs.length - 1].date)}, ${
            rendementsJour.length
          } séances.`
        : undefined,
  };
}

const MOIS_LONGS = [
  'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
];

function moisLisible(cle: string): string {
  return `${MOIS_LONGS[Number(cle.slice(5, 7)) - 1]} ${cle.slice(0, 4)}`;
}

// ------------------------------------------------------------- Performances

export interface CelluleMois {
  valeur: string;
  brut: number | null;
  reference?: string;
}

export interface VuePerformancesAvance {
  metriques: MetriqueAffichee[];
  twr: PointPourcentage[];
  twrReference: PointPourcentage[];
  valeur: Array<{ date: string; valeur: number }>;
  investi: Array<{ date: string; valeur: number }>;
  legendeTwr: string;
  legendeReference?: string;
  mensuels: Array<{ annee: string; mois: Array<CelluleMois | null>; annee_: CelluleMois | null }>;
  moyenneMensuelle: Array<CelluleMois | null>;
  titresVsReference: {
    mieux: Array<{ titreId: string; nom: string; ecart: ValeurSignee; perf: string; brut: number }>;
    moins: Array<{ titreId: string; nom: string; ecart: ValeurSignee; perf: string; brut: number }>;
  };
  actions: Array<{ titreId: string; nom: string }>;
}

export interface CourbeAction {
  titre: PointPourcentage[];
  reference: PointPourcentage[];
  marqueurs: Array<{ date: string; valeur: number; type: 'achat' | 'vente' }>;
}

function fluxCumulesJusqua(points: readonly PointValorisation[]): Map<string, Decimal> {
  const cumuls = new Map<string, Decimal>();
  let cumul = Decimal.ZERO;
  for (const point of points) {
    cumul = cumul.add(point.fluxExterne);
    cumuls.set(point.date, cumul);
  }
  return cumuls;
}

export function construirePerformancesAvance(
  entrees: EntreesAnalyse,
  periode: Periode,
): VuePerformancesAvance {
  const titres = new Map(entrees.titres.map(titre => [titre.id, titre]));
  const facteurs = facteursTwr(entrees.points);
  const debut = debutPeriode(periode, entrees.aujourdhui);
  const twrFenetre = rebaser(facteurs, debut);
  const facteursRef = entrees.indice ? facteursCours(entrees.indice.serie) : [];
  const refFenetre = alignerReference(facteursRef, twrFenetre);

  const pointsFenetre = entrees.points.filter(point => !debut || point.date >= debut);
  const premierIndex = debut
    ? Math.max(0, entrees.points.findIndex(point => point.date >= debut) - 1)
    : entrees.points.findIndex(point => point.valeurTotale.estPositif());
  const depart = premierIndex >= 0 ? entrees.points[premierIndex] : undefined;
  const fin = entrees.points[entrees.points.length - 1];

  const cumuls = fluxCumulesJusqua(entrees.points);
  const fluxFenetre = depart
    ? Decimal.somme(
        entrees.points.filter(point => point.date > depart.date).map(point => point.fluxExterne),
      )
    : Decimal.ZERO;
  const valeurDepart = depart?.valeurTotale ?? Decimal.ZERO;
  const valeurFin = fin?.valeurTotale ?? Decimal.ZERO;
  const gain = valeurFin.sub(valeurDepart).sub(fluxFenetre);

  const perfTwr = twrFenetre.length > 1 ? twrFenetre[twrFenetre.length - 1].valeur : null;
  const perfRef = refFenetre.length > 1 ? refFenetre[refFenetre.length - 1].valeur : null;
  const joursFenetre =
    twrFenetre.length > 1 ? joursEntre(twrFenetre[0].date, twrFenetre[twrFenetre.length - 1].date) : 0;
  const cagr = perfTwr === null ? null : annualiser(perfTwr, joursFenetre).valeur;
  const cagrRef = perfRef === null ? null : annualiser(perfRef, joursFenetre).valeur;

  // TRI de la fenêtre : la valeur de départ est traitée comme un versement.
  const fluxTri = depart && fin
    ? [
        { date: depart.date, montant: valeurDepart.neg() },
        ...entrees.points
          .filter(point => point.date > depart.date && !point.fluxExterne.estZero())
          .map(point => ({ date: point.date, montant: point.fluxExterne.neg() })),
        { date: fin.date, montant: valeurFin },
      ]
    : [];
  const triFenetre = fluxTri.length >= 2 && valeurDepart.estPositif() ? tri(fluxTri).valeur : null;

  const metriques: MetriqueAffichee[] = [
    { libelle: 'Début de période', valeur: depart ? formaterDate(twrFenetre[0]?.date ?? depart.date) : '—' },
    { libelle: 'Performance TWR', valeur: pct(perfTwr), tendance: tendance(perfTwr) },
    { libelle: 'Valorisation de départ', valeur: formaterMontant(valeurDepart) },
    { libelle: 'CAGR TWR', valeur: pct(cagr), tendance: tendance(cagr) },
    { libelle: 'Valorisation finale', valeur: formaterMontant(valeurFin) },
    { libelle: 'TRI annualisé', valeur: pct(triFenetre), tendance: tendance(triFenetre) },
    { libelle: 'Dépôts nets sur la période', valeur: formaterMontant(fluxFenetre) },
    {
      libelle: 'Alpha TWR',
      valeur: perfTwr !== null && perfRef !== null ? pct(perfTwr - perfRef) : '—',
      tendance: perfTwr !== null && perfRef !== null ? tendance(perfTwr - perfRef) : undefined,
    },
    {
      libelle: 'Total Return',
      valeur: `${formaterMontant(gain, { signeExplicite: true })}${
        valeurDepart.add(fluxFenetre).estPositif()
          ? ` (${formaterPourcentage(gain.div(valeurDepart.add(fluxFenetre)).mul(100))})`
          : ''
      }`,
      tendance: tendance(gain),
    },
    {
      libelle: 'Alpha CAGR',
      valeur: cagr !== null && cagrRef !== null ? pct(cagr - cagrRef) : '—',
      tendance: cagr !== null && cagrRef !== null ? tendance(cagr - cagrRef) : undefined,
    },
  ];

  // Rendements mensuels, portefeuille et référence.
  const mensuels = rendementsMensuels(facteurs);
  const mensuelsRef = rendementsMensuels(facteursRef.filter(point => !facteurs[0] || point.date >= facteurs[0].date));
  const annees = [...mensuels.parMois.keys()].sort((a, b) => b - a);
  const cellule = (valeur: number | undefined, reference: number | undefined): CelluleMois | null =>
    valeur === undefined
      ? null
      : {
          valeur: pct(valeur, 1),
          brut: valeur,
          reference: reference === undefined ? undefined : `vs ${pct(reference, 1)}`,
        };
  const lignesMensuelles = annees.map(annee => ({
    annee: String(annee),
    mois: Array.from({ length: 12 }, (_, index) =>
      cellule(mensuels.parMois.get(annee)?.get(index + 1), mensuelsRef.parMois.get(annee)?.get(index + 1)),
    ),
    annee_: cellule(mensuels.parAnnee.get(annee), mensuelsRef.parAnnee.get(annee)),
  }));
  const moyenneMensuelle = Array.from({ length: 12 }, (_, index) => {
    const valeurs = annees
      .map(annee => mensuels.parMois.get(annee)?.get(index + 1))
      .filter((v): v is number => v !== undefined);
    const refs = annees
      .map(annee => mensuelsRef.parMois.get(annee)?.get(index + 1))
      .filter((v): v is number => v !== undefined);
    return valeurs.length === 0
      ? null
      : cellule(
          valeurs.reduce((a, b) => a + b, 0) / valeurs.length,
          refs.length ? refs.reduce((a, b) => a + b, 0) / refs.length : undefined,
        );
  });

  // Chaque ligne détenue face à la référence, sur la fenêtre.
  const mieux: VuePerformancesAvance['titresVsReference']['mieux'] = [];
  const moins: VuePerformancesAvance['titresVsReference']['moins'] = [];
  const detenus = [...new Set(entrees.etat.positions.map(position => position.titreId))];
  if (twrFenetre.length > 1) {
    for (const id of detenus) {
      const serie = rebaser(facteursCours(entrees.historique.get(id) ?? []), twrFenetre[0].date);
      if (serie.length < 2) {
        continue;
      }
      const perf = serie[serie.length - 1].valeur;
      const ecart = perfRef === null ? perf : perf - perfRef;
      const ligne = {
        titreId: id,
        nom: titres.get(id)?.nom ?? id,
        ecart: signe(ecart, pct(ecart)),
        perf: pct(perf),
        brut: ecart,
      };
      (ecart >= 0 ? mieux : moins).push(ligne);
    }
  }

  return {
    metriques,
    twr: twrFenetre,
    twrReference: refFenetre,
    valeur: pointsFenetre.map(point => ({ date: point.date, valeur: point.valeurTotale.toNumber() })),
    investi: pointsFenetre.map(point => ({
      date: point.date,
      valeur: (cumuls.get(point.date) ?? Decimal.ZERO).toNumber(),
    })),
    legendeTwr: `Performance (${pct(perfTwr)}${cagr !== null ? ` · CAGR ${pct(cagr)}` : ''})`,
    legendeReference: entrees.indice
      ? `${entrees.indice.nom} (${pct(perfRef)}${cagrRef !== null ? ` · CAGR ${pct(cagrRef)}` : ''})`
      : undefined,
    mensuels: lignesMensuelles,
    moyenneMensuelle,
    titresVsReference: {
      mieux: mieux.sort((a, b) => b.brut - a.brut),
      moins: moins.sort((a, b) => a.brut - b.brut),
    },
    actions: detenus.map(id => ({ titreId: id, nom: titres.get(id)?.nom ?? id })),
  };
}

/** Cours d'une ligne sur la fenêtre, face à la référence, avec ses achats et ventes. */
export function courbeAction(
  entrees: EntreesAnalyse,
  titreId: string,
  periode: Periode,
): CourbeAction {
  const debut = debutPeriode(periode, entrees.aujourdhui);
  const titre = rebaser(facteursCours(entrees.historique.get(titreId) ?? []), debut);
  const reference = entrees.indice
    ? alignerReference(facteursCours(entrees.indice.serie), titre)
    : [];
  const valeurA = (date: string) => {
    let retenu: number | undefined;
    for (const point of titre) {
      if (point.date <= date) {
        retenu = point.valeur;
      }
    }
    return retenu;
  };
  const marqueurs = entrees.transactions
    .filter(
      (transaction): transaction is Extract<Transaction, { type: 'ACHAT' | 'VENTE' }> =>
        (transaction.type === 'ACHAT' || transaction.type === 'VENTE') &&
        transaction.titreId === titreId &&
        (!titre[0] || transaction.date >= titre[0].date),
    )
    .flatMap(transaction => {
      const valeur = valeurA(transaction.date);
      return valeur === undefined
        ? []
        : [{ date: transaction.date, valeur, type: transaction.type === 'ACHAT' ? ('achat' as const) : ('vente' as const) }];
    });
  return { titre, reference, marqueurs };
}

// --------------------------------------------------------------------- Flux

export interface VueFluxAvance {
  annees: string[];
  parMois: Array<{ libelle: string; valeur: number; negatif: number; detail: string }>;
  moyenneMensuelle: { valeur: number; texte: string } | null;
  parAnnee: Array<{ libelle: string; valeur: number; negatif: number; detail: string }>;
  parCompte: PartGraphique[];
  cumul: Array<{ date: string; valeur: number }>;
  nombreMouvements: number;
  fluxNet: string;
}

const MOIS_COURTS = ['Jan.', 'Fév.', 'Mar.', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sep.', 'Oct.', 'Nov.', 'Déc.'];

export function construireFluxAvance(
  transactions: readonly Transaction[],
  comptes: readonly Compte[],
  annee: string | undefined,
  aujourdhui: string,
): VueFluxAvance {
  const mouvements = transactions
    .filter(
      (transaction): transaction is Extract<Transaction, { type: 'VERSEMENT' | 'RETRAIT' }> =>
        transaction.type === 'VERSEMENT' || transaction.type === 'RETRAIT',
    )
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const annees = [...new Set(mouvements.map(mouvement => mouvement.date.slice(0, 4)))].sort().reverse();
  const anneeVue = annee && annees.includes(annee) ? annee : annees[0];

  const parMois = Array.from({ length: 12 }, (_, index) => ({
    libelle: MOIS_COURTS[index],
    versements: Decimal.ZERO,
    retraits: Decimal.ZERO,
  }));
  const parAnnee = new Map<string, { versements: Decimal; retraits: Decimal }>();
  const parCompte = new Map<string, Decimal>();
  const cumul: Array<{ date: string; valeur: number }> = [];
  let net = Decimal.ZERO;

  for (const mouvement of mouvements) {
    const entrant = mouvement.type === 'VERSEMENT';
    const anneeMouvement = mouvement.date.slice(0, 4);
    const cumulAnnee = parAnnee.get(anneeMouvement) ?? { versements: Decimal.ZERO, retraits: Decimal.ZERO };
    if (entrant) {
      cumulAnnee.versements = cumulAnnee.versements.add(mouvement.montant);
      parCompte.set(mouvement.compteId, (parCompte.get(mouvement.compteId) ?? Decimal.ZERO).add(mouvement.montant));
    } else {
      cumulAnnee.retraits = cumulAnnee.retraits.add(mouvement.montant);
    }
    parAnnee.set(anneeMouvement, cumulAnnee);

    if (anneeMouvement === anneeVue) {
      const mois = parMois[Number(mouvement.date.slice(5, 7)) - 1];
      if (entrant) {
        mois.versements = mois.versements.add(mouvement.montant);
      } else {
        mois.retraits = mois.retraits.add(mouvement.montant);
      }
    }

    net = entrant ? net.add(mouvement.montant) : net.sub(mouvement.montant);
    const dernier = cumul[cumul.length - 1];
    if (dernier && dernier.date === mouvement.date) {
      dernier.valeur = net.toNumber();
    } else {
      cumul.push({ date: mouvement.date, valeur: net.toNumber() });
    }
  }
  if (cumul.length > 0 && cumul[cumul.length - 1].date < aujourdhui) {
    cumul.push({ date: aujourdhui, valeur: net.toNumber() });
  }

  // Versement mensuel moyen de l'année vue : sur les mois écoulés si c'est
  // l'année en cours, sur douze sinon.
  const versementsAnnee = anneeVue ? parAnnee.get(anneeVue)?.versements ?? Decimal.ZERO : Decimal.ZERO;
  const moisEcoules = anneeVue === aujourdhui.slice(0, 4) ? Number(aujourdhui.slice(5, 7)) : 12;
  const moyenne = versementsAnnee.estPositif() ? versementsAnnee.div(moisEcoules) : undefined;
  const nomCompte = new Map(comptes.map(compte => [compte.id, compte.nom]));

  return {
    annees,
    parMois: parMois.map(mois => ({
      libelle: mois.libelle,
      valeur: mois.versements.toNumber(),
      negatif: mois.retraits.toNumber(),
      detail: `${formaterMontant(mois.versements)} versés · ${formaterMontant(mois.retraits)} retirés`,
    })),
    moyenneMensuelle: moyenne
      ? { valeur: moyenne.toNumber(), texte: `Moyenne mensuelle (DCA) : ${formaterMontant(moyenne)}` }
      : null,
    parAnnee: [...parAnnee.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([libelle, cumulAnnee]) => ({
        libelle,
        valeur: cumulAnnee.versements.toNumber(),
        negatif: cumulAnnee.retraits.toNumber(),
        detail: `${formaterMontant(cumulAnnee.versements)} versés · ${formaterMontant(cumulAnnee.retraits)} retirés`,
      })),
    parCompte: [...parCompte.entries()].map(([id, valeur]) => ({
      libelle: nomCompte.get(id) ?? id,
      valeur: valeur.toNumber(),
      detail: formaterMontant(valeur),
    })),
    cumul,
    nombreMouvements: mouvements.length,
    fluxNet: formaterMontant(net, { signeExplicite: true }),
  };
}
