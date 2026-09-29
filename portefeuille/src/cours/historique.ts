/**
 * Chargement de l'historique des cours.
 *
 * Sans lui, l'application n'accumule qu'un point par rafraîchissement : les
 * onglets Performances et Risque restent muets pendant des mois, le temps
 * d'atteindre les trente relevés d'une corrélation ou les quatre-vingt-dix
 * jours d'une annualisation. Avec lui, ils parlent le premier jour.
 *
 * ## Clôture brute, jamais ajustée
 *
 * Yahoo rend deux séries : `close` et `adjclose`. La seconde retraite le passé
 * pour neutraliser dividendes et divisions, ce qui en fait la bonne série pour
 * mesurer un rendement — mais la mauvaise **ici**.
 *
 * L'application enregistre les dividendes comme des opérations à part entière :
 * ils entrent dans les liquidités et dans le rendement par ce chemin. Reprendre
 * une série ajustée les compterait une seconde fois, et gonflerait la
 * performance d'autant. C'est donc `close` qu'on retient : ce que la ligne
 * valait vraiment ce jour-là.
 *
 * ## Ce que ça ne gère pas
 *
 * Les **divisions d'actions**. Une série brute traversant une division montre
 * une chute qui n'a pas eu lieu, et l'application ne modélise pas les
 * divisions. Si l'une de vos valeurs en connaît une, l'historique d'avant sera
 * faux et la performance avec. C'est une limite assumée, pas un oubli : la
 * traiter demanderait un type d'opération de plus et une reprise du rejeu.
 */

import { Decimal } from '../core/money/decimal';
import { DepotCours } from '../db/depots';
import type { PiloteSqlite } from '../db/pilote';
import { ErreurFournisseur, versCours } from './fournisseur';

export interface PointHistorique {
  /** Date ISO de la séance. */
  date: string;
  cloture: Decimal;
}

export interface OptionsHistorique {
  /** Profondeur demandée. Les valeurs acceptées sont celles de la source. */
  plage?: string;
  /** Implémentation de `fetch`, injectable pour les tests. */
  recuperer?: typeof fetch;
}

/** Profondeur par défaut : deux ans suffisent à toutes les mesures de l'application. */
export const PLAGE_DEFAUT = '2y';

const URL_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';

function dateDeSeconde(secondes: number): string | undefined {
  if (!Number.isFinite(secondes)) {
    return undefined;
  }
  const date = new Date(secondes * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

/**
 * Charge l'historique d'un symbole.
 *
 * Ne lève que si la source est injoignable. Une série vide est une réponse —
 * un symbole inconnu, une valeur trop récente — pas une panne.
 */
export async function chargerHistorique(
  symbole: string,
  options: OptionsHistorique = {},
): Promise<PointHistorique[]> {
  const appeler = options.recuperer ?? fetch;
  const plage = options.plage ?? PLAGE_DEFAUT;
  const url = `${URL_CHART}/${encodeURIComponent(symbole)}?range=${encodeURIComponent(plage)}&interval=1d`;

  let charge: unknown;
  try {
    const reponse = await appeler(url);
    if (!reponse.ok) {
      throw new ErreurFournisseur(`réponse ${reponse.status} pour ${symbole}`);
    }
    charge = await reponse.json();
  } catch (erreur) {
    throw new ErreurFournisseur(
      erreur instanceof Error ? erreur.message : String(erreur),
    );
  }

  const resultat = (charge as { chart?: { result?: unknown[] } })?.chart?.result?.[0] as
    | {
        timestamp?: unknown;
        indicators?: { quote?: Array<{ close?: unknown }> };
      }
    | undefined;

  const horodatages = resultat?.timestamp;
  const clotures = resultat?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(horodatages) || !Array.isArray(clotures)) {
    return [];
  }

  const points: PointHistorique[] = [];
  for (let index = 0; index < horodatages.length; index++) {
    const date = typeof horodatages[index] === 'number'
      ? dateDeSeconde(horodatages[index] as number)
      : undefined;
    // Une seance sans cotation rend `null` : on la saute plutot que de
    // reporter la veille, ce qui inventerait un cours.
    const cloture = versCours(clotures[index]);
    if (date && cloture) {
      points.push({ date, cloture });
    }
  }

  // Dates croissantes, doublons ecartes : la source est deja triee, mais le
  // rejeu de la serie de valorisation en depend.
  const parDate = new Map(points.map(point => [point.date, point]));
  return [...parDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

export interface DemandeHistorique {
  titreId: string;
  nom: string;
  symbole: string;
}

export interface RapportHistorique {
  /** Nombre de cotations écrites, toutes valeurs confondues. */
  points: number;
  /** Valeurs effectivement chargées, avec leur profondeur. */
  charges: Array<{ nom: string; points: number; depuis?: string }>;
  /** Valeurs pour lesquelles la source n'a rien rendu. */
  vides: string[];
  echecs: Array<{ nom: string; raison: string }>;
}

export interface OptionsChargement extends OptionsHistorique {
  /** Charge l'historique, injectable pour les tests. */
  charger?: typeof chargerHistorique;
}

/**
 * Charge et enregistre l'historique de plusieurs valeurs.
 *
 * Chaque valeur est écrite dès qu'elle arrive : une coupure au milieu laisse
 * ce qui a déjà été chargé, plutôt que de tout perdre. Même règle que le
 * rafraîchissement des cours.
 */
export async function chargerHistoriques(
  pilote: PiloteSqlite,
  demandes: readonly DemandeHistorique[],
  options: OptionsChargement = {},
): Promise<RapportHistorique> {
  const depot = new DepotCours(pilote);
  const charger = options.charger ?? chargerHistorique;

  const rapport: RapportHistorique = { points: 0, charges: [], vides: [], echecs: [] };

  for (const demande of demandes) {
    let points: PointHistorique[];
    try {
      points = await charger(demande.symbole, options);
    } catch (erreur) {
      rapport.echecs.push({
        nom: demande.nom,
        raison: erreur instanceof Error ? erreur.message : String(erreur),
      });
      continue;
    }

    if (points.length === 0) {
      rapport.vides.push(demande.nom);
      continue;
    }

    pilote.transaction(() => {
      for (const point of points) {
        depot.enregistrer(demande.titreId, point.date, point.cloture);
      }
    });

    rapport.points += points.length;
    rapport.charges.push({
      nom: demande.nom,
      points: points.length,
      depuis: points[0].date,
    });
  }

  return rapport;
}

/** Résume un chargement en une phrase, pour l'écran des réglages. */
export function resumeHistorique(rapport: RapportHistorique): string {
  const morceaux: string[] = [];

  if (rapport.points > 0) {
    const depuis = rapport.charges
      .map(charge => charge.depuis)
      .filter((date): date is string => Boolean(date))
      .sort()[0];
    morceaux.push(
      `${rapport.points} cotation(s) chargée(s) sur ${rapport.charges.length} valeur(s)${
        depuis ? `, depuis le ${depuis.split('-').reverse().join('/')}` : ''
      }.`,
    );
  } else {
    morceaux.push('Aucune cotation chargée.');
  }

  if (rapport.vides.length > 0) {
    morceaux.push(
      `Sans historique : ${rapport.vides.join(', ')}. Vérifiez le symbole dans Réglages → Symboles.`,
    );
  }
  if (rapport.echecs.length > 0) {
    morceaux.push(
      `Échecs : ${rapport.echecs.map(echec => `${echec.nom} (${echec.raison})`).join(' ; ')}.`,
    );
  }

  return morceaux.join(' ');
}
