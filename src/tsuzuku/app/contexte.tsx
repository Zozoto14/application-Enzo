/** Contexte partagé par les écrans de Tsuzuku : services du profil, thème du mode, navigation. */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ThemeHub } from '../../hub/themes';
import type { Genre } from '../moteur/bibliotheque';
import { messageDe } from '../moteur/erreurs';
import type { ServicesTsuzuku } from './services';
import type { Mode } from './themeTsuzuku';

/** Écrans de l'app. `kind` = « anime » ou « movie » comme dans la bibliothèque. */
export type Route =
  | { t: 'accueil' }
  | { t: 'catalogue'; q?: string; genre?: string }
  | { t: 'fiche'; kind: Genre; id: string }
  | { t: 'lecteur'; kind: Genre; id: string; numero?: number }
  | { t: 'bibliotheque' }
  | { t: 'import' };

export interface CtxTsuzuku {
  s: ServicesTsuzuku;
  /** Thème du hub décliné pour le mode courant (accent, forme). */
  theme: ThemeHub;
  /** Thème du hub tel quel. */
  themeHub: ThemeHub;
  mode: Mode;
  aller(route: Route): void;
  /** Remplace l'écran courant (épisode suivant) sans empiler. */
  remplacer(route: Route): void;
  retour(): void;
  /** Incrémenté à chaque écriture de la bibliothèque : les écrans relisent. */
  version: number;
  changee(): void;
  large: boolean;
  /** Mode téléphone (< 768 px, ou natif en portrait) : mises en page dédiées. Absent hors de l'app (Paramètres). */
  mobile?: boolean;
  onParametres?(section?: 'tsuzuku' | 'apropos'): void;
  /** Enregistre un fichier (export) ; faux si annulé ou impossible. Absent : l'export s'affiche à copier. */
  enregistrerFichier?(nom: string, contenu: string, type: string): Promise<boolean>;
}

const Contexte = createContext<CtxTsuzuku | null>(null);
export const FournisseurTsuzuku = Contexte.Provider;

export function useTsuzuku(): CtxTsuzuku {
  const c = useContext(Contexte);
  if (!c) {
    throw new Error('Contexte Tsuzuku absent');
  }
  return c;
}

export interface Chargement<T> {
  donnees?: T;
  erreur?: string;
  enCours: boolean;
  recharger(): void;
}

/** Charge une donnée asynchrone ; ignore les réponses d'un chargement périmé. */
export function useCharger<T>(fn: () => Promise<T>, deps: readonly unknown[]): Chargement<T> {
  const [etat, setEtat] = useState<{ donnees?: T; erreur?: string; enCours: boolean }>({ enCours: true });
  const [n, setN] = useState(0);
  const courant = useRef(0);
  useEffect(() => {
    const mien = ++courant.current;
    setEtat(e => ({ donnees: e.donnees, enCours: true }));
    fn().then(
      donnees => {
        if (mien === courant.current) setEtat({ donnees, enCours: false });
      },
      erreur => {
        if (mien === courant.current) setEtat({ erreur: messageDe(erreur), enCours: false });
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `fn` est recréée à chaque rendu ; seules `deps` comptent.
  }, [...deps, n]);
  const recharger = useCallback(() => setN(v => v + 1), []);
  return { ...etat, recharger };
}
