/**
 * Chargement à la demande d'un écran (React.lazy + Suspense) pour le site et l'app PC : le code d'une app du hub
 * (Tâches, Tsuzuku, Administration…) ou d'un écran lourd n'est plus dans le fichier principal, il est téléchargé
 * la première fois qu'on l'ouvre (docs/performance.md).
 *
 * Réseau instable (iPad en Wi-Fi faible) : un import() qui échoue est retenté UNE fois après une courte pause avant
 * de remonter l'erreur. Si l'échec persiste, c'est en général un morceau périmé (site redéployé pendant que l'onglet
 * restait ouvert) : la GardeErreur de l'app le reconnaît et recharge la page une seule fois (src/ui/versionPerimee.ts).
 */

import React, { Suspense } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { sansRechargement } from './versionPerimee';

export const PAUSE_REESSAI_MS = 1_200;

/** Lance `charger` ; en cas d'échec, une seconde tentative après `pauseMs`. */
export async function importerAvecReessai<T>(charger: () => Promise<T>, pauseMs = PAUSE_REESSAI_MS): Promise<T> {
  try {
    return await charger();
  } catch {
    await new Promise<void>(ok => setTimeout(ok, pauseMs));
    return charger();
  }
}

function AttenteParDefaut() {
  return (
    <View style={{ flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Chargement" accessibilityRole="progressbar">
      <ActivityIndicator />
    </View>
  );
}

export interface OptionsDiffere {
  /** Indicateur pendant le chargement (défaut : roue centrée, libellé « Chargement » ; null : rien). */
  attente?: React.ReactNode;
  pauseReessaiMs?: number;
}

/**
 * Composant chargé à la demande. Le module n'est demandé qu'au premier rendu ; `precharger()` le demande plus tôt
 * (par exemple au survol d'une tuile).
 */
export function differe<P extends object>(
  charger: () => Promise<React.ComponentType<P>>,
  options: OptionsDiffere = {},
): ((props: P) => React.ReactElement) & { precharger: () => Promise<unknown> } {
  let promesse: Promise<{ default: React.ComponentType<P> }> | undefined;
  const demander = () => {
    if (!promesse) {
      promesse = importerAvecReessai(charger, options.pauseReessaiMs).then(
        c => ({ default: c }),
        erreur => {
          // Pas de mémoire de l'échec : React.lazy garde l'erreur une fois rejetée, un nouveau lazy est donc posé
          // pour que « Réessayer » de la GardeErreur redemande le module.
          promesse = undefined;
          Ecran = React.lazy(demander);
          throw erreur;
        },
      );
    }
    return promesse;
  };
  let Ecran: React.LazyExoticComponent<React.ComponentType<P>> = React.lazy(demander);
  function EcranDiffere(props: P) {
    return (
      <Suspense fallback={options.attente !== undefined ? options.attente : <AttenteParDefaut />}>
        <Ecran {...props} />
      </Suspense>
    );
  }
  const composant = EcranDiffere as typeof EcranDiffere & { precharger: () => Promise<unknown> };
  // Préchargement au repos : un échec reste silencieux (pas de rechargement de la page, voir versionPerimee).
  composant.precharger = () => sansRechargement(demander).catch(() => undefined);
  return composant;
}
