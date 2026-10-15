/**
 * Annuaire des comptes (format 3 de la liste des profils).
 *
 * Ce fichier doit être lisible **avant** tout déverrouillage — c'est lui qui
 * dit quel coffre ouvrir — et c'est le seul que tous les profils partagent.
 * Il ne contient donc que le strict nécessaire, et rien qui liste ou nomme
 * les autres comptes :
 *
 *  - pour chaque compte : un identifiant opaque, l'**empreinte salée** de son
 *    prénom (on retrouve un compte quand on connaît son prénom, on ne peut
 *    pas lister les prénoms), son prénom scellé par une clé tirée du prénom
 *    lui-même, ses règles d'accès (apps, activation, dates : il faut les
 *    appliquer avant que l'administrateur ne soit là), l'état de son
 *    séquestre, et son suivi de connexion **scellé pour l'administrateur** ;
 *  - la clé **publique** de séquestre de l'administrateur, et sa clé privée
 *    scellée par une clé tirée de SA clé maîtresse ;
 *  - un bloc `prive` scellé pour l'administrateur : prénoms en clair, dates
 *    de création, codes d'accès administrateur.
 *
 * Les formats 1 et 2 (liste en clair) se lisent encore (`heritage`) ; la
 * migration se fait à la première ouverture de l'administrateur, seul à
 * pouvoir sceller le bloc privé. Schéma complet : `docs/hub/sequestre.md`.
 */

import { lireDocsJuridiques, type DocsJuridiques } from '../juridique/modele';
import { ecrirePolitique, lirePolitique, type PolitiqueHub } from '../hub/admin/politique';
import type { NiveauAcces } from '../hub/admin/niveaux';
import {
  ErreurSequestre,
  bytesToHex,
  cleDuNom,
  cleEnveloppeAcces,
  descellerAvecContexte,
  descellerTexte,
  empreinteNom,
  genererCodeAcces,
  genererPaireSequestre,
  normaliserCode,
  normaliserNom,
  ouvrirDepot,
  publiqueDepuisPrivee,
  scellerAvecContexte,
  scellerPourAdmin,
  scellerTexte,
  utf8DepuisOctets,
} from '../securite/sequestre';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { aleatoireParDefaut, type SourceAleatoire } from '../securite/aleatoire';
import { usageSequestre } from '../session/session';
import { lireEvenement, type EvenementAudit } from '../hub/admin/journal';
import { ID_PRINCIPAL, lireProfils, nettoyerApps, nettoyerNiveaux, roleEnregistre, type EtatSequestre, type Profil } from './profils';

export const VERSION_ANNUAIRE = 3;
const MOTIF_ID = /^[a-z0-9]{6,16}$/;
const MOTIF_HEXA = /^[0-9a-f]+$/;
const MOTIF_DEPOT = /^[0-9a-f]{64}\.[0-9a-f]+$/;

/** Ce qu'il faut appliquer à l'ouverture d'un compte, sans l'administrateur. */
export interface AccesPublic {
  apps: string[];
  actif: boolean;
  niveaux?: Record<string, NiveauAcces>;
  invitationExpireLe?: string;
  expireLe?: string;
  desactiveJusquau?: string;
  /**
   * Rang (absent : ami). Comme le reste de `acces`, il n'est pas protégé en
   * intégrité : les Fondateurs tiennent à part un REGISTRE scellé des
   * Administrateurs et Fondateurs, seul pris en compte pour sceller une clé
   * (voir `rangs.ts` et « Rangs » dans `docs/hub/sequestre.md`).
   */
  role?: 'gestionnaire' | 'administrateur' | 'fondateur';
}

export interface SequestreCompte {
  etat: Exclude<EtatSequestre, 'absent'>;
  /** Clé maîtresse de l'ami, scellée pour la clé publique de l'administrateur (en attente de conversion). */
  depot?: string;
  /** Clé maîtresse de l'ami, enveloppée par (clé privée de séquestre + code d'accès). */
  enveloppe?: string;
}

export interface EntreeCompte {
  id: string;
  empreinte: string;
  /** Prénom scellé par la clé tirée du prénom. */
  nom: string;
  acces: AccesPublic;
  sequestre: SequestreCompte;
  /**
   * Séquestres de ce compte pour les titulaires AUTRES que le compte
   * historique (Administrateurs, Fondateurs), par identifiant de titulaire.
   * `sequestre` reste celui du compte historique (compatibilité).
   */
  sequestres?: Record<string, SequestreCompte>;
  /** Administrateur ou Fondateur : sa paire de séquestre et son bloc privé (voir `rangs.ts`). */
  titulaire?: PaireTitulaire;
  /** Dernière connexion et compteur, scellés pour l'administrateur. */
  suivi?: string;
  /**
   * Compte créé par un gestionnaire : prénom, date et créateur, scellés pour
   * l'administrateur (le gestionnaire ne peut pas écrire son bloc privé). Lu
   * puis effacé à sa prochaine ouverture.
   */
  creation?: string;
}

/** Paire de séquestre d'un titulaire autre que le compte historique. */
export interface PaireTitulaire {
  /** Clé publique X25519 (hexadécimal). */
  cle?: string;
  /** Clé privée, scellée par une clé tirée de la clé maîtresse du titulaire. */
  privee?: string;
  /** Bloc privé du titulaire (prénoms des comptes qu'il tient, ses codes d'accès), scellé par sa clé. */
  prive?: string;
}

/** Ce que partagent les Fondateurs : une clé commune (déposée pour chacun) et le registre des titulaires. */
export interface BlocFondateurs {
  /** Par Fondateur : la clé commune, scellée pour sa clé publique de séquestre. */
  partage: Record<string, string>;
  /** Par titulaire : { rang, clé publique confirmée }, scellé par la clé commune. */
  registre: Record<string, string>;
}

export interface Annuaire {
  v: typeof VERSION_ANNUAIRE;
  /** Sel des empreintes de prénoms (hexadécimal). */
  sel: string;
  admin: {
    empreinte?: string;
    nom?: string;
    /** Clé publique X25519 de séquestre (hexadécimal). */
    cleSequestre?: string;
    /** Clé privée de séquestre, scellée par une clé tirée de la clé maîtresse de l'administrateur. */
    priveeScellee?: string;
    derniereConnexion?: string;
  };
  politique?: PolitiqueHub;
  comptes: EntreeCompte[];
  /**
   * Actions des gestionnaires en attente, scellées une à une pour
   * l'administrateur : il les reporte à son journal à sa prochaine ouverture.
   */
  journalGestion?: string[];
  /** Bloc scellé pour l'administrateur (voir `Prive`). */
  prive?: string;
  /** Liste en clair des formats 1 et 2, à migrer par l'administrateur. */
  heritage?: Profil[];
  /**
   * Annuaire RESTREINT d'un ami (navigateur relié avec son propre code) : son
   * seul compte, sans rien de l'administrateur hormis sa clé publique de
   * séquestre. Aucun prénom n'y mène à l'administrateur : tout autre prénom
   * ouvre le leurre. Voir `projectionAmi` (synchroAnnuaire.ts).
   */
  restreint?: true;
  /** Annuaire restreint : le seul compte qui s'ouvre sur ce navigateur (les autres entrées servent à l'Administration). */
  proprietaire?: string;
  /** Registre et clé commune des Fondateurs (voir `rangs.ts`). */
  fondateurs?: BlocFondateurs;
  /**
   * Annuaire restreint d'un titulaire : règles d'accès qu'il a modifiées sur
   * ce navigateur, en attente d'être reprises par un Fondateur (retour).
   */
  modifications?: Record<string, AccesPublic>;
  /** Textes légaux modifiés par un Fondateur (voir `juridique/modele.ts`) ; absent : modèle par défaut. Synchronisé, lisible par tous les comptes. */
  juridique?: DocsJuridiques;
}

/** Contenu du bloc privé : jamais lisible sans la clé maîtresse de l'administrateur. */
interface Prive {
  nomAdmin?: string;
  creeLeAdmin?: string;
  noms: Record<string, string>;
  creeLe: Record<string, string>;
  /** Gestionnaire qui a créé chaque compte (le cas échéant). */
  creePar: Record<string, string>;
  anterieurs: string[];
  codes: Record<string, { code: string; creeLe: string }>;
}

/** Clés d'usage de l'administrateur (tirées de sa clé maîtresse par `Session.cleDerivee`). */
export interface ClesAdmin {
  /** Scelle le bloc privé. */
  annuaire: Uint8Array;
  /** Scelle la clé privée de séquestre. */
  sequestre: Uint8Array;
}

const USAGE_PRIVE = 'annuaire/prive';
const USAGE_PRIVEE = 'sequestre/cle-privee';
const usageEnveloppe = (id: string) => `sequestre/enveloppe/${id}`;
const usageSuivi = (id: string) => `annuaire/suivi/${id}`;
const usageNom = (id: string) => `annuaire/nom/${id}`;
const usageCreation = (id: string) => `annuaire/creation/${id}`;
const USAGE_JOURNAL_GESTION = 'annuaire/journal-gestion';
/** Nombre maximal d'actions de gestionnaires gardées en attente. */
export const MAX_JOURNAL_GESTION = 500;

export class ErreurAnnuaire extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurAnnuaire';
  }
}

// --- Lecture / écriture ------------------------------------------------------------

function dateIso(valeur: unknown): string | undefined {
  return typeof valeur === 'string' && valeur.length <= 40 && !Number.isNaN(Date.parse(valeur)) ? valeur : undefined;
}

function hexa(valeur: unknown, longueur?: number): string | undefined {
  return typeof valeur === 'string' && MOTIF_HEXA.test(valeur) && valeur.length <= 4096 && (longueur === undefined || valeur.length === longueur)
    ? valeur
    : undefined;
}

function lireAcces(brut: unknown): AccesPublic {
  const o = brut && typeof brut === 'object' && !Array.isArray(brut) ? (brut as Record<string, unknown>) : {};
  const apps = nettoyerApps(o.apps);
  const acces: AccesPublic = { apps, actif: o.actif !== false };
  const niveaux = nettoyerNiveaux(o.niveaux, apps);
  if (niveaux) acces.niveaux = niveaux;
  const role = roleEnregistre(o.role);
  if (role) acces.role = role;
  for (const cle of ['invitationExpireLe', 'expireLe', 'desactiveJusquau'] as const) {
    const d = dateIso(o[cle]);
    if (d) acces[cle] = d;
  }
  return acces;
}

function lireSequestre(brut: unknown): SequestreCompte {
  const o = brut && typeof brut === 'object' && !Array.isArray(brut) ? (brut as Record<string, unknown>) : {};
  const etat = o.etat;
  if (etat === 'actif' && hexa(o.enveloppe)) {
    return { etat, enveloppe: o.enveloppe as string };
  }
  if (etat === 'depose' && typeof o.depot === 'string' && MOTIF_DEPOT.test(o.depot) && o.depot.length <= 4096) {
    return { etat, depot: o.depot };
  }
  if (etat === 'revoque') {
    return { etat };
  }
  return { etat: 'attendu' };
}

/** Séquestres par titulaire : identifiants valides, jamais le compte historique (il a `sequestre`). */
function lireSequestres(brut: unknown): Record<string, SequestreCompte> | undefined {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return undefined;
  const sortie: Record<string, SequestreCompte> = {};
  for (const [titulaire, s] of Object.entries(brut as Record<string, unknown>).slice(0, 64)) {
    if (!MOTIF_ID.test(titulaire) || titulaire === ID_PRINCIPAL) continue;
    const lu = lireSequestre(s);
    // « attendu » est l'absence de dépôt : inutile de le garder.
    if (lu.etat !== 'attendu') sortie[titulaire] = lu;
  }
  return Object.keys(sortie).length > 0 ? sortie : undefined;
}

function lireTitulaire(brut: unknown): PaireTitulaire | undefined {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return undefined;
  const o = brut as Record<string, unknown>;
  const paire: PaireTitulaire = {};
  const cle = hexa(o.cle, 64);
  if (cle) paire.cle = cle;
  const privee = hexa(o.privee);
  if (privee) paire.privee = privee;
  const prive = hexa(o.prive);
  if (prive) paire.prive = prive;
  return Object.keys(paire).length > 0 ? paire : undefined;
}

function lireFondateurs(brut: unknown): BlocFondateurs | undefined {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return undefined;
  const o = brut as Record<string, unknown>;
  const table = (v: unknown, motif: RegExp) => {
    const sortie: Record<string, string> = {};
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [id, valeur] of Object.entries(v as Record<string, unknown>).slice(0, 64)) {
        if ((id === ID_PRINCIPAL || MOTIF_ID.test(id)) && typeof valeur === 'string' && valeur.length <= 4096 && motif.test(valeur)) sortie[id] = valeur;
      }
    }
    return sortie;
  };
  const bloc = { partage: table(o.partage, MOTIF_DEPOT), registre: table(o.registre, MOTIF_HEXA) };
  return Object.keys(bloc.partage).length + Object.keys(bloc.registre).length > 0 ? bloc : undefined;
}

/** Relit l'annuaire, quel que soit le format enregistré. Tout ce qui est invalide est écarté. */
export function lireAnnuaire(brut: string | undefined): Annuaire {
  let lu: unknown;
  try {
    lu = brut ? JSON.parse(brut) : undefined;
  } catch {
    lu = undefined;
  }
  if (Array.isArray(lu)) {
    const heritage = lireProfils(brut);
    const annuaire: Annuaire = { v: VERSION_ANNUAIRE, sel: '', admin: {}, comptes: [], heritage };
    if (heritage[0]?.politique) annuaire.politique = heritage[0].politique;
    return annuaire;
  }
  const o = lu && typeof lu === 'object' ? (lu as Record<string, unknown>) : {};
  const admin = o.admin && typeof o.admin === 'object' ? (o.admin as Record<string, unknown>) : {};
  const vus = new Set<string>();
  const comptes: EntreeCompte[] = [];
  for (const e of Array.isArray(o.comptes) ? o.comptes : []) {
    if (!e || typeof e !== 'object') continue;
    const c = e as Record<string, unknown>;
    if (typeof c.id !== 'string' || !MOTIF_ID.test(c.id) || c.id === ID_PRINCIPAL || vus.has(c.id)) continue;
    const empreinte = hexa(c.empreinte, 64);
    const nom = hexa(c.nom);
    if (!empreinte || !nom) continue;
    vus.add(c.id);
    const entree: EntreeCompte = { id: c.id, empreinte, nom, acces: lireAcces(c.acces), sequestre: lireSequestre(c.sequestre) };
    if (typeof c.suivi === 'string' && MOTIF_DEPOT.test(c.suivi) && c.suivi.length <= 4096) entree.suivi = c.suivi;
    if (typeof c.creation === 'string' && MOTIF_DEPOT.test(c.creation) && c.creation.length <= 4096) entree.creation = c.creation;
    const sequestres = lireSequestres(c.sequestres);
    if (sequestres) entree.sequestres = sequestres;
    const titulaire = lireTitulaire(c.titulaire);
    if (titulaire) entree.titulaire = titulaire;
    comptes.push(entree);
  }
  const annuaire: Annuaire = { v: VERSION_ANNUAIRE, sel: hexa(o.sel, 32) ?? '', admin: {}, comptes };
  if (o.restreint === true) annuaire.restreint = true;
  if (typeof o.proprietaire === 'string' && MOTIF_ID.test(o.proprietaire) && vus.has(o.proprietaire)) annuaire.proprietaire = o.proprietaire;
  const fondateurs = lireFondateurs(o.fondateurs);
  if (fondateurs) annuaire.fondateurs = fondateurs;
  if (annuaire.restreint && o.modifications && typeof o.modifications === 'object' && !Array.isArray(o.modifications)) {
    const modifications: Record<string, AccesPublic> = {};
    for (const [id, acces] of Object.entries(o.modifications as Record<string, unknown>)) {
      if (vus.has(id)) modifications[id] = lireAcces(acces);
    }
    if (Object.keys(modifications).length > 0) annuaire.modifications = modifications;
  }
  const a = annuaire.admin;
  const empreinte = hexa(admin.empreinte, 64);
  if (empreinte) a.empreinte = empreinte;
  const nom = hexa(admin.nom);
  if (nom) a.nom = nom;
  const cle = hexa(admin.cleSequestre, 64);
  if (cle) a.cleSequestre = cle;
  const privee = hexa(admin.priveeScellee);
  if (privee) a.priveeScellee = privee;
  const derniere = dateIso(admin.derniereConnexion);
  if (derniere) a.derniereConnexion = derniere;
  if (o.politique !== undefined) {
    const politique = ecrirePolitique(lirePolitique(o.politique));
    if (politique) annuaire.politique = politique;
  }
  const juridique = lireDocsJuridiques(o.juridique);
  if (juridique) annuaire.juridique = juridique;
  const prive = hexa(o.prive);
  if (prive) annuaire.prive = prive;
  if (Array.isArray(o.journalGestion)) {
    const scelles = o.journalGestion.filter((e): e is string => typeof e === 'string' && MOTIF_DEPOT.test(e) && e.length <= 4096).slice(-MAX_JOURNAL_GESTION);
    if (scelles.length > 0) annuaire.journalGestion = scelles;
  }
  return annuaire;
}

export function ecrireAnnuaire(annuaire: Annuaire): string {
  if (annuaire.heritage) {
    throw new ErreurAnnuaire('Annuaire à migrer : seul l’administrateur peut l’écrire.');
  }
  const reste: Partial<Annuaire> = { ...annuaire };
  delete reste.heritage;
  return JSON.stringify({ ...reste, format: 'annuaire', v: VERSION_ANNUAIRE });
}

/** Vrai quand l'appareil a d'autres comptes que l'administrateur. */
export function aDesAmis(annuaire: Annuaire): boolean {
  return annuaire.heritage ? annuaire.heritage.length > 1 : annuaire.comptes.length > 0;
}

// --- Connexion : retrouver un compte par son prénom ----------------------------------------

export interface CompteTrouve {
  id: string;
  nom: string;
  admin: boolean;
  /**
   * Administrateur historique sans prénom : le prénom saisi, à lui donner
   * après un déverrouillage réussi (voir `adopterPrenomAdmin`).
   */
  prenomAAdopter?: string;
}

const MOTS_ADMIN = new Set(['admin', 'administrateur', 'administratrice']);

/**
 * Nom provisoire de l'administrateur des versions antérieures au hub : ces
 * versions ne lui demandaient jamais de prénom et l'enregistraient sous
 * « Moi ». Ce n'est pas un prénom : personne ne le saisit à la connexion.
 */
export const NOM_ADMIN_PROVISOIRE = 'Moi';

/**
 * Vrai tant que l'administrateur n'a pas de vrai prénom dans l'annuaire :
 * liste en clair avec « Moi » (ou sans nom), annuaire sans empreinte pour
 * lui, ou empreinte de « Moi ». Tant que c'est le cas, un prénom qui n'est
 * celui d'aucun ami mène à SON coffre — et non au leurre —, sans quoi il ne
 * pourrait jamais se connecter en saisissant son prénom.
 */
export function adminSansPrenom(annuaire: Annuaire): boolean {
  if (annuaire.restreint) {
    return false;
  }
  if (annuaire.heritage) {
    const nom = normaliserNom(annuaire.heritage[0]?.nom ?? '');
    return !nom || nom === normaliserNom(NOM_ADMIN_PROVISOIRE);
  }
  if (!annuaire.admin.empreinte) {
    return true;
  }
  return Boolean(annuaire.sel) && annuaire.admin.empreinte === empreinteNom(annuaire.sel, NOM_ADMIN_PROVISOIRE);
}

/** L'administrateur historique, ouvert avec le prénom qu'il vient de saisir. */
function adminAAdopter(saisie: string): CompteTrouve {
  const nom = saisie.trim().slice(0, 30);
  return { id: ID_PRINCIPAL, nom, admin: true, prenomAAdopter: nom };
}

/**
 * Compte correspondant au prénom saisi, ou rien. Ne parcourt que des
 * empreintes : l'annuaire ne rend jamais la liste des comptes.
 */
export function trouverCompte(annuaire: Annuaire, saisie: string): CompteTrouve | undefined {
  const cherche = normaliserNom(saisie);
  if (!cherche) {
    return undefined;
  }
  // Un prénom inconnu mène au leurre… sauf tant que l'administrateur n'a pas
  // de prénom : c'est alors forcément le sien qu'il saisit.
  const inconnu = () => (adminSansPrenom(annuaire) && !MOTS_ADMIN.has(cherche) ? adminAAdopter(saisie) : undefined);
  if (annuaire.heritage) {
    const trouve = annuaire.heritage.find(p => normaliserNom(p.nom) === cherche) ?? (MOTS_ADMIN.has(cherche) ? annuaire.heritage[0] : undefined);
    return trouve ? { id: trouve.id, nom: trouve.nom, admin: trouve.admin } : inconnu();
  }
  if (MOTS_ADMIN.has(cherche)) {
    // Annuaire restreint d'un ami : l'administrateur n'est pas sur ce navigateur (leurre).
    return annuaire.restreint ? undefined : { id: ID_PRINCIPAL, nom: nomAdminPublic(annuaire, saisie) ?? 'Administrateur', admin: true };
  }
  if (!annuaire.sel) {
    return inconnu();
  }
  const empreinte = empreinteNom(annuaire.sel, cherche);
  if (annuaire.admin.empreinte === empreinte && !annuaire.restreint) {
    return { id: ID_PRINCIPAL, nom: nomAdminPublic(annuaire, saisie) ?? saisie.trim(), admin: true };
  }
  const entree = annuaire.comptes.find(c => c.empreinte === empreinte);
  if (!entree) {
    return inconnu();
  }
  // Annuaire restreint (navigateur relié avec le code d'un compte) : seul SON compte s'ouvre ici.
  // Les autres entrées (Administration d'un titulaire) mènent au leurre, comme un prénom inconnu.
  if (annuaire.restreint && entree.id !== (annuaire.proprietaire ?? annuaire.comptes[0]?.id)) {
    return undefined;
  }
  let nom = saisie.trim();
  try {
    nom = descellerTexte(cleDuNom(annuaire.sel, cherche), entree.nom, usageNom(entree.id));
  } catch {
    // Prénom scellé illisible : on garde la saisie.
  }
  return { id: entree.id, nom, admin: false };
}

function nomAdminPublic(annuaire: Annuaire, saisie: string): string | undefined {
  if (!annuaire.admin.nom || !annuaire.sel) return undefined;
  try {
    return descellerTexte(cleDuNom(annuaire.sel, saisie), annuaire.admin.nom, usageNom(ID_PRINCIPAL));
  } catch {
    return undefined;
  }
}

/**
 * Profil d'un ami tel que LUI le voit : son prénom et ses accès, rien
 * d'autre. Aucune donnée d'un autre compte n'y figure.
 */
export function profilAmi(annuaire: Annuaire, id: string, nom: string): Profil {
  if (annuaire.heritage) {
    const p = annuaire.heritage.find(h => h.id === id && !h.admin);
    if (!p) throw new ErreurAnnuaire('Compte introuvable.');
    // Rien de ce que l'administrateur seul doit voir.
    const soi: Profil = { ...p };
    delete soi.politique;
    delete soi.connexions;
    delete soi.derniereConnexion;
    return soi;
  }
  const entree = annuaire.comptes.find(c => c.id === id);
  if (!entree) {
    throw new ErreurAnnuaire('Compte introuvable.');
  }
  return { id, nom, admin: false, creeLe: '', ...entree.acces };
}

/** Profil de l'administrateur avant déverrouillage (rien d'autre n'est lisible). */
export function profilAdminVerrouille(nom: string): Profil {
  return { id: ID_PRINCIPAL, nom, admin: true, creeLe: '' };
}

// --- Côté ami : connexion et dépôt de séquestre -----------------------------------------

/**
 * Note la connexion d'un ami : son invitation est acceptée, son suivi est
 * scellé pour l'administrateur (il ne peut pas le relire), et son séquestre
 * est déposé s'il est attendu. `deposer` reçoit la clé publique de
 * l'administrateur et rend le dépôt (voir `Session.deposerPourSequestre`).
 */
export function noterConnexionAmi(
  annuaire: Annuaire,
  id: string,
  maintenantIso: string,
  connexions: number,
  deposer?: (publique: string) => string,
  alea: SourceAleatoire = aleatoireParDefaut,
  /** Appareils où l'ami s'est connecté (nom lisible, dernière fois) : scellés pour l'administrateur avec le suivi. */
  appareils?: ReadonlyArray<{ nom: string; vu: string }>,
): Annuaire {
  if (annuaire.heritage) {
    return annuaire;
  }
  const publique = annuaire.admin.cleSequestre;
  return {
    ...annuaire,
    comptes: annuaire.comptes.map(c => {
      if (c.id !== id) return c;
      const suivant: EntreeCompte = { ...c, acces: { ...c.acces } };
      delete suivant.acces.invitationExpireLe;
      if (publique) {
        const liste = (appareils ?? []).slice(0, 8).map(a => ({ nom: String(a.nom).slice(0, 40), vu: String(a.vu).slice(0, 40) }));
        suivant.suivi = scellerPourAdmin(publique, utf8ToBytes(JSON.stringify({ derniereConnexion: maintenantIso, connexions, ...(liste.length > 0 ? { appareils: liste } : {}) })), usageSuivi(id), alea);
        // Un Fondateur n'est scellé pour personne.
        if (c.sequestre.etat === 'attendu' && deposer && c.acces.role !== 'fondateur') {
          suivant.sequestre = { etat: 'depose', depot: deposer(publique) };
        }
      }
      return suivant;
    }),
  };
}

// --- Côté administrateur ------------------------------------------------------------

function lirePrive(annuaire: Annuaire, cles: ClesAdmin): Prive {
  const vide: Prive = { noms: {}, creeLe: {}, creePar: {}, anterieurs: [], codes: {} };
  if (!annuaire.prive) return vide;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(utf8DepuisOctets(descellerAvecContexte(cles.annuaire, annuaire.prive, USAGE_PRIVE)));
  } catch {
    throw new ErreurAnnuaire('Bloc privé de l’annuaire illisible avec cette clé.');
  }
  const dict = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const prive = { ...vide };
  if (typeof o.nomAdmin === 'string') prive.nomAdmin = o.nomAdmin.slice(0, 30);
  if (typeof o.creeLeAdmin === 'string') prive.creeLeAdmin = o.creeLeAdmin.slice(0, 40);
  for (const [id, nom] of Object.entries(dict(o.noms))) if (MOTIF_ID.test(id) && typeof nom === 'string') prive.noms[id] = nom.slice(0, 30);
  for (const [id, d] of Object.entries(dict(o.creeLe))) if (MOTIF_ID.test(id) && typeof d === 'string') prive.creeLe[id] = d.slice(0, 40);
  for (const [id, par] of Object.entries(dict(o.creePar))) if (MOTIF_ID.test(id) && typeof par === 'string' && MOTIF_ID.test(par)) prive.creePar[id] = par;
  prive.anterieurs = Array.isArray(o.anterieurs) ? o.anterieurs.filter((id): id is string => typeof id === 'string' && MOTIF_ID.test(id)) : [];
  for (const [id, c] of Object.entries(dict(o.codes))) {
    const code = dict(c);
    if (MOTIF_ID.test(id) && typeof code.code === 'string' && typeof code.creeLe === 'string') prive.codes[id] = { code: code.code, creeLe: code.creeLe };
  }
  return prive;
}

function ecrirePrive(prive: Prive, cles: ClesAdmin, alea: SourceAleatoire): string {
  return scellerAvecContexte(cles.annuaire, utf8ToBytes(JSON.stringify(prive)), USAGE_PRIVE, alea);
}

/** Clé privée de séquestre (à effacer après usage). */
function clePrivee(annuaire: Annuaire, cles: ClesAdmin): Uint8Array {
  if (!annuaire.admin.priveeScellee) {
    throw new ErreurAnnuaire('Pas encore de clé de séquestre : ouvrez d’abord le compte administrateur.');
  }
  const privee = descellerAvecContexte(cles.sequestre, annuaire.admin.priveeScellee, USAGE_PRIVEE);
  if (annuaire.admin.cleSequestre && bytesToHex(publiqueDepuisPrivee(privee)) !== annuaire.admin.cleSequestre) {
    privee.fill(0);
    throw new ErreurAnnuaire('Clé publique de séquestre incohérente : annuaire modifié hors de l’app.');
  }
  return privee;
}

function sceller(sel: string, id: string, nom: string, alea: SourceAleatoire): { empreinte: string; nom: string } {
  return { empreinte: empreinteNom(sel, nom), nom: scellerTexte(cleDuNom(sel, nom), nom.trim(), usageNom(id), alea) };
}

export interface VueAdmin {
  annuaire: Annuaire;
  /** Liste complète, pour l'administrateur seulement. */
  profils: Profil[];
  /** Vrai quand l'annuaire a changé (migration, clés, séquestres convertis) : à enregistrer. */
  modifie: boolean;
  /** Actions de gestionnaires reçues depuis la dernière ouverture, à reporter au journal (puis effacées de l'annuaire). */
  evenementsGestion: EvenementAudit[];
}

/**
 * Ouvre l'annuaire pour l'administrateur déverrouillé : migre un ancien
 * format, crée sa paire de séquestre au besoin, convertit les dépôts de
 * séquestre en enveloppes protégées par un code d'accès, relit les suivis
 * de connexion. Rend la liste complète des profils.
 */
export function ouvrirAnnuaireAdmin(source: Annuaire, cles: ClesAdmin, alea: SourceAleatoire = aleatoireParDefaut, maintenantIso = new Date().toISOString()): VueAdmin {
  let modifie = false;
  const annuaire: Annuaire = { ...source, admin: { ...source.admin }, comptes: source.comptes.map(c => ({ ...c, acces: { ...c.acces }, sequestre: { ...c.sequestre } })) };
  if (!annuaire.sel) {
    annuaire.sel = bytesToHex(alea(16));
    modifie = true;
  }
  let prive: Prive = annuaire.heritage ? { noms: {}, creeLe: {}, creePar: {}, anterieurs: [], codes: {} } : lirePrive(annuaire, cles);

  // Paire de séquestre de l'administrateur.
  if (!annuaire.admin.priveeScellee) {
    const paire = genererPaireSequestre(alea);
    annuaire.admin.cleSequestre = bytesToHex(paire.publique);
    annuaire.admin.priveeScellee = scellerAvecContexte(cles.sequestre, paire.privee, USAGE_PRIVEE, alea);
    paire.privee.fill(0);
    modifie = true;
  }

  // Migration des formats 1 et 2 : les prénoms passent dans le bloc privé.
  const suivisHerites: Record<string, { derniereConnexion?: string; connexions?: number }> = {};
  if (annuaire.heritage) {
    const [admin, ...amis] = annuaire.heritage;
    prive = { ...prive, nomAdmin: admin.nom, creeLeAdmin: admin.creeLe };
    Object.assign(annuaire.admin, sceller(annuaire.sel, ID_PRINCIPAL, admin.nom, alea));
    if (admin.derniereConnexion) annuaire.admin.derniereConnexion = admin.derniereConnexion;
    for (const ami of amis) {
      prive.noms[ami.id] = ami.nom;
      prive.creeLe[ami.id] = ami.creeLe;
      if (ami.anterieur) prive.anterieurs.push(ami.id);
      suivisHerites[ami.id] = { derniereConnexion: ami.derniereConnexion, connexions: ami.connexions };
      annuaire.comptes.push({ id: ami.id, ...sceller(annuaire.sel, ami.id, ami.nom, alea), acces: accesDe(ami), sequestre: { etat: 'attendu' } });
    }
    delete annuaire.heritage;
    modifie = true;
  }

  // Dépôts de séquestre → enveloppes protégées par le code d'accès.
  const privee = clePrivee(annuaire, cles);
  try {
    for (const c of annuaire.comptes) {
      if (c.sequestre.etat !== 'depose' || !c.sequestre.depot) continue;
      let cle: Uint8Array | undefined;
      try {
        const depot = lireContenuDepot(ouvrirDepot(privee, c.sequestre.depot, usageSequestre(c.id)));
        cle = depot.cle;
        // Dépôt fait par un autre Fondateur : il porte le prénom (s'il n'est pas déjà connu).
        if (depot.nom && prive.noms[c.id] === undefined) {
          prive.noms[c.id] = depot.nom;
          if (depot.creeLe) prive.creeLe[c.id] = depot.creeLe;
        }
        const code = prive.codes[c.id]?.code ?? genererCodeAcces(alea);
        c.sequestre = { etat: 'actif', enveloppe: scellerAvecContexte(cleEnveloppeAcces(privee, c.id, code), cle, usageEnveloppe(c.id), alea) };
        prive.codes[c.id] = { code, creeLe: prive.codes[c.id]?.creeLe ?? maintenantIso };
      } catch {
        // Dépôt fait pour une autre clé (ancienne paire) : l'ami redéposera.
        c.sequestre = { etat: 'attendu' };
      } finally {
        cle?.fill(0);
      }
      modifie = true;
    }

    // Comptes créés par un gestionnaire : prénom, date et créateur passent dans le bloc privé.
    // Premier écrit gagnant : un dépôt ne remplace jamais un prénom déjà connu, et le
    // créateur n'est retenu que s'il est réellement gestionnaire.
    // Gestionnaires, Administrateurs et Fondateurs : ceux qui peuvent créer des comptes et journaliser.
    const gestionnaires = new Set(annuaire.comptes.filter(c => c.acces.role !== undefined).map(c => c.id));
    for (const c of annuaire.comptes) {
      if (!c.creation) continue;
      try {
        const o = JSON.parse(utf8DepuisOctets(ouvrirDepot(privee, c.creation, usageCreation(c.id)))) as Record<string, unknown>;
        if (prive.noms[c.id] === undefined && typeof o.nom === 'string' && o.nom.trim()) {
          prive.noms[c.id] = o.nom.trim().slice(0, 30);
          if (typeof o.creeLe === 'string') prive.creeLe[c.id] = o.creeLe.slice(0, 40);
          if (typeof o.par === 'string' && gestionnaires.has(o.par)) prive.creePar[c.id] = o.par;
        }
      } catch {
        // Dépôt illisible (autre clé, fichier retouché) : ignoré.
      }
      delete c.creation;
      modifie = true;
    }

    // Actions des gestionnaires : reportées au journal de l'administrateur.
    const evenementsGestion: EvenementAudit[] = [];
    for (const scelle of annuaire.journalGestion ?? []) {
      try {
        const o = JSON.parse(utf8DepuisOctets(ouvrirDepot(privee, scelle, USAGE_JOURNAL_GESTION))) as { par?: unknown; evenement?: unknown };
        if (typeof o.par !== 'string' || !gestionnaires.has(o.par)) continue;
        const brut = o.evenement && typeof o.evenement === 'object' ? (o.evenement as Record<string, unknown>) : {};
        const evenement = lireEvenement({ ...brut, acteur: prive.noms[o.par] ?? 'Gestionnaire' });
        if (evenement) evenementsGestion.push(evenement);
      } catch {
        // Illisible : ignoré.
      }
    }
    if (annuaire.journalGestion) {
      delete annuaire.journalGestion;
      modifie = true;
    }

    // Nettoyage : rien du bloc privé ne survit à un compte supprimé.
    const ids = new Set(annuaire.comptes.map(c => c.id));
    for (const table of [prive.noms, prive.creeLe, prive.codes, prive.creePar] as Array<Record<string, unknown>>) {
      for (const id of Object.keys(table)) {
        if (!ids.has(id)) {
          delete table[id];
          modifie = true;
        }
      }
    }
    if (modifie) annuaire.prive = ecrirePrive(prive, cles, alea);

    const profils: Profil[] = [
      {
        id: ID_PRINCIPAL,
        nom: prive.nomAdmin ?? NOM_ADMIN_PROVISOIRE,
        admin: true,
        creeLe: prive.creeLeAdmin ?? '',
        ...(annuaire.politique ? { politique: annuaire.politique } : {}),
        ...(annuaire.admin.derniereConnexion ? { derniereConnexion: annuaire.admin.derniereConnexion } : {}),
      },
      ...annuaire.comptes.map(c => {
        const suivi: { derniereConnexion?: string; connexions?: number; appareils?: Array<{ nom: string; vu: string }> } = suivisHerites[c.id] ?? lireSuivi(privee, c);
        const profil: Profil = { id: c.id, nom: prive.noms[c.id] ?? '(prénom inconnu)', admin: false, creeLe: prive.creeLe[c.id] ?? '', ...c.acces, sequestre: c.sequestre.etat };
        if (suivi.derniereConnexion) profil.derniereConnexion = suivi.derniereConnexion;
        if (suivi.connexions !== undefined) profil.connexions = suivi.connexions;
        if (suivi.appareils) profil.appareils = suivi.appareils;
        if (prive.anterieurs.includes(c.id)) profil.anterieur = true;
        if (prive.creePar[c.id]) profil.creePar = prive.creePar[c.id];
        return profil;
      }),
    ];
    return { annuaire, profils, modifie, evenementsGestion };
  } finally {
    privee.fill(0);
  }
}

function lireSuivi(privee: Uint8Array, c: EntreeCompte): { derniereConnexion?: string; connexions?: number; appareils?: Array<{ nom: string; vu: string }> } {
  if (!c.suivi) return {};
  try {
    const o = JSON.parse(utf8DepuisOctets(ouvrirDepot(privee, c.suivi, usageSuivi(c.id))));
    const appareils = Array.isArray(o.appareils)
      ? (o.appareils as unknown[])
          .filter((a): a is { nom: string; vu: string } => Boolean(a) && typeof (a as { nom?: unknown }).nom === 'string' && typeof (a as { vu?: unknown }).vu === 'string')
          .slice(0, 8)
          .map(a => ({ nom: a.nom.slice(0, 40), vu: a.vu.slice(0, 40) }))
      : undefined;
    return {
      derniereConnexion: dateIso(o.derniereConnexion),
      connexions: typeof o.connexions === 'number' && Number.isFinite(o.connexions) && o.connexions >= 0 ? Math.floor(o.connexions) : undefined,
      ...(appareils && appareils.length > 0 ? { appareils } : {}),
    };
  } catch {
    return {};
  }
}

function accesDe(p: Profil): AccesPublic {
  return lireAcces({ apps: p.apps, actif: p.actif, niveaux: p.niveaux, invitationExpireLe: p.invitationExpireLe, expireLe: p.expireLe, desactiveJusquau: p.desactiveJusquau, role: p.role });
}

/**
 * Enregistre la liste modifiée par l'administrateur : accès, prénoms,
 * politique, comptes ajoutés ou retirés. Les séquestres ne changent pas par
 * ce chemin (voir `deposerSequestre`, `regenererCodeAcces`, `revoquerSequestre`).
 */
export function appliquerProfilsAdmin(source: Annuaire, profils: readonly Profil[], cles: ClesAdmin, alea: SourceAleatoire = aleatoireParDefaut): Annuaire {
  const base = source.heritage ? ouvrirAnnuaireAdmin(source, cles, alea).annuaire : source;
  const prive = lirePrive(base, cles);
  const annuaire: Annuaire = { ...base, admin: { ...base.admin }, comptes: [] };
  const admin = profils.find(p => p.admin);
  if (admin) {
    if (admin.nom !== prive.nomAdmin) {
      Object.assign(annuaire.admin, sceller(annuaire.sel, ID_PRINCIPAL, admin.nom, alea));
      prive.nomAdmin = admin.nom;
    }
    const politique = admin.politique ? ecrirePolitique(admin.politique) : undefined;
    if (politique) annuaire.politique = politique;
    else delete annuaire.politique;
    if (admin.derniereConnexion) annuaire.admin.derniereConnexion = admin.derniereConnexion;
  }
  const empreintes = new Set<string>([annuaire.admin.empreinte ?? '']);
  for (const p of profils) {
    if (p.admin || p.id === ID_PRINCIPAL || !MOTIF_ID.test(p.id)) continue;
    const avant = base.comptes.find(c => c.id === p.id);
    const nom = p.nom.trim().slice(0, 30);
    const scelle = avant && prive.noms[p.id] === nom ? { empreinte: avant.empreinte, nom: avant.nom } : sceller(annuaire.sel, p.id, nom, alea);
    if (empreintes.has(scelle.empreinte) || MOTS_ADMIN.has(normaliserNom(nom))) {
      throw new ErreurAnnuaire(`Le prénom « ${nom} » est déjà pris ou réservé.`);
    }
    empreintes.add(scelle.empreinte);
    prive.noms[p.id] = nom;
    if (p.creeLe) prive.creeLe[p.id] = p.creeLe;
    const entree: EntreeCompte = { id: p.id, ...scelle, acces: accesDe(p), sequestre: avant?.sequestre ?? { etat: 'attendu' } };
    if (avant?.sequestres) entree.sequestres = avant.sequestres;
    if (avant?.titulaire) entree.titulaire = avant.titulaire;
    if (avant?.suivi) entree.suivi = avant.suivi;
    if (avant?.creation) entree.creation = avant.creation;
    annuaire.comptes.push(entree);
  }
  const ids = new Set(annuaire.comptes.map(c => c.id));
  for (const table of [prive.noms, prive.creeLe, prive.codes, prive.creePar] as Array<Record<string, unknown>>) {
    for (const id of Object.keys(table)) if (!ids.has(id)) delete table[id];
  }
  prive.anterieurs = prive.anterieurs.filter(id => ids.has(id));
  annuaire.prive = ecrirePrive(prive, cles, alea);
  return annuaire;
}

/**
 * Donne à l'administrateur historique le prénom qu'il vient de saisir à la
 * connexion (après un déverrouillage réussi) : l'annuaire est migré au
 * besoin, puis son prénom scellé comme celui de tout compte. Idempotent :
 * rien ne change (`undefined`) quand il a déjà un prénom, quand la saisie
 * est vide ou réservée (« admin »), ou quand c'est le prénom d'un ami.
 */
export function adopterPrenomAdmin(
  source: Annuaire,
  prenom: string,
  cles: ClesAdmin,
  alea: SourceAleatoire = aleatoireParDefaut,
  maintenantIso = new Date().toISOString(),
): Annuaire | undefined {
  const propre = prenom.trim().slice(0, 30);
  const cherche = normaliserNom(propre);
  if (!cherche || MOTS_ADMIN.has(cherche) || cherche === normaliserNom(NOM_ADMIN_PROVISOIRE) || !adminSansPrenom(source)) {
    return undefined;
  }
  const vue = ouvrirAnnuaireAdmin(source, cles, alea, maintenantIso);
  const empreinte = empreinteNom(vue.annuaire.sel, propre);
  if (vue.annuaire.comptes.some(c => c.empreinte === empreinte)) {
    return undefined;
  }
  const suivant = appliquerProfilsAdmin(
    vue.annuaire,
    vue.profils.map(p => (p.admin ? { ...p, nom: propre } : p)),
    cles,
    alea,
  );
  // L'ouverture ci-dessus a consommé les actions des gestionnaires en attente sans les reporter
  // au journal : on les remet, elles seront lues par la prochaine ouverture ordinaire.
  return source.journalGestion ? { ...suivant, journalGestion: source.journalGestion } : suivant;
}

/** Remplace le séquestre d'un compte par un dépôt neuf (création, régénération des identifiants). */
export function deposerSequestre(annuaire: Annuaire, id: string, depot: string): Annuaire {
  if (!annuaire.comptes.some(c => c.id === id)) throw new ErreurAnnuaire('Compte introuvable.');
  // Nouvelle clé maîtresse : tout autre séquestre (titulaires) et la paire d'un titulaire sont périmés.
  return {
    ...annuaire,
    comptes: annuaire.comptes.map(c => {
      if (c.id !== id) return c;
      const suivant: EntreeCompte = { ...c, sequestre: { etat: 'depose', depot } };
      delete suivant.sequestres;
      delete suivant.titulaire;
      return suivant;
    }),
  };
}

/**
 * Deux blocs privés divergents (modifiés sur deux appareils de
 * l'administrateur) : réunit leur contenu, celui du gagnant prioritaire,
 * limité aux comptes encore présents. Rend le bloc à garder : le gagnant
 * tel quel s'il contient déjà tout (pas de rescellement, donc pas de
 * va-et-vient), sinon un bloc rescellé. Rend le gagnant si un bloc est illisible.
 */
export function fusionnerBlocsPrives(
  gagnant: string,
  perdant: string,
  idsPresents: ReadonlySet<string>,
  cles: ClesAdmin,
  alea: SourceAleatoire = aleatoireParDefaut,
): string {
  if (gagnant === perdant) return gagnant;
  let a: Prive;
  let b: Prive;
  try {
    a = lirePrive({ prive: gagnant } as Annuaire, cles);
    b = lirePrive({ prive: perdant } as Annuaire, cles);
  } catch {
    return gagnant;
  }
  const garder = <T,>(table: Record<string, T>) => Object.fromEntries(Object.entries(table).filter(([id]) => idsPresents.has(id)));
  const fusion: Prive = {
    nomAdmin: a.nomAdmin ?? b.nomAdmin,
    creeLeAdmin: a.creeLeAdmin ?? b.creeLeAdmin,
    noms: { ...garder(b.noms), ...a.noms },
    creeLe: { ...garder(b.creeLe), ...a.creeLe },
    creePar: { ...garder(b.creePar), ...a.creePar },
    anterieurs: [...new Set([...a.anterieurs, ...b.anterieurs.filter(id => idsPresents.has(id))])],
    codes: { ...garder(b.codes), ...a.codes },
  };
  if (fusion.nomAdmin === undefined) delete fusion.nomAdmin;
  if (fusion.creeLeAdmin === undefined) delete fusion.creeLeAdmin;
  const taille = (p: Prive) => Object.keys(p.noms).length + Object.keys(p.creeLe).length + Object.keys(p.creePar).length + p.anterieurs.length + Object.keys(p.codes).length + (p.nomAdmin ? 1 : 0);
  return taille(fusion) === taille(a) ? gagnant : ecrirePrive(fusion, cles, alea);
}

/** Code d'accès administrateur d'un compte, s'il en a un. */
export function codeAcces(annuaire: Annuaire, id: string, cles: ClesAdmin): { code: string; creeLe: string } | undefined {
  return lirePrive(annuaire, cles).codes[id];
}

/**
 * Relit la clé maîtresse d'un ami avec le code d'accès. Lève si le code est
 * faux, si le séquestre est absent ou révoqué. La clé rendue est à effacer.
 */
export function ouvrirSequestre(annuaire: Annuaire, id: string, code: string, cles: ClesAdmin): Uint8Array {
  const c = annuaire.comptes.find(e => e.id === id);
  if (!c) throw new ErreurAnnuaire('Compte introuvable.');
  if (c.sequestre.etat !== 'actif' || !c.sequestre.enveloppe) {
    throw new ErreurAnnuaire(
      c.sequestre.etat === 'revoque'
        ? 'L’accès administrateur à ce compte est révoqué.'
        : 'Séquestre absent : il sera créé à la prochaine connexion de l’ami, ou en régénérant ses identifiants.',
    );
  }
  const privee = clePrivee(annuaire, cles);
  try {
    return descellerAvecContexte(cleEnveloppeAcces(privee, id, code), c.sequestre.enveloppe, usageEnveloppe(id));
  } catch (erreur) {
    if (erreur instanceof ErreurSequestre) throw new ErreurAnnuaire('Code d’accès administrateur incorrect.');
    throw erreur;
  } finally {
    privee.fill(0);
  }
}

/** Nouveau code d'accès : l'ancien cesse aussitôt de fonctionner. */
export function regenererCodeAcces(annuaire: Annuaire, id: string, cles: ClesAdmin, alea: SourceAleatoire = aleatoireParDefaut, maintenantIso = new Date().toISOString()): { annuaire: Annuaire; code: string } {
  const prive = lirePrive(annuaire, cles);
  const ancien = prive.codes[id];
  if (!ancien) throw new ErreurAnnuaire('Aucun code d’accès pour ce compte.');
  const cle = ouvrirSequestre(annuaire, id, ancien.code, cles);
  const privee = clePrivee(annuaire, cles);
  try {
    const code = genererCodeAcces(alea);
    const enveloppe = scellerAvecContexte(cleEnveloppeAcces(privee, id, code), cle, usageEnveloppe(id), alea);
    prive.codes[id] = { code, creeLe: maintenantIso };
    return {
      code,
      annuaire: {
        ...annuaire,
        prive: ecrirePrive(prive, cles, alea),
        comptes: annuaire.comptes.map(c => (c.id === id ? { ...c, sequestre: { etat: 'actif', enveloppe } } : c)),
      },
    };
  } finally {
    cle.fill(0);
    privee.fill(0);
  }
}

/** Révoque l'accès administrateur : enveloppe et code sont effacés, l'ami ne redépose plus. */
export function revoquerSequestre(annuaire: Annuaire, id: string, cles: ClesAdmin, alea: SourceAleatoire = aleatoireParDefaut): Annuaire {
  const prive = lirePrive(annuaire, cles);
  delete prive.codes[id];
  return {
    ...annuaire,
    prive: ecrirePrive(prive, cles, alea),
    comptes: annuaire.comptes.map(c => (c.id === id ? { ...c, sequestre: { etat: 'revoque' } } : c)),
  };
}

/** Rétablit un séquestre révoqué : l'ami redéposera à sa prochaine connexion. */
export function retablirSequestre(annuaire: Annuaire, id: string): Annuaire {
  return { ...annuaire, comptes: annuaire.comptes.map(c => (c.id === id && c.sequestre.etat === 'revoque' ? { ...c, sequestre: { etat: 'attendu' } } : c)) };
}

/** Politique des apps, lisible par tous (le hub d'un ami l'applique). */
export function politiqueAnnuaire(annuaire: Annuaire): PolitiqueHub | undefined {
  return annuaire.politique;
}

export { normaliserCode };


// --- Côté gestionnaire ---------------------------------------------------------------
//
// Un gestionnaire est un ami : il n'a aucune clé de l'administrateur. Il agit
// sur la partie PUBLIQUE de l'annuaire (les règles d'accès `acces`, comme
// l'ami qui note sa connexion) et ne voit que les comptes qu'il a créés, dont
// il connaît le prénom parce qu'il l'a saisi (il le garde dans sa propre base
// chiffrée, voir `hub/admin/gestion.ts`). Tout ce qui doit revenir à
// l'administrateur (prénom, créateur, actions) lui est scellé avec sa clé
// PUBLIQUE de séquestre — le même mécanisme que le suivi des connexions.

/** Rang du compte dans l'annuaire (relu à chaque action : une rétrogradation prend effet aussitôt). */
export function roleDuCompte(annuaire: Annuaire, id: string): 'fondateur' | 'administrateur' | 'gestionnaire' | 'ami' | undefined {
  if (id === ID_PRINCIPAL) return 'fondateur';
  const c = annuaire.comptes.find(e => e.id === id);
  return c ? (c.acces.role ?? 'ami') : undefined;
}

function exigerGestionnaire(annuaire: Annuaire, gestionnaireId: string, rangs: readonly string[] = ['gestionnaire']): void {
  if (annuaire.heritage) {
    throw new ErreurAnnuaire('Annuaire à migrer : l’administrateur doit d’abord ouvrir son compte.');
  }
  if (!rangs.includes(roleDuCompte(annuaire, gestionnaireId) ?? 'ami')) {
    throw new ErreurAnnuaire(rangs.length === 1 ? 'Ce compte n’est pas gestionnaire.' : 'Ce compte n’est pas gestionnaire (ni Administrateur, ni Fondateur).');
  }
}

/** Contenu d'un dépôt de séquestre : la clé seule (32 octets, format historique) ou { k, nom, creeLe }. */
export function lireContenuDepot(octets: Uint8Array): { cle: Uint8Array; nom?: string; creeLe?: string } {
  if (octets.length === 32) {
    return { cle: octets };
  }
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(utf8DepuisOctets(octets)) as Record<string, unknown>;
  } catch {
    throw new ErreurAnnuaire('Dépôt de séquestre illisible.');
  } finally {
    octets.fill(0);
  }
  if (typeof o.k !== 'string' || !/^[0-9a-f]{64}$/.test(o.k)) {
    throw new ErreurAnnuaire('Dépôt de séquestre illisible.');
  }
  const cle = new Uint8Array(32);
  for (let i = 0; i < 32; i++) cle[i] = parseInt(o.k.slice(i * 2, i * 2 + 2), 16);
  return {
    cle,
    ...(typeof o.nom === 'string' && o.nom.trim() ? { nom: o.nom.trim().slice(0, 30) } : {}),
    ...(typeof o.creeLe === 'string' ? { creeLe: o.creeLe.slice(0, 40) } : {}),
  };
}

/**
 * Vue des comptes qui ne montre AUCUN prénom : de quoi faire les chiffres du
 * tableau de bord d'un gestionnaire (nombre de comptes, actifs, invités, apps).
 */
export function apercuAnonyme(annuaire: Annuaire): Profil[] {
  const admin: Profil = { id: ID_PRINCIPAL, nom: 'Administrateur', admin: true, creeLe: '', ...(annuaire.politique ? { politique: annuaire.politique } : {}) };
  return [admin, ...annuaire.comptes.map(c => ({ id: c.id, nom: 'Compte', admin: false, creeLe: '', anterieur: true, ...c.acces }))];
}

/** Compte de l'annuaire vu par son gestionnaire, avec le prénom que celui-ci a saisi. */
export function compteGere(annuaire: Annuaire, id: string, nom: string, gestionnaireId: string): Profil | undefined {
  const c = annuaire.comptes.find(e => e.id === id);
  if (!c) return undefined;
  const acces = { ...c.acces };
  delete acces.role;
  return { id, nom, admin: false, creeLe: '', anterieur: true, ...acces, creePar: gestionnaireId };
}

export interface NouveauCompteGere {
  id: string;
  nom: string;
  gestionnaireId: string;
  apps: readonly string[];
  niveaux?: Record<string, NiveauAcces>;
  invitationExpireLe?: string;
  expireLe?: string;
}

/**
 * Ajoute le compte qu'un gestionnaire vient de créer. Refuse un prénom déjà
 * pris de façon volontairement vague (« pas disponible »). Limite assumée :
 * ce refus laisse deviner qu'un prénom existe (comme la « limite assumée »
 * du dictionnaire de prénoms) ; un compte créé est toujours simple ami.
 */
export function ajouterCompteGere(source: Annuaire, nouveau: NouveauCompteGere, maintenantIso: string, alea: SourceAleatoire = aleatoireParDefaut): Annuaire {
  exigerGestionnaire(source, nouveau.gestionnaireId, ['gestionnaire', 'administrateur', 'fondateur']);
  const publique = source.admin.cleSequestre;
  if (!publique || !source.sel) {
    throw new ErreurAnnuaire('L’administrateur doit d’abord ouvrir son compte avant que l’on puisse créer des amis.');
  }
  const nom = nouveau.nom.trim().slice(0, 30);
  if (!nom) throw new ErreurAnnuaire('Donnez un prénom au profil.');
  if (!MOTIF_ID.test(nouveau.id) || source.comptes.some(c => c.id === nouveau.id)) {
    throw new ErreurAnnuaire('Identifiant de profil invalide.');
  }
  const scelle = sceller(source.sel, nouveau.id, nom, alea);
  if (MOTS_ADMIN.has(normaliserNom(nom)) || scelle.empreinte === source.admin.empreinte || source.comptes.some(c => c.empreinte === scelle.empreinte)) {
    throw new ErreurAnnuaire('Ce prénom n’est pas disponible : choisissez-en un autre.');
  }
  const creation = scellerPourAdmin(
    publique,
    utf8ToBytes(JSON.stringify({ nom, creeLe: maintenantIso.slice(0, 10), par: nouveau.gestionnaireId })),
    usageCreation(nouveau.id),
    alea,
  );
  const entree: EntreeCompte = {
    id: nouveau.id,
    ...scelle,
    acces: lireAcces({ apps: nettoyerApps(nouveau.apps), actif: true, niveaux: nouveau.niveaux, invitationExpireLe: nouveau.invitationExpireLe, expireLe: nouveau.expireLe }),
    sequestre: { etat: 'attendu' },
    creation,
  };
  return { ...source, comptes: [...source.comptes, entree] };
}

/**
 * Enregistre les règles d'accès des comptes qu'un gestionnaire gère. Seuls
 * les comptes de `idsGeres` (jamais lui-même, jamais un autre gestionnaire)
 * changent, et seul leur `acces` : ni rôle, ni prénom, ni séquestre, ni
 * politique, ni bloc privé.
 */
export function appliquerAccesGeres(source: Annuaire, gestionnaireId: string, modifies: readonly Profil[], idsGeres: ReadonlySet<string>): Annuaire {
  exigerGestionnaire(source, gestionnaireId);
  const parId = new Map(modifies.map(p => [p.id, p]));
  for (const id of parId.keys()) {
    if (id === gestionnaireId || !idsGeres.has(id)) {
      throw new ErreurAnnuaire('Ce compte ne fait pas partie de ceux que vous gérez.');
    }
    if (roleDuCompte(source, id) !== 'ami') {
      throw new ErreurAnnuaire('Un gestionnaire ne peut pas agir sur ce compte.');
    }
  }
  return {
    ...source,
    comptes: source.comptes.map(c => {
      const p = parId.get(c.id);
      if (!p) return c;
      const acces = accesDe({ ...p, role: undefined });
      return { ...c, acces };
    }),
  };
}

/** Met une action du gestionnaire en attente pour le journal de l'administrateur (scellée pour lui seul). */
export function ajouterEvenementGestion(
  source: Annuaire,
  gestionnaireId: string,
  evenement: Omit<EvenementAudit, 'acteur' | 'date'> & { date: string },
  alea: SourceAleatoire = aleatoireParDefaut,
): Annuaire {
  exigerGestionnaire(source, gestionnaireId, ['gestionnaire', 'administrateur', 'fondateur']);
  const publique = source.admin.cleSequestre;
  if (!publique) return source;
  const propre = lireEvenement(evenement);
  if (!propre) return source;
  const scelle = scellerPourAdmin(publique, utf8ToBytes(JSON.stringify({ par: gestionnaireId, evenement: propre })), USAGE_JOURNAL_GESTION, alea);
  return { ...source, journalGestion: [...(source.journalGestion ?? []), scelle].slice(-MAX_JOURNAL_GESTION) };
}

/** Briques internes, pour les rangs (`rangs.ts`) : rien d'autre ne doit s'en servir. */
export const internes = { lirePrive, ecrirePrive, clePrivee, accesDe, lireAcces, lireSequestre, usageEnveloppe, usageNom, sceller, USAGE_PRIVEE, MOTIF_ID };
export type { Prive as PriveAnnuaire };
