/**
 * Un tour de synchronisation avec le relais.
 *
 *  1. noter ce qui a changé ici depuis le tour précédent ;
 *  2. lire l'index du relais, et chaque dépôt plus récent que le dernier lu ;
 *  3. l'appliquer à la base (le plus récent gagne) ;
 *  4. déposer notre propre état, s'il a changé depuis le dernier envoi.
 *
 * Un tour qui échoue ne casse rien : la base n'est modifiée que par des
 * dépôts déchiffrés et vérifiés, et le suivant reprend là où on en était.
 */

import { DepotParametres, PARAMETRES } from '../../db/depots';
import type { PiloteSqlite } from '../../db/pilote';
import { ouvrirEnveloppe, sceller, type Enveloppe } from './chiffrement';
import { liaisonValide, type Liaison } from './liaison';
import {
  appliquerCharge,
  autresComprennentV2,
  chargeLocale,
  etatDepuisJson,
  noterChangementsLocaux,
  type BilanFusion,
  type Charge,
  type EtatSynchro,
  type InfoAppareil,
} from './moteur';
import { empreinte, extraireEntites } from './entites';

export interface ConfigRelais extends Liaison {
  /** Clé dérivée du mot de passe de synchronisation, en hexadécimal. */
  cle: string;
  /** Nom de cet appareil, tel que les autres le verront. */
  nom: string;
}

export function lireConfigRelais(pilote: PiloteSqlite): ConfigRelais | undefined {
  try {
    const brut = JSON.parse(new DepotParametres(pilote).lire(PARAMETRES.relaisSynchro) ?? 'null') as Partial<ConfigRelais>;
    const complete = typeof brut?.cle === 'string' && /^[0-9a-f]{64}$/.test(brut.cle) && typeof brut.nom === 'string';
    return complete && liaisonValide(brut) ? (brut as ConfigRelais) : undefined;
  } catch {
    return undefined;
  }
}

export function ecrireConfigRelais(pilote: PiloteSqlite, config: ConfigRelais | undefined): void {
  const parametres = new DepotParametres(pilote);
  if (config) {
    parametres.ecrire(PARAMETRES.relaisSynchro, JSON.stringify(config));
  } else {
    parametres.supprimer(PARAMETRES.relaisSynchro);
    parametres.supprimer(PARAMETRES.etatSynchro);
  }
}

export function lireEtatSynchro(pilote: PiloteSqlite): EtatSynchro {
  return etatDepuisJson(new DepotParametres(pilote).lire(PARAMETRES.etatSynchro));
}

// ---------------------------------------------------------------- Réseau

type Fetch = typeof fetch;

export class ErreurRelais extends Error {
  constructor(message: string, readonly statut?: number) {
    super(message);
    this.name = 'ErreurRelais';
  }
}

/** Au-delà, un appel sans réponse est abandonné (sinon un tour resterait bloqué). */
export const DELAI_APPEL_MS = 25_000;

async function appeler(
  liaison: Liaison,
  chemin: string,
  options: { methode?: string; corps?: string; keepalive?: boolean } = {},
  requete: Fetch = fetch,
): Promise<Response> {
  let reponse: Response;
  const controle = typeof AbortController === 'undefined' ? undefined : new AbortController();
  const minuterie = controle && !options.keepalive ? setTimeout(() => controle.abort(), DELAI_APPEL_MS) : undefined;
  try {
    reponse = await requete(`${liaison.relais}${chemin}`, {
      method: options.methode ?? 'GET',
      headers: { Authorization: `Bearer ${liaison.jeton}`, 'Content-Type': 'application/json' },
      body: options.corps,
      ...(options.keepalive ? { keepalive: true } : { signal: controle?.signal }),
    });
  } catch {
    throw new ErreurRelais('Relais injoignable : pas de connexion, ou adresse incorrecte.');
  } finally {
    if (minuterie) {
      clearTimeout(minuterie);
    }
  }
  if (reponse.status === 401) {
    throw new ErreurRelais('Le relais refuse ce code de liaison.', 401);
  }
  return reponse;
}

/** Vérifie l'adresse et le jeton avant de les enregistrer. */
export async function testerLiaison(liaison: Liaison, requete: Fetch = fetch): Promise<void> {
  const reponse = await appeler(liaison, '/sante', {}, requete);
  if (!reponse.ok) {
    throw new ErreurRelais(`Le relais a répondu ${reponse.status}.`, reponse.status);
  }
}

/**
 * Place du coffre dans la boîte : il y voyage dans une enveloppe au même
 * format que les dépôts, pour que le relais n'ait rien à connaître de neuf.
 * Il n'est pas chiffré en plus — il ne s'ouvre qu'avec le mot de passe (ou
 * un code de récupération), exactement comme sur le disque de l'appareil.
 */
export const ID_COFFRE = 'coffre';

/** Récupère le coffre déposé par un appareil déjà relié. */
export async function recupererCoffre(liaison: Liaison, requete: Fetch = fetch): Promise<unknown> {
  const reponse = await appeler(liaison, `/boite/${ID_COFFRE}`, {}, requete);
  if (reponse.status === 404) {
    throw new ErreurRelais(
      'Aucun compte sur ce relais pour l’instant : ouvrez d’abord AppliBourse sur le PC (déjà relié), attendez deux minutes, puis réessayez.',
      404,
    );
  }
  if (!reponse.ok) {
    throw new ErreurRelais(`Le relais a répondu ${reponse.status}.`, reponse.status);
  }
  const enveloppe = (await reponse.json()) as { charge?: string };
  try {
    return JSON.parse(String(enveloppe.charge));
  } catch {
    throw new ErreurRelais('Le compte déposé sur le relais est illisible.');
  }
}

export interface ResultatSynchro {
  recus: number;
  bilan: BilanFusion;
  envoye: boolean;
  /** Un dépôt est à faire mais attend la fin du délai minimal (ms restantes). */
  differeDans?: number;
  /** Dépôts illisibles (mot de passe différent, version plus récente). */
  erreurs: string[];
  appareils: Record<string, InfoAppareil>;
}

export interface OptionsSynchro {
  pilote: PiloteSqlite;
  appareil: string;
  /** Plateforme et date d'expiration de cet appareil. */
  moi: Omit<InfoAppareil, 'nom' | 'vuLe'>;
  maintenant?: () => Date;
  requete?: Fetch;
  /** Coffre de cet appareil, déposé pour qu'un nouvel appareil puisse se lier. */
  coffre?: unknown;
  /** Bouton « Synchroniser maintenant » : passe outre le délai minimal entre deux dépôts. */
  force?: boolean;
}

/**
 * Délai minimal entre deux dépôts sur le relais (le stockage Cloudflare KV
 * gratuit limite les écritures : ~1 000 par jour, et chaque dépôt en coûte deux).
 * Les modifications faites entre-temps sont regroupées dans le dépôt suivant.
 */
export const DELAI_MIN_DEPOTS_MS = 30_000;
/** Réparation de l'index du relais : au plus une fois par heure. */
const DELAI_REPARATION_INDEX_MS = 3_600_000;

/** Note un échec d'envoi dans la file : premier échec, nombre d'essais, motif. */
export function noterEchec(etat: EtatSynchro, maintenant: string, motif: string): EtatSynchro {
  if (!etat.enAttente) {
    return etat;
  }
  return {
    ...etat,
    enAttente: {
      ...etat.enAttente,
      premierEchec: etat.enAttente.premierEchec ?? maintenant,
      essais: etat.enAttente.essais + 1,
      motif,
    },
  };
}

export async function synchroniser(options: OptionsSynchro): Promise<ResultatSynchro> {
  const { pilote, appareil } = options;
  const requete = options.requete ?? fetch;
  const horloge = options.maintenant ?? (() => new Date());
  const maintenant = horloge().toISOString();
  const config = lireConfigRelais(pilote);
  if (!config) {
    throw new ErreurRelais('Synchronisation non configurée.');
  }
  const parametres = new DepotParametres(pilote);
  const sauver = (etat: EtatSynchro) => parametres.ecrire(PARAMETRES.etatSynchro, JSON.stringify(etat));

  // `etat` est mis à jour au fil du tour et sauvé à chaque étape : si le tour
  // est interrompu (réseau coupé, page fermée), rien n'est perdu et le
  // suivant reprend, la file `enAttente` gardant ce qui n'est pas parti.
  let etat = noterChangementsLocaux(lireEtatSynchro(pilote), extraireEntites(pilote), maintenant);
  sauver(etat);
  try {
    return await tour();
  } catch (erreur) {
    etat = noterEchec(etat, horloge().toISOString(), erreur instanceof Error ? erreur.message : String(erreur));
    sauver(etat);
    throw erreur;
  }

  async function tour(): Promise<ResultatSynchro> {
    const bilan: BilanFusion = { ajoutes: 0, modifies: 0, supprimes: 0, echecs: [] };
    const erreurs: string[] = [];
    let recus = 0;

    const reponseIndex = await appeler(config!, '/boite', {}, requete);
    if (!reponseIndex.ok) {
      throw new ErreurRelais(`Le relais a répondu ${reponseIndex.status}.`, reponseIndex.status);
    }
    const index = ((await reponseIndex.json()) as { appareils?: Record<string, { date: string }> }).appareils ?? {};

    for (const [autre, { date }] of Object.entries(index)) {
      if (autre === appareil || autre === ID_COFFRE || (etat.lus[autre] ?? '') >= date) {
        continue;
      }
      const reponse = await appeler(config!, `/boite/${encodeURIComponent(autre)}`, {}, requete);
      if (!reponse.ok) {
        continue;
      }
      try {
        const charge = ouvrirEnveloppe<Charge>(config!.cle, (await reponse.json()) as Enveloppe);
        // Une modification faite pendant les appels réseau n'a pas encore de date :
        // on la note avant d'appliquer, pour qu'elle ne soit pas écrasée.
        etat = noterChangementsLocaux(etat, extraireEntites(pilote), horloge().toISOString());
        const applique = appliquerCharge(pilote, etat, charge);
        etat = {
          ...applique.etat,
          lus: { ...applique.etat.lus, [autre]: date },
          appareils: {
            ...applique.etat.appareils,
            [autre]: { ...charge.appareil, vuLe: date, versionCharge: charge.appareil?.versionCharge ?? charge.version ?? 1 },
          },
        };
        sauver(etat);
        recus++;
        bilan.ajoutes += applique.bilan.ajoutes;
        bilan.modifies += applique.bilan.modifies;
        bilan.supprimes += applique.bilan.supprimes;
        bilan.echecs.push(...applique.bilan.echecs);
      } catch (erreur) {
        erreurs.push(erreur instanceof Error ? erreur.message : String(erreur));
      }
    }
    // Un appareil oublié du relais disparaît aussi de la liste.
    for (const autre of Object.keys(etat.appareils)) {
      if (!(autre in index)) {
        const reste = { ...etat.appareils };
        delete reste[autre];
        etat = { ...etat, appareils: reste };
      }
    }

    // Ce qui vient d'être reçu a pu changer la base : on note aussi ce qui a bougé ici entre-temps.
    etat = noterChangementsLocaux(etat, extraireEntites(pilote), horloge().toISOString());
    const nouveauxGenres = autresComprennentV2(etat, index, appareil, ID_COFFRE);
    const charge = chargeLocale(pilote, etat, { ...options.moi, nom: config!.nom }, nouveauxGenres);
    const signature = empreinte(charge);
    // Course connue du relais : deux dépôts simultanés réécrivent l'index à tour de rôle et l'un
    // peut disparaître de la liste. Absent de l'index alors qu'on a déjà déposé : on redépose.
    const absentDeLIndex =
      etat.dernierEnvoi !== undefined &&
      !(appareil in index) &&
      Date.parse(maintenant) - Date.parse(etat.reparationIndexLe ?? '1970-01-01') > DELAI_REPARATION_INDEX_MS;
    let envoye = false;
    let differeDans: number | undefined;
    const apresDernierDepot = Date.parse(maintenant) - Date.parse(etat.dernierDepotLe ?? '1970-01-01');
    const aEnvoyer = signature !== etat.dernierEnvoi || absentDeLIndex;
    if (aEnvoyer && !options.force && apresDernierDepot < DELAI_MIN_DEPOTS_MS) {
      // Trop tôt : le changement reste dans la file, un prochain tour l'enverra avec les suivants.
      differeDans = DELAI_MIN_DEPOTS_MS - apresDernierDepot;
    } else if (aEnvoyer) {
      const enveloppe = sceller(config!.cle, charge, appareil, maintenant);
      const reponse = await appeler(
        config!,
        `/boite/${encodeURIComponent(appareil)}`,
        { methode: 'PUT', corps: JSON.stringify(enveloppe) },
        requete,
      );
      if (!reponse.ok) {
        throw new ErreurRelais(`Dépôt refusé par le relais (${reponse.status}).`, reponse.status);
      }
      // Succès complet : c'est seulement maintenant que la file se vide et que `dernierEnvoi` avance.
      etat = {
        ...etat,
        dernierEnvoi: signature,
        dernierDepotLe: maintenant,
        reparationIndexLe: absentDeLIndex ? maintenant : etat.reparationIndexLe,
        enAttente: undefined,
      };
      envoye = true;
      sauver(etat);
    } else if (etat.enAttente) {
      // Rien de différent à envoyer (le changement local est revenu à l'état déjà déposé).
      etat = { ...etat, enAttente: undefined };
    }
    if (options.coffre) {
      const empreinteCoffre = empreinte(options.coffre);
      if (empreinteCoffre !== etat.coffreEnvoye) {
        const reponse = await appeler(
          config!,
          `/boite/${ID_COFFRE}`,
          {
            methode: 'PUT',
            corps: JSON.stringify({
              format: 'applibourse-relais',
              version: 1,
              appareil: ID_COFFRE,
              date: maintenant,
              charge: JSON.stringify(options.coffre),
            }),
          },
          requete,
        );
        if (reponse.ok) {
          etat = { ...etat, coffreEnvoye: empreinteCoffre };
        }
      }
    }

    etat = { ...etat, derniereSynchro: maintenant };
    sauver(etat);
    return { recus, bilan, envoye, differeDans, erreurs, appareils: etat.appareils };
  }
}

/**
 * Dépôt de dernière minute, à la fermeture de la page (`pagehide`).
 *
 * Tout est synchrone jusqu'à l'appel `fetch(..., { keepalive: true })` : le
 * navigateur le mène à terme même si la page se ferme. On ne sait pas si
 * l'envoi aboutit, donc `dernierEnvoi` n'avance pas : au prochain lancement
 * le tour complet redépose (idempotent). Renvoie vrai si un envoi est parti.
 */
/** Signature du dernier dépôt lancé à la fermeture (en mémoire : la page va disparaître). */
let dernierVidage: string | undefined;

export function deposerAvantFermeture(options: OptionsSynchro): boolean {
  const { pilote, appareil } = options;
  const config = lireConfigRelais(pilote);
  if (!config) {
    return false;
  }
  try {
    const maintenant = (options.maintenant ?? (() => new Date()))().toISOString();
    const etat = noterChangementsLocaux(lireEtatSynchro(pilote), extraireEntites(pilote), maintenant);
    // Rien n'est écrit dans la base ici : à la fermeture, l'écriture sur disque est déjà en cours
    // (voir bureau/index.tsx) ; le tour suivant relira les changements de toute façon.
    if (!etat.enAttente) {
      return false;
    }
    // On ne sait pas ce que les autres comprennent sans l'index : on n'envoie que les genres d'origine.
    const nouveauxGenres = Object.keys(etat.appareils).length > 0 && autresComprennentV2(etat, etat.appareils, appareil, ID_COFFRE);
    const charge = chargeLocale(pilote, etat, { ...options.moi, nom: config.nom }, nouveauxGenres);
    const signature = empreinte(charge);
    if (signature === etat.dernierEnvoi || signature === dernierVidage) {
      return false; // Rien de neuf depuis le dernier dépôt ou vidage : pas d'écriture inutile sur le relais.
    }
    const corps = JSON.stringify(sceller(config.cle, charge, appareil, maintenant));
    // keepalive : au plus 64 Kio en tout ; au-delà, le tour complet fera le travail au prochain lancement.
    if (corps.length > 60_000) {
      return false;
    }
    dernierVidage = signature;
    void (options.requete ?? fetch)(`${config.relais}/boite/${encodeURIComponent(appareil)}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${config.jeton}`, 'Content-Type': 'application/json' },
      body: corps,
      keepalive: true,
    }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/** Retire un ancien appareil du relais. */
export async function oublierAppareil(pilote: PiloteSqlite, autre: string, requete: Fetch = fetch): Promise<void> {
  const config = lireConfigRelais(pilote);
  if (!config) {
    return;
  }
  await appeler(config, `/boite/${encodeURIComponent(autre)}`, { methode: 'DELETE' }, requete);
  const etat = lireEtatSynchro(pilote);
  const appareils = { ...etat.appareils };
  delete appareils[autre];
  new DepotParametres(pilote).ecrire(PARAMETRES.etatSynchro, JSON.stringify({ ...etat, appareils }));
}
