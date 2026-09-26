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

async function appeler(
  liaison: Liaison,
  chemin: string,
  options: { methode?: string; corps?: string } = {},
  requete: Fetch = fetch,
): Promise<Response> {
  let reponse: Response;
  try {
    reponse = await requete(`${liaison.relais}${chemin}`, {
      method: options.methode ?? 'GET',
      headers: { Authorization: `Bearer ${liaison.jeton}`, 'Content-Type': 'application/json' },
      body: options.corps,
    });
  } catch {
    throw new ErreurRelais('Relais injoignable : pas de connexion, ou adresse incorrecte.');
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

export interface ResultatSynchro {
  recus: number;
  bilan: BilanFusion;
  envoye: boolean;
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
}

export async function synchroniser(options: OptionsSynchro): Promise<ResultatSynchro> {
  const { pilote, appareil } = options;
  const requete = options.requete ?? fetch;
  const maintenant = (options.maintenant ?? (() => new Date()))().toISOString();
  const config = lireConfigRelais(pilote);
  if (!config) {
    throw new ErreurRelais('Synchronisation non configurée.');
  }
  const parametres = new DepotParametres(pilote);
  const sauver = (etat: EtatSynchro) => parametres.ecrire(PARAMETRES.etatSynchro, JSON.stringify(etat));

  let etat = noterChangementsLocaux(lireEtatSynchro(pilote), extraireEntites(pilote), maintenant);
  sauver(etat);

  const bilan: BilanFusion = { ajoutes: 0, modifies: 0, supprimes: 0, echecs: [] };
  const erreurs: string[] = [];
  let recus = 0;

  const reponseIndex = await appeler(config, '/boite', {}, requete);
  if (!reponseIndex.ok) {
    throw new ErreurRelais(`Le relais a répondu ${reponseIndex.status}.`, reponseIndex.status);
  }
  const index = ((await reponseIndex.json()) as { appareils?: Record<string, { date: string }> }).appareils ?? {};

  for (const [autre, { date }] of Object.entries(index)) {
    if (autre === appareil || (etat.lus[autre] ?? '') >= date) {
      continue;
    }
    const reponse = await appeler(config, `/boite/${encodeURIComponent(autre)}`, {}, requete);
    if (!reponse.ok) {
      continue;
    }
    try {
      const charge = ouvrirEnveloppe<Charge>(config.cle, (await reponse.json()) as Enveloppe);
      const applique = appliquerCharge(pilote, etat, charge);
      etat = {
        ...applique.etat,
        lus: { ...applique.etat.lus, [autre]: date },
        appareils: { ...applique.etat.appareils, [autre]: { ...charge.appareil, vuLe: date } },
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

  const charge = chargeLocale(pilote, etat, { ...options.moi, nom: config.nom });
  const signature = empreinte(charge);
  let envoye = false;
  if (signature !== etat.dernierEnvoi) {
    const enveloppe = sceller(config.cle, charge, appareil, maintenant);
    const reponse = await appeler(
      config,
      `/boite/${encodeURIComponent(appareil)}`,
      { methode: 'PUT', corps: JSON.stringify(enveloppe) },
      requete,
    );
    if (!reponse.ok) {
      throw new ErreurRelais(`Dépôt refusé par le relais (${reponse.status}).`, reponse.status);
    }
    etat = { ...etat, dernierEnvoi: signature };
    envoye = true;
  }
  etat = { ...etat, derniereSynchro: maintenant };
  sauver(etat);
  return { recus, bilan, envoye, erreurs, appareils: etat.appareils };
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
