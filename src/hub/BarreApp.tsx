/**
 * Ce que toute page d'app partage avec l'en-tête du hub : la pastille de
 * synchronisation (état, clic → Paramètres › Synchronisation) et le bouton
 * « Paramètres » qui ouvre LA page Paramètres. Portefeuille, Administration et
 * futures apps n'ont ainsi ni réglages ni indicateur à eux : elles montrent
 * celle-ci.
 *
 * L'hôte (App) fabrique l'élément une fois ; `RetourHub` (barre « ← Hub » des
 * apps) le lit par contexte, et la coque du portefeuille le reçoit en prop.
 */

import React, { createContext, useContext } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { BoutonHub } from './Hub';
import { BoutonIcone } from '../ui/mobile/EnTeteMobile';
import { useMobile } from '../ui/mobile/useMobile';
import { IndicateurSynchro, type SynchroHub } from './IndicateurSynchro';
import type { IdSection } from './recensement';
import type { ThemeHub } from './themes';

/** Élément posé à droite de la barre d'une app ; absent hors du hub. */
export const BarreAppContexte = createContext<React.ReactNode>(null);

export function useBarreApp(): React.ReactNode {
  return useContext(BarreAppContexte);
}

export function BarreApp({ theme, synchro, onParametres, onSupport, supportNonLus = 0 }: { theme: ThemeHub; synchro?: SynchroHub; onParametres(section?: IdSection): void; onSupport?(): void; supportNonLus?: number }) {
  const { width } = useWindowDimensions();
  if (useMobile()) {
    // Téléphone : dans l'en-tête compact, la synchro condensée et l'icône des Paramètres (le Support
    // reste à un geste : Paramètres › Support, ou la barre basse du hub).
    return (
      <View style={styles.barreMobile} testID="barre-app-entete">
        {synchro ? <IndicateurSynchro theme={theme} synchro={synchro} condense onPress={() => onParametres('synchro')} /> : null}
        <BoutonIcone theme={theme} titre="⚙︎" libelle="Paramètres" onPress={() => onParametres()} testID="app-parametres-ouvrir" />
      </View>
    );
  }
  return (
    <View style={styles.barre} testID="barre-app">
      {synchro ? <IndicateurSynchro theme={theme} synchro={synchro} onPress={() => onParametres('synchro')} /> : null}
      <BoutonHub
        theme={theme}
        titre={width >= 520 ? '⚙︎ Paramètres' : '⚙︎'}
        libelle="Paramètres"
        testID="app-parametres-ouvrir"
        onPress={() => onParametres()}
      />
      {onSupport ? (
        <BoutonHub
          theme={theme}
          titre={`${width >= 520 ? '? Support' : '?'}${supportNonLus > 0 ? ` 🔔 ${supportNonLus}` : ''}`}
          libelle={supportNonLus > 0 ? `Support : ${supportNonLus} réponse(s) non lue(s)` : 'Support : écrire à l’équipe'}
          testID="app-support-ouvrir"
          onPress={onSupport}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  barreMobile: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  barre: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap', flexShrink: 1 },
});
