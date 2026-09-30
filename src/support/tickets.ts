/**
 * Tickets de support : données pures (formulaire, historique, corps envoyé).
 *
 * Le ticket part vers le relais (`POST /support`), qui le poste sur un salon
 * Discord ; le relais ne garde rien. L'historique « Mes tickets » n'existe donc
 * que dans le profil chiffré de l'utilisateur (paramètre `support.tickets`).
 * Jamais de mot de passe, de clé ni de jeton dans un ticket : les informations
 * techniques sont une liste fermée (version, plateforme, rang, id de compte court).
 */

export type CategorieTicket = 'bug' | 'question' | 'demande' | 'autre';

export const CATEGORIES_TICKET: ReadonlyArray<{ id: CategorieTicket; libelle: string }> = [
  { id: 'bug', libelle: 'Bug' },
  { id: 'question', libelle: 'Question' },
  { id: 'demande', libelle: 'Demande' },
  { id: 'autre', libelle: 'Autre' },
];

export type StatutTicket = 'envoye' | 'erreur' | 'attente';

export const LIBELLES_STATUT: Record<StatutTicket, string> = {
  envoye: 'Envoyé',
  erreur: 'Erreur',
  attente: 'En attente (hors ligne)',
};

export const TAILLE_MAX_SUJET = 100;
export const TAILLE_MAX_MESSAGE = 2000;
export const TAILLE_MIN_SUJET = 3;
export const TAILLE_MIN_MESSAGE = 10;
/** Octets de la capture (avant base 64) : même borne que le relais. */
export const TAILLE_MAX_PIECE = 4 * 1024 * 1024;
export const TYPES_PIECE: readonly string[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_TICKETS_GARDES = 50;

export interface InfosTechniques {
  version: string;
  plateforme: string;
  rang: string;
  /** Début de l'identifiant du compte (6 caractères), jamais l'identifiant complet. */
  compte: string;
}

export interface PieceJointe {
  nom: string;
  type: string;
  /** Contenu en base 64. Gardé seulement tant que le ticket n'est pas parti. */
  donnees: string;
}

export interface Ticket {
  numero: number;
  date: string;
  categorie: CategorieTicket;
  sujet: string;
  message: string;
  statut: StatutTicket;
  erreur?: string;
  technique?: InfosTechniques;
  /** Nom de la capture jointe (le contenu n'est gardé que pour un renvoi). */
  pieceNom?: string;
  piece?: PieceJointe;
  tentatives: number;
}

export interface FormulaireTicket {
  categorie: CategorieTicket;
  sujet: string;
  message: string;
  inclureTechnique: boolean;
  piece?: PieceJointe;
}

/** Message d'erreur du formulaire, ou rien s'il est valide. */
export function erreurFormulaire(f: Pick<FormulaireTicket, 'categorie' | 'sujet' | 'message' | 'piece'>): string | undefined {
  if (!CATEGORIES_TICKET.some(c => c.id === f.categorie)) return 'Choisissez une catégorie.';
  const sujet = f.sujet.trim();
  const message = f.message.trim();
  if (sujet.length < TAILLE_MIN_SUJET) return `Le sujet est trop court (${TAILLE_MIN_SUJET} caractères au moins).`;
  if (sujet.length > TAILLE_MAX_SUJET) return `Le sujet est trop long (${TAILLE_MAX_SUJET} caractères au plus).`;
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

export function infosTechniques(entree: { version: string; plateforme: string; rang?: string; idCompte?: string }): InfosTechniques {
  return {
    version: entree.version.slice(0, 40),
    plateforme: entree.plateforme.slice(0, 40),
    rang: (entree.rang ?? 'inconnu').slice(0, 30),
    compte: (entree.idCompte ?? '').slice(0, 6),
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
    sujet: f.sujet.trim(),
    message: f.message.trim(),
    statut: 'attente',
    tentatives: 0,
    ...(f.inclureTechnique && technique ? { technique } : {}),
    ...(f.piece ? { pieceNom: f.piece.nom, piece: f.piece } : {}),
  };
}

/** Corps de `POST /support`. Liste fermée de champs : rien d'autre ne part. */
export function corpsDuTicket(t: Ticket): Record<string, unknown> {
  return {
    numero: t.numero,
    categorie: t.categorie,
    sujet: t.sujet,
    message: t.message,
    ...(t.technique ? { technique: { version: t.technique.version, plateforme: t.technique.plateforme, rang: t.technique.rang, compte: t.technique.compte } } : {}),
    ...(t.piece ? { piece: { nom: t.piece.nom, type: t.piece.type, donnees: t.piece.donnees } } : {}),
  };
}

const STATUTS: readonly StatutTicket[] = ['envoye', 'erreur', 'attente'];

function texte(v: unknown, max: number): string | undefined {
  return typeof v === 'string' ? v.slice(0, max) : undefined;
}

/** Relit l'historique enregistré : tout ce qui est invalide est écarté. */
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
    const categorie = CATEGORIES_TICKET.find(c => c.id === o.categorie)?.id;
    const statut = STATUTS.find(s => s === o.statut);
    const sujet = texte(o.sujet, TAILLE_MAX_SUJET);
    const message = texte(o.message, TAILLE_MAX_MESSAGE);
    const date = texte(o.date, 40);
    if (!categorie || !statut || !sujet || !message || !date || !Number.isInteger(o.numero) || (o.numero as number) < 1) continue;
    const t: Ticket = { numero: o.numero as number, date, categorie, sujet, message, statut, tentatives: Number.isInteger(o.tentatives) ? (o.tentatives as number) : 0 };
    const erreur = texte(o.erreur, 300);
    if (erreur) t.erreur = erreur;
    const pieceNom = texte(o.pieceNom, 60);
    if (pieceNom) t.pieceNom = pieceNom;
    const tech = o.technique as Record<string, unknown> | undefined;
    if (tech && typeof tech === 'object') {
      t.technique = { version: texte(tech.version, 40) ?? '', plateforme: texte(tech.plateforme, 40) ?? '', rang: texte(tech.rang, 30) ?? '', compte: texte(tech.compte, 6) ?? '' };
    }
    const p = o.piece as Record<string, unknown> | undefined;
    if (p && typeof p === 'object' && typeof p.donnees === 'string' && typeof p.type === 'string' && TYPES_PIECE.includes(p.type) && t.statut !== 'envoye') {
      t.piece = { nom: texte(p.nom, 60) ?? 'capture', type: p.type, donnees: p.donnees };
    }
    tickets.push(t);
  }
  return tickets;
}

/** Sérialise l'historique : plus récents d'abord gardés, capture retirée dès que le ticket est parti. */
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
