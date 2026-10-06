/**
 * Prospects : carnet de prospection PERSONNEL du Fondateur (compte historique).
 *
 * Ce n'est ni un outil d'envoi en masse ni un collecteur d'adresses : l'app
 * range des contacts que l'utilisateur a lui-même obtenus, prépare UN e-mail à
 * la fois (lien `mailto:` ouvert dans sa messagerie) et lui rappelle qui
 * relancer. Aucun envoi automatique, aucune recherche d'adresses sur le web.
 *
 * Tout est pur (ni stockage, ni horloge implicite) :
 *  - dates de relance « AAAA-MM-JJ » (jour civil local), horodatages ISO ;
 *  - adresses comparées sans tenir compte de la casse (dédoublonnage) ;
 *  - « Ne plus contacter » bloque la préparation d'un e-mail, et une adresse
 *    déjà connue n'est jamais recréée par un ajout en lot ou un import (le
 *    refus est donc conservé).
 *
 * Rangement : dans les données d'administration (`admin/donnees.ts`, base
 * chiffrée du compte historique), synchronisées scellées par sa clé de
 * synchronisation (`admin/fusionDonnees.ts`) : une entité `prospect:<id>` par
 * fiche (dernier gagnant, suppression datée) + `prospects-modeles`.
 */

// --- Types ----------------------------------------------------------------------

export type StatutProspect = 'nouveau' | 'contacte' | 'relance' | 'repond' | 'rendez-vous' | 'gagne' | 'perdu';

export const STATUTS: readonly StatutProspect[] = ['nouveau', 'contacte', 'relance', 'repond', 'rendez-vous', 'gagne', 'perdu'];

export const LIBELLES_STATUT_PROSPECT: Record<StatutProspect, string> = {
  nouveau: 'Nouveau',
  contacte: 'Contacté',
  relance: 'Relancé',
  repond: 'Répond',
  'rendez-vous': 'Rendez-vous',
  gagne: 'Gagné',
  perdu: 'Perdu',
};

/** Statuts « clos » : plus de relance proposée. */
export const STATUTS_CLOS: readonly StatutProspect[] = ['gagne', 'perdu'];

export interface ContactProspect {
  /** Identifiant unique (fusion sans doublon). */
  id: string;
  /** AAAA-MM-JJ. */
  date: string;
  note: string;
}

export interface Prospect {
  id: string;
  nom: string;
  entreprise: string;
  email: string;
  telephone: string;
  /** Où l'adresse a été obtenue (salon, recommandation, site de l'entreprise…). */
  source: string;
  etiquettes: string[];
  statut: StatutProspect;
  /** Prochaine relance (AAAA-MM-JJ). */
  relance?: string;
  notes: string;
  historique: ContactProspect[];
  /** La personne a demandé à ne plus être contactée : « Écrire » est bloqué. */
  nePlusContacter: boolean;
  creeLe: string;
  modifieLe: string;
}

export interface ModeleMessage {
  id: string;
  nom: string;
  sujet: string;
  corps: string;
}

export interface DonneesProspects {
  prospects: Record<string, Prospect>;
  modeles: ModeleMessage[];
}

// --- Bornes ---------------------------------------------------------------------

export const MAX_PROSPECTS = 3000;
export const MAX_HISTORIQUE = 200;
export const MAX_ETIQUETTES = 12;
export const MAX_MODELES = 20;
const LONGUEURS = { nom: 120, entreprise: 120, email: 254, telephone: 40, source: 200, notes: 4000, etiquette: 40, note: 1000, sujet: 200, corps: 5000, nomModele: 60 };
const MOTIF_ID = /^[a-z0-9]{4,32}$/;
const MOTIF_JOUR = /^\d{4}-\d{2}-\d{2}$/;

export const MODELES_DEFAUT: readonly ModeleMessage[] = [
  {
    id: 'premier',
    nom: 'Premier contact',
    sujet: 'Bonjour {prenom}',
    corps:
      'Bonjour {prenom},\n\nJe me permets de vous écrire au sujet de {entreprise}.\n\n…\n\nBien cordialement,\n\n—\nSi vous ne souhaitez plus recevoir de message de ma part, répondez simplement « stop » : je ne vous recontacterai pas.',
  },
  {
    id: 'relance',
    nom: 'Relance',
    sujet: 'Suite à mon message',
    corps:
      'Bonjour {prenom},\n\nJe reviens vers vous suite à mon précédent message concernant {entreprise}. Avez-vous eu le temps d’y jeter un œil ?\n\nBien cordialement,\n\n—\nSi vous ne souhaitez plus recevoir de message de ma part, répondez simplement « stop » : je ne vous recontacterai pas.',
  },
];

export const RAPPEL_RGPD =
  'Prospection par e-mail : respectez les règles applicables (en France et dans l’UE, le RGPD et le consentement préalable des particuliers ; pour un professionnel, un message en lien avec son activité). Chaque message doit offrir un moyen simple de se désinscrire, et une personne qui refuse ne doit plus être contactée : cochez alors « Ne plus contacter ». Cette app est un carnet personnel : aucun envoi automatique, aucune collecte d’adresses sur le web.';

export function prospectsVides(): DonneesProspects {
  return { prospects: {}, modeles: MODELES_DEFAUT.map(m => ({ ...m })) };
}

// --- Petites aides --------------------------------------------------------------

const texte = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max) : '');

export function jourValide(jour: unknown): jour is string {
  if (typeof jour !== 'string' || !MOTIF_JOUR.test(jour)) return false;
  const d = new Date(`${jour}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === jour;
}

/** AAAA-MM-JJ local d'un instant. */
export function jourDe(maintenant: number): string {
  const d = new Date(maintenant);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** AAAA-MM-JJ + n jours. */
export function ajouterJours(jour: string, n: number): string {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** « 06/10/2026 ». */
export function jourFr(jour: string | undefined): string {
  if (!jour || !jourValide(jour)) return '';
  const [a, m, j] = jour.split('-');
  return `${j}/${m}/${a}`;
}

/** Accepte « 2026-10-06 » ou « 06/10/2026 » ; rend AAAA-MM-JJ ou undefined. */
export function lireJour(saisie: string): string | undefined {
  const t = saisie.trim();
  if (jourValide(t)) return t;
  const fr = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (fr) {
    const jour = `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}`;
    return jourValide(jour) ? jour : undefined;
  }
  return undefined;
}

export function nouvelId(maintenant: number, alea: () => number = Math.random): string {
  return `p${maintenant.toString(36)}${Math.floor(alea() * 36 ** 6).toString(36).padStart(6, '0')}`;
}

// --- E-mails --------------------------------------------------------------------

/** Clé de comparaison : sans espaces, en minuscules. */
export const cleEmail = (email: string): string => email.trim().toLowerCase();

/**
 * Format d'adresse raisonnable (pas la RFC entière, volontairement) :
 * partie locale ≤ 64, domaine avec au moins un point et une extension de 2
 * lettres ou plus, ni espace ni caractère réservé, pas de point doublé ni en
 * bordure.
 */
export function emailValide(email: string): boolean {
  const e = email.trim();
  if (e.length < 6 || e.length > LONGUEURS.email) return false;
  const m = /^([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)$/.exec(e);
  if (!m) return false;
  const [, local, domaine] = m;
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  const parties = domaine.split('.');
  if (parties.some(p => p.length === 0 || p.length > 63 || p.startsWith('-') || p.endsWith('-'))) return false;
  return /^[A-Za-z]{2,}$/.test(parties[parties.length - 1]);
}

export interface AnalyseListe {
  /** Adresses nouvelles et valides, dans l'ordre de saisie (casse d'origine). */
  nouvelles: string[];
  /** Déjà présentes dans le carnet ou répétées dans la liste. */
  doublons: string[];
  invalides: string[];
}

/**
 * Découpe une liste collée : une adresse par ligne, ou séparées par virgules,
 * points-virgules, espaces ou tabulations. Accepte « Nom <adresse> ».
 * Dédoublonnage insensible à la casse, contre le carnet et dans la liste.
 */
export function analyserListe(saisie: string, connues: Iterable<string> = []): AnalyseListe {
  const vues = new Set([...connues].map(cleEmail));
  const resultat: AnalyseListe = { nouvelles: [], doublons: [], invalides: [] };
  // Les « Nom <adresse> » d'abord : on ne garde que l'adresse.
  const nettoyee = saisie.replace(/[^<>,;\n\r]*<([^<>]+)>/g, ' $1 ');
  for (const morceau of nettoyee.split(/[\s,;]+/)) {
    const brut = morceau.trim().replace(/^mailto:/i, '').replace(/^["'(]+|["').]+$/g, '');
    if (!brut) continue;
    if (!emailValide(brut)) {
      resultat.invalides.push(brut.slice(0, 120));
      continue;
    }
    const cle = cleEmail(brut);
    if (vues.has(cle)) {
      resultat.doublons.push(brut);
      continue;
    }
    vues.add(cle);
    resultat.nouvelles.push(brut);
  }
  return resultat;
}

// --- Lecture tolérante (données enregistrées ou reçues d'un autre appareil) -----

function lireEtiquettes(v: unknown): string[] {
  const liste = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[|,;]/) : [];
  const vues = new Set<string>();
  const sortie: string[] = [];
  for (const e of liste) {
    const t = texte(e, LONGUEURS.etiquette);
    if (t && !vues.has(t.toLowerCase())) {
      vues.add(t.toLowerCase());
      sortie.push(t);
    }
    if (sortie.length >= MAX_ETIQUETTES) break;
  }
  return sortie;
}

function lireHistorique(v: unknown): ContactProspect[] {
  if (!Array.isArray(v)) return [];
  const vus = new Set<string>();
  const sortie: ContactProspect[] = [];
  for (const c of v) {
    const o = c && typeof c === 'object' ? (c as Record<string, unknown>) : {};
    const id = typeof o.id === 'string' && MOTIF_ID.test(o.id) ? o.id : undefined;
    if (!id || vus.has(id) || !jourValide(o.date)) continue;
    vus.add(id);
    sortie.push({ id, date: o.date, note: texte(o.note, LONGUEURS.note) });
  }
  return trierHistorique(sortie).slice(-MAX_HISTORIQUE);
}

export function trierHistorique(h: readonly ContactProspect[]): ContactProspect[] {
  return [...h].sort((a, b) => (a.date === b.date ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.date < b.date ? -1 : 1));
}

export function lireProspect(brut: unknown, idImpose?: string): Prospect | undefined {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return undefined;
  const o = brut as Record<string, unknown>;
  const id = idImpose ?? o.id;
  if (typeof id !== 'string' || !MOTIF_ID.test(id)) return undefined;
  const email = texte(o.email, LONGUEURS.email);
  const nom = texte(o.nom, LONGUEURS.nom);
  if (!nom && !email) return undefined;
  const statut = STATUTS.includes(o.statut as StatutProspect) ? (o.statut as StatutProspect) : 'nouveau';
  const iso = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : '1970-01-01T00:00:00.000Z');
  const p: Prospect = {
    id,
    nom,
    entreprise: texte(o.entreprise, LONGUEURS.entreprise),
    email,
    telephone: texte(o.telephone, LONGUEURS.telephone),
    source: texte(o.source, LONGUEURS.source),
    etiquettes: lireEtiquettes(o.etiquettes),
    statut,
    notes: texte(o.notes, LONGUEURS.notes),
    historique: lireHistorique(o.historique),
    nePlusContacter: o.nePlusContacter === true,
    creeLe: iso(o.creeLe),
    modifieLe: iso(o.modifieLe),
  };
  if (jourValide(o.relance)) p.relance = o.relance;
  return p;
}

function lireModeles(v: unknown): ModeleMessage[] {
  if (!Array.isArray(v)) return MODELES_DEFAUT.map(m => ({ ...m }));
  const vus = new Set<string>();
  const sortie: ModeleMessage[] = [];
  for (const m of v) {
    const o = m && typeof m === 'object' ? (m as Record<string, unknown>) : {};
    const id = typeof o.id === 'string' && /^[a-z0-9-]{2,32}$/.test(o.id) ? o.id : undefined;
    const nom = texte(o.nom, LONGUEURS.nomModele);
    if (!id || !nom || vus.has(id)) continue;
    vus.add(id);
    sortie.push({ id, nom, sujet: texte(o.sujet, LONGUEURS.sujet), corps: typeof o.corps === 'string' ? o.corps.slice(0, LONGUEURS.corps) : '' });
    if (sortie.length >= MAX_MODELES) break;
  }
  return sortie;
}

export function lireProspects(brut: unknown): DonneesProspects {
  const o = brut && typeof brut === 'object' && !Array.isArray(brut) ? (brut as Record<string, unknown>) : {};
  const source = o.prospects && typeof o.prospects === 'object' && !Array.isArray(o.prospects) ? (o.prospects as Record<string, unknown>) : {};
  const prospects: Record<string, Prospect> = {};
  for (const [id, p] of Object.entries(source)) {
    if (Object.keys(prospects).length >= MAX_PROSPECTS) break;
    const lu = lireProspect(p, id);
    if (lu) prospects[id] = lu;
  }
  return { prospects, modeles: lireModeles(o.modeles) };
}

// --- Saisie -----------------------------------------------------------------------

export interface SaisieProspect {
  nom: string;
  entreprise: string;
  email: string;
  telephone: string;
  source: string;
  /** Étiquettes séparées par des virgules. */
  etiquettes: string;
  statut: StatutProspect;
  /** Vide, AAAA-MM-JJ ou JJ/MM/AAAA. */
  relance: string;
  notes: string;
  nePlusContacter: boolean;
}

export const saisieVide = (): SaisieProspect => ({ nom: '', entreprise: '', email: '', telephone: '', source: '', etiquettes: '', statut: 'nouveau', relance: '', notes: '', nePlusContacter: false });

export function saisieDe(p: Prospect): SaisieProspect {
  return {
    nom: p.nom,
    entreprise: p.entreprise,
    email: p.email,
    telephone: p.telephone,
    source: p.source,
    etiquettes: p.etiquettes.join(', '),
    statut: p.statut,
    relance: p.relance ? jourFr(p.relance) : '',
    notes: p.notes,
    nePlusContacter: p.nePlusContacter,
  };
}

export class ErreurProspect extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurProspect';
  }
}

/** Adresse déjà utilisée par une autre fiche ? */
export function doublonDe(d: DonneesProspects, email: string, sauf?: string): Prospect | undefined {
  const cle = cleEmail(email);
  if (!cle) return undefined;
  return Object.values(d.prospects).find(p => p.id !== sauf && cleEmail(p.email) === cle);
}

/** Crée (sans `id`) ou modifie une fiche ; lève une ErreurProspect lisible. */
export function enregistrerProspect(d: DonneesProspects, saisie: SaisieProspect, maintenant: number, id?: string, alea?: () => number): { donnees: DonneesProspects; prospect: Prospect } {
  const email = saisie.email.trim();
  const nom = texte(saisie.nom, LONGUEURS.nom);
  if (!nom && !email) throw new ErreurProspect('Indiquez au moins un nom ou une adresse e-mail.');
  if (email && !emailValide(email)) throw new ErreurProspect(`Adresse e-mail invalide : « ${email} ».`);
  const autre = email ? doublonDe(d, email, id) : undefined;
  if (autre) throw new ErreurProspect(`Cette adresse est déjà dans le carnet (${autre.nom || autre.email}).`);
  let relance: string | undefined;
  if (saisie.relance.trim()) {
    relance = lireJour(saisie.relance);
    if (!relance) throw new ErreurProspect('Date de relance invalide (JJ/MM/AAAA).');
  }
  const existant = id ? d.prospects[id] : undefined;
  if (id && !existant) throw new ErreurProspect('Cette fiche n’existe plus.');
  if (!existant && Object.keys(d.prospects).length >= MAX_PROSPECTS) throw new ErreurProspect(`Le carnet est plein (${MAX_PROSPECTS} fiches).`);
  const iso = new Date(maintenant).toISOString();
  const prospect: Prospect = {
    id: existant?.id ?? nouvelId(maintenant, alea),
    nom,
    entreprise: texte(saisie.entreprise, LONGUEURS.entreprise),
    email,
    telephone: texte(saisie.telephone, LONGUEURS.telephone),
    source: texte(saisie.source, LONGUEURS.source),
    etiquettes: lireEtiquettes(saisie.etiquettes),
    statut: STATUTS.includes(saisie.statut) ? saisie.statut : 'nouveau',
    notes: texte(saisie.notes, LONGUEURS.notes),
    historique: existant?.historique ?? [],
    nePlusContacter: saisie.nePlusContacter,
    creeLe: existant?.creeLe ?? iso,
    modifieLe: iso,
  };
  if (relance) prospect.relance = relance;
  return { donnees: { ...d, prospects: { ...d.prospects, [prospect.id]: prospect } }, prospect };
}

export function supprimerProspect(d: DonneesProspects, id: string): DonneesProspects {
  if (!d.prospects[id]) return d;
  const prospects = { ...d.prospects };
  delete prospects[id];
  return { ...d, prospects };
}

/** Change une fiche existante (statut, relance, drapeau…) et la date. */
export function modifierProspect(d: DonneesProspects, id: string, changer: (p: Prospect) => Prospect, maintenant: number): DonneesProspects {
  const p = d.prospects[id];
  if (!p) return d;
  const suivant = lireProspect({ ...changer(p), modifieLe: new Date(maintenant).toISOString() }, id) ?? p;
  return { ...d, prospects: { ...d.prospects, [id]: suivant } };
}

/**
 * Note un contact (date + note). Un prospect « nouveau » passe à
 * « contacté », un « contacté » à « relancé » ; `relanceDans` (jours)
 * programme la relance suivante, sinon la relance échue est effacée.
 */
export function noterContact(p: Prospect, contact: { date: string; note: string; relanceDans?: number }, idContact: string): Prospect {
  if (!jourValide(contact.date)) throw new ErreurProspect('Date du contact invalide.');
  const historique = trierHistorique([...p.historique, { id: idContact, date: contact.date, note: texte(contact.note, LONGUEURS.note) }]).slice(-MAX_HISTORIQUE);
  const statut: StatutProspect = p.statut === 'nouveau' ? 'contacte' : p.statut === 'contacte' ? 'relance' : p.statut;
  const suivant: Prospect = { ...p, historique, statut };
  if (contact.relanceDans && contact.relanceDans > 0) suivant.relance = ajouterJours(contact.date, Math.min(365, Math.round(contact.relanceDans)));
  else if (suivant.relance && suivant.relance <= contact.date) delete suivant.relance;
  return suivant;
}

/** Ajout en lot depuis une liste collée : une fiche « nouveau » par adresse nouvelle. */
export function ajouterEnLot(
  d: DonneesProspects,
  saisie: string,
  options: { source?: string; etiquettes?: string },
  maintenant: number,
  alea?: () => number,
): { donnees: DonneesProspects; analyse: AnalyseListe; ajoutes: number } {
  const analyse = analyserListe(saisie, Object.values(d.prospects).map(p => p.email));
  const prospects = { ...d.prospects };
  const iso = new Date(maintenant).toISOString();
  let ajoutes = 0;
  for (const email of analyse.nouvelles) {
    if (Object.keys(prospects).length >= MAX_PROSPECTS) break;
    let id = nouvelId(maintenant, alea);
    while (prospects[id]) id = nouvelId(maintenant + 1, alea);
    prospects[id] = {
      id,
      nom: '',
      entreprise: '',
      email,
      telephone: '',
      source: texte(options.source ?? '', LONGUEURS.source),
      etiquettes: lireEtiquettes(options.etiquettes ?? ''),
      statut: 'nouveau',
      notes: '',
      historique: [],
      nePlusContacter: false,
      creeLe: iso,
      modifieLe: iso,
    };
    ajoutes++;
  }
  return { donnees: { ...d, prospects }, analyse, ajoutes };
}

// --- Liste : filtres, tri, relances, compteurs -------------------------------------

export function aRelancer(p: Prospect, aujourdhui: string): boolean {
  return Boolean(p.relance && p.relance <= aujourdhui && !STATUTS_CLOS.includes(p.statut) && !p.nePlusContacter);
}

export type TriProspects = 'relance' | 'nom' | 'entreprise' | 'statut' | 'recent';
export const LIBELLES_TRI: Record<TriProspects, string> = { relance: 'Relance', nom: 'Nom', entreprise: 'Entreprise', statut: 'Statut', recent: 'Récents' };

export interface FiltreProspects {
  recherche?: string;
  statut?: StatutProspect;
  etiquette?: string;
  /** Seulement ceux à relancer aujourd'hui (ou en retard). */
  aRelancer?: boolean;
}

const sansAccents = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function filtrerProspects(liste: readonly Prospect[], f: FiltreProspects, aujourdhui: string): Prospect[] {
  const mots = sansAccents(f.recherche ?? '').split(/\s+/).filter(Boolean);
  const etiquette = f.etiquette?.toLowerCase();
  return liste.filter(p => {
    if (f.statut && p.statut !== f.statut) return false;
    if (etiquette && !p.etiquettes.some(e => e.toLowerCase() === etiquette)) return false;
    if (f.aRelancer && !aRelancer(p, aujourdhui)) return false;
    if (mots.length > 0) {
      const foin = sansAccents([p.nom, p.entreprise, p.email, p.telephone, p.source, p.notes, ...p.etiquettes].join(' '));
      if (!mots.every(m => foin.includes(m))) return false;
    }
    return true;
  });
}

const comparer = (a: string, b: string) => a.localeCompare(b, 'fr', { sensitivity: 'base' });
const nomAffiche = (p: Prospect) => p.nom || p.email;

export function trierProspects(liste: readonly Prospect[], tri: TriProspects): Prospect[] {
  const copie = [...liste];
  switch (tri) {
    case 'nom':
      return copie.sort((a, b) => comparer(nomAffiche(a), nomAffiche(b)) || comparer(a.id, b.id));
    case 'entreprise':
      return copie.sort((a, b) => (a.entreprise ? (b.entreprise ? comparer(a.entreprise, b.entreprise) : -1) : b.entreprise ? 1 : 0) || comparer(nomAffiche(a), nomAffiche(b)));
    case 'statut':
      return copie.sort((a, b) => STATUTS.indexOf(a.statut) - STATUTS.indexOf(b.statut) || comparer(nomAffiche(a), nomAffiche(b)));
    case 'recent':
      return copie.sort((a, b) => (a.modifieLe === b.modifieLe ? comparer(a.id, b.id) : a.modifieLe < b.modifieLe ? 1 : -1));
    case 'relance':
    default:
      // Les relances datées d'abord (les plus anciennes en tête), puis le reste par nom.
      return copie.sort((a, b) => {
        if (a.relance && b.relance) return a.relance < b.relance ? -1 : a.relance > b.relance ? 1 : comparer(nomAffiche(a), nomAffiche(b));
        if (a.relance) return -1;
        if (b.relance) return 1;
        return comparer(nomAffiche(a), nomAffiche(b));
      });
  }
}

export interface Compteurs {
  total: number;
  aRelancer: number;
  /** Relance dépassée (avant aujourd'hui). */
  enRetard: number;
  parStatut: Record<StatutProspect, number>;
  nePlusContacter: number;
}

export function compter(liste: readonly Prospect[], aujourdhui: string): Compteurs {
  const parStatut = Object.fromEntries(STATUTS.map(s => [s, 0])) as Record<StatutProspect, number>;
  let relancer = 0;
  let retard = 0;
  let refus = 0;
  for (const p of liste) {
    parStatut[p.statut]++;
    if (aRelancer(p, aujourdhui)) {
      relancer++;
      if (p.relance! < aujourdhui) retard++;
    }
    if (p.nePlusContacter) refus++;
  }
  return { total: liste.length, aRelancer: relancer, enRetard: retard, parStatut, nePlusContacter: refus };
}

/** Étiquettes utilisées, triées (pour le filtre). */
export function etiquettesUtilisees(liste: readonly Prospect[]): string[] {
  const vues = new Map<string, string>();
  for (const p of liste) for (const e of p.etiquettes) if (!vues.has(e.toLowerCase())) vues.set(e.toLowerCase(), e);
  return [...vues.values()].sort(comparer);
}

/** « Relance le 06/10/2026 (en retard de 2 j) ». */
export function texteRelance(p: Prospect, aujourdhui: string): string {
  if (!p.relance) return 'Pas de relance prévue';
  const ecart = Math.round((Date.parse(`${p.relance}T12:00:00Z`) - Date.parse(`${aujourdhui}T12:00:00Z`)) / 86_400_000);
  const relatif = ecart < 0 ? `en retard de ${-ecart} j` : ecart === 0 ? 'aujourd’hui' : `dans ${ecart} j`;
  return `Relance le ${jourFr(p.relance)} (${relatif})`;
}

// --- Modèles et mailto -------------------------------------------------------------

/** Prénom : premier mot du nom (« Léa Martin » → « Léa ») ; vide sinon. */
export function prenomDe(p: Pick<Prospect, 'nom'>): string {
  return p.nom.trim().split(/\s+/)[0] ?? '';
}

/** Remplace {prenom}, {nom}, {entreprise}, {email} ; une variable vide disparaît proprement. */
export function rendreModele(modele: string, p: Pick<Prospect, 'nom' | 'entreprise' | 'email'>): string {
  const valeurs: Record<string, string> = { prenom: prenomDe(p), nom: p.nom.trim(), entreprise: p.entreprise.trim(), email: p.email.trim() };
  return modele
    .replace(/\{(prenom|nom|entreprise|email)\}/gi, (_m, cle: string) => valeurs[cle.toLowerCase()] ?? '')
    .replace(/ +([,.])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ');
}

/** Pourquoi « Écrire » est bloqué, ou undefined s'il est permis. */
export function blocageEcrire(p: Prospect): string | undefined {
  if (p.nePlusContacter) return 'Cette personne a demandé à ne plus être contactée.';
  if (!p.email) return 'Aucune adresse e-mail.';
  if (!emailValide(p.email)) return 'Adresse e-mail invalide.';
  return undefined;
}

/** Lien `mailto:` d'UN message ; undefined si « Écrire » est bloqué. */
export function lienMailto(p: Prospect, modele?: Pick<ModeleMessage, 'sujet' | 'corps'>): string | undefined {
  if (blocageEcrire(p)) return undefined;
  const parametres: string[] = [];
  if (modele?.sujet) parametres.push(`subject=${encodeURIComponent(rendreModele(modele.sujet, p))}`);
  if (modele?.corps) parametres.push(`body=${encodeURIComponent(rendreModele(modele.corps, p).replace(/\r?\n/g, '\r\n'))}`);
  return `mailto:${encodeURIComponent(p.email.trim()).replace(/%40/g, '@')}${parametres.length ? `?${parametres.join('&')}` : ''}`;
}

export function enregistrerModele(d: DonneesProspects, modele: { id?: string; nom: string; sujet: string; corps: string }): DonneesProspects {
  const nom = texte(modele.nom, LONGUEURS.nomModele);
  if (!nom) throw new ErreurProspect('Donnez un nom au modèle.');
  if (!modele.corps.trim()) throw new ErreurProspect('Le message du modèle est vide.');
  const existant = modele.id ? d.modeles.find(m => m.id === modele.id) : undefined;
  if (!existant && d.modeles.length >= MAX_MODELES) throw new ErreurProspect(`${MAX_MODELES} modèles au plus.`);
  let id = existant?.id;
  if (!id) {
    const base = sansAccents(nom).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'modele';
    id = base.length >= 2 ? base : `m-${base}`;
    for (let n = 2; d.modeles.some(m => m.id === id); n++) id = `${base}-${n}`;
  }
  const suivant: ModeleMessage = { id, nom, sujet: texte(modele.sujet, LONGUEURS.sujet), corps: modele.corps.slice(0, LONGUEURS.corps) };
  return { ...d, modeles: existant ? d.modeles.map(m => (m.id === id ? suivant : m)) : [...d.modeles, suivant] };
}

export function supprimerModele(d: DonneesProspects, id: string): DonneesProspects {
  return { ...d, modeles: d.modeles.filter(m => m.id !== id) };
}

// --- CSV ---------------------------------------------------------------------------

function cellule(valeur: string): string {
  let t = valeur;
  // Un tableur exécuterait une formule : on la neutralise.
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[";,\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export const COLONNES_CSV = ['nom', 'entreprise', 'email', 'telephone', 'source', 'etiquettes', 'statut', 'prochaine_relance', 'ne_plus_contacter', 'notes', 'historique', 'cree_le', 'modifie_le'] as const;

/** Export COMPLET (toutes les colonnes, historique « AAAA-MM-JJ : note » séparé par « | »). */
export function exporterCsv(liste: readonly Prospect[]): string {
  const lignes = [COLONNES_CSV.join(',')];
  for (const p of liste) {
    const ligne = [
      p.nom,
      p.entreprise,
      p.email,
      p.telephone,
      p.source,
      p.etiquettes.join('|'),
      p.statut,
      p.relance ?? '',
      p.nePlusContacter ? 'oui' : 'non',
      p.notes,
      p.historique.map(h => `${h.date} : ${h.note.replace(/\|/g, '/')}`).join(' | '),
      p.creeLe,
      p.modifieLe,
    ];
    lignes.push(ligne.map(cellule).join(','));
  }
  return `﻿${lignes.join('\r\n')}\r\n`;
}

/** Découpe un CSV (virgule ou point-virgule détecté sur l'en-tête, guillemets doublés). */
export function lireCsv(contenu: string): string[][] {
  const texteCsv = contenu.replace(/^﻿/, '');
  const premiere = texteCsv.split(/\r?\n/, 1)[0] ?? '';
  const sep = (premiere.match(/;/g)?.length ?? 0) > (premiere.match(/,/g)?.length ?? 0) ? ';' : premiere.includes('\t') && !premiere.includes(',') ? '\t' : ',';
  const lignes: string[][] = [];
  let ligne: string[] = [];
  let champ = '';
  let guillemets = false;
  for (let i = 0; i < texteCsv.length; i++) {
    const c = texteCsv[i];
    if (guillemets) {
      if (c === '"') {
        if (texteCsv[i + 1] === '"') {
          champ += '"';
          i++;
        } else guillemets = false;
      } else champ += c;
    } else if (c === '"' && champ === '') guillemets = true;
    else if (c === sep) {
      ligne.push(champ);
      champ = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texteCsv[i + 1] === '\n') i++;
      ligne.push(champ);
      champ = '';
      if (ligne.some(v => v.trim())) lignes.push(ligne);
      ligne = [];
    } else champ += c;
  }
  ligne.push(champ);
  if (ligne.some(v => v.trim())) lignes.push(ligne);
  return lignes;
}

const ALIAS: Record<string, keyof SaisieProspect | 'historique'> = {
  nom: 'nom',
  name: 'nom',
  'nom complet': 'nom',
  contact: 'nom',
  entreprise: 'entreprise',
  societe: 'entreprise',
  company: 'entreprise',
  organisation: 'entreprise',
  email: 'email',
  'e-mail': 'email',
  mail: 'email',
  courriel: 'email',
  'adresse e-mail': 'email',
  'adresse mail': 'email',
  telephone: 'telephone',
  tel: 'telephone',
  phone: 'telephone',
  portable: 'telephone',
  source: 'source',
  origine: 'source',
  etiquettes: 'etiquettes',
  etiquette: 'etiquettes',
  tags: 'etiquettes',
  statut: 'statut',
  status: 'statut',
  relance: 'relance',
  prochaine_relance: 'relance',
  'prochaine relance': 'relance',
  notes: 'notes',
  note: 'notes',
  ne_plus_contacter: 'nePlusContacter',
  'ne plus contacter': 'nePlusContacter',
  historique: 'historique',
};

const statutDepuisTexte = (t: string): StatutProspect | undefined => {
  const s = sansAccents(t.trim()).replace(/\s+/g, '-');
  return STATUTS.find(x => x === s || sansAccents(LIBELLES_STATUT_PROSPECT[x]).replace(/\s+/g, '-') === s);
};

export interface BilanImport {
  ajoutes: number;
  doublons: number;
  invalides: number;
  /** Lignes ignorées, avec leur numéro (1 = en-tête). */
  details: string[];
}

/**
 * Importe un CSV (colonnes simples : nom, entreprise, email, téléphone,
 * source, étiquettes, statut, relance, notes… ; noms français ou anglais,
 * sans casse ni accents). Une adresse déjà présente n'est pas réimportée (la
 * fiche existante, et son éventuel « ne plus contacter », restent).
 * Accepte aussi l'export de cette app (historique compris).
 */
export function importerCsv(d: DonneesProspects, contenu: string, maintenant: number, alea?: () => number): { donnees: DonneesProspects; bilan: BilanImport } {
  const lignes = lireCsv(contenu);
  const bilan: BilanImport = { ajoutes: 0, doublons: 0, invalides: 0, details: [] };
  if (lignes.length === 0) return { donnees: d, bilan };
  const entete = lignes[0].map(c => ALIAS[sansAccents(c.trim()).replace(/^'/, '')]);
  if (!entete.includes('email') && !entete.includes('nom')) {
    throw new ErreurProspect('En-tête non reconnu : il faut au moins une colonne « email » ou « nom ».');
  }
  let courant = d;
  const iso = new Date(maintenant).toISOString();
  for (let n = 1; n < lignes.length; n++) {
    const valeurs: Partial<Record<keyof SaisieProspect | 'historique', string>> = {};
    entete.forEach((cle, i) => {
      if (cle) valeurs[cle] = (lignes[n][i] ?? '').trim().replace(/^'(?=[=+\-@])/, '');
    });
    const email = valeurs.email ?? '';
    if (email && !emailValide(email)) {
      bilan.invalides++;
      bilan.details.push(`Ligne ${n + 1} : adresse invalide « ${email.slice(0, 60)} »`);
      continue;
    }
    if (!email && !valeurs.nom) {
      bilan.invalides++;
      bilan.details.push(`Ligne ${n + 1} : ni nom ni adresse`);
      continue;
    }
    if (email && doublonDe(courant, email)) {
      bilan.doublons++;
      continue;
    }
    if (Object.keys(courant.prospects).length >= MAX_PROSPECTS) {
      bilan.details.push(`Carnet plein (${MAX_PROSPECTS} fiches) : import arrêté ligne ${n + 1}`);
      break;
    }
    const saisie: SaisieProspect = {
      ...saisieVide(),
      nom: valeurs.nom ?? '',
      entreprise: valeurs.entreprise ?? '',
      email,
      telephone: valeurs.telephone ?? '',
      source: valeurs.source ?? '',
      etiquettes: (valeurs.etiquettes ?? '').replace(/\|/g, ','),
      statut: statutDepuisTexte(valeurs.statut ?? '') ?? 'nouveau',
      relance: valeurs.relance && lireJour(valeurs.relance) ? valeurs.relance : '',
      notes: valeurs.notes ?? '',
      nePlusContacter: /^(oui|yes|vrai|true|1|x)$/i.test(valeurs.nePlusContacter ?? ''),
    };
    try {
      const { donnees, prospect } = enregistrerProspect(courant, saisie, maintenant, undefined, alea);
      const historique: ContactProspect[] = [];
      for (const [i, morceau] of (valeurs.historique ?? '').split('|').entries()) {
        const m = /^\s*(\d{4}-\d{2}-\d{2})\s*:?\s*(.*)$/.exec(morceau);
        if (m && jourValide(m[1])) historique.push({ id: `${prospect.id}h${i}`.slice(0, 32), date: m[1], note: m[2].trim() });
      }
      courant = historique.length ? { ...donnees, prospects: { ...donnees.prospects, [prospect.id]: { ...prospect, historique: lireHistorique(historique), modifieLe: iso } } } : donnees;
      bilan.ajoutes++;
    } catch (e) {
      bilan.invalides++;
      bilan.details.push(`Ligne ${n + 1} : ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { donnees: courant, bilan };
}

// --- Entités de synchronisation ------------------------------------------------------

export const PREFIXE_ENTITE_PROSPECT = 'prospect';
export const ENTITE_MODELES = 'prospects-modeles';

export function entitesProspects(d: DonneesProspects): Record<string, unknown> {
  const e: Record<string, unknown> = {};
  if (JSON.stringify(d.modeles) !== JSON.stringify(MODELES_DEFAUT)) e[ENTITE_MODELES] = d.modeles;
  for (const [id, p] of Object.entries(d.prospects)) e[`${PREFIXE_ENTITE_PROSPECT}:${id}`] = p;
  return e;
}

export function prospectsDepuisEntites(e: Record<string, unknown>): DonneesProspects {
  const prospects: Record<string, unknown> = {};
  for (const [cle, valeur] of Object.entries(e)) {
    if (cle.startsWith(`${PREFIXE_ENTITE_PROSPECT}:`)) prospects[cle.slice(PREFIXE_ENTITE_PROSPECT.length + 1)] = valeur;
  }
  return lireProspects({ prospects, modeles: e[ENTITE_MODELES] });
}
