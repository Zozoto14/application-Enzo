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

export type Genre = 'compte' | 'titre' | 'operation' | 'surveille' | 'these' | 'parametre';

/** Réglages qui décrivent le portefeuille, donc communs à tous les appareils. */
export const PARAMETRES_PARTAGES: readonly string[] = [
  PARAMETRES.objectif,
  PARAMETRES.repartitionCible,
  PARAMETRES.fraisEtf,
  PARAMETRES.versementMensuel,
];

/** Ordre d'écriture : ce dont les autres dépendent d'abord. */
export const ORDRE_ECRITURE: readonly Genre[] = ['compte', 'titre', 'operation', 'surveille', 'these', 'parametre'];

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
  return entites;
}

/**
 * Écrit une entité venue d'un autre appareil (création ou remplacement).
 * `alias` renvoie l'identifiant local d'une valeur connue ici sous un autre
 * identifiant (même ISIN créé des deux côtés).
 */
export function ecrireEntite(
  pilote: PiloteSqlite,
  cle: string,
  valeur: unknown,
  alias: (titreId: string) => string,
): void {
  const { genre, id } = decouper(cle);
  const brut = valeur as Record<string, unknown>;
  switch (genre) {
    case 'compte':
      new DepotComptes(pilote).enregistrer(brut as unknown as Compte);
      return;
    case 'titre':
      new DepotTitres(pilote).enregistrer(brut as unknown as Titre);
      return;
    case 'operation': {
      const operation = reconstruireTransaction(brut);
      if ('titreId' in operation && operation.titreId) {
        (operation as { titreId: string }).titreId = alias(operation.titreId);
      }
      new DepotTransactions(pilote).enregistrer(operation);
      return;
    }
    case 'surveille':
      new DepotWatchlist(pilote).ajouter({
        titreId: alias(String(brut.titreId ?? id)),
        ajouteLe: String(brut.ajouteLe),
        coursAjout: typeof brut.coursAjout === 'string' ? Decimal.de(brut.coursAjout) : undefined,
        note: typeof brut.note === 'string' ? brut.note : undefined,
      });
      return;
    case 'these': {
      const parametres = new DepotParametres(pilote);
      const carnet = lireCarnet(parametres);
      carnet[alias(id)] = brut;
      parametres.ecrire(PARAMETRES.carnetTheses, JSON.stringify(carnet));
      return;
    }
    case 'parametre':
      if (PARAMETRES_PARTAGES.includes(id) && typeof valeur === 'string') {
        new DepotParametres(pilote).ecrire(id, valeur);
      }
      return;
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
      // Une valeur ne se supprime pas dans l'application : rien à faire.
      return;
  }
}
