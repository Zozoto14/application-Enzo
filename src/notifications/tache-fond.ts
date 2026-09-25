/**
 * Enregistrement de la tâche de réveil auprès d'iOS.
 *
 * Fine couche d'adaptation : elle ne décide de rien. Toute la logique est
 * dans `reveil.ts`, qui se teste sans téléphone.
 *
 * Deux contraintes du système, qu'on ne peut que subir :
 *
 * - **`finish()` est obligatoire.** iOS accorde une fenêtre d'exécution ; si
 *   l'application ne signale pas qu'elle a terminé, le système la tue et
 *   retient l'incident. Une tâche jugée fautive est réveillée de moins en
 *   moins souvent, jusqu'à plus du tout. D'où le `finally`.
 * - **La fenêtre est courte.** Le minuteur de garde rend la main de lui-même
 *   plutôt que de laisser iOS trancher.
 */

import { chargerModule } from '../natif/modules';
import { executerReveil, type DependancesReveil, type ResultatReveil } from './reveil';

const MODULE = 'react-native-background-fetch';

/** Intervalle minimal demandé, en minutes. iOS le traite comme un plancher. */
export const INTERVALLE_MINUTES = 15;

/** Au-delà, on rend la main sans attendre plutôt que de se faire tuer. */
export const GARDE_MILLISECONDES = 20_000;

interface ModuleFond {
  configure(
    options: Record<string, unknown>,
    tache: (idTache: string) => void | Promise<void>,
    expiration: (idTache: string) => void | Promise<void>,
  ): Promise<number>;
  finish(idTache: string): void;
}

export interface EnregistrementReveil {
  /** Faux si le module natif n'est pas dans le binaire. */
  disponible: boolean;
  raison?: string;
}

function estModuleFond(valeur: unknown): valeur is ModuleFond {
  if (!valeur || typeof valeur !== 'object') {
    return false;
  }
  const candidat = valeur as Partial<ModuleFond>;
  return typeof candidat.configure === 'function' && typeof candidat.finish === 'function';
}

/**
 * Rend la main au bout du délai de garde, quoi qu'il arrive.
 *
 * On ne peut pas interrompre le travail en cours — JavaScript n'a pas de
 * préemption — mais on peut au moins appeler `finish()` à l'heure, ce qui est
 * ce qu'iOS observe.
 */
function avecGarde<T>(promesse: Promise<T>, millisecondes: number): Promise<T | undefined> {
  return new Promise(resoudre => {
    const minuteur = setTimeout(() => resoudre(undefined), millisecondes);
    promesse
      .then(valeur => {
        clearTimeout(minuteur);
        resoudre(valeur);
      })
      .catch(() => {
        clearTimeout(minuteur);
        resoudre(undefined);
      });
  });
}

export interface OptionsEnregistrement {
  /** Rassemble les dépendances à chaud : le planning peut avoir changé. */
  dependances(): Promise<DependancesReveil>;
  /** Journal facultatif, pour afficher le dernier réveil dans les réglages. */
  journaliser?(resultat: ResultatReveil | undefined): void;
  moduleFond?: unknown;
  intervalleMinutes?: number;
  gardeMillisecondes?: number;
}

/**
 * Déclare l'application intéressée par les réveils.
 *
 * À appeler une fois au démarrage. Sans le module natif, renvoie simplement
 * `disponible: false` : l'écran des réglages le dit à l'utilisateur plutôt que
 * de laisser croire à des briefings qui n'arriveront pas.
 */
export async function enregistrerReveil(
  options: OptionsEnregistrement,
): Promise<EnregistrementReveil> {
  const charge = options.moduleFond
    ? { etat: 'disponible' as const, module: options.moduleFond, raison: undefined }
    : chargerModule<unknown>(MODULE);

  if (charge.etat !== 'disponible' || !estModuleFond(charge.module)) {
    return {
      disponible: false,
      raison: charge.raison ?? 'Module de réveil absent de cette version.',
    };
  }

  const moduleFond = charge.module;
  const garde = options.gardeMillisecondes ?? GARDE_MILLISECONDES;

  const tache = async (idTache: string) => {
    try {
      const resultat = await avecGarde(
        options.dependances().then(executerReveil),
        garde,
      );
      options.journaliser?.(resultat);
    } catch {
      // Un reveil qui plante est un reveil qu'iOS finit par ne plus accorder.
      options.journaliser?.(undefined);
    } finally {
      moduleFond.finish(idTache);
    }
  };

  try {
    await moduleFond.configure(
      {
        minimumFetchInterval: options.intervalleMinutes ?? INTERVALLE_MINUTES,
        // Les briefings doivent survivre a une fermeture de l'application.
        stopOnTerminate: false,
        startOnBoot: true,
        enableHeadless: true,
        requiredNetworkType: 1, // NETWORK_TYPE_ANY : les cours demandent le reseau.
      },
      tache,
      // Expiration : iOS reprend la main. On se contente de cloturer proprement.
      idTache => {
        moduleFond.finish(idTache);
      },
    );
  } catch (erreur) {
    return {
      disponible: false,
      raison: erreur instanceof Error ? erreur.message : 'Réveil refusé par le système.',
    };
  }

  return { disponible: true };
}
