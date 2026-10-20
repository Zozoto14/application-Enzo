/**
 * Préchargement de la SUITE pendant la lecture : l'épisode suivant (et l'autre
 * langue) sont préparés en arrière-plan, sans lancer la moindre vidéo, pour que
 * « Suivant » soit quasi instantané.
 *
 * Limites :
 *  - UNE requête à la fois (les étapes passent l'une après l'autre) ;
 *  - un temps de calme avant la première (le lecteur courant charge d'abord) ;
 *  - rien en mode « économie de données » ou sur une connexion très lente ;
 *  - une seule file par profil : lancer la suite d'un autre épisode ou d'un
 *    autre animé annule la précédente (la requête déjà partie finit, plus aucune
 *    autre ne part) ; quitter le lecteur l'annule aussi ;
 *  - ni erreur ni message : un préchargement raté est simplement refait au clic.
 */

import type { LangueVersion } from '../moteur/langues';
import { prechargerEpisode } from './resoudre';
import type { ServicesTsuzuku } from './services';

/** Temps de calme avant la première étape (le lecteur courant se charge d'abord). */
export const CALME_SUITE_MS = 400;

/** Une étape : rend vrai/faux selon que le travail a pu être fait ; consulte `signal.annule` entre ses requêtes. */
export type EtapeSuite = (signal: { readonly annule: boolean }) => Promise<unknown>;

export interface FileSuite {
  /** Lance ces étapes l'une après l'autre (annule la file en cours) ; rend de quoi les annuler. */
  lancer(etapes: readonly EtapeSuite[], o?: { calmeMs?: number }): () => void;
  /** Annule la file en cours. */
  annuler(): void;
  /** Vrai si une file est en cours (tests). */
  enCours(): boolean;
  /**
   * Promesse tenue quand la file en cours est finie (toutes ses étapes passées)
   * ou annulée ; tenue tout de suite s'il n'y en a pas. Sert aux tests (attendre
   * la fin réelle plutôt qu'un délai arbitraire) et à qui veut savoir.
   */
  fin(): Promise<void>;
}

interface Execution {
  annule: boolean;
  minuteur?: ReturnType<typeof setTimeout>;
  /** Tenue à la fin (étapes passées) ou à l'annulation avant le départ. */
  termine: Promise<void>;
  terminer(): void;
}

function nouvelleExecution(): Execution {
  let terminer = () => undefined as void;
  const termine = new Promise<void>(ok => {
    terminer = ok;
  });
  return { annule: false, termine, terminer };
}

export function creerFileSuite(): FileSuite {
  let courante: Execution | undefined;
  // Exécution annulée dont une étape est encore en vol : `fin()` l'attend aussi.
  let enVol: Promise<void> = Promise.resolve();
  const annuler = () => {
    if (!courante) return;
    const c = courante;
    c.annule = true;
    courante = undefined;
    if (c.minuteur) {
      clearTimeout(c.minuteur);
      c.minuteur = undefined;
      // Pas encore partie : rien ne tournera, elle est finie.
      c.terminer();
    }
  };
  return {
    annuler,
    enCours: () => Boolean(courante),
    fin: () => Promise.all([enVol, courante?.termine]).then(() => undefined),
    lancer(etapes, o = {}) {
      annuler();
      const mienne = nouvelleExecution();
      courante = mienne;
      const fini = () => {
        if (courante === mienne) courante = undefined;
      };
      const executer = async () => {
        try {
          for (const etape of etapes) {
            if (mienne.annule) return;
            await etape(mienne).catch(() => undefined);
          }
        } finally {
          fini();
          mienne.terminer();
        }
      };
      mienne.minuteur = setTimeout(() => {
        mienne.minuteur = undefined;
        const tourne = executer();
        enVol = Promise.all([enVol, tourne]).then(() => undefined);
      }, o.calmeMs ?? CALME_SUITE_MS);
      (mienne.minuteur as unknown as { unref?: () => void }).unref?.();
      return () => {
        if (courante === mienne) annuler();
        else mienne.annule = true;
        if (mienne.minuteur) {
          clearTimeout(mienne.minuteur);
          mienne.minuteur = undefined;
          mienne.terminer();
        }
      };
    },
  };
}

const files = new WeakMap<object, FileSuite>();
/** La file de ce profil (une seule : un autre animé annule le préchargement du précédent). */
export const fileSuiteDe = (s: object): FileSuite => {
  let f = files.get(s);
  if (!f) {
    f = creerFileSuite();
    files.set(s, f);
  }
  return f;
};

/** Vrai si le navigateur demande d'économiser les données ou si la connexion est très lente. */
export function economieDeDonnees(nav: unknown = (globalThis as { navigator?: unknown }).navigator): boolean {
  try {
    const c = (nav as { connection?: { saveData?: boolean; effectiveType?: string } } | undefined)?.connection;
    return Boolean(c?.saveData) || c?.effectiveType === 'slow-2g' || c?.effectiveType === '2g';
  } catch {
    return false;
  }
}

export interface DemandeSuite {
  id: string;
  titres: readonly string[];
  /** Épisode joué. */
  numero: number;
  /** Langue jouée. */
  langue: LangueVersion | null;
  /** Autre langue disponible (sa liste est déjà lue) : préparée en premier, c'est une bascule en un clic. */
  autreLangue?: LangueVersion;
  /** Épisode suivant à préparer. */
  suivant: boolean;
}

/**
 * Prépare l'autre langue puis l'épisode suivant de ce qui se joue. Rend de quoi
 * annuler (démontage du lecteur, autre épisode). Ne fait rien en économie de données.
 */
export function prechargerSuite(s: ServicesTsuzuku, d: DemandeSuite, o: { calmeMs?: number; economie?: boolean } = {}): () => void {
  if (!s.lectureSources || !(d.autreLangue || d.suivant) || (o.economie ?? economieDeDonnees())) return () => undefined;
  const etapes: EtapeSuite[] = [];
  const autre = d.autreLangue;
  if (autre) etapes.push(signal => prechargerEpisode(s, { id: d.id, titres: d.titres, numero: d.numero, langue: autre, signal }));
  if (d.suivant) etapes.push(signal => prechargerEpisode(s, { id: d.id, titres: d.titres, numero: d.numero + 1, langue: d.langue, signal }));
  return fileSuiteDe(s).lancer(etapes, { calmeMs: o.calmeMs });
}
