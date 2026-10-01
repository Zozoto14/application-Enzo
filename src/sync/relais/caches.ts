/**
 * Caches de synchronisation lisibles AVANT le déverrouillage.
 *
 * La configuration du relais et la clé de synchronisation vivent dans la base
 * chiffrée du profil : sans mot de passe, impossible d'ouvrir un dépôt. On
 * peut pourtant déjà faire le travail réseau au démarrage, sur des
 * **enveloppes chiffrées** :
 *
 *  - `entrant` : les dépôts des autres appareils, téléchargés tels quels
 *    (une enveloppe par appareil, la plus récente) ; ils seront ouverts et
 *    fusionnés au déverrouillage, sans attendre le réseau ;
 *  - `sortant` : l'enveloppe de cet appareil, scellée pendant une session
 *    déverrouillée, que l'envoi n'a pas pu pousser (hors ligne, fermeture
 *    brutale) ; le démarrage suivant la pousse sans clé.
 *
 * Ce qui est écrit sur le disque, et rien d'autre : des enveloppes au format
 * du relais (nonce et chiffré XChaCha20-Poly1305, plus l'identifiant de
 * l'appareil et la date, déjà visibles sur le relais), des dates, des
 * compteurs, l'identifiant aléatoire de cet appareil et une empreinte de la
 * liaison (jamais le jeton, jamais la clé). Chaque enveloppe est revérifiée
 * (forme stricte, champs connus seulement) à l'écriture ET à la lecture.
 *
 * Un fichier par profil (`synchro-entrant`, `synchro-entrant-<id>`…) :
 * un profil ne lit jamais le cache d'un autre.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
/** Même valeur que `ID_PRINCIPAL` (profils.ts). */
const ID_PRINCIPAL = 'principal';
import { identifiantAppareilValide } from '../identite';
import { VERSION_ENVELOPPE, type Enveloppe } from './chiffrement';
import type { Liaison } from './liaison';

export type NomCache = 'entrant' | 'sortant';

/** Bornes : taille d'une enveloppe (caractères), nombre d'éléments. */
export const LIMITES_CACHES = {
  enveloppe: 8 * 1024 * 1024,
  entrants: 12,
  sortants: 2,
} as const;

const MOTIF_PROFIL = /^(principal|[a-z0-9]{6,16})$/;

/** Nom du fichier logique d'un cache, propre au profil (même règle que coffre / portefeuille). */
export function nomFichierCache(profil: string, nom: NomCache): string {
  if (!MOTIF_PROFIL.test(profil)) {
    throw new Error('Profil invalide pour un cache de synchronisation.');
  }
  return profil === ID_PRINCIPAL ? `synchro-${nom}` : `synchro-${nom}-${profil}`;
}

/** Empreinte d'une liaison (relais + jeton) : sert à ne jamais mélanger deux relais. Le jeton n'est pas écrit. */
export function empreinteLiaison(liaison: Pick<Liaison, 'relais' | 'jeton'>): string {
  return bytesToHex(sha256(utf8ToBytes(`applibourse-cache-v1|${liaison.relais}|${liaison.jeton}`))).slice(0, 32);
}

const DATE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const estDate = (x: unknown): x is string => typeof x === 'string' && DATE_ISO.test(x);

/**
 * Enveloppe sûre à garder sur le disque : forme stricte du relais, chiffré en
 * base 64, nonce de 24 octets. Tout autre champ est retiré ; une enveloppe en
 * clair (le coffre, par exemple, dont la charge est du JSON) est refusée.
 */
export function enveloppeSure(valeur: unknown): Enveloppe | undefined {
  if (!valeur || typeof valeur !== 'object') {
    return undefined;
  }
  const e = valeur as Partial<Enveloppe>;
  if (
    e.format !== 'applibourse-relais' ||
    typeof e.version !== 'number' ||
    e.version < 1 ||
    e.version > VERSION_ENVELOPPE ||
    typeof e.appareil !== 'string' ||
    !identifiantAppareilValide(e.appareil) ||
    !estDate(e.date) ||
    typeof e.nonce !== 'string' ||
    !/^[0-9a-f]{48}$/.test(e.nonce) ||
    typeof e.charge !== 'string' ||
    e.charge.length < 24 ||
    e.charge.length > LIMITES_CACHES.enveloppe ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(e.charge)
  ) {
    return undefined;
  }
  return { format: e.format, version: e.version, appareil: e.appareil, date: e.date, nonce: e.nonce, charge: e.charge };
}

// ------------------------------------------------------------- Entrant

export interface ElementEntrant {
  date: string;
  enveloppe: Enveloppe;
  recuLe: string;
}

export interface CacheEntrant {
  version: 1;
  /** Empreinte de la liaison qui a servi (voir empreinteLiaison). */
  liaison?: string;
  /** Cet appareil (ses propres dépôts ne sont pas téléchargés). */
  moi?: string;
  /** Date du dernier dépôt déjà fusionné, par appareil (copie de l'état chiffré). */
  lus: Record<string, string>;
  /** Une enveloppe par appareil : la plus récente. */
  elements: Record<string, ElementEntrant>;
}

export const entrantVide = (): CacheEntrant => ({ version: 1, lus: {}, elements: {} });

function lireDates(valeur: unknown): Record<string, string> {
  const sortie: Record<string, string> = {};
  if (valeur && typeof valeur === 'object') {
    for (const [cle, date] of Object.entries(valeur)) {
      if (identifiantAppareilValide(cle) && estDate(date)) {
        sortie[cle] = date;
      }
    }
  }
  return sortie;
}

/** Relit un cache entrant ; tout élément douteux est écarté. */
export function lireCacheEntrant(texte: string | undefined): CacheEntrant {
  try {
    const brut = texte ? (JSON.parse(texte) as Partial<CacheEntrant>) : undefined;
    if (!brut || brut.version !== 1) {
      return entrantVide();
    }
    const elements: Record<string, ElementEntrant> = {};
    for (const [appareil, element] of Object.entries(brut.elements ?? {})) {
      const enveloppe = enveloppeSure(element?.enveloppe);
      if (enveloppe && enveloppe.appareil === appareil && estDate(element.date) && estDate(element.recuLe)) {
        elements[appareil] = { date: element.date, enveloppe, recuLe: element.recuLe };
      }
    }
    return {
      version: 1,
      ...(typeof brut.liaison === 'string' && /^[0-9a-f]{32}$/.test(brut.liaison) ? { liaison: brut.liaison } : {}),
      ...(typeof brut.moi === 'string' && identifiantAppareilValide(brut.moi) ? { moi: brut.moi } : {}),
      lus: lireDates(brut.lus),
      elements: Object.fromEntries(Object.entries(elements).slice(0, LIMITES_CACHES.entrants)),
    };
  } catch {
    return entrantVide();
  }
}

/** Ajoute (ou remplace) l'enveloppe d'un appareil ; dédupliqué, borné. */
export function ajouterEntrant(cache: CacheEntrant, appareil: string, date: string, brut: unknown, maintenant: string): CacheEntrant {
  const enveloppe = enveloppeSure(brut);
  if (!enveloppe || enveloppe.appareil !== appareil || appareil === cache.moi) {
    return cache;
  }
  const actuel = cache.elements[appareil];
  if (actuel && actuel.date >= date) {
    return cache;
  }
  if (!actuel && Object.keys(cache.elements).length >= LIMITES_CACHES.entrants) {
    return cache;
  }
  return { ...cache, elements: { ...cache.elements, [appareil]: { date, enveloppe, recuLe: maintenant } } };
}

// ------------------------------------------------------------- Sortant

export interface ElementSortant {
  /** Chemin du dépôt sur le relais : `/boite/<appareil>`, rien d'autre. */
  chemin: string;
  appareil: string;
  date: string;
  /** Empreinte du contenu (même calcul que `dernierEnvoi`). */
  empreinte: string;
  enveloppe: Enveloppe;
  prepareLe: string;
  essais: number;
  prochainEssai?: string;
  motif?: string;
}

export interface CacheSortant {
  version: 1;
  liaison?: string;
  moi?: string;
  /** Dernier dépôt réussi de cet appareil (délai minimal entre deux dépôts). */
  dernierDepotLe?: string;
  elements: ElementSortant[];
  /** Envoyé sans clé au démarrage : à reporter dans l'état chiffré au déverrouillage. */
  envoye?: { empreinte: string; date: string };
}

export const sortantVide = (): CacheSortant => ({ version: 1, elements: [] });

export const cheminDepot = (appareil: string) => `/boite/${encodeURIComponent(appareil)}`;

export function lireCacheSortant(texte: string | undefined): CacheSortant {
  try {
    const brut = texte ? (JSON.parse(texte) as Partial<CacheSortant>) : undefined;
    if (!brut || brut.version !== 1) {
      return sortantVide();
    }
    const elements: ElementSortant[] = [];
    for (const e of Array.isArray(brut.elements) ? brut.elements : []) {
      const enveloppe = enveloppeSure(e?.enveloppe);
      if (
        enveloppe &&
        e.appareil === enveloppe.appareil &&
        e.chemin === cheminDepot(e.appareil) &&
        e.date === enveloppe.date &&
        typeof e.empreinte === 'string' &&
        /^[0-9a-f]{8,128}$/.test(e.empreinte) &&
        estDate(e.prepareLe)
      ) {
        elements.push({
          chemin: e.chemin,
          appareil: e.appareil,
          date: e.date,
          empreinte: e.empreinte,
          enveloppe,
          prepareLe: e.prepareLe,
          essais: Number.isFinite(e.essais) ? Math.max(0, Math.min(1000, Number(e.essais))) : 0,
          ...(estDate(e.prochainEssai) ? { prochainEssai: e.prochainEssai } : {}),
          ...(typeof e.motif === 'string' ? { motif: e.motif.slice(0, 200) } : {}),
        });
      }
    }
    const envoye =
      brut.envoye && typeof brut.envoye.empreinte === 'string' && /^[0-9a-f]{8,128}$/.test(brut.envoye.empreinte) && estDate(brut.envoye.date)
        ? { empreinte: brut.envoye.empreinte, date: brut.envoye.date }
        : undefined;
    return {
      version: 1,
      ...(typeof brut.liaison === 'string' && /^[0-9a-f]{32}$/.test(brut.liaison) ? { liaison: brut.liaison } : {}),
      ...(typeof brut.moi === 'string' && identifiantAppareilValide(brut.moi) ? { moi: brut.moi } : {}),
      ...(estDate(brut.dernierDepotLe) ? { dernierDepotLe: brut.dernierDepotLe } : {}),
      elements: elements.slice(-LIMITES_CACHES.sortants),
      ...(envoye ? { envoye } : {}),
    };
  } catch {
    return sortantVide();
  }
}

// ------------------------------------------------------------- Stockage

/** Où vivent les caches : fichiers logiques du bureau, IndexedDB du site, mémoire ailleurs. */
export interface StockageCaches {
  lire(nomFichier: string): Promise<string | undefined>;
  ecrire(nomFichier: string, texte: string): Promise<void>;
}

/** Repli : en mémoire seulement (app native, tests). */
export function stockageCachesMemoire(): StockageCaches & { fichiers: Map<string, string> } {
  const fichiers = new Map<string, string>();
  return {
    fichiers,
    lire: async nom => fichiers.get(nom),
    ecrire: async (nom, texte) => void fichiers.set(nom, texte),
  };
}

/**
 * Caches de chaque profil, gardés aussi en mémoire : au déverrouillage, la
 * fusion les lit de façon synchrone (aucune attente du disque ni du réseau).
 */
export class CachesSynchro {
  private readonly entrants = new Map<string, CacheEntrant>();
  private readonly sortants = new Map<string, CacheSortant>();
  private readonly ecoutes = new Set<(profil: string) => void>();
  private file: Promise<void> = Promise.resolve();

  constructor(private readonly stockage: StockageCaches) {}

  /** Charge (une fois) les deux caches d'un profil. */
  async charger(profil: string): Promise<void> {
    if (this.entrants.has(profil) && this.sortants.has(profil)) {
      return;
    }
    const [entrant, sortant] = await Promise.all([
      this.stockage.lire(nomFichierCache(profil, 'entrant')).catch(() => undefined),
      this.stockage.lire(nomFichierCache(profil, 'sortant')).catch(() => undefined),
    ]);
    if (!this.entrants.has(profil)) this.entrants.set(profil, lireCacheEntrant(entrant));
    if (!this.sortants.has(profil)) this.sortants.set(profil, lireCacheSortant(sortant));
  }

  charge(profil: string): boolean {
    return this.entrants.has(profil) && this.sortants.has(profil);
  }

  entrant(profil: string): CacheEntrant {
    return this.entrants.get(profil) ?? entrantVide();
  }

  sortant(profil: string): CacheSortant {
    return this.sortants.get(profil) ?? sortantVide();
  }

  /** Remplace le cache entrant (mémoire tout de suite, disque en file). */
  ecrireEntrant(profil: string, cache: CacheEntrant): Promise<void> {
    const propre = lireCacheEntrant(JSON.stringify(cache));
    this.entrants.set(profil, propre);
    return this.persister(profil, 'entrant', propre);
  }

  ecrireSortant(profil: string, cache: CacheSortant): Promise<void> {
    const propre = lireCacheSortant(JSON.stringify(cache));
    this.sortants.set(profil, propre);
    return this.persister(profil, 'sortant', propre);
  }

  /** Oublie tout (appareil délié, changement de relais). */
  vider(profil: string): Promise<void> {
    return Promise.all([this.ecrireEntrant(profil, entrantVide()), this.ecrireSortant(profil, sortantVide())]).then(() => undefined);
  }

  surChangement(rappel: (profil: string) => void): () => void {
    this.ecoutes.add(rappel);
    return () => void this.ecoutes.delete(rappel);
  }

  /** Attend la fin des écritures en cours (tests, fermeture). */
  async vidage(): Promise<void> {
    await this.file;
  }

  private persister(profil: string, nom: NomCache, cache: CacheEntrant | CacheSortant): Promise<void> {
    for (const rappel of [...this.ecoutes]) {
      try {
        rappel(profil);
      } catch {
        // Un écouteur fautif n'empêche pas l'écriture.
      }
    }
    const texte = JSON.stringify(cache);
    this.file = this.file.then(() => this.stockage.ecrire(nomFichierCache(profil, nom), texte)).catch(() => undefined);
    return this.file;
  }
}

let caches = new CachesSynchro(stockageCachesMemoire());

/** Caches de l'appareil (un seul jeu par application). */
export function cachesSynchro(): CachesSynchro {
  return caches;
}

/** Choisit où ranger les caches (bureau : fichiers logiques ; site : IndexedDB). À appeler au démarrage. */
export function definirStockageCaches(stockage: StockageCaches): CachesSynchro {
  caches = new CachesSynchro(stockage);
  return caches;
}
