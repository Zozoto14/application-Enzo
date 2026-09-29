/**
 * Journal d'audit de l'Administration.
 *
 * Il vit dans la base chiffrée de l'administrateur (voir `donnees.ts`) : un
 * ami ne le lit pas, et rien n'en sort de l'appareil sans export explicite.
 *
 * **Aucun secret n'y entre.** Les événements ne portent que des identifiants
 * de profil, des prénoms, des identifiants d'app et un texte court écrit par
 * l'Administration elle-même ; `nettoyerTexte` borne ce texte et retire tout
 * ce qui ressemble à un mot de passe généré, à une clé TOTP ou à un code de
 * récupération, par précaution contre une erreur future d'appelant.
 *
 * Taille bornée (nombre d'entrées) et rétention (jours) : les deux limites
 * s'appliquent à chaque ajout. Tout est pur : l'horloge est passée en argument.
 */

export const TYPES_EVENEMENT = [
  'compte',
  'permissions',
  'invitation',
  'identifiants',
  'app',
  'securite',
  'reglages',
  'connexion',
  'acces-admin',
  'export',
] as const;
export type TypeEvenement = (typeof TYPES_EVENEMENT)[number];

export const LIBELLES_TYPE: Record<TypeEvenement, string> = {
  compte: 'Compte',
  permissions: 'Permissions',
  invitation: 'Invitation',
  identifiants: 'Identifiants',
  app: 'Application',
  securite: 'Sécurité',
  reglages: 'Réglages',
  connexion: 'Connexion',
  'acces-admin': 'Accès administrateur',
  export: 'Export',
};

export interface EvenementAudit {
  /** Horodatage ISO. */
  date: string;
  type: TypeEvenement;
  /** Ce qui s'est passé, en une phrase. Jamais de secret. */
  action: string;
  /** Profil concerné (identifiant), s'il y en a un. */
  cible?: string;
  /** Prénom du profil concerné au moment de l'événement. */
  nomCible?: string;
  /** App concernée (identifiant du registre). */
  app?: string;
}

export const TAILLE_MAX_JOURNAL = 2000;
export const LONGUEUR_MAX_ACTION = 200;

/**
 * Motifs de secrets produits par l'app : mot de passe généré (4 groupes de 5),
 * secret TOTP en base32 (16 caractères et plus), code de récupération,
 * URI otpauth. Remplacés par « [masqué] ».
 */
const MOTIFS_SECRETS: readonly RegExp[] = [
  /otpauth:\/\/\S+/gi,
  /\b[A-Za-z0-9]{5}(?:-[A-Za-z0-9]{5}){3}\b/g,
  /\b[A-Z2-7]{16,}\b/g,
  /\b(?=[A-Za-z0-9-]*\d)[A-Za-z0-9]{4,5}(?:-[A-Za-z0-9]{4,5})+\b/g,
];

export function nettoyerTexte(valeur: unknown, longueur = LONGUEUR_MAX_ACTION): string {
  if (typeof valeur !== 'string') {
    return '';
  }
  // eslint-disable-next-line no-control-regex -- on retire justement les caractères de contrôle.
  let propre = valeur.replace(/[\u0000-\u001F\u007F]+/g, ' ');
  for (const motif of MOTIFS_SECRETS) {
    propre = propre.replace(motif, '[masqué]');
  }
  return propre.trim().slice(0, longueur);
}

function estType(valeur: unknown): valeur is TypeEvenement {
  return typeof valeur === 'string' && (TYPES_EVENEMENT as readonly string[]).includes(valeur);
}

const MOTIF_ID = /^[a-z0-9-]{2,32}$/;

/** Relit une entrée ; rien si elle est invalide. */
export function lireEvenement(brut: unknown): EvenementAudit | undefined {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) {
    return undefined;
  }
  const e = brut as Record<string, unknown>;
  if (typeof e.date !== 'string' || Number.isNaN(Date.parse(e.date)) || !estType(e.type)) {
    return undefined;
  }
  const action = nettoyerTexte(e.action);
  if (!action) {
    return undefined;
  }
  const evenement: EvenementAudit = { date: e.date, type: e.type, action };
  if (typeof e.cible === 'string' && MOTIF_ID.test(e.cible)) {
    evenement.cible = e.cible;
  }
  const nom = nettoyerTexte(e.nomCible, 30);
  if (nom) {
    evenement.nomCible = nom;
  }
  if (typeof e.app === 'string' && MOTIF_ID.test(e.app)) {
    evenement.app = e.app;
  }
  return evenement;
}

export function lireJournal(brut: unknown): EvenementAudit[] {
  if (!Array.isArray(brut)) {
    return [];
  }
  return brut.map(lireEvenement).filter((e): e is EvenementAudit => e !== undefined);
}

/** Retire ce qui dépasse la rétention puis la taille maximale (les plus anciens d'abord). */
export function borner(journal: readonly EvenementAudit[], maintenant: number, retentionJours: number, tailleMax = TAILLE_MAX_JOURNAL): EvenementAudit[] {
  const limite = maintenant - retentionJours * 86_400_000;
  const gardes = journal.filter(e => Date.parse(e.date) >= limite);
  return gardes.length > tailleMax ? gardes.slice(gardes.length - tailleMax) : gardes;
}

/** Ajoute un événement (horodaté `maintenant`), puis borne le journal. */
export function journaliser(
  journal: readonly EvenementAudit[],
  evenement: Omit<EvenementAudit, 'date'> & { date?: string },
  maintenant: number,
  retentionJours: number,
  tailleMax = TAILLE_MAX_JOURNAL,
): EvenementAudit[] {
  const propre = lireEvenement({ ...evenement, date: evenement.date ?? new Date(maintenant).toISOString() });
  const suivant = propre ? [...journal, propre] : [...journal];
  suivant.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  return borner(suivant, maintenant, retentionJours, tailleMax);
}

// --- Filtres -------------------------------------------------------------------

export interface FiltreJournal {
  types?: readonly TypeEvenement[];
  /** Identifiant de profil. */
  cible?: string;
  /** Bornes incluses, au format AAAA-MM-JJ (jour local ignoré : on compare en UTC). */
  du?: string;
  au?: string;
  recherche?: string;
}

function sansAccents(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Événements qui passent le filtre, du plus récent au plus ancien. */
export function filtrerJournal(journal: readonly EvenementAudit[], filtre: FiltreJournal): EvenementAudit[] {
  const debut = filtre.du ? Date.parse(`${filtre.du}T00:00:00.000Z`) : Number.NEGATIVE_INFINITY;
  const fin = filtre.au ? Date.parse(`${filtre.au}T23:59:59.999Z`) : Number.POSITIVE_INFINITY;
  const cherche = filtre.recherche ? sansAccents(filtre.recherche.trim()) : '';
  return journal
    .filter(e => {
      if (filtre.types && filtre.types.length > 0 && !filtre.types.includes(e.type)) {
        return false;
      }
      if (filtre.cible && e.cible !== filtre.cible) {
        return false;
      }
      const t = Date.parse(e.date);
      if (t < debut || t > fin) {
        return false;
      }
      if (cherche) {
        const botte = sansAccents(`${e.action} ${e.nomCible ?? ''} ${e.app ?? ''} ${LIBELLES_TYPE[e.type]}`);
        return botte.includes(cherche);
      }
      return true;
    })
    .reverse();
}

// --- Exports -------------------------------------------------------------------

const COLONNES: ReadonlyArray<keyof EvenementAudit> = ['date', 'type', 'action', 'cible', 'nomCible', 'app'];

/** JSON indenté ; chaque entrée est renettoyée. */
export function exporterJson(journal: readonly EvenementAudit[]): string {
  return JSON.stringify({ format: 'journal-administration', version: 1, evenements: lireJournal(journal) }, null, 2);
}

function celluleCsv(valeur: string): string {
  // Neutralise l'injection de formules dans un tableur.
  const sure = /^[=+\-@\t\r]/.test(valeur) ? `'${valeur}` : valeur;
  return /[";\n,]/.test(sure) ? `"${sure.replace(/"/g, '""')}"` : sure;
}

/** CSV (séparateur « ; », usage français), une ligne d'en-tête. */
export function exporterCsv(journal: readonly EvenementAudit[]): string {
  const lignes = lireJournal(journal).map(e => COLONNES.map(colonne => celluleCsv(String(e[colonne] ?? ''))).join(';'));
  return [COLONNES.join(';'), ...lignes].join('\n');
}
