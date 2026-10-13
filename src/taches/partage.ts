/**
 * Tâches : synchronisation par le relais, chiffrée de bout en bout.
 *
 * Aucun nouvel objet que l'ami écrive, aucun changement du relais : on
 * réutilise les mécanismes existants (voir docs/taches.md).
 *
 *  1. Appareils du Fondateur : `p/principal/boite/taches`, ses données
 *     entières scellées par SA clé de synchronisation (`cleDerivee('synchro')`,
 *     comme `admin`). Fusion champ par champ (`fusion.ts`).
 *  2. Fondateur → ami : `p/<ami>/boite/taches` (écrit par le jeton maître
 *     SEUL : le relais refuse qu'un jeton de profil écrive un nom qui n'est
 *     pas à lui), scellé pour la clé PUBLIQUE de réception de l'ami (celle de
 *     Tsuzuku, `tsuzuku-cle` : ECIES X25519 + XChaCha20-Poly1305, usage lié à
 *     l'identifiant de l'ami). Contenu : les SEULS projets partagés (leurs
 *     listes et tâches, pierres tombales comprises), leur mode (lecture ou
 *     écriture), les prénoms, et la clé de partage `K` (32 octets).
 *  3. Ami → Fondateur : le champ `taches` de son retour `compte` (objet qu'il
 *     écrit déjà), scellé par `K` (XChaCha20-Poly1305). Contenu : les tâches
 *     qu'il a touchées dans les projets partagés en écriture. Le Fondateur
 *     revérifie tout (projet partagé en écriture, liste du même projet) et
 *     fusionne ; il ne prend jamais de l'ami un projet, une liste, un statut
 *     ou une suppression de projet.
 *
 * Budget d'écritures KV : rien n'est déposé sans changement (empreintes), et
 * jamais deux dépôts du même objet à moins de 30 s (les changements
 * intermédiaires partent avec le suivant). Une frappe ne fait pas de dépôt :
 * l'app n'enregistre un texte qu'à la validation, et le tour des comptes ne
 * part que ~5 s après la dernière écriture.
 */

import { hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { ouvrirDepot, scellerPourAdmin, utf8DepuisOctets } from '../securite/sequestre';
import type { SourceAleatoire } from '../securite/aleatoire';
import { ouvrirEnveloppe, sceller, type Enveloppe } from '../sync/relais/chiffrement';
import { publieParAdmin, type Espaces } from '../sync/relais/espaces';
import { empreinte } from '../sync/relais/fusionLww';
import { lireDocumentCle, OBJET_CLE, paireDe } from '../tsuzuku/plateforme/partage';
import type { BasePrefs } from '../tsuzuku/plateforme/stockage';
import { fusionnerDonnees, fusionnerTache, memesDonnees } from './fusion';
import {
  donneesVides,
  ecrireDonnees,
  lireDonnees,
  lireTache,
  vivant,
  type DonneesTaches,
  type ModePartage,
  type Tache,
} from './modele';

export const CLES_TACHES = {
  /** Données du Fondateur (sa base chiffrée). */
  donnees: 'taches.donnees',
  /** Copie de l'ami : projets partagés avec lui + ses modifications. */
  copie: 'taches.copie',
  /** Rappels déjà déclenchés et non lus (appareil). */
  rappels: 'taches.rappels',
  /** Préférences d'affichage (vue, projet ouvert…) de l'appareil. */
  affichage: 'taches.affichage',
} as const;

export const OBJET_TACHES = 'taches';
const ESPACE_ADMIN = 'principal';
export const DELAI_MIN_DEPOTS_MS = 30_000;
const usage = (id: string) => `taches|${id}`;

// ------------------------------------------------------------------ Copie de l'ami

export interface CopieAmi {
  v: 1;
  /** Prénoms affichés. */
  fondateur?: string;
  ami?: string;
  /** Clé de partage (hex) reçue du Fondateur, pour sceller ses envois. */
  cle?: string;
  donnees: DonneesTaches;
  recuLe?: string;
}

export const copieVide = (): CopieAmi => ({ v: 1, donnees: donneesVides() });

export function lireCopie(brut: string | null | undefined): CopieAmi {
  try {
    const o = brut ? (JSON.parse(brut) as Partial<CopieAmi>) : undefined;
    if (!o || o.v !== 1) return copieVide();
    return {
      v: 1,
      ...(typeof o.fondateur === 'string' ? { fondateur: o.fondateur.slice(0, 40) } : {}),
      ...(typeof o.ami === 'string' ? { ami: o.ami.slice(0, 40) } : {}),
      ...(typeof o.cle === 'string' && /^[0-9a-f]{64}$/.test(o.cle) ? { cle: o.cle } : {}),
      donnees: lireDonnees(o.donnees),
      ...(typeof o.recuLe === 'string' ? { recuLe: o.recuLe } : {}),
    };
  } catch {
    return copieVide();
  }
}

/** Mode de partage d'un projet pour l'ami (projets absents : aucun). */
export const modeProjet = (d: DonneesTaches, projetId: string): ModePartage => {
  const p = d.projets[projetId];
  return vivant(p) ? p.partage : 'aucun';
};

// ------------------------------------------------------------------ Ce que reçoit l'ami

export interface DocumentPourAmi {
  v: 1;
  ami: string;
  amiNom?: string;
  fondateur?: string;
  cle: string;
  donnees: DonneesTaches;
}

/**
 * Projets partagés (vivants, en lecture ou écriture), leurs listes et leurs
 * tâches — pierres tombales comprises, pour que l'ami retire ce qui a été
 * supprimé. Rien d'autre : ni les autres projets, ni les vues, ni les réglages.
 */
export function projectionPourAmi(d: DonneesTaches): DonneesTaches {
  const projets = Object.fromEntries(Object.values(d.projets).filter(p => vivant(p) && p.partage !== 'aucun').map(p => [p.id, p]));
  const espaces = Object.fromEntries(
    Object.values(projets)
      .map(p => d.espaces[p.espaceId])
      .filter(vivant)
      .map(e => [e.id, e]),
  );
  return {
    v: 1,
    espaces,
    projets,
    listes: Object.fromEntries(Object.values(d.listes).filter(l => projets[l.projetId]).map(l => [l.id, l])),
    taches: Object.fromEntries(Object.values(d.taches).filter(t => projets[t.projetId]).map(t => [t.id, t])),
    vues: {},
    reglages: { id: 'reglages', h: {} },
  };
}

/**
 * L'ami range ce qu'il reçoit : projets, espaces et listes tels que publiés
 * (le Fondateur en est seul maître) ; tâches fusionnées champ par champ avec
 * les siennes ; une tâche qu'il a créée et pas encore renvoyée est gardée si
 * son projet est partagé en écriture ; tout le reste (projet retiré du
 * partage) disparaît.
 */
export function appliquerReception(copie: CopieAmi, doc: DocumentPourAmi): CopieAmi {
  const recu = lireDonnees(doc.donnees);
  const taches: Record<string, Tache> = {};
  for (const id of new Set([...Object.keys(recu.taches), ...Object.keys(copie.donnees.taches)])) {
    const a = copie.donnees.taches[id];
    const b = recu.taches[id];
    if (a && b) taches[id] = fusionnerTache(a, b);
    else if (b) taches[id] = b;
    else if (a && modeProjet(recu, a.projetId) === 'ecriture' && vivant(recu.listes[a.listeId]) && recu.listes[a.listeId].projetId === a.projetId) taches[id] = a;
  }
  return {
    v: 1,
    ...(doc.fondateur ? { fondateur: doc.fondateur } : {}),
    ...(doc.amiNom ? { ami: doc.amiNom } : {}),
    cle: doc.cle,
    donnees: { ...recu, taches },
    ...(copie.recuLe ? { recuLe: copie.recuLe } : {}),
  };
}

// ------------------------------------------------------------------ Ce que renvoie l'ami

export interface EnvoiAmi {
  v: 1;
  taches: Record<string, Tache>;
}

/** Une tâche porte-t-elle une trace de l'ami (champ, élément, commentaire, historique) ? */
function toucheeParAmi(t: Tache): boolean {
  return (
    Object.values(t.h).some(h => h.endsWith('|a')) ||
    Object.values(t.checklist).some(e => e.h.endsWith('|a')) ||
    Object.values(t.commentaires).some(c => c.h.endsWith('|a')) ||
    t.historique.some(e => e.auteur === 'ami')
  );
}

/** Tâches touchées par l'ami dans les projets partagés en écriture. */
export function envoiDeLAmi(copie: CopieAmi): EnvoiAmi {
  const taches: Record<string, Tache> = {};
  for (const t of Object.values(copie.donnees.taches)) {
    if (modeProjet(copie.donnees, t.projetId) === 'ecriture' && toucheeParAmi(t)) taches[t.id] = t;
  }
  return { v: 1, taches };
}

export interface BilanEnvoi {
  donnees: DonneesTaches;
  acceptees: number;
  refusees: number;
}

/** Une tâche peut-elle vivre (venant de l'ami) là où elle dit être ? */
function placeAutorisee(d: DonneesTaches, t: Tache): boolean {
  const l = d.listes[t.listeId];
  if (modeProjet(d, t.projetId) !== 'ecriture' || !vivant(l) || l.projetId !== t.projetId) return false;
  if (t.parentId) {
    const parent = d.taches[t.parentId];
    if (!parent || parent.projetId !== t.projetId) return false;
  }
  return true;
}

/**
 * Le Fondateur applique ce que l'ami renvoie : seulement des tâches, seulement
 * dans des projets partagés EN ÉCRITURE (avant comme après la fusion), dans
 * une liste de ce projet. Le reste est ignoré.
 */
export function appliquerEnvoiAmi(d: DonneesTaches, envoi: unknown): BilanEnvoi {
  const brut = envoi && typeof envoi === 'object' ? (envoi as { taches?: unknown }).taches : undefined;
  const taches = { ...d.taches };
  let acceptees = 0;
  let refusees = 0;
  for (const valeur of Object.values(brut && typeof brut === 'object' ? (brut as Record<string, unknown>) : {}).slice(0, 5000)) {
    const t = lireTache(valeur);
    if (!t) {
      refusees++;
      continue;
    }
    const existante = d.taches[t.id];
    if (existante && !placeAutorisee(d, existante)) {
      refusees++;
      continue;
    }
    const fusion = existante ? fusionnerTache(existante, t) : t;
    if (!placeAutorisee(d, fusion)) {
      refusees++;
      continue;
    }
    taches[t.id] = fusion;
    acceptees++;
  }
  return { donnees: acceptees ? { ...d, taches } : d, acceptees, refusees };
}

// ------------------------------------------------------------------ Scellement

export function scellerPourAmi(publique: string, id: string, doc: DocumentPourAmi, alea?: SourceAleatoire): string {
  return JSON.stringify({ v: 1, cle: publique, depot: scellerPourAdmin(publique, utf8ToBytes(JSON.stringify(doc)), usage(id), alea) });
}

export function ouvrirPourAmi(privee: string, id: string, charge: string): DocumentPourAmi {
  const o = JSON.parse(charge) as { depot?: unknown };
  if (typeof o.depot !== 'string') throw new Error('Dépôt de tâches illisible.');
  const doc = JSON.parse(utf8DepuisOctets(ouvrirDepot(hexToBytes(privee), o.depot, usage(id)))) as Partial<DocumentPourAmi>;
  if (doc.v !== 1 || doc.ami !== id || typeof doc.cle !== 'string' || !/^[0-9a-f]{64}$/.test(doc.cle)) throw new Error('Dépôt de tâches d’un autre compte.');
  return { v: 1, ami: id, cle: doc.cle, donnees: lireDonnees(doc.donnees), ...(typeof doc.amiNom === 'string' ? { amiNom: doc.amiNom } : {}), ...(typeof doc.fondateur === 'string' ? { fondateur: doc.fondateur } : {}) };
}

export const scellerEnvoi = (cle: string, envoi: EnvoiAmi, date: string, alea?: SourceAleatoire): Enveloppe => sceller(cle, envoi, 'taches-ami', date, alea);
export const ouvrirEnvoi = (cle: string, enveloppe: unknown): unknown => ouvrirEnveloppe<unknown>(cle, enveloppe as Enveloppe);

const plusTard = (depuis: string | undefined, maintenant: string) => !depuis || Date.parse(maintenant) - Date.parse(depuis) >= DELAI_MIN_DEPOTS_MS || Date.parse(maintenant) < Date.parse(depuis);

// ------------------------------------------------------------------ Tour du Fondateur

/** Ce que le Fondateur retient entre deux tours (rien de secret). */
export interface EtatTachesFondateur {
  /** Date du dépôt `taches` (principal) déjà lu ou écrit, et empreinte de ce qu'il contient. */
  lu?: string;
  publie?: string;
  depotLe?: string;
  /** Ami servi, empreinte publiée chez lui, clé publique vue, date de dépôt. */
  ami?: string;
  amiH?: string;
  amiCle?: string;
  amiCleDate?: string;
  amiDepotLe?: string;
  amiDepose?: string;
}

export interface OptionsTachesFondateur {
  espaces: Espaces;
  base: Pick<BasePrefs, 'lire' | 'ecrire'>;
  cleSynchro: string;
  etat: EtatTachesFondateur;
  /** Objets de l'espace `principal` (liste déjà lue). */
  objetsAdmin: Record<string, { date: string; auteur?: string }>;
  /** Objets de l'espace d'un compte (liste déjà lue si possible). */
  objetsCompte(id: string): Promise<Record<string, { date: string; auteur?: string }>>;
  /** Comptes encore présents dans l'annuaire. */
  comptes: ReadonlySet<string>;
  /** Champ `taches` des retours d'amis lus à ce tour, par compte. */
  retours: Record<string, unknown>;
  /** Prénom affiché du Fondateur chez l'ami. */
  nomFondateur?: string;
  maintenant: string;
  alea?: SourceAleatoire;
}

export interface BilanTaches {
  etat: EtatTachesFondateur;
  depots: number;
  change: boolean;
  /** L'ami n'a pas encore publié sa clé de réception. */
  enAttente: boolean;
  erreurs: string[];
}

export async function synchroniserTachesFondateur(o: OptionsTachesFondateur): Promise<BilanTaches> {
  const etat: EtatTachesFondateur = { ...o.etat };
  const bilan: BilanTaches = { etat, depots: 0, change: false, enAttente: false, erreurs: [] };
  const brut = o.base.lire(CLES_TACHES.donnees);
  if (!brut && !o.objetsAdmin[OBJET_TACHES] && !etat.ami) return bilan;
  const locales = lireDonnees(brut ?? undefined);
  let donnees = locales;

  // 1. Ce que l'ami renvoie (scellé par la clé de partage).
  const ami = donnees.reglages.ami;
  const retour = ami ? o.retours[ami] : undefined;
  if (ami && retour !== undefined && donnees.reglages.cle) {
    try {
      donnees = appliquerEnvoiAmi(donnees, ouvrirEnvoi(donnees.reglages.cle, retour)).donnees;
    } catch (erreur) {
      bilan.erreurs.push(`Tâches de l’ami illisibles : ${erreur instanceof Error ? erreur.message : String(erreur)}`);
    }
  }

  // 2. Les autres appareils du Fondateur.
  const dateDistante = o.objetsAdmin[OBJET_TACHES]?.date;
  if (dateDistante && dateDistante !== etat.lu) {
    try {
      const objet = await o.espaces.lire(ESPACE_ADMIN, OBJET_TACHES);
      if (objet) {
        const distant = lireDonnees(ouvrirEnveloppe<unknown>(o.cleSynchro, JSON.parse(objet.charge) as Enveloppe));
        donnees = fusionnerDonnees(donnees, distant);
        etat.lu = objet.date;
        etat.publie = empreinte(distant);
      }
    } catch (erreur) {
      bilan.erreurs.push(`Tâches : ${erreur instanceof Error ? erreur.message : String(erreur)}`);
    }
  }
  if (!memesDonnees(donnees, locales)) {
    o.base.ecrire(CLES_TACHES.donnees, ecrireDonnees(donnees));
    bilan.change = true;
  }
  const h = empreinte(donnees);
  if (h !== etat.publie && plusTard(etat.depotLe, o.maintenant)) {
    const date = dateDistante && dateDistante >= o.maintenant ? new Date(Date.parse(dateDistante) + 1).toISOString() : o.maintenant;
    await o.espaces.deposer(ESPACE_ADMIN, OBJET_TACHES, JSON.stringify(sceller(o.cleSynchro, donnees, OBJET_TACHES, date, o.alea)), date);
    etat.lu = date;
    etat.publie = h;
    etat.depotLe = o.maintenant;
    bilan.depots++;
  }

  // 3. L'ami (un seul) : ses projets partagés, scellés pour sa clé.
  const cible = ami && o.comptes.has(ami) && donnees.reglages.cle ? ami : undefined;
  if (etat.ami && etat.ami !== cible) {
    // Ancien ami (ou plus d'ami) : son dépôt est retiré, il ne voit plus rien.
    try {
      await o.espaces.supprimer(etat.ami, OBJET_TACHES);
      bilan.depots++;
    } catch (erreur) {
      if (o.comptes.has(etat.ami)) bilan.erreurs.push(erreur instanceof Error ? erreur.message : String(erreur));
    }
    etat.ami = undefined;
    etat.amiH = undefined;
    etat.amiCle = undefined;
    etat.amiCleDate = undefined;
    etat.amiDepose = undefined;
  }
  if (cible) {
    try {
      const objets = await o.objetsCompte(cible);
      const dateCle = objets[OBJET_CLE]?.date;
      if (dateCle && (dateCle !== etat.amiCleDate || etat.ami !== cible)) {
        const doc = await o.espaces.lire(cible, OBJET_CLE);
        etat.amiCle = lireDocumentCle(doc?.charge);
        etat.amiCleDate = dateCle;
      } else if (!dateCle) {
        etat.amiCle = undefined;
        etat.amiCleDate = undefined;
      }
      etat.ami = cible;
      const doc: DocumentPourAmi = {
        v: 1,
        ami: cible,
        ...(donnees.reglages.amiNom ? { amiNom: donnees.reglages.amiNom } : {}),
        ...(o.nomFondateur ? { fondateur: o.nomFondateur } : {}),
        cle: donnees.reglages.cle!,
        donnees: projectionPourAmi(donnees),
      };
      const hAmi = empreinte([doc, etat.amiCle ?? '']);
      const meta = objets[OBJET_TACHES];
      // Effacé ou réécrit par un autre que le Fondateur : republié.
      const altere = etat.amiDepose !== undefined && (!meta || !publieParAdmin(meta.auteur));
      if (!etat.amiCle) {
        bilan.enAttente = true;
      } else if ((hAmi !== etat.amiH || altere) && plusTard(etat.amiDepotLe, o.maintenant)) {
        await o.espaces.deposer(cible, OBJET_TACHES, scellerPourAmi(etat.amiCle, cible, doc, o.alea), o.maintenant);
        etat.amiH = hAmi;
        etat.amiDepotLe = o.maintenant;
        etat.amiDepose = o.maintenant;
        bilan.depots++;
      }
    } catch (erreur) {
      bilan.erreurs.push(erreur instanceof Error ? erreur.message : String(erreur));
    }
  }
  return bilan;
}

// ------------------------------------------------------------------ Tour de l'ami

export interface SuiviTachesAmi {
  /** Date du dépôt reçu déjà lu. */
  lu?: string;
  /** Empreinte de l'envoi déjà déposé, et date du dépôt. */
  envoye?: string;
  envoiLe?: string;
}

export interface EnvoiPret {
  h: string;
  /** Scelle l'envoi (nouvelle enveloppe, nouveau nonce). */
  sceller(date: string): Enveloppe;
  /** Le délai minimal entre deux envois est écoulé. */
  permis: boolean;
}

/**
 * L'ami reçoit les projets partagés (s'ils ont changé) et prépare ce qu'il
 * renvoie. Rien n'est écrit sur le relais ici : l'envoi part dans le retour
 * `compte` (voir `synchroniserCompteAmi`).
 */
export async function recevoirTachesAmi(o: {
  espaces: Espaces;
  id: string;
  base: BasePrefs;
  objets: Record<string, { date: string; auteur?: string }>;
  suivi: SuiviTachesAmi;
  maintenant: string;
  alea?: SourceAleatoire;
}): Promise<{ suivi: SuiviTachesAmi; change: boolean; envoi?: EnvoiPret }> {
  const suivi = { ...o.suivi };
  let change = false;
  const brut = o.base.lire(CLES_TACHES.copie);
  let copie = lireCopie(brut);
  const date = o.objets[OBJET_TACHES]?.date;
  if (date && date !== suivi.lu) {
    const objet = await o.espaces.lire(o.id, OBJET_TACHES);
    // Seul un dépôt du Fondateur (jeton maître) est cru.
    if (objet && publieParAdmin(objet.auteur)) {
      try {
        const paire = paireDe(o.base, o.alea);
        const doc = ouvrirPourAmi(paire.privee, o.id, objet.charge);
        copie = { ...appliquerReception(copie, doc), recuLe: objet.date };
        suivi.lu = date;
      } catch {
        // Scellé pour une autre clé (autre appareil de l'ami) : le Fondateur republiera pour la clé déposée.
      }
    } else {
      suivi.lu = date;
    }
  } else if (!date && (Object.keys(copie.donnees.projets).length > 0 || copie.cle)) {
    // Plus rien n'est partagé avec ce compte (ou il n'est plus l'ami choisi).
    copie = copieVide();
    suivi.lu = undefined;
  }
  const texte = JSON.stringify(copie);
  if (texte !== (brut ?? JSON.stringify(copieVide()))) {
    o.base.ecrire(CLES_TACHES.copie, texte);
    change = true;
  }
  const envoi = envoiDeLAmi(copie);
  if (!copie.cle || Object.keys(envoi.taches).length === 0) return { suivi, change };
  const cle = copie.cle;
  const h = empreinte(envoi);
  if (h === suivi.envoye) return { suivi, change };
  return { suivi, change, envoi: { h, sceller: d => scellerEnvoi(cle, envoi, d, o.alea), permis: plusTard(suivi.envoiLe, o.maintenant) } };
}
