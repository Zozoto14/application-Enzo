/**
 * Fusion de deux états de portefeuille, pour la synchronisation entre
 * appareils.
 *
 * C'est ici que le choix d'un **journal d'opérations** comme unique source de
 * vérité se paie. Fusionner deux bases ne demande pas de réconcilier des
 * soldes, des PRU ou des plus-values : ce sont des valeurs calculées, et
 * `rejouer()` les recalcule à partir du journal fusionné. Il suffit donc de
 * réunir les opérations.
 *
 * Une opération est identifiée par son identifiant, et depuis que chaque
 * appareil préfixe les siens (`identite.ts`), deux appareils ne peuvent plus
 * fabriquer deux opérations différentes portant le même. La fusion des
 * transactions est donc une **union**, sans arbitrage.
 *
 * Restent les entités modifiables — comptes, titres — où deux appareils
 * peuvent avoir édité la même. Là, il n'y a pas de bonne réponse automatique :
 * on garde la version locale, et on **signale** le désaccord au lieu de
 * choisir en silence. Un conflit tu est un conflit qui se découvre six mois
 * plus tard, sur un chiffre faux.
 */

import type { Compte, Titre, Transaction } from '../core/domain/types';

export interface Instantane {
  comptes: readonly Compte[];
  titres: readonly Titre[];
  transactions: readonly Transaction[];
}

export type NatureConflit = 'compte' | 'titre';

export interface Conflit {
  nature: NatureConflit;
  id: string;
  /** Nom lisible, pour que le message ne parle pas en identifiants. */
  nom: string;
  /** Champs qui diffèrent entre les deux versions. */
  champs: string[];
}

export interface Fusion {
  resultat: Instantane;
  /** Nombre d'opérations venues de l'autre appareil. */
  transactionsAjoutees: number;
  comptesAjoutes: number;
  titresAjoutes: number;
  /** Divergences non tranchées, la version locale étant conservée. */
  conflits: Conflit[];
}

/** Champs comparés pour détecter une divergence de compte. */
const CHAMPS_COMPTE: readonly (keyof Compte)[] = [
  'nom',
  'type',
  'dateOuverture',
  'devise',
];

/** Champs comparés pour détecter une divergence de titre. */
const CHAMPS_TITRE: readonly (keyof Titre)[] = [
  'isin',
  'nom',
  'ticker',
  'deviseCotation',
  'secteur',
  'zoneGeographique',
  'eligiblePEA',
];

function champsDivergents<T>(
  local: T,
  distant: T,
  champs: readonly (keyof T)[],
): string[] {
  return champs
    .filter(champ => local[champ] !== distant[champ])
    .map(champ => String(champ));
}

function fusionnerEntites<T extends { id: string }>(
  locales: readonly T[],
  distantes: readonly T[],
  champs: readonly (keyof T)[],
  nature: NatureConflit,
  nomDe: (entite: T) => string,
): { resultat: T[]; ajoutees: number; conflits: Conflit[] } {
  const parId = new Map(locales.map(entite => [entite.id, entite]));
  const conflits: Conflit[] = [];
  let ajoutees = 0;

  for (const distante of distantes) {
    const locale = parId.get(distante.id);
    if (!locale) {
      parId.set(distante.id, distante);
      ajoutees++;
      continue;
    }

    const divergents = champsDivergents(locale, distante, champs);
    if (divergents.length > 0) {
      // On garde la version locale et on le dit. Choisir en silence ferait
      // decouvrir la perte six mois plus tard, sur un chiffre faux.
      conflits.push({
        nature,
        id: distante.id,
        nom: nomDe(locale),
        champs: divergents,
      });
    }
  }

  return { resultat: [...parId.values()], ajoutees, conflits };
}

/**
 * Fusionne un instantané distant dans l'instantané local.
 *
 * L'ordre des arguments compte : en cas de divergence sur une entité
 * modifiable, c'est `local` qui l'emporte.
 */
export function fusionner(local: Instantane, distant: Instantane): Fusion {
  const comptes = fusionnerEntites(
    local.comptes,
    distant.comptes,
    CHAMPS_COMPTE,
    'compte',
    compte => compte.nom,
  );
  const titres = fusionnerEntites(
    local.titres,
    distant.titres,
    CHAMPS_TITRE,
    'titre',
    titre => titre.nom,
  );

  // Les transactions ne se fusionnent pas champ a champ : une operation ne
  // se modifie pas, elle s'annule par une autre. Un meme identifiant designe
  // donc la meme operation, et l'union suffit.
  const parId = new Map(local.transactions.map(transaction => [transaction.id, transaction]));
  let transactionsAjoutees = 0;
  for (const transaction of distant.transactions) {
    if (!parId.has(transaction.id)) {
      parId.set(transaction.id, transaction);
      transactionsAjoutees++;
    }
  }

  // Tri chronologique, ordre de saisie conserve a date egale : le journal
  // fusionne doit se rejouer comme un journal ordinaire.
  const transactions = [...parId.values()].sort((a, b) =>
    a.date === b.date ? a.id.localeCompare(b.id) : a.date < b.date ? -1 : 1,
  );

  return {
    resultat: {
      comptes: comptes.resultat,
      titres: titres.resultat,
      transactions,
    },
    transactionsAjoutees,
    comptesAjoutes: comptes.ajoutees,
    titresAjoutes: titres.ajoutees,
    conflits: [...comptes.conflits, ...titres.conflits],
  };
}

/**
 * Transactions qui référencent un compte ou un titre absent du résultat.
 *
 * Ne devrait jamais rien rendre : une archive complète porte ses dépendances.
 * Vérifié quand même, parce qu'écrire une transaction orpheline ferait échouer
 * l'insertion en base bien plus loin, sur un message incompréhensible.
 */
export function transactionsOrphelines(instantane: Instantane): Transaction[] {
  const comptes = new Set(instantane.comptes.map(compte => compte.id));
  const titres = new Set(instantane.titres.map(titre => titre.id));

  return instantane.transactions.filter(transaction => {
    if (!comptes.has(transaction.compteId)) {
      return true;
    }
    const titreId = 'titreId' in transaction ? transaction.titreId : undefined;
    return Boolean(titreId && !titres.has(titreId));
  });
}

export interface ResumeFusion {
  /** Phrase principale, affichable telle quelle. */
  texte: string;
  /** Vrai si la fusion n'a rien changé. */
  sansEffet: boolean;
}

/** Résume une fusion en une phrase, pour l'écran de synchronisation. */
export function resumerFusion(fusion: Fusion): ResumeFusion {
  const morceaux: string[] = [];
  if (fusion.transactionsAjoutees > 0) {
    morceaux.push(`${fusion.transactionsAjoutees} opération(s)`);
  }
  if (fusion.comptesAjoutes > 0) {
    morceaux.push(`${fusion.comptesAjoutes} compte(s)`);
  }
  if (fusion.titresAjoutes > 0) {
    morceaux.push(`${fusion.titresAjoutes} valeur(s)`);
  }

  if (morceaux.length === 0) {
    return {
      texte:
        fusion.conflits.length > 0
          ? 'Rien de nouveau à reprendre, mais des divergences ont été relevées.'
          : 'Rien de nouveau : les deux appareils étaient déjà au même point.',
      sansEffet: true,
    };
  }

  return {
    texte: `Repris de l’autre appareil : ${morceaux.join(', ')}.`,
    sansEffet: false,
  };
}
