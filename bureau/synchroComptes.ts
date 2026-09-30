/**
 * Synchronisation des COMPTES par le relais (en plus de celle du portefeuille
 * de l'administrateur, `src/sync/relais/synchroniser.ts`).
 *
 * Qui dépose quoi, et où (voir docs/synchro-relais.md) :
 *
 *  - espace de l'administrateur `p/principal/` (jeton maître seulement) :
 *    `annuaire` (document fusionnable de l'annuaire, déjà opaque) et `admin`
 *    (données d'administration, scellées par sa clé de synchronisation) ;
 *  - espace de chaque ami `p/<id>/` (jeton maître ou jeton de profil de cet
 *    ami) : `annuaire` (sa PROJECTION : son entrée seule), `coffre` et
 *    `portefeuille` (ses fichiers, tels qu'ils sont sur le disque), `compte`
 *    (ce que l'ami renvoie de lui-même : suivi, séquestre, invitation).
 *
 * Tout ce qui est retenu entre deux tours (empreintes, dates) est rangé dans
 * le stockage du navigateur : rien de secret, seulement de quoi dater les
 * changements.
 */

import {
  lireAnnuaire,
  type Annuaire,
  type ClesAdmin,
} from '../src/profils/annuaire';
import {
  annuaireDepuisEntites,
  appliquerRetourAmi,
  fusionnerAnnuaire,
  projectionTitulaire,
  recevoirProjection,
  retourAmi,
  type RetourAmi,
} from '../src/profils/synchroAnnuaire';
import { ID_PRINCIPAL, fichiersDuProfil } from '../src/profils/profils';
import { espacesDuRelais, publierDelegations, type Espaces } from '../src/sync/relais/espaces';
import { NIVEAU_RANG } from '../src/hub/admin/roles';
import {
  empreinte,
  fusionner,
  lireDocumentLww,
  lireEtatLww,
  noterLocal,
  type EtatLww,
} from '../src/sync/relais/fusionLww';
import { synchroniserFichier, type EtatFichiers } from '../src/sync/relais/fichiers';
import { ouvrirEnveloppe, sceller, type Enveloppe } from '../src/sync/relais/chiffrement';
import { decoderLiaison, encoderLiaison, type Liaison } from '../src/sync/relais/liaison';
import { ESPACE_ADMIN, compteDeLiaison, estMaitre, peutOuvrirEspace } from '../src/sync/relais/portees';
import { ErreurRelais, recupererCoffre } from '../src/sync/relais/synchroniser';
import { lireDonnees, ecrireDonnees } from '../src/hub/admin/donnees';
import { donneesDepuisEntites, entitesDonnees, fusionsDonnees } from '../src/hub/admin/fusionDonnees';
import type { BasePrefs } from '../src/tsuzuku/plateforme/stockage';
import {
  OBJETS_TSUZUKU,
  publierSourcesPartagees,
  recevoirSourcesPartagees,
  type EtatPublications,
  type SuiviReception,
} from '../src/tsuzuku/plateforme/partage';
import { lireProjection, projectionPour, type ProjectionAbo } from '../src/hub/abonnements/abonnements';

type Fetch = typeof fetch;

export interface Memoire {
  getItem(cle: string): string | null;
  setItem(cle: string, valeur: string): void;
  removeItem(cle: string): void;
}

/** Fichiers du bureau (même contrat que `Stockage`, sans ce qui ne sert pas ici). */
export interface Fichiers {
  lire(nom: string): Promise<Uint8Array | undefined>;
  ecrire(nom: string, octets: Uint8Array): Promise<void>;
}

export const CLES_MEMOIRE = {
  /** Codes de liaison connus sur ce navigateur : { maitre?, comptes: { id: code } }. */
  liaisons: 'applibourse.liaisons',
  /** Ancienne clé (liaison de l'administrateur en attente, voir actif.ts). */
  liaisonHistorique: 'applibourse.liaison',
  annuaire: 'applibourse.synchro.annuaire',
  admin: 'applibourse.synchro.admin',
  fichiers: 'applibourse.synchro.fichiers',
  /** Par compte : empreinte de la projection publiée / date de la projection et du retour lus. */
  comptes: 'applibourse.synchro.comptes',
  /** Empreinte du coffre de l'administrateur reçu du relais (coffre « relié »). */
  coffreRelie: 'applibourse.synchro.coffreRelie',
  /** Empreinte des délégations des titulaires publiées sur le relais. */
  delegations: 'applibourse.synchro.delegations',
  /** Tsuzuku : sources partagées publiées par le compte historique, par compte. */
  tsuzuku: 'applibourse.synchro.tsuzuku',
  /** Tsuzuku : clé de réception déposée et sources reçues, par compte ouvert ici. */
  tsuzukuRecu: 'applibourse.synchro.tsuzuku.recu',
  /** Côté administrateur : empreinte de la ligne d'abonnement publiée pour chaque compte. */
  abonnements: 'applibourse.synchro.abonnements',
  /** Côté ami : préfixe de la ligne d'abonnement reçue (suivie du compte). */
  abonnementRecu: 'applibourse.abonnement.',
} as const;

// ------------------------------------------------------------ Mémoire

function lireJson<T>(memoire: Memoire, cle: string, defaut: T): T {
  try {
    const brut = memoire.getItem(cle);
    return brut ? (JSON.parse(brut) as T) : defaut;
  } catch {
    return defaut;
  }
}

function ecrireJson(memoire: Memoire, cle: string, valeur: unknown): void {
  try {
    memoire.setItem(cle, JSON.stringify(valeur));
  } catch {
    // Stockage plein ou interdit : le prochain tour refera le travail.
  }
}

export interface Liaisons {
  maitre?: string;
  comptes: Record<string, string>;
}

export function lireLiaisons(memoire: Memoire): Liaisons {
  const lu = lireJson<Partial<Liaisons>>(memoire, CLES_MEMOIRE.liaisons, {});
  const liaisons: Liaisons = { comptes: {} };
  if (typeof lu.maitre === 'string' && decoderLiaison(lu.maitre) && estMaitre(decoderLiaison(lu.maitre)!)) liaisons.maitre = lu.maitre;
  for (const [id, code] of Object.entries(lu.comptes ?? {})) {
    const liaison = typeof code === 'string' ? decoderLiaison(code) : undefined;
    if (liaison && compteDeLiaison(liaison) === id) liaisons.comptes[id] = code;
  }
  // Liaison d'avant (code de l'administrateur, lien #liaison= du PC).
  if (!liaisons.maitre) {
    try {
      const ancien = memoire.getItem(CLES_MEMOIRE.liaisonHistorique);
      const liaison = ancien ? decoderLiaison(ancien) : undefined;
      if (liaison && estMaitre(liaison)) liaisons.maitre = encoderLiaison(liaison);
    } catch {
      // Rien.
    }
  }
  return liaisons;
}

/** Retient un code de liaison sur ce navigateur (celui de l'administrateur, ou celui d'un ami pour SON compte). */
export function retenirLiaison(memoire: Memoire, liaison: Liaison): void {
  const liaisons = lireLiaisons(memoire);
  const id = compteDeLiaison(liaison);
  if (id) {
    liaisons.comptes[id] = encoderLiaison(liaison);
  } else {
    liaisons.maitre = encoderLiaison(liaison);
    try {
      memoire.setItem(CLES_MEMOIRE.liaisonHistorique, liaisons.maitre);
    } catch {
      // Rien.
    }
  }
  ecrireJson(memoire, CLES_MEMOIRE.liaisons, liaisons);
}

/** Liaison qui ouvre l'espace de `id` sur ce navigateur (celle de l'administrateur, ou celle de ce compte). */
export function liaisonPourCompte(memoire: Memoire, id: string, pontMaitre?: Liaison): Liaison | undefined {
  const liaisons = lireLiaisons(memoire);
  const candidates = [
    liaisons.maitre ? decoderLiaison(liaisons.maitre) : undefined,
    pontMaitre,
    id !== ID_PRINCIPAL && liaisons.comptes[id] ? decoderLiaison(liaisons.comptes[id]) : undefined,
  ];
  return candidates.find((l): l is Liaison => Boolean(l) && (id === ID_PRINCIPAL ? estMaitre(l!) : peutOuvrirEspace(l!, id)));
}

/** Oublie tout le suivi de synchronisation des comptes (remplacement des données du navigateur). */
export function oublierSuivi(memoire: Memoire): void {
  for (const cle of [CLES_MEMOIRE.annuaire, CLES_MEMOIRE.admin, CLES_MEMOIRE.fichiers, CLES_MEMOIRE.comptes, CLES_MEMOIRE.coffreRelie, CLES_MEMOIRE.tsuzuku, CLES_MEMOIRE.tsuzukuRecu, CLES_MEMOIRE.abonnements]) {
    try {
      memoire.removeItem(cle);
    } catch {
      // Rien.
    }
  }
}

interface SuiviCompte {
  /** Empreinte de la projection déposée. */
  projection?: string;
  /** Date de la projection lue (côté ami). */
  projectionLue?: string;
  /** Date du retour de l'ami lu (côté administrateur). */
  retourLu?: string;
  /** Empreinte du retour déposé (côté ami). */
  retour?: string;
  /** Date de la ligne d'abonnement lue (côté ami). */
  abonnementLu?: string;
  /** Côté Fondateur : empreintes des actions d'un titulaire déjà reprises au journal. */
  journalVus?: string[];
}

// ------------------------------------------------------------- Annuaire

const decodeur = new TextDecoder();
const encodeur = new TextEncoder();

export async function lireAnnuaireFichier(fichiers: Fichiers): Promise<Annuaire> {
  const brut = await fichiers.lire('profils');
  return lireAnnuaire(brut && brut.length > 0 ? decodeur.decode(brut) : undefined);
}

/** Document d'annuaire lu dans un espace (celui de l'administrateur, ou la projection d'un ami). */
async function lireDocument(espaces: Espaces, id: string, nom: string): Promise<{ date: string; brut: unknown } | undefined> {
  const objet = await espaces.lire(id, nom);
  if (!objet) return undefined;
  try {
    return { date: objet.date, brut: JSON.parse(objet.charge) as unknown };
  } catch {
    throw new ErreurRelais(`Dépôt illisible sur le relais (${nom}).`);
  }
}

export interface BilanComptes {
  /** L'annuaire d'ici a changé (comptes ajoutés, modifiés, retirés ailleurs). */
  annuaireChange: boolean;
  /** Les données d'administration d'ici ont changé. */
  donneesChangent: boolean;
  /** Côté ami : sa ligne d'abonnement a changé. */
  abonnementChange?: boolean;
  fichiersRecus: number;
  depots: number;
  erreurs: string[];
  /** Tsuzuku : la copie des sources partagées de ce compte a changé. */
  tsuzukuChange?: boolean;
}

const bilanVide = (): BilanComptes => ({ annuaireChange: false, donneesChangent: false, fichiersRecus: 0, depots: 0, erreurs: [] });

export interface OptionsAnnuaireAdmin {
  liaison: Liaison;
  memoire: Memoire;
  lire(): Promise<Annuaire>;
  ecrire(annuaire: Annuaire): Promise<void>;
  /** Clés de l'administrateur déverrouillé (réunion des blocs privés), à effacer après usage. */
  cles?: () => ClesAdmin;
  maintenant?: () => Date;
  requete?: Fetch;
  /** Liste de l'espace de l'administrateur, si elle vient d'être lue. */
  objets?: Record<string, { date: string }>;
}

/**
 * Annuaire seul, dans les deux sens (administrateur, avant ou après
 * déverrouillage). Rend l'annuaire à jour et s'il a changé ici.
 */
export async function synchroniserAnnuaire(o: OptionsAnnuaireAdmin): Promise<{ annuaire: Annuaire; change: boolean; depose: boolean; retires: string[] }> {
  if (!estMaitre(o.liaison)) {
    throw new ErreurRelais('Seul l’administrateur synchronise l’annuaire.');
  }
  const espaces = espacesDuRelais(o.liaison, o.requete);
  const maintenant = (o.maintenant ?? (() => new Date()))().toISOString();
  const local = await o.lire();
  if (local.heritage || local.restreint) {
    return { annuaire: local, change: false, depose: false, retires: [] };
  }
  const etat = lireEtatLww(o.memoire.getItem(CLES_MEMOIRE.annuaire));
  const objets = o.objets ?? (await espaces.lister(ESPACE_ADMIN));
  const dateDistante = objets.annuaire?.date;
  const document = dateDistante ? await lireDocument(espaces, ESPACE_ADMIN, 'annuaire') : undefined;
  const distant = document ? lireDocumentLww(document.brut) : undefined;
  const cles = o.cles?.();
  let fusion;
  try {
    fusion = fusionnerAnnuaire(local, etat, distant, maintenant, cles);
  } finally {
    if (cles) {
      cles.annuaire.fill(0);
      cles.sequestre.fill(0);
    }
  }
  if (fusion.changeIci) {
    await o.ecrire(fusion.annuaire);
  }
  let depose = false;
  let etatSuivant: EtatLww = fusion.etat;
  if (fusion.aPublier) {
    const date = dateDistante && dateDistante >= maintenant ? new Date(Date.parse(dateDistante) + 1).toISOString() : maintenant;
    await espaces.deposer(ESPACE_ADMIN, 'annuaire', JSON.stringify(fusion.document), date);
    depose = true;
    etatSuivant = { ...etatSuivant, distantLu: date };
  } else if (document) {
    etatSuivant = { ...etatSuivant, distantLu: document.date };
  }
  ecrireJson(o.memoire, CLES_MEMOIRE.annuaire, etatSuivant);
  return { annuaire: fusion.changeIci ? fusion.annuaire : local, change: fusion.changeIci, depose, retires: fusion.comptesRetires };
}

export interface OptionsSynchroAdmin extends Omit<OptionsAnnuaireAdmin, 'objets'> {
  fichiers: Fichiers;
  /** Données d'administration (`admin.donnees` de la base de l'administrateur). */
  donnees?: { lire(): string | undefined; ecrire(valeur: string): void; cleSynchro: string };
  /** Efface les fichiers d'un compte supprimé ailleurs. */
  effacerFichiers(id: string): Promise<void>;
  /** Tsuzuku : base du compte historique (ses sources et leurs partages), pour publier les sources partagées. */
  tsuzuku?: { base: Pick<BasePrefs, 'lire'> };
}

/**
 * Un tour complet pour l'administrateur déverrouillé : retours des amis,
 * annuaire, projections et fichiers de chaque ami, données d'administration.
 */
export async function synchroniserComptesAdmin(o: OptionsSynchroAdmin): Promise<BilanComptes> {
  const bilan = bilanVide();
  const espaces = espacesDuRelais(o.liaison, o.requete);
  const horloge = o.maintenant ?? (() => new Date());
  const maintenant = horloge().toISOString();
  const suivis = lireJson<Record<string, SuiviCompte>>(o.memoire, CLES_MEMOIRE.comptes, {});

  // 1. Ce que les amis ont renvoyé depuis leurs appareils (avant la fusion : cela part avec elle).
  let local = await o.lire();
  const listes = new Map<string, Record<string, { date: string }>>();
  if (!local.heritage && !local.restreint) {
    let modifie = local;
    for (const compte of local.comptes) {
      try {
        const objets = await espaces.lister(compte.id);
        listes.set(compte.id, objets);
        const date = objets.compte?.date;
        if (date && date > (suivis[compte.id]?.retourLu ?? '')) {
          const recu = await lireDocument(espaces, compte.id, 'compte');
          let journalVus = suivis[compte.id]?.journalVus ?? [];
          if (recu && recu.brut && typeof recu.brut === 'object') {
            const retour = { ...(recu.brut as RetourAmi) };
            // Actions d'un titulaire : chacune n'est reprise qu'une fois (son retour les garde toutes).
            if (Array.isArray(retour.journal)) {
              const vus = new Set(journalVus);
              retour.journal = retour.journal.filter(e => typeof e === 'string' && !vus.has(empreinte(e)));
              journalVus = [...journalVus, ...retour.journal.map(e => empreinte(e))].slice(-1000);
            }
            modifie = appliquerRetourAmi(modifie, compte.id, retour);
          }
          suivis[compte.id] = { ...suivis[compte.id], retourLu: date, ...(journalVus.length > 0 ? { journalVus } : {}) };
        }
      } catch (erreur) {
        bilan.erreurs.push(erreur instanceof Error ? erreur.message : String(erreur));
      }
    }
    if (modifie !== local && empreinte(modifie) !== empreinte(local)) {
      await o.ecrire(modifie);
      local = modifie;
      bilan.annuaireChange = true;
    }
  }

  // 2. L'annuaire, dans les deux sens.
  const objetsAdmin = await espaces.lister(ESPACE_ADMIN);
  const annuaire = await synchroniserAnnuaire({ ...o, objets: objetsAdmin, lire: async () => local });
  bilan.annuaireChange ||= annuaire.change;
  if (annuaire.depose) bilan.depots++;
  for (const id of annuaire.retires) {
    await o.effacerFichiers(id).catch(() => undefined);
  }

  // 3. Chaque ami : sa projection, ses fichiers.
  let etatFichiers = lireJson<EtatFichiers>(o.memoire, CLES_MEMOIRE.fichiers, {});
  const objetsParCompte = new Map<string, Record<string, { date: string }>>();
  const presents = new Set(annuaire.annuaire.comptes.map(c => c.id));
  for (const compte of annuaire.annuaire.comptes) {
    try {
      // Un titulaire reçoit aussi les comptes inférieurs (Administration sur le site) ; un ami, son entrée seule.
      const projection = projectionTitulaire(annuaire.annuaire, compte.id);
      const h = projection ? empreinte(projection) : undefined;
      if (projection && h !== suivis[compte.id]?.projection) {
        await espaces.deposer(compte.id, 'annuaire', JSON.stringify(projection), horloge().toISOString());
        suivis[compte.id] = { ...suivis[compte.id], projection: h };
        bilan.depots++;
      }
      const objets = listes.get(compte.id) ?? (await espaces.lister(compte.id));
      objetsParCompte.set(compte.id, objets);
      const noms = fichiersDuProfil(compte.id);
      for (const objet of ['coffre', 'portefeuille'] as const) {
        const issue = await synchroniserFichier({
          espaces,
          compte: compte.id,
          objet,
          fichier: noms[objet],
          stockage: o.fichiers,
          etat: etatFichiers,
          maintenant: horloge().toISOString(),
          dateDistante: objets[objet]?.date ?? null,
        });
        etatFichiers = issue.etat;
        if (issue.recu) bilan.fichiersRecus++;
        if (issue.envoye) bilan.depots++;
      }
    } catch (erreur) {
      bilan.erreurs.push(erreur instanceof Error ? erreur.message : String(erreur));
    }
  }
  // Comptes supprimés : leur espace est vidé (un ancien code d'ami ne lit plus rien).
  for (const id of Object.keys(suivis)) {
    if (presents.has(id)) continue;
    try {
      for (const nom of ['annuaire', 'coffre', 'portefeuille', 'compte', 'abonnement', ...OBJETS_TSUZUKU]) {
        await espaces.supprimer(id, nom);
      }
      delete suivis[id];
      const noms = fichiersDuProfil(id);
      delete etatFichiers[noms.coffre];
      delete etatFichiers[noms.portefeuille];
    } catch (erreur) {
      bilan.erreurs.push(erreur instanceof Error ? erreur.message : String(erreur));
    }
  }
  ecrireJson(o.memoire, CLES_MEMOIRE.fichiers, etatFichiers);
  ecrireJson(o.memoire, CLES_MEMOIRE.comptes, suivis);

  // 3 ter. Tsuzuku : chaque compte reçoit SES sources partagées, scellées pour sa clé.
  if (o.tsuzuku) {
    try {
      const resultat = await publierSourcesPartagees({
        espaces,
        comptes: annuaire.annuaire.comptes.map(c => ({ id: c.id, apps: c.acces.apps, actif: c.acces.actif })),
        base: o.tsuzuku.base,
        etat: lireJson<EtatPublications>(o.memoire, CLES_MEMOIRE.tsuzuku, {}),
        maintenant: horloge().toISOString(),
        objets: async id => objetsParCompte.get(id) ?? (await espaces.lister(id)),
      });
      ecrireJson(o.memoire, CLES_MEMOIRE.tsuzuku, resultat.etat);
      bilan.depots += resultat.depots;
      bilan.erreurs.push(...resultat.erreurs);
    } catch (erreur) {
      bilan.erreurs.push(erreur instanceof Error ? erreur.message : String(erreur));
    }
  }

  // 3 bis. Délégations des titulaires : le coffre et le portefeuille des comptes de rang inférieur.
  try {
    const delegations = delegationsDe(annuaire.annuaire);
    const h = empreinte(delegations);
    const publiee = lireJson<string | undefined>(o.memoire, CLES_MEMOIRE.delegations, undefined);
    // Rien à publier tant qu'aucun titulaire n'existe (relais pas encore redéployé : aucune erreur).
    if (h !== publiee && (publiee !== undefined || Object.keys(delegations).length > 0)) {
      await publierDelegations(o.liaison, delegations, o.requete);
      ecrireJson(o.memoire, CLES_MEMOIRE.delegations, h);
      bilan.depots++;
    }
  } catch (erreur) {
    bilan.erreurs.push(erreur instanceof Error ? erreur.message : String(erreur));
  }

  // 4. Données d'administration (scellées par la clé de synchronisation).
  if (o.donnees) {
    try {
      const brut = o.donnees.lire();
      const locales = lireDonnees(brut);
      const entites = entitesDonnees(locales);
      const fusions = fusionsDonnees(locales.reglages, Date.parse(maintenant));
      const etat = noterLocal(lireEtatLww(o.memoire.getItem(CLES_MEMOIRE.admin)), entites, maintenant, fusions);
      const dateDistante = objetsAdmin.admin?.date;
      let distant;
      if (dateDistante) {
        const objet = await espaces.lire(ESPACE_ADMIN, 'admin');
        if (objet) {
          distant = lireDocumentLww(ouvrirEnveloppe<unknown>(o.donnees.cleSynchro, JSON.parse(objet.charge) as Enveloppe));
        }
      }
      const resultat = fusionner(entites, etat, distant, fusions);
      if (resultat.changeIci) {
        const texte = ecrireDonnees(donneesDepuisEntites(resultat.entites, Date.parse(maintenant)));
        if (texte !== brut) {
          o.donnees.ecrire(texte);
          bilan.donneesChangent = true;
        }
      }
      if (resultat.aPublier) {
        const date = dateDistante && dateDistante >= maintenant ? new Date(Date.parse(dateDistante) + 1).toISOString() : maintenant;
        await espaces.deposer(ESPACE_ADMIN, 'admin', JSON.stringify(sceller(o.donnees.cleSynchro, resultat.document, 'admin', date)), date);
        bilan.depots++;
      }
      ecrireJson(o.memoire, CLES_MEMOIRE.admin, resultat.etat);
    } catch (erreur) {
      bilan.erreurs.push(erreur instanceof Error ? erreur.message : String(erreur));
    }
    // 4 bis. Abonnements : chaque compte reçoit SA ligne seulement (mode, échéance, message), dans son espace.
    try {
      const finales = lireDonnees(o.donnees.lire());
      const publiees = lireJson<Record<string, string>>(o.memoire, CLES_MEMOIRE.abonnements, {});
      for (const compte of annuaire.annuaire.comptes) {
        const projection = projectionPour(finales.abonnements, compte.id);
        const h = empreinte(projection);
        // Rien n'est publié pour un compte jamais suivi : l'espace d'un ami reste tel qu'avant.
        if (!finales.abonnements.comptes[compte.id] && publiees[compte.id] === undefined) continue;
        if (publiees[compte.id] === h) continue;
        try {
          await espaces.deposer(compte.id, 'abonnement', JSON.stringify(projection), horloge().toISOString());
          publiees[compte.id] = h;
          bilan.depots++;
        } catch (erreur) {
          bilan.erreurs.push(erreur instanceof Error ? erreur.message : String(erreur));
        }
      }
      for (const id of Object.keys(publiees)) {
        if (!presents.has(id)) delete publiees[id];
      }
      ecrireJson(o.memoire, CLES_MEMOIRE.abonnements, publiees);
    } catch (erreur) {
      bilan.erreurs.push(erreur instanceof Error ? erreur.message : String(erreur));
    }
  }
  return bilan;
}

/**
 * Délégations à publier : pour chaque Administrateur ou Fondateur (autre que
 * le compte historique) qui a une paire, les comptes de rang strictement
 * inférieur. Jamais un compte de rang égal ou supérieur.
 */
export function delegationsDe(annuaire: Annuaire): Record<string, string[]> {
  const delegations: Record<string, string[]> = {};
  for (const t of annuaire.comptes) {
    const rang = t.acces.role;
    if ((rang !== 'administrateur' && rang !== 'fondateur') || !t.titulaire?.cle) continue;
    const ids = annuaire.comptes.filter(c => c.id !== t.id && NIVEAU_RANG[c.acces.role ?? 'ami'] < NIVEAU_RANG[rang]).map(c => c.id).sort();
    if (ids.length > 0) delegations[t.id] = ids;
  }
  return delegations;
}

// ------------------------------------------------------------ Côté ami

export interface OptionsSynchroAmi {
  liaison: Liaison;
  /** Le compte ouvert : un ami. */
  id: string;
  memoire: Memoire;
  fichiers: Fichiers;
  lire(): Promise<Annuaire>;
  ecrire(annuaire: Annuaire): Promise<void>;
  maintenant?: () => Date;
  requete?: Fetch;
  /** Tsuzuku : base chiffrée du compte ouvert, où ranger les sources qui lui sont partagées. */
  tsuzuku?: { base: BasePrefs };
}

/**
 * Un tour pour un ami dont le compte est OUVERT ici : ses fichiers partent
 * (jamais écrasés pendant la session), sa projection arrive (accès modifiés
 * par l'administrateur), et ce qu'il a fait ici (suivi, séquestre) repart
 * vers l'administrateur. Uniquement son espace.
 */
export async function synchroniserCompteAmi(o: OptionsSynchroAmi): Promise<BilanComptes> {
  const bilan = bilanVide();
  if (!peutOuvrirEspace(o.liaison, o.id) || o.id === ID_PRINCIPAL) {
    return bilan;
  }
  const espaces = espacesDuRelais(o.liaison, o.requete);
  const horloge = o.maintenant ?? (() => new Date());
  const suivis = lireJson<Record<string, SuiviCompte>>(o.memoire, CLES_MEMOIRE.comptes, {});
  const suivi = { ...suivis[o.id] };
  const objets = await espaces.lister(o.id);

  let local = await o.lire();
  // La projection ne remplace que l'annuaire RESTREINT d'un navigateur d'ami (jamais celui du PC).
  if (local.restreint || local.comptes.length === 0) {
    const date = objets.annuaire?.date;
    if (date && date > (suivi.projectionLue ?? '')) {
      const recu = await lireDocument(espaces, o.id, 'annuaire');
      if (recu) {
        const suivant = recevoirProjection(local, lireAnnuaire(JSON.stringify(recu.brut)), o.id);
        if (empreinte(suivant) !== empreinte(local)) {
          await o.ecrire(suivant);
          local = suivant;
          bilan.annuaireChange = true;
        }
      }
      suivi.projectionLue = date;
    }
    const retour = retourAmi(local, o.id);
    const h = retour ? empreinte(retour) : undefined;
    if (retour && h !== suivi.retour) {
      await espaces.deposer(o.id, 'compte', JSON.stringify(retour), horloge().toISOString());
      suivi.retour = h;
      bilan.depots++;
    }
  }

  // Tsuzuku : sa clé de réception part, ses sources partagées arrivent (lecture seule).
  if (o.tsuzuku) {
    try {
      const suivis = lireJson<Record<string, SuiviReception>>(o.memoire, CLES_MEMOIRE.tsuzukuRecu, {});
      const r = await recevoirSourcesPartagees({ espaces, id: o.id, base: o.tsuzuku.base, objets, suivi: suivis[o.id] ?? {}, maintenant: horloge().toISOString() });
      ecrireJson(o.memoire, CLES_MEMOIRE.tsuzukuRecu, { ...suivis, [o.id]: r.suivi });
      bilan.depots += r.depots;
      if (r.change) bilan.tsuzukuChange = true;
    } catch (erreur) {
      bilan.erreurs.push(erreur instanceof Error ? erreur.message : String(erreur));
    }
  }

  // Sa ligne d'abonnement (mode + échéance + message de rappel) : lecture seule, dans son seul espace.
  try {
    const dateAbo = objets.abonnement?.date;
    if (dateAbo && dateAbo > (suivi.abonnementLu ?? '')) {
      const recu = await lireDocument(espaces, o.id, 'abonnement');
      const projection = lireProjection(recu?.brut);
      if (projection) {
        o.memoire.setItem(CLES_MEMOIRE.abonnementRecu + o.id, JSON.stringify(projection));
        bilan.abonnementChange = true;
      }
      suivi.abonnementLu = dateAbo;
    } else if (!dateAbo && o.memoire.getItem(CLES_MEMOIRE.abonnementRecu + o.id)) {
      o.memoire.removeItem(CLES_MEMOIRE.abonnementRecu + o.id);
      bilan.abonnementChange = true;
    }
  } catch (erreur) {
    bilan.erreurs.push(erreur instanceof Error ? erreur.message : String(erreur));
  }

  let etatFichiers = lireJson<EtatFichiers>(o.memoire, CLES_MEMOIRE.fichiers, {});
  const noms = fichiersDuProfil(o.id);
  for (const objet of ['coffre', 'portefeuille'] as const) {
    const issue = await synchroniserFichier({
      espaces,
      compte: o.id,
      objet,
      fichier: noms[objet],
      stockage: o.fichiers,
      etat: etatFichiers,
      maintenant: horloge().toISOString(),
      dateDistante: objets[objet]?.date ?? null,
      tirer: false,
    });
    etatFichiers = issue.etat;
    if (issue.envoye) bilan.depots++;
  }
  // Titulaire sur ce navigateur : les comptes inférieurs qu'il a ouverts ici (séquestre) repartent,
  // et reviennent s'ils ont changé ailleurs. Par délégation, seulement coffre et portefeuille.
  if (local.restreint && local.proprietaire === o.id && local.comptes.length > 1) {
    for (const compte of local.comptes) {
      if (compte.id === o.id) continue;
      const nomsCompte = fichiersDuProfil(compte.id);
      const present = await o.fichiers.lire(nomsCompte.coffre);
      if (!present || present.length === 0) continue;
      try {
        const objetsCompte = await espaces.lister(compte.id);
        for (const objet of ['coffre', 'portefeuille'] as const) {
          const issue = await synchroniserFichier({
            espaces,
            compte: compte.id,
            objet,
            fichier: nomsCompte[objet],
            stockage: o.fichiers,
            etat: etatFichiers,
            maintenant: horloge().toISOString(),
            dateDistante: objetsCompte[objet]?.date ?? null,
          });
          etatFichiers = issue.etat;
          if (issue.envoye) bilan.depots++;
          if (issue.recu) bilan.fichiersRecus++;
        }
      } catch (erreur) {
        bilan.erreurs.push(erreur instanceof Error ? erreur.message : String(erreur));
      }
    }
  }
  ecrireJson(o.memoire, CLES_MEMOIRE.fichiers, etatFichiers);
  ecrireJson(o.memoire, CLES_MEMOIRE.comptes, { ...suivis, [o.id]: suivi });
  return bilan;
}

// ------------------------------------------------ Avant l'ouverture d'un compte

export interface OptionsAvantOuverture {
  memoire: Memoire;
  fichiers: Fichiers;
  /** Compte trouvé par le prénom, ou `undefined` pour le leurre. */
  compte?: string;
  /** Liaison de l'administrateur connue par le processus principal (PC), le cas échéant. */
  pontMaitre?: Liaison;
  /** Liaison à employer (titulaire qui ouvre un compte inférieur par délégation). */
  liaison?: Liaison;
  maintenant?: () => Date;
  requete?: Fetch;
}

/**
 * Juste après le prénom : récupère le coffre (et, pour un ami, le
 * portefeuille) de CE compte seulement, s'il est plus récent sur le relais.
 *
 * Le leurre fait le même appel qu'un vrai compte (la liste d'un espace qui
 * existe : celui de l'administrateur, ou celui de l'ami relié ici) : même
 * durée, même réponse, aucune erreur 404 qui trahirait un prénom inconnu.
 * Rend `true` quand le coffre vient d'arriver du relais.
 */
export async function avantOuverture(o: OptionsAvantOuverture): Promise<boolean> {
  const liaisons = lireLiaisons(o.memoire);
  const maitre = liaisons.maitre ? decoderLiaison(liaisons.maitre) : o.pontMaitre;
  const propres = Object.keys(liaisons.comptes);
  if (o.compte === undefined) {
    // Leurre : même appel qu'une ouverture ordinaire sur ce navigateur.
    const liaison = maitre ?? (propres[0] ? decoderLiaison(liaisons.comptes[propres[0]]) : undefined);
    if (liaison) {
      await espacesDuRelais(liaison, o.requete).lister(maitre ? ESPACE_ADMIN : propres[0]).catch(() => undefined);
    }
    return false;
  }
  const liaison = o.liaison ?? liaisonPourCompte(o.memoire, o.compte, o.pontMaitre);
  if (!liaison) {
    return false;
  }
  const espaces = espacesDuRelais(liaison, o.requete);
  if (o.compte === ID_PRINCIPAL) {
    await espaces.lister(ESPACE_ADMIN).catch(() => undefined);
    // L'administrateur : son coffre n'arrive que sur un navigateur qui n'en a pas encore.
    const present = await o.fichiers.lire('coffre');
    if (present && present.length > 0) {
      return false;
    }
    const coffre = await recupererCoffre(liaison, o.requete);
    const octets = encodeur.encode(JSON.stringify(coffre));
    await o.fichiers.ecrire('coffre', octets);
    ecrireJson(o.memoire, CLES_MEMOIRE.coffreRelie, empreinte(JSON.stringify(coffre)));
    return true;
  }
  const objets = await espaces.lister(o.compte);
  let etatFichiers = lireJson<EtatFichiers>(o.memoire, CLES_MEMOIRE.fichiers, {});
  const noms = fichiersDuProfil(o.compte);
  let coffreRecu = false;
  for (const objet of ['coffre', 'portefeuille'] as const) {
    const issue = await synchroniserFichier({
      espaces,
      compte: o.compte,
      objet,
      fichier: noms[objet],
      stockage: o.fichiers,
      etat: etatFichiers,
      maintenant: (o.maintenant ?? (() => new Date()))().toISOString(),
      dateDistante: objets[objet]?.date ?? null,
      pousser: false,
    });
    etatFichiers = issue.etat;
    if (objet === 'coffre' && issue.recu) coffreRecu = true;
  }
  ecrireJson(o.memoire, CLES_MEMOIRE.fichiers, etatFichiers);
  return coffreRecu;
}

/**
 * Le coffre de l'administrateur de ce navigateur est-il « un autre » que
 * celui du compte relié ? Vrai quand un code de l'administrateur est connu
 * mais que le coffre d'ici n'est jamais venu du relais (créé ici autrefois).
 */
export async function coffreAdminEtranger(memoire: Memoire, fichiers: Fichiers): Promise<boolean> {
  if (!lireLiaisons(memoire).maitre) return false;
  const present = await fichiers.lire('coffre');
  if (!present || present.length === 0) return false;
  let relie: string | undefined;
  try {
    relie = JSON.parse(memoire.getItem(CLES_MEMOIRE.coffreRelie) ?? 'null') ?? undefined;
  } catch {
    relie = undefined;
  }
  return relie !== empreinte(decodeur.decode(present));
}

// ----------------------------------------------------------------- Relier

export interface CompteRelie {
  liaison: Liaison;
  /** Annuaire à installer sur ce navigateur (complet pour l'administrateur, restreint pour un ami). */
  annuaire: Annuaire;
  /** Compte d'ami auquel le code est réservé, sinon l'administrateur. */
  compte?: string;
}

/**
 * Lit ce qu'il faut pour relier ce navigateur à un compte existant : vérifie
 * le code auprès du relais, puis récupère l'annuaire (administrateur) ou la
 * projection (ami). Rien n'est écrit ici.
 */
export async function preparerLiaison(code: string, requete?: Fetch): Promise<CompteRelie> {
  const liaison = decoderLiaison(code);
  if (!liaison) {
    throw new Error('Code de liaison illisible : il commence par AB1. (copiez-le depuis le PC, ou demandez-le à l’administrateur).');
  }
  const espaces = espacesDuRelais(liaison, requete);
  const compte = compteDeLiaison(liaison);
  if (compte) {
    const recu = await lireDocument(espaces, compte, 'annuaire');
    if (!recu) {
      throw new ErreurRelais(
        'Votre compte n’est pas encore publié sur le relais : demandez à l’administrateur d’ouvrir AppDashboard sur son PC (déverrouillé), puis réessayez dans deux minutes.',
        404,
      );
    }
    const annuaire = recevoirProjection(undefined, lireAnnuaire(JSON.stringify(recu.brut)), compte);
    if (!annuaire.comptes.some(c => c.id === compte)) {
      throw new ErreurRelais('Le compte publié sur le relais est illisible.');
    }
    return { liaison, annuaire, compte };
  }
  const recu = await lireDocument(espaces, ESPACE_ADMIN, 'annuaire');
  if (recu) {
    const document = lireDocumentLww(recu.brut);
    return { liaison, annuaire: annuaireDepuisEntites(document?.entites ?? {}) };
  }
  // PC d'une version antérieure : pas d'annuaire publié, mais son coffre l'est peut-être.
  await recupererCoffre(liaison, requete);
  return { liaison, annuaire: lireAnnuaire(undefined) };
}

/** Ligne d'abonnement de CE compte, telle que reçue du relais (rien sans suivi ni avant la première synchronisation). */
export function lireAbonnementAmi(memoire: Memoire, id: string): ProjectionAbo | undefined {
  try {
    const brut = memoire.getItem(CLES_MEMOIRE.abonnementRecu + id);
    return brut ? lireProjection(JSON.parse(brut)) : undefined;
  } catch {
    return undefined;
  }
}

export { encodeur as encodeurTexte };
