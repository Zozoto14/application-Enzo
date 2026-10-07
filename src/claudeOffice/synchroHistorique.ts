/**
 * Historique de Claude Office : copie chiffrée sur le relais, pour le
 * consulter depuis le site, le téléphone ou un autre PC — même PC éteint.
 *
 * Désactivée par défaut (réglage de cet appareil). Aucune route nouvelle :
 * chaque appareil équipé dépose UN objet de l'espace de l'administrateur,
 * `p/principal/boite/office-historique-<appareil>`, que seul le jeton maître
 * lit et écrit (le relais refuse tout jeton de profil sur `principal`). Le
 * contenu est scellé par la clé de synchronisation (XChaCha20-Poly1305, voir
 * src/sync/relais/chiffrement.ts) : le relais ne voit que du bruit.
 *
 * Écritures KV bornées : jamais une écriture par requête, mais au plus un
 * dépôt toutes les `DELAI_MIN_ENVOI_MS` (et seulement si quelque chose a
 * changé) : la copie remplace la précédente, en un seul objet par appareil.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { BasePrefs } from '../tsuzuku/plateforme/stockage';
import { ouvrirEnveloppe, sceller, type Enveloppe } from '../sync/relais/chiffrement';
import { espacesDuRelais, publieParAdmin, type Espaces } from '../sync/relais/espaces';
import type { Liaison } from '../sync/relais/liaison';
import { ESPACE_ADMIN, estMaitre } from '../sync/relais/portees';
import { entreeValide, type EntreeHistorique } from './historique';

export const PREFIXE_OBJET = 'office-historique-';
/** Délai minimal entre deux dépôts automatiques (limite d'écritures KV du relais gratuit). */
export const DELAI_MIN_ENVOI_MS = 15 * 60_000;
/** Délai minimal pour « Synchroniser maintenant ». */
export const DELAI_MIN_MANUEL_MS = 60_000;
/** Au plus ces entrées (les plus récentes), et ce volume, par appareil. */
export const MAX_ENTREES_SYNCHRO = 5_000;
export const MAX_OCTETS_SYNCHRO = 3_000_000;
export const CLE_ETAT_SYNCHRO = 'claude-office.historique.synchro';
const FORMAT = 'claude-office-historique';

export interface ConfigHistoriqueRelais extends Liaison {
  /** Clé de synchronisation (hexadécimal), jamais affichée. */
  cle: string;
}

export interface CopieAppareil {
  objet: string;
  appareil?: string;
  date: string;
  entrees: number;
}

export interface ServiceHistoriqueRelais {
  /** Dépose (remplace) la copie chiffrée des entrées de cet appareil. */
  deposer(appareilId: string, entrees: readonly EntreeHistorique[], date?: string): Promise<void>;
  /** Toutes les copies déposées par les appareils équipés, déchiffrées. */
  lireTout(): Promise<{ entrees: EntreeHistorique[]; copies: CopieAppareil[]; erreurs: string[] }>;
  /** Retire du relais la copie d'un appareil. */
  retirer(appareilId: string): Promise<void>;
}

export const nomObjet = (appareilId: string): string => {
  if (!/^[0-9a-f]{12}$/.test(appareilId)) throw new Error('Identifiant d’appareil invalide.');
  return `${PREFIXE_OBJET}${appareilId}`;
};

/**
 * Service de synchro, ou rien : seulement pour le compte principal (jeton
 * maître). Un ami, un gestionnaire ou un compte promu (jeton de profil) n'a
 * aucun accès à l'espace `principal`.
 */
export function creerServiceHistorique(
  config: ConfigHistoriqueRelais | undefined,
  options: { espaces?: Espaces; requete?: typeof fetch } = {},
): ServiceHistoriqueRelais | undefined {
  if (!config || !/^[0-9a-f]{64}$/.test(config.cle) || !estMaitre(config)) return undefined;
  const espaces = options.espaces ?? espacesDuRelais(config, options.requete);
  return {
    async deposer(appareilId, entrees, date = new Date().toISOString()) {
      const nom = nomObjet(appareilId);
      const enveloppe = sceller(config.cle, { format: FORMAT, version: 1, appareilId, entrees }, nom, date);
      await espaces.deposer(ESPACE_ADMIN, nom, JSON.stringify(enveloppe), date);
    },
    async lireTout() {
      const liste = await espaces.lister(ESPACE_ADMIN);
      const entrees: EntreeHistorique[] = [];
      const copies: CopieAppareil[] = [];
      const erreurs: string[] = [];
      for (const nom of Object.keys(liste).filter(n => n.startsWith(PREFIXE_OBJET)).sort()) {
        try {
          const objet = await espaces.lire(ESPACE_ADMIN, nom);
          if (!objet || !publieParAdmin(objet.auteur)) continue;
          const enveloppe = JSON.parse(objet.charge) as Enveloppe;
          // L'appareil (nom de l'objet) est lié au chiffré : une copie déplacée ne s'ouvre pas.
          if (enveloppe.appareil !== nom) throw new Error('copie déplacée');
          const contenu = ouvrirEnveloppe<{ format?: string; entrees?: unknown[] }>(config.cle, enveloppe);
          if (contenu.format !== FORMAT || !Array.isArray(contenu.entrees)) throw new Error('format inconnu');
          const valides = contenu.entrees.filter(entreeValide);
          entrees.push(...valides);
          copies.push({ objet: nom, appareil: valides.find(e => e.appareil)?.appareil, date: objet.date, entrees: valides.length });
        } catch (erreur) {
          erreurs.push(`${nom} : ${(erreur as Error).message}`);
        }
      }
      return { entrees, copies, erreurs };
    },
    async retirer(appareilId) {
      await espaces.supprimer(ESPACE_ADMIN, nomObjet(appareilId));
    },
  };
}

// ---------------------------------------------------------------- état

export interface EtatSynchroHistorique {
  active: boolean;
  /** Dernier dépôt réussi (ISO). */
  derniere?: string;
  /** Empreinte de ce qui a été déposé (pour ne pas redéposer la même chose). */
  empreinte?: string;
  erreur?: string;
}

export function lireEtatSynchro(base: BasePrefs | undefined): EtatSynchroHistorique {
  try {
    const o = JSON.parse(base?.lire(CLE_ETAT_SYNCHRO) ?? '{}') as Partial<EtatSynchroHistorique>;
    return {
      active: o.active === true,
      ...(typeof o.derniere === 'string' ? { derniere: o.derniere } : {}),
      ...(typeof o.empreinte === 'string' ? { empreinte: o.empreinte } : {}),
      ...(typeof o.erreur === 'string' ? { erreur: o.erreur } : {}),
    };
  } catch {
    return { active: false };
  }
}

export function ecrireEtatSynchro(base: BasePrefs | undefined, etat: EtatSynchroHistorique): void {
  base?.ecrire(CLE_ETAT_SYNCHRO, JSON.stringify(etat));
}

/** Les entrées les plus récentes qui tiennent dans les bornes (nombre et volume). */
export function selectionnerPourEnvoi(entrees: readonly EntreeHistorique[]): EntreeHistorique[] {
  const choisies: EntreeHistorique[] = [];
  let octets = 0;
  for (let i = entrees.length - 1; i >= 0 && choisies.length < MAX_ENTREES_SYNCHRO; i--) {
    const taille = JSON.stringify(entrees[i]).length;
    if (octets + taille > MAX_OCTETS_SYNCHRO) break;
    octets += taille;
    choisies.push(entrees[i]);
  }
  return choisies.reverse();
}

export const empreinteEntrees = (entrees: readonly EntreeHistorique[]): string =>
  bytesToHex(sha256(utf8ToBytes(JSON.stringify(entrees)))).slice(0, 32);

export type IssueSynchro = 'desactivee' | 'trop-tot' | 'inchangee' | 'envoyee' | 'echec' | 'indisponible';

/**
 * Un dépôt, s'il est dû : synchro activée, délai minimal écoulé (sauf
 * `manuel`, qui a son propre délai plus court), et contenu changé.
 */
export async function synchroniserSiDu(o: {
  service: ServiceHistoriqueRelais | undefined;
  base: BasePrefs | undefined;
  appareilId: string | undefined;
  entrees: readonly EntreeHistorique[];
  maintenant?: Date;
  manuel?: boolean;
}): Promise<{ issue: IssueSynchro; etat: EtatSynchroHistorique }> {
  const etat = lireEtatSynchro(o.base);
  if (!etat.active) return { issue: 'desactivee', etat };
  if (!o.service || !o.appareilId) return { issue: 'indisponible', etat };
  const maintenant = o.maintenant ?? new Date();
  const ecoule = etat.derniere ? maintenant.getTime() - Date.parse(etat.derniere) : Infinity;
  if (ecoule < (o.manuel ? DELAI_MIN_MANUEL_MS : DELAI_MIN_ENVOI_MS)) return { issue: 'trop-tot', etat };
  // Seules les entrées de CET appareil (et celles importées ici) : chaque appareil dépose les siennes.
  const propres = o.entrees.filter(e => !e.appareilId || e.appareilId === o.appareilId || e.importe);
  const choisies = selectionnerPourEnvoi(propres.map(({ importe: _importe, ...reste }) => reste as EntreeHistorique));
  const empreinte = empreinteEntrees(choisies);
  if (empreinte === etat.empreinte && !o.manuel) return { issue: 'inchangee', etat };
  try {
    await o.service.deposer(o.appareilId, choisies, maintenant.toISOString());
    const suivant: EtatSynchroHistorique = { active: true, derniere: maintenant.toISOString(), empreinte };
    ecrireEtatSynchro(o.base, suivant);
    return { issue: 'envoyee', etat: suivant };
  } catch (erreur) {
    const suivant: EtatSynchroHistorique = { ...etat, erreur: (erreur as Error).message };
    ecrireEtatSynchro(o.base, suivant);
    return { issue: 'echec', etat: suivant };
  }
}
