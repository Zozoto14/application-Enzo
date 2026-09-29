/**
 * Ce qui voyage entre appareils, sous forme d'entités indépendantes.
 *
 * Chaque chose partagée — un compte, une valeur, une opération, une ligne de
 * la watchlist, une thèse du carnet, quelques réglages de portefeuille —
 * devient une entrée `genre:identifiant` → objet JSON. La fusion ne connaît
 * que ces entrées : elle n'a pas à savoir ce qu'est un PRU.
 *
 * Restent sur l'appareil, comme pour la fusion manuelle (application.ts) :
 * les réglages propres à l'appareil, l'identifiant d'appareil, l'historique
 * des cours (il se recharge seul).
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { Decimal } from '../../core/money/decimal';
import type { Compte, Titre } from '../../core/domain/types';
import {
  DepotComptes,
  DepotParametres,
  DepotTitres,
  DepotTransactions,
  DepotWatchlist,
  PARAMETRES,
} from '../../db/depots';
import type { PiloteSqlite } from '../../db/pilote';
import { reconstruireTransaction } from '../../sauvegarde/archive';

/** Genres connus depuis la première version de la synchro (charge sans numéro de version). */
export type GenreV1 = 'compte' | 'titre' | 'operation' | 'surveille' | 'these' | 'parametre';
/** Genres ajoutés en version 2 : préférences du hub, thèmes, nouveautés déjà vues. */
export type GenreV2 = 'prefs' | 'devblog';
export type Genre = GenreV1 | GenreV2;

/**
 * Version du format de charge écrite par cet appareil.
 *  - absente / 1 : les six genres d'origine ;
 *  - 2 : + `prefs` et `devblog`.
 * Un appareil qui lit un genre qu'il ne connaît pas l'ignore sans erreur.
 */
export const VERSION_CHARGE = 2;
export const GENRES_V2: readonly GenreV2[] = ['prefs', 'devblog'];
export const GENRES_CONNUS: readonly Genre[] = ['compte', 'titre', 'operation', 'surveille', 'these', 'parametre', 'prefs', 'devblog'];
/** Genres qui se fusionnent par union et ne se suppriment jamais. */
export const GENRES_UNION: readonly Genre[] = ['devblog'];

// Clés des paramètres du profil (les mêmes que src/hub/personnalisation.ts et
// logiqueDevblog.ts ; un test vérifie l'égalité, pour ne pas importer l'UI ici).
export const CLE_PREFS_HUB = 'hub.prefs';
export const CLE_THEME_HUB = 'hub.theme';
export const CLE_DEVBLOG_VUES = 'hub.devblog';

/** Entité `prefs:<id>` → clé de paramètre du profil. */
export const PREFS_SYNCHRONISEES: Readonly<Record<string, string>> = {
  hub: CLE_PREFS_HUB,
  theme: CLE_THEME_HUB,
  'theme-portefeuille': PARAMETRES.theme,
};
export const ID_DEVBLOG_VUES = 'vues';
const TAILLE_MAX_PREF = 50_000;

export const genreConnu = (cle: string): boolean => GENRES_CONNUS.includes(decouper(cle).genre);
export const estGenreV2 = (cle: string): boolean => (GENRES_V2 as readonly string[]).includes(decouper(cle).genre);
export const estUnion = (cle: string): boolean => GENRES_UNION.includes(decouper(cle).genre);

/** Versions vues, lues sans jamais lever (valeur brute d'un paramètre ou entité reçue). */
export function versionsVues(brut: unknown): string[] {
  try {
    const objet = typeof brut === 'string' ? (JSON.parse(brut) as unknown) : brut;
    const vues = (objet as { vues?: unknown } | null)?.vues;
    return Array.isArray(vues) ? [...new Set(vues.filter((v): v is string => typeof v === 'string' && v.length <= 32))].sort() : [];
  } catch {
    return [];
  }
}

/** Union de deux ensembles de versions vues, au format `{ vues }` de l'entité. */
export const unionVues = (a: unknown, b: unknown): { vues: string[] } => ({
  vues: [...new Set([...versionsVues(a), ...versionsVues(b)])].sort(),
});

/** Réglages qui décrivent le portefeuille, donc communs à tous les appareils. */
export const PARAMETRES_PARTAGES: readonly string[] = [
  PARAMETRES.objectif,
  PARAMETRES.repartitionCible,
  PARAMETRES.fraisEtf,
  PARAMETRES.versementMensuel,
];

/** Clés de paramètres dont la modification déclenche un tour (hors état interne de la synchro). */
export const PARAMETRES_A_SYNCHRONISER: readonly string[] = [
  ...PARAMETRES_PARTAGES,
  PARAMETRES.carnetTheses,
  CLE_PREFS_HUB,
  CLE_THEME_HUB,
  PARAMETRES.theme,
  CLE_DEVBLOG_VUES,
];

/** Ordre d'écriture : ce dont les autres dépendent d'abord. */
export const ORDRE_ECRITURE: readonly Genre[] = ['compte', 'titre', 'operation', 'surveille', 'these', 'parametre', 'prefs', 'devblog'];

export type Entites = Record<string, unknown>;

export const cleEntite = (genre: Genre, id: string) => `${genre}:${id}`;

export function decouper(cle: string): { genre: Genre; id: string } {
  const separation = cle.indexOf(':');
  return { genre: cle.slice(0, separation) as Genre, id: cle.slice(separation + 1) };
}

/** Forme JSON canonique : les Decimal deviennent des chaînes, les undefined disparaissent. */
const enJson = (valeur: unknown): unknown => JSON.parse(JSON.stringify(valeur));

export function empreinte(valeur: unknown): string {
  return bytesToHex(sha256(utf8ToBytes(JSON.stringify(valeur)))).slice(0, 24);
}

function lireCarnet(parametres: DepotParametres): Record<string, unknown> {
  try {
    const carnet = JSON.parse(parametres.lire(PARAMETRES.carnetTheses) ?? '{}');
    return carnet && typeof carnet === 'object' && !Array.isArray(carnet) ? carnet : {};
  } catch {
    return {};
  }
}

/** Tout ce qui se partage, lu dans la base. */
export function extraireEntites(pilote: PiloteSqlite): Entites {
  const entites: Entites = {};
  for (const compte of new DepotComptes(pilote).tous()) {
    entites[cleEntite('compte', compte.id)] = enJson(compte);
  }
  for (const titre of new DepotTitres(pilote).tous()) {
    entites[cleEntite('titre', titre.id)] = enJson(titre);
  }
  for (const operation of new DepotTransactions(pilote).toutes()) {
    entites[cleEntite('operation', operation.id)] = enJson(operation);
  }
  for (const ligne of new DepotWatchlist(pilote).lister()) {
    entites[cleEntite('surveille', ligne.titreId)] = enJson(ligne);
  }
  const parametres = new DepotParametres(pilote);
  for (const [titreId, these] of Object.entries(lireCarnet(parametres))) {
    entites[cleEntite('these', titreId)] = enJson(these);
  }
  for (const cle of PARAMETRES_PARTAGES) {
    const valeur = parametres.lire(cle);
    if (valeur !== undefined) {
      entites[cleEntite('parametre', cle)] = valeur;
    }
  }
  for (const [id, cle] of Object.entries(PREFS_SYNCHRONISEES)) {
    const valeur = parametres.lire(cle);
    if (valeur !== undefined) {
      entites[cleEntite('prefs', id)] = valeur;
    }
  }
  const brutVues = parametres.lire(CLE_DEVBLOG_VUES);
  if (brutVues !== undefined) {
    entites[cleEntite('devblog', ID_DEVBLOG_VUES)] = unionVues(brutVues, undefined);
  }
  return entites;
}

/**
 * Écrit une entité venue d'un autre appareil (création ou remplacement).
 * `alias` renvoie l'identifiant local d'une valeur connue ici sous un autre
 * identifiant (même ISIN créé des deux côtés).
 * Renvoie `false` quand l'entité n'a rien changé parce qu'elle est d'un genre
 * inconnu de cette version (charge d'un appareil plus récent) ou invalide :
 * l'appelant ne la compte pas et n'en retient aucune date.
 */
export function ecrireEntite(
  pilote: PiloteSqlite,
  cle: string,
  valeur: unknown,
  alias: (titreId: string) => string,
): boolean {
  const { genre, id } = decouper(cle);
  const brut = valeur as Record<string, unknown>;
  switch (genre) {
    case 'compte':
      new DepotComptes(pilote).enregistrer(brut as unknown as Compte);
      return true;
    case 'titre':
      new DepotTitres(pilote).enregistrer(brut as unknown as Titre);
      return true;
    case 'operation': {
      const operation = reconstruireTransaction(brut);
      if ('titreId' in operation && operation.titreId) {
        (operation as { titreId: string }).titreId = alias(operation.titreId);
      }
      new DepotTransactions(pilote).enregistrer(operation);
      return true;
    }
    case 'surveille':
      new DepotWatchlist(pilote).ajouter({
        titreId: alias(String(brut.titreId ?? id)),
        ajouteLe: String(brut.ajouteLe),
        coursAjout: typeof brut.coursAjout === 'string' ? Decimal.de(brut.coursAjout) : undefined,
        note: typeof brut.note === 'string' ? brut.note : undefined,
      });
      return true;
    case 'these': {
      const parametres = new DepotParametres(pilote);
      const carnet = lireCarnet(parametres);
      carnet[alias(id)] = brut;
      parametres.ecrire(PARAMETRES.carnetTheses, JSON.stringify(carnet));
      return true;
    }
    case 'parametre':
      if (PARAMETRES_PARTAGES.includes(id) && typeof valeur === 'string') {
        new DepotParametres(pilote).ecrire(id, valeur);
        return true;
      }
      return false;
    case 'prefs': {
      const parametre = PREFS_SYNCHRONISEES[id];
      if (parametre === undefined || typeof valeur !== 'string' || valeur.length > TAILLE_MAX_PREF) {
        return false;
      }
      new DepotParametres(pilote).ecrire(parametre, valeur);
      return true;
    }
    case 'devblog': {
      if (id !== ID_DEVBLOG_VUES) {
        return false;
      }
      // Jamais de retrait : on ajoute ce qui a été vu ailleurs à ce qui l'est ici.
      const parametres = new DepotParametres(pilote);
      const { vues } = unionVues(parametres.lire(CLE_DEVBLOG_VUES), valeur);
      parametres.ecrire(CLE_DEVBLOG_VUES, JSON.stringify({ version: 1, vues }));
      return true;
    }
    default:
      // Genre ajouté par une version plus récente : ignoré sans erreur.
      return false;
  }
}

/** Retire une entité supprimée sur un autre appareil. */
export function supprimerEntite(pilote: PiloteSqlite, cle: string): void {
  const { genre, id } = decouper(cle);
  switch (genre) {
    case 'compte':
      new DepotComptes(pilote).supprimer(id);
      return;
    case 'operation':
      new DepotTransactions(pilote).supprimer(id);
      return;
    case 'surveille':
      new DepotWatchlist(pilote).retirer(id);
      return;
    case 'these': {
      const parametres = new DepotParametres(pilote);
      const carnet = lireCarnet(parametres);
      delete carnet[id];
      parametres.ecrire(PARAMETRES.carnetTheses, JSON.stringify(carnet));
      return;
    }
    case 'parametre':
      if (PARAMETRES_PARTAGES.includes(id)) {
        new DepotParametres(pilote).supprimer(id);
      }
      return;
    case 'titre':
    case 'prefs':
    case 'devblog':
      // Une valeur ne se supprime pas ; une préférence ou une version vue non plus.
      return;
    default:
      // Genre inconnu de cette version : ignoré.
      return;
  }
}
