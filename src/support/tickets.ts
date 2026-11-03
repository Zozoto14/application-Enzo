/**
 * Demandes de support : données pures (formulaire, historique, corps envoyé).
 *
 * Une demande part vers le relais (`POST /support`), qui la RANGE (sous l'identifiant du compte
 * vérifié par le jeton : personne d'autre ne la lit) puis l'annonce sur le salon Discord du support.
 * L'historique local (profil chiffré, paramètre `support.tickets`) garde aussi les demandes pas
 * encore parties (hors ligne) ; une fois partie, une demande est complétée par ce que dit le relais :
 * statut (ouverte, en cours, répondu, résolue), conversation avec le Fondateur, réponses non lues.
 * Jamais de mot de passe, de clé ni de jeton : les informations techniques sont une liste fermée
 * (version, plateforme, appareil, app, langue, rang).
 */

import type { NomIcone } from '../ui/icones/traces';

export type CategorieTicket = 'bug' | 'idee' | 'question' | 'compte';

export const CATEGORIES_TICKET: ReadonlyArray<{ id: CategorieTicket; libelle: string; /** Icône monochrome (src/ui/icones). */ icone: NomIcone; couleur: string }> = [
  { id: 'bug', libelle: 'Bug', icone: 'bug', couleur: '#e5484d' },
  { id: 'idee', libelle: 'Idée', icone: 'ampoule', couleur: '#f5a524' },
  { id: 'question', libelle: 'Question', icone: 'question', couleur: '#3b82f6' },
  { id: 'compte', libelle: 'Compte', icone: 'personne', couleur: '#8b5cf6' },
];
/** Anciennes catégories (historique des versions précédentes). */
const ALIAS_CATEGORIES: Record<string, CategorieTicket> = { demande: 'idee', autre: 'question' };

/** État de l'ENVOI (local) : partie, en erreur, en attente (hors ligne). */
export type StatutTicket = 'envoye' | 'erreur' | 'attente';
/** État de la demande côté support (relais). */
export type StatutServeur = 'ouvert' | 'en_cours' | 'repondu' | 'resolu';

export const LIBELLES_STATUT: Record<StatutTicket, string> = {
  envoye: 'Envoyée',
  erreur: 'Erreur',
  attente: 'En attente (hors ligne)',
};
export const LIBELLES_STATUT_SERVEUR: Record<StatutServeur, string> = {
  ouvert: 'Ouverte',
  en_cours: 'En cours',
  repondu: 'Répondu',
  resolu: 'Résolue',
};
export const STATUTS_SERVEUR: readonly StatutServeur[] = ['ouvert', 'en_cours', 'repondu', 'resolu'];

export const TAILLE_MAX_TITRE = 100;
export const TAILLE_MAX_MESSAGE = 4000;
export const TAILLE_MIN_TITRE = 3;
export const TAILLE_MIN_MESSAGE = 10;
/** Octets de la capture (avant base 64) : même borne que le relais. */
export const TAILLE_MAX_PIECE = 4 * 1024 * 1024;
export const TYPES_PIECE: readonly string[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_TICKETS_GARDES = 50;

export interface InfosTechniques {
  version: string;
  plateforme: string;
  /** Type d'appareil (iPhone, iPad, PC, Mac, Android, navigateur). */
  appareil: string;
  /** App ouverte au moment de la demande (portefeuille, esport…), sinon « hub ». */
  app: string;
  langue: string;
  rang: string;
}

export interface PieceJointe {
  nom: string;
  type: string;
  /** Contenu en base 64. Gardé seulement tant que la demande n'est pas partie. */
  donnees: string;
}

export interface MessageTicket {
  id: string;
  /** `equipe` : le Fondateur ; `utilisateur` : l'auteur de la demande. */
  de: 'equipe' | 'utilisateur';
  texte: string;
  date: string;
}

export interface Ticket {
  /** Numéro local (ordre de l'historique de cet appareil). */
  numero: number;
  date: string;
  categorie: CategorieTicket;
  titre: string;
  message: string;
  statut: StatutTicket;
  erreur?: string;
  technique?: InfosTechniques;
  /** Nom de la capture jointe (le contenu n'est gardé que pour un renvoi). */
  pieceNom?: string;
  piece?: PieceJointe;
  tentatives: number;
  /** Relais : identifiant, numéro du support, statut, conversation, réponses non lues. */
  id?: string;
  numeroServeur?: number;
  statutServeur?: StatutServeur;
  messages?: MessageTicket[];
  nonLus?: number;
}

export interface FormulaireTicket {
  categorie: CategorieTicket;
  titre: string;
  message: string;
  inclureTechnique: boolean;
  piece?: PieceJointe;
}

/** Message d'erreur du formulaire, ou rien s'il est valide. */
export function erreurFormulaire(f: Pick<FormulaireTicket, 'categorie' | 'titre' | 'message' | 'piece'>): string | undefined {
  if (!CATEGORIES_TICKET.some(c => c.id === f.categorie)) return 'Choisissez une catégorie.';
  const titre = f.titre.trim();
  const message = f.message.trim();
  if (titre.length < TAILLE_MIN_TITRE) return `Le titre est trop court (${TAILLE_MIN_TITRE} caractères au moins).`;
  if (titre.length > TAILLE_MAX_TITRE) return `Le titre est trop long (${TAILLE_MAX_TITRE} caractères au plus).`;
  if (message.length < TAILLE_MIN_MESSAGE) return `Décrivez un peu plus : ${TAILLE_MIN_MESSAGE} caractères au moins.`;
  if (message.length > TAILLE_MAX_MESSAGE) return `Le message est trop long (${TAILLE_MAX_MESSAGE} caractères au plus).`;
  if (f.piece) {
    if (!TYPES_PIECE.includes(f.piece.type)) return 'La capture doit être une image PNG, JPEG, GIF ou WebP.';
    if (octetsDeBase64(f.piece.donnees) > TAILLE_MAX_PIECE) return 'La capture est trop volumineuse (4 Mo au plus).';
  }
  return undefined;
}

export function octetsDeBase64(donnees: string): number {
  const remplissage = donnees.endsWith('==') ? 2 : donnees.endsWith('=') ? 1 : 0;
  return Math.floor((donnees.length * 3) / 4) - remplissage;
}

/** Appareil lisible d'après le navigateur ou la plateforme (jamais d'identifiant). */
export function appareilDe(plateforme: string, agent?: string): string {
  const ua = agent ?? (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent ?? '';
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile/i.test(ua))) return 'iPad';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/Android/i.test(ua)) return 'Android';
  if (/Electron/i.test(ua)) return 'PC (app)';
  if (/Windows/i.test(ua)) return 'PC (navigateur)';
  if (/Macintosh/i.test(ua)) return 'Mac (navigateur)';
  if (plateforme === 'ios') return 'iPhone';
  if (plateforme === 'android') return 'Android';
  if (/Linux|CrOS/i.test(ua)) return 'PC (navigateur)';
  return plateforme === 'web' || plateforme === 'site' ? 'Navigateur' : plateforme || 'inconnu';
}

export function infosTechniques(entree: { version: string; plateforme: string; rang?: string; app?: string; langue?: string; appareil?: string }): InfosTechniques {
  return {
    version: entree.version.slice(0, 40),
    plateforme: entree.plateforme.slice(0, 40),
    appareil: (entree.appareil ?? appareilDe(entree.plateforme)).slice(0, 60),
    app: (entree.app ?? 'hub').slice(0, 40),
    langue: (entree.langue ?? 'fr').slice(0, 5),
    rang: (entree.rang ?? 'inconnu').slice(0, 30),
  };
}

export function prochainNumero(tickets: readonly Pick<Ticket, 'numero'>[]): number {
  return tickets.reduce((max, t) => Math.max(max, t.numero), 0) + 1;
}

export function nouveauTicket(f: FormulaireTicket, numero: number, technique: InfosTechniques | undefined, maintenant: string): Ticket {
  return {
    numero,
    date: maintenant,
    categorie: f.categorie,
    titre: f.titre.trim(),
    message: f.message.trim(),
    statut: 'attente',
    tentatives: 0,
    ...(f.inclureTechnique && technique ? { technique } : {}),
    ...(f.piece ? { pieceNom: f.piece.nom, piece: f.piece } : {}),
  };
}

/** Corps de `POST /support`. Liste fermée de champs : rien d'autre ne part. */
export function corpsDuTicket(t: Ticket, auteur?: string): Record<string, unknown> {
  const tech = t.technique;
  return {
    numero: t.numero,
    categorie: t.categorie,
    titre: t.titre,
    message: t.message,
    langue: tech?.langue === 'en' ? 'en' : 'fr',
    ...(auteur ? { auteur: auteur.slice(0, 40) } : {}),
    ...(tech ? { technique: { version: tech.version, plateforme: tech.plateforme, appareil: tech.appareil, app: tech.app, langue: tech.langue, rang: tech.rang } } : {}),
    ...(t.piece ? { piece: { nom: t.piece.nom, type: t.piece.type, donnees: t.piece.donnees } } : {}),
  };
}

const STATUTS: readonly StatutTicket[] = ['envoye', 'erreur', 'attente'];

function texte(v: unknown, max: number): string | undefined {
  return typeof v === 'string' ? v.slice(0, max) : undefined;
}

export function lireMessages(v: unknown): MessageTicket[] {
  if (!Array.isArray(v)) return [];
  const sortie: MessageTicket[] = [];
  for (const m of v.slice(-60)) {
    if (!m || typeof m !== 'object') continue;
    const o = m as Record<string, unknown>;
    const t = texte(o.texte, TAILLE_MAX_MESSAGE);
    if (!t || (o.de !== 'equipe' && o.de !== 'utilisateur')) continue;
    sortie.push({ id: texte(o.id, 40) ?? '', de: o.de, texte: t, date: texte(o.date, 40) ?? '' });
  }
  return sortie;
}

/** Relit l'historique enregistré : tout ce qui est invalide est écarté (anciens formats compris). */
export function lireTickets(brut: string | undefined | null): Ticket[] {
  if (!brut) return [];
  let lu: unknown;
  try {
    lu = JSON.parse(brut);
  } catch {
    return [];
  }
  if (!Array.isArray(lu)) return [];
  const tickets: Ticket[] = [];
  for (const e of lu) {
    if (!e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    const categorie = CATEGORIES_TICKET.find(c => c.id === o.categorie)?.id ?? ALIAS_CATEGORIES[String(o.categorie)];
    const statut = STATUTS.find(s => s === o.statut);
    const titre = texte(o.titre ?? o.sujet, TAILLE_MAX_TITRE);
    const message = texte(o.message, TAILLE_MAX_MESSAGE);
    const date = texte(o.date, 40);
    if (!categorie || !statut || !titre || !message || !date || !Number.isInteger(o.numero) || (o.numero as number) < 1) continue;
    const t: Ticket = { numero: o.numero as number, date, categorie, titre, message, statut, tentatives: Number.isInteger(o.tentatives) ? (o.tentatives as number) : 0 };
    const erreur = texte(o.erreur, 300);
    if (erreur) t.erreur = erreur;
    const pieceNom = texte(o.pieceNom, 60);
    if (pieceNom) t.pieceNom = pieceNom;
    const tech = o.technique as Record<string, unknown> | undefined;
    if (tech && typeof tech === 'object') {
      t.technique = {
        version: texte(tech.version, 40) ?? '',
        plateforme: texte(tech.plateforme, 40) ?? '',
        appareil: texte(tech.appareil, 60) ?? '',
        app: texte(tech.app, 40) ?? '',
        langue: texte(tech.langue, 5) ?? '',
        rang: texte(tech.rang, 30) ?? '',
      };
    }
    const p = o.piece as Record<string, unknown> | undefined;
    if (p && typeof p === 'object' && typeof p.donnees === 'string' && typeof p.type === 'string' && TYPES_PIECE.includes(p.type) && t.statut !== 'envoye') {
      t.piece = { nom: texte(p.nom, 60) ?? 'capture', type: p.type, donnees: p.donnees };
    }
    if (typeof o.id === 'string' && /^[0-9a-f]{16}$/.test(o.id)) t.id = o.id;
    if (Number.isInteger(o.numeroServeur)) t.numeroServeur = o.numeroServeur as number;
    const s = STATUTS_SERVEUR.find(x => x === o.statutServeur);
    if (s) t.statutServeur = s;
    const messages = lireMessages(o.messages);
    if (messages.length) t.messages = messages;
    if (Number.isInteger(o.nonLus) && (o.nonLus as number) > 0) t.nonLus = o.nonLus as number;
    tickets.push(t);
  }
  return tickets;
}

/** Sérialise l'historique : plus récents d'abord gardés, capture retirée dès que la demande est partie. */
export function ecrireTickets(tickets: readonly Ticket[]): string {
  const gardes = [...tickets]
    .sort((a, b) => b.numero - a.numero)
    .slice(0, MAX_TICKETS_GARDES)
    .map(t => {
      const { piece, ...sans } = t;
      return t.statut === 'envoye' || !piece ? sans : t;
    });
  return JSON.stringify(gardes);
}

/** Vue d'une demande rendue par le relais (`GET /support/tickets`, création, réponse). */
export interface VueServeur {
  id: string;
  numero: number;
  categorie: string;
  titre: string;
  message: string;
  statut: string;
  cree: string;
  maj?: string;
  technique?: Partial<InfosTechniques> | null;
  pieceNom?: string | null;
  messages?: unknown;
  nonLus?: number;
  discord?: string;
  /** Fondateur seulement. */
  compte?: string;
  auteur?: string;
  discordFil?: boolean;
  notifie?: { date: string; courriel: string | null } | null;
}

/** Applique ce que dit le relais sur une demande locale. */
export function avecVueServeur(t: Ticket, v: VueServeur): Ticket {
  const statut = STATUTS_SERVEUR.find(s => s === v.statut);
  return {
    ...t,
    id: v.id,
    numeroServeur: v.numero,
    ...(statut ? { statutServeur: statut } : {}),
    messages: lireMessages(v.messages),
    nonLus: Number.isInteger(v.nonLus) ? Math.max(0, v.nonLus as number) : 0,
  };
}

/** Demande connue du relais seulement (envoyée d'un autre appareil) : ajoutée à l'historique. */
export function ticketDepuisServeur(v: VueServeur, numero: number): Ticket | undefined {
  const categorie = CATEGORIES_TICKET.find(c => c.id === v.categorie)?.id ?? ALIAS_CATEGORIES[v.categorie];
  if (!categorie || typeof v.titre !== 'string' || typeof v.message !== 'string') return undefined;
  return avecVueServeur(
    { numero, date: v.cree, categorie, titre: v.titre.slice(0, TAILLE_MAX_TITRE), message: v.message.slice(0, TAILLE_MAX_MESSAGE), statut: 'envoye', tentatives: 1, ...(v.pieceNom ? { pieceNom: v.pieceNom } : {}) },
    v,
  );
}
