/**
 * Modèle de vue du comparateur de valeurs.
 *
 * Mettre deux lignes côte à côte est le geste qui précède un arbitrage :
 * renforcer l'une, alléger l'autre. Trois précautions, toutes tirées de ce
 * qu'on a déjà appris ailleurs dans l'application.
 *
 * **La même période, ou rien.** Comparer la performance d'une valeur suivie
 * depuis deux ans à celle d'une valeur suivie depuis trois semaines ne dit
 * rien. Les séries sont donc alignées sur leurs dates communes, et la période
 * retenue est affichée.
 *
 * **Les mesures qui demandent un historique sont refusées quand il manque.**
 * Même seuils qu'à l'onglet Risque : trente observations pour une corrélation,
 * vingt pour une volatilité.
 *
 * **Le prix de revient n'existe que pour ce qu'on détient.** Une valeur
 * seulement surveillée n'a ni PRU ni plus-value, et l'écran le dit au lieu
 * d'afficher un tiret qu'on prendrait pour un zéro.
 */

import { Decimal } from '../../core/money/decimal';
import type { Titre } from '../../core/domain/types';
import type { EtatPortefeuille } from '../../core/portfolio/engine';
import { volatilite } from '../../core/performance/rendements';
import {
  OBSERVATIONS_MINIMUM_CORRELATION,
  alignerSeries,
  correlationEntreTitres,
  rendementsDeSerie,
} from '../../core/performance/risque';
import type { CoursDate, HistoriqueCours } from '../../core/performance/serie';
import { formaterDate, formaterMontant, formaterPourcentage, tendance, type Tendance } from '../format';

/** Observations minimales pour annualiser une volatilité, comme à l'onglet Risque. */
export const OBSERVATIONS_MINIMUM_VOLATILITE = 20;

/** Nombre maximal de valeurs comparées à la fois. */
export const VALEURS_MAXIMUM = 3;

export interface MesureComparee {
  valeur: string | null;
  motif?: string;
}

export interface ColonneComparaison {
  titreId: string;
  nom: string;
  ticker: string;
  secteur: string;
  zone: string;
  eligiblePEA: boolean;
  cours: MesureComparee;
  /** Performance sur la période commune aux valeurs comparées. */
  performance: MesureComparee;
  tendancePerformance: Tendance;
  volatilite: MesureComparee;
  /** Renseignés seulement si la valeur est détenue. */
  detenue: boolean;
  poids?: string;
  pru?: string;
  plusValue?: string;
  tendancePlusValue?: Tendance;
  dividendesDouzeMois?: string;
  rendementSurRevient?: MesureComparee;
}

export interface PaireComparee {
  a: string;
  b: string;
  correlation: MesureComparee;
  /** Commentaire quand les deux bougent de concert. */
  commentaire?: string;
}

export interface CandidatComparaison {
  titreId: string;
  nom: string;
  detenue: boolean;
  /** Vrai si la valeur figure dans la comparaison en cours. */
  retenu: boolean;
}

export interface VueComparateur {
  colonnes: ColonneComparaison[];
  paires: PaireComparee[];
  candidats: CandidatComparaison[];
  /** Phrase qui situe la période réellement comparée. */
  periode?: string;
  /** Explication quand la comparaison ne peut pas se faire. */
  message?: string;
  /** Vrai quand le nombre maximal de valeurs est atteint. */
  complet: boolean;
}

export interface EntreesComparateur {
  /** Valeurs retenues pour la comparaison, dans l'ordre choisi. */
  retenus: readonly string[];
  titres: readonly Titre[];
  etat: EtatPortefeuille;
  cours: ReadonlyMap<string, Decimal>;
  historique: HistoriqueCours;
  /** Dividendes encaissés sur douze mois, par titre. */
  dividendesDouzeMois: ReadonlyMap<string, Decimal>;
  /** Identifiants des valeurs surveillées, proposables à la comparaison. */
  surveilles: ReadonlySet<string>;
}

/** Au-delà, deux valeurs sont dites « liées ». */
const CORRELATION_FORTE = 0.7;

function indisponible(motif: string): MesureComparee {
  return { valeur: null, motif };
}

/**
 * Bornes communes à toutes les séries retenues.
 * Sans cela, on comparerait deux ans à trois semaines.
 */
function periodeCommune(
  series: readonly (readonly CoursDate[])[],
): { debut: string; fin: string } | undefined {
  if (series.length === 0 || series.some(serie => serie.length === 0)) {
    return undefined;
  }
  const debut = series.map(serie => serie[0].date).sort().reverse()[0];
  const fin = series.map(serie => serie[serie.length - 1].date).sort()[0];
  return debut <= fin ? { debut, fin } : undefined;
}

function borner(
  serie: readonly CoursDate[],
  bornes: { debut: string; fin: string } | undefined,
): CoursDate[] {
  // Pas de periode commune, pas de comparaison : rendre la serie entiere
  // ferait calculer une performance sur des dates disjointes, et le chiffre
  // aurait l'air parfaitement normal.
  if (!bornes) {
    return [];
  }
  return serie.filter(point => point.date >= bornes.debut && point.date <= bornes.fin);
}

export function construireComparateur(entrees: EntreesComparateur): VueComparateur {
  const parId = new Map(entrees.titres.map(titre => [titre.id, titre]));
  const detenus = new Map<string, { quantite: Decimal; coutTotal: Decimal; pru: Decimal }>();
  for (const position of entrees.etat.positions) {
    const cumul = detenus.get(position.titreId);
    detenus.set(position.titreId, {
      quantite: (cumul?.quantite ?? Decimal.ZERO).add(position.quantite),
      coutTotal: (cumul?.coutTotal ?? Decimal.ZERO).add(position.coutTotal),
      pru: position.pru,
    });
  }

  // Valeur totale des lignes detenues, pour exprimer un poids.
  let valeurDetenue = Decimal.ZERO;
  for (const [titreId, ligne] of detenus) {
    const cours = entrees.cours.get(titreId);
    if (cours) {
      valeurDetenue = valeurDetenue.add(ligne.quantite.mul(cours));
    }
  }

  const proposables = entrees.titres.filter(
    titre => detenus.has(titre.id) || entrees.surveilles.has(titre.id),
  );
  const candidats: CandidatComparaison[] = proposables
    .map(titre => ({
      titreId: titre.id,
      nom: titre.nom,
      detenue: detenus.has(titre.id),
      retenu: entrees.retenus.includes(titre.id),
    }))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));

  const retenus = entrees.retenus.filter(titreId => parId.has(titreId)).slice(0, VALEURS_MAXIMUM);

  if (retenus.length < 2) {
    return {
      colonnes: [],
      paires: [],
      candidats,
      complet: false,
      message:
        proposables.length < 2
          ? 'Il faut au moins deux valeurs détenues ou surveillées pour en comparer.'
          : 'Choisissez deux valeurs à comparer, trois au maximum.',
    };
  }

  const series = retenus.map(titreId => entrees.historique.get(titreId) ?? []);
  const bornes = periodeCommune(series);

  const colonnes: ColonneComparaison[] = retenus.map((titreId, index) => {
    const titre = parId.get(titreId)!;
    const serie = borner(series[index], bornes);
    const cours = entrees.cours.get(titreId);
    const ligne = detenus.get(titreId);

    // Performance sur la periode commune, du premier au dernier point.
    const performance =
      serie.length >= 2 && serie[0].cloture.estPositif()
        ? serie[serie.length - 1].cloture.div(serie[0].cloture).sub(Decimal.UN).mul(100)
        : undefined;

    const rendements = rendementsDeSerie(serie);
    const mesureVolatilite =
      rendements.length >= OBSERVATIONS_MINIMUM_VOLATILITE
        ? volatilite(rendements, 252)
        : {
            valeur: null,
            motif: `${rendements.length} relevé(s) sur la période commune, ${OBSERVATIONS_MINIMUM_VOLATILITE} nécessaires.`,
          };

    const valeurMarche = ligne && cours ? ligne.quantite.mul(cours) : undefined;
    const dividendes = entrees.dividendesDouzeMois.get(titreId) ?? Decimal.ZERO;

    return {
      titreId,
      nom: titre.nom,
      ticker: titre.ticker ?? '',
      secteur: titre.secteur ?? 'Non renseigné',
      zone: titre.zoneGeographique ?? 'Non renseignée',
      eligiblePEA: titre.eligiblePEA,
      cours: cours
        ? { valeur: formaterMontant(cours) }
        : indisponible('Cours inconnu. Rafraîchissez les cours.'),
      performance: performance
        ? { valeur: formaterPourcentage(performance) }
        : indisponible(
            bornes
              ? 'Moins de deux relevés sur la période commune.'
              : 'Historique absent pour au moins une des valeurs comparées.',
          ),
      tendancePerformance: tendance(performance ?? null),
      volatilite:
        mesureVolatilite.valeur === null
          ? { valeur: null, motif: mesureVolatilite.motif }
          : {
              valeur: formaterPourcentage(mesureVolatilite.valeur, 1, {
                signeExplicite: false,
              }),
            },
      detenue: Boolean(ligne),
      poids:
        valeurMarche && valeurDetenue.estPositif()
          ? formaterPourcentage(valeurMarche.div(valeurDetenue).mul(100), 1, {
              signeExplicite: false,
            })
          : undefined,
      pru: ligne ? formaterMontant(ligne.pru) : undefined,
      plusValue:
        ligne && valeurMarche
          ? formaterMontant(valeurMarche.sub(ligne.coutTotal), { signeExplicite: true })
          : undefined,
      tendancePlusValue:
        ligne && valeurMarche ? tendance(valeurMarche.sub(ligne.coutTotal)) : undefined,
      dividendesDouzeMois: ligne ? formaterMontant(dividendes) : undefined,
      rendementSurRevient: ligne
        ? ligne.coutTotal.estPositif()
          ? { valeur: formaterPourcentage(dividendes.div(ligne.coutTotal).mul(100), 2, {
              signeExplicite: false,
            }) }
          : indisponible('Prix de revient nul.')
        : undefined,
    };
  });

  const paires: PaireComparee[] = [];
  for (let i = 0; i < retenus.length; i++) {
    for (let j = i + 1; j < retenus.length; j++) {
      const mesure = correlationEntreTitres(
        entrees.historique.get(retenus[i]) ?? [],
        entrees.historique.get(retenus[j]) ?? [],
      );
      const memeSecteur =
        parId.get(retenus[i])?.secteur !== undefined &&
        parId.get(retenus[i])?.secteur === parId.get(retenus[j])?.secteur;

      paires.push({
        a: parId.get(retenus[i])!.nom,
        b: parId.get(retenus[j])!.nom,
        correlation:
          mesure.valeur === null
            ? { valeur: null, motif: mesure.motif }
            : {
                valeur: formaterMontant(mesure.valeur, { decimales: 2, devise: null }),
              },
        commentaire:
          mesure.valeur !== null && mesure.valeur >= CORRELATION_FORTE
            ? memeSecteur
              ? 'Deux valeurs du même secteur qui bougent de concert : arbitrer de l’une vers l’autre ne change presque rien au risque.'
              : 'Ces deux valeurs bougent de concert. Passer de l’une à l’autre diversifie moins qu’il n’y paraît.'
            : undefined,
      });
    }
  }

  const alignement = bornes
    ? `Du ${formaterDate(bornes.debut)} au ${formaterDate(bornes.fin)} — la période où toutes les valeurs comparées ont un historique.`
    : undefined;

  return {
    colonnes,
    paires,
    candidats,
    periode: alignement,
    complet: retenus.length >= VALEURS_MAXIMUM,
    message: bornes
      ? undefined
      : `Aucune période commune : au moins une des valeurs n’a pas d’historique. Chargez-le depuis les réglages, ou attendez ${OBSERVATIONS_MINIMUM_CORRELATION} relevés.`,
  };
}

/** Longueur commune de deux séries, exposée pour les diagnostics. */
export function observationsCommunes(a: readonly CoursDate[], b: readonly CoursDate[]): number {
  return alignerSeries(a, b).dates.length;
}
