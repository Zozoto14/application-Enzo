/**
 * Suivi MANUEL des abonnements au hub, réservé à l'administration.
 *
 * Rien n'est automatisé : aucun paiement n'est prélevé ni vérifié, aucun
 * compte n'est coupé tout seul. L'administrateur note qui a payé, et l'app
 * calcule les échéances, les statuts et les rappels à lui montrer (ou à
 * copier-coller). Le suivi est informatif : ce n'est ni une facturation ni un
 * avis fiscal ou juridique.
 *
 * Tout est pur (aucun stockage, l'horloge est passée en argument) :
 *  - montants en CENTIMES entiers (jamais de virgule flottante) ;
 *  - dates « AAAA-MM-JJ » (jour civil local) ;
 *  - l'historique des paiements est une liste d'événements à identifiant
 *    unique : deux appareils qui les ont notés chacun de leur côté les
 *    fusionnent par UNION, sans doublon.
 */

import { nettoyerTexte } from '../admin/journal';

export type Periodicite = 'mensuel' | 'annuel' | 'libre';
export const PERIODICITES: readonly Periodicite[] = ['mensuel', 'annuel', 'libre'];
export const LIBELLES_PERIODICITE: Record<Periodicite, string> = { mensuel: 'Mensuel', annuel: 'Annuel', libre: 'Libre' };

/** `offert` : exempté ; `pause` : suivi suspendu (ni retard ni rappel). */
export type ModeAbo = 'normal' | 'offert' | 'pause';

export type StatutAbo = 'a-jour' | 'echeance-proche' | 'en-retard' | 'offert' | 'suspendu';
export const LIBELLES_STATUT: Record<StatutAbo, string> = {
  'a-jour': 'À jour',
  'echeance-proche': 'Échéance proche',
  'en-retard': 'En retard',
  offert: 'Offert',
  suspendu: 'Suspendu',
};

/** « rappel » : rien de bloquant (défaut) ; « restreindre » : bouton manuel « Suspendre pour impayé ». */
export type ActionRetard = 'rappel' | 'restreindre';

export interface Paiement {
  /** Identifiant unique : sert à fusionner sans doublon entre appareils. */
  id: string;
  /** AAAA-MM-JJ : jour où l'argent a été reçu. */
  date: string;
  /** Centimes reçus. */
  montant: number;
  /** Centimes remisés (geste commercial) : comptent comme payés. */
  remise: number;
  moyen: string;
  /** Échéance que ce paiement couvre (AAAA-MM-JJ). */
  pour: string;
}

export interface CompteAbo {
  mode: ModeAbo;
  periodicite: Periodicite;
  /** Centimes dus par période. */
  montant: number;
  /** Prochaine échéance (AAAA-MM-JJ), absente tant qu'elle n'est pas définie. */
  echeance?: string;
  /** Jour du mois visé (1-31) : garde le 31 d'un mois à l'autre malgré les mois courts. */
  ancre?: number;
  paiements: Paiement[];
  /** Notes PRIVÉES de l'administrateur : ne quittent jamais sa base (jamais projetées, jamais exportées). */
  notes: string;
  /** ISO : sert à départager deux modifications concurrentes. */
  modifieLe: string;
}

export interface ReglagesAbo {
  /** Symbole affiché (« € »). */
  devise: string;
  /** Centimes. */
  montantDefaut: number;
  periodiciteDefaut: Periodicite;
  /** Une échéance est « proche » dans les N prochains jours ; le rappel part alors. */
  joursAvance: number;
  /** Moyens de paiement à indiquer dans les messages (texte libre). */
  moyens: string[];
  /** Modèle du message à copier (variables : {prenom} {montant} {echeance} {moyens} {retard}). */
  modele: string;
  actionRetard: ActionRetard;
  /** Rappel amical affiché à l'utilisateur dans son hub. */
  rappelAmi: boolean;
  messageAmi: string;
  /** Notification locale pour l'administrateur (à l'ouverture, puis une fois par jour). */
  notification: boolean;
}

export interface DonneesAbo {
  reglages: ReglagesAbo;
  comptes: Record<string, CompteAbo>;
}

export const MODELE_DEFAUT =
  'Bonjour {prenom}, petit rappel amical : ton abonnement ({montant}) arrive à échéance le {echeance}{retard}. Tu peux le régler par : {moyens}. Merci !';
export const MESSAGE_AMI_DEFAUT = 'Petit rappel amical : ton abonnement arrive à échéance le {echeance}. Pense à le régler auprès de l’administrateur. Merci !';

export const REGLAGES_ABO_DEFAUT: ReglagesAbo = {
  devise: '€',
  montantDefaut: 500,
  periodiciteDefaut: 'mensuel',
  joursAvance: 7,
  moyens: [],
  modele: MODELE_DEFAUT,
  actionRetard: 'rappel',
  rappelAmi: true,
  messageAmi: MESSAGE_AMI_DEFAUT,
  notification: true,
};

export const BORNES_ABO = {
  joursAvance: { min: 1, max: 60 },
  montant: { min: 0, max: 100_000_00 },
  modele: 600,
  note: 1000,
  moyen: 40,
  moyens: 8,
  devise: 4,
};

export function abonnementsVides(): DonneesAbo {
  return { reglages: { ...REGLAGES_ABO_DEFAUT, moyens: [] }, comptes: {} };
}

// --- Dates --------------------------------------------------------------------

const MOTIF_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function dateValide(valeur: unknown): valeur is string {
  if (typeof valeur !== 'string') return false;
  const m = MOTIF_DATE.exec(valeur);
  if (!m) return false;
  const [a, mo, j] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (a < 2000 || a > 2200 || mo < 1 || mo > 12 || j < 1) return false;
  return j <= joursDansMois(a, mo);
}

export function joursDansMois(annee: number, mois: number): number {
  return new Date(Date.UTC(annee, mois, 0)).getUTCDate();
}

const deux = (n: number) => String(n).padStart(2, '0');

/** Jour civil LOCAL d'un instant. */
export function dateDuJour(maintenant: number): string {
  const d = new Date(maintenant);
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

function composants(date: string): [number, number, number] {
  const m = MOTIF_DATE.exec(date)!;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Ajoute `n` mois en gardant le jour visé (`ancre`), ramené à la fin du mois si besoin (31 janvier + 1 mois = 28/29 février). */
export function ajouterMois(date: string, n: number, ancre?: number): string {
  const [a, m, j] = composants(date);
  const total = a * 12 + (m - 1) + n;
  const annee = Math.floor(total / 12);
  const mois = (total % 12) + 1;
  const jour = Math.min(ancre ?? j, joursDansMois(annee, mois));
  return `${annee}-${deux(mois)}-${deux(jour)}`;
}

/** Échéance qui suit `echeance`, ou rien pour une périodicité libre. */
export function echeanceSuivante(echeance: string, periodicite: Periodicite, ancre?: number): string | undefined {
  if (periodicite === 'libre') return undefined;
  return ajouterMois(echeance, periodicite === 'annuel' ? 12 : 1, ancre ?? composants(echeance)[2]);
}

/** Jours entiers de `aujourdhui` à `echeance` (négatif : dépassée). */
export function joursAvant(echeance: string, aujourdhui: string): number {
  const [a1, m1, j1] = composants(echeance);
  const [a2, m2, j2] = composants(aujourdhui);
  return Math.round((Date.UTC(a1, m1 - 1, j1) - Date.UTC(a2, m2 - 1, j2)) / 86_400_000);
}

export function ajouterJours(date: string, jours: number): string {
  const [a, m, j] = composants(date);
  const d = new Date(Date.UTC(a, m - 1, j + jours));
  return `${d.getUTCFullYear()}-${deux(d.getUTCMonth() + 1)}-${deux(d.getUTCDate())}`;
}

export function dateFr(date: string): string {
  const [a, m, j] = composants(date);
  return `${deux(j)}/${deux(m)}/${a}`;
}

// --- Montants -----------------------------------------------------------------

export function bornerMontant(valeur: unknown, defaut = 0): number {
  if (typeof valeur !== 'number' || !Number.isFinite(valeur)) return defaut;
  return Math.min(BORNES_ABO.montant.max, Math.max(0, Math.round(valeur)));
}

/** Saisie « 12,50 » ou « 12.5 » en centimes ; rien si illisible. */
export function centimesDepuisTexte(texte: string): number | undefined {
  const propre = texte.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(propre)) return undefined;
  return Math.round(Number(propre) * 100);
}

export function formaterMontant(centimes: number, devise: string): string {
  const entier = Math.trunc(centimes / 100);
  const reste = centimes % 100;
  const texte = String(entier).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${texte},${deux(reste)} ${devise}`;
}

// --- Statuts ------------------------------------------------------------------

export function compteVide(reglages: ReglagesAbo, maintenant: string): CompteAbo {
  return { mode: 'normal', periodicite: reglages.periodiciteDefaut, montant: reglages.montantDefaut, paiements: [], notes: '', modifieLe: maintenant };
}

/** Jours avant l'échéance (négatif : en retard), rien sans échéance. */
export function joursRestants(compte: CompteAbo | undefined, aujourdhui: string): number | undefined {
  return compte?.echeance ? joursAvant(compte.echeance, aujourdhui) : undefined;
}

export function statutDe(compte: CompteAbo | undefined, reglages: ReglagesAbo, aujourdhui: string): StatutAbo {
  if (compte?.mode === 'offert') return 'offert';
  if (compte?.mode === 'pause') return 'suspendu';
  const jours = joursRestants(compte, aujourdhui);
  if (jours === undefined) return 'a-jour';
  if (jours < 0) return 'en-retard';
  return jours <= reglages.joursAvance ? 'echeance-proche' : 'a-jour';
}

/** Ce qu'il reste à payer pour l'échéance en cours (partiels et remises déduits). */
export function resteDu(compte: CompteAbo): number {
  if (!compte.echeance) return compte.montant;
  const verse = compte.paiements.filter(p => p.pour === compte.echeance).reduce((somme, p) => somme + p.montant + p.remise, 0);
  return Math.max(0, compte.montant - verse);
}

export function dernierPaiement(compte: CompteAbo | undefined): Paiement | undefined {
  if (!compte || compte.paiements.length === 0) return undefined;
  return [...compte.paiements].sort((a, b) => (a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? -1 : 1)).pop();
}

// --- Modifications (toutes pures) ----------------------------------------------

const maintenantIso = (date: string) => date;

/** Texte court sans caractères de contrôle (les moyens de paiement à indiquer peuvent contenir un IBAN : pas de masquage). */
function texteCourt(valeur: unknown, longueur: number): string {
  // eslint-disable-next-line no-control-regex -- on retire justement les caractères de contrôle.
  return typeof valeur === 'string' ? valeur.replace(/[\u0000-\u001F\u007F]+/g, ' ').trim().slice(0, longueur) : '';
}

/** Moyen d'un paiement enregistré : passe par le nettoyage du journal (aucun secret dans l'historique ni dans l'export). */
export function nettoyerMoyen(valeur: unknown): string {
  return nettoyerTexte(valeur, BORNES_ABO.moyen);
}

export interface SaisiePaiement {
  /** AAAA-MM-JJ du versement. */
  date: string;
  /** Centimes reçus (0 autorisé avec une remise). */
  montant: number;
  remise?: number;
  moyen: string;
  /** Identifiant unique, fourni par l'appelant (aléatoire) pour rester testable. */
  id: string;
}

export class ErreurAbonnement extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurAbonnement';
  }
}

/**
 * Enregistre un versement (complet, partiel, avec remise). Il s'ajoute à
 * l'historique ; quand l'échéance en cours est soldée (somme des versements
 * et remises de cette échéance ≥ montant dû), l'échéance avance d'UNE période
 * à partir de l'ancienne échéance — pas de la date du paiement : payer en
 * retard ne décale pas le calendrier. Sans échéance encore définie, la
 * première est calée sur la date du versement (+ une période).
 */
export function enregistrerPaiement(compte: CompteAbo, saisie: SaisiePaiement, maintenant: string): CompteAbo {
  if (!dateValide(saisie.date)) throw new ErreurAbonnement('Date de paiement invalide (AAAA-MM-JJ).');
  const montant = bornerMontant(saisie.montant);
  const remise = bornerMontant(saisie.remise ?? 0);
  if (montant + remise <= 0) throw new ErreurAbonnement('Indiquez un montant ou une remise.');
  if (compte.paiements.some(p => p.id === saisie.id)) return compte;
  const premiere = !compte.echeance;
  const pour = compte.echeance ?? saisie.date;
  const paiement: Paiement = { id: saisie.id, date: saisie.date, montant, remise, moyen: nettoyerMoyen(saisie.moyen), pour };
  let suivant: CompteAbo = { ...compte, paiements: [...compte.paiements, paiement], modifieLe: maintenantIso(maintenant) };
  if (premiere) {
    // Pas d'échéance connue : ce versement « ouvre » le suivi, la prochaine est une période plus loin.
    const ancre = composants(saisie.date)[2];
    const prochaine = echeanceSuivante(saisie.date, compte.periodicite, ancre);
    return { ...suivant, ancre, ...(prochaine ? { echeance: prochaine } : {}) };
  }
  if (resteDu(suivant) === 0) {
    const prochaine = echeanceSuivante(compte.echeance!, compte.periodicite, compte.ancre);
    suivant = { ...suivant };
    if (prochaine) suivant.echeance = prochaine;
    else delete suivant.echeance;
  }
  return suivant;
}

/** Marque l'échéance en cours comme payée en totalité (le reste dû, par défaut). */
export function marquerPaye(compte: CompteAbo, saisie: Omit<SaisiePaiement, 'montant'> & { montant?: number }, maintenant: string): CompteAbo {
  const montant = saisie.montant ?? Math.max(0, resteDu(compte));
  return enregistrerPaiement(compte, { ...saisie, montant }, maintenant);
}

export function definirMode(compte: CompteAbo, mode: ModeAbo, maintenant: string): CompteAbo {
  return { ...compte, mode, modifieLe: maintenant };
}

export function modifierEcheance(compte: CompteAbo, echeance: string, maintenant: string): CompteAbo {
  if (!dateValide(echeance)) throw new ErreurAbonnement('Échéance invalide (AAAA-MM-JJ).');
  return { ...compte, echeance, ancre: composants(echeance)[2], modifieLe: maintenant };
}

export function configurerCompte(
  compte: CompteAbo,
  changement: { periodicite?: Periodicite; montant?: number; notes?: string },
  maintenant: string,
): CompteAbo {
  const suivant = { ...compte, modifieLe: maintenant };
  if (changement.periodicite && PERIODICITES.includes(changement.periodicite)) suivant.periodicite = changement.periodicite;
  if (changement.montant !== undefined) suivant.montant = bornerMontant(changement.montant, compte.montant);
  if (changement.notes !== undefined) suivant.notes = changement.notes.slice(0, BORNES_ABO.note);
  return suivant;
}

// --- Lecture tolérante --------------------------------------------------------

function lirePaiement(brut: unknown): Paiement | undefined {
  if (!brut || typeof brut !== 'object') return undefined;
  const p = brut as Record<string, unknown>;
  if (typeof p.id !== 'string' || !/^[a-z0-9-]{4,40}$/.test(p.id) || !dateValide(p.date)) return undefined;
  const pour = dateValide(p.pour) ? p.pour : p.date;
  return { id: p.id, date: p.date, montant: bornerMontant(p.montant), remise: bornerMontant(p.remise), moyen: nettoyerMoyen(p.moyen), pour };
}

export function lireCompteAbo(brut: unknown, reglages: ReglagesAbo = REGLAGES_ABO_DEFAUT): CompteAbo | undefined {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return undefined;
  const c = brut as Record<string, unknown>;
  const modifieLe = typeof c.modifieLe === 'string' && !Number.isNaN(Date.parse(c.modifieLe)) ? c.modifieLe : '1970-01-01T00:00:00.000Z';
  const vus = new Set<string>();
  const paiements = (Array.isArray(c.paiements) ? c.paiements : [])
    .map(lirePaiement)
    .filter((p): p is Paiement => Boolean(p))
    .filter(p => (vus.has(p.id) ? false : (vus.add(p.id), true)))
    .slice(0, 2000);
  const compte: CompteAbo = {
    mode: c.mode === 'offert' || c.mode === 'pause' ? c.mode : 'normal',
    periodicite: PERIODICITES.includes(c.periodicite as Periodicite) ? (c.periodicite as Periodicite) : reglages.periodiciteDefaut,
    montant: bornerMontant(c.montant, reglages.montantDefaut),
    paiements: trierPaiements(paiements),
    notes: typeof c.notes === 'string' ? c.notes.slice(0, BORNES_ABO.note) : '',
    modifieLe,
  };
  if (dateValide(c.echeance)) compte.echeance = c.echeance;
  if (typeof c.ancre === 'number' && c.ancre >= 1 && c.ancre <= 31) compte.ancre = Math.floor(c.ancre);
  return compte;
}

export function lireReglagesAbo(brut: unknown): ReglagesAbo {
  const o = brut && typeof brut === 'object' && !Array.isArray(brut) ? (brut as Record<string, unknown>) : {};
  const d = REGLAGES_ABO_DEFAUT;
  const jours = typeof o.joursAvance === 'number' && Number.isFinite(o.joursAvance) ? Math.round(o.joursAvance) : d.joursAvance;
  const texte = (v: unknown, defaut: string, max: number) => (typeof v === 'string' && v.trim() ? v.slice(0, max) : defaut);
  return {
    devise: typeof o.devise === 'string' && o.devise.trim() ? texteCourt(o.devise, BORNES_ABO.devise) || d.devise : d.devise,
    montantDefaut: bornerMontant(o.montantDefaut, d.montantDefaut),
    periodiciteDefaut: PERIODICITES.includes(o.periodiciteDefaut as Periodicite) ? (o.periodiciteDefaut as Periodicite) : d.periodiciteDefaut,
    joursAvance: Math.min(BORNES_ABO.joursAvance.max, Math.max(BORNES_ABO.joursAvance.min, jours)),
    moyens: (Array.isArray(o.moyens) ? o.moyens : []).map(m => texteCourt(m, 120)).filter(Boolean).slice(0, BORNES_ABO.moyens),
    modele: texte(o.modele, d.modele, BORNES_ABO.modele),
    actionRetard: o.actionRetard === 'restreindre' ? 'restreindre' : 'rappel',
    rappelAmi: typeof o.rappelAmi === 'boolean' ? o.rappelAmi : d.rappelAmi,
    messageAmi: texte(o.messageAmi, d.messageAmi, BORNES_ABO.modele),
    notification: typeof o.notification === 'boolean' ? o.notification : d.notification,
  };
}

const MOTIF_ID = /^[a-z0-9]{2,16}$/;

export function lireAbonnements(brut: unknown): DonneesAbo {
  const o = brut && typeof brut === 'object' && !Array.isArray(brut) ? (brut as Record<string, unknown>) : {};
  const reglages = lireReglagesAbo(o.reglages);
  const comptes: Record<string, CompteAbo> = {};
  const source = o.comptes && typeof o.comptes === 'object' && !Array.isArray(o.comptes) ? (o.comptes as Record<string, unknown>) : {};
  for (const [id, brutCompte] of Object.entries(source)) {
    const compte = MOTIF_ID.test(id) ? lireCompteAbo(brutCompte, reglages) : undefined;
    if (compte) comptes[id] = compte;
  }
  return { reglages, comptes };
}

export function trierPaiements(paiements: readonly Paiement[]): Paiement[] {
  return [...paiements].sort((a, b) => (a.date === b.date ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.date < b.date ? -1 : 1));
}

// --- Fusion entre appareils ---------------------------------------------------

/**
 * Fusion de deux versions d'un même compte : l'historique est l'UNION des
 * paiements (par identifiant, sans doublon) ; le reste (mode, échéance,
 * montant, notes…) vient de la version la plus récente (`modifieLe`, puis
 * l'ordre du texte à égalité, pour que les deux appareils choisissent pareil).
 */
export function fusionnerCompteAbo(a: unknown, b: unknown): unknown {
  const ca = lireCompteAbo(a);
  const cb = lireCompteAbo(b);
  if (!ca || !cb) return ca ?? cb;
  const gagnant = ca.modifieLe === cb.modifieLe ? (JSON.stringify(ca) >= JSON.stringify(cb) ? ca : cb) : ca.modifieLe > cb.modifieLe ? ca : cb;
  const vus = new Map<string, Paiement>();
  for (const p of [...ca.paiements, ...cb.paiements]) if (!vus.has(p.id)) vus.set(p.id, p);
  return { ...gagnant, paiements: trierPaiements([...vus.values()]) };
}

// --- Vues, rappels ------------------------------------------------------------

export interface LigneAbo {
  id: string;
  nom: string;
  statut: StatutAbo;
  /** Jours avant l'échéance (négatif : en retard). */
  jours?: number;
  compte: CompteAbo;
  echeance?: string;
  dernier?: Paiement;
  resteDu: number;
}

export function lignesAbo(profils: readonly { id: string; nom: string }[], donnees: DonneesAbo, aujourdhui: string): LigneAbo[] {
  return profils.map(p => {
    const compte = donnees.comptes[p.id] ?? compteVide(donnees.reglages, '1970-01-01T00:00:00.000Z');
    return {
      id: p.id,
      nom: p.nom,
      statut: statutDe(compte, donnees.reglages, aujourdhui),
      jours: joursRestants(compte, aujourdhui),
      compte,
      echeance: compte.echeance,
      dernier: dernierPaiement(compte),
      resteDu: resteDu(compte),
    };
  });
}

export interface FiltreAbo {
  statut?: StatutAbo | 'tous';
  /** Échéance dans moins de N jours (retards compris). */
  echeanceSous?: number;
}

export function filtrerLignes(lignes: readonly LigneAbo[], filtre: FiltreAbo): LigneAbo[] {
  return lignes.filter(l => {
    if (filtre.statut && filtre.statut !== 'tous' && l.statut !== filtre.statut) return false;
    if (filtre.echeanceSous !== undefined) {
      if (l.statut === 'offert' || l.statut === 'suspendu' || l.jours === undefined || l.jours > filtre.echeanceSous) return false;
    }
    return true;
  });
}

export interface ResumeRappels {
  retard: number;
  semaine: number;
  texte: string;
}

/** « 2 abonnements en retard, 3 échéances cette semaine » (les comptes offerts ou en pause sont ignorés). */
export function resumeRappels(lignes: readonly LigneAbo[]): ResumeRappels {
  const retard = lignes.filter(l => l.statut === 'en-retard').length;
  const semaine = lignes.filter(l => (l.statut === 'echeance-proche' || l.statut === 'a-jour') && l.jours !== undefined && l.jours >= 0 && l.jours <= 7).length;
  const morceaux: string[] = [];
  if (retard > 0) morceaux.push(`${retard} abonnement${retard > 1 ? 's' : ''} en retard`);
  if (semaine > 0) morceaux.push(`${semaine} échéance${semaine > 1 ? 's' : ''} cette semaine`);
  return { retard, semaine, texte: morceaux.join(', ') };
}

/**
 * Notification locale de l'administrateur : une fois par jour au plus (à
 * l'ouverture, puis chaque jour si l'app reste ouverte), seulement s'il y a
 * quelque chose à dire. Rend le texte, ou rien.
 */
export function notificationDuJour(
  resume: ResumeRappels,
  reglages: Pick<ReglagesAbo, 'notification'>,
  dernierJour: string | undefined,
  aujourdhui: string,
): { titre: string; corps: string } | undefined {
  if (!reglages.notification || resume.texte === '' || dernierJour === aujourdhui) return undefined;
  return { titre: '💳 Abonnements', corps: `${resume.texte[0].toUpperCase()}${resume.texte.slice(1)}.` };
}

// --- Messages -----------------------------------------------------------------

export interface VariablesMessage {
  prenom: string;
  montant: string;
  echeance?: string;
  moyens: readonly string[];
  /** Jours de retard (> 0 : ajoute « (en retard de N jours) »). */
  retard?: number;
}

/** Remplit le modèle ; une variable inconnue reste telle quelle, une variable vide laisse un repère. */
export function rendreModele(modele: string, v: VariablesMessage): string {
  const valeurs: Record<string, string> = {
    prenom: v.prenom,
    montant: v.montant,
    echeance: v.echeance ? dateFr(v.echeance) : 'à convenir',
    moyens: v.moyens.length > 0 ? v.moyens.join(', ') : 'à convenir avec moi',
    retard: v.retard && v.retard > 0 ? ` (en retard de ${v.retard} jour${v.retard > 1 ? 's' : ''})` : '',
  };
  return modele.replace(/\{(\w+)\}/g, (tout, nom: string) => (nom in valeurs ? valeurs[nom] : tout));
}

export function messageRappel(ligne: LigneAbo, reglages: ReglagesAbo): string {
  return rendreModele(reglages.modele, {
    prenom: ligne.nom,
    montant: formaterMontant(ligne.resteDu > 0 ? ligne.resteDu : ligne.compte.montant, reglages.devise),
    echeance: ligne.echeance,
    moyens: reglages.moyens,
    retard: ligne.jours !== undefined && ligne.jours < 0 ? -ligne.jours : undefined,
  });
}

// --- Projection pour l'utilisateur ---------------------------------------------

/**
 * Ce que reçoit UN utilisateur, dans son seul espace du relais : son mode,
 * son échéance, et le message de rappel déjà rédigé. Ni notes, ni historique,
 * ni aucun autre compte : tout ce qui n'est pas listé ici ne part pas.
 */
export interface ProjectionAbo {
  v: 1;
  mode: ModeAbo;
  echeance?: string;
  joursAvance: number;
  rappel: boolean;
  message: string;
}

export function projectionPour(donnees: DonneesAbo, id: string, nom: string): ProjectionAbo {
  const compte = donnees.comptes[id] ?? compteVide(donnees.reglages, '1970-01-01T00:00:00.000Z');
  const p: ProjectionAbo = {
    v: 1,
    mode: compte.mode,
    joursAvance: donnees.reglages.joursAvance,
    rappel: donnees.reglages.rappelAmi,
    message: rendreModele(donnees.reglages.messageAmi, {
      prenom: nom,
      montant: formaterMontant(resteDu(compte) > 0 ? resteDu(compte) : compte.montant, donnees.reglages.devise),
      echeance: compte.echeance,
      moyens: donnees.reglages.moyens,
    }),
  };
  if (compte.echeance) p.echeance = compte.echeance;
  return p;
}

export function lireProjection(brut: unknown): ProjectionAbo | undefined {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return undefined;
  const o = brut as Record<string, unknown>;
  if (o.v !== 1) return undefined;
  const jours = typeof o.joursAvance === 'number' && Number.isFinite(o.joursAvance) ? Math.round(o.joursAvance) : REGLAGES_ABO_DEFAUT.joursAvance;
  const p: ProjectionAbo = {
    v: 1,
    mode: o.mode === 'offert' || o.mode === 'pause' ? o.mode : 'normal',
    joursAvance: Math.min(BORNES_ABO.joursAvance.max, Math.max(BORNES_ABO.joursAvance.min, jours)),
    rappel: o.rappel === true,
    message: texteCourt(o.message, BORNES_ABO.modele),
  };
  if (dateValide(o.echeance)) p.echeance = o.echeance;
  return p;
}

/** Statut vu par l'utilisateur, recalculé sur SA date du jour. */
export function statutProjection(p: ProjectionAbo, aujourdhui: string): StatutAbo {
  return statutDe(
    { mode: p.mode, periodicite: 'libre', montant: 0, echeance: p.echeance, paiements: [], notes: '', modifieLe: '' },
    { ...REGLAGES_ABO_DEFAUT, joursAvance: p.joursAvance },
    aujourdhui,
  );
}

/**
 * Rappel amical à montrer dans le hub de l'utilisateur : seulement si
 * l'administrateur l'a activé, que l'échéance approche ou est dépassée, et
 * pas déjà montré aujourd'hui (`dernierJour`).
 */
export function rappelPourAmi(p: ProjectionAbo | undefined, aujourdhui: string, dernierJour: string | undefined): { statut: StatutAbo; message: string } | undefined {
  if (!p || !p.rappel || !p.message || dernierJour === aujourdhui) return undefined;
  const statut = statutProjection(p, aujourdhui);
  return statut === 'echeance-proche' || statut === 'en-retard' ? { statut, message: p.message } : undefined;
}

// --- Export CSV ---------------------------------------------------------------

function cellule(valeur: string | number): string {
  let texte = String(valeur);
  // Un tableur exécuterait une formule : on la neutralise.
  if (/^[=+\-@\t\r]/.test(texte)) texte = `'${texte}`;
  return /[";\n\r,]/.test(texte) ? `"${texte.replace(/"/g, '""')}"` : texte;
}

const virgule = (centimes: number) => `${Math.trunc(centimes / 100)}.${deux(centimes % 100)}`;

export const ENTETE_CSV = ['compte', 'date_paiement', 'montant', 'remise', 'moyen', 'echeance_couverte', 'periodicite'];

/**
 * Historique des paiements en CSV. Aucun secret : ni notes privées, ni
 * identifiant, ni code. Seulement le prénom, les dates, les montants, le moyen.
 */
export function exporterPaiementsCsv(profils: readonly { id: string; nom: string }[], donnees: DonneesAbo): string {
  const lignes = [ENTETE_CSV.join(',')];
  for (const p of profils) {
    const compte = donnees.comptes[p.id];
    if (!compte) continue;
    for (const paiement of compte.paiements) {
      lignes.push(
        [p.nom, paiement.date, virgule(paiement.montant), virgule(paiement.remise), paiement.moyen, paiement.pour, compte.periodicite].map(cellule).join(','),
      );
    }
  }
  return `${lignes.join('\r\n')}\r\n`;
}

// --- Entités de synchronisation -------------------------------------------------

export const PREFIXE_ENTITE = 'abo';
export const ENTITE_REGLAGES = 'abo-reglages';

export function entitesAbonnements(d: DonneesAbo): Record<string, unknown> {
  const e: Record<string, unknown> = {};
  if (Object.keys(d.comptes).length > 0 || JSON.stringify(d.reglages) !== JSON.stringify(REGLAGES_ABO_DEFAUT)) e[ENTITE_REGLAGES] = d.reglages;
  for (const [id, compte] of Object.entries(d.comptes)) e[`${PREFIXE_ENTITE}:${id}`] = compte;
  return e;
}

export function abonnementsDepuisEntites(e: Record<string, unknown>): DonneesAbo {
  const comptes: Record<string, unknown> = {};
  for (const [cle, valeur] of Object.entries(e)) {
    if (cle.startsWith(`${PREFIXE_ENTITE}:`)) comptes[cle.slice(PREFIXE_ENTITE.length + 1)] = valeur;
  }
  return lireAbonnements({ reglages: e[ENTITE_REGLAGES], comptes });
}

/** Fusions à brancher dans `fusionsDonnees` (union des paiements par compte). */
export const FUSIONS_ABONNEMENTS = { [PREFIXE_ENTITE]: fusionnerCompteAbo };
