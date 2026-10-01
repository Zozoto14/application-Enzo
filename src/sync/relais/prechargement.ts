/**
 * Préchargement au démarrage : la synchronisation commence AVANT le
 * déverrouillage, sur des enveloppes chiffrées (voir caches.ts).
 *
 *  1. Au lancement (et à chaque retour du réseau), sans clé : lire l'index du
 *     relais, télécharger les dépôts plus récents des autres appareils dans
 *     le cache `entrant`, et pousser l'enveloppe du cache `sortant` préparée
 *     pendant une session précédente. Réessais 5 s, 30 s, 2 min, 10 min.
 *  2. Pendant une session déverrouillée : après chaque tour et chaque
 *     modification, l'enveloppe de ce qui n'est pas encore parti est scellée
 *     et rangée dans `sortant` (`preparerSortant`).
 *  3. Au déverrouillage : `integrerEntrant` ouvre et fusionne le cache
 *     `entrant` tout de suite, de façon synchrone, avant la première image ;
 *     le tour réseau habituel suit.
 *
 * Budget d'écritures du relais : aucun PUT s'il n'y a rien à pousser, jamais
 * deux dépôts à moins de 30 s, et une enveloppe que le relais a déjà (même
 * date ou plus récente dans l'index) n'est pas renvoyée.
 */

import { DepotParametres, PARAMETRES } from '../../db/depots';
import type { PiloteSqlite } from '../../db/pilote';
import { estMaitre } from './portees';
import type { Liaison } from './liaison';
import { delaiReessai, minuteriesSysteme, type Minuteries } from './planificateur';
import type { BilanFusion, InfoAppareil } from './moteur';
import {
  DELAI_MIN_DEPOTS_MS,
  ErreurRelais,
  ID_COFFRE,
  appeler,
  appliquerDepot,
  cumulerBilan,
  enveloppeEnAttente,
  lireConfigRelais,
  lireEtatSynchro,
} from './synchroniser';
import {
  LIMITES_CACHES,
  ajouterEntrant,
  cachesSynchro,
  cheminDepot,
  empreinteLiaison,
  entrantVide,
  sortantVide,
  type CacheEntrant,
  type CachesSynchro,
  type CacheSortant,
} from './caches';

type Fetch = typeof fetch;

/** Profil dont la liaison est connue avant tout choix de compte : l'administrateur. */
export const PROFIL_DEMARRAGE = 'principal';
/** Pendant que l'appareil reste verrouillé, un nouveau passage toutes les 5 minutes. */
export const INTERVALLE_PRECHARGEMENT_MS = 5 * 60_000;

export interface BilanPrechargement {
  /** Dépôts téléchargés pendant ce passage. */
  telecharges: number;
  /** Enveloppes poussées pendant ce passage. */
  envoyes: number;
  /** Mises à jour en attente de déverrouillage (cache entrant). */
  enAttente: number;
  /** Éléments prêts à envoyer (cache sortant). */
  aEnvoyer: number;
  /** Un envoi attend la fin du délai minimal entre deux dépôts. */
  differeDans?: number;
}

const compter = (caches: CachesSynchro, profil: string) => ({
  enAttente: Object.keys(caches.entrant(profil).elements).length,
  aEnvoyer: caches.sortant(profil).elements.length,
});

/**
 * Un passage sans clé. Lève si le relais est injoignable (le prechargeur
 * réessaie) ; tout ce qui a été obtenu avant l'échec est gardé.
 */
export async function prechargerAuDemarrage(o: {
  liaison: Liaison;
  caches?: CachesSynchro;
  profil?: string;
  requete?: Fetch;
  maintenant?: () => Date;
}): Promise<BilanPrechargement> {
  const caches = o.caches ?? cachesSynchro();
  const profil = o.profil ?? PROFIL_DEMARRAGE;
  const horloge = o.maintenant ?? (() => new Date());
  const requete = o.requete ?? fetch;
  // Le /boite de l'administrateur ne s'ouvre qu'avec le jeton maître : jamais celui d'un ami.
  if (!estMaitre(o.liaison)) {
    throw new ErreurRelais('Préchargement réservé à la liaison de l’administrateur.');
  }
  await caches.charger(profil);
  const lien = empreinteLiaison(o.liaison);
  let entrant = caches.entrant(profil);
  let sortant = caches.sortant(profil);
  // Caches d'un autre relais (ou d'un autre jeton) : ni lus, ni poussés.
  if (entrant.liaison && entrant.liaison !== lien) {
    entrant = entrantVide();
    await caches.ecrireEntrant(profil, entrant);
  }
  const sortantUtilisable = !sortant.liaison || sortant.liaison === lien;
  const moi = sortant.moi ?? entrant.moi;

  const reponseIndex = await appeler(o.liaison, '/boite', {}, requete);
  if (!reponseIndex.ok) {
    throw new ErreurRelais(`Le relais a répondu ${reponseIndex.status}.`, reponseIndex.status);
  }
  const index = ((await reponseIndex.json()) as { appareils?: Record<string, { date?: string }> }).appareils ?? {};

  // --- Entrant : dépôts plus récents que ce qui est déjà fusionné ou en cache.
  let telecharges = 0;
  let suivant: CacheEntrant = { ...entrant, liaison: lien };
  // Appareil oublié du relais : son enveloppe en attente part aussi.
  for (const autre of Object.keys(suivant.elements)) {
    if (!(autre in index)) {
      const reste = { ...suivant.elements };
      delete reste[autre];
      suivant = { ...suivant, elements: reste };
    }
  }
  for (const [autre, meta] of Object.entries(index)) {
    const date = typeof meta?.date === 'string' ? meta.date : '';
    if (autre === ID_COFFRE || autre === moi || !date) {
      continue;
    }
    const deja = suivant.elements[autre]?.date ?? suivant.lus[autre] ?? '';
    if (deja >= date) {
      continue;
    }
    const reponse = await appeler(o.liaison, cheminDepot(autre), {}, requete);
    if (!reponse.ok) {
      continue;
    }
    const brut = (await reponse.json().catch(() => undefined)) as { date?: string } | undefined;
    const avant = suivant;
    suivant = ajouterEntrant(suivant, autre, typeof brut?.date === 'string' ? brut.date : date, brut, horloge().toISOString());
    if (suivant !== avant) {
      telecharges++;
    }
  }
  await caches.ecrireEntrant(profil, suivant);

  // --- Sortant : l'enveloppe préparée pendant la session précédente.
  let envoyes = 0;
  let differeDans: number | undefined;
  if (sortantUtilisable && sortant.elements.length > 0) {
    const resultat = await pousserSortant({ liaison: o.liaison, sortant, index, requete, horloge });
    envoyes = resultat.envoyes;
    differeDans = resultat.differeDans;
    sortant = { ...resultat.sortant, liaison: lien };
    await caches.ecrireSortant(profil, sortant);
    if (resultat.erreur) {
      throw resultat.erreur;
    }
  }
  return { telecharges, envoyes, differeDans, ...compter(caches, profil) };
}

async function pousserSortant(o: {
  liaison: Liaison;
  sortant: CacheSortant;
  index: Record<string, { date?: string }>;
  requete: Fetch;
  horloge: () => Date;
}): Promise<{ sortant: CacheSortant; envoyes: number; differeDans?: number; erreur?: unknown }> {
  let sortant = o.sortant;
  let envoyes = 0;
  let differeDans: number | undefined;
  const restants: CacheSortant['elements'] = [];
  for (const element of sortant.elements) {
    const maintenant = o.horloge();
    const surLeRelais = o.index[element.appareil]?.date ?? '';
    if (surLeRelais >= element.date) {
      continue; // Déjà parti (envoi de fermeture, autre tour) : pas d'écriture inutile.
    }
    if (element.prochainEssai && Date.parse(element.prochainEssai) > maintenant.getTime()) {
      restants.push(element);
      differeDans = Math.min(differeDans ?? Infinity, Date.parse(element.prochainEssai) - maintenant.getTime());
      continue;
    }
    const depuis = maintenant.getTime() - Date.parse(sortant.dernierDepotLe ?? '1970-01-01T00:00:00Z');
    if (depuis < DELAI_MIN_DEPOTS_MS) {
      restants.push(element);
      differeDans = Math.min(differeDans ?? Infinity, DELAI_MIN_DEPOTS_MS - depuis);
      continue;
    }
    try {
      const reponse = await appeler(o.liaison, element.chemin, { methode: 'PUT', corps: JSON.stringify(element.enveloppe) }, o.requete);
      if (!reponse.ok) {
        throw new ErreurRelais(`Dépôt refusé par le relais (${reponse.status}).`, reponse.status);
      }
      envoyes++;
      const date = maintenant.toISOString();
      sortant = { ...sortant, dernierDepotLe: date, envoye: { empreinte: element.empreinte, date } };
    } catch (erreur) {
      const essais = element.essais + 1;
      restants.push({
        ...element,
        essais,
        prochainEssai: new Date(maintenant.getTime() + delaiReessai(essais - 1)).toISOString(),
        motif: erreur instanceof Error ? erreur.message : String(erreur),
      });
      return { sortant: { ...sortant, elements: [...restants, ...sortant.elements.slice(sortant.elements.indexOf(element) + 1)] }, envoyes, differeDans, erreur };
    }
  }
  return { sortant: { ...sortant, elements: restants }, envoyes, differeDans };
}

// ----------------------------------------------------- Session déverrouillée

/**
 * Prépare (ou vide) le cache `sortant` d'après la file `enAttente` : appelé
 * après chaque tour, après une modification, au verrouillage et à la
 * fermeture. Seule une enveloppe scellée y est écrite.
 */
export function preparerSortant(o: {
  pilote: PiloteSqlite;
  appareil: string;
  moi: Omit<InfoAppareil, 'nom' | 'vuLe'>;
  profil: string;
  caches?: CachesSynchro;
  maintenant?: () => Date;
}): Promise<void> {
  const caches = o.caches ?? cachesSynchro();
  // Caches déjà en mémoire : tout le calcul (lecture de la base, scellement) est synchrone,
  // ce qui permet de l'appeler juste avant de verrouiller ou de fermer la page.
  const calculer = (): Promise<void> => {
    let config;
    let etat;
    let pret;
    try {
      config = lireConfigRelais(o.pilote);
      if (!config) {
        return Promise.resolve();
      }
      etat = lireEtatSynchro(o.pilote);
      pret = enveloppeEnAttente({ pilote: o.pilote, appareil: o.appareil, moi: o.moi, maintenant: o.maintenant });
    } catch {
      return Promise.resolve(); // Base déjà fermée.
    }
    const lien = empreinteLiaison(config);
    const actuel = caches.sortant(o.profil);
    const base: CacheSortant = {
      ...(actuel.liaison === lien ? actuel : sortantVide()),
      liaison: lien,
      moi: o.appareil,
      ...(etat.dernierDepotLe && etat.dernierDepotLe > (actuel.dernierDepotLe ?? '') ? { dernierDepotLe: etat.dernierDepotLe } : {}),
    };
    if (!pret) {
      if (actuel.elements.length > 0 || actuel.liaison !== lien || actuel.moi !== o.appareil) {
        return caches.ecrireSortant(o.profil, { ...base, elements: [] });
      }
      return Promise.resolve();
    }
    if (base.elements.some(e => e.empreinte === pret.signature)) {
      return Promise.resolve(); // Déjà prête : pas de réécriture.
    }
    if (JSON.stringify(pret.enveloppe).length > LIMITES_CACHES.enveloppe) {
      return Promise.resolve(); // Trop grosse pour le cache : le tour réseau s'en chargera.
    }
    const chemin = cheminDepot(o.appareil);
    // Un dépôt est un état complet : la nouvelle enveloppe remplace la précédente.
    return caches.ecrireSortant(o.profil, {
      ...base,
      elements: [
        ...base.elements.filter(e => e.chemin !== chemin),
        {
          chemin,
          appareil: o.appareil,
          date: pret.enveloppe.date,
          empreinte: pret.signature,
          enveloppe: pret.enveloppe,
          prepareLe: pret.enveloppe.date,
          essais: 0,
        },
      ],
    });
  };
  return caches.charge(o.profil) ? calculer() : caches.charger(o.profil).then(calculer);
}

/** Recopie dans le cache `entrant` ce qui est déjà fusionné (sans clé, le démarrage ne retélécharge rien). */
export async function noterLus(o: { pilote: PiloteSqlite; appareil: string; profil: string; caches?: CachesSynchro }): Promise<void> {
  const caches = o.caches ?? cachesSynchro();
  await caches.charger(o.profil);
  const config = lireConfigRelais(o.pilote);
  if (!config) {
    return;
  }
  const lien = empreinteLiaison(config);
  const actuel = caches.entrant(o.profil);
  const base = actuel.liaison === lien ? actuel : { ...entrantVide(), liaison: lien };
  const lus = lireEtatSynchro(o.pilote).lus;
  // Une enveloppe déjà fusionnée par un tour réseau est retirée.
  const elements = Object.fromEntries(Object.entries(base.elements).filter(([autre, e]) => (lus[autre] ?? '') < e.date));
  if (JSON.stringify(lus) === JSON.stringify(base.lus) && base.moi === o.appareil && Object.keys(elements).length === Object.keys(base.elements).length && actuel.liaison === lien) {
    return;
  }
  await caches.ecrireEntrant(o.profil, { ...base, moi: o.appareil, lus, elements });
}

export interface BilanIntegration {
  recus: number;
  bilan: BilanFusion;
  erreurs: string[];
}

/**
 * Au déverrouillage : ouvre et fusionne le cache `entrant`, de façon
 * SYNCHRONE (rien n'attend le disque ni le réseau), puis le vide. Reporte
 * aussi dans l'état chiffré un envoi fait sans clé au démarrage, pour que le
 * tour suivant ne redépose pas la même chose.
 */
export function integrerEntrant(o: {
  pilote: PiloteSqlite;
  appareil: string;
  profil: string;
  caches?: CachesSynchro;
  maintenant?: () => Date;
}): BilanIntegration {
  const caches = o.caches ?? cachesSynchro();
  const bilan: BilanFusion = { ajoutes: 0, modifies: 0, supprimes: 0, echecs: [] };
  const resultat: BilanIntegration = { recus: 0, bilan, erreurs: [] };
  const config = lireConfigRelais(o.pilote);
  if (!config || !caches.charge(o.profil)) {
    return resultat;
  }
  const lien = empreinteLiaison(config);
  const entrant = caches.entrant(o.profil);
  const sortant = caches.sortant(o.profil);
  const parametres = new DepotParametres(o.pilote);
  const horloge = o.maintenant ?? (() => new Date());
  let etat = lireEtatSynchro(o.pilote);

  if (entrant.liaison && entrant.liaison !== lien) {
    // Relais changé depuis : ces enveloppes ne nous concernent plus.
    void caches.ecrireEntrant(o.profil, { ...entrantVide(), liaison: lien, moi: o.appareil });
  } else {
    const elements = Object.entries(entrant.elements).sort(([, a], [, b]) => a.date.localeCompare(b.date));
    for (const [autre, element] of elements) {
      if (autre === o.appareil || (etat.lus[autre] ?? '') >= element.date) {
        continue;
      }
      try {
        const applique = appliquerDepot(o.pilote, etat, config.cle, autre, element.date, element.enveloppe, horloge().toISOString());
        etat = applique.etat;
        resultat.recus++;
        cumulerBilan(bilan, applique.bilan);
      } catch (erreur) {
        resultat.erreurs.push(erreur instanceof Error ? erreur.message : String(erreur));
      }
    }
    // Traités (ou illisibles : le tour réseau retentera depuis le relais) : le cache se vide.
    void caches.ecrireEntrant(o.profil, { version: 1, liaison: lien, moi: o.appareil, lus: etat.lus, elements: {} });
  }

  if (sortant.envoye && (!sortant.liaison || sortant.liaison === lien)) {
    if (sortant.envoye.date > (etat.dernierDepotLe ?? '')) {
      etat = { ...etat, dernierEnvoi: sortant.envoye.empreinte, dernierDepotLe: sortant.envoye.date };
    }
    void caches.ecrireSortant(o.profil, { ...sortant, envoye: undefined });
  }
  parametres.ecrire(PARAMETRES.etatSynchro, JSON.stringify(etat));
  return resultat;
}

// ------------------------------------------------- Lanceur au démarrage

/**
 * Lance le préchargement au démarrage, puis le relance : au retour du
 * réseau, après un échec (5 s, 30 s, 2 min, 10 min), et toutes les 5
 * minutes tant que l'appareil reste verrouillé. Suspendu pendant une session
 * déverrouillée : le tour de synchronisation habituel prend le relais.
 */
export class Prechargeur {
  private minuterie: unknown;
  private echecs = 0;
  private enCours = false;
  private suspendu = false;
  private arrete = true;
  private readonly minuteries: Minuteries;

  constructor(
    private readonly o: {
      liaison(): Promise<Liaison | undefined>;
      caches?: CachesSynchro;
      requete?: Fetch;
      minuteries?: Minuteries;
      maintenant?: () => Date;
      surBilan?(bilan: BilanPrechargement & { reussi: boolean }): void;
    },
  ) {
    this.minuteries = o.minuteries ?? minuteriesSysteme;
  }

  demarrer(): void {
    this.arrete = false;
    void this.passage();
  }

  arreter(): void {
    this.arrete = true;
    this.annuler();
  }

  /** Session déverrouillée : plus de passage sans clé. */
  suspendre(): void {
    this.suspendu = true;
    this.annuler();
  }

  reprendre(): void {
    if (this.suspendu) {
      this.suspendu = false;
      this.echecs = 0;
      void this.passage();
    }
  }

  /** Le réseau revient : on retente tout de suite. */
  enLigne(): void {
    this.echecs = 0;
    void this.passage();
  }

  /** Passage en cours ou planifié ? (tests) */
  get echecsConsecutifs(): number {
    return this.echecs;
  }

  async passage(): Promise<void> {
    if (this.arrete || this.suspendu || this.enCours) {
      return;
    }
    this.annuler();
    this.enCours = true;
    let prochain = INTERVALLE_PRECHARGEMENT_MS;
    try {
      const liaison = await this.o.liaison().catch(() => undefined);
      if (!liaison || !estMaitre(liaison)) {
        return; // Rien à faire sans liaison d'administrateur (ami, appareil jamais relié).
      }
      const bilan = await prechargerAuDemarrage({ liaison, caches: this.o.caches, requete: this.o.requete, maintenant: this.o.maintenant });
      this.echecs = 0;
      if (bilan.differeDans !== undefined) {
        prochain = Math.max(1_000, Math.min(prochain, bilan.differeDans + 500));
      }
      this.o.surBilan?.({ ...bilan, reussi: true });
    } catch {
      prochain = delaiReessai(this.echecs);
      this.echecs++;
      const caches = this.o.caches ?? cachesSynchro();
      this.o.surBilan?.({ telecharges: 0, envoyes: 0, ...compter(caches, PROFIL_DEMARRAGE), reussi: false });
    } finally {
      this.enCours = false;
    }
    if (!this.arrete && !this.suspendu) {
      this.minuterie = this.minuteries.setTimeout(() => void this.passage(), prochain);
    }
  }

  private annuler(): void {
    if (this.minuterie !== undefined) {
      this.minuteries.clearTimeout(this.minuterie);
      this.minuterie = undefined;
    }
  }
}

let prechargeurActif: Prechargeur | undefined;

/** Enregistre le lanceur de l'application (bureau, site). */
export function definirPrechargeur(prechargeur: Prechargeur | undefined): void {
  prechargeurActif = prechargeur;
}

/** Une session s'ouvre (passages suspendus) ou se referme (ils reprennent). */
export function signalerDeverrouillage(ouvert: boolean): void {
  if (ouvert) {
    prechargeurActif?.suspendre();
  } else {
    prechargeurActif?.reprendre();
  }
}

// ----------------------------------------- État affiché avant déverrouillage

/**
 * Ce que l'écran de connexion peut dire : GLOBAL à l'appareil, des compteurs
 * et une date, rien d'autre (ni compte, ni contenu, ni appareil).
 */
export interface EtatDemarrage {
  /** Dernier contact réussi avec le relais. */
  le?: string;
  recus: number;
  aEnvoyer: number;
}

export const CLE_ETAT_DEMARRAGE = 'applibourse.synchro.demarrage';
type Memoire = { getItem(cle: string): string | null; setItem(cle: string, valeur: string): void };
const memoireLocale = (): Memoire | undefined => (globalThis as { localStorage?: Memoire }).localStorage;
const ecoutesEtat = new Set<(etat: EtatDemarrage) => void>();

export function lireEtatDemarrage(memoire: Memoire | undefined = memoireLocale()): EtatDemarrage {
  try {
    const brut = JSON.parse(memoire?.getItem(CLE_ETAT_DEMARRAGE) ?? '{}') as Partial<EtatDemarrage>;
    const entier = (n: unknown) => (Number.isInteger(n) && (n as number) >= 0 ? Math.min(n as number, 999) : 0);
    return {
      ...(typeof brut.le === 'string' && !Number.isNaN(Date.parse(brut.le)) ? { le: brut.le } : {}),
      recus: entier(brut.recus),
      aEnvoyer: entier(brut.aEnvoyer),
    };
  } catch {
    return { recus: 0, aEnvoyer: 0 };
  }
}

export function noterEtatDemarrage(partiel: Partial<EtatDemarrage>, memoire: Memoire | undefined = memoireLocale()): EtatDemarrage {
  const etat = { ...lireEtatDemarrage(memoire), ...partiel };
  const propre: EtatDemarrage = { ...(etat.le ? { le: etat.le } : {}), recus: etat.recus, aEnvoyer: etat.aEnvoyer };
  try {
    memoire?.setItem(CLE_ETAT_DEMARRAGE, JSON.stringify(propre));
  } catch {
    // Stockage interdit : l'affichage se contente de la mémoire.
  }
  for (const rappel of [...ecoutesEtat]) {
    rappel(propre);
  }
  return propre;
}

export function surEtatDemarrage(rappel: (etat: EtatDemarrage) => void): () => void {
  ecoutesEtat.add(rappel);
  return () => void ecoutesEtat.delete(rappel);
}

/** Texte de l'écran de connexion (vide s'il n'y a rien à dire). */
export function textesEtatDemarrage(etat: EtatDemarrage, maintenant: number = Date.now()): string[] {
  const lignes: string[] = [];
  if (etat.recus > 0) {
    lignes.push(
      etat.recus === 1
        ? '1 mise à jour reçue, en attente de déverrouillage'
        : `${etat.recus} mises à jour reçues, en attente de déverrouillage`,
    );
  }
  if (etat.aEnvoyer > 0) {
    lignes.push(etat.aEnvoyer === 1 ? '1 élément prêt à envoyer' : `${etat.aEnvoyer} éléments prêts à envoyer`);
  }
  if (etat.le) {
    const minutes = Math.max(0, Math.floor((maintenant - Date.parse(etat.le)) / 60_000));
    lignes.push(
      minutes < 1
        ? 'Synchronisé à l’instant'
        : minutes < 60
          ? `Synchronisé il y a ${minutes} min`
          : minutes < 48 * 60
            ? `Synchronisé il y a ${Math.floor(minutes / 60)} h`
            : `Synchronisé il y a ${Math.floor(minutes / 1440)} j`,
    );
  }
  return lignes;
}
