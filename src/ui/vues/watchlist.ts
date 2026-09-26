/**
 * Modèle de vue de la liste de surveillance.
 *
 * Une valeur suivie n'est **pas** une position. Elle n'a ni quantité ni prix
 * de revient, elle n'entre dans aucun total, et la confondre avec une ligne
 * détenue est l'erreur que cet écran doit rendre impossible.
 *
 * Deux informations lui sont propres :
 *
 * - **Depuis que vous la suivez.** Le cours du jour de l'ajout est figé à ce
 *   moment-là, et l'écart se lit ensuite. C'est ce qui transforme une liste
 *   de noms en observation utile : « je la regardais à 42 €, elle est à 51 ».
 * - **Le seuil.** Les mêmes alertes que pour les positions, mais sur une
 *   valeur qu'on n'a pas encore achetée — le cas où elles servent le plus.
 */

import { Decimal } from '../../core/money/decimal';
import type { Titre } from '../../core/domain/types';
import type { LigneWatchlist } from '../../db/depots';
import { formaterDate, formaterMontant, formaterPourcentage, tendance, type Tendance } from '../format';

export interface LigneSurveillee {
  titreId: string;
  nom: string;
  ticker: string;
  /** Cours actuel, absent s'il n'est pas connu. */
  cours?: string;
  /** Cours brut et devise de cotation, pour l'affichage en euros. */
  coursBrut?: number;
  devise: string;
  /** Écart depuis l'ajout, absent si l'un des deux cours manque. */
  ecart?: string;
  ecartPourcent?: string;
  /** Écart en %, pour trier ; absent s'il ne se mesure pas. */
  ecartPct?: number;
  tendance: Tendance;
  /** Phrase qui situe le suivi : « suivie depuis le 12/03/2026 ». */
  depuis: string;
  /** Renseigné quand l'écart ne peut pas être mesuré. */
  motifEcart?: string;
  note?: string;
  seuilHaut: string;
  seuilBas: string;
  /** Vrai si cette valeur est aussi détenue en portefeuille. */
  detenue: boolean;
  /** Vrai si le cours a franchi un seuil configuré. */
  seuilAtteint: boolean;
}

export interface CandidatWatchlist {
  titreId: string;
  nom: string;
  ticker: string;
  /** Vrai si la valeur est déjà détenue : on le dit avant l'ajout. */
  detenue: boolean;
}

export interface VueWatchlist {
  lignes: LigneSurveillee[];
  /** Valeurs connues qui ne sont pas encore surveillées. */
  candidats: CandidatWatchlist[];
  aucuneSurveillance: boolean;
  /** Explication affichée quand aucune valeur n'existe encore. */
  message?: string;
}

export interface SeuilSaisi {
  haut?: string;
  bas?: string;
}

export interface EntreesWatchlist {
  watchlist: readonly LigneWatchlist[];
  titres: readonly Titre[];
  cours: ReadonlyMap<string, Decimal>;
  /** Identifiants des valeurs détenues, pour ne pas les confondre. */
  titresDetenus: ReadonlySet<string>;
  seuils: Readonly<Record<string, SeuilSaisi>>;
}

function franchi(cours: Decimal, seuil: SeuilSaisi): boolean {
  const lire = (texte?: string): Decimal | undefined => {
    if (!texte || texte.trim() === '') {
      return undefined;
    }
    try {
      return Decimal.de(texte.replace(',', '.'));
    } catch {
      // Un seuil illisible ne declenche rien plutot que de faire echouer la
      // liste entiere.
      return undefined;
    }
  };

  const haut = lire(seuil.haut);
  const bas = lire(seuil.bas);
  return Boolean((haut && cours.gte(haut)) || (bas && cours.lte(bas)));
}

/** « € » pour l'euro, le code ISO pour les autres : « 865,00 PLN ». */
function symboleDevise(devise: string | undefined): string {
  return !devise || devise === 'EUR' ? '€' : devise === 'USD' ? '$' : devise;
}

export function construireWatchlist(entrees: EntreesWatchlist): VueWatchlist {
  const parId = new Map(entrees.titres.map(titre => [titre.id, titre]));
  const surveillees = new Set(entrees.watchlist.map(ligne => ligne.titreId));

  const lignes: LigneSurveillee[] = entrees.watchlist.map(ligne => {
    const titre = parId.get(ligne.titreId);
    const cours = entrees.cours.get(ligne.titreId);
    const seuil = entrees.seuils[ligne.titreId] ?? {};

    const mesurable = cours !== undefined && ligne.coursAjout?.estPositif();
    const ecart = mesurable ? cours.sub(ligne.coursAjout!) : undefined;

    return {
      titreId: ligne.titreId,
      nom: titre?.nom ?? ligne.titreId,
      ticker: titre?.ticker ?? '',
      // Dans la devise de cotation : l'écran le convertit en euros.
      cours: cours ? formaterMontant(cours, { devise: symboleDevise(titre?.deviseCotation) }) : undefined,
      coursBrut: cours?.toNumber(),
      devise: titre?.deviseCotation ?? 'EUR',
      ecart: ecart ? formaterMontant(ecart, { signeExplicite: true, devise: symboleDevise(titre?.deviseCotation) }) : undefined,
      ecartPourcent: ecart
        ? formaterPourcentage(ecart.div(ligne.coursAjout!).mul(100))
        : undefined,
      ecartPct: ecart ? ecart.div(ligne.coursAjout!).mul(100).toNumber() : undefined,
      tendance: tendance(ecart ?? null),
      depuis: `Suivie depuis le ${formaterDate(ligne.ajouteLe)}${
        ligne.coursAjout ? `, à ${formaterMontant(ligne.coursAjout, { devise: symboleDevise(titre?.deviseCotation) })}` : ''
      }.`,
      motifEcart: mesurable
        ? undefined
        : cours === undefined
          ? 'Cours inconnu. Rafraîchissez les cours pour suivre cette valeur.'
          : 'Le cours n’était pas connu au moment de l’ajout : il n’y a rien à quoi comparer.',
      note: ligne.note,
      seuilHaut: seuil.haut ?? '',
      seuilBas: seuil.bas ?? '',
      detenue: entrees.titresDetenus.has(ligne.titreId),
      seuilAtteint: cours !== undefined && franchi(cours, seuil),
    };
  });

  const candidats: CandidatWatchlist[] = entrees.titres
    .filter(titre => !surveillees.has(titre.id))
    .map(titre => ({
      titreId: titre.id,
      nom: titre.nom,
      ticker: titre.ticker,
      detenue: entrees.titresDetenus.has(titre.id),
    }))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));

  return {
    lignes,
    candidats,
    aucuneSurveillance: lignes.length === 0,
    message:
      entrees.titres.length === 0
        ? 'Aucune valeur enregistrée. Créez-en une, ou importez vos positions : la surveillance porte sur des valeurs connues de l’application.'
        : lignes.length === 0
          ? 'Aucune valeur surveillée. Ajoutez-en une pour suivre son cours et fixer des seuils sans avoir à l’acheter.'
          : undefined,
  };
}
