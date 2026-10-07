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
import { entreeValide, type EntreeHistorique } from './logiqueHistorique';

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
  /** Dépose (remplace) la petite « présence » chiffrée de cet appareil (activité récente). */
  deposerPresence?(appareilId: string, entrees: readonly EntreeHistorique[], date?: string): Promise<void>;
  /**
   * Activité pour le bureau : présences et (option) copies d'historique,
   * relues seulement si leur date a changé depuis `cache`.
   */
  lireActivite?(o?: { historique?: boolean; cache?: CacheActivite }): Promise<LectureActivite>;
  /** Toutes les copies déposées par les appareils équipés, déchiffrées. */
  lireTout(): Promise<{ entrees: EntreeHistorique[]; copies: CopieAppareil[]; erreurs: string[] }>;
  /** Retire du relais la copie d'un appareil. */
  retirer(appareilId: string): Promise<void>;
}

/** Un dépôt lu sur le relais, pour le bureau. */
export interface DepotActivite {
  objet: string;
  genre: 'presence' | 'historique';
  appareilId: string;
  appareil?: string;
  date: string;
  entrees: EntreeHistorique[];
}
/** Dépôts déjà lus (par nom d'objet) : un dépôt dont la date n'a pas changé n'est pas relu. */
export type CacheActivite = Map<string, DepotActivite>;
export interface LectureActivite {
  depots: DepotActivite[];
  erreurs: string[];
  cache: CacheActivite;
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
      await espaces.supprimer(ESPACE_ADMIN, nomPresence(appareilId));
    },
    async deposerPresence(appareilId, entrees, date = new Date().toISOString()) {
      const nom = nomPresence(appareilId);
      const enveloppe = sceller(config.cle, { format: FORMAT_PRESENCE, version: 1, appareilId, entrees }, nom, date);
      await espaces.deposer(ESPACE_ADMIN, nom, JSON.stringify(enveloppe), date);
    },
    async lireActivite({ historique = true, cache = new Map() } = {}) {
      // Une lecture de l'index de l'espace, puis seulement les dépôts dont la date a changé.
      const liste = await espaces.lister(ESPACE_ADMIN);
      const suivant: CacheActivite = new Map();
      const erreurs: string[] = [];
      for (const nom of Object.keys(liste).sort()) {
        const genre = nom.startsWith(PREFIXE_PRESENCE) ? 'presence' : historique && nom.startsWith(PREFIXE_OBJET) ? 'historique' : undefined;
        if (!genre) continue;
        const connu = cache.get(nom);
        if (connu && connu.date === liste[nom].date) {
          suivant.set(nom, connu);
          continue;
        }
        try {
          const objet = await espaces.lire(ESPACE_ADMIN, nom);
          if (!objet || !publieParAdmin(objet.auteur)) continue;
          const enveloppe = JSON.parse(objet.charge) as Enveloppe;
          if (enveloppe.appareil !== nom) throw new Error('copie déplacée');
          const contenu = ouvrirEnveloppe<{ format?: string; appareilId?: string; entrees?: unknown[] }>(config.cle, enveloppe);
          if (contenu.format !== (genre === 'presence' ? FORMAT_PRESENCE : FORMAT) || !Array.isArray(contenu.entrees)) throw new Error('format inconnu');
          const entrees = contenu.entrees.filter(entreeValide);
          const appareilId = nom.slice((genre === 'presence' ? PREFIXE_PRESENCE : PREFIXE_OBJET).length);
          suivant.set(nom, { objet: nom, genre, appareilId, appareil: entrees.find(e => e.appareil)?.appareil, date: objet.date, entrees });
        } catch (erreur) {
          erreurs.push(`${nom} : ${(erreur as Error).message}`);
        }
      }
      return { depots: [...suivant.values()], erreurs, cache: suivant };
    },
  };
}

// ---------------------------------------------------------------- présence
//
// Petite copie de l'activité RÉCENTE (dernières heures) d'un PC, déposée plus
// souvent que l'historique pour que le bureau du site et du téléphone soit
// moins en retard — sans toucher au Worker ni dépasser le budget KV gratuit
// (~1 000 écritures/jour ; un dépôt = 2 écritures, valeur + index) :
//  - désactivée par défaut, et seulement si la copie de l'historique est active ;
//  - au plus un dépôt toutes les `DELAI_MIN_PRESENCE_MS`, seulement si
//    l'activité récente a changé (rien quand Claude Code ne fait rien) ;
//  - au plus `MAX_PRESENCES_JOUR` dépôts par jour et par PC, puis pause
//    jusqu'au lendemain (la copie de 15 min continue).
// Pire cas par PC : 96 dépôts d'historique + 48 présences = 288 écritures/jour.

export const PREFIXE_PRESENCE = 'office-presence-';
const FORMAT_PRESENCE = 'claude-office-presence';
export const DELAI_MIN_PRESENCE_MS = 5 * 60_000;
export const MAX_PRESENCES_JOUR = 48;
/** Fenêtre d'activité récente gardée dans la présence. */
export const FENETRE_PRESENCE_MS = 3 * 3_600_000;
export const MAX_ENTREES_PRESENCE = 300;
export const CLE_ETAT_PRESENCE = 'claude-office.presence';

export const nomPresence = (appareilId: string): string => {
  if (!/^[0-9a-f]{12}$/.test(appareilId)) throw new Error('Identifiant d’appareil invalide.');
  return `${PREFIXE_PRESENCE}${appareilId}`;
};

export interface EtatPresence {
  active: boolean;
  derniere?: string;
  empreinte?: string;
  /** Jour local (AAAA-MM-JJ) et nombre de dépôts ce jour-là (plafond quotidien). */
  jour?: string;
  depotsDuJour?: number;
  erreur?: string;
}

export function lireEtatPresence(base: BasePrefs | undefined): EtatPresence {
  try {
    const o = JSON.parse(base?.lire(CLE_ETAT_PRESENCE) ?? '{}') as Partial<EtatPresence>;
    return {
      active: o.active === true,
      ...(typeof o.derniere === 'string' ? { derniere: o.derniere } : {}),
      ...(typeof o.empreinte === 'string' ? { empreinte: o.empreinte } : {}),
      ...(typeof o.jour === 'string' ? { jour: o.jour } : {}),
      ...(typeof o.depotsDuJour === 'number' && o.depotsDuJour >= 0 ? { depotsDuJour: Math.floor(o.depotsDuJour) } : {}),
      ...(typeof o.erreur === 'string' ? { erreur: o.erreur } : {}),
    };
  } catch {
    return { active: false };
  }
}

export function ecrireEtatPresence(base: BasePrefs | undefined, etat: EtatPresence): void {
  base?.ecrire(CLE_ETAT_PRESENCE, JSON.stringify(etat));
}

const jourDe = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Activité récente de CET appareil, allégée : jamais le contenu des outils. */
export function selectionnerPresence(entrees: readonly EntreeHistorique[], appareilId: string, maintenant: Date): EntreeHistorique[] {
  const depuis = maintenant.getTime() - FENETRE_PRESENCE_MS;
  const recentes = entrees.filter(e => (!e.appareilId || e.appareilId === appareilId) && !e.importe && Date.parse(e.ts) >= depuis);
  return recentes.slice(-MAX_ENTREES_PRESENCE).map(e => {
    const reste: EntreeHistorique = { ...e };
    delete reste.entree;
    delete reste.sortie;
    delete reste.importe;
    return reste.texte && reste.texte.length > 500 ? { ...reste, texte: `${reste.texte.slice(0, 499)}…` } : reste;
  });
}

export type IssuePresence = 'desactivee' | 'trop-tot' | 'inchangee' | 'plafond' | 'envoyee' | 'echec' | 'indisponible';

/** Un dépôt de présence, s'il est dû et permis (voir les garde-fous ci-dessus). */
export async function presenceSiDue(o: {
  service: ServiceHistoriqueRelais | undefined;
  base: BasePrefs | undefined;
  appareilId: string | undefined;
  entrees: readonly EntreeHistorique[];
  maintenant?: Date;
}): Promise<{ issue: IssuePresence; etat: EtatPresence }> {
  const etat = lireEtatPresence(o.base);
  if (!etat.active || !lireEtatSynchro(o.base).active) return { issue: 'desactivee', etat };
  if (!o.service?.deposerPresence || !o.appareilId) return { issue: 'indisponible', etat };
  const maintenant = o.maintenant ?? new Date();
  const ecoule = etat.derniere ? maintenant.getTime() - Date.parse(etat.derniere) : Infinity;
  if (ecoule < DELAI_MIN_PRESENCE_MS) return { issue: 'trop-tot', etat };
  const jour = jourDe(maintenant);
  const depots = etat.jour === jour ? (etat.depotsDuJour ?? 0) : 0;
  if (depots >= MAX_PRESENCES_JOUR) return { issue: 'plafond', etat };
  const choisies = selectionnerPresence(o.entrees, o.appareilId, maintenant);
  const empreinte = empreinteEntrees(choisies);
  // Rien de récent et rien de déposé avant, ou rien de nouveau : aucune écriture.
  if (empreinte === etat.empreinte || (choisies.length === 0 && !etat.empreinte)) return { issue: 'inchangee', etat };
  try {
    await o.service.deposerPresence(o.appareilId, choisies, maintenant.toISOString());
    const suivant: EtatPresence = { active: true, derniere: maintenant.toISOString(), empreinte, jour, depotsDuJour: depots + 1 };
    ecrireEtatPresence(o.base, suivant);
    return { issue: 'envoyee', etat: suivant };
  } catch (erreur) {
    const suivant: EtatPresence = { ...etat, erreur: (erreur as Error).message };
    ecrireEtatPresence(o.base, suivant);
    return { issue: 'echec', etat: suivant };
  }
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
