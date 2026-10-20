/**
 * Relais en service sur cet appareil, connu hors de React.
 *
 * Le site de secours fait passer Yahoo et les médias par le relais : un
 * navigateur n'a pas le droit de les appeler lui-même. Le détour est posé
 * sur `fetch` avant même le déverrouillage, alors que la configuration vit
 * dans la base chiffrée ; ce petit registre fait le lien.
 */

import { stockageDuProfil, surChangementDeCompte } from '../../profils/espace';

export interface RelaisActif {
  relais: string;
  jeton: string;
}

let actif: RelaisActif | undefined;

// Le relais (et son jeton) appartient au profil qui l'a configuré.
surChangementDeCompte(() => {
  actif = undefined;
  enAttente = undefined;
  liaisonCompte = undefined;
});

export function definirRelaisActif(relais: RelaisActif | undefined): void {
  actif = relais;
}

export function relaisActif(): RelaisActif | undefined {
  return actif;
}

// ------------------------------------------------- Liaison du compte ouvert (site)
//
// Sur le site, un ami connecté par identifiant + mot de passe n'a pas de
// configuration de relais dans sa base : sa liaison (jeton de PROFIL) est
// gardée par le navigateur (bureau/synchroComptes.ts). Le site la déclare ici
// pour les apps qui parlent à un service avec le jeton du compte (Esport).

let liaisonCompte: RelaisActif | undefined;

export function definirLiaisonCompte(relais: RelaisActif | undefined): void {
  liaisonCompte = relais ? { relais: relais.relais, jeton: relais.jeton } : undefined;
}

/** Relais et jeton du compte ouvert : configuration du relais, sinon liaison gardée par le site. */
export function relaisDuCompte(): RelaisActif | undefined {
  return actif ?? liaisonCompte;
}

// ------------------------------------------------- Liaison en attente
//
// « Lier » sur l'écran d'ouverture récupère le coffre avant tout
// déverrouillage : la configuration du relais, elle, ne peut s'écrire que
// dans la base chiffrée, donc après. Le code attend ici (et dans le
// stockage du navigateur, pour survivre à un rechargement du site).

const CLE_LIAISON = 'applibourse.liaison';
type Memoire = { getItem(cle: string): string | null; setItem(cle: string, valeur: string): void };
const memoire = () => stockageDuProfil((globalThis as { localStorage?: Memoire }).localStorage);
let enAttente: string | undefined;

export function definirLiaisonEnAttente(code: string | undefined): void {
  enAttente = code;
  try {
    if (code) {
      memoire()?.setItem(CLE_LIAISON, code);
    }
  } catch {
    // Navigation privée : la mémoire suffit pour cette ouverture.
  }
}

export function liaisonEnAttente(): string | undefined {
  if (enAttente) {
    return enAttente;
  }
  try {
    return memoire()?.getItem(CLE_LIAISON) ?? undefined;
  } catch {
    return undefined;
  }
}
