/**
 * Modèle de vue de l'onglet Risque.
 *
 * Il répond à trois questions, dans cet ordre de fiabilité décroissante :
 *
 * 1. **Suis-je concentré ?** Se lit sur les poids d'aujourd'hui, sans aucun
 *    historique. C'est la mesure la plus sûre, et souvent la plus utile.
 * 2. **D'où vient l'agitation ?** Demande un historique de cours, ligne par
 *    ligne. Approximation assumée : la contribution ignore les corrélations.
 * 3. **Mes lignes bougent-elles ensemble ?** Demande trente observations
 *    communes par paire. En dessous, la mesure est refusée avec son motif.
 *
 * L'onglet affiche donc toujours quelque chose d'utile, même le premier jour,
 * et dit explicitement ce qui manque pour le reste.
 */

import { Decimal } from '../../core/money/decimal';
import type { Titre } from '../../core/domain/types';
import type { EtatPortefeuille } from '../../core/portfolio/engine';
import { repartition, valoriserPositions } from '../../core/portfolio/valorisation';
import { volatilite } from '../../core/performance/rendements';
import {
  OBSERVATIONS_MINIMUM_CORRELATION,
  concentration,
  contributionsAuRisque,
  correlationEntreTitres,
  poidsDepuisMontants,
  rendementsDeSerie,
} from '../../core/performance/risque';
import type { HistoriqueCours } from '../../core/performance/serie';
import { formaterMontant, formaterPourcentage } from '../format';

export interface MesureRisque {
  valeur: string | null;
  motif?: string;
}

export interface VueConcentration {
  nombreLignes: number;
  /** Nombre de lignes équipondérées qui donnerait la même concentration. */
  lignesEquivalentes: string;
  premiereLigne: string;
  premierePart: string;
  lignesPourMoitie: number;
  /** Verdict en une phrase, adapté au niveau mesuré. */
  verdict: string;
  /** Position sur une jauge, entre 0 et 1 : 1 = tout dans une ligne. */
  fraction: number;
}

export interface LigneRepartitionRisque {
  cle: string;
  valeur: string;
  pourcentage: string;
  fraction: number;
}

export interface LigneContribution {
  titreId: string;
  nom: string;
  poids: string;
  volatilite: string;
  part: string;
  fraction: number;
  /** Vrai quand la ligne pèse nettement plus dans le risque que dans le capital. */
  disproportionnee: boolean;
}

export interface PaireCorrelation {
  a: string;
  b: string;
  valeur: string | null;
  /** Entre -1 et 1, pour la couleur. Absent si non mesurable. */
  brute?: number;
  motif?: string;
  /** Commentaire quand la corrélation est forte. */
  commentaire?: string;
}

export interface VueRisque {
  concentration?: VueConcentration;
  parSecteur: LigneRepartitionRisque[];
  parZone: LigneRepartitionRisque[];
  contributions: LigneContribution[];
  /** Explication quand les contributions n'ont pas pu être calculées. */
  motifContributions?: string;
  correlations: PaireCorrelation[];
  motifCorrelations?: string;
  aucunePosition: boolean;
  /** Lignes exclues faute de cours connu. */
  sansCours: string[];
}

export interface EntreesRisque {
  etat: EtatPortefeuille;
  titres: readonly Titre[];
  cours: ReadonlyMap<string, Decimal>;
  historique: HistoriqueCours;
}

/** Au-delà, deux lignes sont dites « liées » dans le commentaire. */
const CORRELATION_FORTE = 0.7;

/** Observations minimales pour annualiser une volatilité par ligne. */
const OBSERVATIONS_MINIMUM_VOLATILITE = 20;

/** Nombre de paires affichées : au-delà, le tableau devient illisible. */
const PAIRES_MAXIMUM = 15;

function verdictConcentration(lignesEquivalentes: number, nombreLignes: number): string {
  if (nombreLignes === 1) {
    return 'Une seule ligne : tout votre risque tient à une entreprise. C’est le point de départ normal, pas un état où rester.';
  }
  if (lignesEquivalentes < 2) {
    return 'Très concentré. Malgré le nombre de lignes, votre portefeuille se comporte comme s’il en comptait moins de deux.';
  }
  if (lignesEquivalentes < 5) {
    return 'Concentré. Une mauvaise nouvelle sur votre première ligne se verra nettement sur le total.';
  }
  if (lignesEquivalentes < 10) {
    return 'Diversification correcte pour un portefeuille personnel. Le poids reste réparti sur plusieurs lignes.';
  }
  return 'Bien réparti. Aucune ligne ne domine le portefeuille.';
}

function lignesDeRepartition(
  lignes: readonly { cle: string; valeur: Decimal; pourcentage: Decimal }[],
): LigneRepartitionRisque[] {
  const maximum = lignes.reduce(
    (max, ligne) => Decimal.max(max, ligne.valeur),
    Decimal.ZERO,
  );

  return lignes.map(ligne => ({
    cle: ligne.cle,
    valeur: formaterMontant(ligne.valeur),
    pourcentage: formaterPourcentage(ligne.pourcentage, 1, { signeExplicite: false }),
    fraction: maximum.estPositif() ? ligne.valeur.div(maximum).toNumber() : 0,
  }));
}

export function construireRisque(entrees: EntreesRisque): VueRisque {
  const nomDuTitre = new Map(entrees.titres.map(titre => [titre.id, titre.nom]));
  const titresParId = new Map(entrees.titres.map(titre => [titre.id, titre]));
  const { valorisees, sansCours } = valoriserPositions(
    entrees.etat.positions,
    entrees.cours,
  );

  if (valorisees.length === 0) {
    return {
      parSecteur: [],
      parZone: [],
      contributions: [],
      correlations: [],
      aucunePosition: true,
      sansCours: sansCours.map(
        position => nomDuTitre.get(position.titreId) ?? position.titreId,
      ),
    };
  }

  // Une meme valeur peut etre detenue sur deux comptes : on raisonne par
  // titre, pas par position, sinon la concentration parait meilleure qu'elle
  // n'est.
  const valeurParTitre = new Map<string, Decimal>();
  for (const position of valorisees) {
    valeurParTitre.set(
      position.titreId,
      (valeurParTitre.get(position.titreId) ?? Decimal.ZERO).add(position.valeurMarche),
    );
  }

  const montants = [...valeurParTitre.entries()].map(([cle, montant]) => ({
    cle,
    montant,
  }));
  const poids = poidsDepuisMontants(montants);
  const mesure = concentration(poids);

  const parPoids = [...poids].sort((a, b) => b.poids - a.poids);
  const vueConcentration: VueConcentration | undefined = mesure
    ? {
        nombreLignes: mesure.nombreLignes,
        lignesEquivalentes: mesure.lignesEquivalentes.toFixed(1).replace('.', ','),
        premiereLigne: nomDuTitre.get(parPoids[0].cle) ?? parPoids[0].cle,
        premierePart: formaterPourcentage(mesure.premierePart * 100, 1, {
          signeExplicite: false,
        }),
        lignesPourMoitie: mesure.lignesPourMoitie,
        verdict: verdictConcentration(mesure.lignesEquivalentes, mesure.nombreLignes),
        fraction: mesure.herfindahl,
      }
    : undefined;

  // ---------------------------------------------------- Contributions

  const volatilitesParTitre = new Map<string, number>();
  let observationsMaximum = 0;

  for (const titreId of valeurParTitre.keys()) {
    const serie = entrees.historique.get(titreId) ?? [];
    const rendements = rendementsDeSerie(serie);
    observationsMaximum = Math.max(observationsMaximum, rendements.length);

    if (rendements.length < OBSERVATIONS_MINIMUM_VOLATILITE) {
      continue;
    }
    const mesureVolatilite = volatilite(rendements, 252);
    if (mesureVolatilite.valeur !== null) {
      volatilitesParTitre.set(titreId, mesureVolatilite.valeur);
    }
  }

  const lignesMesurables = parPoids.filter(ligne => volatilitesParTitre.has(ligne.cle));
  const contributions: LigneContribution[] =
    lignesMesurables.length > 0
      ? contributionsAuRisque(
          lignesMesurables.map(ligne => ({
            cle: ligne.cle,
            poids: ligne.poids,
            volatilite: volatilitesParTitre.get(ligne.cle)!,
          })),
        ).map(contribution => ({
          titreId: contribution.cle,
          nom: nomDuTitre.get(contribution.cle) ?? contribution.cle,
          poids: formaterPourcentage(contribution.poids * 100, 1, {
            signeExplicite: false,
          }),
          volatilite: formaterPourcentage(contribution.volatilite, 1, {
            signeExplicite: false,
          }),
          part: formaterPourcentage(contribution.part * 100, 1, {
            signeExplicite: false,
          }),
          fraction: contribution.part,
          // Un ecart d'un quart signale une ligne dont l'agitation depasse
          // nettement le poids : c'est l'information qu'on vient chercher.
          disproportionnee: contribution.part > contribution.poids * 1.25,
        }))
      : [];

  const motifContributions =
    contributions.length > 0
      ? undefined
      : `Il faut ${OBSERVATIONS_MINIMUM_VOLATILITE} relevés de cours par valeur pour mesurer sa volatilité ; la mieux suivie en compte ${observationsMaximum}. Rafraîchissez les cours régulièrement : l’historique se construit tout seul.`;

  // ------------------------------------------------------ Corrélations

  const titresOrdonnes = parPoids.map(ligne => ligne.cle);
  const paires: PaireCorrelation[] = [];
  let mesurables = 0;

  for (let i = 0; i < titresOrdonnes.length && paires.length < PAIRES_MAXIMUM; i++) {
    for (let j = i + 1; j < titresOrdonnes.length && paires.length < PAIRES_MAXIMUM; j++) {
      const idA = titresOrdonnes[i];
      const idB = titresOrdonnes[j];
      const mesureCorrelation = correlationEntreTitres(
        entrees.historique.get(idA) ?? [],
        entrees.historique.get(idB) ?? [],
      );

      if (mesureCorrelation.valeur !== null) {
        mesurables++;
      }

      const memeSecteur =
        titresParId.get(idA)?.secteur !== undefined &&
        titresParId.get(idA)?.secteur === titresParId.get(idB)?.secteur;

      paires.push({
        a: nomDuTitre.get(idA) ?? idA,
        b: nomDuTitre.get(idB) ?? idB,
        valeur:
          mesureCorrelation.valeur === null
            ? null
            : formaterPourcentage(mesureCorrelation.valeur * 100, 0, {
                signeExplicite: false,
              }),
        brute: mesureCorrelation.valeur ?? undefined,
        motif: mesureCorrelation.motif,
        commentaire:
          mesureCorrelation.valeur !== null &&
          mesureCorrelation.valeur >= CORRELATION_FORTE
            ? memeSecteur
              ? 'Deux valeurs du même secteur qui bougent de concert : les détenir toutes deux ne diversifie presque rien.'
              : 'Ces deux valeurs bougent de concert. Les détenir toutes deux diversifie moins qu’il n’y paraît.'
            : undefined,
      });
    }
  }

  const motifCorrelations =
    titresOrdonnes.length < 2
      ? 'Il faut au moins deux valeurs pour mesurer une corrélation.'
      : mesurables === 0
        ? `Il faut ${OBSERVATIONS_MINIMUM_CORRELATION} relevés de cours aux mêmes dates pour qu’une corrélation veuille dire quelque chose. En dessous, deux valeurs quelconques en donnent facilement une forte, par hasard.`
        : undefined;

  const titresPourRepartition = new Map(entrees.titres.map(titre => [titre.id, titre]));

  return {
    concentration: vueConcentration,
    parSecteur: lignesDeRepartition(
      repartition(valorisees, titresPourRepartition, 'secteur'),
    ),
    parZone: lignesDeRepartition(
      repartition(valorisees, titresPourRepartition, 'zoneGeographique'),
    ),
    contributions,
    motifContributions,
    correlations: paires,
    motifCorrelations,
    aucunePosition: false,
    sansCours: sansCours.map(
      position => nomDuTitre.get(position.titreId) ?? position.titreId,
    ),
  };
}
