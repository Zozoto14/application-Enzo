/**
 * Raccourci clavier « M » (ajouter un repère au temps courant). Sans clavier
 * sur l'app iOS native : rien à brancher. Version web : `raccourci.web.ts`.
 */

export const TOUCHE_RACCOURCI = 'M';

export function useRaccourciRepere(_actif: boolean, _declencher: () => void): void {
  // Pas de clavier physique géré sur l'app native.
}
