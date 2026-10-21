/**
 * Synchronisation avec le COFFRE SERVEUR du compte (relais version 9) : le serveur est la
 * référence, l'appareil garde une copie de secours (sa base chiffrée) pour afficher sans réseau
 * et une file des modifications à envoyer. Plus de dépôt « par appareil » ni d'appareils liés.
 *
 * Un tour :
 *  1. noter ce qui a changé ici (file `enAttente`, dates des changements) ;
 *  2. migration, une seule fois par appareil : TOUTES les données locales entrent dans la file
 *     (elles seront fusionnées dans le coffre serveur), et les anciens dépôts des autres
 *     appareils (`/boite`, Fondateur) sont d'abord fusionnés ici ;
 *  3. TIRER les enregistrements modifiés sur le serveur depuis la dernière révision lue, et les
 *     appliquer (le plus récent gagne, par enregistrement ; une modification d'ici plus récente
 *     reste dans la file) ;
 *  4. POUSSER la file. Le serveur tranche les conflits par enregistrement (le plus récent gagne,
 *     l'autre version va dans son historique, rien n'est perdu) ; une version qui perd est
 *     remplacée ici par celle du serveur.
 *
 * Chiffrement de bout en bout : l'identifiant d'un enregistrement est un HMAC de sa clé
 * (`genre:identifiant`) par la clé de synchronisation du compte ; son contenu est scellé
 * (XChaCha20-Poly1305) par la même clé, lié au compte, à l'identifiant et à la date. Le serveur
 * ne voit ni la clé, ni le contenu.
 */

import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { DepotParametres, PARAMETRES } from '../../db/depots';
import type { PiloteSqlite } from '../../db/pilote';
import { ouvrirEnveloppe, sceller, type Enveloppe } from './chiffrement';
import { ecrireEntite, empreinte, extraireEntites } from './entites';
import type { Liaison } from './liaison';
import { appliquerCharge, noterChangementsLocaux, type BilanFusion, type Charge, type EtatSynchro } from './moteur';
import { ErreurRelais, appeler, appliquerDepot, cumulerBilan, lireEtatSynchro } from './synchroniser';
import { estMaitre } from './portees';

type Fetch = typeof fetch;

export const DATE_INCONNUE = '1970-01-01T00:00:00.000Z';
/** Lot d'envoi : au plus ce nombre d'enregistrements ou cette taille. */
export const LOT_ENREGISTREMENTS = 400;
export const LOT_OCTETS = 16 * 1024 * 1024;
const TAILLE_MAX_VALEUR = 8 * 1024 * 1024;
/** Anciens dépôts « par appareil » plus vieux que ceci : fusionnés puis effacés du relais. */
export const AGE_MENAGE_APPAREILS_MS = 30 * 86_400_000;

/** Suivi du coffre serveur, rangé dans l'état de synchronisation (base du compte). */
export interface SuiviServeur {
  /** Dernière révision du serveur lue. */
  rev: number;
  /** Révision connue de chaque enregistrement (par clé `genre:id`). */
  base: Record<string, number>;
  /** Date de la migration de cet appareil (toutes ses données fusionnées dans le coffre). */
  migreLe?: string;
  /** Dernier ménage des anciens dépôts par appareil. */
  menageLe?: string;
}

export type EtatServeur = EtatSynchro & { serveur?: SuiviServeur };

export const idEnregistrement = (cleHex: string, cle: string): string =>
  bytesToHex(hmac(sha256, hexToBytes(cleHex), utf8ToBytes(`applibourse/coffre-serveur/v1|${cle}`))).slice(0, 32);

interface ContenuEnregistrement {
  cle: string;
  date: string;
  supprime?: boolean;
  valeur?: unknown;
}

const lien = (compte: string, id: string) => `v9|${compte}|${id}`;

export function scellerEnregistrement(cleHex: string, compte: string, id: string, contenu: ContenuEnregistrement): string {
  return JSON.stringify(sceller(cleHex, contenu, lien(compte, id), contenu.date));
}

export function ouvrirEnregistrement(cleHex: string, compte: string, id: string, valeur: string): ContenuEnregistrement {
  const enveloppe = JSON.parse(valeur) as Enveloppe;
  if (enveloppe.appareil !== lien(compte, id)) throw new ErreurRelais('Enregistrement déplacé ou altéré.');
  const contenu = ouvrirEnveloppe<ContenuEnregistrement>(cleHex, enveloppe);
  if (idEnregistrement(cleHex, contenu.cle) !== id) throw new ErreurRelais('Enregistrement déplacé ou altéré.');
  return contenu;
}

interface EnregistrementServeur {
  id: string;
  rev: number;
  date: string;
  supprime: boolean;
  valeur: string;
}

/** Le relais a-t-il un coffre serveur ? (mémorisé par adresse pour la durée de la page) */
const capacites = new Map<string, boolean>();
export async function relaisAvecCoffre(liaison: Liaison, requete: Fetch = fetch): Promise<boolean> {
  const connu = capacites.get(liaison.relais);
  if (connu !== undefined) return connu;
  const reponse = await appeler(liaison, '/sante', {}, requete);
  if (!reponse.ok) throw new ErreurRelais(`Le relais a répondu ${reponse.status}.`, reponse.status);
  const corps = (await reponse.json()) as { fonctions?: unknown };
  const avec = Array.isArray(corps.fonctions) && corps.fonctions.includes('coffre-serveur');
  capacites.set(liaison.relais, avec);
  return avec;
}
/** Tests : oublie les capacités mémorisées. */
export const oublierCapacites = (): void => capacites.clear();

export interface OptionsServeur {
  pilote: PiloteSqlite;
  liaison: Liaison;
  /** Clé de synchronisation du compte (hexadécimal). */
  cle: string;
  /** Compte : `principal` (Fondateur) ou l'identifiant d'un ami. */
  compte: string;
  /** Identifiant de cet appareil (ses anciens dépôts `/boite` sont retirés). */
  appareil?: string;
  maintenant?: () => Date;
  requete?: Fetch;
}

export interface ResultatServeur {
  recus: number;
  envoyes: number;
  /** Versions d'ici remplacées par le serveur (conflit perdu : la nôtre est dans l'historique du serveur). */
  conflits: number;
  bilan: BilanFusion;
  erreurs: string[];
  /** Anciens dépôts par appareil fusionnés pendant ce tour. */
  anciens: number;
  /** Il reste des modifications à envoyer (hors ligne, refus). */
  enAttente: number;
}

const sauverEtat = (pilote: PiloteSqlite, etat: EtatServeur) => new DepotParametres(pilote).ecrire(PARAMETRES.etatSynchro, JSON.stringify(etat));

/** Ajoute à la file les clés dont la valeur a changé entre deux états connus (données reçues d'un ancien appareil). */
function changees(avant: Record<string, string>, apres: Record<string, string>): string[] {
  const cles = new Set<string>();
  for (const [cle, h] of Object.entries(apres)) if (avant[cle] !== h) cles.add(cle);
  for (const cle of Object.keys(avant)) if (!(cle in apres)) cles.add(cle);
  return [...cles];
}

function ajouterFile(etat: EtatServeur, cles: readonly string[], maintenant: string): EtatServeur {
  if (cles.length === 0) return etat;
  return {
    ...etat,
    enAttente: {
      ...(etat.enAttente ?? { depuisLe: maintenant, essais: 0 }),
      cles: [...new Set([...(etat.enAttente?.cles ?? []), ...cles])].sort(),
    },
  };
}

function retirerFile(etat: EtatServeur, cles: ReadonlySet<string>): EtatServeur {
  if (!etat.enAttente || cles.size === 0) return etat;
  const reste = etat.enAttente.cles.filter(c => !cles.has(c));
  return { ...etat, enAttente: reste.length > 0 ? { ...etat.enAttente, cles: reste } : undefined };
}

export async function synchroniserServeur(o: OptionsServeur): Promise<ResultatServeur> {
  const { pilote, liaison, cle, compte } = o;
  const requete = o.requete ?? fetch;
  const horloge = o.maintenant ?? (() => new Date());
  const resultat: ResultatServeur = { recus: 0, envoyes: 0, conflits: 0, bilan: { ajoutes: 0, modifies: 0, supprimes: 0, echecs: [] }, erreurs: [], anciens: 0, enAttente: 0 };

  const avant = lireEtatSynchro(pilote) as EtatServeur;
  const vierge = !avant.serveur && Object.keys(avant.connus).length === 0;
  let etat = noterChangementsLocaux(avant, extraireEntites(pilote), horloge().toISOString()) as EtatServeur;
  if (vierge) {
    // Appareil sans historique de synchro : ses dates ne disent rien ; en cas de désaccord, le serveur l'emporte.
    etat = { ...etat, dates: Object.fromEntries(Object.keys(etat.dates).map(c => [c, DATE_INCONNUE])) };
  }
  const sauver = () => sauverEtat(pilote, etat);

  try {
    // ------------------------------------------------ Anciens dépôts par appareil (transition, Fondateur)
    if (compte === 'principal' && estMaitre(liaison)) {
      etat = await importerAnciens(o, etat, resultat, horloge);
      sauver();
    }

    // ------------------------------------------------ Migration de cet appareil
    if (!etat.serveur) {
      const toutes = [...Object.keys(extraireEntites(pilote)), ...Object.keys(etat.supprimes)];
      etat = ajouterFile({ ...etat, serveur: { rev: 0, base: {} } }, toutes, horloge().toISOString());
      sauver();
    }

    // ------------------------------------------------ Tirer
    let suite = true;
    while (suite) {
      const reponse = await appeler(liaison, `/v9/coffre/${encodeURIComponent(compte)}?depuis=${etat.serveur!.rev}&limite=500`, {}, requete);
      if (!reponse.ok) throw new ErreurRelais(`Le serveur a répondu ${reponse.status} (lecture du coffre).`, reponse.status);
      const page = (await reponse.json()) as { enregistrements?: EnregistrementServeur[]; suite?: boolean };
      const enregistrements = page.enregistrements ?? [];
      etat = appliquerEnregistrements(o, etat, enregistrements, resultat, false);
      const derniere = enregistrements.length > 0 ? enregistrements[enregistrements.length - 1].rev : etat.serveur!.rev;
      etat = { ...etat, serveur: { ...etat.serveur!, rev: Math.max(etat.serveur!.rev, derniere) } };
      sauver();
      suite = Boolean(page.suite) && enregistrements.length > 0;
    }

    // ------------------------------------------------ Pousser
    etat = noterChangementsLocaux(etat, extraireEntites(pilote), horloge().toISOString()) as EtatServeur;
    const entites = extraireEntites(pilote);
    const file = etat.enAttente?.cles ?? [];
    const lots: Array<Array<{ cle: string; enr: { id: string; base: number; date: string; supprime: boolean; valeur: string } }>> = [];
    let lot: (typeof lots)[number] = [];
    let octets = 0;
    const sansObjet = new Set<string>();
    for (const c of file) {
      const present = c in entites;
      const supprime = !present && c in etat.supprimes;
      if (!present && !supprime) {
        sansObjet.add(c);
        continue;
      }
      const date = (present ? etat.dates[c] : etat.supprimes[c]) ?? horloge().toISOString();
      const id = idEnregistrement(cle, c);
      const valeur = scellerEnregistrement(cle, compte, id, present ? { cle: c, date, valeur: entites[c] } : { cle: c, date, supprime: true });
      if (valeur.length > TAILLE_MAX_VALEUR) {
        resultat.erreurs.push(`« ${c} » est trop volumineux pour le serveur : gardé sur cet appareil.`);
        continue;
      }
      if (lot.length >= LOT_ENREGISTREMENTS || (lot.length > 0 && octets + valeur.length > LOT_OCTETS)) {
        lots.push(lot);
        lot = [];
        octets = 0;
      }
      lot.push({ cle: c, enr: { id, base: etat.serveur!.base[c] ?? 0, date, supprime, valeur } });
      octets += valeur.length;
    }
    if (lot.length > 0) lots.push(lot);
    etat = retirerFile(etat, sansObjet);

    for (const l of lots) {
      const reponse = await appeler(liaison, `/v9/coffre/${encodeURIComponent(compte)}`, { methode: 'POST', corps: JSON.stringify({ enregistrements: l.map(x => x.enr) }) }, requete);
      if (!reponse.ok) throw new ErreurRelais(`Le serveur a refusé l’envoi (${reponse.status}).`, reponse.status);
      const corps = (await reponse.json()) as { resultats?: Array<{ id: string; rev: number; etat: string; actuel?: EnregistrementServeur }> };
      const parId = new Map(l.map(x => [x.enr.id, x.cle]));
      const faits = new Set<string>();
      const perdus: EnregistrementServeur[] = [];
      const base = { ...etat.serveur!.base };
      for (const r of corps.resultats ?? []) {
        const c = parId.get(r.id);
        if (!c) continue;
        faits.add(c);
        if (r.etat === 'ok') {
          base[c] = r.rev;
          resultat.envoyes++;
        } else if (r.actuel) {
          perdus.push(r.actuel);
          resultat.conflits++;
        }
      }
      etat = retirerFile({ ...etat, serveur: { ...etat.serveur!, base } }, faits);
      if (perdus.length > 0) etat = appliquerEnregistrements(o, etat, perdus, resultat, true);
      sauver();
    }

    // Réponse du serveur bien arrivée : la file restante (le cas échéant) repart au prochain tour.
    const maintenant = horloge().toISOString();
    etat = {
      ...etat,
      serveur: { ...etat.serveur!, migreLe: etat.serveur!.migreLe ?? maintenant },
      derniereSynchro: maintenant,
      ...(etat.enAttente ? { enAttente: { ...etat.enAttente, premierEchec: undefined, essais: 0, motif: undefined } } : {}),
    };
    sauver();
    resultat.enAttente = etat.enAttente?.cles.length ?? 0;
    return resultat;
  } catch (erreur) {
    if (etat.enAttente) {
      etat = {
        ...etat,
        enAttente: {
          ...etat.enAttente,
          premierEchec: etat.enAttente.premierEchec ?? horloge().toISOString(),
          essais: etat.enAttente.essais + 1,
          motif: erreur instanceof Error ? erreur.message : String(erreur),
        },
      };
    }
    sauver();
    throw erreur;
  }
}

/**
 * Applique des enregistrements du serveur. `forcer` : versions gagnantes renvoyées après un
 * conflit perdu (la nôtre est gardée dans l'historique du serveur) ; elles remplacent celle d'ici.
 */
function appliquerEnregistrements(o: OptionsServeur, etatEntree: EtatServeur, enregistrements: readonly EnregistrementServeur[], resultat: ResultatServeur, forcer: boolean): EtatServeur {
  const { pilote, cle, compte } = o;
  let etat = etatEntree;
  const charge: Charge = { version: 2, entites: {}, dates: {}, supprimes: {}, appareil: { nom: 'serveur', plateforme: 'serveur' } };
  const base = { ...etat.serveur!.base };
  const recues: string[] = [];
  const unions: Array<{ cle: string; valeur: unknown }> = [];
  const dates = { ...etat.dates };
  const enFile = new Set(etat.enAttente?.cles ?? []);
  const locales = extraireEntites(pilote);
  for (const e of enregistrements) {
    let contenu: ContenuEnregistrement;
    try {
      contenu = ouvrirEnregistrement(cle, compte, e.id, e.valeur);
    } catch (erreur) {
      resultat.erreurs.push(erreur instanceof Error ? erreur.message : String(erreur));
      continue;
    }
    // Notre propre écriture, déjà connue.
    if (!forcer && base[contenu.cle] === e.rev) continue;
    const identique = contenu.supprime ? !(contenu.cle in locales) : contenu.cle in locales && empreinte(locales[contenu.cle]) === empreinte(contenu.valeur);
    if (!forcer && !identique && estUnionApp(contenu.cle) && !contenu.supprime) {
      // Événements du journal : réunis ici (jamais l'un à la place de l'autre), la réunion repart.
      unions.push({ cle: contenu.cle, valeur: contenu.valeur });
      base[contenu.cle] = e.rev;
      continue;
    }
    if (!forcer && !identique && enFile.has(contenu.cle)) {
      // Modifiée ici ET là-bas : c'est le serveur qui tranche à l'envoi (révision connue inchangée),
      // et garde la version perdante dans son historique. Rien n'est écrasé ici sans trace.
      continue;
    }
    base[contenu.cle] = e.rev;
    recues.push(contenu.cle);
    if (forcer) delete dates[contenu.cle];
    if (contenu.supprime) charge.supprimes[contenu.cle] = contenu.date;
    else {
      charge.entites[contenu.cle] = contenu.valeur;
      charge.dates[contenu.cle] = contenu.date;
    }
  }
  etat = { ...etat, dates, serveur: { ...etat.serveur!, base } };
  for (const u of unions) {
    try {
      ecrireEntite(pilote, u.cle, u.valeur, id => id);
      resultat.recus++;
    } catch (erreur) {
      resultat.erreurs.push(erreur instanceof Error ? erreur.message : String(erreur));
    }
  }
  if (unions.length > 0) {
    // La réunion diffère de ce qu'a le serveur : notée comme changement d'ici, elle repart au prochain envoi.
    etat = noterChangementsLocaux(etat, extraireEntites(pilote), (o.maintenant ?? (() => new Date()))().toISOString()) as EtatServeur;
  }
  if (recues.length === 0) return etat;
  const applique = appliquerCharge(pilote, etat, charge);
  cumulerBilan(resultat.bilan, applique.bilan);
  resultat.recus += recues.length;
  etat = applique.etat as EtatServeur;
  // Ce qui est maintenant identique ici et sur le serveur sort de la file.
  const apres = extraireEntites(pilote);
  const alignees = new Set<string>();
  for (const c of recues) {
    const supprimeLaBas = c in charge.supprimes;
    if (supprimeLaBas ? !(c in apres) : c in apres && empreinte(apres[c]) === empreinte(charge.entites[c])) alignees.add(c);
  }
  return retirerFile(etat, alignees);
}

const estUnionApp = (cle: string): boolean => cle.startsWith('journal:boite:');

/**
 * Transition : les appareils pas encore à jour déposent encore leur état dans `/boite/<appareil>`.
 * Ce qui y est plus récent que le dernier dépôt lu est fusionné ici (puis part au coffre serveur) ;
 * les dépôts de plus de 30 jours, déjà fusionnés, sont effacés du relais (une fois par jour).
 */
async function importerAnciens(o: OptionsServeur, etatEntree: EtatServeur, resultat: ResultatServeur, horloge: () => Date): Promise<EtatServeur> {
  const { pilote, liaison, cle, appareil } = o;
  const requete = o.requete ?? fetch;
  let etat = etatEntree;
  const reponseIndex = await appeler(liaison, '/boite', {}, requete);
  if (!reponseIndex.ok) return etat;
  const index = ((await reponseIndex.json()) as { appareils?: Record<string, { date: string }> }).appareils ?? {};
  const connusAvant = { ...etat.connus };
  for (const [autre, { date }] of Object.entries(index)) {
    if (autre === 'coffre' || autre === appareil || (etat.lus[autre] ?? '') >= date) continue;
    const reponse = await appeler(liaison, `/boite/${encodeURIComponent(autre)}`, {}, requete);
    if (!reponse.ok) continue;
    try {
      const applique = appliquerDepot(pilote, etat, cle, autre, date, (await reponse.json()) as Enveloppe, horloge().toISOString());
      etat = applique.etat as EtatServeur;
      cumulerBilan(resultat.bilan, applique.bilan);
      resultat.anciens++;
    } catch (erreur) {
      resultat.erreurs.push(erreur instanceof Error ? erreur.message : String(erreur));
    }
  }
  // Ce qui vient d'un ancien appareil doit aussi rejoindre le coffre serveur.
  if (etat.serveur) etat = ajouterFile(etat, changees(connusAvant, etat.connus), horloge().toISOString());
  // Ménage (sans perte : tout dépôt lu ci-dessus est déjà fusionné) : le nôtre, et les vieux.
  const maintenant = horloge().getTime();
  if (Date.parse(etat.serveur?.menageLe ?? DATE_INCONNUE) < maintenant - 86_400_000) {
    for (const [autre, { date }] of Object.entries(index)) {
      const lu = (etat.lus[autre] ?? '') >= date;
      const vieux = Date.parse(date) < maintenant - AGE_MENAGE_APPAREILS_MS;
      if (autre === 'coffre' || !((autre === appareil) || (lu && vieux))) continue;
      await appeler(liaison, `/boite/${encodeURIComponent(autre)}`, { methode: 'DELETE' }, requete).catch(() => undefined);
      const appareils = { ...etat.appareils };
      delete appareils[autre];
      etat = { ...etat, appareils };
    }
    if (etat.serveur) etat = { ...etat, serveur: { ...etat.serveur, menageLe: new Date(maintenant).toISOString() } };
  }
  return etat;
}

/** Corbeille et conflits gardés par le serveur, déchiffrés (les plus récents d'abord). */
export async function historiqueServeur(o: Pick<OptionsServeur, 'liaison' | 'cle' | 'compte' | 'requete'>, limite = 100): Promise<Array<{ cle: string; date: string; supprime: boolean; valeur?: unknown; raison: string; le: number }>> {
  const reponse = await appeler(o.liaison, `/v9/coffre/${encodeURIComponent(o.compte)}/historique?limite=${limite}`, {}, o.requete ?? fetch);
  if (!reponse.ok) throw new ErreurRelais(`Le serveur a répondu ${reponse.status}.`, reponse.status);
  const corps = (await reponse.json()) as { historique?: Array<EnregistrementServeur & { raison: string; le: number }> };
  return (corps.historique ?? []).flatMap(h => {
    try {
      const c = ouvrirEnregistrement(o.cle, o.compte, h.id, h.valeur);
      return [{ cle: c.cle, date: c.date, supprime: Boolean(c.supprime), ...(c.supprime ? {} : { valeur: c.valeur }), raison: h.raison, le: h.le }];
    } catch {
      return [];
    }
  });
}
