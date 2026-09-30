/**
 * Partage des sources de Tsuzuku par le relais.
 *
 * Nouveau type d'objet dans l'ESPACE de chaque compte (`/p/<id>/boite/<nom>`,
 * voir docs/synchro-relais.md) :
 *
 *  - `tsuzuku-cle` (écrit par le compte lui-même) : la clé PUBLIQUE X25519 de
 *    réception de ce compte, `{ v: 1, cle }`. La clé privée ne quitte jamais sa
 *    base chiffrée (`tsuzuku.reception`) ;
 *  - `tsuzuku-sources` (écrit par le compte historique, jeton maître ; le
 *    relais refuse qu'un jeton de profil l'écrive ou l'efface) : SES sources
 *    partagées, scellées pour sa clé publique (ECIES X25519 + XChaCha20-
 *    Poly1305, usage lié à l'identifiant du compte) : `{ v: 1, cle, depot }`.
 *    Le contenu ne cite aucun autre compte et aucune clé d'API.
 *
 * Retrait : une liste vide est publiée (ou l'objet effacé si la clé du compte
 * est inconnue) ; le bénéficiaire vide alors sa copie.
 *
 * Compatibilité : un appareil ancien ne lit ni n'écrit ces objets (il ne liste
 * que les noms qu'il connaît) ; un relais ancien les accepte (noms valides) —
 * seule la lecture seule côté ami demande de redéployer le relais.
 */

import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { genererPaireSequestre, ouvrirDepot, publiqueDepuisPrivee, scellerPourAdmin, utf8DepuisOctets } from '../../securite/sequestre';
import { aleatoireParDefaut, type SourceAleatoire } from '../../securite/aleatoire';
import type { Espaces } from '../../sync/relais/espaces';
import { empreinte } from '../../sync/relais/fusionLww';
import type { DefinitionSource } from '../moteur/sources';
import { ecrireRecues, lireRecues, lireListeSources, lirePartages, publicationsParCompte, type CompteBeneficiaire } from '../app/gestion';
import { CLES, type BasePrefs } from './stockage';

export const OBJET_CLE = 'tsuzuku-cle';
export const OBJET_SOURCES = 'tsuzuku-sources';
/** Objets Tsuzuku d'un espace (effacés avec le compte). */
export const OBJETS_TSUZUKU = [OBJET_CLE, OBJET_SOURCES] as const;
export const VERSION_PARTAGE = 1;
const MOTIF_CLE = /^[0-9a-f]{64}$/;
const usage = (id: string) => `tsuzuku-sources|${id}`;

// ------------------------------------------------------------------ Paire de réception

export interface PaireReception {
  privee: string;
  publique: string;
}

export function lirePaire(texte: string | null | undefined): PaireReception | undefined {
  try {
    const o = texte ? (JSON.parse(texte) as { privee?: unknown }) : undefined;
    if (typeof o?.privee !== 'string' || !MOTIF_CLE.test(o.privee)) return undefined;
    return { privee: o.privee, publique: bytesToHex(publiqueDepuisPrivee(hexToBytes(o.privee))) };
  } catch {
    return undefined;
  }
}

export function nouvellePaire(alea: SourceAleatoire = aleatoireParDefaut): PaireReception {
  const p = genererPaireSequestre(alea);
  return { privee: bytesToHex(p.privee), publique: bytesToHex(p.publique) };
}

/** Paire du compte, créée (et rangée dans SA base chiffrée) au premier besoin. */
export function paireDe(base: BasePrefs, alea?: SourceAleatoire): PaireReception {
  const lue = lirePaire(base.lire(CLES.reception));
  if (lue) return lue;
  const neuve = nouvellePaire(alea);
  base.ecrire(CLES.reception, JSON.stringify({ v: 1, privee: neuve.privee }));
  return neuve;
}

export const documentCle = (publique: string): string => JSON.stringify({ v: VERSION_PARTAGE, cle: publique });

export function lireDocumentCle(charge: string | undefined): string | undefined {
  try {
    const o = charge ? (JSON.parse(charge) as { cle?: unknown }) : undefined;
    return typeof o?.cle === 'string' && MOTIF_CLE.test(o.cle) ? o.cle : undefined;
  } catch {
    return undefined;
  }
}

// ------------------------------------------------------------------ Publication scellée

export function scellerPublication(publique: string, id: string, sources: readonly DefinitionSource[], date: string, alea?: SourceAleatoire): string {
  const contenu = utf8ToBytes(JSON.stringify({ v: VERSION_PARTAGE, date, sources }));
  return JSON.stringify({ v: VERSION_PARTAGE, cle: publique, depot: scellerPourAdmin(publique, contenu, usage(id), alea) });
}

/** Ouvre une publication avec la clé privée du compte. Lève si elle ne lui est pas destinée. */
export function ouvrirPublication(paire: PaireReception, id: string, charge: string): { date: string; sources: DefinitionSource[] } {
  const o = JSON.parse(charge) as { v?: unknown; depot?: unknown };
  if (typeof o.depot !== 'string') throw new Error('Publication de sources illisible.');
  const texte = utf8DepuisOctets(ouvrirDepot(hexToBytes(paire.privee), o.depot, usage(id)));
  const r = lireRecues(texte);
  return { date: r.date, sources: r.sources };
}

// ------------------------------------------------------------------ Tour du compte historique

/** Ce que le compte historique retient entre deux tours, par compte (rien de secret). */
export type EtatPublications = Record<string, { h?: string; cle?: string; cleDate?: string }>;

export interface OptionsPublier {
  espaces: Espaces;
  /** Comptes de l'annuaire (apps, activation). */
  comptes: readonly CompteBeneficiaire[];
  /** Base du Fondateur historique : ses sources et leurs partages. */
  base: Pick<BasePrefs, 'lire'>;
  etat: EtatPublications;
  maintenant: string;
  /** Objets déjà listés par compte (évite une lecture). */
  objets?: (id: string) => Promise<Record<string, { date: string }>>;
  alea?: SourceAleatoire;
}

export interface BilanPublier {
  etat: EtatPublications;
  depots: number;
  /** Comptes à qui une source est partagée mais qui n'ont pas encore publié leur clé. */
  enAttente: string[];
  erreurs: string[];
}

/**
 * Publie, pour chaque compte, SES sources partagées. Un tour sans changement
 * n'écrit rien (empreinte de la liste et de la clé retenues).
 */
export async function publierSourcesPartagees(o: OptionsPublier): Promise<BilanPublier> {
  const etat: EtatPublications = { ...o.etat };
  const bilan: BilanPublier = { etat, depots: 0, enAttente: [], erreurs: [] };
  const publications = publicationsParCompte(lireListeSources(o.base.lire(CLES.sources)), lirePartages(o.base.lire(CLES.partages)), o.comptes);
  for (const [id, sources] of Object.entries(publications)) {
    try {
      const suivi = { ...etat[id] };
      const h = empreinte(sources);
      if (suivi.h === undefined && sources.length === 0) continue; // Jamais rien publié, rien à publier.
      const objets = o.objets ? await o.objets(id) : await o.espaces.lister(id);
      const dateCle = objets[OBJET_CLE]?.date;
      if (dateCle && dateCle !== suivi.cleDate) {
        const doc = await o.espaces.lire(id, OBJET_CLE);
        suivi.cle = lireDocumentCle(doc?.charge);
        suivi.cleDate = dateCle;
      } else if (!dateCle) {
        suivi.cle = undefined;
        suivi.cleDate = undefined;
      }
      const hPublie = `${h}|${suivi.cle ?? ''}`;
      if (hPublie === suivi.h) {
        etat[id] = suivi;
        continue;
      }
      if (!suivi.cle) {
        if (sources.length > 0) {
          bilan.enAttente.push(id);
        } else if (objets[OBJET_SOURCES]) {
          await o.espaces.supprimer(id, OBJET_SOURCES);
          bilan.depots++;
        }
        // Retenu seulement pour un retrait accompli : une liste en attente sera publiée dès que la clé arrive.
        etat[id] = sources.length > 0 ? { ...suivi, h: suivi.h } : { ...suivi, h: hPublie };
        continue;
      }
      await o.espaces.deposer(id, OBJET_SOURCES, scellerPublication(suivi.cle, id, sources, o.maintenant, o.alea), o.maintenant);
      bilan.depots++;
      etat[id] = { ...suivi, h: hPublie };
    } catch (erreur) {
      bilan.erreurs.push(erreur instanceof Error ? erreur.message : String(erreur));
    }
  }
  // Comptes disparus : on oublie leur suivi (leur espace est vidé par ailleurs).
  for (const id of Object.keys(etat)) {
    if (!(id in publications)) delete etat[id];
  }
  return bilan;
}

// ------------------------------------------------------------------ Tour d'un bénéficiaire

export interface SuiviReception {
  /** Clé publique déposée par cet appareil, et date de l'objet vu sur le relais. */
  clePubliee?: string;
  cleVue?: string;
  /** Date de la publication de sources déjà lue. */
  sourcesLues?: string;
}

export interface OptionsRecevoir {
  espaces: Espaces;
  id: string;
  /** Base chiffrée du compte ouvert. */
  base: BasePrefs;
  objets: Record<string, { date: string }>;
  suivi: SuiviReception;
  maintenant: string;
  alea?: SourceAleatoire;
}

/**
 * Publie la clé de réception du compte (si besoin) et range dans SA base les
 * sources qui lui sont partagées. Renvoie vrai quand la copie a changé.
 */
export async function recevoirSourcesPartagees(o: OptionsRecevoir): Promise<{ suivi: SuiviReception; change: boolean; depots: number }> {
  const suivi = { ...o.suivi };
  let depots = 0;
  let change = false;
  const paire = paireDe(o.base, o.alea);
  const dateCle = o.objets[OBJET_CLE]?.date;
  let aJour = Boolean(dateCle) && suivi.clePubliee === paire.publique && suivi.cleVue === dateCle;
  if (!aJour && dateCle) {
    // Un autre appareil du compte a pu déposer une autre clé : on relit.
    aJour = lireDocumentCle((await o.espaces.lire(o.id, OBJET_CLE))?.charge) === paire.publique;
    if (aJour) {
      suivi.clePubliee = paire.publique;
      suivi.cleVue = dateCle;
    }
  }
  if (!aJour) {
    await o.espaces.deposer(o.id, OBJET_CLE, documentCle(paire.publique), o.maintenant);
    suivi.clePubliee = paire.publique;
    suivi.cleVue = o.maintenant;
    depots++;
  }
  const date = o.objets[OBJET_SOURCES]?.date;
  const actuelle = o.base.lire(CLES.sourcesRecues);
  if (date && date !== suivi.sourcesLues) {
    const objet = await o.espaces.lire(o.id, OBJET_SOURCES);
    if (objet) {
      try {
        const recu = ouvrirPublication(paire, o.id, objet.charge);
        const texte = ecrireRecues(recu);
        if (texte !== actuelle) {
          o.base.ecrire(CLES.sourcesRecues, texte);
          change = true;
        }
        suivi.sourcesLues = date;
      } catch {
        // Scellée pour une autre clé (nouvelle paire) : le compte historique republiera pour la clé déposée.
      }
    }
  } else if (!date && actuelle && lireRecues(actuelle).sources.length > 0) {
    // Objet effacé : plus rien n'est partagé avec ce compte.
    o.base.ecrire(CLES.sourcesRecues, ecrireRecues({ date: o.maintenant, sources: [] }));
    suivi.sourcesLues = undefined;
    change = true;
  }
  return { suivi, change, depots };
}
