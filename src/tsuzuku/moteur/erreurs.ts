/**
 * Erreur unique du moteur Tsuzuku.
 *
 * `statut` reprend la convention HTTP de l'ancien serveur (400 : saisie
 * invalide, 404 : introuvable, 502 : service distant en echec...) pour que
 * l'interface puisse garder les memes messages ; `code` permet de reagir
 * sans analyser le texte.
 */
export type CodeErreur =
  | 'saisie'
  | 'adresse'
  | 'garde'
  | 'reseau'
  | 'delai'
  | 'taille'
  | 'redirections'
  | 'introuvable'
  | 'service'
  | 'configuration'
  | 'selecteur';

export class ErreurMoteur extends Error {
  readonly statut: number;
  readonly code: CodeErreur;

  constructor(message: string, code: CodeErreur = 'saisie', statut = 400) {
    super(message);
    this.name = 'ErreurMoteur';
    this.code = code;
    this.statut = statut;
  }
}

export const echec = (message: string, code: CodeErreur = 'saisie', statut = 400) =>
  new ErreurMoteur(message, code, statut);

/** Statut d'une erreur quelconque (celui d'une ErreurMoteur, sinon undefined). */
export function statutDe(err: unknown): number | undefined {
  return err instanceof ErreurMoteur ? err.statut : undefined;
}

export function messageDe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
